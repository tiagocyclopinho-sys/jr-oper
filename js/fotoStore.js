// =================================================================
// FILA DE FOTOS: IndexedDB (aparelho) -> Supabase Storage (nuvem)
//
// POR QUE ESTE ARQUIVO EXISTE
// Ate a v5.0.0 a foto da custodia de reentrega ia para o localStorage como
// base64, dentro da propria coluna JSONB do registro. Isso ja tinha dois
// precos conhecidos e um terceiro que apareceu em producao:
//
//   1) O localStorage e um balde pequeno (o Safari do iPhone para perto de
//      5 MB) e COMPARTILHADO com todo o resto do app. Em 25/08/2026 ele
//      estourou num aparelho do CD e o lancamento se perdeu - nunca chegou a
//      existir.
//   2) base64 infla o binario em ~33%, e no localStorage cada caractere
//      ocupa 2 bytes (UTF-16). Uma foto de 150 KB custa ~400 KB de cota.
//   3) O pull do cloudStore monta `select=*` (js/cloudStore.js:320), entao a
//      foto voltava da nuvem A CADA CICLO DE 30 SEGUNDOS, para sempre, em
//      todo aparelho.
//
// O QUE MUDA
// A foto passa a viver em DOIS lugares, nunca no localStorage:
//   - IndexedDB, como Blob, enquanto espera rede (balde proprio, na casa das
//     centenas de MB, e sem inflar em base64);
//   - Supabase Storage, como arquivo, depois que sobe.
// O Postgres guarda so o CAMINHO.
//
// A ORDEM E DE PROPOSITO: grava primeiro, sobe depois. A recepcao acontece na
// doca do CD, onde pode nao haver sinal no instante da captura. Exigir upload
// para registrar o recebimento travaria a operacao - foi exatamente por isso
// que a migration 31 recusou o Storage em 25/08/2026. A diferenca agora e que
// existe uma FILA de verdade, que sobrevive a reload e esvazia sozinha quando
// a rede volta, em vez de a foto morar no cache junto com os dados.
//
// DEPENDE DE: js/config.js (window.JR_CONFIG.supabase). Carrega ANTES de
// js/store.js, que chama registrarFotoEnviada().
// =================================================================

const FOTO_DB_NOME    = 'jr_fotos';
const FOTO_DB_VERSAO  = 1;
const FOTO_STORE      = 'fila';
const FOTO_BUCKET     = 'reentregas-fotos';

// Chave onde o aparelho anota quais (registro, etapa) SAO DELE - isto e, para
// quais ele tirou foto e ainda deve satisfacao. Ver _reconciliar().
const FOTO_CHAVE_POSSE = 'jr_fotos_posse';
const FOTO_POSSE_VALIDADE_MS = 30 * 24 * 3600 * 1000;  // 30 dias

class FotoStore {
  constructor() {
    this._db = null;
    this._processando = false;
    this._urls = new Map();   // id da fila -> objectURL, para nao vazar memoria
  }

  // ---------------------------------------------------------------
  // ABERTURA DO BANCO LOCAL
  // ---------------------------------------------------------------
  disponivel() {
    try { return typeof indexedDB !== 'undefined' && !!indexedDB; }
    catch (e) { return false; }
  }

