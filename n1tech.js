// ═══════════════════════════════════════════════════════════════════════════
// N1Tech — Planejamento & Sequenciamento (PP + TOC-pull + APS)
// 4º sistema, independente do SIGS (app.js), MES (mes.js) e APS (aps.js).
// Compartilha só o servidor, o Supabase e o tema (style.css).
//
// Princípio-mestre do spec: NENHUM processo chama outro — a comunicação é
// escrita/leitura em tabela. As telas aqui são consumidoras dessas tabelas.
// Build por fases com gate: F0 (dados mestres) → F1 (laço PULL) → F2 (planejamento)
// → F3 (Preactor plugável). Esta é a casca (shell) — engine entra por fase.
// ═══════════════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const escJS = s => esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const fmtData = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const TOKEN_KEY = 'sin1_token';
const fmt = n => (Number(n) || 0).toLocaleString('pt-BR');
const fmt1 = n => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function toast(msg, tipo = 'ok') {
    let el = $('n1-toast');
    if (!el) { el = document.createElement('div'); el.id = 'n1-toast';
        el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2000;padding:11px 20px;border-radius:8px;font-size:.84rem;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,.4);transition:opacity .3s;';
        document.body.appendChild(el); }
    const cor = tipo === 'erro' ? '#f06292' : tipo === 'aviso' ? '#ffab76' : '#26a69a';
    el.style.background = 'rgba(18,22,32,.96)'; el.style.border = `1px solid ${cor}`; el.style.color = cor;
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 3200);
}

const api = {
    _h() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') }; },
    async get(url) { try { const r = await fetch(url, { headers: this._h() }); if (r.status === 401) return n1._expirou(); return r.ok ? r.json() : null; } catch { return null; } },
    async post(url, b) { try { const r = await fetch(url, { method: 'POST', headers: this._h(), body: JSON.stringify(b) }); if (r.status === 401) return n1._expirou(); return r.json().catch(() => null); } catch { return null; } },
    async put(url, b) { try { const r = await fetch(url, { method: 'PUT', headers: this._h(), body: JSON.stringify(b) }); if (r.status === 401) return n1._expirou(); return r.json().catch(() => null); } catch { return null; } },
};

function toggleNavSection(h3) {
    const s = h3.closest('.nav-section'); if (!s) return;
    s.classList.toggle('nav-section-collapsed');
    localStorage.setItem('nav-sec-' + (h3.dataset.key || 'sec'), s.classList.contains('nav-section-collapsed') ? '1' : '0');
}

// Rótulos de fase de cada bloco (o que já existe × o que falta construir)
const FASE = {
    shell: { label: 'shell', cor: '#8b949e' },
    F0:    { label: 'F0 — a construir', cor: '#ffab76' },
    F1:    { label: 'F1 — a construir', cor: '#ffca28' },
    F2:    { label: 'F2 — a construir', cor: '#26c6da' },
    F3:    { label: 'F3 — condicional', cor: '#7c4dff' },
};

