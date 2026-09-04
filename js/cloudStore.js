// =================================================================
// CAMADA DE INTEGRAÇÃO COM BANCO DE DADOS NA NUVEM (SUPABASE)
// Sincronização bidirecional em tempo real - Multidispositivo
// JR Oper v4.7 - Custo Zero
// =================================================================

class CloudStore {
  constructor() {
    // Tenta carregar configurações salvas no próprio aparelho
    this._loadSavedConfig();
    this._syncTimer = null;
    this._statusListeners = [];
    this._connectionStatus = 'offline'; // 'offline' | 'connecting' | 'online'

    // Tabelas que têm dados locais ainda não aceitos pela nuvem. Alimentado
    // pelo upsert() quando o POST é recusado e pelo pull quando encontra a
    // nuvem vazia com dados locais presentes. Serve para (a) reenviar e
    // (b) mostrar o problema na tela em vez de escondê-lo no console.
    this._tabelasPendentesDeEnvio = new Set();
    this._ultimoErroSync = null;
    // Preenchido pela guarda na escrita (item 7): quantos registros de
    // cache contaminado este aparelho tentou empurrar. Zero em aparelho
    // limpo — qualquer número aqui identifica a máquina da ETAPA 3.
    this._bloqueadosNaEscrita = null;

    // ATRASO ENTRE APARELHOS (28/08/2026) — ver o comentário grande em
    // syncCloudToLocal() e o bloco "SINCRONIZA AO VOLTAR PARA A TELA" no
    // fim do arquivo.
    //   _pullEmAndamento    a Promise do pull que está rodando agora, ou
    //                       null. Serve de trava de reentrância: um ciclo
    //                       leva 25+ requisições e pode passar dos 30s do
    //                       timer, e dois pulls simultâneos sobre as mesmas
    //                       chaves são uma corrida, não o dobro da rapidez.
    //   _ultimoPullOkMs     Date.now() do último pull que terminou. É o que
    //                       responde "há quanto tempo esta tela é verdade?"
    //                       no tooltip do indicador de nuvem.
    this._pullEmAndamento = null;
    this._ultimoPullOkMs = 0;

    // Preenchido por _gravarCacheDoPull() quando o aparelho não consegue
    // mais guardar o que baixa da nuvem (cota cheia). Enquanto está
    // preenchido, a tela está certa mas o cache está para trás: um F5
    // devolve o aparelho ao retrato velho.
    this._falhaAoGravarCache = null;

    // Ligado quando a cota estoura ao gravar um espelho. A partir daí este
    // aparelho para de manter as cópias de diagnóstico e usa o espaço para
    // o dado real. Ver _gravarEspelho().
    this._espelhosSuspensos = false;
  }

  // ---------------------------------------------------------------
  // FALHA DE SINCRONIZAÇÃO VISÍVEL
  // (achado de 21/08/2026) Antes, todo erro de POST virava apenas um
  // console.warn(). Nenhum usuário abre o console — então o sistema
  // passou semanas "funcionando", com o indicador da nuvem verde, sem
  // que uma única devolução, ocorrência de rota ou linha de auditoria
  // chegasse ao banco. Silêncio em falha de escrita é o defeito mais
  // caro deste projeto; agora ela sobe para o indicador de status.
  // ---------------------------------------------------------------
  _registrarFalhaSync(tableName, status, corpo) {
    this._tabelasPendentesDeEnvio.add(tableName);
    let detalhe = corpo;
    try {
      const j = JSON.parse(corpo);
      detalhe = j.message || j.hint || corpo;
    } catch(e) {}
    this._ultimoErroSync = {
      tabela: tableName,
      status,
      detalhe: String(detalhe || '').slice(0, 300),
      quando: agoraIsoBrasilia()
    };
    console.error(`[CloudStore] FALHA AO SALVAR NA NUVEM — ${tableName} (HTTP ${status}): ${this._ultimoErroSync.detalhe}`);
    this._setStatus(this._connectionStatus); // repinta o indicador com o alerta
  }

