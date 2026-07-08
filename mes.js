// ============================================================================
// MES Malha Forte — frontend standalone (não depende do app.js do SIGS)
// ============================================================================

// ── Helpers básicos ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
// Seguro DENTRO de onclick="fn('...')": escapa barra/aspa p/ o parser JS e DEPOIS esc() p/ o HTML.
// (esc() antes do replace de aspa não protege — o &#39; é decodificado de volta para ' no atributo.)
const escJS = s => esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
// URL de foto segura: só aceita data:image/ ou http(s); senão '' (evita XSS/scheme perigoso no src). Escapar com esc() ao usar.
const fotoUrlSegura = u => { u = String(u ?? ''); return /^(data:image\/|https?:\/\/)/i.test(u) ? u : ''; };
const TOKEN_KEY = 'sin1_token';
function toast(msg, tipo = 'ok') {
    let el = $('mf-toast');
    if (!el) { el = document.createElement('div'); el.id = 'mf-toast';
        el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2000;padding:12px 22px;border-radius:8px;font-size:.85rem;font-weight:600;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.4);transition:opacity .3s;';
        document.body.appendChild(el); }
    el.style.background = tipo === 'erro' ? '#c62828' : tipo === 'aviso' ? '#ef6c00' : '#2e7d32';
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 3500);
}

// ── API ─────────────────────────────────────────────────────────────────────
const api = {
    _h() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') }; },
    async get(url)      { const r = await fetch(url, { headers: this._h() }); if (r.status === 401) return mf._expirou(); return r.ok ? r.json() : null; },
    async post(url, b)  { const r = await fetch(url, { method:'POST', headers: this._h(), body: JSON.stringify(b) }); if (r.status === 401) return mf._expirou(); return r.json().catch(() => null); },
    async put(url, b)   { const r = await fetch(url, { method:'PUT',  headers: this._h(), body: JSON.stringify(b) }); if (r.status === 401) return mf._expirou(); return r.json().catch(() => null); },
    async del(url)      { const r = await fetch(url, { method:'DELETE', headers: this._h() }); if (r.status === 401) return mf._expirou(); return r.json().catch(() => null); },
};

// ── Sidebar (mesmo comportamento do index) ──────────────────────────────────
function toggleNavSection(h3) {
    const s = h3.closest('.nav-section'); if (!s) return;
    s.classList.toggle('nav-section-collapsed');
    localStorage.setItem('nav-sec-' + (h3.dataset.key || 'sec'), s.classList.contains('nav-section-collapsed') ? '1' : '0');
}
function toggleNavGroup(li) {
    if (!li) return; li.classList.toggle('nav-collapsed');
    if (li.id) localStorage.setItem('nav-grp-' + li.id, li.classList.contains('nav-collapsed') ? '1' : '0');
}
function navigateTo(view) { if (view !== 'mes') window.location.href = 'index.html'; }

// ── Fila offline (IndexedDB) ─────────────────────────────────────────────────
// Toda escrita vira uma operação enfileirada com id gerado no cliente. Online,
// é enviada na hora; offline, fica pendente e sobe sozinha quando a rede volta.
const fila = {
    _db: null,
    _open() {
        if (this._db) return Promise.resolve(this._db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('mf-fila', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('ops'))    db.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true });
                if (!db.objectStoreNames.contains('estado')) db.createObjectStore('estado', { keyPath: 'chave' });
            };
            req.onsuccess = () => { this._db = req.result; resolve(this._db); };
            req.onerror   = () => reject(req.error);
        });
    },
    _wrap(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async _store(nome, modo) { const db = await this._open(); return db.transaction(nome, modo).objectStore(nome); },

    async enfileirar(metodo, url, payload) {
        const st = await this._store('ops', 'readwrite');
        await this._wrap(st.add({ metodo, url, payload, criado_em: Date.now() }));
        mf._atualizarBadge();
        this.flush();
        return payload.id;
    },
    async pendentes() { const st = await this._store('ops', 'readonly'); return (await this._wrap(st.getAll())) || []; },
    async _remover(seq) { const st = await this._store('ops', 'readwrite'); return this._wrap(st.delete(seq)); },

    async salvarEstado(chave, valor) { const st = await this._store('estado', 'readwrite'); return this._wrap(st.put({ chave, valor })); },
    async lerEstado(chave) { const st = await this._store('estado', 'readonly'); const r = await this._wrap(st.get(chave)); return r?.valor ?? null; },

    _enviando: false,
    async flush() {
        if (this._enviando || !navigator.onLine) return;
        this._enviando = true;
        let removidos = 0, falhou = 0, parou = false;
        try {
            const ops = (await this.pendentes()).sort((a, b) => a.seq - b.seq);
            const falhas = new Set();   // ids de itens que falharam nesta passada (p/ segurar dependentes, ex.: foto→NC)
            for (const op of ops) {
                // preserva a ordem: se depende de uma NC que falhou agora, segura p/ a próxima passada (não sobe foto órfã)
                if (op.payload?.nc_id && falhas.has(op.payload.nc_id)) { falhou++; continue; }
                let r;
                try { r = await fetch(op.url, { method: op.metodo, headers: api._h(), body: JSON.stringify({ ...op.payload, sincronizado_em: new Date().toISOString() }) }); }
                catch { parou = true; break; } // rede caiu — para e tenta no próximo 'online'
                if (r.status === 401) { mf._expirou(); parou = true; break; }
                if (!r.ok) { falhou++; if (op.payload?.id) falhas.add(op.payload.id); continue; } // rejeitado: PULA e marca p/ segurar dependentes
                await this._remover(op.seq);
                removidos++;
                mf._atualizarBadge();
            }
        } finally {
            this._enviando = false;
            mf._atualizarBadge();
            if (falhou > 0) toast(`${falhou} item(ns) da fila com erro no servidor — serão tentados de novo.`, 'erro');
            const restam = (await this.pendentes()).length;
            // reprocessa enquanto há PROGRESSO (itens enfileirados durante o flush) e ninguém mandou parar (rede/401)
            if (restam > 0 && removidos > 0 && !parou && navigator.onLine) this.flush();
            else if (restam === 0 && navigator.onLine && removidos > 0) { mf._reconciliar(); mf._aoSincronizar(); }
            else if (restam === 0 && navigator.onLine) mf._reconciliar();
        }
    },
};

