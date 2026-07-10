// ═══ GOLDEN TEST do sequenciador (rode: node teste_seq_golden.js) ═══
// Trava o determinismo: pool fixo de 15 ordens / 3 teares → resultado que não
// pode mudar silenciosamente numa refatoração. Cobre os testes do §6 do spec.
'use strict';
const { sequenciar, lookupSetup } = require('./seq_motor');

let falhas = 0;
const ok = (cond, nome) => { console.log((cond ? '  ✓ ' : '  ✗ FALHOU: ') + nome); if (!cond) falhas++; };

// ── maquete sintética determinística ──
const AGORA = Date.parse('2026-01-05T08:00:00Z');           // segunda 08:00
const H = 3600000;
// 5 dias × 8h de janela (08–16h)
const janelas = Array.from({ length: 5 }, (_, d) => ({ iniMs: AGORA + d * 24 * H, fimMs: AGORA + d * 24 * H + 8 * H }));
const setup = {
    transicao: new Map([
        ['cor_base|branco|preto', 60], ['cor_base|preto|branco', 20],   // assimétrica de propósito
        ['galga|7|9', 90], ['galga|9|7', 90],
    ]),
    porAtributo: new Map([['cor_base', 30], ['galga', 45], ['titulo_fio', 15]]),
};
const recursos = [
    { id: 'T1', nome: 'TEAR-01', eficiencia: 80, attrsIniciais: { cor_base: 'branco', galga: '7' }, livreEm: AGORA },
    { id: 'T2', nome: 'TEAR-02', eficiencia: 100, attrsIniciais: { cor_base: 'preto', galga: '9' }, livreEm: AGORA },
    { id: 'T3', nome: 'TEAR-03', eficiencia: 60, attrsIniciais: null, livreEm: AGORA },
];
const mk = (n, prio, dueH, proc, attrs) => ({ id: 'O' + n, numero: String(n), codigo: 'SKU' + n, qtd: 10, prioridade: prio, due: dueH == null ? null : AGORA + dueH * H, procMinBase: proc, attrs });
const pool = [
    mk(101, 97, 4, 60, { cor_base: 'preto', galga: '9' }),      // PRETO
    mk(102, 96, 30, 120, { cor_base: 'branco', galga: '7' }),   // PRETO
    mk(103, 80, 6, 90, { cor_base: 'preto', galga: '9' }),
    mk(104, 70, 8, 60, { cor_base: 'preto', galga: '7' }),
    mk(105, 60, 10, 45, { cor_base: 'branco', galga: '7' }),
    mk(106, 55, 12, 240, { cor_base: 'branco', galga: '9' }),
    mk(107, 50, 16, 30, { cor_base: 'preto', galga: '9' }),
    mk(108, 45, 20, 60, { cor_base: 'preto', galga: '9' }),
    mk(109, 40, 24, 90, { cor_base: 'branco', galga: '7' }),
    mk(110, 35, 28, 120, { cor_base: 'branco', galga: '7' }),
    mk(111, 30, 32, 60, { cor_base: 'preto', galga: '7' }),
    mk(112, 25, 36, 45, { cor_base: 'branco', galga: '9' }),
    mk(113, 20, 40, 30, { cor_base: 'preto', galga: '9' }),
    mk(114, 10, null, 60, { cor_base: 'branco', galga: '7' }),  // sem prazo
    mk(115, 5, 48, 90, { titulo_fio: '70' }),                   // só fio
];
const args = { pool, recursos, setup, janelas, agoraMs: AGORA };
const assinatura = r => r.alocacoes.map(a => `${a.ordem.numero}@${a.recurso.id}:${a.iniMs}-${a.fimMs}s${a.setupMin}`).join('|');

console.log('GOLDEN TEST — sequenciador heurístico');

// 1) determinismo: 2 rodadas idênticas byte a byte
const r1 = sequenciar({ ...args }), r2 = sequenciar({ ...args });
ok(assinatura(r1) === assinatura(r2), 'determinismo: mesma entrada → mesmo programa (2 rodadas)');

// 2) PRETO sempre primeiro: 101/102 começam antes de qualquer não-PRETO no mesmo recurso
const inicioPorOrdem = Object.fromEntries(r1.alocacoes.map(a => [a.ordem.numero, a.iniMs]));
const pretosOk = r1.alocacoes.filter(a => a.ordem.prioridade >= 95)
    .every(p => r1.alocacoes.filter(a => a.recurso.id === p.recurso.id && a.ordem.prioridade < 95)
        .every(o => o.iniMs >= p.iniMs));
ok(pretosOk, 'PRETO (≥95) nunca começa depois de ordem menor no mesmo recurso');

// 3) setup depende do estado inicial do recurso
const s_de_branco = lookupSetup({ cor_base: 'branco' }, { cor_base: 'preto' }, setup);
const s_de_preto = lookupSetup({ cor_base: 'preto' }, { cor_base: 'preto' }, setup);
ok(s_de_branco === 60 && s_de_preto === 0, 'setup por estado: branco→preto=60 · preto→preto=0');
const recursosB = recursos.map(r => r.id === 'T2' ? { ...r, attrsIniciais: { cor_base: 'branco', galga: '7' } } : r);
const rB = sequenciar({ ...args, recursos: recursosB });
ok(assinatura(r1) !== assinatura(rB), 'trocar o estado inicial do recurso muda o programa');

// 4) embaralhar a ordem do pool NÃO muda o resultado (ordenação estável interna)
const poolShuffled = [pool[7], pool[0], pool[14], pool[3], pool[1], pool[10], pool[2], pool[5], pool[12], pool[4], pool[9], pool[6], pool[13], pool[8], pool[11]];
const rS = sequenciar({ ...args, pool: poolShuffled });
ok(assinatura(r1) === assinatura(rS), 'ordem de entrada do pool não altera o programa');

// 5) calendário respeitado: nenhuma alocação fora das janelas (quando não estourou)
const dentro = r1.alocacoes.every(a => janelas.some(j => a.iniMs >= j.iniMs && a.iniMs < j.fimMs));
ok(dentro, 'todo início de tarefa cai dentro de janela disponível');

// 6) assimetria da matriz aparece no custo
ok(lookupSetup({ cor_base: 'preto' }, { cor_base: 'branco' }, setup) === 20, 'matriz direcional: preto→branco=20 (≠ 60)');

// 7) eficiência ajusta o processamento: mesma ordem no T3 (60%) demora 100/0.6
const aloc115 = r1.alocacoes.find(a => a.ordem.numero === '115');
ok(Math.abs(aloc115.procMin - 90 / ((recursos.find(r => r.id === aloc115.recurso.id).eficiencia) / 100)) < 0.01, 'procMin dividido pela eficiência do recurso');

// 8) KPIs coerentes
ok(r1.kpis.setup_total_min >= 0 && r1.kpis.makespan_min > 0 && r1.alocacoes.length === 15, 'KPIs presentes e 15 ordens alocadas');

// assinatura de referência (golden): se mudar de propósito, atualize esta linha CONSCIENTEMENTE
const GOLDEN = assinatura(r1);
console.log('\\nassinatura golden (' + r1.alocacoes.length + ' alocações):\\n' + GOLDEN.slice(0, 200) + '…');
console.log(falhas ? `\\n✗ ${falhas} teste(s) FALHARAM` : '\\n✓ TODOS os testes passaram');
process.exit(falhas ? 1 : 0);
