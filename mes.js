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
        this.tab('apont');
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
        ['apont','ncs','ind','import'].forEach(t => { const p = $('mf-pan-' + t); if (p) p.style.display = t === name ? 'block' : 'none'; });
        if (name === 'apont')  this.renderApont();
        if (name === 'ncs')    this.renderNcs();
        if (name === 'ind')    this.renderInd();
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
