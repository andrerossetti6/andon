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

// Escrita no MES: bloqueia perfil somente-leitura (viewer). Operador/admin podem.
function mfEscrita(req, res, next) {
    if (req.usuario?.perfil === 'viewer') return res.status(403).json({ erro: 'Seu perfil é somente leitura.' });
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

        const { data: rows, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email.toLowerCase().trim())
            .eq('ativo', true)
            .limit(1);
        const usuario = rows?.[0] ?? null;

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

// ── S&OP — SNAPSHOT DE PREVISÃO (histórico para acurácia) ────
app.get('/api/soep-snapshot', auth, async (_req, res) => {
    const { data, error } = await supabase.from('soep_snapshot').select('mes,codigo,qty_prevista,criado_em').order('criado_em', { ascending: false });
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/soep-snapshot/bulk', auth, async (req, res) => {
    const { mes, items } = req.body;
    if (!mes || !Array.isArray(items) || !items.length) return res.status(400).json({ erro: 'mes e items obrigatórios' });
    // Remove snapshot anterior do mesmo mês e recria
    await supabase.from('soep_snapshot').delete().eq('mes', mes);
    const rows = items.map(i => ({ mes, codigo: String(i.codigo).toUpperCase(), qty_prevista: i.qty||0, usuario_id: req.usuario.id }));
    const { error } = await supabase.from('soep_snapshot').insert(rows);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, total: rows.length });
});
app.delete('/api/soep-snapshot/:mes', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('soep_snapshot').delete().eq('mes', req.params.mes);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── S&OP — PLANO DE PRODUÇÃO (persiste no banco) ─────────────
app.get('/api/soep-plano', auth, async (_req, res) => {
    const { data, error } = await supabase.from('soep_plano').select('mes,codigo,quantidade');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/soep-plano/bulk', auth, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.json({ ok: true });
    const rows = items.map(i => ({ mes: i.mes, codigo: String(i.codigo).toUpperCase(), quantidade: i.quantidade||0, usuario_id: req.usuario.id }));
    const { error } = await supabase.from('soep_plano').upsert(rows, { onConflict: 'mes,codigo' });
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});
app.delete('/api/soep-plano/:mes', auth, async (req, res) => {
    const { error } = await supabase.from('soep_plano').delete().eq('mes', req.params.mes);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── S&OP — VERSÕES CONGELADAS DO PLANO ───────────────────────
// Congela uma cópia do plano salvo (soep_plano) para comparação futura
app.post('/api/plano-versao/congelar', auth, async (req, res) => {
    const { label } = req.body || {};
    const { data: plano, error: e1 } = await supabase.from('soep_plano').select('mes,codigo,quantidade');
    if (e1) return res.status(500).json({ erro: e1.message });
    const comQtd = (plano || []).filter(p => (p.quantidade || 0) > 0);
    if (!comQtd.length) return res.status(400).json({ erro: 'Plano vazio — salve o plano antes de congelar.' });
    const versao = new Date().toISOString();
    const rows = comQtd.map(p => ({ versao, label: label || null, mes: p.mes, codigo: p.codigo, quantidade: p.quantidade, usuario_id: req.usuario.id }));
    const { error } = await supabase.from('plano_versao').insert(rows);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, versao, total: rows.length });
});
app.get('/api/plano-versao/lista', auth, async (_req, res) => {
    const { data, error } = await supabase.from('plano_versao').select('versao,label,criado_em').order('criado_em', { ascending: false });
    if (error) return res.status(500).json({ erro: error.message });
    const vistos = new Map();
    (data || []).forEach(r => {
        if (!vistos.has(r.versao)) vistos.set(r.versao, { versao: r.versao, label: r.label, criado_em: r.criado_em, total: 0 });
        vistos.get(r.versao).total++;
    });
    res.json([...vistos.values()]);
});
app.get('/api/plano-versao', auth, async (req, res) => {
    const { versao } = req.query;
    if (!versao) return res.status(400).json({ erro: 'versao obrigatória' });
    const { data, error } = await supabase.from('plano_versao').select('mes,codigo,quantidade').eq('versao', versao);
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.delete('/api/plano-versao/:versao', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('plano_versao').delete().eq('versao', req.params.versao);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── CAPACIDADE POR PROCESSO — fonte única (substitui localStorage por navegador) ──
app.get('/api/capacidade-config', auth, async (_req, res) => {
    const { data, error } = await supabase.from('capacidade_config').select('processo,maquinas,horas_dia,oee');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/capacidade-config/bulk', auth, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.json({ ok: true });
    const rows = items.map(i => ({
        processo: String(i.processo), maquinas: Number(i.maquinas) || 1,
        horas_dia: Number(i.horas_dia) || 8, oee: Number(i.oee) || 100,
        atualizado_em: new Date().toISOString(),
    }));
    const { error } = await supabase.from('capacidade_config').upsert(rows, { onConflict: 'processo' });
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── S&OP — ESTOQUE MÍNIMO POR SKU ────────────────────────────
app.get('/api/estoque-minimo', auth, async (_req, res) => {
    const { data, error } = await supabase.from('estoque_minimo').select('codigo,quantidade');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/estoque-minimo/bulk', auth, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.json({ ok: true });
    const rows = items.map(i => ({ codigo: String(i.codigo).toUpperCase(), quantidade: i.quantidade||0 }));
    const { error } = await supabase.from('estoque_minimo').upsert(rows, { onConflict: 'codigo' });
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});
app.delete('/api/estoque-minimo/:codigo', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('estoque_minimo').delete().eq('codigo', req.params.codigo.toUpperCase());
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── APS — DATAS DE ENTREGA POR SKU ───────────────────────────
app.get('/api/op-datas', auth, async (_req, res) => {
    const { data, error } = await supabase.from('op_datas').select('*').order('data_entrega', { ascending: true });
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/op-datas/bulk', auth, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ erro: 'items obrigatório' });
    const rows = items.map(i => ({ nop: i.nop||null, codigo: String(i.codigo).toUpperCase(), data_entrega: i.data_entrega||null, cpv: i.cpv||0, usuario_id: req.usuario.id }));
    const { error } = await supabase.from('op_datas').upsert(rows, { onConflict: 'codigo' });
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, total: rows.length });
});
app.delete('/api/op-datas/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('op_datas').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── APS — MATRIZ DE SETUP/CHANGEOVER ─────────────────────────
app.get('/api/setup-matrix', auth, async (_req, res) => {
    const { data, error } = await supabase.from('setup_matrix').select('*').order('processo').order('familia_de');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/setup-matrix/bulk', auth, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ erro: 'items obrigatório' });
    // Backup antes do delete: se o insert falhar, restaura — evita perder a matriz inteira
    const { data: backup } = await supabase.from('setup_matrix').select('processo,familia_de,familia_para,minutos');
    await supabase.from('setup_matrix').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const positivos = items.filter(i => (i.minutos||0) > 0);
    if (positivos.length) {
        const { error } = await supabase.from('setup_matrix').insert(
            positivos.map(i => ({ processo: i.processo, familia_de: i.familia_de, familia_para: i.familia_para, minutos: Math.round(i.minutos)||0 }))
        );
        if (error) {
            if (backup?.length) await supabase.from('setup_matrix').insert(backup);
            return res.status(500).json({ erro: error.message });
        }
    }
    res.json({ ok: true });
});

// ── APS — CENÁRIOS DE SIMULAÇÃO ───────────────────────────────
app.get('/api/timeline-cenario', auth, async (_req, res) => {
    const { data, error } = await supabase.from('timeline_cenario').select('id,nome,config,resultado,criado_em').order('criado_em', { ascending: false }).limit(20);
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/timeline-cenario', auth, async (req, res) => {
    const { nome, config, resultado } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome obrigatório' });
    const { data, error } = await supabase.from('timeline_cenario').insert({ nome, config: config||{}, resultado: resultado||{}, usuario_id: req.usuario.id }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, cenario: data });
});
app.put('/api/timeline-cenario/:id', auth, async (req, res) => {
    const { nome } = req.body;
    const { error } = await supabase.from('timeline_cenario').update({ nome }).eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});
app.delete('/api/timeline-cenario/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('timeline_cenario').delete().eq('id', req.params.id);
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
    // Remove feriados do mesmo ano antes de reinserir (evita duplicatas)
    const ano = rows[0]?.data?.slice(0, 4);
    if (ano) {
        await supabase.from('feriados').delete()
            .gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`);
    }
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
// Normaliza resposta: suporta schema antigo (dias) e novo (dias_semana + intervalo_min)
function normalizarTurno(t) {
    return { ...t, dias_semana: t.dias_semana || t.dias || [], intervalo_min: t.intervalo_min || 0 };
}
// Tenta inserir/atualizar com schema novo; se a coluna não existir, usa schema antigo (dias)
async function salvarTurno(op, id, payload) {
    const { processo, nome, inicio, fim, intervalo_min, dias_semana } = payload;
    const novoSchema = { processo: processo || '', nome, inicio, fim,
        intervalo_min: Number(intervalo_min) || 0, dias_semana: dias_semana || [] };
    const antigoSchema = { processo: processo || '', nome, inicio, fim, dias: dias_semana || [] };
    let result;
    if (op === 'insert') {
        result = await supabase.from('turnos').insert(novoSchema).select().single();
        if (result.error?.message?.includes('dias_semana') || result.error?.message?.includes('intervalo_min')) {
            result = await supabase.from('turnos').insert(antigoSchema).select().single();
        }
    } else {
        result = await supabase.from('turnos').update(novoSchema).eq('id', id).select().single();
        if (result.error?.message?.includes('dias_semana') || result.error?.message?.includes('intervalo_min')) {
            result = await supabase.from('turnos').update(antigoSchema).eq('id', id).select().single();
        }
    }
    return result;
}

app.get('/api/turnos', auth, async (_req, res) => {
    const { data, error } = await supabase.from('turnos').select('*').order('nome');
    if (error) return res.status(500).json({ erro: error.message });
    res.json((data || []).map(normalizarTurno));
});
app.post('/api/turnos', auth, async (req, res) => {
    const { processo, nome, inicio, fim, intervalo_min, dias_semana } = req.body;
    if (!nome || !inicio || !fim) return res.status(400).json({ erro: 'Nome, início e fim obrigatórios' });
    const { data, error } = await salvarTurno('insert', null, { processo, nome, inicio, fim, intervalo_min, dias_semana });
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, turno: normalizarTurno(data) });
});
app.put('/api/turnos/:id', auth, async (req, res) => {
    const { processo, nome, inicio, fim, intervalo_min, dias_semana } = req.body;
    const { data, error } = await salvarTurno('update', req.params.id, { processo, nome, inicio, fim, intervalo_min, dias_semana });
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, data: normalizarTurno(data) });
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
// Retorna o SQL de migração para corrigir a tabela turnos (schema antigo → novo)
app.get('/api/migrar-turnos-sql', auth, async (_req, res) => {
    res.json({
        sql: `-- Execute no SQL Editor do Supabase (uma única vez)\nALTER TABLE turnos ADD COLUMN IF NOT EXISTS dias_semana TEXT[] DEFAULT '{}';\nALTER TABLE turnos ADD COLUMN IF NOT EXISTS intervalo_min INTEGER DEFAULT 0;\nUPDATE turnos SET dias_semana = dias WHERE dias_semana IS NULL OR dias_semana = '{}'::text[];`,
        instrucao: 'Cole no Supabase > SQL Editor e execute.'
    });
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

// ── MES — APONTAMENTOS ──────────────────────────────────────────
app.get('/api/mes/apontamentos', auth, async (req, res) => {
    let q = supabase.from('apontamentos')
        .select('*, paradas_mes(id,tipo,motivo,inicio,fim,duracao_min)')
        .order('inicio', { ascending: false });
    if (req.query.data_inicio) q = q.gte('inicio', req.query.data_inicio);
    if (req.query.data_fim)    q = q.lte('inicio', req.query.data_fim + 'T23:59:59');
    if (req.query.processo)    q = q.eq('processo', req.query.processo);
    if (req.query.status)      q = q.eq('status', req.query.status);
    const { data, error } = await q.limit(500);
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});

app.post('/api/mes/apontamentos', auth, async (req, res) => {
    const { op_numero, cod, descricao, processo, operador, turno, maquina, qtd_planejada } = req.body;
    if (!cod || !processo) return res.status(400).json({ erro: 'Código e processo obrigatórios' });
    const { data, error } = await supabase.from('apontamentos')
        .insert({ op_numero: op_numero || null, cod: String(cod).toUpperCase(), descricao: descricao || null,
            processo, operador: operador || null, turno: turno || null, maquina: maquina || null,
            qtd_planejada: Number(qtd_planejada) || 0, qtd_produzida: 0, qtd_refugo: 0,
            status: 'em_andamento', usuario_id: req.usuario.id })
        .select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, apontamento: data });
});

app.put('/api/mes/apontamentos/:id', auth, async (req, res) => {
    const updates = {};
    ['fim','qtd_produzida','qtd_refugo','status','obs','operador','maquina'].forEach(f => {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    if (updates.status === 'finalizado' && !updates.fim) updates.fim = new Date().toISOString();
    const { data, error } = await supabase.from('apontamentos').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, apontamento: data });
});

app.delete('/api/mes/apontamentos/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('apontamentos').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

// ── MES — PARADAS ────────────────────────────────────────────────
app.post('/api/mes/paradas', auth, async (req, res) => {
    const { apontamento_id, tipo, motivo } = req.body;
    if (!apontamento_id || !motivo) return res.status(400).json({ erro: 'apontamento_id e motivo obrigatórios' });
    await supabase.from('apontamentos').update({ status: 'parado' }).eq('id', apontamento_id);
    const { data, error } = await supabase.from('paradas_mes')
        .insert({ apontamento_id, tipo: tipo || 'nao_planejada', motivo, inicio: new Date().toISOString() })
        .select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, parada: data });
});

app.put('/api/mes/paradas/:id', auth, async (req, res) => {
    const fimTs = new Date().toISOString();
    const { data: par } = await supabase.from('paradas_mes').select('inicio,apontamento_id').eq('id', req.params.id).single();
    const duracao_min = par ? Math.max(1, Math.round((new Date(fimTs) - new Date(par.inicio)) / 60000)) : 1;
    const { data, error } = await supabase.from('paradas_mes').update({ fim: fimTs, duracao_min }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    if (par?.apontamento_id) await supabase.from('apontamentos').update({ status: 'em_andamento' }).eq('id', par.apontamento_id);
    res.json({ ok: true, parada: data });
});

// ── MES — WIP ATUAL ──────────────────────────────────────────────
app.get('/api/mes/wip', auth, async (_req, res) => {
    const { data, error } = await supabase.from('apontamentos')
        .select('id,op_numero,cod,descricao,processo,operador,turno,maquina,inicio,status,qtd_produzida,qtd_planejada,qtd_refugo,paradas_mes(id,tipo,motivo,inicio,fim,duracao_min)')
        .in('status', ['em_andamento', 'parado'])
        .order('processo').order('inicio');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});

// ── MES — OEE REAL ──────────────────────────────────────────────
app.get('/api/mes/oee', auth, async (req, res) => {
    const dataIni = req.query.data_inicio || new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10);
    const dataFim = req.query.data_fim    || new Date().toISOString().slice(0,10);
    const { data: apts } = await supabase.from('apontamentos')
        .select('processo,inicio,fim,qtd_produzida,qtd_refugo,paradas_mes(duracao_min,motivo,tipo)')
        .gte('inicio', dataIni)
        .lte('inicio', dataFim + 'T23:59:59')
        .eq('status', 'finalizado');
    if (!apts?.length) return res.json({ oee:0, disponibilidade:0, qualidade:0, processos:{}, motivos:[] });

    const byProc = {};
    const motivosMap = {};
    apts.forEach(ap => {
        const proc = ap.processo || '—';
        if (!byProc[proc]) byProc[proc] = { tempo_total:0, tempo_parada:0, qtd_prod:0, qtd_ref:0, count:0 };
        const p = byProc[proc];
        if (ap.inicio && ap.fim) p.tempo_total += (new Date(ap.fim) - new Date(ap.inicio)) / 60000;
        (ap.paradas_mes||[]).forEach(par => {
            const d = par.duracao_min || 0;
            p.tempo_parada += d;
            if (par.motivo) motivosMap[par.motivo] = (motivosMap[par.motivo]||0) + d;
        });
        p.qtd_prod += ap.qtd_produzida || 0;
        p.qtd_ref  += ap.qtd_refugo    || 0;
        p.count++;
    });

    const processosOEE = {};
    let sumD=0, sumQ=0, n=0;
    Object.entries(byProc).forEach(([proc, p]) => {
        const D = p.tempo_total>0 ? Math.min(1, (p.tempo_total - p.tempo_parada) / p.tempo_total) : 0;
        const Q = p.qtd_prod>0 ? Math.max(0, (p.qtd_prod - p.qtd_ref) / p.qtd_prod) : 1;
        processosOEE[proc] = { D:Math.round(D*100), Q:Math.round(Q*100),
            qtd_prod:p.qtd_prod, qtd_ref:p.qtd_ref,
            tempo_total:Math.round(p.tempo_total), tempo_parada:Math.round(p.tempo_parada), count:p.count };
        sumD+=D; sumQ+=Q; n++;
    });

    const D = n>0 ? sumD/n : 0;
    const Q = n>0 ? sumQ/n : 0;
    const motivos = Object.entries(motivosMap).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([motivo,min])=>({motivo,min}));
    res.json({ oee:Math.round(D*Q*100), disponibilidade:Math.round(D*100), qualidade:Math.round(Q*100), processos:processosOEE, motivos });
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
        { nome: 'turnos',               sql: `CREATE TABLE IF NOT EXISTS turnos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome TEXT NOT NULL, inicio TIME, fim TIME, dias_semana TEXT[] DEFAULT '{}', intervalo_min INTEGER DEFAULT 0, processo TEXT, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE turnos DISABLE ROW LEVEL SECURITY; ALTER TABLE turnos ADD COLUMN IF NOT EXISTS dias_semana TEXT[] DEFAULT '{}'; ALTER TABLE turnos ADD COLUMN IF NOT EXISTS intervalo_min INTEGER DEFAULT 0;` },
        { nome: 'processos_config',     sql: `CREATE TABLE IF NOT EXISTS processos_config (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome TEXT NOT NULL, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE processos_config DISABLE ROW LEVEL SECURITY;` },
        { nome: 'maquinas',             sql: `CREATE TABLE IF NOT EXISTS maquinas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), processo_id UUID REFERENCES processos_config(id) ON DELETE CASCADE, id_maquina TEXT, modelo TEXT, oee NUMERIC(5,2), status TEXT, n_pessoas INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE maquinas DISABLE ROW LEVEL SECURITY;` },
        { nome: 'soep_acoes',           sql: `CREATE TABLE IF NOT EXISTS soep_acoes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), descricao TEXT NOT NULL, responsavel TEXT, prazo DATE, status TEXT DEFAULT 'aberta', modulo TEXT, criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE soep_acoes DISABLE ROW LEVEL SECURITY;` },
        { nome: 'soep_plano',           sql: `CREATE TABLE IF NOT EXISTS soep_plano (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), mes TEXT NOT NULL, codigo TEXT NOT NULL, quantidade INTEGER DEFAULT 0, usuario_id UUID REFERENCES usuarios(id), atualizado_em TIMESTAMPTZ DEFAULT NOW(), UNIQUE(mes,codigo)); ALTER TABLE soep_plano DISABLE ROW LEVEL SECURITY;` },
        { nome: 'estoque_minimo',       sql: `CREATE TABLE IF NOT EXISTS estoque_minimo (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), codigo TEXT NOT NULL UNIQUE, quantidade INTEGER DEFAULT 0, atualizado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE estoque_minimo DISABLE ROW LEVEL SECURITY;` },
        { nome: 'soep_snapshot',        sql: `CREATE TABLE IF NOT EXISTS soep_snapshot (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), mes TEXT NOT NULL, codigo TEXT NOT NULL, qty_prevista INTEGER DEFAULT 0, usuario_id UUID REFERENCES usuarios(id), criado_em TIMESTAMPTZ DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_soep_snap_mes ON soep_snapshot(mes,codigo); ALTER TABLE soep_snapshot DISABLE ROW LEVEL SECURITY;` },
        { nome: 'plano_versao',         sql: `CREATE TABLE IF NOT EXISTS plano_versao (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), versao TEXT NOT NULL, label TEXT, mes TEXT NOT NULL, codigo TEXT NOT NULL, quantidade INTEGER DEFAULT 0, usuario_id UUID REFERENCES usuarios(id), criado_em TIMESTAMPTZ DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_plano_versao ON plano_versao(versao); ALTER TABLE plano_versao DISABLE ROW LEVEL SECURITY;` },
        { nome: 'capacidade_config',    sql: `CREATE TABLE IF NOT EXISTS capacidade_config (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), processo TEXT NOT NULL UNIQUE, maquinas NUMERIC(8,2) DEFAULT 1, horas_dia NUMERIC(5,2) DEFAULT 8, oee NUMERIC(5,2) DEFAULT 100, atualizado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE capacidade_config DISABLE ROW LEVEL SECURITY;` },
        { nome: 'op_datas',             sql: `CREATE TABLE IF NOT EXISTS op_datas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nop TEXT, codigo TEXT NOT NULL, data_entrega DATE, cpv NUMERIC(14,2) DEFAULT 0, usuario_id UUID REFERENCES usuarios(id), atualizado_em TIMESTAMPTZ DEFAULT NOW(), UNIQUE(codigo)); ALTER TABLE op_datas DISABLE ROW LEVEL SECURITY;` },
        { nome: 'setup_matrix',         sql: `CREATE TABLE IF NOT EXISTS setup_matrix (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), processo TEXT NOT NULL, familia_de TEXT NOT NULL, familia_para TEXT NOT NULL, minutos INTEGER DEFAULT 0); ALTER TABLE setup_matrix DISABLE ROW LEVEL SECURITY;` },
        { nome: 'timeline_cenario',     sql: `CREATE TABLE IF NOT EXISTS timeline_cenario (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome TEXT NOT NULL, config JSONB DEFAULT '{}', resultado JSONB DEFAULT '{}', usuario_id UUID REFERENCES usuarios(id), criado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE timeline_cenario DISABLE ROW LEVEL SECURITY;` },
        { nome: 'apontamentos',         sql: `CREATE TABLE IF NOT EXISTS apontamentos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), op_numero TEXT, cod TEXT NOT NULL, descricao TEXT, processo TEXT NOT NULL, operador TEXT, turno TEXT, maquina TEXT, inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(), fim TIMESTAMPTZ, qtd_planejada INTEGER DEFAULT 0, qtd_produzida INTEGER DEFAULT 0, qtd_refugo INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento','parado','finalizado')), obs TEXT, usuario_id UUID REFERENCES usuarios(id), criado_em TIMESTAMPTZ DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_apt_status ON apontamentos(status); CREATE INDEX IF NOT EXISTS idx_apt_inicio ON apontamentos(inicio); ALTER TABLE apontamentos DISABLE ROW LEVEL SECURITY;` },
        { nome: 'paradas_mes',          sql: `CREATE TABLE IF NOT EXISTS paradas_mes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), apontamento_id UUID NOT NULL REFERENCES apontamentos(id) ON DELETE CASCADE, tipo TEXT NOT NULL DEFAULT 'nao_planejada' CHECK (tipo IN ('planejada','nao_planejada','setup','qualidade')), motivo TEXT NOT NULL, inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(), fim TIMESTAMPTZ, duracao_min INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_paradas_apt ON paradas_mes(apontamento_id); ALTER TABLE paradas_mes DISABLE ROW LEVEL SECURITY;` },
    ];

    const faltando = [];
    for (const t of TABELAS) {
        const { error } = await supabase.from(t.nome).select('id').limit(1);
        // PGRST205 = PostgREST schema cache miss (table missing); 42P01 = PostgreSQL undefined_table
        if (error && (error.code === '42P01' || error.code === 'PGRST205' || String(error.code).startsWith('PGRST'))) {
            faltando.push(t);
        }
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

// ══════════════════════════════════════════════════════════════
// MES MALHA FORTE — API /api/mf/*  (sistema têxtil, tabelas singulares)
// ══════════════════════════════════════════════════════════════
const mfNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// ── Cadastros (leitura) ───────────────────────────────────────
async function mfLista(res, tabela, cols, orderCol) {
    let q = supabase.from(tabela).select(cols || '*');
    if (orderCol) q = q.order(orderCol);
    const { data, error } = await q;
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
}
app.get('/api/mf/produtos',  auth, (_q, res) => mfLista(res, 'produto', '*', 'codigo'));
app.get('/api/mf/maquinas',  auth, (_q, res) => mfLista(res, 'maquina', '*', 'codigo'));
app.get('/api/mf/operadores',auth, (_q, res) => mfLista(res, 'operador', '*', 'nome'));
app.get('/api/mf/turnos',    auth, (_q, res) => mfLista(res, 'turno', '*', 'codigo'));
app.get('/api/mf/motivos',   auth, (_q, res) => mfLista(res, 'motivo_parada', '*', 'descricao'));
app.get('/api/mf/defeitos',  auth, (_q, res) => mfLista(res, 'catalogo_defeito', '*', 'descricao'));

app.get('/api/mf/ops', auth, async (req, res) => {
    let q = supabase.from('ordem_producao').select('*, produto:produto_id(codigo,descricao,unidade_medida)').order('criado_em', { ascending: false });
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q.limit(500);
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});

// ── Cadastros (escrita genérica, admin) ───────────────────────
const MF_CADASTROS = { produto:'codigo', maquina:'codigo', operador:'matricula', turno:'codigo', motivo_parada:'codigo', catalogo_defeito:'codigo' };
app.post('/api/mf/cadastro/:tabela', auth, mfEscrita, async (req, res) => {
    const t = req.params.tabela;
    if (!MF_CADASTROS[t]) return res.status(400).json({ erro: 'Tabela inválida' });
    const { data, error } = await supabase.from(t).upsert(req.body, { onConflict: MF_CADASTROS[t] }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, registro: data });
});

// ── Ordem de produção ─────────────────────────────────────────
app.post('/api/mf/ops', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.numero || !b.produto_id || !b.qtd_planejada) return res.status(400).json({ erro: 'numero, produto_id e qtd_planejada obrigatórios' });
    const row = { numero: b.numero, produto_id: b.produto_id, qtd_planejada: b.qtd_planejada, unidade: b.unidade || 'kg',
        maquina_prevista_id: b.maquina_prevista_id || null, data_abertura: b.data_abertura || null, data_prevista: b.data_prevista || null,
        status: b.status || 'planejada', origem: b.origem || 'manual' };
    const { data, error } = await supabase.from('ordem_producao').upsert(row, { onConflict: 'numero' }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, op: data });
});

