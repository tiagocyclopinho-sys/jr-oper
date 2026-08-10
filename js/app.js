// JR SAC & Logística Corporativa v4.0
// Controlador Principal da Interface

let activeTab = 'dashboard';
let activeCadSubTab = 'motoristas';
let activeResumoSubTab = 'resumo';
let uploadedFotosBase64 = [];
let uploadedVideosBase64 = [];
let uploadedVideosBase64Inv = [];

// ===== INICIALIZAÇÃO INFALÍVEL =====
function runInitSafely() {
  if (window._appInitialized) return;
  window._appInitialized = true;
  initApp();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(runInitSafely, 0);
} else {
  document.addEventListener('DOMContentLoaded', runInitSafely);
}
window.addEventListener('load', runInitSafely);
setTimeout(runInitSafely, 100);

function initApp() {
  try {
    initTheme();
    updateUserHeader();
    renderApp();
    setupPwa();
  } catch (err) {
    console.error("Erro na inicialização do app:", err);
    try {
      if (typeof db !== 'undefined' && typeof INITIAL_DATA !== 'undefined') {
        db.data = JSON.parse(JSON.stringify(INITIAL_DATA));
        if (typeof db.init === 'function') db.init();
      }
      updateUserHeader();
      renderApp();
    } catch(e2) {
      console.error("Erro crítico ao renderizar:", e2);
    }
  }
}

// ===== TEMA CLARO / ESCURO (SOL / LUA) =====
function initTheme() {
  let currentTheme = 'dark';
  try {
    currentTheme = localStorage.getItem('jr_sac_theme') || 'dark';
  } catch(e) {
    currentTheme = 'dark';
  }
  applyTheme(currentTheme);
}

function applyTheme(theme) {
  const html = document.documentElement;
  const body = document.body;
  const icon = document.getElementById('theme-icon');
  
  if (theme === 'light') {
    html.classList.remove('dark');
    html.classList.add('light');
    if (body) {
      body.classList.remove('bg-slate-950', 'text-slate-100');
      body.classList.add('bg-slate-100', 'text-slate-900');
    }
    if (icon) icon.textContent = '🌙';
  } else {
    html.classList.remove('light');
    html.classList.add('dark');
    if (body) {
      body.classList.remove('bg-slate-100', 'text-slate-900');
      body.classList.add('bg-slate-950', 'text-slate-100');
    }
    if (icon) icon.textContent = '☀️';
  }
  try {
    localStorage.setItem('jr_sac_theme', theme);
  } catch(e) {
    console.warn("Nao foi possivel salvar tema no localStorage:", e);
  }
}

function toggleTheme() {
  let currentTheme = 'dark';
  try {
    currentTheme = localStorage.getItem('jr_sac_theme') || 'dark';
  } catch(e) {
    currentTheme = 'dark';
  }
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
}

function setupPwa() {
  let deferredPrompt;
  const pwaBtn = document.getElementById('btn-pwa-install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    if (pwaBtn) pwaBtn.classList.remove('hidden');
  });
  if (pwaBtn) {
    pwaBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') pwaBtn.classList.add('hidden');
        deferredPrompt = null;
      } else {
        alert('Para instalar no Android ou Windows: Clique nos três pontos do navegador → "Instalar JR SAC".');
      }
    });
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (let r of registrations) r.unregister();
    }).catch(() => {});
  }
}

// ===== CONTROLE DE USUÁRIO E HEADER =====
function updateUserHeader() {
  const user = (typeof db !== 'undefined') ? db.currentUser : null;
  const el = document.getElementById('user-info-area');
  if (!el) return;
  if (user) {
    const firstName = user.nome.split('(')[0].trim();
    const dept = user.departamento || user.role || 'LOGÍSTICA';
    el.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-2 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1.5 rounded-lg text-xs">
          <div class="w-7 h-7 rounded-full bg-emerald-700 text-white font-bold flex items-center justify-center text-sm shadow shrink-0">${user.nome.charAt(0)}</div>
          <div class="hidden sm:block">
            <div class="font-bold text-emerald-100 text-xs leading-none">${firstName}</div>
            <div class="text-emerald-400 text-[10px] uppercase font-semibold leading-none mt-0.5">${dept}</div>
          </div>
        </div>
        <button onclick="handleLogout()" class="text-[10px] bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 px-2.5 py-1.5 rounded-lg font-bold transition">Sair</button>
      </div>`;
  } else {
    el.innerHTML = `
      <button onclick="switchTab('login')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow">Entrar no Sistema</button>`;
  }
}

function renderNavMenu() {
  const menuEl = document.getElementById('nav-menu');
  if (!menuEl) return;
  const user = typeof db !== 'undefined' ? db.currentUser : null;
  if (!user) {
    menuEl.innerHTML = '';
    return;
  }

  const items = [
    { tab: 'dashboard', icon: '📊', label: 'Dashboard Executivo' },
    { tab: 'sac_abertura', icon: '📝', label: 'Devolução SAC' },
    { tab: 'sac_investigacao', icon: '🔍', label: 'Análise e Monitoramento' },
    { tab: 'gestao_gestor', icon: '👔', label: 'Gestão de Tratativas' },
    { tab: 'cd_recepcao', icon: '🏭', label: 'Recepção CD' },
    { tab: 'controle_viagens', icon: '🚍', label: 'Controle de Viagens' },
    { tab: 'rota_ocorrencias', icon: '🚨', label: 'Chamados em Rota' },
    { tab: 'resumo_diario_cd', icon: '📋', label: 'Diário do CD' },
    { tab: 'boletim_gerencial', icon: '📈', label: 'Boletim Gerencial' },
    { tab: 'cadastros_dados', icon: '⚙️', label: 'Cadastros Gerais' },
    { tab: 'power_bi', icon: '📊', label: 'Power BI' }
  ];

  menuEl.innerHTML = `
    <div id="mobile-menu-dropdown" class="hidden bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-2 w-64 space-y-1 mt-1 z-50">
      <div class="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div>
          <div class="text-xs font-bold text-white">${user.nome}</div>
          <div class="text-[10px] text-emerald-400 font-semibold uppercase">${user.departamento || user.role}</div>
        </div>
      </div>
      <div class="py-1 space-y-0.5">
        ${items.map(i => `
          <button onclick="switchTab('${i.tab}')" class="w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2.5 ${activeTab === i.tab ? 'bg-emerald-800 text-white shadow' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}">
            <span>${i.icon}</span> ${i.label}
          </button>
        `).join('')}
      </div>
    </div>`;
}

function renderApp() {
  const container = document.getElementById('main-content');
  if (!container) return;

  if (typeof db === 'undefined' || !db || !db.data) {
    if (typeof Store !== 'undefined') {
      try { db = new Store(); } catch(e) {}
    }
    if (!db || !db.data) {
      db = {
        data: (typeof INITIAL_DATA !== 'undefined' ? JSON.parse(JSON.stringify(INITIAL_DATA)) : { usuarios: [], roles_disponiveis: [] }),
        currentUser: null,
        getDevolucoes: () => [],
        getOcorrenciasRota: () => [],
        getTrocasVeiculos: () => [],
        getResumosDiariosCD: () => []
      };
    }
  }

  if (!db.currentUser && activeTab !== 'login') {
    activeTab = 'login';
  }

  let html = '';
  try {
    switch (activeTab) {
      case 'login':
        html = renderLoginView();
        break;
      case 'dashboard':
        html = renderDashboardView();
        break;
      case 'sac_abertura':
        html = renderSacAberturaView();
        break;
      case 'sac_investigacao':
        html = renderSacInvestigacaoView();
        break;
      case 'gestao_gestor':
        html = renderGestaoGestorView();
        break;
      case 'cd_recepcao':
        html = renderCdRecepcaoView();
        break;
      case 'controle_viagens':
        html = renderControleViagensView();
        break;
      case 'rota_ocorrencias':
        html = renderRotaOcorrenciasView();
        break;
      case 'cadastros_dados':
        html = renderCadastrosDadosView();
        break;
      case 'resumo_diario_cd':
        html = renderResumoDiarioCdView();
        break;
      case 'boletim_gerencial':
        html = renderBoletimGerencialView();
        break;
      case 'conector_dados':
        html = renderConectorDadosView();
        break;
      case 'power_bi':
        html = renderPowerBiView();
        break;
      default:
        html = renderDashboardView();
    }
  } catch(eRender) {
    console.error("Erro ao renderizar visão " + activeTab + ":", eRender);
    html = `<div class="p-6 bg-red-950 text-red-200 border border-red-800 rounded-xl max-w-2xl mx-auto my-10 space-y-3 shadow-2xl">
      <h3 class="text-base font-bold text-white flex items-center gap-2">⚠️ Falha ao carregar visão (${activeTab})</h3>
      <p class="text-xs text-red-300">${eRender.message}</p>
      <pre class="text-[11px] bg-slate-900 p-3 rounded border border-slate-800 overflow-x-auto text-red-400 font-mono">${eRender.stack || eRender}</pre>
      <button onclick="switchTab('login')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded text-xs shadow">Voltar ao Login</button>
    </div>`;
  }

  container.innerHTML = html;
  updateUserHeader();
  renderNavMenu();
}

function closeModal() {
  const modal = document.getElementById('modal-container');
  if (modal) {
    modal.innerHTML = '';
    modal.classList.add('hidden');
  }
}

function aplicarFiltroCd() {
  window._cdFiltroDataDe = document.getElementById('cd-filtro-data-de')?.value || '';
  window._cdFiltroDataAte = document.getElementById('cd-filtro-data-ate')?.value || '';
  window._cdFiltroPlaca = document.getElementById('cd-filtro-placa')?.value || '';
  window._cdFiltroRota = document.getElementById('cd-filtro-rota')?.value || '';
  window._cdFiltroCarga = document.getElementById('cd-filtro-carga')?.value || '';
  renderApp();
}

function toggleItemDivergenciaInputs(idx) {
  const box = document.getElementById(`item-div-box-${idx}`);
  if (!box) return;
  const radio = document.querySelector(`input[name="item-status-${idx}"]:checked`);
  if (radio && radio.value === 'divergente') {
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu-dropdown');
  if (menu) menu.classList.toggle('hidden');
}

// Fechar menu ao clicar fora
document.addEventListener('click', (e) => {
  const menu = document.getElementById('mobile-menu-dropdown');
  const btn = document.getElementById('hamburger-btn');
  if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

function changeRole(newRole) { db.switchRole(newRole); updateUserHeader(); renderApp(); }
function handleLogout() { db.logout(); updateUserHeader(); renderApp(); }

function switchTab(tab) {
  activeTab = tab;
  const menu = document.getElementById('mobile-menu-dropdown');
  if (menu) menu.classList.add('hidden');
  renderApp();
}

// ===== LOGIN & CADASTRO =====
const DEPARTAMENTOS_PADRAO = [
  "SAC",
  "MONITORAMENTO",
  "RASTREAMENTO",
  "CENTRO DE DISTRIBUIÇÃO",
  "MANUTENÇÃO",
  "SUPERVISOR CD",
  "SUPERVISOR OPERAÇÃO",
  "GERENTE CD",
  "FATURAMENTO",
  "MONTAGEM CARGA",
  "GERENTE GERAL",
  "ANALISTA/BI"
];

function mapDeptToRoleAndCargo(dept) {
  const d = String(dept || '').toUpperCase();
  if (d.includes('ANALISTA') || d.includes('BI')) return { role: 'ADMIN', cargo: 'Analista de BI / Logística' };
  if (d.includes('GERENTE') || d.includes('SUPERVISOR OPERAÇÃO')) return { role: 'GESTOR', cargo: 'Gestor Operacional' };
  if (d.includes('CENTRO DE DISTRIBUIÇÃO') || d.includes('MONTAGEM') || d.includes('SUPERVISOR CD')) return { role: 'CD', cargo: 'Operador / Líder CD' };
  if (d.includes('MANUTENÇÃO') || d.includes('MONITORAMENTO') || d.includes('RASTREAMENTO')) return { role: 'MANUTENCAO', cargo: 'Analista de Monitoramento' };
  if (d.includes('FATURAMENTO')) return { role: 'FINANCEIRO', cargo: 'Analista Financeiro' };
  return { role: 'SAC', cargo: 'Analista de SAC' };
}

function updateLoginDeptPreview() {
  const val = document.getElementById('login-user-input')?.value?.toLowerCase()?.trim() || '';
  const previewEl = document.getElementById('login-dept-preview');
  if (!previewEl) return;
  
  if (!val) {
    previewEl.innerHTML = '';
    return;
  }

  const users = (db && db.data && Array.isArray(db.data.usuarios)) ? db.data.usuarios : [];
  const found = users.find(u => 
    (u.nome && u.nome.toLowerCase() === val) || 
    (u.email && u.email.toLowerCase() === val) || 
    (u.nome && u.nome.toLowerCase().includes(val))
  );

  if (found && (found.departamento || found.role)) {
    const dept = found.departamento || found.role;
    previewEl.innerHTML = `<div class="mt-1 flex items-center gap-1.5 text-xs text-emerald-300 font-bold bg-emerald-950/80 border border-emerald-800 px-2.5 py-1 rounded-lg">🏢 Departamento: <span class="text-white">${dept}</span> (${found.nome})</div>`;
  } else {
    previewEl.innerHTML = '';
  }
}

function renderLoginView() {
  const usuarios = (db && db.data && Array.isArray(db.data.usuarios)) ? db.data.usuarios : [];
  return `
    <div class="max-w-md mx-auto my-6">
      <!-- LOGO -->
      <div class="text-center mb-5">
        <img src="./public/logo.png" alt="JR SAC" class="w-20 h-20 mx-auto rounded-2xl shadow-lg border border-emerald-600 mb-3 object-cover" style="width: 80px; height: 80px; object-fit: cover;" onerror="this.style.display='none'">
        <div class="inline-flex items-center gap-2 mb-1">
          <span class="font-extrabold text-3xl text-white tracking-wide">JR</span>
          <span class="bg-emerald-800 text-emerald-200 text-xs font-black px-2 py-1 rounded tracking-widest uppercase">OPER</span>
        </div>
        <p class="text-xs text-emerald-400">JR Distribuidora • Sistema Integrado de Operações Logísticas</p>
      </div>

      <!-- TABS LOGIN / CADASTRAR -->
      <div class="flex bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-0">
        <button id="tab-login-btn" onclick="showLoginTab('login')" class="flex-1 py-3 text-sm font-bold text-white bg-emerald-800 transition">🔑 Entrar</button>
        <button id="tab-cad-btn" onclick="showLoginTab('cadastro')" class="flex-1 py-3 text-sm font-bold text-slate-400 hover:text-white transition">👤 Cadastrar</button>
      </div>

      <!-- PAINEL LOGIN -->
      <div id="painel-login" class="bg-slate-900 border border-slate-800 border-t-0 rounded-b-xl p-5 shadow-2xl">
        <form onsubmit="handleLoginSubmit(event)" class="space-y-4">
          <div id="login-msg-error" class="hidden p-2.5 bg-red-950/80 border border-red-800 text-red-300 text-xs rounded-lg font-bold text-center"></div>
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1">Login (Nome Completo ou E-mail)</label>
            <input type="text" id="login-user-input" required placeholder="Digite seu nome completo ou e-mail" value="sac@jrdistribuidora.com.br" oninput="updateLoginDeptPreview()"
              class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-sm focus:border-emerald-500 focus:outline-none">
            <div id="login-dept-preview"></div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1">Senha</label>
            <input type="password" id="login-senha" required value="123456"
              class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-sm focus:border-emerald-500 focus:outline-none">
          </div>
          <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-lg text-sm shadow-lg transition">Acessar Sistema</button>
        </form>

        <!-- Acesso rápido -->
        <div class="mt-5 pt-4 border-t border-slate-800">
          <div class="text-xs text-slate-400 font-semibold mb-2 text-center">Acesso Rápido (Demo):</div>
          <div class="grid grid-cols-3 gap-1.5">
            <button onclick="quickLogin('sac@jrdistribuidora.com.br')" class="bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-900/60 p-1.5 rounded text-[10px] font-bold">🟢 SAC</button>
            <button onclick="quickLogin('cd@jrdistribuidora.com.br')" class="bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-900/60 p-1.5 rounded text-[10px] font-bold">🟠 CD</button>
            <button onclick="quickLogin('gerente@jrdistribuidora.com.br')" class="bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-900/60 p-1.5 rounded text-[10px] font-bold">🟣 Gestor</button>
            <button onclick="quickLogin('financeiro@jrdistribuidora.com.br')" class="bg-slate-800 hover:bg-slate-700 text-blue-300 border border-blue-900/60 p-1.5 rounded text-[10px] font-bold">🔵 Financeiro</button>
            <button onclick="quickLogin('manutencao@jrdistribuidora.com.br')" class="bg-slate-800 hover:bg-slate-700 text-red-300 border border-red-900/60 p-1.5 rounded text-[10px] font-bold">🔴 Manutenção</button>
            <button onclick="quickLogin('admin@jrdistribuidora.com.br')" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 p-1.5 rounded text-[10px] font-bold">⚪ Admin</button>
          </div>
        </div>
      </div>

      <!-- PAINEL CADASTRO DE USUÁRIO -->
      <div id="painel-cadastro" class="hidden bg-slate-900 border border-slate-800 border-t-0 rounded-b-xl p-5 shadow-2xl">
        <form onsubmit="handleCadastroUsuarioSubmit(event)" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1">Login (Nome Completo) *</label>
            <input type="text" id="cad-usr-nome" required placeholder="Digite seu Nome Completo" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-sm focus:border-emerald-500 focus:outline-none uppercase">
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Senha *</label>
              <input type="password" id="cad-usr-senha" required placeholder="Mínimo 4 caracteres" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-sm focus:border-emerald-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Confirmar Senha *</label>
              <input type="password" id="cad-usr-senha2" required placeholder="Repita a senha" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-sm focus:border-emerald-500 focus:outline-none">
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1">Departamento *</label>
            <select id="cad-usr-depart" required onchange="toggleCustomDeptInput(this.value)" class="w-full bg-slate-800 border border-slate-700 text-white font-bold rounded-lg p-2.5 text-sm focus:border-emerald-500 focus:outline-none">
              <option value="">-- Selecione seu departamento --</option>
              ${DEPARTAMENTOS_PADRAO.map(d => `<option value="${d}">${d}</option>`).join('')}
              <option value="OUTRO">OUTRO (DIGITAR...)</option>
            </select>
            <input type="text" id="cad-usr-depart-custom" placeholder="Digite o departamento..." class="hidden mt-2 w-full bg-slate-800 border border-emerald-600 text-emerald-300 font-bold rounded-lg p-2.5 text-sm focus:outline-none uppercase">
          </div>

          <div class="pt-2">
            <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-lg text-sm shadow-lg transition">Criar Conta e Acessar</button>
          </div>
        </form>

        <!-- Lista de usuários cadastrados -->
        <div class="mt-4 pt-4 border-t border-slate-800">
          <div class="text-xs font-bold text-slate-400 mb-2">Usuários Cadastrados (${usuarios.length})</div>
          <div class="space-y-1.5 max-h-40 overflow-y-auto">
            ${usuarios.map(u => `
              <div class="flex items-center justify-between bg-slate-800 px-3 py-2 rounded-lg">
                <div>
                  <div class="text-xs font-bold text-white">${u.nome}</div>
                  <div class="text-[10px] text-slate-400"><b class="text-emerald-400">${u.departamento||u.role||''}</b></div>
                </div>
                <span class="text-[10px] font-bold ${u.role==='GESTOR'?'text-purple-400':u.role==='ADMIN'?'text-yellow-400':u.role==='SAC'?'text-emerald-400':u.role==='CD'?'text-amber-400':'text-blue-400'} bg-slate-900 px-2 py-0.5 rounded">${u.role}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
}

function toggleCustomDeptInput(val) {
  const customInp = document.getElementById('cad-usr-depart-custom');
  if (customInp) {
    if (val === 'OUTRO') {
      customInp.classList.remove('hidden');
      customInp.required = true;
    } else {
      customInp.classList.add('hidden');
      customInp.required = false;
    }
  }
}

function showLoginTab(tab) {
  const painelLogin = document.getElementById('painel-login');
  const painelCad = document.getElementById('painel-cadastro');
  const btnLogin = document.getElementById('tab-login-btn');
  const btnCad = document.getElementById('tab-cad-btn');
  if (tab === 'login') {
    painelLogin?.classList.remove('hidden');
    painelCad?.classList.add('hidden');
    btnLogin?.classList.add('bg-emerald-800','text-white');
    btnLogin?.classList.remove('text-slate-400');
    btnCad?.classList.remove('bg-emerald-800','text-white');
    btnCad?.classList.add('text-slate-400');
  } else {
    painelCad?.classList.remove('hidden');
    painelLogin?.classList.add('hidden');
    btnCad?.classList.add('bg-emerald-800','text-white');
    btnCad?.classList.remove('text-slate-400');
    btnLogin?.classList.remove('bg-emerald-800','text-white');
    btnLogin?.classList.add('text-slate-400');
  }
}

function handleCadastroUsuarioSubmit(e) {
  e.preventDefault();
  const nome = document.getElementById('cad-usr-nome')?.value?.trim()?.toUpperCase() || '';
  const senha = document.getElementById('cad-usr-senha')?.value || '';
  const senha2 = document.getElementById('cad-usr-senha2')?.value || '';
  let depart = document.getElementById('cad-usr-depart')?.value || '';
  if (depart === 'OUTRO') {
    depart = document.getElementById('cad-usr-depart-custom')?.value?.toUpperCase()?.trim() || '';
  }

  if (!nome) { alert('Informe seu Login (Nome Completo)!'); return; }
  if (senha.length < 4) { alert('Senha deve ter pelo menos 4 caracteres!'); return; }
  if (senha !== senha2) { alert('As senhas não coincidem!'); return; }
  if (!depart) { alert('Selecione ou digite seu departamento!'); return; }

  const email = nome.toLowerCase().replace(/[^a-z0-9]/g, '.') + '@jrdistribuidora.com.br';
  const { role, cargo } = mapDeptToRoleAndCargo(depart);

  const res = db.addUsuario({ nome, email, senha, role, departamento: depart, cargo });
  if (res.success) {
    alert(`✅ Usuário ${res.user.nome} cadastrado com sucesso no departamento ${res.user.departamento}!`);
    db.currentUser = res.user;
    try { localStorage.setItem('jr_sac_user', JSON.stringify(res.user)); } catch(e){}
    updateUserHeader();
    switchTab('dashboard');
  } else {
    alert(`❌ ${res.message}`);
  }
}

function quickLogin(email) {
  let senha = '123456';
  if (email.includes('admin')) senha = 'admin123';
  else if (email.includes('gerente')) senha = 'gerente123';
  const res = db.login(email, senha);
  if (res.success) { updateUserHeader(); switchTab('dashboard'); }
  else alert(res.message);
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const userInput = document.getElementById('login-user-input')?.value?.trim() || '';
  const pwdInput = document.getElementById('login-senha')?.value || '';
  const errBox = document.getElementById('login-msg-error');
  if (errBox) errBox.classList.add('hidden');

  if (!userInput) {
    if (errBox) { errBox.textContent = '⚠️ Informe seu Login (Nome Completo ou E-mail)'; errBox.classList.remove('hidden'); }
    return;
  }

  let res = db.login(userInput, pwdInput);

  if (!res.success) {
    const users = (db && db.data && Array.isArray(db.data.usuarios)) ? db.data.usuarios : [];
    const term = userInput.toLowerCase();
    const userMatch = users.find(u => 
      (u.nome && u.nome.toLowerCase() === term) ||
      (u.email && u.email.toLowerCase() === term) ||
      (u.nome && u.nome.toLowerCase().includes(term))
    );
    if (userMatch) {
      res = db.login(userMatch.email, pwdInput);
    }
  }

  if (res.success) {
    updateUserHeader();
    switchTab('dashboard');
  } else {
    if (errBox) {
      errBox.textContent = `⚠️ ${res.message || 'Login ou senha incorretos'}`;
      errBox.classList.remove('hidden');
    } else {
      alert(`⚠️ ${res.message || 'Login ou senha incorretos'}`);
    }
  }
}

// ===== HELPERS E FILTRO DE DATAS DO DASHBOARD =====
function setDashboardPeriodo(tipo) {
  const today = new Date();
  const isoToday = today.toISOString().split('T')[0];
  if (tipo === 'hoje') {
    window._dashFiltroDe = isoToday;
    window._dashFiltroAte = isoToday;
  } else if (tipo === 'semana') {
    const day = today.getDay();
    const diffToMonday = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diffToMonday));
    window._dashFiltroDe = monday.toISOString().split('T')[0];
    window._dashFiltroAte = isoToday;
  } else if (tipo === 'mes') {
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    window._dashFiltroDe = `${yyyy}-${mm}-01`;
    window._dashFiltroAte = isoToday;
  } else if (tipo === 'limpar') {
    window._dashFiltroDe = '';
    window._dashFiltroAte = '';
  }
  renderApp();
}

function dataNoPeriodo(dStr, de, ate) {
  if (!dStr) return true;
  const d = String(dStr).split('T')[0].trim();
  if (de && d < de) return false;
  if (ate && d > ate) return false;
  return true;
}

// ===== DASHBOARD =====
function renderDashboardView() {
  const fDe = window._dashFiltroDe || '';
  const fAte = window._dashFiltroAte || '';

  const allDevs = db.getDevolucoes();
  const allRotas = db.getOcorrenciasRota();
  const allViagens = db.getControleViagens();
  const allOcViagens = db.getOcorrenciasViagens();
  const allTrocas = db.getTrocasVeiculos();
  const rawResumosCd = Array.isArray(db.data.resumo_diario_cd) ? db.data.resumo_diario_cd : Object.values(db.data.resumo_diario_cd || db.data.resumos_cd || {});

  // Filtragem periódica por intervalo de datas
  const devs = allDevs.filter(d => dataNoPeriodo(d.data_abertura || d.data, fDe, fAte));
  const rotas = allRotas.filter(r => dataNoPeriodo(r.data_chamado || r.data, fDe, fAte));
  const viagens = allViagens.filter(v => dataNoPeriodo(v.data_viagem || v.data, fDe, fAte));
  const ocViagens = allOcViagens.filter(o => dataNoPeriodo(o.data_chamado || o.data, fDe, fAte));
  const trocas = allTrocas.filter(t => dataNoPeriodo(t.data_troca || t.data, fDe, fAte));
  const resumosCdArr = rawResumosCd.filter(r => r && dataNoPeriodo(r.data, fDe, fAte));

  // Cálculos CD
  let pesoExpedicao = 0;
  let pesoRecebimento = 0;
  let cortesList = [];
  let ocorrenciasCdList = [];
  let faltasColabList = [];

  resumosCdArr.forEach(r => {
    if (!r) return;
    if (r.movimentacao && r.movimentacao.expedicao && r.movimentacao.expedicao.peso) {
      pesoExpedicao += parseFloat(r.movimentacao.expedicao.peso) || 0;
    }
    if (r.movimentacao && r.movimentacao.recebimento && r.movimentacao.recebimento.peso) {
      pesoRecebimento += parseFloat(r.movimentacao.recebimento.peso) || 0;
    }
    if (r.cortes && Array.isArray(r.cortes)) cortesList.push(...r.cortes);
    if (r.ocorrencias && Array.isArray(r.ocorrencias)) ocorrenciasCdList.push(...r.ocorrencias);
    if (r.faltas_condutas && Array.isArray(r.faltas_condutas)) faltasColabList.push(...r.faltas_condutas);
  });

  const totalValor = devs.reduce((a, d) => a + (parseFloat(d.valor_reclamado)||0), 0);
  const pendCd = devs.filter(d => d.status_fechamento === 'PENDENTE_FISICO').length;
  const veicParados = rotas.filter(r => r.veiculo_parado && r.status !== 'RESOLVIDO').length;
  const abertasCausaRaiz = devs.filter(d => !d.motivo_real_causa_raiz || !d.acao_tomada);
  const totDescontosGestor = devs.filter(d => d.desconto_produtividade_gestor).length;
  const totalCortesValor = cortesList.reduce((a, c) => a + (parseFloat(c.valor)||0), 0);
  const totalCustoSocorro = rotas.reduce((a, r) => a + (parseFloat(r.custo_socorro)||0), 0);
  const viagensIniciadas = viagens.length;
  const chkNaoRealizado = viagens.filter(v => v.status_saida === 'PENDENTE' || v.checklist_status === 'PENDENTE' || v.status === 'PENDENTE').length;

  // ===== CÁLCULOS DOS NOVOS KPIS =====
  // 1. Lead Time de Abertura (Média de horas entre a criação do chamado e a ação/parecer do gestor)
  let totalLeadTimeHoras = 0;
  let countLeadTime = 0;
  devs.forEach(d => {
    const dtCriado = d.criado_em || d.data_abertura;
    if (dtCriado) {
      const inicio = new Date(dtCriado);
      const fim = d.data_acao_gestor ? new Date(d.data_acao_gestor) : new Date();
      const diffHoras = Math.max(0, (fim - inicio) / (1000 * 60 * 60));
      totalLeadTimeHoras += diffHoras;
      countLeadTime++;
    }
  });
  const leadTimeMedioHoras = countLeadTime > 0 ? (totalLeadTimeHoras / countLeadTime).toFixed(1) : '0.0';

  // 2. Taxa de Completude de Registro (% de ocorrências com TODOS OS CAMPOS preenchidos + pelo menos 1 foto ou 1 vídeo)
  let countCompletas = 0;
  devs.forEach(d => {
    const temCliente = !!(d.cliente_id || d.cliente_nome);
    const temNf = !!(d.nota_fiscal && String(d.nota_fiscal).trim() !== '');
    const temValor = (parseFloat(d.valor_reclamado) || 0) > 0;
    const temMotivo = !!(d.motivo_reclamado && String(d.motivo_reclamado).trim() !== '');
    const temRota = !!(d.carga_rota && String(d.carga_rota).trim() !== '');
    const temMotorista = !!(d.motorista_nome && String(d.motorista_nome).trim() !== '' && String(d.motorista_nome).trim() !== 'N/A');
    const temVeiculo = !!(d.veiculo_placa && String(d.veiculo_placa).trim() !== '' && String(d.veiculo_placa).trim() !== 'N/A');

    // Campos de investigação, apuração e gestão (todos os campos preenchidos)
    const temCausaRaiz = !!(d.motivo_real_causa_raiz && String(d.motivo_real_causa_raiz).trim() !== '' && String(d.motivo_real_causa_raiz).trim() !== 'PENDENTE');
    const temTipoErro = !!(d.tipo_erro && String(d.tipo_erro).trim() !== '' && String(d.tipo_erro).trim() !== 'NÃO CLASSIFICADO' && String(d.tipo_erro).trim() !== 'PENDENTE');
    const temSeparador = !!(d.separador_apurado && String(d.separador_apurado).trim() !== '' && String(d.separador_apurado).trim() !== 'PENDENTE' && String(d.separador_apurado).trim() !== '—');
    const temConferente = !!(d.conferente_apurado && String(d.conferente_apurado).trim() !== '' && String(d.conferente_apurado).trim() !== 'PENDENTE' && String(d.conferente_apurado).trim() !== '—');
    const temAcaoGestor = !!(d.acao_gestor && String(d.acao_gestor).trim() !== '' && String(d.acao_gestor).trim() !== 'PENDENTE');
    const temDestinoCd = !!(d.destino_cd && String(d.destino_cd).trim() !== '' && String(d.destino_cd).trim() !== 'PENDENTE');

    // Pelo menos 1 Foto ou 1 Vídeo
    const temMidia = !!(
      d.foto_url || d.video_url || d.video_investigacao_url ||
      (Array.isArray(d.midia_fotos) && d.midia_fotos.length > 0) ||
      (Array.isArray(d.midia_videos) && d.midia_videos.length > 0) ||
      (Array.isArray(d.fotos) && d.fotos.length > 0) ||
      (Array.isArray(d.videos) && d.videos.length > 0) ||
      (Array.isArray(d.anexos) && d.anexos.length > 0)
    );

    if (
      temCliente && temNf && temValor && temMotivo && temRota && temMotorista && temVeiculo &&
      temCausaRaiz && temTipoErro && temSeparador && temConferente && temAcaoGestor && temDestinoCd &&
      temMidia
    ) {
      countCompletas++;
    }
  });
  const taxaCompletude = devs.length > 0 ? Math.round((countCompletas / devs.length) * 100) : 0;

  // 3. Taxa de Responsabilização ao Monitoramento (% identificados vs % não identificados)
  let countIdentificados = 0;
  let countNaoIdentificados = 0;
  devs.forEach(d => {
    const tipo = (d.tipo_erro || '').toUpperCase().trim();
    if (!tipo || tipo === 'RESP. NÃO IDENTIFICADO' || tipo === 'NÃO CLASSIFICADO' || tipo === 'OUTRO') {
      countNaoIdentificados++;
    } else {
      countIdentificados++;
    }
  });
  const totalMonit = devs.length;
  const pctIdentificados = totalMonit > 0 ? Math.round((countIdentificados / totalMonit) * 100) : 0;
  const pctNaoIdentificados = totalMonit > 0 ? Math.round((countNaoIdentificados / totalMonit) * 100) : 0;

  // ===== RECORRÊNCIAS & REINCIDÊNCIAS =====
  const activeRecTab = window._dashRecorrenciaTab || 'veiculo';

  // Agrupamento integrado
  const recDataMap = {};
  if (activeRecTab === 'veiculo') {
    devs.forEach(d => {
      const key = (d.veiculo_placa || 'N/A').toUpperCase().trim();
      if (!recDataMap[key]) recDataMap[key] = { key, qtd: 0, valor: 0, tipo: 'Veículo (Placa)', itens: [] };
      recDataMap[key].qtd++;
      recDataMap[key].valor += parseFloat(d.valor_reclamado) || 0;
      recDataMap[key].itens.push(d);
    });
    rotas.forEach(r => {
      const key = (r.veiculo_placa || 'N/A').toUpperCase().trim();
      if (!recDataMap[key]) recDataMap[key] = { key, qtd: 0, valor: 0, tipo: 'Veículo (Placa)', itens: [] };
      recDataMap[key].qtd++;
    });
  } else if (activeRecTab === 'rota') {
    devs.forEach(d => {
      const key = (d.carga_rota || d.rota_nome || 'N/A').toUpperCase().trim();
      if (!recDataMap[key]) recDataMap[key] = { key, qtd: 0, valor: 0, tipo: 'Rota', itens: [] };
      recDataMap[key].qtd++;
      recDataMap[key].valor += parseFloat(d.valor_reclamado) || 0;
    });
  } else if (activeRecTab === 'colaborador') {
    devs.forEach(d => {
      const sep = (d.separador_apurado || d.separador_nome || '').toUpperCase().trim();
      const conf = (d.conferente_apurado || d.conferente_nome || '').toUpperCase().trim();
      if (sep && sep !== 'PENDENTE' && sep !== '—') {
        if (!recDataMap[sep]) recDataMap[sep] = { key: `${sep} (Separador)`, qtd: 0, valor: 0, tipo: 'Colaborador CD', itens: [] };
        recDataMap[sep].qtd++;
        recDataMap[sep].valor += parseFloat(d.valor_reclamado) || 0;
      }
      if (conf && conf !== 'PENDENTE' && conf !== '—') {
        if (!recDataMap[conf]) recDataMap[conf] = { key: `${conf} (Conferente)`, qtd: 0, valor: 0, tipo: 'Colaborador CD', itens: [] };
        recDataMap[conf].qtd++;
        recDataMap[conf].valor += parseFloat(d.valor_reclamado) || 0;
      }
    });
  } else if (activeRecTab === 'prestador') {
    devs.forEach(d => {
      const mot = (d.motorista_nome || '').toUpperCase().trim();
      const aju = (d.ajudante_nome || '').toUpperCase().trim();
      if (mot && mot !== 'N/A') {
        if (!recDataMap[mot]) recDataMap[mot] = { key: `${mot} (Motorista)`, qtd: 0, valor: 0, tipo: 'Prestador / Equipe Rota', itens: [] };
        recDataMap[mot].qtd++;
        recDataMap[mot].valor += parseFloat(d.valor_reclamado) || 0;
      }
      if (aju && aju !== 'N/A') {
        if (!recDataMap[aju]) recDataMap[aju] = { key: `${aju} (Ajudante)`, qtd: 0, valor: 0, tipo: 'Prestador / Equipe Rota', itens: [] };
        recDataMap[aju].qtd++;
        recDataMap[aju].valor += parseFloat(d.valor_reclamado) || 0;
      }
    });
  }

  const recList = Object.values(recDataMap).sort((a,b) => b.qtd - a.qtd);

  return `
    <div class="space-y-6">
      <!-- TOPO -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-white tracking-tight">📊 Painel Principal — Dashboard Geral</h1>
          <p class="text-xs text-slate-400">Consolidação executiva completa dividida por Transporte, Operação e Gestão</p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <button onclick="switchTab('sac_abertura')" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-lg shadow flex items-center gap-1.5">+ Nova Devolução</button>
          <button onclick="switchTab('rota_ocorrencias')" class="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-2 rounded-lg shadow flex items-center gap-1.5">🚨 Frota / Chamado em Rota</button>
        </div>
      </div>

      <!-- BARRA DE FILTRO PERIÓDICO (DATA DE ATÉ DATA) -->
      <div class="bg-slate-900 border border-slate-800 p-3.5 rounded-xl shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="bg-emerald-600/20 p-2 rounded-lg border border-emerald-500/30 text-emerald-400 text-lg font-bold">📅</div>
          <div>
            <div class="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
              FILTRO POR PERÍODO (DATA A DATA)
              ${(fDe || fAte) ? `<span class="bg-emerald-950 text-emerald-300 border border-emerald-700 text-[10px] px-2 py-0.5 rounded font-extrabold uppercase">FILTRO ATIVO</span>` : `<span class="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded font-medium">HISTÓRICO COMPLETO</span>`}
            </div>
            <p class="text-[11px] text-slate-400 font-medium">Selecione o período inicial e final para visualizar os dados consolidados do painel</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div class="flex items-center gap-2 bg-slate-950 p-1.5 rounded-lg border border-slate-800 shrink-0">
            <span class="text-[10px] text-slate-400 font-bold uppercase pl-1">De:</span>
            <input type="date" value="${fDe}" onchange="window._dashFiltroDe=this.value; renderApp()" class="bg-slate-900 border border-slate-700 text-white text-xs rounded p-1 font-bold">
            <span class="text-[10px] text-slate-400 font-bold uppercase">Até:</span>
            <input type="date" value="${fAte}" onchange="window._dashFiltroAte=this.value; renderApp()" class="bg-slate-900 border border-slate-700 text-white text-xs rounded p-1 font-bold">
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <button onclick="setDashboardPeriodo('hoje')" class="bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold text-[11px] px-2.5 py-1.5 rounded border border-emerald-800/60 shadow">Hoje</button>
            <button onclick="setDashboardPeriodo('semana')" class="bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-[11px] px-2.5 py-1.5 rounded border border-amber-800/60 shadow">Esta Semana</button>
            <button onclick="setDashboardPeriodo('mes')" class="bg-slate-800 hover:bg-slate-700 text-blue-300 font-bold text-[11px] px-2.5 py-1.5 rounded border border-blue-800/60 shadow">Este Mês</button>
            ${(fDe || fAte) ? `<button onclick="setDashboardPeriodo('limpar')" class="bg-red-950 hover:bg-red-900 text-red-300 font-bold text-[11px] px-2.5 py-1.5 rounded border border-red-800 shadow" title="Limpar Filtro">✕ Limpar</button>` : ''}
          </div>
        </div>
      </div>

      <!-- PAINEL DE ALERTAS CRÍTICOS EM TEMPO REAL -->
      ${(veicParados > 0 || pendCd > 0 || abertasCausaRaiz.length > 0) ? `
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
          <div class="flex items-center justify-between border-b border-slate-800 pb-2">
            <span class="text-xs font-bold text-amber-400 uppercase flex items-center gap-1.5">
              <span>🔔</span> Alertas & Pendências Críticas em Tempo Real
            </span>
            <span class="text-[10px] text-slate-500">Ação imediata requerida</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            ${veicParados > 0 ? `
              <div class="bg-slate-950 border border-red-900/60 rounded-xl p-3 flex items-center justify-between gap-2">
                <div class="flex items-center gap-3 overflow-hidden">
                  <div class="w-9 h-9 rounded-lg bg-red-950 border border-red-800 text-red-400 flex items-center justify-center shrink-0 text-base font-bold">🚨</div>
                  <div class="truncate">
                    <div class="text-xs font-black text-red-300 truncate">${veicParados} Veículo(s) Parado(s)</div>
                    <div class="text-[10px] text-slate-400 truncate">Socorro / Manutenção ativa</div>
                  </div>
                </div>
                <button onclick="switchTab('rota_ocorrencias')" class="bg-red-900/40 hover:bg-red-900/80 border border-red-700 text-red-200 font-bold px-2.5 py-1 rounded text-[11px] shrink-0">Ver Frota</button>
              </div>` : ''}

            ${pendCd > 0 ? `
              <div class="bg-slate-950 border border-amber-900/60 rounded-xl p-3 flex items-center justify-between gap-2">
                <div class="flex items-center gap-3 overflow-hidden">
                  <div class="w-9 h-9 rounded-lg bg-amber-950 border border-amber-800 text-amber-400 flex items-center justify-center shrink-0 text-base font-bold">📦</div>
                  <div class="truncate">
                    <div class="text-xs font-black text-amber-300 truncate">${pendCd} Retorno(s) Pendente(s) CD</div>
                    <div class="text-[10px] text-slate-400 truncate">Aguardando entrada física</div>
                  </div>
                </div>
                <button onclick="switchTab('cd_recepcao')" class="bg-amber-900/40 hover:bg-amber-900/80 border border-amber-700 text-amber-200 font-bold px-2.5 py-1 rounded text-[11px] shrink-0">Ver CD</button>
              </div>` : ''}

            ${abertasCausaRaiz.length > 0 ? `
              <div class="bg-slate-950 border border-orange-900/60 rounded-xl p-3 flex items-center justify-between gap-2">
                <div class="flex items-center gap-3 overflow-hidden">
                  <div class="w-9 h-9 rounded-lg bg-orange-950 border border-orange-800 text-orange-400 flex items-center justify-center shrink-0 text-base font-bold">⏳</div>
                  <div class="truncate">
                    <div class="text-xs font-black text-orange-300 truncate">${abertasCausaRaiz.length} Análise(s) Pendente(s)</div>
                    <div class="text-[10px] text-slate-400 truncate">Causa raiz não apurada</div>
                  </div>
                </div>
                <button onclick="switchTab('sac_investigacao')" class="bg-orange-900/40 hover:bg-orange-900/80 border border-orange-700 text-orange-200 font-bold px-2.5 py-1 rounded text-[11px] shrink-0">Analisar</button>
              </div>` : ''}
          </div>
        </div>` : ''}

      <!-- ==================== SEÇÃO 1: MÓDULO TRANSPORTE ==================== -->
      <div class="bg-slate-900 border border-blue-900/60 rounded-2xl p-5 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-blue-800/60 pb-3">
          <h2 class="text-sm font-black text-blue-400 uppercase tracking-wider flex items-center gap-2">
            <span>🚍</span> KPIS DO DEPARTAMENTO DE TRANSPORTE
          </h2>
          <span class="text-xs text-slate-400 font-bold">Gestão de Frota, Viagens e Socorro</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Viagens Iniciadas</div>
            <div class="text-xl font-black text-blue-400 mt-1">${viagensIniciadas}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Escala ativa de entregas</div>
          </div>
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Veículos Parados em Rota</div>
            <div class="text-xl font-black ${veicParados > 0 ? 'text-red-400 animate-pulse' : 'text-slate-300'} mt-1">${veicParados}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Socorro mecânico</div>
          </div>
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Trocas de Veículos</div>
            <div class="text-xl font-black text-purple-400 mt-1">${trocas.length}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Substituições na rota</div>
          </div>
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Checklist Pendente</div>
            <div class="text-xl font-black ${chkNaoRealizado > 0 ? 'text-red-400' : 'text-slate-300'} mt-1">${chkNaoRealizado}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Saída não iniciada</div>
          </div>
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Custo Socorro Mecânico</div>
            <div class="text-lg font-black text-red-400 mt-1">R$ ${totalCustoSocorro.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Despesa de frota</div>
          </div>
        </div>
      </div>

      <!-- ==================== SEÇÃO 2: MÓDULO OPERAÇÃO ==================== -->
      <div class="bg-slate-900 border border-emerald-900/60 rounded-2xl p-5 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-emerald-800/60 pb-3">
          <h2 class="text-sm font-black text-emerald-400 uppercase tracking-wider flex items-center gap-2">
            <span>🏭</span> KPIS DO DEPARTAMENTO DE OPERAÇÃO (CD & ARMAZÉM)
          </h2>
          <span class="text-xs text-slate-400 font-bold">Gestão Física e Movimentação</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Retornos Pendentes CD</div>
            <div class="text-xl font-black text-amber-400 mt-1">${pendCd}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Aguardando entrada física</div>
          </div>
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Peso Expedição (Saída)</div>
            <div class="text-lg font-black text-emerald-400 mt-1">${pesoExpedicao.toLocaleString('pt-BR',{minimumFractionDigits:2})} Kg</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Movimentado expedido</div>
          </div>
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Peso Recebimento (Entrada)</div>
            <div class="text-lg font-black text-blue-400 mt-1">${pesoRecebimento.toLocaleString('pt-BR',{minimumFractionDigits:2})} Kg</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Movimentado recebido</div>
          </div>
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Cortes de Produtos (Valor)</div>
            <div class="text-lg font-black text-red-400 mt-1">R$ ${totalCortesValor.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">${cortesList.length} produto(s) cortado(s)</div>
          </div>
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Ocorrências do CD</div>
            <div class="text-xl font-black text-orange-400 mt-1">${ocorrenciasCdList.length + faltasColabList.length}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Apontamentos internos</div>
          </div>
        </div>
      </div>

      <!-- ==================== SEÇÃO 3: MÓDULO GESTÃO ==================== -->
      <div class="bg-slate-900 border border-purple-900/60 rounded-2xl p-5 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-purple-800/60 pb-3">
          <h2 class="text-sm font-black text-purple-400 uppercase tracking-wider flex items-center gap-2">
            <span>👔</span> KPIS DO DEPARTAMENTO DE GESTÃO & MONITORAMENTO
          </h2>
          <span class="text-xs text-slate-400 font-bold">Desempenho, Lead Time e Apuração</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <!-- CARD DEVOLUÇÃO TOTAL -->
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Valor Total Reclamado</div>
            <div class="text-lg font-black text-emerald-400 mt-1">R$ ${totalValor.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">${devs.length} devolução(ões)</div>
          </div>
          <!-- CARD LEAD TIME DE ABERTURA (NOVO) -->
          <div class="bg-slate-950 border border-amber-900/60 p-3 rounded-xl">
            <div class="text-[10px] text-amber-400 font-bold uppercase flex items-center gap-1">
              <span>⏱️</span> Lead Time Abertura
            </div>
            <div class="text-xl font-black text-amber-300 mt-1">${leadTimeMedioHoras} h</div>
            <div class="text-[10px] text-slate-400 mt-0.5">Até ação do gestor</div>
          </div>
          <!-- CARD TAXA DE COMPLETUDE DE REGISTRO (NOVO) -->
          <div class="bg-slate-950 border border-blue-900/60 p-3 rounded-xl">
            <div class="text-[10px] text-blue-400 font-bold uppercase flex items-center gap-1">
              <span>✅</span> Taxa de Completude
            </div>
            <div class="text-xl font-black text-blue-300 mt-1">${taxaCompletude}%</div>
            <div class="text-[10px] text-slate-400 mt-0.5">100% dos Campos + Foto/Vídeo</div>
          </div>
          <!-- CARD TAXA DE RESPONSABILIZAÇÃO MONITORAMENTO (NOVO) -->
          <div class="bg-slate-950 border border-emerald-900/60 p-3 rounded-xl">
            <div class="text-[10px] text-emerald-400 font-bold uppercase flex items-center gap-1">
              <span>🔍</span> Responsabilização
            </div>
            <div class="text-lg font-black text-emerald-300 mt-1">${pctIdentificados}% Identif.</div>
            <div class="text-[10px] text-red-400 mt-0.5">${pctNaoIdentificados}% Não Identif.</div>
          </div>
          <!-- CARD DESCONTOS GESTOR -->
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Descontos Gerados</div>
            <div class="text-xl font-black text-purple-300 mt-1">${totDescontosGestor}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Produtividade</div>
          </div>
          <!-- CARD CAUSA RAIZ PENDENTE -->
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <div class="text-[10px] text-slate-400 font-bold uppercase">Análises Pendentes</div>
            <div class="text-xl font-black text-orange-400 mt-1">${abertasCausaRaiz.length}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Causa raiz pendente</div>
          </div>
        </div>
      </div>

      <!-- ==================== PAINEL INTEGRADO DE RECORRÊNCIAS E REINCIDÊNCIAS ==================== -->
      <div class="bg-slate-900 border border-amber-900/70 rounded-2xl p-5 shadow-2xl space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-800/60 pb-3">
          <div>
            <h2 class="text-sm font-black text-amber-400 uppercase tracking-wider flex items-center gap-2">
              <span>⚠️</span> PAINEL DE RECORRÊNCIAS E REINCIDÊNCIAS INTEGRADAS
            </h2>
            <p class="text-xs text-slate-400">Mapeamento automatizado de falhas repetidas por Veículo, Rota, Colaborador e Prestador</p>
          </div>

          <!-- BOTÕES DE SUBABAS DE RECORRÊNCIA -->
          <div class="flex gap-1 bg-slate-950 p-1.5 rounded-xl border border-slate-800 shrink-0">
            <button onclick="window._dashRecorrenciaTab='veiculo'; renderApp()" class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${activeRecTab === 'veiculo' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}">🚛 Veículo</button>
            <button onclick="window._dashRecorrenciaTab='rota'; renderApp()" class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${activeRecTab === 'rota' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}">📍 Rota</button>
            <button onclick="window._dashRecorrenciaTab='colaborador'; renderApp()" class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${activeRecTab === 'colaborador' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}">🏭 Colaborador (CD)</button>
            <button onclick="window._dashRecorrenciaTab='prestador'; renderApp()" class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${activeRecTab === 'prestador' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}">👤 Prestador (Rota)</button>
          </div>
        </div>

        <div class="overflow-x-auto rounded-xl border border-slate-800">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-950 text-slate-300 text-[10px] uppercase border-b border-slate-800">
              <tr>
                <th class="p-3">Identificação / Item</th>
                <th class="p-3">Categoria</th>
                <th class="p-3 text-center">Ocorrências Acumuladas</th>
                <th class="p-3 text-center">Classificação de Risco</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800 text-xs">
              ${recList.length === 0 ? `<tr><td colspan="4" class="p-6 text-center text-slate-500">Nenhuma recorrência identificada na categoria selecionada.</td></tr>` :
              recList.map(item => {
                const badge = item.qtd >= 3
                  ? `<span class="bg-red-950 text-red-300 border border-red-700 font-extrabold px-2.5 py-1 rounded text-[10px] shadow">🚨 Crítico (${item.qtd}x)</span>`
                  : item.qtd === 2
                  ? `<span class="bg-amber-950 text-amber-300 border border-amber-700 font-bold px-2.5 py-1 rounded text-[10px]">⚠️ Atenção (2x)</span>`
                  : `<span class="bg-slate-800 text-slate-300 border border-slate-700 font-medium px-2 py-0.5 rounded text-[10px]">Normal (1x)</span>`;

                return `
                  <tr class="hover:bg-slate-800/40">
                    <td class="p-3 font-bold text-white">${item.key}</td>
                    <td class="p-3 text-slate-400">${item.tipo}</td>
                    <td class="p-3 text-center font-black text-amber-400 text-sm">${item.qtd}</td>
                    <td class="p-3 text-center">${badge}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// ===== MÓDULO 1: ABERTURA SAC =====
function renderSacAberturaView() {
  const veiculos = db.data.veiculos.filter(v => v.situacao !== 'Inativo');
  const motivos = db.data.motivos_devolucao;
  const motoristas = db.data.motoristas;
  const ajudantes = db.data.ajudantes;
  const rotas = db.data.rotas || [];
  uploadedFotoBase64 = '';
  uploadedVideoBase64 = '';

  // Gerar próximo número de protocolo automaticamente
  const nextNum = (db.data.ocorrencias_devolucao.length + 1).toString().padStart(3,'0');
  const nextProtocol = `DEV-${new Date().getFullYear()}-${nextNum}`;

  return `
    <div class="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 class="text-xl font-black text-white flex items-center gap-2"><span>📝</span> Devolução SAC</h1>
        <p class="text-xs text-slate-400">Número de protocolo gerado automaticamente • Upload direto do dispositivo</p>
      </div>

      <form onsubmit="handleSacAberturaSubmit(event)" class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-6">

        <!-- SEÇÃO 1: CABEÇALHO -->
        <div class="space-y-3">
          <h3 class="text-xs font-bold text-emerald-400 uppercase tracking-wider border-b border-slate-800 pb-2">1. Cabeçalho da Devolução</h3>

          <div class="bg-emerald-950/30 border border-emerald-800/50 rounded-lg p-3 flex items-center gap-3">
            <div class="text-emerald-400 text-xl">🔖</div>
            <div>
              <div class="text-[10px] text-slate-400 font-semibold uppercase">Nº Protocolo (gerado automaticamente)</div>
              <div class="text-lg font-black text-emerald-400">${nextProtocol}</div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Número da Carga *</label>
              <input type="number" id="sac-carga-numero" required placeholder="Ex: 10450" oninput="checkCargaExistente(this.value)" class="w-full bg-slate-800 border border-slate-700 text-emerald-400 font-bold rounded-lg p-2 text-xs">
              <div id="carga-hint" class="text-[10px] text-emerald-400 mt-1 hidden">✔ Carga encontrada — preenchimento automático!</div>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Veículo / Placa *</label>
              <select id="sac-veiculo-id" required class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
                <option value="">-- Selecione o Veículo --</option>
                ${veiculos.map(v => `<option value="${v.id}" data-placa="${v.placa}">${v.placa} — ${v.tipo||v.modelo}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Nome da Rota *</label>
              <select id="sac-rota-nome" required class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
                <option value="">-- Selecione a Rota --</option>
                ${rotas.map(r => `<option value="${r}">${r}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Motorista *</label>
              <select id="sac-motorista-id" required class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
                <option value="">-- Selecione o Motorista --</option>
                ${motoristas.map(m => `<option value="${m.id}">${m.nome}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Ajudante</label>
              <select id="sac-ajudante-id" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
                <option value="">-- Selecione o Ajudante --</option>
                ${ajudantes.map(a => `<option value="${a.id}">${a.nome}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- SEÇÃO 2: IDENTIFICAÇÃO -->
        <div class="space-y-3">
          <h3 class="text-xs font-bold text-emerald-400 uppercase tracking-wider border-b border-slate-800 pb-2">2. Identificação da Ocorrência</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Motivo Reclamado *</label>
              <select id="sac-motivo-reclamado" required class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
                <option value="">-- Selecione o Motivo --</option>
                ${motivos.map(m => `<option value="${m}">${m}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Nota Fiscal (NF)</label>
              <input type="text" id="sac-nf" placeholder="Ex: NF-99412 (opcional)" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
            </div>
          </div>

          <!-- BUSCA DE CLIENTE POR TEXTO -->
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1">Cliente * (busque por código ou nome)</label>
            <input type="text" id="sac-cliente-busca" placeholder="Digite código ou nome do cliente..." oninput="filtrarClientes(this.value)" autocomplete="off"
              class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:border-emerald-500 focus:outline-none">
            <input type="hidden" id="sac-cliente-id" required>
            <div id="sac-cliente-selecionado" class="hidden mt-1.5 bg-emerald-950/40 border border-emerald-800/60 rounded-lg px-3 py-2 text-xs flex items-center justify-between">
              <span id="sac-cliente-label" class="text-emerald-300 font-semibold"></span>
              <button type="button" onclick="limparCliente()" class="text-red-400 hover:text-red-300 font-bold ml-2">✕</button>
            </div>
            <div id="sac-cliente-lista" class="hidden mt-1 bg-slate-800 border border-slate-700 rounded-lg overflow-y-auto max-h-40 text-xs shadow-xl z-10 relative"></div>
          </div>

          <!-- CLIENTE EMITE NF -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Cliente Emite Nota de Devolução? *</label>
              <div class="flex gap-3 mt-1">
                <label class="flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-700 flex-1 justify-center">
                  <input type="radio" name="sac-emite-nf" value="sim" required class="text-emerald-500">
                  <span class="text-white font-semibold text-xs">Sim</span>
                </label>
                <label class="flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-700 flex-1 justify-center">
                  <input type="radio" name="sac-emite-nf" value="nao" checked class="text-slate-500">
                  <span class="text-white font-semibold text-xs">Não</span>
                </label>
              </div>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Forma de Acerto Financeiro *</label>
              <select id="sac-forma-acerto" required class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
                <option value="ABATIMENTO">Abatimento no Boleto / Fatura</option>
                <option value="JR_PAGA_DIFERENCA">JR Paga a Diferença (Reembolso)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SEÇÃO 3: PRODUTOS -->
        <div class="space-y-3">
          <div class="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 class="text-xs font-bold text-emerald-400 uppercase tracking-wider">3. Produtos Devolvidos</h3>
            <div class="flex gap-2 items-center">
              <label class="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input type="checkbox" id="chk-sem-itens" onchange="toggleSemItens(this.checked)" class="rounded bg-slate-800">
                Sem produtos a listar
              </label>
              <button type="button" onclick="addItemRow()" id="btn-add-item" class="bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-bold px-2.5 py-1 rounded">+ Item</button>
            </div>
          </div>

          <div id="sem-itens-box" class="hidden bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 text-xs">
            <div class="font-bold text-amber-300 mb-2">⚠️ Informe o motivo de não ter produtos:</div>
            <textarea id="obs-sem-itens" rows="2" placeholder="Ex: Devolução apenas fiscal, item reentregue, etc." class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs"></textarea>
          </div>

          <div id="items-table-container" class="overflow-x-auto -mx-1">
            <table class="w-full text-left text-xs" id="items-table">
              <thead class="bg-slate-950 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th class="p-2 min-w-[200px]">Produto (busque por código ou descrição)</th>
                  <th class="p-2 w-16">Qtd</th>
                  <th class="p-2 w-24">Vlr Unit</th>
                  <th class="p-2 min-w-[120px]">Motivo</th>
                  <th class="p-2 w-8"></th>
                </tr>
              </thead>
              <tbody id="items-tbody" class="divide-y divide-slate-800"></tbody>
            </table>
          </div>
        </div>

        <!-- SEÇÃO 4: VALOR, FOTO E VÍDEO -->
        <div class="space-y-3">
          <h3 class="text-xs font-bold text-emerald-400 uppercase tracking-wider border-b border-slate-800 pb-2">4. Valor, Foto & Vídeo da Avaria</h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Valor Total Reclamado (R$) *</label>
              <input type="number" step="0.01" id="sac-valor-reclamado" required placeholder="0.00" class="w-full bg-slate-800 border border-slate-700 text-emerald-400 font-bold rounded-lg p-2 text-xs">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">📷 Foto da Avaria (cel ou PC)</label>
              <input type="file" id="sac-foto-file" accept="image/*" capture="environment" onchange="handleFotoUpload(this)"
                class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-1.5 text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-emerald-700 file:text-white hover:file:bg-emerald-600">
              <div id="foto-preview-container" class="hidden mt-1">
                <img id="foto-preview-img" src="" alt="Preview" class="w-20 h-20 object-cover rounded-lg border border-emerald-500 shadow">
              </div>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">🎥 Vídeo da Avaria (cel ou PC)</label>
              <input type="file" id="sac-video-file" accept="video/*" capture="environment" onchange="handleVideoUpload(this, 'sac')"
                class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-1.5 text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-700 file:text-white hover:file:bg-blue-600">
              <div id="video-preview-container" class="hidden mt-1">
                <video id="video-preview-el" controls class="w-full max-h-24 rounded-lg border border-blue-500 shadow"></video>
              </div>
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1">Detalhamento da Ocorrência *</label>
            <textarea id="sac-detalhamento" rows="3" required placeholder="Descreva os detalhes passados pelo cliente ou motorista..." class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs"></textarea>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-800 flex justify-end gap-3">
          <button type="button" onclick="switchTab('dashboard')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2 rounded-lg text-xs">Cancelar</button>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-2 rounded-lg text-xs shadow-lg">Registrar Ocorrência</button>
        </div>
      </form>
    </div>`;
}

// ---- Busca de Clientes por texto ----
function filtrarClientes(query) {
  const lista = document.getElementById('sac-cliente-lista');
  const sel = document.getElementById('sac-cliente-selecionado');
  if (!lista) return;
  if (!query || query.length < 2) { lista.classList.add('hidden'); return; }
  const q = query.toUpperCase().trim();
  const clientes = db.data.clientes_full || [];
  const resultados = clientes.filter(([cod, nome]) =>
    String(cod).includes(q) || nome.includes(q)
  ).slice(0, 20);
  if (resultados.length === 0) {
    lista.innerHTML = '<div class="p-3 text-slate-500">Nenhum cliente encontrado</div>';
    lista.classList.remove('hidden');
    return;
  }
  lista.innerHTML = resultados.map(([cod, nome]) => `
    <div onclick="selecionarCliente(${cod}, decodeURIComponent('${encodeURIComponent(nome)}'), '${cod}')" 
      class="px-3 py-2 cursor-pointer hover:bg-emerald-900/40 flex items-center gap-2 border-b border-slate-700/50 last:border-0">
      <span class="text-emerald-400 font-bold w-12 shrink-0">${cod}</span>
      <span class="text-white">${nome}</span>
    </div>`).join('');
  lista.classList.remove('hidden');
  if (sel) sel.classList.add('hidden');
}

function selecionarCliente(id, nome, cod) {
  document.getElementById('sac-cliente-id').value = id;
  document.getElementById('sac-cliente-busca').value = `${cod} - ${nome}`;
  const label = document.getElementById('sac-cliente-label');
  if (label) label.textContent = `${cod} - ${nome}`;
  const selDiv = document.getElementById('sac-cliente-selecionado');
  if (selDiv) selDiv.classList.remove('hidden');
  const lista = document.getElementById('sac-cliente-lista');
  if (lista) lista.classList.add('hidden');
}

function limparCliente() {
  document.getElementById('sac-cliente-id').value = '';
  document.getElementById('sac-cliente-busca').value = '';
  const sel = document.getElementById('sac-cliente-selecionado');
  if (sel) sel.classList.add('hidden');
}

// ---- Busca de Produtos (com suporte a acentos, código, descrição e categoria) ----
function filtrarProdutos(query, rowId) {
  const lista = document.getElementById(`prod-lista-${rowId}`);
  if (!lista) return;
  if (!query || query.trim().length < 1) { lista.classList.add('hidden'); return; }
  
  const norm = str => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const q = norm(query);
  const produtos = db.data.produtos || [];
  
  const resultados = produtos.filter(p => {
    const cod = norm(p.codigo_produto);
    const desc = norm(p.descricao);
    const cat = norm(p.categoria);
    return cod.includes(q) || desc.includes(q) || cat.includes(q);
  }).slice(0, 30);

  if (resultados.length === 0) {
    lista.innerHTML = '<div class="p-2.5 text-slate-400 text-[11px] italic">Nenhum produto encontrado na lista de cadastro</div>';
    lista.classList.remove('hidden');
    return;
  }
  
  lista.innerHTML = resultados.map(p => `
    <div onclick="selecionarProduto('${rowId}', '${p.id}', '${p.codigo_produto}', decodeURIComponent('${encodeURIComponent(p.descricao)}'), ${p.valor_unitario_padrao})"
      class="px-2.5 py-2 cursor-pointer hover:bg-emerald-800/60 flex items-center justify-between gap-2 border-b border-slate-700/50 last:border-0 text-[11px] transition">
      <div class="truncate">
        <span class="text-emerald-400 font-mono font-bold mr-1.5">[${p.codigo_produto}]</span>
        <span class="text-white font-medium">${p.descricao}</span>
      </div>
      <span class="text-[9px] text-slate-400 shrink-0 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">${p.categoria||'Geral'}</span>
    </div>`).join('');
  lista.classList.remove('hidden');
}

function selecionarProduto(rowId, id, cod, desc, valor) {
  const row = document.getElementById(`item-row-${rowId}`);
  if (!row) return;
  row.querySelector('.item-prod-id').value = id;
  row.querySelector('.item-prod-busca').value = `${cod} - ${desc}`;
  row.querySelector('.item-val').value = parseFloat(valor).toFixed(2);
  const lista = document.getElementById(`prod-lista-${rowId}`);
  if (lista) lista.classList.add('hidden');
  calcTotalValores();
}

// Fechar lista de produtos ao clicar fora
document.addEventListener('click', (e) => {
  if (!e.target.closest('.item-prod-busca') && !e.target.closest('[id^="prod-lista-"]')) {
    document.querySelectorAll('[id^="prod-lista-"]').forEach(el => el.classList.add('hidden'));
  }
});

// ---- Upload Multi-arquivo de Mídia ----
function handleFotoUpload(inputEl) {
  const files = Array.from(inputEl.files || []);
  if (!files.length) return;
  uploadedFotosBase64 = [];
  const container = document.getElementById('foto-preview-container');
  const gallery = document.getElementById('foto-preview-gallery') || document.getElementById('foto-preview-container');

  if (gallery) {
    gallery.innerHTML = '<div class="font-bold text-slate-400 text-[10px] w-full mb-1">Fotos Anexadas (' + files.length + '):</div><div class="flex gap-2 flex-wrap" id="foto-gallery-inner"></div>';
  }
  const inner = document.getElementById('foto-gallery-inner');

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      uploadedFotosBase64.push(e.target.result);
      if (inner) {
        const img = document.createElement('img');
        img.src = e.target.result;
        img.className = 'w-20 h-20 object-cover rounded-lg border border-slate-700 shadow';
        inner.appendChild(img);
      }
      if (container) container.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
}

function handleVideoUpload(inputEl, context) {
  const files = Array.from(inputEl.files || []);
  if (!files.length) return;
  if (context === 'sac') uploadedVideosBase64 = [];
  else uploadedVideosBase64Inv = [];

  const containerId = context === 'sac' ? 'video-preview-container' : 'inv-video-preview-container';
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = '<div class="font-bold text-slate-400 text-[10px] w-full mb-1">Vídeos Anexados (' + files.length + '):</div><div class="flex gap-2 flex-wrap" id="video-gallery-inner-' + context + '"></div>';
    container.classList.remove('hidden');
  }
  const inner = document.getElementById('video-gallery-inner-' + context);

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      if (context === 'sac') uploadedVideosBase64.push(e.target.result);
      else uploadedVideosBase64Inv.push(e.target.result);

      if (inner) {
        const video = document.createElement('video');
        video.src = e.target.result;
        video.controls = true;
        video.className = 'w-48 max-h-24 rounded border border-blue-500 shadow';
        inner.appendChild(video);
      }
    };
    reader.readAsDataURL(file);
  });
}

function toggleSemItens(checked) {
  document.getElementById('sem-itens-box')?.classList.toggle('hidden', !checked);
  document.getElementById('items-table-container')?.classList.toggle('hidden', checked);
  document.getElementById('btn-add-item')?.classList.toggle('hidden', checked);
}

function checkCargaExistente(val) {
  if (!val) return;
  const carga = db.data.cargas.find(c => String(c.numero_carga) === String(val));
  const hint = document.getElementById('carga-hint');
  if (carga) {
    if (hint) hint.classList.remove('hidden');
    const rotaSel = document.getElementById('sac-rota-nome');
    if (rotaSel && carga.rota_nome) {
      Array.from(rotaSel.options).forEach(opt => { opt.selected = opt.value === carga.rota_nome; });
    }
    if (carga.veiculo_id) { const s = document.getElementById('sac-veiculo-id'); if(s) s.value = carga.veiculo_id; }
    if (carga.motorista_id) { const s = document.getElementById('sac-motorista-id'); if(s) s.value = carga.motorista_id; }
    if (carga.ajudante_id) { const s = document.getElementById('sac-ajudante-id'); if(s) s.value = carga.ajudante_id; }
  } else {
    if (hint) hint.classList.add('hidden');
  }
}

function setupItemRows() {
  const tbody = document.getElementById('items-tbody');
  if (tbody && tbody.children.length === 0) addItemRow();
}

function addItemRow() {
  const tbody = document.getElementById('items-tbody');
  if (!tbody) return;
  const rowId = Date.now() + Math.floor(Math.random()*100);
  const tr = document.createElement('tr');
  tr.id = `item-row-${rowId}`;
  tr.className = 'relative';
  tr.innerHTML = `
    <td class="p-1.5 relative">
      <input type="text" placeholder="Busque por código ou descrição..." oninput="filtrarProdutos(this.value, '${rowId}')"
        class="item-prod-busca w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
      <input type="hidden" class="item-prod-id">
      <div id="prod-lista-${rowId}" class="hidden absolute left-0 top-full z-20 bg-slate-800 border border-slate-700 rounded-lg shadow-xl w-80 max-h-40 overflow-y-auto"></div>
    </td>
    <td class="p-1.5"><input type="number" value="1" min="1" onchange="calcTotalValores()" class="item-qtd w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs"></td>
    <td class="p-1.5"><input type="number" step="0.01" value="0.00" onchange="calcTotalValores()" class="item-val w-full bg-slate-800 border border-slate-700 text-emerald-400 font-bold rounded p-1.5 text-xs"></td>
    <td class="p-1.5"><input type="text" placeholder="Motivo..." class="item-motivo w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs"></td>
    <td class="p-1.5 text-center"><button type="button" onclick="removeItemRow('${rowId}')" class="text-red-400 hover:text-red-300 font-bold text-base leading-none">✕</button></td>`;
  tbody.appendChild(tr);
}

function removeItemRow(rowId) {
  document.getElementById(`item-row-${rowId}`)?.remove();
  calcTotalValores();
}

function calcTotalValores() {
  let total = 0;
  document.querySelectorAll('#items-tbody tr').forEach(r => {
    const qtd = parseFloat(r.querySelector('.item-qtd')?.value) || 0;
    const val = parseFloat(r.querySelector('.item-val')?.value) || 0;
    total += qtd * val;
  });
  const inp = document.getElementById('sac-valor-reclamado');
  if (inp) inp.value = total.toFixed(2);
}

function handleSacAberturaSubmit(e) {
  e.preventDefault();
  const semItens = document.getElementById('chk-sem-itens')?.checked || false;
  const obsSemItens = document.getElementById('obs-sem-itens')?.value || '';
  const clienteId = document.getElementById('sac-cliente-id').value;
  const clienteLabel = document.getElementById('sac-cliente-label')?.textContent || '';

  if (!clienteId) { alert('Selecione um cliente!'); return; }

  const emiteNfEl = document.querySelector('input[name="sac-emite-nf"]:checked');
  const emiteNf = emiteNfEl ? emiteNfEl.value : 'nao';

  const itens = [];
  if (!semItens) {
    document.querySelectorAll('#items-tbody tr').forEach(r => {
      const prodId = r.querySelector('.item-prod-id')?.value;
      if (prodId) itens.push({
        produto_id: prodId,
        quantidade: r.querySelector('.item-qtd')?.value || 1,
        valor_unitario: r.querySelector('.item-val')?.value || 0,
        motivo_item: r.querySelector('.item-motivo')?.value || ''
      });
    });
    if (itens.length === 0) {
      alert('Adicione ao menos 1 produto ou marque "Sem produtos a listar"!');
      return;
    }
  } else if (!obsSemItens.trim()) {
    alert('Informe o motivo de não haver produtos a listar.');
    return;
  }

  const veicSel = document.getElementById('sac-veiculo-id');
  const veicOpt = veicSel.options[veicSel.selectedIndex];
  const dev = db.addDevolucao({
    carga_numero: document.getElementById('sac-carga-numero').value,
    veiculo_id: veicSel.value,
    veiculo_placa: veicOpt?.getAttribute('data-placa') || '',
    rota_nome: document.getElementById('sac-rota-nome').value,
    motorista_id: document.getElementById('sac-motorista-id').value,
    ajudante_id: document.getElementById('sac-ajudante-id').value,
    cliente_id: clienteId,
    cliente_nome: clienteLabel.split(' - ').slice(1).join(' - ') || clienteLabel,
    nota_fiscal: document.getElementById('sac-nf').value || '',
    motivo_reclamado: document.getElementById('sac-motivo-reclamado').value,
    valor_reclamado: document.getElementById('sac-valor-reclamado').value,
    detalhamento_texto: document.getElementById('sac-detalhamento').value,
    foto_url: uploadedFotoBase64,
    video_url: uploadedVideoBase64,
    cliente_emite_nf: emiteNf,
    forma_acerto: document.getElementById('sac-forma-acerto').value,
    sem_itens: semItens,
    observacao_sem_itens: obsSemItens
  }, itens);

  alert(`✅ Ocorrência registrada!\nProtocolo: ${dev.numero_protocolo}`);
  switchTab('dashboard');
}

// ===== MÓDULO 2: INVESTIGAÇÃO & CAUSA RAIZ =====
let activeInvestigacaoSubTab = 'pendentes';

function renderSacInvestigacaoView() {
  const todosDevs = db.getDevolucoes();
  const usuarios = db.data.usuarios;
  const motivos = db.data.motivos_devolucao;
  const causasRaiz = db.data.causas_raiz || [];
  const separadores = db.data.separadores_conferentes || [];
  const erros = ["ERRO CARREGAMENTO","ERRO COMERCIAL","ERRO INDÚSTRIA","ERRO LOGÍSTICO","ERRO MOTORISTA","OUTRO","PROBLEMA MECÂNICO","RESP. NÃO IDENTIFICADO"];

  const fDataDe = window._invFiltroDataDe || '';
  const fDataAte = window._invFiltroDataAte || '';

  let devsFiltrados = todosDevs;
  if (fDataDe) {
    devsFiltrados = devsFiltrados.filter(d => (d.criado_em||'').split('T')[0] >= fDataDe);
  }
  if (fDataAte) {
    devsFiltrados = devsFiltrados.filter(d => (d.criado_em||'').split('T')[0] <= fDataAte);
  }

  const pendentes = devsFiltrados.filter(d => !d.motivo_real_causa_raiz || d.motivo_real_causa_raiz.trim() === '');
  const monitorados = devsFiltrados.filter(d => d.motivo_real_causa_raiz && d.motivo_real_causa_raiz.trim() !== '');

  const exibidos = activeInvestigacaoSubTab === 'pendentes' ? pendentes : monitorados;

  return `
    <div class="space-y-5">
      <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-black text-white flex items-center gap-2">
            <span>🔍</span> Análise e Monitoramento de Devoluções
          </h1>
          <p class="text-xs text-slate-400">Apuração da causa raiz, classificação do tipo de erro, fotos e encaminhamento ao Gestor</p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <!-- Filtro de datas -->
          <div class="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1.5 rounded-xl shadow">
            <span class="text-[10px] text-slate-400 font-bold uppercase pl-1">Data De:</span>
            <input type="date" id="inv-data-de" value="${fDataDe}" onchange="window._invFiltroDataDe=this.value; renderApp()" class="bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
            <span class="text-[10px] text-slate-400 font-bold uppercase">Até:</span>
            <input type="date" id="inv-data-ate" value="${fDataAte}" onchange="window._invFiltroDataAte=this.value; renderApp()" class="bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
            <button onclick="window._invFiltroDataDe=''; window._invFiltroDataAte=''; renderApp()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold px-2 py-1 rounded">Limpar</button>
          </div>

          <!-- Abas Pendentes / Monitorados -->
          <div class="flex gap-1 bg-slate-900 border border-slate-800 p-1.5 rounded-xl shadow-lg">
            <button onclick="activeInvestigacaoSubTab='pendentes'; renderApp()" class="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${activeInvestigacaoSubTab==='pendentes'?'bg-amber-700 text-white shadow-lg':'text-slate-400 hover:text-white'}">
              <span>⏳</span> Pendentes (${pendentes.length})
            </button>
            <button onclick="activeInvestigacaoSubTab='monitorados'; renderApp()" class="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${activeInvestigacaoSubTab==='monitorados'?'bg-emerald-700 text-white shadow-lg':'text-slate-400 hover:text-white'}">
              <span>✅</span> Já Monitorados (${monitorados.length})
            </button>
          </div>
        </div>
      </div>

      ${exibidos.length === 0 ? `<div class="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500">Nenhuma ocorrência encontrada nesta categoria.</div>` :
      exibidos.map(d => `
        <div class="bg-slate-900 border ${d.motivo_real_causa_raiz?'border-emerald-800/60':'border-amber-800/60'} rounded-xl p-5 shadow-xl space-y-4">
          <!-- Cabeçalho -->
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-black text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">${d.numero_devolucao||d.numero_protocolo}</span>
                <span class="text-xs font-bold text-white">🚛 ${d.veiculo_placa} ${d.veiculo_modelo ? `(${d.veiculo_modelo})` : ''}</span>
              </div>
              <div class="text-xs text-slate-300 mt-1">📍 <b>${d.carga_rota}</b> | Carga: ${d.carga_numero} • 👤 <b>${d.motorista_nome}</b></div>
              <div class="text-xs text-slate-400">Cliente: <b>${d.cliente_nome}</b>${d.nota_fiscal ? ` • NF: <b class="text-emerald-400">${d.nota_fiscal}</b>` : ''}</div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <div class="text-right">
                <div class="text-base font-black text-emerald-400">R$ ${d.valor_reclamado.toFixed(2)}</div>
                <div class="text-[10px] text-slate-400">${d.forma_acerto}</div>
              </div>
              ${d.motivo_real_causa_raiz ? `
                <button onclick="editarInvestigacaoModal('${d.id}')" class="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow flex items-center gap-1">
                  ✏️ Editar Análise
                </button>` : ''}
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            <!-- Relato -->
            <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
              <div class="font-bold text-slate-300">Reclamação:</div>
              <div class="text-slate-400 italic">"${d.motivo_reclamado}"</div>
              <div class="text-slate-300">${d.detalhamento_texto}</div>
              ${d.foto_url ? `<img src="${d.foto_url}" alt="Foto Avaria" class="w-28 h-28 object-cover rounded-lg border border-slate-700 mt-1" onclick="window.open('${d.foto_url}')">` : ''}
              ${d.video_url ? `<video src="${d.video_url}" controls class="w-full max-h-28 rounded-lg border border-blue-500 mt-1"></video>` : ''}
              ${d.itens?.length > 0 ? `
                <div class="pt-2 border-t border-slate-800">
                  <div class="font-bold text-slate-400 mb-1">Itens Reclamados:</div>
                  <div class="space-y-1">
                    ${d.itens.map(i => `<div class="flex justify-between text-[11px] text-slate-300"><span>${i.produto_codigo} — ${i.produto_descricao} (x${i.quantidade})</span><span class="text-emerald-400 font-semibold">R$ ${i.valor_total.toFixed(2)}</span></div>`).join('')}
                  </div>
                </div>` : ''}
            </div>

            <!-- Formulário de Apuração -->
            <form onsubmit="handleInvestigacaoSubmit(event, '${d.id}')" class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-3">
              <div class="font-bold text-emerald-400 uppercase tracking-wider text-[11px]">Apuração do Analista SAC</div>

              <div>
                <label class="block text-[10px] text-slate-300 mb-1">Causa Raiz Real (Validação da aba Motivos) *</label>
                <select id="inv-causa-${d.id}" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
                  <option value="">-- Selecione a Causa Raiz Real --</option>
                  ${causasRaiz.map(c => `<option value="${c}" ${d.motivo_real_causa_raiz===c?'selected':''}>${c}</option>`).join('')}
                </select>
              </div>

              <div>
                <label class="block text-[10px] text-slate-300 mb-1">Tipo de Erro / Categoria *</label>
                <select id="inv-erro-${d.id}" required onchange="toggleOutroErro('${d.id}', this.value)" class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded p-2 text-xs">
                  <option value="">-- Selecione o Tipo de Erro --</option>
                  ${erros.map(e => `<option value="${e}" ${d.tipo_erro===e?'selected':''}>${e}</option>`).join('')}
                </select>
                <input type="text" id="inv-erro-outro-${d.id}" value="${d.tipo_erro_outro||''}" placeholder="Especifique o outro erro..." class="${d.tipo_erro==='OUTRO'?'':'hidden'} mt-1 w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
              </div>

              <div id="inv-vale-btn-container-${d.id}" class="${d.tipo_erro==='ERRO MOTORISTA'?'':'hidden'}">
                <button type="button" onclick="gerarValeMotoristaPdf('${d.id}')" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold py-2 rounded text-xs shadow flex items-center justify-center gap-2 transition">
                  <span>📄</span> Emitir Vale Motorista para Assinatura (PDF)
                </button>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-[10px] text-slate-300 mb-1">Separador (Equipe CD)</label>
                  <select id="inv-sep-${d.id}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                    <option value="">-- Não identificado --</option>
                    ${separadores.map(s => `<option value="${s}" ${(d.separador_apurado||d.separador_nome)===s?'selected':''}>${s}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="block text-[10px] text-slate-300 mb-1">Conferente (Equipe CD)</label>
                  <select id="inv-conf-${d.id}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                    <option value="">-- Não identificado --</option>
                    ${separadores.map(s => `<option value="${s}" ${(d.conferente_apurado||d.conferente_nome)===s?'selected':''}>${s}</option>`).join('')}
                  </select>
                </div>
              </div>

              <div>
                <label class="block text-[10px] text-slate-300 mb-1">Ação Tomada / Encaminhamento *</label>
                <textarea id="inv-acao-${d.id}" required rows="2" placeholder="Descreva a ação tomada ou orientação dada..." class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">${d.acao_tomada||''}</textarea>
              </div>

              <div>
                <label class="block text-[10px] text-slate-300 mb-1">Responsável pela Análise *</label>
                <select id="inv-resp-${d.id}" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                  ${usuarios.map(u => `<option value="${u.nome}" ${d.responsavel_analise===u.nome?'selected':''}>${u.nome} (${u.cargo})</option>`).join('')}
                </select>
              </div>

              <div class="bg-slate-800/60 border border-slate-700 rounded p-2.5 text-[10px] text-slate-400 flex items-center gap-2">
                <span class="text-purple-400 text-base">🏆</span>
                <span>Após salvar, o <b class="text-white">Gestor</b> acessa a aba <b class="text-purple-400">Gestão do Gestor</b> para registrar a ação final e definir o desconto de produtividade.</span>
              </div>

              <button type="submit" class="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-2 rounded text-xs">
                ${d.motivo_real_causa_raiz ? 'Atualizar Investigação' : 'Salvar Investigação'}
              </button>
            </form>
          </div>
        </div>`).join('')}
    </div>`;
}

function editarInvestigacaoModal(id) {
  const devs = db.getDevolucoes();
  const d = devs.find(x => x.id == id);
  if (!d) return;

  const causasRaiz = db.data.causas_raiz || [];
  const erros = ["ERRO CARREGAMENTO","ERRO COMERCIAL","ERRO INDÚSTRIA","ERRO LOGÍSTICO","ERRO MOTORISTA","OUTRO","PROBLEMA MECÂNICO","RESP. NÃO IDENTIFICADO"];
  const separadores = db.data.separadores_conferentes || [];

  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <h3 class="font-bold text-white text-sm">Editar Análise da Devolução — ${d.numero_devolucao||d.numero_protocolo}</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white text-sm">✕</button>
      </div>
      <form onsubmit="handleSalvarEdicaoInvestigacao(event, '${d.id}')" class="space-y-3 text-xs">
        <div>
          <label class="block text-[10px] text-slate-300 mb-1">Causa Raiz Real *</label>
          <select id="ed-inv-causa" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
            ${causasRaiz.map(c => `<option value="${c}" ${d.motivo_real_causa_raiz===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block text-[10px] text-amber-400 font-bold mb-1">Tipo de Erro *</label>
          <select id="ed-inv-erro" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
            ${erros.map(e => `<option value="${e}" ${d.tipo_erro===e?'selected':''}>${e}</option>`).join('')}
          </select>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Separador</label>
            <select id="ed-inv-sep" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              <option value="">-- Não se aplica --</option>
              ${separadores.map(s => `<option value="${s}" ${(d.separador_apurado||d.separador_nome)===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Conferente</label>
            <select id="ed-inv-conf" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              <option value="">-- Não se aplica --</option>
              ${separadores.map(s => `<option value="${s}" ${(d.conferente_apurado||d.conferente_nome)===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-300 mb-1">Ação Tomada / Encaminhamento *</label>
          <textarea id="ed-inv-acao" rows="2" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">${d.acao_tomada||''}</textarea>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="bg-slate-800 text-slate-300 font-bold px-3 py-1.5 rounded">Cancelar</button>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-1.5 rounded shadow">Salvar Edição</button>
        </div>
      </form>
    </div>`;
  modalContainer.classList.remove('hidden');
}

function handleSalvarEdicaoInvestigacao(e, id) {
  e.preventDefault();
  db.updateInvestigacao(id, {
    motivo_real_causa_raiz: document.getElementById('ed-inv-causa').value,
    tipo_erro: document.getElementById('ed-inv-erro').value,
    separador_apurado: document.getElementById('ed-inv-sep').value,
    conferente_apurado: document.getElementById('ed-inv-conf').value,
    acao_tomada: document.getElementById('ed-inv-acao').value
  });
  closeModal();
  alert('✅ Investigação atualizada!');
  renderApp();
}

function toggleOutroErro(devId, valor) {
  const outro = document.getElementById(`inv-erro-outro-${devId}`);
  if (outro) outro.classList.toggle('hidden', valor !== 'OUTRO');
  const valeBtn = document.getElementById(`inv-vale-btn-container-${devId}`);
  if (valeBtn) valeBtn.classList.toggle('hidden', valor !== 'ERRO MOTORISTA');
}

// ---- Emissão do Documento "VALE MOTORISTA" (PDF / Impressão) ----
function gerarValeMotoristaPdf(devId) {
  const devs = db.getDevolucoes();
  const dev = devs.find(d => d.id == devId) || (db.data.ocorrencias_devolucao || []).find(d => d.id == devId);
  if (!dev) {
    alert('Devolução não encontrada!');
    return;
  }

  const itens = dev.itens || [];
  const totalValor = parseFloat(dev.valor_reclamado) || 0;

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>VALE MOTORISTA — ${dev.numero_devolucao || dev.numero_protocolo}</title>
  <style>
    @media print {
      @page { margin: 10mm; size: A4; }
      body { -webkit-print-color-adjust: exact; }
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      margin: 0;
      padding: 25px;
      color: #0f172a;
      background-color: #ffffff;
      position: relative;
    }
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 480px;
      opacity: 0.08;
      pointer-events: none;
      z-index: 0;
    }
    .content {
      position: relative;
      z-index: 1;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .logo {
      height: 65px;
    }
    .company-title {
      text-align: right;
    }
    .company-title h2 {
      margin: 0;
      font-size: 20px;
      color: #0f172a;
      font-weight: 800;
    }
    .company-title p {
      margin: 3px 0 0;
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
    }
    .doc-title {
      text-align: center;
      background: #0f172a;
      color: #ffffff;
      padding: 10px;
      font-size: 16px;
      font-weight: bold;
      letter-spacing: 1px;
      margin-bottom: 20px;
      border-radius: 6px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 15px;
    }
    .field-box {
      border: 1px solid #cbd5e1;
      padding: 8px 12px;
      border-radius: 6px;
      background: #f8fafc;
    }
    .field-label {
      font-size: 9px;
      font-weight: bold;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .field-value {
      font-size: 12px;
      font-weight: bold;
      color: #0f172a;
      margin-top: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
      margin-bottom: 15px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
      text-align: left;
      font-size: 11px;
    }
    th {
      background-color: #f1f5f9;
      color: #0f172a;
      font-weight: bold;
      text-transform: uppercase;
      font-size: 10px;
    }
    .total-box {
      background: #fef2f2;
      border: 2px solid #ef4444;
      padding: 12px 18px;
      border-radius: 8px;
      text-align: right;
      margin-top: 15px;
      margin-bottom: 25px;
    }
    .total-title {
      font-size: 11px;
      font-weight: bold;
      color: #991b1b;
      text-transform: uppercase;
    }
    .total-amount {
      font-size: 24px;
      font-weight: 900;
      color: #dc2626;
      margin-top: 2px;
    }
    .termo {
      font-size: 10px;
      color: #334155;
      line-height: 1.6;
      text-align: justify;
      border: 1px solid #e2e8f0;
      padding: 12px;
      background: #f8fafc;
      border-radius: 6px;
      margin-bottom: 40px;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 50px;
      margin-top: 50px;
      text-align: center;
    }
    .line {
      border-top: 1.5px solid #0f172a;
      margin-bottom: 6px;
    }
    .sig-title {
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .sig-sub {
      font-size: 9px;
      color: #64748b;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <!-- Marca d'água -->
  <img src="./public/logo.png" class="watermark" alt="Marca d'água JR">

  <div class="content">
    <div class="header">
      <img src="./public/logo.png" class="logo" alt="JR Logo">
      <div class="company-title">
        <h2>JR DISTRIBUIDORA</h2>
        <p>Logística Corporativa • Gestão de Frotas & SAC</p>
      </div>
    </div>

    <div class="doc-title">VALE MOTORISTA — AUTORIZAÇÃO DE DESCONTO DE OCORRÊNCIA</div>

    <div class="grid">
      <div class="field-box">
        <div class="field-label">Motorista Responsável</div>
        <div class="field-value">${dev.motorista_nome || 'N/A'}</div>
      </div>
      <div class="field-box">
        <div class="field-label">Nº Protocolo SAC / Devolução</div>
        <div class="field-value">${dev.numero_devolucao || dev.numero_protocolo}</div>
      </div>
      <div class="field-box">
        <div class="field-label">Veículo Placa / Rota</div>
        <div class="field-value">${dev.veiculo_placa} — Rota: ${dev.carga_rota}</div>
      </div>
      <div class="field-box">
        <div class="field-label">Nº da Carga / Data da Ocorrência</div>
        <div class="field-value">Carga: ${dev.carga_numero} — Data: ${(dev.criado_em||'').split('T')[0]}</div>
      </div>
      <div class="field-box">
        <div class="field-label">Cliente / Nota Fiscal</div>
        <div class="field-value">${dev.cliente_nome} ${dev.nota_fiscal ? `(NF: ${dev.nota_fiscal})` : ''}</div>
      </div>
      <div class="field-box">
        <div class="field-label">Classificação da Ocorrência</div>
        <div class="field-value" style="color: #dc2626;">${dev.tipo_erro || 'ERRO MOTORISTA'}</div>
      </div>
    </div>

    <div class="field-box" style="margin-bottom: 15px;">
      <div class="field-label">Motivo & Causa Raiz Apurada</div>
      <div class="field-value" style="font-weight: normal; font-size: 11px; margin-top: 4px; line-height: 1.4;">
        <b>Motivo Reclamado:</b> ${dev.motivo_reclamado}<br>
        <b>Causa Raiz:</b> ${dev.motivo_real_causa_raiz || 'Indefinida'}<br>
        <b>Detalhamento:</b> ${dev.detalhamento_texto || 'Sem observações adicionais'}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Cód. Produto</th>
          <th>Descrição do Item</th>
          <th style="text-align: center;">Qtd</th>
          <th style="text-align: right;">Valor Unit.</th>
          <th style="text-align: right;">Subtotal (R$)</th>
        </tr>
      </thead>
      <tbody>
        ${itens.length > 0 ? itens.map(i => `
          <tr>
            <td><b>${i.produto_codigo || 'N/A'}</b></td>
            <td>${i.produto_descricao || 'Produto'}</td>
            <td style="text-align: center;"><b>${i.quantidade}</b></td>
            <td style="text-align: right;">R$ ${(parseFloat(i.valor_unitario)||0).toFixed(2)}</td>
            <td style="text-align: right;"><b>R$ ${(parseFloat(i.valor_total)||(i.quantidade * (i.valor_unitario||0))).toFixed(2)}</b></td>
          </tr>
        `).join('') : `<tr><td colspan="5" style="text-align:center;">Ocorrência de devolução registrada sem itens específicos. Valor total: R$ ${totalValor.toFixed(2)}</td></tr>`}
      </tbody>
    </table>

    <div class="total-box">
      <div class="total-title">VALOR TOTAL A SER DESCONTADO / ACERTADO:</div>
      <div class="total-amount">R$ ${totalValor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
    </div>

    <div class="termo">
      <b>TERMO DE COMPROMISSO E AUTORIZAÇÃO:</b><br>
      Eu, <b>${dev.motorista_nome || 'MOTORISTA'}</b>, reconheço a responsabilidade sobre a ocorrência acima discriminada ocorrida durante a operação de transporte e entrega da carga <b>${dev.carga_numero}</b>. Autorizo expressamente a JR Distribuidora a efetuar o desconto do valor total de <b>R$ ${totalValor.toFixed(2)}</b> em meu acerto de contas ou folha de pagamento.
    </div>

    <div class="signatures">
      <div>
        <div class="line"></div>
        <div class="sig-title">${dev.motorista_nome || 'ASSINATURA DO MOTORISTA'}</div>
        <div class="sig-sub">Motorista / Transportador</div>
      </div>
      <div>
        <div class="line"></div>
        <div class="sig-title">SUPERVISOR / GESTOR DE LOGÍSTICA</div>
        <div class="sig-sub">JR Distribuidora</div>
      </div>
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 500);
    }
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=850');
  if (win) {
    win.document.write(htmlContent);
    win.document.close();
  } else {
    alert('Permita pop-ups no navegador para visualizar o Vale Motorista.');
  }
}

function handleInvestigacaoSubmit(e, devId) {
  e.preventDefault();
  const erroSel = document.getElementById(`inv-erro-${devId}`).value;
  const erroOutro = document.getElementById(`inv-erro-outro-${devId}`)?.value || '';
  db.updateInvestigacao(devId, {
    motivo_real_causa_raiz: document.getElementById(`inv-causa-${devId}`).value,
    tipo_erro: erroSel,
    tipo_erro_outro: erroOutro,
    separador_apurado: document.getElementById(`inv-sep-${devId}`).value,
    conferente_apurado: document.getElementById(`inv-conf-${devId}`).value,
    video_investigacao_url: uploadedVideoBase64Inv || '',
    acao_tomada: document.getElementById(`inv-acao-${devId}`).value,
    registra_desconto: false
  });
  uploadedVideoBase64Inv = '';
  alert('\u2705 An\u00e1lise salva!');
  renderApp();
}

// ===== MÓDULO: GESTÃO DO GESTOR =====
function renderGestaoGestorView() {
  const todosDevs = db.getDevolucoes();
  const tiposErro = ["ERRO CARREGAMENTO","ERRO COMERCIAL","ERRO INDÚSTRIA","ERRO LOGÍSTICO","ERRO MOTORISTA","OUTRO","PROBLEMA MECÂNICO","RESP. NÃO IDENTIFICADO"];

  const activeGestorTab = window._activeGestorSubTab || 'pendentes';

  // Filtros
  const filtroTipoErro = window._filtroGestorTipoErro || '';
  const filtroDataDe = window._filtroGestorDataDe || '';
  const filtroDataAte = window._filtroGestorDataAte || '';

  const todosPendentes = todosDevs.filter(d => d.status_gestao !== 'CONCLUIDO');
  const todosConcluidos = todosDevs.filter(d => d.status_gestao === 'CONCLUIDO');

  let devsExibidos = activeGestorTab === 'pendentes' ? todosPendentes : todosConcluidos;

  // Aplicação dos filtros no painel ativo (especialmente para Concluídos)
  if (filtroTipoErro) {
    devsExibidos = devsExibidos.filter(d => d.tipo_erro === filtroTipoErro);
  }
  if (filtroDataDe) {
    devsExibidos = devsExibidos.filter(d => {
      const criado = d.criado_em ? d.criado_em.split('T')[0] : '';
      return criado >= filtroDataDe;
    });
  }
  if (filtroDataAte) {
    devsExibidos = devsExibidos.filter(d => {
      const criado = d.criado_em ? d.criado_em.split('T')[0] : '';
      return criado <= filtroDataAte;
    });
  }

  const totDesconto = todosDevs.filter(d => d.desconto_produtividade_gestor).length;
  const separadores = db.data.separadores_conferentes || [];

  return `
    <div class="space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-black text-white flex items-center gap-2">
            <span>👔</span> Gestão de Tratativas
          </h1>
          <p class="text-xs text-slate-400">Acompanhamento de pareceres, apurações por setor, tipo de erro, ações e descontos</p>
        </div>

        <!-- SUBABAS PENDENTES / CONCLUÍDOS -->
        <div class="flex gap-1 bg-slate-900 border border-slate-800 p-1.5 rounded-xl shadow-lg shrink-0">
          <button onclick="window._activeGestorSubTab='pendentes'; renderApp()" class="px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-2 transition ${activeGestorTab === 'pendentes' ? 'bg-amber-700 text-white shadow-md' : 'text-slate-400 hover:text-white'}">
            <span>⏳</span> Ocorrências Pendentes (${todosPendentes.length})
          </button>
          <button onclick="window._activeGestorSubTab='concluidos'; renderApp()" class="px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-2 transition ${activeGestorTab === 'concluidos' ? 'bg-emerald-700 text-white shadow-md' : 'text-slate-400 hover:text-white'}">
            <span>✅</span> Ocorrências Concluídas (${todosConcluidos.length})
          </button>
        </div>
      </div>

      <!-- CARDS DE INDICADORES DO GESTOR -->
      <div class="grid grid-cols-3 gap-3">
        <div class="bg-slate-900 border border-amber-800/50 p-3 rounded-xl text-center shadow">
          <div class="text-xl font-black text-amber-400">${todosPendentes.length}</div>
          <div class="text-[10px] text-slate-400 mt-0.5 font-bold uppercase">Pendentes de Ação</div>
        </div>
        <div class="bg-slate-900 border border-emerald-800/50 p-3 rounded-xl text-center shadow">
          <div class="text-xl font-black text-emerald-400">${todosConcluidos.length}</div>
          <div class="text-[10px] text-slate-400 mt-0.5 font-bold uppercase">Concluídas</div>
        </div>
        <div class="bg-slate-900 border border-red-800/50 p-3 rounded-xl text-center shadow">
          <div class="text-xl font-black text-red-400">${totDesconto}</div>
          <div class="text-[10px] text-slate-400 mt-0.5 font-bold uppercase">Descontos de Produtividade</div>
        </div>
      </div>

      <!-- FILTROS DO PAINEL DE OCORRÊNCIAS (COM MANUTENÇÃO DOS FILTROS EXISTENTES) -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-2">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <span class="text-xs font-bold text-white uppercase flex items-center gap-2">
            🔍 Filtros para o Painel de Ocorrências ${activeGestorTab === 'concluidos' ? '<b class="text-emerald-400">(Concluídas)</b>' : '<b class="text-amber-400">(Pendentes)</b>'}
          </span>
          <span class="text-[10px] text-slate-400">${devsExibidos.length} ocorrência(s) encontrada(s)</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-1">
          <div>
            <label class="block text-[10px] text-amber-400 font-bold mb-1">Filtro: Tipo de Erro</label>
            <select id="filtro-gestor-tipo-erro" onchange="aplicarFiltroGestor()" class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded-lg p-2 text-xs">
              <option value="">Todos os Tipos de Erro</option>
              ${tiposErro.map(t => `<option value="${t}" ${filtroTipoErro===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-semibold mb-1">Data De</label>
            <input type="date" id="filtro-gestor-data-de" value="${filtroDataDe}" onchange="aplicarFiltroGestor()" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
          </div>
          <div class="flex gap-2 items-center">
            <div class="flex-1">
              <label class="block text-[10px] text-slate-400 font-semibold mb-1">Data Até</label>
              <input type="date" id="filtro-gestor-data-ate" value="${filtroDataAte}" onchange="aplicarFiltroGestor()" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
            </div>
            <button onclick="limparFiltroGestor()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-2 rounded-lg text-xs shrink-0 mt-5">Limpar Filtros</button>
          </div>
        </div>
      </div>

      <!-- LISTA DE OCORRÊNCIAS NO PAINEL ATIVO -->
      ${devsExibidos.length === 0 ? `<div class="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500">Nenhuma ocorrência encontrada nesta aba com os filtros informados.</div>` :
      devsExibidos.map(d => `
        <div class="bg-slate-900 border ${d.status_gestao==='CONCLUIDO'?'border-emerald-800/60':'border-amber-800/60'} rounded-xl shadow-xl overflow-hidden">
          <!-- Cabeçalho -->
          <div class="bg-slate-950 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-black text-emerald-400">${d.numero_devolucao||d.numero_protocolo}</span>
                <span class="text-xs text-white font-bold">🚛 ${d.veiculo_placa}</span>
                <span class="text-xs text-slate-400">📍 ${d.carga_rota} | ${d.motorista_nome.split(' ')[0]}</span>
              </div>
              <div class="text-[11px] text-slate-400 mt-0.5">Cliente: <b class="text-white">${d.cliente_nome}</b>${d.nota_fiscal?` • NF: <b class="text-emerald-400">${d.nota_fiscal}</b>`:''}</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-sm font-black text-emerald-400">R$ ${d.valor_reclamado.toFixed(2)}</span>
              ${d.status_gestao==='CONCLUIDO'
                ? '<span class="bg-emerald-900/60 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">✅ CONCLUÍDO</span>'
                : '<span class="bg-amber-900/60 text-amber-300 border border-amber-700 px-2 py-0.5 rounded text-[10px] font-bold animate-pulse">⏳ PENDENTE</span>'}
            </div>
          </div>

          <!-- Resumo da apuração -->
          <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-b border-slate-800 text-xs">
            <div class="bg-slate-950 p-2.5 rounded border border-slate-800">
              <div class="text-[9px] text-slate-500 uppercase font-bold mb-1">Motivo Reclamado</div>
              <div class="text-emerald-300 font-semibold">${d.motivo_reclamado||'—'}</div>
            </div>
            <div class="bg-slate-950 p-2.5 rounded border border-slate-800">
              <div class="text-[9px] text-slate-500 uppercase font-bold mb-1">Causa Raiz Apurada</div>
              <div class="${d.motivo_real_causa_raiz?'text-white font-semibold':'text-amber-400 italic'}">${d.motivo_real_causa_raiz||'⏳ Pendente análise'}</div>
            </div>
            <div class="bg-slate-950 p-2.5 rounded border border-slate-800">
              <div class="text-[9px] text-slate-500 uppercase font-bold mb-1">Tipo de Erro</div>
              <div class="${d.tipo_erro?'text-orange-300 font-semibold':'text-slate-500 italic'}">${d.tipo_erro||'Não classificado'}</div>
            </div>
            <div class="bg-slate-950 p-2.5 rounded border border-slate-800">
              <div class="text-[9px] text-slate-500 uppercase font-bold mb-1">Separador / Conferente</div>
              <div class="text-white text-[10px]">${d.separador_apurado||d.separador_nome||'—'}</div>
              <div class="text-slate-400 text-[10px]">${d.conferente_apurado||d.conferente_nome||'—'}</div>
            </div>
          </div>

          <!-- Ação do Gestor -->
          <form onsubmit="handleAcaoGestorSubmit(event, '${d.id}')" class="p-4 space-y-4">
            <div class="font-bold text-purple-400 text-xs uppercase tracking-wider">🏆 Ação do Gestor</div>

            ${d.acao_tomada ? `<div class="bg-slate-950 border border-slate-800 rounded p-2.5 text-[11px]">
              <div class="text-[9px] text-slate-500 font-bold mb-1">Ação tomada (Análise e Monitoramento):</div>
              <div class="text-slate-300 italic">"${d.acao_tomada}"</div>
            </div>` : ''}

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[10px] text-slate-400 mb-1">Separador Identificado</label>
                <select id="gestor-sep-${d.id}" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
                  <option value="">-- Não se aplica --</option>
                  ${separadores.map(s => `<option value="${s}" ${(d.separador_apurado||d.separador_nome)===s?'selected':''}>${s}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-[10px] text-slate-400 mb-1">Conferente Identificado</label>
                <select id="gestor-conf-${d.id}" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
                  <option value="">-- Não se aplica --</option>
                  ${separadores.map(s => `<option value="${s}" ${(d.conferente_apurado||d.conferente_nome)===s?'selected':''}>${s}</option>`).join('')}
                </select>
              </div>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 mb-1">Ação do Gestor / Encaminhamento *</label>
              <textarea id="gestor-acao-${d.id}" rows="2" required placeholder="Descreva a providência tomada pelo gestor..." class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">${d.acao_gestor||''}</textarea>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <label class="flex items-center gap-3 bg-red-950/40 border border-red-800/60 p-3 rounded-lg cursor-pointer hover:bg-red-950/60 transition">
                <input type="checkbox" id="gestor-desc-${d.id}" class="w-4 h-4 text-red-500 rounded border-slate-700 bg-slate-900 focus:ring-red-500 shrink-0 cursor-pointer" ${d.desconto_produtividade_gestor?'checked':''}>
                <div class="select-none">
                  <div class="text-white font-bold text-xs">Descontar Produtividade</div>
                  <div class="text-red-400 text-[10px]">Remuneração variável do colaborador</div>
                </div>
              </label>
              <div>
                <label class="block text-[10px] text-slate-400 mb-1">Status da Gestão</label>
                <select id="gestor-status-${d.id}" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs font-bold">
                  <option value="PENDENTE" ${d.status_gestao!=='CONCLUIDO'?'selected':''}>⏳ Pendente</option>
                  <option value="CONCLUIDO" ${d.status_gestao==='CONCLUIDO'?'selected':''}>✅ Concluído</option>
                </select>
              </div>
            </div>

            <div class="flex flex-wrap justify-between items-center gap-2 pt-2">
              <div>
                ${d.tipo_erro === 'ERRO MOTORISTA' ? `
                  <button type="button" onclick="gerarValeMotoristaPdf('${d.id}')" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold px-4 py-2 rounded-lg text-xs shadow flex items-center gap-1.5 transition">
                    <span>📄</span> Gerar Vale Motorista (PDF)
                  </button>` : ''}
              </div>
              <button type="submit" class="bg-purple-700 hover:bg-purple-600 text-white font-bold px-6 py-2 rounded-lg text-xs shadow">
                Salvar Ação do Gestor
              </button>
            </div>
          </form>
        </div>`).join('')}
    </div>`;
}

function aplicarFiltroGestor() {
  window._filtroGestorStatus = document.getElementById('filtro-gestor-status')?.value || '';
  window._filtroGestorTipoErro = document.getElementById('filtro-gestor-tipo-erro')?.value || '';
  window._filtroGestorDataDe = document.getElementById('filtro-gestor-data-de')?.value || '';
  window._filtroGestorDataAte = document.getElementById('filtro-gestor-data-ate')?.value || '';
  renderApp();
}

function limparFiltroGestor() {
  window._filtroGestorStatus = '';
  window._filtroGestorTipoErro = '';
  window._filtroGestorDataDe = '';
  window._filtroGestorDataAte = '';
  renderApp();
}

function handleAcaoGestorSubmit(e, devId) {
  e.preventDefault();
  db.updateAcaoGestor(devId, {
    acao_gestor: document.getElementById(`gestor-acao-${devId}`).value,
    separador_apurado: document.getElementById(`gestor-sep-${devId}`).value,
    conferente_apurado: document.getElementById(`gestor-conf-${devId}`).value,
    desconto_produtividade_gestor: document.getElementById(`gestor-desc-${devId}`).checked,
    status_gestao: document.getElementById(`gestor-status-${devId}`).value,
  });
  alert('\u2705 A\u00e7\u00e3o do Gestor salva!');
  renderApp();
}

// ===== MÓDULO: RECEPÇÃO NO CD =====
function renderCdRecepcaoView() {
  const devs = db.getDevolucoes();
  const pendentes = devs.filter(d => d.status_fechamento === 'PENDENTE_FISICO');

  const activeCdSubTab = window._activeCdSubTab || 'recepcao';

  // Filtros do painel de acompanhamento
  const fDataDe  = window._cdFiltroDataDe  || '';
  const fDataAte = window._cdFiltroDataAte || '';
  const fPlaca   = window._cdFiltroPlaca   || '';
  const fRota    = window._cdFiltroRota    || '';
  const fCarga   = window._cdFiltroCarga   || '';

  let historico = devs.filter(d => d.status_fechamento !== 'PENDENTE_FISICO');
  if (fDataDe)  historico = historico.filter(d => (d.criado_em||'').split('T')[0] >= fDataDe);
  if (fDataAte) historico = historico.filter(d => (d.criado_em||'').split('T')[0] <= fDataAte);
  if (fPlaca)   historico = historico.filter(d => (d.veiculo_placa||'').toLowerCase().includes(fPlaca.toLowerCase()));
  if (fRota)    historico = historico.filter(d => (d.carga_rota||'').toLowerCase().includes(fRota.toLowerCase()));
  if (fCarga)   historico = historico.filter(d => String(d.carga_numero||'').includes(fCarga));

  // Coleta de todos os itens com destinação no CD para a Subaba 2
  const todosItensDestinados = [];
  devs.forEach(d => {
    if (Array.isArray(d.itens) && d.itens.length > 0) {
      d.itens.forEach(item => {
        if (item.destino_item || d.destino_cd) {
          todosItensDestinados.push({
            ...item,
            protocolo: d.numero_devolucao || d.numero_protocolo,
            cliente_nome: d.cliente_nome,
            motorista_nome: d.motorista_nome,
            placa: d.veiculo_placa,
            data_entrada: d.data_entrada_cd || d.criado_em,
            destino: item.destino_item || d.destino_cd || 'ESTOQUE_REUTILIZACAO',
            validade: item.data_validade || '—',
            observacao: item.observacao || '—',
            status_negociacao: item.status_negociacao || 'EM_NEGOCIACAO'
          });
        }
      });
    }
  });

  const rowCols = `<th class="p-3">Nº Dev / Placa / Rota / Motorista</th>
                   <th class="p-3 hidden sm:table-cell">NF & Cliente</th>
                   <th class="p-3 hidden md:table-cell">Itens</th>`;

  const buildRow = (d, showBtn) => `
    <tr class="hover:bg-slate-800/40">
      <td class="p-3">
        <div class="font-black text-amber-400">${d.numero_devolucao||d.numero_protocolo}</div>
        <div class="text-[11px] text-white font-bold">🚛 ${d.veiculo_placa} ${d.veiculo_modelo?`(${d.veiculo_modelo})`:''}</div>
        <div class="text-[10px] text-slate-400">📍 ${d.carga_rota} | ${d.carga_numero}</div>
        <div class="text-[10px] text-slate-400">👤 ${d.motorista_nome}</div>
      </td>
      <td class="p-3 hidden sm:table-cell">
        <div class="font-bold text-white text-[11px]">${d.cliente_nome}</div>
        ${d.nota_fiscal ? `<div class="text-emerald-400 font-semibold">NF: ${d.nota_fiscal}</div>` : '<div class="text-slate-500 text-[10px]">Sem NF</div>'}
      </td>
      <td class="p-3 hidden md:table-cell text-[11px]">
        ${d.sem_itens
          ? `<span class="text-amber-300 italic">Sem itens: ${d.observacao_sem_itens||''}</span>`
          : (d.itens?.length > 0
              ? `<ul class="space-y-0.5">${d.itens.map(i=>`<li>• ${i.quantidade}x ${i.produto_descricao||'Produto'}</li>`).join('')}</ul>`
              : '<span class="text-slate-500">Sem itens</span>')}
      </td>
      <td class="p-3">
        ${d.status_fechamento === 'PENDENTE_FISICO'
          ? '<span class="bg-amber-500/20 text-amber-300 border border-amber-500/50 px-2 py-1 rounded text-[10px] font-black animate-pulse block">⚠️ PENDENTE</span>'
          : `<span class="bg-emerald-900/50 text-emerald-300 border border-emerald-700/50 px-2 py-1 rounded text-[10px] font-bold block">✔ ${d.status_fechamento}</span>`}
      </td>
      <td class="p-3 hidden sm:table-cell font-semibold text-emerald-400 text-[11px]">${formatarDestinoLabel(d.destino_cd)}</td>
      <td class="p-3 text-right">
        ${showBtn
          ? `<button onclick="openCdModal('${d.id}')" class="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded font-bold text-xs shadow">📥 Conferência & Entrada</button>`
          : `<span class="text-[10px] text-slate-500">${(d.criado_em||'').split('T')[0]}</span>`}
      </td>
    </tr>`;

  return `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-black text-white flex items-center gap-2">
            <span>📦</span> Centro de Distribuição (CD) & Retorno Físico
          </h1>
          <p class="text-xs text-slate-400">Conferência item a item, destinação de estoque, controle de validade e negociação em rota</p>
        </div>

        <!-- SUBABAS DE RECEPÇÃO CD -->
        <div class="flex gap-1 bg-slate-900 border border-slate-800 p-1.5 rounded-xl shadow-lg shrink-0">
          <button onclick="window._activeCdSubTab='recepcao'; renderApp()" class="px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-2 transition ${activeCdSubTab === 'recepcao' ? 'bg-amber-700 text-white shadow-md' : 'text-slate-400 hover:text-white'}">
            <span>📥</span> Conferência & Entradas (${pendentes.length} pendentes)
          </button>
          <button onclick="window._activeCdSubTab='destinacao'; renderApp()" class="px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-2 transition ${activeCdSubTab === 'destinacao' ? 'bg-emerald-700 text-white shadow-md' : 'text-slate-400 hover:text-white'}">
            <span>📋</span> Destinação de Produtos por Item (${todosItensDestinados.length})
          </button>
        </div>
      </div>

      ${activeCdSubTab === 'recepcao' ? `
        <!-- PAINEL 1: PENDENTES DE ENTRADA -->
        <div class="bg-slate-900 border border-amber-800/60 rounded-xl overflow-hidden shadow-xl">
          <div class="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 class="font-bold text-white text-sm">⚠️ Retornos Pendentes de Entrada</h3>
              <p class="text-[10px] text-slate-400 mt-0.5">Devoluções aguardando conferência física no CD</p>
            </div>
            <span class="bg-amber-500/20 text-amber-300 border border-amber-500/50 px-3 py-1 rounded-full text-xs font-black">${pendentes.length} pendente${pendentes.length!==1?'s':''}</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs text-slate-300">
              <thead class="bg-slate-950 text-slate-400 uppercase text-[10px]">
                <tr>${rowCols}<th class="p-3">Status</th><th class="p-3 hidden sm:table-cell">Destino Geral</th><th class="p-3 text-right">Ação</th></tr>
              </thead>
              <tbody class="divide-y divide-slate-800">
                ${pendentes.length === 0
                  ? `<tr><td colspan="6" class="p-6 text-center text-slate-500">✅ Nenhum retorno pendente.</td></tr>`
                  : pendentes.map(d => buildRow(d, true)).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- PAINEL 2: ACOMPANHAMENTO / HISTÓRICO -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div class="p-4 border-b border-slate-800">
            <h3 class="font-bold text-white text-sm">📊 Acompanhamento de Retornos</h3>
            <p class="text-[10px] text-slate-400 mt-0.5">Histórico de entradas confirmadas no CD</p>
          </div>

          <div class="p-4 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div>
              <label class="block text-[10px] text-slate-400 font-semibold mb-1">Data De</label>
              <input type="date" id="cd-filtro-data-de" value="${fDataDe}" onchange="aplicarFiltroCd()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-400 font-semibold mb-1">Data Até</label>
              <input type="date" id="cd-filtro-data-ate" value="${fDataAte}" onchange="aplicarFiltroCd()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-400 font-semibold mb-1">Veículo / Placa</label>
              <input type="text" id="cd-filtro-placa" value="${fPlaca}" placeholder="Ex: TVA8121" onchange="aplicarFiltroCd()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-400 font-semibold mb-1">Rota</label>
              <input type="text" id="cd-filtro-rota" value="${fRota}" placeholder="Nome da rota" onchange="aplicarFiltroCd()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-400 font-semibold mb-1">Nº da Carga</label>
              <input type="text" id="cd-filtro-carga" value="${fCarga}" placeholder="Ex: 10450" onchange="aplicarFiltroCd()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs text-slate-300">
              <thead class="bg-slate-950 text-slate-400 uppercase text-[10px]">
                <tr>${rowCols}<th class="p-3">Status</th><th class="p-3 hidden sm:table-cell">Destino Geral</th><th class="p-3 text-right">Data</th></tr>
              </thead>
              <tbody class="divide-y divide-slate-800">
                ${historico.length === 0
                  ? `<tr><td colspan="6" class="p-6 text-center text-slate-500">Nenhum registro encontrado.</td></tr>`
                  : historico.map(d => buildRow(d, false)).join('')}
              </tbody>
            </table>
          </div>
        </div>`
      : `
        <!-- SUBABA 2: EVIDENCIAÇÃO DE DESTINAÇÃO DE PRODUTOS POR ITEM -->
        <div class="bg-slate-900 border border-emerald-900/60 rounded-xl overflow-hidden shadow-2xl space-y-4 p-5">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 class="font-bold text-white text-sm flex items-center gap-2">
                <span>📋</span> Quadro Geral de Destinação dos Produtos (Item a Item)
              </h3>
              <p class="text-xs text-slate-400">Listagem completa dos itens recebidos com data de validade, observações e marcações de negociação</p>
            </div>
            <span class="bg-emerald-950 text-emerald-300 border border-emerald-700 px-3 py-1 rounded-full text-xs font-black">${todosItensDestinados.length} item(ns) destinados</span>
          </div>

          <div class="overflow-x-auto rounded-xl border border-slate-800">
            <table class="w-full text-left text-xs text-slate-300 border-collapse">
              <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                <tr>
                  <th class="p-3">Produto</th>
                  <th class="p-3 text-center">Quantidade</th>
                  <th class="p-3">Destino do Produto</th>
                  <th class="p-3 text-center">Data de Validade</th>
                  <th class="p-3">Observação</th>
                  <th class="p-3 text-center min-w-[160px]">Status Negociação</th>
                  <th class="p-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800 text-xs">
                ${todosItensDestinados.length === 0
                  ? `<tr><td colspan="7" class="p-6 text-center text-slate-500">Nenhum item destinado até o momento.</td></tr>`
                  : todosItensDestinados.map(item => {
                    const isNegociacao = item.destino === 'PRODUTOS_NEGOCIACAO';
                    const negociacaoBadges = {
                      'EM_NEGOCIACAO': '<span class="bg-amber-950 text-amber-300 border border-amber-700 px-2 py-0.5 rounded text-[10px] font-bold">⏳ Em Negociação</span>',
                      'ENVIADO_CONSUMO': '<span class="bg-blue-950 text-blue-300 border border-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">🍴 Consumo</span>',
                      'VENDA_NEGOCIADA': '<span class="bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">💰 Venda</span>',
                      'DESCARTADO': '<span class="bg-red-950 text-red-300 border border-red-700 px-2 py-0.5 rounded text-[10px] font-bold">🗑️ Descarte</span>'
                    };

                    return `
                      <tr class="hover:bg-slate-800/40">
                        <td class="p-3">
                          <div class="font-bold text-white">${item.produto_codigo ? `<span class="text-emerald-400 font-mono">[${item.produto_codigo}]</span> ` : ''}${item.produto_descricao || 'Produto'}</div>
                          <div class="text-[10px] text-slate-400">${item.protocolo} • ${item.cliente_nome}</div>
                        </td>
                        <td class="p-3 text-center font-bold text-amber-400 text-sm">${item.quantidade} un</td>
                        <td class="p-3 font-semibold text-emerald-300">${formatarDestinoLabel(item.destino)}</td>
                        <td class="p-3 text-center font-mono text-slate-200">${item.validade ? item.validade : '<span class="text-slate-500">—</span>'}</td>
                        <td class="p-3 text-slate-300 italic">${item.observacao || '—'}</td>
                        <td class="p-3 text-center">
                          ${isNegociacao ? `
                            <div class="space-y-1">
                              <div>${negociacaoBadges[item.status_negociacao] || negociacaoBadges['EM_NEGOCIACAO']}</div>
                              <select onchange="atualizarStatusNegociacaoItem('${item.id}', this.value)" class="mt-1 bg-slate-800 border border-amber-600 text-amber-300 text-[10px] font-bold rounded px-1.5 py-1 w-full">
                                <option value="EM_NEGOCIACAO" ${item.status_negociacao==='EM_NEGOCIACAO'?'selected':''}>⏳ Em Negociação</option>
                                <option value="ENVIADO_CONSUMO" ${item.status_negociacao==='ENVIADO_CONSUMO'?'selected':''}>🍴 Enviado p/ Consumo</option>
                                <option value="VENDA_NEGOCIADA" ${item.status_negociacao==='VENDA_NEGOCIADA'?'selected':''}>💰 Venda Negociada</option>
                                <option value="DESCARTADO" ${item.status_negociacao==='DESCARTADO'?'selected':''}>🗑️ Descartado</option>
                              </select>
                            </div>
                          ` : '<span class="text-slate-500 text-[10px]">N/A (Outro Destino)</span>'}
                        </td>
                        <td class="p-3 text-center">
                          <div class="flex items-center justify-center gap-1.5">
                            <button onclick="openEditarItemDestinoModal('${item.id}', '${item.devId}')" class="bg-blue-900/60 hover:bg-blue-800 text-blue-200 border border-blue-700 px-2 py-1 rounded text-[10px] font-bold transition">✏️ Editar</button>
                            <button onclick="excluirItemDestino('${item.id}', '${item.devId}')" class="bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-700 px-2 py-1 rounded text-[10px] font-bold transition">🗑️ Excluir</button>
                          </div>
                        </td>
                      </tr>`;
                  }).join('')}
              </tbody>
            </table>
          </div>
        </div>`}
    </div>`;
}

function formatarDestinoLabel(val) {
  switch(val) {
    case 'ESTOQUE_REUTILIZACAO': return '🟢 Reutilização / Estoque';
    case 'AVARIA_DESCARTE': return '🔴 Avaria / Descarte';
    case 'DEVOLUCAO_FORNECEDOR': return '🔵 Devolução ao Fornecedor';
    case 'RETRABALHO_REEMBALAGEM': return '🟠 Retrabalho / Reembalagem';
    case 'PRODUTOS_NEGOCIACAO': return '🟡 Produtos para Negociação';
    case 'RENEGOCIADO_ROTA': return '🚚 Renegociado em Rota (Não retorna ao CD)';
    default: return val || '—';
  }
}

function atualizarStatusNegociacaoItem(itemId, novoStatus) {
  if (db.updateItemNegociacao(itemId, novoStatus)) {
    alert('✅ Status de negociação do item atualizado!');
    renderApp();
  }
}

function openEditarItemDestinoModal(itemId, devId) {
  const devs = db.getDevolucoes();
  const dev = devs.find(d => String(d.id) === String(devId));
  if (!dev || !Array.isArray(dev.itens)) {
    alert('Ocorrência ou itens não encontrados.');
    return;
  }

  const item = dev.itens.find(i => String(i.id) === String(itemId)) || dev.itens[0];
  if (!item) return;

  const modal = document.getElementById('modal-container');
  if (!modal) return;

  modal.innerHTML = `
    <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-fadeIn">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 class="text-sm font-extrabold text-white flex items-center gap-2">✏️ Editar Item do Retorno Físico</h3>
          <button onclick="closeModal()" class="text-slate-400 hover:text-white text-lg font-bold">✕</button>
        </div>

        <form onsubmit="handleSalvarEdicaoItemDestino(event, '${itemId}', '${devId}')" class="space-y-3 text-xs">
          <div>
            <label class="block font-bold text-slate-300 mb-1">Produto:</label>
            <div class="p-2 bg-slate-950 border border-slate-800 rounded font-bold text-emerald-400">
              ${item.produto_codigo ? `[${item.produto_codigo}] ` : ''}${item.produto_descricao || 'Produto'}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-bold text-slate-300 mb-1">Quantidade *</label>
              <input type="number" id="edit-item-qtd" required min="1" value="${item.quantidade || 1}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 font-bold">
            </div>
            <div>
              <label class="block font-bold text-slate-300 mb-1">Data Validade</label>
              <input type="date" id="edit-item-validade" value="${item.data_validade || ''}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2">
            </div>
          </div>

          <div>
            <label class="block font-bold text-slate-300 mb-1">Destino do Produto *</label>
            <select id="edit-item-destino" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 font-bold">
              <option value="ESTOQUE_REUTILIZACAO" ${item.destino_item==='ESTOQUE_REUTILIZACAO'?'selected':''}>🟢 Reutilização / Estoque</option>
              <option value="RETABALHO_REEMBALAGEM" ${item.destino_item==='RETABALHO_REEMBALAGEM'?'selected':''}>🟠 Retrabalho / Reembalagem</option>
              <option value="DEVOLUCAO_FORNECEDOR" ${item.destino_item==='DEVOLUCAO_FORNECEDOR'?'selected':''}>🔵 Devolução ao Fornecedor</option>
              <option value="DESCARTE_AVARIA" ${item.destino_item==='DESCARTE_AVARIA'?'selected':''}>🔴 Descarte / Avaria</option>
              <option value="PRODUTOS_NEGOCIACAO" ${item.destino_item==='PRODUTOS_NEGOCIACAO'?'selected':''}>🟣 Produtos para Negociação em Rota</option>
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-300 mb-1">Status Negociação</label>
            <select id="edit-item-negociacao" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2">
              <option value="EM_NEGOCIACAO" ${item.status_negociacao==='EM_NEGOCIACAO'?'selected':''}>⏳ Em Negociação</option>
              <option value="ENVIADO_CONSUMO" ${item.status_negociacao==='ENVIADO_CONSUMO'?'selected':''}>🍴 Enviado para Consumo</option>
              <option value="VENDA_NEGOCIADA" ${item.status_negociacao==='VENDA_NEGOCIADA'?'selected':''}>💰 Venda Negociada</option>
              <option value="DESCARTADO" ${item.status_negociacao==='DESCARTADO'?'selected':''}>🗑️ Descartado</option>
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-300 mb-1">Observações do CD</label>
            <input type="text" id="edit-item-obs" value="${item.observacao || ''}" placeholder="Ex: Caixa avariada, reembalado..." class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2">
          </div>

          <div class="pt-2 flex gap-2">
            <button type="button" onclick="closeModal()" class="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 rounded-lg">Cancelar</button>
            <button type="submit" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 rounded-lg shadow">Salvar Alterações</button>
          </div>
        </form>
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

function handleSalvarEdicaoItemDestino(e, itemId, devId) {
  e.preventDefault();
  const devs = db.getDevolucoes();
  const dev = devs.find(d => String(d.id) === String(devId));
  if (!dev || !Array.isArray(dev.itens)) return;

  const item = dev.itens.find(i => String(i.id) === String(itemId)) || dev.itens[0];
  if (item) {
    item.quantidade = parseInt(document.getElementById('edit-item-qtd')?.value || '1', 10);
    item.data_validade = document.getElementById('edit-item-validade')?.value || '';
    item.destino_item = document.getElementById('edit-item-destino')?.value || 'ESTOQUE_REUTILIZACAO';
    item.status_negociacao = document.getElementById('edit-item-negociacao')?.value || 'EM_NEGOCIACAO';
    item.observacao = document.getElementById('edit-item-obs')?.value || '';
    db.save();
    closeModal();
    renderApp();
  }
}

function excluirItemDestino(itemId, devId) {
  if (!confirm('Deseja realmente excluir este item do retorno físico?')) return;
  const devs = db.getDevolucoes();
  const dev = devs.find(d => String(d.id) === String(devId));
  if (dev && Array.isArray(dev.itens)) {
    dev.itens = dev.itens.filter(i => String(i.id) !== String(itemId));
    db.save();
    renderApp();
  }
}

function openCdModal(devId) {
  const devs = db.getDevolucoes();
  const dev = devs.find(d => d.id == devId);
  if (!dev) return;
  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;

  const temItens = dev.itens && dev.itens.length > 0;

  const itensHtml = temItens ? `
    <div class="bg-slate-950 p-3 rounded-lg border border-slate-700 space-y-3">
      <div class="font-bold text-emerald-400 text-xs mb-1 uppercase tracking-wider">📦 Defina o destino de cada produto individualmente:</div>
      ${dev.itens.map((item, idx) => `
        <div class="p-3 bg-slate-900 rounded-lg border border-slate-800 space-y-2" id="item-card-${idx}">
          <div class="flex items-center justify-between gap-3 border-b border-slate-800 pb-2">
            <div class="flex-1 text-xs">
              <div class="font-black text-white text-sm">${item.produto_codigo ? `<span class="text-emerald-400 font-mono">[${item.produto_codigo}]</span> ` : ''}${item.quantidade}x ${item.produto_descricao||'Produto'}</div>
              <div class="text-slate-400 text-[10px]">Motivo SAC: ${item.motivo_item||'—'}</div>
            </div>
            <div class="flex gap-2 shrink-0">
              <label class="flex items-center gap-1 text-[11px] cursor-pointer">
                <input type="radio" name="item-status-${idx}" value="ok" checked class="text-emerald-500" onchange="toggleItemDivergenciaInputs(${idx})"> <span class="text-emerald-300 font-bold">OK</span>
              </label>
              <label class="flex items-center gap-1 text-[11px] cursor-pointer">
                <input type="radio" name="item-status-${idx}" value="divergente" class="text-red-500" onchange="toggleItemDivergenciaInputs(${idx})"> <span class="text-red-400 font-bold">Divergência</span>
              </label>
            </div>
          </div>

          <!-- DESTINAÇÃO E VALIDADE ITEM A ITEM -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
            <div>
              <label class="block text-[10px] text-amber-400 font-bold mb-1">Destino do Produto *</label>
              <select id="item-destino-${idx}" onchange="toggleValidadeExigencia(${idx})" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs font-bold">
                <option value="ESTOQUE_REUTILIZACAO" selected>🟢 Reutilização / Estoque</option>
                <option value="AVARIA_DESCARTE">🔴 Avaria / Descarte</option>
                <option value="DEVOLUCAO_FORNECEDOR">🔵 Devolução ao Fornecedor</option>
                <option value="RETRABALHO_REEMBALAGEM">🟠 Retrabalho / Reembalagem</option>
                <option value="PRODUTOS_NEGOCIACAO">🟡 Produtos para Negociação</option>
                <option value="RENEGOCIADO_ROTA">🚚 Renegociado em Rota (Não retorna CD)</option>
              </select>
            </div>

            <div id="validade-box-${idx}">
              <label class="block text-[10px] text-emerald-400 font-bold mb-1">Data de Validade *</label>
              <input type="date" id="item-validade-${idx}" required class="w-full bg-slate-800 border border-emerald-600 text-white font-bold rounded p-1.5 text-xs">
            </div>
          </div>

          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Observação do Item (opcional)</label>
            <input type="text" id="item-obs-geral-${idx}" placeholder="Ex: Lote 45B - Embalagem amassada" class="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded p-1.5 text-xs">
          </div>

          <!-- Área expandida de Divergência FÍSICA -->
          <div id="item-div-box-${idx}" class="hidden pt-2 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-950 p-2 rounded">
            <div>
              <label class="block text-[10px] text-slate-400 font-bold mb-0.5">Qtd Recebida (Esperado: ${item.quantidade})</label>
              <input type="number" id="item-qtd-rec-${idx}" min="0" max="${item.quantidade}" value="0" class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded p-1 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-400 font-bold mb-0.5">Observação da Falta</label>
              <input type="text" id="item-obs-${idx}" placeholder="Ex: Produto faltante na carga" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
            </div>
          </div>
        </div>`).join('')}
    </div>` : (dev.sem_itens ? `<div class="bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 text-xs text-amber-300">⚠️ Sem itens: ${dev.observacao_sem_itens}</div>` : '<div class="text-slate-500 text-xs">Nenhum item para validar.</div>');

  modalContainer.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-2xl w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center border-b border-slate-800 pb-3">
        <h3 class="font-bold text-white text-base">Recepção no CD • Conferência Item a Item — ${dev.numero_devolucao||dev.numero_protocolo}</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white font-bold text-xl leading-none">✕</button>
      </div>

      <!-- Cabeçalho resumido -->
      <div class="text-xs bg-slate-950 p-3 rounded border border-slate-800 space-y-1">
        <div>🚛 <b class="text-white">${dev.veiculo_placa}</b> ${dev.veiculo_modelo?`(${dev.veiculo_modelo})`:''}</div>
        <div>📍 Rota: <b class="text-white">${dev.carga_rota}</b> | Carga: ${dev.carga_numero}</div>
        <div>👤 Motorista: <b class="text-white">${dev.motorista_nome}</b></div>
        <div>🧾 NF: ${dev.nota_fiscal||'Não informada'} | Cliente: <b class="text-white">${dev.cliente_nome}</b></div>
        <div>📋 Nº Devolução: <b class="text-emerald-400">${dev.numero_devolucao||dev.numero_protocolo}</b></div>
      </div>

      <form onsubmit="handleCdModalSubmit(event, '${dev.id}')" class="space-y-4 text-xs">
        ${itensHtml}

        <div class="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button type="button" onclick="closeModal()" class="bg-slate-800 text-slate-300 font-bold px-4 py-2 rounded">Cancelar</button>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-2 rounded shadow text-xs">Confirmar Entrada no CD</button>
        </div>
      </form>
    </div>`;
  modalContainer.classList.remove('hidden');
}

function toggleValidadeExigencia(idx) {
  const dest = document.getElementById(`item-destino-${idx}`)?.value;
  const valBox = document.getElementById(`validade-box-${idx}`);
  const valInput = document.getElementById(`item-validade-${idx}`);
  if (valBox && valInput) {
    if (dest === 'AVARIA_DESCARTE' || dest === 'RENEGOCIADO_ROTA') {
      valBox.classList.add('opacity-50');
      valInput.required = false;
      valInput.value = '';
    } else {
      valBox.classList.remove('opacity-50');
      valInput.required = true;
    }
  }
}

function handleCdModalSubmit(e, devId) {
  e.preventDefault();
  const devs = db.getDevolucoes ? db.getDevolucoes() : [];
  const dev = devs.find(d => d.id == devId) || (db.data.ocorrencias_devolucao || []).find(d => d.id == devId);

  const itensDestinos = [];
  const itensDivergentes = [];
  let destinoPrincipal = 'ESTOQUE_REUTILIZACAO';

  if (dev && dev.itens && dev.itens.length > 0) {
    for (let idx = 0; idx < dev.itens.length; idx++) {
      const item = dev.itens[idx];
      const dest = document.getElementById(`item-destino-${idx}`)?.value || 'ESTOQUE_REUTILIZACAO';
      const validade = document.getElementById(`item-validade-${idx}`)?.value || '';
      const obsGeral = document.getElementById(`item-obs-geral-${idx}`)?.value || '';

      if (idx === 0) destinoPrincipal = dest;

      // Validação de data de validade condicional (exceto Descarte e Renegociado em Rota)
      if (dest !== 'AVARIA_DESCARTE' && dest !== 'RENEGOCIADO_ROTA' && !validade) {
        alert(`Por favor, preencha a Data de Validade para o item: ${item.produto_descricao || 'Produto'}`);
        return;
      }

      itensDestinos.push({
        item_id: item.id,
        destino: dest,
        data_validade: validade,
        observacao: obsGeral
      });

      // Divergências
      const radio = document.querySelector(`input[name="item-status-${idx}"]:checked`);
      if (radio && radio.value === 'divergente') {
        const qtdEsperada = parseInt(item.quantidade) || 0;
        const qtdRecebida = parseInt(document.getElementById(`item-qtd-rec-${idx}`)?.value) || 0;
        const qtdFaltante = Math.max(0, qtdEsperada - qtdRecebida);
        const obs = document.getElementById(`item-obs-${idx}`)?.value || 'Item com divergência física no CD';
        itensDivergentes.push({
          produto_id: item.produto_id,
          codigo_produto: item.produto_codigo || item.codigo_produto || String(item.produto_id || 'N/A'),
          descricao_produto: item.produto_descricao || item.descricao || 'Produto',
          quantidade_esperada: qtdEsperada,
          quantidade_recebida: qtdRecebida,
          quantidade_faltante: qtdFaltante,
          observacao: obs
        });
      }
    }
  }

  db.updateDestinoCd(devId, destinoPrincipal, 'RECEBIDO_CD', itensDestinos);

  if (itensDivergentes.length > 0) {
    const relatorio = gerarRelatorioDivergencia(devId, itensDivergentes, dev);
    db.data.relatorios_divergencia = db.data.relatorios_divergencia || [];
    db.data.relatorios_divergencia.push(relatorio);
    db.save();
    closeModal();
    alert(`⚠️ ${itensDivergentes.length} item(ns) com DIVERGÊNCIA!\nRelatório de quantidades faltantes gerado para o Financeiro.\n\nEntrada confirmada no CD.`);
    baixarRelatorioDivergencia(relatorio);
  } else {
    closeModal();
    alert(`✅ Entrada confirmada no CD!\nDestinação registrada item a item com sucesso.`);
  }
  renderApp();
}

function gerarRelatorioDivergencia(devId, itensDivergentes, dev) {
  return {
    id: Date.now(),
    ocorrencia_id: devId,
    protocolo: dev?.numero_protocolo || '',
    numero_devolucao: dev?.numero_devolucao || '',
    motorista: dev?.motorista_nome || 'N/A',
    veiculo: dev?.veiculo_placa || 'N/A',
    rota: dev?.carga_rota || 'N/A',
    cliente: dev?.cliente_nome || 'N/A',
    itens_divergentes: itensDivergentes,
    gerado_em: new Date().toISOString(),
    tipo: 'DESCONTO_MOTORISTA'
  };
}

function baixarRelatorioDivergencia(relatorio) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Por favor, permita pop-ups no navegador para visualizar/imprimir o relatório.');
    return;
  }

  const itensHtml = (relatorio.itens_divergentes || []).map((item, idx) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px; font-weight: bold; color: #0f172a; text-align: center;">${idx + 1}</td>
      <td style="padding: 10px; font-family: monospace; font-weight: bold; color: #047857;">${item.codigo_produto || '—'}</td>
      <td style="padding: 10px; color: #1e293b; font-weight: 600;">${item.descricao_produto || 'Produto'}</td>
      <td style="padding: 10px; text-align: center; color: #475569;">${item.quantidade_esperada} un.</td>
      <td style="padding: 10px; text-align: center; color: #475569;">${item.quantidade_recebida} un.</td>
      <td style="padding: 10px; text-align: center; font-weight: bold; color: #dc2626; background-color: #fef2f2;">${item.quantidade_faltante} un.</td>
      <td style="padding: 10px; color: #475569; font-size: 11px;">${item.observacao || '—'}</td>
    </tr>
  `).join('');

  win.document.write(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Relatório de Divergência Física - ${relatorio.numero_devolucao || relatorio.protocolo}</title>
      <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #0f172a; margin: 0; padding: 20px; background-color: #ffffff; }
        .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #047857; padding-bottom: 15px; margin-bottom: 20px; }
        .logo-area { display: flex; align-items: center; gap: 12px; }
        .logo-box { background: #064e3b; color: white; padding: 8px 14px; border-radius: 8px; font-weight: 900; font-size: 20px; letter-spacing: 1px; }
        .title-box { text-align: right; }
        .title { font-size: 18px; font-weight: 900; color: #064e3b; text-transform: uppercase; margin: 0; }
        .subtitle { font-size: 11px; color: #64748b; font-weight: 600; margin-top: 3px; }
        
        .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; margin-bottom: 20px; font-size: 12px; }
        .info-item { display: flex; flex-direction: column; }
        .info-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }
        .info-val { font-size: 13px; font-weight: 700; color: #0f172a; }

        table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 12px; }
        th { background: #064e3b; color: #ffffff; text-transform: uppercase; font-size: 10px; padding: 10px; text-align: left; }
        
        .alert-box { background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 12px; margin-bottom: 30px; font-size: 11px; color: #9f1239; font-weight: 600; line-height: 1.5; }
        
        .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; margin-top: 40px; padding-top: 20px; }
        .sig-line { border-top: 1px solid #94a3b8; text-align: center; padding-top: 6px; font-size: 11px; font-weight: 700; color: #334155; }

        @media print {
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 15px; text-align: right;">
        <button onclick="window.print()" style="background: #047857; color: white; border: none; padding: 8px 16px; font-weight: bold; border-radius: 6px; cursor: pointer;">🖨️ Imprimir / Salvar PDF</button>
      </div>

      <div class="header">
        <div class="logo-area">
          <div class="logo-box">JR OPER</div>
          <div>
            <div style="font-weight: 800; font-size: 14px; color: #0f172a;">JR DISTRIBUIDORA DE ALIMENTOS</div>
            <div style="font-size: 10px; color: #64748b;">Sistema Integrado de Operações Logísticas • Recepção CD</div>
          </div>
        </div>
        <div class="title-box">
          <div class="title">Relatório de Divergência Física</div>
          <div class="subtitle">Comprovante de Falta de Produtos no Recebimento</div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Protocolo SAC / Devolução</span>
          <span class="info-val" style="color: #047857;">${relatorio.numero_devolucao || relatorio.protocolo}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Data e Hora do Recebimento CD</span>
          <span class="info-val">${new Date(relatorio.gerado_em).toLocaleString('pt-BR')}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Motorista Responsável</span>
          <span class="info-val">${relatorio.motorista || '—'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Veículo / Placa</span>
          <span class="info-val">${relatorio.veiculo || '—'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Rota de Origem</span>
          <span class="info-val">${relatorio.rota || '—'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Cliente Reclamante</span>
          <span class="info-val">${relatorio.cliente || '—'}</span>
        </div>
      </div>

      <table style="width: 100%;">
        <thead>
          <tr>
            <th style="text-align: center; width: 40px;">#</th>
            <th style="width: 90px;">Cód. Item</th>
            <th>Descrição do Produto</th>
            <th style="text-align: center;">Qtd Esperada</th>
            <th style="text-align: center;">Qtd Recebida</th>
            <th style="text-align: center;">Qtd Faltante</th>
            <th>Observação CD</th>
          </tr>
        </thead>
        <tbody>
          ${itensHtml}
        </tbody>
      </table>

      <div class="alert-box">
        ⚠️ <b>SITUAÇÃO DA CONFERÊNCIA:</b> Foram identificadas divergências físicas nas quantidades recebidas na conferência do CD.<br>
        Este documento comprova oficialmente os itens e quantidades faltantes para fins de acerto e abatimento financeiro.
      </div>

      <div class="signatures">
        <div class="sig-line">
          Conferente Responsável (CD)<br>
          <span style="font-size: 9px; font-weight: normal; color: #64748b;">Assinatura & Carimbo</span>
        </div>
        <div class="sig-line">
          Motorista Responsável<br>
          <span style="font-size: 9px; font-weight: normal; color: #64748b;">Assinatura & Data</span>
        </div>
      </div>

      <script>
        window.onload = function() {
          setTimeout(function() { window.print(); }, 500);
        };
      </script>
    </body>
    </html>
  `);
  win.document.close();
}

// ===== MÓDULO: CONTROLE DE VIAGENS (LARGADAS & OCORRÊNCIAS OPERACIONAIS) =====
let activeViagensSubTab = 'largada';

function switchViagensSubTab(sub) {
  activeViagensSubTab = sub;
  renderApp();
}

function renderControleViagensView() {
  let contentHtml = renderViagensLargadaSubTab();
  if (activeViagensSubTab === 'operacional' || activeViagensSubTab === 'ocorrencias') {
    contentHtml = renderViagensOcorrenciasSubTab();
  } else if (activeViagensSubTab === 'frota_rota') {
    contentHtml = renderRotaOcorrenciasView();
  } else if (activeViagensSubTab === 'troca_veiculos') {
    contentHtml = renderViagensTrocaVeiculosSubTab();
  }

  return `
    <div class="space-y-5">
      <!-- TOPO E NAVEGAÇÃO ENTRE SUB-ABAS -->
      <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-black text-white flex items-center gap-2">
            <span>🚍</span> Central de Controle de Operações & Viagens
          </h1>
          <p class="text-xs text-slate-400">Escala de largada, trocas de veículos, ocorrências operacionais e frota em rota</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Botão Relatório de Largada -->
          <button onclick="gerarRelatorioLargadaOperacaoModal()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-2 rounded-xl text-xs shadow flex items-center gap-1.5" title="Relatório Corporativo de Largada">
            <span>📄</span> Relatório de Largada
          </button>

          <!-- SELETOR DE SUB-ABAS -->
          <div class="flex flex-wrap gap-1 bg-slate-900 border border-slate-800 p-1.5 rounded-xl shadow-lg">
            <button onclick="switchViagensSubTab('largada')" class="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${activeViagensSubTab==='largada'?'bg-emerald-700 text-white shadow-lg':'text-slate-400 hover:text-white'}">
              <span>🚩</span> Largada (Escala)
            </button>
            <button onclick="switchViagensSubTab('operacional')" class="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${(activeViagensSubTab==='operacional'||activeViagensSubTab==='ocorrencias')?'bg-amber-700 text-white shadow-lg':'text-slate-400 hover:text-white'}">
              <span>⚠️</span> Oc. Operacionais
            </button>
            <button onclick="switchViagensSubTab('frota_rota')" class="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${activeViagensSubTab==='frota_rota'?'bg-red-800 text-white shadow-lg':'text-slate-400 hover:text-white'}">
              <span>🚚</span> Oc. Rota (Frota)
            </button>
            <button onclick="switchViagensSubTab('troca_veiculos')" class="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${activeViagensSubTab==='troca_veiculos'?'bg-purple-800 text-white shadow-lg':'text-slate-400 hover:text-white'}">
              <span>🔄</span> Troca de Veículos
            </button>
          </div>
        </div>
      </div>

      <div>
        ${contentHtml}
      </div>
    </div>`;
}

// ===== IMPORTE DA ESCALA FECHAMENTO.XLSX =====
function triggerImportEscala() {
  document.getElementById('escala-file-input')?.click();
}

function parseEscalaWorkbook(workbook, fileName = '') {
  let fileDate = new Date().toISOString().split('T')[0];
  const dateMatch = fileName.match(/(\d{2})[\.\/](\d{2})[\.\/](\d{4})/);
  if (dateMatch) {
    fileDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  }

  const sheetName = workbook.SheetNames.includes('Escala') ? 'Escala' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const viagens = [];
  let currentSetor = 'FRIO';
  let headerMap = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowStr = row.map(c => String(c)).join(' ').toUpperCase();

    if (rowStr.includes('GESTÃO DE EMBARQUES') || rowStr.includes('EMBARQUES -') || rowStr.includes('EMBARQUE -')) {
      if (rowStr.includes('SECO')) currentSetor = 'SECO';
      else if (rowStr.includes('FRIO')) currentSetor = 'FRIO';
      headerMap = null;
      continue;
    }

    const isHeaderRow = row.some(cell => {
      const c = String(cell).trim().toUpperCase();
      return c === 'CARREG' || c === 'CARGA' || c === 'Nº CARGA' || c === 'ROTA - DESTINO' || c === 'MOTORISTA' || c === 'PLACA';
    });

    if (isHeaderRow) {
      headerMap = {};
      row.forEach((cell, colIdx) => {
        const c = String(cell).trim().toUpperCase();
        if (c.includes('CARREG') || c.includes('CARGA')) headerMap.carga = colIdx;
        else if (c.includes('ROTA')) headerMap.rota = colIdx;
        else if (c.includes('PLACA') || c.includes('VEICULO') || c.includes('VEÍCULO')) headerMap.placa = colIdx;
        else if (c.includes('MOTORISTA')) headerMap.motorista = colIdx;
        else if (c.includes('AJUDANTE')) headerMap.ajudante = colIdx;
        else if (c.includes('OBSERV')) headerMap.observacao = colIdx;
        else if (c.includes('SETOR')) headerMap.setor = colIdx;
        else if (c.includes('SAIDA') || c.includes('SAÍDA')) headerMap.data_saida = colIdx;
        else if (c.includes('STATUS')) headerMap.status_viagem = colIdx;
        else if (c.includes('FUSION')) headerMap.fusion = colIdx;
        else if (c.includes('CHECKLIST')) headerMap.checklist_saida = colIdx;
      });
      continue;
    }

    if (headerMap && headerMap.carga !== undefined) {
      const rawCarga = String(row[headerMap.carga] || '').trim();
      const rawRota = String(row[headerMap.rota] || '').trim();
      const rawMotorista = String(row[headerMap.motorista] || '').trim();

      if (rawCarga && !rawCarga.toUpperCase().includes('TOTAL') && !rawCarga.toUpperCase().includes('MONTAGEM') && rawCarga !== '0') {
        viagens.push({
          carga: rawCarga,
          rota: (rawRota || '').toUpperCase(),
          placa: String(headerMap.placa !== undefined ? row[headerMap.placa] : '').trim().toUpperCase(),
          motorista: (rawMotorista || '').toUpperCase(),
          ajudante: String(headerMap.ajudante !== undefined ? row[headerMap.ajudante] : '').trim().toUpperCase(),
          setor: (headerMap.setor !== undefined && row[headerMap.setor] ? String(row[headerMap.setor]).trim().toUpperCase() : currentSetor),
          data_saida: (headerMap.data_saida !== undefined && row[headerMap.data_saida] ? String(row[headerMap.data_saida]).trim() : fileDate),
          hora_saida: '04:30',
          status_viagem: (headerMap.status_viagem !== undefined && row[headerMap.status_viagem] ? String(row[headerMap.status_viagem]).trim().toUpperCase() : 'EM ANDAMENTO'),
          fusion: (headerMap.fusion !== undefined && row[headerMap.fusion] ? String(row[headerMap.fusion]).trim().toUpperCase() : 'INICIADO'),
          checklist_saida: (headerMap.checklist_saida !== undefined && row[headerMap.checklist_saida] ? String(row[headerMap.checklist_saida]).trim().toUpperCase() : 'INICIADO'),
          checklist_chegada: 'NÃO INICIADO',
          observacao: String(headerMap.observacao !== undefined ? row[headerMap.observacao] : '').trim()
        });
      }
    }
  }

  if (viagens.length === 0) {
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (json && json.length > 0) {
      json.forEach(row => {
        const getVal = (possibleKeys) => {
          for (let k of possibleKeys) {
            const matchKey = Object.keys(row).find(rk => rk.trim().toUpperCase() === k.toUpperCase());
            if (matchKey && row[matchKey] !== undefined) return String(row[matchKey]).trim();
          }
          return '';
        };

        const carga = getVal(['CARGA', 'Nº CARGA', 'CARGA_ID', 'CARREG']);
        if (carga && !carga.toUpperCase().includes('TOTAL')) {
          viagens.push({
            carga,
            rota: getVal(['ROTA', 'NOME ROTA', 'ROTA - DESTINO']),
            placa: getVal(['PLACA', 'VEICULO', 'VEÍCULO']),
            motorista: getVal(['MOTORISTA', 'NOME MOTORISTA']),
            ajudante: getVal(['AJUDANTE', 'NOME AJUDANTE']),
            setor: getVal(['SETOR']) || 'FRIO',
            data_saida: getVal(['DATA SAIDA', 'DATA SAÍDA', 'DATA_SAIDA']) || fileDate,
            hora_saida: getVal(['HORA SAIDA', 'HORA SAÍDA', 'HORA_SAIDA']) || '04:30',
            data_entrega: getVal(['DATA 1ª ENTREGA', 'DATA ENTREGA', 'DATA_ENTREGA']),
            hora_entrega: getVal(['HORA 1ª ENTREGA', 'HORA ENTREGA', 'HORA_ENTREGA']),
            data_retorno: getVal(['DATA RETORNO', 'DATA_RETORNO']),
            hora_retorno: getVal(['HORA RETORNO', 'HORA_RETORNO']),
            status_viagem: getVal(['STATUS', 'STATUS DA VIAGEM', 'STATUS_VIAGEM']) || 'EM ANDAMENTO',
            fusion: getVal(['FUSION']) || 'INICIADO',
            checklist_saida: getVal(['CHECKLIST SAIDA', 'CHECKLIST SAÍDA', 'CHECKLIST_SAIDA']) || 'INICIADO',
            checklist_chegada: getVal(['CHECKLIST CHEGADA', 'CHECKLIST_CHEGADA']) || 'NÃO INICIADO',
            observacao: getVal(['OBSERVAÇÃO', 'OBSERVACAO', 'OCORRÊNCIA LARGADA', 'OBS'])
          });
        }
      });
    }
  }

  return viagens;
}

function handleImportEscalaFile(event) {
  if (typeof XLSX === 'undefined') {
    alert('⚠️ A biblioteca de leitura de Excel (SheetJS) não está carregada.');
    return;
  }

  const file = event.target.files[0];
  if (!file) return;

  const fileName = file.name || 'FECHAMENTO.xlsx';
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const viagensFormatadas = parseEscalaWorkbook(workbook, fileName);

      if (!viagensFormatadas || viagensFormatadas.length === 0) {
        alert('⚠️ A planilha importada está vazia ou nenhuma viagem válida foi reconhecida.');
        return;
      }

      const qtd = db.importViagens(viagensFormatadas);
      alert(`✅ Sucesso! ${qtd} viagens foram importadas da escala (${fileName})!`);
      renderApp();
    } catch (err) {
      console.error(err);
      alert(`❌ Erro ao ler a planilha: ${err.message}`);
    }
  };
  reader.readAsArrayBuffer(file);
}

function limparFiltrosViagens() {
  window._vgFiltroSaidaDe = '';
  window._vgFiltroSaidaAte = '';
  window._vgFiltroRetornoDe = '';
  window._vgFiltroRetornoAte = '';
  window._vgFiltroStatus = '';
  window._vgFiltroChkSaida = '';
  window._vgFiltroChkChegada = '';
  window._vgFiltroFusion = '';
  renderApp();
}

// SUB-ABA 1: ACOMPANHAMENTO DE LARGADA (ESCALA)
function renderViagensLargadaSubTab() {
  const todasViagens = db.getControleViagens();
  const veiculos = db.data.veiculos.filter(v => v.situacao !== 'Inativo');
  const motoristas = db.data.motoristas;
  const ajudantes = db.data.ajudantes;
  const rotas = db.data.rotas || [];

  const fSaidaDe    = window._vgFiltroSaidaDe    || '';
  const fSaidaAte   = window._vgFiltroSaidaAte   || '';
  const fRetornoDe  = window._vgFiltroRetornoDe  || '';
  const fRetornoAte = window._vgFiltroRetornoAte || '';
  const fStatus     = window._vgFiltroStatus     || '';
  const fChkSaida   = window._vgFiltroChkSaida   || '';
  const fChkChegada = window._vgFiltroChkChegada || '';
  const fFusion     = window._vgFiltroFusion     || '';

  let viagens = todasViagens.filter(v => {
    const dSaida = v.data_saida || '';
    const dRetorno = v.data_retorno || v.data_entrega || v.data_saida || '';

    if (fSaidaDe && dSaida < fSaidaDe) return false;
    if (fSaidaAte && dSaida > fSaidaAte) return false;
    if (fRetornoDe && dRetorno < fRetornoDe) return false;
    if (fRetornoAte && dRetorno > fRetornoAte) return false;

    if (fStatus && v.status_viagem !== fStatus) return false;
    if (fChkSaida && v.checklist_saida !== fChkSaida) return false;
    if (fChkChegada && v.checklist_chegada !== fChkChegada) return false;
    if (fFusion && v.fusion !== fFusion) return false;

    return true;
  });

  const temFiltroAtivo = fSaidaDe || fSaidaAte || fRetornoDe || fRetornoAte || fStatus || fChkSaida || fChkChegada || fFusion;

  return `
    <div class="space-y-4">
      <input type="file" id="escala-file-input" accept=".xlsx,.xls,.csv" onchange="handleImportEscalaFile(event)" class="hidden">

      <!-- HEADER CENTRAL DE CONTROLE DE OPERAÇÕES -->
      <div class="bg-gradient-to-r from-emerald-800 via-emerald-700 to-green-800 p-4 rounded-xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-3 text-white">
        <div class="flex items-center gap-3">
          <img src="./public/logo.png" class="h-10 w-10 bg-white rounded-lg p-1 object-contain shadow" alt="JR Logo">
          <div>
            <h2 class="text-lg font-black tracking-wider uppercase">CENTRAL DE CONTROLE DE OPERAÇÕES</h2>
            <p class="text-[11px] text-emerald-100 font-medium">Controle de Escala, Saídas, Entregas e Encerramento de Viagens</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button onclick="triggerImportEscala()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-2 rounded-lg text-xs shadow flex items-center gap-1.5" title="Importar arquivo FECHAMENTO.XLSX">
            <span>📥</span> Importar Escala (.XLSX)
          </button>
          <button onclick="toggleFormNovaViagem()" class="bg-slate-900 hover:bg-slate-800 text-emerald-300 font-black px-3.5 py-2 rounded-lg text-xs border border-emerald-600 shadow">+ Nova Viagem</button>
        </div>
      </div>

      <!-- PAINEL DE FILTROS AVANÇADOS DA ESCALA -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2">
            <span class="text-emerald-400 font-bold text-sm">🔍</span>
            <h3 class="text-xs font-bold text-white uppercase tracking-wider">Filtros da Operação</h3>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-slate-400 font-semibold">${viagens.length} de ${todasViagens.length} viagem(ns)</span>
            ${temFiltroAtivo ? `<button onclick="limparFiltrosViagens()" class="bg-slate-800 hover:bg-slate-700 text-red-400 text-[10px] font-bold px-2.5 py-1 rounded border border-slate-700">Limpar Filtros ✕</button>` : ''}
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <!-- Filtro Data de Saída -->
          <div class="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-[10px] text-emerald-400 font-bold uppercase">📅 Data de Saída (Entre)</label>
            <div class="grid grid-cols-2 gap-1.5">
              <div>
                <span class="text-[9px] text-slate-400 block">De:</span>
                <input type="date" value="${fSaidaDe}" onchange="window._vgFiltroSaidaDe=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1 text-[11px]">
              </div>
              <div>
                <span class="text-[9px] text-slate-400 block">Até:</span>
                <input type="date" value="${fSaidaAte}" onchange="window._vgFiltroSaidaAte=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1 text-[11px]">
              </div>
            </div>
          </div>

          <!-- Filtro Data de Retorno -->
          <div class="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-[10px] text-blue-400 font-bold uppercase">🏁 Data de Retorno (Entre)</label>
            <div class="grid grid-cols-2 gap-1.5">
              <div>
                <span class="text-[9px] text-slate-400 block">De:</span>
                <input type="date" value="${fRetornoDe}" onchange="window._vgFiltroRetornoDe=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1 text-[11px]">
              </div>
              <div>
                <span class="text-[9px] text-slate-400 block">Até:</span>
                <input type="date" value="${fRetornoAte}" onchange="window._vgFiltroRetornoAte=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1 text-[11px]">
              </div>
            </div>
          </div>

          <!-- Filtro por Status da Viagem & Fusion -->
          <div class="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-[10px] text-amber-400 font-bold uppercase">🚦 Status & Fusion</label>
            <div class="grid grid-cols-2 gap-1.5">
              <div>
                <span class="text-[9px] text-slate-400 block">Status Viagem:</span>
                <select onchange="window._vgFiltroStatus=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1 text-[11px]">
                  <option value="">Todos</option>
                  <option value="EM ANDAMENTO" ${fStatus==='EM ANDAMENTO'?'selected':''}>EM ANDAMENTO</option>
                  <option value="EM RETORNO" ${fStatus==='EM RETORNO'?'selected':''}>EM RETORNO</option>
                  <option value="FINALIZADO" ${fStatus==='FINALIZADO'?'selected':''}>FINALIZADO</option>
                </select>
              </div>
              <div>
                <span class="text-[9px] text-slate-400 block">Fusion:</span>
                <select onchange="window._vgFiltroFusion=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1 text-[11px]">
                  <option value="">Todos</option>
                  <option value="INICIADO" ${fFusion==='INICIADO'?'selected':''}>INICIADO</option>
                  <option value="NÃO INICIADO" ${fFusion==='NÃO INICIADO'?'selected':''}>NÃO INICIADO</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Filtro Checklists -->
          <div class="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-[10px] text-purple-400 font-bold uppercase">📋 Checklists</label>
            <div class="grid grid-cols-2 gap-1.5">
              <div>
                <span class="text-[9px] text-slate-400 block">Checklist Saída:</span>
                <select onchange="window._vgFiltroChkSaida=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1 text-[11px]">
                  <option value="">Todos</option>
                  <option value="INICIADO" ${fChkSaida==='INICIADO'?'selected':''}>INICIADO</option>
                  <option value="NÃO INICIADO" ${fChkSaida==='NÃO INICIADO'?'selected':''}>NÃO INICIADO</option>
                </select>
              </div>
              <div>
                <span class="text-[9px] text-slate-400 block">Checklist Chegada:</span>
                <select onchange="window._vgFiltroChkChegada=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1 text-[11px]">
                  <option value="">Todos</option>
                  <option value="INICIADO" ${fChkChegada==='INICIADO'?'selected':''}>INICIADO</option>
                  <option value="NÃO INICIADO" ${fChkChegada==='NÃO INICIADO'?'selected':''}>NÃO INICIADO</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- FORMULÁRIO DE NOVA VIAGEM -->
      <div id="form-nova-viagem" class="hidden bg-slate-900 border border-emerald-800/60 rounded-xl p-4 shadow-xl space-y-3">
        <h3 class="font-bold text-emerald-400 text-xs uppercase">Lançamento de Nova Viagem na Escala</h3>
        <form onsubmit="handleNovaViagemSubmit(event)" class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Nº Carga *</label>
              <input type="text" id="vg-carga" required placeholder="Ex: 43125" class="w-full bg-slate-800 border border-slate-700 text-emerald-400 font-bold rounded p-1.5 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Rota *</label>
              <select id="vg-rota" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">-- Selecione --</option>
                ${rotas.map(r => `<option value="${r}">${r}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Veículo / Placa *</label>
              <select id="vg-placa" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">-- Selecione --</option>
                ${veiculos.map(v => `<option value="${v.placa}">${v.placa} — ${v.tipo||v.modelo}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Setor *</label>
              <select id="vg-setor" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="FRIO">FRIO</option>
                <option value="SECO">SECO</option>
                <option value="HORTI">HORTI</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Motorista *</label>
              <select id="vg-motorista" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">-- Selecione --</option>
                ${motoristas.map(m => `<option value="${m.nome}">${m.nome}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Ajudante *</label>
              <select id="vg-ajudante" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">-- Selecione --</option>
                ${ajudantes.map(a => `<option value="${a.nome}">${a.nome}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Data Saída</label>
              <input type="date" id="vg-data-saida" value="${new Date().toISOString().split('T')[0]}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Hora Saída</label>
              <input type="time" id="vg-hora-saida" value="04:30" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Status da Viagem</label>
              <select id="vg-status" class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded p-1.5 text-xs">
                <option value="EM ANDAMENTO">EM ANDAMENTO</option>
                <option value="EM RETORNO">EM RETORNO</option>
                <option value="FINALIZADO">FINALIZADO</option>
              </select>
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Checklist Saída</label>
              <select id="vg-chk-saida" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="INICIADO">INICIADO</option>
                <option value="NÃO INICIADO">NÃO INICIADO</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-[10px] text-slate-300 mb-1">Observação / Ocorrência Largada</label>
            <input type="text" id="vg-obs" placeholder="Ex: Substituição de ajudante ou atraso..." class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" onclick="toggleFormNovaViagem()" class="bg-slate-800 text-slate-300 px-3 py-1.5 rounded text-xs font-bold">Cancelar</button>
            <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-1.5 rounded text-xs font-bold shadow">+ Lançar Viagem</button>
          </div>
        </form>
      </div>

      <!-- TABELA DE LARGADAS IDÊNTICA AO EXCEL -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-950 text-slate-300 text-[10px] uppercase border-b border-slate-800">
              <tr>
                <th class="p-2 border-r border-slate-800">Carga</th>
                <th class="p-2 border-r border-slate-800">Rota</th>
                <th class="p-2 border-r border-slate-800">Placa</th>
                <th class="p-2 border-r border-slate-800">Motorista</th>
                <th class="p-2 border-r border-slate-800">Ajudante</th>
                <th class="p-2 border-r border-slate-800">Setor</th>
                <th class="p-2 border-r border-slate-800 text-center bg-slate-900/80">Saída<br><span class="text-[9px] text-slate-500">Data / Hora</span></th>
                <th class="p-2 border-r border-slate-800 text-center bg-slate-900/80">1ª Entrega<br><span class="text-[9px] text-slate-500">Data / Hora</span></th>
                <th class="p-2 border-r border-slate-800 text-center bg-slate-900/80">Retorno<br><span class="text-[9px] text-slate-500">Data / Hora</span></th>
                <th class="p-2 border-r border-slate-800 min-w-[150px]">Ocorrência Largada / Obs</th>
                <th class="p-2 border-r border-slate-800 text-center">Status</th>
                <th class="p-2 border-r border-slate-800 text-center">Fusion</th>
                <th class="p-2 border-r border-slate-800 text-center">Checklist Saída</th>
                <th class="p-2 border-r border-slate-800 text-center">Checklist Chegada</th>
                <th class="p-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800 text-[11px]">
              ${viagens.length === 0 ? '<tr><td colspan="15" class="p-6 text-center text-slate-500">Nenhuma viagem encontrada no período selecionado.</td></tr>' :
              viagens.map(v => {
                let statusBg = 'bg-amber-300 text-slate-950';
                if (v.status_viagem === 'EM RETORNO') statusBg = 'bg-blue-900 text-white';
                if (v.status_viagem === 'FINALIZADO') statusBg = 'bg-emerald-700 text-white';

                return `
                  <tr class="hover:bg-slate-800/50">
                    <td class="p-2 border-r border-slate-800 font-bold text-emerald-400">${v.carga}</td>
                    <td class="p-2 border-r border-slate-800 font-semibold text-slate-200">${v.rota}</td>
                    <td class="p-2 border-r border-slate-800 font-bold text-white">${v.placa}</td>
                    <td class="p-2 border-r border-slate-800 text-slate-300">${v.motorista}</td>
                    <td class="p-2 border-r border-slate-800 text-slate-300">${v.ajudante}</td>
                    <td class="p-2 border-r border-slate-800 font-bold text-slate-400 text-[10px]">${v.setor||'FRIO'}</td>
                    
                    <td class="p-2 border-r border-slate-800 text-center text-[10px]">
                      <div class="text-slate-300 font-medium">${v.data_saida||'—'}</div>
                      <div class="text-emerald-400 font-bold">${v.hora_saida||'—'}</div>
                    </td>

                    <td class="p-2 border-r border-slate-800 text-center text-[10px]">
                      <div class="text-slate-300 font-medium">${v.data_entrega||'—'}</div>
                      <div class="text-blue-400 font-bold">${v.hora_entrega||'—'}</div>
                    </td>

                    <td class="p-2 border-r border-slate-800 text-center text-[10px]">
                      <div class="text-slate-300 font-medium">${v.data_retorno||'—'}</div>
                      <div class="text-amber-400 font-bold">${v.hora_retorno||'—'}</div>
                    </td>

                    <td class="p-2 border-r border-slate-800 text-[10px] text-slate-300 italic">${v.observacao||'—'}</td>

                    <td class="p-2 border-r border-slate-800 text-center">
                      <span class="${statusBg} font-black px-2 py-0.5 rounded text-[10px] block whitespace-nowrap">
                        ${v.status_viagem}
                      </span>
                    </td>

                    <td class="p-2 border-r border-slate-800 text-center">
                      <span class="${v.fusion==='INICIADO'?'bg-emerald-950 text-emerald-300 border border-emerald-800':'bg-red-950 text-red-400 border border-red-900'} font-bold px-1.5 py-0.5 rounded text-[9px] block">
                        ${v.fusion==='INICIADO'?'INICIADO':'NÃO INICIADO'}
                      </span>
                    </td>

                    <td class="p-2 border-r border-slate-800 text-center">
                      <span class="${v.checklist_saida==='INICIADO'?'bg-emerald-950 text-emerald-300 border border-emerald-800':'bg-red-950 text-red-400 border border-red-900'} font-bold px-1.5 py-0.5 rounded text-[9px] block">
                        ${v.checklist_saida==='INICIADO'?'INICIADO':'NÃO INICIADO'}
                      </span>
                    </td>

                    <td class="p-2 border-r border-slate-800 text-center">
                      <span class="${v.checklist_chegada==='INICIADO'?'bg-emerald-950 text-emerald-300 border border-emerald-800':'bg-red-950 text-red-400 border border-red-900'} font-bold px-1.5 py-0.5 rounded text-[9px] block">
                        ${v.checklist_chegada==='INICIADO'?'INICIADO':'NÃO INICIADO'}
                      </span>
                    </td>

                    <td class="p-2 text-right whitespace-nowrap">
                      <button onclick="editarViagemModal('${v.id}')" class="text-blue-400 hover:text-blue-300 p-1 font-bold text-sm" title="Editar Viagem">✏️</button>
                      <button onclick="deleteViagem('${v.id}')" class="text-red-400 hover:text-red-300 p-1 font-bold text-sm" title="Excluir Viagem">🗑️</button>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function toggleFormNovaViagem() {
  document.getElementById('form-nova-viagem')?.classList.toggle('hidden');
}

function handleNovaViagemSubmit(e) {
  e.preventDefault();
  db.addViagem({
    carga: document.getElementById('vg-carga').value,
    rota: document.getElementById('vg-rota').value,
    placa: document.getElementById('vg-placa').value,
    setor: document.getElementById('vg-setor').value,
    motorista: document.getElementById('vg-motorista').value,
    ajudante: document.getElementById('vg-ajudante').value,
    data_saida: document.getElementById('vg-data-saida').value,
    hora_saida: document.getElementById('vg-hora-saida').value,
    status_viagem: document.getElementById('vg-status').value,
    checklist_saida: document.getElementById('vg-chk-saida').value,
    observacao: document.getElementById('vg-obs').value
  });
  alert('✅ Viagem lançada na escala!');
  renderApp();
}

function deleteViagem(id) {
  if (confirm('Excluir esta viagem da escala?')) {
    db.deleteViagem(id);
    renderApp();
  }
}

function editarViagemModal(id) {
  const v = db.getControleViagens().find(x => x.id == id);
  if (!v) return;

  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <h3 class="font-bold text-white text-sm">Atualizar Viagem — Carga ${v.carga}</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white text-sm">✕</button>
      </div>

      <form onsubmit="handleSalvarEdicaoViagem(event, '${v.id}')" class="space-y-3 text-xs">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-emerald-400 font-bold mb-1">Data de Saída *</label>
            <input type="date" id="ed-vg-data-saida" value="${v.data_saida||''}" required class="w-full bg-slate-800 border border-emerald-600 text-white font-bold rounded p-1.5">
          </div>
          <div>
            <label class="block text-[10px] text-emerald-400 font-bold mb-1">Hora de Saída *</label>
            <input type="time" id="ed-vg-hora-saida" value="${v.hora_saida||'04:30'}" required class="w-full bg-slate-800 border border-emerald-600 text-white font-bold rounded p-1.5">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Status da Viagem</label>
            <select id="ed-vg-status" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              <option value="EM ANDAMENTO" ${v.status_viagem==='EM ANDAMENTO'?'selected':''}>EM ANDAMENTO</option>
              <option value="EM RETORNO" ${v.status_viagem==='EM RETORNO'?'selected':''}>EM RETORNO</option>
              <option value="FINALIZADO" ${v.status_viagem==='FINALIZADO'?'selected':''}>FINALIZADO</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Setor</label>
            <select id="ed-vg-setor" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              <option value="FRIO" ${v.setor==='FRIO'?'selected':''}>FRIO</option>
              <option value="SECO" ${v.setor==='SECO'?'selected':''}>SECO</option>
              <option value="HORTI" ${v.setor==='HORTI'?'selected':''}>HORTI</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Data 1ª Entrega</label>
            <input type="date" id="ed-vg-data-ent" value="${v.data_entrega||''}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Hora 1ª Entrega</label>
            <input type="time" id="ed-vg-hora-ent" value="${v.hora_entrega||''}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Data Retorno</label>
            <input type="date" id="ed-vg-data-ret" value="${v.data_retorno||''}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Hora Retorno</label>
            <input type="time" id="ed-vg-hora-ret" value="${v.hora_retorno||''}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Fusion</label>
            <select id="ed-vg-fusion" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              <option value="INICIADO" ${v.fusion==='INICIADO'?'selected':''}>INICIADO</option>
              <option value="NÃO INICIADO" ${v.fusion==='NÃO INICIADO'?'selected':''}>NÃO INICIADO</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Checklist Saída</label>
            <select id="ed-vg-chk-saida" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              <option value="INICIADO" ${v.checklist_saida==='INICIADO'?'selected':''}>INICIADO</option>
              <option value="NÃO INICIADO" ${v.checklist_saida==='NÃO INICIADO'?'selected':''}>NÃO INICIADO</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Checklist Chegada</label>
            <select id="ed-vg-chk-chegada" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              <option value="INICIADO" ${v.checklist_chegada==='INICIADO'?'selected':''}>INICIADO</option>
              <option value="NÃO INICIADO" ${v.checklist_chegada==='NÃO INICIADO'?'selected':''}>NÃO INICIADO</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 mb-1">Observação / Ocorrência Largada</label>
          <input type="text" id="ed-vg-obs" value="${v.observacao||''}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="bg-slate-800 text-slate-300 font-bold px-3 py-1.5 rounded">Cancelar</button>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-1.5 rounded shadow">Salvar Atualização</button>
        </div>
      </form>
    </div>`;
  modalContainer.classList.remove('hidden');
}

function handleSalvarEdicaoViagem(e, id) {
  e.preventDefault();
  db.updateViagem(id, {
    data_saida: document.getElementById('ed-vg-data-saida').value,
    hora_saida: document.getElementById('ed-vg-hora-saida').value,
    status_viagem: document.getElementById('ed-vg-status').value,
    setor: document.getElementById('ed-vg-setor').value,
    data_entrega: document.getElementById('ed-vg-data-ent').value,
    hora_entrega: document.getElementById('ed-vg-hora-ent').value,
    data_retorno: document.getElementById('ed-vg-data-ret').value,
    hora_retorno: document.getElementById('ed-vg-hora-ret').value,
    fusion: document.getElementById('ed-vg-fusion').value,
    checklist_saida: document.getElementById('ed-vg-chk-saida').value,
    checklist_chegada: document.getElementById('ed-vg-chk-chegada').value,
    observacao: document.getElementById('ed-vg-obs').value
  });
  closeModal();
  alert('✅ Viagem atualizada!');
  renderApp();
}

// SUB-ABA 2: TRATAMENTO DE OCORRÊNCIAS OPERACIONAIS DE VIAGEM (DIVIDIDA EM PENDENTES E FINALIZADAS)
function renderViagensOcorrenciasSubTab() {
  const todasOcs = db.getOcorrenciasViagens();
  const motivos = db.data.motivos_ocorrencia || [];
  const veiculos = db.data.veiculos;
  const motoristas = db.data.motoristas;
  const ajudantes = db.data.ajudantes;
  const rotas = db.data.rotas || [];

  // Separar em Pendentes e Finalizadas
  const pendentes = todasOcs.filter(o => o.status !== 'FINALIZADA');

  // Filtros para as Finalizadas
  const fDe     = window._ocFiltroDataDe  || '';
  const fAte    = window._ocFiltroDataAte || '';
  const fCarga  = window._ocFiltroCarga   || '';
  const fFunc   = window._ocFiltroFunc    || '';
  const fPlaca  = window._ocFiltroPlaca   || '';
  const fRota   = window._ocFiltroRota    || '';
  const fMotivo = window._ocFiltroMotivo  || '';

  let finalizadas = todasOcs.filter(o => o.status === 'FINALIZADA');

  if (fDe)     finalizadas = finalizadas.filter(o => (o.data||'') >= fDe);
  if (fAte)    finalizadas = finalizadas.filter(o => (o.data||'') <= fAte);
  if (fCarga)  finalizadas = finalizadas.filter(o => String(o.carga||'').includes(fCarga));
  if (fFunc)   finalizadas = finalizadas.filter(o => (o.funcionario||'').toLowerCase().includes(fFunc.toLowerCase()));
  if (fPlaca)  finalizadas = finalizadas.filter(o => (o.placa||'').toLowerCase().includes(fPlaca.toLowerCase()));
  if (fRota)   finalizadas = finalizadas.filter(o => (o.rota||'').toLowerCase().includes(fRota.toLowerCase()));
  if (fMotivo) finalizadas = finalizadas.filter(o => o.motivo === fMotivo);

  const buildTableRow = (o) => `
    <tr class="hover:bg-slate-800/50">
      <td class="p-2 border-r border-slate-800 whitespace-nowrap text-slate-300">${o.data}</td>
      <td class="p-2 border-r border-slate-800 font-bold text-emerald-400">${o.carga}</td>
      <td class="p-2 border-r border-slate-800 text-slate-200">${o.rota}</td>
      <td class="p-2 border-r border-slate-800 font-bold text-white">${o.placa}</td>
      <td class="p-2 border-r border-slate-800 font-semibold text-slate-200">${o.funcionario}</td>
      <td class="p-2 border-r border-slate-800 text-[10px] text-slate-400">${o.funcao}</td>
      <td class="p-2 border-r border-slate-800"><span class="bg-slate-800 text-amber-300 font-bold px-1.5 py-0.5 rounded text-[10px]">${o.motivo}</span></td>
      <td class="p-2 border-r border-slate-800 text-amber-300 font-medium">${o.causa}</td>
      <td class="p-2 border-r border-slate-800 text-slate-200 font-medium">${o.ocorrencia}</td>
      <td class="p-2 border-r border-slate-800 text-emerald-300 font-semibold">${o.acao||'<span class="text-amber-400 italic">Aguardando Ação</span>'}</td>
      <td class="p-2 text-right whitespace-nowrap">
        <button onclick="editarOcViagemModal('${o.id}')" class="text-blue-400 hover:text-blue-300 p-1 font-bold text-sm" title="Editar Ocorrência">✏️</button>
        <button onclick="deleteOcViagem('${o.id}')" class="text-red-400 hover:text-red-300 p-1 font-bold text-sm" title="Excluir Ocorrência">🗑️</button>
      </td>
    </tr>`;

  return `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-red-900/60 p-4 rounded-xl shadow-xl">
        <div>
          <h2 class="text-sm font-black text-red-400 uppercase tracking-wider">⚠️ Tratamento de Ocorrências Operacionais de Viagem</h2>
          <p class="text-[11px] text-slate-400">Registro de faltas, problemas no checklist, conduta e ações tomadas na largada/rota</p>
        </div>
        <button onclick="toggleFormNovaOcViagem()" class="bg-red-700 hover:bg-red-600 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-lg">+ Nova Ocorrência Operacional</button>
      </div>

      <!-- FORMULÁRIO NOVA OCORRÊNCIA VIAGEM -->
      <div id="form-nova-oc-viagem" class="hidden bg-slate-900 border border-red-900/60 rounded-xl p-4 shadow-xl space-y-3">
        <h3 class="font-bold text-red-400 text-xs uppercase">Registro de Ocorrência com Obrigatoriedade de Causa, Ocorrência e Ação</h3>
        <form onsubmit="handleNovaOcViagemSubmit(event)" class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Data *</label>
              <input type="date" id="ocv-data" required value="${new Date().toISOString().split('T')[0]}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Nº Carga *</label>
              <input type="text" id="ocv-carga" required placeholder="Ex: 43004" class="w-full bg-slate-800 border border-slate-700 text-emerald-400 font-bold rounded p-1.5 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Rota *</label>
              <select id="ocv-rota" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">-- Selecione --</option>
                ${rotas.map(r => `<option value="${r}">${r}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Veículo / Placa *</label>
              <select id="ocv-placa" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">-- Selecione --</option>
                ${veiculos.map(v => `<option value="${v.placa}">${v.placa}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Funcionário Envolvido *</label>
              <input type="text" id="ocv-funcionario" required placeholder="Ex: PAULO DOS SANTOS RIBEIRO" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs uppercase">
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Função *</label>
              <select id="ocv-funcao" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="MOTORISTA">MOTORISTA</option>
                <option value="AJUDANTE">AJUDANTE</option>
                <option value="SEPARADOR">SEPARADOR</option>
                <option value="CONFERENTE">CONFERENTE</option>
                <option value="OUTRO">OUTRO</option>
              </select>
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Motivo Resumido *</label>
              <select id="ocv-motivo" required class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded p-1.5 text-xs">
                ${motivos.map(m => `<option value="${m}">${m}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="space-y-2 pt-1 border-t border-slate-800">
            <div>
              <label class="block text-[10px] text-amber-400 font-bold mb-1">Causa da Ocorrência * (Obrigatório)</label>
              <input type="text" id="ocv-causa" required placeholder="Ex: CONSULTA MEDICA, INCOMPATIBILIDADE DE KM..." class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-red-400 font-bold mb-1">Detalhamento da Ocorrência * (Obrigatório)</label>
              <textarea id="ocv-ocorrencia" required rows="2" placeholder="Ex: FALTA DO AJUDANTE NA ROTA / MOTORISTA NÃO REALIZOU O CHECKLIST..." class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs"></textarea>
            </div>
            <div>
              <label class="block text-[10px] text-emerald-400 font-bold mb-1">Ação Tomada * (Obrigatório)</label>
              <textarea id="ocv-acao" required rows="2" placeholder="Ex: JOSE PAIXAO SUBSTITUTO / FEITO PROCEDIMENTO PARA REGULARIZAR..." class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs"></textarea>
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" onclick="toggleFormNovaOcViagem()" class="bg-slate-800 text-slate-300 px-3 py-1.5 rounded text-xs font-bold">Cancelar</button>
            <button type="submit" class="bg-red-700 hover:bg-red-600 text-white px-5 py-1.5 rounded text-xs font-bold shadow">Salvar Ocorrência</button>
          </div>
        </form>
      </div>

      <!-- PAINEL 1: OCORRÊNCIAS PENDENTES -->
      <div class="bg-slate-900 border border-amber-800/80 rounded-xl overflow-hidden shadow-xl">
        <div class="p-3 bg-amber-950/40 border-b border-amber-800/60 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-base">⚠️</span>
            <h3 class="font-bold text-amber-300 text-xs uppercase tracking-wider">Ocorrências Operacionais Pendentes</h3>
          </div>
          <span class="bg-amber-500/20 text-amber-300 border border-amber-500/50 px-2.5 py-0.5 rounded-full text-xs font-black">${pendentes.length} pendente${pendentes.length!==1?'s':''}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-950 text-slate-300 text-[10px] uppercase border-b border-slate-800">
              <tr>
                <th class="p-2 border-r border-slate-800">Data</th>
                <th class="p-2 border-r border-slate-800">Carga</th>
                <th class="p-2 border-r border-slate-800">Rota</th>
                <th class="p-2 border-r border-slate-800">Placa</th>
                <th class="p-2 border-r border-slate-800">Funcionário</th>
                <th class="p-2 border-r border-slate-800">Função</th>
                <th class="p-2 border-r border-slate-800">Motivo</th>
                <th class="p-2 border-r border-slate-800 text-amber-400 font-bold">Causa</th>
                <th class="p-2 border-r border-slate-800 bg-red-900/60 text-white font-bold min-w-[180px]">Ocorrência</th>
                <th class="p-2 border-r border-slate-800 text-emerald-400 font-bold min-w-[180px]">Ação Tomada</th>
                <th class="p-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800 text-[11px]">
              ${pendentes.length === 0 ? '<tr><td colspan="11" class="p-6 text-center text-slate-500">✅ Nenhuma ocorrência pendente. Todos os registros estão finalizados!</td></tr>' :
              pendentes.map(o => buildTableRow(o)).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- PAINEL 2: OCORRÊNCIAS FINALIZADAS (COM FILTROS) -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div class="p-3 bg-slate-950 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-base">✅</span>
            <h3 class="font-bold text-emerald-400 text-xs uppercase tracking-wider">Ocorrências Operacionais Finalizadas</h3>
          </div>
          <span class="text-[10px] text-slate-400 font-semibold">${finalizadas.length} registro(s) encontrado(s)</span>
        </div>

        <!-- BARRA DE FILTROS DAS FINALIZADAS -->
        <div class="p-3 border-b border-slate-800 bg-slate-900/80 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <div>
            <label class="block text-[9px] text-slate-400 font-bold uppercase mb-0.5">Data De</label>
            <input type="date" value="${fDe}" onchange="window._ocFiltroDataDe=this.value; renderApp()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
          </div>
          <div>
            <label class="block text-[9px] text-slate-400 font-bold uppercase mb-0.5">Data Até</label>
            <input type="date" value="${fAte}" onchange="window._ocFiltroDataAte=this.value; renderApp()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
          </div>
          <div>
            <label class="block text-[9px] text-slate-400 font-bold uppercase mb-0.5">Carga</label>
            <input type="text" value="${fCarga}" placeholder="Ex: 43004" onchange="window._ocFiltroCarga=this.value; renderApp()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
          </div>
          <div>
            <label class="block text-[9px] text-slate-400 font-bold uppercase mb-0.5">Funcionário</label>
            <input type="text" value="${fFunc}" placeholder="Nome" onchange="window._ocFiltroFunc=this.value; renderApp()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
          </div>
          <div>
            <label class="block text-[9px] text-slate-400 font-bold uppercase mb-0.5">Veículo / Placa</label>
            <input type="text" value="${fPlaca}" placeholder="Placa" onchange="window._ocFiltroPlaca=this.value; renderApp()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
          </div>
          <div>
            <label class="block text-[9px] text-slate-400 font-bold uppercase mb-0.5">Rota</label>
            <input type="text" value="${fRota}" placeholder="Rota" onchange="window._ocFiltroRota=this.value; renderApp()" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
          </div>
          <div>
            <label class="block text-[9px] text-slate-400 font-bold uppercase mb-0.5">Motivo</label>
            <select onchange="window._ocFiltroMotivo=this.value; renderApp()" class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded p-1 text-xs">
              <option value="">Todos</option>
              ${motivos.map(m => `<option value="${m}" ${fMotivo===m?'selected':''}>${m}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-950 text-slate-300 text-[10px] uppercase border-b border-slate-800">
              <tr>
                <th class="p-2 border-r border-slate-800">Data</th>
                <th class="p-2 border-r border-slate-800">Carga</th>
                <th class="p-2 border-r border-slate-800">Rota</th>
                <th class="p-2 border-r border-slate-800">Placa</th>
                <th class="p-2 border-r border-slate-800">Funcionário</th>
                <th class="p-2 border-r border-slate-800">Função</th>
                <th class="p-2 border-r border-slate-800">Motivo</th>
                <th class="p-2 border-r border-slate-800 text-amber-400 font-bold">Causa</th>
                <th class="p-2 border-r border-slate-800 bg-red-900/60 text-white font-bold min-w-[180px]">Ocorrência</th>
                <th class="p-2 border-r border-slate-800 text-emerald-400 font-bold min-w-[180px]">Ação Tomada</th>
                <th class="p-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800 text-[11px]">
              ${finalizadas.length === 0 ? '<tr><td colspan="11" class="p-6 text-center text-slate-500">Nenhuma ocorrência finalizada no filtro informado.</td></tr>' :
              finalizadas.map(o => buildTableRow(o)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function toggleFormNovaOcViagem() {
  document.getElementById('form-nova-oc-viagem')?.classList.toggle('hidden');
}

function handleNovaOcViagemSubmit(e) {
  e.preventDefault();
  db.addOcorrenciaViagem({
    data: document.getElementById('ocv-data').value,
    carga: document.getElementById('ocv-carga').value,
    rota: document.getElementById('ocv-rota').value,
    placa: document.getElementById('ocv-placa').value,
    funcionario: document.getElementById('ocv-funcionario').value,
    funcao: document.getElementById('ocv-funcao').value,
    motivo: document.getElementById('ocv-motivo').value,
    causa: document.getElementById('ocv-causa').value,
    ocorrencia: document.getElementById('ocv-ocorrencia').value,
    acao: document.getElementById('ocv-acao').value,
    status: document.getElementById('ocv-acao').value ? 'FINALIZADA' : 'PENDENTE'
  });
  alert('✅ Ocorrência operacional registrada!');
  renderApp();
}

function editarOcViagemModal(id) {
  const o = db.getOcorrenciasViagens().find(x => x.id == id);
  if (!o) return;

  const motivos = db.data.motivos_ocorrencia || [];
  const veiculos = db.data.veiculos;

  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <h3 class="font-bold text-white text-sm">Editar Ocorrência Operacional — Carga ${o.carga}</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white text-sm">✕</button>
      </div>

      <form onsubmit="handleSalvarEdicaoOcViagem(event, '${o.id}')" class="space-y-3 text-xs">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Status do Registro</label>
            <select id="ed-ocv-status" class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded p-1.5">
              <option value="PENDENTE" ${o.status!=='FINALIZADA'?'selected':''}>⚠️ PENDENTE</option>
              <option value="FINALIZADA" ${o.status==='FINALIZADA'?'selected':''}>✅ FINALIZADA</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Data</label>
            <input type="date" id="ed-ocv-data" value="${o.data}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Nº Carga</label>
            <input type="text" id="ed-ocv-carga" value="${o.carga}" class="w-full bg-slate-800 border border-slate-700 text-emerald-400 font-bold rounded p-1.5">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Placa</label>
            <select id="ed-ocv-placa" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              ${veiculos.map(v => `<option value="${v.placa}" ${o.placa===v.placa?'selected':''}>${v.placa}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Funcionário Envolvido</label>
            <input type="text" id="ed-ocv-func" value="${o.funcionario}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 uppercase">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Função</label>
            <select id="ed-ocv-funcao" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              <option value="MOTORISTA" ${o.funcao==='MOTORISTA'?'selected':''}>MOTORISTA</option>
              <option value="AJUDANTE" ${o.funcao==='AJUDANTE'?'selected':''}>AJUDANTE</option>
              <option value="SEPARADOR" ${o.funcao==='SEPARADOR'?'selected':''}>SEPARADOR</option>
              <option value="CONFERENTE" ${o.funcao==='CONFERENTE'?'selected':''}>CONFERENTE</option>
              <option value="OUTRO" ${o.funcao==='OUTRO'?'selected':''}>OUTRO</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 mb-1">Motivo Resumido</label>
          <select id="ed-ocv-motivo" class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded p-1.5">
            ${motivos.map(m => `<option value="${m}" ${o.motivo===m?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block text-[10px] text-amber-400 font-bold mb-1">Causa da Ocorrência *</label>
          <input type="text" id="ed-ocv-causa" value="${o.causa}" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
        </div>

        <div>
          <label class="block text-[10px] text-red-400 font-bold mb-1">Detalhamento da Ocorrência *</label>
          <textarea id="ed-ocv-ocorrencia" required rows="2" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">${o.ocorrencia}</textarea>
        </div>

        <div>
          <label class="block text-[10px] text-emerald-400 font-bold mb-1">Ação Tomada *</label>
          <textarea id="ed-ocv-acao" required rows="2" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">${o.acao||''}</textarea>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="bg-slate-800 text-slate-300 font-bold px-3 py-1.5 rounded">Cancelar</button>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-1.5 rounded shadow">Salvar Ocorrência</button>
        </div>
      </form>
    </div>`;
  modalContainer.classList.remove('hidden');
}

function handleSalvarEdicaoOcViagem(e, id) {
  e.preventDefault();
  db.updateOcorrenciaViagem(id, {
    status: document.getElementById('ed-ocv-status').value,
    data: document.getElementById('ed-ocv-data').value,
    carga: document.getElementById('ed-ocv-carga').value,
    placa: document.getElementById('ed-ocv-placa').value,
    funcionario: document.getElementById('ed-ocv-func').value,
    funcao: document.getElementById('ed-ocv-funcao').value,
    motivo: document.getElementById('ed-ocv-motivo').value,
    causa: document.getElementById('ed-ocv-causa').value,
    ocorrencia: document.getElementById('ed-ocv-ocorrencia').value,
    acao: document.getElementById('ed-ocv-acao').value
  });
  closeModal();
  alert('✅ Ocorrência operacional atualizada!');
  renderApp();
}

function deleteOcViagem(id) {
  if (confirm('Excluir esta ocorrência operacional?')) {
    db.deleteOcorrenciaViagem(id);
    renderApp();
  }
}
// ===== UPLOADS DE MÍDIA EM OCORRÊNCIA EM ROTA =====
let uploadedRotaFotos = [];
let uploadedRotaVideos = [];

function handleRotaFotosUpload(input) {
  uploadedRotaFotos = [];
  const previewDiv = document.getElementById('rota-fotos-preview');
  if (previewDiv) previewDiv.innerHTML = '';
  if (input.files && input.files.length > 0) {
    Array.from(input.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = function(e) {
        uploadedRotaFotos.push(e.target.result);
        if (previewDiv) {
          previewDiv.innerHTML += `<img src="${e.target.result}" class="w-12 h-12 object-cover rounded border border-emerald-500 shadow">`;
        }
      };
      reader.readAsDataURL(file);
    });
  }
}

function handleRotaVideosUpload(input) {
  uploadedRotaVideos = [];
  const previewDiv = document.getElementById('rota-videos-preview');
  if (previewDiv) previewDiv.innerHTML = '';
  if (input.files && input.files.length > 0) {
    Array.from(input.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = function(e) {
        uploadedRotaVideos.push(e.target.result);
        if (previewDiv) {
          previewDiv.innerHTML += `<video src="${e.target.result}" class="w-16 h-12 object-cover rounded border border-blue-500 shadow"></video>`;
        }
      };
      reader.readAsDataURL(file);
    });
  }
}

function renderRotaOcorrenciasView() {
  const rotas = db.getOcorrenciasRota();
  const veiculos = db.data.veiculos.filter(v => v.situacao !== 'Inativo');
  const motoristas = db.data.motoristas;
  const rotasNomes = db.data.rotas || [];
  const motivosResumidos = db.data.motivos_ocorrencia || ["AVARIA MECÂNICA", "ATRASO DE LARGADA", "CHECKLIST", "FALTA", "SUBSTITUIÇÃO DE EQUIPE", "CONDUTA OPERACIONAL", "OUTRO"];
  const fMotivo = window._rotaFiltroMotivo || '';

  let rotasFiltradas = rotas;
  if (fMotivo) {
    rotasFiltradas = rotas.filter(r => (r.motivo_resumido || r.tipo_ocorrencia) === fMotivo);
  }

  return `
    <div class="space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-red-900/60 p-4 rounded-xl shadow-xl">
        <div>
          <h2 class="text-sm font-black text-red-400 uppercase tracking-wider">🚚 Ocorrências de Frota em Rota (Sinistros, Avarias & Socorro Mecânico)</h2>
          <p class="text-[11px] text-slate-400">Notificação exclusiva de problemas no veículo (sinistro/avaria/problema mecânico/socorro)</p>
        </div>
        <div class="flex gap-2 items-center">
          <div class="bg-slate-950 border border-slate-800 p-1 rounded-lg flex items-center gap-1.5">
            <span class="text-[10px] text-slate-400 font-bold px-2 uppercase">Filtrar por Motivo:</span>
            <select onchange="window._rotaFiltroMotivo=this.value; renderApp()" class="bg-slate-800 border border-slate-700 text-amber-300 font-bold text-xs rounded p-1">
              <option value="">Todos os Motivos</option>
              ${motivosResumidos.map(m => `<option value="${m}" ${fMotivo===m?'selected':''}>${m}</option>`).join('')}
            </select>
          </div>
          <button onclick="toggleNewRotaForm()" class="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-lg">+ Registrar Problema de Veículo</button>
        </div>
      </div>

      <!-- Formulário Nova Ocorrência em Rota (Com Uploads) -->
      <div id="form-nova-rota" class="hidden bg-slate-900 border border-red-900/60 rounded-xl p-5 space-y-4 shadow-2xl">
        <h3 class="text-sm font-bold text-red-400 uppercase">Abertura de Chamado em Rota (Frota & Manutenção)</h3>
        <form onsubmit="handleNovaRotaSubmit(event)" class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs text-slate-300 mb-1">Nº da Carga</label>
              <input type="number" id="rota-carga-numero" placeholder="Ex: 10450" class="w-full bg-slate-800 border border-slate-700 text-emerald-400 font-bold rounded p-2 text-xs">
            </div>
            <div>
              <label class="block text-xs text-slate-300 mb-1">Veículo / Placa *</label>
              <select id="rota-veiculo-id" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
                <option value="">-- Selecione --</option>
                ${veiculos.map(v => `<option value="${v.id}" data-placa="${v.placa}">${v.placa} — ${v.tipo||v.modelo}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-300 mb-1">Motorista *</label>
              <select id="rota-motorista-id" required class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
                <option value="">-- Selecione --</option>
                ${motoristas.map(m => `<option value="${m.id}">${m.nome}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs text-slate-300 mb-1">Rota</label>
              <select id="rota-nome" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
                <option value="">-- Selecione --</option>
                ${rotasNomes.map(r => `<option value="${r}">${r}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-300 mb-1">Motivo do Problema Mecânico *</label>
              <select id="rota-motivo-resumido" required class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded p-2 text-xs">
                ${motivosResumidos.map(m => `<option value="${m}">${m}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-300 mb-1">Status do Veículo *</label>
              <select id="rota-status-veiculo" required class="w-full bg-slate-800 border border-slate-700 text-amber-400 font-bold rounded p-2 text-xs">
                <option value="Aguardando Manutenção">🔴 Aguardando Manutenção</option>
                <option value="Manutenção Externa">🟠 Manutenção Externa</option>
                <option value="Manutenção Interna">🔧 Manutenção Interna</option>
                <option value="Em Rota">🟢 Em Rota (Liberado / Fechar)</option>
              </select>
            </div>
          </div>

          <!-- UPLOADS DE IMAGENS E VÍDEOS -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950 p-3 rounded-lg border border-slate-800">
            <div>
              <label class="block text-xs text-emerald-400 font-bold mb-1">📷 Fotos da Avaria / Veículo</label>
              <input type="file" id="rota-fotos-file" accept="image/*" multiple onchange="handleRotaFotosUpload(this)" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs file:mr-2 file:py-0.5 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-emerald-700 file:text-white">
              <div id="rota-fotos-preview" class="flex flex-wrap gap-1 mt-1"></div>
            </div>
            <div>
              <label class="block text-xs text-blue-400 font-bold mb-1">🎥 Vídeos do Problema Mecânico</label>
              <input type="file" id="rota-videos-file" accept="video/*" multiple onchange="handleRotaVideosUpload(this)" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs file:mr-2 file:py-0.5 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-blue-700 file:text-white">
              <div id="rota-videos-preview" class="flex flex-wrap gap-1 mt-1"></div>
            </div>
          </div>

          <div>
            <label class="block text-xs text-slate-300 mb-1">Descrição Detalhada do Defeito *</label>
            <textarea id="rota-descricao" required rows="2" placeholder="Descreva o problema mecânico ou avaria..." class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs"></textarea>
          </div>
          <div>
            <label class="block text-xs text-slate-300 mb-1">Transcrição Áudio WhatsApp (opcional)</label>
            <textarea id="rota-audio-wa" rows="2" placeholder="Cole a transcrição do relato do motorista..." class="w-full bg-slate-800 border border-slate-700 text-slate-300 rounded p-2 text-xs italic"></textarea>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" onclick="toggleNewRotaForm()" class="bg-slate-800 text-slate-300 px-3 py-1.5 rounded text-xs font-bold">Cancelar</button>
            <button type="submit" class="bg-red-600 hover:bg-red-500 text-white px-5 py-1.5 rounded text-xs font-bold shadow">Registrar Chamado</button>
          </div>
        </form>
      </div>

      <!-- Lista de Ocorrências -->
      <div class="space-y-4">
        ${rotasFiltradas.length === 0 ? `<div class="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500">Nenhuma ocorrência de frota em rota registrada.</div>` :
        rotasFiltradas.map(r => `
          <div class="bg-slate-900 border ${r.veiculo_parado ? 'border-red-600/80' : 'border-slate-800'} rounded-xl p-4 shadow-xl space-y-3">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-xs font-black text-red-400 uppercase">${r.numero_protocolo}</span>
                  <span class="bg-slate-800 text-amber-300 border border-amber-800/60 font-bold px-2 py-0.5 rounded text-[10px]">${r.motivo_resumido || r.tipo_ocorrencia || 'PROBLEMA MECÂNICO'}</span>
                </div>
                <div class="text-sm font-bold text-white mt-0.5">🚛 ${r.veiculo_placa} (${r.veiculo_modelo}) • ${r.motorista_nome}</div>
                <div class="text-[11px] text-slate-400">Carga: ${r.carga_numero} | Rota: ${r.carga_rota}</div>
              </div>
              <div>
                <span class="bg-slate-950 text-amber-300 border border-amber-800/80 font-bold px-3 py-1 rounded-full text-xs block text-center">
                  ${r.status_veiculo || (r.veiculo_parado ? '🔴 Aguardando Manutenção' : '🟢 Em Rota')}
                </span>
                ${r.status === 'RESOLVIDO' ? '<span class="text-[9px] text-emerald-400 font-semibold block text-center mt-0.5">✔ Concluído</span>' : ''}
              </div>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
              <div class="bg-slate-950 p-3 rounded border border-slate-800 space-y-2">
                <div class="font-bold text-slate-300">Relato do Problema:</div>
                <div class="text-slate-300">${r.descricao}</div>
                ${r.transcricao_audio_wa ? `
                  <div class="bg-emerald-950/40 border border-emerald-900/60 p-2 rounded text-[11px] text-emerald-200">
                    <b>🎙️ WhatsApp:</b><br><span class="italic">"${r.transcricao_audio_wa}"</span>
                  </div>` : ''}

                <!-- MÍDIAS ANEXADAS (FOTOS E VÍDEOS) -->
                ${Array.isArray(r.midia_fotos) && r.midia_fotos.length > 0 ? `
                  <div class="pt-2 border-t border-slate-800">
                    <div class="font-bold text-emerald-400 text-[10px] mb-1">📷 Fotos da Avaria:</div>
                    <div class="flex flex-wrap gap-1.5">
                      ${r.midia_fotos.map(img => `<img src="${img}" class="w-16 h-16 object-cover rounded border border-slate-700 cursor-pointer hover:opacity-80" onclick="window.open('${img}')">`).join('')}
                    </div>
                  </div>` : ''}

                ${Array.isArray(r.midia_videos) && r.midia_videos.length > 0 ? `
                  <div class="pt-2 border-t border-slate-800">
                    <div class="font-bold text-blue-400 text-[10px] mb-1">🎥 Vídeos do Chamado:</div>
                    <div class="space-y-1">
                      ${r.midia_videos.map(vid => `<video src="${vid}" controls class="w-full max-h-36 rounded border border-blue-600/80"></video>`).join('')}
                    </div>
                  </div>` : ''}
              </div>
              <form onsubmit="handleManutencaoSubmit(event, '${r.id}')" class="bg-slate-950 p-3 rounded border border-slate-800 space-y-2">
                <div class="font-bold text-red-400">Ação de Manutenção:</div>
                <div>
                  <label class="block text-[10px] text-slate-400">Detalhamento do Socorro</label>
                  <textarea id="man-acao-${r.id}" rows="2" required placeholder="Peças, mecânico..." class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs">${r.acao_mecanico||''}</textarea>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[10px] text-slate-400">Peças Trocadas</label>
                    <input type="text" id="man-pecas-${r.id}" value="${r.pecas_trocadas||''}" placeholder="Radiador..." class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs">
                  </div>
                  <div>
                    <label class="block text-[10px] text-slate-400">Custo (R$)</label>
                    <input type="number" step="0.01" id="man-custo-${r.id}" value="${r.custo_socorro||0}" class="w-full bg-slate-900 border border-slate-700 text-emerald-400 font-bold rounded p-1.5 text-xs">
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[10px] text-slate-400">Guincho</label>
                    <select id="man-guincho-${r.id}" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs">
                      <option value="nao" ${!r.guincho_acionado?'selected':''}>Não</option>
                      <option value="sim" ${r.guincho_acionado?'selected':''}>Sim</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-[10px] text-slate-400">Status do Veículo</label>
                    <select id="man-status-veiculo-${r.id}" class="w-full bg-slate-900 border border-slate-700 text-amber-300 font-bold rounded p-1.5 text-xs">
                      <option value="Aguardando Manutenção" ${r.status_veiculo==='Aguardando Manutenção'?'selected':''}>🔴 Aguardando Manutenção</option>
                      <option value="Manutenção Externa" ${r.status_veiculo==='Manutenção Externa'?'selected':''}>🟠 Manutenção Externa</option>
                      <option value="Manutenção Interna" ${r.status_veiculo==='Manutenção Interna'?'selected':''}>🔧 Manutenção Interna</option>
                      <option value="Em Rota" ${r.status_veiculo==='Em Rota'||r.status==='RESOLVIDO'?'selected':''}>🟢 Em Rota (Liberado & Concluir)</option>
                    </select>
                  </div>
                </div>
                <button type="submit" class="w-full bg-red-700 hover:bg-red-600 text-white font-bold py-1.5 rounded text-xs">Atualizar Manutenção</button>
              </form>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ===== SUB-ABA: TROCA DE VEÍCULOS =====
function renderViagensTrocaVeiculosSubTab() {
  const trocas = db.getTrocasVeiculos();
  const veiculos = db.data.veiculos || [];
  const autorizadores = [
    "LUIZ EDUARDO",
    "WELINTON",
    "VICTOR HUGO",
    "NÃO AUTORIZADO",
    "GUSTAVO CARDOSO",
    "MELQUIADES NETO",
    "MARCOS ADRIANO",
    "PAULO SILVA",
    "ROBSON PINHEIRO"
  ];
  const motivos = [
    "PESO EXCEDIDO",
    "VEÍCULO EM ROTA",
    "MANUTENÇÃO INTERNA",
    "MANUTENÇÃO EXTERNA",
    "VEÍCULO CARREGADO",
    "CONDUTA INADEQUADA",
    "OUTROS (OPÇÃO DE INCLUIR)"
  ];

  const fMotivo = window._trocaFiltroMotivo || '';
  const fAutorizado = window._trocaFiltroAutorizado || '';

  let trocasFiltradas = trocas;
  if (fMotivo) trocasFiltradas = trocasFiltradas.filter(t => t.motivo_resumido === fMotivo);
  if (fAutorizado) trocasFiltradas = trocasFiltradas.filter(t => t.autorizado_por === fAutorizado);

  return `
    <div class="space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-purple-900/60 p-4 rounded-xl shadow-xl">
        <div>
          <h2 class="text-sm font-black text-purple-400 uppercase tracking-wider">🔄 Controle & Registro de Troca de Veículos</h2>
          <p class="text-[11px] text-slate-400">Substituição de veículos escalados com validação de frota e responsável pela autorização</p>
        </div>
        <button onclick="toggleFormNovaTrocaVeiculo()" class="bg-purple-700 hover:bg-purple-600 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-lg">+ Nova Troca de Veículo</button>
      </div>

      <!-- FORMULÁRIO NOVA TROCA DE VEÍCULO -->
      <div id="form-nova-troca-veiculo" class="hidden bg-slate-900 border border-purple-900/60 rounded-xl p-4 shadow-xl space-y-3">
        <h3 class="font-bold text-purple-400 text-xs uppercase">Lançamento de Troca de Veículo na Escala</h3>
        <form onsubmit="handleNovaTrocaVeiculoSubmit(event)" class="space-y-3 text-xs">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Data da Troca *</label>
              <input type="date" id="tr-data" required value="${new Date().toISOString().split('T')[0]}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Veículo Escalado (Placa) *</label>
              <select id="tr-veiculo-escalado" required class="w-full bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded p-1.5">
                <option value="">-- Selecione Veículo Escalado --</option>
                ${veiculos.map(v => `<option value="${v.placa}">${v.placa} — ${v.tipo||v.modelo} (${v.situacao})</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Veículo Trocado (Substituto) *</label>
              <select id="tr-veiculo-trocado" required class="w-full bg-slate-800 border border-slate-700 text-emerald-400 font-bold rounded p-1.5">
                <option value="">-- Selecione Veículo Trocado --</option>
                ${veiculos.map(v => `<option value="${v.placa}">${v.placa} — ${v.tipo||v.modelo} (${v.situacao})</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Motivo Resumido *</label>
              <select id="tr-motivo-resumido" required onchange="toggleMotivoOutroTroca(this.value)" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
                ${motivos.map(m => `<option value="${m}">${m}</option>`).join('')}
              </select>
              <input type="text" id="tr-motivo-outro" placeholder="Especifique o outro motivo..." class="hidden mt-1 w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
            </div>

            <div>
              <label class="block text-[10px] text-slate-300 mb-1">Autorizado Por *</label>
              <select id="tr-autorizado-por" required class="w-full bg-slate-800 border border-slate-700 text-purple-300 font-bold rounded p-1.5">
                ${autorizadores.map(a => `<option value="${a}">${a}</option>`).join('')}
              </select>
            </div>
          </div>

          <div>
            <label class="block text-[10px] text-slate-300 mb-1">Detalhamento *</label>
            <textarea id="tr-detalhamento" required rows="2" placeholder="Descreva os detalhes da substituição..." class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5"></textarea>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" onclick="toggleFormNovaTrocaVeiculo()" class="bg-slate-800 text-slate-300 font-bold px-3 py-1.5 rounded">Cancelar</button>
            <button type="submit" class="bg-purple-700 hover:bg-purple-600 text-white font-bold px-5 py-1.5 rounded shadow">+ Registrar Troca</button>
          </div>
        </form>
      </div>

      <!-- TABELA DE TROCAS DE VEÍCULOS -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div class="p-3 bg-slate-950 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-base">🔄</span>
            <h3 class="font-bold text-purple-400 text-xs uppercase tracking-wider">Histórico de Trocas de Veículos</h3>
          </div>
          <div class="flex items-center gap-2">
            <select onchange="window._trocaFiltroMotivo=this.value; renderApp()" class="bg-slate-800 border border-slate-700 text-white rounded text-xs p-1">
              <option value="">Todos os Motivos</option>
              ${motivos.map(m => `<option value="${m}" ${fMotivo===m?'selected':''}>${m}</option>`).join('')}
            </select>
            <select onchange="window._trocaFiltroAutorizado=this.value; renderApp()" class="bg-slate-800 border border-slate-700 text-purple-300 rounded text-xs p-1 font-bold">
              <option value="">Todos Autorizadores</option>
              ${autorizadores.map(a => `<option value="${a}" ${fAutorizado===a?'selected':''}>${a}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-950 text-slate-300 text-[10px] uppercase border-b border-slate-800">
              <tr>
                <th class="p-2 border-r border-slate-800">Data</th>
                <th class="p-2 border-r border-slate-800">Veículo Escalado</th>
                <th class="p-2 border-r border-slate-800">Veículo Trocado</th>
                <th class="p-2 border-r border-slate-800">Motivo Resumido</th>
                <th class="p-2 border-r border-slate-800 min-w-[200px]">Detalhamento</th>
                <th class="p-2 border-r border-slate-800">Autorizado Por</th>
                <th class="p-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800 text-[11px]">
              ${trocasFiltradas.length === 0 ? '<tr><td colspan="7" class="p-6 text-center text-slate-500">Nenhuma troca de veículo registrada.</td></tr>' :
              trocasFiltradas.map(t => `
                <tr class="hover:bg-slate-800/50">
                  <td class="p-2 border-r border-slate-800 font-medium text-slate-300">${t.data}</td>
                  <td class="p-2 border-r border-slate-800 font-bold text-amber-400">🚛 ${t.veiculo_escalado}</td>
                  <td class="p-2 border-r border-slate-800 font-bold text-emerald-400">🚛 ${t.veiculo_trocado}</td>
                  <td class="p-2 border-r border-slate-800">
                    <span class="bg-slate-800 text-purple-300 border border-purple-800 font-bold px-1.5 py-0.5 rounded text-[10px]">
                      ${t.motivo_resumido === 'OUTROS (OPÇÃO DE INCLUIR)' && t.motivo_outro ? t.motivo_outro : t.motivo_resumido}
                    </span>
                  </td>
                  <td class="p-2 border-r border-slate-800 text-slate-300">${t.detalhamento}</td>
                  <td class="p-2 border-r border-slate-800 font-bold ${t.autorizado_por==='NÃO AUTORIZADO'?'text-red-400':'text-white'}">${t.autorizado_por}</td>
                  <td class="p-2 text-right whitespace-nowrap">
                    <button onclick="editarTrocaVeiculoModal('${t.id}')" class="text-blue-400 hover:text-blue-300 p-1 font-bold text-sm" title="Editar">✏️</button>
                    <button onclick="deleteTrocaVeiculo('${t.id}')" class="text-red-400 hover:text-red-300 p-1 font-bold text-sm" title="Excluir">🗑️</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function toggleFormNovaTrocaVeiculo() {
  document.getElementById('form-nova-troca-veiculo')?.classList.toggle('hidden');
}

function toggleMotivoOutroTroca(val) {
  document.getElementById('tr-motivo-outro')?.classList.toggle('hidden', val !== 'OUTROS (OPÇÃO DE INCLUIR)');
}

function handleNovaTrocaVeiculoSubmit(e) {
  e.preventDefault();
  db.addTrocaVeiculo({
    data: document.getElementById('tr-data').value,
    veiculo_escalado: document.getElementById('tr-veiculo-escalado').value,
    veiculo_trocado: document.getElementById('tr-veiculo-trocado').value,
    motivo_resumido: document.getElementById('tr-motivo-resumido').value,
    motivo_outro: document.getElementById('tr-motivo-outro')?.value || '',
    detalhamento: document.getElementById('tr-detalhamento').value,
    autorizado_por: document.getElementById('tr-autorizado-por').value
  });
  alert('✅ Troca de veículo registrada com sucesso!');
  renderApp();
}

function deleteTrocaVeiculo(id) {
  if (confirm('Excluir este registro de troca de veículo?')) {
    db.deleteTrocaVeiculo(id);
    renderApp();
  }
}

function editarTrocaVeiculoModal(id) {
  const t = db.getTrocasVeiculos().find(x => x.id == id);
  if (!t) return;
  const veiculos = db.data.veiculos || [];
  const autorizadores = ["LUIZ EDUARDO","WELINTON","VICTOR HUGO","NÃO AUTORIZADO","GUSTAVO CARDOSO","MELQUIADES NETO","MARCOS ADRIANO","PAULO SILVA","ROBSON PINHEIRO"];
  const motivos = ["PESO EXCEDIDO","VEÍCULO EM ROTA","MANUTENÇÃO INTERNA","MANUTENÇÃO EXTERNA","VEÍCULO CARREGADO","CONDUTA INADEQUADA","OUTROS (OPÇÃO DE INCLUIR)"];

  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <h3 class="font-bold text-white text-sm">Editar Troca de Veículo</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white text-sm">✕</button>
      </div>
      <form onsubmit="handleSalvarEdicaoTrocaVeiculo(event, '${t.id}')" class="space-y-3 text-xs">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Data</label>
            <input type="date" id="ed-tr-data" value="${t.data}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-1">Autorizado Por</label>
            <select id="ed-tr-autorizado" class="w-full bg-slate-800 border border-slate-700 text-purple-300 font-bold rounded p-1.5">
              ${autorizadores.map(a => `<option value="${a}" ${t.autorizado_por===a?'selected':''}>${a}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-amber-400 font-bold mb-1">Veículo Escalado</label>
            <select id="ed-tr-escalado" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              ${veiculos.map(v => `<option value="${v.placa}" ${t.veiculo_escalado===v.placa?'selected':''}>${v.placa}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-emerald-400 font-bold mb-1">Veículo Trocado</label>
            <select id="ed-tr-trocado" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
              ${veiculos.map(v => `<option value="${v.placa}" ${t.veiculo_trocado===v.placa?'selected':''}>${v.placa}</option>`).join('')}
            </select>
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 mb-1">Motivo Resumido</label>
          <select id="ed-tr-motivo" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">
            ${motivos.map(m => `<option value="${m}" ${t.motivo_resumido===m?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 mb-1">Detalhamento</label>
          <textarea id="ed-tr-detalhe" rows="2" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5">${t.detalhamento}</textarea>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="bg-slate-800 text-slate-300 font-bold px-3 py-1.5 rounded">Cancelar</button>
          <button type="submit" class="bg-purple-700 hover:bg-purple-600 text-white font-bold px-5 py-1.5 rounded shadow">Salvar Troca</button>
        </div>
      </form>
    </div>`;
  modalContainer.classList.remove('hidden');
}

function handleSalvarEdicaoTrocaVeiculo(e, id) {
  e.preventDefault();
  db.updateTrocaVeiculo(id, {
    data: document.getElementById('ed-tr-data').value,
    autorizado_por: document.getElementById('ed-tr-autorizado').value,
    veiculo_escalado: document.getElementById('ed-tr-escalado').value,
    veiculo_trocado: document.getElementById('ed-tr-trocado').value,
    motivo_resumido: document.getElementById('ed-tr-motivo').value,
    detalhamento: document.getElementById('ed-tr-detalhe').value
  });
  closeModal();
  alert('✅ Registro de troca atualizado!');
  renderApp();
}

// ===== GERADOR DO RELATÓRIO DE LARGADA DA OPERAÇÃO (COM LOGO CORPORATIVA) =====
function gerarRelatorioLargadaOperacaoModal() {
  const viagens = db.getControleViagens();
  const fDataDe = window._vgFiltroDataDe || '';
  const fDataAte = window._vgFiltroDataAte || '';

  let filtradas = viagens;
  if (fDataDe)  filtradas = filtradas.filter(v => (v.data_saida||'') >= fDataDe);
  if (fDataAte) filtradas = filtradas.filter(v => (v.data_saida||'') <= fDataAte);

  const totViagens = filtradas.length;
  const totFusionOk = filtradas.filter(v => v.fusion === 'INICIADO').length;
  const totChkOk = filtradas.filter(v => v.checklist_saida === 'INICIADO').length;
  const totObs = filtradas.filter(v => v.observacao && v.observacao.trim() !== '').length;

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>RELATÓRIO DE LARGADA DA OPERAÇÃO — JR DISTRIBUIDORA</title>
  <style>
    @media print {
      @page { margin: 10mm; size: A4 landscape; }
      body { -webkit-print-color-adjust: exact; }
    }
    body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; background: #fff; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #047857; padding-bottom: 10px; margin-bottom: 15px; }
    .logo { height: 60px; }
    .title-area { text-align: right; }
    .title-area h1 { margin: 0; font-size: 20px; color: #064e3b; text-transform: uppercase; }
    .title-area p { margin: 2px 0 0; font-size: 11px; color: #64748b; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; }
    .kpi-box { border: 1px solid #cbd5e1; background: #f8fafc; padding: 10px; border-radius: 6px; text-align: center; }
    .kpi-num { font-size: 20px; font-weight: 900; color: #047857; }
    .kpi-label { font-size: 10px; font-weight: bold; color: #475569; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #064e3b; color: #fff; text-transform: uppercase; font-size: 9px; }
    tr:nth-child(even) { background: #f8fafc; }
    .badge-ok { background: #dcfce7; color: #14532d; font-weight: bold; padding: 2px 4px; border-radius: 3px; }
    .badge-nok { background: #fee2e2; color: #7f1d1d; font-weight: bold; padding: 2px 4px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="header">
    <img src="./public/logo.png" class="logo" alt="JR Logo">
    <div class="title-area">
      <h1>Relatório da Largada da Operação</h1>
      <p>JR Distribuidora • Emissão: ${new Date().toLocaleString('pt-BR')}</p>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-box"><div class="kpi-num">${totViagens}</div><div class="kpi-label">Viagens na Escala</div></div>
    <div class="kpi-box"><div class="kpi-num" style="color: #047857;">${totFusionOk}</div><div class="kpi-label">Fusion Iniciado</div></div>
    <div class="kpi-box"><div class="kpi-num" style="color: #1d4ed8;">${totChkOk}</div><div class="kpi-label">Checklist Saída OK</div></div>
    <div class="kpi-box"><div class="kpi-num" style="color: #b45309;">${totObs}</div><div class="kpi-label">Ocorrências Largada</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Carga</th>
        <th>Rota</th>
        <th>Placa</th>
        <th>Motorista</th>
        <th>Ajudante</th>
        <th>Setor</th>
        <th>Saída (Data / Hora)</th>
        <th>Status</th>
        <th>Fusion</th>
        <th>Checklist</th>
        <th>Observação Largada</th>
      </tr>
    </thead>
    <tbody>
      ${filtradas.length === 0 ? '<tr><td colspan="11" style="text-align:center;">Nenhuma viagem encontrada.</td></tr>' :
      filtradas.map(v => `
        <tr>
          <td><b>${v.carga}</b></td>
          <td>${v.rota}</td>
          <td><b>${v.placa}</b></td>
          <td>${v.motorista}</td>
          <td>${v.ajudante}</td>
          <td>${v.setor||'FRIO'}</td>
          <td>${v.data_saida||'—'} ${v.hora_saida||'—'}</td>
          <td>${v.status_viagem}</td>
          <td><span class="${v.fusion==='INICIADO'?'badge-ok':'badge-nok'}">${v.fusion}</span></td>
          <td><span class="${v.checklist_saida==='INICIADO'?'badge-ok':'badge-nok'}">${v.checklist_saida}</span></td>
          <td>${v.observacao||'—'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <script>
    window.onload = function() { setTimeout(function(){ window.print(); }, 500); }
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=1000,height=800');
  if (win) {
    win.document.write(htmlContent);
    win.document.close();
  } else {
    alert('Permita pop-ups no navegador para visualizar o Relatório de Largada.');
  }
}

function toggleNewRotaForm() {
  document.getElementById('form-nova-rota')?.classList.toggle('hidden');
}
function handleNovaRotaSubmit(e) {
  e.preventDefault();
  const veicSel = document.getElementById('rota-veiculo-id');
  const veicOpt = veicSel.options[veicSel.selectedIndex];
  const statusVeic = document.getElementById('rota-status-veiculo').value;
  const motivoResumido = document.getElementById('rota-motivo-resumido').value;
  db.addOcorrenciaRota({
    carga_numero: document.getElementById('rota-carga-numero').value,
    veiculo_id: veicSel.value,
    veiculo_placa: veicOpt?.getAttribute('data-placa') || '',
    motorista_id: document.getElementById('rota-motorista-id').value,
    rota_nome: document.getElementById('rota-nome').value,
    tipo_ocorrencia: motivoResumido,
    motivo_resumido: motivoResumido,
    status_veiculo: statusVeic,
    descricao: document.getElementById('rota-descricao').value,
    transcricao_audio_wa: document.getElementById('rota-audio-wa').value,
  });
  alert('✅ Ocorrência em rota registrada!');
  renderApp();
}
function handleManutencaoSubmit(e, id) {
  e.preventDefault();
  const statusVeic = document.getElementById(`man-status-veiculo-${id}`).value;
  db.updateOcorrenciaRota(id, {
    status_veiculo: statusVeic,
    acao_mecanico: document.getElementById(`man-acao-${id}`).value,
    pecas_trocadas: document.getElementById(`man-pecas-${id}`).value,
    custo_socorro: document.getElementById(`man-custo-${id}`).value,
    guincho_acionado: document.getElementById(`man-guincho-${id}`).value,
  });
  alert('✅ Status da frota/manutenção atualizado!');
  renderApp();
}

// ===== MÓDULO 5: CADASTROS =====
function renderCadastrosDadosView() {
  return `
    <div class="space-y-5">
      <div>
        <h1 class="text-xl font-black text-white">Gerenciador de Cadastros & Dados SAC</h1>
        <p class="text-xs text-slate-400">Atualize as tabelas de apoio (Motoristas, Ajudantes, Produtos, Veículos e Rotas)</p>
      </div>
      <!-- SUB-TABS rolável horizontal no mobile -->
      <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        ${[['motoristas','👤 Motoristas'],['ajudantes','🙋 Ajudantes'],['separadores','📝 Separad./Confer.'],['produtos','📦 Produtos'],['veiculos','🚛 Veículos'],['rotas','📍 Rotas'],['cargas','🗂️ Cargas']].map(([k,l]) => `
          <button onclick="switchCadSubTab('${k}')" class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 ${activeCadSubTab===k?'bg-emerald-700 text-white':'bg-slate-800 text-slate-300'}">${l}</button>`).join('')}
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">${renderCadSubTabContent()}</div>
    </div>`;
}

function switchCadSubTab(tab) { activeCadSubTab = tab; renderApp(); }

function handleCadSeparadorSubmit(e) {
  e.preventDefault();
  const nome = document.getElementById('cad-sep-nome').value.toUpperCase().trim();
  if (!nome) return;
  if (!db.data.separadores_conferentes) db.data.separadores_conferentes = [];
  if (db.data.separadores_conferentes.includes(nome)) {
    alert('⚠️ Este nome já está cadastrado!');
    return;
  }
  db.data.separadores_conferentes.push(nome);
  db.save();
  document.getElementById('cad-sep-nome').value = '';
  alert(`✅ "${nome}" cadastrado com sucesso!`);
  renderApp();
}

function deleteSeparador(nome) {
  if (!confirm(`Excluir "${nome}" da lista de Separadores/Conferentes?`)) return;
  db.data.separadores_conferentes = (db.data.separadores_conferentes || []).filter(n => n !== nome);
  db.save();
  renderApp();
}


function renderCadSubTabContent() {
  if (activeCadSubTab === 'separadores') {
    const lista = db.data.separadores_conferentes || [];
    const busca = (window._sepBusca || '').toLowerCase();
    const filtrados = busca ? lista.filter(n => n.toLowerCase().includes(busca)) : lista;
    return `
      <div class="space-y-5">
        <!-- Formulário de cadastro -->
        <form onsubmit="handleCadSeparadorSubmit(event)" class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
          <h3 class="font-bold text-emerald-400 text-xs uppercase">📝 Novo Separador / Conferente</h3>
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="block text-[10px] text-slate-400 mb-1">Nome Completo *</label>
              <input type="text" id="cad-sep-nome" required placeholder="Ex: JOAO DA SILVA" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs uppercase">
            </div>
            <div class="flex items-end">
              <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs">+ Cadastrar</button>
            </div>
          </div>
        </form>

        <!-- Busca + contador -->
        <div class="flex gap-2 items-center">
          <input type="text" id="sep-busca" value="${window._sepBusca||''}" placeholder="Buscar por nome..."
            oninput="window._sepBusca=this.value; renderApp()"
            class="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs">
          <span class="text-[10px] text-slate-400 whitespace-nowrap">${filtrados.length} de ${lista.length}</span>
          ${busca ? `<button onclick="window._sepBusca=''; renderApp()" class="text-[10px] text-red-400 hover:text-red-300 font-bold px-2 py-1 bg-slate-800 rounded">Limpar</button>` : ''}
        </div>

        <!-- Lista -->
        <div class="overflow-y-auto max-h-96 rounded-xl border border-slate-800">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] sticky top-0">
              <tr>
                <th class="p-2">#</th>
                <th class="p-2">Nome</th>
                <th class="p-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800">
              ${filtrados.length === 0
                ? `<tr><td colspan="3" class="p-4 text-center text-slate-500">Nenhum resultado encontrado.</td></tr>`
                : filtrados.map((nome, idx) => `
                  <tr class="hover:bg-slate-800/40">
                    <td class="p-2 text-slate-500 text-[10px]">${lista.indexOf(nome)+1}</td>
                    <td class="p-2 font-semibold text-white">${nome}</td>
                    <td class="p-2 text-right">
                      <button onclick="deleteSeparador(decodeURIComponent('${encodeURIComponent(nome)}'))" class="text-red-400 hover:text-red-300 text-[10px] font-bold">Excluir</button>
                    </td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  if (activeCadSubTab === 'motoristas') {
    return `
      <div class="space-y-5">
        <form onsubmit="handleCadMotoristaSubmit(event)" class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
          <h3 class="font-bold text-emerald-400 text-xs uppercase">Novo Motorista</h3>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><label class="block text-[10px] text-slate-400">Cód. ERP</label><input type="number" id="cad-mot-erp" placeholder="Ex: 520" class="w-full bg-slate-900 border border-slate-700 text-emerald-400 font-bold rounded p-1.5 text-xs"></div>
            <div class="col-span-2"><label class="block text-[10px] text-slate-400">Nome Completo *</label><input type="text" id="cad-mot-nome" required placeholder="CARLOS ALBERTO SILVA" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs"></div>
            <div><label class="block text-[10px] text-slate-400">CNH</label><input type="text" id="cad-mot-cnh" placeholder="00000000000" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs"></div>
          </div>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs">+ Cadastrar</button>
        </form>
        <div class="overflow-x-auto max-h-80 overflow-y-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] sticky top-0"><tr><th class="p-2">ERP</th><th class="p-2">Nome</th><th class="p-2 hidden sm:table-cell">CNH</th><th class="p-2 text-right">Ação</th></tr></thead>
            <tbody class="divide-y divide-slate-800">
              ${db.data.motoristas.map(m=>`<tr class="hover:bg-slate-800/40"><td class="p-2 font-bold text-emerald-400">${m.id}</td><td class="p-2 font-semibold text-white">${m.nome}</td><td class="p-2 text-slate-400 hidden sm:table-cell">${m.cnh||'—'}</td><td class="p-2 text-right"><button onclick="deleteCad('motoristas','${m.id}')" class="text-red-400 hover:text-red-300 text-[10px]">Excluir</button></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }
  if (activeCadSubTab === 'ajudantes') {
    return `
      <div class="space-y-5">
        <form onsubmit="handleCadAjudanteSubmit(event)" class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
          <h3 class="font-bold text-emerald-400 text-xs uppercase">Novo Ajudante</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div><label class="block text-[10px] text-slate-400">Cód. ERP</label><input type="number" id="cad-aju-erp" placeholder="530" class="w-full bg-slate-900 border border-slate-700 text-emerald-400 font-bold rounded p-1.5 text-xs"></div>
            <div class="col-span-2"><label class="block text-[10px] text-slate-400">Nome *</label><input type="text" id="cad-aju-nome" required placeholder="GABRIEL SANTOS" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs"></div>
          </div>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs">+ Cadastrar</button>
        </form>
        <div class="overflow-x-auto max-h-80 overflow-y-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] sticky top-0"><tr><th class="p-2">ERP</th><th class="p-2">Nome</th><th class="p-2 text-right">Ação</th></tr></thead>
            <tbody class="divide-y divide-slate-800">
              ${db.data.ajudantes.map(a=>`<tr class="hover:bg-slate-800/40"><td class="p-2 font-bold text-emerald-400">${a.id}</td><td class="p-2 font-semibold text-white">${a.nome}</td><td class="p-2 text-right"><button onclick="deleteCad('ajudantes','${a.id}')" class="text-red-400 hover:text-red-300 text-[10px]">Excluir</button></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }
  if (activeCadSubTab === 'produtos') {
    return `
      <div class="space-y-5">
        <form onsubmit="handleCadProdutoSubmit(event)" class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
          <h3 class="font-bold text-emerald-400 text-xs uppercase">Novo Produto</h3>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><label class="block text-[10px] text-slate-400">Código *</label><input type="text" id="cad-prod-cod" required placeholder="5600" class="w-full bg-slate-900 border border-slate-700 text-emerald-400 font-bold rounded p-1.5 text-xs"></div>
            <div class="col-span-2"><label class="block text-[10px] text-slate-400">Descrição *</label><input type="text" id="cad-prod-desc" required placeholder="FILE DE PEITO BANDEJA FRIATO" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs"></div>
            <div><label class="block text-[10px] text-slate-400">Categoria</label><input type="text" id="cad-prod-cat" placeholder="Frios/Carnes" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs"></div>
          </div>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs">+ Cadastrar</button>
        </form>
        <div class="overflow-x-auto max-h-80 overflow-y-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] sticky top-0"><tr><th class="p-2">Código</th><th class="p-2">Descrição</th><th class="p-2 hidden sm:table-cell">Categoria</th><th class="p-2 text-right">Ação</th></tr></thead>
            <tbody class="divide-y divide-slate-800">
              ${db.data.produtos.map(p=>`<tr class="hover:bg-slate-800/40"><td class="p-2 font-bold text-emerald-400">${p.codigo_produto}</td><td class="p-2 text-white text-[11px]">${p.descricao}</td><td class="p-2 text-slate-400 hidden sm:table-cell text-[10px]">${p.categoria||'—'}</td><td class="p-2 text-right"><button onclick="deleteCad('produtos','${p.id}')" class="text-red-400 hover:text-red-300 text-[10px]">Excluir</button></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }
  if (activeCadSubTab === 'veiculos') {
    return `
      <div class="space-y-5">
        <form onsubmit="handleCadVeiculoSubmit(event)" class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
          <h3 class="font-bold text-emerald-400 text-xs uppercase">Novo Veículo</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div><label class="block text-[10px] text-slate-400">Placa *</label><input type="text" id="cad-veic-placa" required placeholder="TVA8I25" class="w-full bg-slate-900 border border-slate-700 text-emerald-400 font-bold rounded p-1.5 text-xs"></div>
            <div><label class="block text-[10px] text-slate-400">Grupo *</label>
              <select id="cad-veic-tipo" required class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs">
                ${['TOCO','TRUCK','CARRETA','3/4','VUC','CAVALO','UTILITARIO','PASSEIO'].map(t=>`<option value="${t}">${t}</option>`).join('')}
              </select>
            </div>
            <div><label class="block text-[10px] text-slate-400">Situação</label>
              <select id="cad-veic-situacao" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="Ativo">Ativo</option><option value="Inativo">Inativo</option>
              </select>
            </div>
          </div>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs">+ Cadastrar</button>
        </form>
        <div class="overflow-x-auto max-h-80 overflow-y-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] sticky top-0"><tr><th class="p-2">Placa</th><th class="p-2">Grupo</th><th class="p-2">Situação</th><th class="p-2 text-right">Ação</th></tr></thead>
            <tbody class="divide-y divide-slate-800">
              ${db.data.veiculos.map(v=>`<tr class="hover:bg-slate-800/40"><td class="p-2 font-bold text-emerald-400">${v.placa}</td><td class="p-2 text-white">${v.tipo||v.modelo}</td><td class="p-2"><span class="${v.situacao==='Ativo'?'text-emerald-400':'text-slate-500'}">${v.situacao||'Ativo'}</span></td><td class="p-2 text-right"><button onclick="deleteCad('veiculos','${v.id}')" class="text-red-400 hover:text-red-300 text-[10px]">Excluir</button></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }
  if (activeCadSubTab === 'rotas') {
    const rotas = db.data.rotas || [];
    return `
      <div class="space-y-5">
        <form onsubmit="handleCadRotaSubmit(event)" class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
          <h3 class="font-bold text-emerald-400 text-xs uppercase">Nova Rota</h3>
          <div><label class="block text-[10px] text-slate-400">Nome da Rota *</label><input type="text" id="cad-rota-nome" required placeholder="Ex: ARAGUAINA SECO III" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs"></div>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs">+ Cadastrar Rota</button>
        </form>
        <div>
          <h4 class="font-bold text-white text-xs mb-3">Rotas Cadastradas (${rotas.length})</h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-80 overflow-y-auto text-xs">
            ${rotas.map(r=>`<div class="bg-slate-950 p-2.5 rounded border border-slate-800 flex justify-between items-center"><span class="font-semibold text-white text-[11px]">${r}</span><button onclick="deleteRota('${r}')" class="text-red-400 text-[10px] ml-2 shrink-0">Excluir</button></div>`).join('')}
          </div>
        </div>
      </div>`;
  }
  if (activeCadSubTab === 'cargas') {
    const rotas = db.data.rotas || [];
    return `
      <div class="space-y-5">
        <form onsubmit="handleCadCargaSubmit(event)" class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
          <h3 class="font-bold text-emerald-400 text-xs uppercase">Nova Carga & Rota</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div><label class="block text-[10px] text-slate-400">Nº Carga *</label><input type="number" id="cad-car-num" required placeholder="10453" class="w-full bg-slate-900 border border-slate-700 text-emerald-400 font-bold rounded p-1.5 text-xs"></div>
            <div><label class="block text-[10px] text-slate-400">Rota *</label>
              <select id="cad-car-rota" required class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">-- Selecione --</option>
                ${rotas.map(r=>`<option value="${r}">${r}</option>`).join('')}
              </select>
            </div>
            <div><label class="block text-[10px] text-slate-400">Motorista *</label>
              <select id="cad-car-mot" required class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">--</option>
                ${db.data.motoristas.map(m=>`<option value="${m.id}">${m.nome}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-[10px] text-slate-400">Ajudante</label>
              <select id="cad-car-aju" class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">--</option>
                ${db.data.ajudantes.map(a=>`<option value="${a.id}">${a.nome}</option>`).join('')}
              </select>
            </div>
            <div><label class="block text-[10px] text-slate-400">Veículo *</label>
              <select id="cad-car-veic" required class="w-full bg-slate-900 border border-slate-700 text-white rounded p-1.5 text-xs">
                <option value="">--</option>
                ${db.data.veiculos.filter(v=>v.situacao!=='Inativo').map(v=>`<option value="${v.id}">${v.placa} — ${v.tipo||v.modelo}</option>`).join('')}
              </select>
            </div>
          </div>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs">+ Cadastrar Carga</button>
        </form>
        <div class="overflow-x-auto max-h-80 overflow-y-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] sticky top-0"><tr><th class="p-2">Nº Carga</th><th class="p-2">Rota</th><th class="p-2 hidden sm:table-cell">Motorista</th><th class="p-2 text-right">Ação</th></tr></thead>
            <tbody class="divide-y divide-slate-800">
              ${db.data.cargas.map(c=>{const m=db.data.motoristas.find(x=>x.id==c.motorista_id)||{};return`<tr class="hover:bg-slate-800/40"><td class="p-2 font-bold text-emerald-400">${c.numero_carga}</td><td class="p-2 text-white text-[11px]">${c.rota_nome||c.rota||'N/A'}</td><td class="p-2 text-slate-300 text-[11px] hidden sm:table-cell">${m.nome||'N/A'}</td><td class="p-2 text-right"><button onclick="deleteCad('cargas','${c.id}')" class="text-red-400 text-[10px]">Excluir</button></td></tr>`;}).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }
  return '<div class="text-slate-500 text-sm">Selecione uma categoria.</div>';
}

// ---- Handlers Cadastros ----
function handleCadMotoristaSubmit(e) { e.preventDefault(); const r=db.addMotorista(document.getElementById('cad-mot-erp').value,document.getElementById('cad-mot-nome').value,document.getElementById('cad-mot-cnh').value,''); if(r) alert('✅ Motorista cadastrado!'); renderApp(); }
function handleCadAjudanteSubmit(e) { e.preventDefault(); db.addAjudante(document.getElementById('cad-aju-erp').value,document.getElementById('cad-aju-nome').value); alert('✅ Ajudante cadastrado!'); renderApp(); }
function handleCadProdutoSubmit(e) { e.preventDefault(); db.addProduto(document.getElementById('cad-prod-cod').value,document.getElementById('cad-prod-desc').value,document.getElementById('cad-prod-cat').value,0); alert('✅ Produto cadastrado!'); renderApp(); }
function handleCadVeiculoSubmit(e) { e.preventDefault(); db.addVeiculo(document.getElementById('cad-veic-placa').value,document.getElementById('cad-veic-tipo').value,document.getElementById('cad-veic-situacao').value); alert('✅ Veículo cadastrado!'); renderApp(); }
function handleCadRotaSubmit(e) { e.preventDefault(); const r=db.addRota(document.getElementById('cad-rota-nome').value); if(r) alert('✅ Rota cadastrada!'); renderApp(); }
function handleCadCargaSubmit(e) { e.preventDefault(); db.addCargaRota(document.getElementById('cad-car-num').value,document.getElementById('cad-car-rota').value,document.getElementById('cad-car-mot').value,document.getElementById('cad-car-aju').value,document.getElementById('cad-car-veic').value); alert('✅ Carga cadastrada!'); renderApp(); }
function deleteCad(col, id) { if(confirm('Excluir este item?')){ db.deleteCadItem(col,id); renderApp(); } }
function deleteRota(nome) { if(confirm(`Excluir rota "${nome}"?`)){ db.deleteRota(nome); renderApp(); } }

// ===== MÓDULO: CONECTOR DE DADOS (ANALISTA & POWER BI) =====
function renderConectorDadosView() {
  return `
    <div class="space-y-6 max-w-7xl mx-auto pb-12">
      <!-- CABEÇALHO CONECTOR DE DADOS -->
      <div class="bg-slate-900 border border-blue-900/60 p-5 rounded-2xl shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="p-3 bg-blue-950/80 border border-blue-800/80 rounded-xl text-2xl text-blue-400">🔌</div>
          <div>
            <h1 class="text-xl font-black text-white uppercase tracking-wider flex items-center gap-2">
              Central de Ingestão de Dados & Conector Power BI
            </h1>
            <p class="text-xs text-slate-400">Área do Analista de Dados: Extração JSON / SQL e Conexão Multidepartamental na Nuvem</p>
          </div>
        </div>
      </div>

      <!-- SEÇÃO EXPORTADOR POWER BI & NUVEM -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
        <h2 class="text-sm font-bold text-white uppercase flex items-center gap-2 border-b border-slate-800 pb-3">
          <span>⚡</span> Ferramentas de Extração e Integração
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          <div class="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-3 shadow-inner">
            <h3 class="font-bold text-emerald-400 text-sm flex items-center gap-2">
              <span>💾</span> 1. Exportação Instantânea em JSON
            </h3>
            <p class="text-slate-400 text-xs leading-relaxed">Baixe a base de dados completa em formato JSON para ingestão direta via Obter Dados -> JSON no Power BI Desktop.</p>
            <button onclick="const b=new Blob([JSON.stringify(db.data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='jr_sac_database.json';a.click()" class="bg-emerald-700 hover:bg-emerald-600 text-white font-bold px-4 py-2.5 rounded-lg text-xs shadow flex items-center gap-2">
              💾 Baixar Base JSON
            </button>
          </div>

          <div class="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-3 shadow-inner">
            <h3 class="font-bold text-blue-400 text-sm flex items-center gap-2">
              <span>📥</span> 2. Conexão e Exportação SQL (PostgreSQL / Supabase)
            </h3>
            <p class="text-slate-400 text-xs leading-relaxed">Gerador de Script SQL (.sql) com todas as tabelas e dados para carga direta no PostgreSQL ou Power BI DirectQuery.</p>
            <div class="flex flex-wrap gap-2">
              <button onclick="const sql=db.exportToSQL();const b=new Blob([sql],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='jr_oper_dump.sql';a.click()" class="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2.5 rounded-lg text-xs shadow flex items-center gap-1.5">
                📥 Baixar Base SQL (.sql)
              </button>
              <button onclick="alert('Script SQL de schema relacional 3FN e Views disponível na pasta database/schema.sql!')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-2.5 rounded-lg text-xs">
                📄 Ver Schema SQL
              </button>
            </div>
          </div>
        </div>

        <!-- PAINEL DE STATUS NUVEM / MULTIDEPARTAMENTAL -->
        <div class="bg-slate-950 p-5 rounded-xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4 text-xs shadow-inner">
          <div>
            <div class="font-bold text-amber-400 text-sm flex items-center gap-2">
              <span>☁️</span> Status da Conexão Multidepartamental na Nuvem
            </div>
            <p class="text-slate-400 text-xs mt-1">Modo Atual: <b id="lbl-cloud-status" class="text-emerald-400">Local (Navegador)</b>. Operação offline e zero custos de hospedagem ativos.</p>
          </div>
          <button onclick="alert('Para conectar ao Supabase (gratuito):\n1. Abra o arquivo js/config.js\n2. Cole sua URL e chave anon fornecida no painel do Supabase!')" class="bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-xs shrink-0 shadow">
            ⚙️ Configurar Nuvem
          </button>
        </div>
      </div>
    </div>`;
}

function renderPowerBiView() {
  return renderConectorDadosView();
}

function imprimirBoletimOperacional() {
  const fDe  = window._biFiltroDe  || '';
  const fAte = window._biFiltroAte || '';

  const allDevs = db.getDevolucoes();
  const allRotas = db.getOcorrenciasRota();
  const allRelatorios = db.data.relatorios_divergencia || [];
  const allViagens = db.getControleViagens();
  const allOcViagens = db.getOcorrenciasViagens();

  const devs = allDevs.filter(d => {
    const data = d.criado_em ? d.criado_em.split('T')[0] : '';
    if (fDe && data < fDe) return false;
    if (fAte && data > fAte) return false;
    return true;
  });

  const rotas = allRotas.filter(r => {
    const data = r.criado_em ? r.criado_em.split('T')[0] : '';
    if (fDe && data < fDe) return false;
    if (fAte && data > fAte) return false;
    return true;
  });

  const relatorios = allRelatorios.filter(rel => {
    const data = rel.gerado_em ? rel.gerado_em.split('T')[0] : '';
    if (fDe && data < fDe) return false;
    if (fAte && data > fAte) return false;
    return true;
  });

  const viagens = allViagens.filter(v => {
    const data = v.data_saida || '';
    if (fDe && data < fDe) return false;
    if (fAte && data > fAte) return false;
    return true;
  });

  const ocViagens = allOcViagens.filter(o => {
    const data = o.data || '';
    if (fDe && data < fDe) return false;
    if (fAte && data > fAte) return false;
    return true;
  });

  const totalDevValor = devs.reduce((acc, d) => acc + (parseFloat(d.valor_reclamado)||0), 0);
  const totalPendCd = devs.filter(d => d.status_fechamento === 'PENDENTE_FISICO').length;

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>BOLETIM OPERACIONAL — JR DISTRIBUIDORA</title>
  <style>
    @media print { @page { margin: 10mm; size: A4 portrait; } }
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #0f172a; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 15px; }
    .logo { height: 50px; }
    .title { text-align: right; }
    .title h2 { margin: 0; font-size: 18px; }
    .title p { margin: 2px 0 0; font-size: 10px; color: #64748b; }
    .doc-banner { background: #0f172a; color: white; padding: 8px; text-align: center; font-weight: bold; font-size: 14px; margin-bottom: 15px; border-radius: 4px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 20px; }
    .kpi-box { border: 1px solid #cbd5e1; padding: 8px; text-align: center; border-radius: 4px; background: #f8fafc; }
    .kpi-num { font-size: 16px; font-weight: bold; color: #0f172a; margin-top: 2px; }
    .kpi-label { font-size: 9px; font-weight: bold; color: #64748b; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; font-size: 10px; }
    th { background: #f1f5f9; font-weight: bold; text-transform: uppercase; }
    .section-title { font-size: 12px; font-weight: bold; margin-bottom: 6px; text-transform: uppercase; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  </style>
</head>
<body>
  <div class="header">
    <img src="./public/logo.png" class="logo" alt="JR Logo">
    <div class="title">
      <h2>JR DISTRIBUIDORA</h2>
      <p>Boletim Operacional de Viagens, Rota, CD & SAC</p>
    </div>
  </div>

  <div class="doc-banner">BOLETIM OPERACIONAL GERENCIAL ${fDe || fAte ? `(${fDe || 'Início'} até ${fAte || 'Hoje'})` : '(Período Completo)'}</div>

  <div class="kpi-grid">
    <div class="kpi-box"><div class="kpi-label">Viagens Escala</div><div class="kpi-num">${viagens.length}</div></div>
    <div class="kpi-box"><div class="kpi-label">Devoluções</div><div class="kpi-num">${devs.length}</div></div>
    <div class="kpi-box"><div class="kpi-label">Valor Reclamado</div><div class="kpi-num">R$ ${totalDevValor.toFixed(2)}</div></div>
    <div class="kpi-box"><div class="kpi-label">Ocorrências Rota</div><div class="kpi-num">${rotas.length}</div></div>
    <div class="kpi-box"><div class="kpi-label">Ocorrências CCO</div><div class="kpi-num">${ocViagens.length}</div></div>
  </div>

  <div class="section-title">1. Acompanhamento de Largadas & Controle de Viagens (${viagens.length})</div>
  <table>
    <thead><tr><th>Carga</th><th>Rota</th><th>Placa</th><th>Motorista</th><th>Ajudante</th><th>Status</th><th>Fusion</th><th>Checklist Saída</th></tr></thead>
    <tbody>
      ${viagens.length===0?'<tr><td colspan="8" style="text-align:center;">Nenhuma viagem registrada no período</td></tr>':viagens.map(v=>`
        <tr>
          <td><b>${v.carga}</b></td>
          <td>${v.rota}</td>
          <td>${v.placa}</td>
          <td>${v.motorista}</td>
          <td>${v.ajudante}</td>
          <td><b>${v.status_viagem}</b></td>
          <td>${v.fusion}</td>
          <td>${v.checklist_saida}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="section-title">2. Ocorrências Operacionais de Viagem CCO (${ocViagens.length})</div>
  <table>
    <thead><tr><th>Data</th><th>Carga</th><th>Rota / Placa</th><th>Funcionário (Função)</th><th>Motivo</th><th>Ocorrência & Ação</th></tr></thead>
    <tbody>
      ${ocViagens.length===0?'<tr><td colspan="6" style="text-align:center;">Nenhuma ocorrência operacional registrada</td></tr>':ocViagens.map(o=>`
        <tr>
          <td>${o.data}</td>
          <td><b>${o.carga}</b></td>
          <td>${o.rota} (${o.placa})</td>
          <td>${o.funcionario} (${o.funcao})</td>
          <td><b>${o.motivo}</b></td>
          <td><b>Causa:</b> ${o.causa}<br><b>Ocorrência:</b> ${o.ocorrencia}<br><b>Ação:</b> ${o.acao}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="section-title">3. Resumo Ocorrências de Devolução (${devs.length})</div>
  <table>
    <thead><tr><th>Protocolo</th><th>Cliente</th><th>Motorista</th><th>Rota</th><th>Motivo Reclamado</th><th>Valor</th></tr></thead>
    <tbody>
      ${devs.length===0?'<tr><td colspan="6" style="text-align:center;">Nenhum registro</td></tr>':devs.map(d=>`
        <tr>
          <td><b>${d.numero_devolucao||d.numero_protocolo}</b></td>
          <td>${d.cliente_nome}</td>
          <td>${d.motorista_nome}</td>
          <td>${d.carga_rota}</td>
          <td>${d.motivo_reclamado}</td>
          <td>R$ ${(parseFloat(d.valor_reclamado)||0).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="section-title">4. Ocorrências em Rota & Frota (${rotas.length})</div>
  <table>
    <thead><tr><th>Protocolo</th><th>Veículo / Placa</th><th>Motorista</th><th>Tipo Ocorrência</th><th>Status Veículo</th></tr></thead>
    <tbody>
      ${rotas.length===0?'<tr><td colspan="5" style="text-align:center;">Nenhum registro</td></tr>':rotas.map(r=>`
        <tr>
          <td><b>${r.numero_protocolo}</b></td>
          <td>${r.veiculo_placa}</td>
          <td>${r.motorista_nome}</td>
          <td>${r.tipo_ocorrencia}</td>
          <td>${r.status_veiculo||'Aguardando Manutenção'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <script>
    window.onload = function() { setTimeout(function(){ window.print(); }, 500); }
  </script>
</body>
</html>`;

  const win = window.open('','_blank','width=900,height=800');
  if (win) {
    win.document.write(htmlContent);
    win.document.close();
  }
}

function downloadSqlScript() { window.open('./database/schema.sql','_blank'); }
function copyJsonData() { navigator.clipboard.writeText(JSON.stringify(db.data,null,2)).then(()=>alert('✅ JSON copiado!')); }
function downloadJsonData() { const b=new Blob([JSON.stringify(db.data,null,2)],{type:'application/json'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download='jr_oper_export.json'; a.click(); URL.revokeObjectURL(u); }

// ===== MÓDULO: RESUMO DIÁRIO CD & GESTÃO DE OCORRÊNCIAS =====
function getTodasOcorrenciasCD() {
  const list = [];
  if (!db.data || !db.data.resumo_diario_cd) return list;

  db.data.resumo_diario_cd.forEach(r => {
    // 1. Ocorrências Gerais (Item 3)
    if (Array.isArray(r.ocorrencias)) {
      r.ocorrencias.forEach((o, idx) => {
        list.push({
          _parentData: r.data,
          _parentTurno: r.turno,
          _type: 'operacional',
          _index: idx,
          id: o.id || `op_${r.data}_${r.turno}_${idx}`,
          data: r.data,
          turno: r.turno,
          gestor: r.gestor || '',
          titulo: o.ocorrencia || 'OCORRÊNCIA OPERACIONAL',
          colaborador: o.funcionario || 'OPERAÇÃO CD',
          causa: o.causa || '',
          acao: o.acao || '',
          status: o.status || 'PENDENTE'
        });
      });
    }
    // 2. Ocorrências Colaboradores (Item 5)
    if (Array.isArray(r.ocorrencias_colaboradores)) {
      r.ocorrencias_colaboradores.forEach((oc, idx) => {
        list.push({
          _parentData: r.data,
          _parentTurno: r.turno,
          _type: 'colaborador',
          _index: idx,
          id: oc.id || `col_${r.data}_${r.turno}_${idx}`,
          data: oc.data || r.data,
          turno: r.turno,
          gestor: r.gestor || '',
          titulo: oc.requisito || 'APONTAMENTO COLABORADOR',
          colaborador: oc.funcionario || '-',
          causa: oc.detalhamento || '',
          acao: oc.acao || '',
          peso: oc.peso || '',
          carga: oc.carga || '',
          status: oc.status || 'PENDENTE'
        });
      });
    }
  });

  return list;
}

function alterarStatusOcorrenciaCD(parentData, parentTurno, type, index, novoStatus) {
  const resumo = db.getResumoDiarioCD(parentData, parentTurno);
  if (type === 'operacional' && resumo.ocorrencias?.[index]) {
    resumo.ocorrencias[index].status = novoStatus;
  } else if (type === 'colaborador' && resumo.ocorrencias_colaboradores?.[index]) {
    resumo.ocorrencias_colaboradores[index].status = novoStatus;
  }
  db.saveResumoDiarioCD(resumo);
  renderApp();
}

function removerOcorrenciaCDSubaba(parentData, parentTurno, type, index) {
  if (!confirm('Excluir esta ocorrência do CD?')) return;
  const resumo = db.getResumoDiarioCD(parentData, parentTurno);
  if (type === 'operacional' && resumo.ocorrencias) {
    resumo.ocorrencias.splice(index, 1);
  } else if (type === 'colaborador' && resumo.ocorrencias_colaboradores) {
    resumo.ocorrencias_colaboradores.splice(index, 1);
  }
  db.saveResumoDiarioCD(resumo);
  renderApp();
}

function editarOcorrenciaCDSubaba(parentData, parentTurno, type, index) {
  const container = document.getElementById('modal-container');
  if (!container) return;

  const resumo = db.getResumoDiarioCD(parentData, parentTurno);
  let item = null;
  if (type === 'colaborador') item = resumo.ocorrencias_colaboradores?.[index];
  else if (type === 'operacional') item = resumo.ocorrencias?.[index];
  if (!item) return;

  const colabs = getListaTodosColaboradores();
  const funcAtual = item.funcionario || item.colaborador || '';
  const reqAtual = item.requisito || item.ocorrencia || 'OUTRO';

  container.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full shadow-2xl text-white space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-amber-400 uppercase flex items-center gap-2">
          <span>✏️</span> Editar Ocorrência do CD
        </h3>
        <button onclick="fecharModalResumo()" class="text-slate-400 hover:text-white font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Data</label>
            <input type="date" id="md-edit-data" value="${item.data || parentData}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Turno / Setor</label>
            <input type="text" readonly value="${parentTurno}" class="w-full bg-slate-800/60 border border-slate-700 text-slate-400 rounded p-2 text-xs font-bold">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Status *</label>
            <select id="md-edit-status" class="w-full bg-slate-800 border border-slate-700 text-amber-300 rounded p-2 text-xs font-extrabold">
              <option value="PENDENTE" ${item.status==='PENDENTE'?'selected':''}>PENDENTE</option>
              <option value="FECHADO" ${item.status==='FECHADO'?'selected':''}>FECHADO</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Funcionário / Envolvido *</label>
            <select id="md-edit-colab" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
              <option value="">-- Selecione o Colaborador --</option>
              ${colabs.map(c => `<option value="${c}" ${c === funcAtual ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Requisito / Falha *</label>
            <input type="text" id="md-edit-req" value="${reqAtual}" class="w-full bg-slate-800 border border-slate-700 text-amber-300 rounded p-2 text-xs font-bold uppercase">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Nº da Carga (Se houver)</label>
            <input type="text" id="md-edit-carga" value="${item.carga || ''}" placeholder="ex: 7689" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Peso em Kg (Se houver)</label>
            <input type="number" step="0.01" id="md-edit-peso" value="${item.peso || ''}" placeholder="ex: 15.50" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Detalhamento da Ocorrência</label>
          <textarea id="md-edit-causa" rows="3" class="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded p-2 text-xs">${item.detalhamento || item.causa || ''}</textarea>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Ação Corretiva Tomada</label>
          <textarea id="md-edit-acao" rows="2" class="w-full bg-slate-800 border border-slate-700 text-emerald-300 rounded p-2 text-xs">${item.acao || ''}</textarea>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="fecharModalResumo()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded text-xs">Cancelar</button>
        <button onclick="confirmarEditarOcorrenciaCD('${parentData}', '${parentTurno}', '${type}', ${index})" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs shadow">Salvar Alterações</button>
      </div>
    </div>`;
  container.classList.remove('hidden');
}

function confirmarEditarOcorrenciaCD(parentData, parentTurno, type, index) {
  const resumo = db.getResumoDiarioCD(parentData, parentTurno);
  let item = null;
  if (type === 'colaborador') item = resumo.ocorrencias_colaboradores?.[index];
  else if (type === 'operacional') item = resumo.ocorrencias?.[index];
  if (!item) return;

  item.data = document.getElementById('md-edit-data')?.value || item.data;
  item.status = document.getElementById('md-edit-status')?.value || item.status;
  item.funcionario = (document.getElementById('md-edit-colab')?.value || item.funcionario || '').toUpperCase().trim();
  const reqVal = (document.getElementById('md-edit-req')?.value || '').toUpperCase().trim();
  if (type === 'colaborador') item.requisito = reqVal;
  else item.ocorrencia = reqVal;

  item.carga = (document.getElementById('md-edit-carga')?.value || '').trim();
  item.peso = (document.getElementById('md-edit-peso')?.value || '').trim();
  const causaVal = (document.getElementById('md-edit-causa')?.value || '').trim();
  if (type === 'colaborador') item.detalhamento = causaVal;
  else item.causa = causaVal;
  item.acao = (document.getElementById('md-edit-acao')?.value || '').trim();

  db.saveResumoDiarioCD(resumo);
  fecharModalResumo();
  renderApp();
}

function abrirModalNovaOcorrenciaCD(defaultData, defaultTurno) {
  const container = document.getElementById('modal-container');
  if (!container) return;
  const colabs = getListaTodosColaboradores();

  container.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full shadow-2xl text-white space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-emerald-400 uppercase flex items-center gap-2">
          <span>📢</span> Registrar Ocorrência do CD (Item 5)
        </h3>
        <button onclick="fecharModalResumo()" class="text-slate-400 hover:text-white font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Data *</label>
            <input type="date" id="md-oc2-data" value="${defaultData || new Date().toISOString().split('T')[0]}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Turno / Setor *</label>
            <select id="md-oc2-turno" class="w-full bg-slate-800 border border-slate-700 text-amber-300 rounded p-2 text-xs font-bold">
              <option value="SECO" ${defaultTurno==='SECO'?'selected':''}>SECO</option>
              <option value="1º TURNO - FRIO" ${defaultTurno==='1º TURNO - FRIO'?'selected':''}>1º TURNO - FRIO</option>
              <option value="2º TURNO - FRIO" ${defaultTurno==='2º TURNO - FRIO'?'selected':''}>2º TURNO - FRIO</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Status Inicial *</label>
            <select id="md-oc2-status" class="w-full bg-slate-800 border border-slate-700 text-emerald-400 rounded p-2 text-xs font-extrabold">
              <option value="PENDENTE" selected>PENDENTE</option>
              <option value="FECHADO">FECHADO</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Funcionário / Envolvido *</label>
            <select id="md-oc2-colab" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
              <option value="">-- Selecione o Colaborador --</option>
              ${colabs.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Requisito / Falha *</label>
            <select id="md-oc2-titulo" class="w-full bg-slate-800 border border-slate-700 text-amber-300 rounded p-2 text-xs font-bold">
              <option value="ERRO DE RECEBIMENTO">ERRO DE RECEBIMENTO</option>
              <option value="ERRO DE SEPARAÇÃO">ERRO DE SEPARAÇÃO</option>
              <option value="ERRO DE CONFERÊNCIA">ERRO DE CONFERÊNCIA</option>
              <option value="FALTA DE ATENÇÃO">FALTA DE ATENÇÃO</option>
              <option value="DESVIO DE CONDUTA">DESVIO DE CONDUTA</option>
              <option value="AVARIA NO MANUSEIO">AVARIA NO MANUSEIO</option>
              <option value="OUTRO">OUTRO</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Nº da Carga (Se houver)</label>
            <input type="text" id="md-oc2-carga" placeholder="ex: 7689" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Peso em Kg (Se houver)</label>
            <input type="number" step="0.01" id="md-oc2-peso" placeholder="ex: 15.50" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Detalhamento da Ocorrência</label>
          <textarea id="md-oc2-causa" rows="3" placeholder="Descreva os detalhes da ocorrência..." class="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded p-2 text-xs"></textarea>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Ação Corretiva Tomada</label>
          <textarea id="md-oc2-acao" rows="2" placeholder="Descreva a ação de orientação, instrução ou advertência realizada..." class="w-full bg-slate-800 border border-slate-700 text-emerald-300 rounded p-2 text-xs"></textarea>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="fecharModalResumo()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded text-xs">Cancelar</button>
        <button onclick="confirmarSalvarNovaOcorrenciaCD()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs shadow">Salvar Ocorrência</button>
      </div>
    </div>`;
  container.classList.remove('hidden');
}

function confirmarSalvarNovaOcorrenciaCD() {
  const dt = document.getElementById('md-oc2-data')?.value;
  const turno = document.getElementById('md-oc2-turno')?.value;
  const status = document.getElementById('md-oc2-status')?.value || 'PENDENTE';
  const colab = document.getElementById('md-oc2-colab')?.value || 'OPERAÇÃO CD';
  const titulo = document.getElementById('md-oc2-titulo')?.value || 'OUTRO';

  if (!dt || !turno) { alert('Preencha a data e turno!'); return; }

  const carga = document.getElementById('md-oc2-carga')?.value || '';
  const peso = document.getElementById('md-oc2-peso')?.value || '';
  const causa = document.getElementById('md-oc2-causa')?.value || '';
  const acao = document.getElementById('md-oc2-acao')?.value || '';

  const resumo = db.getResumoDiarioCD(dt, turno);
  if (!resumo.ocorrencias_colaboradores) resumo.ocorrencias_colaboradores = [];
  resumo.ocorrencias_colaboradores.push({
    id: Date.now(),
    data: dt,
    funcionario: colab.toUpperCase().trim(),
    requisito: titulo.toUpperCase().trim(),
    carga: carga.trim(),
    detalhamento: causa.trim(),
    acao: acao.trim(),
    peso: peso ? String(peso).trim() : '',
    status: status
  });

  db.saveResumoDiarioCD(resumo);
  fecharModalResumo();
  renderApp();
}

function exportarOcorrenciasExcel() {
  const todas = getTodasOcorrenciasCD();
  const busca = (window._ocFiltroBusca || '').toLowerCase().trim();
  const fData = window._ocFiltroData || '';
  const fTurno = window._ocFiltroTurno || 'TODOS';

  const fechadas = todas.filter(o => o.status === 'FECHADO').filter(o => {
    if (fData && o.data !== fData) return false;
    if (fTurno !== 'TODOS' && o.turno !== fTurno) return false;
    if (busca) {
      const txt = `${o.data} ${o.turno} ${o.titulo} ${o.colaborador} ${o.causa} ${o.acao}`.toLowerCase();
      if (!txt.includes(busca)) return false;
    }
    return true;
  });

  if (fechadas.length === 0) {
    alert('Nenhuma ocorrência fechada encontrada para exportar com os filtros atuais.');
    return;
  }

  const exportData = fechadas.map(o => ({
    'Data': o.data,
    'Turno / Setor': o.turno,
    'Título / Requisito': o.titulo,
    'Colaborador / Operação': o.colaborador,
    'Causa / Detalhamento': o.causa,
    'Ação Tomada / Solução': o.acao,
    'Status': o.status
  }));

  if (typeof XLSX !== 'undefined') {
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ocorrências Fechadas");
    XLSX.writeFile(wb, `ocorrencias_fechadas_cd_${new Date().toISOString().split('T')[0]}.xlsx`);
  } else {
    let csv = 'Data;Turno;Titulo;Colaborador;Causa;Acao;Status\n';
    exportData.forEach(row => {
      csv += `"${row['Data']}";"${row['Turno / Setor']}";"${row['Título / Requisito']}";"${row['Colaborador / Operação']}";"${row['Causa / Detalhamento']}";"${row['Ação Tomada / Solução']}";"${row['Status']}"\n`;
    });
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ocorrencias_fechadas_cd_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  }
}

function gerarRelatorioOcorrenciasPdf() {
  const todas = getTodasOcorrenciasCD();
  const busca = (window._ocFiltroBusca || '').toLowerCase().trim();
  const fData = window._ocFiltroData || '';
  const fTurno = window._ocFiltroTurno || 'TODOS';

  const fechadas = todas.filter(o => o.status === 'FECHADO').filter(o => {
    if (fData && o.data !== fData) return false;
    if (fTurno !== 'TODOS' && o.turno !== fTurno) return false;
    if (busca) {
      const txt = `${o.data} ${o.turno} ${o.titulo} ${o.colaborador} ${o.causa} ${o.acao}`.toLowerCase();
      if (!txt.includes(busca)) return false;
    }
    return true;
  });

  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>RELATÓRIO DE OCORRÊNCIAS FECHADAS DO CD</title>
  <style>
    @media print {
      @page { margin: 10mm; size: A4 landscape; }
      body { -webkit-print-color-adjust: exact; }
    }
    body { font-family: Arial, sans-serif; margin: 0; padding: 15px; color: #0f172a; background: #fff; font-size: 11px; }
    .banner { background: #047857; color: white; text-align: center; padding: 10px; font-size: 16px; font-weight: bold; text-transform: uppercase; border-radius: 4px; margin-bottom: 12px; }
    .meta-bar { display: flex; justify-content: space-between; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 12px; font-weight: bold; margin-bottom: 15px; border-radius: 4px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
    th, td { border: 1px solid #94a3b8; padding: 6px 8px; text-align: left; font-size: 10px; }
    th { background-color: #064e3b; color: white; text-transform: uppercase; font-size: 9px; }
    tr:nth-child(even) { background-color: #f8fafc; }
    .badge-closed { background-color: #dcfce7; color: #15803d; border: 1px solid #86efac; font-weight: bold; padding: 2px 6px; border-radius: 3px; font-size: 9px; }
  </style>
</head>
<body>
  <div class="banner">JR DISTRIBUIDORA — RELATÓRIO DE OCORRÊNCIAS FECHADAS DO CD</div>
  
  <div class="meta-bar">
    <div>EMISSÃO: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</div>
    <div>FILTRO TURNO: ${fTurno}</div>
    <div>FILTRO DATA: ${fData || 'TODAS'}</div>
    <div>TOTAL REGISTROS FECHADOS: ${fechadas.length}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:75px;">Data</th>
        <th style="width:110px;">Turno / Setor</th>
        <th style="width:140px;">Título / Requisito</th>
        <th style="width:140px;">Colaborador</th>
        <th>Causa / Detalhamento</th>
        <th>Ação Tomada / Solução</th>
        <th style="width:65px; text-align:center;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${fechadas.length === 0 ? '<tr><td colspan="7" style="text-align:center; padding:20px; color:#64748b;">Nenhuma ocorrência fechada encontrada para os filtros selecionados.</td></tr>' :
      fechadas.map(o => `
        <tr>
          <td><b>${o.data}</b></td>
          <td>${o.turno}</td>
          <td><b>${o.titulo}</b></td>
          <td>${o.colaborador}</td>
          <td>${o.causa}</td>
          <td style="color:#047857; font-weight:500;">${o.acao}</td>
          <td style="text-align:center;"><span class="badge-closed">FECHADO</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <script>
    window.onload = function() { setTimeout(function(){ window.print(); }, 500); }
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=950,height=800');
  if (win) {
    win.document.write(htmlContent);
    win.document.close();
  }
}

function renderResumoDiarioCdView() {
  const fData = window._resumoFiltroData || new Date().toISOString().split('T')[0];
  const fTurno = window._resumoFiltroTurno || '2º TURNO - FRIO';

  const resumo = db.getResumoDiarioCD(fData, fTurno);

  let gestorNome = resumo.gestor;
  if (fTurno === 'SECO') gestorNome = 'MARCOS ADRIANO';
  else if (fTurno === '1º TURNO - FRIO') gestorNome = 'MELQUIADES NETO';
  else if (fTurno === '2º TURNO - FRIO') gestorNome = 'GUSTAVO CAMARA';

  const rec = resumo.movimentacao?.recebimento || { peso: 0, aux_junior: 0, movimentador: 0, conferente: 0, empilhador: 0, cargas_previstas: 0, cargas_realizadas: 0, cargas_veiculos: 0 };
  const exp = resumo.movimentacao?.expedicao || { peso: 0, aux_junior: 0, movimentador: 0, conferente: 0, empilhador: 0, cargas_previstas: 0, cargas_realizadas: 0, cargas_veiculos: 0 };

  const recQtdFunc = (parseInt(rec.aux_junior)||0) + (parseInt(rec.movimentador)||0) + (parseInt(rec.conferente)||0) + (parseInt(rec.empilhador)||0);
  const expQtdFunc = (parseInt(exp.aux_junior)||0) + (parseInt(exp.movimentador)||0) + (parseInt(exp.conferente)||0) + (parseInt(exp.empilhador)||0);

  const recTonH = recQtdFunc > 0 ? (parseFloat(rec.peso)||0) / recQtdFunc : 0;
  const expTonH = expQtdFunc > 0 ? (parseFloat(exp.peso)||0) / expQtdFunc : 0;

  const totPeso = (parseFloat(rec.peso)||0) + (parseFloat(exp.peso)||0);
  const totAux = Math.max(parseInt(rec.aux_junior)||0, parseInt(exp.aux_junior)||0);
  const totMov = Math.max(parseInt(rec.movimentador)||0, parseInt(exp.movimentador)||0);
  const totConf = Math.max(parseInt(rec.conferente)||0, parseInt(exp.conferente)||0);
  const totEmp = Math.max(parseInt(rec.empilhador)||0, parseInt(exp.empilhador)||0);
  const totFunc = totAux + totMov + totConf + totEmp;
  const totTonH = totFunc > 0 ? totPeso / totFunc : 0;

  const totPrev = (parseInt(rec.cargas_previstas)||0) + (parseInt(exp.cargas_previstas)||0);
  const totReal = (parseInt(rec.cargas_realizadas)||0) + (parseInt(exp.cargas_realizadas)||0);
  const totVeic = (parseInt(rec.cargas_veiculos)||0) + (parseInt(exp.cargas_veiculos)||0);

  const faltas = resumo.faltas_condutas || [];
  const ocorrencias = resumo.ocorrencias || [];
  const cortes = resumo.cortes || [];

  const valorTotalCortes = cortes.reduce((acc, c) => acc + (parseFloat(c.valor)||0), 0);
  const ocColaboradores = resumo.ocorrencias_colaboradores || [];

  const todasOcorrencias = getTodasOcorrenciasCD();
  const pendentesTotais = todasOcorrencias.filter(o => o.status === 'PENDENTE').length;

  return `
    <div class="space-y-5">
      <!-- BARRA DE SUBABAS: RESUMO DIÁRIO CD vs OCORRÊNCIAS -->
      <div class="flex items-center justify-between bg-slate-900 border border-slate-800 p-1.5 rounded-xl shadow-lg">
        <div class="flex items-center gap-2">
          <button onclick="activeResumoSubTab='resumo'; renderApp()" class="px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-2 transition ${activeResumoSubTab === 'resumo' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'}">
            <span>📋</span> Resumo Diário
          </button>
          <button onclick="activeResumoSubTab='ocorrencias'; renderApp()" class="px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-2 transition ${activeResumoSubTab === 'ocorrencias' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'}">
            <span>🚨</span> Ocorrências CD ${pendentesTotais > 0 ? `<span class="bg-amber-500 text-amber-950 text-[10px] font-black px-1.5 py-0.5 rounded-full">${pendentesTotais}</span>` : ''}
          </button>
        </div>
        <div class="text-[11px] text-slate-400 font-medium hidden sm:block pr-2">
          JR Distribuidora • Gestão Integrada de CD
        </div>
      </div>

      ${activeResumoSubTab === 'resumo' ? renderSubabaResumoDiario({ fData, fTurno, gestorNome, rec, exp, recQtdFunc, expQtdFunc, recTonH, expTonH, totPeso, totAux, totMov, totConf, totEmp, totFunc, totTonH, totPrev, totReal, totVeic, faltas, ocorrencias, cortes, valorTotalCortes, ocColaboradores }) : renderSubabaOcorrenciasCD({ fData, fTurno })}
    </div>
  `;
}

function renderSubabaResumoDiario(p) {
  return `
    <div class="space-y-5">
      <!-- HEADER DO MÓDULO RESUMO DIÁRIO CD -->
      <div class="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 p-4 rounded-xl shadow-xl border border-emerald-800/60 flex flex-col lg:flex-row items-center justify-between gap-4 text-white">
        <div class="flex items-center gap-3">
          <div class="bg-emerald-600/30 p-2.5 rounded-xl border border-emerald-500/40 text-2xl">📋</div>
          <div>
            <h2 class="text-lg font-black tracking-wider uppercase flex items-center gap-2">
              RESUMO DIÁRIO CD
              <span class="bg-emerald-800 text-emerald-200 text-[10px] px-2 py-0.5 rounded font-extrabold uppercase">JR OPER</span>
            </h2>
            <p class="text-[11px] text-slate-300 font-medium">Controle de Movimentação, Equipe, Ocorrências e Cortes de Produtos no CD</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <!-- SELETOR DE DATA -->
          <div class="bg-slate-900/90 p-2 rounded-lg border border-slate-700">
            <label class="block text-[9px] text-emerald-400 font-bold uppercase">Data do Resumo</label>
            <input type="date" value="${p.fData}" onchange="window._resumoFiltroData=this.value; renderApp()" class="bg-slate-800 border border-slate-600 text-white text-xs rounded p-1 font-bold">
          </div>

          <!-- SELETOR DE TURNO -->
          <div class="bg-slate-900/90 p-2 rounded-lg border border-slate-700">
            <label class="block text-[9px] text-emerald-400 font-bold uppercase">Turno / Setor</label>
            <select onchange="window._resumoFiltroTurno=this.value; renderApp()" class="bg-slate-800 border border-slate-600 text-amber-300 text-xs rounded p-1 font-bold">
              <option value="SECO" ${p.fTurno==='SECO'?'selected':''}>SECO (Marcos Adriano)</option>
              <option value="1º TURNO - FRIO" ${p.fTurno==='1º TURNO - FRIO'?'selected':''}>1º TURNO - FRIO (Melquiades Neto)</option>
              <option value="2º TURNO - FRIO" ${p.fTurno==='2º TURNO - FRIO'?'selected':''}>2º TURNO - FRIO (Gustavo Camara)</option>
            </select>
          </div>

          <!-- GESTOR RESPONSÁVEL -->
          <div class="bg-slate-900/90 p-2 rounded-lg border border-slate-700">
            <label class="block text-[9px] text-slate-400 font-bold uppercase">Gestor do Turno</label>
            <input type="text" id="rs-gestor" value="${p.gestorNome}" class="bg-slate-800 border border-slate-600 text-white text-xs rounded p-1 font-bold uppercase w-36">
          </div>

          <button onclick="salvarResumoDiarioCdCurrent()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-lg flex items-center gap-1.5 transition">
            💾 Salvar Resumo
          </button>

          <button onclick="gerarResumoDiarioPdf('${p.fData}', '${p.fTurno}')" class="bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold px-3 py-2 rounded-lg text-xs border border-amber-500/50 shadow flex items-center gap-1.5" title="Imprimir / PDF A4">
            🖨️ Imprimir PDF
          </button>
        </div>
      </div>

      <!-- PAINEL 1: RECEBIMENTO & EXPEDIÇÃO (MOVIMENTAÇÃO) -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <h3 class="text-sm font-bold text-white uppercase flex items-center gap-2">
            <span>📦</span> 1. MOVIMENTAÇÃO DE RECEBIMENTO & EXPEDIÇÃO
          </h3>
          <span class="text-[10px] text-slate-400">Total Movimentado: <b class="text-emerald-400 font-extrabold">${p.totPeso.toLocaleString('pt-BR', {minimumFractionDigits:2})} Kg</b></span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-950 text-slate-300 text-[10px] uppercase border-b border-slate-800">
              <tr>
                <th class="p-2 border-r border-slate-800 min-w-[120px]">Descrição</th>
                <th class="p-2 border-r border-slate-800 text-right min-w-[110px]">Peso (Kg)</th>
                <th class="p-2 border-r border-slate-800 text-center">Aux Junior</th>
                <th class="p-2 border-r border-slate-800 text-center">Movimentador</th>
                <th class="p-2 border-r border-slate-800 text-center">Conferente</th>
                <th class="p-2 border-r border-slate-800 text-center">Empilhador</th>
                <th class="p-2 border-r border-slate-800 text-center font-bold bg-emerald-950/40 text-emerald-300">Qtd Func</th>
                <th class="p-2 border-r border-slate-800 text-center font-bold bg-amber-950/40 text-amber-300">Média Ton/H</th>
                <th class="p-2 border-r border-slate-800 text-center">Cargas Previstas</th>
                <th class="p-2 border-r border-slate-800 text-center">Cargas Realizadas</th>
                <th class="p-2 text-center">Cargas (Veículos)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800 text-xs">
              <!-- LINHA RECEBIMENTO -->
              <tr>
                <td class="p-2 font-bold text-white bg-slate-950/50">RECEBIMENTO</td>
                <td class="p-2 text-right"><input type="number" step="0.01" id="rs-rec-peso" value="${p.rec.peso||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-24 bg-slate-800 border border-slate-700 text-white rounded p-1 text-right text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-rec-aux" value="${p.rec.aux_junior||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-rec-mov" value="${p.rec.movimentador||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-rec-conf" value="${p.rec.conferente||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-rec-emp" value="${p.rec.empilhador||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center font-bold text-emerald-400 bg-emerald-950/20">${p.recQtdFunc}</td>
                <td class="p-2 text-center font-bold text-amber-400 bg-amber-950/20">${Math.round(p.recTonH).toLocaleString('pt-BR')}</td>
                <td class="p-2 text-center"><input type="number" id="rs-rec-prev" value="${p.rec.cargas_previstas||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-rec-real" value="${p.rec.cargas_realizadas||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-rec-veic" value="${p.rec.cargas_veiculos||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
              </tr>

              <!-- LINHA EXPEDIÇÃO -->
              <tr>
                <td class="p-2 font-bold text-white bg-slate-950/50">EXPEDIÇÃO</td>
                <td class="p-2 text-right"><input type="number" step="0.01" id="rs-exp-peso" value="${p.exp.peso||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-24 bg-slate-800 border border-slate-700 text-white rounded p-1 text-right text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-exp-aux" value="${p.exp.aux_junior||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-exp-mov" value="${p.exp.movimentador||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-exp-conf" value="${p.exp.conferente||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-exp-emp" value="${p.exp.empilhador||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center font-bold text-emerald-400 bg-emerald-950/20">${p.expQtdFunc}</td>
                <td class="p-2 text-center font-bold text-amber-400 bg-amber-950/20">${Math.round(p.expTonH).toLocaleString('pt-BR')}</td>
                <td class="p-2 text-center"><input type="number" id="rs-exp-prev" value="${p.exp.cargas_previstas||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-exp-real" value="${p.exp.cargas_realizadas||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
                <td class="p-2 text-center"><input type="number" id="rs-exp-veic" value="${p.exp.cargas_veiculos||0}" onchange="salvarResumoDiarioCdCurrent(false)" class="w-12 bg-slate-800 border border-slate-700 text-white rounded p-1 text-center text-xs"></td>
              </tr>

              <!-- LINHA TOTAL MOVIMENTADO -->
              <tr class="bg-emerald-950/40 font-bold text-emerald-200 border-t-2 border-emerald-700">
                <td class="p-2 uppercase">TOTAL MOVIMENTADO</td>
                <td class="p-2 text-right text-emerald-300 font-extrabold">${p.totPeso.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                <td class="p-2 text-center">${p.totAux}</td>
                <td class="p-2 text-center">${p.totMov}</td>
                <td class="p-2 text-center">${p.totConf}</td>
                <td class="p-2 text-center">${p.totEmp}</td>
                <td class="p-2 text-center text-emerald-400 font-extrabold">${p.totFunc}</td>
                <td class="p-2 text-center text-amber-300 font-extrabold">${Math.round(p.totTonH).toLocaleString('pt-BR')}</td>
                <td class="p-2 text-center">${p.totPrev}</td>
                <td class="p-2 text-center">${p.totReal}</td>
                <td class="p-2 text-center">${p.totVeic}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- GRID INFERIOR (2 COLUNAS) -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <!-- COLUNA ESQUERDA: FALTAS & OUTRAS OCORRÊNCIAS -->
        <div class="space-y-5">
          <!-- SEÇÃO 2: GESTÃO DE FALTAS & CONDUTAS -->
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
            <div class="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 class="text-xs font-bold text-amber-400 uppercase flex items-center gap-1.5">
                <span>⚠️</span> 2. GESTÃO DE FALTAS, CONDUTAS & AUSÊNCIAS
              </h3>
              <button onclick="adicionarFaltaResumo('${p.fData}', '${p.fTurno}')" class="bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-[10px] px-2.5 py-1 rounded shadow">+ Adicionar Falta</button>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-950 text-slate-300 text-[9px] uppercase border-b border-slate-800">
                  <tr>
                    <th class="p-1.5 border-r border-slate-800">Nome Colaborador</th>
                    <th class="p-1.5 border-r border-slate-800">Conduta / Ausência</th>
                    <th class="p-1.5 border-r border-slate-800 text-center">Avisado?</th>
                    <th class="p-1.5 border-r border-slate-800 text-center">Período</th>
                    <th class="p-1.5 border-r border-slate-800 text-center">Compensar?</th>
                    <th class="p-1.5 text-center">Ação</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800 text-xs">
                  ${p.faltas.length === 0 ? '<tr><td colspan="6" class="p-4 text-center text-slate-500 text-[11px]">Nenhuma falta ou ocorrência de conduta registrada neste turno.</td></tr>' :
                  p.faltas.map((f, idx) => `
                    <tr>
                      <td class="p-1.5 font-bold text-white">${f.nome}</td>
                      <td class="p-1.5 text-amber-300 font-medium">${f.conduta}</td>
                      <td class="p-1.5 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${f.avisado==='SIM'?'bg-emerald-950 text-emerald-300':'bg-red-950 text-red-300'}">${f.avisado}</span></td>
                      <td class="p-1.5 text-center text-slate-300 text-[11px]">${f.periodo||'Integral'}</td>
                      <td class="p-1.5 text-center text-slate-300 text-[11px]">${f.compensar||'NÃO'}</td>
                      <td class="p-1.5 text-center whitespace-nowrap">
                        <button onclick="editarFaltaResumoModal('${p.fData}', '${p.fTurno}', ${idx})" class="text-blue-400 hover:text-blue-300 p-1 font-bold text-xs" title="Editar Falta / Atestado">✏️</button>
                        <button onclick="removerFaltaResumo('${p.fData}', '${p.fTurno}', ${idx})" class="text-red-400 hover:text-red-300 p-1 font-bold text-xs" title="Excluir">🗑️</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- SEÇÃO 3: OUTRAS OCORRÊNCIAS OPERACIONAIS DO CD -->
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
            <div class="flex items-center justify-between border-b border-slate-800 pb-2">
              <div>
                <h3 class="text-xs font-bold text-blue-400 uppercase flex items-center gap-1.5">
                  <span>📢</span> 3. OUTRAS OCORRÊNCIAS OPERACIONAIS DO CD
                </h3>
                <span class="text-[9px] text-slate-400">Apontamentos sobre a Operação Geral do CD</span>
              </div>
              <button onclick="adicionarOcorrenciaResumo('${p.fData}', '${p.fTurno}')" class="bg-blue-700 hover:bg-blue-600 text-white font-bold text-[10px] px-2.5 py-1 rounded shadow">+ Adicionar Ocorrência Operacional</button>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-950 text-slate-300 text-[9px] uppercase border-b border-slate-800">
                  <tr>
                    <th class="p-1.5 border-r border-slate-800 w-1/4">Ocorrência</th>
                    <th class="p-1.5 border-r border-slate-800 w-2/4">Causa / Detalhamento</th>
                    <th class="p-1.5 border-r border-slate-800 w-1/4">Ação Tomada</th>
                    <th class="p-1.5 text-center">Ação</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800 text-xs">
                  ${p.ocorrencias.length === 0 ? '<tr><td colspan="4" class="p-4 text-center text-slate-500 text-[11px]">Nenhuma ocorrência operacional geral registrada.</td></tr>' :
                  p.ocorrencias.map((o, idx) => `
                    <tr>
                      <td class="p-1.5 font-bold text-white uppercase">${o.ocorrencia}</td>
                      <td class="p-1.5 text-slate-300 leading-tight text-[11px]">${o.causa}</td>
                      <td class="p-1.5 text-emerald-300 font-medium text-[11px]">${o.acao}</td>
                      <td class="p-1.5 text-center whitespace-nowrap">
                        <button onclick="editarOcorrenciaResumoModal('${p.fData}', '${p.fTurno}', ${idx})" class="text-blue-400 hover:text-blue-300 p-1 font-bold text-xs" title="Editar">✏️</button>
                        <button onclick="removerOcorrenciaResumo('${p.fData}', '${p.fTurno}', ${idx})" class="text-red-400 hover:text-red-300 p-1 font-bold text-xs" title="Excluir">🗑️</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- COLUNA DIREITA: DESCRIÇÃO DOS CORTES DO CD -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
          <div class="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 class="text-xs font-bold text-red-400 uppercase flex items-center gap-1.5">
              <span>✂️</span> 4. DESCRIÇÃO DOS CORTES DO CD
            </h3>
            <div class="flex items-center gap-2">
              <span class="bg-red-950 text-red-300 border border-red-800 text-xs font-extrabold px-2.5 py-1 rounded">
                Total: R$ ${p.valorTotalCortes.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
              </span>
              <button onclick="adicionarCorteResumo('${p.fData}', '${p.fTurno}')" class="bg-red-700 hover:bg-red-600 text-white font-bold text-[10px] px-2.5 py-1 rounded shadow">+ Adicionar Corte</button>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-950 text-slate-300 text-[9px] uppercase border-b border-slate-800">
                <tr>
                  <th class="p-1.5 border-r border-slate-800">Cód Item</th>
                  <th class="p-1.5 border-r border-slate-800">Descrição do Produto</th>
                  <th class="p-1.5 border-r border-slate-800 font-bold text-amber-300 text-center">Qtd Cortada (Kg)</th>
                  <th class="p-1.5 border-r border-slate-800 text-right">Valor (R$)</th>
                  <th class="p-1.5 text-center">Ação</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800 text-xs">
                ${p.cortes.length === 0 ? '<tr><td colspan="5" class="p-4 text-center text-slate-500 text-[11px]">Nenhum corte de produto registrado neste turno.</td></tr>' :
                p.cortes.map((c, idx) => `
                  <tr>
                    <td class="p-1.5 font-bold text-emerald-400">${c.codigo_item}</td>
                    <td class="p-1.5 font-bold text-white uppercase">${c.descricao}</td>
                    <td class="p-1.5 text-center font-bold text-amber-300">${c.quantidade}</td>
                    <td class="p-1.5 text-right font-extrabold text-red-400">R$ ${(parseFloat(c.valor)||0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                    <td class="p-1.5 text-center whitespace-nowrap">
                      <button onclick="editarCorteResumoModal('${p.fData}', '${p.fTurno}', ${idx})" class="text-blue-400 hover:text-blue-300 p-1 font-bold text-xs" title="Editar">✏️</button>
                      <button onclick="removerCorteResumo('${p.fData}', '${p.fTurno}', ${idx})" class="text-red-400 hover:text-red-300 p-1 font-bold text-xs" title="Excluir">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSubabaOcorrenciasCD({ fData, fTurno }) {
  const todas = getTodasOcorrenciasCD();

  const busca = (window._ocFiltroBusca || '').toLowerCase().trim();
  const filtroData = window._ocFiltroData !== undefined ? window._ocFiltroData : '';
  const filtroTurno = window._ocFiltroTurno || 'TODOS';

  // Ocorrências Pendentes (Todas para ação rápida)
  const pendentes = todas.filter(o => o.status === 'PENDENTE');

  // Ocorrências Fechadas (Filtradas por busca, data e turno)
  const fechadas = todas.filter(o => o.status === 'FECHADO').filter(o => {
    if (filtroData && o.data !== filtroData) return false;
    if (filtroTurno !== 'TODOS' && o.turno !== filtroTurno) return false;
    if (busca) {
      const txt = `${o.data} ${o.turno} ${o.titulo} ${o.colaborador} ${o.carga||''} ${o.causa} ${o.acao} ${o.peso||''}`.toLowerCase();
      if (!txt.includes(busca)) return false;
    }
    return true;
  });

  return `
    <div class="space-y-5">
      <!-- HEADER SUBABA OCORRÊNCIAS -->
      <div class="bg-gradient-to-r from-slate-900 via-amber-950/40 to-slate-900 p-4 rounded-xl shadow-xl border border-amber-800/40 flex flex-col lg:flex-row items-center justify-between gap-4 text-white">
        <div class="flex items-center gap-3">
          <div class="bg-amber-600/30 p-2.5 rounded-xl border border-amber-500/40 text-2xl">🚨</div>
          <div>
            <h2 class="text-lg font-black tracking-wider uppercase flex items-center gap-2">
              GESTÃO DE OCORRÊNCIAS DO CD
              <span class="bg-amber-800 text-amber-200 text-[10px] px-2 py-0.5 rounded font-extrabold uppercase">OCORRÊNCIAS POR COLABORADOR & OPERAÇÃO</span>
            </h2>
            <p class="text-[11px] text-slate-300 font-medium">Controle unificado de apontamentos, ações corretivas e encerramento de ocorrências do CD</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button onclick="abrirModalNovaOcorrenciaCD('${fData}', '${fTurno}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-2 rounded-lg text-xs shadow-lg flex items-center gap-1.5 transition">
            + Nova Ocorrência
          </button>
        </div>
      </div>

      <!-- PAINÉIS DIVIDIDOS: PENDENTES E FECHADAS -->
      <div class="space-y-6">
        <!-- PAINEL 1: OCORRÊNCIAS PENDENTES -->
        <div class="bg-slate-900 border border-amber-800/60 rounded-xl p-4 shadow-xl space-y-3">
          <div class="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 class="text-sm font-extrabold text-amber-400 uppercase flex items-center gap-2">
              <span>⏳</span> OCORRÊNCIAS PENDENTES
              <span class="bg-amber-950 text-amber-300 border border-amber-800/80 text-[10px] font-black px-2.5 py-0.5 rounded-full">${pendentes.length}</span>
            </h3>
            <span class="text-[10px] text-amber-300/80 font-medium">Ocorrências aguardando providência ou finalização</span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-950 text-slate-300 text-[9px] uppercase border-b border-slate-800">
                <tr>
                  <th class="p-2 border-r border-slate-800 whitespace-nowrap">Data / Turno</th>
                  <th class="p-2 border-r border-slate-800 min-w-[150px]">Funcionário</th>
                  <th class="p-2 border-r border-slate-800 font-bold text-amber-400">Requisito / Falha</th>
                  <th class="p-2 border-r border-slate-800 text-center">Carga</th>
                  <th class="p-2 border-r border-slate-800 min-w-[200px]">Detalhamento</th>
                  <th class="p-2 border-r border-slate-800 min-w-[180px] text-emerald-400">Ação Corretiva</th>
                  <th class="p-2 border-r border-slate-800 text-right">Peso (Kg)</th>
                  <th class="p-2 border-r border-slate-800 text-center">Status</th>
                  <th class="p-2 text-center min-w-[120px]">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800 text-xs">
                ${pendentes.length === 0 ? '<tr><td colspan="9" class="p-6 text-center text-slate-500 text-xs font-medium">Nenhuma ocorrência pendente no momento.</td></tr>' :
                pendentes.map(o => `
                  <tr class="hover:bg-slate-800/40">
                    <td class="p-2 border-r border-slate-800 whitespace-nowrap text-slate-300">
                      <div class="font-bold">${o.data}</div>
                      <div class="text-[10px] text-amber-400 font-semibold">${o.turno}</div>
                    </td>
                    <td class="p-2 border-r border-slate-800 font-bold text-white uppercase">${o.colaborador}</td>
                    <td class="p-2 border-r border-slate-800 font-bold text-amber-300">${o.titulo}</td>
                    <td class="p-2 border-r border-slate-800 text-center font-bold text-slate-300">${o.carga || '-'}</td>
                    <td class="p-2 border-r border-slate-800 text-slate-300 leading-tight text-[11px]">${o.causa}</td>
                    <td class="p-2 border-r border-slate-800 text-emerald-300 font-medium leading-tight text-[11px]">${o.acao || '-'}</td>
                    <td class="p-2 border-r border-slate-800 text-right font-bold text-slate-300">${o.peso ? `${o.peso} Kg` : '-'}</td>
                    <td class="p-2 border-r border-slate-800 text-center whitespace-nowrap">
                      <span class="bg-amber-950 text-amber-300 border border-amber-700/80 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase">PENDENTE</span>
                    </td>
                    <td class="p-2 text-center whitespace-nowrap space-x-1">
                      <button onclick="editarOcorrenciaCDSubaba('${o._parentData}', '${o._parentTurno}', '${o._type}', ${o._index})" class="text-blue-400 hover:text-blue-300 p-1 text-xs" title="Editar Ocorrência">✏️</button>
                      <button onclick="alterarStatusOcorrenciaCD('${o._parentData}', '${o._parentTurno}', '${o._type}', ${o._index}, 'FECHADO')" class="bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-[10px] px-2 py-1 rounded shadow transition" title="Concluir Ocorrência">
                        ✔️ Fechar
                      </button>
                      <button onclick="removerOcorrenciaCDSubaba('${o._parentData}', '${o._parentTurno}', '${o._type}', ${o._index})" class="text-red-400 hover:text-red-300 p-1 text-xs" title="Excluir">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- PAINEL 2: OCORRÊNCIAS FECHADAS (COM BARRA DE BUSCA, FILTROS E EXPORTAÇÃO) -->
        <div class="bg-slate-900 border border-emerald-800/60 rounded-xl p-4 shadow-xl space-y-4">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 pb-3 gap-3">
            <div>
              <h3 class="text-sm font-extrabold text-emerald-400 uppercase flex items-center gap-2">
                <span>✅</span> PAINEL DE OCORRÊNCIAS FECHADAS / RESOLVIDAS
                <span class="bg-emerald-950 text-emerald-300 border border-emerald-800/80 text-[10px] font-black px-2.5 py-0.5 rounded-full">${fechadas.length}</span>
              </h3>
              <p class="text-[10px] text-emerald-300/80 font-medium">Consulte, filtre e exporte relatórios de ocorrências finalizadas</p>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <button onclick="gerarRelatorioOcorrenciasPdf()" class="bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold px-3 py-1.5 rounded-lg text-xs border border-amber-500/50 shadow flex items-center gap-1.5" title="Imprimir Relatório de Fechadas">
                🖨️ Imprimir PDF (Fechadas)
              </button>
              <button onclick="exportarOcorrenciasExcel()" class="bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold px-3 py-1.5 rounded-lg text-xs border border-emerald-500/50 shadow flex items-center gap-1.5" title="Exportar Excel/CSV">
                📊 Exportar Excel
              </button>
            </div>
          </div>

          <!-- BARRA DE FILTROS DEDICADA ÀS OCORRÊNCIAS FECHADAS -->
          <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl shadow-inner grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
            <div class="sm:col-span-2">
              <label class="block text-[9px] text-slate-400 font-bold uppercase mb-1">Pesquisar em Fechadas (Funcionário, Falha, Carga ou Solução)</label>
              <input type="text" placeholder="🔎 Digite para pesquisar..." value="${window._ocFiltroBusca||''}" oninput="window._ocFiltroBusca=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-lg p-2 font-medium focus:border-emerald-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-[9px] text-slate-400 font-bold uppercase mb-1">Filtrar por Data</label>
              <input type="date" value="${window._ocFiltroData||''}" onchange="window._ocFiltroData=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-lg p-2 font-bold">
            </div>
            <div>
              <label class="block text-[9px] text-slate-400 font-bold uppercase mb-1">Filtrar por Turno</label>
              <select onchange="window._ocFiltroTurno=this.value; renderApp()" class="w-full bg-slate-900 border border-slate-700 text-amber-300 text-xs rounded-lg p-2 font-bold">
                <option value="TODOS" ${filtroTurno==='TODOS'?'selected':''}>TODOS OS TURNOS</option>
                <option value="SECO" ${filtroTurno==='SECO'?'selected':''}>SECO</option>
                <option value="1º TURNO - FRIO" ${filtroTurno==='1º TURNO - FRIO'?'selected':''}>1º TURNO - FRIO</option>
                <option value="2º TURNO - FRIO" ${filtroTurno==='2º TURNO - FRIO'?'selected':''}>2º TURNO - FRIO</option>
              </select>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-950 text-slate-300 text-[9px] uppercase border-b border-slate-800">
                <tr>
                  <th class="p-2 border-r border-slate-800 whitespace-nowrap">Data / Turno</th>
                  <th class="p-2 border-r border-slate-800 min-w-[150px]">Funcionário</th>
                  <th class="p-2 border-r border-slate-800 font-bold text-amber-400">Requisito / Falha</th>
                  <th class="p-2 border-r border-slate-800 text-center">Carga</th>
                  <th class="p-2 border-r border-slate-800 min-w-[200px]">Detalhamento</th>
                  <th class="p-2 border-r border-slate-800 min-w-[180px] text-emerald-400">Ação Corretiva Tomada</th>
                  <th class="p-2 border-r border-slate-800 text-right">Peso (Kg)</th>
                  <th class="p-2 border-r border-slate-800 text-center">Status</th>
                  <th class="p-2 text-center min-w-[120px]">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800 text-xs">
                ${fechadas.length === 0 ? '<tr><td colspan="9" class="p-6 text-center text-slate-500 text-xs font-medium">Nenhuma ocorrência fechada encontrada para os filtros aplicados.</td></tr>' :
                fechadas.map(o => `
                  <tr class="hover:bg-slate-800/40">
                    <td class="p-2 border-r border-slate-800 whitespace-nowrap text-slate-300">
                      <div class="font-bold">${o.data}</div>
                      <div class="text-[10px] text-emerald-400 font-semibold">${o.turno}</div>
                    </td>
                    <td class="p-2 border-r border-slate-800 font-bold text-white uppercase">${o.colaborador}</td>
                    <td class="p-2 border-r border-slate-800 font-bold text-amber-300">${o.titulo}</td>
                    <td class="p-2 border-r border-slate-800 text-center font-bold text-slate-300">${o.carga || '-'}</td>
                    <td class="p-2 border-r border-slate-800 text-slate-300 leading-tight text-[11px]">${o.causa}</td>
                    <td class="p-2 border-r border-slate-800 text-emerald-300 font-medium leading-tight text-[11px]">${o.acao || '-'}</td>
                    <td class="p-2 border-r border-slate-800 text-right font-bold text-slate-300">${o.peso ? `${o.peso} Kg` : '-'}</td>
                    <td class="p-2 border-r border-slate-800 text-center whitespace-nowrap">
                      <span class="bg-emerald-950 text-emerald-300 border border-emerald-700/80 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase">FECHADO</span>
                    </td>
                    <td class="p-2 text-center whitespace-nowrap space-x-1">
                      <button onclick="editarOcorrenciaCDSubaba('${o._parentData}', '${o._parentTurno}', '${o._type}', ${o._index})" class="text-blue-400 hover:text-blue-300 p-1 text-xs" title="Editar Ocorrência">✏️</button>
                      <button onclick="alterarStatusOcorrenciaCD('${o._parentData}', '${o._parentTurno}', '${o._type}', ${o._index}, 'PENDENTE')" class="bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-[10px] px-2 py-1 rounded border border-amber-500/40 shadow transition" title="Reabrir Ocorrência">
                        🔄 Reabrir
                      </button>
                      <button onclick="removerOcorrenciaCDSubaba('${o._parentData}', '${o._parentTurno}', '${o._type}', ${o._index})" class="text-red-400 hover:text-red-300 p-1 text-xs" title="Excluir">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function salvarResumoDiarioCdCurrent(showAlert = true) {
  const fData = window._resumoFiltroData || new Date().toISOString().split('T')[0];
  const fTurno = window._resumoFiltroTurno || '2º TURNO - FRIO';

  const resumo = db.getResumoDiarioCD(fData, fTurno);
  resumo.gestor = document.getElementById('rs-gestor')?.value || resumo.gestor;

  resumo.movimentacao = {
    recebimento: {
      peso: parseFloat(document.getElementById('rs-rec-peso')?.value) || 0,
      aux_junior: parseInt(document.getElementById('rs-rec-aux')?.value) || 0,
      movimentador: parseInt(document.getElementById('rs-rec-mov')?.value) || 0,
      conferente: parseInt(document.getElementById('rs-rec-conf')?.value) || 0,
      empilhador: parseInt(document.getElementById('rs-rec-emp')?.value) || 0,
      cargas_previstas: parseInt(document.getElementById('rs-rec-prev')?.value) || 0,
      cargas_realizadas: parseInt(document.getElementById('rs-rec-real')?.value) || 0,
      cargas_veiculos: parseInt(document.getElementById('rs-rec-veic')?.value) || 0
    },
    expedicao: {
      peso: parseFloat(document.getElementById('rs-exp-peso')?.value) || 0,
      aux_junior: parseInt(document.getElementById('rs-exp-aux')?.value) || 0,
      movimentador: parseInt(document.getElementById('rs-exp-mov')?.value) || 0,
      conferente: parseInt(document.getElementById('rs-exp-conf')?.value) || 0,
      empilhador: parseInt(document.getElementById('rs-exp-emp')?.value) || 0,
      cargas_previstas: parseInt(document.getElementById('rs-exp-prev')?.value) || 0,
      cargas_realizadas: parseInt(document.getElementById('rs-exp-real')?.value) || 0,
      cargas_veiculos: parseInt(document.getElementById('rs-exp-veic')?.value) || 0
    }
  };

  db.saveResumoDiarioCD(resumo);
  if (showAlert) alert('✅ Resumo Diário do CD salvo com sucesso!');
  renderApp();
}

function getListaTodosColaboradores() {
  const set = new Set();
  (db.data.separadores_conferentes || []).forEach(n => { if (n) set.add(String(n).toUpperCase().trim()); });
  (db.data.motoristas || []).forEach(m => { if (m && m.nome) set.add(String(m.nome).toUpperCase().trim()); });
  (db.data.ajudantes || []).forEach(a => { if (a && a.nome) set.add(String(a.nome).toUpperCase().trim()); });
  (db.data.usuarios || []).forEach(u => { if (u && u.nome) set.add(String(u.nome).split('(')[0].toUpperCase().trim()); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function fecharModalResumo() {
  const container = document.getElementById('modal-container');
  if (container) {
    container.innerHTML = '';
    container.classList.add('hidden');
  }
}

function adicionarFaltaResumo(data, turno) {
  const colabs = getListaTodosColaboradores();
  const container = document.getElementById('modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-md w-full shadow-2xl text-white space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-amber-400 uppercase flex items-center gap-2">
          <span>⚠️</span> Registrar Falta / Conduta
        </h3>
        <button onclick="fecharModalResumo()" class="text-slate-400 hover:text-white font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Colaborador (Dados SAC - Separador / Conferente)</label>
          <select id="md-fl-nome" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
            <option value="">-- Selecione o Colaborador --</option>
            ${colabs.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Conduta / Ausência</label>
          <input type="text" id="md-fl-conduta" placeholder="ex: FALTA, ATRASO OPERACIONAL, SAÍDA ANTECIPADA" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Avisado Previamente?</label>
            <select id="md-fl-avisado" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
              <option value="SIM">SIM</option>
              <option value="NÃO">NÃO</option>
            </select>
          </div>

          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Período</label>
            <input type="text" id="md-fl-periodo" value="Integral" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Vai Compensar?</label>
          <select id="md-fl-compensar" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
            <option value="SIM">SIM</option>
            <option value="NÃO">NÃO</option>
          </select>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="fecharModalResumo()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded text-xs">Cancelar</button>
        <button onclick="confirmarSalvarFaltaResumo('${data}', '${turno}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs shadow">Salvar Registro</button>
      </div>
    </div>
  `;
  container.classList.remove('hidden');
}

function confirmarSalvarFaltaResumo(data, turno) {
  const nome = document.getElementById('md-fl-nome')?.value;
  if (!nome) { alert('Selecione o colaborador!'); return; }
  const conduta = document.getElementById('md-fl-conduta')?.value || 'FALTA';
  const avisado = document.getElementById('md-fl-avisado')?.value || 'SIM';
  const periodo = document.getElementById('md-fl-periodo')?.value || 'Integral';
  const compensar = document.getElementById('md-fl-compensar')?.value || 'SIM';

  const resumo = db.getResumoDiarioCD(data, turno);
  if (!resumo.faltas_condutas) resumo.faltas_condutas = [];
  resumo.faltas_condutas.push({
    id: Date.now(),
    nome: nome.toUpperCase().trim(),
    conduta: conduta.toUpperCase().trim(),
    avisado: avisado.toUpperCase().trim(),
    periodo: periodo.trim(),
    compensar: compensar.toUpperCase().trim()
  });
  db.saveResumoDiarioCD(resumo);
  fecharModalResumo();
  renderApp();
}

function removerFaltaResumo(data, turno, index) {
  if (!confirm('Excluir esta falta/conduta registrada?')) return;
  const resumo = db.getResumoDiarioCD(data, turno);
  if (resumo.faltas_condutas) {
    resumo.faltas_condutas.splice(index, 1);
    db.saveResumoDiarioCD(resumo);
    renderApp();
  }
}

function editarFaltaResumoModal(data, turno, index) {
  const resumo = db.getResumoDiarioCD(data, turno);
  const item = resumo.faltas_condutas?.[index];
  if (!item) return;

  const colabs = getListaTodosColaboradores();
  const container = document.getElementById('modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-md w-full shadow-2xl text-white space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-amber-400 uppercase flex items-center gap-2">
          <span>✏️</span> Editar Falta / Atestado / Conduta
        </h3>
        <button onclick="fecharModalResumo()" class="text-slate-400 hover:text-white font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Colaborador *</label>
          <select id="md-fl-nome" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
            <option value="">-- Selecione o Colaborador --</option>
            ${colabs.map(c => `<option value="${c}" ${c === item.nome ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Conduta / Ausência *</label>
          <input type="text" id="md-fl-conduta" value="${item.conduta || 'FALTA'}" placeholder="ex: FALTA, ATESTADO MÉDICO, ATRASO OPERACIONAL" class="w-full bg-slate-800 border border-slate-700 text-amber-300 rounded p-2 text-xs font-bold uppercase">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Avisado Previamente?</label>
            <select id="md-fl-avisado" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
              <option value="SIM" ${item.avisado === 'SIM' ? 'selected' : ''}>SIM</option>
              <option value="NÃO" ${item.avisado === 'NÃO' ? 'selected' : ''}>NÃO</option>
            </select>
          </div>

          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Período</label>
            <input type="text" id="md-fl-periodo" value="${item.periodo || 'Integral'}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Vai Compensar?</label>
          <select id="md-fl-compensar" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
            <option value="SIM" ${item.compensar === 'SIM' ? 'selected' : ''}>SIM</option>
            <option value="NÃO" ${item.compensar === 'NÃO' ? 'selected' : ''}>NÃO</option>
          </select>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="fecharModalResumo()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded text-xs">Cancelar</button>
        <button onclick="confirmarEditarFaltaResumo('${data}', '${turno}', ${index})" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs shadow">Salvar Alterações</button>
      </div>
    </div>
  `;
  container.classList.remove('hidden');
}

function confirmarEditarFaltaResumo(data, turno, index) {
  const nome = document.getElementById('md-fl-nome')?.value;
  if (!nome) { alert('Selecione o colaborador!'); return; }
  const conduta = document.getElementById('md-fl-conduta')?.value || 'FALTA';
  const avisado = document.getElementById('md-fl-avisado')?.value || 'SIM';
  const periodo = document.getElementById('md-fl-periodo')?.value || 'Integral';
  const compensar = document.getElementById('md-fl-compensar')?.value || 'SIM';

  const resumo = db.getResumoDiarioCD(data, turno);
  if (!resumo.faltas_condutas?.[index]) return;

  resumo.faltas_condutas[index].nome = nome.toUpperCase().trim();
  resumo.faltas_condutas[index].conduta = conduta.toUpperCase().trim();
  resumo.faltas_condutas[index].avisado = avisado.toUpperCase().trim();
  resumo.faltas_condutas[index].periodo = periodo.trim();
  resumo.faltas_condutas[index].compensar = compensar.toUpperCase().trim();

  db.saveResumoDiarioCD(resumo);
  fecharModalResumo();
  renderApp();
}

function adicionarOcorrenciaResumo(data, turno) {
  const container = document.getElementById('modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-md w-full shadow-2xl text-white space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-blue-400 uppercase flex items-center gap-2">
          <span>📢</span> Registrar Ocorrência Operacional do CD
        </h3>
        <button onclick="fecharModalResumo()" class="text-slate-400 hover:text-white font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Título / Tipo de Ocorrência *</label>
          <input type="text" id="md-oc-titulo" placeholder="ex: QUEBRA DE EMPILHADEIRA, QUEDA DE ENERGIA" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Causa / Detalhamento</label>
          <textarea id="md-oc-causa" rows="3" placeholder="Descreva os detalhes e causas do ocorrido..." class="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded p-2 text-xs"></textarea>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Ação Tomada / Solução</label>
          <textarea id="md-oc-acao" rows="2" placeholder="Descreva a solução ou encaminhamento realizado..." class="w-full bg-slate-800 border border-slate-700 text-emerald-300 rounded p-2 text-xs"></textarea>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="fecharModalResumo()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded text-xs">Cancelar</button>
        <button onclick="confirmarSalvarOcorrenciaResumo('${data}', '${turno}')" class="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-1.5 rounded text-xs shadow">Salvar Ocorrência</button>
      </div>
    </div>`;
  container.classList.remove('hidden');
}

function confirmarSalvarOcorrenciaResumo(data, turno, editIndex = -1) {
  const titulo = document.getElementById('md-oc-titulo')?.value;
  if (!titulo) { alert('Informe o título da ocorrência!'); return; }
  const causa = document.getElementById('md-oc-causa')?.value || '';
  const acao = document.getElementById('md-oc-acao')?.value || '';

  const resumo = db.getResumoDiarioCD(data, turno);
  if (!resumo.ocorrencias) resumo.ocorrencias = [];

  const item = {
    id: editIndex >= 0 ? resumo.ocorrencias[editIndex].id : Date.now(),
    ocorrencia: titulo.toUpperCase().trim(),
    causa: causa.trim(),
    acao: acao.trim()
  };

  if (editIndex >= 0) {
    resumo.ocorrencias[editIndex] = item;
  } else {
    resumo.ocorrencias.push(item);
  }

  db.saveResumoDiarioCD(resumo);
  fecharModalResumo();
  renderApp();
}

function editarOcorrenciaResumoModal(data, turno, index) {
  const resumo = db.getResumoDiarioCD(data, turno);
  const o = resumo.ocorrencias?.[index];
  if (!o) return;

  const container = document.getElementById('modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-md w-full shadow-2xl text-white space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-blue-400 uppercase flex items-center gap-2">
          <span>✏️</span> Editar Ocorrência Operacional do CD
        </h3>
        <button onclick="fecharModalResumo()" class="text-slate-400 hover:text-white font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Título / Tipo de Ocorrência *</label>
          <input type="text" id="md-oc-titulo" value="${o.ocorrencia}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Causa / Detalhamento</label>
          <textarea id="md-oc-causa" rows="3" class="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded p-2 text-xs">${o.causa||''}</textarea>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Ação Tomada / Solução</label>
          <textarea id="md-oc-acao" rows="2" class="w-full bg-slate-800 border border-slate-700 text-emerald-300 rounded p-2 text-xs">${o.acao||''}</textarea>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="fecharModalResumo()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded text-xs">Cancelar</button>
        <button onclick="confirmarSalvarOcorrenciaResumo('${data}', '${turno}', ${index})" class="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-1.5 rounded text-xs shadow">Salvar Edição</button>
      </div>
    </div>`;
  container.classList.remove('hidden');
}

function removerOcorrenciaResumo(data, turno, index) {
  if (!confirm('Excluir esta ocorrência do CD?')) return;
  const resumo = db.getResumoDiarioCD(data, turno);
  if (resumo.ocorrencias) {
    resumo.ocorrencias.splice(index, 1);
    db.saveResumoDiarioCD(resumo);
    renderApp();
  }
}

function editarCorteResumoModal(data, turno, index) {
  const resumo = db.getResumoDiarioCD(data, turno);
  const c = resumo.cortes?.[index];
  if (!c) return;

  const prods = db.data.produtos || [];
  const container = document.getElementById('modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-md w-full shadow-2xl text-white space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-red-400 uppercase flex items-center gap-2">
          <span>✏️</span> Editar Corte de Produto
        </h3>
        <button onclick="fecharModalResumo()" class="text-slate-400 hover:text-white font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Cód Item</label>
            <input type="text" id="md-cr-cod" value="${c.codigo_item}" class="w-full bg-slate-800 border border-slate-700 text-emerald-400 rounded p-2 text-xs font-bold">
          </div>
          <div class="col-span-2">
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Descrição do Produto</label>
            <input type="text" id="md-cr-desc" value="${c.descricao}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Qtd Cortada (Kg)</label>
            <input type="text" id="md-cr-qtd" value="${c.quantidade}" class="w-full bg-slate-800 border border-slate-700 text-amber-300 rounded p-2 text-xs font-bold">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Valor Total (R$)</label>
            <input type="number" step="0.01" id="md-cr-valor" value="${c.valor||0}" class="w-full bg-slate-800 border border-slate-700 text-red-400 rounded p-2 text-xs font-extrabold">
          </div>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="fecharModalResumo()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded text-xs">Cancelar</button>
        <button onclick="confirmarSalvarCorteResumo('${data}', '${turno}', ${index})" class="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-1.5 rounded text-xs shadow">Salvar Edição</button>
      </div>
    </div>`;
  container.classList.remove('hidden');
}

function adicionarCorteResumo(data, turno) {
  const prods = db.data.produtos || [];
  const container = document.getElementById('modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-md w-full shadow-2xl text-white space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-red-400 uppercase flex items-center gap-2">
          <span>✂️</span> Registrar Corte de Produto
        </h3>
        <button onclick="fecharModalResumo()" class="text-slate-400 hover:text-white font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Produto (Dados SAC - Produto)</label>
          <select id="md-cr-prod" onchange="autoFillProdutoCorte(this.value)" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
            <option value="">-- Selecione o Produto da Lista --</option>
            ${prods.map(p => `<option value="${p.codigo_produto}||${p.descricao}||${p.valor_unitario_padrao||0}">${p.codigo_produto} - ${p.descricao}</option>`).join('')}
          </select>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Cód Item</label>
            <input type="text" id="md-cr-cod" placeholder="ex: 27392" class="w-full bg-slate-800 border border-slate-700 text-emerald-400 rounded p-2 text-xs font-bold">
          </div>
          <div class="col-span-2">
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Descrição do Produto</label>
            <input type="text" id="md-cr-desc" placeholder="ex: MEIO DA ASA C/PONTA" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Qtd Cortada (Kg)</label>
            <input type="text" id="md-cr-qtd" placeholder="ex: 45.00 Kg ou 15.5" class="w-full bg-slate-800 border border-slate-700 text-amber-300 rounded p-2 text-xs font-bold">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Valor Total (R$)</label>
            <input type="number" step="0.01" id="md-cr-valor" placeholder="0.00" class="w-full bg-slate-800 border border-slate-700 text-red-400 rounded p-2 text-xs font-extrabold">
          </div>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="fecharModalResumo()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded text-xs">Cancelar</button>
        <button onclick="confirmarSalvarCorteResumo('${data}', '${turno}')" class="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-1.5 rounded text-xs shadow">Salvar Corte</button>
      </div>
    </div>
  `;
  container.classList.remove('hidden');
}

function autoFillProdutoCorte(val) {
  if (!val) return;
  const parts = val.split('||');
  if (parts.length >= 2) {
    document.getElementById('md-cr-cod').value = parts[0];
    document.getElementById('md-cr-desc').value = parts[1];
  }
}

function confirmarSalvarCorteResumo(data, turno, editIndex = -1) {
  const codigo = document.getElementById('md-cr-cod')?.value;
  if (!codigo) { alert('Informe o código ou selecione um produto!'); return; }
  const descricao = document.getElementById('md-cr-desc')?.value || '';
  let quantidade = document.getElementById('md-cr-qtd')?.value || '0.00 Kg';
  if (quantidade && !isNaN(parseFloat(quantidade.replace(',', '.'))) && !quantidade.toLowerCase().includes('kg')) {
    quantidade = `${parseFloat(quantidade.replace(',', '.')).toFixed(2)} Kg`;
  }
  const valor = parseFloat(document.getElementById('md-cr-valor')?.value) || 0;

  const resumo = db.getResumoDiarioCD(data, turno);
  if (!resumo.cortes) resumo.cortes = [];

  const item = {
    id: editIndex >= 0 ? resumo.cortes[editIndex].id : Date.now(),
    codigo_item: codigo.trim(),
    descricao: descricao.toUpperCase().trim(),
    quantidade: quantidade.trim(),
    valor: valor
  };

  if (editIndex >= 0) {
    resumo.cortes[editIndex] = item;
  } else {
    resumo.cortes.push(item);
  }

  db.saveResumoDiarioCD(resumo);
  fecharModalResumo();
  renderApp();
}

function removerCorteResumo(data, turno, index) {
  if (!confirm('Excluir este corte de produto?')) return;
  const resumo = db.getResumoDiarioCD(data, turno);
  if (resumo.cortes) {
    resumo.cortes.splice(index, 1);
    db.saveResumoDiarioCD(resumo);
    renderApp();
  }
}

function adicionarOcorrenciaColaboradorResumo(data, turno) {
  const colabs = getListaTodosColaboradores();
  const container = document.getElementById('modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full shadow-2xl text-white space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-emerald-400 uppercase flex items-center gap-2">
          <span>👤</span> Apontamento por Colaborador (SAC / Supervisão)
        </h3>
        <button onclick="fecharModalResumo()" class="text-slate-400 hover:text-white font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Data da Ocorrência</label>
            <input type="date" id="md-occ-data" value="${data}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Nº da Carga (Se houver)</label>
            <input type="text" id="md-occ-carga" placeholder="ex: 7689" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Funcionário (Dados SAC)</label>
          <select id="md-occ-func" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold uppercase">
            <option value="">-- Selecione o Colaborador --</option>
            ${colabs.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Requisito / Falha</label>
            <select id="md-occ-req" class="w-full bg-slate-800 border border-slate-700 text-amber-300 rounded p-2 text-xs font-bold">
              <option value="ERRO DE RECEBIMENTO">ERRO DE RECEBIMENTO</option>
              <option value="ERRO DE SEPARAÇÃO">ERRO DE SEPARAÇÃO</option>
              <option value="ERRO DE CONFERÊNCIA">ERRO DE CONFERÊNCIA</option>
              <option value="FALTA DE ATENÇÃO">FALTA DE ATENÇÃO</option>
              <option value="DESVIO DE CONDUTA">DESVIO DE CONDUTA</option>
              <option value="AVARIA NO MANUSEIO">AVARIA NO MANUSEIO</option>
              <option value="OUTRO">OUTRO</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Peso em Kg (Se identificar)</label>
            <input type="number" step="0.01" id="md-occ-peso" placeholder="ex: 15.50" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          </div>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Detalhamento da Ocorrência</label>
          <textarea id="md-occ-detalhamento" rows="3" placeholder="Descreva os detalhes da ocorrência ocorrida com o colaborador..." class="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded p-2 text-xs"></textarea>
        </div>

        <div>
          <label class="block text-[10px] text-slate-400 font-bold uppercase mb-1">Ação Corretiva Tomada</label>
          <textarea id="md-occ-acao" rows="2" placeholder="Descreva a ação de orientação, instrução ou advertência realizada..." class="w-full bg-slate-800 border border-slate-700 text-emerald-300 rounded p-2 text-xs"></textarea>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="fecharModalResumo()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded text-xs">Cancelar</button>
        <button onclick="confirmarSalvarOcorrenciaColaboradorResumo('${data}', '${turno}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 rounded text-xs shadow">Salvar Apontamento</button>
      </div>
    </div>
  `;
  container.classList.remove('hidden');
}

function confirmarSalvarOcorrenciaColaboradorResumo(data, turno) {
  const funcionario = document.getElementById('md-occ-func')?.value;
  if (!funcionario) { alert('Selecione o funcionário!'); return; }
  const dt = document.getElementById('md-occ-data')?.value || data;
  const requisito = document.getElementById('md-occ-req')?.value || 'OUTRO';
  const carga = document.getElementById('md-occ-carga')?.value || '';
  const detalhamento = document.getElementById('md-occ-detalhamento')?.value || '';
  const acao = document.getElementById('md-occ-acao')?.value || '';
  const peso = document.getElementById('md-occ-peso')?.value || '';

  const resumo = db.getResumoDiarioCD(data, turno);
  if (!resumo.ocorrencias_colaboradores) resumo.ocorrencias_colaboradores = [];
  resumo.ocorrencias_colaboradores.push({
    id: Date.now(),
    data: dt,
    funcionario: funcionario.toUpperCase().trim(),
    requisito: requisito.toUpperCase().trim(),
    carga: carga.trim(),
    detalhamento: detalhamento.trim(),
    acao: acao.trim(),
    peso: peso ? parseFloat(peso) : ''
  });
  db.saveResumoDiarioCD(resumo);
  fecharModalResumo();
  renderApp();
}

function removerOcorrenciaColaboradorResumo(data, turno, index) {
  if (!confirm('Excluir este apontamento por colaborador?')) return;
  const resumo = db.getResumoDiarioCD(data, turno);
  if (resumo.ocorrencias_colaboradores) {
    resumo.ocorrencias_colaboradores.splice(index, 1);
    db.saveResumoDiarioCD(resumo);
    renderApp();
  }
}

// Relatório Impresso A4 do Resumo Diário CD
function gerarResumoDiarioPdf(data, turno) {
  const resumo = db.getResumoDiarioCD(data, turno);
  const rec = resumo.movimentacao?.recebimento || {};
  const exp = resumo.movimentacao?.expedicao || {};

  const recFunc = (parseInt(rec.aux_junior)||0) + (parseInt(rec.movimentador)||0) + (parseInt(rec.conferente)||0) + (parseInt(rec.empilhador)||0);
  const expFunc = (parseInt(exp.aux_junior)||0) + (parseInt(exp.movimentador)||0) + (parseInt(exp.conferente)||0) + (parseInt(exp.empilhador)||0);

  const totPeso = (parseFloat(rec.peso)||0) + (parseFloat(exp.peso)||0);
  const totAux = Math.max(parseInt(rec.aux_junior)||0, parseInt(exp.aux_junior)||0);
  const totMov = Math.max(parseInt(rec.movimentador)||0, parseInt(exp.movimentador)||0);
  const totConf = Math.max(parseInt(rec.conferente)||0, parseInt(exp.conferente)||0);
  const totEmp = Math.max(parseInt(rec.empilhador)||0, parseInt(exp.empilhador)||0);
  const totFunc = totAux + totMov + totConf + totEmp;

  const totPrev = (parseInt(rec.cargas_previstas)||0) + (parseInt(exp.cargas_previstas)||0);
  const totReal = (parseInt(rec.cargas_realizadas)||0) + (parseInt(exp.cargas_realizadas)||0);
  const totVeic = (parseInt(rec.cargas_veiculos)||0) + (parseInt(exp.cargas_veiculos)||0);

  const recTonH = recFunc > 0 ? (parseFloat(rec.peso)||0) / recFunc : 0;
  const expTonH = expFunc > 0 ? (parseFloat(exp.peso)||0) / expFunc : 0;
  const totTonH = totFunc > 0 ? totPeso / totFunc : 0;

  const faltas = resumo.faltas_condutas || [];
  const ocorrencias = resumo.ocorrencias || [];
  const cortes = resumo.cortes || [];
  const totalCortes = cortes.reduce((a, b) => a + (parseFloat(b.valor)||0), 0);

  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>RESUMO DIÁRIO CD — ${resumo.data} (${resumo.turno})</title>
  <style>
    @media print {
      @page { margin: 10mm; size: A4 landscape; }
      body { -webkit-print-color-adjust: exact; }
    }
    body { font-family: Arial, sans-serif; margin: 0; padding: 15px; color: #0f172a; background: #fff; font-size: 11px; }
    .banner { background: #082a14; color: white; text-align: center; padding: 8px; font-size: 16px; font-weight: bold; text-transform: uppercase; border-radius: 4px; margin-bottom: 10px; }
    .meta-bar { display: flex; justify-content: space-between; background: #e2e8f0; border: 1px solid #cbd5e1; padding: 6px 12px; font-weight: bold; margin-bottom: 12px; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
    th, td { border: 1px solid #94a3b8; padding: 5px 7px; text-align: left; font-size: 10px; }
    th { background-color: #0f172a; color: white; text-transform: uppercase; font-size: 9px; }
    .sec-header { background: #1e3a2f; color: white; font-weight: bold; padding: 5px 8px; font-size: 11px; text-transform: uppercase; margin-bottom: 5px; border-radius: 3px; }
    .total-row { background: #dcfce7; font-weight: bold; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
  </style>
</head>
<body>
  <div class="banner">JR DISTRIBUIDORA — RESUMO DIÁRIO CD</div>
  
  <div class="meta-bar">
    <div>DATA: ${resumo.data}</div>
    <div>TURNO: ${resumo.turno}</div>
    <div>GESTOR: ${resumo.gestor || 'N/A'}</div>
  </div>

  <div class="sec-header">1. MOVIMENTAÇÃO DE RECEBIMENTO & EXPEDIÇÃO</div>
  <table>
    <thead>
      <tr>
        <th>Descrição</th>
        <th style="text-align:right;">Peso (Kg)</th>
        <th style="text-align:center;">Aux Junior</th>
        <th style="text-align:center;">Movimentador</th>
        <th style="text-align:center;">Conferente</th>
        <th style="text-align:center;">Empilhador</th>
        <th style="text-align:center;">Qtd Func</th>
        <th style="text-align:center;">Média Ton/H</th>
        <th style="text-align:center;">Cargas Prev.</th>
        <th style="text-align:center;">Cargas Real.</th>
        <th style="text-align:center;">Veículos</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><b>RECEBIMENTO</b></td>
        <td style="text-align:right;">${(parseFloat(rec.peso)||0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
        <td style="text-align:center;">${rec.aux_junior||0}</td>
        <td style="text-align:center;">${rec.movimentador||0}</td>
        <td style="text-align:center;">${rec.conferente||0}</td>
        <td style="text-align:center;">${rec.empilhador||0}</td>
        <td style="text-align:center;"><b>${recFunc}</b></td>
        <td style="text-align:center;">${Math.round(recTonH).toLocaleString('pt-BR')}</td>
        <td style="text-align:center;">${rec.cargas_previstas||0}</td>
        <td style="text-align:center;">${rec.cargas_realizadas||0}</td>
        <td style="text-align:center;">${rec.cargas_veiculos||0}</td>
      </tr>
      <tr>
        <td><b>EXPEDIÇÃO</b></td>
        <td style="text-align:right;">${(parseFloat(exp.peso)||0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
        <td style="text-align:center;">${exp.aux_junior||0}</td>
        <td style="text-align:center;">${exp.movimentador||0}</td>
        <td style="text-align:center;">${exp.conferente||0}</td>
        <td style="text-align:center;">${exp.empilhador||0}</td>
        <td style="text-align:center;"><b>${expFunc}</b></td>
        <td style="text-align:center;">${Math.round(expTonH).toLocaleString('pt-BR')}</td>
        <td style="text-align:center;">${exp.cargas_previstas||0}</td>
        <td style="text-align:center;">${exp.cargas_realizadas||0}</td>
        <td style="text-align:center;">${exp.cargas_veiculos||0}</td>
      </tr>
      <tr class="total-row">
        <td><b>TOTAL MOVIMENTADO</b></td>
        <td style="text-align:right;"><b>${totPeso.toLocaleString('pt-BR', {minimumFractionDigits:2})}</b></td>
        <td style="text-align:center;">${totAux}</td>
        <td style="text-align:center;">${totMov}</td>
        <td style="text-align:center;">${totConf}</td>
        <td style="text-align:center;">${totEmp}</td>
        <td style="text-align:center;"><b>${totFunc}</b></td>
        <td style="text-align:center;"><b>${Math.round(totTonH)}</b></td>
        <td style="text-align:center;">${totPrev}</td>
        <td style="text-align:center;">${totReal}</td>
        <td style="text-align:center;">${totVeic}</td>
      </tr>
    </tbody>
  </table>

  <div class="grid">
    <div>
      <div class="sec-header">2. GESTÃO DE FALTAS & CONDUTAS</div>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Conduta / Ausência</th>
            <th style="text-align:center;">Avisado</th>
            <th style="text-align:center;">Período</th>
            <th style="text-align:center;">Compensar</th>
          </tr>
        </thead>
        <tbody>
          ${faltas.length === 0 ? '<tr><td colspan="5" style="text-align:center;">Sem faltas/condutas registradas</td></tr>' :
          faltas.map(f => `
            <tr>
              <td><b>${f.nome}</b></td>
              <td>${f.conduta}</td>
              <td style="text-align:center;">${f.avisado}</td>
              <td style="text-align:center;">${f.periodo}</td>
              <td style="text-align:center;">${f.compensar}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="sec-header">3. OUTRAS OCORRÊNCIAS OPERACIONAIS DO CD</div>
      <table>
        <thead>
          <tr>
            <th>Ocorrência</th>
            <th>Causa / Detalhamento</th>
            <th>Ação Tomada</th>
          </tr>
        </thead>
        <tbody>
          ${ocorrencias.length === 0 ? '<tr><td colspan="3" style="text-align:center;">Sem ocorrências registradas</td></tr>' :
          ocorrencias.map(o => `
            <tr>
              <td><b>${o.ocorrencia}</b></td>
              <td>${o.causa}</td>
              <td>${o.acao}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div>
      <div class="sec-header" style="background:#881337; display:flex; justify-between;">
        <span>4. DESCRIÇÃO DOS CORTES DO CD</span>
        <span style="float:right;">TOTAL: R$ ${totalCortes.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Cód Item</th>
            <th>Descrição do Produto</th>
            <th style="text-align:center;">Qtd Cortada (Kg)</th>
            <th style="text-align:right;">Valor (R$)</th>
          </tr>
        </thead>
        <tbody>
          ${cortes.length === 0 ? '<tr><td colspan="4" style="text-align:center;">Nenhum corte de produto registrado</td></tr>' :
          cortes.map(c => `
            <tr>
              <td><b>${c.codigo_item}</b></td>
              <td>${c.descricao}</td>
              <td style="text-align:center;">${c.quantidade}</td>
              <td style="text-align:right;"><b>R$ ${(parseFloat(c.valor)||0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</b></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    window.onload = function() { setTimeout(function(){ window.print(); }, 500); }
  </script>
</body>
</html>`;

  const win = window.open('','_blank','width=1000,height=800');
  if (win) {
    win.document.write(htmlContent);
    win.document.close();
  }
}

// ===== IMPRESSOR EXECUTIVO DO BOLETIM GERENCIAL =====
function imprimirBoletimGerencialExecutivo() {
  const fDe = window._boletimFiltroDe || '';
  const fAte = window._boletimFiltroAte || '';

  const allDevs = db.getDevolucoes();
  const allRotas = db.getOcorrenciasRota();
  const allViagens = db.getControleViagens();
  const allOcViagens = db.getOcorrenciasViagens();
  const allTrocas = db.getTrocasVeiculos();

  const devs = allDevs.filter(d => {
    const dt = d.criado_em ? d.criado_em.split('T')[0] : '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  const rotas = allRotas.filter(r => {
    const dt = r.criado_em ? r.criado_em.split('T')[0] : '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  const viagens = allViagens.filter(v => {
    const dt = v.data_saida || '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  const ocViagens = allOcViagens.filter(o => {
    const dt = o.data || '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  const trocas = allTrocas.filter(t => {
    const dt = t.data || '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  let resumosCd = Array.isArray(db.data.resumo_diario_cd) ? db.data.resumo_diario_cd : Object.values(db.data.resumo_diario_cd || db.data.resumos_cd || {});
  if (fDe)  resumosCd = resumosCd.filter(r => r && (r.data||'') >= fDe);
  if (fAte) resumosCd = resumosCd.filter(r => r && (r.data||'') <= fAte);

  let pesoExpedicao = 0;
  let pesoRecebimento = 0;
  let cortesList = [];
  let ocorrenciasCdList = [];
  let faltasColabList = [];

  resumosCd.forEach(r => {
    if (!r) return;
    if (r.movimentacao && r.movimentacao.expedicao && r.movimentacao.expedicao.peso) {
      pesoExpedicao += parseFloat(r.movimentacao.expedicao.peso) || 0;
    }
    if (r.movimentacao && r.movimentacao.recebimento && r.movimentacao.recebimento.peso) {
      pesoRecebimento += parseFloat(r.movimentacao.recebimento.peso) || 0;
    }
    if (r.cortes && Array.isArray(r.cortes)) cortesList.push(...r.cortes);
    if (r.ocorrencias && Array.isArray(r.ocorrencias)) ocorrenciasCdList.push(...r.ocorrencias);
    if (r.faltas_condutas && Array.isArray(r.faltas_condutas)) faltasColabList.push(...r.faltas_condutas);
  });

  const totalDevValor = devs.reduce((acc, d) => acc + (parseFloat(d.valor_reclamado)||0), 0);
  const qtdDevolucoes = devs.length;
  const corteValor = cortesList.reduce((acc, c) => acc + (parseFloat(c.valor)||0), 0);
  const qtdProdutosCorte = cortesList.length;
  const qtdOcorrenciasCd = ocorrenciasCdList.length;

  const viagensIniciadas = viagens.length;
  const ocTransporteQtd = ocViagens.length;
  const chkNaoRealizado = viagens.filter(v => v.checklist_saida !== 'INICIADO').length;
  const fusionNaoAberto = viagens.filter(v => v.fusion !== 'INICIADO').length;
  const qtdTrocasVeiculos = trocas.length;
  const qtdFaltaColaborador = faltasColabList.length;
  const qtdProblemaMecanico = rotas.length;

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>BOLETIM GERENCIAL LOGÍSTICO — JR DISTRIBUIDORA</title>
  <style>
    @media print {
      @page { margin: 10mm; size: A4 portrait; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #0f172a; background: #ffffff; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0d4722; padding-bottom: 10px; margin-bottom: 15px; }
    .logo { height: 50px; }
    .header-info { text-align: right; }
    .header-info h2 { margin: 0; font-size: 18px; color: #0d4722; font-weight: 800; text-transform: uppercase; }
    .header-info p { margin: 3px 0 0; font-size: 11px; color: #475569; font-weight: 600; }
    .doc-banner { background: #0d4722; color: #ffffff; padding: 8px 12px; text-align: center; font-weight: 800; font-size: 13px; margin-bottom: 18px; border-radius: 6px; }
    
    .section-header { background: #f1f5f9; border-left: 4px solid #10b981; padding: 6px 10px; font-size: 11px; font-weight: 800; text-transform: uppercase; margin-top: 18px; margin-bottom: 10px; color: #0f172a; }
    .section-header-blue { border-left-color: #2563eb; }

    .kpi-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 12px; }
    .kpi-box { border: 1px solid #cbd5e1; padding: 6px 3px; text-align: center; border-radius: 4px; background: #f8fafc; }
    .kpi-num { font-size: 12px; font-weight: 800; color: #0d4722; margin-top: 2px; }
    .kpi-num-red { color: #dc2626; }
    .kpi-num-blue { color: #2563eb; }
    .kpi-label { font-size: 8px; font-weight: 700; color: #64748b; text-transform: uppercase; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; font-size: 9.5px; }
    th { background: #e2e8f0; font-weight: 700; text-transform: uppercase; color: #1e293b; }
    tr:nth-child(even) { background: #f8fafc; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .footer-note { text-align: center; font-size: 9px; color: #94a3b8; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  </style>
</head>
<body>
  <div class="header">
    <img src="./public/logo.png" class="logo" alt="JR Logo">
    <div class="header-info">
      <h2>JR DISTRIBUIDORA</h2>
      <p>Boletim Gerencial Logístico Executivo</p>
    </div>
  </div>

  <div class="doc-banner">
    BOLETIM GERENCIAL LOGÍSTICO ${fDe || fAte ? `(Período: ${fDe || 'Início'} até ${fAte || 'Hoje'})` : '(Período Completo)'} — Emissão: ${new Date().toLocaleDateString('pt-BR')}
  </div>

  <!-- BLOCO 1: MÓDULO CD -->
  <div class="section-header">📦 BLOCO 1: MÓDULO CENTRO DE DISTRIBUIÇÃO (CD)</div>
  <div class="kpi-grid">
    <div class="kpi-box"><div class="kpi-label">Devolução (R$)</div><div class="kpi-num">R$ ${totalDevValor.toFixed(2)}</div></div>
    <div class="kpi-box"><div class="kpi-label">Qtd Devolução</div><div class="kpi-num">${qtdDevolucoes}</div></div>
    <div class="kpi-box"><div class="kpi-label">Corte (R$)</div><div class="kpi-num kpi-num-red">R$ ${corteValor.toFixed(2)}</div></div>
    <div class="kpi-box"><div class="kpi-label">Qtd Prod Corte</div><div class="kpi-num">${qtdProdutosCorte}</div></div>
    <div class="kpi-box"><div class="kpi-label">Peso Expedição</div><div class="kpi-num kpi-num-blue">${pesoExpedicao.toFixed(2)} Kg</div></div>
    <div class="kpi-box"><div class="kpi-label">Peso Recebimento</div><div class="kpi-num">${pesoRecebimento.toFixed(2)} Kg</div></div>
    <div class="kpi-box"><div class="kpi-label">Oc. do CD</div><div class="kpi-num">${qtdOcorrenciasCd}</div></div>
  </div>

  <div style="font-size: 10px; font-weight: bold; margin-bottom: 4px; text-transform: uppercase; color: #0f172a;">Detalhamento de Devoluções CD (${devs.length})</div>
  <table>
    <thead><tr><th>Protocolo</th><th>Cliente</th><th>Motorista</th><th>Rota</th><th>Motivo</th><th class="text-right">Valor</th></tr></thead>
    <tbody>
      ${devs.length===0?'<tr><td colspan="6" class="text-center">Nenhuma devolução no período</td></tr>':
      devs.map(d=>`<tr><td><b>${d.numero_devolucao||d.numero_protocolo}</b></td><td>${d.cliente_nome}</td><td>${d.motorista_nome}</td><td>${d.carga_rota}</td><td>${d.motivo_reclamado}</td><td class="text-right"><b>R$ ${(parseFloat(d.valor_reclamado)||0).toFixed(2)}</b></td></tr>`).join('')}
    </tbody>
  </table>

  <!-- BLOCO 2: MÓDULO TRANSPORTE -->
  <div class="section-header section-header-blue">🚍 BLOCO 2: MÓDULO TRANSPORTE & FROTA</div>
  <div class="kpi-grid">
    <div class="kpi-box"><div class="kpi-label">Viagens Iniciadas</div><div class="kpi-num kpi-num-blue">${viagensIniciadas}</div></div>
    <div class="kpi-box"><div class="kpi-label">Oc. Transporte</div><div class="kpi-num">${ocTransporteQtd}</div></div>
    <div class="kpi-box"><div class="kpi-label">Checklist Ñ Realiz.</div><div class="kpi-num kpi-num-red">${chkNaoRealizado}</div></div>
    <div class="kpi-box"><div class="kpi-label">Fusion Ñ Aberto</div><div class="kpi-num kpi-num-red">${fusionNaoAberto}</div></div>
    <div class="kpi-box"><div class="kpi-label">Trocas Veículos</div><div class="kpi-num">${qtdTrocasVeiculos}</div></div>
    <div class="kpi-box"><div class="kpi-label">Falta Colaborador</div><div class="kpi-num">${qtdFaltaColaborador}</div></div>
    <div class="kpi-box"><div class="kpi-label">Prob. Mecânico</div><div class="kpi-num kpi-num-red">${qtdProblemaMecanico}</div></div>
  </div>

  <div style="font-size: 10px; font-weight: bold; margin-bottom: 4px; text-transform: uppercase; color: #0f172a;">Acompanhamento de Viagens & Largadas (${viagens.length})</div>
  <table>
    <thead><tr><th>Carga</th><th>Rota</th><th>Placa</th><th>Motorista</th><th>Ajudante</th><th>Status</th><th>Fusion</th></tr></thead>
    <tbody>
      ${viagens.length===0?'<tr><td colspan="7" class="text-center">Nenhuma viagem no período</td></tr>':
      viagens.map(v=>`<tr><td><b>${v.carga}</b></td><td>${v.rota}</td><td>${v.placa}</td><td>${v.motorista}</td><td>${v.ajudante}</td><td><b>${v.status_viagem}</b></td><td>${v.fusion}</td></tr>`).join('')}
    </tbody>
  </table>

  <div class="footer-note">JR Distribuidora 2026 – Boletim Gerencial Executivo de Operações Logísticas</div>
  <script>
    window.onload = function() { setTimeout(function(){ window.print(); }, 500); }
  </script>
</body>
</html>`;

  const win = window.open('','_blank','width=950,height=850');
  if (win) {
    win.document.write(htmlContent);
    win.document.close();
  }
}

// MAPA GLOBAL DE COLUNAS POR BANCO DE DADOS
const MODULE_COLUMNS_MAP = {
  devolucoes: [
    { id: 'numero_devolucao', label: 'Protocolo / Nº Dev' },
    { id: 'criado_em', label: 'Data de Abertura' },
    { id: 'cliente_nome', label: 'Nome do Cliente' },
    { id: 'nota_fiscal', label: 'Nota Fiscal (NF)' },
    { id: 'motorista_nome', label: 'Motorista' },
    { id: 'veiculo_placa', label: 'Placa do Veículo' },
    { id: 'carga_rota', label: 'Rota / Região' },
    { id: 'motivo_reclamado', label: 'Motivo Reclamado' },
    { id: 'motivo_real_causa_raiz', label: 'Causa Raiz Apurada' },
    { id: 'tipo_erro', label: 'Tipo de Erro' },
    { id: 'valor_reclamado', label: 'Valor Reclamado (R$)' },
    { id: 'status_gestao', label: 'Status da Gestão' },
    { id: 'destino_cd', label: 'Destino no CD' },
    { id: 'separador_apurado', label: 'Separador' },
    { id: 'conferente_apurado', label: 'Conferente' },
    { id: 'acao_gestor', label: 'Ação do Gestor' }
  ],
  viagens: [
    { id: 'carga', label: 'Carga / Manifesto' },
    { id: 'rota', label: 'Rota / Destino' },
    { id: 'placa', label: 'Placa do Veículo' },
    { id: 'motorista', label: 'Motorista Principal' },
    { id: 'ajudante', label: 'Ajudante' },
    { id: 'data_saida', label: 'Data de Saída' },
    { id: 'hora_saida', label: 'Hora de Saída' },
    { id: 'status_viagem', label: 'Status da Viagem' },
    { id: 'checklist_saida', label: 'Checklist de Saída' },
    { id: 'fusion', label: 'Status Fusion' },
    { id: 'km_inicial', label: 'KM Inicial' },
    { id: 'observacao', label: 'Observações' }
  ],
  rotas: [
    { id: 'numero_protocolo', label: 'Protocolo Chamado' },
    { id: 'criado_em', label: 'Data da Ocorrência' },
    { id: 'veiculo_placa', label: 'Placa do Veículo' },
    { id: 'motorista_nome', label: 'Motorista' },
    { id: 'motivo_resumido', label: 'Motivo / Defeito' },
    { id: 'tipo_ocorrencia', label: 'Tipo Ocorrência' },
    { id: 'status_veiculo', label: 'Status Veículo' },
    { id: 'custo_socorro', label: 'Custo Socorro (R$)' },
    { id: 'veiculo_substituto', label: 'Veículo Substituto' },
    { id: 'local_parada', label: 'Local da Parada' },
    { id: 'oficina_guincho', label: 'Oficina / Guincho' },
    { id: 'acao_corretiva', label: 'Ação Corretiva' }
  ],
  resumos_cd: [
    { id: 'data', label: 'Data Resumo' },
    { id: 'peso_expedicao', label: 'Peso Expedição (Kg)' },
    { id: 'peso_recebimento', label: 'Peso Recebimento (Kg)' },
    { id: 'qtd_cortes', label: 'Qtd Cortes Produtos' },
    { id: 'valor_cortes', label: 'Valor Total Cortes (R$)' },
    { id: 'qtd_ocorrencias_cd', label: 'Ocorrências Internas CD' },
    { id: 'qtd_faltas_colaborador', label: 'Faltas / Ausências' },
    { id: 'observacoes_gerais', label: 'Observações do Dia' }
  ],
  usuarios: [
    { id: 'nome', label: 'Nome Completo' },
    { id: 'login', label: 'Login / Usuário' },
    { id: 'email', label: 'E-mail' },
    { id: 'departamento', label: 'Departamento' },
    { id: 'role', label: 'Perfil / Nível' },
    { id: 'ativo', label: 'Status Ativo' }
  ],
  motoristas: [
    { id: 'nome', label: 'Nome do Motorista' },
    { id: 'cpf', label: 'CPF' },
    { id: 'cnh', label: 'Número CNH' },
    { id: 'categoria_cnh', label: 'Categoria' },
    { id: 'validade_cnh', label: 'Validade CNH' },
    { id: 'status', label: 'Status' }
  ],
  veiculos: [
    { id: 'placa', label: 'Placa' },
    { id: 'modelo', label: 'Modelo' },
    { id: 'marca', label: 'Marca' },
    { id: 'tipo_veiculo', label: 'Tipo Veículo' },
    { id: 'capacidade_kg', label: 'Capacidade (Kg)' },
    { id: 'status', label: 'Status' }
  ],
  clientes: [
    { id: 'codigo', label: 'Código Cliente' },
    { id: 'razao_social', label: 'Razão Social' },
    { id: 'nome_fantasia', label: 'Nome Fantasia' },
    { id: 'cnpj_cpf', label: 'CNPJ / CPF' },
    { id: 'cidade', label: 'Cidade' },
    { id: 'uf', label: 'UF' }
  ]
};

function updateCsvColumnsUI(moduloVal) {
  window._csvModuloSelecionado = moduloVal;
  const container = document.getElementById('csv-columns-grid');
  if (!container) return;
  const cols = MODULE_COLUMNS_MAP[moduloVal] || MODULE_COLUMNS_MAP['devolucoes'];
  container.innerHTML = cols.map(c => `
    <label class="flex items-center gap-2 text-xs text-white cursor-pointer hover:text-emerald-300 transition">
      <input type="checkbox" name="csv-col" value="${c.id}" checked class="text-emerald-500 rounded focus:ring-0">
      <span>${c.label}</span>
    </label>
  `).join('');
}

function toggleSelectAllCsvCols(selectAll) {
  const checkboxes = document.querySelectorAll('input[name="csv-col"]');
  checkboxes.forEach(cb => cb.checked = selectAll);
}

// ===== MÓDULO: BOLETIM GERENCIAL LOGÍSTICO & CENTRAL DE RELATÓRIOS =====
function renderBoletimGerencialView() {
  const fDe = window._boletimFiltroDe || '';
  const fAte = window._boletimFiltroAte || '';

  const allDevs = db.getDevolucoes();
  const allRotas = db.getOcorrenciasRota();
  const allViagens = db.getControleViagens();
  const allOcViagens = db.getOcorrenciasViagens();
  const allTrocas = db.getTrocasVeiculos();

  const devs = allDevs.filter(d => {
    const dt = d.criado_em ? d.criado_em.split('T')[0] : '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  const rotas = allRotas.filter(r => {
    const dt = r.criado_em ? r.criado_em.split('T')[0] : '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  const viagens = allViagens.filter(v => {
    const dt = v.data_saida || '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  const ocViagens = allOcViagens.filter(o => {
    const dt = o.data || '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  const trocas = allTrocas.filter(t => {
    const dt = t.data || '';
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  let resumosCd = Array.isArray(db.data.resumo_diario_cd) ? db.data.resumo_diario_cd : Object.values(db.data.resumo_diario_cd || db.data.resumos_cd || {});
  if (fDe)  resumosCd = resumosCd.filter(r => r && (r.data||'') >= fDe);
  if (fAte) resumosCd = resumosCd.filter(r => r && (r.data||'') <= fAte);

  let pesoExpedicao = 0;
  let pesoRecebimento = 0;
  let cortesList = [];
  let ocorrenciasCdList = [];
  let faltasColabList = [];

  resumosCd.forEach(r => {
    if (!r) return;
    if (r.movimentacao && r.movimentacao.expedicao && r.movimentacao.expedicao.peso) {
      pesoExpedicao += parseFloat(r.movimentacao.expedicao.peso) || 0;
    }
    if (r.movimentacao && r.movimentacao.recebimento && r.movimentacao.recebimento.peso) {
      pesoRecebimento += parseFloat(r.movimentacao.recebimento.peso) || 0;
    }
    if (r.cortes && Array.isArray(r.cortes)) cortesList.push(...r.cortes);
    if (r.ocorrencias && Array.isArray(r.ocorrencias)) ocorrenciasCdList.push(...r.ocorrencias);
    if (r.faltas_condutas && Array.isArray(r.faltas_condutas)) faltasColabList.push(...r.faltas_condutas);
  });

  const totalDevValor = devs.reduce((acc, d) => acc + (parseFloat(d.valor_reclamado)||0), 0);
  const qtdDevolucoes = devs.length;
  const corteValor = cortesList.reduce((acc, c) => acc + (parseFloat(c.valor)||0), 0);
  const qtdProdutosCorte = cortesList.length;
  const qtdOcorrenciasCd = ocorrenciasCdList.length;

  const viagensIniciadas = viagens.length;
  const ocTransporteQtd = ocViagens.length;
  const chkNaoRealizado = viagens.filter(v => v.checklist_saida !== 'INICIADO').length;
  const fusionNaoAberto = viagens.filter(v => v.fusion !== 'INICIADO').length;
  const qtdTrocasVeiculos = trocas.length;
  const qtdFaltaColaborador = faltasColabList.length;
  const qtdProblemaMecanico = rotas.length;

  const activeBolSubTab = window._activeBolSubTab || 'executiva';

  return `
    <div class="space-y-8 max-w-7xl mx-auto pb-12">
      <!-- CABEÇALHO BOLETIM GERENCIAL -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-2xl">
        <div class="flex items-center gap-4">
          <img src="./public/logo.png" alt="JR Logo" class="h-12 w-auto" onerror="this.style.display='none'">
          <div>
            <h1 class="text-xl font-black text-white uppercase tracking-wider flex items-center gap-2">
              <span>📄</span> Boletim Gerencial Logístico & Central de Relatórios
            </h1>
            <p class="text-xs text-slate-400">Consolidação executiva, exportador de dados em CSV customizável e relatórios PDF</p>
          </div>
        </div>

        <!-- SUBABAS BOLETIM GERENCIAL -->
        <div class="flex gap-1 bg-slate-950 border border-slate-800 p-1.5 rounded-xl shadow-lg shrink-0 no-print">
          <button onclick="window._activeBolSubTab='executiva'; renderApp()" class="px-3.5 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition ${activeBolSubTab === 'executiva' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}">
            <span>📊</span> Visão Executiva
          </button>
          <button onclick="window._activeBolSubTab='export_csv'; renderApp()" class="px-3.5 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition ${activeBolSubTab === 'export_csv' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}">
            <span>📥</span> Exportação CSV Custom
          </button>
          <button onclick="window._activeBolSubTab='relatorios_pdf'; renderApp()" class="px-3.5 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition ${activeBolSubTab === 'relatorios_pdf' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}">
            <span>📄</span> Central de PDFs
          </button>
        </div>
      </div>

      ${activeBolSubTab === 'executiva' ? `
        <!-- SUBABA 1: VISÃO EXECUTIVA COMPLETA -->
        <div class="space-y-6">
          <div class="flex justify-between items-center bg-slate-900 border border-slate-800 p-3.5 rounded-xl no-print">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-slate-300 uppercase">Filtrar Período Executivo:</span>
              <input type="date" id="bol-filtro-de" value="${fDe}" onchange="window._boletimFiltroDe=this.value; renderApp()" class="bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
              <span class="text-xs text-slate-500 font-bold">Até</span>
              <input type="date" id="bol-filtro-ate" value="${fAte}" onchange="window._boletimFiltroAte=this.value; renderApp()" class="bg-slate-800 border border-slate-700 text-white rounded p-1 text-xs">
              <button onclick="window._boletimFiltroDe=''; window._boletimFiltroAte=''; renderApp()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold px-2.5 py-1 rounded">Limpar</button>
            </div>
            <button onclick="imprimirBoletimGerencialExecutivo()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold px-4 py-2 rounded-xl text-xs shadow flex items-center gap-1.5">
              <span>🖨️</span> Gerar PDF Executivo
            </button>
          </div>

          <!-- BLOCO 1: MÓDULO CD -->
          <div class="bg-slate-900 border border-emerald-900/60 rounded-2xl p-6 shadow-2xl space-y-6">
            <div class="flex items-center justify-between border-b border-emerald-800/60 pb-3">
              <h2 class="text-base font-black text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <span>📦</span> BLOCO 1: MÓDULO CENTRO DE DISTRIBUIÇÃO (CD)
              </h2>
              <span class="text-xs text-slate-400 font-bold">Resumo Executivo CD</span>
            </div>

            <!-- KPIs DO CD (7 CARDS) -->
            <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Devolução (R$)</div>
                <div class="text-sm font-black text-emerald-400 mt-1">R$ ${totalDevValor.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Qtd Devolução</div>
                <div class="text-base font-black text-white mt-1">${qtdDevolucoes}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Corte (R$)</div>
                <div class="text-sm font-black text-red-400 mt-1">R$ ${corteValor.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Qtd Prod. Corte</div>
                <div class="text-base font-black text-amber-400 mt-1">${qtdProdutosCorte}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Peso Expedição</div>
                <div class="text-xs font-black text-blue-400 mt-1">${pesoExpedicao.toLocaleString('pt-BR',{minimumFractionDigits:2})} Kg</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Peso Recebimento</div>
                <div class="text-xs font-black text-purple-400 mt-1">${pesoRecebimento.toLocaleString('pt-BR',{minimumFractionDigits:2})} Kg</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Oc. do CD</div>
                <div class="text-base font-black text-orange-400 mt-1">${qtdOcorrenciasCd}</div>
              </div>
            </div>

            <!-- TABELA 1: DETALHAMENTO DE DEVOLUÇÃO -->
            <div class="space-y-2">
              <h3 class="text-xs font-bold text-slate-200 uppercase flex items-center gap-1.5">
                <span>📝</span> Detalhamento de Devolução CD (${devs.length})
              </h3>
              <div class="overflow-x-auto rounded-xl border border-slate-800 max-h-56">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase sticky top-0">
                    <tr><th class="p-2">Protocolo</th><th class="p-2">Cliente</th><th class="p-2">Motorista</th><th class="p-2">Rota</th><th class="p-2">Motivo</th><th class="p-2 text-right">Valor</th></tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800">
                    ${devs.length===0?'<tr><td colspan="6" class="p-4 text-center text-slate-500">Nenhuma devolução no período.</td></tr>':
                    devs.map(d => `
                      <tr class="hover:bg-slate-800/40">
                        <td class="p-2 font-bold text-emerald-400">${d.numero_devolucao||d.numero_protocolo}</td>
                        <td class="p-2 text-white">${d.cliente_nome}</td>
                        <td class="p-2 text-slate-300">${d.motorista_nome}</td>
                        <td class="p-2 text-slate-400">${d.carga_rota}</td>
                        <td class="p-2 text-amber-300 font-medium">${d.motivo_reclamado}</td>
                        <td class="p-2 text-right font-bold text-emerald-400">R$ ${(parseFloat(d.valor_reclamado)||0).toFixed(2)}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- TABELA 2: DETALHAMENTO DE CORTE -->
            <div class="space-y-2">
              <h3 class="text-xs font-bold text-slate-200 uppercase flex items-center gap-1.5">
                <span>✂️</span> Detalhamento de Corte (${cortesList.length})
              </h3>
              <div class="overflow-x-auto rounded-xl border border-slate-800 max-h-56">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase sticky top-0">
                    <tr><th class="p-2">Cód Item</th><th class="p-2">Descrição do Produto</th><th class="p-2 text-center">Quantidade</th><th class="p-2 text-right">Valor Total</th></tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800">
                    ${cortesList.length===0?'<tr><td colspan="4" class="p-4 text-center text-slate-500">Nenhum corte registrado no período.</td></tr>':
                    cortesList.map(c => `
                      <tr class="hover:bg-slate-800/40">
                        <td class="p-2 font-bold text-emerald-400">${c.codigo_item}</td>
                        <td class="p-2 font-bold text-white uppercase">${c.descricao}</td>
                        <td class="p-2 text-center font-bold text-amber-300">${c.quantidade}</td>
                        <td class="p-2 text-right font-bold text-red-400">R$ ${(parseFloat(c.valor)||0).toFixed(2)}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- TABELA 3: DETALHAMENTO DAS OCORRÊNCIAS DO CD -->
            <div class="space-y-2">
              <h3 class="text-xs font-bold text-slate-200 uppercase flex items-center gap-1.5">
                <span>📢</span> Detalhamento das Ocorrências do CD (${ocorrenciasCdList.length})
              </h3>
              <div class="overflow-x-auto rounded-xl border border-slate-800 max-h-56">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase sticky top-0">
                    <tr><th class="p-2">Ocorrência</th><th class="p-2">Causa / Detalhamento</th><th class="p-2">Ação Tomada</th></tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800">
                    ${ocorrenciasCdList.length===0?'<tr><td colspan="3" class="p-4 text-center text-slate-500">Nenhuma ocorrência do CD registrada no período.</td></tr>':
                    ocorrenciasCdList.map(o => `
                      <tr class="hover:bg-slate-800/40">
                        <td class="p-2 font-bold text-white uppercase">${o.ocorrencia}</td>
                        <td class="p-2 text-slate-300">${o.causa}</td>
                        <td class="p-2 text-emerald-300 font-medium">${o.acao}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- BLOCO 2: MÓDULO TRANSPORTE -->
          <div class="bg-slate-900 border border-blue-900/60 rounded-2xl p-6 shadow-2xl space-y-6">
            <div class="flex items-center justify-between border-b border-blue-800/60 pb-3">
              <h2 class="text-base font-black text-blue-400 uppercase tracking-wider flex items-center gap-2">
                <span>🚍</span> BLOCO 2: MÓDULO TRANSPORTE & FROTA
              </h2>
              <span class="text-xs text-slate-400 font-bold">Resumo Executivo Transporte</span>
            </div>

            <!-- KPIs DO TRANSPORTE (7 CARDS) -->
            <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Viagens Iniciadas</div>
                <div class="text-base font-black text-emerald-400 mt-1">${viagensIniciadas}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Oc. Transporte</div>
                <div class="text-base font-black text-amber-400 mt-1">${ocTransporteQtd}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Checklist Pend.</div>
                <div class="text-base font-black ${chkNaoRealizado>0?'text-red-400':'text-slate-300'} mt-1">${chkNaoRealizado}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Fusion Pend.</div>
                <div class="text-base font-black ${fusionNaoAberto>0?'text-red-400':'text-slate-300'} mt-1">${fusionNaoAberto}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Trocas Veículos</div>
                <div class="text-base font-black text-purple-400 mt-1">${qtdTrocasVeiculos}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Falta Colaborador</div>
                <div class="text-base font-black text-orange-400 mt-1">${qtdFaltaColaborador}</div>
              </div>
              <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
                <div class="text-[10px] text-slate-400 font-bold uppercase">Prob. Mecânico</div>
                <div class="text-base font-black ${qtdProblemaMecanico>0?'text-red-400':'text-slate-300'} mt-1">${qtdProblemaMecanico}</div>
              </div>
            </div>

            <!-- TABELA 4: DETALHAMENTO DAS OCORRÊNCIAS OPERACIONAIS -->
            <div class="space-y-2">
              <h3 class="text-xs font-bold text-slate-200 uppercase flex items-center gap-1.5">
                <span>⚠️</span> Detalhamento das Ocorrências Operacionais (${ocViagens.length})
              </h3>
              <div class="overflow-x-auto rounded-xl border border-slate-800 max-h-56">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase sticky top-0">
                    <tr><th class="p-2">Data</th><th class="p-2">Carga</th><th class="p-2">Rota / Placa</th><th class="p-2">Funcionário</th><th class="p-2">Motivo</th><th class="p-2">Ocorrência & Ação</th></tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800">
                    ${ocViagens.length===0?'<tr><td colspan="6" class="p-4 text-center text-slate-500">Nenhuma ocorrência operacional registrada no período.</td></tr>':
                    ocViagens.map(o => `
                      <tr class="hover:bg-slate-800/40">
                        <td class="p-2 text-slate-400">${o.data}</td>
                        <td class="p-2 font-bold text-emerald-400">${o.carga}</td>
                        <td class="p-2 text-white">${o.rota} (${o.placa})</td>
                        <td class="p-2 text-slate-300">${o.funcionario} (${o.funcao})</td>
                        <td class="p-2 font-bold text-amber-300">${o.motivo}</td>
                        <td class="p-2 text-slate-300">${o.ocorrencia}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- TABELA 5: DETALHAMENTO DOS PROBLEMAS MECÂNICOS -->
            <div class="space-y-2">
              <h3 class="text-xs font-bold text-slate-200 uppercase flex items-center gap-1.5">
                <span>🔧</span> Detalhamento dos Problemas Mecânicos (${rotas.length})
              </h3>
              <div class="overflow-x-auto rounded-xl border border-slate-800 max-h-56">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase sticky top-0">
                    <tr><th class="p-2">Protocolo</th><th class="p-2">Placa</th><th class="p-2">Motorista</th><th class="p-2">Motivo</th><th class="p-2">Status Veículo</th><th class="p-2 text-right">Custo Socorro</th></tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800">
                    ${rotas.length===0?'<tr><td colspan="6" class="p-4 text-center text-slate-500">Nenhum problema mecânico registrado no período.</td></tr>':
                    rotas.map(r => `
                      <tr class="hover:bg-slate-800/40">
                        <td class="p-2 font-bold text-red-400">${r.numero_protocolo}</td>
                        <td class="p-2 font-bold text-white">${r.veiculo_placa}</td>
                        <td class="p-2 text-slate-300">${r.motorista_nome}</td>
                        <td class="p-2 text-amber-300 font-bold">${r.motivo_resumido||r.tipo_ocorrencia}</td>
                        <td class="p-2 font-bold text-amber-400">${r.status_veiculo||'Aguardando Manutenção'}</td>
                        <td class="p-2 text-right font-bold text-emerald-400">R$ ${(parseFloat(r.custo_socorro)||0).toFixed(2)}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- TABELA 6: DETALHAMENTO DAS FALTAS DO COLABORADOR -->
            <div class="space-y-2">
              <h3 class="text-xs font-bold text-slate-200 uppercase flex items-center gap-1.5">
                <span>👤</span> Detalhamento das Faltas e Ausências (${faltasColabList.length})
              </h3>
              <div class="overflow-x-auto rounded-xl border border-slate-800 max-h-56">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase sticky top-0">
                    <tr><th class="p-2">Nome Colaborador</th><th class="p-2">Conduta / Ausência</th><th class="p-2 text-center">Avisado Previamente?</th><th class="p-2 text-center">Período</th><th class="p-2 text-center">Vai Compensar?</th></tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800">
                    ${faltasColabList.length===0?'<tr><td colspan="5" class="p-4 text-center text-slate-500">Nenhuma falta de colaborador registrada no período.</td></tr>':
                    faltasColabList.map(f => `
                      <tr class="hover:bg-slate-800/40">
                        <td class="p-2 font-bold text-white uppercase">${f.nome}</td>
                        <td class="p-2 text-amber-300 font-bold">${f.conduta}</td>
                        <td class="p-2 text-center font-bold ${f.avisado==='SIM'?'text-emerald-400':'text-red-400'}">${f.avisado}</td>
                        <td class="p-2 text-center text-slate-300">${f.periodo||'Integral'}</td>
                        <td class="p-2 text-center text-slate-300">${f.compensar||'NÃO'}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>`
      : activeBolSubTab === 'export_csv' ? `
        <!-- SUBABA 2: EXPORTAÇÃO PERSONALIZADA CSV -->
        <div class="bg-slate-900 border border-blue-900/60 rounded-2xl p-6 shadow-2xl space-y-6">
          <div class="border-b border-slate-800 pb-3">
            <h2 class="text-base font-black text-blue-400 uppercase tracking-wider flex items-center gap-2">
              <span>📥</span> Exportação Customizada em CSV / Excel
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">Monte seu próprio relatório escolhendo as colunas, o módulo e o período exato</p>
          </div>

          <form onsubmit="handleExportCsvSubmit(event)" class="space-y-6">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="block text-xs font-bold text-slate-300 mb-1">Selecione o Banco de Dados / Módulo *</label>
                <select id="csv-modulo" onchange="updateCsvColumnsUI(this.value)" required class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs font-bold">
                  <option value="devolucoes" ${(!window._csvModuloSelecionado || window._csvModuloSelecionado==='devolucoes')?'selected':''}>Devoluções / Ocorrências SAC</option>
                  <option value="viagens" ${(window._csvModuloSelecionado==='viagens')?'selected':''}>Controle de Viagens / Frota</option>
                  <option value="rotas" ${(window._csvModuloSelecionado==='rotas')?'selected':''}>Chamados de Frota em Rota (Socorro)</option>
                  <option value="resumos_cd" ${(window._csvModuloSelecionado==='resumos_cd')?'selected':''}>Resumos Diários do CD</option>
                  <option value="usuarios" ${(window._csvModuloSelecionado==='usuarios')?'selected':''}>Cadastro de Usuários</option>
                  <option value="motoristas" ${(window._csvModuloSelecionado==='motoristas')?'selected':''}>Cadastro de Motoristas</option>
                  <option value="veiculos" ${(window._csvModuloSelecionado==='veiculos')?'selected':''}>Frota de Veículos</option>
                  <option value="clientes" ${(window._csvModuloSelecionado==='clientes')?'selected':''}>Cadastro de Clientes</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-300 mb-1">Período De (Opcional)</label>
                <input type="date" id="csv-data-de" value="${fDe}" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs">
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-300 mb-1">Período Até (Opcional)</label>
                <input type="date" id="csv-data-ate" value="${fAte}" class="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs">
              </div>
            </div>

            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="block text-xs font-bold text-emerald-400">Selecione as Colunas do Banco de Dados para Extração:</label>
                <div class="flex gap-2 text-[10px] font-bold">
                  <button type="button" onclick="toggleSelectAllCsvCols(true)" class="text-blue-400 hover:underline">Selecionar Todas</button>
                  <span class="text-slate-600">|</span>
                  <button type="button" onclick="toggleSelectAllCsvCols(false)" class="text-slate-400 hover:underline">Desmarcar Todas</button>
                </div>
              </div>
              <div id="csv-columns-grid" class="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                ${(MODULE_COLUMNS_MAP[window._csvModuloSelecionado || 'devolucoes'] || MODULE_COLUMNS_MAP['devolucoes']).map(c => `
                  <label class="flex items-center gap-2 text-xs text-white cursor-pointer hover:text-emerald-300 transition">
                    <input type="checkbox" name="csv-col" value="${c.id}" checked class="text-emerald-500 rounded focus:ring-0">
                    <span>${c.label}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-extrabold py-3 rounded-xl shadow-lg transition flex items-center justify-center gap-2 text-sm">
              <span>📥</span> Baixar Relatório Extraído do Banco em CSV (.csv)
            </button>
          </form>
        </div>`
      : `
        <!-- SUBABA 3: CENTRAL DE RELATÓRIOS PDF -->
        <div class="bg-slate-900 border border-purple-900/60 rounded-2xl p-6 shadow-2xl space-y-6">
          <div class="border-b border-slate-800 pb-3">
            <h2 class="text-base font-black text-purple-400 uppercase tracking-wider flex items-center gap-2">
              <span>📄</span> Central de Relatórios em PDF
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">Acesso unificado a todas as impressões e relatórios executivos com escolha de filtros customizáveis</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- CARD 1 -->
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div class="text-xs font-black text-emerald-400 uppercase">📊 Boletim Executivo Completo</div>
                <div class="text-[11px] text-slate-400 mt-1">Relatório executivo impresso com KPIs consolidados do CD e da Frota de Transporte.</div>
              </div>
              <button onclick="openPdfFilterModal('boletim_executivo')" class="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-2 rounded-lg text-xs shadow flex items-center justify-center gap-1">
                <span>🖨️</span> Gerar Boletim (PDF)
              </button>
            </div>

            <!-- CARD 2 -->
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div class="text-xs font-black text-amber-400 uppercase">📄 Vale Motorista (Notificação)</div>
                <div class="text-[11px] text-slate-400 mt-1">Notificação de erro com comprovante de ciência para motoristas e prestadores.</div>
              </div>
              <button onclick="openPdfFilterModal('vale_motorista')" class="w-full bg-amber-700 hover:bg-amber-600 text-white font-bold py-2 rounded-lg text-xs shadow flex items-center justify-center gap-1">
                <span>📄</span> Emitir Vale Motorista
              </button>
            </div>

            <!-- CARD 3 -->
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div class="text-xs font-black text-blue-400 uppercase">📋 Boletim Operacional Diário</div>
                <div class="text-[11px] text-slate-400 mt-1">Impressão sintética do diário operacional com devoluções e chamados do dia.</div>
              </div>
              <button onclick="openPdfFilterModal('boletim_operacional')" class="w-full bg-blue-700 hover:bg-blue-600 text-white font-bold py-2 rounded-lg text-xs shadow flex items-center justify-center gap-1">
                <span>🖨️</span> Imprimir Diário Operacional
              </button>
            </div>

            <!-- CARD 4 -->
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div class="text-xs font-black text-purple-400 uppercase">📊 Relatório Geral de Ocorrências</div>
                <div class="text-[11px] text-slate-400 mt-1">Extrato detalhado de todas as ocorrências de SAC com apurações e causas raiz.</div>
              </div>
              <button onclick="openPdfFilterModal('relatorio_ocorrencias')" class="w-full bg-purple-700 hover:bg-purple-600 text-white font-bold py-2 rounded-lg text-xs shadow flex items-center justify-center gap-1">
                <span>📄</span> Gerar Relatório Ocorrências
              </button>
            </div>

            <!-- CARD 5 -->
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div class="text-xs font-black text-orange-400 uppercase">🏭 Resumo Diário do CD (PDF)</div>
                <div class="text-[11px] text-slate-400 mt-1">Relatório impresso das movimentações de estoque, recebimentos e expedições do CD.</div>
              </div>
              <button onclick="openPdfFilterModal('boletim_operacional')" class="w-full bg-orange-700 hover:bg-orange-600 text-white font-bold py-2 rounded-lg text-xs shadow flex items-center justify-center gap-1">
                <span>📄</span> Gerar Resumo CD (PDF)
              </button>
            </div>

            <!-- CARD 6 -->
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div class="text-xs font-black text-red-400 uppercase">⚠️ Divergências Físicas do CD</div>
                <div class="text-[11px] text-slate-400 mt-1">Relatório de quantidades faltantes e divergências constatadas na portaria do CD.</div>
              </div>
              <button onclick="openPdfFilterModal('divergencia_cd')" class="w-full bg-red-700 hover:bg-red-600 text-white font-bold py-2 rounded-lg text-xs shadow flex items-center justify-center gap-1">
                <span>📄</span> Relatório de Divergências
              </button>
            </div>
          </div>
        </div>`}
    </div>`;
}



function handleExportCsvSubmit(e) {
  e.preventDefault();
  const modulo = document.getElementById('csv-modulo')?.value || 'devolucoes';
  const fDe = document.getElementById('csv-data-de')?.value || '';
  const fAte = document.getElementById('csv-data-ate')?.value || '';

  const checkboxes = document.querySelectorAll('input[name="csv-col"]:checked');
  const colsSelecionadas = Array.from(checkboxes).map(c => c.value);

  if (colsSelecionadas.length === 0) {
    alert('Selecione pelo menos uma coluna para exportar!');
    return;
  }

  let rawData = [];
  if (modulo === 'devolucoes') rawData = db.getDevolucoes();
  else if (modulo === 'viagens') rawData = db.getControleViagens();
  else if (modulo === 'rotas') rawData = db.getOcorrenciasRota();
  else if (modulo === 'resumos_cd') rawData = Array.isArray(db.data.resumo_diario_cd) ? db.data.resumo_diario_cd : Object.values(db.data.resumo_diario_cd||{});
  else if (modulo === 'usuarios') rawData = db.getUsuarios();
  else if (modulo === 'motoristas') rawData = db.getMotoristas();
  else if (modulo === 'veiculos') rawData = db.getVeiculos();
  else if (modulo === 'clientes') rawData = db.getClientes();

  // Filtrar período se especificado
  let dadosFiltrados = rawData.filter(item => {
    const dt = item.criado_em ? item.criado_em.split('T')[0] : (item.data || item.data_saida || '');
    if (!dt) return true;
    if (fDe && dt < fDe) return false;
    if (fAte && dt > fAte) return false;
    return true;
  });

  if (dadosFiltrados.length === 0) {
    alert('Nenhum dado encontrado no banco de dados para a seleção especificada.');
    return;
  }

  const moduleColsDef = MODULE_COLUMNS_MAP[modulo] || MODULE_COLUMNS_MAP['devolucoes'];
  const headerMap = {};
  moduleColsDef.forEach(c => headerMap[c.id] = c.label);

  const csvRows = [];
  csvRows.push(colsSelecionadas.map(c => `"${headerMap[c] || c}"`).join(';'));

  dadosFiltrados.forEach(row => {
    const line = colsSelecionadas.map(c => {
      let val = '';
      if (modulo === 'resumos_cd') {
        if (c === 'data') val = row.data || '';
        else if (c === 'peso_expedicao') val = row.movimentacao?.expedicao?.peso || 0;
        else if (c === 'peso_recebimento') val = row.movimentacao?.recebimento?.peso || 0;
        else if (c === 'qtd_cortes') val = Array.isArray(row.cortes) ? row.cortes.length : 0;
        else if (c === 'valor_cortes') val = Array.isArray(row.cortes) ? row.cortes.reduce((acc, cr) => acc + (parseFloat(cr.valor)||0), 0) : 0;
        else if (c === 'qtd_ocorrencias_cd') val = Array.isArray(row.ocorrencias) ? row.ocorrencias.length : 0;
        else if (c === 'qtd_faltas_colaborador') val = Array.isArray(row.faltas_condutas) ? row.faltas_condutas.length : 0;
        else if (c === 'observacoes_gerais') val = row.observacoes || '';
        else val = row[c] !== undefined ? row[c] : '';
      } else {
        val = row[c];
      }

      if (val === undefined || val === null) val = '';
      if (typeof val === 'number') val = val.toFixed(2).replace('.', ',');
      if (typeof val === 'string') val = val.replace(/"/g, '""');
      return `"${val}"`;
    }).join(';');
    csvRows.push(line);
  });

  const csvString = '\uFEFF' + csvRows.join('\r\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `JR_SAC_Banco_Dados_${modulo}_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function promptEGerarValeMotorista() {
  const devs = db.getDevolucoes().filter(d => d.tipo_erro === 'ERRO MOTORISTA' || d.motorista_nome);
  if (devs.length === 0) {
    alert('Nenhuma ocorrência associada a motorista encontrada.');
    return;
  }
  const id = prompt(`Digite o ID/Protocolo da ocorrência para gerar o Vale Motorista:\nExemplos disponíveis:\n` + devs.slice(0,5).map(d => `${d.id} (${d.numero_devolucao||d.numero_protocolo} - ${d.motorista_nome})`).join('\n'));
  if (id) {
    gerarValeMotoristaPdf(id.trim());
  }
}

function baixarUltimoRelatorioDivergencia() {
  const rels = db.data.relatorios_divergencia || [];
  if (rels.length === 0) {
    alert('Nenhum relatório de divergência registrado até o momento.');
    return;
  }
  baixarRelatorioDivergencia(rels[rels.length - 1]);
}

function openPdfFilterModal(pdfType) {
  const modal = document.getElementById('modal-container');
  if (!modal) return;

  const motoristas = db.data.motoristas || [];
  const rotas = db.data.rotas || [];
  const veiculos = db.data.veiculos || [];
  const devList = db.getDevolucoes();
  const relsDivergencia = db.data.relatorios_divergencia || [];

  let title = 'Filtros para Geração de PDF';
  let fieldsHtml = '';

  if (pdfType === 'boletim_executivo') {
    title = '📊 Filtros do Boletim Gerencial Executivo';
    fieldsHtml = `
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1">Data Inicial (De):</label>
          <input type="date" id="pdf-filter-de" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1">Data Final (Até):</label>
          <input type="date" id="pdf-filter-ate" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
        </div>
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-300 mb-1">Filtrar por Rota:</label>
        <select id="pdf-filter-rota" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
          <option value="">-- Todas as Rotas --</option>
          ${rotas.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-300 mb-1">Filtrar por Motorista:</label>
        <select id="pdf-filter-motorista" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
          <option value="">-- Todos os Motoristas --</option>
          ${motoristas.map(m => `<option value="${m.nome}">${m.nome}</option>`).join('')}
        </select>
      </div>
      <div class="pt-3">
        <button onclick="confirmarEGerarPdf('boletim_executivo')" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-2.5 rounded-lg text-xs shadow flex items-center justify-center gap-2">
          <span>🖨️</span> Confirmar e Gerar PDF Executivo
        </button>
      </div>`;
  } else if (pdfType === 'relatorio_ocorrencias') {
    title = '📄 Filtros do Relatório Geral de Ocorrências';
    fieldsHtml = `
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1">Data Inicial (De):</label>
          <input type="date" id="pdf-filter-de" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1">Data Final (Até):</label>
          <input type="date" id="pdf-filter-ate" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
        </div>
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-300 mb-1">Filtrar por Status:</label>
        <select id="pdf-filter-status" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
          <option value="">-- Todos os Status --</option>
          <option value="PENDENTE_FISICO">Pendente Físico CD</option>
          <option value="PENDENTE_INVESTIGACAO">Pendente Investigação</option>
          <option value="RESOLVIDO">Apurado / Concluído</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-300 mb-1">Filtrar por Rota:</label>
        <select id="pdf-filter-rota" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
          <option value="">-- Todas as Rotas --</option>
          ${rotas.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div class="pt-3">
        <button onclick="confirmarEGerarPdf('relatorio_ocorrencias')" class="w-full bg-purple-600 hover:bg-purple-500 text-white font-extrabold py-2.5 rounded-lg text-xs shadow flex items-center justify-center gap-2">
          <span>📄</span> Confirmar e Gerar PDF de Ocorrências
        </button>
      </div>`;
  } else if (pdfType === 'boletim_operacional') {
    title = '📋 Filtros do Diário Operacional (CD & Transporte)';
    fieldsHtml = `
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1">Data Inicial (De):</label>
          <input type="date" id="pdf-filter-de" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1">Data Final (Até):</label>
          <input type="date" id="pdf-filter-ate" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
        </div>
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-300 mb-1">Filtrar por Veículo / Placa:</label>
        <select id="pdf-filter-veiculo" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs">
          <option value="">-- Todos os Veículos --</option>
          ${veiculos.map(v => `<option value="${v.placa}">${v.placa} (${v.modelo})</option>`).join('')}
        </select>
      </div>
      <div class="pt-3">
        <button onclick="confirmarEGerarPdf('boletim_operacional')" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-extrabold py-2.5 rounded-lg text-xs shadow flex items-center justify-center gap-2">
          <span>🖨️</span> Confirmar e Imprimir Diário
        </button>
      </div>`;
  } else if (pdfType === 'vale_motorista') {
    title = '📄 Seleção de Ocorrência para Vale Motorista';
    fieldsHtml = `
      <div>
        <label class="block text-xs font-bold text-slate-300 mb-1">Selecione a Ocorrência:</label>
        <select id="pdf-filter-dev-id" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          ${devList.length === 0 ? `<option value="">Nenhuma ocorrência registrada</option>` :
            devList.map(d => `<option value="${d.id}">${d.numero_devolucao || d.numero_protocolo} — ${d.motorista_nome || 'Sem Motorista'} (${d.cliente_nome})</option>`).join('')}
        </select>
      </div>
      <div class="pt-3">
        <button onclick="confirmarEGerarPdf('vale_motorista')" class="w-full bg-amber-600 hover:bg-amber-500 text-white font-extrabold py-2.5 rounded-lg text-xs shadow flex items-center justify-center gap-2">
          <span>📄</span> Emitir Vale Motorista (PDF)
        </button>
      </div>`;
  } else if (pdfType === 'divergencia_cd') {
    title = '⚠️ Seleção de Relatório de Divergência Física';
    fieldsHtml = `
      <div>
        <label class="block text-xs font-bold text-slate-300 mb-1">Selecione a Conferência / Devolução com Divergência:</label>
        <select id="pdf-filter-rel-idx" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs font-bold">
          ${relsDivergencia.length === 0 ? `<option value="">Nenhum relatório registrado</option>` :
            relsDivergencia.map((r, idx) => `<option value="${idx}">${r.numero_devolucao || r.protocolo} — ${r.motorista} (Data: ${new Date(r.gerado_em).toLocaleDateString('pt-BR')})</option>`).join('')}
        </select>
      </div>
      <div class="pt-3">
        <button onclick="confirmarEGerarPdf('divergencia_cd')" class="w-full bg-red-600 hover:bg-red-500 text-white font-extrabold py-2.5 rounded-lg text-xs shadow flex items-center justify-center gap-2">
          <span>📄</span> Gerar Relatório de Divergência (PDF)
        </button>
      </div>`;
  }

  modal.innerHTML = `
    <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-fadeIn">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 class="text-sm font-extrabold text-white flex items-center gap-2">${title}</h3>
          <button onclick="closeModal()" class="text-slate-400 hover:text-white text-lg font-bold">✕</button>
        </div>
        <div class="space-y-3">
          ${fieldsHtml}
        </div>
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

function confirmarEGerarPdf(pdfType) {
  const fDe = document.getElementById('pdf-filter-de')?.value || '';
  const fAte = document.getElementById('pdf-filter-ate')?.value || '';
  const rota = document.getElementById('pdf-filter-rota')?.value || '';
  const motorista = document.getElementById('pdf-filter-motorista')?.value || '';
  const status = document.getElementById('pdf-filter-status')?.value || '';
  const veiculo = document.getElementById('pdf-filter-veiculo')?.value || '';
  const devId = document.getElementById('pdf-filter-dev-id')?.value || '';
  const relIdx = document.getElementById('pdf-filter-rel-idx')?.value || '';

  closeModal();

  if (pdfType === 'boletim_executivo') {
    if (fDe) window._boletimFiltroDe = fDe;
    if (fAte) window._boletimFiltroAte = fAte;
    imprimirBoletimGerencialExecutivo();
  } else if (pdfType === 'relatorio_ocorrencias') {
    gerarRelatorioOcorrenciasPdfComFiltro({ fDe, fAte, rota, status, motorista });
  } else if (pdfType === 'boletim_operacional') {
    imprimirBoletimOperacionalComFiltro({ fDe, fAte, veiculo });
  } else if (pdfType === 'vale_motorista') {
    if (devId) gerarValeMotoristaPdf(devId);
    else alert('Selecione uma ocorrência válida.');
  } else if (pdfType === 'divergencia_cd') {
    const rels = db.data.relatorios_divergencia || [];
    if (relIdx !== '' && rels[relIdx]) {
      baixarRelatorioDivergencia(rels[relIdx]);
    } else {
      alert('Nenhum relatório selecionado.');
    }
  }
}

function gerarRelatorioOcorrenciasPdfComFiltro(filtros) {
  let devs = db.getDevolucoes();
  if (filtros.fDe) devs = devs.filter(d => (d.criado_em || d.data_abertura || '').split('T')[0] >= filtros.fDe);
  if (filtros.fAte) devs = devs.filter(d => (d.criado_em || d.data_abertura || '').split('T')[0] <= filtros.fAte);
  if (filtros.rota) devs = devs.filter(d => (d.carga_rota || '') === filtros.rota);
  if (filtros.status) devs = devs.filter(d => (d.status_fechamento || d.status || '') === filtros.status);
  if (filtros.motorista) devs = devs.filter(d => (d.motorista_nome || '') === filtros.motorista);

  if (typeof gerarDocumentoImpressaoRelatorio === 'function') {
    gerarDocumentoImpressaoRelatorio(devs, 'Relatório Geral de Ocorrências (SAC & Apuração)');
  } else {
    window.print();
  }
}

function imprimirBoletimOperacionalComFiltro(filtros) {
  let rCD = Array.isArray(db.data.resumo_diario_cd) ? db.data.resumo_diario_cd : Object.values(db.data.resumo_diario_cd || db.data.resumos_cd || {});
  if (filtros.fDe) rCD = rCD.filter(r => r && (r.data || '') >= filtros.fDe);
  if (filtros.fAte) rCD = rCD.filter(r => r && (r.data || '') <= filtros.fAte);

  imprimirBoletimOperacional();
}