  abrir() {
    if (this._db) return Promise.resolve(this._db);
    if (!this.disponivel()) return Promise.reject(new Error('Este navegador nao tem IndexedDB.'));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(FOTO_DB_NOME, FOTO_DB_VERSAO);
      req.onupgradeneeded = e => {
        const bd = e.target.result;
        if (!bd.objectStoreNames.contains(FOTO_STORE)) {
          const st = bd.createObjectStore(FOTO_STORE, { keyPath: 'id', autoIncrement: true });
          // Indice composto: a tela quase sempre pergunta "o que falta subir
          // DESTE registro, NESTA etapa?" - e nao "o que falta subir no geral".
          st.createIndex('por_alvo', ['modulo', 'registro_id', 'etapa'], { unique: false });
          st.createIndex('por_registro', ['modulo', 'registro_id'], { unique: false });
        }
      };
      req.onsuccess = e => {
        this._db = e.target.result;
        // Se outra aba pedir uma versao nova, esta solta o banco em vez de
        // travar a atualizacao com um bloqueio invisivel.
        this._db.onversionchange = () => { try { this._db.close(); } catch (x) {} this._db = null; };
        resolve(this._db);
      };
      req.onerror = () => reject(req.error || new Error('Falha ao abrir o IndexedDB.'));
    });
  }

  _tx(modo) {
    return this.abrir().then(bd => bd.transaction(FOTO_STORE, modo).objectStore(FOTO_STORE));
  }

  _pedido(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Falha no IndexedDB.'));
    });
  }

  // ---------------------------------------------------------------
  // GRAVACAO
  // ---------------------------------------------------------------
  // Recebe o dataURL que comprimirImagem() devolve e guarda como BLOB.
  // A conversao nao e cosmetica: o dataURL e base64 (+33% de tamanho) e, como
  // string, ocuparia o dobro em memoria. O Blob e o binario cru.
  static dataUrlParaBlob(dataUrl) {
    const partes = String(dataUrl || '').split(',');
    if (partes.length < 2) throw new Error('dataURL invalido.');
    const mime = (partes[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(partes[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  /**
   * Enfileira UMA foto. Devolve o id local dela.
   * @param {Object} o - { registro_id, etapa, dataUrl, modulo }
   */
  async enfileirar(o) {
    const blob = FotoStore.dataUrlParaBlob(o.dataUrl);
    const reg = {
      modulo: o.modulo || 'reentregas',
      registro_id: String(o.registro_id),
      etapa: String(o.etapa),
      blob,
      mime: blob.type || 'image/jpeg',
      tamanho: blob.size,
      criado_em: (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString(),
      criado_por: (window.db && window.db.currentUser) ? window.db.currentUser.nome : 'SISTEMA',
      tentativas: 0,
      ultimo_erro: null
    };
    const st = await this._tx('readwrite');
    const id = await this._pedido(st.add(reg));
    this._marcarPosse(reg.registro_id, reg.etapa);
    return id;
  }

  /** Enfileira varias e devolve quantas entraram. */
  async enfileirarVarias(dataUrls, alvo) {
    let n = 0;
    for (const d of (dataUrls || [])) {
      if (!d) continue;
      try { await this.enfileirar(Object.assign({ dataUrl: d }, alvo)); n++; }
      catch (e) { console.warn('[FotoStore] Nao consegui enfileirar uma foto:', e.message); }
    }
    return n;
  }

  // ---------------------------------------------------------------
  // LEITURA
  // ---------------------------------------------------------------
  async listarTudo() {
    if (!this.disponivel()) return [];
    try {
      const st = await this._tx('readonly');
      return (await this._pedido(st.getAll())) || [];
    } catch (e) { return []; }
  }

  async listarDoAlvo(registro_id, etapa, modulo) {
    if (!this.disponivel()) return [];
    try {
      const st = await this._tx('readonly');
      const idx = st.index('por_alvo');
      return (await this._pedido(idx.getAll([modulo || 'reentregas', String(registro_id), String(etapa)]))) || [];
    } catch (e) { return []; }
  }

  async contarDoAlvo(registro_id, etapa, modulo) {
    return (await this.listarDoAlvo(registro_id, etapa, modulo)).length;
  }

  /** Panorama da fila, para a tarja e para o diagnostico do aparelho. */
  async resumo() {
    const tudo = await this.listarTudo();
    const bytes = tudo.reduce((s, r) => s + (r.tamanho || 0), 0);
    const alvos = {};
    tudo.forEach(r => {
      const k = r.registro_id + '|' + r.etapa;
      alvos[k] = (alvos[k] || 0) + 1;
    });
    return {
      total: tudo.length,
      bytes,
      KB: Math.round(bytes / 1024),
      registros: Object.keys(alvos).length,
      alvos,
      maisAntiga: tudo.length ? tudo.map(r => r.criado_em).sort()[0] : null
    };
  }

  /**
   * URL exibivel de uma foto que ainda esta na fila. O objectURL fica
   * guardado e reaproveitado: criar um novo a cada render vazaria memoria,
   * e esta tela redesenha a cada 30s por causa da sincronizacao.
   */
  urlLocal(reg) {
    if (!reg || !reg.blob) return '';
    if (this._urls.has(reg.id)) return this._urls.get(reg.id);
    const url = URL.createObjectURL(reg.blob);
    this._urls.set(reg.id, url);
    return url;
  }

  _soltarUrl(id) {
    if (!this._urls.has(id)) return;
    try { URL.revokeObjectURL(this._urls.get(id)); } catch (e) {}
    this._urls.delete(id);
  }

  async remover(id) {
    this._soltarUrl(id);
    const st = await this._tx('readwrite');
    return this._pedido(st.delete(id));
  }

  /**
   * Esvazia a fila INTEIRA e larga todas as posses.
   *
   * Existe por causa do RESET GLOBAL. O reset apaga as reentregas - deste
   * aparelho, da nuvem e, pelo jr_reset_epoch, de todos os outros - mas a fila
   * de fotos nao mora no localStorage e passaria por cima dele intacta. As
   * fotos sobreviventes apontariam para reentregas que nao existem mais, e o
   * estrago seria continuo, nao pontual:
   *
   *   - processarFila() subiria cada foto para o Storage;
   *   - registrarFotoEnviada() responderia "nao encontrada";
   *   - o item ficaria na fila e tentaria de novo 30s depois;
   *   - ou seja, UM ARQUIVO ORFAO NOVO NO BUCKET A CADA CICLO, para sempre -
   *     e o DELETE esta negado por desenho, entao ninguem limparia depois.
   *
   * Mais a tarja de pendencia acesa para sempre e o aviso de saida pedindo
   * confirmacao eternamente, os dois apontando prova que ja nao existe.
   *
   * Apagar a fila aqui NAO destroi prova: o reset acabou de destruir o
   * registro a que ela servia. Foto sem registro nao e prova de nada.
   */
  async limparTudo() {
    if (!this.disponivel()) return 0;
    let n = 0;
    try {
      const antes = await this.listarTudo();
      n = antes.length;
      antes.forEach(r => this._soltarUrl(r.id));
      const st = await this._tx('readwrite');
      await this._pedido(st.clear());
    } catch (e) {
      console.warn('[FotoStore] Falha ao esvaziar a fila:', e.message);
    }
    try { localStorage.removeItem(FOTO_CHAVE_POSSE); } catch (e) {}
    window._fotosNaFila = 0;
    if (typeof window.atualizarTarjaFotosPendentes === 'function') window.atualizarTarjaFotosPendentes();
    if (n) console.log('[FotoStore] Reset global: ' + n + ' foto(s) da fila descartada(s) junto com as reentregas que elas comprovavam.');
    return n;
  }

  // ---------------------------------------------------------------
  // URL PUBLICA DE UMA FOTO QUE JA SUBIU
  // ---------------------------------------------------------------
  urlPublica(caminho) {
    const cfg = (window.JR_CONFIG && window.JR_CONFIG.supabase) || {};
    if (!cfg.url || !caminho) return '';
    // Caminho ja completo (registro antigo gravado com URL inteira) passa reto.
    if (/^https?:\/\//i.test(caminho)) return caminho;
    return cfg.url + '/storage/v1/object/public/' + FOTO_BUCKET + '/' + String(caminho).replace(/^\/+/, '');
  }

  // ---------------------------------------------------------------
  // ENVIO
  // ---------------------------------------------------------------
  _configOk() {
    const cfg = (window.JR_CONFIG && window.JR_CONFIG.supabase) || {};
    return !!(cfg.url && cfg.anonKey && cfg.url.startsWith('https://'));
  }

  _caminhoDe(reg) {
    const ext = (reg.mime === 'image/png') ? 'png' : (reg.mime === 'image/webp' ? 'webp' : 'jpg');
    const aleatorio = Math.random().toString(36).slice(2, 10);
    // Nome nao adivinhavel de proposito: o bucket e publico (leitura por URL),
    // entao o que protege a foto e o endereco nao ser deduzivel a partir do id
    // do registro.
    return 'reentregas/' + reg.registro_id + '/' + reg.etapa + '/' + Date.now() + '-' + aleatorio + '.' + ext;
  }

  async _subir(reg) {
    const cfg = window.JR_CONFIG.supabase;
    const caminho = this._caminhoDe(reg);
    const resp = await fetch(cfg.url + '/storage/v1/object/' + FOTO_BUCKET + '/' + caminho, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey,
        'Content-Type': reg.mime || 'image/jpeg',
        'x-upsert': 'true',
        'Cache-Control': 'max-age=31536000'
      },
      body: reg.blob
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error('HTTP ' + resp.status + ' ' + txt.slice(0, 200));
    }
    return caminho;
  }

  /**
   * Esvazia a fila. Chamada ao abrir o app, a cada ciclo de sincronizacao,
   * no evento 'online' e logo depois de cada captura.
   *
   * NAO apaga a copia local antes de o caminho estar gravado no registro: se
   * o app fechar entre uma coisa e outra, a foto tem de continuar existindo
   * em algum lugar. Subir a mesma foto duas vezes custa alguns KB; perder a
   * prova de recepcao custa a operacao.
   */
  async processarFila() {
    if (this._processando) return { enviadas: 0, falhas: 0, motivo: 'ja rodando' };
    if (!this.disponivel() || !this._configOk()) return { enviadas: 0, falhas: 0, motivo: 'sem indexeddb ou sem config' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { enviadas: 0, falhas: 0, motivo: 'offline' };
    }

    this._processando = true;
    let enviadas = 0, falhas = 0;
    try {
      const fila = await this.listarTudo();
      for (const reg of fila) {
        try {
          // O REGISTRO AINDA EXISTE? Esta pergunta vem ANTES do upload, e nao
          // depois, e a diferenca e grande: subir primeiro e descobrir depois
          // que o destino sumiu deixa um arquivo orfao no bucket a cada
          // tentativa - e como a fila tenta de novo a cada 30s, seria um
          // arquivo novo por ciclo, para sempre, num bucket onde o DELETE
          // esta negado por desenho.
          //
          // O caso real disso e o Reset Global, que apaga as reentregas mas
          // nao a fila (ver limparTudo(), que trata a via principal). Este
          // teste e a rede de seguranca para os caminhos que sobrarem: um
          // aparelho que estava desligado durante o reset, um registro
          // apagado individualmente na Lixeira.
          if (window.db && typeof window.db.existeReentrega === 'function'
              && !window.db.existeReentrega(reg.registro_id)) {
            console.warn('[FotoStore] Foto ' + reg.id + ' descartada: a reentrega '
              + reg.registro_id + ' nao existe mais (reset global ou exclusao).');
            await this.remover(reg.id);
            continue;
          }

          const caminho = await this._subir(reg);

          // 1) grava o caminho no registro (localStorage, via store.js)
          const ok = window.db && typeof window.db.registrarFotoEnviada === 'function'
            ? window.db.registrarFotoEnviada(reg.registro_id, reg.etapa, caminho)
            : { success: false, message: 'store.js sem registrarFotoEnviada()' };
          if (!ok || !ok.success) {
            // O arquivo subiu mas o registro nao aceitou o caminho. Manter na
            // fila e a escolha certa: na proxima volta ele tenta de novo, e o
            // pior que acontece e um arquivo orfao de ~150 KB no bucket.
            falhas++;
            await this._anotarErro(reg, (ok && ok.message) || 'registro nao encontrado');
            continue;
          }

          // 2) so agora a copia local sai
          await this.remover(reg.id);
          enviadas++;
        } catch (e) {
          falhas++;
          await this._anotarErro(reg, e.message);
        }
      }

      await this._reconciliar();

      if (enviadas > 0) {
        console.log('[FotoStore] ' + enviadas + ' foto(s) subiram para o Storage.');
        // Empurra os caminhos recem-gravados para a nuvem sem esperar o
        // proximo tick de 30s.
        if (window.cloudStore && window.cloudStore.isConfigured()) {
          window.cloudStore.syncLocalToCloud().catch(() => {});
        }
        if (typeof window.atualizarTarjaFotosPendentes === 'function') window.atualizarTarjaFotosPendentes();
        if (typeof renderApp === 'function') { try { renderApp(); } catch (e) {} }
      }
    } finally {
      this._processando = false;
    }
    return { enviadas, falhas };
  }

  async _anotarErro(reg, msg) {
    try {
      const st = await this._tx('readwrite');
      reg.tentativas = (reg.tentativas || 0) + 1;
      reg.ultimo_erro = String(msg || '').slice(0, 300);
      await this._pedido(st.put(reg));
    } catch (e) {}
    console.warn('[FotoStore] Foto ' + reg.id + ' (reentrega ' + reg.registro_id + '/' + reg.etapa + ') nao subiu: ' + msg);
  }

  // ---------------------------------------------------------------
  // POSSE E RECONCILIACAO
  //
  // O contador `fotos_*_pendentes` mora no registro e por isso VIAJA: sobe
  // para a nuvem, desce para os outros aparelhos, e e o que faz a pendencia
  // aparecer para quem nao tirou a foto.
  //
  // O problema e que ele tambem volta. O pull de 30s reescreve o registro
  // local com o que estiver na nuvem, e pode ressuscitar um contador que este
  // aparelho ja tinha zerado - a pendencia ficaria piscando para sempre,
  // apontando uma foto que ja subiu.
  //
  // A saida e a POSSE: o aparelho anota quais (registro, etapa) sao dele. Para
  // esses, e a FILA que manda, nao o registro - a cada passada o contador e
  // reescrito com o numero real de itens na fila. A posse so e largada quando
  // a fila esta vazia E o registro ja concorda que esta zerado; ate la, um
  // clobber do pull e desfeito na volta seguinte.
  //
  // Isto e seguro porque recebimento e despacho sao atos de UMA pessoa em UM
  // aparelho: nao ha dois aparelhos com fotos pendentes do mesmo par.
  // ---------------------------------------------------------------
  _lerPosse() {
    try { return JSON.parse(localStorage.getItem(FOTO_CHAVE_POSSE) || '{}') || {}; }
    catch (e) { return {}; }
  }

  _gravarPosse(m) {
    try { localStorage.setItem(FOTO_CHAVE_POSSE, JSON.stringify(m)); } catch (e) {}
  }

  _marcarPosse(registro_id, etapa) {
    const m = this._lerPosse();
    m[registro_id + '|' + etapa] = Date.now();
    this._gravarPosse(m);
  }

  async _reconciliar() {
    const posse = this._lerPosse();
    const chaves = Object.keys(posse);
    if (!chaves.length) return;
    if (!window.db || typeof window.db.ajustarFotosPendentes !== 'function') return;

    let mudou = false;
    for (const k of chaves) {
      const partes = k.split('|');
      const registro_id = partes[0];
      const etapa = partes[1];

      if (Date.now() - (posse[k] || 0) > FOTO_POSSE_VALIDADE_MS) {
        delete posse[k]; mudou = true; continue;
      }

      const naFila = await this.contarDoAlvo(registro_id, etapa);
      const res = window.db.ajustarFotosPendentes(registro_id, etapa, naFila);

      // Larga a posse so quando nao ha mais nada na fila e o registro ja
      // reflete isso. Registro que sumiu (apagado) tambem libera.
      if (naFila === 0 && (!res || !res.success || res.pendentes === 0)) {
        delete posse[k]; mudou = true;
      }
    }
    if (mudou) this._gravarPosse(posse);
  }

  // ---------------------------------------------------------------
  // MUDANCA DE UMA VEZ SO: base64 legado -> fila -> Storage
  //
  // Enquanto as colunas fotos_recebimento / fotos_despacho tiverem conteudo,
  // elas voltam da nuvem A CADA PULL, porque o pull monta select=*
  // (js/cloudStore.js:320). Parar de GRAVAR base64 nao adianta sozinho: o que
  // ja esta la continua trafegando. Esvaziar essas colunas e o que faz o ganho
  // acontecer de fato.
  //
  // A ORDEM IMPORTA e e contraintuitiva: a coluna legada e limpa JUNTO com o
  // aumento do contador de pendentes, na MESMA gravacao. Se fosse limpa antes,
  // haveria um instante com status RECEBIDO_CD e nenhuma prova - e o CHECK do
  // banco recusaria o registro no proximo envio. Se fosse limpa depois do
  // upload, um app fechado no meio deixaria a foto duplicada nos dois lugares.
  //
  // Roda uma vez, por decisao de quem opera (nao automatico): e um movimento
  // de dado, e movimento de dado com gente olhando e melhor que movimento de
  // dado por conta propria.
  // ---------------------------------------------------------------
  async migrarLegado() {
    if (!this.disponivel()) return { migrados: 0, erro: 'Sem IndexedDB neste navegador.' };
    if (!window.db || !Array.isArray(window.db.data && window.db.data.reentregas)) {
      return { migrados: 0, erro: 'Base local indisponivel.' };
    }
    const etapas = ['recebimento', 'despacho'];
    let migrados = 0, registros = 0;

    for (const r of window.db.data.reentregas) {
      if (r.is_deleted) continue;
      for (const etapa of etapas) {
        const campoLegado = (etapa === 'despacho') ? 'fotos_despacho' : 'fotos_recebimento';
        const campoPend   = (etapa === 'despacho') ? 'fotos_despacho_pendentes' : 'fotos_recebimento_pendentes';
        const legado = Array.isArray(r[campoLegado]) ? r[campoLegado].filter(Boolean) : [];
        if (!legado.length) continue;

        const idsLocais = [];
        try {
          for (const b64 of legado) {
            idsLocais.push(await this.enfileirar({ registro_id: r.id, etapa, dataUrl: b64 }));
          }
        } catch (e) {
          for (const x of idsLocais) { try { await this.remover(x); } catch (y) {} }
          console.warn('[FotoStore] Reentrega ' + r.id + '/' + etapa + ' nao migrou: ' + e.message);
          continue;
        }

        const upd = {};
        upd[campoLegado] = [];                                                   // esvazia o base64
        upd[campoPend]   = (parseInt(r[campoPend]) || 0) + idsLocais.length;     // e assume a pendencia
        const ok = window.db.updateReentrega(r.id, upd);
        if (!ok || !ok.success) {
          for (const x of idsLocais) { try { await this.remover(x); } catch (y) {} }
          continue;
        }
        migrados += idsLocais.length;
        registros++;
      }
    }

    console.log('[FotoStore] Migracao do legado: ' + migrados + ' foto(s) de ' + registros + ' etapa(s) entraram na fila.');
    const res = await this.processarFila();
    return { migrados, registros, enviadas: res.enviadas, falhas: res.falhas };
  }

  // ---------------------------------------------------------------
  // DIAGNOSTICO (console)
  // ---------------------------------------------------------------
  async diagnostico() {
    const r = await this.resumo();
    console.log('[FotoStore] fila: ' + r.total + ' foto(s), ' + r.KB + ' KB, em ' + r.registros + ' registro(s).');
    if (r.maisAntiga) console.log('[FotoStore] a mais antiga esperando desde ' + r.maisAntiga);
    console.table((await this.listarTudo()).map(x => ({
      id: x.id, reentrega: x.registro_id, etapa: x.etapa,
      KB: Math.round((x.tamanho || 0) / 1024), tentativas: x.tentativas, erro: x.ultimo_erro
    })));
    return r;
  }
}

window.fotoStore = new FotoStore();
window.jrFotosPendentes = () => window.fotoStore.diagnostico();

// Mudanca do base64 legado para o Storage. Rodar UMA VEZ, do console de um
// aparelho que ja tenha puxado a nuvem inteira:  jrMigrarFotosLegado()
window.jrMigrarFotosLegado = async function() {
  const r = await window.fotoStore.migrarLegado();
  console.log('[FotoStore] Resultado:', r);
  if (typeof showToast === 'function') {
    showToast(r.erro ? ('⚠️ ' + r.erro)
      : ('✅ ' + r.migrados + ' foto(s) legada(s) na fila; ' + r.enviadas + ' ja subiram.'),
      r.erro ? 'error' : 'success');
  }
  if (typeof renderApp === 'function') { try { renderApp(); } catch (e) {} }
  return r;
};

// -----------------------------------------------------------------
// GATILHOS
// -----------------------------------------------------------------
// A rede voltou: nao espera o tick de 30s. Mesmo motivo do listener
// equivalente no cloudStore (achado de 20/08/2026).
window.addEventListener('online', () => {
  setTimeout(() => window.fotoStore.processarFila().catch(() => {}), 800);
});

// Ao abrir o app: o que ficou de ontem sobe agora.
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => window.fotoStore.processarFila().catch(() => {}), 3500);
});

// AVISO DE SAIDA COM FILA CHEIA
//
// Nao da para impedir alguem de limpar os dados do navegador - nenhuma pagina
// consegue isso. O que da e nao deixar a pessoa fazer isso SEM SABER: enquanto
// houver foto so no aparelho, sair da pagina pede confirmacao. E o unico
// momento em que o navegador nos deixa falar antes de a foto sumir.
//
// O contador e mantido em memoria de proposito: beforeunload e sincrono e nao
// espera Promise, entao consultar o IndexedDB ali dentro nao funcionaria.
window._fotosNaFila = 0;
window.atualizarTarjaFotosPendentes = function() {
  if (!window.fotoStore || !window.fotoStore.disponivel()) return;
  window.fotoStore.resumo().then(r => {
    window._fotosNaFila = r.total;
    const el = document.getElementById('tarja-fotos-pendentes');
    if (!el) return;
    if (!r.total) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.innerHTML =
      '<span class="font-black">&#128247; ' + r.total + ' foto(s) ainda so neste aparelho</span>' +
      '<span class="hidden sm:inline"> &mdash; ' + r.KB + ' KB aguardando rede. ' +
      'Se voce limpar os dados do navegador agora, elas se perdem.</span>' +
      '<button onclick="jrSubirFotosAgora()" class="ml-2 bg-amber-700 hover:bg-amber-600 text-white font-bold px-2 py-0.5 rounded text-[10px]">Tentar enviar agora</button>';
  }).catch(() => {});
};

window.jrSubirFotosAgora = function() {
  if (typeof showToast === 'function') showToast('📷 Enviando fotos pendentes...', 'info');
  window.fotoStore.processarFila().then(r => {
    if (typeof showToast === 'function') {
      showToast(r.enviadas
        ? ('✅ ' + r.enviadas + ' foto(s) enviada(s).')
        : (r.falhas ? '⚠️ Nenhuma foto subiu. Sem rede ou o servidor recusou.' : 'ℹ️ Nao ha foto pendente.'),
        r.enviadas ? 'success' : (r.falhas ? 'error' : 'info'));
    }
    window.atualizarTarjaFotosPendentes();
  });
};

window.addEventListener('beforeunload', e => {
  if (window._fotosNaFila > 0) {
    e.preventDefault();
    e.returnValue = '';   // o texto e do navegador; o nosso e ignorado desde 2016
    return '';
  }
});
