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
// ---------------------------------------------------------------
// UM BUCKET POR MODULO (04/09/2026)
//
// Era uma constante so, 'reentregas-fotos', porque so a reentrega usava esta
// fila. A devolucao entrou na migration 38 pelo mesmo motivo que a reentrega
// entrou na 34 - 98,7% do peso da tabela era foto em base64 - e traz consigo
// a pergunta "de qual bucket e esta foto?".
//
// A resposta vem do PROPRIO CAMINHO, e nao de um parametro a mais espalhado
// por dez assinaturas: _caminhoDe() ja carimba o modulo no primeiro segmento
// ('reentregas/123/...'), entao o caminho gravado no registro se identifica
// sozinho. E isso que mantem os caminhos ja gravados funcionando sem tocar em
// nenhum deles - quem nao reconhece o prefixo cai no bucket da reentrega, que
// era o unico que existia antes desta linha.
// ---------------------------------------------------------------
const FOTO_BUCKETS = {
  reentregas: 'reentregas-fotos',
  devolucoes: 'devolucoes-fotos'
};
const FOTO_MODULO_PADRAO = 'reentregas';
const FOTO_BUCKET     = FOTO_BUCKETS[FOTO_MODULO_PADRAO];

/** Nome da pasta-raiz no bucket, a partir do modulo do registro. */
function _pastaDoModulo(modulo) {
  return FOTO_BUCKETS[modulo] ? modulo : FOTO_MODULO_PADRAO;
}

/** Bucket a partir do modulo. */
function _bucketDoModulo(modulo) {
  return FOTO_BUCKETS[_pastaDoModulo(modulo)];
}

/**
 * Bucket a partir de um caminho ja gravado. Caminho anterior a 04/09/2026 e
 * sempre da reentrega e cai no padrao, sem precisar de migracao de dado.
 */