  // ---------------------------------------------------------------
  // GRAVA O CACHE DO PULL, E GRITA SE NÃO CONSEGUIR (28/08/2026)
  //
  // O caminho de ESCRITA do app (store.js:save()) já tratava estouro de
  // cota há tempos: libera espaço de auditoria, tenta de novo, e se ainda
  // assim falhar acende uma tarja vermelha fixa na tela
  // (_alertarFalhaDeGravacao). O caminho de LEITURA não tinha nada disso —
  // era um `catch(e) {}` vazio. A mesma cota cheia, no mesmo aparelho, era
  // barulhenta ao salvar e muda ao baixar.
  //
  // Aqui a leitura passa a usar exatamente a mesma escada do save(), e a
  // falha final vai para o indicador de nuvem em vez de para lugar nenhum.
  // ---------------------------------------------------------------
  _gravarCacheDoPull(fullDb) {
    const payload = JSON.stringify(fullDb);
    try {
      localStorage.setItem('jr_sac_db', payload);
      this._falhaAoGravarCache = null;
      return true;
    } catch (e) {
      console.warn('[CloudStore] Cota estourada ao gravar o que veio da nuvem — tentando liberar espaço.', e.message);

      // ORDEM IMPORTA: primeiro as CÓPIAS, depois o histórico.
      // Os espelhos são duplicata pura do que está aqui mesmo neste
      // payload; o histórico de auditoria é dado que só existe uma vez.
      // Jogar fora cópia antes de jogar fora original.
      let liberou = this._purgarEspelhos() > 0;
      if (liberou) this._espelhosSuspensos = true;
      try {
        if (window.db && typeof window.db.pruneOldAuditData === 'function'
            && window.db.pruneOldAuditData()) liberou = true;
      } catch (ePrune) {
        console.warn('[CloudStore] Falha ao liberar espaço:', ePrune);
      }

      if (liberou) {
        try {
          localStorage.setItem('jr_sac_db', payload);
          console.info('[CloudStore] Cache da nuvem gravado após liberar espaço (histórico de auditoria reduzido).');
          this._falhaAoGravarCache = null;
          return true;
        } catch (e2) { /* cai no registro de falha abaixo */ }
      }

      // Desistiu. A TELA continua certa (a memória foi atualizada antes de
      // chegar aqui), mas este aparelho não consegue mais guardar o que
      // baixa: ao recarregar, volta para o retrato velho. Isso precisa
      // aparecer, e some sozinho no primeiro ciclo que conseguir gravar.
      this._falhaAoGravarCache = {
        detalhe: String((e && e.message) || e || 'desconhecido').slice(0, 200),
        // Chamada defensiva: este é o tratador de uma falha, e ele não pode
        // ser o próximo a estourar. A bancada carrega o cloudStore sem o
        // config.js, onde agoraIsoBrasilia() não existe.
        quando: (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString()
      };
      console.error('[CloudStore] ARMAZENAMENTO CHEIO — os dados baixados da nuvem não couberam neste aparelho.',
                    this._falhaAoGravarCache);

      // Reaproveita a tarja vermelha que o save() já sabe desenhar.
      try {
        if (window.db && typeof window.db._alertarFalhaDeGravacao === 'function') {
          window.db._alertarFalhaDeGravacao(e);
        }
      } catch (eTarja) {}

      this._setStatus(this._connectionStatus);   // repinta o indicador
      return false;
    }
  }

  // ---------------------------------------------------------------
  // ESPELHO: SEGUNDA CÓPIA, PRIMEIRA A SER SACRIFICADA (28/08/2026)
  //
  // POR QUE O APARELHO ENCHE. localStorage é limitado a ~5 MB POR ORIGEM
  // pelo navegador — não pelo disco. Uma máquina com 1 TB livre continua
  // tendo 5 MB aqui, e é por isso que "a máquina tem espaço de sobra" não
  // resolve. Dentro desses 5 MB este app guarda:
  //
  //   jr_sac_db          ...    a fatia operacional — A VERDADE local
  //   25 chaves-espelho  ...    UMA SEGUNDA CÓPIA INTEIRA da mesma coisa
  //
  // Ou seja: o operacional cabe duas vezes na mesma cota, e o espelho é a
  // cópia. Quando falta espaço, sacrificar a cópia é a decisão óbvia — o
  // espelho se reconstrói sozinho no próximo pull que couber, e nenhum
  // dado de negócio mora só nele.
  //
  // 31/08/2026: o maior item desta lista saiu dela. 'jr_sac_static'
  // (~2,9 MB de clientes e produtos, 60% da cota) deixou de existir — o
  // catálogo vem de js/mockData.js, que mora no cache de ARQUIVOS, e só o
  // delta do aparelho é persistido, no IndexedDB. Ver js/catalogoStore.js.
  // Com isso o aperto de cota deixou de ser rotina, mas a duplicação do
  // operacional continua de pé e continua sendo o próximo item.
  //
  // Ao estourar, purgamos TODOS os espelhos de uma vez em vez de só o que
  // falhou: liberar 40 KB para a próxima tabela estourar em seguida seria
  // trocar uma tabela congelada por outra. Purgar tudo devolve o espaço do
  // operacional inteiro de uma vez, e é o que faz o jr_sac_db do fim do
  // pull voltar a caber.
  // ---------------------------------------------------------------
  _gravarEspelho(localKey, conteudo) {
    if (this._espelhosSuspensos) return false;
    try {
      localStorage.setItem(localKey, conteudo);
      return true;
    } catch (e) {
      console.warn(`[CloudStore] Espelho ${localKey} não coube — liberando as cópias para o dado real caber.`, e.message);
      this._espelhosSuspensos = true;
      this._purgarEspelhos();
      return false;
    }
  }

  _purgarEspelhos() {
    let removidos = 0;
    try {
      for (const m of CloudStore.MAPA_TABELAS) {
        if (localStorage.getItem(m.localKey) !== null) {
          localStorage.removeItem(m.localKey);
          removidos++;
        }
      }
    } catch (e) {
      console.warn('[CloudStore] Falha ao liberar os espelhos:', e);
    }
    if (removidos) {
      console.info(`[CloudStore] ${removidos} cópia(s) de diagnóstico removida(s) para liberar espaço. `
        + 'Nenhum dado de negócio foi perdido: elas são cópia do jr_sac_db e voltam sozinhas quando houver folga.');
    }
    return removidos;
  }

  // Diagnóstico rápido: chame jrDiagnosticoSync() no console do navegador.
  getDiagnostico() {
    return {
      // Confira ANTES de rodar o Reset Global: todo aparelho precisa estar
      // nesta build. Um aparelho com código antigo não conhece o carimbo de
      // reset e reenvia o que foi apagado — foi o que trouxe a DEV-2026-001
      // de volta em 22/08/2026.
      buildSync: CloudStore.BUILD,
      resetAplicado: Number(localStorage.getItem('jr_reset_epoch') || 0) || null,
      configurado: this.isConfigured(),
      status: this._connectionStatus,
      tabelasComPendencia: [...this._tabelasPendentesDeEnvio],
      ultimoErro: this._ultimoErroSync,
      // Item 7 (22/08/2026): registros recusados no envio por terem estado
      // de checklist no lugar da data de saída. Ver _aplicarGuardaDeEscrita.
      bloqueadosNaEscrita: this._bloqueadosNaEscrita,
      // 28/08/2026 — o que responder quando dois aparelhos mostram coisas
      // diferentes. Rode jrDiagnosticoSync() nos dois e compare a IDADE: o
      // que estiver com segundosDesdeUltimaAtualizacao alto é o atrasado,
      // e não há por que procurar defeito no outro.
      ultimaAtualizacaoDaNuvem: this._ultimoPullOkMs
        ? new Date(this._ultimoPullOkMs).toLocaleTimeString('pt-BR')
        : null,
      segundosDesdeUltimaAtualizacao: this._ultimoPullOkMs
        ? Math.round((Date.now() - this._ultimoPullOkMs) / 1000)
        : null,
      pullEmAndamento: !!this._pullEmAndamento,
      // 28/08/2026 — A PERGUNTA QUE FALTAVA: "de qual registro esta máquina
      // está discordando da nuvem?". Enquanto vier vazio, o que a tela
      // mostra é o que a nuvem tem. Se vier com ids, são exatamente os
      // registros em que este aparelho está impondo a versão dele.
      recusandoDaNuvem: this._recusandoDaNuvem || {},
      // 28/08/2026 — se vier preenchido, este aparelho não consegue mais
      // guardar o que baixa: a tela está certa agora e volta a ficar velha
      // no próximo F5. É a explicação de "mesma versão, números diferentes".
      armazenamentoCheio: this._falhaAoGravarCache,
      // true = este aparelho abriu mão das cópias de diagnóstico para o
      // dado real caber nos ~5 MB de localStorage. Não é perda de dado;
      // é o sinal de que a cota está no limite neste aparelho.
      espelhosSuspensos: !!this._espelhosSuspensos,
      // 31/08/2026 — cadastro de cliente/produto. Se `indisponivel` vier
      // preenchido, a migration_36 não está aplicada NESTE banco e nenhum
      // cadastro novo viaja entre aparelhos. `cursor` é até onde este
      // aparelho já leu; ele avança sozinho a cada cadastro que chega.
      catalogo: {
        indisponivel: this._catalogoIndisponivel || null,
        cursor: this._cursorDoCatalogo(),
        delta: (() => {
          try {
            if (!window.db || typeof window.db.getCatalogoParaSync !== 'function') return null;
            const d = window.db.getCatalogoParaSync();
            return { clientes: (d.clientes || []).length, produtos: (d.produtos || []).length };
          } catch(e) { return null; }
        })()
      },
      usoDoArmazenamento: (() => {
        try {
          return (window.db && window.db.getStorageUsageInfo) ? window.db.getStorageUsageInfo() : null;
        } catch(e) { return null; }
      })()
    };
  }

  // ---------------------------------------------------------------
  // CONFIGURAÇÃO: lê do config.js OU do que foi salvo pelo usuário
  // ---------------------------------------------------------------
  _loadSavedConfig() {
    const base = (window.JR_CONFIG && window.JR_CONFIG.supabase) || {};
    
    // Prioridade: o que o usuário salvou no painel > o que está no config.js
    const saved = {};
    try {
      const raw = localStorage.getItem('jr_cloud_config');
      if (raw) Object.assign(saved, JSON.parse(raw));
    } catch(e) {}

    this.config = {
      url: saved.url || base.url || '',
      anonKey: saved.anonKey || base.anonKey || '',
      syncIntervalMs: base.syncIntervalMs || 30000
    };

    // Atualiza o modo global baseado na configuração disponível
    if (window.JR_CONFIG) {
      window.JR_CONFIG.mode = this.isConfigured() ? 'cloud' : 'local';
    }
  }

  // Salva as chaves no aparelho atual para não precisar redigitar
  saveConfig(url, anonKey) {
    const isFirstActivation = !this.isConfigured();
    this.config.url = url.trim().replace(/\/$/, ''); // remove barra final
    this.config.anonKey = anonKey.trim();
    try {
      localStorage.setItem('jr_cloud_config', JSON.stringify({
        url: this.config.url,
        anonKey: this.config.anonKey
      }));
    } catch(e) {}
    if (window.JR_CONFIG) {
      window.JR_CONFIG.mode = this.isConfigured() ? 'cloud' : 'local';
    }

    // Na primeira vez que ativa a nuvem, zera os dados transacionais de exemplo
    // Os dados mestre (motoristas, veículos, rotas, usuários) são mantidos
    if (isFirstActivation) {
      this._clearTransactionalData();
    }
  }

  // Zera apenas os dados de ocorrências/viagens (não apaga motoristas, veículos, etc.)
  _clearTransactionalData() {
    const transactionalKeys = [
      'ocorrencias_devolucao',
      'itens_devolucao',
      'ocorrencias_rota',
      'relatorios_divergencia',
      'auditoria_produtividade',
      'controle_viagens',
      'ocorrencias_viagens',
      'resumo_diario_cd',
      'trocas_veiculos',
      'retencoes_frota',
      'reentregas',
      'audit_logs',
      'registro_versoes',
      'cargas'
    ];

    try {
      const rawDb = localStorage.getItem('jr_sac_db');
      if (rawDb) {
        const db = JSON.parse(rawDb);
        transactionalKeys.forEach(key => {
          if (Array.isArray(db[key])) db[key] = [];
        });
        localStorage.setItem('jr_sac_db', JSON.stringify(db));
        console.log('[CloudStore] Dados transacionais zerados para início de produção.');
      }

      // Zerava só jr_sac_db, deixando para trás a memória e os espelhos por
      // tabela — as outras duas cópias das mesmas coleções. Passou a
      // importar em 23/08/2026: desde a correção da autoridade do pull,
      // window.db.data é a PRIMEIRA fonte consultada na mesclagem, então
      // dado de treinamento esquecido ali voltaria a ser tratado como
      // trabalho local deste aparelho. Zerar as três juntas é o mesmo que
      // store.js:resetTrainingData() já fazia no caminho do Reset Global.
      transactionalKeys.forEach(key => {
        if (window.db && window.db.data && Array.isArray(window.db.data[key])) {
          window.db.data[key] = [];
        }
        const espelho = (CloudStore.MAPA_TABELAS.find(m => m.dbKey === key) || {}).localKey;
        if (espelho) { try { localStorage.removeItem(espelho); } catch(e) {} }
      });
    } catch(e) {
      console.warn('[CloudStore] Erro ao zerar dados transacionais:', e);
    }
  }


  // Remove configuração salva (volta para modo local)
  clearConfig() {
    this.config.url = '';
    this.config.anonKey = '';
    localStorage.removeItem('jr_cloud_config');
    if (window.JR_CONFIG) window.JR_CONFIG.mode = 'local';
    this.stopAutoSync();
    this._setStatus('offline');
  }

  isConfigured() {
    return !!(this.config.url && this.config.anonKey &&
              this.config.url.startsWith('https://') &&
              this.config.anonKey.length > 20);
  }

  // ---------------------------------------------------------------
  // CABEÇALHOS PADRÃO PARA O SUPABASE
  // ---------------------------------------------------------------
  _headers(extra = {}) {
    return {
      'apikey': this.config.anonKey,
      'Authorization': `Bearer ${this.config.anonKey}`,
      'Content-Type': 'application/json',
      ...extra
    };
  }

  // ---------------------------------------------------------------
  // TESTE DE CONEXÃO
  // ---------------------------------------------------------------
  async testConnection() {
    if (!this.isConfigured()) {
      return { success: false, message: '⚠️ Modo Local Ativo. Cole a URL e a Chave do Supabase para conectar à Nuvem.' };
    }
    this._setStatus('connecting');
    try {
      const response = await fetch(`${this.config.url}/rest/v1/setores?select=id&limit=1`, {
        headers: this._headers()
      });
      if (response.ok) {
        this._setStatus('online');
        return { success: true, message: '✅ Conexão com o Banco de Dados (Supabase) estabelecida com sucesso!' };
      } else {
        const txt = await response.text();
        this._setStatus('offline');
        if (response.status === 401 || response.status === 403) {
          return { success: false, message: `❌ Chave incorreta ou sem permissão. Verifique a "anon key" no Supabase. (${response.status})` };
        }
        if (response.status === 404) {
          return { success: false, message: `❌ URL incorreta ou banco não inicializado. Execute o schema.sql primeiro. (${response.status})` };
        }
        return { success: false, message: `❌ Erro no servidor: ${response.status} - ${response.statusText}` };
      }
    } catch (err) {
      this._setStatus('offline');
      if (err.message.includes('fetch')) {
        return { success: false, message: '❌ Sem acesso à internet ou URL inválida. Verifique sua conexão.' };
      }
      return { success: false, message: `❌ Erro inesperado: ${err.message}` };
    }
  }

  // ---------------------------------------------------------------
  // LEITURA COMPLETA DE UMA TABELA (GET) — PAGINADA POR CURSOR EM id
  //
  // Onda 1, item 4 (ETAPA 2, 22/08/2026) — fecha o Teto 1.
  //
  // A leitura montava `select=*` sem `limit` e sem header `Range`. O
  // PostgREST corta a resposta em 1.000 linhas por padrão e não avisa: ela
  // chega com HTTP 200 e cara de completa. A ~400 viagens/mês,
  // controle_viagens bate nisso em cerca de dois meses e meio — e aí o
  // estrago não é "ver menos": o pull grava a lista truncada por cima do
  // cache local e o push seguinte devolve essa lista truncada para a nuvem.
  //
  // Cursor em `id`, e não em `criado_em`: a ETAPA 0 mediu 24 linhas com
  // `criado_em` nulo em controle_viagens, e linha com cursor nulo nunca
  // entra em `id > último_lido` — some da leitura para sempre. `id` é
  // PRIMARY KEY: nunca nulo, sem empate, e a ordem se mantém estável de um
  // bloco para o seguinte, o que OFFSET não garante se alguém inserir no
  // meio da leitura.
  // ---------------------------------------------------------------
  async getAll(tableName, filters = '') {
    if (!this.isConfigured()) return null;

    // Se quem chamou já pediu ordem/limite próprios, a leitura é dele:
    // paginar por cima mudaria o resultado que ele pediu.
    if (/(^|&)(order|limit|offset)=/.test(filters)) {
      return this._getPagina(tableName, filters);
    }

    const PAGINA = CloudStore.PAGINA_LEITURA;
    const tudo = [];
    let cursor = null;
    let completou = false;

    // 200 blocos = 100.000 linhas. Chegar lá é defeito (cursor que não
    // anda), não volume real — a trava existe para não virar laço infinito.
    for (let bloco = 0; bloco < 200; bloco++) {
      const partes = [];
      if (filters) partes.push(filters);
      partes.push('order=id.asc');
      partes.push(`limit=${PAGINA}`);
      if (cursor !== null) partes.push(`id=gt.${encodeURIComponent(cursor)}`);

      const pagina = await this._getPagina(tableName, partes.join('&'));

      if (pagina === null) {
        // Falhou logo no primeiro bloco: pode ser tabela sem coluna `id`
        // (aí o `order=id.asc` volta 400). Recua para a leitura antiga, sem
        // paginação, em vez de deixar a tabela sem sincronizar.
        if (bloco === 0) return this._getPagina(tableName, filters);
        // Falhou no meio: devolver o pedaço já lido é pior do que não
        // devolver nada — o pull trataria o parcial como verdade e
        // truncaria o cache local, que é exatamente o Teto 1 que este item
        // veio fechar.
        console.warn(`[CloudStore] Leitura de ${tableName} interrompida no bloco ${bloco + 1} — descartando o resultado parcial para não truncar o cache local.`);
        return null;
      }

      tudo.push(...pagina);

      // Bloco incompleto = acabou. PAGINA é 500 de propósito, abaixo do
      // corte de 1.000 do servidor: assim um bloco cheio significa sempre
      // "pode haver mais", nunca "o servidor cortou aqui".
      if (pagina.length < PAGINA) { completou = true; break; }

      const proximo = pagina[pagina.length - 1] ? pagina[pagina.length - 1].id : null;
      if (proximo === null || proximo === undefined || String(proximo) === String(cursor)) {
        console.warn(`[CloudStore] Leitura de ${tableName}: o cursor não avançou no bloco ${bloco + 1} — descartando o resultado parcial.`);
        return null;
      }
      cursor = proximo;
    }

    if (!completou) {
      console.warn(`[CloudStore] Leitura de ${tableName} atingiu a trava de 200 blocos — descartando o resultado parcial.`);
      return null;
    }

    if (tudo.length > PAGINA) {
      console.log(`[CloudStore] ${tableName}: ${tudo.length} linhas lidas em blocos de ${PAGINA}.`);
    }
    return tudo;
  }

  // Uma requisição só. É o corpo do getAll() antigo, isolado para servir de
  // tijolo da paginação acima e de caminho de recuo quando ela não se
  // aplica.
  async _getPagina(tableName, filters = '') {
    try {
      const url = `${this.config.url}/rest/v1/${tableName}?select=*${filters ? '&' + filters : ''}`;
      const response = await fetch(url, { headers: this._headers() });
      if (!response.ok) {
        console.warn(`[CloudStore] Erro ao ler ${tableName}:`, response.status);
        return null;
      }
      return await response.json();
    } catch(err) {
      console.warn(`[CloudStore] Falha na rede ao ler ${tableName}:`, err.message);
      return null;
    }
  }

  // ---------------------------------------------------------------
  // UPSERT (INSERIR OU ATUALIZAR) EM UMA TABELA
  // ---------------------------------------------------------------
  async upsert(tableName, records) {
    if (!this.isConfigured()) return false;
    if (!records || (Array.isArray(records) && records.length === 0)) return true;

    let data = Array.isArray(records) ? records : [records];

    // A lista COMO ELA VEIO de syncLocalToCloud. É esta que _confirmarEnvio()
    // vai transformar em hash depois do POST — as etapas abaixo (projeção e
    // igualador de chaves) criam objetos NOVOS, então uma correção feita só
    // na cópia não chegaria ao mapa de sync e o registro voltaria "sujo" no
    // ciclo seguinte. Quem precisa disso é _resolverColisaoDeSequencia().
    const originais = data;

    // -------------------------------------------------------------
    // GUARDA NA ESCRITA (decisão 7 de 22/08/2026) — Onda 1, item 7
    //
    // A ETAPA 0 achou 247 das 331 linhas de controle_viagens com ESTADO DE
    // CHECKLIST gravado no campo de data de saída: `data_saida` em
    // ('INICIADO','NÃO INICIADO') junto com `status_viagem = 'FIN. NORMAL'`.
    // Nesta build esses dois valores são legítimos — mas de OUTROS campos:
    // fusion, checklist_saida e checklist_chegada (app.js:9265). É
    // assinatura de uma build antiga gravando com o mapeamento de coluna
    // trocado. `data_saida` é VARCHAR(20) no banco, então o Postgres aceita
    // calado, e os dois vocabulários nunca se misturaram em 331 linhas.
    //
    // A guarda fica no envio, e não na tela: o problema não é o que este
    // aparelho digita hoje, é o que ele ainda tem em cache de antes. E como
    // o envio usa `resolution=merge-duplicates`, um único aparelho nessas
    // condições desfaz a limpeza do banco no primeiro ciclo de 30s. É esta
    // guarda que torna a `migration_25` definitiva sem depender de todo
    // aparelho ter passado pela limpeza da ETAPA 3.
    // -------------------------------------------------------------
    data = this._aplicarGuardaDeEscrita(tableName, data);
    if (data.length === 0) return true;

    // LISTA BRANCA DE COLUNAS (31/08/2026). Só tem efeito nas tabelas que
    // declaram uma em CloudStore.COLUNAS_POR_TABELA — hoje, clientes e
    // produtos. Ver o comentário lá: campo que não é coluna derruba o lote
    // inteiro com PGRST204, e tipo que volta diferente faz o registro ser
    // reenviado para sempre.
    if (CloudStore.COLUNAS_POR_TABELA[tableName]) {
      data = data.map(r => this._projetarParaTabela(tableName, r));
    }

    // O PostgREST exige que, num envio em lote, todos os objetos do array
    // tenham exatamente as mesmas chaves — registros mais antigos (ex: os
    // 5 usuários padrão, sem o campo "departamento") misturados com
    // registros mais novos (que já têm esse campo) derrubam o envio
    // inteiro com o erro "All object keys must match" (PGRST102), mesmo
    // que os dados em si sejam válidos. Achado de 20/08/2026 — nenhum
    // cadastro de usuário estava chegando na nuvem por causa disso.
    // Preenchemos com null as chaves que faltarem em cada objeto para
    // igualar o formato de todos antes de enviar.
    if (data.length > 1) {
      const allKeys = new Set();
      data.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
      data = data.map(r => {
        const normalized = {};
        allKeys.forEach(k => { normalized[k] = (k in r) ? r[k] : null; });
        return normalized;
      });
    }

    // DUAS TENTATIVAS, NÃO MAIS (02/09/2026). A segunda só acontece quando a
    // primeira voltou 23505 e _resolverColisaoDeSequencia() conseguiu
    // renumerar alguém — ou seja, quando o lote MUDOU e vale reenviar. Sem
    // esse teto, um 23505 que a renumeração não resolve viraria laço infinito
    // dentro de um ciclo de sync.
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        const response = await fetch(`${this.config.url}/rest/v1/${tableName}`, {
          method: 'POST',
          headers: this._headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(data)
        });
        if (!response.ok) {
          const errBody = await response.text();
          if (tentativa === 1) {
            let renumerados = 0;
            try {
              renumerados = await this._resolverColisaoDeSequencia(tableName, errBody, data, originais);
            } catch(e) {
              // Renumerar é conserto oportunista: se ele próprio falhar, o
              // erro original é que tem de chegar ao operador, não este.
              console.warn(`[CloudStore] Não foi possível renumerar ${tableName}:`, e.message);
            }
            if (renumerados > 0) continue;
          }
          this._registrarFalhaSync(tableName, response.status, errBody);
          this._checkConflitoUnicidade(tableName, errBody, data).catch(() => {});
          return false;
        }
        this._tabelasPendentesDeEnvio.delete(tableName);
        // Marca que esta tabela JÁ conseguiu subir deste aparelho. É o que
        // permite ao pull diferenciar "a nuvem está vazia porque o envio
        // nunca funcionou" de "a nuvem está vazia porque alguém apagou".
        try { localStorage.setItem('jr_sync_ok_' + tableName, String(Date.now())); } catch(e) {}
        // Sincronizou com sucesso — se havia um conflito de unicidade pendente
        // registrado para essa tabela (ver _checkConflitoUnicidade), foi
        // corrigido: limpa da fila de revisão (Fase 4, 20/08/2026).
        if (window.db && typeof window.db.limparConflitosDaTabela === 'function') {
          window.db.limparConflitosDaTabela(tableName);
        }
        return true;
      } catch(err) {
        console.warn(`[CloudStore] Falha na rede ao salvar em ${tableName}:`, err.message);
        return false;
      }
    }
    return false;
  }

  // Guarda na escrita — decisão 7 de 22/08/2026 (Onda 1, item 7).
  // Ver o comentário longo dentro de upsert(), onde ela é chamada.
  //
  // Recusa é local e silenciosa para o operador de propósito: o registro
  // recusado é lixo de uma build antiga, não trabalho de alguém. Quem
  // precisa saber é quem estiver fazendo a ETAPA 3 — por isso a contagem
  // aparece em jrDiagnosticoSync(), e é ela que identifica o aparelho que
  // carregava os 247 fantasmas, sem precisar sair andando pela empresa.
  _aplicarGuardaDeEscrita(tableName, registros) {
    if (tableName === 'usuarios') return this._guardaDeUsuarios(registros);
    if (tableName !== 'controle_viagens') return registros;

    // is_deleted PASSA — correção de 01/09/2026, e ela conserta um defeito
    // que estava aqui desde 22/08.
    //
    // A guarda existe para impedir que fantasma de build antiga ENTRE no
    // banco. Um registro já marcado como excluído não entra em lugar nenhum:
    // ele já ESTÁ no banco, e o que este POST carrega é a exclusão dele.
    // Barrá-lo por causa do data_saida não impede fantasma nenhum — impede
    // a EXCLUSÃO de viajar. Duas consequências, e as duas foram vistas:
    //
    //   1. Quem apagar aqui uma viagem cujo data_saida esteja ilegível vê a
    //      linha sumir da própria tela e reaparecer nos outros aparelhos,
    //      para sempre. A exclusão nunca sai desta máquina, e nada avisa.
    //   2. Os 247 que a migration_25 marcou is_deleted descem no pull (o
    //      getAll faz select=* sem filtrar a flag), viram "mudança" no mapa
    //      de hashes e voltam a esta guarda no ciclo seguinte — acendendo o
    //      contador "Recusados" logo depois de a faxina o ter zerado, que é
    //      exatamente o ruído que a faxina existe para acabar.
    //
    // É a mesma regra que _auditarCacheLocal() e _faxinaDeFantasmas() já
    // seguem: para a máquina de fantasma, registro excluído não existe.
    const aprovados = [];
    const recusados = [];
    for (const r of registros) {
      if (r && !r.is_deleted && !this._dataSaidaEhValida(r.data_saida)) recusados.push(r);
      else aprovados.push(r);
    }

    if (recusados.length > 0) {
      const amostra = recusados.slice(0, 5).map(r => `${r.carga || r.id}: data_saida="${r.data_saida}"`);
      // O diagnóstico em si é preenchido por _auditarCacheLocal(), que varre
      // o cache inteiro a cada ciclo — aqui só reforçamos com o que
      // realmente tentou passar, para o caso de a auditoria não ter rodado.
      if (!this._bloqueadosNaEscrita || this._bloqueadosNaEscrita.total < recusados.length) {
        this._bloqueadosNaEscrita = {
          tabela: tableName,
          total: recusados.length,
          exemplos: amostra,
          quando: agoraIsoBrasilia()
        };
      }
      console.warn(
        `[CloudStore] GUARDA NA ESCRITA: ${recusados.length} de ${registros.length} registros de ${tableName} recusados — ` +
        `"data_saida" não é data. Este aparelho tem cache de uma build antiga (fantasmas da ETAPA 0). ` +
        (aprovados.length > 0 ? `Os outros ${aprovados.length} seguiram normalmente. ` : 'Nada deste lote foi enviado. ') +
        `Amostra: ${amostra.join(' | ')}`
      );
    }
    return aprovados;
  }

  // Guarda na escrita de `usuarios` (31/08/2026) — irmã da de cima, e pelo
  // mesmo motivo: impedir que UM registro podre leve o lote inteiro junto.
  //
  // nome, email, senha_hash e role são NOT NULL no banco. Um cadastro
  // legado a que falte qualquer um deles derruba o POST com 23502 — e o
  // lote leva junto o cadastro de quem usa ESTE aparelho. Foi assim que
  // cinco pessoas ficaram existindo só no próprio PC (ver o comentário da
  // lista branca de `usuarios`, no fim do arquivo).
  //
  // A escolha aqui é deliberada: o registro incompleto é lixo de build
  // antiga, e ninguém consegue fazer login com ele de qualquer jeito (o
  // login compara senha_hash). O cadastro de quem está trabalhando agora,
  // não é. Deixa o lixo para trás e deixa o resto passar.
  _guardaDeUsuarios(registros) {
    const OBRIGATORIAS = ['nome', 'email', 'senha_hash', 'role'];
    const vazio = v => (v === undefined || v === null || String(v).trim() === '');

    const aprovados = [];
    const recusados = [];
    for (const r of registros) {
      const faltando = r ? OBRIGATORIAS.filter(c => vazio(r[c])) : OBRIGATORIAS;
      if (faltando.length > 0) recusados.push({ r, faltando });
      else aprovados.push(r);
    }

    if (recusados.length > 0) {
      console.warn(
        `[CloudStore] GUARDA NA ESCRITA: ${recusados.length} de ${registros.length} registros de usuarios ` +
        `recusados por falta de coluna obrigatória (NOT NULL no banco). São cadastros incompletos de build ` +
        `antiga, e sem eles o resto do lote sobe normalmente. ` +
        `Amostra: ${recusados.slice(0, 5).map(x => `${x.r && (x.r.nome || x.r.id)}: falta ${x.faltando.join(', ')}`).join(' | ')}`
      );
    }
    return aprovados;
  }

  // Os dois formatos que esta build grava em data_saida: ISO (input
  // type=date das telas de viagem e store.js) e dd/mm/aaaa (importação da
  // escala, via normalizarDataImportacao). Vazio e nulo passam: é viagem
  // lançada que ainda não saiu, e barrar isso travaria operação de verdade.
  _dataSaidaEhValida(valor) {
    if (valor === null || valor === undefined) return true;
    const s = String(valor).trim();
    if (s === '') return true;
    return /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s) || /^\d{2}\/\d{2}\/\d{4}$/.test(s);
  }

  // =================================================================
  // O QUE MUDOU NESTE APARELHO — Onda 1, itens 1, 2 e 3 (22/08/2026)
  //
  // O defeito que isto fecha é o maior dos sete da ETAPA 0: QUALQUER
  // gravação, em QUALQUER tela, reenviava as 25 tabelas inteiras a partir
  // do cache local, e a leitura substituía a coleção inteira pela da nuvem.
  // Resultado prático: a edição de um aparelho apagava a do outro sem
  // aviso, e um aparelho com cache velho desfazia exclusão e ressuscitava
  // registro só por existir.
  //
  // COMO FUNCIONA: guardamos, por registro, uma assinatura curta (hash) do
  // estado que a nuvem confirmou — na leitura, o que veio de lá; no envio,
  // o que subiu com sucesso. A partir daí:
  //
  //   registro com hash igual  -> a nuvem já tem esta versão. Não sobe, e
  //                               na leitura a nuvem manda.
  //   registro com hash difere -> foi mexido AQUI e ainda não subiu. Sobe,
  //                               e na leitura o local é preservado.
  //
  // POR QUE NÃO USAMOS `atualizado_em` PARA DECIDIR, como o plano previa:
  // (a) a coluna só nasce na migration_25, que roda por último — item 2
  //     ficaria bloqueado por uma etapa posterior;
  // (b) comparar carimbo de tempo entre aparelhos exige que os relógios
  //     deles concordem, e celular com hora errada é comum. O hash não
  //     depende de relógio nenhum.
  //
  // REGRA DE DESEMPATE, dita em voz alta: quando os dois lados mudaram,
  // **o local vence** — porque o local é trabalho que ainda não subiu, e
  // descartá-lo em silêncio é exatamente o erro que este projeto já
  // cometeu vezes demais. O que a nuvem tem já está salvo em algum lugar;
  // o que está só aqui, não.
  // =================================================================

  // JSON com as chaves sempre na mesma ordem — sem isso, o mesmo registro
  // gera assinaturas diferentes só porque o navegador devolveu as
  // propriedades em outra ordem.
  _jsonEstavel(valor) {
    if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
    if (Array.isArray(valor)) return '[' + valor.map(v => this._jsonEstavel(v)).join(',') + ']';
    const chaves = Object.keys(valor).sort();
    return '{' + chaves.map(k => JSON.stringify(k) + ':' + this._jsonEstavel(valor[k])).join(',') + '}';
  }

  // FNV-1a de 32 bits. Não é criptografia — é só um jeito barato de dizer
  // "este registro está diferente do que estava", em ~7 caracteres em vez
  // de guardar o registro inteiro duas vezes.
  _hashRegistro(rec) {
    const s = this._jsonEstavel(rec);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  _lerMapaSync() {
    if (this._mapaSync) return this._mapaSync;
    try {
      this._mapaSync = JSON.parse(localStorage.getItem('jr_sync_hashes') || '{}');
    } catch(e) {
      this._mapaSync = {};
    }
    return this._mapaSync;
  }

  // Se a gravação do mapa falhar (cota estourada), o aparelho volta sozinho
  // ao comportamento antigo — tudo parece mudado e tudo é reenviado. Perde
  // eficiência, não perde dado. Por isso o erro é aviso, não exceção.
  _gravarMapaSync() {
    try {
      localStorage.setItem('jr_sync_hashes', JSON.stringify(this._mapaSync || {}));
    } catch(e) {
      // 28/08/2026 — o comentário acima descreve só metade do estrago, e é a
      // metade boa. Quando o mapa não é gravado, ele não fica AUSENTE: fica
      // VELHO. E mapa velho não significa apenas "reenvia demais" — na
      // mesclagem, todo registro que mudou na nuvem desde a última gravação
      // bem-sucedida passa a ter hash local diferente do `conhecidos`, ou
      // seja, é lido como ALTERAÇÃO LOCAL NÃO ENVIADA. E a mesclagem, por
      // desenho, deixa a versão local ganhar nesse caso. O aparelho passa a
      // ACEITAR registro novo e RECUSAR atualização de registro que já tem —
      // que é o aparelho que mostra a devolução certa com a análise em
      // branco, mesmo já preenchida por outra pessoa.
      //
      // Não se conserta aqui mudando quem ganha a mesclagem: a regra existe
      // para não perder o que foi digitado offline. Conserta-se liberando
      // espaço — e é a mesma cota do _gravarCacheDoPull(), então acende o
      // mesmo alarme, em vez de mais um console.warn que ninguém lê.
      console.warn('[CloudStore] Não foi possível gravar o mapa de sincronização — este aparelho vai recusar atualizações vindas da nuvem até haver espaço:', e.message);
      this._falhaAoGravarCache = {
        detalhe: 'mapa de sincronização não coube (' + String((e && e.message) || e).slice(0, 120) + ')',
        quando: (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString()
      };
      try { this._setStatus(this._connectionStatus); } catch(eSt) {}
    }
  }

  // Quando o registro foi editado pela última vez, em milissegundos, ou
  // null se não dá para saber.
  //
  // Só olha atualizado_em, e de propósito: é o único campo que o app
  // carimba em TODA edição de verdade (store.js) e em NENHUMA mutação
  // incidental. criado_em não serve de plano B aqui — ele é igual dos dois
  // lados e daria empate justamente onde o desempate é necessário.
  //
  // As colunas TIMESTAMP WITHOUT TIME ZONE voltam da nuvem sem offset
  // ('2026-08-28 13:42:42'). Date.parse() de uma string assim varia por
  // motor (uns leem como local, outros como UTC), e comparar duas leituras
  // com regras diferentes erraria por 3 horas — o bastante para escolher o
  // lado errado. Normalizamos o separador e tratamos as duas pontas com a
  // MESMA regra: sem offset explícito, ambas são lidas como hora de
  // parede. Como o que importa é a COMPARAÇÃO entre elas, e não o instante
  // absoluto, ler as duas do mesmo jeito é o que basta.
  _instanteDeAtualizacao(r) {
    const bruto = r && r.atualizado_em;
    if (!bruto) return null;
    let s = String(bruto).trim();
    if (!s) return null;
    if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
    const temFuso = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
    const t = Date.parse(temFuso ? s : s + 'Z');
    return isNaN(t) ? null : t;
  }

  // Item 1 — separa, de uma coleção local, só o que mudou desde a última
  // confirmação da nuvem.
  _separarOQueMudou(tableName, registros) {
    const mapa = this._lerMapaSync();
    const conhecidos = mapa[tableName];
    // Sem mapa ainda (primeira execução desta build, ou cota estourada):
    // manda tudo, como antes. A partir do primeiro ciclo o mapa existe.
    if (!conhecidos) return registros.slice();

    const mudados = [];
    for (const r of registros) {
      const id = (r && r.id !== undefined && r.id !== null) ? String(r.id) : null;
      if (id === null) { mudados.push(r); continue; }   // sem id, não dá para saber: manda
      if (conhecidos[id] !== this._hashParaSync(tableName, r)) mudados.push(r);
    }
    return mudados;
  }

  _confirmarEnvio(tableName, enviados) {
    const mapa = this._lerMapaSync();
    if (!mapa[tableName]) mapa[tableName] = {};
    for (const r of enviados) {
      const id = (r && r.id !== undefined && r.id !== null) ? String(r.id) : null;
      if (id !== null) mapa[tableName][id] = this._hashParaSync(tableName, r);
    }
    this._mapaSync = mapa;
    this._gravarMapaSync();
  }

  // Item 2 — mesclagem por registro, no lugar de "a nuvem substitui a
  // coleção inteira". Também é aqui que a exclusão vira durável (item 3):
  // um registro que este aparelho não mexeu nunca sobrescreve o que veio de
  // lá — nem para desfazer um is_deleted, nem para ressuscitar linha que
  // sumiu da nuvem.
  _mesclarPorRegistro(tableName, localRaw, cloudData) {
    let locais = [];
    try {
      const p = localRaw ? JSON.parse(localRaw) : [];
      locais = Array.isArray(p) ? p : Object.values(p);
    } catch(e) { locais = []; }

    const mapa = this._lerMapaSync();
    const conhecidos = mapa[tableName];
    const primeiraVez = !conhecidos;

    const porId = new Map();
    for (const r of locais) {
      if (r && r.id !== undefined && r.id !== null) porId.set(String(r.id), r);
    }

    const resultado = [];
    const novosHashes = {};
    const idsNaNuvem = new Set();
    // Registros que a janela operacional (item 5) não pode podar de jeito
    // nenhum: os que ainda não subiram. Idade não importa se o dado só
    // existe aqui.
    const idsSeguros = new Set();
    let preservados = 0, descartados = 0, cederam = 0;
    // Ids que este aparelho está recusando da nuvem AGORA. Vai para o
    // diagnóstico: é a lista que responde "de qual registro esta máquina
    // discorda, e por quê", sem depender de ninguém ler o console na hora
    // certa. Ver jrDiagnosticoSync().
    const recusados = [];

    for (const nuvem of cloudData) {
      const id = (nuvem && nuvem.id !== undefined && nuvem.id !== null) ? String(nuvem.id) : null;
      if (id === null) { resultado.push(nuvem); continue; }
      idsNaNuvem.add(id);

      const local = porId.get(id);
      if (!local) {
        resultado.push(nuvem);
        novosHashes[id] = this._hashParaSync(tableName, nuvem);
        continue;
      }

      // "Sujo" = mexido aqui e ainda não confirmado pela nuvem. Na primeira
      // execução não há como saber, e aí a nuvem manda: é o que impede um
      // aparelho parado desde 20/08 de despejar o cache antigo por cima do
      // que os outros já corrigiram.
      const sujo = !primeiraVez
        && conhecidos[id] !== undefined
        && this._hashParaSync(tableName, local) !== conhecidos[id];

      // =============================================================
      // DESEMPATE POR atualizado_em (28/08/2026)
      //
      // O DEFEITO QUE ISTO FECHA. "Sujo" era decidido SÓ por hash: se o
      // registro em memória não é byte a byte o que a nuvem confirmou da
      // última vez, ele é tratado como alteração local e GANHA da nuvem,
      // para sempre — até um envio confirmá-lo.
      //
      // Só que hash não distingue as duas coisas que podem ter mexido no
      // objeto:
      //   1. o operador EDITOU o registro (tem de ganhar da nuvem);
      //   2. qualquer código escreveu um campo no objeto sem que ninguém
      //      tenha editado nada — uma migração de init(), um campo
      //      derivado, um relatório, um normalizador.
      //
      // No caso 2 o aparelho passa a RECUSAR PERMANENTEMENTE as
      // atualizações daquele registro. Ele continua aceitando registro
      // NOVO (id que ele não conhece), então parece que sincroniza — e é
      // por isso que o sintoma é tão confuso: o aparelho recebe os
      // lançamentos do dia e ignora a análise que outra pessoa preencheu
      // numa devolução antiga. Como cada aparelho mexe num conjunto
      // diferente de registros, cada um trava um subconjunto diferente:
      // três telas, três números, todas "online" e na mesma versão.
      // Reproduzido em bancada com os dados de produção.
      //
      // atualizado_em separa os dois casos, e é o único campo que separa:
      // o app o carimba em TODA edição de verdade (store.js, via
      // agoraIsoBrasilia()) e em nenhuma mutação incidental. Então, quando
      // os dois lados divergem, ganha o mais recente — que é a regra que
      // qualquer pessoa da operação já espera.
      //
      // CONSERVADOR DE PROPÓSITO, em três pontos: só cede quando a nuvem é
      // ESTRITAMENTE mais nova (empate mantém o local); só quando os DOIS
      // lados têm data legível; e nas tabelas sem a coluna atualizado_em
      // (motoristas, veículos, cargas, usuários...) nada muda, continua a
      // regra antiga. Editar offline continua protegido: quem editou de
      // verdade tem o carimbo mais novo.
      // =============================================================
      let nuvemMaisNova = false;
      if (sujo) {
        const tLocal = this._instanteDeAtualizacao(local);
        const tNuvem = this._instanteDeAtualizacao(nuvem);
        nuvemMaisNova = (tLocal !== null && tNuvem !== null && tNuvem > tLocal);
      }

      if (sujo && !nuvemMaisNova) {
        resultado.push(local);
        novosHashes[id] = conhecidos[id];   // segue pendente até subir
        idsSeguros.add(id);
        preservados++;
        recusados.push(id);
      } else {
        resultado.push(nuvem);
        novosHashes[id] = this._hashParaSync(tableName, nuvem);
        if (sujo) cederam++;
      }
    }

    // Registros que existem só aqui.
    for (const [id, local] of porId) {
      if (idsNaNuvem.has(id)) continue;
      if (!primeiraVez && conhecidos[id] !== undefined) {
        // A nuvem já confirmou este registro alguma vez e agora ele não
        // está mais lá: foi apagado de verdade (Reset Global). Ressuscitar
        // seria desfazer a exclusão de outra pessoa.
        descartados++;
        continue;
      }
      // Nunca subiu: é trabalho local pendente. Fica, e sobe no push.
      resultado.push(local);
      idsSeguros.add(id);
    }

    if (preservados > 0 || descartados > 0 || cederam > 0) {
      console.log(`[CloudStore] ${tableName}: ${preservados} registro(s) local(is) preservado(s) por terem mudança não enviada; ${descartados} descartado(s) por terem sido apagados na nuvem; ${cederam} atualizado(s) pela nuvem por ela estar mais recente.`);
    }

    // Guarda para o diagnóstico. Só as tabelas que estão de fato recusando
    // algo aparecem — tabela em dia sai do mapa em vez de ficar com [].
    if (!this._recusandoDaNuvem) this._recusandoDaNuvem = {};
    if (recusados.length) this._recusandoDaNuvem[tableName] = recusados;
    else delete this._recusandoDaNuvem[tableName];

    const final = this._aplicarJanelaOperacional(tableName, resultado, novosHashes, idsSeguros);

    mapa[tableName] = novosHashes;   // ids que sumiram dos dois lados saem do mapa
    this._mapaSync = mapa;
    this._gravarMapaSync();
    return final;
  }

  // =================================================================
  // JANELA OPERACIONAL — Onda 1, item 5 (22/08/2026)
  //
  // Teto 2: o catálogo estático já ocupa 2,9 MB de uma cota de ~5 MB, e
  // viagem custa ~505 bytes. A 400 por mês são ~2,3 MB por ano só de
  // viagem — o aparelho estoura e o save() falha (agora com alarme, item
  // 6, mas falha). O histórico inteiro não precisa morar no celular: ele
  // está na nuvem e no Power BI. Aqui fica a operação.
  //
  // O QUE NUNCA É PODADO, em nenhuma hipótese:
  //   - registro que ainda não subiu para a nuvem (idsSeguros);
  //   - registro sem data legível — na dúvida, guarda.
  // Podar é apagar cópia, nunca original.
  //
  // ARMADILHA PARA QUEM MEXER DEPOIS: **não** transforme isto em filtro na
  // leitura da nuvem (`id=gt.X` no getAll). A mesclagem trata "registro que
  // eu conheço e não veio da nuvem" como registro apagado lá — um pull
  // filtrado por data faria toda a base antiga parecer excluída. A poda é
  // local, depois da mesclagem, de propósito.
  // =================================================================
  _aplicarJanelaOperacional(tableName, registros, hashes, idsSeguros) {
    const dias = CloudStore.JANELA_OPERACIONAL_DIAS[tableName];
    if (!dias) return registros;

    const corte = Date.now() - (dias * 24 * 60 * 60 * 1000);
    const mantidos = [];
    let podados = 0;

    for (const r of registros) {
      const id = (r && r.id !== undefined && r.id !== null) ? String(r.id) : null;
      if (id === null || idsSeguros.has(id)) { mantidos.push(r); continue; }

      const quando = this._momentoDoRegistro(r);
      if (quando === null || quando >= corte) { mantidos.push(r); continue; }

      delete hashes[id];   // sai do mapa junto, senão ele cresce sem parar
      podados++;
    }

    if (podados > 0) {
      console.log(`[CloudStore] ${tableName}: ${podados} registro(s) fora da janela de ${dias} dias saíram do aparelho (continuam na nuvem e no Power BI).`);
    }
    return mantidos;
  }

  // Quando o registro nasceu, em milissegundos. Ordem de preferência:
  //
  // 1. `criado_em`, quando existe e é legível. A ETAPA 0 achou 24 linhas
  //    com ele nulo em controle_viagens — por isso não dá para depender só
  //    dele (o conserto vem na migration_25, que roda depois disto).
  // 2. o próprio `id`, que é relógio do aparelho. **São dois formatos**:
  //    até 20/08/2026 o id era `Date.now()` (milissegundos, ~1,7e12); de
  //    20/08 em diante é `gerarIdUnico()` = `Date.now() * 1000 + contador`
  //    (~1,7e15). Confundir os dois joga o registro para o ano 57000 ou
  //    para 1970 — e some da janela, ou nunca sai dela.
  _momentoDoRegistro(r) {
    if (r && r.criado_em) {
      const t = Date.parse(r.criado_em);
      if (!isNaN(t)) return t;
    }
    const id = Number(r && r.id);
    if (!isFinite(id) || id <= 0) return null;
    if (id > 1e14) return Math.floor(id / 1000);   // formato gerarIdUnico()
    if (id > 1e11) return id;                       // formato Date.now() antigo
    return null;                                    // id pequeno: não é relógio
  }

  // Varre o cache local em busca da impressão digital do fantasma,
  // independentemente de haver algo a enviar naquele ciclo. Sem isto, o
  // contador do diagnóstico só apareceria enquanto houvesse registro sujo
  // para empurrar — e um aparelho contaminado que já tivesse sido marcado
  // como "em dia" mostraria `null`, escondendo justamente o que a ETAPA 3
  // precisa achar. Ver CONFERIR_APARELHO.md.
  // =================================================================
  // FAXINA DE FANTASMA NO CACHE DESTE APARELHO — 01/09/2026
  //
  // O QUE ISTO FECHA, e por que a guarda de escrita sozinha nunca fechou.
  //
  // _aplicarGuardaDeEscrita() impede o fantasma de SUBIR — é o que tornou
  // definitiva a faxina do banco (migration_25). Só que ela nunca tirou
  // nada do APARELHO: o registro recusado continua no localStorage, e as
  // duas pontas do ciclo o seguram lá para sempre.
  //
  //   ENVIO    a guarda recusa, então a nuvem nunca confirma aquele id, e
  //            ele nunca entra em `conhecidos` (_mapaSync).
  //   LEITURA  _mesclarPorRegistro vê um id que a nuvem nunca confirmou e
  //            o classifica como "nunca subiu: é trabalho local pendente".
  //            Fica. E quando o id EXISTE na nuvem — os 247 que a
  //            migration_25 marcou is_deleted — ele bate como "sujo", e o
  //            desempate por atualizado_em não salva: o fantasma vem de uma
  //            build que nem gravava essa coluna, então tLocal é null e a
  //            nuvem nunca é "estritamente mais nova". O local ganha.
  //
  // Ou seja: os dois caminhos do merge preservam. O ciclo se fecha em si
  // mesmo, e é por isso que UM aparelho da frota voltava a marcar os mesmos
  // 247 recusados DEPOIS DE CADA atualização — atualizar troca o código, e
  // quem segurava os 247 era o localStorage, que a atualização não toca.
  //
  // A REGRA AQUI, e ela é curta: registro que a guarda de escrita recusa
  // não pode ser enviado nunca; logo não é trabalho de ninguém, é lixo de
  // build antiga, e sai do aparelho. Duas saídas, conforme o que está
  // guardado em data_saida:
  //
  //   FANTASMA  data_saida com vocabulário de CHECKLIST ("INICIADO",
  //             "NÃO INICIADO"...). É a impressão digital medida na ETAPA 0
  //             e expurgada pela migration_25: build antiga gravando com o
  //             mapeamento de coluna trocado. Sai do cache.
  //
  //   ILEGÍVEL  data_saida com qualquer outra coisa que não seja data.
  //             Aqui não dá para afirmar que a LINHA é lixo — só o campo é.
  //             Zera o campo (vazio é viagem lançada que ainda não saiu, e
  //             a guarda aceita) e a linha finalmente sobe, em vez de ficar
  //             bloqueando o lote para sempre.
  //
  // IGNORA is_deleted, e isso não é detalhe: a migration_25 marcou os 247
  // no banco mas NÃO mudou o data_saida deles, e getAll() faz select=* sem
  // filtrar a flag — eles continuam descendo no pull. Se a faxina os
  // varresse, ela os apagaria a cada 30 segundos e o pull os traria de
  // volta a cada 30 segundos, reescrevendo o localStorage inteiro no meio.
  // Um registro já marcado como excluído não aparece em tela nenhuma e a
  // guarda o recusaria de qualquer forma: para esta faxina, ele não existe.
  //
  // NÃO É DESTRUTIVO NA PRÁTICA: o que sai daqui já está no banco marcado
  // com is_deleted pela migration_25 (reversível com um UPDATE), e a ficha
  // de cada linha removida — id, carga e o valor recusado — fica em
  // localStorage['jr_faxina_fantasmas']. Guardamos a ficha, não a linha: o
  // objetivo é liberar cota, não trocá-la de lugar.
  // =================================================================

  // O vocabulário de checklist/fusion que a build antiga gravava dentro de
  // data_saida. Sem acento e em maiúsculas porque a mesma coluna já chegou
  // como "NÃO INICIADO", "NAO INICIADO" e "Não iniciado" — a mesma
  // normalização que checklistFoiRealizado() faz em app.js.
  _ehVocabularioDeChecklist(valor) {
    const v = String(valor === null || valor === undefined ? '' : valor)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().trim();
    return v === 'INICIADO' || v === 'NAO INICIADO'
        || v === 'REALIZADO' || v === 'NAO REALIZADO'
        || v === 'FINALIZADO' || v === 'EM ANDAMENTO'
        || v === 'PENDENTE' || v === 'OK' || v === 'SIM' || v === 'NAO';
  }

  _faxinaDeFantasmas() {
    const decisao = new Map();   // id -> 'remover' | 'reparar'
    const fichas = [];

    // As TRÊS cópias que o aparelho mantém de controle_viagens, e a faxina
    // precisa passar nas três: a memória é o que a tela desenha, jr_sac_db
    // é o que sobrevive ao reload e é lido pelo envio, e o espelho é o que
    // o diagnóstico compara. Limpar só uma faz o fantasma voltar pela outra
    // no ciclo seguinte — a forma de falhar mais fácil deste app.
    const memoria = (window.db && window.db.data && Array.isArray(window.db.data.controle_viagens))
      ? window.db.data.controle_viagens : null;

    let sacDb = null, fatia = null;
    try {
      sacDb = JSON.parse(localStorage.getItem('jr_sac_db') || 'null');
      if (sacDb && Array.isArray(sacDb.controle_viagens)) fatia = sacDb.controle_viagens;
    } catch (e) {}

    let espelho = null;
    try {
      const bruto = localStorage.getItem('jr_controle_viagens');
      if (bruto) {
        const parsed = JSON.parse(bruto);
        espelho = Array.isArray(parsed) ? parsed : Object.values(parsed);
      }
    } catch (e) {}

    const examinar = (lista) => {
      if (!Array.isArray(lista)) return;
      for (const r of lista) {
        if (!r || r.id === undefined || r.id === null) continue;
        if (r.is_deleted) continue;                     // já morto: ver o comentário acima
        if (this._dataSaidaEhValida(r.data_saida)) continue;
        const id = String(r.id);
        if (decisao.has(id)) continue;
        const fantasma = this._ehVocabularioDeChecklist(r.data_saida);
        decisao.set(id, fantasma ? 'remover' : 'reparar');
        fichas.push({
          id: r.id,
          carga: r.carga || null,
          data_saida: String(r.data_saida).slice(0, 40),
          acao: fantasma ? 'removido' : 'data_saida zerada'
        });
      }
    };

    examinar(memoria);
    examinar(fatia);
    examinar(espelho);
    if (decisao.size === 0) return 0;

    const aplicar = (lista) => {
      const saida = [];
      for (const r of lista) {
        const id = (r && r.id !== undefined && r.id !== null) ? String(r.id) : null;
        const acao = (id !== null && !(r && r.is_deleted)) ? decisao.get(id) : undefined;
        if (acao === 'remover') continue;
        if (acao === 'reparar') { saida.push(Object.assign({}, r, { data_saida: null })); continue; }
        saida.push(r);
      }
      return saida;
    };

    // MEMÓRIA PRIMEIRO, e NO MESMO ARRAY. Primeiro porque é de graça e não
    // falha por cota (mesma razão do _pullDaNuvem). No mesmo array porque a
    // tela desenha de window.db.data.controle_viagens: trocar a referência
    // deixaria para trás qualquer lugar que já tenha guardado a lista.
    if (memoria) {
      const limpa = aplicar(memoria);
      memoria.length = 0;
      Array.prototype.push.apply(memoria, limpa);
    }

    if (sacDb && fatia) {
      sacDb.controle_viagens = aplicar(fatia);
      this._gravarCacheDoPull(sacDb);
    }

    if (espelho) {
      this._gravarEspelho('jr_controle_viagens', JSON.stringify(aplicar(espelho)));
    }

    // Tira os ids expurgados do mapa de hashes. Sem isto, o id removido
    // continuaria em `conhecidos` e o pull seguinte o contaria como "a
    // nuvem já confirmou e agora sumiu" — ruído no contador de descartados,
    // justamente na tabela que menos precisa de ruído.
    try {
      const mapa = this._lerMapaSync();
      const conhecidos = mapa['controle_viagens'];
      if (conhecidos) {
        let mexeu = false;
        for (const [id, acao] of decisao) {
          if (acao === 'remover' && conhecidos[id] !== undefined) { delete conhecidos[id]; mexeu = true; }
        }
        if (mexeu) { this._mapaSync = mapa; this._gravarMapaSync(); }
      }
    } catch (e) {}

    // Ficha do que saiu. Best-effort e limitada de propósito: esta faxina
    // existe para LIBERAR cota, e não pode falhar por falta de cota.
    try {
      const anterior = JSON.parse(localStorage.getItem('jr_faxina_fantasmas') || 'null');
      localStorage.setItem('jr_faxina_fantasmas', JSON.stringify({
        quando: (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString(),
        build: CloudStore.BUILD,
        total: fichas.length,
        total_acumulado: ((anterior && anterior.total_acumulado) || 0) + fichas.length,
        amostra: fichas.slice(0, 50)
      }));
    } catch (e) {}

    const removidos = fichas.filter(f => f.acao === 'removido').length;
    console.warn(
      `[CloudStore] FAXINA DE FANTASMA: ${removidos} registro(s) de controle_viagens removido(s) do cache deste ` +
      `aparelho (data_saida guardava estado de checklist — assinatura de build antiga) e ${fichas.length - removidos} ` +
      `com data_saida ilegível zerada para poder sincronizar. É definitivo: eles não voltam, e o contador "Recusados" ` +
      `do painel Aparelhos vai a zero no próximo ciclo. Ficha do que saiu em localStorage['jr_faxina_fantasmas'].`
    );
    return fichas.length;
  }

  _auditarCacheLocal() {
    // Lia 'jr_controle_viagens' — o espelho — e o espelho só é escrito pelo
    // pull. Entre um ciclo e outro ele não reflete o que o aparelho guarda,
    // então este contador podia dizer "limpo" com fantasma na fatia
    // operacional, e o contrário também (correção de 23/08/2026, junto com
    // a autoridade do pull). É este número que decide se uma máquina pode
    // operar antes do Reset Global — ele precisa contar o que ela realmente
    // tem, na mesma ordem de confiança usada no pull.

    // TIRA O FANTASMA DO APARELHO ANTES DE CONTÁ-LO (01/09/2026).
    //
    // Até aqui este método só MEDIA. Medir sozinho nunca teve como zerar o
    // contador: quem segurava as 247 linhas era o localStorage, e nem a
    // guarda de escrita nem a atualização do app mexem nele. A faxina roda
    // primeiro, no mesmo ponto do ciclo, para que a contagem abaixo já veja
    // o cache limpo — e o número que sobe para o painel Aparelhos passe a
    // significar "sobrou fantasma que a faxina não soube tratar", que é a
    // única coisa que ainda vale um alarme.
    this._faxinaDeFantasmas();

    let viagens = null;
    if (window.db && window.db.data && Array.isArray(window.db.data.controle_viagens)) {
      viagens = window.db.data.controle_viagens;
    } else {
      try {
        const raw = localStorage.getItem('jr_sac_db');
        const fatia = raw ? JSON.parse(raw) : null;
        if (fatia && Array.isArray(fatia.controle_viagens)) viagens = fatia.controle_viagens;
      } catch(e) {}
    }
    if (viagens === null) {
      try {
        const bruto = localStorage.getItem('jr_controle_viagens');
        if (bruto) {
          const p = JSON.parse(bruto);
          viagens = Array.isArray(p) ? p : Object.values(p);
        }
      } catch(e) { return; }
    }
    if (!viagens) return;

    // Ignora as já excluídas (22/08/2026, build 4.8.2). O GO_LIVE.md previa
    // que este contador zerasse sozinho depois da migration_25 — não zerou, e
    // o motivo é aqui: a migração marca os 247 fantasmas como is_deleted, mas
    // getAll() faz `select=*` sem filtrar a flag, então eles continuam
    // descendo no pull e ficando no cache. Contando-os, o alarme nunca
    // apagava.
    //
    // Uma linha com is_deleted não é "cache contaminado" em nenhum sentido
    // acionável: não aparece em tela nenhuma, e a guarda de escrita a
    // recusaria de qualquer forma. Contá-la custava caro — não pelo número
    // errado, mas porque um detector que fica permanentemente vermelho é um
    // detector que ninguém mais olha. Este número precisa significar
    // exatamente uma coisa: fantasma VIVO chegou ao cache deste aparelho.
    const contaminados = viagens.filter(v => v && !v.is_deleted && !this._dataSaidaEhValida(v.data_saida));
    if (contaminados.length === 0) {
      this._bloqueadosNaEscrita = null;
      return;
    }
    this._bloqueadosNaEscrita = {
      tabela: 'controle_viagens',
      total: contaminados.length,
      exemplos: contaminados.slice(0, 5).map(r => `${r.carga || r.id}: data_saida="${r.data_saida}"`),
      quando: agoraIsoBrasilia()
    };
  }


  // =================================================================
  // DETECTOR DE RESQUÍCIO — build 4.8.3 (23/08/2026)
  //
  // O diagnóstico que existia até aqui responde sempre no nível da TABELA
  // ("a nuvem recusou alguma?"), e tem um único detector de conteúdo, preso
  // a controle_viagens (_auditarCacheLocal). Nenhum dos dois enxerga o que
  // foi relatado em 23/08/2026: uma devolução lançada que chega na nuvem e
  // nos outros aparelhos, mas some — ou fica velha — em um deles. Por isso
  // jrDiagnosticoSync() diz "tudo chegou ao banco" e a tela mostra outra
  // coisa: as duas frases são verdadeiras, sobre camadas diferentes.
  //
  // O MESMO registro mora em QUATRO lugares dentro deste aparelho:
  //
  //   1. window.db.data[dbKey]            memória — é o que a tela desenha
  //   2. localStorage['jr_sac_db'][dbKey] a fatia operacional — é o que
  //                                       db.save() grava (store.js:682)
  //   3. localStorage[localKey]           o ESPELHO por tabela
  //                                       ('jr_ocorrencias', 'jr_cargas'...)
  //   4. localStorage['jr_sync_hashes']   a assinatura do que a nuvem
  //                                       confirmou, registro a registro
  //
  // E aqui está o furo: db.save() escreve (1) e (2), e NUNCA (3). Quem
  // escreve o espelho é só o pull (syncCloudToLocal) — que também LÊ o
  // espelho como se ele fosse "o que este aparelho tem", e mescla a nuvem
  // contra uma cópia que pode estar horas atrasada. Entre um pull e o
  // seguinte, (2) e (3) discordam por construção, e não por falha de rede.
  //
  // A consequência ruim é silenciosa: um registro que está em (2) e não em
  // (3) e ainda não subiu não aparece em porId dentro de _mesclarPorRegistro
  // — não é preservado, não é descartado, simplesmente não é considerado. O
  // resultado da mesclagem é gravado por cima das duas chaves, e o registro
  // some. Sem erro, sem recusa, sem entrar em tabelasComPendencia. Na
  // prática o envio quase sempre ganha a corrida (debounce de 1,5s mais o
  // flush no alert()), e é por isso que o sintoma é UM lançamento perdido no
  // meio de cinco que passaram.
  //
  // "Resquício de cache" não é uma coisa só: é uma DISCORDÂNCIA entre duas
  // dessas camadas, e cada par tem causa e conserto diferentes. Este método
  // não conserta nada — ele diz qual par discorda, e em quais registros,
  // para que se pare de adivinhar. É leitura pura: não toca na rede.
  // =================================================================
  _lerColecaoEspelho(localKey) {
    try {
      const raw = localStorage.getItem(localKey);
      if (raw === null) return null;          // nunca existiu: não é divergência
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : Object.values(p);
    } catch(e) { return null; }
  }

  _porId(lista) {
    const m = new Map();
    if (!Array.isArray(lista)) return m;
    for (const r of lista) {
      if (r && r.id !== undefined && r.id !== null) m.set(String(r.id), r);
    }
    return m;
  }

  conferirCamadas() {
    let sacDb = {};
    try { sacDb = JSON.parse(localStorage.getItem('jr_sac_db') || '{}') || {}; } catch(e) {}
    const memoria = (window.db && window.db.data) || {};
    const mapa = this._lerMapaSync();

    const tabelas = [];
    let totalDivergentes = 0;
    let totalEmRisco = 0;

    for (const m of CloudStore.MAPA_TABELAS) {
      const camadas = {
        memoria:  Array.isArray(memoria[m.dbKey]) ? memoria[m.dbKey] : null,
        sacDb:    Array.isArray(sacDb[m.dbKey])   ? sacDb[m.dbKey]   : null,
        espelho:  this._lerColecaoEspelho(m.localKey)
      };
      const idx = {
        memoria: this._porId(camadas.memoria),
        sacDb:   this._porId(camadas.sacDb),
        espelho: this._porId(camadas.espelho)
      };
      const conhecidos = (mapa && mapa[m.tableName]) || null;

      // Universo = todo id visto em qualquer camada que EXISTA. Camada
      // ausente (null) não vota: aparelho que ainda não completou um pull
      // desta tabela não tem espelho, e isso é normal no primeiro dia.
      const universo = new Set();
      ['memoria', 'sacDb', 'espelho'].forEach(c => {
        if (camadas[c]) idx[c].forEach((_, id) => universo.add(id));
      });

      const achados = [];
      for (const id of universo) {
        const onde = {};
        let algumFalta = false, algumDifere = false;
        let ref = null;
        ['memoria', 'sacDb', 'espelho'].forEach(c => {
          if (!camadas[c]) { onde[c] = 'n/a'; return; }
          const r = idx[c].get(id);
          if (!r) { onde[c] = 'FALTA'; algumFalta = true; return; }
          const h = this._hashRegistro(r);
          if (ref === null) ref = h;
          else if (ref !== h) algumDifere = true;
          onde[c] = h;
        });
        if (!algumFalta && !algumDifere) continue;

        // O caso perigoso, e o único que pede ação imediata: o registro está
        // na fatia operacional (foi salvo aqui), NÃO está no espelho, e o
        // mapa de sincronização não o conhece — ou seja, ainda não subiu. O
        // próximo pull vai mesclar a nuvem contra o espelho, que não o
        // contém, e gravar o resultado por cima de jr_sac_db.
        const emRisco = onde.sacDb !== 'FALTA' && onde.sacDb !== 'n/a'
          && onde.espelho === 'FALTA'
          && (!conhecidos || conhecidos[id] === undefined);
        if (emRisco) totalEmRisco++;
        totalDivergentes++;

        const amostra = idx.sacDb.get(id) || idx.memoria.get(id) || idx.espelho.get(id) || {};
        achados.push({ id, emRisco, onde, rotulo: this._rotuloDoRegistro(amostra) });
      }

      if (achados.length > 0) {
        tabelas.push({
          tabela: m.tableName,
          espelho: m.localKey,
          // Ordena para o que exige ação aparecer primeiro na tela e no
          // console — lista longa sem ordem é lista que ninguém lê.
          divergentes: achados.sort((a, b) => (b.emRisco - a.emRisco)).slice(0, 50),
          total: achados.length,
          emRisco: achados.filter(a => a.emRisco).length,
          contagens: {
            memoria: camadas.memoria ? camadas.memoria.length : null,
            sacDb:   camadas.sacDb   ? camadas.sacDb.length   : null,
            espelho: camadas.espelho ? camadas.espelho.length : null
          }
        });
      }
    }

    return {
      quando: agoraIsoBrasilia(),
      build: CloudStore.BUILD,
      totalDivergentes,
      totalEmRisco,
      tabelas: tabelas.sort((a, b) => (b.emRisco - a.emRisco) || (b.total - a.total))
    };
  }

  // Um jeito humano de reconhecer o registro na lista, sem despejar o objeto
  // inteiro: placa, carga, cliente, nome — o que houver, nessa ordem.
  _rotuloDoRegistro(r) {
    if (!r || typeof r !== 'object') return '';
    const campos = ['veiculo_placa', 'placa', 'carga_numero', 'carga', 'carga_rota',
                    'protocolo', 'nota_fiscal', 'cliente_nome', 'motorista_nome',
                    'nome', 'colaborador', 'data'];
    const partes = [];
    for (const c of campos) {
      if (r[c] !== undefined && r[c] !== null && String(r[c]).trim() !== '') {
        partes.push(String(r[c]).trim());
        if (partes.length === 2) break;
      }
    }
    return partes.join(' / ');
  }

  // =================================================================
  // RASTREAR UM REGISTRO — a pergunta que ninguém conseguia fazer
  //
  // Recebe o que o operador tem na mão (uma placa, uma carga, uma NF, um
  // protocolo, um id) e devolve, para cada cópia encontrada, o estado nas
  // quatro camadas locais MAIS o que a nuvem tem de fato — lido agora,
  // direto, sem passar por cache nenhum.
  //
  // É a única leitura do sistema que compara os cinco lugares ao mesmo
  // tempo, e por isso é a única que consegue dizer QUAL deles está velho.
  // =================================================================
  async rastrearRegistro(termo) {
    const alvo = String(termo || '').trim().toUpperCase();
    if (!alvo) return { termo: '', achados: [], erro: 'Informe uma placa, carga, NF, protocolo ou id.' };

    let sacDb = {};
    try { sacDb = JSON.parse(localStorage.getItem('jr_sac_db') || '{}') || {}; } catch(e) {}
    const memoria = (window.db && window.db.data) || {};
    const mapa = this._lerMapaSync();

    const bate = (r) => {
      if (!r || typeof r !== 'object') return false;
      if (String(r.id) === alvo) return true;
      for (const k of Object.keys(r)) {
        const v = r[k];
        if (v === null || v === undefined || typeof v === 'object') continue;
        if (String(v).trim().toUpperCase() === alvo) return true;
      }
      return false;
    };

    const achados = [];
    for (const m of CloudStore.MAPA_TABELAS) {
      const camadas = {
        memoria:  Array.isArray(memoria[m.dbKey]) ? memoria[m.dbKey] : null,
        sacDb:    Array.isArray(sacDb[m.dbKey])   ? sacDb[m.dbKey]   : null,
        espelho:  this._lerColecaoEspelho(m.localKey)
      };
      const ids = new Set();
      ['memoria', 'sacDb', 'espelho'].forEach(c => {
        (camadas[c] || []).forEach(r => { if (bate(r) && r.id != null) ids.add(String(r.id)); });
      });
      if (ids.size === 0) continue;

      const idx = {
        memoria: this._porId(camadas.memoria),
        sacDb:   this._porId(camadas.sacDb),
        espelho: this._porId(camadas.espelho)
      };
      const conhecidos = (mapa && mapa[m.tableName]) || null;

      for (const id of ids) {
        const linha = { tabela: m.tableName, id, camadas: {} };
        ['memoria', 'sacDb', 'espelho'].forEach(c => {
          if (!camadas[c]) { linha.camadas[c] = { estado: 'n/a' }; return; }
          const r = idx[c].get(id);
          linha.camadas[c] = r
            ? { estado: 'presente', hash: this._hashRegistro(r), rotulo: this._rotuloDoRegistro(r) }
            : { estado: 'ausente' };
        });
        linha.camadas.hashMap = (!conhecidos || conhecidos[id] === undefined)
          ? { estado: 'nunca confirmado' }
          : { estado: 'confirmado', hash: conhecidos[id] };

        // A nuvem, agora, sem cache. O filtro id=eq. desvia da paginação de
        // propósito: aqui se quer UMA linha, não a tabela inteira.
        let naNuvem = { estado: 'nao consultada' };
        if (this.isConfigured()) {
          const linhas = await this._getPagina(m.tableName, 'id=eq.' + encodeURIComponent(id));
          if (linhas === null) naNuvem = { estado: 'falha ao consultar' };
          else if (linhas.length === 0) naNuvem = { estado: 'ausente' };
          else naNuvem = { estado: 'presente', hash: this._hashRegistro(linhas[0]), registro: linhas[0] };
        }
        linha.camadas.nuvem = naNuvem;
        linha.veredito = this._vereditoDoRastreio(linha.camadas);
        achados.push(linha);
      }
    }

    return { termo: alvo, quando: agoraIsoBrasilia(), achados };
  }

  // Traduz a combinação das cinco camadas numa frase acionável. A ordem dos
  // testes é a ordem da gravidade: o primeiro que casar é o que manda.
  _vereditoDoRastreio(c) {
    const presente = (x) => c[x] && c[x].estado === 'presente';
    const ausente  = (x) => c[x] && c[x].estado === 'ausente';

    if (ausente('nuvem') && presente('sacDb') && ausente('espelho')
        && c.hashMap.estado === 'nunca confirmado') {
      return { nivel: 'CRITICO', texto: 'Salvo neste aparelho, ainda nao subiu, e o espelho nao o tem: o proximo pull apaga este registro. Force o envio antes de fechar o app.' };
    }
    if (ausente('nuvem') && c.hashMap.estado === 'confirmado') {
      return { nivel: 'CRITICO', texto: 'O mapa de sincronizacao diz que a nuvem ja confirmou este registro, mas ele nao esta la. Nunca mais sera reenviado sozinho, e o proximo pull o trata como apagado.' };
    }
    if (ausente('nuvem')) {
      return { nivel: 'ATENCAO', texto: 'So existe neste aparelho. Ainda nao subiu: normal por alguns segundos, problema se persistir depois de um ciclo de 30s.' };
    }
    if (presente('nuvem') && ausente('sacDb') && ausente('memoria')) {
      return { nivel: 'ATENCAO', texto: 'Esta na nuvem e nao neste aparelho. Pode ser a janela operacional (90 dias) ou um pull que ainda nao rodou.' };
    }
    if (presente('nuvem') && presente('memoria') && c.memoria.hash !== c.nuvem.hash
        && c.hashMap.estado === 'confirmado' && c.hashMap.hash === c.nuvem.hash) {
      return { nivel: 'ATENCAO', texto: 'A tela mostra uma versao diferente da que esta na nuvem, e a diferenca nao esta marcada como alteracao local. E resquicio de tela: recarregue.' };
    }
    if (presente('sacDb') && presente('espelho') && c.sacDb.hash !== c.espelho.hash) {
      return { nivel: 'ATENCAO', texto: 'As duas copias locais discordam entre si. O espelho esta velho, e e essa diferenca que o proximo pull vai resolver, nem sempre a favor do que esta na tela.' };
    }
    if (presente('memoria') && presente('sacDb') && c.memoria.hash !== c.sacDb.hash) {
      return { nivel: 'ATENCAO', texto: 'A memoria e o que esta gravado discordam. A tela esta desenhando algo que nao foi salvo.' };
    }
    return { nivel: 'OK', texto: 'As copias batem entre si e com a nuvem.' };
  }

  // =================================================================
  // REGISTRO DE APARELHO — Onda 2, item 12 (22/08/2026)
  //
  // Responde "qual máquina está em qual versão, e qual delas está com
  // cache contaminado" sem ninguém sair andando pela empresa — e sobretudo
  // sem depender do console, que **não existe em celular**. Cada aparelho
  // publica a própria ficha; a tela fica em Governança → Aparelhos.
  //
  // NÃO usa upsert(): se a tabela ainda não existir (a ETAPA 2b roda logo
  // depois do deploy), o upsert marcaria a tabela como pendente e acenderia
  // o alerta vermelho de "dados não salvos" para todo mundo, por um
  // problema que não é de dado do usuário. Aqui a falha é silenciosa de
  // propósito — no máximo um aviso no console.
  // =================================================================
  _plataformaDoAparelho() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const so = /Android/i.test(ua) ? 'Android'
             : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad'
             : /Windows/i.test(ua) ? 'Windows'
             : /Mac OS/i.test(ua) ? 'Mac'
             : /Linux/i.test(ua) ? 'Linux' : 'Desconhecido';
    const nav = /Edg\//.test(ua) ? 'Edge'
              : /OPR\//.test(ua) ? 'Opera'
              : /Chrome\//.test(ua) ? 'Chrome'
              : /Firefox\//.test(ua) ? 'Firefox'
              : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
    return so + ' / ' + nav;
  }

  apelidoDoAparelho() {
    try {
      const salvo = localStorage.getItem('jr_device_apelido');
      if (salvo) return salvo;
    } catch(e) {}
    return this._plataformaDoAparelho();
  }

  nomearAparelho(apelido) {
    const nome = String(apelido || '').trim().slice(0, 60);
    if (!nome) return false;
    try { localStorage.setItem('jr_device_apelido', nome); } catch(e) {}
    this.registrarAparelho().catch(() => {});
    return true;
  }

  async registrarAparelho() {
    if (!this.isConfigured()) return false;
    const ficha = {
      id: CloudStore.idDoAparelho(),
      apelido: this.apelidoDoAparelho(),
      plataforma: this._plataformaDoAparelho(),
      build: CloudStore.BUILD,
      ultimo_usuario: (window.db && window.db.currentUser && window.db.currentUser.nome) || null,
      ultimo_acesso: agoraIsoBrasilia(),
      // O número que identifica o aparelho da ETAPA 3. Zero é o esperado.
      registros_recusados: this._bloqueadosNaEscrita ? this._bloqueadosNaEscrita.total : 0
    };
    try {
      const resp = await fetch(`${this.config.url}/rest/v1/dispositivos`, {
        method: 'POST',
        headers: this._headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([ficha])
      });
      if (!resp.ok) {
        // 404 = a ETAPA 2b ainda não rodou. Não é erro do usuário.
        if (!this._avisouFaltaDispositivos) {
          this._avisouFaltaDispositivos = true;
          console.warn(`[CloudStore] Não foi possível registrar este aparelho (HTTP ${resp.status}). Se for 404, a tabela "dispositivos" ainda não foi criada — ver ETAPA 2b do GO_LIVE.md.`);
        }
        return false;
      }
      return true;
    } catch(e) {
      return false;
    }
  }

  async listarAparelhos() {
    const lista = await this.getAll('dispositivos');
    if (!Array.isArray(lista)) return null;
    return lista.sort((a, b) => String(b.ultimo_acesso || '').localeCompare(String(a.ultimo_acesso || '')));
  }

  // Fase 4 (20/08/2026): motoristas.cnh e usuarios.email são UNIQUE no
  // banco. Quando dois aparelhos offline cadastram, cada um sem saber do
  // outro, o mesmo CNH/e-mail com ids diferentes, o upsert acima falha
  // inteiro com violação de unicidade (código Postgres 23505) — e como o
  // upsert reenvia a tabela inteira a cada ciclo, nada daquela tabela
  // sincroniza até alguém corrigir manualmente. Em vez de sobrescrever
  // automaticamente (decisão do usuário: gestor revisa manualmente),
  // registra o conflito localmente para aparecer na tela de Governança.
  //
  // (achado em 20/08/2026, testando contra a nuvem de verdade) a primeira
  // versão tentava extrair a coluna/valor duplicado do texto do erro do
  // Postgres (campo "details", formato "Key (cnh)=(123) already exists.").
  // Esse projeto Supabase devolve "details":null para o anon key (oculta
  // detalhe interno do erro por segurança) — só "code":"23505" é confiável.
  // Por isso, em vez de tentar ler o valor do erro, reconsulta a nuvem
  // pelo valor de cada registro do lote que falhou; quem já existe lá com
  // um id diferente é o conflito real.
  // Fase 5 (21/08/2026): esta checagem só reconhecia motoristas.cnh e
  // usuarios.email como colunas UNIQUE. Mas ocorrencias_devolucao.numero_protocolo,
  // ocorrencias_rota.numero_protocolo, retencoes_frota.numero_retencao e
  // sinistros.numero_sinistro também são UNIQUE no banco (schema.sql) — e
  // caíam fora do "if" acima, então uma colisão nesses campos (dois
  // aparelhos gerando o mesmo número sequencial offline) nunca era
  // reconhecida como conflito: o registro simplesmente não sincronizava,
  // sem aparecer na aba "⚠️ Conflitos" nem em nenhum outro aviso.
  // medidas_disciplinares.numero_medida fica de fora de propósito: não tem
  // UNIQUE no banco, então uma colisão ali não derruba o upsert (é um
  // problema de qualidade do dado, não de sincronização silenciosa).
  async _checkConflitoUnicidade(tableName, errBody, records) {
    const CAMPOS_UNICOS_POR_TABELA = {
      // A migration_25 cria índice único parcial sobre controle_viagens.carga
      // (decisão 1: uma carga, uma viagem). Sem esta linha, a colisão cairia
      // no mesmo buraco silencioso que os números de protocolo caíam antes
      // da Fase 5 — envio recusado, nada na aba "⚠️ Conflitos".
      controle_viagens: 'carga',
      motoristas: 'cnh',
      usuarios: 'email',
      ocorrencias_devolucao: 'numero_protocolo',
      ocorrencias_rota: 'numero_protocolo',
      retencoes_frota: 'numero_retencao',
      sinistros: 'numero_sinistro'
    };
    const campo = CAMPOS_UNICOS_POR_TABELA[tableName];
    if (!campo) return;
    if (!window.db || typeof window.db.registrarConflitoSincronizacao !== 'function') return;
    let code = null;
    try { code = JSON.parse(errBody).code; } catch(e) {}
    if (code !== '23505') return;

    const data = Array.isArray(records) ? records : [records];
    for (const rec of data) {
      const valor = rec[campo];
      if (!valor) continue;
      try {
        const resp = await fetch(
          `${this.config.url}/rest/v1/${tableName}?select=id,${campo}&${campo}=eq.${encodeURIComponent(valor)}`,
          { headers: this._headers() }
        );
        if (!resp.ok) continue;
        const rows = await resp.json();
        const conflita = rows.some(r => String(r.id) !== String(rec.id));
        if (conflita) {
          window.db.registrarConflitoSincronizacao({ tabela: tableName, campo, valor });
        }
      } catch(e) {
        // falha de rede na re-consulta — não é crítico, só não registra
        // esse conflito agora; ele será detectado de novo no próximo ciclo.
      }
    }
  }

  // ---------------------------------------------------------------
  // COLISÃO DE NÚMERO SEQUENCIAL: RENUMERA E REENVIA (02/09/2026)
  //
  // O QUE ISTO CONSERTA. Em 31/08 dois aparelhos geraram DEV-2026-016 na
  // mesma tarde: o do SAC às 15:33, o da bancada às 15:59. O segundo chegou
  // primeiro, e a partir dali TODO envio de ocorrencias_devolucao daquele
  // aparelho voltou 409/23505 em uq_devolucao_protocolo. Como o POST é um
  // lote só, o registro colidido levou junto as seis devoluções abertas
  // depois dele: DEV-017 a DEV-022 ficaram DOIS DIAS presas no PC do SAC,
  // com o indicador da nuvem verde e ninguém sabendo. A unidade da falha é
  // o lote, não o registro — é isso que transforma um número repetido numa
  // fila inteira parada.
  //
  // POR QUE A COLISÃO EXISTE. getNextSequenceNumber() (store.js) gera o
  // número olhando só o estado LOCAL. O syncCloudToLocal() que a abertura
  // faz antes de gerar (app.js:7443) resolve metade do problema — o
  // aparelho atrasado — mas não protege contra o número ser criado por
  // OUTRO aparelho DEPOIS. Enquanto a numeração nascer no cliente contra
  // uma coluna UNIQUE, a colisão volta; o que dá para garantir aqui é que
  // ela pare de travar a fila.
  //
  // SÓ RENUMERA NÚMERO DE PROTOCOLO. motoristas.cnh, usuarios.email e
  // controle_viagens.carga também são UNIQUE, e ali o valor é do mundo real:
  // renumerar seria inventar dado. Esses continuam no caminho antigo —
  // conflito registrado para a aba "⚠️ Conflitos" e envio recusado.
  //
  // SÓ MEXE EM QUEM COLIDE DE VERDADE. Consulta a nuvem e renumera apenas o
  // registro cujo número já está lá sob OUTRO id. Se o 23505 vier de um
  // índice diferente, nada colide, nada é renumerado, e a falha segue
  // inteira para o caminho antigo. É a diferença entre consertar a colisão e
  // trocá-la por um número inventado.
  //
  // O NÚMERO NOVO É REGISTRADO. Protocolo é documento: vai para audit_logs
  // como RENUMERACAO_AUTOMATICA, que é o que o "📜 Ver histórico" do card lê.
  // Trocar um protocolo em silêncio seria repetir o defeito que esta função
  // existe para acabar.
  // ---------------------------------------------------------------
  async _resolverColisaoDeSequencia(tableName, errBody, payload, originais) {
    const spec = CloudStore.SEQUENCIAS_RENUMERAVEIS[tableName];
    if (!spec) return 0;

    let code = null;
    try { code = JSON.parse(errBody).code; } catch(e) {}
    if (code !== '23505') return 0;

    // Quem está na nuvem com cada número, e sob qual id. As quatro tabelas
    // com número sequencial são pequenas (dezenas de linhas) e aqui descem
    // só duas colunas — não é o select=* paginado do pull, cabe numa
    // requisição. Se a leitura falhar, não há como saber quem colide: sai
    // sem renumerar nada.
    let naNuvem;
    try {
      const resp = await fetch(
        `${this.config.url}/rest/v1/${tableName}?select=id,${spec.unico}&limit=10000`,
        { headers: this._headers() }
      );
      if (!resp.ok) return 0;
      naNuvem = await resp.json();
    } catch(e) {
      return 0;
    }
    if (!Array.isArray(naNuvem)) return 0;

    const donoNaNuvem = new Map();
    for (const r of naNuvem) {
      const v = String(r[spec.unico] || '');
      if (v) donoNaNuvem.set(v, String(r.id));
    }

    // Universo do que já está tomado: nuvem MAIS este aparelho. Sem a parte
    // local, a renumeração poderia cair em cima de um número que só existe
    // aqui e ainda não subiu — trocando uma colisão por outra, que é
    // exatamente o que aconteceu em 31/08.
    const locais = (window.db && window.db.data && Array.isArray(window.db.data[tableName]))
      ? window.db.data[tableName]
      : [];
    const tomados = new Set(donoNaNuvem.keys());
    for (const r of locais) {
      const v = String(r[spec.unico] || '');
      if (v) tomados.add(v);
    }

    const numeroDe = v => {
      const m = String(v || '').match(/(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    };
    let maiorN = 0;
    tomados.forEach(v => { const n = numeroDe(v); if (n > maiorN) maiorN = n; });

    let renumerados = 0;
    for (const rec of payload) {
      const valor = String(rec[spec.unico] || '');
      if (!valor) continue;
      const dono = donoNaNuvem.get(valor);
      if (!dono || dono === String(rec.id)) continue;   // não é colisão

      let novoN = maiorN;
      let novos = null;
      do {
        novoN++;
        novos = this._renderizarSequencia(rec, spec, novoN);
      } while (novos && tomados.has(novos[spec.unico]));
      if (!novos) continue;   // formato que não termina em dígitos: não mexe
      maiorN = novoN;

      const antes = {};
      Object.keys(novos).forEach(k => { antes[k] = rec[k]; });

      // TRÊS cópias do mesmo registro precisam receber o número novo:
      //   1. o objeto que vai no POST desta retentativa (payload);
      //   2. o do array que syncLocalToCloud passou, porque é dele que
      //      _confirmarEnvio() tira o hash — com o valor velho ali, o
      //      registro voltaria "sujo" no ciclo seguinte, para sempre;
      //   3. o registro vivo em db.data, senão a tela segue mostrando o
      //      número antigo e o próximo save() regrava a colisão.
      Object.assign(rec, novos);
      const original = (originais || []).find(o => o && String(o.id) === String(rec.id));
      if (original && original !== rec) Object.assign(original, novos);
      const vivo = locais.find(o => o && String(o.id) === String(rec.id));
      if (vivo && vivo !== rec) Object.assign(vivo, novos);

      tomados.add(novos[spec.unico]);
      renumerados++;

      console.warn(
        `[CloudStore] COLISÃO DE NÚMERO em ${tableName}: "${valor}" já estava na nuvem sob o id ${dono}. ` +
        `Este registro (id ${rec.id}) passou a ser "${novos[spec.unico]}" e o lote será reenviado.`
      );
      if (window.db && typeof window.db.logAudit === 'function') {
        window.db.logAudit({
          acao: 'RENUMERACAO_AUTOMATICA',
          modulo: tableName,
          registro_id: rec.id,
          diff: { antes, depois: novos, motivo: `Número já existia na nuvem sob o id ${dono}.` }
        });
      }
    }

    if (renumerados > 0 && window.db && typeof window.db.save === 'function') window.db.save();
    return renumerados;
  }

  // Aplica o número `n` a todos os campos de sequência do registro,
  // preservando o prefixo e a largura DE CADA UM. Em ocorrencias_devolucao,
  // 'DEV-2026-016' e 'DEV-016' são o mesmo número em dois formatos: mexer só
  // no que tem UNIQUE deixaria os dois se contradizendo na tela e no PDF.
  //
  // O prefixo sai do valor atual, e não de uma constante: 'DEV-2026-' vira
  // 'DEV-2027-' na virada do ano sem ninguém tocar aqui. Devolve null quando
  // o campo com UNIQUE não termina em dígitos — formato que esta função não
  // entende ela não renumera.
  _renderizarSequencia(rec, spec, n) {
    const aplicar = valor => {
      const m = String(valor || '').match(/^(.*?)(\d+)$/);
      return m ? m[1] + String(n).padStart(m[2].length, '0') : null;
    };
    const principal = aplicar(rec[spec.unico]);
    if (!principal) return null;
    const saida = {};
    saida[spec.unico] = principal;
    for (const campo of (spec.espelhos || [])) {
      const v = aplicar(rec[campo]);
      if (v) saida[campo] = v;
    }
    return saida;
  }

  // ---------------------------------------------------------------
  // LIMPEZA DE DADOS DE TREINAMENTO NA NUVEM
  // Usado pelo "Reset Global de Treinamento" (store.js) para zerar na
  // nuvem as mesmas tabelas operacionais/transacionais que o reset já
  // zerava só localmente. Mantém cadastros mestre (usuarios, motoristas,
  // veiculos, clientes, produtos, setores) intactos.
  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // CARIMBO DE RESET (tabela sync_control) — ver migration_23
  // Resolve a ambiguidade do "vazio": nuvem vazia porque alguém apagou
  // de propósito, ou porque o envio nunca funcionou? Sem esse carimbo o
  // aparelho que ainda tem o dado no cache reenvia e desfaz o reset.
  // ---------------------------------------------------------------
  async _lerResetEpochNuvem() {
    if (!this.isConfigured()) return 0;
    try {
      const resp = await fetch(`${this.config.url}/rest/v1/sync_control?select=reset_epoch&id=eq.1`, {
        headers: this._headers()
      });
      if (!resp.ok) return 0; // tabela ainda não criada — comportamento antigo
      const rows = await resp.json();
      return (rows && rows[0] && Number(rows[0].reset_epoch)) || 0;
    } catch(e) {
      return 0;
    }
  }

  async _publicarResetEpoch(quemFez) {
    if (!this.isConfigured()) return false;
    const epoch = Date.now();
    try {
      const resp = await fetch(`${this.config.url}/rest/v1/sync_control?id=eq.1`, {
        method: 'PATCH',
        headers: this._headers({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({
          reset_epoch: epoch,
          reset_em: new Date(epoch).toISOString(),
          reset_por: String(quemFez || 'SISTEMA').slice(0, 120)
        })
      });
      if (!resp.ok) {
        console.warn('[CloudStore] Não foi possível publicar o carimbo de reset:', resp.status, await resp.text());
        return false;
      }
      // Este aparelho já está no estado pós-reset: registra para não
      // tentar aplicar o próprio reset de volta em si mesmo.
      try { localStorage.setItem('jr_reset_epoch', String(epoch)); } catch(e) {}
      return true;
    } catch(e) {
      console.warn('[CloudStore] Falha de rede ao publicar o carimbo de reset:', e.message);
      return false;
    }
  }

  // ---------------------------------------------------------------
  // APAGAR UM REGISTRO NA NUVEM — 26/08/2026
  //
  // POR QUE ISTO PRECISOU EXISTIR. store.js -> hardDelete() ("Exclusão
  // Definitiva", com senha de administrador, na tela de Governança &
  // Lixeira) fazia UMA coisa só: tirar o registro do array local e salvar.
  // Na nuvem ele continuava inteiro. E aí o ciclo de 30 segundos o trazia
  // de volta, porque _mesclarPorRegistro() vê um id que existe na nuvem e
  // não existe aqui e conclui — corretamente, dado o que ele sabe — que
  // este aparelho ainda não conhece o registro:
  //
  //     const local = porId.get(id);
  //     if (!local) { resultado.push(nuvem); ... }
  //
  // Ou seja: a exclusão definitiva era definitiva por menos de meio minuto.
  // Quem apagava via a linha sumir, recarregava depois e a encontrava lá,
  // sem nenhuma mensagem de erro no meio — o pior formato de falha, o que
  // parece ter funcionado.
  //
  // O MESMO BURACO EXPLICA A DEV-2026-001 E A DEV-2026-002, que
  // atravessaram o Reset Global de 26/08/2026 09:02: o reset limpa a nuvem,
  // mas o aparelho que ainda tinha os registros em cache os reenviou no push
  // seguinte pelo caminho de baixo de _mesclarPorRegistro ("nunca subiu: é
  // trabalho local pendente"). Apagar dos dois lados é o que fecha o ciclo.
  //
  // NÃO USA A ROTA DE LOTE do clearCloudTrainingData de propósito: aqui o
  // filtro é `id=eq.X`, um registro nomeado. Um erro de digitação em
  // `id=not.is.null` esvazia a tabela inteira, e essa distância é a única
  // proteção que existe entre uma exclusão e um acidente.
  async apagarRegistro(tableName, id) {
    if (!this.isConfigured()) return { success: true, skipped: true };
    if (id === undefined || id === null || String(id).trim() === '') {
      return { success: false, message: 'ID vazio — nada foi apagado na nuvem.' };
    }
    try {
      const url = `${this.config.url}/rest/v1/${tableName}?id=eq.${encodeURIComponent(String(id))}`;
      const resp = await fetch(url, {
        method: 'DELETE',
        headers: this._headers({ 'Prefer': 'return=minimal' })
      });
      if (!resp.ok) {
        const corpo = await resp.text();
        console.warn(`[CloudStore] Não foi possível apagar ${tableName} id=${id} na nuvem:`, resp.status, corpo);
        return { success: false, message: `A nuvem recusou a exclusão (HTTP ${resp.status}).`, corpo };
      }
      // Sai também do mapa de sync: senão o id fica lá como "conhecido" e o
      // mapa cresce sem parar com fantasmas.
      try {
        const mapa = this._lerMapaSync();
        if (mapa[tableName]) { delete mapa[tableName][String(id)]; this._mapaSync = mapa; this._gravarMapaSync(); }
      } catch(e) {}
      return { success: true };
    } catch(e) {
      console.warn(`[CloudStore] Falha de rede ao apagar ${tableName} id=${id}:`, e.message);
      return { success: false, message: `Sem rede para apagar na nuvem: ${e.message}` };
    }
  }

  async clearCloudTrainingData() {
    if (!this.isConfigured()) return { success: true, skipped: true };
    const tabelas = [
      'ocorrencias_devolucao', 'itens_devolucao', 'cargas', 'controle_viagens',
      'ocorrencias_viagens', 'ocorrencias_rota', 'resumo_diario_cd',
      'relatorios_divergencia', 'auditoria_produtividade', 'trocas_veiculos',
      'retencoes_frota', 'reentregas_rota', 'audit_logs', 'registro_versoes',
      'sinistros', 'itens_avulsos_destinacao'
    ];
    let ok = true;
    for (const t of tabelas) {
      try {
        const response = await fetch(`${this.config.url}/rest/v1/${t}?id=not.is.null`, {
          method: 'DELETE',
          headers: this._headers()
        });
        if (!response.ok) {
          ok = false;
          console.warn(`[CloudStore] Erro ao limpar ${t} na nuvem:`, response.status, await response.text());
        }
      } catch(e) {
        ok = false;
        console.warn(`[CloudStore] Falha na rede ao limpar ${t} na nuvem:`, e.message);
      }
    }

    // Carimba o reset para que os OUTROS aparelhos saibam que este vazio é
    // proposital e limpem o próprio cache em vez de reenviar o que tinham.
    const carimbou = await this._publicarResetEpoch(
      (window.db && window.db.currentUser && window.db.currentUser.nome) || 'ADMIN'
    );
    if (!carimbou) {
      console.warn('[CloudStore] ATENÇÃO: o reset limpou a nuvem mas o carimbo não foi gravado. Outros aparelhos podem trazer os dados de volta. Rode a migration_23 e repita o reset.');
    }

    return { success: ok, carimbado: carimbou };
  }

  // ---------------------------------------------------------------
  // SINCRONIZAÇÃO AUTOMÁTICA: Local → Nuvem
  // Pega os dados do LocalStorage e envia para o Supabase
  // ---------------------------------------------------------------
  async syncLocalToCloud() {
    if (!this.isConfigured()) return;

    // TRAVA DE RESET (achado de 22/08/2026, 01:05)
    //
    // A devolução DEV-2026-001 (criada 00:48) reapareceu na nuvem DEPOIS do
    // Reset Global das 01:05, junto com as 15 viagens. Não foi lançada
    // sozinha: um aparelho que ainda tinha o registro em cache empurrou de
    // volta o que o reset tinha acabado de apagar.
    //
    // A proteção anterior vivia só no pull (syncCloudToLocal). Mas existem
    // CINCO caminhos que disparam o push sem pull antes — o debounce do
    // save(), o interceptador do alert(), o evento 'online' (que empurrava
    // primeiro e puxava depois), o startAutoSync e o flush do pull. Bastava
    // um deles rodar na janela entre o reset e o próximo pull daquele
    // aparelho para ressuscitar tudo.
    //
    // Por isso a trava fica aqui, no push, e não em quem chama: enquanto
    // este aparelho não tiver aplicado o reset mais recente da nuvem, ele
    // não tem autoridade para enviar nada. Puxa primeiro, envia depois.
    // O _aplicandoReset evita ida e volta infinita: syncCloudToLocal()
    // também chama o push (para dar vazão a gravações pendentes), então sem
    // essa marca os dois ficariam se chamando enquanto o reset não fosse
    // aplicado.
    if (!this._aplicandoReset) {
      const epochNuvem = await this._lerResetEpochNuvem();
      const epochLocal = Number(localStorage.getItem('jr_reset_epoch') || 0);
      if (epochNuvem > epochLocal) {
        console.warn('[CloudStore] Envio bloqueado: há um Reset Global mais recente na nuvem que este aparelho ainda não aplicou. Baixando o estado novo antes de enviar qualquer coisa.');
        this._aplicandoReset = true;
        try {
          // CHAMA _pullDaNuvem() DIRETO, E NÃO syncCloudToLocal() (28/08/2026).
          //
          // Este push pode estar rodando DE DENTRO de um pull: a primeira
          // coisa que _pullDaNuvem() faz é dar vazão a um envio pendente do
          // debounce, e é este caminho aqui. Se pedíssemos syncCloudToLocal(),
          // a trava de reentrância devolveria a Promise do pull que está
          // esperando por ESTE push — os dois ficariam esperando um pelo
          // outro para sempre, e como _pullEmAndamento nunca se limparia, o
          // aparelho pararia de sincronizar de vez, sem erro nenhum na tela.
          // Chamando o corpo direto, o comportamento é o mesmo de antes da
          // trava existir: um pull aninhado, que roda e volta.
          await this._pullDaNuvem();
        } finally {
          this._aplicandoReset = false;
        }
        return;
      }
    }

    // Mapeamento: chave no jr_sac_db / localStorage → tabela no Supabase
    //
    // ORDEM IMPORTA (achado de 21/08/2026): as tabelas são enviadas uma a
    // uma, na ordem deste array. Antes, ocorrencias_devolucao era a
    // PRIMEIRA — e ela referencia cargas, clientes, veiculos, motoristas e
    // usuarios, que só eram enviados DEPOIS. Toda devolução chegava ao
    // banco antes dos registros que ela aponta e era recusada em bloco por
    // violação de chave estrangeira (SQLSTATE 23503), em todo ciclo de
    // sincronização, para sempre. Agora os CADASTROS MESTRE (pais) vão
    // primeiro e as tabelas TRANSACIONAIS (filhos) depois.
    const mappings = [
      // --- 1) cadastros mestre: não dependem de ninguém ---
      { dbKey: 'usuarios',              localKey: 'jr_usuarios',          tableName: 'usuarios' },
      { dbKey: 'motoristas',            localKey: 'jr_motoristas',        tableName: 'motoristas' },
      { dbKey: 'ajudantes',             localKey: 'jr_ajudantes',         tableName: 'ajudantes' },
      { dbKey: 'veiculos',              localKey: 'jr_veiculos',          tableName: 'veiculos' },
      { dbKey: 'colaboradores_cd',      localKey: 'jr_colaboradores_cd',  tableName: 'colaboradores_cd' },
      // (achado de 21/08/2026) produtos e setores NUNCA estiveram nesta
      // lista: existiam como tabela no banco e como coleção local, mas
      // jamais saíam do aparelho que os cadastrou. Por isso a lista de
      // produtos da Devolução aparecia vazia — e o campo, que é um
      // <input list="produtos-list">, virava texto livre nos outros
      // aparelhos. Também eram as duas tabelas cujas FKs nunca teriam como
      // ser satisfeitas (ver migration_22).
      // --- 2) cargas: depende de motorista/ajudante/veículo ---
      { dbKey: 'cargas',                localKey: 'jr_cargas',            tableName: 'cargas' },
      // --- 3) transacionais: dependem dos cadastros acima ---
      { dbKey: 'ocorrencias_devolucao', localKey: 'jr_ocorrencias',       tableName: 'ocorrencias_devolucao' },
      { dbKey: 'ocorrencias_rota',      localKey: 'jr_ocorrencias_rota',  tableName: 'ocorrencias_rota' },
      { dbKey: 'retencoes_frota',       localKey: 'jr_retencoes_frota',   tableName: 'retencoes_frota' },
      { dbKey: 'reentregas',            localKey: 'jr_reentregas',        tableName: 'reentregas_rota' },
      { dbKey: 'trocas_veiculos',       localKey: 'jr_trocas_veiculos',   tableName: 'trocas_veiculos' },
      { dbKey: 'audit_logs',            localKey: 'jr_audit_logs',        tableName: 'audit_logs' },
      { dbKey: 'registro_versoes',      localKey: 'jr_registro_versoes',  tableName: 'registro_versoes' },
      // Adicionadas em 19/08/2026 — antes ficavam presas em localStorage,
      // sem tabela e sem sincronizar entre contas (achado do go-live).
      { dbKey: 'controle_viagens',      localKey: 'jr_controle_viagens',  tableName: 'controle_viagens' },
      { dbKey: 'ocorrencias_viagens',   localKey: 'jr_ocorrencias_viagens', tableName: 'ocorrencias_viagens' },
      { dbKey: 'resumo_diario_cd',      localKey: 'jr_resumo_diario_cd',  tableName: 'resumo_diario_cd' },
      { dbKey: 'medidas_disciplinares', localKey: 'jr_medidas_disciplinares', tableName: 'medidas_disciplinares' },
      { dbKey: 'orientacoes_feedback',  localKey: 'jr_orientacoes_feedback', tableName: 'orientacoes_feedback' },
      { dbKey: 'atestados_medicos',     localKey: 'jr_atestados_medicos', tableName: 'atestados_medicos' },
      { dbKey: 'ausencias_registros',   localKey: 'jr_ausencias_registros', tableName: 'ausencias_registros' },
      // Adicionadas em 20/08/2026 (auditoria externa) — existiam como
      // coleção local e tabela no schema.sql, mas nunca estavam nesta
      // lista, então nunca saíam do aparelho que as criou.
      // itens_devolucao aponta para ocorrencias_devolucao (enviada acima).
      // colaboradores_cd subiu para o bloco de cadastros mestre.
      { dbKey: 'itens_devolucao',       localKey: 'jr_itens_devolucao',   tableName: 'itens_devolucao' },
      { dbKey: 'relatorios_divergencia', localKey: 'jr_relatorios_divergencia', tableName: 'relatorios_divergencia' },
      { dbKey: 'auditoria_produtividade', localKey: 'jr_auditoria_produtividade', tableName: 'auditoria_produtividade' },
      { dbKey: 'sinistros',             localKey: 'jr_sinistros',         tableName: 'sinistros' },
      { dbKey: 'itens_avulsos_destinacao', localKey: 'jr_itens_avulsos_destinacao', tableName: 'itens_avulsos_destinacao' }
    ];

    // Independe de haver algo a enviar: é o que mantém o diagnóstico do
    // aparelho honesto para a ETAPA 3 (ver CONFERIR_APARELHO.md).
    this._auditarCacheLocal();

    // ---------------------------------------------------------------
    // A MEMÓRIA PRIMEIRO, O DISCO DEPOIS (04/09/2026)
    //
    // Isto lia SÓ o jr_sac_db. Num aparelho com a cota estourada, o
    // registro que o save() acabou de não conseguir gravar existe em
    // window.db.data e NÃO existe no disco — então o push relia o retrato
    // velho, o lançamento não subia para lugar nenhum e se perdia de vez
    // no primeiro F5. É exatamente o aparelho de 91% do relato de 04/09.
    //
    // Ler a memória é seguro porque ela nunca está atrás do disco: o pull
    // atualiza window.db.data ANTES de tentar gravar o cache (ver
    // _pullDaNuvem, "Memória primeiro, porque é de graça"), e o save()
    // serializa a memória para gravar. É a mesma coisa, sem depender de
    // uma gravação que pode ter falhado. Só as chaves deste mapeamento
    // são lidas, então clientes/produtos (que existem em db.data e não no
    // jr_sac_db) continuam de fora, como antes.
    // ---------------------------------------------------------------
    let fullDb = null;
    if (window.db && window.db.data) {
      fullDb = window.db.data;
    } else {
      try {
        const rawFull = localStorage.getItem('jr_sac_db');
        if (rawFull) fullDb = JSON.parse(rawFull);
      } catch(e) {}
    }

    for (const m of mappings) {
      try {
        let records = [];
        if (fullDb && Array.isArray(fullDb[m.dbKey])) {
          records = fullDb[m.dbKey];
        } else {
          const raw = localStorage.getItem(m.localKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            records = Array.isArray(parsed) ? parsed : Object.values(parsed);
          }
        }
        if (records && records.length > 0) {
          // Item 1 (22/08/2026): antes, isto era `upsert(tabela, records)` —
          // a tabela inteira, a cada gravação de qualquer tela. Agora sobe
          // só o que mudou aqui desde a última confirmação da nuvem.
          const mudados = this._separarOQueMudou(m.tableName, records);
          if (mudados.length === 0) continue;
          const enviou = await this.upsert(m.tableName, mudados);
          // Só marca como confirmado se o POST passou. Envio recusado
          // continua "sujo" e é tentado de novo no ciclo seguinte.
          if (enviou) this._confirmarEnvio(m.tableName, mudados);
        }
      } catch(e) {
        console.warn(`[CloudStore] Erro ao sincronizar ${m.tableName}:`, e);
      }
    }
    
    // CATÁLOGO (31/08/2026): caminho próprio, porque a origem local dele não
    // é o jr_sac_db — é o delta no IndexedDB. Fica depois do laço das 25
    // tabelas porque não tem pressa e não é dependência de ninguém: as FKs
    // que apontavam para clientes/produtos foram removidas na migration 22.
    // A LEITURA do catálogo NÃO acontece aqui: ela mora no _pullDaNuvem(),
    // junto com as outras leituras. Aqui é só o envio.
    await this._pushCatalogo();

    // Item 12: a ficha do aparelho sobe junto com o ciclo normal — assim o
    // "visto por último" da tela de Aparelhos é sempre real, e a contagem de
    // recusas acompanha o que a auditoria acabou de medir.
    this.registrarAparelho().catch(() => {});

    this._setStatus('online');
    console.log('[CloudStore] Sincronização Local → Nuvem concluída:', new Date().toLocaleTimeString('pt-BR'));
  }

  // ---------------------------------------------------------------
  // SINCRONIZAÇÃO AUTOMÁTICA: Nuvem → Local
  // Pega os dados do Supabase e atualiza o LocalStorage
  //
  // TRAVA DE REENTRÂNCIA (28/08/2026) — o corpo de verdade é
  // _pullDaNuvem(); esta função só garante que existe UM pull por vez.
  //
  // O ciclo faz uma requisição SEQUENCIAL por tabela, 25 delas. Num 4G da
  // doca, com 300ms de ida e volta por requisição, o ciclo passa de 8s, e
  // com tabela grande (mais de 500 linhas = mais de uma página) passa
  // fácil dos 30s do setInterval. Quando isso acontecia, o timer disparava
  // o pull seguinte com o anterior ainda no meio do laço: os dois escreviam
  // as mesmas chaves-espelho e o mesmo jr_sac_db, o mais lento terminando
  // por último e sobrepondo o mais novo. O aparelho ficava MAIS atrasado
  // quanto pior estivesse a rede — exatamente ao contrário do que se
  // espera. Agora, quem chega no meio de um pull recebe a Promise do que já
  // está rodando em vez de abrir um segundo.
  // ---------------------------------------------------------------
  syncCloudToLocal() {
    if (!this.isConfigured()) return Promise.resolve(false);
    if (this._pullEmAndamento) return this._pullEmAndamento;

    this._pullEmAndamento = this._pullDaNuvem()
      .then((r) => { this._ultimoPullOkMs = Date.now(); return r; })
      .finally(() => { this._pullEmAndamento = null; });

    return this._pullEmAndamento;
  }

  async _pullDaNuvem() {
    if (!this.isConfigured()) return false;

    // Se existe um envio local (push) agendado e ainda não disparado (ex:
    // dado que acabou de ser salvo e está no debounce de 1.5s — muito
    // comum logo após um alert() de sucesso, que bloqueia a aba e atrasa
    // esse envio), baixar da nuvem agora sobrescreveria esse dado local
    // ainda não enviado, perdendo-o (achado de 20/08/2026 — escala
    // importada sumia após um pull automático rodar antes do push
    // terminar). Forçamos esse envio pendente a completar primeiro.
    if (window.db && window.db._cloudSyncTimer) {
      clearTimeout(window.db._cloudSyncTimer);
      window.db._cloudSyncTimer = null;
      try { await this.syncLocalToCloud(); } catch(e) {}
    }

    // A lista mora em CloudStore.MAPA_TABELAS, no fim do arquivo, porque o
    // detector de resquicio (conferirCamadas/rastrearRegistro) precisa dela
    // tambem — e uma terceira copia do mapeamento envelheceria sozinha, que
    // e exatamente como 'produtos' e 'setores' passaram semanas sem sair do
    // aparelho que os cadastrou. Aqui a ordem nao importa: cada tabela e
    // lida por conta propria. No ENVIO importa (chave estrangeira), e por
    // isso syncLocalToCloud mantem a lista ordenada dele.
    const mappings = CloudStore.MAPA_TABELAS;

    // Um Reset Global feito em OUTRO aparelho precisa ser reconhecido aqui
    // antes de qualquer comparação, senão este aparelho reenvia o que o
    // outro acabou de apagar. Ver sync_control em migration_23.
    const epochNuvem = await this._lerResetEpochNuvem();
    const epochLocal = Number(localStorage.getItem('jr_reset_epoch') || 0);
    const resetRemotoPendente = epochNuvem > epochLocal;
    if (resetRemotoPendente) {
      console.warn(`[CloudStore] Reset Global detectado na nuvem (${new Date(epochNuvem).toLocaleString('pt-BR')}). Este aparelho vai adotar o estado da nuvem.`);
      // As marcas de "já sincronizou" perdem validade após um reset.
      try {
        Object.keys(localStorage)
          .filter(k => k.indexOf('jr_sync_ok_') === 0)
          .forEach(k => localStorage.removeItem(k));
      } catch(e) {}
    }

    let anyChange = false;
    // Guarda só as tabelas que realmente mudaram (dbKey -> dado da nuvem),
    // em vez de acumular direto num "fullDb" lido no início. O loop abaixo
    // faz uma requisição sequencial POR TABELA (mais de 20 no total) e pode
    // levar vários segundos — se alguém salvar algo localmente NESSE meio
    // tempo (ex: abrir uma devolução SAC), o save() já escreve certo em
    // jr_sac_db na hora. O bug (achado de 21/08/2026, reproduzido testando
    // o branch de teste): ao terminar, este pull reescrevia jr_sac_db
    // inteiro com o "fullDb" capturado no INÍCIO do loop — de antes desse
    // save() — apagando silenciosamente o registro recém-criado antes
    // mesmo dele chegar a ser enviado pra nuvem. Nenhum erro, nenhum
    // aviso: o dado simplesmente sumia. Agora só relemos e mesclamos por
    // cima do jr_sac_db mais atual no final, não do snapshot do início.
    const pulledUpdates = {};

    // Relê jr_sac_db a CADA chamada, e não uma vez no início, pelo mesmo
    // motivo do comentário acima: o laço leva segundos e um save() no meio
    // dele precisa ser enxergado. Só é usada quando não há window.db
    // (bancada de teste, ou o cloudStore rodando sem o store).
    const lerFatiaOperacional = (dbKey) => {
      try {
        const raw = localStorage.getItem('jr_sac_db');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && Array.isArray(parsed[dbKey])) ? JSON.stringify(parsed[dbKey]) : null;
      } catch(e) { return null; }
    };

    for (const m of mappings) {
      try {
        const cloudData = await this.getAll(m.tableName);
        if (!cloudData) continue;

        // QUEM É "O QUE ESTE APARELHO TEM" — correção de 23/08/2026
        //
        // Era `localStorage.getItem(m.localKey)`: o ESPELHO. E o espelho é
        // escrito só aqui, no pull — db.save() grava window.db.data e
        // jr_sac_db, e NUNCA ele (store.js:682). Ou seja: a mesclagem
        // comparava a nuvem contra uma cópia que podia estar horas atrasada,
        // e um lançamento salvo depois do último pull simplesmente não
        // existia para _mesclarPorRegistro. Não era preservado nem
        // descartado — não era considerado. O resultado da mesclagem era
        // gravado por cima de jr_sac_db e o registro sumia, sem erro e sem
        // aparecer em tabelasComPendencia. Achado em 23/08/2026 ao investigar
        // um relato de divergência entre aparelhos; está reproduzido em
        // testes/06_pull_nao_apaga_lancamento.js.
        //
        // NÃO confundir com o sintoma oposto — registro que APARECE sem
        // ninguém ter lançado. Aquilo é aparelho com cache antigo
        // republicando, ou registro que já estava na nuvem e só ficou
        // visível pelo filtro de período da tela. Causa diferente, conserto
        // diferente; ver PARTE 4 do CONFERIR_APARELHO.md.
        //
        // O ENVIO já tratava jr_sac_db como a verdade (syncLocalToCloud lê
        // fullDb primeiro e só cai no espelho como último recurso). A
        // correção é fazer a LEITURA concordar com a ESCRITA — as duas
        // metades do mesmo ciclo estavam olhando para cópias diferentes.
        //
        // A memória vem antes de jr_sac_db de propósito: se um save()
        // estourou a cota, window.db.data tem o registro e jr_sac_db não, e
        // na dúvida se preserva o trabalho do operador.
        //
        // O espelho continua sendo escrito no fim deste bloco. Ele deixa de
        // ser autoridade, não deixa de existir: syncLocalToCloud ainda o usa
        // como último recurso, e o detector (conferirCamadas) precisa dele
        // para conseguir enxergar divergência.
        const espelhoRaw = localStorage.getItem(m.localKey);
        let localRaw = espelhoRaw;
        if (window.db && window.db.data && Array.isArray(window.db.data[m.dbKey])) {
          localRaw = JSON.stringify(window.db.data[m.dbKey]);
        } else {
          const daFatia = lerFatiaOperacional(m.dbKey);
          if (daFatia !== null) localRaw = daFatia;
        }

        // (achado de 21/08/2026, diagnóstico da causa raiz) getAll() devolve
        // [] — não null — quando a tabela existe mas está VAZIA na nuvem. E
        // [] é "truthy" em JavaScript, então o `if (!cloudData) continue`
        // acima não protegia nada: o pull sobrescrevia a coleção local com
        // uma lista vazia e o registro desaparecia do aparelho que o criou,
        // em até 30s, sem nenhum aviso.
        //
        // Isso transformava QUALQUER falha de push (coluna inexistente, FK,
        // NOT NULL) em perda de dado: o registro não subia e ainda era
        // apagado localmente. Uma nuvem vazia nunca é autoridade sobre um
        // aparelho que tem dados — nesse caso o certo é reenviar, não apagar.
        // Mas "nuvem vazia" tem DOIS significados opostos, e confundi-los
        // recria o bug de 21/08/2026 (68 registros de treinamento voltando
        // do PC depois de um Reset feito no celular):
        //   (a) o push nunca funcionou para esta tabela  -> local é a
        //       verdade, preservar e reenviar;
        //   (b) alguém apagou de propósito na nuvem (Reset Global de
        //       Treinamento) -> a nuvem é a verdade, aceitar o vazio.
        // Distinguimos pela marca gravada abaixo, no upsert: ela só existe
        // se esta tabela JÁ subiu com sucesso alguma vez neste aparelho.
        if (Array.isArray(cloudData) && cloudData.length === 0) {
          let localTemDados = false;
          try {
            const parsed = localRaw ? JSON.parse(localRaw) : null;
            localTemDados = Array.isArray(parsed) && parsed.length > 0;
          } catch(e) {}
          const jaSincronizouAlgumaVez = !!localStorage.getItem('jr_sync_ok_' + m.tableName);
          // Se houve um Reset Global mais recente do que o último que este
          // aparelho aplicou, o vazio da nuvem é intencional: aceitar.
          // Sem isso, o aparelho que ainda tinha os registros no cache os
          // reenviava e ressuscitava tudo — foi o que aconteceu com as 15
          // viagens em 21/08/2026.
          if (resetRemotoPendente) {
            console.warn(`[CloudStore] ${m.tableName}: Reset Global remoto detectado — aceitando o vazio da nuvem.`);
          } else if (localTemDados && !jaSincronizouAlgumaVez) {
            console.warn(`[CloudStore] ${m.tableName}: nuvem vazia e esta tabela nunca subiu com sucesso — preservando o dado local e reenviando.`);
            this._tabelasPendentesDeEnvio.add(m.tableName);
            continue;
          }
        }

        // Item 2 (22/08/2026): antes, isto era
        // `localStorage.setItem(localKey, JSON.stringify(cloudData))` — a
        // coleção da nuvem substituía a local inteira, e o que este
        // aparelho tinha acabado de gravar sumia sem aviso. Agora a
        // decisão é registro a registro.
        const mesclado = this._mesclarPorRegistro(m.tableName, localRaw, cloudData);
        const mescladoStr = JSON.stringify(mesclado);

        // Duas decisões separadas, porque as duas cópias entram diferentes:
        // o espelho é atualizado sempre que estiver atrás (é o que o mantém
        // útil para o diagnóstico), e a fatia operacional só é marcada como
        // mudada se a mesclagem realmente mudar algo em relação ao que este
        // aparelho tem — que é o que dispara o redesenho da tela.
        // =========================================================
        // O ESPELHO NÃO PODE DERRUBAR A TABELA (28/08/2026)
        //
        // ERA AQUI. Este setItem lançava QuotaExceededError, o catch lá
        // embaixo engolia com um console.warn, e o `continue` implícito
        // pulava para a próxima tabela — ou seja, as DUAS linhas de baixo,
        // que são as que entregam o dado para a tela, nunca rodavam.
        //
        // O pull baixava a tabela certa e a descartava inteira para
        // proteger uma CÓPIA. Porque é isso que o espelho é: uma segunda
        // cópia de tudo que já está em jr_sac_db, mantida para o
        // diagnóstico (conferirCamadas) e como último recurso do envio.
        // Dado de verdade sendo jogado fora por causa de dado derivado.
        //
        // E como o estouro acontece na tabela que por acaso passou do
        // limite, cada aparelho perde uma tabela DIFERENTE, no dia em que
        // aquela tabela cresceu. É a explicação de três telas com três
        // números, todas "online", todas na mesma versão: não é a mesma
        // falha em três lugares, é a mesma mecânica sorteando vítimas
        // diferentes.
        //
        // Agora o espelho tem try/catch próprio e é BEST-EFFORT: se não
        // couber, ele é sacrificado — e o dado segue para a tela.
        // =========================================================
        if (espelhoRaw !== mescladoStr) {
          this._gravarEspelho(m.localKey, mescladoStr);
        }

        // Fora do if do espelho de propósito: o que a tela mostra não pode
        // depender de a segunda cópia ter cabido.
        if (localRaw !== mescladoStr) {
          pulledUpdates[m.dbKey] = mesclado;
          anyChange = true;
        }
      } catch(e) {
        console.warn(`[CloudStore] Erro ao baixar ${m.tableName}:`, e);
      }
    }

    if (anyChange) {
      // =============================================================
      // A MEMÓRIA É ATUALIZADA ANTES DO DISCO (28/08/2026)
      //
      // ESTE ERA O DEFEITO QUE CONGELAVA APARELHO INTEIRO. A ordem aqui
      // era: grava jr_sac_db -> atualiza window.db.data, tudo dentro de um
      // try com `catch(e) {}` VAZIO. Quando o localStorage estourava a cota
      // (o catálogo estático sozinho ocupa 2,9 MB de ~5 MB, e o Safari do
      // iPhone para perto disso), o setItem lançava na PRIMEIRA linha — e
      // levava junto a atualização da memória, que vinha depois e não tem
      // nada a ver com cota.
      //
      // O resultado é a pior combinação possível:
      //   - o pull baixou tudo certo, e o dado foi jogado fora;
      //   - `db.data` continua com o retrato do dia em que o aparelho
      //     encheu, e é dele que a tela desenha;
      //   - o `catch` vazio engole o erro: nada no console, nada na tela;
      //   - o indicador segue VERDE, porque o ENVIO continua funcionando
      //     (é ele que carimba "visto por último" no painel Aparelhos);
      //   - o aparelho continua empurrando o retrato velho para a nuvem.
      //
      // Ou seja: um aparelho com a cota cheia para no tempo e continua
      // parecendo saudável, na versão certa e "visto agora". Como cada
      // aparelho enche num dia diferente, cada um congela num retrato
      // diferente — que é exatamente o relato de três telas discordando na
      // mesma rede, na mesma versão.
      //
      // Memória primeiro, porque é de graça e não pode falhar por cota: a
      // TELA passa a mostrar a verdade mesmo num aparelho que não consegue
      // mais gravar. O cache em disco é otimização (abrir offline e rápido);
      // a tela é a operação.
      // =============================================================
      if (window.db && window.db.data) {
        Object.assign(window.db.data, pulledUpdates);
      }

      try {
        const rawFullNow = localStorage.getItem('jr_sac_db');
        const fullDb = rawFullNow ? JSON.parse(rawFullNow) : {};
        Object.assign(fullDb, pulledUpdates);
        this._gravarCacheDoPull(fullDb);

        // NÃO substituir window.db.data por fullDb (achado de 22/08/2026,
        // erro "Cannot read properties of undefined (reading 'filter')" na
        // tela de Cadastros).
        //
        // 'jr_sac_db' guarda só a FATIA OPERACIONAL: store.js:_getOperationalSlice()
        // remove clientes e produtos de propósito antes de gravar, porque são
        // 15.139 clientes e 4.010 produtos vindos da planilha Dados SAC — desde
        // 31/08/2026 eles não são persistidos por inteiro em lugar nenhum do
        // localStorage: vêm de js/mockData.js e só o delta vai para o
        // IndexedDB (ver js/catalogoStore.js).
        //
        // Trocar db.data por fullDb apagava clientes e produtos da memória a
        // cada pull — a lista de clientes sumia e db.data.produtos virava
        // undefined, quebrando a tela de Cadastros. Mesclamos apenas as chaves
        // que realmente vieram da nuvem, preservando o resto de db.data.
        if (window.db && !window.db.data) {
          window.db.data = fullDb;
        }

        // O pull acabou de sobrescrever motoristas/ajudantes/veiculos com o
        // que existe na nuvem. Se a nuvem estiver incompleta (ex: os 39
        // motoristas da planilha barrados pelo UNIQUE da cnh, deixando só 2
        // registros de teste), este aparelho ficaria com a lista curta — e
        // o push seguinte devolveria essa lista curta para a nuvem,
        // consolidando a perda.
        //
        // Reinserimos aqui o que a planilha Dados SAC garante, ANTES do
        // push. Assim o que falta na nuvem sobe em vez de o que sobra no
        // aparelho descer.
      } catch(e) {
        // Deixou de ser `catch(e) {}`. Um erro aqui significa que o cache em
        // disco ficou para trás do que a tela mostra — não é fatal (a
        // memória já foi atualizada acima), mas some depois de um F5, e
        // silêncio foi o que fez isso durar dias.
        console.error('[CloudStore] Erro ao aplicar no aparelho os dados baixados da nuvem:', e);
      }
    }

    // ITEM 8 (Onda 2, 22/08/2026) — AQUI RODAVA restaurarCadastrosDaPlanilha(),
    // A CADA CICLO DE 30 SEGUNDOS. Foi removido de propósito; não recoloque.
    //
    // O que ele fazia: reinjetava as listas de motoristas/ajudantes/veículos
    // embarcadas no mockData.js DESTE APARELHO em cima do que veio da nuvem.
    // Nasceu como rede de proteção em 22/08, quando o UNIQUE da cnh derrubou
    // os 39 motoristas e o pull reduziu a lista local a 2 registros.
    //
    // Por que sai: com ele no ciclo, (a) todo veículo vendido e todo
    // motorista desligado voltava à vida a cada 30 segundos, porque a
    // planilha embarcada não sabe de exclusão; e (b) UM aparelho com build
    // antiga contaminava o cadastro da empresa inteira, republicando a
    // lista velha dele para todo mundo. É a decisão 5: a planilha é a base
    // inicial, o app é a fonte de verdade depois.
    //
    // O que ficou no lugar: a semeadura roda UMA VEZ, na primeira instalação
    // do aparelho (store.js:init(), marcada em 'jr_seed_cadastros_v1'), e a
    // mesclagem por registro (item 2) é o que agora protege contra o pull
    // apagar cadastro — sem precisar reinjetar nada.

    // Só marca o reset como aplicado depois que o pull inteiro terminou —
    // se a rede cair no meio, o aparelho tenta de novo no próximo ciclo em
    // vez de ficar num estado meio-aplicado.
    if (resetRemotoPendente) {
      try { localStorage.setItem('jr_reset_epoch', String(epochNuvem)); } catch(e) {}
      // O reset foi feito em OUTRO aparelho e acabou de chegar neste. As
      // reentregas locais já foram substituídas pelo que veio da nuvem — que
      // é vazio — mas a fila de fotos vive no IndexedDB e não é tocada por
      // nada disso. Sem esta linha, este aparelho ficaria com a tarja âmbar
      // acesa para sempre e subindo um arquivo órfão por ciclo, comprovando
      // reentregas que já não existem em lugar nenhum.
      if (window.fotoStore) window.fotoStore.limparTudo().catch(() => {});
    }

    // CATÁLOGO (31/08/2026): leitura incremental própria, fora do laço das
    // 25 tabelas. Um cliente cadastrado em outro aparelho chega por aqui.
    let veioCatalogo = false;
    try {
      veioCatalogo = await this._pullCatalogo() === true;
    } catch (eCat) {
      console.warn('[CloudStore] Falha ao baixar o catálogo:', eCat && eCat.message);
    }

    if (anyChange || veioCatalogo) {
      console.log('[CloudStore] Dados atualizados da Nuvem para este aparelho.');
      // Dispara evento para que o app atualize a tela
      window.dispatchEvent(new CustomEvent('jr-cloud-sync', { detail: { updated: true } }));
    }

    return anyChange || veioCatalogo;
  }

  // ---------------------------------------------------------------
  // INICIA SINCRONIZAÇÃO AUTOMÁTICA A CADA N SEGUNDOS
  // ---------------------------------------------------------------
  startAutoSync() {
    if (!this.isConfigured()) return;
    this.stopAutoSync(); // cancela qualquer timer anterior
    
    const interval = this.config.syncIntervalMs || 30000;
    console.log(`[CloudStore] Sincronização automática iniciada (a cada ${interval/1000}s)`);

    // Fase 5 (21/08/2026): esta função tinha um ramo que empurrava (push) o
    // estado local ANTES de puxar (pull) sempre que este aparelho "já tinha
    // sincronizado antes" — pensado para uma migração pontual, só a
    // primeira vez que cada aparelho entrasse em modo nuvem (dados de teste
    // cadastrados localmente antes da nuvem existir). Só que a condição
    // ficava verdadeira pra sempre depois da primeira sincronização, então
    // esse push-antes-do-pull rodava em TODA abertura do app, em todo
    // aparelho — inclusive quando o cache local estava desatualizado (ex:
    // um Reset Global de Treinamento rodado só em OUTRO aparelho). Achado
    // de 21/08/2026: 68 registros de treinamento voltaram no PC porque ele
    // empurrou seu estado antigo antes de puxar o reset feito no celular.
    // Essa migração já passou — agora sempre puxa primeiro; só empurra (pra
    // mandar cadastros feitos localmente enquanto offline) depois que o
    // pull mais recente já foi aplicado.
    this.syncCloudToLocal()
      .catch(e => console.warn('[CloudStore] Falha ao puxar dados da nuvem na sincronização inicial:', e))
      .then(() => this.syncLocalToCloud())
      .catch(e => console.warn('[CloudStore] Falha ao enviar dados locais após a sincronização inicial:', e));

    this._syncTimer = setInterval(() => {
      this.syncCloudToLocal();
      // FILA DE FOTOS (v5.1.0). Anda de carona no mesmo ciclo de 30s em vez
      // de ter timer próprio: se a rede está boa o bastante para o pull, está
      // boa para a foto — e um segundo timer só teria como novidade a chance
      // de disparar quando o primeiro falhou.
      //
      // Sem await de propósito: um upload lento não pode atrasar a
      // sincronização dos dados, que é o que mantém a tela honesta.
      if (window.fotoStore) window.fotoStore.processarFila().catch(() => {});
      // Repinta o indicador para o "há Xmin" andar sozinho mesmo quando
      // nada muda de status.
      this._updateStatusIndicator(this._connectionStatus);
    }, interval);
  }

  stopAutoSync() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
  }

  // ---------------------------------------------------------------
  // SINCRONIZAÇÃO SOB DEMANDA (28/08/2026)
  //
  // Puxa e depois empurra, na hora, sem esperar o próximo tique dos 30s.
  // É o que os gatilhos de "voltou para a tela" chamam.
  //
  // O `idadeMinimaMs` evita ida à rede à toa: alternar entre duas abas dez
  // vezes em dez segundos não é dez motivos para baixar 25 tabelas. Se o
  // último pull terminou há menos que isso, a tela já é recente o bastante
  // e a chamada não faz nada. O padrão é 3s — só para agrupar rajadas de
  // eventos (visibilitychange + focus + pageshow chegam juntos no mesmo
  // gesto de destravar o celular), nunca para segurar dado.
  // ---------------------------------------------------------------
  sincronizarAgora(motivo, idadeMinimaMs = 3000) {
    if (!this.isConfigured()) return Promise.resolve(false);

    const idade = Date.now() - this._ultimoPullOkMs;
    if (this._ultimoPullOkMs && idade < idadeMinimaMs) return Promise.resolve(false);

    console.log(`[CloudStore] Sincronizando agora (${motivo}) — última atualização há ${Math.round(idade / 1000)}s.`);

    // Puxa ANTES de empurrar, pelo mesmo motivo do reconectar: o cache
    // deste aparelho é o que pode estar velho, não a nuvem.
    return this.syncCloudToLocal()
      .catch(e => { console.warn(`[CloudStore] Falha ao puxar da nuvem (${motivo}):`, e); return false; })
      .then((r) => this.syncLocalToCloud().then(() => r).catch(e => {
        console.warn(`[CloudStore] Falha ao enviar para a nuvem (${motivo}):`, e);
        return r;
      }));
  }

  // ---------------------------------------------------------------
  // STATUS DE CONEXÃO (para o indicador na tela)
  // ---------------------------------------------------------------
  _setStatus(status) {
    this._connectionStatus = status;
    this._statusListeners.forEach(fn => {
      try { fn(status); } catch(e) {}
    });
    this._updateStatusIndicator(status);
  }

  onStatusChange(fn) {
    this._statusListeners.push(fn);
  }

  getStatus() {
    return this._connectionStatus;
  }

  _updateStatusIndicator(status) {
    const indicator = document.getElementById('cloud-status-indicator');
    if (!indicator) return;
    
    const icons = { online: '🟢', connecting: '🟡', offline: '⚫' };
    const labels = { online: 'Nuvem Ativa', connecting: 'Conectando...', offline: 'Modo Local' };
    const colors = { online: '#10b981', connecting: '#f59e0b', offline: '#6b7280' };

    // Conectado NÃO é o mesmo que "salvando". O indicador ficava verde
    // enquanto nenhum dado transacional chegava ao banco — era esse verde
    // que fazia o problema passar despercebido. Se há tabela recusada pela
    // nuvem, o indicador precisa dizer isso na cara do usuário.
    // Armazenamento cheio vem ANTES da pendência de envio: aqui o envio
    // pode estar perfeito e o aparelho ainda assim ter parado no tempo ao
    // recarregar. Era o estado que não tinha como aparecer.
    if (this._falhaAoGravarCache) {
      indicator.innerHTML = `<span style="color:#ef4444">🔴</span> <span style="color:#fca5a5;font-size:10px;">Armazenamento cheio — dados novos não ficam salvos</span>`;
      indicator.title = `Este aparelho baixou os dados novos, mas não conseguiu guardá-los: ${this._falhaAoGravarCache.detalhe}\n\n`
        + 'A TELA está atualizada, mas ao recarregar o app ele volta para os dados antigos — e é assim que este aparelho passa a mostrar números diferentes dos outros.\n\n'
        + 'Libere espaço em Configurações > Governança, ou limpe os dados do site neste aparelho.';
      return;
    }

    const pendentes = this._tabelasPendentesDeEnvio ? this._tabelasPendentesDeEnvio.size : 0;
    if (status === 'online' && pendentes > 0) {
      const err = this._ultimoErroSync;
      indicator.innerHTML = `<span style="color:#ef4444">🔴</span> <span style="color:#fca5a5;font-size:10px;">Dados NÃO salvos na nuvem (${pendentes})</span>`;
      indicator.title = err
        ? `Falha ao gravar em "${err.tabela}" (HTTP ${err.status}): ${err.detalhe}\n\nOs dados estão salvos apenas neste aparelho e NÃO aparecem para os outros. Chame jrDiagnosticoSync() no console para o detalhe.`
        : 'Há tabelas com dados que a nuvem recusou.';
      return;
    }

    // IDADE DA TELA (28/08/2026). "Nuvem Ativa" respondia se há CONEXÃO, e
    // a pergunta de quem está com três aparelhos abertos lado a lado é
    // outra: "o que estou vendo é de quando?". Sem isso, um aparelho que
    // parou de sincronizar (aba em segundo plano, celular que dormiu) é
    // visualmente idêntico a um em dia — e a única saída era desconfiar do
    // sistema. Acima de 60s o número entra no rótulo; abaixo disso ele só
    // polui, porque o ciclo normal é de 30s.
    const idadeMs = this._ultimoPullOkMs ? Date.now() - this._ultimoPullOkMs : null;
    let sufixo = '';
    if (status === 'online' && idadeMs !== null && idadeMs > 60000) {
      const min = Math.floor(idadeMs / 60000);
      sufixo = ` <span style="color:#fbbf24;font-size:10px;">· há ${min}min</span>`;
    }

    indicator.innerHTML = `<span style="color:${colors[status]}">${icons[status]}</span> <span style="color:#cbd5e1;font-size:10px;">${labels[status]}</span>${sufixo}`;
    indicator.title = `Status do Banco de Dados: ${labels[status]}`
      + (this._ultimoPullOkMs
          ? `\nÚltima atualização vinda da nuvem: ${new Date(this._ultimoPullOkMs).toLocaleTimeString('pt-BR')} (há ${Math.round(idadeMs / 1000)}s)`
          : '\nAinda não baixou dados da nuvem nesta sessão.');
  }

  // =================================================================
  // CATÁLOGO (CLIENTES E PRODUTOS): SINCRONIZAÇÃO POR DELTA — 31/08/2026
  //
  // O QUE ESTAVA QUEBRADO. `clientes` e `produtos` NUNCA estiveram no
  // MAPA_TABELAS acima. As duas tabelas existiam no banco, populadas com as
  // 15.139 + 4.010 linhas da planilha, e nenhum aparelho jamais enviou nem
  // leu nenhuma das duas. Efeito prático: cliente cadastrado na doca não
  // existia para o SAC. Nem no dia seguinte, nem nunca.
  //
  // POR QUE FICARAM DE FORA, E POR QUE AGORA DÁ. Sincronizar do jeito que as
  // outras 25 sincronizam é ler a TABELA INTEIRA a cada 30 segundos: ~3 MB
  // por aparelho por ciclo para propagar meia dúzia de cadastros por mês.
  // A decisão de deixar de fora estava certa para aquele desenho. O que
  // mudou é que o catálogo virou SEMENTE + DELTA (v5.8.0, js/catalogoStore.js):
  // o que precisa viajar não é a lista, é o delta — dezenas de linhas.
  //
  // COMO ESTE CAMINHO É DIFERENTE DO DAS OUTRAS 25 TABELAS:
  //
  //   1. NÃO passa por jr_sac_db nem por chave-espelho. A origem e o destino
  //      são o delta do catálogo (IndexedDB), via window.db.
  //
  //   2. A LEITURA É INCREMENTAL: `atualizado_em >= cursor`, com o cursor
  //      sendo sempre um carimbo que o PRÓPRIO SERVIDOR gerou (o maior que
  //      veio na leitura anterior). Não é o relógio do aparelho — se fosse,
  //      uma máquina adiantada pularia registros para sempre. Ver o
  //      cabeçalho de database/migration_36_catalogo_sync.sql.
  //
  //   3. NÃO usa _mesclarPorRegistro(). Aquela função deduz exclusão de
  //      "id que eu conheço e não veio da nuvem" — o que só é verdade
  //      quando cloudData é a tabela INTEIRA. Numa leitura incremental
  //      quase nada vem, e ela apagaria o catálogo inteiro no primeiro
  //      ciclo. Aqui a mesclagem é upsert por id, e exclusão viaja como
  //      is_deleted (lápide), que é uma linha como qualquer outra.
  //
  //   4. TEM LISTA BRANCA DE COLUNAS. Os registros da planilha carregam
  //      `codigo` e `nome`, que não são colunas de `clientes` — enviá-los
  //      derruba o lote inteiro com PGRST204. A projeção também NORMALIZA
  //      tipo (o Postgres devolve valor_unitario_padrao como "0.00", string;
  //      localmente é 0, número): sem isso o registro pareceria alterado a
  //      cada ciclo e seria reenviado para sempre.
  //
  // DEPENDE DA MIGRATION 36. Sem ela não existe `atualizado_em`, a leitura
  // filtrada volta 400, e o catálogo NÃO sincroniza — nem sobe, nem desce.
  // Falhar fechado aqui é de propósito: subir sem o carimbo do servidor
  // colocaria linhas na nuvem que, depois da migration, ficariam com a data
  // antiga do backfill e nunca seriam descobertas por ninguém.
  // =================================================================
  _cursorDoCatalogo() {
    try {
      const v = localStorage.getItem('jr_catalogo_cursor');
      if (v) return v;
    } catch (e) {}
    return CloudStore.CATALOGO_EPOCA;
  }

  _gravarCursorDoCatalogo(iso) {
    try { localStorage.setItem('jr_catalogo_cursor', iso); } catch (e) {}
  }

  // Reduz o registro às colunas que a tabela realmente tem, SEMPRE todas
  // elas (as ausentes viram null) e com o tipo normalizado. É a mesma
  // projeção usada para enviar, para comparar e para guardar — e ser a
  // mesma nos três é o que impede o "reenvia para sempre".
  _projetarParaTabela(tableName, r) {
    const spec = CloudStore.COLUNAS_POR_TABELA[tableName];
    if (!spec || !r) return r;
    const out = { id: (r.id === undefined || r.id === null) ? null : String(r.id) };
    const vazio = v => (v === undefined || v === null || v === '');
    (spec.texto || []).forEach(c => { out[c] = vazio(r[c]) ? null : String(r[c]); });
    (spec.numero || []).forEach(c => { out[c] = vazio(r[c]) ? null : Number(r[c]); });
    (spec.booleano || []).forEach(c => { out[c] = !!r[c]; });
    // Booleano cuja AUSÊNCIA vale true — hoje só usuarios.ativo (31/08/2026).
    // Com o `!!` de cima, um registro legado sem a chave `ativo` subiria
    // como false, e `ativo: false` tranca a pessoa no login com "Usuário
    // desativado. Contate o administrador." (store.js, login()). O app
    // inteiro já lê essa coluna assim: só `=== false` é inativo, ausente é
    // ativo. A projeção passa a ler igual.
    (spec.booleanoTrue || []).forEach(c => { out[c] = r[c] !== false; });
    (spec.data || []).forEach(c => { out[c] = vazio(r[c]) ? null : String(r[c]); });
    return out;
  }

  // O hash que decide "mudou desde o último envio". Para as tabelas sem
  // lista branca é exatamente o _hashRegistro() de sempre.
  _hashParaSync(tableName, r) {
    return this._hashRegistro(this._projetarParaTabela(tableName, r));
  }

  _catalogoDisponivel() {
    return !!(typeof window !== 'undefined' && window.db
      && typeof window.db.getCatalogoParaSync === 'function'
      && typeof window.db.aplicarCatalogoDaNuvem === 'function');
  }

  // Puxa o que mudou no catálogo desde o último ciclo. Devolve:
  //   true  = chegou coisa nova (a tela precisa ser redesenhada)
  //   false = nada novo
  //   null  = não deu para ler (migration 36 ausente, ou rede)
  async _pullCatalogo() {
    if (!this.isConfigured() || !this._catalogoDisponivel()) return null;

    const cursor = this._cursorDoCatalogo();
    const local = window.db.getCatalogoParaSync();
    const aceitos = {};
    let maiorCarimbo = cursor;
    let mudou = false;

    for (const t of CloudStore.CATALOGO) {
      const linhas = await this.getAll(t.tableName, 'atualizado_em=gte.' + encodeURIComponent(cursor));
      if (linhas === null) {
        this._catalogoIndisponivel = {
          tabela: t.tableName,
          motivo: 'Não foi possível ler com o filtro atualizado_em. Se isto não passa, a migration_36_catalogo_sync.sql ainda não foi aplicada neste banco.',
          quando: (typeof agoraIsoBrasilia === 'function') ? agoraIsoBrasilia() : new Date().toISOString()
        };
        console.warn(`[CloudStore] Catálogo: leitura de ${t.tableName} recusada — cadastro de cliente/produto NÃO está sincronizando. Ver database/migration_36_catalogo_sync.sql.`);
        return null;
      }

      const porIdLocal = new Map();
      (local[t.dbKey] || []).forEach(r => {
        if (r && r.id !== undefined && r.id !== null) porIdLocal.set(String(r.id), r);
      });

      const mapa = this._lerMapaSync();
      const conhecidos = mapa[t.tableName];
      const daTabela = [];

      for (const bruta of linhas) {
        if (!bruta || bruta.id === undefined || bruta.id === null) continue;
        if (bruta.atualizado_em && String(bruta.atualizado_em) > String(maiorCarimbo)) {
          maiorCarimbo = String(bruta.atualizado_em);
        }

        const id = String(bruta.id);
        const nuvem = this._projetarParaTabela(t.tableName, bruta);
        const localReg = porIdLocal.get(id);

        // Mesma regra das outras tabelas (ver _mesclarPorRegistro): o que
        // foi mexido aqui e ainda não subiu ganha da nuvem, a menos que a
        // nuvem esteja estritamente mais recente.
        if (localReg && conhecidos && conhecidos[id] !== undefined
            && this._hashParaSync(t.tableName, localReg) !== conhecidos[id]) {
          const tLocal = this._instanteDeAtualizacao(localReg);
          const tNuvem = this._instanteDeAtualizacao(bruta);
          if (!(tLocal !== null && tNuvem !== null && tNuvem > tLocal)) continue;
        }

        // Já é idêntico ao que está aqui: não mexe e não conta como mudança.
        if (localReg && this._hashParaSync(t.tableName, localReg) === this._hashRegistro(nuvem)) continue;

        daTabela.push(nuvem);
      }

      if (daTabela.length) {
        aceitos[t.dbKey] = daTabela;
        this._confirmarEnvio(t.tableName, daTabela);   // agora são o que a nuvem tem
        mudou = true;
      }
    }

    this._catalogoIndisponivel = null;
    // A partir daqui o envio está liberado: a leitura filtrada funcionou,
    // logo a migration_36 está aplicada neste banco. Ver _pushCatalogo().
    this._catalogoPullOk = true;

    if (mudou) {
      const n = Object.keys(aceitos).reduce((s, k) => s + aceitos[k].length, 0);
      window.db.aplicarCatalogoDaNuvem(aceitos);
      console.log(`[CloudStore] Catálogo: ${n} cadastro(s) de cliente/produto chegaram da nuvem.`);
    }

    // O cursor só anda quando as DUAS tabelas foram lidas sem erro — senão
    // uma leitura parcial faria o aparelho pular o que não chegou a ver.
    if (maiorCarimbo !== cursor) this._gravarCursorDoCatalogo(maiorCarimbo);
    return mudou;
  }

  // Sobe o delta deste aparelho. Só o que mudou desde a última confirmação:
  // numa instalação sem cadastro manual nenhum, isto não gasta requisição.
  async _pushCatalogo() {
    if (!this.isConfigured() || !this._catalogoDisponivel()) return false;

    // FALHA FECHADO, e é o ponto mais importante deste arquivo para quem
    // for mexer aqui: só envia depois que uma LEITURA filtrada funcionou
    // nesta sessão. Enviar antes disso colocaria linhas na nuvem sem o
    // carimbo do servidor — e o backfill da migration_36 as deixaria com a
    // data antiga, invisíveis para todo mundo, para sempre. Melhor não
    // subir e dizer por quê do que subir para um buraco.
    if (!this._catalogoPullOk || this._catalogoIndisponivel) return false;

    const local = window.db.getCatalogoParaSync();
    let enviouAlgo = false;

    for (const t of CloudStore.CATALOGO) {
      const registros = (local[t.dbKey] || []).map(r => this._projetarParaTabela(t.tableName, r));
      if (!registros.length) continue;
      const mudados = this._separarOQueMudou(t.tableName, registros);
      if (!mudados.length) continue;
      if (await this.upsert(t.tableName, mudados)) {
        this._confirmarEnvio(t.tableName, mudados);
        enviouAlgo = true;
        console.log(`[CloudStore] Catálogo: ${mudados.length} ${t.dbKey} enviado(s) para a nuvem.`);
      }
    }
    return enviouAlgo;
  }

  // NÃO existe um "sincronizarCatalogo()" que faça os dois lados de uma vez,
  // e é de propósito: as duas metades já estão penduradas nos MESMOS dois
  // pontos de entrada que o app inteiro usa — _pullCatalogo() dentro do
  // _pullDaNuvem(), _pushCatalogo() dentro do syncLocalToCloud(). Um terceiro
  // caminho seria uma segunda rota para a mesma coisa, com chance de rodar
  // fora de ordem (empurrar antes de puxar é exatamente o defeito que a Fase
  // 5 de 21/08/2026 removeu do startAutoSync).
}

// A build QUE ESTE ARQUIVO E. O app compara este valor com o "build" do
// version.json publicado para descobrir se o aparelho ficou com uma versao
// velha em cache.
//
// TEM DE SUBIR JUNTO com version.json, sempre. Em 25/08/2026 o version.json
// foi para sync-5.0.0 e esta linha ficou em sync-4.9.1 - resultado: o codigo
// novo rodando e, ainda assim, todo aparelho acusando no console
// "A atualizacao automatica nao pegou. Rodando sync-4.9.1, publicada
// sync-5.0.0", para sempre. O aviso que existe para detectar cache velho
// vira ruido permanente, e ai ninguem olha mais para ele.
//
// Sao CINCO marcadores de versao, e os cinco andam juntos:
//   js/cloudStore.js  CloudStore.BUILD   <- este
//   version.json      build
//   js/config.js      appVersion
//   sw.js             CACHE_NAME
//   js/store.js       currentVersion
//
// ERAM QUATRO ate a 6.2.0, e esta lista dizia quatro. O quinto entrou na
// 6.3.0 (esta anotado na observacao_deploy dela) e a lista aqui nao
// acompanhou - foi assim que a 6.4.0 saiu com dois marcadores parados: quem
// leu daqui bumpou os que estavam escritos.
//
// O CUSTO DE ESQUECER UM NAO E COSMETICO, e depende de qual:
//   CloudStore.BUILD  -> jrDiagnosticoSync() reporta a versao errada, e a
//                        conferencia de cache velho compara contra ela.
//   version.json      -> jrConferirVersaoPublicada() nao ve versao nova e
//                        nenhum aparelho e mandado atualizar.
//   store.js          -> todo aparelho loga migracao de versao a cada
//                        abertura, para sempre.
CloudStore.BUILD = "fotos-devolucao-storage-6.4.0";

// =================================================================
// CATÁLOGO — as duas tabelas que NÃO passam pelo MAPA_TABELAS
//
// Elas têm caminho próprio (_pullCatalogo/_pushCatalogo) porque a origem
// local delas não é o jr_sac_db: é o delta do catálogo, no IndexedDB.
// =================================================================
CloudStore.CATALOGO = [
  { dbKey: 'clientes', tableName: 'clientes' },
  { dbKey: 'produtos', tableName: 'produtos' }
];

// O PISO da leitura incremental do catálogo. FORMA PAR COM O BACKFILL da
// migration_36, que carimba 1999-01-01 em toda linha que já existia: assim
// as 19 mil linhas da planilha ficam ABAIXO deste piso e nunca são baixadas
// (elas já estão no aparelho, embarcadas em js/mockData.js), e só o que for
// cadastrado ou alterado a partir da migration fica ACIMA e desce.
//
// MUDAR ISTO SEM MUDAR A MIGRATION (ou o contrário) quebra dos dois jeitos:
// piso baixo demais = todo aparelho baixa 3 MB em toda abertura; piso alto
// demais = ninguém recebe cadastro nenhum. As duas datas andam juntas.
CloudStore.CATALOGO_EPOCA = '2000-01-01T00:00:00-03:00';

// LISTA BRANCA DE COLUNAS, por tabela.
//
// Existe por dois motivos, e os dois já derrubaram sincronização aqui:
//
//   1. COLUNA QUE NÃO EXISTE derruba o lote inteiro (PGRST204). Os 15.139
//      clientes da planilha carregam `codigo` e `nome`, que são campos só
//      do app — as colunas reais são codigo_cliente e razao_social.
//
//   2. TIPO QUE VOLTA DIFERENTE faz o registro parecer alterado para
//      sempre. O Postgres devolve valor_unitario_padrao como "0.00"
//      (string) e localmente ele é 0 (número): sem normalizar, o hash
//      nunca bate e o aparelho reenvia a mesma linha a cada 30 segundos.
//
// `atualizado_em` NÃO está aqui de propósito: quem carimba é o trigger do
// banco. Enviá-lo deixaria o relógio de um aparelho definir o cursor de
// todos os outros.
CloudStore.COLUNAS_POR_TABELA = {
  clientes: {
    texto:    ['codigo_cliente', 'razao_social', 'cnpj', 'cidade', 'uf', 'deleted_by_nome'],
    numero:   ['deleted_by_usuario_id'],
    booleano: ['is_deleted'],
    data:     ['deleted_at']
  },
  produtos: {
    texto:    ['codigo_produto', 'descricao', 'categoria', 'deleted_by_nome'],
    numero:   ['valor_unitario_padrao', 'deleted_by_usuario_id'],
    booleano: ['is_deleted'],
    data:     ['deleted_at']
  },
  // usuarios (31/08/2026) — o motivo 1 acima, de novo, e caro.
  //
  // Em 31/08/2026, CINCO pessoas (Lucas, Melquiades, Victor Hugo, Itajaci e
  // Robson) trabalhavam no app sem existir na tabela `usuarios`. O cadastro
  // de cada uma vivia só no localStorage do próprio aparelho.
  //
  // O caminho: `usuarios` não tinha lista branca, então o objeto local subia
  // INTEIRO. Basta UMA chave legada de build antiga (campo que já não é
  // coluna) para o PostgREST recusar o lote todo com PGRST204 — e o
  // igualador de chaves logo acima, que existe para o PGRST102, ESPALHA essa
  // chave para todos os objetos do lote, então um registro podre condena o
  // lote inteiro, para sempre, em silêncio.
  //
  // O estrago não é "um cadastro não sincronizou". É que login e cadastro
  // leem só o cache local: a pessoa aparece cadastrada na tela dela,
  // invisível para o administrador, sem conseguir se recadastrar (addUsuario
  // recusa pelo e-mail que ele mesmo achou no cache) e sem ninguém conseguir
  // redefinir a senha dela — a tela "Logins e Senhas" também não a enxerga.
  // Quem estava de férias durante as atualizações caiu exatamente nisso.
  //
  // Só as colunas que o APP é dono. `criado_em` e `setor_id` ficam de fora
  // de propósito, pelo mesmo motivo do `atualizado_em` no comentário acima:
  // a projeção envia SEMPRE todas as colunas que declara, então declarar
  // `criado_em` faria todo upsert sobrescrever com null o carimbo que o
  // DEFAULT do banco pôs no INSERT.
  usuarios: {
    texto:        ['nome', 'email', 'senha_hash', 'role', 'cargo', 'departamento'],
    booleanoTrue: ['ativo']
  }
};

// NÚMEROS SEQUENCIAIS QUE PODEM SER RENUMERADOS SOZINHOS (02/09/2026).
// Lidos por _resolverColisaoDeSequencia() — o comentário longo está lá.
//
//   unico    -> o campo que tem índice UNIQUE no banco e derruba o lote
//   espelhos -> o mesmo número em outro formato, que tem de andar junto
//
// A lista é curta DE PROPÓSITO. Só entram campos cujo valor este app
// inventa (um contador). motoristas.cnh, usuarios.email e
// controle_viagens.carga também são UNIQUE e ficam de fora: ali o valor
// vem do mundo real e renumerar seria falsificar o dado, não consertá-lo.
// medidas_disciplinares.numero_medida também fica fora, por outro motivo:
// não tem UNIQUE no banco, então nunca derruba envio nenhum.
CloudStore.SEQUENCIAS_RENUMERAVEIS = {
  ocorrencias_devolucao: { unico: 'numero_protocolo', espelhos: ['numero_devolucao'] },
  ocorrencias_rota:      { unico: 'numero_protocolo', espelhos: [] },
  retencoes_frota:       { unico: 'numero_retencao',  espelhos: [] },
  sinistros:             { unico: 'numero_sinistro',  espelhos: [] }
};

// As 25 tabelas que sincronizam, e onde cada uma mora neste aparelho.
//   tableName -> a tabela no Supabase
//   localKey  -> a chave ESPELHO no localStorage ('jr_ocorrencias' etc.)
//   dbKey     -> a colecao dentro de jr_sac_db e de window.db.data
CloudStore.MAPA_TABELAS = [
  { tableName: 'ocorrencias_devolucao', localKey: 'jr_ocorrencias',       dbKey: 'ocorrencias_devolucao' },
  { tableName: 'ocorrencias_rota',      localKey: 'jr_ocorrencias_rota',  dbKey: 'ocorrencias_rota' },
  { tableName: 'retencoes_frota',       localKey: 'jr_retencoes_frota',   dbKey: 'retencoes_frota' },
  { tableName: 'reentregas_rota',       localKey: 'jr_reentregas',        dbKey: 'reentregas' },
  { tableName: 'trocas_veiculos',       localKey: 'jr_trocas_veiculos',   dbKey: 'trocas_veiculos' },
  { tableName: 'motoristas',            localKey: 'jr_motoristas',        dbKey: 'motoristas' },
  { tableName: 'ajudantes',             localKey: 'jr_ajudantes',         dbKey: 'ajudantes' },
  { tableName: 'veiculos',              localKey: 'jr_veiculos',          dbKey: 'veiculos' },
  { tableName: 'cargas',                localKey: 'jr_cargas',            dbKey: 'cargas' },
  { tableName: 'usuarios',              localKey: 'jr_usuarios',          dbKey: 'usuarios' },
  { tableName: 'audit_logs',            localKey: 'jr_audit_logs',        dbKey: 'audit_logs' },
  { tableName: 'registro_versoes',      localKey: 'jr_registro_versoes',  dbKey: 'registro_versoes' },
  { tableName: 'controle_viagens',      localKey: 'jr_controle_viagens',  dbKey: 'controle_viagens' },
  { tableName: 'ocorrencias_viagens',   localKey: 'jr_ocorrencias_viagens', dbKey: 'ocorrencias_viagens' },
  { tableName: 'resumo_diario_cd',      localKey: 'jr_resumo_diario_cd',  dbKey: 'resumo_diario_cd' },
  { tableName: 'medidas_disciplinares', localKey: 'jr_medidas_disciplinares', dbKey: 'medidas_disciplinares' },
  { tableName: 'orientacoes_feedback',  localKey: 'jr_orientacoes_feedback', dbKey: 'orientacoes_feedback' },
  { tableName: 'atestados_medicos',     localKey: 'jr_atestados_medicos', dbKey: 'atestados_medicos' },
  { tableName: 'ausencias_registros',   localKey: 'jr_ausencias_registros', dbKey: 'ausencias_registros' },
  { tableName: 'itens_devolucao',       localKey: 'jr_itens_devolucao',   dbKey: 'itens_devolucao' },
  { tableName: 'colaboradores_cd',      localKey: 'jr_colaboradores_cd',  dbKey: 'colaboradores_cd' },
  { tableName: 'relatorios_divergencia', localKey: 'jr_relatorios_divergencia', dbKey: 'relatorios_divergencia' },
  { tableName: 'auditoria_produtividade', localKey: 'jr_auditoria_produtividade', dbKey: 'auditoria_produtividade' },
  { tableName: 'sinistros',             localKey: 'jr_sinistros',         dbKey: 'sinistros' },
  { tableName: 'itens_avulsos_destinacao', localKey: 'jr_itens_avulsos_destinacao', dbKey: 'itens_avulsos_destinacao' }
];

// Tamanho do bloco de leitura paginada (item 4). Deliberadamente ABAIXO do
// corte padrão de 1.000 linhas do PostgREST: assim um bloco cheio sempre
// significa "pode haver mais", e nunca "o servidor cortou aqui" — que é o
// jeito silencioso de truncar de novo.
CloudStore.PAGINA_LEITURA = 500;

// ---------------------------------------------------------------
// IDENTIDADE DO APARELHO — Onda 2, itens 9 e 12 (22/08/2026)
//
// Um identificador estável por aparelho, criado na primeira vez e guardado
// no próprio navegador. Serve para duas coisas: o carimbo que separa os ids
// gerados por aparelhos diferentes (item 9) e o registro na tela de
// Aparelhos (item 12).
//
// Vive aqui, e não no store.js, porque cloudStore.js é carregado ANTES
// (index.html:596) — assim o store pode usá-lo com segurança.
// ---------------------------------------------------------------
CloudStore.idDoAparelho = function() {
  try {
    let id = localStorage.getItem('jr_device_id');
    if (!id) {
      const aleatorio = (typeof crypto !== 'undefined' && crypto.getRandomValues)
        ? Array.from(crypto.getRandomValues(new Uint32Array(2))).map(n => n.toString(36)).join('')
        : (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
      id = 'ap-' + aleatorio;
      localStorage.setItem('jr_device_id', id);
    }
    return id;
  } catch(e) {
    // Navegador sem localStorage (aba anônima travada): identidade só desta
    // sessão. Melhor do que id fixo, que colidiria com todo mundo.
    if (!CloudStore._idVolatil) CloudStore._idVolatil = 'ap-tmp-' + Math.random().toString(36).slice(2);
    return CloudStore._idVolatil;
  }
};

// Os 3 últimos dígitos do id de cada registro. Dois aparelhos só colidem se
// caírem no mesmo milissegundo E tirarem o mesmo número entre 0 e 999.
CloudStore.carimboDoAparelho = function() {
  if (CloudStore._carimbo !== undefined) return CloudStore._carimbo;
  const s = CloudStore.idDoAparelho();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  CloudStore._carimbo = h % 1000;
  return CloudStore._carimbo;
};

// Item 5 — quantos dias de cada tabela transacional ficam NO APARELHO. O
// resto continua na nuvem e no Power BI; só sai do cache local. Tabela que
// não estiver aqui não é podada.
//
// 90 dias a 400 viagens/mês dá ~1.200 registros, ~600 KB — cabe folgado nos
// ~2 MB que sobram da cota. Se a operação precisar enxergar mais tempo no
// próprio app, é só aumentar o número; se a cota apertar (fotos de devolução
// pesam muito mais que viagem), é só diminuir.
CloudStore.JANELA_OPERACIONAL_DIAS = {
  controle_viagens: 90,
  ocorrencias_viagens: 90
};

window.cloudStore = new CloudStore();

// Atalho de diagnóstico para o console do navegador (F12). Responde a
// pergunta que antes só o console.warn respondia, e só para quem sabia
// procurar: "os dados desta máquina estão de fato chegando no banco?"
window.jrDiagnosticoSync = function() {
  const d = window.cloudStore.getDiagnostico();
  console.table(d.tabelasComPendencia.map(t => ({ tabela: t, estado: 'NAO SALVA NA NUVEM' })));
  if (d.ultimoErro) console.error('Último erro:', d.ultimoErro);
  if (d.bloqueadosNaEscrita) {
    console.warn(
      `⚠️ Este aparelho tem cache de build antiga: ${d.bloqueadosNaEscrita.total} registro(s) de ` +
      `${d.bloqueadosNaEscrita.tabela} foram recusados no envio (data de saída com estado de checklist). ` +
      `NÃO é mais para limpar cache à mão (a antiga ETAPA 3): desde a 6.1.0, _faxinaDeFantasmas() tira ` +
      `essas linhas do aparelho sozinha, a cada ciclo. Se este número não zerar no próximo ciclo, é caso ` +
      `NOVO — a faxina não reconheceu o valor. Veja os exemplos abaixo e leve-os para o _ehVocabularioDeChecklist().`,
      d.bloqueadosNaEscrita.exemplos
    );
  }
  if (!d.tabelasComPendencia.length) console.info('✅ Nenhuma tabela pendente — tudo que foi salvo aqui chegou ao banco.');
  return d;
};


// Detector de resquício, pelo console (PC). No celular, o mesmo resultado
// sai pelo botão em Governança & Lixeira -> Aparelhos, que é onde ele
// realmente precisa estar: celular não tem F12.
//
// Não confundir com jrDiagnosticoSync(), que responde "a nuvem recusou
// alguma tabela?". Este aqui responde outra pergunta, que era cega até
// hoje: "as cópias que este aparelho guarda do mesmo registro concordam
// entre si?". Um aparelho pode passar no primeiro e falhar no segundo — foi
// exatamente o caso do lançamento de 23/08/2026.
window.jrConferirCamadas = function() {
  const r = window.cloudStore.conferirCamadas();
  window.jrUltimaConferenciaCamadas = r;
  if (r.totalDivergentes === 0) {
    console.info('✅ Nenhuma divergência entre as cópias locais deste aparelho.');
    return r;
  }
  console.warn(
    `⚠️ ${r.totalDivergentes} registro(s) com cópias que não batem entre si neste aparelho` +
    (r.totalEmRisco > 0
      ? ` — e ${r.totalEmRisco} deles some(m) no próximo pull se não subirem antes.`
      : '.')
  );
  console.table(r.tabelas.map(t => ({
    tabela: t.tabela,
    divergentes: t.total,
    'em risco': t.emRisco,
    'na memória': t.contagens.memoria,
    'em jr_sac_db': t.contagens.sacDb,
    'no espelho': t.contagens.espelho
  })));
  r.tabelas.forEach(t => {
    console.groupCollapsed(`${t.tabela} (espelho: ${t.espelho})`);
    console.table(t.divergentes.map(d => ({
      id: d.id, registro: d.rotulo, 'em risco': d.emRisco ? 'SIM' : '',
      memoria: d.onde.memoria, jr_sac_db: d.onde.sacDb, espelho: d.onde.espelho
    })));
    console.groupEnd();
  });
  return r;
};

// Rastreia UM registro pelas cinco camadas. Aceita placa, carga, NF,
// protocolo ou id: jrRastrear('OLI2E18')
window.jrRastrear = async function(termo) {
  const r = await window.cloudStore.rastrearRegistro(termo);
  window.jrUltimoRastreio = r;
  if (r.erro) { console.warn(r.erro); return r; }
  if (!r.achados.length) {
    console.warn(`Nada encontrado para "${r.termo}" em nenhuma das cópias locais deste aparelho.`);
    return r;
  }
  r.achados.forEach(a => {
    const emoji = a.veredito.nivel === 'CRITICO' ? '⛔' : a.veredito.nivel === 'ATENCAO' ? '⚠️' : '✅';
    console.group(`${emoji} ${a.tabela} #${a.id} — ${a.veredito.texto}`);
    console.table({
      'memória (tela)':      { estado: a.camadas.memoria.estado,  assinatura: a.camadas.memoria.hash  || '' },
      'jr_sac_db (salvo)':   { estado: a.camadas.sacDb.estado,    assinatura: a.camadas.sacDb.hash    || '' },
      'espelho (pull)':      { estado: a.camadas.espelho.estado,  assinatura: a.camadas.espelho.hash  || '' },
      'mapa de envio':       { estado: a.camadas.hashMap.estado,  assinatura: a.camadas.hashMap.hash  || '' },
      'nuvem (agora)':       { estado: a.camadas.nuvem.estado,    assinatura: a.camadas.nuvem.hash    || '' }
    });
    console.groupEnd();
  });
  return r;
};

// Captura de TODOS os erros de envio, e não só do último (22/08/2026).
//
// getDiagnostico() guarda um único _ultimoErroSync. Quando quatro tabelas
// falham no mesmo ciclo, ele mostra a quarta e esconde as três primeiras —
// foi assim que a investigação de 22/08 começou olhando um 23503 de
// sinistros que era mera consequência de um 23514 em ocorrencias_rota.
// Diagnosticar uma por vez custou horas.
//
// Roda um ciclo de envio com todas as falhas registradas e devolve a lista
// inteira. O array fica em window.jrUltimosErrosSync para a tela de
// Aparelhos ler — que é o único caminho que funciona no celular, onde não
// existe console.
window.jrErrosSync = async function() {
  const cs = window.cloudStore;
  if (!cs || !cs.isConfigured()) { console.warn('Nuvem não configurada neste aparelho.'); return []; }
  const capturados = [];
  const original = cs._registrarFalhaSync.bind(cs);
  cs._registrarFalhaSync = function(tabela, status, corpo) {
    let detalhe = corpo;
    try { const j = JSON.parse(corpo); detalhe = j.message || j.hint || corpo; } catch(e) {}
    capturados.push({ tabela, status, detalhe: String(detalhe || '').slice(0, 300) });
    return original(tabela, status, corpo);
  };
  try {
    await cs.syncLocalToCloud();
  } finally {
    cs._registrarFalhaSync = original;
  }
  window.jrUltimosErrosSync = { erros: capturados, quando: agoraIsoBrasilia() };
  if (capturados.length === 0) console.info('✅ Nenhuma tabela recusada — o envio passou inteiro.');
  else console.table(capturados);
  return capturados;
};

// Achado de 21/08/2026, testando de verdade com dois aparelhos: o padrão
// "salva local -> alert() de sucesso -> usuário toca OK" existe em mais de
// 20 telas diferentes do app (Devolução SAC, Frota, cadastros de
// motorista/veículo/cliente/carga, reentregas, trocas de veículo, resumo
// diário do CD...). Em TODAS elas, o envio pra nuvem programado pelo
// debounce de 1.5s do save() (ver _scheduleCloudSync em store.js) fica
// preso atrás do alert() — window.alert() trava a aba inteira, inclusive
// timers pendentes, até o usuário tocar OK. Só 3 telas tinham sido
// corrigidas uma a uma (import de escala, cadastro de usuário, Devolução
// SAC) antes de perceber que era o MESMO bug em todo lugar que usa
// alert() depois de salvar. Em vez de caçar e corrigir cada uma das
// dezenas de telas individualmente (frágil — uma nova tela que apareça
// no futuro cai na mesma armadilha), intercepta window.alert() uma única
// vez aqui: sempre que qualquer alert() for chamado, dispara agora
// (antes de bloquear) o envio de qualquer gravação pendente. Não troca o
// texto nem o comportamento do alert() em si — só garante que a
// requisição já esteja em voo antes da tela travar.
(function interceptarAlertParaFlushDoSync() {
  const alertOriginal = window.alert.bind(window);
  window.alert = function(...args) {
    try {
      if (window.cloudStore && window.cloudStore.isConfigured()) {
        window.cloudStore.syncLocalToCloud().catch(() => {});
      }
    } catch(e) {}
    return alertOriginal(...args);
  };
})();

// Inicia sincronização automática se já estiver configurado
if (window.cloudStore.isConfigured()) {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => window.cloudStore.startAutoSync(), 2000);
  });
}

// (achado em 20/08/2026, auditoria externa) sem isso, quem salva algo sem
// sinal (motorista na estrada com 5G oscilando, conferente no fundo do
// galpão sem Wi-Fi) só sincroniza quando o timer de 30s cair de novo —
// até 30s de espera depois do sinal já ter voltado. Escuta os eventos
// nativos do navegador e força uma tentativa imediata assim que a conexão
// volta, sem esperar o próximo tick do timer.
window.addEventListener('online', () => {
  console.log('[CloudStore] Conexão de rede voltou — sincronizando imediatamente.');
  if (window.cloudStore && window.cloudStore.isConfigured()) {
    // Puxa ANTES de empurrar. Este aparelho acabou de ficar sem rede: o
    // que existe na nuvem é necessariamente mais atual que o cache local,
    // e pode inclusive conter um Reset Global feito enquanto ele estava
    // fora do ar. Empurrar primeiro era um caminho de ressurreição.
    window.cloudStore.syncCloudToLocal()
      .catch(e => console.warn('[CloudStore] Falha ao baixar dados após reconexão:', e))
      .then(() => window.cloudStore.syncLocalToCloud())
      .catch(e => console.warn('[CloudStore] Falha ao enviar dados após reconexão:', e));
  }
});
window.addEventListener('offline', () => {
  console.log('[CloudStore] Conexão de rede perdida — voltando para modo local até reconectar.');
  if (window.cloudStore) window.cloudStore._setStatus('offline');
});

// =================================================================
// SINCRONIZA AO VOLTAR PARA A TELA (28/08/2026)
//
// A CAUSA PRINCIPAL DO "TRÊS APARELHOS DESSINCRONIZADOS AO MESMO TEMPO,
// NA MESMA REDE". Toda a atualização deste app dependia de um
// setInterval de 30s — e o navegador NÃO deixa esse timer rodar quando a
// tela não está à vista:
//
//   - Aba em segundo plano (desktop e Android): o timer é limitado a UMA
//     execução por minuto. Já dobra o atraso.
//   - Aba de fundo parada por ~5 min no Chrome: a página é CONGELADA
//     (Page Lifecycle / freeze). O timer para de existir.
//   - Celular com a tela apagada, ou o app trocado: iOS suspende a página
//     na hora; o Android congela logo depois.
//
// Ou seja: o aparelho no bolso do conferente e a aba aberta atrás da
// planilha no PC não estavam atrasados 30 segundos — estavam parados
// desde a hora em que saíram de vista, fossem 10 minutos ou 3 horas. E
// quando a pessoa voltava para a tela, o app mostrava o cache antigo por
// até mais 30s, até o timer descongelar e o próximo tique cair. Nada
// disso aparece no indicador, que continuava verde: verde só quer dizer
// "tem rede", não "isto aqui é de agora".
//
// O evento 'online' já existente NÃO cobre este caso: a rede nunca caiu.
// O aparelho estava conectado o tempo todo — quem parou foi o timer.
//
// Os três eventos escutados aqui existem porque nenhum deles cobre
// sozinho os aparelhos que a operação usa:
//   visibilitychange  o principal — vale para trocar de aba, minimizar,
//                     destravar o celular e voltar ao app pelo alternador.
//   pageshow          quando a página volta do bfcache (voltar do
//                     navegador, Safari do iPhone). Aqui o
//                     visibilitychange pode não disparar.
//   focus             rede de segurança para janelas de desktop lado a
//                     lado, onde a aba nunca fica "hidden" mas o Chrome
//                     ainda desacelera a janela sem foco.
// Disparar três vezes no mesmo gesto não custa três sincronizações: o
// idadeMinimaMs de sincronizarAgora() agrupa a rajada, e a trava de
// reentrância do syncCloudToLocal() impede pulls sobrepostos.
// =================================================================
(function sincronizarAoVoltarParaATela() {
  const acordar = (motivo) => {
    if (!window.cloudStore || !window.cloudStore.isConfigured()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    window.cloudStore.sincronizarAgora(motivo).catch(() => {});
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acordar('voltou para a tela');
  });

  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) acordar('página restaurada do cache do navegador');
  });

  window.addEventListener('focus', () => acordar('janela recebeu foco'));
})();

