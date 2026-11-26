// =============================================================================
// PLANO DE AÇÃO (v7.9.0, migration 84) — Visão Geral → Plano de Ação
// =============================================================================
// Substitui a planilha "Plano de Ação" da Reunião de Manutenção Quinzenal, mas
// vale para QUALQUER ação de qualquer origem. Plano: PLANO_ABA_PLANO_DE_ACAO.md.
//
// Mesmo modelo do Cross Palmas: lê da nuvem quando a tela abre (relê a cada
// 2 min) e grava direto no PostgREST. Nada aqui passa pelo pull do cloudStore
// nem pelo localStorage — não pesa no egress nem na cota do aparelho. Para
// salvar precisa de internet.
//
// Tabelas: pa_acoes, pa_etapas, pa_eventos (linha do tempo, só inclusão) e
// pa_areas (área → responsável sugerido). Fotos no bucket plano-acao-fotos.
//
// Regras (decididas pelo Tiago em 26/11/2026):
//   - ATRASADA é calculada: Não iniciada ou Em andamento com prazo < hoje.
//     Aguardando com prazo vencido NÃO vira Atrasada (separa "travada por
//     terceiro" de "devendo"); Em validação, Realizada e Cancelada nunca.
//   - Tempo (dias), igual à planilha: aberta = prazo − hoje; realizada =
//     prazo − data realizada; cancelada = vazio. Verde > 2, amarelo 0..2,
//     vermelho < 0.
//   - Responsável: usuário cadastrado OU nome digitado. Quem não tem login
//     entra em "Pessoas sem acesso".
//   - Sem travas: todos criam e editam tudo.
//   - Até 5 fotos por etapa e por atualização.
// =============================================================================

window._pa = window._pa || {
  acoes: null, etapas: [], eventos: [], areas: [],
  carregando: false, carregadoEm: 0, erro: '',
  filtros: { campoData: 'prazo', de: '', ate: '', status: '', resp: '', area: '', busca: '' },
  verEtapas: true, verTempo: true,
  fichaId: null,
  ocupado: false
};

const PA_BUCKET = 'plano-acao-fotos';
const PA_MAX_FOTOS = 5;
const PA_LOGO = './public/logo_jr_verde.png';

const PA_STATUS = {
  NAO_INICIADA: { label: 'Não iniciada', cls: 'bg-slate-800 text-slate-200 border-slate-600', xls: 'FFE2E8F0', pdf: '#e2e8f0' },
  EM_ANDAMENTO: { label: 'Em andamento', cls: 'bg-sky-950 text-sky-300 border-sky-700', xls: 'FFBAE6FD', pdf: '#bae6fd' },
  AGUARDANDO:   { label: 'Aguardando',   cls: 'bg-amber-950 text-amber-300 border-amber-700', xls: 'FFFDE68A', pdf: '#fde68a' },
  EM_VALIDACAO: { label: 'Em validação', cls: 'bg-violet-950 text-violet-300 border-violet-700', xls: 'FFDDD6FE', pdf: '#ddd6fe' },
  REALIZADA:    { label: 'Realizada',    cls: 'bg-emerald-950 text-emerald-300 border-emerald-700', xls: 'FFBBF7D0', pdf: '#bbf7d0' },
  CANCELADA:    { label: 'Cancelada',    cls: 'bg-zinc-800 text-zinc-400 border-zinc-600', xls: 'FFD4D4D8', pdf: '#d4d4d8' },
  ATRASADA:     { label: 'Atrasada',     cls: 'bg-red-950 text-red-300 border-red-700', xls: 'FFFECACA', pdf: '#fecaca' }
};
const PA_STATUS_GRAVAVEIS = ['NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO', 'EM_VALIDACAO', 'REALIZADA', 'CANCELADA'];
const PA_ORDEM_CARDS = ['ATRASADA', 'NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO', 'EM_VALIDACAO', 'REALIZADA', 'CANCELADA'];
const PA_BTN = 'px-3 py-1.5 rounded font-bold text-xs shadow transition';
const PA_INPUT = 'bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs w-full';