// ── Apontamento (sessão de trabalho) ──────────────────────────
app.get('/api/mf/apontamentos', auth, async (req, res) => {
    let q = supabase.from('apontamento')
        .select('*, op:op_id(numero), maquina:maquina_id(codigo,nome), operador:operador_id(nome), turno:turno_id(codigo), parada(*), nao_conformidade(*)')
        .order('datahora_inicio', { ascending: false });
    if (req.query.abertas === '1') q = q.is('datahora_fim', null);
    const { data, error } = await q.limit(200);
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});

app.post('/api/mf/apontamentos', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    for (const f of ['op_id','maquina_id','operador_id','turno_id']) if (!b[f]) return res.status(400).json({ erro: `${f} obrigatório` });
    const row = { op_id: b.op_id, maquina_id: b.maquina_id, operador_id: b.operador_id, turno_id: b.turno_id,
        datahora_inicio: b.datahora_inicio || new Date().toISOString(), unidade: b.unidade || 'kg',
        dispositivo_id: b.dispositivo_id || null, origem: b.origem || 'pwa',
        sincronizado_em: b.sincronizado_em || new Date().toISOString() };
    if (b.id) row.id = b.id;  // id gerado no cliente (fila offline) → upsert idempotente
    const { data, error } = await supabase.from('apontamento').upsert(row).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    // marca a OP como em produção
    await supabase.from('ordem_producao').update({ status: 'em_producao' }).eq('id', b.op_id).in('status', ['planejada','liberada']);
    res.json({ ok: true, apontamento: data });
});

