// =============================================================================
// ESCALA DE EMBARQUES (6.10.0, migration 56)
// =============================================================================
// Substitui as planilhas "Gestão de embarques - Matriz" (uma por dia da semana)
// e os "FECHAMENTO DIA dd.mm.aaaa.xlsx". Três telas no menu Escala:
//
//   Matrizes          — o modelo de cada dia (segunda a sábado): rota, placa,
//                       motorista, ajudante, observação e o retorno (saída +
//                       N dias, na hora indicada), que dá a previsão de chegada.
//   Convocação Escala — a escala de uma data, montada a partir da matriz do
//                       dia da semana. Inclui/retira viagens; placa diferente
//                       da matriz abre a Troca de Veículos; avisa (sem travar)
//                       motorista/ajudante/placa repetidos, inativos ou ainda
//                       em viagem não finalizada, com a previsão de chegada.
//                       Gera a imagem da convocação para o grupo.
//   Fechamento        — quem fecha a carga digita carga, peso, valor e
//                       entregas. Ao ganhar a carga, a linha vira viagem no
//                       Controle de Viagens (uma por linha; "45025 / 45026"
//                       fica junto, como sempre foi). Gera a imagem do
//                       fechamento para o grupo da gestão.
//
// FORA DA SINCRONIZAÇÃO AUTOMÁTICA, de propósito (egress, ver 6.8.1): as
// tabelas escala_matrizes e escala_linhas são lidas da nuvem quando a tela
// abre e gravadas direto a cada alteração, como a Produtividade. Nada vai
// para o localStorage. A viagem e a troca de veículo, essas sim, vão pelo
// caminho normal (db.addViagem / db.addTrocaVeiculo).
// =============================================================================

window._escala = window._escala || {
  matrizes: null,          // linhas de escala_matrizes (todas as vivas)
  diaMatriz: 1,            // 1 = segunda ... 6 = sábado
  data: null,              // 'AAAA-MM-DD' da escala aberta
  linhas: {},              // data -> linhas de escala_linhas daquela data
  vizinhas: {},            // data -> linhas dos 20 dias anteriores (avisos)
  carregando: false,
  erro: '',
  salvando: 0
};

const ESC_DIAS = ['', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
const ESC_DIAS_CURTO = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ESC_JANELA_VIAGEM_DIAS = 20;

function escEsc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// 1 = segunda ... 7 = domingo, de uma data 'AAAA-MM-DD'.
function escDiaSemana(iso) {
  const p = String(iso || '').split('-').map(Number);
  if (p.length !== 3) return 0;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).getUTCDay();
  return d === 0 ? 7 : d;
}

function escDataBr(iso) {
  const p = String(iso || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || '');
}

// Próximo dia útil da escala: amanhã, pulando o domingo.
function escDataPadrao() {
  let d = somaDiasIso(hojeIsoBrasilia(), 1);
  if (escDiaSemana(d) === 7) d = somaDiasIso(d, 1);
  return d;
}

// "45025/45026", "45025 - 45026" e "45025 /45026" viram "45025 / 45026",
// o formato que a importação da planilha sempre gravou no Controle de Viagens.
function escNormalizarCarga(c) {
  const partes = String(c || '').toUpperCase().split(/[\/;,]| E |-/).map(x => x.trim()).filter(Boolean);
  return partes.join(' / ');
}

function escNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim().replace(/[R$\s]/g, '');
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function escFmt(v, casas = 2) {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function escPrevisao(dataIso, dias, hora) {
  const d = somaDiasIso(dataIso, Number(dias) || 0);
  const h = /^\d{1,2}:\d{2}$/.test(String(hora || '')) ? String(hora).padStart(5, '0') : '23:59';
  return `${d}T${h}`;
}

function escPrevisaoBr(ts) {
  if (!ts) return '';
  const s = String(ts).replace(' ', 'T');
  const [d, h] = s.split('T');
  return `${escDataBr(d)} ${String(h || '').slice(0, 5)}`.trim();
}

function escUsuario() {
  return (typeof db !== 'undefined' && db.currentUser && db.currentUser.nome) ? db.currentUser.nome : 'SISTEMA';
}

// -----------------------------------------------------------------------------
// NUVEM
// -----------------------------------------------------------------------------
async function escGravar(tabela, registros) {
  const cs = window.cloudStore;
  if (!cs || !cs.isConfigured()) throw new Error('Sem conexão com a nuvem configurada neste aparelho.');
  const lista = Array.isArray(registros) ? registros : [registros];
  if (!lista.length) return;
  const st = window._escala;
  st.salvando++;
  try {
    // Todas as linhas do lote com as mesmas chaves (o PostgREST exige).
    const chaves = new Set();
    lista.forEach(r => Object.keys(r).forEach(k => { if (k.charAt(0) !== '_') chaves.add(k); }));
    const corpo = lista.map(r => {
      const o = {};
      chaves.forEach(k => { o[k] = (r[k] === undefined || r[k] === '') ? null : r[k]; });
      return o;
    });
    const resp = await fetch(`${cs.config.url}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: cs._headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(corpo)
    });
    if (!resp.ok) throw new Error(`A nuvem recusou a gravação (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  } finally {
    st.salvando--;
  }
}

function escCarimbar(reg, novo) {
  const agora = agoraIsoBrasilia();
  if (novo) { reg.criado_por = escUsuario(); reg.criado_em = agora; }
  reg.atualizado_por = escUsuario();
  reg.atualizado_em = agora;
  return reg;
}

// 2º AJUDANTE (6.11.0, migration 58). As planilhas traziam os dois num campo
// só ("KAUAN / EDSON"): ao carregar, o que vem assim e ainda não tem
// ajudante_2 é separado na tela; é gravado separado na próxima edição.
function escSepararAjudantes(r) {
  if (!r || String(r.ajudante_2 || '').trim() || String(r.ajudante || '').indexOf('/') < 0) return r;
  const partes = String(r.ajudante).split('/').map(x => x.trim()).filter(Boolean);
  r.ajudante = partes.shift() || '';
  r.ajudante_2 = partes.join(' / ');
  return r;
}

// Os dois ajudantes como pessoas (para os avisos) e como texto (imagem).
function escPessoasAjudantes(l) { return escPessoas(l.ajudante).concat(escPessoas(l.ajudante_2)); }
function escAjudantesTexto(l) {
  return [l.ajudante, l.ajudante_2].map(x => String(x || '').trim()).filter(Boolean).join(' / ');
}

async function escCarregar(forcar = false) {
  const st = window._escala;
  if (st.carregando) return;
  if (!st.data) st.data = escDataPadrao();
  const cs = window.cloudStore;
  if (!cs || !cs.isConfigured()) {
    st.erro = 'Sem conexão com a nuvem configurada neste aparelho.';
    renderApp();
    return;
  }
  st.carregando = true; st.erro = '';
  try {
    if (forcar || !st.matrizes) {
      const m = await cs._getPagina('escala_matrizes', 'is_deleted=is.false&order=dia_semana.asc,ordem.asc,id.asc');
      if (!m) throw new Error('Não foi possível ler as matrizes da escala.');
      st.matrizes = m.map(escSepararAjudantes);
    }
    const d = st.data;
    if (forcar || !st.linhas[d]) {
      const ini = somaDiasIso(d, -ESC_JANELA_VIAGEM_DIAS);
      const l = await cs._getPagina('escala_linhas',
        `is_deleted=is.false&data_escala=gte.${ini}&data_escala=lte.${d}&order=data_escala.asc,ordem.asc,id.asc`);
      if (!l) throw new Error('Não foi possível ler a escala.');
      l.forEach(escSepararAjudantes);
      st.linhas[d] = l.filter(x => x.data_escala === d);
      st.vizinhas[d] = l.filter(x => x.data_escala !== d);
    }
  } catch (e) {
    st.erro = e.message || String(e);
  } finally {
    st.carregando = false;
    renderApp();
  }
}
window.escCarregar = escCarregar;

function escFalha(e) {
  console.error('[Escala]', e);
  alert('❌ ' + (e && e.message ? e.message : e) + '\n\nA tela vai recarregar da nuvem.');
  escCarregar(true);
}

// -----------------------------------------------------------------------------
// LISTAS (cadastros que já existem no app)
// -----------------------------------------------------------------------------
function escListas() {
  const data = (typeof db !== 'undefined' && db.data) ? db.data : {};
  const vivo = x => x && !x.is_deleted;
  const motoristas = (data.motoristas || []).filter(m => vivo(m) && m.ativo !== false && !m.data_desligamento).map(m => String(m.nome || '').toUpperCase());
  const ajudantes = (data.ajudantes || []).filter(a => vivo(a) && a.ativo !== false).map(a => String(a.nome || '').toUpperCase());
  const placas = (data.veiculos || []).filter(v => vivo(v) && v.ativo !== false && String(v.situacao || '').toUpperCase() !== 'INATIVO').map(v => String(v.placa || '').toUpperCase());
  const rotas = new Set((data.rotas || []).map(r => String(r || '').toUpperCase()));
  (window._escala.matrizes || []).forEach(m => m.rota && rotas.add(m.rota));
  const uniq = arr => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { motoristas: uniq(motoristas), ajudantes: uniq(ajudantes), pessoas: uniq(motoristas.concat(ajudantes)), placas: uniq(placas), rotas: uniq(Array.from(rotas)) };
}

function escDatalists() {
  const l = escListas();
  const opt = arr => arr.map(x => `<option value="${escEsc(x)}"></option>`).join('');
  return `
    <datalist id="esc-dl-pessoas">${opt(l.pessoas)}</datalist>
    <datalist id="esc-dl-placas">${opt(l.placas)}</datalist>
    <datalist id="esc-dl-rotas">${opt(l.rotas)}</datalist>`;
}

// -----------------------------------------------------------------------------
// CABEÇALHO COMUM
// -----------------------------------------------------------------------------
function escCabecalho(icone, titulo, subtitulo, direita = '') {
  const st = window._escala;
  return `
    <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-black text-white flex items-center gap-2"><span>${icone}</span> ${titulo}</h1>
        <p class="text-xs text-slate-400">${subtitulo}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        ${st.salvando ? '<span class="text-[11px] text-amber-300">Gravando…</span>' : ''}
        ${direita}
        <button onclick="escCarregar(true)" title="Lê de novo da nuvem o que já está gravado (o que outra pessoa mudou em outro aparelho). Não refaz nem apaga nada." class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-3 py-2 rounded-xl text-xs">🔄 Recarregar</button>
      </div>
    </div>
    ${st.erro ? `<div class="bg-red-950 border border-red-800 text-red-200 rounded-xl p-3 text-xs">⚠️ ${escEsc(st.erro)}</div>` : ''}`;
}

function escSeletorData() {
  const st = window._escala;
  const dia = escDiaSemana(st.data);
  return `
    <div class="flex flex-wrap items-center gap-2">
      <button onclick="escMudarData(-1)" class="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg px-2 py-1.5 text-xs">◀</button>
      <input type="date" id="esc-data" value="${escEsc(st.data)}" onchange="escMudarData(0, this.value)"
        class="bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-xs">
      <button onclick="escMudarData(1)" class="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg px-2 py-1.5 text-xs">▶</button>
      <span class="text-xs font-bold text-emerald-300">${ESC_DIAS[dia] || ''}</span>
    </div>`;
}

function escMudarData(passo, valor) {
  const st = window._escala;
  let d = valor || somaDiasIso(st.data || escDataPadrao(), passo);
  if (!valor && escDiaSemana(d) === 7) d = somaDiasIso(d, passo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  st.data = d;
  if (!st.linhas[d]) escCarregar(); else renderApp();
}
window.escMudarData = escMudarData;

// Ponto de entrada chamado pelo renderApp() (js/app.js).
function renderEscalaView(tab) {
  const st = window._escala;
  if (!st.data) st.data = escDataPadrao();
  const precisa = !st.matrizes || (tab !== 'escala_matrizes' && !st.linhas[st.data]);
  if (precisa && !st.carregando && !st.erro) setTimeout(() => escCarregar(), 0);
  let corpo;
  if (tab === 'escala_matrizes') corpo = escTelaMatrizes();
  else if (tab === 'escala_fechamento') corpo = escTelaFechamento();
  else corpo = escTelaConvocacao();
  return `<div class="space-y-4">${corpo}</div>${escDatalists()}`;
}
window.renderEscalaView = renderEscalaView;

function escCarregandoHtml() {
  return `<div class="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-sm">Carregando da nuvem…</div>`;
}

const ESC_INPUT = 'w-full bg-slate-800 border border-slate-700 text-white rounded px-1.5 py-1 text-[11px] focus:border-emerald-500 outline-none';

// =============================================================================
// TELA 1 — MATRIZES
// =============================================================================
function escTelaMatrizes() {
  const st = window._escala;
  const cab = escCabecalho('🗂️', 'Matrizes da Escala', 'O modelo de cada dia da semana. A convocação de uma data copia a matriz do dia e depois é ajustada.');
  if (!st.matrizes) return cab + escCarregandoHtml();

  const abas = [1, 2, 3, 4, 5, 6].map(d => {
    const n = st.matrizes.filter(m => m.dia_semana === d).length;
    const ativo = st.diaMatriz === d;
    return `<button onclick="escSelDiaMatriz(${d})" class="px-3 py-1.5 rounded-lg text-xs font-bold border ${ativo ? 'bg-emerald-700 border-emerald-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}">${ESC_DIAS[d]} <span class="opacity-60">(${n})</span></button>`;
  }).join('');

  const linhas = st.matrizes.filter(m => m.dia_semana === st.diaMatriz);
  const bloco = setor => {
    const ls = linhas.filter(m => m.setor === setor);
    const tr = setor === 'TRANSBORDO';
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 ${escCorSetor(setor)} border-b border-slate-800">
          <span class="text-xs font-black text-white">${escTituloSetor(setor)} <span class="text-slate-400 font-normal">— ${ls.length} ${tr ? 'veículo(s)' : 'rota(s)'}</span></span>
          <button onclick="escMatrizNova('${setor}')" class="bg-emerald-700 hover:bg-emerald-600 text-white font-bold px-2.5 py-1 rounded-lg text-[11px]">＋ Incluir ${tr ? 'transbordo' : 'rota'}</button>
        </div>
        ${tr ? `<p class="px-3 pt-2 text-[11px] text-slate-400">Só veículo NOSSO que leva carga do CD até o cross-docking (Palmas, Marabá…). Terceiro não entra: fica só a observação, como antes. Cada rota escolhe o seu transbordo na coluna "Transbordo".</p>` : ''}
        <div class="overflow-x-auto">
          <table class="w-full text-xs min-w-[1300px]">
            <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase">
              <tr>
                <th class="p-1.5 w-8">#</th><th class="p-1.5 text-left">${tr ? 'Destino (cross-docking)' : 'Rota - Destino'}</th><th class="p-1.5 text-left w-24">Placa</th>
                <th class="p-1.5 text-left">Motorista</th><th class="p-1.5 text-left">Ajudante</th><th class="p-1.5 text-left">2º Ajudante</th><th class="p-1.5 text-left">${tr ? 'Leva as rotas' : 'Observação'}</th>
                ${tr ? '' : '<th class="p-1.5 text-left w-40">Transbordo</th>'}
                <th class="p-1.5 w-32" title="Previsão de chegada: saída + N dias, na hora indicada">Retorno</th><th class="p-1.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              ${ls.length ? ls.map((m, i) => `
                <tr class="border-t border-slate-800">
                  <td class="p-1.5 text-center text-slate-500">${tr ? "T" : ""}${i + 1}</td>
                  <td class="p-1"><input id="escm-${m.id}-rota" class="${ESC_INPUT}" list="esc-dl-rotas" value="${escEsc(m.rota)}" onchange="escMatrizCampo('${m.id}','rota',this.value)"></td>
                  <td class="p-1"><input id="escm-${m.id}-placa" class="${ESC_INPUT}" list="esc-dl-placas" value="${escEsc(m.placa)}" onchange="escMatrizCampo('${m.id}','placa',this.value)"></td>
                  <td class="p-1"><input id="escm-${m.id}-motorista" class="${ESC_INPUT}" list="esc-dl-pessoas" value="${escEsc(m.motorista)}" onchange="escMatrizCampo('${m.id}','motorista',this.value)"></td>
                  <td class="p-1"><input id="escm-${m.id}-ajudante" class="${ESC_INPUT}" list="esc-dl-pessoas" value="${escEsc(m.ajudante)}" onchange="escMatrizCampo('${m.id}','ajudante',this.value)"></td>
                  <td class="p-1"><input id="escm-${m.id}-ajudante_2" class="${ESC_INPUT}" list="esc-dl-pessoas" value="${escEsc(m.ajudante_2)}" onchange="escMatrizCampo('${m.id}','ajudante_2',this.value)"></td>
                  ${tr ? `<td class="p-1.5">${escChipsRotas(m, linhas)}</td>` : `
                  <td class="p-1"><input id="escm-${m.id}-observacao" class="${ESC_INPUT}" value="${escEsc(m.observacao)}" placeholder="${escEsc(escRotuloTransbordo(escTransbordoDe(m, linhas)))}" onchange="escMatrizCampo('${m.id}','observacao',this.value)"></td>
                  <td class="p-1">${escSelectTransbordo(m, linhas, `escMatrizCampo('${m.id}','transbordo_id',this.value)`, `escm-${m.id}-transbordo_id`)}</td>`}
                  <td class="p-1">
                    <div class="flex items-center gap-1">
                      <select id="escm-${m.id}-retorno_dias" class="${ESC_INPUT} !w-16" onchange="escMatrizCampo('${m.id}','retorno_dias',this.value)">
                        ${[0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${Number(m.retorno_dias) === n ? 'selected' : ''}>+${n}d</option>`).join('')}
                      </select>
                      <input id="escm-${m.id}-retorno_hora" type="time" class="${ESC_INPUT}" value="${escEsc(m.retorno_hora)}" onchange="escMatrizCampo('${m.id}','retorno_hora',this.value)">
                    </div>
                  </td>
                  <td class="p-1 whitespace-nowrap text-center">
                    <button onclick="escMatrizMover('${m.id}',-1)" class="text-slate-400 hover:text-white px-1" title="Subir">▲</button>
                    <button onclick="escMatrizMover('${m.id}',1)" class="text-slate-400 hover:text-white px-1" title="Descer">▼</button>
                    <button onclick="escMatrizExcluir('${m.id}')" class="text-red-400 hover:text-red-300 px-1" title="Retirar da matriz">🗑</button>
                  </td>
                </tr>`).join('') : `<tr><td colspan="10" class="p-4 text-center text-slate-500">${tr ? 'Nenhum transbordo com veículo próprio nesta matriz.' : `Nenhuma rota ${setor === 'FRIO' ? 'no frio' : 'no seco'} nesta matriz.`}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  };

  return `${cab}
    <div class="flex flex-wrap gap-2">${abas}</div>
    <p class="text-[11px] text-slate-500">Cada alteração é gravada na hora. Mudar a matriz não mexe em escalas já montadas.</p>
    ${bloco('FRIO')}
    ${bloco('SECO')}
    ${bloco('TRANSBORDO')}`;
}

// -----------------------------------------------------------------------------
// TRANSBORDO (6.11.0, migration 57): veículo próprio que leva carga do CD até
// o cross-docking. A linha de transbordo tem setor TRANSBORDO; cada ROTA aponta
// para o seu transbordo em transbordo_id (vale na matriz e na escala).
// -----------------------------------------------------------------------------
function escTituloSetor(s) { return s === 'FRIO' ? '❄️ FRIO' : (s === 'SECO' ? '📦 SECO' : '🔀 TRANSBORDO (veículo próprio)'); }
function escCorSetor(s) { return s === 'FRIO' ? 'bg-emerald-950/60' : (s === 'SECO' ? 'bg-slate-800/60' : 'bg-sky-950/60'); }

function escTransbordoDe(item, lista) {
  if (!item || !item.transbordo_id) return null;
  return (lista || []).find(x => String(x.id) === String(item.transbordo_id) && x.setor === 'TRANSBORDO') || null;
}

// O texto que ia à mão na observação: "ARMANDO - RSC7E69".
// Vazio enquanto o transbordo não tem motorista nem placa.
function escRotuloTransbordo(t) {
  if (!t) return '';
  const nome = String(t.motorista || '').trim().split(/\s+/)[0];
  const placa = String(t.placa || '').trim();
  return [nome, placa].filter(Boolean).join(' - ').toUpperCase();
}

// Os transbordos do dia (ou da matriz) em ordem: T1, T2… — o mesmo número
// que aparece na coluna # do bloco Transbordo.
function escTransbordosOrdenados(lista) {
  return (lista || []).filter(x => x.setor === 'TRANSBORDO').sort((a, b) => (a.ordem - b.ordem) || (a.id - b.id));
}

// Texto da opção: "T1 · ARMANDO - RSC7E69 · PALMAS". Dois transbordos sem
// motorista/placa ainda se distinguem pelo número.
function escRotuloOpcaoTransbordo(t, lista) {
  const n = escTransbordosOrdenados(lista).indexOf(t) + 1;
  const destino = escNorm(t.rota).replace(/^TRANSBORDO\s*/, '') || 'SEM DESTINO';
  return `T${n} · ${escRotuloTransbordo(t) || 'sem motorista/placa'} · ${destino}`;
}

// Observação que sai na imagem: rota com transbordo próprio mostra o
// transbordo ("NOME - PLACA"); sem transbordo (ou com ele ainda sem motorista
// e placa), a observação digitada — é onde fica o terceiro e qualquer recado.
function escObsImagem(l, lista) {
  const rotulo = escRotuloTransbordo(escTransbordoDe(l, lista));
  return rotulo || String(l.observacao || '').trim();
}

function escSelectTransbordo(item, lista, onchange, id) {
  const ts = escTransbordosOrdenados(lista);
  if (!ts.length) return '<span class="text-[10px] text-slate-600">—</span>';
  return `<select id="${id}" class="${ESC_INPUT}" onchange="${onchange}">
    <option value="">—</option>
    ${ts.map(t => `<option value="${t.id}" ${String(item.transbordo_id || '') === String(t.id) ? 'selected' : ''}>${escEsc(escRotuloOpcaoTransbordo(t, lista))}</option>`).join('')}
  </select>`;
}

function escChipsRotas(t, lista) {
  const rs = (lista || []).filter(x => x.setor !== 'TRANSBORDO' && String(x.transbordo_id || '') === String(t.id));
  if (!rs.length) return '<span class="text-[10px] text-amber-300">nenhuma rota ligada — escolha nas rotas (coluna Transbordo)</span>';
  return `<div class="flex flex-wrap gap-1">${rs.map(r => `<span class="bg-sky-900/60 border border-sky-800 text-sky-100 rounded px-1.5 py-0.5 text-[10px]">${escEsc(r.rota)}${r.carga ? ' · ' + escEsc(r.carga) : ''}</span>`).join('')}</div>`;
}

function escSelDiaMatriz(d) { window._escala.diaMatriz = d; renderApp(); }
window.escSelDiaMatriz = escSelDiaMatriz;

async function escMatrizCampo(id, campo, valor) {
  const m = (window._escala.matrizes || []).find(x => String(x.id) === String(id));
  if (!m) return;
  if (campo === 'retorno_dias') m[campo] = Number(valor) || 0;
  else if (campo === 'retorno_hora') m[campo] = valor || '23:59';
  else if (campo === 'transbordo_id') m[campo] = valor ? Number(valor) : null;
  else m[campo] = String(valor || '').toUpperCase().trim();
  escCarimbar(m, false);
  renderApp();
  try { await escGravar('escala_matrizes', m); } catch (e) { escFalha(e); }
  renderApp();
}
window.escMatrizCampo = escMatrizCampo;

async function escMatrizNova(setor) {
  const st = window._escala;
  const doDia = st.matrizes.filter(m => m.dia_semana === st.diaMatriz);
  const nova = escCarimbar({
    id: db.gerarIdUnico(), dia_semana: st.diaMatriz, setor,
    ordem: doDia.reduce((mx, m) => Math.max(mx, Number(m.ordem) || 0), 0) + 1,
    rota: setor === 'TRANSBORDO' ? 'TRANSBORDO PALMAS' : 'NOVA ROTA', placa: '', motorista: '', ajudante: '', observacao: '',
    retorno_dias: 0, retorno_hora: '23:59', is_deleted: false
  }, true);
  st.matrizes.push(nova);
  renderApp();
  try { await escGravar('escala_matrizes', nova); } catch (e) { escFalha(e); }
  renderApp();
  setTimeout(() => { const el = document.getElementById(`escm-${nova.id}-rota`); if (el) { el.focus(); el.select(); } }, 50);
}
window.escMatrizNova = escMatrizNova;

async function escMatrizMover(id, passo) {
  const st = window._escala;
  const m = st.matrizes.find(x => String(x.id) === String(id));
  if (!m) return;
  const grupo = st.matrizes.filter(x => x.dia_semana === m.dia_semana && x.setor === m.setor)
    .sort((a, b) => (a.ordem - b.ordem) || (a.id - b.id));
  const i = grupo.indexOf(m), j = i + passo;
  if (j < 0 || j >= grupo.length) return;
  grupo.splice(i, 1); grupo.splice(j, 0, m);
  grupo.forEach((x, k) => { x.ordem = k + 1; escCarimbar(x, false); });
  st.matrizes.sort((a, b) => (a.dia_semana - b.dia_semana) || (a.ordem - b.ordem) || (a.id - b.id));
  renderApp();
  try { await escGravar('escala_matrizes', grupo); } catch (e) { escFalha(e); }
}
window.escMatrizMover = escMatrizMover;

async function escMatrizExcluir(id) {
  const st = window._escala;
  const m = st.matrizes.find(x => String(x.id) === String(id));
  if (!m || !confirm(`Retirar a rota ${m.rota} da matriz de ${ESC_DIAS[m.dia_semana]}?`)) return;
  m.is_deleted = true; m.deleted_at = agoraIsoBrasilia(); m.deleted_by_nome = escUsuario();
  escCarimbar(m, false);
  // Transbordo retirado: as rotas que ele levava ficam sem transbordo.
  const soltas = st.matrizes.filter(x => String(x.transbordo_id || '') === String(m.id));
  soltas.forEach(x => { x.transbordo_id = null; escCarimbar(x, false); });
  st.matrizes = st.matrizes.filter(x => x !== m);
  renderApp();
  try { await escGravar('escala_matrizes', [m].concat(soltas)); } catch (e) { escFalha(e); }
}
window.escMatrizExcluir = escMatrizExcluir;

// =============================================================================
// AVISOS (não travam nada)
// =============================================================================
// Pessoas de um campo: "KAUAN / EDSON" são duas.
function escPessoas(txt) {
  return String(txt || '').split('/').map(escNorm).filter(x => x && x.length > 1);
}

function escDataViagemIso(v) {
  const s = String(v.data_saida || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
}

function escStatusViagem(v) { return String(v.status_viagem || '').toUpperCase().trim(); }

// EM ANDAMENTO, EM ANDAMENTO (PALMAS), EM RETORNO: o caminhão está na rua.
function escViagemEmAndamento(v) { return /ANDAMENTO|RETORNO/.test(escStatusViagem(v)); }

// Previsão de chegada de uma viagem pela matriz: a mesma rota no dia da
// semana da saída (ou em qualquer dia); sem rota na matriz, o dia às 23:59.
function escPrevisaoPelaMatriz(rota, saidaIso) {
  const ms = (window._escala.matrizes || []).filter(m => m.setor !== 'TRANSBORDO');
  const dia = escDiaSemana(saidaIso);
  const mesmaRota = m => escNorm(m.rota) === escNorm(rota);
  const parecida = m => escChaveRota(m.rota) === escChaveRota(rota) && escEhSeco(m.rota) === escEhSeco(rota);
  const m = ms.find(x => x.dia_semana === dia && mesmaRota(x)) || ms.find(mesmaRota)
    || ms.find(x => x.dia_semana === dia && parecida(x)) || ms.find(parecida);
  return m ? escPrevisao(saidaIso, m.retorno_dias, m.retorno_hora) : escPrevisao(saidaIso, 0, '23:59');
}

function escAvisos(linhas, dataIso, vizinhas) {
  const avisos = {};   // id da linha -> [texto]
  const add = (id, t) => { (avisos[id] = avisos[id] || []).push(t); };
  const data = (typeof db !== 'undefined' && db.data) ? db.data : {};
  const viagens = (typeof db !== 'undefined' && db.getControleViagens) ? db.getControleViagens() : [];
  const idsDestaEscala = new Set(linhas.map(l => String(l.viagem_id || '')).filter(Boolean));

  // 1) repetidos na própria escala — pessoa cruzando motorista e ajudante.
  const usoPessoa = new Map(), usoPlaca = new Map();
  linhas.forEach(l => {
    escPessoas(l.motorista).forEach(p => (usoPessoa.get(p) || usoPessoa.set(p, []).get(p)).push({ l, papel: 'motorista' }));
    escPessoasAjudantes(l).forEach(p => (usoPessoa.get(p) || usoPessoa.set(p, []).get(p)).push({ l, papel: 'ajudante' }));
    const pl = escNorm(l.placa);
    if (pl) (usoPlaca.get(pl) || usoPlaca.set(pl, []).get(pl)).push(l);
  });
  usoPessoa.forEach((usos, p) => {
    if (usos.length < 2) return;
    usos.forEach(u => {
      const outros = usos.filter(o => o !== u).map(o => `${o.l.rota} (${o.papel})`).join(', ');
      add(u.l.id, `👥 ${p} também está em ${outros}`);
    });
  });
  usoPlaca.forEach((ls, p) => {
    if (ls.length < 2) return;
    ls.forEach(l => add(l.id, `🚚 Placa ${p} também está em ${ls.filter(o => o !== l).map(o => o.rota).join(', ')}`));
  });

  // 2) inativos no cadastro.
  const inativos = new Set();
  (data.motoristas || []).forEach(m => { if (m && (m.ativo === false || m.data_desligamento)) inativos.add(escNorm(m.nome)); });
  (data.ajudantes || []).forEach(a => { if (a && a.ativo === false) inativos.add(escNorm(a.nome)); });
  const placasInativas = new Set((data.veiculos || []).filter(v => v && (v.ativo === false || String(v.situacao || '').toUpperCase() === 'INATIVO')).map(v => escNorm(v.placa)));
  linhas.forEach(l => {
    escPessoas(l.motorista).concat(escPessoasAjudantes(l)).forEach(p => { if (inativos.has(p)) add(l.id, `⛔ ${p} está inativo/desligado no cadastro`); });
    if (placasInativas.has(escNorm(l.placa))) add(l.id, `⛔ Placa ${escNorm(l.placa)} está inativa no cadastro`);
  });

  // 3) ainda em viagem (6.11.1, decisão do Tiago): só viagem EM ANDAMENTO
  //    (ou em retorno) do Controle de Viagens, e só se a previsão de chegada
  //    passa das 06:00 do dia da escala. A previsão é calculada: a da escala
  //    que gerou a viagem; sem ela, a saída + retorno da matriz da mesma rota
  //    (dia da semana da saída); sem matriz, o próprio dia às 23:59.
  const corte = `${dataIso}T06:00`;
  const ocupados = [];   // { pessoas[], placa, texto }
  const ini = somaDiasIso(dataIso, -ESC_JANELA_VIAGEM_DIAS);
  const prevPorViagem = new Map(), prevPorCarga = new Map();
  (vizinhas || []).forEach(o => {
    if (!o.previsao_retorno) return;
    if (o.viagem_id) prevPorViagem.set(String(o.viagem_id), o.previsao_retorno);
    if (o.carga) prevPorCarga.set(escNorm(o.carga), o.previsao_retorno);
  });
  viagens.forEach(v => {
    if (idsDestaEscala.has(String(v.id))) return;
    if (!escViagemEmAndamento(v)) return;
    const ds = escDataViagemIso(v);
    if (!ds || ds < ini || ds > dataIso) return;
    const prev = String(prevPorViagem.get(String(v.id)) || prevPorCarga.get(escNorm(v.carga)) || escPrevisaoPelaMatriz(v.rota, ds))
      .replace(' ', 'T').slice(0, 16);
    if (prev < corte) return;   // volta antes da saída: não é conflito
    ocupados.push({
      pessoas: escPessoas(v.motorista).concat(escPessoas(v.ajudante)).concat(escPessoas(v.ajudante_2)), placa: escNorm(v.placa),
      texto: `em viagem: ${v.rota || 'sem rota'}${v.carga ? ' (carga ' + v.carga + ')' : ''} · previsão de chegada ${escPrevisaoBr(prev)}`
    });
  });
  linhas.forEach(l => {
    const ps = escPessoas(l.motorista).concat(escPessoasAjudantes(l));
    const pl = escNorm(l.placa);
    ocupados.forEach(o => {
      ps.filter(p => o.pessoas.includes(p)).forEach(p => add(l.id, `🕒 ${p} — ${o.texto}`));
      if (pl && o.placa === pl) add(l.id, `🕒 Placa ${pl} — ${o.texto}`);
    });
  });
  return avisos;
}

// =============================================================================
// TELA 2 — CONVOCAÇÃO ESCALA
// =============================================================================
function escLinhasDaData() {
  const st = window._escala;
  const pos = { FRIO: 0, SECO: 1, TRANSBORDO: 2 };
  return (st.linhas[st.data] || []).slice().sort((a, b) =>
    ((pos[a.setor] ?? 1) - (pos[b.setor] ?? 1)) || (a.ordem - b.ordem) || (a.id - b.id));
}

function escTelaConvocacao() {
  const st = window._escala;
  const linhas = escLinhasDaData();
  const dia = escDiaSemana(st.data);
  const temMatriz = (st.matrizes || []).some(m => m.dia_semana === dia);
  const cab = escCabecalho('📣', 'Convocação Escala', 'A escala do dia, montada pela matriz. Ajuste, confira os avisos e gere a imagem para o grupo dos motoristas e ajudantes.',
    (linhas.length ? `<button onclick="escImportarFusion()" class="bg-sky-700 hover:bg-sky-600 text-white font-bold px-3 py-2 rounded-xl text-xs shadow">📥 Importar Fusion</button>` : '')
    + (linhas.length ? `<button onclick="escGerarImagem('convocacao')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-2 rounded-xl text-xs shadow">🖼️ Imagem da convocação</button>` : '')
    + (linhas.length && temMatriz ? `<button onclick="escDescartarEscala(true)" title="Apaga a escala desta data e monta de novo pela matriz do dia" class="bg-slate-800 hover:bg-slate-700 text-amber-200 border border-amber-800 font-bold px-3 py-2 rounded-xl text-xs">↺ Refazer pela matriz</button>` : '')
    + (linhas.length ? `<button onclick="escDescartarEscala(false)" title="Apaga a escala desta data: a tela volta a oferecer Montar pela matriz" class="bg-slate-800 hover:bg-slate-700 text-red-300 border border-red-900 font-bold px-3 py-2 rounded-xl text-xs">✕ Apagar escala do dia</button>` : ''));
  if (!st.matrizes || !st.linhas[st.data]) return cab + escSeletorData() + escCarregandoHtml();

  if (!linhas.length) {
    return `${cab}${escSeletorData()}
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center space-y-3">
        <p class="text-sm text-slate-300">Ainda não há escala para <b>${escDataBr(st.data)}</b> (${ESC_DIAS[dia]}).</p>
        <div class="flex flex-wrap justify-center gap-2">
          ${temMatriz ? `<button onclick="escMontar()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs shadow">📋 Montar pela matriz de ${ESC_DIAS[dia]}</button>` : `<span class="text-xs text-amber-300">Não há matriz para ${ESC_DIAS[dia] || 'este dia'}.</span>`}
          <button onclick="escLinhaNova('FRIO')" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold px-4 py-2 rounded-xl text-xs">＋ Começar em branco</button>
        </div>
      </div>`;
  }

  const avisos = escAvisos(linhas, st.data, st.vizinhas[st.data]);
  const totalAvisos = Object.keys(avisos).length;
  const trocasPendentes = linhas.filter(l => l.placa_matriz && escNorm(l.placa) !== escNorm(l.placa_matriz) && !l.troca_id);

  const bloco = setor => {
    const ls = linhas.filter(l => l.setor === setor);
    const tr = setor === 'TRANSBORDO';
    const matrizTem = (st.matrizes || []).some(m => m.dia_semana === dia && m.setor === 'TRANSBORDO');
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 ${escCorSetor(setor)} border-b border-slate-800">
          <span class="text-xs font-black text-white">${escTituloSetor(setor)} <span class="text-slate-400 font-normal">— ${ls.length} ${tr ? 'veículo(s)' : 'viagem(ns)'}</span></span>
          <div class="flex gap-2">
            ${tr && !ls.length && matrizTem ? `<button onclick="escTrazerTransbordos()" class="bg-sky-700 hover:bg-sky-600 text-white font-bold px-2.5 py-1 rounded-lg text-[11px]">Trazer da matriz de ${ESC_DIAS[dia]}</button>` : ''}
            <button onclick="escLinhaNova('${setor}')" class="bg-emerald-700 hover:bg-emerald-600 text-white font-bold px-2.5 py-1 rounded-lg text-[11px]">＋ Incluir ${tr ? 'transbordo' : 'viagem'}</button>
          </div>
        </div>
        ${tr ? `<p class="px-3 pt-2 text-[11px] text-slate-400">Só veículo NOSSO. Terceiro: deixe a observação na rota, como antes. A observação da imagem ("NOME - PLACA") sai sozinha nas rotas que escolherem este transbordo.</p>` : ''}
        <div class="overflow-x-auto">
          <table class="w-full text-xs min-w-[940px]">
            <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase">
              <tr>
                <th class="p-1.5 w-8">#</th><th class="p-1.5 text-left">${tr ? 'Destino (cross-docking)' : 'Rota - Destino'}</th><th class="p-1.5 text-left w-28">Placa</th>
                <th class="p-1.5 text-left">Motorista</th><th class="p-1.5 text-left">Ajudante</th><th class="p-1.5 text-left">2º Ajudante</th><th class="p-1.5 text-left">${tr ? 'Leva as rotas' : 'Observação'}</th>
                ${tr ? '' : '<th class="p-1.5 text-left w-28">Transbordo</th>'}
                <th class="p-1.5 w-16"></th>
              </tr>
            </thead>
            <tbody>
              ${ls.length ? ls.map((l, i) => {
                const trocou = l.placa_matriz && escNorm(l.placa) !== escNorm(l.placa_matriz);
                const av = avisos[l.id] || [];
                return `
                <tr class="border-t border-slate-800 ${av.length ? 'bg-amber-950/20' : ''}">
                  <td class="p-1.5 text-center text-slate-500">${tr ? "T" : ""}${i + 1}</td>
                  <td class="p-1"><input id="escl-${l.id}-rota" class="${ESC_INPUT}" list="esc-dl-rotas" value="${escEsc(l.rota)}" onchange="escLinhaCampo('${l.id}','rota',this.value)"></td>
                  <td class="p-1">
                    <input id="escl-${l.id}-placa" class="${ESC_INPUT} ${trocou ? '!border-amber-500' : ''}" list="esc-dl-placas" value="${escEsc(l.placa)}" onchange="escLinhaCampo('${l.id}','placa',this.value)">
                    ${trocou ? `<div class="text-[10px] mt-0.5 ${l.troca_id ? 'text-emerald-400' : 'text-amber-300'}">matriz: ${escEsc(l.placa_matriz)} ${l.troca_id ? '· troca registrada' : `· <button onclick="escAbrirTroca('${l.id}')" class="underline font-bold">registrar troca</button>`}</div>` : ''}
                  </td>
                  <td class="p-1"><input id="escl-${l.id}-motorista" class="${ESC_INPUT}" list="esc-dl-pessoas" value="${escEsc(l.motorista)}" onchange="escLinhaCampo('${l.id}','motorista',this.value)"></td>
                  <td class="p-1"><input id="escl-${l.id}-ajudante" class="${ESC_INPUT}" list="esc-dl-pessoas" value="${escEsc(l.ajudante)}" onchange="escLinhaCampo('${l.id}','ajudante',this.value)"></td>
                  <td class="p-1"><input id="escl-${l.id}-ajudante_2" class="${ESC_INPUT}" list="esc-dl-pessoas" value="${escEsc(l.ajudante_2)}" onchange="escLinhaCampo('${l.id}','ajudante_2',this.value)"></td>
                  ${tr ? `<td class="p-1.5">${escChipsRotas(l, linhas)}</td>` : `
                  <td class="p-1"><input id="escl-${l.id}-observacao" class="${ESC_INPUT}" value="${escEsc(l.observacao)}" placeholder="${escEsc(escRotuloTransbordo(escTransbordoDe(l, linhas)))}" onchange="escLinhaCampo('${l.id}','observacao',this.value)">
                    ${escRotuloTransbordo(escTransbordoDe(l, linhas)) && String(l.observacao || '').trim() ? `<div class="text-[10px] text-sky-300 mt-0.5">na imagem: ${escEsc(escRotuloTransbordo(escTransbordoDe(l, linhas)))}</div>` : ''}</td>
                  <td class="p-1">${escSelectTransbordo(l, linhas, `escLinhaCampo('${l.id}','transbordo_id',this.value)`, `escl-${l.id}-transbordo_id`)}</td>`}
                  <td class="p-1 whitespace-nowrap text-center">
                    <button onclick="escLinhaMover('${l.id}',-1)" class="text-slate-400 hover:text-white px-0.5" title="Subir">▲</button>
                    <button onclick="escLinhaMover('${l.id}',1)" class="text-slate-400 hover:text-white px-0.5" title="Descer">▼</button>
                    <button onclick="escLinhaExcluir('${l.id}')" class="text-red-400 hover:text-red-300 px-0.5" title="Retirar viagem">🗑</button>
                  </td>
                </tr>
                ${av.length ? `<tr class="bg-amber-950/20"><td></td><td colspan="8" class="px-2 pb-2 text-[11px] text-amber-200 space-y-0.5">${av.map(t => `<div>${escEsc(t)}</div>`).join('')}</td></tr>` : ''}`;
              }).join('') : `<tr><td colspan="9" class="p-4 text-center text-slate-500">${tr ? 'Nenhum transbordo com veículo próprio nesta data.' : `Nenhuma viagem ${setor === 'FRIO' ? 'no frio' : 'no seco'}.`}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  };

  return `${cab}
    <div class="flex flex-wrap items-center justify-between gap-2">
      ${escSeletorData()}
      <div class="flex flex-wrap gap-2 text-[11px]">
        <span class="px-2 py-1 rounded-lg border ${totalAvisos ? 'border-amber-700 text-amber-300 bg-amber-950/40' : 'border-emerald-800 text-emerald-300 bg-emerald-950/40'}">${totalAvisos ? `⚠️ ${totalAvisos} viagem(ns) com aviso` : '✅ Sem avisos'}</span>
        ${trocasPendentes.length ? `<span class="px-2 py-1 rounded-lg border border-amber-700 text-amber-300 bg-amber-950/40">🔄 ${trocasPendentes.length} troca(s) de veículo sem registro</span>` : ''}
      </div>
    </div>
    <p class="text-[11px] text-slate-500">Avisos não travam nada: a pessoa é procurada como motorista e como ajudante nesta escala e nas viagens EM ANDAMENTO do Controle de Viagens que só chegam depois das 06:00 deste dia (previsão calculada pela escala ou pela matriz da rota).</p>
    ${bloco('FRIO')}
    ${bloco('SECO')}
    ${bloco('TRANSBORDO')}`;
}

function escLinhaDaMatriz(m, data) {
  return escCarimbar({
    id: db.gerarIdUnico(), data_escala: data, setor: m.setor, ordem: m.ordem,
    rota: m.rota, placa: m.placa || '', placa_matriz: m.placa || '',
    motorista: m.motorista || '', ajudante: m.ajudante || '', ajudante_2: m.ajudante_2 || '', observacao: m.observacao || '',
    previsao_retorno: escPrevisao(data, m.retorno_dias, m.retorno_hora),
    matriz_id: m.id, transbordo_id: null, is_deleted: false
  }, true);
}

// Desfaz a escala da data aberta (6.11.1, pedido do Tiago: depois de montada
// não havia como "fechar" a convocação). Exclusão lógica de todas as linhas;
// com `refazer`, monta de novo pela matriz do dia. Viagens já criadas no
// Controle de Viagens e trocas registradas ficam onde estão.
async function escDescartarEscala(refazer) {
  const st = window._escala;
  const ls = (st.linhas[st.data] || []).slice();
  if (!ls.length) return;
  const comViagem = ls.filter(l => l.viagem_id);
  const msg = (refazer
      ? `Refazer a escala de ${escDataBr(st.data)} pela matriz de ${ESC_DIAS[escDiaSemana(st.data)]}?\n\nTudo o que foi ajustado nesta data (placas, nomes, viagens incluídas, transbordos) volta a ser o da matriz.`
      : `Apagar a escala de ${escDataBr(st.data)}?\n\nA tela volta a mostrar "Montar pela matriz".`)
    + (comViagem.length ? `\n\n⚠️ ${comViagem.length} linha(s) já têm carga e viraram viagem no Controle de Viagens. As viagens NÃO são apagadas: se for o caso, exclua lá.` : '');
  if (!confirm(msg)) return;
  const agora = agoraIsoBrasilia();
  ls.forEach(l => { l.is_deleted = true; l.deleted_at = agora; l.deleted_by_nome = escUsuario(); escCarimbar(l, false); });
  st.linhas[st.data] = [];
  renderApp();
  try { await escGravar('escala_linhas', ls); } catch (e) { escFalha(e); return; }
  if (refazer) await escMontar();
  else renderApp();
}
window.escDescartarEscala = escDescartarEscala;

async function escMontar() {
  const st = window._escala;
  const dia = escDiaSemana(st.data);
  const modelo = (st.matrizes || []).filter(m => m.dia_semana === dia);
  if (!modelo.length) return;
  if ((st.linhas[st.data] || []).length) return;
  const novas = modelo.map(m => escLinhaDaMatriz(m, st.data));
  // transbordo_id da matriz aponta para a linha da matriz; na escala, para a
  // linha nova que veio dela.
  const porMatriz = new Map(novas.map(l => [String(l.matriz_id), l.id]));
  novas.forEach((l, i) => { const t = modelo[i].transbordo_id; if (t && porMatriz.has(String(t))) l.transbordo_id = porMatriz.get(String(t)); });
  st.linhas[st.data] = novas;
  renderApp();
  try { await escGravar('escala_linhas', novas); } catch (e) { escFalha(e); }
  renderApp();
}
window.escMontar = escMontar;

// Escala montada antes da 6.11.0 (sem transbordo): traz os transbordos da
// matriz do dia e liga as rotas que vieram da mesma matriz.
async function escTrazerTransbordos() {
  const st = window._escala;
  const dia = escDiaSemana(st.data);
  const ls = st.linhas[st.data] = st.linhas[st.data] || [];
  const modelo = (st.matrizes || []).filter(m => m.dia_semana === dia && m.setor === 'TRANSBORDO');
  if (!modelo.length || ls.some(l => l.setor === 'TRANSBORDO')) return;
  const novas = modelo.map(m => escLinhaDaMatriz(m, st.data));
  const alteradas = novas.slice();
  novas.forEach(t => {
    (st.matrizes || []).filter(m => String(m.transbordo_id || '') === String(t.matriz_id)).forEach(m => {
      const r = ls.find(x => String(x.matriz_id) === String(m.id) && !x.transbordo_id);
      if (!r) return;
      r.transbordo_id = t.id;
      // a observação "NOME - PLACA" digitada antes vira a automática
      if (escNorm(r.observacao) === escNorm(escRotuloTransbordo(t))) r.observacao = '';
      escCarimbar(r, false);
      alteradas.push(r);
    });
  });
  ls.push(...novas);
  alteradas.push(...escSincronizarTransbordos());
  renderApp();
  try { await escGravar('escala_linhas', escUnicas(alteradas)); } catch (e) { escFalha(e); }
  renderApp();
}
window.escTrazerTransbordos = escTrazerTransbordos;

function escUnicas(arr) {
  const vistos = new Set();
  return arr.filter(x => { const k = String(x.id); if (vistos.has(k)) return false; vistos.add(k); return true; });
}

// Número do transbordo no Controle de Viagens. A carga é única na tabela e as
// cargas que ele leva já são das rotas, por isso um número próprio. Não começa
// com dígito: o cruzamento com o WinThor, que separa números de carga, não o
// confunde com as rotas.
function escCargaTransbordo(t) {
  return `TRANSB ${escDataBr(t.data_escala).replace(/\//g, '.')} ${escNorm(t.placa).replace(/[^A-Z0-9]/g, '') || 'SEM PLACA'}`;
}

function escRotasDoTransbordo(t) {
  const ls = (window._escala.linhas[t.data_escala] || []);
  return ls.filter(r => r.setor !== 'TRANSBORDO' && String(r.transbordo_id || '') === String(t.id));
}

// O transbordo vira viagem quando alguma rota que ele leva tem carga. Devolve
// as linhas de transbordo que mudaram (para gravar).
function escSincronizarTransbordos() {
  const st = window._escala;
  const mudou = [];
  (st.linhas[st.data] || []).filter(t => t.setor === 'TRANSBORDO').forEach(t => {
    const temCarga = escRotasDoTransbordo(t).some(r => String(r.carga || '').trim());
    if (!temCarga && !t.viagem_id) return;
    const antes = `${t.carga}|${t.viagem_id}`;
    t.carga = escCargaTransbordo(t);
    escSincronizarViagem(t);
    if (`${t.carga}|${t.viagem_id}` !== antes) escCarimbar(t, false);
    mudou.push(t);
  });
  return mudou;
}

async function escLinhaNova(setor) {
  const st = window._escala;
  const ls = st.linhas[st.data] = st.linhas[st.data] || [];
  const nova = escCarimbar({
    id: db.gerarIdUnico(), data_escala: st.data, setor,
    ordem: ls.filter(l => l.setor === setor).reduce((mx, l) => Math.max(mx, Number(l.ordem) || 0), 0) + 1,
    rota: setor === 'TRANSBORDO' ? 'TRANSBORDO PALMAS' : 'NOVA ROTA', placa: '', placa_matriz: '', motorista: '', ajudante: '', observacao: '',
    previsao_retorno: escPrevisao(st.data, 0, '23:59'), is_deleted: false
  }, true);
  ls.push(nova);
  renderApp();
  try { await escGravar('escala_linhas', nova); } catch (e) { escFalha(e); }
  renderApp();
  setTimeout(() => { const el = document.getElementById(`escl-${nova.id}-rota`); if (el) { el.focus(); el.select(); } }, 50);
}
window.escLinhaNova = escLinhaNova;

function escLinha(id) {
  const st = window._escala;
  return (st.linhas[st.data] || []).find(x => String(x.id) === String(id));
}

async function escLinhaCampo(id, campo, valor) {
  const l = escLinha(id);
  if (!l) return;
  const antes = l[campo];
  if (['peso', 'valor', 'qt_entregas'].includes(campo) && String(valor || '').trim() && escNumero(valor) === null) {
    alert(`⚠️ "${valor}" não é um número válido. O valor anterior foi mantido.`);
    renderApp();
    return;
  }
  if (campo === 'previsao_retorno') l[campo] = valor || null;
  else if (campo === 'peso' || campo === 'valor') l[campo] = escNumero(valor);
  else if (campo === 'qt_entregas') { const n = escNumero(valor); l[campo] = n === null ? null : Math.round(n); }
  else if (campo === 'carga') l[campo] = escNormalizarCarga(valor);
  else if (campo === 'transbordo_id') l[campo] = valor ? Number(valor) : null;
  else l[campo] = String(valor || '').toUpperCase().trim();
  escCarimbar(l, false);

  // A viagem acompanha a linha: nasce quando a carga é informada e depois
  // recebe as mudanças de rota, placa, motorista e ajudante. A do transbordo
  // nasce quando uma rota que ele leva ganha carga (escSincronizarTransbordos).
  let avisoViagem = '';
  if (l.setor !== 'TRANSBORDO' && ['carga', 'rota', 'placa', 'motorista', 'ajudante', 'ajudante_2', 'observacao'].includes(campo)) {
    avisoViagem = escSincronizarViagem(l) || '';
  }
  const transbordos = escSincronizarTransbordos();
  renderApp();
  try { await escGravar('escala_linhas', escUnicas([l].concat(transbordos))); } catch (e) { escFalha(e); return; }
  renderApp();
  if (avisoViagem) alert(avisoViagem);

  // Placa mudou em relação à matriz: abre a ocorrência de troca.
  if (campo === 'placa' && l.placa_matriz && escNorm(l.placa) !== escNorm(l.placa_matriz) && escNorm(antes) !== escNorm(l.placa) && !l.troca_id) {
    escAbrirTroca(l.id);
  }
}
window.escLinhaCampo = escLinhaCampo;

// Cria ou atualiza a viagem do Controle de Viagens desta linha. Devolve um
// texto para avisar o usuário quando algo não sai como o esperado.
function escSincronizarViagem(l) {
  if (typeof db === 'undefined') return '';
  const carga = escNormalizarCarga(l.carga);
  const dados = {
    carga, rota: l.rota, placa: l.placa, motorista: l.motorista, ajudante: l.ajudante, ajudante_2: l.ajudante_2 || '',
    setor: l.setor, data_saida: l.data_escala,
    observacao: l.setor === 'TRANSBORDO'
      ? 'CROSS-DOCKING: ' + escRotasDoTransbordo(l).map(r => r.rota + (r.carga ? ` (${r.carga})` : '')).join(', ')
      : (l.observacao || '')
  };
  const viagens = db.getControleViagens();
  let v = l.viagem_id ? viagens.find(x => String(x.id) === String(l.viagem_id)) : null;
  if (!carga) return '';   // sem carga não há viagem; a já criada fica como está
  const mesmaCarga = viagens.find(x => escNorm(x.carga) === escNorm(carga) && (!v || x.id !== v.id));
  if (v) {
    if (mesmaCarga) return `⚠️ A carga ${carga} já está em outra viagem do Controle de Viagens (${mesmaCarga.rota || 'sem rota'}). A viagem desta linha não foi alterada.`;
    db.updateViagem(v.id, dados);
    return '';
  }
  if (mesmaCarga) {
    // Viagem que já existia (ex.: importada da planilha): passa a ser desta linha.
    l.viagem_id = mesmaCarga.id;
    db.updateViagem(mesmaCarga.id, dados);
    return '';
  }
  const nova = db.addViagem(Object.assign({ status_viagem: '' }, dados));
  l.viagem_id = nova.id;
  if (window.cloudStore && window.cloudStore.isConfigured()) window.cloudStore.syncLocalToCloud().catch(() => {});
  return '';
}

async function escLinhaMover(id, passo) {
  const st = window._escala;
  const l = escLinha(id);
  if (!l) return;
  const grupo = (st.linhas[st.data] || []).filter(x => x.setor === l.setor).sort((a, b) => (a.ordem - b.ordem) || (a.id - b.id));
  const i = grupo.indexOf(l), j = i + passo;
  if (j < 0 || j >= grupo.length) return;
  grupo.splice(i, 1); grupo.splice(j, 0, l);
  grupo.forEach((x, k) => { x.ordem = k + 1; escCarimbar(x, false); });
  renderApp();
  try { await escGravar('escala_linhas', grupo); } catch (e) { escFalha(e); }
}
window.escLinhaMover = escLinhaMover;

async function escLinhaExcluir(id) {
  const st = window._escala;
  const l = escLinha(id);
  if (!l) return;
  const msg = l.viagem_id
    ? `Retirar ${l.rota} da escala?\n\nEsta linha já tem a carga ${l.carga} e virou viagem no Controle de Viagens. A viagem NÃO é excluída: se for o caso, exclua lá.`
    : `Retirar ${l.rota} da escala de ${escDataBr(l.data_escala)}?`;
  if (!confirm(msg)) return;
  l.is_deleted = true; l.deleted_at = agoraIsoBrasilia(); l.deleted_by_nome = escUsuario();
  escCarimbar(l, false);
  // Transbordo retirado: as rotas que ele levava ficam sem transbordo.
  const soltas = (st.linhas[st.data] || []).filter(x => String(x.transbordo_id || '') === String(l.id));
  soltas.forEach(x => { x.transbordo_id = null; escCarimbar(x, false); });
  st.linhas[st.data] = (st.linhas[st.data] || []).filter(x => x !== l);
  renderApp();
  try { await escGravar('escala_linhas', [l].concat(soltas)); } catch (e) { escFalha(e); }
}
window.escLinhaExcluir = escLinhaExcluir;

// -----------------------------------------------------------------------------
// TROCA DE VEÍCULO (mesma tabela e mesmas listas da tela Troca de Veículos)
// -----------------------------------------------------------------------------
function escAbrirTroca(id) {
  const l = escLinha(id);
  const modal = document.getElementById('modal-container');
  if (!l || !modal) return;
  const autorizadores = ["LUIZ EDUARDO", "WELINTON", "VICTOR HUGO", "NÃO AUTORIZADO", "GUSTAVO CARDOSO", "MELQUIADES NETO", "MARCOS ADRIANO", "PAULO SILVA", "ROBSON PINHEIRO"];
  const motivos = ["PESO EXCEDIDO", "VEÍCULO EM ROTA", "MANUTENÇÃO INTERNA", "MANUTENÇÃO EXTERNA", "VEÍCULO CARREGADO", "CONDUTA INADEQUADA", "OUTROS (OPÇÃO DE INCLUIR)"];
  const cls = 'w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5';
  modal.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg w-full shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <h3 class="font-bold text-white text-sm">🔄 Troca de Veículo — ${escEsc(l.rota)}</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white text-sm">✕</button>
      </div>
      <p class="text-[11px] text-slate-400">A placa da escala de ${escDataBr(l.data_escala)} ficou diferente da matriz. Registre a troca; ela entra na tela Troca de Veículos.</p>
      <form onsubmit="escSalvarTroca(event, '${l.id}')" class="space-y-3 text-xs">
        <div class="grid grid-cols-2 gap-2">
          <div><label class="block text-[10px] text-slate-400 mb-1">Data</label><input type="date" id="esc-tr-data" value="${escEsc(l.data_escala)}" class="${cls}"></div>
          <div><label class="block text-[10px] text-slate-400 mb-1">Autorizado por</label>
            <select id="esc-tr-autorizado" class="${cls}">${autorizadores.map(a => `<option value="${a}">${a}</option>`).join('')}</select></div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="block text-[10px] text-amber-400 font-bold mb-1">Veículo escalado (matriz)</label><input id="esc-tr-escalado" value="${escEsc(l.placa_matriz)}" class="${cls}"></div>
          <div><label class="block text-[10px] text-emerald-400 font-bold mb-1">Veículo trocado</label><input id="esc-tr-trocado" value="${escEsc(l.placa)}" class="${cls}"></div>
        </div>
        <div><label class="block text-[10px] text-slate-400 mb-1">Motivo resumido</label>
          <select id="esc-tr-motivo" class="${cls}" onchange="document.getElementById('esc-tr-outro').classList.toggle('hidden', this.value !== 'OUTROS (OPÇÃO DE INCLUIR)')">${motivos.map(m => `<option value="${m}">${m}</option>`).join('')}</select>
          <input id="esc-tr-outro" placeholder="Qual motivo?" class="${cls} mt-1 hidden"></div>
        <div><label class="block text-[10px] text-slate-400 mb-1">Detalhamento</label><textarea id="esc-tr-detalhe" rows="2" class="${cls}">ESCALA ${escEsc(escDataBr(l.data_escala))} - ${escEsc(l.rota)}</textarea></div>
        <div class="flex justify-end gap-2">
          <button type="button" onclick="closeModal()" class="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-1.5 rounded">Agora não</button>
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded">Registrar troca</button>
        </div>
      </form>
    </div>`;
  modal.classList.remove('hidden');
}
window.escAbrirTroca = escAbrirTroca;

async function escSalvarTroca(e, id) {
  e.preventDefault();
  const l = escLinha(id);
  if (!l) return;
  const t = db.addTrocaVeiculo({
    data: document.getElementById('esc-tr-data').value,
    veiculo_escalado: document.getElementById('esc-tr-escalado').value,
    veiculo_trocado: document.getElementById('esc-tr-trocado').value,
    motivo_resumido: document.getElementById('esc-tr-motivo').value,
    motivo_outro: document.getElementById('esc-tr-outro').value || '',
    detalhamento: document.getElementById('esc-tr-detalhe').value,
    autorizado_por: document.getElementById('esc-tr-autorizado').value
  });
  l.troca_id = t.id;
  escCarimbar(l, false);
  closeModal();
  renderApp();
  try { await escGravar('escala_linhas', l); } catch (err) { escFalha(err); }
  renderApp();
}
window.escSalvarTroca = escSalvarTroca;

// =============================================================================
// IMPORTAÇÃO DAS ROTEIRIZAÇÕES DO FUSION (6.10.0)
// =============================================================================
// O "roteirizacoes (N).xlsx" exportado do Fusion traz, por carga: CARGA ERP
// ("45046,45047"), ENTREGAS, PESO (KG), VALOR (R$), DESTINO, MOTORISTA,
// VEICULO e AJUDANTE 1..4 ("AJD. MOT. FULANO"). Conferido em 30/10/2026: os
// números batem com o FECHAMENTO DIA 30.10.2026 digitado à mão.
//
// Cada linha do arquivo é ligada a uma linha da escala da data aberta, nesta
// ordem: a mesma carga já informada > o mesmo destino (sem acento, "SECO -
// ARAGUAINA" = "ARAGUAINA SECO") > a mesma placa > o mesmo motorista. O que
// não casa fica para escolher na tela de conferência (padrão: ignorar; ex.:
// ARAGUAINA CARNE, que não entra na escala). Nada é gravado antes do Aplicar.
function escImportarFusion() {
  if (typeof XLSX === 'undefined') { alert('⚠️ A biblioteca de leitura de Excel (SheetJS) não está carregada.'); return; }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls,.csv';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const rows = escLerFusion(wb);
        if (!rows.length) { alert('⚠️ Não achei nenhuma carga no arquivo. É a exportação de roteirizações do Fusion (coluna CARGA ERP)?'); return; }
        escAbrirConferenciaFusion(rows, f.name);
      } catch (err) {
        alert('❌ Erro ao ler o arquivo: ' + (err.message || err));
      }
    };
    r.readAsArrayBuffer(f);
  };
  inp.click();
}
window.escImportarFusion = escImportarFusion;

function escLerFusion(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const tab = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  const iCab = tab.findIndex(r => r.some(c => escNorm(c) === 'CARGA ERP'));
  if (iCab < 0) return [];
  const cab = tab[iCab].map(escNorm);
  const col = nome => cab.indexOf(nome);
  const c = {
    carga: col('CARGA ERP'), entregas: col('ENTREGAS'), peso: col('PESO (KG)'), valor: col('VALOR (R$)'),
    destino: col('DESTINO'), motorista: col('MOTORISTA'), placa: col('VEICULO'), saida: col('DATA SAIDA REAL'),
    filial: col('FILIAL EXPEDICAO')
  };
  const ajud = cab.map((h, i) => /^AJUDANTE \d/.test(h) ? i : -1).filter(i => i >= 0);
  const num = v => (typeof v === 'number') ? v : escNumero(v);
  const txt = (r, i) => i < 0 ? '' : String(r[i] === null || r[i] === undefined ? '' : r[i]).trim();
  return tab.slice(iCab + 1).filter(r => txt(r, c.carga)).map(r => ({
    carga: escNormalizarCarga(txt(r, c.carga)),
    qt_entregas: (() => { const n = num(r[c.entregas]); return n === null ? null : Math.round(n); })(),
    peso: num(r[c.peso]),
    valor: num(r[c.valor]),
    destino: txt(r, c.destino).toUpperCase(),
    motorista: txt(r, c.motorista).toUpperCase(),
    placa: txt(r, c.placa).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    // AJUDANTE 1 -> ajudante; AJUDANTE 2 (e 3, 4, se vierem) -> ajudante_2.
    ...(() => {
      const a = ajud.map(i => txt(r, i).toUpperCase().replace(/^AJD\.?\s*MOT\.?\s*/, '').trim()).filter(Boolean);
      return { ajudante: a[0] || '', ajudante_2: a.slice(1).join(' / ') };
    })(),
    saida: txt(r, c.saida),
    // "CROSS DOCKING PALMAS" = a carga vai por transbordo até Palmas.
    crossDocking: (() => { const m = escNorm(txt(r, c.filial)).match(/CROSS\s*-?\s*DOCKING\s*(.*)$/); return m ? (m[1] || 'CROSS-DOCKING').trim() : ''; })()
  }));
}

// Destino/rota comparáveis: sem acento, sem o "SECO" na frente ou atrás.
function escChaveRota(s) {
  return escNorm(s).replace(/^SECO\s*-\s*/, '').replace(/\s*-?\s*SECO$/, '').trim();
}
function escEhSeco(s) { return /(^|\s|-)SECO(\s|-|$)/.test(escNorm(s)); }

function escCasarFusion(rows, linhas) {
  const usadas = new Set();
  const pares = rows.map(() => null);
  const pontos = (f, l) => {
    if (f.carga && escNorm(l.carga) === escNorm(f.carga)) return 100;
    let p = 0;
    if (escChaveRota(l.rota) === escChaveRota(f.destino) && escEhSeco(l.rota) === escEhSeco(f.destino)) p += 10;
    if (f.placa && escNorm(l.placa) === f.placa) p += 5;
    if (f.motorista && escPessoas(l.motorista).includes(escNorm(f.motorista))) p += 3;
    return p;
  };
  const cand = [];
  // O caminhão do transbordo não tem carga própria no Fusion: nunca é alvo.
  rows.forEach((f, i) => linhas.forEach(l => { if (l.setor === 'TRANSBORDO') return; const p = pontos(f, l); if (p >= 3) cand.push({ i, l, p }); }));
  cand.sort((a, b) => b.p - a.p);
  cand.forEach(({ i, l }) => {
    if (pares[i] || usadas.has(String(l.id))) return;
    pares[i] = String(l.id); usadas.add(String(l.id));
  });
  return pares;
}

function escAbrirConferenciaFusion(rows, nomeArquivo) {
  const st = window._escala;
  const linhas = escLinhasDaData();
  const pares = escCasarFusion(rows, linhas);
  window._escFusion = { rows, escolha: pares.map(p => p || (linhas.length ? 'IGNORAR' : 'NOVA')), atualizarPessoas: true };
  const modal = document.getElementById('modal-container');
  if (!modal) return;
  const opcoes = (i) => {
    const atual = window._escFusion.escolha[i];
    const ls = linhas.filter(l => l.setor !== 'TRANSBORDO').map(l => `<option value="${l.id}" ${atual === String(l.id) ? 'selected' : ''}>${escEsc(l.setor)} · ${escEsc(l.rota)} (${escEsc(l.placa || 'sem placa')})</option>`).join('');
    return `<select class="${ESC_INPUT}" onchange="window._escFusion.escolha[${i}]=this.value; escFusionResumo()">
      <option value="IGNORAR" ${atual === 'IGNORAR' ? 'selected' : ''}>— Ignorar —</option>
      <option value="NOVA" ${atual === 'NOVA' ? 'selected' : ''}>＋ Incluir como nova viagem</option>
      ${ls}</select>`;
  };
  const diferencas = (f, l) => {
    if (!l) return '';
    const d = [];
    if (f.placa && escNorm(l.placa) !== f.placa) d.push(`placa ${escEsc(l.placa || '—')} → <b>${escEsc(f.placa)}</b>`);
    if (f.motorista && escNorm(l.motorista) !== escNorm(f.motorista)) d.push(`motorista ${escEsc(l.motorista || '—')} → <b>${escEsc(f.motorista)}</b>`);
    if (f.ajudante && escNorm(l.ajudante) !== escNorm(f.ajudante)) d.push(`ajudante ${escEsc(l.ajudante || '—')} → <b>${escEsc(f.ajudante)}</b>`);
    if (f.ajudante && escNorm(l.ajudante_2) !== escNorm(f.ajudante_2)) d.push(`2º ajudante ${escEsc(l.ajudante_2 || '—')} → <b>${escEsc(f.ajudante_2 || '—')}</b>`);
    return d.join('<br>');
  };
  modal.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-4 max-w-6xl w-full shadow-2xl space-y-3 max-h-[92vh] flex flex-col">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <h3 class="font-bold text-white text-sm">📥 Roteirizações do Fusion → escala de ${escDataBr(st.data)}</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white text-sm">✕</button>
      </div>
      <p class="text-[11px] text-slate-400">${escEsc(nomeArquivo)} · ${rows.length} carga(s). Confira a linha da escala de cada carga. Nada é gravado antes de <b>Aplicar</b>.</p>
      <div class="overflow-auto flex-1">
        <table class="w-full text-xs min-w-[900px]">
          <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase sticky top-0">
            <tr><th class="p-1.5 text-left">Carga</th><th class="p-1.5 text-left">Destino (Fusion)</th><th class="p-1.5 text-left">Placa / Motorista</th>
            <th class="p-1.5 text-right">Peso</th><th class="p-1.5 text-right">Valor</th><th class="p-1.5 text-right">Entr.</th><th class="p-1.5 text-left">Saída real</th>
            <th class="p-1.5 text-left w-64">Linha da escala</th><th class="p-1.5 text-left">Muda na escala</th></tr>
          </thead>
          <tbody>
            ${rows.map((f, i) => {
              const l = linhas.find(x => String(x.id) === pares[i]);
              return `<tr class="border-t border-slate-800 align-top">
                <td class="p-1.5 font-bold text-white whitespace-nowrap">${escEsc(f.carga)}</td>
                <td class="p-1.5 text-slate-200">${escEsc(f.destino)}${f.crossDocking ? `<br><span class="text-[10px] text-sky-300">via cross-docking ${escEsc(f.crossDocking)}</span>` : ''}</td>
                <td class="p-1.5 text-slate-300">${escEsc(f.placa)}<br><span class="text-[10px]">${escEsc(f.motorista)}</span><br><span class="text-[10px] text-slate-500">${escEsc(escAjudantesTexto(f))}</span></td>
                <td class="p-1.5 text-right">${escFmt(f.peso)}</td>
                <td class="p-1.5 text-right whitespace-nowrap">R$ ${escFmt(f.valor)}</td>
                <td class="p-1.5 text-right">${f.qt_entregas === null ? '' : f.qt_entregas}</td>
                <td class="p-1.5 text-[10px] text-slate-400 whitespace-nowrap">${escEsc(f.saida || '—')}</td>
                <td class="p-1.5">${opcoes(i)}</td>
                <td class="p-1.5 text-[10px] text-amber-200">${diferencas(f, l)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <label class="flex items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked onchange="window._escFusion.atualizarPessoas=this.checked">
        Atualizar placa, motorista e ajudante da escala pelo Fusion (placa diferente da matriz fica como troca de veículo a registrar)
      </label>
      <div class="flex flex-wrap justify-between items-center gap-2 text-xs">
        <span id="esc-fusion-resumo" class="text-slate-400"></span>
        <div class="flex gap-2">
          <button onclick="closeModal()" class="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg">Cancelar</button>
          <button onclick="escAplicarFusion()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-2 rounded-lg">Aplicar</button>
        </div>
      </div>
    </div>`;
  modal.classList.remove('hidden');
  escFusionResumo();
}

function escFusionResumo() {
  const el = document.getElementById('esc-fusion-resumo');
  const fz = window._escFusion;
  if (!el || !fz) return;
  const e = fz.escolha;
  const ligadas = e.filter(x => x !== 'IGNORAR' && x !== 'NOVA');
  const repetidas = ligadas.filter((x, i) => ligadas.indexOf(x) !== i).length;
  el.innerHTML = `${ligadas.length} na escala · ${e.filter(x => x === 'NOVA').length} nova(s) · ${e.filter(x => x === 'IGNORAR').length} ignorada(s)`
    + (repetidas ? ` · <span class="text-red-300 font-bold">⚠️ duas cargas na mesma linha</span>` : '');
}
window.escFusionResumo = escFusionResumo;

async function escAplicarFusion() {
  const st = window._escala;
  const fz = window._escFusion;
  if (!fz) return;
  const ligadas = fz.escolha.filter(x => x !== 'IGNORAR' && x !== 'NOVA');
  if (ligadas.some((x, i) => ligadas.indexOf(x) !== i)) {
    alert('⚠️ Duas cargas do Fusion estão apontando para a mesma linha da escala. Ajuste antes de aplicar.');
    return;
  }
  const ls = st.linhas[st.data] = st.linhas[st.data] || [];
  const alteradas = [];
  const avisos = [];
  const semTransbordo = [];
  fz.rows.forEach((f, i) => {
    const alvo = fz.escolha[i];
    if (alvo === 'IGNORAR') return;
    let l;
    if (alvo === 'NOVA') {
      const setor = escEhSeco(f.destino) ? 'SECO' : 'FRIO';
      l = escCarimbar({
        id: db.gerarIdUnico(), data_escala: st.data, setor,
        ordem: ls.filter(x => x.setor === setor).reduce((mx, x) => Math.max(mx, Number(x.ordem) || 0), 0) + 1,
        rota: f.destino || 'SEM DESTINO', placa: f.placa, placa_matriz: '', motorista: f.motorista, ajudante: f.ajudante, ajudante_2: f.ajudante_2,
        observacao: '', previsao_retorno: escPrevisao(st.data, 0, '23:59'), is_deleted: false
      }, true);
      ls.push(l);
    } else {
      l = ls.find(x => String(x.id) === alvo);
      if (!l) return;
      if (fz.atualizarPessoas) {
        if (f.placa) l.placa = f.placa;
        if (f.motorista) l.motorista = f.motorista;
        // O Fusion manda os ajudantes do dia: o 2º vem junto (ou sai, se não veio).
        if (f.ajudante) { l.ajudante = f.ajudante; l.ajudante_2 = f.ajudante_2 || ''; }
      }
      escCarimbar(l, false);
    }
    l.carga = f.carga;
    l.peso = f.peso;
    l.valor = f.valor;
    l.qt_entregas = f.qt_entregas;
    // Carga que vai por cross-docking e rota ainda sem transbordo: liga ao
    // transbordo próprio daquele destino, se houver UM só no dia.
    if (f.crossDocking && !l.transbordo_id) {
      const ts = ls.filter(t => t.setor === 'TRANSBORDO' && escNorm(t.rota).includes(escNorm(f.crossDocking)));
      if (ts.length === 1) l.transbordo_id = ts[0].id;
      else semTransbordo.push(`${l.rota} (${f.carga})`);
    }
    const av = escSincronizarViagem(l);
    if (av) avisos.push(av);
    alteradas.push(l);
  });
  const transbordos = escSincronizarTransbordos();
  closeModal();
  renderApp();
  try { await escGravar('escala_linhas', escUnicas(alteradas.concat(transbordos))); } catch (e) { escFalha(e); return; }
  renderApp();
  const trocas = ls.filter(l => l.placa_matriz && escNorm(l.placa) !== escNorm(l.placa_matriz) && !l.troca_id).length;
  alert(`✅ ${alteradas.length} viagem(ns) atualizada(s) pelo Fusion.`
    + (transbordos.length ? `\n\n🔀 ${transbordos.length} transbordo(s) com viagem no Controle de Viagens.` : '')
    + (semTransbordo.length ? `\n\nℹ️ Cargas por cross-docking sem transbordo próprio ligado (terceiro, ou escolha o transbordo na Convocação): ${semTransbordo.join(', ')}.` : '')
    + (trocas ? `\n\n🔄 ${trocas} placa(s) diferente(s) da matriz: registre a troca na Convocação Escala ("registrar troca").` : '')
    + (avisos.length ? '\n\n' + avisos.join('\n') : ''));
}
window.escAplicarFusion = escAplicarFusion;

// =============================================================================
// TELA 3 — FECHAMENTO
// =============================================================================
function escTotais(ls) {
  return ls.reduce((t, l) => ({
    peso: t.peso + (Number(l.peso) || 0), valor: t.valor + (Number(l.valor) || 0), entregas: t.entregas + (Number(l.qt_entregas) || 0)
  }), { peso: 0, valor: 0, entregas: 0 });
}

function escTelaFechamento() {
  const st = window._escala;
  const linhas = escLinhasDaData();
  const cab = escCabecalho('✅', 'Fechamento', 'Importe as roteirizações do Fusion (ou digite carga, peso, valor e entregas). Com a carga, a linha vira viagem no Controle de Viagens.',
    (linhas.length ? `<button onclick="escImportarFusion()" class="bg-sky-700 hover:bg-sky-600 text-white font-bold px-3 py-2 rounded-xl text-xs shadow">📥 Importar Fusion</button>` : '')
    + (linhas.length ? `<button onclick="escGerarImagem('fechamento')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-2 rounded-xl text-xs shadow">🖼️ Imagem do fechamento</button>` : ''));
  if (!st.matrizes || !st.linhas[st.data]) return cab + escSeletorData() + escCarregandoHtml();
  if (!linhas.length) {
    return `${cab}${escSeletorData()}
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-sm text-slate-300 space-y-3">
        <p>Não há escala montada para <b>${escDataBr(st.data)}</b>.</p>
        <button onclick="switchTab('escala_convocacao')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs">📣 Ir para a Convocação</button>
      </div>`;
  }
  const rotas = linhas.filter(l => l.setor !== 'TRANSBORDO');
  const geral = escTotais(rotas);
  const comCarga = rotas.filter(l => l.carga).length;
  // Transbordo: só informação. Peso, valor e entregas são a soma das rotas que
  // ele leva e NÃO entram de novo no total da montagem.
  const blocoTransbordo = () => {
    const ts = linhas.filter(l => l.setor === 'TRANSBORDO');
    if (!ts.length) return '';
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div class="px-3 py-2 ${escCorSetor('TRANSBORDO')} border-b border-slate-800 text-xs font-black text-white">${escTituloSetor('TRANSBORDO')} <span class="font-normal text-slate-400">— soma das rotas que leva; não entra no total da montagem</span></div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs min-w-[1000px]">
            <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase">
              <tr><th class="p-1.5 w-8">#</th><th class="p-1.5 text-left w-48">Nº no Controle de Viagens</th><th class="p-1.5 text-left">Destino</th><th class="p-1.5 text-left">Placa</th>
              <th class="p-1.5 text-left">Motorista</th><th class="p-1.5 text-left">Leva as rotas</th><th class="p-1.5 text-right w-28">Peso</th><th class="p-1.5 text-right w-32">Valor</th><th class="p-1.5 text-right w-20">Entregas</th><th class="p-1.5 w-20">Viagem</th></tr>
            </thead>
            <tbody>
              ${ts.map((t, i) => {
                const s = escTotais(escRotasDoTransbordo(t).filter(r => r.carga));
                return `<tr class="border-t border-slate-800 text-slate-300">
                  <td class="p-1.5 text-center text-slate-500">T${i + 1}</td>
                  <td class="p-1.5 font-bold text-sky-200">${escEsc(t.carga || '—')}</td>
                  <td class="p-1.5 text-slate-200">${escEsc(t.rota)}</td>
                  <td class="p-1.5">${escEsc(t.placa)}</td>
                  <td class="p-1.5">${escEsc(t.motorista)}</td>
                  <td class="p-1.5">${escChipsRotas(t, linhas)}</td>
                  <td class="p-1.5 text-right">${escFmt(s.peso)}</td>
                  <td class="p-1.5 text-right">R$ ${escFmt(s.valor)}</td>
                  <td class="p-1.5 text-right">${s.entregas}</td>
                  <td class="p-1.5 text-center text-[10px]">${t.viagem_id ? '<span class="text-emerald-400 font-bold">✔ criada</span>' : '<span class="text-slate-500" title="Nasce quando uma rota que ele leva ganha carga">sem carga</span>'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  };
  const bloco = setor => {
    const ls = linhas.filter(l => l.setor === setor);
    if (!ls.length) return '';
    const t = escTotais(ls);
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div class="px-3 py-2 ${setor === 'FRIO' ? 'bg-emerald-950/60' : 'bg-slate-800/60'} border-b border-slate-800 text-xs font-black text-white">${setor === 'FRIO' ? '❄️ FRIO' : '📦 SECO'}</div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs min-w-[1000px]">
            <thead class="bg-slate-950 text-slate-400 text-[10px] uppercase">
              <tr><th class="p-1.5 w-8">#</th><th class="p-1.5 text-left w-36">Carreg</th><th class="p-1.5 text-left">Rota - Destino</th><th class="p-1.5 text-left">Placa</th>
              <th class="p-1.5 text-left">Motorista</th><th class="p-1.5 text-left">Ajudante</th><th class="p-1.5 w-28">Peso</th><th class="p-1.5 w-32">Valor</th><th class="p-1.5 w-20">Qt Entregas</th><th class="p-1.5 w-20">Viagem</th></tr>
            </thead>
            <tbody>
              ${ls.map((l, i) => `
                <tr class="border-t border-slate-800">
                  <td class="p-1.5 text-center text-slate-500">${i + 1}</td>
                  <td class="p-1"><input id="escf-${l.id}-carga" class="${ESC_INPUT} font-bold" placeholder="45025 / 45026" value="${escEsc(l.carga)}" onchange="escLinhaCampo('${l.id}','carga',this.value)"></td>
                  <td class="p-1.5 text-slate-200">${escEsc(l.rota)}</td>
                  <td class="p-1.5 text-slate-300">${escEsc(l.placa)}</td>
                  <td class="p-1.5 text-slate-300">${escEsc(l.motorista)}</td>
                  <td class="p-1.5 text-slate-300">${escEsc(escAjudantesTexto(l))}</td>
                  <td class="p-1"><input id="escf-${l.id}-peso" inputmode="decimal" class="${ESC_INPUT} text-right" value="${escEsc(escFmt(l.peso))}" onchange="escLinhaCampo('${l.id}','peso',this.value)"></td>
                  <td class="p-1"><input id="escf-${l.id}-valor" inputmode="decimal" class="${ESC_INPUT} text-right" value="${escEsc(escFmt(l.valor))}" onchange="escLinhaCampo('${l.id}','valor',this.value)"></td>
                  <td class="p-1"><input id="escf-${l.id}-qt_entregas" inputmode="numeric" class="${ESC_INPUT} text-right" value="${escEsc(l.qt_entregas === null || l.qt_entregas === undefined ? '' : l.qt_entregas)}" onchange="escLinhaCampo('${l.id}','qt_entregas',this.value)"></td>
                  <td class="p-1.5 text-center text-[10px]">${l.viagem_id ? '<span class="text-emerald-400 font-bold">✔ criada</span>' : '<span class="text-slate-500" title="Não saiu neste dia: fica fora da imagem do fechamento">sem carga</span>'}</td>
                </tr>`).join('')}
              <tr class="border-t-2 border-slate-700 bg-slate-950/60 font-bold">
                <td colspan="6" class="p-1.5 text-right text-slate-400">Total ${setor.toLowerCase()}</td>
                <td class="p-1.5 text-right text-white">${escFmt(t.peso)}</td><td class="p-1.5 text-right text-white">R$ ${escFmt(t.valor)}</td><td class="p-1.5 text-right text-white">${t.entregas}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>`;
  };
  return `${cab}
    <div class="flex flex-wrap items-center justify-between gap-2">
      ${escSeletorData()}
      <span class="text-[11px] px-2 py-1 rounded-lg border border-slate-700 text-slate-300">${comCarga} de ${rotas.length} com carga informada · as sem carga não entram na imagem do fechamento</span>
    </div>
    ${bloco('FRIO')}
    ${bloco('SECO')}
    ${blocoTransbordo()}
    <div class="bg-yellow-400 text-slate-900 rounded-xl px-4 py-3 flex flex-wrap justify-between gap-2 text-sm font-black">
      <span>TOTAL DA MONTAGEM — FRIO E SECO</span>
      <span>${escFmt(geral.peso)} kg · R$ ${escFmt(geral.valor)} · ${geral.entregas} entregas</span>
    </div>`;
}

// =============================================================================
// IMAGENS (canvas, no formato das planilhas)
// =============================================================================
let _escLogo = null;
function escCarregarLogo() {
  if (_escLogo) return Promise.resolve(_escLogo);
  return new Promise(res => {
    const img = new Image();
    img.onload = () => { _escLogo = img; res(img); };
    img.onerror = () => res(null);
    img.src = './public/logo_jr_verde.png';
  });
}

function escTextoCabe(ctx, txt, largura, fonteBase, tamanho) {
  let t = tamanho;
  ctx.font = `bold ${t}px Arial`;
  while (t > 9 && ctx.measureText(txt).width > largura) { t--; ctx.font = `bold ${t}px Arial`; }
  if (fonteBase && t !== tamanho) ctx.font = `bold ${t}px Arial`;
}

async function escDesenhar(tipo) {
  const st = window._escala;
  const fech = tipo === 'fechamento';
  // Rota que só sai em alguns dias (ex.: COLINAS 02, ARAGUAINA III) fica na
  // convocação sempre; se não houve carga no dia, ela não entra no fechamento.
  // O transbordo não sai como linha na imagem: aparece na observação das rotas
  // que ele leva ("ARMANDO - RSC7E69"), como sempre foi.
  const dia = escLinhasDaData();
  const todas = dia.filter(l => l.setor !== 'TRANSBORDO');
  const comCarga = todas.filter(l => String(l.carga || '').trim());
  const linhas = fech && comCarga.length ? comCarga : todas;
  const cols = fech
    ? [['Qtd', 46], ['Carreg', 128], ['Rota - Destino', 210], ['PLACA', 92], ['Motorista', 360], ['Ajudante', 290], ['Peso', 112], ['Valor', 160], ['Qt Entregas', 118], ['OBSERVAÇÃO', 190]]
    : [['Qtd', 50], ['Rota - Destino', 230], ['PLACA', 110], ['Motorista', 420], ['Ajudante', 340], ['OBSERVAÇÃO', 210]];
  const W = cols.reduce((s, c) => s + c[1], 0);
  const H_TIT = 70, H_CAB = 44, H_LIN = 38, GAP = 30;
  const setores = ['FRIO', 'SECO'].filter(s => linhas.some(l => l.setor === s));
  let H = 0;
  setores.forEach(s => { H += H_TIT + H_CAB + linhas.filter(l => l.setor === s).length * H_LIN + H_LIN + GAP; });
  if (fech) H += H_LIN + 10;
  const canvas = document.createElement('canvas');
  const esc = 1.5;
  canvas.width = Math.ceil(W * esc); canvas.height = Math.ceil(H * esc);
  const ctx = canvas.getContext('2d');
  ctx.scale(esc, esc);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const logo = await escCarregarLogo();
  const VERDE_CLARO = '#b6e3a6', VERDE_ESCURO = '#25541c', CINZA = '#bfbfbf', LINHA_A = '#f2f2f2', AMARELO = '#ffff00', AZUL = '#1f5fa8';

  const caixa = (x, y, w, h, fundo) => {
    if (fundo) { ctx.fillStyle = fundo; ctx.fillRect(x, y, w, h); }
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  };
  const texto = (t, x, y, w, h, cor = '#111', tam = 15, alinh = 'center') => {
    t = String(t === null || t === undefined ? '' : t);
    escTextoCabe(ctx, t, w - 10, true, tam);
    ctx.fillStyle = cor; ctx.textBaseline = 'middle'; ctx.textAlign = alinh;
    const xx = alinh === 'center' ? x + w / 2 : (alinh === 'right' ? x + w - 6 : x + 6);
    ctx.fillText(t, xx, y + h / 2 + 1);
  };

  let y = 0;
  setores.forEach(setor => {
    const ls = linhas.filter(l => l.setor === setor);
    // título
    caixa(0, y, W, H_TIT, '#ffffff');
    if (logo) { const lh = H_TIT - 14, lw = logo.width * lh / logo.height; ctx.drawImage(logo, 14, y + 7, lw, lh); }
    ctx.font = 'bold 34px Arial'; ctx.fillStyle = AZUL; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`GESTÃO DE EMBARQUES - ${setor}`, W / 2, y + H_TIT / 2 + 2);
    ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#334155'; ctx.textAlign = 'right';
    ctx.fillText(`${escDataBr(st.data)} · ${ESC_DIAS[escDiaSemana(st.data)] || ''}`, W - 14, y + H_TIT / 2 + 2);
    y += H_TIT;
    // cabeçalho
    let x = 0;
    cols.forEach(([nome, w]) => {
      const escuro = setor === 'FRIO' && nome === 'Motorista';
      caixa(x, y, w, H_CAB, setor === 'FRIO' ? (escuro ? VERDE_ESCURO : VERDE_CLARO) : CINZA);
      texto(nome, x, y, w, H_CAB, escuro ? '#ffffff' : '#111', 18);
      x += w;
    });
    y += H_CAB;
    // observação mesclada: linhas seguidas com o mesmo texto viram uma célula
    const iObs = cols.length - 1;
    const grupos = [];
    ls.forEach((l, i) => {
      const o = escObsImagem(l, dia);
      const ult = grupos[grupos.length - 1];
      if (o && ult && ult.texto === o && ult.fim === i - 1) ult.fim = i;
      else grupos.push({ texto: o, ini: i, fim: i });
    });
    ls.forEach((l, i) => {
      const vals = fech
        ? [i + 1, l.carga || '', l.rota, l.placa, l.motorista, escAjudantesTexto(l), escFmt(l.peso), l.valor !== null && l.valor !== undefined ? 'R$ ' + escFmt(l.valor) : '', l.qt_entregas === null || l.qt_entregas === undefined ? '' : l.qt_entregas]
        : [i + 1, l.rota, l.placa, l.motorista, escAjudantesTexto(l)];
      let xx = 0;
      vals.forEach((v, k) => {
        const w = cols[k][1];
        caixa(xx, y, w, H_LIN, i % 2 ? '#ffffff' : LINHA_A);
        const direita = fech && (k === 6 || k === 7);
        texto(v, xx, y, w, H_LIN, '#111', 14, direita ? 'right' : 'center');
        xx += w;
      });
      const g = grupos.find(gr => gr.ini === i);
      if (g) {
        const h = (g.fim - g.ini + 1) * H_LIN;
        caixa(xx, y, cols[iObs][1], h, g.texto ? AMARELO : (i % 2 ? '#ffffff' : LINHA_A));
        texto(g.texto, xx, y, cols[iObs][1], h, '#111', 14);
      }
      y += H_LIN;
    });
    // total do setor
    const t = escTotais(ls);
    let xx = 0;
    cols.forEach(([nome, w], k) => {
      caixa(xx, y, w, H_LIN, setor === 'FRIO' ? VERDE_CLARO : CINZA);
      if (fech && k === 6) texto(escFmt(t.peso), xx, y, w, H_LIN, '#111', 17, 'right');
      if (fech && k === 7) texto('R$ ' + escFmt(t.valor), xx, y, w, H_LIN, '#111', 17, 'right');
      if (fech && k === 8) texto(t.entregas, xx, y, w, H_LIN, '#111', 17);
      xx += w;
    });
    y += H_LIN + GAP;
  });
  if (fech) {
    const t = escTotais(linhas);
    const wRot = cols.slice(0, 5).reduce((s, c) => s + c[1], 0);
    caixa(0, y, W, H_LIN, AMARELO);
    texto('TOTAL DA MONTAGEM - FRIO E SECO  =====>', 0, y, wRot, H_LIN, '#111', 17);
    let xx = wRot + cols[5][1];
    texto(escFmt(t.peso), xx, y, cols[6][1], H_LIN, '#111', 17, 'right'); xx += cols[6][1];
    texto('R$ ' + escFmt(t.valor), xx, y, cols[7][1], H_LIN, '#111', 17, 'right'); xx += cols[7][1];
    texto(t.entregas, xx, y, cols[8][1], H_LIN, '#111', 17);
  }
  return canvas;
}

async function escGerarImagem(tipo) {
  const st = window._escala;
  const modal = document.getElementById('modal-container');
  if (!modal) return;
  const canvas = await escDesenhar(tipo);
  const nome = `${tipo === 'fechamento' ? 'FECHAMENTO' : 'CONVOCACAO'} ${escDataBr(st.data).replace(/\//g, '.')}.png`;
  window._escImagem = { canvas, nome };
  const podeCompartilhar = !!(navigator.canShare && window.File);
  modal.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-xl p-4 max-w-5xl w-full shadow-2xl space-y-3 max-h-[92vh] flex flex-col">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <h3 class="font-bold text-white text-sm">🖼️ ${tipo === 'fechamento' ? 'Relatório de fechamento' : 'Convocação'} — ${escDataBr(st.data)}</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white text-sm">✕</button>
      </div>
      <div class="overflow-auto bg-white rounded flex-1"><img src="${canvas.toDataURL('image/png')}" class="w-full h-auto" alt="Prévia"></div>
      <div class="flex flex-wrap justify-end gap-2 text-xs">
        <button onclick="escImagemCopiar()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-2 rounded-lg">📋 Copiar imagem</button>
        ${podeCompartilhar ? `<button onclick="escImagemCompartilhar()" class="bg-sky-700 hover:bg-sky-600 text-white font-bold px-3 py-2 rounded-lg">📤 Compartilhar</button>` : ''}
        <button onclick="escImagemBaixar()" class="bg-slate-800 border border-slate-700 text-white font-bold px-3 py-2 rounded-lg">⬇️ Baixar PNG</button>
      </div>
    </div>`;
  modal.classList.remove('hidden');
}
window.escGerarImagem = escGerarImagem;

function escImagemBlob() {
  return new Promise(res => window._escImagem.canvas.toBlob(res, 'image/png'));
}

async function escImagemCopiar() {
  try {
    const blob = await escImagemBlob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    alert('✅ Imagem copiada. É só colar (Ctrl+V) no grupo do WhatsApp.');
  } catch (e) {
    alert('Este navegador não deixou copiar a imagem. Use "Baixar PNG".\n\n' + (e.message || e));
  }
}
window.escImagemCopiar = escImagemCopiar;

async function escImagemCompartilhar() {
  try {
    const blob = await escImagemBlob();
    const file = new File([blob], window._escImagem.nome, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: window._escImagem.nome });
  } catch (e) {
    if (e && e.name !== 'AbortError') alert('Não foi possível compartilhar: ' + (e.message || e));
  }
}
window.escImagemCompartilhar = escImagemCompartilhar;

function escImagemBaixar() {
  const a = document.createElement('a');
  a.href = window._escImagem.canvas.toDataURL('image/png');
  a.download = window._escImagem.nome;
  document.body.appendChild(a); a.click(); a.remove();
}
window.escImagemBaixar = escImagemBaixar;
