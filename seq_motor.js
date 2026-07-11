// ═══════════════════════════════════════════════════════════════════════════
// SEQ MOTOR — sequenciador heurístico de capacidade finita (núcleo Preactor)
// Módulo PURO e DETERMINÍSTICO: mesmo pool + mesma regra + mesmo estado =
// sempre o mesmo programa. Sem I/O, sem Date.now() — 'agora' é injetado.
// Consumido pelo server (/api/n1/sequenciar) e pelo golden test.
//
// Modelo:
//   ordem   = { id, numero, codigo, qtd, prioridade (0-100), due (ms|null),
//               procMinBase (min p/ eficiência 100%), attrs {galga,cor_base,...} }
//   recurso = { id, nome, eficiencia (0-100), attrsIniciais {…}|null,
//               livreEm (ms), indisponivel (bool) }
//   calendario = { janelas: [{iniMin, fimMin}] }  → minutos DISPONÍVEIS a partir
//               de 'agora', em ordem, não sobrepostos (o chamador monta a partir
//               de dias úteis/jornada/manutenção). Motor só anda dentro delas.
//   setup   = { transicao: Map('attr|de|para' → min), porAtributo: Map('attr' → min) }
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

// setup de A → B: soma, por atributo que MUDOU, o tempo da transição direcional;
// par ausente cai no tempo genérico do atributo; atributo vazio não gera custo.
function lookupSetup(deAttrs, paraAttrs, setup) {
    let total = 0;
    const de = deAttrs || {}, para = paraAttrs || {};
    for (const k of Object.keys(para)) {
        const vDe = de[k], vPara = para[k];
        if (!vPara || !vDe || String(vDe) === String(vPara)) continue;   // sem dado ou sem troca = sem custo
        const dir = setup.transicao.get(`${k}|${vDe}|${vPara}`);
        total += dir != null ? dir : (setup.porAtributo.get(k) || 0);
    }
    return total;
}

function criticalRatio(ordem, agoraMs) {
    if (ordem.due == null) return 9.99;                                   // sem prazo: neutro (não urgente)
    const disponivelMin = (ordem.due - agoraMs) / 60000;
    return disponivelMin / Math.max(ordem.procMinBase, 1);                // <1 = não dá sem intervenção
}

// menor índice = mais atrativa (urgência CR + custo de troca normalizado)
function indiceComposto(ordem, estadoAttrs, agoraMs, setup, pesos, maxSetup) {
    const cr = Math.max(-10, Math.min(10, criticalRatio(ordem, agoraMs))); // clamp p/ não dominar tudo
    const s = lookupSetup(estadoAttrs, ordem.attrs, setup);
    const sNorm = maxSetup > 0 ? s / maxSetup : 0;
    return pesos.urgencia * cr + pesos.setup * sNorm;
}

// avança 'durMin' minutos DENTRO das janelas disponíveis; retorna {ini, fim} em ms.
// aPartirMs pode cair fora de janela → início pula para a próxima janela.
function encaixarNoCalendario(aPartirMs, durMin, janelas) {
    let restante = durMin, ini = null, cursor = aPartirMs;
    for (const j of janelas) {
        if (j.fimMs <= cursor) continue;
        const inicioJanela = Math.max(j.iniMs, cursor);
        if (ini == null) ini = inicioJanela;
        const capMin = (j.fimMs - inicioJanela) / 60000;
        if (capMin >= restante) return { ini, fim: inicioJanela + restante * 60000 };
        restante -= capMin;
        cursor = j.fimMs;
    }
    // calendário esgotado: agenda além da última janela (o chamador avisa)
    const base = ini != null ? ini : aPartirMs;
    return { ini: base, fim: (janelas.length ? Math.max(janelas[janelas.length - 1].fimMs, aPartirMs) : aPartirMs) + restante * 60000, estourouCalendario: true };
}

const desempate = (a, b) => String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true });

/**
 * O loop do motor (§3 do spec). Retorna { alocacoes, kpis, avisos }.
 * alocacao = { ordem, recurso, iniMs, fimMs, setupMin, procMin, posicao }
 */