// =================================================================
// AUTO-ATUALIZAÇÃO — Onda 2, item 11 (22/08/2026)
//
// Decisão 4: esta deve ser a última vez que alguém precisa limpar cache
// aparelho por aparelho.
//
// ACHADO QUE MUDOU O DESENHO DESTE ITEM: o plano dizia que quem servia
// arquivo velho era o service worker. **Não é** — o `sw.js` existe no
// projeto mas NÃO É REGISTRADO EM LUGAR NENHUM, e o `setupPwa()`
// (app.js:296) ainda por cima desregistra qualquer service worker que
// encontre. Quem guarda o arquivo velho é o cache HTTP comum do navegador,
// e o motivo é simples: nenhuma tag <script> tem versão na URL, então
// `./js/app.js` continua sendo o mesmo endereço depois do deploy.
//
// (Consequência disso que fica anotada, fora do escopo desta rodada: sem
// service worker, o app NÃO abre sem internet. O que a hospedagem manda
// hoje é `max-age=0, must-revalidate`, então o servidor não é o problema.)
//
// COMO FUNCIONA: `version.json` é publicado junto com o deploy e diz qual
// é a versão no ar. O app pergunta ao abrir, e de 15 em 15 minutos. Se a
// versão de lá for diferente da que está rodando aqui, ele força o
// navegador a rebaixar as cópias antigas (fetch com cache:'reload', que
// substitui a entrada guardada para AQUELA MESMA URL) e recarrega.
//
// TRAVA CONTRA LAÇO: se depois de recarregar a versão ainda não bater
// (arquivo velho preso num proxy da empresa, por exemplo), ele não tenta
// de novo — mostra uma tarja pedindo Ctrl+Shift+R. Recarregar em laço
// seria pior que a doença.
// =================================================================
CloudStore.ARQUIVOS_DO_APP = [
  './index.html',
  './js/app.js',
  './js/store.js',
  './js/cloudStore.js',
  './js/fotoStore.js',
  './js/config.js',
  './js/mockData.js',
  './manifest.json'
];

