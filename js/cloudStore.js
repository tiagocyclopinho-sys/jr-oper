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
    
    let data = Array.isArray(records) ? records : [records]; if (data.length > 1) { const allKeys = new Set(); data.forEach(r => Object.keys(r).forEach(k => allKeys.add(k))); data = data.map(r => { const normalized = {}; allKeys.forEach(k => { normalized[k] = (k in r) ? r[k] : null; }); return normalized; }); }
    try {
      const response = await fetch(`${this.config.url}/rest/v1/${tableName}`, {
        method: 'POST',
        headers: this._headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const errBody = await response.text();
        console.warn(`[CloudStore] Erro ao salvar em ${tableName}:`, response.status, errBody);
        return false;
      }
      return true;
    } catch(err) {
      console.warn(`[CloudStore] Falha na rede ao salvar em ${tableName}:`, err.message);
      return false;
    }
  }

  // ---------------------------------------------------------------
  // SINCRONIZAÇÃO AUTOMÁTICA: Local → Nuvem
  // Pega os dados do LocalStorage e envia para o Supabase
  // ---------------------------------------------------------------
  async syncLocalToCloud() {
    if (!this.isConfigured()) return;

    // Mapeamento: chave no jr_sac_db / localStorage → tabela no Supabase
    const mappings = [
      { dbKey: 'ocorrencias_devolucao', localKey: 'jr_ocorrencias',       tableName: 'ocorrencias_devolucao' },
      { dbKey: 'ocorrencias_rota',      localKey: 'jr_ocorrencias_rota',  tableName: 'ocorrencias_rota' },
      { dbKey: 'retencoes_frota',       localKey: 'jr_retencoes_frota',   tableName: 'retencoes_frota' },
      { dbKey: 'reentregas',            localKey: 'jr_reentregas',        tableName: 'reentregas_rota' },
      { dbKey: 'trocas_veiculos',       localKey: 'jr_trocas_veiculos',   tableName: 'trocas_veiculos' },
      { dbKey: 'motoristas',            localKey: 'jr_motoristas',        tableName: 'motoristas' },
      { dbKey: 'ajudantes',             localKey: 'jr_ajudantes',         tableName: 'ajudantes' },
      { dbKey: 'veiculos',              localKey: 'jr_veiculos',          tableName: 'veiculos' },
      { dbKey: 'cargas',                localKey: 'jr_cargas',            tableName: 'cargas' },
      { dbKey: 'clientes',              localKey: 'jr_clientes',          tableName: 'clientes' },
      { dbKey: 'usuarios',              localKey: 'jr_usuarios',          tableName: 'usuarios' },
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
      { dbKey: 'ausencias_registros',   localKey: 'jr_ausencias_registros', tableName: 'ausencias_registros' }
    ];

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
          await this.upsert(m.tableName, records);
        }
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

        if (window.db && window.db._cloudSyncTimer) { clearTimeout(window.db._cloudSyncTimer); window.db._cloudSyncTimer = null; try { await this.syncLocalToCloud(); } catch(e) {} }

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
      { tableName: 'clientes',              localKey: 'jr_clientes',          dbKey: 'clientes' },
      { tableName: 'usuarios',              localKey: 'jr_usuarios',          dbKey: 'usuarios' },
      { tableName: 'audit_logs',            localKey: 'jr_audit_logs',        dbKey: 'audit_logs' },
      { tableName: 'registro_versoes',      localKey: 'jr_registro_versoes',  dbKey: 'registro_versoes' },
      { tableName: 'controle_viagens',      localKey: 'jr_controle_viagens',  dbKey: 'controle_viagens' },
      { tableName: 'ocorrencias_viagens',   localKey: 'jr_ocorrencias_viagens', dbKey: 'ocorrencias_viagens' },
      { tableName: 'resumo_diario_cd',      localKey: 'jr_resumo_diario_cd',  dbKey: 'resumo_diario_cd' },
      { tableName: 'medidas_disciplinares', localKey: 'jr_medidas_disciplinares', dbKey: 'medidas_disciplinares' },
      { tableName: 'orientacoes_feedback',  localKey: 'jr_orientacoes_feedback', dbKey: 'orientacoes_feedback' },
      { tableName: 'atestados_medicos',     localKey: 'jr_atestados_medicos', dbKey: 'atestados_medicos' },
      { tableName: 'ausencias_registros',   localKey: 'jr_ausencias_registros', dbKey: 'ausencias_registros' }
    ];

    let anyChange = false;
    let fullDb = null;
    try {
      const rawFull = localStorage.getItem('jr_sac_db');
      if (rawFull) fullDb = JSON.parse(rawFull);
    } catch(e) {}

    for (const m of mappings) {
      try {
        const cloudData = await this.getAll(m.tableName);
        if (!cloudData) continue;
        
        const localRaw = localStorage.getItem(m.localKey);
        const localStr = JSON.stringify(cloudData);
        
        if (localRaw !== localStr) {
          localStorage.setItem(m.localKey, localStr);
          if (fullDb) {
            fullDb[m.dbKey] = cloudData;
          }
          anyChange = true;
        }
      } catch(e) {
        console.warn(`[CloudStore] Erro ao baixar ${m.tableName}:`, e);
      }
    }

    if (fullDb && anyChange) {
      try {
        localStorage.setItem('jr_sac_db', JSON.stringify(fullDb));
        if (window.db && window.db.data) {
          window.db.data = fullDb;
        }
      } catch(e) {}
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
    
    // Migração automática: antes do primeiro "pull", envia o que já existe
            // neste aparelho. Sem isso, o primeiro pull sobrescreveria com os dados
            // da nuvem qualquer cadastro feito localmente antes da nuvem existir
            // (ex: usuários de teste criados em cada aparelho antes do modo cloud
            // ser ativado) — cada aparelho perderia silenciosamente seus próprios
            // dados. Rodar o push primeiro garante que eles sejam mesclados na
            // nuvem (upsert com merge-duplicates) em vez de descartados.
            this.syncLocalToCloud()
              .catch(e => console.warn('[CloudStore] Falha ao enviar dados locais antes da primeira sincronização:', e))
              .then(() => this.syncCloudToLocal());
    
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

    indicator.innerHTML = `<span style="color:${colors[status]}">${icons[status]}</span> <span style="color:#cbd5e1;font-size:10px;">${labels[status]}</span>`;
    indicator.title = `Status do Banco de Dados: ${labels[status]}`;
  }
}

window.cloudStore = new CloudStore();

// Inicia sincronização automática se já estiver configurado
if (window.cloudStore.isConfigured()) {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => window.cloudStore.startAutoSync(), 2000);
  });
}
