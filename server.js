require('dotenv').config();
const express  = require('express');
const path     = require('path');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');
const supabase = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

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
            { expiresIn: '12h' }
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
app.post('/api/vendas/import', auth, async (req, res) => {
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

    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('vendas').insert(rows.slice(i, i + 200));
        if (error) return res.status(500).json({ erro: 'Erro ao salvar linhas' });
    }

    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/vendas?importacao_id=xxx ─────────────────────────
app.get('/api/vendas', auth, async (req, res) => {
    const { importacao_id, segmento, modelo, tamanho } = req.query;

    let q = supabase.from('vendas').select('*');
    if (importacao_id) q = q.eq('importacao_id', importacao_id);
    if (segmento)      q = q.eq('segmento', segmento);
    if (modelo)        q = q.eq('modelo', modelo);
    if (tamanho)       q = q.eq('tamanho', tamanho);

    const { data, error } = await q.limit(10000);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar dados' });
    res.json(data);
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
app.post('/api/estoque/import', auth, async (req, res) => {
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

    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('estoque').insert(rows.slice(i, i + 200));
        if (error) return res.status(500).json({ erro: 'Erro ao salvar estoque' });
    }
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/estoque?importacao_id=xxx ────────────────────────
app.get('/api/estoque', auth, async (req, res) => {
    const { importacao_id } = req.query;
    let q = supabase.from('estoque').select('*');
    if (importacao_id) q = q.eq('importacao_id', importacao_id);
    const { data, error } = await q.limit(10000);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar estoque' });
    res.json(data);
});

// ── DELETE /api/importacoes-estoque/:id ───────────────────────
app.delete('/api/importacoes-estoque/:id', auth, async (req, res) => {
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
app.post('/api/op/import', auth, async (req, res) => {
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
    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('ordens_producao').insert(rows.slice(i, i + 200));
        if (error) return res.status(500).json({ erro: 'Erro ao salvar ordens' });
    }
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/op?importacao_id=xxx ────────────────────────────
app.get('/api/op', auth, async (req, res) => {
    const { importacao_id } = req.query;
    let q = supabase.from('ordens_producao').select('*');
    if (importacao_id) q = q.eq('importacao_id', importacao_id);
    const { data, error } = await q.limit(10000);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar ordens' });
    res.json(data);
});

// ── DELETE /api/importacoes-op/:id ───────────────────────────
app.delete('/api/importacoes-op/:id', auth, async (req, res) => {
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
app.post('/api/costura/import', auth, async (req, res) => {
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
    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('dados_costura').insert(rows.slice(i, i + 200));
        if (error) return res.status(500).json({ erro: 'Erro ao salvar dados de costura' });
    }
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/costura?importacao_id=xxx ───────────────────────
app.get('/api/costura', auth, async (req, res) => {
    const { importacao_id } = req.query;
    let q = supabase.from('dados_costura').select('*');
    if (importacao_id) q = q.eq('importacao_id', importacao_id);
    const { data, error } = await q.limit(10000);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar dados de costura' });
    res.json(data);
});

// ── DELETE /api/importacoes-costura/:id ──────────────────────
app.delete('/api/importacoes-costura/:id', auth, async (req, res) => {
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
app.post('/api/cliente/import', auth, async (req, res) => {
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
    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('dados_cliente').insert(rows.slice(i, i + 200));
        if (error) return res.status(500).json({ erro: 'Erro ao salvar dados de cliente' });
    }
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/cliente?importacao_id=xxx ───────────────────────
app.get('/api/cliente', auth, async (req, res) => {
    const { importacao_id } = req.query;
    let q = supabase.from('dados_cliente').select('*');
    if (importacao_id) q = q.eq('importacao_id', importacao_id);
    const { data, error } = await q.limit(10000);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar dados de cliente' });
    res.json(data);
});

// ── DELETE /api/importacoes-cliente/:id ──────────────────────
app.delete('/api/importacoes-cliente/:id', auth, async (req, res) => {
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
app.post('/api/banco/import', auth, async (req, res) => {
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
    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('dados_banco').insert(rows.slice(i, i + 200));
        if (error) return res.status(500).json({ erro: 'Erro ao salvar dados de banco' });
    }
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── GET /api/banco?importacao_id=xxx ─────────────────────────
app.get('/api/banco', auth, async (req, res) => {
    const { importacao_id } = req.query;
    let q = supabase.from('dados_banco').select('*');
    if (importacao_id) q = q.eq('importacao_id', importacao_id);
    const { data, error } = await q.limit(10000);
    if (error) return res.status(500).json({ erro: 'Erro ao buscar dados de banco' });
    res.json(data);
});

// ── DELETE /api/importacoes-banco/:id ────────────────────────
app.delete('/api/importacoes-banco/:id', auth, async (req, res) => {
    const { error } = await supabase.from('importacoes_banco').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ erro: 'Erro ao deletar' });
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
    const { data, error } = await supabase.from('maquinas').insert({ processo_id, id_maquina, modelo, oee, status, n_pessoas }).select().single();
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

    app.post(`/api/${nome}/import`, auth, async (req, res) => {
        const { nomeArquivo, linhas } = req.body;
        if (!Array.isArray(linhas) || !linhas.length)
            return res.status(400).json({ erro: 'Dados inválidos' });
        const { data: imp, error: errImp } = await supabase.from(`importacoes_${nome}`)
            .insert({ nome_arquivo: nomeArquivo || nome, usuario_id: req.usuario.id, total_linhas: linhas.length })
            .select().single();
        if (errImp) return res.status(500).json({ erro: errImp.message });
        const rows = linhas.map(l => ({ importacao_id: imp.id, dados: l.dados || {} }));
        for (let i = 0; i < rows.length; i += 200) {
            const { error } = await supabase.from(`dados_${nome}`).insert(rows.slice(i, i + 200));
            if (error) return res.status(500).json({ erro: `Erro ao salvar dados de ${nome}` });
        }
        res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
    });

    app.get(`/api/${nome}`, auth, async (req, res) => {
        let q = supabase.from(`dados_${nome}`).select('*');
        if (req.query.importacao_id) q = q.eq('importacao_id', req.query.importacao_id);
        const { data, error } = await q.limit(10000);
        if (error) return res.status(500).json({ erro: `Erro ao buscar ${nome}` });
        res.json(data);
    });

    app.delete(`/api/importacoes-${nome}/:id`, auth, async (req, res) => {
        const { error } = await supabase.from(`importacoes_${nome}`).delete().eq('id', req.params.id);
        if (error) return res.status(500).json({ erro: 'Erro ao deletar' });
        res.json({ ok: true });
    });
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
    <title>SIGS — Acesso de Emergência</title>
    <style>body{background:#0D1117;color:#E6EDF3;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
    .box{background:#161B22;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:40px;width:340px}
    h2{margin:0 0 24px;font-size:1.3rem}input{width:100%;padding:10px;background:#0D1117;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#E6EDF3;font-size:0.9rem;margin-bottom:12px;box-sizing:border-box}
    button{width:100%;padding:12px;background:#2F81F7;color:white;border:none;border-radius:6px;font-size:0.9rem;cursor:pointer}
    #msg{margin-top:12px;font-size:0.8rem;color:#F85149}</style></head>
    <body><div class="box"><h2>SIGS — Emergência</h2>
    <form id="f"><input type="email" id="e" value="admin@stoll.com.br" required>
    <input type="password" id="s" value="Admin@2025" required>
    <button type="submit">Entrar</button></form>
    <div id="msg"></div></div>
    <script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:document.getElementById('e').value,senha:document.getElementById('s').value})});
    const d=await r.json();if(r.ok){localStorage.setItem('sigs_token',d.token);
    localStorage.setItem('sigs_user',JSON.stringify(d.usuario));window.location='/';}
    else document.getElementById('msg').textContent=d.erro||'Erro';}</script></body></html>`);
});

// ── Fallback para SPA ─────────────────────────────────────────
app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n🚀 Servidor SIGS rodando em: http://localhost:${PORT}`);
    console.log(`📡 Banco: Supabase (${process.env.SUPABASE_URL})\n`);
});
