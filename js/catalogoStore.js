// =================================================================
// CATÁLOGO MESTRE (CLIENTES E PRODUTOS): FORA DO localStorage
//
// POR QUE ESTE ARQUIVO EXISTE
//
// O localStorage é limitado a ~5 MB POR ORIGEM pelo navegador — não pelo
// disco. Medido em produção em 31/08/2026, um aparelho do CD estava com
// 5.020 KB (98%) e a tarja vermelha de "o último registro NÃO foi salvo"
// aparecendo na tela. A conta de onde estavam esses 5 MB:
//
//   jr_sac_static      ~2.994 KB   clientes (15.139) + produtos (4.010)
//   jr_sac_db              ... KB  a fatia operacional — A VERDADE local
//   25 chaves-espelho      ... KB  segunda cópia do operacional
//
// Ou seja: SESSENTA POR CENTO da cota do aparelho era o catálogo. E o
// catálogo é a parte que menos precisava estar ali, porque ele JÁ VEM
// EMBARCADO em js/mockData.js (3,1 MB), que o navegador baixa e guarda no
// cache de ARQUIVOS — que não tem limite de 5 MB e não disputa cota com
// nada. O aparelho guardava, dentro do balde pequeno, uma segunda cópia de
// algo que já estava no balde grande.
//
// O QUE MUDA
//
// A partir daqui o localStorage não guarda mais o catálogo, e sim só o
// DELTA — o que este aparelho tem de DIFERENTE da planilha embarcada:
//
//   - registros cadastrados pela tela (cliente/produto novo);
//   - registros da planilha que foram EDITADOS aqui;
//   - registros da planilha que foram EXCLUÍDOS aqui (lápide por id).
//
// Numa instalação recém-migrada esse delta é ZERO byte. Depois de mil
// cadastros manuais ele ainda está na casa das dezenas de KB, contra os
// 2.994 KB de antes. A lista completa continua idêntica em tela: ela é
// montada em memória a cada abertura, semente + delta.
//
// POR QUE INDEXEDDB, E POR QUE AINDA ASSIM UM ESPELHO NO localStorage
//
// O IndexedDB é a casa DEFINITIVA do delta: balde próprio, na casa das
// centenas de MB, e que continua gravável mesmo com o localStorage no
// talo — é ele que garante que "cadastrei um cliente" nunca mais dependa
// da cota que acabou de estourar. Mesmo raciocínio da fila de fotos (ver
// o cabeçalho de js/fotoStore.js).
//
// Só que o IndexedDB é ASSÍNCRONO, e o app monta a tela de forma síncrona
// (js/store.js: o construtor chama init()). Esperar o IndexedDB no boot
// significaria tela em branco por alguns milissegundos e — pior — um
// caminho novo de falha logo no início. Então o delta também é espelhado no
// localStorage, na chave 'jr_sac_static_delta', ENQUANTO FOR PEQUENO: é o
// que faz o boot continuar síncrono. Quando ele cresce além de
// CAT_LIMITE_ESPELHO_KB o espelho é abandonado e o IndexedDB passa a ser o
// único lugar — que é exatamente o comportamento desejado, porque a partir
// daí a cota do localStorage deixa de ser o teto do cadastro.
//
// A ORDEM É DE PROPÓSITO: síncrono primeiro (tela usável já), IndexedDB
// depois (verdade completa). js/store.js reaplica o delta e redesenha se o
// que veio do IndexedDB for diferente do que já estava em tela.
//
// DEPENDE DE: nada. Carrega ANTES de js/store.js, que o consome em init().
// =================================================================

const CAT_DB_NOME    = 'jr_catalogo';
const CAT_DB_VERSAO  = 1;
const CAT_STORE      = 'delta';
const CAT_REGISTRO   = 'atual';                 // um registro só, sempre o mesmo

// O espelho síncrono no localStorage. Enquanto o delta couber aqui, o boot
// não espera o IndexedDB.
const CAT_CHAVE_ESPELHO     = 'jr_sac_static_delta';
const CAT_LIMITE_ESPELHO_KB = 300;

// Chave antiga, do formato "catálogo inteiro no localStorage". Só é lida
// uma vez, para virar delta, e apagada em seguida — é ela que devolve os
// ~2,9 MB ao aparelho.
const CAT_CHAVE_LEGADA = 'jr_sac_static';

class CatalogoStore {