app.put('/api/mf/apontamentos/:id', auth, mfEscrita, async (req, res) => {
    const updates = {};
    ['qtd_boa','qtd_refugo','qtd_retrabalho','datahora_fim','sincronizado_em'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (req.body.fechar && !updates.datahora_fim) updates.datahora_fim = new Date().toISOString();
    const { data, error } = await supabase.from('apontamento').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, apontamento: data });
});

// ── Parada ────────────────────────────────────────────────────
app.post('/api/mf/paradas', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.apontamento_id || !b.motivo_id) return res.status(400).json({ erro: 'apontamento_id e motivo_id obrigatórios' });
    const row = { apontamento_id: b.apontamento_id, motivo_id: b.motivo_id,
        datahora_inicio: b.datahora_inicio || new Date().toISOString(), datahora_fim: b.datahora_fim || null, observacao: b.observacao || null };
    if (b.id) row.id = b.id;
    const { data, error } = await supabase.from('parada').upsert(row).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, parada: data });
});
app.put('/api/mf/paradas/:id', auth, mfEscrita, async (req, res) => {
    const updates = {};
    ['datahora_fim','observacao'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (req.body.fechar && !updates.datahora_fim) updates.datahora_fim = new Date().toISOString();
    const { data, error } = await supabase.from('parada').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, parada: data });
});