const n1 = {
    _tab: 'painel',

    async init() {
        document.querySelectorAll('.nav-section-header[data-key]').forEach(h3 => {
            if (localStorage.getItem('nav-sec-' + h3.dataset.key) === '1') h3.closest('.nav-section')?.classList.add('nav-section-collapsed');
        });
        // login por link: ?token=... · deep-link: ?tab=pulmoes
        const qs = new URLSearchParams(location.search);
        const urlTok = qs.get('token');
        this._tabInicial = qs.get('tab') || null;
        if (urlTok) { localStorage.setItem(TOKEN_KEY, urlTok); try { history.replaceState({}, document.title, location.pathname); } catch {} }

        if (!localStorage.getItem(TOKEN_KEY)) return this._mostrarLogin();
        const ok = await this._auth();
        if (ok === false) return this._mostrarLogin();
        this._mostrarApp();
        if (this._tabInicial) { try { this.tab(this._tabInicial); } catch {} }
    },

    // valida a sessão com uma leitura leve (não escreve nada em lugar nenhum)
    async _auth() {
        const r = await api.get('/api/processos-config');
        return r !== null && r !== false;
    },

    _mostrarLogin() {
        $('view-login').style.display = 'flex';
        $('app-sidebar').style.display = 'none';
        $('view-n1').style.display = 'none';
        $('login-status').style.display = 'none';
        $('login-form-wrap').style.display = 'block';
        const form = $('login-form');
        form.onsubmit = async (e) => {
            e.preventDefault();
            const btn = $('login-submit'), er = $('login-erro');
            if (btn?.disabled) return;
            if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
            if (er) er.style.display = 'none';
            try {
                const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ email: $('login-email').value, senha: $('login-senha').value }) });
                const d = await r.json().catch(() => ({}));
                if (r.ok && d.token) { localStorage.setItem(TOKEN_KEY, d.token); if (d.usuario) localStorage.setItem('sin1_usuario', JSON.stringify(d.usuario)); location.reload(); return; }
                if (er) { er.style.display = 'block'; er.textContent = d.erro || 'Falha no login'; }
            } catch {
                if (er) { er.style.display = 'block'; er.textContent = 'Sem conexão com o servidor. Tente de novo.'; }
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
            }
        };
    },

    _mostrarApp() {
        $('view-login').style.display = 'none';
        $('app-sidebar').style.display = 'flex';
        $('view-n1').style.display = 'flex';
        try { const nm = JSON.parse(localStorage.getItem('sin1_usuario'))?.nome || '';
            $('n1-user').textContent = nm; const sn = $('n1-user-nome'); if (sn) sn.textContent = nm || '—'; } catch {}
        this.tab('painel');
    },

    _expirou() { localStorage.removeItem(TOKEN_KEY); toast('Sessão expirada — faça login.', 'erro'); this._mostrarLogin(); return null; },
    sair() { localStorage.removeItem(TOKEN_KEY); location.reload(); },

    tab(nome) {
        this._tab = nome;
        ['painel','pulmoes','sugeridas','netting','gargalo','fila','pwa','apont','kpi','dbm','tempos','politica','estoque','kardex','inventario','reconc','expedicao','roteiros','tcad','setup','bom'].forEach(t => {
            const pan = $('n1-pan-' + t); if (pan) pan.style.display = t === nome ? 'block' : 'none';
        });
        document.querySelectorAll('[data-n1tab]').forEach(li => li.classList.toggle('active', li.dataset.n1tab === nome));
        const R = { painel:'_renderPainel', roteiros:'_renderRoteiros', tcad:'_renderTempos', setup:'_renderSetup', bom:'_renderBom',
            pulmoes:'_renderPulmoes', sugeridas:'_renderSugeridas', fila:'_renderFila', pwa:'_renderPwa', kpi:'_renderKpi', dbm:'_renderDbm',
            politica:'_renderPolitica', netting:'_renderNetting', gargalo:'_renderGargalo', estoque:'_renderEstoque', kardex:'_renderKardex', inventario:'_renderInventario', reconc:'_renderReconc', expedicao:'_renderExpedicao' };
        if (R[nome]) this[R[nome]]();
        else this._placeholder(nome);
    },

    // ═══ ESTOQUE F1 — posição viva (âncora ERP + movimentos) e kardex ═══
    _estq(v) { const n = Number(v) || 0; return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }); },
    async _renderEstoque() {
        const el = $('n1-pan-estoque'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando posição viva…</div>';
        const q = this._estoqueBusca || '';
        const d = await this._getOu503('/api/n1/estoque' + (q ? '?q=' + encodeURIComponent(q) : ''), el, 'A posição viva usa estoque_movimento (n1_estoque.sql).'); if (!d) return;
        const r = d.resumo || {};
        const linhas = (d.itens || []).slice(0, 300).map(i => `<tr>
            <td style="font-weight:700;color:var(--indigo-primary);">${esc(i.codigo)}</td>
            <td class="num dim">${this._estq(i.disponivel_ancora)}</td>
            <td class="num" style="font-weight:700;color:${i.delta_mov > 0 ? 'var(--ok)' : i.delta_mov < 0 ? 'var(--bad)' : 'var(--text-dim)'};">${i.delta_mov ? (i.delta_mov > 0 ? '+' : '') + this._estq(i.delta_mov) : '—'}</td>
            <td class="num dim">${this._estq(i.wip)}</td>
            <td class="num" style="font-weight:800;">${this._estq(i.posicao)}</td>
            <td class="dim" style="font-size:.72rem;">${i.ult_mov ? fmtData(i.ult_mov) : '—'}</td>
            <td><button class="btn ghost sm" onclick="n1._ajustar('${escJS(i.codigo)}', ${Number(i.disponivel) || 0})">ajustar</button></td>
        </tr>`).join('');
        el.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
            <div class="kpi kpi--info"><div class="kpi__head">${icon('pacote')} CÓDIGOS</div><div class="kpi__value">${fmt(r.total)}</div><div class="kpi__sub">com posição ou movimento</div></div>
            <div class="kpi ${r.com_movimento ? 'kpi--ok' : ''}"><div class="kpi__head">${icon('pulso')} COM MOVIMENTO</div><div class="kpi__value">${fmt(r.com_movimento)}</div><div class="kpi__sub">desde a âncora do ERP</div></div>
            <div class="kpi kpi--ok"><div class="kpi__head">${icon('tendencia')} ENTRADAS</div><div class="kpi__value">+${this._estq(r.delta_entradas)}</div><div class="kpi__sub">produção apontada</div></div>
            <div class="kpi ${r.delta_saidas < 0 ? 'kpi--warn' : ''}"><div class="kpi__head">${icon('fio')} CONSUMOS</div><div class="kpi__value">${this._estq(r.delta_saidas)}</div><div class="kpi__sub">fio via BOM + ajustes</div></div>
        </div>
        <div class="summary-card" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <input id="n1-estq-q" class="n1-input" placeholder="buscar código…" value="${esc(q)}" style="max-width:220px;" onkeydown="if(event.key==='Enter'){n1._estoqueBusca=this.value;n1._renderEstoque();}">
            <button class="btn secondary sm" onclick="n1._estoqueBusca=$('n1-estq-q').value;n1._renderEstoque()">Buscar</button>
            <span style="font-size:var(--fs-caption);color:var(--text-dim);">posição viva = âncora (importação do ERP${r.ancora ? ' em ' + fmtData(r.ancora) : ''}) + movimentos do chão · reimportar o estoque re-ancora</span>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:56vh;overflow-y:auto;">
            <table class="data-table"><thead><tr><th>Código</th><th class="num">Âncora (ERP)</th><th class="num">Δ movimentos</th><th class="num">WIP</th><th class="num">Posição viva</th><th>Última mov.</th><th></th></tr></thead>
            <tbody>${linhas || '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:20px;">Nada encontrado.</td></tr>'}</tbody></table>
        </div></div>`;
    },
    async _ajustar(codigo, atual) {
        const contado = prompt(`Inventário de ${codigo}\n\nPosição no sistema: ${atual}\nQuantidade CONTADA fisicamente:`, atual);
        if (contado == null) return;
        const motivo = prompt('Motivo do ajuste (obrigatório):', 'contagem cíclica');
        if (!motivo) return;
        const r = await api.post('/api/n1/estoque/ajuste', { codigo, contado: Number(contado), motivo });
        if (!r?.ok) return toast(r?.erro || 'Erro no ajuste.', 'erro');
        toast(r.delta === 0 ? 'Contagem igual à posição — nada a ajustar.' : `✓ Ajuste registrado: ${r.delta > 0 ? '+' : ''}${r.delta} (${r.de} → ${r.para}).`);
        this._renderEstoque();
    },
    async _renderKardex() {
        const el = $('n1-pan-kardex'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando kardex…</div>';
        const cod = this._kardexCod || '';
        const d = await this._getOu503('/api/n1/kardex' + (cod ? '?codigo=' + encodeURIComponent(cod) : ''), el, 'O kardex é a tabela estoque_movimento (n1_estoque.sql).'); if (!d) return;
        const TIPO = { entrada_producao: ['entrada produção', 'badge--ok'], consumo_mp: ['consumo fio (BOM)', 'badge--info'],
            ajuste_inventario: ['ajuste inventário', 'badge--warn'], entrada_manual: ['entrada manual', 'badge--dim'], saida_expedicao: ['saída expedição', 'badge--dim'] };
        const linhas = (d || []).map(m => { const [rot, cls] = TIPO[m.tipo] || [m.tipo, 'badge--dim'];
            return `<tr>
            <td class="dim" style="white-space:nowrap;">${new Date(m.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td><span class="badge ${cls}">${rot}</span></td>
            <td style="font-weight:700;color:var(--indigo-primary);">${esc(m.codigo)}</td>
            <td class="num" style="font-weight:800;color:${m.delta > 0 ? 'var(--ok)' : 'var(--bad)'};">${m.delta > 0 ? '+' : ''}${this._estq(m.delta)}</td>
            <td class="dim">${m.op_numero ? 'OP ' + esc(m.op_numero) : '—'}</td>
            <td class="dim" style="font-size:.74rem;">${esc(m.motivo || '')}</td>
            <td class="dim" style="font-size:.74rem;">${esc(m.usuario_nome || 'sistema')}</td>
        </tr>`; }).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <div class="sec-title" style="margin:0;flex:1;">${icon('camadas')} Kardex <span class="hint">todo movimento é uma linha imutável — ninguém edita saldo</span></div>
            <input id="n1-kdx-q" class="n1-input" placeholder="filtrar por código…" value="${esc(cod)}" style="max-width:200px;" onkeydown="if(event.key==='Enter'){n1._kardexCod=this.value;n1._renderKardex();}">
            <button class="btn secondary sm" onclick="n1._kardexCod=$('n1-kdx-q').value;n1._renderKardex()">Filtrar</button>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:62vh;overflow-y:auto;">
            <table class="data-table"><thead><tr><th>Quando</th><th>Tipo</th><th>Código</th><th class="num">Δ</th><th>Origem</th><th>Motivo</th><th>Quem</th></tr></thead>
            <tbody>${linhas || '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:24px;">Nenhum movimento ainda — eles nascem quando o chão fecha sessões de apontamento (entrada de produção e consumo de fio via BOM) ou em ajustes de inventário.</td></tr>'}</tbody></table>
        </div></div>`;
    },

    // ═══ ESTOQUE F2 — inventário cíclico (ABC) e acuracidade (reconciliação) ═══
    async _renderInventario() {
        const el = $('n1-pan-inventario'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando inventário…</div>';
        const d = await this._getOu503('/api/n1/inventario', el); if (!d) return;
        const r = d.resumo || {};
        const ABC = { A: 'badge--bad', B: 'badge--warn', C: 'badge--dim' };
        const linhas = (d.itens || []).slice(0, 250).map(i => `<tr>
            <td style="font-weight:700;color:var(--indigo-primary);">${esc(i.codigo)}</td>
            <td><span class="badge ${ABC[i.abc]}">${esc(i.abc)}</span> <span class="dim" style="font-size:.68rem;">a cada ${i.freq_dias}d</span></td>
            <td class="num" style="font-weight:700;">${this._estq(i.posicao)}</td>
            <td class="dim">${i.ultima_contagem ? fmtData(i.ultima_contagem) + ` (${i.dias_desde}d)` : 'nunca contado'}</td>
            <td>${i.vencido ? '<span class="badge badge--warn">contar</span>' : '<span class="badge badge--ok">em dia</span>'}</td>
            <td><button class="btn ${i.vencido ? 'secondary' : 'ghost'} sm" onclick="n1._ajustar('${escJS(i.codigo)}', ${Number(i.disponivel) || 0})">contar</button></td>
        </tr>`).join('');
        el.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
            <div class="kpi ${r.vencidos ? 'kpi--warn' : 'kpi--ok'}"><div class="kpi__head">${icon('calendario')} A CONTAR</div><div class="kpi__value">${fmt(r.vencidos)}</div><div class="kpi__sub">vencidos pela frequência ABC</div></div>
            <div class="kpi ${r.vencidos_a ? 'kpi--bad' : ''}"><div class="kpi__head">${icon('alerta')} CLASSE A</div><div class="kpi__value">${fmt(r.vencidos_a)}</div><div class="kpi__sub">semanais (7d) — prioridade</div></div>
            <div class="kpi"><div class="kpi__head">${icon('camadas')} CLASSE B</div><div class="kpi__value">${fmt(r.vencidos_b)}</div><div class="kpi__sub">mensais (30d)</div></div>
            <div class="kpi"><div class="kpi__head">${icon('pacote')} CLASSE C</div><div class="kpi__value">${fmt(r.vencidos_c)}</div><div class="kpi__sub">trimestrais (90d)</div></div>
        </div>
        <div class="summary-card" style="margin-bottom:12px;">
            <span style="font-size:var(--fs-caption);color:var(--text-dim);">Contagem cíclica guiada pelo ABC${r.ciclo_abc ? ' (ciclo ' + esc(r.ciclo_abc) + ')' : ''}: classe A a cada 7 dias, B a cada 30, C a cada 90. "Contar" pede a quantidade física e registra o ajuste no kardex com motivo — ninguém edita saldo.</span>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:58vh;overflow-y:auto;">
            <table class="data-table"><thead><tr><th>Código</th><th>Classe</th><th class="num">Posição viva</th><th>Última contagem</th><th>Status</th><th></th></tr></thead>
            <tbody>${linhas || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:20px;">Nada a contar.</td></tr>'}</tbody></table>
        </div></div>`;
    },
    async _renderReconc() {
        const el = $('n1-pan-reconc'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando acuracidade…</div>';
        const d = await this._getOu503('/api/n1/reconciliacao', el, 'A reconciliação grava em estoque_reconciliacao (n1_estoque2.sql).'); if (!d) return;
        if (!d.ultima) { el.innerHTML = `<div class="summary-card"><div class="sec-title">${icon('gauge')} Acuracidade (IRA)</div>
            <p style="font-size:var(--fs-body);color:var(--text-dim);">Nenhuma reconciliação ainda — ela roda sozinha na próxima vez que o estoque for <strong>reimportado</strong> (SIGS › Estoque) ou que o ETL sincronizar (05:00): o sistema compara o que calculou com o que o ERP trouxe e registra as divergências aqui.</p></div>`; return; }
        const linhas = (d.divergencias || []).map(x => `<tr>
            <td style="font-weight:700;color:var(--indigo-primary);">${esc(x.codigo)}</td>
            <td class="num">${this._estq(x.sistema)}</td>
            <td class="num">${this._estq(x.erp)}</td>
            <td class="num" style="font-weight:800;color:${x.divergencia > 0 ? 'var(--warn)' : 'var(--bad)'};">${x.divergencia > 0 ? '+' : ''}${this._estq(x.divergencia)}</td>
        </tr>`).join('');
        const hist = (d.historico || []).map(h => `<tr><td class="dim">${new Date(h.executado_em).toLocaleString('pt-BR')}</td><td class="num">${fmt(h.divergentes)}</td><td class="num dim">${this._estq(h.soma_abs)}</td></tr>`).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;border-left:3px solid var(--indigo-primary);">
            <div class="sec-title">${icon('gauge')} Acuracidade — última reconciliação <span class="hint">${new Date(d.ultima).toLocaleString('pt-BR')}</span></div>
            <p style="font-size:var(--fs-caption);color:var(--text-dim);">divergência = o que o sistema calculava − o que o ERP trouxe. <strong>Registre as saídas na aba Expedição</strong> — com entrada (produção), consumo (BOM) e saída no kardex, a divergência passa a indicar erro real (apontamento errado, perda, furo de contagem).</p>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:54vh;overflow-y:auto;">
                <table class="data-table"><thead><tr><th>Código</th><th class="num">Sistema</th><th class="num">ERP</th><th class="num">Divergência</th></tr></thead>
                <tbody>${linhas || '<tr><td colspan="4" style="text-align:center;color:var(--ok);padding:20px;">Nenhuma divergência — 100% de acuracidade nesta rodada ✓</td></tr>'}</tbody></table>
            </div></div>
            <div class="summary-card" style="padding:0;overflow:hidden;">
                <div class="s-label" style="padding:12px 14px 0;">HISTÓRICO DE RODADAS</div>
                <table class="data-table"><thead><tr><th>Quando</th><th class="num">Divergentes</th><th class="num">Σ |div|</th></tr></thead>
                <tbody>${hist}</tbody></table>
            </div>
        </div>`;
    },

    // ═══ ESTOQUE F3 — expedição: a saída entra no kardex (IRA vira estrito) ═══
    async _renderExpedicao() {
        const el = $('n1-pan-expedicao'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando expedição…</div>';
        const ult = await this._getOu503('/api/n1/kardex?tipo=saida_expedicao&limit=100', el); if (!ult) return;
        const linhas = (ult || []).map(m => `<tr>
            <td class="dim" style="white-space:nowrap;">${new Date(m.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td style="font-weight:700;color:var(--indigo-primary);">${esc(m.codigo)}</td>
            <td class="num" style="font-weight:800;color:var(--bad);">${this._estq(m.delta)}</td>
            <td class="dim">${esc(m.motivo || '')}</td>
            <td class="dim" style="font-size:.74rem;">${esc(m.usuario_nome || '')}</td>
        </tr>`).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;border-left:3px solid var(--indigo-primary);">
            <div class="sec-title">${icon('pacote')} Expedição <span class="hint">a saída entra no kardex — a posição cai na hora e a acuracidade (IRA) fica estrita</span></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:6px;">
                <div><span class="n1-label">CÓDIGO</span><input id="n1-exp-cod" class="n1-input" placeholder="ex: 12303" style="width:130px;"></div>
                <div><span class="n1-label">QTD</span><input id="n1-exp-qtd" type="number" min="1" class="n1-input" style="width:90px;text-align:right;"></div>
                <div style="flex:1;min-width:160px;"><span class="n1-label">REFERÊNCIA (NF / romaneio)</span><input id="n1-exp-ref" class="n1-input" placeholder="opcional"></div>
                <button class="btn primary" style="font-size:.78rem;" onclick="n1._expedirUma()">Registrar saída</button>
            </div>
        </div>
        <div class="summary-card" style="margin-bottom:12px;">
            <div class="s-label" style="margin-bottom:6px;">EM MASSA (colar do Excel: código · qtd · referência)</div>
            <textarea id="n1-exp-cola" class="n1-input" rows="4" placeholder="12303&#9;50&#9;NF 1234&#10;12603&#9;120&#9;NF 1234"></textarea>
            <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
                <button class="btn secondary sm" onclick="n1._expedirMassa(false)">Pré-visualizar</button>
                <button class="btn primary sm" onclick="n1._expedirMassa(true)">Expedir</button>
                <span id="n1-exp-prev" style="font-size:.74rem;color:var(--text-dim);"></span>
            </div>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;">
            <div class="s-label" style="padding:12px 14px 0;">ÚLTIMAS SAÍDAS</div>
            <div style="max-height:44vh;overflow-y:auto;"><table class="data-table">
                <thead><tr><th>Quando</th><th>Código</th><th class="num">Δ</th><th>Referência</th><th>Quem</th></tr></thead>
                <tbody>${linhas || '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:20px;">Nenhuma expedição registrada ainda.</td></tr>'}</tbody>
            </table></div>
        </div>`;
    },
    _expParse() {
        const txt = $('n1-exp-cola')?.value || '';
        return txt.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => {
            const p = l.split(/\t|;/).map(x => x.trim());
            return { codigo: p[0], qtd: parseFloat(String(p[1] || '0').replace(',', '.')) || 0, ref: p[2] || '' };
        }).filter(x => x.codigo && x.qtd > 0);
    },
    async _expedirUma() {
        const codigo = $('n1-exp-cod')?.value?.trim(), qtd = parseFloat($('n1-exp-qtd')?.value), ref = $('n1-exp-ref')?.value?.trim();
        if (!codigo || !(qtd > 0)) return toast('Preencha código e quantidade.', 'aviso');
        const prev = await api.post('/api/n1/expedicao', { linhas: [{ codigo, qtd, ref }], confirmar: false });
        if (!prev?.ok) return toast(prev?.erro || 'Erro.', 'erro');
        const p = prev.linhas[0];
        const msg = p.conhecido ? `Saída de ${qtd} de ${codigo.toUpperCase()} (disponível ${p.disponivel} → ${p.ficara}${p.negativo ? ' ⚠ NEGATIVO' : ''}).\n\nConfirmar?`
            : `${codigo.toUpperCase()} não tem posição no sistema — a saída deixará o saldo negativo.\n\nConfirmar mesmo assim?`;
        if (!confirm(msg)) return;
        const r = await api.post('/api/n1/expedicao', { linhas: [{ codigo, qtd, ref }], confirmar: true });
        if (!r?.ok) return toast(r?.erro || 'Erro.', 'erro');
        toast('✓ Saída registrada no kardex.');
        (r.avisos || []).forEach(a => setTimeout(() => toast('⚠ ' + a, 'aviso'), 1200));
        this._renderExpedicao();
    },
    async _expedirMassa(confirmar) {
        const linhas = this._expParse();
        if (!linhas.length) return toast('Nada reconhecido — formato: código · qtd · referência (TAB ou ;).', 'erro');
        if (confirmar && !confirm(`Expedir ${linhas.length} linha(s)? As saídas entram no kardex.`)) return;
        const r = await api.post('/api/n1/expedicao', { linhas, confirmar });
        if (!r?.ok) return toast(r?.erro || 'Erro.', 'erro');
        if (!confirmar) {
            $('n1-exp-prev').innerHTML = `${r.linhas.length} linha(s)` +
                (r.desconhecidos.length ? ` · <span style="color:var(--warn);">${r.desconhecidos.length} sem posição: ${r.desconhecidos.slice(0, 5).map(esc).join(', ')}</span>` : '') +
                (r.ficarao_negativos.length ? ` · <span style="color:var(--bad);">${r.ficarao_negativos.length} ficarão negativos</span>` : ' · tudo ok ✓');
            return;
        }
        toast(`✓ ${r.expedidas} saída(s) registradas.`);
        (r.avisos || []).forEach((a, i) => setTimeout(() => toast('⚠ ' + a, 'aviso'), 1200 + i * 800));
        this._renderExpedicao();
    },

    // ═══ F2 — NETTING PUSH (carteira firme = OPs do ERP, prio pela folga) ═══
    async _renderNetting() {
        const el = $('n1-pan-netting'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando carteira PUSH…</div>';
        const [d, prev] = await Promise.all([this._getOu503('/api/n1/netting', el), api.get('/api/n1/previsao').catch(() => null)]);
        if (!d) return;
        this._nettingItens = d.itens || [];
        const linhas = this._nettingItens.map(i => `<tr>
            <td class="n1-td" style="font-weight:800;color:${i.prio_sugerida >= 70 ? '#f06292' : '#26c6da'};">${fmt1(i.prio_sugerida)}</td>
            <td class="n1-td" style="font-weight:700;color:var(--indigo-primary);">${esc(i.numero)}</td>
            <td class="n1-td">${esc(i.codigo)} <span style="color:var(--text-dim);font-size:.72rem;">${esc((i.descricao || '').slice(0, 26))}</span></td>
            <td class="n1-td" style="text-align:right;">${fmt(i.qtd)}</td>
            <td class="n1-td">${i.prazo ? fmtData(i.prazo) : '—'}</td>
            <td class="n1-td" style="text-align:right;color:${(i.folga_dias ?? 99) <= 0 ? '#f06292' : 'var(--text-dim)'};font-weight:${(i.folga_dias ?? 99) <= 0 ? 800 : 400};">${i.folga_dias ?? '—'}d</td>
            <td class="n1-td" style="text-align:right;">${i.prio_atual ?? 0} → <strong>${i.prio_op}</strong></td>
        </tr>`).join('');
        const prevRows = Array.isArray(prev) ? prev.slice(0, 8) : [];
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;border-left:3px solid #26c6da;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <div style="flex:1;"><div class="s-label" style="margin:0 0 4px;">② CARTEIRA PUSH — prioridade pela folga (prazo − hoje − LT)</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin:0;">Carteira firme = OPs do ERP para SKUs <strong>PUSH</strong> (homologados). Folga ≤ LT → prio 70–95; folga > LT → 10–35. ${(d.avisos || []).map(esc).join(' ')}</p></div>
            ${this._nettingItens.length ? `<button class="btn primary" style="font-size:.74rem;" onclick="n1._nettingAplicar()">Aplicar prioridades (${this._nettingItens.length})</button>` : ''}
        </div>
        ${prevRows.length ? `<div class="summary-card" style="margin-bottom:12px;">
            <div class="s-label" style="margin-bottom:6px;">PREVISÃO POR FAMÍLIA — EWMA α=0,1 (próximo mês) + MAPE</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">${prevRows.map(p => `<div style="border:1px solid var(--border-color);border-radius:8px;padding:8px 12px;min-width:130px;">
                <div style="font-size:.68rem;color:var(--text-dim);">${esc(String(p.familia).slice(0, 18))}</div>
                <div style="font-size:1.1rem;font-weight:800;">${fmt(Math.round(p.previsao))}</div>
                <div style="font-size:.64rem;color:${p.mape_pct > 50 ? '#f06292' : 'var(--text-dim)'};">MAPE ${p.mape_pct != null ? fmt1(p.mape_pct) + '%' : '—'}</div>
            </div>`).join('')}</div>
        </div>` : `<div class="summary-card" style="margin-bottom:12px;"><button class="btn secondary" style="font-size:.74rem;" onclick="n1._acao('Previsão EWMA','/api/n1/previsao/rodar',null,'netting')">Rodar previsão por família (EWMA+MAPE)</button></div>`}
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:52vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">PRIO 0-100</th><th class="n1-th">OP</th><th class="n1-th">SKU</th><th class="n1-th" style="text-align:right;">QTD</th><th class="n1-th">PRAZO</th><th class="n1-th" style="text-align:right;">FOLGA</th><th class="n1-th" style="text-align:right;">PRIO OP</th></tr></thead>
            <tbody>${linhas || '<tr><td class="n1-td" colspan="7" style="text-align:center;color:var(--text-dim);padding:20px;">Nenhuma OP de SKU PUSH — homologue trilhos PUSH no S&OP (aba Política).</td></tr>'}</tbody></table></div></div>`;
    },
    async _nettingAplicar() {
        if (!confirm(`Aplicar a prioridade sugerida em ${(this._nettingItens || []).length} OP(s) PUSH?`)) return;
        const r = await api.post('/api/n1/netting/aplicar', { itens: (this._nettingItens || []).map(i => ({ op_id: i.op_id, prio_op: i.prio_op })) });
        if (!r?.ok) return toast(r?.erro || 'Erro.', 'erro');
        toast(`✓ ${r.aplicadas} prioridade(s) aplicadas.`);
        this._renderNetting();
    },

    // ═══ F2 — GATE DE CAPACIDADE (Drum ≤ 90%) ═══
    async _renderGargalo() {
        const el = $('n1-pan-gargalo'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando gate…</div>';
        const d = await this._getOu503('/api/n1/gate', el, 'O gate de capacidade grava em carga_gargalo (n1_f2.sql).'); if (!d) return;
        const linhas = (d.linhas || []).map(l => {
            const cor = l.drum_ok == null ? '#8b949e' : l.drum_ok ? '#26a69a' : '#f06292';
            return `<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                <div style="width:150px;font-size:.82rem;font-weight:600;">${esc(l.processo)}</div>
                <div style="flex:1;height:10px;background:var(--bg-input);border-radius:5px;overflow:hidden;"><div style="width:${Math.min(100, (l.utilizacao || 0) / 1.5)}%;height:100%;background:${cor};"></div></div>
                <div style="width:70px;text-align:right;font-weight:800;color:${cor};">${l.utilizacao != null ? fmt1(l.utilizacao) + '%' : '—'}</div>
                <div style="width:150px;text-align:right;font-size:.7rem;color:var(--text-dim);">${fmt(Math.round(l.carga_min / 60))}h / ${fmt(Math.round(l.cap_min / 60))}h (90%)</div>
            </div>`; }).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <div style="flex:1;"><div class="s-label" style="margin:0 0 4px;">③ GATE ÚNICO — Drum ≤ 90% da capacidade</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin:0;">Carga = OPs ativas + sugeridas pendentes/aprovadas × tempo-padrão do roteiro. ${d.avaliacao ? 'Última avaliação: ' + new Date(d.avaliacao).toLocaleString('pt-BR') : 'Nunca avaliado.'}</p></div>
            <button class="btn primary" style="font-size:.74rem;" onclick="n1._acao('Gate de capacidade','/api/n1/gate/capacidade',{dias:22},'gargalo')">Avaliar agora (janela 22 d.u.)</button>
        </div>
        <div class="summary-card">${linhas || '<div style="color:var(--text-dim);font-size:.8rem;padding:8px;">Nenhuma avaliação — clique em Avaliar. Sem tempo-padrão (F0), o gate fica desligado e aprova com aviso.</div>'}</div>`;
    },

    // ═══ F1 — AÇÕES DO LAÇO (ETL → motor → varredura → sequenciar → fechamento) ═
    async _acao(nome, url, body, depois) {
        toast(nome + '…', 'aviso');
        const r = await api.post(url, body || {});
        if (!r?.ok) return toast(r?.erro || `Erro em ${nome}.`, 'erro');
        toast(`✓ ${nome}: ${Object.entries(r).filter(([k, v]) => k !== 'ok' && k !== 'avisos' && typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join(' · ')}`);
        (r.avisos || []).forEach(a => setTimeout(() => toast('⚠ ' + a, 'aviso'), 1500));
        if (depois) this.tab(depois);
    },
    _f1Falta(el, extra) {
        el.innerHTML = `<div class="summary-card" style="border-left:3px solid #ffab76;">
            <div class="s-label" style="margin-bottom:6px;">F1 ainda não inicializado</div>
            <p style="font-size:.82rem;color:#ffab76;">Rode <code>n1_f1.sql</code> no Supabase (SQL Editor) para criar as tabelas do laço (venda_movimento, estoque_posicao, parametro_reposicao, ordem_sugerida, fila_maquina, kpi_diario…).</p>
            ${extra ? `<p style="font-size:.76rem;color:var(--text-dim);margin-top:6px;">${extra}</p>` : ''}</div>`;
    },
    async _getOu503(url, el, extra) {
        const r = await fetch(url, { headers: api._h() });
        if (r.status === 503) { this._f1Falta(el, extra); return null; }
        if (r.status === 401) { n1._expirou(); return null; }
        return r.ok ? r.json().catch(() => null) : null;
    },

    // ── ② Pulmões TOC — posição vs 3 zonas ──
    async _renderPulmoes() {
        const el = $('n1-pan-pulmoes'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando pulmões…</div>';
        const d = await this._getOu503('/api/n1/pulmoes', el); if (!d) return;
        const CORES = { PRETO:'#e0e0e0', VERMELHO:'#f06292', AMARELO:'#ffca28', VERDE:'#26a69a', SEM_PULMAO:'#8b949e' };
        const r = d.resumo || {};
        const kpi = (v, lb, cr) => `<div style="flex:1;min-width:100px;"><div style="font-size:1.5rem;font-weight:800;color:${cr};">${fmt(v)}</div><div style="font-size:.62rem;color:var(--text-dim);">${lb}</div></div>`;
        const linhas = (d.itens || []).slice(0, 300).map(i => {
            const cor = CORES[i.cor] || '#8b949e';
            const pen = i.penetracao_pct != null ? i.penetracao_pct : 0;
            return `<tr>
                <td class="n1-td" style="font-weight:700;color:var(--indigo-primary);">${esc(i.codigo)}</td>
                <td class="n1-td"><span style="font-size:.66rem;font-weight:700;padding:1px 8px;border-radius:5px;background:${cor}22;color:${cor};border:1px solid ${cor}55;">${i.cor === 'SEM_PULMAO' ? 'sem pulmão' : i.cor}</span></td>
                <td class="n1-td" style="min-width:140px;"><div style="height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;"><div style="width:${Math.min(100, pen)}%;height:100%;background:${cor};"></div></div></td>
                <td class="n1-td" style="text-align:right;">${fmt(i.posicao)}</td>
                <td class="n1-td" style="text-align:right;color:var(--text-dim);">${fmt(i.disponivel)} + ${fmt(i.wip)} wip</td>
                <td class="n1-td" style="text-align:right;font-weight:700;">${fmt(i.pulmao)}</td>
                <td class="n1-td" style="text-align:right;color:var(--text-dim);">${fmt1(i.mu_mensal)}/mês</td>
                <td class="n1-td" style="text-align:right;color:var(--text-dim);">${i.lt_dias}d</td>
            </tr>`; }).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
            ${kpi(r.preto || 0, 'PRETO (ruptura)', CORES.PRETO)}${kpi(r.vermelho || 0, 'VERMELHO', CORES.VERMELHO)}${kpi(r.amarelo || 0, 'AMARELO', CORES.AMARELO)}${kpi(r.verde || 0, 'VERDE', CORES.VERDE)}
            <div style="display:flex;flex-direction:column;gap:6px;">
                <button class="btn secondary" style="font-size:.72rem;" onclick="n1._acao('ETL','/api/n1/etl/sync',null,'pulmoes')">① Sincronizar ETL</button>
                <button class="btn secondary" style="font-size:.72rem;" onclick="n1._acao('Motor diário','/api/n1/motor/diario',{},'pulmoes')">② Motor diário (μ/σ + pulmão)</button>
                <button class="btn primary" style="font-size:.72rem;" onclick="n1._acao('Varredura','/api/n1/varredura',null,'sugeridas')">② Varredura → gera sugeridas</button>
            </div>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:58vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">SKU</th><th class="n1-th">ZONA</th><th class="n1-th">PENETRAÇÃO</th><th class="n1-th" style="text-align:right;">POSIÇÃO</th><th class="n1-th" style="text-align:right;">DISP+WIP</th><th class="n1-th" style="text-align:right;">PULMÃO</th><th class="n1-th" style="text-align:right;">μ</th><th class="n1-th" style="text-align:right;">LT</th></tr></thead>
            <tbody>${linhas || '<tr><td class="n1-td" colspan="8" style="text-align:center;color:var(--text-dim);padding:20px;">Nenhum pulmão — rode ① ETL e ② Motor diário.</td></tr>'}</tbody></table></div>
            <div style="padding:8px 14px;font-size:.7rem;color:var(--text-dim);border-top:1px solid var(--border-color);">posição = disponível − reservado + WIP · pulmão de 3 zonas iguais · penetração 0% = pulmão cheio</div></div>`;
    },

    // ── ② Ordens sugeridas → ③ aprovar (check fio) vira OP n1pull ──
    async _renderSugeridas() {
        const el = $('n1-pan-sugeridas'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando sugeridas…</div>';
        const d = await this._getOu503('/api/n1/sugeridas?status=PENDENTE', el); if (!d) return;
        const CORES = { PRETO:'#e0e0e0', VERMELHO:'#f06292', AMARELO:'#ffca28' };
        const linhas = (d || []).map(s => `<tr>
            <td class="n1-td" style="font-weight:800;color:${Number(s.prioridade) >= 70 ? '#f06292' : '#ffca28'};">${fmt1(s.prioridade)}</td>
            <td class="n1-td" style="font-weight:700;color:var(--indigo-primary);">${esc(s.codigo)}</td>
            <td class="n1-td"><span style="font-size:.66rem;font-weight:700;padding:1px 8px;border-radius:5px;background:${CORES[s.zona_origem]}22;color:${CORES[s.zona_origem]};border:1px solid ${CORES[s.zona_origem]}55;">${esc(s.zona_origem)}</span></td>
            <td class="n1-td" style="text-align:right;font-weight:700;">${fmt(s.qtd)}</td>
            <td class="n1-td" style="color:var(--text-dim);font-size:.74rem;">${esc(s.motivo || '')}</td>
            <td class="n1-td"><button class="btn primary" style="font-size:.7rem;min-height:auto;padding:5px 12px;" onclick="n1._aprovar('${escJS(s.id)}')">Aprovar → OP</button></td>
        </tr>`).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;border-left:3px solid #7c4dff;">
            <div class="s-label" style="margin-bottom:4px;">② → ③ ORDENS SUGERIDAS (prio 0–100, geradas pela varredura)</div>
            <p style="font-size:.76rem;color:var(--text-dim);"><strong>${(d || []).length}</strong> pendente(s). Aprovar roda o <strong>check de fio</strong> (BOM × estoque) e cria a OP (origem <code>n1pull</code>, nasce planejada, no ledger). O gate de capacidade (Drum ≤90%) entra no F2.</p>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:58vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">PRIO</th><th class="n1-th">SKU</th><th class="n1-th">ZONA</th><th class="n1-th" style="text-align:right;">QTD (enche pulmão)</th><th class="n1-th">MOTIVO</th><th class="n1-th"></th></tr></thead>
            <tbody>${linhas || '<tr><td class="n1-td" colspan="6" style="text-align:center;color:var(--text-dim);padding:20px;">Nenhuma pendente — rode a Varredura em Pulmões.</td></tr>'}</tbody></table></div></div>`;
    },
    async _aprovar(id) {
        if (!confirm('Aprovar esta reposição?\n\nRoda o check de fio (BOM × estoque) e cria a OP no ledger (origem n1pull).')) return;
        const r = await api.post(`/api/n1/sugeridas/${id}/aprovar`, {});
        if (!r?.ok) return toast(r?.erro || 'Erro ao aprovar.', 'erro');
        toast(`✓ OP ${r.op?.numero} criada (planejada — libere pelo gate do APS).`);
        (r.avisos || []).forEach(a => setTimeout(() => toast('⚠ ' + a, 'aviso'), 1500));
        this._renderSugeridas();
    },

    // ── ④ Fila da máquina — plano fino por TEAR (motor determinístico) ──
    _hhmm(iso) { return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; },
    async _renderFila() {
        const el = $('n1-pan-fila'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando plano…</div>';
        const [d, estados] = await Promise.all([this._getOu503('/api/n1/fila', el), api.get('/api/n1/estado-recurso').catch(() => null)]);
        if (!d) return;
        const CORES = { PRETO: '#e0e0e0', VERMELHO: '#f06292', AMARELO: '#ffca28', VERDE: '#26a69a' };
        // agrupa por tear (processo)
        const porTear = {};
        (d.itens || []).forEach(i => { (porTear[i.processo] = porTear[i.processo] || []).push(i); });
        const grupos = Object.entries(porTear).map(([tear, itens]) => `
            <div class="summary-card rise" style="padding:0;overflow:hidden;">
                <div class="sec-title" style="padding:12px 14px 0;">${icon('tear')} ${esc(tear)} <span class="hint">${itens.length} OP(s)</span></div>
                <table class="data-table"><thead><tr><th style="width:34px;">#</th><th>OP</th><th>SKU</th><th class="num">Qtd</th><th>Início</th><th>Fim</th><th class="num">Setup</th><th>Pulmão</th></tr></thead>
                <tbody>${itens.map(i => `<tr>
                    <td class="dim" style="font-weight:800;">${i.posicao}</td>
                    <td style="font-weight:700;color:var(--indigo-primary);">${esc(i.numero || '')}</td>
                    <td class="dim">${esc(i.codigo || '')}</td>
                    <td class="num">${fmt(i.qtd)}</td>
                    <td class="dim">${this._hhmm(i.inicio)}</td>
                    <td class="dim">${this._hhmm(i.fim)}</td>
                    <td class="num" style="color:${Number(i.setup_min) > 0 ? 'var(--warn)' : 'var(--ok)'};">${i.setup_min != null ? fmt(Math.round(i.setup_min)) + ' min' : '—'}</td>
                    <td>${i.cor_pulmao ? `<span class="badge" style="color:${CORES[i.cor_pulmao]};border-color:${CORES[i.cor_pulmao]}55;">${i.cor_pulmao}</span>` : '<span class="dim">—</span>'}</td>
                </tr>`).join('')}</tbody></table>
            </div>`).join('');
        const estCards = Array.isArray(estados) ? estados.map(e => {
            const a = e.atributo_atual || {};
            const attrsTxt = ['galga', 'cor_base', 'titulo_fio', 'programa_maquina'].filter(k => a[k]).map(k => `${k.replace('_', ' ')}: <b>${esc(String(a[k]))}</b>`).join(' · ');
            return `<div style="border:1px solid var(--border-color);border-radius:8px;padding:8px 12px;font-size:.74rem;color:var(--text-dim);display:flex;align-items:center;gap:8px;">
                ${icon('tear', 'icon sm')} <b style="color:var(--text-main);">${esc(e.nome)}</b>
                <span>${attrsTxt || 'estado não informado'}</span>
                <button class="btn ghost sm" onclick="n1._editarEstado('${escJS(e.recurso_id)}','${escJS(e.nome)}')">editar</button>
            </div>`; }).join('') : '';
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <div style="flex:1;"><div class="sec-title" style="margin:0 0 4px;">${icon('camadas')} Plano fino por tear ${d.versao ? `<span class="hint">versão ${d.versao}</span>` : ''}</div>
            <p style="font-size:var(--fs-caption);color:var(--text-dim);margin:0;">Motor determinístico: PRETO fura a fila · índice composto (urgência CR + custo de troca) · setup pela matriz de→para a partir do estado ATUAL do tear · calendário de dias úteis × jornada · eficiência (OEE) por tear.</p></div>
            <button class="btn primary" style="font-size:.74rem;" onclick="n1._acao('Sequenciar','/api/n1/sequenciar',{},'fila')">Sequenciar (nova versão)</button>
        </div>
        ${estCards ? `<div class="summary-card" style="margin-bottom:12px;"><div class="s-label" style="margin-bottom:8px;">ESTADO ATUAL DOS TEARES (para o 1º setup)</div><div style="display:flex;gap:8px;flex-wrap:wrap;">${estCards}</div></div>` : ''}
        ${grupos || '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Sem plano — sequencie (precisa de OPs liberadas pelo gate do APS).</div>'}`;
    },
    async _editarEstado(recursoId, nome) {
        const galga = prompt(`${nome} — galga atual (vazio = não sei):`) ?? null; if (galga === null) return;
        const cor = prompt(`${nome} — cor base atual:`) ?? '';
        const fio = prompt(`${nome} — título do fio atual:`) ?? '';
        const attrs = {}; if (galga) attrs.galga = galga.trim(); if (cor) attrs.cor_base = cor.trim(); if (fio) attrs.titulo_fio = fio.trim();
        const r = await api.post('/api/n1/estado-recurso', { recurso_id: recursoId, atributo_atual: attrs });
        if (!r?.ok) return toast(r?.erro || 'Erro.', 'erro');
        toast('✓ Estado do tear atualizado — o próximo plano parte dele.');
        this._renderFila();
    },

    // ── ⑤ PWA (operador): mesma fila, cartões grandes ──
    async _renderPwa() {
        const el = $('n1-pan-pwa'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando…</div>';
        const d = await this._getOu503('/api/n1/fila', el); if (!d) return;
        const CORES = { PRETO:'#e0e0e0', VERMELHO:'#f06292', AMARELO:'#ffca28', VERDE:'#26a69a' };
        const cards = (d.itens || []).slice(0, 30).map(i => { const cor = CORES[i.cor_pulmao] || '#8b949e';
            return `<div style="border:1px solid ${cor}55;border-left:6px solid ${cor};border-radius:10px;padding:14px 16px;background:var(--bg-card);display:flex;justify-content:space-between;align-items:center;gap:10px;">
                <div><div style="font-size:1.05rem;font-weight:800;">${i.posicao}º · ${esc(i.numero || '')}</div>
                <div style="font-size:.78rem;color:var(--text-dim);">${esc(i.codigo || '')} · ${fmt(i.qtd)} pç</div></div>
                <div style="font-size:.7rem;font-weight:800;color:${cor};">${i.cor_pulmao || ''}</div>
            </div>`; }).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;">
            <div class="s-label" style="margin:0 0 4px;">⑤ FILA COM COR — visão do operador ${d.versao ? `· v${d.versao}` : ''}</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin:0;">O PWA não calcula (§2.8) — consome a última versão. O apontamento continua no MES (captura única).
            <a href="/mes.html" style="color:#7c4dff;">Abrir MES → Apontamento</a></p>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:680px;">${cards || '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Sem fila publicada.</div>'}</div>`;
    },

    // ── ⑥ KPIs ──
    async _renderKpi() {
        const el = $('n1-pan-kpi'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando KPIs…</div>';
        const d = await this._getOu503('/api/n1/kpis', el); if (!d) return;
        const linhas = (d || []).map(k => `<tr>
            <td class="n1-td" style="font-weight:700;">${fmtData(k.dia)}</td>
            <td class="n1-td" style="text-align:right;color:${k.rupturas ? '#f06292' : '#26a69a'};font-weight:700;">${k.rupturas ?? '—'}</td>
            <td class="n1-td" style="text-align:right;">${k.penetracao_media != null ? fmt1(k.penetracao_media) + '%' : '—'}</td>
            <td class="n1-td" style="text-align:right;">${k.aderencia_pct != null ? fmt1(k.aderencia_pct) + '%' : '—'}</td>
            <td class="n1-td" style="text-align:right;">${k.latencia_apont_min != null ? fmt1(k.latencia_apont_min) + ' min' : '—'}</td>
            <td class="n1-td" style="color:var(--text-dim);font-size:.72rem;">${esc(JSON.stringify(k.detalhe || {}))}</td>
        </tr>`).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <div style="flex:1;"><div class="s-label" style="margin:0 0 4px;">⑥ KPIs DIÁRIOS (fechamento noturno)</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin:0;">Rupturas · penetração média dos pulmões · aderência (quando a fila for usada) · latência de apontamento. Alimentam o S&OP (⑦).</p></div>
            <button class="btn primary" style="font-size:.74rem;" onclick="n1._acao('Fechamento','/api/n1/fechamento',null,'kpi')">Rodar fechamento agora</button>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:58vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">DIA</th><th class="n1-th" style="text-align:right;">RUPTURAS</th><th class="n1-th" style="text-align:right;">PENETRAÇÃO MÉDIA</th><th class="n1-th" style="text-align:right;">ADERÊNCIA</th><th class="n1-th" style="text-align:right;">LATÊNCIA APONT.</th><th class="n1-th">DETALHE</th></tr></thead>
            <tbody>${linhas || '<tr><td class="n1-td" colspan="6" style="text-align:center;color:var(--text-dim);padding:20px;">Nenhum fechamento rodado ainda.</td></tr>'}</tbody></table></div></div>`;
    },

    // ── ⑥ DBM — contadores e ajustes de pulmão ──
    async _renderDbm() {
        const el = $('n1-pan-dbm'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando DBM…</div>';
        const d = await this._getOu503('/api/n1/pulmoes', el); if (!d) return;
        const comMov = (d.itens || []).filter(i => i.dias_vermelho > 0 || i.dias_verde > 0 || i.ultimo_ajuste_em);
        const linhas = comMov.map(i => `<tr>
            <td class="n1-td" style="font-weight:700;color:var(--indigo-primary);">${esc(i.codigo)}</td>
            <td class="n1-td" style="text-align:right;color:${i.dias_vermelho >= 3 ? '#f06292' : 'var(--text-dim)'};font-weight:${i.dias_vermelho >= 3 ? 800 : 400};">${i.dias_vermelho}</td>
            <td class="n1-td" style="text-align:right;color:var(--text-dim);">${i.dias_verde}</td>
            <td class="n1-td" style="text-align:right;font-weight:700;">${fmt(i.pulmao)}</td>
            <td class="n1-td" style="color:var(--text-dim);">${i.ultimo_ajuste_em ? fmtData(i.ultimo_ajuste_em) : 'nunca'}</td>
        </tr>`).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;border-left:3px solid #26c6da;">
            <div class="s-label" style="margin-bottom:4px;">⑥ DBM — Dynamic Buffer Management</div>
            <p style="font-size:.76rem;color:var(--text-dim);">Regra: <strong>×1,33</strong> se ≥5 dias consecutivos no vermelho · <strong>×0,67</strong> se ≥2×LT no verde · máx 1 ajuste por LT. Os contadores andam a cada fechamento noturno. ${comMov.length} SKU(s) com contador ativo.</p>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:56vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">SKU</th><th class="n1-th" style="text-align:right;">DIAS VERMELHO</th><th class="n1-th" style="text-align:right;">DIAS VERDE</th><th class="n1-th" style="text-align:right;">PULMÃO</th><th class="n1-th">ÚLTIMO AJUSTE</th></tr></thead>
            <tbody>${linhas || '<tr><td class="n1-td" colspan="5" style="text-align:center;color:var(--text-dim);padding:20px;">Nenhum contador ativo — os contadores andam com o fechamento noturno.</td></tr>'}</tbody></table></div></div>`;
    },

    // ── ⑦ Política + S&OP leve (roteamento ABC-XYZ → staging → homologar) ──
    async _renderPolitica() {
        const el = $('n1-pan-politica'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando ciclo…</div>';
        const rot = await this._getOu503('/api/n1/roteamento', el, 'O roteamento grava em roteamento_staging (n1_f2.sql).'); if (!rot) return;
        const st = rot.itens || [];
        const mudancas = st.filter(s => s.mudanca);
        const aplicaveis = mudancas.filter(s => s.ciclos_consecutivos >= 2);
        const portfolio = st.filter(s => s.revisar_portfolio);
        const pend = st.some(s => s.status === 'PENDENTE');
        const chip = (t, cor) => `<span style="font-size:.64rem;font-weight:700;padding:1px 7px;border-radius:5px;background:${cor}22;color:${cor};border:1px solid ${cor}55;">${t}</span>`;
        const linhas = st.filter(s => s.mudanca || s.revisar_portfolio).slice(0, 200).map(s => `<tr>
            <td class="n1-td" style="font-weight:700;color:var(--indigo-primary);">${esc(s.codigo)}</td>
            <td class="n1-td" style="text-align:center;font-weight:800;">${esc(s.abc)}${esc(s.xyz)}</td>
            <td class="n1-td" style="text-align:right;color:var(--text-dim);">${fmt(s.volume_12m)}</td>
            <td class="n1-td" style="text-align:right;color:var(--text-dim);">${s.cv != null ? fmt1(s.cv) : '—'}</td>
            <td class="n1-td" style="text-align:right;color:${s.pct_meses_zero >= 40 ? '#f06292' : 'var(--text-dim)'};">${fmt1(s.pct_meses_zero)}%</td>
            <td class="n1-td">${esc(s.trilho_atual || '—')} → <strong style="color:${s.trilho_sugerido === 'PULL' ? '#26a69a' : '#26c6da'};">${esc(s.trilho_sugerido)}</strong>${s.item_novo ? ' ' + chip('novo', '#ffab76') : ''}${s.revisar_portfolio ? ' ' + chip('CZ · revisar', '#f06292') : ''}</td>
            <td class="n1-td" style="text-align:center;">${s.ciclos_consecutivos >= 2 ? chip('aplica ✓', '#26a69a') : chip(`histerese ${s.ciclos_consecutivos}/2`, '#8b949e')}</td>
        </tr>`).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;border-left:3px solid #7c4dff;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <div style="flex:1;"><div class="s-label" style="margin:0 0 4px;">⑦ S&OP LEVE — ciclo ${esc(rot.ciclo)} · roteamento ABC-XYZ</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin:0;">${st.length ? `${st.length} SKUs no staging · <strong>${mudancas.length}</strong> mudanças propostas · <strong style="color:#26a69a;">${aplicaveis.length}</strong> passam a histerese (2 ciclos) · <strong style="color:#f06292;">${portfolio.length}</strong> CZ (revisar portfólio)` : 'Ciclo ainda não rodado.'} ABC por <strong>volume</strong> (valor zerado na base) · X: CV≤0,5 · Y: ≤1,0 · Z: >1,0 ou ≥40% meses zero · item novo (<6m) = PUSH.</p></div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                <button class="btn secondary" style="font-size:.72rem;" onclick="n1._acao('Roteamento','/api/n1/roteamento/rodar',null,'politica')">Rodar roteamento (mensal)</button>
                ${pend && st.length ? `<button class="btn primary" style="font-size:.72rem;" onclick="n1._homologar('${escJS(rot.ciclo)}')">Homologar ciclo (${aplicaveis.length} aplicáveis)</button>` : ''}
            </div>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:56vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">SKU</th><th class="n1-th" style="text-align:center;">ABC-XYZ</th><th class="n1-th" style="text-align:right;">VOL 12M</th><th class="n1-th" style="text-align:right;">CV</th><th class="n1-th" style="text-align:right;">MESES ZERO</th><th class="n1-th">TRILHO</th><th class="n1-th" style="text-align:center;">HISTERESE</th></tr></thead>
            <tbody>${linhas || `<tr><td class="n1-td" colspan="7" style="text-align:center;color:var(--text-dim);padding:20px;">${st.length ? 'Nenhuma mudança de trilho proposta neste ciclo — política estável ✓' : 'Rode o roteamento para classificar a carteira.'}</td></tr>`}</tbody></table></div>
            ${st.length ? `<div style="padding:8px 14px;font-size:.7rem;color:var(--text-dim);border-top:1px solid var(--border-color);">Mostrando só mudanças e CZ. Homologar aplica os que passam a histerese em politica_item (com histórico) e fecha o ciclo.</div>` : ''}</div>`;
    },
    async _homologar(ciclo) {
        if (!confirm(`Homologar o ciclo ${ciclo}?\n\nAplica as mudanças de trilho que passaram a histerese (2 ciclos) em politica_item, com histórico. Mudanças de 1 ciclo ficam seguradas para o mês que vem.`)) return;
        const r = await api.post('/api/n1/roteamento/homologar', { ciclo });
        if (!r?.ok) return toast(r?.erro || 'Erro ao homologar.', 'erro');
        toast(`✓ Ciclo ${ciclo}: ${r.aplicadas} aplicadas · ${r.seguradas_histerese} seguradas (histerese) · ${r.sem_mudanca} sem mudança.`);
        this._renderPolitica();
    },

    // ═══ F0 — DADOS MESTRES (auditoria read-only p/ o gate F0→F1) ═══════════
    async _f0(force) {
        if (this._f0data && !force) return this._f0data;
        this._f0data = await api.get('/api/n1/f0-auditoria');
        return this._f0data;
    },
    _f0GateCard(r) {
        const c = r.cobertura_pct, cor = c >= 90 ? '#26a69a' : c >= 60 ? '#ffca28' : '#f06292';
        const kpi = (v, lb, cr) => `<div style="flex:1;min-width:120px;"><div style="font-size:1.5rem;font-weight:800;color:${cr};">${v}</div><div style="font-size:.62rem;color:var(--text-dim);letter-spacing:.04em;">${lb}</div></div>`;
        return `<div class="summary-card" style="margin-bottom:14px;border-left:3px solid ${cor};">
            <div class="s-label" style="margin-bottom:10px;">🎯 GATE F0 → F1 — SKUs prontos = roteiro definido + tempo-padrão em TODAS as etapas do roteiro</div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;">
                ${kpi(c + '%', 'COBERTURA (prontos/total)', cor)}
                ${kpi(fmt(r.prontos) + ' / ' + fmt(r.total), 'SKUs PRONTOS', '#26a69a')}
                ${kpi(fmt(r.sem_roteiro), 'SEM ROTEIRO PRÓPRIO', r.sem_roteiro ? '#ffca28' : '#26a69a')}
                ${kpi(fmt(r.sem_tempo), 'COM ETAPA SEM TEMPO', r.sem_tempo ? '#f06292' : '#26a69a')}
                ${kpi(fmt(r.etapas_ativas), 'ETAPAS ATIVAS', '#8b949e')}
            </div>
            <div style="font-size:.7rem;color:var(--text-dim);margin-top:8px;">O spec pede top-20 SKUs auditados com desvio tempo cadastrado × cronometrado &lt;20% — o desvio entra no F1 (fechamento mede o tempo real). Aqui está a prontidão de cadastro.</div>
        </div>`;
    },
    async _renderRoteiros() {
        const el = $('n1-pan-roteiros'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Auditando roteiros…</div>';
        const d = await this._f0(); if (!d?.resumo) { el.innerHTML = '<div class="summary-card" style="color:#f06292;padding:16px;">Não consegui auditar (sessão/servidor).</div>'; return; }
        const linhas = d.itens.map(i => `<tr>
            <td class="n1-td" style="font-weight:700;color:var(--indigo-primary);">${esc(i.codigo)}</td>
            <td class="n1-td">${esc((i.descricao || '').slice(0, 42))}</td>
            <td class="n1-td" style="text-align:center;">${i.roteiro_proprio ? '<span style="color:#26a69a;">próprio</span>' : '<span style="color:#ffca28;" title="sem produto_etapa — assume todas as etapas ativas">todas (padrão)</span>'}</td>
            <td class="n1-td" style="text-align:center;">${i.etapas}</td>
            <td class="n1-td" style="text-align:center;">${i.pronto ? '<span style="color:#26a69a;font-weight:700;">✓ pronto</span>' : '<span style="color:#f06292;">incompleto</span>'}</td>
        </tr>`).join('');
        el.innerHTML = this._f0GateCard(d.resumo) + `
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:60vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;">
                <th class="n1-th">SKU</th><th class="n1-th">DESCRIÇÃO</th><th class="n1-th" style="text-align:center;">ROTEIRO</th><th class="n1-th" style="text-align:center;">ETAPAS</th><th class="n1-th" style="text-align:center;">PRONTIDÃO</th>
            </tr></thead><tbody>${linhas || '<tr><td class="n1-td" colspan="5" style="text-align:center;color:var(--text-dim);padding:20px;">Nenhum produto ativo.</td></tr>'}</tbody></table></div>
            ${d.truncado ? `<div style="padding:8px 14px;font-size:.7rem;color:var(--text-dim);border-top:1px solid var(--border-color);">+${d.truncado} SKUs além do limite.</div>` : ''}
        </div>`;
    },
    async _renderTempos() {
        const el = $('n1-pan-tcad'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Auditando tempos-padrão…</div>';
        const d = await this._f0(); if (!d?.resumo) { el.innerHTML = '<div class="summary-card" style="color:#f06292;padding:16px;">Não consegui auditar.</div>'; return; }
        // foco: SKUs com etapa sem tempo (o que trava o gate + a liberação da OP no APS)
        const incompletos = d.itens.filter(i => i.tempos_faltando.length);
        const linhas = incompletos.map(i => `<tr>
            <td class="n1-td" style="font-weight:700;color:var(--indigo-primary);">${esc(i.codigo)}</td>
            <td class="n1-td">${esc((i.descricao || '').slice(0, 36))}</td>
            <td class="n1-td" style="color:#f06292;font-size:.74rem;">${i.tempos_faltando.map(esc).join(', ')}</td>
        </tr>`).join('');
        el.innerHTML = this._f0GateCard(d.resumo) + `
        <div class="summary-card" style="margin-bottom:12px;">
            <div class="s-label" style="margin-bottom:4px;">⏱ ONDE FALTA TEMPO-PADRÃO</div>
            <p style="font-size:.76rem;color:var(--text-dim);">O tempo-padrão é dono do MES (cronoanálise). Cada etapa do roteiro precisa de <code>tempo_padrao</code> (específico do SKU ou genérico da etapa). Sem ele, a OP não passa no gate. <strong style="color:${incompletos.length ? '#f06292' : '#26a69a'};">${incompletos.length} SKU(s)</strong> com buraco.</p>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:56vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">SKU</th><th class="n1-th">DESCRIÇÃO</th><th class="n1-th">ETAPAS SEM TEMPO</th></tr></thead>
            <tbody>${linhas || '<tr><td class="n1-td" colspan="3" style="text-align:center;color:#26a69a;padding:20px;">✓ Todos os SKUs auditados têm tempo em todas as etapas do roteiro.</td></tr>'}</tbody></table></div></div>`;
    },
    async _renderSetup() {
        const el = $('n1-pan-setup'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando matriz de setup…</div>';
        const m = await api.get('/api/setup-matrix');
        if (!Array.isArray(m)) { el.innerHTML = '<div class="summary-card" style="color:#f06292;padding:16px;">Matriz de setup indisponível.</div>'; return; }
        const linhas = m.map(x => `<tr>
            <td class="n1-td">${esc(x.processo)}</td><td class="n1-td">${esc(x.familia_de)}</td>
            <td class="n1-td" style="color:var(--text-dim);">→ ${esc(x.familia_para)}</td>
            <td class="n1-td" style="text-align:right;font-weight:700;color:${Number(x.minutos) > 0 ? '#ffca28' : '#26a69a'};">${fmt(x.minutos)} min</td>
        </tr>`).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;border-left:3px solid #26c6da;">
            <div class="s-label" style="margin-bottom:4px;">🔧 MATRIZ DE SETUP (troca família → família por processo)</div>
            <p style="font-size:.76rem;color:var(--text-dim);">Base da heurística de sequência do APS (④). <strong>${m.length}</strong> transição(ões) cadastrada(s). Compartilhada com o APS — dado mestre único.</p>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:60vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">PROCESSO</th><th class="n1-th">DE</th><th class="n1-th">PARA</th><th class="n1-th" style="text-align:right;">MINUTOS</th></tr></thead>
            <tbody>${linhas || '<tr><td class="n1-td" colspan="4" style="text-align:center;color:var(--text-dim);padding:20px;">Matriz vazia — cadastre no SIGS › Preactor (Setup Matrix).</td></tr>'}</tbody></table></div></div>`;
    },
    async _renderBom() {
        const el = $('n1-pan-bom'); el.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:16px;">Carregando BOM…</div>';
        const r = await fetch('/api/n1/bom', { headers: api._h() });
        if (r.status === 503) { const d = await r.json().catch(() => ({}));
            el.innerHTML = `<div class="summary-card" style="border-left:3px solid #ffab76;">
                <div class="s-label" style="margin-bottom:6px;">BOM — lista técnica (consumo de fio/MP por SKU)</div>
                <p style="font-size:.82rem;color:#ffab76;margin-bottom:8px;">${esc(d.erro || 'Tabela BOM não existe ainda.')}</p>
                <p style="font-size:.76rem;color:var(--text-dim);">Rode <code>n1_f0.sql</code> no Supabase (SQL Editor) para criar a tabela. Ela habilita o check de fio no gate (③) e o desacople híbrido no semiacabado.</p></div>`;
            return; }
        const bom = r.ok ? await r.json().catch(() => []) : [];
        const linhas = (bom || []).map(x => `<tr>
            <td class="n1-td" style="font-weight:700;color:var(--indigo-primary);">${esc(x.produto?.codigo || x.produto_id)}</td>
            <td class="n1-td">${esc(x.produto?.descricao || '')}</td>
            <td class="n1-td">${esc(x.material_codigo)}${x.material_descricao ? ` · ${esc(x.material_descricao)}` : ''}</td>
            <td class="n1-td" style="text-align:right;">${fmt1(x.qtd_por_unidade)} ${esc(x.unidade)}</td>
        </tr>`).join('');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:12px;border-left:3px solid #26a69a;">
            <div class="s-label" style="margin-bottom:4px;">BOM — lista técnica (consumo de fio/MP por SKU)</div>
            <p style="font-size:.76rem;color:var(--text-dim);"><strong>${(bom || []).length}</strong> linha(s). Sem BOM, o check de fio do gate fica desligado para o SKU.</p>
        </div>
        <div class="summary-card" style="margin-bottom:12px;">
            <div class="s-label" style="margin-bottom:6px;">IMPORTAR (colar do Excel)</div>
            <p style="font-size:.72rem;color:var(--text-dim);margin-bottom:8px;">Cole linhas com colunas separadas por TAB ou ponto-e-vírgula, na ordem: <code>código do produto · código do fio/MP · descrição do material · consumo por unidade · unidade (kg/g/m/pc)</code>. Uma linha por material.</p>
            <textarea id="n1-bom-cola" class="n1-input" rows="5" placeholder="12002&#9;FIO-PA-70&#9;Poliamida 70&#9;0,035&#9;kg&#10;12002&#9;ELAST-45&#9;Elastano 45&#9;0,008&#9;kg"></textarea>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="btn secondary" style="font-size:.74rem;" onclick="n1._bomPreview()">Pré-visualizar</button>
                <button class="btn primary" style="font-size:.74rem;" onclick="n1._bomImportar()">Importar</button>
            </div>
            <div id="n1-bom-prev" style="margin-top:8px;font-size:.76rem;color:var(--text-dim);"></div>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:48vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">SKU</th><th class="n1-th">DESCRIÇÃO</th><th class="n1-th">MATERIAL (fio/MP)</th><th class="n1-th" style="text-align:right;">CONSUMO/UN</th></tr></thead>
            <tbody>${linhas || '<tr><td class="n1-td" colspan="4" style="text-align:center;color:var(--text-dim);padding:20px;">BOM vazia — nenhuma linha cadastrada ainda.</td></tr>'}</tbody></table></div></div>`;
    },
    _bomParse() {
        const txt = $('n1-bom-cola')?.value || '';
        return txt.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => {
            const p = l.split(/\t|;/).map(x => x.trim());
            return { codigo: p[0], material_codigo: p[1], material_descricao: p[2] || '',
                qtd_por_unidade: parseFloat(String(p[3] || '0').replace(',', '.')) || 0, unidade: (p[4] || 'kg').toLowerCase() };
        }).filter(x => x.codigo && x.material_codigo);
    },
    async _bomPreview() {
        const linhas = this._bomParse();
        if (!linhas.length) return toast('Nada reconhecido — confira o formato (TAB ou ;).', 'erro');
        const r = await api.post('/api/n1/bom/bulk', { linhas, confirmar: false });
        if (!r?.ok) return toast(r?.erro || 'Erro no preview.', 'erro');
        $('n1-bom-prev').innerHTML = `<span style="color:#26a69a;">${r.validas} linha(s) válidas</span>` +
            (r.sem_produto_total ? ` · <span style="color:#f06292;">${r.sem_produto_total} código(s) sem produto cadastrado: ${r.sem_produto.map(esc).join(', ')}${r.sem_produto_total > 30 ? '…' : ''}</span>` : ' · todos os códigos casam ✓');
    },
    async _bomImportar() {
        const linhas = this._bomParse();
        if (!linhas.length) return toast('Nada reconhecido — confira o formato.', 'erro');
        if (!confirm(`Importar ${linhas.length} linha(s) de BOM? (upsert por produto+material — reimportar atualiza)`)) return;
        const r = await api.post('/api/n1/bom/bulk', { linhas, confirmar: true });
        if (!r?.ok) return toast(r?.erro || 'Erro ao importar.', 'erro');
        toast(`✓ BOM: ${r.gravadas} gravada(s)${r.sem_produto_total ? ` · ${r.sem_produto_total} sem produto (ignoradas)` : ''}.`);
        this._renderBom();
    },

    // ═══ PAINEL DO LAÇO — desenha o fluxo ⓪→⑦ do spec ═══════════════════════
    _renderPainel() {
        const el = $('n1-pan-painel');
        const bloco = (num, titulo, desc, fase, tabs) => {
            const f = FASE[fase] || FASE.shell;
            return `<div style="display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border:1px solid var(--border-color);border-left:3px solid ${f.cor};border-radius:10px;background:var(--bg-card);">
                <div style="font-size:1.4rem;font-weight:800;color:${f.cor};min-width:34px;">${num}</div>
                <div style="flex:1;">
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <strong style="font-size:.92rem;">${esc(titulo)}</strong>
                        <span style="font-size:.62rem;font-weight:700;padding:1px 7px;border-radius:5px;background:${f.cor}22;color:${f.cor};border:1px solid ${f.cor}55;">${f.label}</span>
                    </div>
                    <div style="font-size:.76rem;color:var(--text-dim);margin-top:4px;">${esc(desc)}</div>
                    ${tabs ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${tabs.map(([id,lb])=>`<button class="btn secondary" style="font-size:.7rem;min-height:auto;padding:4px 10px;" onclick="n1.tab('${id}')">${esc(lb)}</button>`).join('')}</div>` : ''}
                </div>
            </div>`;
        };
        const seta = `<div style="text-align:center;color:var(--text-dim);font-size:1.1rem;line-height:.6;">↓</div>`;
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;border-left:3px solid #7c4dff;">
            <div class="s-label" style="margin-bottom:6px;">🔁 O LAÇO — consumo puxa (TOC), carteira empurra, gate protege o gargalo, realizado corrige</div>
            <p style="font-size:.78rem;color:var(--text-dim);">Regra de ouro do spec: <strong>nenhum processo chama outro</strong> — cada bloco escreve/lê tabela. 1 SKU = PULL <em>ou</em> PUSH (nunca soma). Ledger append-only. Duas frequências (job diário pesado × varredura do gatilho). Séries incluem zeros.</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:920px;">
            ${bloco('⓪','Dados Mestres — Fundação','Roteiros, tempos, setup matrix, BOM. Sustenta tudo. Gate F0→F1: top-20 SKUs auditados, desvio tempo cadastrado × cronometrado <20%.','F0',[['roteiros','Roteiros'],['tcad','Tempos'],['setup','Setup Matrix'],['bom','BOM']])}
            ${seta}
            ${bloco('①','Import (ETL)','Vendas ERP, estoque, telemetria da máquina → movimentos/posição. Posição = disponível − reservado + WIP.','F1')}
            ${seta}
            ${bloco('②','Motor — Pulmões (PULL) + Netting (PUSH)','PULL: pulmão DBM de 3 zonas (evolução do ponto de pedido). PUSH: netting da carteira firme MTO. Gera ordem_sugerida (prioridade 0–100).','F1',[['pulmoes','Pulmões TOC'],['sugeridas','Ordens Sugeridas'],['netting','Netting MTO']])}
            ${seta}
            ${bloco('③','Gate Único','RCCP ∪ TOC · Drum ≤ 90% · check de fio (pulmão MP). Estouro → rejanela ≤ 5 d.u. → só exceção escala ao S&OP.','F1',[['gargalo','Gargalo (Drum)']])}
            ${seta}
            ${bloco('④','APS — Sequência','Heurística: setup matrix + Heijunka + Rope. Ordena por prioridade DESC, cega à origem. Gera fila_maquina (versionada).','F1',[['fila','Fila da Máquina']])}
            ${seta}
            ${bloco('⑤','MES/PWA — Chão','Fila com cor · apontamento (auto máquina + operador) · modo degradado. O PWA consome, não calcula.','F1',[['pwa','Fila (PWA)'],['apont','Apontamento']])}
            ${seta}
            ${bloco('⑥','Fechamento Noturno','tempo_real_roteiro (desvio>15% alerta dado mestre) · DBM (ajusta pulmão) · kpi_diario (aderência, OTIF, rupturas, giro, MAPE).','F1',[['kpi','KPIs'],['dbm','DBM'],['tempos','Tempos Reais']])}
            ${seta}
            ${bloco('⑦','S&OP Leve (mensal)','Homologa politica_item (trilho PULL/PUSH por ABC-XYZ). Imutável entre ciclos. Recebe os KPIs de volta.','F2',[['politica','Política (Trilho)']])}
        </div>
        <div class="summary-card" style="margin-top:16px;border-left:3px solid #26a69a;">
            <div class="s-label" style="margin-bottom:6px;">AUTOMAÇÃO — o laço roda sozinho (America/São_Paulo)</div>
            <p style="font-size:.78rem;color:var(--text-dim);">
                <strong>Varredura do gatilho</strong> a cada 15 min · <strong>ETL + motor diário</strong> às 05:00 ·
                <strong>Fechamento (DBM + KPIs)</strong> às 23:30 · <strong>Roteamento + previsão</strong> todo dia 01 às 06:00.
                Os botões nas telas continuam funcionando para rodar na hora. Cada job tem trava (não roda 2× ao mesmo tempo).
            </p>
        </div>
        <div class="summary-card" style="margin-top:12px;">
            <div class="s-label" style="margin-bottom:6px;">DECISÃO DE ARQUITETURA (registrada)</div>
            <p style="font-size:.78rem;color:var(--text-dim);">N1Tech é a <strong>evolução do APS</strong>: tabelas de fluxo próprias do spec; o ledger é o <code>op_state_log</code> compartilhado (append-only por trigger); dados mestres (roteiro/tempo/setup/BOM) só lidos. O APS será aposentado quando o N1Tech alcançar paridade.</p>
        </div>`;
    },

    // placeholder honesto por aba ainda não construída (mostra o que fará + a fase)
    _placeholder(nome) {
        const M = {
            pulmoes:  ['Pulmões TOC (DBM)','F1','Pulmão de 3 zonas por SKU PULL (verde/amarelo/vermelho). Fronteiras GENERATED; inicial = μ×LT×3zonas. Enchimento entra no verde (prioridade baixa). Lê parametro_reposicao / estoque_posicao.'],
            sugeridas:['Ordens Sugeridas','F1','ordem_sugerida com prioridade 0–100 (PRETO 95–100, VERMELHO 70+25×penetração…). UNIQUE (sku, PENDENTE). Alimenta o Gate.'],
            netting:  ['Netting MTO (PUSH)','F2','Carteira firme empurrada: netting = demanda firme − posição, para itens com trilho=PUSH. Nunca soma com o PULL.'],
            gargalo:  ['Gate Único — Gargalo','F1','RCCP ∪ TOC. Aprova se carga+h(ordem) ≤ disponível×0,90; senão rejanela ≤5 d.u.; senão escalada. Drum ≤ 90%. carga_gargalo.'],
            fila:     ['Fila da Máquina (APS)','F1','Heurística de setup + Heijunka + Rope, ordenada por prioridade DESC, cega à origem. fila_maquina versionada (p/ KPI de aderência).'],
            pwa:      ['Fila com Cor (PWA)','F1','Tela do operador: consome a última versao_plano de fila_maquina, mostra a cor do pulmão. Não calcula nada. Modo degradado offline.'],
            apont:    ['Apontamento','F1','Origem auto (máquina Sin1) + operador. ocorrido≠criado mede a latência. Escreve apontamento; o fechamento consome.'],
            kpi:      ['KPIs Diários','F1','kpi_diario: aderência de sequência, OTIF, rupturas, giro, MAPE do push, latência de apontamento. Vão ao S&OP (mensal).'],
            dbm:      ['Ajustes de Pulmão (DBM)','F1','Dynamic Buffer Management: ×1,33 se ≥5 dias no vermelho; ×0,67 se ≥2×LT no verde; máx 1 ajuste por LT.'],
            tempos:   ['Tempos Reais','F1','tempo_real_roteiro medido no chão. Desvio >15% por 3 semanas → alerta de dado mestre (corrige F0).'],
            politica: ['Política — Trilho PULL/PUSH','F2','politica_item: a única fonte de verdade do trilho. ABC 80/15/5 × XYZ (CV). Homologada no S&OP leve, imutável entre ciclos, com histórico.'],
            roteiros: ['Roteiros (F0)','F0','Auditoria do roteiro por item: sequência de etapas ativa. Reusa produto_etapa / etapa_processo do MES.'],
            tcad:     ['Tempos-padrão (F0)','F0','Auditoria de tempo_padrao (seg/unidade) por etapa/produto. Base do gate e do APS. Já é dono no MES.'],
            setup:    ['Setup Matrix (F0)','F0','Matriz de troca família→família por processo (minutos). Reusa setup_matrix. Base da heurística do APS.'],
            bom:      ['BOM (F0)','F0','Lista técnica: consumo de fio/MP por SKU. Habilita o check de fio no gate e o desacople híbrido no semiacabado.'],
        };
        const [titulo, fase, desc] = M[nome] || [nome, 'shell', ''];
        const f = FASE[fase] || FASE.shell;
        $('n1-pan-' + nome).innerHTML = `
        <div class="summary-card" style="border-left:3px solid ${f.cor};">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
                <span class="s-label" style="margin:0;">${esc(titulo)}</span>
                <span style="font-size:.64rem;font-weight:700;padding:1px 8px;border-radius:5px;background:${f.cor}22;color:${f.cor};border:1px solid ${f.cor}55;">${f.label}</span>
            </div>
            <p style="font-size:.82rem;color:var(--text-dim);line-height:1.5;">${esc(desc)}</p>
            <button class="btn secondary" style="font-size:.74rem;margin-top:10px;" onclick="n1.tab('painel')">← Painel do Laço</button>
        </div>`;
    },
};

document.addEventListener('DOMContentLoaded', () => n1.init());
