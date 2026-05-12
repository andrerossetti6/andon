// Lógica Central do Dashboard SIGS

// ══════════════════════════════════════════════════════════════
// MÓDULO DE AUTENTICAÇÃO
// ══════════════════════════════════════════════════════════════
const auth = {
    TOKEN_KEY: 'sigs_token',
    USER_KEY:  'sigs_usuario',

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
        const r = await fetch(url, { method: 'POST', headers: auth.cabecalho(), body: JSON.stringify(body) });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
    },

    async get(url) {
        const r = await fetch(url, { headers: auth.cabecalho() });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
    },

    async salvarImport(nomeArquivo, rawData, monthCols) {
        const anos = [...new Set(monthCols.map(c => c.year).filter(Boolean))];
        const linhas = rawData.map(r => {
            const meses = {};
            monthCols.forEach(mc => { meses[mc.key] = r[mc.key] || 0; });
            return { codigo: r.codigo, descricao: r.descricao, modelo: r.modelo,
                     segmento: r.segmento, tamanho: r.tamanho, marca: r.marca || '',
                     meses, dados: r._extras || {},
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
    }
};

// ══════════════════════════════════════════════════════════════
// BOOTSTRAP — verifica auth antes de tudo
// ══════════════════════════════════════════════════════════════
async function bootstrap() {
    if (auth.estaLogado()) {
        const ok = await auth.verificar();
        if (ok) { mostrarApp(); return; }
        auth.sair();
    }

    // Mostra tela de carregamento enquanto tenta conectar
    const loginView = document.getElementById('view-login');
    loginView.style.display = 'flex';
    const statusEl = document.getElementById('login-status');

    // Auto-login com retry — Render pode demorar ~30s para acordar
    const MAX = 8;
    for (let i = 1; i <= MAX; i++) {
        if (statusEl) statusEl.textContent = i === 1
            ? 'Conectando ao servidor...'
            : `Aguardando servidor... (${i}/${MAX})`;
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'admin@stoll.com.br', senha: 'Admin@2025' }),
                signal: AbortSignal.timeout(10000)
            });
            const data = await res.json();
            if (res.ok) {
                auth.salvar(data.token, data.usuario);
                loginView.style.display = 'none';
                mostrarApp();
                return;
            }
            break; // servidor respondeu mas login falhou — não adianta retry
        } catch {
            if (i < MAX) await new Promise(r => setTimeout(r, 5000));
        }
    }

    // Fallback: exibe formulário manual
    if (statusEl) statusEl.textContent = 'Servidor indisponível. Faça login manualmente.';
    document.getElementById('login-form-wrap').style.display = 'block';
}

function mostrarApp() {
    const usuario = auth.getUsuario();
    document.getElementById('view-login').style.display  = 'none';
    document.getElementById('app-sidebar').style.display = 'flex';
    navigateTo('dashboard');

    // Atualiza nome do usuário na sidebar
    if (usuario) {
        const nameEl = document.querySelector('.user-info .name');
        const roleEl = document.querySelector('.user-info .role');
        if (nameEl) nameEl.textContent = usuario.nome;
        if (roleEl) roleEl.textContent = usuario.perfil === 'admin' ? 'Administrador' : 'Visualizador';
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
    estoque.init();
    op.init();
    abcCruzada.init();
    ranking.init();
    vxe.init();
    abc.init();
    abcMicro.init();
    dist.init();
    vendas.carregarHistorico()
        .then(() => estoque.carregarHistorico())
        .then(() => op.carregarHistorico())
        .catch(() => {});
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
        submitBtn.textContent = 'Entrando...';
        erroEl.style.display = 'none';
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
                mostrarApp();
            } else {
                erroEl.textContent = data.erro || 'Credenciais inválidas';
                erroEl.style.display = 'block';
            }
        } catch {
            erroEl.textContent = 'Erro de conexão. Tente novamente.';
            erroEl.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Entrar';
        }
    });
});

const state = {
    insights: [
        {
            id: 1,
            type: 'MANUTENÇÃO • PREDITIVA',
            title: 'Máq 12 com 87% de probabilidade de falha em 7 dias',
            desc: 'Padrão de vibração e ciclo térmico cruzando limites históricos. Manutenção preventiva sugerida pra evitar parada não-planejada de ~6h.',
            badge: '-6h parada evitada',
            time: 'há 6min',
            isNew: true,
            icon: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`,
            category: 'manutencao',
            severity: 'critical',
            color: '#F85149'
        },
        {
            id: 2,
            type: 'EFICIÊNCIA • TENDÊNCIA',
            title: 'Máq 03 perdendo eficiência consistentemente nas últimas 4h',
            desc: 'Queda gradual de 91% → 78% sem causa óbvia em paradas. Possível desgaste de agulha ou tensão. Recomendado inspeção visual do cilindro 2.',
            badge: '+3.1% OEE potencial',
            time: 'há 12min',
            isNew: true,
            icon: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
            category: 'eficiencia',
            severity: 'warning',
            color: '#D29922'
        },
        {
            id: 3,
            type: 'QUALIDADE • PADRÃO',
            title: 'Pico de CNQ na peça #4821-Y entre 14h-16h',
            desc: 'Refugo cresceu 240% nesta janela em 3 dias seguidos. Correlação com troca de turno e variação térmica sugere ajuste fino de tensão.',
            badge: '12kg/dia material salvo',
            time: 'há 28min',
            isNew: true,
            icon: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
            category: 'qualidade',
            severity: 'warning',
            color: '#D29922'
        }
    ],
    actions: [
        { text: 'Insight aplicado: Manutenção M07 agendada', time: 'há 18min • Ricardo S.' },
        { text: 'Análise concluída: 14 máquinas avaliadas', time: 'há 32min • automático' },
        { text: 'Meta de turno ajustada pra 76%', time: 'há 1h • Carla M.' },
        { text: 'Insight ignorado: Loop X em M02', time: 'há 2h • Pedro F.' },
        { text: 'Novo padrão detectado: peças loop turno noite', time: 'há 3h • automático' }
    ]
};

function init() {
    renderInsights();
    renderActions();
    drawMiniCharts();
    setupEventListeners();
    vendas.init();
}

function renderInsights() {
    const container = document.getElementById('insights-container');
    container.innerHTML = state.insights.map(insight => `
        <div class="insight-card" data-category="${insight.category}" data-severity="${insight.severity}">
            <div class="insight-icon" style="color: ${insight.color}">
                ${insight.icon}
            </div>
            <div class="insight-content">
                <div class="insight-meta">
                    <span class="type" style="color: ${insight.color}">${insight.type}</span>
                    <span class="time">${insight.time}</span>
                    ${insight.isNew ? '<span class="new-tag">NOVO</span>' : ''}
                </div>
                <h4>${insight.title}</h4>
                <p>${insight.desc}</p>
                <div class="insight-footer">
                    <div class="insight-badge">${insight.badge}</div>
                    <div class="insight-actions">
                        <button class="btn primary" onclick="applyInsight(${insight.id})">${insight.id === 1 ? 'Agendar' : 'Aplicar'}</button>
                        <button class="btn secondary">Adiar</button>
                        <button class="btn secondary" onclick="ignoreInsight(${insight.id})">Ignorar</button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function applyInsight(id) {
    const insight = state.insights.find(i => i.id === id);
    if (!insight) return;
    
    state.actions.unshift({
        text: `Insight aplicado: ${insight.title.split(' ')[0]} ${insight.title.split(' ')[1]}`,
        time: 'agora • andre rossetti'
    });
    
    state.insights = state.insights.filter(i => i.id !== id);
    renderInsights();
    renderActions();
}

function ignoreInsight(id) {
    state.insights = state.insights.filter(i => i.id !== id);
    renderInsights();
}

function renderActions() {
    const container = document.getElementById('actions-container');
    container.innerHTML = state.actions.slice(0, 6).map(action => `
        <div class="action-item">
            <div class="action-indicator"></div>
            <div class="action-text-info">
                <span>${action.text}</span>
                <span class="time-meta">${action.time}</span>
            </div>
        </div>
    `).join('');
}

function drawMiniCharts() {
    const canvases = document.querySelectorAll('.mini-chart, .activity-chart');
    canvases.forEach(canvas => {
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        
        const color = canvas.classList.contains('orange') ? '#D29922' : 
                     canvas.classList.contains('green') ? '#3FB950' : '#58A6FF';
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height * 0.8);
        
        for (let i = 0; i < width; i += 15) {
            ctx.lineTo(i, height * (0.3 + Math.random() * 0.5));
        }
        
        ctx.stroke();
        
        // Add a subtle gradient fill
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, color + '33');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fill();
    });
}

function setupEventListeners() {
    // Add hover effects and other micro-interactions
    document.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'scale(1.05)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'scale(1)';
        });
    });
}

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
            <td class="td-code">${r.codigo}</td>
            <td>${r.modelo || '<span style="opacity:.3">—</span>'}</td>
            <td>${r.marca  || '<span style="opacity:.3">—</span>'}</td>
            <td class="td-center"><strong>${r.tamanho}</strong></td>
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
        grad.addColorStop(0, 'rgba(88,166,255,0.9)');
        grad.addColorStop(1, 'rgba(88,166,255,0.2)');
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

