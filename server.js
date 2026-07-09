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

app.set('trust proxy', 1);   // atrás de proxy (Render etc.): req.ip = IP real do cliente, não o do proxy — senão o rate-limit do login pune/derruba todo mundo junto
// CORS: front e API são a MESMA origem (mesmo host:porta, inclusive tablets via IP da LAN) e
// gateways de máquina são server-to-server (CORS não se aplica). Só liberamos cross-origin se
// ALLOWED_ORIGINS for definido no .env (CSV) — antes era cors() aberto p/ qualquer site.
const origensPermitidas = String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (origensPermitidas.length) app.use(cors({ origin: origensPermitidas }));
// JSON: 1 MB por padrão; 25 MB só nas rotas que realmente recebem volume (planilhas de import,
// foto de NC em dataURL, staging do legado) — um body de 20 MB no /login era DoS barato pré-auth
const jsonPequeno = express.json({ limit: '1mb' });
const jsonGrande  = express.json({ limit: '25mb' });
app.use((req, res, next) => (/\/import|\/lote$|\/bulk$|^\/api\/mf\/(fotos|importar|etiquetas)/.test(req.path) ? jsonGrande : jsonPequeno)(req, res, next));

// ── Cabeçalhos de segurança (defesa em profundidade) ─────────────────────────
// CSP: o front usa MUITO onclick inline + <script> inline, então script-src PRECISA de
// 'unsafe-inline' (não dá pra bloquear XSS de handler inline sem reescrever tudo — o escape
// escHTML/escJS é a defesa primária). O valor real do CSP aqui é conter o IMPACTO: connect-src
// e img-src restritos barram exfiltração do JWT p/ domínios externos (fetch/beacon/img), e
// object/base/frame-ancestors barram plugin/base-hijack/clickjacking.
const SUPA = 'https://icynkkfftjbrscwicpzd.supabase.co';
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${SUPA}`,
    `connect-src 'self' ${SUPA}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join('; ');
app.use((_req, res, next) => {
    res.set('Content-Security-Policy', CSP);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');           // não vaza URL (com token em query, se houver) no Referer
    res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');   // só tem efeito em HTTPS (deploy); em HTTP local o browser ignora
    next();
});

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

// Escrita no SIGS: mesma regra do MES — viewer não grava/exclui nada (review: rotas
// destrutivas do SIGS só tinham `auth`, então um perfil somente-leitura podia apagar
// feriados/turnos/processos/máquinas/planos; o service_role ignora RLS, o Express é a única barreira).
function sigsEscrita(req, res, next) {
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

// Incremento/decremento com CAS (compare-and-set): UPDATE ... WHERE campo = valor_lido.
// Sem isso, duas gravações simultâneas (contador da máquina × formulário, dois consumos do
// mesmo lote) liam o mesmo valor-base e uma sobrescrevia a outra (lost update).
async function casDelta(tabela, id, campo, delta, { min0 = false, tentativas = 10 } = {}) {
    for (let t = 0; t < tentativas; t++) {
        if (t > 0) await new Promise(r => setTimeout(r, 15 + Math.random() * 60 * t));   // backoff com jitter: rajada de contador não esgota as tentativas
        const { data: cur, error: e1 } = await supabase.from(tabela).select(campo).eq('id', id).maybeSingle();
        if (e1) return { error: e1 };
        if (!cur) return { naoEncontrado: true };
        const lido = cur[campo];
        let novo = Number(lido || 0) + delta;
        if (min0) novo = Math.max(0, novo);
        let q = supabase.from(tabela).update({ [campo]: novo }).eq('id', id);
        q = (lido === null || lido === undefined) ? q.is(campo, null) : q.eq(campo, lido);
        const { data, error } = await q.select('id');
        if (error) return { error };
        if (data?.length) return { novo };   // gravou sobre o valor que leu — sem corrida
        // outro processo gravou no meio: relê e tenta de novo
    }
    return { error: new Error(`concorrência persistente em ${tabela}.${campo}`) };
}

// rate-limit simples do login (em memória): 5 falhas → 15 min de bloqueio por IP — M18
const _loginFails = new Map();
function _loginBloqueado(ip) { const e = _loginFails.get(ip); return (e?.until && Date.now() < e.until) ? Math.ceil((e.until - Date.now()) / 1000) : 0; }
function _loginFalhou(ip) {
    // mapa com teto: expira entradas velhas p/ não crescer sem limite (memória)
    if (_loginFails.size > 500) { for (const [k, v] of _loginFails) { if (!v.until || v.until < Date.now()) _loginFails.delete(k); } }
    const e = _loginFails.get(ip) || { count: 0 }; e.count++; if (e.count >= 5) { e.until = Date.now() + 15 * 60 * 1000; e.count = 0; } _loginFails.set(ip, e);
}
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
    } catch (e) { erro500(res, e, 'buscar dados'); }
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
        return erro500(res, errImp, 'criar importação');
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
    catch (e) { erro500(res, e, 'buscar estoque'); }
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
        return erro500(res, errImp, 'criar importação');
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
    catch (e) { erro500(res, e, 'buscar ordens'); }
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
    } catch (e) { return erro500(res, e); }
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
        return erro500(res, errImp, 'criar importação');
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
    catch (e) { erro500(res, e, 'buscar costura'); }
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
        return erro500(res, errImp, 'criar importação');
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
    catch (e) { erro500(res, e, 'buscar cliente'); }
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
        return erro500(res, errImp, 'criar importação');
    }

    const rows = linhas.map(l => ({ importacao_id: imp.id, dados: l.dados || {} }));
    const r5 = await batchInsert('dados_banco', 'importacoes_banco', imp.id, rows);
    if (r5.erro) return res.status(500).json({ erro: r5.erro });
    res.json({ ok: true, importacaoId: imp.id, total: linhas.length });
});

// ── POST /api/banco/adicionar — acrescenta códigos à ÚLTIMA importação ───────
// Cadastro rápido (ex.: códigos vendidos sem cadastro, via dashboard Vendas por
// Stoll). Não cria importação nova: pendura na vigente e ajusta total_linhas.
app.post('/api/banco/adicionar', auth, adminOnly, async (req, res) => {
    const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas.filter(l => l?.dados?.['Código']) : [];
    if (!linhas.length) return res.status(400).json({ erro: 'linhas [{dados:{Código,...}}] obrigatório' });
    const { data: imp, error: eI } = await supabase.from('importacoes_banco')
        .select('id,total_linhas').order('criado_em', { ascending: false }).limit(1).maybeSingle();
    if (eI) return erro500(res, eI);
    if (!imp) return res.status(422).json({ erro: 'Nenhuma importação de Banco de Dados existe ainda — importe a planilha primeiro.' });
    // não duplicar código que já existe na importação vigente
    let existentes;
    try { existentes = await fetchAllRows('dados_banco', imp.id); } catch (e) { return erro500(res, e); }
    const jaTem = new Set((existentes || []).map(r => String(r.dados?.['Código'] ?? '').trim().toUpperCase()).filter(Boolean));
    const novas = linhas.filter(l => !jaTem.has(String(l.dados['Código']).trim().toUpperCase()))
        .map(l => ({ importacao_id: imp.id, dados: l.dados }));
    if (novas.length) {
        const { error } = await supabase.from('dados_banco').insert(novas);
        if (error) return erro500(res, error);
        await supabase.from('importacoes_banco').update({ total_linhas: (imp.total_linhas || 0) + novas.length }).eq('id', imp.id);
    }
    res.json({ ok: true, adicionadas: novas.length, ja_existiam: linhas.length - novas.length });
});