// ── Não conformidade (congela severidade + avalia gatilhos de RNC) ──
async function mfAvaliarGatilhos(nc, defeito) {
    const { data: gatilhos } = await supabase.from('gatilho_rnc').select('*').eq('ativo', true);
    if (!gatilhos?.length) return false;
    const aplicaveis = gatilhos.filter(g =>
        (g.defeito_id && g.defeito_id === nc.defeito_id) ||
        (g.categoria && g.categoria === defeito.categoria) ||
        (!g.defeito_id && !g.categoria));
    for (const g of aplicaveis) {
        if (g.tipo === 'volume') {
            if (g.unidade_limiar === 'qtd' && Number(nc.qtd_afetada) >= Number(g.limiar)) return true;
            if (g.unidade_limiar === 'percentual') {
                const { data: ap } = await supabase.from('apontamento').select('op_id').eq('id', nc.apontamento_id).single();
                if (ap?.op_id) {
                    const { data: op } = await supabase.from('ordem_producao').select('qtd_planejada').eq('id', ap.op_id).single();
                    if (op?.qtd_planejada > 0 && (Number(nc.qtd_afetada) / Number(op.qtd_planejada) * 100) >= Number(g.limiar)) return true;
                }
            }
        } else if (g.tipo === 'recorrencia' && g.unidade_limiar === 'ocorrencias') {
            const desde = new Date(Date.now() - (Number(g.janela_horas) || 24) * 3600 * 1000).toISOString();
            const { count } = await supabase.from('nao_conformidade').select('id', { count: 'exact', head: true })
                .eq('defeito_id', nc.defeito_id).gte('datahora', desde);
            if ((count || 0) >= Number(g.limiar)) return true;
        }
    }
    return false;
}

app.get('/api/mf/ncs', auth, async (req, res) => {
    let q = supabase.from('nao_conformidade')
        .select('*, defeito:defeito_id(codigo,descricao,categoria), foto(id,url)')
        .order('datahora', { ascending: false });
    if (req.query.apontamento_id) q = q.eq('apontamento_id', req.query.apontamento_id);
    const { data, error } = await q.limit(300);
    if (error) return res.status(500).json({ erro: error.message });
    // assina as URLs das fotos (bucket privado)
    for (const nc of (data || [])) for (const f of (nc.foto || [])) f.url = await mfFotoUrl(f.url);
    res.json(data || []);
});

app.post('/api/mf/ncs', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.apontamento_id || !b.defeito_id || !b.qtd_afetada) return res.status(400).json({ erro: 'apontamento_id, defeito_id e qtd_afetada obrigatórios' });
    const { data: defeito, error: eDef } = await supabase.from('catalogo_defeito').select('*').eq('id', b.defeito_id).single();
    if (eDef || !defeito) return res.status(400).json({ erro: 'Defeito não encontrado no catálogo' });
    const sevAplicada = b.severidade_aplicada || defeito.severidade;
    const dispFinal   = b.disposicao || defeito.disposicao_padrao || 'segregar';
    // TRAVA DE QUALIDADE: defeito crítico (severidade 4) não pode ser liberado
    if (sevAplicada >= 4 && dispFinal === 'liberar')
        return res.status(422).json({ erro: 'Defeito crítico (severidade 4) não pode ser LIBERADO — escolha refugar, segregar ou retrabalhar.' });
    const nc = {
        apontamento_id: b.apontamento_id, defeito_id: b.defeito_id,
        qtd_afetada: b.qtd_afetada, unidade: b.unidade || 'kg',
        disposicao: dispFinal,
        severidade_aplicada: sevAplicada,  // congelada
        posicao: b.posicao || null, causa_preliminar: b.causa_preliminar || null,
        origem_legado: b.origem_legado || null, datahora: b.datahora || new Date().toISOString(),
    };
    const gera = await mfAvaliarGatilhos(nc, defeito).catch(() => false);
    nc.gera_rnc = gera;
    if (b.id) nc.id = b.id;  // id do cliente (fila offline)
    const { data, error } = await supabase.from('nao_conformidade').upsert(nc).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    // Loop de melhoria: gatilho disparou → abre RNC formal automaticamente (se ainda não houver)
    let rnc_id = null;
    if (gera) {
        try {
            const { data: ap } = await supabase.from('apontamento').select('maquina_id').eq('id', b.apontamento_id).single();
            const { data: existe } = await supabase.from('rnc').select('id').eq('nc_id', data.id).limit(1);
            if (!existe?.length) {
                const prio = defeito.severidade >= 4 ? 'critica' : defeito.severidade === 3 ? 'alta' : 'media';
                const { data: r } = await supabase.from('rnc').insert({ nc_id: data.id, defeito_id: b.defeito_id, maquina_id: ap?.maquina_id || null,
                    titulo: `RNC — ${defeito.descricao}`, descricao: `Gerada por gatilho. Qtd afetada: ${b.qtd_afetada}. ${b.causa_preliminar || ''}`.trim(),
                    prioridade: prio }).select('id').single();
                rnc_id = r?.id || null;
            }
        } catch { /* tabela rnc ausente ou erro — NC já foi salva, segue sem RNC */ }
    }
    res.json({ ok: true, nc: data, gera_rnc: gera, rnc_id });
});

// ── RNC / CAPA (loop de ação corretiva) ───────────────────────
app.get('/api/mf/rncs', auth, async (req, res) => {
    const resumo = await supabase.from('vw_rnc_resumo').select('*').single();
    if (resumo.error && /schema cache|does not exist/i.test(resumo.error.message || '')) return res.status(503).json({ erro: 'RNC ainda não criada. Rode mes_rnc.sql.' });
    let q = supabase.from('rnc').select('*, defeito:defeito_id(codigo,descricao), maquina:maquina_id(codigo), responsavel:responsavel_id(nome)').order('aberta_em', { ascending: false });
    if (req.query.status === 'abertas') q = q.not('status', 'in', '(fechada,cancelada)');
    else if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q.limit(200);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ resumo: resumo.data || {}, rncs: data || [] });
});
app.post('/api/mf/rncs', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.titulo) return res.status(400).json({ erro: 'titulo obrigatório' });
    const row = { titulo: b.titulo, descricao: b.descricao || null, defeito_id: b.defeito_id || null, maquina_id: b.maquina_id || null,
        nc_id: b.nc_id || null, prioridade: b.prioridade || 'media' };
    const { data, error } = await supabase.from('rnc').insert(row).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, rnc: data });
});
app.put('/api/mf/rncs/:id', auth, mfEscrita, async (req, res) => {
    const b = req.body || {}, upd = {};
    ['prioridade','responsavel_id','prazo','causa_raiz','metodo_analise','acao_corretiva','eficaz','verificacao_obs','status'].forEach(f => { if (b[f] !== undefined) upd[f] = b[f]; });
    // transições de estágio
    if (b.avancar === 'analise')     upd.status = 'em_analise';
    if (b.avancar === 'acao')      { upd.status = 'em_acao'; }
    if (b.avancar === 'verificacao') { upd.status = 'verificacao'; upd.acao_concluida_em = new Date().toISOString(); }
    if (b.avancar === 'fechar')    { upd.status = 'fechada'; upd.fechada_em = new Date().toISOString(); }
    if (b.avancar === 'cancelar')  { upd.status = 'cancelada'; upd.fechada_em = new Date().toISOString(); }
    const { data, error } = await supabase.from('rnc').update(upd).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, rnc: data });
});

// ── Foto da NC: sobe a imagem para o Supabase Storage (bucket mf-fotos) ──
const MF_BUCKET = 'mf-fotos';
// Bucket privado: guardamos o CAMINHO no Storage; a URL é assinada na leitura (expira em 1h)
async function mfFotoUrl(armazenado) {
    if (!armazenado || /^https?:|^data:/.test(armazenado)) return armazenado;  // legado/dataURL → como está
    const { data } = await supabase.storage.from(MF_BUCKET).createSignedUrl(armazenado, 3600);
    return data?.signedUrl || armazenado;
}
app.post('/api/mf/fotos', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.nc_id || !b.url) return res.status(400).json({ erro: 'nc_id e url obrigatórios' });
    let urlFinal = b.url, tamanho = b.tamanho_bytes || null;
    // data URL (base64) → upload ao Storage privado; guarda só o CAMINHO
    const m = /^data:(image\/\w+);base64,(.+)$/s.exec(b.url || '');
    if (m) {
        const mime = m[1], buffer = Buffer.from(m[2], 'base64');
        const ext = mime.split('/')[1].replace('jpeg', 'jpg');
        const nomeBase = b.id || Date.now();
        const caminho = `nc/${b.nc_id}/${nomeBase}.${ext}`;
        const { error: upErr } = await supabase.storage.from(MF_BUCKET).upload(caminho, buffer, { contentType: mime, upsert: true });
        if (upErr) return res.status(500).json({ erro: 'Falha no upload da foto: ' + upErr.message });
        urlFinal = caminho;  // caminho, não URL pública
        tamanho = buffer.length;
    }
    const row = { nc_id: b.nc_id, url: urlFinal, nome_arquivo: b.nome_arquivo || null,
        tamanho_bytes: tamanho, largura_px: b.largura_px || null, altura_px: b.altura_px || null,
        capturada_em: b.capturada_em || new Date().toISOString(), metadados: b.metadados || null };
    if (b.id) row.id = b.id;
    const { data, error } = await supabase.from('foto').upsert(row).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, foto: data });
});

