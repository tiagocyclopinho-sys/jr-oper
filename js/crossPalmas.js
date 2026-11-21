// =============================================================================
// CROSS PALMAS (7.6.0, 18/11/2026, migration 81)
//
// Pedido do Tiago: as devoluções das rotas que passam pelo cross-docking de
// Palmas ficam acumuladas lá até haver transbordo com veículo NOSSO (terceiro
// só deixa carga e segue, nunca traz de volta). A viagem fecha no cross; o
// produto só fecha quando o CD de Araguaína confere. Faltava o meio.
//
// Quem alimenta (decisões do Tiago em 18/11):
//   - SAC registra a devolução, como hoje (nada muda);
//   - a pessoa de Palmas (perfil CROSS) marca ITEM A ITEM o que chegou da rota
//     no cross e o que subiu no transbordo (manifesto com placa e viagem);
//   - o CD confere no Retorno Físico, como hoje, e agora vê o que o manifesto
//     diz que veio.
// O confronto é registrado × recebido no cross × embarcado × conferido no CD.
//
// Grava direto na nuvem (tabela cross_movimentos), como a Escala: nada vai
// para o localStorage nem para o pull de 2 min. Correção = exclusão lógica do
// movimento e lançamento novo; o histórico fica.
//
// Reentregas de Palmas não passam por aqui: usam o recebimento/despacho que já
// existe, com o local "CROSS PALMAS" (ver handleSalvarRecebimentoReentrega).
// =============================================================================

window._cross = window._cross || {
  movs: null,          // movimentos vivos (is_deleted = false)
  carregando: false,
  erro: '',
  carregadoEm: 0,
  sub: 'receber',      // receber | estoque | manifestos | confronto | reentregas
  soRotasCross: true,
  busca: ''
};

// Rotas que, pela operação, passam pelo cross de Palmas. A lista da matriz da
// Escala (rotas com transbordo PALMAS) completa esta em tempo real. Serve só
// para ORDENAR a lista de recebimento: a pessoa de Palmas pode receber qualquer
// devolução pendente, de qualquer rota.
const CROSS_ROTAS_BASE = ['PALMAS', 'TAQUARALTO', 'PALMEIROPOLIS', 'DIANOPOLIS', 'PORTO', 'NATIVIDADE', 'PARAISO'];

function crossEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function crossNorm(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function crossUsuario() {
  return (typeof db !== 'undefined' && db.currentUser && db.currentUser.nome) ? db.currentUser.nome : 'SISTEMA';
}

function crossNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function crossQtdTxt(n) {
  const v = Math.round(crossNum(n) * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR');
}

function crossDataHora(v) {
  return (typeof formatarDataHora === 'function') ? formatarDataHora(v, '—') : (v || '—');
}

function crossRotaEhDoCross(rota) {
  const r = crossNorm(rota);
  if (!r) return false;
  if (CROSS_ROTAS_BASE.some(p => r.indexOf(p) > -1)) return true;
  const st = window._escala;
  const matrizes = (st && Array.isArray(st.matrizes)) ? st.matrizes : [];
  const transbPalmas = new Set(matrizes.filter(m => crossNorm(m.rota).indexOf('PALMAS') > -1 && m.setor === 'TRANSBORDO').map(m => String(m.id)));
  return matrizes.some(m => m.transbordo_id && transbPalmas.has(String(m.transbordo_id)) && crossNorm(m.rota) === r);
}

// -----------------------------------------------------------------------------
// NUVEM
// -----------------------------------------------------------------------------
async function crossCarregar(forcar = false) {
  const st = window._cross;
  if (st.carregando) return;
  if (!forcar && st.movs && (Date.now() - st.carregadoEm) < 60000) return;
  const cs = window.cloudStore;
  if (!cs || !cs.isConfigured()) {
    st.erro = 'Sem conexão com a nuvem configurada neste aparelho.';
    st.movs = st.movs || [];
    return;
  }
  st.carregando = true; st.erro = '';
  try {
    // Sem order= de propósito: assim o getAll pagina por id (id nasce do
    // relógio, então a ordem já é a de lançamento).
    const m = await cs.getAll('cross_movimentos', 'is_deleted=is.false');
    if (!m) throw new Error('Não foi possível ler os movimentos do cross. Confira a rede (ou se a migration 81 já foi aplicada).');
    st.movs = m;
    st.carregadoEm = Date.now();
  } catch (e) {
    st.erro = e.message || String(e);
    st.movs = st.movs || [];
  } finally {
    // Carimba também na falha: sem isso, a tela redesenhada pediria de novo,
    // falharia de novo e redesenharia, em laço.
    st.carregadoEm = Date.now();
    st.carregando = false;
    if (typeof renderApp === 'function') renderApp();
  }
}
window.crossCarregar = crossCarregar;

// Garante os dados sem entrar em laço: quem desenha chama isto, e o
// carregamento chama renderApp uma vez ao terminar. Relê a cada 2 min, para o
// Retorno Físico aberto o dia todo no CD ver o manifesto que Palmas acabou de
// gerar (uma leitura pequena, só quando a tela é desenhada).
function crossGarantirDados() {
  const st = window._cross;
  if (st.carregando) return;
  if (!st.movs || (Date.now() - st.carregadoEm) > 120000) crossCarregar(true);
}

async function crossGravar(registros) {
  const cs = window.cloudStore;
  if (!cs || !cs.isConfigured()) throw new Error('Sem conexão com a nuvem configurada neste aparelho.');
  const lista = Array.isArray(registros) ? registros : [registros];
  if (!lista.length) return;
  const chaves = new Set();
  lista.forEach(r => Object.keys(r).forEach(k => { if (k.charAt(0) !== '_') chaves.add(k); }));
  const corpo = lista.map(r => {
    const o = {};
    chaves.forEach(k => { o[k] = (r[k] === undefined || r[k] === '') ? null : r[k]; });
    return o;
  });
  const resp = await fetch(`${cs.config.url}/rest/v1/cross_movimentos`, {
    method: 'POST',
    headers: cs._headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(corpo)
  });
  if (!resp.ok) throw new Error(`A nuvem recusou a gravação (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
}

function crossNovoMov(tipo, dev, item, qtd, extra) {
  const agora = agoraIsoBrasilia();
  return Object.assign({
    id: db.gerarIdUnico(),
    tipo,
    local_cross: 'PALMAS',
    devolucao_id: Number(dev.id),
    numero_devolucao: dev.numero_devolucao || dev.numero_protocolo || null,
    item_id: item ? Number(item.id) : null,
    produto_id: item && item.produto_id ? Number(item.produto_id) || null : null,
    produto_descricao: item ? String(item.produto_descricao || '').slice(0, 200) : null,
    quantidade: qtd,
    criado_por: crossUsuario(),
    criado_em: agora,
    atualizado_por: crossUsuario(),
    atualizado_em: agora,
    is_deleted: false
  }, extra || {});
}

// -----------------------------------------------------------------------------
// ESTADO (usado também pelo Retorno Físico, em app.js)
// -----------------------------------------------------------------------------
function crossMovsDaDevolucao(devId) {
  const movs = window._cross.movs || [];
  return movs.filter(m => String(m.devolucao_id) === String(devId) && !m.is_deleted);
}

// Destinos do CD em que nada chega fisicamente ao CD (7.7.0).
const CROSS_DESTINOS_SEM_FISICO = ['FALTA_SEM_RETORNO', 'RENEGOCIADO_ROTA'];

// Quantidade que o CD conferiu FISICAMENTE de um item (null enquanto não
// conferiu). Sem divergência, a conferência é a quantidade registrada; com
// divergência, a do relatório. Item fechado como falta/renegociado = 0. Do
// total sai o que Palmas descartou (7.7.0): isso nunca chegaria ao CD.
function crossQtdConferidaCd(dev, item, descartado = 0) {
  if (!dev || dev.status_fechamento === 'PENDENTE_FISICO') return null;
  let base = crossNum(item.quantidade);
  if (CROSS_DESTINOS_SEM_FISICO.indexOf(String(item.destino_item || '').toUpperCase()) > -1) return 0;
  try {
    const rel = (typeof relatorioDivergenciaDaDevolucao === 'function') ? relatorioDivergenciaDaDevolucao(dev.id) : null;
    const div = (rel && typeof itemDivergenteCorrespondente === 'function') ? itemDivergenteCorrespondente(rel, item) : null;
    if (div && div.quantidade_recebida !== undefined && div.quantidade_recebida !== null) base = crossNum(div.quantidade_recebida);
  } catch (e) {}
  return Math.max(0, base - descartado);
}

// Estado de cada item e da devolução no cross. `via` = a devolução passou pelo
// cross (há ao menos um movimento). Sem movimento, o Retorno Físico segue como
// era antes da 7.6.0.
function crossEstadoDevolucao(dev) {
  const movs = crossMovsDaDevolucao(dev.id);
  const itens = (Array.isArray(dev.itens) ? dev.itens : []).map(item => {
    const doItem = movs.filter(m => String(m.item_id) === String(item.id));
    const soma = tipo => doItem.filter(m => m.tipo === tipo).reduce((s, m) => s + crossNum(m.quantidade), 0);
    const recs = doItem.filter(m => m.tipo === 'RECEBIDO_CROSS');
    const rec = recs.reduce((s, m) => s + crossNum(m.quantidade), 0);
    // 7.7.0: sem produto físico (falta, inversão, renegociado) e descarte de
    // avaria em Palmas. Nenhum dos dois entra no transbordo.
    const semProduto = soma('SEM_PRODUTO');
    const temSemProduto = doItem.some(m => m.tipo === 'SEM_PRODUTO');
    const desc = soma('DESCARTE');
    // Item já conferido no cross: tem lançamento de recebimento (mesmo que de
    // quantidade menor ou zero, "não chegou") ou foi marcado sem produto. Sai
    // da lista "Receber da rota"; a diferença fica no Confronto.
    const recebido = recs.length > 0 || temSemProduto;
    const embs = doItem.filter(m => m.tipo === 'EMBARQUE');
    const emb = embs.reduce((s, m) => s + crossNum(m.quantidade), 0);
    const reg = crossNum(item.quantidade);
    const cd = crossQtdConferidaCd(dev, item, desc);
    const divergencias = [];
    if (recebido || emb > 0) {
      const conta = rec + semProduto;
      if (conta < reg) divergencias.push(`chegou ${crossQtdTxt(rec)} de ${crossQtdTxt(reg)} no cross`);
      if (conta > reg) divergencias.push(`cross recebeu ${crossQtdTxt(rec)}${semProduto ? ` + ${crossQtdTxt(semProduto)} sem produto` : ''}, registrado ${crossQtdTxt(reg)}`);
      if (cd !== null && cd < emb) divergencias.push(`embarcou ${crossQtdTxt(emb)}, CD conferiu ${crossQtdTxt(cd)}`);
      if (cd !== null && cd > emb) divergencias.push(`CD conferiu ${crossQtdTxt(cd)}, embarque só de ${crossQtdTxt(emb)}`);
    }
    return {
      item, reg, rec, recebido, emb, cd, semProduto, desc,
      saldo: Math.max(0, rec - emb - desc),
      manifestos: Array.from(new Set(embs.map(m => m.manifesto).filter(Boolean))),
      placas: Array.from(new Set(embs.map(m => m.placa).filter(Boolean))),
      divergencias
    };
  });
  const via = movs.length > 0;
  const totRec = itens.reduce((s, i) => s + i.rec, 0);
  const totEmb = itens.reduce((s, i) => s + i.emb, 0);
  const totSaldo = itens.reduce((s, i) => s + i.saldo, 0);
  const totSemProduto = itens.reduce((s, i) => s + i.semProduto, 0);
  const totDesc = itens.reduce((s, i) => s + i.desc, 0);
  const pendenteCd = dev.status_fechamento === 'PENDENTE_FISICO';
  const recebidoEm = movs.filter(m => m.tipo === 'RECEBIDO_CROSS').map(m => m.criado_em).sort()[0] || null;
  const todosConferidos = itens.length > 0 && itens.every(i => i.recebido);
  let local = 'NA_ROTA';
  if (!pendenteCd) local = 'NO_CD';
  else if (totSaldo > 0) local = 'NO_CROSS';
  else if (totEmb > 0) local = 'EM_TRANSBORDO';
  // Tudo conferido em Palmas e nada para embarcar: só sem produto e/ou
  // descartado. O CD fecha sem esperar transbordo (7.7.0).
  else if (todosConferidos && (totSemProduto + totDesc) > 0) local = 'SEM_RETORNO';
  else if (totRec > 0) local = 'NO_CROSS';
  const rotulo = {
    NA_ROTA: 'Na rota',
    NO_CROSS: totEmb > 0 ? `No cross Palmas (parte embarcada)` : 'No cross Palmas',
    EM_TRANSBORDO: 'Em transbordo para Araguaína',
    SEM_RETORNO: 'Nada a voltar de Palmas',
    NO_CD: 'Conferido no CD'
  }[local];
  return {
    via, local, rotulo, itens, totRec, totEmb, totSaldo, totSemProduto, totDesc, recebidoEm,
    divergencias: itens.reduce((n, i) => n + i.divergencias.length, 0),
    manifestos: Array.from(new Set(itens.flatMap(i => i.manifestos))),
    placas: Array.from(new Set(itens.flatMap(i => i.placas)))
  };
}
window.crossEstadoDevolucao = crossEstadoDevolucao;

function crossDiasDesde(iso) {
  if (!iso) return null;
  const ms = (typeof _parseDataFlex === 'function') ? _parseDataFlex(iso) : Date.parse(iso);
  if (ms === null || isNaN(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

// Selo para a grade do Retorno Físico (app.js, buildRow).
function crossSeloRetornoFisico(dev) {
  const st = window._cross;
  if (!st.movs) return '';
  const e = crossEstadoDevolucao(dev);
  if (!e.via) return '';
  const cls = {
    NO_CROSS: 'bg-orange-950 text-orange-300 border-orange-700',
    EM_TRANSBORDO: 'bg-sky-950 text-sky-300 border-sky-700',
    SEM_RETORNO: 'bg-violet-950 text-violet-300 border-violet-700',
    NO_CD: 'bg-emerald-950 text-emerald-300 border-emerald-700',
    NA_ROTA: 'bg-slate-800 text-slate-300 border-slate-600'
  }[e.local];
  const extras = [
    e.totSemProduto ? `${crossQtdTxt(e.totSemProduto)} sem produto` : '',
    e.totDesc ? `${crossQtdTxt(e.totDesc)} descartado(s) em Palmas` : ''
  ].filter(Boolean).join(', ');
  const detalhe = e.local === 'NO_CROSS'
    ? ` · ${crossQtdTxt(e.totSaldo)} un. em Palmas${e.recebidoEm ? ` há ${crossDiasDesde(e.recebidoEm)} d` : ''}`
    : e.local === 'SEM_RETORNO'
      ? ` · ${extras} · o CD pode fechar`
      : (e.placas.length ? ` · ${e.placas.join(', ')}` : '');
  const div = e.divergencias ? `<span class="inline-block mt-0.5 ml-1 bg-red-950 text-red-300 border border-red-700 px-1.5 py-0.5 rounded text-[9px] font-bold" title="Registrado × cross × embarque × CD não batem">⚠ ${e.divergencias} divergência(s)</span>` : '';
  return `<span class="inline-block mt-0.5 border px-1.5 py-0.5 rounded text-[9px] font-bold ${cls}" title="Local atual pelo Cross Palmas">📍 ${crossEsc(e.rotulo)}${crossEsc(detalhe)}</span>${div}`;
}
window.crossSeloRetornoFisico = crossSeloRetornoFisico;

// Bloco para o modal de conferência do CD (app.js, openCdModal).
function crossBlocoConferenciaCd(dev) {
  const st = window._cross;
  if (!st.movs) return '';
  const e = crossEstadoDevolucao(dev);
  if (!e.via) return '';
  const avisos = [];
  if (e.local === 'NO_CROSS') avisos.push(`<div class="text-orange-300 font-bold mb-1">⚠️ Pelo Cross Palmas, ${crossQtdTxt(e.totSaldo)} unidade(s) desta devolução ainda NÃO embarcaram. Se chegou aqui, marque como divergência e anote.</div>`);
  if (e.totEmb > 0) avisos.push(`<div class="text-sky-300 font-bold mb-1">🚛 Veio pelo transbordo ${crossEsc(e.placas.join(', ') || '')}${e.manifestos.length ? ` · manifesto ${crossEsc(e.manifestos.join(', '))}` : ''}. Confira contra a coluna "Embarcado".</div>`);
  if (e.totSemProduto || e.totDesc) avisos.push(`<div class="text-violet-300 font-bold mb-1">🟣 Não volta de Palmas: ${e.totSemProduto ? `${crossQtdTxt(e.totSemProduto)} sem produto físico (falta/inversão) → destino "Falta — Não Retorna Produto"` : ''}${e.totSemProduto && e.totDesc ? '; ' : ''}${e.totDesc ? `${crossQtdTxt(e.totDesc)} descartado(s) por avaria no cross, com foto → destino "Avaria / Descarte"` : ''}. Os destinos já vêm sugeridos abaixo.</div>`);
  const fotos = crossFotosDescarteHtml(crossMovsDaDevolucao(dev.id).filter(m => m.tipo === 'DESCARTE'));
  return `
    <div class="bg-slate-950 p-3 rounded border border-sky-800 text-[11px]">
      <div class="font-black text-sky-300 uppercase tracking-wider text-[10px] mb-1">📍 Cross Palmas · o que Palmas lançou</div>
      ${avisos.join('')}
      <table class="w-full text-left mt-1">
        <thead class="text-slate-500 text-[10px] uppercase"><tr><th class="py-1">Produto</th><th class="py-1 text-right">Registrado</th><th class="py-1 text-right">No cross</th><th class="py-1 text-right">Sem produto</th><th class="py-1 text-right">Descartado</th><th class="py-1 text-right">Embarcado</th></tr></thead>
        <tbody>${e.itens.map(i => `<tr class="border-t border-slate-800 ${(i.emb + i.semProduto + i.desc) !== i.reg ? 'text-amber-200' : 'text-slate-200'}">
          <td class="py-1">${crossEsc(i.item.produto_descricao || 'Produto')}</td>
          <td class="py-1 text-right">${crossQtdTxt(i.reg)}</td>
          <td class="py-1 text-right">${crossQtdTxt(i.rec)}</td>
          <td class="py-1 text-right">${i.semProduto ? crossQtdTxt(i.semProduto) : '—'}</td>
          <td class="py-1 text-right">${i.desc ? crossQtdTxt(i.desc) : '—'}</td>
          <td class="py-1 text-right font-bold">${crossQtdTxt(i.emb)}</td></tr>`).join('')}</tbody>
      </table>
      ${fotos ? `<div class="mt-2"><span class="text-slate-400">Fotos do descarte:</span> ${fotos}</div>` : ''}
    </div>`;
}

// Destino sugerido para o modal de conferência do CD (app.js, openCdModal):
// item todo sem produto → falta; todo descartado em Palmas → avaria/descarte.
function crossDestinoSugerido(dev, item) {
  const st = window._cross;
  if (!st || !st.movs) return null;
  const est = crossEstadoDevolucao(dev).itens.find(i => String(i.item.id) === String(item.id));
  if (!est) return null;
  if (est.semProduto > 0 && est.semProduto >= est.reg) return 'FALTA_SEM_RETORNO';
  if (est.desc > 0 && est.emb === 0 && est.saldo === 0) return 'AVARIA_DESCARTE';
  return null;
}
window.crossDestinoSugerido = crossDestinoSugerido;

// Link das fotos de descarte (bucket devolucoes-fotos, pasta cross/).
function crossUrlFoto(caminho) {
  const cfg = (window.JR_CONFIG && window.JR_CONFIG.supabase) || {};
  return `${cfg.url}/storage/v1/object/public/devolucoes-fotos/${String(caminho).replace(/^\/+/, '')}`;
}
function crossFotosDescarteHtml(movs) {
  const caminhos = [];
  (movs || []).forEach(m => (Array.isArray(m.fotos_paths) ? m.fotos_paths : []).forEach(c => caminhos.push(c)));
  return caminhos.map((c, n) => `<a href="${crossEsc(crossUrlFoto(c))}" target="_blank" rel="noopener" class="text-sky-300 underline mr-2">📷 foto ${n + 1}</a>`).join('');
}
window.crossBlocoConferenciaCd = crossBlocoConferenciaCd;

// Contagem para o Dashboard/alertas: itens parados em Palmas.
function crossResumo() {
  const st = window._cross;
  if (!st.movs || typeof db === 'undefined') return null;
  const devs = db.getDevolucoes().filter(d => d.status_fechamento === 'PENDENTE_FISICO');
  let noCross = 0, emTransbordo = 0, maisAntigo = null;
  devs.forEach(d => {
    const e = crossEstadoDevolucao(d);
    if (!e.via) return;
    if (e.local === 'NO_CROSS') {
      noCross++;
      const dias = crossDiasDesde(e.recebidoEm);
      if (dias !== null && (maisAntigo === null || dias > maisAntigo)) maisAntigo = dias;
    } else if (e.local === 'EM_TRANSBORDO') emTransbordo++;
  });
  return { noCross, emTransbordo, maisAntigo };
}
window.crossResumo = crossResumo;

// -----------------------------------------------------------------------------
// TELA
// -----------------------------------------------------------------------------
const CROSS_BTN = 'px-3 py-1.5 rounded font-bold text-xs shadow transition';
const CROSS_INPUT = 'bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs';

function crossTrocarSub(sub) { window._cross.sub = sub; renderApp(); }
window.crossTrocarSub = crossTrocarSub;

function renderCrossPalmasView() {
  const st = window._cross;
  crossGarantirDados();
  if (typeof escCarregar === 'function' && window._escala && !window._escala.matrizes && !window._escala.carregando) {
    escCarregar().catch(() => {});
  }
  const resumo = crossResumo() || { noCross: 0, emTransbordo: 0, maisAntigo: null };
  const reentregasCross = crossReentregasNoCross();
  const abas = [
    ['receber', '📥 Receber da rota'],
    ['estoque', `📦 No cross (${resumo.noCross})`],
    ['manifestos', '🚛 Manifestos'],
    ['confronto', '⚖️ Confronto'],
    ['reentregas', `🔁 Reentregas no cross (${reentregasCross.length})`]
  ];
  let corpo = '';
  if (!st.movs) corpo = `<div class="p-6 text-center text-slate-400 text-sm">${st.erro ? '❌ ' + crossEsc(st.erro) : '⏳ Carregando movimentos do cross…'}</div>`;
  else if (st.sub === 'receber') corpo = crossRenderReceber();
  else if (st.sub === 'estoque') corpo = crossRenderEstoque();
  else if (st.sub === 'manifestos') corpo = crossRenderManifestos();
  else if (st.sub === 'confronto') corpo = crossRenderConfronto();
  else corpo = crossRenderReentregas(reentregasCross);

  return `
    <div class="space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-black text-white flex items-center gap-2"><span>📍</span> Cross Palmas</h1>
          <p class="text-xs text-slate-400 mt-0.5">O que chegou das rotas, o que está parado em Palmas e o que subiu no transbordo para Araguaína.</p>
        </div>
        <div class="flex gap-2 flex-wrap text-[11px]">
          <span class="bg-orange-950 text-orange-300 border border-orange-700 px-2 py-1 rounded font-bold">📦 ${resumo.noCross} devolução(ões) no cross${resumo.maisAntigo !== null ? ` · mais antiga há ${resumo.maisAntigo} d` : ''}</span>
          <span class="bg-sky-950 text-sky-300 border border-sky-700 px-2 py-1 rounded font-bold">🚛 ${resumo.emTransbordo} em transbordo</span>
          <button onclick="crossCarregar(true)" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${CROSS_BTN}">🔄 Atualizar</button>
        </div>
      </div>
      ${st.erro && st.movs ? `<div class="bg-red-950/60 border border-red-800 text-red-200 text-xs rounded p-2">❌ ${crossEsc(st.erro)}</div>` : ''}
      <div class="flex gap-1 flex-wrap border-b border-slate-800 pb-2">
        ${abas.map(([id, l]) => `<button onclick="crossTrocarSub('${id}')" class="${CROSS_BTN} ${st.sub === id ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">${l}</button>`).join('')}
      </div>
      ${corpo}
    </div>`;
}
window.renderCrossPalmasView = renderCrossPalmasView;

function crossBuscaCasa(d) {
  const t = String(window._cross.busca || '').trim().toLowerCase();
  if (!t) return true;
  const alvo = [d.numero_devolucao, d.numero_protocolo, d.veiculo_placa, d.carga_rota, d.rota_nome, d.carga_numero,
    d.motorista_nome, d.cliente_nome, d.nota_fiscal,
    ...(Array.isArray(d.itens) ? d.itens.map(i => `${i.produto_codigo || ''} ${i.produto_descricao || ''}`) : [])].join(' ').toLowerCase();
  return t.split(/\s+/).filter(Boolean).every(p => alvo.includes(p));
}

function crossCampoBusca() {
  return `<input type="text" placeholder="Buscar nº DEV, carga, rota, cliente, produto…" value="${crossEsc(window._cross.busca)}"
    onkeydown="if(event.key==='Enter'){window._cross.busca=this.value;renderApp();}" onblur="if(this.value!==window._cross.busca){window._cross.busca=this.value;renderApp();}"
    class="${CROSS_INPUT} w-full sm:w-80">`;
}

function crossCabecalhoDev(d) {
  return `
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span class="font-black text-amber-400">${crossEsc(d.numero_devolucao || d.numero_protocolo)}</span>
      <span class="text-[11px] text-white font-bold">📍 ${crossEsc(d.carga_rota || d.rota_nome || '—')} · carga ${crossEsc(d.carga_numero || '—')}</span>
      <span class="text-[11px] text-slate-400">🚛 ${crossEsc(d.veiculo_placa || '—')} · 👤 ${crossEsc(d.motorista_nome || '—')}</span>
      <span class="text-[11px] text-slate-400">🏪 ${crossEsc(d.cliente_nome || '—')}${d.nota_fiscal ? ' · NF ' + crossEsc(d.nota_fiscal) : ''}</span>
      <span class="text-[10px] text-slate-500">aberta ${crossEsc(crossDataHora(d.criado_em))}</span>
    </div>`;
}

// --- 1. RECEBER DA ROTA --------------------------------------------------------
function crossRenderReceber() {
  const st = window._cross;
  const todas = db.getDevolucoes().filter(d => d.status_fechamento === 'PENDENTE_FISICO' && !d.sem_itens && Array.isArray(d.itens) && d.itens.length);
  // Falta receber: algum item ainda sem lançamento de recebimento no cross.
  const faltando = todas.filter(d => crossEstadoDevolucao(d).itens.some(i => !i.recebido));
  const lista = faltando
    .filter(d => !st.soRotasCross || crossRotaEhDoCross(d.carga_rota || d.rota_nome))
    .filter(crossBuscaCasa)
    .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  return `
    <div class="space-y-3">
      <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300">
        Marque o que <b>chegou fisicamente no cross</b>, item a item. Se veio menos, ajuste a quantidade e escreva o que houve. Depois o produto aparece em <b>No cross</b> para embarcar no transbordo.
        <div class="mt-1 text-violet-300"><b>Sem produto:</b> falta, inversão ou renegociado em rota, quando não existe mercadoria para voltar. Itens com motivo FALTA já vêm marcados assim; confira.</div>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        ${crossCampoBusca()}
        <label class="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
          <input type="checkbox" ${st.soRotasCross ? 'checked' : ''} onchange="window._cross.soRotasCross=this.checked;renderApp();"> Só rotas que passam por Palmas
        </label>
        <span class="text-[11px] text-slate-500">${lista.length} devolução(ões)</span>
      </div>
      ${lista.length === 0 ? `<div class="p-6 text-center text-slate-500 text-sm">✅ Nada pendente de recebimento no cross${st.soRotasCross ? ' nas rotas de Palmas (desmarque o filtro para ver as outras)' : ''}.</div>` : ''}
      ${lista.map(d => {
        const e = crossEstadoDevolucao(d);
        return `
        <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
          ${crossCabecalhoDev(d)}
          <table class="w-full text-left text-xs">
            <thead class="text-[10px] uppercase text-slate-500"><tr><th class="py-1">Produto</th><th class="py-1 text-right">Registrado</th><th class="py-1 text-right w-28">Chegou no cross</th><th class="py-1 text-center w-24">Sem produto</th></tr></thead>
            <tbody>${e.itens.map(i => {
              const idBase = `${d.id}-${i.item.id}`;
              const sugereSem = crossItemSugereSemProduto(i.item);
              return `<tr class="border-t border-slate-800">
                <td class="py-1.5 text-slate-200">${i.item.produto_codigo ? `<span class="text-emerald-400 font-mono">[${crossEsc(i.item.produto_codigo)}]</span> ` : ''}${crossEsc(i.item.produto_descricao)}${i.item.motivo_item ? `<div class="text-[10px] text-slate-500">Motivo: ${crossEsc(i.item.motivo_item)}</div>` : ''}</td>
                <td class="py-1.5 text-right">${crossQtdTxt(i.reg)}</td>
                <td class="py-1.5 text-right">${!i.recebido
                  ? `<input type="number" min="0" step="0.01" id="crx-rec-${idBase}" value="${sugereSem ? 0 : i.reg}" ${sugereSem ? 'disabled' : ''} class="${CROSS_INPUT} w-24 text-right disabled:opacity-40" title="0 = não chegou">`
                  : `<span class="text-emerald-400 font-bold">✔ ${i.semProduto ? '<span class="text-violet-300">sem produto</span>' : crossQtdTxt(i.rec)}</span>`}</td>
                <td class="py-1.5 text-center">${!i.recebido
                  ? `<input type="checkbox" id="crx-sem-${idBase}" ${sugereSem ? 'checked' : ''} onchange="const q=document.getElementById('crx-rec-${idBase}');q.disabled=this.checked;q.value=this.checked?0:'${i.reg}';" title="Não existe mercadoria para voltar (falta, inversão, renegociado)">`
                  : ''}</td></tr>`;
            }).join('')}</tbody>
          </table>
          <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
            <input type="text" id="crx-rec-obs-${d.id}" placeholder="Observação (obrigatória se chegou diferente do registrado)" oninput="forcarMaiuscula(this)" class="${CROSS_INPUT} flex-1">
            <button onclick="crossConfirmarRecebimento('${d.id}')" class="bg-emerald-600 hover:bg-emerald-500 text-white ${CROSS_BTN}">📥 Confirmar recebimento no cross</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

// Item que, pelo motivo, normalmente não tem mercadoria física para voltar.
// Só SUGERE (vem marcado); o operador desmarca se o produto estiver ali.
function crossItemSugereSemProduto(item) {
  const m = crossNorm(item && item.motivo_item);
  return m.indexOf('FALTA') > -1 || m.indexOf('INVERS') > -1 || m.indexOf('RENEGOCI') > -1;
}

async function crossConfirmarRecebimento(devId) {
  const dev = db.getDevolucoes().find(d => String(d.id) === String(devId));
  if (!dev) return;
  const e = crossEstadoDevolucao(dev);
  const obs = String((document.getElementById(`crx-rec-obs-${devId}`) || {}).value || '').trim().toUpperCase();
  const novos = [];
  let diferente = false;
  for (const i of e.itens) {
    const el = document.getElementById(`crx-rec-${devId}-${i.item.id}`);
    if (!el) continue;
    const sem = document.getElementById(`crx-sem-${devId}-${i.item.id}`);
    if (sem && sem.checked) {
      // 7.7.0: não existe mercadoria para voltar. Lança a quantidade
      // registrada como "sem produto": não vira estoque nem transbordo.
      novos.push(crossNovoMov('SEM_PRODUTO', dev, i.item, i.reg, { observacao: obs || (i.item.motivo_item ? String(i.item.motivo_item).toUpperCase() : null) }));
      continue;
    }
    const q = crossNum(el.value);
    if (q < 0) { alert('Quantidade não pode ser negativa.'); return; }
    if (q !== i.reg) diferente = true;
    // Zero também é lançado: é a conferência dizendo "não chegou".
    novos.push(crossNovoMov('RECEBIDO_CROSS', dev, i.item, q, { observacao: obs || null }));
  }
  if (diferente && !obs) { alert('A quantidade que chegou é diferente da registrada. Escreva na observação o que houve.'); return; }
  if (!novos.length) { alert('Nada para receber nesta devolução.'); return; }
  try {
    await crossGravar(novos);
    window._cross.movs = (window._cross.movs || []).concat(novos);
    showToast(`📥 ${dev.numero_devolucao || dev.numero_protocolo} recebida no cross.`);
    renderApp();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}
window.crossConfirmarRecebimento = crossConfirmarRecebimento;

// --- 2. NO CROSS (estoque) + EMBARQUE ------------------------------------------
function crossTransbordosRecentes() {
  const viagens = (typeof db.getControleViagens === 'function') ? db.getControleViagens() : [];
  const limite = somaDiasIso(hojeIsoBrasilia(), -7);
  return viagens.filter(v => !v.is_deleted && (String(v.setor || '').toUpperCase() === 'TRANSBORDO' || crossNorm(v.rota).indexOf('TRANSB') > -1))
    .filter(v => {
      const iso = (typeof _paraIsoDeComparacao === 'function') ? _paraIsoDeComparacao(v.data_saida) : String(v.data_saida || '').slice(0, 10);
      return !iso || iso >= limite;
    })
    .slice(0, 30);
}

function crossRenderEstoque() {
  const devs = db.getDevolucoes().filter(d => d.status_fechamento === 'PENDENTE_FISICO').filter(crossBuscaCasa);
  const linhas = [];
  devs.forEach(d => {
    const e = crossEstadoDevolucao(d);
    if (!e.via || e.totSaldo <= 0) return;
    linhas.push({ d, e, dias: crossDiasDesde(e.recebidoEm) });
  });
  linhas.sort((a, b) => (b.dias || 0) - (a.dias || 0));
  const transb = crossTransbordosRecentes();
  const placas = (db.data.veiculos || []).filter(v => !v.is_deleted && String(v.situacao || '').toUpperCase() !== 'INATIVO').map(v => String(v.placa || '').toUpperCase()).filter(Boolean).sort();
  return `
    <div class="space-y-3">
      <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300">
        Tudo o que está parado em Palmas, do mais antigo para o mais novo. No dia do transbordo, marque <b>item a item</b> o que subiu no caminhão, escolha o transbordo e gere o manifesto. O que não for marcado continua aqui.
      </div>
      <div class="flex flex-wrap gap-2 items-center">${crossCampoBusca()}<span class="text-[11px] text-slate-500">${linhas.length} devolução(ões) no cross</span></div>
      ${linhas.length === 0 ? '<div class="p-6 text-center text-slate-500 text-sm">✅ Nada parado no cross.</div>' : `
      <div class="overflow-x-auto bg-slate-900 border border-slate-800 rounded-lg">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-950 text-[10px] uppercase text-slate-500"><tr>
            <th class="p-2"><input type="checkbox" onchange="document.querySelectorAll('.crx-emb-chk').forEach(c=>c.checked=this.checked)" title="Marcar todos"></th>
            <th class="p-2">Devolução</th><th class="p-2">Produto</th><th class="p-2 text-right">No cross</th><th class="p-2 text-right w-28">Embarcar</th><th class="p-2 text-right">Parado</th><th class="p-2"></th></tr></thead>
          <tbody>${linhas.map(({ d, e, dias }) => e.itens.filter(i => i.saldo > 0).map(i => `
            <tr class="border-t border-slate-800">
              <td class="p-2"><input type="checkbox" class="crx-emb-chk" data-dev="${d.id}" data-item="${i.item.id}"></td>
              <td class="p-2"><div class="font-black text-amber-400">${crossEsc(d.numero_devolucao || d.numero_protocolo)}</div><div class="text-[10px] text-slate-400">${crossEsc(d.carga_rota || d.rota_nome || '')} · ${crossEsc(d.cliente_nome || '')}</div></td>
              <td class="p-2 text-slate-200">${crossEsc(i.item.produto_descricao)}</td>
              <td class="p-2 text-right font-bold">${crossQtdTxt(i.saldo)}</td>
              <td class="p-2 text-right"><input type="number" min="0" max="${i.saldo}" step="0.01" id="crx-emb-${d.id}-${i.item.id}" value="${i.saldo}" class="${CROSS_INPUT} w-24 text-right"></td>
              <td class="p-2 text-right ${dias !== null && dias >= 5 ? 'text-red-300 font-bold' : dias !== null && dias >= 2 ? 'text-orange-300 font-bold' : 'text-slate-400'}">${dias === null ? '—' : dias + ' d'}</td>
              <td class="p-2 text-right"><button onclick="crossAbrirDescarte('${d.id}','${i.item.id}')" class="bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 px-2 py-1 rounded text-[11px] font-bold whitespace-nowrap" title="Avaria sem condição de voltar: descartar aqui em Palmas, com foto">🗑️ Descartar</button></td>
            </tr>`).join('')).join('')}</tbody>
        </table>
      </div>
      <div class="bg-slate-900 border border-sky-800 rounded-lg p-3 space-y-2">
        <div class="font-black text-sky-300 text-xs uppercase tracking-wider">🚛 Embarcar no transbordo</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label class="block text-[10px] text-slate-400 font-bold mb-0.5">Transbordo (Controle de Viagens)</label>
            <select id="crx-emb-viagem" class="${CROSS_INPUT} w-full" onchange="const o=this.selectedOptions[0];if(o&&o.dataset.placa){document.getElementById('crx-emb-placa').value=o.dataset.placa;document.getElementById('crx-emb-motorista').value=o.dataset.motorista||'';}">
              <option value="">— escolher —</option>
              ${transb.map(v => `<option value="${crossEsc(v.id)}" data-placa="${crossEsc(String(v.placa || '').toUpperCase())}" data-motorista="${crossEsc(String(v.motorista || '').toUpperCase())}">${crossEsc(v.data_saida || '')} · ${crossEsc(v.placa || '')} · ${crossEsc(v.motorista || '')} · ${crossEsc(v.rota || '')}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold mb-0.5">Placa *</label>
            <input id="crx-emb-placa" list="crx-placas" class="${CROSS_INPUT} w-full" oninput="forcarMaiuscula(this)" placeholder="Ex: RSC7E69">
            <datalist id="crx-placas">${placas.map(p => `<option value="${crossEsc(p)}">`).join('')}</datalist>
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 font-bold mb-0.5">Motorista *</label>
            <input id="crx-emb-motorista" class="${CROSS_INPUT} w-full" oninput="forcarMaiuscula(this)">
          </div>
        </div>
        <input id="crx-emb-obs" class="${CROSS_INPUT} w-full" oninput="forcarMaiuscula(this)" placeholder="Observação do embarque (opcional)">
        <div class="flex justify-end"><button onclick="crossGerarManifesto()" class="bg-sky-600 hover:bg-sky-500 text-white ${CROSS_BTN}">🚛 Gerar manifesto com os itens marcados</button></div>
        <p class="text-[10px] text-slate-500">Só veículo próprio traz produto de Palmas. Terceiro que deixa carga no cross não entra aqui.</p>
      </div>`}
      ${crossRenderNaoVoltam()}
    </div>`;
}

// Lista do que NÃO volta de Palmas (sem produto e descartado), com desfazer
// enquanto o CD não fechou a devolução (7.7.0).
function crossRenderNaoVoltam() {
  const devs = db.getDevolucoes();
  const movs = (window._cross.movs || []).filter(m => (m.tipo === 'SEM_PRODUTO' || m.tipo === 'DESCARTE') && !m.is_deleted)
    .filter(m => { const d = devs.find(x => String(x.id) === String(m.devolucao_id)); return d && crossBuscaCasa(d); })
    .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')))
    .slice(0, 60);
  if (!movs.length) return '';
  return `
    <div class="bg-slate-900 border border-violet-800 rounded-lg p-3 space-y-2">
      <div class="font-black text-violet-300 text-xs uppercase tracking-wider">🟣 Não voltam de Palmas: sem produto e descartados</div>
      <div class="overflow-x-auto"><table class="w-full text-left text-xs">
        <thead class="text-[10px] uppercase text-slate-500"><tr><th class="py-1">Devolução</th><th class="py-1">Produto</th><th class="py-1">Tipo</th><th class="py-1 text-right">Qtd</th><th class="py-1">Detalhe</th><th></th></tr></thead>
        <tbody>${movs.map(m => {
          const d = devs.find(x => String(x.id) === String(m.devolucao_id));
          const podeDesfazer = d && d.status_fechamento === 'PENDENTE_FISICO';
          return `<tr class="border-t border-slate-800">
            <td class="py-1 text-amber-400 font-bold">${crossEsc(m.numero_devolucao || (d && (d.numero_devolucao || d.numero_protocolo)) || '')}</td>
            <td class="py-1 text-slate-200">${crossEsc(m.produto_descricao || '')}</td>
            <td class="py-1">${m.tipo === 'DESCARTE' ? '<span class="text-red-300 font-bold">🗑️ Descartado</span>' : '<span class="text-violet-300 font-bold">Sem produto</span>'}</td>
            <td class="py-1 text-right font-bold">${crossQtdTxt(m.quantidade)}</td>
            <td class="py-1 text-[10px] text-slate-400">${crossEsc(m.observacao || '')}${m.autorizado_por ? ` · autorizado por ${crossEsc(m.autorizado_por)}` : ''} · ${crossEsc(crossDataHora(m.criado_em))} ${crossFotosDescarteHtml([m])}</td>
            <td class="py-1 text-right">${podeDesfazer ? `<button onclick="crossExcluirMovimento('${m.id}')" class="text-red-400 hover:text-red-300 text-[11px]" title="Lançado errado: desfazer">✕</button>` : ''}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
}

// --- DESCARTE NO CROSS (7.7.0) ---------------------------------------------------
function crossAbrirDescarte(devId, itemId) {
  const dev = db.getDevolucoes().find(d => String(d.id) === String(devId));
  if (!dev) return;
  const est = crossEstadoDevolucao(dev).itens.find(i => String(i.item.id) === String(itemId));
  if (!est || est.saldo <= 0) { alert('Este item não tem saldo no cross.'); return; }
  const mc = document.getElementById('modal-container');
  if (!mc) return;
  mc.innerHTML = `
    <div onclick="event.stopPropagation()" class="bg-slate-900 border border-red-800 rounded-xl p-5 max-w-lg w-full shadow-2xl space-y-3 max-h-[90vh] overflow-y-auto text-xs">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <h3 class="font-bold text-white text-base">🗑️ Descartar no cross — ${crossEsc(dev.numero_devolucao || dev.numero_protocolo)}</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white font-bold text-xl leading-none">✕</button>
      </div>
      <div class="bg-slate-950 border border-slate-800 rounded p-2 text-slate-300">
        <b class="text-white">${crossEsc(est.item.produto_descricao)}</b> · no cross: <b>${crossQtdTxt(est.saldo)}</b><br>
        Use só para avaria sem condição de voltar a Araguaína. O item sai do estoque do cross e o CD fecha como Avaria / Descarte.
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="block text-[10px] text-slate-400 font-bold mb-0.5">Quantidade descartada *</label>
          <input type="number" id="crx-desc-qtd" min="0.01" max="${est.saldo}" step="0.01" value="${est.saldo}" class="${CROSS_INPUT} w-full"></div>
        <div><label class="block text-[10px] text-slate-400 font-bold mb-0.5">Autorizado por *</label>
          <input type="text" id="crx-desc-aut" class="${CROSS_INPUT} w-full" oninput="forcarMaiuscula(this)" placeholder="Quem liberou o descarte"></div>
      </div>
      <div><label class="block text-[10px] text-slate-400 font-bold mb-0.5">O que tem de avaria *</label>
        <input type="text" id="crx-desc-obs" class="${CROSS_INPUT} w-full" oninput="forcarMaiuscula(this)" placeholder="Ex: EMBALAGEM ESTOURADA, PRODUTO VAZANDO"></div>
      <div><label class="block text-[10px] text-slate-400 font-bold mb-0.5">Foto da avaria * (uma ou mais)</label>
        <input type="file" id="crx-desc-fotos" accept="image/*" capture="environment" multiple class="w-full text-slate-300"></div>
      <div class="flex justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="closeModal()" class="bg-slate-800 text-slate-300 ${CROSS_BTN}">Cancelar</button>
        <button id="crx-desc-btn" onclick="crossConfirmarDescarte('${dev.id}','${est.item.id}')" class="bg-red-700 hover:bg-red-600 text-white ${CROSS_BTN}">🗑️ Confirmar descarte</button>
      </div>
    </div>`;
  mc.classList.remove('hidden');
}
window.crossAbrirDescarte = crossAbrirDescarte;

async function crossSubirFoto(dataUrl, devId) {
  const cfg = (window.JR_CONFIG && window.JR_CONFIG.supabase) || {};
  if (!cfg.url || !cfg.anonKey) throw new Error('Sem configuração da nuvem neste aparelho.');
  const blob = await (await fetch(dataUrl)).blob();
  const caminho = `cross/${devId}/descarte/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const resp = await fetch(`${cfg.url}/storage/v1/object/devolucoes-fotos/${caminho}`, {
    method: 'POST',
    headers: { 'apikey': cfg.anonKey, 'Authorization': 'Bearer ' + cfg.anonKey, 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
    body: blob
  });
  if (!resp.ok) throw new Error(`A foto não subiu (${resp.status}). Confira a internet e tente de novo.`);
  return caminho;
}

async function crossConfirmarDescarte(devId, itemId) {
  const dev = db.getDevolucoes().find(d => String(d.id) === String(devId));
  if (!dev) return;
  const est = crossEstadoDevolucao(dev).itens.find(i => String(i.item.id) === String(itemId));
  if (!est) return;
  const qtd = crossNum(document.getElementById('crx-desc-qtd').value);
  const aut = String(document.getElementById('crx-desc-aut').value || '').trim().toUpperCase();
  const obs = String(document.getElementById('crx-desc-obs').value || '').trim().toUpperCase();
  const arquivos = Array.from((document.getElementById('crx-desc-fotos') || {}).files || []);
  if (qtd <= 0) { alert('Informe a quantidade descartada.'); return; }
  if (qtd > est.saldo) { alert(`Só há ${crossQtdTxt(est.saldo)} deste item no cross.`); return; }
  if (!aut) { alert('Informe quem autorizou o descarte.'); return; }
  if (!obs) { alert('Descreva a avaria.'); return; }
  if (!arquivos.length) { alert('A foto da avaria é obrigatória.'); return; }
  const btn = document.getElementById('crx-desc-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando fotos…'; }
  try {
    const caminhos = [];
    for (const f of arquivos) {
      const dataUrl = (typeof comprimirImagem === 'function') ? await comprimirImagem(f) : await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = erro; r.readAsDataURL(f); });
      caminhos.push(await crossSubirFoto(dataUrl, dev.id));
    }
    const mov = crossNovoMov('DESCARTE', dev, est.item, qtd, { observacao: obs, autorizado_por: aut, fotos_paths: caminhos });
    await crossGravar(mov);
    window._cross.movs = (window._cross.movs || []).concat([mov]);
    closeModal();
    showToast(`🗑️ Descarte registrado: ${crossQtdTxt(qtd)} de ${est.item.produto_descricao}.`);
    renderApp();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '🗑️ Confirmar descarte'; }
    alert('❌ ' + err.message);
  }
}
window.crossConfirmarDescarte = crossConfirmarDescarte;

async function crossGerarManifesto() {
  const placa = String(document.getElementById('crx-emb-placa').value || '').trim().toUpperCase();
  const motorista = String(document.getElementById('crx-emb-motorista').value || '').trim().toUpperCase();
  const viagemId = document.getElementById('crx-emb-viagem').value || null;
  const obs = String(document.getElementById('crx-emb-obs').value || '').trim().toUpperCase();
  if (!placa) { alert('Informe a placa do transbordo.'); return; }
  if (!motorista) { alert('Informe o motorista do transbordo.'); return; }
  const marcados = Array.from(document.querySelectorAll('.crx-emb-chk')).filter(c => c.checked);
  if (!marcados.length) { alert('Marque ao menos um item para embarcar.'); return; }
  const devs = db.getDevolucoes();
  const agora = agoraIsoBrasilia();
  const manifesto = `PMW-${agora.slice(0, 10).replace(/-/g, '')}-${agora.slice(11, 16).replace(':', '')}-${placa}`;
  const novos = [];
  for (const c of marcados) {
    const dev = devs.find(d => String(d.id) === c.dataset.dev);
    if (!dev) continue;
    const est = crossEstadoDevolucao(dev).itens.find(i => String(i.item.id) === c.dataset.item);
    if (!est) continue;
    const q = crossNum((document.getElementById(`crx-emb-${c.dataset.dev}-${c.dataset.item}`) || {}).value);
    if (q <= 0) continue;
    if (q > est.saldo) { alert(`${dev.numero_devolucao}: só há ${crossQtdTxt(est.saldo)} de ${est.item.produto_descricao} no cross.`); return; }
    novos.push(crossNovoMov('EMBARQUE', dev, est.item, q, { manifesto, placa, motorista, viagem_id: viagemId ? Number(viagemId) : null, observacao: obs || null }));
  }
  if (!novos.length) { alert('Nenhuma quantidade para embarcar.'); return; }
  if (!confirm(`Gerar o manifesto ${manifesto} com ${novos.length} item(ns) no ${placa}?`)) return;
  try {
    await crossGravar(novos);
    window._cross.movs = (window._cross.movs || []).concat(novos);
    window._cross.sub = 'manifestos';
    showToast(`🚛 Manifesto ${manifesto} gerado.`);
    renderApp();
    crossImprimirManifesto(manifesto);
  } catch (err) {
    alert('❌ ' + err.message);
  }
}
window.crossGerarManifesto = crossGerarManifesto;

// --- 3. MANIFESTOS ---------------------------------------------------------------
function crossManifestos() {
  const movs = (window._cross.movs || []).filter(m => m.tipo === 'EMBARQUE' && m.manifesto);
  const grupos = {};
  movs.forEach(m => { (grupos[m.manifesto] = grupos[m.manifesto] || []).push(m); });
  const devs = db.getDevolucoes();
  return Object.keys(grupos).map(cod => {
    const itens = grupos[cod];
    const devIds = Array.from(new Set(itens.map(m => String(m.devolucao_id))));
    const conferidas = devIds.filter(id => { const d = devs.find(x => String(x.id) === id); return d && d.status_fechamento !== 'PENDENTE_FISICO'; }).length;
    let divergencias = 0;
    devIds.forEach(id => { const d = devs.find(x => String(x.id) === id); if (d) divergencias += crossEstadoDevolucao(d).divergencias; });
    return { cod, itens, devIds, conferidas, divergencias, placa: itens[0].placa, motorista: itens[0].motorista, em: itens[0].criado_em, por: itens[0].criado_por };
  }).sort((a, b) => String(b.em || '').localeCompare(String(a.em || '')));
}

function crossRenderManifestos() {
  const lista = crossManifestos();
  if (!lista.length) return '<div class="p-6 text-center text-slate-500 text-sm">Nenhum manifesto gerado ainda.</div>';
  return `
    <div class="space-y-3">${lista.map(m => {
      const status = m.conferidas === m.devIds.length
        ? '<span class="bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">✅ Conferido no CD</span>'
        : m.conferidas > 0
          ? `<span class="bg-amber-950 text-amber-300 border border-amber-700 px-2 py-0.5 rounded text-[10px] font-bold">⏳ CD conferiu ${m.conferidas} de ${m.devIds.length}</span>`
          : '<span class="bg-sky-950 text-sky-300 border border-sky-700 px-2 py-0.5 rounded text-[10px] font-bold">🚛 Em transbordo</span>';
      return `
      <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="font-black text-sky-300 font-mono">${crossEsc(m.cod)}</div>
            <div class="text-[11px] text-slate-400">🚛 ${crossEsc(m.placa)} · 👤 ${crossEsc(m.motorista || '—')} · ${crossEsc(crossDataHora(m.em))} · por ${crossEsc(m.por || '—')}</div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">${status}
            ${m.divergencias ? `<span class="bg-red-950 text-red-300 border border-red-700 px-2 py-0.5 rounded text-[10px] font-bold">⚠ ${m.divergencias} divergência(s)</span>` : ''}
            <button onclick="crossImprimirManifesto('${crossEsc(m.cod)}')" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${CROSS_BTN}">🖨️ Imprimir</button>
          </div>
        </div>
        <table class="w-full text-left text-xs">
          <thead class="text-[10px] uppercase text-slate-500"><tr><th class="py-1">Devolução</th><th class="py-1">Produto</th><th class="py-1 text-right">Embarcado</th><th class="py-1 text-right">CD</th><th></th></tr></thead>
          <tbody>${m.itens.map(it => {
            const dev = db.getDevolucoes().find(d => String(d.id) === String(it.devolucao_id));
            const est = dev ? crossEstadoDevolucao(dev).itens.find(i => String(i.item.id) === String(it.item_id)) : null;
            const podeExcluir = dev && dev.status_fechamento === 'PENDENTE_FISICO';
            return `<tr class="border-t border-slate-800">
              <td class="py-1 text-amber-400 font-bold">${crossEsc(it.numero_devolucao || it.devolucao_id)}</td>
              <td class="py-1 text-slate-200">${crossEsc(it.produto_descricao || '')}</td>
              <td class="py-1 text-right font-bold">${crossQtdTxt(it.quantidade)}</td>
              <td class="py-1 text-right ${est && est.cd !== null && est.cd !== est.emb ? 'text-red-300 font-bold' : 'text-slate-400'}">${est && est.cd !== null ? crossQtdTxt(est.cd) : '—'}</td>
              <td class="py-1 text-right">${podeExcluir ? `<button onclick="crossExcluirMovimento('${it.id}')" class="text-red-400 hover:text-red-300 text-[11px]" title="Lançado errado: tirar do manifesto (o item volta para o cross)">✕</button>` : ''}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
    }).join('')}</div>`;
}

async function crossExcluirMovimento(id) {
  const m = (window._cross.movs || []).find(x => String(x.id) === String(id));
  if (!m) return;
  const onde = { EMBARQUE: 'do manifesto ' + m.manifesto, SEM_PRODUTO: 'da marcação "sem produto"', DESCARTE: 'do descarte' }[m.tipo] || 'do recebimento';
  if (!confirm(`Desfazer ${crossQtdTxt(m.quantidade)} de ${m.produto_descricao || 'item'} (${m.numero_devolucao}) ${onde}? O item volta para a etapa anterior e o lançamento fica no histórico como excluído.`)) return;
  const agora = agoraIsoBrasilia();
  const reg = Object.assign({}, m, { is_deleted: true, deleted_at: agora, deleted_by_nome: crossUsuario(), atualizado_por: crossUsuario(), atualizado_em: agora });
  try {
    await crossGravar(reg);
    window._cross.movs = (window._cross.movs || []).filter(x => String(x.id) !== String(id));
    showToast('Lançamento retirado.');
    renderApp();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}
window.crossExcluirMovimento = crossExcluirMovimento;

function crossImprimirManifesto(cod) {
  const m = crossManifestos().find(x => x.cod === cod);
  if (!m) return;
  const devs = db.getDevolucoes();
  const linhas = m.itens.map(it => {
    const d = devs.find(x => String(x.id) === String(it.devolucao_id)) || {};
    return `<tr><td>${crossEsc(it.numero_devolucao || '')}</td><td>${crossEsc(d.carga_rota || d.rota_nome || '')}</td><td>${crossEsc(d.cliente_nome || '')}</td><td>${crossEsc(it.produto_descricao || '')}</td><td style="text-align:right">${crossQtdTxt(it.quantidade)}</td><td style="width:90px"></td></tr>`;
  }).join('');
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Manifesto ${crossEsc(cod)}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #444;padding:5px}th{background:#eee;text-align:left}.ass{margin-top:40px;display:flex;gap:40px}.ass div{flex:1;border-top:1px solid #000;padding-top:4px;text-align:center}</style></head><body>
    <h1>Manifesto de transbordo — Cross Palmas → CD Araguaína</h1>
    <div><b>${crossEsc(cod)}</b> · Placa <b>${crossEsc(m.placa)}</b> · Motorista <b>${crossEsc(m.motorista || '')}</b> · ${crossEsc(crossDataHora(m.em))} · Emitido por ${crossEsc(m.por || '')}</div>
    <table><thead><tr><th>Devolução</th><th>Rota</th><th>Cliente</th><th>Produto</th><th>Qtd</th><th>Conferido CD</th></tr></thead><tbody>${linhas}</tbody></table>
    <div class="ass"><div>Cross Palmas</div><div>Motorista</div><div>CD Araguaína</div></div>
    <script>window.onload=function(){window.print();}<\/script></body></html>`);
  w.document.close();
}
window.crossImprimirManifesto = crossImprimirManifesto;

// --- 4. CONFRONTO ----------------------------------------------------------------
function crossRenderConfronto() {
  const devs = db.getDevolucoes().filter(crossBuscaCasa);
  const linhas = [];
  devs.forEach(d => {
    const e = crossEstadoDevolucao(d);
    if (!e.via) return;
    e.itens.forEach(i => { if (i.divergencias.length) linhas.push({ d, e, i }); });
  });
  return `
    <div class="space-y-3">
      <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300">
        Cada item que passou pelo cross, nas quatro pontas: <b>registrado</b> pelo SAC, <b>recebido</b> no cross, <b>embarcado</b> no transbordo e <b>conferido</b> no CD. Aqui aparecem só os que não batem.
      </div>
      <div class="flex flex-wrap gap-2 items-center">${crossCampoBusca()}<span class="text-[11px] text-slate-500">${linhas.length} item(ns) com divergência</span></div>
      ${linhas.length === 0 ? '<div class="p-6 text-center text-slate-500 text-sm">✅ Nenhuma divergência entre cross, transbordo e CD.</div>' : `
      <div class="overflow-x-auto bg-slate-900 border border-slate-800 rounded-lg">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-950 text-[10px] uppercase text-slate-500"><tr><th class="p-2">Devolução</th><th class="p-2">Produto</th><th class="p-2 text-right">Registrado</th><th class="p-2 text-right">Cross</th><th class="p-2 text-right">Embarcado</th><th class="p-2 text-right">CD</th><th class="p-2">O que não bate</th></tr></thead>
          <tbody>${linhas.map(({ d, e, i }) => `<tr class="border-t border-slate-800">
            <td class="p-2"><div class="font-black text-amber-400">${crossEsc(d.numero_devolucao || d.numero_protocolo)}</div><div class="text-[10px] text-slate-400">${crossEsc(d.carga_rota || d.rota_nome || '')} · ${crossEsc(e.rotulo)}</div></td>
            <td class="p-2 text-slate-200">${crossEsc(i.item.produto_descricao)}</td>
            <td class="p-2 text-right">${crossQtdTxt(i.reg)}</td>
            <td class="p-2 text-right">${crossQtdTxt(i.rec)}</td>
            <td class="p-2 text-right">${crossQtdTxt(i.emb)}${i.placas.length ? `<div class="text-[9px] text-slate-500">${crossEsc(i.placas.join(', '))}</div>` : ''}</td>
            <td class="p-2 text-right">${i.cd === null ? '<span class="text-slate-500">—</span>' : crossQtdTxt(i.cd)}</td>
            <td class="p-2 text-red-300 text-[11px]">${i.divergencias.map(crossEsc).join('<br>')}</td></tr>`).join('')}</tbody>
        </table>
      </div>`}
    </div>`;
}

// --- 5. REENTREGAS NO CROSS --------------------------------------------------------
function crossReentregasNoCross() {
  if (typeof db === 'undefined' || typeof db.getReentregas !== 'function') return [];
  return db.getReentregas().filter(r => !r.is_deleted && r.status === 'RECEBIDO_CD' && crossNorm(r.local_armazenagem).indexOf('CROSS PALMAS') === 0);
}

function crossRenderReentregas(lista) {
  return `
    <div class="space-y-3">
      <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300">
        Reentregas recebidas em Palmas (local <b>CROSS PALMAS</b>) que ainda não saíram. Elas saem direto do cross na próxima rota: use o <b>Despachar</b> da tela de Reentregas, como no CD.
      </div>
      ${lista.length === 0 ? '<div class="p-6 text-center text-slate-500 text-sm">✅ Nenhuma reentrega parada no cross.</div>' : `
      <div class="overflow-x-auto bg-slate-900 border border-slate-800 rounded-lg">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-950 text-[10px] uppercase text-slate-500"><tr><th class="p-2">Carga / Rota</th><th class="p-2">Motorista</th><th class="p-2 text-right">Volumes</th><th class="p-2">Recebida</th><th class="p-2 text-right">Parada</th></tr></thead>
          <tbody>${lista.map(r => { const dias = crossDiasDesde(r.recebido_cd_em); return `<tr class="border-t border-slate-800">
            <td class="p-2"><div class="font-bold text-white">${crossEsc(r.carga_numero || '—')}</div><div class="text-[10px] text-slate-400">${crossEsc(r.rota_nome || '')}</div></td>
            <td class="p-2 text-slate-300">${crossEsc(r.motorista_nome || '')}</td>
            <td class="p-2 text-right font-bold">${crossEsc(r.qtd_recebida_cd)}</td>
            <td class="p-2 text-slate-400">${crossEsc(crossDataHora(r.recebido_cd_em))} · ${crossEsc(r.recebido_cd_por || '')}</td>
            <td class="p-2 text-right ${dias !== null && dias >= 2 ? 'text-orange-300 font-bold' : 'text-slate-400'}">${dias === null ? '—' : dias + ' d'}</td></tr>`; }).join('')}</tbody>
        </table>
      </div>
      <div class="flex justify-end"><button onclick="switchTab('reentregas')" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 ${CROSS_BTN}">🔁 Abrir Reentregas</button></div>`}
    </div>`;
}
