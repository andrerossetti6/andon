// ═══════════════════════════════════════════════════════════════════════════
// APS — Planejamento Avançado & Sequenciamento (Gestão Stoll)
// Terceiro sistema, independente do SIGS (app.js) e do MES (mes.js).
// Compartilha só o servidor, o Supabase e o tema (style.css). Lê os dados via
// API (/api/*, /api/mf/*) — não escreve nada nos outros sistemas.
// ═══════════════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const TOKEN_KEY = 'sin1_token';
const fmt = n => (Number(n) || 0).toLocaleString('pt-BR');
const fmt1 = n => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function toast(msg, tipo = 'ok') {
    let el = $('aps-toast');
    if (!el) { el = document.createElement('div'); el.id = 'aps-toast';
        el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2000;padding:11px 20px;border-radius:8px;font-size:.84rem;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,.4);transition:opacity .3s;';
        document.body.appendChild(el); }
    const cor = tipo === 'erro' ? '#f06292' : tipo === 'aviso' ? '#ffab76' : '#26a69a';
    el.style.background = 'rgba(18,22,32,.96)'; el.style.border = `1px solid ${cor}`; el.style.color = cor;
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 3200);
}

const api = {
    _h() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') }; },
    async get(url) { try { const r = await fetch(url, { headers: this._h() }); if (r.status === 401) return aps._expirou(); return r.ok ? r.json() : null; } catch { return null; } },
};

// Sidebar: colapsar seções (mesmo comportamento do SIGS/MES)
function toggleNavSection(h3) {
    const s = h3.closest('.nav-section'); if (!s) return;
    s.classList.toggle('nav-section-collapsed');
    localStorage.setItem('nav-sec-' + (h3.dataset.key || 'sec'), s.classList.contains('nav-section-collapsed') ? '1' : '0');
}

// Rótulos e cores de status de OP
const STATUS = {
    planejada:   { label: 'Planejada',    cor: '#8b949e' },
    liberada:    { label: 'Liberada',     cor: '#26c6da' },
    em_producao: { label: 'Em produção',  cor: '#ffca28' },
    concluida:   { label: 'Concluída',    cor: '#26a69a' },
    cancelada:   { label: 'Cancelada',    cor: '#f06292' },
};
const PROC_LABEL = { tecelagem:'Tecelagem', costura_auto:'Costura Automática', costura_manual:'Costura Manual', soldagem:'Soldagem', silicone:'Silicone', passadoria:'Passadoria', embalagem:'Embalagem' };

const hojeISO = () => new Date().toISOString().slice(0, 10);
function diasAte(dataStr) {   // dias do hoje até a data (negativo = atrasado)
    if (!dataStr) return null;
    const d = new Date(String(dataStr).slice(0, 10) + 'T00:00:00');
    const h = new Date(hojeISO() + 'T00:00:00');
    return Math.round((d - h) / 86400000);
}

