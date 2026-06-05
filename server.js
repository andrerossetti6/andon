require('dotenv').config();
const express  = require('express');
const path     = require('path');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');
const supabase = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// Busca todas as linhas de uma tabela contornando o limite de 1000 linhas do PostgREST
async function fetchAllRows(tabela, importacaoId, pageSize = 1000) {
    let all = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from(tabela).select('*')
            .eq('importacao_id', importacaoId)
            .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data?.length) break;
        all = all.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

// Insere rows em batches com rollback automático se algum falhar
async function batchInsert(tabela, importacaoTabela, importacaoId, rows, batchSize = 200) {
    for (let i = 0; i < rows.length; i += batchSize) {
        const { error } = await supabase.from(tabela).insert(rows.slice(i, i + batchSize));
        if (error) {
            console.error(`batchInsert ${tabela} falhou no lote ${i}/${rows.length}: ${error.message}`);
            await supabase.from(importacaoTabela).delete().eq('id', importacaoId);
            return { erro: `Falha ao salvar (lote ${i}–${Math.min(i+batchSize, rows.length)} de ${rows.length}): ${error.message}` };
        }
    }
    return { ok: true };
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname, { etag: false, lastModified: false, setHeaders: res => res.set('Cache-Control', 'no-store') }));

// ── Middleware de autenticação ────────────────────────────────
function auth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ erro: 'Não autorizado' });
    try {
        req.usuario = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
}

function adminOnly(req, res, next) {
    if (req.usuario?.perfil !== 'admin') {
        return res.status(403).json({ erro: 'Acesso restrito a administradores' });
    }
    next();
}

// ── GET /api/ping — wake-up sem auth ─────────────────────────
app.get('/api/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── POST /api/auth/login ──────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        if (!email || !senha)
            return res.status(400).json({ erro: 'Email e senha obrigatórios' });

        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email.toLowerCase().trim())
            .eq('ativo', true)
            .single();

        if (error) {
            console.error('Supabase erro login:', error.message);
            return res.status(503).json({ erro: 'Banco de dados indisponível. Execute o schema.sql no Supabase.' });
        }

        if (!usuario)
            return res.status(401).json({ erro: 'Credenciais inválidas' });

        const ok = await bcrypt.compare(senha, usuario.senha_hash);
        if (!ok)
            return res.status(401).json({ erro: 'Credenciais inválidas' });

        const token = jwt.sign(
            { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            usuario: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil }
        });
    } catch (e) {
        console.error('Erro login:', e.message);
        res.status(500).json({ erro: 'Erro interno do servidor' });
    }
});

// ── POST /api/auth/trocar-senha ───────────────────────────────
app.post('/api/auth/trocar-senha', auth, async (req, res) => {
    const { senhaAtual, novaSenha } = req.body;
    if (!senhaAtual || !novaSenha || novaSenha.length < 6)
        return res.status(400).json({ erro: 'Senha nova deve ter pelo menos 6 caracteres' });

    const { data: usuario } = await supabase
        .from('usuarios').select('senha_hash').eq('id', req.usuario.id).single();

    if (!await bcrypt.compare(senhaAtual, usuario.senha_hash))
        return res.status(401).json({ erro: 'Senha atual incorreta' });

    const hash = await bcrypt.hash(novaSenha, 10);
    await supabase.from('usuarios').update({ senha_hash: hash }).eq('id', req.usuario.id);
    res.json({ ok: true });
});

// ── GET /api/usuarios (admin) ─────────────────────────────────
app.get('/api/usuarios', auth, adminOnly, async (_req, res) => {
    const { data, error } = await supabase
        .from('usuarios')
        .select('id, nome, email, perfil, ativo, criado_em')
        .order('criado_em');
    if (error) return res.status(500).json({ erro: 'Erro ao buscar usuários' });
    res.json(data);
});

// ── POST /api/usuarios (admin) ────────────────────────────────
app.post('/api/usuarios', auth, adminOnly, async (req, res) => {
    const { nome, email, senha, perfil } = req.body;
    if (!nome || !email || !senha)
        return res.status(400).json({ erro: 'Nome, email e senha obrigatórios' });

    const hash = await bcrypt.hash(senha, 10);
    const { data, error } = await supabase
        .from('usuarios')
        .insert({ nome, email: email.toLowerCase().trim(), senha_hash: hash, perfil: perfil || 'viewer' })
        .select('id, nome, email, perfil')
        .single();

    if (error) return res.status(400).json({ erro: 'Email já cadastrado' });
    res.json(data);
});

// ── GET /api/importacoes ──────────────────────────────────────
app.get('/api/importacoes', auth, async (_req, res) => {
    const { data, error } = await supabase
        .from('importacoes')
        .select('id, nome_arquivo, total_linhas, anos, criado_em, usuarios(nome)')
        .order('criado_em', { ascending: false })
        .limit(30);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar importações' });
    res.json(data);
});

