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
      bloqueadosNaEscrita: this._bloqueadosNaEscrita
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

    try {
      const response = await fetch(`${this.config.url}/rest/v1/${tableName}`, {
        method: 'POST',
        headers: this._headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const errBody = await response.text();
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

  // Guarda na escrita — decisão 7 de 22/08/2026 (Onda 1, item 7).
  // Ver o comentário longo dentro de upsert(), onde ela é chamada.
  //
  // Recusa é local e silenciosa para o operador de propósito: o registro
  // recusado é lixo de uma build antiga, não trabalho de alguém. Quem
  // precisa saber é quem estiver fazendo a ETAPA 3 — por isso a contagem
  // aparece em jrDiagnosticoSync(), e é ela que identifica o aparelho que
  // carregava os 247 fantasmas, sem precisar sair andando pela empresa.
  _aplicarGuardaDeEscrita(tableName, registros) {
    if (tableName !== 'controle_viagens') return registros;

    const aprovados = [];
    const recusados = [];
    for (const r of registros) {
      if (r && !this._dataSaidaEhValida(r.data_saida)) recusados.push(r);
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
      console.warn('[CloudStore] Não foi possível gravar o mapa de sincronização (o envio volta a mandar tudo):', e.message);
    }
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
      if (conhecidos[id] !== this._hashRegistro(r)) mudados.push(r);
    }
    return mudados;
  }

  _confirmarEnvio(tableName, enviados) {
    const mapa = this._lerMapaSync();
    if (!mapa[tableName]) mapa[tableName] = {};
    for (const r of enviados) {
      const id = (r && r.id !== undefined && r.id !== null) ? String(r.id) : null;
      if (id !== null) mapa[tableName][id] = this._hashRegistro(r);
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
    let preservados = 0, descartados = 0;

    for (const nuvem of cloudData) {
      const id = (nuvem && nuvem.id !== undefined && nuvem.id !== null) ? String(nuvem.id) : null;
      if (id === null) { resultado.push(nuvem); continue; }
      idsNaNuvem.add(id);

      const local = porId.get(id);
      if (!local) {
        resultado.push(nuvem);
        novosHashes[id] = this._hashRegistro(nuvem);
        continue;
      }

      // "Sujo" = mexido aqui e ainda não confirmado pela nuvem. Na primeira
      // execução não há como saber, e aí a nuvem manda: é o que impede um
      // aparelho parado desde 20/08 de despejar o cache antigo por cima do
      // que os outros já corrigiram.
      const sujo = !primeiraVez
        && conhecidos[id] !== undefined
        && this._hashRegistro(local) !== conhecidos[id];

      if (sujo) {
        resultado.push(local);
        novosHashes[id] = conhecidos[id];   // segue pendente até subir
        idsSeguros.add(id);
        preservados++;
      } else {
        resultado.push(nuvem);
        novosHashes[id] = this._hashRegistro(nuvem);
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

    if (preservados > 0 || descartados > 0) {
      console.log(`[CloudStore] ${tableName}: ${preservados} registro(s) local(is) preservado(s) por terem mudança não enviada; ${descartados} descartado(s) por terem sido apagados na nuvem.`);
    }

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
  _auditarCacheLocal() {
    // Lia 'jr_controle_viagens' — o espelho — e o espelho só é escrito pelo
    // pull. Entre um ciclo e outro ele não reflete o que o aparelho guarda,
    // então este contador podia dizer "limpo" com fantasma na fatia
    // operacional, e o contrário também (correção de 23/08/2026, junto com
    // a autoridade do pull). É este número que decide se uma máquina pode
    // operar antes do Reset Global — ele precisa contar o que ela realmente
    // tem, na mesma ordem de confiança usada no pull.
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
          await this.syncCloudToLocal();
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

    let fullDb = null;
    try {
      const rawFull = localStorage.getItem('jr_sac_db');
      if (rawFull) fullDb = JSON.parse(rawFull);
    } catch(e) {}

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
  // ---------------------------------------------------------------
  async syncCloudToLocal() {
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
        if (espelhoRaw !== mescladoStr) {
          localStorage.setItem(m.localKey, mescladoStr);
        }
        if (localRaw !== mescladoStr) {
          pulledUpdates[m.dbKey] = mesclado;
          anyChange = true;
        }
      } catch(e) {
        console.warn(`[CloudStore] Erro ao baixar ${m.tableName}:`, e);
      }
    }

    if (anyChange) {
      try {
        const rawFullNow = localStorage.getItem('jr_sac_db');
        const fullDb = rawFullNow ? JSON.parse(rawFullNow) : {};
        Object.assign(fullDb, pulledUpdates);
        localStorage.setItem('jr_sac_db', JSON.stringify(fullDb));

        // NÃO substituir window.db.data por fullDb (achado de 22/08/2026,
        // erro "Cannot read properties of undefined (reading 'filter')" na
        // tela de Cadastros).
        //
        // 'jr_sac_db' guarda só a FATIA OPERACIONAL: store.js:_getOperationalSlice()
        // remove clientes e produtos de propósito antes de gravar, porque são
        // 15.139 clientes e 4.010 produtos vindos da planilha Dados SAC e ficam
        // na chave separada 'jr_sac_static' (foi isso que derrubou o tamanho de
        // cada gravação de ~3MB para dezenas de KB).
        //
        // Trocar db.data por fullDb apagava clientes e produtos da memória a
        // cada pull — a lista de clientes sumia e db.data.produtos virava
        // undefined, quebrando a tela de Cadastros. Mesclamos apenas as chaves
        // que realmente vieram da nuvem, preservando o resto de db.data.
        if (window.db && window.db.data) {
          Object.assign(window.db.data, pulledUpdates);
        } else if (window.db) {
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
      } catch(e) {}
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

    if (anyChange) {
      console.log('[CloudStore] Dados atualizados da Nuvem para este aparelho.');
      // Dispara evento para que o app atualize a tela
      window.dispatchEvent(new CustomEvent('jr-cloud-sync', { detail: { updated: true } }));
    }

    return anyChange;
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
    }, interval);
  }

  stopAutoSync() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
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
    const pendentes = this._tabelasPendentesDeEnvio ? this._tabelasPendentesDeEnvio.size : 0;
    if (status === 'online' && pendentes > 0) {
      const err = this._ultimoErroSync;
      indicator.innerHTML = `<span style="color:#ef4444">🔴</span> <span style="color:#fca5a5;font-size:10px;">Dados NÃO salvos na nuvem (${pendentes})</span>`;
      indicator.title = err
        ? `Falha ao gravar em "${err.tabela}" (HTTP ${err.status}): ${err.detalhe}\n\nOs dados estão salvos apenas neste aparelho e NÃO aparecem para os outros. Chame jrDiagnosticoSync() no console para o detalhe.`
        : 'Há tabelas com dados que a nuvem recusou.';
      return;
    }

    indicator.innerHTML = `<span style="color:${colors[status]}">${icons[status]}</span> <span style="color:#cbd5e1;font-size:10px;">${labels[status]}</span>`;
    indicator.title = `Status do Banco de Dados: ${labels[status]}`;
  }
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
// Sao QUATRO marcadores de versao, e os quatro andam juntos:
//   js/cloudStore.js  CloudStore.BUILD   <- este
//   version.json      build
//   js/config.js      appVersion
//   sw.js             CACHE_NAME
CloudStore.BUILD = "sync-5.1.0";

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
      `Limpe o cache deste aparelho — é a ETAPA 3 do roteiro.`,
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
  if (!publicada || publicada === CloudStore.BUILD) return publicada;

  console.warn(`[CloudStore] Versão publicada (${publicada}) diferente da que está rodando aqui (${CloudStore.BUILD}). Atualizando...`);

  let jaTentou = null;
  try { jaTentou = sessionStorage.getItem('jr_update_tentado'); } catch(e) {}
  if (jaTentou === publicada) {
    jrAvisarAtualizacaoManual(publicada);
    return publicada;
  }
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

if (window.cloudStore.isConfigured()) {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => window.jrConferirVersaoPublicada(), 3000);
    setInterval(() => window.jrConferirVersaoPublicada(), 15 * 60 * 1000);
  });
}

// Atalho de console para batizar a máquina: jrNomearAparelho('CCO 1').
window.jrNomearAparelho = function(apelido) {
  const ok = window.cloudStore.nomearAparelho(apelido);
  console.info(ok ? `Este aparelho agora se chama "${apelido}" na tela de Aparelhos.` : 'Informe um nome, ex: jrNomearAparelho("CCO 1")');
  return ok;
};