// ── App principal ────────────────────────────────────────────────────────────
const mf = {
    _cad: { produtos:[], maquinas:[], operadores:[], turnos:[], motivos:[], defeitos:[], ops:[] },
    _abertas: [],
    _abaImport: null,

    async init() {
        // login por link: ?token=... grava o token e limpa a URL (abrir sem digitar senha)
        const qs = new URLSearchParams(location.search);
        const urlTok = qs.get('token');
        if (urlTok) { localStorage.setItem(TOKEN_KEY, urlTok); }
        // modo quiosque: ?maquina=CIRC-01 fixa a máquina deste tablet · deep-link: ?tab=apont
        const km = qs.get('maquina');
        this._tabInicial = qs.get('tab') || null;
        if (km !== null) { if (km) localStorage.setItem('mf_kiosk_maq', km); else localStorage.removeItem('mf_kiosk_maq'); }
        if (urlTok || km !== null || this._tabInicial) { try { history.replaceState({}, document.title, location.pathname); } catch {} }

        // restaura estados de menu colapsado
        document.querySelectorAll('.has-sub[id]').forEach(li => { if (localStorage.getItem('nav-grp-' + li.id) === '1') li.classList.add('nav-collapsed'); });
        document.querySelectorAll('.nav-section-header[data-key]').forEach(h3 => { if (localStorage.getItem('nav-sec-' + h3.dataset.key) === '1') h3.closest('.nav-section')?.classList.add('nav-section-collapsed'); });

        // PWA: service worker (carrega offline) + sincronização ao voltar a rede
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('/mes-sw.js').catch(() => {});
        window.addEventListener('online',  () => { this._atualizarBadge(); fila.flush(); });
        window.addEventListener('offline', () => this._atualizarBadge());

        // restaura cadastros e sessões abertas do cache local (funciona offline)
        try { const c = await fila.lerEstado('cadastros'); if (c) this._cad = c; } catch {}
        try { this._abertas = (await fila.lerEstado('abertas')) || []; } catch {}

        if (!localStorage.getItem(TOKEN_KEY)) return this._mostrarLogin();
        if (navigator.onLine) {
            const ok = await this._carregarCadastros();
            if (ok === false) return this._mostrarLogin();
        } else if (!this._cad.ops.length) {
            // offline e sem cache: não dá pra apontar
            this._mostrarApp(); toast('Offline e sem dados em cache — conecte ao menos uma vez.', 'aviso'); return;
        }
        this._mostrarApp();
        if (this._tabInicial) { try { this.tab(this._tabInicial); } catch {} }
        fila.flush();
    },

    _uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); })); },

    // trava de duplo-toque: bloqueia repetição da mesma ação dentro de 1s (evita sessão/NC/parada duplicada)
    _dup(chave) { const now = Date.now(); this._ts = this._ts || {}; if (this._ts[chave] && now - this._ts[chave] < 1000) return true; this._ts[chave] = now; return false; },

    async _atualizarBadge() {
        const el = $('mf-sync'); if (!el) return;
        let n = 0; try { n = (await fila.pendentes()).length; } catch {}
        if (!navigator.onLine) { el.textContent = `⚠ offline${n?` · ${n} na fila`:''}`; el.style.background = 'rgba(239,108,0,.15)'; el.style.color = '#ef6c00'; }
        else if (n)            { el.textContent = `⏳ sincronizando ${n}...`;        el.style.background = 'rgba(255,202,40,.15)'; el.style.color = '#ffca28'; }
        else                   { el.textContent = '✓ sincronizado';                 el.style.background = 'rgba(38,166,154,.12)'; el.style.color = '#26a69a'; }
    },

    // reconcilia o estado local com o servidor (depois que a fila esvazia)
    async _reconciliar() {
        if (!navigator.onLine) return;
        const srv = await api.get('/api/mf/apontamentos?abertas=1');
        if (!srv) return;
        // preserva sessões otimistas (criadas offline, ainda não confirmadas pelo servidor) — não descarta o que está na fila
        const idsSrv = new Set(srv.map(s => s.id));
        const otimistas = (this._abertas || []).filter(s => s._pendente && !idsSrv.has(s.id));
        // preserva quantidades DIGITADAS mas ainda não salvas (o flush de uma NC/parada re-renderiza —
        // sem isso o número que o operador estava digitando voltava ao valor do servidor)
        const locais = new Map((this._abertas || []).map(s => [s.id, s]));
        this._abertas = [...otimistas, ...srv.map(s => {
            const loc = locais.get(s.id);
            return (loc && loc._qtdDirty)
                ? { ...s, qtd_boa: loc.qtd_boa, qtd_refugo: loc.qtd_refugo, qtd_retrabalho: loc.qtd_retrabalho, _qtdDirty: true }
                : s;
        })];
        await fila.salvarEstado('abertas', this._abertas);
        if (document.querySelector('#app-sidebar .active')?.dataset.mftab === 'apont') this.renderSessoes();
    },

    _expirou() { localStorage.removeItem(TOKEN_KEY); toast('Sessão expirada — faça login.', 'erro'); this._mostrarLogin(); return null; },

    _mostrarLogin() {
        $('view-login').style.display = 'flex';
        $('app-sidebar').style.display = 'none';
        $('view-mes').style.display = 'none';
        $('login-status').style.display = 'none';
        $('login-form-wrap').style.display = 'block';
        const form = $('login-form');
        form.onsubmit = async (e) => {
            e.preventDefault();
            const btn = $('login-submit'), er = $('login-erro');
            if (btn?.disabled) return;                        // M11: trava duplo-envio
            if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
            if (er) er.style.display = 'none';
            try {
                const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ email: $('login-email').value, senha: $('login-senha').value }) });
                const d = await r.json().catch(() => ({}));
                if (r.ok && d.token) { localStorage.setItem(TOKEN_KEY, d.token); location.reload(); return; }
                if (er) { er.style.display = 'block'; er.textContent = d.erro || 'Falha no login'; }
            } catch {
                if (er) { er.style.display = 'block'; er.textContent = 'Sem conexão com o servidor. Tente de novo.'; }
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
            }
        };
    },

    async _mostrarApp() {
        $('view-login').style.display = 'none';
        $('app-sidebar').style.display = 'flex';
        $('view-mes').style.display = 'flex';
        try { const n = JSON.parse(localStorage.getItem('sin1_usuario'))?.nome || '';
            $('mf-user').textContent = n; const sn = $('mf-user-nome'); if (sn) sn.textContent = n || '—'; } catch {}
        this._atualizarBadge();
        this.tab('painel');
    },

    sair() { localStorage.removeItem(TOKEN_KEY); location.reload(); },

    async _carregarCadastros() {
        const [produtos, maquinas, operadores, turnos, motivos, defeitos, ops] = await Promise.all([
            api.get('/api/mf/produtos'), api.get('/api/mf/maquinas'), api.get('/api/mf/operadores'),
            api.get('/api/mf/turnos'), api.get('/api/mf/motivos'), api.get('/api/mf/defeitos'), api.get('/api/mf/ops'),
        ]);
        if (produtos === null) return false; // 401
        this._cad = { produtos:produtos||[], maquinas:maquinas||[], operadores:operadores||[], turnos:turnos||[],
            motivos:motivos||[], defeitos:defeitos||[], ops:ops||[] };
        fila.salvarEstado('cadastros', this._cad).catch(() => {}); // cache p/ uso offline
        return true;
    },

    tab(name) {
        // destaca o item correspondente na sidebar
        document.querySelectorAll('#app-sidebar [data-mftab]').forEach(li => li.classList.toggle('active', li.dataset.mftab === name));
        ['painel','wip','prazo','flxt','capac','andon','estrat','fila','apont','ncs','rnc','ind','cnq','cep','etiq','oms','tpm','setup','cil','cad','rastreio','mat','doc','crono','balanc','produtiv','custo','melhoria','vsm','heijunka','yamazumi','cincos','a3','integ','impops','import'].forEach(t => { const p = $('mf-pan-' + t); if (p) p.style.display = t === name ? 'block' : 'none'; });
        if (this._andonTimer && name !== 'andon') { clearInterval(this._andonTimer); this._andonTimer = null; }
        if (name === 'painel') this.renderPainel();
        if (name === 'wip')    this.renderWip();
        this._abaAtiva = name;
        this._atualizarAndonBadge().catch(() => {});  // mantém o badge de chamados atualizado
        if (name === 'andon')  this.renderAndon();
        if (name === 'setup')  this.renderSetup();
        if (name === 'mat')    this.renderMateriais();
        if (name === 'doc')    this.renderDocumentos();
        if (name === 'crono')  this.renderCrono();
        if (name === 'balanc') this.renderBalanc();
        if (name === 'produtiv') this.renderProdutiv();
        if (name === 'custo')  this.renderCusto();
        if (name === 'melhoria') this.renderMelhoria();
        if (name === 'vsm')      this.renderVsm();
        if (name === 'heijunka') this.renderHeijunka();
        if (name === 'yamazumi') this.renderYamazumi();
        if (name === 'cincos')   this.renderCincoS();
        if (name === 'a3')       this.renderA3();
        if (name === 'integ')  this.renderIntegracoes();
        if (name === 'prazo')  this.renderPrazo();
        if (name === 'flxt')   this.renderFluxoTempo();
        if (name === 'capac')  this.renderCapacidade();
        if (name === 'fila')   this.renderFila();
        if (name === 'estrat') this.renderEstrat();
        if (name === 'apont')  this.renderApont();
        if (name === 'ncs')    this.renderNcs();
        if (name === 'rnc')    this.renderRnc();
        if (name === 'ind')    this.renderInd();
        if (name === 'cnq')    this.renderCnq();
        if (name === 'cep')    this.renderCep();
        if (name === 'cil')    this.renderCil();
        if (name === 'cad')    this.renderCadTpm();
        if (name === 'rastreio') this.renderRastreio();
        if (name === 'etiq')   this.renderEtiquetas();
        if (name === 'oms')    this.renderOms();
        if (name === 'tpm')    this.renderTpm();
        if (name === 'impops') this.renderImportOps();
        if (name === 'import') this.renderImport();
    },

    // ═══ CAPACIDADE × DEMANDA ═══════════════════════════════════════════════════
    async renderCapacidade() {
        const pan = $('mf-pan-capac');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando capacidade...</div>`;
        const horas = this._capacHoras || 8;
        const d = await api.get('/api/mf/capacidade?horas=' + horas);
        if (!d || !Array.isArray(d.etapas)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Capacidade indisponível — rode <strong>mes_leva2.sql</strong> (cria o tempo padrão).</div>`; return; }
        const brl = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
        const semPadrao = d.etapas.filter(e => e.sem_padrao).length, g = d.gargalo;
        const tpGrid = d.etapas.map(e => `<div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:.78rem;flex:1;">${e.ordem}. ${esc(e.nome)} <span style="color:var(--text-dim);">(${e.maquinas} máq)</span></span>
            <input type="number" min="0" step="0.1" value="${e.seg_padrao != null ? e.seg_padrao : ''}" placeholder="seg/pç" onchange="mf.salvarTempo('${e.etapa_id}', this.value)"
                style="width:90px;padding:4px 8px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.8rem;text-align:right;"></div>`).join('');
        pan.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                <div class="s-label">🏭 CAPACIDADE × DEMANDA — dá pra entregar?</div>
                <span style="font-size:.82rem;color:var(--text-dim);">horas/dia por máquina: <input type="number" min="1" max="24" value="${horas}" onchange="mf._capacHoras=+this.value;mf.renderCapacidade()" style="width:56px;padding:4px 6px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.82rem;text-align:right;"></span>
            </div>
            <div id="mf-capac-result">${this._capacResultadoHTML(d, horas)}</div>
            <div class="summary-card">
                <div class="s-label" style="margin-bottom:6px;">⚙ TEMPOS PADRÃO POR ETAPA (segundos por peça)${semPadrao ? ` <span style="color:#ffca28;font-size:.7rem;">— ${semPadrao} sem definir</span>` : ''}</div>
                <div style="font-size:.74rem;color:var(--text-dim);margin-bottom:10px;">É a base de tudo: capacidade, lead time e OEE de verdade. Comece com uma estimativa por etapa e refine com o tempo.</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;">${tpGrid}</div>
            </div>`;
    },
    _capacResultadoHTML(d, horas) {
        const brl = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
        const g = d.gargalo, semPadrao = d.etapas.filter(e => e.sem_padrao).length;
        const maxH = Math.max(1, ...d.etapas.map(e => e.horas_necessarias));
        const barras = d.etapas.map(e => {
            const garg = g && e.nome === g.nome, cor = e.sem_padrao ? '#8b949e' : (garg ? '#f06292' : '#26a69a');
            const w = Math.round(e.horas_necessarias / maxH * 100);
            const diasTxt = e.sem_padrao ? '<span style="color:#ffca28;">sem tempo padrão</span>' : (e.maquinas === 0 ? '<span style="color:#ffca28;">sem máquina</span>' : (e.dias_para_zerar != null ? `<strong>${e.dias_para_zerar} dias</strong> p/ zerar` : '—'));
            return `<div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:3px;gap:8px;">
                    <span>${e.ordem}. ${esc(e.nome)} ${garg ? '<span style="color:#f06292;font-weight:700;font-size:.6rem;">● RESTRIÇÃO</span>' : ''}</span>
                    <span style="color:var(--text-dim);white-space:nowrap;">${brl(e.horas_necessarias)}h backlog · ${brl(e.horas_disp_dia)}h/dia · ${diasTxt}</span>
                </div>
                <div style="height:9px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.max(2, w)}%;background:${cor};transition:width .4s;"></div></div>
            </div>`;
        }).join('');
        return `${g ? `<div class="summary-card" style="margin-bottom:14px;border-left:3px solid #f06292;">
                <div style="font-size:.92rem;line-height:1.5;">Restrição: <strong style="color:#f06292;">${esc(g.nome)}</strong> — com ${g.maquinas} máquina(s) a ${horas}h/dia, leva <strong>${g.dias_para_zerar} dias</strong> para zerar o backlog (${brl(g.horas_necessarias)}h de trabalho). É aqui que se ganha ou perde a entrega.</div>
            </div>` : (semPadrao === d.etapas.length ? `<div class="summary-card" style="margin-bottom:14px;color:#ffca28;">Defina os tempos padrão abaixo para o cálculo de capacidade aparecer.</div>` : '')}
            <div class="summary-card" style="margin-bottom:16px;">
                <div class="s-label" style="margin-bottom:12px;">CARGA POR ETAPA (horas de backlog)${d.ops_ativas ? ` · ${d.ops_ativas} OPs ativas` : ''}</div>
                ${barras}
            </div>`;
    },
    async salvarTempo(etapaId, v) {
        const r = await api.put('/api/mf/tempos', { etapa_id: etapaId, seg_por_unidade: parseFloat(v) || 0 });
        if (!r?.ok) return toast(r?.erro || 'Erro ao salvar.', 'erro');
        toast('Tempo padrão salvo.', 'ok');
        const d = await api.get('/api/mf/capacidade?horas=' + (this._capacHoras || 8));  // atualiza só o resultado, mantém o foco no grid
        const el = $('mf-capac-result'); if (el && d?.etapas) el.innerHTML = this._capacResultadoHTML(d, this._capacHoras || 8);
    },

    // ═══ FLUXO NO TEMPO (tendência) ════════════════════════════════════════════
    async renderFluxoTempo() {
        const pan = $('mf-pan-flxt');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando tendência...</div>`;
        const dias = this._flxtDias || 14;
        const d = await api.get('/api/mf/fluxo-tempo?dias=' + dias);
        if (!d || !Array.isArray(d.serie)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Fluxo não inicializado — rode os SQLs do WIP.</div>`; return; }
        const brl = n => Number(n || 0).toLocaleString('pt-BR');
        const wipTot = d.etapas.reduce((s, e) => s + e.wip_ops, 0), wipQtd = d.etapas.reduce((s, e) => s + e.wip_qtd, 0);
        const card = (cor, val, lbl, sub) => `<div style="background:${cor}14;border:1px solid ${cor}3a;border-radius:12px;padding:14px 18px;flex:1;min-width:150px;">
            <div style="font-size:1.6rem;font-weight:800;color:${cor};">${val}</div><div style="font-size:.62rem;color:${cor};letter-spacing:.04em;">${lbl}</div>${sub ? `<div style="font-size:.66rem;color:var(--text-dim);margin-top:2px;">${sub}</div>` : ''}</div>`;
        const maxQ = Math.max(1, ...d.serie.map(s => s.qtd));
        const barras = d.serie.map(s => {
            const h = Math.round(s.qtd / maxQ * 100), dd = s.dia.slice(8, 10) + '/' + s.dia.slice(5, 7);
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:13px;">
                <div style="font-size:.54rem;color:var(--text-dim);height:10px;">${s.qtd || ''}</div>
                <div style="width:72%;height:88px;display:flex;align-items:flex-end;"><div style="width:100%;height:${h}%;background:#26c6da;border-radius:3px 3px 0 0;min-height:${s.qtd ? 2 : 0}px;" title="${dd}: ${s.qtd}"></div></div>
                <div style="font-size:.52rem;color:var(--text-dim);">${dd}</div>
            </div>`;
        }).join('');
        const maxWip = Math.max(1, ...d.etapas.map(e => e.wip_qtd));
        const etapasHtml = d.etapas.map(e => {
            const garg = d.gargalo && e.nome === d.gargalo.nome, cor = garg ? '#f06292' : '#26a69a';
            const w = Math.round(e.wip_qtd / maxWip * 100);
            return `<div style="margin-bottom:9px;">
                <div style="display:flex;justify-content:space-between;font-size:.74rem;margin-bottom:3px;gap:8px;">
                    <span>${e.ordem}. ${esc(e.nome)} ${garg ? '<span style="color:#f06292;font-weight:700;font-size:.6rem;">● GARGALO</span>' : ''}</span>
                    <span style="color:var(--text-dim);white-space:nowrap;">${e.wip_ops} OP · ${brl(e.wip_qtd)}${e.throughput_dia ? ` | ${e.throughput_dia}/d` : ''}${e.dias_fila != null ? ` · fila ${e.dias_fila}d` : ''}${e.lead_horas != null ? ` · ${e.lead_horas}h` : ''}</span>
                </div>
                <div style="height:8px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.max(2, w)}%;background:${cor};transition:width .4s;"></div></div>
            </div>`;
        }).join('');
        pan.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                <div class="s-label">📈 FLUXO NO TEMPO</div>
                <select onchange="mf._flxtDias=+this.value;mf.renderFluxoTempo()" style="padding:5px 8px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.8rem;">
                    ${[7, 14, 30].map(n => `<option value="${n}" ${dias === n ? 'selected' : ''}>últimos ${n} dias</option>`).join('')}
                </select>
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                ${card('#26c6da', brl(d.throughput_7d), 'PRODUZIDO (7 DIAS)', 'soma da qtd boa')}
                ${card('#7c4dff', wipTot, 'WIP ATUAL (OPs)', brl(wipQtd) + ' pç em processo')}
                ${card(d.gargalo ? '#f06292' : '#26a69a', d.gargalo ? esc(d.gargalo.nome) : '—', 'GARGALO', d.gargalo && d.gargalo.dias_fila != null ? d.gargalo.dias_fila + ' dias de fila' : 'sem acúmulo')}
            </div>
            <div class="summary-card" style="margin-bottom:16px;">
                <div class="s-label" style="margin-bottom:14px;">PRODUÇÃO POR DIA (qtd boa) — ${dias} dias</div>
                <div style="display:flex;align-items:flex-end;gap:2px;">${barras}</div>
            </div>
            <div class="summary-card">
                <div class="s-label" style="margin-bottom:12px;">WIP POR ETAPA (gargalo em vermelho)</div>
                ${etapasHtml || '<div style="color:var(--text-dim);">Sem OPs no fluxo no momento.</div>'}
            </div>`;
    },

    // ═══ PRAZO & RISCO DE ENTREGA ══════════════════════════════════════════════
    _riscoOp(o, hoje, leadDias, totalEtapas) {
        if (['concluida', 'cancelada'].includes(o.status)) return { nivel: 'done' };
        const prev = o.data_prevista ? new Date(o.data_prevista) : null;
        const etapaOrdem = o.etapa?.ordem || 0;
        const restanteFrac = o.etapa_atual_id ? Math.max(0.1, (totalEtapas - etapaOrdem + 1) / totalEtapas) : 1;  // fora do fluxo = falta tudo
        const diasRestantes = leadDias * restanteFrac;
        if (!prev) return { nivel: 'verde', label: 'sem previsão', dias: null };
        const diasAteprazo = Math.round((prev - hoje) / 864e5);
        if (diasAteprazo < 0) return { nivel: 'vermelho', label: 'atrasada', dias: diasAteprazo };
        const folga = Math.round(diasAteprazo - diasRestantes);
        if (folga < 0) return { nivel: 'vermelho', label: 'vai atrasar', dias: diasAteprazo, folga };
        if (folga <= leadDias * 0.5) return { nivel: 'amarelo', label: 'aperta', dias: diasAteprazo, folga };
        return { nivel: 'verde', label: 'no prazo', dias: diasAteprazo, folga };
    },
    async renderPrazo() {
        const pan = $('mf-pan-prazo');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando prazos...</div>`;
        const [ops, etapas] = await Promise.all([api.get('/api/mf/ops'), api.get('/api/mf/etapas-processo')]);
        if (!Array.isArray(ops)) { pan.innerHTML = `<div class="summary-card" style="color:#f06292;">Não foi possível carregar as OPs.</div>`; return; }
        this._prazoOps = ops; this._prazoEtapas = (Array.isArray(etapas) && etapas.length) || 8;
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span class="s-label" style="margin:0;">⏱ LEAD TIME ESTIMADO POR OP</span>
                <input id="mf-prazo-lead" type="number" min="0.5" step="0.5" value="${this._prazoLead || 7}" onchange="mf._prazoCalc()" style="width:70px;padding:5px 8px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.85rem;text-align:right;"> dias
                <span style="font-size:.74rem;color:var(--text-dim);">tempo que uma OP leva para atravessar o fluxo inteiro — ajuste para a sua realidade</span>
            </div>
            <div id="mf-prazo-cards" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;"></div>
            <div id="mf-prazo-tab"></div>`;
        this._prazoCalc();
    },
    _prazoCalc() {
        const leadDias = parseFloat($('mf-prazo-lead')?.value) || 7; this._prazoLead = leadDias;
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const total = this._prazoEtapas;
        const ops = (this._prazoOps || []).map(o => ({ o, r: this._riscoOp(o, hoje, leadDias, total) }));
        const ativos = ops.filter(x => x.r.nivel !== 'done');
        const cont = { vermelho: 0, amarelo: 0, verde: 0 }, qtd = { vermelho: 0, amarelo: 0, verde: 0 };
        ativos.forEach(x => { cont[x.r.nivel]++; qtd[x.r.nivel] += Number(x.o.qtd_planejada || 0); });
        const done = ops.length - ativos.length;
        const card = (cor, emoji, n, lbl, q) => `<div style="background:${cor}14;border:1px solid ${cor}3a;border-radius:12px;padding:14px 18px;flex:1;min-width:150px;">
            <div style="font-size:1.7rem;font-weight:800;color:${cor};">${emoji} ${n}</div><div style="font-size:.62rem;color:${cor};letter-spacing:.04em;">${lbl}</div>
            <div style="font-size:.66rem;color:var(--text-dim);margin-top:2px;">${Number(q).toLocaleString('pt-BR')} pç</div></div>`;
        $('mf-prazo-cards').innerHTML =
            card('#f06292', '🔴', cont.vermelho, 'ATRASADAS / VÃO ATRASAR', qtd.vermelho) +
            card('#ffca28', '🟡', cont.amarelo, 'EM RISCO (APERTA)', qtd.amarelo) +
            card('#26a69a', '🟢', cont.verde, 'NO PRAZO', qtd.verde) +
            `<div style="background:#7c4dff14;border:1px solid #7c4dff3a;border-radius:12px;padding:14px 18px;flex:1;min-width:120px;"><div style="font-size:1.7rem;font-weight:800;color:#7c4dff;">✓ ${done}</div><div style="font-size:.62rem;color:#7c4dff;">CONCLUÍDAS / CANCELADAS</div></div>`;
        const rank = { vermelho: 0, amarelo: 1, verde: 2 };
        ativos.sort((a, b) => (rank[a.r.nivel] - rank[b.r.nivel]) || ((a.r.dias ?? 9999) - (b.r.dias ?? 9999)));
        const dt = s => s ? new Date(s).toLocaleDateString('pt-BR') : '—';
        const cores = { vermelho: '#f06292', amarelo: '#ffca28', verde: '#26a69a' }, emoji = { vermelho: '🔴', amarelo: '🟡', verde: '🟢' };
        const linhas = ativos.slice(0, 400).map(({ o, r }) => {
            const cor = cores[r.nivel];
            const diasTxt = r.dias == null ? '—' : (r.dias < 0 ? `<span style="color:#f06292;">${r.dias}d</span>` : `${r.dias}d` + (r.folga != null ? ` <span style="color:var(--text-dim);">(folga ${r.folga})</span>` : ''));
            const pos = o.etapa ? `${o.etapa.ordem}/${this._prazoEtapas} ${esc(o.etapa.nome)}` : '<span style="color:var(--text-dim);">fora do fluxo</span>';
            return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);border-left:3px solid ${cor};">
                <td style="padding:6px 8px;white-space:nowrap;">${emoji[r.nivel]} <span style="font-size:.66rem;color:${cor};">${r.label}</span></td>
                <td style="padding:6px 8px;font-weight:600;">${esc(o.numero)}</td>
                <td style="padding:6px 8px;">${esc(o.produto?.descricao || '?')}<span style="color:var(--text-dim);font-size:.72rem;"> ${esc(o.produto?.tamanho || '')}</span></td>
                <td style="padding:6px 8px;text-align:right;white-space:nowrap;">${Number(o.qtd_planejada || 0).toLocaleString('pt-BR')} ${esc(o.unidade || '')}</td>
                <td style="padding:6px 8px;white-space:nowrap;">${dt(o.data_prevista)}</td>
                <td style="padding:6px 8px;white-space:nowrap;">${diasTxt}</td>
                <td style="padding:6px 8px;">${pos}</td>
                <td style="padding:6px 8px;">${Number(o.prioridade || 0) >= 2 ? '<span style="font-size:.62rem;color:#f06292;">● urgente</span>' : Number(o.prioridade || 0) === 1 ? '<span style="font-size:.62rem;color:#ffca28;">● alta</span>' : ''}</td>
            </tr>`;
        }).join('');
        $('mf-prazo-tab').innerHTML = `<div class="summary-card" style="padding:0;overflow:auto;max-height:60vh;">
            <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                <thead><tr style="position:sticky;top:0;background:var(--bg-card);z-index:1;text-align:left;color:var(--text-dim);font-size:.64rem;letter-spacing:.04em;">
                    <th style="padding:8px;">RISCO</th><th style="padding:8px;">Nº OP</th><th style="padding:8px;">PRODUTO</th><th style="padding:8px;text-align:right;">QTD</th><th style="padding:8px;">PREVISÃO</th><th style="padding:8px;">PRAZO</th><th style="padding:8px;">POSIÇÃO</th><th style="padding:8px;"></th>
                </tr></thead><tbody>${linhas || '<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-dim);">Nenhuma OP ativa.</td></tr>'}</tbody>
            </table></div>`;
    },
    // Onda 2: urgência (prioridade) define-se no APS. Aqui a tela só mostra o risco.
    prazoUrgente() { toast('Marque a urgência no APS › Sequenciamento (dono único da prioridade).', 'info'); },

    // ═══ FILA / BACKLOG DE OPs ═════════════════════════════════════════════════
    _filaStatusCor(s) { return { planejada:'#8b949e', liberada:'#26c6da', em_producao:'#66bb6a', pausada:'#ffca28', concluida:'#7c4dff', cancelada:'#f06292' }[s] || '#8b949e'; },
    async renderFila() {
        const pan = $('mf-pan-fila');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando fila de OPs...</div>`;
        const ops = await api.get('/api/mf/ops');
        if (!Array.isArray(ops)) { pan.innerHTML = `<div class="summary-card" style="color:#f06292;">Não foi possível carregar as OPs.</div>`; return; }
        this._fila = ops;
        this._filaSel = this._filaSel || new Set();
        const sts = ['', 'planejada', 'liberada', 'em_producao', 'pausada', 'concluida', 'cancelada'];
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;">
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
                    <div style="flex:1;min-width:160px;"><span class="mf-label">BUSCAR (nº ou produto)</span><input id="mf-fila-q" class="mf-input" oninput="mf._filaTabela()" placeholder="ex: 17801 ou joelheira"></div>
                    <div><span class="mf-label">STATUS</span><select id="mf-fila-st" class="mf-input" onchange="mf._filaTabela()">${sts.map(s => `<option value="${s}">${s || 'todos'}</option>`).join('')}</select></div>
                    <div><span class="mf-label">FLUXO</span><select id="mf-fila-fl" class="mf-input" onchange="mf._filaTabela()"><option value="">todas</option><option value="fora">fora do fluxo</option><option value="no">no fluxo</option></select></div>
                    <div><span class="mf-label">ORDENAR</span><select id="mf-fila-or" class="mf-input" onchange="mf._filaTabela()"><option value="seq">sequência sugerida</option><option value="prev">por previsão</option><option value="num">por número</option><option value="qtd">maior qtd</option></select></div>
                </div>
            </div>
            <div id="mf-fila-bar" style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;"></div>
            <div id="mf-fila-tab"></div>
            <style>.mf-input{padding:7px 10px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.82rem;}</style>`;
        this._filaTabela();
    },
    _filaBarra() {
        const totalFora = (this._fila || []).filter(o => !o.etapa_atual_id && !['concluida', 'cancelada'].includes(o.status)).length;
        const bar = $('mf-fila-bar'); if (!bar) return;
        bar.innerHTML = `<span style="font-size:.8rem;color:var(--text-dim);">${(this._filaVisiveis || []).length} OPs na lista · ${totalFora} fora do fluxo</span>
            <span style="margin-left:auto;font-size:.82rem;">${this._filaSel.size} selecionada(s)</span>
            <button class="btn primary" style="font-size:.78rem;" ${this._filaSel.size ? '' : 'disabled'} onclick="mf.filaJogarFluxo()">▶ Jogar no fluxo (1ª etapa)</button>`;
    },
    _filaTabela() {
        const q = ($('mf-fila-q')?.value || '').trim().toLowerCase();
        const st = $('mf-fila-st')?.value || '', fl = $('mf-fila-fl')?.value || '', or = $('mf-fila-or')?.value || 'seq';
        let lista = (this._fila || []).filter(o => {
            if (st && o.status !== st) return false;
            if (fl === 'fora' && o.etapa_atual_id) return false;
            if (fl === 'no' && !o.etapa_atual_id) return false;
            if (q) { const hay = (o.numero + ' ' + (o.produto?.descricao || '') + ' ' + (o.produto?.codigo || '') + ' ' + (o.produto?.marca || '')).toLowerCase(); if (!hay.includes(q)) return false; }
            return true;
        });
        const prev = o => String(o.data_prevista || o.data_abertura || '9999-12-31');
        lista.sort((a, b) => {
            if (or === 'num') return String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true });
            if (or === 'qtd') return Number(b.qtd_planejada) - Number(a.qtd_planejada);
            if (or === 'prev') return prev(a).localeCompare(prev(b));
            // sequência sugerida: prioridade (desc) → previsão/EDD (asc) → número
            const pa = Number(a.prioridade || 0), pb = Number(b.prioridade || 0);
            if (pa !== pb) return pb - pa;
            const dp = prev(a).localeCompare(prev(b));
            return dp || String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true });
        });
        this._filaVisiveis = lista.map(o => o.id);
        const brl = n => Number(n || 0).toLocaleString('pt-BR');
        const dt = s => s ? new Date(s).toLocaleDateString('pt-BR') : '—';
        const PR = { 0: ['normal', 'transparent'], 1: ['alta', '#ffca28'], 2: ['urgente', '#f06292'] };
        const linhas = lista.slice(0, 400).map((o, i) => {
            const cor = this._filaStatusCor(o.status);
            const foraFluxo = !o.etapa_atual_id && !['concluida', 'cancelada'].includes(o.status);
            const pos = o.etapa ? `${o.etapa.ordem}. ${esc(o.etapa.nome)}` : '<span style="color:var(--text-dim);">fora do fluxo</span>';
            const p = Math.max(0, Math.min(2, Number(o.prioridade) || 0));  // M1: clampa 0-2 (PR só tem essas chaves)
            return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);border-left:3px solid ${PR[p][1]};">
                <td style="padding:6px 8px;">${foraFluxo ? `<input type="checkbox" ${this._filaSel.has(o.id) ? 'checked' : ''} onchange="mf._filaToggle('${o.id}')">` : ''}</td>
                <td style="padding:6px 8px;color:var(--text-dim);text-align:right;">${or === 'seq' ? i + 1 : '·'}</td>
                <td style="padding:6px 8px;font-weight:600;">${esc(o.numero)}</td>
                <td style="padding:6px 8px;">${esc(o.produto?.descricao || '?')}<span style="color:var(--text-dim);font-size:.72rem;"> ${esc(o.produto?.codigo || '')}${o.produto?.tamanho ? ` · ${esc(o.produto.tamanho)}` : ''}${o.produto?.marca ? ` · ${esc(o.produto.marca)}` : ''}</span></td>
                <td style="padding:6px 8px;text-align:right;white-space:nowrap;">${brl(o.qtd_planejada)} ${esc(o.unidade || '')}</td>
                <td style="padding:6px 8px;"><span title="Prioridade definida no APS (Sequenciamento). O chão só exibe." style="font-size:.66rem;padding:1px 7px;border-radius:5px;border:1px solid ${PR[p][1] === 'transparent' ? 'var(--border-color)' : PR[p][1]};color:${PR[p][1] === 'transparent' ? 'var(--text-dim)' : PR[p][1]};">${PR[p][0]}</span></td>
                <td style="padding:6px 8px;"><span style="font-size:.66rem;color:${cor};border:1px solid ${cor}55;border-radius:4px;padding:1px 6px;">${esc(o.status)}</span></td>
                <td style="padding:6px 8px;white-space:nowrap;">${dt(o.data_prevista)}</td>
                <td style="padding:6px 8px;">${pos}</td>
            </tr>`;
        }).join('');
        $('mf-fila-tab').innerHTML = `
            <div class="summary-card" style="padding:0;overflow:auto;max-height:62vh;">
                <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                    <thead><tr style="position:sticky;top:0;background:var(--bg-card);z-index:1;text-align:left;color:var(--text-dim);font-size:.64rem;letter-spacing:.04em;">
                        <th style="padding:8px;"><input type="checkbox" onchange="mf._filaToggleAll(this.checked)" title="selecionar visíveis (fora do fluxo)"></th>
                        <th style="padding:8px;text-align:right;">#</th><th style="padding:8px;">Nº OP</th><th style="padding:8px;">PRODUTO</th><th style="padding:8px;text-align:right;">QTD</th><th style="padding:8px;">PRIO</th><th style="padding:8px;">STATUS</th><th style="padding:8px;">PREVISÃO</th><th style="padding:8px;">POSIÇÃO NO FLUXO</th>
                    </tr></thead>
                    <tbody>${linhas || '<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--text-dim);">Nenhuma OP com esses filtros.</td></tr>'}</tbody>
                </table>
            </div>${lista.length > 400 ? `<div style="font-size:.72rem;color:var(--text-dim);margin-top:6px;">Mostrando as primeiras 400 de ${lista.length}. Refine os filtros.</div>` : ''}`;
        this._filaBarra();
    },
    _filaToggle(id) { if (this._filaSel.has(id)) this._filaSel.delete(id); else this._filaSel.add(id); this._filaBarra(); },
    _filaToggleAll(on) {
        (this._filaVisiveis || []).forEach(id => { const o = this._fila.find(x => x.id === id); if (o && !o.etapa_atual_id && !['concluida', 'cancelada'].includes(o.status)) { if (on) this._filaSel.add(id); else this._filaSel.delete(id); } });
        this._filaTabela();
    },
    // Onda 2: prioridade tem dono único (APS). O MES só exibe — não grava mais.
    salvarPrioridade() { toast('A prioridade agora se define no APS › Sequenciamento (dono único). O chão apenas segue a fila.', 'info'); },
    async filaJogarFluxo() {
        const ids = [...this._filaSel]; if (!ids.length) return;
        const r = await api.post('/api/mf/wip/iniciar-lote', { op_ids: ids });
        toast(r?.ok ? `${r.inseridas} OP(s) entraram no fluxo.` : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) { this._filaSel = new Set(); this.renderFila(); }
    },

    // ═══ ANDON — chamado em tempo real ═════════════════════════════════════════
    formAndon(apId) {
        const a = this._abertas.find(x => x.id === apId) || {};
        const tipos = [['ajuda', '🙋 Preciso de ajuda'], ['parada', '⛔ Linha parada'], ['qualidade', '⚠ Problema de qualidade'], ['material', '📦 Falta material']];
        this._modal(`
            <div class="s-label" style="margin-bottom:14px;color:#ff5252;">🆘 CHAMADO ANDON${a.etapa_nome ? ` · ${esc(a.etapa_nome)}` : ''}</div>
            <div id="mf-andon-tipo" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
                ${tipos.map((t, i) => `<label style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:.86rem;"><input type="radio" name="andtipo" value="${t[0]}" ${i === 0 ? 'checked' : ''}> ${t[1]}</label>`).join('')}
            </div>
            <span class="mf-label">DETALHE (opcional)</span><input id="mf-andon-desc" class="mf-input" placeholder="o que está acontecendo" style="margin-bottom:16px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button>
                <button class="btn primary" style="background:#ff5252;border-color:#ff5252;" onclick="mf.salvarAndon('${apId}')">🆘 Chamar</button>
            </div>`);
    },
    async salvarAndon(apId) {
        const a = this._abertas.find(x => x.id === apId) || {};
        const tipo = document.querySelector('#mf-andon-tipo input:checked')?.value || 'ajuda';
        const desc = $('mf-andon-desc')?.value || null;
        this._fecharModal();
        const r = await api.post('/api/mf/andon', { tipo, descricao: desc, op_id: a.op_id || null, operador_id: a.operador_id || null, etapa_id: a.etapa_id || null });
        toast(r?.ok ? '🆘 Chamado aberto — supervisor avisado.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        this._atualizarAndonBadge();
    },
    async renderAndon() {
        const pan = $('mf-pan-andon');
        if (!pan.innerHTML) pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando chamados...</div>`;
        const lista = await api.get('/api/mf/andon');
        if (!Array.isArray(lista)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Andon não inicializado — rode <strong>mes_andon.sql</strong> e recarregue.</div>`; return; }
        this._atualizarAndonBadge(lista.length);
        const TIPO = { ajuda: ['🙋', 'Ajuda', '#26c6da'], parada: ['⛔', 'Linha parada', '#f06292'], qualidade: ['⚠', 'Qualidade', '#ffca28'], material: ['📦', 'Material', '#7c4dff'] };
        const min = iso => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
        const cards = lista.map(c => {
            const [emo, lbl, cor] = TIPO[c.tipo] || ['🆘', c.tipo, '#ff5252'];
            const m = min(c.aberto_em), ec = m >= 15 ? '#f06292' : m >= 5 ? '#ffca28' : '#26a69a';
            return `<div style="background:${cor}10;border:1px solid ${cor}44;border-left:4px solid ${ec};border-radius:10px;padding:12px 14px;min-width:230px;flex:1;max-width:330px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <strong style="color:${cor};">${emo} ${lbl}</strong>
                    <span style="font-size:.72rem;color:${ec};font-weight:700;">há ${m} min</span>
                </div>
                <div style="font-size:.8rem;margin:5px 0;">${c.etapa ? `${c.etapa.ordem}. ${esc(c.etapa.nome)} · ` : ''}${esc(c.maquina?.codigo || '')} ${esc(c.operador?.nome || '')}${c.op ? ` · OP ${esc(c.op.numero)}` : ''}</div>
                ${c.descricao ? `<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:6px;">"${esc(c.descricao)}"</div>` : ''}
                <div style="display:flex;gap:6px;margin-top:6px;">
                    ${c.status === 'aberto' ? `<button class="btn secondary" style="font-size:.74rem;flex:1;" onclick="mf.acaoAndon('${c.id}','atender')">▶ Atender</button>` : `<span style="font-size:.72rem;color:#26a69a;flex:1;align-self:center;">● em atendimento${c.atendido_por ? ' (' + esc(c.atendido_por) + ')' : ''}</span>`}
                    <button class="btn primary" style="font-size:.74rem;flex:1;" onclick="mf.acaoAndon('${c.id}','resolver')">✓ Resolver</button>
                </div>
            </div>`;
        }).join('');
        pan.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
                <div class="s-label">🆘 ANDON — CHAMADOS ABERTOS (${lista.length})</div>
                <span style="font-size:.72rem;color:var(--text-dim);">atualiza sozinho · 🟢 &lt;5min · 🟡 &lt;15min · 🔴 +15min</span>
            </div>
            ${lista.length ? `<div style="display:flex;gap:12px;flex-wrap:wrap;">${cards}</div>` : `<div class="summary-card" style="text-align:center;padding:30px;color:#26a69a;">✓ Nenhum chamado aberto — chão tranquilo.</div>`}`;
        if (!this._andonTimer) this._andonTimer = setInterval(() => { const p = $('mf-pan-andon'); if (p && p.style.display !== 'none') this.renderAndon(); }, 8000);
    },
    async acaoAndon(id, acao) {
        const r = await api.put('/api/mf/andon/' + id, { acao, por: 'Supervisor' });
        if (r?.ok) this.renderAndon(); else toast(r?.erro || 'Erro.', 'erro');
    },
    async _atualizarAndonBadge(n) {
        if (n == null) { const l = await api.get('/api/mf/andon'); n = Array.isArray(l) ? l.length : 0; }
        const b = $('mf-andon-badge'); if (b) { b.textContent = n; b.style.display = n > 0 ? 'inline-block' : 'none'; }
    },

    // ═══ SETUP / SMED ══════════════════════════════════════════════════════════
    async renderSetup() {
        const pan = $('mf-pan-setup');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando setup...</div>`;
        const dias = this._setupDias || 14;
        const d = await api.get('/api/mf/setup?dias=' + dias);
        if (!d || d.erro) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Setup indisponível${d?.erro ? ' — ' + esc(d.erro) : ''}.</div>`; return; }
        const card = (cor, val, lbl) => `<div style="background:${cor}14;border:1px solid ${cor}3a;border-radius:12px;padding:14px 18px;flex:1;min-width:140px;"><div style="font-size:1.6rem;font-weight:800;color:${cor};">${val}</div><div style="font-size:.62rem;color:${cor};letter-spacing:.04em;">${lbl}</div></div>`;
        const maxM = Math.max(1, ...d.serie.map(s => s.min));
        const barras = d.serie.map(s => {
            const h = Math.round(s.min / maxM * 100), dd = s.dia.slice(8, 10) + '/' + s.dia.slice(5, 7);
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:13px;">
                <div style="font-size:.54rem;color:var(--text-dim);height:10px;">${s.min || ''}</div>
                <div style="width:72%;height:80px;display:flex;align-items:flex-end;"><div style="width:100%;height:${h}%;background:#ffa726;border-radius:3px 3px 0 0;min-height:${s.min ? 2 : 0}px;" title="${dd}: ${s.min} min"></div></div>
                <div style="font-size:.52rem;color:var(--text-dim);">${dd}</div></div>`;
        }).join('');
        const offs = d.offensores.map((o, i) => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
            <td style="padding:6px 8px;color:var(--text-dim);">${i + 1}</td><td style="padding:6px 8px;font-weight:600;">${esc(o.maquina)}</td>
            <td style="padding:6px 8px;text-align:right;">${o.min} min</td><td style="padding:6px 8px;text-align:right;">${o.trocas}</td>
            <td style="padding:6px 8px;text-align:right;">${o.media} min/troca</td></tr>`).join('');
        pan.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                <div class="s-label">🔧 SETUP / SMED — tempo de troca de artigo</div>
                <select onchange="mf._setupDias=+this.value;mf.renderSetup()" style="padding:5px 8px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.8rem;">
                    ${[7, 14, 30].map(n => `<option value="${n}" ${dias === n ? 'selected' : ''}>últimos ${n} dias</option>`).join('')}</select>
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                ${card('#ffa726', d.total_min >= 60 ? (d.total_min / 60).toFixed(1) + ' h' : d.total_min + ' min', 'TEMPO TOTAL DE SETUP')}
                ${card('#26c6da', d.trocas, 'Nº DE TROCAS')}
                ${card('#7c4dff', d.media_min + ' min', 'MÉDIA POR TROCA')}
            </div>
            <div class="summary-card" style="margin-bottom:16px;">
                <div class="s-label" style="margin-bottom:14px;">SETUP POR DIA (minutos) — ${dias} dias</div>
                <div style="display:flex;align-items:flex-end;gap:2px;">${barras}</div>
            </div>
            <div class="summary-card">
                <div class="s-label" style="margin-bottom:8px;">ONDE ESTÁ O SETUP (top máquinas) — é aqui que o SMED ataca</div>
                ${d.offensores.length ? `<table style="width:100%;border-collapse:collapse;font-size:.82rem;"><thead><tr style="text-align:left;color:var(--text-dim);font-size:.64rem;"><th style="padding:6px 8px;">#</th><th style="padding:6px 8px;">MÁQUINA</th><th style="padding:6px 8px;text-align:right;">TEMPO</th><th style="padding:6px 8px;text-align:right;">TROCAS</th><th style="padding:6px 8px;text-align:right;">MÉDIA</th></tr></thead><tbody>${offs}</tbody></table>` : '<div style="color:var(--text-dim);padding:6px;">Sem trocas registradas no período. Registre a parada de setup (motivo "Troca de artigo") para medir.</div>'}
            </div>`;
    },

    // ═══ MATERIAIS (FIO) ═══════════════════════════════════════════════════════
    async renderMateriais() {
        const pan = $('mf-pan-mat');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando materiais...</div>`;
        const lotes = await api.get('/api/mf/lotes-fio');
        if (!Array.isArray(lotes)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Materiais indisponível — rode <strong>mes_rastreabilidade.sql</strong>.</div>`; return; }
        this._lotesFio = lotes;
        const brl = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
        const baixa = l => Number(l.qtd_disponivel_kg) <= Math.max(20, Number(l.qtd_recebida_kg) * 0.15);
        const totalDisp = lotes.reduce((s, l) => s + Number(l.qtd_disponivel_kg || 0), 0);
        const emBaixa = lotes.filter(baixa).length;
        const card = (cor, val, lbl) => `<div style="background:${cor}14;border:1px solid ${cor}3a;border-radius:12px;padding:14px 18px;flex:1;min-width:150px;"><div style="font-size:1.6rem;font-weight:800;color:${cor};">${val}</div><div style="font-size:.62rem;color:${cor};letter-spacing:.04em;">${lbl}</div></div>`;
        const linhas = lotes.map(l => {
            const b = baixa(l), pct = l.qtd_recebida_kg > 0 ? Math.round(l.qtd_disponivel_kg / l.qtd_recebida_kg * 100) : 0;
            return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);${b ? 'background:rgba(240,98,146,.06);' : ''}">
                <td style="padding:6px 8px;font-weight:600;">${esc(l.codigo)}</td>
                <td style="padding:6px 8px;">${esc(l.fornecedor || '—')}</td>
                <td style="padding:6px 8px;color:var(--text-dim);">${esc(l.composicao || '')} ${esc(l.titulo_fio || '')} ${esc(l.cor || '')}</td>
                <td style="padding:6px 8px;text-align:right;">${brl(l.qtd_recebida_kg)} kg</td>
                <td style="padding:6px 8px;text-align:right;font-weight:700;color:${b ? '#f06292' : '#26a69a'};">${brl(l.qtd_disponivel_kg)} kg ${b ? '⚠' : ''}</td>
                <td style="padding:6px 8px;text-align:right;color:var(--text-dim);">${pct}%</td></tr>`;
        }).join('');
        pan.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
                ${card('#26a69a', brl(totalDisp) + ' kg', 'FIO DISPONÍVEL')}
                ${card('#26c6da', lotes.length, 'LOTES ATIVOS')}
                ${card(emBaixa ? '#f06292' : '#8b949e', emBaixa, 'LOTES EM BAIXA')}
            </div>
            <div class="summary-card" style="margin-bottom:14px;">
                <div class="s-label" style="margin-bottom:10px;">+ RECEBER LOTE DE FIO</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;">
                    <input id="mf-lf-cod" class="mf-input" placeholder="Código do lote *">
                    <input id="mf-lf-forn" class="mf-input" placeholder="Fornecedor">
                    <input id="mf-lf-comp" class="mf-input" placeholder="Composição (PV 67/33)">
                    <input id="mf-lf-tit" class="mf-input" placeholder="Título (30/1)">
                    <input id="mf-lf-cor" class="mf-input" placeholder="Cor">
                    <input id="mf-lf-kg" type="number" min="0" step="0.1" class="mf-input" placeholder="kg recebidos *">
                </div>
                <button class="btn primary" style="margin-top:10px;font-size:.8rem;" onclick="mf.receberLoteFio()">Receber lote</button>
            </div>
            <div class="summary-card" style="padding:0;overflow:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                    <thead><tr style="text-align:left;color:var(--text-dim);font-size:.64rem;"><th style="padding:8px;">LOTE</th><th style="padding:8px;">FORNECEDOR</th><th style="padding:8px;">FIO</th><th style="padding:8px;text-align:right;">RECEBIDO</th><th style="padding:8px;text-align:right;">DISPONÍVEL</th><th style="padding:8px;text-align:right;">%</th></tr></thead>
                    <tbody>${linhas || '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-dim);">Nenhum lote de fio. Receba o primeiro acima.</td></tr>'}</tbody>
                </table>
            </div>
            <style>.mf-input{padding:7px 10px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.82rem;}</style>`;
    },
    async receberLoteFio() {
        const cod = $('mf-lf-cod').value.trim(), kg = parseFloat($('mf-lf-kg').value);
        if (!cod || !(kg > 0)) return toast('Informe código e kg.', 'erro');
        const r = await api.post('/api/mf/lotes-fio', { codigo: cod, fornecedor: $('mf-lf-forn').value.trim(), composicao: $('mf-lf-comp').value.trim(), titulo_fio: $('mf-lf-tit').value.trim(), cor: $('mf-lf-cor').value.trim(), qtd_recebida_kg: kg });
        toast(r?.ok ? 'Lote recebido.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderMateriais();
    },
    async formConsumoFio(apId) {
        const lotes = (this._lotesFio && this._lotesFio.length) ? this._lotesFio : (await api.get('/api/mf/lotes-fio') || []);
        this._lotesFio = lotes;
        const opts = lotes.filter(l => Number(l.qtd_disponivel_kg) > 0).map(l => `<option value="${l.id}">${esc(l.codigo)} — ${esc(l.cor || l.titulo_fio || '')} (${Number(l.qtd_disponivel_kg).toLocaleString('pt-BR')} kg)</option>`).join('');
        this._modal(`
            <div class="s-label" style="margin-bottom:14px;">📦 CONSUMO DE FIO</div>
            <span class="mf-label">LOTE</span><select id="mf-cf-lote" class="mf-input" style="margin-bottom:12px;">${opts || '<option value="">— sem lote disponível —</option>'}</select>
            <span class="mf-label">KG CONSUMIDOS</span><input id="mf-cf-kg" type="number" min="0.001" step="0.001" class="mf-input" style="margin-bottom:16px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="mf.salvarConsumoFio('${apId}')">Registrar consumo</button>
            </div>`);
    },
    async salvarConsumoFio(apId) {
        const lote = $('mf-cf-lote').value, kg = parseFloat($('mf-cf-kg').value);
        if (!lote || !(kg > 0)) return toast('Selecione o lote e a quantidade.', 'erro');
        if (this._dup('consumo:' + apId)) return;
        const id = this._uuid();  // offline-first: fila idempotente, não se perde sem rede
        await fila.enfileirar('POST', '/api/mf/consumo-fio', { id, apontamento_id: apId, lote_fio_id: lote, qtd_consumida_kg: kg });
        this._fecharModal();
        toast(navigator.onLine ? 'Consumo registrado (baixou o estoque).' : 'Consumo na fila (offline).', navigator.onLine ? 'ok' : 'aviso');
    },

    // ═══ DOCUMENTOS / INSTRUÇÕES ═══════════════════════════════════════════════
    async renderDocumentos() {
        const pan = $('mf-pan-doc');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando documentos...</div>`;
        const [docs, etapas] = await Promise.all([api.get('/api/mf/documentos'), api.get('/api/mf/etapas-processo')]);
        if (!Array.isArray(docs)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Documentos indisponível — rode <strong>mes_documentos.sql</strong> e recarregue.</div>`; return; }
        const etOpt = `<option value="">— qualquer etapa —</option>` + (etapas || []).map(e => `<option value="${e.id}">${e.ordem}. ${esc(e.nome)}</option>`).join('');
        const lista = docs.map(d => {
            const escopo = [d.produto ? 'produto ' + esc(d.produto.codigo) : '', d.etapa ? esc(d.etapa.nome) : ''].filter(Boolean).join(' · ') || 'geral';
            return `<div class="summary-card" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                <div><strong style="font-size:.9rem;">${esc(d.titulo)}</strong> <span style="font-size:.7rem;color:var(--text-dim);">· ${escopo}</span>
                    ${d.url ? `<a href="${esc(d.url)}" target="_blank" style="color:#26c6da;font-size:.78rem;margin-left:8px;">abrir link ↗</a>` : ''}
                    ${d.conteudo ? `<div style="font-size:.78rem;color:var(--text-dim);margin-top:4px;white-space:pre-wrap;">${esc(d.conteudo).slice(0, 200)}</div>` : ''}</div>
                <button onclick="mf.excluirDoc('${d.id}')" style="background:none;border:none;color:#f06292;cursor:pointer;font-size:.72rem;">excluir</button>
            </div>`;
        }).join('');
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;">
                <div class="s-label" style="margin-bottom:10px;">+ NOVA INSTRUÇÃO / DOCUMENTO</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:8px;">
                    <input id="mf-doc-tit" class="mf-input" placeholder="Título *">
                    <input id="mf-doc-prod" class="mf-input" placeholder="Código do produto (opcional)">
                    <select id="mf-doc-etapa" class="mf-input">${etOpt}</select>
                    <input id="mf-doc-url" class="mf-input" placeholder="Link/URL (PDF, desenho)">
                </div>
                <textarea id="mf-doc-cont" class="mf-input" placeholder="Ou texto da instrução de trabalho..." style="width:100%;min-height:64px;margin-bottom:8px;"></textarea>
                <button class="btn primary" style="font-size:.8rem;" onclick="mf.salvarDoc()">Salvar documento</button>
                <div style="font-size:.72rem;color:var(--text-dim);margin-top:6px;">Vazio em produto/etapa = vale para todos. O operador vê na sessão os documentos do produto+etapa dele.</div>
            </div>
            <div class="s-label" style="margin:6px 0 10px;">DOCUMENTOS (${docs.length})</div>
            ${lista || '<div class="summary-card" style="color:var(--text-dim);">Nenhum documento ainda.</div>'}
            <style>.mf-input{padding:7px 10px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.82rem;}</style>`;
    },
    async salvarDoc() {
        const titulo = $('mf-doc-tit').value.trim(), url = $('mf-doc-url').value.trim(), conteudo = $('mf-doc-cont').value.trim();
        if (!titulo || (!url && !conteudo)) return toast('Título e (link ou texto) obrigatórios.', 'erro');
        const r = await api.post('/api/mf/documentos', { titulo, produto_codigo: $('mf-doc-prod').value.trim() || null, etapa_id: $('mf-doc-etapa').value || null, url, conteudo });
        toast(r?.ok ? 'Documento salvo.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderDocumentos();
    },
    async excluirDoc(id) {
        if (!confirm('Excluir este documento?')) return;
        const r = await api.del('/api/mf/documentos/' + id);
        if (r?.ok) this.renderDocumentos(); else toast('Erro.', 'erro');
    },
    async verInstrucao(apId) {  // operador: vê as instruções do produto+etapa da sessão
        const a = this._abertas.find(x => x.id === apId) || {};
        const prod = (this._cad.ops || []).find(o => o.id === a.op_id)?.produto_id;
        const qs = [prod ? 'produto_id=' + prod : '', a.etapa_id ? 'etapa_id=' + a.etapa_id : ''].filter(Boolean).join('&');
        const docs = await api.get('/api/mf/documentos' + (qs ? '?' + qs : ''));
        const corpo = (Array.isArray(docs) && docs.length)
            ? docs.map(d => `<div style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);">
                <strong>${esc(d.titulo)}</strong>${d.url ? ` <a href="${esc(d.url)}" target="_blank" style="color:#26c6da;font-size:.8rem;">abrir ↗</a>` : ''}
                ${d.conteudo ? `<div style="font-size:.84rem;color:var(--text-dim);margin-top:4px;white-space:pre-wrap;">${esc(d.conteudo)}</div>` : ''}</div>`).join('')
            : '<div style="color:var(--text-dim);padding:10px 0;">Nenhuma instrução cadastrada para este produto/etapa.</div>';
        this._modal(`<div class="s-label" style="margin-bottom:6px;">📄 INSTRUÇÕES — ${esc(a.etapa_nome || '')}</div>${corpo}
            <div style="display:flex;justify-content:flex-end;margin-top:14px;"><button class="btn secondary" onclick="mf._fecharModal()">Fechar</button></div>`);
    },

    // ═══ INTEGRAÇÕES (#4 máquina Stoll / #5 ERP write-back) ═════════════════════
    async renderIntegracoes() {
        const pan = $('mf-pan-integ');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const base = location.origin;
        const [conf, chaveR] = await Promise.all([api.get('/api/mf/erp/confirmacoes?com_producao=1'), api.get('/api/mf/maquina-chave')]);
        const chave = chaveR?.chave || null;
        const linhas = (conf?.confirmacoes || []).map(c => `<tr>
            <td style="padding:6px 8px;">${esc(c.op || '')}</td>
            <td style="padding:6px 8px;">${esc(c.produto || '')}</td>
            <td style="padding:6px 8px;">${esc(c.status || '')}</td>
            <td style="padding:6px 8px;text-align:right;">${(+c.qtd_planejada || 0).toLocaleString('pt-BR')}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:700;color:#66bb6a;">${(+c.qtd_produzida || 0).toLocaleString('pt-BR')}</td>
            <td style="padding:6px 8px;text-align:right;color:#f06292;">${(+c.qtd_refugo || 0).toLocaleString('pt-BR')}</td>
            <td style="padding:6px 8px;font-size:.72rem;color:var(--text-dim);">${c.ultima_producao ? new Date(c.ultima_producao).toLocaleString('pt-BR') : '—'}</td></tr>`).join('');
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
                    <div class="s-label" style="margin:0;">🔌 #4 · CONTAGEM AUTOMÁTICA DA MÁQUINA (Stoll)</div>
                    <span style="font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:6px;background:${chave ? 'rgba(102,187,106,.15)' : 'rgba(255,202,40,.15)'};color:${chave ? '#66bb6a' : '#ffca28'};">API ${chave ? 'ABERTA' : 'sem chave'}</span>
                </div>
                <p style="font-size:.84rem;color:var(--text-dim);margin:0 0 10px;">O contador da máquina (ou um gateway/CLP) envia a quantidade produzida e ela soma sozinha na sessão aberta daquela máquina — acaba a digitação no maior estágio. A API está <strong>aberta para a máquina</strong> via chave fixa (não precisa de login de usuário). Configure o equipamento/gateway com:</p>
                <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:12px;font-family:ui-monospace,monospace;font-size:.78rem;overflow-x:auto;">
                    <div style="color:#66bb6a;font-weight:700;">POST ${esc(base)}/api/mf/maquina-contagem</div>
                    <div style="color:var(--text-dim);">X-API-Key: ${chave ? `<span style="color:#26c6da;">${esc(chave)}</span>` : '&lt;defina MF_MAQUINA_API_KEY no .env&gt;'}</div>
                    <div style="color:var(--text-dim);">Content-Type: application/json</div>
                    <div style="margin-top:6px;">{ "maquina_codigo": "STOLL-01", "qtd_delta": 12 }</div>
                </div>
                ${chave ? `<div style="font-size:.72rem;color:var(--text-dim);margin-top:6px;">🔒 Chave secreta — só admin vê. Quem tiver essa chave pode lançar produção. Para trocar, gere outra em <code>MF_MAQUINA_API_KEY</code> no .env e reinicie.</div>` : ''}
                <div style="font-size:.74rem;color:var(--text-dim);margin-top:8px;">Testar agora com uma máquina que tenha sessão aberta:</div>
                <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
                    <input id="mf-integ-maq" class="mf-input" placeholder="código da máquina (ex.: STOLL-01)" style="max-width:220px;">
                    <input id="mf-integ-qtd" class="mf-input" type="number" placeholder="qtd" value="1" style="max-width:90px;">
                    <button class="btn secondary" style="font-size:.8rem;" onclick="mf.testarContagem()">Enviar contagem</button>
                    <span id="mf-integ-res" style="font-size:.78rem;"></span>
                </div>
            </div>
            <div class="summary-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:10px;flex-wrap:wrap;">
                    <div class="s-label" style="margin:0;">📤 #5 · CONFIRMAÇÃO DE PRODUÇÃO PARA O ERP</div>
                    <button class="btn primary" style="font-size:.8rem;" onclick="mf.exportarErp()">⬇ Baixar confirmações (JSON)</button>
                </div>
                <p style="font-size:.84rem;color:var(--text-dim);margin:0 0 10px;">Produzido por OP (somado dos apontamentos), pronto para o ERP dar baixa. O ERP pode ler direto em <code style="color:#26c6da;">GET /api/mf/erp/confirmacoes</code> ou usar o arquivo abaixo. ${conf?.total || 0} OP(s) com produção.</p>
                <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                    <thead><tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border-color);">
                        <th style="padding:6px 8px;">OP</th><th style="padding:6px 8px;">Produto</th><th style="padding:6px 8px;">Status</th>
                        <th style="padding:6px 8px;text-align:right;">Plan.</th><th style="padding:6px 8px;text-align:right;">Produzido</th>
                        <th style="padding:6px 8px;text-align:right;">Refugo</th><th style="padding:6px 8px;">Última prod.</th></tr></thead>
                    <tbody>${linhas || '<tr><td colspan="7" style="padding:12px;color:var(--text-dim);">Nenhuma OP com produção ainda.</td></tr>'}</tbody>
                </table></div>
            </div>`;
    },
    async testarContagem() {
        const cod = $('mf-integ-maq').value.trim(), qtd = +$('mf-integ-qtd').value || 0;
        const res = $('mf-integ-res');
        if (!cod || qtd <= 0) { res.style.color = '#f06292'; res.textContent = 'informe máquina e qtd'; return; }
        const r = await api.post('/api/mf/maquina-contagem', { maquina_codigo: cod, qtd_delta: qtd });
        if (r?.ok) { res.style.color = '#66bb6a'; res.textContent = `✓ somado — sessão agora com ${r.qtd_boa} boas`; }
        else { res.style.color = '#f06292'; res.textContent = r?.erro || 'erro'; }
    },
    async exportarErp() {
        const d = await api.get('/api/mf/erp/confirmacoes');
        if (!d) return toast('Erro ao gerar.', 'erro');
        const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'confirmacoes-producao.json';
        a.click();
        URL.revokeObjectURL(a.href);
        toast(`${d.total} confirmação(ões) exportada(s).`, 'ok');
    },

    // ═══ ENGENHARIA DE PROCESSOS E MÉTODOS ══════════════════════════════════════
    // 1) Cronoanálise — tempo real medido × padrão
    async renderCrono() {
        const pan = $('mf-pan-crono');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const d = await api.get('/api/mf/cronoanalise');
        if (!Array.isArray(d)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Cronoanálise indisponível — rode <strong>mes_engenharia.sql</strong> e recarregue.</div>`; return; }
        const linhas = d.map(r => {
            const dv = r.desvio_pct, cor = dv == null ? 'var(--text-dim)' : Math.abs(dv) <= 10 ? '#26a69a' : Math.abs(dv) <= 25 ? '#ffca28' : '#f06292';
            return `<tr style="border-bottom:1px solid rgba(255,255,255,.05);">
                <td style="padding:6px 8px;">${r.etapa_ordem}. ${esc(r.etapa)}</td><td style="padding:6px 8px;">${esc(r.produto || '—')}</td>
                <td style="padding:6px 8px;text-align:right;">${r.seg_padrao != null ? r.seg_padrao : '<span style="color:#ffca28;">sem padrão</span>'}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:700;">${r.seg_real_medio}</td>
                <td style="padding:6px 8px;text-align:center;color:var(--text-dim);font-size:.78rem;">${r.observacoes}</td>
                <td style="padding:6px 8px;text-align:right;color:${cor};font-weight:700;">${dv == null ? '—' : (dv > 0 ? '+' : '') + dv + '%'}</td>
                <td style="padding:6px 8px;text-align:right;"><button class="btn secondary" style="font-size:.72rem;" onclick="mf.adotarPadrao('${r.etapa_id}','${r.produto_id || ''}',${r.seg_real_medio})">adotar medido</button></td></tr>`;
        }).join('');
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label">⏱ CRONOANÁLISE — tempo real medido × padrão</div>
                <p style="font-size:.8rem;color:var(--text-dim);margin:8px 0 0;">O tempo de cada peça vem do apontamento (duração − paradas ÷ produzido). Compare com o padrão e <strong>adote o medido</strong> pra refinar o tempo-padrão — sem chute, o número vem do chão.</p></div>
            ${d.length ? `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.84rem;">
                <thead><tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border-color);"><th style="padding:6px 8px;">Etapa</th><th style="padding:6px 8px;">Produto</th><th style="padding:6px 8px;text-align:right;">Padrão (s/pç)</th><th style="padding:6px 8px;text-align:right;">Real médio</th><th style="padding:6px 8px;text-align:center;">Obs.</th><th style="padding:6px 8px;text-align:right;">Desvio</th><th></th></tr></thead>
                <tbody>${linhas}</tbody></table></div>`
            : `<div class="summary-card" style="color:var(--text-dim);text-align:center;padding:28px;">Sem sessões finalizadas ainda. A cronoanálise aparece quando o chão começar a apontar produção.</div>`}`;
    },
    async adotarPadrao(etapaId, prodId, seg) {
        if (!confirm(`Adotar ${seg}s/peça como novo tempo-padrão?`)) return;
        const r = await api.put('/api/mf/tempos', { etapa_id: etapaId, produto_id: prodId || null, seg_por_unidade: seg });
        toast(r?.ok ? 'Tempo-padrão atualizado.' : 'Erro.', r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderCrono();
    },

    // 2) Balanceamento de linha + takt
    async renderBalanc() {
        const pan = $('mf-pan-balanc');
        const dem = this._balancDem || 0, horas = this._balancH || 8;
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const d = await api.get(`/api/mf/balanceamento?demanda=${dem}&horas=${horas}`);
        if (!d || !Array.isArray(d.etapas)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Indisponível.</div>`; return; }
        const maxC = Math.max(1, ...d.etapas.map(e => e.tempo_ciclo || 0), d.takt || 0);
        const barras = d.etapas.map(e => {
            const w = e.tempo_ciclo ? Math.round(e.tempo_ciclo / maxC * 100) : 0, cor = e.gargalo ? '#f06292' : e.tempo_ciclo == null ? '#30363d' : '#26a69a';
            return `<div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:3px;"><span>${e.ordem}. ${esc(e.etapa)} ${e.gargalo ? '🔴' : ''}</span>
                    <span style="color:var(--text-dim);">${e.postos} posto(s)${e.tempo_ciclo != null ? ' · ' + e.tempo_ciclo + 's/pç' : ' · sem tempo-padrão'}${e.capacidade_dia != null ? ' · cap ' + e.capacidade_dia.toLocaleString('pt-BR') + '/dia' : ''}</span></div>
                <div style="height:14px;background:var(--bg-card);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${w}%;background:${cor};"></div></div></div>`;
        }).join('');
        const taktTxt = d.takt ? `<div style="font-size:.82rem;color:#26c6da;margin-bottom:10px;">Takt = <strong>${d.takt}s/peça</strong> (ritmo que a demanda exige). Posto com ciclo acima do takt = gargalo 🔴.</div>` : `<div style="font-size:.8rem;color:var(--text-dim);margin-bottom:10px;">Informe a demanda/dia pra calcular o takt e ver onde a linha desbalanceia.</div>`;
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label" style="margin-bottom:10px;">⚖️ BALANCEAMENTO DE LINHA + TAKT</div>
                <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
                    <div><span class="mf-label">DEMANDA (peças/dia)</span><input id="mf-balanc-dem" type="number" min="0" class="mf-input" value="${dem}" style="max-width:150px;"></div>
                    <div><span class="mf-label">HORAS/DIA</span><input id="mf-balanc-h" type="number" min="1" max="24" class="mf-input" value="${horas}" style="max-width:100px;"></div>
                    <button class="btn primary" style="font-size:.8rem;" onclick="mf._balancCalc()">Calcular</button>
                    ${d.gargalo ? `<span style="margin-left:auto;font-size:.82rem;color:#f06292;">Gargalo: <strong>${esc(d.gargalo)}</strong></span>` : ''}</div></div>
            <div class="summary-card">${taktTxt}${barras}</div>`;
    },
    _balancCalc() { this._balancDem = +$('mf-balanc-dem').value || 0; this._balancH = +$('mf-balanc-h').value || 8; this.renderBalanc(); },

    // 3) Produtividade por operador
    async renderProdutiv() {
        const pan = $('mf-pan-produtiv');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const d = await api.get('/api/mf/produtividade');
        if (!Array.isArray(d)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Indisponível — rode <strong>mes_engenharia.sql</strong>.</div>`; return; }
        const linhas = d.map((r, i) => `<tr style="border-bottom:1px solid rgba(255,255,255,.05);">
            <td style="padding:6px 8px;">${i + 1}. ${esc(r.operador)}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:700;color:#26a69a;">${r.pecas_por_hora ?? '—'}</td>
            <td style="padding:6px 8px;text-align:right;">${r.horas}</td><td style="padding:6px 8px;text-align:right;">${(+r.qtd_boa).toLocaleString('pt-BR')}</td>
            <td style="padding:6px 8px;text-align:right;color:${r.refugo_pct > 5 ? '#f06292' : 'var(--text-dim)'};">${r.refugo_pct ?? 0}%</td>
            <td style="padding:6px 8px;text-align:right;color:var(--text-dim);">${r.retrab_pct ?? 0}%</td></tr>`).join('');
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label">👥 PRODUTIVIDADE POR OPERADOR</div>
                <p style="font-size:.8rem;color:var(--text-dim);margin:8px 0 0;">Peças boas/hora, refugo% e retrabalho% por pessoa, do apontamento. Mostra quem rende e se o gargalo é a máquina ou a gente.</p></div>
            ${d.length ? `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.84rem;">
                <thead><tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border-color);"><th style="padding:6px 8px;">Operador</th><th style="padding:6px 8px;text-align:right;">Peças/h</th><th style="padding:6px 8px;text-align:right;">Horas</th><th style="padding:6px 8px;text-align:right;">Boas</th><th style="padding:6px 8px;text-align:right;">Refugo</th><th style="padding:6px 8px;text-align:right;">Retrab.</th></tr></thead>
                <tbody>${linhas}</tbody></table></div>`
            : `<div class="summary-card" style="color:var(--text-dim);text-align:center;padding:28px;">Sem produção apontada ainda.</div>`}`;
    },

    // 4) Custeio real por OP + taxas (R$/h do usuário)
    async renderCusto() {
        const pan = $('mf-pan-custo');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const [d, taxas] = await Promise.all([api.get('/api/mf/custo'), api.get('/api/mf/custo/taxas')]);
        if (!Array.isArray(d)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Indisponível — rode <strong>mes_engenharia.sql</strong>.</div>`; return; }
        const semTaxa = (taxas?.operadores || []).filter(o => o.custo_hora == null).length + (taxas?.maquinas || []).filter(m => m.custo_hora == null).length;
        const linhas = d.map(r => `<tr style="border-bottom:1px solid rgba(255,255,255,.05);">
            <td style="padding:6px 8px;">${esc(r.numero)}</td><td style="padding:6px 8px;">${esc(r.produto || '—')}</td><td style="padding:6px 8px;text-align:right;">${r.horas}</td>
            <td style="padding:6px 8px;text-align:right;">R$ ${(+r.custo_mo).toFixed(2)}</td><td style="padding:6px 8px;text-align:right;">R$ ${(+r.custo_maquina).toFixed(2)}</td>
            <td style="padding:6px 8px;text-align:right;">R$ ${(+r.custo_material).toFixed(2)}</td><td style="padding:6px 8px;text-align:right;color:#f06292;">R$ ${(+r.custo_refugo).toFixed(2)}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:700;color:#ffab76;">R$ ${(+r.custo_total).toFixed(2)}</td></tr>`).join('');
        const taxaRow = (tipo, x) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;">
            <span style="font-size:.82rem;">${esc(x.codigo || x.nome)}</span>
            <span style="display:flex;align-items:center;gap:4px;font-size:.8rem;">R$ <input type="number" min="0" step="0.01" value="${x.custo_hora ?? ''}" placeholder="—" class="mf-input" style="width:90px;padding:5px 8px;" onchange="mf.salvarTaxa('${tipo}','${x.id}',this.value)">/h</span></div>`;
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label">💰 CUSTEIO REAL POR OP</div>
                <p style="font-size:.8rem;color:var(--text-dim);margin:8px 0 0;">Custo cheio = mão de obra (horas × R$/h) + máquina-hora + material + refugo. As taxas R$/h são suas — preencha abaixo (não invento número).${semTaxa ? ` <span style="color:#ffca28;">${semTaxa} recurso(s) sem taxa → custo subestimado.</span>` : ''}</p></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
                <div class="summary-card"><div class="s-label" style="margin-bottom:8px;">TAXA OPERADOR (R$/h)</div>${(taxas?.operadores || []).map(o => taxaRow('operador', o)).join('') || '<span style="color:var(--text-dim);">—</span>'}</div>
                <div class="summary-card"><div class="s-label" style="margin-bottom:8px;">TAXA MÁQUINA (R$/h)</div>${(taxas?.maquinas || []).map(m => taxaRow('maquina', m)).join('') || '<span style="color:var(--text-dim);">—</span>'}</div></div>
            ${d.length ? `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                <thead><tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border-color);"><th style="padding:6px 8px;">OP</th><th style="padding:6px 8px;">Produto</th><th style="padding:6px 8px;text-align:right;">Horas</th><th style="padding:6px 8px;text-align:right;">M.O.</th><th style="padding:6px 8px;text-align:right;">Máquina</th><th style="padding:6px 8px;text-align:right;">Material</th><th style="padding:6px 8px;text-align:right;">Refugo</th><th style="padding:6px 8px;text-align:right;">Total</th></tr></thead>
                <tbody>${linhas}</tbody></table></div>`
            : `<div class="summary-card" style="color:var(--text-dim);text-align:center;padding:24px;">Sem produção apontada ainda — o custo por OP aparece quando houver apontamento.</div>`}`;
    },
    async salvarTaxa(tipo, id, val) {
        const custo = (val === '' || val == null) ? null : (Number(val) >= 0 ? Number(val) : 0);  // M11: vazio limpa (null)
        const r = await api.put(`/api/mf/custo/taxa/${tipo}/${id}`, { custo_hora: custo });
        toast(r?.ok ? 'Taxa salva.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        // B7: não re-renderiza (perderia edição em campo vizinho); a tabela de custo atualiza ao reabrir a aba
    },

    // 5) Melhoria contínua — FMEA + Kaizen
    async renderMelhoria() {
        const pan = $('mf-pan-melhoria');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const [fmea, kaizen, etapas] = await Promise.all([api.get('/api/mf/fmea'), api.get('/api/mf/kaizen'), api.get('/api/mf/etapas-processo')]);
        if (!Array.isArray(fmea) || !Array.isArray(kaizen)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Indisponível — rode <strong>mes_engenharia.sql</strong>.</div>`; return; }
        const etOpt = `<option value="">— etapa —</option>` + (etapas || []).map(e => `<option value="${e.id}">${e.ordem}. ${esc(e.nome)}</option>`).join('');
        const fmeaLin = fmea.map(f => {
            const cor = f.rpn >= 200 ? '#f06292' : f.rpn >= 100 ? '#ffca28' : '#26a69a';
            return `<tr style="border-bottom:1px solid rgba(255,255,255,.05);">
                <td style="padding:5px 8px;font-size:.8rem;">${esc(f.etapa?.nome || '—')}</td><td style="padding:5px 8px;">${esc(f.modo_falha)}</td>
                <td style="padding:5px 8px;font-size:.78rem;color:var(--text-dim);">${esc(f.causa || '')}</td>
                <td style="padding:5px 8px;text-align:center;">${f.severidade || '—'}/${f.ocorrencia || '—'}/${f.deteccao || '—'}</td>
                <td style="padding:5px 8px;text-align:right;font-weight:700;color:${cor};">${f.rpn ?? '—'}</td>
                <td style="padding:5px 8px;"><button onclick="mf.excluirFmea('${f.id}')" style="background:none;border:none;color:#f06292;cursor:pointer;font-size:.72rem;">✕</button></td></tr>`;
        }).join('');
        const cols = [['ideia', '💡 Ideias'], ['teste', '🧪 Em teste'], ['padrao', '✅ Virou padrão'], ['descartado', '🗑 Descartado']];
        const board = cols.map(([st, lbl]) => {
            const cards = kaizen.filter(k => k.status === st).map(k => `<div class="summary-card" style="padding:8px;margin-bottom:6px;">
                <div style="font-size:.82rem;font-weight:600;">${esc(k.titulo)}</div>${k.etapa?.nome ? `<div style="font-size:.7rem;color:var(--text-dim);">${esc(k.etapa.nome)}</div>` : ''}
                <div style="display:flex;gap:3px;margin-top:5px;flex-wrap:wrap;">${cols.filter(c => c[0] !== st).map(c => `<button onclick="mf.moverKaizen('${k.id}','${c[0]}')" title="mover p/ ${esc(c[1])}" style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:.7rem;padding:1px 5px;">${c[1].split(' ')[0]}</button>`).join('')}</div></div>`).join('');
            return `<div style="flex:1;min-width:150px;"><div class="s-label" style="margin-bottom:8px;">${lbl} (${kaizen.filter(k => k.status === st).length})</div>${cards || '<div style="color:var(--text-dim);font-size:.76rem;">—</div>'}</div>`;
        }).join('');
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label">🔧 MELHORIA CONTÍNUA — FMEA + Kaizen</div></div>
            <div class="summary-card" style="margin-bottom:14px;">
                <div class="s-label" style="margin-bottom:10px;">FMEA DE PROCESSO (RPN = Sev × Ocor × Det)</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:8px;">
                    <select id="mf-fmea-et" class="mf-input">${etOpt}</select>
                    <input id="mf-fmea-modo" class="mf-input" placeholder="Modo de falha *">
                    <input id="mf-fmea-causa" class="mf-input" placeholder="Causa">
                    <input id="mf-fmea-sev" type="number" min="1" max="10" class="mf-input" placeholder="Sev">
                    <input id="mf-fmea-ocor" type="number" min="1" max="10" class="mf-input" placeholder="Ocor">
                    <input id="mf-fmea-det" type="number" min="1" max="10" class="mf-input" placeholder="Det"></div>
                <button class="btn primary" style="font-size:.8rem;" onclick="mf.salvarFmea()">+ Adicionar risco</button>
                ${fmea.length ? `<div style="overflow-x:auto;margin-top:12px;"><table style="width:100%;border-collapse:collapse;font-size:.84rem;">
                    <thead><tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border-color);"><th style="padding:5px 8px;">Etapa</th><th style="padding:5px 8px;">Modo de falha</th><th style="padding:5px 8px;">Causa</th><th style="padding:5px 8px;text-align:center;">S/O/D</th><th style="padding:5px 8px;text-align:right;">RPN</th><th></th></tr></thead>
                    <tbody>${fmeaLin}</tbody></table></div>` : '<div style="color:var(--text-dim);font-size:.8rem;margin-top:10px;">Nenhum risco mapeado.</div>'}</div>
            <div class="summary-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
                    <div class="s-label" style="margin:0;">FUNIL KAIZEN — ideia → teste → padrão</div>
                    <div style="display:flex;gap:6px;"><input id="mf-kz-tit" class="mf-input" placeholder="Nova ideia de melhoria" style="width:220px;"><button class="btn secondary" style="font-size:.78rem;" onclick="mf.salvarKaizen()">+ Ideia</button></div></div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;">${board}</div></div>`;
    },
    async salvarFmea() {
        const modo = $('mf-fmea-modo').value.trim();
        if (!modo) return toast('Modo de falha obrigatório.', 'erro');
        const r = await api.post('/api/mf/fmea', { etapa_id: $('mf-fmea-et').value || null, modo_falha: modo, causa: $('mf-fmea-causa').value || null,
            severidade: +$('mf-fmea-sev').value || null, ocorrencia: +$('mf-fmea-ocor').value || null, deteccao: +$('mf-fmea-det').value || null });
        toast(r?.ok ? 'Risco adicionado.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderMelhoria();
    },
    async excluirFmea(id) { if (!confirm('Excluir este risco?')) return; const r = await api.del('/api/mf/fmea/' + id); if (r?.ok) this.renderMelhoria(); },
    async salvarKaizen() {
        const tit = $('mf-kz-tit').value.trim();
        if (!tit) return toast('Descreva a ideia.', 'erro');
        const r = await api.post('/api/mf/kaizen', { titulo: tit });
        toast(r?.ok ? 'Ideia registrada.' : 'Erro.', r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderMelhoria();
    },
    async moverKaizen(id, status) { const r = await api.put('/api/mf/kaizen/' + id, { status }); if (r?.ok) this.renderMelhoria(); },

    // ═══ LEAN MANUFACTURING ═════════════════════════════════════════════════════
    // VSM — Mapa do Fluxo de Valor
    async renderVsm() {
        const pan = $('mf-pan-vsm');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const d = await api.get('/api/mf/vsm');
        if (!d || !Array.isArray(d.etapas)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Indisponível.</div>`; return; }
        const maxLead = Math.max(1, ...d.etapas.map(e => e.lead_horas || 0));
        const linhas = d.etapas.map(e => {
            const wLead = e.lead_horas ? Math.round(e.lead_horas / maxLead * 100) : 0, wVa = e.lead_horas ? Math.round((e.va_horas || 0) / maxLead * 100) : 0;
            // B5: marca de onde veio o lead — histórico medido vs espera atual do WIP (grandezas diferentes)
            const fonteMark = e.lead_fonte === 'wip_atual'
                ? ` <span title="lead = espera ATUAL do WIP (ainda sem histórico medido nesta etapa)" style="color:#ffca28;font-size:.66rem;">⧗wip</span>`
                : (e.lead_fonte === 'historico' ? ` <span title="lead = média histórica medida de OPs concluídas" style="color:#26c6da;font-size:.66rem;">✓hist</span>` : '');
            return `<div style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px;"><span>${e.ordem}. ${esc(e.etapa)}</span>
                    <span style="color:var(--text-dim);">WIP ${e.wip_ops} OP${e.wip_ops !== 1 ? 's' : ''}${e.wip_qtd ? ' · ' + e.wip_qtd.toLocaleString('pt-BR') : ''} · lead ${e.lead_horas}h${fonteMark}${e.va_horas ? ' · VA ' + e.va_horas + 'h' : ''}</span></div>
                <div style="height:16px;background:var(--bg-card);border-radius:4px;overflow:hidden;position:relative;"><div style="height:100%;width:${wLead}%;background:#30363d;"></div><div style="height:100%;width:${wVa}%;background:#26a69a;position:absolute;top:0;left:0;"></div></div></div>`;
        }).join('');
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label">🌊 VSM — MAPA DO FLUXO DE VALOR</div>
                <p style="font-size:.8rem;color:var(--text-dim);margin:8px 0 0;">Lead time (cinza) × valor agregado (verde) por etapa. O que está fora do verde é <strong>espera = desperdício</strong>.</p>
                ${d.lead_misturado ? `<p style="font-size:.72rem;color:#ffca28;margin:6px 0 0;">⚠ Lead misto: etapas <span style="color:#26c6da;">✓hist</span> usam média histórica medida; etapas <span style="color:#ffca28;">⧗wip</span> usam a espera atual do WIP (ainda sem histórico). O total soma as duas — compare com ressalva até todas terem histórico.</p>` : ''}
                <div style="display:flex;gap:24px;margin-top:12px;flex-wrap:wrap;">
                    <div><div style="font-size:1.5rem;font-weight:800;color:#26c6da;">${d.lead_total_h}h</div><div style="font-size:.66rem;color:var(--text-dim);">LEAD TIME TOTAL</div></div>
                    <div><div style="font-size:1.5rem;font-weight:800;color:#26a69a;">${d.va_total_h}h</div><div style="font-size:.66rem;color:var(--text-dim);">VALOR AGREGADO</div></div>
                    <div><div style="font-size:1.5rem;font-weight:800;color:${d.pct_va == null ? 'var(--text-dim)' : d.pct_va < 15 ? '#f06292' : d.pct_va < 30 ? '#ffca28' : '#26a69a'};">${d.pct_va != null ? d.pct_va + '%' : '—'}</div><div style="font-size:.66rem;color:var(--text-dim);">% VALOR AGREGADO</div></div></div></div>
            ${d.etapas.some(e => e.lead_horas || e.wip_ops) ? `<div class="summary-card">${linhas}</div>` : `<div class="summary-card" style="color:var(--text-dim);text-align:center;padding:28px;">Sem fluxo ainda. O VSM se preenche quando as OPs entrarem no WIP e o chão apontar (defina o tempo-padrão e jogue OPs no fluxo).</div>`}`;
    },

    // Heijunka — nivelamento
    async renderHeijunka() {
        const pan = $('mf-pan-heijunka');
        const per = this._heijPer || 5;
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const d = await api.get('/api/mf/heijunka?periodos=' + per);
        if (!d || !Array.isArray(d.familias)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Indisponível.</div>`; return; }
        const cols = Array.from({ length: per }, (_, i) => `<th style="padding:6px 8px;text-align:center;">P${i + 1}</th>`).join('');
        const rows = d.familias.map(f => `<tr style="border-bottom:1px solid rgba(255,255,255,.05);">
            <td style="padding:6px 8px;">${esc(f.nome)}</td><td style="padding:6px 8px;text-align:right;color:var(--text-dim);">${f.total.toLocaleString('pt-BR')}</td>
            ${Array.from({ length: per }, () => `<td style="padding:6px 8px;text-align:center;font-weight:600;color:#26c6da;">${f.por_periodo.toLocaleString('pt-BR')}</td>`).join('')}</tr>`).join('');
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label" style="margin-bottom:8px;">📦 HEIJUNKA — NIVELAMENTO DA PRODUÇÃO</div>
                <p style="font-size:.8rem;color:var(--text-dim);margin:0 0 10px;">Distribui a carteira por família de forma <strong>nivelada</strong> entre os períodos — em vez de lotões, um pouco de cada (reduz pico de setup e estoque).</p>
                <div style="display:flex;gap:8px;align-items:center;"><span class="mf-label" style="margin:0;">PERÍODOS</span>
                    <input id="mf-heij-per" type="number" min="2" max="12" value="${per}" class="mf-input" style="max-width:80px;">
                    <button class="btn primary" style="font-size:.8rem;" onclick="mf._heijCalc()">Nivelar</button>
                    <span style="margin-left:auto;font-size:.82rem;color:var(--text-dim);">${d.total.toLocaleString('pt-BR')} un · ~${d.por_periodo.toLocaleString('pt-BR')}/período</span></div></div>
            <div class="summary-card" style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                <thead><tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border-color);"><th style="padding:6px 8px;">Família</th><th style="padding:6px 8px;text-align:right;">Total</th>${cols}</tr></thead>
                <tbody>${rows || `<tr><td colspan="${per + 2}" style="padding:14px;color:var(--text-dim);">Sem carteira.</td></tr>`}</tbody></table></div>`;
    },
    _heijCalc() { this._heijPer = Math.max(2, Math.min(12, +$('mf-heij-per').value || 5)); this.renderHeijunka(); },

    // Yamazumi — carga de operador × takt
    async renderYamazumi() {
        const pan = $('mf-pan-yamazumi');
        const dem = this._yamaDem || 0, horas = this._yamaH || 8;
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const d = await api.get(`/api/mf/yamazumi?demanda=${dem}&horas=${horas}`);
        if (!d || !Array.isArray(d.etapas)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Indisponível.</div>`; return; }
        const max = Math.max(100, ...d.etapas.map(e => e.utilizacao || 0));
        const barras = d.etapas.map(e => {
            const w = e.utilizacao ? Math.round(e.utilizacao / max * 100) : 0, cor = e.sobrecarga ? '#f06292' : e.ocioso ? '#ffca28' : e.utilizacao != null ? '#26a69a' : '#30363d';
            return `<div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:3px;"><span>${e.ordem}. ${esc(e.etapa)} ${e.sobrecarga ? '🔴 Muri' : e.ocioso ? '🟡 ocioso' : ''}</span>
                    <span style="color:var(--text-dim);">${e.postos} posto(s)/${e.pessoas} pess.${e.carga_seg != null ? ' · ' + e.carga_seg + 's/pç' : ' · sem tempo-padrão'}${e.utilizacao != null ? ' · ' + e.utilizacao + '%' : ''}</span></div>
                <div style="height:15px;background:var(--bg-card);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${w}%;background:${cor};"></div></div></div>`;
        }).join('');
        const taktTxt = d.takt ? `<div style="font-size:.82rem;color:#26c6da;margin-bottom:10px;">Takt = <strong>${d.takt}s/peça</strong>. Acima = sobrecarga (Muri 🔴); muito abaixo = ócio 🟡 — redistribua tarefas/pessoas.</div>` : `<div style="font-size:.8rem;color:var(--text-dim);margin-bottom:10px;">Informe a demanda/dia pra ver a carga de cada posto contra o takt.</div>`;
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label" style="margin-bottom:10px;">👷 YAMAZUMI — BALANCEAMENTO DE OPERADORES</div>
                <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
                    <div><span class="mf-label">DEMANDA (peças/dia)</span><input id="mf-yama-dem" type="number" min="0" class="mf-input" value="${dem}" style="max-width:150px;"></div>
                    <div><span class="mf-label">HORAS/DIA</span><input id="mf-yama-h" type="number" min="1" max="24" class="mf-input" value="${horas}" style="max-width:100px;"></div>
                    <button class="btn primary" style="font-size:.8rem;" onclick="mf._yamaCalc()">Calcular</button></div></div>
            <div class="summary-card">${taktTxt}${barras}</div>`;
    },
    _yamaCalc() { this._yamaDem = +$('mf-yama-dem').value || 0; this._yamaH = +$('mf-yama-h').value || 8; this.renderYamazumi(); },

    // 5S — auditoria por área
    async renderCincoS() {
        const pan = $('mf-pan-cincos');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const [aud, etapas] = await Promise.all([api.get('/api/mf/auditoria-5s'), api.get('/api/mf/etapas-processo')]);
        if (!Array.isArray(aud)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Indisponível — rode <strong>mes_lean.sql</strong>.</div>`; return; }
        const etOpt = `<option value="">— área/etapa —</option>` + (etapas || []).map(e => `<option value="${e.id}">${e.ordem}. ${esc(e.nome)}</option>`).join('');
        const sLabels = [['seiri', 'Seiri (utilização)'], ['seiton', 'Seiton (organização)'], ['seiso', 'Seiso (limpeza)'], ['seiketsu', 'Seiketsu (padrão)'], ['shitsuke', 'Shitsuke (disciplina)']];
        const sInputs = sLabels.map(([k, lbl]) => `<div><span class="mf-label" style="font-size:.6rem;">${lbl}</span><input id="mf-5s-${k}" type="number" min="0" max="5" class="mf-input" placeholder="0-5"></div>`).join('');
        const lista = aud.map(a => {
            const cor = a.nota >= 20 ? '#26a69a' : a.nota >= 13 ? '#ffca28' : '#f06292';
            return `<tr style="border-bottom:1px solid rgba(255,255,255,.05);">
                <td style="padding:6px 8px;">${esc(a.area)}${a.etapa?.nome ? ' · ' + esc(a.etapa.nome) : ''}</td>
                <td style="padding:6px 8px;font-size:.74rem;color:var(--text-dim);">${a.data_auditoria}${a.auditor ? ' · ' + esc(a.auditor) : ''}</td>
                <td style="padding:6px 8px;text-align:center;font-size:.74rem;">${a.seiri ?? '—'}/${a.seiton ?? '—'}/${a.seiso ?? '—'}/${a.seiketsu ?? '—'}/${a.shitsuke ?? '—'}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:700;color:${cor};">${a.nota}/25</td></tr>`;
        }).join('');
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label" style="margin-bottom:10px;">🧹 5S — AUDITORIA POR ÁREA (cada S de 0 a 5 → nota /25)</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(115px,1fr));gap:8px;margin-bottom:8px;">
                    <input id="mf-5s-area" class="mf-input" placeholder="Área *"><select id="mf-5s-etapa" class="mf-input">${etOpt}</select>
                    <input id="mf-5s-auditor" class="mf-input" placeholder="Auditor">${sInputs}</div>
                <textarea id="mf-5s-obs" class="mf-input" placeholder="Observações..." style="width:100%;min-height:46px;margin-bottom:8px;"></textarea>
                <button class="btn primary" style="font-size:.8rem;" onclick="mf.salvar5s()">Salvar auditoria</button></div>
            <div class="s-label" style="margin:6px 0 8px;">AUDITORIAS (${aud.length})</div>
            ${aud.length ? `<div class="summary-card" style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.84rem;">
                <thead><tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border-color);"><th style="padding:6px 8px;">Área</th><th style="padding:6px 8px;">Data</th><th style="padding:6px 8px;text-align:center;">5S (ri/ton/so/ketsu/tsuke)</th><th style="padding:6px 8px;text-align:right;">Nota</th></tr></thead>
                <tbody>${lista}</tbody></table></div>` : '<div class="summary-card" style="color:var(--text-dim);">Nenhuma auditoria ainda.</div>'}`;
    },
    async salvar5s() {
        const area = $('mf-5s-area').value.trim();
        if (!area) return toast('Área obrigatória.', 'erro');
        const body = { area, etapa_id: $('mf-5s-etapa').value || null, auditor: $('mf-5s-auditor').value || null, observacao: $('mf-5s-obs').value || null };
        ['seiri', 'seiton', 'seiso', 'seiketsu', 'shitsuke'].forEach(s => { const v = $('mf-5s-' + s).value; body[s] = v === '' ? null : Math.max(0, Math.min(5, +v)); });
        const r = await api.post('/api/mf/auditoria-5s', body);
        toast(r?.ok ? 'Auditoria salva.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderCincoS();
    },

    // A3 / PDCA
    async renderA3() {
        const pan = $('mf-pan-a3');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const a3s = await api.get('/api/mf/a3');
        if (!Array.isArray(a3s)) { pan.innerHTML = `<div class="summary-card" style="color:#ffca28;">Indisponível — rode <strong>mes_lean.sql</strong>.</div>`; return; }
        this._a3cache = a3s;
        const faseLabel = { plan: '📋 Plan', do: '🔧 Do', check: '🔍 Check', act: '✅ Act', concluido: '🏁 Concluído' };
        const cards = a3s.map(a => `<div class="summary-card" style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;"><strong style="font-size:.92rem;">${esc(a.titulo)}</strong>
                <span style="font-size:.72rem;color:var(--text-dim);">${a.etapa?.nome ? esc(a.etapa.nome) + ' · ' : ''}${a.responsavel ? esc(a.responsavel) + ' · ' : ''}<span style="color:#26c6da;">${faseLabel[a.fase] || a.fase}</span></span></div>
            ${a.situacao_atual ? `<div style="font-size:.8rem;color:var(--text-dim);margin-top:6px;"><strong>Problema:</strong> ${esc(String(a.situacao_atual).slice(0, 140))}</div>` : ''}
            <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;">${['plan', 'do', 'check', 'act', 'concluido'].map(f => `<button onclick="mf.moverA3('${a.id}','${f}')" style="background:${a.fase === f ? '#26c6da' : 'var(--bg-card)'};color:${a.fase === f ? '#fff' : 'var(--text-dim)'};border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:.68rem;padding:2px 7px;">${faseLabel[f]}</button>`).join('')}
                <button onclick="mf.formA3('${a.id}')" style="margin-left:auto;background:none;border:none;color:#26c6da;cursor:pointer;font-size:.72rem;">editar ▸</button></div></div>`).join('');
        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label" style="margin-bottom:8px;">📄 A3 / PDCA — SOLUÇÃO ESTRUTURADA DE PROBLEMA</div>
                <p style="font-size:.8rem;color:var(--text-dim);margin:0 0 8px;">Uma página por problema: contexto → situação → meta → análise → contramedidas → resultado → padronizar. Acompanhe pela fase PDCA.</p>
                <button class="btn primary" style="font-size:.8rem;" onclick="mf.formA3()">+ Novo A3</button></div>
            ${cards || '<div class="summary-card" style="color:var(--text-dim);">Nenhum A3 ainda.</div>'}`;
    },
    async formA3(id) {
        const a = id ? (this._a3cache || []).find(x => x.id === id) || {} : {};
        const etapas = await api.get('/api/mf/etapas-processo') || [];
        const etOpt = `<option value="">— etapa —</option>` + etapas.map(e => `<option value="${e.id}"${a.etapa_id === e.id ? ' selected' : ''}>${e.ordem}. ${esc(e.nome)}</option>`).join('');
        const fld = (k, lbl, ph) => `<div style="margin-bottom:8px;"><span class="mf-label">${lbl}</span><textarea id="mf-a3-${k}" class="mf-input" style="width:100%;min-height:44px;" placeholder="${ph}">${esc(a[k] || '')}</textarea></div>`;
        this._modal(`<div class="s-label" style="margin-bottom:10px;">${id ? 'EDITAR' : 'NOVO'} A3 / PDCA</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                <input id="mf-a3-titulo" class="mf-input" placeholder="Título *" value="${esc(a.titulo || '')}">
                <input id="mf-a3-responsavel" class="mf-input" placeholder="Responsável" value="${esc(a.responsavel || '')}">
                <select id="mf-a3-etapa" class="mf-input" style="grid-column:1/-1;">${etOpt}</select></div>
            ${fld('contexto', '1. Contexto (por quê)', 'Background do problema')}
            ${fld('situacao_atual', '2. Situação atual', 'O problema hoje, com dados')}
            ${fld('meta', '3. Meta', 'Objetivo mensurável')}
            ${fld('analise', '4. Análise (causa raiz)', '5-porquês / Ishikawa')}
            ${fld('contramedidas', '5. Contramedidas (Do)', 'Plano de ação')}
            ${fld('resultado', '6. Resultado (Check)', 'O que mudou')}
            ${fld('aprendizado', '7. Padronizar (Act)', 'Próximos passos / padrão')}
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;"><button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button><button class="btn primary" onclick="mf.salvarA3('${id || ''}')">Salvar</button></div>`);
    },
    async salvarA3(id) {
        const titulo = $('mf-a3-titulo').value.trim();
        if (!titulo) return toast('Título obrigatório.', 'erro');
        const body = { titulo, responsavel: $('mf-a3-responsavel').value || null, etapa_id: $('mf-a3-etapa').value || null };
        ['contexto', 'situacao_atual', 'meta', 'analise', 'contramedidas', 'resultado', 'aprendizado'].forEach(k => { body[k] = $('mf-a3-' + k).value || null; });
        const r = id ? await api.put('/api/mf/a3/' + id, body) : await api.post('/api/mf/a3', body);
        toast(r?.ok ? 'A3 salvo.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) { this._fecharModal(); this.renderA3(); }
    },
    async moverA3(id, fase) { const r = await api.put('/api/mf/a3/' + id, { fase }); if (r?.ok) this.renderA3(); },

    // ═══ APONTAMENTO ═══════════════════════════════════════════════════════════
    async renderApont() {
        const c = this._cad;
        const opt = (arr, val, lbl) => arr.map(x => `<option value="${x.id}">${esc(lbl(x))}</option>`).join('');
        const [etapasR, wip] = await Promise.all([api.get('/api/mf/etapas-processo'), api.get('/api/mf/wip')]);
        const etapas = (this._etapasFluxo = etapasR) || [];
        this._wipPorEtapa = {};  // OPs que estão em cada etapa (o operador trabalha o que está na estação dele)
        if (wip?.board) wip.board.forEach(c => { this._wipPorEtapa[c.etapa_id] = (c.cards || []).map(k => ({ op_id: k.op_id, numero: k.numero, produto: k.produto })); });
        const etapaOpt = `<option value="">— sem etapa —</option>` + etapas.map(e => `<option value="${e.id}">${e.ordem}. ${esc(e.nome)}</option>`).join('');
        const novaSessao = `
        <div class="summary-card" style="margin-bottom:18px;">
            <div class="s-label" style="margin-bottom:14px;">+ NOVA SESSÃO DE APONTAMENTO</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">
                <div><span class="mf-label">ORDEM DE PRODUÇÃO * <span id="mf-op-toggle" onclick="mf._apontTodasToggle()" style="color:#26c6da;cursor:pointer;font-weight:400;text-transform:none;letter-spacing:0;">· ver todas</span></span>
                    <select id="mf-op" class="mf-input"></select></div>
                <div><span class="mf-label">MÁQUINA *</span><select id="mf-maq" class="mf-input" onchange="mf._apontEtapaAuto()">${opt(c.maquinas,'id',m=>`${m.codigo} · ${m.nome}`)}</select></div>
                <div><span class="mf-label">OPERADOR *</span><select id="mf-oper" class="mf-input">${opt(c.operadores,'id',o=>o.nome)}</select></div>
                <div><span class="mf-label">TURNO *</span><select id="mf-turno" class="mf-input">${opt(c.turnos,'id',t=>`${t.codigo} — ${t.descricao||''}`)}</select></div>
                <div><span class="mf-label">ETAPA DO FLUXO</span><select id="mf-etapa" class="mf-input">${etapaOpt}</select></div>
            </div>
            <button class="btn primary" style="margin-top:14px;" onclick="mf.iniciarSessao()">▶ Iniciar Sessão</button>
        </div>`;
        // configuração: vincular cada máquina a uma etapa (o apontamento preenche a etapa sozinho)
        const cfgMaq = `
        <div class="summary-card" style="margin-bottom:18px;">
            <button class="btn secondary" style="font-size:.78rem;" onclick="mf._maqEtapaToggle()">⚙ Vincular máquinas às etapas</button>
            <div id="mf-maqet" style="display:${this._maqEtAberto ? 'block' : 'none'};margin-top:12px;">
                <div style="font-size:.76rem;color:var(--text-dim);margin-bottom:10px;">Defina a etapa de cada máquina. Depois, ao escolher a máquina no apontamento, a etapa do fluxo vem automática.</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;">
                    ${c.maquinas.map(m => `<div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:.8rem;flex:1;">${esc(m.codigo)} · ${esc(m.nome)}</span>
                        <select onchange="mf.salvarMaqEtapa('${m.id}', this.value)" class="mf-input" style="width:140px;">
                            <option value="">— etapa —</option>
                            ${etapas.map(e => `<option value="${e.id}" ${m.etapa_id === e.id ? 'selected' : ''}>${e.ordem}. ${esc(e.nome)}</option>`).join('')}
                        </select></div>`).join('') || '<span style="color:var(--text-dim);font-size:.8rem;">Nenhuma máquina cadastrada.</span>'}
                </div>
            </div>
        </div>`;
        $('mf-pan-apont').innerHTML = `<div id="mf-adocao" style="font-size:.78rem;color:var(--text-dim);margin-bottom:12px;padding:8px 12px;background:rgba(38,166,154,.06);border:1px solid rgba(38,166,154,.2);border-radius:8px;">Carregando adoção...</div>` + novaSessao + cfgMaq + `<div id="mf-sessoes"></div>`;
        // modo quiosque: fixa a máquina deste tablet
        const kiosk = localStorage.getItem('mf_kiosk_maq');
        if (kiosk) {
            const m = c.maquinas.find(x => x.codigo === kiosk || x.id === kiosk);
            const sel = $('mf-maq');
            if (m && sel) { sel.value = m.id; sel.disabled = true;
                sel.insertAdjacentHTML('afterend', `<div style="font-size:.68rem;color:#26c6da;margin-top:4px;">🖥 quiosque: ${esc(m.codigo)} <span style="color:var(--text-dim);cursor:pointer;text-decoration:underline;" onclick="localStorage.removeItem('mf_kiosk_maq');mf.renderApont()">sair</span></div>`); }
        }
        this._autoPreencher();  // turno pelo horário + operador lembrado + etapa pela máquina
        this._apontOpsDaEtapa(); // mostra só as OPs da etapa da máquina
        api.get('/api/mf/adocao').then(a => { const el = $('mf-adocao'); if (el && a) el.innerHTML = `<span style="color:#26a69a;">●</span> Adoção hoje: <strong>${a.sessoes_hoje}</strong> sessões · <strong>${a.maquinas_hoje}/${a.maquinas_total}</strong> máquinas ativas · ${a.operadores_hoje} operadores`; });
        if (navigator.onLine) await this._reconciliar();
        this.renderSessoes();
    },
    _aoSincronizar() {  // a fila terminou de subir → atualiza a tela ativa para refletir o resultado
        if (this._abaAtiva === 'wip') this.renderWip();
        else if (this._abaAtiva === 'painel') this.renderPainel();
    },
    _turnoAtual() {  // turno cujo intervalo [início,fim) contém a hora atual (trata virada de meia-noite)
        const ts = this._cad.turnos || []; if (!ts.length) return null;
        const now = new Date(), hm = now.getHours() * 60 + now.getMinutes();
        const toMin = s => { const [h, m] = String(s).split(':'); return (+h) * 60 + (+m); };
        for (const t of ts) {
            if (!t.hora_inicio || !t.hora_fim) continue;
            const ini = toMin(t.hora_inicio), fim = toMin(t.hora_fim);
            if (fim > ini ? (hm >= ini && hm < fim) : (hm >= ini || hm < fim)) return t;
        }
        return ts[0];
    },
    _autoPreencher() {
        const t = this._turnoAtual(), selT = $('mf-turno'); if (t && selT) selT.value = t.id;
        const lastOp = localStorage.getItem('mf_last_oper'), selO = $('mf-oper');
        if (lastOp && selO && (this._cad.operadores || []).some(o => o.id === lastOp)) selO.value = lastOp;
        this._apontEtapaAuto();
    },
    _maqEtAberto: false,
    _maqEtapaToggle() { this._maqEtAberto = !this._maqEtAberto; const b = $('mf-maqet'); if (b) b.style.display = this._maqEtAberto ? 'block' : 'none'; },
    _apontEtapaAuto() {  // ao escolher a máquina, preenche a etapa e filtra as OPs daquela etapa
        const m = (this._cad.maquinas || []).find(x => x.id === $('mf-maq')?.value);
        const et = $('mf-etapa');
        if (m && m.etapa_id && et) et.value = m.etapa_id;
        this._apontOpsDaEtapa();
    },
    _apontOpsDaEtapa() {  // dropdown de OP mostra só o que está na etapa da máquina (pull); "ver todas" cai pro catálogo
        const sel = $('mf-op'); if (!sel) return;
        const m = (this._cad.maquinas || []).find(x => x.id === $('mf-maq')?.value);
        const etapaId = m?.etapa_id;
        const todas = this._apontTodasOps || !etapaId;
        const tg = $('mf-op-toggle'); if (tg) tg.textContent = todas ? (etapaId ? '· só desta etapa' : '') : '· ver todas';
        const lista = todas
            ? (this._cad.ops || []).map(o => ({ op_id: o.id, numero: o.numero, produto: o.produto?.descricao }))
            : (this._wipPorEtapa?.[etapaId] || []);
        sel.innerHTML = lista.length
            ? lista.map(o => `<option value="${o.op_id}">${esc(o.numero)}${o.produto ? ' — ' + esc(o.produto) : ''}</option>`).join('')
            : `<option value="">— nenhuma OP nesta etapa (jogue OPs no fluxo pela Fila) —</option>`;
    },
    _apontTodasToggle() { this._apontTodasOps = !this._apontTodasOps; this._apontOpsDaEtapa(); },
    async salvarMaqEtapa(maqId, etapaId) {
        const r = await api.put('/api/mf/maquinas/' + maqId, { etapa_id: etapaId || null });
        if (!r?.ok) return toast(r?.erro || 'Erro ao vincular.', 'erro');
        const m = (this._cad.maquinas || []).find(x => x.id === maqId); if (m) m.etapa_id = etapaId || null;  // atualiza cache local
        await fila.salvarEstado('cadastros', this._cad).catch(() => {});
        toast('Máquina vinculada à etapa.', 'ok');
        this._apontEtapaAuto();
    },

    async iniciarSessao() {
        const opId = $('mf-op').value, maqId = $('mf-maq').value, operId = $('mf-oper').value, turnoId = $('mf-turno').value;
        const etapaId = $('mf-etapa')?.value || null;
        if (!opId || !maqId || !operId || !turnoId) return toast('Preencha OP, máquina, operador e turno.', 'erro');
        if (this._dup('iniciar')) return;  // trava duplo-toque
        localStorage.setItem('mf_last_oper', operId);  // lembra o operador para a próxima sessão
        const id = this._uuid();
        const inicio = new Date().toISOString();   // hora REAL da captura — vai no payload; sem isso o sync offline gravava a hora do ENVIO (OEE/duração corrompidos)
        const c = this._cad;
        const etapaNome = (this._etapasFluxo || []).find(e => e.id === etapaId)?.nome || '';
        // estado otimista (mostra na hora, mesmo offline)
        this._abertas.unshift({ id, datahora_inicio: inicio, qtd_boa:0, qtd_refugo:0, qtd_retrabalho:0,
            op_id: opId, operador_id: operId, etapa_id: etapaId, etapa_nome: etapaNome,
            op: { numero: c.ops.find(o=>o.id===opId)?.numero || 'OP' },
            maquina: { codigo: c.maquinas.find(m=>m.id===maqId)?.codigo || '' },
            operador: { nome: c.operadores.find(o=>o.id===operId)?.nome || '' },
            turno: { codigo: c.turnos.find(t=>t.id===turnoId)?.codigo || '' },
            nao_conformidade: [], parada: [], _pendente: true });
        await fila.salvarEstado('abertas', this._abertas);
        this.renderSessoes();
        await fila.enfileirar('POST', '/api/mf/apontamentos', { id, op_id: opId, maquina_id: maqId, operador_id: operId, turno_id: turnoId, etapa_id: etapaId, datahora_inicio: inicio, dispositivo_id: navigator.userAgent.slice(0, 60) });
        toast(navigator.onLine ? 'Sessão iniciada.' : 'Sessão iniciada (offline — na fila).', navigator.onLine ? 'ok' : 'aviso');
    },

    renderSessoes() {
        const wrap = $('mf-sessoes'); if (!wrap) return;
        const abertas = this._abertas || [];
        if (!abertas.length) { wrap.innerHTML = `<div class="summary-card" style="color:var(--text-dim);text-align:center;padding:28px;">Nenhuma sessão aberta. Inicie uma acima.</div>`; return; }
        wrap.innerHTML = `<div class="s-label" style="margin:6px 0 12px;">SESSÕES ABERTAS (${abertas.length})</div>` + abertas.map(a => {
            const dur = Math.max(0, Math.round((Date.now() - new Date(a.datahora_inicio).getTime()) / 60000));
            const ncs = (a.nao_conformidade || []).length;
            const paradas = (a.parada || []).filter(p => !p.datahora_fim).length;
            return `<div class="summary-card" style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;">
                    <div><span style="font-weight:700;color:var(--indigo-primary);">${esc(a.op?.numero||'OP')}</span>
                        <span style="color:var(--text-dim);font-size:.82rem;"> · ${esc(a.maquina?.codigo||'')} · ${esc(a.operador?.nome||'')} · turno ${esc(a.turno?.codigo||'')}</span>${a.etapa_nome?`<span style="color:#26c6da;font-size:.78rem;"> · 🔀 ${esc(a.etapa_nome)}</span>`:''}</div>
                    <span style="font-size:.72rem;color:var(--text-dim);">há ${dur} min${ncs?` · <span style="color:#f06292;">${ncs} NC</span>`:''}${paradas?` · <span style="color:#ffca28;">${paradas} parada aberta</span>`:''}${a._pendente?` · <span style="color:#ef6c00;">⏳ pendente</span>`:''}</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:12px;">
                    <div><span class="mf-label">QTD BOA</span><input type="number" inputmode="decimal" min="0" step="0.001" value="${a.qtd_boa||0}" id="mf-qb-${a.id}" class="mf-input" oninput="mf._qtdInput('${a.id}')"></div>
                    <div><span class="mf-label">REFUGO</span><input type="number" inputmode="decimal" min="0" step="0.001" value="${a.qtd_refugo||0}" id="mf-qr-${a.id}" class="mf-input" oninput="mf._qtdInput('${a.id}')"></div>
                    <div><span class="mf-label">RETRABALHO</span><input type="number" inputmode="decimal" min="0" step="0.001" value="${a.qtd_retrabalho||0}" id="mf-qt-${a.id}" class="mf-input" oninput="mf._qtdInput('${a.id}')"></div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn secondary" style="font-size:.78rem;" onclick="mf.salvarQtd('${a.id}')">💾 Salvar qtd</button>
                    <button class="btn secondary" style="font-size:.78rem;" onclick="mf.formParada('${a.id}')">⏸ Registrar parada</button>
                    <button class="btn secondary" style="font-size:.78rem;" onclick="mf.formMedicao('${a.id}')">📏 Medir</button>
                    <button class="btn secondary" style="font-size:.78rem;border-color:rgba(240,98,146,.4);color:#f06292;" onclick="mf.formNc('${a.id}')">⚠ Registrar NC</button>
                    <button class="btn secondary" style="font-size:.78rem;" onclick="mf.verInstrucao('${a.id}')">📄 Instrução</button>
                    <button class="btn secondary" style="font-size:.78rem;" onclick="mf.formConsumoFio('${a.id}')">📦 Fio</button>
                    <button class="btn secondary" style="font-size:.78rem;border-color:rgba(255,82,82,.5);color:#ff5252;" onclick="mf.formAndon('${a.id}')">🆘 Andon</button>
                    ${a.etapa_id?`<label style="display:flex;align-items:center;gap:5px;font-size:.74rem;color:var(--text-dim);margin-left:auto;cursor:pointer;" title="Ao fechar, move a OP para a próxima etapa do fluxo"><input type="checkbox" id="mf-av-${a.id}" checked> avançar no fluxo</label>`:''}
                    <button class="btn primary" style="font-size:.78rem;${a.etapa_id?'':'margin-left:auto;'}" onclick="mf.fecharSessao('${a.id}')">✓ Fechar sessão</button>
                </div>
            </div>`;
        }).join('');
    },

    // A7: mantém o que o operador digitou no objeto da sessão, pra não perder se a lista re-renderizar (parada/NC)
    _qtdInput(id) {
        const a = this._abertas.find(x => x.id === id); if (!a) return;
        const qb = $('mf-qb-' + id), qr = $('mf-qr-' + id), qt = $('mf-qt-' + id);
        if (qb) a.qtd_boa = parseFloat(qb.value) || 0;
        if (qr) a.qtd_refugo = parseFloat(qr.value) || 0;
        if (qt) a.qtd_retrabalho = parseFloat(qt.value) || 0;
        a._qtdDirty = true;   // digitado e ainda não salvo — o reconcile preserva
    },

    async salvarQtd(id) {
        const qtd = { qtd_boa: parseFloat($('mf-qb-' + id).value) || 0, qtd_refugo: parseFloat($('mf-qr-' + id).value) || 0, qtd_retrabalho: parseFloat($('mf-qt-' + id).value) || 0 };
        const a = this._abertas.find(x => x.id === id); if (a) { Object.assign(a, qtd); a._qtdDirty = false; }
        await fila.salvarEstado('abertas', this._abertas);
        await fila.enfileirar('PUT', '/api/mf/apontamentos/' + id, { ...qtd });
        toast(navigator.onLine ? 'Quantidades salvas.' : 'Salvo na fila (offline).', navigator.onLine ? 'ok' : 'aviso');
    },

    async fecharSessao(id) {
        if (this._dup('fechar:' + id)) return;  // trava duplo-toque, escopada por sessão (não bloqueia fechar outra sessão)
        if (!confirm('Encerrar esta sessão de produção? Isso conclui o apontamento.')) return;  // A5: evita fechar por toque acidental
        const qtd = { qtd_boa: parseFloat($('mf-qb-' + id).value) || 0, qtd_refugo: parseFloat($('mf-qr-' + id).value) || 0, qtd_retrabalho: parseFloat($('mf-qt-' + id).value) || 0 };
        const avancar = $('mf-av-' + id)?.checked || false;  // concluir a etapa e mover a OP no fluxo
        this._abertas = this._abertas.filter(x => x.id !== id);  // some da lista de abertas
        await fila.salvarEstado('abertas', this._abertas);
        this.renderSessoes();
        await fila.enfileirar('PUT', '/api/mf/apontamentos/' + id, { ...qtd });
        await fila.enfileirar('PUT', '/api/mf/apontamentos/' + id, { fechar: true, avancar, datahora_fim: new Date().toISOString() });   // hora real do fechamento (não a do sync)
        toast(navigator.onLine ? (avancar ? 'Sessão fechada e OP avançada no fluxo.' : 'Sessão fechada.') : 'Fechada (offline — na fila).', navigator.onLine ? 'ok' : 'aviso');
    },

    // ── Parada ──
    formParada(apId) {
        const motivos = this._cad.motivos.map(m => `<option value="${m.id}">${esc(m.descricao)}${m.planejada?' (planejada)':''}</option>`).join('');
        this._modal(`
            <div class="s-label" style="margin-bottom:14px;">⏸ REGISTRAR PARADA</div>
            <span class="mf-label">MOTIVO</span><select id="mf-mot" class="mf-input" style="margin-bottom:12px;">${motivos}</select>
            <span class="mf-label">OBSERVAÇÃO</span><input id="mf-mot-obs" class="mf-input" placeholder="opcional" style="margin-bottom:16px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="mf.salvarParada('${apId}')">Registrar parada aberta</button>
            </div>
            <p style="font-size:.72rem;color:var(--text-dim);margin-top:10px;">A parada fica aberta; feche-a depois na lista de paradas da sessão.</p>`);
    },
    async salvarParada(apId) {
        const motivo_id = $('mf-mot').value, observacao = $('mf-mot-obs').value || null;
        if (!motivo_id) return toast('Selecione o motivo.', 'erro');
        if (this._dup('parada:' + apId)) return;  // trava duplo-toque (por sessão — não bloqueia parada de outra sessão)
        const id = this._uuid();
        const inicio = new Date().toISOString();   // hora real da parada, não a do sync
        const a = this._abertas.find(x => x.id === apId); if (a) { (a.parada = a.parada || []).push({ id, datahora_fim: null }); }
        await fila.salvarEstado('abertas', this._abertas);
        this._fecharModal(); this.renderSessoes();
        await fila.enfileirar('POST', '/api/mf/paradas', { id, apontamento_id: apId, motivo_id, observacao, datahora_inicio: inicio });
        toast(navigator.onLine ? 'Parada registrada.' : 'Parada na fila (offline).', navigator.onLine ? 'ok' : 'aviso');
    },

    // ── Medição (CEP) na sessão ──
    formMedicao(apId) {
        const a = this._abertas.find(x => x.id === apId);
        const op = a && this._cad.ops.find(o => o.id === a.op_id);
        const prod = op && this._cad.produtos.find(p => p.id === op.produto_id);
        this._modal(`
            <div class="s-label" style="margin-bottom:6px;">📏 MEDIÇÃO — CEP</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin-bottom:12px;">Sessão ${esc(a?.op?.numero||'')}${prod?` · ${esc(prod.codigo)} (alvo gram. ${prod.gramatura_alvo??'—'}${prod.gramatura_tol?'±'+prod.gramatura_tol:''} · larg. ${prod.largura_alvo??'—'}${prod.largura_tol?'±'+prod.largura_tol:''})`:''}</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;">
                <div><span class="mf-label">VARIÁVEL</span><select id="mf-ms-tipo" class="mf-input" onchange="mf._medAviso()"><option value="gramatura">gramatura (g/m²)</option><option value="largura">largura (cm)</option></select></div>
                <div><span class="mf-label">VALOR MEDIDO</span><input id="mf-ms-val" type="number" step="0.01" class="mf-input" oninput="mf._medAviso()"></div>
            </div>
            <div id="mf-ms-aviso" style="font-size:.74rem;margin-bottom:14px;min-height:16px;"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="mf.salvarMedicao2('${apId}')">Registrar medição</button>
            </div>`);
        this._medProd = prod || null;
    },
    _medAviso() {
        const el = $('mf-ms-aviso'); const p = this._medProd; if (!el) return;
        const v = parseFloat($('mf-ms-val').value); const tipo = $('mf-ms-tipo').value;
        if (!p || isNaN(v)) { el.textContent = ''; return; }
        const alvo = tipo === 'gramatura' ? p.gramatura_alvo : p.largura_alvo;
        const tol  = tipo === 'gramatura' ? p.gramatura_tol  : p.largura_tol;
        if (alvo == null || !tol) { el.innerHTML = '<span style="color:var(--text-dim);">defina alvo+tolerância do produto p/ ver fora de especificação</span>'; return; }
        const fora = v < (alvo - tol) || v > (alvo + tol);
        el.innerHTML = fora ? `<span style="color:#f06292;font-weight:700;">⚠ FORA da especificação (${(alvo-tol)}–${(alvo+tol)})</span>` : `<span style="color:#26a69a;">✓ dentro da especificação</span>`;
    },
    async salvarMedicao2(apId) {
        const v = parseFloat($('mf-ms-val').value);
        if (isNaN(v)) return toast('Informe o valor medido.', 'erro');
        const a = this._abertas.find(x => x.id === apId);
        const op = a && this._cad.ops.find(o => o.id === a.op_id);
        if (!op?.produto_id) return toast('OP sem produto vinculado.', 'erro');
        if (this._dup('medicao:' + apId)) return;  // trava duplo-toque
        const id = this._uuid();  // offline-first: vai pela fila (idempotente), não se perde sem rede
        await fila.enfileirar('POST', '/api/mf/medicao', { id, apontamento_id: apId, produto_id: op.produto_id, operador_id: a.operador_id || null, tipo: $('mf-ms-tipo').value, valor: v });
        this._fecharModal();
        toast(navigator.onLine ? 'Medição registrada (alimenta o CEP).' : 'Medição na fila (offline).', navigator.onLine ? 'ok' : 'aviso');
    },

    // ── NC com foto ──
    formNc(apId) {
        const defs = this._cad.defeitos.map(d => `<option value="${d.id}" data-disp="${d.disposicao_padrao||'segregar'}" data-sev="${d.severidade}">${esc(d.codigo)} — ${esc(d.descricao)} (sev ${d.severidade})</option>`).join('');
        const disp = ['liberar','retrabalhar','refugar','segregar','reclassificar'].map(d => `<option value="${d}">${d}</option>`).join('');
        this._modal(`
            <div class="s-label" style="margin-bottom:14px;">⚠ REGISTRAR NÃO CONFORMIDADE</div>
            <span class="mf-label">DEFEITO</span>
            <select id="mf-nc-def" class="mf-input" style="margin-bottom:12px;" onchange="mf._syncDisp()">${defs}</select>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                <div><span class="mf-label">QTD AFETADA</span><input id="mf-nc-qtd" type="number" min="0.001" step="0.001" class="mf-input" value="1"></div>
                <div><span class="mf-label">DISPOSIÇÃO</span><select id="mf-nc-disp" class="mf-input">${disp}</select></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                <div><span class="mf-label">POSIÇÃO</span><input id="mf-nc-pos" class="mf-input" placeholder="ex: agulha 340"></div>
                <div><span class="mf-label">CAUSA PRELIMINAR</span><input id="mf-nc-causa" class="mf-input" placeholder="opcional"></div>
            </div>
            <span class="mf-label">FOTO (opcional)</span>
            <input id="mf-nc-foto" type="file" accept="image/*" capture="environment" class="mf-input" style="margin-bottom:8px;" onchange="mf._previewFoto(event)">
            <img id="mf-nc-prev" style="display:none;max-width:140px;border-radius:8px;margin-bottom:12px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="mf.salvarNc('${apId}')">Salvar NC</button>
            </div>`);
        this._syncDisp();
    },
    _syncDisp() {
        const sel = $('mf-nc-def'); if (!sel) return;
        const opt = sel.options[sel.selectedIndex];
        const disp = $('mf-nc-disp'); if (!opt || !disp) return;
        // trava de qualidade: defeito crítico (sev 4) não pode ser liberado
        const sev = Number(opt.dataset.sev) || 0;
        const optLib = [...disp.options].find(o => o.value === 'liberar');
        if (optLib) { optLib.disabled = sev >= 4; optLib.textContent = sev >= 4 ? 'liberar (bloqueado p/ crítico)' : 'liberar'; }
        let sugestao = opt.dataset.disp || 'segregar';
        if (sev >= 4 && sugestao === 'liberar') sugestao = 'segregar';
        disp.value = sugestao;
    },
    _previewFoto(ev) {
        const f = ev.target.files?.[0]; if (!f) return;
        this._comprimirFoto(f)
            .then(d => { const img = $('mf-nc-prev'); img.src = d.url; img.style.display = 'block'; this._fotoData = d; })
            .catch(() => { this._fotoData = null; ev.target.value = ''; toast('Não consegui ler esta imagem (formato não suportado — use JPG/PNG). A NC pode ser salva sem foto.', 'erro'); });
    },
    _comprimirFoto(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const max = 1024, sc = Math.min(1, max / Math.max(img.width, img.height));
                const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
                const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                const url = cv.toDataURL('image/jpeg', 0.7);
                resolve({ url, w, h, bytes: Math.round(url.length * 0.75), nome: file.name });
            };
            img.onerror = () => reject(new Error('formato'));   // ex.: HEIC não decodificável — antes travava sem feedback e a NC subia sem foto
            img.src = URL.createObjectURL(file);
        });
    },
    async salvarNc(apId) {
        const qtd = parseFloat($('mf-nc-qtd').value);
        if (!qtd || qtd <= 0) return toast('Quantidade afetada deve ser > 0.', 'erro');
        if (!$('mf-nc-def')?.value) return toast('Selecione o defeito (catálogo).', 'erro');  // M8: NC é sempre do catálogo
        if (this._dup('nc:' + apId)) return;  // trava duplo-toque (por sessão)
        const ncId = this._uuid();
        const foto = this._fotoData;
        const a = this._abertas.find(x => x.id === apId); if (a) (a.nao_conformidade = a.nao_conformidade || []).push({ id: ncId });
        // unidade da NC = unidade da OP/sessão (era 'kg' fixo — misturava kg com pc no CNQ/Pareto)
        const opNc = a && this._cad.ops.find(o => o.id === a.op_id);
        await fila.salvarEstado('abertas', this._abertas);
        // NC primeiro, foto depois (a fila respeita a ordem → foto só sobe após a NC existir)
        await fila.enfileirar('POST', '/api/mf/ncs', {
            id: ncId, apontamento_id: apId, defeito_id: $('mf-nc-def').value, qtd_afetada: qtd, unidade: opNc?.unidade || 'kg',
            datahora: new Date().toISOString(),   // hora real do registro (não a do sync — a janela de recorrência do RNC depende disso)
            disposicao: $('mf-nc-disp').value, posicao: $('mf-nc-pos').value || null, causa_preliminar: $('mf-nc-causa').value || null,
        });
        if (foto) {
            await fila.enfileirar('POST', '/api/mf/fotos', { id: this._uuid(), nc_id: ncId, url: foto.url, nome_arquivo: foto.nome,
                tamanho_bytes: foto.bytes, largura_px: foto.w, altura_px: foto.h });
            this._fotoData = null;
        }
        this._fecharModal();
        toast(navigator.onLine ? 'NC registrada.' : 'NC na fila (offline) — sobe ao reconectar.', navigator.onLine ? 'ok' : 'aviso');
        this.renderSessoes();
    },

    // ═══ NÃO CONFORMIDADES (lista) ═════════════════════════════════════════════
    async renderNcs() {
        const pan = $('mf-pan-ncs');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const ncs = await api.get('/api/mf/ncs') || [];
        if (!ncs.length) { pan.innerHTML = `<div class="summary-card" style="text-align:center;padding:28px;color:var(--text-dim);">Nenhuma não conformidade registrada.</div>`; return; }
        const sevCor = { 1:'#8b949e', 2:'#ffca28', 3:'#ef6c00', 4:'#f06292' };
        pan.innerHTML = `<div class="summary-card" style="padding:0;overflow:hidden;">
            <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.68rem;">
                <th style="padding:10px 12px;text-align:left;">DATA</th><th style="padding:10px;text-align:left;">DEFEITO</th>
                <th style="padding:10px;text-align:right;">QTD</th><th style="padding:10px;text-align:left;">DISPOSIÇÃO</th>
                <th style="padding:10px;text-align:center;">SEV</th><th style="padding:10px;text-align:center;">RNC</th><th style="padding:10px;text-align:center;">FOTO</th>
            </tr></thead><tbody>${ncs.map((n,i) => `<tr style="background:${i%2?'var(--bg-input)':'transparent'};border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:8px 12px;color:var(--text-dim);white-space:nowrap;">${new Date(n.datahora).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                <td style="padding:8px;">${esc(n.defeito?.codigo||'')} — ${esc(n.defeito?.descricao||'')}</td>
                <td style="padding:8px;text-align:right;">${Number(n.qtd_afetada).toLocaleString('pt-BR')}</td>
                <td style="padding:8px;">${esc(n.disposicao)}</td>
                <td style="padding:8px;text-align:center;"><span style="color:${sevCor[n.severidade_aplicada]};font-weight:700;">${n.severidade_aplicada}</span></td>
                <td style="padding:8px;text-align:center;">${n.gera_rnc?'<span style="color:#f06292;font-weight:700;">SIM</span>':'—'}</td>
                <td style="padding:8px;text-align:center;">${(n.foto?.length && fotoUrlSegura(n.foto[0].url))?`<img src="${esc(fotoUrlSegura(n.foto[0].url))}" style="width:34px;height:34px;object-fit:cover;border-radius:5px;cursor:pointer;" onclick="window.open(this.src,'_blank')">`:'—'}</td>
            </tr>`).join('')}</tbody></table></div>`;
    },

    // ═══ IMPORTAR LEGADO ═══════════════════════════════════════════════════════
    // ═══ RNC / CAPA — LOOP DE AÇÃO CORRETIVA ═══════════════════════════════════
    _ESTAGIOS: { aberta:'1 · Aberta', em_analise:'2 · Análise de causa', em_acao:'3 · Ação corretiva', verificacao:'4 · Verificação', fechada:'✓ Fechada', cancelada:'✕ Cancelada' },
    async renderRnc() {
        const pan = $('mf-pan-rnc');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando...</div>`;
        const d = await api.get('/api/mf/rncs');
        if (!d) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">RNC indisponível — rode <b>mes_rnc.sql</b> no SQL Editor.</div>`; return; }
        this._rncs = d.rncs || [];
        const r = d.resumo || {};
        const kpis = [
            ['#26c6da', r.abertas||0, 'ABERTAS'], ['#7c4dff', r.em_acao||0, 'EM AÇÃO'],
            ['#ffca28', r.verificacao||0, 'VERIFICAÇÃO'], ['#f06292', r.atrasadas||0, 'ATRASADAS'],
            ['#26a69a', r.fechadas_eficazes||0, 'FECHADAS (EFICAZES)'],
        ].map(([c,n,l]) => `<div style="background:${c}18;border:1px solid ${c}44;border-radius:10px;padding:12px 18px;text-align:center;flex:1;min-width:110px;">
            <div style="font-size:1.5rem;font-weight:800;color:${c};">${n}</div><div style="font-size:.62rem;color:${c};letter-spacing:.05em;">${l}</div></div>`).join('');
        // Kanban por estágio do CAPA
        const cols = [
            { st:'aberta',      lbl:'ABERTA',      cor:'#26c6da' },
            { st:'em_analise',  lbl:'ANÁLISE',     cor:'#ffca28' },
            { st:'em_acao',     lbl:'AÇÃO',        cor:'#7c4dff' },
            { st:'verificacao', lbl:'VERIFICAÇÃO', cor:'#ff9800' },
            { st:'fechada',     lbl:'FECHADA',     cor:'#26a69a' },
        ];
        const prioCor = this._PRIO_COR || { critica:'#ff5252', alta:'#f06292', media:'#ffca28', baixa:'#8b949e' };
        const card = x => {
            const atrasada = x.prazo && new Date(x.prazo) < new Date() && !['fechada','cancelada'].includes(x.status);
            return `<div class="mf-rnc-card" draggable="true" ondragstart="mf._rncDragStart(event,'${x.id}')" onclick="mf.abrirRnc('${x.id}')"
                style="background:var(--bg-card);border:1px solid var(--border-color);border-left:3px solid ${prioCor[x.prioridade]||'#8b949e'};border-radius:8px;padding:9px 11px;margin-bottom:8px;cursor:pointer;">
                <div style="font-size:.8rem;font-weight:600;margin-bottom:3px;">${esc((x.titulo||'').slice(0,46))}</div>
                <div style="font-size:.66rem;color:var(--text-dim);">${x.maquina?.codigo?esc(x.maquina.codigo)+' · ':''}${x.prioridade}${x.responsavel?.nome?' · '+esc(x.responsavel.nome):''}</div>
                ${x.prazo?`<div style="font-size:.64rem;color:${atrasada?'#f06292':'var(--text-dim)'};font-weight:${atrasada?'700':'400'};margin-top:2px;">${atrasada?'⚠ ATRASADA · ':''}prazo ${new Date(x.prazo).toLocaleDateString('pt-BR')}</div>`:''}
                ${x.eficaz===false?`<div style="font-size:.62rem;color:#f06292;margin-top:2px;">↩ ação ineficaz — reaberta</div>`:''}
            </div>`;
        };
        const board = cols.map(c => {
            const lista = this._rncs.filter(x => x.status === c.st);
            return `<div style="flex:1;min-width:185px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid ${c.cor};">
                    <span style="font-size:.68rem;font-weight:700;color:${c.cor};letter-spacing:.04em;">${c.lbl}</span>
                    <span style="font-size:.64rem;color:var(--text-dim);background:${c.cor}22;border-radius:10px;padding:0 7px;">${lista.length}</span>
                </div>
                <div class="mf-rnc-col" data-status="${c.st}" ondragover="event.preventDefault();this.style.background='rgba(255,255,255,.03)'" ondragleave="this.style.background=''" ondrop="mf._rncDrop(event,'${c.st}')"
                    style="min-height:120px;border-radius:8px;padding:4px;transition:background .15s;">
                    ${lista.map(card).join('') || `<div style="font-size:.7rem;color:var(--text-dim);text-align:center;padding:14px;">—</div>`}
                </div>
            </div>`;
        }).join('');
        pan.innerHTML = `
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">${kpis}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <span style="font-size:.72rem;color:var(--text-dim);">Clique num cartão para tocar o CAPA. Arraste para o próximo estágio (pede os dados do passo).</span>
                <button class="btn secondary" style="font-size:.78rem;" onclick="mf.novaRnc()">+ Nova RNC</button>
            </div>
            ${this._rncs.length ? `<div style="display:flex;gap:12px;overflow-x:auto;align-items:flex-start;">${board}</div>`
                : `<div class="summary-card" style="text-align:center;padding:24px;color:var(--text-dim);">Nenhuma RNC. Elas abrem sozinhas quando um gatilho dispara, ou crie manualmente.</div>`}`;
    },
    _rncDragStart(ev, id) { ev.dataTransfer.setData('text/plain', id); ev.stopPropagation(); },
    _rncDrop(ev, novoStatus) {
        ev.preventDefault();
        const col = ev.currentTarget; if (col) col.style.background = '';
        const id = ev.dataTransfer.getData('text/plain'); if (!id) return;
        const x = (this._rncs || []).find(r => r.id === id);
        if (!x || x.status === novoStatus) return;
        // cada transição exige os dados do passo → abre o fluxo (que avança a partir do estágio atual)
        this.abrirRnc(id);
    },
    novaRnc() {
        const defOpt = this._cad.defeitos.map(x => `<option value="${x.id}">${esc(x.codigo)} — ${esc(x.descricao)}</option>`).join('');
        const maqOpt = this._cad.maquinas.map(m => `<option value="${m.id}">${esc(m.codigo)}</option>`).join('');
        this._modal(`<div class="s-label" style="margin-bottom:12px;">+ NOVA RNC</div>
            <span class="mf-label">TÍTULO *</span><input id="mf-rn-tit" class="mf-input" placeholder="ex: Recorrência de furos na CIRC-01" style="margin-bottom:10px;">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
                <div><span class="mf-label">DEFEITO</span><select id="mf-rn-def" class="mf-input"><option value="">—</option>${defOpt}</select></div>
                <div><span class="mf-label">MÁQUINA</span><select id="mf-rn-maq" class="mf-input"><option value="">—</option>${maqOpt}</select></div>
                <div><span class="mf-label">PRIORIDADE</span><select id="mf-rn-prio" class="mf-input"><option value="baixa">baixa</option><option value="media" selected>média</option><option value="alta">alta</option><option value="critica">crítica</option></select></div>
            </div>
            <span class="mf-label">DESCRIÇÃO</span><input id="mf-rn-desc" class="mf-input" style="margin-bottom:14px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button><button class="btn primary" onclick="mf.salvarNovaRnc()">Abrir RNC</button></div>`);
    },
    async salvarNovaRnc() {
        const t = $('mf-rn-tit').value.trim(); if (!t) return toast('Informe o título.', 'erro');
        const r = await api.post('/api/mf/rncs', { titulo: t, defeito_id: $('mf-rn-def').value||null, maquina_id: $('mf-rn-maq').value||null, prioridade: $('mf-rn-prio').value, descricao: $('mf-rn-desc').value||null });
        if (!r?.ok) return toast('Erro: '+(r?.erro||''), 'erro');
        this._fecharModal(); toast('RNC aberta.'); this.renderRnc();
    },
    abrirRnc(id) {
        const x = (this._rncs||[]).find(r => r.id === id); if (!x) return;
        const operOpt = this._cad.operadores.map(o => `<option value="${o.id}"${x.responsavel_id===o.id?' selected':''}>${esc(o.nome)}</option>`).join('');
        const campo = (lbl, html) => `<div style="margin-bottom:10px;"><span class="mf-label">${lbl}</span>${html}</div>`;
        let corpo = `<div style="background:var(--bg-input);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.8rem;">
            <div style="font-weight:600;">${esc(x.titulo)}</div><div style="color:var(--text-dim);font-size:.74rem;">${esc(x.descricao||'')}</div></div>`;
        // estágio 1 → define responsável/prazo e inicia análise
        if (x.status === 'aberta') corpo += `
            ${campo('RESPONSÁVEL', `<select id="mf-rw-resp" class="mf-input">${operOpt}</select>`)}
            ${campo('PRAZO', `<input id="mf-rw-prazo" type="date" class="mf-input">`)}
            <button class="btn primary" onclick="mf.avancarRnc('${id}','analise')">Iniciar análise de causa →</button>`;
        else if (x.status === 'em_analise') corpo += `
            ${campo('CAUSA RAIZ', `<textarea id="mf-rw-causa" class="mf-input" rows="3" placeholder="ex: agulha gasta além da vida útil">${esc(x.causa_raiz||'')}</textarea>`)}
            ${campo('MÉTODO', `<select id="mf-rw-met" class="mf-input"><option value="cinco_porques">5 Porquês</option><option value="ishikawa">Ishikawa</option><option value="outro">Outro</option></select>`)}
            <button class="btn primary" onclick="mf.avancarRnc('${id}','acao')">Definir ação corretiva →</button>`;
        else if (x.status === 'em_acao') corpo += `
            <div style="font-size:.74rem;color:var(--text-dim);margin-bottom:8px;">Causa raiz: ${esc(x.causa_raiz||'—')}</div>
            ${campo('AÇÃO CORRETIVA', `<textarea id="mf-rw-acao" class="mf-input" rows="3" placeholder="ex: plano de troca de agulhas a cada 5.000 kg">${esc(x.acao_corretiva||'')}</textarea>`)}
            <button class="btn primary" onclick="mf.avancarRnc('${id}','verificacao')">Concluir ação → verificar eficácia →</button>`;
        else if (x.status === 'verificacao') corpo += `
            <div style="font-size:.74rem;color:var(--text-dim);margin-bottom:8px;">Ação: ${esc(x.acao_corretiva||'—')}</div>
            ${campo('A AÇÃO FOI EFICAZ? (defeito não recorreu)', `<select id="mf-rw-efic" class="mf-input"><option value="true">Sim — eficaz</option><option value="false">Não — reabrir ação</option></select>`)}
            ${campo('OBSERVAÇÃO', `<input id="mf-rw-vobs" class="mf-input" value="${esc(x.verificacao_obs||'')}">`)}
            <button class="btn primary" onclick="mf.verificarRnc('${id}')">Registrar verificação</button>`;
        else corpo += `<div style="color:var(--text-dim);font-size:.82rem;">RNC ${x.status}. Causa: ${esc(x.causa_raiz||'—')} · Ação: ${esc(x.acao_corretiva||'—')} · Eficaz: ${x.eficaz===true?'sim':x.eficaz===false?'não':'—'}</div>`;
        this._modal(`<div class="s-label" style="margin-bottom:6px;">RNC — ${this._ESTAGIOS[x.status]}</div>${corpo}
            <div style="margin-top:12px;text-align:right;"><button class="btn secondary" style="font-size:.74rem;" onclick="mf._fecharModal()">Fechar</button></div>`);
    },
    async avancarRnc(id, etapa) {
        const upd = { avancar: etapa };
        if (etapa === 'analise') { upd.responsavel_id = $('mf-rw-resp')?.value || null; upd.prazo = $('mf-rw-prazo')?.value || null; }
        if (etapa === 'acao')    { upd.causa_raiz = $('mf-rw-causa')?.value || null; upd.metodo_analise = $('mf-rw-met')?.value || null; }
        if (etapa === 'verificacao') upd.acao_corretiva = $('mf-rw-acao')?.value || null;
        const r = await api.put('/api/mf/rncs/' + id, upd);
        if (!r?.ok) return toast('Erro: '+(r?.erro||''), 'erro');
        this._fecharModal(); toast('RNC avançada.'); this.renderRnc();
    },
    async verificarRnc(id) {
        const eficaz = $('mf-rw-efic').value === 'true';
        const upd = eficaz ? { avancar: 'fechar', eficaz: true, verificacao_obs: $('mf-rw-vobs').value||null }
                           : { status: 'em_acao', eficaz: false, verificacao_obs: $('mf-rw-vobs').value||null };
        const r = await api.put('/api/mf/rncs/' + id, upd);
        if (!r?.ok) return toast('Erro: '+(r?.erro||''), 'erro');
        this._fecharModal(); toast(eficaz ? 'RNC fechada (eficaz).' : 'Ação reaberta — não foi eficaz.', eficaz?'ok':'aviso'); this.renderRnc();
    },

    // ═══ CADASTROS TPM (peças, componentes, planos) ════════════════════════════
    async renderCadTpm() {
        const pan = $('mf-pan-cad');
        const [pecas, comps, planos] = await Promise.all([api.get('/api/mf/pecas'), api.get('/api/mf/componentes'), api.get('/api/mf/planos')]);
        const maqOpt = this._cad.maquinas.map(m => `<option value="${m.id}">${esc(m.codigo)}</option>`).join('');
        const lin = (arr, cols) => (arr && arr.length) ? arr.map(r => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">${cols(r)}</tr>`).join('') : `<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--text-dim);">vazio</td></tr>`;
        pan.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:10px;">🔩 PEÇA / SOBRESSALENTE</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:10px;">
                <div><span class="mf-label">CÓDIGO *</span><input id="mf-pc-cod" class="mf-input"></div>
                <div><span class="mf-label">NOME *</span><input id="mf-pc-nome" class="mf-input"></div>
                <div><span class="mf-label">CATEGORIA</span><input id="mf-pc-cat" class="mf-input" placeholder="agulha, correia"></div>
                <div><span class="mf-label">UNIDADE *</span><select id="mf-pc-un" class="mf-input"><option>un</option><option>kg</option><option>m</option><option>jogo</option></select></div>
                <div><span class="mf-label">ESTOQUE</span><input id="mf-pc-est" type="number" min="0" class="mf-input" value="0"></div>
                <div><span class="mf-label">MÍNIMO</span><input id="mf-pc-min" type="number" min="0" class="mf-input" value="0"></div>
            </div>
            <button class="btn primary" onclick="mf.salvarPeca()">Salvar peça</button>
            <div style="overflow-x:auto;margin-top:12px;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">
            <thead><tr style="color:var(--text-dim);font-size:.64rem;border-bottom:1px solid var(--border-color);"><th style="padding:6px 8px;text-align:left;">CÓD</th><th style="padding:6px 8px;text-align:left;">NOME</th><th style="padding:6px 8px;text-align:right;">ESTOQUE</th><th style="padding:6px 8px;text-align:right;">MÍN</th></tr></thead>
            <tbody>${lin(pecas, p => `<td style="padding:6px 8px;font-weight:600;color:var(--indigo-primary);">${esc(p.codigo)}</td><td style="padding:6px 8px;">${esc(p.nome)}</td><td style="padding:6px 8px;text-align:right;color:${p.estoque_atual<=p.estoque_minimo?'#f06292':'inherit'};">${Number(p.estoque_atual).toLocaleString('pt-BR')} ${esc(p.unidade)}</td><td style="padding:6px 8px;text-align:right;color:var(--text-dim);">${Number(p.estoque_minimo).toLocaleString('pt-BR')}</td>`)}</tbody></table></div>
        </div>
        <div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:10px;">⚙ COMPONENTE DA MÁQUINA</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:10px;">
                <div><span class="mf-label">MÁQUINA *</span><select id="mf-cp-maq" class="mf-input">${maqOpt}</select></div>
                <div><span class="mf-label">CÓDIGO *</span><input id="mf-cp-cod" class="mf-input" placeholder="CIRC12-CIL"></div>
                <div><span class="mf-label">NOME *</span><input id="mf-cp-nome" class="mf-input" placeholder="Cilindro de agulhas"></div>
                <div><span class="mf-label">TIPO *</span><select id="mf-cp-tipo" class="mf-input"><option>desgaste</option><option>mecanico</option><option>eletrico</option><option>pneumatico</option><option>outro</option></select></div>
                <div><span class="mf-label">VIDA ÚTIL</span><input id="mf-cp-vida" type="number" min="0" class="mf-input"></div>
                <div><span class="mf-label">UNID. VIDA</span><select id="mf-cp-vun" class="mf-input"><option value="">—</option><option>horas</option><option>kg</option><option>ciclos</option><option>dias</option></select></div>
            </div>
            <button class="btn primary" onclick="mf.salvarComponente()">Salvar componente</button>
            <div style="overflow-x:auto;margin-top:12px;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">
            <thead><tr style="color:var(--text-dim);font-size:.64rem;border-bottom:1px solid var(--border-color);"><th style="padding:6px 8px;text-align:left;">CÓD</th><th style="padding:6px 8px;text-align:left;">NOME</th><th style="padding:6px 8px;text-align:left;">MÁQUINA</th><th style="padding:6px 8px;text-align:left;">TIPO</th></tr></thead>
            <tbody>${lin(comps, c => `<td style="padding:6px 8px;font-weight:600;color:var(--indigo-primary);">${esc(c.codigo)}</td><td style="padding:6px 8px;">${esc(c.nome)}</td><td style="padding:6px 8px;">${esc(c.maquina?.codigo||'')}</td><td style="padding:6px 8px;color:var(--text-dim);">${esc(c.tipo)}</td>`)}</tbody></table></div>
        </div>
        <div class="summary-card">
            <div class="s-label" style="margin-bottom:10px;">📅 PLANO DE MANUTENÇÃO</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:10px;">
                <div><span class="mf-label">MÁQUINA *</span><select id="mf-pl-maq" class="mf-input">${maqOpt}</select></div>
                <div><span class="mf-label">NOME *</span><input id="mf-pl-nome" class="mf-input" placeholder="Troca de agulhas"></div>
                <div><span class="mf-label">TIPO *</span><select id="mf-pl-tipo" class="mf-input"><option>preventiva</option><option>preditiva</option><option>lubrificacao</option><option>inspecao</option></select></div>
                <div><span class="mf-label">GATILHO *</span><select id="mf-pl-gat" class="mf-input"><option value="contador">contador (produção)</option><option value="calendario">calendário</option></select></div>
                <div><span class="mf-label">A CADA *</span><input id="mf-pl-int" type="number" min="0" class="mf-input" placeholder="5000"></div>
                <div><span class="mf-label">UNIDADE *</span><select id="mf-pl-un" class="mf-input"><option>kg</option><option>dias</option><option>horas</option><option>ciclos</option></select></div>
            </div>
            <button class="btn primary" onclick="mf.salvarPlano()">Salvar plano</button>
            <div style="overflow-x:auto;margin-top:12px;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">
            <thead><tr style="color:var(--text-dim);font-size:.64rem;border-bottom:1px solid var(--border-color);"><th style="padding:6px 8px;text-align:left;">NOME</th><th style="padding:6px 8px;text-align:left;">MÁQUINA</th><th style="padding:6px 8px;text-align:left;">TIPO</th><th style="padding:6px 8px;text-align:right;">INTERVALO</th></tr></thead>
            <tbody>${lin(planos, p => `<td style="padding:6px 8px;">${esc(p.nome)}</td><td style="padding:6px 8px;color:var(--indigo-primary);">${esc(p.maquina?.codigo||'')}</td><td style="padding:6px 8px;color:var(--text-dim);">${esc(p.tipo)}</td><td style="padding:6px 8px;text-align:right;">${Number(p.intervalo_valor).toLocaleString('pt-BR')} ${esc(p.intervalo_unidade)}</td>`)}</tbody></table></div>
        </div>`;
    },
    async salvarPeca() {
        const r = await api.post('/api/mf/pecas', { codigo: $('mf-pc-cod').value.trim(), nome: $('mf-pc-nome').value.trim(), categoria: $('mf-pc-cat').value || null,
            unidade: $('mf-pc-un').value, estoque_atual: parseFloat($('mf-pc-est').value)||0, estoque_minimo: parseFloat($('mf-pc-min').value)||0 });
        toast(r?.ok ? 'Peça salva.' : 'Erro: ' + (r?.erro||''), r?.ok?'ok':'erro'); if (r?.ok) this.renderCadTpm();
    },
    async salvarComponente() {
        const r = await api.post('/api/mf/componentes', { maquina_id: $('mf-cp-maq').value, codigo: $('mf-cp-cod').value.trim(), nome: $('mf-cp-nome').value.trim(),
            tipo: $('mf-cp-tipo').value, vida_util_valor: parseFloat($('mf-cp-vida').value)||null, vida_util_unidade: $('mf-cp-vun').value || null });
        toast(r?.ok ? 'Componente salvo.' : 'Erro: ' + (r?.erro||''), r?.ok?'ok':'erro'); if (r?.ok) this.renderCadTpm();
    },
    async salvarPlano() {
        const r = await api.post('/api/mf/planos', { maquina_id: $('mf-pl-maq').value, nome: $('mf-pl-nome').value.trim(), tipo: $('mf-pl-tipo').value,
            gatilho: $('mf-pl-gat').value, intervalo_valor: parseFloat($('mf-pl-int').value)||0, intervalo_unidade: $('mf-pl-un').value });
        toast(r?.ok ? 'Plano salvo.' : 'Erro: ' + (r?.erro||''), r?.ok?'ok':'erro'); if (r?.ok) this.renderCadTpm();
    },

    // ═══ CHECKLIST CIL (Limpeza, Inspeção, Lubrificação) ═══════════════════════
    _cilItens: [],
    async renderCil() {
        const pan = $('mf-pan-cil');
        const cls = await api.get('/api/mf/checklists') || [];
        this._checklists = cls;
        const maqOpt = this._cad.maquinas.map(m => `<option value="${m.id}">${esc(m.codigo)}</option>`).join('');
        pan.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:10px;">✅ NOVO CHECKLIST CIL</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:10px;">
                <div><span class="mf-label">NOME *</span><input id="mf-cl-nome" class="mf-input" placeholder="CIL início de turno"></div>
                <div><span class="mf-label">FREQUÊNCIA *</span><select id="mf-cl-freq" class="mf-input"><option>turno</option><option>diaria</option><option>semanal</option></select></div>
                <div><span class="mf-label">MÁQUINA (opc.)</span><select id="mf-cl-maq" class="mf-input"><option value="">todas</option>${maqOpt}</select></div>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <input id="mf-cl-itxt" class="mf-input" placeholder="descrição do item (ex: limpar fiapos do cilindro)" style="flex:1;">
                <select id="mf-cl-itipo" class="mf-input" style="width:130px;"><option>limpeza</option><option>inspecao</option><option>lubrificacao</option></select>
                <button class="btn secondary" onclick="mf._addCilItem()">+ item</button>
            </div>
            <div id="mf-cl-itens" style="margin-bottom:10px;"></div>
            <button class="btn primary" onclick="mf.salvarChecklist()">Criar checklist</button>
        </div>
        <div id="mf-cl-lista">${cls.length ? `<div class="s-label" style="margin:6px 0 12px;">CHECKLISTS (${cls.length})</div>` + cls.map(c => `
            <div class="summary-card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <div><span style="font-weight:600;">${esc(c.nome)}</span> <span style="font-size:.72rem;color:var(--text-dim);">· ${c.frequencia} · ${(c.checklist_item||[]).length} itens</span></div>
                <button class="btn primary" style="font-size:.76rem;" onclick="mf.executarCil('${c.id}')">▶ Executar</button>
            </div>`).join('') : `<div class="summary-card" style="text-align:center;padding:24px;color:var(--text-dim);">Nenhum checklist criado.</div>`}</div>`;
        this._cilItens = []; this._renderCilItens();
    },
    _addCilItem() {
        const txt = $('mf-cl-itxt').value.trim(); if (!txt) return;
        this._cilItens.push({ descricao: txt, tipo: $('mf-cl-itipo').value });
        $('mf-cl-itxt').value = ''; this._renderCilItens();
    },
    _renderCilItens() {
        const w = $('mf-cl-itens'); if (!w) return;
        w.innerHTML = this._cilItens.map((it, i) => `<div style="display:flex;justify-content:space-between;padding:5px 10px;background:var(--bg-input);border-radius:6px;margin-bottom:4px;font-size:.8rem;">
            <span>${i+1}. ${esc(it.descricao)} <span style="color:var(--text-dim);">· ${it.tipo}</span></span>
            <span style="cursor:pointer;color:#f06292;" onclick="mf._cilItens.splice(${i},1);mf._renderCilItens()">✕</span></div>`).join('');
    },
    async salvarChecklist() {
        const nome = $('mf-cl-nome').value.trim();
        if (!nome || !this._cilItens.length) return toast('Informe nome e ao menos 1 item.', 'erro');
        const r = await api.post('/api/mf/checklists', { nome, frequencia: $('mf-cl-freq').value, maquina_id: $('mf-cl-maq').value || null, itens: this._cilItens });
        if (!r?.ok) return toast('Erro: ' + (r?.erro||''), 'erro');
        toast('Checklist criado.'); this.renderCil();
    },
    executarCil(clId) {
        const cl = (this._checklists || []).find(c => c.id === clId); if (!cl) return;
        const maqOpt = this._cad.maquinas.map(m => `<option value="${m.id}">${esc(m.codigo)}</option>`).join('');
        const operOpt = this._cad.operadores.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('');
        const turnoOpt = this._cad.turnos.map(t => `<option value="${t.id}">${esc(t.codigo)}</option>`).join('');
        const itens = (cl.checklist_item || []).map(it => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);">
            <span style="font-size:.82rem;">${esc(it.descricao)} <span style="color:var(--text-dim);font-size:.7rem;">${it.tipo}</span></span>
            <select class="mf-input mf-cil-res" data-item="${it.id}" style="width:120px;"><option value="">—</option><option value="ok">OK</option><option value="nao_ok">NÃO OK</option><option value="nao_aplicavel">N/A</option></select>
        </div>`).join('');
        this._modal(`
            <div class="s-label" style="margin-bottom:12px;">✅ EXECUTAR — ${esc(cl.nome)}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
                <div><span class="mf-label">MÁQUINA</span><select id="mf-ce-maq" class="mf-input">${maqOpt}</select></div>
                <div><span class="mf-label">OPERADOR</span><select id="mf-ce-oper" class="mf-input">${operOpt}</select></div>
                <div><span class="mf-label">TURNO</span><select id="mf-ce-turno" class="mf-input">${turnoOpt}</select></div>
            </div>
            <div style="max-height:40vh;overflow-y:auto;margin-bottom:14px;">${itens}</div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="mf.salvarExecCil('${cl.id}')">Salvar execução</button>
            </div>`);
    },
    async salvarExecCil(clId) {
        const resultados = [...document.querySelectorAll('.mf-cil-res')].map(s => ({ item_id: s.dataset.item, resultado: s.value }));
        const r = await api.post('/api/mf/checklist-execucao', { checklist_id: clId, maquina_id: $('mf-ce-maq').value, operador_id: $('mf-ce-oper').value, turno_id: $('mf-ce-turno').value, resultados });
        if (!r?.ok) return toast('Erro: ' + (r?.erro||''), 'erro');
        this._fecharModal(); toast(`Execução salva (${r.status}).`);
    },

    // ═══ RASTREABILIDADE por código da peça ════════════════════════════════════
    _rcard(cor, val, lbl) { return `<div style="background:${cor}14;border:1px solid ${cor}3a;border-radius:12px;padding:14px 18px;flex:1;min-width:130px;text-align:center;"><div style="font-size:1.5rem;font-weight:800;color:${cor};">${val}</div><div style="font-size:.62rem;color:${cor};letter-spacing:.04em;">${lbl}</div></div>`; },
    renderRastreio() {
        $('mf-pan-rastreio').innerHTML = `
            <div class="summary-card" style="margin-bottom:16px;">
                <div class="s-label" style="margin-bottom:10px;">🔎 RASTREABILIDADE POR CÓDIGO DA PEÇA</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                    <input id="mf-rastreio-cod" placeholder="Digite o código (ex: 12303)" onkeydown="if(event.key==='Enter')mf.buscarRastreio()"
                        style="flex:1;min-width:200px;padding:9px 12px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);font-size:.9rem;">
                    <button class="btn primary" onclick="mf.buscarRastreio()">Buscar histórico</button>
                </div>
                <div style="font-size:.74rem;color:var(--text-dim);margin-top:8px;">Traz tudo o que o código passou: produto, ordens de produção, apontamentos (máquina/operador/etapa), não conformidades, paradas e fio consumido.</div>
            </div>
            <div id="mf-rastreio-res"></div>`;
        setTimeout(() => $('mf-rastreio-cod')?.focus(), 50);
    },
    async buscarRastreio() {
        const cod = ($('mf-rastreio-cod')?.value || '').trim();
        if (!cod) return toast('Digite um código.', 'erro');
        const res = $('mf-rastreio-res');
        res.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Buscando ${esc(cod)}...</div>`;
        const d = await api.get('/api/mf/rastreio/' + encodeURIComponent(cod));
        if (!d) { res.innerHTML = `<div class="summary-card" style="color:#f06292;">Erro na busca.</div>`; return; }
        if (!d.encontrado) { res.innerHTML = `<div class="summary-card" style="color:#ffca28;">Código <strong>${esc(cod)}</strong> não encontrado (nem como produto nem como nº de OP).</div>`; return; }
        const p = d.produto, brl = n => Number(n || 0).toLocaleString('pt-BR');
        const dt = s => s ? new Date(s).toLocaleDateString('pt-BR') : '—', dth = s => s ? new Date(s).toLocaleString('pt-BR') : '—';
        const grp = (arr, k) => arr.reduce((m, x) => ((m[x[k]] = m[x[k]] || []).push(x), m), {});
        const ncByAp = grp(d.ncs, 'apontamento_id'), parByAp = grp(d.paradas, 'apontamento_id'), conByAp = grp(d.consumo, 'apontamento_id'), apByOp = grp(d.aps, 'op_id');
        const totalBoa = d.aps.reduce((s, a) => s + Number(a.qtd_boa || 0), 0);
        let html = `
            <div class="summary-card" style="margin-bottom:14px;">
                <div style="font-size:1.1rem;font-weight:700;">${esc(p.codigo)} — ${esc(p.descricao)}</div>
                <div style="font-size:.8rem;color:var(--text-dim);margin-top:4px;">${[p.cor, p.marca, p.tamanho].filter(Boolean).map(esc).join(' · ') || 'sem atributos'} · unidade ${esc(p.unidade_medida || '')}${p.custo_unitario ? ` · custo R$ ${brl(p.custo_unitario)}` : ''}${d.viaOp ? ` · <span style="color:#26c6da;">via OP ${esc(d.viaOp)}</span>` : ''}</div>
            </div>
            <div id="mf-rastreio-rot" data-cod="${esc(p.codigo)}" class="summary-card" style="margin-bottom:14px;"><span style="color:var(--text-dim);font-size:.8rem;">carregando roteiro...</span></div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
                ${this._rcard('#26c6da', d.ops.length, 'ORDENS DE PRODUÇÃO')}
                ${this._rcard('#26a69a', d.aps.length, 'APONTAMENTOS')}
                ${this._rcard('#66bb6a', brl(totalBoa) + ' ' + esc(p.unidade_medida || ''), 'PRODUZIDO (BOA)')}
                ${this._rcard(d.ncs.length ? '#f06292' : '#8b949e', d.ncs.length, 'NÃO CONFORMIDADES')}
            </div>`;
        if (!d.ops.length) html += `<div class="summary-card" style="color:var(--text-dim);">Nenhuma OP para este código ainda.</div>`;
        html += d.ops.map(o => {
            const stCor = this._filaStatusCor(o.status);
            const sessoes = (apByOp[o.id] || []).map(a => {
                const ncs = ncByAp[a.id] || [], par = parByAp[a.id] || [], con = conByAp[a.id] || [];
                return `<div style="padding:8px 10px;border-top:1px solid rgba(255,255,255,.05);font-size:.8rem;">
                    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                        <span>${a.etapa ? `<strong style="color:#26c6da;">${a.etapa.ordem}. ${esc(a.etapa.nome)}</strong> · ` : ''}${esc(a.maquina?.codigo || '')} · ${esc(a.operador?.nome || '')} · turno ${esc(a.turno?.codigo || '')}</span>
                        <span style="color:var(--text-dim);">${dth(a.datahora_inicio)}${a.datahora_fim ? ' → ' + new Date(a.datahora_fim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ' (aberta)'}</span>
                    </div>
                    <div style="margin-top:3px;color:var(--text-dim);">boa ${brl(a.qtd_boa)} · refugo ${brl(a.qtd_refugo)} · retrab ${brl(a.qtd_retrabalho)}${con.length ? ` · fio: ${con.map(c => esc(c.lote?.codigo || '') + ' ' + brl(c.qtd_consumida_kg) + 'kg').join(', ')}` : ''}</div>
                    ${ncs.map(n => `<div style="margin-top:3px;color:#f06292;">⚠ NC: ${esc(n.defeito?.descricao || '?')} (sev ${n.severidade_aplicada}) · ${brl(n.qtd_afetada)} · ${esc(n.disposicao)} · ${dt(n.datahora)}</div>`).join('')}
                    ${par.map(x => `<div style="margin-top:3px;color:#ffca28;">⏸ parada: ${esc(x.motivo?.descricao || '?')} (${dth(x.datahora_inicio)})</div>`).join('')}
                </div>`;
            }).join('') || `<div style="padding:8px 10px;color:var(--text-dim);font-size:.78rem;">Sem apontamentos nesta OP.</div>`;
            return `<div class="summary-card" style="margin-bottom:12px;padding:0;overflow:hidden;">
                <div style="padding:10px 12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center;background:rgba(255,255,255,.02);">
                    <span><strong>OP ${esc(o.numero)}</strong> <span style="color:var(--text-dim);font-size:.8rem;">· ${brl(o.qtd_planejada)} ${esc(o.unidade || '')} · ${o.etapa ? `fluxo: ${o.etapa.ordem}. ${esc(o.etapa.nome)}` : 'fora do fluxo'}</span></span>
                    <span style="font-size:.68rem;color:${stCor};border:1px solid ${stCor}55;border-radius:4px;padding:1px 7px;">${esc(o.status)}</span>
                </div>${sessoes}</div>`;
        }).join('');
        res.innerHTML = html;
        this._carregarRoteiro(p.codigo);  // preenche o editor de roteiro
    },
    async _carregarRoteiro(codigo) {
        const el = $('mf-rastreio-rot'); if (!el) return;
        const r = await api.get('/api/mf/produto/' + encodeURIComponent(codigo) + '/roteiro');
        if (!r || !Array.isArray(r.etapas)) { el.innerHTML = `<span style="color:var(--text-dim);font-size:.8rem;">Roteiro indisponível${r?.erro ? ' — ' + esc(r.erro) : ''}.</span>`; return; }
        const chips = r.etapas.map(e => `<label style="display:inline-flex;align-items:center;gap:5px;font-size:.8rem;padding:4px 8px;border:1px solid ${e.no_roteiro ? '#26a69a55' : 'var(--border-color)'};border-radius:7px;cursor:pointer;background:${e.no_roteiro ? 'rgba(38,166,154,.08)' : 'transparent'};">
            <input type="checkbox" data-eid="${e.id}" ${e.no_roteiro ? 'checked' : ''} onchange="mf.salvarRoteiro('${esc(codigo)}')"> ${e.ordem}. ${esc(e.nome)}</label>`).join(' ');
        el.innerHTML = `<div class="s-label" style="margin-bottom:8px;">🔀 ROTEIRO — etapas que este produto usa ${r.padrao ? '<span style="color:var(--text-dim);font-size:.7rem;font-weight:400;">(padrão: todas)</span>' : ''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">${chips}</div>
            <div style="font-size:.72rem;color:var(--text-dim);margin-top:8px;">Desmarque as etapas que este produto NÃO passa (ex.: pula Silicone). O fluxo e a capacidade respeitam isso. Todas marcadas = padrão.</div>`;
    },
    async salvarRoteiro(codigo) {
        const ids = [...document.querySelectorAll('#mf-rastreio-rot input[type=checkbox]:checked')].map(c => c.dataset.eid);
        const r = await api.put('/api/mf/produto/' + encodeURIComponent(codigo) + '/roteiro', { etapa_ids: ids });
        if (!r?.ok) return toast(r?.erro || 'Erro ao salvar roteiro.', 'erro');
        toast(r.padrao ? 'Roteiro = padrão (todas as etapas).' : 'Roteiro salvo.', 'ok');
        this._carregarRoteiro(codigo);
    },

    // ═══ RASTREABILIDADE (fase 4) ══════════════════════════════════════════════
    async renderFio() {
        const pan = $('mf-pan-fio');
        const abertas = await api.get('/api/mf/apontamentos?abertas=1') || [];
        const lotes = await api.get('/api/mf/lotes-fio');
        if (lotes === null) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">Rastreabilidade indisponível — rode <b>mes_rastreabilidade.sql</b>.</div>`; return; }
        const aptOpt = abertas.map(a => `<option value="${a.id}">${esc(a.op?.numero||'OP')} · ${esc(a.maquina?.codigo||'')}</option>`).join('') || '<option value="">(nenhuma sessão aberta)</option>';
        const loteOpt = lotes.map(l => `<option value="${l.id}">${esc(l.codigo)} (${Number(l.qtd_disponivel_kg).toLocaleString('pt-BR')} kg disp.)</option>`).join('');
        const lista = lotes.length ? lotes.map(l => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
            <td style="padding:7px 10px;font-weight:600;color:var(--indigo-primary);">${esc(l.codigo)}</td>
            <td style="padding:7px 10px;">${esc(l.fornecedor||'—')}</td>
            <td style="padding:7px 10px;color:var(--text-dim);">${esc(l.composicao||'')} ${esc(l.titulo_fio||'')} ${esc(l.cor||'')}</td>
            <td style="padding:7px 10px;text-align:right;">${Number(l.qtd_recebida_kg).toLocaleString('pt-BR')}</td>
            <td style="padding:7px 10px;text-align:right;color:${l.qtd_disponivel_kg<l.qtd_recebida_kg*0.1?'#ffca28':'var(--text-primary)'};">${Number(l.qtd_disponivel_kg).toLocaleString('pt-BR')}</td></tr>`).join('')
            : `<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--text-dim);">Nenhum lote de fio recebido.</td></tr>`;
        pan.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:12px;">🧵 RECEBER LOTE DE FIO</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:10px;">
                <div><span class="mf-label">CÓDIGO DO LOTE *</span><input id="mf-lf-cod" class="mf-input" placeholder="ex: FIO-2026-014"></div>
                <div><span class="mf-label">FORNECEDOR</span><input id="mf-lf-forn" class="mf-input"></div>
                <div><span class="mf-label">COMPOSIÇÃO</span><input id="mf-lf-comp" class="mf-input" placeholder="PV 67/33"></div>
                <div><span class="mf-label">TÍTULO</span><input id="mf-lf-tit" class="mf-input" placeholder="30/1"></div>
                <div><span class="mf-label">COR</span><input id="mf-lf-cor" class="mf-input"></div>
                <div><span class="mf-label">QTD (kg)</span><input id="mf-lf-qtd" type="number" min="0" step="0.001" class="mf-input" value="0"></div>
            </div>
            <button class="btn primary" onclick="mf.receberLote()">Receber lote</button>
        </div>
        <div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:12px;">🔗 VINCULAR FIO A UMA SESSÃO ABERTA</div>
            <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;">
                <div><span class="mf-label">SESSÃO (OP)</span><select id="mf-cf-apt" class="mf-input">${aptOpt}</select></div>
                <div><span class="mf-label">LOTE DE FIO</span><select id="mf-cf-lote" class="mf-input">${loteOpt}</select></div>
                <div><span class="mf-label">QTD (kg)</span><input id="mf-cf-qtd" type="number" min="0" step="0.001" class="mf-input" style="width:110px;" value="0"></div>
            </div>
            <button class="btn secondary" style="margin-top:10px;" onclick="mf.vincularFio()">Registrar consumo</button>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;">
            <div class="s-label" style="padding:14px 16px 10px;">LOTES DE FIO</div>
            <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.66rem;">
                <th style="padding:8px 10px;text-align:left;">LOTE</th><th style="padding:8px 10px;text-align:left;">FORNECEDOR</th><th style="padding:8px 10px;text-align:left;">FIO</th>
                <th style="padding:8px 10px;text-align:right;">RECEBIDO (kg)</th><th style="padding:8px 10px;text-align:right;">DISPONÍVEL (kg)</th>
            </tr></thead><tbody>${lista}</tbody></table>
        </div>`;
    },
    async receberLote() {
        const cod = $('mf-lf-cod').value.trim();
        if (!cod) return toast('Informe o código do lote.', 'erro');
        const r = await api.post('/api/mf/lotes-fio', { codigo: cod, fornecedor: $('mf-lf-forn').value || null, composicao: $('mf-lf-comp').value || null,
            titulo_fio: $('mf-lf-tit').value || null, cor: $('mf-lf-cor').value || null, qtd_recebida_kg: parseFloat($('mf-lf-qtd').value) || 0 });
        if (!r?.ok) return toast('Erro: ' + (r?.erro || ''), 'erro');
        toast('Lote recebido.'); this.renderFio();
    },
    async vincularFio() {
        const apt = $('mf-cf-apt').value, lote = $('mf-cf-lote').value, qtd = parseFloat($('mf-cf-qtd').value);
        if (!apt || !lote || !(qtd > 0)) return toast('Selecione sessão, lote e quantidade.', 'erro');
        const r = await api.post('/api/mf/consumo-fio', { apontamento_id: apt, lote_fio_id: lote, qtd_consumida_kg: qtd });
        if (!r?.ok) return toast('Erro: ' + (r?.erro || ''), 'erro');
        toast('Consumo de fio registrado.'); this.renderFio();
    },

    async renderGenealogia() {
        const pan = $('mf-pan-gene');
        const lotes = await api.get('/api/mf/lotes-fio');
        if (lotes === null) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">Rastreabilidade indisponível — rode <b>mes_rastreabilidade.sql</b>.</div>`; return; }
        const opt = lotes.map(l => `<option value="${l.id}">${esc(l.codigo)} — ${esc(l.fornecedor||'')}</option>`).join('') || '<option value="">(receba lotes primeiro)</option>';
        pan.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:8px;">🔎 RECALL — ONDE ESTE LOTE DE FIO FOI USADO</div>
            <p style="font-size:.78rem;color:var(--text-dim);margin-bottom:12px;">Se um lote de fio veio com problema, selecione-o para ver TODA a produção e os defeitos que ele gerou — do fio à peça.</p>
            <div style="display:flex;gap:10px;align-items:end;">
                <div style="flex:1;max-width:360px;"><span class="mf-label">LOTE DE FIO</span><select id="mf-gene-lote" class="mf-input">${opt}</select></div>
                <button class="btn primary" onclick="mf.rastrear()">Rastrear</button>
            </div>
        </div>
        <div id="mf-gene-result"></div>`;
    },
    async rastrear() {
        const lote = $('mf-gene-lote').value; if (!lote) return;
        const rows = await api.get('/api/mf/genealogia?lote_fio_id=' + lote) || [];
        const wrap = $('mf-gene-result');
        if (!rows.length) { wrap.innerHTML = `<div class="summary-card" style="text-align:center;padding:24px;color:var(--text-dim);">Este lote ainda não foi consumido em nenhuma sessão.</div>`; return; }
        const totalNc = rows.reduce((s, r) => s + (r.ncs_na_sessao || 0), 0);
        const totalKg = rows.reduce((s, r) => s + Number(r.qtd_consumida_kg || 0), 0);
        wrap.innerHTML = `
            <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
                <div style="background:rgba(38,198,218,.12);border:1px solid rgba(38,198,218,.4);border-radius:8px;padding:12px 20px;text-align:center;"><div style="font-size:1.4rem;font-weight:800;color:#26c6da;">${rows.length}</div><div style="font-size:.66rem;color:#26c6da;">SESSÕES / OPs</div></div>
                <div style="background:rgba(124,77,255,.12);border:1px solid rgba(124,77,255,.4);border-radius:8px;padding:12px 20px;text-align:center;"><div style="font-size:1.4rem;font-weight:800;color:#7c4dff;">${totalKg.toLocaleString('pt-BR')}</div><div style="font-size:.66rem;color:#7c4dff;">KG CONSUMIDOS</div></div>
                <div style="background:rgba(240,98,146,.12);border:1px solid rgba(240,98,146,.4);border-radius:8px;padding:12px 20px;text-align:center;"><div style="font-size:1.4rem;font-weight:800;color:#f06292;">${totalNc}</div><div style="font-size:.66rem;color:#f06292;">NCs GERADAS</div></div>
            </div>
            <div class="summary-card" style="padding:0;overflow:hidden;">
            <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.66rem;">
                <th style="padding:8px 10px;text-align:left;">OP</th><th style="padding:8px 10px;text-align:left;">PRODUTO</th><th style="padding:8px 10px;text-align:left;">MÁQUINA</th>
                <th style="padding:8px 10px;text-align:left;">DATA</th><th style="padding:8px 10px;text-align:right;">FIO (kg)</th><th style="padding:8px 10px;text-align:right;">NCs</th>
            </tr></thead><tbody>${rows.map(r => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:7px 10px;font-weight:600;color:var(--indigo-primary);">${esc(r.op_numero)}</td>
                <td style="padding:7px 10px;">${esc(r.produto_codigo)} · ${esc((r.produto_descricao||'').slice(0,24))}</td>
                <td style="padding:7px 10px;">${esc(r.maquina_codigo)}</td>
                <td style="padding:7px 10px;color:var(--text-dim);">${new Date(r.datahora_inicio).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                <td style="padding:7px 10px;text-align:right;">${Number(r.qtd_consumida_kg).toLocaleString('pt-BR')}</td>
                <td style="padding:7px 10px;text-align:right;color:${r.ncs_na_sessao?'#f06292':'var(--text-dim)'};font-weight:${r.ncs_na_sessao?'700':'400'};">${r.ncs_na_sessao}</td>
            </tr>`).join('')}</tbody></table></div>`;
    },

    // ═══ PAINEL EXECUTIVO (cockpit) ════════════════════════════════════════════
    _usuarioNome() {
        try { const p = JSON.parse(atob((localStorage.getItem(TOKEN_KEY) || '').split('.')[1])); return (p.nome || '').split(' ')[0] || 'Operador'; } catch { return 'Operador'; }
    },
    async renderPainel() {
        const pan = $('mf-pan-painel');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando painel...</div>`;
        const [kpi, al, etapas, wip, carteira, produtos, andon, aps] = await Promise.all([
            api.get('/api/mf/painel'), api.get('/api/mf/alertas'), api.get('/api/mf/etapas-processo'), api.get('/api/mf/wip'),
            api.get('/api/op-unificado'), api.get('/api/mf/produtos'), api.get('/api/mf/andon'), api.get('/api/mf/apontamentos'),
        ]);
        const wipMap = {}; if (wip?.board) wip.board.forEach(b => { wipMap[b.etapa_id] = b; });
        if (!kpi) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">Painel indisponível — rode os SQLs pendentes (mes_metas.sql).</div>`; return; }
        const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const nCarteira = Array.isArray(carteira) ? carteira.length : 0;
        const nProdutos = Array.isArray(produtos) ? produtos.length : 0;
        const wipOps = wip?.board ? wip.board.reduce((s, b) => s + (b.ops || 0), 0) : 0;
        const andonAb = (Array.isArray(andon) ? andon : []).filter(a => a.status && a.status !== 'resolvido').length;

        const kc = (cor, val, lbl, sub, aba) => `<div onclick="${aba ? `mf.tab('${aba}')` : ''}" class="summary-card" style="flex:1;min-width:140px;border-top:3px solid ${cor};padding:14px 16px;${aba ? 'cursor:pointer;' : ''}">
            <div style="font-size:.64rem;color:var(--text-dim);letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px;">${lbl}</div>
            <div style="font-size:1.7rem;font-weight:800;color:${cor};line-height:1.05;">${val}</div>
            <div style="font-size:.7rem;color:var(--text-dim);margin-top:3px;">${sub}</div></div>`;
        const flow = (icon, tit, sub, ativo, aba) => `<div onclick="${aba ? `mf.tab('${aba}')` : ''}" style="flex:1;min-width:108px;text-align:center;padding:14px 8px;border:1px solid var(--border-color);border-radius:10px;position:relative;${aba ? 'cursor:pointer;' : ''}">
            <div style="position:absolute;top:8px;right:10px;width:7px;height:7px;border-radius:50%;background:${ativo ? '#3fb950' : '#30363d'};box-shadow:${ativo ? '0 0 5px rgba(63,185,80,.5)' : 'none'};"></div>
            <div style="font-size:1.1rem;margin-bottom:4px;">${icon}</div><div style="font-size:.76rem;font-weight:700;">${tit}</div>
            <div style="font-size:.64rem;color:var(--text-dim);margin-top:2px;">${sub}</div></div>`;
        const quick = (icon, lbl, aba) => `<button onclick="mf.tab('${aba}')" class="btn secondary" style="flex:1;min-width:130px;justify-content:center;gap:8px;font-size:.8rem;padding:12px;">${icon} ${lbl}</button>`;

        const ativHtml = (Array.isArray(aps) ? aps : []).slice(0, 6).map(a => {
            const min = Math.max(0, Math.round((Date.now() - new Date(a.datahora_inicio).getTime()) / 60000));
            return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.82rem;">
                <span style="color:${a.datahora_fim ? '#26a69a' : '#26c6da'};">${a.datahora_fim ? '✓' : '▶'}</span>
                <span>Sessão <strong>${esc(a.op?.numero || 'OP')}</strong> · ${esc(a.maquina?.codigo || '')} · ${esc(a.operador?.nome || '')}</span>
                <span style="margin-left:auto;color:var(--text-dim);font-size:.72rem;white-space:nowrap;">${a.datahora_fim ? 'finalizada' : 'em curso'} · há ${min}min</span></div>`;
        }).join('') || `<div style="color:var(--text-dim);padding:16px 0;">Nenhuma atividade ainda. As sessões de apontamento aparecem aqui.</div>`;

        const corSev = { alta: '#f06292', media: '#ffca28', baixa: '#8b949e' };
        const alertas = (al?.alertas || []);
        const alertasHtml = alertas.length ? alertas.map(a => `<div onclick="mf.tab('${a.aba}')" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;background:${corSev[a.sev]}12;border-left:3px solid ${corSev[a.sev]};margin-bottom:6px;cursor:pointer;">
            <span style="font-size:.62rem;font-weight:700;color:${corSev[a.sev]};border:1px solid ${corSev[a.sev]}55;border-radius:4px;padding:1px 6px;">${a.modulo}</span>
            <span style="font-size:.82rem;">${esc(a.msg)}</span></div>`).join('')
            : `<div style="text-align:center;padding:20px;color:#26a69a;">✓ Nenhum alerta — tudo dentro das metas.</div>`;

        pan.innerHTML = `
            <div style="margin-bottom:18px;">
                <h2 style="font-size:1.5rem;font-weight:800;margin:0;">${this._saud()}, <span style="color:var(--indigo-primary);">${esc(this._usuarioNome())}</span></h2>
                <p style="color:var(--text-dim);font-size:.85rem;margin:2px 0 0;">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} · MES Malha Forte</p>
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
                ${kc('#26c6da', nCarteira.toLocaleString('pt-BR'), 'Carteira (OPs)', 'ordens ativas', 'fila')}
                ${kc('#7c4dff', nProdutos.toLocaleString('pt-BR'), 'Produtos', 'catalogados', 'rastreio')}
                ${kc('#26a69a', wipOps, 'WIP ativo', 'OPs no fluxo', 'wip')}
                ${kc('#ffab76', kpi.sessoes_abertas, 'Sessões ativas', 'apontando agora', 'apont')}
                ${kc(andonAb ? '#f06292' : '#3fb950', andonAb, 'Andon aberto', 'chamados', 'andon')}
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;">
                ${kc('#26c6da', kpi.oee_medio != null ? kpi.oee_medio + '%' : '—', 'OEE médio', kpi.oee_medio != null ? 'execução' : 'aguardando apontamento', 'ind')}
                ${kc('#f06292', brl(kpi.cnq_total), 'Custo qualidade', 'CNQ', 'cnq')}
                ${kc('#7c4dff', kpi.ncs, 'Não conformidades', 'registradas', 'ncs')}
                ${kc(kpi.rncs_atrasadas ? '#ff5252' : '#ffca28', kpi.rncs_abertas + (kpi.rncs_atrasadas ? ` (${kpi.rncs_atrasadas}⚠)` : ''), 'RNCs abertas', 'ações corretivas', 'rnc')}
                ${kc('#ef6c00', kpi.etiquetas_abertas, 'Etiquetas', 'anomalias TPM', 'etiq')}
            </div>
            <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:18px;">
                <div class="summary-card"><div class="s-label" style="margin-bottom:8px;">📋 ÚLTIMAS ATIVIDADES</div>${ativHtml}</div>
                <div class="summary-card"><div class="s-label" style="margin-bottom:8px;">⚠ ALERTAS ${alertas.length ? `(${alertas.length})` : ''}</div>${alertasHtml}</div>
            </div>
            <div class="summary-card" style="margin-bottom:18px;">
                <div class="s-label" style="margin-bottom:12px;">🔀 FLUXO DO SISTEMA — estado atual</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;">
                    ${flow('🗂', 'Cadastros', nProdutos + ' produtos', nProdutos > 0, 'rastreio')}
                    ${flow('📥', 'Carteira', nCarteira + ' OPs', nCarteira > 0, 'fila')}
                    ${flow('📊', 'Fila/WIP', wipOps + ' no fluxo', wipOps > 0, 'wip')}
                    ${flow('🛠', 'Apontamento', kpi.sessoes_abertas + ' ativas', kpi.sessoes_abertas > 0, 'apont')}
                    ${flow('⚠', 'Qualidade', kpi.ncs + ' NCs', kpi.ncs > 0, 'ncs')}
                    ${flow('📈', 'Indicadores', kpi.oee_medio != null ? 'OEE ' + kpi.oee_medio + '%' : 'sem dados', kpi.oee_medio != null, 'ind')}
                </div>
            </div>
            <div class="summary-card" style="margin-bottom:18px;">
                <div class="s-label" style="margin-bottom:12px;">⚡ ACESSO RÁPIDO</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${quick('🛠', 'Apontamento', 'apont')}${quick('📋', 'Fila de OPs', 'fila')}${quick('🆘', 'Andon', 'andon')}
                    ${quick('📊', 'Kanban WIP', 'wip')}${quick('⏱', 'Cronoanálise', 'crono')}${quick('📥', 'Importar OPs', 'impops')}
                </div>
            </div>
            ${this._fluxoHTML(etapas, wipMap)}`;
    },
    _saud() { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; },

    // ═══ BPM — FLUXO DO PROCESSO (editável) ════════════════════════════════════
    _etBtn: 'background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.62rem;padding:0 2px;line-height:1;',
    _fluxoHTML(etapas, wipMap) {
        if (!Array.isArray(etapas)) return `<div class="summary-card" style="margin-bottom:18px;">
            <div class="s-label" style="margin-bottom:8px;">🔀 FLUXO DO PROCESSO</div>
            <div style="color:#ffca28;">Fluxo não inicializado — rode <strong>mes_fluxo.sql</strong> no Supabase e recarregue.</div></div>`;
        const n = etapas.length;
        const boxes = etapas.map((e, i) => {
            const w = (wipMap || {})[e.id];
            const cor = w?.gargalo ? '#f06292' : (e.cor || '#26c6da');
            const seta = i < n - 1 ? `<div style="display:flex;align-items:center;color:var(--text-dim);font-size:1.25rem;padding:0 1px;">→</div>` : '';
            const wipBadge = w ? `<div onclick="mf.tab('wip')" title="Abrir Kanban WIP" style="cursor:pointer;font-size:.6rem;text-align:center;margin-top:4px;color:${w.gargalo ? '#f06292' : 'var(--text-dim)'};">
                WIP ${w.ops}${w.qtd_wip ? ` · ${Number(w.qtd_wip).toLocaleString('pt-BR')}` : ''}${w.gargalo ? ' ⚠' : ''}</div>` : '';
            return `<div style="display:flex;align-items:center;">
                <div style="background:${cor}14;border:1px solid ${cor}55;border-radius:10px;padding:8px 10px 10px;min-width:120px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">
                        <span style="font-size:.6rem;font-weight:700;color:${cor};background:${cor}22;border-radius:4px;padding:1px 5px;">${i + 1}</span>
                        <span style="display:flex;gap:2px;">
                            ${i > 0 ? `<button title="Mover para a esquerda" onclick="mf.moverEtapa('${e.id}',-1)" style="${this._etBtn}">◀</button>` : ''}
                            ${i < n - 1 ? `<button title="Mover para a direita" onclick="mf.moverEtapa('${e.id}',1)" style="${this._etBtn}">▶</button>` : ''}
                            <button title="Remover etapa" onclick="mf.removerEtapa('${e.id}')" style="${this._etBtn}color:#f06292;">✕</button>
                        </span>
                    </div>
                    <input value="${esc(e.nome)}" onchange="mf.renomearEtapa('${e.id}', this.value)" title="Clique para renomear"
                        style="width:100%;background:transparent;border:none;border-bottom:1px solid ${cor}33;color:var(--text-primary);font-size:.82rem;font-weight:600;padding:2px 0;text-align:center;">
                    ${wipBadge}
                </div>${seta}</div>`;
        }).join('');
        return `<div class="summary-card" style="margin-bottom:18px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
                <div class="s-label">🔀 FLUXO DO PROCESSO ${n ? `(${n} etapas)` : ''}</div>
                <div style="display:flex;gap:6px;">
                    <input id="mf-etapa-nova" placeholder="Nova etapa" onkeydown="if(event.key==='Enter')mf.addEtapa()"
                        style="padding:5px 9px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.78rem;width:150px;">
                    <button class="btn" style="font-size:.74rem;padding:5px 12px;" onclick="mf.addEtapa()">+ Adicionar</button>
                </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 1px;">${boxes || '<span style="color:var(--text-dim);">Nenhuma etapa. Adicione a primeira acima.</span>'}</div>
        </div>`;
    },
    async addEtapa() {
        const inp = $('mf-etapa-nova'); const nome = (inp?.value || '').trim();
        if (!nome) return toast('Informe o nome da etapa.', 'erro');
        const r = await api.post('/api/mf/etapas-processo', { nome });
        toast(r?.ok ? 'Etapa adicionada.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderPainel();
    },
    async renomearEtapa(id, nome) {
        nome = (nome || '').trim(); if (!nome) return this.renderPainel();
        const r = await api.put('/api/mf/etapas-processo/' + id, { nome });
        if (!r?.ok) { toast(r?.erro || 'Erro ao renomear.', 'erro'); this.renderPainel(); }
    },
    async removerEtapa(id) {
        if (!confirm('Remover esta etapa do fluxo?')) return;
        const r = await api.del('/api/mf/etapas-processo/' + id);
        toast(r?.ok ? 'Etapa removida.' : 'Erro.', r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderPainel();
    },
    async moverEtapa(id, dir) {
        const etapas = await api.get('/api/mf/etapas-processo');
        if (!Array.isArray(etapas)) return;
        const i = etapas.findIndex(e => e.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= etapas.length) return;
        const a = etapas[i], b = etapas[j];  // troca a ordem com a vizinha
        await Promise.all([
            api.put('/api/mf/etapas-processo/' + a.id, { ordem: b.ordem }),
            api.put('/api/mf/etapas-processo/' + b.id, { ordem: a.ordem }),
        ]);
        this.renderPainel();
    },

    // ═══ WIP — KANBAN DE PRODUÇÃO (a OP avança pelo fluxo) ══════════════════════
    _wipBtn: 'background:none;border:1px solid var(--border-color);border-radius:5px;cursor:pointer;color:var(--text-dim);font-size:.7rem;padding:3px 6px;line-height:1;',
    _tempoDesde(iso) {
        if (!iso) return '';
        const ms = Date.now() - new Date(iso).getTime();
        const h = ms / 3.6e6;
        if (h < 1) return Math.max(1, Math.round(ms / 6e4)) + 'min';
        if (h < 48) return Math.round(h) + 'h';
        return Math.round(h / 24) + 'd';
    },
    async renderWip() {
        const pan = $('mf-pan-wip');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando Kanban...</div>`;
        const d = await api.get('/api/mf/wip');
        if (!d || d.erro || !Array.isArray(d.board)) {
            pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#ffca28;">WIP não inicializado — rode <strong>mes_wip.sql</strong> no Supabase e recarregue.</div>`;
            return;
        }
        const disp = d.disponiveis || [];
        const iniciar = `<div class="summary-card" style="margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span class="s-label" style="margin:0;">▶ COLOCAR OP NO FLUXO</span>
            <select id="mf-wip-op" style="padding:6px 10px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.82rem;min-width:200px;">
                ${disp.length ? disp.map(o => `<option value="${o.id}" data-qtd="${o.qtd_planejada}">${esc(o.numero)} — ${Number(o.qtd_planejada).toLocaleString('pt-BR')} ${esc(o.unidade)}</option>`).join('') : '<option value="">Nenhuma OP disponível</option>'}
            </select>
            <button class="btn" style="font-size:.78rem;" onclick="mf.iniciarWip()" ${disp.length ? '' : 'disabled'}>Entrar na 1ª etapa</button>
            <span style="margin-left:auto;font-size:.76rem;color:var(--text-dim);">⏱ Lead real médio: <strong style="color:#26c6da;">${d.lead_total_horas ? d.lead_total_horas + ' h' : '—'}</strong>
                &nbsp;·&nbsp; <span title="Estimativa grosseira por WIP÷vazão (Lei de Little). Para o cálculo real de prazo use Capacidade × Demanda.">⌛ Lead aprox. (Little): <strong style="color:#7c4dff;">${d.lead_little_total ? d.lead_little_total + ' dias' : '—'}</strong></span></span>
        </div>`;
        const cols = d.board.map(col => {
            const corG = col.gargalo ? '#f06292' : (col.cor || '#26c6da');
            const cards = col.cards.map(c => `<div style="background:var(--bg-card);border:1px solid var(--border-color);border-left:3px solid ${c.em_processo ? '#26a69a' : corG};border-radius:8px;padding:8px 10px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                    <strong style="font-size:.82rem;">${esc(c.numero)}</strong>
                    <span style="font-size:.64rem;color:var(--text-dim);">há ${this._tempoDesde(c.desde)}</span>
                </div>
                ${c.produto ? `<div style="font-size:.66rem;color:var(--text-dim);margin:2px 0;">${esc(c.produto)}</div>` : ''}
                <div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0 6px;">
                    <span style="font-size:.74rem;">${Number(c.qtd).toLocaleString('pt-BR')} ${esc(c.unidade)}</span>
                    ${c.em_processo ? `<span style="font-size:.58rem;font-weight:700;color:#26a69a;background:#26a69a22;border-radius:4px;padding:1px 5px;" title="${esc(c.operador||'')}">● EM PROCESSO</span>` : `<span style="font-size:.58rem;color:var(--text-dim);border:1px solid var(--border-color);border-radius:4px;padding:1px 5px;">aguardando</span>`}
                </div>
                <div style="display:flex;gap:4px;">
                    <button title="Voltar (retrabalho)" onclick="mf.voltarWip('${c.op_id}')" style="${this._wipBtn}">◀</button>
                    <button title="Avançar para a próxima etapa" onclick="mf.avancarWip('${c.op_id}')" style="${this._wipBtn}flex:1;background:${corG}22;color:${corG};border-color:${corG}55;font-weight:600;">Avançar ▸</button>
                    <button title="Retirar do fluxo" onclick="mf.removerWip('${c.op_id}')" style="${this._wipBtn}color:#f06292;">✕</button>
                </div>
            </div>`).join('') || `<div style="font-size:.72rem;color:var(--text-dim);text-align:center;padding:14px 0;">— vazio —</div>`;
            return `<div style="min-width:200px;max-width:240px;flex:1;background:${corG}0c;border:1px solid ${corG}33;border-radius:10px;padding:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <strong style="font-size:.82rem;color:${corG};">${col.ordem}. ${esc(col.nome)}</strong>
                    ${col.gargalo ? '<span style="font-size:.58rem;font-weight:700;color:#f06292;background:#f0629222;border-radius:4px;padding:1px 5px;">GARGALO</span>' : ''}
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:.66rem;color:var(--text-dim);margin-bottom:8px;">
                    <span><strong style="color:var(--text-primary);">${col.ops}</strong> OP${col.em_processo ? ` · <span style="color:#26a69a;">${col.em_processo} em proc</span>` : ''} · ${Number(col.qtd_wip).toLocaleString('pt-BR')}</span>
                    <span title="Limite de WIP (vazio = sem limite)">lim <input type="number" min="0" value="${col.limite_wip != null ? col.limite_wip : ''}" onchange="mf.salvarLimiteWip('${col.etapa_id}', this.value)" style="width:42px;padding:1px 4px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);font-size:.66rem;text-align:center;"></span>
                </div>
                ${cards}
                ${(col.lead_horas != null || col.throughput_dia || col.lead_little_dias != null) ? `<div style="font-size:.6rem;color:var(--text-dim);text-align:center;margin-top:6px;line-height:1.5;">
                    ${col.lead_horas != null ? `⏱ ${col.lead_horas}h médio` : ''}${col.throughput_dia ? `${col.lead_horas != null ? ' · ' : ''}↻ ${Number(col.throughput_dia).toLocaleString('pt-BR')}/dia` : ''}${col.lead_little_dias != null ? `<br>⌛ Little: ${col.lead_little_dias} dias` : ''}</div>` : ''}
            </div>`;
        }).join('<div style="display:flex;align-items:center;color:var(--text-dim);font-size:1.1rem;padding:0 1px;">→</div>');
        pan.innerHTML = iniciar + `<div style="display:flex;align-items:stretch;gap:3px;overflow-x:auto;padding-bottom:8px;">${cols}</div>`;
    },
    async iniciarWip() {
        const sel = $('mf-wip-op'); const op_id = sel?.value;
        if (!op_id) return toast('Selecione uma OP.', 'erro');
        const r = await api.post('/api/mf/wip/iniciar', { op_id });
        toast(r?.ok ? 'OP entrou no fluxo.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderWip();
    },
    async avancarWip(op_id) {
        const r = await api.post('/api/mf/wip/avancar', { op_id });
        toast(r?.ok ? (r.concluida ? 'OP concluída! 🎉' : 'Avançou para ' + r.proxima) : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderWip();
    },
    async voltarWip(op_id) {
        const r = await api.post('/api/mf/wip/voltar', { op_id });
        toast(r?.ok ? 'Voltou para ' + r.anterior + ' (retrabalho)' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderWip();
    },
    async removerWip(op_id) {
        if (!confirm('Retirar esta OP do fluxo?')) return;
        const r = await api.del('/api/mf/wip/' + op_id);
        toast(r?.ok ? 'Retirada do fluxo.' : 'Erro.', r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderWip();
    },
    async salvarLimiteWip(etapaId, val) {
        const r = await api.put('/api/mf/etapas-processo/' + etapaId, { limite_wip: val === '' ? null : parseInt(val) });
        if (!r?.ok) toast(r?.erro || 'Erro ao salvar limite.', 'erro'); else this.renderWip();
    },
    _metasAberto: false,
    _metasToggle() { this._metasAberto = !this._metasAberto; const b = $('mf-metas-box'); if (b) b.style.display = this._metasAberto ? 'block' : 'none'; },
    async salvarMeta(chave) {
        const v = parseFloat($('mf-meta-' + chave).value);
        const r = await api.put('/api/mf/metas/' + chave, { valor: v });
        toast(r?.ok ? 'Meta salva.' : 'Erro ao salvar meta.', r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderEstrat();  // recalcula os KPIs com o novo alvo (caixa de metas permanece aberta via _metasAberto)
    },

    // ═══ ESTRATÉGICO — KPIs (vs meta) + OKRs ═══════════════════════════════════
    // catálogo de KPIs: chave da métrica → rótulo, unidade, direção e meta
    _KPI: [
        { k:'oee',          lbl:'OEE Médio',           un:'%',   dir:'subir',  meta:m=>m.oee_meta??85,            cor:'#26c6da' },
        { k:'fpy',          lbl:'FPY · 1ª Passagem',   un:'%',   dir:'subir',  meta:()=>95,                       cor:'#66bb6a' },
        { k:'cpk_ok',       lbl:'Processos Capazes',   un:'%',   dir:'subir',  meta:()=>90,                       cor:'#42a5f5' },
        { k:'rnc_eficacia', lbl:'Eficácia das RNCs',   un:'%',   dir:'subir',  meta:()=>90,                       cor:'#ab47bc' },
        { k:'cil',          lbl:'Cumprimento CIL',     un:'%',   dir:'subir',  meta:()=>95,                       cor:'#26a69a' },
        { k:'cnq',          lbl:'Custo da Qualidade',  un:'R$',  dir:'descer', meta:m=>m.cnq_limite_mensal??5000, cor:'#f06292' },
        { k:'ncs',          lbl:'Não Conformidades',   un:'',    dir:'descer', meta:()=>null,                     cor:'#7c4dff', info:true },
        { k:'mtbf',         lbl:'MTBF',                un:'h',   dir:'subir',  meta:()=>null,                     cor:'#ffa726', info:true },
        { k:'mttr',         lbl:'MTTR',                un:'min', dir:'descer', meta:()=>null,                     cor:'#8d6e63', info:true },
    ],
    _METR: { oee:'OEE', cnq:'CNQ (R$)', fpy:'FPY %', cpk_ok:'% Capazes', rnc_eficacia:'Efic. RNC %', cil:'CIL %', ncs:'Nº NCs', mtbf:'MTBF h', mttr:'MTTR min', manual:'Manual' },

    _fmtVal(v, un) {
        if (v == null) return '—';
        if (un === 'R$') return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        return Number(v).toLocaleString('pt-BR') + (un ? (un === '%' ? '%' : ' ' + un) : '');
    },
    _barCor(p) { return p >= 100 ? '#26a69a' : p >= 70 ? '#26c6da' : p >= 40 ? '#ffca28' : '#f06292'; },
    _bar(p, cor) { return `<div style="height:7px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden;margin-top:5px;">
        <div style="height:100%;width:${Math.max(2,p)}%;background:${cor||this._barCor(p)};transition:width .4s;"></div></div>`; },

    async renderEstrat() {
        const pan = $('mf-pan-estrat');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando painel estratégico...</div>`;
        const [met, okrs, metasArr] = await Promise.all([api.get('/api/mf/metricas'), api.get('/api/mf/okrs'), api.get('/api/mf/metas')]);
        if (!met) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">Indicadores indisponíveis — rode os SQLs pendentes (indicadores/TPM/metas).</div>`; return; }
        const M = met.metricas || {}, metas = met.metas || {};

        // ── KPIs vs meta ──
        const cards = this._KPI.map(d => {
            const val = M[d.k], meta = d.meta(metas);
            const hit = (val == null || meta == null) ? null : (d.dir === 'subir' ? val >= meta : val <= meta);
            const cor = hit == null ? d.cor : (hit ? '#26a69a' : '#f06292');
            const metaTxt = meta == null ? (d.info ? 'informativo' : '—') : 'meta ' + (d.dir==='subir'?'≥ ':'≤ ') + this._fmtVal(meta, d.un);
            return `<div style="background:${cor}12;border:1px solid ${cor}3a;border-radius:12px;padding:14px 16px;flex:1;min-width:150px;">
                <div style="font-size:.64rem;color:${cor};letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px;">${d.lbl}</div>
                <div style="font-size:1.55rem;font-weight:800;color:${cor};">${this._fmtVal(val, d.un)}</div>
                <div style="font-size:.66rem;color:var(--text-dim);margin-top:2px;">${hit==null?'':(hit?'✓ ':'✗ ')}${metaTxt}</div>
            </div>`;
        }).join('');

        // ── OKRs ── (api.get devolve null em status != 2xx; nesse caso as tabelas ainda não existem)
        const lista = Array.isArray(okrs) ? okrs : [];
        const okrSemTabela = !Array.isArray(okrs);
        const objHtml = lista.map(o => {
            const krs = (o.okr_resultado || []).map(kr => {
                const editavel = kr.metrica === 'manual';
                const atualHtml = editavel
                    ? `<input type="number" step="any" value="${kr.atual ?? ''}" onchange="mf.salvarKrValor('${kr.id}', this.value)"
                         style="width:88px;padding:3px 6px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:5px;color:var(--text-primary);font-size:.78rem;text-align:right;">`
                    : `<strong>${this._fmtVal(kr.atual, kr.unidade)}</strong>`;
                return `<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.05);">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                        <span style="font-size:.82rem;flex:1;">${esc(kr.descricao)}
                            <span style="font-size:.6rem;color:var(--text-dim);border:1px solid var(--border-color);border-radius:4px;padding:0 5px;margin-left:6px;">${this._METR[kr.metrica]||kr.metrica}</span></span>
                        <span style="font-size:.78rem;white-space:nowrap;color:var(--text-dim);">${atualHtml} <span style="opacity:.6;">/ ${this._fmtVal(kr.meta, kr.unidade)}</span></span>
                        <span style="font-size:.78rem;font-weight:700;color:${this._barCor(kr.progresso)};width:42px;text-align:right;">${kr.progresso}%</span>
                    </div>${this._bar(kr.progresso)}</div>`;
            }).join('') || `<div style="font-size:.78rem;color:var(--text-dim);padding:6px 0;">Sem resultados-chave ainda.</div>`;
            return `<div class="summary-card" style="margin-bottom:14px;">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:8px;">
                    <div style="flex:1;">
                        <div style="font-size:1rem;font-weight:700;">${esc(o.titulo)}</div>
                        <div style="font-size:.7rem;color:var(--text-dim);margin-top:2px;">${[o.periodo,o.responsavel].filter(Boolean).map(esc).join(' · ')||'sem período/responsável'}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1.2rem;font-weight:800;color:${this._barCor(o.progresso)};">${o.progresso}%</div>
                        <button onclick="mf.excluirObjetivo('${o.id}')" title="Excluir objetivo" style="background:none;border:none;color:#f06292;cursor:pointer;font-size:.7rem;">excluir</button>
                    </div>
                </div>
                ${this._bar(o.progresso)}
                <div style="margin-top:8px;">${krs}</div>
                <div style="margin-top:10px;">
                    <button class="btn secondary" style="font-size:.74rem;padding:5px 12px;" onclick="mf._krForm('${o.id}')">+ Resultado-chave</button>
                    <div id="mf-krform-${o.id}" style="display:none;margin-top:10px;padding:12px;background:rgba(255,255,255,.03);border-radius:8px;">
                        <div style="display:grid;grid-template-columns:1fr;gap:8px;">
                            <input id="mf-kr-desc-${o.id}" placeholder="Descrição do resultado-chave *" class="mf-inp">
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                                <select id="mf-kr-metr-${o.id}" class="mf-inp" onchange="mf._krMetrHint('${o.id}')">
                                    ${Object.entries(this._METR).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
                                </select>
                                <select id="mf-kr-dir-${o.id}" class="mf-inp"><option value="subir">Maior é melhor</option><option value="descer">Menor é melhor</option></select>
                                <input id="mf-kr-base-${o.id}" type="number" step="any" placeholder="Baseline (hoje)" class="mf-inp">
                                <input id="mf-kr-meta-${o.id}" type="number" step="any" placeholder="Meta *" class="mf-inp">
                                <input id="mf-kr-un-${o.id}" placeholder="Unidade (%, R$, h...)" class="mf-inp">
                                <input id="mf-kr-val-${o.id}" type="number" step="any" placeholder="Valor atual (se manual)" class="mf-inp">
                            </div>
                            <button class="btn" style="font-size:.78rem;" onclick="mf.salvarKr('${o.id}')">Salvar resultado-chave</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');

        pan.innerHTML = `
            <div class="summary-card" style="margin-bottom:18px;">
                <div class="s-label" style="margin-bottom:12px;">📊 KPIs ESTRATÉGICOS — DESEMPENHO vs META</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">${cards}</div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div class="s-label">🎯 OKRs — OBJETIVOS E RESULTADOS-CHAVE</div>
                <button class="btn" style="font-size:.76rem;padding:6px 14px;" onclick="mf._objForm()">+ Novo Objetivo</button>
            </div>
            <div id="mf-objform" style="display:none;" class="summary-card">
                <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin-bottom:8px;">
                    <input id="mf-obj-tit" placeholder="Objetivo (ex: Tornar a qualidade classe mundial) *" class="mf-inp">
                    <input id="mf-obj-per" placeholder="Período (ex: 2026-T2)" class="mf-inp">
                    <input id="mf-obj-resp" placeholder="Responsável" class="mf-inp">
                </div>
                <button class="btn" style="font-size:.78rem;" onclick="mf.salvarObjetivo()">Criar objetivo</button>
            </div>
            ${okrSemTabela ? `<div class="summary-card" style="color:#ffca28;">Módulo de OKRs ainda não inicializado — rode <strong>mes_okr.sql</strong> no Supabase e recarregue.</div>`
                : (objHtml || `<div class="summary-card" style="color:var(--text-dim);">Nenhum objetivo ainda. Clique em “+ Novo Objetivo”.</div>`)}
            <div style="margin-top:18px;">
                <button class="btn secondary" style="font-size:.76rem;" onclick="mf._metasToggle()">⚙ Ajustar metas dos indicadores</button>
                <div id="mf-metas-box" class="summary-card" style="display:${this._metasAberto ? 'block' : 'none'};margin-top:10px;">
                    <div class="s-label" style="margin-bottom:8px;">🎯 METAS (alvos dos KPIs e alertas)</div>
                    ${(Array.isArray(metasArr) ? metasArr : []).map(m => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);">
                        <span style="font-size:.8rem;">${esc(m.descricao || m.chave)}</span>
                        <input type="number" step="0.01" value="${m.valor}" id="mf-meta-${m.chave}" onchange="mf.salvarMeta('${m.chave}')"
                            style="width:90px;padding:4px 8px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.8rem;text-align:right;"></div>`).join('') || '<div style="color:var(--text-dim);">Rode mes_metas.sql para configurar metas.</div>'}
                </div>
            </div>
            <style>.mf-inp{padding:7px 10px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.82rem;}</style>`;
    },
    _objForm() { const f = $('mf-objform'); f.style.display = f.style.display === 'none' ? 'block' : 'none'; },
    _krForm(id) { const f = $('mf-krform-' + id); f.style.display = f.style.display === 'none' ? 'block' : 'none'; },
    _krMetrHint(id) {  // ao escolher métrica do sistema, esconde "valor manual" (vem automático)
        const manual = $('mf-kr-metr-' + id).value === 'manual';
        $('mf-kr-val-' + id).style.display = manual ? 'block' : 'none';
    },
    async salvarObjetivo() {
        const titulo = $('mf-obj-tit').value.trim();
        if (!titulo) return toast('Informe o objetivo.', 'erro');
        const r = await api.post('/api/mf/okrs', { titulo, periodo: $('mf-obj-per').value.trim(), responsavel: $('mf-obj-resp').value.trim() });
        toast(r?.ok ? 'Objetivo criado.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderEstrat();
    },
    async salvarKr(id) {
        const desc = $('mf-kr-desc-' + id).value.trim();
        const meta = $('mf-kr-meta-' + id).value;
        if (!desc || meta === '') return toast('Descrição e meta são obrigatórios.', 'erro');
        const metrica = $('mf-kr-metr-' + id).value;
        const r = await api.post('/api/mf/okrs/' + id + '/kr', {
            descricao: desc, metrica, direcao: $('mf-kr-dir-' + id).value,
            baseline: $('mf-kr-base-' + id).value || 0, meta, unidade: $('mf-kr-un-' + id).value.trim(),
            valor_manual: metrica === 'manual' ? ($('mf-kr-val-' + id).value || 0) : null,
        });
        toast(r?.ok ? 'Resultado-chave salvo.' : (r?.erro || 'Erro.'), r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderEstrat();
    },
    async salvarKrValor(id, val) {
        const r = await api.put('/api/mf/kr/' + id, { valor_manual: parseFloat(val) || 0 });
        toast(r?.ok ? 'Valor atualizado.' : 'Erro.', r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderEstrat();
    },
    async excluirObjetivo(id) {
        if (!confirm('Excluir este objetivo e todos os seus resultados-chave?')) return;
        const r = await api.del('/api/mf/okrs/' + id);
        toast(r?.ok ? 'Objetivo excluído.' : 'Erro.', r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderEstrat();
    },

    // ═══ CEP — CONTROLE ESTATÍSTICO DE PROCESSO ════════════════════════════════
    async renderCep() {
        const pan = $('mf-pan-cep');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando CEP...</div>`;
        const d = await api.get('/api/mf/cep');
        if (!d) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">CEP indisponível — rode <b>mes_cep.sql</b> no SQL Editor.</div>`; return; }
        this._cepData = d;
        const prodOpt = (d.produtos || []).map(p => `<option value="${p.id}">${esc(p.codigo)} — ${esc((p.descricao||'').slice(0,28))}</option>`).join('');
        // capabilidade em tabela
        const capCor = v => v == null ? '#8b949e' : v >= 1.33 ? '#26a69a' : v >= 1.0 ? '#ffca28' : '#f06292';
        const capLbl = v => v == null ? '—' : v >= 1.33 ? 'capaz' : v >= 1.0 ? 'marginal' : 'incapaz';
        const capLinhas = (d.capabilidade || []).length ? d.capabilidade.map(c => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
            <td style="padding:7px 10px;font-weight:600;color:var(--indigo-primary);">${esc(c.produto_codigo)}</td>
            <td style="padding:7px 10px;">${c.tipo}</td>
            <td style="padding:7px 10px;text-align:right;">${c.n}</td>
            <td style="padding:7px 10px;text-align:right;">${c.media ?? '—'}</td>
            <td style="padding:7px 10px;text-align:right;color:var(--text-dim);">${c.alvo ?? '—'}${c.tol?' ±'+c.tol:''}</td>
            <td style="padding:7px 10px;text-align:right;">${c.sigma ?? '—'}</td>
            <td style="padding:7px 10px;text-align:right;font-weight:700;color:${capCor(c.cp)};">${c.cp ?? '—'}</td>
            <td style="padding:7px 10px;text-align:right;font-weight:700;color:${capCor(c.cpk)};">${c.cpk ?? '—'} <span style="font-size:.66rem;font-weight:400;">${capLbl(c.cpk)}</span></td>
        </tr>`).join('') : `<tr><td colspan="8" style="padding:16px;text-align:center;color:var(--text-dim);">Sem medições. Registre gramatura/largura abaixo.</td></tr>`;
        pan.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:10px;">📏 REGISTRAR MEDIÇÃO</div>
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end;">
                <div><span class="mf-label">PRODUTO</span><select id="mf-md-prod" class="mf-input">${prodOpt}</select></div>
                <div><span class="mf-label">VARIÁVEL</span><select id="mf-md-tipo" class="mf-input"><option value="gramatura">gramatura (g/m²)</option><option value="largura">largura (cm)</option></select></div>
                <div><span class="mf-label">VALOR</span><input id="mf-md-val" type="number" step="0.01" class="mf-input"></div>
                <button class="btn primary" onclick="mf.salvarMedicao()">Registrar</button>
            </div>
            <p style="font-size:.72rem;color:var(--text-dim);margin-top:8px;">Defina o alvo no cadastro de produto (CNQ) e a tolerância (±) abaixo para calcular Cp/Cpk.</p>
        </div>
        <div class="summary-card" style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div class="s-label">CARTA DE CONTROLE</div>
                <div style="display:flex;gap:8px;">
                    <select id="mf-cep-prod" class="mf-input" style="width:auto;" onchange="mf._carregarCarta()">${prodOpt}</select>
                    <select id="mf-cep-tipo" class="mf-input" style="width:auto;" onchange="mf._carregarCarta()"><option value="gramatura">gramatura</option><option value="largura">largura</option></select>
                </div>
            </div>
            <div id="mf-cep-chart" style="overflow-x:auto;"></div>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;">
            <div class="s-label" style="padding:14px 16px 10px;">CAPABILIDADE (Cp / Cpk) — capaz ≥ 1,33 · marginal 1,0–1,33 · incapaz < 1,0</div>
            <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.64rem;">
                <th style="padding:8px 10px;text-align:left;">PRODUTO</th><th style="padding:8px 10px;text-align:left;">VAR</th><th style="padding:8px 10px;text-align:right;">n</th>
                <th style="padding:8px 10px;text-align:right;">MÉDIA</th><th style="padding:8px 10px;text-align:right;">ALVO ±TOL</th><th style="padding:8px 10px;text-align:right;">σ</th><th style="padding:8px 10px;text-align:right;">Cp</th><th style="padding:8px 10px;text-align:right;">Cpk</th>
            </tr></thead><tbody>${capLinhas}</tbody></table>
        </div>`;
        this._carregarCarta();
    },
    async salvarMedicao() {
        const v = parseFloat($('mf-md-val').value);
        if (isNaN(v)) return toast('Informe o valor medido.', 'erro');
        const r = await api.post('/api/mf/medicao', { produto_id: $('mf-md-prod').value, tipo: $('mf-md-tipo').value, valor: v });
        if (!r?.ok) return toast('Erro: ' + (r?.erro||''), 'erro');
        toast('Medição registrada.'); this.renderCep();
    },
    async _carregarCarta() {
        const prod = $('mf-cep-prod')?.value, tipo = $('mf-cep-tipo')?.value;
        const el = $('mf-cep-chart'); if (!el || !prod) return;
        const d = await api.get(`/api/mf/cep?produto_id=${prod}&tipo=${tipo}`);
        const pts = (d?.pontos || []).map(p => Number(p.valor));
        const cap = (d?.capabilidade || []).find(c => c.produto_id === prod && c.tipo === tipo);
        if (!pts.length) { el.innerHTML = `<div style="color:var(--text-dim);padding:20px;text-align:center;">Sem medições para ${tipo} deste produto.</div>`; return; }
        el.innerHTML = this._svgCarta(pts, cap);
    },
    _svgCarta(pts, cap) {
        const W = 720, H = 220, pad = 40;
        const ucl = cap?.ucl, lcl = cap?.lcl, alvo = cap?.alvo != null ? Number(cap.alvo) : null, media = cap?.media != null ? Number(cap.media) : null;
        const vals = [...pts, ucl, lcl, alvo].filter(v => v != null).map(Number);
        let lo = Math.min(...vals), hi = Math.max(...vals); const m = (hi - lo) * 0.1 || 1; lo -= m; hi += m;
        const x = i => pad + (i / Math.max(pts.length - 1, 1)) * (W - 2 * pad);
        const y = v => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
        const linha = (v, cor, dash, lbl) => v == null ? '' : `<line x1="${pad}" y1="${y(v).toFixed(1)}" x2="${W-pad}" y2="${y(v).toFixed(1)}" stroke="${cor}" stroke-width="1" stroke-dasharray="${dash}"/><text x="${W-pad+2}" y="${(y(v)+3).toFixed(1)}" fill="${cor}" font-size="9">${lbl} ${Number(v).toFixed(0)}</text>`;
        const path = pts.map((v, i) => `${i?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        const pontos = pts.map((v, i) => { const fora = (ucl != null && v > ucl) || (lcl != null && v < lcl); return `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${fora?4:3}" fill="${fora?'#f06292':'#26c6da'}"/>`; }).join('');
        return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="min-width:520px;">
            ${linha(ucl, '#f06292', '4 3', 'UCL')}${linha(lcl, '#f06292', '4 3', 'LCL')}
            ${linha(alvo, '#26a69a', '2 2', 'alvo')}${linha(media, '#7c4dff', '0', 'x̄')}
            <path d="${path}" fill="none" stroke="#26c6da" stroke-width="1.5" opacity="0.7"/>${pontos}
        </svg>`;
    },

    // ═══ CNQ — CUSTO DA NÃO QUALIDADE ══════════════════════════════════════════
    async renderCnq() {
        const pan = $('mf-pan-cnq');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando custos...</div>`;
        const d = await api.get('/api/mf/cnq');
        if (!d) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">CNQ indisponível — rode <b>mes_cnq.sql</b> no SQL Editor.</div>`; return; }
        const r = d.resumo || {};
        const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const kpis = [
            ['#f06292', brl(r.custo_total), 'CUSTO TOTAL (CNQ)'],
            ['#ff5252', brl(r.custo_refugo), 'REFUGO'],
            ['#ffca28', brl(r.custo_retrabalho), 'RETRABALHO'],
            ['#7c4dff', brl(r.custo_segregado), 'SEGREGADO'],
        ].map(([c,n,l]) => `<div style="background:${c}18;border:1px solid ${c}44;border-radius:10px;padding:14px 20px;text-align:center;flex:1;min-width:140px;">
            <div style="font-size:1.45rem;font-weight:800;color:${c};">${n}</div><div style="font-size:.66rem;color:${c};letter-spacing:.05em;">${l}</div></div>`).join('');
        const aviso = r.ncs_sem_custo_produto ? `<div style="background:rgba(255,202,40,.1);border:1px solid rgba(255,202,40,.3);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.78rem;color:#ffca28;">⚠ ${r.ncs_sem_custo_produto} NC(s) sem custo porque o produto está com custo unitário R$ 0 — preencha os custos abaixo.</div>` : '';

        const prods = (d.produtos || []).map(p => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
            <td style="padding:7px 10px;font-weight:600;color:var(--indigo-primary);">${esc(p.codigo)}</td>
            <td style="padding:7px 10px;">${esc((p.descricao||'').slice(0,34))}</td>
            <td style="padding:7px 10px;text-align:center;color:var(--text-dim);">${esc(p.unidade_medida)}</td>
            <td style="padding:7px 10px;text-align:right;"><input type="number" min="0" step="0.01" value="${p.custo_unitario||0}" id="mf-cst-${p.id}"
                style="width:110px;padding:4px 8px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.82rem;text-align:right;"
                onchange="mf.salvarCustoProduto('${p.id}')"></td></tr>`).join('');

        const par = (d.porDefeito || []);
        const maxC = Math.max(1, ...par.map(x => x.custo));
        const paretoCusto = par.length ? par.slice(0, 12).map(x => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
            <td style="padding:7px 10px;font-weight:600;color:var(--indigo-primary);">${esc(x.codigo)}</td>
            <td style="padding:7px 10px;">${esc(x.descricao)}</td>
            <td style="padding:7px 10px;width:32%;"><div style="height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;"><div style="width:${x.custo/maxC*100}%;height:100%;background:#f06292;"></div></div></td>
            <td style="padding:7px 10px;text-align:right;color:#f06292;font-weight:700;">${brl(x.custo)}</td>
            <td style="padding:7px 10px;text-align:right;color:var(--text-dim);">${x.ocorrencias}</td></tr>`).join('')
            : `<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--text-dim);">Sem custo apurado (defina os custos de produto e registre NCs).</td></tr>`;

        pan.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">${kpis}</div>
            ${aviso}
            <div class="summary-card" style="padding:0;overflow:hidden;margin-bottom:18px;">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px 10px;">
                    <div class="s-label">PARETO DE CUSTO POR DEFEITO</div>
                    <button class="btn secondary" style="font-size:.74rem;" onclick="mf.recalcularCnq()" title="Congela o custo atual em cada NC (campo custo_estimado)">↻ Congelar custos nas NCs</button>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.66rem;">
                    <th style="padding:8px 10px;text-align:left;">COD</th><th style="padding:8px 10px;text-align:left;">DEFEITO</th>
                    <th style="padding:8px 10px;text-align:left;">CUSTO</th><th style="padding:8px 10px;text-align:right;">R$</th><th style="padding:8px 10px;text-align:right;">OCORR.</th>
                </tr></thead><tbody>${paretoCusto}</tbody></table>
            </div>
            ${(d.fornecedores && d.fornecedores.length) ? `<div class="summary-card" style="padding:0;overflow:hidden;margin-bottom:18px;">
                <div class="s-label" style="padding:14px 16px 10px;">SCORECARD DE FORNECEDOR — qual fio gera mais defeito/custo</div>
                <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.66rem;">
                    <th style="padding:8px 10px;text-align:left;">FORNECEDOR</th><th style="padding:8px 10px;text-align:right;">SESSÕES</th>
                    <th style="padding:8px 10px;text-align:right;">KG CONSUMIDO</th><th style="padding:8px 10px;text-align:right;">NCs</th><th style="padding:8px 10px;text-align:right;">CUSTO CNQ</th>
                </tr></thead><tbody>${d.fornecedores.map(f => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                    <td style="padding:7px 10px;font-weight:600;">${esc(f.fornecedor)}</td>
                    <td style="padding:7px 10px;text-align:right;">${f.sessoes}</td>
                    <td style="padding:7px 10px;text-align:right;">${Number(f.kg_consumido||0).toLocaleString('pt-BR')}</td>
                    <td style="padding:7px 10px;text-align:right;color:${f.ncs?'#f06292':'var(--text-dim)'};font-weight:${f.ncs?'700':'400'};">${f.ncs}</td>
                    <td style="padding:7px 10px;text-align:right;color:#f06292;font-weight:700;">${brl(f.custo_cnq)}</td>
                </tr>`).join('')}</tbody></table></div>` : ''}
            <div class="summary-card" style="padding:0;overflow:hidden;">
                <div class="s-label" style="padding:14px 16px 10px;">CUSTO UNITÁRIO DOS PRODUTOS (R$ / unidade) — base do CNQ</div>
                <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.66rem;">
                    <th style="padding:8px 10px;text-align:left;">CÓDIGO</th><th style="padding:8px 10px;text-align:left;">PRODUTO</th>
                    <th style="padding:8px 10px;text-align:center;">UN</th><th style="padding:8px 10px;text-align:right;">CUSTO UNIT. (R$)</th>
                </tr></thead><tbody>${prods}</tbody></table>
            </div>`;
    },
    async salvarCustoProduto(id) {
        const v = parseFloat($('mf-cst-' + id).value) || 0;
        const r = await api.put('/api/mf/produtos/' + id + '/custo', { custo_unitario: v });
        if (r?.ok) { toast('Custo salvo.'); this.renderCnq(); } else toast('Erro ao salvar custo.', 'erro');
    },
    async recalcularCnq() {
        const r = await api.post('/api/mf/cnq/recalcular', {});
        toast(r?.ok ? `Custo congelado em ${r.atualizadas} NC(s).` : 'Erro: ' + (r?.erro || ''), r?.ok ? 'ok' : 'erro');
    },

    // ═══ MANUTENÇÃO (TPM) ══════════════════════════════════════════════════════
    _TIPO_ETIQ: ['seguranca','qualidade','quebra_iminente','lubrificacao','limpeza','outro'],

    async renderEtiquetas() {
        const pan = $('mf-pan-etiq');
        const maqOpt = this._cad.maquinas.map(m => `<option value="${m.id}">${esc(m.codigo)} · ${esc(m.nome)}</option>`).join('');
        const operOpt = this._cad.operadores.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('');
        const tipoOpt = this._TIPO_ETIQ.map(t => `<option value="${t}">${t.replace('_',' ')}</option>`).join('');
        pan.innerHTML = `
        <div class="summary-card" style="margin-bottom:18px;">
            <div class="s-label" style="margin-bottom:12px;">🏷 NOVA ETIQUETA DE ANOMALIA</div>
            <p style="font-size:.78rem;color:var(--text-dim);margin-bottom:12px;">Sinalize algo errado ANTES da quebra (manutenção autônoma).</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:12px;">
                <div><span class="mf-label">MÁQUINA</span><select id="mf-et-maq" class="mf-input">${maqOpt}</select></div>
                <div><span class="mf-label">OPERADOR</span><select id="mf-et-oper" class="mf-input">${operOpt}</select></div>
                <div><span class="mf-label">TIPO</span><select id="mf-et-tipo" class="mf-input">${tipoOpt}</select></div>
                <div><span class="mf-label">GRAVIDADE</span><select id="mf-et-grav" class="mf-input"><option value="baixa">baixa</option><option value="media" selected>média</option><option value="alta">alta</option></select></div>
            </div>
            <span class="mf-label">DESCRIÇÃO</span><input id="mf-et-desc" class="mf-input" placeholder="o que foi observado" style="margin-bottom:10px;">
            <span class="mf-label">FOTO (opcional)</span>
            <input id="mf-et-foto" type="file" accept="image/*" capture="environment" class="mf-input" style="margin-bottom:8px;" onchange="mf._previewFoto(event)">
            <img id="mf-nc-prev" style="display:none;max-width:140px;border-radius:8px;margin-bottom:10px;">
            <button class="btn primary" onclick="mf.salvarEtiqueta()">Registrar etiqueta</button>
        </div>
        <div id="mf-et-lista"><div style="color:var(--text-dim);padding:12px;">Carregando...</div></div>`;
        await this._listarEtiquetas();
    },
    async _listarEtiquetas() {
        const wrap = $('mf-et-lista'); if (!wrap) return;
        const ets = await api.get('/api/mf/etiquetas?todas=1');
        if (ets === null) { wrap.innerHTML = `<div class="summary-card" style="padding:20px;color:#f06292;">TPM indisponível — rode mes_tpm.sql.</div>`; return; }
        this._etiquetas = ets;
        const corG = { baixa:'#8b949e', media:'#ffca28', alta:'#f06292' };
        const cols = [
            { st:'aberta',       lbl:'ABERTA',       cor:'#ffca28' },
            { st:'em_tratativa', lbl:'EM TRATATIVA', cor:'#26c6da' },
            { st:'resolvida',    lbl:'RESOLVIDA',    cor:'#26a69a' },
        ];
        const card = e => `<div class="mf-et-card" draggable="true" ondragstart="mf._etDragStart(event,'${e.id}')"
            style="background:var(--bg-card);border:1px solid var(--border-color);border-left:3px solid ${corG[e.gravidade]};border-radius:8px;padding:9px 11px;margin-bottom:8px;cursor:grab;">
            <div style="display:flex;gap:8px;">
                ${fotoUrlSegura(e.foto_url) ? `<img src="${esc(fotoUrlSegura(e.foto_url))}" style="width:38px;height:38px;object-fit:cover;border-radius:5px;flex-shrink:0;cursor:pointer;" draggable="false" onclick="event.stopPropagation();window.open(this.src,'_blank')">` : ''}
                <div style="min-width:0;">
                    <div style="font-weight:600;font-size:.8rem;">${esc(e.maquina?.codigo||'—')} <span style="font-size:.62rem;color:${corG[e.gravidade]};">● ${e.gravidade}</span></div>
                    <div style="font-size:.74rem;color:#ddd;">${esc((e.descricao||'').slice(0,52))}</div>
                    <div style="font-size:.62rem;color:var(--text-dim);">${e.tipo.replace('_',' ')}${e.operador?.nome?' · '+esc(e.operador.nome):''}</div>
                </div>
            </div>
            ${e.status==='aberta' ? `<button class="btn secondary" style="font-size:.66rem;margin-top:6px;padding:3px 8px;" onclick="event.stopPropagation();mf.gerarOmDeEtiqueta('${escJS(e.id)}','${escJS(e.maquina_id)}','${escJS(e.descricao)}')">🔧 Gerar OM</button>` : ''}
        </div>`;
        const board = cols.map(c => {
            const lista = ets.filter(e => e.status === c.st);
            return `<div style="flex:1;min-width:200px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid ${c.cor};">
                    <span style="font-size:.7rem;font-weight:700;color:${c.cor};letter-spacing:.04em;">${c.lbl}</span>
                    <span style="font-size:.64rem;color:var(--text-dim);background:${c.cor}22;border-radius:10px;padding:0 7px;">${lista.length}</span>
                </div>
                <div class="mf-et-col" data-status="${c.st}" ondragover="event.preventDefault();this.style.background='rgba(255,255,255,.03)'" ondragleave="this.style.background=''" ondrop="mf._etDrop(event,'${c.st}')"
                    style="min-height:120px;border-radius:8px;padding:4px;transition:background .15s;">
                    ${lista.map(card).join('') || `<div style="font-size:.7rem;color:var(--text-dim);text-align:center;padding:14px;">—</div>`}
                </div>
            </div>`;
        }).join('');
        wrap.innerHTML = `<div style="font-size:.72rem;color:var(--text-dim);margin:4px 0 10px;">Arraste a etiqueta entre as colunas. "Gerar OM" cria a ordem de manutenção e move para Em Tratativa.</div>
            <div style="display:flex;gap:12px;overflow-x:auto;align-items:flex-start;">${board}</div>`;
    },
    _etDragStart(ev, id) { ev.dataTransfer.setData('text/plain', id); },
    async _etDrop(ev, novoStatus) {
        ev.preventDefault();
        const col = ev.currentTarget; if (col) col.style.background = '';
        const id = ev.dataTransfer.getData('text/plain'); if (!id) return;
        const e = (this._etiquetas || []).find(x => x.id === id);
        if (!e || e.status === novoStatus) return;
        const r = await api.put('/api/mf/etiquetas/' + id, { status: novoStatus });
        if (!r?.ok) return toast('Erro: ' + (r?.erro||''), 'erro');
        toast(novoStatus === 'resolvida' ? 'Etiqueta resolvida.' : 'Etiqueta movida.'); this._listarEtiquetas();
    },
    async salvarEtiqueta() {
        const desc = $('mf-et-desc').value.trim();
        if (!desc) return toast('Descreva a anomalia.', 'erro');
        const r = await api.post('/api/mf/etiquetas', { maquina_id: $('mf-et-maq').value, operador_id: $('mf-et-oper').value,
            tipo: $('mf-et-tipo').value, gravidade: $('mf-et-grav').value, descricao: desc, foto_url: this._fotoData?.url || null });
        if (!r?.ok) return toast('Erro: ' + (r?.erro || ''), 'erro');
        this._fotoData = null; toast('Etiqueta registrada.'); this.renderEtiquetas();
    },
    async resolverEtiqueta(id) { const r = await api.put('/api/mf/etiquetas/' + id, { status: 'resolvida' }); if (r?.ok) { toast('Etiqueta resolvida.'); this._listarEtiquetas(); } },
    gerarOmDeEtiqueta(etiqId, maqId, desc) {
        const operOpt = this._cad.operadores.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('');
        this._modal(`
            <div class="s-label" style="margin-bottom:14px;">🔧 ABRIR ORDEM DE MANUTENÇÃO</div>
            <span class="mf-label">DESCRIÇÃO</span><input id="mf-om-desc" class="mf-input" value="${esc(desc)}" style="margin-bottom:12px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
                <div><span class="mf-label">PRIORIDADE</span><select id="mf-om-prio" class="mf-input"><option value="baixa">baixa</option><option value="media">média</option><option value="alta" selected>alta</option><option value="urgente">urgente</option></select></div>
                <div><span class="mf-label">EXECUTOR</span><select id="mf-om-exec" class="mf-input"><option value="">—</option>${operOpt}</select></div>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="mf.abrirOm('${maqId}','${etiqId}')">Abrir OM</button>
            </div>`);
    },

    async renderOms() {
        const pan = $('mf-pan-oms');
        const maqOpt = this._cad.maquinas.map(m => `<option value="${m.id}">${esc(m.codigo)} · ${esc(m.nome)}</option>`).join('');
        const operOpt = this._cad.operadores.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('');
        pan.innerHTML = `
        <div class="summary-card" style="margin-bottom:18px;">
            <div class="s-label" style="margin-bottom:12px;">🔧 NOVA ORDEM DE MANUTENÇÃO</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:12px;">
                <div><span class="mf-label">MÁQUINA</span><select id="mf-omn-maq" class="mf-input">${maqOpt}</select></div>
                <div><span class="mf-label">TIPO</span><select id="mf-omn-tipo" class="mf-input"><option value="corretiva">corretiva</option><option value="preventiva">preventiva</option><option value="preditiva">preditiva</option></select></div>
                <div><span class="mf-label">PRIORIDADE</span><select id="mf-omn-prio" class="mf-input"><option value="baixa">baixa</option><option value="media" selected>média</option><option value="alta">alta</option><option value="urgente">urgente</option></select></div>
                <div><span class="mf-label">EXECUTOR</span><select id="mf-omn-exec" class="mf-input"><option value="">—</option>${operOpt}</select></div>
            </div>
            <span class="mf-label">DESCRIÇÃO</span><input id="mf-omn-desc" class="mf-input" placeholder="o que será feito" style="margin-bottom:10px;">
            <button class="btn primary" onclick="mf.abrirOm()">Abrir OM</button>
        </div>
        <div id="mf-om-lista"><div style="color:var(--text-dim);padding:12px;">Carregando...</div></div>`;
        await this._listarOms();
    },
    _OM_COLS: [
        { st: 'aberta',      lbl: 'ABERTA',       cor: '#ffca28' },
        { st: 'planejada',   lbl: 'PLANEJADA',    cor: '#26c6da' },
        { st: 'em_execucao', lbl: 'EM EXECUÇÃO',  cor: '#7c4dff' },
        { st: 'concluida',   lbl: 'CONCLUÍDA',    cor: '#26a69a' },
    ],
    _PRIO_COR: { urgente:'#ff5252', alta:'#f06292', media:'#ffca28', baixa:'#8b949e' },
    async _listarOms() {
        const wrap = $('mf-om-lista'); if (!wrap) return;
        const oms = await api.get('/api/mf/oms');
        if (oms === null) { wrap.innerHTML = `<div class="summary-card" style="padding:20px;color:#f06292;">TPM indisponível — rode mes_tpm.sql.</div>`; return; }
        this._oms = oms;
        const card = o => `<div class="mf-om-card" draggable="true" ondragstart="mf._omDragStart(event,'${o.id}')"
            style="background:var(--bg-card);border:1px solid var(--border-color);border-left:3px solid ${this._PRIO_COR[o.prioridade]||'#8b949e'};border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:grab;">
            <div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:4px;">
                <span style="font-weight:700;color:var(--indigo-primary);font-size:.84rem;">${esc(o.maquina?.codigo||'—')}</span>
                <span style="font-size:.6rem;font-weight:700;color:${this._PRIO_COR[o.prioridade]};text-transform:uppercase;">${o.prioridade}</span>
            </div>
            <div style="font-size:.8rem;color:#ddd;margin-bottom:4px;">${esc((o.descricao||'').slice(0,60))}</div>
            <div style="font-size:.66rem;color:var(--text-dim);">${o.tipo}${o.executor?.nome?` · ${esc(o.executor.nome)}`:''}${o.tempo_reparo_min!=null?` · ⏱ ${o.tempo_reparo_min}min`:''}</div>
            ${o.causa?`<div style="font-size:.64rem;color:var(--text-dim);margin-top:3px;">causa: ${esc((o.causa||'').slice(0,40))}</div>`:''}
        </div>`;
        const colunas = this._OM_COLS.map(c => {
            const lista = oms.filter(o => o.status === c.st);
            return `<div style="flex:1;min-width:200px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid ${c.cor};">
                    <span style="font-size:.7rem;font-weight:700;color:${c.cor};letter-spacing:.05em;">${c.lbl}</span>
                    <span style="font-size:.66rem;color:var(--text-dim);background:${c.cor}22;border-radius:10px;padding:0 7px;">${lista.length}</span>
                </div>
                <div class="mf-om-col" data-status="${c.st}" ondragover="event.preventDefault();this.style.background='rgba(255,255,255,.03)'" ondragleave="this.style.background=''" ondrop="mf._omDrop(event,'${c.st}')"
                    style="min-height:120px;border-radius:8px;padding:4px;transition:background .15s;">
                    ${lista.map(card).join('') || `<div style="font-size:.7rem;color:var(--text-dim);text-align:center;padding:14px;">—</div>`}
                </div>
            </div>`;
        }).join('');
        wrap.innerHTML = `<div style="font-size:.72rem;color:var(--text-dim);margin-bottom:10px;">Arraste os cartões entre as colunas para mudar o status. Soltar em "Concluída" pede a causa e a ação.</div>
            <div style="display:flex;gap:14px;overflow-x:auto;align-items:flex-start;">${colunas}</div>`;
    },
    _omDragStart(ev, id) { ev.dataTransfer.setData('text/plain', id); ev.dataTransfer.effectAllowed = 'move'; },
    async _omDrop(ev, novoStatus) {
        ev.preventDefault();
        const col = ev.currentTarget; if (col) col.style.background = '';
        const id = ev.dataTransfer.getData('text/plain'); if (!id) return;
        const o = (this._oms || []).find(x => x.id === id);
        if (!o || o.status === novoStatus) return;
        if (novoStatus === 'concluida') return this.concluirOm(id);        // pede causa+ação
        if (novoStatus === 'em_execucao' && !o.iniciada_em) { const r = await api.put('/api/mf/oms/' + id, { iniciar: true }); return this._aposMover(r); }
        const r = await api.put('/api/mf/oms/' + id, { status: novoStatus });
        this._aposMover(r);
    },
    _aposMover(r) { if (!r?.ok) return toast('Erro ao mover: ' + (r?.erro||''), 'erro'); toast('OM atualizada.'); this._listarOms(); },
    async abrirOm(maqIdModal, etiqId) {
        const fromModal = !!maqIdModal;
        const maq = fromModal ? maqIdModal : $('mf-omn-maq').value;
        const desc = (fromModal ? $('mf-om-desc') : $('mf-omn-desc')).value.trim();
        if (!desc) return toast('Descreva a OM.', 'erro');
        const body = { maquina_id: maq, descricao: desc,
            tipo: fromModal ? 'corretiva' : $('mf-omn-tipo').value,
            prioridade: (fromModal ? $('mf-om-prio') : $('mf-omn-prio')).value,
            executor_id: (fromModal ? $('mf-om-exec') : $('mf-omn-exec')).value || null,
            etiqueta_id: etiqId || null };
        const r = await api.post('/api/mf/oms', body);
        if (!r?.ok) return toast('Erro: ' + (r?.erro || ''), 'erro');
        if (fromModal) this._fecharModal();
        toast('OM aberta.'); this.tab('oms');
    },
    async iniciarOm(id) { const r = await api.put('/api/mf/oms/' + id, { iniciar: true }); if (r?.ok) { toast('OM iniciada.'); this._listarOms(); } },
    concluirOm(id) {
        this._modal(`
            <div class="s-label" style="margin-bottom:14px;">✓ CONCLUIR ORDEM</div>
            <span class="mf-label">CAUSA RAIZ</span><input id="mf-om-causa" class="mf-input" placeholder="ex: rolamento desgastado" style="margin-bottom:10px;">
            <span class="mf-label">AÇÃO REALIZADA</span><input id="mf-om-acao" class="mf-input" placeholder="ex: rolamento substituído" style="margin-bottom:14px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="mf._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="mf._concluirOm('${id}')">Concluir</button>
            </div>`);
    },
    async _concluirOm(id) {
        const r = await api.put('/api/mf/oms/' + id, { concluir: true, causa: $('mf-om-causa').value || null, acao_realizada: $('mf-om-acao').value || null });
        if (!r?.ok) return toast('Erro: ' + (r?.erro || ''), 'erro');
        this._fecharModal(); toast(`OM concluída${r.om?.tempo_reparo_min!=null?` · ${r.om.tempo_reparo_min} min`:''}.`); this._listarOms();
    },

    async renderTpm() {
        const pan = $('mf-pan-tpm');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando indicadores TPM...</div>`;
        const d = await api.get('/api/mf/tpm');
        if (!d) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">Indicadores TPM indisponíveis — rode <b>mes_tpm.sql</b> no SQL Editor.</div>`; return; }
        const maqDe = Object.fromEntries((d.maquinas || []).map(m => [m.id, m.codigo]));
        const idx = (arr) => Object.fromEntries((arr || []).map(r => [r.maquina_id, r]));
        const mttr = idx(d.mttr), mtbf = idx(d.mtbf), cil = idx(d.cil), etiq = idx(d.etiquetas);
        const ids = [...new Set([...Object.keys(mttr), ...Object.keys(mtbf), ...Object.keys(cil), ...Object.keys(etiq)])];
        if (!ids.length) { pan.innerHTML = `<div class="summary-card" style="text-align:center;padding:28px;color:var(--text-dim);">Sem dados de manutenção ainda. Registre paradas de manutenção e ordens para ver MTBF/MTTR.</div>`; return; }
        pan.innerHTML = `<div class="summary-card" style="padding:0;overflow:hidden;">
            <div class="s-label" style="padding:16px 16px 10px;">INDICADORES DE MANUTENÇÃO POR MÁQUINA</div>
            <table style="width:100%;border-collapse:collapse;font-size:.84rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.68rem;">
                <th style="padding:10px 12px;text-align:left;">MÁQUINA</th><th style="padding:10px;text-align:right;">MTBF (h)</th>
                <th style="padding:10px;text-align:right;">MTTR (min)</th><th style="padding:10px;text-align:right;">QUEBRAS</th>
                <th style="padding:10px;text-align:right;">CIL %</th><th style="padding:10px;text-align:right;">ETIQ. ABERTAS</th>
            </tr></thead><tbody>${ids.map(id => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:9px 12px;font-weight:600;color:var(--indigo-primary);">${esc(maqDe[id]||'?')}</td>
                <td style="padding:9px;text-align:right;">${mtbf[id]?.mtbf_horas ?? '—'}</td>
                <td style="padding:9px;text-align:right;">${mttr[id]?.mttr_min ?? '—'}</td>
                <td style="padding:9px;text-align:right;color:${mtbf[id]?.quebras?'#f06292':'var(--text-dim)'};">${mtbf[id]?.quebras ?? 0}</td>
                <td style="padding:9px;text-align:right;">${cil[id]?.pct_cumprimento != null ? cil[id].pct_cumprimento + '%' : '—'}</td>
                <td style="padding:9px;text-align:right;color:${etiq[id]?.abertas?'#ffca28':'var(--text-dim)'};">${etiq[id]?.abertas ?? 0}</td>
            </tr>`).join('')}</tbody></table></div>`;
    },

    // ═══ INDICADORES (OEE, Pareto, Qualidade) ══════════════════════════════════
    async renderInd() {
        const pan = $('mf-pan-ind');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando indicadores...</div>`;
        const d = await api.get('/api/mf/indicadores');
        if (!d) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">Indicadores indisponíveis. Rode <b>mes_indicadores.sql</b> no SQL Editor do Supabase.</div>`; return; }
        const r = d.resumo || {};
        const fmt = n => Number(n || 0).toLocaleString('pt-BR');
        const corOee = v => v == null ? '#8b949e' : v >= 75 ? '#26a69a' : v >= 50 ? '#ffca28' : '#f06292';

        // KPIs de qualidade
        const kpis = [
            ['#26c6da', fmt(r.total_ncs), 'NÃO CONFORMIDADES'],
            ['#f06292', fmt(r.qtd_refugada), 'QTD REFUGADA'],
            ['#ffca28', fmt(r.qtd_retrabalho), 'QTD RETRABALHO'],
            ['#ff5252', fmt(r.rncs_geradas), 'RNCs (GATILHO)'],
            ['#ef6c00', fmt(r.criticas), 'CRÍTICAS (SEV 4)'],
        ].map(([c,n,l]) => `<div style="background:${c}18;border:1px solid ${c}44;border-radius:10px;padding:14px 20px;text-align:center;min-width:120px;flex:1;">
            <div style="font-size:1.6rem;font-weight:800;color:${c};">${n}</div><div style="font-size:.66rem;color:${c};letter-spacing:.06em;">${l}</div></div>`).join('');

        // OEE por máquina
        const barra = (v, cor) => `<div style="flex:1;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;"><div style="width:${Math.min(v||0,100)}%;height:100%;background:${cor};"></div></div>`;
        const oeeLinhas = (d.oee || []).length ? d.oee.map(m => `
            <div style="padding:12px 0;border-bottom:1px solid var(--border-color);">
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span style="font-weight:600;">${esc(m.maquina_codigo)} <span style="color:var(--text-dim);font-weight:400;font-size:.8rem;">${esc(m.maquina_nome||'')}</span></span>
                    <span style="font-weight:800;color:${corOee(m.oee)};">OEE ${m.oee != null ? m.oee + '%' : '—'}</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:.72rem;">
                    <div><div style="color:var(--text-dim);margin-bottom:3px;">Disponibilidade ${m.disponibilidade ?? '—'}%</div>${barra(m.disponibilidade,'#26a69a')}</div>
                    <div><div style="color:var(--text-dim);margin-bottom:3px;">Performance ${m.performance ?? '—'}%</div>${barra(m.performance,'#26c6da')}</div>
                    <div><div style="color:var(--text-dim);margin-bottom:3px;">Qualidade ${m.qualidade ?? '—'}%</div>${barra(m.qualidade,'#7c4dff')}</div>
                </div>
            </div>`).join('') : `<div style="color:var(--text-dim);padding:14px;">Sem apontamentos para calcular OEE ainda.</div>`;

        // Pareto de defeitos
        const maxOc = Math.max(1, ...(d.pareto || []).map(p => p.ocorrencias));
        const paretoLinhas = (d.pareto || []).length ? d.pareto.slice(0, 12).map(p => `
            <tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:7px 10px;font-weight:600;color:var(--indigo-primary);">${esc(p.codigo)}</td>
                <td style="padding:7px 10px;">${esc(p.descricao)}</td>
                <td style="padding:7px 10px;width:34%;"><div style="display:flex;align-items:center;gap:8px;"><div style="flex:1;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;"><div style="width:${p.ocorrencias/maxOc*100}%;height:100%;background:#f06292;"></div></div><span style="font-size:.72rem;color:var(--text-dim);min-width:30px;">${p.ocorrencias}</span></div></td>
                <td style="padding:7px 10px;text-align:right;">${fmt(p.qtd_afetada)}</td>
                <td style="padding:7px 10px;text-align:right;color:var(--text-dim);">${p.pct_acumulado}%</td>
            </tr>`).join('') : `<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--text-dim);">Sem não conformidades registradas.</td></tr>`;

        pan.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;">${kpis}</div>
            <div class="summary-card" style="margin-bottom:18px;">
                <div class="s-label" style="margin-bottom:6px;">OEE POR MÁQUINA</div>
                <div style="font-size:.72rem;color:var(--text-dim);margin-bottom:8px;">Disponibilidade × Performance × Qualidade · período: histórico completo</div>
                ${oeeLinhas}
            </div>
            <div class="summary-card" style="padding:0;overflow:hidden;">
                <div class="s-label" style="padding:16px 16px 10px;">PARETO DE DEFEITOS</div>
                <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.66rem;">
                    <th style="padding:8px 10px;text-align:left;">COD</th><th style="padding:8px 10px;text-align:left;">DEFEITO</th>
                    <th style="padding:8px 10px;text-align:left;">OCORRÊNCIAS</th><th style="padding:8px 10px;text-align:right;">QTD AFETADA</th><th style="padding:8px 10px;text-align:right;">% ACUM</th>
                </tr></thead><tbody>${paretoLinhas}</tbody></table>
            </div>`;
    },

    _CAMPOS_IMP: [
        ['op_numero','Nº da OP *'], ['datahora','Data/hora *'], ['defeito_texto','Defeito (texto livre) *'], ['qtd_afetada','Qtd afetada *'],
        ['maquina_nome','Máquina'], ['operador_nome','Operador'], ['turno','Turno'], ['qtd_boa','Qtd boa'], ['disposicao','Disposição'],
    ],

    // ═══ IMPORTAR OPs DO ERP (relatório em blocos) ═════════════════════════════
    renderImportOps() {
        this._opsParsed = null; this._opsPreview = null;
        $('mf-pan-impops').innerHTML = `
            <div class="summary-card" style="margin-bottom:16px;">
                <div class="s-label" style="margin-bottom:8px;">IMPORTAR ORDENS DE PRODUÇÃO — ERP</div>
                <div style="font-size:.82rem;color:var(--text-dim);margin-bottom:12px;">Suba o Excel do ERP (relatório de OPs). Leio os blocos (“O.P. Nº” + “Produto:”), caso o produto pelo código e mostro uma prévia antes de gravar. OPs já existentes são ignoradas; produtos novos são criados a partir do arquivo.</div>
                <input id="mf-impops-file" type="file" accept=".csv,.xls,.xlsx" class="mf-input" style="max-width:420px;" onchange="mf._lerArquivoOps(event)">
                <div style="margin-top:10px;display:flex;align-items:center;gap:10px;">
                    <span class="mf-label" style="margin:0;">UNIDADE</span>
                    <select id="mf-impops-un" class="mf-input" style="width:90px;"><option value="pc">pç</option><option value="kg">kg</option><option value="m">m</option></select>
                </div>
            </div>
            <div id="mf-impops-prev"></div>`;
    },
    // parser do relatório do ERP: cada OP é um bloco (linha "O.P. Nº" + linha "Produto: cod - desc | cor | marca | TAM. X")
    _parseOpsErp(rows) {
        const ops = []; let cur = null;
        const numBR = s => { const t = String(s).trim().replace(/\.(?=\d{3}(?:[.,]|$))/g, '').replace(',', '.'); const n = parseFloat(t); return isFinite(n) ? n : null; };
        for (const row of (rows || [])) {
            const cells = (row || []).map(c => (c == null ? '' : String(c)));
            const joined = cells.join(' ').replace(/\s+/g, ' ').trim();
            if (!joined) continue;
            const mOP = joined.match(/O\.?\s*P\.?\s*N[ºo°.]*\s*:?\s*(\d+)/i) || joined.match(/ordem\s*(?:de\s*)?produ[cç][ãa]o[^\d]*(\d+)/i);
            if (mOP) {
                cur = { numero: mOP[1] };
                cur.emissao = (joined.match(/emiss[ãa]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || null;
                cur.previsao = (joined.match(/previs[ãa]o\s*(?:inicial)?\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || null;
                cur.previsao_final = (joined.match(/previs[ãa]o\s*final\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || null;
                cur.status = (joined.match(/status\s*:?\s*([^|]+?)\s*$/i) || [])[1] || null;
                ops.push(cur);
                continue;
            }
            if (cur && /produto\s*:?/i.test(joined)) {
                const seg = joined.replace(/^.*?produto\s*:?\s*/i, '');
                // as 5 colunas de quantidade ficam no fim (formato N,NNNN); a 1ª (Para Produção) é a planejada
                const nums = seg.match(/\d[\d.]*,\d{4}(?!\d)/g) || [];
                cur.qtd = nums.length ? numBR(nums[0]) : 0;
                const corte = seg.search(/\s*\d[\d.]*,\d{4}(?!\d)/);  // texto do produto, sem as quantidades
                const head = (corte > 0 ? seg.slice(0, corte) : seg).trim();
                const m0 = head.match(/(\d+)\s*-\s*(.+)/);
                if (m0) {
                    cur.prod_codigo = m0[1];
                    const partes = m0[2].split(/\s*[|/]\s*/).map(s => s.trim()).filter(Boolean);  // separador | ou /
                    const iTam = partes.findIndex(p => /\btam[\s.]/i.test(p));   // a parte com "TAM." é o tamanho
                    if (iTam >= 0) { const mt = partes[iTam].match(/tam[\s.]+([^\s|/-]+)/i); cur.tamanho = mt ? mt[1] : null; }
                    // descrição = NOME COMPLETO (todas as partes, menos a de tamanho) — os campos do ERP são inconsistentes p/ separar cor/marca
                    cur.descricao = partes.filter((_, i) => i !== iTam).join(' · ') || m0[2].trim();
                    cur.cor = null; cur.marca = null;
                } else { cur.descricao = (head || '').replace(/\s*[|/]\s*/g, ' · ').trim(); }
                continue;
            }
            if (cur) { const ms = joined.match(/^status\s*:?\s*(.+)$/i); if (ms && !cur.status) cur.status = ms[1].trim(); }
        }
        return ops.filter(o => o.numero);
    },
    _lerArquivoOps(ev) {
        const file = ev.target.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const wb = XLSX.read(e.target.result, { type: 'array' });
                const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
                this._opsParsed = this._parseOpsErp(rows);
                if (!this._opsParsed.length) { $('mf-impops-prev').innerHTML = `<div class="summary-card" style="color:#ffca28;">Não reconheci nenhuma OP no arquivo. Confira se é o relatório de Ordens de Produção (com “O.P. Nº” e “Produto:”). Me mande o arquivo que eu ajusto o leitor.</div>`; return; }
                this.previewOps();
            } catch (err) { toast('Erro ao ler o arquivo: ' + err.message, 'erro'); }
        };
        reader.readAsArrayBuffer(file);
    },
    _opsCard(cor, n, lbl) { return `<div style="background:${cor}14;border:1px solid ${cor}3a;border-radius:12px;padding:14px 18px;text-align:center;flex:1;min-width:150px;"><div style="font-size:1.7rem;font-weight:800;color:${cor};">${n}</div><div style="font-size:.64rem;color:${cor};letter-spacing:.04em;">${lbl}</div></div>`; },
    async previewOps() {
        if (!this._opsParsed?.length) return;
        const unidade = $('mf-impops-un')?.value || 'pc';
        const r = await api.post('/api/mf/importar-ops', { rows: this._opsParsed, unidade, confirmar: false });
        if (!r?.ok) { $('mf-impops-prev').innerHTML = `<div class="summary-card" style="color:#f06292;">${esc(r?.erro || 'Erro na prévia.')}</div>`; return; }
        this._opsPreview = r;
        const lista = (arr, render) => arr.length ? arr.map(render).join('') : '<div style="color:var(--text-dim);font-size:.8rem;padding:6px 0;">—</div>';
        $('mf-impops-prev').innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
                ${this._opsCard('#26a69a', r.novas.length, 'OPs NOVAS A IMPORTAR')}
                ${this._opsCard('#42a5f5', r.produtos_novos.length, 'PRODUTOS NOVOS (do arquivo)')}
                ${this._opsCard('#8b949e', r.existentes.length, 'JÁ EXISTENTES (ignoradas)')}
            </div>
            ${r.produtos_novos.length ? `<div class="summary-card" style="margin-bottom:12px;"><div class="s-label" style="margin-bottom:8px;">PRODUTOS NOVOS QUE SERÃO CRIADOS (${r.produtos_novos.length})</div>
                <div style="max-height:160px;overflow:auto;font-size:.8rem;">${lista(r.produtos_novos, p => `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04);">${esc(p.codigo)} — ${esc(p.descricao)} <span style="color:var(--text-dim);">${[p.cor, p.marca, p.tamanho].filter(Boolean).map(esc).join(' · ')}</span></div>`)}</div></div>` : ''}
            <div class="summary-card" style="margin-bottom:14px;"><div class="s-label" style="margin-bottom:8px;">OPs NOVAS (${r.novas.length})</div>
                <div style="max-height:240px;overflow:auto;font-size:.8rem;">${lista(r.novas, o => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04);">
                    <span><strong>${esc(o.numero)}</strong> · ${esc(o.prod_codigo)} ${esc(o.descricao)}</span>
                    <span style="color:var(--text-dim);white-space:nowrap;">${Number(o.qtd).toLocaleString('pt-BR')} ${esc(unidade)}${o.prod_novo ? ' · <span style="color:#42a5f5;">produto novo</span>' : ''}</span></div>`)}</div></div>
            ${r.novas.length ? `<button class="btn primary" onclick="mf.confirmarOps()">✓ Importar ${r.novas.length} OP(s)${r.produtos_novos.length ? ` e criar ${r.produtos_novos.length} produto(s)` : ''}</button>` : `<div class="summary-card" style="color:var(--text-dim);">Nada novo para importar — todas as OPs do arquivo já existem no MES.</div>`}`;
    },
    async confirmarOps() {
        if (!this._opsParsed?.length) return;
        const unidade = $('mf-impops-un')?.value || 'pc';
        const r = await api.post('/api/mf/importar-ops', { rows: this._opsParsed, unidade, confirmar: true });
        if (!r?.ok) return toast(r?.erro || 'Erro ao importar.', 'erro');
        toast(`Importadas ${r.inseridas} OP(s)` + (r.produtos_criados ? `, ${r.produtos_criados} produto(s) criados` : '') + (r.erros?.length ? `, ${r.erros.length} com erro` : '') + '.', r.erros?.length ? 'aviso' : 'ok');
        $('mf-impops-prev').innerHTML = `<div class="summary-card"><div class="s-label" style="margin-bottom:8px;">RESULTADO</div>
            <div style="font-size:.85rem;line-height:1.8;">✅ <strong>${r.inseridas}</strong> OP(s) importadas<br>${r.produtos_criados ? `🆕 ${r.produtos_criados} produto(s) criados<br><span style="font-size:.74rem;color:#ffca28;">⚠ produtos novos entram SEM custo unitário — defina em <strong>Custo da Qualidade</strong>, senão o CNQ desses itens fica R$ 0.</span><br>` : ''}${r.ignoradas ? `⏭ ${r.ignoradas} já existentes (ignoradas)<br>` : ''}${r.erros?.length ? `<span style="color:#f06292;">⚠ ${r.erros.length} com erro:</span><br><span style="font-size:.74rem;color:var(--text-dim);">${r.erros.slice(0, 20).map(esc).join('<br>')}</span>` : ''}</div></div>`;
        this._opsParsed = null;
    },

    renderImport() {
        $('mf-pan-import').innerHTML = `
        <div class="summary-card" style="margin-bottom:18px;">
            <div class="s-label" style="margin-bottom:8px;">IMPORTAR LEGADO — ETL com staging</div>
            <p style="font-size:.8rem;color:var(--text-dim);margin-bottom:14px;">Suba a planilha (CSV/XLS), mapeie as colunas, e os dados passam por validação → tradução do defeito (exato → fuzzy → IA) → deduplicação. Só linhas válidas sobem para produção.</p>
            <input id="mf-imp-file" type="file" accept=".csv,.xls,.xlsx" class="mf-input" style="margin-bottom:12px;max-width:420px;" onchange="mf._lerArquivo(event)">
            <div id="mf-imp-cfg" style="display:none;">
                <div class="mf-label" style="margin-bottom:8px;">MAPA DE COLUNAS — ligue cada campo do modelo à coluna da sua planilha</div>
                <div id="mf-imp-mapa" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:14px;"></div>
                <button class="btn primary" onclick="mf.importar()">1 · Importar para staging</button>
                <span id="mf-imp-info" style="margin-left:12px;font-size:.78rem;color:var(--text-dim);"></span>
            </div>
        </div>
        <div id="mf-imp-result"></div>`;
        this._impLinhas = null; this._loteAtual = null;
    },

    _lerArquivo(ev) {
        const file = ev.target.files?.[0]; if (!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        const aplicar = (linhas) => {
            this._impLinhas = linhas;
            const cols = Object.keys(linhas[0] || {});
            // auto-mapeia por palpite
            const palpite = { op_numero:/op|ordem/i, datahora:/data|hora/i, defeito_texto:/defeit|ocorr|problema/i, qtd_afetada:/afet|qtd.?def|defeit.*qtd/i,
                maquina_nome:/maq|tear|circ/i, operador_nome:/oper|funcion/i, turno:/turno/i, qtd_boa:/boa|produz|qtd.?boa/i, disposicao:/dispos|destino/i };
            $('mf-imp-mapa').innerHTML = this._CAMPOS_IMP.map(([campo,lbl]) => {
                const pref = cols.find(c => palpite[campo]?.test(c)) || '';
                return `<div><span class="mf-label">${lbl}</span>
                    <select class="mf-input mf-map" data-campo="${campo}">
                        <option value="">— ignorar —</option>
                        ${cols.map(c => `<option value="${esc(c)}"${c===pref?' selected':''}>${esc(c)}</option>`).join('')}
                    </select></div>`;
            }).join('');
            $('mf-imp-cfg').style.display = 'block';
            $('mf-imp-info').textContent = `${linhas.length} linhas lidas`;
        };
        if (ext === 'csv') Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => aplicar(r.data) });
        else { const reader = new FileReader(); reader.onload = e => { const wb = XLSX.read(e.target.result, { type: 'array' }); aplicar(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })); }; reader.readAsArrayBuffer(file); }
    },

    async importar() {
        if (!this._impLinhas?.length) return toast('Selecione um arquivo.', 'erro');
        const mapa = {};
        document.querySelectorAll('.mf-map').forEach(s => { if (s.value) mapa[s.dataset.campo] = s.value; });
        if (!mapa.defeito_texto) return toast('Mapeie ao menos a coluna do Defeito.', 'erro');
        const r = await api.post('/api/mf/importar', { linhas: this._impLinhas, mapa });
        if (!r?.ok) return toast('Erro ao importar: ' + (r?.erro || ''), 'erro');
        this._loteAtual = r.lote_id;
        toast(`Staging: ${r.valido} válidas, ${r.novo} pendentes, ${r.rejeitado} rejeitadas.`, r.rejeitado ? 'aviso' : 'ok');
        await this._renderLote();
    },

    async _classificar() {
        toast('Classificando com IA...', 'aviso');
        const r = await api.post('/api/mf/classificar', { lote_id: this._loteAtual });
        if (!r?.ok) return toast('Erro: ' + (r?.erro || ''), 'erro');
        if (r.semChave) toast(r.msg, 'aviso');
        else toast(`Classificados: ${r.classificados} · revisão: ${r.paraRevisao}`, 'ok');
        await this._renderLote();
    },

    async _carga() {
        const r = await api.post('/api/mf/importar/' + this._loteAtual + '/carga', {});
        if (!r?.ok) return toast('Erro na carga: ' + (r?.erro || ''), 'erro');
        toast(`Carregados p/ produção: ${r.carregados}${r.pulados?` · ${r.pulados} duplicados`:''}.`, 'ok');
        await this._renderLote();
    },

    async _renderLote() {
        const rows = await api.get('/api/mf/importacao/' + this._loteAtual) || [];
        const rel  = await api.get('/api/mf/importacao/' + this._loteAtual + '/relatorio') || {};
        const defMap = Object.fromEntries(this._cad.defeitos.map(d => [d.id, d.codigo + ' — ' + d.descricao]));
        const cont = s => rel.porStatus?.[s] || 0;
        const corS = { valido:'#26a69a', novo:'#ffca28', rejeitado:'#f06292', carregado:'#26c6da' };
        const erroLista = Object.entries(rel.porErro || {}).map(([k,v]) => `${k}: ${v}`).join(' · ') || '—';
        $('mf-imp-result').innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;">
                <div class="s-label" style="margin-bottom:10px;">RELATÓRIO DO LOTE</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
                    ${['valido','novo','rejeitado','carregado'].map(s => `<div style="background:${corS[s]}18;border:1px solid ${corS[s]}44;border-radius:8px;padding:10px 18px;text-align:center;min-width:90px;">
                        <div style="font-size:1.4rem;font-weight:800;color:${corS[s]};">${cont(s)}</div><div style="font-size:.66rem;color:${corS[s]};letter-spacing:.06em;">${s.toUpperCase()}</div></div>`).join('')}
                </div>
                <div style="font-size:.74rem;color:var(--text-dim);margin-bottom:12px;">Métodos: ${Object.entries(rel.porMetodo||{}).map(([k,v])=>`${k} ${v}`).join(' · ')||'—'} · Rejeições: ${esc(erroLista)}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${cont('novo') ? `<button class="btn secondary" style="font-size:.78rem;" onclick="mf._classificar()">2 · Classificar pendentes (IA)</button>` : ''}
                    ${cont('valido') ? `<button class="btn primary" style="font-size:.78rem;" onclick="mf._carga()">3 · Promover válidos → produção</button>` : ''}
                </div>
            </div>
            <div class="summary-card" style="padding:0;overflow:hidden;max-height:380px;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:.78rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.64rem;position:sticky;top:0;background:var(--bg-card);">
                <th style="padding:8px;text-align:left;">#</th><th style="padding:8px;text-align:left;">OP</th><th style="padding:8px;text-align:left;">TEXTO LEGADO</th>
                <th style="padding:8px;text-align:left;">→ DEFEITO</th><th style="padding:8px;text-align:center;">MÉTODO</th><th style="padding:8px;text-align:center;">STATUS</th><th style="padding:8px;text-align:left;">ERROS</th>
            </tr></thead><tbody>${rows.map(row => { const c = row.linha_bruta?._campos || {}; const cor = corS[row.status] || '#8b949e';
                return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                    <td style="padding:6px 8px;color:var(--text-dim);">${row.linha_origem}</td>
                    <td style="padding:6px 8px;">${esc(c.op_numero||'')}</td>
                    <td style="padding:6px 8px;">${esc(String(c.defeito_texto||'').slice(0,40))}</td>
                    <td style="padding:6px 8px;">${row.defeito_id ? esc(defMap[row.defeito_id]||'?') : '<span style="color:#8b949e;">—</span>'}</td>
                    <td style="padding:6px 8px;text-align:center;color:var(--text-dim);">${row.metodo_traducao||'—'}${row.confianca?` ${row.confianca}`:''}</td>
                    <td style="padding:6px 8px;text-align:center;color:${cor};font-weight:700;">${row.status}</td>
                    <td style="padding:6px 8px;color:#f06292;font-size:.7rem;">${esc((row.erros||[]).join('; '))}</td>
                </tr>`; }).join('')}</tbody></table></div>`;
    },

    // ── Modal ──
    _modal(html) { $('mf-modal-body').innerHTML = html; $('mf-modal').style.display = 'flex'; },
    _fecharModal() { $('mf-modal').style.display = 'none'; this._fotoData = null; },
};

// fecha modal ao clicar fora
document.addEventListener('click', e => { if (e.target.id === 'mf-modal') mf._fecharModal(); });
document.addEventListener('DOMContentLoaded', () => mf.init());
