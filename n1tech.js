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
        // login por link: ?token=...
        const urlTok = new URLSearchParams(location.search).get('token');
        if (urlTok) { localStorage.setItem(TOKEN_KEY, urlTok); try { history.replaceState({}, document.title, location.pathname); } catch {} }

        if (!localStorage.getItem(TOKEN_KEY)) return this._mostrarLogin();
        const ok = await this._auth();
        if (ok === false) return this._mostrarLogin();
        this._mostrarApp();
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
        ['painel','pulmoes','sugeridas','netting','gargalo','fila','pwa','apont','kpi','dbm','tempos','politica','roteiros','tcad','setup','bom'].forEach(t => {
            const pan = $('n1-pan-' + t); if (pan) pan.style.display = t === nome ? 'block' : 'none';
        });
        document.querySelectorAll('[data-n1tab]').forEach(li => li.classList.toggle('active', li.dataset.n1tab === nome));
        const R = { painel:'_renderPainel', roteiros:'_renderRoteiros', tcad:'_renderTempos', setup:'_renderSetup', bom:'_renderBom' };
        if (R[nome]) this[R[nome]]();
        else this._placeholder(nome);
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
                <div class="s-label" style="margin-bottom:6px;">📋 BOM — lista técnica (consumo de fio/MP por SKU)</div>
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
            <div class="s-label" style="margin-bottom:4px;">📋 BOM — lista técnica (consumo de fio/MP por SKU)</div>
            <p style="font-size:.76rem;color:var(--text-dim);"><strong>${(bom || []).length}</strong> linha(s). Popular via ETL do ERP (F1 ①) ou cadastro. Sem BOM, o check de fio do gate fica desligado para o SKU.</p>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:60vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;"><th class="n1-th">SKU</th><th class="n1-th">DESCRIÇÃO</th><th class="n1-th">MATERIAL (fio/MP)</th><th class="n1-th" style="text-align:right;">CONSUMO/UN</th></tr></thead>
            <tbody>${linhas || '<tr><td class="n1-td" colspan="4" style="text-align:center;color:var(--text-dim);padding:20px;">BOM vazia — nenhuma linha cadastrada ainda.</td></tr>'}</tbody></table></div></div>`;
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
        <div class="summary-card" style="margin-top:16px;">
            <div class="s-label" style="margin-bottom:6px;">⚠ DECISÃO DE ARQUITETURA PENDENTE</div>
            <p style="font-size:.78rem;color:var(--text-dim);">O spec do N1Tech recria peças que já existem no APS/SIGS/MES (ledger, sequência, kanban/pulmão, TOC, heijunka). Antes das migrations (F0/F1) é preciso decidir se o N1Tech <strong>reusa</strong> as tabelas existentes ou cria as suas <strong>próprias</strong> (spec ao pé da letra). Ver conversa.</p>
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