const aps = {
    _ops: [], _maquinas: [], _cap: [], _procs: [], _produtos: [],
    _carteiraBusca: '', _carteiraStatus: '', _carteiraSort: 'prazo',

    async init() {
        document.querySelectorAll('.nav-section-header[data-key]').forEach(h3 => {
            if (localStorage.getItem('nav-sec-' + h3.dataset.key) === '1') h3.closest('.nav-section')?.classList.add('nav-section-collapsed');
        });
        // login por link: ?token=... (abre sem digitar senha)
        const urlTok = new URLSearchParams(location.search).get('token');
        if (urlTok) { localStorage.setItem(TOKEN_KEY, urlTok); try { history.replaceState({}, document.title, location.pathname); } catch {} }

        if (!localStorage.getItem(TOKEN_KEY)) return this._mostrarLogin();
        const ok = await this._carregar();
        if (ok === false) return this._mostrarLogin();
        this._mostrarApp();
    },

    _mostrarLogin() {
        $('view-login').style.display = 'flex';
        $('app-sidebar').style.display = 'none';
        $('view-aps').style.display = 'none';
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
        $('view-aps').style.display = 'flex';
        try { const n = JSON.parse(localStorage.getItem('sin1_usuario'))?.nome || '';
            $('aps-user').textContent = n; const sn = $('aps-user-nome'); if (sn) sn.textContent = n || '—'; } catch {}
        this.tab('painel');
    },

    _expirou() { localStorage.removeItem(TOKEN_KEY); toast('Sessão expirada — faça login.', 'erro'); this._mostrarLogin(); return null; },
    sair() { localStorage.removeItem(TOKEN_KEY); location.reload(); },

    async _carregar() {
        const [ops, maquinas, cap, procs, produtos] = await Promise.all([
            api.get('/api/mf/ops'), api.get('/api/maquinas-unificado'), api.get('/api/capacidade-config'),
            api.get('/api/processos-config'), api.get('/api/mf/produtos'),
        ]);
        if (ops === null && maquinas === null) return false;   // 401/sem conexão
        this._ops = Array.isArray(ops) ? ops : [];
        this._maquinas = Array.isArray(maquinas) ? maquinas : [];
        this._cap = Array.isArray(cap) ? cap : [];
        this._procs = Array.isArray(procs) ? procs : [];
        this._produtos = Array.isArray(produtos) ? produtos : [];
        return true;
    },

    async recarregar() {
        toast('Atualizando…', 'aviso');
        await this._carregar();
        this.tab(this._tab || 'painel');
        toast('Dados atualizados.');
    },

    tab(nome) {
        this._tab = nome;
        ['painel','carteira','capac','seq','maquinas','config'].forEach(t => {
            const pan = $('aps-pan-' + t); if (pan) pan.style.display = t === nome ? 'block' : 'none';
            const li = $('nav-' + (t === 'capac' ? 'capac' : t)); // ids batem
        });
        document.querySelectorAll('[data-apstab]').forEach(li => li.classList.toggle('active', li.dataset.apstab === nome));
        ({ painel:'_renderPainel', carteira:'_renderCarteira', capac:'_renderCapac', seq:'_renderSeq', maquinas:'_renderMaquinas', config:'_renderConfig' })[nome]
            && this[({ painel:'_renderPainel', carteira:'_renderCarteira', capac:'_renderCapac', seq:'_renderSeq', maquinas:'_renderMaquinas', config:'_renderConfig' })[nome]]();
    },

    // ── util de capacidade ──
    _capHoras(dias = 22) {   // capacidade nominal por processo em h/mês
        const out = {};
        this._cap.forEach(c => { out[c.processo] = (Number(c.maquinas)||0) * (Number(c.horas_dia)||0) * dias * (Math.min(Number(c.oee)||100,100)/100); });
        return out;
    },

    // ═══ PAINEL ═══
    _renderPainel() {
        const el = $('aps-pan-painel');
        const ativas = this._ops.filter(o => o.status !== 'concluida' && o.status !== 'cancelada');
        const emProd = this._ops.filter(o => o.status === 'em_producao').length;
        const atrasadas = ativas.filter(o => (diasAte(o.data_prevista) ?? 99) < 0);
        const teares = this._maquinas.filter(m => /stoll/i.test(m.id_maquina||'') || (m.modelo && /^\d/.test(String(m.modelo))));
        const maqAtivas = this._maquinas.filter(m => String(m.status||'').toLowerCase() !== 'inativo').length;
        const capH = this._capHoras();
        const capTotal = Object.values(capH).reduce((s,v)=>s+v,0);
        const qtdAtiva = ativas.reduce((s,o)=>s+(Number(o.qtd_planejada)||0),0);

        // distribuição por status
        const porStatus = {};
        this._ops.forEach(o => { porStatus[o.status] = (porStatus[o.status]||0)+1; });

        // próximas 8 entregas (ativas, por prazo)
        const prox = [...ativas].filter(o=>o.data_prevista).sort((a,b)=>new Date(a.data_prevista)-new Date(b.data_prevista)).slice(0,8);

        const kpi = (label, val, sub, cor) => `<div class="summary-card" style="border-top:3px solid ${cor};">
            <span class="s-label">${label}</span>
            <span class="s-value" style="color:${cor};font-size:1.7rem;">${val}</span>
            <span class="s-sub">${sub}</span></div>`;

        el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:18px;">
            ${kpi('CARTEIRA ATIVA', fmt(ativas.length), `${fmt(qtdAtiva)} peças a produzir`, '#26c6da')}
            ${kpi('EM PRODUÇÃO', fmt(emProd), 'OPs em execução', '#ffca28')}
            ${kpi('ATRASADAS', fmt(atrasadas.length), atrasadas.length ? 'prazo vencido' : 'nenhuma no vermelho', atrasadas.length ? '#f06292' : '#26a69a')}
            ${kpi('MÁQUINAS ATIVAS', fmt(maqAtivas), `${teares.length} teares Stoll`, '#7c4dff')}
            ${kpi('CAPACIDADE NOMINAL', fmt1(capTotal) + ' h', 'por mês (todos os processos)', '#26a69a')}
        </div>

        <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:18px;margin-bottom:18px;">
            <div class="summary-card">
                <div class="s-label" style="margin-bottom:12px;">PRÓXIMAS ENTREGAS</div>
                ${prox.length ? `<table style="width:100%;border-collapse:collapse;">
                    <thead><tr><th class="aps-th">OP</th><th class="aps-th">PRODUTO</th><th class="aps-th" style="text-align:right;">QTD</th><th class="aps-th">PRAZO</th><th class="aps-th">STATUS</th></tr></thead>
                    <tbody>${prox.map(o => {
                        const d = diasAte(o.data_prevista);
                        const prazoCor = d < 0 ? '#f06292' : d <= 3 ? '#ffca28' : 'var(--text-dim)';
                        const prazoTxt = d < 0 ? `${Math.abs(d)}d atrasada` : d === 0 ? 'hoje' : `em ${d}d`;
                        const st = STATUS[o.status] || { label:o.status, cor:'#8b949e' };
                        return `<tr>
                            <td class="aps-td" style="font-weight:700;color:var(--indigo-primary);">${esc(o.numero)}</td>
                            <td class="aps-td">${esc((o.produto?.descricao||o.produto?.codigo||'—')).slice(0,34)}</td>
                            <td class="aps-td" style="text-align:right;">${fmt(o.qtd_planejada)} ${esc(o.unidade||'')}</td>
                            <td class="aps-td" style="color:${prazoCor};white-space:nowrap;">${new Date(o.data_prevista).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} · ${prazoTxt}</td>
                            <td class="aps-td"><span style="color:${st.cor};font-weight:600;font-size:.74rem;">${st.label}</span></td>
                        </tr>`;
                    }).join('')}</tbody></table>` : `<div style="padding:24px;text-align:center;color:var(--text-dim);">Sem OPs com prazo definido.</div>`}
            </div>
            <div class="summary-card">
                <div class="s-label" style="margin-bottom:12px;">CARTEIRA POR STATUS</div>
                ${Object.entries(porStatus).sort((a,b)=>b[1]-a[1]).map(([s,n]) => {
                    const st = STATUS[s] || { label:s, cor:'#8b949e' };
                    const pct = Math.round(n / this._ops.length * 100);
                    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;">
                        <div style="width:120px;font-size:.78rem;color:${st.cor};font-weight:600;">${st.label}</div>
                        <div style="flex:1;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${st.cor};border-radius:4px;"></div></div>
                        <div style="width:64px;text-align:right;font-size:.8rem;font-weight:700;">${fmt(n)} <span style="color:var(--text-dim);font-weight:400;font-size:.7rem;">${pct}%</span></div>
                    </div>`;
                }).join('')}
                <div style="margin-top:14px;font-size:.72rem;color:var(--text-dim);">Total: <strong style="color:var(--text-primary);">${fmt(this._ops.length)}</strong> OPs no sistema · <strong style="color:var(--text-primary);">${fmt(this._produtos.length)}</strong> produtos catalogados</div>
            </div>
        </div>

        <div class="summary-card">
            <div class="s-label" style="margin-bottom:12px;">CAPACIDADE NOMINAL POR PROCESSO <span style="color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0;">· h/mês (22 dias úteis · OEE nominal do cadastro)</span></div>
            ${Object.entries(capH).sort((a,b)=>b[1]-a[1]).map(([p,h]) => {
                const max = Math.max(...Object.values(capH), 1);
                return `<div style="display:flex;align-items:center;gap:12px;padding:5px 0;">
                    <div style="width:170px;font-size:.8rem;font-weight:600;">${PROC_LABEL[p] || p}</div>
                    <div style="flex:1;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;"><div style="width:${Math.round(h/max*100)}%;height:100%;background:var(--indigo-primary);border-radius:4px;"></div></div>
                    <div style="width:90px;text-align:right;font-size:.8rem;font-weight:700;color:var(--indigo-primary);">${fmt1(h)} h</div>
                </div>`;
            }).join('')}
            <div style="margin-top:10px;font-size:.7rem;color:var(--text-dim);">A carga real (carga ÷ capacidade → gargalo) é calculada no SIGS › Gargalo (TOC) e no Plano de Produção, sobre os tempos do Banco de Dados.</div>
        </div>`;
    },

    // ═══ CARTEIRA DE ORDENS ═══
    _renderCarteira() {
        const el = $('aps-pan-carteira');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;padding:12px 16px;">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <input class="aps-input" style="flex:1;min-width:180px;max-width:320px;" placeholder="Buscar OP, código ou descrição…" value="${esc(this._carteiraBusca)}" oninput="aps._carteiraBusca=this.value;aps._renderCarteiraTabela()">
                <select class="aps-input" style="width:auto;" onchange="aps._carteiraStatus=this.value;aps._renderCarteiraTabela()">
                    <option value="">Todos os status</option>
                    ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}"${this._carteiraStatus===k?' selected':''}>${v.label}</option>`).join('')}
                </select>
                <select class="aps-input" style="width:auto;" onchange="aps._carteiraSort=this.value;aps._renderCarteiraTabela()">
                    <option value="prazo"${this._carteiraSort==='prazo'?' selected':''}>Ordenar: prazo (EDD)</option>
                    <option value="prioridade"${this._carteiraSort==='prioridade'?' selected':''}>Ordenar: prioridade</option>
                    <option value="qtd"${this._carteiraSort==='qtd'?' selected':''}>Ordenar: quantidade</option>
                    <option value="numero"${this._carteiraSort==='numero'?' selected':''}>Ordenar: nº da OP</option>
                </select>
            </div>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div id="aps-carteira-tabela"></div></div>`;
        this._renderCarteiraTabela();
    },
    _carteiraFiltrada() {
        const q = this._carteiraBusca.trim().toLowerCase();
        let rows = this._ops.filter(o => {
            if (this._carteiraStatus && o.status !== this._carteiraStatus) return false;
            if (!q) return true;
            return String(o.numero||'').toLowerCase().includes(q)
                || String(o.produto?.codigo||'').toLowerCase().includes(q)
                || String(o.produto?.descricao||'').toLowerCase().includes(q);
        });
        const s = this._carteiraSort;
        rows.sort((a,b) => {
            if (s === 'qtd') return (Number(b.qtd_planejada)||0) - (Number(a.qtd_planejada)||0);
            if (s === 'prioridade') return (Number(b.prioridade)||0) - (Number(a.prioridade)||0);
            if (s === 'numero') return String(a.numero||'').localeCompare(String(b.numero||''), 'pt-BR', { numeric: true });
            // prazo (EDD): sem prazo vai pro fim
            const da = a.data_prevista ? new Date(a.data_prevista).getTime() : Infinity;
            const db = b.data_prevista ? new Date(b.data_prevista).getTime() : Infinity;
            return da - db;
        });
        return rows;
    },
    _renderCarteiraTabela() {
        const el = $('aps-carteira-tabela'); if (!el) return;
        const rows = this._carteiraFiltrada();
        if (!rows.length) { el.innerHTML = `<div style="padding:28px;text-align:center;color:var(--text-dim);">Nenhuma OP encontrada.</div>`; return; }
        el.innerHTML = `<div style="max-height:66vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;">
                <th class="aps-th">OP</th><th class="aps-th">CÓDIGO</th><th class="aps-th">PRODUTO</th>
                <th class="aps-th" style="text-align:right;">QTD</th><th class="aps-th">PRAZO</th><th class="aps-th">ETAPA</th><th class="aps-th">STATUS</th>
            </tr></thead><tbody>${rows.slice(0, 500).map((o,i) => {
                const d = diasAte(o.data_prevista);
                const atras = d != null && d < 0 && o.status !== 'concluida';
                const prazoCor = d == null ? 'var(--text-dim)' : atras ? '#f06292' : d <= 3 ? '#ffca28' : 'var(--text-primary)';
                const st = STATUS[o.status] || { label:o.status, cor:'#8b949e' };
                return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};">
                    <td class="aps-td" style="font-weight:700;color:var(--indigo-primary);white-space:nowrap;">${esc(o.numero)}${Number(o.prioridade)>0?` <span title="prioridade ${o.prioridade}" style="color:#ffab76;">★</span>`:''}</td>
                    <td class="aps-td">${esc(o.produto?.codigo||'—')}</td>
                    <td class="aps-td">${esc((o.produto?.descricao||'—')).slice(0,40)}</td>
                    <td class="aps-td" style="text-align:right;white-space:nowrap;">${fmt(o.qtd_planejada)} ${esc(o.unidade||'')}</td>
                    <td class="aps-td" style="color:${prazoCor};white-space:nowrap;">${o.data_prevista ? new Date(o.data_prevista).toLocaleDateString('pt-BR') : '—'}${atras?` <span style="font-size:.68rem;">(${Math.abs(d)}d)</span>`:''}</td>
                    <td class="aps-td" style="color:var(--text-dim);">${esc(o.etapa?.nome||'—')}</td>
                    <td class="aps-td"><span style="color:${st.cor};font-weight:600;font-size:.74rem;">${st.label}</span></td>
                </tr>`;
            }).join('')}</tbody></table></div>
            <div style="padding:8px 14px;font-size:.72rem;color:var(--text-dim);border-top:1px solid var(--border-color);">${fmt(rows.length)} OPs${rows.length>500?' (mostrando 500)':''} · ordenado por ${this._carteiraSort==='prazo'?'prazo (EDD — a mais urgente primeiro)':this._carteiraSort}</div>`;
    },

    // ═══ CAPACIDADE × CARGA ═══
    _renderCapac() {
        const el = $('aps-pan-capac');
        const capH = this._capHoras();
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:6px;">CAPACIDADE DISPONÍVEL POR PROCESSO</div>
            <p style="font-size:.78rem;color:var(--text-dim);margin-bottom:14px;">Horas/mês por processo (máquinas × horas/dia × 22 dias × OEE nominal). A <strong>carga</strong> (o quanto a carteira consome de cada um) exige os tempos-padrão do Banco de Dados — o cálculo do gargalo mora no <strong>SIGS › Gargalo (TOC)</strong>; aqui está a oferta de capacidade.</p>
            ${Object.entries(capH).sort((a,b)=>b[1]-a[1]).map(([p,h]) => {
                const c = this._cap.find(x=>x.processo===p) || {};
                const max = Math.max(...Object.values(capH), 1);
                return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-color);">
                    <div style="width:180px;font-size:.82rem;font-weight:600;">${PROC_LABEL[p]||p}</div>
                    <div style="flex:1;height:9px;background:var(--bg-input);border-radius:5px;overflow:hidden;"><div style="width:${Math.round(h/max*100)}%;height:100%;background:var(--indigo-primary);border-radius:5px;"></div></div>
                    <div style="width:100px;text-align:right;font-size:.82rem;font-weight:700;color:var(--indigo-primary);">${fmt1(h)} h/mês</div>
                    <div style="width:170px;text-align:right;font-size:.7rem;color:var(--text-dim);">${fmt(c.maquinas)} máq × ${fmt(c.horas_dia)}h × ${fmt(c.oee)}% OEE</div>
                </div>`;
            }).join('')}
        </div>`;
    },

    // ═══ SEQUENCIAMENTO (fila priorizada por EDD) ═══
    _renderSeq() {
        const el = $('aps-pan-seq');
        const fila = this._ops.filter(o => o.status !== 'concluida' && o.status !== 'cancelada')
            .sort((a,b) => {
                const pa = Number(a.prioridade)||0, pb = Number(b.prioridade)||0;
                if (pb !== pa) return pb - pa;                 // prioridade manual primeiro
                const da = a.data_prevista ? new Date(a.data_prevista).getTime() : Infinity;
                const db = b.data_prevista ? new Date(b.data_prevista).getTime() : Infinity;
                return da - db;                                 // depois EDD (menor prazo)
            });
        const atrasadas = fila.filter(o => (diasAte(o.data_prevista) ?? 99) < 0).length;
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;border-left:3px solid var(--indigo-primary);">
            <div class="s-label" style="margin-bottom:6px;">FILA SUGERIDA — regra EDD (menor prazo primeiro) + prioridade manual</div>
            <p style="font-size:.78rem;color:var(--text-dim);">Ordem de despacho recomendada para reduzir atraso. <strong style="color:${atrasadas?'#f06292':'#26a69a'};">${atrasadas} OP(s) já atrasada(s)</strong> — vão no topo. O <strong>sequenciamento fino por máquina/tear</strong> (Gantt de capacidade finita, com setup e OEE por recurso) está no SIGS › Linha do Tempo (Preactor); este painel dá a fila priorizada da carteira inteira.</p>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;">
            <div style="max-height:64vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;">
                <th class="aps-th" style="text-align:center;">#</th><th class="aps-th">OP</th><th class="aps-th">PRODUTO</th>
                <th class="aps-th" style="text-align:right;">QTD</th><th class="aps-th">PRAZO</th><th class="aps-th">STATUS</th>
            </tr></thead><tbody>${fila.slice(0,300).map((o,i) => {
                const d = diasAte(o.data_prevista);
                const atras = d != null && d < 0;
                const prazoCor = d == null ? 'var(--text-dim)' : atras ? '#f06292' : d <= 3 ? '#ffca28' : 'var(--text-primary)';
                const st = STATUS[o.status] || { label:o.status, cor:'#8b949e' };
                return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};">
                    <td class="aps-td" style="text-align:center;font-weight:700;color:var(--text-dim);">${i+1}</td>
                    <td class="aps-td" style="font-weight:700;color:var(--indigo-primary);white-space:nowrap;">${esc(o.numero)}${Number(o.prioridade)>0?' <span style="color:#ffab76;">★</span>':''}</td>
                    <td class="aps-td">${esc((o.produto?.descricao||o.produto?.codigo||'—')).slice(0,40)}</td>
                    <td class="aps-td" style="text-align:right;white-space:nowrap;">${fmt(o.qtd_planejada)} ${esc(o.unidade||'')}</td>
                    <td class="aps-td" style="color:${prazoCor};white-space:nowrap;">${o.data_prevista?new Date(o.data_prevista).toLocaleDateString('pt-BR'):'—'}${atras?` (${Math.abs(d)}d)`:''}</td>
                    <td class="aps-td"><span style="color:${st.cor};font-weight:600;font-size:.74rem;">${st.label}</span></td>
                </tr>`;
            }).join('')}</tbody></table></div>
        </div>`;
    },

    // ═══ MÁQUINAS & TEARES ═══
    _renderMaquinas() {
        const el = $('aps-pan-maquinas');
        const procNome = {}; this._procs.forEach(p => procNome[p.id] = p.nome);
        const rows = [...this._maquinas].sort((a,b) => String(a.id_maquina||'').localeCompare(String(b.id_maquina||''), 'pt-BR', { numeric:true }));
        const ativas = rows.filter(m => String(m.status||'').toLowerCase() !== 'inativo').length;
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;padding:12px 16px;">
            <span style="font-size:.8rem;color:var(--text-dim);"><strong style="color:var(--text-primary);">${rows.length}</strong> recursos cadastrados · <strong style="color:#26a69a;">${ativas}</strong> ativos</span>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:66vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;">
                <th class="aps-th">MÁQUINA</th><th class="aps-th">MODELO</th><th class="aps-th">PROCESSO</th>
                <th class="aps-th" style="text-align:right;">OEE</th><th class="aps-th">STATUS</th>
            </tr></thead><tbody>${rows.map((m,i) => {
                const inativa = String(m.status||'').toLowerCase() === 'inativo';
                return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};opacity:${inativa?.5:1};">
                    <td class="aps-td" style="font-weight:700;color:var(--indigo-primary);">${esc(m.id_maquina||'—')}</td>
                    <td class="aps-td">${m.modelo?`Stoll ${esc(m.modelo)}`:'—'}</td>
                    <td class="aps-td" style="color:var(--text-dim);">${esc(procNome[m.processo_id]||'—')}</td>
                    <td class="aps-td" style="text-align:right;font-weight:600;">${m.oee!=null?esc(m.oee)+'%':'—'}</td>
                    <td class="aps-td"><span style="color:${inativa?'#8b949e':'#26a69a'};font-weight:600;font-size:.74rem;">${esc(m.status||'Ativo')}</span></td>
                </tr>`;
            }).join('')}</tbody></table></div></div>`;
    },

    // ═══ CAPACIDADE (config, leitura) ═══
    _renderConfig() {
        const el = $('aps-pan-config');
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;padding:12px 16px;">
            <span style="font-size:.78rem;color:var(--text-dim);">Configuração de capacidade por processo (somente leitura). Edite no <strong>SIGS › Gargalo (TOC)</strong> — aqui o APS apenas consome.</span>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr><th class="aps-th">PROCESSO</th><th class="aps-th" style="text-align:right;">MÁQUINAS</th><th class="aps-th" style="text-align:right;">HORAS/DIA</th><th class="aps-th" style="text-align:right;">OEE</th><th class="aps-th" style="text-align:right;">CAP. h/mês</th></tr></thead>
            <tbody>${this._cap.map((c,i) => {
                const h = (Number(c.maquinas)||0)*(Number(c.horas_dia)||0)*22*(Math.min(Number(c.oee)||100,100)/100);
                return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};">
                    <td class="aps-td" style="font-weight:600;">${PROC_LABEL[c.processo]||c.processo}</td>
                    <td class="aps-td" style="text-align:right;">${fmt(c.maquinas)}</td>
                    <td class="aps-td" style="text-align:right;">${fmt(c.horas_dia)}</td>
                    <td class="aps-td" style="text-align:right;">${fmt(c.oee)}%</td>
                    <td class="aps-td" style="text-align:right;font-weight:700;color:var(--indigo-primary);">${fmt1(h)}</td>
                </tr>`;
            }).join('')}</tbody></table></div>`;
    },
};

document.addEventListener('DOMContentLoaded', () => aps.init());
