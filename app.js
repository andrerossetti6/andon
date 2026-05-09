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
                     segmento: r.segmento, tamanho: r.tamanho, meses,
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
    }
};

// ══════════════════════════════════════════════════════════════
// BOOTSTRAP — verifica auth antes de tudo
// ══════════════════════════════════════════════════════════════
async function bootstrap() {
    const loginView = document.getElementById('view-login');
    const appView   = document.getElementById('app');

    if (auth.estaLogado()) {
        const ok = await auth.verificar();
        if (ok) {
            mostrarApp();
            return;
        }
        auth.sair();
    }

    // Mostra tela de login
    loginView.style.display = 'flex';
    appView.style.display   = 'none';

    document.getElementById('login-form').addEventListener('submit', async e => {
        e.preventDefault();
        const btn   = document.getElementById('login-submit');
        const erro  = document.getElementById('login-erro');
        const email = document.getElementById('login-email').value;
        const senha = document.getElementById('login-senha').value;

        btn.textContent = 'Entrando...';
        btn.disabled = true;
        erro.style.display = 'none';

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, senha })
            });
            const data = await res.json();

            if (!res.ok) {
                erro.textContent = data.erro || 'Erro ao entrar';
                erro.style.display = 'block';
                btn.textContent = 'Entrar';
                btn.disabled = false;
                return;
            }

            auth.salvar(data.token, data.usuario);
            mostrarApp();
        } catch {
            erro.textContent = 'Erro de conexão com o servidor';
            erro.style.display = 'block';
            btn.textContent = 'Entrar';
            btn.disabled = false;
        }
    });
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
    ranking.init();
    vxe.init();
    abc.init();
    dist.init();
    vendas.carregarHistorico().then(() => estoque.carregarHistorico());
}

document.addEventListener('DOMContentLoaded', bootstrap);

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

    // Tabela de tamanhos
    document.getElementById('detail-tbody').innerHTML = variants.map(r => {
        const vendQtd = activeCols.reduce((s, c) => s + (r[c.key] || 0), 0);
        const estQtd  = estMap[r.codigo] ?? null;
        let st, stCls;
        if (estQtd === null)   { st = '—';           stCls = 'vxe-nd'; }
        else if (estQtd === 0) { st = 'SEM ESTOQUE'; stCls = 'vxe-zero'; }
        else if (vendQtd > 0 && estQtd / vendQtd < 0.2) { st = 'BAIXO'; stCls = 'vxe-baixo'; }
        else                   { st = 'OK';          stCls = 'vxe-ok'; }
        return `<tr>
            <td class="td-center"><strong>${r.tamanho}</strong></td>
            <td class="td-right">${vendQtd.toLocaleString('pt-BR')}</td>
            <td class="td-right">${estQtd !== null ? estQtd.toLocaleString('pt-BR') : '—'}</td>
            <td class="td-center"><span class="vxe-badge ${stCls}">${st}</span></td>
        </tr>`;
    }).join('');

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

function navigateTo(viewName) {
    ['dashboard','vendas','estoque','ranking','vxe','abc','dist'].forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.style.display = v === viewName ? 'flex' : 'none';
    });

    document.querySelectorAll('.nav-section li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('.sub-menu li').forEach(li => li.classList.remove('sub-active'));

    const navMap = {
        vendas: 'nav-analise', estoque: 'nav-analise',
        ranking: 'nav-ranking', vxe: 'nav-vxe', dashboard: 'nav-analise',
        abc: 'nav-abc', dist: 'nav-dist'
    };
    const navEl = document.getElementById(navMap[viewName]);
    if (navEl) navEl.classList.add('active');

    if (viewName === 'vendas') {
        document.querySelector('[data-view="vendas"]').classList.add('sub-active');
        setTimeout(() => { if (vendas.rawData.length) vendas.render(); }, 50);
    } else if (viewName === 'estoque') {
        document.querySelector('[data-view="estoque"]').classList.add('sub-active');
    } else if (viewName === 'ranking') {
        setTimeout(() => ranking.render(), 50);
    } else if (viewName === 'vxe') {
        vxe.render();
    } else if (viewName === 'abc') {
        setTimeout(() => abc.render(), 50);
    } else if (viewName === 'dist') {
        setTimeout(() => dist.render(), 50);
    }
}

// ====== VENDAS MODULE ======

const MONTHS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