// ══════════════════════════════════════════════════════════════
// IMPORTADOR DO LEGADO (ETL) — staging → normalização → carga
// ══════════════════════════════════════════════════════════════
const MF_DISPOSICOES = ['liberar','retrabalhar','refugar','segregar','reclassificar'];

// similaridade de string (Levenshtein normalizado 0..1)
function mfSimilar(a, b) {
    a = mfNorm(a); b = mfNorm(b);
    if (!a || !b) return 0; if (a === b) return 1;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return 1 - dp[m][n] / Math.max(m, n);
}
// parse de data BR (dd/mm/aaaa [hh:mm]) ou ISO
function mfParseData(s) {
    s = String(s || '').trim(); if (!s) return null;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) { const d = new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0)); return isNaN(d) ? null : d.toISOString(); }
    const d = new Date(s); return isNaN(d) ? null : d.toISOString();
}

// ETAPA 1-3: ingestão + validação + normalização (exato → fuzzy; resto fica 'novo' p/ agente)
app.post('/api/mf/importar', auth, mfEscrita, async (req, res) => {
    const { linhas, mapa } = req.body || {};
    if (!Array.isArray(linhas) || !linhas.length) return res.status(400).json({ erro: 'linhas[] obrigatório' });
    if (!mapa || !mapa.defeito_texto) return res.status(400).json({ erro: 'mapa.defeito_texto obrigatório (coluna do defeito)' });
    const lote_id = require('crypto').randomUUID();

    const { data: depara } = await supabase.from('de_para_defeito').select('termo_legado,defeito_id');
    const { data: defs }   = await supabase.from('catalogo_defeito').select('id,descricao');
    const mapaExato  = Object.fromEntries((depara || []).map(d => [d.termo_legado, d.defeito_id]));
    const deparaTerm = (depara || []).map(d => ({ termo: d.termo_legado, id: d.defeito_id }));
    const defsNorm   = (defs || []).map(d => ({ id: d.id, n: mfNorm(d.descricao) }));
    const get = (linha, campo) => mapa[campo] ? (linha[mapa[campo]] ?? '') : '';

    const vistas = new Set();
    const rows = linhas.map((linha, i) => {
        const c = {
            op_numero: String(get(linha,'op_numero')).trim(),
            maquina_nome: String(get(linha,'maquina_nome')).trim(),
            operador_nome: String(get(linha,'operador_nome')).trim(),
            turno: String(get(linha,'turno')).trim().toUpperCase(),
            datahora: get(linha,'datahora'),
            qtd_boa: get(linha,'qtd_boa'),
            defeito_texto: String(get(linha,'defeito_texto')).trim(),
            qtd_afetada: get(linha,'qtd_afetada'),
            disposicao: String(get(linha,'disposicao') || '').trim().toLowerCase(),
        };
        const erros = [];
        if (!c.op_numero)      erros.push('op_numero vazio');
        const dataISO = mfParseData(c.datahora);
        if (!dataISO)          erros.push('datahora inválida');
        if (!c.defeito_texto)  erros.push('defeito_texto vazio');
        const qtdAf = parseFloat(String(c.qtd_afetada).replace(',', '.'));
        if (!(qtdAf > 0))      erros.push('qtd_afetada inválida (>0)');
        if (!c.disposicao)     c.disposicao = 'refugar';
        else if (!MF_DISPOSICOES.includes(c.disposicao)) erros.push('disposicao inválida: ' + c.disposicao);

        // tradução do defeito
        let defeito_id = null, metodo = null, confianca = null;
        const termo = mfNorm(c.defeito_texto);
        if (mapaExato[termo]) { defeito_id = mapaExato[termo]; metodo = 'exato'; confianca = 1; }
        else if (termo) {
            let best = { score: 0, id: null };
            for (const d of defsNorm)   { const s = mfSimilar(termo, d.n);     if (s > best.score) best = { score: s, id: d.id }; }
            for (const t of deparaTerm) { const s = mfSimilar(termo, t.termo); if (s > best.score) best = { score: s, id: t.id }; }
            if (best.score >= 0.85) { defeito_id = best.id; metodo = 'fuzzy'; confianca = +best.score.toFixed(2); }
        }

        let status;
        if (erros.length)      status = 'rejeitado';
        else if (defeito_id)   status = 'valido';
        else                   status = 'novo';   // válido, mas defeito pendente de classificação (agente)

        // dedup dentro do lote: op + maquina + datahora + defeito/termo
        if (status !== 'rejeitado') {
            const chave = [c.op_numero, mfNorm(c.maquina_nome), dataISO, defeito_id || termo].join('|');
            if (vistas.has(chave)) { status = 'rejeitado'; erros.push('duplicado (no lote)'); }
            else vistas.add(chave);
        }

        c._data_iso = dataISO; c._qtd_af = qtdAf;
        return { lote_id, linha_origem: i + 1, linha_bruta: { ...linha, _campos: c }, defeito_id,
            metodo_traducao: metodo, confianca, status, erros: erros.length ? erros : null };
    });

    const { error } = await supabase.from('stg_importacao').insert(rows);
    if (error) return res.status(500).json({ erro: error.message });
    const cont = s => rows.filter(r => r.status === s).length;
    const termosPendentes = [...new Set(rows.filter(r => r.status === 'novo').map(r => r.linha_bruta._campos.defeito_texto))];
    res.json({ ok: true, lote_id, total: rows.length, valido: cont('valido'), novo: cont('novo'), rejeitado: cont('rejeitado'), termosPendentes });
});

// ETAPA 3 (camada 3): subagente classificador — termos 'novo' → catálogo via Claude
app.post('/api/mf/classificar', auth, mfEscrita, async (req, res) => {
    const { lote_id } = req.body || {};
    if (!lote_id) return res.status(400).json({ erro: 'lote_id obrigatório' });
    const { data: pend } = await supabase.from('stg_importacao').select('id,linha_bruta').eq('lote_id', lote_id).eq('status', 'novo');
    const termos = [...new Set((pend || []).map(r => r.linha_bruta?._campos?.defeito_texto).filter(Boolean))];
    if (!termos.length) return res.json({ ok: true, classificados: 0, msg: 'Nenhum termo pendente.' });

    const { data: defs } = await supabase.from('catalogo_defeito').select('codigo,descricao,categoria,etapa');
    const chave = process.env.ANTHROPIC_API_KEY;
    if (!chave) return res.json({ ok: true, classificados: 0, semChave: true, termos,
        msg: 'Configure ANTHROPIC_API_KEY no .env para classificação automática. Termos seguem em revisão manual.' });

    // chamada única ao modelo com a fila inteira
    const prompt = `Você é um especialista em defeitos de malharia têxtil. Receberá:
(A) catálogo de defeitos padronizado (JSON): ${JSON.stringify(defs)}
(B) descrições de defeito em texto livre de registros antigos: ${JSON.stringify(termos)}
Para cada item de (B), retorne o "codigo" de (A) que melhor corresponde, ou codigo=null se nenhum corresponder com clareza.
Responda APENAS em JSON, sem markdown: [{"termo":"...","codigo":"...","confianca":0.0}]`;
    let sugestoes = [];
    try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
        });
        const j = await r.json();
        if (!r.ok) return res.status(502).json({ erro: 'Anthropic: ' + (j?.error?.message || r.status) });
        const txt = (j.content || []).map(b => b.text || '').join('');
        sugestoes = JSON.parse(txt.replace(/```json|```/g, '').trim());
    } catch (e) { return res.status(502).json({ erro: 'Falha na classificação: ' + e.message }); }

    const { data: cat } = await supabase.from('catalogo_defeito').select('id,codigo');
    const idDe = Object.fromEntries((cat || []).map(d => [d.codigo, d.id]));
    let aplicados = 0, revisao = 0;
    for (const s of sugestoes) {
        const termoNorm = mfNorm(s.termo);
        const defId = s.codigo ? idDe[s.codigo] : null;
        if (defId && Number(s.confianca) >= 0.6) {
            await supabase.from('de_para_defeito').upsert({ termo_legado: termoNorm, defeito_id: defId, fonte: 'aprovado_agente' }, { onConflict: 'termo_legado' });
            // re-traduz linhas do lote com esse termo
            const alvo = (pend || []).filter(r => mfNorm(r.linha_bruta?._campos?.defeito_texto) === termoNorm).map(r => r.id);
            if (alvo.length) await supabase.from('stg_importacao').update({ defeito_id: defId, metodo_traducao: 'agente', confianca: Number(s.confianca), status: 'valido' }).in('id', alvo);
            aplicados += alvo.length;
        } else {
            const alvo = (pend || []).filter(r => mfNorm(r.linha_bruta?._campos?.defeito_texto) === termoNorm).map(r => r.id);
            if (alvo.length) await supabase.from('stg_importacao').update({ metodo_traducao: 'agente', confianca: Number(s.confianca) || 0, status: 'rejeitado', erros: ['agente: baixa confiança ou sem correspondência'] }).in('id', alvo);
            revisao += alvo.length;
        }
    }
    res.json({ ok: true, classificados: aplicados, paraRevisao: revisao, termos: termos.length });
});

// helpers find-or-create p/ a carga
async function mfAcharOuCriar(tabela, filtro, criar) {
    const q = supabase.from(tabela).select('id'); Object.entries(filtro).forEach(([k, v]) => q.ilike(k, v));
    const { data } = await q.limit(1);
    if (data?.[0]) return data[0].id;
    const { data: novo, error } = await supabase.from(tabela).insert(criar).select('id').single();
    if (error) throw new Error(`${tabela}: ${error.message}`);
    return novo.id;
}