function mostrarToast(msg, tipo = 'ok') {
    let toast = document.getElementById('sigs-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sigs-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `sigs-toast sigs-toast-${tipo} sigs-toast-show`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('sigs-toast-show'), 3000);
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

function navigateTo(viewName) {
    ['dashboard','vendas','estoque','op','ranking','vxe','abc','abc-micro','dist','dash-op','abc-cruzada','abc-estoque'].forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.style.display = v === viewName ? 'flex' : 'none';
    });

    document.querySelectorAll('.nav-section li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('.sub-menu li').forEach(li => li.classList.remove('sub-active'));

    const navMap = {
        vendas: 'nav-analise', estoque: 'nav-analise', op: 'nav-analise',
        ranking: 'nav-ranking', vxe: 'nav-vxe', dashboard: 'nav-analise',
        abc: 'nav-abc-cruzada', dist: 'nav-dist', 'dash-op': 'nav-dash-op',
        'abc-cruzada': 'nav-abc-cruzada', 'abc-estoque': 'nav-abc-cruzada'
    };
    const navEl = document.getElementById(navMap[viewName]);
    if (navEl) navEl.classList.add('active');

    if (viewName === 'vendas') {
        document.querySelector('[data-view="vendas"]').classList.add('sub-active');
        setTimeout(() => { if (vendas.rawData.length) vendas.render(); }, 50);
    } else if (viewName === 'estoque') {
        document.querySelector('[data-view="estoque"]').classList.add('sub-active');
    } else if (viewName === 'op') {
        document.querySelector('[data-view="op"]').classList.add('sub-active');
    } else if (viewName === 'ranking') {
        setTimeout(() => ranking.render(), 50);
    } else if (viewName === 'vxe') {
        vxe.render();
    } else if (viewName === 'abc') {
        setTimeout(() => abc.render(), 50);
    } else if (viewName === 'abc-micro') {
        setTimeout(() => abcMicro.render(), 50);
    } else if (viewName === 'dist') {
        setTimeout(() => dist.render(), 50);
    } else if (viewName === 'dash-op') {
        setTimeout(() => dashOp.render(), 50);
    } else if (viewName === 'abc-cruzada') {
        document.querySelector('[data-view="abc-cruzada"]')?.classList.add('sub-active');
        setTimeout(() => abcCruzada.render(), 50);
    } else if (viewName === 'abc-estoque') {
        document.querySelector('[data-view="abc-estoque"]')?.classList.add('sub-active');
        setTimeout(() => abcEstoque.render(), 50);
    } else if (viewName === 'abc') {
        document.querySelector('[data-view="abc"]')?.classList.add('sub-active');
        setTimeout(() => abc.render(), 50);
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

    init() {
        this.setupDropZone();
        this.setupFileInput();
        this.setupFilters();
        this.setupYearTabs();
        this.setupChartClick();
        this.setupModal();
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
            document.getElementById('search-input').value     = '';
            document.getElementById('filter-year').value      = 'all';
            this.selectedYear = 'all';
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
            const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
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
                marca:     get(row, 'marca'),
                _extras: extras,
                ...mData,
                quantidade: toNum(get(row, 'quantidade', 'qtd', 'qty', 'qtde')),
                valor:      toNum(get(row, 'valor', 'valorrs', 'valortotal', 'valorr'))
            };
        });

        this.filtered = [...this.rawData];
        this.populateFilters();
        this.showDataSection();
        this.render();
        this.perguntarESalvar(this._nomeArquivo || 'importacao');
    },

    // ── Fluxo de salvar ────────────────────────────────────────
    async perguntarESalvar(nomeArquivo) {
        this._nomeArquivoAtual = nomeArquivo;
        const lista = await api.listarImportacoes();
        if (!lista || !lista.length) {
            await this.salvarImportacao('nova');
        } else {
            document.getElementById('modal-arquivo').textContent = nomeArquivo;
            document.getElementById('import-modal').style.display = 'flex';
        }
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
        if (!lista) return;
        this._importacoes = lista;
        // Se nenhum dado em memória, carrega o mais recente automaticamente
        if (!this.rawData.length && lista.length) {
            await this.carregarImportacao(lista[0].id);
        } else {
            this.renderHistorico();
        }
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

        const normK = k => String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
        const KNOWN_LOAD = new Set(['marca']);
        const firstWithDados = rows.find(r => r.dados && Object.keys(r.dados).length > 0);
        this.extraCols = firstWithDados
            ? Object.keys(firstWithDados.dados).filter(k => !KNOWN_LOAD.has(normK(k)))
            : [];

        this.rawData  = rows.map((r, i) => {
            const dados = r.dados || {};
            const marcaKey = Object.keys(dados).find(k => normK(k) === 'marca');
            const extras = { ...dados };
            if (marcaKey) delete extras[marcaKey];
            // r.marca vem da coluna DB; fallback para dados['Marca'] de imports antigos
            const marca = r.marca || (marcaKey ? (dados[marcaKey] || '') : '');
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
        this.populateFilters();
        this.showDataSection();
        this.render();
        this.renderHistorico();
    },

    renderHistorico() {
        const wrap = document.getElementById('import-history');
        const list = document.getElementById('history-list');
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
                    <span class="hi-nome">${imp.nome_arquivo}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} itens${anos ? ' · ' + anos : ''}</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();vendas.excluirImportacao('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
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
            else this.salvarImportacao('substituir');
        });
        document.getElementById('btn-nova-imp').addEventListener('click', () => {
            const modulo = document.getElementById('import-modal').dataset.modulo;
            if (modulo === 'estoque') estoque.salvar('nova');
            else if (modulo === 'op') op.salvar('nova');
            else this.salvarImportacao('nova');
        });
        document.getElementById('btn-cancelar-imp').addEventListener('click', () => {
            document.getElementById('import-modal').style.display = 'none';
        });
    },

    populateFilters() {
        const unique = key => [...new Set(this.rawData.map(r => r[key]).filter(Boolean))].sort();
        this.fillSelect('filter-segmento', unique('segmento'));
        this.fillSelectLabel('filter-marca', unique('marca'), 'Todas');
        this.fillSelect('filter-modelo',   unique('modelo'));
        this.fillSelect('filter-tamanho',  unique('tamanho'));
        this.fillSelectLabel('filter-descricao', unique('descricao'), 'Todas');

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
        const uniqAll = key => [...new Set(this.rawData.map(r => r[key]).filter(Boolean))].sort();
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

        // Segmento — usa rawData para mostrar todos sempre (não só os filtrados)
        const segSelecionado = document.getElementById('filter-segmento').value;
        const bySeg = {};
        const _mod  = document.getElementById('filter-modelo')?.value    || '';
        const _tam  = document.getElementById('filter-tamanho')?.value   || '';
        const _desc = document.getElementById('filter-descricao')?.value || '';
        this.rawData.filter(r => {
            if (_mod  && r.modelo    !== _mod)  return false;
            if (_tam  && r.tamanho   !== _tam)  return false;
            if (_desc && r.descricao !== _desc) return false;
            return true;
        }).forEach(r => {
            const k = r.segmento || '—';
            bySeg[k] = (bySeg[k] || 0) + rowQtd(r);
        });
        const totalSeg = Object.values(bySeg).reduce((s, v) => s + v, 0);
        document.getElementById('summary-segmento').innerHTML =
            this.renderBreakdown(bySeg, totalSeg, 'segmento', segSelecionado);

        // Tamanho — usa os dados já filtrados (inclusive pelo segmento clicado)
        const byTam = {};
        this.filtered.forEach(r => {
            const k = r.tamanho || '—';
            byTam[k] = (byTam[k] || 0) + rowQtd(r);
        });
        document.getElementById('summary-tamanho').innerHTML =
            this.renderBreakdown(byTam, total, null, null);
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
                    ? `onclick="vendas.clickBreakdown('${campo}','${label.replace(/'/g, "\\'")}')"` : '';
                return `
                <div class="breakdown-item${ativo ? ' bd-ativo' : ''}${campo ? ' bd-click' : ''}" ${clicavel}>
                    <span class="bd-label">${label}</span>
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
                grad.addColorStop(1, 'rgba(88,166,255,0.6)');
            } else if (isOther) {
                grad.addColorStop(0, 'rgba(88,166,255,0.3)');
                grad.addColorStop(1, 'rgba(88,166,255,0.08)');
            } else {
                grad.addColorStop(0, 'rgba(88,166,255,0.85)');
                grad.addColorStop(1, 'rgba(88,166,255,0.2)');
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
        const extras = this.extraCols || [];
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
                    return vb - va; // decrescente: maior venda primeiro
                });
        }

        const rows = displayRows.slice(0, 500);
        table.querySelector('tbody').innerHTML = rows.map(r => `
            <tr onclick="abrirDetalhe('${r.descricao.replace(/'/g, "\\'")}','${r.segmento}')">
                <td class="td-code">${r.codigo}</td>
                <td class="td-desc">${r.descricao}</td>
                <td>${r.modelo}</td>
                <td><span class="seg-badge">${r.segmento}</span></td>
                <td>${r.marca || '<span style="opacity:.3">—</span>'}</td>
                <td class="td-center">${r.tamanho}</td>
                ${extras.map(c => {
                    const v = (r._extras || {})[c];
                    return `<td>${v || '<span style="opacity:.3">—</span>'}</td>`;
                }).join('')}
                ${cols.map(c => {
                    const v   = r[c.key];
                    const sel = this.selectedMonth === c.abbr;
                    return `<td class="td-month${sel ? ' td-month-sel' : ''}">${v ? v.toLocaleString('pt-BR') : '<span style="opacity:.3">—</span>'}</td>`;
                }).join('')}
                <td class="td-qtd">${r.quantidade.toLocaleString('pt-BR')}</td>
                <td class="td-valor">${r.valor ? 'R$ ' + r.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '<span style="opacity:.3">—</span>'}</td>
            </tr>
        `).join('');

        const total  = displayRows.length;
        const suffix = total > 500 ? ' (exibindo 500)' : '';
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
                `<div class="combobox-option${v === this._descSelected ? ' active' : ''}" data-val="${v}">${v}</div>`
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
            segEl.innerHTML = `<option value="">Todos segmentos</option>` + vals.map(v => `<option value="${v}">${v}</option>`).join('');
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

    normalizeKey(key) {
        return String(key).toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g,'')
            .replace(/[^a-z0-9]/g,'');
    },

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
            extraCols.map(h => `<th>${h.toUpperCase()}</th>`).join('') +
            '<th class="td-right">QUANTIDADE</th>';

        // Linhas
        const rows = this.filtered.slice(0, 500);
        table.querySelector('tbody').innerHTML = rows.map(r => {
            const zero = r.quantidade === 0;
            const cells = extraCols.map(h => {
                const v = r.dados?.[h];
                return `<td>${v !== undefined && v !== '' ? v : '<span style="opacity:.3">—</span>'}</td>`;
            }).join('');
            return `<tr${zero ? ' class="row-zero"' : ''}>
                ${cells}
                <td class="td-qtd${zero ? ' zero-qtd' : ''}">${r.quantidade.toLocaleString('pt-BR')}</td>
            </tr>`;
        }).join('');

        const total = this.filtered.length;
        document.getElementById('est-count').textContent =
            `${total.toLocaleString('pt-BR')} itens${total > 500 ? ' (exibindo 500)' : ''}`;
    },

    // ── Salvar / Histórico ────────────────────────────────────
    async perguntarESalvar(nome) {
        this._nomeArquivo = nome;
        const lista = await api.get('/api/importacoes-estoque');
        if (!lista?.length) { await this.salvar('nova'); }
        else {
            document.getElementById('modal-arquivo').textContent = nome;
            document.getElementById('import-modal').dataset.modulo = 'estoque';
            document.getElementById('import-modal').style.display = 'flex';
        }
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
        const lista = await api.get('/api/importacoes-estoque');
        if (!lista) return;
        this._importacoes = lista;
        if (!this.rawData.length && lista.length) {
            await this.carregarImportacao(lista[0].id);
        } else {
            this.renderHistorico();
        }
    },

    async carregarImportacao(id) {
        this.setSalvando(true);
        const rows = await api.get(`/api/estoque?importacao_id=${id}`);
        this.setSalvando(false);
        if (!rows?.length) return;

        this._currentId = id;

        // Reconstrói colunas a partir do JSONB dados
        const sampleDados = rows.find(r => r.dados && Object.keys(r.dados).length)?.dados || {};
        this.colunas = Object.keys(sampleDados).length ? Object.keys(sampleDados) : ['codigo'];

        const normKey = k => String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
        const VAL_KEYS = ['total','valor','valortotal','vltotal','preco','price','custo','vl','vlunit','valorunit'];
        this._colValor = this.colunas.find(c => VAL_KEYS.includes(normKey(c))) || null;

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
                    <span class="hi-nome">${imp.nome_arquivo}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} itens</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();estoque.excluir('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
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
                `<div class="combobox-option${v === this[selKey] ? ' active' : ''}" data-val="${v}">${v}</div>`
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

        // Detecta se é o relatório formatado do ERP (contém "O.P. N°" em alguma célula)
        const isERPReport = rows.some(r =>
            Object.values(r).some(v => /O\.P\.?\s*N[°º]/i.test(String(v)))
        );
        if (isERPReport) { this._parseERPReport(rows); return; }

        // Formato tabular normal
        const allHeaders = Object.keys(rows[0]).filter(h => {
            const n = this.normalizeKey(h);
            return n && !n.startsWith('__');
        });
        const QTD_KEYS = ['quantidade','qtd','qty','qtde','saldo','pecas','pcs','aproduzir'];
        const qtdNorm  = allHeaders.find(h => QTD_KEYS.includes(this.normalizeKey(h)));
        this._colQtd   = qtdNorm || null;
        this.colunas   = allHeaders;
        this.rawData   = rows.map((r, i) => ({
            _id: i,
            dados: Object.fromEntries(allHeaders.map(h => [h, r[h] ?? '']))
        }));
        this.filtered = [...this.rawData];
        this._finalizarImport();
    },

    _parseERPReport(rows) {
        const toNum = v => parseFloat(String(v ?? '').replace(',', '.')) || 0;
        const PART_NAMES = ['Produto', 'Cor', 'Tamanho', 'Modelo', 'Versão', 'Caract. 5', 'Caract. 6'];
        const parsed = [];
        let curOP = null;

        for (const row of rows) {
            const vals = Object.values(row);
            const a = String(vals[0] ?? '').trim();

            // Linha de cabeçalho da OP
            if (/O\.P\.?\s*N[°º]/i.test(a)) {
                const nMatch  = a.match(/N[°º][^:]*:\s*(\d+)/i);
                const emMatch = a.match(/Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i);
                const piMatch = a.match(/Previs[aã]o\s+Inicial:\s*(\d{2}\/\d{2}\/\d{4})/i);
                const pfMatch = a.match(/Previs[aã]o\s+Final:\s*(\d{2}\/\d{2}\/\d{4})/i);
                const stMatch = a.match(/Status:\s*(.+)$/i);
                curOP = {
                    'OP Nº':         nMatch  ? nMatch[1]  : '',
                    'Emissão':       emMatch ? emMatch[1] : '',
                    'Prev. Inicial': piMatch ? piMatch[1] : '',
                    'Prev. Final':   pfMatch ? pfMatch[1] : '',
                    'Status':        stMatch ? stMatch[1].trim() : '',
                };
            }
            // Linha de produto
            else if (/^Produto:/i.test(a) && curOP) {
                // Extrai código e resto
                const codeMatch = a.match(/Produto:\s*(\d+)\s*[-–]\s*(.+)/i);
                if (!codeMatch) continue;
                const codigo = codeMatch[1].trim();
                const resto  = codeMatch[2];

                // Extrai "Para Produção" (1º número) do final do texto
                const numMatch = resto.match(/^(.+?)\s+([\d,]+)\s+[\d,]+\s+[\d,]+\s+[\d,]+\s+[\d,]+\s*$/);
                let descricao, paraProducao;

                if (numMatch) {
                    descricao    = numMatch[1].trim();
                    paraProducao = toNum(numMatch[2]);
                } else {
                    descricao    = resto.trim();
                    paraProducao = toNum(vals[2]);
                }

                // Quebra a descrição por "|" em colunas separadas
                const parts = descricao.split('|').map(p => p.trim());
                const record = { ...curOP, 'Código': codigo };
                parts.forEach((p, i) => { record[PART_NAMES[i] || `Caract. ${i}`] = p; });
                record['Produção'] = paraProducao;
                parsed.push(record);
            }
        }

        if (!parsed.length) {
            alert('Nenhuma Ordem de Produção encontrada no arquivo.');
            return;
        }

        // Garante colunas consistentes em todos os registros
        const allKeys = [...new Set(parsed.flatMap(r => Object.keys(r)))];
        parsed.forEach(r => { allKeys.forEach(k => { if (!(k in r)) r[k] = ''; }); });

        this.colunas  = allKeys;
        this._colQtd  = 'Produção';
        this.rawData  = parsed.map((r, i) => ({ _id: i, dados: r }));
        this.filtered = [...this.rawData];
        this._finalizarImport();
    },

    _finalizarImport() {
        this._detectCombosCols();
        document.getElementById('op-drop-zone').style.display = 'none';
        document.getElementById('op-data').classList.add('visible');
        this.render();
        this.perguntarESalvar(this._nomeArquivo);
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
        const qtd   = this._colQtd
            ? this.filtered.reduce((s, r) => s + (parseFloat(String(r.dados?.[this._colQtd] ?? '0').replace(',','.')) || 0), 0)
            : 0;

        document.getElementById('op-total').textContent     = total.toLocaleString('pt-BR');
        document.getElementById('op-qtd').textContent       = this._colQtd ? qtd.toLocaleString('pt-BR') : '—';
        document.getElementById('op-filtrados').textContent = filt.toLocaleString('pt-BR');
        document.getElementById('op-count').textContent     = `${filt.toLocaleString('pt-BR')} ordens${filt > 500 ? ' (exibindo 500)' : ''}`;

        const table = document.getElementById('op-table');
        table.querySelector('thead tr').innerHTML =
            this.colunas.map(h => `<th>${h.toUpperCase()}</th>`).join('');
        table.querySelector('tbody').innerHTML = this.filtered.slice(0, 500).map(r => {
            const cells = this.colunas.map(h => {
                const v = r.dados?.[h];
                return `<td>${v !== undefined && v !== '' ? v : '<span style="opacity:.3">—</span>'}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
    },

    async perguntarESalvar(nome) {
        this._nomeArquivo = nome;
        const lista = await api.get('/api/importacoes-op');
        const temSalvo = lista?.length > 0 || !!this._currentId;
        if (!temSalvo) {
            await this.salvar('nova');
        } else {
            document.getElementById('modal-arquivo').textContent = nome;
            document.getElementById('import-modal').dataset.modulo = 'op';
            document.getElementById('import-modal').style.display = 'flex';
        }
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
            } else {
                alert('Erro ao salvar no banco. Verifique se as tabelas importacoes_op e ordens_producao foram criadas no Supabase.');
            }
        } catch(e) {
            alert('Erro de conexão ao salvar importação.');
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
        this.renderHistorico();
        if (lista?.length && !this._currentId) await this.carregarImportacao(lista[0].id);
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
        this._detectCombosCols();
        document.getElementById('op-drop-zone').style.display = 'none';
        document.getElementById('op-data').classList.add('visible');
        this.render();
        this.renderHistorico();
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
                    <span class="hi-nome">${imp.nome_arquivo}</span>
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

// ====== DASHBOARD: ORDENS DE PRODUÇÃO ======

const dashOp = {
    render() {
        if (!op.rawData.length) {
            document.getElementById('dash-op-cards').innerHTML =
                '<p style="color:var(--text-dim);padding:20px;">Importe dados de Ordens de Produção primeiro.</p>';
            return;
        }

        // Detecta melhor coluna categórica para o gráfico
        const catCols = op.colunas.filter(c => {
            const QTD = ['quantidade','qtd','qty','qtde','saldo','pecas','pcs','id','codigo','cod','numero','num'];
            return !QTD.includes(op.normalizeKey(c));
        });

        const sel = document.getElementById('dash-op-col-sel');
        if (!sel.options.length || sel.dataset.loaded !== 'yes') {
            sel.innerHTML = catCols.map(c => `<option value="${c}">${c}</option>`).join('');
            sel.dataset.loaded = 'yes';
            sel.addEventListener('change', () => this.renderChart(sel.value));
        }

        const colAtiva = sel.value || catCols[0];

        // Cards dinâmicos — top 3 valores da coluna principal
        const counts = {};
        op.rawData.forEach(r => {
            const v = String(r.dados?.[colAtiva] ?? '—');
            counts[v] = (counts[v] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
        const cardsEl = document.getElementById('dash-op-cards');
        cardsEl.innerHTML = `
            <div class="summary-card">
                <span class="s-label">TOTAL ORDENS</span>
                <span class="s-value">${op.rawData.length.toLocaleString('pt-BR')}</span>
                <span class="s-sub">ordens importadas</span>
            </div>` +
            sorted.slice(0,3).map(([v,n]) => `
            <div class="summary-card">
                <span class="s-label">${colAtiva.toUpperCase()}</span>
                <span class="s-value" style="font-size:1.6rem;">${n.toLocaleString('pt-BR')}</span>
                <span class="s-sub">${v}</span>
            </div>`).join('');

        this.renderChart(colAtiva);
    },

    renderChart(col) {
        const canvas = document.getElementById('dash-op-chart');
        const ctx    = canvas.getContext('2d');
        canvas.width  = canvas.offsetWidth  || 600;
        canvas.height = canvas.offsetHeight || 280;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const counts = {};
        op.rawData.forEach(r => {
            const v = String(r.dados?.[col] ?? '—');
            counts[v] = (counts[v] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 15);
        if (!sorted.length) return;

        const W = canvas.width, H = canvas.height;
        const padL = 180, padR = 20, padT = 20, padB = 30;
        const chartW = W - padL - padR;
        const chartH = H - padT - padB;
        const max = sorted[0][1];
        const barH = Math.max(12, (chartH / sorted.length) - 4);

        ctx.font = '11px Inter';
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(padL, padT, chartW, chartH);

        sorted.forEach(([label, val], i) => {
            const y = padT + i * (chartH / sorted.length) + (chartH / sorted.length - barH) / 2;
            const w = (val / max) * chartW;
            const grad = ctx.createLinearGradient(padL, 0, padL + w, 0);
            grad.addColorStop(0, 'rgba(88,166,255,0.9)');
            grad.addColorStop(1, 'rgba(88,166,255,0.3)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(padL, y, w, barH, 4);
            ctx.fill();
            ctx.fillStyle = 'rgba(230,237,243,0.75)';
            const lbl = label.length > 22 ? label.slice(0,20)+'…' : label;
            ctx.textAlign = 'right';
            ctx.fillText(lbl, padL - 8, y + barH / 2 + 4);
            ctx.fillStyle = 'rgba(230,237,243,0.5)';
            ctx.textAlign = 'left';
            ctx.fillText(val.toLocaleString('pt-BR'), padL + w + 6, y + barH / 2 + 4);
        });
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
            const key = this.selectedGrupo === 'descricao' ? r.descricao : r.codigo;
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

        ctx.fillStyle = 'rgba(88,166,255,0.07)';
        ctx.fillRect(padL, padT, xA - padL, chartH);
        ctx.fillStyle = 'rgba(210,153,34,0.07)';
        ctx.fillRect(xA, padT, xB - xA, chartH);
        ctx.fillStyle = 'rgba(139,148,158,0.05)';
        ctx.fillRect(xB, padT, w - padR - xB, chartH);

        ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
        if (bA > 0) {
            ctx.fillStyle = 'rgba(88,166,255,0.65)';
            ctx.fillText('A', padL + (xA - padL) / 2, padT + 11);
        }
        if (bB > bA) {
            ctx.fillStyle = 'rgba(210,153,34,0.65)';
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
        ctx.strokeStyle = 'rgba(88,166,255,0.85)';
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
        ctx.fillStyle = 'rgba(88,166,255,0.05)';
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
        const isDesc  = this.selectedGrupo === 'descricao';
        const visible = this._selectedClasse
            ? this._items.filter(i => i.classe === this._selectedClasse)
            : this._items;
        const countEl = document.getElementById('abc-count');
        if (countEl) countEl.textContent = this._selectedClasse
            ? `${visible.length} itens — Classe ${this._selectedClasse} (clique para ver todos)`
            : `${this._items.length.toLocaleString('pt-BR')} itens analisados`;
        document.querySelector('#abc-table thead tr').innerHTML = `
            <th style="width:40px;">#</th>
            <th>${isDesc ? 'DESCRIÇÃO' : 'CÓDIGO'}</th>
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
            const cellCls = isDesc ? 'td-desc' : 'td-code';
            const seg = vendas.rawData.find(v => (isDesc ? v.descricao : v.codigo) === r.label)?.segmento || '';
            const clickAttr = isDesc
                ? `onclick="abrirDetalhe('${r.label.replace(/'/g,"\\'")}','${seg.replace(/'/g,"\\'")}'); event.stopPropagation();" style="cursor:pointer;"`
                : '';
            return `<tr ${clickAttr} title="${isDesc ? 'Clique para ver detalhe' : ''}">
                <td class="td-dim td-center">${i + 1}</td>
                <td class="${cellCls}" style="${isDesc ? 'color:var(--indigo-primary);' : ''}">${r.label}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${r.modelo || '—'}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${r.marca  || '—'}</td>
                <td style="font-size:0.72rem;color:var(--text-dim)">${r.tamanho || '—'}</td>
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
    },

    async render() {
        // Garante que o estoque está carregado antes de renderizar
        if (!estoque.rawData.length) {
            await estoque.carregarHistorico();
            // Se ainda vazio (race condition), busca direto da API
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
            const key = this.selectedGrupo === 'descricao' ? r.descricao : r.codigo;
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

        ctx.fillStyle = 'rgba(88,166,255,0.07)';
        ctx.fillRect(padL, padT, xA - padL, chartH);
        ctx.fillStyle = 'rgba(210,153,34,0.07)';
        ctx.fillRect(xA, padT, xB - xA, chartH);
        ctx.fillStyle = 'rgba(139,148,158,0.05)';
        ctx.fillRect(xB, padT, w - padR - xB, chartH);

        ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
        if (bA > 0) {
            ctx.fillStyle = 'rgba(88,166,255,0.65)';
            ctx.fillText('A', padL + (xA - padL) / 2, padT + 11);
        }
        if (bB > bA) {
            ctx.fillStyle = 'rgba(210,153,34,0.65)';
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
        ctx.strokeStyle = 'rgba(88,166,255,0.85)';
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
        ctx.fillStyle = 'rgba(88,166,255,0.05)';
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
        const isDesc  = this.selectedGrupo === 'descricao';
        const visible = this._selectedClasse
            ? this._items.filter(i => i.classe === this._selectedClasse)
            : this._items;
        const countEl = document.getElementById('abcm-count');
        if (countEl) countEl.textContent = this._selectedClasse
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
                ? `onclick="abrirDetalhe('${r.label.replace(/'/g,"\\'")}','${seg.replace(/'/g,"\\'")}'); event.stopPropagation();" style="cursor:pointer;"`
                : '';
            const estQtd  = estMap[String(r.label || '').trim()];
            const estCell = estQtd !== undefined ? estQtd.toLocaleString('pt-BR') : '<span style="opacity:.3">—</span>';
            return `<tr ${clickAttr} title="${isDesc ? 'Clique para ver detalhe' : ''}">
                <td class="td-dim td-center">${i + 1}</td>
                <td class="${cellCls}" style="${isDesc ? 'color:var(--indigo-primary);' : ''}">${r.label}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${r.modelo || '—'}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${r.marca  || '—'}</td>
                <td style="font-size:0.72rem;color:var(--text-dim)">${r.tamanho || '—'}</td>
                <td class="td-qtd">${r.quantidade.toLocaleString('pt-BR')}</td>
                <td class="td-right">${estCell}</td>
                <td class="td-right td-dim">${r.pct.toFixed(2)}%</td>
                <td class="td-right td-dim">${r.cumPct.toFixed(1)}%</td>
                <td class="td-center"><span class="abc-badge ${cls}">${r.classe}</span></td>
            </tr>`;
        }).join('');
    }
};


// ====== DASHBOARD: DISTRIBUIÇÃO POR CARACTERÍSTICA ======

const dist = {
    colAtiva: '',

    init() {
        document.getElementById('dist-col-sel').addEventListener('change', e => {
            this.colAtiva = e.target.value;
            this.renderGrafico();
        });
    },

    render() {
        const infoEl = document.getElementById('dist-info');
        if (!estoque.rawData.length) {
            infoEl.textContent = 'Importe dados de Estoque primeiro';
            document.getElementById('dist-breakdown').innerHTML = '';
            return;
        }

        const QTD_NORMS = ['quantidade','qtd','qty','qtde','estoque','saldo','codigo','cod','code','cdproduto','cdprod'];
        const cols = estoque.colunas.filter(c => {
            const n = estoque.normalizeKey(c);
            return !QTD_NORMS.includes(n) && !n.startsWith('__');
        });

        if (!cols.length) { infoEl.textContent = 'Nenhuma coluna de categoria encontrada'; return; }

        const sel = document.getElementById('dist-col-sel');
        const cur = this.colAtiva;
        sel.innerHTML = cols.map(c => `<option value="${c}">${c}</option>`).join('');

        const caract = cols.find(c => estoque.normalizeKey(c).includes('caracter')) || cols[0];
        this.colAtiva = (cur && cols.includes(cur)) ? cur : caract;
        sel.value = this.colAtiva;

        this.renderGrafico();
    },

    renderGrafico() {
        if (!this.colAtiva || !estoque.rawData.length) return;

        const map = {};
        estoque.rawData.forEach(r => {
            const val = String(r.dados?.[this.colAtiva] ?? '—').trim() || '—';
            if (!map[val]) map[val] = { count: 0, qtd: 0 };
            map[val].count++;
            map[val].qtd += r.quantidade;
        });

        const total  = Object.values(map).reduce((s, v) => s + v.qtd, 0);
        const sorted = Object.entries(map)
            .map(([label, v]) => ({ label, ...v, pct: total > 0 ? v.qtd / total * 100 : 0 }))
            .sort((a, b) => b.qtd - a.qtd);

        document.getElementById('dist-info').textContent =
            `${sorted.length} categorias · ${estoque.rawData.length.toLocaleString('pt-BR')} itens`;

        document.getElementById('dist-breakdown').innerHTML = sorted.map(item => `
            <div class="breakdown-item">
                <span class="bd-label" title="${item.label}">${item.label}</span>
                <div class="bd-bar-wrap"><div class="bd-bar" style="width:${item.pct}%"></div></div>
                <span class="bd-val">${item.qtd.toLocaleString('pt-BR')}</span>
            </div>
        `).join('');

        setTimeout(() => this.drawChart(sorted.slice(0, 15)), 30);
    },

    drawChart(items) {
        const canvas = document.getElementById('dist-chart');
        if (!canvas || !items.length) return;
        const ctx = canvas.getContext('2d');
        const rowH = 36, padL = 200, padR = 120, padT = 8, padB = 8;
        const w = canvas.width  = canvas.offsetWidth || 700;
        const h = canvas.height = items.length * rowH + padT + padB;
        ctx.clearRect(0, 0, w, h);

        const max  = items[0].qtd || 1;
        const barW = w - padL - padR;

        items.forEach((item, i) => {
            const y  = padT + i * rowH;
            const bw = Math.max((item.qtd / max) * barW, 2);

            const grad = ctx.createLinearGradient(padL, 0, padL + bw, 0);
            grad.addColorStop(0, 'rgba(88,166,255,0.85)');
            grad.addColorStop(1, 'rgba(88,166,255,0.25)');
            ctx.fillStyle = grad;
            const r2 = 4, bx = padL, by = y + 5, bh = rowH - 10;
            ctx.beginPath();
            ctx.moveTo(bx + r2, by);
            ctx.lineTo(bx + bw - r2, by);
            ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r2);
            ctx.lineTo(bx + bw, by + bh - r2);
            ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r2, by + bh);
            ctx.lineTo(bx, by + bh);
            ctx.lineTo(bx, by);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = 'rgba(230,237,243,0.75)';
            ctx.font = '10px Inter';
            ctx.textAlign = 'right';
            const lbl = item.label.length > 26 ? item.label.substring(0, 26) + '…' : item.label;
            ctx.fillText(lbl, padL - 10, y + rowH / 2 + 4);

            ctx.fillStyle = 'rgba(230,237,243,0.9)';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'left';
            ctx.fillText(`${item.qtd.toLocaleString('pt-BR')} (${item.pct.toFixed(1)}%)`, padL + bw + 8, y + rowH / 2 + 4);
        });
    }
};