// Compara duas marcas de build pelo NUMERO DE VERSAO, nao pela string inteira.
//
// Por que: a marca carrega um codinome que muda a cada leva ('sync-5.1.0',
// 'menu-periodo-5.2.0'). Comparando a string inteira, esquecer de subir
// CloudStore.BUILD junto com o version.json faz a tarja "versao antiga"
// acender em TODO aparelho e nunca mais apagar - foi o que aconteceu na
// 5.2.0, e ja tinha acontecido na 5.0.0 (ver comentario de CloudStore.BUILD).
// Como o aparelho de fato TEM o codigo novo, recarregar nao resolve nada: o
// aviso que existe para achar cache velho vira ruido permanente, e ai
// ninguem olha mais para ele.
//
// Comparando so o x.y.z, o codinome pode divergir sem acender a tarja - o
// que a tarja precisa detectar e o aparelho rodando codigo de OUTRA VERSAO.
// Se algum dos dois lados nao tiver x.y.z, cai na comparacao antiga.
function jrVersaoNumerica(marca) {
  const m = String(marca || '').match(/([0-9]+)[.]([0-9]+)[.]([0-9]+)/);
  return m ? m[1] + '.' + m[2] + '.' + m[3] : null;
}

function jrMesmaVersao(publicada, local) {
  const a = jrVersaoNumerica(publicada);
  const b = jrVersaoNumerica(local);
  if (a && b) return a === b;
  return publicada === local;
}

