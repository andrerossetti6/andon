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
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('app').style.display = 'flex';

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

function navigateTo(viewName) {
    document.getElementById('view-dashboard').style.display = viewName === 'dashboard' ? 'flex' : 'none';
    document.getElementById('view-vendas').style.display   = viewName === 'vendas'    ? 'flex' : 'none';

    // Sidebar active state
    document.querySelectorAll('.nav-section li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('.sub-menu li').forEach(li => li.classList.remove('sub-active'));

    if (viewName === 'vendas') {
        document.getElementById('nav-analise').classList.add('active');
        document.querySelector('[data-view="vendas"]').classList.add('sub-active');
        // Re-draw chart in case canvas was hidden on first render
        setTimeout(() => vendas.renderChart(), 50);
    } else {
        document.getElementById('nav-analise').classList.add('active');
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

    init() {
        this.setupDropZone();
        this.setupFileInput();
        this.setupFilters();
        this.setupYearTabs();
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
            this.selectedYear = btn.dataset.year;
            this.render();
        });
    },

    setupFilters() {
        ['filter-segmento', 'filter-modelo', 'filter-tamanho'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.applyFilters());
        });
        document.getElementById('search-input').addEventListener('input', () => this.applyFilters());
        document.getElementById('filter-year').addEventListener('change', e => {
            this.selectedYear = e.target.value;
            this.render();
        });
        document.getElementById('clear-filters-btn').addEventListener('click', () => {
            document.getElementById('filter-segmento').value = '';
            document.getElementById('filter-modelo').value = '';
            document.getElementById('filter-tamanho').value = '';
            document.getElementById('search-input').value = '';
            document.getElementById('filter-year').value = 'all';
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
            jan:'jan', janeiro:'jan',
            fev:'fev', fevereiro:'fev',
            mar:'mar', marco:'mar',
            abr:'abr', abril:'abr',
            mai:'mai', maio:'mai',
            jun:'jun', junho:'jun',
            jul:'jul', julho:'jul',
            ago:'ago', agosto:'ago',
            set:'set', setembro:'set',
            out:'out', outubro:'out',
            nov:'nov', novembro:'nov',
            dez:'dez', dezembro:'dez'
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

        // Diagnóstico: mostra o que foi e o que não foi reconhecido
        const recognizedCols = new Set(this.monthCols.map(c => c.originalCol));
        const unrecognized   = allHeaders.filter(h => !recognizedCols.has(h));
        this.showDiagnostic(allHeaders, this.monthCols, unrecognized);

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

        // Salva no banco em background
        api.salvarImport(this._nomeArquivo || 'importacao', this.rawData, this.monthCols)
            .then(res => { if (res?.ok) console.log(`✓ Salvo no banco: ${res.total} linhas`); })
            .catch(() => {});
    },

    populateFilters() {
        const unique = key => [...new Set(this.rawData.map(r => r[key]).filter(Boolean))].sort();
        this.fillSelect('filter-segmento', unique('segmento'));
        this.fillSelect('filter-modelo',   unique('modelo'));
        this.fillSelect('filter-tamanho',  unique('tamanho'));

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

    applyFilters() {
        const seg = document.getElementById('filter-segmento').value;
        const mod = document.getElementById('filter-modelo').value;
        const tam = document.getElementById('filter-tamanho').value;
        const q   = document.getElementById('search-input').value.toLowerCase().trim();

        this.filtered = this.rawData.filter(r => {
            if (seg && r.segmento !== seg) return false;
            if (mod && r.modelo   !== mod) return false;
            if (tam && r.tamanho  !== tam) return false;
            if (q && !r.codigo.toLowerCase().includes(q) &&
                     !r.descricao.toLowerCase().includes(q)) return false;
            return true;
        });

        this.render();
    },

    showDiagnostic(allHeaders, matched, unrecognized) {
        const panel = document.getElementById('diag-panel');

        // Filtra fora os campos de dados esperados — só mostra o que realmente é inesperado
        const KNOWN = ['codigo','descricao','modelo','segmento','tamanho','quantidade','qtd','qty','qtde','valor','valorrs','valortotal','valorr'];
        const unexpected = unrecognized.filter(h => !KNOWN.includes(this.normalizeKey(h)));

        if (matched.length === 0) {
            panel.innerHTML = `
                <span class="diag-warn">⚠ Nenhuma coluna de mês reconhecida.</span>
                <span class="diag-cols">Colunas no arquivo: ${allHeaders.map(h => `<code>${h}</code>`).join(' ')}</span>
            `;
            panel.className = 'diag-panel diag-error';
        } else {
            const years  = [...new Set(matched.map(c => c.year).filter(Boolean))];
            const yearTxt = years.length ? ` • Anos: <strong>${years.join(', ')}</strong>` : '';
            panel.innerHTML = `
                <span class="diag-ok">✓ ${matched.length} colunas de mês detectadas${yearTxt}</span>
                <span class="diag-cols">${matched.map(c => `<code>${c.label}</code>`).join(' ')}</span>
                ${unexpected.length ? `<span class="diag-rest">Colunas não reconhecidas: ${unexpected.map(h=>`<code>${h}</code>`).join(' ')}</span>` : ''}
            `;
            panel.className = 'diag-panel diag-ok';
        }
        panel.style.display = 'flex';
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
        const totalQtd   = this.filtered.reduce((s, r) => s + r.quantidade, 0);
        const totalValor = this.filtered.reduce((s, r) => s + r.valor, 0);

        document.getElementById('summary-itens').textContent =
            this.filtered.length.toLocaleString('pt-BR');
        document.getElementById('summary-qtd').textContent =
            totalQtd.toLocaleString('pt-BR');
        document.getElementById('summary-valor').textContent =
            totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
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
        document.getElementById('chart-title').textContent =
            `QUANTIDADE POR MÊS${yearLbl ? ' • ' + yearLbl : ''}`;
        document.querySelectorAll('.year-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.year === this.selectedYear);
        });

        const max  = Math.max(...monthTotals) || 1;
        const padX = 20, padY = 24;
        const barW = (w - padX * 2) / activeAbbrs.length;

        monthTotals.forEach((val, i) => {
            const x    = padX + i * barW;
            const barH = Math.max(((h - padY * 2) * val) / max, val > 0 ? 2 : 0);
            const y    = h - padY - barH;

            const grad = ctx.createLinearGradient(0, y, 0, h - padY);
            grad.addColorStop(0, 'rgba(88,166,255,0.85)');
            grad.addColorStop(1, 'rgba(88,166,255,0.2)');
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

            ctx.fillStyle = 'rgba(139,148,158,0.65)';
            ctx.font = '9px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(activeAbbrs[i].charAt(0).toUpperCase() + activeAbbrs[i].slice(1), x + barW / 2, h - 6);

            if (val > 0) {
                ctx.fillStyle = 'rgba(230,237,243,0.7)';
                ctx.font = '8px Inter';
                ctx.fillText(val.toLocaleString('pt-BR'), x + barW / 2, y - 4);
            }
        });
    },

    renderTable() {
        const cols  = this.getActiveCols();
        const table = document.getElementById('vendas-table');

        // Cabeçalho dinâmico
        table.querySelector('thead tr').innerHTML = `
            <th>CÓDIGO</th>
            <th>DESCRIÇÃO</th>
            <th>MODELO</th>
            <th>SEGMENTO</th>
            <th class="td-center">TAM.</th>
            ${cols.map(c => `<th class="th-month">${c.label.toUpperCase()}</th>`).join('')}
            <th class="td-right">QTDE</th>
            <th class="td-right">VALOR R$</th>
        `;

        const rows  = this.filtered.slice(0, 500);
        table.querySelector('tbody').innerHTML = rows.map(r => `
            <tr>
                <td class="td-code">${r.codigo}</td>
                <td class="td-desc">${r.descricao}</td>
                <td>${r.modelo}</td>
                <td><span class="seg-badge">${r.segmento}</span></td>
                <td class="td-center">${r.tamanho}</td>
                ${cols.map(c => {
                    const v = r[c.key];
                    return `<td class="td-month">${v ? v.toLocaleString('pt-BR') : '<span style="opacity:.3">—</span>'}</td>`;
                }).join('')}
                <td class="td-qtd">${r.quantidade.toLocaleString('pt-BR')}</td>
                <td class="td-valor">${r.valor ? 'R$ ' + r.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '<span style="opacity:.3">—</span>'}</td>
            </tr>
        `).join('');

        const total  = this.filtered.length;
        const suffix = total > 500 ? ' (exibindo 500)' : '';
        document.getElementById('table-count').textContent =
            `${total.toLocaleString('pt-BR')} ${total === 1 ? 'item' : 'itens'}${suffix}`;
    }
};
