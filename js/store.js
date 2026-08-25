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
    // Semente aleatória por instância (recarrega a cada abertura do app) —
    // usada por gerarIdUnico() para reduzir a chance de dois aparelhos
    // gerarem o mesmo id caso criem um registro no mesmíssimo milissegundo.
    this._ultimoMsVirtual = 0;
    try {
      this.init();
    } catch(err) {
      console.error("Erro crítico na construção da Store:", err);
      this.data = (typeof INITIAL_DATA !== 'undefined') ? JSON.parse(JSON.stringify(INITIAL_DATA)) : {};
      this.currentUser = null;
    }
  }

  // Gerador de id único centralizado (achado em 20/08/2026 — antes disso,
  // 15 pontos diferentes de store.js chamavam Date.now() direto para gerar
  // id, cada um de um jeito: puro, +Math.random() [gerava float, não
  // cabendo bem num BIGINT] ou +Math.floor(Math.random()*1000) [podia
  // colidir com o id de outro milissegundo vizinho, já que soma direto sem
  // multiplicar a base]. Corrigir um por um era o método errado — mudava
  // 15 lugares por 15 razões diferentes toda vez que aparecia mais um caso.
  // multiplicar Date.now() por 1000 preserva um "bloco" de 1000 ids só
  // pra esse milissegundo, sem nunca encostar no bloco do milissegundo
  // seguinte; o contador (com semente aleatória por instância) garante
  // que duas chamadas no mesmo milissegundo, no mesmo aparelho, nunca
  // colidam.
  // ITEM 9 (Onda 2, 22/08/2026) — id à prova de colisão entre aparelhos.
  //
  // O que estava errado: os 3 últimos dígitos vinham de um contador que
  // começava aleatório A CADA ABERTURA do app e só andava dentro do mesmo
  // milissegundo. Dois aparelhos que criassem um registro no mesmo
  // milissegundo tinham chance real de produzir o MESMO id — e a ETAPA 0
  // confirmou o que isso custa: `id` é PRIMARY KEY e o envio usa
  // `Prefer: resolution=merge-duplicates`, então a colisão não dá erro:
  // um registro **sobrescreve** o outro, em silêncio, para sempre.
  //
  // Como ficou:
  //   - os 3 últimos dígitos passam a ser o CARIMBO DO APARELHO, fixo e
  //     estável (CloudStore.carimboDoAparelho). Dois aparelhos diferentes
  //     ocupam faixas diferentes;
  //   - a unicidade dentro do próprio aparelho deixa de depender de
  //     contador: cada chamada anda pelo menos um milissegundo "virtual"
  //     para a frente. Uma importação de 400 linhas no mesmo milissegundo
  //     real consome 400 ms virtuais — some 0,4 s ao id da última linha e
  //     nada mais.
  //
  // O tamanho não muda: continua na casa de 1,7e15, bem abaixo do limite
  // seguro do JavaScript (9,0e15) e dentro do BIGINT do Postgres.
  gerarIdUnico() {
    const agora = Date.now();
    const proximo = Math.max(agora, (this._ultimoMsVirtual || 0) + 1);
    this._ultimoMsVirtual = proximo;
    return proximo * 1000 + this._carimboDoAparelho();
  }

  _carimboDoAparelho() {
    if (this._carimbo !== undefined) return this._carimbo;
    try {
      const CS = (window.cloudStore && window.cloudStore.constructor) || null;
      if (CS && typeof CS.carimboDoAparelho === 'function') {
        this._carimbo = CS.carimboDoAparelho();
        return this._carimbo;
      }
    } catch(e) {}
    // cloudStore.js não carregou (modo local puro): carimbo só desta sessão.
    this._carimbo = Math.floor(Math.random() * 1000);
    return this._carimbo;
  }

  init() {
    // ARMAZENAMENTO DIVIDIDO EM DUAS CHAVES (correção da causa raiz do risco
    // de estouro de cota no localStorage — ver auditoria de 17/08/2026):
    //   'jr_sac_static' → clientes + produtos (catálogos pesados, ~3MB,
    //                      praticamente estáticos, gravados raramente)
    //   'jr_sac_db'      → todo o resto (dados operacionais, pequenos e que
    //                      mudam a cada ação do usuário)
    // Isso reduz o tamanho de cada gravação normal de ~3MB para poucas
    // dezenas de KB. Instalações antigas (formato monolítico, com
    // clientes/produtos dentro de 'jr_sac_db') são migradas automaticamente
    // na primeira carga com este código, sem perda de dados.
    const isFirstInstall = !localStorage.getItem('jr_sac_db');
    let legacyMonolithic = null;
    try {
      const storedVersion = localStorage.getItem('jr_sac_version');
      const currentVersion = '6.1.0';
      if (isFirstInstall) {
        // Primeira vez: grava banco inicial já dividido
        try {
          localStorage.setItem('jr_sac_static', JSON.stringify({
            clientes: (typeof INITIAL_DATA !== 'undefined') ? INITIAL_DATA.clientes : [],
            produtos: (typeof INITIAL_DATA !== 'undefined') ? INITIAL_DATA.produtos : []
          }));
          const opInicial = (typeof INITIAL_DATA !== 'undefined') ? { ...INITIAL_DATA } : {};
          delete opInicial.clientes;
          delete opInicial.produtos;
          localStorage.setItem('jr_sac_db', JSON.stringify(opInicial));
          localStorage.setItem('jr_sac_version', currentVersion);
        } catch(eSet) {
          console.warn("Nao foi possivel gravar dados iniciais no localStorage:", eSet);
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
      const rawStatic = localStorage.getItem('jr_sac_static');
      this.data = rawDb ? JSON.parse(rawDb) : null;
      const staticData = rawStatic ? JSON.parse(rawStatic) : null;

      if (this.data && (Array.isArray(this.data.clientes) || Array.isArray(this.data.produtos)) && !staticData) {
        // Instalação antiga (formato monolítico): extrai clientes/produtos
        // para a chave estática antes de continuar, sem perder nada.
        legacyMonolithic = { clientes: this.data.clientes || [], produtos: this.data.produtos || [] };
        console.info('[Store] Migrando instalação existente para armazenamento dividido (jr_sac_static + jr_sac_db)...');
      } else if (staticData) {
        this.data = this.data || {};
        this.data.clientes = staticData.clientes || [];
        this.data.produtos = staticData.produtos || [];
      }
    } catch(e) {
      console.warn("Usando INITIAL_DATA devido a exceção no localStorage:", e);
      this.data = null;
    }

    if (!this.data || typeof this.data !== 'object') {
      this.data = (typeof INITIAL_DATA !== 'undefined') ? JSON.parse(JSON.stringify(INITIAL_DATA)) : {};
    }

    if (legacyMonolithic) {
      this.data.clientes = legacyMonolithic.clientes;
      this.data.produtos = legacyMonolithic.produtos;
    }

    // Garantir sincronia com bases mestres completas (15.139 Clientes e 4.010 Produtos da planilha Dados SAC.xlsx)
    if (typeof INITIAL_DATA !== 'undefined') {
      if (!Array.isArray(this.data.clientes) || (INITIAL_DATA.clientes && this.data.clientes.length < INITIAL_DATA.clientes.length)) {
        this.data.clientes = JSON.parse(JSON.stringify(INITIAL_DATA.clientes));
        legacyMonolithic = legacyMonolithic || {}; // força regravação da chave estática abaixo
      }
      if (!Array.isArray(this.data.produtos) || (INITIAL_DATA.produtos && this.data.produtos.length < INITIAL_DATA.produtos.length)) {
        this.data.produtos = JSON.parse(JSON.stringify(INITIAL_DATA.produtos));
        legacyMonolithic = legacyMonolithic || {};
      }

      // (achado de 22/08/2026) Motoristas, ajudantes e veículos também vêm da
      // planilha Dados SAC — mas, ao contrário de clientes e produtos, ELES
      // SINCRONIZAM com a nuvem. Isso os deixa expostos a um risco que os
      // outros dois não correm: se a nuvem estiver incompleta, o pull
      // substitui a lista local pela lista curta da nuvem e o cadastro
      // "some" do aparelho, sem forma de voltar.
      //
      // Foi o que aconteceu: os 39 motoristas da planilha têm cnh vazia, e
      // cnh era UNIQUE NOT NULL no banco — várias strings vazias colidem
      // entre si (NULL não colidiria). Só os 2 registros de teste, que
      // tinham CNH distinta, chegaram à nuvem; o pull então reduziu a lista
      // local a esses 2. (Lado do banco corrigido na migration_24.)
      //
      // Aqui a rede de proteção — ver restaurarCadastrosDaPlanilha().
      // Se repôs algo, força a gravação abaixo: o envio para a nuvem lê de
      // 'jr_sac_db', não da memória, então uma restauração que não for
      // persistida não chega a subir.
      // ITEM 8 (Onda 2, 22/08/2026) — UMA VEZ SÓ, na primeira instalação.
      //
      // Isto rodava a cada abertura do app, e o gêmeo dele rodava a cada 30
      // segundos dentro do pull (removido de cloudStore.js). Era o que
      // ressuscitava veículo vendido e motorista desligado: a planilha
      // embarcada não sabe o que foi excluído depois dela.
      //
      // Decisão 5: a planilha é a base inicial; daí em diante o app é a
      // fonte de verdade, e exclusão precisa valer. Quem protege o cadastro
      // de sumir num pull agora é a mesclagem por registro (item 2), não a
      // reinjeção.
      let jaSemeou = false;
      try { jaSemeou = !!localStorage.getItem('jr_seed_cadastros_v1'); } catch(e) {}
      if (!jaSemeou) {
        if (this.restaurarCadastrosDaPlanilha() > 0) {
          legacyMonolithic = legacyMonolithic || {};
        }
        try { localStorage.setItem('jr_seed_cadastros_v1', agoraIsoBrasilia()); } catch(e) {}
      }
    }

    if (legacyMonolithic) {
      // Concluir a migração/sincronia: grava a chave estática separadamente
      // e regrava o bloco operacional já sem clientes/produtos dentro.
      this.saveStaticCatalog();
      this.save();
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
    ensureArray('itens_avulsos_destinacao');
    ensureArray('medidas_disciplinares');
    ensureArray('orientacoes_feedback');
    ensureArray('atestados_medicos');
    ensureArray('ausencias_registros');
    ensureArray('sinistros');
    ensureArray('conflitos_pendentes');

    // Migração leve, roda uma única vez por dispositivo (idempotente):
    // 1) garante um 'id' único em cada item de devolução — sem isso, o
    //    botão "Editar" do Retorno Físico não localiza o item (achado da
    //    auditoria de 17/08/2026, item 1.2).
    // 2) corrige códigos de destino gravados com erro de digitação em
    //    versões anteriores do formulário, para os rótulos voltarem a
    //    aparecer corretamente em telas e relatórios (item 1.3).
    let precisaSalvarMigracaoItens = false;
    (this.data.ocorrencias_devolucao || []).forEach(d => {
      if (Array.isArray(d.itens)) {
        d.itens.forEach((item, idx) => {
          if (!item.id) {
            item.id = `item_${d.id || Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
            precisaSalvarMigracaoItens = true;
          }
          if (item.destino_item === 'RETABALHO_REEMBALAGEM') {
            item.destino_item = 'RETRABALHO_REEMBALAGEM';
            precisaSalvarMigracaoItens = true;
          }
          if (item.destino_item === 'DESCARTE_AVARIA') {
            item.destino_item = 'AVARIA_DESCARTE';
            precisaSalvarMigracaoItens = true;
          }
          // Preenche produto_codigo/produto_descricao (nomes lidos pelas
          // telas de Destinação de Itens e Recepção no CD) a partir de
          // codigo/descricao em registros salvos antes desta correção —
          // sem isso, a coluna "Produto" dessas telas aparecia em branco.
          if (!item.produto_codigo && item.codigo) {
            item.produto_codigo = item.codigo;
            precisaSalvarMigracaoItens = true;
          }
          if (!item.produto_descricao && item.descricao) {
            item.produto_descricao = item.descricao;
            precisaSalvarMigracaoItens = true;
          }
        });
      }
    });
    // 3) renomeia o rótulo "AVARIA NO MANUSEIO" (Requisito/Falha das
    //    ocorrências de colaborador no CD) para "AVARIA DE PRODUTO" em
    //    registros já salvos, para acompanhar a opção renomeada no formulário
    //    (pedido de 19/08/2026) e manter filtros/relatórios consistentes.
    let precisaSalvarMigracaoOcCD = false;
    (this.data.resumo_diario_cd || []).forEach(resumo => {
      if (Array.isArray(resumo.ocorrencias_colaboradores)) {
        resumo.ocorrencias_colaboradores.forEach(oc => {
          if (oc.requisito === 'AVARIA NO MANUSEIO') {
            oc.requisito = 'AVARIA DE PRODUTO';
            precisaSalvarMigracaoOcCD = true;
          }
        });
      }
    });
    if (precisaSalvarMigracaoOcCD) {
      this.save();
    }

    // Normalização do tipo_ocorrencia já gravado (22/08/2026, build 4.8.1).
    //
    // O mapeamento novo em _tipoOcorrenciaDoMotivo() cobre gravação e
    // edição, mas não reescreve o que já está no cache. Sem esta passagem,
    // toda ocorrência de rota criada ANTES da 4.8.1 continuaria com
    // "AVARIA MECÂNICA" em tipo_ocorrencia e seguiria derrubando o lote
    // inteiro no 23514 — a tabela ficaria travada do mesmo jeito, só que
    // agora sem motivo aparente. Roda uma vez por aparelho e é idempotente:
    // valor já normalizado passa direto pelo mapeamento sem mudar.
    let precisaSalvarTipoOcorrencia = false;
    (this.data.ocorrencias_rota || []).forEach(r => {
      const normalizado = this._tipoOcorrenciaDoMotivo(r.tipo_ocorrencia);
      if (r.tipo_ocorrencia !== normalizado) {
        // O texto original não se perde: vai para motivo_resumido, que é o
        // campo que as telas realmente exibem, se ele ainda estiver vazio.
        if (!r.motivo_resumido && r.tipo_ocorrencia) r.motivo_resumido = r.tipo_ocorrencia;
        r.tipo_ocorrencia = normalizado;
        precisaSalvarTipoOcorrencia = true;
      }
    });
    if (precisaSalvarTipoOcorrencia) {
      this.save();
    }

    // 4) Orientação Verbal deixou de ser uma medida administrativa
    //    (pedido de 19/08/2026): registros que já tinham sido emitidos
    //    como medida disciplinar são migrados para orientacoes_feedback
    //    (mesma coleção do bloco "Orientação e Feedback") e marcados como
    //    excluídos em medidas_disciplinares, para não sumir do histórico
    //    do colaborador nem ficar contando como "medida administrativa"
    //    (que passa a conter só Advertência e Suspensão).
    let precisaSalvarMigracaoOV = false;
    (this.data.medidas_disciplinares || []).forEach(m => {
      if (m.tipo === 'ORIENTACAO_VERBAL' && !m.is_deleted) {
        if (!Array.isArray(this.data.orientacoes_feedback)) this.data.orientacoes_feedback = [];
        this.data.orientacoes_feedback.push({
          id: `orient_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          colaborador_tipo: m.colaborador_tipo || 'CD',
          colaborador_id: m.colaborador_id || null,
          colaborador_nome: m.colaborador_nome,
          data: m.data_ocorrencia,
          ocorrencia: m.motivo || '',
          acao: `ORIENTAÇÃO VERBAL APLICADA${m.gestor ? ` — GESTOR: ${m.gestor}` : ''}`,
          criado_por: m.criado_por || 'SISTEMA',
          criado_em: m.criado_em || agoraIsoBrasilia(),
          is_deleted: false
        });
        m.is_deleted = true;
        m.deleted_at = agoraIsoBrasilia();
        precisaSalvarMigracaoOV = true;
      }
    });
    if (precisaSalvarMigracaoOV) {
      this.save();
    }

    if (precisaSalvarMigracaoItens) {
      this.save();
    }

    // Seed de demonstração de reentregas REMOVIDO em 19/08/2026 — inseria 2
    // registros fictícios ("ROBERTO CARLOS"/"LUIZ EDUARDO") toda vez que a
    // chave 'jr_sac_db' não existisse no localStorage, o que acontece não só
    // na instalação genuinamente nova, mas também sempre que alguém usa o
    // botão de recuperação "Limpar Cache e Reiniciar" (que roda
    // localStorage.clear()) — reintroduzindo dados de teste como se fossem
    // reais, inclusive sincronizados para a nuvem em produção.

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

    // Migração/Sincronia automática do Módulo Ocorrências em Rota (Etapa 1)
    if (Array.isArray(this.data.ocorrencias_rota)) {
      this.data.ocorrencias_rota.forEach(r => {
        if (r.localizacao === undefined) r.localizacao = '';
        if (r.status_chamado === undefined) {
          r.status_chamado = (r.status === 'RESOLVIDO' || r.status_veiculo === 'Em Rota') ? 'finalizado' : 'pendente';
        }
        if (r.retorno_manutencao_descricao === undefined) r.retorno_manutencao_descricao = r.acao_mecanico || '';
        if (r.retorno_manutencao_data === undefined) r.retorno_manutencao_data = r.resolvido_em || null;
        if (r.retorno_manutencao_responsavel === undefined) r.retorno_manutencao_responsavel = null;
        if (r.transcricao_audio_wa !== undefined) delete r.transcricao_audio_wa;
        if (r.transcricao_audio_whatsapp !== undefined) delete r.transcricao_audio_whatsapp;
      });
    }

    // Garantir status explícito em todas as reentregas
    if (Array.isArray(this.data.reentregas)) {
      this.data.reentregas.forEach(re => {
        if (!re.status) re.status = 'PENDENTE';
      });
    }

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
          this.save();
        }
      }
    } catch(e) {
      console.warn("Erro ao migrar senhas:", e);
    }
  }

  // Monta o "fatia operacional" de this.data — tudo MENOS clientes/produtos,
  // que ficam na chave separada 'jr_sac_static' (ver init()). É essa fatia
  // que save() grava a cada operação; por isso cada gravação passou de
  // ~3MB para poucas dezenas de KB.
  // Reinsere, POR ID, os cadastros da planilha Dados SAC que estiverem
  // faltando neste aparelho. É uma MESCLA, não uma substituição: um
  // motorista/veículo/ajudante cadastrado pela tela do app tem id próprio e
  // é preservado; e um registro que já existe não é sobrescrito, para não
  // desfazer edições feitas pela equipe.
  //
  // ATENÇÃO — ITEM 8 (Onda 2, 22/08/2026): esta função roda UMA VEZ SÓ, na
  // primeira abertura do aparelho, protegida pela chave de localStorage
  // 'jr_seed_cadastros_v1' (ver init()). NÃO volte a chamá-la depois de cada
  // pull, como já foi feito: era isso que ressuscitava veículo vendido e
  // motorista desligado a cada 30 segundos, e que deixava um aparelho em
  // build antiga contaminar o cadastro de todo mundo.
  //
  // O problema que a chamada por pull tentava resolver — o pull substituir a
  // lista local pela lista curta da nuvem — foi resolvido de outro jeito:
  // pela mesclagem por registro (item 2, _mesclarPorRegistro em
  // cloudStore.js), que não substitui coleção inteira. Decisão 5: a planilha
  // é a semente inicial; daí em diante o app é a fonte de verdade.
  restaurarCadastrosDaPlanilha() {
    if (typeof INITIAL_DATA === 'undefined') return 0;
    let reinseridos = 0;
    ['motoristas', 'ajudantes', 'veiculos'].forEach(colecao => {
      const base = INITIAL_DATA[colecao];
      if (!Array.isArray(base) || !base.length) return;
      if (!Array.isArray(this.data[colecao])) this.data[colecao] = [];
      const idsPresentes = new Set(this.data[colecao].map(r => String(r.id)));
      const faltando = base.filter(r => !idsPresentes.has(String(r.id)));
      if (faltando.length) {
        this.data[colecao] = this.data[colecao].concat(JSON.parse(JSON.stringify(faltando)));
        reinseridos += faltando.length;
        console.info(`[Store] ${faltando.length} ${colecao} restaurados da planilha Dados SAC (faltavam neste aparelho).`);
      }
    });
    return reinseridos;
  }

  _getOperationalSlice() {
    const slice = { ...this.data };
    delete slice.clientes;
    delete slice.produtos;
    return slice;
  }

  // Grava o catálogo estático (clientes/produtos) — chamado raramente:
  // na primeira instalação, na migração de instalações antigas, e nas
  // (futuras) telas de edição de cadastro de cliente/produto, se vierem
  // a existir.
  saveStaticCatalog() {
    try {
      localStorage.setItem('jr_sac_static', JSON.stringify({
        clientes: this.data.clientes || [],
        produtos: this.data.produtos || []
      }));
      return true;
    } catch(e) {
      console.error("[Store] Falha ao gravar catálogo estático (clientes/produtos):", e);
      return false;
    }
  }

  // Rede de segurança para quando, mesmo com a fatia operacional pequena,
  // uma gravação ainda assim estourar a cota do dispositivo: libera espaço
  // reduzindo o histórico de auditoria/versões (dados de log, não registros
  // de negócio) e tenta de novo. NÃO mexe em nenhum dado operacional real
  // (devoluções, ocorrências, viagens, retenções, lixeira etc.).
  pruneOldAuditData() {
    let liberoualgo = false;
    try {
      if (Array.isArray(this.data.audit_logs) && this.data.audit_logs.length > 300) {
        this.data.audit_logs = this.data.audit_logs.slice(0, 300);
        liberoualgo = true;
      }
      if (Array.isArray(this.data.registro_versoes) && this.data.registro_versoes.length > 500) {
        this.data.registro_versoes = this.data.registro_versoes
          .sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0))
          .slice(0, 500);
        liberoualgo = true;
      }
    } catch(e) {
      console.warn("[Store] Erro ao tentar liberar espaço automaticamente:", e);
    }
    return liberoualgo;
  }

  // =================================================================
  // ALARME DE COTA VISÍVEL — Onda 1, item 6 (22/08/2026)
  //
  // save() já devolvia false quando a gravação falhava, e escrevia no
  // console. **Ninguém abre o console.** O operador continuava trabalhando
  // achando que tinha salvo — e o dado não existia em lugar nenhum, nem
  // aqui nem na nuvem. É a falha mais cara possível: silenciosa e com
  // perda real.
  //
  // A partir daqui a falha aparece na tela, em toda tela, sem depender de
  // nenhum módulo ter tratado o retorno do save(): uma tarja vermelha fixa
  // no alto, que não some sozinha, mais um alerta na primeira vez (e no
  // máximo um por minuto, para não virar tortura se o disco estiver cheio).
  // =================================================================
  _alertarFalhaDeGravacao(erro) {
    const uso = (() => { try { return this.getStorageUsageInfo(); } catch(e) { return null; } })();
    this.ultimaFalhaDeGravacao = {
      quando: agoraIsoBrasilia(),
      detalhe: String((erro && erro.message) || erro || 'desconhecido').slice(0, 200),
      usoKB: uso ? uso.totalKB : null,
      percentual: uso ? uso.percentual : null
    };
    console.error('[Store] GRAVAÇÃO NÃO SALVA:', this.ultimaFalhaDeGravacao);

    if (typeof document === 'undefined' || !document.body) return;

    const texto = 'ATENÇÃO: o último registro NÃO foi salvo neste aparelho'
      + (uso ? ` — a memória do navegador está em ${uso.percentual}% (${uso.totalKB} KB)` : '')
      + '. Anote o que você acabou de lançar, avise o suporte e NÃO continue lançando neste aparelho.';

    try {
      let tarja = document.getElementById('jr-alerta-gravacao');
      if (!tarja) {
        tarja = document.createElement('div');
        tarja.id = 'jr-alerta-gravacao';
        tarja.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7f1d1d;color:#fff;'
          + 'padding:10px 14px;font-size:13px;font-weight:700;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.6);'
          + 'border-bottom:2px solid #ef4444;line-height:1.35';
        document.body.appendChild(tarja);
      }
      tarja.innerHTML = '⛔ ' + texto
        + ' <button onclick="this.parentElement.remove()" style="margin-left:10px;background:#fff;color:#7f1d1d;'
        + 'border:0;border-radius:4px;padding:2px 8px;font-weight:800;cursor:pointer">fechar</button>';
    } catch(e) {}

    // No máximo um alerta por minuto: a tarja é o aviso permanente, o
    // alert() é o que faz a pessoa parar agora.
    const agora = Date.now();
    if (!this._ultimoAlertaGravacao || (agora - this._ultimoAlertaGravacao) > 60000) {
      this._ultimoAlertaGravacao = agora;
      try { if (typeof alert === 'function') alert('⛔ ' + texto); } catch(e) {}
    }
  }

  // Retorna true/false indicando se a gravação foi bem-sucedida. Em caso de
  // falha (incluindo estouro de cota), tenta liberar espaço automaticamente
  // e grava de novo antes de desistir — ver auditoria de 17/08/2026, item 0.1.
  // Item 6 (22/08/2026): quando desiste, agora GRITA — ver
  // _alertarFalhaDeGravacao() acima.
  save() {
    try {
      this.sortAll();
    } catch(eSort) {
      console.warn("Erro ao ordenar dados antes de salvar:", eSort);
    }
    const payload = JSON.stringify(this._getOperationalSlice());
    try {
      localStorage.setItem('jr_sac_db', payload);
      // Gravou: se havia tarja de falha na tela, o problema passou.
      if (this.ultimaFalhaDeGravacao) {
        this.ultimaFalhaDeGravacao = null;
        try {
          const t = (typeof document !== 'undefined') && document.getElementById('jr-alerta-gravacao');
          if (t) t.remove();
        } catch(e) {}
      }
      this._scheduleCloudSync();
      return true;
    } catch(e) {
      console.error("[Store] Falha ao salvar dados operacionais no localStorage (tentativa 1):", e);
      const liberou = this.pruneOldAuditData();
      if (liberou) {
        try {
          localStorage.setItem('jr_sac_db', JSON.stringify(this._getOperationalSlice()));
          console.info("[Store] Gravação bem-sucedida após liberar espaço automaticamente (histórico de auditoria/versões reduzido).");
          this._scheduleCloudSync();
          return true;
        } catch(e2) {
          console.error("[Store] Falha ao salvar mesmo após liberar espaço:", e2);
          this._alertarFalhaDeGravacao(e2);
          return false;
        }
      }
      this._alertarFalhaDeGravacao(e);
      return false;
    }
  }

  // Agenda o envio Local → Nuvem de forma "debounced" (pedido de 19/08/2026):
  // em vez de chamar cloudStore.syncLocalToCloud() a cada save() — o que
  // reenviaria as 13 tabelas inteiras a cada micro-ação e poderia sobrepor
  // envios se save() disparar várias vezes seguidas — este método reinicia
  // um timer de 1.5s a cada chamada. Só quando ficar 1.5s sem nenhum save()
  // novo é que o envio de fato acontece, juntando várias gravações próximas
  // (ex: salvar um formulário inteiro, campo a campo) em um único envio.
  // fetch() do navegador nunca bloqueia a tela, então isso não trava nada
  // mesmo sem debounce — o debounce existe para não desperdiçar rede/cota
  // do Supabase e para não sobrepor envios concorrentes.
  _scheduleCloudSync() {
    if (typeof window === 'undefined' || !window.cloudStore || !window.cloudStore.isConfigured()) return;
    if (this._cloudSyncTimer) clearTimeout(this._cloudSyncTimer);
    this._cloudSyncTimer = setTimeout(() => {
      this._cloudSyncTimer = null;
      window.cloudStore.syncLocalToCloud().catch(e => {
        console.warn('[Store] Falha ao sincronizar com a nuvem (dados continuam salvos localmente):', e);
      });
    }, 1500);
  }

  // Tamanho aproximado (KB) do que está salvo hoje, para o painel de
  // Configurações/Governança acompanhar o crescimento dos dados ao longo
  // do tempo (item 0.1 da auditoria de 17/08/2026).
  // =================================================================
  // MEDIDOR DE ARMAZENAMENTO — reescrito em 25/08/2026
  //
  // O medidor anterior SUBESTIMAVA por três motivos somados, e por isso um
  // aparelho perdeu lançamento com a tarja marcando apenas 72%. Não era
  // alarme prematuro: era alarme ATRASADO.
  //
  //   1. Contava 2 chaves de 33. O cloudStore grava ~25 chaves-espelho
  //      (jr_ocorrencias, jr_reentregas, ...) que ficavam invisíveis —
  //      medido em produção, 28% do uso real não aparecia.
  //
  //   2. Contava CARACTERE, não byte. localStorage guarda UTF-16: cada
  //      caractere ocupa 2 bytes, então o consumo real era o dobro.
  //
  //   3. Dividia por um palpite. O limite varia MUITO por aparelho: medido
  //      neste projeto, um Chromium de desktop aceitou 30 MB sem reclamar,
  //      enquanto o Safari do iPhone costuma parar perto de 5 MB.
  //
  // O que mudou: conta TODAS as chaves, e o sinal de perigo não depende
  // mais só do percentual — há uma SONDA que tenta escrever de verdade. É
  // ela que responde à única pergunta que importa na doca: "ainda dá para
  // salvar?". O percentual continua servindo para acompanhar crescimento,
  // agora contra um limite declarado como o que é: referência do pior caso.
  // =================================================================
  getStorageUsageInfo() {
    // Pior caso conhecido (iPhone/Safari). NÃO é o limite do aparelho atual
    // — serve como régua de acompanhamento, não como verdade.
    const LIMITE_REFERENCIA_MB = 5;
    const PROVA_KB = 512;

    let operacionalKB = 0, estaticoKB = 0, totalKB = 0, chaves = 0;
    const maiores = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const tam = ((localStorage.getItem(k) || '').length + k.length) / 1024;
        totalKB += tam;
        chaves++;
        if (k === 'jr_sac_db') operacionalKB = tam;
        else if (k === 'jr_sac_static') estaticoKB = tam;
        maiores.push({ chave: k, KB: Math.round(tam) });
      }
    } catch (e) {
      // Navegador com storage bloqueado (modo restrito): sem medição.
      return { operacionalKB: 0, estaticoKB: 0, totalKB: 0, percentual: 0,
               nivel: 'green', chaves: 0, maiores: [], cabeMais: null, bytesKB: 0 };
    }
    maiores.sort((a, b) => b.KB - a.KB);

    // SONDA: escreve e apaga meio mega. Se não couber, o aparelho está na
    // borda AGORA, independente do que o percentual diga.
    let cabeMais = null;
    try {
      const alvo = '__jr_prova_espaco__';
      localStorage.setItem(alvo, 'x'.repeat(PROVA_KB * 1024));
      localStorage.removeItem(alvo);
      cabeMais = true;
    } catch (e) {
      cabeMais = false;
      try { localStorage.removeItem('__jr_prova_espaco__'); } catch (e2) {}
    }

    const percentual = (totalKB / 1024 / LIMITE_REFERENCIA_MB) * 100;
    let nivel = 'green';
    if (cabeMais === false || percentual >= 90) nivel = 'red';
    else if (percentual >= 70) nivel = 'amber';

    return {
      operacionalKB: Math.round(operacionalKB),
      estaticoKB: Math.round(estaticoKB),
      totalKB: Math.round(totalKB),
      bytesKB: Math.round(totalKB * 2),   // UTF-16: o consumo real em bytes
      percentual: Math.round(percentual),
      chaves,
      maiores: maiores.slice(0, 5),
      cabeMais,                            // true = ainda dá para gravar
      nivel
    };
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
    // Ordenação padrão cronológica (mais recente para o mais antigo) em todas as bases operacionais
    if (Array.isArray(this.data.ocorrencias_devolucao)) {
      this.data.ocorrencias_devolucao.sort((a, b) => new Date(b.criado_em || b.data_abertura || b.data || 0) - new Date(a.criado_em || a.data_abertura || a.data || 0));
    }
    if (Array.isArray(this.data.ocorrencias_rota)) {
      this.data.ocorrencias_rota.sort((a, b) => new Date(b.data_chamado || b.criado_em || b.data || 0) - new Date(a.data_chamado || a.criado_em || a.data || 0));
    }
    if (Array.isArray(this.data.controle_viagens)) {
      this.data.controle_viagens.sort((a, b) => new Date(b.data_saida || b.data_viagem || b.data || b.criado_em || 0) - new Date(a.data_saida || a.data_viagem || a.data || a.criado_em || 0));
    }
    if (Array.isArray(this.data.ocorrencias_viagens)) {
      this.data.ocorrencias_viagens.sort((a, b) => new Date(b.data || b.criado_em || 0) - new Date(a.data || a.criado_em || 0));
    }
    if (Array.isArray(this.data.trocas_veiculos)) {
      this.data.trocas_veiculos.sort((a, b) => new Date(b.data || b.data_troca || b.criado_em || 0) - new Date(a.data || a.data_troca || a.criado_em || 0));
    }
    if (Array.isArray(this.data.reentregas)) {
      this.data.reentregas.sort((a, b) => new Date(b.data || b.criado_em || 0) - new Date(a.data || a.criado_em || 0));
    }
    if (Array.isArray(this.data.retencoes_frota)) {
      this.data.retencoes_frota.sort((a, b) => new Date(b.criado_em || b.data_parada || 0) - new Date(a.criado_em || a.data_parada || 0));
    }
  }

  resetData() {
    try {
      this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
      this.saveStaticCatalog();
      this.save();
    } catch(e) {
      console.warn("Erro ao resetar no localStorage, usando INITIAL_DATA em memória:", e);
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
      if (user.ativo === false) {
        return { success: false, message: 'Usuário desativado. Contate o administrador.' };
      }
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
      id: this.gerarIdUnico(),
      nome: nome.toUpperCase().trim(),
      email: email.toLowerCase().trim(),
      senha_hash: sha256Sync(senha),
      role: role || 'SAC',
      departamento: departamento || 'SAC',
      cargo: cargo || '',
      ativo: true,
      criado_em: agoraIsoBrasilia()
    };
    this.data.usuarios.push(newUser);
    const salvou = this.save();
    if (!salvou) {
      // O usuário continua disponível em memória para a sessão atual, mas
      // avisamos que a gravação em disco falhou — sem isso, o cadastro
      // "some" silenciosamente na próxima vez que o app for aberto
      // (achado da auditoria de 17/08/2026, item 0.1).
      return {
        success: false,
        user: newUser,
        message: 'Não foi possível salvar os dados neste dispositivo mesmo após liberar espaço automaticamente. O cadastro pode não persistir ao fechar o navegador — tente novamente ou use outro dispositivo/navegador.'
      };
    }
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
    dev.data_acao_gestor = agoraIsoBrasilia();
    dev.gestor_id = this.currentUser ? this.currentUser.id : null;

    if (dados.desconto_produtividade_gestor) {
      if (!this.data.auditoria_produtividade) this.data.auditoria_produtividade = [];
      this.data.auditoria_produtividade.push({
        id: this.gerarIdUnico(),
        ocorrencia_devolucao_id: id,
        protocolo: dev.numero_protocolo,
        // As colunas no Supabase são separador_nome/conferente_nome (ver
        // schema.sql seção 16) — "separador"/"conferente" não existem e
        // derrubavam o envio inteiro desta tabela, silenciosamente, toda
        // vez que um gestor aplicava desconto de produtividade (achado de
        // 21/08/2026, auditoria de nomes de campo local x coluna real).
        separador_nome: dados.separador_apurado,
        conferente_nome: dados.conferente_apurado,
        tipo_erro: dev.tipo_erro,
        motivo_causa_raiz: dev.motivo_real_causa_raiz,
        acao_gestor: dados.acao_gestor,
        valor_prejuizo: dev.valor_reclamado,
        gestor_id: this.currentUser ? this.currentUser.id : null,
        registrado_em: agoraIsoBrasilia()
      });
    }
    this.save();
  }

  // SAC Devoluções Methods
  getDevolucoes() {
    return (this.data.ocorrencias_devolucao || []).filter(d => !d.is_deleted).map(d => {
      // this.data.X podia ficar undefined depois de um pull da nuvem (o
      // syncCloudToLocal só reatribui a chave quando detecta mudança —
      // numa primeira sincronização "sem mudança" a chave nunca era
      // criada, já que clientes/produtos vivem fora do jr_sac_db). Isso
      // quebrava a tela inteira do SAC com "Cannot read properties of
      // undefined" (achado de 20/08/2026). Blindando com fallback.
      const cargasArr = this.data.cargas || [];
      const veiculosArr = this.data.veiculos || [];
      const motoristasArr = this.data.motoristas || [];
      const ajudantesArr = this.data.ajudantes || [];
      const clientesArr = this.data.clientes || [];
      const usuariosArr = this.data.usuarios || [];
      const setoresArr = this.data.setores || [];

      const carga = cargasArr.find(c => c.id == d.carga_id) || {};
      const veiculoDirect = veiculosArr.find(v => v.id == d.veiculo_id);
      const veiculoCarga = veiculosArr.find(v => v.id == carga.veiculo_id);
      const veiculo = veiculoDirect || veiculoCarga || {};

      const motorista = motoristasArr.find(m => m.id == (carga.motorista_id || d.motorista_id)) || {};
      const ajudante = ajudantesArr.find(a => a.id == carga.ajudante_id) || {};
      const cliente = clientesArr.find(cli => cli.id == d.cliente_id) || {};
      
      const itens = (this.data.itens_devolucao || []).filter(i => i.ocorrencia_devolucao_id == d.id).map(i => {
        const prod = (this.data.produtos || []).find(p => p.id == i.produto_id || String(p.codigo_produto) === String(i.produto_id)) || {};
        let valorUnit = (i.valor_unitario !== undefined && i.valor_unitario !== null && i.valor_unitario !== '') ? parseFloat(i.valor_unitario) : 0;
        if ((!valorUnit || isNaN(valorUnit)) && prod) {
          valorUnit = parseFloat(prod.valor_unitario_padrao || prod.preco || prod.valor || 0) || 0;
        }
        const qtd = parseFloat(i.quantidade) || 1;
        const valorTotal = qtd * valorUnit;
        return {
          ...i,
          valor_unitario: valorUnit,
          produto_codigo: prod.codigo_produto || i.codigo || String(i.produto_id || ''),
          produto_descricao: prod.descricao || i.descricao || 'Produto não encontrado',
          valor_total: valorTotal
        };
      });
      // Mesmo achado de 20/08/2026 (comentário acima): usuarios/setores
      // ficaram de fora daquele fix e continuavam quebrando a tela com
      // "Cannot read properties of undefined" quando ficavam undefined
      // após um pull (achado de 21/08/2026, testando o preview de teste).
      const separador = usuariosArr.find(u => u.id == d.separador_id) || {};
      const conferente = usuariosArr.find(u => u.id == d.conferente_id) || {};
      const setor = setoresArr.find(s => s.id == d.setor_encaminhado_id) || {};

      return {
        ...d,
        carga_numero: carga.numero_carga || d.carga_numero || 'N/A',
        carga_rota: carga.rota || carga.rota_nome || d.rota_nome || 'N/A',
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
    }).sort((a, b) => new Date(b.criado_em || b.data_abertura || b.data || 0) - new Date(a.criado_em || a.data_abertura || a.data || 0));
  }

  addDevolucao(devolucaoData, itens) {
    // gerarIdUnico() em vez de Date.now() puro — mesmo motivo de
    // addOcorrenciaRota: estes dois eram os pontos que a centralização de
    // 20/08 não pegou. Dois aparelhos abrindo uma devolução no mesmo
    // milissegundo geravam o mesmo id, e o merge-duplicates fazia um
    // sobrescrever o outro sem erro nenhum.
    const id = this.gerarIdUnico();
    const numero_protocolo = this.getNextSequenceNumber('ocorrencias_devolucao', 'numero_protocolo', 'DEV-2026-', 3);
    const numero_devolucao = this.getNextSequenceNumber('ocorrencias_devolucao', 'numero_devolucao', 'DEV-', 3);
    
    // Busca ou cria carga
    let cargaObj = this.data.cargas.find(c => c.numero_carga === String(devolucaoData.carga_numero));
    
    if (!cargaObj && devolucaoData.carga_numero) {
      const newCargaId = Date.now() + 1;
      cargaObj = {
        id: newCargaId,
        numero_carga: String(devolucaoData.carga_numero),
        // A coluna no Supabase se chama "rota", não "rota_nome" (achado de
        // 21/08/2026: toda devolução aberta contra uma carga que ainda não
        // existia na nuvem criava esse objeto com "rota_nome", e o envio
        // inteiro da tabela cargas falhava com "Could not find the
        // 'rota_nome' column" — e como ocorrencias_devolucao.carga_id
        // referencia cargas.id, a devolução também nunca chegava na nuvem,
        // silenciosamente, mesmo com a gravação local funcionando normal).
        rota: devolucaoData.rota_nome || 'Rota Não Cadastrada',
        motorista_id: parseInt(devolucaoData.motorista_id) || null,
        ajudante_id: parseInt(devolucaoData.ajudante_id) || null,
        veiculo_id: parseInt(devolucaoData.veiculo_id) || null,
        data_saida: hojeIsoBrasilia()
      };
      this.data.cargas.push(cargaObj);
    } else if (cargaObj) {
      // Atualiza dados da carga se vieram no form
      if (devolucaoData.rota_nome) cargaObj.rota = devolucaoData.rota_nome;
      if (devolucaoData.motorista_id) cargaObj.motorista_id = parseInt(devolucaoData.motorista_id);
      if (devolucaoData.ajudante_id) cargaObj.ajudante_id = parseInt(devolucaoData.ajudante_id);
      if (devolucaoData.veiculo_id) cargaObj.veiculo_id = parseInt(devolucaoData.veiculo_id);
    }

    const newDev = {
      id,
      numero_protocolo,
      numero_devolucao,
      carga_id: cargaObj ? cargaObj.id : null,
      carga_numero: String(devolucaoData.carga_numero || '').toUpperCase().trim(),
      veiculo_id: parseInt(devolucaoData.veiculo_id) || (cargaObj ? cargaObj.veiculo_id : null),
      veiculo_placa: String(devolucaoData.veiculo_placa || '').toUpperCase().trim(),
      rota_nome: String(devolucaoData.rota_nome || '').toUpperCase().trim(),
      motorista_id: parseInt(devolucaoData.motorista_id) || null,
      cliente_id: parseInt(devolucaoData.cliente_id) || null,
      cliente_nome: String(devolucaoData.cliente_nome || '').toUpperCase().trim(),
      nota_fiscal: String(devolucaoData.nota_fiscal || '').toUpperCase().trim(),
      motivo_reclamado: String(devolucaoData.motivo_reclamado || '').toUpperCase().trim(),
      valor_reclamado: parseFloat(devolucaoData.valor_reclamado) || 0,
      detalhamento_texto: String(devolucaoData.detalhamento_texto || '').toUpperCase().trim(),
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
      forma_acerto: String(devolucaoData.forma_acerto || '').toUpperCase().trim(),
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
      observacao_sem_itens: String(devolucaoData.observacao_sem_itens || '').toUpperCase().trim(),
      criado_por_usuario_id: this.currentUser ? this.currentUser.id : 1,
      criado_em: agoraIsoBrasilia()
    };

    this.data.ocorrencias_devolucao.unshift(newDev);

    // Salvar itens da devolução
    if (itens && itens.length > 0) {
      itens.forEach(item => {
        if (!this.data.itens_devolucao) this.data.itens_devolucao = [];
        this.data.itens_devolucao.push({
          id: this.gerarIdUnico(),
          ocorrencia_devolucao_id: id,
          produto_id: parseInt(item.produto_id),
          quantidade: parseInt(item.quantidade),
          valor_unitario: parseFloat(item.valor_unitario),
          motivo_item: String(item.motivo_item || '').toUpperCase().trim()
        });
      });
    }

    this.save();
    return newDev;
  }

  updateInvestigacao(id, updateData) {
    const dev = this.data.ocorrencias_devolucao.find(d => d.id == id);
    if (dev) {
      dev.motivo_real_causa_raiz = String(updateData.motivo_real_causa_raiz || '').toUpperCase().trim();
      dev.tipo_erro = String(updateData.tipo_erro || '').toUpperCase().trim();
      dev.tipo_erro_outro = String(updateData.tipo_erro_outro || '').toUpperCase().trim();
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
      dev.atualizado_em = agoraIsoBrasilia();
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
          id: this.gerarIdUnico(),
          usuario_id: parseInt(updateData.separador_id),
          setor_id: 2,
          ocorrencia_devolucao_id: id,
          tipo_falha: updateData.tipo_erro || updateData.motivo_real_causa_raiz,
          valor_prejuizo: dev.valor_reclamado,
          pontos_desconto: 10,
          observacoes: updateData.acao_tomada,
          registrado_em: agoraIsoBrasilia()
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
      dev.data_entrada_cd = agoraIsoBrasilia();

      if (Array.isArray(itensDestinos) && itensDestinos.length > 0) {
        itensDestinos.forEach(idst => {
          const item = (this.data.itens_devolucao || []).find(i => i.id == idst.item_id);
          if (item) {
            item.destino_item = idst.destino || destino_cd;
            // null, não '' (22/08/2026): a coluna data_validade nasce na
            // migration_26 como VARCHAR justamente porque este campo vinha
            // com string vazia para AVARIA_DESCARTE e RENEGOCIADO_ROTA, onde
            // a tela dispensa a data. Gravando null, o campo passa a poder
            // ser apertado para DATE numa próxima rodada, sem travar nada.
            item.data_validade = idst.data_validade || null;
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
      item.data_negociacao = agoraIsoBrasilia();
      this.save();
      return true;
    }
    return false;
  }

  // Ocorrências de Rota
  getOcorrenciasRota() {
    return (this.data.ocorrencias_rota || []).filter(r => !r.is_deleted).map(r => {
      const carga = (this.data.cargas || []).find(c => c.id == r.carga_id) || {};
      const veiculo = (this.data.veiculos || []).find(v => v.id == r.veiculo_id) || {};
      const motorista = (this.data.motoristas || []).find(m => m.id == r.motorista_id) || {};
      const mecanico = (this.data.usuarios || []).find(u => u.id == r.mecanico_responsavel_id) || {};

      return {
        ...r,
        localizacao: r.localizacao || '',
        status_chamado: r.status_chamado || ((r.status === 'RESOLVIDO' || r.status_veiculo === 'Em Rota') ? 'finalizado' : 'pendente'),
        retorno_manutencao_descricao: r.retorno_manutencao_descricao || '',
        retorno_manutencao_data: r.retorno_manutencao_data || null,
        retorno_manutencao_responsavel: r.retorno_manutencao_responsavel || (mecanico.nome || null),
        carga_numero: carga.numero_carga || r.carga_numero || 'N/A',
        carga_rota: carga.rota || carga.rota_nome || r.rota_nome || 'N/A',
        veiculo_placa: veiculo.placa || r.veiculo_placa || 'N/A',
        veiculo_modelo: veiculo.tipo || veiculo.modelo || 'N/A',
        motorista_nome: motorista.nome || r.motorista_nome || 'N/A',
        mecanico_nome: mecanico.nome || r.retorno_manutencao_responsavel || 'Em atendimento'
      };
    }).sort((a, b) => new Date(b.data_chamado || b.criado_em || b.data || 0) - new Date(a.data_chamado || a.criado_em || a.data || 0));
  }

  // Achado de 22/08/2026, rodando o sync de verdade: NENHUMA ocorrência de
  // rota criada pela tela jamais chegou ao banco. O CHECK
  // ocorrencias_rota_tipo_ocorrencia_check aceita '', MECANICA, OPERACIONAL,
  // CONDUTA_INADEQUADA e ACIDENTE; a tela grava em tipo_ocorrencia o valor do
  // dropdown "Motivo Resumido" (AVARIA MECÂNICA, ATRASO DE LARGADA,
  // CHECKLIST, FALTA, SUBSTITUIÇÃO DE EQUIPE, CONDUTA OPERACIONAL, OUTRO).
  // Interseção entre as duas listas: zero. Todo POST caía com 23514, e como
  // o POST do PostgREST é uma transação só, derrubava o lote inteiro.
  //
  // É a MESMA doença dos 247 fantasmas: duas linguagens na mesma coluna,
  // uma delas gravada por engano. Por isso o conserto não é alargar o CHECK
  // (isso perpetuaria o problema) — é normalizar na escrita, aqui.
  //
  // Fica na store, e não na tela, pelo mesmo motivo da guarda de escrita do
  // cloudStore: o problema não é uma tela, é qualquer caminho que grave
  // este campo. Duas telas usam hoje; uma terceira que apareça amanhã já
  // nasce coberta. `motivo_resumido` continua guardando o texto original,
  // que é o que a interface toda lê (`r.motivo_resumido || r.tipo_ocorrencia`).
  _tipoOcorrenciaDoMotivo(valor) {
    const v = String(valor || '').toUpperCase().trim();
    if (!v) return '';
    // Já está no vocabulário do banco? Passa direto.
    if (['MECANICA', 'OPERACIONAL', 'CONDUTA_INADEQUADA', 'ACIDENTE'].indexOf(v) !== -1) return v;
    if (v.indexOf('ACIDENTE') !== -1 || v.indexOf('SINISTRO') !== -1) return 'ACIDENTE';
    if (v.indexOf('CONDUTA') !== -1) return 'CONDUTA_INADEQUADA';
    if (v.indexOf('MEC') !== -1 || v.indexOf('AVARIA') !== -1) return 'MECANICA';
    // A lista de motivos é editável (db.data.motivos_ocorrencia), então um
    // motivo novo cadastrado amanhã não pode voltar a travar a tabela.
    // Qualquer coisa que não se encaixe cai em OPERACIONAL, que é válido —
    // e o texto exato sobrevive intacto em motivo_resumido.
    return 'OPERACIONAL';
  }

  addOcorrenciaRota(rotaData) {
    // gerarIdUnico() em vez de Date.now() puro: este era um dos dois pontos
    // que a centralização de 20/08 não pegou (o outro é addDevolucao). Sem o
    // carimbo do aparelho, dois PCs criando um chamado no mesmo milissegundo
    // geram o mesmo id — e como o envio usa resolution=merge-duplicates, um
    // sobrescreve o outro em silêncio, sem erro nenhum. É o item 9 da Onda 2,
    // que passou perto desta linha sem cobri-la.
    const id = this.gerarIdUnico();
    const numero_protocolo = this.getNextSequenceNumber('ocorrencias_rota', 'numero_protocolo', 'ROT-2026-', 3);
    const statusVeic = rotaData.status_veiculo || 'Aguardando Manutenção';
    const isEmRota = statusVeic === 'Em Rota';

    const newRota = {
      id,
      numero_protocolo,
      carga_id: parseInt(rotaData.carga_id) || null,
      carga_numero: rotaData.carga_numero || '',
      veiculo_id: parseInt(rotaData.veiculo_id) || null,
      veiculo_placa: (rotaData.veiculo_placa || '').toUpperCase().trim(),
      motorista_id: parseInt(rotaData.motorista_id) || null,
      motorista_nome: rotaData.motorista_nome || '',
      rota_nome: rotaData.rota_nome || '',
      tipo_ocorrencia: this._tipoOcorrenciaDoMotivo(rotaData.tipo_ocorrencia || rotaData.motivo_resumido || 'MECANICA'),
      motivo_resumido: rotaData.motivo_resumido || rotaData.tipo_ocorrencia || 'AVARIA MECÂNICA',
      localizacao: (rotaData.localizacao || '').trim(),
      descricao: rotaData.descricao || '',
      midia_fotos: Array.isArray(rotaData.midia_fotos) ? rotaData.midia_fotos : [],
      midia_videos: Array.isArray(rotaData.midia_videos) ? rotaData.midia_videos : [],
      status_veiculo: statusVeic,
      status: isEmRota ? 'RESOLVIDO' : 'ABERTO',
      status_chamado: isEmRota ? 'finalizado' : 'pendente',
      veiculo_parado: !isEmRota,
      mecanico_responsavel_id: null,
      acao_mecanico: '',
      pecas_trocadas: '',
      guincho_acionado: false,
      custo_socorro: 0,
      retorno_manutencao_descricao: '',
      retorno_manutencao_data: null,
      retorno_manutencao_responsavel: null,
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia(),
      resolvido_em: isEmRota ? agoraIsoBrasilia() : null,
      is_deleted: false
    };

    this.data.ocorrencias_rota.unshift(newRota);
    this.logAudit({
      acao: 'CRIACAO_CHAMADO_ROTA',
      modulo: 'ocorrencias_rota',
      registro_id: newRota.id,
      diff: { depois: newRota }
    });
    this.save();
    return newRota;
  }

  updateOcorrenciaRota(id, updateData) {
    const r = this.data.ocorrencias_rota.find(x => x.id == id);
    if (r) {
      const antes = JSON.parse(JSON.stringify(r));

      // Governança: Cria snapshot da versão anterior para rollback antes de aplicar as mudanças
      this.saveVersion('ocorrencias_rota', antes);

      if (updateData.carga_numero !== undefined) r.carga_numero = updateData.carga_numero;
      if (updateData.carga_id !== undefined) r.carga_id = parseInt(updateData.carga_id) || r.carga_id;
      if (updateData.veiculo_id !== undefined) r.veiculo_id = parseInt(updateData.veiculo_id) || r.veiculo_id;
      if (updateData.veiculo_placa !== undefined) r.veiculo_placa = (updateData.veiculo_placa || '').toUpperCase().trim();
      if (updateData.motorista_id !== undefined) r.motorista_id = parseInt(updateData.motorista_id) || r.motorista_id;
      if (updateData.motorista_nome !== undefined) r.motorista_nome = updateData.motorista_nome;
      if (updateData.rota_nome !== undefined) r.rota_nome = updateData.rota_nome;
      if (updateData.tipo_ocorrencia !== undefined) r.tipo_ocorrencia = this._tipoOcorrenciaDoMotivo(updateData.tipo_ocorrencia);
      if (updateData.motivo_resumido !== undefined) r.motivo_resumido = updateData.motivo_resumido;
      if (updateData.descricao !== undefined) r.descricao = updateData.descricao;
      if (updateData.midia_fotos !== undefined && Array.isArray(updateData.midia_fotos)) r.midia_fotos = updateData.midia_fotos;
      if (updateData.midia_videos !== undefined && Array.isArray(updateData.midia_videos)) r.midia_videos = updateData.midia_videos;

      if (updateData.localizacao !== undefined) {
        r.localizacao = updateData.localizacao;
      }
      if (updateData.status_veiculo) {
        r.status_veiculo = updateData.status_veiculo;
      }

      const isFinalizacao = updateData.status_chamado === 'finalizado' || 
                            updateData.status === 'RESOLVIDO' || 
                            r.status_veiculo === 'Em Rota';

      if (isFinalizacao) {
        r.status = 'RESOLVIDO';
        r.status_chamado = 'finalizado';
        r.status_veiculo = 'Em Rota';
        r.veiculo_parado = false;
        if (!r.resolvido_em) r.resolvido_em = agoraIsoBrasilia();
        r.retorno_manutencao_data = updateData.retorno_manutencao_data || r.retorno_manutencao_data || agoraIsoBrasilia();
        r.retorno_manutencao_responsavel = updateData.retorno_manutencao_responsavel || (this.currentUser ? this.currentUser.nome : 'MANUTENÇÃO');
      } else {
        r.status = updateData.status || r.status || 'EM_ATENDIMENTO';
        r.status_chamado = updateData.status_chamado || r.status_chamado || 'pendente';
        r.veiculo_parado = true;
      }

      if (updateData.retorno_manutencao_descricao !== undefined) {
        r.retorno_manutencao_descricao = updateData.retorno_manutencao_descricao;
      }
      if (updateData.retorno_manutencao_responsavel !== undefined) {
        r.retorno_manutencao_responsavel = updateData.retorno_manutencao_responsavel;
      }
      if (updateData.retorno_manutencao_data !== undefined) {
        r.retorno_manutencao_data = updateData.retorno_manutencao_data;
      }

      r.mecanico_responsavel_id = this.currentUser ? this.currentUser.id : (r.mecanico_responsavel_id || 4);
      if (updateData.acao_mecanico !== undefined) {
        r.acao_mecanico = updateData.acao_mecanico;
        if (!r.retorno_manutencao_descricao) {
          r.retorno_manutencao_descricao = updateData.acao_mecanico;
        }
      }
      if (updateData.pecas_trocadas !== undefined) r.pecas_trocadas = updateData.pecas_trocadas;
      if (updateData.guincho_acionado !== undefined) r.guincho_acionado = updateData.guincho_acionado === 'sim' || updateData.guincho_acionado === true;
      if (updateData.custo_socorro !== undefined) r.custo_socorro = parseFloat(updateData.custo_socorro) || 0;
      r.atualizado_em = agoraIsoBrasilia();
      r.atualizado_por = this.currentUser ? this.currentUser.nome : 'SISTEMA';

      this.logAudit({
        acao: isFinalizacao ? 'LIBERACAO_VEICULO_ROTA' : (updateData.acao_auditoria || 'EDICAO_CHAMADO_ROTA'),
        modulo: 'ocorrencias_rota',
        registro_id: id,
        diff: { antes, depois: r }
      });

      this.save();
      return r;
    }
    return null;
  }

  deleteOcorrenciaRota(id) {
    return this.softDelete('ocorrencias_rota', id);
  }

  // CRUD Cadastros Auxiliares (Dados SAC)
  addMotorista(cod_erp, nome, cnh, telefone, data_admissao, data_desligamento) {
    const item = { id: cod_erp ? parseInt(cod_erp) : Date.now(), nome: nome.toUpperCase(), cnh, telefone, data_admissao: data_admissao || null, data_desligamento: data_desligamento || null };
    if (this.data.motoristas.find(x => x.id == item.id)) {
      alert('Código ERP já cadastrado!');
      return null;
    }
    // CNH é UNIQUE no schema.sql — checagem local evita o caso mais comum
    // (digitar a mesma CNH duas vezes neste aparelho). Não cobre o caso de
    // dois aparelhos diferentes cadastrando a mesma CNH offline ao mesmo
    // tempo — esse é detectado depois, na sincronização (ver Fase 4,
    // registrarConflitoSincronizacao() e a aba "⚠️ Conflitos" em Governança).
    if (cnh && this.data.motoristas.find(x => String(x.cnh || '').toUpperCase() === String(cnh).toUpperCase())) {
      alert('CNH já cadastrada para outro motorista!');
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
    const item = { id: this.gerarIdUnico(), placa: placa.toUpperCase(), modelo: tipo, tipo: tipo.toUpperCase(), situacao: situacao || 'Ativo' };
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
      id: this.gerarIdUnico(),
      numero_carga: String(numero_carga),
      // A coluna no Supabase se chama "rota" (ver comentário em addDevolucao)
      rota: rota_nome.toUpperCase(),
      motorista_id: parseInt(motorista_id),
      ajudante_id: parseInt(ajudante_id),
      veiculo_id: parseInt(veiculo_id),
      data_saida: hojeIsoBrasilia()
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
    return (this.data.controle_viagens || [])
      .filter(x => !x.is_deleted)
      .sort((a, b) => new Date(b.data_saida || b.data_viagem || b.data || b.criado_em || 0) - new Date(a.data_saida || a.data_viagem || a.data || a.criado_em || 0));
  }

  addViagem(viagemData) {
    if (!this.data.controle_viagens) this.data.controle_viagens = [];
    // Date.now() sozinho colide quando várias viagens são importadas em
    // sequência rápida (mesmo milissegundo) — o Supabase recusa o lote
    // inteiro com "ON CONFLICT DO UPDATE command cannot affect row a
    // second time" quando há IDs repetidos, e nenhuma das viagens daquele
    // envio chega na nuvem (achado de 20/08/2026 — importação de escala
    // com várias linhas nunca sincronizava). Garante um id único checando
    // contra o que já existe no array.
    let novoId = Date.now();
    while (this.data.controle_viagens.some(v => v.id === novoId)) novoId++;
    const item = {
      id: novoId,
      carga: String(viagemData.carga || '').toUpperCase().trim(),
      rota: String(viagemData.rota || '').toUpperCase().trim(),
      placa: String(viagemData.placa || '').toUpperCase().trim(),
      motorista: String(viagemData.motorista || '').toUpperCase().trim(),
      ajudante: String(viagemData.ajudante || '').toUpperCase().trim(),
      setor: String(viagemData.setor || 'FRIO').toUpperCase().trim(),
      data_saida: viagemData.data_saida || '',
      hora_saida: viagemData.hora_saida || '',
      data_entrega: viagemData.data_entrega || '',
      hora_entrega: viagemData.hora_entrega || '',
      data_retorno: viagemData.data_retorno || '',
      hora_retorno: viagemData.hora_retorno || '',
      status_viagem: (viagemData.status_viagem !== undefined && viagemData.status_viagem !== null ? String(viagemData.status_viagem) : '').toUpperCase().trim(),
      fusion: (viagemData.fusion !== undefined && viagemData.fusion !== null ? String(viagemData.fusion) : '').toUpperCase().trim(),
      checklist_saida: (viagemData.checklist_saida !== undefined && viagemData.checklist_saida !== null ? String(viagemData.checklist_saida) : '').toUpperCase().trim(),
      checklist_chegada: (viagemData.checklist_chegada !== undefined && viagemData.checklist_chegada !== null ? String(viagemData.checklist_chegada) : '').toUpperCase().trim(),
      observacao: String(viagemData.observacao || '').toUpperCase().trim()
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
    // Era exclusão física (removia do array) — a exclusão nunca chegava na
    // nuvem (upsert só insere/atualiza, nunca remove), e o próximo pull
    // trazia a viagem "apagada" de volta (achado de 20/08/2026). Agora é
    // soft delete: getControleViagens() já filtra is_deleted, e a mudança
    // de flag sincroniza normalmente como qualquer outra edição.
    if (this.data.controle_viagens) {
      const item = this.data.controle_viagens.find(x => x.id == id);
      if (item) {
        item.is_deleted = true;
        item.deleted_at = agoraIsoBrasilia();
        item.deleted_by_nome = this.currentUser ? this.currentUser.nome : 'SISTEMA';
        this.save();
      }
    }
  }

  // ===== CRUD OCORRÊNCIAS OPERACIONAIS DE VIAGEM =====
  getOcorrenciasViagens() {
    return (this.data.ocorrencias_viagens || [])
      .filter(x => !x.is_deleted)
      .sort((a, b) => new Date(b.data || b.criado_em || 0) - new Date(a.data || a.criado_em || 0));
  }

  addOcorrenciaViagem(ocData) {
    if (!this.data.ocorrencias_viagens) this.data.ocorrencias_viagens = [];
    const item = {
      id: this.gerarIdUnico(),
      data: ocData.data || hojeIsoBrasilia(),
      carga: String(ocData.carga || '').toUpperCase().trim(),
      rota: String(ocData.rota || '').toUpperCase().trim(),
      placa: String(ocData.placa || '').toUpperCase().trim(),
      funcionario: String(ocData.funcionario || '').toUpperCase().trim(),
      funcao: String(ocData.funcao || 'MOTORISTA').toUpperCase().trim(),
      motivo: String(ocData.motivo || 'OUTRO').toUpperCase().trim(),
      causa: String(ocData.causa || '').toUpperCase().trim(),
      ocorrencia: String(ocData.ocorrencia || '').toUpperCase().trim(),
      acao: String(ocData.acao || '').toUpperCase().trim()
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
    // Mesmo motivo de deleteViagem: soft delete para a exclusão sincronizar
    // com a nuvem em vez de ser desfeita no próximo pull.
    if (this.data.ocorrencias_viagens) {
      const item = this.data.ocorrencias_viagens.find(x => x.id == id);
      if (item) {
        item.is_deleted = true;
        item.deleted_at = agoraIsoBrasilia();
        item.deleted_by_nome = this.currentUser ? this.currentUser.nome : 'SISTEMA';
        this.save();
      }
    }
  }

  importViagens(novasViagens) {
    if (!this.data.controle_viagens) this.data.controle_viagens = [];
    let importCount = 0;
    let duplicadosCount = 0;

    // ITEM 10 (Onda 2, 22/08/2026) — duas correções na checagem de
    // duplicidade, e as duas vieram de dado medido na ETAPA 0.
    //
    // (a) A CHAVE ERA LARGA DEMAIS. Era
    //     carga|rota|placa|motorista|ajudante|setor — bastava a escala vir
    //     com o motorista trocado para a MESMA carga entrar de novo como
    //     "nova". A ETAPA 0 achou 15 cargas repetidas até 4 vezes, a última
    //     rodada às 01:18 de 22/08, depois do go-live. Decisão 1: uma carga,
    //     uma viagem, sem exceção — inclusive transbordo, que é um caminhão
    //     só. A chave passa a ser a carga, igual ao índice único que a
    //     migration_25 cria no banco. Se as duas regras não forem a mesma, a
    //     importação passa aqui e é recusada lá, em bloco.
    //
    // (b) EXCLUÍDAS CONTAVAM COMO EXISTENTES. Uma viagem lançada errada e
    //     excluída bloqueava a reimportação daquela carga para sempre, sem
    //     dizer por quê. Agora só as vivas contam.
    const norm = s => String(s || '').trim().toUpperCase();
    const getKey = v => norm(v.carga);

    const existingKeys = new Set(
      this.data.controle_viagens.filter(v => !v.is_deleted).map(v => getKey(v))
    );

    novasViagens.forEach(v => {
      if (v.carga) {
        const key = getKey(v);
        if (existingKeys.has(key)) {
          duplicadosCount++;
        } else {
          this.addViagem(v);
          existingKeys.add(key);
          importCount++;
        }
      }
    });

    this.save();
    return { importados: importCount, duplicados: duplicadosCount };
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
      id: this.gerarIdUnico(),
      data: data || hojeIsoBrasilia(),
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
    resumoData.atualizado_em = agoraIsoBrasilia();
    if (idx >= 0) {
      this.data.resumo_diario_cd[idx] = resumoData;
    } else {
      this.data.resumo_diario_cd.push(resumoData);
    }
    this.save();
    return resumoData;
  }

  getResumosDiariosCD() {
    const list = Array.isArray(this.data.resumo_diario_cd)
      ? this.data.resumo_diario_cd
      : Object.values(this.data.resumo_diario_cd || this.data.resumos_cd || {});
    return list.filter(r => r && !r.is_deleted).sort((a, b) => new Date(b.data || b.criado_em || 0) - new Date(a.data || a.criado_em || 0));
  }

  // ===== CRUD TROCAS DE VEÍCULOS =====
  getTrocasVeiculos() {
    return (this.data.trocas_veiculos || [])
      .filter(x => !x.is_deleted)
      .sort((a, b) => new Date(b.data || b.data_troca || b.criado_em || 0) - new Date(a.data || a.data_troca || a.criado_em || 0));
  }

  addTrocaVeiculo(trocaData) {
    if (!this.data.trocas_veiculos) this.data.trocas_veiculos = [];
    const item = {
      id: this.gerarIdUnico(),
      data: trocaData.data || hojeIsoBrasilia(),
      veiculo_escalado: String(trocaData.veiculo_escalado || '').toUpperCase().trim(),
      veiculo_trocado: String(trocaData.veiculo_trocado || '').toUpperCase().trim(),
      motivo_resumido: String(trocaData.motivo_resumido || 'PESO EXCEDIDO').toUpperCase().trim(),
      motivo_outro: String(trocaData.motivo_outro || '').toUpperCase().trim(),
      detalhamento: String(trocaData.detalhamento || '').toUpperCase().trim(),
      autorizado_por: String(trocaData.autorizado_por || '').toUpperCase().trim(),
      criado_em: agoraIsoBrasilia()
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
    // Mesmo motivo de deleteViagem: soft delete para a exclusão sincronizar
    // com a nuvem em vez de ser desfeita no próximo pull.
    if (this.data.trocas_veiculos) {
      const item = this.data.trocas_veiculos.find(x => x.id == id);
      if (item) {
        item.is_deleted = true;
        item.deleted_at = agoraIsoBrasilia();
        item.deleted_by_nome = this.currentUser ? this.currentUser.nome : 'SISTEMA';
        this.save();
      }
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
          data_admissao: colabData.data_admissao !== undefined ? colabData.data_admissao : (item.data_admissao || null),
          data_desligamento: colabData.data_desligamento !== undefined ? colabData.data_desligamento : (item.data_desligamento || null),
          ativo: colabData.ativo !== undefined ? Boolean(colabData.ativo) : true
        });
      }
    }
    if (!item) {
      item = {
        id: this.gerarIdUnico(),
        chapa: colabData.chapa || '',
        nome: String(colabData.nome || '').trim().toUpperCase(),
        secao: String(colabData.secao || 'CARREGAMENTO FRIOS - 1 TURNO').trim().toUpperCase(),
        funcao: String(colabData.funcao || 'SEPARADOR').trim().toUpperCase(),
        cpf: String(colabData.cpf || '').trim(),
        data_admissao: colabData.data_admissao || null,
        data_desligamento: colabData.data_desligamento || null,
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
    // (achado em 20/08/2026) faltava filtrar is_deleted — motorista excluído
    // continuava aparecendo em exportação/CSV/Power BI indefinidamente.
    return (this.data.motoristas || []).filter(x => !x.is_deleted);
  }

  getVeiculos() {
    return (this.data.veiculos || []).filter(x => !x.is_deleted);
  }

  getClientes() {
    return (this.data.clientes || []).filter(x => !x.is_deleted);
  }

  addCliente(clienteData) {
    if (!this.data.clientes) this.data.clientes = [];
    // As colunas reais no Supabase são codigo_cliente/razao_social/cnpj
    // (ver database/schema.sql) — este método gravava codigo/nome/cnpj_cpf,
    // que nunca existiram como coluna. Nem "criado_em" existe nesta tabela.
    // Isso não só quebrava a sincronização (PGRST204, achado de
    // 21/08/2026) como já deixava o cliente com nome "N/A" mesmo
    // localmente em qualquer tela que lê codigo_cliente/razao_social (ex:
    // getDevolucoes) — os nomes de campo aqui nunca bateram com o resto
    // do app.
    const item = {
      id: this.gerarIdUnico(),
      codigo_cliente: clienteData.codigo || clienteData.codigo_cliente || `CLI-${Date.now().toString().slice(-4)}`,
      razao_social: String(clienteData.nome || clienteData.razao_social || '').trim().toUpperCase(),
      cidade: clienteData.cidade || '',
      uf: clienteData.uf || 'GO',
      // cnpj é VARCHAR(20) — gerarIdUnico() tem até 16 dígitos, não cabe
      // com prefixo. Date.now() sozinho (13 dígitos) cabe com sobra.
      cnpj: clienteData.cnpj_cpf || clienteData.cnpj || `SN${Date.now()}`
    };
    if (!item.razao_social) return null;
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
    item.deleted_at = agoraIsoBrasilia();
    // achado em 20/08/2026: gravava um objeto aninhado deleted_by:{id,nome},
    // mas nenhuma tabela do schema.sql tem essa coluna — só as flat
    // deleted_by_usuario_id/deleted_by_nome (seção 10.1). cloudStore.upsert()
    // manda o registro inteiro sem filtrar colunas, então o PostgREST
    // rejeitava o upsert inteiro (coluna desconhecida) e toda exclusão lógica
    // feita por softDelete() — motoristas, veículos, clientes, produtos,
    // colaboradores_cd, ocorrencias_rota — nunca chegava na nuvem.
    item.deleted_by_usuario_id = this.currentUser ? this.currentUser.id : null;
    item.deleted_by_nome = this.currentUser ? this.currentUser.nome : 'SISTEMA';

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
    // achado em 20/08/2026: restored_at/restored_by não existem em nenhuma
    // tabela do schema.sql — mesmo bug de softDelete() (coluna desconhecida
    // derruba o upsert inteiro). Quem restaurou e quando já fica registrado
    // corretamente no logAudit() abaixo (tabela audit_logs, colunas reais).
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

  // ===== CONFLITOS DE SINCRONIZAÇÃO (Fase 4, 20/08/2026) =====
  // motoristas.cnh e usuarios.email são UNIQUE no schema.sql. Quando dois
  // aparelhos offline cadastram, cada um sem saber do outro, um registro
  // com o mesmo CNH/e-mail (mas ids diferentes, gerados localmente), o
  // upsert em lote do cloudStore falha inteiro nesse ciclo de sync com
  // violação de unicidade (23505) — e como o lote reenvia a tabela inteira
  // a cada 30s, NENHUM motorista/usuário daquele aparelho sincroniza,
  // silenciosamente, até alguém perceber e corrigir manualmente. Decisão
  // do usuário (20/08/2026): não sobrescrever automaticamente — avisar e
  // deixar um gestor revisar. cloudStore.js chama registrarConflitoSincronizacao()
  // quando detecta o 23505, e limparConflitosDaTabela() quando a tabela
  // volta a sincronizar com sucesso (indício de que foi corrigido).
  registrarConflitoSincronizacao({ tabela, campo, valor }) {
    if (!tabela || !campo || valor === undefined || valor === null || valor === '') return;
    if (!Array.isArray(this.data.conflitos_pendentes)) this.data.conflitos_pendentes = [];
    const existente = this.data.conflitos_pendentes.find(c =>
      c.tabela === tabela && c.campo === campo && String(c.valor).toLowerCase() === String(valor).toLowerCase() && !c.resolvido
    );
    if (existente) {
      existente.detectado_em = agoraIsoBrasilia();
      existente.ocorrencias = (existente.ocorrencias || 1) + 1;
    } else {
      const registrosLocais = (this.data[tabela] || [])
        .filter(r => String(r[campo] || '').toLowerCase() === String(valor).toLowerCase())
        .map(r => ({ id: r.id, nome: r.nome || r.email || `ID #${r.id}` }));
      this.data.conflitos_pendentes.push({
        id: this.gerarIdUnico(),
        tabela,
        campo,
        valor,
        registros_locais: registrosLocais,
        detectado_em: agoraIsoBrasilia(),
        ocorrencias: 1,
        resolvido: false
      });
    }
    this.save();
  }

  limparConflitosDaTabela(tabela) {
    if (!Array.isArray(this.data.conflitos_pendentes)) return;
    const antes = this.data.conflitos_pendentes.length;
    this.data.conflitos_pendentes = this.data.conflitos_pendentes.filter(c => c.tabela !== tabela || c.resolvido);
    if (this.data.conflitos_pendentes.length !== antes) this.save();
  }

  resolverConflito(id) {
    if (!Array.isArray(this.data.conflitos_pendentes)) return false;
    const c = this.data.conflitos_pendentes.find(x => x.id == id);
    if (!c) return false;
    c.resolvido = true;
    c.resolvido_em = agoraIsoBrasilia();
    c.resolvido_por = this.currentUser ? this.currentUser.nome : 'SISTEMA';
    this.save();
    return true;
  }

  getConflitosPendentes() {
    return (this.data.conflitos_pendentes || []).filter(c => !c.resolvido);
  }

  logAudit({ acao, modulo, registro_id, diff }) {
    if (!this.data.audit_logs) this.data.audit_logs = [];
    const entry = {
      id: this.gerarIdUnico(),
      usuario_id: this.currentUser ? this.currentUser.id : 0,
      usuario_nome: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      data_hora: agoraIsoBrasilia(),
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
      id: this.gerarIdUnico(),
      collection,
      registro_id: record.id,
      versao: versaoNum,
      dados_json: JSON.parse(JSON.stringify(record)),
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia()
    });
    // Limita o histórico de versões a 1500 registros no total (este array
    // não tinha nenhum limite antes — achado da auditoria de 17/08/2026,
    // uma das causas do crescimento descontrolado do banco).
    if (this.data.registro_versoes.length > 1500) {
      this.data.registro_versoes = this.data.registro_versoes.slice(0, 1500);
    }
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
    // (achado em 20/08/2026, auditoria externa) sinistros e itens avulsos
    // são dados operacionais/de treinamento como os demais acima — só
    // faltavam aqui porque os módulos são mais novos que esta função.
    this.data.sinistros = [];
    this.data.itens_avulsos_destinacao = [];

    // Limpa chaves e caches locais isolados no localStorage
    // jr_ocorrencias_viagens e jr_itens_devolucao entraram em 22/08/2026
    // (build 4.8.2): as duas coleções eram zeradas em this.data acima, mas
    // as chaves espelhadas ficavam para trás. O envio lê jr_sac_db primeiro
    // e só cai nessas chaves como último recurso, então o furo era latente —
    // mas é exatamente depois de um reset que as duas cópias divergem, e
    // essa divergência já custou meio dia de diagnóstico hoje.
    const chavesLimpeza = [
      'jr_ocorrencias',
      'jr_ocorrencias_viagens',
      'jr_itens_devolucao',
      'jr_ocorrencias_rota',
      'jr_retencoes_frota',
      'jr_reentregas',
      'jr_trocas_veiculos',
      'jr_audit_logs',
      'jr_registro_versoes',
      'jr_cargas',
      'jr_controle_viagens',
      'jr_resumo_diario_cd',
      'jr_relatorios_divergencia',
      'jr_auditoria_produtividade',
      'jr_sinistros',
      'jr_itens_avulsos_destinacao'
    ];
    chavesLimpeza.forEach(k => {
      try { localStorage.removeItem(k); } catch(e) {}
    });

    // A FILA DE FOTOS TAMBEM (v5.1.0). Ela NAO mora no localStorage, entao
    // passaria intacta por toda a limpeza acima e sobreviveria ao reset
    // apontando para reentregas que acabaram de deixar de existir - subindo
    // um arquivo orfao para o bucket a cada ciclo de 30s, para sempre.
    // Ver limparTudo() em js/fotoStore.js.
    if (window.fotoStore) window.fotoStore.limparTudo().catch(() => {});

    this.save();

    // O reset sempre só limpou o navegador local, nunca a nuvem — rodar
    // em um aparelho não removia o que já tinha subido ao Supabase, e o
    // próximo "pull" automático trazia os dados de treinamento de volta
    // para este e para outros aparelhos (achado de 20/08/2026). Limpa a
    // nuvem também, em segundo plano, sem travar o retorno desta função.
    if (window.cloudStore && window.cloudStore.isConfigured()) {
      window.cloudStore.clearCloudTrainingData().catch(e => {
        console.warn('[Store] Falha ao limpar dados de treinamento na nuvem:', e);
      });
    }

    return { success: true, message: 'Reset executado com sucesso! Dados operacionais, logs e caches zerados (neste aparelho e na nuvem) para início da operação oficial.' };
  }

  getOcorrenciasDevolucao() {
    return this.getDevolucoes();
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
    const devList = this.getDevolucoes();
    if (devList && devList.length > 0) {
      sql += `-- 1. OCORRÊNCIAS DE DEVOLUÇÃO (SAC INTERNO)\n`;
      devList.forEach(dev => {
        sql += `INSERT INTO ocorrencias_devolucao (\n`;
        sql += `  numero_protocolo, numero_devolucao, carga_numero, cliente_nome, veiculo_placa, rota_nome,\n`;
        sql += `  motivo_reclamado, valor_reclamado, detalhamento_texto, forma_acerto, status_fechamento, criado_em\n`;
        sql += `) VALUES (\n`;
        sql += `  ${esc(dev.numero_protocolo)}, ${esc(dev.numero_devolucao)}, ${esc(dev.carga_numero)}, ${esc(dev.cliente_nome)}, ${esc(dev.veiculo_placa)}, ${esc(dev.rota_nome)},\n`;
        sql += `  ${esc(dev.motivo_reclamado)}, ${esc(dev.valor_reclamado || 0)}, ${esc(dev.detalhamento_texto)}, ${esc(dev.forma_acerto || 'ABATIMENTO')}, ${esc(dev.status_fechamento || 'PENDENTE_FISICO')}, ${esc(dev.criado_em || agoraIsoBrasilia())}\n`;
        sql += `) ON CONFLICT (numero_protocolo) DO UPDATE SET valor_reclamado = EXCLUDED.valor_reclamado, status_fechamento = EXCLUDED.status_fechamento;\n\n`;
      });
    }

    // Ocorrências em Rota
    const rotaList = this.getOcorrenciasRota();
    if (rotaList && rotaList.length > 0) {
      sql += `-- 2. OCORRÊNCIAS EM ROTA (FROTA / MANUTENÇÃO)\n`;
      rotaList.forEach(rot => {
        sql += `INSERT INTO ocorrencias_rota (\n`;
        sql += `  numero_protocolo, carga_id, veiculo_id, motorista_id, tipo_ocorrencia, localizacao, descricao, status, status_chamado, veiculo_parado, retorno_manutencao_descricao, retorno_manutencao_data, retorno_manutencao_responsavel\n`;
        sql += `) VALUES (\n`;
        sql += `  ${esc(rot.numero_protocolo)}, ${rot.carga_id || 1}, ${rot.veiculo_id || 1}, ${rot.motorista_id || 1}, ${esc(rot.tipo_ocorrencia || 'MECANICA')}, ${esc(rot.localizacao || '')}, ${esc(rot.descricao)}, ${esc(rot.status || 'ABERTO')}, ${esc(rot.status_chamado || 'pendente')}, ${esc(rot.veiculo_parado !== false)}, ${esc(rot.retorno_manutencao_descricao || '')}, ${esc(rot.retorno_manutencao_data)}, ${esc(rot.retorno_manutencao_responsavel)}\n`;
        sql += `) ON CONFLICT (numero_protocolo) DO UPDATE SET status = EXCLUDED.status, status_chamado = EXCLUDED.status_chamado, veiculo_parado = EXCLUDED.veiculo_parado, localizacao = EXCLUDED.localizacao, retorno_manutencao_descricao = EXCLUDED.retorno_manutencao_descricao, retorno_manutencao_data = EXCLUDED.retorno_manutencao_data, retorno_manutencao_responsavel = EXCLUDED.retorno_manutencao_responsavel;\n\n`;
      });
    }

    // Trocas de Veículos
    const trocasList = this.getTrocasVeiculos();
    if (trocasList && trocasList.length > 0) {
      sql += `-- 3. TROCAS DE VEÍCULOS\n`;
      trocasList.forEach(tr => {
        sql += `INSERT INTO trocas_veiculos (\n`;
        sql += `  veiculo_escalado, veiculo_trocado, motivo_resumido, motivo_outro, detalhamento, autorizado_por, criado_em\n`;
        sql += `) VALUES (\n`;
        sql += `  ${esc(tr.veiculo_escalado)}, ${esc(tr.veiculo_trocado)}, ${esc(tr.motivo_resumido)}, ${esc(tr.motivo_outro)}, ${esc(tr.detalhamento)}, ${esc(tr.autorizado_por)}, ${esc(tr.criado_em)}\n`;
        sql += `);\n\n`;
      });
    }

    // Retenções de Frota
    const retencoesList = this.getRetencoesFrota();
    if (retencoesList && retencoesList.length > 0) {
      sql += `-- 4. RETENÇÕES DE FROTA\n`;
      retencoesList.forEach(ret => {
        sql += `INSERT INTO retencoes_frota (\n`;
        sql += `  id, numero_retencao, veiculo_id, placa, tipo_veiculo, data_parada, motivo, tipo_os, local, data_previsao, data_liberacao, status, criado_por, criado_em\n`;
        sql += `) VALUES (\n`;
        sql += `  ${ret.id}, ${esc(ret.numero_retencao)}, ${ret.veiculo_id || 'NULL'}, ${esc(ret.placa)}, ${esc(ret.tipo_veiculo)}, ${esc(ret.data_parada)}, ${esc(ret.motivo)}, ${esc(ret.tipo_os || 'CORRETIVA')}, ${esc(ret.local || '')}, ${esc(ret.data_previsao)}, ${esc(ret.data_liberacao)}, ${esc(ret.status || 'RETIDO')}, ${esc(ret.criado_por || 'SISTEMA')}, ${esc(ret.criado_em)}\n`;
        sql += `) ON CONFLICT (numero_retencao) DO UPDATE SET status = EXCLUDED.status, data_liberacao = EXCLUDED.data_liberacao;\n\n`;
      });
    }

    // Reentregas de Rota
    const reentregasList = this.getReentregas();
    if (reentregasList && reentregasList.length > 0) {
      sql += `-- 5. REENTREGAS DE ROTA\n`;
      reentregasList.forEach(re => {
        sql += `INSERT INTO reentregas_rota (\n`;
        sql += `  id, data, carga_numero, rota_nome, motorista_nome, entregas_saiu, entregas_feitas, entregas_reentrega, motivo, placa, novo_motorista, status, criado_por, criado_em,\n`;
        sql += `  recebido_cd_em, recebido_cd_por, qtd_recebida_cd, condicao_recebimento, observacao_recebimento, local_armazenagem,\n`;
        sql += `  despachado_em, despachado_por, despacho_placa, despacho_carga_numero, qtd_despachada, realizada_em,\n`;
        sql += `  cancelada_em, cancelada_por, motivo_cancelamento, devolucao_gerada_id\n`;
        sql += `) VALUES (\n`;
        // As fotos (base64, centenas de KB cada) ficam DE FORA de proposito:
        // este .sql alimenta o Power BI, que nao consome imagem, e inclui-las
        // tornaria o arquivo grande demais para abrir.
        sql += `  ${re.id}, ${esc(re.data)}, ${esc(re.carga_numero)}, ${esc(re.rota_nome)}, ${esc(re.motorista_nome)}, ${re.entregas_saiu || 0}, ${re.entregas_feitas || 0}, ${re.entregas_reentrega || 0}, ${esc(re.motivo)}, ${esc(re.placa)}, ${esc(re.novo_motorista)}, ${esc(re.status || 'PENDENTE')}, ${esc(re.criado_por || 'SISTEMA')}, ${esc(re.criado_em)},\n`;
        sql += `  ${esc(re.recebido_cd_em)}, ${esc(re.recebido_cd_por)}, ${re.qtd_recebida_cd === null || re.qtd_recebida_cd === undefined ? 'NULL' : re.qtd_recebida_cd}, ${esc(re.condicao_recebimento)}, ${esc(re.observacao_recebimento)}, ${esc(re.local_armazenagem)},\n`;
        sql += `  ${esc(re.despachado_em)}, ${esc(re.despachado_por)}, ${esc(re.despacho_placa)}, ${esc(re.despacho_carga_numero)}, ${re.qtd_despachada === null || re.qtd_despachada === undefined ? 'NULL' : re.qtd_despachada}, ${esc(re.realizada_em)},\n`;
        sql += `  ${esc(re.cancelada_em)}, ${esc(re.cancelada_por)}, ${esc(re.motivo_cancelamento)}, ${re.devolucao_gerada_id || 'NULL'}\n`;
        sql += `) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, entregas_feitas = EXCLUDED.entregas_feitas, entregas_reentrega = EXCLUDED.entregas_reentrega,\n`;
        sql += `  recebido_cd_em = EXCLUDED.recebido_cd_em, qtd_recebida_cd = EXCLUDED.qtd_recebida_cd, condicao_recebimento = EXCLUDED.condicao_recebimento,\n`;
        sql += `  despachado_em = EXCLUDED.despachado_em, despacho_placa = EXCLUDED.despacho_placa, qtd_despachada = EXCLUDED.qtd_despachada,\n`;
        sql += `  realizada_em = EXCLUDED.realizada_em, cancelada_em = EXCLUDED.cancelada_em;\n\n`;
      });
    }

    // 6. Cadastros mestres (pedido de 19/08/2026: o exportador ignorava
    // completamente estas tabelas, mesmo já existindo no schema.sql —
    // ficavam de fora do "Baixar Base SQL" usado pro Power BI Import).
    // Usam ON CONFLICT pela chave natural de cada tabela (mesma que tem
    // UNIQUE no schema.sql), então rodar de novo só atualiza, não duplica.
    const motoristasList = this.getMotoristas();
    if (motoristasList && motoristasList.length > 0) {
      sql += `-- 6. MOTORISTAS\n`;
      motoristasList.forEach(m => {
        sql += `INSERT INTO motoristas (nome, cnh, telefone, ativo) VALUES (\n`;
        sql += `  ${esc(m.nome)}, ${esc(m.cnh || m.nome)}, ${esc(m.telefone || '')}, ${esc(m.ativo !== false)}\n`;
        sql += `) ON CONFLICT (cnh) DO UPDATE SET nome = EXCLUDED.nome, telefone = EXCLUDED.telefone, ativo = EXCLUDED.ativo;\n\n`;
      });
    }

    const ajudantesList = this.data.ajudantes || [];
    if (ajudantesList.length > 0) {
      sql += `-- 7. AJUDANTES\n`;
      ajudantesList.forEach(a => {
        sql += `INSERT INTO ajudantes (nome, cpf, ativo) VALUES (\n`;
        sql += `  ${esc(a.nome)}, ${esc(a.cpf || null)}, ${esc(a.ativo !== false)}\n`;
        sql += `) ON CONFLICT (cpf) DO UPDATE SET nome = EXCLUDED.nome, ativo = EXCLUDED.ativo;\n\n`;
      });
    }

    const veiculosList = this.getVeiculos();
    if (veiculosList && veiculosList.length > 0) {
      sql += `-- 8. VEÍCULOS\n`;
      veiculosList.forEach(v => {
        sql += `INSERT INTO veiculos (placa, modelo, tipo, capacidade_kg, ativo) VALUES (\n`;
        sql += `  ${esc(v.placa)}, ${esc(v.modelo || v.tipo || '')}, ${esc(v.tipo || 'PROPRIO')}, ${v.capacidade_kg || 'NULL'}, ${esc(v.ativo !== false)}\n`;
        sql += `) ON CONFLICT (placa) DO UPDATE SET modelo = EXCLUDED.modelo, tipo = EXCLUDED.tipo, ativo = EXCLUDED.ativo;\n\n`;
      });
    }

    const clientesList = this.getClientes();
    if (clientesList && clientesList.length > 0) {
      sql += `-- 9. CLIENTES\n`;
      clientesList.forEach(c => {
        sql += `INSERT INTO clientes (codigo_cliente, razao_social, cnpj, cidade, uf) VALUES (\n`;
        sql += `  ${esc(c.codigo_cliente || c.codigo)}, ${esc(c.razao_social || c.nome)}, ${esc(c.cnpj || c.codigo_cliente || c.codigo)}, ${esc(c.cidade || 'Araguaína')}, ${esc(c.uf || 'TO')}\n`;
        sql += `) ON CONFLICT (codigo_cliente) DO UPDATE SET razao_social = EXCLUDED.razao_social, cidade = EXCLUDED.cidade, uf = EXCLUDED.uf;\n\n`;
      });
    }

    const produtosList = this.getProdutos();
    if (produtosList && produtosList.length > 0) {
      sql += `-- 10. PRODUTOS\n`;
      produtosList.forEach(p => {
        sql += `INSERT INTO produtos (codigo_produto, descricao, categoria, valor_unitario_padrao) VALUES (\n`;
        sql += `  ${esc(p.codigo_produto)}, ${esc(p.descricao)}, ${esc(p.categoria || '')}, ${p.valor_unitario_padrao || 0}\n`;
        sql += `) ON CONFLICT (codigo_produto) DO UPDATE SET descricao = EXCLUDED.descricao, categoria = EXCLUDED.categoria, valor_unitario_padrao = EXCLUDED.valor_unitario_padrao;\n\n`;
      });
    }

    const usuariosList = this.getUsuarios();
    if (usuariosList && usuariosList.length > 0) {
      sql += `-- 11. USUÁRIOS\n`;
      usuariosList.forEach(u => {
        sql += `INSERT INTO usuarios (nome, email, senha_hash, role, cargo, ativo) VALUES (\n`;
        sql += `  ${esc(u.nome)}, ${esc(u.email)}, ${esc(u.senha_hash)}, ${esc(u.role || 'SAC')}, ${esc(u.cargo || '')}, ${esc(u.ativo !== false)}\n`;
        sql += `) ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, role = EXCLUDED.role, cargo = EXCLUDED.cargo, ativo = EXCLUDED.ativo;\n\n`;
      });
    }

    const colaboradoresList = this.getColaboradoresCD();
    if (colaboradoresList && colaboradoresList.length > 0) {
      sql += `-- 12. COLABORADORES CD\n`;
      colaboradoresList.forEach(c => {
        sql += `INSERT INTO colaboradores_cd (chapa, nome, cpf, funcao, secao, ativo) VALUES (\n`;
        sql += `  ${esc(c.chapa || '')}, ${esc(c.nome)}, ${esc(c.cpf || null)}, ${esc(c.funcao)}, ${esc(c.secao || '')}, ${esc(c.ativo !== false)}\n`;
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
  addRetencaoFrota({ veiculo_id, placa, tipo_veiculo, data_parada, motivo, tipo_os, local, data_previsao, numero_os, link_os }) {
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
      id: this.gerarIdUnico(),
      numero_retencao,
      veiculo_id: parseInt(veiculo_id) || null,
      placa: String(placa || '').toUpperCase().trim(),
      tipo_veiculo: String(tipo_veiculo || '').toUpperCase().trim(),
      data_parada: data_parada || hojeIsoBrasilia(),
      motivo: String(motivo || '').toUpperCase().trim(),
      tipo_os: String(tipo_os || 'CORRETIVA').toUpperCase().trim(),
      local: String(local || '').toUpperCase().trim(),
      data_previsao: data_previsao || null,
      numero_os: String(numero_os || '').toUpperCase().trim() || null,
      link_os: String(link_os || '').trim() || null,
      data_liberacao: null,
      status: 'RETIDO',
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia(),
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
  /**
   * Altera status do registro para LIBERADO e registra a data de liberação.
   * @param {number|string} id - ID da retenção
   * @param {string} dataLiberacao - Data de liberação (YYYY-MM-DD)
   * @param {string} [descricaoAcao] - Ação de manutenção realizada (obrigatória
   *   desde a auditoria de 17/08/2026, item 0.2 — a validação em si é feita
   *   na camada de UI antes de chamar este método, mas o valor é gravado aqui).
   * @returns {{ success: boolean, retencao?: Object, message?: string }}
   */
  liberarVeiculo(id, dataLiberacao, descricaoAcao) {
    const retencao = (this.data.retencoes_frota || []).find(r => r.id == id && !r.is_deleted);
    if (!retencao) {
      return { success: false, message: `Retenção ID ${id} não encontrada.` };
    }
    retencao.status = 'LIBERADO';
    retencao.data_liberacao = dataLiberacao || hojeIsoBrasilia();
    if (descricaoAcao !== undefined) {
      retencao.descricao_acao_liberacao = descricaoAcao;
    }
    this.save();
    return { success: true, retencao };
  }

  liberarRetencaoFrota(id, dataLiberacao, descricaoAcao) {
    return this.liberarVeiculo(id, dataLiberacao, descricaoAcao);
  }

  // ===== ITENS AVULSOS DE DESTINAÇÃO =====
  // Itens que precisam de destinação no CD (reutilização, retrabalho,
  // descarte, negociação etc.) mas que NÃO vieram de uma Devolução SAC
  // formal — cobre outras formas de avaria que podem ocorrer direto no CD
  // (ex: item avariado identificado em conferência avulsa, sobra de
  // estoque, produto sem devolução associada).
  addItemAvulsoDestinacao({ produto_codigo, produto_descricao, quantidade, destino_item, data_validade, observacao, status_negociacao, motivo_avulso }) {
    if (!Array.isArray(this.data.itens_avulsos_destinacao)) this.data.itens_avulsos_destinacao = [];
    const item = {
      id: `avulso_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      produto_codigo: String(produto_codigo || '').toUpperCase().trim() || null,
      produto_descricao: String(produto_descricao || '').toUpperCase().trim() || 'PRODUTO NÃO ESPECIFICADO',
      quantidade: parseFloat(quantidade) || 1,
      destino_item: destino_item || 'ESTOQUE_REUTILIZACAO',
      data_validade: data_validade || null,
      observacao: String(observacao || '').toUpperCase().trim(),
      status_negociacao: status_negociacao || 'EM_NEGOCIACAO',
      motivo_avulso: String(motivo_avulso || '').toUpperCase().trim(),
      divisoes_destino: [],
      is_deleted: false,
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia()
    };
    this.data.itens_avulsos_destinacao.push(item);
    const salvou = this.save();
    return salvou
      ? { success: true, item }
      : { success: false, item, message: 'Não foi possível salvar o item avulso neste dispositivo. Tente novamente.' };
  }

  getItensAvulsosDestinacao() {
    return (this.data.itens_avulsos_destinacao || []).filter(i => !i.is_deleted);
  }

  excluirItemAvulsoDestinacao(id) {
    const item = (this.data.itens_avulsos_destinacao || []).find(i => String(i.id) === String(id));
    if (!item) return { success: false, message: 'Item avulso não encontrado.' };
    item.is_deleted = true;
    item.deleted_at = agoraIsoBrasilia();
    const salvou = this.save();
    return { success: salvou };
  }

  // ===== MEDIDAS DISCIPLINARES (Parte A do documento de Acompanhamento de
  // Pessoas, 18/08/2026) =====
  // Coleção única e consultável de toda Orientação Verbal, Advertência e
  // Suspensão emitida — antes disso, a emissão só marcava um campo na
  // ocorrência de origem (ou nada, se emitida avulsa), sem permitir
  // consultar o histórico/reincidência de um colaborador.
  registrarMedidaDisciplinar({ tipo, colaborador_tipo, colaborador_id, colaborador_nome, chapa, cpf, funcao, secao, alineas_clt, dias_suspensao, motivo, gestor, data_ocorrencia }) {
    if (!Array.isArray(this.data.medidas_disciplinares)) this.data.medidas_disciplinares = [];
    const numero_medida = this.getNextSequenceNumber('medidas_disciplinares', 'numero_medida', 'MD-', 4);
    const medida = {
      id: `medida_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      numero_medida,
      tipo: tipo || 'ORIENTACAO_VERBAL', // 'ORIENTACAO_VERBAL' | 'ADVERTENCIA' | 'SUSPENSAO'
      colaborador_tipo: colaborador_tipo || 'CD', // 'CD' | 'MOTORISTA'
      colaborador_id: colaborador_id || null,
      colaborador_nome: String(colaborador_nome || '').toUpperCase().trim(),
      chapa: chapa || null,
      cpf: cpf || null,
      funcao: funcao || null,
      secao: secao || null,
      alineas_clt: alineas_clt || null,
      dias_suspensao: tipo === 'SUSPENSAO' ? (parseInt(dias_suspensao, 10) || 1) : null,
      motivo: String(motivo || '').trim(),
      gestor: String(gestor || '').toUpperCase().trim(),
      data_ocorrencia: data_ocorrencia || hojeIsoBrasilia(),
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia(),
      is_deleted: false
    };
    this.data.medidas_disciplinares.push(medida);
    const salvou = this.save();
    return salvou
      ? { success: true, medida }
      : { success: false, medida, message: 'Não foi possível salvar a medida disciplinar neste dispositivo. Tente novamente.' };
  }

  getMedidasDisciplinares({ colaboradorNome, colaboradorTipo, tipo, dataDe, dataAte } = {}) {
    let lista = (this.data.medidas_disciplinares || []).filter(m => !m.is_deleted);
    if (colaboradorNome) {
      const alvo = String(colaboradorNome).toUpperCase().trim();
      lista = lista.filter(m => m.colaborador_nome === alvo);
    }
    if (colaboradorTipo) lista = lista.filter(m => m.colaborador_tipo === colaboradorTipo);
    if (tipo) lista = lista.filter(m => m.tipo === tipo);
    if (dataDe) lista = lista.filter(m => (m.data_ocorrencia || '') >= dataDe);
    if (dataAte) lista = lista.filter(m => (m.data_ocorrencia || '') <= dataAte);
    return lista.sort((a, b) => new Date(b.data_ocorrencia || 0) - new Date(a.data_ocorrencia || 0));
  }

  contarReincidencia(colaboradorNome, tipo) {
    if (!colaboradorNome) return 0;
    const alvo = String(colaboradorNome).toUpperCase().trim();
    return (this.data.medidas_disciplinares || []).filter(m =>
      !m.is_deleted && m.colaborador_nome === alvo && (!tipo || m.tipo === tipo)
    ).length;
  }

  // ===== ACOMPANHAMENTO DE FUNCIONÁRIO / DOSSIÊ MOTORISTA (Parte B do
  // documento de 18/08/2026) =====
  // Três seções da planilha anexa que não têm fonte de dado em nenhum
  // outro módulo do sistema hoje — lançamento manual mesmo, igual a
  // planilha já fazia. Mesmo padrão das outras coleções: id, save() com
  // verificação de retorno, soft delete, consulta por colaborador.

  addOrientacaoFeedback({ colaborador_tipo, colaborador_id, colaborador_nome, data, ocorrencia, acao }) {
    if (!Array.isArray(this.data.orientacoes_feedback)) this.data.orientacoes_feedback = [];
    const registro = {
      id: `orient_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      colaborador_tipo: colaborador_tipo || 'CD',
      colaborador_id: colaborador_id || null,
      colaborador_nome: String(colaborador_nome || '').toUpperCase().trim(),
      data: data || hojeIsoBrasilia(),
      ocorrencia: String(ocorrencia || '').trim(),
      acao: String(acao || '').trim(),
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia(),
      is_deleted: false
    };
    this.data.orientacoes_feedback.push(registro);
    const salvou = this.save();
    return salvou ? { success: true, registro } : { success: false, registro, message: 'Não foi possível salvar neste dispositivo. Tente novamente.' };
  }

  excluirOrientacaoFeedback(id) {
    const r = (this.data.orientacoes_feedback || []).find(x => String(x.id) === String(id));
    if (!r) return { success: false, message: 'Registro não encontrado.' };
    r.is_deleted = true;
    r.deleted_at = agoraIsoBrasilia();
    return { success: this.save() };
  }

  getOrientacoesFeedback(colaboradorNome) {
    let lista = (this.data.orientacoes_feedback || []).filter(r => !r.is_deleted);
    if (colaboradorNome) {
      const alvo = String(colaboradorNome).toUpperCase().trim();
      lista = lista.filter(r => r.colaborador_nome === alvo);
    }
    return lista.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
  }

  addAtestadoMedico({ colaborador_tipo, colaborador_id, colaborador_nome, data, tipo_afastamento, motivo, cid, medico, crm_cro }) {
    if (!Array.isArray(this.data.atestados_medicos)) this.data.atestados_medicos = [];
    const registro = {
      id: `atest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      colaborador_tipo: colaborador_tipo || 'CD',
      colaborador_id: colaborador_id || null,
      colaborador_nome: String(colaborador_nome || '').toUpperCase().trim(),
      data: data || hojeIsoBrasilia(),
      tipo_afastamento: tipo_afastamento === 'INTEGRAL' ? 'INTEGRAL' : 'PARCIAL',
      motivo: String(motivo || '').trim(),
      cid: String(cid || '').toUpperCase().trim(),
      medico: String(medico || '').toUpperCase().trim(),
      crm_cro: String(crm_cro || '').toUpperCase().trim(),
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia(),
      is_deleted: false
    };
    this.data.atestados_medicos.push(registro);
    const salvou = this.save();
    return salvou ? { success: true, registro } : { success: false, registro, message: 'Não foi possível salvar neste dispositivo. Tente novamente.' };
  }

  excluirAtestadoMedico(id) {
    const r = (this.data.atestados_medicos || []).find(x => String(x.id) === String(id));
    if (!r) return { success: false, message: 'Registro não encontrado.' };
    r.is_deleted = true;
    r.deleted_at = agoraIsoBrasilia();
    return { success: this.save() };
  }

  getAtestadosMedicos(colaboradorNome) {
    let lista = (this.data.atestados_medicos || []).filter(r => !r.is_deleted);
    if (colaboradorNome) {
      const alvo = String(colaboradorNome).toUpperCase().trim();
      lista = lista.filter(r => r.colaborador_nome === alvo);
    }
    return lista.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
  }

  addAusenciaRegistro({ colaborador_tipo, colaborador_id, colaborador_nome, data, motivo }) {
    if (!Array.isArray(this.data.ausencias_registros)) this.data.ausencias_registros = [];
    const registro = {
      id: `ausen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      colaborador_tipo: colaborador_tipo || 'CD',
      colaborador_id: colaborador_id || null,
      colaborador_nome: String(colaborador_nome || '').toUpperCase().trim(),
      data: data || hojeIsoBrasilia(),
      motivo: String(motivo || '').trim(),
      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia(),
      is_deleted: false
    };
    this.data.ausencias_registros.push(registro);
    const salvou = this.save();
    return salvou ? { success: true, registro } : { success: false, registro, message: 'Não foi possível salvar neste dispositivo. Tente novamente.' };
  }

  excluirAusenciaRegistro(id) {
    const r = (this.data.ausencias_registros || []).find(x => String(x.id) === String(id));
    if (!r) return { success: false, message: 'Registro não encontrado.' };
    r.is_deleted = true;
    r.deleted_at = agoraIsoBrasilia();
    return { success: this.save() };
  }

  // Bloco "Faltas / Condutas / Ausências" do Acompanhamento de Funcionário
  // e do Dossiê Motorista deixou de ter lançamento próprio (pedido de
  // 19/08/2026) e passou a puxar da "Gestão de Faltas, Condutas &
  // Ausências" já existente dentro do Resumo Diário CD — mesmo dado, sem
  // duplicar o lançamento. resumo_diario_cd é gravado por data+turno, e
  // cada falta_conduta não carrega a própria data, então ela é herdada do
  // resumo que a contém ao montar o resultado.
  getFaltasCondutasPorColaborador(nome) {
    if (!nome) return [];
    const alvo = String(nome).toUpperCase().trim();
    const resultado = [];
    (this.data.resumo_diario_cd || []).forEach(resumo => {
      (resumo.faltas_condutas || []).forEach(f => {
        if (String(f.nome || '').toUpperCase().trim() === alvo) {
          resultado.push({ ...f, data: resumo.data, turno: resumo.turno });
        }
      });
    });
    return resultado.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
  }

  getAusenciasRegistros(colaboradorNome) {
    let lista = (this.data.ausencias_registros || []).filter(r => !r.is_deleted);
    if (colaboradorNome) {
      const alvo = String(colaboradorNome).toUpperCase().trim();
      lista = lista.filter(r => r.colaborador_nome === alvo);
    }
    return lista.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
  }

  // Busca um motorista pelo nome no cadastro mestre (equivalente a
  // getDadosColaboradorMestre, que só busca em colaboradores_cd).
  getDadosMotoristaMestre(nome) {
    if (!nome) return null;
    const alvo = String(nome).toUpperCase().trim();
    return (this.data.motoristas || []).find(m => String(m.nome || '').toUpperCase().trim() === alvo) || null;
  }

  // ===== INVESTIGAÇÃO DE SINISTRO (baseado no Formulário_Investigação_de_
  // Acidente.docx, 18/08/2026) =====
  // Fluxo de 5 etapas (Motorista, Manutenção de Frota, Operações e
  // Logística, Jurídico [opcional], Diretoria). As etapas NÃO são
  // bloqueadas entre si (podem ser preenchidas em paralelo por pessoas
  // diferentes), mas o registro só fica com status_geral 'CONCLUIDO'
  // quando todas as etapas aplicáveis estiverem completas — até lá,
  // permanece 'PENDENTE' e aparece no painel de alerta.
  // O "croqui" do papel foi substituído por upload de fotos reaproveitando
  // o mesmo padrão já usado em Devolução SAC / Oc em Rota.

  _recalcularStatusSinistro(s) {
    const juridicoOk = !s.juridico_necessario || s.etapa_juridico_completa;
    s.status_geral = (s.etapa_motorista_completa && s.etapa_manutencao_completa && s.etapa_operacoes_completa && s.etapa_diretoria_completa && juridicoOk)
      ? 'CONCLUIDO' : 'PENDENTE';
  }

  addSinistro({ ocorrencia_rota_id, carga, placa, veiculo_id, motorista_nome, motorista_id, data_acidente, local_acidente }) {
    if (!Array.isArray(this.data.sinistros)) this.data.sinistros = [];
    const numero_sinistro = this.getNextSequenceNumber('sinistros', 'numero_sinistro', 'SIN-2026-', 4);
    const sinistro = {
      id: `sinistro_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      numero_sinistro,
      ocorrencia_rota_id: ocorrencia_rota_id || null,
      carga: String(carga || '').toUpperCase().trim(),
      placa: String(placa || '').toUpperCase().trim(),
      veiculo_id: veiculo_id || null,
      motorista_nome: String(motorista_nome || '').toUpperCase().trim(),
      motorista_id: motorista_id || null,
      data_acidente: data_acidente || hojeIsoBrasilia(),
      local_acidente: String(local_acidente || '').toUpperCase().trim(),

      etapa_motorista_completa: false,
      etapa_manutencao_completa: false,
      etapa_operacoes_completa: false,
      juridico_necessario: false,
      etapa_juridico_completa: false,
      etapa_diretoria_completa: false,
      status_geral: 'PENDENTE',

      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia(),
      is_deleted: false
    };
    this.data.sinistros.push(sinistro);
    const salvou = this.save();
    return salvou ? { success: true, sinistro } : { success: false, sinistro, message: 'Não foi possível salvar o sinistro neste dispositivo. Tente novamente.' };
  }

  // Atualiza os campos de uma etapa específica e marca ela como completa.
  // `dadosEtapa` é aplicado diretamente sobre o registro (union), sem
  // apagar dados de outras etapas.
  atualizarEtapaSinistro(id, etapa, dadosEtapa, completa) {
    const s = (this.data.sinistros || []).find(x => String(x.id) === String(id) && !x.is_deleted);
    if (!s) return { success: false, message: 'Sinistro não encontrado.' };
    Object.assign(s, dadosEtapa || {});
    if (etapa === 'motorista') s.etapa_motorista_completa = completa !== false;
    else if (etapa === 'manutencao') s.etapa_manutencao_completa = completa !== false;
    else if (etapa === 'operacoes') s.etapa_operacoes_completa = completa !== false;
    else if (etapa === 'juridico') s.etapa_juridico_completa = completa !== false;
    else if (etapa === 'diretoria') s.etapa_diretoria_completa = completa !== false;
    s.atualizado_em = agoraIsoBrasilia();
    this._recalcularStatusSinistro(s);
    const salvou = this.save();
    return salvou ? { success: true, sinistro: s } : { success: false, sinistro: s, message: 'Não foi possível salvar neste dispositivo. Tente novamente.' };
  }

  excluirSinistro(id) {
    const s = (this.data.sinistros || []).find(x => String(x.id) === String(id));
    if (!s) return { success: false, message: 'Sinistro não encontrado.' };
    s.is_deleted = true;
    s.deleted_at = agoraIsoBrasilia();
    return { success: this.save() };
  }

  getSinistros({ motoristaNome, status, dataDe, dataAte } = {}) {
    let lista = (this.data.sinistros || []).filter(s => !s.is_deleted);
    if (motoristaNome) {
      const alvo = String(motoristaNome).toUpperCase().trim();
      lista = lista.filter(s => s.motorista_nome === alvo);
    }
    if (status) lista = lista.filter(s => s.status_geral === status);
    if (dataDe) lista = lista.filter(s => (s.data_acidente || '') >= dataDe);
    if (dataAte) lista = lista.filter(s => (s.data_acidente || '') <= dataAte);
    return lista.sort((a, b) => new Date(b.data_acidente || 0) - new Date(a.data_acidente || 0));
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
    retencao.deleted_at = agoraIsoBrasilia();
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
    const campos = ['placa', 'data_parada', 'motivo', 'tipo_os', 'numero_os', 'link_os', 'local', 'data_previsao', 'data_liberacao', 'status'];
    campos.forEach(c => {
      if (Object.prototype.hasOwnProperty.call(dados, c)) {
        retencao[c] = dados[c];
      }
    });
    retencao.atualizado_em = agoraIsoBrasilia();
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
      id: this.gerarIdUnico(),
      data: item.data || hojeIsoBrasilia(),
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

      // --- CUSTODIA DA REENTREGA (v5.0.0) ---
      // Entre o motorista voltar com o produto e o produto ser entregue, a
      // mercadoria fica em algum lugar e alguem tem de assinar por ela. Estes
      // campos sao o rastro dessa custodia: quem recebeu no CD, quanto
      // recebeu, em que estado, e para qual veiculo despachou.
      //
      // Nascem null (e nao ''), porque o banco espera TIMESTAMP/INT nessas
      // colunas e string vazia viraria erro de tipo no PostgREST.
      recebido_cd_em: null,
      recebido_cd_por: null,
      qtd_recebida_cd: null,
      condicao_recebimento: null,
      observacao_recebimento: null,
      local_armazenagem: null,

      // FOTOS (v5.1.0): a imagem NAO mora mais aqui.
      //
      // fotos_recebimento / fotos_despacho continuam existindo por causa dos
      // registros criados ate a v5.0.0, que guardam base64 dentro deles. Para
      // registro NOVO nascem vazios e nunca recebem nada - se voltassem a
      // receber base64, voltariam junto o estouro de localStorage de
      // 25/08/2026 e o trafego de ~400 KB a cada pull de 30s.
      //
      // O que a v5.1.0 grava:
      //   *_paths      caminho do arquivo no bucket reentregas-fotos
      //   *_pendentes  quantas fotos ainda estao so no IndexedDB deste
      //                aparelho, esperando rede (ver js/fotoStore.js)
      fotos_recebimento: [],
      fotos_recebimento_paths: [],
      fotos_recebimento_pendentes: 0,

      despachado_em: null,
      despachado_por: null,
      despacho_placa: null,
      despacho_carga_numero: null,
      qtd_despachada: null,
      fotos_despacho: [],
      fotos_despacho_paths: [],
      fotos_despacho_pendentes: 0,

      // realizada_em nao existia: so havia atualizado_em, que muda a cada
      // edicao e por isso nao serve para medir o ciclo da reentrega.
      realizada_em: null,
      cancelada_em: null,
      cancelada_por: null,
      motivo_cancelamento: null,
      devolucao_gerada_id: null,

      criado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      criado_em: agoraIsoBrasilia(),
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
    // ATENCAO: isto e uma WHITELIST. Campo que nao estiver aqui e descartado
    // em silencio pelo update - nao da erro, so nao grava. Foi por isso que os
    // campos de custodia precisaram entrar um a um.
    const camposPermitidos = [
      'data', 'carga_numero', 'rota_nome', 'motorista_nome',
      'entregas_saiu', 'entregas_feitas', 'entregas_reentrega',
      'motivo', 'placa', 'novo_motorista', 'status',
      // Custodia (v5.0.0)
      'recebido_cd_em', 'recebido_cd_por', 'qtd_recebida_cd',
      'condicao_recebimento', 'observacao_recebimento', 'local_armazenagem',
      'fotos_recebimento',
      'despachado_em', 'despachado_por', 'despacho_placa',
      'despacho_carga_numero', 'qtd_despachada', 'fotos_despacho',
      // Fotos em Storage (v5.1.0). Sem estes quatro nomes AQUI, o caminho da
      // foto que acabou de subir seria descartado em silencio por esta mesma
      // whitelist - a foto estaria no bucket e o registro nunca saberia.
      'fotos_recebimento_paths', 'fotos_recebimento_pendentes',
      'fotos_despacho_paths', 'fotos_despacho_pendentes',
      'realizada_em', 'cancelada_em', 'cancelada_por',
      'motivo_cancelamento', 'devolucao_gerada_id'
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
    item.atualizado_em = agoraIsoBrasilia();
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
   * ETAPA 2 - O CD RECEBE FISICAMENTE o produto que voltou.
   *
   * A foto e obrigatoria aqui e no despacho (pedido de 25/08/2026), e a regra
   * esta tambem como CHECK no banco (migration 31): validar so na tela deixaria
   * a garantia depender de a tela se comportar.
   *
   * qtd_recebida vem separada de entregas_reentrega de proposito: a segunda e
   * o que o motorista DECLAROU na rota, a primeira e o que o CD CONTOU na doca.
   * E justamente onde as duas divergem que a etapa se paga.
   *
   * @param {number|string} id
   * @param {Object} d - { qtd_recebida, condicao, observacao, local_armazenagem, fotos }
   */
  receberReentregaCd(id, d) {
    const item = (this.data.reentregas || []).find(x => x.id == id && !x.is_deleted);
    if (!item) return { success: false, message: `Reentrega ID ${id} nao encontrada.` };
    if (item.status !== 'PENDENTE') {
      return { success: false, message: `Esta reentrega esta como ${item.status}. So da para receber o que esta PENDENTE.` };
    }
    // A FOTO CONTINUA OBRIGATORIA - o que mudou e ONDE ela esta neste
    // instante. Ate a v5.0.0 chegava aqui o base64 inteiro; agora a tela ja
    // guardou a imagem no IndexedDB (js/fotoStore.js) e passa so QUANTAS
    // guardou. O que este metodo exige e que esse numero seja pelo menos 1.
    const qtdFotos = parseInt(d && d.fotos_pendentes);
    if (isNaN(qtdFotos) || qtdFotos < 1) {
      return { success: false, message: 'Anexe ao menos uma foto do recebimento. E o comprovante de que o produto chegou ao CD.' };
    }
    const condicoes = ['OK', 'AVARIA', 'FALTA_PARCIAL'];
    const condicao = String((d && d.condicao) || 'OK').toUpperCase();
    if (!condicoes.includes(condicao)) {
      return { success: false, message: `Condicao invalida: ${condicao}.` };
    }
    const qtd = parseInt(d && d.qtd_recebida);
    if (isNaN(qtd) || qtd < 0) {
      return { success: false, message: 'Informe quantos volumes o CD recebeu.' };
    }
    const divergiu = qtd !== (parseInt(item.entregas_reentrega) || 0);
    const obs = String((d && d.observacao) || '').trim();
    if ((divergiu || condicao !== 'OK') && !obs) {
      return {
        success: false,
        message: divergiu
          ? `Foram declarados ${item.entregas_reentrega} volume(s) e voce esta recebendo ${qtd}. Descreva o que houve no campo de observacao.`
          : 'Recebimento com avaria ou falta exige observacao.'
      };
    }
    return this.updateReentrega(id, {
      status: 'RECEBIDO_CD',
      recebido_cd_em: agoraIsoBrasilia(),
      recebido_cd_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      qtd_recebida_cd: qtd,
      condicao_recebimento: condicao,
      observacao_recebimento: obs || null,
      local_armazenagem: String((d && d.local_armazenagem) || '').trim().toUpperCase() || null,
      // Nasce inteiramente pendente: os caminhos aparecem um a um, conforme a
      // fila sobe. Enquanto este numero for > 0, a tela mostra "foto pendente"
      // em TODO aparelho, nao so neste - e por isso que ele e um campo do
      // registro e nao um estado local.
      fotos_recebimento_paths: [],
      fotos_recebimento_pendentes: qtdFotos
    });
  }

  /**
   * ETAPA 3 - O CD DESPACHA para um veiculo (o mesmo ou outro).
   *
   * Despacho e UNICO por reentrega: o negocio confirmou que pode acontecer em
   * duas remessas, mas nao deve, e pediu para tratar como nao. E por isso que
   * estes campos sao colunas e nao uma tabela filha - se um dia partir em duas
   * remessas passar a ser permitido, o modelo aqui precisa mudar de forma.
   *
   * @param {number|string} id
   * @param {Object} d - { placa, motorista, carga_numero, qtd_despachada, fotos }
   */
  despacharReentrega(id, d) {
    const item = (this.data.reentregas || []).find(x => x.id == id && !x.is_deleted);
    if (!item) return { success: false, message: `Reentrega ID ${id} nao encontrada.` };
    if (item.status !== 'RECEBIDO_CD') {
      return { success: false, message: `Esta reentrega esta como ${item.status}. So da para despachar o que ja foi RECEBIDO_CD.` };
    }
    // Mesma troca do recebimento: chega a CONTAGEM, nao a imagem. Ver o
    // comentario em receberReentregaCd().
    const qtdFotos = parseInt(d && d.fotos_pendentes);
    if (isNaN(qtdFotos) || qtdFotos < 1) {
      return { success: false, message: 'Anexe ao menos uma foto do despacho. E o comprovante de que o produto saiu do CD.' };
    }
    const placa = String((d && d.placa) || '').trim().toUpperCase();
    if (!placa) return { success: false, message: 'Informe a placa do veiculo que vai levar.' };
    const motorista = String((d && d.motorista) || '').trim().toUpperCase();
    if (!motorista) return { success: false, message: 'Informe o motorista que vai levar.' };

    const qtd = parseInt(d && d.qtd_despachada);
    const recebido = parseInt(item.qtd_recebida_cd) || 0;
    if (isNaN(qtd) || qtd <= 0) return { success: false, message: 'Informe quantos volumes estao saindo.' };
    if (qtd > recebido) {
      return { success: false, message: `O CD recebeu ${recebido} volume(s); nao da para despachar ${qtd}.` };
    }
    return this.updateReentrega(id, {
      status: 'DESPACHADO',
      despachado_em: agoraIsoBrasilia(),
      despachado_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      despacho_placa: placa,
      // novo_motorista ja existia como "quem vai levar" e continua sendo a
      // fonte unica disso - nao criamos um segundo campo com o mesmo sentido.
      novo_motorista: motorista,
      despacho_carga_numero: String((d && d.carga_numero) || '').trim().toUpperCase() || null,
      qtd_despachada: qtd,
      fotos_despacho_paths: [],
      fotos_despacho_pendentes: qtdFotos
    });
  }

  // ---------------------------------------------------------------
  // FOTOS EM STORAGE (v5.1.0) - ponte entre js/fotoStore.js e o registro
  // ---------------------------------------------------------------

  /** Traduz 'recebimento'/'despacho' nos dois nomes de campo da etapa. */
  static _camposFoto(etapa) {
    return String(etapa) === 'despacho'
      ? { paths: 'fotos_despacho_paths',    pendentes: 'fotos_despacho_pendentes',    legado: 'fotos_despacho' }
      : { paths: 'fotos_recebimento_paths', pendentes: 'fotos_recebimento_pendentes', legado: 'fotos_recebimento' };
  }

  /**
   * Uma foto acabou de subir para o Storage: guarda o caminho no registro e
   * baixa em um o contador de pendentes.
   *
   * Chamado por fotoStore.processarFila() DEPOIS do upload e ANTES de a copia
   * local ser apagada - se isto falhar, a foto continua no aparelho e a fila
   * tenta de novo.
   *
   * @param {number|string} id
   * @param {'recebimento'|'despacho'} etapa
   * @param {string} caminho - ex: reentregas/123/recebimento/1756...-a1b2.jpg
   */
  registrarFotoEnviada(id, etapa, caminho) {
    const item = (this.data.reentregas || []).find(x => x.id == id && !x.is_deleted);
    if (!item) return { success: false, message: `Reentrega ID ${id} nao encontrada.` };
    if (!caminho) return { success: false, message: 'Caminho vazio.' };

    const c = Store._camposFoto(etapa);
    const paths = Array.isArray(item[c.paths]) ? item[c.paths].slice() : [];
    // Idempotente: subir a mesma foto duas vezes (app fechado no meio do
    // caminho) nao pode gerar dois caminhos iguais no registro.
    if (!paths.includes(caminho)) paths.push(caminho);

    const restantes = Math.max(0, (parseInt(item[c.pendentes]) || 0) - 1);
    const updates = {};
    updates[c.paths] = paths;
    updates[c.pendentes] = restantes;
    return this.updateReentrega(id, updates);
  }

  /**
   * A reentrega ainda existe (e nao esta na lixeira)?
   *
   * Serve a fila de fotos: ela precisa saber, ANTES de subir um arquivo, se
   * ainda ha registro a que o caminho possa ser gravado. Sem isso, uma foto
   * orfa - de um Reset Global ou de uma exclusao - subiria de novo a cada
   * ciclo de 30s, deixando um arquivo no bucket por tentativa.
   */
  existeReentrega(id) {
    return !!(this.data.reentregas || []).find(x => x.id == id && !x.is_deleted);
  }

  /**
   * Reescreve o contador de pendentes com o numero REAL de fotos que este
   * aparelho ainda tem na fila. E o antidoto para o pull de 30s ressuscitar
   * uma pendencia ja resolvida - ver o bloco POSSE em js/fotoStore.js.
   *
   * NAO passa por updateReentrega de proposito: isto roda a cada ciclo de
   * sincronizacao e encheria a trilha de auditoria de edicoes que nao sao
   * edicoes de ninguem. Grava direto e so quando o valor muda de fato.
   */
  ajustarFotosPendentes(id, etapa, quantidade) {
    const item = (this.data.reentregas || []).find(x => x.id == id && !x.is_deleted);
    if (!item) return { success: false, message: `Reentrega ID ${id} nao encontrada.` };

    const c = Store._camposFoto(etapa);
    const alvo = Math.max(0, parseInt(quantidade) || 0);
    const atual = parseInt(item[c.pendentes]) || 0;
    if (atual === alvo) return { success: true, pendentes: alvo, mudou: false };

    item[c.pendentes] = alvo;
    item.atualizado_em = agoraIsoBrasilia();
    item.atualizado_por = this.currentUser ? this.currentUser.nome : 'SISTEMA';
    this.save();
    return { success: true, pendentes: alvo, mudou: true };
  }

  /**
   * Estado das fotos de uma etapa, do jeito que a tela precisa perguntar.
   * Reune as tres formas que uma prova pode ter neste momento da migracao:
   * caminho no Storage, base64 legado (registros ate a v5.0.0) e pendente.
   */
  estadoFotosReentrega(item, etapa) {
    const c = Store._camposFoto(etapa);
    const paths = Array.isArray(item && item[c.paths]) ? item[c.paths].filter(Boolean) : [];
    const legado = Array.isArray(item && item[c.legado]) ? item[c.legado].filter(Boolean) : [];
    const pendentes = Math.max(0, parseInt(item && item[c.pendentes]) || 0);
    return {
      paths, legado, pendentes,
      enviadas: paths.length + legado.length,
      total: paths.length + legado.length + pendentes,
      temAlguma: (paths.length + legado.length + pendentes) > 0
    };
  }

  /**
   * Marca a reentrega como entregue ao cliente.
   */
  concluirReentrega(id) {
    const item = (this.data.reentregas || []).find(x => x.id == id && !x.is_deleted);
    if (!item) return { success: false, message: `Reentrega ID ${id} nao encontrada.` };
    return this.updateReentrega(id, {
      status: 'REALIZADA',
      realizada_em: agoraIsoBrasilia()
    });
  }

  /**
   * CANCELAMENTO da reentrega.
   *
   * Regra do negocio (25/08/2026): reentrega cancelada significa que a
   * mercadoria nao vai mais ao cliente, entao ela precisa virar Devolucao SAC.
   *
   * Mas a devolucao NAO e criada aqui. Quem abre e o proprio agente do SAC,
   * na tela de abertura - e a tela e chamada logo em seguida, ja preenchida
   * com os dados desta reentrega (ver cancelarReentregaFluxo em app.js).
   *
   * O motivo de nao criar automatico: a devolucao pede cliente, nota fiscal,
   * motivo e itens, que o CD nao tem na mao no momento do cancelamento. Uma
   * devolucao gerada pela metade entraria no fluxo do SAC como pendencia
   * incompleta, e alguem teria de caçar a informacao depois. Melhor a tela
   * abrir preenchida no que da para preencher e o SAC completar na hora.
   *
   * devolucao_gerada_id fica disponivel para amarrar as duas pontas quando a
   * devolucao for salva.
   *
   * @param {number|string} id
   * @param {Object} d - { motivo }
   */
  cancelarReentrega(id, d) {
    const item = (this.data.reentregas || []).find(x => x.id == id && !x.is_deleted);
    if (!item) return { success: false, message: `Reentrega ID ${id} nao encontrada.` };
    if (item.status === 'REALIZADA') {
      return { success: false, message: 'Reentrega ja realizada nao pode ser cancelada.' };
    }
    if (item.status === 'CANCELADA') {
      return { success: false, message: 'Esta reentrega ja esta cancelada.' };
    }
    const motivo = String((d && d.motivo) || '').trim();
    if (!motivo) return { success: false, message: 'Descreva o motivo do cancelamento.' };

    const upd = this.updateReentrega(id, {
      status: 'CANCELADA',
      cancelada_em: agoraIsoBrasilia(),
      cancelada_por: this.currentUser ? this.currentUser.nome : 'SISTEMA',
      motivo_cancelamento: motivo
    });
    if (!upd.success) return upd;
    return { success: true, reentrega: upd.reentrega };
  }

  /**
   * Amarra a devolucao aberta pelo SAC de volta na reentrega que a originou.
   * Chamada depois que o agente salva a devolucao vinda do cancelamento.
   */
  vincularDevolucaoAReentrega(reentregaId, devolucaoId) {
    return this.updateReentrega(reentregaId, { devolucao_gerada_id: devolucaoId });
  }

  /**
   * Soft-delete auditado de uma reentrega.
   * @param {number|string} id
   * @returns {{ success: boolean, message?: string }}
   */
  deleteReentrega(id, password) {
    if (password !== undefined && String(password).trim() !== this.getAdminPassword()) {
      return { success: false, message: 'Senha de administrador incorreta.' };
    }
    if (!Array.isArray(this.data.reentregas)) return { success: false, message: 'Coleção vazia.' };
    const item = this.data.reentregas.find(x => x.id == id && !x.is_deleted);
    if (!item) {
      return { success: false, message: `Reentrega ID ${id} não encontrada.` };
    }
    item.is_deleted = true;
    item.deleted_at = agoraIsoBrasilia();
    item.deleted_by_nome = this.currentUser ? this.currentUser.nome : 'SISTEMA';
    // (achado em 20/08/2026) não existe coluna deleted_by em reentregas_rota
    // — só deleted_by_nome, já preenchida acima. Ver mesmo achado em softDelete().

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