// -----------------------------------------------------------------------------
// UTILITÁRIOS
// -----------------------------------------------------------------------------
function paEsc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function paNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function paUsuario() {
  return (typeof db !== 'undefined' && db.currentUser && db.currentUser.nome) ? db.currentUser.nome : 'SISTEMA';
}
function paHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function paAgora() {
  return (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString();
}
function paNovoId() {
  return (typeof db !== 'undefined' && typeof db.gerarIdUnico === 'function') ? db.gerarIdUnico() : Date.now() * 100 + Math.floor(Math.random() * 100);
}
function paData(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(iso);
}
function paDataHora(iso) {
  if (!iso) return '';
  const s = String(iso).replace(' ', 'T');
  return `${paData(s)} ${s.slice(11, 16)}`;
}
function paDias(a, b) {
  // b − a em dias (datas YYYY-MM-DD, sem fuso)
  const pa = String(a).slice(0, 10).split('-').map(Number);
  const pb = String(b).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function paCodigo(a) {
  return a && a.numero ? `PA-${String(a.numero).padStart(3, '0')}` : 'PA-novo';
}
function paStatusEfetivo(a) {
  if (!a) return 'NAO_INICIADA';
  if ((a.status === 'NAO_INICIADA' || a.status === 'EM_ANDAMENTO') && a.prazo && String(a.prazo).slice(0, 10) < paHoje()) return 'ATRASADA';
  return a.status;
}
function paPrazoVencidoAguardando(a) {
  return a && a.status === 'AGUARDANDO' && a.prazo && String(a.prazo).slice(0, 10) < paHoje();
}
// Tempo da planilha: positivo = folga, negativo = atraso.
function paTempo(a) {
  if (!a || !a.prazo || a.status === 'CANCELADA') return null;
  if (a.status === 'REALIZADA') return a.data_realizada ? paDias(a.data_realizada, a.prazo) : null;
  return paDias(paHoje(), a.prazo);
}
function paTempoCls(t) {
  if (t === null) return 'text-slate-500';
  if (t > 2) return 'bg-emerald-950 text-emerald-300 border-emerald-700';
  if (t >= 0) return 'bg-amber-950 text-amber-300 border-amber-700';
  return 'bg-red-950 text-red-300 border-red-700';
}
function paSelo(st, extra) {
  const m = PA_STATUS[st] || PA_STATUS.NAO_INICIADA;
  return `<span class="inline-block border px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${m.cls}">${m.label}${extra ? ' · ' + paEsc(extra) : ''}</span>`;
}
function paSeloAcao(a) {
  const ef = paStatusEfetivo(a);
  return paSelo(ef, paPrazoVencidoAguardando(a) ? 'prazo vencido' : '');
}
function paUrlFoto(caminho) {
  const cfg = (window.JR_CONFIG && window.JR_CONFIG.supabase) || {};
  return `${cfg.url}/storage/v1/object/public/${PA_BUCKET}/${String(caminho).replace(/^\/+/, '')}`;
}
function paEtapasDa(acaoId) {
  return (window._pa.etapas || []).filter(e => String(e.acao_id) === String(acaoId) && !e.is_deleted)
    .sort((x, y) => (x.ordem || 0) - (y.ordem || 0) || (Number(x.id) - Number(y.id)));
}
function paEventosDa(acaoId) {
  return (window._pa.eventos || []).filter(e => String(e.acao_id) === String(acaoId))
    .sort((x, y) => String(y.criado_em || '').localeCompare(String(x.criado_em || '')) || (Number(y.id) - Number(x.id)));
}
function paProgresso(acaoId) {
  const et = paEtapasDa(acaoId).filter(e => e.status !== 'CANCELADA');
  if (!et.length) return null;
  const feitas = et.filter(e => e.status === 'REALIZADA').length;
  return { feitas, total: et.length, pct: Math.round(feitas * 100 / et.length) };
}
function paAcao(id) {
  return (window._pa.acoes || []).find(a => String(a.id) === String(id));
}
function paUsuariosAtivos() {
  const us = (typeof db !== 'undefined' && db.getUsuarios) ? db.getUsuarios() : [];
  return us.filter(u => u && u.nome && u.ativo !== false && !u.is_deleted)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
}
// Casa o nome digitado com um usuário cadastrado (pelo nome normalizado; o
// usuário costuma vir como "NOME (CARGO)" em alguns lugares do app).
function paResolverUsuario(nome) {
  const alvo = paNorm(String(nome || '').split('(')[0]);
  if (!alvo) return null;
  return paUsuariosAtivos().find(u => paNorm(String(u.nome).split('(')[0]) === alvo) || null;
}
// Todas as pessoas que já aparecem como responsáveis + usuários + sugeridos
function paPessoasConhecidas() {
  const set = new Map();
  const add = n => { const k = paNorm(n); if (k && !set.has(k)) set.set(k, String(n).toUpperCase().trim()); };
  paUsuariosAtivos().forEach(u => add(String(u.nome).split('(')[0]));
  (window._pa.areas || []).forEach(a => add(a.responsavel_sugerido));
  (window._pa.acoes || []).forEach(a => add(a.responsavel_nome));
  (window._pa.etapas || []).forEach(e => add(e.responsavel_nome));
  return Array.from(set.values()).sort();
}

// -----------------------------------------------------------------------------
// NUVEM
// -----------------------------------------------------------------------------
function paCfg() {
  const cs = window.cloudStore;
  if (!cs || !cs.isConfigured()) throw new Error('Sem conexão com a nuvem configurada neste aparelho.');
  return cs;
}
async function paLerTabela(tabela, query) {
  const cs = paCfg();
  const resp = await fetch(`${cs.config.url}/rest/v1/${tabela}?${query}`, { headers: cs._headers() });
  if (!resp.ok) throw new Error(`Não foi possível ler ${tabela} (${resp.status}). Confira a rede.`);
  return resp.json();
}
async function paCarregar(forcar = false) {
  const st = window._pa;
  if (st.carregando) return;
  if (!forcar && st.acoes && (Date.now() - st.carregadoEm) < 60000) return;
  st.carregando = true; st.erro = '';
  try {
    const [acoes, etapas, eventos, areas] = await Promise.all([
      paLerTabela('pa_acoes', 'select=*&is_deleted=is.false&order=numero.asc&limit=5000'),
      paLerTabela('pa_etapas', 'select=*&is_deleted=is.false&order=id.asc&limit=20000'),
      paLerTabela('pa_eventos', 'select=*&order=id.asc&limit=50000'),
      paLerTabela('pa_areas', 'select=*&order=area.asc')
    ]);
    st.acoes = acoes; st.etapas = etapas; st.eventos = eventos; st.areas = areas;
  } catch (e) {
    st.erro = e.message || String(e);
    st.acoes = st.acoes || [];
  } finally {
    st.carregadoEm = Date.now();
    st.carregando = false;
    if (typeof renderApp === 'function') renderApp();
    if (st.fichaId && document.getElementById('pa-ficha')) paRenderFicha();
  }
}
window.paCarregar = paCarregar;
function paGarantirDados() {
  const st = window._pa;
  if (st.carregando) return;
  if (!st.acoes || (Date.now() - st.carregadoEm) > 120000) paCarregar(true);
}

// Grava (upsert) e devolve as linhas como o banco as guardou.
async function paGravar(tabela, registro, conflito) {
  const cs = paCfg();
  const corpo = {};
  Object.keys(registro).forEach(k => {
    if (k.charAt(0) === '_') return;
    const v = registro[k];
    corpo[k] = (v === undefined || v === '') ? null : v;
  });
  const url = `${cs.config.url}/rest/v1/${tabela}${conflito ? '?on_conflict=' + conflito : ''}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: cs._headers({ 'Prefer': 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(corpo)
  });
  if (!resp.ok) throw new Error(`A nuvem recusou a gravação (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  const out = await resp.json();
  return Array.isArray(out) ? out[0] : out;
}
function paSubstituirLocal(lista, reg, chave = 'id') {
  const i = lista.findIndex(x => String(x[chave]) === String(reg[chave]));
  if (i >= 0) lista[i] = reg; else lista.push(reg);
}
async function paEvento(acaoId, tipo, extra) {
  const ev = Object.assign({ id: paNovoId(), acao_id: acaoId, tipo, autor: paUsuario(), criado_em: paAgora(), fotos_paths: [] }, extra || {});
  const salvo = await paGravar('pa_eventos', ev);
  window._pa.eventos.push(salvo || ev);
}
async function paSalvarAcao(a) {
  a.atualizado_por = paUsuario();
  a.atualizado_em = paAgora();
  const copia = Object.assign({}, a);
  if (!copia.numero) delete copia.numero; // o banco gera
  const salvo = await paGravar('pa_acoes', copia);
  paSubstituirLocal(window._pa.acoes, salvo);
  return salvo;
}
async function paSalvarEtapa(e) {
  e.atualizado_por = paUsuario();
  e.atualizado_em = paAgora();
  const salvo = await paGravar('pa_etapas', Object.assign({}, e));
  paSubstituirLocal(window._pa.etapas, salvo);
  return salvo;
}
async function paSubirFotos(arquivos, acaoId) {
  const cs = paCfg();
  const cfg = (window.JR_CONFIG && window.JR_CONFIG.supabase) || {};
  const caminhos = [];
  for (const f of arquivos) {
    const dataUrl = (typeof comprimirImagem === 'function') ? await comprimirImagem(f)
      : await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = erro; r.readAsDataURL(f); });
    const blob = await (await fetch(dataUrl)).blob();
    const caminho = `acao/${acaoId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
    const resp = await fetch(`${cs.config.url}/storage/v1/object/${PA_BUCKET}/${caminho}`, {
      method: 'POST',
      headers: { 'apikey': cfg.anonKey, 'Authorization': 'Bearer ' + cfg.anonKey, 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
      body: blob
    });
    if (!resp.ok) throw new Error(`A foto não subiu (${resp.status}). Confira a internet e tente de novo.`);
    caminhos.push(caminho);
  }
  return caminhos;
}
function paArquivosDo(inputId) {
  const el = document.getElementById(inputId);
  return Array.from((el && el.files) || []);
}
async function paExecutar(fn, msgOk) {
  const st = window._pa;
  if (st.ocupado) return;
  st.ocupado = true;
  try {
    const r = await fn();
    if (msgOk) showToast(msgOk);
    return r;
  } catch (e) {
    alert('❌ ' + (e.message || e));
  } finally {
    st.ocupado = false;
    if (typeof renderApp === 'function') renderApp();
    if (st.fichaId && document.getElementById('pa-ficha')) paRenderFicha();
  }
}

// -----------------------------------------------------------------------------
// FILTROS E AGREGAÇÕES
// -----------------------------------------------------------------------------
function paFiltrar() {
  const st = window._pa;
  const f = st.filtros;
  const busca = paNorm(f.busca);
  return (st.acoes || []).filter(a => {
    if (a.is_deleted) return false;
    if (f.status) {
      const ef = paStatusEfetivo(a);
      if (f.status === 'ATRASADA' ? ef !== 'ATRASADA' : a.status !== f.status) return false;
    }
    if (f.area && a.area !== f.area) return false;
    if (f.resp && paNorm(a.responsavel_nome) !== f.resp) return false;
    if (f.de || f.ate) {
      const d = a[f.campoData] ? String(a[f.campoData]).slice(0, 10) : '';
      if (!d) return false;
      if (f.de && d < f.de) return false;
      if (f.ate && d > f.ate) return false;
    }
    if (busca) {
      const txt = paNorm([paCodigo(a), a.acao, a.descricao, a.local, a.origem, a.area, a.responsavel_nome].join(' '));
      if (!txt.includes(busca)) return false;
    }
    return true;
  }).sort((x, y) => {
    const fx = ['REALIZADA', 'CANCELADA'].includes(x.status) ? 1 : 0;
    const fy = ['REALIZADA', 'CANCELADA'].includes(y.status) ? 1 : 0;
    if (fx !== fy) return fx - fy;
    return String(x.prazo || '9999').localeCompare(String(y.prazo || '9999')) || (x.numero || 0) - (y.numero || 0);
  });
}
function paResumo(lista) {
  const total = lista.length;
  const porStatus = {}; PA_ORDEM_CARDS.forEach(s => { porStatus[s] = 0; });
  const porArea = {}; const porResp = {};
  lista.forEach(a => {
    const ef = paStatusEfetivo(a);
    porStatus[ef] = (porStatus[ef] || 0) + 1;
    const ar = a.area || '(SEM ÁREA)';
    porArea[ar] = (porArea[ar] || 0) + 1;
    const r = String(a.responsavel_nome || '(SEM RESPONSÁVEL)').toUpperCase();
    if (!porResp[r]) porResp[r] = { qtd: 0, atrasadas: 0, chave: paNorm(a.responsavel_nome) };
    porResp[r].qtd++;
    if (ef === 'ATRASADA') porResp[r].atrasadas++;
  });
  const pct = n => total ? Math.round(n * 1000 / total) / 10 : 0;
  return { total, porStatus, porArea, porResp, pct };
}
function paTextoFiltros() {
  const f = window._pa.filtros;
  const partes = [];
  const rot = { inicio: 'Início', prazo: 'Prazo', data_realizada: 'Realizada' };
  if (f.de || f.ate) partes.push(`${rot[f.campoData]}: ${f.de ? paData(f.de) : '…'} a ${f.ate ? paData(f.ate) : '…'}`);
  if (f.status) partes.push(`Status: ${PA_STATUS[f.status].label}`);
  if (f.area) partes.push(`Área: ${f.area}`);
  if (f.resp) partes.push(`Responsável: ${f.resp}`);
  if (f.busca) partes.push(`Busca: "${f.busca}"`);
  return partes.length ? partes.join(' · ') : 'Sem filtros (todas as ações)';
}
function paSetFiltro(campo, valor) {
  window._pa.filtros[campo] = valor;
  renderApp();
}
window.paSetFiltro = paSetFiltro;
function paAlternarFiltro(campo, valor) {
  const f = window._pa.filtros;
  f[campo] = (f[campo] === valor) ? '' : valor;
  renderApp();
}
window.paAlternarFiltro = paAlternarFiltro;
function paLimparFiltros() {
  window._pa.filtros = { campoData: 'prazo', de: '', ate: '', status: '', resp: '', area: '', busca: '' };
  renderApp();
}
window.paLimparFiltros = paLimparFiltros;

// -----------------------------------------------------------------------------
// PAINEL
// -----------------------------------------------------------------------------
function renderPlanoAcaoView() {
  const st = window._pa;
  paGarantirDados();
  if (!st.acoes) {
    return `<div class="p-6 text-center text-slate-400 text-sm">${st.erro ? '❌ ' + paEsc(st.erro) : '⏳ Carregando o plano de ação…'}</div>`;
  }
  const f = st.filtros;
  const lista = paFiltrar();
  const r = paResumo(lista);
  const areas = (st.areas || []).filter(a => a.ativo !== false).map(a => a.area);
  (st.acoes || []).forEach(a => { if (a.area && !areas.includes(a.area)) areas.push(a.area); });
  const resps = [];
  (st.acoes || []).forEach(a => { const k = paNorm(a.responsavel_nome); if (k && !resps.some(x => x.k === k)) resps.push({ k, n: String(a.responsavel_nome).toUpperCase() }); });
  resps.sort((a, b) => a.n.localeCompare(b.n));
  const semAcesso = paPessoasSemAcesso().length;

  const card = (ativo, onclick, titulo, qtd, pct, cls, sub) => `
    <button onclick="${onclick}" class="text-left rounded-lg border p-2.5 transition ${ativo ? 'ring-2 ring-amber-400' : ''} ${cls}">
      <div class="text-[10px] font-bold uppercase tracking-wide opacity-90 truncate">${titulo}</div>
      <div class="flex items-baseline gap-1.5 mt-0.5"><span class="text-xl font-black">${qtd}</span><span class="text-[11px] opacity-80">${pct}%</span></div>
      ${sub ? `<div class="text-[10px] mt-0.5">${sub}</div>` : ''}
    </button>`;

  const cardsStatus = PA_ORDEM_CARDS.map(s => card(f.status === s, `paAlternarFiltro('status','${s}')`, PA_STATUS[s].label, r.porStatus[s] || 0, r.pct(r.porStatus[s] || 0), PA_STATUS[s].cls)).join('');
  const cardsArea = Object.keys(r.porArea).sort((a, b) => r.porArea[b] - r.porArea[a] || a.localeCompare(b))
    .map(ar => card(f.area === ar, `paAlternarFiltro('area', ${paEsc(JSON.stringify(ar))})`, paEsc(ar), r.porArea[ar], r.pct(r.porArea[ar]), 'bg-slate-900 text-slate-200 border-slate-700')).join('');
  const cardsResp = Object.keys(r.porResp).sort((a, b) => r.porResp[b].qtd - r.porResp[a].qtd || a.localeCompare(b))
    .map(n => { const x = r.porResp[n]; return card(f.resp === x.chave, `paAlternarFiltro('resp', ${paEsc(JSON.stringify(x.chave))})`, paEsc(n), x.qtd, r.pct(x.qtd), 'bg-slate-900 text-slate-200 border-slate-700', x.atrasadas ? `<span class="text-red-300 font-bold">⚠ ${x.atrasadas} atrasada(s)</span>` : '<span class="text-slate-500">sem atraso</span>'); }).join('');

  const linhas = lista.map(a => {
    const t = paTempo(a);
    const p = paProgresso(a.id);
    return `<tr class="border-b border-slate-800 hover:bg-slate-800/60 cursor-pointer align-top" onclick="paAbrirFicha(${Number(a.id)})">
      <td class="py-2 px-2 font-mono text-amber-300 whitespace-nowrap">${paCodigo(a)}</td>
      <td class="py-2 px-2 min-w-[220px]"><div class="font-bold text-white">${paEsc(a.acao)}</div>${a.descricao ? `<div class="text-slate-400 text-[11px] mt-0.5">${paEsc(a.descricao)}</div>` : ''}${a.origem ? `<div class="text-slate-500 text-[10px] mt-0.5">Origem: ${paEsc(a.origem)}${a.origem_data ? ' · ' + paData(a.origem_data) : ''}</div>` : ''}</td>
      <td class="py-2 px-2 whitespace-nowrap">${paEsc(a.area || '')}</td>
      <td class="py-2 px-2 whitespace-nowrap">${paEsc(a.responsavel_nome || '')}${a.responsavel_nome && !a.responsavel_usuario_id && !paResolverUsuario(a.responsavel_nome) ? ' <span title="Sem login no app" class="text-amber-400">●</span>' : ''}</td>
      <td class="py-2 px-2">${paEsc(a.local || '')}</td>
      <td class="py-2 px-2 whitespace-nowrap">${paData(a.inicio)}</td>
      <td class="py-2 px-2 whitespace-nowrap">${paData(a.prazo)}${a.qtd_adiamentos ? `<div class="text-[10px] text-amber-400">adiada ${a.qtd_adiamentos}x</div>` : ''}</td>
      <td class="py-2 px-2 whitespace-nowrap">${paData(a.data_realizada)}</td>
      <td class="py-2 px-2">${paSeloAcao(a)}</td>
      <td class="py-2 px-2 text-center">${t === null ? '<span class="text-slate-600">—</span>' : `<span class="inline-block border px-2 py-0.5 rounded font-bold ${paTempoCls(t)}">${t}</span>`}</td>
      <td class="py-2 px-2 whitespace-nowrap">${p ? `<div class="w-16 h-1.5 bg-slate-700 rounded"><div class="h-1.5 bg-emerald-500 rounded" style="width:${p.pct}%"></div></div><div class="text-[10px] text-slate-400 mt-0.5">${p.feitas}/${p.total}</div>` : '<span class="text-slate-600">—</span>'}</td>
    </tr>`;
  }).join('');

  return `
  <div class="space-y-4">
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-black text-white flex items-center gap-2"><span>🎯</span> Plano de Ação</h1>
        <p class="text-xs text-slate-400 mt-0.5">O quê, como, onde, quem e até quando. Atraso calculado pelo prazo; histórico de cada ação na ficha.</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button onclick="paAbrirFormAcao()" class="bg-emerald-600 hover:bg-emerald-500 text-white ${PA_BTN}">➕ Nova ação</button>
        <button onclick="paImprimirPainel()" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${PA_BTN}">🖨️ Imprimir</button>
        <button onclick="paExportarXlsx()" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${PA_BTN}">📊 Excel</button>
        <button onclick="paAbrirAreas()" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${PA_BTN}">🏷️ Áreas</button>
        <button onclick="paAbrirSemAcesso()" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${PA_BTN}">👤 Sem acesso${semAcesso ? ` <span class="bg-amber-600 text-white rounded px-1">${semAcesso}</span>` : ''}</button>
        <button onclick="paCarregar(true)" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${PA_BTN}">🔄</button>
      </div>
    </div>
    ${st.erro ? `<div class="bg-red-950/60 border border-red-800 text-red-200 text-xs rounded p-2">❌ ${paEsc(st.erro)}</div>` : ''}

    <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-xs">
      <label class="col-span-2 md:col-span-1"><span class="text-slate-400 text-[10px] font-bold">Data por</span>
        <select class="${PA_INPUT}" onchange="paSetFiltro('campoData', this.value)">
          <option value="inicio" ${f.campoData === 'inicio' ? 'selected' : ''}>Início</option>
          <option value="prazo" ${f.campoData === 'prazo' ? 'selected' : ''}>Prazo</option>
          <option value="data_realizada" ${f.campoData === 'data_realizada' ? 'selected' : ''}>Realizada</option>
        </select></label>
      <label><span class="text-slate-400 text-[10px] font-bold">De</span><input type="date" class="${PA_INPUT}" value="${f.de}" onchange="paSetFiltro('de', this.value)"></label>
      <label><span class="text-slate-400 text-[10px] font-bold">Até</span><input type="date" class="${PA_INPUT}" value="${f.ate}" onchange="paSetFiltro('ate', this.value)"></label>
      <label><span class="text-slate-400 text-[10px] font-bold">Status</span>
        <select class="${PA_INPUT}" onchange="paSetFiltro('status', this.value)"><option value="">Todos</option>
          ${PA_ORDEM_CARDS.map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${PA_STATUS[s].label}</option>`).join('')}</select></label>
      <label><span class="text-slate-400 text-[10px] font-bold">Responsável</span>
        <select class="${PA_INPUT}" onchange="paSetFiltro('resp', this.value)"><option value="">Todos</option>
          ${resps.map(x => `<option value="${paEsc(x.k)}" ${f.resp === x.k ? 'selected' : ''}>${paEsc(x.n)}</option>`).join('')}</select></label>
      <label><span class="text-slate-400 text-[10px] font-bold">Área</span>
        <select class="${PA_INPUT}" onchange="paSetFiltro('area', this.value)"><option value="">Todas</option>
          ${areas.map(x => `<option value="${paEsc(x)}" ${f.area === x ? 'selected' : ''}>${paEsc(x)}</option>`).join('')}</select></label>
      <label class="col-span-2 md:col-span-1"><span class="text-slate-400 text-[10px] font-bold">Buscar</span><input class="${PA_INPUT}" placeholder="ação, origem, local…" value="${paEsc(f.busca)}" onchange="paSetFiltro('busca', this.value)"></label>
      <div class="flex items-end"><button onclick="paLimparFiltros()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 ${PA_BTN}">✖ Limpar</button></div>
    </div>

    <div>
      <div class="text-[11px] font-bold text-slate-400 uppercase mb-1">Por status · ${r.total} ação(ões)</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">${cardsStatus}</div>
    </div>
    <div>
      <div class="text-[11px] font-bold text-slate-400 uppercase mb-1">Por área</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">${cardsArea || '<span class="text-slate-500 text-xs">—</span>'}</div>
    </div>
    <div>
      <div class="text-[11px] font-bold text-slate-400 uppercase mb-1">Por responsável</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">${cardsResp || '<span class="text-slate-500 text-xs">—</span>'}</div>
    </div>

    <div class="bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
      <table class="w-full text-xs text-slate-300">
        <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase">
          <tr><th class="py-2 px-2 text-left">Código</th><th class="py-2 px-2 text-left">Ação (o quê) / Como</th><th class="py-2 px-2 text-left">Área</th><th class="py-2 px-2 text-left">Responsável</th><th class="py-2 px-2 text-left">Onde</th><th class="py-2 px-2 text-left">Início</th><th class="py-2 px-2 text-left">Prazo</th><th class="py-2 px-2 text-left">Realizada</th><th class="py-2 px-2 text-left">Status</th><th class="py-2 px-2">Tempo</th><th class="py-2 px-2 text-left">Etapas</th></tr>
        </thead>
        <tbody>${linhas || `<tr><td colspan="11" class="p-6 text-center text-slate-500">${(st.acoes || []).length ? 'Nenhuma ação com estes filtros.' : 'Nenhuma ação cadastrada ainda. Comece em ➕ Nova ação.'}</td></tr>`}</tbody>
      </table>
    </div>
    <p class="text-[10px] text-slate-500">Tempo = dias até o prazo (ou de folga na entrega). Verde acima de 2, amarelo de 0 a 2, vermelho atrasado. <span class="text-amber-400">●</span> responsável ainda sem login no app.</p>
  </div>`;
}
window.renderPlanoAcaoView = renderPlanoAcaoView;

// -----------------------------------------------------------------------------
// FORMULÁRIO DA AÇÃO (nova / editar)
// -----------------------------------------------------------------------------
function paDatalistPessoas() {
  return `<datalist id="pa-pessoas">${paPessoasConhecidas().map(n => `<option value="${paEsc(n)}"></option>`).join('')}</datalist>`;
}
function paAbrirFormAcao(id) {
  const st = window._pa;
  const a = id ? paAcao(id) : null;
  const mc = document.getElementById('modal-container');
  if (!mc) return;
  const areas = (st.areas || []).filter(x => x.ativo !== false || (a && a.area === x.area));
  mc.innerHTML = `
  <div onclick="event.stopPropagation()" class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-2xl w-full shadow-2xl space-y-3 max-h-[92vh] overflow-y-auto text-xs">
    <div class="flex justify-between items-center border-b border-slate-800 pb-2">
      <h3 class="font-bold text-white text-base">${a ? '✏️ Editar ' + paCodigo(a) : '➕ Nova ação'}</h3>
      <button onclick="${a ? `paAbrirFicha(${Number(a.id)})` : 'closeModal()'}" class="text-slate-400 hover:text-white font-bold text-xl leading-none">✕</button>
    </div>
    ${paDatalistPessoas()}
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label class="sm:col-span-2"><span class="text-slate-400 font-bold">Origem / reunião</span><input id="pa-f-origem" class="${PA_INPUT}" placeholder="Reunião Manutenção Quinzenal" value="${paEsc(a ? a.origem || '' : '')}"></label>
      <label><span class="text-slate-400 font-bold">Data da origem</span><input id="pa-f-origem-data" type="date" class="${PA_INPUT}" value="${a && a.origem_data ? String(a.origem_data).slice(0, 10) : ''}"></label>
    </div>
    <label class="block"><span class="text-slate-400 font-bold">Ação (o quê?) *</span><textarea id="pa-f-acao" rows="2" class="${PA_INPUT}">${paEsc(a ? a.acao : '')}</textarea></label>
    <label class="block"><span class="text-slate-400 font-bold">Descrição (como?)</span><textarea id="pa-f-desc" rows="3" class="${PA_INPUT}">${paEsc(a ? a.descricao || '' : '')}</textarea></label>
    <label class="block"><span class="text-slate-400 font-bold">Local (onde?)</span><input id="pa-f-local" class="${PA_INPUT}" value="${paEsc(a ? a.local || '' : '')}"></label>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label><span class="text-slate-400 font-bold">Área</span>
        <select id="pa-f-area" class="${PA_INPUT}" onchange="paSugerirResponsavel()"><option value="">—</option>
        ${areas.map(x => `<option value="${paEsc(x.area)}" data-sug="${paEsc(x.responsavel_sugerido || '')}" ${a && a.area === x.area ? 'selected' : ''}>${paEsc(x.area)}</option>`).join('')}</select></label>
      <label><span class="text-slate-400 font-bold">Responsável (quem?) *</span><input id="pa-f-resp" list="pa-pessoas" class="${PA_INPUT}" placeholder="escolha ou digite um nome" value="${paEsc(a ? a.responsavel_nome || '' : '')}" oninput="this.dataset.manual='1'"></label>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
      <label><span class="text-slate-400 font-bold">Início</span><input id="pa-f-inicio" type="date" class="${PA_INPUT}" value="${a && a.inicio ? String(a.inicio).slice(0, 10) : paHoje()}"></label>
      <label><span class="text-slate-400 font-bold">Prazo (final) *</span><input id="pa-f-prazo" type="date" class="${PA_INPUT}" value="${a && a.prazo ? String(a.prazo).slice(0, 10) : ''}" ${a ? 'disabled title="Use Alterar prazo na ficha (pede o motivo)"' : ''}></label>
      ${a ? '' : `<label><span class="text-slate-400 font-bold">Status</span><select id="pa-f-status" class="${PA_INPUT}">${['NAO_INICIADA', 'EM_ANDAMENTO'].map(s => `<option value="${s}">${PA_STATUS[s].label}</option>`).join('')}</select></label>`}
    </div>
    ${a ? '<p class="text-[10px] text-slate-500">O prazo muda pelo botão <b>Alterar prazo</b> da ficha, que guarda o original e o motivo. O status muda pelos botões da ficha.</p>' : ''}
    <div class="flex justify-end gap-2 pt-2 border-t border-slate-800">
      <button onclick="${a ? `paAbrirFicha(${Number(a.id)})` : 'closeModal()'}" class="bg-slate-800 hover:bg-slate-700 text-slate-300 ${PA_BTN}">Cancelar</button>
      <button id="pa-f-salvar" onclick="paSalvarFormAcao(${a ? Number(a.id) : 'null'})" class="bg-emerald-600 hover:bg-emerald-500 text-white ${PA_BTN}">💾 Salvar</button>
    </div>
  </div>`;
  mc.classList.remove('hidden');
}
window.paAbrirFormAcao = paAbrirFormAcao;

function paSugerirResponsavel() {
  const sel = document.getElementById('pa-f-area');
  const inp = document.getElementById('pa-f-resp');
  if (!sel || !inp) return;
  const op = sel.options[sel.selectedIndex];
  const sug = op ? op.getAttribute('data-sug') : '';
  if (sug && (!inp.value.trim() || inp.dataset.manual !== '1')) inp.value = sug;
}
window.paSugerirResponsavel = paSugerirResponsavel;

async function paSalvarFormAcao(id) {
  const val = k => String((document.getElementById(k) || {}).value || '').trim();
  const acaoTxt = val('pa-f-acao');
  const resp = val('pa-f-resp').toUpperCase();
  const prazo = val('pa-f-prazo');
  if (!acaoTxt) { alert('Descreva a ação (o quê?).'); return; }
  if (!resp) { alert('Informe o responsável (quem?).'); return; }
  if (!id && !prazo) { alert('Informe o prazo.'); return; }
  const u = paResolverUsuario(resp);
  const novo = !id;
  await paExecutar(async () => {
    let a;
    if (novo) {
      a = {
        id: paNovoId(), status: val('pa-f-status') || 'NAO_INICIADA', prazo, prazo_original: prazo, qtd_adiamentos: 0,
        criado_por: paUsuario(), criado_em: paAgora(), is_deleted: false
      };
    } else {
      a = Object.assign({}, paAcao(id));
    }
    const antes = Object.assign({}, a);
    Object.assign(a, {
      origem: val('pa-f-origem').toUpperCase(), origem_data: val('pa-f-origem-data'),
      acao: acaoTxt, descricao: val('pa-f-desc'), local: val('pa-f-local').toUpperCase(),
      area: val('pa-f-area'), responsavel_nome: u ? String(u.nome).split('(')[0].trim().toUpperCase() : resp,
      responsavel_usuario_id: u ? Number(u.id) || null : null, inicio: val('pa-f-inicio')
    });
    const salvo = await paSalvarAcao(a);
    if (novo) {
      await paEvento(salvo.id, 'CRIACAO', { para: salvo.status, texto: `Ação criada · responsável ${salvo.responsavel_nome} · prazo ${paData(salvo.prazo)}` });
    } else {
      const mud = [];
      const rot = { origem: 'Origem', origem_data: 'Data da origem', acao: 'Ação', descricao: 'Como', local: 'Onde', area: 'Área', responsavel_nome: 'Responsável', inicio: 'Início' };
      Object.keys(rot).forEach(k => {
        const x = String(antes[k] || '').slice(0, k.indexOf('data') >= 0 || k === 'inicio' ? 10 : 9999);
        const y = String(salvo[k] || '').slice(0, k.indexOf('data') >= 0 || k === 'inicio' ? 10 : 9999);
        if (x !== y) mud.push(k === 'acao' || k === 'descricao' ? rot[k] : `${rot[k]}: ${x || '—'} → ${y || '—'}`);
      });
      if (mud.length) await paEvento(salvo.id, 'EDICAO', { texto: 'Editado: ' + mud.join('; ') });
    }
    window._pa.fichaId = salvo.id;
    paAbrirFicha(salvo.id);
  }, novo ? '✅ Ação criada.' : '✅ Ação atualizada.');
}
window.paSalvarFormAcao = paSalvarFormAcao;

// -----------------------------------------------------------------------------
// FICHA DA AÇÃO
// -----------------------------------------------------------------------------
function paAbrirFicha(id) {
  window._pa.fichaId = id;
  const mc = document.getElementById('modal-container');
  if (!mc) return;
  mc.innerHTML = `<div id="pa-ficha" onclick="event.stopPropagation()" class="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full shadow-2xl max-h-[94vh] overflow-y-auto text-xs"></div>`;
  mc.classList.remove('hidden');
  paRenderFicha();
}
window.paAbrirFicha = paAbrirFicha;
function paFecharFicha() { window._pa.fichaId = null; closeModal(); }
window.paFecharFicha = paFecharFicha;
function paAlternarSecao(qual) {
  const st = window._pa;
  if (qual === 'etapas') st.verEtapas = !st.verEtapas; else st.verTempo = !st.verTempo;
  paRenderFicha();
}
window.paAlternarSecao = paAlternarSecao;

function paMiniFotos(caminhos) {
  const l = Array.isArray(caminhos) ? caminhos : [];
  if (!l.length) return '';
  return `<div class="flex gap-1.5 flex-wrap mt-1">${l.map(c => `<a href="${paEsc(paUrlFoto(c))}" target="_blank" rel="noopener"><img src="${paEsc(paUrlFoto(c))}" class="w-14 h-14 object-cover rounded border border-slate-700 hover:border-amber-400" loading="lazy" alt="foto"></a>`).join('')}</div>`;
}

function paRenderFicha() {
  const box = document.getElementById('pa-ficha');
  const st = window._pa;
  const a = paAcao(st.fichaId);
  if (!box) return;
  if (!a) { box.innerHTML = '<div class="p-6 text-slate-400">Ação não encontrada (talvez excluída). <button class="underline" onclick="paFecharFicha()">Fechar</button></div>'; return; }
  const etapas = paEtapasDa(a.id);
  const eventos = paEventosDa(a.id);
  const p = paProgresso(a.id);
  const t = paTempo(a);
  const info = (rot, val) => `<div class="bg-slate-950 border border-slate-800 rounded p-2"><div class="text-[10px] text-slate-500 font-bold uppercase">${rot}</div><div class="text-slate-200 mt-0.5">${val || '—'}</div></div>`;
  const botoesStatus = PA_STATUS_GRAVAVEIS.filter(s => s !== a.status)
    .map(s => `<button onclick="paMudarStatus(${Number(a.id)}, '${s}')" class="border ${PA_STATUS[s].cls} ${PA_BTN} hover:brightness-125">${PA_STATUS[s].label}</button>`).join('');

  const linhasEtapas = etapas.map((e, i) => {
    const venc = e.prazo && !['REALIZADA', 'CANCELADA', 'EM_VALIDACAO', 'AGUARDANDO'].includes(e.status) && String(e.prazo).slice(0, 10) < paHoje();
    const nf = (Array.isArray(e.fotos_paths) ? e.fotos_paths : []).length;
    return `<div class="border border-slate-800 rounded p-2 ${e.status === 'REALIZADA' ? 'bg-emerald-950/20' : e.status === 'CANCELADA' ? 'opacity-60' : ''}">
      <div class="flex flex-wrap gap-2 items-start">
        <span class="text-slate-500 font-mono">${i + 1}.</span>
        <div class="flex-1 min-w-[180px]">
          <div class="text-slate-100 font-bold ${e.status === 'CANCELADA' ? 'line-through' : ''}">${paEsc(e.descricao)}</div>
          <div class="text-[10px] text-slate-400">${paEsc(e.responsavel_nome || 'sem responsável')} · prazo ${e.prazo ? paData(e.prazo) : '—'}${venc ? ' <span class="text-red-400 font-bold">vencido</span>' : ''}${e.data_realizada ? ' · feita ' + paData(e.data_realizada) : ''}</div>
        </div>
        <select class="bg-slate-800 border border-slate-700 text-white rounded p-1 text-[11px]" onchange="paMudarStatusEtapa(${Number(e.id)}, this.value)">
          ${PA_STATUS_GRAVAVEIS.map(s => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${PA_STATUS[s].label}</option>`).join('')}
        </select>
        <label class="cursor-pointer bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 rounded px-2 py-1 text-[11px] ${nf >= PA_MAX_FOTOS ? 'opacity-40 pointer-events-none' : ''}" title="Até ${PA_MAX_FOTOS} fotos por etapa">📷 ${nf}/${PA_MAX_FOTOS}
          <input type="file" accept="image/*" multiple class="hidden" onchange="paFotosEtapa(${Number(e.id)}, this)"></label>
        <button onclick="paExcluirEtapa(${Number(e.id)})" title="Excluir etapa" class="text-slate-500 hover:text-red-400 px-1">🗑️</button>
      </div>
      ${paMiniFotos(e.fotos_paths)}
    </div>`;
  }).join('');

  const rotEv = { CRIACAO: '🆕', STATUS: '🔁', PRAZO: '📅', ETAPA: '🧩', COMENTARIO: '💬', EDICAO: '✏️', EXCLUSAO: '🗑️' };
  const linhasTempo = eventos.map(ev => `
    <div class="border-l-2 border-slate-700 pl-3 py-1">
      <div class="text-[10px] text-slate-500">${paDataHora(ev.criado_em)} · ${paEsc(ev.autor || '')}</div>
      <div class="text-slate-200">${rotEv[ev.tipo] || '•'} ${paEsc(ev.texto || '')}</div>
      ${paMiniFotos(ev.fotos_paths)}
    </div>`).join('');

  box.innerHTML = `
  <div class="sticky top-0 bg-slate-900 border-b border-slate-800 p-4 flex justify-between gap-3 z-10">
    <div class="min-w-0">
      <div class="text-[11px] text-slate-400"><span class="font-mono text-amber-300">${paCodigo(a)}</span>${a.origem ? ' · Origem: ' + paEsc(a.origem) : ''}${a.origem_data ? ' · ' + paData(a.origem_data) : ''}</div>
      <div class="text-base font-black text-white mt-0.5">${paEsc(a.acao)}</div>
    </div>
    <div class="flex items-start gap-2 shrink-0">
      ${paSeloAcao(a)}
      ${t !== null ? `<span class="border px-2 py-0.5 rounded text-[10px] font-bold ${paTempoCls(t)}">${t < 0 ? Math.abs(t) + ' d de atraso' : t + ' d'}</span>` : ''}
      <button onclick="paFecharFicha()" class="text-slate-400 hover:text-white font-bold text-xl leading-none ml-2">✕</button>
    </div>
  </div>
  <div class="p-4 space-y-4">
    ${a.descricao ? `<div class="text-slate-300 whitespace-pre-wrap"><span class="text-slate-500 font-bold">Como: </span>${paEsc(a.descricao)}</div>` : ''}
    ${a.motivo_status && ['AGUARDANDO', 'CANCELADA'].includes(a.status) ? `<div class="bg-amber-950/40 border border-amber-800 text-amber-200 rounded p-2"><b>Motivo (${PA_STATUS[a.status].label}):</b> ${paEsc(a.motivo_status)}</div>` : ''}
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
      ${info('Área', paEsc(a.area))}
      ${info('Responsável', paEsc(a.responsavel_nome) + (a.responsavel_nome && !paResolverUsuario(a.responsavel_nome) ? ' <span class="text-amber-400 text-[10px]">(sem login)</span>' : ''))}
      ${info('Onde', paEsc(a.local))}
      ${info('Início', paData(a.inicio))}
      ${info('Prazo', paData(a.prazo) + (a.prazo_original && String(a.prazo_original).slice(0, 10) !== String(a.prazo || '').slice(0, 10) ? ` <span class="text-slate-500">(orig. ${paData(a.prazo_original)})</span>` : '') + (a.qtd_adiamentos ? ` <span class="text-amber-400 text-[10px]">adiada ${a.qtd_adiamentos}x</span>` : ''))}
      ${info('Realizada', paData(a.data_realizada))}
      ${info('Etapas', p ? `${p.feitas} de ${p.total} · ${p.pct}%` : 'sem etapas')}
      ${info('Criada', `${paEsc(a.criado_por || '')} ${paData(a.criado_em)}`)}
    </div>
    <div class="flex flex-wrap gap-2 items-center">
      <span class="text-slate-500 font-bold">Mudar status:</span> ${botoesStatus}
    </div>
    <div class="flex flex-wrap gap-2">
      <button onclick="paAlterarPrazo(${Number(a.id)})" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${PA_BTN}">📅 Alterar prazo</button>
      <button onclick="paAbrirFormAcao(${Number(a.id)})" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${PA_BTN}">✏️ Editar</button>
      <button onclick="paImprimirAcao(${Number(a.id)})" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${PA_BTN}">🖨️ Imprimir esta ação</button>
      <button onclick="paExcluirAcao(${Number(a.id)})" class="bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 ${PA_BTN}">🗑️ Excluir</button>
    </div>

    <div class="border border-slate-800 rounded-lg">
      <button onclick="paAlternarSecao('etapas')" class="w-full flex justify-between items-center px-3 py-2 bg-slate-950 rounded-t-lg text-left">
        <span class="font-bold text-white">🧩 Etapas ${p ? `<span class="text-slate-400 font-normal">· ${p.feitas}/${p.total}</span>` : ''}</span><span class="text-slate-400">${st.verEtapas ? '▾ recolher' : '▸ abrir'}</span>
      </button>
      ${st.verEtapas ? `<div class="p-3 space-y-2">
        ${linhasEtapas || '<div class="text-slate-500">Nenhuma etapa. Quebre a ação em passos se ajudar a acompanhar.</div>'}
        ${paDatalistPessoas()}
        <div class="grid grid-cols-1 sm:grid-cols-6 gap-2 pt-2 border-t border-slate-800">
          <input id="pa-e-desc" class="${PA_INPUT} sm:col-span-3" placeholder="Nova etapa">
          <input id="pa-e-resp" list="pa-pessoas" class="${PA_INPUT} sm:col-span-1" placeholder="Responsável" value="${paEsc(a.responsavel_nome || '')}">
          <input id="pa-e-prazo" type="date" class="${PA_INPUT} sm:col-span-1" value="${a.prazo ? String(a.prazo).slice(0, 10) : ''}">
          <button onclick="paAdicionarEtapa(${Number(a.id)})" class="bg-emerald-700 hover:bg-emerald-600 text-white ${PA_BTN}">➕ Etapa</button>
        </div>
      </div>` : ''}
    </div>

    <div class="border border-slate-800 rounded-lg">
      <button onclick="paAlternarSecao('tempo')" class="w-full flex justify-between items-center px-3 py-2 bg-slate-950 rounded-t-lg text-left">
        <span class="font-bold text-white">🕓 Linha do tempo <span class="text-slate-400 font-normal">· ${eventos.length}</span></span><span class="text-slate-400">${st.verTempo ? '▾ recolher' : '▸ abrir'}</span>
      </button>
      ${st.verTempo ? `<div class="p-3 space-y-3">
        <div class="space-y-2">
          <textarea id="pa-c-texto" rows="2" class="${PA_INPUT}" placeholder="Escrever atualização (o que foi feito, o que falta, quem cobrar…)"></textarea>
          <div class="flex flex-wrap gap-2 items-center">
            <input id="pa-c-fotos" type="file" accept="image/*" multiple class="text-[11px] text-slate-400" title="Até ${PA_MAX_FOTOS} fotos">
            <button onclick="paComentar(${Number(a.id)})" class="ml-auto bg-sky-700 hover:bg-sky-600 text-white ${PA_BTN}">💬 Registrar atualização</button>
          </div>
        </div>
        <div class="space-y-2">${linhasTempo || '<div class="text-slate-500">Sem eventos.</div>'}</div>
      </div>` : ''}
    </div>
  </div>`;
}

// -----------------------------------------------------------------------------
// AÇÕES DA FICHA
// -----------------------------------------------------------------------------
async function paMudarStatus(id, novo) {
  const a0 = paAcao(id);
  if (!a0) return;
  const a = Object.assign({}, a0);
  let motivo = '';
  let dataReal = null;
  if (novo === 'AGUARDANDO' || novo === 'CANCELADA') {
    motivo = (prompt(novo === 'AGUARDANDO' ? 'Aguardando o quê? (compra, fornecedor, aprovação…)' : 'Motivo do cancelamento:') || '').trim();
    if (!motivo) { alert('O motivo é obrigatório.'); return; }
  }
  if (novo === 'REALIZADA') {
    const abertas = paEtapasDa(id).filter(e => !['REALIZADA', 'CANCELADA'].includes(e.status)).length;
    if (abertas && !confirm(`Ainda há ${abertas} etapa(s) em aberto. Marcar a ação como Realizada mesmo assim?`)) return;
    const d = (prompt('Data em que foi realizada (dd/mm/aaaa):', paData(paHoje())) || '').trim();
    const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) { alert('Data inválida. Use dd/mm/aaaa.'); return; }
    dataReal = `${m[3]}-${m[2]}-${m[1]}`;
  }
  const de = a.status;
  a.status = novo;
  a.motivo_status = motivo || null;
  a.data_realizada = novo === 'REALIZADA' ? dataReal : null;
  await paExecutar(async () => {
    await paSalvarAcao(a);
    await paEvento(id, 'STATUS', { de, para: novo, texto: `Status: ${PA_STATUS[de].label} → ${PA_STATUS[novo].label}${motivo ? ' · ' + motivo : ''}${dataReal ? ' · realizada em ' + paData(dataReal) : ''}` });
  }, `Status alterado para ${PA_STATUS[novo].label}.`);
}
window.paMudarStatus = paMudarStatus;

async function paAlterarPrazo(id) {
  const a0 = paAcao(id);
  if (!a0) return;
  const d = (prompt('Novo prazo (dd/mm/aaaa):', paData(a0.prazo)) || '').trim();
  if (!d) return;
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) { alert('Data inválida. Use dd/mm/aaaa.'); return; }
  const novo = `${m[3]}-${m[2]}-${m[1]}`;
  const velho = a0.prazo ? String(a0.prazo).slice(0, 10) : '';
  if (novo === velho) return;
  const motivo = (prompt('Motivo da mudança de prazo:') || '').trim();
  if (!motivo) { alert('O motivo é obrigatório.'); return; }
  const a = Object.assign({}, a0);
  a.prazo = novo;
  if (!a.prazo_original) a.prazo_original = velho || novo;
  if (velho && novo > velho) a.qtd_adiamentos = (Number(a.qtd_adiamentos) || 0) + 1;
  await paExecutar(async () => {
    await paSalvarAcao(a);
    await paEvento(id, 'PRAZO', { de: velho, para: novo, texto: `Prazo ${paData(velho) || '—'} → ${paData(novo)} · ${motivo}` });
  }, '📅 Prazo alterado.');
}
window.paAlterarPrazo = paAlterarPrazo;

async function paExcluirAcao(id) {
  const a0 = paAcao(id);
  if (!a0) return;
  if (!confirm(`Excluir ${paCodigo(a0)}? Ela some do painel (fica só no banco, com o histórico).`)) return;
  const a = Object.assign({}, a0, { is_deleted: true, deleted_at: paAgora(), deleted_by_nome: paUsuario() });
  await paExecutar(async () => {
    await paSalvarAcao(a);
    await paEvento(id, 'EXCLUSAO', { texto: 'Ação excluída' });
    window._pa.acoes = window._pa.acoes.filter(x => String(x.id) !== String(id));
    paFecharFicha();
  }, '🗑️ Ação excluída.');
}
window.paExcluirAcao = paExcluirAcao;

async function paAdicionarEtapa(acaoId) {
  const desc = String((document.getElementById('pa-e-desc') || {}).value || '').trim();
  const resp = String((document.getElementById('pa-e-resp') || {}).value || '').trim().toUpperCase();
  const prazo = String((document.getElementById('pa-e-prazo') || {}).value || '').trim();
  if (!desc) { alert('Descreva a etapa.'); return; }
  const u = paResolverUsuario(resp);
  const ordem = paEtapasDa(acaoId).reduce((m, e) => Math.max(m, e.ordem || 0), 0) + 1;
  await paExecutar(async () => {
    const e = await paSalvarEtapa({
      id: paNovoId(), acao_id: acaoId, ordem, descricao: desc,
      responsavel_nome: u ? String(u.nome).split('(')[0].trim().toUpperCase() : resp,
      responsavel_usuario_id: u ? Number(u.id) || null : null,
      prazo, status: 'NAO_INICIADA', fotos_paths: [], criado_por: paUsuario(), criado_em: paAgora(), is_deleted: false
    });
    await paEvento(acaoId, 'ETAPA', { etapa_id: e.id, texto: `Etapa adicionada: ${desc}${e.responsavel_nome ? ' · ' + e.responsavel_nome : ''}${prazo ? ' · até ' + paData(prazo) : ''}` });
  }, '🧩 Etapa adicionada.');
}
window.paAdicionarEtapa = paAdicionarEtapa;

async function paMudarStatusEtapa(etapaId, novo) {
  const e0 = (window._pa.etapas || []).find(x => String(x.id) === String(etapaId));
  if (!e0 || e0.status === novo) return;
  const e = Object.assign({}, e0, { status: novo, data_realizada: novo === 'REALIZADA' ? paHoje() : null });
  await paExecutar(async () => {
    await paSalvarEtapa(e);
    await paEvento(e.acao_id, 'ETAPA', { etapa_id: e.id, de: e0.status, para: novo, texto: `Etapa "${e.descricao}": ${PA_STATUS[e0.status].label} → ${PA_STATUS[novo].label}` });
  });
}
window.paMudarStatusEtapa = paMudarStatusEtapa;

async function paExcluirEtapa(etapaId) {
  const e0 = (window._pa.etapas || []).find(x => String(x.id) === String(etapaId));
  if (!e0 || !confirm(`Excluir a etapa "${e0.descricao}"?`)) return;
  await paExecutar(async () => {
    await paSalvarEtapa(Object.assign({}, e0, { is_deleted: true }));
    await paEvento(e0.acao_id, 'ETAPA', { etapa_id: e0.id, texto: `Etapa excluída: ${e0.descricao}` });
    window._pa.etapas = window._pa.etapas.filter(x => String(x.id) !== String(etapaId));
  }, 'Etapa excluída.');
}
window.paExcluirEtapa = paExcluirEtapa;

async function paFotosEtapa(etapaId, input) {
  const e0 = (window._pa.etapas || []).find(x => String(x.id) === String(etapaId));
  const arquivos = Array.from((input && input.files) || []);
  if (!e0 || !arquivos.length) return;
  const ja = (Array.isArray(e0.fotos_paths) ? e0.fotos_paths : []).length;
  if (ja + arquivos.length > PA_MAX_FOTOS) { alert(`Cada etapa aceita até ${PA_MAX_FOTOS} fotos (já tem ${ja}).`); input.value = ''; return; }
  showToast('⏳ Enviando foto(s)…', 'warning');
  await paExecutar(async () => {
    const novos = await paSubirFotos(arquivos, e0.acao_id);
    const e = Object.assign({}, e0, { fotos_paths: (e0.fotos_paths || []).concat(novos) });
    await paSalvarEtapa(e);
    await paEvento(e.acao_id, 'ETAPA', { etapa_id: e.id, texto: `${novos.length} foto(s) na etapa "${e.descricao}"`, fotos_paths: novos });
  }, '📷 Foto(s) anexada(s).');
}
window.paFotosEtapa = paFotosEtapa;

async function paComentar(acaoId) {
  const texto = String((document.getElementById('pa-c-texto') || {}).value || '').trim();
  const arquivos = paArquivosDo('pa-c-fotos');
  if (!texto && !arquivos.length) { alert('Escreva a atualização ou anexe uma foto.'); return; }
  if (arquivos.length > PA_MAX_FOTOS) { alert(`Até ${PA_MAX_FOTOS} fotos por atualização.`); return; }
  if (arquivos.length) showToast('⏳ Enviando foto(s)…', 'warning');
  await paExecutar(async () => {
    const fotos = arquivos.length ? await paSubirFotos(arquivos, acaoId) : [];
    await paEvento(acaoId, 'COMENTARIO', { texto: texto || '(foto)', fotos_paths: fotos });
    // toca a ação para "última atualização"
    const a = paAcao(acaoId);
    if (a) await paSalvarAcao(Object.assign({}, a));
  }, '💬 Atualização registrada.');
}
window.paComentar = paComentar;

// -----------------------------------------------------------------------------
// ÁREAS e PESSOAS SEM ACESSO
// -----------------------------------------------------------------------------
function paAbrirAreas() {
  const st = window._pa;
  const mc = document.getElementById('modal-container');
  if (!mc) return;
  mc.innerHTML = `
  <div onclick="event.stopPropagation()" class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-xl w-full shadow-2xl space-y-3 max-h-[90vh] overflow-y-auto text-xs">
    <div class="flex justify-between items-center border-b border-slate-800 pb-2">
      <h3 class="font-bold text-white text-base">🏷️ Áreas e responsável sugerido</h3>
      <button onclick="closeModal()" class="text-slate-400 hover:text-white font-bold text-xl leading-none">✕</button>
    </div>
    <p class="text-slate-400">Ao escolher a área numa ação, o responsável sugerido é preenchido (dá para trocar). Área desativada some da lista, mas as ações antigas continuam com ela.</p>
    ${paDatalistPessoas()}
    <table class="w-full">
      <thead class="text-slate-400 text-[10px] uppercase"><tr><th class="text-left py-1">Área</th><th class="text-left py-1">Responsável sugerido</th><th class="py-1">Ativa</th></tr></thead>
      <tbody>${(st.areas || []).map((a, i) => `<tr class="border-t border-slate-800">
        <td class="py-1 pr-2 text-white font-bold">${paEsc(a.area)}</td>
        <td class="py-1 pr-2"><input id="pa-ar-resp-${i}" list="pa-pessoas" class="${PA_INPUT}" value="${paEsc(a.responsavel_sugerido || '')}"></td>
        <td class="py-1 text-center"><input id="pa-ar-ativo-${i}" type="checkbox" ${a.ativo !== false ? 'checked' : ''}></td></tr>`).join('')}
      <tr class="border-t border-slate-700"><td class="py-1 pr-2"><input id="pa-ar-nova" class="${PA_INPUT}" placeholder="Nova área"></td><td class="py-1 pr-2"><input id="pa-ar-nova-resp" list="pa-pessoas" class="${PA_INPUT}" placeholder="Responsável"></td><td></td></tr>
      </tbody>
    </table>
    <div class="flex justify-end gap-2"><button onclick="closeModal()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 ${PA_BTN}">Cancelar</button>
      <button onclick="paSalvarAreas()" class="bg-emerald-600 hover:bg-emerald-500 text-white ${PA_BTN}">💾 Salvar</button></div>
  </div>`;
  mc.classList.remove('hidden');
}
window.paAbrirAreas = paAbrirAreas;

async function paSalvarAreas() {
  const st = window._pa;
  const mudadas = [];
  (st.areas || []).forEach((a, i) => {
    const resp = String((document.getElementById(`pa-ar-resp-${i}`) || {}).value || '').trim().toUpperCase();
    const ativo = !!(document.getElementById(`pa-ar-ativo-${i}`) || {}).checked;
    if (resp !== String(a.responsavel_sugerido || '') || ativo !== (a.ativo !== false)) mudadas.push({ area: a.area, responsavel_sugerido: resp || null, ativo });
  });
  const nova = String((document.getElementById('pa-ar-nova') || {}).value || '').trim().toUpperCase();
  if (nova) {
    if ((st.areas || []).some(a => paNorm(a.area) === paNorm(nova))) { alert('Essa área já existe.'); return; }
    mudadas.push({ area: nova, responsavel_sugerido: String((document.getElementById('pa-ar-nova-resp') || {}).value || '').trim().toUpperCase() || null, ativo: true });
  }
  if (!mudadas.length) { closeModal(); return; }
  await paExecutar(async () => {
    for (const m of mudadas) {
      m.atualizado_por = paUsuario(); m.atualizado_em = paAgora();
      const salvo = await paGravar('pa_areas', m, 'area');
      paSubstituirLocal(st.areas, salvo, 'area');
    }
    st.areas.sort((a, b) => String(a.area).localeCompare(String(b.area)));
    closeModal();
  }, '🏷️ Áreas salvas.');
}
window.paSalvarAreas = paSalvarAreas;

function paPessoasSemAcesso() {
  const mapa = new Map();
  const add = (nome, tipo) => {
    if (!nome || paResolverUsuario(nome)) return;
    const k = paNorm(nome);
    if (!mapa.has(k)) mapa.set(k, { nome: String(nome).toUpperCase(), acoes: 0, etapas: 0 });
    mapa.get(k)[tipo]++;
  };
  (window._pa.acoes || []).forEach(a => add(a.responsavel_nome, 'acoes'));
  (window._pa.etapas || []).forEach(e => add(e.responsavel_nome, 'etapas'));
  return Array.from(mapa.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}
function paAbrirSemAcesso() {
  const lista = paPessoasSemAcesso();
  const mc = document.getElementById('modal-container');
  if (!mc) return;
  mc.innerHTML = `
  <div onclick="event.stopPropagation()" class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full shadow-2xl space-y-3 max-h-[90vh] overflow-y-auto text-xs">
    <div class="flex justify-between items-center border-b border-slate-800 pb-2">
      <h3 class="font-bold text-white text-base">👤 Responsáveis sem acesso ao app</h3>
      <button onclick="closeModal()" class="text-slate-400 hover:text-white font-bold text-xl leading-none">✕</button>
    </div>
    <p class="text-slate-400">Nomes digitados como responsáveis que não batem com nenhum login ativo. Cadastre em Logins e Senhas com o mesmo nome e eles somem daqui.</p>
    ${lista.length ? `<table class="w-full"><thead class="text-slate-400 text-[10px] uppercase"><tr><th class="text-left py-1">Nome</th><th class="py-1">Ações</th><th class="py-1">Etapas</th></tr></thead><tbody>
      ${lista.map(p => `<tr class="border-t border-slate-800"><td class="py-1 text-white font-bold">${paEsc(p.nome)}</td><td class="py-1 text-center">${p.acoes}</td><td class="py-1 text-center">${p.etapas}</td></tr>`).join('')}
    </tbody></table>` : '<div class="text-slate-500">Todos os responsáveis já têm login. 👍</div>'}
  </div>`;
  mc.classList.remove('hidden');
}
window.paAbrirSemAcesso = paAbrirSemAcesso;

// -----------------------------------------------------------------------------
// EXPORTAÇÕES
// -----------------------------------------------------------------------------
function paNomeArquivo(base, ext) {
  const d = new Date();
  return `${base} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}.${ext}`;
}
// 7.9.1: IMPRESSÃO, não arquivo PDF (pedido do Tiago em 26/11): abre a prévia
// numa janela do app com o botão Imprimir, no mesmo padrão da Via da portaria
// (escala.js). Quem quiser PDF escolhe "Salvar como PDF" na caixa de impressão.
function paAbrirImpressao(html, titulo, voltarFicha) {
  const mc = document.getElementById('modal-container');
  if (!mc) return;
  mc.innerHTML = `
  <div onclick="event.stopPropagation()" class="bg-slate-900 border border-slate-700 rounded-xl p-4 max-w-6xl w-full h-[92vh] shadow-2xl flex flex-col gap-3 text-xs">
    <div class="flex justify-between items-center">
      <h3 class="font-bold text-white text-base">🖨️ ${paEsc(titulo)}</h3>
      <button onclick="${voltarFicha ? `paAbrirFicha(${Number(voltarFicha)})` : 'closeModal()'}" class="text-slate-400 hover:text-white font-bold text-xl leading-none">✕</button>
    </div>
    <p class="text-[11px] text-slate-400">Confira a prévia e clique em Imprimir. Para guardar em arquivo, escolha <b>Salvar como PDF</b> como impressora.</p>
    <iframe id="pa-impressao-frame" class="bg-white rounded flex-1 w-full border-0"></iframe>
    <div class="flex justify-end gap-2">
      <button onclick="${voltarFicha ? `paAbrirFicha(${Number(voltarFicha)})` : 'closeModal()'}" class="bg-slate-800 hover:bg-slate-700 text-slate-300 ${PA_BTN}">Fechar</button>
      <button onclick="paImprimirFrame()" class="bg-amber-600 hover:bg-amber-500 text-white ${PA_BTN}">🖨️ Imprimir</button>
    </div>
  </div>`;
  mc.classList.remove('hidden');
  document.getElementById('pa-impressao-frame').srcdoc = html;
}
function paImprimirFrame() {
  const f = document.getElementById('pa-impressao-frame');
  if (!f || !f.contentWindow) return;
  f.contentWindow.focus();
  f.contentWindow.print();
}
window.paImprimirFrame = paImprimirFrame;
async function paEntregar(blob, nome, rotulo) {
  if (typeof _entregarPdf === 'function' && /\.pdf$/i.test(nome)) return _entregarPdf(blob, nome, rotulo);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  showToast(`Arquivo baixado (${nome}).`);
}
const PA_CSS_PDF = `
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  thead{display:table-header-group} tr,.evitar{page-break-inside:avoid;break-inside:avoid}
  @media screen{body{padding:12px}}
  html,body{margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:10px}
  .cab{display:flex;align-items:center;gap:14px;border-bottom:3px solid #14532d;padding-bottom:6px;margin-bottom:8px}
  .cab img{height:46px} .cab h1{margin:0;font-size:18px;color:#14532d;letter-spacing:.5px} .cab .sub{color:#555;font-size:10px;margin-top:2px}
  table{border-collapse:collapse;width:100%} th{background:#14532d;color:#fff;font-size:9px;text-transform:uppercase;padding:4px;text-align:left}
  td{border:1px solid #d4d4d4;padding:4px;vertical-align:top} tr:nth-child(even) td{background:#f8faf8}
  .selo{display:inline-block;padding:1px 6px;border-radius:3px;font-weight:bold;font-size:9px;white-space:nowrap}
  .c{text-align:center} .nw{white-space:nowrap} .mut{color:#666;font-size:9px}
  .cards{display:flex;gap:10px;margin-bottom:8px} .bloco{flex:1;border:1px solid #d4d4d4;border-radius:4px;padding:5px}
  .bloco h3{margin:0 0 3px;font-size:10px;color:#14532d;text-transform:uppercase} .bloco td{border:0;border-bottom:1px solid #eee;padding:2px 3px;background:none!important}
`;
function paTempoPdf(t) {
  if (t === null) return '';
  const cor = t > 2 ? '#bbf7d0' : t >= 0 ? '#fde68a' : '#fecaca';
  return `<span class="selo" style="background:${cor}">${t}</span>`;
}
function paSeloPdf(a) {
  const ef = paStatusEfetivo(a);
  return `<span class="selo" style="background:${PA_STATUS[ef].pdf}">${PA_STATUS[ef].label}${paPrazoVencidoAguardando(a) ? ' · prazo vencido' : ''}</span>`;
}
function paImprimirPainel() {
  const lista = paFiltrar();
  if (!lista.length) { alert('Nenhuma ação com os filtros atuais.'); return; }
  const r = paResumo(lista);
  const logo = new URL(PA_LOGO, location.href).href;
  const blocoTab = (titulo, linhas) => `<div class="bloco"><h3>${titulo}</h3><table>${linhas}</table></div>`;
  const stLin = PA_ORDEM_CARDS.filter(s => r.porStatus[s]).map(s => `<tr><td>${PA_STATUS[s].label}</td><td class="c">${r.porStatus[s]}</td><td class="c">${r.pct(r.porStatus[s])}%</td></tr>`).join('');
  const arLin = Object.keys(r.porArea).sort((a, b) => r.porArea[b] - r.porArea[a]).map(k => `<tr><td>${paEsc(k)}</td><td class="c">${r.porArea[k]}</td><td class="c">${r.pct(r.porArea[k])}%</td></tr>`).join('');
  const rsLin = Object.keys(r.porResp).sort((a, b) => r.porResp[b].qtd - r.porResp[a].qtd).map(k => `<tr><td>${paEsc(k)}</td><td class="c">${r.porResp[k].qtd}</td><td class="c">${r.pct(r.porResp[k].qtd)}%</td><td class="c" style="color:#b91c1c">${r.porResp[k].atrasadas || ''}</td></tr>`).join('');
  const linhas = lista.map(a => {
    const p = paProgresso(a.id);
    return `<tr>
      <td class="nw"><b>${paCodigo(a)}</b></td>
      <td><b>${paEsc(a.acao)}</b>${a.origem ? `<div class="mut">Origem: ${paEsc(a.origem)}${a.origem_data ? ' · ' + paData(a.origem_data) : ''}</div>` : ''}</td>
      <td>${paEsc(a.descricao || '')}</td>
      <td>${paEsc(a.local || '')}</td>
      <td>${paEsc(a.area || '')}</td>
      <td>${paEsc(a.responsavel_nome || '')}</td>
      <td class="nw">${paData(a.inicio)}</td>
      <td class="nw">${paData(a.prazo)}${a.qtd_adiamentos ? `<div class="mut">adiada ${a.qtd_adiamentos}x</div>` : ''}</td>
      <td class="nw">${paData(a.data_realizada)}</td>
      <td>${paSeloPdf(a)}</td>
      <td class="c">${paTempoPdf(paTempo(a))}</td>
      <td class="c nw">${p ? `${p.feitas}/${p.total}` : ''}</td>
    </tr>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PLANO DE AÇÃO ${paNomeArquivo('', '').trim().replace(/\.$/, '')}</title><style>@page{size:A4 landscape;margin:8mm}${PA_CSS_PDF}</style></head><body>
    <div class="cab"><img src="${logo}"><div><h1>PLANO DE AÇÃO</h1><div class="sub">${paEsc(paTextoFiltros())} · ${r.total} ação(ões) · impresso em ${paDataHora(paAgora())} por ${paEsc(paUsuario())}</div></div></div>
    <div class="cards">${blocoTab('Por status', stLin)}${blocoTab('Por área', arLin)}${blocoTab('Por responsável <span style="color:#b91c1c;font-weight:normal">(atrasadas)</span>', rsLin)}</div>
    <table><thead><tr><th>Código</th><th>Ação (o quê?)</th><th>Como?</th><th>Onde?</th><th>Área</th><th>Quem?</th><th>Início</th><th>Prazo</th><th>Realizada</th><th>Status</th><th>Tempo</th><th>Etapas</th></tr></thead>
    <tbody>${linhas}</tbody></table>
  </body></html>`;
  paAbrirImpressao(html, `Imprimir plano de ação · ${r.total} ação(ões)`);
}
window.paImprimirPainel = paImprimirPainel;

function paImprimirAcao(id) {
  const a = paAcao(id);
  if (!a) return;
  const logo = new URL(PA_LOGO, location.href).href;
  const etapas = paEtapasDa(id);
  const eventos = paEventosDa(id);
  const fotos = l => (Array.isArray(l) && l.length) ? `<div style="margin-top:3px">${l.map(c => `<img src="${paEsc(paUrlFoto(c))}" crossorigin="anonymous" style="height:90px;margin:2px;border:1px solid #ccc;border-radius:3px">`).join('')}</div>` : '';
  const campo = (r, v) => `<td style="width:25%"><div class="mut">${r}</div><b>${v || '—'}</b></td>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PLANO DE AÇÃO ${paCodigo(a)}</title><style>@page{size:A4 portrait;margin:10mm}${PA_CSS_PDF} td{font-size:10px}</style></head><body>
    <div class="cab"><img src="${logo}"><div><h1>PLANO DE AÇÃO · ${paCodigo(a)}</h1><div class="sub">${a.origem ? 'Origem: ' + paEsc(a.origem) + (a.origem_data ? ' · ' + paData(a.origem_data) : '') + ' · ' : ''}impresso em ${paDataHora(paAgora())}</div></div></div>
    <table><tr><td colspan="4" style="font-size:13px"><div class="mut">Ação (o quê?)</div><b>${paEsc(a.acao)}</b></td></tr>
      <tr><td colspan="4"><div class="mut">Descrição (como?)</div>${paEsc(a.descricao || '—').replace(/\n/g, '<br>')}</td></tr>
      <tr>${campo('Área', paEsc(a.area))}${campo('Responsável (quem?)', paEsc(a.responsavel_nome))}${campo('Local (onde?)', paEsc(a.local))}${campo('Status', paSeloPdf(a))}</tr>
      <tr>${campo('Início', paData(a.inicio))}${campo('Prazo', paData(a.prazo) + (a.qtd_adiamentos ? ` (orig. ${paData(a.prazo_original)}, adiada ${a.qtd_adiamentos}x)` : ''))}${campo('Realizada', paData(a.data_realizada))}${campo('Tempo (dias)', paTempo(a) === null ? '' : paTempoPdf(paTempo(a)))}</tr>
      ${a.motivo_status && ['AGUARDANDO', 'CANCELADA'].includes(a.status) ? `<tr><td colspan="4"><div class="mut">Motivo</div>${paEsc(a.motivo_status)}</td></tr>` : ''}
    </table>
    <h3 style="color:#14532d;margin:10px 0 4px">ETAPAS</h3>
    ${etapas.length ? `<table><thead><tr><th>#</th><th>Etapa</th><th>Responsável</th><th>Prazo</th><th>Status</th><th>Realizada</th></tr></thead><tbody>
      ${etapas.map((e, i) => `<tr class="evitar"><td class="c">${i + 1}</td><td>${paEsc(e.descricao)}${fotos(e.fotos_paths)}</td><td>${paEsc(e.responsavel_nome || '')}</td><td class="nw">${paData(e.prazo)}</td><td><span class="selo" style="background:${PA_STATUS[e.status].pdf}">${PA_STATUS[e.status].label}</span></td><td class="nw">${paData(e.data_realizada)}</td></tr>`).join('')}
    </tbody></table>` : '<div class="mut">Sem etapas.</div>'}
    <h3 style="color:#14532d;margin:10px 0 4px">LINHA DO TEMPO</h3>
    <table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th></tr></thead><tbody>
      ${eventos.map(ev => `<tr class="evitar"><td class="nw">${paDataHora(ev.criado_em)}</td><td>${paEsc(ev.autor || '')}</td><td>${paEsc(ev.texto || '')}${fotos(ev.fotos_paths)}</td></tr>`).join('')}
    </tbody></table>
  </body></html>`;
  paAbrirImpressao(html, `Imprimir ${paCodigo(a)}`, id);
}
window.paImprimirAcao = paImprimirAcao;

// ExcelJS só é carregado na hora de exportar (quase 1 MB), não na abertura do app.
function paCarregarExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = './js/exceljs.min.js';
    s.onload = () => window.ExcelJS ? ok(window.ExcelJS) : erro(new Error('ExcelJS não carregou.'));
    s.onerror = () => erro(new Error('Não foi possível carregar a biblioteca do Excel. Confira a internet e recarregue.'));
    document.head.appendChild(s);
  });
}
async function paLogoBase64() {
  const resp = await fetch(PA_LOGO);
  const blob = await resp.blob();
  return new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = erro; r.readAsDataURL(blob); });
}
function paDataXls(iso) {
  if (!iso) return null;
  const p = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}
async function paExportarXlsx() {
  const lista = paFiltrar();
  if (!lista.length) { alert('Nenhuma ação com os filtros atuais.'); return; }
  showToast('⏳ Gerando Excel…', 'warning');
  try {
    const ExcelJS = await paCarregarExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'JR-Oper';
    const ws = wb.addWorksheet('AÇÕES', { views: [{ state: 'frozen', ySplit: 4 }] });
    const cols = [
      ['Código', 10], [' Ação (O quê?)', 40], ['Descrição das ações (Como?)', 45], ['Área', 18], ['Responsável (Quem?)', 20],
      ['Local (Onde?)', 20], ['Origem', 24], ['Início', 11], ['Final (Prazo)', 12], ['Prazo original', 12], ['Adiamentos', 10],
      ['Comentário (última atualização)', 40], ['Data Realizada', 12], ['Status', 16], ['Tempo', 8], ['Etapas', 9]
    ];
    ws.columns = cols.map(([, w]) => ({ width: w }));
    try {
      const logo = wb.addImage({ base64: await paLogoBase64(), extension: 'png' });
      ws.addImage(logo, { tl: { col: 0.2, row: 0.1 }, ext: { width: 120, height: 66 } });
    } catch (_) { /* sem logo o arquivo sai do mesmo jeito */ }
    ws.mergeCells(1, 2, 2, cols.length);
    const tit = ws.getCell(1, 2);
    tit.value = 'PLANO DE AÇÃO';
    tit.font = { bold: true, size: 20, color: { argb: 'FF14532D' } };
    tit.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 28; ws.getRow(2).height = 28;
    ws.mergeCells(3, 2, 3, cols.length);
    ws.getCell(3, 2).value = `${paTextoFiltros()} · ${lista.length} ação(ões) · gerado em ${paDataHora(paAgora())}`;
    ws.getCell(3, 2).font = { italic: true, size: 9, color: { argb: 'FF555555' } };
    ws.getCell(3, 2).alignment = { horizontal: 'center' };
    const cab = ws.getRow(4);
    cols.forEach(([n], i) => { cab.getCell(i + 1).value = n.trim(); });
    cab.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532D' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    cab.height = 30;
    const borda = { top: { style: 'thin', color: { argb: 'FFD4D4D4' } }, left: { style: 'thin', color: { argb: 'FFD4D4D4' } }, bottom: { style: 'thin', color: { argb: 'FFD4D4D4' } }, right: { style: 'thin', color: { argb: 'FFD4D4D4' } } };
    lista.forEach(a => {
      const ult = paEventosDa(a.id).find(e => e.tipo === 'COMENTARIO');
      const p = paProgresso(a.id);
      const ef = paStatusEfetivo(a);
      const t = paTempo(a);
      const row = ws.addRow([
        paCodigo(a), a.acao, a.descricao || '', a.area || '', a.responsavel_nome || '', a.local || '',
        [a.origem, a.origem_data ? paData(a.origem_data) : ''].filter(Boolean).join(' · '),
        paDataXls(a.inicio), paDataXls(a.prazo), paDataXls(a.prazo_original), a.qtd_adiamentos || 0,
        ult ? `${paData(ult.criado_em)} ${ult.autor || ''}: ${ult.texto || ''}` : '',
        paDataXls(a.data_realizada), PA_STATUS[ef].label.toUpperCase() + (paPrazoVencidoAguardando(a) ? ' (PRAZO VENCIDO)' : ''),
        t, p ? `${p.feitas}/${p.total}` : ''
      ]);
      row.eachCell({ includeEmpty: true }, (c, n) => {
        c.border = borda;
        c.alignment = { vertical: 'top', wrapText: [2, 3, 12].includes(n), horizontal: [1, 8, 9, 10, 11, 13, 15, 16].includes(n) ? 'center' : 'left' };
        if ([8, 9, 10, 13].includes(n)) c.numFmt = 'dd/mm/yyyy';
      });
      row.getCell(14).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PA_STATUS[ef].xls } };
      row.getCell(14).font = { bold: true };
      if (t !== null) {
        row.getCell(15).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: t > 2 ? 'FFBBF7D0' : t >= 0 ? 'FFFDE68A' : 'FFFECACA' } };
        row.getCell(15).font = { bold: true };
      }
    });
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + lista.length, column: cols.length } };

    const we = wb.addWorksheet('ETAPAS', { views: [{ state: 'frozen', ySplit: 1 }] });
    we.columns = [{ header: 'Código', width: 10 }, { header: 'Ação', width: 40 }, { header: 'Nº', width: 5 }, { header: 'Etapa', width: 45 },
      { header: 'Responsável', width: 20 }, { header: 'Prazo', width: 12 }, { header: 'Status', width: 16 }, { header: 'Realizada', width: 12 }, { header: 'Fotos', width: 7 }];
    we.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532D' } };
    });
    lista.forEach(a => paEtapasDa(a.id).forEach((e, i) => {
      const row = we.addRow([paCodigo(a), a.acao, i + 1, e.descricao, e.responsavel_nome || '', paDataXls(e.prazo), PA_STATUS[e.status].label.toUpperCase(), paDataXls(e.data_realizada), (e.fotos_paths || []).length]);
      row.getCell(6).numFmt = 'dd/mm/yyyy'; row.getCell(8).numFmt = 'dd/mm/yyyy';
      row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PA_STATUS[e.status].xls } };
      row.eachCell({ includeEmpty: true }, c => { c.border = borda; c.alignment = { vertical: 'top', wrapText: true }; });
    }));

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await paEntregar(blob, paNomeArquivo('PLANO DE AÇÃO', 'xlsx'), 'Plano de Ação');
  } catch (e) { alert('❌ ' + (e.message || e)); }
}
window.paExportarXlsx = paExportarXlsx;
