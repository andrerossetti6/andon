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

// ── App principal ────────────────────────────────────────────────────────────
const mf = {
    _cad: { produtos:[], maquinas:[], operadores:[], turnos:[], motivos:[], defeitos:[], ops:[] },
    _abertas: [],
    _abaImport: null,

    async init() {
        // restaura estados de menu colapsado
        document.querySelectorAll('.has-sub[id]').forEach(li => { if (localStorage.getItem('nav-grp-' + li.id) === '1') li.classList.add('nav-collapsed'); });
        document.querySelectorAll('.nav-section-header[data-key]').forEach(h3 => { if (localStorage.getItem('nav-sec-' + h3.dataset.key) === '1') h3.closest('.nav-section')?.classList.add('nav-section-collapsed'); });

        if (!localStorage.getItem(TOKEN_KEY)) return this._mostrarLogin();
        // valida token buscando cadastros
        const ok = await this._carregarCadastros();
        if (ok === false) return this._mostrarLogin();
        this._mostrarApp();
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
        return true;
    },

    tab(name) {
        // destaca o item correspondente na sidebar
        document.querySelectorAll('#app-sidebar [data-mftab]').forEach(li => li.classList.toggle('active', li.dataset.mftab === name));
        ['apont','ncs','import'].forEach(t => { const p = $('mf-pan-' + t); if (p) p.style.display = t === name ? 'block' : 'none'; });
        if (name === 'apont')  this.renderApont();
        if (name === 'ncs')    this.renderNcs();
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
        $('mf-pan-apont').innerHTML = novaSessao + `<div id="mf-sessoes"><div style="color:var(--text-dim);padding:12px;">Carregando sessões...</div></div>`;
        await this.renderSessoes();
    },

    async iniciarSessao() {
        const b = { op_id: $('mf-op').value, maquina_id: $('mf-maq').value, operador_id: $('mf-oper').value, turno_id: $('mf-turno').value,
            dispositivo_id: navigator.userAgent.slice(0, 60) };
        if (!b.op_id || !b.maquina_id || !b.operador_id || !b.turno_id) return toast('Preencha OP, máquina, operador e turno.', 'erro');
        const r = await api.post('/api/mf/apontamentos', b);
        if (!r?.ok) return toast('Erro ao iniciar: ' + (r?.erro || 'falha'), 'erro');
        toast('Sessão iniciada.'); await this.renderSessoes();
    },

    async renderSessoes() {
        const wrap = $('mf-sessoes'); if (!wrap) return;
        const abertas = await api.get('/api/mf/apontamentos?abertas=1') || [];
        this._abertas = abertas;
        if (!abertas.length) { wrap.innerHTML = `<div class="summary-card" style="color:var(--text-dim);text-align:center;padding:28px;">Nenhuma sessão aberta. Inicie uma acima.</div>`; return; }
        wrap.innerHTML = `<div class="s-label" style="margin:6px 0 12px;">SESSÕES ABERTAS (${abertas.length})</div>` + abertas.map(a => {
            const dur = Math.max(0, Math.round((Date.now() - new Date(a.datahora_inicio).getTime()) / 60000));
            const ncs = (a.nao_conformidade || []).length;
            const paradas = (a.parada || []).filter(p => !p.datahora_fim).length;
            return `<div class="summary-card" style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;">
                    <div><span style="font-weight:700;color:var(--indigo-primary);">${esc(a.op?.numero||'OP')}</span>
                        <span style="color:var(--text-dim);font-size:.82rem;"> · ${esc(a.maquina?.codigo||'')} · ${esc(a.operador?.nome||'')} · turno ${esc(a.turno?.codigo||'')}</span></div>
                    <span style="font-size:.72rem;color:var(--text-dim);">há ${dur} min${ncs?` · <span style="color:#f06292;">${ncs} NC</span>`:''}${paradas?` · <span style="color:#ffca28;">${paradas} parada aberta</span>`:''}</span>
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
        const r = await api.put('/api/mf/apontamentos/' + id, {
            qtd_boa: parseFloat($('mf-qb-' + id).value) || 0,
            qtd_refugo: parseFloat($('mf-qr-' + id).value) || 0,
            qtd_retrabalho: parseFloat($('mf-qt-' + id).value) || 0,
        });
        toast(r?.ok ? 'Quantidades salvas.' : 'Erro ao salvar.', r?.ok ? 'ok' : 'erro');
    },

    async fecharSessao(id) {
        await this.salvarQtd(id);
        const r = await api.put('/api/mf/apontamentos/' + id, { fechar: true });
        if (!r?.ok) return toast('Erro ao fechar.', 'erro');
        toast('Sessão fechada.'); this.renderSessoes();
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
        const r = await api.post('/api/mf/paradas', { apontamento_id: apId, motivo_id: $('mf-mot').value, observacao: $('mf-mot-obs').value || null });
        if (!r?.ok) return toast('Erro ao registrar parada.', 'erro');
        this._fecharModal(); toast('Parada registrada.'); this.renderSessoes();
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
        const r = await api.post('/api/mf/ncs', {
            apontamento_id: apId, defeito_id: $('mf-nc-def').value, qtd_afetada: qtd, unidade: 'kg',
            disposicao: $('mf-nc-disp').value, posicao: $('mf-nc-pos').value || null, causa_preliminar: $('mf-nc-causa').value || null,
        });
        if (!r?.ok) return toast('Erro ao salvar NC: ' + (r?.erro || ''), 'erro');
        if (this._fotoData) {
            await api.post('/api/mf/fotos', { nc_id: r.nc.id, url: this._fotoData.url, nome_arquivo: this._fotoData.nome,
                tamanho_bytes: this._fotoData.bytes, largura_px: this._fotoData.w, altura_px: this._fotoData.h });
            this._fotoData = null;
        }
        this._fecharModal();
        toast(r.gera_rnc ? '⚠ NC salva — GATILHO DE RNC disparado!' : 'NC registrada.', r.gera_rnc ? 'aviso' : 'ok');
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
    renderImport() {
        $('mf-pan-import').innerHTML = `
        <div class="summary-card" style="margin-bottom:18px;">
            <div class="s-label" style="margin-bottom:8px;">IMPORTAR DEFEITOS DO LEGADO</div>
            <p style="font-size:.8rem;color:var(--text-dim);margin-bottom:14px;">Suba a planilha (CSV/XLS). Cada linha vai para a staging e o defeito é traduzido pelo de-para (exato → fuzzy). O que não traduzir fica como <b>rejeitado</b> para classificação manual.</p>
            <input id="mf-imp-file" type="file" accept=".csv,.xls,.xlsx" class="mf-input" style="margin-bottom:12px;" onchange="mf._lerArquivo(event)">
            <div id="mf-imp-cfg" style="display:none;">
                <span class="mf-label">COLUNA DO DEFEITO (texto livre)</span>
                <select id="mf-imp-col" class="mf-input" style="max-width:320px;margin-bottom:12px;"></select>
                <div><button class="btn primary" onclick="mf.importar()">Importar para staging</button>
                     <span id="mf-imp-info" style="margin-left:12px;font-size:.78rem;color:var(--text-dim);"></span></div>
            </div>
        </div>
        <div id="mf-imp-result"></div>`;
        this._impLinhas = null;
    },

    _lerArquivo(ev) {
        const file = ev.target.files?.[0]; if (!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        const aplicar = (linhas) => {
            this._impLinhas = linhas;
            const cols = Object.keys(linhas[0] || {});
            const sel = $('mf-imp-col');
            // tenta achar coluna que pareça defeito
            const pref = cols.find(c => /defeit|ocorr|problema|descri|motivo/i.test(c)) || cols[0];
            sel.innerHTML = cols.map(c => `<option value="${esc(c)}"${c===pref?' selected':''}>${esc(c)}</option>`).join('');
            $('mf-imp-cfg').style.display = 'block';
            $('mf-imp-info').textContent = `${linhas.length} linhas lidas`;
        };
        if (ext === 'csv') {
            Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => aplicar(r.data) });
        } else {
            const reader = new FileReader();
            reader.onload = e => {
                const wb = XLSX.read(e.target.result, { type: 'array' });
                const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                aplicar(linhas);
            };
            reader.readAsArrayBuffer(file);
        }
    },

    async importar() {
        if (!this._impLinhas?.length) return toast('Selecione um arquivo.', 'erro');
        const campo = $('mf-imp-col').value;
        const r = await api.post('/api/mf/importar', { linhas: this._impLinhas, campo_defeito: campo });
        if (!r?.ok) return toast('Erro ao importar: ' + (r?.erro || ''), 'erro');
        toast(`Importado: ${r.validos} válidos, ${r.rejeitados} rejeitados.`, r.rejeitados ? 'aviso' : 'ok');
        const rows = await api.get('/api/mf/importacao/' + r.lote_id) || [];
        const defMap = Object.fromEntries(this._cad.defeitos.map(d => [d.id, d.codigo + ' — ' + d.descricao]));
        $('mf-imp-result').innerHTML = `
            <div class="s-label" style="margin:6px 0 12px;">RESULTADO DO LOTE — ${r.total} linhas · ${r.validos} válidas · ${r.rejeitados} rejeitadas</div>
            <div class="summary-card" style="padding:0;overflow:hidden;max-height:420px;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:.8rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.66rem;position:sticky;top:0;background:var(--bg-card);">
                <th style="padding:8px;text-align:left;">#</th><th style="padding:8px;text-align:left;">TEXTO LEGADO</th>
                <th style="padding:8px;text-align:left;">→ DEFEITO</th><th style="padding:8px;text-align:center;">MÉTODO</th><th style="padding:8px;text-align:center;">STATUS</th>
            </tr></thead><tbody>${rows.map(row => {
                const txt = row.linha_bruta?.[$('mf-imp-col').value] ?? Object.values(row.linha_bruta||{})[0] ?? '';
                const cor = row.status === 'valido' ? '#26a69a' : '#f06292';
                return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                    <td style="padding:7px 8px;color:var(--text-dim);">${row.linha_origem}</td>
                    <td style="padding:7px 8px;">${esc(String(txt).slice(0,50))}</td>
                    <td style="padding:7px 8px;">${row.defeito_id ? esc(defMap[row.defeito_id]||'?') : '<span style="color:#f06292;">— não traduzido</span>'}</td>
                    <td style="padding:7px 8px;text-align:center;color:var(--text-dim);">${row.metodo_traducao||'—'}${row.confianca?` (${row.confianca})`:''}</td>
                    <td style="padding:7px 8px;text-align:center;color:${cor};font-weight:700;">${row.status}</td>
                </tr>`;
            }).join('')}</tbody></table></div>`;
    },

    // ── Modal ──
    _modal(html) { $('mf-modal-body').innerHTML = html; $('mf-modal').style.display = 'flex'; },
    _fecharModal() { $('mf-modal').style.display = 'none'; this._fotoData = null; },
};

// fecha modal ao clicar fora
document.addEventListener('click', e => { if (e.target.id === 'mf-modal') mf._fecharModal(); });
document.addEventListener('DOMContentLoaded', () => mf.init());
