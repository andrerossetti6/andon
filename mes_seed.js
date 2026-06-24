// Seed dos cadastros base do MES Malha Forte. Idempotente (upsert por código).
// Rodar: node mes_seed.js
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const TURNOS = [
    { codigo: 'A', descricao: 'Turno A — manhã', hora_inicio: '06:00', hora_fim: '14:00' },
    { codigo: 'B', descricao: 'Turno B — tarde', hora_inicio: '14:00', hora_fim: '22:00' },
    { codigo: 'C', descricao: 'Turno C — noite', hora_inicio: '22:00', hora_fim: '06:00' },
];

const MOTIVOS = [
    { codigo: 'SETUP',       descricao: 'Troca de artigo (setup)',   categoria: 'setup',          planejada: false, conta_oee: true },
    { codigo: 'MANUT_PREV',  descricao: 'Manutenção preventiva',      categoria: 'manutencao',     planejada: true,  conta_oee: false },
    { codigo: 'MANUT_CORR',  descricao: 'Manutenção corretiva',       categoria: 'manutencao',     planejada: false, conta_oee: true },
    { codigo: 'FALTA_FIO',   descricao: 'Falta de fio/matéria-prima', categoria: 'falta_material', planejada: false, conta_oee: true },
    { codigo: 'QUEBRA_AG',   descricao: 'Quebra de agulha',           categoria: 'qualidade',      planejada: false, conta_oee: true },
    { codigo: 'AJUSTE_QUAL', descricao: 'Ajuste de qualidade',        categoria: 'qualidade',      planejada: false, conta_oee: true },
    { codigo: 'FALTA_OPER',  descricao: 'Falta de operador',          categoria: 'operacional',    planejada: false, conta_oee: true },
    { codigo: 'ENERGIA',     descricao: 'Falta de energia',           categoria: 'operacional',    planejada: false, conta_oee: true },
    { codigo: 'LIMPEZA',     descricao: 'Limpeza programada',         categoria: 'planejada',      planejada: true,  conta_oee: false },
    { codigo: 'REFEICAO',    descricao: 'Refeição / intervalo',       categoria: 'planejada',      planejada: true,  conta_oee: false },
];

// Catálogo de defeitos têxteis de malha. severidade 1=cosmético … 4=crítico
const DEFEITOS = [
    { codigo: 'FUR', descricao: 'Furo',                      categoria: 'malha',       etapa: 'malharia',   severidade: 3, disposicao_padrao: 'refugar' },
    { codigo: 'FAL', descricao: 'Falha de malha',            categoria: 'malha',       etapa: 'malharia',   severidade: 3, disposicao_padrao: 'retrabalhar' },
    { codigo: 'AGQ', descricao: 'Agulha quebrada',           categoria: 'malha',       etapa: 'malharia',   severidade: 4, disposicao_padrao: 'segregar' },
    { codigo: 'BAR', descricao: 'Barrado',                   categoria: 'malha',       etapa: 'malharia',   severidade: 2, disposicao_padrao: 'reclassificar' },
    { codigo: 'LIS', descricao: 'Listras',                   categoria: 'malha',       etapa: 'malharia',   severidade: 2, disposicao_padrao: 'reclassificar' },
    { codigo: 'RAS', descricao: 'Rasgo',                     categoria: 'malha',       etapa: 'revisao',    severidade: 4, disposicao_padrao: 'refugar' },
    { codigo: 'MAN', descricao: 'Mancha',                    categoria: 'cor',         etapa: 'tinturaria', severidade: 3, disposicao_padrao: 'retrabalhar' },
    { codigo: 'MAC', descricao: 'Manchamento de cor',        categoria: 'cor',         etapa: 'tinturaria', severidade: 3, disposicao_padrao: 'reclassificar' },
    { codigo: 'DIF', descricao: 'Diferença de tonalidade',   categoria: 'cor',         etapa: 'tinturaria', severidade: 3, disposicao_padrao: 'reclassificar' },
    { codigo: 'FIO', descricao: 'Fio contaminante',          categoria: 'fio',         etapa: 'malharia',   severidade: 2, disposicao_padrao: 'retrabalhar' },
    { codigo: 'FIP', descricao: 'Fio puxado',                categoria: 'fio',         etapa: 'malharia',   severidade: 2, disposicao_padrao: 'retrabalhar' },
    { codigo: 'NOD', descricao: 'Nó',                        categoria: 'fio',         etapa: 'malharia',   severidade: 1, disposicao_padrao: 'liberar' },
    { codigo: 'GRA', descricao: 'Gramatura fora do alvo',    categoria: 'dimensional', etapa: 'acabamento', severidade: 3, disposicao_padrao: 'reclassificar' },
    { codigo: 'LAR', descricao: 'Largura fora do alvo',      categoria: 'dimensional', etapa: 'acabamento', severidade: 3, disposicao_padrao: 'reclassificar' },
    { codigo: 'ENC', descricao: 'Encolhimento',              categoria: 'dimensional', etapa: 'acabamento', severidade: 3, disposicao_padrao: 'segregar' },
    { codigo: 'SUJ', descricao: 'Sujeira',                   categoria: 'sujeira',     etapa: 'revisao',    severidade: 2, disposicao_padrao: 'retrabalhar' },
    { codigo: 'OLE', descricao: 'Mancha de óleo / graxa',    categoria: 'sujeira',     etapa: 'malharia',   severidade: 3, disposicao_padrao: 'retrabalhar' },
    { codigo: 'FUF', descricao: 'Fungo / mofo',              categoria: 'sujeira',     etapa: 'acabamento', severidade: 4, disposicao_padrao: 'refugar' },
    { codigo: 'PUI', descricao: 'Puído',                     categoria: 'acabamento',  etapa: 'acabamento', severidade: 2, disposicao_padrao: 'retrabalhar' },
    { codigo: 'ARR', descricao: 'Arranhão / abrasão',        categoria: 'acabamento',  etapa: 'acabamento', severidade: 2, disposicao_padrao: 'retrabalhar' },
    { codigo: 'QUE', descricao: 'Quebra de fio',             categoria: 'fio',         etapa: 'malharia',   severidade: 3, disposicao_padrao: 'retrabalhar' },
    { codigo: 'PIL', descricao: 'Pilling (bolinhas)',        categoria: 'acabamento',  etapa: 'acabamento', severidade: 2, disposicao_padrao: 'reclassificar' },
    { codigo: 'TOR', descricao: 'Torção / espiralidade',     categoria: 'dimensional', etapa: 'acabamento', severidade: 3, disposicao_padrao: 'reclassificar' },
    { codigo: 'DEN', descricao: 'Densidade irregular',       categoria: 'malha',       etapa: 'malharia',   severidade: 2, disposicao_padrao: 'reclassificar' },
    { codigo: 'EMB', descricao: 'Fio embaraçado',            categoria: 'fio',         etapa: 'malharia',   severidade: 2, disposicao_padrao: 'retrabalhar' },
];