// ── POST /api/vendas/import ───────────────────────────────────
app.post("/api/vendas/import", auth, adminOnly, async (req, res) => {
    const { nomeArquivo, linhas, anos } = req.body;
    if (!Array.isArray(linhas) || !linhas.length)
        return res.status(400).json({ erro: 'Dados inválidos' });

    // Cria registro de importação
    const { data: imp, error: errImp } = await supabase
        .from('importacoes')
        .insert({
            nome_arquivo:  nomeArquivo || 'importacao',
            usuario_id:    req.usuario.id,
            total_linhas:  linhas.length,
            anos:          anos || []
        })
        .select().single();

    if (errImp) return res.status(500).json({ erro: 'Erro ao criar importação' });

    // Insere em batches de 200
    const rows = linhas.map(l => ({
        importacao_id: imp.id,
        codigo:    l.codigo    || '',
        descricao: l.descricao || '',
        modelo:    l.modelo    || '',
        segmento:  l.segmento  || '',
        tamanho:   l.tamanho   || '',
        marca:     l.marca     || '',
        meses:     l.meses     || {},
        dados:     l.dados     || {},
        quantidade: Number(l.quantidade) || 0,
        valor:      Number(l.valor)      || 0
    }));

    const result = await batchInsert('vendas', 'importacoes', imp.id, rows);
    if (result.erro) return res.status(500).json({ erro: result.erro });

    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/vendas?importacao_id=xxx ─────────────────────────
app.get('/api/vendas', auth, async (req, res) => {
    const { importacao_id, segmento, modelo, tamanho } = req.query;
    if (!importacao_id) return res.json([]);
    try {
        // fetchAllRows com filtros extras
        const PAGE = 1000;
        let all = [], from = 0;
        while (true) {
            let q = supabase.from('vendas').select('*').eq('importacao_id', importacao_id).range(from, from + PAGE - 1);
            if (segmento) q = q.eq('segmento', segmento);
            if (modelo)   q = q.eq('modelo', modelo);
            if (tamanho)  q = q.eq('tamanho', tamanho);
            const { data, error } = await q;
            if (error) throw error;
            if (!data?.length) break;
            all = all.concat(data);
            if (data.length < PAGE) break;
            from += PAGE;
        }
        res.json(all);
    } catch (e) { res.status(500).json({ erro: 'Erro ao buscar dados: ' + e.message }); }
});

// ── GET /api/importacoes-estoque ─────────────────────────────
app.get('/api/importacoes-estoque', auth, async (req, res) => {
    const { data, error } = await supabase
        .from('importacoes_estoque')
        .select('id, nome_arquivo, total_linhas, criado_em, usuarios(nome)')
        .order('criado_em', { ascending: false })
        .limit(30);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar importações de estoque' });
    res.json(data);
});

// ── POST /api/estoque/import ──────────────────────────────────
app.post("/api/estoque/import", auth, adminOnly, async (req, res) => {
    const { nomeArquivo, linhas } = req.body;
    if (!Array.isArray(linhas) || !linhas.length)
        return res.status(400).json({ erro: 'Dados inválidos' });

    const { data: imp, error: errImp } = await supabase
        .from('importacoes_estoque')
        .insert({ nome_arquivo: nomeArquivo || 'estoque', usuario_id: req.usuario.id, total_linhas: linhas.length })
        .select().single();
    if (errImp) {
        console.error('Erro importacoes_estoque:', errImp.message);
        return res.status(500).json({ erro: errImp.message });
    }

    const rows = linhas.map(l => ({
        importacao_id: imp.id,
        codigo:     String(l.codigo || '').trim(),
        quantidade: Number(l.quantidade) || 0,
        dados:      l.dados || {}
    }));

    const r1 = await batchInsert('estoque', 'importacoes_estoque', imp.id, rows);
    if (r1.erro) return res.status(500).json({ erro: r1.erro });
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/estoque?importacao_id=xxx ────────────────────────
app.get('/api/estoque', auth, async (req, res) => {
    const { importacao_id } = req.query;
    if (!importacao_id) return res.json([]);
    try { res.json(await fetchAllRows('estoque', importacao_id)); }
    catch (e) { res.status(500).json({ erro: 'Erro ao buscar estoque: ' + e.message }); }
});

// ── DELETE /api/importacoes-estoque/:id ───────────────────────
app.delete('/api/importacoes-estoque/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('importacoes_estoque').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: 'Erro ao deletar' });
    res.json({ ok: true });
});

// ── GET /api/importacoes-op ──────────────────────────────────
app.get('/api/importacoes-op', auth, async (_req, res) => {
    const { data, error } = await supabase
        .from('importacoes_op')
        .select('id, nome_arquivo, total_linhas, criado_em, usuarios(nome)')
        .order('criado_em', { ascending: false })
        .limit(30);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar importações de OP' });
    res.json(data);
});

// ── POST /api/op/import ──────────────────────────────────────
app.post("/api/op/import", auth, adminOnly, async (req, res) => {
    const { nomeArquivo, linhas } = req.body;
    if (!Array.isArray(linhas) || !linhas.length)
        return res.status(400).json({ erro: 'Dados inválidos' });

    const { data: imp, error: errImp } = await supabase
        .from('importacoes_op')
        .insert({ nome_arquivo: nomeArquivo || 'op', usuario_id: req.usuario.id, total_linhas: linhas.length })
        .select().single();
    if (errImp) {
        console.error('Erro importacoes_op:', errImp.message);
        return res.status(500).json({ erro: errImp.message });
    }

    const rows = linhas.map(l => ({ importacao_id: imp.id, dados: l.dados || {} }));
    const r2 = await batchInsert('dados_op', 'importacoes_op', imp.id, rows);
    if (r2.erro) return res.status(500).json({ erro: r2.erro });
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/op?importacao_id=xxx ────────────────────────────
app.get('/api/op', auth, async (req, res) => {
    const { importacao_id } = req.query;
    if (!importacao_id) return res.json([]);
    try { res.json(await fetchAllRows('dados_op', importacao_id)); }
    catch (e) { res.status(500).json({ erro: 'Erro ao buscar ordens: ' + e.message }); }
});

// ── DELETE /api/importacoes-op/:id ───────────────────────────
app.delete('/api/importacoes-op/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('importacoes_op').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: 'Erro ao deletar' });
    res.json({ ok: true });
});

// ── GET /api/importacoes-costura ─────────────────────────────
app.get('/api/importacoes-costura', auth, async (_req, res) => {
    const { data, error } = await supabase
        .from('importacoes_costura')
        .select('id, nome_arquivo, total_linhas, criado_em, usuarios(nome)')
        .order('criado_em', { ascending: false })
        .limit(30);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar importações de costura' });
    res.json(data);
});

// ── POST /api/costura/import ─────────────────────────────────
app.post("/api/costura/import", auth, adminOnly, async (req, res) => {
    const { nomeArquivo, linhas } = req.body;
    if (!Array.isArray(linhas) || !linhas.length)
        return res.status(400).json({ erro: 'Dados inválidos' });

    const { data: imp, error: errImp } = await supabase
        .from('importacoes_costura')
        .insert({ nome_arquivo: nomeArquivo || 'costura', usuario_id: req.usuario.id, total_linhas: linhas.length })
        .select().single();
    if (errImp) {
        console.error('Erro importacoes_costura:', errImp.message);
        return res.status(500).json({ erro: errImp.message });
    }

    const rows = linhas.map(l => ({ importacao_id: imp.id, dados: l.dados || {} }));
    const r3 = await batchInsert('dados_costura', 'importacoes_costura', imp.id, rows);
    if (r3.erro) return res.status(500).json({ erro: r3.erro });
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/costura?importacao_id=xxx ───────────────────────
app.get('/api/costura', auth, async (req, res) => {
    const { importacao_id } = req.query;
    if (!importacao_id) return res.json([]);
    try { res.json(await fetchAllRows('dados_costura', importacao_id)); }
    catch (e) { res.status(500).json({ erro: 'Erro ao buscar costura: ' + e.message }); }
});

// ── DELETE /api/importacoes-costura/:id ──────────────────────
app.delete('/api/importacoes-costura/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('importacoes_costura').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: 'Erro ao deletar' });
    res.json({ ok: true });
});

// ── GET /api/importacoes-cliente ─────────────────────────────
app.get('/api/importacoes-cliente', auth, async (_req, res) => {
    const { data, error } = await supabase
        .from('importacoes_cliente')
        .select('id, nome_arquivo, total_linhas, criado_em, usuarios(nome)')
        .order('criado_em', { ascending: false })
        .limit(30);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar importações de cliente' });
    res.json(data);
});

// ── POST /api/cliente/import ─────────────────────────────────
app.post("/api/cliente/import", auth, adminOnly, async (req, res) => {
    const { nomeArquivo, linhas } = req.body;
    if (!Array.isArray(linhas) || !linhas.length)
        return res.status(400).json({ erro: 'Dados inválidos' });

    const { data: imp, error: errImp } = await supabase
        .from('importacoes_cliente')
        .insert({ nome_arquivo: nomeArquivo || 'cliente', usuario_id: req.usuario.id, total_linhas: linhas.length })
        .select().single();
    if (errImp) {
        console.error('Erro importacoes_cliente:', errImp.message);
        return res.status(500).json({ erro: errImp.message });
    }

    const rows = linhas.map(l => ({ importacao_id: imp.id, dados: l.dados || {} }));
    const r4 = await batchInsert('dados_cliente', 'importacoes_cliente', imp.id, rows);
    if (r4.erro) return res.status(500).json({ erro: r4.erro });
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/cliente?importacao_id=xxx ───────────────────────
app.get('/api/cliente', auth, async (req, res) => {
    const { importacao_id } = req.query;
    if (!importacao_id) return res.json([]);
    try { res.json(await fetchAllRows('dados_cliente', importacao_id)); }
    catch (e) { res.status(500).json({ erro: 'Erro ao buscar cliente: ' + e.message }); }
});

// ── DELETE /api/importacoes-cliente/:id ──────────────────────
app.delete('/api/importacoes-cliente/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('importacoes_cliente').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: 'Erro ao deletar' });
    res.json({ ok: true });
});

// ── GET /api/importacoes-banco ───────────────────────────────
app.get('/api/importacoes-banco', auth, async (_req, res) => {
    const { data, error } = await supabase
        .from('importacoes_banco')
        .select('id, nome_arquivo, total_linhas, criado_em, usuarios(nome)')
        .order('criado_em', { ascending: false })
        .limit(30);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar importações de banco' });
    res.json(data);
});

// ── POST /api/banco/import ───────────────────────────────────
app.post("/api/banco/import", auth, adminOnly, async (req, res) => {
    const { nomeArquivo, linhas } = req.body;
    if (!Array.isArray(linhas) || !linhas.length)
        return res.status(400).json({ erro: 'Dados inválidos' });

    const { data: imp, error: errImp } = await supabase
        .from('importacoes_banco')
        .insert({ nome_arquivo: nomeArquivo || 'banco', usuario_id: req.usuario.id, total_linhas: linhas.length })
        .select().single();
    if (errImp) {
        console.error('Erro importacoes_banco:', errImp.message);
        return res.status(500).json({ erro: errImp.message });
    }

    const rows = linhas.map(l => ({ importacao_id: imp.id, dados: l.dados || {} }));
    const r5 = await batchInsert('dados_banco', 'importacoes_banco', imp.id, rows);
    if (r5.erro) return res.status(500).json({ erro: r5.erro });
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/banco?importacao_id=xxx ─────────────────────────
app.get('/api/banco', auth, async (req, res) => {
    const { importacao_id } = req.query;
    if (!importacao_id) return res.json([]);
    try { res.json(await fetchAllRows('dados_banco', importacao_id)); }
    catch (e) { res.status(500).json({ erro: 'Erro ao buscar banco: ' + e.message }); }
});

// ── DELETE /api/importacoes-banco/:id ────────────────────────
app.delete('/api/importacoes-banco/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('importacoes_banco').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: 'Erro ao deletar' });
    res.json({ ok: true });
});

// ── S&OP — AÇÕES / DECISÕES ───────────────────────────────────
app.get('/api/soep-acoes', auth, async (_req, res) => {
    const { data, error } = await supabase.from('soep_acoes').select('*').order('criado_em', { ascending: false });
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/soep-acoes', auth, async (req, res) => {
    const { descricao, responsavel, prazo, modulo } = req.body;
    if (!descricao?.trim()) return res.status(400).json({ erro: 'descricao obrigatória' });
    const { data, error } = await supabase.from('soep_acoes')
        .insert({ descricao: descricao.trim(), responsavel: responsavel||null, prazo: prazo||null, modulo: modulo||null, status: 'aberta' })
        .select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, acao: data });
});
app.put('/api/soep-acoes/:id', auth, async (req, res) => {
    const fields = {};
    ['status','descricao','responsavel','prazo'].forEach(k => { if (req.body[k] !== undefined) fields[k] = req.body[k] || null; });
    const { error } = await supabase.from('soep_acoes').update(fields).eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});
app.delete('/api/soep-acoes/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('soep_acoes').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── DISPONIBILIDADE: FERIADOS ────────────────────────────────
app.get('/api/feriados', auth, async (_req, res) => {
    const { data, error } = await supabase.from('feriados').select('*').order('data');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
});
app.post('/api/feriados/lote', auth, async (req, res) => {
    const { feriados } = req.body;
    if (!Array.isArray(feriados) || !feriados.length)
        return res.status(400).json({ erro: 'Dados inválidos' });
    const rows = feriados.map(f => ({ data: f.data, nome: f.nome, tipo: f.tipo || 'Nacional' }));
    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('feriados').insert(rows.slice(i, i + 200));
        if (error) return res.status(500).json({ erro: error.message });
    }
    res.json({ ok: true, total: rows.length });
});
app.post('/api/feriados', auth, async (req, res) => {
    const { data: d, nome, tipo } = req.body;
    if (!d || !nome) return res.status(400).json({ erro: 'Data e nome obrigatórios' });
    const { data, error } = await supabase.from('feriados').insert({ data: d, nome, tipo: tipo || 'Nacional' }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, feriado: data });
});
app.delete('/api/feriados/:id', auth, async (req, res) => {
    const { error } = await supabase.from('feriados').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── DISPONIBILIDADE: TURNOS ──────────────────────────────────
app.get('/api/turnos', auth, async (_req, res) => {
    const { data, error } = await supabase.from('turnos').select('*').order('nome');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
});
app.post('/api/turnos', auth, async (req, res) => {
    const { processo, nome, inicio, fim, intervalo_min, dias_semana } = req.body;
    if (!nome || !inicio || !fim) return res.status(400).json({ erro: 'Nome, início e fim obrigatórios' });
    const { data, error } = await supabase.from('turnos')
        .insert({ processo: processo || '', nome, inicio, fim, intervalo_min: Number(intervalo_min) || 0, dias_semana: dias_semana || [] })
        .select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, turno: data });
});
app.put('/api/turnos/:id', auth, async (req, res) => {
    const { processo, nome, inicio, fim, intervalo_min, dias_semana } = req.body;
    const { data, error } = await supabase.from('turnos')
        .update({ processo, nome, inicio, fim, intervalo_min, dias_semana })
        .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, data });
});

app.delete('/api/turnos/:id', auth, async (req, res) => {
    const { error } = await supabase.from('turnos').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── PROCESSOS CRUD ───────────────────────────────────────────
app.get('/api/processos-config', auth, async (_req, res) => {
    const { data, error } = await supabase.from('processos_config').select('*').order('nome');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
});
app.post('/api/processos-config', auth, async (req, res) => {
    const { nome, descricao } = req.body;
    const { data, error } = await supabase.from('processos_config').insert({ nome, descricao }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, data });
});
app.put('/api/processos-config/:id', auth, async (req, res) => {
    const { nome, descricao } = req.body;
    const { data, error } = await supabase.from('processos_config').update({ nome, descricao }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, data });
});
app.delete('/api/processos-config/:id', auth, async (req, res) => {
    const { error } = await supabase.from('processos_config').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── MÁQUINAS CRUD ─────────────────────────────────────────────
app.get('/api/maquinas', auth, async (req, res) => {
    let q = supabase.from('maquinas').select('*').order('id_maquina');
    if (req.query.processo_id) q = q.eq('processo_id', req.query.processo_id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
});
app.post('/api/maquinas', auth, async (req, res) => {
    const { processo_id, id_maquina, modelo, oee, status, n_pessoas } = req.body;
    if (!processo_id) return res.status(400).json({ erro: 'processo_id obrigatório' });
    if (!id_maquina && !modelo && oee == null && n_pessoas == null)
        return res.status(400).json({ erro: 'Preencha ao menos um campo da máquina' });
    const { data, error } = await supabase.from('maquinas').insert({ processo_id, id_maquina: id_maquina || null, modelo: modelo || null, oee: oee ?? null, status: status || 'Ativo', n_pessoas: n_pessoas ?? null }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, data });
});
app.put('/api/maquinas/:id', auth, async (req, res) => {
    const { id_maquina, modelo, oee, status, n_pessoas } = req.body;
    const { data, error } = await supabase.from('maquinas').update({ id_maquina, modelo, oee, status, n_pessoas }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, data });
});
app.delete('/api/maquinas/:id', auth, async (req, res) => {
    const { error } = await supabase.from('maquinas').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── ARQUITETURA DE DADOS — rotas genéricas ───────────────────
['calendario','processos','capacidade'].forEach(nome => {
    app.get(`/api/importacoes-${nome}`, auth, async (_req, res) => {
        const { data, error } = await supabase.from(`importacoes_${nome}`)
            .select('id, nome_arquivo, total_linhas, criado_em, usuarios(nome)')
            .order('criado_em', { ascending: false }).limit(30);
        if (error) return res.status(500).json({ erro: `Erro ao buscar importações de ${nome}` });
        res.json(data);
    });

    app.post(`/api/${nome}/import`, auth, adminOnly, async (req, res) => {
        const { nomeArquivo, linhas } = req.body;
        if (!Array.isArray(linhas) || !linhas.length)
            return res.status(400).json({ erro: 'Dados inválidos' });
        const { data: imp, error: errImp } = await supabase.from(`importacoes_${nome}`)
            .insert({ nome_arquivo: nomeArquivo || nome, usuario_id: req.usuario.id, total_linhas: linhas.length })
            .select().single();
        if (errImp) return res.status(500).json({ erro: errImp.message });
        const rows = linhas.map(l => ({ importacao_id: imp.id, dados: l.dados || {} }));
        const rg = await batchInsert(`dados_${nome}`, `importacoes_${nome}`, imp.id, rows);
        if (rg.erro) return res.status(500).json({ erro: rg.erro });
        res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
    });

    app.get(`/api/${nome}`, auth, async (req, res) => {
        let q = supabase.from(`dados_${nome}`).select('*');
        if (req.query.importacao_id) q = q.eq('importacao_id', req.query.importacao_id);
        const { data, error } = await q.limit(5000);
        if (error) return res.status(500).json({ erro: `Erro ao buscar ${nome}` });
        res.json(data);
    });

    app.delete(`/api/importacoes-${nome}/:id`, auth, adminOnly, async (req, res) => {
        const { error } = await supabase.from(`importacoes_${nome}`).delete().eq('id', req.params.id);
        if (error) return res.status(500).json({ erro: 'Erro ao deletar' });
        res.json({ ok: true });
    });
});

// ── DELETE /api/reset-dados — apaga todos os dados importados ────
app.delete('/api/reset-dados', auth, adminOnly, async (_req, res) => {
    // Apaga só os registros de importação — o CASCADE remove os dados filhos automaticamente
    const IMPORTACOES = [
        'importacoes',          // vendas (cascade para vendas)
        'importacoes_estoque',  // cascade para estoque
        'importacoes_op',
        'importacoes_costura',  // cascade para dados_costura
        'importacoes_cliente',  // cascade para dados_cliente
        'importacoes_banco',    // cascade para dados_banco
        'importacoes_calendario',
        'importacoes_capacidade',
        'feriados',
        'turnos',
    ];
    const erros = [];
    for (const t of IMPORTACOES) {
        const { error } = await supabase.from(t).delete().not('id', 'is', null);
        if (error) erros.push(`${t}: ${error.message}`);
    }
    if (erros.length) return res.status(500).json({ erro: erros.join(' | ') });
    res.json({ ok: true, msg: 'Todos os dados importados foram removidos. Estrutura e usuários mantidos.' });
});

// ── GET /api/backup — exporta todos os dados como JSON ──────────
app.get('/api/backup', auth, adminOnly, async (_req, res) => {
    const TABELAS = ['importacoes','vendas','importacoes_estoque','estoque',
        'importacoes_op','dados_op','importacoes_costura','dados_costura',
        'importacoes_cliente','dados_cliente','importacoes_banco','dados_banco',
        'feriados','turnos','processos_config','maquinas'];
    const backup = { gerado_em: new Date().toISOString(), tabelas: {} };
    for (const t of TABELAS) {
        const { data, error } = await supabase.from(t).select('*').limit(50000);
        backup.tabelas[t] = error ? { erro: error.message } : data;
    }
    res.setHeader('Content-Disposition', `attachment; filename="sigs-backup-${new Date().toISOString().slice(0,10)}.json"`);
    res.json(backup);
});

// ── GET /api/setup — verifica tabelas e retorna SQL faltante ─────
app.get('/api/setup', async (_req, res) => {
    const TABELAS = [
        { nome: 'importacoes',          sql: `CREATE TABLE IF NOT EXISTS importacoes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_arquivo TEXT NOT NULL, usuario_id UUID REFERENCES usuarios(id), total_linhas INTEGER DEFAULT 0, anos TEXT[] DEFAULT '{}', criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE importacoes DISABLE ROW LEVEL SECURITY;` },
        { nome: 'vendas',               sql: `CREATE TABLE IF NOT EXISTS vendas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), importacao_id UUID REFERENCES importacoes(id) ON DELETE CASCADE, codigo TEXT, descricao TEXT, modelo TEXT, segmento TEXT, tamanho TEXT, marca TEXT, meses JSONB DEFAULT '{}', quantidade NUMERIC(14,2) DEFAULT 0, valor NUMERIC(14,2) DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_vendas_importacao ON vendas(importacao_id); ALTER TABLE vendas DISABLE ROW LEVEL SECURITY;` },
        { nome: 'importacoes_estoque',  sql: `CREATE TABLE IF NOT EXISTS importacoes_estoque (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_arquivo TEXT NOT NULL, usuario_id UUID REFERENCES usuarios(id), total_linhas INTEGER DEFAULT 0, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE importacoes_estoque DISABLE ROW LEVEL SECURITY;` },
        { nome: 'estoque',              sql: `CREATE TABLE IF NOT EXISTS estoque (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), importacao_id UUID REFERENCES importacoes_estoque(id) ON DELETE CASCADE, codigo TEXT NOT NULL, quantidade NUMERIC(14,2) DEFAULT 0, dados JSONB DEFAULT '{}'); CREATE INDEX IF NOT EXISTS idx_estoque_importacao ON estoque(importacao_id); ALTER TABLE estoque DISABLE ROW LEVEL SECURITY;` },
        { nome: 'importacoes_op',       sql: `CREATE TABLE IF NOT EXISTS importacoes_op (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_arquivo TEXT NOT NULL, usuario_id UUID REFERENCES usuarios(id), total_linhas INTEGER DEFAULT 0, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE importacoes_op DISABLE ROW LEVEL SECURITY;` },
        { nome: 'dados_op',             sql: `CREATE TABLE IF NOT EXISTS dados_op (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), importacao_id UUID REFERENCES importacoes_op(id) ON DELETE CASCADE, dados JSONB DEFAULT '{}'); CREATE INDEX IF NOT EXISTS idx_dados_op_imp ON dados_op(importacao_id); ALTER TABLE dados_op DISABLE ROW LEVEL SECURITY;` },
        { nome: 'importacoes_costura',  sql: `CREATE TABLE IF NOT EXISTS importacoes_costura (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_arquivo TEXT NOT NULL, usuario_id UUID REFERENCES usuarios(id), total_linhas INTEGER DEFAULT 0, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE importacoes_costura DISABLE ROW LEVEL SECURITY;` },
        { nome: 'dados_costura',        sql: `CREATE TABLE IF NOT EXISTS dados_costura (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), importacao_id UUID REFERENCES importacoes_costura(id) ON DELETE CASCADE, dados JSONB DEFAULT '{}'); CREATE INDEX IF NOT EXISTS idx_dados_costura_imp ON dados_costura(importacao_id); ALTER TABLE dados_costura DISABLE ROW LEVEL SECURITY;` },
        { nome: 'importacoes_cliente',  sql: `CREATE TABLE IF NOT EXISTS importacoes_cliente (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_arquivo TEXT NOT NULL, usuario_id UUID REFERENCES usuarios(id), total_linhas INTEGER DEFAULT 0, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE importacoes_cliente DISABLE ROW LEVEL SECURITY;` },
        { nome: 'dados_cliente',        sql: `CREATE TABLE IF NOT EXISTS dados_cliente (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), importacao_id UUID REFERENCES importacoes_cliente(id) ON DELETE CASCADE, dados JSONB DEFAULT '{}'); CREATE INDEX IF NOT EXISTS idx_dados_cliente_imp ON dados_cliente(importacao_id); ALTER TABLE dados_cliente DISABLE ROW LEVEL SECURITY;` },
        { nome: 'importacoes_banco',    sql: `CREATE TABLE IF NOT EXISTS importacoes_banco (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_arquivo TEXT NOT NULL, usuario_id UUID REFERENCES usuarios(id), total_linhas INTEGER DEFAULT 0, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE importacoes_banco DISABLE ROW LEVEL SECURITY;` },
        { nome: 'dados_banco',          sql: `CREATE TABLE IF NOT EXISTS dados_banco (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), importacao_id UUID REFERENCES importacoes_banco(id) ON DELETE CASCADE, dados JSONB DEFAULT '{}'); CREATE INDEX IF NOT EXISTS idx_dados_banco_imp ON dados_banco(importacao_id); ALTER TABLE dados_banco DISABLE ROW LEVEL SECURITY;` },
        { nome: 'importacoes_calendario', sql: `CREATE TABLE IF NOT EXISTS importacoes_calendario (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_arquivo TEXT NOT NULL, usuario_id UUID REFERENCES usuarios(id), total_linhas INTEGER DEFAULT 0, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE importacoes_calendario DISABLE ROW LEVEL SECURITY;` },
        { nome: 'dados_calendario',     sql: `CREATE TABLE IF NOT EXISTS dados_calendario (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), importacao_id UUID REFERENCES importacoes_calendario(id) ON DELETE CASCADE, dados JSONB DEFAULT '{}'); CREATE INDEX IF NOT EXISTS idx_dados_calendario_imp ON dados_calendario(importacao_id); ALTER TABLE dados_calendario DISABLE ROW LEVEL SECURITY;` },
        { nome: 'importacoes_capacidade', sql: `CREATE TABLE IF NOT EXISTS importacoes_capacidade (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_arquivo TEXT NOT NULL, usuario_id UUID REFERENCES usuarios(id), total_linhas INTEGER DEFAULT 0, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE importacoes_capacidade DISABLE ROW LEVEL SECURITY;` },
        { nome: 'dados_capacidade',     sql: `CREATE TABLE IF NOT EXISTS dados_capacidade (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), importacao_id UUID REFERENCES importacoes_capacidade(id) ON DELETE CASCADE, dados JSONB DEFAULT '{}'); CREATE INDEX IF NOT EXISTS idx_dados_capacidade_imp ON dados_capacidade(importacao_id); ALTER TABLE dados_capacidade DISABLE ROW LEVEL SECURITY;` },
        { nome: 'feriados',             sql: `CREATE TABLE IF NOT EXISTS feriados (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), data DATE NOT NULL, nome TEXT NOT NULL, tipo TEXT DEFAULT 'nacional', criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE feriados DISABLE ROW LEVEL SECURITY;` },
        { nome: 'turnos',               sql: `CREATE TABLE IF NOT EXISTS turnos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome TEXT NOT NULL, inicio TIME, fim TIME, dias TEXT[] DEFAULT '{}', processo TEXT, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE turnos DISABLE ROW LEVEL SECURITY;` },
        { nome: 'processos_config',     sql: `CREATE TABLE IF NOT EXISTS processos_config (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome TEXT NOT NULL, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE processos_config DISABLE ROW LEVEL SECURITY;` },
        { nome: 'maquinas',             sql: `CREATE TABLE IF NOT EXISTS maquinas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), processo_id UUID REFERENCES processos_config(id) ON DELETE CASCADE, id_maquina TEXT, modelo TEXT, oee NUMERIC(5,2), status TEXT, n_pessoas INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE maquinas DISABLE ROW LEVEL SECURITY;` },
        { nome: 'soep_acoes',           sql: `CREATE TABLE IF NOT EXISTS soep_acoes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), descricao TEXT NOT NULL, responsavel TEXT, prazo DATE, status TEXT DEFAULT 'aberta', modulo TEXT, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE soep_acoes DISABLE ROW LEVEL SECURITY;` },
    ];

    const faltando = [];
    for (const t of TABELAS) {
        const { error } = await supabase.from(t.nome).select('id').limit(1);
        if (error && error.code === '42P01') faltando.push(t);
    }

    const todasOk = faltando.length === 0;
    const sqlCompleto = faltando.map(t => t.sql).join('\n\n');

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>SIN1 — Setup</title>
<style>
  body{background:#0D1117;color:#E6EDF3;font-family:Inter,sans-serif;padding:32px;max-width:900px;margin:0 auto;}
  h1{color:#26c6da;margin-bottom:4px;}p{color:#8b949e;}
  .ok{background:#0d2a1a;border:1px solid #3fb95044;border-radius:8px;padding:16px 20px;color:#3fb950;margin:16px 0;}
  .warn{background:#2a1a0d;border:1px solid #f06292aa;border-radius:8px;padding:16px 20px;margin:16px 0;}
  .warn h3{color:#f06292;margin:0 0 8px;}
  ul{margin:8px 0;padding-left:20px;color:#ffab76;}
  textarea{width:100%;height:340px;background:#161B22;border:1px solid rgba(255,255,255,0.1);border-radius:8px;
    color:#E6EDF3;font-family:monospace;font-size:0.82rem;padding:14px;box-sizing:border-box;resize:vertical;}
  button{margin-top:10px;padding:10px 24px;background:#26c6da;color:#0D1117;border:none;border-radius:6px;
    font-size:0.9rem;font-weight:700;cursor:pointer;}
  button:hover{background:#00acc1;}
  .step{background:#161B22;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px 18px;margin:8px 0;font-size:0.87rem;color:#8b949e;}
  .step b{color:#E6EDF3;}
</style></head><body>
<h1>SIN1 — Setup do Banco de Dados</h1>
<p>Verificação das tabelas necessárias no Supabase.</p>
${todasOk
    ? `<div class="ok">✅ Todas as ${TABELAS.length} tabelas estão criadas e acessíveis. Nenhuma ação necessária.</div>`
    : `<div class="warn">
    <h3>⚠️ ${faltando.length} tabela${faltando.length > 1 ? 's' : ''} faltando</h3>
    <ul>${faltando.map(t => `<li>${t.nome}</li>`).join('')}</ul>
  </div>
  <h3 style="margin-bottom:8px;">Como corrigir — copie e execute no Supabase SQL Editor:</h3>
  <div class="step">1. Acesse <b>supabase.com/dashboard</b> → seu projeto → <b>SQL Editor</b> → <b>New query</b></div>
  <div class="step">2. Cole o SQL abaixo e clique em <b>Run</b></div>
  <div class="step">3. Recarregue esta página para confirmar que ficou tudo OK</div>
  <textarea id="sql">${sqlCompleto}</textarea>
  <button onclick="navigator.clipboard.writeText(document.getElementById('sql').value).then(()=>this.textContent='✓ Copiado!')">Copiar SQL</button>`
}
</body></html>`);
});

// ── DELETE /api/importacoes/:id (admin) ───────────────────────
app.delete('/api/importacoes/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase
        .from('importacoes').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: 'Erro ao deletar importação' });
    res.json({ ok: true });
});

// ── Rota de emergência — acesso direto sem depender do JS ────────
app.get('/emergencia', (_req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>SIN1 — Acesso de Emergência</title>
    <style>body{background:#0D1117;color:#E6EDF3;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
    .box{background:#161B22;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:40px;width:340px}
    h2{margin:0 0 24px;font-size:1.3rem}input{width:100%;padding:10px;background:#0D1117;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#E6EDF3;font-size:0.9rem;margin-bottom:12px;box-sizing:border-box}
    button{width:100%;padding:12px;background:#2F81F7;color:white;border:none;border-radius:6px;font-size:0.9rem;cursor:pointer}
    #msg{margin-top:12px;font-size:0.8rem;color:#F85149}</style></head>
    <body><div class="box"><h2>SIN1 — Emergência</h2>
    <form id="f"><input type="email" id="e" placeholder="e-mail" required>
    <input type="password" id="s" placeholder="senha" required>
    <button type="submit">Entrar</button></form>
    <div id="msg"></div></div>
    <script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:document.getElementById('e').value,senha:document.getElementById('s').value})});
    const d=await r.json();if(r.ok){localStorage.setItem('sin1_token',d.token);
    localStorage.setItem('sin1_user',JSON.stringify(d.usuario));window.location='/';}
    else document.getElementById('msg').textContent=d.erro||'Erro';}</script></body></html>`);
});

// ── Fallback para SPA ─────────────────────────────────────────
app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n🚀 Servidor SIN1 rodando em: http://localhost:${PORT}`);
    console.log(`📡 Banco: Supabase (${process.env.SUPABASE_URL})\n`);

    // Auto-ping a cada 10min para manter Render ativo (evita sleep no plano gratuito)
    const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    setInterval(() => {
        fetch(`${selfUrl}/api/ping`)
            .then(() => console.log(`[keep-alive] ping OK`))
            .catch(e => console.log(`[keep-alive] ping falhou: ${e.message}`));
    }, 10 * 60 * 1000);
});