  constructor() {
    this._db = null;
    this._falhaAoGravar = null;
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
      const req = indexedDB.open(CAT_DB_NOME, CAT_DB_VERSAO);
      req.onupgradeneeded = e => {
        const bd = e.target.result;
        if (!bd.objectStoreNames.contains(CAT_STORE)) {
          bd.createObjectStore(CAT_STORE, { keyPath: 'chave' });
        }
      };
      req.onsuccess = e => {
        this._db = e.target.result;
        // Se outra aba pedir uma versão nova, esta solta o banco em vez de
        // travar a atualização com um bloqueio invisível (mesmo cuidado de
        // js/fotoStore.js).
        this._db.onversionchange = () => { try { this._db.close(); } catch (x) {} this._db = null; };
        resolve(this._db);
      };
      req.onerror = () => reject(req.error || new Error('Falha ao abrir o IndexedDB do catálogo.'));
    });
  }

  // ---------------------------------------------------------------
  // O DELTA: o que este aparelho tem de diferente da planilha embarcada
  //
  // Formato:
  //   { carimbo, clientes: [...], produtos: [...],
  //     removidos: { clientes: [ids], produtos: [ids] } }
  //
  // `clientes`/`produtos` trazem o registro INTEIRO — tanto o que foi
  // cadastrado aqui quanto o da planilha que foi editado aqui. Guardar só
  // "o campo que mudou" economizaria bytes que não estão faltando e
  // custaria uma classe inteira de bug de mesclagem parcial.
  //
  // `removidos` é a lápide: id que ESTÁ na planilha e NÃO está mais na
  // lista deste aparelho. Sem ela, a exclusão definitiva de um cliente da
  // planilha seria desfeita no próximo F5 — a semente o traria de volta.
  // (A exclusão LÓGICA, que é o caminho normal do app, não precisa de
  // lápide: ela é uma edição, o registro continua na lista com
  // is_deleted = true, e cai no bloco de editados acima.)
  // ---------------------------------------------------------------
  static _indexarPorId(lista) {
    const mapa = new Map();
    (Array.isArray(lista) ? lista : []).forEach(r => {
      if (r && r.id !== undefined && r.id !== null) mapa.set(String(r.id), r);
    });
    return mapa;
  }

  static _deltaDeUmaColecao(atual, semente) {
    const naSemente = CatalogoStore._indexarPorId(semente);
    const alterados = [];
    const idsAtuais = new Set();

    (Array.isArray(atual) ? atual : []).forEach(r => {
      if (!r || r.id === undefined || r.id === null) {
        // Registro sem id não tem como ser casado com a semente: vai
        // inteiro para o delta, senão sumiria no próximo boot.
        alterados.push(r);
        return;
      }
      const id = String(r.id);
      idsAtuais.add(id);
      const original = naSemente.get(id);
      if (!original || JSON.stringify(original) !== JSON.stringify(r)) alterados.push(r);
    });

    const removidos = [];
    naSemente.forEach((_, id) => { if (!idsAtuais.has(id)) removidos.push(id); });

    return { alterados, removidos };
  }

  static calcularDelta(atual, semente) {
    const a = atual || {}, s = semente || {};
    const cli = CatalogoStore._deltaDeUmaColecao(a.clientes, s.clientes);
    const pro = CatalogoStore._deltaDeUmaColecao(a.produtos, s.produtos);
    return {
      carimbo: (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString(),
      clientes: cli.alterados,
      produtos: pro.alterados,
      removidos: { clientes: cli.removidos, produtos: pro.removidos }
    };
  }

  static _aplicarEmUmaColecao(semente, alterados, removidos) {
    const substitui = CatalogoStore._indexarPorId(alterados);
    const apagados = new Set((removidos || []).map(String));
    const saida = [];
    const usados = new Set();

    // 1) a planilha, na ordem dela, com as edições aplicadas e as
    //    exclusões definitivas puladas.
    (Array.isArray(semente) ? semente : []).forEach(r => {
      if (!r || r.id === undefined || r.id === null) { saida.push(r); return; }
      const id = String(r.id);
      if (apagados.has(id)) return;
      if (substitui.has(id)) { saida.push(substitui.get(id)); usados.add(id); return; }
      // Cópia própria: quem chama edita `db.data.clientes` à vontade, e a
      // semente (INITIAL_DATA) precisa continuar intocada — ela é a régua
      // contra a qual o delta é calculado no save() seguinte.
      saida.push(JSON.parse(JSON.stringify(r)));
    });

    // 2) o que foi cadastrado aqui e não existe na planilha.
    //
    // A checagem de `apagados` se repete aqui de propósito. Um id pode
    // aparecer nas DUAS listas quando o registro foi apagado em definitivo
    // neste aparelho e voltou depois pela nuvem (outro aparelho ainda o
    // tinha). Sem esta linha, o passo 1 pularia o registro e o passo 2 o
    // empurraria de volta — a exclusão valeria ou não dependendo da ordem
    // da lista. Com ela, `removidos` é a palavra final enquanto existir; e
    // quem apaga a lápide quando a nuvem manda o registro de volta é o
    // recálculo do delta em store.js:aplicarCatalogoDaNuvem().
    (Array.isArray(alterados) ? alterados : []).forEach(r => {
      const id = (r && r.id !== undefined && r.id !== null) ? String(r.id) : null;
      if (id === null) { saida.push(r); return; }
      if (apagados.has(id)) return;
      if (!usados.has(id)) saida.push(r);
    });

    return saida;
  }

  static aplicar(semente, delta) {
    const s = semente || {};
    const d = delta || {};
    const rem = d.removidos || {};
    return {
      clientes: CatalogoStore._aplicarEmUmaColecao(s.clientes, d.clientes, rem.clientes),
      produtos: CatalogoStore._aplicarEmUmaColecao(s.produtos, d.produtos, rem.produtos)
    };
  }

  static deltaVazio(delta) {
    if (!delta) return true;
    const rem = delta.removidos || {};
    return (delta.clientes || []).length === 0
        && (delta.produtos || []).length === 0
        && (rem.clientes || []).length === 0
        && (rem.produtos || []).length === 0;
  }

  // ---------------------------------------------------------------
  // LEITURA SÍNCRONA — é ela que mantém o boot instantâneo.
  // Devolve null quando este aparelho ainda não tem delta nenhum, e um
  // objeto com { soIdb: true } quando o delta existe mas cresceu além do
  // espelho (aí só o IndexedDB tem a lista completa).
  // ---------------------------------------------------------------
  lerSincrono() {
    try {
      const raw = localStorage.getItem(CAT_CHAVE_ESPELHO);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return (d && typeof d === 'object') ? d : null;
    } catch (e) {
      return null;
    }
  }

  // O catálogo no formato antigo (chave única de ~2,9 MB), se ainda existir
  // neste aparelho. Ler isto é a ÚNICA razão pela qual a chave antiga ainda
  // é tocada — logo depois ela é apagada por descartarFormatoAntigo().
  lerFormatoAntigo() {
    try {
      const raw = localStorage.getItem(CAT_CHAVE_LEGADA);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return null;
      if (!Array.isArray(d.clientes) && !Array.isArray(d.produtos)) return null;
      return { clientes: d.clientes || [], produtos: d.produtos || [] };
    } catch (e) {
      return null;
    }
  }

  descartarFormatoAntigo() {
    try {
      const raw = localStorage.getItem(CAT_CHAVE_LEGADA);
      if (raw === null) return 0;
      const kb = Math.round(raw.length / 1024);
      localStorage.removeItem(CAT_CHAVE_LEGADA);
      console.info('[Catalogo] Formato antigo descartado: ' + kb + ' KB devolvidos à cota deste aparelho. '
        + 'O catálogo continua completo — ele vem de js/mockData.js, que não gasta cota.');
      return kb;
    } catch (e) {
      return 0;
    }
  }

  // ---------------------------------------------------------------
  // LEITURA COMPLETA (assíncrona) — a verdade, direto do IndexedDB.
  // ---------------------------------------------------------------
  carregar() {
    if (!this.disponivel()) return Promise.resolve(this.lerSincrono());
    return this.abrir()
      .then(bd => new Promise((resolve, reject) => {
        const req = bd.transaction(CAT_STORE, 'readonly').objectStore(CAT_STORE).get(CAT_REGISTRO);
        req.onsuccess = () => resolve(req.result ? req.result.delta : null);
        req.onerror = () => reject(req.error || new Error('Falha ao ler o catálogo local.'));
      }))
      .catch(e => {
        console.warn('[Catalogo] IndexedDB indisponível na leitura — usando o espelho do localStorage.', e && e.message);
        return this.lerSincrono();
      });
  }

  // ---------------------------------------------------------------
  // GRAVAÇÃO
  //
  // O espelho do localStorage é gravado de forma SÍNCRONA e o IndexedDB em
  // seguida. A ordem importa: o espelho é o que o próximo boot lê antes de
  // qualquer promise resolver, então ele precisa estar certo mesmo que a
  // aba seja fechada no instante seguinte.
  //
  // Se o espelho não couber (cota estourada por OUTRA coisa) isso NÃO é
  // falha: o IndexedDB continua sendo a casa definitiva, e o boot seguinte
  // só espera um ciclo a mais para mostrar o delta. É o oposto do que
  // acontecia antes, quando a cota cheia significava cadastro perdido.
  // ---------------------------------------------------------------
  gravar(delta) {
    const serial = JSON.stringify(delta || {});
    const kb = serial.length / 1024;

    try {
      if (kb <= CAT_LIMITE_ESPELHO_KB) {
        localStorage.setItem(CAT_CHAVE_ESPELHO, serial);
      } else {
        // Grande demais para o balde pequeno. Deixa a marca para o boot
        // saber que EXISTE delta e que ele só chega pelo IndexedDB — sem
        // ela, o boot montaria a lista só com a semente e um save()
        // seguinte calcularia um delta que apaga tudo que foi cadastrado.
        localStorage.setItem(CAT_CHAVE_ESPELHO,
          JSON.stringify({ soIdb: true, carimbo: (delta && delta.carimbo) || null }));
      }
    } catch (e) {
      console.warn('[Catalogo] O espelho síncrono não coube no localStorage — o IndexedDB segue valendo.', e && e.message);
    }

    if (!this.disponivel()) {
      // Sem IndexedDB (navegador antigo, aba anônima travada) o espelho é
      // tudo o que existe. Se ele também não coube, aí sim houve perda —
      // e quem precisa saber é a tarja do store.
      this._falhaAoGravar = (kb > CAT_LIMITE_ESPELHO_KB)
        ? { detalhe: 'Sem IndexedDB e delta maior que o espelho.', quando: new Date().toISOString() }
        : null;
      return Promise.resolve(!this._falhaAoGravar);
    }

    return this.abrir()
      .then(bd => new Promise((resolve, reject) => {
        const tx = bd.transaction(CAT_STORE, 'readwrite');
        const req = tx.objectStore(CAT_STORE).put({ chave: CAT_REGISTRO, delta: delta || {} });
        req.onerror = () => reject(req.error || new Error('Falha ao gravar o catálogo local.'));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Transação do catálogo recusada.'));
      }))
      .then(() => { this._falhaAoGravar = null; return true; })
      .catch(e => {
        this._falhaAoGravar = {
          detalhe: String((e && e.message) || e || 'desconhecido').slice(0, 200),
          quando: (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString()
        };
        console.error('[Catalogo] NÃO foi possível gravar o cadastro de cliente/produto neste aparelho.', this._falhaAoGravar);
        return false;
      });
  }

  limparTudo() {
    try { localStorage.removeItem(CAT_CHAVE_ESPELHO); } catch (e) {}
    try { localStorage.removeItem(CAT_CHAVE_LEGADA); } catch (e) {}
    if (!this.disponivel()) return Promise.resolve(true);
    return this.abrir()
      .then(bd => new Promise((resolve, reject) => {
        const tx = bd.transaction(CAT_STORE, 'readwrite');
        tx.objectStore(CAT_STORE).delete(CAT_REGISTRO);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Falha ao limpar o catálogo local.'));
      }))
      .catch(e => { console.warn('[Catalogo] Falha ao limpar:', e && e.message); return false; });
  }

  // Diagnóstico: quanto o catálogo custa hoje de cota, e onde ele mora.
  getDiagnostico() {
    let espelhoKB = 0, legadoKB = 0;
    try { espelhoKB = Math.round((localStorage.getItem(CAT_CHAVE_ESPELHO) || '').length / 1024); } catch (e) {}
    try { legadoKB  = Math.round((localStorage.getItem(CAT_CHAVE_LEGADA)  || '').length / 1024); } catch (e) {}
    return {
      indexedDB: this.disponivel(),
      espelhoKB,
      // Se isto vier diferente de 0, este aparelho ainda não abriu o app
      // nesta versão — são os ~2,9 MB que a migração devolve.
      formatoAntigoAindaPresenteKB: legadoKB,
      ultimaFalhaAoGravar: this._falhaAoGravar
    };
  }
}

if (typeof window !== 'undefined') {
  window.CatalogoStore = CatalogoStore;
  window.catalogoStore = new CatalogoStore();
}