// ETAPA 5: carga — move linhas 'valido' do staging para produção (apontamento + NC)
app.post('/api/mf/importar/:lote_id/carga', auth, mfEscrita, async (req, res) => {
    const lote_id = req.params.lote_id;
    const { data: validos } = await supabase.from('stg_importacao').select('*').eq('lote_id', lote_id).eq('status', 'valido');
    if (!validos?.length) return res.json({ ok: true, carregados: 0, msg: 'Nenhuma linha válida para carregar.' });

    const { data: turnos } = await supabase.from('turno').select('id,codigo');
    const turnoDe = Object.fromEntries((turnos || []).map(t => [t.codigo, t.id]));
    const turnoFallback = turnos?.[0]?.id || null;
    const { data: defs } = await supabase.from('catalogo_defeito').select('id,severidade');
    const sevDe = Object.fromEntries((defs || []).map(d => [d.id, d.severidade]));
    // produto placeholder p/ OPs do legado (ordem_producao exige produto_id)
    const prodLegado = await mfAcharOuCriar('produto', { codigo: '(LEGADO)' }, { codigo: '(LEGADO)', descricao: 'Produto não identificado (legado)', unidade_medida: 'kg' });

    let carregados = 0, pulados = 0, falhas = [];
    for (const r of validos) {
        const c = r.linha_bruta?._campos || {};
        try {
            const maqId = await mfAcharOuCriar('maquina', { nome: c.maquina_nome || '(legado)' },
                { codigo: 'LEG-' + (mfNorm(c.maquina_nome).replace(/\s+/g,'-').slice(0,20) || 'maq'), nome: c.maquina_nome || '(legado)', tipo: 'outro', setor: 'malharia' });
            const operId = await mfAcharOuCriar('operador', { nome: c.operador_nome || '(legado)' },
                { matricula: 'LEG-' + (mfNorm(c.operador_nome).replace(/\s+/g,'-').slice(0,20) || Date.now()), nome: c.operador_nome || '(legado)' });
            const opId = await mfAcharOuCriar('ordem_producao', { numero: c.op_numero },
                { numero: c.op_numero, produto_id: prodLegado, qtd_planejada: 0, unidade: 'kg', status: 'concluida', origem: 'erp' });
            const turnoId = turnoDe[c.turno] || turnoFallback;

            // dedup contra produção: NC já importada com mesma OP+defeito+datahora?
            const { data: dup } = await supabase.from('nao_conformidade')
                .select('id, apontamento:apontamento_id(op_id)').eq('defeito_id', r.defeito_id).eq('datahora', c._data_iso).limit(5);
            if ((dup || []).some(d => d.apontamento?.op_id === opId)) { pulados++; await supabase.from('stg_importacao').update({ status: 'rejeitado', erros: ['duplicado (produção)'] }).eq('id', r.id); continue; }

            const { data: ap, error: eAp } = await supabase.from('apontamento').insert({
                op_id: opId, maquina_id: maqId, operador_id: operId, turno_id: turnoId,
                datahora_inicio: c._data_iso, datahora_fim: c._data_iso,
                qtd_boa: parseFloat(String(c.qtd_boa).replace(',','.')) || 0, unidade: 'kg', origem: 'legado', sincronizado_em: new Date().toISOString(),
            }).select('id').single();
            if (eAp) throw new Error('apontamento: ' + eAp.message);

            const ncRow = { apontamento_id: ap.id, defeito_id: r.defeito_id, qtd_afetada: c._qtd_af, unidade: 'kg',
                disposicao: c.disposicao, severidade_aplicada: sevDe[r.defeito_id] || 2, origem_legado: c.defeito_texto, datahora: c._data_iso };
            const { error: eNc } = await supabase.from('nao_conformidade').insert(ncRow);
            if (eNc) throw new Error('nc: ' + eNc.message);

            await supabase.from('stg_importacao').update({ status: 'carregado' }).eq('id', r.id);
            carregados++;
        } catch (e) { falhas.push(`linha ${r.linha_origem}: ${e.message}`); }
    }
    res.json({ ok: true, carregados, pulados, falhas: falhas.slice(0, 20) });
});

app.get('/api/mf/importacao/:lote_id', auth, async (req, res) => {
    const { data, error } = await supabase.from('stg_importacao').select('*').eq('lote_id', req.params.lote_id).order('linha_origem');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});

// ETAPA 6: relatório do lote
app.get('/api/mf/importacao/:lote_id/relatorio', auth, async (req, res) => {
    const { data } = await supabase.from('stg_importacao').select('status,metodo_traducao,erros').eq('lote_id', req.params.lote_id);
    const rows = data || [];
    const porStatus = {}, porMetodo = {}, porErro = {};
    rows.forEach(r => {
        porStatus[r.status] = (porStatus[r.status] || 0) + 1;
        if (r.metodo_traducao) porMetodo[r.metodo_traducao] = (porMetodo[r.metodo_traducao] || 0) + 1;
        (r.erros || []).forEach(e => { const k = e.split(':')[0]; porErro[k] = (porErro[k] || 0) + 1; });
    });
    res.json({ total: rows.length, porStatus, porMetodo, porErro });
});

// ══════════════════════════════════════════════════════════════
// TPM / MANUTENÇÃO (fase 5)
// ══════════════════════════════════════════════════════════════
async function mfSubirImagem(dataUrl, caminho) {
    const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl || '');
    if (!m) return { url: dataUrl || null, bytes: null };
    const mime = m[1], buffer = Buffer.from(m[2], 'base64');
    const { error } = await supabase.storage.from(MF_BUCKET).upload(caminho, buffer, { contentType: mime, upsert: true });
    if (error) throw new Error('upload: ' + error.message);
    return { url: caminho, bytes: buffer.length };  // caminho (bucket privado)
}

app.get('/api/mf/componentes', auth, async (req, res) => {
    let q = supabase.from('componente').select('*, maquina:maquina_id(codigo)').eq('ativo', true).order('codigo');
    if (req.query.maquina_id) q = q.eq('maquina_id', req.query.maquina_id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.get('/api/mf/pecas', auth, (_q, res) => mfLista(res, 'peca', '*', 'nome'));

// ── Etiqueta de anomalia (TPM tag do operador) ────────────────
app.get('/api/mf/etiquetas', auth, async (req, res) => {
    let q = supabase.from('etiqueta_anomalia')
        .select('*, maquina:maquina_id(codigo,nome), operador:operador_id(nome)')
        .order('aberta_em', { ascending: false });
    if (req.query.status) q = q.eq('status', req.query.status);
    else q = q.neq('status', 'resolvida');
    const { data, error } = await q.limit(200);
    if (error) return res.status(500).json({ erro: error.message });
    for (const e of (data || [])) e.foto_url = await mfFotoUrl(e.foto_url);  // assina (bucket privado)
    res.json(data || []);
});
app.post('/api/mf/etiquetas', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.maquina_id || !b.operador_id || !b.tipo || !b.descricao) return res.status(400).json({ erro: 'maquina_id, operador_id, tipo e descricao obrigatórios' });
    const id = b.id || require('crypto').randomUUID();
    let foto_url = null;
    if (b.foto_url) { try { foto_url = (await mfSubirImagem(b.foto_url, `etiqueta/${id}/${id}.jpg`)).url; } catch (e) { return res.status(500).json({ erro: e.message }); } }
    const row = { id, maquina_id: b.maquina_id, componente_id: b.componente_id || null, operador_id: b.operador_id,
        tipo: b.tipo, gravidade: b.gravidade || 'media', descricao: b.descricao, foto_url };
    const { data, error } = await supabase.from('etiqueta_anomalia').upsert(row).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, etiqueta: data });
});
app.put('/api/mf/etiquetas/:id', auth, mfEscrita, async (req, res) => {
    const upd = {};
    ['status','ordem_manutencao_id'].forEach(f => { if (req.body[f] !== undefined) upd[f] = req.body[f]; });
    if (req.body.status === 'resolvida') upd.resolvida_em = new Date().toISOString();
    const { data, error } = await supabase.from('etiqueta_anomalia').update(upd).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, etiqueta: data });
});

// ── Ordem de manutenção (OM) ──────────────────────────────────
app.get('/api/mf/oms', auth, async (req, res) => {
    let q = supabase.from('ordem_manutencao')
        .select('*, maquina:maquina_id(codigo,nome), executor:executor_id(nome), consumo_peca(id,quantidade,peca:peca_id(nome))')
        .order('aberta_em', { ascending: false });
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q.limit(200);
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/mf/oms', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.maquina_id || !b.tipo || !b.descricao) return res.status(400).json({ erro: 'maquina_id, tipo e descricao obrigatórios' });
    const row = { maquina_id: b.maquina_id, componente_id: b.componente_id || null, plano_id: b.plano_id || null, parada_id: b.parada_id || null,
        tipo: b.tipo, prioridade: b.prioridade || 'media', status: b.status || 'aberta', descricao: b.descricao, executor_id: b.executor_id || null };
    const { data, error } = await supabase.from('ordem_manutencao').insert(row).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    // se veio de uma etiqueta, vincula
    if (b.etiqueta_id) await supabase.from('etiqueta_anomalia').update({ status: 'em_tratativa', ordem_manutencao_id: data.id }).eq('id', b.etiqueta_id);
    res.json({ ok: true, om: data });
});
app.put('/api/mf/oms/:id', auth, mfEscrita, async (req, res) => {
    const b = req.body || {}, upd = {};
    ['status','prioridade','executor_id','causa','acao_realizada','componente_id'].forEach(f => { if (b[f] !== undefined) upd[f] = b[f]; });
    if (b.iniciar)  upd.iniciada_em  = b.iniciada_em  || new Date().toISOString(), upd.status = 'em_execucao';
    if (b.concluir) upd.concluida_em = b.concluida_em || new Date().toISOString(), upd.status = 'concluida';
    const { data, error } = await supabase.from('ordem_manutencao').update(upd).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, om: data });
});
// consumo de peça numa OM (baixa estoque)
app.post('/api/mf/oms/:id/peca', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.peca_id || !(Number(b.quantidade) > 0)) return res.status(400).json({ erro: 'peca_id e quantidade>0 obrigatórios' });
    const { error: e1 } = await supabase.from('consumo_peca').insert({ ordem_manutencao_id: req.params.id, peca_id: b.peca_id, quantidade: b.quantidade });
    if (e1) return res.status(500).json({ erro: e1.message });
    const { data: pc } = await supabase.from('peca').select('estoque_atual').eq('id', b.peca_id).single();
    if (pc) await supabase.from('peca').update({ estoque_atual: Math.max(0, Number(pc.estoque_atual) - Number(b.quantidade)) }).eq('id', b.peca_id);
    res.json({ ok: true });
});