// Tradução do legado: texto livre normalizado → código do catálogo
const DEPARA = {
    FUR: ['furo', 'furos', 'furado', 'furada', 'furadinho'],
    FAL: ['falha', 'falha malha', 'malha falhada', 'falha de tecimento', 'falhada'],
    AGQ: ['agulha quebrada', 'agulha', 'ag quebrada', 'agulha partida', 'quebra agulha'],
    BAR: ['barrado', 'barramento', 'barra', 'barradura'],
    LIS: ['listra', 'listras', 'listrado', 'riscado'],
    RAS: ['rasgo', 'rasgado', 'rasgada', 'rasgo de malha'],
    MAN: ['mancha', 'manchado', 'manchada', 'manchas'],
    MAC: ['manchamento', 'mancha cor', 'mancha de cor', 'manchamento cor'],
    DIF: ['tonalidade', 'dif tonalidade', 'cor diferente', 'diferenca de cor', 'fora de tom'],
    FIO: ['fio contaminante', 'contaminacao', 'fio estranho', 'contaminado'],
    FIP: ['fio puxado', 'puxado', 'puxao', 'fio solto'],
    NOD: ['no', 'nos', 'no de fio', 'nozinho'],
    GRA: ['gramatura', 'gramatura fora', 'peso', 'gramatura errada', 'peso fora'],
    LAR: ['largura', 'largura fora', 'largura errada', 'estreito', 'largo demais'],
    ENC: ['encolhimento', 'encolheu', 'encolhida', 'encolhido'],
    SUJ: ['sujeira', 'sujo', 'suja', 'manchado de sujeira'],
    OLE: ['oleo', 'mancha oleo', 'mancha de oleo', 'graxa', 'oleoso'],
    FUF: ['fungo', 'mofo', 'mofado', 'bolor'],
    PUI: ['puido', 'puida', 'desgastado'],
    ARR: ['arranhao', 'arranhado', 'abrasao', 'arranhadura'],
    QUE: ['quebra de fio', 'fio rompido', 'rompimento', 'fio quebrado'],
    PIL: ['pilling', 'bolinha', 'bolinhas', 'bolotas'],
    TOR: ['torcao', 'espiralidade', 'torcido', 'enviesado', 'torto'],
    DEN: ['densidade', 'malha frouxa', 'frouxo', 'densidade irregular', 'malha aberta'],
    EMB: ['embaracado', 'enrolado', 'embolado', 'no enrolado'],
};

const PRODUTOS = [
    { codigo: 'ART-001', descricao: 'Malha PV meia-malha 30/1',       composicao: 'PV 67/33',     titulo_fio: '30/1', gramatura_alvo: 180, largura_alvo: 180, unidade_medida: 'kg' },
    { codigo: 'ART-002', descricao: 'Malha 100% algodão cardado 20/1', composicao: '100% algodão', titulo_fio: '20/1', gramatura_alvo: 220, largura_alvo: 190, unidade_medida: 'kg' },
    { codigo: 'ART-003', descricao: 'Ribana 1x1 PV 30/1',             composicao: 'PV 67/33',     titulo_fio: '30/1', gramatura_alvo: 240, largura_alvo: 90,  unidade_medida: 'kg' },
];

