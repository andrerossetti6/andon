// Lógica Central do Dashboard SIN1

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

    async put(url, body) {
        const r = await fetch(url, { method: 'PUT', headers: auth.cabecalho(), body: JSON.stringify(body) });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
    },

    async delete(url) {
        const r = await fetch(url, { method: 'DELETE', headers: auth.cabecalho() });
        if (r.status === 401) { auth.sair(); return null; }
        return r.json();
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
    banco.init();
    cliente.init();
    processosGerenciamento.init();
    capacidade.init();
    estoque.init();
    op.init();
    costura.init();
    pesquisa.init();
    vxe.init();
    abc.init();
    abcMicro.init();
    abcEstoque.init();
    disponibilidade.init().catch(() => {});
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
        results.forEach((r, i) => {
            if (r.status === 'rejected') console.warn('carregarHistorico[' + i + '] falhou:', r.reason);
        });
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
    if (!container) return;
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
    if (!container) return;
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
    if (!canvases.length) return;
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
            <td class="td-code">${r.codigo}</td>
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

function navigateTo(viewName) {
    fecharDetalhe();
    fecharDetalheVxe();
    ['dashboard','vendas','cliente','banco','estoque','op','costura','calendario','processos','capacidade','pesquisa','vxe','abc','abc-micro','abc-estoque'].forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.style.display = v === viewName ? 'flex' : 'none';
    });

    document.querySelectorAll('.nav-section li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('.sub-menu li').forEach(li => li.classList.remove('sub-active'));

    const navMap = {
        vendas:        'nav-analise',
        cliente:       'nav-analise',
        banco:         'nav-analise',
        estoque:       'nav-analise',
        op:            'nav-analise',
        costura:       'nav-analise',
        calendario:    'nav-arq',
        processos:     'nav-arq',
        capacidade:    'nav-arq',
        pesquisa:      'nav-pesquisa',
        vxe:           'nav-vxe',
        dashboard:     'nav-analise',
        abc:           'nav-abc-cruzada',
        'abc-micro':   'nav-abc-cruzada',
        'abc-estoque': 'nav-abc-cruzada'
    };
    const navEl = document.getElementById(navMap[viewName]);
    if (navEl) navEl.classList.add('active');

    if (viewName === 'vendas') {
        document.querySelector('[data-view="vendas"]')?.classList.add('sub-active');
        setTimeout(() => { if (vendas.rawData.length) vendas.render(); }, 50);
    } else if (viewName === 'cliente') {
        document.querySelector('[data-view="cliente"]')?.classList.add('sub-active');
    } else if (viewName === 'banco') {
        document.querySelector('[data-view="banco"]')?.classList.add('sub-active');
    } else if (viewName === 'estoque') {
        document.querySelector('[data-view="estoque"]')?.classList.add('sub-active');
    } else if (viewName === 'op') {
        document.querySelector('[data-view="op"]')?.classList.add('sub-active');
    } else if (viewName === 'costura') {
        document.querySelector('[data-view="costura"]')?.classList.add('sub-active');
    } else if (viewName === 'calendario') {
        document.querySelector('[data-view="calendario"]')?.classList.add('sub-active');
        disponibilidade.abrirAba(disponibilidade._abaAtiva);
    } else if (viewName === 'processos') {
        document.querySelector('[data-view="processos"]')?.classList.add('sub-active');
        processosGerenciamento.voltarLista();
        processosGerenciamento.carregarProcessos();
    } else if (viewName === 'capacidade') {
        document.querySelector('[data-view="capacidade"]')?.classList.add('sub-active');
    } else if (viewName === 'pesquisa') {
        document.getElementById('nav-pesquisa')?.classList.add('active');
        pesquisa.render();
    } else if (viewName === 'vxe') {
        vxe.render();
    } else if (viewName === 'abc') {
        document.querySelector('[data-view="abc"]')?.classList.add('sub-active');
        setTimeout(() => abc.render(), 50);
    } else if (viewName === 'abc-micro') {
        document.querySelector('[data-view="abc-micro"]')?.classList.add('sub-active');
        setTimeout(() => abcMicro.render(), 50);
    } else if (viewName === 'abc-estoque') {
        document.querySelector('[data-view="abc-estoque"]')?.classList.add('sub-active');
        setTimeout(() => abcEstoque.render(), 50);
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
            document.getElementById('import-modal').dataset.modulo = 'vendas';
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

    async salvarManual() {
        if (!this.rawData.length) return;
        const btn = document.getElementById('btn-salvar-vendas');
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
        try {
            const lista = await api.listarImportacoes();
            if (lista?.length) {
                document.getElementById('modal-arquivo').textContent = this._nomeArquivoAtual || 'importacao';
                document.getElementById('import-modal').dataset.modulo = 'vendas';
                document.getElementById('import-modal').style.display = 'flex';
            } else {
                await this.salvarImportacao('nova');
            }
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
        const rows = this.filtered.slice(0, 2000);
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
        document.getElementById('op-count').textContent     = `${filt.toLocaleString('pt-BR')} ordens${filt > 2000 ? ' (exibindo 2000)' : ''}`;

        const table = document.getElementById('op-table');
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
        const toNum  = v => parseFloat(String(v ?? '0').replace(/\./g,'').replace(',','.')) || 0;

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

        const LABELS = {
            [this._colCodigo]:   'CÓDIGO',
            [this._colDesc]:     'DESCRIÇÃO',
            [this._colData]:     'DATA',
            [this._colCliente]:  'CLIENTE',
            [this._colQtd]:      'QUANTIDADE',
            [this._colValUnit]:  'VALOR UNIT.',
            [this._colValTotal]: 'VALOR TOTAL',
        };

        const table = document.getElementById('cliente-table');
        table.querySelector('thead tr').innerHTML =
            this.colunas.map(h => `<th>${LABELS[h] || h.toUpperCase()}</th>`).join('');

        table.querySelector('tbody').innerHTML = this.filtered.slice(0, 2000).map(r => {
            const cells = this.colunas.map(h => {
                const v = r.dados?.[h];
                const empty = '<span style="opacity:.3">—</span>';
                if (v === undefined || v === '') return `<td>${empty}</td>`;
                if (h === this._colCodigo)
                    return `<td><span style="font-family:monospace;color:#26c6da;font-weight:600;">${v}</span></td>`;
                if (h === this._colQtd)
                    return `<td style="text-align:right;font-weight:600;">${toNum(v).toLocaleString('pt-BR')}</td>`;
                if (h === this._colValUnit)
                    return `<td style="text-align:right;color:#8b949e;">R$ ${toNum(v).toLocaleString('pt-BR',{minimumFractionDigits:3})}</td>`;
                if (h === this._colValTotal)
                    return `<td style="text-align:right;color:#26a69a;font-weight:600;">R$ ${toNum(v).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>`;
                if (h === this._colCliente)
                    return `<td style="font-weight:500;">${v}</td>`;
                return `<td>${v}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
    },

    async perguntarESalvar(nome) {
        this._nomeArquivo = nome;
        const lista = await api.get('/api/importacoes-cliente');
        const temSalvo = lista?.length > 0 || !!this._currentId;
        if (!temSalvo) {
            await this.salvar('nova');
        } else {
            document.getElementById('modal-arquivo').textContent = nome;
            document.getElementById('import-modal').dataset.modulo = 'cliente';
            document.getElementById('import-modal').style.display = 'flex';
        }
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
            } else {
                alert('Erro ao salvar. Verifique se as tabelas importacoes_cliente e dados_cliente foram criadas no Supabase.');
            }
        } catch(e) {
            alert('Erro de conexão ao salvar importação.');
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
        if (lista?.length && !this._currentId) await this.carregarImportacao(lista[0].id);
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
                    <span class="hi-nome">${imp.nome_arquivo}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} clientes</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();cliente.excluir('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
        list.style.display = 'flex';
        const chev = document.getElementById('chevron-cliente');
        if (chev) chev.style.transform = 'rotate(90deg)';
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
            zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
            zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) this.handleFile(f); });
            const inp = document.getElementById(`file-input-${id}`);
            inp.addEventListener('change', e => { const f = e.target.files[0]; if (f) this.handleFile(f); inp.value = ''; });
            document.getElementById(`${id}-search`).addEventListener('input', () => this.aplicarFiltros());
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

        normalizeKey(key) { return String(key).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,''); },

        handleFile(file) {
            this._nomeArquivo = file.name;
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'csv') Papa.parse(file, { header:true, skipEmptyLines:true, complete: r => this.processData(r.data) });
            else if (['xls','xlsx'].includes(ext)) {
                const reader = new FileReader();
                reader.onload = e => { const wb = XLSX.read(e.target.result,{type:'array'}); this.processData(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})); };
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
            const total = this.rawData.length, filt = this.filtered.length;
            const qtd = this._colQtd ? this.filtered.reduce((s,r) => s+(parseFloat(String(r.dados?.[this._colQtd]??'0').replace(',','.'))||0),0) : 0;
            document.getElementById(`${id}-total`).textContent     = total.toLocaleString('pt-BR');
            document.getElementById(`${id}-qtd`).textContent       = this._colQtd ? qtd.toLocaleString('pt-BR') : '—';
            document.getElementById(`${id}-filtrados`).textContent = filt.toLocaleString('pt-BR');
            document.getElementById(`${id}-count`).textContent     = `${filt.toLocaleString('pt-BR')} registros${filt>2000?' (exibindo 2000)':''}`;
            const table = document.getElementById(`${id}-table`);
            table.querySelector('thead tr').innerHTML = this.colunas.map(h=>`<th>${h.toUpperCase()}</th>`).join('');
            table.querySelector('tbody').innerHTML = this.filtered.slice(0,2000).map(r => {
                const cells = this.colunas.map(h => { const v=r.dados?.[h]; return `<td>${v!==undefined&&v!==''?v:'<span style="opacity:.3">—</span>'}</td>`; }).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
        },

        async perguntarESalvar(nome) {
            this._nomeArquivo = nome;
            const lista = await api.get(`/api/importacoes-${nomeApi}`);
            if (!lista?.length && !this._currentId) { await this.salvar('nova'); }
            else {
                document.getElementById('modal-arquivo').textContent = nome;
                document.getElementById('import-modal').dataset.modulo = id;
                document.getElementById('import-modal').style.display = 'flex';
            }
        },

        async salvar(modo) {
            document.getElementById('import-modal').style.display = 'none';
            this._setSaving(true);
            try {
                if (modo === 'substituir' && this._currentId) await api.delete(`/api/importacoes-${nomeApi}/${this._currentId}`);
                const res = await api.post(`/api/${nomeApi}/import`, { nomeArquivo: this._nomeArquivo, linhas: this.rawData.map(r=>({dados:r.dados})) });
                if (res?.ok) this._currentId = res.importacaoId;
                else alert(`Erro ao salvar. Verifique se as tabelas importacoes_${nomeApi} e dados_${nomeApi} foram criadas no Supabase.`);
            } catch(e) { alert('Erro de conexão.'); } finally { this._setSaving(false); }
            await this.carregarHistorico();
        },

        _setSaving(v) { const el=document.getElementById(`${id}-saving`); if(el) el.style.display=v?'':'none'; },

        async carregarHistorico() {
            const lista = await api.get(`/api/importacoes-${nomeApi}`);
            this._importacoes = lista || [];
            this.renderHistorico();
            if (lista?.length && !this._currentId) await this.carregarImportacao(lista[0].id);
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
            document.getElementById(`${id}-drop-zone`).style.display = 'none';
            document.getElementById(`${id}-data`).classList.add('visible');
            this.render(); this.renderHistorico();
        },

        renderHistorico() {
            const wrap=document.getElementById(`${id}-history`), list=document.getElementById(`${id}-history-list`);
            if (!this._importacoes?.length) { wrap.style.display='none'; return; }
            wrap.style.display='block';
            list.innerHTML = this._importacoes.map(imp => {
                const d = new Date(imp.criado_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
                const ativo = imp.id === this._currentId;
                return `<div class="hi-item${ativo?' hi-ativo':''}" onclick="${id}.carregarImportacao('${imp.id}')">
                    <span class="hi-dot">${ativo?'●':'○'}</span>
                    <div class="hi-info"><span class="hi-nome">${imp.nome_arquivo}</span><span class="hi-meta">${d} · ${imp.total_linhas} registros</span></div>
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
    },

    // ── FERIADOS ──────────────────────────────────────────────
    async carregarFeriados() {
        const data = await api.get('/api/feriados');
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
                <td style="font-weight:500;">${f.nome}</td>
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
                    <span class="tur-card-nome">${t.nome}</span>
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
        if (!this._processos.length) {
            grid.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';
        grid.innerHTML = this._processos.map(p => `
            <div class="summary-card" style="cursor:pointer;border-left:3px solid var(--indigo-btn);transition:opacity .15s;"
                onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'"
                onclick="processosGerenciamento.abrirProcesso('${p.id}')">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                    <span class="s-label">${p.nome.toUpperCase()}</span>
                    <div style="display:flex;gap:8px;" onclick="event.stopPropagation()">
                        <button onclick="processosGerenciamento.abrirModalProcesso('${p.id}')"
                            style="background:none;border:none;color:#8b949e;cursor:pointer;padding:0;">
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg>
                        </button>
                        <button onclick="processosGerenciamento.excluirProcesso('${p.id}')"
                            style="background:none;border:none;color:#f06292;cursor:pointer;padding:0;font-size:0.85rem;">✕</button>
                    </div>
                </div>
                <div style="font-size:1.5rem;font-weight:700;color:var(--indigo-primary);margin-bottom:4px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:middle;margin-right:4px;"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                    ${p.nome}
                </div>
                ${p.descricao ? `<div class="s-sub" style="margin-top:4px;">${p.descricao}</div>` : ''}
                <div style="margin-top:10px;font-size:0.75rem;color:var(--indigo-btn);">Ver máquinas →</div>
            </div>
        `).join('');
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
            <tr>
                <td style="font-weight:600;color:var(--indigo-primary);">${m.id_maquina || '—'}</td>
                <td>${m.modelo || '—'}</td>
                <td class="td-center">${m.oee != null ? Number(m.oee).toFixed(1) + '%' : '—'}</td>
                <td class="td-center">
                    <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:0.72rem;font-weight:600;
                        background:${statusColor(m.status)}22;color:${statusColor(m.status)};border:1px solid ${statusColor(m.status)}44;">
                        ${m.status || '—'}
                    </span>
                </td>
                <td class="td-center">${m.n_pessoas != null ? m.n_pessoas : '—'}</td>
                <td class="td-center">
                    <div style="display:flex;gap:10px;justify-content:center;align-items:center;">
                        <button onclick="processosGerenciamento.abrirModalMaquina('${m.id}')"
                            title="Editar" style="background:none;border:none;color:#8b949e;cursor:pointer;padding:2px;line-height:1;">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg>
                        </button>
                        <button onclick="processosGerenciamento.excluirMaquina('${m.id}')"
                            title="Excluir" style="background:none;border:none;color:#f06292;cursor:pointer;padding:2px;font-size:1rem;line-height:1;font-weight:600;">✕</button>
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

    _finalizarImport() {
        this._detectCombosCols();
        document.getElementById('banco-drop-zone').style.display = 'none';
        document.getElementById('banco-data').classList.add('visible');
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
        const lista = await api.get('/api/importacoes-banco');
        const temSalvo = lista?.length > 0 || !!this._currentId;
        if (!temSalvo) {
            await this.salvar('nova');
        } else {
            document.getElementById('modal-arquivo').textContent = nome;
            document.getElementById('import-modal').dataset.modulo = 'banco';
            document.getElementById('import-modal').style.display = 'flex';
        }
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
            } else {
                alert('Erro ao salvar. Verifique se as tabelas importacoes_banco e dados_banco foram criadas no Supabase.');
            }
        } catch(e) {
            alert('Erro de conexão ao salvar importação.');
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
        this.renderHistorico();
        if (lista?.length && !this._currentId) await this.carregarImportacao(lista[0].id);
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
                    <span class="hi-nome">${imp.nome_arquivo}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} registros</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();banco.excluir('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
        list.style.display = 'flex';
        const chev = document.getElementById('chevron-banco');
        if (chev) chev.style.transform = 'rotate(90deg)';
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
        const lista = await api.get('/api/importacoes-costura');
        const temSalvo = lista?.length > 0 || !!this._currentId;
        if (!temSalvo) {
            await this.salvar('nova');
        } else {
            document.getElementById('modal-arquivo').textContent = nome;
            document.getElementById('import-modal').dataset.modulo = 'costura';
            document.getElementById('import-modal').style.display = 'flex';
        }
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
            } else {
                alert('Erro ao salvar. Verifique se as tabelas importacoes_costura e dados_costura foram criadas no Supabase.');
            }
        } catch(e) {
            alert('Erro de conexão ao salvar importação.');
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
        this.renderHistorico();
        if (lista?.length && !this._currentId) await this.carregarImportacao(lista[0].id);
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
                    <span class="hi-nome">${imp.nome_arquivo}</span>
                    <span class="hi-meta">${d} · ${imp.total_linhas} registros</span>
                </div>
                <button class="hi-del" onclick="event.stopPropagation();costura.excluir('${imp.id}')" title="Excluir">✕</button>
            </div>`;
        }).join('');
        list.style.display = 'flex';
        const chev = document.getElementById('chevron-costura');
        if (chev) chev.style.transform = 'rotate(90deg)';
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
                ? `onclick="abrirDetalhe('${r.label.replace(/'/g,"\\'")}','${seg.replace(/'/g,"\\'")}'); event.stopPropagation();" style="cursor:pointer;"`
                : '';
            return `<tr ${clickAttr} title="${isDesc ? 'Clique para ver detalhe' : ''}">
                <td class="td-dim td-center">${i + 1}</td>
                <td class="${cellCls}" style="${(isDesc || isMarca) ? 'color:var(--indigo-primary);' : ''}">${r.label}</td>
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

// ====== PESQUISA POR CÓDIGO ======

const pesquisa = {
    _query: '',

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

    _getAbcVendasClasse(codigos) {
        if (!abc._items.length) return null;
        const keys = codigos.map(c => c.toUpperCase());
        // Se agrupado por código, busca direto; se por descrição, cruza via rawData
        if (abc.selectedGrupo === 'codigo') {
            const found = abc._items.filter(i => keys.includes(String(i.label).toUpperCase()));
            if (!found.length) return null;
            // Retorna a melhor classe (A > B > C)
            const order = ['A','B','C'];
            return found.sort((a,b) => order.indexOf(a.classe) - order.indexOf(b.classe))[0].classe;
        } else {
            // Acha as descrições que pertencem a esses códigos
            const descs = new Set(vendas.rawData.filter(r => keys.includes(String(r.codigo||'').toUpperCase())).map(r => r.descricao));
            const found = abc._items.filter(i => descs.has(i.label));
            if (!found.length) return null;
            const order = ['A','B','C'];
            return found.sort((a,b) => order.indexOf(a.classe) - order.indexOf(b.classe))[0].classe;
        }
    },

    _getAbcEstoqueClasse(codigos) {
        if (!abcEstoque._items.length) return null;
        const keys = codigos.map(c => c.toUpperCase());
        const found = abcEstoque._items.filter(i => keys.includes(String(i.codigo||'').toUpperCase()));
        if (!found.length) return null;
        const order = ['A','B','C'];
        return found.sort((a,b) => order.indexOf(a.classe) - order.indexOf(b.classe))[0].classe;
    },

    _renderAbcBlock(codigos) {
        const block = document.getElementById('pc-abc-block');
        if (!block) return;
        const cv = this._getAbcVendasClasse(codigos);
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

        const interpretacoes = {
            AA: { icon:'✅', texto:'Equilíbrio — alto giro e bom estoque.',       cor:'#26a69a' },
            AB: { icon:'🟡', texto:'Atenção — alto giro, estoque médio.',          cor:'#ffab76' },
            AC: { icon:'🔴', texto:'Risco de ruptura — alto giro, estoque crítico.', cor:'#f06292' },
            BA: { icon:'🟡', texto:'Estoque excedente para giro médio.',           cor:'#ffab76' },
            BB: { icon:'🔵', texto:'Equilíbrio moderado.',                         cor:'#26c6da' },
            BC: { icon:'🟠', texto:'Atenção — estoque baixo para giro médio.',     cor:'#e3b341' },
            CA: { icon:'🟠', texto:'Estoque parado — baixo giro, muito estoque.',  cor:'#e3b341' },
            CB: { icon:'⚪', texto:'Estoque acima do necessário para baixo giro.', cor:'#8b949e' },
            CC: { icon:'⚪', texto:'Candidato a revisão — baixo giro e estoque.',  cor:'#8b949e' },
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
                        <span style="font-size:1.4rem;color:var(--text-dim);margin-top:16px;">×</span>
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
                <td class="td-code">${r.codigo}</td>
                <td class="td-desc">${r.descricao}</td>
                <td>${r.marca || '<span style="opacity:.3">—</span>'}</td>
                <td><span class="seg-badge">${r.segmento}</span></td>
                <td class="td-center">${r.tamanho}</td>
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
        this._renderAbcBlock(codigos);
    }
};

// ====== DASHBOARD: VENDAS × ESTOQUE ======

const vxe = {
    selectedYear: 'all',
    selectedTri:  '',
    selectedMes:  '',

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
            const normK = k => String(k).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
            const COD_KEYS = ['codigo','cod','codigodoproduto','cdproduto','cdprod','codprod'];
            const QTD_KEYS = ['producao','quantidade','qtd','qty','qtde','aproduzir','pecas'];
            const codCol = op.colunas.find(c => COD_KEYS.includes(normK(c)));
            const qtdCol = op._colQtd || op.colunas.find(c => QTD_KEYS.includes(normK(c)));
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

        this._lastRows = rows;
        document.querySelector('#vxe-table tbody').innerHTML = rows.slice(0, 2000).map(r => `
            <tr onclick="abrirDetalheVxe('${r.descricao.replace(/'/g,"\\'")}');" style="cursor:pointer;">
                <td class="td-code" style="color:var(--indigo-primary);">${r.codigo}</td>
                <td class="td-desc">${r.descricao}</td>
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
                <td class="td-center"><span class="vxe-badge ${classes[r.st]}">${labels[r.st]}</span></td>
            </tr>`).join('');
    }
};
