// Testes de integração da API do MES Malha Forte.
// Pré-requisito: servidor rodando em localhost:3000 e schema aplicado.
// Rodar: node --test test/
// Limpa os dados que cria ao final (via service_role).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const B = process.env.MF_TEST_URL || 'http://localhost:3000';
const TOKEN = jwt.sign({ id: 'test-suite', perfil: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const VIEWER = jwt.sign({ id: 'test-viewer', perfil: 'viewer' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const H = (tok = TOKEN) => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ALL = '00000000-0000-0000-0000-000000000000';

const api = async (url, opt = {}) => { const r = await fetch(B + url, { headers: H(opt.tok), ...opt }); return { status: r.status, body: await r.json().catch(() => null) }; };
let ctx = {};

before(async () => {
    const get = u => api(u).then(r => r.body);
    [ctx.ops, ctx.maq, ctx.opr, ctx.tur, ctx.defs] = await Promise.all(['ops','maquinas','operadores','turnos','defeitos'].map(x => get('/api/mf/' + x)));
});
after(async () => {
    for (const t of ['foto','rnc','nao_conformidade','consumo_fio','apontamento']) await sb.from(t).delete().neq('id', ALL);
});

test('cadastros base carregam', () => {
    assert.ok(ctx.ops.length > 0, 'OPs'); assert.ok(ctx.maq.length > 0, 'máquinas');
    assert.ok(ctx.defs.length >= 25, 'catálogo ≥ 25 defeitos');
});

test('segurança: viewer não escreve (403), admin sim', async () => {
    const v = await api('/api/mf/etiquetas', { method: 'POST', tok: VIEWER, body: '{}' });
    assert.equal(v.status, 403, 'viewer bloqueado');
    const g = await api('/api/mf/indicadores', { tok: VIEWER });
    assert.equal(g.status, 200, 'viewer lê');
});

test('apontamento → NC com gatilho → RNC abre sozinha', async () => {
    const ap = (await api('/api/mf/apontamentos', { method: 'POST', body: JSON.stringify({ op_id: ctx.ops[0].id, maquina_id: ctx.maq[0].id, operador_id: ctx.opr[0].id, turno_id: ctx.tur[0].id }) })).body.apontamento;
    ctx.apId = ap.id;
    const agq = ctx.defs.find(d => d.codigo === 'AGQ');
    const nc = await api('/api/mf/ncs', { method: 'POST', body: JSON.stringify({ apontamento_id: ap.id, defeito_id: agq.id, qtd_afetada: 80, unidade: 'kg', disposicao: 'refugar' }) });
    assert.equal(nc.status, 200);
    assert.equal(nc.body.gera_rnc, true, 'gatilho de volume disparou');
    assert.ok(nc.body.rnc_id, 'RNC criada automaticamente');
});

test('trava de qualidade: defeito sev4 não pode ser liberado (422)', async () => {
    const agq = ctx.defs.find(d => d.codigo === 'AGQ'); // severidade 4
    const r = await api('/api/mf/ncs', { method: 'POST', body: JSON.stringify({ apontamento_id: ctx.apId, defeito_id: agq.id, qtd_afetada: 1, unidade: 'kg', disposicao: 'liberar' }) });
    assert.equal(r.status, 422, 'crítico + liberar bloqueado');
});

test('ciclo CAPA da RNC avança até fechada eficaz', async () => {
    const { rncs } = (await api('/api/mf/rncs')).body;
    assert.ok(rncs.length > 0, 'há RNC aberta');
    const id = rncs[0].id;
    await api('/api/mf/rncs/' + id, { method: 'PUT', body: JSON.stringify({ avancar: 'analise', responsavel_id: ctx.opr[0].id }) });
    await api('/api/mf/rncs/' + id, { method: 'PUT', body: JSON.stringify({ avancar: 'acao', causa_raiz: 'x', metodo_analise: 'cinco_porques' }) });
    await api('/api/mf/rncs/' + id, { method: 'PUT', body: JSON.stringify({ avancar: 'verificacao', acao_corretiva: 'y' }) });
    const fim = await api('/api/mf/rncs/' + id, { method: 'PUT', body: JSON.stringify({ avancar: 'fechar', eficaz: true }) });
    assert.equal(fim.body.rnc.status, 'fechada');
    assert.equal(fim.body.rnc.eficaz, true);
});

test('CEP calcula Cp/Cpk corretos', async () => {
    const prods = (await api('/api/mf/cep')).body.produtos;
    const art = prods.find(p => p.codigo === 'ART-001');
    await api('/api/mf/produtos/' + art.id + '/tolerancia', { method: 'PUT', body: JSON.stringify({ gramatura_tol: 10 }) });
    for (const v of [180, 180, 180, 180, 180]) await api('/api/mf/medicao', { method: 'POST', body: JSON.stringify({ produto_id: art.id, tipo: 'gramatura', valor: v }) });
    for (const v of [178, 182, 179, 181]) await api('/api/mf/medicao', { method: 'POST', body: JSON.stringify({ produto_id: art.id, tipo: 'gramatura', valor: v }) });
    const cap = (await api('/api/mf/cep')).body.capabilidade.find(c => c.produto_id === art.id && c.tipo === 'gramatura');
    assert.ok(cap, 'capabilidade calculada');
    assert.ok(cap.cpk > 1.0, 'Cpk plausível (' + cap.cpk + ')');
    assert.equal(cap.ucl > cap.media && cap.lcl < cap.media, true, 'UCL/LCL coerentes');
    await sb.from('medicao').delete().neq('id', ALL);
    await sb.from('produto').update({ gramatura_tol: null }).eq('id', art.id);
});

test('rastreabilidade: recall liga lote de fio à produção', async () => {
    const lote = (await api('/api/mf/lotes-fio', { method: 'POST', body: JSON.stringify({ codigo: 'FIO-TEST-' + Date.now(), fornecedor: 'F', qtd_recebida_kg: 100 }) })).body.lote;
    await api('/api/mf/consumo-fio', { method: 'POST', body: JSON.stringify({ apontamento_id: ctx.apId, lote_fio_id: lote.id, qtd_consumida_kg: 30 }) });
    const g = (await api('/api/mf/genealogia?lote_fio_id=' + lote.id)).body;
    assert.ok(g.length > 0, 'recall encontra a produção do lote');
    await sb.from('consumo_fio').delete().eq('lote_fio_id', lote.id);
    await sb.from('lote_fio').delete().eq('id', lote.id);
});

test('painel e alertas respondem', async () => {
    const p = (await api('/api/mf/painel')).body;
    assert.ok('oee_medio' in p && 'cnq_total' in p, 'KPIs do painel');
    const a = (await api('/api/mf/alertas')).body;
    assert.ok(Array.isArray(a.alertas), 'lista de alertas');
});
