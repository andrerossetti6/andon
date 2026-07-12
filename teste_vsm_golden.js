// ═══ GOLDEN TEST do VSM (rode: node teste_vsm_golden.js) ═══
// Timestamps conhecidos → lead time e %VA calculados À MÃO. Trava o motor.
'use strict';
const { calcularVSM, mediana } = require('./vsm_motor');

let falhas = 0;
const ok = (c, n) => { console.log((c ? '  ✓ ' : '  ✗ FALHOU: ') + n); if (!c) falhas++; };
const min = m => m * 60000;   // minutos → ms

console.log('GOLDEN TEST — VSM (fluxo de valor)');

// ── maquete: sequência Tecelagem → Costura → Embalagem ──
const seq = ['Tecelagem', 'Costura', 'Embalagem'];
// ordem tipo: liberada em t0. Tecelagem 08:00-10:00 (120min, 20 parada→VA 100).
// espera 4h. Costura 14:00-14:30 (30min, 0 parada). espera 1h. Embalagem 15:30-15:40 (10min).
// lead = 15:40 − 08:00 = 460 min. VA = 100+30+10 = 140. %VA = 140/460 = 30,4%.
const T0 = Date.parse('2026-01-05T08:00:00Z');
const mk = (n, off = 0) => ({ id: 'O' + n, numero: String(n), liberadaMs: T0 + off,
    etapas: {
        Tecelagem: { inicioMs: T0 + off, fimMs: T0 + off + min(120), paradaMin: 20 },
        Costura:   { inicioMs: T0 + off + min(360), fimMs: T0 + off + min(390), paradaMin: 0 },
        Embalagem: { inicioMs: T0 + off + min(450), fimMs: T0 + off + min(460), paradaMin: 0 },
    } });
// 5 ordens idênticas (deslocadas) → medianas = os valores base; n=5 (confiável)
const ordens = [mk(1, 0), mk(2, min(60)), mk(3, min(120)), mk(4, min(30)), mk(5, min(90))];

const r = calcularVSM({ ordens, sequencia: seq });
ok(r.va_total_min === 140, `VA total = 140 (obtido ${r.va_total_min})`);
ok(r.lead_time_min === 460, `lead = 460 min (obtido ${r.lead_time_min})`);
ok(r.pct_va === 30.4, `%VA = 30,4% (obtido ${r.pct_va})`);
ok(r.n_ordens === 5 && !r.baixa_confianca, 'n=5 → confiável');

// etapas: VA por caixa + espera antes
const eT = r.etapas.find(e => e.etapa === 'Tecelagem');
const eC = r.etapas.find(e => e.etapa === 'Costura');
const eE = r.etapas.find(e => e.etapa === 'Embalagem');
ok(eT.tempo_va_min === 100 && eT.tempo_espera_min === 0, 'Tecelagem: VA 100 · espera 0 (1ª etapa)');
ok(eC.tempo_espera_min === 240, `Costura: espera 240 min = 4h (obtido ${eC.tempo_espera_min})`);
ok(eE.tempo_espera_min === 60 && eE.tempo_va_min === 10, 'Embalagem: espera 60 · VA 10');

// baixa confiança com < 5 ordens
const r2 = calcularVSM({ ordens: ordens.slice(0, 3), sequencia: seq });
ok(r2.baixa_confianca === true, 'n=3 → baixa confiança marcada');

// MEDIANA ignora outlier: 1 ordem 10× mais lenta na costura não move a mediana
const lento = { id: 'X', numero: 'X', liberadaMs: T0,
    etapas: { Tecelagem: { inicioMs: T0, fimMs: T0 + min(120), paradaMin: 20 },
        Costura: { inicioMs: T0 + min(360), fimMs: T0 + min(660), paradaMin: 0 },   // 300 min!
        Embalagem: { inicioMs: T0 + min(720), fimMs: T0 + min(730), paradaMin: 0 } } };
const r3 = calcularVSM({ ordens: [...ordens, lento], sequencia: seq });
const eC3 = r3.etapas.find(e => e.etapa === 'Costura');
ok(eC3.tempo_va_min === 30, `mediana ignora outlier: costura segue 30 min (obtido ${eC3.tempo_va_min})`);

// ordem incompleta (não passou por todas as etapas) não entra no lead
const incompleta = { id: 'I', numero: 'I', liberadaMs: T0, etapas: { Tecelagem: { inicioMs: T0, fimMs: T0 + min(120), paradaMin: 0 } } };
const r4 = calcularVSM({ ordens: [...ordens, incompleta], sequencia: seq });
ok(r4.n_ordens === 5, 'ordem incompleta não conta no lead (n segue 5)');

ok(mediana([3, 1, 2]) === 2 && mediana([4, 1, 2, 3]) === 2.5, 'mediana ímpar/par ok');

console.log(falhas ? `\n✗ ${falhas} FALHARAM` : '\n✓ TODOS os testes passaram');
process.exit(falhas ? 1 : 0);
