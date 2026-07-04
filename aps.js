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
    async post(url, b) { try { const r = await fetch(url, { method: 'POST', headers: this._h(), body: JSON.stringify(b) }); if (r.status === 401) return aps._expirou(); return r.json().catch(() => null); } catch { return null; } },
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
    pausada:     { label: 'Pausada',      cor: '#ffab76' },
    bloqueada:   { label: '⛔ Bloqueada', cor: '#ff5252' },
    concluida:   { label: 'Concluída',    cor: '#26a69a' },
    cancelada:   { label: 'Cancelada',    cor: '#f06292' },
};
const DISPOSICOES = ['refazer', 'retrabalhar', 'refugar', 'substituir', 'investigar'];
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
        const [ops, maquinas, cap, procs, produtos, maqMf] = await Promise.all([
            api.get('/api/mf/ops'), api.get('/api/maquinas-unificado'), api.get('/api/capacidade-config'),
            api.get('/api/processos-config'), api.get('/api/mf/produtos'), api.get('/api/mf/maquinas'),
        ]);
        if (ops === null && maquinas === null) return false;   // 401/sem conexão
        this._ops = Array.isArray(ops) ? ops : [];
        this._maquinas = Array.isArray(maquinas) ? maquinas : [];
        this._cap = Array.isArray(cap) ? cap : [];
        this._procs = Array.isArray(procs) ? procs : [];
        this._produtos = Array.isArray(produtos) ? produtos : [];
        // enriquece com galga_min/max do cadastro cru do MES (a view unificada não traz as colunas novas)
        const porCod = {}; (Array.isArray(maqMf) ? maqMf : []).forEach(m => { porCod[m.codigo] = m; });
        this._maquinas.forEach(m => { const raw = porCod[m.id_maquina]; if (raw) { m.galga_min = raw.galga_min ?? null; m.galga_max = raw.galga_max ?? null; } });
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
        ['painel','carteira','capac','seq','maquinas','produtos','config'].forEach(t => {
            const pan = $('aps-pan-' + t); if (pan) pan.style.display = t === nome ? 'block' : 'none';
        });
        document.querySelectorAll('[data-apstab]').forEach(li => li.classList.toggle('active', li.dataset.apstab === nome));
        const R = { painel:'_renderPainel', carteira:'_renderCarteira', capac:'_renderCapac', seq:'_renderSeq', maquinas:'_renderMaquinas', produtos:'_renderProdutos', config:'_renderConfig' };
        if (R[nome]) this[R[nome]]();
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

    // ═══ CARTEIRA DE ORDENS (com governança — Fase 1) ═══
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
                <button class="btn primary" style="font-size:.8rem;" onclick="aps._formNovaOp()">+ Nova OP</button>
            </div>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div id="aps-carteira-tabela"></div></div>`;
        this._renderCarteiraTabela();
    },

    // ── Governança: modal genérico ──
    _modal(html) {
        let m = $('aps-modal');
        if (!m) { m = document.createElement('div'); m.id = 'aps-modal';
            m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center;padding:20px;';
            m.innerHTML = '<div class="summary-card" style="max-width:560px;width:100%;max-height:90vh;overflow-y:auto;" id="aps-modal-body"></div>';
            m.onclick = e => { if (e.target === m) aps._fecharModal(); };
            document.body.appendChild(m); }
        $('aps-modal-body').innerHTML = html;
        m.style.display = 'flex';
    },
    _fecharModal() { const m = $('aps-modal'); if (m) m.style.display = 'none'; },

    _formNovaOp() {
        const prods = [...this._produtos].sort((a,b)=>String(a.codigo).localeCompare(String(b.codigo),'pt-BR',{numeric:true}));
        this._modal(`
            <div class="s-label" style="margin-bottom:14px;">➕ NOVA ORDEM DE PRODUÇÃO</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                <div><span class="aps-label">Nº DA OP *</span><input id="aps-op-num" class="aps-input" placeholder="ex: 21500"></div>
                <div><span class="aps-label">QUANTIDADE *</span><input id="aps-op-qtd" type="number" min="1" class="aps-input" placeholder="0"></div>
            </div>
            <span class="aps-label">PRODUTO *</span>
            <select id="aps-op-prod" class="aps-input" style="margin-bottom:12px;">${prods.map(p=>`<option value="${esc(p.id)}">${esc(p.codigo)} — ${esc((p.descricao||'').slice(0,44))}</option>`).join('')}</select>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                <div><span class="aps-label">PRAZO (data prevista)</span><input id="aps-op-prazo" type="date" class="aps-input"></div>
                <div><span class="aps-label">PRIORIDADE (0-9)</span><input id="aps-op-prio" type="number" min="0" max="9" value="0" class="aps-input"></div>
            </div>
            <p style="font-size:.72rem;color:var(--text-dim);margin-bottom:14px;">A OP nasce <strong>PLANEJADA</strong>. Para entrar na carga ela precisa passar pelo <strong>gate de liberação</strong> (roteiro + tempos-padrão + prazo) — ou ser liberada com override justificado.</p>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="aps._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="aps._criarOp()">Criar OP</button>
            </div>`);
    },
    async _criarOp() {
        const body = { numero: $('aps-op-num').value.trim(), produto_id: $('aps-op-prod').value,
            qtd_planejada: parseFloat($('aps-op-qtd').value) || 0, data_prevista: $('aps-op-prazo').value || null,
            prioridade: parseInt($('aps-op-prio').value) || 0, unidade: 'pc' };
        if (!body.numero || !body.produto_id || body.qtd_planejada <= 0) return toast('Preencha nº, produto e quantidade > 0.', 'erro');
        const r = await api.post('/api/aps/ops', body);
        if (!r?.ok) return toast(r?.erro || 'Erro ao criar a OP.', 'erro');
        this._fecharModal();
        toast(`OP ${body.numero} criada (PLANEJADA).`);
        await this._carregar(); this._renderCarteiraTabela();
    },

    async _liberar(id) {
        const g = await api.get(`/api/aps/ops/${id}/gate`);
        if (!g) return toast('Erro ao consultar o gate.', 'erro');
        if (g.pronto) {
            const r = await api.post(`/api/aps/ops/${id}/transicao`, { para: 'liberada' });
            if (!r?.ok) return toast(r?.erro || 'Erro ao liberar.', 'erro');
            toast('OP LIBERADA — gate aprovado ✓');
            await this._carregar(); this._renderCarteiraTabela();
            return;
        }
        // gate reprovou → mostra pendências e oferece override justificado
        this._modal(`
            <div class="s-label" style="margin-bottom:12px;color:#f06292;">⛔ GATE DE LIBERAÇÃO REPROVOU</div>
            <ul style="margin:0 0 14px 18px;font-size:.82rem;color:#ffca28;">${g.pendencias.map(p=>`<li style="margin-bottom:6px;">${esc(p)}</li>`).join('')}</ul>
            <p style="font-size:.74rem;color:var(--text-dim);margin-bottom:10px;">Resolva as pendências (roteiro/tempos em MES › Engenharia) — ou libere com <strong>override justificado</strong> (fica registrado no histórico com seu nome).</p>
            <span class="aps-label">JUSTIFICATIVA DO OVERRIDE *</span>
            <input id="aps-ov-motivo" class="aps-input" placeholder="por que liberar mesmo assim?" style="margin-bottom:14px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="aps._fecharModal()">Cancelar</button>
                <button class="btn primary" style="background:#f06292;" onclick="aps._liberarOverride('${esc(id)}')">Liberar MESMO ASSIM</button>
            </div>`);
    },
    async _liberarOverride(id) {
        const motivo = $('aps-ov-motivo').value.trim();
        if (!motivo) return toast('O override exige justificativa.', 'erro');
        const r = await api.post(`/api/aps/ops/${id}/transicao`, { para: 'liberada', override: true, motivo });
        if (!r?.ok) return toast(r?.erro || 'Erro ao liberar.', 'erro');
        this._fecharModal(); toast('OP liberada com OVERRIDE (registrado no histórico).', 'aviso');
        await this._carregar(); this._renderCarteiraTabela();
    },

    _formBloquear(id, numero) {
        this._modal(`
            <div class="s-label" style="margin-bottom:12px;color:#ff5252;">⛔ BLOQUEAR OP ${esc(numero)}</div>
            <p style="font-size:.76rem;color:var(--text-dim);margin-bottom:10px;">OP bloqueada <strong>não pode ser apontada</strong> nem sequenciada até o desbloqueio com disposição.</p>
            <span class="aps-label">MOTIVO DO BLOQUEIO *</span>
            <input id="aps-blq-motivo" class="aps-input" placeholder="ex: suspeita de defeito no fio / aguardando material" style="margin-bottom:14px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="aps._fecharModal()">Cancelar</button>
                <button class="btn primary" style="background:#ff5252;" onclick="aps._transicao('${esc(id)}','bloqueada',$('aps-blq-motivo').value)">Bloquear</button>
            </div>`);
    },
    _formDesbloquear(id, numero) {
        this._modal(`
            <div class="s-label" style="margin-bottom:12px;color:#26a69a;">🔓 DESBLOQUEAR OP ${esc(numero)}</div>
            <span class="aps-label">DISPOSIÇÃO *</span>
            <select id="aps-dsp" class="aps-input" style="margin-bottom:12px;">${DISPOSICOES.map(d=>`<option value="${d}">${d}</option>`).join('')}</select>
            <span class="aps-label">JUSTIFICATIVA *</span>
            <input id="aps-dsp-motivo" class="aps-input" placeholder="o que foi decidido e por quê" style="margin-bottom:14px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn secondary" onclick="aps._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="aps._desbloquear('${esc(id)}')">Desbloquear</button>
            </div>`);
    },
    async _desbloquear(id) {
        const disposicao = $('aps-dsp').value, motivo = $('aps-dsp-motivo').value.trim();
        if (!motivo) return toast('Desbloqueio exige justificativa.', 'erro');
        const r = await api.post(`/api/aps/ops/${id}/transicao`, { disposicao, motivo });
        if (!r?.ok) return toast(r?.erro || 'Erro ao desbloquear.', 'erro');
        this._fecharModal(); toast(`Desbloqueada → ${r.op?.status} (disposição: ${disposicao}).`);
        await this._carregar(); this._renderCarteiraTabela();
    },
    async _transicao(id, para, motivo) {
        if (para === 'bloqueada' && !String(motivo||'').trim()) return toast('Bloqueio exige motivo.', 'erro');
        if (para === 'cancelada' && !confirm('Cancelar esta OP? (fica no histórico, não volta pra fila)')) return;
        const r = await api.post(`/api/aps/ops/${id}/transicao`, { para, motivo: motivo || null });
        if (!r?.ok) return toast(r?.erro || 'Transição rejeitada.', 'erro');
        this._fecharModal(); toast(`OP → ${STATUS[para]?.label || para}.`);
        await this._carregar(); this._renderCarteiraTabela();
    },
    async _verLog(id, numero) {
        const log = await api.get(`/api/aps/ops/${id}/log`);
        if (!Array.isArray(log)) return toast('Histórico indisponível — rode aps_governanca.sql no Supabase.', 'aviso');
        this._modal(`
            <div class="s-label" style="margin-bottom:12px;">🕐 HISTÓRICO — OP ${esc(numero)}</div>
            ${log.length ? log.map(l => `
                <div style="padding:8px 0;border-bottom:1px solid var(--border-color);font-size:.78rem;">
                    <div><strong style="color:${STATUS[l.para]?.cor||'#fff'};">${esc(l.de||'—')} → ${esc(l.para)}</strong>
                        <span style="color:var(--text-dim);"> · ${new Date(l.criado_em).toLocaleString('pt-BR')} · ${esc(l.usuario_nome||l.origem)}</span></div>
                    ${l.motivo ? `<div style="color:var(--text-dim);margin-top:2px;">${esc(l.motivo)}</div>` : ''}
                    ${l.disposicao ? `<div style="color:#26a69a;margin-top:2px;">disposição: ${esc(l.disposicao)}</div>` : ''}
                </div>`).join('') : '<div style="color:var(--text-dim);padding:14px;">Sem registros (a OP é anterior à governança).</div>'}
            <div style="display:flex;justify-content:flex-end;margin-top:14px;"><button class="btn secondary" onclick="aps._fecharModal()">Fechar</button></div>`);
    },
    _acoesOp(o) {
        const b = (txt, fn, cor) => `<button onclick="${fn}" title="${esc(txt)}" style="background:transparent;border:1px solid ${cor}55;border-radius:5px;color:${cor};cursor:pointer;font-size:.68rem;padding:2px 8px;margin-right:4px;">${txt}</button>`;
        const id = esc(o.id), num = esc(o.numero);
        let acts = '';
        if (o.status === 'planejada')   acts = b('Liberar', `aps._liberar('${id}')`, '#26a69a') + b('⛔', `aps._formBloquear('${id}','${num}')`, '#ff5252') + b('✕', `aps._transicao('${id}','cancelada')`, '#f06292');
        else if (o.status === 'liberada') acts = b('⛔', `aps._formBloquear('${id}','${num}')`, '#ff5252') + b('↩ planejar', `aps._transicao('${id}','planejada')`, '#8b949e') + b('✕', `aps._transicao('${id}','cancelada')`, '#f06292');
        else if (o.status === 'em_producao' || o.status === 'pausada') acts = b('⛔', `aps._formBloquear('${id}','${num}')`, '#ff5252');
        else if (o.status === 'bloqueada') acts = b('🔓 Desbloquear', `aps._formDesbloquear('${id}','${num}')`, '#26a69a');
        return acts + b('🕐', `aps._verLog('${id}','${num}')`, '#26c6da');
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
                <th class="aps-th" style="text-align:right;">QTD</th><th class="aps-th">PRAZO</th><th class="aps-th">ETAPA</th><th class="aps-th">STATUS</th><th class="aps-th">AÇÕES</th>
            </tr></thead><tbody>${rows.slice(0, 500).map((o,i) => {
                const d = diasAte(o.data_prevista);
                const atras = d != null && d < 0 && o.status !== 'concluida';
                const prazoCor = d == null ? 'var(--text-dim)' : atras ? '#f06292' : d <= 3 ? '#ffca28' : 'var(--text-primary)';
                const st = STATUS[o.status] || { label:o.status, cor:'#8b949e' };
                return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};">
                    <td class="aps-td" style="font-weight:700;color:var(--indigo-primary);white-space:nowrap;">${esc(o.numero)}${Number(o.prioridade)>0?` <span title="prioridade ${o.prioridade}" style="color:#ffab76;">★</span>`:''}</td>
                    <td class="aps-td">${esc(o.produto?.codigo||'—')}</td>
                    <td class="aps-td">${esc((o.produto?.descricao||'—')).slice(0,34)}</td>
                    <td class="aps-td" style="text-align:right;white-space:nowrap;">${fmt(o.qtd_planejada)} ${esc(o.unidade||'')}</td>
                    <td class="aps-td" style="color:${prazoCor};white-space:nowrap;">${o.data_prevista ? new Date(o.data_prevista).toLocaleDateString('pt-BR') : '—'}${atras?` <span style="font-size:.68rem;">(${Math.abs(d)}d)</span>`:''}</td>
                    <td class="aps-td" style="color:var(--text-dim);">${esc(o.etapa?.nome||'—')}</td>
                    <td class="aps-td"><span style="color:${st.cor};font-weight:600;font-size:.74rem;">${st.label}</span></td>
                    <td class="aps-td" style="white-space:nowrap;">${this._acoesOp(o)}</td>
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
        const gInp = (m, campo) => `<input class="aps-input" type="number" step="0.5" style="width:70px;padding:3px 6px;font-size:.74rem;text-align:right;" value="${m[campo] ?? ''}" placeholder="—" onchange="aps._salvarAttrMaquina('${esc(m.id_maquina)}','${campo}',this.value)">`;
        el.innerHTML = `
        <div class="summary-card" style="margin-bottom:16px;padding:12px 16px;">
            <span style="font-size:.8rem;color:var(--text-dim);"><strong style="color:var(--text-primary);">${rows.length}</strong> recursos cadastrados · <strong style="color:#26a69a;">${ativas}</strong> ativos · galga mín/máx = restrição física (o sequenciador só aloca produto compatível — Fase 4)</span>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div style="max-height:66vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;">
                <th class="aps-th">MÁQUINA</th><th class="aps-th">MODELO</th><th class="aps-th">PROCESSO</th>
                <th class="aps-th" style="text-align:right;">OEE</th>
                <th class="aps-th" style="text-align:right;">GALGA MÍN</th><th class="aps-th" style="text-align:right;">GALGA MÁX</th>
                <th class="aps-th">STATUS</th>
            </tr></thead><tbody>${rows.map((m,i) => {
                const inativa = String(m.status||'').toLowerCase() === 'inativo';
                return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};opacity:${inativa?.5:1};">
                    <td class="aps-td" style="font-weight:700;color:var(--indigo-primary);">${esc(m.id_maquina||'—')}</td>
                    <td class="aps-td">${m.modelo?`Stoll ${esc(m.modelo)}`:'—'}</td>
                    <td class="aps-td" style="color:var(--text-dim);">${esc(procNome[m.processo_id]||'—')}</td>
                    <td class="aps-td" style="text-align:right;font-weight:600;">${m.oee!=null?esc(m.oee)+'%':'—'}</td>
                    <td class="aps-td" style="text-align:right;">${gInp(m,'galga_min')}</td>
                    <td class="aps-td" style="text-align:right;">${gInp(m,'galga_max')}</td>
                    <td class="aps-td"><span style="color:${inativa?'#8b949e':'#26a69a'};font-weight:600;font-size:.74rem;">${esc(m.status||'Ativo')}</span></td>
                </tr>`;
            }).join('')}</tbody></table></div></div>`;
    },
    async _salvarAttrMaquina(codigo, campo, valor) {
        const r = await api.post('/api/aps/atributos/bulk', { tabela: 'maquina', items: [{ codigo, [campo]: valor === '' ? '' : Number(valor) }] });
        if (!r?.ok) return toast(r?.erro || 'Erro ao salvar (rode aps_setup_atributos.sql?).', 'erro');
        if (r.totalNaoEncontrados) return toast(`Máquina ${codigo} não encontrada no cadastro do MES.`, 'aviso');
        const m = this._maquinas.find(x => x.id_maquina === codigo); if (m) m[campo] = valor === '' ? null : Number(valor);
        toast(`${codigo} · ${campo.replace('_',' ')} salvo ✓`);
    },

    // ═══ PRODUTOS & SETUP (Fase 2 — atributos de troca) ═══
    _prodBusca: '',
    async _renderProdutos() {
        const el = $('aps-pan-produtos');
        const troca = await api.get('/api/aps/setup-troca');
        const indisp = !Array.isArray(troca);
        const ATTR_LABEL = { titulo_fio: 'Troca de FIO (título)', galga: 'Troca de GALGA', cor_base: 'Troca de COR', programa_maquina: 'Troca de PROGRAMA' };
        el.innerHTML = `
        ${indisp ? `<div class="summary-card" style="margin-bottom:16px;border-left:3px solid #ffca28;"><span style="font-size:.8rem;color:#ffca28;">⚠ Rode <code>aps_setup_atributos.sql</code> no Supabase para ativar os atributos de setup.</span></div>` : `
        <div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:6px;">TEMPOS DE TROCA POR ATRIBUTO</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin-bottom:12px;">Custo de transição entre duas OPs = <strong>soma dos atributos que mudam</strong> (ex.: mudou fio e cor = fio + cor). Preencha com os tempos REAIS da fábrica — o sequenciador vai usar isso na Fase 4.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">
                ${(troca||[]).map(t => `<div style="display:flex;align-items:center;gap:8px;">
                    <span style="flex:1;font-size:.78rem;">${ATTR_LABEL[t.atributo]||t.atributo}</span>
                    <input type="number" min="0" id="aps-troca-${t.atributo}" value="${Number(t.minutos)||0}" class="aps-input" style="width:76px;text-align:right;">
                    <span style="font-size:.7rem;color:var(--text-dim);">min</span>
                </div>`).join('')}
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn primary" style="font-size:.78rem;" onclick="aps._salvarTroca()">💾 Salvar tempos</button></div>
        </div>`}
        <div class="summary-card" style="margin-bottom:16px;padding:12px 16px;">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <input class="aps-input" style="flex:1;min-width:200px;max-width:340px;" placeholder="Buscar código ou descrição…" value="${esc(this._prodBusca)}" oninput="aps._prodBusca=this.value;aps._renderProdTabela()">
                <button class="btn secondary" style="font-size:.78rem;" onclick="aps._formImportCsv()">📋 Importar planilha (colar)</button>
                <span style="font-size:.72rem;color:var(--text-dim);">${fmt(this._produtos.length)} produtos</span>
            </div>
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;"><div id="aps-prod-tabela"></div></div>`;
        this._renderProdTabela();
    },
    async _salvarTroca() {
        const items = ['titulo_fio','galga','cor_base','programa_maquina'].map(a => ({ atributo: a, minutos: parseInt($('aps-troca-' + a)?.value) || 0 }));
        const r = await api.post('/api/aps/setup-troca', { items });
        if (!r?.ok) return toast(r?.erro || 'Erro ao salvar.', 'erro');
        toast('Tempos de troca salvos ✓');
    },
    _renderProdTabela() {
        const el = $('aps-prod-tabela'); if (!el) return;
        const q = this._prodBusca.trim().toLowerCase();
        const rows = this._produtos.filter(p => !q || String(p.codigo||'').toLowerCase().includes(q) || String(p.descricao||'').toLowerCase().includes(q)).slice(0, 200);
        if (!rows.length) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);">Nenhum produto.</div>'; return; }
        const inp = (p, campo) => `<input class="aps-input" style="width:100%;min-width:84px;padding:4px 8px;font-size:.76rem;" value="${esc(p[campo]||'')}" onchange="aps._salvarAttrProduto('${esc(p.codigo)}','${campo}',this.value)">`;
        el.innerHTML = `<div style="max-height:56vh;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-obsidian);z-index:1;">
                <th class="aps-th">CÓDIGO</th><th class="aps-th">DESCRIÇÃO</th>
                <th class="aps-th">FIO (TÍTULO)</th><th class="aps-th">GALGA</th><th class="aps-th">COR-BASE</th><th class="aps-th">PROGRAMA</th>
            </tr></thead><tbody>${rows.map((p,i) => `
                <tr style="background:${i%2?'var(--bg-input)':'transparent'};">
                    <td class="aps-td" style="font-weight:700;color:var(--indigo-primary);white-space:nowrap;">${esc(p.codigo)}</td>
                    <td class="aps-td" style="color:var(--text-dim);">${esc((p.descricao||'').slice(0,34))}</td>
                    <td class="aps-td">${inp(p,'titulo_fio')}</td>
                    <td class="aps-td">${inp(p,'galga')}</td>
                    <td class="aps-td">${inp(p,'cor_base')}</td>
                    <td class="aps-td">${inp(p,'programa_maquina')}</td>
                </tr>`).join('')}</tbody></table></div>
            <div style="padding:8px 14px;font-size:.7rem;color:var(--text-dim);border-top:1px solid var(--border-color);">Edite direto na célula — salva ao sair do campo.${this._produtos.length>200?' Mostrando 200 (use a busca).':''}</div>`;
    },
    async _salvarAttrProduto(codigo, campo, valor) {
        const r = await api.post('/api/aps/atributos/bulk', { tabela: 'produto', items: [{ codigo, [campo]: valor.trim() }] });
        if (!r?.ok) return toast(r?.erro || 'Erro ao salvar atributo.', 'erro');
        const p = this._produtos.find(x => x.codigo === codigo); if (p) p[campo] = valor.trim() || null;
        toast(`${codigo} · ${campo} salvo ✓`);
    },
    _formImportCsv() {
        this._modal(`
            <div class="s-label" style="margin-bottom:10px;">📋 IMPORTAR ATRIBUTOS (colar da planilha)</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin-bottom:10px;">Cole do Excel (colunas separadas por TAB ou ponto-e-vírgula). Cabeçalho esperado — a ordem não importa, só o nome:<br>
            <code style="color:var(--indigo-primary);">codigo · titulo_fio · galga · cor_base · programa</code><br>
            Só produtos JÁ cadastrados são atualizados (não cria produto novo).</p>
            <textarea id="aps-csv" class="aps-input" style="height:180px;font-family:monospace;font-size:.74rem;" placeholder="codigo\ttitulo_fio\tgalga\tcor_base\tprograma\n12603\t2/30 PA\t12\tPRETA\tJOELH-SLIDE2"></textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
                <button class="btn secondary" onclick="aps._fecharModal()">Cancelar</button>
                <button class="btn primary" onclick="aps._importarCsv()">Importar</button>
            </div>`);
    },
    async _importarCsv() {
        const raw = $('aps-csv').value.trim();
        if (!raw) return toast('Cole os dados primeiro.', 'erro');
        const linhas = raw.split(/\r?\n/).filter(l => l.trim());
        const sep = linhas[0].includes('\t') ? '\t' : linhas[0].includes(';') ? ';' : ',';
        const header = linhas[0].split(sep).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
        const idx = c => header.findIndex(h => h === c || h.startsWith(c));
        const iCod = idx('codigo') >= 0 ? idx('codigo') : idx('cod');
        if (iCod < 0) return toast('Cabeçalho precisa ter a coluna "codigo".', 'erro');
        const map = { titulo_fio: idx('titulo') >= 0 ? idx('titulo') : idx('fio'), galga: idx('galga'), cor_base: idx('cor'), programa_maquina: idx('programa') };
        const items = linhas.slice(1).map(l => {
            const c = l.split(sep).map(x => x.trim());
            const it = { codigo: c[iCod] };
            Object.entries(map).forEach(([campo, i]) => { if (i >= 0 && c[i] !== undefined) it[campo] = c[i]; });
            return it;
        }).filter(it => it.codigo);
        if (!items.length) return toast('Nenhuma linha de dados encontrada.', 'erro');
        const r = await api.post('/api/aps/atributos/bulk', { tabela: 'produto', items });
        if (!r?.ok) return toast(r?.erro || 'Erro ao importar.', 'erro');
        this._fecharModal();
        toast(`✓ ${r.atualizados} produto(s) atualizados${r.totalNaoEncontrados ? ` · ${r.totalNaoEncontrados} código(s) não encontrado(s)` : ''}`, r.totalNaoEncontrados ? 'aviso' : 'ok');
        await this._carregar(); this._renderProdutos();
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
