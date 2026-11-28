/*
 * Acerto de motoristas e ajudantes - CALCULO (28/11/2026).
 * UMD: window.AcertoCalculo na pagina /acerto; require() nos testes.
 * Depende de AcertoRegras (js/acertoRegras.js) para ler a matriz do mes.
 *
 * Reproduz a 8003 (motorista) e a 8009 (ajudante), conferido contra nov/26:
 *   valor da carga = peso (t) x R$/t x %
 *     - rota: R$/t e % da rota PRINCIPAL DO WINTHOR (tipo pcrotaexp da matriz,
 *       chave = CODROTAPRINC). Ajudante usa o R$/t de ajudante da rota (sem %).
 *     - perfil com "R$/t fixo" (Armando 250, Gabriel 23) ou "tonelada carne"
 *       (Silvestre, parametro TON_CARNE) troca o R$/t de todas as cargas.
 *     - % do perfil (carreteiro 11) vale sobre o % da rota.
 *     - motorista do transbordo (CODMOTTRANSBORDO): R$ TON_MOTORISTA_TRANSBORDO/t
 *       (350), alem do motorista da rota.
 *     - compra (nota de entrada ligada pelo CPF): UF GO = COMPRA_TON_GO (500),
 *       demais = COMPRA_TON (350).
 *   bonus = entregas x bonus por entrega (motorista)
 *   requisitos: pago quando o perfil tem o requisito e a planilha nao tem
 *     ocorrencia ("N/C" nao paga; so conta se o perfil tem o requisito)
 *   garantido = (garantido t - peso t) x R$/t medio do mes, se faltou peso.
 *     A 8003 soma o bonus de novo quando falta peso: aqui NAO (regra); a
 *     diferenca aparece no aviso "bonus em dobro na rotina".
 *   total = cargas + compras + bonus + requisitos + garantido + ajuda extra
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.AcertoCalculo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const KPIS_MOT = ['MANUTENCAO', 'PNEUS', 'SINISTRO', 'CONSUMO', 'PRAZO_ROTA', 'CAIXA', 'DEVOLUCAO', 'FUSION'];
  const KPIS_AJU = ['DEVOLUCAO', 'PONTUALIDADE', 'PRAZO_ROTA'];

  function parametro(R, idx, chave, mes, padrao) {
    const p = R.vigente(idx, 'parametro', chave, mes);
    return p && p.dados.valor != null ? Number(p.dados.valor) : padrao;
  }

  /*
   * entrada = {
   *   mes, R (AcertoRegras), idx (R.indexar(regras)),
   *   cargas:  [{ numcar, dtsaida, codmotorista, codmot_transb, codajud1, codajud2, codajud3,
   *               codajud_transb, peso (kg), nument, codrota, destino }]  (so faturadas e nao canceladas)
   *   compras: [{ numnota, dtent, matricula, peso (kg), uf }]
   *   nomes:   { 'MOTORISTA:65': 'ADEMAR ...', 'AJUDANTE:169': ... }
   *   requisitos: { 'MOTORISTA:65': { req: { MANUTENCAO: 0 | n | 'N/C', ... }, garantido_t, dias } }
   *   extras:  { 'MOTORISTA:65': { ajuda: 60, obs: '...' } }
   * }
   */
  function calcular(e) {
    const { R, idx, mes } = e;
    const pTransb = parametro(R, idx, 'TON_MOTORISTA_TRANSBORDO', mes, 350);
    const pCarne = parametro(R, idx, 'TON_CARNE', mes, 300);
    const pCompraGO = parametro(R, idx, 'COMPRA_TON_GO', mes, 500);
    const pCompra = parametro(R, idx, 'COMPRA_TON', mes, 350);
    const pessoas = new Map();
    const pessoa = (fn, id) => {
      const k = `${fn}:${id}`;
      if (!pessoas.has(k)) {
        const pf = R.perfilDaPessoa(idx, fn, id, mes);
        pessoas.set(k, { chave: k, funcao: fn, id, nome: (e.nomes || {})[k] || `${fn === 'MOTORISTA' ? 'MOT' : 'AJU'} ${id}`,
          perfil: pf.codigo, perfilDados: pf.perfil || {}, itens: [], avisos: [] });
      }
      return pessoas.get(k);
    };
    const rotaWt = (cod) => { const v = R.vigente(idx, 'pcrotaexp', String(cod), mes); return v ? v.dados : null; };

    for (const c of e.cargas || []) {
      const t = (Number(c.peso) || 0) / 1000;
      const rt = rotaWt(c.codrota);
      const base = { tipo: 'CARGA', ref: c.numcar, data: c.dtsaida, destino: c.destino, rota: rt ? rt.descricao : `rota ${c.codrota ?? '?'}`, t, ent: Number(c.nument) || 0 };
      // motorista da rota
      if (c.codmotorista) {
        const p = pessoa('MOTORISTA', c.codmotorista), pf = p.perfilDados;
        let vlton = rt && rt.vl_ton_mot, perc = pf.perc_comissao != null ? pf.perc_comissao : rt && rt.perc != null ? rt.perc : 10, regra = rt ? `faixa ${rt.faixa}` : 'rota sem valor';
        if (pf.vl_ton_fixo != null) { vlton = pf.vl_ton_fixo; regra = 'R$/t fixo do perfil'; }
        else if (pf.ton_carne) { vlton = pCarne; regra = 'tonelada carne'; }
        if (vlton == null) p.avisos.push(`Carga ${c.numcar}: rota ${c.codrota} sem R$/t na matriz`);
        p.itens.push({ ...base, papel: 'rota', vlton: vlton || 0, perc, regra, valor: t * (vlton || 0) * perc / 100, bonus: base.ent * (pf.bonus_entrega || 0) });
      }
      // motorista do transbordo
      if (c.codmot_transb) {
        const p = pessoa('MOTORISTA', c.codmot_transb), pf = p.perfilDados;
        const vlton = pf.vl_ton_fixo != null ? pf.vl_ton_fixo : pTransb;
        const perc = pf.perc_comissao != null ? pf.perc_comissao : 10;
        p.itens.push({ ...base, papel: 'transbordo', vlton, perc, regra: pf.vl_ton_fixo != null ? 'R$/t fixo do perfil' : 'transbordo', valor: t * vlton * perc / 100, bonus: base.ent * (pf.bonus_entrega || 0) });
      }
      // ajudantes
      for (const [papel, cod] of [['ajudante', c.codajud1], ['ajudante 2', c.codajud2], ['ajudante 3', c.codajud3], ['ajudante transbordo', c.codajud_transb]]) {
        if (!cod) continue;
        const p = pessoa('AJUDANTE', cod), pf = p.perfilDados;
        let vlton = rt && rt.vl_ton_ajud, regra = rt ? `faixa ${rt.faixa}` : 'rota sem valor';
        if (pf.vl_ton_fixo != null) { vlton = pf.vl_ton_fixo; regra = 'R$/t fixo do perfil'; }
        if (vlton == null) p.avisos.push(`Carga ${c.numcar}: rota ${c.codrota} sem R$/t de ajudante na matriz`);
        p.itens.push({ ...base, papel, vlton: vlton || 0, perc: 100, regra, valor: t * (vlton || 0), bonus: 0 });
      }
    }
    for (const n of e.compras || []) {
      if (!n.matricula) continue;
      const p = pessoa('MOTORISTA', n.matricula), pf = p.perfilDados;
      const t = (Number(n.peso) || 0) / 1000;
      const vlton = pf.vl_ton_fixo != null ? pf.vl_ton_fixo : String(n.uf).toUpperCase() === 'GO' ? pCompraGO : pCompra;
      const perc = pf.perc_comissao != null ? pf.perc_comissao : 10;
      p.itens.push({ tipo: 'COMPRA', ref: n.numnota, data: n.dtent, destino: `Compra NF ${n.numnota} (${n.uf || '?'})`, rota: 'compra', t, ent: 0,
        papel: 'compra', vlton, perc, regra: pf.vl_ton_fixo != null ? 'R$/t fixo do perfil' : `compra ${n.uf || ''}`.trim(), valor: t * vlton * perc / 100, bonus: 0 });
    }

    // quem esta na planilha de Requisitos entra mesmo sem carga (novato, garantido)
    for (const k of Object.keys(e.requisitos || {})) { const [fn, id] = k.split(':'); if (fn && id) pessoa(fn, Number(id)); }

    const out = [];
    for (const p of pessoas.values()) {
      const pf = p.perfilDados, mot = p.funcao === 'MOTORISTA';
      const req = ((e.requisitos || {})[p.chave] || {});
      const peso_t = p.itens.reduce((s, i) => s + i.t, 0);
      const valor = p.itens.reduce((s, i) => s + i.valor, 0);
      const bonus = mot ? p.itens.reduce((s, i) => s + i.bonus, 0) : 0;
      const entregas = p.itens.reduce((s, i) => s + (i.papel === 'compra' ? 0 : i.ent), 0);
      const kpis = (mot ? KPIS_MOT : KPIS_AJU).map((k) => {
        const vl = pf.kpis && pf.kpis[k] != null ? Number(pf.kpis[k]) : null;
        const q = req.req ? req.req[k] : undefined;
        const nc = String(q).toUpperCase() === 'N/C';
        const ocorr = nc ? 0 : Number(q) || 0;
        const ok = vl != null && ocorr === 0;
        return { k, valor: vl, ocorrencias: nc ? 'N/C' : ocorr, ok, pago: ok ? vl : 0 };
      });
      if (!req.req) p.avisos.push('Sem linha na planilha de Requisitos: requisitos pagos como OK');
      const kpi = kpis.reduce((s, x) => s + x.pago, 0);
      const garantido_t = req.garantido_t != null ? Number(req.garantido_t) : Number(pf.ton_garantida) || 0;
      const falta_t = Math.max(0, garantido_t - peso_t);
      const medio = peso_t > 0 ? valor / peso_t : 0;
      const garantido = falta_t * medio;
      const ex = (e.extras || {})[p.chave] || {};
      const ajuda = Number(ex.ajuda) || 0;
      const total = valor + bonus + kpi + garantido + ajuda;
      out.push({ chave: p.chave, funcao: p.funcao, id: p.id, nome: p.nome, perfil: p.perfil, perfilNome: pf.nome || p.perfil,
        itens: p.itens.sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.ref).localeCompare(String(b.ref))),
        cargas: p.itens.filter((i) => i.tipo === 'CARGA').length, compras: p.itens.filter((i) => i.tipo === 'COMPRA').length,
        entregas, peso_t, valor: r2(valor), bonus: r2(bonus), kpis, kpi: r2(kpi), dias: req.dias, garantido_t, falta_t,
        medio: r2(medio), garantido: r2(garantido), bonus_dobro_rotina: mot && falta_t > 0 ? r2(bonus) : 0,
        ajuda: r2(ajuda), obs: ex.obs || '', total: r2(total), avisos: p.avisos });
    }
    return out.sort((a, b) => a.funcao.localeCompare(b.funcao) || a.nome.localeCompare(b.nome));
  }

  return { calcular, KPIS_MOT, KPIS_AJU };
});