// A ATUALIZAÇÃO É AUTOMÁTICA, MAS NÃO NO MEIO DE UM FORMULÁRIO (01/09/2026).
//
// Ao passar a conferir a versão nos eventos de acordar (ver o rodapé deste
// arquivo), a conferência deixou de acontecer só de 15 em 15 minutos e passou
// a acontecer no exato momento em que a pessoa volta para a tela — e um
// location.reload() disparado enquanto alguém digita um lançamento joga fora
// o que ela escreveu, sem nada na tela explicando por quê. Uma atualização que
// come trabalho é pior do que uma que atrasa.
//
// A regra é simples: com a aba ESCONDIDA, recarrega na hora — é a melhor
// janela possível, ninguém está olhando. Com a aba à vista e o cursor dentro
// de um campo, adia; o próprio ato de sair do campo ou de trocar de aba
// dispara a conferência de novo, e aí ela passa. Na prática o adiamento dura
// segundos, e nunca custa a atualização: os eventos que a reabrem são os
// mesmos que a pessoa produz ao terminar o que estava fazendo.
function jrPodeRecarregarAgora() {
  try {
    if (typeof document === 'undefined') return true;
    if (document.visibilityState === 'hidden') return true;
    const el = document.activeElement;
    if (!el) return true;
    if (el.isContentEditable) return false;
    const tag = String(el.tagName || '').toUpperCase();
    return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
  } catch (e) {
    return true;   // na dúvida, atualizar: código velho em produção é o risco maior
  }
}