// ── Cadastros TPM: componente, peça, plano ────────────────────
app.post('/api/mf/componentes', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.maquina_id || !b.codigo || !b.nome || !b.tipo) return res.status(400).json({ erro: 'maquina_id, codigo, nome e tipo obrigatórios' });
    const row = { maquina_id: b.maquina_id, codigo: b.codigo, nome: b.nome, tipo: b.tipo,
        vida_util_valor: b.vida_util_valor || null, vida_util_unidade: b.vida_util_unidade || null };
    const { data, error } = await supabase.from('componente').upsert(row, { onConflict: 'codigo' }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, componente: data });
});
app.post('/api/mf/pecas', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.codigo || !b.nome || !b.unidade) return res.status(400).json({ erro: 'codigo, nome e unidade obrigatórios' });
    const row = { codigo: b.codigo, nome: b.nome, categoria: b.categoria || null, unidade: b.unidade,
        estoque_atual: Number(b.estoque_atual) || 0, estoque_minimo: Number(b.estoque_minimo) || 0 };
    const { data, error } = await supabase.from('peca').upsert(row, { onConflict: 'codigo' }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, peca: data });
});
app.get('/api/mf/planos', auth, async (_q, res) => {
    const { data, error } = await supabase.from('plano_manutencao').select('*, maquina:maquina_id(codigo), componente:componente_id(nome)').eq('ativo', true).order('nome');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/mf/planos', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.maquina_id || !b.nome || !b.tipo || !b.gatilho || !b.intervalo_valor || !b.intervalo_unidade) return res.status(400).json({ erro: 'campos obrigatórios faltando' });
    const row = { maquina_id: b.maquina_id, componente_id: b.componente_id || null, nome: b.nome, tipo: b.tipo, gatilho: b.gatilho,
        intervalo_valor: b.intervalo_valor, intervalo_unidade: b.intervalo_unidade, instrucoes: b.instrucoes || null, duracao_estimada_min: b.duracao_estimada_min || null };
    const { data, error } = await supabase.from('plano_manutencao').insert(row).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, plano: data });
});

// ── Checklist CIL (Limpeza, Inspeção, Lubrificação) ───────────
app.get('/api/mf/checklists', auth, async (_q, res) => {
    const { data, error } = await supabase.from('checklist_autonoma').select('*, checklist_item(*)').eq('ativo', true).order('nome');
    if (error) return res.status(500).json({ erro: error.message });
    (data || []).forEach(c => (c.checklist_item || []).sort((a, b) => a.ordem - b.ordem));
    res.json(data || []);
});
app.post('/api/mf/checklists', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.nome || !b.frequencia || !Array.isArray(b.itens) || !b.itens.length) return res.status(400).json({ erro: 'nome, frequencia e itens[] obrigatórios' });
    const { data: cl, error } = await supabase.from('checklist_autonoma').insert({ maquina_id: b.maquina_id || null, tipo_maquina: b.tipo_maquina || null, nome: b.nome, frequencia: b.frequencia }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    const itens = b.itens.map((it, i) => ({ checklist_id: cl.id, ordem: i + 1, descricao: it.descricao, tipo: it.tipo || 'inspecao', referencia: it.referencia || null }));
    const { error: e2 } = await supabase.from('checklist_item').insert(itens);
    if (e2) return res.status(500).json({ erro: e2.message });
    res.json({ ok: true, checklist: cl });
});
// operador executa o checklist → alimenta vw_cil_cumprimento
app.post('/api/mf/checklist-execucao', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.checklist_id || !b.maquina_id || !b.operador_id || !b.turno_id || !Array.isArray(b.resultados)) return res.status(400).json({ erro: 'campos obrigatórios faltando' });
    const completo = b.resultados.every(r => r.resultado && r.resultado !== '');
    const { data: ex, error } = await supabase.from('checklist_execucao').insert({ checklist_id: b.checklist_id, maquina_id: b.maquina_id, operador_id: b.operador_id, turno_id: b.turno_id, status: completo ? 'completo' : 'parcial' }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    const itens = b.resultados.filter(r => r.item_id && r.resultado).map(r => ({ execucao_id: ex.id, item_id: r.item_id, resultado: r.resultado, observacao: r.observacao || null }));
    if (itens.length) { const { error: e2 } = await supabase.from('checklist_execucao_item').insert(itens); if (e2) return res.status(500).json({ erro: e2.message }); }
    res.json({ ok: true, execucao: ex, status: ex.status });
});

// ── Indicadores TPM (lê as VIEWS) ─────────────────────────────
app.get('/api/mf/tpm', auth, async (_req, res) => {
    const [mttr, mtbf, cil, etiq] = await Promise.all([
        supabase.from('vw_mttr').select('*'),
        supabase.from('vw_mtbf').select('*'),
        supabase.from('vw_cil_cumprimento').select('*'),
        supabase.from('vw_etiquetas_abertas').select('*'),
    ]);
    const err = [mttr, mtbf, cil, etiq].find(r => r.error && /schema cache|does not exist|relation/i.test(r.error.message || ''));
    if (err) return res.status(503).json({ erro: 'Views de TPM ainda não criadas. Rode mes_tpm.sql no SQL Editor.' });
    // mapa de máquinas p/ rótulo
    const { data: maqs } = await supabase.from('maquina').select('id,codigo,nome');
    res.json({ maquinas: maqs || [], mttr: mttr.data || [], mtbf: mtbf.data || [], cil: cil.data || [], etiquetas: etiq.data || [] });
});

// ── Indicadores (fases 2-3): OEE, Pareto, qualidade — leem as VIEWS ──
app.get('/api/mf/indicadores', auth, async (_req, res) => {
    const [oee, pareto, resumo, categoria] = await Promise.all([
        supabase.from('vw_oee').select('*'),
        supabase.from('vw_pareto_defeito').select('*'),
        supabase.from('vw_qualidade_resumo').select('*').single(),
        supabase.from('vw_qualidade_categoria').select('*'),
    ]);
    const erroView = [oee, pareto, resumo, categoria].find(r => r.error && /schema cache|does not exist|relation/i.test(r.error.message || ''));
    if (erroView) return res.status(503).json({ erro: 'Views de indicadores ainda não criadas. Rode mes_indicadores.sql no SQL Editor.' });
    res.json({
        oee: oee.data || [],
        pareto: pareto.data || [],
        resumo: resumo.data || {},
        categoria: categoria.data || [],
    });
});

// ── CNQ (Custo da Não Qualidade) — fase 3 ─────────────────────
app.get('/api/mf/cnq', auth, async (_req, res) => {
    const [resumo, defeito, prods] = await Promise.all([
        supabase.from('vw_cnq_resumo').select('*').single(),
        supabase.from('vw_cnq_defeito').select('*'),
        supabase.from('produto').select('id,codigo,descricao,unidade_medida,custo_unitario').order('codigo'),
    ]);
    if (resumo.error && /schema cache|does not exist|column/i.test(resumo.error.message || ''))
        return res.status(503).json({ erro: 'CNQ ainda não criado. Rode mes_cnq.sql no SQL Editor.' });
    const forn = await supabase.from('vw_fornecedor').select('*');
    res.json({ resumo: resumo.data || {}, porDefeito: defeito.data || [], produtos: prods.data || [], fornecedores: forn.data || [] });
});
// define custo unitário de um produto (R$/unidade)
app.put('/api/mf/produtos/:id/custo', auth, mfEscrita, async (req, res) => {
    const v = Number(req.body?.custo_unitario);
    if (!(v >= 0)) return res.status(400).json({ erro: 'custo_unitario inválido' });
    const { error } = await supabase.from('produto').update({ custo_unitario: v }).eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});
// congela o custo na NC (preenche custo_estimado a partir do custo atual)
app.post('/api/mf/cnq/recalcular', auth, mfEscrita, async (_req, res) => {
    const { data: linhas, error } = await supabase.from('vw_cnq').select('nc_id,custo');
    if (error) return res.status(503).json({ erro: 'CNQ ainda não criado. Rode mes_cnq.sql.' });
    let n = 0;
    for (const l of (linhas || [])) { await supabase.from('nao_conformidade').update({ custo_estimado: l.custo }).eq('id', l.nc_id); n++; }
    res.json({ ok: true, atualizadas: n });
});

