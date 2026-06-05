// Lógica Central do Dashboard SIN1

// Escapa HTML para evitar XSS em dados inseridos via innerHTML
function escHTML(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
    loginView.style.display = 'flex';
    const statusEl = document.getElementById('login-status');
    const formWrap = document.getElementById('login-form-wrap');

    // Pré-ping: acorda o servidor em background enquanto usuário digita credenciais
    if (statusEl) statusEl.textContent = 'Conectando ao servidor...';
    formWrap.style.display = 'block';
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
    },

    _kpis() {
        const toNum = v => parseFloat(String(v??'0').replace(/\./g,'').replace(',','.')) || 0;
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

        const critCount = alertas.filter(a => a.tipo === 'critico').length;
        if (badge) { badge.textContent = critCount; badge.style.display = critCount > 0 ? '' : 'none'; }

        if (!alertas.length) { el.innerHTML = '<p style="color:#26a69a;font-size:0.8rem;">✓ Nenhum alerta no momento.</p>'; return; }

        const cores = { critico: '#f06292', aviso: '#ffab76', info: '#8b949e' };
        const icons = { critico: '🔴', aviso: '🟡', info: 'ℹ️' };
        el.innerHTML = alertas.map(a => `
            <div onclick="navigateTo('${a.acao}')" style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;border-left:3px solid ${cores[a.tipo]};">
                <span style="font-size:0.85rem;">${icons[a.tipo]}</span>
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

    _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
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
    } catch(e) { mostrarToast('Erro de conexão: ' + e.message, 'erro'); }
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
    } catch(e) { mostrarToast('Erro: ' + e.message, 'erro'); }
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

function navigateTo(viewName) {
    if (viewName !== 'dashboard') localStorage.setItem('sin1_lastView', viewName);
    fecharDetalhe();
    fecharDetalheVxe();
    ['dashboard','vendas','cliente','banco','estoque','op','costura','calendario','processos','capacidade','pesquisa','vxe','op-dash','pedidos','comparador','clientes-dash','abc','abc-micro','abc-estoque'].forEach(v => {
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
        'op-dash':     'nav-op-dash',
        'pedidos':     'nav-pedidos',
        'comparador':   'nav-comparador',
        'clientes-dash':'nav-clientes-dash',
        dashboard:     'nav-analise',
        abc:           'nav-abc-cruzada',
        'abc-micro':   'nav-abc-cruzada',
        'abc-estoque': 'nav-abc-cruzada'
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
    } else if (viewName === 'processos') {
        document.querySelector('[data-view="processos"]')?.classList.add('sub-active');
        processosGerenciamento.voltarLista();
        processosGerenciamento.carregarProcessos();
    } else if (viewName === 'capacidade') {
        document.querySelector('[data-view="capacidade"]')?.classList.add('sub-active');
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
                    <span style="font-size:0.72rem;color:var(--indigo-primary);font-weight:600;min-width:52px;">${cod}</span>
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
                <td class="td-code">${escHTML(r.codigo)}</td>
                <td class="td-desc">${escHTML(r.descricao)}</td>
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
        const toNum = v => parseFloat(String(v ?? '').replace(/[^\d,.\-]/g,'').replace(',','.')) || 0;
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

        const COLUNAS_OP = ['N. OP','Emissão','Lote','Ref','Descrição','Cor','Tam','Marca','Qtd','Status'];
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
                    <td><span style="font-family:monospace;color:#26c6da;font-weight:600;">${cod||empty}</span></td>
                    <td>${modelo||empty}</td>
                    <td>${cor||empty}</td>
                    <td>${marca||empty}</td>
                    <td style="font-weight:600;">${tamanho||empty}</td>
                    <td>${data||empty}</td>
                    <td style="font-weight:500;">${cli||empty}</td>
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
                this.colunas.map(h => `<th>${LABELS[h] || h.toUpperCase()}</th>`).join('');
            table.querySelector('tbody').innerHTML = this.filtered.slice(0, 2000).map(r => {
                const cells = this.colunas.map(h => {
                    const v = r.dados?.[h];
                    if (v === undefined || v === '') return `<td>${empty}</td>`;
                    const vu = up(v);
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
            mostrarToast('Erro de conexão: ' + e.message, 'erro');
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
            } catch(e) { mostrarToast('Erro de conexão: ' + e.message, 'erro'); } finally { this._setSaving(false); }
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
                    document.getElementById(`${id}-drop-zone`).style.display = 'none';
                    document.getElementById(`${id}-data`).classList.add('visible');
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
            document.getElementById(`${id}-drop-zone`).style.display = 'none';
            document.getElementById(`${id}-data`).classList.add('visible');
            this.render(); this.renderHistorico();
            lsCache.salvar(nomeApi, { importacaoId: id_imp, colunas: this.colunas, rawData: this.rawData });
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
                <td class="td-code" style="color:var(--indigo-primary);font-weight:700;position:sticky;left:0;background:var(--bg-obsidian);">${r.codigo}</td>
                <td>
                    <div style="font-size:0.82rem;">${r.descricao}</div>
                    <div style="margin-top:3px;height:3px;border-radius:2px;background:var(--border);">
                        <div style="height:3px;border-radius:2px;background:var(--indigo-primary);width:${barW}%;"></div>
                    </div>
                </td>
                <td style="font-size:0.78rem;color:var(--text-dim);">${r.marca}</td>
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
            const q = qtdCol ? (parseFloat(String(r.dados?.[qtdCol] ?? '0').replace(',', '.')) || 0) : 0;
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
        this._rows = op.rawData.map(r => {
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

        // Cabeçalho fixo (colunas 1,2,3,5,7,8,9,10 do VxE)
        document.getElementById('opdash-thead').innerHTML = `
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

        document.getElementById('opdash-tbody').innerHTML = visible.slice(0, 2000).map(r => `
            <tr>
                <td class="td-code" style="color:var(--indigo-primary);">${escHTML(r.codigo)}</td>
                <td class="td-desc">${escHTML(r.descricao)}</td>
                <td style="font-size:0.75rem;">${r.marca}</td>
                <td class="td-center">${r.tamanho}</td>
                <td class="td-right" style="color:var(--indigo-primary);font-weight:600;">${fmt(r.vendMedia)}</td>
                <td class="td-right" style="color:var(--green-accent);font-weight:600;">${fmt(r.estoque)}</td>
                <td class="td-right" style="color:var(--orange-accent);font-weight:600;">${fmt(r.emProcesso)}</td>
                <td class="td-right">${fmtC(r.cobertura)}</td>
                <td class="td-right">${fmtP(r.vendMedia, r.emProcesso)}</td>
            </tr>`).join('');
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
            AA: { icon:'✅', texto:'Equilíbrio — alto giro e bom estoque.',          cor:'#26a69a' },
            AB: { icon:'🟡', texto:'Atenção — alto giro, estoque médio.',             cor:'#ffab76' },
            AC: { icon:'🔴', texto:'Risco de ruptura — alto giro, estoque crítico.',  cor:'#f06292' },
            BA: { icon:'🟡', texto:'Estoque excedente para giro médio.',              cor:'#ffab76' },
            BB: { icon:'🔵', texto:'Equilíbrio moderado.',                            cor:'#26c6da' },
            BC: { icon:'🟠', texto:'Atenção — estoque baixo para giro médio.',        cor:'#e3b341' },
            CA: { icon:'🟠', texto:'Estoque parado — baixo giro, muito estoque.',     cor:'#e3b341' },
            CB: { icon:'⚪', texto:'Estoque acima do necessário para baixo giro.',    cor:'#8b949e' },
            CC: { icon:'⚪', texto:'Candidato a revisão — baixo giro e estoque.',     cor:'#8b949e' },
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

    _toNum: v => parseFloat(String(v ?? '0').replace(/\./g,'').replace(',','.')) || 0,
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
            const nome = String(d[cliente._colCliente]||'').trim().toUpperCase();
            const data = String(d[cliente._colData]||'').trim();
            const qtd  = this._toNum(d[cliente._colQtd]);
            const val  = this._toNum(d[cliente._colValTotal]);
            const desc = String(d[cliente._colDesc]||d[cliente._colCodigo]||'').trim().toUpperCase();
            if (!nome) return;
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
        const ticket   = totalPed > 0 ? totalVal/totalPed : 0;  // média por pedido/transação
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
            const n = String(r.dados?.[cliente._colCliente]||'').trim().toUpperCase();
            if (n) nomes.add(n);
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
            cliSel.innerHTML = '<option value="">Todos os clientes</option>';
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
        sel.innerHTML = '<option value="">Todos os clientes</option>' +
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
            const nome = String(d[cliente._colCliente]||'').trim().toUpperCase();
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

    setAno(ano) {
        this._ano = ano;
        ['2025','2026','ambos'].forEach(a => {
            document.getElementById(`comp-btn-${a}`)?.classList.toggle('active', a === ano);
        });
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
                const p25 = get('2025'), p26 = get('2026');
                body = `
                    <div class="comp-res-year-section">
                        <div class="comp-res-year-label" style="color:${color};">2025</div>
                        ${statRow(p25, MONTHS_ORDER)}
                    </div>
                    <hr class="comp-res-divider">
                    <div class="comp-res-year-section">
                        <div class="comp-res-year-label" style="color:${color};">2026</div>
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
                const p25 = getPoints(totals, '2025');
                const p26 = getPoints(totals, '2026');
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
                ${this._ano === 'ambos' ? `<span class="comp-leg-dash" style="border-color:${color};"></span><span class="comp-leg-year">2026</span>` : ''}
            </span>`);
        });
        el.innerHTML = items.length
            ? items.join('')
            : '<span style="color:#8b949e;font-size:0.82rem;">Nenhuma série configurada</span>';
        if (this._ano === 'ambos' && items.length) {
            el.innerHTML += `<div style="margin-top:8px;font-size:0.75rem;color:#8b949e;width:100%;">
                ─── sólido = 2025 &nbsp;·&nbsp; - - - tracejado = 2026
            </div>`;
        }
    }
};
