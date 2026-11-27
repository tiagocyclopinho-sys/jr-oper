/*
 * Acerto de motoristas e ajudantes - regras (7.10.0, 27/11/2026).
 * UMD: window.AcertoRegras na pagina /acerto; require() no gerador/testes.
 *
 * A matriz fica em acerto_regras (migration 85), VERSIONADA por (tipo, chave,
 * vigencia). O valor de um mes M e a versao de maior vigencia <= M. A chave de
 * casamento de nomes (rota, fornecedor) e a mesma da funcao SQL acerto_chave:
 * sem acento, sem pontuacao, 01/02/03 = I/II/III, palavras em ordem.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.AcertoRegras = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROMANOS = { '1': 'I', '01': 'I', '2': 'II', '02': 'II', '3': 'III', '03': 'III' };

  function chave(txt) {
    return String(txt == null ? '' : txt)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
      .split(' ').filter(Boolean).map((w) => ROMANOS[w] || w)
      .sort().join(' ');
  }

  // Competencia de uma data (26 do mes anterior a 25): 27/11/2026 -> '2026-12'.
  function competencia(d) {
    const dt = d instanceof Date ? d : new Date(d);
    let a = dt.getFullYear(), m = dt.getMonth() + 1;
    if (dt.getDate() >= 26) { m += 1; if (m > 12) { m = 1; a += 1; } }
    return `${a}-${String(m).padStart(2, '0')}`;
  }

  function somaMes(mes, n) {
    let [a, m] = mes.split('-').map(Number);
    m += n;
    while (m > 12) { m -= 12; a += 1; }
    while (m < 1) { m += 12; a -= 1; }
    return `${a}-${String(m).padStart(2, '0')}`;
  }

  // Periodo da competencia: '2026-11' -> 26/10/2026 a 25/11/2026.
  function periodo(mes) {
    const ant = somaMes(mes, -1);
    return { ini: `${ant}-26`, fim: `${mes}-25` };
  }

  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function mesTexto(mes) { if (!mes) return '—'; const [a, m] = mes.split('-'); return `${MESES[Number(m) - 1]}/${a}`; }

  /*
   * Indice das regras: idx[tipo][chave] = [versoes em ordem de vigencia].
   * vigente(idx, tipo, chave, mes) devolve a versao que vale no mes (ou null).
   */
  function indexar(regras) {
    const idx = {};
    (regras || []).forEach((r) => {
      ((idx[r.tipo] = idx[r.tipo] || {})[r.chave] = idx[r.tipo][r.chave] || []).push(r);
    });
    Object.values(idx).forEach((t) => Object.values(t).forEach((l) => l.sort((a, b) => a.vigencia.localeCompare(b.vigencia))));
    return idx;
  }

  function vigente(idx, tipo, ch, mes) {
    const l = (idx[tipo] || {})[ch];
    if (!l) return null;
    let v = null;
    for (const r of l) { if (r.vigencia <= mes) v = r; else break; }
    return v;
  }

  // Todas as chaves de um tipo com a versao do mes (as que ainda nao valem ficam fora).
  function vigentes(idx, tipo, mes) {
    return Object.keys(idx[tipo] || {}).map((ch) => vigente(idx, tipo, ch, mes)).filter(Boolean);
  }

  function proximaVersao(idx, tipo, ch, mes) {
    return ((idx[tipo] || {})[ch] || []).find((r) => r.vigencia > mes) || null;
  }

  // Perfil da pessoa no mes: a regra 'pessoa' ou o padrao da funcao.
  function perfilDaPessoa(idx, funcao, pessoaId, mes) {
    const p = vigente(idx, 'pessoa', `${funcao}:${pessoaId}`, mes);
    const cod = (p && p.dados.perfil) || `${funcao}_PADRAO`;
    const perf = vigente(idx, 'perfil', cod, mes);
    return { codigo: cod, perfil: perf ? perf.dados : null, regraPessoa: p };
  }

  // Rota da matriz para o nome que veio da viagem: pela chave ou pelos apelidos.
  function rotaDaViagem(idx, nomeViagem, mes) {
    const k = chave(nomeViagem);
    if (!k) return null;
    const direta = vigente(idx, 'rota', k, mes);
    if (direta && direta.dados.ativo !== false) return direta;
    for (const r of vigentes(idx, 'rota', mes)) {
      if (r.dados.ativo === false) continue;
      if ((r.dados.apelidos || []).some((a) => chave(a) === k)) return r;
    }
    return null;
  }

  const KPIS = {
    MOTORISTA: [
      ['MANUTENCAO', 'Manutenção do veículo'], ['PNEUS', 'Cuidado com pneus'], ['SINISTRO', 'Sinistro & conservação'],
      ['CONSUMO', 'Média de consumo'], ['PRAZO_ROTA', 'Prazo rota'], ['CAIXA', 'Acerto de caixa'],
      ['DEVOLUCAO', 'Devolução'], ['FUSION', 'Fusion'],
    ],
    AJUDANTE: [['DEVOLUCAO', 'Devolução'], ['PONTUALIDADE', 'Pontualidade'], ['PRAZO_ROTA', 'Prazo rota']],
  };

  return { chave, competencia, somaMes, periodo, mesTexto, indexar, vigente, vigentes, proximaVersao, perfilDaPessoa, rotaDaViagem, KPIS };
});