// ── Rastreabilidade (fase 4): lotes de fio + genealogia ───────
app.get('/api/mf/lotes-fio', auth, async (_req, res) => {
    const { data, error } = await supabase.from('lote_fio').select('*').eq('ativo', true).order('data_recebimento', { ascending: false });
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'Rastreabilidade ainda não criada. Rode mes_rastreabilidade.sql.' });
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});
app.post('/api/mf/lotes-fio', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.codigo) return res.status(400).json({ erro: 'codigo obrigatório' });
    const q = Number(b.qtd_recebida_kg) || 0;
    const row = { codigo: b.codigo, fornecedor: b.fornecedor || null, composicao: b.composicao || null, titulo_fio: b.titulo_fio || null,
        cor: b.cor || null, qtd_recebida_kg: q, qtd_disponivel_kg: q, data_recebimento: b.data_recebimento || new Date().toISOString() };
    const { data, error } = await supabase.from('lote_fio').upsert(row, { onConflict: 'codigo' }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, lote: data });
});
// registra consumo de um lote de fio numa sessão (baixa o disponível)
app.post('/api/mf/consumo-fio', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.apontamento_id || !b.lote_fio_id || !(Number(b.qtd_consumida_kg) > 0)) return res.status(400).json({ erro: 'apontamento_id, lote_fio_id e qtd_consumida_kg>0 obrigatórios' });
    const { error: e1 } = await supabase.from('consumo_fio').insert({ apontamento_id: b.apontamento_id, lote_fio_id: b.lote_fio_id, qtd_consumida_kg: b.qtd_consumida_kg });
    if (e1) return res.status(500).json({ erro: e1.message });
    const { data: lf } = await supabase.from('lote_fio').select('qtd_disponivel_kg').eq('id', b.lote_fio_id).single();
    if (lf) await supabase.from('lote_fio').update({ qtd_disponivel_kg: Math.max(0, Number(lf.qtd_disponivel_kg) - Number(b.qtd_consumida_kg)) }).eq('id', b.lote_fio_id);
    res.json({ ok: true });
});
// genealogia: forward (lote_fio_id → tudo que produziu) ou backward (op_id → lotes de fio)
app.get('/api/mf/genealogia', auth, async (req, res) => {
    let q = supabase.from('vw_genealogia').select('*');
    if (req.query.lote_fio_id) q = q.eq('lote_fio_id', req.query.lote_fio_id);   // recall
    else if (req.query.op_id)  q = q.eq('op_id', req.query.op_id);               // origem
    else if (req.query.apontamento_id) q = q.eq('apontamento_id', req.query.apontamento_id);
    const { data, error } = await q.order('datahora_inicio', { ascending: false });
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'Rastreabilidade ainda não criada. Rode mes_rastreabilidade.sql.' });
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data || []);
});

// ── CEP (Controle Estatístico de Processo) — Onda 3 ───────────
app.post('/api/mf/medicao', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.produto_id || !b.tipo || b.valor === undefined) return res.status(400).json({ erro: 'produto_id, tipo e valor obrigatórios' });
    const row = { produto_id: b.produto_id, tipo: b.tipo, valor: b.valor, apontamento_id: b.apontamento_id || null,
        operador_id: b.operador_id || null, datahora: b.datahora || new Date().toISOString() };
    const { data, error } = await supabase.from('medicao').insert(row).select().single();
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'CEP ainda não criado. Rode mes_cep.sql.' });
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true, medicao: data });
});
// define tolerância (± especificação) de um produto
app.put('/api/mf/produtos/:id/tolerancia', auth, mfEscrita, async (req, res) => {
    const upd = {};
    if (req.body.gramatura_tol !== undefined) upd.gramatura_tol = req.body.gramatura_tol;
    if (req.body.largura_tol   !== undefined) upd.largura_tol   = req.body.largura_tol;
    const { error } = await supabase.from('produto').update(upd).eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});
// carta de controle + capabilidade de um produto/tipo
app.get('/api/mf/cep', auth, async (req, res) => {
    const cap = await supabase.from('vw_cep_capabilidade').select('*');
    if (cap.error && /schema cache|does not exist/i.test(cap.error.message || '')) return res.status(503).json({ erro: 'CEP ainda não criado. Rode mes_cep.sql.' });
    let pontos = [];
    if (req.query.produto_id && req.query.tipo) {
        const m = await supabase.from('medicao').select('valor,datahora').eq('produto_id', req.query.produto_id).eq('tipo', req.query.tipo).order('datahora').limit(200);
        pontos = m.data || [];
    }
    const prods = await supabase.from('produto').select('id,codigo,descricao,gramatura_alvo,gramatura_tol,largura_alvo,largura_tol').order('codigo');
    res.json({ capabilidade: cap.data || [], pontos, produtos: prods.data || [] });
});

// ── Metas + Alertas + Painel executivo — Onda 4 ───────────────
app.get('/api/mf/metas', auth, async (_q, res) => {
    const { data, error } = await supabase.from('config_meta').select('*').order('chave');
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'Metas ainda não criadas. Rode mes_metas.sql.' });
    res.json(data || []);
});
app.put('/api/mf/metas/:chave', auth, mfEscrita, async (req, res) => {
    const v = Number(req.body?.valor);
    if (!Number.isFinite(v)) return res.status(400).json({ erro: 'valor inválido' });
    const { error } = await supabase.from('config_meta').update({ valor: v, atualizado_em: new Date().toISOString() }).eq('chave', req.params.chave);
    if (error) return res.status(500).json({ erro: error.message });
    res.json({ ok: true });
});

async function mfMetas() {
    const { data } = await supabase.from('config_meta').select('chave,valor');
    return Object.fromEntries((data || []).map(m => [m.chave, Number(m.valor)]));
}

// Alertas consolidados: gatilho → notificação. O que exige ação AGORA.
app.get('/api/mf/alertas', auth, async (_q, res) => {
    const metas = await mfMetas();
    const alertas = [];
    const add = (sev, modulo, msg, aba) => alertas.push({ sev, modulo, msg, aba });
    // OEE abaixo da meta
    const oee = await supabase.from('vw_oee').select('maquina_codigo,oee');
    (oee.data || []).forEach(m => { if (m.oee != null && metas.oee_meta && m.oee < metas.oee_meta) add('media', 'OEE', `${m.maquina_codigo}: OEE ${m.oee}% abaixo da meta (${metas.oee_meta}%)`, 'ind'); });
    // RNC atrasadas
    const rnc = await supabase.from('vw_rnc_resumo').select('atrasadas,abertas').single();
    if (rnc.data?.atrasadas > 0) add('alta', 'RNC', `${rnc.data.atrasadas} RNC(s) atrasada(s)`, 'rnc');
    // etiquetas de anomalia abertas há mais de N dias
    const limite = new Date(Date.now() - (metas.etiqueta_alerta_dias || 3) * 864e5).toISOString();
    const etq = await supabase.from('etiqueta_anomalia').select('id,maquina:maquina_id(codigo),gravidade').neq('status', 'resolvida').lt('aberta_em', limite);
    (etq.data || []).forEach(e => add(e.gravidade === 'alta' ? 'alta' : 'media', 'TPM', `Etiqueta aberta há +${metas.etiqueta_alerta_dias||3}d em ${e.maquina?.codigo||'?'}`, 'etiq'));
    // peças abaixo do mínimo
    const pc = await supabase.from('peca').select('codigo,estoque_atual,estoque_minimo').eq('ativo', true);
    (pc.data || []).filter(p => Number(p.estoque_atual) <= Number(p.estoque_minimo)).forEach(p => add('media', 'TPM', `Peça ${p.codigo} no/abaixo do mínimo (${p.estoque_atual})`, 'cad'));
    // Cpk abaixo do mínimo
    const cep = await supabase.from('vw_cep_capabilidade').select('produto_codigo,tipo,cpk');
    (cep.data || []).forEach(c => { if (c.cpk != null && metas.cpk_min && c.cpk < metas.cpk_min) add('alta', 'CEP', `${c.produto_codigo}/${c.tipo}: Cpk ${c.cpk} < ${metas.cpk_min} (processo incapaz)`, 'cep'); });
    // CNQ acima do limite
    const cnq = await supabase.from('vw_cnq_resumo').select('custo_total').single();
    if (cnq.data?.custo_total > (metas.cnq_limite_mensal || Infinity)) add('alta', 'CNQ', `CNQ R$ ${Number(cnq.data.custo_total).toLocaleString('pt-BR')} acima do limite (R$ ${metas.cnq_limite_mensal})`, 'cnq');
    const ordem = { alta: 0, media: 1, baixa: 2 };
    alertas.sort((a, b) => ordem[a.sev] - ordem[b.sev]);
    res.json({ alertas, total: alertas.length });
});

// Painel: KPIs consolidados de todos os módulos
app.get('/api/mf/painel', auth, async (_q, res) => {
    const [oee, cnq, qual, rnc, etq, ord, lotes] = await Promise.all([
        supabase.from('vw_oee').select('oee'),
        supabase.from('vw_cnq_resumo').select('custo_total').single(),
        supabase.from('vw_qualidade_resumo').select('total_ncs,rncs_geradas').single(),
        supabase.from('vw_rnc_resumo').select('abertas,atrasadas').single(),
        supabase.from('etiqueta_anomalia').select('id', { count: 'exact', head: true }).neq('status', 'resolvida'),
        supabase.from('ordem_manutencao').select('id', { count: 'exact', head: true }).not('status', 'in', '(concluida,cancelada)'),
        supabase.from('apontamento').select('id', { count: 'exact', head: true }).is('datahora_fim', null),
    ]);
    const oeeVals = (oee.data || []).map(o => o.oee).filter(v => v != null);
    res.json({
        oee_medio: oeeVals.length ? Math.round(oeeVals.reduce((s, v) => s + v, 0) / oeeVals.length) : null,
        cnq_total: cnq.data?.custo_total || 0,
        ncs: qual.data?.total_ncs || 0,
        rncs_abertas: rnc.data?.abertas || 0,
        rncs_atrasadas: rnc.data?.atrasadas || 0,
        etiquetas_abertas: etq.count || 0,
        oms_abertas: ord.count || 0,
        sessoes_abertas: lotes.count || 0,
    });
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