// ── GET /api/banco?importacao_id=xxx ─────────────────────────
app.get('/api/banco', auth, async (req, res) => {
    const { importacao_id } = req.query;
    if (!importacao_id) return res.json([]);
    try { res.json(await fetchAllRows('dados_banco', importacao_id)); }
    catch (e) { erro500(res, e, 'buscar banco'); }
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
app.post('/api/soep-acoes', auth, sigsEscrita, async (req, res) => {
    const { descricao, responsavel, prazo, modulo } = req.body;
    if (!descricao?.trim()) return res.status(400).json({ erro: 'descricao obrigatória' });
    const { data, error } = await supabase.from('soep_acoes')
        .insert({ descricao: descricao.trim(), responsavel: responsavel||null, prazo: prazo||null, modulo: modulo||null, status: 'aberta' })
        .select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, acao: data });
});
app.put('/api/soep-acoes/:id', auth, sigsEscrita, async (req, res) => {
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
app.post('/api/soep-snapshot/bulk', auth, sigsEscrita, async (req, res) => {
    const { mes, items } = req.body;
    if (!mes || !Array.isArray(items) || !items.length) return res.status(400).json({ erro: 'mes e items obrigatórios' });
    // Remove snapshot anterior do mesmo mês e recria — com BACKUP: se o insert falhar, restaura
    // (delete+insert sem transação perdia o baseline do mês inteiro numa falha parcial)
    const rows = items.filter(i => i.codigo != null && String(i.codigo).trim()).map(i => ({ mes, codigo: String(i.codigo).toUpperCase(), qty_prevista: i.qty||0, usuario_id: req.usuario.id }));
    if (!rows.length) return res.status(400).json({ erro: 'nenhum item com código válido' });
    const { data: backup } = await supabase.from('soep_snapshot').select('mes,codigo,qty_prevista,usuario_id').eq('mes', mes);
    await supabase.from('soep_snapshot').delete().eq('mes', mes);
    const { error } = await supabase.from('soep_snapshot').insert(rows);
    if (error) {
        if (backup?.length) await supabase.from('soep_snapshot').insert(backup).then(() => {}, () => {});
        return erro500(res, error);
    }
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
app.post('/api/soep-plano/bulk', auth, sigsEscrita, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.json({ ok: true });
    const rows = items.map(i => ({ mes: i.mes, codigo: String(i.codigo).toUpperCase(), quantidade: i.quantidade||0, usuario_id: req.usuario.id }));
    const { error } = await supabase.from('soep_plano').upsert(rows, { onConflict: 'mes,codigo' });
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
app.delete('/api/soep-plano/:mes', auth, sigsEscrita, async (req, res) => {
    const { error } = await supabase.from('soep_plano').delete().eq('mes', req.params.mes);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── S&OP — VERSÕES CONGELADAS DO PLANO ───────────────────────
// Congela uma cópia do plano salvo (soep_plano) para comparação futura
app.post('/api/plano-versao/congelar', auth, sigsEscrita, async (req, res) => {
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
app.post('/api/capacidade-config/bulk', auth, sigsEscrita, async (req, res) => {
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

// ── Onda 4: tempo-padrão MEDIDO (MES) para o TOC do SIGS ─────────────────────
// O MES é o dono do tempo-padrão (cronoanálise). As etapas do MES batem 1:1 com
// os processos do TOC (Tecelagem/Costura/Soldagem/…). Aqui o TOC BUSCA o tempo
// medido; a planilha "Banco de Dados" vira só fallback. Enquanto tempo_padrao
// estiver vazia, a resposta é vazia → o TOC segue usando a planilha (zero risco).
const TOC_ETAPA_PROC = { // etapa MES (normalizada) → id de processo do TOC
    'tecelagem': 'tecelagem', 'costura automatica': 'costura_auto', 'costura manual': 'costura_manual',
    'soldagem': 'soldagem', 'silicone': 'silicone', 'passadoria': 'passadoria', 'embalagem': 'embalagem',
};
const _norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
app.get('/api/toc/tempos-medidos', auth, async (_req, res) => {
    const [etR, tpR] = await Promise.all([
        supabase.from('etapa_processo').select('id,nome'),
        supabase.from('tempo_padrao').select('etapa_id,produto_id,seg_por_unidade'),
    ]);
    if (etR.error) { // etapa_processo é do MES; se faltar, degrada limpo (TOC usa planilha)
        if (/schema cache|does not exist|relation/i.test(etR.error.message || '')) return res.json({ porProc: {}, cobertura: 0, indisponivel: true });
        return erro500(res, etR.error);
    }
    if (tpR.error) return res.json({ porProc: {}, cobertura: 0, indisponivel: true });
    // etapa_id → procId do TOC (por nome)
    const procDeEtapa = {}; (etR.data || []).forEach(e => { const p = TOC_ETAPA_PROC[_norm(e.nome)]; if (p) procDeEtapa[e.id] = p; });
    // produto_id → código (para casar com o código da planilha, em UPPER)
    const pids = [...new Set((tpR.data || []).map(t => t.produto_id).filter(Boolean))];
    const codDe = {};
    if (pids.length) {
        const { data: prods } = await supabase.from('produto').select('id,codigo').in('id', pids);
        (prods || []).forEach(p => { if (p.codigo) codDe[p.id] = String(p.codigo).trim().toUpperCase(); });
    }
    const porProc = {}; let cobertura = 0;
    (tpR.data || []).forEach(t => {
        const proc = procDeEtapa[t.etapa_id]; const seg = Number(t.seg_por_unidade) || 0;
        if (!proc || seg <= 0) return;
        const bucket = porProc[proc] || (porProc[proc] = { geral: null, porCodigo: {} });
        if (t.produto_id && codDe[t.produto_id]) { bucket.porCodigo[codDe[t.produto_id]] = seg; cobertura++; }
        else if (!t.produto_id) { bucket.geral = seg; }         // tempo genérico da etapa (sem produto)
    });
    res.json({ porProc, cobertura, procsComMedida: Object.keys(porProc) });
});

// ── S&OP — ESTOQUE MÍNIMO POR SKU ────────────────────────────
app.get('/api/estoque-minimo', auth, async (_req, res) => {
    const { data, error } = await supabase.from('estoque_minimo').select('codigo,quantidade');
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/estoque-minimo/bulk', auth, sigsEscrita, async (req, res) => {
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
app.post('/api/op-datas/bulk', auth, sigsEscrita, async (req, res) => {
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

// ── Planos de Previsão de Demanda (versões de trabalho: params + edições) ─────
const PREV_503 = 'Tabela previsao_plano não criada. Rode previsao_plano.sql no Supabase.';
app.get('/api/previsao-planos', auth, async (_req, res) => {
    const { data, error } = await supabase.from('previsao_plano').select('id,nome,congelado,atualizado_em').order('atualizado_em', { ascending: false });
    if (error && /schema cache|does not exist|relation/i.test(error.message || '')) return res.status(503).json({ erro: PREV_503 });
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.get('/api/previsao-planos/:id', auth, async (req, res) => {
    const { data, error } = await supabase.from('previsao_plano').select('*').eq('id', req.params.id).maybeSingle();
    if (error && /schema cache|does not exist|relation/i.test(error.message || '')) return res.status(503).json({ erro: PREV_503 });
    if (error) return erro500(res, error);
    if (!data) return res.status(404).json({ erro: 'Plano não encontrado.' });
    res.json(data);
});
app.post('/api/previsao-planos', auth, sigsEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ erro: 'nome obrigatório' });
    const row = {
        nome: String(b.nome).trim().slice(0, 120),
        usuario_id: req.usuario.id,
        atualizado_em: new Date().toISOString(),
    };
    // campo ausente no body = preservar o que está no banco (o upsert só altera colunas presentes)
    if (b.params  !== undefined || !b.id) row.params  = b.params  && typeof b.params  === 'object' ? b.params  : {};
    if (b.edicoes !== undefined || !b.id) row.edicoes = b.edicoes && typeof b.edicoes === 'object' ? b.edicoes : {};
    if (b.id) row.id = b.id;
    // Estado atual no banco (p/ regra do congelado). O upsert do PostgREST só altera
    // as colunas presentes no payload — omitir = preservar no update.
    let stored = null;
    if (b.id) {
        const { data: prev, error: e0 } = await supabase.from('previsao_plano').select('congelado,snapshot,atualizado_em').eq('id', b.id).maybeSingle();
        if (e0 && /schema cache|does not exist|relation/i.test(e0.message || '')) return res.status(503).json({ erro: PREV_503 });
        stored = prev;
    }
    // Trava otimista multi-usuário: se o plano mudou no banco depois que este cliente o carregou,
    // rejeita em vez de sobrescrever silenciosamente as edições do outro (last-write-wins às cegas)
    if (stored && b.base_atualizado_em && new Date(stored.atualizado_em).getTime() - new Date(b.base_atualizado_em).getTime() > 1500) {
        return res.status(409).json({ erro: 'Outro usuário salvou este plano depois de você abri-lo. Recarregue o plano (troque para Base e volte) antes de salvar — suas edições continuam no rascunho deste navegador.' });
    }
    if (stored?.congelado) {
        // Plano CONGELADO é imutável no servidor (não só na tela):
        if (b.congelado === false) { row.congelado = false; row.snapshot = {}; }   // descongelar — aceita as edições junto
        else if (b.congelado === undefined) { delete row.params; delete row.edicoes; } // renomear — só o nome muda; resto preservado
        else return res.status(409).json({ erro: 'Plano congelado — descongele (🔓) antes de salvar alterações.' });
    } else if (b.congelado !== undefined) {
        row.congelado = !!b.congelado;
        row.snapshot  = b.snapshot && typeof b.snapshot === 'object' ? b.snapshot : {};
    } else if (!b.id) {
        row.congelado = false; row.snapshot = {};
    }
    const { data, error } = await supabase.from('previsao_plano').upsert(row).select().single();
    if (error && /schema cache|does not exist|relation/i.test(error.message || '')) return res.status(503).json({ erro: PREV_503 });
    if (error) return erro500(res, error);
    res.json({ ok: true, plano: data });
});
app.delete('/api/previsao-planos/:id', auth, sigsEscrita, async (req, res) => {
    const { error } = await supabase.from('previsao_plano').delete().eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});

// ── APS — MATRIZ DE SETUP/CHANGEOVER ─────────────────────────
app.get('/api/setup-matrix', auth, async (_req, res) => {
    const { data, error } = await supabase.from('setup_matrix').select('*').order('processo').order('familia_de');
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/setup-matrix/bulk', auth, sigsEscrita, async (req, res) => {
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
app.post('/api/timeline-cenario', auth, sigsEscrita, async (req, res) => {
    const { nome, config, resultado } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome obrigatório' });
    const { data, error } = await supabase.from('timeline_cenario').insert({ nome, config: config||{}, resultado: resultado||{}, usuario_id: req.usuario.id }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, cenario: data });
});
app.put('/api/timeline-cenario/:id', auth, sigsEscrita, async (req, res) => {
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
app.post('/api/feriados/lote', auth, sigsEscrita, async (req, res) => {
    const { feriados } = req.body;
    if (!Array.isArray(feriados) || !feriados.length)
        return res.status(400).json({ erro: 'Dados inválidos' });
    const rows = feriados.map(f => ({ data: f.data, nome: f.nome, tipo: f.tipo || 'Nacional' }));
    // Remove feriados do mesmo ano antes de reinserir (evita duplicatas) — com BACKUP p/ restaurar em falha
    const ano = rows[0]?.data?.slice(0, 4);
    let backup = [];
    if (ano) {
        backup = (await supabase.from('feriados').select('data,nome,tipo').gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`)).data || [];
        await supabase.from('feriados').delete()
            .gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`);
    }
    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('feriados').insert(rows.slice(i, i + 200));
        if (error) {
            // desfaz o que entrou nesta chamada e devolve o ano como estava
            if (ano) {
                await supabase.from('feriados').delete().gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`).then(() => {}, () => {});
                if (backup.length) await supabase.from('feriados').insert(backup).then(() => {}, () => {});
            }
            return erro500(res, error);
        }
    }
    res.json({ ok: true, total: rows.length });
});
app.post('/api/feriados', auth, sigsEscrita, async (req, res) => {
    const { data: d, nome, tipo } = req.body;
    if (!d || !nome) return res.status(400).json({ erro: 'Data e nome obrigatórios' });
    const { data, error } = await supabase.from('feriados').insert({ data: d, nome, tipo: tipo || 'Nacional' }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, feriado: data });
});
app.delete('/api/feriados/:id', auth, sigsEscrita, async (req, res) => {
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
app.post('/api/turnos', auth, sigsEscrita, async (req, res) => {
    const { processo, nome, inicio, fim, intervalo_min, dias_semana } = req.body;
    if (!nome || !inicio || !fim) return res.status(400).json({ erro: 'Nome, início e fim obrigatórios' });
    const { data, error } = await salvarTurno('insert', null, { processo, nome, inicio, fim, intervalo_min, dias_semana });
    if (error) return erro500(res, error);
    res.json({ ok: true, turno: normalizarTurno(data) });
});
app.put('/api/turnos/:id', auth, sigsEscrita, async (req, res) => {
    const { processo, nome, inicio, fim, intervalo_min, dias_semana } = req.body;
    const { data, error } = await salvarTurno('update', req.params.id, { processo, nome, inicio, fim, intervalo_min, dias_semana });
    if (error) return erro500(res, error);
    res.json({ ok: true, data: normalizarTurno(data) });
});

app.delete('/api/turnos/:id', auth, sigsEscrita, async (req, res) => {
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

app.post('/api/processos-config', auth, sigsEscrita, async (req, res) => {
    const { nome, descricao } = req.body;
    const { data, error } = await supabase.from('processos_config').insert({ nome, descricao }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, data });
});
app.put('/api/processos-config/:id', auth, sigsEscrita, async (req, res) => {
    const { nome, descricao } = req.body;
    const { data, error } = await supabase.from('processos_config').update({ nome, descricao }).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, data });
});
app.delete('/api/processos-config/:id', auth, sigsEscrita, async (req, res) => {
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
app.post('/api/maquinas', auth, sigsEscrita, async (req, res) => {
    const { processo_id, id_maquina, modelo, oee, status, n_pessoas } = req.body;
    if (!processo_id) return res.status(400).json({ erro: 'processo_id obrigatório' });
    if (!id_maquina && !modelo && oee == null && n_pessoas == null)
        return res.status(400).json({ erro: 'Preencha ao menos um campo da máquina' });
    const { data, error } = await supabase.from('maquinas').insert({ processo_id, id_maquina: id_maquina || null, modelo: modelo || null, oee: oee ?? null, status: status || 'Ativo', n_pessoas: n_pessoas ?? null }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, data });
});
app.put('/api/maquinas/:id', auth, sigsEscrita, async (req, res) => {
    const { id_maquina, modelo, oee, status, n_pessoas } = req.body;
    const { data, error } = await supabase.from('maquinas').update({ id_maquina, modelo, oee, status, n_pessoas }).eq('id', req.params.id).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, data });
});
app.delete('/api/maquinas/:id', auth, sigsEscrita, async (req, res) => {
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
        if (errImp) return erro500(res, errImp, 'criar importação');
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

app.post('/api/mes/apontamentos', auth, sigsEscrita, async (req, res) => {
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

app.put('/api/mes/apontamentos/:id', auth, sigsEscrita, async (req, res) => {
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
app.post('/api/mes/paradas', auth, sigsEscrita, async (req, res) => {
    const { apontamento_id, tipo, motivo } = req.body;
    if (!apontamento_id || !motivo) return res.status(400).json({ erro: 'apontamento_id e motivo obrigatórios' });
    await supabase.from('apontamentos').update({ status: 'parado' }).eq('id', apontamento_id);
    const { data, error } = await supabase.from('paradas_mes')
        .insert({ apontamento_id, tipo: tipo || 'nao_planejada', motivo, inicio: new Date().toISOString() })
        .select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, parada: data });
});

app.put('/api/mes/paradas/:id', auth, sigsEscrita, async (req, res) => {
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
        { nome: 'previsao_plano',       sql: `CREATE TABLE IF NOT EXISTS previsao_plano (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome TEXT NOT NULL, params JSONB DEFAULT '{}', edicoes JSONB DEFAULT '{}', congelado BOOLEAN DEFAULT false, snapshot JSONB DEFAULT '{}', usuario_id UUID REFERENCES usuarios(id), criado_em TIMESTAMPTZ DEFAULT NOW(), atualizado_em TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE previsao_plano DISABLE ROW LEVEL SECURITY;` },
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

// atualiza campos de uma OP (datas). Onda 2: 'prioridade' saiu do allowlist —
// dono único = APS (PUT /api/aps/ops/:id e POST /api/aps/prioridade-edd).
app.put('/api/mf/ops/:id', auth, mfEscrita, async (req, res) => {
    const upd = {};
    // 'status' NÃO entra aqui — mudança de estado só pela máquina de estados do APS
    // (/api/aps/ops/:id/transicao), que valida transição, roda o gate e escreve no ledger.
    // 'prioridade' também NÃO entra — é campo de programação (N3), dono = APS.
    ['data_prevista', 'data_abertura'].forEach(f => { if (req.body[f] !== undefined) upd[f] = req.body[f]; });
    if (!Object.keys(upd).length) return res.status(400).json({ erro: 'nada para atualizar' });
    const { error } = await supabase.from('ordem_producao').update(upd).eq('id', req.params.id);
    if (error) return erro500(res, error);
    res.json({ ok: true });
});
// Onda 2 (dono único da prioridade = APS): ranqueia a carteira por EDD e grava
// ordem_producao.prioridade. Ranking: 20% mais urgentes→2, 30% seguintes→1.
// Antes vivia em POST /api/mf/sequenciar-carteira (chamado pelo SIGS) — movido para
// cá porque prioridade é campo de programação (N3), dono natural = APS.
app.post('/api/aps/prioridade-edd', auth, sigsEscrita, async (req, res) => {
    const dry = !!req.body?.dry, forcar = !!req.body?.forcar;  // preserva prioridade manual (>0) a menos que forcar
    let ops;
    try { ops = await fetchAllSelect('ordem_producao', 'id,data_prevista,prioridade', q => q.neq('status', 'cancelada').neq('status', 'concluida')); }  // paginado + erro tratado
    catch (e) { return erro500(res, e); }
    ops.sort((a, b) => { if (!a.data_prevista) return 1; if (!b.data_prevista) return -1; return new Date(a.data_prevista) - new Date(b.data_prevista); });
    const n = ops.length; let urgente = 0, alta = 0, normal = 0, preservadas = 0;
    const prioDe = ops.map((o, i) => {
        const frac = n > 1 ? i / n : 0;
        const p = (o.data_prevista && frac < 0.2) ? 2 : (o.data_prevista && frac < 0.5) ? 1 : 0;
        const manual = !forcar && (Number(o.prioridade) || 0) > 0;  // não atropela prioridade já ajustada
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
// DEPRECADO (Onda 2): a priorização da carteira mudou para o APS (dono único da
// prioridade). Mantido como ponteiro — não grava nada, evita erro em cliente antigo.
app.post('/api/mf/sequenciar-carteira', auth, mfEscrita, (_req, res) =>
    res.status(410).json({ ok: false, movido: '/api/aps/prioridade-edd', erro: 'A priorização da carteira agora é feita no APS (Sequenciamento › Aplicar prioridade por EDD).' }));

// ── Cadastros (escrita genérica, admin) ───────────────────────
const MF_CADASTROS = { produto:'codigo', maquina:'codigo', operador:'matricula', turno:'codigo', motivo_parada:'codigo', catalogo_defeito:'codigo' };
app.post('/api/mf/cadastro/:tabela', auth, mfEscrita, async (req, res) => {
    const t = req.params.tabela;
    if (!MF_CADASTROS[t]) return res.status(400).json({ erro: 'Tabela inválida' });
    const { criado_em, atualizado_em, ...corpo } = req.body || {};  // o cliente não define os carimbos de auditoria (trigger cuida)
    // Campos de custo (custo_hora etc.) são admin-only — a rota /api/mf/custo/taxa já exige admin;
    // sem este filtro, o cadastro genérico deixava operador gravar salário/taxa por mass-assignment.
    if (req.usuario?.perfil !== 'admin') for (const k of Object.keys(corpo)) { if (/^custo/i.test(k)) delete corpo[k]; }
    const { data, error } = await supabase.from(t).upsert(corpo, { onConflict: MF_CADASTROS[t] }).select().single();
    if (error) return erro500(res, error);
    res.json({ ok: true, registro: data });
});

// ── Ordem de produção ─────────────────────────────────────────
// DEPRECADO (Onda 6 — entrada única da OP): a CRIAÇÃO de OP tem dono único = APS
// (POST /api/aps/ops, que nasce PLANEJADA e escreve no ledger). Este canal não tinha
// caller na UI. O ERP entra por POST /api/mf/importar-ops (também registrado no ledger).
app.post('/api/mf/ops', auth, mfEscrita, (_req, res) =>
    res.status(410).json({ ok: false, movido: '/api/aps/ops', erro: 'Criação de OP é feita no APS (governança + ledger) ou pelo import de ERP. Este canal foi aposentado.' }));

// ══════════════════════════════════════════════════════════════
// APS — GOVERNANÇA DE ORDENS (Fase 1)
// Máquina de estados validada + gate de liberação + ledger auditado.
// Telas no aps.html; a execução (apontamento) continua no MES.
// ══════════════════════════════════════════════════════════════
const APS_503 = 'Governança não inicializada — rode aps_governanca.sql no Supabase.';
const APS_TRANS = {   // transições MANUAIS válidas (as automáticas — apontamento/fluxo — são logadas à parte)
    planejada:   ['liberada', 'bloqueada', 'cancelada'],
    liberada:    ['planejada', 'em_producao', 'bloqueada', 'cancelada'],
    em_producao: ['pausada', 'concluida', 'bloqueada'],
    pausada:     ['em_producao', 'bloqueada', 'cancelada'],
    bloqueada:   [],           // sai só via desbloqueio com disposição (volta ao estado anterior) ou cancelada
    concluida:   [],
    cancelada:   [],
};
const APS_DISPOSICOES = ['refazer', 'retrabalhar', 'refugar', 'substituir', 'investigar'];
function apsErroTabela(e) { return e && /schema cache|does not exist|relation/i.test(e.message || ''); }
function apsUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '')); }
async function apsLog(op_id, de, para, { motivo = null, disposicao = null, origem = 'manual', usuario = null } = {}) {
    const { error } = await supabase.from('op_state_log').insert({
        op_id, de, para, motivo, disposicao, origem,
        usuario_id: usuario?.id || null, usuario_nome: usuario?.nome || null,
    });
    return error || null;
}

// Gate de liberação (regra de ouro): roteiro + tempos-padrão + prazo. Vazio = pronto p/ liberar.
async function apsGate(op) {
    const pend = [];
    let rot = [];
    try { rot = await roteiroDaOp(op.id) || []; } catch { }
    if (!rot.length) pend.push('Produto sem roteiro (nenhuma etapa ativa/produto_etapa).');
    else {
        const { data: tps } = await supabase.from('tempo_padrao').select('etapa_id,produto_id,seg_por_unidade')
            .or(`produto_id.eq.${op.produto_id},produto_id.is.null`);
        const semTempo = rot.filter(et => {
            const espec = (tps || []).find(t => t.etapa_id === et.id && t.produto_id === op.produto_id);
            const geral = (tps || []).find(t => t.etapa_id === et.id && t.produto_id === null);
            return !(Number(espec?.seg_por_unidade) > 0 || Number(geral?.seg_por_unidade) > 0);
        });
        if (semTempo.length) pend.push(`Sem tempo-padrão em ${semTempo.length} etapa(s) do roteiro: ${semTempo.map(e => e.nome).join(', ')}.`);
    }
    if (!op.data_prevista) pend.push('OP sem data prevista (prazo de entrega).');
    if (!(Number(op.qtd_planejada) > 0)) pend.push('Quantidade planejada deve ser > 0.');
    return pend;
}

// Criar OP pelo APS (origem manual, nasce PLANEJADA, já com registro no ledger)
app.post('/api/aps/ops', auth, sigsEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.numero || !b.produto_id || !(Number(b.qtd_planejada) > 0))
        return res.status(400).json({ erro: 'numero, produto_id e qtd_planejada>0 obrigatórios' });
    const { data: dup } = await supabase.from('ordem_producao').select('id').eq('numero', String(b.numero)).maybeSingle();
    if (dup) return res.status(409).json({ erro: `Já existe OP com o número ${b.numero}.` });
    const row = { numero: String(b.numero), produto_id: b.produto_id, qtd_planejada: Number(b.qtd_planejada),
        unidade: b.unidade || 'pc', data_abertura: new Date().toISOString(), data_prevista: b.data_prevista || null,
        prioridade: Number(b.prioridade) || 0, status: 'planejada', origem: 'manual' };
    const { data, error } = await supabase.from('ordem_producao').insert(row).select().single();
    if (error) return erro500(res, error);
    const eLog = await apsLog(data.id, null, 'planejada', { motivo: 'OP criada no APS', usuario: req.usuario });
    res.json({ ok: true, op: data, governanca: eLog ? 'sem ledger (rode aps_governanca.sql)' : 'ok' });
});

// Checagem do gate (a UI mostra as pendências antes de liberar)
app.get('/api/aps/ops/:id/gate', auth, async (req, res) => {
    if (!apsUuid(req.params.id)) return res.status(400).json({ erro: 'id de OP inválido.' });
    const { data: op, error } = await supabase.from('ordem_producao').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return erro500(res, error);
    if (!op) return res.status(404).json({ erro: 'OP não encontrada.' });
    const pendencias = await apsGate(op);
    res.json({ pronto: pendencias.length === 0, pendencias, status: op.status });
});

// Transição de estado — ÚNICO caminho para mudar status manualmente
app.post('/api/aps/ops/:id/transicao', auth, sigsEscrita, async (req, res) => {
    const b = req.body || {};
    if (!apsUuid(req.params.id)) return res.status(400).json({ erro: 'id de OP inválido.' });   // evita 500 por cast
    const { data: op, error: e0 } = await supabase.from('ordem_producao').select('*').eq('id', req.params.id).maybeSingle();
    if (e0) return erro500(res, e0);
    if (!op) return res.status(404).json({ erro: 'OP não encontrada.' });
    const de = op.status;
    let para = String(b.para || '').trim();
    let origem = 'manual';
    let disposicao = null;

    if (de === 'bloqueada') {
        // Desbloqueio: SEMPRE volta ao estado pré-bloqueio (do ledger) ou vai a 'cancelada'.
        // O cliente NÃO escolhe destino livre — senão liberaria sem passar pelo gate (bypass).
        if (!APS_DISPOSICOES.includes(b.disposicao)) return res.status(422).json({ erro: `Desbloqueio exige disposição: ${APS_DISPOSICOES.join(' | ')}.` });
        if (!String(b.motivo || '').trim()) return res.status(422).json({ erro: 'Desbloqueio exige justificativa (motivo).' });
        disposicao = b.disposicao;
        if (para === 'cancelada') { /* cancelar direto é permitido */ }
        else {
            const { data: ult, error: eL } = await supabase.from('op_state_log').select('de').eq('op_id', op.id).eq('para', 'bloqueada').order('criado_em', { ascending: false }).limit(1).maybeSingle();
            if (apsErroTabela(eL)) return res.status(503).json({ erro: APS_503 });
            // estado anterior confiável; sem ledger → volta a 'planejada' (conservador: re-passa pelo gate)
            para = ['liberada', 'em_producao', 'pausada'].includes(ult?.de) ? ult.de : 'planejada';
        }
    } else {
        if (!(APS_TRANS[de] || []).includes(para))
            return res.status(409).json({ erro: `Transição inválida: ${de} → ${para || '?'}. Permitidas: ${(APS_TRANS[de] || []).join(', ') || 'nenhuma (estado final)'}.` });
        if (para === 'bloqueada' && !String(b.motivo || '').trim())
            return res.status(422).json({ erro: 'Bloqueio exige justificativa (motivo).' });
        // GATE de liberação: planejada → liberada só com roteiro/tempos/prazo — ou override justificado
        if (de === 'planejada' && para === 'liberada') {
            const pendencias = await apsGate(op);
            if (pendencias.length && !b.override) return res.status(422).json({ erro: 'Gate de liberação reprovou.', pendencias });
            if (pendencias.length && b.override) {
                if (!String(b.motivo || '').trim()) return res.status(422).json({ erro: 'Override do gate exige justificativa (motivo).' });
                origem = 'gate';
                b.motivo = 'OVERRIDE DO GATE: ' + b.motivo + ' · Pendências: ' + pendencias.join(' ');
            } else origem = 'gate';
        }
    }

    // CAS (compare-and-set): só grava se o status AINDA é o que lemos — duas transições
    // simultâneas não ressuscitam estado final nem corrompem o ledger (a 2ª pega 0 linhas → 409)
    const { data: updRows, error: e1 } = await supabase.from('ordem_producao').update({ status: para }).eq('id', op.id).eq('status', de).select();
    if (e1 && (e1.code === '23514' || /check constraint|violates/i.test(e1.message || ''))) return res.status(503).json({ erro: APS_503 });
    if (e1) return erro500(res, e1);
    if (!updRows?.length) return res.status(409).json({ erro: 'O estado da OP mudou enquanto você agia — recarregue a carteira e tente de novo.' });
    const upd = updRows[0];
    const eLog = await apsLog(op.id, de, para, { motivo: b.motivo || null, disposicao, origem, usuario: req.usuario });
    if (apsErroTabela(eLog)) return res.json({ ok: true, op: upd, aviso: APS_503 });
    if (eLog) console.error('[APS] ledger falhou na transição', op.id, eLog.message);   // não silencioso
    res.json({ ok: true, op: upd });
});

// Editar prazo/prioridade da OP (NÃO muda status) — permite dar prazo a cartão kanban antes do gate
app.put('/api/aps/ops/:id', auth, sigsEscrita, async (req, res) => {
    if (!apsUuid(req.params.id)) return res.status(400).json({ erro: 'id de OP inválido.' });
    const upd = {};
    if (req.body?.data_prevista !== undefined) upd.data_prevista = req.body.data_prevista || null;
    if (req.body?.prioridade !== undefined) upd.prioridade = Math.max(0, Math.min(9, parseInt(req.body.prioridade) || 0));
    if (!Object.keys(upd).length) return res.status(400).json({ erro: 'nada para atualizar (data_prevista/prioridade)' });
    const { data, error } = await supabase.from('ordem_producao').update(upd).eq('id', req.params.id).select().maybeSingle();
    if (error) return erro500(res, error);
    if (!data) return res.status(404).json({ erro: 'OP não encontrada.' });
    res.json({ ok: true, op: data });
});

// Ledger (trilha de auditoria da OP)
app.get('/api/aps/ops/:id/log', auth, async (req, res) => {
    if (!apsUuid(req.params.id)) return res.status(400).json({ erro: 'id de OP inválido.' });
    const { data, error } = await supabase.from('op_state_log').select('*').eq('op_id', req.params.id).order('criado_em', { ascending: false }).limit(200);
    if (apsErroTabela(error)) return res.status(503).json({ erro: APS_503 });
    if (error) return erro500(res, error);
    res.json(data || []);
});

// ── APS Fase 2 — atributos de setup + tempos de troca ────────
const APS2_503 = 'Atributos de setup não inicializados — rode aps_setup_atributos.sql no Supabase.';
app.get('/api/aps/setup-troca', auth, async (_req, res) => {
    const { data, error } = await supabase.from('setup_troca_atributo').select('atributo,minutos').order('atributo');
    if (apsErroTabela(error)) return res.status(503).json({ erro: APS2_503 });
    if (error) return erro500(res, error);
    res.json(data || []);
});
app.post('/api/aps/setup-troca', auth, sigsEscrita, async (req, res) => {
    const items = (req.body?.items || []).filter(i => ['titulo_fio','galga','cor_base','programa_maquina'].includes(i.atributo));
    if (!items.length) return res.status(400).json({ erro: 'items com atributo válido obrigatório' });
    for (const i of items) {
        const { error } = await supabase.from('setup_troca_atributo')
            .upsert({ atributo: i.atributo, minutos: Math.max(0, Math.round(Number(i.minutos) || 0)), atualizado_em: new Date().toISOString() }, { onConflict: 'atributo' });
        if (apsErroTabela(error)) return res.status(503).json({ erro: APS2_503 });
        if (error) return erro500(res, error);
    }
    res.json({ ok: true, total: items.length });
});

// Atualização em lote de atributos (UPDATE-only, por código — não cria registro novo;
// colunas permitidas por allowlist p/ não virar mass-assignment)
const APS_ATTRS = {
    produto: ['titulo_fio', 'galga', 'cor_base', 'programa_maquina', 'politica', 'lote_reposicao'],
    maquina: ['galga_min', 'galga_max'],
};
app.post('/api/aps/atributos/bulk', auth, sigsEscrita, async (req, res) => {
    const t = String(req.body?.tabela || '');
    const cols = APS_ATTRS[t];
    if (!cols) return res.status(400).json({ erro: 'tabela deve ser produto ou maquina' });
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ erro: 'items obrigatório' });
    let atualizados = 0; const naoEncontrados = [];
    for (const it of items.slice(0, 2000)) {
        const cod = String(it.codigo || '').trim();
        if (!cod) continue;
        const upd = {};
        cols.forEach(c => { if (it[c] !== undefined) upd[c] = it[c] === '' ? null : it[c]; });
        if (!Object.keys(upd).length) continue;
        if (upd.politica != null && !['MTS', 'MTO', 'ATO'].includes(upd.politica))
            return res.status(422).json({ erro: `politica inválida (${upd.politica}) — use MTS, MTO ou ATO.` });
        const { data, error } = await supabase.from(t).update(upd).eq('codigo', cod).select('id');
        if (error && /column|schema cache|could not find/i.test(error.message || '')) {
            // aponta o SQL certo: politica/lote_reposicao vêm do aps_mts_kanban.sql; o resto do aps_setup_atributos.sql
            const doKanban = ('politica' in upd) || ('lote_reposicao' in upd);
            return res.status(503).json({ erro: doKanban ? 'Política/lote não inicializados — rode aps_mts_kanban.sql no Supabase.' : APS2_503 });
        }
        if (error) return erro500(res, error);
        if (data?.length) atualizados++; else naoEncontrados.push(cod);
    }
    res.json({ ok: true, atualizados, naoEncontrados: naoEncontrados.slice(0, 50), totalNaoEncontrados: naoEncontrados.length });
});

// ── APS Fase 3 — kanban eletrônico (reposição MTS) ───────────
// Sob demanda (o PCP dispara — sem job silencioso): produto MTS com estoque < ponto
// de reposição gera OP candidata origem='kanban'. 1 cartão ativo por produto (dedup).
const APS3_503 = 'Kanban não inicializado — rode aps_mts_kanban.sql no Supabase.';
app.post('/api/aps/kanban/verificar', auth, sigsEscrita, async (req, res) => {
    const dry = req.body?.dry !== false;   // padrão = prévia (só gera com dry:false explícito)
    const { data: prods, error: eP } = await supabase.from('produto')
        .select('id,codigo,descricao,politica,lote_reposicao,unidade_medida').eq('politica', 'MTS').eq('ativo', true);
    if (eP && /column|schema cache|could not find/i.test(eP.message || '')) return res.status(503).json({ erro: APS3_503 });
    if (eP) return erro500(res, eP);
    if (!prods?.length) return res.json({ ok: true, dry, itens: [], aRepor: 0, gerados: [], aviso: 'Nenhum produto marcado como MTS — defina a política em APS › Produtos & Setup.' });

    // estoque atual = última importação de estoque do SIGS (produto acabado)
    const { data: imp } = await supabase.from('importacoes_estoque').select('id,criado_em').order('criado_em', { ascending: false }).limit(1).maybeSingle();
    const estoquePorCod = {};
    if (imp) (await fetchAllRows('estoque', imp.id).catch(() => [])).forEach(r => {
        const c = String(r.codigo || '').trim().toUpperCase();
        if (c) estoquePorCod[c] = (estoquePorCod[c] || 0) + (Number(r.quantidade) || 0);
    });
    // ponto de reposição (SIGS · Política de Estoques → estoque_minimo)
    const { data: minimos } = await supabase.from('estoque_minimo').select('codigo,quantidade');
    const pontoPorCod = {}; (minimos || []).forEach(m => { pontoPorCod[String(m.codigo).toUpperCase()] = Number(m.quantidade) || 0; });
    // dedup: OP kanban ainda ativa segura novo cartão do mesmo produto
    const { data: ativas } = await supabase.from('ordem_producao').select('id,produto_id,numero,status').eq('origem', 'kanban').not('status', 'in', '(concluida,cancelada)');
    const cartaoAtivo = {}; (ativas || []).forEach(o => { cartaoAtivo[o.produto_id] = o; });

    const itens = [], aGerar = [];
    for (const p of prods) {
        const cod = String(p.codigo).toUpperCase();
        const estoque = estoquePorCod[cod] ?? null;
        const ponto = pontoPorCod[cod] ?? null;
        const lote = Number(p.lote_reposicao) || 0;
        let situacao, motivo;
        if (ponto === null)            { situacao = 'sem_ponto';   motivo = 'sem ponto de reposição — use SIGS › Política de Estoques › Sugerir Est. Mínimo'; }
        else if (!lote)                { situacao = 'sem_lote';    motivo = 'sem lote de reposição — defina em Produtos & Setup'; }
        else if (estoque === null)     { situacao = 'sem_estoque'; motivo = 'código não aparece na última importação de estoque'; }
        else if (cartaoAtivo[p.id])    { situacao = 'cartao_aberto'; motivo = `cartão ${cartaoAtivo[p.id].numero} ainda ativo (${cartaoAtivo[p.id].status})`; }
        else if (estoque < ponto)      { situacao = 'repor';       motivo = `estoque ${estoque} < ponto ${ponto}`; aGerar.push({ p, cod, estoque, ponto, lote }); }
        else                           { situacao = 'ok';          motivo = `estoque ${estoque} ≥ ponto ${ponto}`; }
        itens.push({ codigo: p.codigo, descricao: p.descricao, estoque, ponto, lote, situacao, motivo });
    }

    const gerados = [];
    if (!dry) {
        const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).replace(/-/g, '').slice(2);
        // prazo do cartão: hoje + lead default (senão o gate reprova todo cartão por "sem data prevista").
        // 7 dias é um DEFAULT EDITÁVEL (o planejador ajusta o prazo na Carteira), não um dado inventado de fábrica.
        const prazoDefault = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        for (const g of aGerar) {
            // número DETERMINÍSTICO (KB-cod-aammdd) — a UNIQUE(numero) faz o dedup do duplo-clique:
            // a 2ª requisição concorrente colide (23505) e é tratada como "já gerado", sem 2º cartão.
            const numero = `KB-${g.cod}-${hojeSP}`;
            const { data: op, error } = await supabase.from('ordem_producao').insert({
                numero, produto_id: g.p.id, qtd_planejada: g.lote, unidade: g.p.unidade_medida || 'pc',
                data_abertura: new Date().toISOString(), data_prevista: prazoDefault, status: 'planejada', origem: 'kanban',
            }).select().single();
            if (error) {
                if (error.code === '23505') { gerados.push({ numero, codigo: g.cod, qtd: g.lote, jaExistia: true }); continue; }  // colisão = já gerado hoje
                if (/origem|check/i.test(error.message || '')) return res.status(503).json({ erro: APS3_503 });
                continue;
            }
            await apsLog(op.id, null, 'planejada', { motivo: `Kanban: estoque ${g.estoque} < ponto ${g.ponto} → repõe lote de ${g.lote} (prazo default +7d)`, origem: 'kanban', usuario: req.usuario }).catch(() => {});
            gerados.push({ numero, codigo: g.cod, qtd: g.lote });
            // situação do item passa a "cartão aberto" (não fica em REPOR na mesma resposta)
            const it = itens.find(x => String(x.codigo).toUpperCase() === g.cod);
            if (it) { it.situacao = 'cartao_aberto'; it.motivo = `cartão ${numero} criado agora`; }
        }
    }
    res.json({ ok: true, dry, itens, aRepor: dry ? aGerar.length : aGerar.length - gerados.length, gerados, estoqueDe: imp?.criado_em || null });
});

// ── APS Fase 4 — sequenciador com pesos parametrizáveis ──────
// Regras combinadas por peso (tabela seq_peso): EDD + minimização de setup (atributos da
// Fase 2, heurística gulosa) + prioridade comercial + SPT. Sempre dry-run (fila sugerida,
// nada é persistido) e devolve o CUSTO TOTAL DE SETUP da sequência vs EDD puro.
const APS4_DEFAULTS = { edd: 50, setup: 20, prioridade: 20, spt: 10 };
app.get('/api/aps/seq-pesos', auth, async (_req, res) => {
    const { data, error } = await supabase.from('seq_peso').select('regra,peso').order('regra');
    if (apsErroTabela(error)) return res.json({ pesos: APS4_DEFAULTS, aviso: 'Usando pesos padrão — rode aps_seq_pesos.sql para poder editá-los.' });
    if (error) return erro500(res, error);
    const pesos = { ...APS4_DEFAULTS };
    (data || []).forEach(r => { pesos[r.regra] = Number(r.peso) || 0; });
    res.json({ pesos });
});
app.post('/api/aps/seq-pesos', auth, sigsEscrita, async (req, res) => {
    const items = Object.entries(req.body?.pesos || {}).filter(([r]) => ['edd','setup','prioridade','spt'].includes(r));
    if (!items.length) return res.status(400).json({ erro: 'pesos {edd,setup,prioridade,spt} obrigatório' });
    for (const [regra, peso] of items) {
        const { error } = await supabase.from('seq_peso').upsert({ regra, peso: Math.max(0, Number(peso) || 0), atualizado_em: new Date().toISOString() }, { onConflict: 'regra' });
        if (apsErroTabela(error)) return res.status(503).json({ erro: 'Rode aps_seq_pesos.sql no Supabase para salvar pesos.' });
        if (error) return erro500(res, error);
    }
    res.json({ ok: true });
});

app.post('/api/aps/sequenciar', auth, async (req, res) => {
    const avisos = [];
    // pesos (tabela ou default)
    let pesos = { ...APS4_DEFAULTS };
    const { data: pRows, error: eP } = await supabase.from('seq_peso').select('regra,peso');
    if (apsErroTabela(eP)) avisos.push('Pesos padrão em uso (rode aps_seq_pesos.sql para editá-los).');
    else if (!eP) (pRows || []).forEach(r => { pesos[r.regra] = Number(r.peso) || 0; });
    const somaPesos = Object.values(pesos).reduce((s, v) => s + v, 0) || 1;

    // fila = OPs LIBERADAS (governança: só o que passou pelo gate entra no despacho)
    const SEL_ATTR = 'id,numero,qtd_planejada,unidade,data_prevista,prioridade,status,origem, produto:produto_id(id,codigo,descricao,titulo_fio,galga,cor_base,programa_maquina)';
    let { data: ops, error: eO } = await supabase.from('ordem_producao').select(SEL_ATTR).eq('status', 'liberada').limit(1000);
    if (eO && /column|schema cache|could not find/i.test(eO.message || '')) {
        avisos.push('Atributos de setup indisponíveis (rode aps_setup_atributos.sql) — sequenciando sem custo de troca.');
        const r2 = await supabase.from('ordem_producao').select('id,numero,qtd_planejada,unidade,data_prevista,prioridade,status,origem, produto:produto_id(id,codigo,descricao)').eq('status', 'liberada').limit(1000);
        if (r2.error) return erro500(res, r2.error);
        ops = r2.data;
    } else if (eO) return erro500(res, eO);
    if (!ops?.length) return res.json({ ok: true, fila: [], avisos: [...avisos, 'Nenhuma OP LIBERADA — libere pelo gate na Carteira de Ordens.'], pesos });

    // tempos de troca por atributo (Fase 2)
    const { data: trocas } = await supabase.from('setup_troca_atributo').select('atributo,minutos');
    const custoAttr = {}; (trocas || []).forEach(t => { custoAttr[t.atributo] = Number(t.minutos) || 0; });
    const custoMax = Object.values(custoAttr).reduce((s, v) => s + v, 0);
    if (!custoMax) avisos.push('Tempos de troca zerados — a regra "setup" não influencia ainda (preencha em Produtos & Setup).');

    // tempo de processamento por produto (SPT): Σ tempo_padrao das etapas do roteiro × qtd
    const [{ data: etapas }, { data: pe }, { data: tps }] = await Promise.all([
        supabase.from('etapa_processo').select('id,ordem').eq('ativo', true).order('ordem'),
        supabase.from('produto_etapa').select('produto_id,etapa_id'),
        supabase.from('tempo_padrao').select('etapa_id,produto_id,seg_por_unidade'),
    ]);
    const rotDe = {}; (pe || []).forEach(x => { (rotDe[x.produto_id] = rotDe[x.produto_id] || new Set()).add(x.etapa_id); });
    const tempoProd = pid => {
        const rot = rotDe[pid] ? (etapas || []).filter(e => rotDe[pid].has(e.id)) : (etapas || []);
        return rot.reduce((s, e) => {
            const esp = (tps || []).find(t => t.etapa_id === e.id && t.produto_id === pid);
            const ger = (tps || []).find(t => t.etapa_id === e.id && t.produto_id === null);
            return s + (Number(esp?.seg_por_unidade) || Number(ger?.seg_por_unidade) || 0);
        }, 0);
    };
    const itens = ops.map(o => ({
        id: o.id, numero: o.numero, codigo: o.produto?.codigo || '—', descricao: o.produto?.descricao || '',
        qtd: Number(o.qtd_planejada) || 0, unidade: o.unidade, prazo: o.data_prevista, prioridade: Number(o.prioridade) || 0,
        origem: o.origem, attrs: {
            titulo_fio: o.produto?.titulo_fio || null, galga: o.produto?.galga || null,
            cor_base: o.produto?.cor_base || null, programa_maquina: o.produto?.programa_maquina || null,
        },
        procMin: o.produto?.id ? (tempoProd(o.produto.id) * (Number(o.qtd_planejada) || 0)) / 60 : 0,
    }));
    if (!itens.some(i => i.procMin > 0)) avisos.push('Sem tempo-padrão cadastrado — a regra "SPT" não influencia ainda (MES › Engenharia).');
    const procMax = Math.max(...itens.map(i => i.procMin), 0);
    // atributo vazio não gera custo de troca (sem dado, sem invenção) — mas isso deixa o custo OTIMISTA; avisa a cobertura
    const semAttr = itens.filter(i => !Object.values(i.attrs).some(Boolean)).length;
    if (custoMax > 0 && semAttr > 0) avisos.push(`${semAttr} de ${itens.length} OP(s) com produto SEM atributos de setup preenchidos — o custo de troca está subestimado (complete em Produtos & Setup).`);

    const hoje = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()) + 'T00:00:00-03:00');
    const diasAte = p => p ? Math.round((new Date(String(p).slice(0, 10) + 'T00:00:00-03:00') - hoje) / 86400000) : null;
    // transição: só conta atributo PREENCHIDO nos dois e diferente (atributo vazio não gera custo — sem dado, sem invenção)
    const custoTrans = (a, b) => Object.keys(custoAttr).reduce((s, k) =>
        s + (a?.[k] && b?.[k] && a[k] !== b[k] ? custoAttr[k] : 0), 0);

    const scoreDe = (item, estadoAttrs) => {
        const d = diasAte(item.prazo);
        const urg = d === null ? 0 : Math.max(0, Math.min(2, (30 - d) / 30));           // 0..2 (atrasada ≈ 2)
        const pri = Math.min(1, item.prioridade / 9);                                    // 0..1
        const setupMin = estadoAttrs ? custoTrans(estadoAttrs, item.attrs) : 0;
        const setup = custoMax > 0 ? 1 - setupMin / custoMax : 0;                        // 0..1 (menor troca = maior)
        const spt = procMax > 0 && item.procMin > 0 ? 1 - item.procMin / procMax : 0;    // 0..1 (mais curta = maior)
        return { total: (pesos.edd * urg + pesos.prioridade * pri + pesos.setup * setup + pesos.spt * spt) / somaPesos, setupMin };
    };

    // sequência gulosa multi-regra
    const restante = [...itens]; const fila = []; let estado = null; let setupTotal = 0;
    while (restante.length) {
        let melhor = 0;
        for (let i = 1; i < restante.length; i++) {
            if (scoreDe(restante[i], estado).total > scoreDe(restante[melhor], estado).total) melhor = i;
        }
        const [sel] = restante.splice(melhor, 1);
        const { setupMin } = scoreDe(sel, estado);
        setupTotal += setupMin;
        fila.push({ ...sel, setupMin, mudou: estado ? Object.keys(custoAttr).filter(k => estado[k] && sel.attrs[k] && estado[k] !== sel.attrs[k]) : [] });
        estado = sel.attrs;
    }
    // comparador: mesma fila em EDD puro → custo de setup
    const edd = [...itens].sort((a, b) => {
        const da = a.prazo ? new Date(a.prazo).getTime() : Infinity, db = b.prazo ? new Date(b.prazo).getTime() : Infinity;
        return da - db;
    });
    let setupEdd = 0, est2 = null;
    edd.forEach(i => { if (est2) setupEdd += custoTrans(est2, i.attrs); est2 = i.attrs; });

    // compatibilidade de galga (restrição física da Fase 2)
    const { data: maqs } = await supabase.from('maquina').select('codigo,galga_min,galga_max,ativo').eq('ativo', true);
    const comLimite = (maqs || []).filter(m => m.galga_min != null || m.galga_max != null);
    if (comLimite.length) {
        fila.forEach(f => {
            const g = parseFloat(String(f.attrs.galga || '').replace(',', '.'));
            if (!isFinite(g)) return;
            f.semTearCompativel = !comLimite.some(m => (m.galga_min == null || g >= Number(m.galga_min)) && (m.galga_max == null || g <= Number(m.galga_max)));
        });
    }

    res.json({ ok: true, pesos, avisos, fila: fila.map(({ attrs, ...f }) => ({ ...f, ...attrs })),
        setupTotalMin: setupTotal, setupEddMin: setupEdd, economiaMin: setupEdd - setupTotal });
});

// ── APS Fase 5 — loop fechado (sequência congelada + DESATUALIZADO) ──
const APS5_503 = 'Loop fechado não inicializado — rode aps_seq_plano.sql no Supabase.';

// Congela a sequência aprovada (foto). Desativa a anterior. Guarda op_id/posição/prazo
// + o STATUS de cada OP no momento do congelamento (base p/ detectar divergência depois).
app.post('/api/aps/seq-plano/congelar', auth, sigsEscrita, async (req, res) => {
    const itensIn = Array.isArray(req.body?.itens) ? req.body.itens : [];
    const ids = itensIn.map(i => i.op_id).filter(apsUuid);
    if (!ids.length) return res.status(400).json({ erro: 'itens com op_id (UUID) obrigatório — sequencie antes de congelar.' });
    // lê o estado REAL das OPs agora (não confia no que o cliente mandou de status)
    const { data: opsAgora, error: eO } = await supabase.from('ordem_producao').select('id,numero,status,data_prevista').in('id', ids);
    if (eO) return erro500(res, eO);
    const porId = {}; (opsAgora || []).forEach(o => { porId[o.id] = o; });
    const itens = itensIn.filter(i => porId[i.op_id]).map((i, idx) => ({
        op_id: i.op_id, numero: porId[i.op_id].numero, posicao: idx + 1,
        prazo: porId[i.op_id].data_prevista, status: porId[i.op_id].status,
    }));
    if (!itens.length) return res.status(400).json({ erro: 'nenhuma OP válida para congelar.' });
    const tolerancia_dias = Math.max(0, parseInt(req.body?.tolerancia_dias) || 0);
    await supabase.from('seq_plano').update({ ativo: false }).eq('ativo', true);   // só 1 ativo
    const { data, error } = await supabase.from('seq_plano').insert({
        itens, tolerancia_dias, setup_total_min: Number(req.body?.setup_total_min) || null,
        usuario_id: req.usuario?.id || null, usuario_nome: req.usuario?.nome || null,
    }).select().single();
    if (apsErroTabela(error)) return res.status(503).json({ erro: APS5_503 });
    if (error) return erro500(res, error);
    res.json({ ok: true, plano: { id: data.id, congelado_em: data.congelado_em, total: itens.length } });
});

// Plano ativo + análise de DESATUALIZADO (compara a foto com a realidade — sob demanda, nada silencioso)
app.get('/api/aps/seq-plano', auth, async (_req, res) => {
    const { data: plano, error } = await supabase.from('seq_plano').select('*').eq('ativo', true).order('congelado_em', { ascending: false }).limit(1).maybeSingle();
    if (apsErroTabela(error)) return res.status(503).json({ erro: APS5_503 });
    if (error) return erro500(res, error);
    if (!plano) return res.json({ plano: null });

    const itens = Array.isArray(plano.itens) ? plano.itens : [];
    const ids = itens.map(i => i.op_id).filter(apsUuid);
    const { data: ops } = ids.length ? await supabase.from('ordem_producao').select('id,numero,status,data_prevista').in('id', ids) : { data: [] };
    const agora = {}; (ops || []).forEach(o => { agora[o.id] = o; });
    // OPs liberadas HOJE que não estavam na foto = entraram depois
    const { data: libAgora } = await supabase.from('ordem_producao').select('id,numero').eq('status', 'liberada');
    const noPlano = new Set(ids);

    const hoje = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()) + 'T00:00:00-03:00');
    const congDia = new Date(String(plano.congelado_em).slice(0, 10) + 'T00:00:00-03:00');
    const diasAtraso = (p, ref) => p ? Math.round((ref - new Date(String(p).slice(0, 10) + 'T00:00:00-03:00')) / 86400000) : -Infinity;
    const tol = plano.tolerancia_dias || 0;

    const divergencias = [];
    let concluidas = 0;
    itens.forEach(it => {
        const o = agora[it.op_id];
        if (!o) { divergencias.push({ tipo: 'sumiu', numero: it.numero, detalhe: 'OP não existe mais' }); return; }
        if (o.status === 'concluida') { concluidas++; return; }
        if (o.status === 'bloqueada') divergencias.push({ tipo: 'bloqueada', numero: o.numero, detalhe: 'entrou em hold depois de congelar' });
        else if (o.status === 'cancelada') divergencias.push({ tipo: 'cancelada', numero: o.numero, detalhe: 'cancelada depois de congelar' });
        else {
            // só é DRIFT se o atraso surgiu/piorou APÓS o congelamento (já-atrasada no congelamento não é divergência)
            const atHoje = diasAtraso(o.data_prevista, hoje), atCong = diasAtraso(o.data_prevista, congDia);
            if (atHoje > tol && atCong <= tol) divergencias.push({ tipo: 'atrasada', numero: o.numero, detalhe: `${atHoje} dia(s) de atraso (surgiu depois de congelar)` });
        }
    });
    const novas = (libAgora || []).filter(o => !noPlano.has(o.id));
    novas.slice(0, 30).forEach(o => divergencias.push({ tipo: 'nova', numero: o.numero, detalhe: 'liberada depois de congelar — fora da fila' }));

    res.json({
        plano: { id: plano.id, congelado_em: plano.congelado_em, usuario: plano.usuario_nome, total: itens.length, tolerancia_dias: tol },
        progresso: { concluidas, restantes: itens.length - concluidas },
        desatualizado: divergencias.length > 0,
        divergencias,
    });
});

// ══════════════════════════════════════════════════════════════════════════
// N1TECH — Planejamento & Sequenciamento (PP + TOC-pull + APS)  ·  4º sistema
// Decisão do dono: N1Tech é a EVOLUÇÃO do APS (aposenta o APS ao alcançar
// paridade). Dados mestres (produto/roteiro/tempo/setup) são compartilhados e
// SÓ LIDOS aqui. Tabelas de fluxo próprias do spec entram por fase.
// Build por gates: F0 (dados mestres) → F1 (laço PULL) → F2 (planejamento).
// ══════════════════════════════════════════════════════════════════════════

// ── F0: auditoria de dados mestres (roteiro + tempo-padrão por SKU) ──────────
// Read-only. Alimenta o gate F0→F1 (SKUs prontos = roteiro definido + todas as
// etapas do roteiro com tempo-padrão). Reusa a massa do MES; nada é duplicado.
app.get('/api/n1/f0-auditoria', auth, async (req, res) => {
    const limite = Math.min(Math.max(Number(req.query.limite) || 200, 1), 1000);
    const [prodR, etapasR, peR, tpR] = await Promise.all([
        supabase.from('produto').select('id,codigo,descricao,ativo').eq('ativo', true),
        supabase.from('etapa_processo').select('id,nome,ordem').eq('ativo', true).order('ordem'),
        supabase.from('produto_etapa').select('produto_id,etapa_id'),
        supabase.from('tempo_padrao').select('etapa_id,produto_id,seg_por_unidade'),
    ]);
    if (prodR.error) return erro500(res, prodR.error);
    const todas = etapasR.data || [];
    // roteiro por produto (produto_etapa) — sem linhas = usa todas as etapas (compatível com roteiroDoProduto)
    const rotDe = {}; (peR.data || []).forEach(x => { (rotDe[x.produto_id] = rotDe[x.produto_id] || new Set()).add(x.etapa_id); });
    // tempo-padrão: set de etapas com tempo genérico + mapa (produto,etapa)→seg
    const tGeral = new Set(); const tEspec = new Set();
    (tpR.data || []).forEach(t => { if (!(Number(t.seg_por_unidade) > 0)) return;
        if (t.produto_id) tEspec.add(t.produto_id + '|' + t.etapa_id); else tGeral.add(t.etapa_id); });
    const temTempo = (pid, eid) => tEspec.has(pid + '|' + eid) || tGeral.has(eid);

    let prontos = 0, semRoteiro = 0, semTempo = 0;
    const itens = (prodR.data || []).map(p => {
        const temRoteiroProprio = !!rotDe[p.id]?.size;
        const rot = temRoteiroProprio ? todas.filter(e => rotDe[p.id].has(e.id)) : todas;
        const faltando = rot.filter(e => !temTempo(p.id, e.id)).map(e => e.nome);
        const pronto = rot.length > 0 && faltando.length === 0;
        if (!temRoteiroProprio) semRoteiro++;
        if (faltando.length) semTempo++;
        if (pronto) prontos++;
        return { produto_id: p.id, codigo: p.codigo, descricao: p.descricao,
            etapas: rot.length, roteiro_proprio: temRoteiroProprio, tempos_faltando: faltando, pronto };
    });
    // ordena: incompletos primeiro (o que precisa de atenção no gate), depois por código
    itens.sort((a, b) => (a.pronto - b.pronto) || String(a.codigo).localeCompare(String(b.codigo), undefined, { numeric: true }));
    const total = itens.length;
    res.json({
        resumo: { total, prontos, sem_roteiro: semRoteiro, sem_tempo: semTempo,
            cobertura_pct: total ? Math.round(prontos / total * 100) : 0,
            etapas_ativas: todas.length },
        itens: itens.slice(0, limite),
        truncado: total > limite ? total - limite : 0,
    });
});

// ── F0: BOM (lista técnica — consumo de fio/MP por SKU). Tabela própria do N1. ─
// Habilita o check de fio no gate (③) e o desacople híbrido no semiacabado.
// Degrada limpo (503 com instrução) enquanto n1_f0.sql não foi rodado.
const N1_BOM_503 = 'BOM não inicializada — rode n1_f0.sql no Supabase (SQL Editor).';
app.get('/api/n1/bom', auth, async (_req, res) => {
    const r = await supabase.from('bom').select('id,produto_id,material_codigo,material_descricao,qtd_por_unidade,unidade,ativo, produto:produto_id(codigo,descricao)').eq('ativo', true).limit(2000);
    if (r.error) { if (/schema cache|does not exist|relation/i.test(r.error.message || '')) return res.status(503).json({ erro: N1_BOM_503 }); return erro500(res, r.error); }
    res.json(r.data || []);
});
app.post('/api/n1/bom', auth, sigsEscrita, async (req, res) => {
    const b = req.body || {};
    if (!b.produto_id || !b.material_codigo) return res.status(400).json({ erro: 'produto_id e material_codigo obrigatórios' });
    const row = { produto_id: b.produto_id, material_codigo: String(b.material_codigo).trim(),
        material_descricao: b.material_descricao || null, qtd_por_unidade: Number(b.qtd_por_unidade) || 0,
        unidade: ['kg', 'm', 'pc', 'g'].includes(b.unidade) ? b.unidade : 'kg' };
    const r = await supabase.from('bom').insert(row).select().single();
    if (r.error) { if (/schema cache|does not exist|relation/i.test(r.error.message || '')) return res.status(503).json({ erro: N1_BOM_503 }); return erro500(res, r.error); }
    res.json({ ok: true, bom: r.data });
});
// import em massa da BOM (colado do Excel na tela): resolve produto por código,
// upsert por (produto, material). Dry-run com preview quando confirmar=false.
app.post('/api/n1/bom/bulk', auth, sigsEscrita, async (req, res) => {
    const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
    const confirmar = !!req.body?.confirmar;
    if (!linhas.length) return res.status(400).json({ erro: 'linhas [] obrigatório' });
    let prods;
    try { prods = await fetchAllSelect('produto', 'id,codigo'); } catch (e) { return erro500(res, e); }
    const idDe = {}; (prods || []).forEach(p => { if (p.codigo) idDe[String(p.codigo).trim().toUpperCase()] = p.id; });
    const validas = [], semProduto = [];
    for (const l of linhas.slice(0, 3000)) {
        const cod = String(l.codigo || '').trim().toUpperCase();
        const mat = String(l.material_codigo || '').trim();
        if (!cod || !mat) continue;
        const pid = idDe[cod];
        if (!pid) { semProduto.push(cod); continue; }
        validas.push({ produto_id: pid, material_codigo: mat.toUpperCase(), material_descricao: String(l.material_descricao || '').trim() || null,
            qtd_por_unidade: Number(l.qtd_por_unidade) || 0, unidade: ['kg', 'g', 'm', 'pc'].includes(l.unidade) ? l.unidade : 'kg', ativo: true });
    }
    if (!confirmar) return res.json({ ok: true, preview: true, validas: validas.length, sem_produto: [...new Set(semProduto)].slice(0, 30), sem_produto_total: new Set(semProduto).size });
    let gravadas = 0;
    for (let i = 0; i < validas.length; i += 500) {
        const { error } = await supabase.from('bom').upsert(validas.slice(i, i + 500), { onConflict: 'produto_id,material_codigo' });
        if (error) { if (/schema cache|does not exist|relation/i.test(error.message || '')) return res.status(503).json({ erro: N1_BOM_503 }); return erro500(res, error); }
        gravadas += Math.min(500, validas.length - i);
    }
    res.json({ ok: true, gravadas, sem_produto_total: new Set(semProduto).size });
});

// ══════════════════ N1 · F1 — LAÇO MÍNIMO (PULL) ═════════════════════════════
// Comunicação por TABELA (spec §2.1): ETL → venda_movimento/estoque_posicao;
// motor → parametro_reposicao/ordem_sugerida; APS → fila_maquina; fechamento →
// kpi_diario/tempo_real_roteiro/DBM. Degrada com 503+instrução até n1_f1.sql.
const N1_F1_503 = 'Tabelas do F1 não existem — rode n1_f1.sql no Supabase (SQL Editor).';
const n1ErroTabela = e => e && /schema cache|does not exist|relation/i.test(e.message || '');
const N1_MESES = { jan:1, fev:2, mar:3, abr:4, mai:5, jun:6, jul:7, ago:8, set:9, out:10, nov:11, dez:12 };
// lock simples por job (spec §7: job não roda 2× concorrente)
const n1Locks = {};
function n1Lock(nome) { if (n1Locks[nome]) return false; n1Locks[nome] = Date.now(); return true; }
function n1Unlock(nome) { delete n1Locks[nome]; }

// ── ESTOQUE F1: posição VIVA = âncora (importação ERP) + Σ movimentos desde a âncora ──
// estoque_movimento ausente → movs=[] e a posição degrada para a âncora (como antes).
async function n1PosicoesVivas() {
    let poss = [], movs = [];
    try { poss = await fetchAllSelect('estoque_posicao', 'codigo,disponivel,reservado,wip,posicao,ancora_em'); }
    catch {   // coluna ancora_em ainda não existe (n1_estoque.sql não rodado) → usa a fotografia como está
        try { poss = await fetchAllSelect('estoque_posicao', 'codigo,disponivel,reservado,wip,posicao'); } catch { poss = []; }
    }
    try { movs = await fetchAllSelect('estoque_movimento', 'codigo,delta,criado_em'); } catch { movs = []; }
    const anc = {}, base = {};
    (poss || []).forEach(p => { anc[p.codigo] = p.ancora_em ? new Date(p.ancora_em).getTime() : 0; base[p.codigo] = p; });
    const deltaDe = {}, ultMov = {};
    (movs || []).forEach(m => {
        const t = new Date(m.criado_em).getTime();
        if (t <= (anc[m.codigo] || 0)) return;                     // anterior à âncora: já está na fotografia
        deltaDe[m.codigo] = (deltaDe[m.codigo] || 0) + (Number(m.delta) || 0);
        if (!ultMov[m.codigo] || t > ultMov[m.codigo]) ultMov[m.codigo] = t;
    });
    const out = {};   // codigo → { disponivel, wip, posicao (viva), delta_mov, ancora_em }
    const todos = new Set([...Object.keys(base), ...Object.keys(deltaDe)]);
    todos.forEach(c => {
        const b = base[c] || { disponivel: 0, reservado: 0, wip: 0, posicao: 0, ancora_em: null };
        const d = deltaDe[c] || 0;
        out[c] = { disponivel: (Number(b.disponivel) || 0) + d, wip: Number(b.wip) || 0,
                   posicao: (Number(b.posicao) || 0) + d, delta_mov: d, ancora_em: b.ancora_em,
                   ult_mov: ultMov[c] ? new Date(ultMov[c]).toISOString() : null };
    });
    return out;
}

// hook do MES: sessão de apontamento fechou pela 1ª vez → movimentos de estoque.
// ÚLTIMA etapa do roteiro → entrada do produto acabado (qtd boa).
// PRIMEIRA etapa → consumo de fio via BOM × (boa+refugo+retrabalho).
// Best-effort: falta de tabela/roteiro/BOM não quebra o fechamento da sessão.
async function n1EstoqueDoApontamento(ap, usuario) {
    try {
        if (!ap?.op_id) return;
        const { data: op } = await supabase.from('ordem_producao').select('numero,produto_id').eq('id', ap.op_id).maybeSingle();
        if (!op?.produto_id) return;
        const { data: prod } = await supabase.from('produto').select('codigo').eq('id', op.produto_id).maybeSingle();
        const codigoPA = String(prod?.codigo || '').trim().toUpperCase();
        const rot = await roteiroDaOp(ap.op_id);
        if (!rot?.length) return;                                   // sem roteiro não dá para saber 1ª/última
        let etapaId = ap.etapa_id;
        if (!etapaId && ap.maquina_id) {
            const { data: maq } = await supabase.from('maquina').select('etapa_id').eq('id', ap.maquina_id).maybeSingle();
            etapaId = maq?.etapa_id;
        }
        if (!etapaId) return;
        const boa = Number(ap.qtd_boa) || 0;
        const total = boa + (Number(ap.qtd_refugo) || 0) + (Number(ap.qtd_retrabalho) || 0);
        const movs = [];
        if (etapaId === rot[rot.length - 1].id && boa > 0 && codigoPA)
            movs.push({ codigo: codigoPA, tipo: 'entrada_producao', delta: boa, apontamento_id: ap.id, op_id: ap.op_id,
                motivo: `OP ${op.numero} · ${rot[rot.length - 1].nome}`, usuario_nome: usuario?.nome || null });
        if (etapaId === rot[0].id && total > 0) {
            const { data: bom } = await supabase.from('bom').select('material_codigo,qtd_por_unidade').eq('produto_id', op.produto_id).eq('ativo', true);
            (bom || []).forEach(b => movs.push({ codigo: String(b.material_codigo).trim().toUpperCase(), tipo: 'consumo_mp',
                delta: -(Number(b.qtd_por_unidade) || 0) * total, apontamento_id: ap.id, op_id: ap.op_id,
                motivo: `BOM ${codigoPA} × ${total} · ${rot[0].nome}`, usuario_nome: usuario?.nome || null }));
        }
        if (movs.length) {
            const { error } = await supabase.from('estoque_movimento').insert(movs.filter(m => m.delta !== 0));
            if (error && !n1ErroTabela(error)) console.warn('estoque_movimento:', error.message);
        }
    } catch (e) { console.warn('n1EstoqueDoApontamento:', e.message); }
}

// ── ① ETL: vendas(meses JSONB) → venda_movimento · estoque+WIP → estoque_posicao ─
app.post('/api/n1/etl/sync', auth, sigsEscrita, async (_req, res) => {
    if (!n1Lock('etl')) return res.status(409).json({ erro: 'ETL já está rodando.' });
    try {
        const avisos = [];
        // vendas → venda_movimento (série mensal por SKU; a fonte já traz zeros)
        let vendasRows;
        try { vendasRows = await fetchAllSelect('vendas', 'codigo,meses'); }
        catch (e) { return erro500(res, e); }
        const porMes = {};   // codigo|aaaa-mm-01 → qtd (somada entre importações)
        for (const v of vendasRows || []) {
            const cod = String(v.codigo || '').trim().toUpperCase(); if (!cod || !v.meses) continue;
            for (const [k, q] of Object.entries(v.meses)) {
                const m = k.match(/^([a-z]{3})_(\d{4})$/); if (!m || !(m[1] in N1_MESES)) continue;  // ignora chave sem ano (ex.: 'mar')
                const comp = `${m[2]}-${String(N1_MESES[m[1]]).padStart(2, '0')}-01`;
                const key = cod + '|' + comp;
                porMes[key] = (porMes[key] || 0) + (Number(q) || 0);
            }
        }
        const vmRows = Object.entries(porMes).map(([k, qtd]) => { const [codigo, competencia] = k.split('|'); return { codigo, competencia, qtd }; });
        for (let i = 0; i < vmRows.length; i += 500) {
            const { error } = await supabase.from('venda_movimento').upsert(vmRows.slice(i, i + 500), { onConflict: 'codigo,competencia' });
            if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_F1_503 });
            if (error) return erro500(res, error);
        }
        // estoque → disponível · OPs ativas → WIP (posição = disp − res + wip é GENERATED)
        let estRows, opsAtivas, prods;
        try {
            [estRows, opsAtivas, prods] = await Promise.all([
                fetchAllSelect('estoque', 'codigo,quantidade'),
                fetchAllSelect('ordem_producao', 'produto_id,qtd_planejada,status', q => q.in('status', ['planejada', 'liberada', 'em_producao', 'pausada'])),
                fetchAllSelect('produto', 'id,codigo'),
            ]);
        } catch (e) { return erro500(res, e); }
        const codDe = {}; (prods || []).forEach(p => { if (p.codigo) codDe[p.id] = String(p.codigo).trim().toUpperCase(); });
        const wipDe = {}; (opsAtivas || []).forEach(o => { const c = codDe[o.produto_id]; if (c) wipDe[c] = (wipDe[c] || 0) + (Number(o.qtd_planejada) || 0); });
        const dispDe = {}; (estRows || []).forEach(e => { const c = String(e.codigo || '').trim().toUpperCase(); if (c) dispDe[c] = (dispDe[c] || 0) + (Number(e.quantidade) || 0); });
        const todos = [...new Set([...Object.keys(dispDe), ...Object.keys(wipDe)])];
        // F2: reconciliação — o que o SISTEMA calculava × o que o ERP trouxe (antes de re-ancorar).
        // Nota honesta: saídas por venda/expedição ainda não são movimentadas (F3) — divergência
        // negativa esperada ≈ vendas do período; o IRA vira estrito quando a expedição entrar.
        let reconc = null;
        try {
            const vivasAntes = await n1PosicoesVivas();
            const agoraRun = new Date().toISOString();
            const divs = [];
            Object.entries(dispDe).forEach(([c, erp]) => {
                const sis = vivasAntes[c] ? Number(vivasAntes[c].disponivel) : null;
                if (sis == null) return;                          // código novo no ERP: nada a comparar
                const d = Math.round((sis - (Number(erp) || 0)) * 1000) / 1000;
                if (Math.abs(d) > 0.001) divs.push({ executado_em: agoraRun, codigo: c, sistema: sis, erp: Number(erp) || 0, divergencia: d });
            });
            const comparados = Object.keys(dispDe).filter(c => vivasAntes[c]).length;
            if (divs.length) {
                for (let i = 0; i < divs.length; i += 500) {
                    const { error } = await supabase.from('estoque_reconciliacao').insert(divs.slice(i, i + 500));
                    if (error) { if (!n1ErroTabela(error)) console.warn('reconciliacao:', error.message); break; }
                }
            }
            reconc = { comparados, divergentes: divs.length,
                ira_pct: comparados ? Math.round((1 - divs.length / comparados) * 1000) / 10 : null,
                maiores: divs.sort((a, b) => Math.abs(b.divergencia) - Math.abs(a.divergencia)).slice(0, 5)
                    .map(d => ({ codigo: d.codigo, sistema: d.sistema, erp: d.erp, divergencia: d.divergencia })) };
        } catch (e) { console.warn('reconciliacao:', e.message); }

        const agoraISO = new Date().toISOString();
        const epRows = todos.map(c => ({ codigo: c, disponivel: dispDe[c] || 0, reservado: 0, wip: wipDe[c] || 0, atualizado_em: agoraISO, ancora_em: agoraISO }));
        for (let i = 0; i < epRows.length; i += 500) {
            const { error } = await supabase.from('estoque_posicao').upsert(epRows.slice(i, i + 500), { onConflict: 'codigo' });
            if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_F1_503 });
            if (error) return erro500(res, error);
        }
        if (!vmRows.length) avisos.push('Nenhum movimento de venda com mês/ano reconhecível.');
        res.json({ ok: true, movimentos: vmRows.length, skus_vendas: new Set(vmRows.map(r => r.codigo)).size, posicoes: epRows.length, com_wip: Object.keys(wipDe).length, reconciliacao: reconc, avisos });
    } finally { n1Unlock('etl'); }
});

// ── ② motor DIÁRIO: μ/σ (série completa com zeros) + pulmão inicial μ×LT (3 zonas) ─
app.post('/api/n1/motor/diario', auth, sigsEscrita, async (req, res) => {
    if (!n1Lock('motor')) return res.status(409).json({ erro: 'Motor já está rodando.' });
    try {
        const ltDefault = Math.min(Math.max(Number(req.body?.lt_dias) || 30, 1), 180);
        let vm;
        try { vm = await fetchAllSelect('venda_movimento', 'codigo,competencia,qtd'); }
        catch (e) { return n1ErroTabela(e) ? res.status(503).json({ erro: N1_F1_503 }) : erro500(res, e); }
        if (!vm?.length) return res.json({ ok: true, skus: 0, avisos: ['venda_movimento vazia — rode o ETL primeiro.'] });
        // trilho: politica_item homologada > provisório (F1: tudo PULL — MTS default; MTO/PUSH entra no F2)
        const { data: pols } = await supabase.from('politica_item').select('codigo,trilho').eq('ativo', true);
        const trilhoDe = {}; (pols || []).forEach(p => { trilhoDe[p.codigo] = p.trilho; });
        // série completa por SKU: do 1º ao último mês GLOBAL (zeros onde não vendeu — princípio §2.7)
        const comps = [...new Set(vm.map(r => String(r.competencia).slice(0, 7)))].sort();
        const serieDe = {};
        vm.forEach(r => { const c = String(r.codigo); (serieDe[c] = serieDe[c] || {})[String(r.competencia).slice(0, 7)] = Number(r.qtd) || 0; });
        const { data: params } = await supabase.from('parametro_reposicao').select('codigo,pulmao,ultimo_ajuste_em');
        const pulmaoAtual = {}; (params || []).forEach(p => { pulmaoAtual[p.codigo] = p; });
        const rows = []; let pushSkip = 0;
        for (const [codigo, meses] of Object.entries(serieDe)) {
            if ((trilhoDe[codigo] || 'PULL') === 'PUSH') { pushSkip++; continue; }   // exclusividade de trilho (§2.2)
            const serie = comps.map(c => meses[c] || 0);                              // zeros incluídos
            const n = serie.length; if (!n) continue;
            const mu = serie.reduce((s, v) => s + v, 0) / n;
            const sigma = Math.sqrt(serie.reduce((s, v) => s + (v - mu) ** 2, 0) / n);
            const cv = mu > 0 ? sigma / mu : null;
            const ex = pulmaoAtual[codigo];
            // pulmão inicial = μ_diária × LT (3 zonas iguais via coluna GENERATED). DBM (⑥) ajusta depois;
            // o job diário NÃO reescreve pulmão existente (duas frequências, §2.6).
            const pulmaoIni = Math.ceil((mu / 30) * ltDefault);
            rows.push({ codigo, mu_mensal: Math.round(mu * 1000) / 1000, sigma_mensal: Math.round(sigma * 1000) / 1000,
                cv: cv != null ? Math.round(cv * 10000) / 10000 : null, lt_dias: ltDefault,
                pulmao: ex ? ex.pulmao : pulmaoIni, ativo: true });
        }
        for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabase.from('parametro_reposicao').upsert(rows.slice(i, i + 500), { onConflict: 'codigo' });
            if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_F1_503 });
            if (error) return erro500(res, error);
        }
        const comPulmao = rows.filter(r => Number(r.pulmao) > 0).length;
        res.json({ ok: true, skus: rows.length, com_pulmao: comPulmao, sem_demanda: rows.length - comPulmao, push_ignorados: pushSkip, meses_serie: comps.length, lt_dias: ltDefault });
    } finally { n1Unlock('motor'); }
});

// ── ② VARREDURA: posição vs zonas → ordem_sugerida (prio 0–100, spec §5) ─────
app.post('/api/n1/varredura', auth, sigsEscrita, async (_req, res) => {
    if (!n1Lock('varredura')) return res.status(409).json({ erro: 'Varredura já está rodando.' });
    try {
        let params, vivas;
        try {
            [params, vivas] = await Promise.all([
                fetchAllSelect('parametro_reposicao', 'codigo,pulmao,zona,dias_vermelho', q => q.eq('ativo', true).gt('pulmao', 0)),
                n1PosicoesVivas(),                               // âncora ERP + movimentos (kardex)
            ]);
        } catch (e) { return n1ErroTabela(e) ? res.status(503).json({ erro: N1_F1_503 }) : erro500(res, e); }
        const posDe = {}; Object.entries(vivas).forEach(([c, v]) => { posDe[c] = v.posicao; });
        const { data: pendentes } = await supabase.from('ordem_sugerida').select('codigo').eq('status', 'PENDENTE');
        const jaPend = new Set((pendentes || []).map(x => x.codigo));
        let geradas = 0, jaExistiam = 0, verdes = 0;
        for (const p of params || []) {
            const pos = posDe[p.codigo] ?? 0, pulmao = Number(p.pulmao), zona = pulmao / 3;
            const pen = Math.max(0, Math.min(1, 1 - pos / pulmao));   // penetração no pulmão (0=cheio, 1=zerado)
            let zonaCor = null, prio = 0;
            if (pos <= 0) { zonaCor = 'PRETO'; prio = 95 + 5 * Math.min(1, -pos / (pulmao || 1)); }
            else if (pos <= zona) { zonaCor = 'VERMELHO'; const pz = 1 - pos / zona; prio = 70 + 25 * pz; }
            else if (pos <= 2 * zona) { zonaCor = 'AMARELO'; const pz = 1 - (pos - zona) / zona; prio = 35 + 35 * pz; }
            else { verdes++; continue; }                              // VERDE não gera (§5)
            if (jaPend.has(p.codigo)) { jaExistiam++; continue; }     // 1 PENDENTE por SKU
            const { error } = await supabase.from('ordem_sugerida').insert({
                codigo: p.codigo, qtd: Math.ceil(pulmao - Math.max(0, pos)),  // enche o pulmão
                prioridade: Math.round(Math.min(100, prio) * 10) / 10, zona_origem: zonaCor,
                penetracao: Math.round(pen * 10000) / 10000, motivo: `posição ${pos} / pulmão ${pulmao}` });
            if (error && error.code === '23505') { jaExistiam++; continue; }  // corrida: UNIQUE parcial segurou
            if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_F1_503 });
            if (error) return erro500(res, error);
            geradas++;
        }
        res.json({ ok: true, geradas, ja_pendentes: jaExistiam, no_verde: verdes, avaliados: (params || []).length });
    } finally { n1Unlock('varredura'); }
});

// ── ② leitura: pulmões com posição/zona/penetração (tela + PWA cor) ──────────
app.get('/api/n1/pulmoes', auth, async (_req, res) => {
    let params, posDe;
    try {
        [params, posDe] = await Promise.all([
            fetchAllSelect('parametro_reposicao', '*', q => q.eq('ativo', true)),
            n1PosicoesVivas(),                                   // âncora ERP + movimentos (kardex)
        ]);
    } catch (e) { return n1ErroTabela(e) ? res.status(503).json({ erro: N1_F1_503 }) : erro500(res, e); }
    const itens = (params || []).map(p => {
        const ep = posDe[p.codigo] || {}; const pos = Number(ep.posicao) || 0, pulmao = Number(p.pulmao) || 0, zona = pulmao / 3;
        const cor = pulmao <= 0 ? 'SEM_PULMAO' : pos <= 0 ? 'PRETO' : pos <= zona ? 'VERMELHO' : pos <= 2 * zona ? 'AMARELO' : 'VERDE';
        return { codigo: p.codigo, mu_mensal: p.mu_mensal, sigma_mensal: p.sigma_mensal, cv: p.cv, lt_dias: p.lt_dias,
            pulmao, disponivel: Number(ep.disponivel) || 0, wip: Number(ep.wip) || 0, posicao: pos, cor, delta_mov: ep.delta_mov || 0,
            penetracao_pct: pulmao > 0 ? Math.round(Math.max(0, Math.min(1, 1 - pos / pulmao)) * 100) : null,
            dias_vermelho: p.dias_vermelho, dias_verde: p.dias_verde, ultimo_ajuste_em: p.ultimo_ajuste_em };
    }).sort((a, b) => (b.penetracao_pct || 0) - (a.penetracao_pct || 0));
    res.json({ itens, resumo: { total: itens.length,
        preto: itens.filter(i => i.cor === 'PRETO').length, vermelho: itens.filter(i => i.cor === 'VERMELHO').length,
        amarelo: itens.filter(i => i.cor === 'AMARELO').length, verde: itens.filter(i => i.cor === 'VERDE').length } });
});

// ── ② leitura: ordens sugeridas pendentes ────────────────────────────────────
app.get('/api/n1/sugeridas', auth, async (req, res) => {
    const st = ['PENDENTE', 'APROVADA', 'REJEITADA', 'CONVERTIDA'].includes(req.query.status) ? req.query.status : 'PENDENTE';
    const r = await supabase.from('ordem_sugerida').select('*').eq('status', st).order('prioridade', { ascending: false }).limit(500);
    if (n1ErroTabela(r.error)) return res.status(503).json({ erro: N1_F1_503 });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});

// ── ③ GATE (F1 parcial): check de fio via BOM × estoque + conversão em OP ────
// Aprova a sugerida → cria ordem_producao (origem n1pull, nasce planejada, LEDGER)
// e marca CONVERTIDA. Gate de capacidade (Drum) completo entra no F2.
app.post('/api/n1/sugeridas/:id/aprovar', auth, sigsEscrita, async (req, res) => {
    const { data: sug, error: eS } = await supabase.from('ordem_sugerida').select('*').eq('id', req.params.id).maybeSingle();
    if (n1ErroTabela(eS)) return res.status(503).json({ erro: N1_F1_503 });
    if (eS) return erro500(res, eS);
    if (!sug) return res.status(404).json({ erro: 'Sugerida não encontrada.' });
    if (sug.status !== 'PENDENTE') return res.status(409).json({ erro: `Sugerida já está ${sug.status}.` });
    const { data: prod } = await supabase.from('produto').select('id,codigo,unidade_medida').ilike('codigo', sug.codigo).maybeSingle();
    if (!prod) return res.status(422).json({ erro: `Produto ${sug.codigo} não cadastrado.` });
    // check de fio (parcial): BOM do produto × estoque do material — sem BOM, aviso e segue
    const avisos = [];
    const { data: bomRows, error: eB } = await supabase.from('bom').select('material_codigo,qtd_por_unidade,unidade').eq('produto_id', prod.id).eq('ativo', true);
    if (!eB && bomRows?.length) {
        const necess = bomRows.map(b => ({ mat: String(b.material_codigo).toUpperCase(), qtd: (Number(b.qtd_por_unidade) || 0) * Number(sug.qtd) }));
        const vivasMat = await n1PosicoesVivas();
        const dispMat = {}; necess.forEach(x => { dispMat[x.mat] = vivasMat[x.mat]?.disponivel || 0; });
        const falta = necess.filter(x => (dispMat[x.mat] || 0) < x.qtd);
        if (falta.length) return res.status(422).json({ erro: `Fio insuficiente: ${falta.map(f => `${f.mat} (precisa ${Math.ceil(f.qtd)}, tem ${Math.floor(dispMat[f.mat] || 0)})`).join(' · ')}`, check_fio: false });
    } else avisos.push('BOM vazia para o SKU — check de fio desligado (cadastre em Dados Mestres › BOM).');
    // CAS na sugerida antes de criar a OP (evita corrida de duplo-aprovar)
    const { data: trava, error: eT } = await supabase.from('ordem_sugerida').update({ status: 'APROVADA' }).eq('id', sug.id).eq('status', 'PENDENTE').select('id').maybeSingle();
    if (eT) return erro500(res, eT);
    if (!trava) return res.status(409).json({ erro: 'Sugerida já foi aprovada por outra pessoa.' });
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const numero = `N1-${sug.codigo}-${hoje.slice(2).replace(/-/g, '')}`;   // determinístico por SKU+dia
    const prazo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const { data: op, error: eO } = await supabase.from('ordem_producao').insert({
        numero, produto_id: prod.id, qtd_planejada: Number(sug.qtd), unidade: prod.unidade_medida || 'pc',
        status: 'planejada', origem: 'n1pull', data_abertura: new Date().toISOString(), data_prevista: prazo,
        prioridade: Math.min(9, Math.round(Number(sug.prioridade) / 100 * 9)) }).select('id,numero').single();
    if (eO) {
        await supabase.from('ordem_sugerida').update({ status: 'PENDENTE' }).eq('id', sug.id);   // desfaz a trava
        if (eO.code === '23505') return res.status(409).json({ erro: `Já existe OP ${numero} (criada hoje para este SKU).` });
        return erro500(res, eO);
    }
    await apsLog(op.id, null, 'planejada', { origem: 'n1pull', motivo: `Reposição do pulmão (${sug.zona_origem}, prio ${sug.prioridade})`, usuario: req.usuario });
    await supabase.from('ordem_sugerida').update({ status: 'CONVERTIDA', op_id: op.id }).eq('id', sug.id);
    res.json({ ok: true, op, avisos });
});

// ── ④ APS heurístico F1: prio DESC, cego à origem → fila_maquina versionada ──
app.post('/api/n1/sequenciar', auth, sigsEscrita, async (_req, res) => {
    if (!n1Lock('seq')) return res.status(409).json({ erro: 'Sequenciamento já está rodando.' });
    try {
        // fila = OPs liberadas + em produção (o chão vê o que fazer agora), prio DESC → prazo ASC
        let ops;
        try { ops = await fetchAllSelect('ordem_producao', 'id,numero,prioridade,data_prevista,qtd_planejada,status,origem, produto:produto_id(codigo,descricao)', q => q.in('status', ['liberada', 'em_producao'])); }
        catch (e) { return erro500(res, e); }
        if (!ops?.length) return res.json({ ok: true, itens: 0, avisos: ['Nenhuma OP liberada/em produção — libere pelo gate do APS.'] });
        ops.sort((a, b) => (Number(b.prioridade) || 0) - (Number(a.prioridade) || 0) ||
            String(a.data_prevista || '9999').localeCompare(String(b.data_prevista || '9999')));
        // cor do pulmão por SKU (Rope: o chão enxerga a urgência da reposição)
        let corDe = {};
        try {
            const [params, vivas] = await Promise.all([
                fetchAllSelect('parametro_reposicao', 'codigo,pulmao', q => q.eq('ativo', true).gt('pulmao', 0)),
                n1PosicoesVivas()]);
            const posDe = {}; Object.entries(vivas).forEach(([c, v]) => { posDe[c] = v.posicao; });
            (params || []).forEach(p => { const pos = posDe[p.codigo] ?? 0, z = Number(p.pulmao) / 3;
                corDe[p.codigo] = pos <= 0 ? 'PRETO' : pos <= z ? 'VERMELHO' : pos <= 2 * z ? 'AMARELO' : 'VERDE'; });
        } catch { /* sem tabelas F1 ainda — fila sai sem cor */ }
        const { data: vMax, error: eV } = await supabase.from('fila_maquina').select('versao').order('versao', { ascending: false }).limit(1).maybeSingle();
        if (n1ErroTabela(eV)) return res.status(503).json({ erro: N1_F1_503 });
        const versao = (vMax?.versao || 0) + 1;
        const rows = ops.map((o, i) => ({ versao, processo: 'geral', posicao: i + 1, op_id: o.id, numero: o.numero,
            codigo: o.produto?.codigo || null, qtd: Number(o.qtd_planejada) || 0, cor_pulmao: corDe[String(o.produto?.codigo || '').toUpperCase()] || null }));
        for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabase.from('fila_maquina').insert(rows.slice(i, i + 500));
            if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_F1_503 });
            if (error) return erro500(res, error);
        }
        res.json({ ok: true, versao, itens: rows.length });
    } finally { n1Unlock('seq'); }
});

// ── ④/⑤ leitura: última versão da fila (PWA consome, não calcula — §2.8) ────
app.get('/api/n1/fila', auth, async (_req, res) => {
    const { data: vMax, error: eV } = await supabase.from('fila_maquina').select('versao').order('versao', { ascending: false }).limit(1).maybeSingle();
    if (n1ErroTabela(eV)) return res.status(503).json({ erro: N1_F1_503 });
    if (eV) return erro500(res, eV);
    if (!vMax) return res.json({ versao: null, itens: [] });
    const { data, error } = await supabase.from('fila_maquina').select('*').eq('versao', vMax.versao).order('posicao');
    if (error) return erro500(res, error);
    res.json({ versao: vMax.versao, itens: data || [] });
});

// ── ⑥ FECHAMENTO noturno: DBM (contadores + ajuste) + KPIs do dia ────────────
app.post('/api/n1/fechamento', auth, sigsEscrita, async (_req, res) => {
    if (!n1Lock('fechamento')) return res.status(409).json({ erro: 'Fechamento já está rodando.' });
    try {
        const avisos = [];
        let params, vivas;
        try {
            [params, vivas] = await Promise.all([
                fetchAllSelect('parametro_reposicao', '*', q => q.eq('ativo', true).gt('pulmao', 0)),
                n1PosicoesVivas()]);
        } catch (e) { return n1ErroTabela(e) ? res.status(503).json({ erro: N1_F1_503 }) : erro500(res, e); }
        const posDe = {}; Object.entries(vivas).forEach(([c, v]) => { posDe[c] = v.posicao; });
        let ajustesUp = 0, ajustesDown = 0, rupturas = 0; const pens = [];
        for (const p of params || []) {
            const pos = posDe[p.codigo] ?? 0, pulmao = Number(p.pulmao), zona = pulmao / 3;
            if (pos <= 0) rupturas++;
            pens.push(Math.max(0, Math.min(1, 1 - pos / pulmao)) * 100);
            const noVermelho = pos <= zona, noVerde = pos > 2 * zona;
            const dv = noVermelho ? (p.dias_vermelho || 0) + 1 : 0;
            const dg = noVerde ? (p.dias_verde || 0) + 1 : 0;
            const upd = { dias_vermelho: dv, dias_verde: dg };
            // DBM (spec §3⑥b): ×1,33 se ≥5 dias vermelho · ×0,67 se ≥ 2×LT dias no verde · máx 1 ajuste/LT
            const podeAjustar = !p.ultimo_ajuste_em || (Date.now() - new Date(p.ultimo_ajuste_em).getTime()) / 86400000 >= (p.lt_dias || 30);
            if (podeAjustar && dv >= 5) { upd.pulmao = Math.ceil(pulmao * 1.33); upd.dias_vermelho = 0; upd.ultimo_ajuste_em = new Date().toISOString(); ajustesUp++; }
            else if (podeAjustar && dg >= 2 * (p.lt_dias || 30)) { upd.pulmao = Math.max(1, Math.floor(pulmao * 0.67)); upd.dias_verde = 0; upd.ultimo_ajuste_em = new Date().toISOString(); ajustesDown++; }
            const { error } = await supabase.from('parametro_reposicao').update(upd).eq('id', p.id);
            if (error) return erro500(res, error);
        }
        // ⑥a/⑥c — o realizado corrige o plano: tempo_real_roteiro, latência e aderência.
        // Tudo sobre os apontamentos DO DIA; sem apontamento, os KPIs ficam null (não inventa).
        const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        const iniDia = new Date(dia + 'T00:00:00-03:00').toISOString();
        const { data: aps } = await supabase.from('apontamento')
            .select('op_id,maquina_id,datahora_inicio,datahora_fim,qtd_boa,qtd_refugo,qtd_retrabalho,criado_em')
            .gte('datahora_inicio', iniDia).order('datahora_inicio');
        let latenciaMed = null, aderencia = null, temposGravados = 0, alertasTempo = 0;
        if (aps?.length) {
            // latência (min): ocorrido (fim; sessão aberta usa início) → criado no sistema. Mediana.
            const lats = aps.map(a => { const oc = a.datahora_fim || a.datahora_inicio;
                return (new Date(a.criado_em) - new Date(oc)) / 60000; }).filter(v => isFinite(v) && v >= 0).sort((a, b) => a - b);
            if (lats.length) latenciaMed = Math.round(lats[Math.floor(lats.length / 2)] * 10) / 10;

            // aderência (%): ordem real dos apontamentos × posição na última fila publicada.
            // Métrica: % dos pares adjacentes (1º toque por OP) na ordem crescente da fila.
            const { data: vMax } = await supabase.from('fila_maquina').select('versao').order('versao', { ascending: false }).limit(1).maybeSingle();
            if (vMax) {
                const { data: fila } = await supabase.from('fila_maquina').select('op_id,posicao').eq('versao', vMax.versao);
                const posDeOp = {}; (fila || []).forEach(f => { if (f.op_id) posDeOp[f.op_id] = f.posicao; });
                const seq = []; const vistos = new Set();
                aps.forEach(a => { if (!vistos.has(a.op_id) && posDeOp[a.op_id] != null) { vistos.add(a.op_id); seq.push(posDeOp[a.op_id]); } });
                if (seq.length >= 2) {
                    let okPares = 0;
                    for (let i = 1; i < seq.length; i++) if (seq[i] > seq[i - 1]) okPares++;
                    aderencia = Math.round(okPares / (seq.length - 1) * 1000) / 10;
                }
            }

            // tempo_real_roteiro: duração/qtd por (produto, etapa da máquina). Desvio >15% vs
            // tempo_padrao por ≥3 fechamentos distintos (aprox. semanas com apontamento) → alerta.
            const opIds = [...new Set(aps.map(a => a.op_id))];
            const maqIds = [...new Set(aps.map(a => a.maquina_id))];
            const [{ data: opsRows }, { data: maqs }, { data: tps }] = await Promise.all([
                supabase.from('ordem_producao').select('id,produto_id').in('id', opIds),
                supabase.from('maquina').select('id,etapa_id').in('id', maqIds),
                supabase.from('tempo_padrao').select('etapa_id,produto_id,seg_por_unidade'),
            ]);
            const prodDeOp = {}; (opsRows || []).forEach(o => { prodDeOp[o.id] = o.produto_id; });
            const etapaDeMaq = {}; (maqs || []).forEach(m => { etapaDeMaq[m.id] = m.etapa_id; });
            const medidas = {};   // produto|etapa → {seg: [..]}
            aps.forEach(a => {
                if (!a.datahora_fim) return;                                    // só sessão fechada mede
                const qtd = (Number(a.qtd_boa) || 0) + (Number(a.qtd_refugo) || 0) + (Number(a.qtd_retrabalho) || 0);
                const durSeg = (new Date(a.datahora_fim) - new Date(a.datahora_inicio)) / 1000;
                const pid = prodDeOp[a.op_id], eid = etapaDeMaq[a.maquina_id];
                if (!pid || !eid || qtd <= 0 || durSeg <= 0) return;
                (medidas[pid + '|' + eid] = medidas[pid + '|' + eid] || []).push(durSeg / qtd);
            });
            for (const [k, arr] of Object.entries(medidas)) {
                const [pid, eid] = k.split('|');
                const segMedio = arr.reduce((s, v) => s + v, 0) / arr.length;
                const pad = (tps || []).find(t => t.etapa_id === eid && t.produto_id === pid) || (tps || []).find(t => t.etapa_id === eid && t.produto_id === null);
                const desvio = pad && Number(pad.seg_por_unidade) > 0 ? Math.round((segMedio / Number(pad.seg_por_unidade) - 1) * 1000) / 10 : null;
                const { data: ex } = await supabase.from('tempo_real_roteiro').select('id,seg_por_unidade,amostras,semanas_desvio,atualizado_em').eq('produto_id', pid).eq('etapa_id', eid).maybeSingle();
                // média móvel ponderada pelas amostras; contador de desvio anda no máx 1×/dia
                const n0 = ex?.amostras || 0;
                const segNovo = n0 > 0 ? (Number(ex.seg_por_unidade) * n0 + segMedio * arr.length) / (n0 + arr.length) : segMedio;
                const desvioNovo = pad && Number(pad.seg_por_unidade) > 0 ? Math.round((segNovo / Number(pad.seg_por_unidade) - 1) * 1000) / 10 : null;
                const jaHoje = ex?.atualizado_em && String(ex.atualizado_em).slice(0, 10) === dia;
                const sem = desvioNovo != null && Math.abs(desvioNovo) > 15
                    ? (jaHoje ? (ex?.semanas_desvio || 0) : (ex?.semanas_desvio || 0) + 1)
                    : 0;
                const alerta = sem >= 3;                                        // desvio persistente → corrigir dado mestre (F0)
                if (alerta) alertasTempo++;
                const row = { produto_id: pid, etapa_id: eid, seg_por_unidade: Math.round(segNovo * 1000) / 1000,
                    amostras: n0 + arr.length, desvio_pct: desvioNovo, semanas_desvio: sem, alerta, atualizado_em: new Date().toISOString() };
                const { error: eT } = await supabase.from('tempo_real_roteiro').upsert(row, { onConflict: 'produto_id,etapa_id' });
                if (!eT) temposGravados++;
            }
        } else avisos.push('Sem apontamentos hoje — aderência/latência/tempo-real ficam null (não inventa número).');
        const kpi = { dia, rupturas, penetracao_media: pens.length ? Math.round(pens.reduce((s, v) => s + v, 0) / pens.length * 10) / 10 : null,
            aderencia_pct: aderencia, latencia_apont_min: latenciaMed,
            detalhe: { pulmoes: (params || []).length, ajustes_up: ajustesUp, ajustes_down: ajustesDown,
                apontamentos: (aps || []).length, tempos_medidos: temposGravados, alertas_tempo: alertasTempo } };
        const { error: eK } = await supabase.from('kpi_diario').upsert(kpi, { onConflict: 'dia' });
        if (n1ErroTabela(eK)) return res.status(503).json({ erro: N1_F1_503 });
        if (eK) return erro500(res, eK);
        res.json({ ok: true, dia, rupturas, ajustes_up: ajustesUp, ajustes_down: ajustesDown, pulmoes: (params || []).length,
            aderencia_pct: aderencia, latencia_apont_min: latenciaMed, tempos_medidos: temposGravados, alertas_tempo: alertasTempo, avisos });
    } finally { n1Unlock('fechamento'); }
});

// ── ⑥ leitura: KPIs ──────────────────────────────────────────────────────────
app.get('/api/n1/kpis', auth, async (_req, res) => {
    const r = await supabase.from('kpi_diario').select('*').order('dia', { ascending: false }).limit(30);
    if (n1ErroTabela(r.error)) return res.status(503).json({ erro: N1_F1_503 });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});

// ── ⑦ leitura: política (trilho) — F1 provisório: sem linha = PULL ───────────
app.get('/api/n1/politica', auth, async (_req, res) => {
    const r = await supabase.from('politica_item').select('*').eq('ativo', true).order('codigo').limit(1000);
    if (n1ErroTabela(r.error)) return res.status(503).json({ erro: N1_F1_503 });
    if (r.error) return erro500(res, r.error);
    res.json({ itens: r.data || [], regra_f1: 'Sem linha na politica_item = PULL (MTS default provisório). Roteamento ABC-XYZ homologado entra no F2.' });
});

// ══════════════════ N1 · ESTOQUE F1 — posição viva + kardex ══════════════════
const N1_EST_503 = 'Tabelas de estoque não existem — rode n1_estoque.sql no Supabase (SQL Editor).';

// posição viva de todos os códigos (âncora + Δ movimentos)
app.get('/api/n1/estoque', auth, async (req, res) => {
    const q = String(req.query.q || '').trim().toUpperCase();
    let vivas;
    try { vivas = await n1PosicoesVivas(); } catch (e) { return erro500(res, e); }
    let itens = Object.entries(vivas).map(([codigo, v]) => ({ codigo, ...v,
        disponivel_ancora: (Number(v.disponivel) || 0) - (v.delta_mov || 0) }));
    if (q) itens = itens.filter(i => i.codigo.includes(q));
    itens.sort((a, b) => Math.abs(b.delta_mov) - Math.abs(a.delta_mov) || b.posicao - a.posicao);
    const comMov = itens.filter(i => i.delta_mov !== 0);
    res.json({ itens: itens.slice(0, 500), resumo: {
        total: itens.length, com_movimento: comMov.length,
        delta_entradas: comMov.reduce((s, i) => s + Math.max(0, i.delta_mov), 0),
        delta_saidas: comMov.reduce((s, i) => s + Math.min(0, i.delta_mov), 0),
        ancora: itens.map(i => i.ancora_em).filter(Boolean).sort().pop() || null } });
});

// kardex — extrato de movimentos (mais recentes primeiro)
app.get('/api/n1/kardex', auth, async (req, res) => {
    const cod = String(req.query.codigo || '').trim().toUpperCase();
    let qy = supabase.from('estoque_movimento').select('*').order('criado_em', { ascending: false }).limit(Math.min(Number(req.query.limit) || 200, 500));
    if (cod) qy = qy.eq('codigo', cod);
    if (req.query.tipo) qy = qy.eq('tipo', String(req.query.tipo));
    const r = await qy;
    if (n1ErroTabela(r.error)) return res.status(503).json({ erro: N1_EST_503 });
    if (r.error) return erro500(res, r.error);
    const opIds = [...new Set((r.data || []).map(m => m.op_id).filter(Boolean))];
    const numDe = {};
    if (opIds.length) { const { data: ops } = await supabase.from('ordem_producao').select('id,numero').in('id', opIds);
        (ops || []).forEach(o => { numDe[o.id] = o.numero; }); }
    res.json((r.data || []).map(m => ({ ...m, op_numero: numDe[m.op_id] || null })));
});

// ajuste de inventário: informa a CONTAGEM física; o delta é calculado e registrado
app.post('/api/n1/estoque/ajuste', auth, sigsEscrita, async (req, res) => {
    const codigo = String(req.body?.codigo || '').trim().toUpperCase();
    const contado = Number(req.body?.contado);
    const motivo = String(req.body?.motivo || '').trim();
    if (!codigo || !Number.isFinite(contado) || contado < 0) return res.status(400).json({ erro: 'codigo e contado (≥0) obrigatórios' });
    if (!motivo) return res.status(400).json({ erro: 'Ajuste de inventário exige motivo.' });
    let vivas;
    try { vivas = await n1PosicoesVivas(); } catch (e) { return erro500(res, e); }
    const atual = vivas[codigo]?.disponivel || 0;
    const delta = Math.round((contado - atual) * 1000) / 1000;
    if (delta === 0) return res.json({ ok: true, delta: 0, msg: 'Contagem igual à posição — nada a ajustar.' });
    const { error } = await supabase.from('estoque_movimento').insert({ codigo, tipo: 'ajuste_inventario', delta,
        motivo: `${motivo} (contado ${contado} vs sistema ${atual})`, usuario_nome: req.usuario?.nome || null });
    if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_EST_503 });
    if (error) return erro500(res, error);
    res.json({ ok: true, delta, de: atual, para: contado });
});

// ── F3: EXPEDIÇÃO — baixa de estoque por saída (manual ou colada em massa) ────
// Gera movimentos saida_expedicao no kardex. Permite ficar negativo (a vida
// real embarca mesmo com sistema desatualizado) — mas avisa.
app.post('/api/n1/expedicao', auth, sigsEscrita, async (req, res) => {
    const linhas = (Array.isArray(req.body?.linhas) ? req.body.linhas : [])
        .map(l => ({ codigo: String(l.codigo || '').trim().toUpperCase(), qtd: Number(l.qtd) || 0, ref: String(l.ref || '').trim() }))
        .filter(l => l.codigo && l.qtd > 0);
    const confirmar = !!req.body?.confirmar;
    if (!linhas.length) return res.status(400).json({ erro: 'linhas [{codigo, qtd, ref?}] obrigatório (qtd > 0)' });
    let vivas;
    try { vivas = await n1PosicoesVivas(); } catch (e) { return erro500(res, e); }
    const preview = linhas.map(l => {
        const disp = vivas[l.codigo]?.disponivel ?? null;
        return { ...l, disponivel: disp, conhecido: disp != null,
            ficara: disp != null ? Math.round((disp - l.qtd) * 1000) / 1000 : null,
            negativo: disp != null && disp - l.qtd < 0 };
    });
    if (!confirmar) return res.json({ ok: true, preview: true, linhas: preview,
        desconhecidos: preview.filter(p => !p.conhecido).map(p => p.codigo),
        ficarao_negativos: preview.filter(p => p.negativo).map(p => p.codigo) });
    const movs = linhas.map(l => ({ codigo: l.codigo, tipo: 'saida_expedicao', delta: -l.qtd,
        motivo: l.ref ? `expedição · ${l.ref}` : 'expedição', usuario_nome: req.usuario?.nome || null }));
    for (let i = 0; i < movs.length; i += 500) {
        const { error } = await supabase.from('estoque_movimento').insert(movs.slice(i, i + 500));
        if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_EST_503 });
        if (error) return erro500(res, error);
    }
    res.json({ ok: true, expedidas: movs.length,
        avisos: preview.filter(p => p.negativo).map(p => `${p.codigo} ficou negativo (${p.ficara}) — confira o apontamento/inventário.`) });
});

// reconciliação: última rodada (divergências) + histórico de IRA por rodada
app.get('/api/n1/reconciliacao', auth, async (_req, res) => {
    let rows;
    try { rows = await fetchAllSelect('estoque_reconciliacao', '*'); }
    catch (e) { return n1ErroTabela(e) ? res.status(503).json({ erro: 'Rode n1_estoque2.sql no Supabase.' }) : erro500(res, e); }
    if (!rows?.length) return res.json({ ultima: null, divergencias: [], historico: [] });
    const runs = {};
    rows.forEach(r => { (runs[r.executado_em] = runs[r.executado_em] || []).push(r); });
    const ordenadas = Object.keys(runs).sort().reverse();
    const ultima = ordenadas[0];
    const divergencias = runs[ultima].sort((a, b) => Math.abs(b.divergencia) - Math.abs(a.divergencia)).slice(0, 200);
    const historico = ordenadas.slice(0, 20).map(t => ({ executado_em: t, divergentes: runs[t].length,
        soma_abs: Math.round(runs[t].reduce((s2, r) => s2 + Math.abs(Number(r.divergencia)), 0) * 10) / 10 }));
    res.json({ ultima, divergencias, historico });
});

// inventário cíclico guiado pelo ABC: A conta a cada 7 dias · B 30 · C 90
app.get('/api/n1/inventario', auth, async (_req, res) => {
    const FREQ = { A: 7, B: 30, C: 90 };
    let vivas, ajustes = [], abcRows = [];
    try { vivas = await n1PosicoesVivas(); } catch (e) { return erro500(res, e); }
    try { ajustes = await fetchAllSelect('estoque_movimento', 'codigo,criado_em', q => q.eq('tipo', 'ajuste_inventario')); } catch { }
    try { abcRows = await fetchAllSelect('roteamento_staging', 'codigo,abc,ciclo'); } catch { }
    const ciclos = [...new Set(abcRows.map(r => r.ciclo))].sort();
    const cicloAtual = ciclos[ciclos.length - 1];
    const abcDe = {}; abcRows.filter(r => r.ciclo === cicloAtual).forEach(r => { abcDe[r.codigo] = r.abc; });
    const ultDe = {}; (ajustes || []).forEach(a => { const t = new Date(a.criado_em).getTime();
        if (!ultDe[a.codigo] || t > ultDe[a.codigo]) ultDe[a.codigo] = t; });
    const agora = Date.now();
    const itens = Object.entries(vivas).map(([codigo, v]) => {
        const abc = abcDe[codigo] || 'C';
        const freq = FREQ[abc] || 90;
        const ult = ultDe[codigo] || null;
        const dias = ult ? Math.floor((agora - ult) / 86400000) : null;
        return { codigo, abc, freq_dias: freq, posicao: v.posicao, disponivel: v.disponivel,
            ultima_contagem: ult ? new Date(ult).toISOString() : null, dias_desde: dias,
            vencido: ult == null || dias >= freq };
    });
    const ordem = { A: 0, B: 1, C: 2 };
    itens.sort((a, b) => (b.vencido - a.vencido) || (ordem[a.abc] - ordem[b.abc]) || (b.dias_desde ?? 9999) - (a.dias_desde ?? 9999));
    const resumo = { vencidos: itens.filter(i => i.vencido).length,
        vencidos_a: itens.filter(i => i.vencido && i.abc === 'A').length,
        vencidos_b: itens.filter(i => i.vencido && i.abc === 'B').length,
        vencidos_c: itens.filter(i => i.vencido && i.abc === 'C').length,
        ciclo_abc: cicloAtual || null };
    res.json({ itens: itens.slice(0, 400), resumo });
});

// ══════════════════ N1 · F2 — PLANEJAMENTO ═══════════════════════════════════
// Roteamento ABC-XYZ (job mensal → staging → homologação = S&OP leve), EWMA+MAPE
// por família, netting/prioridade da carteira PUSH e gate de capacidade (Drum).
const N1_F2_503 = 'Tabelas do F2 não existem — rode n1_f2.sql no Supabase (SQL Editor).';
const n1CicloAtual = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);

// ── roteamento ✦ (job mensal): ABC×XYZ → trilho sugerido, com histerese ──────
// ABC por VOLUME 80/15/5 (valor está zerado na base — quando importar R$, trocar
// para valor). XYZ por CV: ≤0,5 X · ≤1,0 Y · >1,0 Z; ≥40% meses zero força Z.
// Item novo (<6m de história) = PUSH. Matriz: {A,B,C}×{X,Y}=PULL · coluna Z=PUSH ·
// CZ = revisar portfólio. Dessazonalização: NÃO aplicada (dívida documentada).
app.post('/api/n1/roteamento/rodar', auth, sigsEscrita, async (_req, res) => {
    if (!n1Lock('roteamento')) return res.status(409).json({ erro: 'Roteamento já está rodando.' });
    try {
        const ciclo = n1CicloAtual();
        let vm;
        try { vm = await fetchAllSelect('venda_movimento', 'codigo,competencia,qtd'); }
        catch (e) { return n1ErroTabela(e) ? res.status(503).json({ erro: N1_F1_503 }) : erro500(res, e); }
        if (!vm?.length) return res.json({ ok: true, avaliados: 0, avisos: ['venda_movimento vazia — rode o ETL.'] });
        const comps = [...new Set(vm.map(r => String(r.competencia).slice(0, 7)))].sort();
        const corte12 = comps.slice(-12);                                  // últimos 12 meses p/ ABC
        const serieDe = {};
        vm.forEach(r => { const c = String(r.codigo); (serieDe[c] = serieDe[c] || {})[String(r.competencia).slice(0, 7)] = Number(r.qtd) || 0; });
        // CV vem do parametro_reposicao (motor F1 já calculou na série completa)
        const { data: params } = await supabase.from('parametro_reposicao').select('codigo,cv');
        const cvDe = {}; (params || []).forEach(p => { cvDe[p.codigo] = p.cv != null ? Number(p.cv) : null; });
        // ABC por VALOR quando a importação de Vendas trouxer R$ (colunas Valor/Valor R$/
        // Valor Total no SIGS); sem valor na base, cai para VOLUME. Upgrade automático.
        let valorDe = {}; let temValor = false;
        try {
            const vRows = await fetchAllSelect('vendas', 'codigo,valor', q => q.gt('valor', 0));
            (vRows || []).forEach(v => { const c = String(v.codigo || '').trim().toUpperCase(); if (c) { valorDe[c] = (valorDe[c] || 0) + (Number(v.valor) || 0); temValor = true; } });
        } catch { /* sem coluna/tabela — segue por volume */ }
        const { data: pols } = await supabase.from('politica_item').select('codigo,trilho').eq('ativo', true);
        const trilhoAtualDe = {}; (pols || []).forEach(p => { trilhoAtualDe[p.codigo] = p.trilho; });
        // staging do ciclo anterior (histerese: mudança precisa persistir 2 ciclos)
        const cicloAnt = comps.length ? (() => { const d = new Date(ciclo + '-01T12:00:00'); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })() : null;
        const { data: stAnt, error: eSt } = await supabase.from('roteamento_staging').select('codigo,trilho_sugerido,ciclos_consecutivos').eq('ciclo', cicloAnt || '');
        if (n1ErroTabela(eSt)) return res.status(503).json({ erro: N1_F2_503 });
        const antDe = {}; (stAnt || []).forEach(s => { antDe[s.codigo] = s; });

        // base do ABC 80/15/5: VALOR (R$ importado) se existir; senão VOLUME 12m
        const skus = Object.keys(serieDe);
        const vol = skus.map(c => ({ c,
            v: temValor ? (valorDe[c] || 0) : corte12.reduce((s, m) => s + (serieDe[c][m] || 0), 0),
            vol12: corte12.reduce((s, m) => s + (serieDe[c][m] || 0), 0),
        })).sort((a, b) => b.v - a.v);
        const totalVol = vol.reduce((s, x) => s + x.v, 0) || 1;
        let acum = 0; const abcDe = {};
        vol.forEach(x => { acum += x.v; abcDe[x.c] = acum / totalVol <= 0.80 ? 'A' : acum / totalVol <= 0.95 ? 'B' : 'C'; });

        const rows = []; let mudancas = 0, portfolio = 0;
        for (const c of skus) {
            const meses = serieDe[c];
            const mesesComVenda = Object.keys(meses).filter(m => meses[m] > 0).sort();
            const serieCheia = comps.map(m => meses[m] || 0);
            const zeros = serieCheia.filter(v => v === 0).length;
            const pctZero = comps.length ? zeros / comps.length * 100 : 100;
            const primeiro = mesesComVenda[0];
            const idadeMeses = primeiro ? comps.length - comps.indexOf(primeiro) : 0;
            const itemNovo = idadeMeses > 0 && idadeMeses < 6;
            const cv = cvDe[c];
            let xyz = cv == null ? 'Z' : cv <= 0.5 ? 'X' : cv <= 1.0 ? 'Y' : 'Z';
            if (pctZero >= 40) xyz = 'Z';                                   // intermitência força Z
            const abc = abcDe[c] || 'C';
            const sugerido = itemNovo ? 'PUSH' : (xyz === 'Z' ? 'PUSH' : 'PULL');   // matriz: {A..C}×{X,Y}=PULL · Z=PUSH
            const atual = trilhoAtualDe[c] || 'PULL';                       // default F1
            const mudanca = sugerido !== atual;
            // histerese: se o ciclo anterior sugeriu o MESMO trilho, soma; senão zera em 1
            const ant = antDe[c];
            const consec = (ant && ant.trilho_sugerido === sugerido) ? (ant.ciclos_consecutivos || 1) + 1 : 1;
            if (mudanca) mudancas++;
            const revisar = abc === 'C' && xyz === 'Z';
            if (revisar) portfolio++;
            rows.push({ ciclo, codigo: c, abc, xyz, cv, volume_12m: Math.round((vol.find(x => x.c === c)?.vol12 || 0) * 1000) / 1000,
                pct_meses_zero: Math.round(pctZero * 10) / 10, item_novo: itemNovo, trilho_atual: atual,
                trilho_sugerido: sugerido, mudanca, ciclos_consecutivos: consec, revisar_portfolio: revisar, status: 'PENDENTE' });
        }
        for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabase.from('roteamento_staging').upsert(rows.slice(i, i + 500), { onConflict: 'ciclo,codigo' });
            if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_F2_503 });
            if (error) return erro500(res, error);
        }
        res.json({ ok: true, ciclo, avaliados: rows.length, mudancas_propostas: mudancas, revisar_portfolio: portfolio,
            aplicaveis_agora: rows.filter(r => r.mudanca && r.ciclos_consecutivos >= 2).length,
            criterio_abc: temValor ? 'valor (R$)' : 'volume',
            avisos: [temValor ? 'ABC por VALOR (R$ das Vendas importadas).' : 'ABC por VOLUME — importe Vendas com coluna "Valor" no SIGS para ABC por R$ (upgrade automático).', 'Sem dessazonalização — dívida documentada.'] });
    } finally { n1Unlock('roteamento'); }
});

// staging do ciclo (tela S&OP leve)
app.get('/api/n1/roteamento', auth, async (req, res) => {
    const ciclo = /^\d{4}-\d{2}$/.test(req.query.ciclo || '') ? req.query.ciclo : n1CicloAtual();
    const r = await supabase.from('roteamento_staging').select('*').eq('ciclo', ciclo).order('mudanca', { ascending: false }).order('volume_12m', { ascending: false }).limit(1000);
    if (n1ErroTabela(r.error)) return res.status(503).json({ erro: N1_F2_503 });
    if (r.error) return erro500(res, r.error);
    res.json({ ciclo, itens: r.data || [] });
});

// homologar (S&OP leve): aplica mudanças com histerese ≥2 ciclos → politica_item + hist
app.post('/api/n1/roteamento/homologar', auth, sigsEscrita, async (req, res) => {
    const ciclo = /^\d{4}-\d{2}$/.test(req.body?.ciclo || '') ? req.body.ciclo : n1CicloAtual();
    const forcarHisterese = !!req.body?.ignorar_histerese;                  // dono pode forçar
    const { data: st, error: eS } = await supabase.from('roteamento_staging').select('*').eq('ciclo', ciclo).eq('status', 'PENDENTE');
    if (n1ErroTabela(eS)) return res.status(503).json({ erro: N1_F2_503 });
    if (eS) return erro500(res, eS);
    if (!st?.length) return res.status(404).json({ erro: `Nenhum staging PENDENTE no ciclo ${ciclo} — rode o roteamento.` });
    let aplicadas = 0, seguradas = 0, semMudanca = 0;
    for (const s of st) {
        if (!s.mudanca) { semMudanca++; continue; }
        if (!forcarHisterese && s.ciclos_consecutivos < 2) { seguradas++; continue; }   // histerese 2 ciclos
        const { error: eP } = await supabase.from('politica_item').upsert({
            codigo: s.codigo, trilho: s.trilho_sugerido, origem: 'homologado', ciclo,
            motivo: `ABC-XYZ ${s.abc}${s.xyz}${s.item_novo ? ' (item novo)' : ''}${s.revisar_portfolio ? ' · REVISAR PORTFÓLIO' : ''}`, ativo: true }, { onConflict: 'codigo' });
        if (eP) return erro500(res, eP);
        await supabase.from('politica_item_hist').insert({ codigo: s.codigo, trilho_de: s.trilho_atual, trilho_para: s.trilho_sugerido,
            ciclo, motivo: `ABC-XYZ ${s.abc}${s.xyz}`, usuario: req.usuario?.nome || null });
        aplicadas++;
    }
    await supabase.from('roteamento_staging').update({ status: 'HOMOLOGADO' }).eq('ciclo', ciclo).eq('status', 'PENDENTE');
    res.json({ ok: true, ciclo, aplicadas, seguradas_histerese: seguradas, sem_mudanca: semMudanca });
});

// ── previsão EWMA α=0,1 + MAPE por família (segmento) ───────────────────────
// Uso: S&OP e MAPE-push (KPI). NUNCA lida para item PULL (anti-padrão §8).
app.post('/api/n1/previsao/rodar', auth, sigsEscrita, async (_req, res) => {
    if (!n1Lock('previsao')) return res.status(409).json({ erro: 'Previsão já está rodando.' });
    try {
        let vRows;
        try { vRows = await fetchAllSelect('vendas', 'codigo,segmento,meses'); }
        catch (e) { return erro500(res, e); }
        const N1_M = N1_MESES;
        const serieFam = {};                                            // familia → {aaaa-mm: qtd}
        for (const v of vRows || []) {
            const fam = String(v.segmento || 'SEM SEGMENTO').trim() || 'SEM SEGMENTO';
            if (!v.meses) continue;
            for (const [k, q] of Object.entries(v.meses)) {
                const m = k.match(/^([a-z]{3})_(\d{4})$/); if (!m || !(m[1] in N1_M)) continue;
                const comp = `${m[2]}-${String(N1_M[m[1]]).padStart(2, '0')}`;
                (serieFam[fam] = serieFam[fam] || {})[comp] = (serieFam[fam][comp] || 0) + (Number(q) || 0);
            }
        }
        const todasComps = [...new Set(Object.values(serieFam).flatMap(s => Object.keys(s)))].sort();
        if (!todasComps.length) return res.json({ ok: true, familias: 0, avisos: ['Sem série mensal nas vendas.'] });
        const prox = (() => { const d = new Date(todasComps[todasComps.length - 1] + '-01T12:00:00'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); })();
        const ALPHA = 0.1; const rows = [];
        for (const [fam, meses] of Object.entries(serieFam)) {
            const serie = todasComps.map(c => meses[c] || 0);           // zeros incluídos
            let ewma = serie[0]; let mapeSum = 0, mapeN = 0;
            for (let i = 1; i < serie.length; i++) {
                if (serie[i] > 0) { mapeSum += Math.abs(serie[i] - ewma) / serie[i]; mapeN++; }   // erro 1-passo-à-frente
                ewma = ALPHA * serie[i] + (1 - ALPHA) * ewma;
            }
            rows.push({ familia: fam, competencia: prox, previsao: Math.round(ewma * 1000) / 1000,
                mape_pct: mapeN ? Math.round(mapeSum / mapeN * 1000) / 10 : null, meses_serie: serie.length });
        }
        for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabase.from('previsao_familia').upsert(rows.slice(i, i + 500), { onConflict: 'familia,competencia' });
            if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_F2_503 });
            if (error) return erro500(res, error);
        }
        res.json({ ok: true, familias: rows.length, competencia: prox, alpha: ALPHA });
    } finally { n1Unlock('previsao'); }
});
app.get('/api/n1/previsao', auth, async (_req, res) => {
    const r = await supabase.from('previsao_familia').select('*').order('competencia', { ascending: false }).order('previsao', { ascending: false }).limit(200);
    if (n1ErroTabela(r.error)) return res.status(503).json({ erro: N1_F2_503 });
    if (r.error) return erro500(res, r.error);
    res.json(r.data || []);
});

// ── netting/carteira PUSH: OPs abertas de SKUs PUSH, prioridade pela folga ───
// A carteira firme desta fábrica são as OPs do ERP (importar-ops). Para trilho
// PUSH: folga = prazo − hoje − LT; folga ≤ 0 dentro do LT → prio alta (70–95),
// folga > LT → prio baixa (10–35), mapeada p/ 0–9 da OP. Não cria ordem (a OP
// já existe); quando houver tabela de pedidos firmes, o netting passa a gerar.
app.get('/api/n1/netting', auth, async (_req, res) => {
    const { data: pols, error: eP } = await supabase.from('politica_item').select('codigo,trilho').eq('ativo', true).eq('trilho', 'PUSH');
    if (n1ErroTabela(eP)) return res.status(503).json({ erro: N1_F1_503 });
    if (eP) return erro500(res, eP);
    const pushSet = new Set((pols || []).map(p => p.codigo));
    if (!pushSet.size) return res.json({ itens: [], avisos: ['Nenhum SKU com trilho PUSH homologado — rode o roteamento e homologue (S&OP leve).'] });
    let ops;
    try { ops = await fetchAllSelect('ordem_producao', 'id,numero,qtd_planejada,data_prevista,prioridade,status, produto:produto_id(codigo,descricao)', q => q.in('status', ['planejada', 'liberada', 'em_producao', 'pausada'])); }
    catch (e) { return erro500(res, e); }
    const { data: params } = await supabase.from('parametro_reposicao').select('codigo,lt_dias');
    const ltDe = {}; (params || []).forEach(p => { ltDe[p.codigo] = Number(p.lt_dias) || 30; });
    const hoje = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()) + 'T00:00:00-03:00');
    const itens = (ops || []).filter(o => pushSet.has(String(o.produto?.codigo || '').toUpperCase())).map(o => {
        const cod = String(o.produto?.codigo || '').toUpperCase();
        const lt = ltDe[cod] || 30;
        const dias = o.data_prevista ? Math.round((new Date(String(o.data_prevista).slice(0, 10) + 'T00:00:00-03:00') - hoje) / 86400000) : null;
        const folga = dias == null ? null : dias - lt;
        // spec §5: folga ≤ LT → 70–95 (quanto menor a folga, maior) · folga > LT → 10–35
        let prio = 10;
        if (folga != null) prio = folga <= 0 ? 95 : folga <= lt ? 70 + 25 * (1 - folga / lt) : Math.max(10, 35 - (folga - lt) / 10);
        return { op_id: o.id, numero: o.numero, codigo: cod, descricao: o.produto?.descricao, qtd: o.qtd_planejada,
            prazo: o.data_prevista, status: o.status, lt_dias: lt, dias_ate_prazo: dias, folga_dias: folga,
            prio_sugerida: Math.round(prio * 10) / 10, prio_op: Math.min(9, Math.round(prio / 100 * 9)), prio_atual: o.prioridade };
    }).sort((a, b) => b.prio_sugerida - a.prio_sugerida);
    res.json({ itens, avisos: [] });
});
// aplica a prioridade PUSH sugerida nas OPs (N1 é a evolução do APS — mesmo dono N3)
app.post('/api/n1/netting/aplicar', auth, sigsEscrita, async (req, res) => {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens.filter(i => apsUuid(i.op_id)) : [];
    if (!itens.length) return res.status(400).json({ erro: 'itens [{op_id, prio_op}] obrigatório' });
    let aplicadas = 0;
    for (const i of itens) {
        const p = Math.max(0, Math.min(9, Number(i.prio_op) || 0));
        const { error } = await supabase.from('ordem_producao').update({ prioridade: p }).eq('id', i.op_id);
        if (!error) aplicadas++;
    }
    res.json({ ok: true, aplicadas });
});

// ── gate de capacidade (Drum ≤ 90%): carga das ordens vs capacidade ──────────
// Carga = Σ qtd × tempo_padrao do roteiro, por processo (etapa→processo do TOC).
// Sem tempo-padrão (F0 pendente) → gate DESLIGADO com aviso (não inventa número).
app.post('/api/n1/gate/capacidade', auth, sigsEscrita, async (req, res) => {
    if (!n1Lock('gate')) return res.status(409).json({ erro: 'Gate já está rodando.' });
    try {
        const diasJanela = Math.min(Math.max(Number(req.body?.dias) || 22, 1), 66);
        const [etR, tpR, peR, capR] = await Promise.all([
            supabase.from('etapa_processo').select('id,nome').eq('ativo', true),
            supabase.from('tempo_padrao').select('etapa_id,produto_id,seg_por_unidade'),
            supabase.from('produto_etapa').select('produto_id,etapa_id'),
            supabase.from('capacidade_config').select('processo,maquinas,horas_dia,oee'),
        ]);
        if (etR.error) return erro500(res, etR.error);
        const procDeEtapa = {}; (etR.data || []).forEach(e => { const p = TOC_ETAPA_PROC[_norm(e.nome)]; if (p) procDeEtapa[e.id] = p; });
        const temTempo = (tpR.data || []).some(t => Number(t.seg_por_unidade) > 0);
        if (!temTempo) {
            const { error: eIns } = await supabase.from('carga_gargalo').insert({ processo: '—', carga_min: 0, cap_min: 0, utilizacao: null, drum_ok: null, detalhe: { aviso: 'sem tempo-padrão' } });
            if (n1ErroTabela(eIns)) return res.status(503).json({ erro: N1_F2_503 });
            return res.json({ ok: true, drum_ok: null, avisos: ['GATE DESLIGADO: tempo_padrao vazia (F0 pendente) — sem tempo não há carga; aprova por padrão até a fábrica cronometrar.'] });
        }
        // carga: OPs ativas + sugeridas pendentes/aprovadas
        let ops, sugs, prods;
        try {
            [ops, sugs, prods] = await Promise.all([
                fetchAllSelect('ordem_producao', 'produto_id,qtd_planejada', q => q.in('status', ['planejada', 'liberada', 'em_producao', 'pausada'])),
                fetchAllSelect('ordem_sugerida', 'codigo,qtd', q => q.in('status', ['PENDENTE', 'APROVADA'])),
                fetchAllSelect('produto', 'id,codigo'),
            ]);
        } catch (e) { return erro500(res, e); }
        const idDeCod = {}; (prods || []).forEach(p => { if (p.codigo) idDeCod[String(p.codigo).toUpperCase()] = p.id; });
        const rotDe = {}; (peR.data || []).forEach(x => { (rotDe[x.produto_id] = rotDe[x.produto_id] || []).push(x.etapa_id); });
        const tempoDe = (pid, eid) => {
            const esp = (tpR.data || []).find(t => t.etapa_id === eid && t.produto_id === pid);
            const ger = (tpR.data || []).find(t => t.etapa_id === eid && t.produto_id === null);
            return Number(esp?.seg_por_unidade) || Number(ger?.seg_por_unidade) || 0;
        };
        const cargaProc = {};
        const soma = (pid, qtd) => {
            const rot = rotDe[pid] || (etR.data || []).map(e => e.id);   // sem roteiro = todas
            rot.forEach(eid => { const proc = procDeEtapa[eid]; if (!proc) return;
                cargaProc[proc] = (cargaProc[proc] || 0) + tempoDe(pid, eid) * qtd / 60; });
        };
        (ops || []).forEach(o => soma(o.produto_id, Number(o.qtd_planejada) || 0));
        (sugs || []).forEach(s => { const pid = idDeCod[String(s.codigo).toUpperCase()]; if (pid) soma(pid, Number(s.qtd) || 0); });
        const capDe = {}; (capR.data || []).forEach(c => { capDe[c.processo] = (Number(c.maquinas) || 0) * (Number(c.horas_dia) || 0) * 60 * diasJanela * (Math.min(Number(c.oee) || 100, 100) / 100); });
        const agora = new Date().toISOString(); const linhas = []; let pior = null;
        for (const proc of Object.keys({ ...capDe, ...cargaProc })) {
            const carga = cargaProc[proc] || 0, cap90 = (capDe[proc] || 0) * 0.90;
            const util = cap90 > 0 ? Math.round(carga / cap90 * 1000) / 10 : null;
            const ok = util == null ? null : util <= 100;
            linhas.push({ avaliacao_em: agora, processo: proc, carga_min: Math.round(carga * 10) / 10, cap_min: Math.round(cap90 * 10) / 10, utilizacao: util, drum_ok: ok, detalhe: { dias: diasJanela } });
            if (util != null && (!pior || util > pior.utilizacao)) pior = { processo: proc, utilizacao: util };
        }
        const { error: eIns } = await supabase.from('carga_gargalo').insert(linhas);
        if (n1ErroTabela(eIns)) return res.status(503).json({ erro: N1_F2_503 });
        if (eIns) return erro500(res, eIns);
        res.json({ ok: true, drum_ok: !pior || pior.utilizacao <= 100, gargalo: pior, processos: linhas.length, dias: diasJanela,
            avisos: pior && pior.utilizacao > 100 ? [`Drum ESTOURADO em ${pior.processo} (${pior.utilizacao}% do teto de 90%) — rejanele ou escale ao S&OP.`] : [] });
    } finally { n1Unlock('gate'); }
});
app.get('/api/n1/gate', auth, async (_req, res) => {
    const { data: ult, error } = await supabase.from('carga_gargalo').select('avaliacao_em').order('avaliacao_em', { ascending: false }).limit(1).maybeSingle();
    if (n1ErroTabela(error)) return res.status(503).json({ erro: N1_F2_503 });
    if (error) return erro500(res, error);
    if (!ult) return res.json({ avaliacao: null, linhas: [] });
    const { data } = await supabase.from('carga_gargalo').select('*').eq('avaliacao_em', ult.avaliacao_em).order('utilizacao', { ascending: false, nullsFirst: false });
    res.json({ avaliacao: ult.avaliacao_em, linhas: data || [] });
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
    // Governança (APS): OP em estado que não aceita apontamento — o hold/fim é real, não decorativo
    const APONTAVEL = ['planejada', 'liberada', 'em_producao', 'pausada'];
    const { data: opG } = await supabase.from('ordem_producao').select('status').eq('id', b.op_id).maybeSingle();
    if (opG && !APONTAVEL.includes(opG.status)) {
        const rot = { bloqueada: 'BLOQUEADA (hold de qualidade/material)', cancelada: 'CANCELADA', concluida: 'CONCLUÍDA' }[opG.status] || opG.status.toUpperCase();
        return res.status(409).json({ erro: `OP ${rot} — não pode ser apontada. Veja no APS.` });
    }
    const row = { op_id: b.op_id, maquina_id: b.maquina_id, operador_id: b.operador_id, turno_id: b.turno_id,
        datahora_inicio: b.datahora_inicio || new Date().toISOString(), unidade: b.unidade || 'kg',
        dispositivo_id: b.dispositivo_id || null, origem: b.origem || 'pwa',
        sincronizado_em: b.sincronizado_em || new Date().toISOString() };
    if (b.etapa_id) row.etapa_id = b.etapa_id;
    if (b.id) row.id = b.id;  // id gerado no cliente (fila offline) → upsert idempotente
    const { data, error } = await supabase.from('apontamento').upsert(row).select().single();
    if (error) return erro500(res, error);
    // marca a OP como em produção (transição automática) — CAS por status, loga só se REALMENTE mudou
    if (opG && (opG.status === 'planejada' || opG.status === 'liberada' || opG.status === 'pausada')) {
        const { data: mv } = await supabase.from('ordem_producao').update({ status: 'em_producao' }).eq('id', b.op_id).in('status', ['planejada','liberada','pausada']).select('id');
        if (mv?.length) apsLog(b.op_id, opG.status, 'em_producao', { motivo: 'Sessão de apontamento iniciada', origem: 'apontamento', usuario: req.usuario }).catch(() => {});
    }
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
    // Estado atual ANTES do update: (a) protege a contagem automática da máquina — formulário
    // zerado não apaga qtd_boa que o gateway/CLP acumulou; (b) torna fechar+avançar idempotente —
    // o retry da fila offline não avança a OP duas etapas.
    const { data: atual, error: eAtu } = await supabase.from('apontamento').select('qtd_boa,datahora_fim,op_id').eq('id', req.params.id).maybeSingle();
    if (eAtu) return erro500(res, eAtu);
    if (!atual) return res.status(404).json({ erro: 'Apontamento não encontrado.' });
    const jaFechada = !!atual.datahora_fim;
    if (req.body.fechar && !updates.datahora_fim && !jaFechada) updates.datahora_fim = new Date().toISOString();
    if (req.body.fechar && jaFechada) delete updates.datahora_fim;   // retry do fechamento não move a hora original (correção manual sem `fechar` continua permitida)
    if (updates.qtd_boa !== undefined && Number(updates.qtd_boa) === 0 && Number(atual.qtd_boa) > 0) delete updates.qtd_boa;
    let data = null;
    if (Object.keys(updates).length) {
        const r = await supabase.from('apontamento').update(updates).eq('id', req.params.id).select().single();
        if (r.error) return erro500(res, r.error);
        data = r.data;
    } else {
        const r = await supabase.from('apontamento').select('*').eq('id', req.params.id).single();
        data = r.data;
    }
    // ESTOQUE F1: 1º fechamento da sessão → movimentos (entrada PA / consumo MP). Best-effort.
    if (req.body.fechar && !jaFechada && data?.datahora_fim) await n1EstoqueDoApontamento(data, req.usuario);
    let avanco = null;
    // avança no fluxo só na PRIMEIRA vez que a sessão fecha (retry não pula etapa)
    if (req.body.avancar && data?.op_id && !jaFechada) {
        try { const r = await avancarOpFluxo(data.op_id); if (!r.erro) avanco = r; }
        catch { /* fluxo ausente — sessão já fechada, segue */ }
    }
    res.json({ ok: true, apontamento: data, avanco });
});

// indicador de adoção do apontamento (hoje): sessões, máquinas e operadores ativos
app.get('/api/mf/adocao', auth, async (_q, res) => {
    // "hoje" no fuso da fábrica (America/Sao_Paulo) — meia-noite do servidor (UTC) começaria 21h
    // da véspera no Brasil, misturando o turno da noite anterior na contagem do dia
    const dataSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const hoje = new Date(dataSP + 'T00:00:00-03:00');
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
            // escopo correto: gatilho por CATEGORIA conta todos os defeitos da categoria (antes só contava o defeito atual)
            let qc = supabase.from('nao_conformidade').select('id', { count: 'exact', head: true }).gte('datahora', desde);
            if (g.defeito_id) qc = qc.eq('defeito_id', g.defeito_id);
            else if (g.categoria) {
                const { data: defsCat } = await supabase.from('catalogo_defeito').select('id').eq('categoria', g.categoria);
                const ids = (defsCat || []).map(d => d.id);
                if (!ids.length) continue;
                qc = qc.in('defeito_id', ids);
            } else qc = qc.eq('defeito_id', nc.defeito_id);
            const { count } = await qc;
            // +1 = a NC atual (o gatilho roda ANTES do insert; sem isso disparava uma ocorrência atrasado)
            if ((count || 0) + 1 >= Number(g.limiar)) return true;
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
    const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(b.url || '');
    let caminhoUpload = null;
    if (m) {
        const mime = m[1];
        if (!/^image\/(jpe?g|png|webp)$/i.test(mime)) return res.status(400).json({ erro: 'Formato de imagem não suportado — use JPG, PNG ou WebP.' });
        const buffer = Buffer.from(m[2], 'base64');
        if (buffer.length > 5 * 1024 * 1024) return res.status(413).json({ erro: 'Foto acima de 5 MB — tire novamente (a compressão do app deve reduzir).' });
        const ext = mime.split('/')[1].replace('jpeg', 'jpg');
        const nomeBase = /^[a-z0-9-]{1,40}$/i.test(String(b.id)) ? b.id : Date.now();  // M12: sanitiza o nome
        const caminho = `nc/${b.nc_id}/${nomeBase}.${ext}`;
        const { error: upErr } = await supabase.storage.from(MF_BUCKET).upload(caminho, buffer, { contentType: mime, upsert: true });
        if (upErr) return erro500(res, upErr, 'foto upload');
        urlFinal = caminho;  // caminho, não URL pública
        tamanho = buffer.length;
        caminhoUpload = caminho;
    }
    const row = { nc_id: b.nc_id, url: urlFinal, nome_arquivo: b.nome_arquivo || null,
        tamanho_bytes: tamanho, largura_px: b.largura_px || null, altura_px: b.altura_px || null,
        capturada_em: b.capturada_em || new Date().toISOString(), metadados: b.metadados || null };
    if (b.id) row.id = b.id;
    const { data, error } = await supabase.from('foto').upsert(row).select().single();
    if (error) {
        // não deixa objeto órfão no Storage se a linha não gravou (ex.: nc_id inexistente)
        if (caminhoUpload) await supabase.storage.from(MF_BUCKET).remove([caminhoUpload]).catch(() => {});
        return erro500(res, error);
    }
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
    if (b.foto_url) { try { foto_url = (await mfSubirImagem(b.foto_url, `etiqueta/${id}/${id}.jpg`)).url; } catch (e) { return erro500(res, e); } }
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
    if (e1) return erro500(res, e1);
    await casDelta('peca', b.peca_id, 'estoque_atual', -Number(b.quantidade), { min0: true });   // CAS
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
    await casDelta('lote_fio', b.lote_fio_id, 'qtd_disponivel_kg', -Number(b.qtd_consumida_kg), { min0: true });   // CAS: dois consumos simultâneos não se sobrescrevem
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
    await casDelta('lote_producao', b.lote_producao_id, 'qtd_disponivel_kg', -Number(b.qtd_consumida_kg), { min0: true });   // CAS
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
        fetchAllSelect('apontamento', 'qtd_boa,qtd_refugo,qtd_retrabalho').then(rows => ({ data: rows })),  // paginado — o cap de 1000 linhas silencioso corrompia o FPY
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
    const { data: op } = await supabase.from('ordem_producao').select('status, etapa_atual_id, etapa:etapa_atual_id(ordem)').eq('id', op_id).single();
    if (!op?.etapa_atual_id) return { erro: 'OP não está no fluxo.' };
    // Governança: OP em hold/cancelada não avança nem conclui pelo fluxo (o bloqueio é real)
    if (op.status === 'bloqueada' || op.status === 'cancelada') return { erro: `OP ${op.status} — não avança no fluxo.` };
    const rot = await roteiroDaOp(op_id);  // respeita o roteiro do produto (pula etapas que ele não usa)
    const prox = rot.find(e => e.ordem > (op.etapa?.ordem ?? 0));
    if (prox) {
        await supabase.from('ordem_producao').update({ etapa_atual_id: prox.id, etapa_desde: new Date().toISOString() }).eq('id', op_id);
        return { proxima: prox.nome };
    }
    // conclui só se ainda estava produzindo (CAS por status) — não sobrescreve um bloqueio concorrente
    const { data: fim } = await supabase.from('ordem_producao').update({ etapa_atual_id: null, etapa_desde: null, status: 'concluida' })
        .eq('id', op_id).in('status', ['em_producao', 'liberada', 'planejada', 'pausada']).select('id');
    if (fim?.length) apsLog(op_id, op.status, 'concluida', { motivo: 'Última etapa do roteiro concluída', origem: 'fluxo' }).catch(() => {});   // 'de' real, ledger best-effort
    else return { erro: 'OP mudou de estado — não concluída.' };
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
    if (r.erro) return res.status(/não avança|mudou/.test(r.erro) ? 409 : 404).json(r);
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

// soma N dias ÚTEIS (pula sáb/dom) a uma data
function somaDiasUteis(base, n) {
    const d = new Date(base);
    let add = 0;
    while (add < Math.max(0, Math.ceil(n))) { d.setDate(d.getDate() + 1); const dow = d.getDay(); if (dow !== 0 && dow !== 6) add++; }
    return d;
}

// ── CTP (Capable-to-Promise): data de entrega factível de um pedido novo ──────────
// Rough-cut: soma a carga da OP nova ao backlog de cada etapa do roteiro e devolve a 1ª data
// factível (hoje + dias úteis até a etapa-gargalo esvaziar). Depende de tempo_padrao cadastrado.
app.get('/api/mf/promessa', auth, async (req, res) => {
    const codigo = String(req.query.codigo || '').trim();
    const qtd = Number(req.query.qtd) || 0;
    const horasDia = Math.min(24, Math.max(1, Number(req.query.horas) || 8));
    const dataDesejada = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.data || '')) ? req.query.data : null;
    if (!codigo || !(qtd > 0)) return res.status(400).json({ erro: 'codigo e qtd>0 obrigatórios' });

    const produto = (await supabase.from('produto').select('id,codigo,descricao').ilike('codigo', codigo).limit(1)).data?.[0];
    if (!produto) return res.json({ ok: true, encontrado: false, codigo });

    const etapasR = await supabase.from('etapa_processo').select('id,nome,ordem').eq('ativo', true).order('ordem');
    if (etapasR.error && /schema cache|does not exist|column/i.test(etapasR.error.message || '')) return res.status(503).json({ erro: 'Fluxo não inicializado. Rode mes_wip_unificado.sql.' });
    if (etapasR.error) return erro500(res, etapasR.error);
    let opsAll;
    try { opsAll = await fetchAllSelect('ordem_producao', 'produto_id,qtd_planejada, etapa:etapa_atual_id(ordem)', q => q.not('status', 'in', '(concluida,cancelada)')); }
    catch (e) { return erro500(res, e); }
    const [maqsR, temposR, peR] = await Promise.all([
        supabase.from('maquina').select('id,etapa_id').eq('ativo', true),
        supabase.from('tempo_padrao').select('etapa_id,produto_id,seg_por_unidade'),
        supabase.from('produto_etapa').select('produto_id,etapa_id'),
    ]);
    const maqCount = {}; (maqsR.data || []).forEach(m => { if (m.etapa_id) maqCount[m.etapa_id] = (maqCount[m.etapa_id] || 0) + 1; });
    const stdDef = {}, stdOv = {};
    (temposR.data || []).forEach(t => { if (t.produto_id) stdOv[t.etapa_id + '|' + t.produto_id] = Number(t.seg_por_unidade); else stdDef[t.etapa_id] = Number(t.seg_por_unidade); });
    const rotProd = {}; (peR.data || []).forEach(x => { (rotProd[x.produto_id] = rotProd[x.produto_id] || new Set()).add(x.etapa_id); });
    const usaEtapa = (prod, eid) => { const s = rotProd[prod]; return !s || s.size === 0 || s.has(eid); };
    const std = (eid, prod) => stdOv[eid + '|' + prod] ?? stdDef[eid] ?? 0;
    const ops = opsAll || [];

    let diasGargalo = 0, semPadrao = 0;
    const etapasOut = [];
    for (const e of (etapasR.data || [])) {
        if (!usaEtapa(produto.id, e.id)) continue;
        let backlogSeg = 0;
        for (const o of ops) { const ord = o.etapa?.ordem || 0; if ((ord === 0 || ord <= e.ordem) && usaEtapa(o.produto_id, e.id)) backlogSeg += Number(o.qtd_planejada || 0) * std(e.id, o.produto_id); }
        const s = std(e.id, produto.id), novoSeg = qtd * s, maquinas = maqCount[e.id] || 0;
        const capDiaSeg = maquinas * horasDia * 3600;
        const diasEtapa = capDiaSeg > 0 ? (backlogSeg + novoSeg) / capDiaSeg : null;
        if (s === 0) semPadrao++;
        if (diasEtapa != null) diasGargalo = Math.max(diasGargalo, diasEtapa);
        etapasOut.push({ etapa: e.nome, ordem: e.ordem, backlog_h: Math.round(backlogSeg / 360) / 10, novo_h: Math.round(novoSeg / 360) / 10, maquinas, dias: diasEtapa != null ? Math.round(diasEtapa * 10) / 10 : null, sem_padrao: s === 0 });
    }
    const confiavel = etapasOut.length > 0 && semPadrao === 0;   // só é data confiável se todas as etapas têm tempo-padrão
    const diasUteis = Math.ceil(diasGargalo);
    const dataPromessa = somaDiasUteis(new Date(), diasUteis);
    const gargaloEtapa = etapasOut.filter(x => x.dias != null).sort((a, b) => b.dias - a.dias)[0]?.etapa || null;
    res.json({
        ok: true, encontrado: true, produto: { codigo: produto.codigo, descricao: produto.descricao }, qtd, horasDia,
        confiavel, sem_padrao_etapas: semPadrao,
        dias_uteis: diasUteis, data_promessa: dataPromessa.toISOString().slice(0, 10),
        data_desejada: dataDesejada, cumpre: dataDesejada ? (dataPromessa <= new Date(dataDesejada + 'T23:59:59')) : null,
        etapa_gargalo: gargaloEtapa, etapas: etapasOut, ops_ativas: ops.length,
    });
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
    let inseridas = 0; const erros = []; const nascimentos = [];
    for (const o of novas) {
        const pid = prodMap.get(String(o.prod_codigo));
        if (!pid) { erros.push(`${o.numero}: produto ${o.prod_codigo} não cadastrado`); continue; }
        const st = _opErpStatus(o.status);
        const { data: ins, error } = await supabase.from('ordem_producao').insert({ numero: o.numero, produto_id: pid, qtd_planejada: o.qtd || 0, unidade,
            status: st, origem: 'erp', data_abertura: _opErpData(o.emissao), data_prevista: _opErpData(o.previsao) }).select('id').single();
        if (error) erros.push(`${o.numero}: ${error.message}`);
        else { inseridas++; if (ins?.id) nascimentos.push({ op_id: ins.id, de: null, para: st, origem: 'erp', motivo: `Importada do ERP (OP ${o.numero})`, usuario_nome: req.usuario?.nome || null, usuario_id: req.usuario?.id || null }); }
    }
    // Onda 6: toda OP nasce com registro no ledger, qualquer que seja o canal de entrada.
    // Best-effort — se a governança não foi inicializada, o import não falha por isso.
    if (nascimentos.length) { const { error: eLog } = await supabase.from('op_state_log').insert(nascimentos); if (eLog) console.warn('importar-ops: ledger indisponível:', eLog.message); }
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
    const r = await casDelta('apontamento', aps[0].id, 'qtd_boa', delta);   // CAS: contador concorrente não perde incremento
    if (r.error) return erro500(res, r.error);
    if (r.naoEncontrado) return res.status(404).json({ erro: 'apontamento não encontrado' });
    res.json({ ok: true, apontamento_id: aps[0].id, qtd_boa: r.novo });
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

    // ── N1TECH — AGENDADOR (spec §2.6: duas frequências; §7: lock por job) ────
    // Roda os jobs do laço sozinho, via self-call HTTP com token de sistema
    // (mesma porta de entrada dos botões — nenhuma lógica duplicada). Cada job
    // já tem lock (n1Lock) e degrada com 503 se as tabelas não existirem.
    const n1Token = () => jwt.sign({ id: 'n1-agendador', email: 'sistema@n1', nome: 'Agendador N1', perfil: 'sistema' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const n1Job = (nome, metodo, rota, body) => fetch(`${selfUrl}${rota}`, {
        method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + n1Token() },
        body: body ? JSON.stringify(body) : '{}',
    }).then(r => r.json().then(j => console.log(`[n1:${nome}]`, r.status, JSON.stringify(j).slice(0, 180))))
      .catch(e => console.log(`[n1:${nome}] falhou:`, e.message));
    const n1HoraSP = () => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit' }).formatToParts(new Date()); const g = t => p.find(x => x.type === t)?.value; return { hm: `${g('hour')}:${g('minute')}`, dia: g('day') }; };
    let n1UltimoDiario = '', n1UltimoFech = '', n1UltimoRot = '';
    // varredura do gatilho: a cada 15 min (leve — posição vs zona)
    setInterval(() => n1Job('varredura', 'POST', '/api/n1/varredura'), 15 * 60 * 1000);
    // relógio por minuto: diário 05:00 (ETL→motor), fechamento 23:30, roteamento dia 01 06:00
    setInterval(async () => {
        const { hm, dia } = n1HoraSP(); const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        if (hm === '05:00' && n1UltimoDiario !== hoje) { n1UltimoDiario = hoje;
            await n1Job('etl', 'POST', '/api/n1/etl/sync'); await n1Job('motor', 'POST', '/api/n1/motor/diario'); await n1Job('varredura', 'POST', '/api/n1/varredura'); }
        if (hm === '23:30' && n1UltimoFech !== hoje) { n1UltimoFech = hoje; await n1Job('fechamento', 'POST', '/api/n1/fechamento'); }
        if (dia === '01' && hm === '06:00' && n1UltimoRot !== hoje) { n1UltimoRot = hoje;
            await n1Job('roteamento', 'POST', '/api/n1/roteamento/rodar'); await n1Job('previsao', 'POST', '/api/n1/previsao/rodar'); }
    }, 60 * 1000);
    console.log('⏰ N1Tech agendado: varredura 15min · diário 05:00 · fechamento 23:30 · roteamento dia 01 06:00 (America/Sao_Paulo)');
});
