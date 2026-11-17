// =============================================================================
// TRATATIVAS POR AREA E EVIDENCIAS (7.5.0, 17/11/2026, migration 80)
//
// Pedido do Tiago: a Ocorrencia em Rota so tinha retorno da MANUTENCAO (a
// ROT-2026-028, conduta com distrato, foi gravada como "servico realizado") e a
// Ocorrencia Operacional nao aceitava foto. Agora:
//   - conduta / desvio de rota (das duas telas) cai na fila do gestor:
//     Tratativas do Gestor -> Condutas, com tudo na mesma tela (relato, fotos,
//     reincidencia em 90 dias) e o gestor conclui ali mesmo;
//   - a Ocorrencia Operacional ganha evidencias (abertura e tratativa);
//   - o Dashboard soma as condutas na cobranca do gestor (SLA 24h/48h desde
//     enviado_em).
// A regra mora no store (Store.motivoEhConduta, encaminharAoGestor,
// concluirTratativaGestor, getCondutasGestor). Aqui so tela.
// =============================================================================

function trtEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function trtDataHora(v) {
  if (!v) return '—';
  const ms = (typeof _parseDataFlex === 'function') ? _parseDataFlex(v) : new Date(v).getTime();
  if (ms === null || isNaN(ms)) return String(v);
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function trtHorasDesde(v) {
  const ms = (typeof _parseDataFlex === 'function') ? _parseDataFlex(v) : new Date(v).getTime();
  if (ms === null || isNaN(ms)) return null;
  return (Date.now() - ms) / 36e5;
}

function trtRotuloMedida(id) {
  const m = (Store.MEDIDAS_GESTOR || []).find(x => x.id === id);
  return m ? m.label : (id || '—');
}

function trtSeloSla(enviadoEm) {
  const h = trtHorasDesde(enviadoEm);
  if (h === null) return '';
  const txt = h < 1 ? 'menos de 1 h' : (h < 48 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} dia(s)`);
  const cls = h > 48 ? 'bg-red-950 text-red-300 border-red-800'
            : h >= 24 ? 'bg-amber-950 text-amber-300 border-amber-800'
            : 'bg-emerald-950 text-emerald-300 border-emerald-800';
  const ic = h > 48 ? '🔴' : h >= 24 ? '🟡' : '🟢';
  return `<span class="text-[10px] font-bold px-2 py-0.5 rounded border ${cls}" title="Desde que chegou ao gestor">${ic} com o gestor há ${txt}</span>`;
}

// -----------------------------------------------------------------------------
// FILA E RESUMO (Dashboard, Boletim)
// -----------------------------------------------------------------------------
function trtCondutasPendentesGestor() {
  if (!db || typeof db.getCondutasGestor !== 'function') return [];
  // enviado_em no topo do item, para getSlaBreakdown / getMaisAntigaPendente.
  return db.getCondutasGestor()
    .filter(l => l.trat.status === 'PENDENTE')
    .map(l => Object.assign({}, l, { enviado_em: l.trat.enviado_em, numero_protocolo: l.protocolo }));
}

// -----------------------------------------------------------------------------
// ACOES
// -----------------------------------------------------------------------------
function trtEncaminharAoGestor(modulo, id) {
  if (!confirm('Enviar esta ocorrência para as Tratativas do Gestor (Condutas)?\n\nO gestor decide a medida e a ocorrência só fecha quando ele concluir.')) return;
  const res = db.encaminharAoGestor(modulo, id, 'MANUAL');
  if (!res.success) { alert('⚠️ ' + (res.message || 'Não foi possível enviar.')); return; }
  if (window.cloudStore && window.cloudStore.isConfigured()) window.cloudStore.syncLocalToCloud().catch(() => {});
  alert(res.jaEstava ? 'Esta ocorrência já está com o gestor.' : '✅ Enviada para Tratativas do Gestor → Condutas.');
  renderApp();
}

function trtAbrirFilaGestor() {
  window._gestorModulo = 'condutas';
  window._activeGestorSubTab = 'pendentes';
  switchTab('gestao_gestor');
}

window._trtFotosTratativa = {};   // chave modulo:id -> [dataUrl]

function trtTratativaFotosUpload(input, chave) {
  if (!input.files || !input.files.length) return;
  window._trtFotosTratativa[chave] = window._trtFotosTratativa[chave] || [];
  Array.from(input.files).forEach(file => {
    comprimirImagem(file).then(dataUrl => {
      window._trtFotosTratativa[chave].push(dataUrl);
      trtRenderPreviewFotos(window._trtFotosTratativa[chave], 'trt-prev-' + chave.replace(':', '-'), `trtRemoverFotoTratativa('${chave}', IDX)`);
    }).catch(() => showToast('Não foi possível processar uma das fotos.', 'error'));
  });
  input.value = '';
}

function trtRemoverFotoTratativa(chave, idx) {
  const l = window._trtFotosTratativa[chave] || [];
  l.splice(idx, 1);
  trtRenderPreviewFotos(l, 'trt-prev-' + chave.replace(':', '-'), `trtRemoverFotoTratativa('${chave}', IDX)`);
}

function trtRenderPreviewFotos(lista, elId, removerTpl) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!lista || !lista.length) { el.innerHTML = '<span class="text-[10px] text-slate-500 italic">Nenhum anexo.</span>'; return; }
  el.innerHTML = lista.map((src, i) => `
    <div class="relative w-14 h-14 rounded-lg overflow-hidden border border-sky-600 bg-black shrink-0">
      <img src="${src}" class="w-full h-full object-cover cursor-pointer" onclick="visualizarMidiaModal('${src}', 'image')">
      <button type="button" onclick="${removerTpl.replace('IDX', i)}" class="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full w-4 h-4 text-[9px] font-bold">✕</button>
    </div>`).join('');
}

async function trtConcluirTratativa(modulo, id) {
  const chave = modulo + ':' + id;
  const sufixo = modulo + '-' + id;
  const medida = (document.getElementById('trt-medida-' + sufixo) || {}).value || '';
  const parecer = ((document.getElementById('trt-parecer-' + sufixo) || {}).value || '').trim();
  const responsavel = ((document.getElementById('trt-resp-' + sufixo) || {}).value || '').trim();
  if (!medida) { alert('⚠️ Escolha a medida aplicada.'); return; }
  if (!parecer) { alert('⚠️ Escreva o parecer do gestor.'); return; }
  if (!responsavel) { alert('⚠️ Informe quem está concluindo.'); return; }

  const res = db.concluirTratativaGestor(modulo, id, { medida, parecer, responsavel });
  if (!res.success) { alert('⚠️ ' + res.message); return; }

  const fotos = window._trtFotosTratativa[chave] || [];
  if (fotos.length) {
    await _enfileirarFotosDevolucao(res.item, 'tratativa', fotos, modulo === 'oper' ? 'ocoper' : 'rota');
  }
  delete window._trtFotosTratativa[chave];
  if (window.cloudStore && window.cloudStore.isConfigured()) window.cloudStore.syncLocalToCloud().catch(() => {});
  alert('✅ Tratativa concluída: ' + trtRotuloMedida(medida) + '.'
    + (modulo === 'rota' && res.item.status_chamado !== 'finalizado'
      ? '\n\nO chamado continua aberto porque a manutenção ainda não liberou o veículo.' : ''));
  renderApp();
}

// -----------------------------------------------------------------------------
// BLOCO DO GESTOR NO CARD DA OCORRENCIA EM ROTA
// -----------------------------------------------------------------------------
function trtBlocoGestorCard(item, modulo) {
  const t = Store.tratativaGestorDe(item);
  if (!t) return '';
  const fotos = (typeof _galeriaFotosModulo === 'function')
    ? _galeriaFotosModulo(item, 'tratativa', modulo === 'oper' ? 'ocoper' : 'rota', { titulo: 'Anexos do gestor', cor: 'sky' }) : '';
  if (t.status === 'PENDENTE') {
    return `
      <div class="bg-sky-950/20 p-3.5 rounded-xl border border-sky-800/70 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-sky-900/60 pb-1.5">
          <span class="font-black text-sky-300 text-xs flex items-center gap-1.5"><span>👔</span> Tratativa do Gestor (conduta)</span>
          ${trtSeloSla(t.enviado_em)}
        </div>
        <p class="text-[11px] text-slate-400">Enviada em ${trtDataHora(t.enviado_em)} por ${trtEsc(t.enviado_por || '—')}. O chamado só fecha quando o gestor concluir.</p>
        <button onclick="trtAbrirFilaGestor()" class="w-full bg-sky-800 hover:bg-sky-700 text-white font-extrabold py-2 rounded-xl text-xs">👔 Abrir em Tratativas do Gestor</button>
      </div>`;
  }
  return `
    <div class="bg-sky-950/20 p-3.5 rounded-xl border border-sky-800/70 space-y-2 text-[11px]">
      <div class="flex items-center justify-between border-b border-sky-900/60 pb-1.5">
        <span class="font-black text-sky-300 text-xs flex items-center gap-1.5"><span>✅</span> Tratativa do Gestor concluída</span>
        <span class="text-[10px] text-sky-200 font-bold bg-sky-950 px-2 py-0.5 rounded border border-sky-800">${trtEsc(trtRotuloMedida(t.medida))}</span>
      </div>
      <div><span class="text-slate-400 block text-[10px] uppercase font-bold">Parecer:</span><span class="text-white font-semibold leading-relaxed">${trtEsc(t.parecer)}</span></div>
      <div class="grid grid-cols-2 gap-2 pt-1 border-t border-sky-900/40">
        <div><span class="text-slate-400 block text-[10px] uppercase font-bold">Gestor:</span><span class="text-sky-300 font-bold">${trtEsc(t.responsavel || '—')}</span></div>
        <div><span class="text-slate-400 block text-[10px] uppercase font-bold">Concluída em:</span><span class="text-slate-200 font-semibold">${trtDataHora(t.concluida_em)}</span></div>
      </div>
      ${fotos}
    </div>`;
}

// -----------------------------------------------------------------------------
// TRATATIVAS DO GESTOR -> CONDUTAS
// -----------------------------------------------------------------------------
function trtSeletorModuloGestor(qtdDev, qtdCond) {
  const ativo = window._gestorModulo || 'devolucoes';
  const b = (id, ic, rot, n, cor) => `
    <button onclick="window._gestorModulo='${id}'; renderApp()" class="px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-2 transition ${ativo === id ? cor + ' text-white shadow-md' : 'text-slate-400 hover:text-white'}">
      <span>${ic}</span> ${rot} <span class="bg-black/30 rounded-full px-1.5">${n}</span>
    </button>`;
  return `
    <div class="flex gap-1 bg-slate-900 border border-slate-800 p-1.5 rounded-xl shadow-lg w-fit">
      ${b('devolucoes', '📦', 'Devoluções', qtdDev, 'bg-sky-800')}
      ${b('condutas', '🚨', 'Condutas', qtdCond, 'bg-red-800')}
    </div>`;
}

function renderGestorCondutasView(qtdDevPendentes) {
  const todas = db.getCondutasGestor();
  const aba = window._activeGestorSubTab === 'concluidos' ? 'concluidos' : 'pendentes';
  const busca = String(window._filtroCondutaBusca || '').toUpperCase().trim();
  const pend = todas.filter(l => l.trat.status === 'PENDENTE');
  const conc = todas.filter(l => l.trat.status !== 'PENDENTE');

  let lista = aba === 'pendentes' ? pend : conc;
  if (busca) {
    lista = lista.filter(l => [l.protocolo, l.pessoa, l.placa, l.carga, l.rota, l.motivo]
      .some(v => String(v || '').toUpperCase().includes(busca)));
  }
  lista = [...lista].sort((a, b) => aba === 'pendentes'
    ? String(a.trat.enviado_em || '').localeCompare(String(b.trat.enviado_em || ''))      // mais antiga primeiro
    : String(b.trat.concluida_em || '').localeCompare(String(a.trat.concluida_em || '')));

  const sla = (typeof getSlaBreakdown === 'function') ? getSlaBreakdown(pend.map(l => ({ enviado_em: l.trat.enviado_em })), ['enviado_em']) : { critico: 0, alerta: 0, ok: 0 };
  const usuario = (db.currentUser && db.currentUser.nome) ? db.currentUser.nome : '';

  const card = l => {
    const r = l.reg;
    const t = l.trat;
    const sufixo = l.modulo + '-' + l.id;
    const chave = l.modulo + ':' + l.id;
    const moduloFoto = l.modulo === 'oper' ? 'ocoper' : 'rota';
    const reinc = db.condutasAnterioresDe(l.pessoa, l.data, l.id, 90);
    const fotosAbertura = _galeriaFotosModulo(r, 'fotos', moduloFoto, { titulo: 'Evidências da abertura', cor: 'emerald' });
    const videos = (l.modulo === 'rota' && Array.isArray(r.midia_videos) && r.midia_videos.length)
      ? `<div class="flex flex-wrap gap-2 pt-1">${r.midia_videos.map(v => `<button type="button" onclick="visualizarMidiaModal('${v}', 'video')" class="w-20 h-12 rounded border border-blue-600 bg-black text-white text-xs">▶ vídeo</button>`).join('')}</div>` : '';

    return `
      <div class="bg-slate-900 border ${t.status === 'PENDENTE' ? 'border-red-800/70' : 'border-emerald-800/60'} rounded-2xl p-4 shadow-xl space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-black text-red-400 uppercase">${trtEsc(l.protocolo)}</span>
              <span class="bg-slate-800 text-amber-300 border border-amber-800/60 font-bold px-2 py-0.5 rounded text-[10px]">${trtEsc(l.motivo)}</span>
              <span class="text-[10px] text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">${l.origemRotulo}</span>
            </div>
            <div class="text-sm sm:text-base font-extrabold text-white mt-1">👤 ${trtEsc(l.pessoa || 'SEM NOME')} <span class="text-[11px] text-slate-400 font-semibold">${trtEsc(l.funcao)}</span></div>
            <div class="text-[11px] text-slate-400 mt-0.5 flex flex-wrap gap-x-3">
              <span>🚛 ${trtEsc(l.placa || '—')}</span>
              <span>📦 Carga <strong class="text-emerald-400">${trtEsc(l.carga || '—')}</strong></span>
              <span>🗺️ ${trtEsc(l.rota || '—')}</span>
              ${l.local ? `<span class="text-amber-300">📍 ${trtEsc(l.local)}</span>` : ''}
              <span>📅 ${typeof formatarData === 'function' ? formatarData(l.data) : trtEsc(l.data)}</span>
            </div>
          </div>
          <div class="flex flex-col sm:items-end gap-1 shrink-0">
            ${t.status === 'PENDENTE' ? trtSeloSla(t.enviado_em) : `<span class="text-[10px] font-bold px-2 py-0.5 rounded border bg-emerald-950 text-emerald-300 border-emerald-800">✅ ${trtEsc(trtRotuloMedida(t.medida))}</span>`}
            <span class="text-[10px] text-slate-500">Enviada em ${trtDataHora(t.enviado_em)}</span>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
          <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
            <div class="font-bold text-slate-300">⚠️ Relato</div>
            <div class="text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 leading-relaxed whitespace-pre-line">${trtEsc(l.relato || '—')}</div>
            ${l.acaoCco ? `<div><span class="text-[10px] text-slate-500 uppercase font-bold">Ação já tomada na operação:</span><div class="text-emerald-300">${trtEsc(l.acaoCco)}</div></div>` : ''}
            ${fotosAbertura}
            ${videos}
          </div>

          <div class="space-y-3">
            <div class="bg-slate-950 p-3 rounded-xl border ${reinc.length ? 'border-amber-700/70' : 'border-slate-800'}">
              <div class="font-bold ${reinc.length ? 'text-amber-300' : 'text-slate-300'}">🔁 Reincidência (90 dias): ${reinc.length ? `${reinc.length} conduta(s) anterior(es)` : 'nenhuma conduta anterior'}</div>
              ${reinc.length ? `<ul class="mt-1.5 space-y-0.5 text-[11px] text-slate-300">${reinc.map(x => `<li>• ${typeof formatarData === 'function' ? formatarData(x.data) : x.data} — ${trtEsc(x.motivo)} <span class="text-slate-500">(${trtEsc(x.ref)})</span>${x.medida ? ` → <strong class="text-sky-300">${trtEsc(trtRotuloMedida(x.medida))}</strong>` : ''}</li>`).join('')}</ul>` : ''}
            </div>

            ${t.status === 'PENDENTE' ? `
              <div class="bg-slate-950 p-3 rounded-xl border border-sky-800/70 space-y-2">
                <div class="font-black text-sky-300">👔 Decisão do gestor</div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[10px] text-slate-400 font-bold uppercase mb-0.5">Medida *</label>
                    <select id="trt-medida-${sufixo}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs">
                      <option value="">-- Selecione --</option>
                      ${Store.MEDIDAS_GESTOR.map(m => `<option value="${m.id}">${m.label}</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label class="block text-[10px] text-slate-400 font-bold uppercase mb-0.5">Gestor *</label>
                    <input id="trt-resp-${sufixo}" value="${trtEsc(usuario)}" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs uppercase" oninput="forcarMaiuscula(this)">
                  </div>
                </div>
                <div>
                  <label class="block text-[10px] text-slate-400 font-bold uppercase mb-0.5">Parecer *</label>
                  <textarea id="trt-parecer-${sufixo}" rows="3" placeholder="O que foi decidido e por quê" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-2 text-xs" oninput="forcarMaiuscula(this)"></textarea>
                </div>
                <div>
                  <label class="block text-[10px] text-slate-400 font-bold uppercase mb-0.5">Anexos (documento assinado, prova)</label>
                  <input type="file" accept="image/*" multiple onchange="trtTratativaFotosUpload(this, '${chave}')" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-[11px]">
                  <div id="trt-prev-${sufixo}" class="flex flex-wrap gap-2 pt-1.5"><span class="text-[10px] text-slate-500 italic">Nenhum anexo.</span></div>
                </div>
                <button onclick="trtConcluirTratativa('${l.modulo}', '${l.id}')" class="w-full bg-gradient-to-r from-sky-700 to-blue-700 hover:from-sky-600 hover:to-blue-600 text-white font-extrabold py-2.5 rounded-xl text-xs">✅ Concluir tratativa</button>
              </div>` : `
              <div class="bg-slate-950 p-3 rounded-xl border border-emerald-800/60 space-y-1.5 text-[11px]">
                <div class="font-black text-emerald-400">✅ ${trtEsc(trtRotuloMedida(t.medida))}</div>
                <div class="text-white leading-relaxed">${trtEsc(t.parecer)}</div>
                <div class="text-slate-400">${trtEsc(t.responsavel || '—')} · ${trtDataHora(t.concluida_em)}</div>
                ${_galeriaFotosModulo(r, 'tratativa', moduloFoto, { titulo: 'Anexos do gestor', cor: 'sky' })}
              </div>`}
          </div>
        </div>
      </div>`;
  };

  return `
    <div class="space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-black text-white flex items-center gap-2"><span>👔</span> Tratativas do Gestor</h1>
          <p class="text-xs text-slate-400">Condutas e desvios de rota vindos da Ocorrência em Rota e da Ocorrência Operacional</p>
        </div>
        <div class="flex gap-1 bg-slate-900 border border-slate-800 p-1.5 rounded-xl shadow-lg shrink-0">
          <button onclick="switchGestorSubTab('pendentes')" class="px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-2 transition ${aba === 'pendentes' ? 'bg-amber-700 text-white shadow-md' : 'text-slate-400 hover:text-white'}"><span>⏳</span> Pendentes (${pend.length})</button>
          <button onclick="switchGestorSubTab('concluidos')" class="px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-2 transition ${aba === 'concluidos' ? 'bg-emerald-700 text-white shadow-md' : 'text-slate-400 hover:text-white'}"><span>✅</span> Concluídas (${conc.length})</button>
        </div>
      </div>

      ${trtSeletorModuloGestor(qtdDevPendentes, pend.length)}

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="bg-slate-900 border border-amber-800/50 p-3 rounded-xl text-center shadow"><div class="text-xl font-black text-amber-400">${pend.length}</div><div class="text-[10px] text-slate-400 mt-0.5 font-bold uppercase">Pendentes</div></div>
        <div class="bg-slate-900 border border-red-800/50 p-3 rounded-xl text-center shadow"><div class="text-xl font-black text-red-400">${sla.critico}</div><div class="text-[10px] text-slate-400 mt-0.5 font-bold uppercase">🔴 Mais de 48 h</div></div>
        <div class="bg-slate-900 border border-amber-800/50 p-3 rounded-xl text-center shadow"><div class="text-xl font-black text-amber-300">${sla.alerta}</div><div class="text-[10px] text-slate-400 mt-0.5 font-bold uppercase">🟡 24 a 48 h</div></div>
        <div class="bg-slate-900 border border-emerald-800/50 p-3 rounded-xl text-center shadow"><div class="text-xl font-black text-emerald-400">${conc.length}</div><div class="text-[10px] text-slate-400 mt-0.5 font-bold uppercase">Concluídas</div></div>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <label class="block text-[9px] text-slate-400 font-bold uppercase mb-0.5">Buscar (nome, placa, carga, rota, protocolo)</label>
        <input id="trt-busca" type="text" value="${trtEsc(window._filtroCondutaBusca || '')}" placeholder="Ex: ANDERSON, RSD7I68, 45297" class="w-full sm:w-96 bg-slate-800 border border-slate-700 text-white rounded p-1.5 text-xs"
          oninput="forcarMaiuscula(this); window._filtroCondutaBusca=this.value; clearTimeout(window._trtBuscaT); window._trtBuscaT=setTimeout(() => { renderApp(); const e=document.getElementById('trt-busca'); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 350)">
      </div>

      <div class="space-y-4">
        ${lista.length ? lista.map(card).join('') : `
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-xs">
            ${aba === 'pendentes' ? '✅ Nenhuma conduta aguardando o gestor.' : 'Nenhuma tratativa concluída.'}
          </div>`}
      </div>
    </div>`;
}

// -----------------------------------------------------------------------------
// EVIDENCIAS DA OCORRENCIA OPERACIONAL
// -----------------------------------------------------------------------------
window._ocvFotosNovas = [];      // formulario de abertura
window._ocvFotosEdicao = [];     // modal de edicao

function trtOcvFotosUpload(input, alvo) {
  if (!input.files || !input.files.length) return;
  const lista = alvo === 'edicao' ? window._ocvFotosEdicao : window._ocvFotosNovas;
  Array.from(input.files).forEach(file => {
    comprimirImagem(file).then(dataUrl => {
      lista.push(dataUrl);
      trtRenderPreviewFotos(lista, 'ocv-fotos-prev-' + alvo, `trtOcvRemoverFoto('${alvo}', IDX)`);
    }).catch(() => showToast('Não foi possível processar uma das fotos.', 'error'));
  });
  input.value = '';
}

function trtOcvRemoverFoto(alvo, idx) {
  const lista = alvo === 'edicao' ? window._ocvFotosEdicao : window._ocvFotosNovas;
  lista.splice(idx, 1);
  trtRenderPreviewFotos(lista, 'ocv-fotos-prev-' + alvo, `trtOcvRemoverFoto('${alvo}', IDX)`);
}

function trtOcvCampoFotos(alvo) {
  return `
    <div>
      <label class="block text-[10px] text-sky-300 font-bold mb-1">📷 Evidências (fotos, prints da CCO, documentos)</label>
      <input type="file" accept="image/*" multiple onchange="trtOcvFotosUpload(this, '${alvo}')" class="w-full bg-slate-800 border border-slate-700 text-white rounded p-1 text-[11px]">
      <div id="ocv-fotos-prev-${alvo}" class="flex flex-wrap gap-2 pt-1.5"><span class="text-[10px] text-slate-500 italic">Nenhum anexo.</span></div>
    </div>`;
}

async function trtOcvEnviarFotos(item, alvo) {
  const lista = alvo === 'edicao' ? window._ocvFotosEdicao : window._ocvFotosNovas;
  const fotos = lista.splice(0, lista.length);
  if (!item || !fotos.length) return 0;
  return _enfileirarFotosDevolucao(item, 'fotos', fotos, 'ocoper');
}

// Selo da linha da tabela da Operacional: com o gestor / decisao.
function trtOcvSeloGestor(o) {
  const t = Store.tratativaGestorDe(o);
  if (!t) return '';
  if (t.status === 'PENDENTE') {
    return `<button onclick="trtAbrirFilaGestor()" class="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-sky-300 bg-sky-950 border border-sky-800 rounded px-1.5 py-0.5" title="Aguardando a decisão do gestor">👔 Com o gestor</button>`;
  }
  return `<div class="mt-1 text-[10px] font-bold text-sky-300">👔 ${trtEsc(trtRotuloMedida(t.medida))}</div>`;
}

window.trtEncaminharAoGestor = trtEncaminharAoGestor;
window.trtAbrirFilaGestor = trtAbrirFilaGestor;
window.trtConcluirTratativa = trtConcluirTratativa;
window.trtTratativaFotosUpload = trtTratativaFotosUpload;
window.trtRemoverFotoTratativa = trtRemoverFotoTratativa;
window.trtOcvFotosUpload = trtOcvFotosUpload;
window.trtOcvRemoverFoto = trtOcvRemoverFoto;