window.jrConferirVersaoPublicada = async function() {
  let publicada = null;
  try {
    const resp = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) return null;
    const info = await resp.json();
    publicada = info && info.build;
  } catch(e) {
    return null;   // sem rede: segue com o que tem, sem incomodar ninguém
  }
  if (!publicada || jrMesmaVersao(publicada, CloudStore.BUILD)) return publicada;

  console.warn(`[CloudStore] Versão publicada (${publicada}) diferente da que está rodando aqui (${CloudStore.BUILD}). Atualizando...`);

  let jaTentou = null;
  try { jaTentou = sessionStorage.getItem('jr_update_tentado'); } catch(e) {}
  if (jaTentou === publicada) {
    jrAvisarAtualizacaoManual(publicada);
    return publicada;
  }

  // ADIAMENTO, e ele vem ANTES de carimbar jr_update_tentado de propósito:
  // adiar não é tentar. Carimbar aqui gastaria a única tentativa que a trava
  // contra laço concede, e o aparelho terminaria a sessão inteira na versão
  // velha exibindo a tarja de "atualize à mão" sem nunca ter recarregado.
  if (!jrPodeRecarregarAgora()) {
    window._jrUpdatePendente = publicada;
    console.info(`[CloudStore] Versão ${publicada} pronta para entrar, adiada: há um campo em edição nesta tela. Entra ao sair do campo ou ao trocar de aba.`);
    return publicada;
  }
  window._jrUpdatePendente = null;

  try { sessionStorage.setItem('jr_update_tentado', publicada); } catch(e) {}

  // Rebaixa as cópias guardadas de cada arquivo do app. cache:'reload'
  // busca da rede ignorando o que está guardado E substitui a entrada
  // daquela URL — é isso que faz o reload seguinte pegar o arquivo novo.
  // Sem query string de propósito: com ela seria outro endereço, e a
  // entrada velha continuaria valendo para a tag <script>.
  try {
    await Promise.all(CloudStore.ARQUIVOS_DO_APP.map(
      u => fetch(u, { cache: 'reload' }).catch(() => {})
    ));
  } catch(e) {}

  // Se algum dia o service worker voltar a ser registrado, o cache dele
  // também precisa sair da frente.
  try {
    if (typeof caches !== 'undefined') {
      const nomes = await caches.keys();
      await Promise.all(nomes.map(n => caches.delete(n)));
    }
  } catch(e) {}

  location.reload();
  return publicada;
};