const MAQUINAS = [
    { codigo: 'CIRC-01', nome: 'Circular 30" 24F', tipo: 'circular',   setor: 'malharia',   finura: 24, diametro_pol: 30, num_alimentadores: 96,  velocidade_nominal: 25, unidade_velocidade: 'rpm',  capacidade_nominal: 18 },
    { codigo: 'CIRC-02', nome: 'Circular 34" 28F', tipo: 'circular',   setor: 'malharia',   finura: 28, diametro_pol: 34, num_alimentadores: 120, velocidade_nominal: 22, unidade_velocidade: 'rpm',  capacidade_nominal: 22 },
    { codigo: 'RET-01',  nome: 'Retilínea 12g',    tipo: 'retilinea',  setor: 'malharia',   finura: 12, velocidade_nominal: 1.2, unidade_velocidade: 'm_min', capacidade_nominal: 6 },
    { codigo: 'RAMA-01', nome: 'Rama 8 campos',    tipo: 'rama',       setor: 'acabamento', velocidade_nominal: 30, unidade_velocidade: 'm_min', capacidade_nominal: 120 },
    { codigo: 'TINT-01', nome: 'Jet 200 kg',       tipo: 'tinturaria', setor: 'tinturaria', capacidade_nominal: 50 },
];

const OPERADORES = [
    { matricula: '0001', nome: 'João Silva',    setor: 'malharia' },
    { matricula: '0002', nome: 'Maria Souza',   setor: 'revisao' },
    { matricula: '0003', nome: 'Pedro Alves',   setor: 'tinturaria' },
    { matricula: '0004', nome: 'Ana Oliveira',  setor: 'acabamento' },
];

(async () => {
    const log = (m) => console.log(m);

    // upsert helper por coluna única
    const up = async (tabela, rows, onConflict) => {
        const { error } = await sb.from(tabela).upsert(rows, { onConflict, ignoreDuplicates: true });
        if (error) throw new Error(`${tabela}: ${error.message}`);
    };

    await up('turno', TURNOS, 'codigo');                 log(`✓ turno: ${TURNOS.length}`);
    await up('motivo_parada', MOTIVOS, 'codigo');        log(`✓ motivo_parada: ${MOTIVOS.length}`);
    await up('catalogo_defeito', DEFEITOS, 'codigo');    log(`✓ catalogo_defeito: ${DEFEITOS.length}`);
    await up('produto', PRODUTOS, 'codigo');             log(`✓ produto: ${PRODUTOS.length}`);
    await up('maquina', MAQUINAS, 'codigo');             log(`✓ maquina: ${MAQUINAS.length}`);
    await up('operador', OPERADORES, 'matricula');       log(`✓ operador: ${OPERADORES.length}`);

    // de_para_defeito precisa do id do defeito
    const { data: defs } = await sb.from('catalogo_defeito').select('id,codigo');
    const idDe = Object.fromEntries((defs || []).map(d => [d.codigo, d.id]));
    const deparaRows = [];
    for (const [cod, termos] of Object.entries(DEPARA)) {
        if (!idDe[cod]) continue;
        termos.forEach(t => deparaRows.push({ termo_legado: norm(t), defeito_id: idDe[cod], fonte: 'semente' }));
    }
    await up('de_para_defeito', deparaRows, 'termo_legado'); log(`✓ de_para_defeito: ${deparaRows.length}`);

    // ordens de produção de amostra (precisam de produto_id / maquina_id)
    const { data: prods } = await sb.from('produto').select('id,codigo');
    const { data: maqs }  = await sb.from('maquina').select('id,codigo');
    const idProd = Object.fromEntries((prods || []).map(p => [p.codigo, p.id]));
    const idMaq  = Object.fromEntries((maqs  || []).map(m => [m.codigo, m.id]));
    const OPS = [
        { numero: 'OP-1001', produto_id: idProd['ART-001'], qtd_planejada: 500, unidade: 'kg', maquina_prevista_id: idMaq['CIRC-01'], status: 'liberada',  origem: 'manual' },
        { numero: 'OP-1002', produto_id: idProd['ART-002'], qtd_planejada: 300, unidade: 'kg', maquina_prevista_id: idMaq['CIRC-02'], status: 'liberada',  origem: 'manual' },
        { numero: 'OP-1003', produto_id: idProd['ART-003'], qtd_planejada: 200, unidade: 'kg', maquina_prevista_id: idMaq['RET-01'],  status: 'planejada', origem: 'manual' },
    ].filter(o => o.produto_id);
    await up('ordem_producao', OPS, 'numero'); log(`✓ ordem_producao: ${OPS.length}`);

    log('\n✅ Seed concluído.');
})().catch(e => { console.error('❌ FALHA NO SEED:', e.message); process.exit(1); });
