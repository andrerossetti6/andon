// ═══════════════════════════════════════════════════════════════════════════
// VSM MOTOR — deriva o Mapa de Fluxo de Valor do apontamento (módulo PURO)
// VA (agrega valor) = tempo com sessão ativa − paradas.
// Espera = do fim da etapa anterior (ou da liberação) ao início desta etapa.
// Lead = espera + processo (início→fim, inclui parada), somado na sequência.
// %VA = VA_total ÷ lead_total. MEDIANA entre ordens (outlier não distorce mapa).
//
// Entrada:
//   ordens = [{ id, numero, liberadaMs, etapas: { <nomeEtapa>: {inicioMs, fimMs, paradaMin} } }]
//   sequencia = [nomeEtapa, ...]  (ordem do fluxo)
// Saída: { lead_time_min, va_total_min, pct_va, n_ordens, baixa_confianca, etapas: [...] }
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

function mediana(arr) {
    const v = arr.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function calcularVSM({ ordens, sequencia, minConfianca = 5 }) {
    const va = {}, proc = {}, espera = {}, leads = [];
    sequencia.forEach(e => { va[e] = []; proc[e] = []; espera[e] = []; });

    for (const o of ordens || []) {
        let anteriorFimMs = o.liberadaMs;
        let completou = true, ultimoFim = null;
        for (const etapa of sequencia) {
            const ev = o.etapas?.[etapa];
            if (!ev || ev.inicioMs == null || ev.fimMs == null) { completou = false; break; }
            const procMin = (ev.fimMs - ev.inicioMs) / 60000;
            const vaMin = Math.max(0, procMin - (Number(ev.paradaMin) || 0));
            const espMin = anteriorFimMs != null ? Math.max(0, (ev.inicioMs - anteriorFimMs) / 60000) : 0;
            proc[etapa].push(procMin);
            va[etapa].push(vaMin);
            espera[etapa].push(espMin);
            anteriorFimMs = ev.fimMs;
            ultimoFim = ev.fimMs;
        }
        // lead da ordem = da liberação ao fim da última etapa (só ordens completas)
        if (completou && ultimoFim != null && o.liberadaMs != null) leads.push((ultimoFim - o.liberadaMs) / 60000);
    }

    const etapas = sequencia.map((etapa, i) => ({
        ordem_seq: i + 1, etapa,
        tempo_va_min: Math.round(mediana(va[etapa]) * 10) / 10,
        tempo_proc_min: Math.round(mediana(proc[etapa]) * 10) / 10,
        tempo_espera_min: Math.round(mediana(espera[etapa]) * 10) / 10,
    }));
    const va_total_min = Math.round(etapas.reduce((s, e) => s + e.tempo_va_min, 0) * 10) / 10;
    // lead = mediana do lead real por ordem; fallback = soma das medianas (espera+proc)
    const lead_time_min = leads.length
        ? Math.round(mediana(leads) * 10) / 10
        : Math.round(etapas.reduce((s, e) => s + e.tempo_espera_min + e.tempo_proc_min, 0) * 10) / 10;
    const n = leads.length || (ordens || []).length;
    return {
        lead_time_min, va_total_min,
        pct_va: lead_time_min > 0 ? Math.round(va_total_min / lead_time_min * 1000) / 10 : 0,
        n_ordens: n, baixa_confianca: n < minConfianca, etapas,
    };
}

module.exports = { calcularVSM, mediana };
