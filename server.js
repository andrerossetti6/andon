require('dotenv').config({ quiet: true });  // {quiet} evita o banner do dotenv poluir o stdout do LaunchAgent
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

// paginação genérica (sem filtro de importacao) — evita o teto de 1000 do PostgREST
async function fetchAllSelect(tabela, cols, tweak = q => q, pageSize = 1000) {
    let all = [], from = 0;
    for (;;) {
        const { data, error } = await tweak(supabase.from(tabela).select(cols).range(from, from + pageSize - 1));
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < pageSize) break;
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
// M13: não servir código do servidor / schema publicamente (só assets do front)
app.use((req, res, next) => {
    if (/\.sql$|(^|\/)(server|db|mes_seed|generate_graph)\.js$|(^|\/)package(-lock)?\.json$/i.test(req.path)) return res.status(404).end();
    next();
});
app.use(express.static(__dirname, { etag: false, lastModified: false, dotfiles: 'ignore', setHeaders: res => res.set('Cache-Control', 'no-store') }));

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

// Auth máquina-a-máquina (#4 contagem): aceita a chave fixa MF_MAQUINA_API_KEY
// (header X-API-Key ou Authorization: Bearer <chave>) OU o login normal (JWT).
// Assim o contador/CLP/gateway da máquina chama sem precisar de usuário.
// B10: aceita VÁRIAS chaves (CSV em MF_MAQUINA_API_KEY) p/ rotação sem downtime —
// gera a nova, mantém a antiga na lista, troca os gateways aos poucos, depois remove a antiga.
// Comparação em tempo constante (timingSafeEqual) evita side-channel por tempo de resposta.
function chaveMaquinaValida(enviado) {
    if (!enviado) return false;
    const crypto = require('crypto');
    const buf = Buffer.from(String(enviado));
    return String(process.env.MF_MAQUINA_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean)
        .some(k => { const kb = Buffer.from(k); return kb.length === buf.length && crypto.timingSafeEqual(kb, buf); });
}
function mfMaquinaAuth(req, res, next) {
    const enviado = req.headers['x-api-key'] || req.headers.authorization?.split(' ')[1];
    if (chaveMaquinaValida(enviado)) { req.usuario = { perfil: 'maquina', nome: 'gateway-maquina' }; return next(); }
    return auth(req, res, () => adminOnly(req, res, next));  // sem a chave da máquina → só admin (operador não forja produção)
}

// resposta 500 sem vazar detalhe do banco pro cliente (loga o real no servidor) — M19
function erro500(res, e, ctx) {
    console.error('[500]' + (ctx ? ' ' + ctx : ''), e?.message || e);
    return res.status(500).json({ erro: 'Erro interno no servidor. Tente novamente.' });
}

// rate-limit simples do login (em memória): 5 falhas → 15 min de bloqueio por IP — M18
const _loginFails = new Map();
function _loginBloqueado(ip) { const e = _loginFails.get(ip); return (e?.until && Date.now() < e.until) ? Math.ceil((e.until - Date.now()) / 1000) : 0; }
function _loginFalhou(ip) { const e = _loginFails.get(ip) || { count: 0 }; e.count++; if (e.count >= 5) { e.until = Date.now() + 15 * 60 * 1000; e.count = 0; } _loginFails.set(ip, e); }
function _loginOk(ip) { _loginFails.delete(ip); }

// ── GET /api/ping — wake-up sem auth ─────────────────────────
app.get('/api/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── POST /api/auth/login ──────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    try {
        const ip = req.ip || req.connection?.remoteAddress || 'desconhecido';
        const espera = _loginBloqueado(ip);
        if (espera) return res.status(429).json({ erro: `Muitas tentativas. Aguarde ${Math.ceil(espera / 60)} min.` });
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

        if (!usuario) { _loginFalhou(ip); return res.status(401).json({ erro: 'Credenciais inválidas' }); }

        const ok = await bcrypt.compare(senha, usuario.senha_hash);
        if (!ok) { _loginFalhou(ip); return res.status(401).json({ erro: 'Credenciais inválidas' }); }
        _loginOk(ip);  // sucesso: zera o contador de tentativas

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

    try {
        const { data: usuario, error } = await supabase
            .from('usuarios').select('senha_hash').eq('id', req.usuario.id).single();
        if (error || !usuario) return res.status(401).json({ erro: 'Usuário não encontrado — faça login novamente.' });

        if (!await bcrypt.compare(senhaAtual, usuario.senha_hash))
            return res.status(401).json({ erro: 'Senha atual incorreta' });

        const hash = await bcrypt.hash(novaSenha, 10);
        await supabase.from('usuarios').update({ senha_hash: hash }).eq('id', req.usuario.id);
        res.json({ ok: true });
    } catch (e) { return erro500(res, e, 'trocar-senha'); }
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
// Integração Fase 2: ordem_producao (MES) no MESMO formato que o SIGS lê de
// dados_op ({id, dados:{'N. OP','Ref','Descrição','Cor','Tam','Marca','Qtd','Status'}}).
// Fonte única da carteira de OP. NÃO toca em dados_op nem no /api/op (import legado).
app.get('/api/op-unificado', auth, async (req, res) => {
    let ops, prods;
    try {
        // paginado (sem teto de 1000) e exclui canceladas E concluídas — só carteira ATIVA p/ planejamento
        [ops, prods] = await Promise.all([
            fetchAllSelect('ordem_producao', 'id,numero,produto_id,qtd_planejada,unidade,status,data_abertura,data_prevista',
                q => q.neq('status', 'cancelada').neq('status', 'concluida')),
            fetchAllSelect('produto', 'id,codigo,descricao,cor,marca,tamanho'),
        ]);
    } catch (e) { return res.status(500).json({ erro: e.message }); }
    const pById = new Map((prods || []).map(p => [p.id, p]));
    const rows = (ops || []).map(o => {
        const p = pById.get(o.produto_id) || {};
        return {
            id: o.id, op_id: o.id, produto_codigo: p.codigo || '',
            dados: {
                'N. OP': o.numero, 'Ref': p.codigo || '', 'Descrição': p.descricao || '',
                'Cor': p.cor || '', 'Tam': p.tamanho || '', 'Marca': p.marca || '',
                'Qtd': o.qtd_planejada, 'Status': o.status,
                'Emissão': o.data_abertura ? String(o.data_abertura).slice(0, 10) : '',
                'Prev. Final': o.data_prevista ? String(o.data_prevista).slice(0, 10) : '',
            },
        };
    });
    res.json(rows);
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
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/soep-acoes', auth, async (req, res) => {
    const { descricao, responsavel, prazo, modulo } = req.body;
    if (!descricao?.trim()) return res.status(400).json({ erro: 'descricao obrigatória' });
    const { data, error } = await supabase.from('soep_acoes')
        .insert({ descricao: descricao.trim(), responsavel: responsavel||null, prazo: prazo||null, modulo: modulo||null, status: 'aberta' })
        .select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, acao: data });
});
app.put('/api/soep-acoes/:id', auth, async (req, res) => {
    const fields = {};
    ['status','descricao','responsavel','prazo'].forEach(k => { if (req.body[k] !== undefined) fields[k] = req.body[k] || null; });
    const { error } = await supabase.from('soep_acoes').update(fields).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
app.delete('/api/soep-acoes/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('soep_acoes').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── S&OP — SNAPSHOT DE PREVISÃO (histórico para acurácia) ────
app.get('/api/soep-snapshot', auth, async (_req, res) => {
    const { data, error } = await supabase.from('soep_snapshot').select('mes,codigo,qty_prevista,criado_em').order('criado_em', { ascending: false });
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/soep-snapshot/bulk', auth, async (req, res) => {
    const { mes, items } = req.body;
    if (!mes || !Array.isArray(items) || !items.length) return res.status(400).json({ erro: 'mes e items obrigatórios' });
    // Remove snapshot anterior do mesmo mês e recria
    await supabase.from('soep_snapshot').delete().eq('mes', mes);
    const rows = items.map(i => ({ mes, codigo: String(i.codigo).toUpperCase(), qty_prevista: i.qty||0, usuario_id: req.usuario.id }));
    const { error } = await supabase.from('soep_snapshot').insert(rows);
    if (error) return erro500(res, error);
    res.json({ ok: true, total: rows.length });
});
app.delete('/api/soep-snapshot/:mes', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('soep_snapshot').delete().eq('mes', req.params.mes);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── S&OP — PLANO DE PRODUÇÃO (persiste no banco) ─────────────
app.get('/api/soep-plano', auth, async (_req, res) => {
    const { data, error } = await supabase.from('soep_plano').select('mes,codigo,quantidade');
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/soep-plano/bulk', auth, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.json({ ok: true });
    const rows = items.map(i => ({ mes: i.mes, codigo: String(i.codigo).toUpperCase(), quantidade: i.quantidade||0, usuario_id: req.usuario.id }));
    const { error } = await supabase.from('soep_plano').upsert(rows, { onConflict: 'mes,codigo' });
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
app.delete('/api/soep-plano/:mes', auth, async (req, res) => {
    const { error } = await supabase.from('soep_plano').delete().eq('mes', req.params.mes);
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json({ ok: true, versao, total: rows.length });
});
app.get('/api/plano-versao/lista', auth, async (_req, res) => {
    const { data, error } = await supabase.from('plano_versao').select('versao,label,criado_em').order('criado_em', { ascending: false });
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.delete('/api/plano-versao/:versao', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('plano_versao').delete().eq('versao', req.params.versao);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── CAPACIDADE POR PROCESSO — fonte única (substitui localStorage por navegador) ──
app.get('/api/capacidade-config', auth, async (_req, res) => {
    const { data, error } = await supabase.from('capacidade_config').select('processo,maquinas,horas_dia,oee');
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── S&OP — ESTOQUE MÍNIMO POR SKU ────────────────────────────
app.get('/api/estoque-minimo', auth, async (_req, res) => {
    const { data, error } = await supabase.from('estoque_minimo').select('codigo,quantidade');
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/estoque-minimo/bulk', auth, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.json({ ok: true });
    const rows = items.map(i => ({ codigo: String(i.codigo).toUpperCase(), quantidade: i.quantidade||0 }));
    const { error } = await supabase.from('estoque_minimo').upsert(rows, { onConflict: 'codigo' });
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
app.delete('/api/estoque-minimo/:codigo', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('estoque_minimo').delete().eq('codigo', req.params.codigo.toUpperCase());
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── APS — DATAS DE ENTREGA POR SKU ───────────────────────────
app.get('/api/op-datas', auth, async (_req, res) => {
    try {  // paginado (sem teto de 1000) — prazos/CPV do Preactor
        const data = await fetchAllSelect('op_datas', '*', q => q.order('data_entrega', { ascending: true }));
        res.json(data || []);
    } catch (e) { return erro500(res, e); }
});
app.post('/api/op-datas/bulk', auth, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ erro: 'items obrigatório' });
    const rows = items.map(i => ({ nop: i.nop||null, codigo: String(i.codigo).toUpperCase(), data_entrega: i.data_entrega||null, cpv: i.cpv||0, usuario_id: req.usuario.id }));
    const { error } = await supabase.from('op_datas').upsert(rows, { onConflict: 'codigo' });
    if (error) return erro500(res, error);
    res.json({ ok: true, total: rows.length });
});
app.delete('/api/op-datas/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('op_datas').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── APS — MATRIZ DE SETUP/CHANGEOVER ─────────────────────────
app.get('/api/setup-matrix', auth, async (_req, res) => {
    const { data, error } = await supabase.from('setup_matrix').select('*').order('processo').order('familia_de');
    if (error) return erro500(res, error);
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
            return erro500(res, error);
        }
    }
    res.json({ ok: true });
});

// ── APS — CENÁRIOS DE SIMULAÇÃO ───────────────────────────────
app.get('/api/timeline-cenario', auth, async (_req, res) => {
    const { data, error } = await supabase.from('timeline_cenario').select('id,nome,config,resultado,criado_em').order('criado_em', { ascending: false }).limit(20);
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/timeline-cenario', auth, async (req, res) => {
    const { nome, config, resultado } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome obrigatório' });
    const { data, error } = await supabase.from('timeline_cenario').insert({ nome, config: config||{}, resultado: resultado||{}, usuario_id: req.usuario.id }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, cenario: data });
});
app.put('/api/timeline-cenario/:id', auth, async (req, res) => {
    const { nome } = req.body;
    const { error } = await supabase.from('timeline_cenario').update({ nome }).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
app.delete('/api/timeline-cenario/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('timeline_cenario').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── DISPONIBILIDADE: FERIADOS ────────────────────────────────
app.get('/api/feriados', auth, async (_req, res) => {
    const { data, error } = await supabase.from('feriados').select('*').order('data');
    if (error) return erro500(res, error);
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
        if (error) return erro500(res, error);
    }
    res.json({ ok: true, total: rows.length });
});
app.post('/api/feriados', auth, async (req, res) => {
    const { data: d, nome, tipo } = req.body;
    if (!d || !nome) return res.status(400).json({ erro: 'Data e nome obrigatórios' });
    const { data, error } = await supabase.from('feriados').insert({ data: d, nome, tipo: tipo || 'Nacional' }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, feriado: data });
});
app.delete('/api/feriados/:id', auth, async (req, res) => {
    const { error } = await supabase.from('feriados').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json((data || []).map(normalizarTurno));
});
app.post('/api/turnos', auth, async (req, res) => {
    const { processo, nome, inicio, fim, intervalo_min, dias_semana } = req.body;
    if (!nome || !inicio || !fim) return res.status(400).json({ erro: 'Nome, início e fim obrigatórios' });
    const { data, error } = await salvarTurno('insert', null, { processo, nome, inicio, fim, intervalo_min, dias_semana });
    if (error) return erro500(res, error);
    res.json({ ok: true, turno: normalizarTurno(data) });
});
app.put('/api/turnos/:id', auth, async (req, res) => {
    const { processo, nome, inicio, fim, intervalo_min, dias_semana } = req.body;
    const { data, error } = await salvarTurno('update', req.params.id, { processo, nome, inicio, fim, intervalo_min, dias_semana });
    if (error) return erro500(res, error);
    res.json({ ok: true, data: normalizarTurno(data) });
});

app.delete('/api/turnos/:id', auth, async (req, res) => {
    const { error } = await supabase.from('turnos').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── PROCESSOS CRUD ───────────────────────────────────────────
app.get('/api/processos-config', auth, async (_req, res) => {
    const { data, error } = await supabase.from('processos_config').select('*').order('nome');
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json({ ok: true, data });
});
app.put('/api/processos-config/:id', auth, async (req, res) => {
    const { nome, descricao } = req.body;
    const { data, error } = await supabase.from('processos_config').update({ nome, descricao }).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, data });
});
app.delete('/api/processos-config/:id', auth, async (req, res) => {
    const { error } = await supabase.from('processos_config').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── MÁQUINAS CRUD ─────────────────────────────────────────────
app.get('/api/maquinas', auth, async (req, res) => {
    let q = supabase.from('maquinas').select('*').order('id_maquina');
    if (req.query.processo_id) q = q.eq('processo_id', req.query.processo_id);
    const { data, error } = await q;
    if (error) return erro500(res, error);
    res.json(data);
});
app.post('/api/maquinas', auth, async (req, res) => {
    const { processo_id, id_maquina, modelo, oee, status, n_pessoas } = req.body;
    if (!processo_id) return res.status(400).json({ erro: 'processo_id obrigatório' });
    if (!id_maquina && !modelo && oee == null && n_pessoas == null)
        return res.status(400).json({ erro: 'Preencha ao menos um campo da máquina' });
    const { data, error } = await supabase.from('maquinas').insert({ processo_id, id_maquina: id_maquina || null, modelo: modelo || null, oee: oee ?? null, status: status || 'Ativo', n_pessoas: n_pessoas ?? null }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, data });
});
app.put('/api/maquinas/:id', auth, async (req, res) => {
    const { id_maquina, modelo, oee, status, n_pessoas } = req.body;
    const { data, error } = await supabase.from('maquinas').update({ id_maquina, modelo, oee, status, n_pessoas }).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, data });
});
app.delete('/api/maquinas/:id', auth, async (req, res) => {
    const { error } = await supabase.from('maquinas').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
// Integração Fase 1b: máquina do MES no formato de 'maquinas' (SIGS), com
// processo_id mapeado para processos_config por nome. Fonte única de recurso para
// o TOC (gargalo Stoll). NÃO toca no CRUD de Processos (/api/maquinas).
app.get('/api/maquinas-unificado', auth, async (req, res) => {
    const [{ data: vw, error: e1 }, { data: procs, error: e2 }] = await Promise.all([
        supabase.from('vw_maquina_sigs').select('*'),
        supabase.from('processos_config').select('id,nome'),
    ]);
    if (e1) return res.status(500).json({ erro: e1.message });
    if (e2) return res.status(500).json({ erro: e2.message });
    const norm = s => String(s || '').toLowerCase().replace(/^\s*\d+\.\s*/, '').trim();
    const byNome = new Map((procs || []).map(p => [norm(p.nome), p.id]));
    let rows = (vw || []).map(m => ({
        id: m.id, processo_id: byNome.get(norm(m.processo)) || null,
        id_maquina: m.id_maquina, modelo: m.modelo, oee: m.oee, status: m.status, n_pessoas: m.n_pessoas,
    }));
    if (req.query.processo_id) rows = rows.filter(m => m.processo_id === req.query.processo_id);
    res.json(rows);
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

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ LEGADO / DEPRECADO (Fase 6) — MES embutido do SIGS (tabelas plurais        ║
// ║ apontamentos/paradas_mes). A fábrica de malha aponta no MES Malha Forte     ║
// ║ (/api/mf/*, mes.html). O front do SIGS NÃO chama mais estes endpoints —     ║
// ║ a tela 'mes' virou ponteiro e Home/Reunião/Preactor usam /api/mf/*.         ║
// ║ Mantidos apenas para preservar os registros históricos; não estender.       ║
// ╚══════════════════════════════════════════════════════════════════════════╝
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
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json({ ok: true, apontamento: data });
});

app.put('/api/mes/apontamentos/:id', auth, async (req, res) => {
    const updates = {};
    ['fim','qtd_produzida','qtd_refugo','status','obs','operador','maquina'].forEach(f => {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    if (updates.status === 'finalizado' && !updates.fim) updates.fim = new Date().toISOString();
    const { data, error } = await supabase.from('apontamentos').update(updates).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, apontamento: data });
});

app.delete('/api/mes/apontamentos/:id', auth, adminOnly, async (req, res) => {
    const { error } = await supabase.from('apontamentos').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json({ ok: true, parada: data });
});

app.put('/api/mes/paradas/:id', auth, async (req, res) => {
    const fimTs = new Date().toISOString();
    const { data: par } = await supabase.from('paradas_mes').select('inicio,apontamento_id').eq('id', req.params.id).single();
    const duracao_min = par ? Math.max(1, Math.round((new Date(fimTs) - new Date(par.inicio)) / 60000)) : 1;
    const { data, error } = await supabase.from('paradas_mes').update({ fim: fimTs, duracao_min }).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
    if (par?.apontamento_id) await supabase.from('apontamentos').update({ status: 'em_andamento' }).eq('id', par.apontamento_id);
    res.json({ ok: true, parada: data });
});

// ── MES — WIP ATUAL ──────────────────────────────────────────────
app.get('/api/mes/wip', auth, async (_req, res) => {
    const { data, error } = await supabase.from('apontamentos')
        .select('id,op_numero,cod,descricao,processo,operador,turno,maquina,inicio,status,qtd_produzida,qtd_planejada,qtd_refugo,paradas_mes(id,tipo,motivo,inicio,fim,duracao_min)')
        .in('status', ['em_andamento', 'parado'])
        .order('processo').order('inicio');
    if (error) return erro500(res, error);
    res.json(data || []);
});

// ── MES — OEE REAL ──────────────────────────────────────────────
app.get('/api/mes/oee', auth, async (req, res) => {
    const dataIni = req.query.data_inicio || new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10);
    const dataFim = req.query.data_fim    || new Date().toISOString().slice(0,10);
    let apts;
    try {  // paginado (sem teto de 1000) — senão o OEE do período subconta silenciosamente
        apts = await fetchAllSelect('apontamentos', 'processo,inicio,fim,qtd_produzida,qtd_refugo,paradas_mes(duracao_min,motivo,tipo)',
            q => q.gte('inicio', dataIni).lte('inicio', dataFim + 'T23:59:59').eq('status', 'finalizado'));
    } catch (e) { return erro500(res, e); }
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
app.get('/api/setup', async (req, res) => {
    // Página navegável direto pela URL (o browser não manda o header JWT), então não usa o middleware auth.
    // Mas o SQL de correção expõe o schema (CREATE TABLE + DISABLE RLS) — só é servido a um ADMIN autenticado
    // (token via header OU ?token=). Anônimo vê apenas os nomes das tabelas faltando. (review baixa: server.js:1148)
    const isAdmin = (() => {
        try {
            const t = req.headers.authorization?.split(' ')[1] || req.query.token;
            return !!(t && jwt.verify(t, process.env.JWT_SECRET)?.perfil === 'admin');
        } catch { return false; }
    })();
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
  ${isAdmin ? `<h3 style="margin-bottom:8px;">Como corrigir — copie e execute no Supabase SQL Editor:</h3>
  <div class="step">1. Acesse <b>supabase.com/dashboard</b> → seu projeto → <b>SQL Editor</b> → <b>New query</b></div>
  <div class="step">2. Cole o SQL abaixo e clique em <b>Run</b></div>
  <div class="step">3. Recarregue esta página para confirmar que ficou tudo OK</div>
  <textarea id="sql">${sqlCompleto}</textarea>
  <button onclick="navigator.clipboard.writeText(document.getElementById('sql').value).then(()=>this.textContent='✓ Copiado!')">Copiar SQL</button>`
  : `<div class="step">O SQL de correção só é exibido para um administrador autenticado. Abra esta página logado como admin no SIGS (ou acrescente <b>?token=SEU_TOKEN</b> à URL).</div>`}`
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
    try {  // paginado (sem teto de 1000) — catálogos (produto/peça) podem passar de 1000 itens
        const data = await fetchAllSelect(tabela, cols || '*', q => orderCol ? q.order(orderCol) : q);
        res.json(data || []);
    } catch (e) { return erro500(res, e); }
}
app.get('/api/mf/produtos',  auth, (_q, res) => mfLista(res, 'produto', '*', 'codigo'));
app.get('/api/mf/maquinas',  auth, (_q, res) => mfLista(res, 'maquina', '*', 'codigo'));
// vincula a máquina a uma etapa do fluxo (para o apontamento preencher a etapa sozinho)
app.put('/api/mf/maquinas/:id', auth, mfEscrita, async (req, res) => {
    const upd = {};
    ['etapa_id', 'nome', 'ativo'].forEach(f => { if (req.body[f] !== undefined) upd[f] = req.body[f]; });
    if (upd.etapa_id === '') upd.etapa_id = null;
    const { error } = await supabase.from('maquina').update(upd).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
app.get('/api/mf/operadores',auth, (_q, res) => mfLista(res, 'operador', '*', 'nome'));
app.get('/api/mf/turnos',    auth, (_q, res) => mfLista(res, 'turno', '*', 'codigo'));
app.get('/api/mf/motivos',   auth, (_q, res) => mfLista(res, 'motivo_parada', '*', 'descricao'));
app.get('/api/mf/defeitos',  auth, (_q, res) => mfLista(res, 'catalogo_defeito', '*', 'descricao'));

app.get('/api/mf/ops', auth, async (req, res) => {
    try {  // paginado (sem teto de 1000) + ordenado
        const cols = '*, produto:produto_id(codigo,descricao,unidade_medida,marca,cor,tamanho), etapa:etapa_atual_id(nome,ordem)';
        const data = await fetchAllSelect('ordem_producao', cols, q => { q = q.order('criado_em', { ascending: false }); if (req.query.status) q = q.eq('status', req.query.status); return q; });
        return res.json(data);
    } catch (e) {
        // fallback se as colunas novas (etapa_atual) ainda não existirem
        try { return res.json(await fetchAllSelect('ordem_producao', '*, produto:produto_id(codigo,descricao,unidade_medida)', q => q.order('criado_em', { ascending: false }))); }
        catch (e2) { return erro500(res, e2); }
    }
});

// atualiza campos de uma OP (prioridade, status, datas)
app.put('/api/mf/ops/:id', auth, mfEscrita, async (req, res) => {
    const upd = {};
    ['prioridade', 'status', 'data_prevista', 'data_abertura'].forEach(f => { if (req.body[f] !== undefined) upd[f] = req.body[f]; });
    if (upd.prioridade !== undefined) upd.prioridade = Math.max(0, Math.min(2, Number(upd.prioridade) || 0));  // clamp 0-2 (M1)
    const { error } = await supabase.from('ordem_producao').update(upd).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
// Fase 3 (Plano→Chão): sequencia a carteira por EDD (data de entrega) e empurra a
// prioridade para a Fila do operador. Ranking: 20% mais urgentes→2, 30% seguintes→1.
app.post('/api/mf/sequenciar-carteira', auth, mfEscrita, async (req, res) => {
    const dry = !!req.body?.dry, forcar = !!req.body?.forcar;  // M8: preserva prioridade manual (>0) a menos que forcar
    let ops;
    try { ops = await fetchAllSelect('ordem_producao', 'id,data_prevista,prioridade', q => q.neq('status', 'cancelada').neq('status', 'concluida')); }  // paginado + erro tratado (A2/A4)
    catch (e) { return erro500(res, e); }
    ops.sort((a, b) => { if (!a.data_prevista) return 1; if (!b.data_prevista) return -1; return new Date(a.data_prevista) - new Date(b.data_prevista); });
    const n = ops.length; let urgente = 0, alta = 0, normal = 0, preservadas = 0;
    const prioDe = ops.map((o, i) => {
        const frac = n > 1 ? i / n : 0;
        const p = (o.data_prevista && frac < 0.2) ? 2 : (o.data_prevista && frac < 0.5) ? 1 : 0;
        const manual = !forcar && (Number(o.prioridade) || 0) > 0;  // não atropela o que o operador marcou na Fila
        if (manual) { preservadas++; return { id: o.id, p, aplica: false }; }
        if (p === 2) urgente++; else if (p === 1) alta++; else normal++;
        return { id: o.id, p, aplica: true };
    });
    if (!dry) for (const p of [0, 1, 2]) {
        const ids = prioDe.filter(x => x.aplica && x.p === p).map(x => x.id);
        if (ids.length) { const { error } = await supabase.from('ordem_producao').update({ prioridade: p }).in('id', ids); if (error) return erro500(res, error); }
    }
    res.json({ ok: true, dry, criterio: 'EDD (data de entrega)', urgente, alta, normal, preservadas, total: n });
});

// ── Cadastros (escrita genérica, admin) ───────────────────────
const MF_CADASTROS = { produto:'codigo', maquina:'codigo', operador:'matricula', turno:'codigo', motivo_parada:'codigo', catalogo_defeito:'codigo' };
app.post('/api/mf/cadastro/:tabela', auth, mfEscrita, async (req, res) => {
    const t = req.params.tabela;
    if (!MF_CADASTROS[t]) return res.status(400).json({ erro: 'Tabela inválida' });
    const { criado_em, atualizado_em, ...corpo } = req.body || {};  // o cliente não define os carimbos de auditoria (trigger cuida)
    const { data, error } = await supabase.from(t).upsert(corpo, { onConflict: MF_CADASTROS[t] }).select().single();
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json({ ok: true, op: data });
});

// ── Apontamento (sessão de trabalho) ──────────────────────────
app.get('/api/mf/apontamentos', auth, async (req, res) => {
    let q = supabase.from('apontamento')
        .select('*, op:op_id(numero), maquina:maquina_id(codigo,nome), operador:operador_id(nome), turno:turno_id(codigo), parada(*), nao_conformidade(*)')
        .order('datahora_inicio', { ascending: false });
    if (req.query.abertas === '1') q = q.is('datahora_fim', null);
    const { data, error } = await q.limit(200);
    if (error) return erro500(res, error);
    res.json(data || []);
});

app.post('/api/mf/apontamentos', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    for (const f of ['op_id','maquina_id','operador_id','turno_id']) if (!b[f]) return res.status(400).json({ erro: `${f} obrigatório` });
    const row = { op_id: b.op_id, maquina_id: b.maquina_id, operador_id: b.operador_id, turno_id: b.turno_id,
        datahora_inicio: b.datahora_inicio || new Date().toISOString(), unidade: b.unidade || 'kg',
        dispositivo_id: b.dispositivo_id || null, origem: b.origem || 'pwa',
        sincronizado_em: b.sincronizado_em || new Date().toISOString() };
    if (b.etapa_id) row.etapa_id = b.etapa_id;
    if (b.id) row.id = b.id;  // id gerado no cliente (fila offline) → upsert idempotente
    const { data, error } = await supabase.from('apontamento').upsert(row).select().single();
    if (error) return erro500(res, error);
    // marca a OP como em produção
    await supabase.from('ordem_producao').update({ status: 'em_producao' }).eq('id', b.op_id).in('status', ['planejada','liberada']);
    // liga ao fluxo: se a OP ainda não está em etapa nenhuma, a sessão a "traz" para a etapa informada
    if (b.etapa_id) {
        try { await supabase.from('ordem_producao').update({ etapa_atual_id: b.etapa_id, etapa_desde: new Date().toISOString() }).eq('id', b.op_id).is('etapa_atual_id', null); }
        catch { /* coluna ausente — apontamento já gravado, segue */ }
    }
    res.json({ ok: true, apontamento: data });
});

app.put('/api/mf/apontamentos/:id', auth, mfEscrita, async (req, res) => {
    const updates = {};
    ['qtd_boa','qtd_refugo','qtd_retrabalho','datahora_fim','sincronizado_em','etapa_id'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (req.body.fechar && !updates.datahora_fim) updates.datahora_fim = new Date().toISOString();
    const { data, error } = await supabase.from('apontamento').update(updates).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
    let avanco = null;
    // ao fechar concluindo a etapa, avança a OP no fluxo (move o ponteiro etapa_atual)
    if (req.body.avancar && data?.op_id) {
        try { const r = await avancarOpFluxo(data.op_id); if (!r.erro) avanco = r; }
        catch { /* fluxo ausente — sessão já fechada, segue */ }
    }
    res.json({ ok: true, apontamento: data, avanco });
});

// indicador de adoção do apontamento (hoje): sessões, máquinas e operadores ativos
app.get('/api/mf/adocao', auth, async (_q, res) => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const [apsR, maqsR] = await Promise.all([
        supabase.from('apontamento').select('maquina_id,operador_id').gte('datahora_inicio', hoje.toISOString()),
        supabase.from('maquina').select('id').eq('ativo', true),
    ]);
    const aps = apsR.data || [], uniq = k => new Set(aps.map(a => a[k])).size;
    res.json({ sessoes_hoje: aps.length, maquinas_hoje: uniq('maquina_id'), operadores_hoje: uniq('operador_id'), maquinas_total: (maqsR.data || []).length });
});

// ── Parada ────────────────────────────────────────────────────
app.post('/api/mf/paradas', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.apontamento_id || !b.motivo_id) return res.status(400).json({ erro: 'apontamento_id e motivo_id obrigatórios' });
    const row = { apontamento_id: b.apontamento_id, motivo_id: b.motivo_id,
        datahora_inicio: b.datahora_inicio || new Date().toISOString(), datahora_fim: b.datahora_fim || null, observacao: b.observacao || null };
    if (b.id) row.id = b.id;
    const { data, error } = await supabase.from('parada').upsert(row).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, parada: data });
});
app.put('/api/mf/paradas/:id', auth, mfEscrita, async (req, res) => {
    const updates = {};
    ['datahora_fim','observacao'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (req.body.fechar && !updates.datahora_fim) updates.datahora_fim = new Date().toISOString();
    const { data, error } = await supabase.from('parada').update(updates).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    // assina as URLs das fotos (bucket privado)
    for (const nc of (data || [])) for (const f of (nc.foto || [])) f.url = await mfFotoUrl(f.url);
    res.json(data || []);
});

app.post('/api/mf/ncs', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.apontamento_id || !b.defeito_id || !b.qtd_afetada) return res.status(400).json({ erro: 'apontamento_id, defeito_id e qtd_afetada obrigatórios' });
    const { data: defeito, error: eDef } = await supabase.from('catalogo_defeito').select('*').eq('id', b.defeito_id).single();
    if (eDef || !defeito) return res.status(400).json({ erro: 'Defeito não encontrado no catálogo' });
    // sanidade: qtd afetada não pode passar do planejado da OP (pega erro grosseiro de digitação)
    const { data: apOp } = await supabase.from('apontamento').select('op:op_id(qtd_planejada)').eq('id', b.apontamento_id).single();
    const planejado = Number(apOp?.op?.qtd_planejada) || 0;
    if (planejado > 0 && Number(b.qtd_afetada) > planejado)
        return res.status(422).json({ erro: `Qtd afetada (${b.qtd_afetada}) maior que o planejado da OP (${planejado}). Confira o valor.` });
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
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json({ resumo: resumo.data || {}, rncs: data || [] });
});
app.post('/api/mf/rncs', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.titulo) return res.status(400).json({ erro: 'titulo obrigatório' });
    const row = { titulo: b.titulo, descricao: b.descricao || null, defeito_id: b.defeito_id || null, maquina_id: b.maquina_id || null,
        nc_id: b.nc_id || null, prioridade: b.prioridade || 'media' };
    const { data, error } = await supabase.from('rnc').insert(row).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, rnc: data });
});
app.put('/api/mf/rncs/:id', auth, mfEscrita, async (req, res) => {
    const b = req.body || {}, upd = {};
    ['prioridade','responsavel_id','prazo','causa_raiz','metodo_analise','acao_corretiva','eficaz','verificacao_obs','status','porque_1','porque_2','porque_3','porque_4','porque_5'].forEach(f => { if (b[f] !== undefined) upd[f] = b[f]; });
    // transições de estágio
    if (b.avancar === 'analise')     upd.status = 'em_analise';
    if (b.avancar === 'acao')      { upd.status = 'em_acao'; }
    if (b.avancar === 'verificacao') { upd.status = 'verificacao'; upd.acao_concluida_em = new Date().toISOString(); }
    if (b.avancar === 'fechar')    { upd.status = 'fechada'; upd.fechada_em = new Date().toISOString(); }
    if (b.avancar === 'cancelar')  { upd.status = 'cancelada'; upd.fechada_em = new Date().toISOString(); }
    const { data, error } = await supabase.from('rnc').update(upd).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
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
    if (!/^[0-9a-f-]{36}$/i.test(String(b.nc_id))) return res.status(400).json({ erro: 'nc_id inválido' });  // M12: bloqueia path traversal na chave do Storage
    let urlFinal = b.url, tamanho = b.tamanho_bytes || null;
    // data URL (base64) → upload ao Storage privado; guarda só o CAMINHO
    const m = /^data:(image\/\w+);base64,(.+)$/s.exec(b.url || '');
    if (m) {
        const mime = m[1], buffer = Buffer.from(m[2], 'base64');
        const ext = mime.split('/')[1].replace('jpeg', 'jpg');
        const nomeBase = /^[a-z0-9-]{1,40}$/i.test(String(b.id)) ? b.id : Date.now();  // M12: sanitiza o nome
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
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
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
        msg: `Classificação automática desligada: defina ANTHROPIC_API_KEY no .env e reinicie o servidor. ${termos.length} termo(s) seguem pendentes até lá.` });

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
        if (!r.ok) { console.error('Anthropic classificar:', j?.error); return res.status(502).json({ erro: 'Classificador indisponível no momento.' }); }
        const txt = (j.content || []).map(b => b.text || '').join('');
        sugestoes = JSON.parse(txt.replace(/```json|```/g, '').trim());
        if (!Array.isArray(sugestoes)) throw new Error('formato inesperado');
    } catch (e) { console.error('classificar parse:', e?.message || e); return res.status(502).json({ erro: 'Não consegui interpretar a resposta do classificador. Tente de novo.' }); }

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
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.get('/api/mf/pecas', auth, (_q, res) => mfLista(res, 'peca', '*', 'nome'));

// ── Etiqueta de anomalia (TPM tag do operador) ────────────────
app.get('/api/mf/etiquetas', auth, async (req, res) => {
    let q = supabase.from('etiqueta_anomalia')
        .select('*, maquina:maquina_id(codigo,nome), operador:operador_id(nome)')
        .order('aberta_em', { ascending: false });
    if (req.query.status) q = q.eq('status', req.query.status);
    else if (req.query.todas !== '1') q = q.neq('status', 'resolvida');   // ?todas=1 inclui resolvidas (Kanban)
    const { data, error } = await q.limit(200);
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json({ ok: true, etiqueta: data });
});
app.put('/api/mf/etiquetas/:id', auth, mfEscrita, async (req, res) => {
    const upd = {};
    ['status','ordem_manutencao_id'].forEach(f => { if (req.body[f] !== undefined) upd[f] = req.body[f]; });
    if (req.body.status === 'resolvida') upd.resolvida_em = new Date().toISOString();
    const { data, error } = await supabase.from('etiqueta_anomalia').update(upd).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, etiqueta: data });
});

// ── Ordem de manutenção (OM) ──────────────────────────────────
app.get('/api/mf/oms', auth, async (req, res) => {
    let q = supabase.from('ordem_manutencao')
        .select('*, maquina:maquina_id(codigo,nome), executor:executor_id(nome), consumo_peca(id,quantidade,peca:peca_id(nome))')
        .order('aberta_em', { ascending: false });
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q.limit(200);
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/mf/oms', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.maquina_id || !b.tipo || !b.descricao) return res.status(400).json({ erro: 'maquina_id, tipo e descricao obrigatórios' });
    const row = { maquina_id: b.maquina_id, componente_id: b.componente_id || null, plano_id: b.plano_id || null, parada_id: b.parada_id || null,
        tipo: b.tipo, prioridade: b.prioridade || 'media', status: b.status || 'aberta', descricao: b.descricao, executor_id: b.executor_id || null };
    const { data, error } = await supabase.from('ordem_manutencao').insert(row).select().single();
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json({ ok: true, componente: data });
});
app.post('/api/mf/pecas', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.codigo || !b.nome || !b.unidade) return res.status(400).json({ erro: 'codigo, nome e unidade obrigatórios' });
    const row = { codigo: b.codigo, nome: b.nome, categoria: b.categoria || null, unidade: b.unidade,
        estoque_atual: Number(b.estoque_atual) || 0, estoque_minimo: Number(b.estoque_minimo) || 0 };
    const { data, error } = await supabase.from('peca').upsert(row, { onConflict: 'codigo' }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, peca: data });
});
app.get('/api/mf/planos', auth, async (_q, res) => {
    const { data, error } = await supabase.from('plano_manutencao').select('*, maquina:maquina_id(codigo), componente:componente_id(nome)').eq('ativo', true).order('nome');
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/mf/planos', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.maquina_id || !b.nome || !b.tipo || !b.gatilho || !b.intervalo_valor || !b.intervalo_unidade) return res.status(400).json({ erro: 'campos obrigatórios faltando' });
    const row = { maquina_id: b.maquina_id, componente_id: b.componente_id || null, nome: b.nome, tipo: b.tipo, gatilho: b.gatilho,
        intervalo_valor: b.intervalo_valor, intervalo_unidade: b.intervalo_unidade, instrucoes: b.instrucoes || null, duracao_estimada_min: b.duracao_estimada_min || null };
    const { data, error } = await supabase.from('plano_manutencao').insert(row).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, plano: data });
});

// ── Checklist CIL (Limpeza, Inspeção, Lubrificação) ───────────
app.get('/api/mf/checklists', auth, async (_q, res) => {
    const { data, error } = await supabase.from('checklist_autonoma').select('*, checklist_item(*)').eq('ativo', true).order('nome');
    if (error) return erro500(res, error);
    (data || []).forEach(c => (c.checklist_item || []).sort((a, b) => a.ordem - b.ordem));
    res.json(data || []);
});
app.post('/api/mf/checklists', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.nome || !b.frequencia || !Array.isArray(b.itens) || !b.itens.length) return res.status(400).json({ erro: 'nome, frequencia e itens[] obrigatórios' });
    const { data: cl, error } = await supabase.from('checklist_autonoma').insert({ maquina_id: b.maquina_id || null, tipo_maquina: b.tipo_maquina || null, nome: b.nome, frequencia: b.frequencia }).select().single();
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/mf/lotes-fio', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.codigo) return res.status(400).json({ erro: 'codigo obrigatório' });
    const q = Number(b.qtd_recebida_kg) || 0;
    const row = { codigo: b.codigo, fornecedor: b.fornecedor || null, composicao: b.composicao || null, titulo_fio: b.titulo_fio || null,
        cor: b.cor || null, qtd_recebida_kg: q, qtd_disponivel_kg: q, data_recebimento: b.data_recebimento || new Date().toISOString() };
    const { data, error } = await supabase.from('lote_fio').upsert(row, { onConflict: 'codigo' }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, lote: data });
});
// registra consumo de um lote de fio numa sessão (baixa o disponível)
app.post('/api/mf/consumo-fio', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.apontamento_id || !b.lote_fio_id || !(Number(b.qtd_consumida_kg) > 0)) return res.status(400).json({ erro: 'apontamento_id, lote_fio_id e qtd_consumida_kg>0 obrigatórios' });
    const row = { apontamento_id: b.apontamento_id, lote_fio_id: b.lote_fio_id, qtd_consumida_kg: b.qtd_consumida_kg };
    if (b.id) row.id = b.id;   // idempotente: reenvio da fila offline não baixa o estoque 2×
    const { error: e1 } = await supabase.from('consumo_fio').insert(row);
    if (e1) {
        if (e1.code === '23505') return res.json({ ok: true, duplicado: true });  // já processado — não baixa de novo
        return erro500(res, e1);
    }
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
    if (error) return erro500(res, error);
    res.json(data || []);
});

// ── CEP (Controle Estatístico de Processo) — Onda 3 ───────────
app.post('/api/mf/medicao', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.produto_id || !b.tipo || b.valor === undefined) return res.status(400).json({ erro: 'produto_id, tipo e valor obrigatórios' });
    const row = { produto_id: b.produto_id, tipo: b.tipo, valor: b.valor, apontamento_id: b.apontamento_id || null,
        operador_id: b.operador_id || null, datahora: b.datahora || new Date().toISOString() };
    if (b.id) row.id = b.id;   // idempotente: fila offline pode reenviar
    const { data, error } = await supabase.from('medicao').upsert(row).select().single();
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'CEP ainda não criado. Rode mes_cep.sql.' });
    if (error) return erro500(res, error);
    res.json({ ok: true, medicao: data });
});
// define tolerância (± especificação) de um produto
app.put('/api/mf/produtos/:id/tolerancia', auth, mfEscrita, async (req, res) => {
    const upd = {};
    if (req.body.gramatura_tol !== undefined) upd.gramatura_tol = req.body.gramatura_tol;
    if (req.body.largura_tol   !== undefined) upd.largura_tol   = req.body.largura_tol;
    const { error } = await supabase.from('produto').update(upd).eq('id', req.params.id);
    if (error) return erro500(res, error);
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
    if (error) return erro500(res, error);
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
    // M2: se as views não existem, avisa (não devolve zeros silenciosos como 'tudo ok')
    const erroView = [oee, cnq, qual, rnc].find(r => r.error && /schema cache|does not exist|relation/i.test(r.error.message || ''));
    if (erroView) return res.status(503).json({ erro: 'Views do painel ainda não criadas — rode os SQLs (mes_indicadores/mes_rnc/mes_metas).' });
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

// ── Rastreabilidade multi-etapa (Onda 6) ──────────────────────
app.get('/api/mf/lotes-producao', auth, async (_q, res) => {
    const { data, error } = await supabase.from('lote_producao').select('*, produto:produto_id(codigo)').order('criado_em', { ascending: false }).limit(300);
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'Multi-etapa ainda não criada. Rode mes_escala.sql.' });
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/mf/lotes-producao', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.codigo || !b.etapa) return res.status(400).json({ erro: 'codigo e etapa obrigatórios' });
    const q = Number(b.qtd_kg) || 0;
    const row = { codigo: b.codigo, apontamento_id: b.apontamento_id || null, produto_id: b.produto_id || null, etapa: b.etapa, qtd_kg: q, qtd_disponivel_kg: q };
    const { data, error } = await supabase.from('lote_producao').upsert(row, { onConflict: 'codigo' }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, lote: data });
});
app.post('/api/mf/consumo-lote', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.apontamento_id || !b.lote_producao_id || !(Number(b.qtd_consumida_kg) > 0)) return res.status(400).json({ erro: 'apontamento_id, lote_producao_id e qtd>0 obrigatórios' });
    const { error } = await supabase.from('consumo_lote').insert({ apontamento_id: b.apontamento_id, lote_producao_id: b.lote_producao_id, qtd_consumida_kg: b.qtd_consumida_kg });
    if (error) return erro500(res, error);
    const { data: lp } = await supabase.from('lote_producao').select('qtd_disponivel_kg').eq('id', b.lote_producao_id).single();
    if (lp) await supabase.from('lote_producao').update({ qtd_disponivel_kg: Math.max(0, Number(lp.qtd_disponivel_kg) - Number(b.qtd_consumida_kg)) }).eq('id', b.lote_producao_id);
    res.json({ ok: true });
});
// genealogia recursiva: cadeia de etapas de um lote final
app.get('/api/mf/genealogia-etapas/:lote_id', auth, async (req, res) => {
    const { data, error } = await supabase.from('vw_genealogia_etapas').select('*').eq('lote_raiz', req.params.lote_id).order('nivel');
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'Multi-etapa ainda não criada. Rode mes_escala.sql.' });
    if (error) return erro500(res, error);
    res.json(data || []);
});
// refresh da view materializada de OEE (escala)
app.post('/api/mf/refresh', auth, mfEscrita, async (_req, res) => {
    const { error } = await supabase.rpc('refresh_mv_oee').catch(() => ({ error: { message: 'rpc ausente' } }));
    // fallback: a maioria dos projetos não tem a RPC; informa o comando manual
    if (error) return res.json({ ok: false, info: 'Para atualizar a matview rode no SQL: REFRESH MATERIALIZED VIEW mv_oee;' });
    res.json({ ok: true });
});

// ── KPIs estratégicos + OKRs ──────────────────────────────────
// métricas atuais do sistema (insumo dos KPIs e dos OKRs)
async function mfMetricas() {
    const [oee, cnq, qual, rnc, cep, cil, mtbf, mttr, ap] = await Promise.all([
        supabase.from('vw_oee').select('oee'),
        supabase.from('vw_cnq_resumo').select('custo_total').single(),
        supabase.from('vw_qualidade_resumo').select('total_ncs').single(),
        supabase.from('vw_rnc_resumo').select('fechadas,fechadas_eficazes').single(),
        supabase.from('vw_cep_capabilidade').select('cpk'),
        supabase.from('vw_cil_cumprimento').select('pct_cumprimento'),
        supabase.from('vw_mtbf').select('mtbf_horas'),
        supabase.from('vw_mttr').select('mttr_min'),
        supabase.from('apontamento').select('qtd_boa,qtd_refugo,qtd_retrabalho'),
    ]);
    const avg = (arr, k) => { const v = (arr || []).map(x => x[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((s, x) => s + Number(x), 0) / v.length * 10) / 10 : null; };
    const oeeVals = (oee.data || []).map(o => o.oee).filter(v => v != null);
    const cepVals = (cep.data || []).map(c => c.cpk).filter(v => v != null);
    const boa = (ap.data || []).reduce((s, r) => s + Number(r.qtd_boa || 0), 0);
    const totalProd = (ap.data || []).reduce((s, r) => s + Number(r.qtd_boa || 0) + Number(r.qtd_refugo || 0) + Number(r.qtd_retrabalho || 0), 0);
    return {
        oee:           oeeVals.length ? Math.round(oeeVals.reduce((s, v) => s + v, 0) / oeeVals.length * 10) / 10 : null,
        cnq:           cnq.data?.custo_total ?? 0,
        fpy:           totalProd > 0 ? Math.round(boa / totalProd * 1000) / 10 : null,
        ncs:           qual.data?.total_ncs ?? 0,
        cpk_ok:        cepVals.length ? Math.round(cepVals.filter(c => c >= 1.33).length / cepVals.length * 1000) / 10 : null,  // % capaz
        rnc_eficacia:  rnc.data?.fechadas ? Math.round(rnc.data.fechadas_eficazes / rnc.data.fechadas * 1000) / 10 : null,
        cil:           avg(cil.data, 'pct_cumprimento'),
        mtbf:          avg(mtbf.data, 'mtbf_horas'),
        mttr:          avg(mttr.data, 'mttr_min'),
    };
}
app.get('/api/mf/metricas', auth, async (_q, res) => {
    try { res.json({ metricas: await mfMetricas(), metas: await mfMetas() }); }
    catch (e) { res.status(503).json({ erro: 'Indicadores incompletos — rode os SQLs pendentes. ' + e.message }); }
});

app.get('/api/mf/okrs', auth, async (_q, res) => {
    const obj = await supabase.from('okr_objetivo').select('*, okr_resultado(*)').order('criado_em', { ascending: false });
    if (obj.error && /schema cache|does not exist/i.test(obj.error.message || '')) return res.status(503).json({ erro: 'OKRs ainda não criados. Rode mes_okr.sql.' });
    if (obj.error) return res.status(500).json({ erro: obj.error.message });
    const m = await mfMetricas().catch(() => ({}));
    const progresso = (kr) => {
        const atual = kr.metrica === 'manual' ? (kr.valor_manual ?? kr.baseline) : (m[kr.metrica] ?? kr.baseline);
        const base = Number(kr.baseline), meta = Number(kr.meta), a = Number(atual);
        let p;
        if (meta === base) p = (kr.direcao === 'subir' ? a >= meta : a <= meta) ? 100 : 0;
        else p = kr.direcao === 'subir' ? (a - base) / (meta - base) : (base - a) / (base - meta);
        return { atual, progresso: Math.max(0, Math.min(100, Math.round(p * 100))) };
    };
    (obj.data || []).forEach(o => (o.okr_resultado || []).forEach(kr => Object.assign(kr, progresso(kr))));
    // progresso do objetivo = média dos KRs
    (obj.data || []).forEach(o => { const krs = o.okr_resultado || []; o.progresso = krs.length ? Math.round(krs.reduce((s, k) => s + k.progresso, 0) / krs.length) : 0; });
    res.json(obj.data || []);
});
app.post('/api/mf/okrs', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.titulo) return res.status(400).json({ erro: 'titulo obrigatório' });
    const { data, error } = await supabase.from('okr_objetivo').insert({ titulo: b.titulo, descricao: b.descricao || null, periodo: b.periodo || null, responsavel: b.responsavel || null }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, objetivo: data });
});
app.post('/api/mf/okrs/:id/kr', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.descricao || b.meta === undefined) return res.status(400).json({ erro: 'descricao e meta obrigatórios' });
    const row = { objetivo_id: req.params.id, descricao: b.descricao, metrica: b.metrica || 'manual', unidade: b.unidade || null,
        direcao: b.direcao || 'subir', baseline: Number(b.baseline) || 0, meta: Number(b.meta), valor_manual: b.valor_manual != null ? Number(b.valor_manual) : null };
    const { data, error } = await supabase.from('okr_resultado').insert(row).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, kr: data });
});
app.put('/api/mf/kr/:id', auth, mfEscrita, async (req, res) => {
    const upd = {};
    ['valor_manual','meta','baseline','descricao','direcao'].forEach(f => { if (req.body[f] !== undefined) upd[f] = req.body[f]; });
    const { error } = await supabase.from('okr_resultado').update(upd).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
app.delete('/api/mf/okrs/:id', auth, mfEscrita, async (req, res) => {
    const { error } = await supabase.from('okr_objetivo').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── BPM: fluxo de processo (etapas editáveis) ─────────────────
app.get('/api/mf/etapas-processo', auth, async (_q, res) => {
    const { data, error } = await supabase.from('etapa_processo').select('*').eq('ativo', true).order('ordem');
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'Fluxo de processo não inicializado. Rode mes_fluxo.sql.' });
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/mf/etapas-processo', auth, mfEscrita, async (req, res) => {
    const nome = (req.body?.nome || '').trim();
    if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
    const { data: max } = await supabase.from('etapa_processo').select('ordem').eq('ativo', true).order('ordem', { ascending: false }).limit(1);
    const ordem = (max?.[0]?.ordem || 0) + 1;
    const { data, error } = await supabase.from('etapa_processo').insert({ nome, ordem, cor: req.body?.cor || null }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, etapa: data });
});
app.put('/api/mf/etapas-processo/:id', auth, mfEscrita, async (req, res) => {
    const upd = {};
    ['nome', 'ordem', 'ativo', 'cor', 'limite_wip'].forEach(f => { if (req.body[f] !== undefined) upd[f] = req.body[f]; });
    if (upd.limite_wip === '' || upd.limite_wip === null) upd.limite_wip = null;
    if (upd.nome !== undefined) upd.nome = String(upd.nome).trim();
    const { error } = await supabase.from('etapa_processo').update(upd).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
app.delete('/api/mf/etapas-processo/:id', auth, mfEscrita, async (req, res) => {
    const { error } = await supabase.from('etapa_processo').update({ ativo: false }).eq('id', req.params.id);  // exclusão lógica
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── WIP / Kanban de produção (OP avança pelo fluxo) ───────────
// fecha o movimento aberto `m` e abre o próximo (ou conclui a OP na última etapa)
// avança a OP no fluxo movendo o ponteiro etapa_atual (ou conclui na última etapa)
// roteiro do produto = etapas que ele usa (na ordem). Sem produto_etapa → todas as etapas ativas.
async function roteiroDoProduto(produto_id, todasEtapas) {
    const all = todasEtapas || (await supabase.from('etapa_processo').select('id,nome,ordem').eq('ativo', true).order('ordem')).data || [];
    if (!produto_id) return all;
    const { data: pe } = await supabase.from('produto_etapa').select('etapa_id').eq('produto_id', produto_id);
    if (!pe?.length) return all;  // sem roteiro definido = usa todas (compatível)
    const set = new Set(pe.map(x => x.etapa_id));
    return all.filter(e => set.has(e.id));
}
async function roteiroDaOp(op_id) {
    const { data: op } = await supabase.from('ordem_producao').select('produto_id').eq('id', op_id).single();
    return roteiroDoProduto(op?.produto_id);
}
async function avancarOpFluxo(op_id) {
    const { data: op } = await supabase.from('ordem_producao').select('etapa_atual_id, etapa:etapa_atual_id(ordem)').eq('id', op_id).single();
    if (!op?.etapa_atual_id) return { erro: 'OP não está no fluxo.' };
    const rot = await roteiroDaOp(op_id);  // respeita o roteiro do produto (pula etapas que ele não usa)
    const prox = rot.find(e => e.ordem > (op.etapa?.ordem ?? 0));
    if (prox) {
        await supabase.from('ordem_producao').update({ etapa_atual_id: prox.id, etapa_desde: new Date().toISOString() }).eq('id', op_id);
        return { proxima: prox.nome };
    }
    await supabase.from('ordem_producao').update({ etapa_atual_id: null, etapa_desde: null, status: 'concluida' }).eq('id', op_id);  // saiu da última etapa do roteiro
    return { concluida: true };
}
// quadro: por etapa, as OPs cujo etapa_atual = etapa; sessão aberta = "em processo". Lead/throughput vêm do apontamento.
app.get('/api/mf/wip', auth, async (_q, res) => {
    const etapasR = await supabase.from('etapa_processo').select('id,nome,ordem,cor,limite_wip').eq('ativo', true).order('ordem');
    if (etapasR.error && /schema cache|does not exist|column/i.test(etapasR.error.message || '')) return res.status(503).json({ erro: 'WIP não inicializado. Rode mes_wip_unificado.sql.' });
    if (etapasR.error) return res.status(500).json({ erro: etapasR.error.message });
    let ops;
    try {  // paginado (sem teto de 1000) — senão o board perde OPs em carteira grande
        ops = await fetchAllSelect('ordem_producao', 'id,numero,qtd_planejada,unidade,status,etapa_atual_id,etapa_desde, produto:produto_id(descricao)', q => q.not('status', 'in', '(concluida,cancelada)'));
    } catch (e) {
        if (/column|does not exist/i.test(e.message || '')) return res.status(503).json({ erro: 'WIP não inicializado. Rode mes_wip_unificado.sql.' });
        return erro500(res, e);
    }
    const [abertasR, ltR, tpR] = await Promise.all([
        supabase.from('apontamento').select('op_id,etapa_id, operador:operador_id(nome)').is('datahora_fim', null),  // sessões abertas = em processo
        supabase.from('vw_wip_leadtime').select('*'),
        supabase.from('vw_wip_throughput').select('*'),
    ]);
    const sessByOp = {}; (abertasR.data || []).forEach(a => { sessByOp[a.op_id] = a; });
    const lt = Object.fromEntries((ltR.data || []).map(r => [r.etapa_id, r]));
    const tp = Object.fromEntries((tpR.data || []).map(r => [r.etapa_id, r]));
    const board = (etapasR.data || []).map(e => {
        const cards = ops.filter(o => o.etapa_atual_id === e.id).map(o => {
            const s = sessByOp[o.id];
            return { op_id: o.id, numero: o.numero, produto: o.produto?.descricao || '', unidade: o.unidade || '',
                qtd: Number(o.qtd_planejada || 0), desde: o.etapa_desde, em_processo: !!s, operador: s?.operador?.nome || null };
        });
        const qtd_wip = cards.reduce((s, c) => s + c.qtd, 0);
        const qtdDia = Number(tp[e.id]?.qtd_dia || 0);
        const lead_little_dias = qtdDia > 0 && qtd_wip > 0 ? Math.round(qtd_wip / qtdDia * 10) / 10 : null;  // Lei de Little
        return { etapa_id: e.id, nome: e.nome, ordem: e.ordem, cor: e.cor, limite_wip: e.limite_wip,
            ops: cards.length, qtd_wip, em_processo: cards.filter(c => c.em_processo).length,
            gargalo: e.limite_wip != null && cards.length > e.limite_wip,
            lead_horas: lt[e.id]?.horas_medias ?? null, throughput_dia: qtdDia || null, lead_little_dias, cards };
    });
    const disponiveis = ops.filter(o => !o.etapa_atual_id);  // OPs ainda fora do fluxo
    const lead_total_horas = Math.round(Object.values(lt).reduce((s, r) => s + Number(r.horas_medias || 0), 0) * 10) / 10;
    const lead_little_total = Math.round(board.reduce((s, b) => s + Number(b.lead_little_dias || 0), 0) * 10) / 10;
    res.json({ board, disponiveis, lead_total_horas, lead_little_total });
});
// coloca a OP no fluxo (1ª etapa, ou etapa_id informado)
app.post('/api/mf/wip/iniciar', auth, mfEscrita, async (req, res) => {
    const { op_id } = req.body || {};
    if (!op_id) return res.status(400).json({ erro: 'op_id obrigatório' });
    const { data: op } = await supabase.from('ordem_producao').select('etapa_atual_id').eq('id', op_id).single();
    if (op?.etapa_atual_id) return res.status(409).json({ erro: 'Esta OP já está no fluxo.' });
    let etapaId = req.body.etapa_id;
    if (!etapaId) { const rot = await roteiroDaOp(op_id); etapaId = rot[0]?.id; }  // 1ª etapa do roteiro do produto
    if (!etapaId) return res.status(400).json({ erro: 'Produto sem roteiro/etapas.' });
    const { error } = await supabase.from('ordem_producao').update({ etapa_atual_id: etapaId, etapa_desde: new Date().toISOString() }).eq('id', op_id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
// entra com várias OPs de uma vez — cada uma na 1ª etapa do SEU roteiro. Só as que estão fora do fluxo.
app.post('/api/mf/wip/iniciar-lote', auth, mfEscrita, async (req, res) => {
    const ids = Array.isArray(req.body?.op_ids) ? req.body.op_ids : [];
    if (!ids.length) return res.status(400).json({ erro: 'op_ids obrigatório' });
    const { data: ops } = await supabase.from('ordem_producao').select('id,produto_id').in('id', ids).is('etapa_atual_id', null).not('status', 'in', '(concluida,cancelada)');
    if (!ops?.length) return res.json({ ok: true, inseridas: 0 });
    const todas = (await supabase.from('etapa_processo').select('id,nome,ordem').eq('ativo', true).order('ordem')).data || [];
    const prodIds = [...new Set(ops.map(o => o.produto_id).filter(Boolean))];
    const { data: pe } = prodIds.length ? await supabase.from('produto_etapa').select('produto_id,etapa_id').in('produto_id', prodIds) : { data: [] };
    const rotProd = {}; (pe || []).forEach(x => { (rotProd[x.produto_id] = rotProd[x.produto_id] || new Set()).add(x.etapa_id); });
    const firstDe = pid => { const set = rotProd[pid]; const rot = set ? todas.filter(e => set.has(e.id)) : todas; return rot[0]?.id; };
    const porEtapa = {};
    for (const o of ops) { const f = firstDe(o.produto_id); if (f) (porEtapa[f] = porEtapa[f] || []).push(o.id); }
    let inseridas = 0; const now = new Date().toISOString();
    for (const [etapaId, opIds] of Object.entries(porEtapa)) {
        const { data } = await supabase.from('ordem_producao').update({ etapa_atual_id: etapaId, etapa_desde: now }).in('id', opIds).select('id');
        inseridas += (data || []).length;
    }
    res.json({ ok: true, inseridas });
});
// avança a OP para a próxima etapa (move o ponteiro)
app.post('/api/mf/wip/avancar', auth, mfEscrita, async (req, res) => {
    const { op_id } = req.body || {};
    if (!op_id) return res.status(400).json({ erro: 'op_id obrigatório' });
    const r = await avancarOpFluxo(op_id);
    if (r.erro) return res.status(404).json(r);
    res.json({ ok: true, ...r });
});
// volta a OP para a etapa anterior (retrabalho)
app.post('/api/mf/wip/voltar', auth, mfEscrita, async (req, res) => {
    const { op_id } = req.body || {};
    if (!op_id) return res.status(400).json({ erro: 'op_id obrigatório' });
    const { data: op } = await supabase.from('ordem_producao').select('etapa_atual_id, etapa:etapa_atual_id(ordem)').eq('id', op_id).single();
    if (!op?.etapa_atual_id) return res.status(404).json({ erro: 'OP não está no fluxo.' });
    const rot = await roteiroDaOp(op_id);  // etapa anterior NO ROTEIRO do produto
    const ant = [...rot].reverse().find(e => e.ordem < (op.etapa?.ordem ?? 0));
    if (!ant) return res.status(400).json({ erro: 'Já está na primeira etapa.' });
    await supabase.from('ordem_producao').update({ etapa_atual_id: ant.id, etapa_desde: new Date().toISOString() }).eq('id', op_id);
    res.json({ ok: true, anterior: ant.nome });
});
// retira a OP do fluxo (zera o ponteiro)
app.delete('/api/mf/wip/:op_id', auth, mfEscrita, async (req, res) => {
    const { error } = await supabase.from('ordem_producao').update({ etapa_atual_id: null, etapa_desde: null }).eq('id', req.params.op_id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
// roteiro do produto (por código): etapas marcando quais o produto usa
app.get('/api/mf/produto/:codigo/roteiro', auth, async (req, res) => {
    const { data: prod } = await supabase.from('produto').select('id,codigo,descricao').eq('codigo', req.params.codigo).limit(1).single();
    if (!prod) return res.status(404).json({ erro: 'produto não encontrado' });
    const etapas = (await supabase.from('etapa_processo').select('id,nome,ordem').eq('ativo', true).order('ordem')).data || [];
    const peR = await supabase.from('produto_etapa').select('etapa_id').eq('produto_id', prod.id);
    if (peR.error && /schema cache|does not exist/i.test(peR.error.message || '')) return res.status(503).json({ erro: 'Roteiro não inicializado. Rode mes_roteiro.sql.' });
    const set = new Set((peR.data || []).map(x => x.etapa_id));
    const usaTodas = set.size === 0;  // sem linhas = usa todas (padrão)
    res.json({ produto: prod, padrao: usaTodas, etapas: etapas.map(e => ({ ...e, no_roteiro: usaTodas || set.has(e.id) })) });
});
// define o roteiro (array etapa_ids). Marcar todas (ou nenhuma) → volta ao padrão "todas".
app.put('/api/mf/produto/:codigo/roteiro', auth, mfEscrita, async (req, res) => {
    const { data: prod } = await supabase.from('produto').select('id').eq('codigo', req.params.codigo).limit(1).single();
    if (!prod) return res.status(404).json({ erro: 'produto não encontrado' });
    const etapaIds = Array.isArray(req.body?.etapa_ids) ? req.body.etapa_ids : [];
    const total = (await supabase.from('etapa_processo').select('id').eq('ativo', true)).data?.length || 0;
    await supabase.from('produto_etapa').delete().eq('produto_id', prod.id);
    if (etapaIds.length && etapaIds.length < total) {  // só grava se for um subconjunto real
        const { error } = await supabase.from('produto_etapa').insert(etapaIds.map(eid => ({ produto_id: prod.id, etapa_id: eid })));
        if (error) return erro500(res, error);
    }
    res.json({ ok: true, padrao: !(etapaIds.length && etapaIds.length < total) });
});

// ── Fluxo no tempo: throughput/lead por dia + WIP/gargalo por etapa ──────────
app.get('/api/mf/fluxo-tempo', auth, async (req, res) => {
    const dias = Math.min(60, Math.max(7, Number(req.query.dias) || 14));
    const desde = new Date(Date.now() - dias * 864e5).toISOString();
    const etapasR = await supabase.from('etapa_processo').select('id,nome,ordem,limite_wip').eq('ativo', true).order('ordem');
    if (etapasR.error && /schema cache|does not exist|column/i.test(etapasR.error.message || '')) return res.status(503).json({ erro: 'Fluxo não inicializado. Rode mes_wip_unificado.sql.' });
    if (etapasR.error) return res.status(500).json({ erro: etapasR.error.message });
    let aps, opsData, ltR;
    try {  // apontamento e OPs paginados (sem teto de 1000) — senão throughput/lead saem subcontados
        [aps, opsData, ltR] = await Promise.all([
            fetchAllSelect('apontamento', 'etapa_id,datahora_inicio,datahora_fim,qtd_boa', q => q.not('datahora_fim', 'is', null).gte('datahora_fim', desde)),
            fetchAllSelect('ordem_producao', 'etapa_atual_id,qtd_planejada', q => q.not('status', 'in', '(concluida,cancelada)').not('etapa_atual_id', 'is', null)),
            supabase.from('vw_wip_leadtime').select('*'),
        ]);
    } catch (e) { return erro500(res, e); }
    const opsR = { data: opsData };
    // série diária (throughput + lead time médio)
    const byDay = {};
    for (const a of aps) {
        const d = (a.datahora_fim || '').slice(0, 10); if (!d) continue;
        (byDay[d] = byDay[d] || { qtd: 0, sessoes: 0, leadSum: 0 });
        byDay[d].qtd += Number(a.qtd_boa || 0); byDay[d].sessoes++;
        byDay[d].leadSum += (new Date(a.datahora_fim) - new Date(a.datahora_inicio)) / 3.6e6;
    }
    const serie = [];
    for (let i = dias - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); const b = byDay[d];
        serie.push({ dia: d, qtd: b ? Math.round(b.qtd) : 0, sessoes: b ? b.sessoes : 0, lead_h: b && b.sessoes ? Math.round(b.leadSum / b.sessoes * 10) / 10 : 0 });
    }
    // por etapa: WIP atual + throughput 7d + lead + dias de fila (Little)
    const ltMap = Object.fromEntries((ltR.data || []).map(r => [r.etapa_id, r]));
    const desde7 = Date.now() - 7 * 864e5, tp7 = {};
    for (const a of aps) if (new Date(a.datahora_fim).getTime() >= desde7) tp7[a.etapa_id] = (tp7[a.etapa_id] || 0) + Number(a.qtd_boa || 0);
    const wipByEtapa = {};
    (opsR.data || []).forEach(o => { (wipByEtapa[o.etapa_atual_id] = wipByEtapa[o.etapa_atual_id] || { ops: 0, qtd: 0 }); wipByEtapa[o.etapa_atual_id].ops++; wipByEtapa[o.etapa_atual_id].qtd += Number(o.qtd_planejada || 0); });
    const etapas = (etapasR.data || []).map(e => {
        const w = wipByEtapa[e.id] || { ops: 0, qtd: 0 };
        const thr = (tp7[e.id] || 0) / 7;
        const dias_fila = thr > 0 && w.qtd > 0 ? Math.round(w.qtd / thr * 10) / 10 : null;
        return { nome: e.nome, ordem: e.ordem, wip_ops: w.ops, wip_qtd: w.qtd, throughput_dia: Math.round(thr * 10) / 10, lead_horas: ltMap[e.id]?.horas_medias ?? null, dias_fila };
    });
    const gargalo = etapas.filter(e => e.dias_fila != null).sort((a, b) => b.dias_fila - a.dias_fila)[0]
        || etapas.filter(e => e.wip_ops > 0).sort((a, b) => b.wip_qtd - a.wip_qtd)[0] || null;
    res.json({ serie, etapas, gargalo, throughput_7d: Math.round(Object.values(tp7).reduce((s, v) => s + v, 0)), dias });
});

// ── Tempo padrão (seg/unidade por etapa, opcional por produto) ───────────────
app.get('/api/mf/tempos', auth, async (_q, res) => {
    const r = await supabase.from('tempo_padrao').select('id,etapa_id,produto_id,seg_por_unidade');
    if (r.error && /schema cache|does not exist/i.test(r.error.message || '')) return res.status(503).json({ erro: 'Tempo padrão não inicializado. Rode mes_leva2.sql.' });
    if (r.error) return res.status(500).json({ erro: r.error.message });
    res.json(r.data || []);
});
app.put('/api/mf/tempos', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.etapa_id) return res.status(400).json({ erro: 'etapa_id obrigatório' });
    const seg = Number(b.seg_por_unidade) || 0, prod = b.produto_id || null;
    let q = supabase.from('tempo_padrao').select('id').eq('etapa_id', b.etapa_id);
    q = prod ? q.eq('produto_id', prod) : q.is('produto_id', null);
    const { data: ex } = await q.limit(1);
    const r = ex?.length
        ? await supabase.from('tempo_padrao').update({ seg_por_unidade: seg }).eq('id', ex[0].id)
        : await supabase.from('tempo_padrao').insert({ etapa_id: b.etapa_id, produto_id: prod, seg_por_unidade: seg });
    if (r.error) return res.status(500).json({ erro: r.error.message });
    res.json({ ok: true });
});
// Capacidade × demanda: por etapa, horas necessárias (backlog) vs disponíveis/dia
app.get('/api/mf/capacidade', auth, async (req, res) => {
    const horasDia = Math.min(24, Math.max(1, Number(req.query.horas) || 8));
    const etapasR = await supabase.from('etapa_processo').select('id,nome,ordem').eq('ativo', true).order('ordem');
    if (etapasR.error && /schema cache|does not exist|column/i.test(etapasR.error.message || '')) return res.status(503).json({ erro: 'Fluxo não inicializado.' });
    if (etapasR.error) return res.status(500).json({ erro: etapasR.error.message });
    let opsAll;
    try {  // OPs ativas paginadas (sem teto de 1000)
        opsAll = await fetchAllSelect('ordem_producao', 'produto_id,qtd_planejada, etapa:etapa_atual_id(ordem)', q => q.not('status', 'in', '(concluida,cancelada)'));
    } catch (e) { return erro500(res, e); }
    const [maqsR, temposR, peR] = await Promise.all([
        supabase.from('maquina').select('id,etapa_id').eq('ativo', true),
        supabase.from('tempo_padrao').select('etapa_id,produto_id,seg_por_unidade'),
        supabase.from('produto_etapa').select('produto_id,etapa_id'),
    ]);
    const opsR = { data: opsAll };
    if (temposR.error && /schema cache|does not exist/i.test(temposR.error.message || '')) return res.status(503).json({ erro: 'Tempo padrão não inicializado. Rode mes_leva2.sql.' });
    const maqCount = {}; (maqsR.data || []).forEach(m => { if (m.etapa_id) maqCount[m.etapa_id] = (maqCount[m.etapa_id] || 0) + 1; });
    const stdDef = {}, stdOv = {};
    (temposR.data || []).forEach(t => { if (t.produto_id) stdOv[t.etapa_id + '|' + t.produto_id] = Number(t.seg_por_unidade); else stdDef[t.etapa_id] = Number(t.seg_por_unidade); });
    const rotProd = {}; (peR.data || []).forEach(x => { (rotProd[x.produto_id] = rotProd[x.produto_id] || new Set()).add(x.etapa_id); });  // roteiro: produto → etapas que usa
    const usaEtapa = (prod, etapaId) => { const set = rotProd[prod]; return !set || set.size === 0 || set.has(etapaId); };  // sem roteiro = usa todas
    const ops = opsR.data || [];
    const etapas = (etapasR.data || []).map(e => {
        const std = prod => stdOv[e.id + '|' + prod] ?? stdDef[e.id] ?? 0;
        let req_seg = 0;
        for (const o of ops) {
            const ord = o.etapa?.ordem || 0;  // 0 = ainda não entrou no fluxo → precisa de todas as do roteiro
            if ((ord === 0 || ord <= e.ordem) && usaEtapa(o.produto_id, e.id)) req_seg += Number(o.qtd_planejada || 0) * std(o.produto_id);
        }
        const maquinas = maqCount[e.id] || 0, req_h = req_seg / 3600, disp = maquinas * horasDia;
        const dias = disp > 0 && req_h > 0 ? Math.round(req_h / disp * 10) / 10 : (req_h > 0 ? null : 0);
        return { etapa_id: e.id, nome: e.nome, ordem: e.ordem, maquinas, seg_padrao: stdDef[e.id] ?? null,
            horas_necessarias: Math.round(req_h * 10) / 10, horas_disp_dia: disp, dias_para_zerar: dias, sem_padrao: stdDef[e.id] == null };
    });
    const gargalo = etapas.filter(e => e.dias_para_zerar != null).sort((a, b) => b.dias_para_zerar - a.dias_para_zerar)[0] || null;
    res.json({ etapas, horasDia, gargalo, ops_ativas: ops.length });
});

// ── Rastreabilidade por código da peça: todo o histórico do código ───────────
app.get('/api/mf/rastreio/:codigo', auth, async (req, res) => {
    const cod = String(req.params.codigo || '').trim();
    if (!cod) return res.status(400).json({ erro: 'código obrigatório' });
    let produto = (await supabase.from('produto').select('*').eq('codigo', cod).limit(1)).data?.[0];
    let viaOp = null;
    if (!produto) {  // se não for código de produto, tenta como número de OP
        const op = (await supabase.from('ordem_producao').select('produto_id,numero').eq('numero', cod).limit(1)).data?.[0];
        if (op) { produto = (await supabase.from('produto').select('*').eq('id', op.produto_id).limit(1)).data?.[0]; viaOp = op.numero; }
    }
    if (!produto) return res.json({ encontrado: false, codigo: cod });
    const ops = (await supabase.from('ordem_producao').select('id,numero,qtd_planejada,unidade,status,data_abertura,data_prevista,origem, etapa:etapa_atual_id(nome,ordem)').eq('produto_id', produto.id).order('numero')).data || [];
    const opIds = ops.map(o => o.id);
    let aps = [], ncs = [], paradas = [], consumo = [];
    if (opIds.length) {
        aps = (await supabase.from('apontamento').select('id,op_id,datahora_inicio,datahora_fim,qtd_boa,qtd_refugo,qtd_retrabalho, maquina:maquina_id(codigo,nome), operador:operador_id(nome), turno:turno_id(codigo), etapa:etapa_id(nome,ordem)').in('op_id', opIds).order('datahora_inicio')).data || [];
        const apIds = aps.map(a => a.id);
        if (apIds.length) {
            ncs = (await supabase.from('nao_conformidade').select('id,apontamento_id,qtd_afetada,disposicao,severidade_aplicada,datahora, defeito:defeito_id(codigo,descricao,categoria)').in('apontamento_id', apIds).order('datahora')).data || [];
            paradas = (await supabase.from('parada').select('id,apontamento_id,datahora_inicio,datahora_fim, motivo:motivo_id(descricao)').in('apontamento_id', apIds)).data || [];
            consumo = (await supabase.from('consumo_fio').select('apontamento_id,qtd_consumida_kg, lote:lote_fio_id(codigo,fornecedor)').in('apontamento_id', apIds)).data || [];
        }
    }
    res.json({ encontrado: true, viaOp, produto, ops, aps, ncs, paradas, consumo });
});

// ── Importar Ordens de Produção do ERP (relatório em blocos) ──
function _opErpData(s) { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; }  // dd/mm/yyyy → ISO
function _opErpStatus(s) {
    const t = String(s || '').toLowerCase();
    if (/conclu|encerr|finaliz/.test(t)) return 'concluida';
    if (/cancel/.test(t)) return 'cancelada';
    if (/em produ|produzind/.test(t)) return 'em_producao';
    if (/libe?r/.test(t)) return 'liberada';
    if (/pausa/.test(t)) return 'pausada';
    return 'planejada';
}
// rows: [{numero, prod_codigo, descricao, cor, marca, tamanho, qtd, emissao, previsao, previsao_final, status}]
app.post('/api/mf/importar-ops', auth, mfEscrita, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const confirmar = !!req.body?.confirmar;
    const unidade = ['kg', 'm', 'pc'].includes(req.body?.unidade) ? req.body.unidade : 'pc';
    if (!rows.length) return res.status(400).json({ erro: 'Nenhuma OP reconhecida no arquivo.' });
    // dedup por número dentro do próprio arquivo (mantém o primeiro)
    const vistos = new Set(); const limpas = [];
    for (const r of rows) { const n = String(r.numero || '').trim(); if (!n || vistos.has(n)) continue; vistos.add(n); limpas.push(r); }
    let existsOps, prods;
    try {  // paginado (sem teto de 1000) — senão OP/produto além de 1000 é tratado como novo → duplica (A6)
        [existsOps, prods] = await Promise.all([fetchAllSelect('ordem_producao', 'numero'), fetchAllSelect('produto', 'id,codigo')]);
    } catch (e) { return erro500(res, e); }
    const opSet = new Set((existsOps || []).map(o => String(o.numero)));
    const prodMap = new Map((prods || []).map(p => [String(p.codigo), p.id]));
    const novas = [], existentes = [], prodNovos = new Map();
    for (const r of limpas) {
        const numero = String(r.numero).trim();
        if (opSet.has(numero)) { existentes.push(numero); continue; }
        const cod = String(r.prod_codigo || '').trim();
        const prodNovo = !!cod && !prodMap.has(cod);
        if (prodNovo && !prodNovos.has(cod)) prodNovos.set(cod, { codigo: cod, descricao: r.descricao || cod, cor: r.cor || null, marca: r.marca || null, tamanho: r.tamanho || null });
        novas.push({ numero, prod_codigo: cod, descricao: r.descricao || '', qtd: Number(r.qtd) || 0, prod_novo: prodNovo,
            status: r.status || '', emissao: r.emissao || null, previsao: r.previsao_final || r.previsao || null });
    }
    const produtos_novos = [...prodNovos.values()];
    if (!confirmar) return res.json({ ok: true, preview: true, total: limpas.length, novas, existentes, produtos_novos, unidade });
    // EXECUTA: cria os produtos novos (a partir do arquivo), depois insere as OPs novas
    let produtos_criados = 0;
    for (const p of produtos_novos) {
        const { data, error } = await supabase.from('produto').insert({ codigo: p.codigo, descricao: p.descricao, cor: p.cor, marca: p.marca, tamanho: p.tamanho, unidade_medida: unidade }).select('id,codigo').single();
        if (!error && data) { prodMap.set(String(data.codigo), data.id); produtos_criados++; }
    }
    let inseridas = 0; const erros = [];
    for (const o of novas) {
        const pid = prodMap.get(String(o.prod_codigo));
        if (!pid) { erros.push(`${o.numero}: produto ${o.prod_codigo} não cadastrado`); continue; }
        const { error } = await supabase.from('ordem_producao').insert({ numero: o.numero, produto_id: pid, qtd_planejada: o.qtd || 0, unidade,
            status: _opErpStatus(o.status), origem: 'erp', data_abertura: _opErpData(o.emissao), data_prevista: _opErpData(o.previsao) });
        if (error) erros.push(`${o.numero}: ${error.message}`); else inseridas++;
    }
    res.json({ ok: true, inseridas, produtos_criados, ignoradas: existentes.length, erros });
});

// ── #4 Integração de máquina (Stoll): recebe contagem automática ─────────────
// O gateway/máquina faz POST com a contagem produzida (delta). Soma na sessão
// aberta daquela máquina — auto-contagem, elimina digitação no maior estágio.
// chave da API de máquina (só admin vê, p/ configurar o gateway)
app.get('/api/mf/maquina-chave', auth, adminOnly, (_req, res) => {
    res.json({ configurada: !!process.env.MF_MAQUINA_API_KEY, chave: process.env.MF_MAQUINA_API_KEY || null });
});
app.post('/api/mf/maquina-contagem', mfMaquinaAuth, async (req, res) => {
    const b = req.body || {}, cod = b.maquina_codigo, delta = Number(b.qtd_delta ?? b.qtd ?? 0);
    if (!cod || !(delta > 0)) return res.status(400).json({ erro: 'maquina_codigo e qtd_delta>0 obrigatórios' });
    const { data: maq } = await supabase.from('maquina').select('id').eq('codigo', cod).limit(1).single();
    if (!maq) return res.status(404).json({ erro: 'máquina não encontrada' });
    const { data: aps } = await supabase.from('apontamento').select('id,qtd_boa').eq('maquina_id', maq.id).is('datahora_fim', null).order('datahora_inicio', { ascending: false }).limit(1);
    if (!aps?.length) return res.status(409).json({ erro: 'sem sessão aberta nesta máquina — abra o apontamento antes' });
    const novo = Number(aps[0].qtd_boa || 0) + delta;
    const { error } = await supabase.from('apontamento').update({ qtd_boa: novo }).eq('id', aps[0].id);
    if (error) return erro500(res, error);
    res.json({ ok: true, apontamento_id: aps[0].id, qtd_boa: novo });
});
// ── #5 ERP write-back: confirmações de produção (OPs + produzido) p/ o ERP ────
app.get('/api/mf/erp/confirmacoes', auth, async (req, res) => {
    // ?desde=YYYY-MM-DD escopa os apontamentos por datahora_fim (a Reunião usa 'hoje' e evita
    // baixar a tabela inteira a cada 30s). Sem o param, traz o histórico todo (Plano precisa p/ realizado por mês).
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.desde || '')) ? req.query.desde : null;
    let ops, aps;
    try {  // paginado (sem teto de 1000) — senão o realizado do Plano subconta (A3)
        [ops, aps] = await Promise.all([
            fetchAllSelect('ordem_producao', 'id,numero,status,qtd_planejada,unidade,data_abertura,data_prevista, produto:produto_id(codigo)', q => q.neq('status', 'cancelada')),
            fetchAllSelect('apontamento', 'op_id,qtd_boa,qtd_refugo,qtd_retrabalho,datahora_fim', q => desde ? q.gte('datahora_fim', desde) : q),
        ]);
    } catch (e) { return erro500(res, e); }
    const byOp = {};
    aps.forEach(a => { const o = (byOp[a.op_id] = byOp[a.op_id] || { boa: 0, refugo: 0, retrab: 0, ultima: null }); o.boa += Number(a.qtd_boa || 0); o.refugo += Number(a.qtd_refugo || 0); o.retrab += Number(a.qtd_retrabalho || 0); if (a.datahora_fim && (!o.ultima || a.datahora_fim > o.ultima)) o.ultima = a.datahora_fim; });
    let conf = ops.map(o => { const p = byOp[o.id] || { boa: 0, refugo: 0, retrab: 0, ultima: null }; return { op: o.numero, produto: o.produto?.codigo || null, status: o.status, unidade: o.unidade, qtd_planejada: Number(o.qtd_planejada), qtd_produzida: p.boa, qtd_refugo: p.refugo, qtd_retrabalho: p.retrab, ultima_producao: p.ultima }; });
    if (req.query.com_producao === '1') conf = conf.filter(c => c.qtd_produzida > 0 || c.status === 'concluida');
    res.json({ gerado_em: new Date().toISOString(), total: conf.length, confirmacoes: conf });
});

// ── Documentos (#7): instrução de trabalho por produto/etapa ─────────────────
app.get('/api/mf/documentos', auth, async (req, res) => {
    const r = await supabase.from('documento').select('*, produto:produto_id(codigo,descricao), etapa:etapa_id(nome,ordem)').eq('ativo', true).order('criado_em', { ascending: false });
    if (r.error && /schema cache|does not exist/i.test(r.error.message || '')) return res.status(503).json({ erro: 'Documentos não inicializados. Rode mes_documentos.sql.' });
    if (r.error) return res.status(500).json({ erro: r.error.message });
    let docs = r.data || [];
    // filtro de relevância p/ a estação: aplica se (produto null ou =X) E (etapa null ou =Y)
    const { produto_id, etapa_id } = req.query;
    if (produto_id || etapa_id) docs = docs.filter(d => (!d.produto_id || d.produto_id === produto_id) && (!d.etapa_id || d.etapa_id === etapa_id));
    res.json(docs);
});
app.post('/api/mf/documentos', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.titulo || (!b.url && !b.conteudo)) return res.status(400).json({ erro: 'título e (url ou conteúdo) obrigatórios' });
    if (b.url && !/^https?:\/\//i.test(String(b.url).trim())) return res.status(400).json({ erro: 'URL deve começar com http:// ou https:// (A7)' });  // bloqueia javascript:/data:
    let produto_id = b.produto_id || null;
    if (!produto_id && b.produto_codigo) { const { data: pr } = await supabase.from('produto').select('id').eq('codigo', b.produto_codigo).limit(1).single(); if (!pr) return res.status(400).json({ erro: 'código de produto não encontrado' }); produto_id = pr.id; }
    const { data, error } = await supabase.from('documento').insert({ titulo: b.titulo, produto_id, etapa_id: b.etapa_id || null, url: b.url || null, conteudo: b.conteudo || null }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, documento: data });
});
app.delete('/api/mf/documentos/:id', auth, mfEscrita, async (req, res) => {
    const { error } = await supabase.from('documento').update({ ativo: false }).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ═══ ENGENHARIA DE PROCESSOS E MÉTODOS ═══════════════════════════════════════
const _viewIndisp = (r, sql) => r.error && /schema cache|does not exist|relation/i.test(r.error.message || '') ? `Rode ${sql} no SQL Editor.` : null;

// 1) Cronoanálise — tempo real medido × padrão, por produto/etapa
app.get('/api/mf/cronoanalise', auth, async (_q, res) => {
    const r = await supabase.from('vw_cronoanalise_resumo').select('*').order('etapa_ordem');
    const ind = _viewIndisp(r, 'mes_engenharia.sql'); if (ind) return res.status(503).json({ erro: ind });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});

// 2) Balanceamento de linha + takt: tempo de ciclo por etapa × takt da demanda
app.get('/api/mf/balanceamento', auth, async (req, res) => {
    const demanda = Math.max(0, Number(req.query.demanda) || 0);   // peças/dia desejadas
    const horasDia = Math.min(24, Math.max(1, Number(req.query.horas) || 8));
    const [etapasR, maqsR, temposR] = await Promise.all([
        supabase.from('etapa_processo').select('id,nome,ordem').eq('ativo', true).order('ordem'),
        supabase.from('maquina').select('etapa_id').eq('ativo', true),
        supabase.from('tempo_padrao').select('etapa_id,seg_por_unidade').is('produto_id', null),
    ]);
    if (etapasR.error) return erro500(res, etapasR.error);
    const postosDe = {}; (maqsR.data || []).forEach(m => { if (m.etapa_id) postosDe[m.etapa_id] = (postosDe[m.etapa_id] || 0) + 1; });
    const segDe = Object.fromEntries((temposR.data || []).map(t => [t.etapa_id, Number(t.seg_por_unidade) || 0]));
    const takt = demanda > 0 ? (horasDia * 3600) / demanda : null;   // seg/peça que a linha precisa entregar
    const etapas = (etapasR.data || []).map(e => {
        const postos = postosDe[e.id] || 0, seg = segDe[e.id] || 0;
        const tempo_ciclo = postos > 0 && seg > 0 ? seg / postos : null;   // seg/peça do posto
        const capacidade_dia = seg > 0 ? Math.round(postos * horasDia * 3600 / seg) : null;
        const utilizacao = (takt && tempo_ciclo) ? Math.round(tempo_ciclo / takt * 100) : null;
        return { etapa: e.nome, ordem: e.ordem, postos, seg_padrao: seg, tempo_ciclo: tempo_ciclo ? Math.round(tempo_ciclo * 10) / 10 : null,
            capacidade_dia, utilizacao, gargalo: utilizacao != null && utilizacao > 100 };
    });
    const comCiclo = etapas.filter(e => e.tempo_ciclo != null);
    const gargalo = comCiclo.length ? comCiclo.reduce((a, b) => b.tempo_ciclo > a.tempo_ciclo ? b : a) : null;
    res.json({ takt: takt ? Math.round(takt * 10) / 10 : null, demanda, horasDia, gargalo: gargalo?.etapa || null, etapas });
});

// 3) Produtividade por operador (admin — expõe desempenho individual, B9)
app.get('/api/mf/produtividade', auth, adminOnly, async (_q, res) => {
    const r = await supabase.from('vw_produtividade_operador').select('*').order('pecas_por_hora', { ascending: false, nullsFirst: false });
    const ind = _viewIndisp(r, 'mes_engenharia.sql'); if (ind) return res.status(503).json({ erro: ind });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});

// 4) Custeio real por OP + cadastro de taxas (R$/h) — admin (custo/salário, B9)
app.get('/api/mf/custo', auth, adminOnly, async (_q, res) => {
    const r = await supabase.from('vw_custo_op').select('*').order('custo_total', { ascending: false, nullsFirst: false });
    const ind = _viewIndisp(r, 'mes_engenharia.sql'); if (ind) return res.status(503).json({ erro: ind });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});
app.get('/api/mf/custo/taxas', auth, adminOnly, async (_q, res) => {
    const [ops, maqs] = await Promise.all([
        supabase.from('operador').select('id,nome,custo_hora').eq('ativo', true).order('nome'),
        supabase.from('maquina').select('id,codigo,nome,custo_hora').eq('ativo', true).order('codigo'),
    ]);
    res.json({ operadores: ops.data || [], maquinas: maqs.data || [] });
});
app.put('/api/mf/custo/taxa/:tipo/:id', auth, adminOnly, async (req, res) => {  // admin (define taxa/salário, B9)
    const tabela = req.params.tipo === 'operador' ? 'operador' : req.params.tipo === 'maquina' ? 'maquina' : null;
    if (!tabela) return res.status(400).json({ erro: 'tipo inválido' });
    const raw = req.body?.custo_hora;
    let v = null;  // null = limpar a taxa (M11)
    if (raw != null && raw !== '') { v = Number(raw); if (!(v >= 0)) return res.status(400).json({ erro: 'custo_hora inválido' }); }
    const { error } = await supabase.from(tabela).update({ custo_hora: v }).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// 5a) FMEA de processo
app.get('/api/mf/fmea', auth, async (_q, res) => {
    const r = await supabase.from('fmea').select('*, etapa:etapa_id(nome,ordem)').eq('ativo', true).order('rpn', { ascending: false });
    const ind = _viewIndisp(r, 'mes_engenharia.sql'); if (ind) return res.status(503).json({ erro: ind });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});
app.post('/api/mf/fmea', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.modo_falha) return res.status(400).json({ erro: 'modo_falha obrigatório' });
    const sod = {};  // M6: valida faixa 1-10 (senão viola o CHECK e vira 500 opaco)
    for (const k of ['severidade', 'ocorrencia', 'deteccao']) {
        if (b[k] != null && b[k] !== '') { const v = Math.round(Number(b[k])); if (!(v >= 1 && v <= 10)) return res.status(400).json({ erro: `${k} deve ser inteiro de 1 a 10` }); sod[k] = v; } else sod[k] = null;
    }
    const row = { etapa_id: b.etapa_id || null, modo_falha: b.modo_falha, efeito: b.efeito || null, causa: b.causa || null, ...sod, acao: b.acao || null };
    const { data, error } = await supabase.from('fmea').insert(row).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, fmea: data });
});
app.delete('/api/mf/fmea/:id', auth, mfEscrita, async (req, res) => {
    const { error } = await supabase.from('fmea').update({ ativo: false }).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// 5b) Kaizen (funil ideia → teste → padrão)
app.get('/api/mf/kaizen', auth, async (_q, res) => {
    const r = await supabase.from('kaizen').select('*, etapa:etapa_id(nome)').order('criado_em', { ascending: false });
    const ind = _viewIndisp(r, 'mes_engenharia.sql'); if (ind) return res.status(503).json({ erro: ind });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});
app.post('/api/mf/kaizen', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.titulo) return res.status(400).json({ erro: 'titulo obrigatório' });
    const row = { titulo: b.titulo, descricao: b.descricao || null, etapa_id: b.etapa_id || null, ganho_esperado: b.ganho_esperado || null, responsavel: b.responsavel || null };
    const { data, error } = await supabase.from('kaizen').insert(row).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, kaizen: data });
});
app.put('/api/mf/kaizen/:id', auth, mfEscrita, async (req, res) => {
    const b = req.body || {}, upd = {};
    ['titulo','descricao','etapa_id','status','ganho_esperado','responsavel'].forEach(f => { if (b[f] !== undefined) upd[f] = b[f]; });
    const { error } = await supabase.from('kaizen').update(upd).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ═══ LEAN MANUFACTURING ══════════════════════════════════════════════════════
// VSM — Mapa do Fluxo de Valor: lead time × tempo de valor agregado (%VA) por etapa
app.get('/api/mf/vsm', auth, async (_q, res) => {
    let opsAll;
    try {  // OPs ativas paginadas (sem teto de 1000) — senão WIP/lead do VSM subconta
        opsAll = await fetchAllSelect('ordem_producao', 'etapa_atual_id,qtd_planejada,etapa_desde', q => q.neq('status', 'cancelada').neq('status', 'concluida'));
    } catch (e) { return erro500(res, e); }
    const [etapasR, leadR, temposR] = await Promise.all([
        supabase.from('etapa_processo').select('id,nome,ordem').eq('ativo', true).order('ordem'),
        supabase.from('vw_wip_leadtime').select('etapa_id,horas_medias').then(r => r, () => ({ data: [] })),
        supabase.from('tempo_padrao').select('etapa_id,seg_por_unidade').is('produto_id', null),
    ]);
    const opsR = { data: opsAll };
    if (etapasR.error) return erro500(res, etapasR.error);
    const leadDe = Object.fromEntries((leadR.data || []).map(l => [l.etapa_id, Number(l.horas_medias) || 0]));
    const segDe = Object.fromEntries((temposR.data || []).map(t => [t.etapa_id, Number(t.seg_por_unidade) || 0]));
    const wipDe = {};
    (opsR.data || []).forEach(o => { if (!o.etapa_atual_id) return; const w = (wipDe[o.etapa_atual_id] = wipDe[o.etapa_atual_id] || { ops: 0, qtd: 0, esperaH: 0 }); w.ops++; w.qtd += Number(o.qtd_planejada) || 0; if (o.etapa_desde) w.esperaH += (Date.now() - new Date(o.etapa_desde)) / 3.6e6; });
    let vaTotal = 0, leadTotal = 0;
    const etapas = (etapasR.data || []).map(e => {
        const w = wipDe[e.id] || { ops: 0, qtd: 0, esperaH: 0 };
        const va_seg = segDe[e.id] || 0;
        const va_h = va_seg && w.qtd ? va_seg * w.qtd / 3600 : 0;
        // B5: lead histórico medido (vw_wip_leadtime) quando existe; senão, espera ATUAL do WIP (grandeza diferente) — marcado em lead_fonte
        const temHist = (leadDe[e.id] || 0) > 0;
        const lead_h = temHist ? leadDe[e.id] : (w.ops ? w.esperaH / w.ops : 0);
        const lead_fonte = temHist ? 'historico' : (w.ops ? 'wip_atual' : null);
        vaTotal += va_h; leadTotal += Math.max(lead_h, va_h);
        return { etapa: e.nome, ordem: e.ordem, wip_ops: w.ops, wip_qtd: Math.round(w.qtd), va_seg_peca: va_seg, va_horas: Math.round(va_h * 10) / 10, lead_horas: Math.round(lead_h * 10) / 10, lead_fonte };
    });
    const misturado = etapas.some(e => e.lead_fonte === 'historico') && etapas.some(e => e.lead_fonte === 'wip_atual');
    res.json({ etapas, va_total_h: Math.round(vaTotal * 10) / 10, lead_total_h: Math.round(leadTotal * 10) / 10, pct_va: leadTotal > 0 ? Math.round(vaTotal / leadTotal * 1000) / 10 : null, lead_misturado: misturado });
});

// Heijunka — nivelamento: distribui a carteira por família entre N períodos
app.get('/api/mf/heijunka', auth, async (req, res) => {
    const periodos = Math.max(2, Math.min(12, Number(req.query.periodos) || 5));
    let ops;
    try { ops = await fetchAllSelect('ordem_producao', 'qtd_planejada, produto:produto_id(marca,codigo)', q => q.neq('status', 'cancelada').neq('status', 'concluida')); }  // pagina + trata erro (M7)
    catch (e) { return erro500(res, e); }
    const fam = {};
    ops.forEach(o => { const f = (o.produto?.marca || o.produto?.codigo || '—').toString().trim() || '—'; fam[f] = (fam[f] || 0) + (Number(o.qtd_planejada) || 0); });
    const familias = Object.entries(fam).map(([nome, total]) => ({ nome, total: Math.round(total), por_periodo: Math.round(total / periodos) })).sort((a, b) => b.total - a.total);
    const totalGeral = familias.reduce((s, f) => s + f.total, 0);
    res.json({ periodos, total: totalGeral, por_periodo: Math.round(totalGeral / periodos), familias: familias.slice(0, 25) });
});

// Yamazumi — carga de cada posto (tempo de ciclo) × takt: Muri (sobrecarga) e ócio
app.get('/api/mf/yamazumi', auth, async (req, res) => {
    const demanda = Math.max(0, Number(req.query.demanda) || 0);
    const horasDia = Math.min(24, Math.max(1, Number(req.query.horas) || 8));
    const [etapasR, maqsR, temposR] = await Promise.all([
        supabase.from('etapa_processo').select('id,nome,ordem').eq('ativo', true).order('ordem'),
        supabase.from('maquina').select('etapa_id,n_pessoas').eq('ativo', true),
        supabase.from('tempo_padrao').select('etapa_id,seg_por_unidade').is('produto_id', null),
    ]);
    if (etapasR.error) return erro500(res, etapasR.error);
    const postosDe = {}, pessoasDe = {};
    (maqsR.data || []).forEach(m => { if (!m.etapa_id) return; postosDe[m.etapa_id] = (postosDe[m.etapa_id] || 0) + 1; pessoasDe[m.etapa_id] = (pessoasDe[m.etapa_id] || 0) + (Number(m.n_pessoas) || 1); });
    const segDe = Object.fromEntries((temposR.data || []).map(t => [t.etapa_id, Number(t.seg_por_unidade) || 0]));
    const takt = demanda > 0 ? horasDia * 3600 / demanda : null;
    const etapas = (etapasR.data || []).map(e => {
        const postos = postosDe[e.id] || 0, seg = segDe[e.id] || 0;
        const carga = postos > 0 && seg > 0 ? seg / postos : null;
        const util = (takt && carga) ? Math.round(carga / takt * 100) : null;
        return { etapa: e.nome, ordem: e.ordem, postos, pessoas: pessoasDe[e.id] || postos, carga_seg: carga ? Math.round(carga * 10) / 10 : null, utilizacao: util, sobrecarga: util != null && util > 100, ocioso: util != null && util < 70 };
    });
    res.json({ takt: takt ? Math.round(takt * 10) / 10 : null, demanda, horasDia, etapas });
});

// 5S — auditoria por área (nota /25)
app.get('/api/mf/auditoria-5s', auth, async (_q, res) => {
    const r = await supabase.from('auditoria_5s').select('*, etapa:etapa_id(nome)').order('data_auditoria', { ascending: false }).limit(100);
    const ind = _viewIndisp(r, 'mes_lean.sql'); if (ind) return res.status(503).json({ erro: ind });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});
app.post('/api/mf/auditoria-5s', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.area) return res.status(400).json({ erro: 'area obrigatória' });
    const row = { area: b.area, etapa_id: b.etapa_id || null, auditor: b.auditor || null, observacao: b.observacao || null };
    for (const s of ['seiri', 'seiton', 'seiso', 'seiketsu', 'shitsuke']) {  // M5: valida faixa 0-5 (senão viola o CHECK → 500 opaco)
        if (b[s] != null && b[s] !== '') { const v = Math.round(Number(b[s])); if (!(v >= 0 && v <= 5)) return res.status(400).json({ erro: `${s} deve ser inteiro de 0 a 5` }); row[s] = v; } else row[s] = null;
    }
    const { data, error } = await supabase.from('auditoria_5s').insert(row).select('*').single();
    if (error) return erro500(res, error);
    res.json({ ok: true, auditoria: data });
});

// A3 / PDCA — solução estruturada de problema
const A3_CAMPOS = ['titulo', 'etapa_id', 'responsavel', 'contexto', 'situacao_atual', 'meta', 'analise', 'contramedidas', 'resultado', 'aprendizado', 'fase'];
app.get('/api/mf/a3', auth, async (_q, res) => {
    const r = await supabase.from('a3').select('*, etapa:etapa_id(nome)').order('atualizado_em', { ascending: false });
    const ind = _viewIndisp(r, 'mes_lean.sql'); if (ind) return res.status(503).json({ erro: ind });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});
app.post('/api/mf/a3', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.titulo) return res.status(400).json({ erro: 'titulo obrigatório' });
    const row = {}; A3_CAMPOS.forEach(f => { if (b[f] !== undefined) row[f] = b[f] || null; }); row.titulo = b.titulo;
    const { data, error } = await supabase.from('a3').insert(row).select('*').single();
    if (error) return erro500(res, error);
    res.json({ ok: true, a3: data });
});
app.put('/api/mf/a3/:id', auth, mfEscrita, async (req, res) => {
    const b = req.body || {}, upd = {}; A3_CAMPOS.forEach(f => { if (b[f] !== undefined) upd[f] = b[f]; });
    const { error } = await supabase.from('a3').update(upd).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── Setup / SMED (#3): tempo de troca de artigo (paradas categoria 'setup') ──
app.get('/api/mf/setup', auth, async (req, res) => {
    const dias = Math.min(90, Math.max(7, Number(req.query.dias) || 14));
    const desde = new Date(Date.now() - dias * 864e5).toISOString();
    const { data, error } = await supabase.from('parada')
        .select('datahora_inicio,duracao_segundos, motivo:motivo_id!inner(categoria), ap:apontamento_id(maquina:maquina_id(codigo), etapa:etapa_id(nome,ordem))')
        .eq('motivo.categoria', 'setup').not('datahora_fim', 'is', null).gte('datahora_inicio', desde);
    if (error) return erro500(res, error);
    const ps = data || [], totalSeg = ps.reduce((s, p) => s + Number(p.duracao_segundos || 0), 0);
    const byDay = {}, byMaq = {};
    ps.forEach(p => {
        const d = (p.datahora_inicio || '').slice(0, 10); byDay[d] = (byDay[d] || 0) + Number(p.duracao_segundos || 0);
        const m = p.ap?.maquina?.codigo || '?'; (byMaq[m] = byMaq[m] || { seg: 0, n: 0 }); byMaq[m].seg += Number(p.duracao_segundos || 0); byMaq[m].n++;
    });
    const serie = [];
    for (let i = dias - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); serie.push({ dia: d, min: Math.round((byDay[d] || 0) / 60) }); }
    const offensores = Object.entries(byMaq).map(([k, v]) => ({ maquina: k, min: Math.round(v.seg / 60), trocas: v.n, media: Math.round(v.seg / v.n / 60 * 10) / 10 })).sort((a, b) => b.min - a.min).slice(0, 10);
    res.json({ dias, total_min: Math.round(totalSeg / 60), trocas: ps.length, media_min: ps.length ? Math.round(totalSeg / ps.length / 60 * 10) / 10 : 0, serie, offensores });
});

// ── Andon: chamado em tempo real do chão ──────────────────────
app.post('/api/mf/andon', auth, mfEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.tipo) return res.status(400).json({ erro: 'tipo obrigatório' });
    const row = { tipo: b.tipo, etapa_id: b.etapa_id || null, maquina_id: b.maquina_id || null, operador_id: b.operador_id || null, op_id: b.op_id || null, descricao: b.descricao || null };
    if (b.id) row.id = b.id;
    const { data, error } = await supabase.from('chamado_andon').upsert(row).select().single();
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'Andon não inicializado. Rode mes_andon.sql.' });
    if (error) return erro500(res, error);
    res.json({ ok: true, chamado: data });
});
app.get('/api/mf/andon', auth, async (_q, res) => {
    const { data, error } = await supabase.from('chamado_andon')
        .select('*, etapa:etapa_id(nome,ordem), maquina:maquina_id(codigo), operador:operador_id(nome), op:op_id(numero)')
        .neq('status', 'resolvido').order('aberto_em');
    if (error && /schema cache|does not exist/i.test(error.message || '')) return res.status(503).json({ erro: 'Andon não inicializado. Rode mes_andon.sql.' });
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.put('/api/mf/andon/:id', auth, mfEscrita, async (req, res) => {
    const acao = req.body?.acao, upd = {};
    if (acao === 'atender') { upd.status = 'atendido'; upd.atendido_em = new Date().toISOString(); upd.atendido_por = req.body?.por || null; }
    else if (acao === 'resolver') { upd.status = 'resolvido'; upd.resolvido_em = new Date().toISOString(); }
    else return res.status(400).json({ erro: 'ação inválida (atender|resolver)' });
    const { error } = await supabase.from('chamado_andon').update(upd).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
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