function _bucketDoCaminho(caminho) {
  const raiz = String(caminho || '').replace(/^[/]+/, '').split('/')[0];
  return FOTO_BUCKETS[raiz] || FOTO_BUCKETS[FOTO_MODULO_PADRAO];
}

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
    this._marcarPosse(reg.registro_id, reg.etapa, reg.modulo);
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
    return cfg.url + '/storage/v1/object/public/' + _bucketDoCaminho(caminho) + '/' + String(caminho).replace(/^\/+/, '');
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
    // O primeiro segmento e o modulo, e nao e enfeite: e por ele que
    // _bucketDoCaminho() descobre de qual bucket a foto veio na hora de
    // montar a URL publica.
    return _pastaDoModulo(reg.modulo) + '/' + reg.registro_id + '/' + reg.etapa
         + '/' + Date.now() + '-' + aleatorio + '.' + ext;
  }

  async _subir(reg) {
    const cfg = window.JR_CONFIG.supabase;
    const caminho = this._caminhoDe(reg);
    const resp = await fetch(cfg.url + '/storage/v1/object/' + _bucketDoModulo(reg.modulo) + '/' + caminho, {
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
          if (window.db && typeof window.db.existeAlvoDeFoto === 'function'
              && !window.db.existeAlvoDeFoto(reg.modulo, reg.registro_id)) {
            console.warn('[FotoStore] Foto ' + reg.id + ' descartada: '
              + _pastaDoModulo(reg.modulo) + ' ' + reg.registro_id
              + ' nao existe mais (reset global ou exclusao).');
            await this.remover(reg.id);
            continue;
          }

          const caminho = await this._subir(reg);

          // 1) grava o caminho no registro (localStorage, via store.js)
          const ok = window.db && typeof window.db.registrarFotoEnviada === 'function'
            ? window.db.registrarFotoEnviada(reg.registro_id, reg.etapa, caminho, reg.modulo)
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
    console.warn('[FotoStore] Foto ' + reg.id + ' (' + _pastaDoModulo(reg.modulo) + ' '
      + reg.registro_id + '/' + reg.etapa + ') nao subiu: ' + msg);
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

  // A chave ganhou o modulo em 04/09/2026, quando a devolucao passou a usar
  // esta fila: sem ele, a reentrega 123 e a devolucao 123 dividiriam a mesma
  // posse e uma zeraria o contador da outra.
  //
  // Chave antiga tem 2 partes e continua sendo lida como reentrega (ver
  // _partesDaPosse) - nao ha migracao de chave, so leitura tolerante.
  _marcarPosse(registro_id, etapa, modulo) {
    const m = this._lerPosse();
    m[_pastaDoModulo(modulo) + '|' + registro_id + '|' + etapa] = Date.now();
    this._gravarPosse(m);
  }

  /** Aceita 'modulo|id|etapa' (novo) e 'id|etapa' (anterior a 04/09/2026). */
  _partesDaPosse(chave) {
    const p = String(chave).split('|');
    return (p.length >= 3)
      ? { modulo: p[0], registro_id: p[1], etapa: p[2] }
      : { modulo: FOTO_MODULO_PADRAO, registro_id: p[0], etapa: p[1] };
  }

  async _reconciliar() {
    const posse = this._lerPosse();
    const chaves = Object.keys(posse);
    if (!chaves.length) return;
    if (!window.db || typeof window.db.ajustarFotosPendentes !== 'function') return;

    let mudou = false;
    for (const k of chaves) {
      const { modulo, registro_id, etapa } = this._partesDaPosse(k);

      if (Date.now() - (posse[k] || 0) > FOTO_POSSE_VALIDADE_MS) {
        delete posse[k]; mudou = true; continue;
      }

      const naFila = await this.contarDoAlvo(registro_id, etapa, modulo);
      const res = window.db.ajustarFotosPendentes(registro_id, etapa, naFila, modulo);

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

    // Cópia da lista, pelo mesmo motivo da versão da devolução: updateReentrega
    // chama save() -> sortAll(), que reordena data.reentregas embaixo do laço.
    for (const r of window.db.data.reentregas.slice()) {
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
//
// A versao da DEVOLUCAO e jrMigrarFotosDevolucaoLegado(), logo abaixo.
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
// MIGRACAO DO LEGADO DA DEVOLUCAO (04/09/2026, migration 38)
//
// Mesma mecanica de migrarLegado(), com tres diferencas que vem da tabela:
//
//   1. As etapas sao 'abertura' e 'investigacao', nao recebimento/despacho.
//
//   2. Existe uma TERCEIRA coluna com base64 na devolucao: foto_url, que
//      guarda uma copia inteira da primeira foto (1.253 dos 3.975 KB medidos
//      em 04/09/2026). Ela nao e um alias barato como o nome sugere - e
//      duplicata pura de fotos_abertura[0]. Aqui ela e esvaziada junto, e so
//      e enfileirada por conta propria se fotos_abertura estiver vazio (havia
//      registro antigo em que so foto_url foi preenchida).
//
//   3. NAO passa por updateInvestigacao() nem por nenhuma rota de edicao:
//      grava direto. updateInvestigacao carimba status_gestao =
//      'PENDENTE_GESTOR' em toda edicao, e uma migracao de dado reabriria a
//      tratativa de TODAS as devolucoes com foto de uma vez - inclusive as ja
//      concluidas pelo gestor.
//
// A ORDEM DENTRO DO LACO IMPORTA e e a mesma da reentrega: a coluna legada so
// e esvaziada DEPOIS de a foto estar na fila, e na MESMA gravacao em que o
// contador de pendentes sobe. Assim nao existe instante em que a devolucao
// esteja sem prova nenhuma.
// -----------------------------------------------------------------
FotoStore.prototype.migrarLegadoDevolucao = async function() {
  if (!this.disponivel()) return { migrados: 0, erro: 'Sem IndexedDB neste navegador.' };
  if (!window.db || !Array.isArray(window.db.data && window.db.data.ocorrencias_devolucao)) {
    return { migrados: 0, erro: 'Base local indisponivel.' };
  }

  const ETAPAS = [
    { etapa: 'abertura',     legado: 'fotos_abertura',     pend: 'fotos_abertura_pendentes' },
    { etapa: 'investigacao', legado: 'fotos_investigacao', pend: 'fotos_investigacao_pendentes' }
  ];
  let migrados = 0, registros = 0;

  // ITERA UMA CÓPIA, e não o array vivo (04/09/2026).
  //
  // Dentro do laço isto chama window.db.save(), que chama sortAll(), que
  // REORDENA data.ocorrencias_devolucao; e o pull de 30s pode, no meio,
  // trocar a referência do array inteiro (Object.assign(window.db.data, ...)
  // em _pullDaNuvem). Um for..of sobre o array vivo, nos dois casos, pula
  // registro sem avisar. Os objetos são os mesmos - a cópia é só da LISTA -
  // então as gravações continuam valendo.
  for (const d of window.db.data.ocorrencias_devolucao.slice()) {
    if (d.is_deleted) continue;

    for (const E of ETAPAS) {
      let legado = Array.isArray(d[E.legado]) ? d[E.legado].filter(Boolean) : [];

      // foto_url so vira foto por si mesma quando fotos_abertura esta vazio;
      // caso contrario ela e duplicata da primeira e sai sem ser enfileirada.
      const soFotoUrl = (E.etapa === 'abertura' && !legado.length
                         && typeof d.foto_url === 'string' && d.foto_url.startsWith('data:'));
      if (soFotoUrl) legado = [d.foto_url];
      if (!legado.length) {
        // Nada a enfileirar, mas pode haver foto_url duplicada a descartar.
        if (E.etapa === 'abertura' && typeof d.foto_url === 'string' && d.foto_url.startsWith('data:')) {
          d.foto_url = '';
          d.atualizado_em = (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString();
          window.db.save();
        }
        continue;
      }

      const idsLocais = [];
      try {
        for (const b64 of legado) {
          idsLocais.push(await this.enfileirar({
            registro_id: d.id, etapa: E.etapa, dataUrl: b64, modulo: 'devolucoes'
          }));
        }
      } catch (e) {
        for (const x of idsLocais) { try { await this.remover(x); } catch (y) {} }
        console.warn('[FotoStore] Devolucao ' + (d.numero_devolucao || d.id) + '/' + E.etapa
                     + ' nao migrou: ' + e.message);
        continue;
      }

      // Esvazia o base64 e assume a pendencia na MESMA gravacao.
      d[E.legado] = [];
      d[E.pend] = (parseInt(d[E.pend]) || 0) + idsLocais.length;
      if (E.etapa === 'abertura') d.foto_url = '';
      d.atualizado_em = (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString();
      window.db.save();

      migrados += idsLocais.length;
      registros++;
    }
  }

  console.log('[FotoStore] Legado da devolucao: ' + migrados + ' foto(s) de ' + registros
              + ' etapa(s) entraram na fila.');
  const res = await this.processarFila();
  return { migrados, registros, enviadas: res.enviadas, falhas: res.falhas };
};

// Rodar UMA VEZ, do console de um aparelho que ja tenha puxado a nuvem
// inteira:  jrMigrarFotosDevolucaoLegado()
window.jrMigrarFotosDevolucaoLegado = async function() {
  const r = await window.fotoStore.migrarLegadoDevolucao();
  console.log('[FotoStore] Resultado (devolucao):', r);
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

// =================================================================
// VIDEOS DE EVIDENCIA -> Supabase Storage (bucket 'evidencias-videos')
//
// POR QUE ESTE BLOCO EXISTE (26/08/2026)
// As fotos sairam do localStorage na v5.1.0 (todo o arquivo acima). O video
// FICOU PARA TRAS: handleVideoUpload() ainda fazia readAsDataURL() do arquivo
// inteiro e empurrava a string base64 para dentro do registro - e do registro
// para o localStorage, no save().
//
// A conta de por que isso nao tinha como funcionar:
//   video de 3 MB -> ~4 MB em base64 (+33%) -> ~8 MB no localStorage, que
//   guarda UTF-16 (2 bytes por caractere). A cota do navegador fica entre
//   5 e 10 MB e NAO tem relacao nenhuma com a memoria do PC nem com o espaco
//   do Supabase: e um teto por origem, cravado no navegador.
//
// O efeito medido em producao: setItem() estourava, a tarja "o ultimo
// registro NAO foi salvo" acendia, e o lancamento se perdia. Pior: a coluna
// videos_abertura do banco tinha 0 byte de video em TODOS os registros - o
// video nunca chegava na nuvem, morria no navegador. A pessoa anexava a
// prova, via o preview na tela, e nao havia prova nenhuma.
//
// DIFERENCA DE DESENHO EM RELACAO A FOTO: a foto tem fila (IndexedDB) porque
// e capturada na doca, onde pode nao haver sinal no instante em que o
// caminhao esta parado esperando. O video e anexado na tela de abertura e na
// de analise, com o arquivo ja pronto no aparelho - da para exigir rede e
// dizer na hora se subiu ou nao. E por isso o upload aqui e IMEDIATO, na
// selecao do arquivo: quando o operador clica em Salvar, o video ja esta no
// servidor e o registro carrega so o endereco (~120 bytes).
//
// O QUE VAI PARA O REGISTRO passa a ser a URL publica. Todas as telas ja
// montam <video src="${v}">, entao nada muda na exibicao - e os registros
// antigos, que guardam base64, continuam abrindo do mesmo jeito.
// =================================================================
const VIDEO_BUCKET = 'evidencias-videos';

// Igual ao file_size_limit do bucket. Vale conferir os dois quando mudar:
// o navegador barra antes de gastar a rede, o bucket barra de verdade.
const VIDEO_TETO_BYTES = 50 * 1024 * 1024;

const VIDEO_MIMES_OK = [
  'video/mp4', 'video/webm', 'video/quicktime',
  'video/x-msvideo', 'video/3gpp', 'video/x-matroska'
];

class VideoStore {
  _cfg() {
    return (window.JR_CONFIG && window.JR_CONFIG.supabase) || {};
  }

  configurado() {
    const c = this._cfg();
    return !!(c.url && c.anonKey && String(c.url).startsWith('https://'));
  }

  urlPublica(caminho) {
    const c = this._cfg();
    if (!c.url || !caminho) return '';
    if (/^https?:/i.test(String(caminho))) return caminho;   // ja e URL inteira
    return c.url + '/storage/v1/object/public/' + VIDEO_BUCKET + '/'
         + String(caminho).replace(/^\/+/, '');
  }

  formatarMB(bytes) {
    return (Number(bytes || 0) / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  }

  // Recusa o arquivo ANTES de gastar rede. Devolve null quando esta tudo bem,
  // ou o texto do problema, pronto para mostrar na tela.
  validar(file) {
    if (!file) return 'Arquivo vazio.';
    const tipo = String(file.type || '').toLowerCase();
    if (tipo && !VIDEO_MIMES_OK.includes(tipo)) {
      return 'O formato ' + tipo + ' nao e aceito. Use MP4, WEBM, MOV, AVI, 3GP ou MKV.';
    }
    if (file.size > VIDEO_TETO_BYTES) {
      // A mensagem antiga mandava "corte um trecho menor e anexe de novo".
      // Para a operacao isso e conselho impossivel: o video prova que as 10
      // caixas foram carregadas - cortado em 8, nao prova mais nada. Agora o
      // app reencoda o video INTEIRO antes de chegar aqui, e esta mensagem so
      // aparece quando nem reencodado coube (gravacao muito longa, ou
      // navegador sem suporte a compressao). Entao ela diz a verdade sobre
      // onde o limite mora, em vez de pedir para destruir a prova.
      return 'Mesmo reduzido, o video tem ' + this.formatarMB(file.size) + ' e o teto por arquivo e '
           + this.formatarMB(VIDEO_TETO_BYTES) + ' - esse teto e do plano Free do Supabase, nao do sistema.'
           + ' Grave a prova em duas partes (sem cortar nenhuma delas) ou avalie subir o plano com a TI.';
    }
    return null;
  }

  _caminho(file, alvo) {
    const a = alvo || {};
    const ext = (String(file.name || '').split('.').pop() || 'mp4')
                  .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
    const aleatorio = Math.random().toString(36).slice(2, 10);
    // Nome nao adivinhavel pelo mesmo motivo das fotos: o bucket e publico
    // para leitura, entao o que protege o video e o endereco nao sair do id
    // do registro.
    const pasta = (a.modulo || 'ocorrencias') + '/' + (a.registro_id || 'sem-id') + '/' + (a.etapa || 'geral');
    return pasta + '/' + Date.now() + '-' + aleatorio + '.' + ext;
  }

  /**
   * Sobe UM video e devolve { caminho, url, bytes }.
   * onProgresso recebe 0..100 - XMLHttpRequest em vez de fetch existe por
   * isso: fetch nao informa progresso de upload, e um video de 40 MB numa
   * rede do CD leva tempo suficiente para a tela precisar dizer algo.
   */
  subir(file, alvo, onProgresso) {
    return new Promise((resolve, reject) => {
      const problema = this.validar(file);
      if (problema) return reject(new Error(problema));
      if (!this.configurado()) {
        return reject(new Error('Supabase nao configurado neste aparelho - o video nao tem para onde ir.'));
      }

      const cfg = this._cfg();
      const caminho = this._caminho(file, alvo);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', cfg.url + '/storage/v1/object/' + VIDEO_BUCKET + '/' + caminho, true);
      xhr.setRequestHeader('apikey', cfg.anonKey);
      xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.anonKey);
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.setRequestHeader('Cache-Control', 'max-age=31536000');

      if (xhr.upload && typeof onProgresso === 'function') {
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) onProgresso(Math.round((e.loaded / e.total) * 100));
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ caminho, url: this.urlPublica(caminho), bytes: file.size });
        } else {
          let detalhe = '';
          try { detalhe = (JSON.parse(xhr.responseText || '{}').message) || ''; } catch (e) {}
          reject(new Error('O servidor recusou o video (HTTP ' + xhr.status + ')'
                           + (detalhe ? ': ' + detalhe : '.')));
        }
      };
      xhr.onerror = () => reject(new Error('Sem conexao com o servidor. Confira a internet e anexe de novo.'));
      xhr.ontimeout = () => reject(new Error('O envio demorou demais. Tente de novo, de preferencia com um video menor.'));
      xhr.timeout = 5 * 60 * 1000;
      xhr.send(file);
    });
  }
}

window.videoStore = new VideoStore();

// =================================================================
// COMPRESSAO DE VIDEO NO NAVEGADOR - 26/08/2026
//
// O PEDIDO QUE ORIGINOU ISTO. A tela recusava um video de 58,9 MB e mandava
// "corte um trecho menor e anexe de novo". Para a operacao isso e conselho
// impossivel: o video prova que 10 caixas foram carregadas: cortado em 8, nao
// prova mais nada. A prova tem de subir INTEIRA.
//
// POR QUE NAO BASTA LEVANTAR O LIMITE. Os 50 MB nao sao escolha deste codigo,
// sao o teto do plano. Free: 50 MB por arquivo, e o limite do bucket NAO pode
// passar do limite global do projeto. Nao existe configuracao que aceite os
// 58,9 MB enquanto o projeto estiver no Free.
//
// E o teto por arquivo nem e o pior. O Free da 1 GB de storage NO TOTAL - nao
// por mes. Em 26/08/2026 havia 1 video real la, de 48 MB: nesse ritmo cabem
// cerca de 20 videos e acabou, para sempre. Um video por devolucao enche isso
// em semanas. Ou seja, subir de plano sozinho so empurra a parede.
//
// A SAIDA, e por que ela e honesta. O video de celular tem 58,9 MB por causa
// de RESOLUCAO e BITRATE, nao de duracao. Reencodado a 720p, as mesmas 10
// caixas cabem numa fracao do tamanho e continuam perfeitamente legiveis para
// o que a prova precisa mostrar. Nada e cortado: a duracao e sempre integral.
//
// E o mesmo trade-off que o projeto ja aceitou para as fotos - comprimirImagem()
// redesenha em 1280px e reexporta em JPEG 75%, de 8 MB para 150-400 KB - pelo
// mesmo motivo escrito la: o tamanho que a tela realmente exibe nao precisa do
// arquivo cru do sensor.
//
// COMO. MediaRecorder gravando um <canvas> alimentado pelo <video> tocando, com
// o audio original reaproveitado. Roda em TEMPO REAL: um video de 2 minutos leva
// ~2 minutos. Foi escolhido assim de proposito - a alternativa (WebCodecs) e
// varias vezes mais rapida, mas exige um muxer MP4 escrito a mao, e o custo do
// tempo aqui e absorvido pelo fluxo: a analista preenche causa raiz, tipo de
// erro e acao tomada enquanto o video processa, e jrPodeSalvarComVideos() ja
// impede salvar antes de terminar.
//
// NAO ACELERA a reproducao para ganhar tempo (playbackRate). O MediaRecorder
// carimba em tempo de parede: o resultado seria um video em camera rapida.
// Prova de carregamento acelerada nao e prova - e outra coisa.
// =================================================================

// -----------------------------------------------------------------------------
// QUANDO VALE REENCODAR - 26/08/2026, revisado
//
// A primeira versao decidia por TAMANHO: acima de 20 MB reencoda, abaixo sobe
// como esta. Esse corte deixava passar inteiro justamente o caso mais comum -
// o clipe de 20 a 60 segundos de celular, que sai entre 8 e 19 MB. Ou seja, o
// grosso do que enche o bucket subia cru, e a compressao so pegava a excecao.
//
// E tamanho nao responde a pergunta certa. 15 MB e MUITO para 20 segundos
// (6 Mbps - vale reencodar, encolhe para uns 3 MB sem ninguem notar) e POUCO
// para 5 minutos (400 kbps - reencodar so degrada uma prova que ja esta
// enxuta). O mesmo numero, duas decisoes opostas. Quem sabe distinguir e o
// BITRATE de entrada, comparado com o que este app produziria.
//
// Sobra so um corte por tamanho, e por um motivo diferente: a compressao roda
// em TEMPO REAL. Gastar dois minutos da analista para poupar 2 MB de um 1 GB
// nao se paga. Abaixo deste piso, sobe como esta.
const VIDEO_LIMIAR_COMPRIMIR = 3 * 1024 * 1024;

// Alvo de tamanho do arquivo reencodado. Bem abaixo do teto de 50 MB de
// proposito: o teto por arquivo nao e o recurso escasso, o 1 GB total e.
const VIDEO_ALVO_BYTES = 8 * 1024 * 1024;

// -----------------------------------------------------------------------------
// DEGRAUS DE QUALIDADE - RESOLUCAO E BITRATE ESCOLHIDOS JUNTOS
//
// A primeira versao fixava 720p e mexia so no bitrate para acertar o alvo, com
// piso de 700 kbps. O proprio comentario de la dizia que "abaixo de ~700 kbps a
// 720p nao da para ler nada numa caixa" - e o codigo entregava exatamente isso
// em todo video acima de ~2,3 minutos, que caia no piso. Ficava o pior dos dois
// mundos: resolucao alta o suficiente para espalhar os bits, bitrate baixo
// demais para qualquer um deles estar certo. A imagem virava blocos.
//
// O que decide legibilidade nao e a resolucao sozinha, e quantos bits sobram
// POR PIXEL. Um 480p com 850 kbps tem ~0,086 bit por pixel; um 720p com os
// mesmos 850 kbps tem ~0,038. Menos pixels, mas cada um deles correto - e para
// contar caixa numa carga isso e melhor que o dobro de pixels borrados.
//
// Entao resolucao e bitrate andam juntos, em degraus. Escolhe-se o degrau MAIS
// ALTO cujo arquivo ainda caiba em VIDEO_ALVO_BYTES nesta duracao; video longo
// desce de degrau em vez de virar mingau em 720p.
//
// O ultimo degrau e piso: video muito longo passa do alvo em vez de descer
// abaixo dele. Prova ilegivel nao economiza espaco nenhum - ocupa bytes e nao
// prova nada, que e a pior troca possivel aqui.
const VIDEO_DEGRAUS = [
  { nome: '720p', lado: 1280, bitrate: 1600000 },
  { nome: '540p', lado:  960, bitrate: 1100000 },
  { nome: '480p', lado:  854, bitrate:  850000 },
  { nome: '360p', lado:  640, bitrate:  600000 }
];

// 24 em vez de 30. Num bitrate fixo todo quadro disputa os mesmos bits: a 24
// cada quadro fica com 25% mais. Carga parada num caminhao nao precisa de 30
// quadros por segundo, e precisa muito que o quadro esteja nitido.
const VIDEO_FPS = 24;

// A narracao de quem filma faz parte da prova, mas e voz - 64 kbps a entrega
// inteligivel. O padrao do navegador costuma ser 128 kbps, que a ~0,5 MB por
// minuto sai caro para nao acrescentar nada que se ouca.
//
// Declarar o audio tambem conserta a conta: antes so videoBitsPerSecond era
// informado, e o alvo era calculado como se o arquivo inteiro fosse video -
// entao a saida estourava o alvo pela fatia do audio, sempre.
const VIDEO_AUDIO_BPS = 64000;

class VideoCompressor {
  // Diz se este navegador consegue reencodar. Sem isto o app tem de dizer a
  // verdade em vez de tentar e falhar no meio.
  suportado() {
    return typeof MediaRecorder !== 'undefined'
      && typeof HTMLCanvasElement !== 'undefined'
      && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  // MP4 PRIMEIRO, E ISSO NAO E PREFERENCIA - E A DIFERENCA ENTRE UMA PROVA
  // NAVEGAVEL E UMA QUE NAO DA PARA PERCORRER.
  //
  // Medido lado a lado em 26/08/2026, gravando o mesmo conteudo nos dois:
  //
  //   video/mp4;codecs=avc1   -> duration 2.97s, seekable ate 2.97   ✓
  //   video/webm;codecs=vp9   -> duration Infinity, seekable VAZIO   ✗
  //
  // O webm do MediaRecorder nao carrega a duracao no cabecalho, e nem carregar
  // o arquivo inteiro (preload='auto') resolve. Na pratica o player mostra o
  // video mas sem barra de busca: quem quisesse conferir a caixa 7 teria de
  // assistir desde o comeco. Para prova de carregamento isso e inaceitavel.
  //
  // O webm continua na lista como rede de seguranca para navegador que nao
  // grava MP4 (Firefox) - la o video ainda vale, so perde a navegacao. Os dois
  // formatos ja estao na allowlist do bucket.
  _formato() {
    const tentativas = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    for (const t of tentativas) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  _carregarMetadados(file) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;
      v.src = URL.createObjectURL(file);
      v.onloadedmetadata = () => resolve(v);
      v.onerror = () => reject(new Error('Não foi possível ler este vídeo. O formato pode não ser suportado pelo navegador.'));
    });
  }

  // DURACAO CONFIAVEL, mesmo quando o arquivo nao a declara.
  //
  // Video gerado por MediaRecorder (celular Android gravando pelo navegador,
  // ou um arquivo que ja passou por aqui) sai com duration = Infinity ate que
  // alguem varra o arquivo inteiro. Medido em 26/08/2026: nem preload='auto'
  // resolve - continua Infinity e com seekable vazio.
  //
  // Sem isto, o compressor desistia desses arquivos ('duracao_desconhecida') e
  // devolvia o original - ou seja, justamente o video grande passava batido e
  // era recusado la na frente por tamanho. Buscar um instante absurdo obriga o
  // navegador a varrer e revelar a duracao real.
  _duracaoReal(v) {
    if (isFinite(v.duration) && v.duration > 0) return Promise.resolve(v.duration);
    return new Promise(resolve => {
      let resolvido = false;
      const terminar = d => { if (!resolvido) { resolvido = true; v.ontimeupdate = null; try { v.currentTime = 0; } catch (e) {} resolve(d); } };
      v.ontimeupdate = () => { if (isFinite(v.duration) && v.duration > 0) terminar(v.duration); };
      try { v.currentTime = 1e101; } catch (e) { terminar(NaN); }
      setTimeout(() => terminar(isFinite(v.duration) ? v.duration : NaN), 4000);
    });
  }

  // Duracao de um File solto, com o mesmo cuidado do _duracaoReal. Usada para
  // conferir a SAIDA da compressao antes de entrega-la.
  _duracaoDeArquivo(file) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const url = URL.createObjectURL(file);
      const limpar = d => { try { URL.revokeObjectURL(url); } catch (e) {} resolve(d); };
      v.onloadedmetadata = () => { this._duracaoReal(v).then(limpar); };
      v.onerror = () => limpar(NaN);
      setTimeout(() => limpar(isFinite(v.duration) ? v.duration : NaN), 8000);
      v.src = url;
    });
  }

  /**
   * Reencoda o video INTEIRO, menor. Devolve um File novo (.mp4, ou .webm onde
   * o navegador so oferece webm) ou o arquivo original quando nao vale a pena
   * / nao da para reencodar.
   *
   * onProgresso recebe 0..100 (proporcao do video ja processada).
   */
  async comprimir(file, onProgresso) {
    // Unico corte por tamanho que sobrou, e nao e sobre qualidade: a compressao
    // roda em tempo real, e nao se gasta minuto de operacao para poupar 2 MB.
    if (!file || file.size <= VIDEO_LIMIAR_COMPRIMIR) {
      return { file, comprimido: false, motivo: 'ja_cabe' };
    }
    if (!this.suportado()) {
      return { file, comprimido: false, motivo: 'navegador_sem_suporte' };
    }
    const mime = this._formato();
    if (!mime) return { file, comprimido: false, motivo: 'sem_codec' };

    let video;
    try {
      video = await this._carregarMetadados(file);
    } catch (e) {
      return { file, comprimido: false, motivo: 'nao_leu_metadados' };
    }

    const duracao = await this._duracaoReal(video);
    if (!isFinite(duracao) || duracao <= 0) {
      URL.revokeObjectURL(video.src);
      return { file, comprimido: false, motivo: 'duracao_desconhecida' };
    }

    // DEGRAU: o mais alto que ainda cabe no alvo NESTA duracao. O audio entra
    // na conta porque tambem ocupa o arquivo. Nenhum degrau coube? Fica o
    // ultimo, que e piso de legibilidade - o arquivo passa do alvo, e passar do
    // alvo e melhor que entregar prova que nao da para ler.
    const bitsAlvo = VIDEO_ALVO_BYTES * 8;
    const degrau = VIDEO_DEGRAUS.find(d => (d.bitrate + VIDEO_AUDIO_BPS) * duracao <= bitsAlvo)
                || VIDEO_DEGRAUS[VIDEO_DEGRAUS.length - 1];

    // Escala mantendo proporcao. Dimensao par: alguns encoders recusam impar.
    // Nunca AUMENTA: fonte menor que o degrau sobe do jeito que esta - inflar
    // pixel nao cria detalhe, so cria bytes.
    const par = n => Math.max(2, Math.round(n / 2) * 2);
    let largura = video.videoWidth, altura = video.videoHeight;
    const maiorLado = Math.max(largura, altura);
    if (maiorLado > degrau.lado) {
      const k = degrau.lado / maiorLado;
      largura = par(largura * k);
      altura = par(altura * k);
    } else {
      largura = par(largura);
      altura = par(altura);
    }

    // O bitrate do degrau e dimensionado para o quadro CHEIO daquele degrau. Se
    // a saida ficou menor que isso (fonte pequena, ou 4:3 em vez de 16:9), o
    // mesmo bitrate seria gordura: acompanha a proporcao de pixels realmente
    // usados, com piso para nao despencar em video minusculo.
    const pixelsDegrau = degrau.lado * (degrau.lado * 9 / 16);
    const proporcao = Math.min(1, (largura * altura) / pixelsDegrau);
    const bitrate = Math.max(350000, Math.round(degrau.bitrate * proporcao));

    // JA E ENXUTO? Aqui a decisao para de olhar tamanho e olha bitrate. Um
    // arquivo que ja chega no bitrate que sairia daqui nao tem o que ganhar
    // com uma segunda geracao de compressao - so tem o que perder, mais os
    // minutos de tempo real que a operacao ficaria esperando. A margem de 15%
    // evita reencodar de graca por uma diferenca que ninguem enxerga.
    const bitrateEntrada = (file.size * 8) / duracao;
    if (bitrateEntrada <= (bitrate + VIDEO_AUDIO_BPS) * 1.15) {
      URL.revokeObjectURL(video.src);
      return {
        file, comprimido: false, motivo: 'ja_e_enxuto',
        bitrateEntrada: Math.round(bitrateEntrada), bitrateAlvo: bitrate
      };
    }

    // Declarados FORA do try porque o finally precisa deles para desligar a
    // bomba de quadros mesmo quando algo estoura no meio — um setInterval
    // sobrevivente ficaria desenhando num canvas órfão para sempre.
    let stream;
    let intervalo = null;
    let pararDesenho = false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext('2d');
      stream = canvas.captureStream(VIDEO_FPS);

      // Reaproveita a trilha de audio do proprio arquivo: quem grava o
      // carregamento costuma narrar o que esta mostrando, e essa narracao faz
      // parte da prova.
      try {
        if (typeof video.captureStream === 'function') {
          video.captureStream().getAudioTracks().forEach(t => stream.addTrack(t));
        } else if (typeof video.mozCaptureStream === 'function') {
          video.mozCaptureStream().getAudioTracks().forEach(t => stream.addTrack(t));
        }
      } catch (e) { /* sem audio e melhor que sem video */ }

      const pedacos = [];
      const gravador = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: bitrate,
        audioBitsPerSecond: VIDEO_AUDIO_BPS
      });
      gravador.ondataavailable = e => { if (e.data && e.data.size) pedacos.push(e.data); };

      const terminou = new Promise((resolve, reject) => {
        gravador.onstop = resolve;
        gravador.onerror = () => reject(new Error('Falha ao reencodar o vídeo.'));
      });

      // O <video> precisa ficar mudo AQUI: ele vai tocar inteiro para ser
      // capturado, e sem isto a sala escuta o video da devolucao do comeco ao
      // fim. Mudo no elemento nao afeta a trilha capturada.
      video.muted = true;
      video.currentTime = 0;
      gravador.start(1000);
      await video.play();

      // BOMBA DE QUADROS - NAO USA requestAnimationFrame DE PROPOSITO.
      //
      // rAF nao dispara em aba oculta. Como a compressao roda em tempo real e
      // leva minutos, e certo que em algum momento a analista vai trocar de
      // aba para ver um e-mail - e com rAF o desenho PARA, o canvas congela no
      // ultimo quadro, e o MediaRecorder continua gravando essa imagem parada.
      // O resultado seria um video da duracao certa com a imagem travada: uma
      // prova destruida em silencio, que e o pior desfecho possivel aqui.
      //
      // requestVideoFrameCallback e o certo quando existe: dispara a cada
      // quadro REALMENTE apresentado pelo <video>, e a reproducao de midia nao
      // e suspensa em aba de fundo. O setInterval e a rede de seguranca para
      // quem nao tem (Firefox); ele e estrangulado para ~1x por segundo em
      // aba oculta, o que baixa a fluidez, mas nao congela a imagem.
      const umQuadro = () => {
        if (pararDesenho) return;
        ctx.drawImage(video, 0, 0, largura, altura);
        if (typeof onProgresso === 'function' && duracao > 0) {
          onProgresso(Math.min(99, Math.round((video.currentTime / duracao) * 100)));
        }
      };

      // Os DOIS ao mesmo tempo, de proposito. O rVFC da a fluidez quando a aba
      // esta visivel; o setInterval e o batimento que sobrevive quando ela nao
      // esta (estrangulado a ~1x por segundo, mas vivo). Desenhar o mesmo
      // quadro duas vezes nao custa nada - o canvas so e capturado quando
      // muda -, e a alternativa e o canvas congelar sem ninguem perceber.
      if (typeof video.requestVideoFrameCallback === 'function') {
        const proximo = () => {
          if (pararDesenho) return;
          umQuadro();
          video.requestVideoFrameCallback(proximo);
        };
        video.requestVideoFrameCallback(proximo);
      }
      // 30, e nao VIDEO_FPS, DE PROPOSITO: quem define a cadencia da gravacao e
      // o captureStream(VIDEO_FPS). Este batimento so precisa garantir que o
      // canvas esteja sempre atualizado quando ele for amostrado - desenhar um
      // pouco mais rapido que a captura nao custa nada, e desenhar no mesmo
      // ritmo deixaria a captura amostrar quadro velho a cada deriva de relogio.
      intervalo = setInterval(umQuadro, 1000 / 30);

      await new Promise(resolve => {
        video.onended = resolve;
        // Rede de seguranca: se 'ended' nao vier (aconteceu com arquivos de
        // duracao mal declarada), corta pelo relogio um pouco depois do fim.
        setTimeout(resolve, (duracao + 5) * 1000);
      });

      pararDesenho = true;
      if (intervalo) clearInterval(intervalo);
      if (gravador.state !== 'inactive') gravador.stop();
      await terminou;

      // Extensao e tipo seguem o formato que o navegador REALMENTE usou: um
      // .webm rotulado .mp4 seria recusado pela allowlist do bucket, que
      // confere o mimetype.
      const tipoSaida = mime.split(';')[0];
      const extensao = tipoSaida === 'video/mp4' ? '.mp4' : '.webm';
      const blob = new Blob(pedacos, { type: tipoSaida });
      const nomeBase = String(file.name || 'video').replace(/\.[^.]+$/, '');
      const novo = new File([blob], nomeBase + extensao, { type: tipoSaida });

      // Reencodar nem sempre encolhe (video ja otimizado, ou muito curto e
      // com muito movimento). Se ficou maior, o original e a melhor escolha.
      if (novo.size >= file.size) {
        return { file, comprimido: false, motivo: 'nao_encolheu' };
      }

      // CONFERENCIA OBRIGATORIA DA SAIDA - a trava mais importante deste
      // arquivo. Sem ela, este metodo ja devolveu 'comprimido: true' com um
      // arquivo de ZERO byte (medido em 26/08/2026, com a aba em segundo
      // plano: o desenho nao rodou e o MediaRecorder gravou o nada). O
      // chamador teria subido esse vazio e escrito "no servidor" na tela: a
      // prova destruida em silencio, que e o pior desfecho concebivel aqui.
      //
      // Comparar TAMANHO nao pega isso - arquivo pequeno e o objetivo. O que
      // pega e a DURACAO: se a saida e mais curta que a entrada, quadros se
      // perderam, e um video de carregamento mais curto que o original e
      // exatamente o "cortado em 8 caixas" que esta leva veio impedir.
      const duracaoSaida = await this._duracaoDeArquivo(novo);
      if (!isFinite(duracaoSaida) || duracaoSaida < duracao * 0.9) {
        return {
          file, comprimido: false, motivo: 'saida_incompleta',
          duracaoEsperada: duracao, duracaoObtida: duracaoSaida
        };
      }

      return {
        file: novo, comprimido: true, motivo: 'ok',
        antes: file.size, depois: novo.size,
        largura, altura, duracao: duracaoSaida,
        degrau: degrau.nome, bitrate, fps: VIDEO_FPS
      };
    } catch (e) {
      return { file, comprimido: false, motivo: 'falhou: ' + (e && e.message ? e.message : e) };
    } finally {
      pararDesenho = true;
      try { if (intervalo) clearInterval(intervalo); } catch (e) {}
      try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      try { video.pause(); URL.revokeObjectURL(video.src); } catch (e) {}
    }
  }
}

