// Camada de Armazenamento e Gerenciamento de Estado do JR SAC

// Utilitário de Hashing SHA-256 (P3 - Segurança de Senhas)
function sha256Sync(ascii) {
  if (!ascii) return '';
  if (/^[a-f0-9]{64}$/i.test(ascii)) return ascii;
  
  function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i, j;
  let result = '';

  const words = [];
  const asciiBitLength = ascii.length * 8;
  
  const hash = [];
  const k = [];
  let primeCounter = 0;

  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 300; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - i % 4) * 8);
  }
  words[words.length] = ((asciiBitLength / maxWord) | 0);
  words[words.length] = (asciiBitLength | 0);
  
  for (j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash.slice(0);
    
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0
        );
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      
      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  
  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

class Store {
  constructor() {
    try {
      this.init();
    } catch(err) {
      console.error("Erro crítico na construção da Store:", err);
      this.data = (typeof INITIAL_DATA !== 'undefined') ? JSON.parse(JSON.stringify(INITIAL_DATA)) : {};
      this.currentUser = null;
    }
  }

  init() {
    try {
      const storedVersion = localStorage.getItem('jr_sac_version');
      const currentVersion = '6.1.0';
      if (!localStorage.getItem('jr_sac_db')) {
        // Primeira vez: grava banco inicial
        try {
          localStorage.setItem('jr_sac_db', JSON.stringify(INITIAL_DATA));
          localStorage.setItem('jr_sac_version', currentVersion);
        } catch(eSet) {
          console.warn("Nao foi possivel gravar jr_sac_db inicial no localStorage:", eSet);
        }
      } else if (storedVersion !== currentVersion) {
        // Migração: preserva dados existentes e atualiza versão
        console.info(`[Store] Migrando versão ${storedVersion} → ${currentVersion} (dados preservados)`);
        try {
          localStorage.setItem('jr_sac_version', currentVersion);
        } catch(eMig) {
          console.warn("Nao foi possivel atualizar versão no localStorage:", eMig);
        }
      }
      const rawDb = localStorage.getItem('jr_sac_db');
      this.data = rawDb ? JSON.parse(rawDb) : null;
    } catch(e) {
      console.warn("Usando INITIAL_DATA devido a exceção no localStorage:", e);
      this.data = null;
    }

    if (!this.data || typeof this.data !== 'object') {
      this.data = (typeof INITIAL_DATA !== 'undefined') ? JSON.parse(JSON.stringify(INITIAL_DATA)) : {};
    }

    // Garantir sincronia com bases mestres completas (15.139 Clientes e 4.010 Produtos da planilha Dados SAC.xlsx)
    if (typeof INITIAL_DATA !== 'undefined') {
      if (!Array.isArray(this.data.clientes) || (INITIAL_DATA.clientes && this.data.clientes.length < INITIAL_DATA.clientes.length)) {
        this.data.clientes = JSON.parse(JSON.stringify(INITIAL_DATA.clientes));
      }
      if (!Array.isArray(this.data.produtos) || (INITIAL_DATA.produtos && this.data.produtos.length < INITIAL_DATA.produtos.length)) {
        this.data.produtos = JSON.parse(JSON.stringify(INITIAL_DATA.produtos));
      }
    }

    const ensureArray = (key) => {
      if (!Array.isArray(this.data[key])) {
        this.data[key] = (typeof INITIAL_DATA !== 'undefined' && Array.isArray(INITIAL_DATA[key])) ? JSON.parse(JSON.stringify(INITIAL_DATA[key])) : [];
      }
    };

    ensureArray('departamentos');
    ensureArray('roles_disponiveis');
    ensureArray('usuarios');
    ensureArray('separadores_conferentes');
    ensureArray('colaboradores_cd');
    ensureArray('setores');
    ensureArray('motoristas');
    ensureArray('ajudantes');
    ensureArray('veiculos');
    ensureArray('rotas');
    ensureArray('cargas');
    ensureArray('produtos');
    ensureArray('clientes');
    ensureArray('clientes_full');
    ensureArray('motivos_devolucao');
    ensureArray('causas_raiz');
    ensureArray('ocorrencias_devolucao');
    ensureArray('itens_devolucao');
    ensureArray('ocorrencias_rota');
    ensureArray('relatorios_divergencia');
    ensureArray('auditoria_produtividade');
    ensureArray('controle_viagens');
    ensureArray('ocorrencias_viagens');
    ensureArray('motivos_ocorrencia');
    ensureArray('resumo_diario_cd');
    ensureArray('trocas_veiculos');
    ensureArray('audit_logs');
    ensureArray('retencoes_frota');
    ensureArray('reentregas');

    // Seed inicial para reentregas caso vazio
    if (this.data.reentregas.length === 0) {
      const hojeStr = new Date().toISOString().split('T')[0];
      this.data.reentregas = [
        {
          id: 1718000000001,
          data: hojeStr,
          carga_numero: "43125",
          rota_nome: "ROTA 03 - ZUL",
          motorista_nome: "ROBERTO CARLOS",
          placa: "BRA2E19",
          novo_motorista: null,
          entregas_saiu: 28,
          entregas_feitas: 24,
          entregas_reentrega: 4,
          motivo: "CLIENTE AUSENTE / ESTABELECIMENTO FECHADO NO HORÁRIO",
          status: "PENDENTE",
          criado_por: "SISTEMA",
          criado_em: new Date().toISOString(),
          is_deleted: false
        },
        {
          id: 1718000000002,
          data: hojeStr,
          carga_numero: "43118",
          rota_nome: "ROTA 07 - GUARULHOS",
          motorista_nome: "LUIZ EDUARDO",
          placa: "CZT3042",
          novo_motorista: "MARCOS SILVA",
          entregas_saiu: 32,
          entregas_feitas: 30,
          entregas_reentrega: 2,
          motivo: "ATRASO DEVIDO A TRÂNSITO INTENSO NA VIA DUTRA",
          status: "REALIZADA",
          criado_por: "SISTEMA",
          criado_em: new Date().toISOString(),
          is_deleted: false
        }
      ];
    }

    // Migração/Sincronia automática do cadastro estruturado de Colaboradores do CD
    if (typeof INITIAL_DATA !== 'undefined' && Array.isArray(INITIAL_DATA.colaboradores_cd)) {
      if (!Array.isArray(this.data.colaboradores_cd) || this.data.colaboradores_cd.length === 0) {
        this.data.colaboradores_cd = JSON.parse(JSON.stringify(INITIAL_DATA.colaboradores_cd));
      } else {
        INITIAL_DATA.colaboradores_cd.forEach(initItem => {
          if (!this.data.colaboradores_cd.some(c => String(c.id) === String(initItem.id) || (c.nome && initItem.nome && c.nome.toUpperCase().trim() === initItem.nome.toUpperCase().trim()))) {
            this.data.colaboradores_cd.push(JSON.parse(JSON.stringify(initItem)));
          }
        });
      }
    }
    ensureArray('registro_versoes');

    // Preenche motivos padrão se estiver vazio
    if (this.data.motivos_devolucao.length === 0) {
      this.data.motivos_devolucao = [
        'Avaria de Transporte',
        'Produto Vencido',
        'Falta de Mercadoria',
        'Erro de Pedido / Emissão',
        'Cliente Recusou / Fechado',
        'Divergência de Preço / Descrição',
        'Avaria Interna CD',
        'Troca Comercial',
        'Outros'
      ];
    }

    try {
      this.migratePasswords();
      this.sortAll();
    } catch(eSort) {
      console.warn("Erro ao ordenar/migrar dados:", eSort);
    }

    try {
      const rawUser = localStorage.getItem('jr_sac_user');
      this.currentUser = rawUser ? JSON.parse(rawUser) : null;
    } catch(e) {
      this.currentUser = null;
    }
  }

  // Migra senhas legadas em texto simples para hash SHA-256
  migratePasswords() {
    try {
      if (this.data && Array.isArray(this.data.usuarios)) {
        let updated = false;
        this.data.usuarios.forEach(u => {
          if (u.senha_hash && !/^[a-f0-9]{64}$/i.test(u.senha_hash)) {
            u.senha_hash = sha256Sync(u.senha_hash);
            updated = true;
          }
        });
        if (updated) {
          try {
            localStorage.setItem('jr_sac_db', JSON.stringify(this.data));
          } catch(eSave) {
            console.warn("Nao foi possivel salvar db apos migracao de senhas:", eSave);
          }
        }
      }
    } catch(e) {
      console.warn("Erro ao migrar senhas:", e);
    }
  }

  save() {
    try {
      this.sortAll();
      localStorage.setItem('jr_sac_db', JSON.stringify(this.data));
    } catch(e) {
      console.warn("Nao foi possivel salvar no localStorage:", e);
    }
  }

