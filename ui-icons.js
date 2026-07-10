// ═══ Ícones do sistema — traço 1.8, monocromáticos (herdam currentColor) ═══
// Uso: icon('fabrica')  →  string SVG inline com class="icon".
// icon('alerta','icon lg')  →  classe customizada.
// Fonte única de iconografia dos 4 sistemas — não usar emoji em UI nova.
(function () {
    const P = {
        // fábrica / produção
        fabrica:   '<path d="M2 20V9l6 4V9l6 4V4h8v16Z"/><path d="M17 8h.01M17 12h.01M17 16h.01"/>',
        tear:      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 5v14M12 5v14M17 5v14"/>',
        fio:       '<circle cx="12" cy="12" r="8"/><path d="M12 4c-3 2.5-3 13.5 0 16M12 4c3 2.5 3 13.5 0 16M4.5 9h15M4.5 15h15"/>',
        costura:   '<path d="M4 17c4-1 6-3 8-8 1.5-3.5 4-4 6-3"/><path d="m14 5 4 4M6 15l3 3"/><circle cx="19" cy="5" r="1.6"/>',
        pacote:    '<path d="m3 7 9-4 9 4v10l-9 4-9-4Z"/><path d="m3 7 9 4 9-4M12 11v10"/>',
        // pessoas / tempo
        pessoas:   '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16.5 4.6a3.2 3.2 0 0 1 0 6.3M18.5 14.9c2 .8 3.5 2.6 3.5 5.1"/>',
        relogio:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
        calendario:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
        // estados / análise
        gauge:     '<path d="M4 14a8 8 0 1 1 16 0"/><path d="m12 14 4-4"/><path d="M4 19h16"/>',
        alerta:    '<path d="M12 3 2 20h20Z"/><path d="M12 9v5M12 17h.01"/>',
        tendencia: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
        pulso:     '<path d="M3 12h4l2.5-7 5 14 2.5-7h4"/>',
        gargalo:   '<path d="M7 3h10M7 21h10M8 3c0 5 3 5.5 3 8s-3 3-3 10M16 3c0 5-3 5.5-3 8s3 3 3 10"/>',
        cerebro:   '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3c1.2 0 2.2-.6 3-1.5.8.9 1.8 1.5 3 1.5a3 3 0 0 0 3-3 3 3 0 0 0 2-5 3 3 0 0 0-2-5 3 3 0 0 0-3-3c-1.2 0-2.2.6-3 1.5C11.2 4.6 10.2 4 9 4Z"/><path d="M12 5.5v13"/>',
        // ações / navegação
        baixar:    '<path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5"/><path d="M4 19h16"/>',
        config:    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
        seta:      '<path d="M5 12h14m0 0-5.5-5.5M19 12l-5.5 5.5"/>',
        check:     '<path d="m4.5 12.5 5 5 10-11"/>',
        x:         '<path d="m5 5 14 14M19 5 5 19"/>',
        olho:      '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
        camadas:   '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
        grafico:   '<path d="M4 20V10M10 20V4M16 20v-8M21 20H3"/>',
        moeda:     '<circle cx="12" cy="12" r="9"/><path d="M15 9c-.6-1-1.7-1.5-3-1.5-1.8 0-3 1-3 2.2 0 3 6 1.6 6 4.6 0 1.2-1.2 2.2-3 2.2-1.3 0-2.4-.5-3-1.5M12 5.5v13"/>',
    };
    window.iconNames = Object.keys(P);   // p/ galeria do styleguide
    window.icon = function (nome, cls) {
        const d = P[nome];
        if (!d) return '';
        return `<svg class="${cls || 'icon'}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
    };
    // números que contam: anima um elemento de 0 → valor (respeita prefers-reduced-motion)
    window.contarAte = function (el, valor, opts = {}) {
        if (!el) return;
        const fmt = opts.fmt || (v => Math.round(v).toLocaleString('pt-BR'));
        if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(valor); return; }
        const dur = opts.dur || 900, ini = performance.now();
        const tick = t => {
            const p = Math.min(1, (t - ini) / dur), ease = 1 - Math.pow(1 - p, 3);
            el.textContent = fmt(valor * ease);
            if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };
    // ── Mapa da fábrica: renderer compartilhado (Cockpit e Modo TV) ──
    const ICONE_ETAPA = [[/tecel/i,'tear'],[/costura/i,'costura'],[/solda/i,'config'],[/silicone/i,'fio'],
        [/passad/i,'gauge'],[/revis/i,'olho'],[/embal/i,'pacote']];
    const ESTADO_ROTULO = { rodando: ['RODANDO','badge--ok'], fila: ['FILA PARADA','badge--warn'],
        andon: ['ANDON','badge--bad'], parada: ['SEM ATIVIDADE','badge--dim'] };
    window.renderMapaFabrica = function (el, etapas) {
        if (!el) return;
        const esc2 = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        el.innerHTML = `<div class="mapa-fab">` + (etapas || []).map((e, i) => {
            const ic = (ICONE_ETAPA.find(([re]) => re.test(e.nome)) || [null, 'fabrica'])[1];
            const [rot, cls] = ESTADO_ROTULO[e.estado] || ESTADO_ROTULO.parada;
            return (i ? `<div class="mapa-seta">${icon('seta', 'icon sm')}</div>` : '') + `
            <div class="mapa-est mapa-est--${e.estado}" title="${esc2(e.nome)}: ${rot}">
                <span class="mapa-est__badge badge ${cls}">${rot}</span>
                ${icon(ic)}
                <div class="mapa-est__nome">${esc2(e.nome)}</div>
                <div class="mapa-est__dados">
                    <b>${e.wip}</b> OP${e.wip === 1 ? '' : 's'} na fila<br>
                    <b>${e.sessoes}</b> sess${e.sessoes === 1 ? 'ão ativa' : 'ões ativas'}<br>
                    <b>${e.maquinas}</b> máq${e.pessoas ? ` · <b>${e.pessoas}</b> pessoas` : ''}</div>
            </div>`;
        }).join('') + `</div>`;
    };
})();