window.videoCompressor = new VideoCompressor();
window.JR_VIDEO_LIMIAR_COMPRIMIR = VIDEO_LIMIAR_COMPRIMIR;
window.JR_VIDEO_ALVO_BYTES = VIDEO_ALVO_BYTES;
window.JR_VIDEO_DEGRAUS = VIDEO_DEGRAUS;

window.JR_VIDEO_TETO_BYTES = VIDEO_TETO_BYTES;

// =================================================================
// EXCLUSAO DE UM ARQUIVO NO STORAGE - 26/08/2026
//
// POR QUE EXISTE. Ate aqui a midia era so-acrescimo: nao havia nenhum
// caminho no app que apagasse uma foto ou um video, nem antes nem depois
// de salvar. Quem anexasse o arquivo errado convivia com ele para sempre,
// e o volume so subia - o que pesa em tres lugares ao mesmo tempo: no
// bucket, no JSONB que volta no select=* a cada 30 segundos, e na cota do
// localStorage de cada aparelho.
//
// O QUE ELA NAO RESOLVE SOZINHA. As policies dos dois buckets tem SELECT e
// INSERT para anon e NAO tem DELETE - ausencia de policy e negacao. Enquanto
// database/migration_35_delete_evidencias_videos.sql nao rodar, o arquivo
// continua no bucket, e quem chama TEM DE DIZER ISSO NA TELA: o registro
// perde a referencia de qualquer jeito (a midia some das telas), mas o
// arquivo segue ocupando espaco - e mentir sobre isso seria pior do que nao
// ter o botao.
//
// A ARMADILHA QUE ISSO ESCONDE, medida contra o bucket real em 26/08/2026
// (subindo um arquivo de teste e tentando apaga-lo): o status HTTP NAO serve
// para decidir nada aqui. O storage responde 400 nos DOIS casos, e quem
// distingue e so o CORPO:
//
//   arquivo existe, sem policy de DELETE
//     HTTP 400  {"statusCode":"403","error":"Unauthorized","code":"AccessDenied"}
//   arquivo nao existe
//     HTTP 400  {"statusCode":"404","error":"not_found","code":"NoSuchKey"}
//
// Nao ha 403 nenhum na linha de status - so dentro do JSON. Uma leitura
// ingenua (`if (resp.status === 403)`) nunca dispara, e o reflexo seguinte -
// tratar 400/not_found como "ja nao existia" - faria a tela anunciar
// "removida do servidor" justamente nos casos em que o arquivo ficou la.
//
// Alem de ler o corpo, quando ele diz not_found a funcao CONFERE: os dois
// buckets sao publicos para leitura, entao um GET na URL publica responde a
// pergunta de verdade. Ainda responde -> era permissao. Sumiu -> estava certo.
// =================================================================
window.jrExcluirObjetoStorage = async function(urlOuCaminho) {
  const cfg = (window.JR_CONFIG && window.JR_CONFIG.supabase) || {};
  const alvo = String(urlOuCaminho || '');

  // base64 nao tem arquivo no servidor: sair do array JA e a exclusao inteira.
  if (!alvo || alvo.startsWith('data:')) return { ok: true, motivo: 'nao_e_arquivo' };
  if (!cfg.url || !cfg.anonKey) return { ok: false, motivo: 'sem_config' };

  // .../storage/v1/object/public/<bucket>/<caminho...>
  const m = alvo.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
  if (!m) return { ok: false, motivo: 'url_nao_reconhecida' };
  const bucket = m[1];
  const caminho = m[2].split('?')[0];

  // O arquivo ainda responde na URL publica? Cache-buster e no-store porque o
  // upload grava Cache-Control de um ano: sem isso o navegador responderia da
  // propria memoria e diria "existe" para um arquivo recem-apagado.
  const aindaExiste = async () => {
    try {
      const r = await fetch(
        cfg.url + '/storage/v1/object/public/' + bucket + '/' + caminho + '?conferencia=' + Date.now(),
        { method: 'GET', headers: { 'Range': 'bytes=0-0' }, cache: 'no-store' }
      );
      return r.ok || r.status === 206;
    } catch (e) {
      return null;   // sem rede: nao da para afirmar nada
    }
  };

  try {
    const resp = await fetch(cfg.url + '/storage/v1/object/' + bucket + '/' + caminho, {
      method: 'DELETE',
      headers: { 'apikey': cfg.anonKey, 'Authorization': 'Bearer ' + cfg.anonKey }
    });

    if (resp.ok) return { ok: true, motivo: 'removido', bucket, caminho };

    let corpo = '';
    try { corpo = await resp.text(); } catch (e) {}

    // Negacao explicita - o caso de hoje, enquanto a migration 35 nao roda.
    if (resp.status === 401 || resp.status === 403
        || /AccessDenied|Unauthorized|"statusCode":"40[13]"/i.test(corpo)) {
      return { ok: false, motivo: 'sem_permissao', bucket, caminho, status: resp.status, corpo: corpo.slice(0, 200) };
    }

    // "Nao achei" pode ser verdade ou pode ser RLS escondendo. Confere.
    if (resp.status === 404 || /NoSuchKey|not_found|Object not found/i.test(corpo)) {
      const existe = await aindaExiste();
      if (existe === true)  return { ok: false, motivo: 'sem_permissao', bucket, caminho, status: resp.status };
      if (existe === false) return { ok: true, motivo: 'ja_nao_existia', bucket, caminho };
      return { ok: false, motivo: 'nao_confirmado', bucket, caminho, status: resp.status };
    }

    return { ok: false, motivo: 'http_' + resp.status, bucket, caminho, status: resp.status, corpo: corpo.slice(0, 200) };
  } catch (e) {
    return { ok: false, motivo: 'sem_rede', bucket, caminho };
  }
};
