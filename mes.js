// ============================================================================
// MES Malha Forte — frontend standalone (não depende do app.js do SIGS)
// ============================================================================

// ── Helpers básicos ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
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
        try {
            const ops = (await this.pendentes()).sort((a, b) => a.seq - b.seq);
            for (const op of ops) {
                let r;
                try { r = await fetch(op.url, { method: op.metodo, headers: api._h(), body: JSON.stringify({ ...op.payload, sincronizado_em: new Date().toISOString() }) }); }
                catch { break; } // rede caiu — para e tenta no próximo 'online'
                if (r.status === 401) { mf._expirou(); break; }
                if (!r.ok) { toast('Um item da fila falhou no servidor — verifique.', 'erro'); break; }
                await this._remover(op.seq);
                mf._atualizarBadge();
            }
        } finally {
            this._enviando = false;
            mf._atualizarBadge();
            const restam = (await this.pendentes()).length;
            if (restam === 0 && navigator.onLine) mf._reconciliar();
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
        const urlTok = new URLSearchParams(location.search).get('token');
        if (urlTok) { localStorage.setItem(TOKEN_KEY, urlTok); try { history.replaceState({}, document.title, location.pathname); } catch {} }

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
        fila.flush();
    },

    _uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); })); },

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
        if (srv) { this._abertas = srv; await fila.salvarEstado('abertas', srv); if (document.querySelector('#app-sidebar .active')?.dataset.mftab === 'apont') this.renderSessoes(); }
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
            const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ email: $('login-email').value, senha: $('login-senha').value }) });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.token) { localStorage.setItem(TOKEN_KEY, d.token); location.reload(); }
            else { const er = $('login-erro'); er.style.display = 'block'; er.textContent = d.erro || 'Falha no login'; }
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
        ['painel','apont','ncs','rnc','ind','cnq','cep','etiq','oms','tpm','cil','cad','fio','gene','import'].forEach(t => { const p = $('mf-pan-' + t); if (p) p.style.display = t === name ? 'block' : 'none'; });
        if (name === 'painel') this.renderPainel();
        if (name === 'apont')  this.renderApont();
        if (name === 'ncs')    this.renderNcs();
        if (name === 'rnc')    this.renderRnc();
        if (name === 'ind')    this.renderInd();
        if (name === 'cnq')    this.renderCnq();
        if (name === 'cep')    this.renderCep();
        if (name === 'cil')    this.renderCil();
        if (name === 'cad')    this.renderCadTpm();
        if (name === 'fio')    this.renderFio();
        if (name === 'gene')   this.renderGenealogia();
        if (name === 'etiq')   this.renderEtiquetas();
        if (name === 'oms')    this.renderOms();
        if (name === 'tpm')    this.renderTpm();
        if (name === 'import') this.renderImport();
    },

    // ═══ APONTAMENTO ═══════════════════════════════════════════════════════════
    async renderApont() {
        const c = this._cad;
        const opt = (arr, val, lbl) => arr.map(x => `<option value="${x.id}">${esc(lbl(x))}</option>`).join('');
        const novaSessao = `
        <div class="summary-card" style="margin-bottom:18px;">
            <div class="s-label" style="margin-bottom:14px;">+ NOVA SESSÃO DE APONTAMENTO</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">
                <div><span class="mf-label">ORDEM DE PRODUÇÃO *</span>
                    <select id="mf-op" class="mf-input">${c.ops.map(o => `<option value="${o.id}">${esc(o.numero)} — ${esc(o.produto?.descricao||'')}</option>`).join('')}</select></div>
                <div><span class="mf-label">MÁQUINA *</span><select id="mf-maq" class="mf-input">${opt(c.maquinas,'id',m=>`${m.codigo} · ${m.nome}`)}</select></div>
                <div><span class="mf-label">OPERADOR *</span><select id="mf-oper" class="mf-input">${opt(c.operadores,'id',o=>o.nome)}</select></div>
                <div><span class="mf-label">TURNO *</span><select id="mf-turno" class="mf-input">${opt(c.turnos,'id',t=>`${t.codigo} — ${t.descricao||''}`)}</select></div>
            </div>
            <button class="btn primary" style="margin-top:14px;" onclick="mf.iniciarSessao()">▶ Iniciar Sessão</button>
        </div>`;
        $('mf-pan-apont').innerHTML = novaSessao + `<div id="mf-sessoes"></div>`;
        if (navigator.onLine) await this._reconciliar();
        this.renderSessoes();
    },

    async iniciarSessao() {
        const opId = $('mf-op').value, maqId = $('mf-maq').value, operId = $('mf-oper').value, turnoId = $('mf-turno').value;
        if (!opId || !maqId || !operId || !turnoId) return toast('Preencha OP, máquina, operador e turno.', 'erro');
        const id = this._uuid();
        const c = this._cad;
        // estado otimista (mostra na hora, mesmo offline)
        this._abertas.unshift({ id, datahora_inicio: new Date().toISOString(), qtd_boa:0, qtd_refugo:0, qtd_retrabalho:0,
            op: { numero: c.ops.find(o=>o.id===opId)?.numero || 'OP' },
            maquina: { codigo: c.maquinas.find(m=>m.id===maqId)?.codigo || '' },
            operador: { nome: c.operadores.find(o=>o.id===operId)?.nome || '' },
            turno: { codigo: c.turnos.find(t=>t.id===turnoId)?.codigo || '' },
            nao_conformidade: [], parada: [], _pendente: true });
        await fila.salvarEstado('abertas', this._abertas);
        this.renderSessoes();
        await fila.enfileirar('POST', '/api/mf/apontamentos', { id, op_id: opId, maquina_id: maqId, operador_id: operId, turno_id: turnoId, dispositivo_id: navigator.userAgent.slice(0, 60) });
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
                        <span style="color:var(--text-dim);font-size:.82rem;"> · ${esc(a.maquina?.codigo||'')} · ${esc(a.operador?.nome||'')} · turno ${esc(a.turno?.codigo||'')}</span></div>
                    <span style="font-size:.72rem;color:var(--text-dim);">há ${dur} min${ncs?` · <span style="color:#f06292;">${ncs} NC</span>`:''}${paradas?` · <span style="color:#ffca28;">${paradas} parada aberta</span>`:''}${a._pendente?` · <span style="color:#ef6c00;">⏳ pendente</span>`:''}</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:12px;">
                    <div><span class="mf-label">QTD BOA</span><input type="number" min="0" step="0.001" value="${a.qtd_boa||0}" id="mf-qb-${a.id}" class="mf-input"></div>
                    <div><span class="mf-label">REFUGO</span><input type="number" min="0" step="0.001" value="${a.qtd_refugo||0}" id="mf-qr-${a.id}" class="mf-input"></div>
                    <div><span class="mf-label">RETRABALHO</span><input type="number" min="0" step="0.001" value="${a.qtd_retrabalho||0}" id="mf-qt-${a.id}" class="mf-input"></div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn secondary" style="font-size:.78rem;" onclick="mf.salvarQtd('${a.id}')">💾 Salvar qtd</button>
                    <button class="btn secondary" style="font-size:.78rem;" onclick="mf.formParada('${a.id}')">⏸ Registrar parada</button>
                    <button class="btn secondary" style="font-size:.78rem;border-color:rgba(240,98,146,.4);color:#f06292;" onclick="mf.formNc('${a.id}')">⚠ Registrar NC</button>
                    <button class="btn primary" style="font-size:.78rem;margin-left:auto;" onclick="mf.fecharSessao('${a.id}')">✓ Fechar sessão</button>
                </div>
            </div>`;
        }).join('');
    },

    async salvarQtd(id) {
        const qtd = { qtd_boa: parseFloat($('mf-qb-' + id).value) || 0, qtd_refugo: parseFloat($('mf-qr-' + id).value) || 0, qtd_retrabalho: parseFloat($('mf-qt-' + id).value) || 0 };
        const a = this._abertas.find(x => x.id === id); if (a) Object.assign(a, qtd);
        await fila.salvarEstado('abertas', this._abertas);
        await fila.enfileirar('PUT', '/api/mf/apontamentos/' + id, { ...qtd });
        toast(navigator.onLine ? 'Quantidades salvas.' : 'Salvo na fila (offline).', navigator.onLine ? 'ok' : 'aviso');
    },

    async fecharSessao(id) {
        const qtd = { qtd_boa: parseFloat($('mf-qb-' + id).value) || 0, qtd_refugo: parseFloat($('mf-qr-' + id).value) || 0, qtd_retrabalho: parseFloat($('mf-qt-' + id).value) || 0 };
        this._abertas = this._abertas.filter(x => x.id !== id);  // some da lista de abertas
        await fila.salvarEstado('abertas', this._abertas);
        this.renderSessoes();
        await fila.enfileirar('PUT', '/api/mf/apontamentos/' + id, { ...qtd });
        await fila.enfileirar('PUT', '/api/mf/apontamentos/' + id, { fechar: true });
        toast(navigator.onLine ? 'Sessão fechada.' : 'Fechada (offline — na fila).', navigator.onLine ? 'ok' : 'aviso');
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
        const id = this._uuid();
        const a = this._abertas.find(x => x.id === apId); if (a) { (a.parada = a.parada || []).push({ id, datahora_fim: null }); }
        await fila.salvarEstado('abertas', this._abertas);
        this._fecharModal(); this.renderSessoes();
        await fila.enfileirar('POST', '/api/mf/paradas', { id, apontamento_id: apId, motivo_id, observacao });
        toast(navigator.onLine ? 'Parada registrada.' : 'Parada na fila (offline).', navigator.onLine ? 'ok' : 'aviso');
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
        if (opt && $('mf-nc-disp')) $('mf-nc-disp').value = opt.dataset.disp || 'segregar';
    },
    _previewFoto(ev) {
        const f = ev.target.files?.[0]; if (!f) return;
        this._comprimirFoto(f).then(d => { const img = $('mf-nc-prev'); img.src = d.url; img.style.display = 'block'; this._fotoData = d; });
    },
    _comprimirFoto(file) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const max = 1024, sc = Math.min(1, max / Math.max(img.width, img.height));
                const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
                const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                const url = cv.toDataURL('image/jpeg', 0.7);
                resolve({ url, w, h, bytes: Math.round(url.length * 0.75), nome: file.name });
            };
            img.src = URL.createObjectURL(file);
        });
    },
    async salvarNc(apId) {
        const qtd = parseFloat($('mf-nc-qtd').value);
        if (!qtd || qtd <= 0) return toast('Quantidade afetada deve ser > 0.', 'erro');
        const ncId = this._uuid();
        const foto = this._fotoData;
        const a = this._abertas.find(x => x.id === apId); if (a) (a.nao_conformidade = a.nao_conformidade || []).push({ id: ncId });
        await fila.salvarEstado('abertas', this._abertas);
        // NC primeiro, foto depois (a fila respeita a ordem → foto só sobe após a NC existir)
        await fila.enfileirar('POST', '/api/mf/ncs', {
            id: ncId, apontamento_id: apId, defeito_id: $('mf-nc-def').value, qtd_afetada: qtd, unidade: 'kg',
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
                <td style="padding:8px;text-align:center;">${n.foto?.length?`<img src="${n.foto[0].url}" style="width:34px;height:34px;object-fit:cover;border-radius:5px;cursor:pointer;" onclick="window.open().document.write('<img src=\\'' + this.src + '\\'>')">`:'—'}</td>
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
        const corS = { aberta:'#26c6da', em_analise:'#ffca28', em_acao:'#7c4dff', verificacao:'#ff9800', fechada:'#26a69a', cancelada:'#8b949e' };
        const lista = this._rncs.length ? this._rncs.map(x => {
            const atrasada = x.prazo && new Date(x.prazo) < new Date() && !['fechada','cancelada'].includes(x.status);
            return `<div class="summary-card" style="margin-bottom:10px;cursor:pointer;border-left:3px solid ${corS[x.status]};" onclick="mf.abrirRnc('${x.id}')">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                    <div><span style="font-weight:600;">${esc(x.titulo)}</span> <span style="font-size:.7rem;color:var(--text-dim);">${x.maquina?.codigo?'· '+esc(x.maquina.codigo):''} ${x.responsavel?.nome?'· '+esc(x.responsavel.nome):''}</span></div>
                    <span style="font-size:.72rem;font-weight:700;color:${corS[x.status]};">${this._ESTAGIOS[x.status]}${x.eficaz===false?' (ineficaz)':''}</span>
                </div>
                <div style="font-size:.72rem;color:var(--text-dim);margin-top:4px;">prioridade ${x.prioridade}${x.prazo?` · prazo ${new Date(x.prazo).toLocaleDateString('pt-BR')}${atrasada?' <span style="color:#f06292;font-weight:700;">ATRASADA</span>':''}`:''}</div>
            </div>`; }).join('') : `<div class="summary-card" style="text-align:center;padding:24px;color:var(--text-dim);">Nenhuma RNC. Elas abrem sozinhas quando um gatilho dispara, ou crie manualmente.</div>`;
        pan.innerHTML = `
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">${kpis}</div>
            <div style="margin-bottom:12px;"><button class="btn secondary" style="font-size:.78rem;" onclick="mf.novaRnc()">+ Nova RNC manual</button></div>
            ${lista}`;
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
    async renderPainel() {
        const pan = $('mf-pan-painel');
        pan.innerHTML = `<div style="color:var(--text-dim);padding:12px;">Carregando painel...</div>`;
        const [kpi, al, metas] = await Promise.all([api.get('/api/mf/painel'), api.get('/api/mf/alertas'), api.get('/api/mf/metas')]);
        if (!kpi) { pan.innerHTML = `<div class="summary-card" style="padding:24px;color:#f06292;">Painel indisponível — rode os SQLs pendentes (mes_metas.sql).</div>`; return; }
        const brl = n => 'R$ ' + Number(n||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const card = (cor, val, lbl, aba) => `<div onclick="${aba?`mf.tab('${aba}')`:''}" style="background:${cor}14;border:1px solid ${cor}3a;border-radius:12px;padding:16px 20px;text-align:center;flex:1;min-width:130px;${aba?'cursor:pointer;':''}">
            <div style="font-size:1.7rem;font-weight:800;color:${cor};">${val}</div><div style="font-size:.66rem;color:${cor};letter-spacing:.05em;">${lbl}</div></div>`;
        const k = kpi;
        const kpis = [
            card('#26c6da', k.oee_medio != null ? k.oee_medio + '%' : '—', 'OEE MÉDIO', 'ind'),
            card('#f06292', brl(k.cnq_total), 'CUSTO DA QUALIDADE', 'cnq'),
            card('#7c4dff', k.ncs, 'NÃO CONFORMIDADES', 'ncs'),
            card(k.rncs_atrasadas ? '#ff5252' : '#ffca28', k.rncs_abertas + (k.rncs_atrasadas?` (${k.rncs_atrasadas}⚠)`:''), 'RNCs ABERTAS', 'rnc'),
            card('#ef6c00', k.etiquetas_abertas, 'ETIQUETAS ABERTAS', 'etiq'),
            card('#26a69a', k.sessoes_abertas, 'SESSÕES ATIVAS', 'apont'),
        ].join('');
        const corSev = { alta:'#f06292', media:'#ffca28', baixa:'#8b949e' };
        const alertas = (al?.alertas || []);
        const alertasHtml = alertas.length ? alertas.map(a => `<div onclick="mf.tab('${a.aba}')" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;background:${corSev[a.sev]}12;border-left:3px solid ${corSev[a.sev]};margin-bottom:6px;cursor:pointer;">
            <span style="font-size:.62rem;font-weight:700;color:${corSev[a.sev]};border:1px solid ${corSev[a.sev]}55;border-radius:4px;padding:1px 6px;">${a.modulo}</span>
            <span style="font-size:.82rem;">${esc(a.msg)}</span></div>`).join('')
            : `<div style="text-align:center;padding:20px;color:#26a69a;">✓ Nenhum alerta — tudo dentro das metas.</div>`;
        const metasHtml = (metas || []).map(m => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);">
            <span style="font-size:.8rem;">${esc(m.descricao||m.chave)}</span>
            <input type="number" step="0.01" value="${m.valor}" id="mf-meta-${m.chave}" onchange="mf.salvarMeta('${m.chave}')"
                style="width:90px;padding:4px 8px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.8rem;text-align:right;"></div>`).join('');
        pan.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;">${kpis}</div>
            <div class="summary-card" style="margin-bottom:18px;">
                <div class="s-label" style="margin-bottom:12px;">⚠ ALERTAS — O QUE EXIGE AÇÃO ${alertas.length?`(${alertas.length})`:''}</div>
                ${alertasHtml}
            </div>
            <div class="summary-card">
                <div class="s-label" style="margin-bottom:8px;">🎯 METAS</div>
                ${metasHtml || '<div style="color:var(--text-dim);">Rode mes_metas.sql para configurar metas.</div>'}
            </div>`;
    },
    async salvarMeta(chave) {
        const v = parseFloat($('mf-meta-' + chave).value);
        const r = await api.put('/api/mf/metas/' + chave, { valor: v });
        toast(r?.ok ? 'Meta salva.' : 'Erro ao salvar meta.', r?.ok ? 'ok' : 'erro');
        if (r?.ok) this.renderPainel();
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
        const linha = (v, cor, dash, lbl) => v == null ? '' : `<line x1="${pad}" y1="${y(v).toFixed(1)}" x2="${W-pad}" y2="${y(v).toFixed(1)}" stroke="${cor}" stroke-width="1" stroke-dasharray="${dash}"/><text x="${W-pad+2}" y="${y(v).toFixed(1)+3}" fill="${cor}" font-size="9">${lbl} ${Number(v).toFixed(0)}</text>`;
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
        const ets = await api.get('/api/mf/etiquetas');
        if (ets === null) { wrap.innerHTML = `<div class="summary-card" style="padding:20px;color:#f06292;">TPM indisponível — rode mes_tpm.sql.</div>`; return; }
        if (!ets.length) { wrap.innerHTML = `<div class="summary-card" style="text-align:center;padding:24px;color:var(--text-dim);">Nenhuma etiqueta aberta.</div>`; return; }
        const corG = { baixa:'#8b949e', media:'#ffca28', alta:'#f06292' };
        wrap.innerHTML = `<div class="s-label" style="margin:6px 0 12px;">ETIQUETAS ABERTAS (${ets.length})</div>` + ets.map(e => `
            <div class="summary-card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:12px;">
                    ${e.foto_url ? `<img src="${e.foto_url}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="window.open().document.write('<img src=\\'' + this.src + '\\'>')">` : ''}
                    <div><div style="font-weight:600;">${esc(e.maquina?.codigo||'')} <span style="font-size:.7rem;color:${corG[e.gravidade]};">● ${e.gravidade}</span> <span style="font-size:.72rem;color:var(--text-dim);">${e.tipo.replace('_',' ')}</span></div>
                    <div style="font-size:.82rem;color:#ccc;">${esc(e.descricao)}</div>
                    <div style="font-size:.68rem;color:var(--text-dim);">${esc(e.operador?.nome||'')} · ${new Date(e.aberta_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}${e.status==='em_tratativa'?' · <span style="color:#26c6da;">em tratativa</span>':''}</div></div>
                </div>
                <div style="display:flex;gap:6px;">
                    ${e.status==='aberta' ? `<button class="btn secondary" style="font-size:.74rem;" onclick="mf.gerarOmDeEtiqueta('${e.id}','${e.maquina_id}','${esc(e.descricao).replace(/'/g,"\\'")}')">Gerar OM</button>` : ''}
                    <button class="btn secondary" style="font-size:.74rem;color:#26a69a;border-color:rgba(38,166,154,.4);" onclick="mf.resolverEtiqueta('${e.id}')">✓ Resolver</button>
                </div>
            </div>`).join('');
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
    async _listarOms() {
        const wrap = $('mf-om-lista'); if (!wrap) return;
        const oms = await api.get('/api/mf/oms');
        if (oms === null) { wrap.innerHTML = `<div class="summary-card" style="padding:20px;color:#f06292;">TPM indisponível — rode mes_tpm.sql.</div>`; return; }
        if (!oms.length) { wrap.innerHTML = `<div class="summary-card" style="text-align:center;padding:24px;color:var(--text-dim);">Nenhuma ordem de manutenção.</div>`; return; }
        const corS = { aberta:'#ffca28', planejada:'#26c6da', em_execucao:'#7c4dff', concluida:'#26a69a', cancelada:'#8b949e' };
        wrap.innerHTML = `<div class="s-label" style="margin:6px 0 12px;">ORDENS (${oms.length})</div>` + oms.map(o => `
            <div class="summary-card" style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                    <div><span style="font-weight:700;color:var(--indigo-primary);">${esc(o.maquina?.codigo||'')}</span>
                        <span style="font-size:.72rem;color:var(--text-dim);"> · ${o.tipo} · ${o.prioridade}${o.executor?.nome?` · ${esc(o.executor.nome)}`:''}</span></div>
                    <span style="font-size:.72rem;font-weight:700;color:${corS[o.status]};">${o.status.replace('_',' ').toUpperCase()}${o.tempo_reparo_min!=null?` · ${o.tempo_reparo_min} min`:''}</span>
                </div>
                <div style="font-size:.84rem;color:#ccc;margin-bottom:8px;">${esc(o.descricao)}${o.causa?`<div style="font-size:.74rem;color:var(--text-dim);">causa: ${esc(o.causa)} · ação: ${esc(o.acao_realizada||'')}</div>`:''}</div>
                <div style="display:flex;gap:6px;">
                    ${o.status==='aberta'||o.status==='planejada' ? `<button class="btn secondary" style="font-size:.74rem;" onclick="mf.iniciarOm('${o.id}')">▶ Iniciar</button>` : ''}
                    ${o.status==='em_execucao' ? `<button class="btn primary" style="font-size:.74rem;" onclick="mf.concluirOm('${o.id}')">✓ Concluir</button>` : ''}
                </div>
            </div>`).join('');
    },
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