  // Gerador de sequência segura (P2 - Prevenção de colisões)
  getNextSequenceNumber(collectionName, fieldName, prefix, padWidth = 3) {
    const list = (this.data && this.data[collectionName]) ? this.data[collectionName] : [];
    let maxNum = 0;
    const escapedPrefix = prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`${escapedPrefix}(\\d+)`);
    list.forEach(item => {
      const val = String(item[fieldName] || '');
      const match = val.match(regex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    return `${prefix}${String(maxNum + 1).padStart(padWidth, '0')}`;
  }

  sortAll() {
    if (!this.data) return;
    if (Array.isArray(this.data.departamentos)) {
      this.data.departamentos.sort((a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR'));
    }
    if (Array.isArray(this.data.separadores_conferentes)) {
      this.data.separadores_conferentes.sort((a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR'));
    }
    if (Array.isArray(this.data.motoristas)) {
      this.data.motoristas.sort((a, b) => String(a?.nome || '').localeCompare(String(b?.nome || ''), 'pt-BR'));
    }
    if (Array.isArray(this.data.ajudantes)) {
      this.data.ajudantes.sort((a, b) => String(a?.nome || '').localeCompare(String(b?.nome || ''), 'pt-BR'));
    }
    if (Array.isArray(this.data.veiculos)) {
      this.data.veiculos.sort((a, b) => String(a?.placa || '').localeCompare(String(b?.placa || ''), 'pt-BR'));
    }
    if (Array.isArray(this.data.rotas)) {
      this.data.rotas.sort((a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR'));
    }
    if (Array.isArray(this.data.produtos)) {
      this.data.produtos.sort((a, b) => String(a?.descricao || '').localeCompare(String(b?.descricao || ''), 'pt-BR'));
    }
    if (Array.isArray(this.data.motivos_devolucao)) {
      this.data.motivos_devolucao.sort((a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR'));
    }
    if (Array.isArray(this.data.causas_raiz)) {
      this.data.causas_raiz.sort((a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR'));
    }
    if (Array.isArray(this.data.clientes_full)) {
      this.data.clientes_full.sort((a, b) => String(a?.[1] || '').localeCompare(String(b?.[1] || ''), 'pt-BR'));
    }
  }

  resetData() {
    try {
      localStorage.setItem('jr_sac_db', JSON.stringify(INITIAL_DATA));
      const rawDb = localStorage.getItem('jr_sac_db');
      this.data = rawDb ? JSON.parse(rawDb) : JSON.parse(JSON.stringify(INITIAL_DATA));
    } catch(e) {
      console.warn("Erro ao resetar no localStorage, usando INITIAL_DATA:", e);
      this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
    }
    this.migratePasswords();
    return true;
  }

  // Auth Methods (P3 - Criptografia de senhas)
  login(loginInput, senha) {
    if (!loginInput) return { success: false, message: 'Informe o login ou e-mail' };
    const hashed = sha256Sync(senha);
    const term = loginInput.toLowerCase().trim();
    const user = (this.data && Array.isArray(this.data.usuarios))
      ? this.data.usuarios.find(u => (u.email && u.email.toLowerCase() === term) || (u.nome && u.nome.toLowerCase() === term) || (u.nome && u.nome.toLowerCase().startsWith(term)))
      : null;
    if (user) {
      if (user.senha_hash !== hashed && user.senha_hash !== senha) {
        return { success: false, message: 'Senha incorreta' };
      }
      if (user.senha_hash !== hashed) {
        user.senha_hash = hashed;
        this.save();
      }
      this.currentUser = user;
      try {
        localStorage.setItem('jr_sac_user', JSON.stringify(user));
      } catch(e) {
        console.warn("Nao foi possivel salvar jr_sac_user no localStorage:", e);
      }
      return { success: true, user };
    }
    return { success: false, message: 'Usuário (login/e-mail) ou senha incorretos' };
  }

  logout() {
    this.currentUser = null;
    try {
      localStorage.removeItem('jr_sac_user');
    } catch(e) {
      console.warn("Nao foi possivel remover jr_sac_user do localStorage:", e);
    }
  }

  switchRole(role) {
    if (this.currentUser) {
      this.currentUser.role = role;
      try {
        localStorage.setItem('jr_sac_user', JSON.stringify(this.currentUser));
      } catch(e) {
        console.warn("Nao foi possivel salvar role no localStorage:", e);
      }
      const u = (this.data && Array.isArray(this.data.usuarios)) ? this.data.usuarios.find(x => x.id === this.currentUser.id) : null;
      if (u) u.role = role;
      this.save();
    }
  }

  // Cadastro de novo usuário (P3 - Armazena hash da senha)
  addUsuario({ nome, email, senha, role, departamento, cargo }) {
    if (!this.data.usuarios) this.data.usuarios = [];
    if (this.data.usuarios.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return { success: false, message: 'E-mail já cadastrado no sistema!' };
    }
    const newUser = {
      id: Date.now(),
      nome: nome.toUpperCase().trim(),
      email: email.toLowerCase().trim(),
      senha_hash: sha256Sync(senha),
      role: role || 'SAC',
      departamento: departamento || 'SAC',
      cargo: cargo || '',
      ativo: true,
      criado_em: new Date().toISOString()
    };
    this.data.usuarios.push(newUser);
    this.save();
    return { success: true, user: newUser };
  }

  // Ação do Gestor sobre ocorrência
  updateAcaoGestor(id, dados) {
    const dev = this.data.ocorrencias_devolucao.find(d => d.id == id);
    if (!dev) return;
    dev.acao_gestor = dados.acao_gestor;
    dev.desconto_produtividade_gestor = dados.desconto_produtividade_gestor;
    dev.separador_apurado = dados.separador_apurado;
    dev.conferente_apurado = dados.conferente_apurado;
    dev.status_gestao = dados.status_gestao;
    dev.data_acao_gestor = new Date().toISOString();
    dev.gestor_id = this.currentUser ? this.currentUser.id : null;

    if (dados.desconto_produtividade_gestor) {
      if (!this.data.auditoria_produtividade) this.data.auditoria_produtividade = [];
      this.data.auditoria_produtividade.push({
        id: Date.now(),
        ocorrencia_devolucao_id: id,
        protocolo: dev.numero_protocolo,
        separador: dados.separador_apurado,
        conferente: dados.conferente_apurado,
        tipo_erro: dev.tipo_erro,
        motivo_causa_raiz: dev.motivo_real_causa_raiz,
        acao_gestor: dados.acao_gestor,
        valor_prejuizo: dev.valor_reclamado,
        gestor_id: this.currentUser ? this.currentUser.id : null,
        registrado_em: new Date().toISOString()
      });
    }
    this.save();
  }

  // SAC Devoluções Methods
  getDevolucoes() {
    return (this.data.ocorrencias_devolucao || []).filter(d => !d.is_deleted).map(d => {
      const carga = this.data.cargas.find(c => c.id == d.carga_id) || {};
      const veiculoDirect = this.data.veiculos.find(v => v.id == d.veiculo_id);
      const veiculoCarga = this.data.veiculos.find(v => v.id == carga.veiculo_id);
      const veiculo = veiculoDirect || veiculoCarga || {};

      const motorista = this.data.motoristas.find(m => m.id == (carga.motorista_id || d.motorista_id)) || {};
      const ajudante = this.data.ajudantes.find(a => a.id == carga.ajudante_id) || {};
      const cliente = this.data.clientes.find(cli => cli.id == d.cliente_id) || {};
      
      const itens = (this.data.itens_devolucao || []).filter(i => i.ocorrencia_devolucao_id == d.id).map(i => {
        const prod = this.data.produtos.find(p => p.id == i.produto_id) || {};
        const valorTotal = (parseFloat(i.quantidade) || 0) * (parseFloat(i.valor_unitario) || 0);
        return { ...i, produto_codigo: prod.codigo_produto, produto_descricao: prod.descricao || 'Produto não encontrado', valor_total: valorTotal };
      });
      const separador = this.data.usuarios.find(u => u.id == d.separador_id) || {};
      const conferente = this.data.usuarios.find(u => u.id == d.conferente_id) || {};
      const setor = this.data.setores.find(s => s.id == d.setor_encaminhado_id) || {};

      return {
        ...d,
        carga_numero: carga.numero_carga || d.carga_numero || 'N/A',
        carga_rota: carga.rota_nome || d.rota_nome || 'N/A',
        motorista_nome: motorista.nome || 'N/A',
        ajudante_nome: ajudante.nome || 'N/A',
        veiculo_placa: veiculo.placa || d.veiculo_placa || 'N/A',
        veiculo_modelo: veiculo.tipo || veiculo.modelo || '',
        cliente_codigo: cliente.codigo_cliente || 'N/A',
        cliente_nome: cliente.razao_social || d.cliente_nome || 'N/A',
        itens,
        separador_nome: separador.nome || 'Pendente',
        conferente_nome: conferente.nome || 'Pendente',
        setor_encaminhado_nome: setor.nome || 'Pendente'
      };
    });
  }

  addDevolucao(devolucaoData, itens) {
    const id = Date.now();
    const numero_protocolo = this.getNextSequenceNumber('ocorrencias_devolucao', 'numero_protocolo', 'DEV-2026-', 3);
    const numero_devolucao = this.getNextSequenceNumber('ocorrencias_devolucao', 'numero_devolucao', 'DEV-', 3);
    
    // Busca ou cria carga
    let cargaObj = this.data.cargas.find(c => c.numero_carga === String(devolucaoData.carga_numero));
    
    if (!cargaObj && devolucaoData.carga_numero) {
      const newCargaId = Date.now() + 1;
      cargaObj = {
        id: newCargaId,
        numero_carga: String(devolucaoData.carga_numero),
        rota_nome: devolucaoData.rota_nome || 'Rota Não Cadastrada',
        motorista_id: parseInt(devolucaoData.motorista_id) || null,
        ajudante_id: parseInt(devolucaoData.ajudante_id) || null,
        veiculo_id: parseInt(devolucaoData.veiculo_id) || null,
        data_saida: new Date().toISOString().split('T')[0]
      };
      this.data.cargas.push(cargaObj);
    } else if (cargaObj) {
      // Atualiza dados da carga se vieram no form
      if (devolucaoData.rota_nome) cargaObj.rota_nome = devolucaoData.rota_nome;
      if (devolucaoData.motorista_id) cargaObj.motorista_id = parseInt(devolucaoData.motorista_id);
      if (devolucaoData.ajudante_id) cargaObj.ajudante_id = parseInt(devolucaoData.ajudante_id);
      if (devolucaoData.veiculo_id) cargaObj.veiculo_id = parseInt(devolucaoData.veiculo_id);
    }

    const newDev = {
      id,
      numero_protocolo,
      numero_devolucao,
      carga_id: cargaObj ? cargaObj.id : null,
      carga_numero: devolucaoData.carga_numero,
      veiculo_id: parseInt(devolucaoData.veiculo_id) || (cargaObj ? cargaObj.veiculo_id : null),
      veiculo_placa: devolucaoData.veiculo_placa || '',
      rota_nome: devolucaoData.rota_nome || '',
      motorista_id: parseInt(devolucaoData.motorista_id) || null,
      cliente_id: parseInt(devolucaoData.cliente_id) || null,
      cliente_nome: devolucaoData.cliente_nome || '',
      nota_fiscal: devolucaoData.nota_fiscal,
      motivo_reclamado: devolucaoData.motivo_reclamado,
      valor_reclamado: parseFloat(devolucaoData.valor_reclamado) || 0,
      detalhamento_texto: devolucaoData.detalhamento_texto,
      // ADENDO (Mídia): antes só o 1º item de cada array era salvo
      // (foto_url/video_url apontavam para [0] e o vídeo era descartado
      // — video_url ficava sempre '' aqui). Agora persistimos os arrays
      // completos de fotos e vídeos anexados na Abertura, e mantemos
      // foto_url/video_url como aliases (1º item) por compatibilidade
      // com telas antigas que ainda leem esses campos únicos.
      fotos_abertura: Array.isArray(devolucaoData.fotos_abertura) ? devolucaoData.fotos_abertura : (devolucaoData.foto_url ? [devolucaoData.foto_url] : []),
      videos_abertura: Array.isArray(devolucaoData.videos_abertura) ? devolucaoData.videos_abertura : (devolucaoData.video_url ? [devolucaoData.video_url] : []),
      foto_url: (Array.isArray(devolucaoData.fotos_abertura) && devolucaoData.fotos_abertura[0]) || devolucaoData.foto_url || '',
      fotos_investigacao: [],
      videos_investigacao: [],
      cliente_emite_nf: devolucaoData.cliente_emite_nf === 'sim' || devolucaoData.cliente_emite_nf === true,
      forma_acerto: devolucaoData.forma_acerto,
      motivo_real_causa_raiz: '',
      video_url: (Array.isArray(devolucaoData.videos_abertura) && devolucaoData.videos_abertura[0]) || devolucaoData.video_url || '',
      descricao_monitoramento: '',
      separador_id: null,
      conferente_id: null,
      setor_encaminhado_id: null,
      acao_tomada: '',
      destino_cd: '',
      status_fechamento: 'PENDENTE_FISICO',
      sem_itens: devolucaoData.sem_itens || false,
      observacao_sem_itens: devolucaoData.observacao_sem_itens || '',
      criado_por_usuario_id: this.currentUser ? this.currentUser.id : 1,
      criado_em: new Date().toISOString()
    };

    this.data.ocorrencias_devolucao.unshift(newDev);

    // Salvar itens da devolução
    if (itens && itens.length > 0) {
      itens.forEach(item => {
        if (!this.data.itens_devolucao) this.data.itens_devolucao = [];
        this.data.itens_devolucao.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          ocorrencia_devolucao_id: id,
          produto_id: parseInt(item.produto_id),
          quantidade: parseInt(item.quantidade),
          valor_unitario: parseFloat(item.valor_unitario),
          motivo_item: item.motivo_item || ''
        });
      });
    }

    this.save();
    return newDev;
  }

  updateInvestigacao(id, updateData) {
    const dev = this.data.ocorrencias_devolucao.find(d => d.id == id);
    if (dev) {
      dev.motivo_real_causa_raiz = updateData.motivo_real_causa_raiz;
      dev.tipo_erro = updateData.tipo_erro;
      dev.tipo_erro_outro = updateData.tipo_erro_outro;
      dev.video_url = updateData.video_url || dev.video_url || '';
      dev.video_investigacao_url = updateData.video_investigacao_url || dev.video_investigacao_url || '';
      // ADENDO (Mídia): fotos/vídeos anexados durante a Investigação são
      // ACUMULADOS (não sobrescritos) — cada nova submissão pode adicionar
      // mais evidências ao histórico da ocorrência, sem apagar as
      // anteriores. Também guarda a foto/vídeo únicos legados dentro do
      // array, para as galerias novas conseguirem enxergá-los.
      if (!Array.isArray(dev.fotos_investigacao)) dev.fotos_investigacao = [];
      if (!Array.isArray(dev.videos_investigacao)) dev.videos_investigacao = [];
      if (Array.isArray(updateData.fotos_investigacao_novas)) {
        dev.fotos_investigacao.push(...updateData.fotos_investigacao_novas);
      }
      if (Array.isArray(updateData.videos_investigacao_novas)) {
        dev.videos_investigacao.push(...updateData.videos_investigacao_novas);
      } else if (updateData.video_investigacao_url && !dev.videos_investigacao.includes(updateData.video_investigacao_url)) {
        dev.videos_investigacao.push(updateData.video_investigacao_url);
      }
      dev.descricao_monitoramento = updateData.descricao_monitoramento || '';
      // Persiste o NOME do separador/conferente (vindo dos selects com nomes reais)
      dev.separador_apurado  = updateData.separador_apurado  || '';
      dev.conferente_apurado = updateData.conferente_apurado || '';
      // Mantém compatibilidade com campo legado (id numérico), caso venha
      dev.separador_id = updateData.separador_id ? parseInt(updateData.separador_id) : dev.separador_id || null;
      dev.conferente_id = updateData.conferente_id ? parseInt(updateData.conferente_id) : dev.conferente_id || null;
      dev.setor_encaminhado_id = updateData.setor_encaminhado_id ? parseInt(updateData.setor_encaminhado_id) : null;
      dev.acao_tomada = updateData.acao_tomada;
      if (updateData.responsavel_analise) dev.responsavel_analise = updateData.responsavel_analise;
      // PRIORIDADE 1: toda edição feita em Análise e Monitoramento reabre a
      // tratativa para o Gestor, mesmo que o chamado já estivesse
      // PENDENTE_GESTOR ou CONCLUIDO. Antes, essa reabertura só acontecia
      // quando o status ainda era PENDENTE/vazio, o que fazia a Gestão de
      // Tratativas "não perceber" edições feitas depois da 1ª apuração.
      dev.status_gestao = 'PENDENTE_GESTOR';
      dev.atualizado_em = new Date().toISOString();
      dev.atualizado_por = this.currentUser ? this.currentUser.nome : 'SISTEMA';

      this.logAudit({
        acao: 'EDICAO_INVESTIGACAO',
        modulo: 'ocorrencias_devolucao',
        registro_id: id,
        diff: { depois: { motivo_real_causa_raiz: dev.motivo_real_causa_raiz, responsavel_analise: dev.responsavel_analise, status_gestao: dev.status_gestao } }
      });

      if (updateData.registra_desconto && updateData.separador_id) {
        if (!this.data.auditoria_produtividade) this.data.auditoria_produtividade = [];
        this.data.auditoria_produtividade.push({
          id: Date.now(),
          usuario_id: parseInt(updateData.separador_id),
          setor_id: 2,
          ocorrencia_devolucao_id: id,
          tipo_falha: updateData.tipo_erro || updateData.motivo_real_causa_raiz,
          valor_prejuizo: dev.valor_reclamado,
          pontos_desconto: 10,
          observacoes: updateData.acao_tomada,
          registrado_em: new Date().toISOString()
        });
      }

      this.save();
    }
  }

  updateDestinoCd(id, destino_cd, status_fechamento, itensDestinos = []) {
    const dev = this.data.ocorrencias_devolucao.find(d => d.id == id);
    if (dev) {
      dev.destino_cd = destino_cd;
      dev.status_fechamento = status_fechamento;
      dev.data_entrada_cd = new Date().toISOString();

      if (Array.isArray(itensDestinos) && itensDestinos.length > 0) {
        itensDestinos.forEach(idst => {
          const item = (this.data.itens_devolucao || []).find(i => i.id == idst.item_id);
          if (item) {
            item.destino_item = idst.destino || destino_cd;
            item.data_validade = idst.data_validade || '';
            item.observacao = idst.observacao || '';
            if (idst.destino === 'PRODUTOS_NEGOCIACAO') {
              item.status_negociacao = item.status_negociacao || 'EM_NEGOCIACAO';
            }
          }
        });
      }
      this.save();
    }
  }

  updateItemNegociacao(itemId, statusNegociacao) {
    const item = (this.data.itens_devolucao || []).find(i => i.id == itemId);
    if (item) {
      item.status_negociacao = statusNegociacao;
      item.data_negociacao = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }

  // Ocorrências de Rota
  getOcorrenciasRota() {
    return (this.data.ocorrencias_rota || []).filter(r => !r.is_deleted).map(r => {
      const carga = this.data.cargas.find(c => c.id == r.carga_id) || {};
      const veiculo = this.data.veiculos.find(v => v.id == r.veiculo_id) || {};
      const motorista = this.data.motoristas.find(m => m.id == r.motorista_id) || {};
      const mecanico = this.data.usuarios.find(u => u.id == r.mecanico_responsavel_id) || {};

      return {
        ...r,
        carga_numero: carga.numero_carga || r.carga_numero || 'N/A',
        carga_rota: carga.rota_nome || r.rota_nome || 'N/A',
        veiculo_placa: veiculo.placa || r.veiculo_placa || 'N/A',
        veiculo_modelo: veiculo.tipo || veiculo.modelo || 'N/A',
        motorista_nome: motorista.nome || r.motorista_nome || 'N/A',
        mecanico_nome: mecanico.nome || 'Em atendimento'
      };
    });
  }

  addOcorrenciaRota(rotaData) {
    const id = Date.now();
    const numero_protocolo = this.getNextSequenceNumber('ocorrencias_rota', 'numero_protocolo', 'ROT-2026-', 3);
    const statusVeic = rotaData.status_veiculo || 'Aguardando Manutenção';
    const isEmRota = statusVeic === 'Em Rota';

    const newRota = {
      id,
      numero_protocolo,
      carga_id: parseInt(rotaData.carga_id) || null,
      carga_numero: rotaData.carga_numero || '',
      veiculo_id: parseInt(rotaData.veiculo_id) || null,
      veiculo_placa: rotaData.veiculo_placa || '',
      motorista_id: parseInt(rotaData.motorista_id) || null,
      rota_nome: rotaData.rota_nome || '',
      tipo_ocorrencia: rotaData.tipo_ocorrencia,
      descricao: rotaData.descricao,
      midia_fotos: rotaData.midia_fotos || [],
      midia_videos: rotaData.midia_videos || [],
      transcricao_audio_wa: rotaData.transcricao_audio_wa || '',
      status_veiculo: statusVeic,
      status: isEmRota ? 'RESOLVIDO' : 'ABERTO',
      veiculo_parado: !isEmRota,
      mecanico_responsavel_id: null,
      acao_mecanico: '',
      pecas_trocadas: '',
      guincho_acionado: false,
      custo_socorro: 0,
      criado_em: new Date().toISOString(),
      resolvido_em: isEmRota ? new Date().toISOString() : null
    };

    this.data.ocorrencias_rota.unshift(newRota);
    this.save();
    return newRota;
  }

  updateOcorrenciaRota(id, updateData) {
    const r = this.data.ocorrencias_rota.find(x => x.id == id);
    if (r) {
      if (updateData.status_veiculo) {
        r.status_veiculo = updateData.status_veiculo;
      }
      const isEmRota = r.status_veiculo === 'Em Rota' || updateData.status === 'RESOLVIDO';

      if (isEmRota) {
        r.status = 'RESOLVIDO';
        r.status_veiculo = 'Em Rota';
        r.veiculo_parado = false;
        if (!r.resolvido_em) r.resolvido_em = new Date().toISOString();
      } else {
        r.status = updateData.status || r.status || 'EM_ATENDIMENTO';
        r.veiculo_parado = true;
      }

      r.mecanico_responsavel_id = this.currentUser ? this.currentUser.id : 4;
      if (updateData.acao_mecanico !== undefined) r.acao_mecanico = updateData.acao_mecanico;
      if (updateData.pecas_trocadas !== undefined) r.pecas_trocadas = updateData.pecas_trocadas;
      if (updateData.guincho_acionado !== undefined) r.guincho_acionado = updateData.guincho_acionado === 'sim' || updateData.guincho_acionado === true;
      if (updateData.custo_socorro !== undefined) r.custo_socorro = parseFloat(updateData.custo_socorro) || 0;

      this.save();
    }
  }

  // CRUD Cadastros Auxiliares (Dados SAC)
  addMotorista(cod_erp, nome, cnh, telefone) {
    const item = { id: cod_erp ? parseInt(cod_erp) : Date.now(), nome: nome.toUpperCase(), cnh, telefone };
    if (this.data.motoristas.find(x => x.id == item.id)) {
      alert('Código ERP já cadastrado!');
      return null;
    }
    this.data.motoristas.push(item);
    this.save();
    return item;
  }

  addAjudante(cod_erp, nome) {
    const item = { id: cod_erp ? parseInt(cod_erp) : Date.now(), nome: nome.toUpperCase() };
    this.data.ajudantes.push(item);
    this.save();
    return item;
  }

  addVeiculo(placa, tipo, situacao) {
    const item = { id: Date.now(), placa: placa.toUpperCase(), modelo: tipo, tipo: tipo.toUpperCase(), situacao: situacao || 'Ativo' };
    this.data.veiculos.push(item);
    this.save();
    return item;
  }

  addProduto(codigo_produto, descricao, categoria, valor_unitario_padrao) {
    const item = {
      id: parseInt(codigo_produto) || Date.now(),
      codigo_produto: String(codigo_produto).toUpperCase(),
      descricao: descricao.toUpperCase(),
      categoria: categoria || 'Geral',
      valor_unitario_padrao: parseFloat(valor_unitario_padrao) || 0
    };
    this.data.produtos.push(item);
    this.save();
    return item;
  }

  addRota(nome) {
    if (!this.data.rotas) this.data.rotas = [];
    const nomeFmt = nome.toUpperCase().trim();
    if (this.data.rotas.includes(nomeFmt)) {
      alert('Rota já cadastrada!');
      return null;
    }
    this.data.rotas.push(nomeFmt);
    this.save();
    return nomeFmt;
  }

  addCargaRota(numero_carga, rota_nome, motorista_id, ajudante_id, veiculo_id) {
    const item = {
      id: Date.now(),
      numero_carga: String(numero_carga),
      rota_nome: rota_nome.toUpperCase(),
      motorista_id: parseInt(motorista_id),
      ajudante_id: parseInt(ajudante_id),
      veiculo_id: parseInt(veiculo_id),
      data_saida: new Date().toISOString().split('T')[0]
    };
    this.data.cargas.push(item);
    this.save();
    return item;
  }

  deleteCadItem(collection, id) {
    if (this.data[collection]) {
      this.data[collection] = this.data[collection].filter(x => x.id != id);
      this.save();
    }
  }

  deleteRota(nome) {
    if (this.data.rotas) {
      this.data.rotas = this.data.rotas.filter(r => r !== nome);
      this.save();
    }
  }

  // ===== CRUD CONTROLE DE VIAGENS (LARGADAS) =====
  getControleViagens() {
    return (this.data.controle_viagens || []).filter(x => !x.is_deleted);
  }

  addViagem(viagemData) {
    if (!this.data.controle_viagens) this.data.controle_viagens = [];
    const item = {
      id: Date.now(),
      carga: viagemData.carga || '',
      rota: viagemData.rota || '',
      placa: viagemData.placa || '',
      motorista: viagemData.motorista || '',
      ajudante: viagemData.ajudante || '',
      setor: viagemData.setor || 'FRIO',
      data_saida: viagemData.data_saida || '',
      hora_saida: viagemData.hora_saida || '',
      data_entrega: viagemData.data_entrega || '',
      hora_entrega: viagemData.hora_entrega || '',
      data_retorno: viagemData.data_retorno || '',
      hora_retorno: viagemData.hora_retorno || '',
      status_viagem: viagemData.status_viagem || 'EM ANDAMENTO',
      fusion: viagemData.fusion || 'NÃO INICIADO',
      checklist_saida: viagemData.checklist_saida || 'NÃO INICIADO',
      checklist_chegada: viagemData.checklist_chegada || 'NÃO INICIADO',
      observacao: viagemData.observacao || ''
    };
    this.data.controle_viagens.unshift(item);
    this.save();
    return item;
  }

  updateViagem(id, updateData) {
    if (!this.data.controle_viagens) this.data.controle_viagens = [];
    const v = this.data.controle_viagens.find(x => x.id == id);
    if (v) {
      Object.assign(v, updateData);
      this.save();
    }
  }

  deleteViagem(id) {
    if (this.data.controle_viagens) {
      this.data.controle_viagens = this.data.controle_viagens.filter(x => x.id != id);
      this.save();
    }
  }

  // ===== CRUD OCORRÊNCIAS OPERACIONAIS DE VIAGEM =====
  getOcorrenciasViagens() {
    return (this.data.ocorrencias_viagens || []).filter(x => !x.is_deleted);
  }

  addOcorrenciaViagem(ocData) {
    if (!this.data.ocorrencias_viagens) this.data.ocorrencias_viagens = [];
    const item = {
      id: Date.now(),
      data: ocData.data || new Date().toISOString().split('T')[0],
      carga: ocData.carga || '',
      rota: ocData.rota || '',
      placa: ocData.placa || '',
      funcionario: ocData.funcionario || '',
      funcao: ocData.funcao || 'MOTORISTA',
      motivo: ocData.motivo || 'OUTRO',
      causa: ocData.causa || '',
      ocorrencia: ocData.ocorrencia || '',
      acao: ocData.acao || ''
    };
    this.data.ocorrencias_viagens.unshift(item);
    this.save();
    return item;
  }

  updateOcorrenciaViagem(id, updateData) {
    if (!this.data.ocorrencias_viagens) this.data.ocorrencias_viagens = [];
    const item = this.data.ocorrencias_viagens.find(x => x.id == id);
    if (item) {
      Object.assign(item, updateData);
      this.save();
    }
  }

  deleteOcorrenciaViagem(id) {
    if (this.data.ocorrencias_viagens) {
      this.data.ocorrencias_viagens = this.data.ocorrencias_viagens.filter(x => x.id != id);
      this.save();
    }
  }

  importViagens(novasViagens) {
    if (!this.data.controle_viagens) this.data.controle_viagens = [];
    let importCount = 0;
    novasViagens.forEach(v => {
      if (v.carga) {
        this.addViagem(v);
        importCount++;
      }
    });
    this.save();
    return importCount;
  }

  // ===== RESUMO DIÁRIO CD =====
  getResumoDiarioCD(data, turno) {
    if (!this.data.resumo_diario_cd) this.data.resumo_diario_cd = [];
    let item = this.data.resumo_diario_cd.find(x => x.data === data && x.turno === turno);
    if (item) {
      if (!Array.isArray(item.ocorrencias_colaboradores)) item.ocorrencias_colaboradores = [];
      if (!Array.isArray(item.ocorrencias)) item.ocorrencias = [];
      if (!Array.isArray(item.faltas_condutas)) item.faltas_condutas = [];
      if (!Array.isArray(item.cortes)) item.cortes = [];
      if (!item.movimentacao) item.movimentacao = {};
      if (!item.movimentacao.recebimento) item.movimentacao.recebimento = { peso: 0, aux_junior: 0, movimentador: 0, conferente: 0, empilhador: 0, cargas_previstas: 0, cargas_realizadas: 0, cargas_veiculos: 0 };
      if (!item.movimentacao.expedicao) item.movimentacao.expedicao = { peso: 0, aux_junior: 0, movimentador: 0, conferente: 0, empilhador: 0, cargas_previstas: 0, cargas_realizadas: 0, cargas_veiculos: 0 };
      return item;
    }

    let gestorPadrao = 'GUSTAVO CAMARA';
    if (turno === 'SECO') gestorPadrao = 'MARCOS ADRIANO';
    else if (turno === '1º TURNO - FRIO') gestorPadrao = 'MELQUIADES NETO';

    return {
      id: Date.now(),
      data: data || new Date().toISOString().split('T')[0],
      turno: turno || '2º TURNO - FRIO',
      gestor: gestorPadrao,
      movimentacao: {
        recebimento: { peso: 0, aux_junior: 0, movimentador: 0, conferente: 0, empilhador: 0, cargas_previstas: 0, cargas_realizadas: 0, cargas_veiculos: 0 },
        expedicao: { peso: 0, aux_junior: 0, movimentador: 0, conferente: 0, empilhador: 0, cargas_previstas: 0, cargas_realizadas: 0, cargas_veiculos: 0 }
      },
      faltas_condutas: [],
      ocorrencias: [],
      ocorrencias_colaboradores: [],
      cortes: []
    };
  }

  saveResumoDiarioCD(resumoData) {
    if (!this.data.resumo_diario_cd) this.data.resumo_diario_cd = [];
    const idx = this.data.resumo_diario_cd.findIndex(x => x.data === resumoData.data && x.turno === resumoData.turno);
    resumoData.atualizado_em = new Date().toISOString();
    if (idx >= 0) {
      this.data.resumo_diario_cd[idx] = resumoData;
    } else {
      this.data.resumo_diario_cd.push(resumoData);
    }
    this.save();
    return resumoData;
  }

  // ===== CRUD TROCAS DE VEÍCULOS =====
  getTrocasVeiculos() {
    return (this.data.trocas_veiculos || []).filter(x => !x.is_deleted);
  }

  addTrocaVeiculo(trocaData) {
    if (!this.data.trocas_veiculos) this.data.trocas_veiculos = [];
    const item = {
      id: Date.now(),
      data: trocaData.data || new Date().toISOString().split('T')[0],
      veiculo_escalado: trocaData.veiculo_escalado || '',
      veiculo_trocado: trocaData.veiculo_trocado || '',
      motivo_resumido: trocaData.motivo_resumido || 'PESO EXCEDIDO',
      motivo_outro: trocaData.motivo_outro || '',
      detalhamento: trocaData.detalhamento || '',
      autorizado_por: trocaData.autorizado_por || 'LUIZ EDUARDO',
      criado_em: new Date().toISOString()
    };
    this.data.trocas_veiculos.unshift(item);
    this.save();
    return item;
  }

  updateTrocaVeiculo(id, updateData) {
    if (!this.data.trocas_veiculos) this.data.trocas_veiculos = [];
    const item = this.data.trocas_veiculos.find(x => x.id == id);
    if (item) {
      Object.assign(item, updateData);
      this.save();
    }
  }

  deleteTrocaVeiculo(id) {
    if (this.data.trocas_veiculos) {
      this.data.trocas_veiculos = this.data.trocas_veiculos.filter(x => x.id != id);
      this.save();
    }
  }

  // ===== MÉTODOS GETTERS DE CADASTROS PARA EXPORTAÇÃO CSV E CONSULTA =====
  getColaboradoresCD(filtroFuncao = '') {
    const list = (this.data.colaboradores_cd || []).filter(c => !c.is_deleted);
    if (!filtroFuncao) return list;
    const term = filtroFuncao.toUpperCase();
    return list.filter(c => String(c.funcao || '').toUpperCase().includes(term));
  }

  getSeparadores() {
    const colabs = this.getColaboradoresCD();
    const filtered = colabs.filter(c => c.ativo && (c.funcao.includes('SEPARADOR') || c.funcao.includes('PICKING') || c.funcao.includes('MOVIMENTADOR') || c.funcao.includes('AUXILIAR')));
    return filtered.length > 0 ? filtered.map(c => c.nome) : (this.data.separadores_conferentes || []);
  }

  getConferentes() {
    const colabs = this.getColaboradoresCD();
    const filtered = colabs.filter(c => c.ativo && c.funcao.includes('CONFERENTE'));
    return filtered.length > 0 ? filtered.map(c => c.nome) : (this.data.separadores_conferentes || []);
  }

  getEmpilhadores() {
    const colabs = this.getColaboradoresCD();
    const filtered = colabs.filter(c => c.ativo && (c.funcao.includes('EMPILHADEIRA') || c.funcao.includes('OPERADOR')));
    return filtered.length > 0 ? filtered.map(c => c.nome) : (this.data.separadores_conferentes || []);
  }

  saveColaboradorCD(colabData) {
    if (!this.data.colaboradores_cd) this.data.colaboradores_cd = [];
    let item;
    if (colabData.id) {
      item = this.data.colaboradores_cd.find(c => c.id == colabData.id);
      if (item) {
        Object.assign(item, {
          chapa: colabData.chapa !== undefined ? colabData.chapa : item.chapa || '',
          nome: String(colabData.nome || item.nome).trim().toUpperCase(),
          secao: String(colabData.secao || item.secao || '').trim().toUpperCase(),
          funcao: String(colabData.funcao || item.funcao || 'SEPARADOR').trim().toUpperCase(),
          cpf: String(colabData.cpf !== undefined ? colabData.cpf : item.cpf || '').trim(),
          ativo: colabData.ativo !== undefined ? Boolean(colabData.ativo) : true
        });
      }
    }
    if (!item) {
      item = {
        id: Date.now(),
        chapa: colabData.chapa || '',
        nome: String(colabData.nome || '').trim().toUpperCase(),
        secao: String(colabData.secao || 'CARREGAMENTO FRIOS - 1 TURNO').trim().toUpperCase(),
        funcao: String(colabData.funcao || 'SEPARADOR').trim().toUpperCase(),
        cpf: String(colabData.cpf || '').trim(),
        ativo: colabData.ativo !== undefined ? Boolean(colabData.ativo) : true
      };
      if (!item.nome) return null;
      this.data.colaboradores_cd.unshift(item);
    }
    this.logAudit({ acao: 'SALVAR_COLABORADOR', modulo: 'colaboradores_cd', registro_id: item.id, diff: { depois: item } });
    this.save();
    return item;
  }

  deleteColaboradorCD(id) {
    return this.softDelete('colaboradores_cd', id);
  }

  getUsuarios() {
    return this.data.usuarios || [];
  }

  getMotoristas() {
    return this.data.motoristas || [];
  }

  getVeiculos() {
    return this.data.veiculos || [];
  }

  getClientes() {
    return (this.data.clientes || []).filter(x => !x.is_deleted);
  }

  addCliente(clienteData) {
    if (!this.data.clientes) this.data.clientes = [];
    const item = {
      id: Date.now(),
      codigo: clienteData.codigo || `CLI-${Date.now().toString().slice(-4)}`,
      nome: String(clienteData.nome || '').trim().toUpperCase(),
      cidade: clienteData.cidade || '',
      uf: clienteData.uf || 'GO',
      cnpj_cpf: clienteData.cnpj_cpf || '',
      criado_em: new Date().toISOString()
    };
    if (!item.nome) return null;
    this.data.clientes.unshift(item);
    this.logAudit({ acao: 'CRIACAO', modulo: 'clientes', registro_id: item.id, diff: { depois: item } });
    this.save();
    return item;
  }

  deleteCliente(id) {
    return this.softDelete('clientes', id);
  }

  // ===== GOVERNANÇA: SOFT DELETE, LIXEIRA, AUDITORIA & VERSIONAMENTO =====
  // PRIORIDADE 7c: fonte única da senha de admin (window.JR_CONFIG.adminPassword)
  getAdminPassword() {
    return (typeof window !== 'undefined' && window.JR_CONFIG && window.JR_CONFIG.adminPassword) || '4533215';
  }

  softDelete(collection, id) {
    if (!this.data[collection]) return false;
    const item = this.data[collection].find(x => x.id == id);
    if (!item) return false;
    item.is_deleted = true;
    item.deleted_at = new Date().toISOString();
    item.deleted_by = this.currentUser ? { id: this.currentUser.id, nome: this.currentUser.nome } : { id: 0, nome: 'SISTEMA' };
    
    this.logAudit({
      acao: 'EXCLUSAO_LOGICA',
      modulo: collection,
      registro_id: id,
      diff: { antes: item }
    });
    this.save();
    return true;
  }

  restoreItem(collection, id) {
    if (!this.data[collection]) return false;
    const item = this.data[collection].find(x => x.id == id);
    if (!item) return false;
    item.is_deleted = false;
    item.restored_at = new Date().toISOString();
    item.restored_by = this.currentUser ? this.currentUser.nome : 'SISTEMA';

    this.logAudit({
      acao: 'RESTAURACAO',
      modulo: collection,
      registro_id: id,
      diff: { depois: item }
    });
    this.save();
    return true;
  }

  hardDelete(collection, id, password) {
    if (String(password).trim() !== this.getAdminPassword()) {
      return { success: false, message: 'Senha de administrador incorreta.' };
    }
    if (!this.data[collection]) return { success: false, message: 'Coleção não encontrada' };
    const item = this.data[collection].find(x => x.id == id);
    if (!item) return { success: false, message: 'Registro não encontrado' };
    
    this.data[collection] = this.data[collection].filter(x => x.id != id);
    this.logAudit({
      acao: 'EXCLUSAO_DEFINITIVA',
      modulo: collection,
      registro_id: id,
      diff: { antes: item }
    });
    this.save();
    return { success: true };
  }

  getLixeiraItems() {
    const collections = [
      { name: 'ocorrencias_devolucao', label: 'Devolução SAC' },
      { name: 'controle_viagens', label: 'Controle de Viagens' },
      { name: 'ocorrencias_rota', label: 'Chamados em Rota' },
      { name: 'ocorrencias_viagens', label: 'Ocorrências Operacionais' },
      { name: 'retencoes_frota', label: 'Retenção de Frota' },
      { name: 'reentregas', label: 'Reentregas de Rota' },
      { name: 'produtos', label: 'Produtos' },
      { name: 'motoristas', label: 'Motoristas' },
      { name: 'ajudantes', label: 'Ajudantes' },
      { name: 'colaboradores_cd', label: 'Colaboradores CD' },
      { name: 'veiculos', label: 'Veículos' },
      { name: 'clientes', label: 'Clientes' }
    ];
    let items = [];
    collections.forEach(col => {
      if (Array.isArray(this.data[col.name])) {
        this.data[col.name].filter(x => x.is_deleted).forEach(item => {
          items.push({
            collection: col.name,
            collectionLabel: col.label,
            id: item.id,
            descricao: item.numero_protocolo || item.numero_retencao || item.carga_numero || item.carga || item.placa || item.nome || item.descricao || `ID #${item.id}`,
            deleted_at: item.deleted_at,
            deleted_by: item.deleted_by ? item.deleted_by.nome : (item.deleted_by_nome || 'N/A'),
            itemData: item
          });
        });
      }
    });
    return items.sort((a, b) => new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0));
  }

  logAudit({ acao, modulo, registro_id, diff }) {
    if (!this.data.audit_logs) this.data.audit_logs = [];
    const entry = {
      id: Date.now() + Math.random(),
      usuario_id: this.currentUser ? this.currentUser.id : 0,
      usuario_nome: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      data_hora: new Date().toISOString(),
      acao,
      modulo,
      registro_id,
      diff: diff || null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node/Browser'
    };
    this.data.audit_logs.unshift(entry);
    // Limita o histórico de auditoria a 1000 registros para otimização
    if (this.data.audit_logs.length > 1000) {
      this.data.audit_logs = this.data.audit_logs.slice(0, 1000);
    }
  }

  saveVersion(collection, record) {
    if (!this.data.registro_versoes) this.data.registro_versoes = [];
    const versions = this.data.registro_versoes.filter(v => v.collection === collection && v.registro_id == record.id);
    const versaoNum = versions.length + 1;
    this.data.registro_versoes.unshift({
      id: Date.now(),
      collection,
      registro_id: record.id,
      versao: versaoNum,
      dados_json: JSON.parse(JSON.stringify(record)),
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: new Date().toISOString()
    });
  }

  rollbackVersion(collection, recordId, versionId, password) {
    if (String(password).trim() !== this.getAdminPassword()) {
      return { success: false, message: 'Senha de administrador incorreta' };
    }
    const versionObj = (this.data.registro_versoes || []).find(v => v.id == versionId);
    if (!versionObj) return { success: false, message: 'Versão não encontrada' };
    
    const list = this.data[collection];
    if (!list) return { success: false, message: 'Coleção não encontrada' };
    
    const idx = list.findIndex(x => x.id == recordId);
    if (idx < 0) return { success: false, message: 'Registro atual não encontrado' };

    list[idx] = JSON.parse(JSON.stringify(versionObj.dados_json));
    this.logAudit({ acao: 'ROLLBACK_VERSAO', modulo: collection, registro_id: recordId, diff: { versao_restaurada: versionObj.versao } });
    this.save();
    return { success: true };
  }

  // ===== GESTÃO DE MOTIVOS DE DEVOLUÇÃO (GERENCIADOR DE CADASTROS) =====
  addMotivoDevolucao(nome) {
    if (!this.data.motivos_devolucao) this.data.motivos_devolucao = [];
    const fmt = String(nome).trim();
    if (!fmt) return null;
    if (!this.data.motivos_devolucao.includes(fmt)) {
      this.data.motivos_devolucao.push(fmt);
      this.save();
    }
    return fmt;
  }

  deleteMotivoDevolucao(nome) {
    if (this.data.motivos_devolucao) {
      this.data.motivos_devolucao = this.data.motivos_devolucao.filter(m => m !== nome);
      this.save();
    }
  }

  getClientes() {
    return (this.data.clientes || []).filter(x => !x.is_deleted).map(c => {
      const cleanCod = String(c.codigo || c.codigo_cliente || c.id || '').replace(/^CLI-/i, '').trim();
      const cleanNome = String(c.nome || c.razao_social || 'CLIENTE SEM NOME').trim().toUpperCase();
      return {
        id: String(c.id || cleanCod),
        codigo: cleanCod,
        codigo_cliente: cleanCod,
        nome: cleanNome,
        razao_social: cleanNome,
        cidade: c.cidade || 'Araguaína',
        uf: c.uf || 'TO'
      };
    });
  }

  getProdutos() {
    return (this.data.produtos || []).filter(x => !x.is_deleted).map(p => ({
      id: String(p.id || p.codigo_produto),
      codigo_produto: String(p.codigo_produto || p.id),
      descricao: String(p.descricao || '').toUpperCase(),
      categoria: p.categoria || 'Frios/Carnes',
      valor_unitario_padrao: p.valor_unitario_padrao || 0
    }));
  }

  // ===== RESET GLOBAL DE TREINAMENTO =====
  resetGlobalTreinamento(password) {
    if (String(password).trim() !== this.getAdminPassword()) {
      return { success: false, message: 'Senha de administrador incorreta.' };
    }
    // Mantém cadastros mestre, limpa dados operacionais e de treinamento
    this.data.ocorrencias_devolucao = [];
    this.data.itens_devolucao = [];
    this.data.cargas = [];
    this.data.controle_viagens = [];
    this.data.ocorrencias_viagens = [];
    this.data.ocorrencias_rota = [];
    this.data.resumo_diario_cd = [];
    this.data.relatorios_divergencia = [];
    this.data.auditoria_produtividade = [];
    this.data.trocas_veiculos = [];
    this.data.retencoes_frota = [];
    this.data.reentregas = [];
    this.data.audit_logs = [];
    this.data.registro_versoes = [];

    this.save();
    return { success: true, message: 'Reset executado com sucesso! Dados zerados para início da operação oficial.' };
  }

  // ===== GERADOR DE EXTRAÇÃO SQL PARA BANCO / POWER BI =====
  exportToSQL() {
    const esc = (val) => {
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
      if (typeof val === 'number') return val;
      return "'" + String(val).replace(/'/g, "''") + "'";
    };

    let sql = `-- =============================================================================\n`;
    sql += `-- DUMP DE DADOS EXTRAÍDOS DO SISTEMA JR SAC / JR OPER\n`;
    sql += `-- Data da Extração: ${new Date().toLocaleString('pt-BR')}\n`;
    sql += `-- Compatível com PostgreSQL / Supabase / Power BI DirectQuery\n`;
    sql += `-- =============================================================================\n\n`;

    // Ocorrências de Devolução
    const devList = this.getOcorrenciasDevolucao();
    if (devList && devList.length > 0) {
      sql += `-- 1. OCORRÊNCIAS DE DEVOLUÇÃO (SAC INTERNO)\n`;
      devList.forEach(dev => {
        sql += `INSERT INTO ocorrencias_devolucao (\n`;
        sql += `  numero_protocolo, numero_devolucao, carga_numero, cliente_nome, veiculo_placa, rota_nome,\n`;
        sql += `  motivo_reclamado, valor_reclamado, detalhamento_texto, forma_acerto, status_fechamento, criado_em\n`;
        sql += `) VALUES (\n`;
        sql += `  ${esc(dev.numero_protocolo)}, ${esc(dev.numero_devolucao)}, ${esc(dev.carga_numero)}, ${esc(dev.cliente_nome)}, ${esc(dev.veiculo_placa)}, ${esc(dev.rota_nome)},\n`;
        sql += `  ${esc(dev.motivo_reclamado)}, ${esc(dev.valor_reclamado || 0)}, ${esc(dev.detalhamento_texto)}, ${esc(dev.forma_acerto || 'ABATIMENTO')}, ${esc(dev.status_fechamento || 'PENDENTE_FISICO')}, ${esc(dev.criado_em || new Date().toISOString())}\n`;
        sql += `) ON CONFLICT (numero_protocolo) DO UPDATE SET valor_reclamado = EXCLUDED.valor_reclamado, status_fechamento = EXCLUDED.status_fechamento;\n\n`;
      });
    }

    // Ocorrências em Rota
    const rotaList = this.getOcorrenciasRota();
    if (rotaList && rotaList.length > 0) {
      sql += `-- 2. OCORRÊNCIAS EM ROTA (FROTA / MANUTENÇÃO)\n`;
      rotaList.forEach(rot => {
        sql += `INSERT INTO ocorrencias_rota (\n`;
        sql += `  numero_protocolo, carga_id, veiculo_id, motorista_id, tipo_ocorrencia, descricao, status, veiculo_parado\n`;
        sql += `) VALUES (\n`;
        sql += `  ${esc(rot.numero_protocolo)}, 1, 1, 1, ${esc(rot.tipo_ocorrencia || 'MECANICA')}, ${esc(rot.descricao)}, ${esc(rot.status || 'ABERTO')}, ${esc(rot.veiculo_parado !== false)}\n`;
        sql += `) ON CONFLICT (numero_protocolo) DO UPDATE SET status = EXCLUDED.status, veiculo_parado = EXCLUDED.veiculo_parado;\n\n`;
      });
    }

    // Trocas de Veículos
    const trocasList = this.getTrocasVeiculos();
    if (trocasList && trocasList.length > 0) {
      sql += `-- 3. TROCAS DE VEÍCULOS\n`;
      trocasList.forEach(tr => {
        sql += `INSERT INTO substituicoes_veiculos (\n`;
        sql += `  veiculo_escalado_placa, veiculo_substituto_placa, motivo, motivo_outro, detalhamento, autorizado_por_usuario, criado_em\n`;
        sql += `) VALUES (\n`;
        sql += `  ${esc(tr.veiculo_escalado)}, ${esc(tr.veiculo_trocado)}, ${esc(tr.motivo_resumido)}, ${esc(tr.motivo_outro)}, ${esc(tr.detalhamento)}, ${esc(tr.autorizado_por)}, ${esc(tr.criado_em)}\n`;
        sql += `);\n\n`;
      });
    }

    return sql;
  }

  // =============================================================================
  // MÓDULO: GESTÃO DE RETENÇÃO DE FROTA (v6.1.0)
  // =============================================================================

  /**
   * Retorna lista de retenções (não deletadas), enriquecida com dados do
   * veículo cadastrado via veiculo_id (FK para db.data.veiculos).
   */
  getRetencoesFrota() {
    const retencoes = Array.isArray(this.data.retencoes_frota)
      ? this.data.retencoes_frota
      : [];
    return retencoes
      .filter(r => !r.is_deleted)
      .map(r => {
        const veiculo = (this.data.veiculos || []).find(v => v.id == r.veiculo_id) || {};
        return {
          ...r,
          veiculo_modelo: veiculo.modelo || veiculo.tipo || '',
          veiculo_tipo: veiculo.tipo || r.tipo_veiculo || '',
          veiculo_capacidade: veiculo.capacidade_kg || null
        };
      })
      .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
  }

  /**
   * Cria novo registro de retenção com ID auto e número de protocolo sequencial.
   * @param {Object} dados - { veiculo_id, placa, tipo_veiculo, data_parada, motivo, tipo_os, local, data_previsao }
   * @returns {{ success: boolean, retencao: Object }}
   */
  addRetencaoFrota({ veiculo_id, placa, tipo_veiculo, data_parada, motivo, tipo_os, local, data_previsao, numero_os }) {
    if (!Array.isArray(this.data.retencoes_frota)) {
      this.data.retencoes_frota = [];
    }
    const ano = new Date().getFullYear();
    const numero_retencao = this.getNextSequenceNumber(
      'retencoes_frota',
      'numero_retencao',
      `RET-${ano}-`,
      3
    );
    const retencao = {
      id: Date.now(),
      numero_retencao,
      veiculo_id: parseInt(veiculo_id) || null,
      placa: (placa || '').toUpperCase().trim(),
      tipo_veiculo: (tipo_veiculo || '').toUpperCase().trim(),
      data_parada: data_parada || new Date().toISOString().split('T')[0],
      motivo: motivo || '',
      tipo_os: tipo_os || 'CORRETIVA',
      local: local || '',
      data_previsao: data_previsao || null,
      numero_os: (numero_os || '').toUpperCase().trim() || null,
      data_liberacao: null,
      status: 'RETIDO',
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: new Date().toISOString(),
      is_deleted: false
    };
    this.data.retencoes_frota.push(retencao);
    this.save();
    return { success: true, retencao };
  }

  /**
   * Altera status do registro para LIBERADO e registra a data de liberação.
   * @param {number|string} id - ID da retenção
   * @param {string} dataLiberacao - Data de liberação (YYYY-MM-DD)
   * @returns {{ success: boolean, retencao?: Object, message?: string }}
   */
  liberarVeiculo(id, dataLiberacao) {
    const retencao = (this.data.retencoes_frota || []).find(r => r.id == id && !r.is_deleted);
    if (!retencao) {
      return { success: false, message: `Retenção ID ${id} não encontrada.` };
    }
    retencao.status = 'LIBERADO';
    retencao.data_liberacao = dataLiberacao || new Date().toISOString().split('T')[0];
    this.save();
    return { success: true, retencao };
  }

  /**
   * Soft delete de um registro de retenção.
   * @param {number|string} id - ID da retenção
   * @returns {{ success: boolean, message?: string }}
   */
  deleteRetencaoFrota(id) {
    const retencao = (this.data.retencoes_frota || []).find(r => r.id == id);
    if (!retencao) {
      return { success: false, message: `Retenção ID ${id} não encontrada.` };
    }
    retencao.is_deleted = true;
    retencao.deleted_at = new Date().toISOString();
    retencao.deleted_by_nome = this.currentUser ? this.currentUser.nome : 'SISTEMA';
    this.save();
    return { success: true };
  }

  /**
   * Edita campos de um registro de retenção existente (retido ou liberado).
   * @param {number|string} id
   * @param {Object} dados - campos que podem ser alterados
   * @returns {{ success: boolean, retencao?: Object, message?: string }}
   */
  updateRetencaoFrota(id, dados) {
    const retencao = (this.data.retencoes_frota || []).find(r => r.id == id && !r.is_deleted);
    if (!retencao) {
      return { success: false, message: `Retenção ID ${id} não encontrada.` };
    }
    const campos = ['placa', 'data_parada', 'motivo', 'tipo_os', 'numero_os', 'local', 'data_previsao', 'data_liberacao', 'status'];
    campos.forEach(c => {
      if (Object.prototype.hasOwnProperty.call(dados, c)) {
        retencao[c] = dados[c];
      }
    });
    retencao.atualizado_em = new Date().toISOString();
    this.save();
    return { success: true, retencao };
  }

  // =============================================================================
  // MÓDULO: CONTROLE DE REENTREGAS DE ROTA
  // =============================================================================

  /**
   * Retorna lista de reentregas ativas (!is_deleted).
   */
  getReentregas() {
    const list = Array.isArray(this.data.reentregas) ? this.data.reentregas : [];
    return list
      .filter(x => !x.is_deleted)
      .sort((a, b) => new Date(b.data || b.criado_em) - new Date(a.data || a.criado_em));
  }

  /**
   * Cria novo registro de reentrega com ID, autor, data e auditoria.
   * @param {Object} item - { data, carga_numero, rota_nome, motorista_nome, entregas_saiu, entregas_feitas, entregas_reentrega, motivo, placa, novo_motorista, status }
   * @returns {{ success: boolean, reentrega: Object }}
   */
  addReentrega(item) {
    if (!Array.isArray(this.data.reentregas)) {
      this.data.reentregas = [];
    }
    const novaReentrega = {
      id: Date.now(),
      data: item.data || new Date().toISOString().split('T')[0],
      carga_numero: String(item.carga_numero || '').trim().toUpperCase(),
      rota_nome: String(item.rota_nome || '').trim().toUpperCase(),
      motorista_nome: String(item.motorista_nome || '').trim().toUpperCase(),
      entregas_saiu: parseInt(item.entregas_saiu) || 0,
      entregas_feitas: parseInt(item.entregas_feitas) || 0,
      entregas_reentrega: parseInt(item.entregas_reentrega) || 0,
      motivo: String(item.motivo || '').trim(),
      placa: String(item.placa || '').trim().toUpperCase(),
      novo_motorista: item.novo_motorista ? String(item.novo_motorista).trim().toUpperCase() : null,
      status: item.status || 'PENDENTE',
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: new Date().toISOString(),
      is_deleted: false,
      deleted_at: null,
      deleted_by_nome: null
    };
    this.data.reentregas.unshift(novaReentrega);
    this.logAudit({
      acao: 'CRIACAO',
      modulo: 'reentregas',
      registro_id: novaReentrega.id,
      diff: { depois: novaReentrega }
    });
    this.save();
    return { success: true, reentrega: novaReentrega };
  }

  /**
   * Atualiza campos de uma reentrega existente.
   * @param {number|string} id
   * @param {Object} updates
   * @returns {{ success: boolean, reentrega?: Object, message?: string }}
   */
  updateReentrega(id, updates) {
    if (!Array.isArray(this.data.reentregas)) this.data.reentregas = [];
    const item = this.data.reentregas.find(x => x.id == id && !x.is_deleted);
    if (!item) {
      return { success: false, message: `Reentrega ID ${id} não encontrada.` };
    }
    const antes = JSON.parse(JSON.stringify(item));
    const camposPermitidos = [
      'data', 'carga_numero', 'rota_nome', 'motorista_nome',
      'entregas_saiu', 'entregas_feitas', 'entregas_reentrega',
      'motivo', 'placa', 'novo_motorista', 'status'
    ];
    camposPermitidos.forEach(campo => {
      if (Object.prototype.hasOwnProperty.call(updates, campo)) {
        if (typeof updates[campo] === 'string' && ['carga_numero', 'rota_nome', 'motorista_nome', 'placa', 'novo_motorista'].includes(campo)) {
          item[campo] = updates[campo].trim().toUpperCase();
        } else if (['entregas_saiu', 'entregas_feitas', 'entregas_reentrega'].includes(campo)) {
          item[campo] = parseInt(updates[campo]) || 0;
        } else {
          item[campo] = updates[campo];
        }
      }
    });
    item.atualizado_em = new Date().toISOString();
    item.atualizado_por = this.currentUser ? this.currentUser.nome : 'SISTEMA';

    this.logAudit({
      acao: 'EDICAO',
      modulo: 'reentregas',
      registro_id: id,
      diff: { antes, depois: item }
    });
    this.save();
    return { success: true, reentrega: item };
  }

  /**
   * Soft-delete auditado de uma reentrega.
   * @param {number|string} id
   * @returns {{ success: boolean, message?: string }}
   */
  deleteReentrega(id) {
    if (!Array.isArray(this.data.reentregas)) return { success: false, message: 'Coleção vazia.' };
    const item = this.data.reentregas.find(x => x.id == id && !x.is_deleted);
    if (!item) {
      return { success: false, message: `Reentrega ID ${id} não encontrada.` };
    }
    item.is_deleted = true;
    item.deleted_at = new Date().toISOString();
    item.deleted_by_nome = this.currentUser ? this.currentUser.nome : 'SISTEMA';
    item.deleted_by = this.currentUser ? { id: this.currentUser.id, nome: this.currentUser.nome } : { id: 0, nome: 'SISTEMA' };

    this.logAudit({
      acao: 'EXCLUSAO_LOGICA',
      modulo: 'reentregas',
      registro_id: id,
      diff: { antes: item }
    });
    this.save();
    return { success: true };
  }
}

var db;
try {
  db = new Store();
  if (typeof window !== 'undefined') window.db = db;
} catch(errDb) {
  console.error("Falha ao instanciar Store, criando fallback:", errDb);
  var fallbackData = typeof INITIAL_DATA !== 'undefined' ? JSON.parse(JSON.stringify(INITIAL_DATA)) : { usuarios: [], roles_disponiveis: [] };
  db = {
    data: fallbackData,
    currentUser: null,
    getDevolucoes: function() { return (this.data && this.data.ocorrencias_devolucao) || []; },
    getOcorrenciasRota: function() { return (this.data && this.data.ocorrencias_rota) || []; },
    getControleViagens: function() { return (this.data && this.data.controle_viagens) || []; },
    getUsuarios: function() { return (this.data && this.data.usuarios) || []; },
    getLixeiraItems: function() { return []; },
    init: function() {}
  };
  if (typeof window !== 'undefined') window.db = db;
}