// ====== DASHBOARD: ABC ESTOQUE ======

const abcEstoque = {
    _selectedClasse: null,
    _items: [],

    render() {
        if (!estoque.rawData.length) {
            document.getElementById('abce-count').textContent = 'Importe dados de Estoque primeiro.';
            return;
        }

        // Detecta coluna de descrição no estoque
        const descCol = estoque._colDesc || estoque.colunas.find(c => {
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

        ctx.fillStyle = 'rgba(88,166,255,0.07)';
        ctx.fillRect(padL, padT, xA - padL, chartH);
        ctx.fillStyle = 'rgba(210,153,34,0.07)';
        ctx.fillRect(xA, padT, xB - xA, chartH);
        ctx.fillStyle = 'rgba(139,148,158,0.05)';
        ctx.fillRect(xB, padT, w - padR - xB, chartH);

        ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
        if (bA > 0) { ctx.fillStyle = 'rgba(88,166,255,0.65)'; ctx.fillText('A', padL + (xA - padL) / 2, padT + 11); }
        if (bB > bA) { ctx.fillStyle = 'rgba(210,153,34,0.65)'; ctx.fillText('B', xA + (xB - xA) / 2, padT + 11); }
        if (n > bB) { ctx.fillStyle = 'rgba(139,148,158,0.6)'; ctx.fillText('C', xB + (w - padR - xB) / 2, padT + 11); }

        [80, 95].forEach(pct => {
            const y = padT + chartH * (1 - pct / 100);
            ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '8px Inter'; ctx.textAlign = 'left';
            ctx.fillText(`${pct}%`, w - padR + 4, y + 3);
        });

        ctx.beginPath(); ctx.strokeStyle = 'rgba(88,166,255,0.85)'; ctx.lineWidth = 2;
        items.forEach((item, i) => {
            const x = padL + (i / Math.max(n - 1, 1)) * chartW;
            const y = padT + chartH * (1 - item.cumPct / 100);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.lineTo(padL + chartW, padT + chartH);
        ctx.lineTo(padL, padT + chartH);
        ctx.closePath();
        ctx.fillStyle = 'rgba(88,166,255,0.05)';
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
        const visible = this._selectedClasse
            ? this._items.filter(i => i.classe === this._selectedClasse)
            : this._items;
        document.getElementById('abce-count').textContent =
            this._selectedClasse
                ? `${visible.length} itens — Classe ${this._selectedClasse} (clique para ver todos)`
                : `${this._items.length.toLocaleString('pt-BR')} itens analisados`;
        document.querySelector('#abce-table tbody').innerHTML = visible.map((r, i) => {
            const cls = `abc-${r.classe.toLowerCase()}`;
            return `<tr>
                <td class="td-rank">${i + 1}</td>
                <td class="td-code">${r.codigo}</td>
                <td class="td-desc">${r.descricao || '<span style="opacity:.3">—</span>'}</td>
                <td class="td-right"><strong>${r.qtd.toLocaleString('pt-BR')}</strong></td>
                <td class="td-right">${r.pct.toFixed(2)}%</td>
                <td class="td-right">${r.cumPct.toFixed(1)}%</td>
                <td class="td-center"><span class="abc-badge ${cls}">${r.classe}</span></td>
            </tr>`;
        }).join('');
    }
};

// ====== DASHBOARD: ABC CRUZADA ======

const abcCruzada = {
    _data: [],
    _scatterPts: [],

    selectedYear:  'all',
    selectedTri:   '',
    selectedMes:   '',

    init() {
        document.getElementById('abcx-year-tabs').addEventListener('click', e => {
            const btn = e.target.closest('.year-tab');
            if (!btn) return;
            document.querySelectorAll('#abcx-year-tabs .year-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.selectedYear = btn.dataset.year;
            this.selectedTri  = '';
            this.selectedMes  = '';
            document.getElementById('abcx-tri').value = '';
            document.getElementById('abcx-mes').value = '';
            this.render();
        });
        document.getElementById('abcx-tri').addEventListener('change', e => {
            this.selectedTri = e.target.value;
            if (e.target.value) { this.selectedMes = ''; document.getElementById('abcx-mes').value = ''; }
            this.render();
        });
        document.getElementById('abcx-mes').addEventListener('change', e => {
            this.selectedMes = e.target.value;
            if (e.target.value) { this.selectedTri = ''; document.getElementById('abcx-tri').value = ''; }
            this.render();
        });
    },

    render() {
        const noVendas  = !vendas.rawData.length;
        const noEstoque = !estoque.rawData.length;
        if (noVendas || noEstoque) {
            document.getElementById('abcx-aviso').style.display = '';
            document.getElementById('abcx-aviso').textContent =
                noVendas ? 'Importe dados de Vendas primeiro.' : 'Importe dados de Estoque primeiro.';
            return;
        }
        document.getElementById('abcx-aviso').style.display = 'none';

        // Year tabs
        const tabsEl = document.getElementById('abcx-year-tabs');
        if (vendas.years.length === 1) this.selectedYear = vendas.years[0];
        tabsEl.innerHTML = vendas.years.map(y =>
            `<button class="year-tab${this.selectedYear === y ? ' active' : ''}" data-year="${y}">${y}</button>`
        ).join('') + (vendas.years.length > 1
            ? `<button class="year-tab${this.selectedYear === 'all' ? ' active' : ''}" data-year="all">Todos</button>` : '');

        // Mês selector
        const allCols = this.selectedYear === 'all' ? vendas.monthCols : vendas.monthCols.filter(c => c.year === this.selectedYear);
        const uniqueAbbrs = [...new Set(allCols.map(c => c.abbr))];
        document.getElementById('abcx-mes').innerHTML = '<option value="">Todos</option>' +
            MONTHS.filter(m => uniqueAbbrs.includes(m))
                  .map(m => `<option value="${m}"${this.selectedMes === m ? ' selected' : ''}>${m.charAt(0).toUpperCase()+m.slice(1)}</option>`)
                  .join('');

        // Active cols com filtro
        let activeCols, divisor;
        if (this.selectedTri && TRIMESTRES[this.selectedTri]) {
            activeCols = allCols.filter(c => TRIMESTRES[this.selectedTri].includes(c.abbr));
            divisor = 3;
        } else if (this.selectedMes) {
            activeCols = allCols.filter(c => c.abbr === this.selectedMes);
            divisor = 1;
        } else {
            activeCols = allCols;
            divisor = 1;
        }

        // Agrupa vendas por código
        const vendasMap = {};
        const metaMap   = {}; // codigo → { descricao, modelo, marca, tamanho }
        vendas.rawData.forEach(r => {
            const qty = Math.round(activeCols.reduce((s, c) => s + (r[c.key] || 0), 0) / divisor);
            vendasMap[r.codigo] = (vendasMap[r.codigo] || 0) + qty;
            if (!metaMap[r.codigo]) metaMap[r.codigo] = { descricao: r.descricao || '', modelo: r.modelo || '', marca: r.marca || '', tamanho: r.tamanho || '' };
        });

        // Agrupa estoque por código
        const estoqMap = {};
        estoque.rawData.forEach(r => {
            estoqMap[r.codigo] = (estoqMap[r.codigo] || 0) + r.quantidade;
        });

        const vendasABC = this._calcABC(vendasMap);
        const estoqABC  = this._calcABC(estoqMap);

        // Cruza produtos em ambas as bases
        const codes = [...new Set([...Object.keys(vendasMap), ...Object.keys(estoqMap)])].filter(c => c);
        this._data = codes.map(codigo => {
            const v   = vendasABC[codigo] || { cumPct: 100, classe: 'C', valor: 0 };
            const e   = estoqABC[codigo]  || { cumPct: 100, classe: 'C', valor: 0 };
            const meta = metaMap[codigo] || {};
            return {
                codigo,
                descricao:   meta.descricao || codigo,
                modelo:      meta.modelo    || '',
                marca:       meta.marca     || '',
                tamanho:     meta.tamanho   || '',
                vendasQty:   vendasMap[codigo] || 0,
                estoqQty:    estoqMap[codigo]  || 0,
                vendaClass:  v.classe,
                estoqClass:  e.classe,
                vendaCumPct: v.cumPct,
                estoqCumPct: e.cumPct,
            };
        }).sort((a, b) => b.vendasQty - a.vendasQty);

        document.getElementById('abcx-count').textContent = `${this._data.length.toLocaleString('pt-BR')} códigos analisados`;
        this._renderCards();
        this._renderTable();
        setTimeout(() => {
            this._renderPareto('abcx-cv', vendasABC, vendasMap, 'Vendas');
            this._renderPareto('abcx-ce', estoqABC,  estoqMap,  'Estoque');
            this._renderScatter();
        }, 30);
    },

    _renderTable() {
        const QUAD = {
            'AA': { label: 'Equilíbrio',      color: '#2ea043' },
            'AB': { label: 'Atenção Estoque',  color: '#d29922' },
            'AC': { label: 'Risco Ruptura',    color: '#f85149' },
            'BA': { label: 'Estoque Alto',     color: '#d29922' },
            'BB': { label: 'Normal',           color: '#8b949e' },
            'BC': { label: 'Estoque Baixo',    color: '#8b949e' },
            'CA': { label: 'Estoque Parado',   color: '#d29922' },
            'CB': { label: 'Normal',           color: '#8b949e' },
            'CC': { label: 'Baixo Giro',       color: '#8b949e' },
        };
        document.querySelector('#abcx-table tbody').innerHTML = this._data.map(r => {
            const q    = r.vendaClass + r.estoqClass;
            const quad = QUAD[q] || { label: q, color: '#8b949e' };
            const vcls = `abc-${r.vendaClass.toLowerCase()}`;
            const ecls = `abc-${r.estoqClass.toLowerCase()}`;
            return `<tr>
                <td class="td-code">${r.codigo}</td>
                <td class="td-desc">${r.descricao}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${r.modelo || '—'}</td>
                <td style="font-size:0.75rem;color:var(--text-dim)">${r.marca  || '—'}</td>
                <td class="td-center" style="font-size:0.75rem;">${r.tamanho || '—'}</td>
                <td class="td-qtd">${r.vendasQty.toLocaleString('pt-BR')}</td>
                <td class="td-center"><span class="abc-badge ${vcls}">${r.vendaClass}</span></td>
                <td class="td-right">${r.estoqQty.toLocaleString('pt-BR')}</td>
                <td class="td-center"><span class="abc-badge ${ecls}">${r.estoqClass}</span></td>
                <td class="td-center"><span style="font-size:0.72rem;color:${quad.color};font-weight:600;">${quad.label}</span></td>
            </tr>`;
        }).join('');
    },

    _calcABC(map) {
        const items = Object.entries(map).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
        const total = items.reduce((s, i) => s + i.v, 0);
        let cum = 0;
        const result = {};
        items.forEach(({ k, v }) => {
            cum += v;
            const cumPct = total > 0 ? cum / total * 100 : 100;
            result[k] = { valor: v, cumPct, classe: cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C' };
        });
        return result;
    },



    _renderCards() {
        let AA = 0, AC = 0, CA = 0, CC = 0;
        this._data.forEach(d => {
            const vA = d.vendaClass === 'A', eA = d.estoqClass === 'A';
            if (vA && eA) AA++;
            else if (vA && !eA) AC++;
            else if (!vA && eA) CA++;
            else CC++;
        });
        document.getElementById('abcx-cards').innerHTML = `
            <div class="summary-card" style="border-left:3px solid #2ea043;">
                <span class="s-label">✅ EQUILÍBRIO</span>
                <span class="s-value" style="color:#2ea043;">${AA}</span>
                <span class="s-sub">Venda A · Estoque A</span>
            </div>
            <div class="summary-card" style="border-left:3px solid #f85149;">
                <span class="s-label">🚨 RISCO RUPTURA</span>
                <span class="s-value" style="color:#f85149;">${AC}</span>
                <span class="s-sub">Venda A · Estoque baixo</span>
            </div>
            <div class="summary-card" style="border-left:3px solid #d29922;">
                <span class="s-label">⚠️ ESTOQUE PARADO</span>
                <span class="s-value" style="color:#d29922;">${CA}</span>
                <span class="s-sub">Venda baixa · Estoque A</span>
            </div>
            <div class="summary-card">
                <span class="s-label">⚪ NORMAL</span>
                <span class="s-value">${CC}</span>
                <span class="s-sub">Venda C · Estoque C</span>
            </div>`;
    },

    _renderPareto(canvasId, abcData, map, titulo) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width  = canvas.offsetWidth  || 500;
        canvas.height = canvas.offsetHeight || 220;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const W = canvas.width, H = canvas.height;
        const padL = 10, padR = 30, padT = 24, padB = 24;
        const chartW = W - padL - padR, chartH = H - padT - padB;

        const allSorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
        const total = allSorted.reduce((s, [, v]) => s + v, 0);
        const top   = allSorted.slice(0, 40);
        if (!top.length) return;
        const maxV = top[0][1];
        const barW = chartW / top.length;

        // Título
        ctx.fillStyle = 'rgba(230,237,243,0.8)';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(`Curva ABC — ${titulo}`, padL + chartW / 2, 14);

        // Fundo
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(padL, padT, chartW, chartH);

        // Barras coloridas por classe
        top.forEach(([codigo, val], i) => {
            const abc = abcData[codigo];
            const color = abc?.classe === 'A' ? 'rgba(88,166,255,0.85)'
                        : abc?.classe === 'B' ? 'rgba(210,153,34,0.75)'
                        : 'rgba(139,148,158,0.5)';
            const bh = (val / maxV) * chartH;
            ctx.fillStyle = color;
            ctx.fillRect(padL + i * barW + 0.5, padT + chartH - bh, barW - 1, bh);
        });

        // Linha cumulativa (usando todos os itens)
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5;
        let cum = 0;
        top.forEach(([, val], i) => {
            cum += val;
            const x = padL + (i + 0.5) * barW;
            const y = padT + chartH * (1 - cum / total);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Linhas de referência 80% e 95%
        [{ pct: 0.80, label: 'A 80%', color: 'rgba(88,166,255,0.5)' },
         { pct: 0.95, label: 'B 95%', color: 'rgba(210,153,34,0.5)' }].forEach(({ pct, label, color }) => {
            const y = padT + chartH * (1 - pct);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(padL, y); ctx.lineTo(padL + chartW, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.font = '10px Inter';
            ctx.textAlign = 'right';
            ctx.fillText(label, padL + chartW + padR - 2, y - 2);
        });
    },

    _renderScatter() {
        const canvas = document.getElementById('abcx-scatter');
        if (!canvas || !this._data.length) return;
        const ctx = canvas.getContext('2d');
        canvas.width  = canvas.offsetWidth  || 700;
        canvas.height = canvas.offsetHeight || 340;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const W = canvas.width, H = canvas.height;
        const padL = 60, padR = 20, padT = 30, padB = 50;
        const chartW = W - padL - padR, chartH = H - padT - padB;

        // Título
        ctx.fillStyle = 'rgba(230,237,243,0.8)';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('Dispersão: Rank Vendas × Rank Estoque', padL + chartW / 2, 16);

        // Linha de corte dos quadrantes (80%)
        const xCut = padL + chartW * 0.80;
        const yCut = padT + chartH * (1 - 0.80); // y invertido

        // Quadrantes coloridos
        const zones = [
            { x: padL,  y: padT,    w: xCut - padL,          h: yCut - padT,           fill: 'rgba(248,81,73,0.08)',   label: '🚨 Ruptura',    lx: padL + 4,    ly: padT + 14,   align: 'left'  },
            { x: padL,  y: yCut,    w: xCut - padL,           h: chartH - (yCut - padT), fill: 'rgba(46,160,67,0.08)',  label: '✅ Equilíbrio', lx: padL + 4,    ly: padT + chartH - 6, align: 'left'  },
            { x: xCut,  y: padT,    w: chartW - (xCut - padL), h: yCut - padT,           fill: 'rgba(139,148,158,0.05)', label: '⚪ Normal',   lx: padL + chartW - 4, ly: padT + 14,  align: 'right' },
            { x: xCut,  y: yCut,    w: chartW - (xCut - padL), h: chartH - (yCut - padT), fill: 'rgba(210,153,34,0.08)', label: '⚠️ Parado',  lx: padL + chartW - 4, ly: padT + chartH - 6, align: 'right' },
        ];
        zones.forEach(z => {
            ctx.fillStyle = z.fill;
            ctx.fillRect(z.x, z.y, z.w, z.h);
            ctx.fillStyle = z.fill.replace('0.08', '0.7').replace('0.05', '0.4');
            ctx.font = '11px Inter';
            ctx.textAlign = z.align;
            ctx.fillText(z.label, z.lx, z.ly);
        });

        // Linhas de corte
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(xCut, padT); ctx.lineTo(xCut, padT + chartH);
        ctx.moveTo(padL, yCut); ctx.lineTo(padL + chartW, yCut);
        ctx.stroke();
        ctx.setLineDash([]);

        // Eixos labels
        ctx.fillStyle = 'rgba(139,148,158,0.7)';
        ctx.font = '11px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('← Melhor Venda (A)          Rank Vendas          Pior Venda (C) →', padL + chartW / 2, padT + chartH + 38);
        ctx.save();
        ctx.translate(16, padT + chartH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('← Maior Estoque (A)   Rank Estoque   Menor Estoque (C) →', 0, 0);
        ctx.restore();

        // Pontos
        this._scatterPts = [];
        this._data.forEach(d => {
            const x = padL + (d.vendaCumPct / 100) * chartW;
            const y = padT + chartH * (1 - d.estoqCumPct / 100);
            const color = d.vendaClass === 'A' && d.estoqClass === 'A' ? '#2ea043'
                        : d.vendaClass === 'A'                          ? '#f85149'
                        : d.estoqClass === 'A'                          ? '#d29922'
                        : '#8b949e';
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = color + 'bb';
            ctx.fill();
            this._scatterPts.push({ x, y, ...d });
        });

        // Tooltip handler
        canvas.onmousemove = e => {
            const rect = canvas.getBoundingClientRect();
            const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
            const my = (e.clientY - rect.top)  * (canvas.height / rect.height);
            const tip = document.getElementById('abcx-tip');
            const pt  = this._scatterPts.find(p => Math.hypot(p.x - mx, p.y - my) < 7);
            if (pt) {
                tip.style.display = 'block';
                tip.style.left = (e.clientX - canvas.getBoundingClientRect().left + 12) + 'px';
                tip.style.top  = (e.clientY - canvas.getBoundingClientRect().top  - 10) + 'px';
                tip.innerHTML  = `<strong>${pt.codigo}</strong> — ${pt.descricao}<br>
                    Vendas: <b>${pt.vendasQty.toLocaleString('pt-BR')}</b> (${pt.vendaClass}) &nbsp;
                    Estoque: <b>${pt.estoqQty.toLocaleString('pt-BR')}</b> (${pt.estoqClass})`;
            } else {
                tip.style.display = 'none';
            }
        };
        canvas.onmouseleave = () => { document.getElementById('abcx-tip').style.display = 'none'; };
    }
};

// ====== DASHBOARD: RANKING DE VENDAS ======

const ranking = {
    init() {
        document.getElementById('rank-seg').addEventListener('change',   () => this.render());
        document.getElementById('rank-grupo').addEventListener('change', () => this.render());
    },

    render() {
        if (!vendas.rawData.length) {
            document.getElementById('rank-count').textContent = 'Importe dados de Vendas primeiro';
            return;
        }
        const activeCols = vendas.getActiveCols();
        const seg   = document.getElementById('rank-seg').value;
        const grupo = document.getElementById('rank-grupo').value;

        // Preenche filtro de segmento
        const segs = [...new Set(vendas.rawData.map(r => r.segmento).filter(Boolean))].sort();
        const segEl = document.getElementById('rank-seg');
        const cur = segEl.value;
        segEl.innerHTML = '<option value="">Todos</option>' + segs.map(s => `<option value="${s}">${s}</option>`).join('');
        segEl.value = cur;

        // Tabs de ano
        const tabsEl = document.getElementById('rank-year-tabs');
        tabsEl.innerHTML = vendas.years.map(y =>
            `<button class="year-tab${vendas.selectedYear === y ? ' active' : ''}" onclick="vendas.selectedYear='${y}';ranking.render()">${y}</button>`
        ).join('');

        // Agrega por grupo escolhido
        const map = {};
        vendas.rawData.filter(r => !seg || r.segmento === seg).forEach(r => {
            const key   = r[grupo] || r.codigo;
            const label = grupo === 'descricao' ? (r.descricao || r.codigo) : r.codigo;
            const qtd   = activeCols.reduce((s, c) => s + (r[c.key] || 0), 0);
            if (!map[key]) map[key] = { label, segmento: r.segmento, total: 0 };
            map[key].total += qtd;
        });

        const sorted = Object.values(map).sort((a, b) => b.total - a.total).slice(0, 20);
        document.getElementById('rank-count').textContent = `Top ${sorted.length} de ${Object.keys(map).length}`;
        this.drawChart(sorted);
    },

    drawChart(items) {
        const canvas = document.getElementById('rank-chart');
        if (!canvas || !items.length) return;

        const rowH = 38, padL = 200, padR = 90, padT = 10, padB = 10;
        const w = canvas.width  = canvas.offsetWidth || 800;
        const h = canvas.height = items.length * rowH + padT + padB;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const max  = items[0].total || 1;
        const barW = w - padL - padR;

        items.forEach((item, i) => {
            const y  = padT + i * rowH;
            const bw = Math.max((item.total / max) * barW, 2);

            const grad = ctx.createLinearGradient(padL, 0, padL + bw, 0);
            grad.addColorStop(0, 'rgba(88,166,255,0.9)');
            grad.addColorStop(1, 'rgba(88,166,255,0.3)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            const r2 = 4, bx = padL, by = y + 5, bh = rowH - 10;
            ctx.moveTo(bx + r2, by);
            ctx.lineTo(bx + bw - r2, by);
            ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r2);
            ctx.lineTo(bx + bw, by + bh - r2);
            ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r2, by + bh);
            ctx.lineTo(bx, by + bh);
            ctx.lineTo(bx, by);
            ctx.closePath();
            ctx.fill();

            // Rank number
            ctx.fillStyle = 'rgba(88,166,255,0.5)';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'right';
            ctx.fillText(`#${i + 1}`, padL - 110, y + rowH / 2 + 4);

            // Label
            ctx.fillStyle = 'rgba(230,237,243,0.85)';
            ctx.font = '11px Inter';
            ctx.textAlign = 'right';
            const lbl = item.label.length > 22 ? item.label.substring(0, 22) + '…' : item.label;
            ctx.fillText(lbl, padL - 10, y + rowH / 2 + 4);

            // Value
            ctx.fillStyle = 'rgba(230,237,243,0.9)';
            ctx.font = 'bold 11px Inter';
            ctx.textAlign = 'left';
            ctx.fillText(item.total.toLocaleString('pt-BR'), padL + bw + 8, y + rowH / 2 + 4);
        });
    }
};

// ====== DASHBOARD: VENDAS × ESTOQUE ======

const vxe = {
    init() {
        document.getElementById('vxe-seg').addEventListener('change',    () => this.render());
        document.getElementById('vxe-status').addEventListener('change', () => this.render());
    },

    render() {
        if (!vendas.rawData.length) {
            document.getElementById('vxe-count').textContent = 'Importe dados de Vendas primeiro';
            return;
        }

        const activeCols = vendas.getActiveCols();
        const seg    = document.getElementById('vxe-seg').value;
        const status = document.getElementById('vxe-status').value;

        // Preenche filtro de segmento
        const segs = [...new Set(vendas.rawData.map(r => r.segmento).filter(Boolean))].sort();
        const segEl = document.getElementById('vxe-seg');
        const cur = segEl.value;
        segEl.innerHTML = '<option value="">Todos</option>' + segs.map(s => `<option value="${s}">${s}</option>`).join('');
        segEl.value = cur;

        // Mapa de estoque por código
        const estMap = {};
        estoque.rawData.forEach(r => { estMap[r.codigo] = Number(r.quantidade) || 0; });

        const rows = vendas.rawData
            .filter(r => !seg || r.segmento === seg)
            .map(r => {
                const vendQtd = activeCols.reduce((s, c) => s + (r[c.key] || 0), 0);
                const estQtd  = estMap[r.codigo] ?? null;
                let st = 'sem-dados';
                if (estQtd !== null) {
                    if (estQtd === 0)                                st = 'zero';
                    else if (vendQtd > 0 && estQtd / vendQtd < 0.2) st = 'baixo';
                    else                                              st = 'ok';
                }
                return { ...r, vendQtd, estQtd, st };
            })
            .filter(r => !status || r.st === status)
            .sort((a, b) => {
                const order = { zero: 0, baixo: 1, ok: 2, 'sem-dados': 3 };
                return (order[a.st] ?? 9) - (order[b.st] ?? 9) || b.vendQtd - a.vendQtd;
            });

        document.getElementById('vxe-count').textContent = `${rows.length.toLocaleString('pt-BR')} itens`;

        const labels = { ok: 'OK', baixo: 'BAIXO', zero: 'SEM ESTOQUE', 'sem-dados': '—' };
        const classes = { ok: 'vxe-ok', baixo: 'vxe-baixo', zero: 'vxe-zero', 'sem-dados': 'vxe-nd' };

        document.querySelector('#vxe-table tbody').innerHTML = rows.slice(0, 500).map(r => `
            <tr>
                <td class="td-code">${r.codigo}</td>
                <td class="td-desc">${r.descricao}</td>
                <td><span class="seg-badge">${r.segmento}</span></td>
                <td class="td-center">${r.tamanho}</td>
                <td class="td-qtd">${r.vendQtd.toLocaleString('pt-BR')}</td>
                <td class="td-qtd">${r.estQtd !== null ? r.estQtd.toLocaleString('pt-BR') : '—'}</td>
                <td class="td-center"><span class="vxe-badge ${classes[r.st]}">${labels[r.st]}</span></td>
            </tr>`).join('');
    }
};