const vendas = {
    rawData: [],
    filtered: [],
    monthCols: [],      // [{ key, abbr, year, label, originalCol }]
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
        ['filter-segmento', 'filter-modelo', 'filter-tamanho', 'filter-descricao'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.applyFilters());
        });
        document.getElementById('search-input').addEventListener('input', () => this.applyFilters());
        document.getElementById('filter-year').addEventListener('change', e => {
            this.selectedYear = e.target.value;
            this.render();
        });
        document.getElementById('clear-filters-btn').addEventListener('click', () => {
            document.getElementById('filter-segmento').value  = '';
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


        this.rawData = rawRows.map((row, i) => {
            const mData = {};
            this.monthCols.forEach(mc => {
                const val = row[mc.originalCol];
                mData[mc.key] = val !== undefined && val !== null ? toNum(val) : 0;
            });

            return {
                _id: i,
                codigo:    get(row, 'codigo'),
                descricao: get(row, 'descricao'),
                modelo:    get(row, 'modelo'),
                segmento:  get(row, 'segmento'),
                tamanho:   get(row, 'tamanho'),
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

        this.rawData  = rows.map((r, i) => ({
            _id: i, codigo: r.codigo || '', descricao: r.descricao || '',
            modelo: r.modelo || '', segmento: r.segmento || '', tamanho: r.tamanho || '',
            ...(r.meses || {}),
            quantidade: Number(r.quantidade) || 0, valor: Number(r.valor) || 0
        }));
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
            modulo === 'estoque' ? estoque.salvar('substituir') : this.salvarImportacao('substituir');
        });
        document.getElementById('btn-nova-imp').addEventListener('click', () => {
            const modulo = document.getElementById('import-modal').dataset.modulo;
            modulo === 'estoque' ? estoque.salvar('nova') : this.salvarImportacao('nova');
        });
        document.getElementById('btn-cancelar-imp').addEventListener('click', () => {
            document.getElementById('import-modal').style.display = 'none';
        });
    },

    populateFilters() {
        const unique = key => [...new Set(this.rawData.map(r => r[key]).filter(Boolean))].sort();
        this.fillSelect('filter-segmento', unique('segmento'));
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

    fillSelect(id, options) {
        const sel = document.getElementById(id);
        sel.innerHTML = '<option value="">Todos</option>' +
            options.map(o => `<option value="${o}">${o}</option>`).join('');
    },

    fillSelectLabel(id, options, label) {
        const sel = document.getElementById(id);
        sel.innerHTML = `<option value="">${label}</option>` +
            options.map(o => `<option value="${o}">${o}</option>`).join('');
    },

    applyFilters() {
        const seg = document.getElementById('filter-segmento').value;
        const mod = document.getElementById('filter-modelo').value;
        const tam  = document.getElementById('filter-tamanho').value;
        const desc = document.getElementById('filter-descricao').value;
        const q    = document.getElementById('search-input').value.toLowerCase().trim();

        this.filtered = this.rawData.filter(r => {
            // Segmento: traz TODOS os itens que pertencem ao segmento selecionado
            if (seg  && r.segmento  !== seg)  return false;
            if (mod  && r.modelo    !== mod)  return false;
            if (tam  && r.tamanho   !== tam)  return false;
            // Descrição: traz todas as peças com aquela descrição (todos os tamanhos)
            if (desc && r.descricao !== desc) return false;
            if (q    && !r.codigo.toLowerCase().includes(q)) return false;
            return true;
        });

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
        table.querySelector('thead tr').innerHTML = `
            <th>CÓDIGO</th>
            <th>DESCRIÇÃO</th>
            <th>MODELO</th>
            <th>SEGMENTO</th>
            <th class="td-center">TAM.</th>
            ${cols.map(c => {
                const sel = this.selectedMonth === c.abbr;
                return `<th class="th-month${sel ? ' th-month-sel' : ''}">${c.label.toUpperCase()}</th>`;
            }).join('')}
            <th class="td-right">QTDE</th>
            <th class="td-right">VALOR R$</th>
        `;

        // Filtra linhas pelo mês selecionado (só mostra quem tem valor naquele mês)
        let displayRows = this.filtered;
        if (this.selectedMonth) {
            const mCols = cols.filter(c => c.abbr === this.selectedMonth);
            displayRows = displayRows.filter(r => mCols.some(c => (r[c.key] || 0) > 0));
        }

        const rows = displayRows.slice(0, 500);
        table.querySelector('tbody').innerHTML = rows.map(r => `
            <tr onclick="abrirDetalhe('${r.descricao.replace(/'/g, "\\'")}','${r.segmento}')">
                <td class="td-code">${r.codigo}</td>
                <td class="td-desc">${r.descricao}</td>
                <td>${r.modelo}</td>
                <td><span class="seg-badge">${r.segmento}</span></td>
                <td class="td-center">${r.tamanho}</td>
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
        document.getElementById('est-clear').addEventListener('click', () => {
            document.getElementById('est-search').value = '';
            this.aplicarFiltros();
        });
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
        this.render();
        this.perguntarESalvar(this._nomeArquivo);
    },

    aplicarFiltros() {
        const q = document.getElementById('est-search').value.toLowerCase().trim();
        this.filtered = this.rawData.filter(r => {
            if (!q) return true;
            if (r.codigo.toLowerCase().includes(q)) return true;
            return Object.values(r.dados || {}).some(v => String(v).toLowerCase().includes(q));
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

        this.rawData = rows.map((r, i) => ({
            _id:        i,
            codigo:     r.codigo,
            quantidade: Number(r.quantidade) || 0,
            dados:      r.dados || { codigo: r.codigo }
        }));
        this.filtered = [...this.rawData];
        this.mostrarDados();
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

// ====== DASHBOARD: CURVA ABC ======

const abc = {
    selectedYear:  'all',
    selectedMonth: '',
    selectedGrupo: 'descricao',

    init() {
        document.getElementById('abc-year-tabs').addEventListener('click', e => {
            const btn = e.target.closest('.year-tab');
            if (!btn) return;
            document.querySelectorAll('#abc-year-tabs .year-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.selectedYear  = btn.dataset.year;
            this.selectedMonth = '';
            document.getElementById('abc-month-sel').value = '';
            this.render();
        });
        document.getElementById('abc-month-sel').addEventListener('change', e => {
            this.selectedMonth = e.target.value;
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
        const allCols    = this.selectedYear === 'all' ? vendas.monthCols : vendas.monthCols.filter(c => c.year === this.selectedYear);
        const activeCols = this.selectedMonth ? allCols.filter(c => c.abbr === this.selectedMonth) : allCols;

        // Month selector
        const monthSel    = document.getElementById('abc-month-sel');
        const uniqueAbbrs = [...new Set(allCols.map(c => c.abbr))];
        monthSel.innerHTML = '<option value="">Todos</option>' +
            MONTHS.filter(m => uniqueAbbrs.includes(m))
                  .map(m => `<option value="${m}" ${this.selectedMonth === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`)
                  .join('');

        // Aggregate vendas by grupo
        const map = {};
        vendas.rawData.forEach(r => {
            const key = this.selectedGrupo === 'descricao' ? r.descricao : r.codigo;
            const qtd = activeCols.reduce((s, c) => s + (r[c.key] || 0), 0);
            if (!map[key]) map[key] = { label: key, quantidade: 0 };
            map[key].quantidade += qtd;
        });

        const sorted = Object.values(map).filter(i => i.quantidade > 0).sort((a, b) => b.quantidade - a.quantidade);
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

        setTimeout(() => this.drawChart(items), 30);
        this.renderTable(items);
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
        const lastY = padT;
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
    },

    renderTable(items) {
        const isDesc = this.selectedGrupo === 'descricao';
        document.querySelector('#abc-table thead tr').innerHTML = `
            <th style="width:40px;">#</th>
            <th colspan="2">${isDesc ? 'DESCRIÇÃO' : 'CÓDIGO'}</th>
            <th class="td-right">VENDAS</th>
            <th class="td-right">% TOTAL</th>
            <th class="td-right">% ACUM.</th>
            <th class="td-center" style="width:80px;">CLASSE</th>
        `;
        document.querySelector('#abc-table tbody').innerHTML = items.map((r, i) => {
            const cls     = `abc-${r.classe.toLowerCase()}`;
            const cellCls = isDesc ? 'td-desc' : 'td-code';
            return `<tr>
                <td class="td-dim td-center">${i + 1}</td>
                <td class="${cellCls}" colspan="2">${r.label}</td>
                <td class="td-qtd">${r.quantidade.toLocaleString('pt-BR')}</td>
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
        tabsEl.innerHTML = vendas.years.map((y, i) =>
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
