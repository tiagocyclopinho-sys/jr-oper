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
      quando: new Date().toISOString()
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
      ultimoErro: this._ultimoErroSync
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
  // LEITURA COMPLETA DE UMA TABELA (GET)
  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // IMPRESSÃO DIGITAL DE UMA TABELA (23/08/2026)
  //
  // O push reenviava TODAS as tabelas inteiras a cada ciclo de 30s, mesmo
  // sem nenhuma alteração. Isso já era desperdício; com clientes e produtos
  // entrando na lista (19 mil linhas somadas) passaria a ser 38 requisições
  // por ciclo transportando megabytes à toa — cota do Supabase e plano de
  // dados do celular da equipe.
  //
  // Guardamos um hash barato do conteúdo já enviado com sucesso e pulamos a
  // tabela quando ele não mudou. É djb2 sobre o JSON: uma varredura linear,
  // alguns milissegundos mesmo nos 3MB do catálogo de clientes — muito mais
  // barato que a requisição que ele evita.
  _impressaoDigital(texto) {
    let h = 5381;
    for (let i = 0; i < texto.length; i++) {
      h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
    }
    return String(h >>> 0) + ':' + texto.length;
  }

  // ---------------------------------------------------------------
  // LEITURA PAGINADA
  //
  // O PostgREST corta a resposta no limite de linhas do projeto (1.000 por
  // padrão no Supabase) e devolve 206 Partial Content sem avisar mais nada.
  // Um GET simples em clientes traria 1.000 das 15.139 linhas — e o pull,
  // que trata o que veio como a verdade, apagaria as outras 14.139 do
  // aparelho. Por isso toda tabela grande é lida por faixas até vir uma
  // página menor que o tamanho pedido.
  // ---------------------------------------------------------------
  // Quantos registros esta coleção tem NESTE aparelho, lendo a fonte real
  // (não a chave-espelho 'jr_<tabela>', que só existe depois do primeiro
  // pull e por isso responderia zero justamente no cenário mais perigoso:
  // aparelho cheio de dados que ainda não conseguiu enviar nada).
  _contarLocal(m) {
    try {
      if (m.estatico) {
        const raw = localStorage.getItem('jr_sac_static');
        const obj = raw ? JSON.parse(raw) : null;
        return (obj && Array.isArray(obj[m.dbKey])) ? obj[m.dbKey].length : 0;
      }
      const raw = localStorage.getItem('jr_sac_db');
      const obj = raw ? JSON.parse(raw) : null;
      if (obj && Array.isArray(obj[m.dbKey])) {
        const inativos = (m.listaSimples && Array.isArray(obj[m.dbKey + '_inativos'])) ? obj[m.dbKey + '_inativos'].length : 0;
        return obj[m.dbKey].length + inativos;
      }
      const espelho = localStorage.getItem(m.localKey);
      const parsed = espelho ? JSON.parse(espelho) : null;
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch(e) {
      return 0;
    }
  }

  async getAllPaginado(tableName, tamanhoPagina = 1000) {
    if (!this.isConfigured()) return null;
    const todos = [];
    let inicio = 0;
    for (let guarda = 0; guarda < 500; guarda++) { // teto de segurança: 500 páginas
      const fim = inicio + tamanhoPagina - 1;
      try {
        const response = await fetch(`${this.config.url}/rest/v1/${tableName}?select=*`, {
          headers: this._headers({ 'Range-Unit': 'items', 'Range': `${inicio}-${fim}` })
        });
        if (!response.ok && response.status !== 206) {
          console.warn(`[CloudStore] Erro ao ler ${tableName} (faixa ${inicio}-${fim}):`, response.status);
          return null; // parcial não serve: devolver metade seria pior que não ler
        }
        const pagina = await response.json();
        if (!Array.isArray(pagina)) return null;
        todos.push(...pagina);
        if (pagina.length < tamanhoPagina) return todos;
        inicio += tamanhoPagina;
      } catch(err) {
        console.warn(`[CloudStore] Falha na rede ao ler ${tableName}:`, err.message);
        return null;
      }
    }
    console.warn(`[CloudStore] Leitura de ${tableName} interrompida no teto de segurança de páginas.`);
    return todos;
  }

  async getAll(tableName, filters = '') {
    if (!this.isConfigured()) return null;
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

    // ENVIO EM LOTES (23/08/2026)
    //
    // O POST era um só, com a tabela inteira no corpo. Funcionava enquanto
    // as tabelas eram pequenas; ao ligar clientes (15.139 linhas) e produtos
    // (4.010) na sincronização isso viraria um corpo de vários MB por
    // requisição — tempo de resposta alto, risco de timeout no celular e,
    // pior, um único registro problemático derrubando as 15 mil linhas de
    // uma vez (o POST é tudo-ou-nada). Em lotes, uma falha isolada afeta
    // apenas o seu lote e o resto da tabela chega ao banco.
    const TAMANHO_LOTE = 500;
    const lotes = [];
    for (let i = 0; i < data.length; i += TAMANHO_LOTE) {
      lotes.push(data.slice(i, i + TAMANHO_LOTE));
    }

    try {
      for (const lote of lotes) {
        const response = await fetch(`${this.config.url}/rest/v1/${tableName}`, {
          method: 'POST',
          headers: this._headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(lote)
        });
        if (!response.ok) {
          const errBody = await response.text();
          this._registrarFalhaSync(tableName, response.status, errBody);
          this._checkConflitoUnicidade(tableName, errBody, lote).catch(() => {});
          return false;
        }
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
      { dbKey: 'setores',               localKey: 'jr_setores',           tableName: 'setores' },
      // (achado de 21/08/2026, corrigido em 23/08/2026) produtos e setores
      // NUNCA estiveram nesta lista: existiam como tabela no banco e como
      // coleção local, mas jamais saíam do aparelho que os cadastrou. Por
      // isso a lista de produtos da Devolução aparecia vazia — e o campo,
      // que é um <input list="produtos-list">, virava texto livre nos
      // outros aparelhos. Também eram as duas tabelas cujas FKs nunca
      // teriam como ser satisfeitas (ver migration_22).
      //
      // Junto entram as quatro coleções que fecham a aba "Cadastros
      // Mestres" (achado de 23/08/2026 — metade das abas não chegava ao
      // banco):
      //   estatico: mora em 'jr_sac_static', não na fatia operacional.
      //   listaSimples: array de string local ↔ linhas {nome, ativo} no
      //                 banco (rotas e motivos de devolução).
      //   colunas: whitelist do que a tabela realmente tem. O upsert manda
      //            o registro como está, e clientes/produtos carregam
      //            campos que só existem no app (codigo, nome) — um deles
      //            basta para o PostgREST recusar o lote com PGRST204.
      { dbKey: 'rotas',                 localKey: 'jr_rotas',             tableName: 'rotas',              listaSimples: true },
      { dbKey: 'motivos_devolucao',     localKey: 'jr_motivos_devolucao', tableName: 'motivos_devolucao',  listaSimples: true },
      // departamentos: cadastro do admin (nome + papel de acesso + cargo).
      // Não é listaSimples: carrega role/cargo além do nome, e é justamente
      // o role que precisa viajar entre aparelhos — o admin muda
      // "SUPERVISÃO: SAC" para "SUPERVISÃO: GESTOR" no PC e isso tem de
      // valer no celular de todo mundo.
      //
      // `usuarios.departamento` continua sendo TEXTO LIVRE, sem FK para cá,
      // e isso é deliberado: `usuarios` sobe ANTES desta tabela na ordem de
      // envio, e uma FK faria o Postgres recusar todo usuário cujo
      // departamento ainda não tivesse chegado. É exatamente a armadilha
      // documentada na migração 22 ("chaves estrangeiras que a sincronização
      // não tem como respeitar"), e ela custou uma semana. Aqui a tabela é
      // consultada, não imposta: departamento desconhecido não quebra o
      // cadastro do usuário, só faz o menu falhar aberto.
      { dbKey: 'departamentos',         localKey: 'jr_departamentos',     tableName: 'departamentos',
        colunas: ['nome','role','cargo','ativo'] },
      { dbKey: 'clientes',              localKey: 'jr_clientes',          tableName: 'clientes',           estatico: true,
        colunas: ['id','codigo_cliente','razao_social','cnpj','cidade','uf','is_deleted','deleted_at','deleted_by_usuario_id','deleted_by_nome'] },
      { dbKey: 'produtos',              localKey: 'jr_produtos',          tableName: 'produtos',           estatico: true,
        colunas: ['id','codigo_produto','descricao','categoria','valor_unitario_padrao','is_deleted','deleted_at','deleted_by_usuario_id','deleted_by_nome'] },
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

    let fullDb = null;
    try {
      const rawFull = localStorage.getItem('jr_sac_db');
      if (rawFull) fullDb = JSON.parse(rawFull);
    } catch(e) {}

    // clientes e produtos não estão em 'jr_sac_db' de propósito — vivem na
    // chave separada 'jr_sac_static' (ver store.js:_getOperationalSlice).
    let staticDb = null;
    try {
      const rawStatic = localStorage.getItem('jr_sac_static');
      if (rawStatic) staticDb = JSON.parse(rawStatic);
    } catch(e) {}

    for (const m of mappings) {
      try {
        let records = [];
        const origem = m.estatico ? staticDb : fullDb;
        if (origem && Array.isArray(origem[m.dbKey])) {
          records = origem[m.dbKey];
        } else if (!m.estatico && !m.listaSimples) {
          // Só as tabelas comuns caem no atalho da chave própria. Para
          // estatico/listaSimples a chave 'jr_<tabela>' guarda o formato do
          // BANCO (o espelho do último pull), não o formato do app — usá-la
          // aqui reenviaria linha já convertida como se fosse dado local.
          const raw = localStorage.getItem(m.localKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            records = Array.isArray(parsed) ? parsed : Object.values(parsed);
          }
        }

        // Lista de texto simples → linhas do banco. As ativas vão com
        // ativo=true; as excluídas ("lápides", ver store.js:_listaSimplesDelete)
        // vão com ativo=false, que é como a exclusão viaja entre aparelhos
        // sem que o upsert precise apagar linha nenhuma.
        if (m.listaSimples) {
          const inativos = (fullDb && Array.isArray(fullDb[m.dbKey + '_inativos'])) ? fullDb[m.dbKey + '_inativos'] : [];
          records = [
            ...records.map(nome => ({ nome: String(nome), ativo: true })),
            ...inativos.map(nome => ({ nome: String(nome), ativo: false }))
          ].filter(r => r.nome.trim() !== '');
        }

        // Descarta campos que só existem no app antes de enviar.
        if (m.colunas && records.length > 0) {
          records = records.map(r => {
            const limpo = {};
            m.colunas.forEach(c => { if (c in r) limpo[c] = r[c]; });
            return limpo;
          });
        }

        if (!records || records.length === 0) continue;

        // Nada mudou desde o último envio bem-sucedido? Não gasta requisição.
        const corpo = JSON.stringify(records);
        const digital = this._impressaoDigital(corpo);
        const chaveDigital = 'jr_sync_hash_' + m.tableName;
        let digitalAnterior = null;
        try { digitalAnterior = localStorage.getItem(chaveDigital); } catch(e) {}
        if (digitalAnterior === digital && !this._tabelasPendentesDeEnvio.has(m.tableName)) continue;

        const ok = await this.upsert(m.tableName, records);
        try {
          if (ok) localStorage.setItem(chaveDigital, digital);
          else localStorage.removeItem(chaveDigital); // falhou: tentar de novo no próximo ciclo
        } catch(e) {}
      } catch(e) {
        console.warn(`[CloudStore] Erro ao sincronizar ${m.tableName}:`, e);
      }
    }

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

    const mappings = [
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
      { tableName: 'itens_avulsos_destinacao', localKey: 'jr_itens_avulsos_destinacao', dbKey: 'itens_avulsos_destinacao' },
      // Cadastros mestre que passaram a sincronizar em 23/08/2026 — ver a
      // explicação das marcas (listaSimples/estatico) no push acima.
      { tableName: 'setores',               localKey: 'jr_setores',           dbKey: 'setores' },
      { tableName: 'rotas',                 localKey: 'jr_rotas',             dbKey: 'rotas',    listaSimples: true },
      { tableName: 'motivos_devolucao',     localKey: 'jr_motivos_devolucao', dbKey: 'motivos_devolucao', listaSimples: true },
      { tableName: 'departamentos',         localKey: 'jr_departamentos',     dbKey: 'departamentos' },
      { tableName: 'clientes',              localKey: 'jr_clientes',          dbKey: 'clientes', estatico: true },
      { tableName: 'produtos',              localKey: 'jr_produtos',          dbKey: 'produtos', estatico: true }
    ];

    // Um Reset Global feito em OUTRO aparelho precisa ser reconhecido aqui
    // antes de qualquer comparação, senão este aparelho reenvia o que o
    // outro acabou de apagar. Ver sync_control em migration_23.
    const epochNuvem = await this._lerResetEpochNuvem();
    const epochLocal = Number(localStorage.getItem('jr_reset_epoch') || 0);
    const resetRemotoPendente = epochNuvem > epochLocal;
    if (resetRemotoPendente) {
      console.warn(`[CloudStore] Reset Global detectado na nuvem (${new Date(epochNuvem).toLocaleString('pt-BR')}). Este aparelho vai adotar o estado da nuvem.`);
      // As marcas de "já sincronizou" perdem validade após um reset.
      // As impressões digitais do push (jr_sync_hash_*) também: elas dizem
      // "esta tabela já está na nuvem exatamente assim" e, depois de um
      // reset que esvaziou a nuvem, isso deixou de ser verdade. Sem limpar,
      // o push pularia justamente as tabelas que precisam ser reenviadas e
      // a nuvem ficaria vazia até alguém editar algum registro.
      try {
        Object.keys(localStorage)
          .filter(k => k.indexOf('jr_sync_ok_') === 0 || k.indexOf('jr_sync_hash_') === 0)
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
    // clientes/produtos não podem entrar em 'jr_sac_db' — são os 3MB que a
    // divisão de chaves tirou de lá justamente para não estourar a cota.
    // Quando o pull traz mudança neles, a gravação vai para 'jr_sac_static'.
    let estaticoAtualizado = false;

    for (const m of mappings) {
      try {
        // Tabelas grandes precisam de leitura paginada: um GET simples
        // pararia no limite de linhas do PostgREST (1.000) e o pull trataria
        // essa página como a tabela inteira, apagando o resto do aparelho.
        const cloudData = m.estatico
          ? await this.getAllPaginado(m.tableName)
          : await this.getAll(m.tableName);
        if (!cloudData) continue;

        const localRaw = localStorage.getItem(m.localKey);

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
          const localTemDados = this._contarLocal(m) > 0;
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

        // MESMO RACIOCÍNIO, PARA NUVEM PARCIALMENTE CHEIA (23/08/2026)
        //
        // O bloco acima só reconhece a nuvem COMPLETAMENTE vazia. Com o
        // envio em lotes isso deixa de bastar: o catálogo de clientes sobe
        // em 31 lotes de 500, e se o lote 3 for recusado a nuvem fica com
        // 1.000 linhas — não zero. Nesse estado o pull trataria as 1.000
        // como a verdade e apagaria as outras 14.139 deste aparelho,
        // consolidando a perda no ciclo seguinte.
        //
        // Enquanto a tabela nunca tiver subido INTEIRA com sucesso, uma
        // nuvem menor que o local é sintoma de envio incompleto, não de
        // exclusão. Depois do primeiro envio completo a marca existe e o
        // encolhimento volta a ser aceito normalmente (é uma exclusão real
        // feita em outro aparelho).
        if (Array.isArray(cloudData) && cloudData.length > 0 && !localStorage.getItem('jr_sync_ok_' + m.tableName) && !resetRemotoPendente) {
          const qtdLocal = this._contarLocal(m);
          if (qtdLocal > cloudData.length) {
            console.warn(`[CloudStore] ${m.tableName}: nuvem tem ${cloudData.length} linhas contra ${qtdLocal} locais e esta tabela nunca subiu inteira — envio incompleto. Preservando o dado local e reenviando.`);
            this._tabelasPendentesDeEnvio.add(m.tableName);
            continue;
          }
        }

        const localStr = JSON.stringify(cloudData);

        if (localRaw !== localStr) {
          localStorage.setItem(m.localKey, localStr);
          if (m.listaSimples) {
            // Linhas {nome, ativo} → os dois arrays de texto do app.
            // `ativo === false` é a exclusão feita em outro aparelho
            // chegando aqui; ela precisa entrar em _inativos, não sumir,
            // senão o push seguinte devolveria o item como ativo.
            const ativos = [];
            const inativos = [];
            cloudData.forEach(linha => {
              const nome = String(linha && linha.nome || '').trim();
              if (!nome) return;
              if (linha.ativo === false) inativos.push(nome);
              else ativos.push(nome);
            });
            pulledUpdates[m.dbKey] = ativos;
            pulledUpdates[m.dbKey + '_inativos'] = inativos;
          } else {
            pulledUpdates[m.dbKey] = cloudData;
          }
          if (m.estatico) estaticoAtualizado = true;
          anyChange = true;
        }
      } catch(e) {
        console.warn(`[CloudStore] Erro ao baixar ${m.tableName}:`, e);
      }
    }

    if (anyChange) {
      try {
        // Separa o que vai para cada chave: clientes/produtos em
        // 'jr_sac_static', todo o resto na fatia operacional.
        const atualizacoesEstaticas = {};
        const atualizacoesOperacionais = {};
        Object.keys(pulledUpdates).forEach(k => {
          if (k === 'clientes' || k === 'produtos') atualizacoesEstaticas[k] = pulledUpdates[k];
          else atualizacoesOperacionais[k] = pulledUpdates[k];
        });

        const rawFullNow = localStorage.getItem('jr_sac_db');
        const fullDb = rawFullNow ? JSON.parse(rawFullNow) : {};
        Object.assign(fullDb, atualizacoesOperacionais);
        localStorage.setItem('jr_sac_db', JSON.stringify(fullDb));

        if (estaticoAtualizado) {
          const rawStaticNow = localStorage.getItem('jr_sac_static');
          const staticDb = rawStaticNow ? JSON.parse(rawStaticNow) : {};
          Object.assign(staticDb, atualizacoesEstaticas);
          localStorage.setItem('jr_sac_static', JSON.stringify(staticDb));
        }

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

    // FORA do "if (anyChange)" de propósito: quando a nuvem já está igual ao
    // cache local (nenhuma mudança a aplicar), é justamente o caso em que a
    // lista curta já se consolidou nos dois lados. É aí que a reposição mais
    // precisa rodar.
    if (window.db && typeof window.db.restaurarCadastrosDaPlanilha === 'function') {
      try {
        const repostos = window.db.restaurarCadastrosDaPlanilha();
        if (repostos > 0) {
          // save() persiste em jr_sac_db (de onde o push lê) e agenda o envio.
          window.db.save();
        }
      } catch(e) {
        console.warn('[CloudStore] Falha ao restaurar cadastros da planilha:', e);
      }
    }

    // Só marca o reset como aplicado depois que o pull inteiro terminou —
    // se a rede cair no meio, o aparelho tenta de novo no próximo ciclo em
    // vez de ficar num estado meio-aplicado.
    if (resetRemotoPendente) {
      try { localStorage.setItem('jr_reset_epoch', String(epochNuvem)); } catch(e) {}
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

CloudStore.BUILD = "sync-4.7.9";

window.cloudStore = new CloudStore();

// Atalho de diagnóstico para o console do navegador (F12). Responde a
// pergunta que antes só o console.warn respondia, e só para quem sabia
// procurar: "os dados desta máquina estão de fato chegando no banco?"
window.jrDiagnosticoSync = function() {
  const d = window.cloudStore.getDiagnostico();
  console.table(d.tabelasComPendencia.map(t => ({ tabela: t, estado: 'NAO SALVA NA NUVEM' })));
  if (d.ultimoErro) console.error('Último erro:', d.ultimoErro);
  if (!d.tabelasComPendencia.length) console.info('✅ Nenhuma tabela pendente — tudo que foi salvo aqui chegou ao banco.');
  return d;
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
