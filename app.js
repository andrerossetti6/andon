// Lógica Central do Dashboard SIN1

// Pontos coloridos SVG para indicadores de status (substitui emojis coloridos)
const DOT = {
    red:    `<svg width="9" height="9" viewBox="0 0 9 9" style="vertical-align:middle;flex-shrink:0;"><circle cx="4.5" cy="4.5" r="4.5" fill="#f06292"/></svg>`,
    yellow: `<svg width="9" height="9" viewBox="0 0 9 9" style="vertical-align:middle;flex-shrink:0;"><circle cx="4.5" cy="4.5" r="4.5" fill="#ffca28"/></svg>`,
    green:  `<svg width="9" height="9" viewBox="0 0 9 9" style="vertical-align:middle;flex-shrink:0;"><circle cx="4.5" cy="4.5" r="4.5" fill="#3fb950"/></svg>`,
    blue:   `<svg width="9" height="9" viewBox="0 0 9 9" style="vertical-align:middle;flex-shrink:0;"><circle cx="4.5" cy="4.5" r="4.5" fill="#26c6da"/></svg>`,
    orange: `<svg width="9" height="9" viewBox="0 0 9 9" style="vertical-align:middle;flex-shrink:0;"><circle cx="4.5" cy="4.5" r="4.5" fill="#e3b341"/></svg>`,
    gray:   `<svg width="9" height="9" viewBox="0 0 9 9" style="vertical-align:middle;flex-shrink:0;"><circle cx="4.5" cy="4.5" r="4.5" fill="#484f58"/></svg>`,
    check:  `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" style="vertical-align:middle;flex-shrink:0;"><circle cx="5.5" cy="5.5" r="5.5" fill="#3fb950"/><polyline points="2.5,5.5 4.5,7.5 8.5,3.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    warn:   `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#ffca28" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex-shrink:0;"><path d="M7 1L13.5 12H0.5L7 1z"/><line x1="7" y1="5" x2="7" y2="8"/><circle cx="7" cy="10.5" r=".8" fill="#ffca28" stroke="none"/></svg>`,
    info:   `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#58a6ff" stroke-width="1.4" stroke-linecap="round" style="vertical-align:middle;flex-shrink:0;"><circle cx="7" cy="7" r="6"/><line x1="7" y1="6" x2="7" y2="10"/><circle cx="7" cy="4" r=".7" fill="#58a6ff" stroke="none"/></svg>`,
    gear:   `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="#8b949e" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex-shrink:0;"><circle cx="7" cy="7" r="2.2"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06"/></svg>`,
    bolt:   `<svg width="11" height="13" viewBox="0 0 11 13" fill="#e3b341" style="vertical-align:middle;flex-shrink:0;"><path d="M6.5 1L1 7.5h4.5L4.5 12 10 5.5H5.5L6.5 1z"/></svg>`,
};

// Escapa HTML para evitar XSS em dados inseridos via innerHTML
function escHTML(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Escapa string para uso DENTRO de onclick="fn('...')" / onchange etc. — sobrevive ao
// decode do atributo: escapa barra e aspa p/ o parser JS, depois escHTML p/ o parser HTML.
// Sem isso, aspa em dado importado (código/segmento/descrição) quebra o handler e injeta JS.
function escJS(s) {
    return escHTML(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

// Normalização de chave única — remove acentos, espaços e caracteres especiais
function normalizeKey(k) {
    return String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
}

// ══════════════════════════════════════════════════════════════
// MÓDULO DE AUTENTICAÇÃO
// ══════════════════════════════════════════════════════════════
const auth = {
    TOKEN_KEY: 'sin1_token',
    USER_KEY:  'sin1_usuario',

    getToken()   { return localStorage.getItem(this.TOKEN_KEY); },
    getUsuario() {
        try { return JSON.parse(localStorage.getItem(this.USER_KEY)); } catch { return null; }
    },

    salvar(token, usuario) {
        localStorage.setItem(this.TOKEN_KEY, token);
        localStorage.setItem(this.USER_KEY, JSON.stringify(usuario));
    },

    sair() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
        location.reload();
    },

    cabecalho() {
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getToken()}` };
    },

    estaLogado() { return !!this.getToken(); },

    // Decodifica o payload JWT sem biblioteca (apenas base64)
    _parseToken() {
        try {
            const token = this.getToken();
            if (!token) return null;
            const payload = token.split('.')[1];
            return JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));
        } catch { return null; }
    },

    async verificar() {
        if (!this.estaLogado()) return false;
        try {
            const r = await fetch('/api/importacoes', { headers: this.cabecalho() });
            return r.ok;
        } catch { return false; }
    }
};

// ══════════════════════════════════════════════════════════════
// MÓDULO DE API
// ══════════════════════════════════════════════════════════════
const api = {
    async post(url, body) {
        try {
            const r = await fetch(url, { method: 'POST', headers: auth.cabecalho(), body: JSON.stringify(body) });
            if (r.status === 401) {
                mostrarToast('Sessão expirada — fazendo novo login...', 'erro');
                setTimeout(() => auth.sair(), 1500);
                return null;
            }
            if (r.status === 403) {
                mostrarToast('Sem permissão para esta ação (perfil Visualizador)', 'erro');
                return null;
            }
            if (!r.ok) { console.error(`API POST ${url}: HTTP ${r.status}`); }
            return r.json();
        } catch(e) { console.error(`API POST ${url}:`, e.message); return null; }
    },

    async get(url) {
        try {
            const r = await fetch(url, { headers: auth.cabecalho() });
            if (r.status === 401) { auth.sair(); return null; }
            if (!r.ok) { console.error(`API GET ${url}: HTTP ${r.status}`); return null; }
            return r.json();
        } catch(e) { console.error(`API GET ${url}:`, e.message); return null; }
    },

    async put(url, body) {
        try {
            const r = await fetch(url, { method: 'PUT', headers: auth.cabecalho(), body: JSON.stringify(body) });
            if (r.status === 401) { auth.sair(); return null; }
            if (!r.ok) { console.error(`API PUT ${url}: HTTP ${r.status}`); }
            return r.json();
        } catch(e) { console.error(`API PUT ${url}:`, e.message); return null; }
    },

    async delete(url) {
        try {
            const r = await fetch(url, { method: 'DELETE', headers: auth.cabecalho() });
            if (r.status === 401) { auth.sair(); return null; }
            if (!r.ok) { console.error(`API DELETE ${url}: HTTP ${r.status}`); }
            return r.json();
        } catch(e) { console.error(`API DELETE ${url}:`, e.message); return null; }
    },

    async salvarImport(nomeArquivo, rawData, monthCols) {
        const anos = [...new Set(monthCols.map(c => c.year).filter(Boolean))];
        const linhas = rawData.map(r => {
            const meses = {};
            monthCols.forEach(mc => { meses[mc.key] = r[mc.key] || 0; });
            return { codigo: r.codigo, descricao: r.descricao, modelo: r.modelo,
                     segmento: r.segmento, tamanho: r.tamanho, marca: (r.marca || '').trim(),
                     meses, dados: { ...(r._extras || {}), ...(r.marca ? { _marca: r.marca.trim() } : {}) },
                     quantidade: r.quantidade, valor: r.valor };
        });
        return this.post('/api/vendas/import', { nomeArquivo, linhas, anos });
    },

    async listarImportacoes() {
        return this.get('/api/importacoes');
    },

    async getVendas(importacaoId) {
        return this.get(`/api/vendas?importacao_id=${importacaoId}`);
    },

    async deletarImportacao(id) {
        const r = await fetch(`/api/importacoes/${id}`, { method: 'DELETE', headers: auth.cabecalho() });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
    },

    async deletarImportacaoEstoque(id) {
        const r = await fetch(`/api/importacoes-estoque/${id}`, { method: 'DELETE', headers: auth.cabecalho() });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
    },

    async deletarImportacaoOP(id) {
        const r = await fetch(`/api/importacoes-op/${id}`, { method: 'DELETE', headers: auth.cabecalho() });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
    },

    async deletarImportacaoCostura(id) {
        const r = await fetch(`/api/importacoes-costura/${id}`, { method: 'DELETE', headers: auth.cabecalho() });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
    },

    async deletarImportacaoCliente(id) {
        const r = await fetch(`/api/importacoes-cliente/${id}`, { method: 'DELETE', headers: auth.cabecalho() });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
    },

    async deletarImportacaoBanco(id) {
        const r = await fetch(`/api/importacoes-banco/${id}`, { method: 'DELETE', headers: auth.cabecalho() });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
    }
};

// ══════════════════════════════════════════════════════════════
// BOOTSTRAP — verifica auth antes de tudo
// ══════════════════════════════════════════════════════════════
async function bootstrap() {
    // Se tem token válido (não expirado pelo JWT), entra direto sem esperar Supabase
    if (auth.estaLogado()) {
        const payload = auth._parseToken();
        const expOk   = payload && payload.exp && payload.exp * 1000 > Date.now();
        if (expOk) { mostrarApp(); return; }
        // Token expirado — limpa sem reload
        localStorage.removeItem(auth.TOKEN_KEY);
        localStorage.removeItem(auth.USER_KEY);
    }

    // Mostra formulário de login
    const loginView = document.getElementById('view-login');
    if (loginView) loginView.style.display = 'flex';
    const statusEl = document.getElementById('login-status');
    const formWrap = document.getElementById('login-form-wrap');

    // Pré-ping: acorda o servidor em background enquanto usuário digita credenciais
    if (statusEl) statusEl.textContent = 'Conectando ao servidor...';
    if (formWrap) formWrap.style.display = 'block';
    fetch('/api/ping')
        .then(() => { if (statusEl) statusEl.textContent = 'Faça login para continuar.'; })
        .catch(() => { if (statusEl) statusEl.textContent = 'Servidor iniciando, aguarde alguns instantes...'; });
}

// ── Sidebar collapse/expand ───────────────────────────────────
function toggleNavGroup(li) {
    if (!li) return;
    li.classList.toggle('nav-collapsed');
    if (li.id) localStorage.setItem('nav-grp-' + li.id, li.classList.contains('nav-collapsed') ? '1' : '0');
}

function toggleNavSection(h3) {
    const section = h3.closest('.nav-section');
    if (!section) return;
    section.classList.toggle('nav-section-collapsed');
    const key = h3.dataset.key || 'sec';
    localStorage.setItem('nav-sec-' + key, section.classList.contains('nav-section-collapsed') ? '1' : '0');
}

function initSidebarToggles() {
    document.querySelectorAll('.has-sub[id]').forEach(li => {
        if (localStorage.getItem('nav-grp-' + li.id) === '1') li.classList.add('nav-collapsed');
    });
    document.querySelectorAll('.nav-section-header[data-key]').forEach(h3 => {
        if (localStorage.getItem('nav-sec-' + h3.dataset.key) === '1') {
            h3.closest('.nav-section')?.classList.add('nav-section-collapsed');
        }
    });
}

function mostrarApp() {
    const usuario = auth.getUsuario();
    document.getElementById('view-login').style.display  = 'none';
    document.getElementById('app-sidebar').style.display = 'flex';
    navigateTo('dashboard');
    initSidebarToggles();

    // Atualiza nome do usuário na sidebar
    if (usuario) {
        const nameEl = document.querySelector('.user-info .name');
        const roleEl = document.querySelector('.user-info .role');
        if (nameEl) nameEl.textContent = usuario.nome;
        if (roleEl) roleEl.textContent = usuario.perfil === 'admin' ? 'Administrador' : 'Visualizador';

        // Viewer: oculta botões de importação e salvar
        if (usuario.perfil !== 'admin') {
            document.querySelectorAll('.import-btn, #btn-salvar-vendas, [onclick*="perguntarESalvar"], [onclick*="handleFile"]').forEach(el => {
                el.style.display = 'none';
            });
            // Oculta drop zones de importação
            document.querySelectorAll('.drop-zone').forEach(el => el.style.display = 'none');
            // Mostra badge de modo leitura
            mostrarToast('Modo Visualizador — importações desabilitadas');
        }
    }

    // Adiciona botão de sair
    const profile = document.querySelector('.user-profile');
    if (profile && !document.getElementById('btn-sair')) {
        profile.style.cursor = 'pointer';
        profile.title = 'Clique para sair';
        profile.id = 'btn-sair';
        profile.addEventListener('click', () => {
            if (confirm('Deseja sair do sistema?')) auth.sair();
        });
    }

    init();
    banco.init();
    cliente.init();
    processosGerenciamento.init();
    capacidade.init();
    toc.init();
    previsao.init();
    planoProducao.init();
    soepDash.init();
    preactor.init();
    estoque.init();
    op.init();
    costura.init();
    pesquisa.init();
    vxe.init();
    abc.init();
    abcMicro.init();
    abcEstoque.init();
    calendario.init();
    pedidos.init();
    disponibilidade.init().catch(() => {});
    const _modulos = ['Vendas','Banco','Cliente','Calendário','Capacidade','Estoque','OP','Costura'];
    Promise.allSettled([
        vendas.carregarHistorico(),
        banco.carregarHistorico(),
        cliente.carregarHistorico(),
        calendario.carregarHistorico(),
        capacidade.carregarHistorico(),
        estoque.carregarHistorico(),
        op.carregarHistorico(),
        costura.carregarHistorico(),
    ]).then(results => {
        const falhos = results
            .map((r, i) => r.status === 'rejected' ? _modulos[i] : null)
            .filter(Boolean);
        if (falhos.length) {
            console.warn('Módulos com falha ao carregar:', falhos);
            mostrarToast(`⚠ Erro ao carregar: ${falhos.join(', ')}`, 'erro');
        }
        const lastView = localStorage.getItem('sin1_lastView');
        if (lastView) navigateTo(lastView);
        // Dashboard e dashboards dependentes atualizados após todos os módulos carregarem
        homeDash.render();
        alertas.verificar();
        // Marca todos os dashboards dependentes como dirty para próxima navegação
        vxe._dirty = true;
        opDash._dirty = true;
        pesquisa._dirty = true;
        clientesDash._dirty = true;
        comparador._dirty = true;
        abc._items = [];
        abcMicro._items = [];
        abcEstoque._items = [];
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bootstrap();

    // Handler do formulário manual (fallback quando auto-login falha)
    document.getElementById('login-form').addEventListener('submit', async e => {
        e.preventDefault();
        const email    = document.getElementById('login-email').value;
        const senha    = document.getElementById('login-senha').value;
        const erroEl   = document.getElementById('login-erro');
        const submitBtn = document.getElementById('login-submit');
        submitBtn.disabled = true;
        erroEl.style.display = 'none';

        // Retry automático: até 10 tentativas × 5s = 50s (cobre wake-up do Render ~30-60s)
        const MAX = 10;
        let ok = false;
        for (let tentativa = 1; tentativa <= MAX; tentativa++) {
            if (tentativa === 1) {
                submitBtn.textContent = 'Entrando...';
            } else {
                submitBtn.textContent = `Aguardando servidor... (${tentativa}/${MAX})`;
                erroEl.textContent = `Servidor iniciando, aguarde... (tentativa ${tentativa} de ${MAX})`;
                erroEl.style.display = 'block';
            }
            try {
                const res  = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, senha })
                });
                const data = await res.json();
                if (res.ok) {
                    auth.salvar(data.token, data.usuario);
                    document.getElementById('view-login').style.display = 'none';
                    erroEl.style.display = 'none';
                    mostrarApp();
                    ok = true;
                    break;
                } else {
                    // Resposta do servidor (ex: credenciais inválidas) — não retry
                    erroEl.textContent = data.erro || 'Credenciais inválidas';
                    erroEl.style.display = 'block';
                    break;
                }
            } catch {
                // Erro de rede — servidor ainda acordando
                if (tentativa < MAX) {
                    await new Promise(r => setTimeout(r, 5000));
                } else {
                    erroEl.textContent = 'Não foi possível conectar ao servidor. Tente novamente em alguns instantes.';
                    erroEl.style.display = 'block';
                }
            }
        }

        submitBtn.disabled = false;
        submitBtn.textContent = 'Entrar';
    });
});

function init() {
    vendas.init();
}

// ====== HOME DASHBOARD ======
const homeDash = {
    render() {
        // Data e saudação
        const u = auth.getUsuario();
        const hora = new Date().getHours();
        const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
        const el = document.getElementById('home-username');
        if (el) el.closest('h1').firstChild.textContent = `${saud}, `;
        if (el) el.textContent = u?.nome?.split(' ')[0] || 'Administrador';
        const dateEl = document.getElementById('home-date');
        if (dateEl) dateEl.textContent = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});

        this._kpis();
        this._top5();
        this._alertas();
        this._atividades();
        this._pipeline();
        this._oeeAsync();
    },

    _kpis() {
        const toNum = v => typeof v === 'number' ? v : (parseFloat(String(v??'0').replace(/\./g,'').replace(',','.')) || 0);
        const fmtK  = v => v >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toLocaleString('pt-BR');

        // ── Vendas ──
        let vendasTotal = 0, vendasMes = 0, codigosSet = new Set();
        if (vendas.rawData.length && vendas.monthCols.length) {
            // Usa a coluna mais recente disponível para "vendas do mês"
            const ultimaCol = vendas.monthCols[vendas.monthCols.length - 1];
            const activeCols = vendas.getActiveCols();
            vendas.rawData.forEach(r => {
                if (r.codigo) codigosSet.add(r.codigo);
                if (ultimaCol) vendasMes += (r[ultimaCol.key] || 0);
                activeCols.forEach(c => { vendasTotal += (r[c.key] || 0); });
            });
            const subLabel = ultimaCol ? `unidades — ${ultimaCol.label}` : 'unidades';
            this._set('home-vendas-mes-sub', vendasMes > 0 ? subLabel : 'sem dados');
        }
        this._set('home-vendas-mes', vendasMes > 0 ? fmtK(vendasMes) : (vendasTotal > 0 ? fmtK(vendasTotal) : '—'));
        this._set('home-codigos', codigosSet.size > 0 ? codigosSet.size.toLocaleString('pt-BR') : '—');

        // ── Faturamento clientes ──
        let fatClientes = 0;
        if (cliente.rawData.length) {
            // Detecta coluna de valor total de forma robusta
            const colVal = cliente._colValTotal
                || (cliente.colunas || []).find(c => /total|valor/i.test(c))
                || null;
            cliente.rawData.forEach(r => {
                const v = colVal ? r.dados?.[colVal] : null;
                if (v != null) fatClientes += toNum(v);
            });
        }
        this._set('home-fat-clientes', fatClientes > 0 ? 'R$ ' + fmtK(fatClientes) : (cliente.rawData.length ? 'R$ 0' : '—'));

        // ── Estoque crítico ──
        let critico = 0;
        if (vendas.rawData.length && estoque.rawData.length) {
            const estMap = {};
            estoque.rawData.forEach(r => {
                const k = String(r.codigo||'').toUpperCase();
                estMap[k] = (estMap[k]||0) + (r.quantidade||0);
            });
            const activeCols = vendas.getActiveCols();
            const nMeses = activeCols.length || 1;
            const codMap = {};
            vendas.rawData.forEach(r => {
                const k = String(r.codigo||'').toUpperCase();
                if (!codMap[k]) codMap[k] = 0;
                activeCols.forEach(c => { codMap[k] += (r[c.key]||0); });
            });
            Object.entries(codMap).forEach(([cod, total]) => {
                const media = total / nMeses;
                const est   = estMap[cod] || 0;
                if (media > 0 && est / media < 1) critico++;
            });
        }
        const critEl = document.getElementById('home-critico');
        if (critEl) {
            critEl.textContent = vendas.rawData.length ? critico.toLocaleString('pt-BR') : '—';
            critEl.style.color = critico > 0 ? '#f06292' : '#26a69a';
        }

        // ── OPs ──
        const ops = op.rawData.length;
        this._set('home-ops', ops > 0 ? ops.toLocaleString('pt-BR') : '—');
        this._set('home-ops-sub', ops > 0 ? 'ordens importadas' : 'sem dados de OP');

        // ── R$ em risco (Política de Estoques) ──
        const riscoEl   = document.getElementById('home-risco');
        const riscoSub  = document.getElementById('home-risco-sub');
        const riscoCard = document.getElementById('home-card-risco');
        if (riscoEl && politicaEstoque._rows.length) {
            let revRisco = 0;
            politicaEstoque._rows.forEach(r => { if (r.revenueRisco) revRisco += r.revenueRisco; });
            const ruptura = politicaEstoque._rows.filter(r => r.status === 'RUPTURA').length;
            const risco   = politicaEstoque._rows.filter(r => r.status === 'RISCO').length;
            if (revRisco > 0) {
                riscoEl.textContent = politicaEstoque._fmtR(revRisco);
                riscoEl.style.color = '#f06292';
                if (riscoCard) riscoCard.style.borderTop = '3px solid #f06292';
            } else if (ruptura + risco > 0) {
                riscoEl.textContent = (ruptura + risco) + ' SKUs';
                riscoEl.style.color = '#ffca28';
                if (riscoCard) riscoCard.style.borderTop = '3px solid #ffca28';
            } else {
                riscoEl.textContent = '✓ OK';
                riscoEl.style.color = '#26a69a';
                if (riscoCard) riscoCard.style.borderTop = '3px solid #26a69a';
            }
            if (riscoSub) riscoSub.textContent = `${ruptura} RUPTURA · ${risco} RISCO`;
        }

        // ── Gargalo TOC ──
        const gargaloEl   = document.getElementById('home-gargalo');
        const gargaloSub  = document.getElementById('home-gargalo-sub');
        const gargaloCard = document.getElementById('home-card-gargalo');
        if (gargaloEl && toc._resultProcs?.length) {
            const validos = toc._resultProcs.filter(p => !p.semDados);
            const top = validos.sort((a, b) => (b.util||0) - (a.util||0))[0];
            if (top) {
                const pct   = Math.round((top.util||0) * 100);
                const color = pct >= 100 ? '#f06292' : pct >= 85 ? '#ffca28' : '#26a69a';
                gargaloEl.textContent = pct + '%';
                gargaloEl.style.color = color;
                if (gargaloCard) gargaloCard.style.borderTop = `3px solid ${color}`;
                if (gargaloSub) gargaloSub.textContent = (top.nome || top.id || 'processo') + (pct >= 100 ? ' — GARGALO' : '');
            }
        }
    },

    _top5() {
        const el = document.getElementById('home-top5');
        if (!el || !vendas.rawData.length) {
            if (el) el.innerHTML = '<p style="color:#8b949e;font-size:0.8rem;">Importe dados de vendas.</p>';
            return;
        }
        // Usa a coluna mais recente com dados > 0
        const col = vendas.monthCols.slice().reverse().find(c => {
            return vendas.rawData.some(r => (r[c.key]||0) > 0);
        }) || vendas.monthCols[vendas.monthCols.length - 1];
        if (!col) { el.innerHTML = '<p style="color:#8b949e;font-size:0.8rem;">Sem dados de vendas.</p>'; return; }

        const map = {};
        vendas.rawData.forEach(r => {
            const k = String(r.descricao||r.codigo||'').trim();
            map[k] = (map[k]||0) + (r[col.key]||0);
        });
        const top5 = Object.entries(map).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (!top5.length) { el.innerHTML = '<p style="color:#8b949e;font-size:0.8rem;">Sem vendas disponíveis.</p>'; return; }
        // Atualiza label com o mês sendo exibido
        const labelEl = document.querySelector('[style*="TOP 5 PRODUTOS"]') || document.querySelector('.s-label');
        const tituloEl = document.querySelector('#view-dashboard .s-label');
        if (col?.label) {
            const titleCards = document.querySelectorAll('#view-dashboard .s-label');
            titleCards.forEach(t => { if (t.textContent.includes('TOP 5')) t.textContent = `TOP 5 PRODUTOS — ${col.label.toUpperCase()}`; });
        }
        const max = top5[0][1];
        el.innerHTML = top5.map(([nome, val],i) => {
            const pct = Math.round(val/max*100);
            return `<div style="margin-bottom:9px;">
                <div style="display:flex;justify-content:space-between;font-size:0.77rem;margin-bottom:3px;">
                    <span style="color:#e6edf3;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;">${i+1}. ${escHTML(nome)}</span>
                    <span style="color:#26c6da;font-weight:700;flex-shrink:0;">${val.toLocaleString('pt-BR')}</span>
                </div>
                <div style="background:rgba(255,255,255,0.06);border-radius:3px;height:4px;">
                    <div style="background:#26c6da;width:${pct}%;height:100%;border-radius:3px;"></div>
                </div>
            </div>`;
        }).join('');
    },

    _alertas() {
        const el = document.getElementById('home-alertas');
        const badge = document.getElementById('home-alertas-badge');
        if (!el) return;
        const alertas = [];

        if (!vendas.rawData.length) alertas.push({ tipo: 'info', msg: 'Dados de Vendas não importados', acao: 'vendas' });
        if (!estoque.rawData.length) alertas.push({ tipo: 'info', msg: 'Dados de Estoque não importados', acao: 'estoque' });
        if (!op.rawData.length) alertas.push({ tipo: 'info', msg: 'Ordens de Produção não importadas', acao: 'op' });

        if (vendas.rawData.length && estoque.rawData.length) {
            const estMap = {};
            estoque.rawData.forEach(r => { estMap[String(r.codigo||'').toUpperCase()] = (estMap[String(r.codigo||'').toUpperCase()]||0)+(r.quantidade||0); });
            let semEstoque = 0;
            vendas.rawData.forEach(r => {
                const cod = String(r.codigo||'').toUpperCase();
                if ((estMap[cod]||0) === 0) semEstoque++;
            });
            if (semEstoque > 0) alertas.push({ tipo: 'critico', msg: `${semEstoque} código(s) com estoque ZERO`, acao: 'vxe' });
        }

        // ── R$ em risco (Política de Estoques) ──
        if (politicaEstoque._rows.length) {
            let revRisco = 0;
            politicaEstoque._rows.forEach(r => { if (r.revenueRisco) revRisco += r.revenueRisco; });
            const ruptura = politicaEstoque._rows.filter(r => r.status === 'RUPTURA').length;
            const risco   = politicaEstoque._rows.filter(r => r.status === 'RISCO').length;
            if (revRisco > 0) {
                alertas.push({ tipo: 'critico', msg: `${politicaEstoque._fmtR(revRisco)} em risco — ${ruptura} RUPTURA · ${risco} RISCO`, acao: 'politica' });
            } else if (ruptura + risco > 0) {
                alertas.push({ tipo: 'aviso', msg: `${ruptura + risco} SKU(s) abaixo do estoque ideal`, acao: 'politica' });
            }
        }

        // ── TOC gargalo sobrecarregado ──
        if (toc._resultProcs?.length) {
            const sobrecarregados = toc._resultProcs.filter(p => !p.semDados && (p.util||0) > 1);
            if (sobrecarregados.length) {
                const top = sobrecarregados.sort((a, b) => b.util - a.util)[0];
                alertas.push({ tipo: 'critico', msg: `Gargalo ${top.nome || top.id}: ${Math.round(top.util * 100)}% de utilização`, acao: 'toc' });
            }
        }

        const critCount = alertas.filter(a => a.tipo === 'critico').length;
        if (badge) { badge.textContent = critCount; badge.style.display = critCount > 0 ? '' : 'none'; }

        if (!alertas.length) { el.innerHTML = `<p style="color:#26a69a;font-size:0.8rem;display:flex;align-items:center;gap:6px;">${DOT.check} Nenhum alerta no momento.</p>`; return; }

        const cores = { critico: '#f06292', aviso: '#ffab76', info: '#8b949e' };
        const icons = { critico: DOT.red, aviso: DOT.warn, info: DOT.info };
        el.innerHTML = alertas.map(a => `
            <div onclick="navigateTo('${a.acao}')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;border-left:3px solid ${cores[a.tipo]};">
                ${icons[a.tipo]}
                <span style="font-size:0.78rem;color:#e6edf3;">${escHTML(a.msg)}</span>
            </div>`).join('');
    },

    _atividades() {
        const el = document.getElementById('home-atividades');
        if (!el) return;
        const recentes = historico.recentes(5);
        if (!recentes.length) { el.innerHTML = '<p style="color:#8b949e;font-size:0.78rem;">Nenhuma atividade ainda.</p>'; return; }
        const fmtTs = ts => new Date(ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
        el.innerHTML = recentes.map(a => `
            <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:0.68rem;color:#8b949e;white-space:nowrap;">${fmtTs(a.ts)}</span>
                <span style="font-size:0.77rem;color:#e6edf3;">${escHTML(a.acao)} <strong style="color:#26c6da;">${escHTML(a.modulo)}</strong> — ${escHTML(a.detalhe)}</span>
            </div>`).join('');
    },

    _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; },

    _pipeline() {
        const el = document.getElementById('home-pipeline');
        if (!el) return;
        // SVG icons profissionais — stroke-based, 18×18
        const SVG = {
            config: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="2" y1="5" x2="16" y2="5"/><circle cx="6" cy="5" r="2.2" fill="var(--bg-card,#161b22)" stroke="currentColor" stroke-width="1.5"/>
                <line x1="2" y1="13" x2="16" y2="13"/><circle cx="12" cy="13" r="2.2" fill="var(--bg-card,#161b22)" stroke="currentColor" stroke-width="1.5"/>
            </svg>`,
            import: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="5,8 9,12 13,8"/><line x1="9" y1="2" x2="9" y2="12"/>
                <path d="M3 15h12"/>
            </svg>`,
            soep: `<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                <rect x="1.5" y="11" width="3.5" height="5.5" rx="0.6" opacity="0.55"/>
                <rect x="7.25" y="7" width="3.5" height="9.5" rx="0.6" opacity="0.78"/>
                <rect x="13" y="3" width="3.5" height="13.5" rx="0.6"/>
            </svg>`,
            toc: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="2,2 16,2 10.8,9 10.8,16 7.2,14.2 7.2,9"/>
            </svg>`,
            preactor: `<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                <rect x="1" y="3" width="8.5" height="2.8" rx="1" opacity="0.9"/>
                <rect x="5" y="7.6" width="7" height="2.8" rx="1" opacity="0.68"/>
                <rect x="2" y="12.2" width="10.5" height="2.8" rx="1" opacity="0.82"/>
            </svg>`,
            mes: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1,9 4,9 6,3 8,15 10,6 12,12 14,9 17,9"/>
            </svg>`,
        };
        const etapas = [
            { label: 'Config.',   icon: SVG.config,   ok: banco.rawData.length > 0,                                              view: 'banco',    sub: banco.rawData.length    ? banco.rawData.length + ' SKUs'      : 'banco vazio'        },
            { label: 'Importação',icon: SVG.import,   ok: vendas.rawData.length > 0 && estoque.rawData.length > 0,               view: 'vendas',   sub: vendas.rawData.length   ? vendas.rawData.length + ' itens'    : 'sem dados'          },
            { label: 'S&OP',      icon: SVG.soep,     ok: !!(previsao._forecast?.length),                                        view: 'previsao', sub: previsao._forecast?.length ? previsao._forecast.length + ' SKUs prev.' : 'sem previsão' },
            { label: 'TOC',       icon: SVG.toc,      ok: !!(toc._resultProcs?.length),                                          view: 'toc',      sub: toc._resultProcs?.length  ? 'gargalo calculado'               : 'não calculado'      },
            { label: 'Preactor',  icon: SVG.preactor, ok: !!(preactor._resultado?.ordens?.length),                               view: 'timeline', sub: preactor._resultado?.ordens?.length ? 'Gantt gerado'         : 'não sequenciado'    },
            { label: 'MES',       icon: SVG.mes,      ok: mes._wip?.length > 0 || mes._processos?.length > 0,                    view: 'mes',      sub: mes._wip?.length          ? mes._wip.length + ' no WIP'       : 'nenhum apontamento' },
        ];
        el.innerHTML = etapas.map((e, i) => {
            const ok    = e.ok;
            const color = ok ? '#3fb950' : '#484f58';
            const icClr = ok ? '#58a6ff' : '#484f58';
            const bg    = ok ? 'rgba(56,139,253,.05)' : 'transparent';
            return `<div onclick="navigateTo('${e.view}')" style="flex:1;min-width:90px;cursor:pointer;text-align:center;padding:14px 8px 12px;background:${bg};border-right:${i < etapas.length-1 ? '1px solid rgba(255,255,255,.05)' : 'none'};position:relative;transition:background .18s;" onmouseenter="this.style.background='rgba(255,255,255,.04)'" onmouseleave="this.style.background='${bg}'">
                <div style="display:flex;justify-content:center;align-items:center;margin-bottom:7px;color:${icClr};">${e.icon}</div>
                <div style="font-size:.72rem;font-weight:700;color:${ok ? '#e6edf3' : '#6e7681'};letter-spacing:.02em;">${e.label}</div>
                <div style="font-size:.62rem;color:#484f58;margin-top:3px;">${e.sub}</div>
                <div style="position:absolute;top:7px;right:8px;width:7px;height:7px;border-radius:50%;background:${ok ? '#3fb950' : '#30363d'};box-shadow:${ok ? '0 0 5px rgba(63,185,80,.5)' : 'none'};"></div>
                ${i < etapas.length-1 ? `<div style="position:absolute;right:-7px;top:50%;transform:translateY(-50%);z-index:2;"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#30363d" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,2 9,6 3,10"/></svg></div>` : ''}
            </div>`;
        }).join('');
    },

    async _oeeAsync() {
        try {
            // Fase 6: fonte ÚNICA do Malha Forte (painel = OEE medido · wip = OPs no fluxo). Sem mais /api/mes legado.
            const [painel, wipData] = await Promise.all([
                api.get('/api/mf/painel').catch(() => null),
                api.get('/api/mf/wip').catch(() => null),
            ]);

            const oeeEl   = document.getElementById('home-oee');
            const oeeSub  = document.getElementById('home-oee-sub');
            const oeeCard = document.getElementById('home-card-oee');
            if (oeeEl) {
                const v = (painel && painel.oee_medio != null) ? Math.round(painel.oee_medio * 10) / 10 : null;
                if (v != null && v > 0) {
                    const color = v >= 85 ? '#26a69a' : v >= 65 ? '#ffca28' : '#f06292';
                    oeeEl.textContent = v + '%';
                    oeeEl.style.color = color;
                    if (oeeCard) oeeCard.style.borderTop = `3px solid ${color}`;
                    if (oeeSub) oeeSub.textContent = 'OEE medido no MES';
                } else {
                    oeeEl.textContent = '—';
                    oeeEl.style.color = '#8b949e';
                    if (oeeSub) oeeSub.textContent = 'aguardando apontamento';
                    if (oeeCard) oeeCard.style.borderTop = '3px solid rgba(255,255,255,.08)';
                }
            }

            const wipEl   = document.getElementById('home-wip');
            const wipSub  = document.getElementById('home-wip-sub');
            const wipCard = document.getElementById('home-card-wip');
            if (wipEl) {
                const board    = Array.isArray(wipData?.board) ? wipData.board : [];
                const totalOps = board.reduce((s, b) => s + (b.ops || 0), 0);
                const sessoes  = painel?.sessoes_abertas || 0;
                if (totalOps > 0) {
                    wipEl.textContent = totalOps;
                    wipEl.style.color = '#26c6da';
                    if (wipCard) wipCard.style.borderTop = '3px solid #26c6da';
                    if (wipSub) wipSub.textContent = `OPs no fluxo${sessoes ? ` · ${sessoes} em apontamento` : ''}`;
                } else {
                    wipEl.textContent = '0';
                    wipEl.style.color = '#8b949e';
                    if (wipSub) wipSub.textContent = 'nenhuma OP no fluxo';
                    if (wipCard) wipCard.style.borderTop = '3px solid rgba(255,255,255,.08)';
                }
            }
        } catch { /* MES Malha Forte ainda não inicializado */ }
    }
};

// ── Histórico de Atividade ────────────────────────────────────────
const historico = {
    _KEY: 'sin1_historico',
    _MAX: 100,

    registrar(acao, modulo, detalhe) {
        const lista = this._ler();
        lista.unshift({
            ts: new Date().toISOString(),
            usuario: auth.getUsuario()?.nome || '?',
            acao, modulo, detalhe
        });
        if (lista.length > this._MAX) lista.splice(this._MAX);
        try { localStorage.setItem(this._KEY, JSON.stringify(lista)); } catch(e) {}
    },

    _ler() {
        try { return JSON.parse(localStorage.getItem(this._KEY) || '[]'); } catch { return []; }
    },

    recentes(n = 20) { return this._ler().slice(0, n); }
};

// ── Sistema de Alertas ────────────────────────────────────────────
const alertas = {
    verificar() {
        if (!vendas.rawData.length) return;

        const estMap = {};
        estoque.rawData.forEach(r => {
            const k = String(r.codigo||'').toUpperCase();
            estMap[k] = (estMap[k]||0) + (r.quantidade||0);
        });

        const activeCols = vendas.getActiveCols();
        let criticos = 0, semEstoque = 0;

        const vendMap = {};
        vendas.rawData.forEach(r => {
            const k = String(r.codigo||'').toUpperCase();
            if (!vendMap[k]) vendMap[k] = 0;
            activeCols.forEach(c => { vendMap[k] += (r[c.key]||0); });
        });

        Object.entries(vendMap).forEach(([cod, total]) => {
            const media = total / (activeCols.length||1);
            const est = estMap[cod] || 0;
            if (estoque.rawData.length) {
                if (est === 0) semEstoque++;
                else if (media > 0 && est/media < 1) criticos++;
            }
        });

        const badge = document.getElementById('alert-badge-critico');
        const total = criticos + semEstoque;
        if (badge) {
            badge.textContent = total;
            badge.style.display = total > 0 ? '' : 'none';
            badge.title = `${criticos} críticos (< 1 mês) + ${semEstoque} sem estoque`;
        }

        // Toast pontual só na primeira vez que detecta críticos
        if (total > 0 && !this._notificado) {
            this._notificado = true;
            mostrarToast(`⚠ ${total} item(ns) com estoque crítico — ver Vendas × Estoque`, 'erro');
        }
    },
    _notificado: false
};

// ── Backup ────────────────────────────────────────────────────────
async function resetarDados() {
    const confirmacao = prompt('Digite CONFIRMAR para apagar TODOS os dados importados do Supabase (estrutura e usuários serão mantidos):');
    if (confirmacao !== 'CONFIRMAR') { mostrarToast('Operação cancelada.'); return; }

    mostrarToast('Apagando dados...');
    try {
        const r = await fetch('/api/reset-dados', { method: 'DELETE', headers: auth.cabecalho() });
        const d = await r.json();
        if (r.ok) {
            // Limpa cache local também
            ['vendas','estoque','op','costura','cliente','banco','calendario','capacidade'].forEach(k => lsCache.limpar(k));
            localStorage.removeItem('sin1_lastView');
            historico.registrar('reset', 'sistema', 'Todos os dados importados removidos');
            mostrarToast('✓ Dados apagados. Recarregando...', 'ok');
            setTimeout(() => location.reload(), 1500);
        } else {
            mostrarToast('Erro: ' + d.erro, 'erro');
        }
    } catch(e) { (console.error(e), mostrarToast('Erro de conexão. Tente de novo.', 'erro')); }
}

async function baixarBackup() {
    mostrarToast('Gerando backup…');
    try {
        const r = await fetch('/api/backup', { headers: auth.cabecalho() });
        if (!r.ok) { mostrarToast('Erro ao gerar backup', 'erro'); return; }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sigs-backup-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        historico.registrar('backup', 'sistema', 'Download JSON completo');
        mostrarToast('✓ Backup baixado com sucesso');
    } catch(e) { (console.error(e), mostrarToast('Erro inesperado. Tente de novo.', 'erro')); }
}

// ── Exportação XLS ────────────────────────────────────────────────
function exportarXLS(dados, nomeArquivo) {
    if (!dados?.length) { mostrarToast('Nenhum dado para exportar', 'erro'); return; }
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');
    XLSX.writeFile(wb, (nomeArquivo || 'exportacao') + '.xlsx');
    mostrarToast(`✓ ${dados.length.toLocaleString('pt-BR')} linhas exportadas`);
}

// ── Cache localStorage — fallback quando Supabase indisponível ────
const lsCache = {
    salvar(chave, dados) {
        try {
            localStorage.setItem('sin1_' + chave, JSON.stringify(dados));
        } catch(e) {
            if (e.name === 'QuotaExceededError') {
                console.warn(`lsCache: quota localStorage excedida para "${chave}". Cache não salvo.`);
            } else {
                console.warn(`lsCache: erro ao salvar "${chave}":`, e.message);
            }
        }
    },
    ler(chave) {
        try {
            const d = localStorage.getItem('sin1_' + chave);
            return d ? JSON.parse(d) : null;
        } catch(e) {
            console.warn(`lsCache: erro ao ler "${chave}":`, e.message);
            return null;
        }
    },
    limpar(chave) {
        try { localStorage.removeItem('sin1_' + chave); } catch(e) {}
    }
};

// ====== NAVIGATION ======

// ====== PAINEL DE DETALHES DO PRODUTO ======

function abrirDetalhe(descricao, segmento) {
    const activeCols = vendas.getActiveCols();
    const TAM_ORDER  = { PP:0, P:1, M:2, G:3, GG:4, XG:5, XXG:6, XGG:7 };

    // Todas as variantes com a mesma descrição
    const variants = vendas.rawData
        .filter(r => r.descricao === descricao)
        .sort((a, b) => (TAM_ORDER[a.tamanho] ?? 9) - (TAM_ORDER[b.tamanho] ?? 9));

    if (!variants.length) return;

    // Mapa de estoque
    const estMap = {};
    estoque.rawData.forEach(r => { estMap[r.codigo] = Number(r.quantidade) || 0; });

    // Header
    document.getElementById('detail-nome').textContent = descricao;
    document.getElementById('detail-seg').textContent  = segmento;

    // Gráfico mensal (soma todas as variantes)
    const monthTotals = {};
    activeCols.forEach(c => {
        const total = variants.reduce((s, r) => s + (r[c.key] || 0), 0);
        if (!monthTotals[c.label]) monthTotals[c.label] = 0;
        monthTotals[c.label] += total;
    });
    setTimeout(() => drawDetailChart(monthTotals), 30);

    // Tabela: Código | Modelo | Marca | Tamanho | Vendas | Estoque — ordem crescente por Vendas
    const variantRows = variants.map(r => ({
        r,
        vendQtd: activeCols.reduce((s, c) => s + (r[c.key] || 0), 0),
        estQtd:  estMap[r.codigo] ?? null
    })).sort((a, b) => b.vendQtd - a.vendQtd);

    document.getElementById('detail-tbody').innerHTML = variantRows.map(({ r, vendQtd, estQtd }) => `<tr>
            <td class="td-code">${escHTML(r.codigo)}</td>
            <td>${r.modelo ? escHTML(r.modelo) : '<span style="opacity:.3">—</span>'}</td>
            <td>${r.marca  ? escHTML(r.marca)  : '<span style="opacity:.3">—</span>'}</td>
            <td class="td-center"><strong>${escHTML(r.tamanho)}</strong></td>
            <td class="td-right">${vendQtd.toLocaleString('pt-BR')}</td>
            <td class="td-right">${estQtd !== null ? estQtd.toLocaleString('pt-BR') : '<span style="opacity:.3">—</span>'}</td>
        </tr>`).join('');

    document.getElementById('detail-overlay').style.display = 'block';
    document.getElementById('detail-panel').classList.add('open');
}

function fecharDetalhe() {
    document.getElementById('detail-overlay').style.display = 'none';
    document.getElementById('detail-panel').classList.remove('open');
}

function drawDetailChart(monthTotals) {
    const canvas = document.getElementById('detail-chart');
    const ctx    = canvas.getContext('2d');
    const w = canvas.width  = canvas.offsetWidth || 370;
    const h = canvas.height = 90;
    ctx.clearRect(0, 0, w, h);

    const entries = Object.entries(monthTotals);
    if (!entries.length) return;

    const max  = Math.max(...entries.map(([,v]) => v)) || 1;
    const padX = 8, padY = 18;
    const barW = (w - padX * 2) / entries.length;

    entries.forEach(([label, val], i) => {
        const x    = padX + i * barW;
        const barH = Math.max(((h - padY * 2) * val) / max, val > 0 ? 2 : 0);
        const y    = h - padY - barH;

        const grad = ctx.createLinearGradient(0, y, 0, h - padY);
        grad.addColorStop(0, 'rgba(38,198,218,0.9)');
        grad.addColorStop(1, 'rgba(38,198,218,0.2)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.rect(x + 2, y, barW - 4, barH);
        ctx.fill();

        ctx.fillStyle = 'rgba(139,148,158,0.6)';
        ctx.font = '7px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(label.substring(0, 6), x + barW / 2, h - 3);
    });
}

// Número pt-BR: trata '1.250' (milhar) e '1.234,5' corretamente — '1.250' → 1250, não 1.25
function toNumBR(v) {
    let s = String(v ?? '').replace(/[^\d.,\-]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return parseFloat(s) || 0;
}

function mostrarToast(msg, tipo = 'ok') {
    let toast = document.getElementById('sin1-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sin1-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `sin1-toast sin1-toast-${tipo} sin1-toast-show`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('sin1-toast-show'), 3000);
}

function toggleHistorico(id) {
    const list    = document.querySelector(`#${id} .history-list`);
    const chevron = document.querySelector(`#${id} .history-chevron`);
    const aberto  = list.style.display !== 'none';
    list.style.display    = aberto ? 'none' : 'flex';
    chevron.style.transform = aberto ? 'rotate(0deg)' : 'rotate(90deg)';
}

function toggleVendasTop() {
    const wrap = document.getElementById('vendas-top-wrap');
    const ico  = document.getElementById('ico-toggle-vendas');
    const btn  = document.getElementById('btn-toggle-vendas-top');
    const collapsed = wrap.style.display === 'none';
    wrap.style.display = collapsed ? '' : 'none';
    ico.textContent   = collapsed ? '▲' : '▼';
    btn.innerHTML     = `<span id="ico-toggle-vendas">${collapsed ? '▲' : '▼'}</span> ${collapsed ? 'Recolher' : 'Expandir'}`;
}


function abrirDetalheVxe(descricao) {
    // Pega todos os itens com a mesma descrição da última renderização do vxe
    const rows = vxe._lastRows ? vxe._lastRows.filter(r => r.descricao === descricao) : [];
    if (!rows.length) return;

    document.getElementById('vxe-detail-nome').textContent = descricao;
    document.getElementById('vxe-detail-seg').textContent  = rows[0]?.segmento || '';

    const labels  = { ok: 'EQUILÍBRIO', critico: 'CRÍTICO', excesso: 'EXCESSO', 'sem-dados': '—' };
    const cores   = { ok: '#26a69a',     critico: '#f06292',  excesso: '#ffab76', 'sem-dados': '#8b949e' };

    document.getElementById('vxe-detail-tbody').innerHTML = rows.map(r => {
        const cob = r.vendMedia > 0 ? (r.estProcesso / r.vendMedia) : null;
        const cobTxt = cob !== null
            ? `<span style="color:${cob < 1 ? '#f06292' : cob <= 3 ? '#26a69a' : '#ffab76'};font-weight:600;">${cob.toFixed(1)} meses</span>`
            : '—';
        const stColor = cores[r.st] || '#8b949e';
        return `<tr>
            <td class="td-code">${escHTML(r.codigo)}</td>
            <td class="td-center"><strong>${r.tamanho}</strong></td>
            <td class="td-right">${r.vendTotal.toLocaleString('pt-BR')}</td>
            <td class="td-right" style="color:var(--indigo-primary);">${r.vendMedia.toLocaleString('pt-BR')}</td>
            <td class="td-right">${r.estQtd !== null ? r.estQtd.toLocaleString('pt-BR') : '—'}</td>
            <td class="td-right" style="color:#26a69a;">${r.estProcesso.toLocaleString('pt-BR')}</td>
            <td class="td-right">${cobTxt}</td>
            <td class="td-center"><span style="color:${stColor};font-weight:600;font-size:0.7rem;">${labels[r.st]}</span></td>
        </tr>`;
    }).join('');

    document.getElementById('vxe-detail-overlay').style.display = 'block';
    document.getElementById('vxe-detail-panel').classList.add('open');
}

function fecharDetalheVxe() {
    document.getElementById('vxe-detail-overlay').style.display = 'none';
    document.getElementById('vxe-detail-panel').classList.remove('open');
}

// ═══ COCKPIT EXECUTIVO — consolida os dois domínios (SIGS planejamento + MES execução) ═══
const cockpit = {
    async render() {
        const body = document.getElementById('cockpit-body');
        if (!body) return;
        body.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text-dim);">Consolidando os dois domínios…</div>`;
        const [maqUni, ind, andon, carteira, prods] = await Promise.all([
            api.get('/api/maquinas-unificado').catch(() => []),
            api.get('/api/mf/indicadores').catch(() => null),
            api.get('/api/mf/andon').catch(() => []),
            api.get('/api/op-unificado').catch(() => []),
            api.get('/api/mf/produtos').catch(() => []),
        ]);
        // ── EXECUÇÃO (MES) ──
        const teares = (maqUni || []).filter(m => /^stoll/i.test(m.id_maquina || '') && String(m.status || '').toLowerCase() !== 'inativo');
        const porModelo = {};
        teares.forEach(m => { const k = m.modelo || '—'; porModelo[k] = (porModelo[k] || 0) + 1; });
        const cart = Array.isArray(carteira) ? carteira : [];
        const qtdCarteira = cart.reduce((s, o) => s + (Number(o.dados?.Qtd) || 0), 0);
        const emProd = cart.filter(o => /produ/i.test(o.dados?.Status || '')).length;
        const andonAbertos = (Array.isArray(andon) ? andon : []).filter(a => a.status && a.status !== 'resolvido').length;
        // /api/mf/indicadores devolve oee como ARRAY (uma linha por máquina da vw_oee) — média das válidas
        const oeeArr = Array.isArray(ind?.oee) ? ind.oee.map(r => Number(r.oee)).filter(v => Number.isFinite(v)) : [];
        const oee = oeeArr.length ? oeeArr.reduce((a, b) => a + b, 0) / oeeArr.length : null;
        const oeeTxt = (oee != null && oee > 0) ? (Math.round(oee * 10) / 10) + '%' : '<span style="color:var(--text-dim);font-size:.8rem;">aguardando apontamento</span>';
        const nProdMes = Array.isArray(prods) ? prods.length : 0;
        // ── PLANEJAMENTO (SIGS, em memória) ──
        const nSkusVendas = (vendas?.rawData?.length) || 0;
        const nEstoque = (estoque?.rawData?.length) || 0;
        const nBanco = (banco?.rawData?.length) || 0;

        const card = (label, valor, cor, sub) => `
            <div class="summary-card" style="text-align:center;padding:16px 10px;border-top:3px solid ${cor};">
                <div style="font-size:1.7rem;font-weight:800;color:${cor};line-height:1.1;">${valor}</div>
                <div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em;margin-top:6px;">${label}</div>
                ${sub ? `<div style="font-size:.7rem;color:var(--text-dim);margin-top:3px;">${sub}</div>` : ''}
            </div>`;
        const teaTab = Object.entries(porModelo).sort().map(([m, n]) =>
            `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.85rem;">
                <span style="color:var(--text-primary);">Stoll ${m}</span><strong style="color:#ff5252;">${n} tear${n > 1 ? 'es' : ''}</strong></div>`).join('');

        body.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:22px;">
                ${card('OPs na carteira', cart.length.toLocaleString('pt-BR'), '#26c6da', emProd + ' em produção')}
                ${card('Qtd planejada', Math.round(qtdCarteira).toLocaleString('pt-BR'), '#7c4dff', 'unidades')}
                ${card('Teares ativos', teares.length, '#ff5252', 'Tecelagem (Stoll)')}
                ${card('Produtos (MES)', nProdMes, '#26a69a', 'catalogados')}
                ${card('OEE médio', oeeTxt, '#ffab76', 'execução real')}
                ${card('Andon aberto', andonAbertos, andonAbertos ? '#f06292' : '#3fb950', 'chamados agora')}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
                <div class="summary-card">
                    <div class="s-label" style="margin-bottom:12px;">🧠 PLANEJAMENTO — SIGS / Stoll</div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="color:var(--text-dim);">SKUs com histórico de vendas</span><strong>${nSkusVendas.toLocaleString('pt-BR')}</strong></div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="color:var(--text-dim);">Itens em estoque</span><strong>${nEstoque.toLocaleString('pt-BR')}</strong></div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;"><span style="color:var(--text-dim);">Itens no banco de dados (cadastro)</span><strong>${nBanco.toLocaleString('pt-BR')}</strong></div>
                    <div style="font-size:.72rem;color:var(--text-dim);margin-top:10px;">Decide <strong>o que</strong> e <strong>quanto</strong> produzir (Previsão · Política · Plano · TOC · Preactor).</div>
                </div>
                <div class="summary-card">
                    <div class="s-label" style="margin-bottom:12px;">⚙️ EXECUÇÃO — MES / Malha Forte</div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="color:var(--text-dim);">Carteira (OPs do ERP)</span><strong>${cart.length}</strong></div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="color:var(--text-dim);">Em produção agora</span><strong style="color:#26c6da;">${emProd}</strong></div>
                    <div style="padding:8px 0 2px;"><div style="font-size:.72rem;color:var(--text-dim);margin-bottom:6px;">CAPACIDADE TECELAGEM</div>${teaTab || '<span style="color:var(--text-dim);">—</span>'}</div>
                    <div style="font-size:.72rem;color:var(--text-dim);margin-top:10px;">Executa e <strong>mede</strong> o realizado (Apontamento · Andon · OEE · Qualidade).</div>
                </div>
            </div>
            <div style="font-size:.72rem;color:var(--text-dim);margin-top:16px;text-align:center;">
                Fonte única integrada · carteira e capacidade vêm do MES Malha Forte; vendas/estoque/cadastro do SIGS. ${(oee == null || !(oee > 0)) ? 'OEE/qualidade aparecem quando a fábrica começar a apontar no MES.' : ''}
            </div>`;
    }
};

// Fase 3 (Plano→Chão): sequencia a carteira por EDD e empurra a prioridade ao chão (Fila do MES)
async function sequenciarCarteira() {
    if (!confirm('Sequenciar a carteira por data de entrega (EDD) e enviar a prioridade para o chão?\n\nAs prioridades que o operador já ajustou manualmente na Fila são PRESERVADAS (OK para sobrescrever tudo → Cancelar e use "forçar").')) return;
    const r = await api.post('/api/mf/sequenciar-carteira', {});
    if (r?.ok) mostrarToast(`✓ Sequenciado por EDD: ${r.urgente} urgentes · ${r.alta} alta · ${r.normal} normal${r.preservadas ? ` · ${r.preservadas} manuais preservadas` : ''} — enviado ao chão.`);
    else mostrarToast('Erro ao sequenciar carteira.', 'erro');
}

function navigateTo(viewName) {
    if (viewName !== 'dashboard') localStorage.setItem('sin1_lastView', viewName);
    fecharDetalhe();
    fecharDetalheVxe();
    ['dashboard','vendas','cliente','banco','estoque','op','costura','calendario','processos','capacidade','toc','previsao','politica','plano-prod','soep','timeline','pesquisa','vxe','op-dash','pedidos','comparador','clientes-dash','abc','abc-micro','abc-estoque','mes','cockpit'].forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.style.display = v === viewName ? 'flex' : 'none';
    });

    document.querySelectorAll('.nav-section li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('.sub-menu li').forEach(li => li.classList.remove('sub-active'));

    // ① Config  ② Import  ③ S&OP  ④ TOC  ⑤ Preactor  ⑥ MES  ⑦ Dashboards
    const navMap = {
        // ① Configuração
        banco:         'nav-config',
        processos:     'nav-config',
        capacidade:    'nav-config',
        calendario:    'nav-config',
        // ② Importação
        vendas:        'nav-import',
        estoque:       'nav-import',
        op:            'nav-import',
        cliente:       'nav-import',
        costura:       'nav-import',
        // ③ S&OP
        previsao:      'nav-soep-grp',
        politica:      'nav-soep-grp',
        'plano-prod':  'nav-soep-grp',
        soep:          'nav-soep-grp',
        // ④ TOC
        toc:           'nav-toc',
        // ⑤ Preactor
        timeline:      'nav-preactor',
        // ⑥ MES
        mes:           'nav-mes',
        // ★ Executivo
        dashboard:     'nav-painel',
        cockpit:       'nav-cockpit',
        // ⑦ Dashboards
        pesquisa:      'nav-pesquisa',
        vxe:           'nav-vxe',
        'op-dash':     'nav-op-dash',
        pedidos:       'nav-pedidos',
        comparador:    'nav-comparador',
        'clientes-dash':'nav-clientes-dash',
        abc:           'nav-abc-cruzada',
        'abc-micro':   'nav-abc-cruzada',
        'abc-estoque': 'nav-abc-cruzada',
    };
    const navEl = document.getElementById(navMap[viewName]);
    if (navEl) navEl.classList.add('active');

    if (viewName === 'dashboard') {
        setTimeout(() => homeDash.render(), 100);
    } else if (viewName === 'vendas') {
        document.querySelector('[data-view="vendas"]')?.classList.add('sub-active');
        setTimeout(() => { if (vendas.rawData.length) vendas.render(); else vendas.carregarHistorico(); }, 50);
    } else if (viewName === 'banco') {
        document.querySelector('[data-view="banco"]')?.classList.add('sub-active');
        setTimeout(() => {
            if (banco.rawData.length) {
                document.getElementById('banco-drop-zone').style.display = 'none';
                document.getElementById('banco-data').classList.add('visible');
                banco.render();
            } else { banco.carregarHistorico(); }
        }, 50);
    } else if (viewName === 'estoque') {
        document.querySelector('[data-view="estoque"]')?.classList.add('sub-active');
        setTimeout(() => { if (estoque.rawData.length) { estoque.mostrarDados(); estoque.render(); } else { estoque.carregarHistorico(); } }, 50);
    } else if (viewName === 'op') {
        document.querySelector('[data-view="op"]')?.classList.add('sub-active');
        setTimeout(() => {
            if (op.rawData.length) {
                document.getElementById('op-drop-zone').style.display = 'none';
                document.getElementById('op-data').classList.add('visible');
                op.render();
            } else { op.carregarHistorico(); }
        }, 50);
    } else if (viewName === 'costura') {
        document.querySelector('[data-view="costura"]')?.classList.add('sub-active');
        setTimeout(() => {
            if (costura.rawData.length) {
                document.getElementById('costura-drop-zone').style.display = 'none';
                document.getElementById('costura-data').classList.add('visible');
                costura.render();
            } else { costura.carregarHistorico(); }
        }, 50);
    } else if (viewName === 'cliente') {
        document.querySelector('[data-view="cliente"]')?.classList.add('sub-active');
        setTimeout(() => {
            if (cliente.rawData.length) {
                document.getElementById('cliente-drop-zone').style.display = 'none';
                document.getElementById('cliente-data').classList.add('visible');
                cliente.render();
            } else { cliente.carregarHistorico(); }
        }, 50);
    } else if (viewName === 'calendario') {
        document.querySelector('[data-view="calendario"]')?.classList.add('sub-active');
        disponibilidade.abrirAba(disponibilidade._abaAtiva);
        disponibilidade.carregarFeriados().catch(() => {});
        disponibilidade.carregarTurnos().catch(() => {});
    } else if (viewName === 'processos') {
        document.querySelector('[data-view="processos"]')?.classList.add('sub-active');
        processosGerenciamento.voltarLista();
        processosGerenciamento.carregarProcessos();
    } else if (viewName === 'capacidade') {
        document.querySelector('[data-view="capacidade"]')?.classList.add('sub-active');
    } else if (viewName === 'toc') {
        toc._popularAnos();
        toc._renderCapacidade();
        // Se veio do OP Dashboard com fila, mostra imediatamente
        if (toc._filaGargalo.length) {
            const gargalo = toc._resultProcs?.filter(p=>!p.semDados).sort((a,b)=>(b.util||0)-(a.util||0))[0] || null;
            toc._renderFilaGargalo(gargalo);
        }
    } else if (viewName === 'cockpit') {
        document.getElementById('nav-cockpit')?.classList.add('active');
        cockpit.render();
    } else if (viewName === 'pesquisa') {
        document.getElementById('nav-pesquisa')?.classList.add('active');
        if (pesquisa._dirty) { pesquisa.populateFiltros(); pesquisa._dirty = false; }
        pesquisa.render();
    } else if (viewName === 'vxe') {
        vxe.render();
        vxe._dirty = false;
    } else if (viewName === 'pedidos') {
        document.getElementById('nav-pedidos')?.classList.add('active');
        pedidos.render();
    } else if (viewName === 'comparador') {
        document.getElementById('nav-comparador')?.classList.add('active');
        comparador._dirty = false;
        comparador.render();
    } else if (viewName === 'clientes-dash') {
        document.getElementById('nav-clientes-dash')?.classList.add('active');
        if (cliente.rawData.length) {
            clientesDash._dirty = false;
            clientesDash.render();
        } else {
            cliente.carregarHistorico().then(() => { clientesDash._dirty = false; clientesDash.render(); });
        }
    } else if (viewName === 'op-dash') {
        document.getElementById('nav-op-dash')?.classList.add('active');
        if (opDash._dirty || !opDash._rows.length) opDash.render();
        opDash._dirty = false;
    } else if (viewName === 'abc') {
        document.querySelector('[data-view="abc"]')?.classList.add('sub-active');
        setTimeout(() => abc.render(), 50);
    } else if (viewName === 'abc-micro') {
        document.querySelector('[data-view="abc-micro"]')?.classList.add('sub-active');
        setTimeout(() => abcMicro.render(), 50);
    } else if (viewName === 'abc-estoque') {
        document.querySelector('[data-view="abc-estoque"]')?.classList.add('sub-active');
        setTimeout(() => abcEstoque.render(), 50);
    } else if (viewName === 'previsao') {
        document.querySelector('[data-view="previsao"]')?.classList.add('sub-active');
        previsao._populaSegFiltro();   // segmentos/modelos selecionáveis já na abertura (mesmo sem calcular)
        const acWrap = document.getElementById('prev-acuracia-wrap');
        if (acWrap) acWrap.style.display = soepDash._snapshots.length ? '' : 'none';
    } else if (viewName === 'politica') {
        document.querySelector('[data-view="politica"]')?.classList.add('sub-active');
        try {
            const saved = JSON.parse(localStorage.getItem('pol-params') || '{}');
            if (saved.leadTime != null) { const e = document.getElementById('pol-lead');  if (e) e.value = saved.leadTime; }
            if (saved.zBase   != null) { const e = document.getElementById('pol-nivel'); if (e) e.value = saved.zBase; }
            if (saved.nMeses  != null) { const e = document.getElementById('pol-hist');  if (e) e.value = saved.nMeses; }
            if (saved.usarPrev != null) { const e = document.getElementById('pol-usar-prev'); if (e) e.checked = !!saved.usarPrev; }
        } catch {}
        previsao._togglePolBadge();   // mostra o selo do plano se "usar Previsão" estiver ligado
    } else if (viewName === 'plano-prod') {
        document.querySelector('[data-view="plano-prod"]')?.classList.add('sub-active');
        previsao._renderBadge('plano-prod-badge', 'plano-prod');
        if (previsao._forecast.length) setTimeout(() => planoProducao.render(), 50);
    } else if (viewName === 'soep') {
        document.querySelector('[data-view="soep"]')?.classList.add('sub-active');
        setTimeout(() => soepDash.render(), 50);
    } else if (viewName === 'timeline') {
        preactor._popularMeses();
        if (!banco.rawData.length) banco.carregarHistorico().catch(() => {});
        if (!op.rawData.length)    op.carregarHistorico().catch(() => {});
    } else if (viewName === 'mes') {
        document.getElementById('nav-mes')?.classList.add('active');
        mes.init();
    }
}

// ====== VENDAS MODULE ======

const MONTHS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

const vendas = {
    rawData: [],
    filtered: [],
    monthCols: [],      // [{ key, abbr, year, label, originalCol }]
    extraCols: [],      // colunas extras do arquivo (não mapeadas)
    years: [],          // anos detectados no arquivo
    selectedYear: 'all',
    selectedMonth: null,
    mediaMeses: [],     // keys selecionados para cálculo de média

    init() {
        this.setupDropZone();
        this.setupMediaFilter();
        this.setupFileInput();
        this.setupFilters();
        this.setupYearTabs();
        this.setupChartClick();
        this.setupModal();
    },

    setupMediaFilter() {
        const btn  = document.getElementById('media-btn');
        const drop = document.getElementById('media-dropdown');
        if (!btn || !drop) return;
        btn.addEventListener('click', e => {
            e.stopPropagation();
            drop.style.display = drop.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('mousedown', e => {
            if (!e.target.closest('#media-wrap')) drop.style.display = 'none';
        });
    },

    populateMediaFilter() {
        const checks = document.getElementById('media-checks');
        if (!checks) return;
        const activeCols = this.getActiveCols();
        checks.innerHTML = activeCols.map(c =>
            `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.8rem;color:#e6edf3;padding:2px 0;">
                <input type="checkbox" data-key="${c.key}" ${this.mediaMeses.includes(c.key) ? 'checked' : ''}
                    style="accent-color:#26c6da;cursor:pointer;width:14px;height:14px;">
                ${c.label}
            </label>`
        ).join('');
        checks.querySelectorAll('input[type=checkbox]').forEach(cb => {
            cb.addEventListener('change', () => {
                const key = cb.dataset.key;
                if (cb.checked) { if (!this.mediaMeses.includes(key)) this.mediaMeses.push(key); }
                else { this.mediaMeses = this.mediaMeses.filter(k => k !== key); }
                this._updateMediaBtn();
                this.render();
            });
        });
    },

    _updateMediaBtn() {
        const btn = document.getElementById('media-btn');
        if (!btn) return;
        if (!this.mediaMeses.length) { btn.textContent = 'Selecionar meses'; return; }
        const labels = this.mediaMeses.map(k => {
            const c = this.monthCols.find(m => m.key === k);
            return c ? c.label : k;
        });
        btn.textContent = labels.join('+') + ' (÷' + labels.length + ')';
    },

    limparMedia() {
        this.mediaMeses = [];
        this._updateMediaBtn();
        this.populateMediaFilter();
        this.render();
    },

    setupDropZone() {
        const zone = document.getElementById('drop-zone');
        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) this.handleFile(file);
        });
    },

    setupFileInput() {
        const input = document.getElementById('file-input');
        input.addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) this.handleFile(file);
            input.value = '';
        });
    },

    setupYearTabs() {
        document.getElementById('year-tabs').addEventListener('click', e => {
            const btn = e.target.closest('.year-tab');
            if (!btn) return;
            document.querySelectorAll('.year-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.selectedYear  = btn.dataset.year;
            this.selectedMonth = null;
            this.render();
        });
    },

    setupChartClick() {
        const canvas = document.getElementById('vendas-chart');
        canvas.style.cursor = 'pointer';
        canvas.addEventListener('click', e => {
            const activeCols  = this.getActiveCols();
            const activeAbbrs = MONTHS.filter(m => activeCols.some(c => c.abbr === m));
            if (!activeAbbrs.length) return;

            const rect = canvas.getBoundingClientRect();
            const x    = (e.clientX - rect.left) * (canvas.width / rect.width);
            const padX = 20;
            const barW = (canvas.width - padX * 2) / activeAbbrs.length;
            const idx  = Math.floor((x - padX) / barW);

            if (idx >= 0 && idx < activeAbbrs.length) {
                const clicked      = activeAbbrs[idx];
                this.selectedMonth = this.selectedMonth === clicked ? null : clicked;
                this.render();
            }
        });
    },

    setupFilters() {
        ['filter-segmento', 'filter-marca', 'filter-modelo', 'filter-tamanho', 'filter-descricao'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.applyFilters());
        });
        document.getElementById('search-input').addEventListener('input', () => this.applyFilters());
        document.getElementById('filter-mes').addEventListener('change', e => {
            this.selectedMonth = e.target.value || null;
            this.render();
        });
        document.getElementById('filter-year').addEventListener('change', e => {
            this.selectedYear = e.target.value;
            this.render();
        });
        document.getElementById('clear-filters-btn').addEventListener('click', () => {
            document.getElementById('filter-segmento').value  = '';
            document.getElementById('filter-marca').value     = '';
            document.getElementById('filter-modelo').value    = '';
            document.getElementById('filter-tamanho').value   = '';
            document.getElementById('filter-descricao').value = '';
            document.getElementById('filter-mes').value       = '';
            document.getElementById('search-input').value     = '';
            document.getElementById('filter-year').value      = 'all';
            this.selectedYear  = 'all';
            this.selectedMonth = null;
            this.applyFilters();
        });
    },

    handleFile(file) {
        this._nomeArquivo = file.name;
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'csv') {
            this.parseCSV(file);
        } else if (ext === 'xls' || ext === 'xlsx') {
            this.parseXLS(file);
        } else {
            alert('Formato não suportado. Use .CSV, .XLS ou .XLSX.');
        }
    },

    parseCSV(file) {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: result => this.processData(result.data)
        });
    },

    parseXLS(file) {
        const reader = new FileReader();
        reader.onload = e => {
            const workbook = XLSX.read(e.target.result, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];

            // header:1 retorna arrays → sem reordenação de chaves numéricas pelo JS
            const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true,  defval: '' });
            const fmtRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' });
            if (rawRows.length < 2) { this.processData([]); return; }

            const rawH = rawRows[0]; // [val1, val2, ...] em ordem de coluna
            const fmtH = fmtRows[0];

            // keyMap: valor raw do cabeçalho → chave formatada (datas viram "2026-05-01")
            const keyMap = {};
            rawH.forEach((rv, i) => { keyMap[String(rv ?? '')] = String(fmtH[i] ?? rv ?? ''); });

            const data = rawRows.slice(1).map(arr => {
                const obj = {};
                rawH.forEach((rv, i) => {
                    const k = keyMap[String(rv ?? '')] || String(rv ?? '');
                    if (k) obj[k] = arr[i] ?? '';
                });
                return obj;
            });

            this.processData(data);
        };
        reader.readAsArrayBuffer(file);
    },

    normalizeKey(key) {
        return String(key)
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]/g, '');
    },

    detectMonthCols(headers) {
        // Lookup: nome/número normalizado → abreviação
        const BY_NAME = {
            jan:'jan', janeiro:'jan', january:'jan',
            fev:'fev', fevereiro:'fev', february:'fev', feb:'fev',
            mar:'mar', marco:'mar', march:'mar',
            abr:'abr', abril:'abr', april:'abr', apr:'abr',
            mai:'mai', maio:'mai', may:'mai',
            jun:'jun', junho:'jun', june:'jun',
            jul:'jul', julho:'jul', july:'jul',
            ago:'ago', agosto:'ago', august:'ago', aug:'ago',
            set:'set', setembro:'set', september:'set', sep:'set',
            out:'out', outubro:'out', october:'out', oct:'out',
            nov:'nov', novembro:'nov', november:'nov',
            dez:'dez', dezembro:'dez', december:'dez', dec:'dez'
        };
        const BY_NUM = {
            '01':'jan','1':'jan','02':'fev','2':'fev','03':'mar','3':'mar',
            '04':'abr','4':'abr','05':'mai','5':'mai','06':'jun','6':'jun',
            '07':'jul','7':'jul','08':'ago','8':'ago','09':'set','9':'set',
            '10':'out','11':'nov','12':'dez'
        };

        const result = [], seen = new Set();

        headers.forEach(col => {
            if (seen.has(col)) return;
            const norm = this.normalizeKey(col);

            // Extrai ano: 4 dígitos (2025, 2026) ou 2 dígitos no fim (25, 26)
            let year = null;
            const m4 = norm.match(/(20\d{2})/);
            if (m4) {
                year = m4[1];
            } else {
                // ex: jan26, fev25 → ano = 2026, 2025
                const m2 = norm.match(/^[a-z]+(\d{2})$/) || norm.match(/^\d{1,2}(\d{2})$/);
                if (m2 && parseInt(m2[1]) >= 20) year = '20' + m2[1];
            }

            // Remove o ano (4 ou 2 dígitos) para isolar a parte do mês
            const withoutYear = year
                ? norm.replace(year, '').replace(year.slice(2), '').replace(/[^a-z0-9]/g, '')
                : norm;

            let abbr = null;

            // 1) match exato
            if (BY_NAME[withoutYear]) {
                abbr = BY_NAME[withoutYear];
            }
            // 2) match por número
            else if (BY_NUM[withoutYear]) {
                abbr = BY_NUM[withoutYear];
            }
            // 3) starts-with (ex: "marco" começa com "mar")
            else {
                for (const [token, a] of Object.entries(BY_NAME)) {
                    if (token.length >= 3 && withoutYear.startsWith(token)) { abbr = a; break; }
                }
            }

            // 4) formato data ISO: yyyymmdd ou yyyy-mm (ex: "20260501", "2026-05")
            if (!abbr) {
                const isoFull  = norm.match(/^(20\d{2})(\d{2})\d{2}$/);
                const isoShort = norm.match(/^(20\d{2})[-\/]?(\d{2})$/);
                const m = isoFull || isoShort;
                if (m && BY_NUM[m[2]]) {
                    year = m[1];
                    abbr = BY_NUM[m[2]];
                }
            }

            // 5) número serial do Excel (ex: 46017 = 2026-05-01)
            if (!abbr && /^\d{4,6}$/.test(norm)) {
                const serial = parseInt(norm);
                if (serial > 40000 && serial < 60000) {
                    const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
                    const y = d.getUTCFullYear(), mo = String(d.getUTCMonth() + 1).padStart(2,'0');
                    if (y >= 2020 && y <= 2035 && BY_NUM[mo]) {
                        year = String(y);
                        abbr = BY_NUM[mo];
                    }
                }
            }

            if (abbr) {
                const key   = year ? `${abbr}_${year}` : abbr;
                const mLbl  = abbr.charAt(0).toUpperCase() + abbr.slice(1);
                const label = year ? `${mLbl}/${year.slice(2)}` : mLbl;
                result.push({ key, abbr, year, label, originalCol: col });
                seen.add(col);
            }
        });

        result.sort((a, b) => {
            const ya = a.year || '0000', yb = b.year || '0000';
            if (ya !== yb) return ya.localeCompare(yb);
            return MONTHS.indexOf(a.abbr) - MONTHS.indexOf(b.abbr);
        });

        return result;
    },

    getActiveCols() {
        if (this.selectedYear === 'all') return this.monthCols;
        return this.monthCols.filter(c => c.year === this.selectedYear);
    },

    processData(rawRows) {
        if (!rawRows || !rawRows.length) {
            alert('Arquivo vazio ou sem dados válidos.');
            return;
        }

        const keyMap = {};
        Object.keys(rawRows[0]).forEach(k => {
            keyMap[this.normalizeKey(k)] = k;
        });

        const get = (row, ...candidates) => {
            for (const c of candidates) {
                if (keyMap[c] !== undefined) {
                    const val = row[keyMap[c]];
                    return val !== undefined && val !== null ? String(val) : '';
                }
            }
            return '';
        };

        const toNum = v => {
            if (typeof v === 'number') return v;
            const clean = String(v).replace(/[^\d,.\-]/g, '').replace(',', '.');
            return parseFloat(clean) || 0;
        };

        const allHeaders  = Object.keys(rawRows[0]);
        this.monthCols    = this.detectMonthCols(allHeaders);
        this.years        = [...new Set(this.monthCols.map(c => c.year).filter(Boolean))].sort();
        this.selectedYear = 'all';

        const monthOrigCols = new Set(this.monthCols.map(mc => mc.originalCol));
        const KNOWN_NORM = new Set(['codigo', 'descricao', 'modelo', 'segmento', 'tamanho', 'marca',
            'quantidade', 'qtd', 'qty', 'qtde', 'valor', 'valorrs', 'valortotal', 'valorr']);
        this.extraCols = allHeaders.filter(h =>
            !monthOrigCols.has(h) && !KNOWN_NORM.has(this.normalizeKey(h))
        );

        this.rawData = rawRows.map((row, i) => {
            const mData = {};
            this.monthCols.forEach(mc => {
                const val = row[mc.originalCol];
                mData[mc.key] = val !== undefined && val !== null ? toNum(val) : 0;
            });

            const extras = {};
            this.extraCols.forEach(col => {
                const val = row[col];
                extras[col] = val !== undefined && val !== null ? String(val) : '';
            });

            return {
                _id: i,
                codigo:    get(row, 'codigo'),
                descricao: get(row, 'descricao'),
                modelo:    get(row, 'modelo'),
                segmento:  get(row, 'segmento'),
                tamanho:   get(row, 'tamanho'),
                marca:     get(row, 'marca').trim(),
                _extras: extras,
                ...mData,
                quantidade: toNum(get(row, 'quantidade', 'qtd', 'qty', 'qtde')),
                valor:      toNum(get(row, 'valor', 'valorrs', 'valortotal', 'valorr'))
            };
        });

        this.filtered = [...this.rawData];
        this.mediaMeses = [];
        this.populateFilters();
        this.populateMediaFilter();
        this.showDataSection();
        this.render();
        this._sincronizarDashboards();
        this.perguntarESalvar(this._nomeArquivo || 'importacao');
    },

    // ── Fluxo de salvar ────────────────────────────────────────
    async perguntarESalvar(nomeArquivo) {
        this._nomeArquivoAtual = nomeArquivo;
        await this.salvarImportacao('nova');
    },

    async salvarImportacao(modo) {
        document.getElementById('import-modal').style.display = 'none';
        this.setSalvando(true);
        let sucesso = false;
        try {
            if (modo === 'substituir') {
                const lista = await api.listarImportacoes();
                for (const imp of (lista || [])) await api.deletarImportacao(imp.id);
            }
            const res = await api.salvarImport(this._nomeArquivoAtual, this.rawData, this.monthCols);
            if (res?.ok) { this._currentId = res.importacaoId; sucesso = true; }
        } catch (e) { console.error('Erro ao salvar:', e); }
        finally { this.setSalvando(false); }
        await this.carregarHistorico();
        if (sucesso) {
            historico.registrar('importar', 'vendas', `${this.rawData.length} itens — ${this._nomeArquivoAtual}`);
            mostrarToast(`✓ ${this.rawData.length.toLocaleString('pt-BR')} itens salvos`);
            const list = document.getElementById('history-list');
            const chev = document.getElementById('chevron-vendas');
            if (list && list.style.display === 'none') {
                list.style.display = 'flex';
                if (chev) chev.style.transform = 'rotate(90deg)';
            }
        }
    },

    setSalvando(ativo) {
        const el = document.getElementById('history-saving');
        if (el) el.style.display = ativo ? 'inline' : 'none';
    },

    // ── Histórico ─────────────────────────────────────────────
    async carregarHistorico() {
        const lista = await api.listarImportacoes();
        this._importacoes = lista || [];
        if (lista?.length) {
            const latest   = lista[0];
            const incompleto = this.rawData.length < (latest.total_linhas || 0);
            if (!this._currentId || this._currentId !== latest.id || incompleto) {
                await this.carregarImportacao(latest.id); return;
            }
        }
        this.renderHistorico();
    },

    async carregarImportacao(id) {
        this.setSalvando(true);
        const rows = await api.getVendas(id);
        this.setSalvando(false);
        if (!rows || !rows.length) return;

        // Reconstrói monthCols a partir das chaves do JSONB
        const allKeys = [...new Set(rows.flatMap(r => Object.keys(r.meses || {})))];
        this.monthCols = allKeys.map(key => {
            const [abbr, year] = key.split('_');
            const mLbl  = abbr.charAt(0).toUpperCase() + abbr.slice(1);
            const label = year ? `${mLbl}/${year.slice(2)}` : mLbl;
            return { key, abbr, year: year || null, label, originalCol: key };
        }).sort((a, b) => {
            const ya = a.year || '0000', yb = b.year || '0000';
            if (ya !== yb) return ya.localeCompare(yb);
            return MONTHS.indexOf(a.abbr) - MONTHS.indexOf(b.abbr);
        });

        this.years        = [...new Set(this.monthCols.map(c => c.year).filter(Boolean))].sort();
        this.selectedYear = this.years[0] || 'all';
        this._currentId   = id;

        // normK → usa normalizeKey global
        const KNOWN_LOAD = new Set(['marca']);
        const firstWithDados = rows.find(r => r.dados && Object.keys(r.dados).length > 0);
        this.extraCols = firstWithDados
            ? Object.keys(firstWithDados.dados).filter(k => !KNOWN_LOAD.has(normalizeKey(k)))
            : [];

        this.rawData  = rows.map((r, i) => {
            const dados = r.dados || {};
            const marcaKey = Object.keys(dados).find(k => normalizeKey(k) === 'marca');
            const extras = { ...dados };
            if (marcaKey) delete extras[marcaKey];
            // r.marca vem da coluna DB; fallback para dados['Marca'] de imports antigos
            const marca = (r.marca || (marcaKey ? (dados[marcaKey] || '') : '') || (dados['_marca'] || '')).trim();
            return {
                _id: i, codigo: r.codigo || '', descricao: r.descricao || '',
                modelo: r.modelo || '', segmento: r.segmento || '', tamanho: r.tamanho || '',
                marca,
                _extras: extras,
                ...(r.meses || {}),
                quantidade: Number(r.quantidade) || 0, valor: Number(r.valor) || 0
            };
        });
        this.filtered = [...this.rawData];
        this.mediaMeses = [];
        this._updateMediaBtn();
        this.populateFilters();
        this.populateMediaFilter();
        this.showDataSection();
        this.render();
        this.renderHistorico();
        this._sincronizarDashboards();
        lsCache.salvar('vendas', { importacaoId: id, rawData: this.rawData, monthCols: this.monthCols });
    },

    _sincronizarDashboards() {
        // VxE — atualiza ao vivo se visível, senão marca dirty
        const vxeView = document.getElementById('view-vxe');
        if (vxeView && vxeView.style.display !== 'none') {
            setTimeout(() => vxe.render(), 50);
        } else {
            vxe._dirty = true;
        }
        // ABC — marca dirty para recalcular na próxima navegação
        abc._items = [];
        abcMicro._items = [];
        // Pedidos — re-renderiza se visível
        const pedView = document.getElementById('view-pedidos');
        if (pedView && pedView.style.display !== 'none') {
            setTimeout(() => pedidos.render(), 50);
        }
        // opDash — marca dirty
        opDash._dirty = true;
        // comparador — re-renderiza se visível, senão dirty
        const compView = document.getElementById('view-comparador');
        if (compView && compView.style.display !== 'none') {
            setTimeout(() => comparador.render(), 50);
        } else {
            comparador._dirty = true;
        }
        // pesquisa — mapas estão desatualizados
        pesquisa._dirty = true;
        // Alertas — verifica críticos e atualiza badge
        setTimeout(() => alertas.verificar(), 200);
    },

    renderHistorico() {
        const wrap = document.getElementById('import-history');
        const list = document.getElementById('history-list');
        const chev = document.getElementById('chevron-vendas');
        if (!this._importacoes?.length) { wrap.style.display = 'none'; return; }

        wrap.style.display = 'block';
        list.innerHTML = this._importacoes.map(imp => {
            const d    = new Date(imp.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
            const anos = imp.anos?.join(', ') || '';
            const ativo = imp.id === this._currentId;
            return `
            <div class="hi-item${ativo ? ' hi-ativo' : ''}" onclick="vendas.carregarImportacao('${imp.id}')">
                <span class="hi-dot">${ativo ? '●' : '○'}</span>
                <div class="hi-info">
                    <span class="hi-nome">${escHTML(imp.nome_arquivo)}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} itens${anos ? ' · ' + anos : ''}</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();vendas.excluirImportacao('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
        list.style.display = 'flex';
        if (chev) chev.style.transform = 'rotate(90deg)';
    },

    async excluirImportacao(id) {
        if (!confirm('Excluir esta importação?')) return;
        await api.deletarImportacao(id);
        if (this._currentId === id) {
            this.rawData = []; this.filtered = [];
            document.getElementById('vendas-data').classList.remove('visible');
            document.getElementById('drop-zone').style.display = '';
        }
        await this.carregarHistorico();
    },

    setupModal() {
        document.getElementById('btn-substituir').addEventListener('click', () => {
            const modulo = document.getElementById('import-modal').dataset.modulo;
            if (modulo === 'estoque') estoque.salvar('substituir');
            else if (modulo === 'op') op.salvar('substituir');
            else if (modulo === 'costura') costura.salvar('substituir');
            else if (modulo === 'banco') banco.salvar('substituir');
            else if (modulo === 'cliente')    cliente.salvar('substituir');
            else if (modulo === 'calendario') calendario.salvar('substituir');
            else if (modulo === 'processos')  { /* processos gerenciado pelo novo módulo */ }
            else if (modulo === 'capacidade') capacidade.salvar('substituir');
            else this.salvarImportacao('substituir');
        });
        document.getElementById('btn-nova-imp').addEventListener('click', () => {
            const modulo = document.getElementById('import-modal').dataset.modulo;
            if (modulo === 'estoque') estoque.salvar('nova');
            else if (modulo === 'op') op.salvar('nova');
            else if (modulo === 'costura') costura.salvar('nova');
            else if (modulo === 'banco') banco.salvar('nova');
            else if (modulo === 'cliente')    cliente.salvar('nova');
            else if (modulo === 'calendario') calendario.salvar('nova');
            else if (modulo === 'processos')  { /* processos gerenciado pelo novo módulo */ }
            else if (modulo === 'capacidade') capacidade.salvar('nova');
            else this.salvarImportacao('nova');
        });
        document.getElementById('btn-cancelar-imp').addEventListener('click', () => {
            document.getElementById('import-modal').style.display = 'none';
        });
    },

    populateFilters() {
        const unique = key => [...new Set(this.rawData.map(r => String(r[key]||'').trim()).filter(Boolean))].sort();
        this.fillSelect('filter-segmento', unique('segmento'));
        this.fillSelectLabel('filter-marca', unique('marca'), 'Todas');
        this.fillSelect('filter-modelo',   unique('modelo'));
        this.fillSelect('filter-tamanho',  unique('tamanho'));
        this.fillSelectLabel('filter-descricao', unique('descricao'), 'Todas');

        // Popula filtro de mês
        const mesEl = document.getElementById('filter-mes');
        const curMes = this.selectedMonth || '';
        const uniqueAbbrs = [...new Set(this.monthCols.map(c => c.abbr))];
        mesEl.innerHTML = '<option value="">Todos</option>' +
            MONTHS.filter(m => uniqueAbbrs.includes(m))
                  .map(m => `<option value="${m}"${m === curMes ? ' selected' : ''}>${m.charAt(0).toUpperCase()+m.slice(1)}</option>`)
                  .join('');

        const tabs = document.getElementById('year-tabs');
        if (this.years.length > 0) {
            tabs.innerHTML = this.years.map((y, i) =>
                `<button class="year-tab${i === 0 ? ' active' : ''}" data-year="${y}">${y}</button>`
            ).join('');
            // Seleciona o primeiro ano por padrão
            if (this.years.length > 0) this.selectedYear = this.years[0];
        } else {
            tabs.innerHTML = '';
        }
    },

    fillSelect(id, options, current) {
        const sel = document.getElementById(id);
        sel.innerHTML = '<option value="">Todos</option>' +
            options.map(o => `<option value="${o}"${o === current ? ' selected' : ''}>${o}</option>`).join('');
    },

    fillSelectLabel(id, options, label, current) {
        const sel = document.getElementById(id);
        sel.innerHTML = `<option value="">${label}</option>` +
            options.map(o => `<option value="${o}"${o === current ? ' selected' : ''}>${o}</option>`).join('');
    },

    applyFilters() {
        const seg   = document.getElementById('filter-segmento').value;
        const marca = document.getElementById('filter-marca').value;
        const mod   = document.getElementById('filter-modelo').value;
        const tam   = document.getElementById('filter-tamanho').value;
        const desc  = document.getElementById('filter-descricao').value;
        const q     = document.getElementById('search-input').value.toLowerCase().trim();

        const match = (r, skip) => {
            if (skip !== 'seg'   && seg   && r.segmento  !== seg)   return false;
            if (skip !== 'marca' && marca && r.marca      !== marca) return false;
            if (skip !== 'mod'   && mod   && r.modelo     !== mod)   return false;
            if (skip !== 'tam'   && tam   && r.tamanho    !== tam)   return false;
            if (skip !== 'desc'  && desc  && r.descricao  !== desc)  return false;
            if (q && !r.codigo.toLowerCase().includes(q)) return false;
            return true;
        };

        this.filtered = this.rawData.filter(r => match(r, null));

        // Segmento e Marca: sempre todos os valores do arquivo (não cross-filtram)
        const uniqAll = key => [...new Set(this.rawData.map(r => String(r[key]||'').trim()).filter(Boolean))].sort();
        // Modelo, Tamanho, Descrição: cross-filtram baseado nos filtros ativos
        const uniq = (key, skip) =>
            [...new Set(this.rawData.filter(r => match(r, skip)).map(r => r[key]).filter(Boolean))].sort();

        this.fillSelect('filter-segmento',       uniqAll('segmento'),        seg);
        this.fillSelectLabel('filter-marca',     uniqAll('marca'), 'Todas',  marca);
        this.fillSelect('filter-modelo',         uniq('modelo',   'mod'),    mod);
        this.fillSelect('filter-tamanho',        uniq('tamanho',  'tam'),    tam);
        this.fillSelectLabel('filter-descricao', uniq('descricao','desc'), 'Todas', desc);

        this.render();
    },


    showDataSection() {
        document.getElementById('drop-zone').style.display = 'none';
        document.getElementById('vendas-data').classList.add('visible');
        const btnSalvar = document.getElementById('btn-salvar-vendas');
        if (btnSalvar) btnSalvar.style.display = '';
    },

    exportar() {
        if (!this.filtered.length) return;
        const activeCols = this.getActiveCols();
        const dados = this.filtered.map(r => {
            const obj = { Código: r.codigo, Descrição: r.descricao, Marca: r.marca, Modelo: r.modelo, Segmento: r.segmento, Tamanho: r.tamanho };
            activeCols.forEach(c => { obj[c.label] = r[c.key] || 0; });
            return obj;
        });
        exportarXLS(dados, 'vendas_' + (this.selectedYear || 'todos'));
    },

    async salvarManual() {
        if (!this.rawData.length) return;
        const btn = document.getElementById('btn-salvar-vendas');
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
        try {
            await this.salvarImportacao('nova');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
        }
    },

    render() {
        this.renderSummary();
        this.renderChart();
        this.renderTable();
    },

    renderSummary() {
        const activeCols = this.getActiveCols();

        // Quantidade total = soma de todos os meses ativos
        // Se mês selecionado, calcula só aquele mês
        const mCols  = this.selectedMonth ? activeCols.filter(c => c.abbr === this.selectedMonth) : activeCols;
        const rowQtd = r => mCols.reduce((s, c) => s + (r[c.key] || 0), 0);
        const total  = this.filtered.reduce((s, r) => s + rowQtd(r), 0);

        document.getElementById('summary-qtd').textContent =
            total.toLocaleString('pt-BR');
        document.getElementById('summary-qtd-sub').textContent =
            `${this.filtered.length.toLocaleString('pt-BR')} itens · ${this.selectedYear !== 'all' ? this.selectedYear : 'todos os anos'}`;

        // Card Faturamento — soma do campo valor (R$)
        const totalFat = this.filtered.reduce((s, r) => s + (Number(r.valor) || 0), 0);
        const cardFat  = document.getElementById('card-faturamento');
        const elFat    = document.getElementById('summary-faturamento');
        const elFatSub = document.getElementById('summary-faturamento-sub');
        if (cardFat && totalFat > 0) {
            elFat.textContent    = 'R$ ' + totalFat.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            elFatSub.textContent = `${this.filtered.length.toLocaleString('pt-BR')} itens`;
            cardFat.style.display = '';
        } else if (cardFat) {
            cardFat.style.display = 'none';
        }

        // Cards Código | Modelo | Tamanho
        const codigos  = new Set(this.filtered.map(r => r.codigo).filter(Boolean));
        const modelos  = new Set(this.filtered.map(r => r.modelo).filter(Boolean));
        const tamanhos = new Set(this.filtered.map(r => r.tamanho).filter(Boolean));
        const elCod = document.getElementById('summary-codigos');
        const elMod = document.getElementById('summary-modelos');
        const elTam = document.getElementById('summary-tamanhos');
        if (elCod) elCod.textContent = codigos.size.toLocaleString('pt-BR');
        if (elMod) elMod.textContent = modelos.size.toLocaleString('pt-BR');
        if (elTam) elTam.textContent = tamanhos.size.toLocaleString('pt-BR');

        // Delta ano anterior — mostra variação se dados de 2 anos disponíveis
        const anos = this.years || [];
        const deltaEl = document.getElementById('vendas-delta-card');
        const deltaValEl = document.getElementById('vendas-delta-val');
        if (deltaEl && deltaValEl && anos.length >= 2) {
            const [ano1, ano2] = anos.slice(-2);
            const cols1 = this.monthCols.filter(c => c.year === ano1);
            const cols2 = this.monthCols.filter(c => c.year === ano2);
            const mesComuns = [...new Set(cols1.map(c=>c.abbr))].filter(a => cols2.some(c=>c.abbr===a));
            if (mesComuns.length) {
                let v1=0, v2=0;
                this.rawData.forEach(r => {
                    mesComuns.forEach(a => {
                        const c1=cols1.find(c=>c.abbr===a), c2=cols2.find(c=>c.abbr===a);
                        if (c1) v1+=(r[c1.key]||0); if (c2) v2+=(r[c2.key]||0);
                    });
                });
                const pct = v1>0 ? ((v2-v1)/v1*100).toFixed(1) : null;
                if (pct !== null) {
                    deltaValEl.textContent = (pct>0?'+':'')+pct+'%';
                    deltaValEl.style.color = pct>0?'#26a69a':'#f06292';
                    deltaEl.querySelector('.s-label').textContent = `${ano1} → ${ano2}`;
                    deltaEl.style.display = '';
                }
            }
        } else if (deltaEl) { deltaEl.style.display = 'none'; }

        // Segmento — usa rawData para mostrar todos sempre (não só os filtrados)
        const segSelecionado = document.getElementById('filter-segmento').value;
        // Por Código — top 8 códigos por quantidade nos dados filtrados
        const byCod = {};
        this.filtered.forEach(r => {
            const k = r.codigo || '—';
            byCod[k] = (byCod[k] || 0) + rowQtd(r);
        });
        const topCods = Object.entries(byCod).sort((a,b) => b[1]-a[1]).slice(0, 8);
        const maxCod  = topCods[0]?.[1] || 1;
        const elPorCod = document.getElementById('summary-por-codigo');
        if (elPorCod) {
            elPorCod.innerHTML = topCods.map(([cod, qtd]) => {
                const w = (qtd / maxCod * 100).toFixed(0);
                return `<div class="bd-row" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="font-size:0.72rem;color:var(--indigo-primary);font-weight:600;min-width:52px;">${escHTML(cod)}</span>
                    <div style="flex:1;height:4px;border-radius:2px;background:var(--border);">
                        <div style="height:4px;border-radius:2px;background:var(--indigo-primary);width:${w}%;"></div>
                    </div>
                    <span style="font-size:0.72rem;color:var(--text-dim);min-width:40px;text-align:right;">${qtd.toLocaleString('pt-BR')}</span>
                </div>`;
            }).join('');
        }

        // Tamanho — usa os dados já filtrados (inclusive pelo segmento clicado)
        const byTam = {};
        this.filtered.forEach(r => {
            const k = r.tamanho || '—';
            byTam[k] = (byTam[k] || 0) + rowQtd(r);
        });
        document.getElementById('summary-tamanho').innerHTML =
            this.renderBreakdown(byTam, total, null, null);

        // Card de média
        const cardMedia = document.getElementById('card-media');
        if (this.mediaMeses.length > 0) {
            const n = this.mediaMeses.length;
            const totalMedia = this.filtered.reduce((s, r) =>
                s + this.mediaMeses.reduce((ms, k) => ms + (r[k] || 0), 0), 0);
            const media = totalMedia / n;
            const labels = this.mediaMeses.map(k => {
                const c = this.monthCols.find(m => m.key === k);
                return c ? c.label : k;
            });
            document.getElementById('card-media-label').textContent = labels.join(' + ') + ' ÷ ' + n;
            document.getElementById('card-media-valor').textContent = Math.round(media).toLocaleString('pt-BR');
            document.getElementById('card-media-sub').textContent =
                `unid./mês · ${this.filtered.length.toLocaleString('pt-BR')} itens`;
            if (cardMedia) cardMedia.style.display = '';
        } else {
            if (cardMedia) cardMedia.style.display = 'none';
        }
    },

    clickBreakdown(campo, valor) {
        const el = document.getElementById(`filter-${campo}`);
        if (!el) return;
        el.value = el.value === valor ? '' : valor;  // toggle
        this.applyFilters();
    },

    renderBreakdown(map, total, campo, selecionado) {
        return Object.entries(map)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([label, val]) => {
                const pct      = total > 0 ? Math.round(val / total * 100) : 0;
                const ativo    = selecionado === label;
                const clicavel = campo
                    ? `onclick="vendas.clickBreakdown('${escJS(campo)}','${escJS(label)}')"` : '';
                return `
                <div class="breakdown-item${ativo ? ' bd-ativo' : ''}${campo ? ' bd-click' : ''}" ${clicavel}>
                    <span class="bd-label">${escHTML(label)}</span>
                    <div class="bd-bar-wrap">
                        <div class="bd-bar" style="width:${pct}%"></div>
                    </div>
                    <span class="bd-val">${val.toLocaleString('pt-BR')}</span>
                </div>`;
            }).join('');
    },

    renderChart() {
        const activeCols = this.getActiveCols();
        const canvas = document.getElementById('vendas-chart');
        if (!canvas || !this.filtered.length || !activeCols.length) return;

        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.offsetWidth || 800;
        const h = canvas.height = 120;
        ctx.clearRect(0, 0, w, h);

        // Agrupa por mês (soma anos quando "todos")
        const activeAbbrs = MONTHS.filter(m => activeCols.some(c => c.abbr === m));
        const monthTotals = activeAbbrs.map(abbr =>
            activeCols
                .filter(c => c.abbr === abbr)
                .reduce((s, c) => s + this.filtered.reduce((s2, r) => s2 + (r[c.key] || 0), 0), 0)
        );

        // Título e tab ativo
        const yearLbl = this.selectedYear === 'all'
            ? (this.years.length > 1 ? 'TODOS OS ANOS' : (this.years[0] || ''))
            : this.selectedYear;
        const mLbl = this.selectedMonth
            ? ` • ${this.selectedMonth.charAt(0).toUpperCase() + this.selectedMonth.slice(1)}` : '';
        document.getElementById('chart-title').textContent =
            `QUANTIDADE POR MÊS${yearLbl ? ' • ' + yearLbl : ''}${mLbl}`;
        document.querySelectorAll('.year-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.year === this.selectedYear);
        });

        const max  = Math.max(...monthTotals) || 1;
        const padX = 20, padY = 24;
        const barW = (w - padX * 2) / activeAbbrs.length;

        monthTotals.forEach((val, i) => {
            const x         = padX + i * barW;
            const barH      = Math.max(((h - padY * 2) * val) / max, val > 0 ? 2 : 0);
            const y         = h - padY - barH;
            const isSel     = this.selectedMonth === activeAbbrs[i];
            const isOther   = this.selectedMonth && !isSel;

            // Barra selecionada: branca; outras: dimmed
            const grad = ctx.createLinearGradient(0, y, 0, h - padY);
            if (isSel) {
                grad.addColorStop(0, 'rgba(255,255,255,0.95)');
                grad.addColorStop(1, 'rgba(38,198,218,0.6)');
            } else if (isOther) {
                grad.addColorStop(0, 'rgba(38,198,218,0.3)');
                grad.addColorStop(1, 'rgba(38,198,218,0.08)');
            } else {
                grad.addColorStop(0, 'rgba(38,198,218,0.85)');
                grad.addColorStop(1, 'rgba(38,198,218,0.2)');
            }
            ctx.fillStyle = grad;

            const r2 = 3, bx = x + 4, by = y, bw = barW - 8, bh = barH;
            ctx.beginPath();
            ctx.moveTo(bx + r2, by);
            ctx.lineTo(bx + bw - r2, by);
            ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r2);
            ctx.lineTo(bx + bw, by + bh);
            ctx.lineTo(bx, by + bh);
            ctx.lineTo(bx, by + r2);
            ctx.quadraticCurveTo(bx, by, bx + r2, by);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = isSel ? 'rgba(255,255,255,0.9)' : isOther ? 'rgba(139,148,158,0.35)' : 'rgba(139,148,158,0.65)';
            ctx.font = isSel ? 'bold 9px Inter' : '9px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(activeAbbrs[i].charAt(0).toUpperCase() + activeAbbrs[i].slice(1), x + barW / 2, h - 6);

            if (val > 0) {
                ctx.fillStyle = isSel ? 'rgba(255,255,255,0.95)' : isOther ? 'rgba(230,237,243,0.3)' : 'rgba(230,237,243,0.7)';
                ctx.font = isSel ? 'bold 9px Inter' : '8px Inter';
                ctx.fillText(val.toLocaleString('pt-BR'), x + barW / 2, y - 4);
            }
        });
    },

    renderTable() {
        const cols  = this.getActiveCols();
        const table = document.getElementById('vendas-table');

        // Cabeçalho dinâmico — destaca coluna do mês selecionado
        const extras  = this.extraCols || [];
        const temMedia = this.mediaMeses.length > 0;
        const nMedia   = this.mediaMeses.length;
        table.querySelector('thead tr').innerHTML = `
            <th>CÓDIGO</th>
            <th>DESCRIÇÃO</th>
            <th>MODELO</th>
            <th>SEGMENTO</th>
            <th>MARCA</th>
            <th class="td-center">TAM.</th>
            ${extras.map(c => `<th>${c.toUpperCase()}</th>`).join('')}
            ${cols.map(c => {
                const sel = this.selectedMonth === c.abbr;
                return `<th class="th-month${sel ? ' th-month-sel' : ''}">${c.label.toUpperCase()}</th>`;
            }).join('')}
            ${temMedia ? `<th class="th-month th-month-sel" style="color:#26c6da;">MÉDIA (÷${nMedia})</th>` : ''}
            <th class="td-right">QTDE</th>
            <th class="td-right">VALOR R$</th>
        `;

        // Filtra e ordena pelo mês selecionado
        let displayRows = this.filtered;
        if (this.selectedMonth) {
            const mCols = cols.filter(c => c.abbr === this.selectedMonth);
            displayRows = displayRows
                .filter(r => mCols.some(c => (r[c.key] || 0) > 0))
                .sort((a, b) => {
                    const va = mCols.reduce((s, c) => s + (a[c.key] || 0), 0);
                    const vb = mCols.reduce((s, c) => s + (b[c.key] || 0), 0);
                    return vb - va;
                });
        }

        const rows = displayRows.slice(0, 2000);
        table.querySelector('tbody').innerHTML = rows.map(r => {
            const mediaVal = temMedia
                ? Math.round(this.mediaMeses.reduce((s, k) => s + (r[k] || 0), 0) / nMedia)
                : null;
            return `
            <tr onclick="abrirDetalhe('${escJS(r.descricao)}','${escJS(r.segmento)}')">
                <td class="td-code">${escHTML(r.codigo)}</td>
                <td class="td-desc">${escHTML(r.descricao)}</td>
                <td>${escHTML(r.modelo)}</td>
                <td><span class="seg-badge">${escHTML(r.segmento)}</span></td>
                <td>${r.marca ? escHTML(r.marca) : '<span style="opacity:.3">—</span>'}</td>
                <td class="td-center">${escHTML(r.tamanho)}</td>
                ${extras.map(c => {
                    const v = (r._extras || {})[c];
                    return `<td>${v ? escHTML(v) : '<span style="opacity:.3">—</span>'}</td>`;
                }).join('')}
                ${cols.map(c => {
                    const v   = r[c.key];
                    const sel = this.selectedMonth === c.abbr;
                    return `<td class="td-month${sel ? ' td-month-sel' : ''}">${v ? v.toLocaleString('pt-BR') : '<span style="opacity:.3">—</span>'}</td>`;
                }).join('')}
                ${temMedia ? `<td class="td-month td-month-sel" style="color:#26c6da;font-weight:600;">${mediaVal ? mediaVal.toLocaleString('pt-BR') : '<span style="opacity:.3">—</span>'}</td>` : ''}
                <td class="td-qtd">${r.quantidade.toLocaleString('pt-BR')}</td>
                <td class="td-valor">${r.valor ? 'R$ ' + r.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '<span style="opacity:.3">—</span>'}</td>
            </tr>`;
        }).join('');

        const total  = displayRows.length;
        const suffix = total > 2000 ? ' (exibindo 2.000)' : '';
        const mLabel = this.selectedMonth ? ` · ${this.selectedMonth.charAt(0).toUpperCase() + this.selectedMonth.slice(1)}` : '';
        document.getElementById('table-count').textContent =
            `${total.toLocaleString('pt-BR')} ${total === 1 ? 'item' : 'itens'}${mLabel}${suffix}`;
    }
};

// ====== MÓDULO ESTOQUE ======

const estoque = {
    rawData:   [],
    filtered:  [],
    colunas:   [],    // todas as colunas do arquivo
    _importacoes: [],
    _currentId:   null,
    _nomeArquivo: '',
    _colSeg:  null,
    _colDesc: null,
    _colValor: null,

    init() {
        this.setupDropZone();
        this.setupFileInput();
        this.setupFiltros();
    },

    setupDropZone() {
        const zone = document.getElementById('estoque-drop-zone');
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault(); zone.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f) this.handleFile(f);
        });
    },

    setupFileInput() {
        const inp = document.getElementById('file-input-estoque');
        inp.addEventListener('change', e => {
            const f = e.target.files[0];
            if (f) this.handleFile(f);
            inp.value = '';
        });
    },

    setupFiltros() {
        document.getElementById('est-search').addEventListener('input', () => this.aplicarFiltros());
        document.getElementById('est-seg').addEventListener('change', () => this.aplicarFiltros());
        document.getElementById('est-clear').addEventListener('click', () => {
            document.getElementById('est-search').value = '';
            document.getElementById('est-seg').value   = '';
            this._descSelected = '';
            document.getElementById('est-desc-input').value = '';
            document.getElementById('est-desc-dropdown').classList.remove('open');
            this.aplicarFiltros();
        });
        this.setupDescCombobox();
    },

    _descValues:   [],
    _descSelected: '',

    setupDescCombobox() {
        const input = document.getElementById('est-desc-input');
        const drop  = document.getElementById('est-desc-dropdown');

        input.addEventListener('focus', () => { this.renderDescDrop(''); drop.classList.add('open'); });
        input.addEventListener('input', () => { this._descSelected = ''; this.renderDescDrop(input.value); drop.classList.add('open'); this.aplicarFiltros(); });

        document.addEventListener('mousedown', e => {
            if (!e.target.closest('#est-desc-wrap')) drop.classList.remove('open');
        });
    },

    renderDescDrop(q) {
        const drop = document.getElementById('est-desc-dropdown');
        const term = q.toLowerCase().trim();
        const matches = term
            ? this._descValues.filter(v => v.toLowerCase().includes(term))
            : this._descValues;

        drop.innerHTML = `<div class="combobox-option clear-opt" data-val="">Todos</div>` +
            matches.slice(0, 100).map(v =>
                `<div class="combobox-option${v === this._descSelected ? ' active' : ''}" data-val="${escHTML(v)}">${escHTML(v)}</div>`
            ).join('');

        drop.querySelectorAll('.combobox-option').forEach(el => {
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                this._descSelected = el.dataset.val;
                document.getElementById('est-desc-input').value = el.dataset.val;
                drop.classList.remove('open');
                this.aplicarFiltros();
            });
        });
    },

    populaSelects() {
        const segEl     = document.getElementById('est-seg');
        const descWrap  = document.getElementById('est-desc-wrap');
        const descInput = document.getElementById('est-desc-input');

        this._colSeg  = this.colunas.find(c => this.normalizeKey(c).includes('segmento') || this.normalizeKey(c) === 'seg');
        this._colDesc = this.colunas.find(c => {
            const n = this.normalizeKey(c);
            return n.includes('descricao') || n.includes('descr') || n === 'desc' || n.includes('produto') || n.includes('descproduto');
        });

        if (this._colSeg) {
            const vals = [...new Set(this.rawData.map(r => String(r.dados?.[this._colSeg] ?? '')).filter(Boolean))].sort();
            segEl.innerHTML = `<option value="">Todos segmentos</option>` + vals.map(v => `<option value="${escHTML(v)}">${escHTML(v)}</option>`).join('');
            segEl.style.display = '';
        } else {
            segEl.style.display = 'none';
        }

        if (this._colDesc) {
            this._descValues   = [...new Set(this.rawData.map(r => String(r.dados?.[this._colDesc] ?? '')).filter(Boolean))].sort();
            this._descSelected = '';
            descInput.value    = '';
            descWrap.style.display = '';
        } else {
            descWrap.style.display = 'none';
            this._descValues = [];
        }
    },

    handleFile(file) {
        this._nomeArquivo = file.name;
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'csv') {
            Papa.parse(file, { header: true, skipEmptyLines: true,
                complete: r => this.processData(r.data) });
        } else if (['xls','xlsx'].includes(ext)) {
            const reader = new FileReader();
            reader.onload = e => {
                const wb   = XLSX.read(e.target.result, { type: 'array' });
                const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                this.processData(data);
            };
            reader.readAsArrayBuffer(file);
        }
    },

    normalizeKey: normalizeKey,

    processData(rows) {
        if (!rows?.length) return;

        const allHeaders = Object.keys(rows[0]).filter(h => {
            const n = this.normalizeKey(h);
            return n && !n.startsWith('__'); // ignora colunas vazias do Excel
        });

        const keyMap = {};
        allHeaders.forEach(k => { keyMap[this.normalizeKey(k)] = k; });

        const get = (row, ...cands) => {
            for (const c of cands) {
                if (keyMap[c] !== undefined) return String(row[keyMap[c]] ?? '');
            }
            return '';
        };
        const toNum = v => {
            if (typeof v === 'number') return v;
            return parseFloat(String(v).replace(/[^\d,.\-]/g,'').replace(',','.')) || 0;
        };

        // Detecta coluna de quantidade
        const QTD_KEYS = ['quantidade','qtd','qty','qtde','estoque','saldo'];
        const qtdKey   = QTD_KEYS.find(k => keyMap[k]);

        // Detecta coluna de valor monetário
        const VAL_KEYS = ['total','valor','valortotal','vltotal','preco','price','custo','vl','vlunit','valorunit'];
        const valKey   = VAL_KEYS.find(k => keyMap[k] && k !== qtdKey);
        this._colValor = valKey ? keyMap[valKey] : null;

        this.colunas = allHeaders;

        this.rawData = rows.map((r, i) => {
            const dados = {};
            allHeaders.forEach(h => { dados[h] = r[h] ?? ''; });
            const qtdRaw = qtdKey ? (r[keyMap[qtdKey]] ?? 0) : 0;
            return {
                _id:        i,
                codigo:     get(r, 'codigo', 'cod', 'code', 'cdproduto', 'cdprod'),
                quantidade: toNum(qtdRaw),
                dados
            };
        }).filter(r => r.codigo);

        this.filtered = [...this.rawData];
        this.mostrarDados();
        this.populaSelects();
        this.render();
        this.perguntarESalvar(this._nomeArquivo);
    },

    aplicarFiltros() {
        const q   = document.getElementById('est-search').value.toLowerCase().trim();
        const seg = document.getElementById('est-seg').value;
        const desc = this._descSelected;
        this.filtered = this.rawData.filter(r => {
            if (q && !r.codigo.toLowerCase().includes(q) &&
                !Object.values(r.dados || {}).some(v => String(v).toLowerCase().includes(q))) return false;
            if (seg  && String(r.dados?.[this._colSeg]  ?? '') !== seg)  return false;
            if (desc && String(r.dados?.[this._colDesc] ?? '') !== desc) return false;
            return true;
        });
        this.render();
    },

    mostrarDados() {
        document.getElementById('estoque-drop-zone').style.display = 'none';
        document.getElementById('estoque-data').classList.add('visible');
    },

    render() {
        const totalQtd = this.filtered.reduce((s, r) => s + r.quantidade, 0);
        const zeros    = this.filtered.filter(r => r.quantidade === 0).length;
        document.getElementById('est-itens').textContent = this.filtered.length.toLocaleString('pt-BR');
        document.getElementById('est-qtd').textContent   = totalQtd.toLocaleString('pt-BR');
        document.getElementById('est-zero').textContent  = zeros.toLocaleString('pt-BR');

        // Card de valor total
        const valorCard = document.getElementById('est-valor-card');
        if (this._colValor) {
            const toNum = v => parseFloat(String(v).replace(/[^\d,.\-]/g,'').replace(',','.')) || 0;
            const totalVal = this.filtered.reduce((s, r) => s + toNum(r.dados?.[this._colValor] ?? 0), 0);
            document.getElementById('est-valor-label').textContent = this._colValor.toUpperCase();
            document.getElementById('est-valor').textContent = 'R$ ' + totalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            valorCard.style.display = '';
        } else {
            valorCard.style.display = 'none';
        }

        const table = document.getElementById('estoque-table');

        // Colunas dinâmicas — tudo do arquivo exceto colunas vazias
        const QTD_NORMS = ['quantidade','qtd','qty','qtde','estoque','saldo'];
        const extraCols = this.colunas.filter(h => {
            const n = this.normalizeKey(h);
            return !QTD_NORMS.includes(n) && n && !n.startsWith('__');
        });

        // Cabeçalho dinâmico
        table.querySelector('thead tr').innerHTML =
            extraCols.map(h => `<th>${escHTML(String(h).toUpperCase())}</th>`).join('') +
            '<th class="td-right">QUANTIDADE</th>';

        // Linhas
        const rows = this.filtered.slice(0, 2000);
        table.querySelector('tbody').innerHTML = rows.map(r => {
            const zero = r.quantidade === 0;
            const cells = extraCols.map(h => {
                const v = r.dados?.[h];
                return `<td>${v !== undefined && v !== '' ? escHTML(String(v)) : '<span style="opacity:.3">—</span>'}</td>`;
            }).join('');
            return `<tr${zero ? ' class="row-zero"' : ''}>
                ${cells}
                <td class="td-qtd${zero ? ' zero-qtd' : ''}">${r.quantidade.toLocaleString('pt-BR')}</td>
            </tr>`;
        }).join('');

        const total = this.filtered.length;
        document.getElementById('est-count').textContent =
            `${total.toLocaleString('pt-BR')} itens${total > 2000 ? ' (exibindo 2.000)' : ''}`;
    },

    // ── Salvar / Histórico ────────────────────────────────────
    async perguntarESalvar(nome) {
        this._nomeArquivo = nome;
        await this.salvar('nova');
    },

    async salvar(modo) {
        document.getElementById('import-modal').style.display = 'none';
        this.setSalvando(true);
        let sucesso = false;
        try {
            if (modo === 'substituir') {
                const lista = await api.get('/api/importacoes-estoque');
                for (const imp of (lista || [])) await api.deletarImportacaoEstoque(imp.id);
            }
            const linhas = this.rawData.map(r => ({ codigo: r.codigo, quantidade: r.quantidade, dados: r.dados || {} }));
            const res = await api.post('/api/estoque/import', { nomeArquivo: this._nomeArquivo, linhas });
            if (res?.ok) { this._currentId = res.importacaoId; sucesso = true; }
        } catch(e) { console.error(e); }
        finally { this.setSalvando(false); }
        await this.carregarHistorico();
        if (sucesso) {
            historico.registrar('importar', 'estoque', `${this.rawData.length} itens — ${this._nomeArquivo}`);
            mostrarToast(`✓ ${this.rawData.length.toLocaleString('pt-BR')} itens salvos`);
            // Auto-expande o histórico
            const list = document.getElementById('estoque-history-list');
            const chev = document.getElementById('chevron-estoque');
            if (list && list.style.display === 'none') {
                list.style.display = 'flex';
                if (chev) chev.style.transform = 'rotate(90deg)';
            }
        }
    },

    setSalvando(ativo) {
        const el = document.getElementById('estoque-saving');
        if (el) el.style.display = ativo ? 'inline' : 'none';
    },

    async carregarHistorico() {
        try {
            const lista = await api.get('/api/importacoes-estoque');
            this._importacoes = Array.isArray(lista) ? lista : [];
            if (lista?.length) {
                const latest = lista[0];
                const incompleto = this.rawData.length < (latest.total_linhas || 0);
                if (!this._currentId || this._currentId !== latest.id || incompleto) {
                    await this.carregarImportacao(latest.id); return;
                }
            }
            this.renderHistorico();
        } catch(e) {
            console.error('Estoque carregarHistorico erro:', e);
            mostrarToast(`Estoque erro: ${e.message}`);
        }
    },

    async carregarImportacao(id) {
        this.setSalvando(true);
        const rows = await api.get(`/api/estoque?importacao_id=${id}`);
        this.setSalvando(false);
        if (!rows?.length) {
            // fallback para cache se Supabase retornar vazio
            const c = lsCache.ler('estoque');
            if (c?.rawData?.length && c.importacaoId === id) {
                this.rawData = c.rawData; this.colunas = c.colunas || [];
                this._currentId = id; this.filtered = [...this.rawData];
                this.mostrarDados(); this.populaSelects(); this.render();
            }
            return;
        }

        this._currentId = id;

        // Reconstrói colunas a partir do JSONB dados
        const sampleDados = rows.find(r => r.dados && Object.keys(r.dados).length)?.dados || {};
        this.colunas = Object.keys(sampleDados).length ? Object.keys(sampleDados) : ['codigo'];

        // normKey → usa normalizeKey global
        const VAL_KEYS = ['total','valor','valortotal','vltotal','preco','price','custo','vl','vlunit','valorunit'];
        this._colValor = this.colunas.find(c => VAL_KEYS.includes(normalizeKey(c))) || null;

        this.rawData = rows.map((r, i) => ({
            _id:        i,
            codigo:     r.codigo,
            quantidade: Number(r.quantidade) || 0,
            dados:      r.dados || { codigo: r.codigo }
        }));
        this.filtered = [...this.rawData];
        this.mostrarDados();
        this.populaSelects();
        this.render();
        this.renderHistorico();
        lsCache.salvar('estoque', { importacaoId: id, colunas: this.colunas, rawData: this.rawData });
        setTimeout(() => alertas.verificar(), 300);
        // Notifica dashboards dependentes
        vxe._dirty = true;
        opDash._dirty = true;
        pesquisa._dirty = true;
        abcEstoque._items = [];
        const vxeView = document.getElementById('view-vxe');
        if (vxeView && vxeView.style.display !== 'none') setTimeout(() => vxe.render(), 100);
    },

    renderHistorico() {
        const wrap = document.getElementById('estoque-history');
        const list = document.getElementById('estoque-history-list');
        if (!this._importacoes?.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        list.innerHTML = this._importacoes.map(imp => {
            const d    = new Date(imp.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
            const ativo = imp.id === this._currentId;
            return `<div class="hi-item${ativo ? ' hi-ativo' : ''}" onclick="estoque.carregarImportacao('${imp.id}')">
                <span class="hi-dot">${ativo ? '●' : '○'}</span>
                <div class="hi-info">
                    <span class="hi-nome">${escHTML(imp.nome_arquivo)}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} itens</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();estoque.excluir('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
    },

    exportar() {
        if (!this.filtered.length) return;
        exportarXLS(this.filtered.map(r => ({ Código: r.codigo, Quantidade: r.quantidade, ...r.dados })), 'estoque');
    },

    async excluir(id) {
        if (!confirm('Excluir esta importação?')) return;
        await api.deletarImportacaoEstoque(id);
        if (this._currentId === id) {
            this.rawData = []; this.filtered = [];
            document.getElementById('estoque-data').classList.remove('visible');
            document.getElementById('estoque-drop-zone').style.display = '';
        }
        await this.carregarHistorico();
    }
};

// ====== MÓDULO: ORDENS DE PRODUÇÃO ======

const op = {
    rawData:   [],
    filtered:  [],
    colunas:   [],
    _importacoes: [],
    _currentId:   null,
    _nomeArquivo: '',
    _col1: null, _col1Values: [], _col1Selected: '',
    _col2: null, _col2Values: [], _col2Selected: '',
    _colQtd: null,

    init() {
        this.setupDropZone();
        this.setupFileInput();
        this.setupFiltros();
    },

    setupDropZone() {
        const zone = document.getElementById('op-drop-zone');
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault(); zone.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f) this.handleFile(f);
        });
    },

    setupFileInput() {
        const inp = document.getElementById('file-input-op');
        inp.addEventListener('change', e => {
            const f = e.target.files[0];
            if (f) this.handleFile(f);
            inp.value = '';
        });
    },

    setupFiltros() {
        document.getElementById('op-search').addEventListener('input', () => this.aplicarFiltros());
        this._setupCombo('op-col1-input','op-col1-dropdown','_col1Selected','_col1Values');
        this._setupCombo('op-col2-input','op-col2-dropdown','_col2Selected','_col2Values');
    },

    limpar() {
        document.getElementById('op-search').value = '';
        this._col1Selected = '';
        this._col2Selected = '';
        document.getElementById('op-col1-input').value = '';
        document.getElementById('op-col2-input').value = '';
        document.getElementById('op-col1-dropdown').classList.remove('open');
        document.getElementById('op-col2-dropdown').classList.remove('open');
        this.aplicarFiltros();
    },

    _setupCombo(inputId, dropId, selKey, valsKey) {
        const input = document.getElementById(inputId);
        const drop  = document.getElementById(dropId);
        input.addEventListener('focus', () => { this._renderDrop(drop, input, selKey, valsKey, ''); drop.classList.add('open'); });
        input.addEventListener('input', () => {
            this[selKey] = '';
            this._renderDrop(drop, input, selKey, valsKey, input.value);
            drop.classList.add('open');
            this.aplicarFiltros();
        });
        document.addEventListener('mousedown', e => {
            if (!e.target.closest(`#${dropId}`) && !e.target.closest(`#${inputId}`)) drop.classList.remove('open');
        });
    },

    _renderDrop(drop, input, selKey, valsKey, q) {
        const term = q.toLowerCase().trim();
        const vals = this[valsKey];
        const matches = term ? vals.filter(v => v.toLowerCase().includes(term)) : vals;
        drop.innerHTML = `<div class="combobox-option clear-opt" data-val="">Todos</div>` +
            matches.slice(0, 100).map(v =>
                `<div class="combobox-option${v === this[selKey] ? ' active' : ''}" data-val="${escHTML(v)}">${escHTML(v)}</div>`
            ).join('');
        drop.querySelectorAll('.combobox-option').forEach(el => {
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                this[selKey] = el.dataset.val;
                input.value  = el.dataset.val;
                drop.classList.remove('open');
                this.aplicarFiltros();
            });
        });
    },

    normalizeKey(key) {
        return String(key).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
    },

    handleFile(file) {
        this._nomeArquivo = file.name;
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'csv') {
            Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => this.processData(r.data) });
        } else if (['xls','xlsx'].includes(ext)) {
            const reader = new FileReader();
            reader.onload = e => {
                const wb    = XLSX.read(e.target.result, { type: 'array' });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                // Lê como array bruto (header:1) para relatórios ERP com células mescladas
                const raw   = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                // Converte cada linha para objeto { col0, col1, ... } para compatibilidade
                const rows  = raw.map(arr => Object.fromEntries(arr.map((v, i) => [i, v])));
                this.processData(rows);
            };
            reader.readAsArrayBuffer(file);
        }
    },

    processData(rows) {
        if (!rows?.length) return;

        // Detecta se é o relatório formatado do ERP (contém "O.P. N°" em qualquer célula)
        const fullText = rows.map(r => Object.values(r).join(' ')).join('\n');
        const isERPReport = /O\.P\.?\s*N[°º.]/i.test(fullText);
        if (isERPReport) { this._parseERPReport(rows); return; }

        // Formato tabular — primeira linha contém os cabeçalhos
        const headerRow  = rows[0];
        const allHeaders = Object.values(headerRow).map(v => String(v ?? '').trim()).filter(Boolean);
        if (!allHeaders.length) { mostrarToast('Arquivo sem dados reconhecíveis.', 'erro'); return; }
        const dataRows   = rows.slice(1);
        const QTD_KEYS   = ['quantidade','qtd','qty','qtde','saldo','pecas','pcs','aproduzir'];
        const qtdNorm    = allHeaders.find(h => QTD_KEYS.includes(this.normalizeKey(h)));
        this._colQtd     = qtdNorm || null;
        this.colunas     = allHeaders;
        this.rawData     = dataRows.map((r, i) => ({
            _id: i,
            dados: Object.fromEntries(allHeaders.map((h, idx) => [h, String(r[idx] ?? '').trim()]))
        })).filter(r => Object.values(r.dados).some(v => v !== ''));
        this.filtered = [...this.rawData];
        this._finalizarImport();
    },

    _parseERPReport(rows) {
        const toNum = toNumBR; // pt-BR: '1.200,0000' → 1200, não 1.2
        const parsed = [];
        let curOP = {};
        let curLote  = '';
        let ignorados = 0;

        // Concatena todas as células de uma row em string única (relatórios ERP mesclam células)
        const rowStr = row => Object.values(row).map(v => String(v ?? '').trim()).filter(Boolean).join('  ');

        for (const row of rows) {
            const a = String(Object.values(row)[0] ?? '').trim();
            const full = rowStr(row);

            // ── Linha de cabeçalho da OP ────────────────────────────
            // Formato: "O.P. N°: 17588  Emissão: 07/01/2026  Previsão Inicial: ...  Status: Liberado p/ Produção"
            if (/O\.P\.?\s*N[°º]/i.test(full)) {
                const nMatch  = full.match(/N[°º][^:]*:\s*(\d+)/i);
                const emMatch = full.match(/Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i);
                const piMatch = full.match(/Previs[aã]o\s+Inicial:\s*(\d{2}\/\d{2}\/\d{4})/i);
                const pfMatch = full.match(/Previs[aã]o\s+Final:\s*(\d{2}\/\d{2}\/\d{4})/i);
                const stMatch = full.match(/Status:\s*([^\t\n]+)/i);
                curOP = {
                    'N. OP':          nMatch  ? nMatch[1].trim()  : '',
                    'Emissão':        emMatch ? emMatch[1] : '',
                    'Prev. Inicial':  piMatch ? piMatch[1] : '',
                    'Prev. Final':    pfMatch ? pfMatch[1] : '',
                    'Status':         stMatch ? stMatch[1].trim() : '',
                };
                curLote = '';
                continue;
            }

            // ── Linha de Lote / Observação ──────────────────────────
            // Formato: "Observação OP: LOTE 5741"  ou  "Lote: 5741"
            if (/lote|observa[çc][aã]o/i.test(full)) {
                const loteMatch = full.match(/LOTE\s+(\w+)/i) || full.match(/Lote:\s*(\w+)/i);
                if (loteMatch) curLote = loteMatch[1].trim();
                continue;
            }

            // ── Linha de Produto ─────────────────────────────────────
            // Formatos suportados:
            //   "Produto / Referência: 50002 - JOELHEIRA | PRETA | TAM. P | PANVEL Ref: 50002  200  0  200"
            //   "Referência: 50002" (célula A) + "- JOELHEIRA | PRETA | TAM. P | PANVEL Ref: 50002" (célula B)
            if (/Produto\s*[\/e]?\s*Refer[eê]ncia:/i.test(full) ||
                /Refer[eê]ncia:/i.test(full) ||
                /^Produto:/i.test(a)) {

                // Remove todos os prefixos conhecidos e junta em string limpa
                const afterColon = full
                    .replace(/Produto\s*[\/e]?\s*Refer[eê]ncia:\s*/ig, '')
                    .replace(/Refer[eê]ncia:\s*/ig, '')
                    .replace(/^Produto:\s*/i, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim();

                // Extrai código do produto: "50002 - JOELHEIRA | ..." ou "50002  - JOELHEIRA"
                const codMatch = afterColon.match(/^(\d+)\s*[-–]\s*/);
                const ref      = codMatch ? codMatch[1].trim() : '';
                const resto    = codMatch ? afterColon.slice(codMatch[0].length) : afterColon;

                // Extrai números do final (qtd produção, qtd B, qtd total)
                const numsMatch = resto.match(/([\d.]+,\d{4})/g) || [];
                const qtd       = numsMatch.length > 0 ? toNum(numsMatch[0]) : 0;

                // Remove números e referências duplicadas para limpar a descrição
                const parteDesc = resto
                    .replace(/([\d.]+,\d{4}[\s]*)*/g, '')
                    .replace(/\s*Ref:\s*\d+\s*/gi, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim();

                // Quebra por "|" — cada parte é um campo
                const parts = parteDesc.split('|').map(p => p.trim()).filter(Boolean);

                const descricao = parts[0] || '';
                const cor       = parts[1] || '';
                // TAM. P → extrai "P"
                const tamRaw    = parts[2] || '';
                const tamanho   = tamRaw.replace(/TAM\.?\s*/i, '').trim();
                // PANVEL Ref: 50002 → extrai apenas "PANVEL", remove tudo após "Ref:"
                const marcaRaw  = parts[3] || '';
                const marca     = marcaRaw.replace(/\s*Ref:.*$/i, '').trim();

                if (!ref && !descricao) continue; // linha vazia

                // Regra 1: Ref deve ter exatamente 5 dígitos numéricos
                if (!/^\d{5}$/.test(ref)) { ignorados++; continue; }

                // Regra 2: campo de tamanho deve conter "TAM" no texto original
                if (!/TAM/i.test(tamRaw)) { ignorados++; continue; }

                // Regra 3: tamanho extraído deve ser um valor válido
                const TAMANHOS_VALIDOS = ['PP','P','M','G','GG','XG'];
                if (!TAMANHOS_VALIDOS.includes(tamanho.toUpperCase())) { ignorados++; continue; }

                parsed.push({
                    'N. OP':    curOP['N. OP']   || '',
                    'Emissão':  curOP['Emissão']  || '',
                    'Lote':     curLote,
                    'Ref':      ref,
                    'Descrição':descricao.toUpperCase(),
                    'Cor':      cor.toUpperCase(),
                    'Tam':      tamanho.toUpperCase(),
                    'Marca':    marca.toUpperCase(),
                    'Qtd':      qtd,
                    'Status':   curOP['Status']   || '',
                    'Prev. Inicial': curOP['Prev. Inicial'] || '',
                    'Prev. Final':   curOP['Prev. Final']   || '',
                });
                continue;
            }
        }

        if (!parsed.length) {
            mostrarToast('Nenhuma Ordem de Produção encontrada. Verifique o formato do arquivo.', 'erro');
            return;
        }

        if (ignorados > 0)
            mostrarToast(`${parsed.length} ordens importadas · ${ignorados} ignoradas (ref. fora de 5 dígitos)`);

        const COLUNAS_OP = ['N. OP','Emissão','Lote','Ref','Descrição','Cor','Tam','Marca','Qtd','Status','Prev. Inicial','Prev. Final'];
        this.colunas  = COLUNAS_OP;
        this._colQtd  = 'Qtd';
        this.rawData  = parsed.map((r, i) => ({ _id: i, dados: r }));
        this.filtered = [...this.rawData];
        this._finalizarImport();
    },

    _finalizarImport() {
        this._mapearColunasOP();
        this._detectCombosCols();
        document.getElementById('op-drop-zone').style.display = 'none';
        document.getElementById('op-data').classList.add('visible');
        this.render();
        this.perguntarESalvar(this._nomeArquivo);
    },

    // Mapeamento de colunas para o formato padrão de OP
    _mapearColunasOP() {
        const nk = c => normalizeKey(c);
        const find = (...keys) => this.colunas.find(c => keys.some(k => nk(c) === k || nk(c).includes(k)));

        // Nomes fixos do parser ERP têm prioridade (match exato primeiro)
        this._colOP      = this.colunas.find(c => c === 'N. OP')      || find('nop','numop','numeroop','nro') || null;
        this._colEmissao = this.colunas.find(c => c === 'Emissão')    || find('emissao','emiss','dataemissao') || null;
        this._colLote    = this.colunas.find(c => c === 'Lote')       || find('lote','lot') || null;
        this._colRef     = this.colunas.find(c => c === 'Ref')        || find('ref','referencia','codigo','cod') || null;
        this._colDesc    = this.colunas.find(c => c === 'Descrição')  || find('descricao','descr','desc','produto') || null;
        this._colCor     = this.colunas.find(c => c === 'Cor')        || find('cor','color') || null;
        this._colTam     = this.colunas.find(c => c === 'Tam')        || find('tam','tamanho','size') || null;
        this._colMarca   = this.colunas.find(c => c === 'Marca')      || find('marca','brand') || null;
        this._colQtd     = this.colunas.find(c => c === 'Qtd')        || find('quantidade','qtd','qty','producao','aproduzir') || null;
        this._colStatus  = this.colunas.find(c => c === 'Status')     || find('status','situacao') || null;

        const mapeadas = new Set([this._colOP, this._colEmissao, this._colLote, this._colRef,
            this._colDesc, this._colCor, this._colTam, this._colMarca, this._colQtd, this._colStatus].filter(Boolean));
        this._colsExtras = this.colunas.filter(c => !mapeadas.has(c));
    },

    _detectCombosCols() {
        const STATUS_KEYS  = ['status','situacao','situação','estado'];
        const DESC_KEYS    = ['descricao','descr','desc','produto','descproduto','modelo'];
        const SEG_KEYS     = ['segmento','seg','familia','linha'];

        const find = keys => this.colunas.find(c => keys.includes(this.normalizeKey(c)));

        // col1 = status/situação, col2 = segmento ou descrição
        this._col1 = find(STATUS_KEYS) || this.colunas.find(c => {
            const n = this.normalizeKey(c);
            return STATUS_KEYS.some(k => n.includes(k));
        });
        this._col2 = find(SEG_KEYS) || find(DESC_KEYS) || this.colunas.find(c => {
            const n = this.normalizeKey(c);
            return SEG_KEYS.some(k => n.includes(k)) || DESC_KEYS.some(k => n.includes(k));
        });

        const uniq = col => col
            ? [...new Set(this.rawData.map(r => String(r.dados?.[col] ?? '')).filter(Boolean))].sort()
            : [];

        this._col1Values = uniq(this._col1);
        this._col2Values = uniq(this._col2);
        this._col1Selected = '';
        this._col2Selected = '';

        const w1 = document.getElementById('op-col1-wrap');
        const w2 = document.getElementById('op-col2-wrap');
        const i1 = document.getElementById('op-col1-input');
        const i2 = document.getElementById('op-col2-input');

        if (this._col1) { i1.placeholder = `Filtrar ${this._col1}...`; i1.value = ''; w1.style.display = ''; }
        else w1.style.display = 'none';

        if (this._col2) { i2.placeholder = `Filtrar ${this._col2}...`; i2.value = ''; w2.style.display = ''; }
        else w2.style.display = 'none';
    },

    aplicarFiltros() {
        const q = document.getElementById('op-search').value.toLowerCase().trim();
        this.filtered = this.rawData.filter(r => {
            if (q && !Object.values(r.dados).some(v => String(v).toLowerCase().includes(q))) return false;
            if (this._col1Selected && String(r.dados?.[this._col1] ?? '') !== this._col1Selected) return false;
            if (this._col2Selected && String(r.dados?.[this._col2] ?? '') !== this._col2Selected) return false;
            return true;
        });
        this.render();
    },

    render() {
        const total = this.rawData.length;
        const filt  = this.filtered.length;
        const toNum = v => parseFloat(String(v ?? '0').replace(',','.')) || 0;
        const qtd   = this._colQtd
            ? this.filtered.reduce((s, r) => s + toNum(r.dados?.[this._colQtd]), 0)
            : 0;

        document.getElementById('op-total').textContent     = total.toLocaleString('pt-BR');
        document.getElementById('op-qtd').textContent       = this._colQtd ? qtd.toLocaleString('pt-BR') : '—';
        document.getElementById('op-filtrados').textContent = filt.toLocaleString('pt-BR');
        document.getElementById('op-count').textContent     = `${filt.toLocaleString('pt-BR')} ordens${filt > 2000 ? ' (exibindo 2000)' : ''}`;

        const table = document.getElementById('op-table');
        const empty = '<span style="opacity:.3">—</span>';

        // Se temos mapeamento de colunas OP, usa layout estruturado
        const temMapa = this._colOP || this._colRef || this._colDesc;
        if (temMapa) {
            // Colunas fixas na ordem certa + extras ao final
            const colsDef = [
                { key: this._colOP,      label: 'N. OP',      style: 'color:#26c6da;font-family:monospace;font-weight:700;' },
                { key: this._colEmissao, label: 'EMISSÃO',    style: 'color:#8b949e;' },
                { key: this._colLote,    label: 'LOTE',       style: 'color:#8b949e;font-family:monospace;' },
                { key: this._colRef,     label: 'REF',        style: 'color:#26c6da;font-family:monospace;font-weight:600;' },
                { key: this._colDesc,    label: 'DESCRIÇÃO',  style: 'font-weight:500;', cls: 'td-desc' },
                { key: this._colCor,     label: 'COR',        style: '' },
                { key: this._colTam,     label: 'TAM',        style: 'text-align:center;font-weight:700;' },
                { key: this._colMarca,   label: 'MARCA',      style: '' },
                { key: this._colQtd,     label: 'QTD',        style: 'text-align:right;color:#ffab76;font-weight:700;' },
                { key: this._colStatus,  label: 'STATUS',     style: 'font-size:0.75rem;color:#8b949e;' },
            ].filter(c => c.key);

            // Adiciona colunas extras não mapeadas
            (this._colsExtras || []).forEach(k => colsDef.push({ key: k, label: k.toUpperCase(), style: '' }));

            table.querySelector('thead tr').innerHTML = colsDef.map(c =>
                `<th${c.cls ? ` class="${c.cls}"` : ''}>${c.label}</th>`
            ).join('');

            table.querySelector('tbody').innerHTML = this.filtered.slice(0, 2000).map(r => {
                const cells = colsDef.map(c => {
                    const v = r.dados?.[c.key];
                    const val = (v !== undefined && v !== '') ? escHTML(String(v)) : empty;
                    return `<td style="${c.style}">${val}</td>`;
                }).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
        } else {
            // Fallback: mostra todas as colunas como estão
            table.querySelector('thead tr').innerHTML =
                this.colunas.map(h => `<th>${h.toUpperCase()}</th>`).join('');
            table.querySelector('tbody').innerHTML = this.filtered.slice(0, 2000).map(r => {
                const cells = this.colunas.map(h => {
                    const v = r.dados?.[h];
                    return `<td>${(v !== undefined && v !== '') ? escHTML(String(v)) : empty}</td>`;
                }).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
        }
    },

    async perguntarESalvar(nome) {
        this._nomeArquivo = nome;
        await this.salvar('nova');
    },

    async salvar(modo) {
        document.getElementById('import-modal').style.display = 'none';
        this._setSaving(true);
        try {
            if (modo === 'substituir' && this._currentId) {
                await api.deletarImportacaoOP(this._currentId);
            }
            const linhas = this.rawData.map(r => ({ dados: r.dados }));
            const res = await api.post('/api/op/import', { nomeArquivo: this._nomeArquivo, linhas });
            if (res?.ok) {
                this._currentId = res.importacaoId;
                mostrarToast(`✓ ${this.rawData.length.toLocaleString('pt-BR')} ordens salvas`);
            } else {
                mostrarToast(res?.erro || 'Erro ao salvar OP', 'erro');
            }
        } catch(e) {
            mostrarToast('Erro de conexão ao salvar', 'erro');
        } finally { this._setSaving(false); }
        await this.carregarHistorico();
    },

    _setSaving(v) {
        const el = document.getElementById('op-saving');
        if (el) el.style.display = v ? '' : 'none';
    },

    async carregarHistorico() {
        const lista = await api.get('/api/importacoes-op');
        this._importacoes = lista || [];
        // Fase 2b: a carteira canônica é a ordem_producao (MES) via /api/op-unificado.
        // Plano/TOC/Preactor passam a ler dela. A tela de importar arquivo segue
        // disponível (carregarImportacao continua no histórico).
        if (await this.carregarUnificado()) { this.renderHistorico(); return; }
        if (lista?.length) {
            const latest = lista[0];
            const incompleto = this.rawData.length < (latest.total_linhas || 0);
            if (!this._currentId || this._currentId !== latest.id || incompleto) {
                await this.carregarImportacao(latest.id); return;
            }
        }
        this.renderHistorico();
    },

    // Fase 2b: carrega a carteira de OP da fonte única (ordem_producao do MES)
    async carregarUnificado() {
        let rows;
        try { rows = await api.get('/api/op-unificado'); } catch { return false; }
        if (!rows?.length) return false;
        this._currentId = 'unificado';
        this.colunas = Object.keys(rows[0].dados || {});
        this.rawData = rows.map((r, i) => ({ _id: i, dados: r.dados, op_id: r.op_id }));
        this._colQtd = 'Qtd';
        this.filtered = [...this.rawData];
        this._mapearColunasOP();
        this._detectCombosCols();
        const dz = document.getElementById('op-drop-zone'); if (dz) dz.style.display = 'none';
        const od = document.getElementById('op-data'); if (od) od.classList.add('visible');
        this.render();
        opDash._dirty = true; vxe._dirty = true; pesquisa._dirty = true;
        setTimeout(() => alertas.verificar(), 300);
        return true;
    },

    async carregarImportacao(id) {
        const rows = await api.get(`/api/op?importacao_id=${id}`);
        if (!rows?.length) return;
        this._currentId = id;
        this.colunas  = Object.keys(rows[0].dados || {});
        this.rawData  = rows.map((r, i) => ({ _id: i, dados: r.dados }));
        const QTD_KEYS = ['quantidade','qtd','qty','qtde','saldo','pecas','pcs','aproduzir','producao'];
        this._colQtd = this.colunas.find(h => QTD_KEYS.includes(this.normalizeKey(h)))
                    || this.colunas.find(h => h === 'Produção')
                    || null;
        this.filtered = [...this.rawData];
        this._mapearColunasOP();
        this._detectCombosCols();
        document.getElementById('op-drop-zone').style.display = 'none';
        document.getElementById('op-data').classList.add('visible');
        this.render();
        this.renderHistorico();
        lsCache.salvar('op', { importacaoId: id, colunas: this.colunas, rawData: this.rawData });
        // Notifica dashboards dependentes
        opDash._dirty = true;
        vxe._dirty = true;
        pesquisa._dirty = true;
        setTimeout(() => alertas.verificar(), 300);
    },

    renderHistorico() {
        const wrap = document.getElementById('op-history');
        const list = document.getElementById('op-history-list');
        if (!this._importacoes?.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        list.innerHTML = this._importacoes.map(imp => {
            const d    = new Date(imp.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
            const ativo = imp.id === this._currentId;
            return `<div class="hi-item${ativo ? ' hi-ativo' : ''}" onclick="op.carregarImportacao('${imp.id}')">
                <span class="hi-dot">${ativo ? '●' : '○'}</span>
                <div class="hi-info">
                    <span class="hi-nome">${escHTML(imp.nome_arquivo)}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} ordens</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();op.excluir('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
        // Auto-expande a lista após salvar
        list.style.display = 'flex';
        const chev = document.getElementById('chevron-op');
        if (chev) chev.style.transform = 'rotate(90deg)';
    },

    exportar() {
        if (!this.filtered.length) return;
        exportarXLS(this.filtered.map(r => r.dados), 'ordens_producao');
    },

    async excluir(id) {
        if (!confirm('Excluir esta importação?')) return;
        await api.deletarImportacaoOP(id);
        if (this._currentId === id) {
            this.rawData = []; this.filtered = [];
            document.getElementById('op-data').classList.remove('visible');
            document.getElementById('op-drop-zone').style.display = '';
            this._currentId = null;
        }
        await this.carregarHistorico();
    }
};

// ====== IMPORTAÇÃO: CLIENTE ======

const cliente = {
    rawData:   [],
    filtered:  [],
    colunas:   [],
    _importacoes: [],
    _currentId:   null,
    _nomeArquivo: '',
    _col1: null, _col1Values: [], _col1Selected: '',
    _col2: null, _col2Values: [], _col2Selected: '',
    _colQtd: null,
    // mapeamento das 7 colunas alvo
    _colCodigo: null, _colDesc: null, _colData: null, _colCliente: null,
    _colQtd: null, _colValUnit: null, _colValTotal: null,

    init() {
        this.setupDropZone();
        this.setupFileInput();
        this.setupFiltros();
    },

    setupDropZone() {
        const zone = document.getElementById('cliente-drop-zone');
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault(); zone.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f) this.handleFile(f);
        });
    },

    setupFileInput() {
        const inp = document.getElementById('file-input-cliente');
        inp.addEventListener('change', e => {
            const f = e.target.files[0];
            if (f) this.handleFile(f);
            inp.value = '';
        });
    },

    setupFiltros() {
        document.getElementById('cliente-search').addEventListener('input', () => this.aplicarFiltros());
        this._setupCombo('cliente-col1-input','cliente-col1-dropdown','_col1Selected','_col1Values');
        this._setupCombo('cliente-col2-input','cliente-col2-dropdown','_col2Selected','_col2Values');
    },

    limpar() {
        document.getElementById('cliente-search').value = '';
        this._col1Selected = '';
        this._col2Selected = '';
        document.getElementById('cliente-col1-input').value = '';
        document.getElementById('cliente-col2-input').value = '';
        document.getElementById('cliente-col1-dropdown').classList.remove('open');
        document.getElementById('cliente-col2-dropdown').classList.remove('open');
        this.aplicarFiltros();
    },

    _setupCombo(inputId, dropId, selKey, valsKey) {
        const input = document.getElementById(inputId);
        const drop  = document.getElementById(dropId);
        input.addEventListener('focus', () => { this._renderDrop(drop, input, selKey, valsKey, ''); drop.classList.add('open'); });
        input.addEventListener('input', () => {
            this[selKey] = '';
            this._renderDrop(drop, input, selKey, valsKey, input.value);
            drop.classList.add('open');
            this.aplicarFiltros();
        });
        document.addEventListener('mousedown', e => {
            if (!e.target.closest(`#${dropId}`) && !e.target.closest(`#${inputId}`)) drop.classList.remove('open');
        });
    },

    _renderDrop(drop, input, selKey, valsKey, q) {
        const term = q.toLowerCase().trim();
        const vals = this[valsKey];
        const matches = term ? vals.filter(v => v.toLowerCase().includes(term)) : vals;
        drop.innerHTML = `<div class="combobox-option clear-opt" data-val="">Todos</div>` +
            matches.slice(0, 100).map(v =>
                `<div class="combobox-option${v === this[selKey] ? ' active' : ''}" data-val="${escHTML(v)}">${escHTML(v)}</div>`
            ).join('');
        drop.querySelectorAll('.combobox-option').forEach(el => {
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                this[selKey] = el.dataset.val;
                input.value  = el.dataset.val;
                drop.classList.remove('open');
                this.aplicarFiltros();
            });
        });
    },

    normalizeKey(key) {
        return String(key).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
    },

    handleFile(file) {
        this._nomeArquivo = file.name;
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'csv') {
            Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => this.processData(r.data) });
        } else if (['xls','xlsx'].includes(ext)) {
            const reader = new FileReader();
            reader.onload = e => {
                const wb   = XLSX.read(e.target.result, { type: 'array' });
                const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                this.processData(data);
            };
            reader.readAsArrayBuffer(file);
        }
    },

    processData(rows) {
        if (!rows?.length) return;

        // Detecta relatório ERP: alguma linha contém padrão "NÚMERO - NOME"
        const isERP = rows.some(r =>
            Object.values(r).some(v => /^\d{3,6}\s*-\s*[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ]/.test(String(v ?? '')))
        );
        if (isERP) { this._parseERPCliente(rows); return; }

        // Formato tabular normal
        const allHeaders = Object.keys(rows[0]).filter(h => {
            const n = this.normalizeKey(h);
            return n && !n.startsWith('__');
        });
        this._mapearColunas(allHeaders);
        this.rawData = rows.map((r, i) => ({
            _id: i,
            dados: Object.fromEntries(allHeaders.map(h => [h, r[h] ?? '']))
        }));
        this.filtered = [...this.rawData];
        this._finalizarImport();
    },

    _parseERPCliente(rows) {
        const parsed = [];
        let curCodigo = null, curDesc = null, curCliente = null, curData = null;

        for (const row of rows) {
            const line = String(Object.values(row)[0] ?? '').trim();
            if (!line || /^-{3,}/.test(line)) continue;

            // Linha de produto: "46254 - Regata Feminina" (código numérico + descrição)
            const prodM = line.match(/^(\d{3,8})\s*-\s*(.+)$/);
            if (prodM && !/^\d{2}\/\d{2}\/\d{4}/.test(line)) {
                curCodigo  = prodM[1].trim();
                curDesc    = prodM[2].trim();
                curCliente = null; curData = null;
                continue;
            }

            // Linha de data + cliente: "08/05/2026 ... Malharia Anselmi ..."
            // Tenta extrair data e, se houver texto depois, considera como cliente
            const dateM = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.*)/);
            if (dateM && curCodigo) {
                curData = dateM[1];
                // Extrai cliente: texto entre dashes ou antes dos números
                const resto = dateM[2];
                const clienteM = resto.match(/(?:^|\s-\s)([A-Za-záàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ][A-Za-záàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ\s]+?)(?:\s+-|\s+[\d,]+|$)/);
                if (clienteM) curCliente = clienteM[1].trim();

                // Extrai valores numéricos do final da linha
                const nums = resto.match(/([\d.]+,\d+)/g) || [];
                const qtd      = nums[0] ? nums[0] : '';
                const valUnit  = nums[1] ? nums[1] : '';
                const valTotal = nums[nums.length - 1] || '';

                if (qtd) {
                    parsed.push({
                        'Código':         curCodigo  || '',
                        'Descrição':      curDesc    || '',
                        'Data':           curData    || '',
                        'Cliente':        curCliente || '',
                        'Quantidade':     qtd,
                        'Valor Unitário': valUnit,
                        'Valor Total':    valTotal,
                    });
                }
                continue;
            }

            // Subtotal encerra bloco
            if (/^Subtotal|^Total/i.test(line)) {
                curCodigo = null; curDesc = null; curCliente = null; curData = null;
            }
        }

        if (!parsed.length) {
            alert('Nenhum registro encontrado no arquivo. Verifique o formato.');
            return;
        }

        const cols = ['Código','Descrição','Data','Cliente','Quantidade','Valor Unitário','Valor Total'];
        this._mapearColunas(cols);
        this.rawData  = parsed.map((r, i) => ({ _id: i, dados: r }));
        this.filtered = [...this.rawData];
        this._finalizarImport();
    },

    // Detecta as 7 colunas alvo e define a ordem de exibição
    _mapearColunas(headers) {
        const n = h => this.normalizeKey(h);
        const find = (...keys) => headers.find(h => keys.includes(n(h))) ||
                                   headers.find(h => keys.some(k => n(h).includes(k)));

        this._colCodigo   = find('codigo','cod','codproduto','codigoproduto','referencia','ref','sku');
        this._colDesc     = find('descricao','desc','descproduto','produto','nomeproduto','descricaoproduto');
        this._colData     = find('data','datavenda','datapedido','dataemissao','datacriacao','dtpedido');
        this._colCliente  = find('cliente','nomecliente','nome','razaosocial','nomrazaosocial','comprador');
        this._colQtd      = find('quantidade','qtd','qty','qtde','quant');
        this._colValUnit  = find('valorunitario','valunit','valorunit','precounitario','preco','unitario','vlrunit');
        this._colValTotal = find('valortotal','total','valorrs','vltotal','vlrtotal','valorbruto','bruto');

        const ordem = [this._colCodigo, this._colDesc, this._colData, this._colCliente,
                       this._colQtd, this._colValUnit, this._colValTotal];
        this.colunas = ordem.filter(Boolean);

        if (!this.colunas.length) this.colunas = headers;
    },

    _finalizarImport() {
        this._detectCombosCols();
        document.getElementById('cliente-drop-zone').style.display = 'none';
        document.getElementById('cliente-data').classList.add('visible');
        this.render();
        this.perguntarESalvar(this._nomeArquivo);
    },

    _detectCombosCols() {
        // col1 = Cliente, col2 = oculto
        this._col1 = this._colCliente || null;
        this._col2 = null;

        const uniq = col => col
            ? [...new Set(this.rawData.map(r => String(r.dados?.[col] ?? '')).filter(Boolean))].sort()
            : [];

        this._col1Values   = uniq(this._col1);
        this._col1Selected = '';
        this._col2Selected = '';

        const w1 = document.getElementById('cliente-col1-wrap');
        const w2 = document.getElementById('cliente-col2-wrap');
        const i1 = document.getElementById('cliente-col1-input');

        if (this._col1 && this._col1Values.length) {
            i1.placeholder = 'Filtrar Cliente...'; i1.value = ''; w1.style.display = '';
        } else w1.style.display = 'none';
        w2.style.display = 'none';
    },

    aplicarFiltros() {
        const q = document.getElementById('cliente-search').value.toLowerCase().trim();
        this.filtered = this.rawData.filter(r => {
            if (q && !Object.values(r.dados).some(v => String(v).toLowerCase().includes(q))) return false;
            if (this._col1Selected && String(r.dados?.[this._col1] ?? '') !== this._col1Selected) return false;
            if (this._col2Selected && String(r.dados?.[this._col2] ?? '') !== this._col2Selected) return false;
            return true;
        });
        this.render();
    },

    render() {
        const total  = this.rawData.length;
        const filt   = this.filtered.length;
        const toNum  = v => typeof v === 'number' ? v : (parseFloat(String(v ?? '0').replace(/\./g,'').replace(',','.')) || 0);
        const up     = v => String(v || '').toUpperCase().trim();

        const qtdTotal = this._colQtd
            ? this.filtered.reduce((s, r) => s + toNum(r.dados?.[this._colQtd]), 0) : null;
        const valTotal = this._colValTotal
            ? this.filtered.reduce((s, r) => s + toNum(r.dados?.[this._colValTotal]), 0) : null;

        document.getElementById('cliente-total').textContent     = total.toLocaleString('pt-BR');
        document.getElementById('cliente-qtd').textContent       = qtdTotal != null ? qtdTotal.toLocaleString('pt-BR') : '—';
        const elValor = document.getElementById('cliente-valor');
        if (elValor) elValor.textContent = valTotal != null
            ? 'R$ ' + valTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—';
        document.getElementById('cliente-filtrados').textContent = filt.toLocaleString('pt-BR');
        document.getElementById('cliente-count').textContent     = `${filt.toLocaleString('pt-BR')} registros${filt > 2000 ? ' (exibindo 2000)' : ''}`;

        const empty = '<span style="opacity:.3">—</span>';
        const table = document.getElementById('cliente-table');

        // Detecta se a descrição tem padrão pipe: "MODELO | COR | MARCA | TAM. X - Ref. 00000"
        const sampleDesc = this._colDesc ? String(this.filtered[0]?.dados?.[this._colDesc] || '') : '';
        const hasPipe = sampleDesc.includes('|');

        if (hasPipe) {
            table.querySelector('thead tr').innerHTML =
                ['CÓDIGO','MODELO','COR','MARCA','TAMANHO','DATA','CLIENTE','QUANT.','VALOR UNIT.','VALOR TOTAL']
                .map(h => `<th>${h}</th>`).join('');

            table.querySelector('tbody').innerHTML = this.filtered.slice(0, 2000).map(r => {
                const desc   = String(r.dados?.[this._colDesc] || '');
                const pts    = desc.split('|').map(p => p.trim());
                const modelo  = up(pts[0]);
                const cor     = up(pts[1]);
                const marca   = up(pts[2]);
                const tamanho = up((pts[3] || '').split(' - ')[0]);
                const cod     = up(r.dados?.[this._colCodigo]);
                const data    = up(r.dados?.[this._colData]);
                const cli     = up(r.dados?.[this._colCliente]);
                const qtd     = toNum(r.dados?.[this._colQtd]);
                const vUnit   = toNum(r.dados?.[this._colValUnit]);
                const vTot    = toNum(r.dados?.[this._colValTotal]);
                return `<tr>
                    <td><span style="font-family:monospace;color:#26c6da;font-weight:600;">${cod?escHTML(cod):empty}</span></td>
                    <td>${modelo?escHTML(modelo):empty}</td>
                    <td>${cor?escHTML(cor):empty}</td>
                    <td>${marca?escHTML(marca):empty}</td>
                    <td style="font-weight:600;">${tamanho?escHTML(tamanho):empty}</td>
                    <td>${data?escHTML(data):empty}</td>
                    <td style="font-weight:500;">${cli?escHTML(cli):empty}</td>
                    <td style="text-align:right;font-weight:600;">${qtd?qtd.toLocaleString('pt-BR'):empty}</td>
                    <td style="text-align:right;color:#8b949e;">${vUnit?'R$ '+vUnit.toLocaleString('pt-BR',{minimumFractionDigits:3}):empty}</td>
                    <td style="text-align:right;color:#26a69a;font-weight:600;">${vTot?'R$ '+vTot.toLocaleString('pt-BR',{minimumFractionDigits:2}):empty}</td>
                </tr>`;
            }).join('');
        } else {
            const LABELS = {
                [this._colCodigo]:   'CÓDIGO',
                [this._colDesc]:     'DESCRIÇÃO',
                [this._colData]:     'DATA',
                [this._colCliente]:  'CLIENTE',
                [this._colQtd]:      'QUANT.',
                [this._colValUnit]:  'VALOR UNIT.',
                [this._colValTotal]: 'VALOR TOTAL',
            };
            table.querySelector('thead tr').innerHTML =
                this.colunas.map(h => `<th>${LABELS[h] || escHTML(String(h).toUpperCase())}</th>`).join('');
            table.querySelector('tbody').innerHTML = this.filtered.slice(0, 2000).map(r => {
                const cells = this.colunas.map(h => {
                    const v = r.dados?.[h];
                    if (v === undefined || v === '') return `<td>${empty}</td>`;
                    const vu = escHTML(up(v));
                    if (h === this._colCodigo)
                        return `<td><span style="font-family:monospace;color:#26c6da;font-weight:600;">${vu}</span></td>`;
                    if (h === this._colQtd)
                        return `<td style="text-align:right;font-weight:600;">${toNum(v).toLocaleString('pt-BR')}</td>`;
                    if (h === this._colValUnit)
                        return `<td style="text-align:right;color:#8b949e;">R$ ${toNum(v).toLocaleString('pt-BR',{minimumFractionDigits:3})}</td>`;
                    if (h === this._colValTotal)
                        return `<td style="text-align:right;color:#26a69a;font-weight:600;">R$ ${toNum(v).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>`;
                    if (h === this._colCliente)
                        return `<td style="font-weight:500;">${vu}</td>`;
                    return `<td>${vu}</td>`;
                }).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
        }
    },

    async perguntarESalvar(nome) {
        this._nomeArquivo = nome;
        await this.salvar('nova');
    },

    async salvar(modo) {
        document.getElementById('import-modal').style.display = 'none';
        this._setSaving(true);
        try {
            if (modo === 'substituir' && this._currentId) {
                await api.deletarImportacaoCliente(this._currentId);
            }
            const linhas = this.rawData.map(r => ({ dados: r.dados }));
            const res = await api.post('/api/cliente/import', { nomeArquivo: this._nomeArquivo, linhas });
            if (res?.ok) {
                this._currentId = res.importacaoId;
                historico.registrar('importar', 'cliente', `${this.rawData.length} itens — ${this._nomeArquivo}`);
                mostrarToast(`✓ ${this.rawData.length.toLocaleString('pt-BR')} clientes salvos`);
            } else if (res) {
                mostrarToast(res.erro || 'Erro ao salvar dados de cliente', 'erro');
            }
        } catch(e) {
            (console.error(e), mostrarToast('Erro de conexão. Tente de novo.', 'erro'));
        } finally { this._setSaving(false); }
        await this.carregarHistorico();
    },

    _setSaving(v) {
        const el = document.getElementById('cliente-saving');
        if (el) el.style.display = v ? '' : 'none';
    },

    async carregarHistorico() {
        const lista = await api.get('/api/importacoes-cliente');
        this._importacoes = lista || [];
        this.renderHistorico();
        if (lista?.length) {
            const latest = lista[0];
            const incompleto = this.rawData.length < (latest.total_linhas || 0);
            if (!this._currentId || this._currentId !== latest.id || incompleto) {
                await this.carregarImportacao(latest.id); return;
            }
        }
    },

    async carregarImportacao(id) {
        const rows = await api.get(`/api/cliente?importacao_id=${id}`);
        if (!rows?.length) return;
        this._currentId = id;
        const allHeaders = Object.keys(rows[0].dados || {});
        this._mapearColunas(allHeaders);
        this.rawData  = rows.map((r, i) => ({ _id: i, dados: r.dados }));
        this.filtered = [...this.rawData];
        this._detectCombosCols();
        document.getElementById('cliente-drop-zone').style.display = 'none';
        document.getElementById('cliente-data').classList.add('visible');
        this.render();
        this.renderHistorico();
        lsCache.salvar('cliente', { importacaoId: id, rawData: this.rawData });
        // Notifica dashboard de clientes
        clientesDash._dirty = true;
        const cliView = document.getElementById('view-clientes-dash');
        if (cliView && cliView.style.display !== 'none') {
            clientesDash.render();
            clientesDash._dirty = false;
        }
    },

    renderHistorico() {
        const wrap = document.getElementById('cliente-history');
        const list = document.getElementById('cliente-history-list');
        if (!this._importacoes?.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        list.innerHTML = this._importacoes.map(imp => {
            const d    = new Date(imp.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
            const ativo = imp.id === this._currentId;
            return `<div class="hi-item${ativo ? ' hi-ativo' : ''}" onclick="cliente.carregarImportacao('${imp.id}')">
                <span class="hi-dot">${ativo ? '●' : '○'}</span>
                <div class="hi-info">
                    <span class="hi-nome">${escHTML(imp.nome_arquivo)}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} clientes</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();cliente.excluir('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
        list.style.display = 'flex';
        const chev = document.getElementById('chevron-cliente');
        if (chev) chev.style.transform = 'rotate(90deg)';
    },

    exportar() {
        if (!this.filtered.length) return;
        exportarXLS(this.filtered.map(r => r.dados), 'clientes');
    },

    async excluir(id) {
        if (!confirm('Excluir esta importação?')) return;
        await api.deletarImportacaoCliente(id);
        if (this._currentId === id) {
            this.rawData = []; this.filtered = [];
            document.getElementById('cliente-data').classList.remove('visible');
            document.getElementById('cliente-drop-zone').style.display = '';
            this._currentId = null;
        }
        await this.carregarHistorico();
    }
};

// ====== ARQUITETURA DE DADOS — factory genérica ======

function criarModuloArq(id, nomeApi) {
    return {
        rawData: [], filtered: [], colunas: [],
        _importacoes: [], _currentId: null, _nomeArquivo: '',
        _col1: null, _col1Values: [], _col1Selected: '',
        _col2: null, _col2Values: [], _col2Selected: '',
        _colQtd: null,

        init() {
            const zone = document.getElementById(`${id}-drop-zone`);
            if (zone) {
                zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
                zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
                zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) this.handleFile(f); });
            }
            const inp = document.getElementById(`file-input-${id}`);
            if (inp) inp.addEventListener('change', e => { const f = e.target.files[0]; if (f) this.handleFile(f); inp.value = ''; });
            document.getElementById(`${id}-search`)?.addEventListener('input', () => this.aplicarFiltros());
            this._setupCombo(`${id}-col1-input`,`${id}-col1-dropdown`,'_col1Selected','_col1Values');
            this._setupCombo(`${id}-col2-input`,`${id}-col2-dropdown`,'_col2Selected','_col2Values');
        },

        limpar() {
            document.getElementById(`${id}-search`).value = '';
            this._col1Selected = ''; this._col2Selected = '';
            document.getElementById(`${id}-col1-input`).value = '';
            document.getElementById(`${id}-col2-input`).value = '';
            document.getElementById(`${id}-col1-dropdown`).classList.remove('open');
            document.getElementById(`${id}-col2-dropdown`).classList.remove('open');
            this.aplicarFiltros();
        },

        _setupCombo(inputId, dropId, selKey, valsKey) {
            const input = document.getElementById(inputId);
            const drop  = document.getElementById(dropId);
            if (!input || !drop) return; // módulo sem combos no HTML (ex: calendario) — não pode matar o bootstrap
            input.addEventListener('focus', () => { this._renderDrop(drop, input, selKey, valsKey, ''); drop.classList.add('open'); });
            input.addEventListener('input', () => { this[selKey] = ''; this._renderDrop(drop, input, selKey, valsKey, input.value); drop.classList.add('open'); this.aplicarFiltros(); });
            document.addEventListener('mousedown', e => { if (!e.target.closest(`#${dropId}`) && !e.target.closest(`#${inputId}`)) drop.classList.remove('open'); });
        },

        _renderDrop(drop, input, selKey, valsKey, q) {
            const term = q.toLowerCase().trim();
            const matches = term ? this[valsKey].filter(v => v.toLowerCase().includes(term)) : this[valsKey];
            drop.innerHTML = `<div class="combobox-option clear-opt" data-val="">Todos</div>` +
                matches.slice(0,100).map(v => `<div class="combobox-option${v===this[selKey]?' active':''}" data-val="${v}">${v}</div>`).join('');
            drop.querySelectorAll('.combobox-option').forEach(el => {
                el.addEventListener('mousedown', e => { e.preventDefault(); this[selKey]=el.dataset.val; input.value=el.dataset.val; drop.classList.remove('open'); this.aplicarFiltros(); });
            });
        },

        normalizeKey: normalizeKey,

        handleFile(file) {
            this._nomeArquivo = file.name;
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'csv') Papa.parse(file, { header:true, skipEmptyLines:true, complete: r => this.processData(r.data) });
            else if (['xls','xlsx'].includes(ext)) {
                const reader = new FileReader();
                reader.onload = e => {
                    const wb   = XLSX.read(e.target.result, { type: 'array' });
                    const sheet = wb.Sheets[wb.SheetNames[0]];
                    // Lê como arrays para detectar onde estão os cabeçalhos reais
                    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
                    // Primeira linha com ≥ 3 células não-vazias é o cabeçalho
                    let headerIdx = 0;
                    for (let i = 0; i < rawRows.length; i++) {
                        const nonEmpty = rawRows[i].filter(c => String(c).trim() !== '');
                        if (nonEmpty.length >= 3) { headerIdx = i; break; }
                    }
                    const headers = rawRows[headerIdx].map((h, i) =>
                        String(h).trim() !== '' ? String(h).trim() : `__EMPTY_${i}`
                    );
                    const dataRows = rawRows.slice(headerIdx + 1)
                        .filter(row => row.some(c => String(c).trim() !== ''))
                        .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
                    this.processData(dataRows);
                };
                reader.readAsArrayBuffer(file);
            }
        },

        processData(rows) {
            if (!rows?.length) return;
            const allHeaders = Object.keys(rows[0]).filter(h => { const n=this.normalizeKey(h); return n && !n.startsWith('__'); });
            const QTD_KEYS = ['quantidade','qtd','qty','qtde','saldo','pecas','pcs'];
            this._colQtd = allHeaders.find(h => QTD_KEYS.includes(this.normalizeKey(h))) || null;
            this.colunas = allHeaders;
            this.rawData = rows.map((r,i) => ({ _id:i, dados: Object.fromEntries(allHeaders.map(h=>[h,r[h]??''])) }));
            this.filtered = [...this.rawData];
            this._detectCombosCols();
            document.getElementById(`${id}-drop-zone`).style.display = 'none';
            document.getElementById(`${id}-data`).classList.add('visible');
            this.render();
            this.perguntarESalvar(this._nomeArquivo);
        },

        _detectCombosCols() {
            const STATUS_KEYS = ['status','situacao','estado','tipo','categoria'];
            const DESC_KEYS   = ['descricao','descr','desc','produto','nome'];
            const find = keys => this.colunas.find(c => keys.includes(this.normalizeKey(c)));
            this._col1 = find(STATUS_KEYS) || this.colunas.find(c => STATUS_KEYS.some(k => this.normalizeKey(c).includes(k)));
            this._col2 = find(DESC_KEYS)   || this.colunas.find(c => DESC_KEYS.some(k => this.normalizeKey(c).includes(k)));
            const uniq = col => col ? [...new Set(this.rawData.map(r => String(r.dados?.[col]??'')).filter(Boolean))].sort() : [];
            this._col1Values = uniq(this._col1); this._col2Values = uniq(this._col2);
            this._col1Selected = ''; this._col2Selected = '';
            const w1=document.getElementById(`${id}-col1-wrap`), w2=document.getElementById(`${id}-col2-wrap`);
            const i1=document.getElementById(`${id}-col1-input`), i2=document.getElementById(`${id}-col2-input`);
            if (this._col1) { i1.placeholder=`Filtrar ${this._col1}...`; i1.value=''; w1.style.display=''; } else w1.style.display='none';
            if (this._col2) { i2.placeholder=`Filtrar ${this._col2}...`; i2.value=''; w2.style.display=''; } else w2.style.display='none';
        },

        aplicarFiltros() {
            const q = document.getElementById(`${id}-search`).value.toLowerCase().trim();
            this.filtered = this.rawData.filter(r => {
                if (q && !Object.values(r.dados).some(v => String(v).toLowerCase().includes(q))) return false;
                if (this._col1Selected && String(r.dados?.[this._col1]??'') !== this._col1Selected) return false;
                if (this._col2Selected && String(r.dados?.[this._col2]??'') !== this._col2Selected) return false;
                return true;
            });
            this.render();
        },

        render() {
            const table = document.getElementById(`${id}-table`);
            if (!table) return; // módulo sem UI no HTML (ex: calendario)
            const total = this.rawData.length, filt = this.filtered.length;
            const qtd = this._colQtd ? this.filtered.reduce((s,r) => s+(parseFloat(String(r.dados?.[this._colQtd]??'0').replace(',','.'))||0),0) : 0;
            const set = (eid, v) => { const e = document.getElementById(eid); if (e) e.textContent = v; };
            set(`${id}-total`, total.toLocaleString('pt-BR'));
            set(`${id}-qtd`, this._colQtd ? qtd.toLocaleString('pt-BR') : '—');
            set(`${id}-filtrados`, filt.toLocaleString('pt-BR'));
            set(`${id}-count`, `${filt.toLocaleString('pt-BR')} registros${filt>2000?' (exibindo 2000)':''}`);
            table.querySelector('thead tr').innerHTML = this.colunas.map(h=>`<th>${h.toUpperCase()}</th>`).join('');
            table.querySelector('tbody').innerHTML = this.filtered.slice(0,2000).map(r => {
                const cells = this.colunas.map(h => { const v=r.dados?.[h]; return `<td>${v!==undefined&&v!==''?v:'<span style="opacity:.3">—</span>'}</td>`; }).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
        },

        async perguntarESalvar(nome) {
            this._nomeArquivo = nome;
            await this.salvar('nova');
        },

        async salvar(modo) {
            document.getElementById('import-modal').style.display = 'none';
            this._setSaving(true);
            try {
                if (modo === 'substituir' && this._currentId) await api.delete(`/api/importacoes-${nomeApi}/${this._currentId}`);
                const res = await api.post(`/api/${nomeApi}/import`, { nomeArquivo: this._nomeArquivo, linhas: this.rawData.map(r=>({dados:r.dados})) });
                if (res?.ok) { this._currentId = res.importacaoId; mostrarToast(`✓ ${this.rawData.length.toLocaleString('pt-BR')} registros salvos`); }
                else alert(`Erro ao salvar. Verifique se as tabelas importacoes_${nomeApi} e dados_${nomeApi} foram criadas no Supabase.`);
            } catch(e) { (console.error(e), mostrarToast('Erro de conexão. Tente de novo.', 'erro')); } finally { this._setSaving(false); }
            await this.carregarHistorico();
        },

        _setSaving(v) { const el=document.getElementById(`${id}-saving`); if(el) el.style.display=v?'':'none'; },

        async carregarHistorico() {
            const lista = await api.get(`/api/importacoes-${nomeApi}`);
            this._importacoes = lista || [];
            this.renderHistorico();
            if (lista?.length && !this._currentId) { await this.carregarImportacao(lista[0].id); return; }
            if (!this._currentId) {
                const c = lsCache.ler(nomeApi);
                if (c?.rawData?.length) {
                    this.rawData = c.rawData; this.colunas = c.colunas || [];
                    this._currentId = c.importacaoId; this.filtered = [...this.rawData];
                    this._detectCombosCols();
                    const dz = document.getElementById(`${id}-drop-zone`);
                    if (dz) dz.style.display = 'none';
                    document.getElementById(`${id}-data`)?.classList.add('visible');
                    this.render(); mostrarToast(`Dados ${id} carregados do cache local`);
                }
            }
        },

        async carregarImportacao(id_imp) {
            const rows = await api.get(`/api/${nomeApi}?importacao_id=${id_imp}`);
            if (!rows?.length) return;
            this._currentId = id_imp;
            this.colunas = Object.keys(rows[0].dados || {});
            this.rawData = rows.map((r,i) => ({ _id:i, dados:r.dados }));
            const QTD_KEYS = ['quantidade','qtd','qty','qtde','saldo','pecas','pcs'];
            this._colQtd = this.colunas.find(h => QTD_KEYS.includes(this.normalizeKey(h))) || null;
            this.filtered = [...this.rawData];
            this._detectCombosCols();
            const dz = document.getElementById(`${id}-drop-zone`);
            if (dz) dz.style.display = 'none';
            document.getElementById(`${id}-data`)?.classList.add('visible');
            this.render(); this.renderHistorico();
            lsCache.salvar(nomeApi, { importacaoId: id_imp, colunas: this.colunas, rawData: this.rawData });
        },

        renderHistorico() {
            const wrap=document.getElementById(`${id}-history`), list=document.getElementById(`${id}-history-list`);
            if (!wrap || !list) return; // módulo sem UI no HTML (ex: calendario) — não pode derrubar o boot
            if (!this._importacoes?.length) { wrap.style.display='none'; return; }
            wrap.style.display='block';
            list.innerHTML = this._importacoes.map(imp => {
                const d = new Date(imp.criado_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
                const ativo = imp.id === this._currentId;
                return `<div class="hi-item${ativo?' hi-ativo':''}" onclick="${id}.carregarImportacao('${imp.id}')">
                    <span class="hi-dot">${ativo?'●':'○'}</span>
                    <div class="hi-info"><span class="hi-nome">${escHTML(imp.nome_arquivo)}</span><span class="hi-meta">${d} · ${imp.total_linhas} registros</span></div>
                    <button class="hi-del" onclick="event.stopPropagation();${id}.excluir('${imp.id}')" title="Excluir">✕</button>
                </div>`;
            }).join('');
            list.style.display='flex';
            const chev=document.getElementById(`chevron-${id}`); if(chev) chev.style.transform='rotate(90deg)';
        },

        async excluir(imp_id) {
            if (!confirm('Excluir esta importação?')) return;
            await api.delete(`/api/importacoes-${nomeApi}/${imp_id}`);
            if (this._currentId === imp_id) {
                this.rawData=[]; this.filtered=[];
                document.getElementById(`${id}-data`).classList.remove('visible');
                document.getElementById(`${id}-drop-zone`).style.display='';
                this._currentId=null;
            }
            await this.carregarHistorico();
        }
    };
}

// Módulo de Disponibilidade (Feriados + Turnos) — substitui o import genérico de calendário
const disponibilidade = {
    _feriados: [],
    _turnos:   [],
    _abaAtiva: 'feriados',

    async init() {
        try {
            await this.carregarFeriados();
            await this.carregarTurnos();
        } catch(e) { /* Supabase indisponível — tabelas podem não existir ainda */ }
    },

    abrirAba(aba) {
        this._abaAtiva = aba;
        document.getElementById('panel-feriados').style.display = aba === 'feriados' ? 'flex' : 'none';
        document.getElementById('panel-turnos').style.display   = aba === 'turnos'   ? 'flex' : 'none';
        document.getElementById('tab-btn-feriados').classList.toggle('active', aba === 'feriados');
        document.getElementById('tab-btn-turnos').classList.toggle('active',   aba === 'turnos');
        // Sempre recarrega dados ao abrir a aba — garante persistência após reload
        if (aba === 'feriados') this.carregarFeriados().catch(() => {});
        if (aba === 'turnos')   this.carregarTurnos().catch(() => {});
    },

    // ── FERIADOS ──────────────────────────────────────────────
    async carregarFeriados() {
        const data = await api.get('/api/feriados');
        if (data === null) {
            // Silencia erro mas não limpa dados já carregados — mantém estado anterior
            if (!this._feriados.length) this.renderFeriados();
            return;
        }
        this._feriados = data || [];
        this.renderFeriados();
    },

    filtrarFeriados() {
        const q = document.getElementById('fer-busca')?.value.toLowerCase().trim() || '';
        const lista = q ? this._feriados.filter(f =>
            f.nome.toLowerCase().includes(q) || f.tipo.toLowerCase().includes(q) || f.data.includes(q)
        ) : this._feriados;
        this._renderTabelaFeriados(lista);
    },

    renderFeriados() {
        const total      = this._feriados.length;
        const nacionais  = this._feriados.filter(f => f.tipo === 'Nacional').length;
        const outros     = total - nacionais;
        document.getElementById('fer-total').textContent     = total;
        document.getElementById('fer-nacionais').textContent = nacionais;
        document.getElementById('fer-outros').textContent    = outros;
        this._renderTabelaFeriados(this._feriados);
    },

    _renderTabelaFeriados(lista) {
        const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const tipoClass = t => ({ Nacional:'fer-nacional', Estadual:'fer-estadual', Municipal:'fer-municipal', Empresa:'fer-empresa' }[t] || 'fer-nacional');
        const sorted = [...lista].sort((a,b) => a.data.localeCompare(b.data));
        document.getElementById('fer-tbody').innerHTML = sorted.map(f => {
            const d   = new Date(f.data + 'T12:00:00');
            const fmt = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
            const dia = DIAS[d.getDay()];
            return `<tr>
                <td style="font-family:monospace;color:#26c6da;">${fmt}</td>
                <td style="color:var(--text-dim);">${dia}</td>
                <td style="font-weight:500;">${escHTML(f.nome)}</td>
                <td><span class="fer-tipo-badge ${tipoClass(f.tipo)}">${f.tipo}</span></td>
                <td class="td-center"><button onclick="disponibilidade.excluirFeriado('${f.id}')"
                    style="background:none;border:none;color:#f06292;cursor:pointer;font-size:0.85rem;padding:4px 8px;">✕</button></td>
            </tr>`;
        }).join('') || `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-dim);">Nenhum feriado cadastrado</td></tr>`;
    },

    async adicionarFeriado() {
        const data = document.getElementById('fer-data').value;
        const nome = document.getElementById('fer-nome').value.trim();
        const tipo = document.getElementById('fer-tipo').value;
        if (!data || !nome) { alert('Preencha a data e o nome do feriado.'); return; }
        const res = await api.post('/api/feriados', { data, nome, tipo });
        if (res?.ok) {
            document.getElementById('fer-data').value = '';
            document.getElementById('fer-nome').value = '';
            await this.carregarFeriados();
            mostrarToast('✓ Feriado adicionado');
        }
    },

    async excluirFeriado(id) {
        if (!confirm('Excluir este feriado?')) return;
        await api.delete(`/api/feriados/${id}`);
        await this.carregarFeriados();
    },

    async buscarFeriadosBR() {
        const ano = document.getElementById('fer-ano-br').value;
        const btn = document.getElementById('btn-buscar-br');
        btn.textContent = 'Buscando...'; btn.disabled = true;
        try {
            const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
            if (!resp.ok) throw new Error('Falha na API');
            const lista = await resp.json();

            const feriados = lista.map(f => ({
                data: f.date,
                nome: f.name,
                tipo: 'Nacional'
            }));

            const res = await api.post('/api/feriados/lote', { feriados });
            if (res?.ok) {
                mostrarToast(`✓ ${res.total} feriados nacionais de ${ano} importados`);
                await this.carregarFeriados();
            } else {
                alert('Erro ao salvar feriados. Verifique se a tabela feriados existe no Supabase.');
            }
        } catch (e) {
            alert('Não foi possível buscar os feriados. Verifique sua conexão.');
        } finally {
            btn.textContent = 'Buscar'; btn.disabled = false;
        }
    },

    importarFeriados(input) {
        const file = input.files[0];
        if (!file) return;
        input.value = '';
        const ext = file.name.split('.').pop().toLowerCase();
        const processar = rows => {
            if (!rows?.length) return;
            const nk = h => String(h).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
            const headers = Object.keys(rows[0]);
            const colData = headers.find(h => ['data','date','dt'].includes(nk(h)));
            const colNome = headers.find(h => ['nome','name','feriado','descricao','desc'].includes(nk(h)));
            const colTipo = headers.find(h => ['tipo','type','categoria'].includes(nk(h)));

            if (!colData || !colNome) {
                alert('Arquivo precisa ter colunas: Data e Nome (mínimo).');
                return;
            }

            // Normaliza data: aceita dd/mm/yyyy ou yyyy-mm-dd
            const normData = v => {
                const s = String(v ?? '').trim();
                if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
                const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (m) return `${m[3]}-${m[2]}-${m[1]}`;
                return null;
            };

            const TIPOS_VALIDOS = ['Nacional','Estadual','Municipal','Empresa'];
            const lote = rows.map(r => ({
                data: normData(r[colData]),
                nome: String(r[colNome] ?? '').trim(),
                tipo: TIPOS_VALIDOS.includes(r[colTipo]) ? r[colTipo] : 'Nacional'
            })).filter(r => r.data && r.nome);

            if (!lote.length) { alert('Nenhum registro válido encontrado.'); return; }

            api.post('/api/feriados/lote', { feriados: lote }).then(res => {
                if (res?.ok) {
                    mostrarToast(`✓ ${res.total} feriados importados`);
                    this.carregarFeriados();
                } else {
                    alert('Erro ao importar. Verifique se a tabela feriados existe no Supabase.');
                }
            });
        };

        if (ext === 'csv') {
            Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => processar(r.data) });
        } else {
            const reader = new FileReader();
            reader.onload = e => {
                const wb = XLSX.read(e.target.result, { type: 'array' });
                processar(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
            };
            reader.readAsArrayBuffer(file);
        }
    },

    // ── TURNOS ────────────────────────────────────────────────
    async carregarTurnos() {
        const data = await api.get('/api/turnos');
        this._turnos = data || [];
        this.renderTurnos();
    },

    _initDragCards(container) {
        let dragged = null;
        container.addEventListener('dragstart', e => {
            dragged = e.target.closest('.summary-card');
            if (dragged) { setTimeout(() => dragged.style.opacity = '0.4', 0); }
        });
        container.addEventListener('dragend', e => {
            const card = e.target.closest('.summary-card');
            if (card) card.style.opacity = '1';
            const order = [...container.querySelectorAll('.summary-card')].map(c => c.dataset.proc);
            localStorage.setItem('tur-proc-order', JSON.stringify(order));
        });
        container.addEventListener('dragover', e => {
            e.preventDefault();
            const over = e.target.closest('.summary-card');
            if (over && over !== dragged) {
                const rect = over.getBoundingClientRect();
                const after = e.clientX > rect.left + rect.width / 2;
                container.insertBefore(dragged, after ? over.nextSibling : over);
            }
        });
    },

    renderTurnos() {
        const minParaHora = m => { const h=Math.floor(m/60),r=m%60; return `${h}h${r?(r+'m'):''}`;};
        const calcLiq = t => {
            if (!t.inicio || !t.fim) return 0;
            const [hi,mi]=[...t.inicio.split(':').map(Number)], [hf,mf]=[...t.fim.split(':').map(Number)];
            let d=(hf*60+mf)-(hi*60+mi); if(d<0) d+=24*60;
            return Math.max(0, d - (Number(t.intervalo_min)||0));
        };

        // Agrupa por processo
        const grupos = {};
        this._turnos.forEach(t => {
            const p = t.processo || '—';
            if (!grupos[p]) grupos[p] = [];
            grupos[p].push(t);
        });

        // Cards de resumo por processo (com drag-and-drop)
        const procCards = document.getElementById('tur-proc-cards');
        if (procCards) {
            if (!Object.keys(grupos).length) {
                procCards.innerHTML = '';
            } else {
                const savedOrder = JSON.parse(localStorage.getItem('tur-proc-order') || '[]');
                const allProcs = Object.keys(grupos);
                const ordered = [
                    ...savedOrder.filter(p => allProcs.includes(p)),
                    ...allProcs.filter(p => !savedOrder.includes(p)).sort((a,b) => a.localeCompare(b))
                ];
                procCards.innerHTML = '';
                ordered.forEach(proc => {
                    const turnos = grupos[proc];
                    const mins = turnos.map(t => calcLiq(t));
                    const horasProc = mins.reduce((s,m) => s + m, 0);
                    const diasProc  = new Set(turnos.flatMap(t => t.dias_semana||[])).size;
                    const parcelasStr = mins.length > 1
                        ? `<span class="s-sub" style="font-size:0.68rem;opacity:.75;">${mins.map(m => minParaHora(m)).join(' + ')} = ${minParaHora(horasProc)}</span>`
                        : '';
                    const card = document.createElement('div');
                    card.className = 'summary-card';
                    card.draggable = true;
                    card.dataset.proc = proc;
                    card.style.cssText = 'border-left:3px solid var(--indigo-btn);cursor:grab;';
                    card.innerHTML = `<span class="s-label">${proc.toUpperCase()}</span>
                        <span class="s-value" style="color:#26c6da;">${minParaHora(horasProc)}</span>
                        ${parcelasStr}
                        <span class="s-sub">${turnos.length} turno${turnos.length>1?'s':''} · ${diasProc} dia${diasProc!==1?'s':''}/sem</span>`;
                    procCards.appendChild(card);
                });
                this._initDragCards(procCards);
            }
        }

        // Popula datalist de processos para autocomplete
        const processosList = [...new Set(this._turnos.map(t => t.processo).filter(Boolean))].sort();
        const dl = document.getElementById('tur-processo-list');
        if (dl) dl.innerHTML = processosList.map(p => `<option value="${p}">`).join('');

        if (!this._turnos.length) {
            document.getElementById('tur-cards').innerHTML =
                `<div style="color:var(--text-dim);padding:24px;grid-column:1/-1;text-align:center;">Nenhum turno cadastrado</div>`;
            return;
        }

        const renderCard = t => {
            const dias = (t.dias_semana || []).map(d => `<span class="tur-dia-badge">${d}</span>`).join('');
            const intervalo = Number(t.intervalo_min) || 0;
            // Horas líquidas do turno
            let diffMin = 0;
            if (t.inicio && t.fim) {
                const [hi,mi] = t.inicio.split(':').map(Number);
                const [hf,mf] = t.fim.split(':').map(Number);
                diffMin = (hf*60+mf) - (hi*60+mi);
                if (diffMin < 0) diffMin += 24*60;
                diffMin = Math.max(0, diffMin - intervalo);
            }
            return `<div class="tur-card">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <span class="tur-card-nome">${escHTML(t.nome)}</span>
                    <div style="display:flex;gap:6px;">
                        <button onclick="disponibilidade.editarTurno('${t.id}')"
                            style="background:none;border:none;color:#8b949e;cursor:pointer;padding:0;line-height:1;" title="Editar">
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/>
                            </svg>
                        </button>
                        <button onclick="disponibilidade.excluirTurno('${t.id}')"
                            style="background:none;border:none;color:#f06292;cursor:pointer;font-size:0.85rem;" title="Excluir">✕</button>
                    </div>
                </div>
                <div class="tur-card-horario">${t.inicio?.slice(0,5) || '—'} → ${t.fim?.slice(0,5) || '—'}</div>
                ${intervalo ? `<div style="font-size:0.72rem;color:#ffab76;margin-top:2px;">
                    − ${intervalo}min intervalo &nbsp;·&nbsp; <span style="color:#26a69a;">${minParaHora(diffMin)} líquidas</span>
                </div>` : `<div style="font-size:0.72rem;color:#26a69a;margin-top:2px;">${minParaHora(diffMin)} líquidas</div>`}
                <div class="tur-card-dias" style="margin-top:6px;">${dias || '<span style="opacity:.4;font-size:0.72rem;">Nenhum dia</span>'}</div>
            </div>`;
        };

        document.getElementById('tur-cards').innerHTML = Object.entries(grupos)
            .sort(([a],[b]) => a.localeCompare(b))
            .map(([proc, turnos]) => `
                <div style="grid-column:1/-1;display:flex;flex-direction:column;gap:var(--layout-gap);">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:0.62rem;font-weight:700;letter-spacing:.1em;color:var(--text-dim);">PROCESSO</span>
                        <span style="font-size:0.9rem;font-weight:700;color:var(--indigo-primary);">${proc}</span>
                        <span style="font-size:0.7rem;color:var(--text-dim);">${turnos.length} turno${turnos.length>1?'s':''}</span>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--layout-gap);">
                        ${turnos.map(renderCard).join('')}
                    </div>
                </div>
            `).join('');
    },

    async adicionarTurno() {
        const processo    = document.getElementById('tur-processo').value.trim();
        const nome        = document.getElementById('tur-nome').value.trim();
        const inicio      = document.getElementById('tur-inicio').value;
        const fim         = document.getElementById('tur-fim').value;
        const intervalo   = parseInt(document.getElementById('tur-intervalo').value) || 0;
        const dias        = [...document.querySelectorAll('#tur-dias-wrap input:checked')].map(i => i.value);
        const faltando = [];
        if (!processo) faltando.push('Processo');
        if (!nome)     faltando.push('Nome do turno');
        if (!inicio)   faltando.push('Início');
        if (!fim)      faltando.push('Fim');
        if (faltando.length) { alert('Preencha: ' + faltando.join(', ')); return; }
        const res = await api.post('/api/turnos', { processo, nome, inicio, fim, intervalo_min: intervalo, dias_semana: dias });
        if (res?.ok) {
            document.getElementById('tur-processo').value  = '';
            document.getElementById('tur-nome').value      = '';
            document.getElementById('tur-inicio').value    = '';
            document.getElementById('tur-fim').value       = '';
            document.getElementById('tur-intervalo').value = '0';
            document.querySelectorAll('#tur-dias-wrap input').forEach(i => i.checked = false);
            await this.carregarTurnos();
            mostrarToast(`✓ Turno adicionado em ${processo}`);
        }
    },

    editarTurno(id) {
        const t = this._turnos.find(x => String(x.id) === String(id));
        if (!t) return;
        const dias = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
        document.getElementById('tur-edit-id').value         = t.id;
        document.getElementById('tur-edit-processo').value   = t.processo || '';
        document.getElementById('tur-edit-nome').value       = t.nome || '';
        document.getElementById('tur-edit-inicio').value     = t.inicio?.slice(0,5) || '';
        document.getElementById('tur-edit-fim').value        = t.fim?.slice(0,5) || '';
        document.getElementById('tur-edit-intervalo').value  = t.intervalo_min || 0;
        dias.forEach(d => {
            const cb = document.getElementById('tur-edit-dia-' + d);
            if (cb) cb.checked = (t.dias_semana || []).includes(d);
        });
        document.getElementById('tur-edit-modal').style.display = 'flex';
    },

    async salvarEdicaoTurno() {
        const id        = document.getElementById('tur-edit-id').value;
        const processo  = document.getElementById('tur-edit-processo').value.trim();
        const nome      = document.getElementById('tur-edit-nome').value.trim();
        const inicio    = document.getElementById('tur-edit-inicio').value;
        const fim       = document.getElementById('tur-edit-fim').value;
        const intervalo = parseInt(document.getElementById('tur-edit-intervalo').value) || 0;
        const dias      = [...document.querySelectorAll('#tur-edit-dias-wrap input:checked')].map(i => i.value);
        if (!processo || !nome || !inicio || !fim) { alert('Preencha todos os campos.'); return; }
        const res = await api.put(`/api/turnos/${id}`, { processo, nome, inicio, fim, intervalo_min: intervalo, dias_semana: dias });
        if (res?.ok) {
            document.getElementById('tur-edit-modal').style.display = 'none';
            await this.carregarTurnos();
            mostrarToast('✓ Turno atualizado');
        }
    },

    async excluirTurno(id) {
        if (!confirm('Excluir este turno?')) return;
        await api.delete(`/api/turnos/${id}`);
        await this.carregarTurnos();
    }
};

const calendario = criarModuloArq('calendario', 'calendario');
const capacidade = criarModuloArq('capacidade',  'capacidade');

// ====== TOC — TEORIA DAS RESTRIÇÕES ======
const toc = {
    _filaGargalo: [],
    _resultProcs: [],
    _sortFila: 'carga',
    // Processos com mapeamento para colunas do banco de dados
    _PROCS: [
        { id: 'tecelagem',      nome: 'Tecelagem',           cols: ['Tempo Tece Frente','Tempo Tece Costas','Tempo Tecelagem','Tempo Frente Eng','Tempo Costas Eng','Tempo Tecelagem Eng'] },
        { id: 'costura_auto',   nome: 'Costura Automática',  cols: ['Tempo Costura Automática','Tempo Costura Automatica','Tempo Costura'] },
        { id: 'costura_manual', nome: 'Costura Manual',      cols: ['Tempo Costura Manual','Tempo Costura Manual '] },
        { id: 'soldagem',       nome: 'Soldagem',            cols: ['Soldagem','Tempo Soldagem','Soldagem '] },
        { id: 'silicone',       nome: 'Silicone',            cols: ['Silicone','Tempo Silicone'] },
        { id: 'passadoria',     nome: 'Passadoria',          cols: ['Passadoria','Tempo Passadoria'] },
        { id: 'embalagem',      nome: 'Embalagem',           cols: ['Embalagem','Tempo Embalagem'] },
    ],

    init() {
        this._renderCapacidade();
        this._loadCapConfig().catch(() => {}); // re-renderiza a capacidade quando o servidor responder
        this._popularAnos();
        document.getElementById('toc-fonte-sel')?.addEventListener('change', () => {
            const fonte = document.getElementById('toc-fonte-sel').value;
            const wVxe   = document.getElementById('toc-vxe-periodo-wrap');
            const wPlano = document.getElementById('toc-plano-mes-wrap');
            if (wVxe)   wVxe.style.display   = fonte === 'vxe'   ? '' : 'none';
            if (wPlano) wPlano.style.display = fonte === 'plano' ? '' : 'none';
            if (fonte === 'plano') this._popularMesesPlano();
        });
    },

    _popularMesesPlano() {
        const sel = document.getElementById('toc-plano-mes');
        if (!sel) return;
        const meses = [...new Set(Object.keys(planoProducao._plano).map(k => k.split('_')[0]))].sort();
        const cur = sel.value;
        sel.innerHTML = '<option value="all">Todos os meses</option>' +
            meses.map(m => `<option value="${m}"${m === cur ? ' selected' : ''}>${m}</option>`).join('');
    },

    _popularAnos() {
        const sel = document.getElementById('toc-ano-sel');
        if (!sel) return;
        const anos = vendas.years || [];
        const cur = sel.value;
        sel.innerHTML = '<option value="all">Todos os anos</option>' +
            anos.map(a => `<option value="${a}"${a === cur ? ' selected' : ''}>${a}</option>`).join('');
    },

    // Fonte única de capacidade: servidor (capacidade_config) > derivado do cadastro de máquinas > localStorage > default.
    // localStorage é apenas cache offline — cada navegador via valores diferentes antes disso.
    _capCache:  null,
    _capOrigem: {},

    async _loadCapConfig() {
        const [config, procs, maqs] = await Promise.all([
            api.get('/api/capacidade-config'),
            api.get('/api/processos-config'),
            api.get('/api/maquinas'),
        ]);
        const serverCfg = {};
        (config || []).forEach(r => { serverCfg[r.processo] = { maquinas: Number(r.maquinas)||1, horasDia: Number(r.horas_dia)||8, oee: Number(r.oee)||100 }; });

        // Derivação do cadastro: postos = Σ(n_pessoas||1) das máquinas ativas; OEE = média das máquinas
        const porPid = {};
        const naoMapeados = [];   // B6: processos cujo nome não casa com nenhuma etapa do TOC — não somem em silêncio
        if (procs?.length && maqs?.length) {
            const pidDe = {};
            procs.forEach(p => { const pid = preactor._procTextoParaId(p.nome); if (pid) pidDe[p.id] = pid; else naoMapeados.push(p.nome); });
            maqs.filter(m => String(m.status||'Ativo').toLowerCase() !== 'inativo').forEach(m => {
                const pid = pidDe[m.processo_id];
                if (!pid) return;
                if (!porPid[pid]) porPid[pid] = { postos: 0, oees: [] };
                porPid[pid].postos += Math.max(Number(m.n_pessoas) || 1, 1);
                if (m.oee != null) porPid[pid].oees.push(Number(m.oee));
            });
        }

        let lsCap = {};
        try { lsCap = JSON.parse(localStorage.getItem('toc-cap') || '{}'); } catch {}

        const cache = {}, origem = {};
        this._PROCS.forEach(p => {
            if (serverCfg[p.id]) { cache[p.id] = serverCfg[p.id]; origem[p.id] = 'servidor'; return; }
            const d = porPid[p.id];
            if (d) {
                const oeeMed = d.oees.length ? d.oees.reduce((s,o)=>s+o,0)/d.oees.length : 100;
                cache[p.id] = { maquinas: d.postos, horasDia: lsCap[p.id]?.horasDia || 8, oee: Math.round(oeeMed) };
                origem[p.id] = 'cadastro';
                return;
            }
            if (lsCap[p.id]) { cache[p.id] = lsCap[p.id]; origem[p.id] = 'local'; return; }
            cache[p.id] = { maquinas: 1, horasDia: 8, oee: 100 };
            origem[p.id] = 'padrão';
        });
        this._capCache  = cache;
        this._capOrigem = origem;
        this._capNaoMapeados = naoMapeados;   // B6: exposto para aviso no render
        if (naoMapeados.length) console.warn('TOC · processos sem etapa correspondente (máquinas ignoradas na capacidade):', naoMapeados);
        this._renderCapacidade();
        return cache;
    },

    _getCap() {
        if (this._capCache) return this._capCache;
        try { return JSON.parse(localStorage.getItem('toc-cap') || '{}'); } catch { return {}; }
    },

    _saveCap() {
        const obj = {};
        this._PROCS.forEach(p => {
            const mEl = document.getElementById(`toc-maq-${p.id}`);
            const hEl = document.getElementById(`toc-hdia-${p.id}`);
            const oEl = document.getElementById(`toc-oee-${p.id}`);
            const atual = (this._capCache || {})[p.id] || { maquinas: 1, horasDia: 8, oee: 100 };
            const mN = parseFloat(mEl?.value), hN = parseFloat(hEl?.value), oN = parseFloat(oEl?.value);
            obj[p.id] = {
                maquinas: Number.isFinite(mN) ? mN : atual.maquinas, // aceita 0 = processo desativado
                horasDia: Number.isFinite(hN) && hN > 0 ? hN : atual.horasDia,
                oee:      Number.isFinite(oN) && oN > 0 ? oN : atual.oee,
            };
        });
        this._capCache = obj;
        this._PROCS.forEach(p => { this._capOrigem[p.id] = 'servidor'; });
        localStorage.setItem('toc-cap', JSON.stringify(obj));
        // Persiste no servidor — fonte única para todos os navegadores/usuários
        api.post('/api/capacidade-config/bulk', {
            items: this._PROCS.map(p => ({ processo: p.id, maquinas: obj[p.id].maquinas, horas_dia: obj[p.id].horasDia, oee: obj[p.id].oee })),
        }).then(r => {
            if (!r?.ok) mostrarToast('Capacidade salva só neste navegador — tabela capacidade_config não existe (rode o /setup).', 'aviso');
        }).catch(() => {});
        return obj;
    },

    _renderCapacidade() {
        const grid = document.getElementById('toc-cap-grid');
        if (!grid) return;
        const cap = this._getCap();
        const CORES_ORIGEM = { servidor: '#26a69a', cadastro: '#26c6da', local: '#ffca28', 'padrão': '#f06292' };
        // B6: avisa quando há processos cadastrados que não casam com nenhuma etapa do TOC (máquinas ignoradas na capacidade)
        const aviso = (this._capNaoMapeados?.length)
            ? `<div style="grid-column:1/-1;display:flex;align-items:flex-start;gap:8px;padding:9px 12px;background:rgba(255,202,40,.08);border:1px solid rgba(255,202,40,.35);border-radius:8px;font-size:.72rem;color:#ffca28;">
                 <span>⚠</span><span><strong>${this._capNaoMapeados.length} processo(s) sem etapa correspondente</strong> — máquinas de <em>${this._capNaoMapeados.map(escHTML).join(', ')}</em> não entram na capacidade. Renomeie em Configuração › Processos para casar com uma etapa do TOC.</span>
               </div>`
            : '';
        grid.innerHTML = aviso + this._PROCS.map(p => {
            const c = cap[p.id] || { maquinas: 1, horasDia: 8, oee: 100 };
            const org = this._capOrigem[p.id];
            const badge = org ? `<span title="Origem do valor: ${org === 'cadastro' ? 'derivado do cadastro de máquinas (Configuração › Processos)' : org === 'servidor' ? 'configuração salva no servidor' : org === 'local' ? 'apenas deste navegador — clique CALCULAR para salvar no servidor' : 'valor padrão — configure e calcule para salvar'}"
                style="font-size:.58rem;font-weight:700;letter-spacing:.05em;color:${CORES_ORIGEM[org]};border:1px solid ${CORES_ORIGEM[org]}55;border-radius:4px;padding:1px 5px;">${org.toUpperCase()}</span>` : '';
            return `<div style="display:flex;flex-direction:column;gap:8px;padding:10px 14px;background:var(--bg-input);border-radius:8px;border:1px solid var(--border-color);">
                <span style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:0.82rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${p.nome}">${p.nome} ${badge}</span>
                <div style="display:flex;align-items:center;gap:6px;">
                    <input id="toc-maq-${p.id}" type="number" value="${c.maquinas}" min="0" step="0.5"
                        style="width:48px;padding:4px 6px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:0.8rem;text-align:center;"
                        title="Máquinas/operadores">
                    <span style="font-size:0.7rem;color:var(--text-dim);">máq</span>
                    <span style="font-size:0.7rem;color:var(--text-dim);margin:0 1px;">×</span>
                    <input id="toc-hdia-${p.id}" type="number" value="${c.horasDia}" min="1" max="24" step="0.5"
                        style="width:48px;padding:4px 6px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:0.8rem;text-align:center;"
                        title="Horas por dia">
                    <span style="font-size:0.7rem;color:var(--text-dim);">h/dia</span>
                    <span style="font-size:0.7rem;color:var(--text-dim);margin:0 1px;">·</span>
                    <input id="toc-oee-${p.id}" type="number" value="${c.oee ?? 100}" min="10" max="100" step="1"
                        style="width:48px;padding:4px 6px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:0.8rem;text-align:center;"
                        title="OEE nominal (planejado) usado no cálculo de capacidade — ${org === 'cadastro' ? 'média do OEE cadastrado das máquinas' : 'valor de planejamento'}. NÃO é o OEE medido em tempo real (esse aparece no Cockpit/Home, a partir dos apontamentos).">
                    <span style="font-size:0.7rem;color:var(--text-dim);" title="OEE nominal de planejamento — distinto do OEE medido do Cockpit">% OEE<sup style="font-size:.5rem;color:var(--text-dim);">nom</sup></span>
                </div>
            </div>`;
        }).join('');
    },

    _getTempoMinutos(dados, cols) {
        if (!dados) return 0;   // null-guard: código sem dados no banco
        // Busca tolerante: tenta exato, depois trim, depois case-insensitive
        const dadosTrim = Object.fromEntries(Object.entries(dados).map(([k,v])=>[k.trim().toLowerCase(), v]));
        let total = 0;
        for (const col of cols) {
            // exato
            let raw = dados[col];
            // com trim
            if (raw === undefined) raw = dados[col.trim()];
            // case-insensitive + trim
            if (raw === undefined) raw = dadosTrim[col.trim().toLowerCase()];
            const v = parseFloat(String(raw ?? '').replace(',', '.'));
            if (!isNaN(v) && v > 0) total += v;
        }
        return total;
    },

    _getDemanda() {
        const fonte = document.getElementById('toc-fonte-sel')?.value || 'vxe';
        const anoSel = document.getElementById('toc-ano-sel')?.value || 'all';

        if (fonte === 'plano') {
            // Plano de Produção (S&OP) como demanda — simula gargalos do que VAI ser produzido
            if (!Object.keys(planoProducao._plano).length) {
                alert('Nenhum Plano de Produção salvo.\n\nVá em S&OP › Plano de Produção, gere (AUTO-SUGERIR ou Política de Estoques), edite e clique SALVAR PLANO.');
                return null;
            }
            const mesSel = document.getElementById('toc-plano-mes')?.value || 'all';
            const mapa = {};
            Object.entries(planoProducao._plano).forEach(([k, qty]) => {
                const [mes, ...rest] = k.split('_');
                const cod = rest.join('_').trim().toUpperCase();
                if (mesSel !== 'all' && mes !== mesSel) return;
                if (cod && qty > 0) mapa[cod] = (mapa[cod] || 0) + qty;
            });
            if (!Object.keys(mapa).length) { alert('Plano vazio para o mês selecionado.'); return null; }
            return mapa;
        }

        if (fonte === 'vxe') {
            // Média mensal de vendas por código
            if (!vendas.rawData.length) { alert('Importe dados de Vendas primeiro.'); return null; }
            this._popularAnos();
            const cols = anoSel === 'all' ? vendas.monthCols : vendas.monthCols.filter(c => c.year === anoSel);
            const div = cols.length || 1;
            const mapa = {}; // código → qtd média/mês
            vendas.rawData.forEach(r => {
                const cod = String(r.codigo || '').trim().toUpperCase();
                if (!cod) return;
                const total = cols.reduce((s, c) => s + (r[c.key] || 0), 0);
                mapa[cod] = (mapa[cod] || 0) + total / div;
            });
            return mapa;
        } else {
            // OP: soma por código
            if (!op.rawData.length) { alert('Importe dados de OP primeiro.'); return null; }
            const COD_K = ['codigo','cod','codigodoproduto','cdproduto','ref','referencia'];
            const QTD_K = ['producao','quantidade','qtd','aproduzir','pecas'];
            const codCol = op._colRef || op.colunas.find(c => { const n=normalizeKey(c); return COD_K.some(k => n===k||n.includes(k)); });
            const qtdCol = op._colQtd || op.colunas.find(c => { const n=normalizeKey(c); return QTD_K.some(k => n===k||n.includes(k)); });
            if (!codCol) { alert('Coluna de Código não encontrada na OP.'); return null; }
            const mapa = {};
            op.rawData.forEach(r => {
                const cod = String(r.dados?.[codCol] || '').trim().toUpperCase();
                const qty = toNumBR(r.dados?.[qtdCol]);
                if (cod && qty) mapa[cod] = (mapa[cod] || 0) + qty;
            });
            return mapa;
        }
    },

    async calcular() {
        if (!banco.rawData.length) { alert('Importe o Banco de Dados primeiro.'); return; }
        if (!this._capCache) await this._loadCapConfig().catch(() => {});
        // Fonte plano: garante plano carregado do Supabase antes de checar
        const fonteSel = document.getElementById('toc-fonte-sel')?.value;
        if (fonteSel === 'plano' && !Object.keys(planoProducao._plano).length) {
            await planoProducao._loadPlanoFromDB().catch(() => {});
            this._popularMesesPlano();
        }
        const cap = this._saveCap();
        const demanda = this._getDemanda();
        if (!demanda) return;

        const dias = parseFloat(document.getElementById('toc-dias')?.value) || 22;

        // Mapa banco: código → dados
        const bancoMap = {};
        banco.rawData.forEach(r => {
            const cod = String(r.dados?.['Código'] ?? '').trim().toUpperCase();
            if (cod) bancoMap[cod] = r.dados;
        });

        // Calcula carga por processo
        const resultados = this._PROCS.map(p => {
            const capP = cap[p.id] || { maquinas: 1, horasDia: 8, oee: 100 };
            const capMin = capP.maquinas * capP.horasDia * 60 * dias * (Math.min(capP.oee || 100, 100) / 100);
            let cargaMin = 0;
            const topPecas = [];

            Object.entries(demanda).forEach(([cod, qty]) => {
                const dados = bancoMap[cod];
                if (!dados) return;
                const tempoUn = this._getTempoMinutos(dados, p.cols);
                if (!tempoUn) return;
                const carga = tempoUn * qty;
                cargaMin += carga;
                topPecas.push({ cod, tempoUn, qty, carga });
            });

            topPecas.sort((a, b) => b.carga - a.carga);
            const util = capMin > 0 ? cargaMin / capMin : null;
            const semDados = cargaMin === 0;

            return {
                ...p,
                cargaMin,
                cargaH: cargaMin / 60,
                capMin,
                capH: capMin / 60,
                util,
                semDados,
                topPecas: topPecas.slice(0, 15),
            };
        });

        // Tecelagem: capacidade REAL dos teares cadastrados (OEE por tear), não o OEE agregado da config.
        // Sem isso o OEE órfão da capacidade_config falsearia a Tecelagem como gargalo.
        const modsTec = await this.calcularStoll(demanda, bancoMap, dias, cap).catch(() => []);
        if (modsTec.length) {
            const capTear   = modsTec.reduce((s,m)=> s + (isFinite(m.capMin)?m.capMin:0), 0);
            const cargaTear = modsTec.reduce((s,m)=> s + m.cargaMin, 0);
            const tec = resultados.find(r => r.id === 'tecelagem');
            if (tec && capTear > 0) {
                tec.capMin = capTear; tec.capH = capTear/60;
                tec.cargaMin = cargaTear; tec.cargaH = cargaTear/60;
                tec.util = cargaTear / capTear; tec.semDados = cargaTear === 0;
            }
        }

        // Ordena por utilização decrescente
        const comDados = resultados.filter(r => !r.semDados).sort((a, b) => (b.util||0) - (a.util||0));
        const semDados = resultados.filter(r => r.semDados);
        const ordenados = [...comDados, ...semDados];
        const gargalo = comDados[0] || null;

        this._demandaAtual = demanda;
        this._renderResultado(gargalo, ordenados);
        // Detalhamento da tecelagem por modelo Stoll (usa cadastro de máquinas do Supabase)
        this._renderStoll(demanda, bancoMap, dias, cap).catch(e => console.error('Stoll:', e));
    },

    // ── TECELAGEM POR MODELO STOLL ───────────────────────────────
    // Capacidade por modelo = máquinas cadastradas (Configuração › Processos) × horas/dia × OEE da máquina.
    // Demanda por modelo = tempo de tecelagem × qty dos códigos aptos (coluna "Stoll" do Banco de Dados).
    _maquinasTec: null,

    async _loadMaquinasTecelagem() {
        if (this._maquinasTec !== null) return this._maquinasTec;
        // Fase 1b: gargalo Stoll lê a fonte única de recurso (maquina do MES via
        // vw_maquina_sigs), não mais a 'maquinas' do SIGS. Mesmo formato/contrato.
        const [procs, maqs] = await Promise.all([api.get('/api/processos-config'), api.get('/api/maquinas-unificado')]);
        const tec = (procs || []).find(p => /tecel/i.test(p.nome || ''));
        if (!tec) { this._maquinasTec = []; return []; }
        this._maquinasTec = (maqs || []).filter(m => m.processo_id === tec.id && String(m.status || 'Ativo').toLowerCase() !== 'inativo');
        return this._maquinasTec;
    },

    _getModeloStoll(dados) {
        if (!dados) return '';
        for (const k of Object.keys(dados)) {
            if (k.trim().toLowerCase() === 'stoll') return String(dados[k] ?? '').trim();
        }
        return '';
    },

    // Normaliza um token de modelo de tear: 'Stoll 530' / ' 530.0 ' → '530'. Casa a coluna
    // "Stoll" do Banco com o maquina.modelo do cadastro (ambos passam por aqui).
    _normModelo(tok) {
        let s = String(tok ?? '').trim().toLowerCase();
        if (!s) return '';
        s = s.replace(/stoll/g, '').trim();
        const m = s.match(/\d+/);
        return m ? m[0] : s.toUpperCase();
    },

    // Conjunto de modelos de tear APTOS do código. A coluna "Stoll" aceita lista ("530, 330").
    // Retrocompatível: um valor único vira conjunto de 1. Vazia → [] (sem modelo apto declarado).
    _getModelosStoll(dados) {
        const raw = this._getModeloStoll(dados);
        if (!raw) return [];
        return [...new Set(String(raw).split(/[,;/|]+/).map(t => this._normModelo(t)).filter(Boolean))];
    },

    // Cálculo puro da tecelagem por modelo Stoll (reusado pelo TOC e pelo Plano de Produção).
    // Capacidade por modelo = soma tear a tear de (h/dia × dias × OEE do PRÓPRIO tear, do cadastro
    // Processos › Tecelagem); carga = tempo × qty do 1º modelo apto (coluna Stoll).
    async calcularStoll(demanda, bancoMap, dias, cap) {
        const maquinas = await this._loadMaquinasTecelagem();
        if (!maquinas.length) return [];
        const tecProc  = this._PROCS.find(p => p.id === 'tecelagem');
        const horasDia = (cap?.tecelagem?.horasDia) || 8;
        const capModelo = {}; // modelo → { mins, n }
        maquinas.forEach(m => {
            const modelo = this._normModelo(m.modelo) || '(sem modelo)';
            const oee = Math.min(m.oee == null ? 100 : Number(m.oee), 100) / 100;   // OEE do próprio tear (cadastro Processos)
            if (!capModelo[modelo]) capModelo[modelo] = { mins: 0, n: 0 };
            capModelo[modelo].mins += horasDia * 60 * dias * oee;
            capModelo[modelo].n++;
        });
        const cargaModelo = {}; // modelo → { mins, skus }
        Object.entries(demanda).forEach(([cod, qty]) => {
            const dados = bancoMap[String(cod).toUpperCase()];
            if (!dados) return;
            const tempoUn = this._getTempoMinutos(dados, tecProc.cols);
            if (!tempoUn) return; // código sem tecelagem
            const modelo = this._getModelosStoll(dados)[0] || '(sem modelo)';
            if (!cargaModelo[modelo]) cargaModelo[modelo] = { mins: 0, skus: 0 };
            cargaModelo[modelo].mins += tempoUn * qty;
            cargaModelo[modelo].skus++;
        });
        return [...new Set([...Object.keys(capModelo), ...Object.keys(cargaModelo)])]
            .map(modelo => {
                const c = capModelo[modelo] || { mins: 0, n: 0 };
                const d = cargaModelo[modelo] || { mins: 0, skus: 0 };
                return { modelo, capMin: c.mins, n: c.n, cargaMin: d.mins, skus: d.skus,
                         util: c.mins > 0 ? d.mins / c.mins : (d.mins > 0 ? Infinity : 0) };
            })
            .filter(m => m.cargaMin > 0 || m.n > 0)
            .sort((a, b) => (b.util === Infinity ? 1e9 : b.util) - (a.util === Infinity ? 1e9 : a.util));
    },

    async _renderStoll(demanda, bancoMap, dias, cap) {
        const card = document.getElementById('toc-stoll-card');
        const barras = document.getElementById('toc-stoll-barras');
        if (!card || !barras) return;
        const maquinas = await this._loadMaquinasTecelagem();
        const modelos  = await this.calcularStoll(demanda, bancoMap, dias, cap);
        if (!modelos.length) { card.style.display = 'none'; return; }
        const horasDia = (cap?.tecelagem?.horasDia) || 8;
        card.style.display = '';
        document.getElementById('toc-stoll-sub').textContent =
            `${maquinas.length} máquinas cadastradas · ${horasDia}h/dia × ${dias} dias`;

        barras.innerHTML = modelos.map(m => {
            if (m.util === Infinity) {
                return `<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--border-color);">
                    <div style="width:160px;font-size:0.82rem;font-weight:700;color:#ff5252;">Stoll ${escHTML(m.modelo)}</div>
                    <div style="flex:1;font-size:0.75rem;color:#ff5252;">⚠ ${(m.cargaMin/60).toFixed(0)}h de demanda (${m.skus} SKUs) e NENHUMA máquina deste modelo cadastrada</div>
                </div>`;
            }
            const pct  = (m.util || 0) * 100;
            const cor  = m.util >= 1 ? '#f06292' : m.util >= 0.8 ? '#ffca28' : '#26a69a';
            const lbl  = m.util >= 1 ? 'GARGALO' : m.util >= 0.8 ? 'ATENÇÃO' : 'OK';
            const barW = Math.min(pct / 1.5, 100);
            return `<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--border-color);">
                <div style="width:160px;font-size:0.82rem;font-weight:600;color:var(--text-primary);">Stoll ${escHTML(m.modelo)}
                    <span style="font-size:0.68rem;color:var(--text-dim);font-weight:400;">· ${m.n} máq</span></div>
                <div style="flex:1;height:10px;background:var(--bg-input);border-radius:5px;overflow:hidden;">
                    <div style="width:${barW}%;height:100%;background:${cor};border-radius:5px;transition:width .5s;"></div>
                </div>
                <div style="width:60px;text-align:right;font-size:0.82rem;font-weight:700;color:${cor};">${pct.toFixed(0)}%</div>
                <div style="width:70px;text-align:right;font-size:0.7rem;color:${cor};font-weight:700;">${lbl}</div>
                <div style="width:110px;text-align:right;font-size:0.72rem;color:var(--text-dim);">${(m.cargaMin/60).toFixed(0)}h / ${(m.capMin/60).toFixed(0)}h · ${m.skus} SKUs</div>
            </div>`;
        }).join('');
    },

    _renderResultado(gargalo, procs) {
        const resEl = document.getElementById('toc-resultado');
        if (!resEl) return;
        resEl.style.display = '';

        // Gargalo destaque
        if (gargalo) {
            document.getElementById('toc-gargalo-nome').textContent = gargalo.nome.toUpperCase();
            document.getElementById('toc-gargalo-sub').textContent =
                `${gargalo.cargaH.toFixed(0)}h necessárias · ${gargalo.capH.toFixed(0)}h disponíveis/mês · ${(gargalo.util * 100).toFixed(0)}% de utilização`;
        }

        // Barras de utilização
        const barrasEl = document.getElementById('toc-barras');
        barrasEl.innerHTML = procs.map(p => {
            if (p.semDados) {
                return `<div style="display:flex;align-items:center;gap:14px;padding:8px 0;border-bottom:1px solid var(--border-color);">
                    <div style="width:160px;font-size:0.82rem;color:var(--text-dim);">${p.nome}</div>
                    <div style="flex:1;height:10px;background:var(--bg-input);border-radius:5px;"></div>
                    <div style="width:80px;text-align:right;font-size:0.75rem;color:var(--text-dim);">sem dados</div>
                </div>`;
            }
            const pct = Math.min((p.util || 0) * 100, 300);
            const cor = p.util >= 1 ? '#f06292' : p.util >= 0.8 ? '#ffca28' : '#26a69a';
            const label = p.util >= 1 ? 'GARGALO' : p.util >= 0.8 ? 'ATENÇÃO' : 'OK';
            const barW = Math.min(pct / 1.5, 100); // escala visual: 150% = barra cheia
            return `<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--border-color);cursor:pointer;"
                onclick="toc._mostrarTop('${p.id}')">
                <div style="width:160px;font-size:0.82rem;font-weight:600;color:var(--text-primary);">${p.nome}</div>
                <div style="flex:1;height:10px;background:var(--bg-input);border-radius:5px;overflow:hidden;">
                    <div style="width:${barW}%;height:100%;background:${cor};border-radius:5px;transition:width .5s;"></div>
                </div>
                <div style="width:60px;text-align:right;font-size:0.82rem;font-weight:700;color:${cor};">${(p.util*100).toFixed(0)}%</div>
                <div style="width:70px;text-align:right;font-size:0.7rem;color:${cor};font-weight:700;">${label}</div>
                <div style="width:90px;text-align:right;font-size:0.72rem;color:var(--text-dim);">${p.cargaH.toFixed(0)}h / ${p.capH.toFixed(0)}h</div>
            </div>`;
        }).join('');

        // Guarda procs para o top
        this._resultProcs = procs;

        // Mostra top do gargalo por padrão
        if (gargalo) this._mostrarTop(gargalo.id);

        // Painel de cenário — reset ao calcular
        const cenWrap = document.getElementById('toc-cenario-wrap');
        if (cenWrap) {
            cenWrap.style.display = '';
            const sl = document.getElementById('toc-cen-delta');
            if (sl) sl.value = 0;
            const lb = document.getElementById('toc-cen-label');
            if (lb) lb.textContent = '+0%';
            const cb = document.getElementById('toc-cen-barras');
            if (cb) cb.innerHTML = '';
        }

        // Renderiza fila do gargalo se houver OPs enviadas pelo OP Dashboard
        this._renderFilaGargalo(gargalo);
    },

    _simularCenario(delta) {
        const pct = parseFloat(delta) || 0;
        const lb = document.getElementById('toc-cen-label');
        if (lb) lb.textContent = (pct >= 0 ? '+' : '') + pct + '%';
        if (!this._demandaAtual || !banco.rawData.length) return;

        const cap    = this._getCap();
        const dias   = parseFloat(document.getElementById('toc-dias')?.value) || 22;
        const factor = 1 + pct / 100;
        const bancoMap = {};
        banco.rawData.forEach(r => {
            const cod = String(r.dados?.['Código'] ?? '').trim().toUpperCase();
            if (cod) bancoMap[cod] = r.dados;
        });

        const resultados = this._PROCS.map(p => {
            const capP   = cap[p.id] || { maquinas: 1, horasDia: 8, oee: 100 };
            const capMin = capP.maquinas * capP.horasDia * 60 * dias * (Math.min(capP.oee || 100, 100) / 100);
            let cargaMin = 0;
            Object.entries(this._demandaAtual).forEach(([cod, qty]) => {
                const dados = bancoMap[String(cod).toUpperCase()];
                if (!dados) return;
                cargaMin += this._getTempoMinutos(dados, p.cols) * qty * factor;
            });
            const util = capMin > 0 ? cargaMin / capMin : null;
            return { ...p, cargaMin, capMin, util, semDados: cargaMin === 0 };
        }).filter(p => !p.semDados).sort((a, b) => (b.util || 0) - (a.util || 0));

        const el = document.getElementById('toc-cen-barras');
        if (!el) return;

        el.innerHTML = resultados.map(p => {
            const pct2 = (p.util || 0) * 100;
            const cor   = p.util >= 1 ? '#f06292' : p.util >= 0.8 ? '#ffca28' : '#26a69a';
            const label = p.util >= 1 ? 'GARGALO' : p.util >= 0.8 ? 'ATENÇÃO' : 'OK';
            const barW  = Math.min(pct2 / 1.5, 100);
            return `<div style="display:flex;align-items:center;gap:14px;padding:7px 0;border-bottom:1px solid var(--border-color);">
                <div style="width:160px;font-size:.82rem;font-weight:600;color:var(--text-primary);">${p.nome}</div>
                <div style="flex:1;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;">
                    <div style="width:${barW}%;height:100%;background:${cor};border-radius:4px;transition:width .1s;"></div>
                </div>
                <div style="width:55px;text-align:right;font-size:.82rem;font-weight:700;color:${cor};">${pct2.toFixed(0)}%</div>
                <div style="width:70px;text-align:right;font-size:.7rem;color:${cor};font-weight:700;">${label}</div>
            </div>`;
        }).join('');

        // Quantifica solução para processos sobrecarregados
        const gargalos = resultados.filter(p => p.util >= 1);
        if (gargalos.length) {
            const solLinhas = gargalos.map(p => {
                const capP       = cap[p.id] || { maquinas: 1, horasDia: 8 };
                const maquinas   = capP.maquinas || 1;
                const excedenteH = (p.cargaMin - p.capMin) / 60;
                const hDiaAdicional = (excedenteH / (maquinas * dias)).toFixed(1);
                const maqAdicionais = Math.ceil(p.cargaMin / p.capMin - 1);
                return `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);">
                    <div style="font-size:.82rem;font-weight:700;color:#f06292;">${escHTML(p.nome)}</div>
                    <div style="display:flex;gap:24px;margin-top:5px;flex-wrap:wrap;">
                        <div style="font-size:.78rem;"><span style="color:var(--text-dim);">+h/dia por máquina: </span><span style="color:#ffca28;font-weight:700;">+${hDiaAdicional}h</span></div>
                        <div style="font-size:.78rem;"><span style="color:var(--text-dim);">ou máquinas adicionais: </span><span style="color:#ffca28;font-weight:700;">+${maqAdicionais}</span></div>
                        <div style="font-size:.78rem;color:var(--text-dim);">sobrecarga ${((p.util - 1) * 100).toFixed(0)}% da capacidade atual</div>
                    </div>
                </div>`;
            }).join('');
            el.innerHTML += `<div style="margin-top:14px;padding:14px;background:rgba(240,98,146,.06);border-radius:8px;border:1px solid rgba(240,98,146,.2);">
                <div style="font-size:.72rem;letter-spacing:.07em;color:#f06292;margin-bottom:8px;">PARA RESOLVER — OPÇÕES DE DESBLOQUEIO</div>
                ${solLinhas}
            </div>`;
        }
    },

    _renderFilaGargalo(gargalo) {
        const wrap = document.getElementById('toc-fila-wrap');
        if (!wrap) return;
        if (!this._filaGargalo.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = '';

        const garProc = gargalo ? this._PROCS.find(p => p.id === gargalo.id) : null;

        // Calcula tempo no gargalo por OP
        const rows = this._filaGargalo.map(item => {
            const tempoUn  = garProc && item.dados ? this._getTempoMinutos(item.dados, garProc.cols) : 0;
            const cargaMin = tempoUn * item.qty;
            return { ...item, tempoUn, cargaMin };
        });

        // Ordena
        if (this._sortFila === 'tcu') {
            // Menor tempo por unidade primeiro = maximize throughput por minuto de gargalo
            rows.sort((a,b) => (a.tempoUn||9999) - (b.tempoUn||9999));
        } else {
            // Maior carga total primeiro
            rows.sort((a,b) => b.cargaMin - a.cargaMin);
        }

        const totalCargaMin = rows.reduce((s,r) => s + r.cargaMin, 0);
        const capMesMin     = gargalo ? gargalo.capMin : 0;
        const semanasNec    = capMesMin > 0 ? (totalCargaMin / (capMesMin / 4.33)) : 0;
        const semCarga      = rows.filter(r => !r.cargaMin).length;
        const nComBanco     = rows.filter(r => r.dados).length;

        // KPIs
        const kpiEl = document.getElementById('toc-fila-kpis');
        if (kpiEl) {
            const kpiData = [
                { val: rows.length,                      label: 'OPs NA FILA',         cor: 'var(--indigo-primary)' },
                { val: (totalCargaMin/60).toFixed(0)+'h', label: `CARGA NO GARGALO${gargalo?' ('+gargalo.nome+')':''}`, cor: '#f06292' },
                { val: semanasNec > 0 ? semanasNec.toFixed(1)+' sem' : '—', label: 'SEMANAS NECESSÁRIAS', cor: semanasNec>4?'#f06292':semanasNec>2?'#ffca28':'#26a69a' },
                { val: nComBanco + '/' + rows.length,     label: 'COM BANCO DE DADOS',  cor: nComBanco<rows.length?'#ffca28':'#26a69a' },
            ];
            kpiEl.innerHTML = kpiData.map(k => `
                <div style="background:var(--bg-input);border-radius:8px;padding:12px 18px;min-width:130px;text-align:center;">
                    <div style="font-size:1.3rem;font-weight:800;color:${k.cor};">${escHTML(String(k.val))}</div>
                    <div style="font-size:.65rem;color:var(--text-dim);margin-top:3px;letter-spacing:.06em;">${k.label}</div>
                </div>`).join('');
        }

        // Thead
        const thead = document.getElementById('toc-fila-thead');
        if (thead) thead.innerHTML = `
            <th style="padding:8px 12px;text-align:left;">#</th>
            <th style="padding:8px 12px;text-align:left;">CÓDIGO</th>
            <th style="padding:8px 12px;text-align:left;">DESCRIÇÃO</th>
            <th style="padding:8px 12px;text-align:right;">QTD</th>
            <th style="padding:8px 12px;text-align:right;">TEMPO/UN (min)</th>
            <th style="padding:8px 12px;text-align:right;">CARGA GARGALO (h)</th>
            <th style="padding:8px 12px;text-align:right;">% DA FILA</th>
            <th style="padding:8px 12px;text-align:center;">STATUS</th>`;

        // Tbody
        const tbody = document.getElementById('toc-fila-tbody');
        if (tbody) tbody.innerHTML = rows.map((r, i) => {
            const pctFila = totalCargaMin > 0 ? (r.cargaMin / totalCargaMin * 100).toFixed(1) : '—';
            const barW    = totalCargaMin > 0 ? Math.min(r.cargaMin / totalCargaMin * 100, 100) : 0;
            const cor     = barW > 30 ? '#f06292' : barW > 10 ? '#ffca28' : '#26a69a';
            const semDados = !r.dados || !r.cargaMin;
            return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:8px 12px;font-weight:700;color:var(--indigo-primary);font-size:.85rem;">${i+1}º</td>
                <td style="padding:8px 12px;font-weight:700;color:var(--indigo-primary);">${escHTML(r.codigo)}</td>
                <td style="padding:8px 12px;font-size:.78rem;">${escHTML((r.descricao||'').slice(0,30))}</td>
                <td style="padding:8px 12px;text-align:right;">${(r.qty||0).toLocaleString('pt-BR')}</td>
                <td style="padding:8px 12px;text-align:right;color:${semDados?'var(--text-dim)':'var(--text-primary)'};">${r.tempoUn ? r.tempoUn.toFixed(2) : '—'}</td>
                <td style="padding:8px 12px;text-align:right;">
                    <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
                        <div style="width:60px;height:5px;background:var(--bg-card);border-radius:3px;overflow:hidden;">
                            <div style="width:${barW}%;height:100%;background:${cor};border-radius:3px;"></div>
                        </div>
                        <span style="font-weight:700;color:${cor};">${r.cargaMin ? (r.cargaMin/60).toFixed(1)+'h' : '—'}</span>
                    </div>
                </td>
                <td style="padding:8px 12px;text-align:right;color:var(--text-dim);">${r.cargaMin ? pctFila+'%' : '—'}</td>
                <td style="padding:8px 12px;text-align:center;font-size:.72rem;color:var(--text-dim);">${escHTML(r.status||'—')}</td>
            </tr>`;
        }).join('');

        if (semCarga > 0) {
            const aviso = document.createElement('div');
            aviso.style.cssText = 'font-size:.75rem;color:#ffca28;margin-top:10px;';
            aviso.textContent = `${semCarga} OPs sem tempo cadastrado no Banco de Dados para o processo gargalo (${gargalo?.nome||'—'}).`;
            wrap.querySelector('.summary-card')?.appendChild(aviso);
        }
    },

    _mostrarTop(procId) {
        const p = this._resultProcs?.find(r => r.id === procId);
        if (!p || !p.topPecas?.length) return;
        document.getElementById('toc-top-proc-label').textContent = p.nome.toUpperCase();
        document.getElementById('toc-top-thead').innerHTML =
            `<th style="padding:8px 12px;text-align:left;">CÓDIGO</th>
             <th style="padding:8px 12px;text-align:right;">TEMPO/UN (min)</th>
             <th style="padding:8px 12px;text-align:right;">DEMANDA (un)</th>
             <th style="padding:8px 12px;text-align:right;">CARGA TOTAL (h)</th>
             <th style="padding:8px 12px;text-align:right;">% DO GARGALO</th>`;
        const totalCarga = p.cargaMin;
        document.getElementById('toc-top-tbody').innerHTML = p.topPecas.map((r, i) => {
            const pct = totalCarga > 0 ? (r.carga / totalCarga * 100).toFixed(1) : '—';
            const bg = i % 2 === 0 ? 'transparent' : 'var(--bg-input)';
            return `<tr style="background:${bg};">
                <td style="padding:7px 12px;font-weight:600;color:var(--indigo-primary);">${escHTML(r.cod)}</td>
                <td style="padding:7px 12px;text-align:right;">${r.tempoUn.toFixed(2)}</td>
                <td style="padding:7px 12px;text-align:right;">${r.qty.toFixed(0)}</td>
                <td style="padding:7px 12px;text-align:right;font-weight:600;">${(r.carga/60).toFixed(1)}h</td>
                <td style="padding:7px 12px;text-align:right;color:var(--text-dim);">${pct}%</td>
            </tr>`;
        }).join('');
    },
};

// Calcula dias úteis de um mês descontando fins de semana e feriados cadastrados
toc._calcDiasUteisDoMes = async function(mesStr) {
    const [ano, mes] = mesStr.split('-').map(Number);
    const diasNoMes  = new Date(ano, mes, 0).getDate();
    if (!this._feriadosCache) {
        const data = await api.get('/api/feriados');
        if (data === null) {
            // Falha de rede/servidor: não cachear Set vazio (feriados contariam como dias úteis a sessão toda)
            mostrarToast('Não foi possível carregar feriados — capacidade pode estar superestimada.', 'aviso');
        } else {
            this._feriadosCache = new Set(data.map(f => f.data?.slice(0,10)));
        }
    }
    let uteis = 0;
    for (let d = 1; d <= diasNoMes; d++) {
        const dt  = new Date(ano, mes-1, d);
        const dow = dt.getDay();
        if (dow === 0 || dow === 6) continue; // fim de semana
        const iso = `${ano}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (!(this._feriadosCache || new Set()).has(iso)) uteis++;  // A1: guard se feriados falharam (não quebra o heatmap do S&OP)
    }
    return uteis;
};

// Extensão do TOC: calcula sem alterar estado (usado por S&OP)
toc.calcularComDemanda = function(demandaMap, diasUteis) {
    if (!banco.rawData.length || !demandaMap) return [];
    const cap  = this._getCap();
    const dias = diasUteis || parseFloat(document.getElementById('toc-dias')?.value) || 22;
    const bancoMap = {};
    banco.rawData.forEach(r => {
        const cod = String(r.dados?.['Código'] ?? '').trim().toUpperCase();
        if (cod) bancoMap[cod] = r.dados;
    });
    const out = this._PROCS.map(p => {
        const capP   = cap[p.id] || { maquinas: 1, horasDia: 8, oee: 100 };
        const capMin = capP.maquinas * capP.horasDia * 60 * dias * (Math.min(capP.oee || 100, 100) / 100);
        let cargaMin = 0;
        Object.entries(demandaMap).forEach(([cod, qty]) => {
            const dados = bancoMap[String(cod).toUpperCase()];
            if (!dados) return;
            cargaMin += this._getTempoMinutos(dados, p.cols) * qty;
        });
        const util = capMin > 0 ? cargaMin / capMin : null;
        return { ...p, cargaMin, cargaH: cargaMin / 60, capMin, capH: capMin / 60, util };
    });
    // Tecelagem: capacidade real dos teares cadastrados (OEE por tear) quando o cache já carregou —
    // TODOS os consumidores (heatmap, horizonte, cenários, ciclo, plano) ficam na mesma base do TOC.
    const teares = Array.isArray(this._maquinasTec) ? this._maquinasTec : null;
    if (!teares) this._loadMaquinasTecelagem?.().catch(() => {});   // aquece o cache p/ a próxima chamada
    if (teares && teares.length) {
        const horasDia = (cap?.tecelagem?.horasDia) || 8;
        const capTear  = teares.reduce((s, m) => s + horasDia * 60 * dias * (Math.min(m.oee == null ? 100 : Number(m.oee), 100) / 100), 0);
        const tec = out.find(p => p.id === 'tecelagem');
        if (tec && capTear > 0) { tec.capMin = capTear; tec.capH = capTear / 60; tec.util = tec.cargaMin / capTear; }
    }
    return out;
};

// ====== S&OP — PREVISÃO DE DEMANDA ======
const previsao = {
    _ABBR: ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'],
    _overrides: {},
    _forecast:  [],
    _nextMonths:[],
    _seasonality:{},
    _excl: new Set(),      // SKUs excluídos (em memória; parte do plano)
    _adicionados: [],      // SKUs adicionados à mão [{codigo,descricao,segmento}]
    _planos: [],           // planos salvos (do banco)
    _planoAtivo: null,     // id do plano ativo, ou null = Base
    _dirty: false,         // há edições não salvas?
    _planosIndisp: false,  // tabela previsao_plano ainda não criada?
    _congeladoSnap: null,  // foto de qtd por mês_cod quando o plano está congelado

    init() { this._draftLoad(); this._carregarPlanos(); },

    _loadOverrides() { /* legado — o estado agora vem do rascunho/plano (_draftLoad) */ },
    _saveOverrides()  { this._marcarDirty(); },

    // Rascunho: sobrevive ao reload sem obrigar a salvar no banco (inclui os PARÂMETROS —
    // antes horizonte/método mudados voltavam ao padrão no reload sem aviso)
    _draftSave() { try { localStorage.setItem('prev-draft', JSON.stringify({ planoAtivo: this._planoAtivo, dirty: this._dirty, params: this._getParams(), overrides: this._overrides, excluidos: [...this._excl], adicionados: this._adicionados })); } catch {} },
    _draftLoad() {
        try {
            const raw = localStorage.getItem('prev-draft');
            if (raw) { const d = JSON.parse(raw); this._overrides = d.overrides || {}; this._excl = new Set((d.excluidos || []).map(String)); this._adicionados = d.adicionados || []; this._planoAtivo = d.planoAtivo || null; this._dirty = !!d.dirty; if (d.params) this._setParams(d.params); return; }
            // migração do formato antigo (localStorage solto)
            this._overrides = JSON.parse(localStorage.getItem('soep-prev-ov') || '{}');
            this._excl = new Set(JSON.parse(localStorage.getItem('prev-excluidos') || '[]').map(String));
            this._adicionados = []; this._planoAtivo = null;
            this._dirty = Object.keys(this._overrides).length > 0 || this._excl.size > 0;
        } catch { this._overrides = {}; this._excl = new Set(); this._adicionados = []; }
    },

    // ── Parâmetros e edições do plano ──
    _getParams() { return { historico: document.getElementById('prev-base-meses')?.value, horizonte: document.getElementById('prev-horizonte')?.value, metodo: document.getElementById('prev-metodo')?.value, agrupamento: document.getElementById('prev-grupo')?.value, segmento: document.getElementById('prev-seg-sel')?.value || '', modelo: document.getElementById('prev-modelo-sel')?.value || '', usarClientes: !!document.getElementById('prev-usar-cliente')?.checked }; },
    _setParams(p) { p = p || {}; const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; }; set('prev-base-meses', p.historico); set('prev-horizonte', p.horizonte); set('prev-metodo', p.metodo); set('prev-grupo', p.agrupamento); const uc = document.getElementById('prev-usar-cliente'); if (uc) uc.checked = !!p.usarClientes; this._segPend = p.segmento || ''; this._modPend = p.modelo || ''; },
    _getEdicoes() { return { overrides: this._overrides, excluidos: [...this._excl], adicionados: this._adicionados }; },
    _setEdicoes(e) { e = e || {}; this._overrides = e.overrides || {}; this._excl = new Set((e.excluidos || []).map(String)); this._adicionados = e.adicionados || []; },
    _marcarDirty() { this._dirty = true; this._draftSave(); this._renderBarraPlanos(); },
    // Parâmetro da configuração mudou: marca não-salvo; recalcula (método/base/horizonte mudam o
    // MODELO, não só a visão — antes trocar método sem CALCULAR mostrava IC/R² de outro método)
    _paramMudou(recalc) {
        this._marcarDirty();
        if (recalc && vendas.rawData.length && this._forecast.length) this.calcular();
        else this.render();
    },
    // Plano congelado é imutável (o servidor também rejeita com 409) — avisa e bloqueia a edição
    _bloqueadoCongelado() {
        if (!this._congelado) return false;
        mostrarToast('Plano congelado 🔒 — descongele para editar.', 'aviso');
        this.render();   // restaura o valor exibido (desfaz a digitação)
        return true;
    },

    // ── CRUD de planos ──
    async _carregarPlanos() {
        const r = await api.get('/api/previsao-planos').catch(() => null);
        this._planosIndisp = !Array.isArray(r);
        this._planos = Array.isArray(r) ? r : [];
        this._renderBarraPlanos();
    },
    _renderBarraPlanos() {
        const bar = document.getElementById('prev-plano-bar'); if (!bar) return;
        if (this._planosIndisp) { bar.innerHTML = `<span style="font-size:.78rem;color:#ffca28;">⚠ Planos de previsão: rode <code>previsao_plano.sql</code> no Supabase (ou /setup) para ativar. As edições continuam salvas neste navegador até lá.</span>`; return; }
        const opts = `<option value="">Base (importação)</option>` + this._planos.map(p => `<option value="${escHTML(p.id)}"${p.id === this._planoAtivo ? ' selected' : ''}>${escHTML(p.nome)}${p.congelado ? ' 🔒' : ''}</option>`).join('');
        const b = (txt, fn, cor) => `<button onclick="previsao.${fn}" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:${cor || 'var(--indigo-primary)'};font-size:.75rem;font-weight:600;cursor:pointer;">${txt}</button>`;
        const atual = this._planos.find(p => p.id === this._planoAtivo);
        bar.innerHTML = `<span style="font-size:.72rem;color:var(--text-dim);font-weight:600;letter-spacing:.05em;">PLANO:</span>
            <select onchange="previsao._selecionarPlano(this.value)" style="padding:6px 10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:7px;color:var(--text-primary);font-size:.82rem;min-width:210px;">${opts}</select>
            ${this._dirty ? `<span style="font-size:.72rem;color:#ffca28;font-weight:600;">● não salvo</span>` : (this._planoAtivo ? `<span style="font-size:.72rem;color:#26a69a;">✓ salvo</span>` : `<span style="font-size:.72rem;color:var(--text-dim);">base crua</span>`)}
            <span style="margin-left:auto;display:inline-flex;gap:6px;flex-wrap:wrap;">
                ${b('➕ SKU', '_adicionarSku()', '#26a69a')}
                ${b('+ Novo', '_novoPlano()')}
                ${b('💾 Salvar', '_salvarPlano()')}
                ${this._planoAtivo ? b('✎ Renomear', '_renomearPlano()') : ''}
                ${this._planoAtivo ? b(atual && atual.congelado ? '🔓 Descongelar' : '🔒 Congelar', '_congelarPlano()', '#0ea5e9') : ''}
                ${this._planoAtivo ? b('🗑 Excluir plano', '_excluirPlano()', '#f06292') : ''}
            </span>`;
        // mantém os selos das outras telas em sincronia com o plano ativo
        this._renderBadge('pol-plano-badge', 'politica');
        this._renderBadge('plano-prod-badge', 'plano-prod');
    },

    // Selo compartilhado do plano ativo (Política e Plano de Produção leem o MESMO plano)
    _renderBadge(containerId, origem) {
        const el = document.getElementById(containerId); if (!el) return;
        if (this._planosIndisp) { el.innerHTML = `<span style="font-size:.76rem;color:var(--text-dim);">Demanda: previsão crua (planos inativos — rode <code>previsao_plano.sql</code>)</span>`; return; }
        const atual   = this._planos.find(p => p.id === this._planoAtivo);
        const cong    = !!(atual && atual.congelado);
        const temPrev = this._forecast.length > 0;
        const opts = `<option value="">Base (importação)</option>` + this._planos.map(p =>
            `<option value="${escHTML(p.id)}"${p.id === this._planoAtivo ? ' selected' : ''}>${escHTML(p.nome)}${p.congelado ? ' 🔒' : ''}</option>`).join('');
        const estado = cong
            ? `<span style="font-size:.72rem;color:#0ea5e9;font-weight:700;">🔒 congelado</span>`
            : (this._planoAtivo ? `<span style="font-size:.72rem;color:#26a69a;">vivo</span>` : `<span style="font-size:.72rem;color:var(--text-dim);">base crua</span>`);
        const dirty  = this._dirty ? `<span style="font-size:.72rem;color:#ffca28;font-weight:600;">● não salvo</span>` : '';
        const aviso  = (origem === 'plano-prod' && temPrev && !cong)
            ? `<span style="font-size:.72rem;color:#ffca28;">⚠ demanda ainda viva — congele na Previsão para fechar o plano</span>` : '';
        const semPrev = !temPrev ? `<span style="font-size:.72rem;color:#f06292;">⚠ sem previsão calculada — abra a Previsão e clique CALCULAR</span>` : '';
        el.innerHTML = `
            <span style="font-size:.72rem;color:var(--text-dim);font-weight:600;letter-spacing:.05em;">DEMANDA (plano):</span>
            <select onchange="previsao._trocarPlanoBadge(this.value)" style="padding:6px 10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:7px;color:var(--text-primary);font-size:.82rem;min-width:200px;">${opts}</select>
            ${estado} ${dirty} ${aviso} ${semPrev}
            <a onclick="navigateTo('previsao')" style="font-size:.72rem;color:var(--indigo-primary);cursor:pointer;margin-left:auto;">editar na Previsão →</a>`;
    },
    async _trocarPlanoBadge(id) {
        await this._selecionarPlano(id);   // troca o plano ativo global (recomputa o forecast)
        this._refreshDownstream();
    },
    _refreshDownstream() {
        const vis = id => { const e = document.getElementById(id); return e && e.style.display !== 'none'; };
        if (vis('view-politica') && document.getElementById('pol-usar-prev')?.checked && politicaEstoque._rows.length) politicaEstoque.calcular();
        if (vis('view-plano-prod')) planoProducao.render();
        this._renderBadge('pol-plano-badge', 'politica');
        this._renderBadge('plano-prod-badge', 'plano-prod');
    },
    _togglePolBadge() {
        const on   = !!document.getElementById('pol-usar-prev')?.checked;
        const wrap = document.getElementById('pol-plano-badge-wrap');
        if (wrap) wrap.style.display = on ? '' : 'none';
        if (on) this._renderBadge('pol-plano-badge', 'politica');
    },
    // Ao salvar um plano, já deixa a Política usando esse plano (liga "Usar demanda da Previsão" + persiste)
    _ativarNaPolitica() {
        const cb = document.getElementById('pol-usar-prev');
        if (cb) cb.checked = true;
        try { const p = JSON.parse(localStorage.getItem('pol-params') || '{}'); p.usarPrev = true; localStorage.setItem('pol-params', JSON.stringify(p)); } catch {}
        this._togglePolBadge();
        this._refreshDownstream();   // se a Política já estiver aberta/calculada, recalcula com este plano
    },
    async _selecionarPlano(id) {
        const seq = this._loadSeq = (this._loadSeq || 0) + 1;   // token anti-corrida: só a seleção mais recente aplica
        if (!id) { this._planoAtivo = null; this._congeladoSnap = null; this._setEdicoes({}); this._dirty = false; this._draftSave(); this.calcular(); this._renderBarraPlanos(); return; }
        const p = await api.get('/api/previsao-planos/' + id).catch(() => null);
        if (seq !== this._loadSeq) return;   // usuário já trocou de plano enquanto este carregava — descarta
        if (!p || !p.id) { mostrarToast('Não consegui carregar o plano.', 'erro'); this._renderBarraPlanos(); return; }
        this._planoAtivo = p.id;
        this._setParams(p.params);
        this._setEdicoes(p.edicoes);
        this._congeladoSnap = (p.congelado && p.snapshot && Object.keys(p.snapshot).length) ? p.snapshot : null;
        this._dirty = false; this._draftSave();
        this.calcular();
        const seg = document.getElementById('prev-seg-sel'); const mod = document.getElementById('prev-modelo-sel');
        if (seg && this._segPend != null) seg.value = this._segPend;
        if (mod && this._modPend != null) mod.value = this._modPend;
        if (seg || mod) this.render();
        this._renderBarraPlanos();
        mostrarToast(`Plano "${p.nome}" carregado.`, 'ok');
    },
    async _salvarPlano() {
        if (this._planosIndisp) { mostrarToast('Rode previsao_plano.sql no Supabase primeiro.', 'erro'); return; }
        let id = this._planoAtivo, nome = this._planos.find(x => x.id === id)?.nome;
        if (!id) { nome = (prompt('Nome do plano:') || '').trim(); if (!nome) return; }
        const body = { nome, params: this._getParams(), edicoes: this._getEdicoes() };
        if (id) body.id = id;
        const congAtual = this._planos.find(x => x.id === id);
        if (congAtual) { body.congelado = congAtual.congelado; if (congAtual.congelado && this._congeladoSnap) body.snapshot = this._congeladoSnap; }
        const r = await api.post('/api/previsao-planos', body).catch(() => null);
        if (!r?.ok) { mostrarToast(r?.erro || 'Erro ao salvar o plano.', 'erro'); return; }
        this._planoAtivo = r.plano.id; this._dirty = false; this._draftSave();
        await this._carregarPlanos();
        this._ativarNaPolitica();
        mostrarToast(`Plano "${r.plano.nome}" salvo · ativo na Política.`, 'ok');
    },
    _novoPlano() {
        const nome = (prompt('Nome do novo plano (parte do estado atual):') || '').trim(); if (!nome) return;
        this._planoAtivo = null;   // força criar novo no salvar
        this._salvarPlanoComNome(nome);
    },
    async _salvarPlanoComNome(nome) {
        const r = await api.post('/api/previsao-planos', { nome, params: this._getParams(), edicoes: this._getEdicoes() }).catch(() => null);
        if (!r?.ok) { mostrarToast(r?.erro || 'Erro ao criar o plano.', 'erro'); return; }
        this._planoAtivo = r.plano.id; this._dirty = false; this._draftSave();
        await this._carregarPlanos();
        this._ativarNaPolitica();
        mostrarToast(`Plano "${nome}" criado · ativo na Política.`, 'ok');
    },
    async _renomearPlano() {
        if (!this._planoAtivo) return;
        const atual = this._planos.find(x => x.id === this._planoAtivo);
        const nome = (prompt('Novo nome:', atual?.nome || '') || '').trim(); if (!nome) return;
        const r = await api.post('/api/previsao-planos', { id: this._planoAtivo, nome, params: this._getParams(), edicoes: this._getEdicoes() }).catch(() => null);
        if (!r?.ok) { mostrarToast(r?.erro || 'Erro ao renomear.', 'erro'); return; }
        await this._carregarPlanos();
    },
    async _excluirPlano() {
        if (!this._planoAtivo) return;
        const atual = this._planos.find(x => x.id === this._planoAtivo);
        if (!confirm(`Excluir o plano "${atual?.nome || ''}"? (a base e os outros planos não são afetados)`)) return;
        await api.delete('/api/previsao-planos/' + this._planoAtivo).catch(() => null);
        this._planoAtivo = null; this._congeladoSnap = null; this._setEdicoes({}); this._dirty = false; this._draftSave();
        await this._carregarPlanos();
        this.calcular();
        mostrarToast('Plano excluído.', 'ok');
    },
    async _congelarPlano() {
        if (!this._planoAtivo) { mostrarToast('Salve o plano antes de congelar.', 'aviso'); return; }
        const atual = this._planos.find(x => x.id === this._planoAtivo);
        const congelar = !(atual && atual.congelado);
        const snapshot = congelar ? this._snapshotAtual() : {};
        const r = await api.post('/api/previsao-planos', { id: this._planoAtivo, nome: atual?.nome, params: this._getParams(), edicoes: this._getEdicoes(), congelado: congelar, snapshot }).catch(() => null);
        if (!r?.ok) { mostrarToast(r?.erro || 'Erro ao congelar.', 'erro'); return; }
        this._congeladoSnap = congelar ? snapshot : null;
        await this._carregarPlanos();
        this.calcular();
        mostrarToast(congelar ? 'Plano CONGELADO — números fixos como foto do mês.' : 'Plano descongelado (voltou a vivo).', 'ok');
    },
    _snapshotAtual() { const s = {}; (this._forecast || []).forEach(f => { s[`${f.mes}_${String(f.codigo).toUpperCase()}`] = f.qty; }); return s; },
    _adicionarSku() {
        if (this._bloqueadoCongelado()) return;
        if (!vendas.rawData.length) { alert('Importe dados de Vendas primeiro.'); return; }
        const codigo = (prompt('Código do SKU a adicionar à previsão:') || '').trim(); if (!codigo) return;
        const cu = codigo.toUpperCase();
        if (this._forecast.some(f => String(f.codigo).toUpperCase() === cu && !this._excl.has(cu))) { mostrarToast('Esse SKU já está na previsão.', 'aviso'); return; }
        const v = vendas.rawData.find(r => String(r.codigo || '').trim().toUpperCase() === cu);
        const descricao = (prompt('Descrição:', v ? String(v.descricao || '').trim() : '') || '').trim();
        const segmento  = (prompt('Segmento:', v ? String(v.segmento || '').trim() : '') || '').trim();
        this._excl.delete(cu);   // caso estivesse excluído, reativa
        if (!this._adicionados.some(a => String(a.codigo).toUpperCase() === cu)) this._adicionados.push({ codigo: cu, descricao, segmento });
        this._marcarDirty();
        this.calcular();
        mostrarToast(`SKU ${cu} adicionado — ajuste as quantidades por mês na tabela.`, 'ok');
    },

    _getNextMonths(n) {
        const now = new Date();
        return Array.from({ length: n }, (_, i) => {
            const d    = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
            const abbr = this._ABBR[d.getMonth()];
            const mes  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            return { mes, abbr, label: `${abbr.charAt(0).toUpperCase()+abbr.slice(1)}/${String(d.getFullYear()).slice(2)}` };
        });
    },

    _calcSeasonality() {
        const byAbbr = {}, cntAbbr = {};
        vendas.monthCols.forEach(col => {
            const tot = vendas.rawData.reduce((s,r) => s+(r[col.key]||0), 0);
            byAbbr[col.abbr]  = (byAbbr[col.abbr]  || 0) + tot;
            cntAbbr[col.abbr] = (cntAbbr[col.abbr] || 0) + 1;
        });
        const norm = {};
        Object.keys(byAbbr).forEach(a => norm[a] = byAbbr[a] / (cntAbbr[a]||1));
        const vals = Object.values(norm);
        const mean = vals.reduce((s,v)=>s+v,0) / (vals.length||1);
        const sIdx = {};
        Object.keys(norm).forEach(a => sIdx[a] = mean > 0 ? norm[a]/mean : 1);
        return sIdx;
    },

    // OLS linear regression — returns { slope, intercept, r2 }
    _regressaoLinear(xs, ys) {
        const n = xs.length;
        if (n < 2) return { slope: 0, intercept: ys[0]||0, r2: 0 };
        const sx  = xs.reduce((s,x)=>s+x, 0);
        const sy  = ys.reduce((s,y)=>s+y, 0);
        const sxy = xs.reduce((s,x,i)=>s+x*ys[i], 0);
        const sxx = xs.reduce((s,x)=>s+x*x, 0);
        const den = n*sxx - sx*sx;
        if (Math.abs(den) < 1e-10) return { slope:0, intercept: sy/n, r2: 0 };
        const slope = (n*sxy - sx*sy) / den;
        const intercept = (sy - slope*sx) / n;
        const yMean = sy / n;
        const ssTot = ys.reduce((s,y)=>s+(y-yMean)**2, 0);
        const ssRes = ys.reduce((s,y,i)=>s+(y-(intercept+slope*xs[i]))**2, 0);
        return { slope, intercept, r2: ssTot > 0 ? Math.max(0, 1 - ssRes/ssTot) : 0 };
    },

    // Holt's double exponential on deseasonalized series → forecasts + IC 80%
    _holtForecast(series, sIdxArr, futureIdxArr, alpha=0.3, beta=0.08) {
        if (series.length < 3) return null;
        const deSeas = series.map((y,i) => (sIdxArr[i]||1) > 0 ? y / (sIdxArr[i]||1) : y);
        let L = deSeas[0];
        let B = (deSeas[deSeas.length-1] - deSeas[0]) / Math.max(1, deSeas.length-1);
        const fitted = [];
        for (let t = 0; t < deSeas.length; t++) {
            const pL = L, pB = B;
            L = alpha * deSeas[t] + (1-alpha) * (pL + pB);
            B = beta  * (L - pL)  + (1-beta)  * pB;
            fitted.push((pL + pB) * (sIdxArr[t]||1));
        }
        const rmse = Math.sqrt(series.reduce((s,y,i)=>{const e=y-fitted[i];return s+e*e;},0) / series.length);
        return {
            forecasts: futureIdxArr.map((sF,h) => {
                const base = Math.max(0, (L + (h+1)*B) * (sF||1));
                const ci   = 1.28 * rmse * Math.sqrt(h+1);
                return { qty: Math.round(base), ciLow: Math.max(0, Math.round(base-ci)), ciHigh: Math.round(base+ci) };
            }),
            rmse,
        };
    },

    calcular() {
        if (!vendas.rawData.length) { alert('Importe dados de Vendas primeiro.'); return; }
        const horizonte = parseInt(document.getElementById('prev-horizonte')?.value) || 3;
        const baseMeses = parseInt(document.getElementById('prev-base-meses')?.value) || 12;
        const metodo    = document.getElementById('prev-metodo')?.value || 'media';
        const sIdx      = this._calcSeasonality();
        this._seasonality = sIdx;
        const nextMonths  = this._getNextMonths(horizonte);
        this._nextMonths  = nextMonths;
        const recentCols  = vendas.monthCols.slice(-baseMeses);
        const forecast    = [];

        // Pedidos de cliente como piso mínimo do próximo mês
        const usarCliente = document.getElementById('prev-usar-cliente')?.checked;
        const clienteMap  = {};
        if (usarCliente && cliente.rawData.length && cliente._colCodigo && cliente._colQtd) {
            cliente.rawData.forEach(r => {
                const cod = String(r.dados?.[cliente._colCodigo] || '').trim().toUpperCase();
                const qty = parseFloat(String(r.dados?.[cliente._colQtd] || '0').replace(',','.')) || 0;
                if (cod && qty > 0) clienteMap[cod] = (clienteMap[cod]||0) + qty;
            });
        }

        vendas.rawData.forEach(r => {
            const cod = String(r.codigo||'').trim().toUpperCase();
            if (!cod) return;
            const total = recentCols.reduce((s,c) => s+(r[c.key]||0), 0);
            if (!total) return;
            const baseMedia = total / (recentCols.length||1);

            const last3 = recentCols.slice(-3).reduce((s,c)=>s+(r[c.key]||0),0) / 3;
            const prev3 = recentCols.length>=6 ? recentCols.slice(-6,-3).reduce((s,c)=>s+(r[c.key]||0),0)/3 : last3;
            const trend = prev3 > 0 ? (last3 - prev3) / prev3 : 0;
            const trendSeta = trend > 0.05 ? '↑' : trend < -0.05 ? '↓' : '→';

            let rawQtys, ciLows, ciHighs, r2Val = null;

            if (metodo === 'hw') {
                const series       = recentCols.map(c => r[c.key]||0);
                const sIdxArr      = recentCols.map(c => sIdx[c.abbr]||1);
                const futureIdxArr = nextMonths.map(m => sIdx[m.abbr]||1);
                const hw = this._holtForecast(series, sIdxArr, futureIdxArr);
                if (hw) {
                    rawQtys = hw.forecasts.map(f => f.qty);
                    ciLows  = hw.forecasts.map(f => f.ciLow);
                    ciHighs = hw.forecasts.map(f => f.ciHigh);
                } else {
                    rawQtys = nextMonths.map(({abbr}) => Math.round(baseMedia*(sIdx[abbr]||1)));
                    ciLows  = ciHighs = rawQtys;
                }
            } else if (metodo === 'regressao') {
                const xs  = recentCols.map((_,i) => i);
                const ys  = recentCols.map(c => { const si=sIdx[c.abbr]||1; return si>0?(r[c.key]||0)/si:(r[c.key]||0); });
                const reg = this._regressaoLinear(xs, ys);
                r2Val  = reg.r2;
                const n = recentCols.length;
                rawQtys = nextMonths.map(({abbr},h) => Math.max(0, Math.round((reg.intercept + reg.slope*(n+h)) * (sIdx[abbr]||1))));
                ciLows  = ciHighs = rawQtys;
            } else {
                // Média móvel + sazonalidade + tendência progressiva
                rawQtys = nextMonths.map(({abbr},idx) => Math.round(baseMedia * (sIdx[abbr]||1) * Math.max(0.1, 1 + trend*(idx+1)*0.5)));
                ciLows  = ciHighs = rawQtys;
            }

            // Piso de cliente: aplica apenas ao próximo mês (índice 0)
            const clienteQty = clienteMap[cod] || 0;
            if (usarCliente && clienteQty > 0 && rawQtys[0] < clienteQty) {
                rawQtys = [...rawQtys]; rawQtys[0] = clienteQty;
                if (ciLows  && ciLows[0]  < clienteQty) { ciLows  = [...ciLows];  ciLows[0]  = clienteQty; }
                if (ciHighs && ciHighs[0] < clienteQty) { ciHighs = [...ciHighs]; ciHighs[0] = clienteQty; }
            }

            nextMonths.forEach(({mes, abbr, label}, idx) => {
                const chave  = `${mes}_${cod}`;
                const rawQty = rawQtys[idx];
                const qty    = this._overrides[chave] !== undefined ? this._overrides[chave] : rawQty;
                forecast.push({ mes, abbr, label, chave, codigo: cod,
                    descricao: String(r.descricao||'').trim(), segmento: String(r.segmento||'').trim(),
                    modelo: String(r.modelo||'').trim(), baseMedia, rawQty, qty, trend, trendSeta,
                    isOverride: this._overrides[chave] !== undefined,
                    ciLow:  ciLows?.[idx]  ?? rawQty,
                    ciHigh: ciHighs?.[idx] ?? rawQty,
                    r2: r2Val,
                    metodo,
                });
            });
        });

        this._forecast = forecast;
        // Plano congelado = FOTO: nada entra além do que foi congelado (nem mês novo, nem SKU novo)
        this._congelado = !!(this._congeladoSnap && Object.keys(this._congeladoSnap).length);
        // SKUs adicionados à mão (parte do plano): entram na tabela mesmo sem histórico de vendas
        (this._adicionados || []).forEach(a => {
            const cod = String(a.codigo || '').trim().toUpperCase(); if (!cod) return;
            nextMonths.forEach(({ mes, abbr, label }) => {
                if (this._forecast.some(f => String(f.codigo).toUpperCase() === cod && f.mes === mes)) return; // já veio das vendas
                const chave = `${mes}_${cod}`;
                const qty   = this._overrides[chave] !== undefined ? this._overrides[chave] : 0;
                this._forecast.push({ mes, abbr, label, chave, codigo: cod,
                    descricao: String(a.descricao || '').trim() || cod, segmento: String(a.segmento || '').trim(),
                    modelo: '', baseMedia: 0, rawQty: 0, qty, trend: 0, trendSeta: '→',
                    isOverride: this._overrides[chave] !== undefined,
                    ciLow: qty, ciHigh: qty, r2: null, metodo, _manual: true });
            });
        });
        // Plano congelado: fixa os números na foto salva e DESCARTA o que não estava nela
        // (mês/SKU novo mostraria número vivo sob o selo 🔒 — review). Snapshot vazio ≠ congelado.
        if (this._congelado) {
            this._forecast = this._forecast.filter(f => this._congeladoSnap[`${f.mes}_${String(f.codigo).toUpperCase()}`] != null);
            this._forecast.forEach(f => { f.qty = this._congeladoSnap[`${f.mes}_${String(f.codigo).toUpperCase()}`]; f.isOverride = true; });
            if (!this._forecast.length) mostrarToast('A foto congelada não cobre o horizonte atual — descongele (🔓) para recalcular.', 'aviso');
        }
        this._renderSazonalidade(sIdx, nextMonths);
        this._populaSegFiltro();
        this.render();
        // Mostra painel de acurácia se já houver snapshots carregados
        const acWrap = document.getElementById('prev-acuracia-wrap');
        if (acWrap) acWrap.style.display = soepDash._snapshots.length ? '' : 'none';
    },

    getQty(codigo, mes) {
        const cod = String(codigo||'').trim().toUpperCase();
        const chave = `${mes}_${cod}`;
        if (this._overrides[chave] !== undefined) return this._overrides[chave];
        return this._forecast.find(r => r.codigo===cod && r.mes===mes)?.qty || 0;
    },

    getTotalMes(mes, segmento) {
        return this._forecast.filter(r => r.mes===mes && !this._excl.has(String(r.codigo)) && (!segmento || r.segmento===segmento)).reduce((s,r)=>s+r.qty,0);
    },

    getDemandaMapa(mes) {
        const mapa = {};
        this._forecast.filter(r => r.mes===mes && !this._excl.has(String(r.codigo))).forEach(r => { mapa[r.codigo]=(mapa[r.codigo]||0)+r.qty; });
        return mapa;
    },

    _setOverride(chave, cod, mes, val) {
        if (this._bloqueadoCongelado()) return;
        const qty = Math.max(0, parseInt(val)||0);
        this._overrides[chave] = qty;
        this._saveOverrides();
        const f = this._forecast.find(r => r.codigo===cod && r.mes===mes);
        if (f) { f.qty=qty; f.isOverride=true; }
    },

    // Exclusão de SKU da previsão (persistente) — o operador tira da lista quem não quer planejar
    _excluidosSet() { return this._excl; },
    _excluirSku(cod) {
        if (this._bloqueadoCongelado()) return;
        this._excl.add(String(cod));
        this._marcarDirty();
        mostrarToast(`${cod} excluído da previsão. Clique "restaurar" para desfazer.`, 'aviso');
        this.render();
    },
    _restaurarExcluidos() {
        if (this._bloqueadoCongelado()) return;
        this._excl = new Set();
        this._marcarDirty();
        mostrarToast('SKUs excluídos restaurados.', 'ok');
        this.render();
    },
    // Seleção em lote na tabela por SKU (checkbox por linha + "selecionar todos")
    _selAll(ch) { document.querySelectorAll('.prev-sel').forEach(c => c.checked = ch); this._updSelCount(); },
    _updSelCount() {
        const n = document.querySelectorAll('.prev-sel:checked').length;
        const bar = document.getElementById('prev-sel-bar');
        if (bar) bar.innerHTML = n ? `<button onclick="previsao._excluirSelecionados()" style="background:rgba(240,98,146,.12);border:1px solid #f06292;border-radius:6px;color:#f06292;cursor:pointer;font-size:.72rem;padding:3px 11px;font-weight:700;">🗑 Excluir selecionados (${n})</button>` : '';
    },
    _excluirSelecionados() {
        if (this._bloqueadoCongelado()) return;
        const cods = [...document.querySelectorAll('.prev-sel:checked')].map(c => c.dataset.cod).filter(Boolean);
        if (!cods.length) return;
        cods.forEach(c => this._excl.add(String(c)));
        this._marcarDirty();
        mostrarToast(`${cods.length} SKU(s) excluído(s) da previsão. Clique "restaurar" para desfazer.`, 'aviso');
        this.render();
    },

    _populaSegFiltro() {
        // Segmento e Modelo selecionáveis — de vendas (já disponível) ou do forecast calculado
        const fonte = this._forecast.length ? this._forecast : (vendas.rawData || []);
        const fill = (id, campo) => {
            const sel = document.getElementById(id); if (!sel) return;
            const cur  = sel.value;
            const vals = [...new Set(fonte.map(r => String(r[campo]||'').trim()).filter(Boolean))].sort();
            sel.innerHTML = '<option value="">Todos</option>' + vals.map(v => `<option value="${escHTML(v)}"${v===cur?' selected':''}>${escHTML(v)}</option>`).join('');
        };
        fill('prev-seg-sel', 'segmento');
        fill('prev-modelo-sel', 'modelo');
    },

    _renderSazonalidade(sIdx, nextMonths) {
        const wrap = document.getElementById('prev-sazon-wrap');
        const bars = document.getElementById('prev-sazon-bars');
        if (!wrap||!bars) return;
        const entries = Object.entries(sIdx).sort((a,b)=>this._ABBR.indexOf(a[0])-this._ABBR.indexOf(b[0]));
        const max  = Math.max(...entries.map(e=>e[1]));
        const next = new Set(nextMonths.map(m=>m.abbr));
        bars.innerHTML = entries.map(([abbr, idx]) => {
            const h    = Math.round((idx/max)*60);
            const isN  = next.has(abbr);
            const cor  = idx>=1.15?'#f06292':idx>=0.9?'#26a69a':'#ffca28';
            return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;">
                <div style="font-size:.68rem;color:${cor};font-weight:700;">${idx.toFixed(2)}×</div>
                <div style="width:100%;height:${h}px;background:${cor};border-radius:3px 3px 0 0;opacity:${isN?'1':'.35'};"></div>
                <div style="font-size:.68rem;color:${isN?'var(--text-primary)':'var(--text-dim)'};">${abbr}</div>
            </div>`;
        }).join('');
        wrap.style.display='';
    },

    render() {
        const grupo  = document.getElementById('prev-grupo')?.value   || 'familia';
        const segSel = document.getElementById('prev-seg-sel')?.value  || '';
        const modSel = document.getElementById('prev-modelo-sel')?.value || '';
        const metodo = document.getElementById('prev-metodo')?.value   || 'media';
        const res    = document.getElementById('prev-resultado');
        const thead  = document.getElementById('prev-thead');
        const tbody  = document.getElementById('prev-tbody');
        const label  = document.getElementById('prev-table-label');
        const count  = document.getElementById('prev-count');
        if (!res||!this._forecast.length) return;
        res.style.display='';

        const excl = this._excluidosSet();
        const filtered = this._forecast.filter(r => (!segSel || r.segmento===segSel) && (!modSel || r.modelo===modSel) && !excl.has(String(r.codigo)));

        if (grupo==='familia') {
            label.textContent = 'PREVISÃO POR FAMÍLIA (SEGMENTO)';
            const segMap = {};
            filtered.forEach(r => { const s=r.segmento||'—'; if(!segMap[s]) segMap[s]={}; segMap[s][r.mes]=(segMap[s][r.mes]||0)+r.qty; });
            thead.innerHTML = `<th style="padding:8px 12px;text-align:left;color:var(--text-dim);font-size:.7rem;">SEGMENTO</th>`+
                this._nextMonths.map(m=>`<th style="padding:8px 12px;text-align:right;color:var(--text-dim);font-size:.7rem;">${m.label.toUpperCase()}</th>`).join('')+
                `<th style="padding:8px 12px;text-align:right;color:var(--text-dim);font-size:.7rem;">TOTAL</th>`;
            const segs = Object.keys(segMap).sort();
            tbody.innerHTML = segs.map((seg,i)=>{
                const qtds  = this._nextMonths.map(m=>segMap[seg][m.mes]||0);
                const total = qtds.reduce((s,v)=>s+v,0);
                return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};">
                    <td style="padding:8px 12px;font-weight:600;color:var(--indigo-primary);">${escHTML(seg)}</td>
                    ${qtds.map(q=>`<td style="padding:8px 12px;text-align:right;">${q.toLocaleString('pt-BR')}</td>`).join('')}
                    <td style="padding:8px 12px;text-align:right;font-weight:700;">${total.toLocaleString('pt-BR')}</td>
                </tr>`;
            }).join('');
            count.textContent = `${segs.length} segmentos`;
        } else if (grupo==='modelo') {
            label.textContent = 'PREVISÃO POR MODELO';
            const modMap = {};
            filtered.forEach(r => { const mm=r.modelo||'—'; if(!modMap[mm]) modMap[mm]={}; modMap[mm][r.mes]=(modMap[mm][r.mes]||0)+r.qty; });
            thead.innerHTML = `<th style="padding:8px 12px;text-align:left;color:var(--text-dim);font-size:.7rem;">MODELO</th>`+
                this._nextMonths.map(m=>`<th style="padding:8px 12px;text-align:right;color:var(--text-dim);font-size:.7rem;">${m.label.toUpperCase()}</th>`).join('')+
                `<th style="padding:8px 12px;text-align:right;color:var(--text-dim);font-size:.7rem;">TOTAL</th>`;
            const mods = Object.keys(modMap).sort();
            tbody.innerHTML = mods.map((mm,i)=>{
                const qtds  = this._nextMonths.map(m=>modMap[mm][m.mes]||0);
                const total = qtds.reduce((s,v)=>s+v,0);
                return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};">
                    <td style="padding:8px 12px;font-weight:600;color:var(--indigo-primary);">${escHTML(mm)}</td>
                    ${qtds.map(q=>`<td style="padding:8px 12px;text-align:right;">${q.toLocaleString('pt-BR')}</td>`).join('')}
                    <td style="padding:8px 12px;text-align:right;font-weight:700;">${total.toLocaleString('pt-BR')}</td>
                </tr>`;
            }).join('');
            count.textContent = `${mods.length} modelos`;
        } else {
            const hasHW  = metodo === 'hw';
            const hasReg = metodo === 'regressao';
            label.textContent = 'PREVISÃO POR SKU' +
                (hasHW  ? ' — Holt-Winters (IC 80%)' : hasReg ? ' — Regressão Linear (R²)' : '');
            const skuMap = {};
            filtered.forEach(r => { if(!skuMap[r.codigo]) skuMap[r.codigo]={...r,meses:{}}; skuMap[r.codigo].meses[r.mes]=r; });
            thead.innerHTML = `<th style="padding:8px 10px;text-align:center;color:var(--text-dim);font-size:.7rem;position:sticky;left:0;background:var(--bg-obsidian);white-space:nowrap;"><label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;"><input type="checkbox" id="prev-selall" onchange="previsao._selAll(this.checked)" title="Selecionar todos os visíveis" style="cursor:pointer;">AÇÕES</label></th>
                <th style="padding:8px 10px;text-align:left;color:var(--text-dim);font-size:.7rem;">CÓDIGO</th>
                <th style="padding:8px 10px;text-align:left;color:var(--text-dim);font-size:.7rem;">DESCRIÇÃO</th>
                <th style="padding:8px 10px;text-align:left;color:var(--text-dim);font-size:.7rem;">SEGMENTO</th>`+
                this._nextMonths.map(m=>`<th style="padding:8px 10px;text-align:right;color:var(--text-dim);font-size:.7rem;">${m.label.toUpperCase()}</th>`).join('')+
                (hasHW  ? `<th style="padding:8px 10px;text-align:center;color:var(--text-dim);font-size:.7rem;">IC 80% (${this._nextMonths[0]?.label||'M1'})</th>` : '') +
                (hasReg ? `<th style="padding:8px 10px;text-align:center;color:var(--text-dim);font-size:.7rem;">R²</th><th style="padding:8px 10px;text-align:center;color:var(--text-dim);font-size:.7rem;">TEND.</th>` : '') +
                `<th style="padding:8px 10px;text-align:right;color:var(--text-dim);font-size:.7rem;">TOTAL</th>`;
            const skus = Object.values(skuMap).slice(0, 400);
            tbody.innerHTML = skus.map((sku,i)=>{
                const cells = this._nextMonths.map(m=>{
                    const f=sku.meses[m.mes]; const qty=f?f.qty:0;
                    return `<td style="padding:5px 10px;text-align:right;">
                        <input type="number" value="${qty}" min="0" style="width:72px;padding:3px 6px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:4px;color:${f?.isOverride?'var(--indigo-primary)':'var(--text-primary)'};font-size:.78rem;text-align:right;"
                            onchange="previsao._setOverride('${m.mes}_${escJS(sku.codigo)}','${escJS(sku.codigo)}','${m.mes}',this.value)">
                    </td>`;
                }).join('');
                const total  = this._nextMonths.reduce((s,m)=>s+(sku.meses[m.mes]?.qty||0),0);
                const firstF = sku.meses[this._nextMonths[0]?.mes];
                const ciCell = hasHW && firstF
                    ? `<td style="padding:5px 10px;text-align:center;font-size:.72rem;color:#ffca28;white-space:nowrap;">${firstF.ciLow.toLocaleString('pt-BR')} – ${firstF.ciHigh.toLocaleString('pt-BR')}</td>`
                    : '';
                const r2Val  = Object.values(sku.meses)[0]?.r2 ?? null;
                const r2Cor  = r2Val===null?'var(--text-dim)':r2Val>=0.7?'#26a69a':r2Val>=0.4?'#ffca28':'#f06292';
                const tSeta  = Object.values(sku.meses)[0]?.trendSeta || '→';
                const regCell = hasReg
                    ? `<td style="padding:5px 10px;text-align:center;font-weight:700;font-size:.78rem;color:${r2Cor};">${r2Val!==null?r2Val.toFixed(2):'—'}</td>
                       <td style="padding:5px 10px;text-align:center;font-size:.85rem;">${escHTML(tSeta)}</td>`
                    : '';
                const bgRow = i%2 ? 'var(--bg-input)' : 'var(--bg-obsidian)';
                return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};">
                    <td style="padding:5px 10px;text-align:center;white-space:nowrap;position:sticky;left:0;background:${bgRow};">
                        <input type="checkbox" class="prev-sel" data-cod="${escHTML(sku.codigo)}" onchange="previsao._updSelCount()" title="Selecionar para excluir em lote" style="cursor:pointer;vertical-align:middle;margin-right:7px;">
                        <button onclick="previsao._excluirSku('${escJS(sku.codigo)}')" title="Excluir este SKU da previsão" style="background:transparent;border:1px solid rgba(240,98,146,.4);border-radius:5px;color:#f06292;cursor:pointer;font-size:.82rem;padding:2px 7px;vertical-align:middle;">🗑</button>
                    </td>
                    <td style="padding:5px 10px;font-weight:600;font-size:.78rem;">${escHTML(sku.codigo)}</td>
                    <td style="padding:5px 10px;font-size:.78rem;">${escHTML((sku.descricao||'').slice(0,28))}</td>
                    <td style="padding:5px 10px;font-size:.78rem;color:var(--text-dim);">${escHTML(sku.segmento||'')}</td>
                    ${cells}${ciCell}${regCell}
                    <td style="padding:5px 10px;text-align:right;font-weight:700;">${total.toLocaleString('pt-BR')}</td>
                </tr>`;
            }).join('');
            const totalSku = Object.keys(skuMap).length;
            count.innerHTML = `<span id="prev-sel-bar" style="margin-right:10px;"></span>`
                + (skus.length < totalSku ? `${skus.length} / ${totalSku} SKUs (use filtro)` : `${skus.length} SKUs`)
                + (excl.size ? ` · <span style="color:#f06292;">${excl.size} excluído${excl.size > 1 ? 's' : ''}</span> <button onclick="previsao._restaurarExcluidos()" style="background:transparent;border:1px solid var(--border-color);border-radius:5px;color:var(--indigo-primary);cursor:pointer;font-size:.7rem;padding:2px 8px;margin-left:4px;">restaurar</button>` : '');
        }
    },

    _toggleAcuracia() {
        const content  = document.getElementById('prev-acuracia-content');
        const chevron  = document.getElementById('prev-acuracia-chevron');
        if (!content) return;
        const aberto = content.style.display !== 'none';
        content.style.display = aberto ? 'none' : '';
        if (chevron) chevron.textContent = aberto ? '▼ expandir' : '▲ fechar';
        if (!aberto) this.renderAcuraciaSkus();
    },

    renderAcuraciaSkus() {
        const el = document.getElementById('prev-acuracia-content');
        if (!el) return;
        const snaps = soepDash._snapshots;
        if (!snaps.length) {
            el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:.82rem;">
                Nenhum snapshot disponível. Acesse <strong>Dashboard S&OP → Salvar Snapshot</strong> para começar a rastrear.</div>`;
            return;
        }
        // Mapa de vendas reais: { 'YYYY-MM' → { CODIGO → qty } }
        const realMap = {};
        vendas.rawData.forEach(r => {
            const cod = String(r.codigo||'').trim().toUpperCase();
            vendas.monthCols.forEach(mc => {
                const num = this._ABBR.indexOf(mc.abbr) + 1;
                if (!mc.year || !num) return;
                const mk = `${mc.year}-${String(num).padStart(2,'0')}`;
                if (!realMap[mk]) realMap[mk] = {};
                realMap[mk][cod] = (realMap[mk][cod]||0) + (r[mc.key]||0);
            });
        });
        // MAPE + viés por SKU
        const skuStats = {};
        snaps.forEach(s => {
            const real = realMap[s.mes]?.[s.codigo] ?? null;
            if (real === null || s.qty_prevista <= 0) return;
            if (!skuStats[s.codigo]) skuStats[s.codigo] = { erros:[], vieses:[], segmento:'' };
            skuStats[s.codigo].erros.push(Math.abs(real - s.qty_prevista) / s.qty_prevista * 100);
            skuStats[s.codigo].vieses.push((s.qty_prevista - real) / s.qty_prevista * 100);
        });
        vendas.rawData.forEach(r => {
            const cod = String(r.codigo||'').trim().toUpperCase();
            if (skuStats[cod]) skuStats[cod].segmento = String(r.segmento||'').trim();
        });
        const rows = Object.entries(skuStats).map(([cod, s]) => ({
            cod, segmento: s.segmento,
            mape: s.erros.reduce((t,e)=>t+e,0) / s.erros.length,
            vies: s.vieses.reduce((t,v)=>t+v,0) / s.vieses.length,
            meses: s.erros.length,
        })).filter(r=>r.meses>0).sort((a,b)=>b.mape-a.mape);

        if (!rows.length) {
            el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:.82rem;">
                Sem meses com dados reais disponíveis para comparar ainda.</div>`;
            return;
        }
        const mediaGeral = rows.reduce((s,r)=>s+r.mape,0) / rows.length;
        const bons  = rows.filter(r=>r.mape<=15).length;
        const ruins = rows.filter(r=>r.mape>30).length;
        el.innerHTML = `
            <div style="display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap;">
                <div style="background:var(--bg-input);border-radius:8px;padding:12px 20px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:800;color:${mediaGeral<=15?'#26a69a':mediaGeral<=25?'#ffca28':'#f06292'};">${mediaGeral.toFixed(1)}%</div>
                    <div style="font-size:.68rem;color:var(--text-dim);margin-top:3px;letter-spacing:.06em;">MAPE MÉDIO</div>
                </div>
                <div style="background:var(--bg-input);border-radius:8px;padding:12px 20px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:800;color:#26a69a;">${bons}</div>
                    <div style="font-size:.68rem;color:var(--text-dim);margin-top:3px;letter-spacing:.06em;">SKUs ≤ 15%</div>
                </div>
                <div style="background:var(--bg-input);border-radius:8px;padding:12px 20px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:800;color:#f06292;">${ruins}</div>
                    <div style="font-size:.68rem;color:var(--text-dim);margin-top:3px;letter-spacing:.06em;">SKUs > 30%</div>
                </div>
                <div style="background:var(--bg-input);border-radius:8px;padding:12px 20px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:800;">${rows.length}</div>
                    <div style="font-size:.68rem;color:var(--text-dim);margin-top:3px;letter-spacing:.06em;">SKUs AVALIADOS</div>
                </div>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:.78rem;">
                <thead><tr style="color:var(--text-dim);font-size:.68rem;letter-spacing:.06em;border-bottom:1px solid var(--border-color);">
                    <th style="padding:8px 10px;text-align:left;">CÓDIGO</th>
                    <th style="padding:8px 10px;text-align:left;">SEGMENTO</th>
                    <th style="padding:8px 10px;text-align:right;">MAPE %</th>
                    <th style="padding:8px 10px;text-align:right;">VIÉS</th>
                    <th style="padding:8px 10px;text-align:center;">MESES</th>
                    <th style="padding:8px 10px;text-align:center;">QUALIDADE</th>
                </tr></thead><tbody>
                ${rows.map((r,i)=>{
                    const cor  = r.mape<=15?'#26a69a':r.mape<=30?'#ffca28':'#f06292';
                    const qual = r.mape<=15?'Boa':r.mape<=30?'Regular':'Alta variação';
                    const viesAbs = Math.abs(r.vies);
                    const viesTxt = viesAbs<=5?'neutro':r.vies>0?`+${r.vies.toFixed(1)}% super`:`${r.vies.toFixed(1)}% sub`;
                    const viesCor = viesAbs<=5?'var(--text-dim)':'#ffca28';
                    return `<tr style="background:${i%2?'var(--bg-input)':'transparent'};">
                        <td style="padding:6px 10px;font-weight:600;color:var(--indigo-primary);">${escHTML(r.cod)}</td>
                        <td style="padding:6px 10px;color:var(--text-dim);">${escHTML(r.segmento)}</td>
                        <td style="padding:6px 10px;text-align:right;font-weight:700;color:${cor};">${r.mape.toFixed(1)}%</td>
                        <td style="padding:6px 10px;text-align:right;font-size:.73rem;color:${viesCor};">${viesTxt}</td>
                        <td style="padding:6px 10px;text-align:center;color:var(--text-dim);">${r.meses}</td>
                        <td style="padding:6px 10px;text-align:center;font-size:.73rem;color:${cor};">${qual}</td>
                    </tr>`;
                }).join('')}
                </tbody></table>
            </div>`;
    },
};

// ====== S&OP — PLANO DE PRODUÇÃO ======
const planoProducao = {
    _mesSel:   '',
    _plano:    {},  // `${mes}_${cod}` → qty — salvo no banco
    _estMin:   {},  // `${cod}` → qty mínima — salvo no banco
    _dirty:    new Set(),
    _dirtyMin: new Set(),
    _versoes:  [],
    _versaoSel: '',
    _versaoPlano: {},  // `${mes}_${cod}` → qty da versão congelada selecionada

    async init() {
        document.getElementById('plano-search')?.addEventListener('input', () => this._renderTabela());
        await Promise.all([this._loadPlanoFromDB(), this._loadEstMinFromDB(), this._loadRealizado()]);
        this._loadVersoes().catch(() => {});
    },

    // ── Versões congeladas (comparação) ──────────────────────
    async congelar() {
        await this.salvar(); // congela o que está salvo — garante consistência
        if (!Object.values(this._plano).some(q => q > 0)) { mostrarToast('Plano vazio — preencha e salve antes de congelar.', 'erro'); return; }
        const label = prompt('Nome da versão (ex: "Plano Junho aprovado"):', `Plano ${new Date().toLocaleDateString('pt-BR')}`);
        if (label === null) return;
        const resp = await api.post('/api/plano-versao/congelar', { label: label.trim() });
        if (!resp?.ok) {
            const erro = resp?.erro || 'falha de rede';
            mostrarToast(/plano_versao|PGRST|schema/i.test(erro)
                ? 'Tabela de versões não existe ainda — abra localhost:3000/setup, copie o SQL e rode no Supabase.'
                : 'Erro ao congelar: ' + erro, 'erro');
            return;
        }
        mostrarToast(`❄ Versão congelada: ${resp.total} itens.`, 'ok');
        await this._loadVersoes();
    },

    async _loadVersoes() {
        const lista = await api.get('/api/plano-versao/lista');
        this._versoes = lista || [];
        const sel = document.getElementById('plano-versao-sel');
        if (!sel) return;
        sel.innerHTML = '<option value="">Comparar com versão...</option>' +
            this._versoes.map(v => {
                const d = new Date(v.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
                return `<option value="${v.versao}"${v.versao === this._versaoSel ? ' selected' : ''}>${escHTML(v.label || 'Versão')} — ${d}</option>`;
            }).join('');
    },

    async carregarVersao(versao) {
        this._versaoSel = versao || '';
        this._versaoPlano = {};
        if (versao) {
            const rows = await api.get(`/api/plano-versao?versao=${encodeURIComponent(versao)}`);
            (rows || []).forEach(r => { this._versaoPlano[`${r.mes}_${r.codigo}`] = r.quantidade; });
        }
        const th = document.getElementById('plano-th-congelado');
        if (th) th.style.display = versao ? '' : 'none';
        this._renderTabela();
    },

    async _loadPlanoFromDB() {
        const data = await api.get('/api/soep-plano');
        if (!data) return;
        this._plano = {};
        data.forEach(r => { this._plano[`${r.mes}_${r.codigo}`] = r.quantidade; });
    },

    async _loadEstMinFromDB() {
        const data = await api.get('/api/estoque-minimo');
        if (!data) return;
        this._estMin = {};
        data.forEach(r => { this._estMin[r.codigo] = r.quantidade; });
    },

    // Fase 4 (Chão→Plano): produção REAL apontada no MES, por produto
    async _loadRealizado() {
        // B4: realizado escopado por mês (via ultima_producao 'YYYY-MM'), com total acumulado à parte
        this._realizado = {};
        const d = await api.get('/api/mf/erp/confirmacoes').catch(() => null);
        (d?.confirmacoes || []).forEach(c => {
            const cod = String(c.produto || '').trim().toUpperCase();
            if (!cod) return;
            const qtd = Number(c.qtd_produzida) || 0;
            if (!qtd) return;
            const rec = (this._realizado[cod] = this._realizado[cod] || { total: 0, porMes: {} });
            rec.total += qtd;
            const mes = String(c.ultima_producao || '').slice(0, 7);  // 'YYYY-MM'
            if (/^\d{4}-\d{2}$/.test(mes)) rec.porMes[mes] = (rec.porMes[mes] || 0) + qtd;
        });
    },

    setQty(cod, mes, qty) {
        const k = `${mes}_${String(cod).toUpperCase()}`;
        this._plano[k] = Math.max(0, qty);
        this._dirty.add(k);
    },

    getQty(cod, mes) { return this._plano[`${mes}_${String(cod).toUpperCase()}`] ?? null; },

    setEstMin(cod, qty) {
        const c = String(cod).toUpperCase();
        this._estMin[c] = Math.max(0, qty);
        this._dirtyMin.add(c);
    },

    async salvar() {
        // Alerta de capacidade antes de salvar
        if (this._mesSel && banco.rawData.length) {
            const demMapa = {};
            previsao._forecast.filter(r=>r.mes===this._mesSel && !previsao._excluidosSet().has(String(r.codigo))).forEach(r=>{
                const qty = this._plano[`${this._mesSel}_${r.codigo}`] ?? r.qty;
                if (qty>0) demMapa[r.codigo]=(demMapa[r.codigo]||0)+qty;
            });
            const diasMes = await toc._calcDiasUteisDoMes(this._mesSel).catch(() => 22);   // mesma base do heatmap/capacidade
            const resultCap = toc.calcularComDemanda(demMapa, diasMes);
            const sobrecarga = resultCap.filter(p => p.cargaMin>0 && p.util>=1);
            if (sobrecarga.length) {
                const lista = sobrecarga.map(p=>`• ${p.nome}: ${(p.util*100).toFixed(0)}% utilização`).join('\n');
                const ok = confirm(`⚠️ Atenção — capacidade excedida em ${sobrecarga.length} processo(s):\n\n${lista}\n\nDeseja salvar mesmo assim?`);
                if (!ok) return;
            }
        }
        let salvou = false;
        if (this._dirty.size) {
            const items = [...this._dirty].map(k => {
                const [mes, ...rest] = k.split('_');
                return { mes, codigo: rest.join('_'), quantidade: this._plano[k]||0 };
            });
            const r = await api.post('/api/soep-plano/bulk', { items });
            if (r?.ok) { this._dirty.clear(); salvou = true; }
        }
        if (this._dirtyMin.size) {
            const items = [...this._dirtyMin].map(c => ({ codigo: c, quantidade: this._estMin[c]||0 }));
            const r = await api.post('/api/estoque-minimo/bulk', { items });
            if (r?.ok) { this._dirtyMin.clear(); salvou = true; }
        }
        mostrarToast(salvou ? '✓ Plano salvo' : '✓ Sem alterações pendentes');
    },

    render() {
        if (!previsao._nextMonths.length) {
            if (vendas.rawData.length) previsao.calcular();
            else { mostrarToast('Importe Vendas e calcule a Previsão primeiro.','erro'); return; }
        }
        if (!this._mesSel) this._mesSel = previsao._nextMonths[0]?.mes || '';
        this._renderMesTabs();
        this._renderTabela();
        this._renderCapacidade();
    },

    _renderMesTabs() {
        const el = document.getElementById('plano-mes-tabs');
        if (!el) return;
        el.innerHTML = previsao._nextMonths.map(m=>
            `<button onclick="planoProducao._selMes('${m.mes}')"
                style="padding:8px 20px;border-radius:8px;border:none;font-size:.82rem;font-weight:600;cursor:pointer;transition:all .15s;
                background:${m.mes===this._mesSel?'var(--indigo-btn)':'var(--bg-input)'};
                color:${m.mes===this._mesSel?'#fff':'var(--text-dim)'};">${m.label}</button>`
        ).join('');
    },

    _selMes(mes) { this._mesSel=mes; this._renderMesTabs(); this._renderTabela(); this._renderCapacidade(); },

    autoSugerir() {
        if (!previsao._forecast.length) { alert('Calcule a Previsão de Demanda primeiro.'); return; }
        if (!this._mesSel) return;
        const { estMap, opMap } = this._buildMaps();
        previsao._forecast.filter(r=>r.mes===this._mesSel && !previsao._excluidosSet().has(String(r.codigo))).forEach(r=>{
            const min      = this._estMin[r.codigo] || 0;
            // Fórmula: produzir = previsão + estoque_min - estoque_atual - op_aberta
            const sugerido = Math.max(0, r.qty + min - (estMap[r.codigo]||0) - (opMap[r.codigo]||0));
            if (sugerido>0) { this._plano[`${this._mesSel}_${r.codigo}`]=sugerido; this._dirty.add(`${this._mesSel}_${r.codigo}`); }
        });
        this._renderTabela(); this._renderCapacidade();
        mostrarToast('✓ Plano sugerido gerado');
    },

    _buildMaps() {
        const estMap={}, opMap={};
        estoque.rawData.forEach(r=>{ estMap[String(r.codigo||'').trim().toUpperCase()]=Number(r.quantidade)||0; });
        if (op.rawData.length && op._colRef && op._colQtd) {
            op.rawData.forEach(r=>{
                const cod=String(r.dados?.[op._colRef]||'').trim().toUpperCase();
                const qty=parseFloat(String(r.dados?.[op._colQtd]||'0').replace(/[^\d.,]/g,'').replace(',','.'))||0;
                if (cod) opMap[cod]=(opMap[cod]||0)+qty;
            });
        }
        return { estMap, opMap };
    },

    _renderTabela() {
        const tbody = document.getElementById('plano-tbody');
        const label = document.getElementById('plano-table-label');
        const count = document.getElementById('plano-count');
        if (!tbody||!this._mesSel) return;
        const mesInfo = previsao._nextMonths.find(m=>m.mes===this._mesSel);
        if (label) label.textContent = `PLANO — ${mesInfo?.label?.toUpperCase()||this._mesSel}`;
        const search = (document.getElementById('plano-search')?.value||'').toLowerCase().trim();
        const { estMap, opMap } = this._buildMaps();
        const rows = previsao._forecast
            .filter(r=>r.mes===this._mesSel && !previsao._excluidosSet().has(String(r.codigo)) && (!search || r.codigo.toLowerCase().includes(search)||r.descricao.toLowerCase().includes(search)))
            .map(r=>({
                ...r,
                estqtd:   estMap[r.codigo]||0,
                opQtd:    opMap[r.codigo]||0,
                // B4: realizado do mês quando há data de produção; senão degrada p/ o acumulado (rotulado), p/ o badge não sumir
                realizado:    this._realizado?.[r.codigo]?.porMes?.[this._mesSel] || 0,
                realizadoTot: this._realizado?.[r.codigo]?.total || 0,
                realizadoDatado: Object.keys(this._realizado?.[r.codigo]?.porMes || {}).length > 0,
                estMin:   this._estMin[r.codigo]||0,
                sugerido: Math.max(0, r.qty + (this._estMin[r.codigo]||0) - (estMap[r.codigo]||0) - (opMap[r.codigo]||0)),
                planejado: this._plano[`${this._mesSel}_${r.codigo}`]??''
            }))
            .sort((a,b)=>b.sugerido-a.sugerido).slice(0,500);
        tbody.innerHTML = rows.map((r,i)=>{
            const bg      = i%2?'var(--bg-input)':'transparent';
            const planCor = r.planejado>r.qty?'#f06292': r.planejado>0?'#26a69a':'var(--text-dim)';
            const minCor  = r.estMin>0?'var(--indigo-primary)':'var(--text-dim)';
            return `<tr style="background:${bg};">
                <td style="padding:6px 10px;font-weight:600;font-size:.78rem;color:var(--indigo-primary);">${escHTML(r.codigo)}</td>
                <td style="padding:6px 10px;font-size:.78rem;">${escHTML((r.descricao||'').slice(0,28))}</td>
                <td style="padding:6px 10px;font-size:.78rem;color:var(--text-dim);">${escHTML(r.segmento||'')}</td>
                <td style="padding:6px 10px;text-align:right;">${r.qty.toLocaleString('pt-BR')}</td>
                <td style="padding:6px 10px;text-align:right;color:${r.estqtd<r.qty*.5?'#f06292':'var(--text-primary)'};">${r.estqtd.toLocaleString('pt-BR')}</td>
                <td style="padding:6px 10px;text-align:right;">${r.opQtd.toLocaleString('pt-BR')}${
                    r.realizado
                        ? `<span style="color:#26a69a;font-size:.66rem;" title="produzido no MES neste mês (${mesInfo?.label||this._mesSel})${r.realizadoTot>r.realizado?` · acumulado total: ${r.realizadoTot.toLocaleString('pt-BR')}`:''}"> · ✓${r.realizado.toLocaleString('pt-BR')}</span>`
                        : (!r.realizadoDatado && r.realizadoTot
                            ? `<span style="color:#8b949e;font-size:.66rem;" title="acumulado no MES (apontamentos sem data de conclusão — não dá p/ atribuir ao mês)"> · ✓${r.realizadoTot.toLocaleString('pt-BR')} acum</span>`
                            : '')
                }</td>
                <td style="padding:6px 10px;text-align:right;">
                    <input type="number" min="0" value="${r.estMin||''}" placeholder="0"
                        style="width:68px;padding:3px 7px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:${minCor};font-size:.78rem;text-align:right;"
                        onchange="planoProducao.setEstMin('${escJS(r.codigo)}',parseInt(this.value)||0)">
                </td>
                <td style="padding:6px 10px;text-align:right;color:var(--indigo-primary);font-weight:600;">${r.sugerido.toLocaleString('pt-BR')}</td>
                ${this._versaoSel ? (() => {
                    const cong = this._versaoPlano[`${this._mesSel}_${r.codigo}`];
                    const atual = Number(r.planejado) || 0;
                    if (cong === undefined) return `<td style="padding:6px 10px;text-align:right;color:var(--text-dim);">—</td>`;
                    const diff = atual - cong;
                    const dTxt = diff === 0 ? '' : ` <span style="font-size:.68rem;color:${diff > 0 ? '#26a69a' : '#f06292'};">(${diff > 0 ? '+' : ''}${diff.toLocaleString('pt-BR')})</span>`;
                    return `<td style="padding:6px 10px;text-align:right;color:#26c6da;font-weight:600;">${cong.toLocaleString('pt-BR')}${dTxt}</td>`;
                })() : ''}
                <td style="padding:6px 10px;text-align:right;">
                    <input type="number" min="0" value="${r.planejado}" placeholder="${r.sugerido}"
                        style="width:80px;padding:4px 8px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;color:${planCor};font-size:.82rem;font-weight:600;text-align:right;"
                        onchange="planoProducao.setQty('${escJS(r.codigo)}','${this._mesSel}',parseInt(this.value)||0)">
                </td>
            </tr>`;
        }).join('');
        if (count) count.textContent = `${rows.length} SKUs`;
    },

    async _renderCapacidade() {
        const wrap   = document.getElementById('plano-cap-wrap');
        const barras = document.getElementById('plano-cap-barras');
        const mesLbl = document.getElementById('plano-cap-mes');
        if (!wrap||!barras||!this._mesSel||!banco.rawData.length) { if(wrap) wrap.style.display='none'; return; }
        const mesRender = this._mesSel;   // anti-corrida: se o usuário trocar de mês durante o await, descarta este render
        const demMapa = {};
        previsao._forecast.filter(r=>r.mes===this._mesSel && !previsao._excluidosSet().has(String(r.codigo))).forEach(r=>{
            const qty = this._plano[`${this._mesSel}_${r.codigo}`]??r.qty;
            if (qty>0) demMapa[r.codigo]=(demMapa[r.codigo]||0)+qty;
        });
        // Dias úteis REAIS do mês (calendário + feriados) — mesma base do heatmap S&OP,
        // senão o mesmo mês mostra % de capacidade diferente em cada tela (review A1)
        const dias = await toc._calcDiasUteisDoMes(this._mesSel).catch(() => 22);
        if (this._mesSel !== mesRender) return;
        const res = toc.calcularComDemanda(demMapa, dias);
        const mesInfo = previsao._nextMonths.find(m=>m.mes===this._mesSel);
        if (mesLbl) mesLbl.textContent = mesInfo?.label?.toUpperCase()||'';

        // Quebra por tear Stoll (cadastro real de teares). O agregado de Tecelagem passa a vir DAÍ
        // (média ponderada dos teares), para bater com a quebra em vez de usar o OEE agregado da config.
        const cap = toc._getCap();
        const bancoMap = {};
        banco.rawData.forEach(r => { const cod = String(r.dados?.['Código'] ?? '').trim().toUpperCase(); if (cod) bancoMap[cod] = r.dados; });
        let mods = [];
        try { mods = await toc.calcularStoll(demMapa, bancoMap, dias, cap); } catch {}
        if (this._mesSel !== mesRender) return;   // mês mudou durante o cálculo — o render mais novo cuida
        const temStoll  = mods.length > 0;
        const capTear   = mods.reduce((s,m)=> s + (isFinite(m.capMin)?m.capMin:0), 0);
        const cargaTear = mods.reduce((s,m)=> s + m.cargaMin, 0);
        const utilTear  = capTear > 0 ? cargaTear / capTear : null;

        const subStoll = temStoll ? (`<div style="margin:0 0 6px 18px;">` +
            `<div style="font-size:.63rem;color:var(--text-dim);letter-spacing:.05em;margin:1px 0 3px;">↳ TECELAGEM POR TEAR STOLL</div>` +
            mods.map(m=>{
                const inf = m.util===Infinity;
                const pct = inf ? 100 : Math.min((m.util||0)*100,300);
                const cor = (inf||m.util>=1)?'#f06292':m.util>=.8?'#ffca28':'#26a69a';
                const dir = inf ? `⚠ ${(m.cargaMin/60).toFixed(0)}h sem tear` : `${pct.toFixed(0)}%`;
                return `<div style="display:flex;align-items:center;gap:12px;padding:3px 0;">
                    <div style="width:150px;font-size:.72rem;color:var(--text-primary);">Stoll ${escHTML(m.modelo)}<span style="font-size:.62rem;color:var(--text-dim);"> · ${m.n} máq</span></div>
                    <div style="flex:1;height:6px;background:var(--bg-input);border-radius:4px;overflow:hidden;"><div style="width:${Math.min(pct/1.5,100)}%;height:100%;background:${cor};border-radius:4px;"></div></div>
                    <div style="width:60px;text-align:right;font-size:.72rem;font-weight:700;color:${cor};">${dir}</div>
                </div>`;
            }).join('') + `</div>`) : '';

        barras.innerHTML = res.map(p=>{
            // Tecelagem: usa a utilização REAL dos teares cadastrados (coerente com a quebra), não o OEE agregado da config
            let util = p.util, cargaMin = p.cargaMin;
            if (p.id==='tecelagem' && temStoll && utilTear!=null) { util = utilTear; cargaMin = cargaTear; }
            const stollAbaixo = (p.id==='tecelagem') ? subStoll : '';
            if (!cargaMin) return `<div style="display:flex;align-items:center;gap:12px;padding:5px 0;"><div style="width:150px;font-size:.78rem;color:var(--text-dim);">${p.nome}</div><div style="flex:1;height:7px;background:var(--bg-input);border-radius:4px;"></div><div style="width:60px;text-align:right;font-size:.73rem;color:var(--text-dim);">sem dados</div></div>` + stollAbaixo;
            const pct=Math.min((util||0)*100,300), cor=util>=1?'#f06292':util>=.8?'#ffca28':'#26a69a';
            const bar = `<div style="display:flex;align-items:center;gap:12px;padding:5px 0;">
                <div style="width:150px;font-size:.78rem;font-weight:600;">${p.nome}</div>
                <div style="flex:1;height:7px;background:var(--bg-input);border-radius:4px;overflow:hidden;"><div style="width:${Math.min(pct/1.5,100)}%;height:100%;background:${cor};border-radius:4px;"></div></div>
                <div style="width:60px;text-align:right;font-size:.78rem;font-weight:700;color:${cor};">${pct.toFixed(0)}%</div>
            </div>`;
            return bar + stollAbaixo;
        }).join('');
        wrap.style.display='';
    },
};

// ====== S&OP — POLÍTICA DE ESTOQUES ======
const politicaEstoque = {
    _rows: [],

    _fmtR(v) {
        if (!v || v < 0) return '—';
        return v >= 1e6 ? 'R$ ' + (v/1e6).toFixed(1) + 'M'
             : v >= 1e3 ? 'R$ ' + (v/1e3).toFixed(0) + 'k'
             : 'R$ ' + Math.round(v).toLocaleString('pt-BR');
    },

    calcular() {
        if (!vendas.rawData.length)  { mostrarToast('Importe Vendas primeiro.', 'erro'); return; }
        if (!estoque.rawData.length) { mostrarToast('Importe Estoque primeiro.', 'erro'); return; }

        const leadTime = parseFloat(document.getElementById('pol-lead')?.value) || 1;
        const zBase    = parseFloat(document.getElementById('pol-nivel')?.value) || 1.28;
        const nMeses   = parseInt(document.getElementById('pol-hist')?.value) || 12;
        const useAbc   = document.getElementById('pol-abc-auto')?.checked;
        const usarPrev = document.getElementById('pol-usar-prev')?.checked;
        localStorage.setItem('pol-params', JSON.stringify({ leadTime, zBase, nMeses, usarPrev }));

        const months = vendas.monthCols.slice(-nMeses);
        if (!months.length) { mostrarToast('Sem dados de vendas para calcular.', 'erro'); return; }

        // Demanda prevista (opcional): média mensal do plano ativo da Previsão, no lugar do histórico.
        // O desvio-padrão continua vindo do histórico (mais estável). SKU sem previsão cai no histórico.
        let demPrevMap = null, prevInfo = '';
        if (usarPrev) {
            if (!previsao._forecast.length) previsao.calcular();  // garante o forecast do plano/Base carregado
            const excl = previsao._excl || new Set();
            const perMes = {};                                     // cod -> { mes: soma }  (soma linhas do mesmo cod no mês)
            previsao._forecast.forEach(f => {
                const cod = String(f.codigo || '').trim().toUpperCase();
                if (!cod || excl.has(cod)) return;
                (perMes[cod] || (perMes[cod] = {}));
                perMes[cod][f.mes] = (perMes[cod][f.mes] || 0) + (Number(f.qty) || 0);
            });
            demPrevMap = {};
            Object.entries(perMes).forEach(([cod, mm]) => {        // média dos totais mensais no horizonte
                const vals = Object.values(mm);
                demPrevMap[cod] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
            });
            const pAtivo = previsao._planos.find(p => p.id === previsao._planoAtivo);
            prevInfo = previsao._forecast.length
                ? `▸ demanda da Previsão: ${pAtivo ? '“' + pAtivo.nome + '”' + (pAtivo.congelado ? ' 🔒' : '') : 'Base (importação)'} · ${Object.keys(demPrevMap).length} SKUs`
                : '⚠ Previsão vazia — calcule na tela de Previsão; usando histórico';
        }
        const infoEl = document.getElementById('pol-prev-info'); if (infoEl) infoEl.textContent = prevInfo;

        // Preço unitário por SKU a partir do estoque (valor total / quantidade)
        const precoMap = {};
        if (estoque._colValor) {
            const toN = v => parseFloat(String(v).replace(/[^\d,.\-]/g,'').replace(',','.')) || 0;
            estoque.rawData.forEach(r => {
                const cod = String(r.codigo || '').trim().toUpperCase();
                const qty = Number(r.quantidade) || 0;
                const val = toN(r.dados?.[estoque._colValor] ?? 0);
                if (cod && qty > 0 && val > 0) precoMap[cod] = val / qty;
            });
        }

        // Classificação ABC por volume de vendas (A=top 80%, B=80-95%, C=resto)
        const abcMap = {};
        const zByClass = { A: 1.65, B: 1.28, C: 1.04 };
        if (useAbc) {
            const totVend = {};
            vendas.rawData.forEach(r => {
                const cod = String(r.codigo||'').trim().toUpperCase();
                const tot = vendas.monthCols.reduce((s,mc) => s+(r[mc.key]||0), 0);
                totVend[cod] = (totVend[cod]||0) + tot;
            });
            const sorted = Object.entries(totVend).sort((a,b) => b[1]-a[1]);
            const grand  = sorted.reduce((s,[,v]) => s+v, 0);
            let acc = 0;
            sorted.forEach(([cod, v]) => {
                acc += v;
                abcMap[cod] = acc/grand <= 0.80 ? 'A' : acc/grand <= 0.95 ? 'B' : 'C';
            });
        }

        // Histórico de vendas por SKU
        const vendMap = {};
        vendas.rawData.forEach(r => {
            const cod = String(r.codigo || '').trim().toUpperCase();
            if (!cod) return;
            if (!vendMap[cod]) vendMap[cod] = { porMes: {}, descricao: r.descricao || '', segmento: r.segmento || '' };
            months.forEach(mc => { vendMap[cod].porMes[mc.key] = (vendMap[cod].porMes[mc.key] || 0) + (Number(r[mc.key]) || 0); });  // M3: soma por mês (SKU repetido não dilui a média)
        });

        // Estoque atual por SKU
        const estMap = {};
        estoque.rawData.forEach(r => {
            const cod = String(r.codigo || '').trim().toUpperCase();
            if (cod) estMap[cod] = (estMap[cod] || 0) + (Number(r.quantidade) || 0);
        });

        // Universo = histórico de vendas ∪ previsão (senão SKU só-com-previsão — ex.: ➕ SKU
        // adicionado à mão no plano — nunca ganharia política de estoque)
        const univ = new Set(Object.keys(vendMap));
        if (demPrevMap) Object.keys(demPrevMap).forEach(c => univ.add(c));
        // descrição/segmento p/ SKUs sem venda: busca no forecast
        const fcInfo = {};
        if (demPrevMap) previsao._forecast.forEach(f => { const c = String(f.codigo).toUpperCase(); if (!fcInfo[c]) fcInfo[c] = { descricao: f.descricao || '', segmento: f.segmento || '' }; });

        this._rows = [...univ].map(cod => {
            const info   = vendMap[cod] || { porMes: {}, ...(fcInfo[cod] || { descricao: '', segmento: '' }) };
            const qtds   = months.map(mc => info.porMes[mc.key] || 0);  // M3: uma entrada por mês (não por linha)
            const n      = qtds.length;
            const ativos = qtds.filter(v => v > 0).length;
            const temPrev = demPrevMap && demPrevMap[cod] != null;
            if (!ativos && !temPrev) return null;   // sem venda E sem previsão → fora
            const demHist  = qtds.reduce((s, v) => s + v, 0) / n;
            // Demanda média: prevista (plano ativo) se marcado e houver previsão p/ o SKU, senão histórica
            const demMedia = temPrev ? demPrevMap[cod] : demHist;
            if (demMedia < 1) return null;
            // Desvio SEMPRE do histórico (variabilidade real de venda) — base honesta p/ o estoque de segurança.
            // SKU sem histórico (só previsão): fallback conservador de 30% da demanda prevista.
            const desvPad = ativos > 0 && n > 1
                ? Math.sqrt(qtds.reduce((s, v) => s + (v - demHist) ** 2, 0) / (n - 1))
                : demMedia * 0.3;

            const abcClass     = abcMap[cod] || null;
            const z            = useAbc && abcClass ? zByClass[abcClass] : zBase;
            const estAtual     = estMap[cod] || 0;
            const estSeguranca = Math.round(z * desvPad * Math.sqrt(leadTime));
            const estoqueRepos = Math.round(demMedia * leadTime + estSeguranca);
            const cobAtual     = demMedia > 0 ? estAtual / demMedia : null;
            const cobIdeal     = demMedia > 0 ? estoqueRepos / demMedia : null;
            const qtyProduzir  = Math.max(0, estoqueRepos - estAtual);

            let status;
            if (estAtual <= estSeguranca && estSeguranca > 0) status = 'RUPTURA';
            else if (estAtual < estoqueRepos) status = 'RISCO';
            else if (estAtual > 2 * estoqueRepos) status = 'EXCESSO';
            else status = 'OK';

            const valorUn      = precoMap[cod] || null;
            const revenueRisco = valorUn && qtyProduzir > 0 ? qtyProduzir * valorUn : null;
            const capitalExcesso = valorUn && status === 'EXCESSO' ? (estAtual - estoqueRepos) * valorUn : null;

            return { cod, descricao: info.descricao, segmento: info.segmento,
                     demMedia, desvPad, estAtual, cobAtual, estSeguranca,
                     estoqueRepos, cobIdeal, qtyProduzir, status, abcClass,
                     valorUn, revenueRisco, capitalExcesso };
        }).filter(Boolean);

        this._demFonte = (usarPrev && demPrevMap) ? 'previsao' : 'historico';
        const ORDER = { RUPTURA: 0, RISCO: 1, EXCESSO: 2, OK: 3 };
        this._rows.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (b.qtyProduzir - a.qtyProduzir));
        this._renderKPIs();
        this._renderTabela();
        mostrarToast(`✓ ${this._rows.length} SKUs analisados${(usarPrev && demPrevMap) ? ' · demanda da Previsão' : ''}`);
    },

    _renderKPIs() {
        const el = document.getElementById('pol-kpis');
        if (!el || !this._rows.length) return;
        const counts = { RUPTURA: 0, RISCO: 0, OK: 0, EXCESSO: 0 };
        this._rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
        const totProd = this._rows.reduce((s, r) => s + r.qtyProduzir, 0);
        let revRisco = 0, capParado = 0, temPreco = false;
        this._rows.forEach(r => {
            if (r.revenueRisco)  { revRisco  += r.revenueRisco;  temPreco = true; }
            if (r.capitalExcesso){ capParado += r.capitalExcesso; temPreco = true; }
        });

        const kpis = [
            { l: 'RUPTURA', v: counts.RUPTURA, s: temPreco && revRisco > 0 ? this._fmtR(revRisco * counts.RUPTURA / Math.max(1, counts.RUPTURA + counts.RISCO)) + ' em risco' : 'abaixo do est. segurança', c: '#f06292' },
            { l: 'RISCO',   v: counts.RISCO,   s: 'abaixo do ponto repos.',   c: '#ffca28' },
            { l: 'OK',      v: counts.OK,       s: 'dentro da política',       c: '#26a69a' },
            { l: 'EXCESSO', v: counts.EXCESSO,  s: temPreco && capParado > 0 ? this._fmtR(capParado) + ' parado em estoque' : 'acima de 2× o ideal', c: '#90caf9' },
            { l: 'A PRODUZIR', v: totProd.toLocaleString('pt-BR'), s: 'unid. para cobertura ideal', c: 'var(--indigo-primary)' },
        ];

        // Se tiver preço, mostra card extra de impacto financeiro total
        const extraCard = temPreco ? `<div class="summary-card" style="border-top:3px solid #f06292;grid-column:span 2;">
            <div class="s-label">IMPACTO FINANCEIRO TOTAL</div>
            <div style="display:flex;gap:24px;margin:8px 0;flex-wrap:wrap;">
                <div><div style="font-size:1.3rem;font-weight:800;color:#f06292;">${this._fmtR(revRisco)}</div><div class="s-sub">receita em risco (RUPTURA+RISCO)</div></div>
                <div><div style="font-size:1.3rem;font-weight:800;color:#90caf9;">${this._fmtR(capParado)}</div><div class="s-sub">capital parado (EXCESSO)</div></div>
            </div>
        </div>` : '';

        el.style.gridTemplateColumns = temPreco ? 'repeat(5,1fr)' : 'repeat(5,1fr)';
        el.innerHTML = kpis.map(k => `<div class="summary-card" style="border-top:3px solid ${k.c};">
            <div class="s-label">${k.l}</div>
            <div style="font-size:1.9rem;font-weight:800;color:${k.c};margin:8px 0;">${k.v}</div>
            <div class="s-sub">${k.s}</div>
        </div>`).join('') + extraCard;
    },

    _renderTabela() {
        const el = document.getElementById('pol-tabela');
        if (!el) return;
        if (!this._rows.length) {
            el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-dim);">Configure os parâmetros e clique em CALCULAR para analisar.</div>';
            return;
        }
        const q       = (document.getElementById('pol-search')?.value || '').toLowerCase();
        const statusF = document.getElementById('pol-status-sel')?.value || '';
        const rows    = this._rows.filter(r =>
            (!q || r.cod.toLowerCase().includes(q) || r.descricao.toLowerCase().includes(q)) &&
            (!statusF || r.status === statusF)
        );
        const STATUS_COR = { RUPTURA: '#f06292', RISCO: '#ffca28', OK: '#26a69a', EXCESSO: '#90caf9' };
        const ABC_COR    = { A: '#f06292', B: '#ffca28', C: '#90caf9' };
        const temAbc     = rows.some(r => r.abcClass);
        const temPreco   = rows.some(r => r.valorUn);

        el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="color:var(--text-dim);font-size:.67rem;letter-spacing:.07em;border-bottom:2px solid var(--border-color);">
                ${temAbc ? `<th style="padding:8px 8px;text-align:center;" title="Classificação ABC por volume de vendas">ABC</th>` : ''}
                <th style="padding:8px 12px;text-align:left;">CÓDIGO</th>
                <th style="padding:8px 12px;text-align:left;">DESCRIÇÃO</th>
                <th style="padding:8px 10px;text-align:right;" title="${this._demFonte === 'previsao' ? 'Média mensal PREVISTA (plano ativo)' : 'Média mensal de vendas (histórico)'}">DEM MÉDIA${this._demFonte === 'previsao' ? ' <span style="color:var(--indigo-primary);" title="fonte: Previsão">◆</span>' : ''}</th>
                <th style="padding:8px 10px;text-align:right;" title="Desvio padrão mensal">σ</th>
                <th style="padding:8px 10px;text-align:right;">EST ATUAL</th>
                <th style="padding:8px 10px;text-align:right;" title="Cobertura atual em meses">COB ATUAL</th>
                <th style="padding:8px 10px;text-align:right;" title="Estoque de segurança = z × σ × √LT">EST SEG</th>
                <th style="padding:8px 10px;text-align:right;" title="Ponto de reposição = dem×LT + est.seg.">PONTO REPOS</th>
                <th style="padding:8px 10px;text-align:right;" title="Cobertura ideal em meses">COB IDEAL</th>
                <th style="padding:8px 10px;text-align:right;">A PRODUZIR</th>
                ${temPreco ? `<th style="padding:8px 10px;text-align:right;" title="Impacto financeiro">R$ IMPACTO</th>` : ''}
                <th style="padding:8px 12px;text-align:center;">STATUS</th>
            </tr></thead>
            <tbody>${rows.map((r, i) => {
                const cor    = STATUS_COR[r.status] || '#fff';
                const bg     = i % 2 ? 'var(--bg-input)' : 'transparent';
                const cobCor = !r.cobAtual ? 'var(--text-dim)' : r.cobAtual < 1 ? '#f06292' : r.cobAtual > 3 ? '#90caf9' : '#26a69a';
                const rImpact = r.revenueRisco || r.capitalExcesso;
                const rCor   = r.revenueRisco ? '#f06292' : '#90caf9';
                return `<tr style="background:${bg};border-bottom:1px solid rgba(255,255,255,.04);">
                    ${temAbc ? `<td style="padding:6px 8px;text-align:center;">${r.abcClass ? `<span style="padding:1px 7px;border-radius:10px;font-size:.7rem;font-weight:800;background:${ABC_COR[r.abcClass]}33;color:${ABC_COR[r.abcClass]};">${r.abcClass}</span>` : '—'}</td>` : ''}
                    <td style="padding:7px 12px;font-weight:700;color:var(--indigo-primary);">${escHTML(r.cod)}</td>
                    <td style="padding:7px 12px;font-size:.78rem;color:var(--text-dim);">${escHTML(r.descricao.slice(0, 26))}</td>
                    <td style="padding:7px 10px;text-align:right;">${r.demMedia.toFixed(0)}</td>
                    <td style="padding:7px 10px;text-align:right;color:var(--text-dim);">${r.desvPad.toFixed(1)}</td>
                    <td style="padding:7px 10px;text-align:right;font-weight:600;">${r.estAtual.toLocaleString('pt-BR')}</td>
                    <td style="padding:7px 10px;text-align:right;color:${cobCor};">${r.cobAtual !== null ? r.cobAtual.toFixed(1)+'m' : '—'}</td>
                    <td style="padding:7px 10px;text-align:right;">${r.estSeguranca.toLocaleString('pt-BR')}</td>
                    <td style="padding:7px 10px;text-align:right;font-weight:600;">${r.estoqueRepos.toLocaleString('pt-BR')}</td>
                    <td style="padding:7px 10px;text-align:right;color:var(--text-dim);">${r.cobIdeal !== null ? r.cobIdeal.toFixed(1)+'m' : '—'}</td>
                    <td style="padding:7px 10px;text-align:right;font-weight:700;color:${r.qtyProduzir > 0 ? '#26c6da' : 'var(--text-dim)'};">${r.qtyProduzir > 0 ? r.qtyProduzir.toLocaleString('pt-BR') : '—'}</td>
                    ${temPreco ? `<td style="padding:7px 10px;text-align:right;font-weight:700;color:${rImpact ? rCor : 'var(--text-dim)'};">${rImpact ? this._fmtR(rImpact) : '—'}</td>` : ''}
                    <td style="padding:7px 12px;text-align:center;">
                        <span style="padding:2px 10px;border-radius:20px;font-size:.68rem;font-weight:700;background:${cor}22;color:${cor};">${r.status}</span>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>
        <div style="padding:8px 12px;font-size:.72rem;color:var(--text-dim);">${rows.length} de ${this._rows.length} SKUs</div>`;
    },

    sugerirEstoqueMinimo() {
        if (!this._rows.length) { mostrarToast('Calcule primeiro.', 'erro'); return; }
        this._rows.forEach(r => { if (r.estoqueRepos > 0) planoProducao.setEstMin(r.cod, r.estoqueRepos); });
        mostrarToast(`✓ Estoque mínimo sugerido para ${this._rows.length} SKUs`);
    },

    enviarParaPlano() {
        if (!this._rows.length) { mostrarToast('Calcule primeiro.', 'erro'); return; }
        if (!previsao._nextMonths.length) { mostrarToast('Calcule a Previsão de Demanda primeiro.', 'erro'); return; }
        const mes = previsao._nextMonths[0]?.mes;
        let n = 0;
        this._rows.filter(r => r.qtyProduzir > 0).forEach(r => { planoProducao.setQty(r.cod, mes, r.qtyProduzir); n++; });
        mostrarToast(`✓ ${n} SKUs enviados para o Plano de Produção (${mes})`);
    },

    exportarCSV() {
        if (!this._rows.length) { mostrarToast('Calcule primeiro.', 'erro'); return; }
        const h = ['CÓDIGO','DESCRIÇÃO','ABC','DEM_MÉDIA','DESV_PAD','EST_ATUAL','COB_ATUAL','EST_SEGURANÇA','PONTO_REPOS','COB_IDEAL','A_PRODUZIR','VALOR_UNIT','R$_IMPACTO','STATUS'];
        const lines = [h.join(';')].concat(this._rows.map(r =>
            [r.cod, r.descricao.replace(/;/g,''), r.abcClass||'', r.demMedia.toFixed(0), r.desvPad.toFixed(1),
             r.estAtual, r.cobAtual?.toFixed(1)||'', r.estSeguranca, r.estoqueRepos,
             r.cobIdeal?.toFixed(1)||'', r.qtyProduzir,
             r.valorUn?.toFixed(2)||'',
             ((r.revenueRisco||r.capitalExcesso)||0).toFixed(2),
             r.status].join(';')
        ));
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'politica_estoques.csv';
        a.click();
    },
};

// ====== S&OP — DASHBOARD EXECUTIVO ======
const soepDash = {
    _acoes:     [],
    _snapshots: [],
    _abaAtiva:  'visao-geral',

    init() { this.carregarAcoes(); this.carregarSnapshots(); },

    async carregarAcoes() {
        try { this._acoes = await api.get('/api/soep-acoes') || []; } catch { this._acoes=[]; }
    },

    async carregarSnapshots() {
        try { this._snapshots = await api.get('/api/soep-snapshot') || []; } catch { this._snapshots=[]; }
    },

    async salvarSnapshotAtual() {
        if (!previsao._forecast.length) { mostrarToast('Calcule a Previsão primeiro.','erro'); return; }
        // Baseline congelado: mês que JÁ tem snapshot não é sobrescrito — senão re-clicar substitui a
        // previsão original pela atual e o MAPE (previsto-no-início × real) perde o sentido (review A2)
        const mesesJa = new Set((this._snapshots || []).map(s => s.mes));
        const porMes = {};
        previsao._forecast.forEach(r => {
            if (previsao._excluidosSet().has(String(r.codigo))) return;   // respeita exclusões do plano
            if (mesesJa.has(r.mes)) return;
            if (!porMes[r.mes]) porMes[r.mes] = [];
            porMes[r.mes].push({ codigo: r.codigo, qty: r.qty });
        });
        const pulados = [...new Set(previsao._forecast.map(r => r.mes))].filter(m => mesesJa.has(m)).length;
        if (!Object.keys(porMes).length) { mostrarToast(`Todos os ${pulados} meses do horizonte já têm snapshot (baseline preservado). Para refazer um mês, exclua o snapshot dele primeiro.`, 'aviso'); return; }
        let total = 0;
        for (const [mes, items] of Object.entries(porMes)) {
            const r = await api.post('/api/soep-snapshot/bulk', { mes, items });
            if (r?.ok) total += r.total||0;
        }
        await this.carregarSnapshots();
        mostrarToast(`✓ Snapshot salvo — ${total} SKUs × ${Object.keys(porMes).length} meses` + (pulados ? ` (${pulados} já congelado${pulados>1?'s':''}, preservado${pulados>1?'s':''})` : ''));
        if (this._abaAtiva === 'prev-real') this._renderPrevReal();
    },

    _selecionarAba(aba) {
        this._abaAtiva = aba;
        ['ciclo','visao-geral','prev-real','horizonte','financeiro','cenarios','longo'].forEach(a => {
            const btn = document.getElementById(`soep-tab-${a}`);
            const pnl = document.getElementById(`soep-panel-${a}`);
            const ativo = a === aba;
            if (btn) { btn.style.background = ativo ? 'var(--indigo-btn)' : 'var(--bg-input)'; btn.style.color = ativo ? '#fff' : 'var(--text-dim)'; }
            if (pnl) pnl.style.display = ativo ? '' : 'none';
        });
        if (aba === 'prev-real') this._renderPrevReal();
        if (aba === 'horizonte') this._renderHorizonte6m();
        if (aba === 'financeiro') this._renderFinanceiro();
        if (aba === 'ciclo') this._renderCiclo();
        if (aba === 'cenarios') this._renderCenarios();
        if (aba === 'longo') this._renderHorizonteLongo();
    },

    async render() {
        if (!previsao._forecast.length && vendas.rawData.length) previsao.calcular();
        this._renderKPIs();
        this._selecionarAba(this._abaAtiva);
        if (this._abaAtiva === 'visao-geral') {
            this._renderHorizonte();
            await this._renderCapHeatmap();
            this._renderAcoes();
        }
    },

    _renderPrevReal() {
        const el = document.getElementById('soep-prev-real-content');
        if (!el) return;
        if (!this._snapshots.length) {
            el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-dim);">
                <div style="display:flex;justify-content:center;margin-bottom:12px;color:var(--text-dim);"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 11a3 3 0 0 1 3-3h2.5l1.8-3h9.4l1.8 3H28a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V11z"/><circle cx="16" cy="18" r="4.5"/></svg></div>
                <div style="font-size:.9rem;margin-bottom:16px;">Nenhum snapshot salvo ainda.</div>
                <div style="font-size:.82rem;">Clique em <strong>Salvar Snapshot</strong> após calcular a Previsão de Demanda para começar a rastrear a acurácia.</div>
            </div>`;
            return;
        }
        // Agrupa snapshots por mês
        const snapMap = {};
        this._snapshots.forEach(s => {
            if (!snapMap[s.mes]) snapMap[s.mes] = {};
            snapMap[s.mes][s.codigo] = s.qty_prevista;
        });
        // Monta mapa de vendas reais por mês+código
        const realMap = {};
        vendas.rawData.forEach(r => {
            const cod = String(r.codigo||'').trim().toUpperCase();
            vendas.monthCols.forEach(mc => {
                const qty = r[mc.key]||0;
                if (!qty) return;
                const ano = mc.year || '';
                const num = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].indexOf(mc.abbr) + 1;
                if (!ano || !num) return;
                const mk = `${ano}-${String(num).padStart(2,'0')}`;
                if (!realMap[mk]) realMap[mk] = {};
                realMap[mk][cod] = (realMap[mk][cod]||0) + qty;
            });
        });
        const meses = Object.keys(snapMap).sort().reverse();
        let html = `<div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="color:var(--text-dim);font-size:.68rem;letter-spacing:.07em;border-bottom:2px solid var(--border-color);">
                <th style="padding:10px 14px;text-align:left;">MÊS</th>
                <th style="padding:10px 12px;text-align:right;">PREVISTO</th>
                <th style="padding:10px 12px;text-align:right;">REALIZADO</th>
                <th style="padding:10px 12px;text-align:right;">DIFERENÇA</th>
                <th style="padding:10px 12px;text-align:right;">ERRO %</th>
                <th style="padding:10px 12px;text-align:center;">STATUS</th>
            </tr></thead><tbody>`;
        let totPrev=0, totReal=0, countMeses=0;
        meses.forEach((mes, i) => {
            const prevMap  = snapMap[mes] || {};
            const realMes  = realMap[mes] || {};
            const prevTotal = Object.values(prevMap).reduce((s,v)=>s+v,0);
            const realTotal = Object.values(realMes).reduce((s,v)=>s+v,0);
            const diff   = realTotal - prevTotal;
            const errPct = prevTotal > 0 ? Math.abs(diff/prevTotal*100) : null;
            const temReal = realTotal > 0;
            const cor = !temReal ? 'var(--text-dim)' : errPct<=10?'#26a69a':errPct<=20?'#ffca28':'#f06292';
            const status = !temReal ? 'Futuro' : errPct<=10?'Boa':errPct<=20?'Regular':'Alta variação';
            // Data formatada
            const [a,m] = mes.split('-');
            const ABBR=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
            const mesLabel = `${ABBR[(parseInt(m)||1)-1]}/${String(a).slice(2)}`;
            if (temReal) { totPrev+=prevTotal; totReal+=realTotal; countMeses++; }
            const bg = i%2?'var(--bg-input)':'transparent';
            html += `<tr style="background:${bg};cursor:pointer;" onclick="soepDash._expandirMes('${mes}')">
                <td style="padding:9px 14px;font-weight:700;">${mesLabel}</td>
                <td style="padding:9px 12px;text-align:right;">${prevTotal.toLocaleString('pt-BR')}</td>
                <td style="padding:9px 12px;text-align:right;color:${temReal?'var(--text-primary)':'var(--text-dim)'};">${temReal?realTotal.toLocaleString('pt-BR'):'—'}</td>
                <td style="padding:9px 12px;text-align:right;color:${cor};">${temReal?(diff>=0?'+':'')+diff.toLocaleString('pt-BR'):'—'}</td>
                <td style="padding:9px 12px;text-align:right;font-weight:700;color:${cor};">${errPct!==null?errPct.toFixed(1)+'%':'—'}</td>
                <td style="padding:9px 12px;text-align:center;font-size:.78rem;color:${cor};">${status}</td>
            </tr>
            <tr id="soep-exp-${mes}" style="display:none;"><td colspan="6" style="padding:0 14px 12px;"></td></tr>`;
        });
        if (countMeses>0) {
            const totErr = totPrev>0?Math.abs((totReal-totPrev)/totPrev*100):0;
            const cor = totErr<=10?'#26a69a':totErr<=20?'#ffca28':'#f06292';
            html += `<tr style="border-top:2px solid var(--border-color);font-weight:700;">
                <td style="padding:10px 14px;">MÉDIA GERAL</td>
                <td style="padding:10px 12px;text-align:right;">${totPrev.toLocaleString('pt-BR')}</td>
                <td style="padding:10px 12px;text-align:right;">${totReal.toLocaleString('pt-BR')}</td>
                <td style="padding:10px 12px;text-align:right;color:${cor};">${((totReal-totPrev)>=0?'+':'')}${(totReal-totPrev).toLocaleString('pt-BR')}</td>
                <td style="padding:10px 12px;text-align:right;font-weight:800;color:${cor};">${totErr.toFixed(1)}%</td>
                <td></td>
            </tr>`;
        }
        html += `</tbody></table></div>`;
        el.innerHTML = html;
    },

    _expandirMes(mes) {
        const row = document.getElementById(`soep-exp-${mes}`);
        if (!row) return;
        if (row.style.display !== 'none') { row.style.display='none'; return; }
        const snapMap = {};
        (this._snapshots.filter(s=>s.mes===mes)).forEach(s => { snapMap[s.codigo] = s.qty_prevista; });
        const realMap = {};
        vendas.rawData.forEach(r => {
            const cod = String(r.codigo||'').trim().toUpperCase();
            vendas.monthCols.forEach(mc => {
                const ano = mc.year||''; const num = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].indexOf(mc.abbr)+1;
                if (!ano||!num) return;
                if (`${ano}-${String(num).padStart(2,'0')}` !== mes) return;
                realMap[cod] = (realMap[cod]||0)+(r[mc.key]||0);
            });
        });
        const todos = [...new Set([...Object.keys(snapMap),...Object.keys(realMap)])];
        const rows = todos.map(cod => ({
            cod, prev: snapMap[cod]||0, real: realMap[cod]||0,
            err: snapMap[cod]>0 ? Math.abs((realMap[cod]||0)-(snapMap[cod]))/(snapMap[cod])*100 : null
        })).filter(r=>r.prev||r.real).sort((a,b)=>Math.abs(b.real-b.prev)-Math.abs(a.real-a.prev)).slice(0,20);
        let inner = `<div style="background:var(--bg-input);border-radius:8px;padding:14px;margin-top:4px;">
            <div style="font-size:.72rem;color:var(--text-dim);margin-bottom:10px;">TOP 20 SKUs com maior variação — clique na linha para fechar</div>
            <table style="width:100%;border-collapse:collapse;font-size:.75rem;">
            <tr style="color:var(--text-dim);border-bottom:1px solid var(--border-color);">
                <th style="padding:4px 8px;text-align:left;">CÓDIGO</th>
                <th style="padding:4px 8px;text-align:right;">PREVISTO</th>
                <th style="padding:4px 8px;text-align:right;">REALIZADO</th>
                <th style="padding:4px 8px;text-align:right;">ERRO%</th>
            </tr>`;
        rows.forEach((r,i) => {
            const cor = r.err===null?'var(--text-dim)':r.err<=10?'#26a69a':r.err<=20?'#ffca28':'#f06292';
            inner += `<tr style="background:${i%2?'rgba(255,255,255,.03)':'transparent'};">
                <td style="padding:4px 8px;font-weight:600;color:var(--indigo-primary);">${escHTML(r.cod)}</td>
                <td style="padding:4px 8px;text-align:right;">${r.prev.toLocaleString('pt-BR')}</td>
                <td style="padding:4px 8px;text-align:right;">${r.real?r.real.toLocaleString('pt-BR'):'—'}</td>
                <td style="padding:4px 8px;text-align:right;font-weight:700;color:${cor};">${r.err!==null?r.err.toFixed(1)+'%':'—'}</td>
            </tr>`;
        });
        inner += `</table></div>`;
        row.children[0].innerHTML = inner;
        row.style.display = '';
    },

    async _renderHorizonte6m() {
        const el = document.getElementById('soep-horizonte-est');
        if (!el) return;
        if (!previsao._nextMonths.length) {
            el.innerHTML = '<div style="color:var(--text-dim);padding:24px;text-align:center;">Calcule a Previsão de Demanda primeiro.</div>';
            return;
        }
        const months    = previsao._nextMonths;
        const estInicial = estoque.rawData.reduce((s, r) => s + (Number(r.quantidade) || 0), 0);
        // dias úteis reais por mês (cacheado após a 1ª chamada) — mesma base do heatmap
        const diasPorMes = await Promise.all(months.map(m => toc._calcDiasUteisDoMes(m.mes).catch(() => 22)));
        const exclSet = previsao._excluidosSet();

        let estAcc = estInicial;
        const cols = months.map((m, mi) => {
            const dem  = previsao.getTotalMes(m.mes);
            const plan = Object.entries(planoProducao._plano)
                .filter(([k]) => k.startsWith(m.mes + '_') && !exclSet.has(k.slice(m.mes.length + 1)))   // exclusões do plano valem aqui também
                .reduce((s, [, v]) => s + (v || 0), 0);
            estAcc = estAcc + plan - dem;
            const cob = dem > 0 ? estAcc / dem : null;
            let status, cor;
            if (estAcc <= 0)                         { status = 'RUPTURA'; cor = '#f06292'; }
            else if (cob !== null && cob < 0.5)      { status = 'RISCO';   cor = '#ffca28'; }
            else if (cob !== null && cob > 3)        { status = 'EXCESSO'; cor = '#90caf9'; }
            else                                     { status = 'OK';      cor = '#26a69a'; }

            const demMap  = previsao.getDemandaMapa(m.mes);
            const procs   = banco.rawData.length ? toc.calcularComDemanda(demMap, diasPorMes[mi]) : [];
            const comDados = procs.filter(p => p.util != null && p.cargaMin > 0);
            const maxUtil  = comDados.length ? Math.max(...comDados.map(p => p.util || 0)) : 0;
            const garNome  = comDados.sort((a, b) => (b.util || 0) - (a.util || 0))[0]?.nome || '—';
            const garCor   = maxUtil >= 1 ? '#f06292' : maxUtil >= 0.8 ? '#ffca28' : '#26a69a';

            return { m, dem, plan, estPrev: estAcc, cob, status, cor, maxUtil, garNome, garCor };
        });

        const n = months.length;
        // Cards mensais
        const cardsHtml = `<div style="display:grid;grid-template-columns:repeat(${n},1fr);gap:12px;min-width:${n*160}px;">
            ${cols.map(c => `<div style="background:var(--bg-input);border-radius:10px;padding:16px;border-top:3px solid ${c.cor};">
                <div style="font-size:.85rem;font-weight:700;margin-bottom:12px;">${c.m.label.toUpperCase()}</div>
                <div style="display:flex;flex-direction:column;gap:7px;font-size:.79rem;">
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-dim);">Demanda prev.</span>
                        <span style="font-weight:600;">${c.dem.toLocaleString('pt-BR')}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-dim);">Produção plan.</span>
                        <span style="font-weight:600;color:${c.plan ? 'var(--indigo-primary)' : 'var(--text-dim)'};">${c.plan ? c.plan.toLocaleString('pt-BR') : '—'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border-color);padding-top:6px;">
                        <span style="color:var(--text-dim);">Est. projetado</span>
                        <span style="font-weight:700;color:${c.estPrev < 0 ? '#f06292' : c.cor};">${c.estPrev.toLocaleString('pt-BR')}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-dim);">Cobertura</span>
                        <span style="font-weight:600;color:${c.cor};">${c.cob !== null ? c.cob.toFixed(1) + 'm' : '—'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border-color);padding-top:6px;">
                        <span style="color:var(--text-dim);">Gargalo</span>
                        <span style="font-weight:600;color:${c.garCor};" title="${escHTML(c.garNome)}">${(c.maxUtil * 100).toFixed(0)}%</span>
                    </div>
                    <div style="margin-top:4px;text-align:center;">
                        <span style="padding:2px 12px;border-radius:20px;font-size:.68rem;font-weight:700;background:${c.cor}22;color:${c.cor};">${c.status}</span>
                    </div>
                </div>
            </div>`).join('')}
        </div>
        <div style="margin-top:12px;font-size:.72rem;color:var(--text-dim);">
            Est. inicial: ${estInicial.toLocaleString('pt-BR')} un — cada mês inicia com o saldo projetado do anterior
        </div>`;

        // Breakdown por segmento
        const codSegMap = {};
        vendas.rawData.forEach(r => {
            const cod = String(r.codigo||'').trim().toUpperCase();
            if (cod && r.segmento) codSegMap[cod] = r.segmento;
        });
        const segs = [...new Set(Object.values(codSegMap))].sort();

        let segTableHtml = '';
        if (segs.length > 1) {
            // Estoque inicial por segmento
            const estSegIni = {};
            estoque.rawData.forEach(r => {
                const cod = String(r.codigo||'').trim().toUpperCase();
                const seg = codSegMap[cod];
                if (seg) estSegIni[seg] = (estSegIni[seg]||0) + (Number(r.quantidade)||0);
            });

            // Plano por segmento×mês
            const planSeg = {};
            Object.entries(planoProducao._plano).forEach(([k, v]) => {
                const us  = k.indexOf('_');
                const mes = us >= 0 ? k.slice(0, us) : k;
                const cod = us >= 0 ? k.slice(us + 1).toUpperCase() : '';
                if (exclSet.has(cod)) return;   // exclusões do plano de previsão valem aqui também
                const seg = codSegMap[cod];
                if (seg) {
                    if (!planSeg[seg]) planSeg[seg] = {};
                    planSeg[seg][mes] = (planSeg[seg][mes]||0) + (v||0);
                }
            });

            // Demanda prevista por segmento×mês
            const demSeg = {};
            previsao._forecast.forEach(r => {
                if (previsao._excluidosSet().has(String(r.codigo))) return;   // respeita exclusões do plano
                const seg = r.segmento || codSegMap[String(r.codigo||'').toUpperCase()];   // era r.cod (campo inexistente) — o fallback nunca funcionava
                if (!seg) return;
                if (!demSeg[seg]) demSeg[seg] = {};
                demSeg[seg][r.mes] = (demSeg[seg][r.mes]||0) + (r.qty||0);
            });

            const STATUS_COR_S = { RUPTURA:'#f06292', RISCO:'#ffca28', OK:'#26a69a', EXCESSO:'#90caf9' };
            const segRows = segs.map((seg, si) => {
                let accSeg = estSegIni[seg] || 0;
                const cells = months.map(m => {
                    const dem  = demSeg[seg]?.[m.mes] || 0;
                    const plan = planSeg[seg]?.[m.mes] || 0;
                    accSeg = accSeg + plan - dem;
                    const cob = dem > 0 ? accSeg / dem : null;
                    let st, sc;
                    if (accSeg <= 0)                { st = 'RUPTURA'; sc = '#f06292'; }
                    else if (cob !== null && cob < 0.5) { st = 'RISCO';   sc = '#ffca28'; }
                    else if (cob !== null && cob > 3)   { st = 'EXCESSO'; sc = '#90caf9'; }
                    else                            { st = 'OK';      sc = '#26a69a'; }
                    return `<td style="padding:6px 10px;text-align:right;font-size:.79rem;" title="${st}">
                        <span style="font-weight:700;color:${sc};">${accSeg.toLocaleString('pt-BR')}</span>
                        <br><span style="font-size:.66rem;color:var(--text-dim);">${cob !== null ? cob.toFixed(1)+'m' : '—'}</span>
                    </td>`;
                });
                const bg = si%2 ? 'var(--bg-input)' : 'transparent';
                return `<tr style="background:${bg};border-bottom:1px solid rgba(255,255,255,.04);">
                    <td style="padding:7px 12px;font-size:.8rem;font-weight:600;">${escHTML(seg)}</td>
                    ${cells.join('')}
                </tr>`;
            }).join('');

            segTableHtml = `<div style="margin-top:20px;" class="summary-card">
                <div style="font-size:.72rem;letter-spacing:.07em;color:var(--text-dim);margin-bottom:10px;">ESTOQUE PROJETADO POR SEGMENTO</div>
                <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                    <thead><tr style="color:var(--text-dim);font-size:.67rem;letter-spacing:.07em;border-bottom:2px solid var(--border-color);">
                        <th style="padding:8px 12px;text-align:left;">SEGMENTO</th>
                        ${months.map(m=>`<th style="padding:8px 10px;text-align:right;">${m.label.toUpperCase()}</th>`).join('')}
                    </tr></thead>
                    <tbody>${segRows}</tbody>
                </table>
                </div>
                <div style="margin-top:8px;font-size:.7rem;color:var(--text-dim);">Est. projetado (un) e cobertura (meses) por segmento — valor acumulado mês a mês</div>
            </div>`;
        }

        el.innerHTML = cardsHtml + segTableHtml;
    },

    _renderKPIs() {
        const el = document.getElementById('soep-kpis');
        if (!el) return;
        const nextMes    = previsao._nextMonths[0];
        const demTotal   = nextMes ? previsao.getTotalMes(nextMes.mes) : 0;
        const planTotal  = nextMes ? Object.entries(planoProducao._plano)
            .filter(([k])=>k.startsWith(nextMes.mes+'_')).reduce((s,[,v])=>s+(v||0),0) : 0;
        const estTotal   = estoque.rawData.reduce((s,r)=>s+(Number(r.quantidade)||0),0);
        const cobertura  = demTotal>0 ? (estTotal/demTotal).toFixed(1) : null;
        const abertas    = this._acoes.filter(a=>a.status==='aberta').length;
        const atrasadas  = this._acoes.filter(a=>a.status==='aberta'&&a.prazo&&new Date(a.prazo)<new Date()).length;
        const cards = [
            { l:'DEMANDA PRÓXIMO MÊS',    v:demTotal.toLocaleString('pt-BR'),  s:nextMes?.label||'sem previsão', c:'#26c6da' },
            { l:'PRODUÇÃO PLANEJADA',     v:planTotal.toLocaleString('pt-BR'), s:planTotal?'unidades planejadas':'não planejado', c:planTotal?'#26a69a':'var(--text-dim)' },
            { l:'COBERTURA DE ESTOQUE',   v:cobertura?cobertura+'×':'—',      s:`${estTotal.toLocaleString('pt-BR')} un em estoque`, c:!cobertura?'var(--text-dim)':parseFloat(cobertura)<1?'#f06292':parseFloat(cobertura)>3?'#ffca28':'#26a69a' },
            { l:'AÇÕES ABERTAS',          v:abertas,   s:atrasadas>0?`${atrasadas} atrasada${atrasadas>1?'s':''}`:abertas?'em dia':'nenhuma', c:atrasadas>0?'#f06292':'#26a69a' },
        ];
        el.innerHTML = cards.map(c=>`<div class="summary-card"><div class="s-label" style="margin-bottom:8px;">${c.l}</div>
            <div style="font-size:2rem;font-weight:800;color:${c.c};margin-bottom:4px;">${c.v}</div>
            <div class="s-sub">${c.s}</div></div>`).join('');
    },

    _renderHorizonte() {
        const table = document.getElementById('soep-horizonte-table');
        if (!table||!previsao._nextMonths.length) return;
        const months = previsao._nextMonths;
        const segs   = [...new Set(previsao._forecast.filter(r=>!previsao._excluidosSet().has(String(r.codigo))).map(r=>r.segmento).filter(Boolean))].sort();
        const header = `<thead>
            <tr style="color:var(--text-dim);font-size:.68rem;letter-spacing:.08em;border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 12px;text-align:left;">SEGMENTO</th>
                ${months.map(m=>`<th colspan="2" style="padding:8px 12px;text-align:center;border-left:1px solid var(--border-color);">${m.label.toUpperCase()}</th>`).join('')}
            </tr>
            <tr style="color:var(--text-dim);font-size:.64rem;border-bottom:1px solid var(--border-color);">
                <th></th>
                ${months.map(()=>`<th style="padding:4px 8px;text-align:right;">PREV</th><th style="padding:4px 8px;text-align:right;border-right:1px solid var(--border-color);">PLAN</th>`).join('')}
            </tr></thead>`;
        const rows = segs.map((seg,i)=>{
            const bg = i%2?'var(--bg-input)':'transparent';
            const cells = months.map(m=>{
                const prev = previsao.getTotalMes(m.mes, seg);
                const codsSeg = new Set(previsao._forecast.filter(r=>r.segmento===seg && !previsao._excluidosSet().has(String(r.codigo))).map(r=>r.codigo));
                const plan = Object.entries(planoProducao._plano)
                    .filter(([k])=>k.startsWith(m.mes+'_') && codsSeg.has(k.split('_').slice(1).join('_')))
                    .reduce((s,[,v])=>s+(v||0),0);
                return `<td style="padding:7px 8px;text-align:right;border-left:1px solid var(--border-color);">${prev.toLocaleString('pt-BR')}</td>
                    <td style="padding:7px 8px;text-align:right;color:${plan?'var(--indigo-primary)':'var(--text-dim)'};border-right:1px solid var(--border-color);">${plan||'—'}</td>`;
            }).join('');
            return `<tr style="background:${bg};"><td style="padding:7px 12px;font-weight:600;">${escHTML(seg)}</td>${cells}</tr>`;
        }).join('');
        table.innerHTML = header + `<tbody>${rows}</tbody>`;
    },

    async _renderCapHeatmap() {
        const el = document.getElementById('soep-cap-heatmap');
        if (!el) return;
        if (!banco.rawData.length||!previsao._nextMonths.length) {
            el.innerHTML='<div style="color:var(--text-dim);font-size:.82rem;">Importe Banco de Dados e calcule a Previsão para ver o mapa.</div>'; return;
        }
        const months  = previsao._nextMonths;
        // Busca dias úteis de cada mês com feriados
        const diasPorMes = await Promise.all(months.map(m => toc._calcDiasUteisDoMes(m.mes)));
        const results = months.map((m, i)=>({ mes:m, procs:toc.calcularComDemanda(previsao.getDemandaMapa(m.mes), diasPorMes[i]) }));
        let html = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="color:var(--text-dim);font-size:.7rem;letter-spacing:.06em;border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 12px;text-align:left;">PROCESSO</th>
                ${months.map(m=>`<th style="padding:8px 12px;text-align:center;">${m.label.toUpperCase()}</th>`).join('')}
                <th style="padding:8px 12px;text-align:center;">TENDÊNCIA</th>
            </tr></thead><tbody>`;
        toc._PROCS.forEach((proc,pi)=>{
            const bg=pi%2?'var(--bg-input)':'transparent';
            const utilVals = results.map(({procs})=>procs.find(p=>p.id===proc.id));
            const cells = utilVals.map(r=>{
                if (!r?.cargaMin) return `<td style="padding:8px 12px;text-align:center;color:var(--text-dim);">—</td>`;
                const pct=(r.util*100).toFixed(0), cor=r.util>=1?'#f06292':r.util>=.8?'#ffca28':'#26a69a';
                return `<td style="padding:8px 12px;text-align:center;background:${r.util>=1?'rgba(240,98,146,.1)':r.util>=.8?'rgba(255,202,40,.07)':'transparent'};">
                    <span style="font-weight:700;color:${cor};">${pct}%</span></td>`;
            }).join('');
            // Trend arrow
            const u0=utilVals[0]?.util||0, uN=utilVals[utilVals.length-1]?.util||0;
            const trendCor=uN>u0?'#f06292':'#26a69a', trendArrow=uN>u0?'↑':uN<u0?'↓':'→';
            html += `<tr style="background:${bg};">
                <td style="padding:8px 12px;font-weight:600;">${proc.nome}</td>
                ${cells}
                <td style="padding:8px 12px;text-align:center;font-weight:700;color:${trendCor};">${trendArrow}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        el.innerHTML = html;
    },

    _salvarMetaFin() {
        const meta = parseFloat(document.getElementById('soep-meta')?.value) || 0;
        const marg = parseFloat(document.getElementById('soep-margem')?.value) || 0;
        localStorage.setItem('soep-meta-receita', meta);
        localStorage.setItem('soep-margem-pct', marg);
        this._renderFinanceiro();
    },

    // Reconciliação financeira: plano em R$ (preço médio de venda real) × meta; margem = % informado pelo usuário
    _renderFinanceiro() {
        const el = document.getElementById('soep-financeiro-content');
        if (!el) return;
        if (!vendas.rawData.length) { el.innerHTML = '<div class="summary-card" style="padding:24px;color:var(--text-dim);">Importe <strong>Vendas</strong> para calcular o preço médio de venda por produto.</div>'; return; }
        if (!previsao._forecast.length) previsao.calcular();
        const meses = previsao._nextMonths || [];
        if (!meses.length) { el.innerHTML = '<div class="summary-card" style="padding:24px;color:var(--text-dim);">Rode a <strong>Previsão</strong> (gera os meses do horizonte) para ver o financeiro.</div>'; return; }

        // preço médio por SKU — das VENDAS reais (valor ÷ qtd); fallback no ESTOQUE (mesma fonte da Política). Nada inventado.
        const preco = {};
        vendas.rawData.forEach(r => { const c = String(r.codigo || '').trim().toUpperCase(); const q = Number(r.quantidade) || 0; const v = Number(r.valor) || 0; if (c && q > 0 && v > 0) preco[c] = v / q; });
        if (typeof estoque !== 'undefined' && estoque._colValor && Array.isArray(estoque.rawData)) {
            const toN = v => parseFloat(String(v).replace(/[^\d,.\-]/g, '').replace(',', '.')) || 0;
            estoque.rawData.forEach(r => { const c = String(r.codigo || '').trim().toUpperCase(); if (!c || preco[c]) return; const q = Number(r.quantidade) || 0; const val = toN(r.dados?.[estoque._colValor] ?? 0); if (q > 0 && val > 0) preco[c] = val / q; });
        }

        const meta = parseFloat(localStorage.getItem('soep-meta-receita')) || 0;   // meta de receita mensal (R$)
        const margemPct = parseFloat(localStorage.getItem('soep-margem-pct')) || 0; // margem alvo (%) — fallback onde não há custo
        const custos = (() => { try { return JSON.parse(localStorage.getItem('soep-custos') || '{}'); } catch { return {}; } })(); // custo unitário por SKU (o usuário informa)
        const usaPlano = Object.keys(planoProducao._plano || {}).length > 0;
        const brl = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
        const semPrecoSet = new Set();
        const skuRev = {};   // cod → {receita, qty, desc} para o editor de custos

        const linhas = meses.map(m => {
            let receita = 0, volume = 0, custoReal = 0, recComCusto = 0;
            previsao._forecast.filter(f => f.mes === m.mes && !previsao._excluidosSet().has(String(f.codigo))).forEach(f => {
                const cod = String(f.codigo).toUpperCase();
                const q = planoProducao._plano[`${m.mes}_${cod}`] ?? f.qty ?? 0;
                if (!q) return;
                volume += q;
                const p = preco[cod];
                if (p > 0) {
                    receita += q * p;
                    const sr = (skuRev[cod] = skuRev[cod] || { receita: 0, qty: 0, desc: f.descricao || cod });
                    sr.receita += q * p; sr.qty += q;
                    const cu = custos[cod];
                    if (cu > 0) { custoReal += q * cu; recComCusto += q * p; }
                } else semPrecoSet.add(cod);
            });
            const recSemCusto = receita - recComCusto;
            const margem = (margemPct > 0 || custoReal > 0) ? (recComCusto - custoReal) + recSemCusto * (margemPct / 100) : null;
            return { m, volume, receita, margem, gap: meta > 0 ? receita - meta : null };
        });
        const temMargem = margemPct > 0 || Object.keys(custos).length > 0;
        const totReceita = linhas.reduce((s, l) => s + l.receita, 0);
        const totMargem = temMargem ? linhas.reduce((s, l) => s + (l.margem || 0), 0) : null;
        const gapTot = meta > 0 ? totReceita - meta * linhas.length : null;
        const nSku = Object.keys(skuRev).length, nComCusto = Object.keys(skuRev).filter(c => custos[c] > 0).length;
        const kpi = (c, v, l) => `<div style="background:${c}18;border:1px solid ${c}44;border-radius:8px;padding:12px 20px;min-width:160px;text-align:center;">
            <div style="font-size:1.35rem;font-weight:800;color:${c};">${v}</div><div style="font-size:.66rem;color:${c};letter-spacing:.05em;">${l}</div></div>`;

        let html = `<div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:6px;">RECONCILIAÇÃO FINANCEIRA — plano em R$ × meta</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin:0 0 12px;">Receita = ${usaPlano ? 'plano de produção' : 'previsão (sem plano salvo ainda)'} × <strong>preço médio de venda</strong> (das vendas reais). Margem = receita − <strong>custo unitário que você definir</strong> (abaixo); onde faltar custo, usa o <strong>% alvo</strong>. Nada de preço/custo inventado.</p>
            <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:end;">
                <div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px;">Meta de receita / mês (R$)</div>
                    <input id="soep-meta" type="number" min="0" value="${meta || ''}" placeholder="0" onchange="soepDash._salvarMetaFin()" style="width:170px;padding:6px 10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:7px;color:var(--text-primary);font-size:.85rem;text-align:right;"></div>
                <div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px;">Margem alvo (%) — onde não há custo</div>
                    <input id="soep-margem" type="number" min="0" max="100" step="0.5" value="${margemPct || ''}" placeholder="ex.: 35" onchange="soepDash._salvarMetaFin()" style="width:90px;padding:6px 10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:7px;color:var(--text-primary);font-size:.85rem;text-align:right;"></div>
            </div>
        </div>`;

        html += `<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
            ${kpi('#26c6da', brl(totReceita), `RECEITA PLANEJADA (${linhas.length} meses)`)}
            ${totMargem != null ? kpi('#26a69a', brl(totMargem), `MARGEM (${nComCusto} c/ custo real · resto ${margemPct}%)`) : ''}
            ${gapTot != null ? kpi(gapTot >= 0 ? '#26a69a' : '#f06292', (gapTot >= 0 ? '+' : '') + brl(gapTot), 'GAP vs META') : kpi('#8b949e', '—', 'DEFINA A META')}
        </div>`;

        html += `<div class="summary-card" style="padding:0;overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.66rem;">
                <th style="padding:9px 14px;text-align:left;">MÊS</th><th style="padding:9px 14px;text-align:right;">VOLUME</th>
                <th style="padding:9px 14px;text-align:right;">RECEITA</th>${temMargem ? '<th style="padding:9px 14px;text-align:right;">MARGEM</th>' : ''}
                <th style="padding:9px 14px;text-align:right;">META</th><th style="padding:9px 14px;text-align:right;">GAP</th></tr></thead><tbody>`;
        linhas.forEach((l, i) => {
            const gapCor = l.gap == null ? 'var(--text-dim)' : l.gap >= 0 ? '#26a69a' : '#f06292';
            html += `<tr style="background:${i % 2 ? 'var(--bg-input)' : 'transparent'};border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:8px 14px;font-weight:600;">${escHTML(l.m.label)}</td>
                <td style="padding:8px 14px;text-align:right;">${l.volume.toLocaleString('pt-BR')}</td>
                <td style="padding:8px 14px;text-align:right;font-weight:600;color:#26c6da;">${brl(l.receita)}</td>
                ${temMargem ? `<td style="padding:8px 14px;text-align:right;color:#26a69a;">${l.margem != null ? brl(l.margem) : '—'}</td>` : ''}
                <td style="padding:8px 14px;text-align:right;color:var(--text-dim);">${meta > 0 ? brl(meta) : '—'}</td>
                <td style="padding:8px 14px;text-align:right;font-weight:700;color:${gapCor};">${l.gap == null ? '—' : (l.gap >= 0 ? '+' : '') + brl(l.gap)}</td></tr>`;
        });
        html += `</tbody></table></div>`;

        // Editor de custos unitários (top SKUs por receita) — o usuário informa o custo real
        const topSku = Object.entries(skuRev).sort((a, b) => b[1].receita - a[1].receita).slice(0, 25);
        if (topSku.length) {
            html += `<div class="summary-card" style="margin-top:14px;"><details${nComCusto ? '' : ' open'}>
                <summary style="cursor:pointer;font-size:.82rem;font-weight:600;color:var(--indigo-primary);">💲 Custos unitários — ${nComCusto}/${nSku} definidos (clique para editar)</summary>
                <p style="font-size:.72rem;color:var(--text-dim);margin:8px 0 10px;">Digite o custo unitário REAL dos principais produtos (top ${topSku.length} por receita). Onde não houver custo, a margem usa o % alvo.</p>
                <table style="width:100%;border-collapse:collapse;font-size:.78rem;"><thead><tr style="color:var(--text-dim);font-size:.64rem;border-bottom:1px solid var(--border-color);">
                    <th style="text-align:left;padding:5px 8px;">CÓDIGO</th><th style="text-align:left;padding:5px 8px;">DESCRIÇÃO</th><th style="text-align:right;padding:5px 8px;">PREÇO MÉD.</th><th style="text-align:right;padding:5px 8px;">CUSTO UN. (R$)</th><th style="text-align:right;padding:5px 8px;">MARGEM %</th></tr></thead><tbody>`;
            topSku.forEach(([cod, sr]) => {
                const pmed = sr.qty > 0 ? sr.receita / sr.qty : 0;
                const cu = custos[cod] || 0;
                const mgPct = cu > 0 && pmed > 0 ? Math.round((pmed - cu) / pmed * 100) : null;
                html += `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                    <td style="padding:5px 8px;font-weight:600;color:var(--indigo-primary);">${escHTML(cod)}</td>
                    <td style="padding:5px 8px;">${escHTML((sr.desc || '').slice(0, 34))}</td>
                    <td style="padding:5px 8px;text-align:right;color:var(--text-dim);">${brl(pmed)}</td>
                    <td style="padding:5px 8px;text-align:right;"><input type="number" min="0" step="0.01" value="${cu || ''}" placeholder="—" onchange="soepDash._salvarCusto('${escJS(cod)}', this.value)" style="width:90px;padding:3px 7px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:5px;color:var(--text-primary);font-size:.76rem;text-align:right;"></td>
                    <td style="padding:5px 8px;text-align:right;font-weight:700;color:${mgPct == null ? 'var(--text-dim)' : mgPct < 0 ? '#f06292' : mgPct < 20 ? '#ffca28' : '#26a69a'};">${mgPct == null ? '—' : mgPct + '%'}</td></tr>`;
            });
            html += `</tbody></table></details></div>`;
        }
        if (semPrecoSet.size) html += `<div style="margin-top:10px;font-size:.72rem;color:#ffca28;">⚠ ${semPrecoSet.size} produto(s) do plano sem preço de venda no histórico — ficam de fora da receita. Importe Vendas com o valor desses códigos para incluir.</div>`;
        el.innerHTML = html;
    },

    _salvarCusto(cod, val) {
        let custos = {}; try { custos = JSON.parse(localStorage.getItem('soep-custos') || '{}'); } catch {}
        const c = String(cod).toUpperCase(), v = parseFloat(val);
        if (v > 0) custos[c] = v; else delete custos[c];
        localStorage.setItem('soep-custos', JSON.stringify(custos));
        this._renderFinanceiro();
    },

    // ── Cenários / what-if: alavancas (×demanda, +capacidade) → base × cenário ──
    _setCenario() {
        localStorage.setItem('soep-cen-dem', document.getElementById('soep-cen-dem')?.value || '1');
        localStorage.setItem('soep-cen-cap', document.getElementById('soep-cen-cap')?.value || '0');
        this._renderCenarios();
    },
    _renderCenarios() {
        const el = document.getElementById('soep-cen-content');
        if (!el) return;
        if (!vendas.rawData.length) { el.innerHTML = '<div class="summary-card" style="padding:24px;color:var(--text-dim);">Importe <strong>Vendas</strong> para simular cenários financeiros.</div>'; return; }
        if (!previsao._forecast.length) previsao.calcular();
        const meses = previsao._nextMonths || [];
        if (!meses.length) { el.innerHTML = '<div class="summary-card" style="padding:24px;color:var(--text-dim);">Rode a <strong>Previsão</strong> para simular cenários.</div>'; return; }

        // preço + custo (mesma fonte do Financeiro)
        const preco = {};
        vendas.rawData.forEach(r => { const c = String(r.codigo || '').trim().toUpperCase(); const q = Number(r.quantidade) || 0; const v = Number(r.valor) || 0; if (c && q > 0 && v > 0) preco[c] = v / q; });
        if (typeof estoque !== 'undefined' && estoque._colValor && Array.isArray(estoque.rawData)) {
            const toN = v => parseFloat(String(v).replace(/[^\d,.\-]/g, '').replace(',', '.')) || 0;
            estoque.rawData.forEach(r => { const c = String(r.codigo || '').trim().toUpperCase(); if (!c || preco[c]) return; const q = Number(r.quantidade) || 0; const val = toN(r.dados?.[estoque._colValor] ?? 0); if (q > 0 && val > 0) preco[c] = val / q; });
        }
        const custos = (() => { try { return JSON.parse(localStorage.getItem('soep-custos') || '{}'); } catch { return {}; } })();
        const margemPct = parseFloat(localStorage.getItem('soep-margem-pct')) || 0;

        // base (do plano/previsão)
        let receita = 0, volume = 0, custoReal = 0, recComCusto = 0;
        meses.forEach(m => previsao._forecast.filter(f => f.mes === m.mes && !previsao._excluidosSet().has(String(f.codigo))).forEach(f => {
            const cod = String(f.codigo).toUpperCase();
            const q = planoProducao._plano[`${m.mes}_${cod}`] ?? f.qty ?? 0;
            if (!q) return;
            volume += q;
            const p = preco[cod];
            if (p > 0) { receita += q * p; const cu = custos[cod]; if (cu > 0) { custoReal += q * cu; recComCusto += q * p; } }
        }));
        const margem = (recComCusto - custoReal) + (receita - recComCusto) * (margemPct / 100);
        // Gargalo VIVO da demanda do horizonte (antes usava o último resultado da tela TOC,
        // que podia ser de outro mês/demanda). Demanda agregada ÷ dias agregados escala igual.
        let proc = null;
        if (banco.rawData.length && meses.length) {
            const demAgg = {};
            meses.forEach(m => { const dm = previsao.getDemandaMapa(m.mes); Object.entries(dm).forEach(([c, q]) => { demAgg[c] = (demAgg[c] || 0) + q; }); });
            const diasAgg = meses.length * (parseFloat(document.getElementById('toc-dias')?.value) || 22);
            proc = toc.calcularComDemanda(demAgg, diasAgg).filter(p => !p.semDados && p.cargaMin > 0).sort((a, b) => (b.util || 0) - (a.util || 0))[0] || null;
        }
        if (!proc) proc = (toc._resultProcs || []).filter(p => !p.semDados).sort((a, b) => (b.util || 0) - (a.util || 0))[0];
        const utilBase = proc ? (proc.util || 0) : null;

        // alavancas
        const dem = parseFloat(localStorage.getItem('soep-cen-dem')) || 1;
        const capExtra = parseFloat(localStorage.getItem('soep-cen-cap')) || 0;
        const cReceita = receita * dem, cMargem = margem * dem, cVolume = volume * dem;
        const cUtil = utilBase != null ? utilBase * dem / (1 + capExtra / 100) : null;

        const brl = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
        const seta = (a, b) => { const d = b - a; if (Math.abs(d) < 0.01) return ''; return `<span style="font-size:.7rem;color:${d > 0 ? '#26a69a' : '#f06292'};"> (${d > 0 ? '+' : ''}${brl(d)})</span>`; };
        const inp = 'padding:6px 10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:7px;color:var(--text-primary);font-size:.85rem;text-align:right;';

        let html = `<div class="summary-card" style="margin-bottom:16px;">
            <div class="s-label" style="margin-bottom:4px;">CENÁRIOS — E SE...?</div>
            <p style="font-size:.74rem;color:var(--text-dim);margin:0 0 12px;">Simule alavancas sobre o plano atual e veja o efeito em receita, margem e no gargalo — sem alterar nada. Base = plano/previsão × preço real.</p>
            <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:end;">
                <div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px;">Demanda ×</div>
                    <input id="soep-cen-dem" type="number" min="0.1" step="0.05" value="${dem}" onchange="soepDash._setCenario()" style="width:90px;${inp}"><div style="font-size:.62rem;color:var(--text-dim);margin-top:2px;">1 = igual · 1.2 = +20%</div></div>
                <div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px;">Capacidade +%</div>
                    <input id="soep-cen-cap" type="number" min="0" step="5" value="${capExtra}" onchange="soepDash._setCenario()" style="width:90px;${inp}"><div style="font-size:.62rem;color:var(--text-dim);margin-top:2px;">ex.: turno extra no gargalo</div></div>
            </div>
        </div>`;

        const linha = (lbl, base, cen, extra) => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
            <td style="padding:9px 14px;font-weight:600;">${lbl}</td>
            <td style="padding:9px 14px;text-align:right;color:var(--text-dim);">${base}</td>
            <td style="padding:9px 14px;text-align:right;font-weight:700;">${cen}${extra || ''}</td></tr>`;
        html += `<div class="summary-card" style="padding:0;overflow:auto;margin-bottom:14px;"><table style="width:100%;border-collapse:collapse;font-size:.85rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.66rem;">
                <th style="padding:9px 14px;text-align:left;">MÉTRICA</th><th style="padding:9px 14px;text-align:right;">BASE</th><th style="padding:9px 14px;text-align:right;">CENÁRIO</th></tr></thead><tbody>
            ${linha('Volume (un)', volume.toLocaleString('pt-BR'), cVolume.toLocaleString('pt-BR', { maximumFractionDigits: 0 }))}
            ${linha('Receita', brl(receita), `<span style="color:#26c6da;">${brl(cReceita)}</span>`, seta(receita, cReceita))}
            ${margemPct > 0 || Object.keys(custos).length ? linha('Margem', brl(margem), `<span style="color:#26a69a;">${brl(cMargem)}</span>`, seta(margem, cMargem)) : ''}
            ${utilBase != null ? linha('Gargalo (utilização)', Math.round(utilBase * 100) + '%', `<span style="color:${cUtil >= 1 ? '#f06292' : cUtil >= 0.85 ? '#ffca28' : '#26a69a'};">${Math.round(cUtil * 100)}%</span>`) : ''}
        </tbody></table></div>`;

        // veredito de viabilidade
        if (utilBase != null) {
            html += cUtil >= 1
                ? `<div class="summary-card" style="border-left:3px solid #f06292;"><div style="font-size:.85rem;color:#f06292;font-weight:600;">⚠ Cenário ESTOURA o gargalo (${proc.nome}) em ${Math.round((cUtil - 1) * 100)}%.</div><div style="font-size:.74rem;color:var(--text-dim);margin-top:4px;">Aumente a capacidade (+% acima), reduza a demanda, ou aceite atraso/terceirize. Para zerar o estouro, precisa de ~${Math.round((cUtil - 1) * 100)}% de capacidade extra no gargalo.</div></div>`
                : `<div class="summary-card" style="border-left:3px solid #26a69a;"><div style="font-size:.85rem;color:#26a69a;font-weight:600;">✓ Cenário VIÁVEL — o gargalo (${proc.nome}) fica em ${Math.round(cUtil * 100)}%.</div></div>`;
        } else {
            html += `<div class="summary-card" style="color:var(--text-dim);font-size:.78rem;">Rode o <strong>TOC (Gargalo)</strong> para incluir a análise de capacidade no cenário.</div>`;
        }
        el.innerHTML = html;
    },

    // ── Horizonte rolante longo (18-24m) agregado por FAMÍLIA — run-rate sazonal ──
    _setHorizLongo() { localStorage.setItem('soep-horiz-longo', document.getElementById('soep-hl-n')?.value || '18'); this._renderHorizonteLongo(); },
    _renderHorizonteLongo() {
        const el = document.getElementById('soep-longo-content');
        if (!el) return;
        if (!vendas.rawData.length || !vendas.monthCols.length) { el.innerHTML = '<div class="summary-card" style="padding:24px;color:var(--text-dim);">Importe <strong>Vendas</strong> (com histórico mensal) para o horizonte longo por família.</div>'; return; }
        const nMeses = Math.min(24, Math.max(6, parseInt(localStorage.getItem('soep-horiz-longo')) || 18));
        const futuros = previsao._getNextMonths(nMeses);

        // run-rate sazonal por família × mês-abbr (média entre anos do histórico)
        const famAbbr = {};   // familia → abbr → {soma, anos:Set}
        vendas.monthCols.forEach(c => {
            vendas.rawData.forEach(r => {
                const f = String(r.segmento || '').trim() || '(sem família)';
                const q = r[c.key] || 0; if (!q) return;
                const fa = (famAbbr[f] = famAbbr[f] || {});
                const a = (fa[c.abbr] = fa[c.abbr] || { soma: 0, anos: new Set() });
                a.soma += q; a.anos.add(c.year);
            });
        });
        const runRate = (f, abbr) => { const a = famAbbr[f]?.[abbr]; return a && a.anos.size ? a.soma / a.anos.size : 0; };
        const familias = Object.keys(famAbbr).sort((a, b) => {
            const ta = Object.values(famAbbr[a]).reduce((s, x) => s + x.soma, 0), tb = Object.values(famAbbr[b]).reduce((s, x) => s + x.soma, 0);
            return tb - ta;
        });
        if (!familias.length) { el.innerHTML = '<div class="summary-card" style="padding:24px;color:var(--text-dim);">Sem histórico por família (coluna Segmento/Família nas Vendas).</div>'; return; }

        const fmt = v => Math.round(v).toLocaleString('pt-BR');
        let html = `<div class="summary-card" style="margin-bottom:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div><div class="s-label">HORIZONTE ROLANTE POR FAMÍLIA</div>
                    <div style="font-size:.74rem;color:var(--text-dim);margin-top:2px;">Run-rate sazonal (média histórica do mês, por família) — a visão agregada de longo prazo do S&OP executivo. Curto prazo é o SKU (aba Previsão); aqui é a família.</div></div>
                <div><span style="font-size:.68rem;color:var(--text-dim);margin-right:6px;">Meses:</span>
                    <input id="soep-hl-n" type="number" min="6" max="24" step="6" value="${nMeses}" onchange="soepDash._setHorizLongo()" style="width:64px;padding:5px 8px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:.82rem;text-align:center;"></div>
            </div>
        </div>`;

        // grade família × mês
        html += `<div class="summary-card" style="padding:0;overflow:auto;"><table style="border-collapse:collapse;font-size:.74rem;white-space:nowrap;min-width:${180 + futuros.length * 62}px;">
            <thead><tr style="border-bottom:2px solid var(--border-color);color:var(--text-dim);font-size:.62rem;">
                <th style="padding:8px 12px;text-align:left;position:sticky;left:0;background:var(--bg-obsidian);">FAMÍLIA</th>
                ${futuros.map(m => `<th style="padding:8px 6px;text-align:right;">${escHTML(m.label)}</th>`).join('')}
                <th style="padding:8px 10px;text-align:right;">MÉD/MÊS</th></tr></thead><tbody>`;
        const totMes = new Array(futuros.length).fill(0);
        familias.forEach((f, i) => {
            const vals = futuros.map(m => runRate(f, m.abbr));
            vals.forEach((v, j) => totMes[j] += v);
            const med = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
            html += `<tr style="background:${i % 2 ? 'var(--bg-input)' : 'transparent'};border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:6px 12px;font-weight:600;color:var(--indigo-primary);position:sticky;left:0;background:${i % 2 ? 'var(--bg-input)' : 'var(--bg-obsidian)'};">${escHTML(f)}</td>
                ${vals.map(v => `<td style="padding:6px 6px;text-align:right;color:${v > 0 ? 'var(--text-primary)' : 'var(--text-dim)'};">${v > 0 ? fmt(v) : '·'}</td>`).join('')}
                <td style="padding:6px 10px;text-align:right;font-weight:700;color:#26c6da;">${fmt(med)}</td></tr>`;
        });
        html += `<tr style="border-top:2px solid var(--border-color);font-weight:800;">
            <td style="padding:8px 12px;position:sticky;left:0;background:var(--bg-obsidian);">TOTAL</td>
            ${totMes.map(v => `<td style="padding:8px 6px;text-align:right;color:#26a69a;">${fmt(v)}</td>`).join('')}
            <td style="padding:8px 10px;text-align:right;color:#26a69a;">${fmt(totMes.reduce((s, v) => s + v, 0) / (totMes.length || 1))}</td></tr>`;
        html += `</tbody></table></div>`;
        html += `<div style="margin-top:10px;font-size:.72rem;color:var(--text-dim);">Projeção de longo prazo é <strong>aproximada por natureza</strong> (run-rate sazonal por família, não previsão fina por SKU). Serve para capacidade/orçamento agregado e para a visão executiva rolante — refine o curto prazo na aba <strong>Previsão</strong>.</div>`;
        el.innerHTML = html;
    },

    // ── Ciclo mensal de S&OP: os 5 passos, dono/estado e a aprovação do plano-único ──
    _cicloMes() { return (previsao._nextMonths && previsao._nextMonths[0]) || { mes: new Date().toISOString().slice(0, 7), label: 'este mês' }; },
    _cicloState(mes) { try { return JSON.parse(localStorage.getItem('soep-ciclo-' + mes) || '{}'); } catch { return {}; } },
    _cicloSet(mes, st) { localStorage.setItem('soep-ciclo-' + mes, JSON.stringify(st)); },
    _cicloToggle(passo) { const m = this._cicloMes().mes; const st = this._cicloState(m); st[passo] = st[passo] || {}; st[passo].feito = !st[passo].feito; this._cicloSet(m, st); this._renderCiclo(); },
    _cicloDono(passo, val) { const m = this._cicloMes().mes; const st = this._cicloState(m); st[passo] = st[passo] || {}; st[passo].dono = val; this._cicloSet(m, st); },
    _cicloAprovar() {
        const c = this._cicloMes(); const st = this._cicloState(c.mes);
        st.aprovado = !st.aprovado; st.aprovadoEm = st.aprovado ? new Date().toISOString() : null;
        this._cicloSet(c.mes, st);
        mostrarToast(st.aprovado ? `Plano de ${c.label} APROVADO (plano-único do mês). Congele o Plano de Produção para travar a versão.` : `Aprovação de ${c.label} desfeita.`, st.aprovado ? 'ok' : 'aviso');
        this._renderCiclo();
    },

    async _renderCiclo() {
        const el = document.getElementById('soep-ciclo-content');
        if (!el) return;
        const c = this._cicloMes();
        const st = this._cicloState(c.mes);
        // sinais automáticos
        const dados = vendas.rawData.length > 0 && (typeof estoque !== 'undefined' && estoque.rawData.length > 0) && (typeof op !== 'undefined' && op.rawData.length > 0);
        const demanda = previsao._forecast.length > 0;
        // Capacidade VIVA do mês do ciclo (antes usava o último resultado da tela TOC,
        // que podia ser de outro mês/demanda — o passo 3 mostrava "viável" desatualizado)
        let procsCiclo = toc._resultProcs || [];
        if (demanda && banco.rawData.length) {
            try { const diasC = await toc._calcDiasUteisDoMes(c.mes); procsCiclo = toc.calcularComDemanda(previsao.getDemandaMapa(c.mes), diasC); } catch {}
        }
        const capOk = procsCiclo.length > 0;
        const comDadosC = capOk ? procsCiclo.filter(p => !p.semDados && p.cargaMin > 0) : [];
        const gargalo = comDadosC.sort((a, b) => (b.util || 0) - (a.util || 0))[0] || null;
        const capViavel = capOk ? !comDadosC.some(p => (p.util || 0) > 1) : null;
        const meta = parseFloat(localStorage.getItem('soep-meta-receita')) || 0;
        const temPlano = Object.keys(planoProducao._plano || {}).length > 0;

        const passos = [
            { id: 'dados', nome: '1 · Coleta de dados', desc: 'Vendas, Estoque e OPs importados e atualizados.', auto: dados, dica: dados ? 'Dados presentes' : 'Faltam Vendas/Estoque/OP', view: 'vendas' },
            { id: 'demanda', nome: '2 · Revisão de Demanda', desc: 'Previsão estatística + consenso comercial (unidades e R$). Documente as premissas dos overrides.', auto: demanda, dica: demanda ? `${previsao._forecast.filter(f => f.mes === c.mes && !previsao._excluidosSet().has(String(f.codigo))).length} SKUs previstos p/ ${c.label}` : 'Rode a Previsão', view: 'previsao' },
            { id: 'capacidade', nome: '3 · Revisão de Capacidade (Supply)', desc: 'A demanda-consenso cabe na fábrica? Onde não couber, quantifique o gap e as contramedidas.', auto: capViavel, dica: capOk ? (capViavel ? 'Plano viável na capacidade nominal' : `Gargalo estoura: ${gargalo ? gargalo.nome + ' ' + Math.round((gargalo.util || 0) * 100) + '%' : ''}`) : 'Rode o TOC (Gargalo)', view: 'toc' },
            { id: 'financeiro', nome: '4 · Reconciliação Financeira', desc: 'Plano em R$ (receita/margem) × meta/orçamento. Só o que exige autoridade sobe para a reunião.', auto: meta > 0, dica: meta > 0 ? 'Meta definida — veja o gap na aba Financeiro' : 'Defina a meta na aba Financeiro (R$)', tab: 'financeiro' },
            { id: 'consenso', nome: '5 · Reunião Executiva / Consenso', desc: 'Aprova UM conjunto de números — o plano-único do mês — e registra as decisões (dono/prazo).', auto: !!st.aprovado, dica: st.aprovado ? `Aprovado em ${new Date(st.aprovadoEm).toLocaleDateString('pt-BR')}` : 'Pendente de aprovação', consenso: true },
        ];
        const feito = p => (st[p.id]?.feito) || p.auto;
        const nDone = passos.filter(feito).length;
        const pct = Math.round(nDone / passos.length * 100);

        let html = `<div class="summary-card" style="margin-bottom:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div><div class="s-label">CICLO S&OP — ${escHTML(c.label)}</div>
                    <div style="font-size:.74rem;color:var(--text-dim);margin-top:2px;">${temPlano ? 'Plano de produção salvo' : 'Sem plano salvo ainda'} · ${nDone}/${passos.length} passos concluídos</div></div>
                <div style="text-align:right;"><div style="font-size:1.8rem;font-weight:800;color:${pct === 100 ? '#26a69a' : 'var(--indigo-primary)'};">${pct}%</div></div>
            </div>
            <div style="height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;margin-top:10px;"><div style="height:100%;width:${pct}%;background:${pct === 100 ? '#26a69a' : 'var(--indigo-primary)'};border-radius:4px;transition:width .4s;"></div></div>
        </div>`;

        passos.forEach(p => {
            const ok = feito(p);
            const cor = ok ? '#26a69a' : (p.auto === false ? '#ffca28' : 'var(--text-dim)');
            const irBtn = p.view ? `<button onclick="navigateTo('${p.view}')" style="padding:4px 12px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--indigo-primary);font-size:.72rem;cursor:pointer;">abrir →</button>`
                : p.tab ? `<button onclick="soepDash._selecionarAba('${p.tab}')" style="padding:4px 12px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--indigo-primary);font-size:.72rem;cursor:pointer;">abrir →</button>` : '';
            html += `<div class="summary-card" style="margin-bottom:10px;border-left:3px solid ${cor};">
                <div style="display:flex;align-items:flex-start;gap:12px;">
                    <div style="font-size:1.3rem;">${ok ? '✅' : (p.auto === false ? '⚠️' : '⬜')}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:.9rem;color:var(--text-primary);">${escHTML(p.nome)}</div>
                        <div style="font-size:.76rem;color:var(--text-dim);margin:3px 0 8px;">${escHTML(p.desc)}</div>
                        <div style="font-size:.74rem;color:${cor};">${ok ? '✓ ' : ''}${escHTML(p.dica)}</div>
                        <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap;">
                            <label style="display:flex;align-items:center;gap:5px;font-size:.72rem;color:var(--text-dim);cursor:pointer;"><input type="checkbox" ${st[p.id]?.feito ? 'checked' : ''} onchange="soepDash._cicloToggle('${p.id}')"> marcar concluído</label>
                            <span style="font-size:.72rem;color:var(--text-dim);">Dono: <input type="text" value="${escHTML(st[p.id]?.dono || '')}" placeholder="responsável" onchange="soepDash._cicloDono('${p.id}', this.value)" style="width:130px;padding:3px 8px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:5px;color:var(--text-primary);font-size:.72rem;"></span>
                            ${irBtn}
                            ${p.consenso ? `<button onclick="soepDash._cicloAprovar()" style="margin-left:auto;padding:6px 18px;border-radius:6px;border:none;background:${st.aprovado ? '#26a69a' : 'var(--indigo-btn)'};color:#fff;font-size:.76rem;font-weight:700;cursor:pointer;">${st.aprovado ? '✓ PLANO APROVADO — desfazer' : 'APROVAR PLANO-ÚNICO'}</button>` : ''}
                        </div>
                    </div>
                </div>
            </div>`;
        });

        // Log de decisões/ações (reusa soep-acoes)
        const acoes = this._acoes || [];
        html += `<div class="summary-card" style="margin-top:6px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div class="s-label">DECISÕES / AÇÕES DO CICLO</div>
            <button onclick="soepDash._selecionarAba('visao-geral');setTimeout(()=>soepDash.novaAcao(),200)" style="padding:4px 12px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--indigo-primary);font-size:.72rem;cursor:pointer;">+ nova ação</button></div>`;
        if (!acoes.length) html += `<div style="font-size:.76rem;color:var(--text-dim);">Nenhuma ação registrada. As decisões da reunião viram ações com dono e prazo.</div>`;
        else html += acoes.slice(0, 8).map(a => `<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.78rem;">
            <span style="color:${a.status === 'concluida' ? '#26a69a' : '#ffca28'};">${a.status === 'concluida' ? '✓' : '○'}</span>
            <span style="flex:1;">${escHTML((a.descricao || '').slice(0, 70))}</span>
            <span style="color:var(--text-dim);font-size:.7rem;">${escHTML(a.responsavel || '')}${a.prazo ? ' · ' + new Date(a.prazo + 'T12:00:00').toLocaleDateString('pt-BR') : ''}</span></div>`).join('');
        html += `</div>`;
        el.innerHTML = html;
    },

    novaAcao() {
        const f = document.getElementById('soep-nova-acao-form');
        if (f) f.style.display = f.style.display==='none' ? '' : 'none';
    },

    async salvarAcao() {
        const desc = document.getElementById('soep-acao-desc')?.value.trim();
        const resp = document.getElementById('soep-acao-resp')?.value.trim();
        const prazo= document.getElementById('soep-acao-prazo')?.value;
        const mod  = document.getElementById('soep-acao-mod')?.value;
        if (!desc) { alert('Informe a descrição.'); return; }
        try {
            const res = await api.post('/api/soep-acoes', { descricao:desc, responsavel:resp, prazo, modulo:mod });
            if (res?.ok) {
                this._acoes.unshift(res.acao);
                ['soep-acao-desc','soep-acao-resp','soep-acao-prazo'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
                document.getElementById('soep-nova-acao-form').style.display='none';
                this._renderAcoes(); this._renderKPIs();
                mostrarToast('✓ Ação registrada');
            }
        } catch(e) { (console.error(e), mostrarToast('Erro inesperado. Tente de novo.', 'erro')); }
    },

    async concluirAcao(id) {
        try {
            await api.put(`/api/soep-acoes/${id}`, { status:'concluida' });
            const a=this._acoes.find(x=>x.id===id); if(a) a.status='concluida';
            this._renderAcoes(); this._renderKPIs();
        } catch(e) { (console.error(e), mostrarToast('Erro inesperado. Tente de novo.', 'erro')); }
    },

    async deletarAcao(id) {
        if (!confirm('Remover esta ação?')) return;
        try {
            await api.delete(`/api/soep-acoes/${id}`);
            this._acoes = this._acoes.filter(a=>a.id!==id);
            this._renderAcoes(); this._renderKPIs();
        } catch(e) { (console.error(e), mostrarToast('Erro inesperado. Tente de novo.', 'erro')); }
    },

    _renderAcoes() {
        const el = document.getElementById('soep-acoes-lista');
        if (!el) return;
        if (!this._acoes.length) { el.innerHTML='<div style="color:var(--text-dim);font-size:.82rem;padding:12px 0;">Nenhuma ação cadastrada.</div>'; return; }
        const sorted = [...this._acoes].sort((a,b)=>{
            if (a.status!==b.status) return a.status==='aberta'?-1:1;
            if (a.prazo&&b.prazo) return new Date(a.prazo)-new Date(b.prazo);
            return 0;
        });
        el.innerHTML = sorted.map(a=>{
            const atrasada = a.status==='aberta' && a.prazo && new Date(a.prazo)<new Date();
            const cor      = a.status==='concluida'?'#26a69a':atrasada?'#f06292':'#26c6da';
            const prazoStr = a.prazo ? new Date(a.prazo+'T00:00:00').toLocaleDateString('pt-BR') : '—';
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-color);">
                <div style="width:9px;height:9px;border-radius:50%;background:${cor};flex-shrink:0;"></div>
                <div style="flex:1;">
                    <div style="font-size:.85rem;font-weight:600;${a.status==='concluida'?'text-decoration:line-through;color:var(--text-dim);':''}">${escHTML(a.descricao)}</div>
                    <div style="font-size:.72rem;color:var(--text-dim);margin-top:2px;">${a.responsavel?escHTML(a.responsavel)+' · ':''}Prazo: ${prazoStr}${a.modulo?' · '+escHTML(a.modulo):''}${atrasada?' · <span style="color:#f06292;font-weight:700;">ATRASADA</span>':''}</div>
                </div>
                ${a.status==='aberta'?`<button onclick="soepDash.concluirAcao('${a.id}')" style="padding:4px 12px;border-radius:6px;border:1px solid #26a69a;background:transparent;color:#26a69a;font-size:.72rem;cursor:pointer;">Concluir</button>`:`<span style="font-size:.72rem;color:#26a69a;">✓</span>`}
                <button onclick="soepDash.deletarAcao('${a.id}')" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-dim);font-size:.72rem;cursor:pointer;">✕</button>
            </div>`;
        }).join('');
    },
};

// ====== LINHA DO TEMPO DE PRODUÇÃO — GANTT SEMANAL ======
// Nome "preactor" evita colisão com document.timeline (Web Animations API),
// que intercepta handlers inline onclick="preactor.x()" via scope chain.
const preactor = {
    _SEQ: ['tecelagem','costura_auto','costura_manual','soldagem','silicone','passadoria','embalagem'],
    _resultado: null,
    _turnos: null,
    _setupMatrix: [],   // [{ processo, familia_de, familia_para, minutos }]
    _datas: {},         // { codigo → { data_entrega, cpv, id } }
    _cenarios: [],
    _manualOverrides: {}, // { `${codigo}_${procId}` → semIdx }
    _abaAtiva: 'gantt',
    _dragState: null,
    _timeFence: 0,   // semanas congeladas (time fence): 0..N-1 não podem receber/ceder OPs no replanejamento

    _setTimeFence(v) {
        this._timeFence = Math.max(0, parseInt(v) || 0);
        if (this._resultado) this._renderGantt();
    },

    async init() {
        const hoje = new Date();
        const el = document.getElementById('tl-start-date');
        // Data local, não UTC — após 21h no Brasil toISOString viraria amanhã
        if (el) el.value = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
        try { this._manualOverrides = JSON.parse(localStorage.getItem('tl_manual') || '{}'); } catch {}
        this._atualizarBadgeManual();
        await Promise.all([this._loadTurnos(), this._loadSetupMatrix(), this._loadDatas()]);
        this._selecionarAba('gantt');
    },

    async _loadTurnos() {
        try { this._turnos = await api.get('/api/turnos') || []; } catch { this._turnos = []; }
    },

    async _loadSetupMatrix() {
        try { this._setupMatrix = await api.get('/api/setup-matrix') || []; } catch { this._setupMatrix = []; }
    },

    async _loadDatas() {
        try {
            const rows = await api.get('/api/op-datas') || [];
            this._datas = {};
            rows.forEach(r => { this._datas[String(r.codigo).toUpperCase()] = { data_entrega: r.data_entrega, cpv: r.cpv||0, id: r.id }; });
        } catch { this._datas = {}; }
    },

    async _carregarCenarios() {
        try { this._cenarios = await api.get('/api/timeline-cenario') || []; } catch { this._cenarios = []; }
        this._renderCenarios();
    },

    _selecionarAba(aba) {
        this._abaAtiva = aba;
        ['gantt','mix','sim','ctp','status','config','cenarios'].forEach(a => {
            const btn = document.getElementById(`tl-tab-${a}`);
            const pan = document.getElementById(`tl-pan-${a}`);
            if (btn) {
                btn.style.borderBottomColor = a === aba ? 'var(--indigo-primary)' : 'transparent';
                btn.style.color = a === aba ? 'var(--indigo-primary)' : 'var(--text-dim)';
            }
            if (pan) pan.style.display = a === aba ? '' : 'none';
        });
        if (aba === 'config') this._renderSetupMatrix();
        if (aba === 'cenarios') this._carregarCenarios();
        if (aba === 'status' && this._resultado) this._renderStatus();
        if (aba === 'mix' && this._resultado) this._renderMix();
        if (aba === 'sim' && this._resultado) this._renderSimulacao();
    },

    _popularMeses() {
        const sel = document.getElementById('tl-mes-sel');
        if (!sel) return;
        const meses = previsao._nextMonths.length ? previsao._nextMonths :
            [...new Set(Object.keys(planoProducao._plano).map(k=>k.split('_')[0]))].sort().map(m=>{
                const [a,mo]=m.split('-'); const ABBR=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
                return {mes:m, label:`${ABBR[(parseInt(mo)||1)-1]}/${String(a).slice(2)}`};
            });
        sel.innerHTML = '<option value="">Todos os meses</option>' +
            meses.map(m=>`<option value="${m.mes||m}">${m.label||m}</option>`).join('');
    },

    _gerarSemanas(startDate, nSemanas) {
        const weeks = [];
        let cur = new Date(startDate);
        const dow = cur.getDay();
        if (dow !== 1) cur.setDate(cur.getDate() + (dow === 0 ? 1 : 8 - dow));
        for (let i = 0; i < nSemanas; i++) {
            const ini = new Date(cur);
            const fim = new Date(cur); fim.setDate(fim.getDate() + 4);
            const label = `${ini.getDate().toString().padStart(2,'0')}/${(ini.getMonth()+1).toString().padStart(2,'0')}`;
            weeks.push({ idx: i, ini, fim, label });
            cur.setDate(cur.getDate() + 7);
        }
        return weeks;
    },

    _diasUteisSemana(ini, fim) {
        const feriados = toc._feriadosCache || new Set();
        let count = 0;
        const d = new Date(ini);
        while (d <= fim) {
            const iso = d.toISOString().slice(0,10);
            if (!feriados.has(iso)) count++;
            d.setDate(d.getDate() + 1);
        }
        return count;
    },

    // Minutos disponíveis POR MÁQUINA na semana (turnos do processo, ou fallback dias-úteis × horas/dia).
    // Sem multiplicar por nº de máquinas nem OEE — isso é aplicado por quem chama (permite capacidade por modelo).
    _minutosMaqSemana(procId, semana) {
        const capConfig = toc._getCap()[procId] || { maquinas:1, horasDia:8, oee:100 };
        const turnProc = (this._turnos || []).filter(t => {
            const nome = (t.processo || '').toLowerCase();
            const pid  = procId.toLowerCase().replace('_','-');
            return nome.includes(pid) || nome.includes(procId.replace('_',' '));
        });
        if (turnProc.length) {
            let minsTotal = 0;
            const d = new Date(semana.ini);
            while (d <= semana.fim) {
                const dow  = d.getDay();
                const iso  = d.toISOString().slice(0,10);
                if (toc._feriadosCache?.has(iso)) { d.setDate(d.getDate()+1); continue; }
                const DIAS_MAP = {0:'domingo',1:'segunda',2:'terca',3:'quarta',4:'quinta',5:'sexta',6:'sabado'};
                const diaName = DIAS_MAP[dow];
                turnProc.forEach(t => {
                    const dias = (t.dias_semana || t.dias || []).map(x=>x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''));
                    if (!dias.some(dn=>diaName.includes(dn.slice(0,4)))) return;
                    const [hI,mI] = (t.inicio||'08:00').split(':').map(Number);
                    const [hF,mF] = (t.fim  ||'18:00').split(':').map(Number);
                    let diff = (hF*60+mF) - (hI*60+mI);
                    if (diff < 0) diff += 24*60; // turno noturno cruza meia-noite
                    minsTotal += Math.max(0, diff - (Number(t.intervalo_min)||0));
                });
                d.setDate(d.getDate() + 1);
            }
            // Turno cadastrado sem dias da semana não pode zerar a capacidade — cai no fallback
            if (minsTotal > 0) return minsTotal;
        }
        return capConfig.horasDia * 60 * this._diasUteisSemana(semana.ini, semana.fim);
    },

    _capSemana(procId, semana) {
        const capConfig = toc._getCap()[procId] || { maquinas:1, horasDia:8, oee:100 };
        const oeeFactor = Math.min((capConfig.oee || 100), 100) / 100;
        return this._minutosMaqSemana(procId, semana) * capConfig.maquinas * oeeFactor;
    },

    // Capacidade de TECELAGEM por modelo de tear × semana (soma máquina-a-máquina com OEE individual,
    // mesma fórmula do TOC _renderStoll). Teares sem modelo entram numa capacidade residual (não alocável,
    // mas somada ao agregado p/ não sumir do Gantt). Devolve { modelos, capTec, nTeares, capResidual, nSemModelo }.
    _capTecPorModelo(semanas, maquinasTec, ov) {
        ov = ov || {};   // simulação: { off:Set(modelos desligados), addTeares:{modelo:n}, fator:{modelo:mult} }
        const porModelo = {};   // modelo → [oeeFrac de cada tear]
        (maquinasTec || []).forEach(m => {
            const modelo = toc._normModelo(m.modelo) || '(sem modelo)';
            if (ov.off && ov.off.has(modelo)) return;   // modelo desligado na simulação
            const oee = m.oee == null ? 100 : Number(m.oee);   // OEE 0 = tear parado (0 capacidade), não 100%
            (porModelo[modelo] = porModelo[modelo] || []).push(Math.min(oee, 100) / 100);
        });
        // teares extras da simulação (usam o OEE médio do modelo, ou 100% se o modelo é novo)
        if (ov.addTeares) Object.entries(ov.addTeares).forEach(([modelo, n]) => {
            if (!n || n <= 0) return;
            const cur = porModelo[modelo] || [];
            const oeeMed = cur.length ? cur.reduce((s, o) => s + o, 0) / cur.length : 1;
            porModelo[modelo] = cur;
            for (let i = 0; i < n; i++) porModelo[modelo].push(oeeMed);
        });
        const modelos = Object.keys(porModelo).filter(m => m !== '(sem modelo)');
        const capTec = {}, nTeares = {};
        modelos.forEach(modelo => {
            const somaOee = porModelo[modelo].reduce((s, o) => s + o, 0);
            const fator = (ov.fator && ov.fator[modelo] > 0) ? ov.fator[modelo] : 1;   // +turno etc.
            capTec[modelo] = semanas.map(s => this._minutosMaqSemana('tecelagem', s) * somaOee * fator);
            nTeares[modelo] = porModelo[modelo].length;
        });
        // teares sem modelo: capacidade real que existe mas não é alocável por modelo
        const semMod = porModelo['(sem modelo)'] || [];
        const somaOeeSM = semMod.reduce((s, o) => s + o, 0);
        const capResidual = semanas.map(s => this._minutosMaqSemana('tecelagem', s) * somaOeeSM);
        return { modelos, capTec, nTeares, capResidual, nSemModelo: semMod.length };
    },

    // Aloca UMA ordem de tecelagem entre os modelos aptos (prazo + equilíbrio). Muta usadoTec/setupUsadoTec/
    // lastFamTec do ctx; devolve o modelo escolhido + as fatias alocadas (o chamador espelha nos agregados).
    // Núcleo compartilhado entre o motor (calcular) e a simulação (_simularMix) — mesma lógica, sem divergir.
    _alocarTecOrdem(aptos, cargaMin, familiaT, startBase, dl, ctx) {
        const { capTec, usadoTec, setupUsadoTec, lastFamTec, nSemanas, nTeares } = ctx;
        const cand = aptos.map(modelo => {
            const usoCopia = usadoTec[modelo].slice();
            const setupMins = this._getSetupMins('tecelagem', lastFamTec[modelo], familiaT);
            let rest = cargaMin, sem = startBase;
            if (setupMins > 0 && sem < nSemanas) usoCopia[sem] += setupMins;
            while (rest > 0 && sem < nSemanas) {
                const disp = capTec[modelo][sem] - usoCopia[sem];
                if (disp > 0) { const a = Math.min(rest, disp); usoCopia[sem] += a; rest -= a; }
                if (rest > 0) sem++;
            }
            const overflow = rest > 0, finish = Math.min(sem, nSemanas - 1);
            const capTot = capTec[modelo].reduce((s, v) => s + v, 0) || 1;
            const usoTot = usoCopia.reduce((s, v) => s + v, 0) + (overflow ? rest : 0);
            return { modelo, overflow, atraso: Math.max(0, finish - dl), utilPct: usoTot / capTot * 100,
                     setupMins, nTeares: (nTeares && nTeares[modelo]) || 0 };
        });
        cand.sort((a, b) => (a.overflow - b.overflow) || (a.atraso - b.atraso) || (a.utilPct - b.utilPct)
                            || (b.nTeares - a.nTeares) || String(a.modelo).localeCompare(String(b.modelo)));
        const esc = cand[0], modelo = esc.modelo;
        const slices = []; let setupSlice = null, rest = cargaMin, sem = startBase;
        if (esc.setupMins > 0 && sem < nSemanas) { usadoTec[modelo][sem] += esc.setupMins; setupUsadoTec[modelo][sem] += esc.setupMins; setupSlice = { sem, mins: esc.setupMins }; }
        while (rest > 0 && sem < nSemanas) {
            const disp = capTec[modelo][sem] - usadoTec[modelo][sem];
            if (disp > 0) { const a = Math.min(rest, disp); usadoTec[modelo][sem] += a; slices.push({ sem, mins: a }); rest -= a; }
            if (rest > 0) sem++;
        }
        lastFamTec[modelo] = familiaT;
        return { modelo, restante: rest, finishSem: sem, slices, setupSlice };
    },

    // Índice da 1ª semana cujo fim já cobre o prazo da ordem (semana-limite). Sem prazo → última.
    _deadlineIdx(ordem, semanas) {
        if (!ordem.data_entrega) return semanas.length - 1;
        const d = new Date(ordem.data_entrega + 'T12:00:00');
        for (let si = 0; si < semanas.length; si++) if (d <= semanas[si].fim) return si;
        return semanas.length - 1;
    },

    _getTempoProc(dados, procId) {
        const proc = toc._PROCS.find(p => p.id === procId);
        if (!proc) return 0;
        return toc._getTempoMinutos(dados, proc.cols);
    },

    // Lookup tolerante a espaços/maiúsculas: colunas do Excel vêm com espaço final (ex: "Segmento ")
    _getCampoFamilia(dados) {
        if (!dados) return '';
        const ALVOS = ['segmento','família','familia'];
        for (const k of Object.keys(dados)) {
            if (ALVOS.includes(k.trim().toLowerCase())) return String(dados[k] ?? '').toLowerCase().trim();
        }
        return '';
    },

    _getFamilia(dados) {
        return this._getCampoFamilia(dados) || 'geral';
    },

    _getSetupMins(procId, familiaAnterior, familiaAtual) {
        if (!familiaAnterior || familiaAnterior === familiaAtual) return 0;
        const row = this._setupMatrix.find(r =>
            r.processo === procId &&
            r.familia_de.toLowerCase() === familiaAnterior.toLowerCase() &&
            r.familia_para.toLowerCase() === familiaAtual.toLowerCase()
        );
        return row ? (row.minutos || 0) : 0;
    },

    // ATCS-style (Apparent Tardiness Cost with Setups): sequência gulosa por um índice composto que
    // combina valor/tempo × urgência de prazo × afinidade de setup (usa a matriz de setup do gargalo).
    // Funde EDD+CPV+SPT e faz o SETUP influenciar a ORDEM, não só ser contabilizado. Ref.: Lee & Pinedo (1997).
    _sequenciarATCS(ordens) {
        const proc = 'tecelagem';  // setup do processo-referência (gargalo típico)
        const setups = (this._setupMatrix || []).filter(r => r.processo === proc).map(r => Number(r.minutos) || 0).filter(v => v > 0);
        const sBar = setups.length ? setups.reduce((s,v)=>s+v,0)/setups.length : 1;
        const hoje = new Date();
        const k1 = 5, k2 = 1;   // lookahead de prazo (× semana) e de setup
        const restante = ordens.slice(), seq = [];
        let lastFam = null;
        while (restante.length) {
            let bestIdx = 0, bestI = -Infinity;
            for (let i = 0; i < restante.length; i++) {
                const o = restante[i];
                const w = Math.max(Number(o.cpv) || 0, 1);            // valor (peso)
                const tUn = this._getTempoProc(o.dados || {}, 'tecelagem');
                const p = Math.max((tUn || 0) * (Number(o.qty) || 1), 1);   // tempo real de gargalo (min), não a qtd
                const dias = o.data_entrega ? (new Date(o.data_entrega+'T12:00:00') - hoje) / 864e5 : 999;
                const urg = Math.exp(-Math.max(0, dias) / (k1 * 7));  // urgência: alta se prazo perto/vencido
                const s = this._getSetupMins(proc, lastFam, this._getFamilia(o.dados || {}));
                const setupF = Math.exp(-s / (k2 * sBar));            // afinidade: alta se mesma família
                const I = (w / p) * urg * setupF;
                if (I > bestI) { bestI = I; bestIdx = i; }
            }
            const esc = restante.splice(bestIdx, 1)[0];
            lastFam = this._getFamilia(esc.dados || {});
            seq.push(esc);
        }
        return seq;
    },

    _buildOrdens(fonte, mesSel, prioridade) {
        const ordens = [];
        const bancoMap = {};
        banco.rawData.forEach(r => {
            const cod = String(r.dados?.['Código']||'').trim().toUpperCase();
            if (cod) bancoMap[cod] = r.dados;
        });

        if (fonte === 'plano' || fonte === 'ambos') {
            Object.entries(planoProducao._plano).forEach(([k, qty]) => {
                if (!qty) return;
                const [mes, ...rest] = k.split('_');
                const codigo = rest.join('_');
                if (mesSel && mes !== mesSel) return;
                const dados = bancoMap[codigo];
                const f = previsao._forecast.find(r=>r.codigo===codigo&&r.mes===mes);
                const dt = this._datas[codigo];
                ordens.push({ codigo, qty, mes, dados, label: f?.descricao||codigo, emissao: mes, cpv: dt?.cpv||0, data_entrega: dt?.data_entrega||null, fonte: 'plano' });
            });
        }

        if (fonte === 'op' || fonte === 'ambos') {
            if (!op.rawData.length) {
                // sem dados importados — não gera erro aqui, calcular() vai detectar
            } else if (!op._colRef || !op._colQtd) {
                mostrarToast('OP importada mas colunas Referência/Qtd não mapeadas — reimporte o arquivo.', 'aviso');
            } else {
                // dd/mm/aaaa → aaaa-mm-dd (formato interno de data_entrega)
                const parseBR = s => {
                    const m = String(s||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);
                    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
                };
                const TERMOS_FECHADA = ['encerr','cancel','conclu','fechad','finaliz','entreg','baixad','atendid'];
                op.rawData.forEach(r => {
                    // Exclui apenas OPs visivelmente encerradas/canceladas; aceita todo o resto
                    const st = String(r.dados?.Status || r.dados?.status || r.dados?.Situação || r.dados?.situacao || '').toLowerCase();
                    if (st && TERMOS_FECHADA.some(t => st.includes(t))) return;
                    const codigo = String(r.dados?.[op._colRef]||'').trim().toUpperCase();
                    const qty    = toNumBR(r.dados?.[op._colQtd]);
                    if (!codigo || !qty) return;
                    const dados   = bancoMap[codigo];
                    const emissao = r.dados?.['Emissão'] || r.dados?.['Emissao'] || '';
                    const nop     = r.dados?.['N. OP'] || r.dados?.['NOP'] || '';
                    const dt      = this._datas[codigo];
                    // Prazo: op-datas manual tem prioridade; senão usa Previsão Final do relatório ERP
                    const prazo   = dt?.data_entrega || parseBR(r.dados?.['Prev. Final']) || null;
                    ordens.push({ codigo, qty, mes: '', dados, label: r.dados?.['Descrição']||r.dados?.['Descricao']||codigo, emissao, nop, cpv: dt?.cpv||0, data_entrega: prazo, fonte: 'op' });
                });
            }
        }

        if (prioridade === 'fifo') {
            ordens.sort((a,b) => String(a.emissao).localeCompare(String(b.emissao)) || String(a.nop||'').localeCompare(String(b.nop||'')));
        } else if (prioridade === 'qty') {
            ordens.sort((a,b) => b.qty - a.qty);
        } else if (prioridade === 'cpv') {
            ordens.sort((a,b) => b.cpv - a.cpv);
        } else if (prioridade === 'edd') {
            ordens.sort((a,b) => {
                if (!a.data_entrega && !b.data_entrega) return String(a.emissao).localeCompare(String(b.emissao));
                if (!a.data_entrega) return 1;
                if (!b.data_entrega) return -1;
                return a.data_entrega.localeCompare(b.data_entrega);
            });
        } else if (prioridade === 'atcs') {
            return this._sequenciarATCS(ordens);
        }
        return ordens;
    },

    async calcular() {
        // Garante dados carregados do Supabase antes de checar
        if (!banco.rawData.length) {
            this._showEmpty('Carregando Banco de Dados...');
            await banco.carregarHistorico().catch(() => {});
        }
        if (!op.rawData.length) {
            await op.carregarHistorico().catch(() => {});
        }

        const faltando = [];
        if (!banco.rawData.length)           faltando.push('Banco de Dados (Configuração › Banco de Dados)');
        if (!op.rawData.length && !Object.keys(planoProducao._plano||{}).length)
                                              faltando.push('OP ou Plano de Produção (Importação › OP)');
        if (faltando.length) {
            const msg = '⚠ Para calcular, importe primeiro:\n\n' + faltando.map((f,i) => `${i+1}. ${f}`).join('\n');
            this._showEmpty(msg.replace(/\n/g,'<br>'));
            this._selecionarAba('gantt');
            mostrarToast('Dados necessários não importados — veja o painel abaixo.', 'erro');
            return;
        }
        if (!toc._feriadosCache) await toc._calcDiasUteisDoMes(new Date().toISOString().slice(0,7));
        if (!toc._capCache) await toc._loadCapConfig().catch(() => {}); // capacidade central (servidor/cadastro)
        toc._maquinasTec = null;                                  // invalida cache: reflete cadastro atualizado de teares
        const maquinasTec = await toc._loadMaquinasTecelagem().catch(() => []);  // teares {modelo, oee} p/ alocação por modelo

        // Fonte 'plano' sem plano salvo mas com OP importada: troca automaticamente para OP
        const fonteEl = document.getElementById('tl-fonte');
        if (fonteEl?.value === 'plano' && !Object.keys(planoProducao._plano||{}).length && op.rawData.length) {
            fonteEl.value = 'op';
            mostrarToast('Sem Plano de Produção salvo — usando OP Abertas como fonte.', 'aviso');
        }

        const fonte      = document.getElementById('tl-fonte')?.value || 'plano';
        const mesSel     = document.getElementById('tl-mes-sel')?.value || '';
        const prioridade = document.getElementById('tl-prioridade')?.value || 'fifo';
        const nSemanas   = parseInt(document.getElementById('tl-horizonte')?.value) || 6;
        const startStr   = document.getElementById('tl-start-date')?.value || new Date().toISOString().slice(0,10);
        const modo       = document.getElementById('tl-modo')?.value || 'forward';


        const semanas = this._gerarSemanas(new Date(startStr+'T12:00:00'), nSemanas);
        const prioEfetiva = (modo === 'backward' && prioridade === 'fifo') ? 'edd' : prioridade;
        const ordens  = this._buildOrdens(fonte, mesSel, prioEfetiva);

        if (!ordens.length) {
            const motivo = (fonte === 'op' || fonte === 'ambos') && !op.rawData.length
                ? 'Nenhuma OP importada — vá em OP e importe o arquivo.'
                : fonte === 'plano' && !Object.keys(planoProducao._plano).length
                ? 'Nenhum Plano de Produção salvo — vá em Plano de Produção e salve o plano.'
                : 'Nenhuma ordem encontrada. Verifique a fonte e o mês selecionado.';
            mostrarToast(motivo, 'erro');
            this._showEmpty(motivo);
            return;
        }

        // Avisa se há ordens sem correspondência no banco
        const semBanco = ordens.filter(o => !o.dados).length;
        if (semBanco > 0 && semBanco === ordens.length) {
            mostrarToast(`Nenhum SKU das ordens tem dados no Banco — verifique se os códigos batem.`, 'erro');
            this._showEmpty(`${semBanco} ordens encontradas, mas nenhuma tem código correspondente no Banco de Dados.\nCódigos das OPs precisam existir no arquivo do Banco.`);
            return;
        }
        if (semBanco > 0) mostrarToast(`${semBanco} ordens sem dados no banco (códigos não encontrados) — ignoradas no Gantt.`, 'aviso');

        const cap = {};
        this._SEQ.forEach(pid => { cap[pid] = semanas.map(s => this._capSemana(pid, s)); });

        // ── ALOCAÇÃO DA TECELAGEM POR MODELO DE TEAR ──────────────────────────────
        // A tecelagem deixa de ser um balde único: cada modelo (530/330/303) tem sua capacidade,
        // e o motor ESCOLHE em qual tear apto colocar cada OP (prazo + equilíbrio de carga).
        // cap['tecelagem'] passa a ser a SOMA dos modelos (Gantt continua consolidado).
        const { modelos: modelosTec, capTec, nTeares: nTearesTec, capResidual: capResidualTec, nSemModelo: nSemModeloTec } = this._capTecPorModelo(semanas, maquinasTec);
        const temAlocModelo = modelosTec.length > 0;
        // Agregado do Gantt = Σ modelos + capacidade dos teares sem modelo (existe fisicamente, só não é alocável)
        if (temAlocModelo) cap['tecelagem'] = semanas.map((s, si) => modelosTec.reduce((t, m) => t + capTec[m][si], 0) + (capResidualTec[si] || 0));
        const usadoTec = {}, detalheTec = {}, setupUsadoTec = {}, lastFamTec = {};
        modelosTec.forEach(m => {
            usadoTec[m]      = new Array(nSemanas).fill(0);
            detalheTec[m]    = Array.from({length:nSemanas}, ()=>[]);
            setupUsadoTec[m] = new Array(nSemanas).fill(0);
            lastFamTec[m]    = null;
        });
        const ordemModelo = {};   // oi → modelo alocado (p/ ver o mix e o status)
        const semModeloOrdens = []; // OPs com tecelagem mas sem tear apto (pendência visível, não aloca)

        const usado      = {};
        const detalhe    = {};
        const setupUsado = {};
        this._SEQ.forEach(pid => {
            usado[pid]      = new Array(nSemanas).fill(0);
            detalhe[pid]    = Array.from({length:nSemanas}, ()=>[]);
            setupUsado[pid] = new Array(nSemanas).fill(0);
        });

        // Backward mode: estima semana de início mais tarde possível por ordem
        const firstAvailSem = {};
        if (modo === 'backward') {
            ordens.forEach((ordem, oi) => {
                const id = `${ordem.codigo}_${oi}`;
                if (!ordem.data_entrega) { firstAvailSem[id] = 0; return; }
                const entregaDate = new Date(ordem.data_entrega + 'T12:00:00');
                let deadlineIdx = semanas.length - 1;
                for (let si = 0; si < semanas.length; si++) {
                    if (entregaDate <= semanas[si].fim) { deadlineIdx = si; break; }
                }
                let totalDias = 0;
                this._SEQ.forEach(pid => {
                    if (!ordem.dados) return;
                    const tempoUn = this._getTempoProc(ordem.dados, pid);
                    if (!tempoUn) return;
                    let minsPerDay;
                    if (pid === 'tecelagem' && temAlocModelo) {
                        // usa a capacidade real dos teares aptos da OP (não a agregada) — OP de modelo restrito leva mais dias
                        const aptos = toc._getModelosStoll(ordem.dados).filter(m => modelosTec.includes(m));
                        const capDia = aptos.reduce((s, m) => s + (capTec[m][deadlineIdx] || 0), 0) / 5;
                        minsPerDay = capDia > 0 ? capDia : (cap['tecelagem'][deadlineIdx] || 0) / 5;
                    } else {
                        const capConf = toc._getCap()[pid] || { maquinas:1, horasDia:8, oee:100 };
                        minsPerDay = capConf.maquinas * capConf.horasDia * 60 * ((capConf.oee||100)/100);
                    }
                    if (minsPerDay > 0) totalDias += Math.ceil((tempoUn * ordem.qty) / minsPerDay);
                });
                firstAvailSem[id] = Math.max(0, deadlineIdx - Math.ceil(totalDias / 5));
            });
        }

        // Fase 6: desconto de produção apontada APOSENTADO — era cross-domain (descontava órtese × OPs
        // de malha do MES legado /api/mes). A fábrica de malha aponta no MES Malha Forte (mes.html);
        // o realizado correto entra pelo Plano de Produção (Chão→Plano).
        const minutosProduzidos = 0;

        const finishSem  = {};
        const lastFamilia = {};
        let totalOrdens = 0, totalMinutos = 0, minutosOverflow = 0;

        ordens.forEach((ordem, oi) => {
            const id = `${ordem.codigo}_${oi}`;
            finishSem[id] = {};
            let anteriorFim = 0;

            this._SEQ.forEach(pid => {
                if (!ordem.dados) return;
                const tempoUn = this._getTempoProc(ordem.dados, pid);
                if (!tempoUn) return;

                const qtyRest = ordem.qty;  // Fase 6: sem desconto do MES legado (ver nota acima)
                if (qtyRest <= 0) {
                    // Processo já concluído no chão de fábrica — não ocupa capacidade nem atrasa a cadeia
                    finishSem[id][pid] = anteriorFim;
                    return;
                }

                // ── TECELAGEM: modelo de alocação (escolhe o tear apto: prazo + equilíbrio) ──
                if (pid === 'tecelagem' && temAlocModelo) {
                    const declarados = toc._getModelosStoll(ordem.dados);
                    const aptos = declarados.filter(m => modelosTec.includes(m));
                    const cargaMin = tempoUn * qtyRest;
                    totalMinutos += cargaMin;
                    const familiaT = this._getFamilia(ordem.dados);
                    let forceStartT = this._manualOverrides[`${ordem.codigo}_${pid}`];
                    if (forceStartT !== undefined) forceStartT = Math.min(Math.max(forceStartT, anteriorFim), nSemanas - 1);
                    const startBase = forceStartT !== undefined ? forceStartT : Math.max(anteriorFim, firstAvailSem[id] || 0);
                    const dl = this._deadlineIdx(ordem, semanas);

                    if (!aptos.length) {   // sem tear apto declarado → pendência visível, não aloca; cadeia segue
                        ordem._semModelo = true;
                        const motivo = declarados.length
                            ? `modelo ${declarados.join('/')} sem tear cadastrado`
                            : 'coluna Stoll vazia';
                        semModeloOrdens.push({ codigo: ordem.codigo, label: ordem.label, qty: qtyRest, mins: cargaMin, data_entrega: ordem.data_entrega, motivo });
                        finishSem[id][pid] = startBase;
                        anteriorFim = startBase;
                        return;
                    }

                    // Escolhe o tear e aloca (helper compartilhado com a simulação), depois espelha no agregado do Gantt
                    const res = this._alocarTecOrdem(aptos, cargaMin, familiaT, startBase, dl,
                        { capTec, usadoTec, setupUsadoTec, lastFamTec, nSemanas, nTeares: nTearesTec });
                    const modelo = res.modelo;
                    if (res.setupSlice) { usado[pid][res.setupSlice.sem] += res.setupSlice.mins; setupUsado[pid][res.setupSlice.sem] += res.setupSlice.mins; }
                    res.slices.forEach(sl => {
                        usado[pid][sl.sem] += sl.mins;
                        const entry = { codigo: ordem.codigo, label: ordem.label, qty: qtyRest, nop: ordem.nop || '', mins: sl.mins, fonte: ordem.fonte, data_entrega: ordem.data_entrega, cpv: ordem.cpv, modelo };
                        detalheTec[modelo][sl.sem].push(entry); detalhe[pid][sl.sem].push(entry);
                    });
                    if (res.restante > 0) { ordem._overflow = true; ordem._overflowTec = true; minutosOverflow += res.restante; }
                    ordemModelo[oi] = modelo;
                    finishSem[id][pid] = res.finishSem;
                    anteriorFim = res.finishSem;
                    return;
                }

                const overrideKey = `${ordem.codigo}_${pid}`;
                let   forceStart  = this._manualOverrides[overrideKey];
                // Override não pode violar precedência (costura antes da tecelagem) nem cair fora do horizonte
                if (forceStart !== undefined) forceStart = Math.min(Math.max(forceStart, anteriorFim), nSemanas - 1);
                const familia     = this._getFamilia(ordem.dados);
                const setupMins   = this._getSetupMins(pid, lastFamilia[pid], familia);

                let minRestante = tempoUn * qtyRest;
                totalMinutos   += minRestante;
                let semIdx = forceStart !== undefined ? forceStart : Math.max(anteriorFim, firstAvailSem[id] || 0);

                // Debita setup na semana de início
                if (setupMins > 0 && semIdx < nSemanas) {
                    usado[pid][semIdx]      += setupMins;
                    setupUsado[pid][semIdx] += setupMins;
                }

                while (minRestante > 0 && semIdx < nSemanas) {
                    const disp = cap[pid][semIdx] - usado[pid][semIdx];
                    if (disp > 0) {
                        const alocado = Math.min(minRestante, disp);
                        usado[pid][semIdx] += alocado;
                        detalhe[pid][semIdx].push({ codigo: ordem.codigo, label: ordem.label, qty: qtyRest, nop: ordem.nop || '', mins: alocado, fonte: ordem.fonte, data_entrega: ordem.data_entrega, cpv: ordem.cpv });
                        minRestante -= alocado;
                    }
                    if (minRestante > 0) semIdx++;
                }
                if (minRestante > 0) {           // não coube no horizonte
                    ordem._overflow = true;
                    minutosOverflow += minRestante;
                }
                finishSem[id][pid] = semIdx;
                lastFamilia[pid]   = familia;
                anteriorFim        = semIdx;
            });
            totalOrdens++;
        });

        const statusOrdens = this._calcStatusOrdens(ordens, finishSem, semanas);
        const tecMix = temAlocModelo ? { modelos: modelosTec, capTec, usadoTec, detalheTec, setupUsadoTec, ordemModelo, semModelo: semModeloOrdens, nTeares: nTearesTec, nSemModelo: nSemModeloTec, capResidual: capResidualTec } : null;
        this._resultado = { semanas, cap, usado, detalhe, setupUsado, ordens, finishSem, statusOrdens, totalOrdens, totalMinutos, minutosOverflow, minutosProduzidos, modo, tecMix };
        this._renderGantt();
        if (this._abaAtiva === 'status') this._renderStatus();
        if (this._abaAtiva === 'mix') this._renderMix();
        if (this._abaAtiva === 'sim') this._renderSimulacao();
        if (minutosOverflow > 0) {
            const nOver = ordens.filter(o => o._overflow).length;
            mostrarToast(`${nOver} orden${nOver>1?'s':''} (${(minutosOverflow/60).toFixed(0)}h) não couberam em ${nSemanas} semanas — aumente o horizonte.`, 'aviso');
        }
    },

    // Mapeia o nome livre do processo do MES (cadastro) para o id fixo da sequência
    _procTextoParaId(txt) {
        const n = String(txt || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (n.includes('tecel'))    return 'tecelagem';
        if (n.includes('costura'))  return n.includes('autom') ? 'costura_auto' : 'costura_manual';
        if (n.includes('solda'))    return 'soldagem';
        if (n.includes('silicone')) return 'silicone';
        if (n.includes('passad'))   return 'passadoria';
        if (n.includes('embal'))    return 'embalagem';
        return null;
    },

    _calcStatusOrdens(ordens, finishSem, semanas) {
        const status = {};
        ordens.forEach((ordem, oi) => {
            const id = `${ordem.codigo}_${oi}`;
            const fs = finishSem[id] || {};
            const vals = Object.values(fs);
            const lastSemIdx = vals.length ? Math.max(...vals) : 0;
            const estourou   = ordem._overflow || lastSemIdx >= semanas.length;
            // Lint: código com dados mas SEM nenhum tempo-padrão em processo algum → não dá pra sequenciar
            const semTempo = ordem.dados && this._SEQ.every(pid => !this._getTempoProc(ordem.dados, pid));
            const finishDate = (estourou || ordem._semModelo || semTempo) ? null : semanas[lastSemIdx]?.fim;
            let s = 'nodate';
            if (semTempo) {
                s = 'semtempo'; // dado mestre faltando — bloqueia o planejamento, nunca "no prazo"
            } else if (ordem._semModelo) {
                s = 'semtear'; // tem tecelagem mas nenhum tear apto — pendência, nunca "no prazo"
            } else if (estourou) {
                s = 'overflow'; // não cabe no horizonte — sem data falsa
            } else if (ordem.data_entrega && finishDate) {
                const deadline = new Date(ordem.data_entrega + 'T12:00:00');
                const diff = (deadline - finishDate) / (1000*60*60*24);
                s = diff < 0 ? 'late' : diff < 7 ? 'risk' : 'ok';
            }
            status[id] = { ...ordem, lastSemIdx, finishDate, status: s };
        });
        return status;
    },

    _showEmpty(msg) {
        const wrap = document.getElementById('tl-gantt-wrap');
        if (!wrap) return;
        // Preserva tl-empty no DOM — não limpar antes de usar a referência
        wrap.innerHTML = `<div id="tl-empty" style="padding:32px;text-align:center;color:var(--text-dim);font-size:.85rem;line-height:1.8;">${msg}</div>`;
    },

    _renderGantt() {
        const r = this._resultado;
        if (!r) return;
        const { semanas, cap, usado, detalhe, setupUsado } = r;
        const wrap  = document.getElementById('tl-gantt-wrap');
        const empty = document.getElementById('tl-empty');
        if (empty) empty.style.display = 'none';

        const lateCount = Object.values(r.statusOrdens).filter(s=>s.status==='late').length;
        const riskCount = Object.values(r.statusOrdens).filter(s=>s.status==='risk').length;
        const sumEl = document.getElementById('tl-summary');
        if (sumEl) {
            let txt = `${r.totalOrdens} ordens · ${(r.totalMinutos/60).toFixed(0)}h carga${r.modo==='backward'?' · EDD':''}`;
            if (r.minutosProduzidos > 0) txt += ` · <span style="color:#26a69a;">−${(r.minutosProduzidos/60).toFixed(0)}h já produzidas (MES)</span>`;
            if (r.minutosOverflow > 0) txt += ` · <span style="color:#ff5252;font-weight:700;">${(r.minutosOverflow/60).toFixed(0)}h fora do horizonte</span>`;
            if (lateCount) txt += ` · <span style="color:#f06292;display:inline-flex;align-items:center;gap:4px;">${DOT.red} ${lateCount} atrasada${lateCount>1?'s':''}</span>`;
            if (riskCount) txt += ` · <span style="color:#ffca28;display:inline-flex;align-items:center;gap:4px;">${DOT.yellow} ${riskCount} em risco</span>`;
            sumEl.innerHTML = txt;
        }

        const procsAtivos = toc._PROCS.filter(p => this._SEQ.includes(p.id) && semanas.some((_,i) => usado[p.id]?.[i] > 0));

        if (!procsAtivos.length) {
            if (empty) { empty.textContent = `${r.totalOrdens} ordens carregadas, mas nenhum processo com carga calculada.\nVerifique se os SKUs têm tempos de processo cadastrados no Banco de Dados.`; empty.style.display = ''; }
            return;
        }

        let html = `<table style="width:100%;border-collapse:collapse;min-width:${160+semanas.length*140}px;">
        <thead><tr style="border-bottom:2px solid var(--border-color);">
            <th style="padding:12px 16px;text-align:left;font-size:.72rem;color:var(--text-dim);letter-spacing:.07em;min-width:160px;white-space:nowrap;">PROCESSO</th>`;
        semanas.forEach(s => {
            const du = this._diasUteisSemana(s.ini, s.fim);
            const congelada = s.idx < this._timeFence;
            html += `<th style="padding:10px 8px;text-align:center;font-size:.72rem;color:var(--text-dim);letter-spacing:.06em;min-width:130px;${congelada?'background:rgba(99,102,241,.08);border-bottom:2px solid var(--indigo-primary);':''}">
                <div>${congelada?'🔒 ':''}SEM ${s.idx+1}</div><div style="font-weight:400;font-size:.68rem;opacity:.7;">${s.label}</div>
                <div style="font-weight:400;font-size:.65rem;color:${congelada?'var(--indigo-primary)':(du<5?'#f06292':'var(--text-dim)')};">${congelada?'congelada':du+'d úteis'}</div></th>`;
        });
        html += `<th style="padding:10px 8px;text-align:center;font-size:.72rem;color:var(--text-dim);min-width:80px;">TOTAL</th></tr></thead><tbody>`;

        procsAtivos.forEach((proc, pi) => {
            const bg = pi%2 ? 'var(--bg-input)' : 'transparent';
            const totalCargaH = semanas.reduce((s,_,i)=>s+(usado[proc.id]?.[i]||0),0)/60;
            const totalCapH   = semanas.reduce((s,_,i)=>s+(cap[proc.id]?.[i]||0),0)/60;
            const pctGeral    = totalCapH>0 ? totalCargaH/totalCapH*100 : 0;
            const corGeral    = pctGeral>=100?'#f06292':pctGeral>=70?'#ffca28':'#26a69a';
            const oeeVal      = toc._getCap()[proc.id]?.oee ?? 100;

            html += `<tr style="background:${bg};border-bottom:1px solid rgba(255,255,255,.05);">
                <td style="padding:12px 16px;">
                    <div style="font-size:.85rem;font-weight:700;">${proc.nome}</div>
                    <div style="font-size:.68rem;color:var(--text-dim);margin-top:2px;">${totalCargaH.toFixed(0)}h / ${totalCapH.toFixed(0)}h cap · OEE ${oeeVal}%</div>
                </td>`;

            semanas.forEach((s, si) => {
                const cargaMin = usado[proc.id]?.[si]      || 0;
                const capMin   = cap[proc.id]?.[si]        || 0;
                const setupMin = setupUsado[proc.id]?.[si] || 0;
                const diasU    = this._diasUteisSemana(s.ini, s.fim);
                const pct      = capMin > 0 ? cargaMin/capMin*100 : 0;
                const cor      = pct>=100?'#f06292':pct>=70?'#ffca28':'#26a69a';
                const nSkus    = detalhe[proc.id]?.[si]?.length || 0;

                if (!capMin || !diasU) {
                    html += `<td style="padding:8px;text-align:center;" data-proc="${proc.id}" data-sem="${si}"
                        ondragover="event.preventDefault();this.style.outline='2px dashed var(--indigo-primary)';"
                        ondragleave="this.style.outline='';" ondrop="preactor._onDropCell(event,'${proc.id}',${si})">
                        <div style="background:repeating-linear-gradient(45deg,rgba(255,255,255,.03),rgba(255,255,255,.03) 3px,transparent 3px,transparent 9px);border-radius:6px;padding:10px 4px;border:1px solid rgba(255,255,255,.06);">
                            <div style="font-size:.65rem;color:var(--text-dim);">sem cap.</div>
                        </div></td>`;
                    return;
                }

                const barW = Math.min(pct, 100);
                html += `<td style="padding:6px 8px;cursor:${nSkus?'pointer':'default'};"
                    data-proc="${proc.id}" data-sem="${si}"
                    ondragover="event.preventDefault();this.style.outline='2px dashed var(--indigo-primary)';"
                    ondragleave="this.style.outline='';" ondrop="preactor._onDropCell(event,'${proc.id}',${si})"
                    ${nSkus?`onclick="preactor._abrirDetalhe('${proc.id}',${si})"`:''}
                    title="${nSkus} SKUs · ${cargaMin.toFixed(0)}min/${capMin.toFixed(0)}min cap${setupMin?` · setup ${setupMin.toFixed(0)}min`:''}">
                    <div style="background:var(--bg-card);border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,.07);padding:8px 10px;">
                        <div style="width:100%;height:5px;background:rgba(255,255,255,.08);border-radius:3px;margin-bottom:6px;overflow:hidden;position:relative;">
                            <div style="width:${barW}%;height:100%;background:${cor};border-radius:3px;transition:.3s;"></div>
                            ${setupMin>0?`<div style="position:absolute;right:0;top:0;width:${Math.min(setupMin/capMin*100,30)}%;height:100%;background:#ff9800;opacity:.7;"></div>`:''}
                        </div>
                        <div style="font-size:.82rem;font-weight:800;color:${cor};">${cargaMin?pct.toFixed(0)+'%':'—'}</div>
                        ${nSkus?`<div style="font-size:.65rem;color:var(--text-dim);margin-top:2px;">${nSkus} SKU${nSkus>1?'s':''}</div>`:''}
                        ${setupMin>0?`<div style="font-size:.6rem;color:#ff9800;display:flex;align-items:center;gap:3px;">${DOT.gear} ${(setupMin/60).toFixed(1)}h setup</div>`:''}
                        ${pct>100?`<div style="font-size:.62rem;color:#f06292;font-weight:700;">+${(pct-100).toFixed(0)}% extra</div>`:''}
                    </div></td>`;
            });

            html += `<td style="padding:6px 8px;text-align:center;">
                <div style="background:var(--bg-card);border-radius:6px;padding:8px 10px;border:1px solid rgba(255,255,255,.07);">
                    <div style="font-size:.82rem;font-weight:800;color:${corGeral};">${pctGeral.toFixed(0)}%</div>
                    <div style="font-size:.65rem;color:var(--text-dim);">${totalCargaH.toFixed(0)}h</div>
                </div></td></tr>`;
        });

        html += `<tr style="border-top:2px solid var(--border-color);">
            <td style="padding:10px 16px;font-size:.72rem;color:var(--text-dim);">DIAS ÚTEIS</td>`;
        semanas.forEach(s => {
            const du = this._diasUteisSemana(s.ini, s.fim);
            html += `<td style="padding:8px;text-align:center;"><div style="font-size:.78rem;font-weight:700;color:${du<5?'#f06292':'var(--text-dim)'};">${du} / 5</div></td>`;
        });
        html += `<td></td></tr></tbody></table>`;
        wrap.innerHTML = html;
    },

    // ── MIX POR TEAR: mix de produção por modelo Stoll + restrição do mix + o que não coube ──
    _renderMix() {
        const wrap = document.getElementById('tl-mix-conteudo');
        if (!wrap) return;
        const r = this._resultado;
        if (!r) { wrap.innerHTML = '<p style="color:var(--text-dim);padding:20px;">Calcule a linha do tempo primeiro.</p>'; return; }
        const mix = r.tecMix;
        if (!mix || !mix.modelos.length) {
            wrap.innerHTML = `<div class="summary-card" style="color:#ffca28;padding:16px;font-size:.85rem;">Nenhum tear cadastrado com modelo em <strong>Configuração › Processos (Tecelagem)</strong> — a tecelagem está usando capacidade agregada (balde único), sem alocação por modelo. Cadastre os teares (modelo 530/330/303 + OEE) para ativar o mix por tear.</div>`;
            return;
        }
        const semanas = r.semanas;
        const cor = u => u >= 1 ? '#f06292' : u >= 0.8 ? '#ffca28' : '#26a69a';
        const kpi = (c, v, l) => `<div style="background:${c}18;border:1px solid ${c}44;border-radius:8px;padding:12px 20px;min-width:150px;text-align:center;">
            <div style="font-size:1.5rem;font-weight:800;color:${c};">${v}</div>
            <div style="font-size:.66rem;color:${c};letter-spacing:.05em;">${l}</div></div>`;

        const linhas = mix.modelos.map(m => {
            const capT = mix.capTec[m].reduce((s, v) => s + v, 0);
            const usoT = mix.usadoTec[m].reduce((s, v) => s + v, 0);
            const nOps = new Set(mix.detalheTec[m].flat().map(e => e.codigo)).size;
            return { m, capT, usoT, util: capT > 0 ? usoT / capT : (usoT > 0 ? Infinity : 0), nOps };
        }).sort((a, b) => (b.util === Infinity ? 9e9 : b.util) - (a.util === Infinity ? 9e9 : a.util));

        const gargalo   = linhas[0];
        const capGeral  = linhas.reduce((s, l) => s + l.capT, 0);
        const usoGeral  = linhas.reduce((s, l) => s + l.usoT, 0);
        const utilGeral = capGeral > 0 ? usoGeral / capGeral : 0;
        const ociosoH   = linhas.reduce((s, l) => s + Math.max(0, l.capT - l.usoT), 0) / 60;
        const naoCoube  = r.ordens.filter(o => o._overflowTec);
        const semModelo = mix.semModelo || [];
        const nNaoAloc  = naoCoube.length + semModelo.length;

        let html = `<div style="display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
            ${kpi('#26c6da', (utilGeral * 100).toFixed(0) + '%', 'UTIL. MÉDIA TECELAGEM')}
            ${kpi(cor(gargalo.util), gargalo.util === Infinity ? '∞' : (gargalo.util * 100).toFixed(0) + '%', 'GARGALO: STOLL ' + escHTML(gargalo.m))}
            ${kpi('#8b949e', ociosoH.toLocaleString('pt-BR', {maximumFractionDigits:0}) + 'h', 'CAPACIDADE OCIOSA')}
            ${kpi(nNaoAloc ? '#ff5252' : '#26a69a', nNaoAloc, 'OPs NÃO ALOCADAS')}
        </div>`;

        if (mix.nSemModelo) {
            const hRes = (mix.capResidual || []).reduce((s, v) => s + v, 0) / 60;
            html += `<div style="display:flex;align-items:flex-start;gap:8px;padding:9px 12px;margin-bottom:14px;background:rgba(255,202,40,.08);border:1px solid rgba(255,202,40,.35);border-radius:8px;font-size:.74rem;color:#ffca28;">
                <span>⚠</span><span><strong>${mix.nSemModelo} tear(es) sem modelo cadastrado</strong> (${hRes.toLocaleString('pt-BR',{maximumFractionDigits:0})}h) — contam na capacidade total mas não recebem OP por modelo. Preencha o modelo em Configuração › Processos para incluí-los no mix.</span></div>`;
        }

        // Heatmap tear × semana (ocupação %)
        html += `<div class="summary-card" style="padding:0;overflow:auto;margin-bottom:16px;">
            <div class="s-label" style="padding:12px 14px 4px;">MIX POR TEAR × SEMANA — ocupação (carga ÷ capacidade)</div>
            <table style="width:100%;border-collapse:collapse;font-size:.78rem;">
            <thead><tr style="border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 12px;text-align:left;color:var(--text-dim);font-size:.66rem;">TEAR</th>
                ${semanas.map(s => `<th style="padding:8px 6px;text-align:center;color:var(--text-dim);font-size:.62rem;">${escHTML(s.label || '')}</th>`).join('')}
                <th style="padding:8px 12px;text-align:right;color:var(--text-dim);font-size:.66rem;">TOTAL</th>
            </tr></thead><tbody>`;
        linhas.forEach(l => {
            const cells = semanas.map((s, si) => {
                const c = mix.capTec[l.m][si], u = mix.usadoTec[l.m][si];
                const util = c > 0 ? u / c : (u > 0 ? Infinity : 0);
                const pct = util === Infinity ? '∞' : Math.round(util * 100) + '%';
                const cc = util === 0 ? 'var(--text-dim)' : cor(util);
                const bg = util === 0 ? 'transparent' : `${cc}22`;
                return `<td style="padding:6px 4px;text-align:center;background:${bg};color:${cc};font-weight:${util>=0.8?'700':'400'};" title="${(u/60).toFixed(1)}h de ${(c/60).toFixed(1)}h">${pct}</td>`;
            }).join('');
            html += `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:7px 12px;font-weight:700;color:var(--text-primary);white-space:nowrap;">Stoll ${escHTML(l.m)} <span style="font-size:.62rem;color:var(--text-dim);font-weight:400;">· ${mix.nTeares[l.m]||0} máq · ${l.nOps} OPs</span></td>
                ${cells}
                <td style="padding:7px 12px;text-align:right;font-weight:800;color:${l.util===Infinity?'#ff5252':cor(l.util)};">${l.util===Infinity?'∞':Math.round(l.util*100)+'%'}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;

        // Restrição do mix: barras de utilização por modelo (estilo do TOC)
        html += `<div class="summary-card" style="margin-bottom:16px;"><div class="s-label" style="margin-bottom:10px;">RESTRIÇÃO DO MIX — utilização por tear</div>`;
        linhas.forEach(l => {
            const pct = l.util === Infinity ? 100 : l.util * 100;
            const c = cor(l.util);
            const lbl = l.util >= 1 ? 'GARGALO' : l.util >= 0.8 ? 'ATENÇÃO' : 'OK';
            html += `<div style="display:flex;align-items:center;gap:14px;padding:8px 0;border-bottom:1px solid var(--border-color);">
                <div style="width:150px;font-size:.82rem;font-weight:600;color:var(--text-primary);">Stoll ${escHTML(l.m)}
                    <span style="font-size:.66rem;color:var(--text-dim);font-weight:400;">· ${mix.nTeares[l.m]||0} máq</span></div>
                <div style="flex:1;height:10px;background:var(--bg-input);border-radius:5px;overflow:hidden;"><div style="width:${Math.min(pct/1.5,100)}%;height:100%;background:${c};border-radius:5px;"></div></div>
                <div style="width:56px;text-align:right;font-size:.82rem;font-weight:700;color:${c};">${l.util===Infinity?'∞':pct.toFixed(0)+'%'}</div>
                <div style="width:66px;text-align:right;font-size:.68rem;font-weight:700;color:${c};">${lbl}</div>
                <div style="width:120px;text-align:right;font-size:.7rem;color:var(--text-dim);">${(l.usoT/60).toFixed(0)}h / ${(l.capT/60).toFixed(0)}h · ${(Math.max(0,l.capT-l.usoT)/60).toFixed(0)}h livre</div>
            </div>`;
        });
        html += `</div>`;

        // O que não coube / sem tear apto
        if (nNaoAloc) {
            html += `<div class="summary-card"><div class="s-label" style="margin-bottom:8px;color:#ff5252;">NÃO ALOCADAS (${nNaoAloc}) — revisar</div>
                <table style="width:100%;border-collapse:collapse;font-size:.78rem;"><tbody>`;
            semModelo.forEach(o => {
                html += `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                    <td style="padding:6px 10px;font-weight:600;color:var(--indigo-primary);">${escHTML(o.codigo)}</td>
                    <td style="padding:6px 10px;">${escHTML((o.label||'').slice(0,32))}</td>
                    <td style="padding:6px 10px;text-align:right;">${(o.qty||0).toLocaleString('pt-BR')}</td>
                    <td style="padding:6px 10px;text-align:right;color:var(--text-dim);">${(o.mins/60).toFixed(1)}h</td>
                    <td style="padding:6px 10px;color:#ffca28;font-size:.72rem;">${escHTML(o.motivo || 'sem tear apto')}</td></tr>`;
            });
            naoCoube.forEach(o => {
                html += `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                    <td style="padding:6px 10px;font-weight:600;color:var(--indigo-primary);">${escHTML(o.codigo)}</td>
                    <td style="padding:6px 10px;">${escHTML((o.label||'').slice(0,32))}</td>
                    <td style="padding:6px 10px;text-align:right;">${(o.qty||0).toLocaleString('pt-BR')}</td>
                    <td style="padding:6px 10px;text-align:right;color:var(--text-dim);">${escHTML(mix.ordemModelo[r.ordens.indexOf(o)]||'—')}</td>
                    <td style="padding:6px 10px;color:#ff5252;font-size:.72rem;">não coube no horizonte (aumente o horizonte ou a capacidade do tear)</td></tr>`;
            });
            html += `</tbody></table></div>`;
        }

        wrap.innerHTML = html;
    },

    // Reordena ordens por prioridade (mesma lógica de _buildOrdens) — usado na simulação
    _ordenarPor(ordens, prioridade) {
        const o = ordens.slice();
        if (prioridade === 'edd') o.sort((a,b) => { if(!a.data_entrega&&!b.data_entrega) return String(a.emissao).localeCompare(String(b.emissao)); if(!a.data_entrega) return 1; if(!b.data_entrega) return -1; return a.data_entrega.localeCompare(b.data_entrega); });
        else if (prioridade === 'qty') o.sort((a,b) => b.qty - a.qty);
        else if (prioridade === 'cpv') o.sort((a,b) => b.cpv - a.cpv);
        else if (prioridade === 'atcs') return this._sequenciarATCS(o);
        else if (prioridade === 'fifo') o.sort((a,b) => String(a.emissao).localeCompare(String(b.emissao)) || String(a.nop||'').localeCompare(String(b.nop||'')));
        return o;
    },

    // Roda a alocação da tecelagem sobre a carteira do baseline com overrides (capacidade/prazo/prioridade),
    // SEM gravar nada. Devolve um tecMix simulado para comparar com o baseline.
    _simularMix(ov) {
        const base = this._resultado;
        if (!base || !base.tecMix) return null;
        const horizonte = (ov.horizonte && ov.horizonte > 0) ? Math.min(ov.horizonte, base.semanas.length) : base.semanas.length;
        const semanas = base.semanas.slice(0, horizonte);
        const nSemanas = semanas.length;
        const { modelos, capTec, nTeares } = this._capTecPorModelo(semanas, toc._maquinasTec || [], ov);
        if (!modelos.length) return null;
        let ordens = base.ordens.map(o => ({ ...o }));
        if (ov.prazos) ordens.forEach(o => { if (ov.prazos[o.codigo] !== undefined) o.data_entrega = ov.prazos[o.codigo] || null; });
        if (ov.prioridade) ordens = this._ordenarPor(ordens, ov.prioridade);
        const usadoTec = {}, detalheTec = {}, setupUsadoTec = {}, lastFamTec = {};
        modelos.forEach(m => { usadoTec[m] = new Array(nSemanas).fill(0); detalheTec[m] = Array.from({length:nSemanas},()=>[]); setupUsadoTec[m] = new Array(nSemanas).fill(0); lastFamTec[m] = null; });
        const ordemModelo = {}, semModelo = []; let nOverflow = 0;
        ordens.forEach((ordem, oi) => {
            if (!ordem.dados) return;
            const tempoUn = this._getTempoProc(ordem.dados, 'tecelagem');
            if (!tempoUn) return;
            const aptos = toc._getModelosStoll(ordem.dados).filter(m => modelos.includes(m));
            const cargaMin = tempoUn * ordem.qty;
            if (!aptos.length) { semModelo.push({ codigo: ordem.codigo, qty: ordem.qty, mins: cargaMin }); return; }
            const dl = this._deadlineIdx(ordem, semanas);
            const res = this._alocarTecOrdem(aptos, cargaMin, this._getFamilia(ordem.dados), 0, dl,
                { capTec, usadoTec, setupUsadoTec, lastFamTec, nSemanas, nTeares });
            res.slices.forEach(sl => detalheTec[res.modelo][sl.sem].push({ codigo: ordem.codigo, mins: sl.mins }));
            if (res.restante > 0) nOverflow++;
            ordemModelo[oi] = res.modelo;
        });
        return { modelos, capTec, usadoTec, detalheTec, nTeares, ordemModelo, semModelo, nOverflow, semanas };
    },

    // Resumo por modelo (cap, uso, util, ocioso) — usado no delta da simulação
    _resumoMix(mix) {
        const out = {};
        (mix.modelos || []).forEach(m => {
            const cap = mix.capTec[m].reduce((s,v)=>s+v,0);
            const uso = mix.usadoTec[m].reduce((s,v)=>s+v,0);
            out[m] = { cap, uso, util: cap>0?uso/cap:(uso>0?Infinity:0), ocioso: Math.max(0,cap-uso) };
        });
        const capT = Object.values(out).reduce((s,x)=>s+x.cap,0);
        const usoT = Object.values(out).reduce((s,x)=>s+x.uso,0);
        return { porModelo: out, utilGeral: capT>0?usoT/capT:0, ociosoH: Object.values(out).reduce((s,x)=>s+x.ocioso,0)/60,
                 gargalo: Object.entries(out).sort((a,b)=>(b[1].util===Infinity?9e9:b[1].util)-(a[1].util===Infinity?9e9:a[1].util))[0] };
    },

    _renderSimulacao() {
        const wrap = document.getElementById('tl-sim-conteudo');
        if (!wrap) return;
        const r = this._resultado;
        if (!r || !r.tecMix) { wrap.innerHTML = `<div class="summary-card" style="color:var(--text-dim);padding:16px;font-size:.85rem;">Calcule a linha do tempo (com teares cadastrados) para simular cenários de tear.</div>`; return; }
        const mix = r.tecMix;
        const cor = u => u >= 1 ? '#f06292' : u >= 0.8 ? '#ffca28' : '#26a69a';
        const inp = 'padding:4px 6px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:5px;color:var(--text-primary);font-size:.78rem;';
        const linhasMod = mix.modelos.map(m => {
            const cap = mix.capTec[m].reduce((s,v)=>s+v,0), uso = mix.usadoTec[m].reduce((s,v)=>s+v,0);
            const util = cap>0?uso/cap:0;
            return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-color);">
                <div style="width:160px;font-weight:600;font-size:.82rem;">Stoll ${escHTML(m)} <span style="font-size:.66rem;color:var(--text-dim);font-weight:400;">· ${mix.nTeares[m]||0} máq · ${Math.round(util*100)}%</span></div>
                <label style="display:flex;align-items:center;gap:4px;font-size:.72rem;color:var(--text-dim);"><input type="checkbox" id="sim-on-${m}" checked> ligado</label>
                <span style="font-size:.72rem;color:var(--text-dim);">+ teares <input type="number" id="sim-tear-${m}" value="0" min="0" style="width:52px;${inp}"></span>
                <span style="font-size:.72rem;color:var(--text-dim);">capac. × <input type="number" id="sim-fator-${m}" value="1" min="0.1" step="0.25" title="ex.: 2 = dobro de turnos" style="width:58px;${inp}"></span>
            </div>`;
        }).join('');
        wrap.innerHTML = `
            <div class="summary-card" style="margin-bottom:14px;">
                <div class="s-label" style="margin-bottom:4px;">SIMULAR CENÁRIO DE TEAR</div>
                <p style="font-size:.74rem;color:var(--text-dim);margin:0 0 12px;">Mexa nas alavancas e clique SIMULAR. Nada é gravado — é só um "e se". Compare o antes × depois abaixo.</p>
                ${linhasMod}
                <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:end;margin-top:14px;">
                    <div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px;">Prioridade</div>
                        <select id="sim-prio" style="${inp}"><option value="">(mantém)</option><option value="edd">Prazo (EDD)</option><option value="fifo">Emissão (FIFO)</option><option value="qty">Quantidade</option><option value="cpv">Valor (CPV)</option></select></div>
                    <div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px;">Horizonte (semanas)</div>
                        <input type="number" id="sim-horizonte" value="${r.semanas.length}" min="1" max="${r.semanas.length}" style="width:70px;${inp}"></div>
                    <div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px;">Mover prazo — código</div>
                        <input type="text" id="sim-prazo-cod" placeholder="código" style="width:110px;${inp}"></div>
                    <div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px;">novo prazo</div>
                        <input type="date" id="sim-prazo-data" style="${inp}"></div>
                    <button onclick="preactor._simular()" style="padding:8px 22px;background:var(--indigo-btn);color:#fff;border:none;border-radius:6px;font-size:.82rem;font-weight:700;cursor:pointer;">SIMULAR</button>
                </div>
            </div>
            <div id="tl-sim-resultado">${this._recomendarPreench(mix, r.semanas)}</div>`;
    },

    _simular() {
        const base = this._resultado;
        if (!base?.tecMix) return;
        const ov = { off: new Set(), addTeares: {}, fator: {}, prazos: {} };
        base.tecMix.modelos.forEach(m => {
            if (!document.getElementById(`sim-on-${m}`)?.checked) ov.off.add(m);
            const t = parseInt(document.getElementById(`sim-tear-${m}`)?.value) || 0; if (t > 0) ov.addTeares[m] = t;
            const f = parseFloat(document.getElementById(`sim-fator-${m}`)?.value); if (f > 0 && f !== 1) ov.fator[m] = f;
        });
        ov.prioridade = document.getElementById('sim-prio')?.value || '';
        ov.horizonte = parseInt(document.getElementById('sim-horizonte')?.value) || 0;
        const pc = (document.getElementById('sim-prazo-cod')?.value || '').trim().toUpperCase();
        if (pc) ov.prazos[pc] = document.getElementById('sim-prazo-data')?.value || null;
        const sim = this._simularMix(ov);
        const alvo = document.getElementById('tl-sim-resultado');
        if (!alvo) return;
        if (!sim) { alvo.innerHTML = `<div class="summary-card" style="color:#ffca28;padding:14px;">Cenário sem nenhum tear ligado — ligue ao menos um modelo.</div>`; return; }
        alvo.innerHTML = this._renderDeltaMix(base.tecMix, sim, base.semanas);
    },

    _renderDeltaMix(baseMix, sim, semanasBase) {
        const A = this._resumoMix(baseMix), B = this._resumoMix(sim);
        const cor = u => u >= 1 ? '#f06292' : u >= 0.8 ? '#ffca28' : '#26a69a';
        const nAlocA = (baseMix.semModelo?.length||0) + this._resultado.ordens.filter(o=>o._overflowTec).length;
        const nAlocB = (sim.semModelo?.length||0) + (sim.nOverflow||0);
        const fmtP = u => u===Infinity?'∞':Math.round(u*100)+'%';
        const seta = (a,b,inv) => { const d=b-a; if(Math.abs(d)<1e-9) return '<span style="color:var(--text-dim);">→</span>'; const bom=inv?d<0:d>0; return `<span style="color:${bom?'#26a69a':'#f06292'};">${d>0?'▲':'▼'}</span>`; };
        const kpi = (titulo, a, b, inv) => `<div style="background:var(--bg-input);border:1px solid var(--border-color);border-radius:8px;padding:10px 16px;min-width:150px;">
            <div style="font-size:.64rem;color:var(--text-dim);letter-spacing:.05em;margin-bottom:4px;">${titulo}</div>
            <div style="font-size:1.05rem;font-weight:700;"><span style="color:var(--text-dim);">${a}</span> ${seta(parseFloat(a),parseFloat(b),inv)} <span>${b}</span></div></div>`;
        let html = `<div class="summary-card" style="margin-bottom:14px;"><div class="s-label" style="margin-bottom:10px;">RESULTADO DA SIMULAÇÃO — antes → depois</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                ${kpi('UTIL. MÉDIA', fmtP(A.utilGeral), fmtP(B.utilGeral), false)}
                ${kpi('GARGALO', A.gargalo?fmtP(A.gargalo[1].util):'—', B.gargalo?fmtP(B.gargalo[1].util):'—', true)}
                ${kpi('OCIOSO (h)', A.ociosoH.toFixed(0), B.ociosoH.toFixed(0), true)}
                ${kpi('NÃO ALOCADAS', String(nAlocA), String(nAlocB), true)}
            </div>
            <div style="font-size:.72rem;color:var(--text-dim);margin-top:10px;">Gargalo: ${A.gargalo?'Stoll '+escHTML(A.gargalo[0]):'—'} → ${B.gargalo?'Stoll '+escHTML(B.gargalo[0]):'—'}</div>
        </div>`;
        // tabela por modelo antes/depois
        html += `<div class="summary-card"><div class="s-label" style="margin-bottom:8px;">UTILIZAÇÃO POR TEAR</div>
            <table style="width:100%;border-collapse:collapse;font-size:.8rem;"><thead><tr style="border-bottom:1px solid var(--border-color);color:var(--text-dim);font-size:.66rem;">
            <th style="text-align:left;padding:6px 10px;">TEAR</th><th style="text-align:right;padding:6px 10px;">ANTES</th><th style="text-align:right;padding:6px 10px;">DEPOIS</th><th style="text-align:right;padding:6px 10px;">OCIOSO ANTES→DEPOIS</th></tr></thead><tbody>`;
        const modelos = [...new Set([...Object.keys(A.porModelo), ...Object.keys(B.porModelo)])];
        modelos.forEach(m => {
            const a = A.porModelo[m], b = B.porModelo[m];
            html += `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:6px 10px;font-weight:600;">Stoll ${escHTML(m)}</td>
                <td style="padding:6px 10px;text-align:right;color:${a?cor(a.util):'var(--text-dim)'};">${a?fmtP(a.util):'—'}</td>
                <td style="padding:6px 10px;text-align:right;font-weight:700;color:${b?cor(b.util):'#ff5252'};">${b?fmtP(b.util):'desligado'}</td>
                <td style="padding:6px 10px;text-align:right;color:var(--text-dim);">${a?(a.ocioso/60).toFixed(0):'—'}h → ${b?(b.ocioso/60).toFixed(0):'—'}h</td></tr>`;
        });
        html += `</tbody></table></div>`;
        return html;
    },

    // Recomendação de preenchimento: cruza folga por modelo com OPs multi-aptas no gargalo
    _recomendarPreench(mix, semanas) {
        const R = this._resumoMix(mix);
        if (!R.gargalo) return '';
        const gModelo = R.gargalo[0];
        const ociosos = Object.entries(R.porModelo).filter(([m,x]) => m!==gModelo && x.ocioso > 0 && x.util < 0.8).map(([m])=>m);
        // OPs no gargalo que também são aptas a um modelo ocioso
        const ordens = this._resultado.ordens || [];
        const movER = [];
        ordens.forEach((o, oi) => {
            if (mix.ordemModelo[oi] !== gModelo || !o.dados) return;
            const aptos = toc._getModelosStoll(o.dados).filter(m => mix.modelos.includes(m));
            const destino = aptos.find(m => ociosos.includes(m));
            if (destino) movER.push({ codigo: o.codigo, de: gModelo, para: destino });
        });
        let msg;
        if (R.gargalo[1].util < 0.85) {
            msg = `<span style="color:#26a69a;">Sem gargalo crítico — o tear mais carregado (Stoll ${escHTML(gModelo)}) está em ${Math.round(R.gargalo[1].util*100)}%.</span>`;
        } else if (movER.length) {
            const cods = movER.slice(0,6).map(x=>escHTML(x.codigo)).join(', ');
            msg = `Stoll <strong>${escHTML(gModelo)}</strong> é o gargalo. Você pode <strong>mover ${movER.length} OP(s)</strong> dele para o(s) tear(es) ocioso(s) <strong>${ociosos.map(escHTML).join(', ')}</strong> — elas são aptas em ambos: ${cods}${movER.length>6?'…':''}. Ou ligue "+ teares/capacidade" no ${escHTML(gModelo)} na simulação.`;
        } else if (ociosos.length) {
            msg = `Stoll <strong>${escHTML(gModelo)}</strong> é o gargalo (${Math.round(R.gargalo[1].util*100)}%) e há capacidade ociosa no(s) tear(es) ${ociosos.map(escHTML).join(', ')}, <strong>mas nenhuma OP do gargalo é apta neles</strong>. Preencha a coluna Stoll desses códigos com o modelo ocioso (ex.: <code>${escHTML(gModelo)}, ${escHTML(ociosos[0])}</code>) para o motor poder equilibrar.`;
        } else {
            msg = `Stoll <strong>${escHTML(gModelo)}</strong> está em ${Math.round(R.gargalo[1].util*100)}% e os demais teares também estão cheios — capacidade real insuficiente. Simule "+ teares" ou "capacidade ×" para ver quanto resolve.`;
        }
        return `<div class="summary-card" style="border-left:3px solid var(--indigo-primary);"><div class="s-label" style="margin-bottom:6px;">💡 RECOMENDAÇÃO DE PREENCHIMENTO</div><p style="font-size:.82rem;color:var(--text-primary);margin:0;line-height:1.5;">${msg}</p></div>`;
    },

    // CTP — Capable-to-Promise: cota uma data de entrega factível para um pedido novo
    async _promessaCTP() {
        const cod = (document.getElementById('ctp-cod')?.value || '').trim();
        const qtd = parseInt(document.getElementById('ctp-qtd')?.value) || 0;
        const data = document.getElementById('ctp-data')?.value || '';
        const horas = parseInt(document.getElementById('ctp-horas')?.value) || 8;
        const alvo = document.getElementById('tl-ctp-resultado');
        if (!alvo) return;
        if (!cod || qtd <= 0) { alvo.innerHTML = '<div class="summary-card" style="color:#ffca28;padding:14px;">Informe o código do produto e a quantidade.</div>'; return; }
        alvo.innerHTML = '<div class="summary-card" style="color:var(--text-dim);padding:14px;">Calculando...</div>';
        const q = `codigo=${encodeURIComponent(cod)}&qtd=${qtd}&horas=${horas}${data ? `&data=${data}` : ''}`;
        const r = await api.get('/api/mf/promessa?' + q).catch(() => null);
        if (!r) { alvo.innerHTML = '<div class="summary-card" style="color:#f06292;padding:14px;">Erro ao calcular — tente de novo.</div>'; return; }
        if (!r.encontrado) { alvo.innerHTML = `<div class="summary-card" style="color:#ffca28;padding:14px;">Produto <strong>${escHTML(cod)}</strong> não encontrado no cadastro do MES.</div>`; return; }
        const dProm = r.data_promessa ? new Date(r.data_promessa + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
        const cumpre = r.cumpre === null ? '' : (r.cumpre
            ? `<span style="color:#26a69a;font-weight:700;">✓ cumpre o desejado</span>`
            : `<span style="color:#f06292;font-weight:700;">✗ NÃO cumpre (${new Date(r.data_desejada + 'T12:00:00').toLocaleDateString('pt-BR')})</span>`);
        const cor = r.confiavel ? '#26a69a' : '#ffca28';
        let html = `<div class="summary-card" style="margin-bottom:14px;border-left:3px solid ${cor};">
            <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;">
                <div><div style="font-size:1.7rem;font-weight:800;color:${cor};">${dProm}</div>
                    <div style="font-size:.66rem;color:var(--text-dim);">DATA FACTÍVEL · ${r.dias_uteis} dias úteis</div></div>
                <div style="font-size:.82rem;">${escHTML(r.produto.descricao || r.produto.codigo)} · <strong>${r.qtd.toLocaleString('pt-BR')}</strong> un · gargalo: <strong>${escHTML(r.etapa_gargalo || '—')}</strong></div>
                <div style="margin-left:auto;">${cumpre}</div>
            </div>`;
        if (!r.confiavel) html += `<div style="margin-top:10px;font-size:.74rem;color:#ffca28;">⚠ Data <strong>NÃO confiável</strong>: ${r.sem_padrao_etapas} etapa(s) sem tempo-padrão cadastrado. Cadastre o tempo-padrão (MES › Engenharia / piloto) para a promessa valer.</div>`;
        html += `</div>`;
        html += `<div class="summary-card"><div class="s-label" style="margin-bottom:8px;">CARGA POR ETAPA (fila atual + este pedido)</div>
            <table style="width:100%;border-collapse:collapse;font-size:.8rem;"><thead><tr style="color:var(--text-dim);font-size:.66rem;border-bottom:1px solid var(--border-color);">
            <th style="text-align:left;padding:6px 10px;">ETAPA</th><th style="text-align:right;padding:6px 10px;">MÁQ</th><th style="text-align:right;padding:6px 10px;">FILA (h)</th><th style="text-align:right;padding:6px 10px;">ESTE PEDIDO (h)</th><th style="text-align:right;padding:6px 10px;">DIAS</th></tr></thead><tbody>`;
        (r.etapas || []).forEach(e => {
            html += `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:6px 10px;font-weight:600;">${escHTML(e.etapa)}${e.etapa === r.etapa_gargalo ? ' <span style="color:#f06292;font-size:.66rem;">◆ gargalo</span>' : ''}</td>
                <td style="padding:6px 10px;text-align:right;">${e.maquinas}</td>
                <td style="padding:6px 10px;text-align:right;color:var(--text-dim);">${(e.backlog_h || 0).toLocaleString('pt-BR')}</td>
                <td style="padding:6px 10px;text-align:right;">${e.sem_padrao ? '<span style="color:#ffca28;">sem padrão</span>' : (e.novo_h || 0).toLocaleString('pt-BR')}</td>
                <td style="padding:6px 10px;text-align:right;font-weight:700;">${e.dias != null ? e.dias : '—'}</td></tr>`;
        });
        html += `</tbody></table></div>`;
        alvo.innerHTML = html;
    },

    _renderStatus() {
        const wrap = document.getElementById('tl-pan-status');
        if (!wrap) return;
        const r = this._resultado;
        if (!r) { wrap.innerHTML = '<p style="color:var(--text-dim);padding:20px;">Calcule a linha do tempo primeiro.</p>'; return; }

        const items = Object.values(r.statusOrdens).sort((a,b) => {
            const ord = { semtempo:0, semtear:1, overflow:2, late:3, risk:4, ok:5, nodate:6 };
            return (ord[a.status]??6)-(ord[b.status]??6) || (a.data_entrega||'9999').localeCompare(b.data_entrega||'9999');
        });
        const icons  = { semtempo: DOT.red, semtear: DOT.red, overflow: DOT.red, late: DOT.red, risk: DOT.yellow, ok: DOT.green, nodate: DOT.gray };
        const labels = { semtempo:'SEM TEMPO-PADRÃO', semtear:'SEM TEAR', overflow:'> HORIZONTE', late:'ATRASADO', risk:'EM RISCO', ok:'NO PRAZO', nodate:'SEM PRAZO' };
        const colors = { semtempo:'#ff5252', semtear:'#ff5252', overflow:'#ff5252', late:'#f06292', risk:'#ffca28', ok:'#26a69a', nodate:'#666' };
        const stpc = items.filter(s=>s.status==='semtempo').length;
        const stc = items.filter(s=>s.status==='semtear').length;
        const vc = items.filter(s=>s.status==='overflow').length;
        const lc = items.filter(s=>s.status==='late').length;
        const rc = items.filter(s=>s.status==='risk').length;
        const oc = items.filter(s=>s.status==='ok').length;
        const nc = items.filter(s=>s.status==='nodate').length;

        // ── KPIs do plano (o que a fábrica sente): atraso, setup, lead time, utilização ──
        let atrasoDias = 0, leadSomaSem = 0, leadN = 0;
        items.forEach(it => {
            if (it.status === 'late' && it.data_entrega && it.finishDate) atrasoDias += Math.max(0, (it.finishDate - new Date(it.data_entrega+'T12:00:00')) / 864e5);
            if (it.status === 'ok' || it.status === 'risk' || it.status === 'late') { leadSomaSem += (it.lastSemIdx||0) + 1; leadN++; }
        });
        const setupTotMin = this._SEQ.reduce((s,pid) => s + (r.setupUsado[pid]||[]).reduce((a,b)=>a+b,0), 0);
        const capTot = this._SEQ.reduce((s,pid)=> s + (r.cap[pid]||[]).reduce((a,b)=>a+b,0), 0);
        const usoTot = this._SEQ.reduce((s,pid)=> s + (r.usado[pid]||[]).reduce((a,b)=>a+b,0), 0);
        const utilMed = capTot > 0 ? usoTot/capTot*100 : 0;
        const utilCor = utilMed > 90 ? '#f06292' : utilMed >= 80 ? '#26a69a' : '#ffca28';   // semáforo 80–90% saudável
        const kpiPlano = (c,v,l,tip)=>`<div title="${tip||''}" style="background:var(--bg-input);border:1px solid var(--border-color);border-radius:8px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="font-size:1.25rem;font-weight:800;color:${c};">${v}</div><div style="font-size:.62rem;color:var(--text-dim);letter-spacing:.05em;">${l}</div></div>`;
        this._planKpis = { atrasoDias, setupTotMin, leadMed: leadN?leadSomaSem/leadN:0, utilMed };  // reusável no delta do SIMULAR

        let html = `<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
            ${kpiPlano(atrasoDias>0?'#f06292':'#26a69a', Math.round(atrasoDias), 'ATRASO (dias)', 'Soma dos dias de atraso das OPs atrasadas')}
            ${kpiPlano('#ffab76', (setupTotMin/60).toFixed(0)+'h', 'SETUP DO PLANO', 'Total de horas de changeover que o plano gasta')}
            ${kpiPlano('#26c6da', (leadN?leadSomaSem/leadN:0).toFixed(1), 'LEAD MÉDIO (sem)', 'Semanas médias da 1ª etapa até concluir')}
            ${kpiPlano(utilCor, utilMed.toFixed(0)+'%', 'UTILIZAÇÃO', 'Média dos 7 processos. Saudável 80–90%; >90% = plano frágil')}
        </div>
        <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
            ${[...(stpc?[['#ff5252',stpc,'SEM TEMPO-PADRÃO']]:[]),...(stc?[['#ff5252',stc,'SEM TEAR']]:[]),...(vc?[['#ff5252',vc,'> HORIZONTE']]:[]),['#f06292',lc,'ATRASADAS'],['#ffca28',rc,'EM RISCO'],['#26a69a',oc,'NO PRAZO'],['#666',nc,'SEM PRAZO']].map(([c,n,l])=>`
            <div style="background:${c}18;border:1px solid ${c}44;border-radius:8px;padding:12px 20px;min-width:110px;text-align:center;">
                <div style="font-size:1.5rem;font-weight:800;color:${c};">${n}</div>
                <div style="font-size:.7rem;color:${c};letter-spacing:.07em;">${l}</div>
            </div>`).join('')}
        </div>
        <div class="summary-card" style="padding:0;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
        <thead><tr style="border-bottom:2px solid var(--border-color);">
            <th style="padding:10px 14px;text-align:left;font-size:.68rem;color:var(--text-dim);">STATUS</th>
            <th style="padding:10px 14px;text-align:left;font-size:.68rem;color:var(--text-dim);">CÓDIGO</th>
            <th style="padding:10px 14px;text-align:left;font-size:.68rem;color:var(--text-dim);">DESCRIÇÃO</th>
            <th style="padding:10px 14px;text-align:right;font-size:.68rem;color:var(--text-dim);">QTD</th>
            <th style="padding:10px 14px;text-align:center;font-size:.68rem;color:var(--text-dim);">PRAZO</th>
            <th style="padding:10px 14px;text-align:center;font-size:.68rem;color:var(--text-dim);">CONCLUSÃO PREV.</th>
            <th style="padding:10px 14px;text-align:center;font-size:.68rem;color:var(--text-dim);">FONTE</th>
        </tr></thead><tbody>`;

        items.forEach((item, i) => {
            const finishStr = item.finishDate ? item.finishDate.toISOString().slice(0,10) : null;
            const cor = colors[item.status];
            html += `<tr style="background:${i%2?'var(--bg-input)':'transparent'};border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:9px 14px;white-space:nowrap;">${icons[item.status]} <span style="font-size:.7rem;color:${cor};font-weight:700;">${labels[item.status]}</span></td>
                <td style="padding:9px 14px;font-weight:600;color:var(--indigo-primary);">${escHTML(item.codigo)}</td>
                <td style="padding:9px 14px;">${escHTML((item.label||'').slice(0,30))}</td>
                <td style="padding:9px 14px;text-align:right;">${item.qty.toLocaleString('pt-BR')}</td>
                <td style="padding:4px 14px;text-align:center;">
                    <input type="date" value="${item.data_entrega||''}" onchange="preactor._salvarPrazo('${escJS(item.codigo)}', this.value)"
                        title="Definir/ajustar prazo de entrega deste código"
                        style="padding:4px 6px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:5px;color:${item.data_entrega?cor:'var(--text-dim)'};font-size:.75rem;"></td>
                <td style="padding:9px 14px;text-align:center;color:${cor};">${item.status==='overflow'?`> SEM ${r.semanas.length}`:finishStr?new Date(finishStr+'T12:00:00').toLocaleDateString('pt-BR'):'—'}</td>
                <td style="padding:9px 14px;text-align:center;font-size:.7rem;color:${item.fonte==='op'?'#ffca28':'#26c6da'};">${item.fonte==='op'?'OP':'PLANO'}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        wrap.innerHTML = html;
    },

    // Grava prazo de entrega de um código (aba Status) e recalcula
    async _salvarPrazo(codigo, valor) {
        const resp = await api.post('/api/op-datas/bulk', { items: [{ codigo, data_entrega: valor || null, cpv: this._datas[codigo]?.cpv || 0 }] });
        if (!resp?.ok) { mostrarToast('Erro ao salvar prazo — tente novamente.', 'erro'); return; }
        this._datas[codigo] = { ...(this._datas[codigo]||{}), data_entrega: valor || null };
        mostrarToast(`Prazo de ${codigo} ${valor ? 'salvo: ' + new Date(valor+'T12:00:00').toLocaleDateString('pt-BR') : 'removido'}.`, 'ok');
        this.calcular();
    },

    _renderSetupMatrix() {
        const wrap = document.getElementById('tl-pan-config');
        if (!wrap) return;
        const familias = [...new Set(banco.rawData.map(r => this._getCampoFamilia(r.dados)).filter(Boolean))].sort();

        if (!familias.length) {
            wrap.innerHTML = `<div style="padding:20px;color:var(--text-dim);">${banco.rawData.length
                ? 'O Banco de Dados não tem coluna "Segmento" ou "Família" — adicione-a para configurar a matriz de setup.'
                : 'Importe o Banco de Dados para configurar a matriz de setup.'}</div>`;
            return;
        }
        const procLabels = toc._PROCS.filter(p => this._SEQ.includes(p.id));
        wrap.innerHTML = `
        <div class="s-label" style="margin-bottom:12px;">MATRIZ DE SETUP / CHANGEOVER (minutos)</div>
        <p style="font-size:.78rem;color:var(--text-dim);margin-bottom:16px;">Tempo de troca ao mudar DE família (linha) PARA família (coluna) em cada processo.</p>
        <select id="tl-setup-proc" onchange="preactor._renderSetupGrid()" style="padding:8px 12px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:7px;color:var(--text-primary);font-size:.82rem;margin-bottom:16px;">
            ${procLabels.map(p=>`<option value="${p.id}">${p.nome}</option>`).join('')}
        </select>
        <div id="tl-setup-grid" style="overflow-x:auto;"></div>
        <button onclick="preactor.salvarSetupMatrix()" style="margin-top:16px;padding:10px 24px;border-radius:8px;border:none;background:var(--indigo-btn);color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;">SALVAR MATRIZ</button>`;
        this._renderSetupGrid(familias);
    },

    _renderSetupGrid(familias) {
        const gridEl = document.getElementById('tl-setup-grid');
        if (!gridEl) return;
        if (!familias) {
            familias = [...new Set(banco.rawData.map(r => this._getCampoFamilia(r.dados)).filter(Boolean))].sort();
        }
        const procId = document.getElementById('tl-setup-proc')?.value || this._SEQ[0];
        let html = `<table style="border-collapse:collapse;font-size:.78rem;">
            <thead><tr>
                <th style="padding:8px 12px;background:var(--bg-card);color:var(--text-dim);font-size:.65rem;white-space:nowrap;">DE ↓ / PARA →</th>
                ${familias.map(f=>`<th style="padding:8px 10px;background:var(--bg-card);color:var(--text-dim);font-size:.65rem;min-width:80px;text-align:center;">${escHTML(f)}</th>`).join('')}
            </tr></thead><tbody>`;
        familias.forEach((fDe, ri) => {
            html += `<tr style="background:${ri%2?'var(--bg-input)':'transparent'};">
                <td style="padding:8px 12px;font-weight:600;color:var(--text-primary);white-space:nowrap;background:var(--bg-card);">${escHTML(fDe)}</td>`;
            familias.forEach(fPara => {
                if (fDe === fPara) {
                    html += `<td style="padding:4px 6px;text-align:center;background:rgba(255,255,255,.04);color:var(--text-dim);">—</td>`;
                } else {
                    const ex = this._setupMatrix.find(r=>r.processo===procId&&r.familia_de===fDe&&r.familia_para===fPara);
                    html += `<td style="padding:4px 6px;text-align:center;">
                        <input type="number" min="0" max="999" value="${ex?.minutos||0}"
                            data-proc="${procId}" data-de="${escHTML(fDe)}" data-para="${escHTML(fPara)}"
                            class="tl-setup-input"
                            style="width:58px;padding:4px 6px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:5px;color:var(--text-primary);font-size:.8rem;text-align:center;"></td>`;
                }
            });
            html += `</tr>`;
        });
        html += `</tbody></table>`;
        gridEl.innerHTML = html;
    },

    async salvarSetupMatrix() {
        const inputs   = document.querySelectorAll('.tl-setup-input');
        const procAtual = document.getElementById('tl-setup-proc')?.value;
        const novosProc = [];
        inputs.forEach(inp => {
            const v = parseInt(inp.value)||0;
            if (v > 0) novosProc.push({ processo: inp.dataset.proc, familia_de: inp.dataset.de, familia_para: inp.dataset.para, minutos: v });
        });
        const outros = this._setupMatrix.filter(r => r.processo !== procAtual);
        const todos  = [...outros, ...novosProc];
        // api.post não lança em erro HTTP — retorna null/objeto sem ok; checar a resposta
        const resp = await api.post('/api/setup-matrix/bulk', { items: todos });
        if (!resp?.ok) { mostrarToast('Erro ao salvar matriz: ' + (resp?.erro || 'falha de rede') + ' — nada foi alterado.', 'erro'); return; }
        this._setupMatrix = todos;
        mostrarToast('Matriz de setup salva.', 'ok');
    },

    // Imprime a lista sequenciada da célula aberta (processo × semana) — vai para o quadro do setor
    imprimirSemana() {
        const r = this._resultado;
        const det = this._detalheAtual;
        if (!r || !det) { mostrarToast('Abra o detalhe de uma célula do Gantt primeiro.', 'aviso'); return; }
        const { procId, semIdx } = det;
        const proc   = toc._PROCS.find(p => p.id === procId);
        const semana = r.semanas[semIdx];
        const items  = r.detalhe[procId]?.[semIdx] || [];
        if (!items.length) { mostrarToast('Sem itens nesta célula.', 'aviso'); return; }

        const fmt = d => d ? new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR') : '—';
        const linhas = items.map((it, i) => `<tr>
            <td>${i+1}</td>
            <td>${it.nop ? escHTML(it.nop) : '—'}</td>
            <td><b>${escHTML(it.codigo)}</b></td>
            <td>${escHTML((it.label||'').slice(0,40))}</td>
            <td style="text-align:right;">${(it.qty||0).toLocaleString('pt-BR')}</td>
            <td style="text-align:right;">${(it.mins/60).toFixed(1)}h</td>
            <td>${fmt(it.data_entrega)}</td>
            <td style="width:90px;"></td>
        </tr>`).join('');

        const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Programação — ${proc?.nome||procId} — Semana ${semIdx+1}</title>
<style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:28px;}
    h1{font-size:18px;margin:0 0 2px;} h2{font-size:14px;font-weight:400;color:#444;margin:0 0 16px;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    th,td{border:1px solid #999;padding:6px 8px;text-align:left;}
    th{background:#eee;font-size:10px;letter-spacing:.05em;}
    tfoot td{font-weight:bold;background:#f6f6f6;}
    .meta{font-size:10px;color:#666;margin-top:14px;}
    @media print{ body{margin:10mm;} }
</style></head><body>
<h1>SIGS — Programação Semanal · ${escHTML(proc?.nome||procId)}</h1>
<h2>Semana ${semIdx+1} (${escHTML(semana.label)}) · ${items.length} itens · ${( (r.usado[procId]?.[semIdx]||0) /60).toFixed(1)}h de ${((r.cap[procId]?.[semIdx]||0)/60).toFixed(1)}h disponíveis</h2>
<table>
<thead><tr><th>#</th><th>OP</th><th>CÓDIGO</th><th>DESCRIÇÃO</th><th>QTD</th><th>CARGA</th><th>PRAZO</th><th>PRODUZIDO ✍</th></tr></thead>
<tbody>${linhas}</tbody>
</table>
<div class="meta">Gerado em ${new Date().toLocaleString('pt-BR')} · sequência conforme prioridade do cálculo · coluna PRODUZIDO para anotação manual do líder</div>
<script>window.onload = () => window.print();</` + `script>
</body></html>`;

        const win = window.open('', '_blank');
        if (!win) { mostrarToast('Pop-up bloqueado — permita pop-ups para imprimir.', 'erro'); return; }
        win.document.write(html);
        win.document.close();
    },

    _abrirDetalhe(procId, semIdx) {
        const r = this._resultado;
        if (!r) return;
        this._detalheAtual = { procId, semIdx };
        const proc    = toc._PROCS.find(p=>p.id===procId);
        const semana  = r.semanas[semIdx];
        const items   = r.detalhe[procId]?.[semIdx] || [];
        const cargaMin= r.usado[procId]?.[semIdx]   || 0;
        const capMin  = r.cap[procId]?.[semIdx]     || 0;
        const setupMin= r.setupUsado[procId]?.[semIdx] || 0;

        document.getElementById('tl-det-titulo').textContent =
            `${proc?.nome||procId} — Semana ${semIdx+1} (${semana.label}) · ${(cargaMin/60).toFixed(1)}h / ${(capMin/60).toFixed(1)}h cap`;

        const sorted = [...items].sort((a,b) => b.mins - a.mins);
        let html = '';
        if (setupMin > 0) {
            html += `<div style="background:rgba(255,152,0,.1);border:1px solid rgba(255,152,0,.3);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:.78rem;color:#ff9800;">
                <span style="display:flex;align-items:center;gap:6px;">${DOT.gear} Setup/Changeover: ${(setupMin/60).toFixed(1)}h nesta semana</span></div>`;
        }
        html += `<table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="color:var(--text-dim);font-size:.68rem;letter-spacing:.07em;border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 12px;width:24px;"></th>
                <th style="padding:8px 12px;text-align:left;">CÓDIGO</th>
                <th style="padding:8px 12px;text-align:left;">DESCRIÇÃO</th>
                <th style="padding:8px 12px;text-align:right;">QTD</th>
                <th style="padding:8px 12px;text-align:right;">CARGA</th>
                <th style="padding:8px 12px;text-align:right;">%</th>
                <th style="padding:8px 12px;text-align:center;">PRAZO</th>
                <th style="padding:8px 12px;text-align:center;">MOVER PARA SEM.</th>
            </tr></thead><tbody>`;
        sorted.forEach((it, i) => {
            const pct = capMin>0 ? it.mins/capMin*100 : 0;
            const so  = Object.values(r.statusOrdens).find(s=>s.codigo===it.codigo);
            const sIcon = so ? ({semtempo:DOT.red,semtear:DOT.red,overflow:DOT.red,late:DOT.red,risk:DOT.yellow,ok:DOT.green,nodate:DOT.gray}[so.status]||'') : '';
            const congeladaSrc = semIdx < this._timeFence;   // OP já está em semana congelada → não pode sair
            const moverOpts = r.semanas.map(s=>`<option value="${s.idx}"${s.idx===semIdx?' selected':''}${s.idx<this._timeFence?' disabled':''}>Sem ${s.idx+1} (${s.label})${s.idx<this._timeFence?' 🔒':''}</option>`).join('');
            html += `<tr style="background:${i%2?'var(--bg-input)':'transparent'};"
                draggable="${congeladaSrc?'false':'true'}" ondragstart="preactor._onDragStart(event,'${escJS(it.codigo)}','${procId}',${semIdx})">
                <td style="padding:7px 12px;font-size:1rem;">${sIcon}</td>
                <td style="padding:7px 12px;font-weight:600;color:var(--indigo-primary);">${escHTML(it.codigo)}</td>
                <td style="padding:7px 12px;">${escHTML((it.label||'').slice(0,28))}</td>
                <td style="padding:7px 12px;text-align:right;">${it.qty.toLocaleString('pt-BR')}</td>
                <td style="padding:7px 12px;text-align:right;">${(it.mins/60).toFixed(1)}h</td>
                <td style="padding:7px 12px;text-align:right;font-weight:700;">${pct.toFixed(1)}%</td>
                <td style="padding:7px 12px;text-align:center;font-size:.75rem;">${it.data_entrega?new Date(it.data_entrega+'T12:00:00').toLocaleDateString('pt-BR'):'—'}</td>
                <td style="padding:7px 12px;text-align:center;">
                    <select ${congeladaSrc?'disabled title="OP em semana congelada — não pode ser movida"':''} onchange="preactor._moverOrdem('${escJS(it.codigo)}','${procId}',this.value)"
                        style="font-size:.72rem;padding:3px 6px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:5px;color:var(--text-primary);${congeladaSrc?'opacity:.5;cursor:not-allowed;':''}">
                        ${moverOpts}
                    </select>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        document.getElementById('tl-det-conteudo').innerHTML = html;
        const det = document.getElementById('tl-detalhe');
        det.style.display = '';
        det.scrollIntoView({ behavior:'smooth', block:'nearest' });
    },

    _moverOrdem(codigo, procId, novaSemIdx) {
        if (parseInt(novaSemIdx) < this._timeFence) {   // time fence: não empurra trabalho novo para a janela congelada
            mostrarToast(`SEM ${parseInt(novaSemIdx)+1} está congelada (comprometida) — mova para uma semana aberta.`, 'aviso');
            this._renderGantt();
            return;
        }
        const key = `${codigo}_${procId}`;
        this._manualOverrides[key] = parseInt(novaSemIdx);
        localStorage.setItem('tl_manual', JSON.stringify(this._manualOverrides));
        document.getElementById('tl-detalhe').style.display = 'none';
        mostrarToast(`${codigo} movido para SEM ${parseInt(novaSemIdx)+1} — plano recalculado. LIMPAR MANUAL desfaz.`, 'ok');
        this._atualizarBadgeManual();
        this.calcular();
    },

    // Badge no botão LIMPAR MANUAL: torna visível que existem sobreposições ativas
    _atualizarBadgeManual() {
        const btn = document.querySelector('button[onclick="preactor.limparOverrides()"]');
        if (!btn) return;
        const n = Object.keys(this._manualOverrides).length;
        btn.textContent = n ? `LIMPAR MANUAL (${n})` : 'LIMPAR MANUAL';
        btn.style.borderColor = n ? 'var(--indigo-primary)' : 'rgba(255,255,255,.2)';
        btn.style.color       = n ? 'var(--indigo-primary)' : 'var(--text-dim)';
    },

    limparOverrides() {
        this._manualOverrides = {};
        localStorage.removeItem('tl_manual');
        mostrarToast('Sobreposições manuais removidas.', 'ok');
        this._atualizarBadgeManual();
        if (this._resultado) this.calcular();
    },

    _onDragStart(event, codigo, procId, semIdx) {
        this._dragState = { codigo, procId, semIdx };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `${codigo}|${procId}|${semIdx}`);
    },

    _onDropCell(event, procId, semIdx) {
        event.preventDefault();
        event.stopPropagation();
        const td = event.target.closest('td');
        if (td) td.style.outline = '';
        if (!this._dragState) return;
        this._moverOrdem(this._dragState.codigo, procId, semIdx);
        this._dragState = null;
    },

    _renderCenarios() {
        const wrap = document.getElementById('tl-pan-cenarios');
        if (!wrap) return;
        let html = `<div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;">
            <input id="tl-cen-nome" placeholder="Nome do cenário (ex: Com OEE 80%, prioridade CPV)"
                style="flex:1;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:7px;color:var(--text-primary);font-size:.85rem;">
            <button onclick="preactor.salvarCenario()" style="padding:10px 20px;border-radius:8px;border:none;background:var(--indigo-btn);color:#fff;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap;">SALVAR ATUAL</button>
        </div>`;
        if (!this._cenarios.length) {
            html += `<div style="color:var(--text-dim);font-size:.85rem;text-align:center;padding:20px;">Nenhum cenário salvo. Configure e calcule a linha do tempo, depois salve como cenário para comparar.</div>`;
        } else {
            html += `<div class="summary-card" style="padding:0;overflow:hidden;">
            <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
            <thead><tr style="border-bottom:2px solid var(--border-color);">
                <th style="padding:10px 14px;text-align:left;font-size:.68rem;color:var(--text-dim);">NOME</th>
                <th style="padding:10px 14px;text-align:center;font-size:.68rem;color:var(--text-dim);">ORDENS</th>
                <th style="padding:10px 14px;text-align:center;font-size:.68rem;color:var(--text-dim);">CARGA TOTAL</th>
                <th style="padding:10px 14px;text-align:center;font-size:.68rem;color:var(--text-dim);">MODO</th>
                <th style="padding:10px 14px;text-align:center;font-size:.68rem;color:var(--text-dim);">SALVO EM</th>
                <th style="padding:10px 14px;text-align:center;font-size:.68rem;color:var(--text-dim);">AÇÕES</th>
            </tr></thead><tbody>`;
            this._cenarios.forEach((c, i) => {
                const cfg = c.config || {};
                const res = c.resultado || {};
                const dt  = c.criado_em ? new Date(c.criado_em).toLocaleDateString('pt-BR') : '—';
                html += `<tr style="background:${i%2?'var(--bg-input)':'transparent'};border-bottom:1px solid rgba(255,255,255,.04);">
                    <td style="padding:10px 14px;font-weight:700;">${escHTML(c.nome)}</td>
                    <td style="padding:10px 14px;text-align:center;">${res.totalOrdens||'—'}</td>
                    <td style="padding:10px 14px;text-align:center;">${res.totalMinutos?((res.totalMinutos/60).toFixed(0)+'h'):'—'}</td>
                    <td style="padding:10px 14px;text-align:center;font-size:.75rem;color:var(--text-dim);">${cfg.modo==='backward'?'Reversa (EDD)':'Progressiva'}</td>
                    <td style="padding:10px 14px;text-align:center;font-size:.75rem;color:var(--text-dim);">${dt}</td>
                    <td style="padding:10px 14px;text-align:center;">
                        <button onclick="preactor._aplicarCenario('${c.id}')" style="padding:4px 10px;border-radius:5px;border:1px solid var(--indigo-primary);background:transparent;color:var(--indigo-primary);font-size:.75rem;cursor:pointer;margin-right:6px;">APLICAR</button>
                        <button onclick="preactor._deletarCenario('${c.id}')" style="padding:4px 10px;border-radius:5px;border:1px solid rgba(240,98,146,.4);background:transparent;color:#f06292;font-size:.75rem;cursor:pointer;">EXCLUIR</button>
                    </td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
        }
        wrap.innerHTML = html;
    },

    async salvarCenario() {
        const nome = document.getElementById('tl-cen-nome')?.value?.trim();
        if (!nome) { mostrarToast('Digite um nome para o cenário.','erro'); return; }
        const r = this._resultado;
        if (!r) { mostrarToast('Calcule a linha do tempo primeiro.','erro'); return; }
        const config   = { fonte: document.getElementById('tl-fonte')?.value, mes: document.getElementById('tl-mes-sel')?.value, prioridade: document.getElementById('tl-prioridade')?.value, horizonte: document.getElementById('tl-horizonte')?.value, startDate: document.getElementById('tl-start-date')?.value, modo: document.getElementById('tl-modo')?.value };
        const resultado = { totalOrdens: r.totalOrdens, totalMinutos: r.totalMinutos, modo: r.modo };
        try {
            await api.post('/api/timeline-cenario', { nome, config, resultado });
            mostrarToast(`Cenário "${nome}" salvo.`, 'ok');
            document.getElementById('tl-cen-nome').value = '';
            await this._carregarCenarios();
        } catch(e) { (console.error(e), mostrarToast('Erro inesperado. Tente de novo.', 'erro')); }
    },

    _aplicarCenario(id) {
        const c = this._cenarios.find(x=>x.id===id);
        if (!c?.config) return;
        const { fonte, mes, prioridade, horizonte, startDate, modo } = c.config;
        if (fonte)       { const el=document.getElementById('tl-fonte');       if(el) el.value=fonte; }
        if (mes!==undefined){ const el=document.getElementById('tl-mes-sel');  if(el) el.value=mes; }
        if (prioridade)  { const el=document.getElementById('tl-prioridade');  if(el) el.value=prioridade; }
        if (horizonte)   { const el=document.getElementById('tl-horizonte');   if(el) el.value=horizonte; }
        if (startDate)   { const el=document.getElementById('tl-start-date');  if(el) el.value=startDate; }
        if (modo)        { const el=document.getElementById('tl-modo');        if(el) el.value=modo; }
        this._selecionarAba('gantt');
        this.calcular();
        mostrarToast(`Cenário "${c.nome}" aplicado.`, 'ok');
    },

    async _deletarCenario(id) {
        if (!confirm('Excluir este cenário?')) return;
        try {
            await api.delete(`/api/timeline-cenario/${id}`);
            await this._carregarCenarios();
            mostrarToast('Cenário excluído.', 'ok');
        } catch(e) { (console.error(e), mostrarToast('Erro inesperado. Tente de novo.', 'erro')); }
    },
};

// ====== PROCESSOS — GERENCIAMENTO CRUD ======
const processosGerenciamento = {
    _processos:     [],
    _maquinas:      [],
    _processoAtual: null,

    async init() {
        await this.carregarProcessos();
    },

    async carregarProcessos() {
        const data = await api.get('/api/processos-config');
        this._processos = data || [];
        this.renderProcessos();
    },

    renderProcessos() {
        const grid  = document.getElementById('proc-cards-grid');
        const empty = document.getElementById('proc-empty');
        if (!grid) return;

        // Aplica ordem salva
        const savedOrder = this._getOrder();
        if (savedOrder.length) {
            this._processos.sort((a, b) => {
                const ia = savedOrder.indexOf(a.id), ib = savedOrder.indexOf(b.id);
                return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
            });
        }

        if (!this._processos.length) {
            grid.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';

        grid.innerHTML = this._processos.map(p => `
            <div class="summary-card proc-drag-card" draggable="true" data-id="${p.id}"
                style="cursor:grab;border-left:3px solid var(--indigo-btn);transition:opacity .15s,transform .15s;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                    <span class="s-label" style="display:flex;align-items:center;gap:6px;">
                        <span style="color:var(--text-dim);font-size:1rem;line-height:1;cursor:grab;" title="Arrastar para reordenar">⠿</span>
                        ${escHTML(p.nome.toUpperCase())}
                    </span>
                    <div style="display:flex;gap:8px;">
                        <button class="proc-edit-btn" data-id="${p.id}"
                            style="background:none;border:none;color:#8b949e;cursor:pointer;padding:0;">
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg>
                        </button>
                        <button class="proc-del-btn" data-id="${p.id}"
                            style="background:none;border:none;color:#f06292;cursor:pointer;padding:0;font-size:0.85rem;">✕</button>
                    </div>
                </div>
                <div style="font-size:1.5rem;font-weight:700;color:var(--indigo-primary);margin-bottom:4px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:middle;margin-right:4px;"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                    ${escHTML(p.nome)}
                </div>
                ${p.descricao ? `<div class="s-sub" style="margin-top:4px;">${escHTML(p.descricao)}</div>` : ''}
                <div style="margin-top:10px;font-size:0.75rem;color:var(--indigo-btn);">Ver máquinas →</div>
            </div>
        `).join('');

        this._initDrag(grid);
        this.renderBPM();
    },

    _initDrag(grid) {
        let dragSrc = null;
        grid.querySelectorAll('.proc-drag-card').forEach(card => {
            // Clique abre o processo (só se não foi drag)
            card.addEventListener('click', e => {
                if (e.target.classList.contains('proc-edit-btn') || e.target.closest('.proc-edit-btn')) {
                    processosGerenciamento.abrirModalProcesso(card.dataset.id); return;
                }
                if (e.target.classList.contains('proc-del-btn') || e.target.closest('.proc-del-btn')) {
                    processosGerenciamento.excluirProcesso(card.dataset.id); return;
                }
                if (!card._wasDragged) processosGerenciamento.abrirProcesso(card.dataset.id);
                card._wasDragged = false;
            });

            card.addEventListener('dragstart', e => {
                dragSrc = card;
                card._wasDragged = true;
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => card.style.opacity = '0.4', 0);
            });
            card.addEventListener('dragend', () => {
                card.style.opacity = '1';
                card.style.transform = '';
                grid.querySelectorAll('.proc-drag-card').forEach(c => c.classList.remove('proc-drag-over'));
            });
            card.addEventListener('dragover', e => {
                e.preventDefault();
                if (card !== dragSrc) card.classList.add('proc-drag-over');
            });
            card.addEventListener('dragleave', () => card.classList.remove('proc-drag-over'));
            card.addEventListener('drop', e => {
                e.preventDefault();
                card.classList.remove('proc-drag-over');
                if (!dragSrc || dragSrc === card) return;
                const srcId = dragSrc.dataset.id, dstId = card.dataset.id;
                const si = this._processos.findIndex(p => p.id === srcId);
                const di = this._processos.findIndex(p => p.id === dstId);
                if (si < 0 || di < 0) return;
                const [moved] = this._processos.splice(si, 1);
                this._processos.splice(di, 0, moved);
                this._saveOrder();
                this.renderProcessos();
            });
        });
    },

    _getOrder() {
        try { return JSON.parse(localStorage.getItem('proc-order') || '[]'); } catch { return []; }
    },
    _saveOrder() {
        localStorage.setItem('proc-order', JSON.stringify(this._processos.map(p => p.id)));
    },

    renderBPM() {
        const wrap = document.getElementById('proc-bpm-wrap');
        const svg  = document.getElementById('proc-bpm-svg');
        if (!wrap || !svg) return;
        if (!this._processos.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = '';

        const nodes = [
            { id: '_start', label: 'INÍCIO', type: 'start' },
            ...this._processos.map(p => ({ id: p.id, label: p.nome, type: 'process' })),
            { id: '_end',   label: 'FIM',    type: 'end'   }
        ];

        const NW = 148, NH = 60, GAP_X = 48, GAP_Y = 64, PAD = 24, PER_ROW = 5;
        const rows = [];
        for (let i = 0; i < nodes.length; i += PER_ROW) rows.push(nodes.slice(i, i + PER_ROW));

        // Todas as linhas: esquerda → direita (sem zigzag)
        const nodePos = {};
        rows.forEach((row, ri) => {
            row.forEach((node, ci) => {
                const x = PAD + ci * (NW + GAP_X);
                const y = PAD + ri * (NH + GAP_Y);
                nodePos[node.id] = { x, y, cx: x + NW / 2, cy: y + NH / 2 };
            });
        });

        const maxCols = Math.min(nodes.length, PER_ROW);
        const totalW = maxCols * (NW + GAP_X) - GAP_X + PAD * 2;
        const totalH = rows.length * (NH + GAP_Y) - GAP_Y + PAD * 2;

        svg.setAttribute('width',   totalW);
        svg.setAttribute('height',  totalH);
        svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

        let html = `<defs>
            <marker id="bpm-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#26c6da" opacity=".8"/>
            </marker>
            <filter id="bpm-glow">
                <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#26c6da" flood-opacity=".25"/>
            </filter>
        </defs>`;

        // Setas entre nodes consecutivos
        nodes.forEach((node, i) => {
            if (i === 0) return;
            const a = nodePos[nodes[i - 1].id], b = nodePos[node.id];
            if (!a || !b) return;

            if (Math.abs(a.cy - b.cy) < 5) {
                // Mesma linha: seta horizontal L→R
                html += `<line x1="${a.x + NW}" y1="${a.cy}" x2="${b.x}" y2="${b.cy}"
                    stroke="#26c6da" stroke-width="1.5" opacity=".6" marker-end="url(#bpm-arrow)"/>`;
            } else {
                // Quebra de linha: desce do último da linha, curva até o primeiro da próxima
                const midY = a.y + NH + GAP_Y / 2;
                html += `<path d="M${a.cx},${a.y + NH} V${midY} H${b.cx} V${b.y}"
                    fill="none" stroke="#26c6da" stroke-width="1.5" opacity=".6" marker-end="url(#bpm-arrow)"/>`;
            }
        });

        // Nodes sobre as setas
        nodes.forEach(node => {
            const pos = nodePos[node.id];
            if (!pos) return;
            const { x, y, cx, cy } = pos;

            const isStart = node.type === 'start';
            const isEnd   = node.type === 'end';
            const rx      = isStart || isEnd ? 30 : 10;
            const fill    = isStart ? '#0d2e2a' : isEnd ? '#2a1020' : 'var(--bg-card)';
            const stroke  = isStart ? '#26a69a' : isEnd ? '#f06292' : '#26c6da';
            const isProc  = node.type === 'process';
            const filter  = isProc ? 'filter="url(#bpm-glow)"' : '';
            const cursor  = isProc ? 'pointer' : 'default';
            const click   = isProc ? `data-proc-id="${node.id}"` : '';

            html += `<g class="${isProc ? 'bpm-node' : ''}" ${click} style="cursor:${cursor}">
                <rect x="${x}" y="${y}" width="${NW}" height="${NH}" rx="${rx}"
                    fill="${fill}" stroke="${stroke}" stroke-width="1.8" ${filter}/>`;

            if (isProc) {
                html += `<rect x="${cx - 8}" y="${y + 8}" width="16" height="10" rx="2"
                    fill="none" stroke="${stroke}" stroke-width="1.2" opacity=".5"/>
                <line x1="${cx - 5}" y1="${y + 20}" x2="${cx + 5}" y2="${y + 20}"
                    stroke="${stroke}" stroke-width="1" opacity=".4"/>`;
            }

            const labelY = isProc ? cy + 10 : cy;
            const words  = node.label.split(' ');
            if (words.length > 1 && node.label.length > 10) {
                const mid = Math.ceil(words.length / 2);
                html += `<text x="${cx}" y="${labelY - 7}" text-anchor="middle"
                    fill="${stroke}" font-size="11" font-weight="700" font-family="Outfit,sans-serif">${escHTML(words.slice(0, mid).join(' '))}</text>
                <text x="${cx}" y="${labelY + 7}" text-anchor="middle"
                    fill="${stroke}" font-size="11" font-weight="700" font-family="Outfit,sans-serif">${escHTML(words.slice(mid).join(' '))}</text>`;
            } else {
                html += `<text x="${cx}" y="${labelY}" text-anchor="middle" dominant-baseline="middle"
                    fill="${stroke}" font-size="11" font-weight="700" font-family="Outfit,sans-serif">${escHTML(node.label)}</text>`;
            }
            html += `</g>`;
        });

        svg.innerHTML = html;

        svg.querySelectorAll('.bpm-node').forEach(g => {
            g.addEventListener('mouseenter', () => g.querySelector('rect')?.setAttribute('opacity', '0.75'));
            g.addEventListener('mouseleave', () => g.querySelector('rect')?.setAttribute('opacity', '1'));
            g.addEventListener('click', () => {
                const id = g.dataset.procId;
                if (id) processosGerenciamento.abrirProcesso(id);
            });
        });
    },

    async abrirProcesso(id) {
        this._processoAtual = this._processos.find(p => p.id === id);
        if (!this._processoAtual) return;
        document.getElementById('proc-list-view').style.display   = 'none';
        document.getElementById('proc-detail-view').style.display = '';
        document.getElementById('proc-detail-title').textContent  = this._processoAtual.nome;
        document.getElementById('proc-detail-sub').textContent    = this._processoAtual.descricao || '';
        await this.carregarMaquinas(id);
    },

    voltarLista() {
        document.getElementById('proc-detail-view').style.display = 'none';
        document.getElementById('proc-list-view').style.display   = '';
        this._processoAtual = null;
    },

    async carregarMaquinas(processoId) {
        const data = await api.get(`/api/maquinas?processo_id=${processoId}`);
        this._maquinas = data || [];
        this.renderMaquinas();
    },

    renderMaquinas() {
        const tbody = document.getElementById('proc-maq-tbody');
        if (!tbody) return;
        if (!this._maquinas.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-dim);">Nenhuma máquina cadastrada neste processo.</td></tr>`;
            return;
        }
        const statusColor = s => ({ 'Ativo':'#26a69a','Manutenção':'#ffab76','Inativo':'#8b949e','Setup':'#26c6da' }[s] || '#8b949e');
        tbody.innerHTML = this._maquinas.map(m => `
            <tr style="transition:background .12s;" onmouseenter="this.style.background='rgba(255,255,255,.03)'" onmouseleave="this.style.background=''">
                <td style="font-weight:600;color:var(--indigo-primary);padding:14px 16px;">${escHTML(m.id_maquina || '—')}</td>
                <td style="padding:14px 16px;">${escHTML(m.modelo || '—')}</td>
                <td class="td-center" style="padding:14px 16px;">${m.oee != null ? Number(m.oee).toFixed(1) + '%' : '—'}</td>
                <td class="td-center" style="padding:14px 16px;">
                    <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:0.72rem;font-weight:600;
                        background:${statusColor(m.status)}22;color:${statusColor(m.status)};border:1px solid ${statusColor(m.status)}44;">
                        ${escHTML(m.status || '—')}
                    </span>
                </td>
                <td class="td-center" style="padding:14px 16px;">${m.n_pessoas != null ? m.n_pessoas : '—'}</td>
                <td style="padding:10px 16px;">
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button onclick="processosGerenciamento.abrirModalMaquina('${m.id}')"
                            style="display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:6px;border:1px solid rgba(88,166,255,.3);background:rgba(88,166,255,.06);color:#58a6ff;font-size:0.75rem;font-weight:600;cursor:pointer;white-space:nowrap;">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg>
                            Editar
                        </button>
                        <button onclick="processosGerenciamento.excluirMaquina('${m.id}')"
                            style="display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:6px;border:1px solid rgba(240,98,146,.3);background:rgba(240,98,146,.06);color:#f06292;font-size:0.75rem;font-weight:600;cursor:pointer;white-space:nowrap;">
                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,3.5 12.5,3.5"/><path d="M3 3.5V2.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1"/><path d="M4 5.5l.5 6a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9l.5-6"/></svg>
                            Excluir
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    abrirModalProcesso(id) {
        const p = id ? this._processos.find(x => x.id === id) : null;
        document.getElementById('proc-modal-title').textContent = p ? 'Editar Processo' : 'Novo Processo';
        document.getElementById('proc-modal-id').value   = p?.id || '';
        document.getElementById('proc-modal-nome').value = p?.nome || '';
        document.getElementById('proc-modal-desc').value = p?.descricao || '';
        document.getElementById('proc-modal').style.display = 'flex';
    },

    async salvarProcesso() {
        const id   = document.getElementById('proc-modal-id').value;
        const nome = document.getElementById('proc-modal-nome').value.trim();
        const desc = document.getElementById('proc-modal-desc').value.trim();
        if (!nome) { alert('Informe o nome do processo.'); return; }
        const res = id
            ? await api.put(`/api/processos-config/${id}`, { nome, descricao: desc })
            : await api.post('/api/processos-config', { nome, descricao: desc });
        if (res?.ok) {
            document.getElementById('proc-modal').style.display = 'none';
            await this.carregarProcessos();
            mostrarToast(id ? '✓ Processo atualizado' : '✓ Processo criado');
        } else {
            alert('Erro ao salvar: ' + (res?.erro || 'verifique se a tabela processos_config foi criada no Supabase e com RLS desabilitado.'));
        }
    },

    async excluirProcesso(id) {
        if (!confirm('Excluir este processo e todas as suas máquinas?')) return;
        await api.delete(`/api/processos-config/${id}`);
        await this.carregarProcessos();
    },

    abrirModalMaquina(id) {
        const m = id ? this._maquinas.find(x => x.id === id) : null;
        document.getElementById('maq-modal-title').textContent   = m ? 'Editar Máquina' : 'Adicionar Máquina';
        document.getElementById('maq-modal-id').value            = m?.id || '';
        document.getElementById('maq-modal-id-maq').value        = m?.id_maquina || '';
        document.getElementById('maq-modal-modelo').value        = m?.modelo || '';
        document.getElementById('maq-modal-oee').value           = m?.oee ?? '';
        document.getElementById('maq-modal-status').value        = m?.status || 'Ativo';
        document.getElementById('maq-modal-pessoas').value       = m?.n_pessoas ?? '';
        document.getElementById('maq-modal').style.display       = 'flex';
    },

    async salvarMaquina() {
        const id         = document.getElementById('maq-modal-id').value;
        const id_maquina = document.getElementById('maq-modal-id-maq').value.trim();
        const modelo     = document.getElementById('maq-modal-modelo').value.trim();
        const oee        = parseFloat(document.getElementById('maq-modal-oee').value) || null;
        const status     = document.getElementById('maq-modal-status').value;
        const n_pessoas  = parseInt(document.getElementById('maq-modal-pessoas').value) || null;
        if (!id_maquina && !modelo && oee == null && n_pessoas == null) {
            alert('Preencha pelo menos um campo.'); return;
        }
        const res = id
            ? await api.put(`/api/maquinas/${id}`, { id_maquina, modelo, oee, status, n_pessoas })
            : await api.post('/api/maquinas', { processo_id: this._processoAtual.id, id_maquina, modelo, oee, status, n_pessoas });
        if (res?.ok) {
            document.getElementById('maq-modal').style.display = 'none';
            await this.carregarMaquinas(this._processoAtual.id);
            mostrarToast(id ? '✓ Máquina atualizada' : '✓ Máquina adicionada');
        }
    },

    async excluirMaquina(id) {
        if (!confirm('Excluir esta máquina?')) return;
        await api.delete(`/api/maquinas/${id}`);
        await this.carregarMaquinas(this._processoAtual.id);
    }
};

// ====== IMPORTAÇÃO: BANCO DE DADOS ======

const banco = {
    rawData:   [],
    filtered:  [],
    colunas:   [],
    _importacoes: [],
    _currentId:   null,
    _nomeArquivo: '',
    _col1: null, _col1Values: [], _col1Selected: '',
    _col2: null, _col2Values: [], _col2Selected: '',
    _colQtd: null,

    init() {
        this.setupDropZone();
        this.setupFileInput();
        this.setupFiltros();
    },

    setupDropZone() {
        const zone = document.getElementById('banco-drop-zone');
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault(); zone.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f) this.handleFile(f);
        });
    },

    setupFileInput() {
        const inp = document.getElementById('file-input-banco');
        inp.addEventListener('change', e => {
            const f = e.target.files[0];
            if (f) this.handleFile(f);
            inp.value = '';
        });
    },

    setupFiltros() {
        document.getElementById('banco-search').addEventListener('input', () => this.aplicarFiltros());
        this._setupCombo('banco-col1-input','banco-col1-dropdown','_col1Selected','_col1Values');
        this._setupCombo('banco-col2-input','banco-col2-dropdown','_col2Selected','_col2Values');
    },

    limpar() {
        document.getElementById('banco-search').value = '';
        this._col1Selected = '';
        this._col2Selected = '';
        document.getElementById('banco-col1-input').value = '';
        document.getElementById('banco-col2-input').value = '';
        document.getElementById('banco-col1-dropdown').classList.remove('open');
        document.getElementById('banco-col2-dropdown').classList.remove('open');
        this.aplicarFiltros();
    },

    _setupCombo(inputId, dropId, selKey, valsKey) {
        const input = document.getElementById(inputId);
        const drop  = document.getElementById(dropId);
        input.addEventListener('focus', () => { this._renderDrop(drop, input, selKey, valsKey, ''); drop.classList.add('open'); });
        input.addEventListener('input', () => {
            this[selKey] = '';
            this._renderDrop(drop, input, selKey, valsKey, input.value);
            drop.classList.add('open');
            this.aplicarFiltros();
        });
        document.addEventListener('mousedown', e => {
            if (!e.target.closest(`#${dropId}`) && !e.target.closest(`#${inputId}`)) drop.classList.remove('open');
        });
    },

    _renderDrop(drop, input, selKey, valsKey, q) {
        const term = q.toLowerCase().trim();
        const vals = this[valsKey];
        const matches = term ? vals.filter(v => v.toLowerCase().includes(term)) : vals;
        drop.innerHTML = `<div class="combobox-option clear-opt" data-val="">Todos</div>` +
            matches.slice(0, 100).map(v =>
                `<div class="combobox-option${v === this[selKey] ? ' active' : ''}" data-val="${escHTML(v)}">${escHTML(v)}</div>`
            ).join('');
        drop.querySelectorAll('.combobox-option').forEach(el => {
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                this[selKey] = el.dataset.val;
                input.value  = el.dataset.val;
                drop.classList.remove('open');
                this.aplicarFiltros();
            });
        });
    },

    normalizeKey(key) {
        return String(key).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
    },

    // Mapeamento fixo por posição de coluna
    _SCHEMA: [
        'Código','Descrição','Modelo','Segmento','Marca','Stoll',
        'Tamanho','Tempo Tecelagem','Tempo Tece Frente','Tempo Tece Costas',
        'Tempo Costura Manual','Tempo Costura Automática','Soldagem','Silicone','Embalagem'
    ],

    handleFile(file) {
        this._nomeArquivo = file.name;
        const ext = file.name.split('.').pop().toLowerCase();
        const processar = (rawRows) => {
            // Pula linhas vazias do topo para achar o cabeçalho real
            let headerIdx = 0;
            for (let i = 0; i < rawRows.length; i++) {
                if (rawRows[i].filter(c => String(c).trim() !== '').length >= 3) { headerIdx = i; break; }
            }
            const excelCols = rawRows[headerIdx];
            // Primeiras N colunas recebem nomes fixos do schema; demais usam o nome do Excel
            const headers = excelCols.map((h, i) =>
                i < this._SCHEMA.length ? this._SCHEMA[i] : (String(h).trim() || `Coluna_${i + 1}`)
            );
            const dataRows = rawRows.slice(headerIdx + 1)
                .filter(row => row.some(c => String(c).trim() !== ''))
                .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
            this.processData(dataRows, headers);
        };
        if (ext === 'csv') {
            Papa.parse(file, { header: false, skipEmptyLines: false, complete: r => processar(r.data) });
        } else if (['xls','xlsx'].includes(ext)) {
            const reader = new FileReader();
            reader.onload = e => {
                const wb = XLSX.read(e.target.result, { type: 'array' });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                processar(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' }));
            };
            reader.readAsArrayBuffer(file);
        }
    },

    processData(rows, headers) {
        if (!rows?.length) return;
        this.colunas = headers || Object.keys(rows[0]).filter(h => !this.normalizeKey(h).startsWith('__'));
        this._colQtd = null; // banco de dados não tem coluna de quantidade
        this.rawData = rows.map((r, i) => ({
            _id: i,
            dados: Object.fromEntries(this.colunas.map(h => [h, r[h] ?? '']))
        }));
        this.filtered = [...this.rawData];
        this._finalizarImport();
    },

    _finalizarImport() {
        this._detectCombosCols();
        document.getElementById('banco-drop-zone').style.display = 'none';
        document.getElementById('banco-data').classList.add('visible');
        this.render();
        this.perguntarESalvar(this._nomeArquivo);
    },

    _detectCombosCols() {
        // Filtros fixos pelo schema: col1 = Segmento, col2 = Modelo
        const find = (...names) => {
            for (const n of names) {
                const found = this.colunas.find(c => this.normalizeKey(c) === this.normalizeKey(n));
                if (found) return found;
            }
            return this.colunas.find(c => names.some(n => this.normalizeKey(c).includes(this.normalizeKey(n)))) || null;
        };
        this._col1 = find('Segmento', 'segmento', 'seg', 'familia');
        this._col2 = find('Modelo', 'modelo', 'marca', 'stoll');

        const uniq = col => col
            ? [...new Set(this.rawData.map(r => String(r.dados?.[col] ?? '')).filter(Boolean))].sort()
            : [];

        this._col1Values = uniq(this._col1);
        this._col2Values = uniq(this._col2);
        this._col1Selected = '';
        this._col2Selected = '';

        const w1 = document.getElementById('banco-col1-wrap');
        const w2 = document.getElementById('banco-col2-wrap');
        const i1 = document.getElementById('banco-col1-input');
        const i2 = document.getElementById('banco-col2-input');

        if (this._col1) { i1.placeholder = `Filtrar ${this._col1}...`; i1.value = ''; w1.style.display = ''; }
        else w1.style.display = 'none';
        if (this._col2) { i2.placeholder = `Filtrar ${this._col2}...`; i2.value = ''; w2.style.display = ''; }
        else w2.style.display = 'none';
    },

    aplicarFiltros() {
        const q = document.getElementById('banco-search').value.toLowerCase().trim();
        this.filtered = this.rawData.filter(r => {
            if (q && !Object.values(r.dados).some(v => String(v).toLowerCase().includes(q))) return false;
            if (this._col1Selected && String(r.dados?.[this._col1] ?? '') !== this._col1Selected) return false;
            if (this._col2Selected && String(r.dados?.[this._col2] ?? '') !== this._col2Selected) return false;
            return true;
        });
        this.render();
    },

    render() {
        const total = this.rawData.length;
        const filt  = this.filtered.length;
        const qtd   = this._colQtd
            ? this.filtered.reduce((s, r) => s + (parseFloat(String(r.dados?.[this._colQtd] ?? '0').replace(',','.')) || 0), 0)
            : 0;

        document.getElementById('banco-total').textContent     = total.toLocaleString('pt-BR');
        document.getElementById('banco-qtd').textContent       = this._colQtd ? qtd.toLocaleString('pt-BR') : '—';
        document.getElementById('banco-filtrados').textContent = filt.toLocaleString('pt-BR');
        document.getElementById('banco-count').textContent     = `${filt.toLocaleString('pt-BR')} registros${filt > 2000 ? ' (exibindo 2000)' : ''}`;

        const table = document.getElementById('banco-table');
        table.querySelector('thead tr').innerHTML =
            this.colunas.map(h => `<th>${h.toUpperCase()}</th>`).join('');
        table.querySelector('tbody').innerHTML = this.filtered.slice(0, 2000).map(r => {
            const cells = this.colunas.map(h => {
                const v = r.dados?.[h];
                return `<td>${v !== undefined && v !== '' ? v : '<span style="opacity:.3">—</span>'}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
    },

    async perguntarESalvar(nome) {
        this._nomeArquivo = nome;
        await this.salvar('nova');
    },

    async salvar(modo) {
        document.getElementById('import-modal').style.display = 'none';
        this._setSaving(true);
        try {
            if (modo === 'substituir' && this._currentId) {
                await api.deletarImportacaoBanco(this._currentId);
            }
            const linhas = this.rawData.map(r => ({ dados: r.dados }));
            const res = await api.post('/api/banco/import', { nomeArquivo: this._nomeArquivo, linhas });
            if (res?.ok) {
                this._currentId = res.importacaoId;
                mostrarToast(`✓ ${this.rawData.length.toLocaleString('pt-BR')} registros salvos`);
            } else {
                mostrarToast(res?.erro || 'Erro ao salvar Banco', 'erro');
            }
        } catch(e) {
            mostrarToast('Erro de conexão ao salvar', 'erro');
        } finally { this._setSaving(false); }
        await this.carregarHistorico();
    },

    _setSaving(v) {
        const el = document.getElementById('banco-saving');
        if (el) el.style.display = v ? '' : 'none';
    },

    async carregarHistorico() {
        const lista = await api.get('/api/importacoes-banco');
        this._importacoes = lista || [];
        if (lista?.length) {
            const latest = lista[0];
            const incompleto = this.rawData.length < (latest.total_linhas || 0);
            if (!this._currentId || this._currentId !== latest.id || incompleto) {
                await this.carregarImportacao(latest.id); return;
            }
        }
        this.renderHistorico();
    },

    async carregarImportacao(id) {
        const rows = await api.get(`/api/banco?importacao_id=${id}`);
        if (!rows?.length) return;
        this._currentId = id;
        this.colunas  = Object.keys(rows[0].dados || {});
        this.rawData  = rows.map((r, i) => ({ _id: i, dados: r.dados }));
        const QTD_KEYS = ['quantidade','qtd','qty','qtde','saldo','pecas','pcs','aproduzir'];
        this._colQtd = this.colunas.find(h => QTD_KEYS.includes(this.normalizeKey(h))) || null;
        this.filtered = [...this.rawData];
        this._detectCombosCols();
        document.getElementById('banco-drop-zone').style.display = 'none';
        document.getElementById('banco-data').classList.add('visible');
        this.render();
        this.renderHistorico();
        lsCache.salvar('banco', { importacaoId: id, colunas: this.colunas, rawData: this.rawData });
    },

    renderHistorico() {
        const wrap = document.getElementById('banco-history');
        const list = document.getElementById('banco-history-list');
        if (!this._importacoes?.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        list.innerHTML = this._importacoes.map(imp => {
            const d    = new Date(imp.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
            const ativo = imp.id === this._currentId;
            return `<div class="hi-item${ativo ? ' hi-ativo' : ''}" onclick="banco.carregarImportacao('${imp.id}')">
                <span class="hi-dot">${ativo ? '●' : '○'}</span>
                <div class="hi-info">
                    <span class="hi-nome">${escHTML(imp.nome_arquivo)}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} registros</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();banco.excluir('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
        list.style.display = 'flex';
        const chev = document.getElementById('chevron-banco');
        if (chev) chev.style.transform = 'rotate(90deg)';
    },

    exportar() {
        if (!this.filtered.length) return;
        exportarXLS(this.filtered.map(r => r.dados), 'banco_dados');
    },

    async excluir(id) {
        if (!confirm('Excluir esta importação?')) return;
        await api.deletarImportacaoBanco(id);
        if (this._currentId === id) {
            this.rawData = []; this.filtered = [];
            document.getElementById('banco-data').classList.remove('visible');
            document.getElementById('banco-drop-zone').style.display = '';
            this._currentId = null;
        }
        await this.carregarHistorico();
    }
};

// ====== IMPORTAÇÃO: COSTURA ======

const costura = {
    rawData:   [],
    filtered:  [],
    colunas:   [],
    _importacoes: [],
    _currentId:   null,
    _nomeArquivo: '',
    _col1: null, _col1Values: [], _col1Selected: '',
    _col2: null, _col2Values: [], _col2Selected: '',
    _colQtd: null,

    init() {
        this.setupDropZone();
        this.setupFileInput();
        this.setupFiltros();
    },

    setupDropZone() {
        const zone = document.getElementById('costura-drop-zone');
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault(); zone.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f) this.handleFile(f);
        });
    },

    setupFileInput() {
        const inp = document.getElementById('file-input-costura');
        inp.addEventListener('change', e => {
            const f = e.target.files[0];
            if (f) this.handleFile(f);
            inp.value = '';
        });
    },

    setupFiltros() {
        document.getElementById('costura-search').addEventListener('input', () => this.aplicarFiltros());
        this._setupCombo('costura-col1-input','costura-col1-dropdown','_col1Selected','_col1Values');
        this._setupCombo('costura-col2-input','costura-col2-dropdown','_col2Selected','_col2Values');
    },

    limpar() {
        document.getElementById('costura-search').value = '';
        this._col1Selected = '';
        this._col2Selected = '';
        document.getElementById('costura-col1-input').value = '';
        document.getElementById('costura-col2-input').value = '';
        document.getElementById('costura-col1-dropdown').classList.remove('open');
        document.getElementById('costura-col2-dropdown').classList.remove('open');
        this.aplicarFiltros();
    },

    _setupCombo(inputId, dropId, selKey, valsKey) {
        const input = document.getElementById(inputId);
        const drop  = document.getElementById(dropId);
        input.addEventListener('focus', () => { this._renderDrop(drop, input, selKey, valsKey, ''); drop.classList.add('open'); });
        input.addEventListener('input', () => {
            this[selKey] = '';
            this._renderDrop(drop, input, selKey, valsKey, input.value);
            drop.classList.add('open');
            this.aplicarFiltros();
        });
        document.addEventListener('mousedown', e => {
            if (!e.target.closest(`#${dropId}`) && !e.target.closest(`#${inputId}`)) drop.classList.remove('open');
        });
    },

    _renderDrop(drop, input, selKey, valsKey, q) {
        const term = q.toLowerCase().trim();
        const vals = this[valsKey];
        const matches = term ? vals.filter(v => v.toLowerCase().includes(term)) : vals;
        drop.innerHTML = `<div class="combobox-option clear-opt" data-val="">Todos</div>` +
            matches.slice(0, 100).map(v =>
                `<div class="combobox-option${v === this[selKey] ? ' active' : ''}" data-val="${escHTML(v)}">${escHTML(v)}</div>`
            ).join('');
        drop.querySelectorAll('.combobox-option').forEach(el => {
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                this[selKey] = el.dataset.val;
                input.value  = el.dataset.val;
                drop.classList.remove('open');
                this.aplicarFiltros();
            });
        });
    },

    normalizeKey(key) {
        return String(key).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
    },

    handleFile(file) {
        this._nomeArquivo = file.name;
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'csv') {
            Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => this.processData(r.data) });
        } else if (['xls','xlsx'].includes(ext)) {
            const reader = new FileReader();
            reader.onload = e => {
                const wb   = XLSX.read(e.target.result, { type: 'array' });
                const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                this.processData(data);
            };
            reader.readAsArrayBuffer(file);
        }
    },

    processData(rows) {
        if (!rows?.length) return;
        const IGNORAR = new Set([
            'lote','codrastreabilidade','codigorastreabilidade','rastreabilidade',
            'validade','caracteristica','caracteristicas','almoxarifado',
            'divisaodoproduto','divisao','linhadoproduto','linha',
            'marcadoproduto','marca'
        ]);
        const allHeaders = Object.keys(rows[0]).filter(h => {
            const n = this.normalizeKey(h);
            return n && !n.startsWith('__') && !IGNORAR.has(n);
        });
        const QTD_KEYS = ['quantidade','qtd','qty','qtde','saldo','pecas','pcs','aproduzir'];
        const qtdNorm  = allHeaders.find(h => QTD_KEYS.includes(this.normalizeKey(h)));
        this._colQtd   = qtdNorm || null;
        this.colunas   = allHeaders;
        const refKey = allHeaders.find(h => this.normalizeKey(h) === 'referencia' || this.normalizeKey(h) === 'ref');
        this.rawData   = rows.map((r, i) => {
            const dados = Object.fromEntries(allHeaders.map(h => [h, r[h] ?? '']));
            if (refKey && dados[refKey]) dados[refKey] = String(dados[refKey]).split(/[\s\-|]/)[0].trim();
            return { _id: i, dados };
        });
        this.filtered = [...this.rawData];
        this._finalizarImport();
    },

    _finalizarImport() {
        this._detectCombosCols();
        document.getElementById('costura-drop-zone').style.display = 'none';
        document.getElementById('costura-data').classList.add('visible');
        this.render();
        this.perguntarESalvar(this._nomeArquivo);
    },

    _detectCombosCols() {
        const STATUS_KEYS  = ['status','situacao','situação','estado'];
        const DESC_KEYS    = ['descricao','descr','desc','produto','descproduto','modelo'];
        const SEG_KEYS     = ['segmento','seg','familia','linha'];
        const find = keys => this.colunas.find(c => keys.includes(this.normalizeKey(c)));

        this._col1 = find(STATUS_KEYS) || this.colunas.find(c => STATUS_KEYS.some(k => this.normalizeKey(c).includes(k)));
        this._col2 = find(SEG_KEYS) || find(DESC_KEYS) || this.colunas.find(c => {
            const n = this.normalizeKey(c);
            return SEG_KEYS.some(k => n.includes(k)) || DESC_KEYS.some(k => n.includes(k));
        });

        const uniq = col => col
            ? [...new Set(this.rawData.map(r => String(r.dados?.[col] ?? '')).filter(Boolean))].sort()
            : [];

        this._col1Values = uniq(this._col1);
        this._col2Values = uniq(this._col2);
        this._col1Selected = '';
        this._col2Selected = '';

        const w1 = document.getElementById('costura-col1-wrap');
        const w2 = document.getElementById('costura-col2-wrap');
        const i1 = document.getElementById('costura-col1-input');
        const i2 = document.getElementById('costura-col2-input');

        if (this._col1) { i1.placeholder = `Filtrar ${this._col1}...`; i1.value = ''; w1.style.display = ''; }
        else w1.style.display = 'none';
        if (this._col2) { i2.placeholder = `Filtrar ${this._col2}...`; i2.value = ''; w2.style.display = ''; }
        else w2.style.display = 'none';
    },

    aplicarFiltros() {
        const q = document.getElementById('costura-search').value.toLowerCase().trim();
        this.filtered = this.rawData.filter(r => {
            if (q && !Object.values(r.dados).some(v => String(v).toLowerCase().includes(q))) return false;
            if (this._col1Selected && String(r.dados?.[this._col1] ?? '') !== this._col1Selected) return false;
            if (this._col2Selected && String(r.dados?.[this._col2] ?? '') !== this._col2Selected) return false;
            return true;
        });
        this.render();
    },

    render() {
        const total = this.rawData.length;
        const filt  = this.filtered.length;
        const qtd   = this._colQtd
            ? this.filtered.reduce((s, r) => s + (parseFloat(String(r.dados?.[this._colQtd] ?? '0').replace(',','.')) || 0), 0)
            : 0;

        document.getElementById('costura-total').textContent     = total.toLocaleString('pt-BR');
        document.getElementById('costura-qtd').textContent       = this._colQtd ? qtd.toLocaleString('pt-BR') : '—';
        document.getElementById('costura-filtrados').textContent = filt.toLocaleString('pt-BR');
        document.getElementById('costura-count').textContent     = `${filt.toLocaleString('pt-BR')} registros${filt > 2000 ? ' (exibindo 2000)' : ''}`;

        const table = document.getElementById('costura-table');
        table.querySelector('thead tr').innerHTML =
            this.colunas.map(h => `<th>${h.toUpperCase()}</th>`).join('');
        table.querySelector('tbody').innerHTML = this.filtered.slice(0, 2000).map(r => {
            const cells = this.colunas.map(h => {
                const v = r.dados?.[h];
                return `<td>${v !== undefined && v !== '' ? v : '<span style="opacity:.3">—</span>'}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
    },

    async perguntarESalvar(nome) {
        this._nomeArquivo = nome;
        await this.salvar('nova');
    },

    async salvar(modo) {
        document.getElementById('import-modal').style.display = 'none';
        this._setSaving(true);
        try {
            if (modo === 'substituir' && this._currentId) {
                await api.deletarImportacaoCostura(this._currentId);
            }
            const linhas = this.rawData.map(r => ({ dados: r.dados }));
            const res = await api.post('/api/costura/import', { nomeArquivo: this._nomeArquivo, linhas });
            if (res?.ok) {
                this._currentId = res.importacaoId;
                mostrarToast(`✓ ${this.rawData.length.toLocaleString('pt-BR')} registros salvos`);
            } else {
                mostrarToast(res?.erro || 'Erro ao salvar Costura', 'erro');
            }
        } catch(e) {
            mostrarToast('Erro de conexão ao salvar', 'erro');
        } finally { this._setSaving(false); }
        await this.carregarHistorico();
    },

    _setSaving(v) {
        const el = document.getElementById('costura-saving');
        if (el) el.style.display = v ? '' : 'none';
    },

    async carregarHistorico() {
        const lista = await api.get('/api/importacoes-costura');
        this._importacoes = lista || [];
        if (lista?.length) {
            const latest = lista[0];
            const incompleto = this.rawData.length < (latest.total_linhas || 0);
            if (!this._currentId || this._currentId !== latest.id || incompleto) {
                await this.carregarImportacao(latest.id); return;
            }
        }
        this.renderHistorico();
    },

    async carregarImportacao(id) {
        const rows = await api.get(`/api/costura?importacao_id=${id}`);
        if (!rows?.length) return;
        this._currentId = id;
        const IGNORAR = new Set([
            'lote','codrastreabilidade','codigorastreabilidade','rastreabilidade',
            'validade','caracteristica','caracteristicas','almoxarifado',
            'divisaodoproduto','divisao','linhadoproduto','linha',
            'marcadoproduto','marca'
        ]);
        this.colunas  = Object.keys(rows[0].dados || {}).filter(h => !IGNORAR.has(this.normalizeKey(h)));
        this.rawData  = rows.map((r, i) => ({ _id: i, dados: r.dados }));
        const QTD_KEYS = ['quantidade','qtd','qty','qtde','saldo','pecas','pcs','aproduzir'];
        this._colQtd = this.colunas.find(h => QTD_KEYS.includes(this.normalizeKey(h))) || null;
        this.filtered = [...this.rawData];
        this._detectCombosCols();
        document.getElementById('costura-drop-zone').style.display = 'none';
        document.getElementById('costura-data').classList.add('visible');
        this.render();
        this.renderHistorico();
        lsCache.salvar('costura', { importacaoId: id, colunas: this.colunas, rawData: this.rawData });
        pesquisa._dirty = true;
    },

    renderHistorico() {
        const wrap = document.getElementById('costura-history');
        const list = document.getElementById('costura-history-list');
        if (!this._importacoes?.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        list.innerHTML = this._importacoes.map(imp => {
            const d    = new Date(imp.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
            const ativo = imp.id === this._currentId;
            return `<div class="hi-item${ativo ? ' hi-ativo' : ''}" onclick="costura.carregarImportacao('${imp.id}')">
                <span class="hi-dot">${ativo ? '●' : '○'}</span>
                <div class="hi-info">
                    <span class="hi-nome">${escHTML(imp.nome_arquivo)}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} registros</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();costura.excluir('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
        list.style.display = 'flex';
        const chev = document.getElementById('chevron-costura');
        if (chev) chev.style.transform = 'rotate(90deg)';
    },

    exportar() {
        if (!this.filtered.length) return;
        exportarXLS(this.filtered.map(r => r.dados), 'costura');
    },

    async excluir(id) {
        if (!confirm('Excluir esta importação?')) return;
        await api.deletarImportacaoCostura(id);
        if (this._currentId === id) {
            this.rawData = []; this.filtered = [];
            document.getElementById('costura-data').classList.remove('visible');
            document.getElementById('costura-drop-zone').style.display = '';
            this._currentId = null;
        }
        await this.carregarHistorico();
    }
};

// ====== DASHBOARD: CURVA ABC ======

const TRIMESTRES = {
    Q1: ['jan','fev','mar'],
    Q2: ['abr','mai','jun'],
    Q3: ['jul','ago','set'],
    Q4: ['out','nov','dez']
};

const abc = {
    selectedYear:       'all',
    selectedMonth:      '',
    selectedTrimestre:  '',
    selectedGrupo:      'descricao',
    _selectedClasse: null,
    _items:          [],
    _zonas:          {},
    _busca:          '',

    init() {
        document.getElementById('abc-year-tabs').addEventListener('click', e => {
            const btn = e.target.closest('.year-tab');
            if (!btn) return;
            document.querySelectorAll('#abc-year-tabs .year-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.selectedYear      = btn.dataset.year;
            this.selectedMonth     = '';
            this.selectedTrimestre = '';
            this._selectedClasse   = null;
            document.getElementById('abc-month-sel').value = '';
            document.getElementById('abc-tri-sel').value   = '';
            this.render();
        });
        document.getElementById('abc-month-sel').addEventListener('change', e => {
            this.selectedMonth = e.target.value;
            this._selectedClasse = null;
            if (e.target.value) { this.selectedTrimestre = ''; document.getElementById('abc-tri-sel').value = ''; }
            this.render();
        });
        document.getElementById('abc-tri-sel').addEventListener('change', e => {
            this.selectedTrimestre = e.target.value;
            this._selectedClasse = null;
            if (e.target.value) { this.selectedMonth = ''; document.getElementById('abc-month-sel').value = ''; }
            this.render();
        });
        document.getElementById('abc-grupo-sel').addEventListener('change', e => {
            this.selectedGrupo = e.target.value;
            this.render();
        });
        document.getElementById('abc-busca').addEventListener('input', e => {
            this._busca = e.target.value.trim().toLowerCase();
            this.renderTable();
        });
    },

    render() {
        const countEl = document.getElementById('abc-count');
        if (!vendas.rawData.length) {
            countEl.textContent = 'Importe dados de Vendas primeiro';
            ['a','b','c'].forEach(k => {
                document.getElementById(`abc-${k}-count`).textContent = '0';
                document.getElementById(`abc-${k}-qtd`).textContent = '—';
            });
            document.querySelector('#abc-table tbody').innerHTML = '';
            return;
        }

        // Year tabs
        const tabsEl = document.getElementById('abc-year-tabs');
        if (vendas.years.length === 1) this.selectedYear = vendas.years[0];
        tabsEl.innerHTML = vendas.years.map(y =>
            `<button class="year-tab${this.selectedYear === y ? ' active' : ''}" data-year="${y}">${y}</button>`
        ).join('') + (vendas.years.length > 1
            ? `<button class="year-tab${this.selectedYear === 'all' ? ' active' : ''}" data-year="all">Todos</button>`
            : '');

        // Active columns for selected period
        const allCols = this.selectedYear === 'all' ? vendas.monthCols : vendas.monthCols.filter(c => c.year === this.selectedYear);

        // Trimestre ou mês
        let activeCols, divisor;
        if (this.selectedTrimestre && TRIMESTRES[this.selectedTrimestre]) {
            const triMeses = TRIMESTRES[this.selectedTrimestre];
            activeCols = allCols.filter(c => triMeses.includes(c.abbr));
            divisor    = 3;
        } else if (this.selectedMonth) {
            activeCols = allCols.filter(c => c.abbr === this.selectedMonth);
            divisor    = 1;
        } else {
            activeCols = allCols;
            divisor    = 1;
        }

        // Month selector
        const monthSel    = document.getElementById('abc-month-sel');
        const uniqueAbbrs = [...new Set(allCols.map(c => c.abbr))];
        monthSel.innerHTML = '<option value="">Todos</option>' +
            MONTHS.filter(m => uniqueAbbrs.includes(m))
                  .map(m => `<option value="${m}" ${this.selectedMonth === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`)
                  .join('');

        // Aggregate vendas by grupo (com divisão por 3 se trimestre)
        const map = {};
        vendas.rawData.forEach(r => {
            const key = this.selectedGrupo === 'descricao' ? r.descricao
                      : this.selectedGrupo === 'marca'     ? (r.marca || '—')
                      : r.codigo;
            const qtd = Math.round(activeCols.reduce((s, c) => s + (r[c.key] || 0), 0) / divisor);
            if (!map[key]) map[key] = { label: key, quantidade: 0, _mods: new Set(), _marcas: new Set(), _tams: new Set() };
            map[key].quantidade += qtd;
            if (r.modelo)   map[key]._mods.add(r.modelo);
            if (r.marca)    map[key]._marcas.add(r.marca);
            if (r.tamanho)  map[key]._tams.add(r.tamanho);
        });

        const TAM_ORDER = ['PP','P','M','G','GG','XG','XXG','XGG'];
        const sorted = Object.values(map).filter(i => i.quantidade > 0).sort((a, b) => b.quantidade - a.quantidade);
        sorted.forEach(it => {
            it.modelo  = [...it._mods].join(' / ') || '—';
            it.marca   = [...it._marcas].join(' / ') || '—';
            it.tamanho = [...it._tams].sort((a,b) => (TAM_ORDER.indexOf(a)||99) - (TAM_ORDER.indexOf(b)||99)).join(' · ') || '—';
        });
        if (!sorted.length) {
            countEl.textContent = 'Sem dados no período selecionado';
            ['a','b','c'].forEach(k => {
                document.getElementById(`abc-${k}-count`).textContent = '0';
                document.getElementById(`abc-${k}-qtd`).textContent = '—';
            });
            document.querySelector('#abc-table tbody').innerHTML = '';
            return;
        }

        const total = sorted.reduce((s, i) => s + i.quantidade, 0);
        let cumQtd = 0;
        const items = sorted.map(r => {
            cumQtd += r.quantidade;
            const cumPct = cumQtd / total * 100;
            return { ...r, pct: r.quantidade / total * 100, cumPct,
                     classe: cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C' };
        });

        const cA = items.filter(i => i.classe === 'A');
        const cB = items.filter(i => i.classe === 'B');
        const cC = items.filter(i => i.classe === 'C');
        const fmtQ = q => q.toLocaleString('pt-BR') + ' un';

        document.getElementById('abc-a-count').textContent = cA.length;
        document.getElementById('abc-b-count').textContent = cB.length;
        document.getElementById('abc-c-count').textContent = cC.length;
        document.getElementById('abc-a-qtd').textContent = fmtQ(cA.reduce((s,i) => s + i.quantidade, 0));
        document.getElementById('abc-b-qtd').textContent = fmtQ(cB.reduce((s,i) => s + i.quantidade, 0));
        document.getElementById('abc-c-qtd').textContent = fmtQ(cC.reduce((s,i) => s + i.quantidade, 0));
        countEl.textContent = `${items.length.toLocaleString('pt-BR')} itens analisados`;

        this._items = items;
        this._setupCardClicks('abc');
        this._updateCardStyles('abc');
        setTimeout(() => this.drawChart(items), 30);
        this.renderTable();
    },

    drawChart(items) {
        const canvas = document.getElementById('abc-chart');
        if (!canvas || !items.length) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width  = canvas.offsetWidth || 800;
        const h = canvas.height = 160;
        ctx.clearRect(0, 0, w, h);

        const padL = 8, padR = 42, padT = 18, padB = 20;
        const n      = items.length;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        const iA = items.findIndex(i => i.classe !== 'A');
        const iB = items.findIndex(i => i.classe === 'C');
        const bA = iA < 0 ? n : iA;
        const bB = iB < 0 ? n : iB;
        const xA = padL + (bA / n) * chartW;
        const xB = padL + (bB / n) * chartW;

        ctx.fillStyle = 'rgba(38,198,218,0.07)';
        ctx.fillRect(padL, padT, xA - padL, chartH);
        ctx.fillStyle = 'rgba(255,171,118,0.07)';
        ctx.fillRect(xA, padT, xB - xA, chartH);
        ctx.fillStyle = 'rgba(139,148,158,0.05)';
        ctx.fillRect(xB, padT, w - padR - xB, chartH);

        ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
        if (bA > 0) {
            ctx.fillStyle = 'rgba(38,198,218,0.65)';
            ctx.fillText('A', padL + (xA - padL) / 2, padT + 11);
        }
        if (bB > bA) {
            ctx.fillStyle = 'rgba(255,171,118,0.65)';
            ctx.fillText('B', xA + (xB - xA) / 2, padT + 11);
        }
        if (n > bB) {
            ctx.fillStyle = 'rgba(139,148,158,0.6)';
            ctx.fillText('C', xB + (w - padR - xB) / 2, padT + 11);
        }

        [80, 95].forEach(pct => {
            const y = padT + chartH * (1 - pct / 100);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '8px Inter'; ctx.textAlign = 'left';
            ctx.fillText(`${pct}%`, w - padR + 4, y + 3);
        });

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(38,198,218,0.85)';
        ctx.lineWidth = 2;
        items.forEach((item, i) => {
            const x = padL + (i / Math.max(n - 1, 1)) * chartW;
            const y = padT + chartH * (1 - item.cumPct / 100);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        const lastX = padL + chartW;
        ctx.lineTo(lastX, padT + chartH);
        ctx.lineTo(padL, padT + chartH);
        ctx.closePath();
        ctx.fillStyle = 'rgba(38,198,218,0.05)';
        ctx.fill();

        ctx.fillStyle = 'rgba(139,148,158,0.5)';
        ctx.font = '8px Inter'; ctx.textAlign = 'left';
        [0, 50, 100].forEach(pct => {
            ctx.fillText(`${pct}%`, w - padR + 4, padT + chartH * (1 - pct / 100) + 3);
        });

        // Salva zonas e adiciona clique no gráfico
        this._zonas = { padL, chartW, n, bA, bB, canvas };
        canvas.style.cursor = 'pointer';
        canvas.onclick = e => {
            const rect = canvas.getBoundingClientRect();
            const mx   = (e.clientX - rect.left) * (canvas.width / rect.width);
            const xAc  = padL + (bA / n) * chartW;
            const xBc  = padL + (bB / n) * chartW;
            const zona  = mx < xAc ? 'A' : mx < xBc ? 'B' : 'C';
            this.filtrarClasse(zona, 'abc');
        };
    },

    filtrarClasse(classe, prefix) {
        this._selectedClasse = this._selectedClasse === classe ? null : classe;
        this._updateCardStyles(prefix || 'abc');
        this.renderTable();
    },

    _setupCardClicks(prefix) {
        ['A','B','C'].forEach(c => {
            const card = document.getElementById(`${prefix}-${c.toLowerCase()}-count`)?.closest('.summary-card');
            if (card) { card.style.cursor = 'pointer'; card.onclick = () => this.filtrarClasse(c, prefix); }
        });
    },

    _updateCardStyles(prefix) {
        ['A','B','C'].forEach(c => {
            const card = document.getElementById(`${prefix}-${c.toLowerCase()}-count`)?.closest('.summary-card');
            if (!card) return;
            const ativo = this._selectedClasse === c;
            card.style.outline     = ativo ? `2px solid var(--indigo-primary)` : '';
            card.style.opacity     = (!this._selectedClasse || ativo) ? '1' : '0.4';
        });
    },

    renderTable() {
        if (!this._items?.length) return;
        const isDesc  = this.selectedGrupo === 'descricao';
        const isMarca = this.selectedGrupo === 'marca';
        let visible = this._selectedClasse
            ? this._items.filter(i => i.classe === this._selectedClasse)
            : this._items;
        if (this._busca) {
            visible = visible.filter(i =>
                i.label.toLowerCase().includes(this._busca) ||
                (i.modelo  || '').toLowerCase().includes(this._busca) ||
                (i.marca   || '').toLowerCase().includes(this._busca)
            );
        }
        const countEl = document.getElementById('abc-count');
        if (countEl) countEl.textContent = this._busca
            ? `${visible.length} resultado${visible.length !== 1 ? 's' : ''} encontrado${visible.length !== 1 ? 's' : ''}`
            : this._selectedClasse
                ? `${visible.length} itens — Classe ${this._selectedClasse} (clique para ver todos)`
                : `${this._items.length.toLocaleString('pt-BR')} itens analisados`;
        document.querySelector('#abc-table thead tr').innerHTML = `
            <th style="width:40px;">#</th>
            <th>${isDesc ? 'DESCRIÇÃO' : isMarca ? 'MARCA' : 'CÓDIGO'}</th>
            <th>MODELO</th>
            <th>MARCA</th>
            <th>TAMANHO</th>
            <th class="td-right">VENDAS</th>
            <th class="td-right">% TOTAL</th>
            <th class="td-right">% ACUM.</th>
            <th class="td-center" style="width:80px;">CLASSE</th>
        `;
        document.querySelector('#abc-table tbody').innerHTML = visible.map((r, i) => {
            const cls     = `abc-${r.classe.toLowerCase()}`;
            const cellCls = isDesc ? 'td-desc' : isMarca ? 'td-desc' : 'td-code';
            const seg = vendas.rawData.find(v => (isDesc ? v.descricao : v.codigo) === r.label)?.segmento || '';
            const clickAttr = isDesc
                ? `onclick="abrirDetalhe('${escJS(r.label)}','${escJS(seg)}'); event.stopPropagation();" style="cursor:pointer;"`
                : '';
            return `<tr ${clickAttr} title="${isDesc ? 'Clique para ver detalhe' : ''}">
                <td class="td-dim td-center">${i + 1}</td>
                <td class="${cellCls}" style="${(isDesc || isMarca) ? 'color:var(--indigo-primary);' : ''}">${escHTML(r.label)}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${escHTML(r.modelo) || '—'}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${escHTML(r.marca)  || '—'}</td>
                <td style="font-size:0.72rem;color:var(--text-dim)">${escHTML(r.tamanho) || '—'}</td>
                <td class="td-qtd">${r.quantidade.toLocaleString('pt-BR')}</td>
                <td class="td-right td-dim">${r.pct.toFixed(2)}%</td>
                <td class="td-right td-dim">${r.cumPct.toFixed(1)}%</td>
                <td class="td-center"><span class="abc-badge ${cls}">${r.classe}</span></td>
            </tr>`;
        }).join('');
    }
};

// ====== DASHBOARD: ABC VENDAS MICRO ======
const abcMicro = {
    selectedYear:       'all',
    selectedMonth:      '',
    selectedTrimestre:  '',
    selectedGrupo:      'codigo',
    _selectedClasse: null,
    _items:          [],
    _zonas:          {},
    _busca:          '',

    init() {
        document.getElementById('abcm-year-tabs').addEventListener('click', e => {
            const btn = e.target.closest('.year-tab');
            if (!btn) return;
            document.querySelectorAll('#abcm-year-tabs .year-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.selectedYear      = btn.dataset.year;
            this.selectedMonth     = '';
            this.selectedTrimestre = '';
            this._selectedClasse   = null;
            document.getElementById('abcm-month-sel').value = '';
            document.getElementById('abcm-tri-sel').value   = '';
            this.render();
        });
        document.getElementById('abcm-month-sel').addEventListener('change', e => {
            this.selectedMonth = e.target.value;
            this._selectedClasse = null;
            if (e.target.value) { this.selectedTrimestre = ''; document.getElementById('abcm-tri-sel').value = ''; }
            this.render();
        });
        document.getElementById('abcm-tri-sel').addEventListener('change', e => {
            this.selectedTrimestre = e.target.value;
            this._selectedClasse = null;
            if (e.target.value) { this.selectedMonth = ''; document.getElementById('abcm-month-sel').value = ''; }
            this.render();
        });
        document.getElementById('abcm-grupo-sel').addEventListener('change', e => {
            this.selectedGrupo = e.target.value;
            this.render();
        });
        document.getElementById('abcm-busca').addEventListener('input', e => {
            this._busca = e.target.value.trim().toLowerCase();
            this.renderTable();
        });
    },

    async render() {
        if (this._rendering) return;
        this._rendering = true;
        try {
        // Garante que o estoque está carregado antes de renderizar
        if (!estoque.rawData.length) {
            await estoque.carregarHistorico();
            if (!estoque.rawData.length) {
                const imps = await api.get('/api/importacoes-estoque');
                if (imps?.length) {
                    const rows = await api.get(`/api/estoque?importacao_id=${imps[0].id}`);
                    if (rows?.length) {
                        estoque.rawData = rows.map((r, i) => ({
                            _id: i,
                            codigo: String(r.codigo || '').trim(),
                            quantidade: Number(r.quantidade) || 0,
                            dados: r.dados || {}
                        }));
                    }
                }
            }
        }
        const countEl = document.getElementById('abcm-count');
        if (!vendas.rawData.length) {
            countEl.textContent = 'Importe dados de Vendas primeiro';
            ['a','b','c'].forEach(k => {
                document.getElementById(`abcm-${k}-count`).textContent = '0';
                document.getElementById(`abcm-${k}-qtd`).textContent = '—';
            });
            document.querySelector('#abcm-table tbody').innerHTML = '';
            return;
        }

        // Year tabs
        const tabsEl = document.getElementById('abcm-year-tabs');
        if (vendas.years.length === 1) this.selectedYear = vendas.years[0];
        tabsEl.innerHTML = vendas.years.map(y =>
            `<button class="year-tab${this.selectedYear === y ? ' active' : ''}" data-year="${y}">${y}</button>`
        ).join('') + (vendas.years.length > 1
            ? `<button class="year-tab${this.selectedYear === 'all' ? ' active' : ''}" data-year="all">Todos</button>`
            : '');

        // Active columns for selected period
        const allCols = this.selectedYear === 'all' ? vendas.monthCols : vendas.monthCols.filter(c => c.year === this.selectedYear);

        // Trimestre ou mês
        let activeCols, divisor;
        if (this.selectedTrimestre && TRIMESTRES[this.selectedTrimestre]) {
            const triMeses = TRIMESTRES[this.selectedTrimestre];
            activeCols = allCols.filter(c => triMeses.includes(c.abbr));
            divisor    = 3;
        } else if (this.selectedMonth) {
            activeCols = allCols.filter(c => c.abbr === this.selectedMonth);
            divisor    = 1;
        } else {
            activeCols = allCols;
            divisor    = 1;
        }

        // Month selector
        const monthSel    = document.getElementById('abcm-month-sel');
        const uniqueAbbrs = [...new Set(allCols.map(c => c.abbr))];
        monthSel.innerHTML = '<option value="">Todos</option>' +
            MONTHS.filter(m => uniqueAbbrs.includes(m))
                  .map(m => `<option value="${m}" ${this.selectedMonth === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`)
                  .join('');

        // Aggregate vendas by grupo (com divisão por 3 se trimestre)
        const map = {};
        vendas.rawData.forEach(r => {
            const key = this.selectedGrupo === 'descricao' ? r.descricao
                      : this.selectedGrupo === 'marca'     ? (r.marca || '—')
                      : r.codigo;
            const qtd = Math.round(activeCols.reduce((s, c) => s + (r[c.key] || 0), 0) / divisor);
            if (!map[key]) map[key] = { label: key, quantidade: 0, _mods: new Set(), _marcas: new Set(), _tams: new Set() };
            map[key].quantidade += qtd;
            if (r.modelo)   map[key]._mods.add(r.modelo);
            if (r.marca)    map[key]._marcas.add(r.marca);
            if (r.tamanho)  map[key]._tams.add(r.tamanho);
        });

        const TAM_ORDER = ['PP','P','M','G','GG','XG','XXG','XGG'];
        const sorted = Object.values(map).filter(i => i.quantidade > 0).sort((a, b) => b.quantidade - a.quantidade);
        sorted.forEach(it => {
            it.modelo  = [...it._mods].join(' / ') || '—';
            it.marca   = [...it._marcas].join(' / ') || '—';
            it.tamanho = [...it._tams].sort((a,b) => (TAM_ORDER.indexOf(a)||99) - (TAM_ORDER.indexOf(b)||99)).join(' · ') || '—';
        });
        if (!sorted.length) {
            countEl.textContent = 'Sem dados no período selecionado';
            ['a','b','c'].forEach(k => {
                document.getElementById(`abcm-${k}-count`).textContent = '0';
                document.getElementById(`abcm-${k}-qtd`).textContent = '—';
            });
            document.querySelector('#abcm-table tbody').innerHTML = '';
            return;
        }

        const total = sorted.reduce((s, i) => s + i.quantidade, 0);
        let cumQtd = 0;
        const items = sorted.map(r => {
            cumQtd += r.quantidade;
            const cumPct = cumQtd / total * 100;
            return { ...r, pct: r.quantidade / total * 100, cumPct,
                     classe: cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C' };
        });

        const cA = items.filter(i => i.classe === 'A');
        const cB = items.filter(i => i.classe === 'B');
        const cC = items.filter(i => i.classe === 'C');
        const fmtQ = q => q.toLocaleString('pt-BR') + ' un';

        document.getElementById('abcm-a-count').textContent = cA.length;
        document.getElementById('abcm-b-count').textContent = cB.length;
        document.getElementById('abcm-c-count').textContent = cC.length;
        document.getElementById('abcm-a-qtd').textContent = fmtQ(cA.reduce((s,i) => s + i.quantidade, 0));
        document.getElementById('abcm-b-qtd').textContent = fmtQ(cB.reduce((s,i) => s + i.quantidade, 0));
        document.getElementById('abcm-c-qtd').textContent = fmtQ(cC.reduce((s,i) => s + i.quantidade, 0));
        countEl.textContent = `${items.length.toLocaleString('pt-BR')} itens analisados`;

        this._items = items;
        this._setupCardClicks('abcm');
        this._updateCardStyles('abcm');
        setTimeout(() => this.drawChart(items), 30);
        this.renderTable();
        } finally { this._rendering = false; }
    },

    drawChart(items) {
        const canvas = document.getElementById('abcm-chart');
        if (!canvas || !items.length) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width  = canvas.offsetWidth || 800;
        const h = canvas.height = 160;
        ctx.clearRect(0, 0, w, h);

        const padL = 8, padR = 42, padT = 18, padB = 20;
        const n      = items.length;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        const iA = items.findIndex(i => i.classe !== 'A');
        const iB = items.findIndex(i => i.classe === 'C');
        const bA = iA < 0 ? n : iA;
        const bB = iB < 0 ? n : iB;
        const xA = padL + (bA / n) * chartW;
        const xB = padL + (bB / n) * chartW;

        ctx.fillStyle = 'rgba(38,198,218,0.07)';
        ctx.fillRect(padL, padT, xA - padL, chartH);
        ctx.fillStyle = 'rgba(255,171,118,0.07)';
        ctx.fillRect(xA, padT, xB - xA, chartH);
        ctx.fillStyle = 'rgba(139,148,158,0.05)';
        ctx.fillRect(xB, padT, w - padR - xB, chartH);

        ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
        if (bA > 0) {
            ctx.fillStyle = 'rgba(38,198,218,0.65)';
            ctx.fillText('A', padL + (xA - padL) / 2, padT + 11);
        }
        if (bB > bA) {
            ctx.fillStyle = 'rgba(255,171,118,0.65)';
            ctx.fillText('B', xA + (xB - xA) / 2, padT + 11);
        }
        if (n > bB) {
            ctx.fillStyle = 'rgba(139,148,158,0.6)';
            ctx.fillText('C', xB + (w - padR - xB) / 2, padT + 11);
        }

        [80, 95].forEach(pct => {
            const y = padT + chartH * (1 - pct / 100);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '8px Inter'; ctx.textAlign = 'left';
            ctx.fillText(`${pct}%`, w - padR + 4, y + 3);
        });

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(38,198,218,0.85)';
        ctx.lineWidth = 2;
        items.forEach((item, i) => {
            const x = padL + (i / Math.max(n - 1, 1)) * chartW;
            const y = padT + chartH * (1 - item.cumPct / 100);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        const lastX = padL + chartW;
        ctx.lineTo(lastX, padT + chartH);
        ctx.lineTo(padL, padT + chartH);
        ctx.closePath();
        ctx.fillStyle = 'rgba(38,198,218,0.05)';
        ctx.fill();

        ctx.fillStyle = 'rgba(139,148,158,0.5)';
        ctx.font = '8px Inter'; ctx.textAlign = 'left';
        [0, 50, 100].forEach(pct => {
            ctx.fillText(`${pct}%`, w - padR + 4, padT + chartH * (1 - pct / 100) + 3);
        });

        // Salva zonas e adiciona clique no gráfico
        this._zonas = { padL, chartW, n, bA, bB, canvas };
        canvas.style.cursor = 'pointer';
        canvas.onclick = e => {
            const rect = canvas.getBoundingClientRect();
            const mx   = (e.clientX - rect.left) * (canvas.width / rect.width);
            const xAc  = padL + (bA / n) * chartW;
            const xBc  = padL + (bB / n) * chartW;
            const zona  = mx < xAc ? 'A' : mx < xBc ? 'B' : 'C';
            this.filtrarClasse(zona, 'abcm');
        };
    },

    filtrarClasse(classe, prefix) {
        this._selectedClasse = this._selectedClasse === classe ? null : classe;
        this._updateCardStyles(prefix || 'abcm');
        this.renderTable();
    },

    _setupCardClicks(prefix) {
        ['A','B','C'].forEach(c => {
            const card = document.getElementById(`${prefix}-${c.toLowerCase()}-count`)?.closest('.summary-card');
            if (card) { card.style.cursor = 'pointer'; card.onclick = () => this.filtrarClasse(c, prefix); }
        });
    },

    _updateCardStyles(prefix) {
        ['A','B','C'].forEach(c => {
            const card = document.getElementById(`${prefix}-${c.toLowerCase()}-count`)?.closest('.summary-card');
            if (!card) return;
            const ativo = this._selectedClasse === c;
            card.style.outline     = ativo ? `2px solid var(--indigo-primary)` : '';
            card.style.opacity     = (!this._selectedClasse || ativo) ? '1' : '0.4';
        });
    },

    renderTable() {
        if (!this._items?.length) return;
        const isDesc  = this.selectedGrupo === 'descricao';
        let visible = this._selectedClasse
            ? this._items.filter(i => i.classe === this._selectedClasse)
            : this._items;
        if (this._busca) {
            visible = visible.filter(i =>
                i.label.toLowerCase().includes(this._busca) ||
                (i.modelo || '').toLowerCase().includes(this._busca) ||
                (i.marca  || '').toLowerCase().includes(this._busca)
            );
        }
        const countEl = document.getElementById('abcm-count');
        if (countEl) countEl.textContent = this._busca
            ? `${visible.length} resultado${visible.length !== 1 ? 's' : ''} encontrado${visible.length !== 1 ? 's' : ''}`
            : this._selectedClasse
                ? `${visible.length} itens — Classe ${this._selectedClasse} (clique para ver todos)`
                : `${this._items.length.toLocaleString('pt-BR')} itens analisados`;
        // Mapa de estoque por código (normalizado para garantir match)
        const estMap = {};
        estoque.rawData.forEach(r => {
            const k = String(r.codigo || '').trim();
            estMap[k] = (estMap[k] || 0) + (Number(r.quantidade) || 0);
        });

        document.querySelector('#abcm-table thead tr').innerHTML = `
            <th style="width:40px;">#</th>
            <th>${isDesc ? 'DESCRIÇÃO' : 'CÓDIGO'}</th>
            <th>MODELO</th>
            <th>MARCA</th>
            <th>TAMANHO</th>
            <th class="td-right">VENDAS</th>
            <th class="td-right">ESTOQUE</th>
            <th class="td-right">% TOTAL</th>
            <th class="td-right">% ACUM.</th>
            <th class="td-center" style="width:80px;">CLASSE</th>
        `;
        document.querySelector('#abcm-table tbody').innerHTML = visible.map((r, i) => {
            const cls     = `abc-${r.classe.toLowerCase()}`;
            const cellCls = isDesc ? 'td-desc' : 'td-code';
            const seg = vendas.rawData.find(v => (isDesc ? v.descricao : v.codigo) === r.label)?.segmento || '';
            const clickAttr = isDesc
                ? `onclick="abrirDetalhe('${escJS(r.label)}','${escJS(seg)}'); event.stopPropagation();" style="cursor:pointer;"`
                : '';
            const estQtd  = estMap[String(r.label || '').trim()];
            const estCell = estQtd !== undefined ? estQtd.toLocaleString('pt-BR') : '<span style="opacity:.3">—</span>';
            return `<tr ${clickAttr} title="${isDesc ? 'Clique para ver detalhe' : ''}">
                <td class="td-dim td-center">${i + 1}</td>
                <td class="${cellCls}" style="${isDesc ? 'color:var(--indigo-primary);' : ''}">${escHTML(r.label)}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${escHTML(r.modelo) || '—'}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${escHTML(r.marca)  || '—'}</td>
                <td style="font-size:0.72rem;color:var(--text-dim)">${escHTML(r.tamanho) || '—'}</td>
                <td class="td-qtd">${r.quantidade.toLocaleString('pt-BR')}</td>
                <td class="td-right">${estCell}</td>
                <td class="td-right td-dim">${r.pct.toFixed(2)}%</td>
                <td class="td-right td-dim">${r.cumPct.toFixed(1)}%</td>
                <td class="td-center"><span class="abc-badge ${cls}">${r.classe}</span></td>
            </tr>`;
        }).join('');
    }
};


// ====== DASHBOARD: ABC ESTOQUE ======

const abcEstoque = {
    _selectedClasse: null,
    _items: [],
    _busca: '',

    init() {
        document.getElementById('abce-busca').addEventListener('input', e => {
            this._busca = e.target.value.trim().toLowerCase();
            this.renderTable();
        });
    },

    render() {
        if (!estoque.rawData.length) {
            document.getElementById('abce-count').textContent = 'Importe dados de Estoque primeiro.';
            return;
        }

        // Detecta coluna de descrição no estoque
        const descCol = estoque._colDesc || (estoque.colunas || []).find(c => {
            const n = estoque.normalizeKey(c);
            return n.includes('descricao') || n.includes('descr') || n.includes('produto');
        });

        // Agrupa por código
        const map  = {};
        const desc = {};
        estoque.rawData.forEach(r => {
            map[r.codigo]  = (map[r.codigo]  || 0) + r.quantidade;
            if (!desc[r.codigo] && descCol) desc[r.codigo] = String(r.dados?.[descCol] || '');
        });

        const sorted = Object.entries(map).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
        const total  = sorted.reduce((s,[,v]) => s + v, 0);
        let cum = 0;
        const items = sorted.map(([codigo, qtd]) => {
            cum += qtd;
            const cumPct = total > 0 ? cum / total * 100 : 100;
            const pct    = total > 0 ? qtd / total * 100 : 0;
            return { codigo, descricao: desc[codigo] || '', qtd, pct, cumPct,
                     classe: cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C' };
        });

        const cA = items.filter(i => i.classe === 'A');
        const cB = items.filter(i => i.classe === 'B');
        const cC = items.filter(i => i.classe === 'C');
        document.getElementById('abce-a-count').textContent = cA.length;
        document.getElementById('abce-b-count').textContent = cB.length;
        document.getElementById('abce-c-count').textContent = cC.length;
        document.getElementById('abce-a-qtd').textContent   = cA.reduce((s,i) => s+i.qtd,0).toLocaleString('pt-BR') + ' un';
        document.getElementById('abce-b-qtd').textContent   = cB.reduce((s,i) => s+i.qtd,0).toLocaleString('pt-BR') + ' un';
        document.getElementById('abce-c-qtd').textContent   = cC.reduce((s,i) => s+i.qtd,0).toLocaleString('pt-BR') + ' un';
        document.getElementById('abce-count').textContent   = `${items.length.toLocaleString('pt-BR')} itens analisados`;

        this._items = items;
        this._setupCardClicks();
        this._updateCardStyles();
        setTimeout(() => this.drawChart(items), 30);
        this.renderTable();
    },

    drawChart(items) {
        const canvas = document.getElementById('abce-chart');
        if (!canvas || !items.length) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width  = canvas.offsetWidth || 800;
        const h = canvas.height = 160;
        ctx.clearRect(0, 0, w, h);

        const padL = 8, padR = 42, padT = 18, padB = 20;
        const n      = items.length;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        const iA = items.findIndex(i => i.classe !== 'A');
        const iB = items.findIndex(i => i.classe === 'C');
        const bA = iA < 0 ? n : iA;
        const bB = iB < 0 ? n : iB;
        const xA = padL + (bA / n) * chartW;
        const xB = padL + (bB / n) * chartW;

        ctx.fillStyle = 'rgba(38,198,218,0.07)';
        ctx.fillRect(padL, padT, xA - padL, chartH);
        ctx.fillStyle = 'rgba(255,171,118,0.07)';
        ctx.fillRect(xA, padT, xB - xA, chartH);
        ctx.fillStyle = 'rgba(139,148,158,0.05)';
        ctx.fillRect(xB, padT, w - padR - xB, chartH);

        ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
        if (bA > 0) { ctx.fillStyle = 'rgba(38,198,218,0.65)'; ctx.fillText('A', padL + (xA - padL) / 2, padT + 11); }
        if (bB > bA) { ctx.fillStyle = 'rgba(255,171,118,0.65)'; ctx.fillText('B', xA + (xB - xA) / 2, padT + 11); }
        if (n > bB) { ctx.fillStyle = 'rgba(139,148,158,0.6)'; ctx.fillText('C', xB + (w - padR - xB) / 2, padT + 11); }

        [80, 95].forEach(pct => {
            const y = padT + chartH * (1 - pct / 100);
            ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '8px Inter'; ctx.textAlign = 'left';
            ctx.fillText(`${pct}%`, w - padR + 4, y + 3);
        });

        ctx.beginPath(); ctx.strokeStyle = 'rgba(38,198,218,0.85)'; ctx.lineWidth = 2;
        items.forEach((item, i) => {
            const x = padL + (i / Math.max(n - 1, 1)) * chartW;
            const y = padT + chartH * (1 - item.cumPct / 100);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.lineTo(padL + chartW, padT + chartH);
        ctx.lineTo(padL, padT + chartH);
        ctx.closePath();
        ctx.fillStyle = 'rgba(38,198,218,0.05)';
        ctx.fill();

        ctx.fillStyle = 'rgba(139,148,158,0.5)'; ctx.font = '8px Inter'; ctx.textAlign = 'left';
        [0, 50, 100].forEach(pct => {
            ctx.fillText(`${pct}%`, w - padR + 4, padT + chartH * (1 - pct / 100) + 3);
        });

        // Clique no gráfico → filtra por zona
        canvas.style.cursor = 'pointer';
        canvas.onclick = e => {
            const rect = canvas.getBoundingClientRect();
            const mx   = (e.clientX - rect.left) * (canvas.width / rect.width);
            const xAc  = padL + (bA / n) * chartW;
            const xBc  = padL + (bB / n) * chartW;
            const zona  = mx < xAc ? 'A' : mx < xBc ? 'B' : 'C';
            this.filtrarClasse(zona);
        };
    },

    filtrarClasse(classe) {
        this._selectedClasse = this._selectedClasse === classe ? null : classe;
        this._updateCardStyles();
        this.renderTable();
    },

    _setupCardClicks() {
        ['A','B','C'].forEach(c => {
            const card = document.getElementById(`abce-${c.toLowerCase()}-count`)?.closest('.summary-card');
            if (card) { card.style.cursor = 'pointer'; card.onclick = () => this.filtrarClasse(c); }
        });
    },

    _updateCardStyles() {
        ['A','B','C'].forEach(c => {
            const card = document.getElementById(`abce-${c.toLowerCase()}-count`)?.closest('.summary-card');
            if (!card) return;
            const ativo = this._selectedClasse === c;
            card.style.outline = ativo ? '2px solid var(--indigo-primary)' : '';
            card.style.opacity = (!this._selectedClasse || ativo) ? '1' : '0.4';
        });
    },

    renderTable() {
        if (!this._items?.length) return;
        let visible = this._selectedClasse
            ? this._items.filter(i => i.classe === this._selectedClasse)
            : this._items;
        if (this._busca) {
            visible = visible.filter(i =>
                String(i.codigo || '').toLowerCase().includes(this._busca) ||
                String(i.descricao || '').toLowerCase().includes(this._busca)
            );
        }
        document.getElementById('abce-count').textContent = this._busca
            ? `${visible.length} resultado${visible.length !== 1 ? 's' : ''} encontrado${visible.length !== 1 ? 's' : ''}`
            : this._selectedClasse
                ? `${visible.length} itens — Classe ${this._selectedClasse} (clique para ver todos)`
                : `${this._items.length.toLocaleString('pt-BR')} itens analisados`;
        document.querySelector('#abce-table tbody').innerHTML = visible.map((r, i) => {
            const cls = `abc-${r.classe.toLowerCase()}`;
            return `<tr>
                <td class="td-rank">${i + 1}</td>
                <td class="td-code">${escHTML(r.codigo)}</td>
                <td class="td-desc">${r.descricao ? escHTML(r.descricao) : '<span style="opacity:.3">—</span>'}</td>
                <td class="td-right"><strong>${r.qtd.toLocaleString('pt-BR')}</strong></td>
                <td class="td-right">${r.pct.toFixed(2)}%</td>
                <td class="td-right">${r.cumPct.toFixed(1)}%</td>
                <td class="td-center"><span class="abc-badge ${cls}">${r.classe}</span></td>
            </tr>`;
        }).join('');
    }
};

// ====== PESQUISA POR CÓDIGO ======

// ====== DASHBOARD: PEDIDOS ======
const pedidos = {
    _anoSel: '',
    _meses:  [],  // [{key, label, total}]
    _cols:   [],  // monthCols usadas

    init() {
        document.getElementById('ped-ano-sel')?.addEventListener('change', e => {
            this._anoSel = e.target.value;
            this.render();
        });
    },

    abrirTop10(colKey) {
        const mes = this._meses.find(m => m.key === colKey);
        if (!mes) return;
        this._top10ColKey = colKey;
        this._top10Todos  = [];
        this._top10Mes    = mes;

        document.getElementById('ped-top10-titulo').textContent = mes.label;

        // Agrega TODOS os itens do mês
        const map = {};
        vendas.rawData.forEach(r => {
            const qtd = Number(r[colKey]) || 0;
            if (!qtd) return;
            const cod = r.codigo || '—';
            if (!map[cod]) map[cod] = { codigo: cod, descricao: r.descricao || '—', marca: r.marca || '—', total: 0 };
            map[cod].total += qtd;
        });
        this._top10Todos = Object.values(map).sort((a,b) => b.total - a.total);

        // Limpa busca
        const busca = document.getElementById('ped-top10-busca');
        if (busca) { busca.value = ''; busca.oninput = e => this._renderTop10Lista(e.target.value.trim().toLowerCase()); }

        this._renderTop10Lista('');
        document.getElementById('ped-top10-overlay').style.display = 'flex';
    },

    _renderTop10Lista(q) {
        const todos    = this._top10Todos;
        const totalMes = this._top10Mes?.total || todos.reduce((s,r) => s + r.total, 0);
        const maxQtd   = todos[0]?.total || 1;
        const visible  = q ? todos.filter(r =>
            r.codigo.toLowerCase().includes(q) || r.descricao.toLowerCase().includes(q) || r.marca.toLowerCase().includes(q)
        ) : todos;

        const countEl = document.getElementById('ped-top10-count');
        if (countEl) countEl.textContent = q
            ? `${visible.length} resultado${visible.length !== 1 ? 's' : ''}`
            : `${todos.length} itens`;

        document.getElementById('ped-top10-tbody').innerHTML = visible.map((r, i) => {
            const pct  = totalMes > 0 ? (r.total / totalMes * 100).toFixed(1) : '0.0';
            const barW = (r.total / maxQtd * 100).toFixed(0);
            return `<tr>
                <td style="text-align:center;color:var(--text-dim);font-size:0.85rem;">${i + 1}</td>
                <td class="td-code" style="color:var(--indigo-primary);font-weight:700;position:sticky;left:0;background:var(--bg-obsidian);">${escHTML(r.codigo)}</td>
                <td>
                    <div style="font-size:0.82rem;">${escHTML(r.descricao)}</div>
                    <div style="margin-top:3px;height:3px;border-radius:2px;background:var(--border);">
                        <div style="height:3px;border-radius:2px;background:var(--indigo-primary);width:${barW}%;"></div>
                    </div>
                </td>
                <td style="font-size:0.78rem;color:var(--text-dim);">${escHTML(r.marca)}</td>
                <td class="td-right" style="font-weight:700;color:var(--indigo-primary);">${r.total.toLocaleString('pt-BR')}</td>
                <td class="td-right" style="color:var(--text-dim);font-size:0.82rem;">${pct}%</td>
            </tr>`;
        }).join('');
    },

    fecharTop10() {
        document.getElementById('ped-top10-overlay').style.display = 'none';
    },

    render() {
        const empty   = document.getElementById('ped-empty');
        const content = document.getElementById('ped-content');
        if (!vendas.rawData?.length || !vendas.monthCols?.length) {
            if (empty)   empty.style.display = 'block';
            if (content) content.style.display = 'none';
            return;
        }
        if (empty)   empty.style.display = 'none';
        if (content) content.style.display = 'block';

        // Popula select de ano
        const anoSel = document.getElementById('ped-ano-sel');
        if (anoSel) {
            const anos = [...new Set(vendas.monthCols.map(c => c.year).filter(Boolean))].sort();
            anoSel.innerHTML = '<option value="">Todos os anos</option>' +
                anos.map(a => `<option value="${a}"${a===this._anoSel?' selected':''}>${a}</option>`).join('');
        }

        // Filtra colunas pelo ano selecionado
        const cols = this._anoSel
            ? vendas.monthCols.filter(c => c.year === this._anoSel)
            : vendas.monthCols.filter(c => c.year);

        // Soma total por mês (todos os códigos)
        const mesesMap = {};
        cols.forEach(c => { mesesMap[c.key] = { key: c.key, label: c.label, abbr: c.abbr, year: c.year, total: 0 }; });
        vendas.rawData.forEach(r => {
            cols.forEach(c => { mesesMap[c.key].total += (Number(r[c.key]) || 0); });
        });

        const meses = Object.values(mesesMap).filter(m => m.total > 0);
        this._meses = meses;
        this._cols  = cols;
        const totalGeral = meses.reduce((s, m) => s + m.total, 0);
        const maior      = meses.reduce((a, b) => b.total > a.total ? b : a, meses[0] || {});
        const media      = meses.length ? Math.round(totalGeral / meses.length) : 0;

        // Cards
        document.getElementById('ped-total').textContent     = totalGeral.toLocaleString('pt-BR');
        document.getElementById('ped-meses').textContent     = meses.length;
        document.getElementById('ped-maior').textContent     = maior?.total?.toLocaleString('pt-BR') || '—';
        document.getElementById('ped-maior-nome').textContent = maior?.label || '—';
        document.getElementById('ped-media').textContent     = media.toLocaleString('pt-BR');

        // Gráfico de barras
        this._drawChart(meses);
        this._setupCanvasClick(meses);

        // Tabela
        const thead = document.getElementById('ped-thead');
        const tbody = document.getElementById('ped-tbody');
        thead.innerHTML = meses.map(m =>
            `<th class="td-center" style="cursor:pointer;" onclick="pedidos.abrirTop10('${m.key}')" title="Ver top 10 de ${m.label}">${m.label}</th>`
        ).join('');
        const maxVal = Math.max(...meses.map(m => m.total), 1);
        tbody.innerHTML = `<tr>${meses.map(m => {
            const pct = (m.total / maxVal * 100).toFixed(0);
            const cor = m.total === maior?.total ? 'var(--green-accent)' : 'var(--indigo-primary)';
            return `<td class="td-center" style="cursor:pointer;" onclick="pedidos.abrirTop10('${m.key}')" title="Ver top 10 de ${m.label}">
                <div style="font-weight:700;font-size:0.95rem;color:${cor};">${m.total.toLocaleString('pt-BR')}</div>
                <div style="margin-top:4px;height:4px;border-radius:2px;background:var(--border);">
                    <div style="height:4px;border-radius:2px;background:${cor};width:${pct}%;"></div>
                </div>
            </td>`;
        }).join('')}</tr>`;
    },

    _setupCanvasClick(meses) {
        const canvas = document.getElementById('ped-chart');
        if (!canvas) return;
        canvas.style.cursor = 'pointer';
        canvas._clickHandler && canvas.removeEventListener('click', canvas._clickHandler);
        canvas._clickHandler = (e) => {
            const rect  = canvas.getBoundingClientRect();
            const mx    = e.clientX - rect.left;
            const W     = canvas.width;
            const padL  = 52, padR = 16, padB = 40;
            const chartW = W - padL - padR;
            const n      = meses.length;
            const gap    = chartW / n;
            const barW   = Math.max(8, gap * 0.6);
            const idx = meses.findIndex((_, i) => {
                const x = padL + gap * i + (gap - barW) / 2;
                return mx >= x && mx <= x + barW;
            });
            if (idx >= 0) this.abrirTop10(meses[idx].key);
        };
        canvas.addEventListener('click', canvas._clickHandler);
    },

    _drawChart(meses) {
        const canvas = document.getElementById('ped-chart');
        if (!canvas || !meses.length) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width  = canvas.offsetWidth || 800;
        const H = canvas.height = 220;
        ctx.clearRect(0, 0, W, H);

        const padL = 52, padR = 16, padT = 20, padB = 40;
        const chartW = W - padL - padR;
        const chartH = H - padT - padB;
        const maxVal = Math.max(...meses.map(m => m.total), 1);
        const n = meses.length;
        const barW = Math.max(8, (chartW / n) * 0.6);
        const gap  = chartW / n;

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        [0, 0.25, 0.5, 0.75, 1].forEach(p => {
            const y = padT + chartH * (1 - p);
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
            ctx.fillStyle = '#8b949e';
            ctx.font = '10px Inter';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxVal * p).toLocaleString('pt-BR'), padL - 6, y + 4);
        });

        // Barras
        meses.forEach((m, i) => {
            const x  = padL + gap * i + (gap - barW) / 2;
            const barH = (m.total / maxVal) * chartH;
            const y  = padT + chartH - barH;

            // Gradiente
            const grad = ctx.createLinearGradient(0, y, 0, padT + chartH);
            grad.addColorStop(0, 'rgba(38,198,218,0.9)');
            grad.addColorStop(1, 'rgba(38,198,218,0.2)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            const rr = 3;
            ctx.moveTo(x + rr, y);
            ctx.lineTo(x + barW - rr, y);
            ctx.quadraticCurveTo(x + barW, y, x + barW, y + rr);
            ctx.lineTo(x + barW, y + barH);
            ctx.lineTo(x, y + barH);
            ctx.lineTo(x, y + rr);
            ctx.quadraticCurveTo(x, y, x + rr, y);
            ctx.closePath();
            ctx.fill();

            // Valor no topo
            ctx.fillStyle = '#e6edf3';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'center';
            if (barH > 18) ctx.fillText(m.total.toLocaleString('pt-BR'), x + barW/2, y - 4);

            // Label mês
            ctx.fillStyle = '#8b949e';
            ctx.font = '10px Inter';
            ctx.fillText(m.label, x + barW/2, H - padB + 14);
        });
    }
};

// ====== DASHBOARD: ORDEM DE PRODUÇÃO ======
const opDash = {
    _busca: '',
    _statusSel: '',
    _marcaSel: '',
    _cobSel: '',
    _rows: [],
    _dirty: false,
    _selecionados: new Set(),

    // Constrói mapa código → dados VxE (vendas + estoque)
    _buildVxeMap() {
        const estMap = {};
        estoque.rawData.forEach(r => {
            const k = String(r.codigo || '').trim().toUpperCase();
            if (k) estMap[k] = (estMap[k] || 0) + (Number(r.quantidade) || 0);
        });
        const opMap = {};
        const qtdCol = op._colQtd;
        const COD_KEYS_OP = ['ref','referencia','codigo','cod','codigoproduto'];
        const refCol = op._colRef
            || op.colunas?.find(c => { const n = normalizeKey(c); return COD_KEYS_OP.some(k => n === k || n.includes(k)); });
        op.rawData.forEach(r => {
            const k = refCol ? String(r.dados?.[refCol] ?? '').trim().toUpperCase() : '';
            const q = qtdCol ? (parseFloat(String(r.dados?.[qtdCol] ?? '0').replace(/\./g, '').replace(',', '.')) || 0) : 0;  // M4: ponto=milhar, vírgula=decimal (pt-BR)
            if (k) opMap[k] = (opMap[k] || 0) + q;
        });
        // Usa apenas meses com dados reais para não inflar a cobertura com meses zerados
        const activeCols = vendas.getActiveCols();
        const map = {};
        vendas.rawData.forEach(r => {
            const cod = String(r.codigo || '').trim().toUpperCase();
            if (!map[cod]) map[cod] = { codigo: r.codigo, descricao: r.descricao, marca: r.marca, tamanho: r.tamanho, vendTotal: 0, mesesAtivos: new Set() };
            activeCols.forEach(c => {
                const v = r[c.key] || 0;
                map[cod].vendTotal += v;
                if (v > 0) map[cod].mesesAtivos.add(c.key);
            });
        });
        Object.values(map).forEach(r => {
            const k   = r.codigo.trim().toUpperCase();
            const cnt = r.mesesAtivos.size || activeCols.length || 1;
            r.vendMedia  = Math.round(r.vendTotal / cnt);
            r.estoque    = estMap[k] || 0;
            r.emProcesso = opMap[k]  || 0;
            // Cobertura baseada apenas no estoque atual — emProcesso é mostrado como coluna separada
            r.cobertura  = r.vendMedia > 0 ? r.estoque / r.vendMedia : null;
        });
        return map;
    },

    render() {
        const empty   = document.getElementById('op-dash-empty');
        const content = document.getElementById('op-dash-content');
        if (!op.rawData?.length) {
            if (empty)   empty.style.display = 'block';
            if (content) content.style.display = 'none';
            return;
        }
        if (empty)   empty.style.display = 'none';
        if (content) content.style.display = 'block';

        const vxeMap = this._buildVxeMap();

        // Monta linhas cruzando OP com VxE
        const opCodes = new Set();
        this._rows = op.rawData.map((r, _id) => {
            const dados = r.dados || {};
            const statusKey = Object.keys(dados).find(k => /status|situac/i.test(k));
            const codKey    = Object.keys(dados).find(k => /^c[oó]digo$/i.test(k))
                           || Object.keys(dados).find(k => /^c[oó]d[^a-z]/i.test(k))
                           || Object.keys(dados).find(k => /c[oó]digo/i.test(k))
                           || Object.keys(dados).find(k => /^ref/i.test(k));
            const cod = String(dados[codKey] || '').trim().toUpperCase();
            const vxe = vxeMap[cod] || {};
            opCodes.add(String(dados[statusKey]||'').trim());
            return {
                _id,
                _status: statusKey ? String(dados[statusKey]||'').trim() : '',
                _raw: dados,
                codigo:      vxe.codigo     || dados[codKey] || cod,
                descricao:   vxe.descricao  || '—',
                marca:       vxe.marca      || '—',
                tamanho:     vxe.tamanho    || '—',
                vendMedia:   vxe.vendMedia  ?? null,
                estoque:     vxe.estoque    ?? null,
                emProcesso:  vxe.emProcesso ?? null,
                cobertura:   vxe.cobertura  ?? null,
            };
        });

        // Status
        const statusSel = document.getElementById('opdash-status-sel');
        if (statusSel) {
            const statuses = [...opCodes].filter(Boolean).sort();
            statusSel.innerHTML = '<option value="">Todos</option>' +
                statuses.map(s => `<option value="${s}"${s===this._statusSel?' selected':''}>${s}</option>`).join('');
            statusSel.onchange = e => { this._statusSel = e.target.value; this._renderTabela(); };
        }

        // Marca
        const marcaSel = document.getElementById('opdash-marca-sel');
        if (marcaSel) {
            const marcas = [...new Set(this._rows.map(r => r.marca).filter(m => m && m !== '—'))].sort();
            marcaSel.innerHTML = '<option value="">Todas</option>' +
                marcas.map(m => `<option value="${m}"${m===this._marcaSel?' selected':''}>${m}</option>`).join('');
            marcaSel.onchange = e => { this._marcaSel = e.target.value; this._renderTabela(); };
        }

        // Cobertura
        const cobSel = document.getElementById('opdash-cob-sel');
        if (cobSel) {
            cobSel.value = this._cobSel;
            cobSel.onchange = e => { this._cobSel = e.target.value; this._renderTabela(); };
        }

        // Busca
        const busca = document.getElementById('opdash-busca');
        if (busca) {
            busca.oninput = e => { this._busca = e.target.value.trim().toLowerCase(); this._renderTabela(); };
            busca.value = this._busca;
        }

        this._selecionados.clear();
        this._updateFilaTocBtn();
        // Cabeçalho fixo (colunas 1,2,3,5,7,8,9,10 do VxE)
        document.getElementById('opdash-thead').innerHTML = `
            <th style="width:32px;text-align:center;"><input type="checkbox" id="opdash-chk-all" title="Selecionar todos" onclick="opDash._toggleAll()" style="cursor:pointer;accent-color:var(--indigo-primary);width:15px;height:15px;"></th>
            <th>CÓDIGO</th><th>DESCRIÇÃO</th><th>MARCA</th><th>TAMANHO</th>
            <th class="td-right" style="color:var(--indigo-primary);">MÉDIA VENDAS</th>
            <th class="td-right" style="color:var(--green-accent);">ESTOQUE</th>
            <th class="td-right" style="color:var(--orange-accent);">EM PROCESSO (OP)</th>
            <th class="td-right">COBERTURA</th>
            <th class="td-right" style="color:#f06292;">PROGRAMAR</th>`;

        this._renderTabela();
    },

    _renderTabela() {
        let visible = this._rows;
        if (this._statusSel) visible = visible.filter(r => r._status === this._statusSel);
        if (this._marcaSel)  visible = visible.filter(r => r.marca === this._marcaSel);
        if (this._cobSel) {
            visible = visible.filter(r => {
                const c = r.cobertura;
                if (this._cobSel === 'critico') return c != null && c < 1;
                if (this._cobSel === 'ok')      return c != null && c >= 1 && c <= 3;
                if (this._cobSel === 'excesso') return c != null && c > 3;
                if (this._cobSel === 'sem')     return c == null;
                return true;
            });
        }
        if (this._busca) visible = visible.filter(r =>
            String(r.codigo).toLowerCase().includes(this._busca) ||
            String(r.descricao).toLowerCase().includes(this._busca) ||
            String(r.marca).toLowerCase().includes(this._busca) ||
            Object.values(r._raw).some(v => String(v).toLowerCase().includes(this._busca))
        );

        const total     = visible.length;
        const pecas     = visible.reduce((s,r) => s + (r.emProcesso || 0), 0);
        const liberadas = visible.filter(r => /liberado/i.test(r._status)).length;
        document.getElementById('opdash-total').textContent     = total.toLocaleString('pt-BR');
        document.getElementById('opdash-pecas').textContent     = pecas.toLocaleString('pt-BR');
        document.getElementById('opdash-liberadas').textContent = liberadas.toLocaleString('pt-BR');
        document.getElementById('opdash-aberto').textContent    = (total - liberadas).toLocaleString('pt-BR');
        document.getElementById('opdash-count').textContent     = `${total.toLocaleString('pt-BR')} ordens`;

        const mult = parseFloat(document.getElementById('opdash-prog-mult')?.value) || 1;
        const fmt  = v => v != null ? Math.round(v).toLocaleString('pt-BR') : '<span style="opacity:.3">—</span>';
        const fmtC = v => {
            if (v == null) return '<span style="opacity:.3">—</span>';
            const cor = v < 1 ? '#f06292' : v <= 3 ? '#26a69a' : '#ffab76';
            return `<span style="color:${cor};font-weight:600;">${v.toFixed(1)} meses</span>`;
        };
        const fmtP = (vendMedia, emProcesso) => {
            if (vendMedia == null || vendMedia <= 0) return '<span style="opacity:.3">—</span>';
            const prog = Math.round((vendMedia - emProcesso) * mult);
            const cor  = prog > 0 ? '#f06292' : '#26a69a';
            const txt  = prog > 0 ? `+${prog.toLocaleString('pt-BR')}` : prog.toLocaleString('pt-BR');
            return `<span style="color:${cor};font-weight:700;">${txt}</span>`;
        };

        const visibleSlice = visible.slice(0, 2000);
        // Atualiza checkbox "todos"
        const chkAll = document.getElementById('opdash-chk-all');
        if (chkAll) {
            const selCount = visibleSlice.filter(r => this._selecionados.has(r._id)).length;
            chkAll.checked = visibleSlice.length > 0 && selCount === visibleSlice.length;
            chkAll.indeterminate = selCount > 0 && selCount < visibleSlice.length;
        }
        document.getElementById('opdash-tbody').innerHTML = visibleSlice.map(r => {
            const sel = this._selecionados.has(r._id);
            return `<tr style="background:${sel?'rgba(99,102,241,.08)':''};">
                <td style="text-align:center;padding:4px 8px;"><input type="checkbox" ${sel?'checked':''} onclick="opDash._toggleSelect(${r._id})" style="cursor:pointer;accent-color:var(--indigo-primary);width:15px;height:15px;"></td>
                <td class="td-code" style="color:var(--indigo-primary);">${escHTML(r.codigo)}</td>
                <td class="td-desc">${escHTML(r.descricao)}</td>
                <td style="font-size:0.75rem;">${escHTML(r.marca)}</td>
                <td class="td-center">${escHTML(r.tamanho)}</td>
                <td class="td-right" style="color:var(--indigo-primary);font-weight:600;">${fmt(r.vendMedia)}</td>
                <td class="td-right" style="color:var(--green-accent);font-weight:600;">${fmt(r.estoque)}</td>
                <td class="td-right" style="color:var(--orange-accent);font-weight:600;">${fmt(r.emProcesso)}</td>
                <td class="td-right">${fmtC(r.cobertura)}</td>
                <td class="td-right">${fmtP(r.vendMedia, r.emProcesso)}</td>
            </tr>`;
        }).join('');
    },

    _toggleSelect(id) {
        if (this._selecionados.has(id)) this._selecionados.delete(id);
        else this._selecionados.add(id);
        this._updateFilaTocBtn();
        // Atualiza visual da linha sem re-renderizar tudo
        const chkAll = document.getElementById('opdash-chk-all');
        const linhas = document.querySelectorAll('#opdash-tbody tr');
        linhas.forEach(tr => {
            const chk = tr.querySelector('input[type=checkbox]');
            if (!chk) return;
            const rowId = parseInt(chk.getAttribute('onclick')?.match(/\d+/)?.[0]);
            const sel = this._selecionados.has(rowId);
            chk.checked = sel;
            tr.style.background = sel ? 'rgba(99,102,241,.08)' : '';
        });
        if (chkAll) {
            const total = linhas.length;
            const selN  = [...linhas].filter(tr => tr.querySelector('input[type=checkbox]')?.checked).length;
            chkAll.checked = total > 0 && selN === total;
            chkAll.indeterminate = selN > 0 && selN < total;
        }
    },

    _toggleAll() {
        const linhas = document.querySelectorAll('#opdash-tbody tr');
        const ids = [...linhas].map(tr => {
            const m = tr.querySelector('input[type=checkbox]')?.getAttribute('onclick')?.match(/\d+/);
            return m ? parseInt(m[0]) : null;
        }).filter(x => x !== null);
        const allSel = ids.every(id => this._selecionados.has(id));
        if (allSel) ids.forEach(id => this._selecionados.delete(id));
        else ids.forEach(id => this._selecionados.add(id));
        this._renderTabela();
        this._updateFilaTocBtn();
    },

    _updateFilaTocBtn() {
        const n   = this._selecionados.size;
        const btn = document.getElementById('opdash-fila-toc-btn');
        if (!btn) return;
        btn.textContent  = `→ FILA TOC (${n})`;
        btn.style.opacity = n > 0 ? '1' : '0.5';
        btn.style.background = n > 0 ? 'var(--indigo-btn)' : 'var(--bg-input)';
    },

    enviarParaFilaTOC() {
        if (!this._selecionados.size) { mostrarToast('Selecione pelo menos uma OP.', 'aviso'); return; }
        const bancoMap = {};
        banco.rawData.forEach(r => {
            const cod = String(r.dados?.['Código']||'').trim().toUpperCase();
            if (cod) bancoMap[cod] = r.dados;
        });
        toc._filaGargalo = this._rows
            .filter(r => this._selecionados.has(r._id))
            .map(r => {
                const cod = String(r.codigo||'').trim().toUpperCase();
                const qty = op._colQtd
                    ? (parseFloat(String(r._raw?.[op._colQtd]||'0').replace(/[^\d.,]/g,'').replace(',','.')) || 0)
                    : (r.emProcesso || 0);
                return { codigo: cod, descricao: r.descricao||cod, qty, dados: bancoMap[cod]||null, status: r._status };
            })
            .filter(r => r.qty > 0);
        mostrarToast(`${toc._filaGargalo.length} OPs → Fila do Gargalo TOC`);
        navigateTo('toc');
    },

    limpar() {
        this._busca = ''; this._statusSel = ''; this._marcaSel = ''; this._cobSel = '';
        ['opdash-busca','opdash-status-sel','opdash-marca-sel','opdash-cob-sel'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        this._renderTabela();
    },

    exportar() {
        if (!this._rows.length) return;
        exportarXLS(this._rows.map(r => ({
            Código: r.codigo, Descrição: r.descricao, Marca: r.marca, Tamanho: r.tamanho,
            'Média Vendas': r.vendMedia, Estoque: r.estoque, 'Em Processo': r.emProcesso,
            Cobertura: r.cobertura != null ? +r.cobertura.toFixed(2) : null
        })), 'op_dashboard');
    }
};

const pesquisa = {
    _query: '',
    _dirty: false,

    init() {
        const inp = document.getElementById('pesquisa-input');
        if (inp) inp.addEventListener('input', e => { this._query = e.target.value.trim(); this.render(); });
    },

    // Popula selects de Ano e Modelo com base nos dados de vendas carregados
    populateFiltros() {
        const anoEl    = document.getElementById('pesquisa-ano');
        const modeloEl = document.getElementById('pesquisa-modelo');
        if (!anoEl || !modeloEl) return;

        const anos    = [...new Set(vendas.monthCols.map(c => c.year).filter(Boolean))].sort();
        const modelos = [...new Set(vendas.rawData.map(r => r.modelo).filter(Boolean))].sort();

        const curAno    = anoEl.value;
        const curModelo = modeloEl.value;

        anoEl.innerHTML    = '<option value="">Todos</option>' + anos.map(a => `<option value="${a}"${a===curAno?' selected':''}>${a}</option>`).join('');
        modeloEl.innerHTML = '<option value="">Todos</option>' + modelos.map(m => `<option value="${m}"${m===curModelo?' selected':''}>${m}</option>`).join('');
    },

    limpar() {
        this._query = '';
        const inp = document.getElementById('pesquisa-input');
        if (inp) inp.value = '';
        const anoEl = document.getElementById('pesquisa-ano');
        const modEl = document.getElementById('pesquisa-modelo');
        if (anoEl) anoEl.value = '';
        if (modEl) modEl.value = '';
        this.render();
    },

    // Mapa código → { estoque, op, costura } usando dados carregados
    _buildEstoqueMap() {
        const m = {};
        estoque.rawData.forEach(r => {
            const k = String(r.codigo || '').trim().toUpperCase();
            if (k) m[k] = (m[k] || 0) + (Number(r.quantidade) || 0);
        });
        return m;
    },

    _buildOPMap() {
        const m = {};
        const qtdCol = op._colQtd;
        op.rawData.forEach(r => {
            const k = String(r.dados?.['Código'] || r.dados?.['codigo'] || r.dados?.['CÓDIGO'] || '').trim().toUpperCase();
            const qty = qtdCol ? (parseFloat(String(r.dados?.[qtdCol] ?? '0').replace(',', '.')) || 0) : 0;
            if (k) m[k] = (m[k] || 0) + qty;
        });
        return m;
    },

    _buildCosturaMap() {
        const m = {};
        const qtdCol = costura._colQtd;
        costura.rawData.forEach(r => {
            const k = String(r.dados?.['Referência'] || r.dados?.['Referencia'] || r.dados?.['referencia'] || r.dados?.['REFERÊNCIA'] || r.dados?.['Código'] || r.dados?.['codigo'] || '').trim().toUpperCase();
            const qty = qtdCol ? (parseFloat(String(r.dados?.[qtdCol] ?? '0').replace(',', '.')) || 0) : 0;
            if (k) m[k] = (m[k] || 0) + qty;
        });
        return m;
    },

    _calcAbcClasse(totaisMap, codigosAlvo) {
        // Calcula classe ABC direto do mapa {cod: total} — sem depender de _items pré-renderizado
        const items = Object.entries(totaisMap).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
        const totalGeral = items.reduce((s,[,v]) => s+v, 0);
        if (!totalGeral) return null;
        let cum = 0;
        const classes = {};
        for (const [cod, val] of items) {
            cum += val;
            const pct = cum / totalGeral;
            classes[cod] = pct <= 0.80 ? 'A' : pct <= 0.95 ? 'B' : 'C';
        }
        const order = ['A','B','C'];
        const found = codigosAlvo.map(k => classes[k.toUpperCase()]).filter(Boolean);
        if (!found.length) return null;
        return found.sort((a,b) => order.indexOf(a)-order.indexOf(b))[0];
    },

    _getAbcVendasClasse(codigos, cols) {
        const activeCols = cols || vendas.getActiveCols();
        if (!vendas.rawData.length || !activeCols.length) return null;
        const map = {};
        vendas.rawData.forEach(r => {
            const cod = String(r.codigo || '').toUpperCase();
            if (!map[cod]) map[cod] = 0;
            activeCols.forEach(c => { map[cod] += (Number(r[c.key]) || 0); });
        });
        return this._calcAbcClasse(map, codigos);
    },

    _getAbcEstoqueClasse(codigos) {
        if (!estoque.rawData?.length) return null;
        const map = {};
        estoque.rawData.forEach(r => {
            const cod = String(r.codigo || '').toUpperCase();
            map[cod] = (map[cod] || 0) + (Number(r.quantidade) || 0);
        });
        // Código existe no cadastro mas com saldo zero → classifica como C
        const alvo = codigos.map(c => c.toUpperCase());
        const noEstoque = alvo.some(c => c in map);
        if (!noEstoque) return null;
        if (alvo.every(c => (map[c] || 0) === 0)) return 'C';
        return this._calcAbcClasse(map, codigos);
    },

    _renderAbcBlock(codigos, cols) {
        const block = document.getElementById('pc-abc-block');
        if (!block) return;
        const cv = this._getAbcVendasClasse(codigos, cols);
        const ce = this._getAbcEstoqueClasse(codigos);
        if (!cv && !ce) { block.style.display = 'none'; return; }

        const cor = { A:'#26c6da', B:'#ffab76', C:'#8b949e' };
        const bg  = { A:'rgba(38,198,218,.12)', B:'rgba(255,171,118,.12)', C:'rgba(139,148,158,.12)' };

        const badge = (c, label) => c
            ? `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
                <span style="font-size:0.65rem;color:var(--text-dim);letter-spacing:.08em;">${label}</span>
                <span style="font-size:2rem;font-weight:800;color:${cor[c]};background:${bg[c]};
                    border:2px solid ${cor[c]}44;border-radius:12px;width:56px;height:56px;
                    display:flex;align-items:center;justify-content:center;line-height:1;">${c}</span>
               </div>`
            : `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
                <span style="font-size:0.65rem;color:var(--text-dim);letter-spacing:.08em;">${label}</span>
                <span style="font-size:0.8rem;color:var(--text-dim);width:56px;height:56px;
                    display:flex;align-items:center;justify-content:center;border:1px dashed var(--border);border-radius:12px;">—</span>
               </div>`;

        const sep = `<span style="font-size:1.4rem;color:var(--text-dim);margin-top:16px;">×</span>`;

        const interpretacoes = {
            AA: { icon: DOT.check,  texto:'Equilíbrio — alto giro e bom estoque.',          cor:'#26a69a' },
            AB: { icon: DOT.yellow, texto:'Atenção — alto giro, estoque médio.',             cor:'#ffab76' },
            AC: { icon: DOT.red,    texto:'Risco de ruptura — alto giro, estoque crítico.',  cor:'#f06292' },
            BA: { icon: DOT.yellow, texto:'Estoque excedente para giro médio.',              cor:'#ffab76' },
            BB: { icon: DOT.blue,   texto:'Equilíbrio moderado.',                            cor:'#26c6da' },
            BC: { icon: DOT.orange, texto:'Atenção — estoque baixo para giro médio.',        cor:'#e3b341' },
            CA: { icon: DOT.orange, texto:'Estoque parado — baixo giro, muito estoque.',     cor:'#e3b341' },
            CB: { icon: DOT.gray,   texto:'Estoque acima do necessário para baixo giro.',    cor:'#8b949e' },
            CC: { icon: DOT.gray,   texto:'Candidato a revisão — baixo giro e estoque.',     cor:'#8b949e' },
        };
        const chave = cv && ce ? cv+ce : null;
        const interp = chave ? interpretacoes[chave] : null;

        block.style.display = 'block';
        block.innerHTML = `
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px 20px;
                display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
                <div>
                    <div style="font-size:0.62rem;font-weight:700;letter-spacing:.1em;color:var(--text-dim);margin-bottom:10px;">POSIÇÃO NA CURVA ABC</div>
                    <div style="display:flex;align-items:center;gap:12px;">
                        ${badge(cv,'VENDAS')}
                        ${sep}
                        ${badge(ce,'ESTOQUE')}
                    </div>
                </div>
                ${interp ? `
                <div style="border-left:1px solid var(--border);padding-left:20px;flex:1;min-width:180px;">
                    <div style="font-size:1.1rem;margin-bottom:6px;">${interp.icon}</div>
                    <div style="font-size:0.85rem;color:${interp.cor};font-weight:600;">${interp.texto}</div>
                </div>` : ''}
            </div>`;
    },

    render() {
        const tbody   = document.getElementById('pesquisa-tbody');
        const countEl = document.getElementById('pesquisa-count');
        const empty   = document.getElementById('pesquisa-empty');
        const cards   = document.getElementById('pesquisa-cards');
        if (!tbody) return;

        this.populateFiltros();

        const q      = this._query.toUpperCase();
        const anoSel = document.getElementById('pesquisa-ano')?.value    || '';
        const modSel = document.getElementById('pesquisa-modelo')?.value || '';

        if (!q) {
            tbody.innerHTML = '';
            if (countEl) countEl.textContent = '';
            if (empty) empty.style.display = 'block';
            if (cards) cards.style.display = 'none';
            const ab = document.getElementById('pc-abc-block');
            if (ab) ab.style.display = 'none';
            return;
        }
        if (empty) empty.style.display = 'none';

        if (!vendas.rawData?.length) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:#8b949e;">Importe dados de Vendas primeiro.</td></tr>`;
            if (countEl) countEl.textContent = '';
            return;
        }

        // Filtrar vendas por código + modelo
        let rows = vendas.rawData.filter(r => String(r.codigo || '').toUpperCase().includes(q));
        if (modSel) rows = rows.filter(r => r.modelo === modSel);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:#8b949e;">Nenhum resultado para "${this._query}"</td></tr>`;
            if (countEl) countEl.textContent = '0 resultados';
            if (cards) cards.style.display = 'none';
            return;
        }

        // Colunas do ano selecionado (afeta TOTAL VENDAS e MÉDIA VENDAS)
        const allCols  = anoSel
            ? vendas.monthCols.filter(c => c.year === anoSel)
            : vendas.monthCols;
        const nMeses   = allCols.length || 1;

        // Mapas dos módulos
        const estMap  = this._buildEstoqueMap();
        const opMap   = this._buildOPMap();
        const cosMap  = this._buildCosturaMap();

        const fmt = v => v != null && v > 0 ? Math.round(v).toLocaleString('pt-BR') : '<span style="opacity:.3">—</span>';

        let sumVendas = 0, sumMedia = 0, sumEst = 0, sumOP = 0, sumCos = 0;

        const anoLabel = anoSel ? ` · ${anoSel}` : '';
        document.querySelector('#pesquisa-table thead tr').innerHTML = `
            <th>CÓDIGO</th><th>DESCRIÇÃO</th><th>MARCA</th><th>SEGMENTO</th>
            <th class="td-center">TAM.</th>
            <th class="td-right">TOTAL VENDAS${anoLabel}</th>
            <th class="td-right" style="color:#26c6da;">MÉDIA VENDAS${anoLabel}</th>
            <th class="td-right" style="color:#26a69a;">ESTOQUE</th>
            <th class="td-right" style="color:#ffab76;">PROCESSO (OP)</th>
            <th class="td-right" style="color:#7c4dff;">COSTURA</th>`;

        tbody.innerHTML = rows.map(r => {
            const totalV = allCols.reduce((s, c) => s + (r[c.key] || 0), 0);
            const media  = totalV / nMeses;
            const cod    = String(r.codigo || '').trim().toUpperCase();
            const est    = estMap[cod]  || 0;
            const opQty  = opMap[cod]   || 0;
            const cosQty = cosMap[cod]  || 0;

            sumVendas += totalV; sumMedia += media; sumEst += est; sumOP += opQty; sumCos += cosQty;

            return `<tr>
                <td class="td-code">${escHTML(r.codigo)}</td>
                <td class="td-desc">${escHTML(r.descricao)}</td>
                <td>${r.marca ? escHTML(r.marca) : '<span style="opacity:.3">—</span>'}</td>
                <td><span class="seg-badge">${escHTML(r.segmento)}</span></td>
                <td class="td-center">${escHTML(r.tamanho)}</td>
                <td class="td-right">${fmt(totalV)}</td>
                <td class="td-right" style="color:#26c6da;font-weight:600;">${fmt(media)}</td>
                <td class="td-right" style="color:#26a69a;font-weight:600;">${fmt(est)}</td>
                <td class="td-right" style="color:#ffab76;font-weight:600;">${fmt(opQty)}</td>
                <td class="td-right" style="color:#7c4dff;font-weight:600;">${fmt(cosQty)}</td>
            </tr>`;
        }).join('');

        if (countEl) countEl.textContent = `${rows.length.toLocaleString('pt-BR')} ${rows.length === 1 ? 'resultado' : 'resultados'}`;

        // Cards resumo
        if (cards) {
            cards.style.display = 'block';
            document.getElementById('pc-vendas').textContent  = Math.round(sumVendas).toLocaleString('pt-BR');
            document.getElementById('pc-media').textContent   = Math.round(sumMedia / rows.length).toLocaleString('pt-BR');
            document.getElementById('pc-estoque').textContent = Math.round(sumEst).toLocaleString('pt-BR');
            document.getElementById('pc-op').textContent      = Math.round(sumOP).toLocaleString('pt-BR');
            document.getElementById('pc-costura').textContent = Math.round(sumCos).toLocaleString('pt-BR');
        }

        // Bloco ABC cruzado
        const codigos = [...new Set(rows.map(r => String(r.codigo||'').trim().toUpperCase()).filter(Boolean))];
        this._renderAbcBlock(codigos, allCols);
    }
};

// ====== DASHBOARD: VENDAS × ESTOQUE ======

const vxe = {
    selectedYear: 'all',
    selectedTri:  '',
    selectedMes:  '',
    _dirty:       false,

    init() {
        document.getElementById('vxe-year-tabs').addEventListener('click', e => {
            const btn = e.target.closest('.year-tab');
            if (!btn) return;
            document.querySelectorAll('#vxe-year-tabs .year-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.selectedYear = btn.dataset.year;
            this.selectedTri  = ''; document.getElementById('vxe-tri').value = '';
            this.selectedMes  = ''; document.getElementById('vxe-mes').value = '';
            this.render();
        });
        document.getElementById('vxe-tri').addEventListener('change', e => {
            this.selectedTri = e.target.value;
            if (e.target.value) { this.selectedMes = ''; document.getElementById('vxe-mes').value = ''; }
            this.render();
        });
        document.getElementById('vxe-mes').addEventListener('change', e => {
            this.selectedMes = e.target.value;
            if (e.target.value) { this.selectedTri = ''; document.getElementById('vxe-tri').value = ''; }
            this.render();
        });
        document.getElementById('vxe-marca').addEventListener('change',  () => this.render());
        document.getElementById('vxe-modelo').addEventListener('change', () => this.render());
        document.getElementById('vxe-seg').addEventListener('change',    () => this.render());
        document.getElementById('vxe-status').addEventListener('change', () => this.render());
        document.getElementById('vxe-search').addEventListener('input', () => this.render());
    },

    render() {
        if (!vendas.rawData.length) {
            document.getElementById('vxe-count').textContent = 'Importe dados de Vendas primeiro';
            return;
        }

        // Year tabs
        const tabsEl = document.getElementById('vxe-year-tabs');
        if (vendas.years.length === 1) this.selectedYear = vendas.years[0];
        tabsEl.innerHTML = vendas.years.map(y =>
            `<button class="year-tab${this.selectedYear === y ? ' active' : ''}" data-year="${y}">${y}</button>`
        ).join('') + (vendas.years.length > 1
            ? `<button class="year-tab${this.selectedYear === 'all' ? ' active' : ''}" data-year="all">Todos</button>` : '');

        // Cols do período selecionado
        const allCols = this.selectedYear === 'all' ? vendas.monthCols : vendas.monthCols.filter(c => c.year === this.selectedYear);
        let activeCols, divisor;
        if (this.selectedTri && TRIMESTRES[this.selectedTri]) {
            activeCols = allCols.filter(c => TRIMESTRES[this.selectedTri].includes(c.abbr));
            divisor = 3;
        } else if (this.selectedMes) {
            activeCols = allCols.filter(c => c.abbr === this.selectedMes);
            divisor = 1;
        } else {
            activeCols = allCols;
            divisor = activeCols.length || 1;
        }

        // Mês selector
        const uniqueAbbrs = [...new Set(allCols.map(c => c.abbr))];
        const mesEl = document.getElementById('vxe-mes');
        const curMes = this.selectedMes;
        mesEl.innerHTML = '<option value="">Todos</option>' +
            MONTHS.filter(m => uniqueAbbrs.includes(m))
                  .map(m => `<option value="${m}"${m === curMes ? ' selected' : ''}>${m.charAt(0).toUpperCase()+m.slice(1)}</option>`)
                  .join('');

        const marca  = document.getElementById('vxe-marca').value;
        const modelo = document.getElementById('vxe-modelo').value;
        const seg    = document.getElementById('vxe-seg').value;
        const status = document.getElementById('vxe-status').value;
        const search = document.getElementById('vxe-search').value.toLowerCase().trim();

        // Marca — lê r.marca; fallback para _extras/dados se a coluna DB ainda não foi migrada
        const _normMarca = k => String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
        const _getMarca = r => {
            const m = String(r.marca||'').trim();
            if (m) return m;
            const extKey = Object.keys(r._extras||{}).find(k => _normMarca(k) === 'marca');
            return extKey ? String(r._extras[extKey]||'').trim() : '';
        };
        const marcas = [...new Set(vendas.rawData.map(r => _getMarca(r)).filter(Boolean))].sort();
        const marcaEl = document.getElementById('vxe-marca');
        const curMarca = marcaEl.value;
        marcaEl.innerHTML = '<option value="">Todas</option>' + marcas.map(m => `<option value="${m}"${m===curMarca?' selected':''}>${m}</option>`).join('');

        // Modelo
        const modelos  = [...new Set(vendas.rawData.map(r => String(r.modelo||'').trim()).filter(Boolean))].sort();
        const modeloEl = document.getElementById('vxe-modelo');
        const curMod   = modeloEl.value;
        modeloEl.innerHTML = '<option value="">Todos</option>' + modelos.map(m => `<option value="${m}"${m===curMod?' selected':''}>${m}</option>`).join('');

        // Segmento
        const segs = [...new Set(vendas.rawData.map(r => r.segmento).filter(Boolean))].sort();
        const segEl = document.getElementById('vxe-seg');
        const cur = segEl.value;
        segEl.innerHTML = '<option value="">Todos</option>' + segs.map(s => `<option value="${s}">${s}</option>`).join('');
        segEl.value = cur;

        // Mapa de estoque por código
        const estMap = {};
        estoque.rawData.forEach(r => { estMap[String(r.codigo||'').trim()] = Number(r.quantidade) || 0; });

        // Mapa de OP por código (soma quantidades em produção por código)
        const opMap = {};
        if (op.rawData.length && op.colunas.length) {
            const COD_KEYS = ['codigo','cod','codigodoproduto','cdproduto','cdprod','codprod','ref','referencia'];
            const QTD_KEYS = ['producao','quantidade','qtd','qty','qtde','aproduzir','pecas'];
            // Matching flexível: inclui parcial para cobrir variações de nome de coluna
            const codCol = op._colRef
                || op.colunas.find(c => { const n=normalizeKey(c); return COD_KEYS.some(k => n===k || n.includes(k) || k.includes(n)); });
            const qtdCol = op._colQtd || op.colunas.find(c => { const n=normalizeKey(c); return QTD_KEYS.some(k => n===k || n.includes(k)); });
            if (codCol && qtdCol) {
                op.rawData.forEach(r => {
                    const cod = String(r.dados?.[codCol] || '').trim();
                    const qty = Number(String(r.dados?.[qtdCol] || '').replace(/[^\d.-]/g,'')) || 0;
                    if (cod) opMap[cod] = (opMap[cod] || 0) + qty;
                });
            }
        }

        const rows = vendas.rawData
            .filter(r => (!marca || _getMarca(r) === marca) && (!modelo || String(r.modelo||"").trim() === modelo) && (!seg || r.segmento === seg) && (!search || String(r.codigo||"").toLowerCase().includes(search)))
            .map(r => {
                const vendTotal  = activeCols.reduce((s, c) => s + (r[c.key] || 0), 0);
                const vendMedia  = Math.round(vendTotal / divisor);
                const cod        = String(r.codigo||'').trim();
                const estQtd     = estMap[cod] ?? null;
                const opQtd      = opMap[cod]  || 0;
                const estProcesso = (estQtd || 0) + opQtd;
                const cob = vendMedia > 0 ? estProcesso / vendMedia : null;
                const st  = cob === null ? 'sem-dados'
                          : cob < 1     ? 'critico'
                          : cob <= 3    ? 'ok'
                          :               'excesso';
                return { ...r, vendTotal, vendMedia, estQtd, estProcesso, st };
            })
            .filter(r => !status || r.st === status)
            .sort((a, b) => {
                const cob = r => r.vendMedia > 0 ? r.estProcesso / r.vendMedia : Infinity;
                return cob(a) - cob(b);
            });

        const periodoLabel = this.selectedTri
            ? this.selectedTri
            : this.selectedMes ? this.selectedMes.charAt(0).toUpperCase()+this.selectedMes.slice(1) : 'período';
        const vxeTrunc = rows.length > 2000 ? ' (exibindo 2.000)' : '';
        document.getElementById('vxe-count').textContent =
            `${rows.length.toLocaleString('pt-BR')} itens · média por ${periodoLabel}${vxeTrunc}`;

        const labels  = { ok: 'EQUILÍBRIO', critico: 'CRÍTICO', excesso: 'EXCESSO', 'sem-dados': '—' };
        const classes = { ok: 'vxe-ok', critico: 'vxe-zero', excesso: 'vxe-baixo', 'sem-dados': 'vxe-nd' };

        // Atualiza cards de resumo
        const totalSkus     = rows.length;
        const totalVendas   = rows.reduce((s, r) => s + r.vendTotal, 0);
        const totalEstProc  = rows.reduce((s, r) => s + r.estProcesso, 0);
        document.getElementById('vxe-card-skus').textContent        = totalSkus.toLocaleString('pt-BR');
        document.getElementById('vxe-card-vendas').textContent      = totalVendas.toLocaleString('pt-BR');
        document.getElementById('vxe-card-estprocesso').textContent = totalEstProc.toLocaleString('pt-BR');

        // Delta 2025 vs 2026
        const anos = vendas.years || [];
        if (anos.includes('2025') && anos.includes('2026')) {
            const cols25 = vendas.monthCols.filter(c => c.year === '2025');
            const cols26 = vendas.monthCols.filter(c => c.year === '2026');
            const mesComuns = [...new Set(cols25.map(c=>c.abbr))].filter(a => cols26.some(c=>c.abbr===a));
            if (mesComuns.length) {
                let v25 = 0, v26 = 0;
                vendas.rawData.forEach(r => {
                    mesComuns.forEach(abbr => {
                        const c25 = cols25.find(c=>c.abbr===abbr), c26 = cols26.find(c=>c.abbr===abbr);
                        if (c25) v25 += (r[c25.key]||0);
                        if (c26) v26 += (r[c26.key]||0);
                    });
                });
                const pct = v25 > 0 ? ((v26-v25)/v25*100).toFixed(1) : null;
                const deltaEl = document.getElementById('vxe-card-delta');
                const subEl   = document.getElementById('vxe-card-delta-sub');
                const card    = document.getElementById('vxe-delta-card');
                if (deltaEl && pct !== null) {
                    deltaEl.textContent = (pct > 0 ? '+' : '') + pct + '%';
                    deltaEl.style.color = pct > 0 ? '#26a69a' : '#f06292';
                    if (subEl) subEl.textContent = `${mesComuns.length} mes(es) comparados`;
                    if (card) card.style.display = '';
                }
            }
        }

        this._lastRows = rows;
        document.querySelector('#vxe-table tbody').innerHTML = rows.slice(0, 2000).map(r => `
            <tr onclick="abrirDetalheVxe('${r.descricao.replace(/'/g,"\\'")}');" style="cursor:pointer;">
                <td class="td-code" style="color:var(--indigo-primary);">${escHTML(r.codigo)}</td>
                <td class="td-desc">${escHTML(r.descricao)}</td>
                <td style="font-size:0.75rem;">${r.marca || '<span style="opacity:.3">—</span>'}</td>
                <td><span class="seg-badge">${r.segmento}</span></td>
                <td class="td-center">${r.tamanho}</td>
                <td class="td-qtd">${r.vendTotal.toLocaleString('pt-BR')}</td>
                <td class="td-qtd" style="color:var(--indigo-primary);">${r.vendMedia.toLocaleString('pt-BR')}</td>
                <td class="td-qtd">${r.estQtd !== null ? r.estQtd.toLocaleString('pt-BR') : '—'}</td>
                <td class="td-qtd" style="color:#26a69a;">${r.estProcesso.toLocaleString('pt-BR')}</td>
                <td class="td-right">${(() => {
                    if (r.vendMedia <= 0) return '—';
                    const cob = r.estProcesso / r.vendMedia;
                    const cor = cob < 1 ? '#f06292' : cob <= 3 ? '#26a69a' : '#ffab76';
                    return `<span style="color:${cor};font-weight:600;">${cob.toFixed(1)} meses</span>`;
                })()}</td>
                <td class="td-right">${(() => {
                    if (r.vendMedia <= 0) return '<span style="opacity:.3">—</span>';
                    const mult = parseFloat(document.getElementById('vxe-prog-mult')?.value) || 1;
                    const prog = Math.round((r.vendMedia - r.estProcesso) * mult);
                    const cor = prog > 0 ? '#f06292' : '#26a69a';
                    const txt = prog > 0 ? `+${prog.toLocaleString('pt-BR')}` : prog.toLocaleString('pt-BR');
                    return `<span style="color:${cor};font-weight:700;">${txt}</span>`;
                })()}</td>
                <td class="td-center"><span class="vxe-badge ${classes[r.st]}">${labels[r.st]}</span></td>
            </tr>`).join('');

        // Atualiza opDash se visível, senão marca como desatualizado
        if (document.getElementById('view-op-dash')?.style.display !== 'none') {
            opDash.render();
        } else {
            opDash._dirty = true;
        }
    },

    exportar() {
        if (!this._lastRows?.length) return;
        const dados = this._lastRows.map(r => ({
            Código: r.codigo, Descrição: r.descricao, Marca: r.marca, Segmento: r.segmento, Tamanho: r.tamanho,
            'Média Vendas': r.vendMedia, Estoque: r.estQtd, 'Estoque + OP': r.estProcesso,
            Cobertura: r.vendMedia > 0 ? +(r.estProcesso/r.vendMedia).toFixed(2) : null, Status: r.st
        }));
        exportarXLS(dados, 'vendas_x_estoque');
    }
};

// ====== DASHBOARD: CLIENTES ======
const clientesDash = {
    _rows:     [],
    _dirty:    false,
    _rankMode: 'valor',   // 'valor' | 'qtd'
    _sortCol:  'valor',
    _sortAsc:  false,
    _anoSel:   '',

    _toNum: v => typeof v === 'number' ? v : (parseFloat(String(v ?? '0').replace(/\./g,'').replace(',','.')) || 0),
    _parseDt: s => { const [d,m,y]=String(s||'').split('/'); return y?new Date(+y,+m-1,+d):null; },
    _fmtBRL: v => 'R$ ' + v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),

    _build() {
        const anoSel = this._anoSel;
        const mesSel = document.getElementById('cli-filtro-mes')?.value || '';
        const diaSel = document.getElementById('cli-filtro-dia')?.value || '';
        const cliSel = document.getElementById('cli-filtro-cliente')?.value || '';
        const busca  = (document.getElementById('cli-filtro-busca')?.value||'').toLowerCase().trim();
        const map = {};
        (cliente.rawData||[]).forEach(r => {
            const d    = r.dados||{};
            const nome = String(d[cliente._colDesc]||d[cliente._colCliente]||'').trim().toUpperCase() || '(SEM DESCRIÇÃO)';
            const data = String(d[cliente._colData]||'').trim();
            const qtd  = this._toNum(d[cliente._colQtd]);
            const val  = this._toNum(d[cliente._colValTotal]);
            const desc = String(d[cliente._colDesc]||d[cliente._colCodigo]||'').trim().toUpperCase();
            if (cliSel && nome !== cliSel) return;
            const dt = this._parseDt(data);
            if (anoSel && dt && String(dt.getFullYear()) !== anoSel) return;
            if (mesSel && dt && String(dt.getMonth()+1).padStart(2,'0') !== mesSel) return;
            if (diaSel && dt && String(dt.getDate()).padStart(2,'0') !== diaSel) return;
            if (!map[nome]) map[nome] = { nome, pedidos:0, qtd:0, valor:0, ultima:null, itens:[] };
            map[nome].pedidos++;
            map[nome].qtd   += qtd;
            map[nome].valor += val;
            if (dt && (!map[nome].ultima || dt > map[nome].ultima)) map[nome].ultima = dt;
            map[nome].itens.push({ data, desc, qtd, valor:val });
        });
        let rows = Object.values(map);
        // Ordenação
        const s = this._sortCol, asc = this._sortAsc;
        rows.sort((a,b) => {
            const va = s==='nome' ? a.nome : s==='ultima' ? (a.ultima||0) : a[s];
            const vb = s==='nome' ? b.nome : s==='ultima' ? (b.ultima||0) : b[s];
            return asc ? (va>vb?1:-1) : (va<vb?1:-1);
        });
        if (busca) rows = rows.filter(r => r.nome.toLowerCase().includes(busca));
        this._rows = rows;
        return rows;
    },

    render() {
        const empty   = document.getElementById('cli-dash-empty');
        const content = document.getElementById('cli-dash-content');
        if (!cliente.rawData?.length) {
            if (empty) empty.style.display='block';
            if (content) content.style.display='none';
            return;
        }
        if (empty) empty.style.display='none';
        if (content) content.style.display='flex';
        this._populaFiltros();
        const rows = this._build();
        const totalVal = rows.reduce((s,r)=>s+r.valor, 0);
        const totalPed = rows.reduce((s,r)=>s+r.pedidos, 0);
        const totalQtd = rows.reduce((s,r)=>s+r.qtd, 0);
        const ticket   = totalPed > 0 ? totalVal/totalPed : 0;
        // Total bruto da importação (sem filtros) para validação cruzada
        const totalImport = (cliente.rawData||[]).reduce((s,r) => s + this._toNum(r.dados?.[cliente._colValTotal]), 0);
        const hasFiltro   = !!(this._anoSel || document.getElementById('cli-filtro-mes')?.value || document.getElementById('cli-filtro-dia')?.value || document.getElementById('cli-filtro-cliente')?.value || (document.getElementById('cli-filtro-busca')?.value||'').trim());
        const elImport = document.getElementById('cli-total-import');
        if (elImport) {
            elImport.textContent = this._fmtBRL(totalImport);
            const elWrap = document.getElementById('cli-import-wrap');
            if (elWrap) elWrap.style.display = hasFiltro ? '' : 'none';
        }
        const elFatSub = document.getElementById('cli-fat-sub');
        if (elFatSub) elFatSub.textContent = hasFiltro ? 'filtrado' : 'todos os registros da importação';
        document.getElementById('cli-total-clientes').textContent = rows.length.toLocaleString('pt-BR');
        document.getElementById('cli-faturamento').textContent    = this._fmtBRL(totalVal);
        document.getElementById('cli-ticket-medio').textContent   = this._fmtBRL(ticket);
        document.getElementById('cli-total-pedidos').textContent  = totalPed.toLocaleString('pt-BR');
        document.getElementById('cli-total-qtd').textContent      = totalQtd.toLocaleString('pt-BR');
        this._drawRanking(rows, totalVal, totalQtd);
        this._populaEvolucaoSelect(rows);
        this._drawEvolucao();
        this._renderTabela(rows);
    },

    _populaFiltros() {
        const anos = new Set(), meses = new Set(), dias = new Set(), nomes = new Set();
        (cliente.rawData||[]).forEach(r => {
            const [dd,mm,yy] = String(r.dados?.[cliente._colData]||'').split('/');
            if (yy) { anos.add(yy); meses.add(mm?.padStart(2,'0')); dias.add(dd?.padStart(2,'0')); }
            const n = String(r.dados?.[cliente._colDesc]||r.dados?.[cliente._colCliente]||'').trim().toUpperCase() || '(SEM DESCRIÇÃO)';
            nomes.add(n);
        });
        // Botões de ano
        const btnWrap = document.getElementById('cli-ano-btns');
        if (btnWrap && btnWrap.children.length === 0) {
            ['', ...[...anos].sort()].forEach(a => {
                const b = document.createElement('button');
                b.className = 'btn ' + (a===this._anoSel?'primary':'secondary');
                b.textContent = a || 'Todos';
                b.style.cssText = 'font-size:0.75rem;padding:4px 12px;';
                b.onclick = () => { this._anoSel = a; this.render(); };
                btnWrap.appendChild(b);
            });
        } else if (btnWrap) {
            [...btnWrap.children].forEach(b => {
                const a = b.textContent==='Todos'?'':b.textContent;
                b.className = 'btn '+(a===this._anoSel?'primary':'secondary');
            });
        }
        const MESES_NM = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        // Sempre reconstrói os selects com dados atuais da importação ativa
        const mesSel = document.getElementById('cli-filtro-mes');
        if (mesSel) {
            const cur = mesSel.value;
            mesSel.innerHTML = '<option value="">Todos os meses</option>';
            [...meses].filter(Boolean).sort().forEach(m => { const o=document.createElement('option'); o.value=m; o.textContent=MESES_NM[+m]||m; mesSel.appendChild(o); });
            if (cur) mesSel.value = cur;
        }

        const diaSel = document.getElementById('cli-filtro-dia');
        if (diaSel) {
            const cur = diaSel.value;
            diaSel.innerHTML = '<option value="">Todos os dias</option>';
            [...dias].filter(Boolean).sort().forEach(d => { const o=document.createElement('option'); o.value=d; o.textContent='Dia '+String(+d); diaSel.appendChild(o); });
            if (cur) diaSel.value = cur;
        }

        const cliSel = document.getElementById('cli-filtro-cliente');
        if (cliSel) {
            const cur = cliSel.value;
            cliSel.innerHTML = '<option value="">Todas as descrições</option>';
            [...nomes].sort().forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; cliSel.appendChild(o); });
            if (cur && [...nomes].includes(cur)) cliSel.value = cur;
        }
    },

    _limparFiltros() {
        this._anoSel = '';
        ['cli-filtro-mes','cli-filtro-dia','cli-filtro-cliente'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        const bus = document.getElementById('cli-filtro-busca');
        if (bus) bus.value = '';
        this.render();
    },

    _setRankMode(mode) {
        this._rankMode = mode;
        document.getElementById('cli-rank-val-btn').className = 'btn ' + (mode==='valor'?'primary':'secondary');
        document.getElementById('cli-rank-qtd-btn').className = 'btn ' + (mode==='qtd'?'primary':'secondary');
        const rows = this._rows;
        const totalVal = rows.reduce((s,r)=>s+r.valor,0);
        const totalQtd = rows.reduce((s,r)=>s+r.qtd,0);
        this._drawRanking(rows, totalVal, totalQtd);
    },

    _sortBy(col) {
        this._sortAsc = this._sortCol === col ? !this._sortAsc : false;
        this._sortCol = col;
        this.render();
    },

    _drawRanking(allRows, totalVal, totalQtd) {
        const el = document.getElementById('cli-ranking');
        if (!el) return;
        const byVal = this._rankMode === 'valor';
        const top   = [...allRows].sort((a,b) => byVal ? b.valor-a.valor : b.qtd-a.qtd).slice(0,10);
        if (!top.length) { el.innerHTML='<p style="color:#8b949e;font-size:0.8rem;">Sem dados</p>'; return; }
        const maxPri = byVal ? (top[0]?.valor||1) : (top[0]?.qtd||1);
        const maxSec = byVal ? (Math.max(...top.map(r=>r.qtd))||1) : (Math.max(...top.map(r=>r.valor))||1);

        el.innerHTML = top.map((r,i) => {
            const pctPri = Math.round((byVal ? r.valor : r.qtd) / maxPri * 100);
            const pctSec = Math.round((byVal ? r.qtd : r.valor) / maxSec * 100);
            const share  = byVal
                ? (totalVal>0 ? ((r.valor/totalVal)*100).toFixed(1) : '0')
                : (totalQtd>0 ? ((r.qtd/totalQtd)*100).toFixed(1) : '0');
            const valStr = this._fmtBRL(r.valor);
            const qtdStr = r.qtd.toLocaleString('pt-BR');
            return `<div style="margin-bottom:11px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                    <span style="font-size:0.77rem;font-weight:600;color:#e6edf3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;flex:1;" title="${r.nome}">
                        <span style="color:#26c6da;margin-right:5px;">${i+1}.</span>${r.nome}
                    </span>
                    <span style="font-size:0.71rem;font-weight:700;margin-left:6px;flex-shrink:0;">
                        <span style="color:#26a69a;">${valStr}</span>
                        <span style="color:#8b949e;margin:0 3px;">·</span>
                        <span style="color:#ffab76;">${qtdStr} un</span>
                        <span style="color:#8b949e;margin-left:3px;">(${share}%)</span>
                    </span>
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <div style="background:rgba(255,255,255,0.06);border-radius:3px;height:5px;">
                        <div style="background:linear-gradient(90deg,#26c6da,#26a69a);width:${pctPri}%;height:100%;border-radius:3px;"></div>
                    </div>
                    <div style="background:rgba(255,255,255,0.06);border-radius:3px;height:3px;">
                        <div style="background:rgba(255,171,118,0.7);width:${pctSec}%;height:100%;border-radius:3px;"></div>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    _populaEvolucaoSelect(rows) {
        const sel = document.getElementById('cli-evolucao-cliente');
        if (!sel) return;
        const cur = sel.value;
        const sorted = [...rows].sort((a,b) => b.valor - a.valor);
        sel.innerHTML = '<option value="">Todas as descrições</option>' +
            sorted.slice(0,50).map(r=>`<option value="${r.nome}"${r.nome===cur?' selected':''}>${r.nome}</option>`).join('');
    },

    _drawEvolucao() {
        const canvas  = document.getElementById('cli-evolucao-canvas');
        if (!canvas) return;
        const selCli  = document.getElementById('cli-evolucao-cliente')?.value || '';
        const metrica = document.getElementById('cli-evolucao-metrica')?.value || 'valor';
        const isVal   = metrica === 'valor';

        const mMap = {};
        const mesFiltro = document.getElementById('cli-filtro-mes')?.value||'';
        const diaFiltro = document.getElementById('cli-filtro-dia')?.value||'';
        const cliFiltro = document.getElementById('cli-filtro-cliente')?.value||'';
        const busFiltro = (document.getElementById('cli-filtro-busca')?.value||'').toLowerCase().trim();
        (cliente.rawData||[]).forEach(r => {
            const d    = r.dados||{};
            const nome = String(d[cliente._colDesc]||d[cliente._colCliente]||'').trim().toUpperCase() || '(SEM DESCRIÇÃO)';
            if (selCli && nome !== selCli) return;
            if (cliFiltro && nome !== cliFiltro) return;
            if (busFiltro && !nome.toLowerCase().includes(busFiltro)) return;
            const dataStr = String(d[cliente._colData]||'').trim();
            const [dd,mm,yy] = dataStr.split('/');
            if (!yy) return;
            if (this._anoSel && yy !== this._anoSel) return;
            if (mesFiltro && mm?.padStart(2,'0') !== mesFiltro) return;
            if (diaFiltro && dd?.padStart(2,'0') !== diaFiltro) return;
            const key = `${yy}-${mm?.padStart(2,'0')}`;
            if (!mMap[key]) mMap[key] = { valor:0, qtd:0 };
            mMap[key].valor += this._toNum(d[cliente._colValTotal]);
            mMap[key].qtd   += this._toNum(d[cliente._colQtd]);
        });

        const keys = Object.keys(mMap).sort();
        if (!keys.length) return;
        const vals  = keys.map(k => mMap[k][isVal ? 'valor' : 'qtd']);
        const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const lbls  = keys.map(k => MESES[+k.split('-')[1]-1]+'/'+k.split('-')[0].slice(2));
        const color = isVal ? '#26a69a' : '#ffab76';
        const colorA= isVal ? 'rgba(38,166,154,0.25)' : 'rgba(255,171,118,0.25)';

        const W = canvas.width = canvas.offsetWidth || 400;
        const H = canvas.height = 210;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,W,H);

        const padL=52, padR=16, padT=18, padB=28;
        const cW=W-padL-padR, cH=H-padT-padB, n=keys.length;
        const maxV = Math.max(...vals, 1);

        ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1;
        [0,0.25,0.5,0.75,1].forEach(p => {
            const y=padT+cH*(1-p);
            ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke();
            ctx.fillStyle='#8b949e'; ctx.font='bold 11px Inter'; ctx.textAlign='right';
            const v=maxV*p;
            ctx.fillText(isVal?(v>=1000?(v/1000).toFixed(0)+'k':Math.round(v)):Math.round(v), padL-4, y+4);
        });

        ctx.fillStyle='#c9d1d9'; ctx.font='bold 11px Inter'; ctx.textAlign='center';
        keys.forEach((_,i) => {
            const x=n===1?padL+cW/2:padL+(i/(n-1))*cW;
            if (n<=14 || i%2===0) ctx.fillText(lbls[i], x, H-padB+14);
        });

        const grad=ctx.createLinearGradient(0,padT,0,padT+cH);
        grad.addColorStop(0,colorA); grad.addColorStop(1,'rgba(0,0,0,0)');

        ctx.beginPath();
        vals.forEach((v,i) => {
            const x=n===1?padL+cW/2:padL+(i/(n-1))*cW, y=padT+cH*(1-v/maxV);
            i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        });
        ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.setLineDash([]); ctx.stroke();
        ctx.lineTo(n===1?padL+cW/2:padL+cW,padT+cH); ctx.lineTo(padL,padT+cH);
        ctx.closePath(); ctx.fillStyle=grad; ctx.fill();

        vals.forEach((v,i) => {
            const x=n===1?padL+cW/2:padL+(i/(n-1))*cW, y=padT+cH*(1-v/maxV);
            ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
            if (v>0) {
                const lbl=isVal?(v>=1000?(v/1000).toFixed(1)+'k':Math.round(v).toString()):Math.round(v).toString();
                ctx.font='bold 11px Inter'; ctx.textAlign='center';
                ctx.strokeStyle='rgba(13,17,23,0.85)'; ctx.lineWidth=3; ctx.lineJoin='round';
                ctx.strokeText(lbl,x,y-10); ctx.fillStyle=color; ctx.fillText(lbl,x,y-10);
            }
        });
    },

    _renderTabela(rows) {
        const tbody = document.getElementById('cli-tbody');
        const count = document.getElementById('cli-table-count');
        if (!tbody) return;
        if (count) count.textContent = `${rows.length.toLocaleString('pt-BR')} clientes`;
        const fmtDt = d => d ? d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'2-digit'}) : '—';

        tbody.innerHTML = rows.map((r,idx) => `
            <tr style="cursor:pointer;" onclick="clientesDash._toggleDetalhe(${idx},this)">
                <td style="font-weight:600;color:#e6edf3;">${r.nome}</td>
                <td class="td-right">${r.pedidos.toLocaleString('pt-BR')}</td>
                <td class="td-right" style="color:#ffab76;font-weight:600;">${r.qtd.toLocaleString('pt-BR')}</td>
                <td class="td-right" style="color:#26a69a;font-weight:600;">${this._fmtBRL(r.valor)}</td>
                <td class="td-right" style="color:#26c6da;">${this._fmtBRL(r.pedidos>0?r.valor/r.pedidos:0)}</td>
                <td class="td-right" style="color:#8b949e;">${fmtDt(r.ultima)}</td>
                <td class="td-right" style="color:#8b949e;font-size:0.8rem;">▼</td>
            </tr>
            <tr id="cli-det-${idx}" style="display:none;">
                <td colspan="7" style="padding:0;">
                    <div style="background:rgba(255,255,255,0.03);padding:12px 20px;border-top:1px solid var(--border);">
                        <table style="width:100%;font-size:0.78rem;">
                            <thead><tr style="color:#8b949e;">
                                <th style="padding:4px 8px;text-align:left;">DATA</th>
                                <th style="padding:4px 8px;text-align:left;">PRODUTO</th>
                                <th style="padding:4px 8px;text-align:right;">QTD</th>
                                <th style="padding:4px 8px;text-align:right;">VALOR</th>
                            </tr></thead>
                            <tbody>${[...r.itens].sort((a,b)=>{
                                const da=a.data.split('/').reverse().join('-'), db=b.data.split('/').reverse().join('-');
                                return db.localeCompare(da);
                            }).slice(0,50).map(it=>`<tr>
                                <td style="padding:4px 8px;color:#8b949e;">${it.data}</td>
                                <td style="padding:4px 8px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${it.desc}</td>
                                <td style="padding:4px 8px;text-align:right;color:#ffab76;">${it.qtd.toLocaleString('pt-BR')}</td>
                                <td style="padding:4px 8px;text-align:right;color:#26a69a;">R$ ${it.valor.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                            </tr>`).join('')}</tbody>
                        </table>
                        ${r.itens.length>50?`<p style="font-size:0.72rem;color:#8b949e;margin-top:6px;">+ ${r.itens.length-50} outros pedidos</p>`:''}
                    </div>
                </td>
            </tr>`).join('');
    },

    _toggleDetalhe(idx, tr) {
        const det = document.getElementById(`cli-det-${idx}`);
        if (!det) return;
        const open = det.style.display !== 'none';
        det.style.display = open ? 'none' : 'table-row';
        const arrow = tr.querySelector('td:last-child');
        if (arrow) arrow.textContent = open ? '▼' : '▲';
    }
};

// ====== DASHBOARD: COMPARADOR DE TENDÊNCIAS ======
const comparador = {
    _ano: 'ambos',
    _dirty: false,
    _colors: ['#26c6da', '#f06292', '#7c4dff', '#ffb74d', '#66bb6a'],
    _labels: ['A', 'B', 'C', 'D', 'E'],
    _slots: [
        { codigos: [], marca: '' },
        { codigos: [], marca: '' },
        { codigos: [], marca: '' },
        { codigos: [], marca: '' },
        { codigos: [], marca: '' }
    ],

    _populateMarcas() {
        const marcas = [...new Set(vendas.rawData.map(r => r.marca).filter(Boolean))].sort();
        [0,1,2,3,4].forEach(i => {
            const sel = document.getElementById(`comp-marca-${i}`);
            if (!sel) return;
            const cur = this._slots[i].marca;
            sel.innerHTML = '<option value="">Todas as marcas</option>' +
                marcas.map(m => `<option value="${m}"${m===cur?' selected':''}>${m}</option>`).join('');
        });
    },

    // B3: anos derivados dos dados (não mais fixos em 2025/2026)
    _anos() { return [...new Set(vendas.monthCols.map(c => c.year))].filter(Boolean).sort(); },
    _dois() { const a = this._anos(); return a.length >= 2 ? a.slice(-2) : [a[0] || '', a[0] || '']; },
    _renderAnoBtns() {
        const wrap = document.getElementById('comp-ano-btns'); if (!wrap) return;
        const anos = this._anos();
        if (this._ano !== 'ambos' && !anos.includes(this._ano)) this._ano = anos.length >= 2 ? 'ambos' : (anos[anos.length - 1] || 'ambos');
        let html = anos.map(a => `<button class="comp-ano-btn${this._ano === a ? ' active' : ''}" onclick="comparador.setAno('${a}')">${a}</button>`).join('');
        if (anos.length >= 2) { const [y1, y2] = anos.slice(-2); html += `<button class="comp-ano-btn${this._ano === 'ambos' ? ' active' : ''}" onclick="comparador.setAno('ambos')">${y1} + ${y2}</button>`; }
        wrap.innerHTML = html;
    },
    setAno(ano) {
        this._ano = ano;
        this._renderAnoBtns();
        this.render();
    },

    onSlotChange(i) {
        const marEl = document.getElementById(`comp-marca-${i}`);
        if (marEl) this._slots[i].marca = marEl.value;
        this.render();
    },

    onCodeKey(e, i) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const val = e.target.value.trim().toUpperCase().replace(/,/g, '');
            if (!val) return;
            if (this._slots[i].codigos.includes(val)) { e.target.value = ''; return; }
            if (this._slots[i].codigos.length >= 10) return;
            this._slots[i].codigos.push(val);
            e.target.value = '';
            this._renderTags(i);
            this.render();
        } else if (e.key === 'Backspace' && !e.target.value && this._slots[i].codigos.length > 0) {
            this._slots[i].codigos.pop();
            this._renderTags(i);
            this.render();
        }
    },

    removeCode(i, j) {
        this._slots[i].codigos.splice(j, 1);
        this._renderTags(i);
        this.render();
    },

    _renderTags(i) {
        const listEl = document.getElementById(`comp-tags-list-${i}`);
        if (!listEl) return;
        const color = this._colors[i];
        const slot  = this._slots[i];
        listEl.innerHTML = slot.codigos.map((cod, j) =>
            `<span class="comp-tag" style="background:${color}25;color:${color};">
                ${cod}
                <span class="comp-tag-remove" onclick="event.stopPropagation();comparador.removeCode(${i},${j})">✕</span>
            </span>`
        ).join('');
        const inp = document.getElementById(`comp-cod-${i}`);
        if (inp) inp.style.display = slot.codigos.length >= 10 ? 'none' : '';
    },

    clearSlot(i) {
        this._slots[i] = { codigos: [], marca: '' };
        const codEl = document.getElementById(`comp-cod-${i}`);
        const marEl = document.getElementById(`comp-marca-${i}`);
        if (codEl) { codEl.value = ''; codEl.style.display = ''; }
        if (marEl) marEl.value = '';
        this._renderTags(i);
        this.render();
    },

    _getSeries(i) {
        const slot = this._slots[i];
        const hasCods = slot.codigos.length > 0;
        if (!hasCods && !slot.marca) return null;
        const rows = vendas.rawData.filter(r => {
            const okCod   = !hasCods || slot.codigos.includes((r.codigo || '').toUpperCase());
            const okMarca = !slot.marca || r.marca === slot.marca;
            return okCod && okMarca;
        });
        if (!rows.length) return null;
        const totals = {};
        vendas.monthCols.forEach(c => { totals[c.key] = 0; });
        rows.forEach(r => vendas.monthCols.forEach(c => {
            totals[c.key] += (Number(r[c.key]) || 0);
        }));
        return totals;
    },

    render() {
        this._renderAnoBtns();  // B3: reconstrói os botões de ano a partir dos dados
        const empty   = document.getElementById('comp-empty');
        const content = document.getElementById('comp-content');
        if (!vendas.rawData?.length) {
            if (empty)   empty.style.display = 'flex';
            if (content) content.style.display = 'none';
            return;
        }
        if (empty)   empty.style.display = 'none';
        if (content) content.style.display = 'block';
        this._populateMarcas();
        this._drawChart();
        this._updateLegenda();
        this._updateResumo();
    },

    _calcStats(values, labels) {
        const nonzero = values.filter(v => v > 0);
        const total   = values.reduce((s, v) => s + v, 0);
        const avg     = nonzero.length ? Math.round(total / nonzero.length) : 0;
        const maxIdx  = values.reduce((b, v, i) => v > values[b] ? i : b, 0);
        const best    = values[maxIdx] > 0 ? `${labels[maxIdx]}` : '—';
        return { total, avg, best, months: nonzero.length };
    },

    _updateResumo() {
        const el = document.getElementById('comp-resumo');
        if (!el) return;

        const MONTHS_ORDER = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const cards = [];

        [0,1,2,3,4].forEach(i => {
            const slot = this._slots[i];
            if (!slot.codigos.length && !slot.marca) return;
            const totals = this._getSeries(i);
            if (!totals) return;

            const color = this._colors[i];
            const label = this._labels[i];
            const codPart = slot.codigos.length > 0
                ? slot.codigos.slice(0,2).join(', ') + (slot.codigos.length > 2 ? ` +${slot.codigos.length-2}` : '')
                : '';
            const name = [codPart, slot.marca].filter(Boolean).join(' · ') || '—';

            const statRow = (values, labels) => {
                const s = this._calcStats(values, labels);
                return `<div class="comp-res-stats">
                    <div class="comp-res-stat">
                        <span class="comp-res-val" style="color:${color};">${s.avg.toLocaleString('pt-BR')}</span>
                        <span class="comp-res-key">Média/mês</span>
                    </div>
                    <div class="comp-res-stat">
                        <span class="comp-res-val">${s.total.toLocaleString('pt-BR')}</span>
                        <span class="comp-res-key">Total</span>
                    </div>
                    <div class="comp-res-stat">
                        <span class="comp-res-val">${s.best}</span>
                        <span class="comp-res-key">Melhor mês</span>
                    </div>
                </div>`;
            };

            let body = '';
            if (this._ano === 'ambos') {
                const get = (year) => MONTHS_ORDER.map(abbr =>
                    vendas.monthCols.filter(c => c.abbr === abbr && c.year === year)
                        .reduce((s, c) => s + (totals[c.key] || 0), 0)
                );
                const [ya, yb] = this._dois();  // B3: dois anos mais recentes
                const p25 = get(ya), p26 = get(yb);
                body = `
                    <div class="comp-res-year-section">
                        <div class="comp-res-year-label" style="color:${color};">${ya}</div>
                        ${statRow(p25, MONTHS_ORDER)}
                    </div>
                    <hr class="comp-res-divider">
                    <div class="comp-res-year-section">
                        <div class="comp-res-year-label" style="color:${color};">${yb}</div>
                        ${statRow(p26, MONTHS_ORDER)}
                    </div>`;
            } else {
                const cols = vendas.monthCols.filter(c => c.year === this._ano);
                const vals = cols.map(c => totals[c.key] || 0);
                const lbls = cols.map(c => c.abbr);
                body = statRow(vals, lbls);
            }

            cards.push(`<div class="comp-res-card" style="border-top:3px solid ${color};">
                <div class="comp-res-header">
                    <span class="comp-slot-badge" style="background:${color}20;color:${color};">${label}</span>
                    <span class="comp-res-name" title="${name}">${name}</span>
                </div>
                ${body}
            </div>`);
        });

        el.innerHTML = cards.join('');
    },

    _drawChart() {
        const canvas = document.getElementById('comp-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width  = canvas.offsetWidth || 800;
        const H = canvas.height = 320;
        ctx.clearRect(0, 0, W, H);

        const padL = 62, padR = 24, padT = 28, padB = 44;
        const chartW = W - padL - padR;
        const chartH = H - padT - padB;

        const MONTHS_ORDER = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

        // Determine X axis labels and point extractor
        let xLabels, getPoints;
        if (this._ano === 'ambos') {
            xLabels = MONTHS_ORDER;
            getPoints = (totals, year) => MONTHS_ORDER.map(abbr => {
                return vendas.monthCols
                    .filter(c => c.abbr === abbr && c.year === year)
                    .reduce((s, c) => s + (totals[c.key] || 0), 0);
            });
        } else {
            const cols = vendas.monthCols.filter(c => c.year === this._ano);
            xLabels = cols.map(c => c.abbr);
            getPoints = (totals) => cols.map(c => totals[c.key] || 0);
        }

        const n = xLabels.length;
        if (!n) return;

        // Build series [{color, pts, dashed, idx}]
        const series = [];
        [0,1,2,3,4].forEach(i => {
            const totals = this._getSeries(i);
            if (!totals) return;
            if (this._ano === 'ambos') {
                const [ya, yb] = this._dois();  // B3: dois anos mais recentes (sólido=antigo, tracejado=recente)
                const p25 = getPoints(totals, ya);
                const p26 = getPoints(totals, yb);
                if (p25.some(v => v > 0)) series.push({ color: this._colors[i], pts: p25, dashed: false, idx: i });
                if (p26.some(v => v > 0)) series.push({ color: this._colors[i], pts: p26, dashed: true,  idx: i });
            } else {
                const pts = getPoints(totals);
                if (pts.some(v => v > 0)) series.push({ color: this._colors[i], pts, dashed: false, idx: i });
            }
        });

        const maxVal = series.length ? Math.max(...series.flatMap(s => s.pts), 1) : 1;

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        [0, 0.25, 0.5, 0.75, 1].forEach(p => {
            const y = padT + chartH * (1 - p);
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
            ctx.fillStyle = '#c9d1d9'; ctx.font = 'bold 13px Inter'; ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxVal * p).toLocaleString('pt-BR'), padL - 6, y + 4);
        });

        // X labels
        ctx.fillStyle = '#c9d1d9'; ctx.font = 'bold 13px Inter'; ctx.textAlign = 'center';
        xLabels.forEach((lbl, i) => {
            const x = n === 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW;
            ctx.fillText(lbl, x, H - padB + 16);
        });

        if (!series.length) {
            ctx.fillStyle = '#8b949e'; ctx.font = '13px Inter'; ctx.textAlign = 'center';
            ctx.fillText('Preencha ao menos um slot para ver o gráfico', W / 2, H / 2);
            return;
        }

        // Draw lines + dots
        series.forEach(s => {
            ctx.beginPath();
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.dashed ? 2 : 2.5;
            ctx.setLineDash(s.dashed ? [7, 4] : []);
            s.pts.forEach((v, i) => {
                const x = n === 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW;
                const y = padT + chartH * (1 - v / maxVal);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.setLineDash([]);

            s.pts.forEach((v, i) => {
                const x = n === 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW;
                const y = padT + chartH * (1 - v / maxVal);
                ctx.beginPath();
                ctx.arc(x, y, s.dashed ? 3 : 4.5, 0, Math.PI * 2);
                ctx.fillStyle = s.color;
                ctx.fill();
                if (v > 0) {
                    const label = v.toLocaleString('pt-BR');
                    ctx.font = 'bold 12px Inter';
                    ctx.textAlign = 'center';
                    ctx.strokeStyle = 'rgba(13,17,23,0.85)';
                    ctx.lineWidth = 3;
                    ctx.lineJoin = 'round';
                    ctx.strokeText(label, x, y - 10);
                    ctx.fillStyle = s.color;
                    ctx.fillText(label, x, y - 10);
                }
            });

            // Previsão — linha de tendência (regressão linear simples, 2 meses à frente)
            if (!s.dashed && s.pts.length >= 3) {
                const pts = s.pts;
                const m = pts.length;
                let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
                pts.forEach((v, i) => { sumX += i; sumY += v; sumXY += i * v; sumX2 += i * i; });
                const slope = (m * sumXY - sumX * sumY) / (m * sumX2 - sumX * sumX);
                const intercept = (sumY - slope * sumX) / m;
                if (slope > 0) { // só desenha se tendência é de alta
                    const prevPts = [m - 1, m, m + 1].map(i => Math.max(0, Math.round(slope * i + intercept)));
                    ctx.beginPath();
                    ctx.setLineDash([5, 5]);
                    ctx.strokeStyle = s.color + '88';
                    ctx.lineWidth = 1.5;
                    prevPts.forEach((v, i) => {
                        const xi = m - 1 + i;
                        const xp = n === 1 ? padL + chartW / 2 : padL + (xi / (n - 1)) * chartW;
                        const yp = padT + chartH * (1 - Math.min(v, maxVal) / maxVal);
                        i === 0 ? ctx.moveTo(xp, yp) : ctx.lineTo(xp, yp);
                    });
                    ctx.stroke();
                    ctx.setLineDash([]);
                    // Label de previsão
                    const lastX = padL + ((m + 1) / (n - 1)) * chartW;
                    const lastY = padT + chartH * (1 - Math.min(prevPts[2], maxVal) / maxVal);
                    if (lastX <= W - padR + 20) {
                        ctx.font = 'bold 10px Inter'; ctx.textAlign = 'left';
                        ctx.fillStyle = s.color + 'aa';
                        ctx.fillText('▸ ' + prevPts[2].toLocaleString('pt-BR'), lastX + 4, lastY + 4);
                    }
                }
            }
        });
    },

    _updateLegenda() {
        const el = document.getElementById('comp-legenda');
        if (!el) return;
        const items = [];
        [0,1,2,3,4].forEach(i => {
            const slot = this._slots[i];
            if (!slot.codigos.length && !slot.marca) return;
            const color = this._colors[i];
            const codPart = slot.codigos.length > 0
                ? slot.codigos.slice(0,3).join(', ') + (slot.codigos.length > 3 ? ` +${slot.codigos.length - 3}` : '')
                : '';
            const name = [codPart, slot.marca].filter(Boolean).join(' · ') || '—';
            items.push(`<span class="comp-leg-item">
                <span class="comp-leg-line" style="background:${color};"></span>
                <span class="comp-leg-badge" style="background:${color}20;color:${color};">${this._labels[i]}</span>
                <span class="comp-leg-name">${name}</span>
                ${this._ano === 'ambos' ? `<span class="comp-leg-dash" style="border-color:${color};"></span><span class="comp-leg-year">${this._dois()[1]}</span>` : ''}
            </span>`);
        });
        el.innerHTML = items.length
            ? items.join('')
            : '<span style="color:#8b949e;font-size:0.82rem;">Nenhuma série configurada</span>';
        if (this._ano === 'ambos' && items.length) {
            el.innerHTML += `<div style="margin-top:8px;font-size:0.75rem;color:#8b949e;width:100%;">
                ─── sólido = ${this._dois()[0]} &nbsp;·&nbsp; - - - tracejado = ${this._dois()[1]}
            </div>`;
        }
    }
};

// ══════════════════════════════════════════════════════════════
// MES — MANUFACTURING EXECUTION SYSTEM
// ══════════════════════════════════════════════════════════════
const mes = {
    _aba: 'apt',
    _wip: [],
    _processos: [],
    _timerIds: {},
    _modalAptId: null,

    // Fase 6: tela legada de apontamento APOSENTADA. A fábrica aponta no MES Malha Forte (mes.html),
    // que é offline-first e alimenta WIP/OEE/realizado. Esta tela virou um ponteiro — não faz mais
    // chamadas a /api/mes/*. Métodos legados abaixo ficam inertes (sem gatilho de UI).
    async init() {
        const tabbar = document.getElementById('mes-tab-apt')?.parentElement;
        if (tabbar) tabbar.style.display = 'none';
        ['wip','oee'].forEach(p => { const el = document.getElementById(`mes-pane-${p}`); if (el) el.style.display = 'none'; });
        const apt = document.getElementById('mes-pane-apt');
        if (apt) apt.style.display = 'block';
        const el = document.getElementById('mes-apt-content');
        if (!el) return;
        el.style.textAlign = 'left';
        el.innerHTML = `<div style="max-width:640px;margin:36px auto;text-align:center;">
            <div style="font-size:2.4rem;margin-bottom:10px;">🧵</div>
            <h2 style="color:#fff;font-size:1.15rem;margin:0 0 8px;">Movido para o <span style="color:var(--indigo-primary);">MES Malha Forte</span></h2>
            <p style="color:#8b949e;font-size:.9rem;line-height:1.6;margin:0 0 20px;">
                O apontamento de chão, o WIP e o OEE agora vivem no <strong>MES Malha Forte</strong> — offline-first,
                com catálogo de defeitos, NCs, paradas e indicadores em tempo real. Esta tela antiga foi <strong>aposentada</strong>
                e não recebe mais apontamentos.
            </p>
            <a href="mes.html" style="display:inline-block;padding:11px 26px;border-radius:9px;background:var(--indigo-btn);color:#fff;font-size:.9rem;font-weight:700;text-decoration:none;">Abrir MES Malha Forte →</a>
            <div style="margin-top:14px;"><a href="#" onclick="navigateTo('cockpit');return false;" style="color:#26c6da;font-size:.82rem;text-decoration:none;">ou ver o Cockpit integrado no SIGS</a></div>
        </div>`;
    },

    mudarAba(aba) {
        this._aba = aba;
        const tabColors = { apt: 'var(--indigo-primary)', wip: '#26c6da', oee: '#26a69a' };
        ['apt','wip','oee'].forEach(a => {
            const pane = document.getElementById(`mes-pane-${a}`);
            const tab  = document.getElementById(`mes-tab-${a}`);
            if (pane) pane.style.display = a === aba ? 'block' : 'none';
            if (tab) {
                tab.style.color      = a === aba ? tabColors[a] : '#8b949e';
                tab.style.background = a === aba ? '#161B22'    : 'transparent';
                tab.style.borderBottom = a === aba ? `2px solid ${tabColors[a]}` : '1px solid var(--border)';
                tab.style.fontWeight = a === aba ? '600' : '400';
            }
        });
        if (aba === 'apt') return this.renderApontamento();
        if (aba === 'wip') return this.renderWip();
        if (aba === 'oee') return this._initOeeDatas();
    },

    async atualizar() {
        await this.init();  // Fase 6: tela aposentada — apenas re-renderiza o ponteiro
    },

    _fmtElapsed(inicio) {
        if (!inicio) return '—';
        const ms = Date.now() - new Date(inicio).getTime();
        if (ms < 0) return '0:00';
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        return h > 0
            ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
            : `${m}:${String(s).padStart(2,'0')}`;
    },

    _pararTimers() {
        Object.values(this._timerIds).forEach(id => clearInterval(id));
        this._timerIds = {};
    },

    _iniciarTimers() {
        this._pararTimers();
        this._wip.filter(a => a.status === 'em_andamento').forEach(a => {
            const tick = () => {
                const el = document.getElementById(`mes-timer-${a.id}`);
                if (el) el.textContent = this._fmtElapsed(a.inicio);
                else clearInterval(this._timerIds[a.id]);
            };
            this._timerIds[a.id] = setInterval(tick, 1000);
        });
    },

    // ─────────────────────────────────────────────────────────
    // ABA APONTAMENTO
    // ─────────────────────────────────────────────────────────
    async renderApontamento() {
        const el = document.getElementById('mes-apt-content');
        if (!el) return;
        el.innerHTML = '<div style="color:#8b949e;text-align:center;padding:24px;">Carregando...</div>';

        // Carrega WIP e OPs em paralelo
        const [wipData] = await Promise.all([
            api.get('/api/mes/wip'),
            op.rawData.length ? Promise.resolve() : op.carregarHistorico()
        ]);
        this._wip = wipData || [];

        const parados  = this._wip.filter(a => a.status === 'parado');
        const ativos   = this._wip.filter(a => a.status === 'em_andamento');
        const todos    = [...parados, ...ativos];

        let cardsHtml = '';
        todos.forEach(a => {
            const isPaused    = a.status === 'parado';
            const color       = isPaused ? '#ffab76' : '#26c6da';
            const paradaAberta = (a.paradas_mes||[]).find(p => !p.fim);
            const pct = a.qtd_planejada > 0 ? Math.min(100, Math.round((a.qtd_produzida||0) / a.qtd_planejada * 100)) : null;

            cardsHtml += `
            <div style="background:rgba(255,255,255,.04);border:1px solid ${isPaused?'rgba(255,171,118,.3)':'rgba(38,198,218,.18)'};border-left:3px solid ${color};border-radius:10px;padding:14px 16px;margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:200px;">
                        <span style="font-size:.67rem;font-weight:700;color:${color};letter-spacing:.08em;">${isPaused?'⏸ PAUSADO':'● EM ANDAMENTO'}</span>
                        <div style="font-size:1.05rem;font-weight:700;color:#fff;margin:3px 0 1px;">${escHTML(a.cod)}${a.descricao?` <span style="font-weight:400;color:#8b949e;font-size:.85rem;">— ${escHTML(a.descricao)}</span>`:''}</div>
                        <div style="font-size:.76rem;color:#8b949e;">${escHTML(a.processo)}${a.operador?' · '+escHTML(a.operador):''}${a.turno?' · '+escHTML(a.turno)+'º turno':''}${a.maquina?' · Máq. '+escHTML(a.maquina):''}${a.op_numero?' · <b style="color:#ccc;">OP '+escHTML(a.op_numero)+'</b>':''}</div>
                        ${paradaAberta?`<div style="margin-top:5px;font-size:.72rem;color:#ffab76;background:rgba(255,171,118,.08);padding:3px 8px;border-radius:4px;display:inline-block;">⏸ ${escHTML(paradaAberta.tipo.replace(/_/g,' '))} — ${escHTML(paradaAberta.motivo)}</div>`:''}
                        ${pct!==null?`<div style="margin-top:8px;"><div style="display:flex;justify-content:space-between;font-size:.68rem;color:#8b949e;margin-bottom:3px;"><span>Progresso</span><span>${a.qtd_produzida||0} / ${a.qtd_planejada} (${pct}%)</span></div><div style="height:5px;background:rgba(255,255,255,.07);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${color};border-radius:3px;"></div></div></div>`:''}
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1.5rem;font-weight:700;color:${color};font-variant-numeric:tabular-nums;min-width:80px;" id="mes-timer-${escHTML(a.id)}">${this._fmtElapsed(a.inicio)}</div>
                        <div style="font-size:.65rem;color:#8b949e;">decorrido</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap;">
                    <label style="font-size:.7rem;color:#8b949e;">Produzido</label>
                    <input type="number" min="0" id="mes-prod-${escHTML(a.id)}" value="${a.qtd_produzida||0}"
                        style="width:68px;padding:5px 8px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.85rem;text-align:center;">
                    <label style="font-size:.7rem;color:#8b949e;">Refugo</label>
                    <input type="number" min="0" id="mes-ref-${escHTML(a.id)}" value="${a.qtd_refugo||0}"
                        style="width:58px;padding:5px 8px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.85rem;text-align:center;">
                    ${isPaused && paradaAberta
                        ? `<button onclick="mes.finalizarParada('${escHTML(paradaAberta.id)}','${escHTML(a.id)}')" style="padding:5px 14px;border-radius:6px;border:none;background:#26a69a;color:#fff;font-size:.75rem;font-weight:700;cursor:pointer;">▶ Retomar</button>`
                        : `<button onclick="mes._abrirModalParada('${escHTML(a.id)}')" style="padding:5px 14px;border-radius:6px;border:1px solid rgba(255,171,118,.4);background:rgba(255,171,118,.08);color:#ffab76;font-size:.75rem;font-weight:700;cursor:pointer;">⏸ Pausar</button>`
                    }
                    <button onclick="mes.finalizarApontamento('${escHTML(a.id)}')" style="padding:5px 16px;border-radius:6px;border:none;background:#26c6da;color:#0D1117;font-size:.75rem;font-weight:700;cursor:pointer;margin-left:auto;">✓ Finalizar</button>
                    <button onclick="mes._excluirApontamento('${escHTML(a.id)}')" title="Excluir apontamento" style="padding:5px 9px;border-radius:6px;border:1px solid rgba(240,98,146,.3);background:transparent;color:#f06292;font-size:.72rem;cursor:pointer;">✕</button>
                </div>
            </div>`;
        });

        if (!todos.length) {
            cardsHtml = '<div style="color:#8b949e;font-size:.85rem;padding:12px 0 4px;">Nenhuma OP em andamento agora.</div>';
        }

        // ── OPs importadas aguardando apontamento ──────────────
        const opsPendentes = this._getOpsPendentes();
        const opsFiltradas = this._opsFiltro
            ? opsPendentes.filter(r => {
                const q = this._opsFiltro.toLowerCase();
                return (r.nop||'').toLowerCase().includes(q) || (r.cod||'').toLowerCase().includes(q) || (r.desc||'').toLowerCase().includes(q);
              })
            : opsPendentes;

        const statusConcluido = v => /conclu|cancelad|encerrad|finaliz/i.test(String(v));
        const opsAtivas = opsFiltradas.filter(r => !statusConcluido(r.status));

        // NOPs já em andamento no WIP
        const wipNops = new Set(this._wip.map(a => String(a.op_numero||'').trim()).filter(Boolean));

        let opsPendHtml = '';
        if (op.rawData.length) {
            const countTotal = opsPendentes.filter(r => !statusConcluido(r.status)).length;
            const collapsed = this._opsCollapsed !== false;
            opsPendHtml = `
            <div style="background:rgba(255,255,255,.025);border:1px solid rgba(38,198,218,.2);border-radius:12px;margin-bottom:16px;overflow:hidden;">
                <div onclick="mes._toggleOpsList()" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;user-select:none;background:rgba(38,198,218,.05);">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:.8rem;font-weight:700;color:#26c6da;letter-spacing:.06em;">OPs IMPORTADAS — Aguardando Apontamento</span>
                        <span style="background:#26c6da22;color:#26c6da;font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:12px;">${countTotal}</span>
                    </div>
                    <span style="color:#8b949e;font-size:.75rem;">${collapsed?'▾ Expandir':'▴ Recolher'}</span>
                </div>
                <div id="mes-ops-lista" style="display:${collapsed?'none':'block'};">
                    <div style="padding:10px 14px 8px;border-bottom:1px solid rgba(255,255,255,.06);">
                        <input id="mes-ops-busca" type="text" placeholder="Buscar por código, OP ou descrição..."
                            value="${escHTML(this._opsFiltro||'')}"
                            oninput="mes._filtrarOps(this.value)"
                            style="width:100%;max-width:380px;padding:7px 10px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.8rem;box-sizing:border-box;">
                    </div>
                    <div style="overflow-x:auto;max-height:320px;overflow-y:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:.77rem;">
                        <thead style="position:sticky;top:0;z-index:1;"><tr style="color:#8b949e;font-size:.64rem;letter-spacing:.06em;border-bottom:1px solid var(--border);background:#161B22;">
                            <th style="text-align:left;padding:7px 10px;white-space:nowrap;">N. OP</th>
                            <th style="text-align:left;padding:7px 10px;">CÓDIGO</th>
                            <th style="text-align:left;padding:7px 10px;">DESCRIÇÃO</th>
                            <th style="text-align:right;padding:7px 10px;">QTD</th>
                            <th style="text-align:left;padding:7px 10px;">STATUS</th>
                            <th style="text-align:left;padding:7px 10px;">EMISSÃO</th>
                            <th style="text-align:left;padding:7px 10px;">PREVISÃO</th>
                            <th style="padding:7px 10px;"></th>
                        </tr></thead>
                        <tbody>
                        ${opsAtivas.length ? opsAtivas.slice(0, 200).map(r => {
                            const emAndamento = wipNops.has(String(r.nop||'').trim()) && r.nop;
                            const rowBg = emAndamento ? 'background:rgba(38,198,218,.05);' : '';
                            const qtdFmt = r.qtd > 0 ? r.qtd.toLocaleString('pt-BR') : '—';
                            const stColor = /liberado|aberto|aberta|produzin/i.test(r.status) ? '#26c6da'
                                          : /atraso|urgent/i.test(r.status) ? '#f06292' : '#8b949e';
                            return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);${rowBg}">
                                <td style="padding:7px 10px;color:#26c6da;font-family:monospace;font-weight:700;white-space:nowrap;">${escHTML(r.nop||'—')}</td>
                                <td style="padding:7px 10px;font-weight:700;color:#fff;white-space:nowrap;">${escHTML(r.cod||'—')}</td>
                                <td style="padding:7px 10px;color:#ccc;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHTML(r.desc||'')}">${escHTML(r.desc||'—')}</td>
                                <td style="padding:7px 10px;text-align:right;color:#26a69a;font-weight:600;">${qtdFmt}</td>
                                <td style="padding:7px 10px;"><span style="font-size:.65rem;font-weight:700;color:${stColor};padding:2px 7px;border-radius:4px;background:${stColor}22;">${escHTML(r.status||'—')}</span></td>
                                <td style="padding:7px 10px;color:#8b949e;white-space:nowrap;">${escHTML(r.emissao||'—')}</td>
                                <td style="padding:7px 10px;color:#8b949e;white-space:nowrap;">${escHTML(r.previsao||'—')}</td>
                                <td style="padding:7px 10px;">
                                    <button onclick="mes.preencherFormOP('${escHTML(String(r.nop||'')).replace(/'/g,"\\'")}','${escHTML(String(r.cod||'')).replace(/'/g,"\\'")}',${Number(r.qtd)||0})"
                                        style="padding:4px 12px;border-radius:6px;border:none;background:var(--indigo-btn,#5c6bc0);color:#fff;font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap;">
                                        → Apontar
                                    </button>
                                </td>
                            </tr>`;
                        }).join('') : `<tr><td colspan="8" style="padding:20px;text-align:center;color:#8b949e;">Nenhuma OP encontrada${this._opsFiltro?' para "'+escHTML(this._opsFiltro)+'"':''}.</td></tr>`}
                        </tbody>
                    </table>
                    </div>
                    ${opsAtivas.length > 200 ? `<div style="padding:8px 14px;font-size:.72rem;color:#8b949e;border-top:1px solid rgba(255,255,255,.06);">Mostrando 200 de ${opsAtivas.length} — use a busca para filtrar.</div>` : ''}
                </div>
            </div>`;
        }

        const procOptions = this._processos.map(p => `<option value="${escHTML(p.nome)}">${escHTML(p.nome)}</option>`).join('');

        el.innerHTML = `
        ${cardsHtml}
        ${opsPendHtml}
        <div style="background:rgba(255,255,255,.025);border:1px solid var(--border);border-radius:12px;padding:20px;margin-top:8px;">
            <h3 style="margin:0 0 14px;font-size:.82rem;font-weight:700;color:#fff;letter-spacing:.06em;">+ INICIAR NOVO APONTAMENTO</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:14px;">
                <div>
                    <label style="font-size:.68rem;color:#8b949e;display:block;margin-bottom:4px;">CÓDIGO *</label>
                    <input id="mes-apt-cod" type="text" placeholder="ex: ABC123"
                        style="width:100%;padding:8px 10px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.85rem;box-sizing:border-box;text-transform:uppercase;">
                </div>
                <div>
                    <label style="font-size:.68rem;color:#8b949e;display:block;margin-bottom:4px;">PROCESSO *</label>
                    <select id="mes-apt-processo" style="width:100%;padding:8px 10px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.85rem;box-sizing:border-box;">
                        <option value="">— selecione —</option>
                        ${procOptions}
                    </select>
                </div>
                <div>
                    <label style="font-size:.68rem;color:#8b949e;display:block;margin-bottom:4px;">Nº OP</label>
                    <input id="mes-apt-op" type="text" placeholder="opcional"
                        style="width:100%;padding:8px 10px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.85rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:.68rem;color:#8b949e;display:block;margin-bottom:4px;">OPERADOR</label>
                    <input id="mes-apt-operador" type="text" placeholder="Nome"
                        style="width:100%;padding:8px 10px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.85rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:.68rem;color:#8b949e;display:block;margin-bottom:4px;">TURNO</label>
                    <select id="mes-apt-turno" style="width:100%;padding:8px 10px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.85rem;box-sizing:border-box;">
                        <option value="">—</option>
                        <option value="1">1º Turno</option>
                        <option value="2">2º Turno</option>
                        <option value="3">3º Turno</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:.68rem;color:#8b949e;display:block;margin-bottom:4px;">MÁQUINA</label>
                    <input id="mes-apt-maquina" type="text" placeholder="ID ou nome"
                        style="width:100%;padding:8px 10px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.85rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:.68rem;color:#8b949e;display:block;margin-bottom:4px;">QTDE PLANEJADA</label>
                    <input id="mes-apt-planejado" type="number" min="0" placeholder="0"
                        style="width:100%;padding:8px 10px;background:#0D1117;border:1px solid var(--border);border-radius:6px;color:#fff;font-size:.85rem;box-sizing:border-box;">
                </div>
            </div>
            <button onclick="mes.iniciarApontamento()"
                style="padding:10px 28px;border-radius:8px;border:none;background:var(--indigo-btn,#5c6bc0);color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;">
                ▶ Iniciar Apontamento
            </button>
        </div>`;

        this._iniciarTimers();
    },

    _opsCollapsed: true,
    _opsFiltro: '',

    _getOpsPendentes() {
        if (!op.rawData.length) return [];
        const colNop  = op._colOP;
        const colCod  = op._colRef;
        const colDesc = op._colDesc;
        const colQtd  = op._colQtd;
        const colSt   = op._colStatus;
        const colEm   = op._colEmissao;
        const colPf   = op.colunas.find(c => /previs|prev.*final|entrega/i.test(c)) || null;

        return op.rawData.map(r => {
            const d = r.dados || {};
            const qtdRaw = colQtd ? String(d[colQtd]||'0').replace(/[^\d,.\-]/g,'').replace(',','.') : '0';
            return {
                nop:      colNop  ? String(d[colNop]||'').trim()  : '',
                cod:      colCod  ? String(d[colCod]||'').trim().toUpperCase()  : '',
                desc:     colDesc ? String(d[colDesc]||'').trim() : '',
                qtd:      parseFloat(qtdRaw)||0,
                status:   colSt   ? String(d[colSt]||'').trim()  : '',
                emissao:  colEm   ? String(d[colEm]||'').trim()  : '',
                previsao: colPf   ? String(d[colPf]||'').trim()  : '',
            };
        }).filter(r => r.cod || r.nop);
    },

    _toggleOpsList() {
        this._opsCollapsed = !this._opsCollapsed;
        const el = document.getElementById('mes-ops-lista');
        if (el) el.style.display = this._opsCollapsed ? 'none' : 'block';
        // Update label
        const btn = el?.previousElementSibling?.querySelector('span:last-child');
        if (btn) btn.textContent = this._opsCollapsed ? '▾ Expandir' : '▴ Recolher';
    },

    _filtrarOps(val) {
        this._opsFiltro = val;
        // Re-render only the table body to avoid full re-render
        const tbody = document.querySelector('#mes-ops-lista tbody');
        if (!tbody) return;
        const opsPendentes = this._getOpsPendentes().filter(r => !/conclu|cancelad|encerrad|finaliz/i.test(String(r.status)));
        const wipNops = new Set(this._wip.map(a => String(a.op_numero||'').trim()).filter(Boolean));
        const q = val.toLowerCase();
        const filtered = q ? opsPendentes.filter(r =>
            (r.nop||'').toLowerCase().includes(q) || (r.cod||'').toLowerCase().includes(q) || (r.desc||'').toLowerCase().includes(q)
        ) : opsPendentes;

        tbody.innerHTML = filtered.length ? filtered.slice(0,200).map(r => {
            const emAndamento = wipNops.has(String(r.nop||'').trim()) && r.nop;
            const rowBg = emAndamento ? 'background:rgba(38,198,218,.05);' : '';
            const qtdFmt = r.qtd > 0 ? r.qtd.toLocaleString('pt-BR') : '—';
            const stColor = /liberado|aberto|aberta|produzin/i.test(r.status) ? '#26c6da'
                          : /atraso|urgent/i.test(r.status) ? '#f06292' : '#8b949e';
            return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);${rowBg}">
                <td style="padding:7px 10px;color:#26c6da;font-family:monospace;font-weight:700;white-space:nowrap;">${escHTML(r.nop||'—')}</td>
                <td style="padding:7px 10px;font-weight:700;color:#fff;white-space:nowrap;">${escHTML(r.cod||'—')}</td>
                <td style="padding:7px 10px;color:#ccc;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHTML(r.desc||'')}">${escHTML(r.desc||'')}</td>
                <td style="padding:7px 10px;text-align:right;color:#26a69a;font-weight:600;">${qtdFmt}</td>
                <td style="padding:7px 10px;"><span style="font-size:.65rem;font-weight:700;color:${stColor};padding:2px 7px;border-radius:4px;background:${stColor}22;">${escHTML(r.status||'—')}</span></td>
                <td style="padding:7px 10px;color:#8b949e;white-space:nowrap;">${escHTML(r.emissao||'—')}</td>
                <td style="padding:7px 10px;color:#8b949e;white-space:nowrap;">${escHTML(r.previsao||'—')}</td>
                <td style="padding:7px 10px;">
                    <button onclick="mes.preencherFormOP('${escHTML(String(r.nop||'')).replace(/'/g,"\\'")}','${escHTML(String(r.cod||'')).replace(/'/g,"\\'")}',${Number(r.qtd)||0})"
                        style="padding:4px 12px;border-radius:6px;border:none;background:var(--indigo-btn,#5c6bc0);color:#fff;font-size:.72rem;font-weight:700;cursor:pointer;">
                        → Apontar
                    </button>
                </td>
            </tr>`;
        }).join('') : `<tr><td colspan="8" style="padding:20px;text-align:center;color:#8b949e;">Nenhuma OP encontrada${q?' para "'+escHTML(q)+'"':''}.</td></tr>`;
    },

    preencherFormOP(nop, cod, qtd) {
        const codEl  = document.getElementById('mes-apt-cod');
        const opEl   = document.getElementById('mes-apt-op');
        const qtdEl  = document.getElementById('mes-apt-planejado');
        const procEl = document.getElementById('mes-apt-processo');
        if (codEl)  { codEl.value  = cod;  codEl.style.borderColor = '#26c6da'; setTimeout(()=>codEl.style.borderColor='',1500); }
        if (opEl)   opEl.value  = nop;
        if (qtdEl && qtd)  qtdEl.value  = Math.round(qtd);
        // Scroll to form and focus processo
        const form = procEl?.closest('div[style*="border-radius:12px"]');
        form?.scrollIntoView({ behavior:'smooth', block:'center' });
        setTimeout(() => procEl?.focus(), 400);
        mostrarToast(`OP ${nop||cod} carregada — selecione o processo e inicie`, 'sucesso');
    },

    _abrirModalParada(aptId) {
        this._modalAptId = aptId;
        const m = document.getElementById('mes-parada-motivo');
        if (m) m.value = '';
        const modal = document.getElementById('mes-modal-parada');
        if (modal) { modal.style.display = 'flex'; setTimeout(()=>m?.focus(),100); }
    },

    async confirmarParada() {
        const motivo = document.getElementById('mes-parada-motivo')?.value.trim();
        const tipo   = document.getElementById('mes-parada-tipo')?.value;
        if (!motivo) { mostrarToast('Informe o motivo da parada', 'erro'); return; }
        document.getElementById('mes-modal-parada').style.display = 'none';
        const r = await api.post('/api/mes/paradas', { apontamento_id: this._modalAptId, tipo, motivo });
        if (r?.ok) { mostrarToast('Parada registrada', 'aviso'); this.renderApontamento(); }
    },

    async finalizarParada(paradaId, aptId) {
        const r = await api.put(`/api/mes/paradas/${paradaId}`, {});
        if (r?.ok) {
            // Salvar qtd atual antes de recarregar
            const qProd = parseInt(document.getElementById(`mes-prod-${aptId}`)?.value)||0;
            const qRef  = parseInt(document.getElementById(`mes-ref-${aptId}`)?.value)||0;
            await api.put(`/api/mes/apontamentos/${aptId}`, { qtd_produzida:qProd, qtd_refugo:qRef });
            mostrarToast('Produção retomada', 'sucesso');
            this.renderApontamento();
        }
    },

    async iniciarApontamento() {
        const cod      = (document.getElementById('mes-apt-cod')?.value||'').trim().toUpperCase();
        const processo = document.getElementById('mes-apt-processo')?.value;
        const op       = (document.getElementById('mes-apt-op')?.value||'').trim();
        const operador = (document.getElementById('mes-apt-operador')?.value||'').trim();
        const turno    = document.getElementById('mes-apt-turno')?.value;
        const maquina  = (document.getElementById('mes-apt-maquina')?.value||'').trim();
        const qtd_plan = parseInt(document.getElementById('mes-apt-planejado')?.value)||0;
        if (!cod)     { mostrarToast('Informe o código do produto', 'erro'); return; }
        if (!processo){ mostrarToast('Selecione o processo', 'erro'); return; }
        const r = await api.post('/api/mes/apontamentos', { op_numero:op||null, cod, processo, operador:operador||null, turno:turno||null, maquina:maquina||null, qtd_planejada:qtd_plan });
        if (r?.ok) { mostrarToast('Apontamento iniciado', 'sucesso'); this.renderApontamento(); }
    },

    async finalizarApontamento(id) {
        const qProd = parseInt(document.getElementById(`mes-prod-${id}`)?.value)||0;
        const qRef  = parseInt(document.getElementById(`mes-ref-${id}`)?.value)||0;
        if (!confirm(`Finalizar apontamento?\n\nProduzido: ${qProd} pç\nRefugo: ${qRef} pç`)) return;
        const r = await api.put(`/api/mes/apontamentos/${id}`, { status:'finalizado', qtd_produzida:qProd, qtd_refugo:qRef });
        if (r?.ok) { mostrarToast('Apontamento finalizado', 'sucesso'); this.renderApontamento(); }
    },

    async _excluirApontamento(id) {
        if (!confirm('Excluir este apontamento?')) return;
        const r = await api.delete(`/api/mes/apontamentos/${id}`);
        if (r?.ok) { mostrarToast('Excluído', 'sucesso'); this.renderApontamento(); }
    },

    // ─────────────────────────────────────────────────────────
    // ABA WIP
    // ─────────────────────────────────────────────────────────
    async renderWip() {
        const el = document.getElementById('mes-wip-content');
        if (!el) return;
        el.innerHTML = '<div style="color:#8b949e;text-align:center;padding:24px;">Carregando...</div>';
        const data = await api.get('/api/mes/wip');
        this._wip = data || [];

        if (!this._wip.length) {
            el.innerHTML = '<div style="color:#8b949e;text-align:center;padding:60px;font-size:.9rem;">Nenhuma OP em andamento no momento.</div>';
            return;
        }

        const byProc = {};
        this._wip.forEach(a => { (byProc[a.processo] = byProc[a.processo]||[]).push(a); });

        const total     = this._wip.length;
        const paradas   = this._wip.filter(a=>a.status==='parado').length;
        const procs     = Object.keys(byProc).length;
        const totalProd = this._wip.reduce((s,a)=>s+(a.qtd_produzida||0),0);

        let html = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px;">
            <div class="summary-card" style="border-top:3px solid #26c6da;"><span class="s-label">EM ANDAMENTO</span><span class="s-value" style="color:#26c6da;">${total}</span><span class="s-sub">apontamentos ativos</span></div>
            <div class="summary-card" style="border-top:3px solid #ffab76;"><span class="s-label">PAUSADOS</span><span class="s-value" style="color:#ffab76;">${paradas}</span><span class="s-sub">aguardando retorno</span></div>
            <div class="summary-card" style="border-top:3px solid #7c4dff;"><span class="s-label">PROCESSOS</span><span class="s-value" style="color:#7c4dff;">${procs}</span><span class="s-sub">em operação</span></div>
            <div class="summary-card" style="border-top:3px solid #26a69a;"><span class="s-label">PRODUZIDO</span><span class="s-value" style="color:#26a69a;">${totalProd.toLocaleString('pt-BR')}</span><span class="s-sub">peças (acumulado hoje)</span></div>
        </div>`;

        Object.entries(byProc).forEach(([proc, aps]) => {
            html += `
            <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px;">
                <h3 style="margin:0 0 12px;font-size:.8rem;font-weight:700;color:#26c6da;letter-spacing:.07em;">${escHTML(proc)} <span style="font-weight:400;color:#8b949e;">(${aps.length})</span></h3>
                <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:.78rem;">
                    <thead><tr style="color:#8b949e;font-size:.66rem;letter-spacing:.06em;border-bottom:1px solid var(--border);">
                        <th style="text-align:left;padding:5px 8px;">STATUS</th>
                        <th style="text-align:left;padding:5px 8px;">OP / CÓDIGO</th>
                        <th style="text-align:left;padding:5px 8px;">OPERADOR</th>
                        <th style="text-align:center;padding:5px 8px;">TURNO</th>
                        <th style="text-align:right;padding:5px 8px;">TEMPO</th>
                        <th style="text-align:right;padding:5px 8px;">PROD.</th>
                        <th style="text-align:right;padding:5px 8px;">REFUGO</th>
                        <th style="text-align:right;padding:5px 8px;">PROGRESSO</th>
                    </tr></thead>
                    <tbody>
                    ${aps.map(a => {
                        const isPaused = a.status === 'parado';
                        const color = isPaused ? '#ffab76' : '#26c6da';
                        const pct = a.qtd_planejada>0 ? Math.min(100,Math.round((a.qtd_produzida||0)/a.qtd_planejada*100)) : null;
                        return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                            <td style="padding:7px 8px;">
                                <span style="font-size:.63rem;font-weight:700;color:${color};padding:2px 7px;border-radius:4px;background:${color}22;">${isPaused?'PARADO':'ATIVO'}</span>
                            </td>
                            <td style="padding:7px 8px;">
                                <b style="color:#fff;">${escHTML(a.cod)}</b>
                                ${a.op_numero?`<span style="color:#8b949e;font-size:.72rem;margin-left:6px;">OP ${escHTML(a.op_numero)}</span>`:''}
                            </td>
                            <td style="padding:7px 8px;color:#8b949e;">${escHTML(a.operador||'—')}</td>
                            <td style="padding:7px 8px;text-align:center;color:#8b949e;">${a.turno?a.turno+'º':'—'}</td>
                            <td style="padding:7px 8px;text-align:right;font-variant-numeric:tabular-nums;color:${color};">${this._fmtElapsed(a.inicio)}</td>
                            <td style="padding:7px 8px;text-align:right;color:#3fb950;font-weight:600;">${(a.qtd_produzida||0).toLocaleString('pt-BR')}</td>
                            <td style="padding:7px 8px;text-align:right;color:${(a.qtd_refugo||0)>0?'#f06292':'#8b949e'}">${(a.qtd_refugo||0).toLocaleString('pt-BR')}</td>
                            <td style="padding:7px 8px;text-align:right;min-width:90px;">
                                ${pct!==null
                                    ?`<div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
                                        <span style="font-size:.7rem;color:#8b949e;">${pct}%</span>
                                        <div style="width:60px;height:5px;background:rgba(255,255,255,.07);border-radius:3px;overflow:hidden;">
                                            <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;"></div>
                                        </div>
                                      </div>`
                                    :'<span style="color:#8b949e;font-size:.7rem;">—</span>'}
                            </td>
                        </tr>`;
                    }).join('')}
                    </tbody>
                </table>
                </div>
            </div>`;
        });

        el.innerHTML = html;
    },

    // ─────────────────────────────────────────────────────────
    // ABA OEE
    // ─────────────────────────────────────────────────────────
    _initOeeDatas() {
        const hoje = new Date().toISOString().slice(0,10);
        const sete = new Date(Date.now()-7*24*60*60*1000).toISOString().slice(0,10);
        const iniEl = document.getElementById('mes-oee-ini');
        const fimEl = document.getElementById('mes-oee-fim');
        if (iniEl && !iniEl.value) iniEl.value = sete;
        if (fimEl && !fimEl.value) fimEl.value = hoje;
        this.renderOee();
    },

    async renderOee() {
        const el = document.getElementById('mes-oee-content');
        if (!el) return;
        el.innerHTML = '<div style="color:#8b949e;text-align:center;padding:40px;">Calculando OEE...</div>';

        const ini = document.getElementById('mes-oee-ini')?.value || new Date(Date.now()-7*24*60*60*1000).toISOString().slice(0,10);
        const fim = document.getElementById('mes-oee-fim')?.value  || new Date().toISOString().slice(0,10);
        const oee = await api.get(`/api/mes/oee?data_inicio=${ini}&data_fim=${fim}`);
        if (!oee) { el.innerHTML = '<div style="color:#f06292;padding:20px;">Erro ao carregar OEE.</div>'; return; }

        if (!oee.oee && !Object.keys(oee.processos||{}).length && !(oee.motivos||[]).length) {
            el.innerHTML = `
            <div style="background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.12);border-radius:12px;padding:48px;text-align:center;color:#8b949e;">
                <div style="display:flex;justify-content:center;margin-bottom:14px;color:var(--text-dim);"><svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor"><rect x="3" y="24" width="8" height="13" rx="1.2" opacity="0.55"/><rect x="16" y="16" width="8" height="21" rx="1.2" opacity="0.78"/><rect x="29" y="7" width="8" height="30" rx="1.2"/></svg></div>
                <div style="font-size:1rem;color:#ccc;margin-bottom:8px;">Nenhum apontamento finalizado no período selecionado</div>
                <div style="font-size:.82rem;">Registre apontamentos na aba <b style="color:#26c6da;">Apontamento</b> e clique em <b>Finalizar</b> para acumular dados de OEE.</div>
            </div>`;
            return;
        }

        const D = oee.disponibilidade || 0;
        const Q = oee.qualidade || 0;
        const V = oee.oee || 0;

        const _c  = v => v >= 85 ? '#26a69a' : v >= 65 ? '#ffab76' : '#f06292';
        const _bar = (v, c) => `<div style="width:100%;height:8px;background:rgba(255,255,255,.07);border-radius:4px;overflow:hidden;margin-top:8px;"><div style="height:100%;width:${v}%;background:${c};border-radius:4px;transition:width .6s;"></div></div>`;
        const _ref = v => v>=85?'World Class ✓':v>=65?'Em desenvolvimento':'Crítico';

        let html = `
        <div style="display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:14px;margin-bottom:24px;">
            <div class="summary-card" style="border-top:3px solid ${_c(D)};text-align:center;">
                <span class="s-label">DISPONIBILIDADE (D)</span>
                <span class="s-value" style="color:${_c(D)};font-size:2.2rem;">${D}%</span>
                <span class="s-sub">Tempo real / Tempo total</span>
                ${_bar(D,_c(D))}
            </div>
            <div class="summary-card" style="border-top:4px solid ${_c(V)};text-align:center;box-shadow:0 0 20px ${_c(V)}22;">
                <span class="s-label">OEE GLOBAL (D × Q)</span>
                <span class="s-value" style="color:${_c(V)};font-size:2.8rem;font-weight:800;">${V}%</span>
                <span class="s-sub" style="color:${_c(V)};font-weight:600;">${_ref(V)}</span>
                ${_bar(V,_c(V))}
            </div>
            <div class="summary-card" style="border-top:3px solid ${_c(Q)};text-align:center;">
                <span class="s-label">QUALIDADE (Q)</span>
                <span class="s-value" style="color:${_c(Q)};font-size:2.2rem;">${Q}%</span>
                <span class="s-sub">Peças boas / Total</span>
                ${_bar(Q,_c(Q))}
            </div>
        </div>
        <div style="font-size:.72rem;color:#8b949e;margin-bottom:20px;padding:8px 12px;background:rgba(255,255,255,.03);border-radius:6px;border-left:2px solid #5c6bc0;">
            OEE = Disponibilidade × Qualidade. Performance (P) requer tempo de ciclo cadastrado por operação — disponível em versão futura.
        </div>`;

        // Tabela por processo
        if (Object.keys(oee.processos||{}).length) {
            html += `
            <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">
                <h3 style="margin:0 0 12px;font-size:.8rem;font-weight:700;color:#fff;letter-spacing:.06em;">OEE POR PROCESSO</h3>
                <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:.79rem;">
                    <thead><tr style="color:#8b949e;font-size:.66rem;letter-spacing:.06em;border-bottom:1px solid var(--border);">
                        <th style="text-align:left;padding:6px 8px;">PROCESSO</th>
                        <th style="text-align:right;padding:6px 8px;">OPs</th>
                        <th style="text-align:right;padding:6px 8px;">TEMPO (min)</th>
                        <th style="text-align:right;padding:6px 8px;">PARADAS (min)</th>
                        <th style="text-align:right;padding:6px 8px;">DISPON.</th>
                        <th style="text-align:right;padding:6px 8px;">QUALIDADE</th>
                        <th style="text-align:right;padding:6px 8px;">PRODUZIDO</th>
                        <th style="text-align:right;padding:6px 8px;">REFUGO</th>
                    </tr></thead>
                    <tbody>
                    ${Object.entries(oee.processos).map(([proc,p])=>`
                    <tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                        <td style="padding:7px 8px;color:#fff;font-weight:600;">${escHTML(proc)}</td>
                        <td style="padding:7px 8px;text-align:right;color:#8b949e;">${p.count}</td>
                        <td style="padding:7px 8px;text-align:right;color:#8b949e;">${(p.tempo_total||0).toLocaleString('pt-BR')}</td>
                        <td style="padding:7px 8px;text-align:right;color:#ffab76;">${(p.tempo_parada||0).toLocaleString('pt-BR')}</td>
                        <td style="padding:7px 8px;text-align:right;color:${_c(p.D)};font-weight:700;">${p.D}%</td>
                        <td style="padding:7px 8px;text-align:right;color:${_c(p.Q)};font-weight:700;">${p.Q}%</td>
                        <td style="padding:7px 8px;text-align:right;color:#3fb950;font-weight:600;">${(p.qtd_prod||0).toLocaleString('pt-BR')}</td>
                        <td style="padding:7px 8px;text-align:right;color:${(p.qtd_ref||0)>0?'#f06292':'#8b949e'}">${(p.qtd_ref||0).toLocaleString('pt-BR')}</td>
                    </tr>`).join('')}
                    </tbody>
                </table>
                </div>
            </div>`;
        }

        // Pareto de paradas
        if (oee.motivos?.length) {
            const maxMin = oee.motivos[0]?.min || 1;
            html += `
            <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:16px;">
                <h3 style="margin:0 0 14px;font-size:.8rem;font-weight:700;color:#fff;letter-spacing:.06em;">PARETO — MOTIVOS DE PARADA</h3>
                ${oee.motivos.map(m=>`
                <div style="margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:4px;">
                        <span style="color:#ccc;">${escHTML(m.motivo)}</span>
                        <span style="color:#ffab76;font-weight:600;">${m.min} min</span>
                    </div>
                    <div style="height:7px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden;">
                        <div style="height:100%;width:${Math.round((m.min/maxMin)*100)}%;background:#ffab76;border-radius:4px;transition:width .6s;"></div>
                    </div>
                </div>`).join('')}
            </div>`;
        }

        el.innerHTML = html;
    },

    _chipMotivo(btn) {
        document.getElementById('mes-parada-motivo').value = btn.textContent.trim();
        document.querySelectorAll('#mes-motivos-chips button').forEach(b => {
            b.style.background = 'rgba(255,255,255,.04)';
            b.style.color = '#8b949e';
            b.style.borderColor = 'rgba(255,255,255,.1)';
        });
        btn.style.background = 'rgba(255,171,118,.15)';
        btn.style.color = '#ffab76';
        btn.style.borderColor = '#ffab76';
    }
};

// ── REUNIÃO DIÁRIA ────────────────────────────────────────────────
const reuniaoDiaria = {
    _timer: null,
    _countdown: 30,
    _countTimer: null,

    abrir() {
        const el = document.getElementById('modal-reuniao');
        if (!el) return;
        el.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        this.render();
        this._startCountdown();
    },

    fechar() {
        const el = document.getElementById('modal-reuniao');
        if (el) el.style.display = 'none';
        document.body.style.overflow = '';
        clearInterval(this._timer);
        clearInterval(this._countTimer);
        this._timer = null;
    },

    _startCountdown() {
        clearInterval(this._timer);
        clearInterval(this._countTimer);
        this._countdown = 30;
        this._countTimer = setInterval(() => {
            this._countdown--;
            const badge = document.getElementById('rd-refresh-badge');
            if (badge) badge.textContent = `atualiza em ${this._countdown}s`;
            if (this._countdown <= 0) {
                this._countdown = 30;
                this.render();
            }
        }, 1000);
    },

    _fmtHora(d) {
        return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    },

    _cor(v, limites) {
        // limites = [vermelho, amarelo] — acima do amarelo = verde
        if (v >= limites[1]) return '#3fb950';
        if (v >= limites[0]) return '#ffca28';
        return '#f06292';
    },

    async render() {
        // Atualiza relógio
        const dtEl = document.getElementById('rd-datetime');
        const agora = new Date();
        if (dtEl) dtEl.textContent = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) + ' · ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        const body = document.getElementById('rd-body');
        if (!body) return;
        body.innerHTML = '<div style="color:#8b949e;font-size:.85rem;padding:20px 0;">Carregando dados...</div>';

        const hoje = agora.toISOString().slice(0, 10);

        try {
            // Fase 6: fonte ÚNICA do Malha Forte (painel = OEE medido · wip = OPs no fluxo · confirmações = produção do dia)
            const [painel, wipData, conf] = await Promise.all([
                api.get('/api/mf/painel').catch(() => null),
                api.get('/api/mf/wip').catch(() => null),
                api.get('/api/mf/erp/confirmacoes?desde=' + hoje).catch(() => null),  // escopa: só produção de hoje (poll 30s barato)
            ]);

            const board   = Array.isArray(wipData?.board) ? wipData.board : [];
            const wipOps  = board.reduce((s, b) => s + (b.ops || 0), 0);
            const sessoes = painel?.sessoes_abertas || 0;
            const oeeVal  = (painel && painel.oee_medio != null) ? painel.oee_medio : 0;

            // Produção do dia: confirmações cujo último apontamento é hoje
            const doDia   = (conf?.confirmacoes || []).filter(c => String(c.ultima_producao || '').slice(0, 10) === hoje);
            const qtdHoje = doDia.reduce((s, c) => s + (Number(c.qtd_produzida) || 0), 0);
            const refHoje = doDia.reduce((s, c) => s + (Number(c.qtd_refugo) || 0), 0);
            const opsHoje = doDia.length;

            // Gargalo do TOC (in-memory)
            const gargaloProc = toc._resultProcs?.filter(p => !p.semDados)
                .sort((a, b) => (b.util || 0) - (a.util || 0))[0] || null;

            // Alertas (recomputa síncrono)
            const alertas = this._alertas();

            body.innerHTML = this._html({
                wipOps, sessoes, oeeVal, qtdHoje, refHoje, opsHoje, gargaloProc, alertas
            });

        } catch (e) {
            body.innerHTML = `<div style="color:#f06292;padding:20px;">Erro ao carregar dados: ${escHTML(e.message)}</div>`;
        }
    },

    _alertas() {
        const alertas = [];
        if (!vendas.rawData.length)  alertas.push({ tipo: 'info', msg: 'Vendas não importadas', acao: 'vendas' });
        if (!estoque.rawData.length) alertas.push({ tipo: 'info', msg: 'Estoque não importado', acao: 'estoque' });
        if (!op.rawData.length)      alertas.push({ tipo: 'info', msg: 'OPs não importadas', acao: 'op' });

        if (vendas.rawData.length && estoque.rawData.length) {
            const estMap = {};
            estoque.rawData.forEach(r => { estMap[String(r.codigo||'').toUpperCase()] = (estMap[String(r.codigo||'').toUpperCase()]||0)+(r.quantidade||0); });
            let zero = 0;
            vendas.rawData.forEach(r => { if ((estMap[String(r.codigo||'').toUpperCase()]||0) === 0) zero++; });
            if (zero > 0) alertas.push({ tipo: 'critico', msg: `${zero} código(s) com estoque ZERO`, acao: 'vxe' });
        }
        if (politicaEstoque._rows.length) {
            let rev = 0;
            politicaEstoque._rows.forEach(r => { if (r.revenueRisco) rev += r.revenueRisco; });
            const rup = politicaEstoque._rows.filter(r => r.status === 'RUPTURA').length;
            const ris = politicaEstoque._rows.filter(r => r.status === 'RISCO').length;
            if (rev > 0) alertas.push({ tipo: 'critico', msg: `${politicaEstoque._fmtR(rev)} em risco — ${rup} RUPTURA · ${ris} RISCO`, acao: 'politica' });
            else if (rup + ris > 0) alertas.push({ tipo: 'aviso', msg: `${rup + ris} SKU(s) abaixo do estoque ideal`, acao: 'politica' });
        }
        if (toc._resultProcs?.length) {
            const sob = toc._resultProcs.filter(p => !p.semDados && (p.util||0) > 1);
            if (sob.length) {
                const top = sob.sort((a,b)=>b.util-a.util)[0];
                alertas.push({ tipo: 'critico', msg: `Gargalo ${top.nome||top.id}: ${Math.round(top.util*100)}% utilização`, acao: 'toc' });
            }
        }
        return alertas;
    },

    _html({ wipOps, sessoes, oeeVal, qtdHoje, refHoje, opsHoje, gargaloProc, alertas }) {
        const oee = Math.round(oeeVal || 0);
        const corOEE = oee >= 85 ? '#3fb950' : oee >= 65 ? '#ffca28' : '#f06292';

        const gPct  = gargaloProc ? Math.round((gargaloProc.util||0)*100) : null;
        const gNome = gargaloProc ? (gargaloProc.nome || gargaloProc.id) : null;
        const corG  = gPct == null ? '#8b949e' : gPct >= 100 ? '#f06292' : gPct >= 85 ? '#ffca28' : '#3fb950';

        const cores  = { critico: '#f06292', aviso: '#ffca28', info: '#8b949e' };
        const icons  = { critico: DOT.red, aviso: DOT.warn, info: DOT.info };
        const critN  = alertas.filter(a => a.tipo === 'critico').length;

        const card = (content, cor='rgba(255,255,255,.05)', border='rgba(255,255,255,.08)') =>
            `<div style="background:${cor};border:1px solid ${border};border-radius:14px;padding:22px 24px;">${content}</div>`;

        const kpiLabel = t => `<div style="font-size:.7rem;font-weight:700;letter-spacing:1.5px;color:#8b949e;text-transform:uppercase;margin-bottom:6px;">${t}</div>`;
        const kpiVal   = (v, c='#fff', sz='2.8rem') => `<div style="font-size:${sz};font-weight:800;color:${c};line-height:1;">${v}</div>`;
        const kpiSub   = t => `<div style="font-size:.75rem;color:#8b949e;margin-top:6px;">${t}</div>`;

        // ── Row 1: 3 KPIs grandes ──
        const row1 = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">

            ${card(`
                ${kpiLabel('WIP Agora')}
                <div style="display:flex;align-items:baseline;gap:12px;">
                    ${kpiVal(wipOps, wipOps > 0 ? '#26c6da' : '#8b949e')}
                    <div style="font-size:.85rem;color:#8b949e;">OPs no fluxo</div>
                </div>
                ${kpiSub(`<span style="color:${sessoes > 0 ? '#3fb950' : '#8b949e'};">▶ ${sessoes} em apontamento agora</span>`)}
            `, 'rgba(38,198,218,.05)', 'rgba(38,198,218,.15)')}

            ${card(`
                ${kpiLabel('OEE Medido')}
                <div style="display:flex;align-items:baseline;gap:12px;">
                    ${kpiVal(oee > 0 ? oee + '%' : '—', corOEE)}
                    <div style="font-size:.85rem;color:#8b949e;">${oee >= 85 ? 'Classe mundial' : oee >= 65 ? 'Aceitável' : oee > 0 ? 'Atenção' : 'sem dados'}</div>
                </div>
                ${kpiSub(oee > 0 ? 'medido no MES Malha Forte' : 'aguardando apontamento no MES')}
            `, `rgba(${oee >= 85 ? '63,185,80' : oee >= 65 ? '255,202,40' : '240,98,146'},.04)`, `rgba(${oee >= 85 ? '63,185,80' : oee >= 65 ? '255,202,40' : '240,98,146'},.15)`)}

            ${card(`
                ${kpiLabel('Gargalo — TOC')}
                <div style="display:flex;align-items:baseline;gap:12px;">
                    ${kpiVal(gPct != null ? gPct + '%' : '—', corG)}
                    <div style="font-size:.85rem;color:#8b949e;">${gNome || 'rode análise TOC'}</div>
                </div>
                ${kpiSub(gPct == null ? 'Acesse TOC para calcular' : gPct >= 100 ? '<span style="color:#f06292;">⚠ CAPACIDADE ESGOTADA</span>' : gPct >= 85 ? '<span style="color:#ffca28;">Zona de atenção</span>' : '<span style="color:#3fb950;">Capacidade disponível</span>')}
            `, `rgba(${corG === '#f06292' ? '240,98,146' : corG === '#ffca28' ? '255,202,40' : '63,185,80'},.04)`, `rgba(${corG === '#f06292' ? '240,98,146' : corG === '#ffca28' ? '255,202,40' : '63,185,80'},.15)`)}
        </div>`;

        // ── Row 2: KPIs de produção do dia ──
        const row2 = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
            ${card(`${kpiLabel('Produzido Hoje')} ${kpiVal(qtdHoje.toLocaleString('pt-BR'), '#26c6da', '2rem')} ${kpiSub('unidades boas (MES)')}`)}
            ${card(`${kpiLabel('Refugo Hoje')} ${kpiVal(refHoje.toLocaleString('pt-BR'), refHoje > 0 ? '#f06292' : '#3fb950', '2rem')} ${kpiSub(qtdHoje > 0 ? ((refHoje/qtdHoje*100).toFixed(1) + '% do produzido') : '—')}`)}
            ${card(`${kpiLabel('OPs com Produção Hoje')} ${kpiVal(opsHoje, '#a5b4fc', '2rem')} ${kpiSub('OPs que apontaram hoje')}`)}
        </div>`;

        // ── Row 3: Alertas ──
        const alertasHTML = alertas.length === 0
            ? '<p style="color:#3fb950;font-size:.85rem;">✓ Nenhum alerta crítico no momento.</p>'
            : alertas.map(a => `
                <div onclick="reuniaoDiaria.fechar();navigateTo('${a.acao}')" style="display:flex;align-items:center;gap:12px;padding:11px 14px;background:rgba(255,255,255,.03);border-radius:8px;cursor:pointer;border-left:3px solid ${cores[a.tipo]};transition:background .15s;" onmouseenter="this.style.background='rgba(255,255,255,.06)'" onmouseleave="this.style.background='rgba(255,255,255,.03)'">
                    <span style="font-size:1rem;">${icons[a.tipo]}</span>
                    <span style="font-size:.85rem;color:#e6edf3;flex:1;">${escHTML(a.msg)}</span>
                    <span style="font-size:.7rem;color:#8b949e;">→ ${escHTML(a.acao)}</span>
                </div>`).join('');

        const row3 = card(`
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
                <span style="font-size:.7rem;font-weight:700;letter-spacing:1.5px;color:#8b949e;text-transform:uppercase;">Alertas Críticos</span>
                ${critN > 0 ? `<span style="background:#f06292;color:#fff;border-radius:10px;padding:2px 8px;font-size:.68rem;font-weight:700;">${critN}</span>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:7px;">${alertasHTML}</div>
        `);

        // Fase 6: row de "Paradas Ativas" (modelo de sessão do MES legado) removida — as paradas agora
        // vivem no MES Malha Forte (Andon), fora deste resumo de reunião.
        return row1 + row2 + row3;
    }
};