function sequenciar({ pool, recursos, setup, janelas, agoraMs, pesos = { urgencia: 0.7, setup: 0.3 }, pretoCorte = 95 }) {
    const avisos = [];
    const rs = recursos.filter(r => !r.indisponivel);
    if (!rs.length) return { alocacoes: [], kpis: null, avisos: ['Nenhum recurso disponível.'] };
    const estado = {};   // recursoId → { attrs, livreEm }
    rs.forEach(r => { estado[r.id] = { attrs: r.attrsIniciais || null, livreEm: Math.max(r.livreEm || agoraMs, agoraMs) }; });

    const maxSetup = Math.max(1, ...[...setup.transicao.values()], ...[...setup.porAtributo.values()], 0);
    // ordenação estável e determinística do pool
    const pendentes = [...pool].sort((a, b) => (b.prioridade - a.prioridade) || desempate(a, b));
    const fixas = pendentes.filter(o => o.prioridade >= pretoCorte);      // PRETO: ruptura não compete com setup
    let livres = pendentes.filter(o => o.prioridade < pretoCorte);

    const alocacoes = [];
    const aloca = (ordem, r) => {
        const st = estado[r.id];
        const setupMin = lookupSetup(st.attrs, ordem.attrs, setup);
        const procMin = ordem.procMinBase / ((r.eficiencia || 100) / 100);
        const enc = encaixarNoCalendario(Math.max(st.livreEm, agoraMs), setupMin + procMin, janelas);
        if (enc.estourouCalendario) avisos.push(`Calendário esgotado ao alocar ${ordem.numero} — plano segue além da janela informada.`);
        st.attrs = { ...(st.attrs || {}), ...(ordem.attrs || {}) };
        st.livreEm = enc.fim;
        alocacoes.push({ ordem, recurso: r, iniMs: enc.ini, fimMs: enc.fim, setupMin, procMin });
    };

    const podeIr = (o, r) => !o.compativeis || o.compativeis.has(r.id);
    // PRETO primeiro: no recurso que TERMINA antes (determinístico; empate por id)
    for (const o of fixas) {
        let melhor = null, melhorFim = Infinity;
        for (const r of rs) {
            if (!podeIr(o, r)) continue;
            const st = estado[r.id];
            const sMin = lookupSetup(st.attrs, o.attrs, setup);
            const pMin = o.procMinBase / ((r.eficiencia || 100) / 100);
            const enc = encaixarNoCalendario(Math.max(st.livreEm, agoraMs), sMin + pMin, janelas);
            if (enc.fim < melhorFim || (enc.fim === melhorFim && melhor && String(r.id) < String(melhor.id))) { melhor = r; melhorFim = enc.fim; }
        }
        if (!melhor) { melhor = rs[0]; avisos.push(`${o.numero}: nenhum tear compatível (galga) — alocada em ${melhor.nome} com ressalva.`); }
        aloca(o, melhor);
    }

    // gulosas: menor índice composto entre todos os pares (ordem × recurso).
    // Urgência (CR) é da ORDEM (relógio global) — o recurso entra pelo custo de
    // setup e pelo desempate por término mais cedo (senão o guloso empilharia
    // tudo no mesmo tear: CR calculado no livre_em do recurso favorece o ocupado).
    while (livres.length) {
        let best = null;
        for (const o of livres) for (const r of rs) {
            if (!podeIr(o, r)) continue;
            const st = estado[r.id];
            const idx = indiceComposto(o, st.attrs, agoraMs, setup, pesos, maxSetup);
            const sMin = lookupSetup(st.attrs, o.attrs, setup);
            const fimEst = Math.max(st.livreEm, agoraMs) + (sMin + o.procMinBase / ((r.eficiencia || 100) / 100)) * 60000;
            if (!best || idx < best.idx - 1e-9 ||
                (Math.abs(idx - best.idx) <= 1e-9 && (fimEst < best.fimEst - 1 ||
                    (Math.abs(fimEst - best.fimEst) <= 1 && (desempate(o, best.o) < 0 || (desempate(o, best.o) === 0 && String(r.id) < String(best.r.id))))))) {
                best = { o, r, idx, fimEst };
            }
        }
        if (!best) { const o = livres[0]; avisos.push(`${o.numero}: nenhum tear compatível (galga) — alocada em ${rs[0].nome} com ressalva.`); best = { o, r: rs[0], fimEst: 0 }; }
        aloca(best.o, best.r);
        livres = livres.filter(x => x !== best.o);
    }

    // posições por recurso (ordem de início) + KPIs
    const porRecurso = {};
    alocacoes.forEach(a => { (porRecurso[a.recurso.id] = porRecurso[a.recurso.id] || []).push(a); });
    Object.values(porRecurso).forEach(lista => lista.sort((a, b) => a.iniMs - b.iniMs).forEach((a, i) => { a.posicao = i + 1; }));

    const atrasadas = alocacoes.filter(a => a.ordem.due != null && a.fimMs > a.ordem.due);
    const kpis = {
        setup_total_min: Math.round(alocacoes.reduce((s, a) => s + a.setupMin, 0) * 10) / 10,
        ordens_atrasadas: atrasadas.length,
        atraso_max_min: Math.round(Math.max(0, ...atrasadas.map(a => (a.fimMs - a.ordem.due) / 60000)) * 10) / 10,
        makespan_min: alocacoes.length ? Math.round((Math.max(...alocacoes.map(a => a.fimMs)) - agoraMs) / 60000 * 10) / 10 : 0,
        utilizacao_gargalo_pct: null,   // preenchido pelo chamador (precisa da janela total por recurso)
    };
    return { alocacoes, kpis, avisos };
}

module.exports = { sequenciar, lookupSetup, criticalRatio, indiceComposto, encaixarNoCalendario };