function jrAvisarAtualizacaoManual(versaoPublicada) {
  console.error(`[CloudStore] A atualização automática não pegou. Rodando ${CloudStore.BUILD}, publicada ${versaoPublicada}.`);
  try {
    if (typeof document === 'undefined' || !document.body) return;
    let tarja = document.getElementById('jr-alerta-versao');
    if (!tarja) {
      tarja = document.createElement('div');
      tarja.id = 'jr-alerta-versao';
      tarja.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99998;background:#78350f;color:#fff;'
        + 'padding:9px 14px;font-size:12px;font-weight:700;text-align:center;border-top:2px solid #f59e0b';
      document.body.appendChild(tarja);
    }
    tarja.innerHTML = `⚠️ Este aparelho está numa versão antiga do app (${CloudStore.BUILD}; a atual é ${versaoPublicada}) `
      + 'e a atualização automática não pegou. No PC: <b>Ctrl + Shift + R</b>. No celular: feche o app e abra de novo. '
      + '<button onclick="this.parentElement.remove()" style="margin-left:8px;background:#fff;color:#78350f;border:0;'
      + 'border-radius:4px;padding:2px 8px;font-weight:800;cursor:pointer">fechar</button>';
  } catch(e) {}
}

// =================================================================
// QUANDO A VERSÃO É CONFERIDA — 01/09/2026
//
// O DEFEITO QUE ISTO FECHA, e ele é o MESMO já documentado em
// "SINCRONIZA AO VOLTAR PARA A TELA", só que na outra metade do app.
//
// A conferência de versão dependia de um único setInterval de 15 minutos —
// e o navegador não deixa esse timer rodar quando a tela não está à vista:
// aba de fundo cai para uma execução por minuto, aba parada ~5 min no Chrome
// é CONGELADA (Page Lifecycle), e celular com a tela apagada é suspenso na
// hora. O app deste prédio fica o dia inteiro atrás de uma planilha ou
// minimizado como PWA: na prática o timer disparava a cada 15 minutos DE
// TELA À VISTA, o que numa máquina de conferência pode ser uma vez por turno,
// ou nenhuma.
//
// Só que o sintoma disso não se parece com "timer congelado" — se parece com
// máquina teimosa. O aparelho fica online, sincroniza dado (o pull já acorda
// nos eventos certos desde 28/08) e mesmo assim segue rodando o JavaScript da
// semana passada. É a leitura de "26 aparelhos em versão antiga" no painel:
// não é que a atualização automática não exista, é que ela quase nunca é
// CHAMADA. Fechar e reabrir o app funcionava porque isso força um
// DOMContentLoaded — ou seja, a instrução que a operação recebia era a de
// executar à mão o único gatilho que ainda funcionava.
//
// Agora a conferência pega carona nos MESMOS quatro eventos que já acordam a
// sincronização de dados, e por isso não precisa de nenhum acerto novo para
// ser confiável — quem volta para a tela recebe o código novo antes de digitar
// a primeira letra. O intervalo de fundo continua existindo como rede de
// segurança e cai para 5 minutos: é um GET de version.json, alguns bytes.
//
// A JANELA DE 60s existe porque os três eventos de acordar disparam juntos no
// mesmo gesto (destravar o celular dispara visibilitychange E focus). Sem ela
// seriam três fetches por gesto, sem nenhum ganho.
// =================================================================
if (window.cloudStore.isConfigured()) {
  let ultimaConferenciaMs = 0;

  const conferirVersao = (motivo, janelaMs = 60000) => {
    const agora = Date.now();
    if (agora - ultimaConferenciaMs < janelaMs) return;
    ultimaConferenciaMs = agora;
    Promise.resolve(window.jrConferirVersaoPublicada()).catch(() => {});
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => conferirVersao('abertura', 0), 3000);
    setInterval(() => conferirVersao('rede de segurança', 0), 5 * 60 * 1000);
  });

  // A ABA ESCONDIDA É A MELHOR HORA PARA ATUALIZAR, e é por isso que este
  // caso não tem janela de espera: ninguém está olhando, nenhum campo pode
  // estar em edição para jrPodeRecarregarAgora() barrar, e a pessoa volta
  // para a tela já na versão nova sem ter visto um recarregamento.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') conferirVersao('aba escondida', 0);
    else conferirVersao('voltou para a tela');
  });

  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) conferirVersao('página restaurada do cache do navegador');
  });
  window.addEventListener('focus', () => conferirVersao('janela recebeu foco'));
  window.addEventListener('online', () => conferirVersao('rede voltou'));

  // Sair de um campo é o fim natural do adiamento de jrPodeRecarregarAgora():
  // quem terminou de digitar é exatamente quem pode receber a versão nova
  // agora. Só faz alguma coisa se houver adiamento pendente, então não custa
  // nada nos outros milhares de blur de um dia de uso.
  document.addEventListener('focusout', () => {
    if (!window._jrUpdatePendente) return;
    setTimeout(() => {
      if (window._jrUpdatePendente) conferirVersao('campo perdeu o foco', 0);
    }, 250);   // deixa o foco assentar: trocar de campo dispara focusout antes do focusin
  });
}

// Atalho de console para batizar a máquina: jrNomearAparelho('CCO 1').
window.jrNomearAparelho = function(apelido) {
  const ok = window.cloudStore.nomearAparelho(apelido);
  console.info(ok ? `Este aparelho agora se chama "${apelido}" na tela de Aparelhos.` : 'Informe um nome, ex: jrNomearAparelho("CCO 1")');
  return ok;
};
