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
    // =================================================================
    // O CATÁLOGO SAIU DO localStorage — 31/08/2026
    //
    // O QUE HAVIA ANTES. O armazenamento era dividido em duas chaves:
    //   'jr_sac_static' → clientes + produtos, ~2.994 KB
    //   'jr_sac_db'     → todo o resto (a fatia operacional)
    // Isso resolveu o problema de 17/08/2026 — cada gravação normal deixou
    // de reescrever 3 MB —, mas não o de OCUPAÇÃO: os 2.994 KB continuavam
    // dentro dos ~5 MB que o navegador dá POR ORIGEM. Medido em produção em
    // 31/08/2026, um aparelho do CD estava em 5.020 KB (98%) com a tarja
    // vermelha de "o último registro NÃO foi salvo" na tela, e SESSENTA POR
    // CENTO dessa cota era o catálogo.
    //
    // POR QUE ELE NUNCA PRECISOU ESTAR AÍ. Os 15.139 clientes e 4.010
    // produtos vêm da planilha Dados SAC EMBARCADA em js/mockData.js — um
    // arquivo de 3,1 MB que o navegador já baixa e guarda no cache de
    // ARQUIVOS, que não tem teto de 5 MB e não disputa cota com nada.
    // Copiá-los para o localStorage era guardar, no balde pequeno, uma
    // segunda cópia do que já estava no balde grande.
    //
    // O QUE VALE AGORA. A lista em tela continua idêntica, montada em
    // memória a cada abertura: SEMENTE (mockData.js) + DELTA (o que este
    // aparelho tem de diferente — cadastro novo, edição, exclusão). Só o
    // delta é persistido, e ele mora no IndexedDB, com espelho síncrono no
    // localStorage enquanto for pequeno. Ver js/catalogoStore.js.
    //
    // DOIS FORMATOS ANTIGOS SÃO MIGRADOS AQUI, sem perda e uma vez só:
    // o monolítico (clientes/produtos dentro de 'jr_sac_db') e o de duas
    // chaves ('jr_sac_static'). É essa migração que devolve os ~2,9 MB.
    // =================================================================
    const isFirstInstall = !localStorage.getItem('jr_sac_db');
    let catalogoLegado = null;
    try {
      const storedVersion = localStorage.getItem('jr_sac_version');
      const currentVersion = '6.4.2';
      if (isFirstInstall) {
        // Primeira vez: grava só a fatia operacional. O catálogo NÃO é
        // gravado — ele vem de INITIAL_DATA a cada abertura.
        try {
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
      this.data = rawDb ? JSON.parse(rawDb) : null;

      // (a) formato MONOLÍTICO: clientes/produtos dentro de 'jr_sac_db'.
      if (this.data && (Array.isArray(this.data.clientes) || Array.isArray(this.data.produtos))) {
        catalogoLegado = { clientes: this.data.clientes || [], produtos: this.data.produtos || [] };
        console.info('[Store] Instalação no formato monolítico: catálogo será convertido em delta.');
      }
      // (b) formato DE DUAS CHAVES: 'jr_sac_static'. Vence o monolítico
      // quando os dois existem — é o mais recente dos dois.
      const cat = this._catalogoStore();
      const antigo = cat ? cat.lerFormatoAntigo() : null;
      if (antigo) {
        catalogoLegado = antigo;
        console.info('[Store] Convertendo jr_sac_static em delta — os KB dele voltam para a cota do aparelho.');
      }
    } catch(e) {
      console.warn("Usando INITIAL_DATA devido a exceção no localStorage:", e);
      this.data = null;
    }

    if (!this.data || typeof this.data !== 'object') {
      this.data = (typeof INITIAL_DATA !== 'undefined') ? JSON.parse(JSON.stringify(INITIAL_DATA)) : {};
    }

    // MONTA O CATÁLOGO: semente (mockData.js) + delta (o que é deste
    // aparelho). É aqui que 'jr_sac_static' deixa de existir. Repare que a
    // antiga "garantia de sincronia com as bases mestres" — que trocava a
    // lista inteira pela planilha sempre que ela ficasse MENOR que a
    // semente — sumiu junto, e de propósito: ela era um remendo para o
    // catálogo persistido poder divergir da planilha, e a semente agora É a
    // planilha, por construção. De quebra, some o efeito colateral que ela
    // tinha: excluir clientes até a lista ficar menor que a planilha
    // apagava, na abertura seguinte, TODO cadastro manual feito desde então.
    let precisaRegravar = this._montarCatalogo(catalogoLegado);

    if (typeof INITIAL_DATA !== 'undefined') {
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
        if (this.restaurarCadastrosDaPlanilha() > 0) precisaRegravar = true;
        try { localStorage.setItem('jr_seed_cadastros_v1', agoraIsoBrasilia()); } catch(e) {}
      }
    }

    if (precisaRegravar) {
      // Regrava o bloco operacional já sem clientes/produtos dentro — é
      // esta gravação que apaga, de vez, o catálogo que estava dentro do
      // 'jr_sac_db' das instalações no formato monolítico.
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
  // que desde 31/08/2026 nem sequer são persistidos por inteiro: vão para o
  // IndexedDB, e só o delta (ver js/catalogoStore.js). É essa fatia que
  // save() grava a cada operação; por isso cada gravação passou de ~3MB
  // para poucas dezenas de KB.
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

  // =================================================================
  // CATÁLOGO MESTRE (CLIENTES E PRODUTOS) — ver js/catalogoStore.js
  //
  // A lista completa não é mais persistida: ela é montada a cada abertura
  // como SEMENTE (js/mockData.js, que não gasta cota) + DELTA (o que este
  // aparelho tem de diferente). Só o delta vai para o disco, e ele mora no
  // IndexedDB. Foi isso que devolveu ~2,9 MB dos ~5 MB de localStorage.
  // =================================================================
  _catalogoStore() {
    try {
      if (typeof window !== 'undefined' && window.catalogoStore) return window.catalogoStore;
      if (typeof catalogoStore !== 'undefined' && catalogoStore) return catalogoStore;
    } catch(e) {}
    return null;
  }

  _catalogoClasse() {
    try {
      if (typeof window !== 'undefined' && window.CatalogoStore) return window.CatalogoStore;
      if (typeof CatalogoStore !== 'undefined') return CatalogoStore;
    } catch(e) {}
    return null;
  }

  // A régua contra a qual o delta é medido. NÃO é copiada: quem usa isto
  // só lê. Quem monta a lista de trabalho é _montarCatalogo(), e é ele que
  // faz as cópias — assim INITIAL_DATA nunca é editado por acidente e
  // continua sendo a mesma régua na gravação seguinte.
  _sementeDoCatalogo() {
    const D = (typeof INITIAL_DATA !== 'undefined') ? INITIAL_DATA : {};
    return {
      clientes: Array.isArray(D.clientes) ? D.clientes : [],
      produtos: Array.isArray(D.produtos) ? D.produtos : []
    };
  }

  // Devolve true se a fatia operacional precisa ser regravada (migração de
  // instalação antiga, que é o que apaga o catálogo de dentro do jr_sac_db).
  _montarCatalogo(catalogoLegado) {
    const CS = this._catalogoStore();
    const Classe = this._catalogoClasse();
    const semente = this._sementeDoCatalogo();

    // Sem o módulo do catálogo (arquivo não carregou) o app não pode ficar
    // sem lista: cai na semente pura, em memória, e não persiste nada — que
    // é exatamente o comportamento seguro, porque gravar um delta calculado
    // contra uma régua que talvez não seja a certa apagaria cadastro.
    if (!CS || !Classe) {
      console.warn('[Store] js/catalogoStore.js não carregou — catálogo em memória, sem persistência de cadastro novo.');
      this.data.clientes = JSON.parse(JSON.stringify(semente.clientes));
      this.data.produtos = JSON.parse(JSON.stringify(semente.produtos));
      this._catalogoPronto = false;
      this._catalogoDeltaAplicado = null;
      this._anotarTamanhoDoCatalogo();
      return false;
    }

    let delta = null;
    let migrou = false;

    if (catalogoLegado) {
      // MIGRAÇÃO (roda uma vez por aparelho): o catálogo inteiro que estava
      // no localStorage vira delta. Tudo que este aparelho tinha de
      // diferente da planilha — cadastro manual, edição, exclusão — é
      // preservado; o que era igual à planilha simplesmente para de ocupar
      // espaço, porque a planilha continua embarcada.
      delta = Classe.calcularDelta(catalogoLegado, semente);
      CS.gravar(delta);
      const kb = CS.descartarFormatoAntigo();
      migrou = true;
      console.info(`[Store] Catálogo migrado para o IndexedDB. Delta deste aparelho: `
        + `${(delta.clientes || []).length} cliente(s) e ${(delta.produtos || []).length} produto(s) `
        + `diferentes da planilha` + (kb ? `, ${kb} KB devolvidos à cota.` : '.'));
    } else {
      // Caminho normal: o espelho síncrono responde antes de qualquer
      // promise resolver, e é por isso que o primeiro paint não mudou.
      delta = CS.lerSincrono();
    }

    // 'soIdb' é a marca deixada por catalogoStore.gravar() quando o delta
    // cresceu além do espelho: existe delta, mas ele só chega pelo
    // IndexedDB. Aplicar {} aqui seria montar a lista sem os cadastros
    // manuais — e um save() antes do IndexedDB responder gravaria um delta
    // que os apaga. Por isso a persistência fica TRAVADA até a leitura
    // assíncrona chegar (_catalogoPronto abaixo).
    const soIdb = !!(delta && delta.soIdb);
    const aplicado = Classe.aplicar(semente, soIdb ? null : delta);
    this.data.clientes = aplicado.clientes;
    this.data.produtos = aplicado.produtos;
    this._catalogoDeltaAplicado = soIdb ? null : JSON.stringify(delta || null);
    this._anotarTamanhoDoCatalogo();

    // Depois da migração o delta em memória JÁ é a verdade — não há o que
    // conferir com o IndexedDB, e destravar aqui evita uma janela em que
    // um cadastro novo não seria gravado.
    this._catalogoPronto = migrou || !CS.disponivel();

    if (!this._catalogoPronto) {
      // Confere com a casa definitiva em segundo plano. Se o IndexedDB
      // trouxer algo diferente do que já está na tela (outra aba cadastrou,
      // ou o espelho não coube na última gravação), reaplica e redesenha.
      CS.carregar().then(doIdb => {
        try {
          const serial = JSON.stringify(doIdb || null);
          // Se alguma coisa mudou o catálogo enquanto isto viajava, o que
          // está na memória é mais novo que o disco: não sobrescreve.
          if (this._catalogoSujo) return;
          if (serial !== this._catalogoDeltaAplicado) {
            const novo = Classe.aplicar(semente, doIdb);
            this.data.clientes = novo.clientes;
            this.data.produtos = novo.produtos;
            this._catalogoDeltaAplicado = serial;
            this._anotarTamanhoDoCatalogo();
            if (typeof window !== 'undefined' && window.dispatchEvent) {
              window.dispatchEvent(new CustomEvent('jr-cloud-sync', { detail: { origem: 'catalogo' } }));
            }
          }
        } finally {
          this._catalogoPronto = true;
        }
      }).catch(e => {
        console.warn('[Store] Falha ao ler o catálogo do IndexedDB — vale o espelho síncrono.', e && e.message);
        this._catalogoPronto = true;
      });
    }

    return migrou;
  }

  // Marca que clientes/produtos mudaram. Chamado pelos poucos pontos que de
  // fato mexem no catálogo; save() é quem persiste. Separar os dois é o que
  // evita recalcular o delta (uma varredura nos 19 mil registros) a cada
  // gravação de qualquer outra tela.
  marcarCatalogoSujo() {
    this._catalogoSujo = true;
  }

  // =================================================================
  // A PONTE COM A NUVEM — 31/08/2026
  //
  // Até esta data, cliente e produto cadastrados pela tela NÃO chegavam nos
  // outros aparelhos: as tabelas existiam no Supabase e nunca estiveram no
  // MAPA_TABELAS do cloudStore. O motivo era volume — sincronizar do jeito
  // das outras 25 tabelas é ler 19 mil linhas a cada 30 segundos.
  //
  // Com o catálogo em semente + delta, o que precisa viajar é o DELTA. Estas
  // duas funções são a interface: o cloudStore não sabe (e não precisa
  // saber) o que é semente — ele pede o que este aparelho tem de próprio e
  // entrega o que os outros mandaram.
  // =================================================================

  // O que este aparelho deve à nuvem: o delta, mais uma LÁPIDE por registro
  // da planilha que foi excluído em definitivo aqui.
  //
  // A lápide é necessária porque a semente é embarcada e igual em todo
  // aparelho: "sumiu da minha lista" não é uma informação que viaje sozinha.
  // Ela vai como o registro da planilha marcado com is_deleted — que é
  // exatamente o que a exclusão pela Lixeira já produz, então os outros
  // aparelhos tratam os dois casos pelo mesmo caminho e não precisam
  // conhecer o conceito de lápide.
  getCatalogoParaSync() {
    const Classe = this._catalogoClasse();
    const vazio = { clientes: [], produtos: [] };
    if (!Classe) return vazio;

    const semente = this._sementeDoCatalogo();
    const delta = Classe.calcularDelta(
      { clientes: this.data.clientes || [], produtos: this.data.produtos || [] },
      semente
    );

    const quando = agoraIsoBrasilia();
    const comLapides = (colecao) => {
      const saida = (delta[colecao] || []).slice();
      const removidos = (delta.removidos && delta.removidos[colecao]) || [];
      if (removidos.length) {
        const naSemente = new Map((semente[colecao] || []).map(r => [String(r.id), r]));
        removidos.forEach(id => {
          const base = naSemente.get(String(id));
          if (!base) return;
          saida.push(Object.assign({}, base, {
            is_deleted: true,
            deleted_at: quando,
            deleted_by_nome: (this.currentUser && this.currentUser.nome) || 'SISTEMA'
          }));
        });
      }
      return saida;
    };

    return { clientes: comLapides('clientes'), produtos: comLapides('produtos') };
  }

  // O que veio da nuvem. Recebe { clientes: [...], produtos: [...] } já
  // filtrado pelo cloudStore (ele é quem sabe o que este aparelho está
  // recusando por ter mudança não enviada).
  //
  // Para um registro que EXISTE na planilha, mescla por cima da semente em
  // vez de substituir: a linha da nuvem só tem as colunas reais da tabela, e
  // a da planilha carrega também `codigo` e `nome`, que são campos do app.
  // Substituir apagaria os dois — e a projeção do resultado continua igual à
  // linha da nuvem, então isso não faz o registro parecer alterado.
  aplicarCatalogoDaNuvem(porColecao) {
    if (!porColecao) return false;
    const semente = this._sementeDoCatalogo();
    let mudou = false;

    ['clientes', 'produtos'].forEach(colecao => {
      const chegando = porColecao[colecao];
      if (!Array.isArray(chegando) || !chegando.length) return;

      if (!Array.isArray(this.data[colecao])) this.data[colecao] = [];
      const naSemente = new Map((semente[colecao] || []).map(r => [String(r.id), r]));
      const posicao = new Map();
      this.data[colecao].forEach((r, i) => {
        if (r && r.id !== undefined && r.id !== null) posicao.set(String(r.id), i);
      });

      chegando.forEach(linha => {
        if (!linha || linha.id === undefined || linha.id === null) return;
        const id = String(linha.id);
        const base = naSemente.get(id);
        const registro = base ? Object.assign({}, base, linha) : linha;
        const i = posicao.get(id);
        if (i === undefined) {
          this.data[colecao].push(registro);
          posicao.set(id, this.data[colecao].length - 1);
        } else {
          this.data[colecao][i] = registro;
        }
        mudou = true;
      });
    });

    if (mudou) {
      // saveStaticCatalog() recalcula o delta a partir da lista inteira. É
      // isso que faz a lápide local sumir sozinha quando o registro volta
      // pela nuvem: ele passa a estar na lista, logo deixa de ser "removido".
      this.marcarCatalogoSujo();
      this.saveStaticCatalog();
    }
    return mudou;
  }

  // Rede de segurança do save(): inclusão ou exclusão que tenha esquecido
  // marcarCatalogoSujo() ainda assim muda o TAMANHO da lista, e isso custa
  // duas comparações de inteiro por gravação.
  _catalogoMudouDeTamanho() {
    const c = (this.data.clientes || []).length;
    const p = (this.data.produtos || []).length;
    const ref = this._catalogoTamanhos;
    if (!ref) return false;
    return ref.clientes !== c || ref.produtos !== p;
  }

  _anotarTamanhoDoCatalogo() {
    this._catalogoTamanhos = {
      clientes: (this.data.clientes || []).length,
      produtos: (this.data.produtos || []).length
    };
  }

  // Grava o delta do catálogo. Mantém o nome antigo porque é o que o resto
  // do código chama; o que mudou é o destino — IndexedDB em vez dos ~2,9 MB
  // de localStorage.
  saveStaticCatalog() {
    const CS = this._catalogoStore();
    const Classe = this._catalogoClasse();
    if (!CS || !Classe) return false;

    // Trava de segurança: enquanto a leitura assíncrona não voltou, o que
    // está em memória pode ser MENOS do que o disco tem. Gravar aqui
    // apagaria a diferença. O ponto que sujou o catálogo continua marcado,
    // e o save() seguinte grava.
    if (!this._catalogoPronto) return false;

    const delta = Classe.calcularDelta(
      { clientes: this.data.clientes || [], produtos: this.data.produtos || [] },
      this._sementeDoCatalogo()
    );
    const serial = JSON.stringify(delta);
    this._catalogoSujo = false;
    this._anotarTamanhoDoCatalogo();

    // Nada mudou de fato (ex: só a ordenação do sortAll): não gasta escrita.
    // A comparação ignora o carimbo, que muda a cada cálculo.
    const semCarimbo = s => String(s || '').replace(/"carimbo":"[^"]*",?/, '');
    if (semCarimbo(serial) === semCarimbo(this._catalogoDeltaAplicado)) return true;

    this._catalogoDeltaAplicado = serial;
    CS.gravar(delta).then(ok => {
      if (!ok) {
        // Sem IndexedDB E sem espelho: o cadastro não existe em lugar
        // nenhum. Reaproveita a tarja vermelha que o save() já sabe pintar.
        this._alertarFalhaDeGravacao(new Error('O cadastro de cliente/produto não pôde ser gravado neste aparelho.'));
      }
    }).catch(() => {});
    return true;
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

    // O catálogo tem casa própria desde 31/08/2026 (IndexedDB, ver
    // js/catalogoStore.js) e por isso não viaja dentro deste payload. Se
    // ele mudou, é aqui que vai para o disco.
    //
    // A checagem por TAMANHO existe ALÉM da marca explícita de propósito:
    // hoje quem mexe no catálogo chama add*/softDelete/restoreItem, mas
    // nada impede um caminho novo de dar push direto no array — e cadastro
    // que não é gravado é a falha mais cara que existe aqui, porque é
    // silenciosa. A marca pega as EDIÇÕES (que não mudam o tamanho), o
    // tamanho pega as INCLUSÕES e EXCLUSÕES que esqueceram a marca.
    try {
      if (this._catalogoSujo || this._catalogoMudouDeTamanho()) this.saveStaticCatalog();
    } catch(eCat) {
      console.warn("[Store] Falha ao gravar o catálogo de clientes/produtos:", eCat);
    }

    const payload = JSON.stringify(this._getOperationalSlice());
    if (this._gravarFatiaOperacional(payload)) return true;
    console.error('[Store] Falha ao salvar dados operacionais no localStorage (tentativa 1):', this._ultimoErroDeGravacao);

    // =================================================================
    // ESCADA DE RECUPERAÇÃO DE COTA — reescrita em 04/09/2026
    //
    // O QUE ACONTECEU. Um aparelho abriu com 4.634 KB de ~5.120 (91%) e a
    // tarja "o último registro NÃO foi salvo". Dos 4.634, só 3.666 eram o
    // jr_sac_db: os ~970 KB restantes eram as 25 chaves-espelho da nuvem,
    // que são CÓPIA do próprio jr_sac_db e se refazem sozinhas no pull
    // seguinte. Havia espaço de sobra para o lançamento caber — só que
    // ninguém foi buscar.
    //
    // POR QUE NINGUÉM FOI BUSCAR. A recuperação daqui sabia fazer uma
    // coisa só: pruneOldAuditData(), que corta audit_logs acima de 300 e
    // registro_versoes acima de 500. Naquele aparelho havia 84 e 6. Ela
    // devolveu false — e o `if (liberou)` mandava direto para o alerta,
    // SEM NENHUMA SEGUNDA TENTATIVA de gravação. O único degrau que
    // existia era justamente o que não tinha o que cortar.
    //
    // Agora a ordem é a mesma que o caminho de LEITURA já usa desde
    // 28/08/2026 (cloudStore._gravarCacheDoPull): joga fora CÓPIA antes de
    // jogar fora ORIGINAL. Primeiro os espelhos, que são duplicata pura;
    // só depois o histórico, que só existe uma vez. E cada degrau tenta
    // gravar por conta própria, em vez de um `if` único que podia sair
    // pela tangente sem tentar nada.
    // =================================================================
    let ultimoErro = this._ultimoErroDeGravacao;

    // Degrau 1 — as 25 cópias. É o degrau que faltava, e é o que resolve o
    // caso real: devolve de uma vez o espaço de um jr_sac_db inteiro.
    if (this._purgarEspelhosDaNuvem() > 0) {
      if (this._gravarFatiaOperacional(JSON.stringify(this._getOperationalSlice()))) {
        console.info('[Store] Gravação bem-sucedida após liberar as cópias de diagnóstico da nuvem. '
          + 'Nenhum dado de negócio foi descartado: os espelhos são cópia do jr_sac_db e voltam sozinhos quando houver folga.');
        return true;
      }
      ultimoErro = this._ultimoErroDeGravacao;
    }

    // Degrau 2 — as chaves sem dono. Vêm ANTES do histórico porque não são
    // nem cópia: são resto de build antiga que ninguém lê. Num aparelho de
    // produção, em 04/09/2026, isto valia 883 KB (jr_produtos, jr_rotas,
    // jr_departamentos) — mais do que os 25 espelhos do degrau 1.
    if (this._purgarChavesOrfasDaNuvem() > 0) {
      if (this._gravarFatiaOperacional(JSON.stringify(this._getOperationalSlice()))) {
        console.info('[Store] Gravação bem-sucedida após a faxina de chaves sem dono.');
        return true;
      }
      ultimoErro = this._ultimoErroDeGravacao;
    }

    // Degrau 3 — o histórico de auditoria/versões. Só chega aqui se
    // sacrificar as cópias e o resto não tiver bastado.
    if (this.pruneOldAuditData()) {
      if (this._gravarFatiaOperacional(JSON.stringify(this._getOperationalSlice()))) {
        console.info('[Store] Gravação bem-sucedida após reduzir o histórico de auditoria/versões.');
        return true;
      }
      ultimoErro = this._ultimoErroDeGravacao;
    }

    console.error('[Store] Falha ao salvar mesmo após liberar espaço:', ultimoErro);
    this._alertarFalhaDeGravacao(ultimoErro);

    // ÚLTIMO RECURSO: o registro existe em this.data e não existe no
    // disco. Se a nuvem estiver configurada, ela é a única cópia durável
    // que sobrou — e o push lê a MEMÓRIA (ver cloudStore.syncLocalToCloud),
    // justamente para não depender do jr_sac_db que acabou de não caber.
    // Sem esta linha o lançamento morria aqui: não estava no disco, não
    // subia para a nuvem, e sumia no primeiro F5.
    this._scheduleCloudSync();
    return false;
  }

  // Uma tentativa de gravação da fatia operacional. Devolve true/false e
  // guarda o erro em _ultimoErroDeGravacao, para a escada acima poder
  // repetir a tentativa a cada degrau sem repetir o bloco try/catch.
  _gravarFatiaOperacional(payload) {
    try {
      localStorage.setItem('jr_sac_db', payload);
      this._ultimoErroDeGravacao = null;
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
      this._ultimoErroDeGravacao = e;
      return false;
    }
  }

  // Descarta as 25 chaves-espelho da nuvem (jr_ocorrencias, jr_reentregas,
  // ...). Elas são cópia do que está no jr_sac_db, existem para
  // diagnóstico e se refazem sozinhas no próximo pull que couber — por
  // isso são a PRIMEIRA coisa a ser sacrificada quando falta cota, antes
  // de qualquer dado que só exista uma vez.
  //
  // Também levanta a bandeira _espelhosSuspensos no cloudStore: sem ela o
  // próximo pull reescreveria os mesmos ~970 KB e o aperto voltaria em
  // seguida — trocar seis por meia dúzia.
  /**
   * Descarta chaves de localStorage que nenhum caminho vivo do app escreve ou
   * le - resto de build antiga. Ver CloudStore.chavesConhecidas() para o
   * inventario e o porque de a lista ser do que EXISTE, e nao do que e lixo.
   */
  _purgarChavesOrfasDaNuvem() {
    try {
      const cs = (typeof window !== 'undefined') ? window.cloudStore : null;
      if (!cs || typeof cs._purgarChavesOrfas !== 'function') return 0;
      return cs._purgarChavesOrfas();
    } catch(e) {
      console.warn('[Store] Falha na faxina de chaves sem dono:', e);
      return 0;
    }
  }

  _purgarEspelhosDaNuvem() {
    try {
      const cs = (typeof window !== 'undefined') ? window.cloudStore : null;
      if (!cs || typeof cs._purgarEspelhos !== 'function') return 0;
      const removidos = cs._purgarEspelhos();
      if (removidos > 0) cs._espelhosSuspensos = true;
      return removidos;
    } catch(e) {
      console.warn('[Store] Falha ao liberar as cópias de diagnóstico:', e);
      return 0;
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
        // 31/08/2026: o que sobrou do catálogo aqui é só o DELTA (espelho
        // síncrono do IndexedDB). O 'jr_sac_static' de ~2.994 KB deixou de
        // existir — se ele ainda aparecer nesta contagem, este aparelho
        // abriu o app numa build anterior a esta e a migração ainda não
        // rodou. Ver js/catalogoStore.js.
        else if (k === 'jr_sac_static_delta' || k === 'jr_sac_static') estaticoKB += tam;
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
      nivel,
      // Onde o catálogo mora agora, e quanto ele ainda custa de cota aqui.
      // formatoAntigoAindaPresenteKB > 0 é a resposta direta para
      // "por que este aparelho continua cheio?".
      catalogo: (() => {
        try {
          const CS = this._catalogoStore();
          return CS ? CS.getDiagnostico() : null;
        } catch(e) { return null; }
      })()
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
      // Voltar para INITIAL_DATA é, por definição, delta zero. Apagar o
      // delta é mais honesto (e mais barato) do que gravar um delta vazio
      // por cima: sobra menos estado antigo para explicar depois.
      const CS = this._catalogoStore();
      if (CS) CS.limparTudo().catch(() => {});
      this._catalogoDeltaAplicado = null;
      this._catalogoSujo = false;
      this._catalogoPronto = true;
      this._anotarTamanhoDoCatalogo();
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
      
      // !i.is_deleted entrou junto com updateDevolucaoSac (31/08/2026). Antes
      // dele nao fazia falta: o unico jeito de um item ficar marcado era a
      // devolucao inteira ir para a Lixeira (deleteDevolucao marca os filhos
      // junto), e ai o pai ja saia desta lista no filtro de cima. Com a
      // correcao de item, a lapide passou a existir SOZINHA - item trocado
      // numa devolucao viva - e sem este filtro o produto errado continuaria
      // aparecendo em todas as telas depois de corrigido.
      const itens = (this.data.itens_devolucao || []).filter(i => i.ocorrencia_devolucao_id == d.id && !i.is_deleted).map(i => {
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

  // ---------------------------------------------------------------
  // EXCLUSAO DA OCORRENCIA INTEIRA - 26/08/2026
  //
  // POR QUE FALTAVA. A 5.4.0 deu a exclusao da MIDIA (excluirMidiaDevolucao,
  // logo abaixo), e parou ai. A ocorrencia em si nao tinha saida em etapa
  // nenhuma: nem na Analise & Causa Raiz, nem nas Tratativas do Gestor, nem
  // na Recepcao CD. Todo outro modulo do app ja tinha - deleteOcorrenciaRota
  // para chamado em rota, deleteCad para os cadastros, e a propria
  // getLixeiraItems() JA LISTAVA 'ocorrencias_devolucao' como coleccao
  // restauravel. Ou seja, a Lixeira sabia receber devolucao desde sempre;
  // o que nao existia era alguem que a mandasse para la.
  //
  // O RESULTADO PRATICO DISSO foi a DEV-2026-001 e a DEV-2026-002: registros
  // de teste de 23/08 que ninguem conseguiu tirar da tela, sobreviveram ao
  // Reset Global de 26/08 e ficaram no meio da producao. Quando a unica
  // ferramenta de limpeza e o Reset Global, limpar uma linha exige zerar
  // tudo - e ninguem faz isso com a operacao rodando.
  //
  // E SOFT DELETE, e nao definitivo, pelo mesmo criterio dos outros modulos:
  // vai para Governanca & Lixeira, pode ser restaurado, e a exclusao
  // definitiva continua atras da senha de administrador la. Devolucao e
  // documento de valor contratual; quem apaga por engano precisa de volta.
  //
  // NAO EXIGE SENHA no soft delete, igual a deleteOcorrenciaRota - quem
  // autoriza e o rastro: softDelete grava EXCLUSAO_LOGICA em audit_logs com
  // nome e hora, e getLixeiraItems mostra a linha com quem excluiu.
  deleteDevolucao(id) {
    const item = (this.data.ocorrencias_devolucao || []).find(x => x.id == id);
    if (!item) return { success: false, message: `Devolucao ID ${id} nao encontrada.` };
    if (item.is_deleted) return { success: false, message: 'Esta devolucao ja esta na Lixeira.' };

    // Os itens filhos acompanham. Sem isto eles viram orfaos: somem da tela
    // junto com a ocorrencia (nada os le sozinhos), mas continuam contando em
    // qualquer relatorio que leia itens_devolucao direto - e o Power BI le.
    let itensMarcados = 0;
    (this.data.itens_devolucao || []).forEach(it => {
      if (it.ocorrencia_devolucao_id == id && !it.is_deleted) {
        it.is_deleted = true;
        it.deleted_at = agoraIsoBrasilia();
        it.deleted_by_usuario_id = this.currentUser ? this.currentUser.id : null;
        it.deleted_by_nome = this.currentUser ? this.currentUser.nome : 'SISTEMA';
        itensMarcados++;
      }
    });

    const ok = this.softDelete('ocorrencias_devolucao', id);
    if (!ok) return { success: false, message: 'Nao foi possivel mover esta devolucao para a Lixeira.' };

    return {
      success: true,
      protocolo: item.numero_devolucao || item.numero_protocolo || `ID #${id}`,
      itens: itensMarcados
    };
  }

  // ---------------------------------------------------------------
  // CORRECAO DA DEVOLUCAO ABERTA PELO SAC - 31/08/2026
  //
  // POR QUE FALTAVA. addDevolucao gravava itens_devolucao com push e ninguem
  // mais tocava naquelas linhas: updateInvestigacao mexe na apuracao (causa
  // raiz, separador, acao tomada) e updateDestinoCd mexe no destino fisico.
  // Produto, quantidade, valor e motivo do item eram gravados uma vez e
  // ficavam. Digitou o item errado na abertura, a unica saida era
  // deleteDevolucao + reabrir - e ai a devolucao ganha numero novo
  // (getNextSequenceNumber varre ate os excluidos, entao o numero antigo nao
  // volta e fica um buraco na sequencia), o SAC redigita carga, cliente, NF,
  // detalhamento e midia, e quem ja recebeu o protocolo antigo precisa ser
  // avisado da troca.
  //
  // SO ANTES DO CD RECEBER. Depois de updateDestinoCd o item carrega
  // destino_item, data_validade e status_negociacao - decisao tomada com a
  // mercadoria na mao. Reescrever o item ali apagaria isso, entao a porta
  // fecha em status_fechamento != 'PENDENTE_FISICO' e a correcao passa a ser
  // a do proprio CD (openEditarItemDestinoModal).
  //
  // ITEM REMOVIDO VIRA LAPIDE, NUNCA splice. _mesclarPorRegistro (cloudStore)
  // deduz exclusao de "id que eu conheco e nao veio da nuvem", o que so vale
  // porque a leitura traz a tabela inteira: linha tirada so daqui, que
  // continua la, volta no ciclo seguinte de 30 segundos. E o mesmo motivo
  // pelo qual deleteDevolucao marca os filhos em vez de remove-los.
  //
  // NAO CRIA CAMPO NOVO no registro. O envio manda o objeto como ele esta, e
  // coluna inexistente derruba o lote inteiro com PGRST204 - foi o que
  // 'rota_nome' fez com cargas em 21/08/2026, levando junto toda devolucao
  // aberta contra carga nova. Por isso o motivo da correcao vive em
  // audit_logs.diff (JSONB, aceita qualquer forma) e nao numa coluna nova.
  updateDevolucaoSac(id, dados, itens) {
    const dev = (this.data.ocorrencias_devolucao || []).find(d => d.id == id);
    if (!dev) return { success: false, message: 'Devolução não encontrada neste aparelho.' };
    if (dev.is_deleted) return { success: false, message: 'Esta devolução está na Lixeira. Restaure-a em Governança & Lixeira antes de corrigir.' };

    const statusAtual = dev.status_fechamento || 'PENDENTE_FISICO';
    if (statusAtual !== 'PENDENTE_FISICO') {
      return {
        success: false,
        message: 'O CD já recebeu o retorno físico desta devolução. A partir daqui a correção do item é feita na tela Retorno Físico CD, no ✏️ do próprio item.'
      };
    }

    const entrada = dados || {};
    const agora = agoraIsoBrasilia();
    const usuarioId = this.currentUser ? this.currentUser.id : null;
    const usuarioNome = this.currentUser ? this.currentUser.nome : 'SISTEMA';

    const resumoItem = i => ({
      id: i.id,
      produto_id: i.produto_id,
      quantidade: i.quantidade,
      valor_unitario: i.valor_unitario,
      motivo_item: i.motivo_item
    });

    const itensAntes = (this.data.itens_devolucao || [])
      .filter(i => i.ocorrencia_devolucao_id == id && !i.is_deleted)
      .map(resumoItem);

    const cabecalhoAntes = {
      cliente_nome: dev.cliente_nome,
      nota_fiscal: dev.nota_fiscal,
      motivo_reclamado: dev.motivo_reclamado,
      forma_acerto: dev.forma_acerto,
      valor_reclamado: dev.valor_reclamado
    };

    // Snapshot ANTES de qualquer escrita. Versionar devolucao e barato desde
    // 26/08/2026: _podarMidiaDaVersao troca o base64 das fotos por um marcador
    // de tamanho, entao o historico nao cresce em megabytes por edicao.
    //
    // A versao leva so o registro pai. itens_devolucao e outra colecao e
    // rollbackVersion grava dados_json de volta na colecao inteira - pendurar
    // os itens aqui faria o rollback escrever um campo que a tabela nao tem.
    // O antes/depois dos itens fica no audit_logs, que e justamente o que o
    // "📜 Ver histórico" do card le (abrirHistoricoRegistro).
    this.saveVersion('ocorrencias_devolucao', dev);

    const semItens = entrada.sem_itens === true || entrada.sem_itens === 'true';

    dev.cliente_id = parseInt(entrada.cliente_id) || null;
    dev.cliente_nome = String(entrada.cliente_nome || '').toUpperCase().trim();
    dev.nota_fiscal = String(entrada.nota_fiscal || '').toUpperCase().trim();
    dev.motivo_reclamado = String(entrada.motivo_reclamado || '').toUpperCase().trim();
    dev.forma_acerto = String(entrada.forma_acerto || '').toUpperCase().trim();
    dev.cliente_emite_nf = entrada.cliente_emite_nf === 'sim' || entrada.cliente_emite_nf === true;
    dev.valor_reclamado = parseFloat(entrada.valor_reclamado) || 0;
    dev.detalhamento_texto = String(entrada.detalhamento_texto || '').toUpperCase().trim();
    dev.sem_itens = semItens;
    dev.observacao_sem_itens = semItens ? String(entrada.observacao_sem_itens || '').toUpperCase().trim() : '';

    if (!this.data.itens_devolucao) this.data.itens_devolucao = [];
    const enviados = semItens ? [] : (Array.isArray(itens) ? itens : []);
    const idsMantidos = new Set();
    let criados = 0, atualizados = 0, removidos = 0;

    enviados.forEach(f => {
      // A busca ignora de proposito o que ja esta com lapide: id reaproveitado
      // de item excluido entraria como linha nova, nunca como ressurreicao.
      const existente = (f.id !== undefined && f.id !== null && String(f.id) !== '')
        ? this.data.itens_devolucao.find(i => String(i.id) === String(f.id) && i.ocorrencia_devolucao_id == id && !i.is_deleted)
        : null;

      // Os mesmos campos que addDevolucao grava, com as mesmas conversoes, e
      // so eles - de proposito, nos tres pontos:
      //
      // 1. produto_codigo/produto_descricao chegam do formulario mas sao
      //    derivados (getDevolucoes os remonta a partir de produtos) e nao tem
      //    coluna na tabela: gravar aqui seria o PGRST204 do cabecalho.
      // 2. parseInt em produto_id, e nao parseFloat nem o texto cru: a coluna
      //    e BIGINT (schema.sql, "ALTER COLUMN produto_id TYPE BIGINT"), entao
      //    produto digitado a mao e nao encontrado no cadastro vira nulo aqui
      //    exatamente como vira na abertura. Deixar passar o texto faria a
      //    correcao gerar uma linha que a criacao nunca geraria, e quebraria
      //    o envio inteiro da tabela.
      // 3. parseInt na quantidade porque a coluna e INT. Fracao digitada e
      //    truncada, igual na abertura - corrigir isso e mexer no tipo da
      //    coluna, nao neste caminho.
      const campos = {
        produto_id: parseInt(f.produto_id),
        quantidade: parseInt(f.quantidade) || 1,
        valor_unitario: parseFloat(f.valor_unitario) || 0,
        motivo_item: String(f.motivo_item || '').toUpperCase().trim()
      };

      if (existente) {
        Object.assign(existente, campos);
        existente.atualizado_em = agora;
        idsMantidos.add(String(existente.id));
        atualizados++;
      } else {
        const novo = Object.assign({ id: this.gerarIdUnico(), ocorrencia_devolucao_id: id }, campos);
        novo.atualizado_em = agora;
        this.data.itens_devolucao.push(novo);
        idsMantidos.add(String(novo.id));
        criados++;
      }
    });

    this.data.itens_devolucao.forEach(i => {
      if (i.ocorrencia_devolucao_id == id && !i.is_deleted && !idsMantidos.has(String(i.id))) {
        i.is_deleted = true;
        i.deleted_at = agora;
        i.deleted_by_usuario_id = usuarioId;
        i.deleted_by_nome = usuarioNome;
        i.atualizado_em = agora;
        removidos++;
      }
    });

    const itensDepois = this.data.itens_devolucao
      .filter(i => i.ocorrencia_devolucao_id == id && !i.is_deleted)
      .map(resumoItem);

    dev.atualizado_em = agora;
    dev.atualizado_por = usuarioNome;

    // Reabre a tratativa SO se ja havia apuracao. updateInvestigacao reabre
    // sempre porque la, por definicao, alguem acabou de apurar; aqui a
    // devolucao pode nunca ter passado pela Analise, e marcar PENDENTE_GESTOR
    // colocaria na mesa do gestor um chamado sem causa raiz nenhuma. Quando ha
    // apuracao, reabrir e obrigatorio: ela foi feita sobre o item antigo.
    if (dev.motivo_real_causa_raiz) dev.status_gestao = 'PENDENTE_GESTOR';

    this.logAudit({
      acao: 'EDICAO_DEVOLUCAO_SAC',
      modulo: 'ocorrencias_devolucao',
      registro_id: id,
      diff: {
        motivo_correcao: String(entrada.motivo_correcao || '').toUpperCase().trim(),
        antes: Object.assign({}, cabecalhoAntes, { itens: itensAntes }),
        depois: {
          cliente_nome: dev.cliente_nome,
          nota_fiscal: dev.nota_fiscal,
          motivo_reclamado: dev.motivo_reclamado,
          forma_acerto: dev.forma_acerto,
          valor_reclamado: dev.valor_reclamado,
          itens: itensDepois
        }
      }
    });

    this.save();

    return {
      success: true,
      protocolo: dev.numero_devolucao || dev.numero_protocolo || `ID #${id}`,
      criados,
      atualizados,
      removidos,
      reabriuGestor: !!dev.motivo_real_causa_raiz
    };
  }

  // ---------------------------------------------------------------
  // EXCLUSAO DE UMA MIDIA DA OCORRENCIA - 26/08/2026
  //
  // A midia era so-acrescimo: addDevolucao gravava os arrays, updateInvestigacao
  // so dava push, e renderGaleriaMidia so abria o lightbox. Nao existia caminho
  // de remocao em lugar nenhum - anexou errado, conviveu com o erro.
  //
  // DE PROPOSITO NAO CHAMA saveVersion(). saveVersion faz
  // JSON.parse(JSON.stringify(record)), ou seja, copia o registro INTEIRO para
  // registro_versoes - e as fotos da abertura sao base64 dentro do proprio
  // registro. Versionar aqui duplicaria o base64 que estamos tentando eliminar:
  // a "exclusao" faria o banco CRESCER. O rastro fica em audit_logs, que guarda
  // so os metadados (quem, quando, qual item, endereco ou impressao digital do
  // base64) e nunca o conteudo.
  //
  // TAMBEM NAO MEXE em status_gestao. updateInvestigacao reabre a tratativa do
  // gestor a cada edicao, e isso faz sentido para a apuracao; apagar um anexo
  // duplicado nao e reapuracao e nao deve reabrir nada.
  excluirMidiaDevolucao(id, campo, indice) {
    // Os dois *_paths entraram em 04/09/2026: desde a migration 38 a foto da
    // devolucao mora no Storage, e sem eles aqui a analista simplesmente nao
    // conseguiria mais excluir uma foto anexada por engano.
    //
    // O ARQUIVO EM SI CONTINUA NO BUCKET, de proposito - o bucket nega DELETE
    // (ver migration 38, secao 2), e prova operacional nao sai por um clique.
    // O que a exclusao faz e desligar a foto da ocorrencia: ela some de toda
    // tela e o endereco fica registrado na trilha, para quem precise recuperar.
    const CAMPOS_OK = [
      'fotos_abertura', 'videos_abertura', 'fotos_investigacao', 'videos_investigacao',
      'fotos_abertura_paths', 'fotos_investigacao_paths'
    ];
    if (!CAMPOS_OK.includes(campo)) {
      return { success: false, message: 'Campo de mídia inválido: ' + campo };
    }

    const dev = this.data.ocorrencias_devolucao.find(d => d.id == id);
    if (!dev) return { success: false, message: 'Ocorrência não encontrada neste aparelho.' };

    // Registros antigos guardam a midia unica em foto_url/video_url e nunca
    // chegaram a ter o array. A galeria mostra esses casos usando o alias como
    // se fosse o item 0 do array, entao a exclusao precisa enxergar o mesmo.
    if (!Array.isArray(dev[campo])) {
      const alias = campo === 'fotos_abertura' ? 'foto_url'
                  : campo === 'videos_abertura' ? 'video_url'
                  : campo === 'videos_investigacao' ? 'video_investigacao_url' : null;
      dev[campo] = (alias && dev[alias]) ? [dev[alias]] : [];
    }

    const i = parseInt(indice, 10);
    if (isNaN(i) || i < 0 || i >= dev[campo].length) {
      return { success: false, message: 'Esta mídia já não está mais na ocorrência.' };
    }

    const removido = dev[campo][i];
    dev[campo].splice(i, 1);

    // Os aliases legados sao espelho do 1o item (ver addDevolucao). Se ficarem
    // apontando para o que acabou de sair, a midia "excluida" reaparece em
    // qualquer tela que leia o alias - inclusive no modal de detalhes.
    if (campo === 'fotos_abertura')      dev.foto_url = dev.fotos_abertura[0] || '';
    // Excluir a 1a foto do Storage tambem tem de limpar o alias, senao ela
    // reaparece em qualquer tela que leia foto_url.
    if (campo === 'fotos_abertura_paths' && !((dev.fotos_abertura || []).length)) dev.foto_url = '';
    if (campo === 'videos_abertura')     dev.video_url = dev.videos_abertura[0] || '';
    if (campo === 'videos_investigacao') dev.video_investigacao_url = dev.videos_investigacao[0] || '';

    dev.atualizado_em = agoraIsoBrasilia();
    dev.atualizado_por = this.currentUser ? this.currentUser.nome : 'SISTEMA';

    // Caminho do Storage nao comeca com http (e relativo ao bucket:
    // 'devolucoes/123/abertura/...'), entao a checagem por http sozinha o
    // classificaria como base64 e a trilha registraria "base64 ~0 KB" no lugar
    // do endereco - perdendo justamente o dado que permite recuperar a foto.
    const ehArquivo = typeof removido === 'string'
      && (/^https?:/i.test(removido) || (removido.length > 0 && !removido.startsWith('data:')));
    this.logAudit({
      acao: 'EXCLUSAO_MIDIA',
      modulo: 'ocorrencias_devolucao',
      registro_id: id,
      diff: {
        campo,
        indice: i,
        protocolo: dev.numero_devolucao || dev.numero_protocolo || '',
        // Endereco quando e arquivo no Storage; quando e base64, so o tamanho e
        // o inicio - nunca o conteudo, que e justamente o peso que se quer tirar.
        referencia: ehArquivo ? removido : ('base64 ~' + Math.round(String(removido).length / 1024) + ' KB'),
        restantes: dev[campo].length
      }
    });

    this.save();
    return { success: true, removido, ehArquivo, message: 'Mídia excluída da ocorrência.' };
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
    this.marcarCatalogoSujo();
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

  // Lista única de nomes do CD usada nas seleções de Separador/Conferente da
  // apuração. Na prática a operação se mistura: separador que sabe conferir
  // assume a conferência, e conferente/empilhador ajuda na separação quando
  // aperta. Por isso aqui não se filtra por função — vem todo mundo do CD.
  getColaboradoresCDNomes() {
    const nomes = this.getColaboradoresCD()
      .filter(c => c.ativo !== false)
      .map(c => String(c.nome || '').trim())
      .filter(n => n !== '');
    const unicos = [...new Set(nomes)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return unicos.length > 0 ? unicos : (this.data.separadores_conferentes || []);
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
    // 31/08/2026 — OS DOIS CÓDIGOS GERADOS PASSARAM A SAIR DO id, e não do
    // relógio. Agora que clientes sincroniza (ver getCatalogoParaSync), os
    // dois índices UNIQUE PARCIAIS do banco (uq_clientes_codigo e
    // uq_clientes_cnpj, migration 24) deixaram de ser detalhe:
    //
    //   - codigo_cliente era `CLI-` + os 4 ÚLTIMOS dígitos do relógio. Quatro
    //     dígitos de milissegundo repetem a cada 10 segundos — dois clientes
    //     cadastrados no mesmo minuto tinham chance real de colidir, e uma
    //     colisão derruba com 23505 o LOTE INTEIRO do envio, não só a linha
    //     ruim. A própria migration 25 já tinha documentado esse risco.
    //   - cnpj era `SN` + Date.now(), que colide se dois cadastros caírem no
    //     mesmo milissegundo.
    //
    // gerarIdUnico() já resolve exatamente esse problema para o id (ver o
    // comentário dele: carimbo do aparelho + milissegundo virtual), então os
    // dois passam a derivar dele. 'SN' + 16 dígitos = 18 caracteres, dentro
    // do VARCHAR(20) do cnpj.
    const idNovo = this.gerarIdUnico();
    const item = {
      id: idNovo,
      codigo_cliente: clienteData.codigo || clienteData.codigo_cliente || `CLI-${idNovo}`,
      razao_social: String(clienteData.nome || clienteData.razao_social || '').trim().toUpperCase(),
      cidade: clienteData.cidade || '',
      uf: clienteData.uf || 'GO',
      cnpj: clienteData.cnpj_cpf || clienteData.cnpj || `SN${idNovo}`
    };
    if (!item.razao_social) return null;
    this.data.clientes.unshift(item);
    this.marcarCatalogoSujo();
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

    // Cliente e produto não moram no 'jr_sac_db' que o save() abaixo grava —
    // moram no delta do catálogo (js/catalogoStore.js). Sem esta marca, a
    // exclusão ficaria só na memória e voltaria no F5.
    if (collection === 'clientes' || collection === 'produtos') this.marcarCatalogoSujo();

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
    if (collection === 'clientes' || collection === 'produtos') this.marcarCatalogoSujo();

    // SIMETRIA COM deleteDevolucao(): ela marca os itens filhos junto, então
    // a restauracao tem de desmarca-los. Sem isto, restaurar uma devolucao
    // devolveria a ocorrencia SEM os itens reclamados - e o valor da tela
    // deixaria de bater com o da linha, sem nada na interface explicando por
    // que. Restaurar pela metade e pior que nao restaurar.
    if (collection === 'ocorrencias_devolucao') {
      (this.data.itens_devolucao || []).forEach(it => {
        if (it.ocorrencia_devolucao_id == id && it.is_deleted) {
          it.is_deleted = false;
          it.deleted_at = null;
          it.deleted_by_usuario_id = null;
          it.deleted_by_nome = null;
        }
      });
    }

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

  /**
   * Exclusão definitiva. PASSOU A SER async EM 26/08/2026, e a mudança não é
   * cosmética: até aqui este método apagava só o array local e dizia
   * "success". O registro continuava inteiro na nuvem, e o pull de 30
   * segundos o trazia de volta — cloudStore._mesclarPorRegistro() vê um id
   * que está na nuvem e não está aqui e conclui que este aparelho ainda não
   * o conhece, então adota o da nuvem. A exclusão "definitiva" durava menos
   * de meio minuto, e falhava sem nenhuma mensagem: quem apagava via a linha
   * sumir e só reencontrava o registro depois, sem saber por quê.
   *
   * ORDEM IMPORTA: apaga na NUVEM primeiro. Se a nuvem recusar (ou o aparelho
   * estiver sem rede), NÃO apaga aqui e devolve o erro. Apagar só do lado
   * local seria voltar exatamente ao bug — com o agravante de o usuário achar
   * que funcionou.
   */
  async hardDelete(collection, id, password) {
    if (String(password).trim() !== this.getAdminPassword()) {
      return { success: false, message: 'Senha de administrador incorreta.' };
    }
    if (!this.data[collection]) return { success: false, message: 'Coleção não encontrada' };
    const item = this.data[collection].find(x => x.id == id);
    if (!item) return { success: false, message: 'Registro não encontrado' };

    if (window.cloudStore && typeof window.cloudStore.apagarRegistro === 'function') {
      const naNuvem = await window.cloudStore.apagarRegistro(collection, id);
      if (!naNuvem.success) {
        return {
          success: false,
          message: 'O registro NÃO foi excluído.\n\n'
            + (naNuvem.message || 'A nuvem recusou a exclusão.')
            + '\n\nEle continua na nuvem, e apagar só neste aparelho faria a '
            + 'sincronização trazê-lo de volta em até 30 segundos. Tente de novo '
            + 'com o aparelho conectado.'
        };
      }
    }

    this.data[collection] = this.data[collection].filter(x => x.id != id);
    // Exclusão DEFINITIVA de um registro que veio da planilha embarcada é o
    // único caso que precisa de lápide: a planilha continua trazendo o
    // registro a cada abertura, então "sumiu da lista" não basta — quem
    // guarda o "este aqui foi apagado" é o delta (removidos), calculado a
    // partir desta marca. Ver js/catalogoStore.js.
    if (collection === 'clientes' || collection === 'produtos') this.marcarCatalogoSujo();

    // Filhos da devolucao vao junto, aqui e na nuvem. Um item_devolucao cujo
    // pai nao existe mais nao aparece em tela nenhuma (nada le itens soltos),
    // mas continua somando em quem le itens_devolucao direto - e o Power BI
    // le. Orfao invisivel que mexe em numero e o tipo de sujeira que so
    // aparece meses depois, numa divergencia de relatorio.
    if (collection === 'ocorrencias_devolucao') {
      const filhos = (this.data.itens_devolucao || []).filter(it => it.ocorrencia_devolucao_id == id);
      this.data.itens_devolucao = (this.data.itens_devolucao || []).filter(it => it.ocorrencia_devolucao_id != id);
      if (window.cloudStore && typeof window.cloudStore.apagarRegistro === 'function') {
        for (const filho of filhos) {
          await window.cloudStore.apagarRegistro('itens_devolucao', filho.id);
        }
      }
    }

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

  // Uma versao guarda o registro INTEIRO, e nas devolucoes a foto da abertura
  // e base64 dentro do proprio registro. Sem esta poda, cada clique em "Salvar
  // Edicao" copiava todas as fotos para registro_versoes: o historico crescia
  // em MEGABYTES por edicao, dentro do mesmo localStorage que ja estourou
  // cota neste projeto (ver migration 34) e do mesmo select=* que volta a cada
  // 30 segundos. Pior, isso derrotava a exclusao de midia introduzida em
  // 26/08/2026 - a foto apagada continuava viva na versao anterior.
  //
  // O que a versao precisa provar e QUE HAVIA midia e quanta, nao o pixel. O
  // marcador guarda o tamanho; o endereco de arquivos no Storage (http) fica
  // inteiro, porque ali sao ~120 bytes e continuam servindo de rastro.
  _podarMidiaDaVersao(valor) {
    if (typeof valor === 'string') {
      return (valor.startsWith('data:') && valor.length > 500)
        ? '[mídia não versionada — ~' + Math.round(valor.length / 1024) + ' KB no registro original]'
        : valor;
    }
    if (Array.isArray(valor)) return valor.map(v => this._podarMidiaDaVersao(v));
    if (valor && typeof valor === 'object') {
      const saida = {};
      for (const k of Object.keys(valor)) saida[k] = this._podarMidiaDaVersao(valor[k]);
      return saida;
    }
    return valor;
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
      dados_json: this._podarMidiaDaVersao(JSON.parse(JSON.stringify(record))),
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

    // A versao nao carrega mais o base64 da midia (ver _podarMidiaDaVersao),
    // entao restaurar o snapshot cru trocaria as fotos por marcadores de texto.
    // A midia atual e preservada de proposito, e isso e o comportamento certo
    // independente da poda: voltar a causa raiz para o valor anterior nao deve
    // ressuscitar uma evidencia excluida nem apagar uma anexada depois.
    // 04/09/2026 (migration 38): os quatro campos de Storage entraram nesta
    // lista pelo mesmo motivo que os de base64 estavam nela, e com uma
    // consequencia pior se ficassem de fora. Um snapshot gravado ANTES do
    // deploy nao tem fotos_abertura_paths; restaura-lo apagaria os caminhos
    // do registro atual - e a foto nao voltaria de lugar nenhum, porque o
    // arquivo continua no bucket e o bucket NEGA DELETE. Ficaria orfa para
    // sempre, e a devolucao, sem prova.
    const CAMPOS_MIDIA = [
      'fotos_abertura', 'videos_abertura', 'fotos_investigacao', 'videos_investigacao',
      'foto_url', 'video_url', 'video_investigacao_url',
      'fotos_abertura_paths', 'fotos_investigacao_paths',
      'fotos_abertura_pendentes', 'fotos_investigacao_pendentes'
    ];
    const midiaAtual = {};
    CAMPOS_MIDIA.forEach(c => { if (c in list[idx]) midiaAtual[c] = list[idx][c]; });
    list[idx] = Object.assign(JSON.parse(JSON.stringify(versionObj.dados_json)), midiaAtual);
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

  // =================================================================
  // OS DOIS MODULOS QUE USAM A FILA DE FOTOS (04/09/2026)
  //
  // A reentrega chegou aqui pela migration 34; a devolucao, pela 38, medida
  // assim: 30 devolucoes pesavam 4.029 KB, dos quais 3.975 KB eram foto em
  // base64 dentro de coluna - 98,7% do peso da tabela. Uma so (a DEV-030)
  // pesava 926 KB.
  //
  // Este mapa existe para que o resto do arquivo pergunte "qual e o campo de
  // caminhos desta etapa?" sem saber de qual tabela se trata. Etapa
  // desconhecida cai na etapa padrao do modulo, e nao em undefined: quem
  // chama vem da fila do IndexedDB, e um valor estranho ali nao pode virar um
  // TypeError no meio do envio.
  // =================================================================
  static _modulosFoto() {
    return {
      reentregas: {
        colecao: 'reentregas',
        etapaPadrao: 'recebimento',
        etapas: {
          recebimento: { paths: 'fotos_recebimento_paths', pendentes: 'fotos_recebimento_pendentes', legado: 'fotos_recebimento' },
          despacho:    { paths: 'fotos_despacho_paths',    pendentes: 'fotos_despacho_pendentes',    legado: 'fotos_despacho' }
        }
      },
      devolucoes: {
        colecao: 'ocorrencias_devolucao',
        etapaPadrao: 'abertura',
        etapas: {
          abertura:     { paths: 'fotos_abertura_paths',     pendentes: 'fotos_abertura_pendentes',     legado: 'fotos_abertura' },
          investigacao: { paths: 'fotos_investigacao_paths', pendentes: 'fotos_investigacao_pendentes', legado: 'fotos_investigacao' }
        }
      }
    };
  }

  /** Modulo valido, com 'reentregas' como padrao (era o unico ate 04/09/2026). */
  static _moduloFoto(modulo) {
    const M = Store._modulosFoto();
    return M[modulo] ? M[modulo] : M.reentregas;
  }

  /**
   * Traduz (etapa, modulo) nos tres nomes de campo daquela etapa.
   * A assinatura de um argumento so continua valendo e continua significando
   * reentrega - e o que mantem de pe as chamadas anteriores a 04/09/2026.
   */
  static _camposFoto(etapa, modulo) {
    const m = Store._moduloFoto(modulo);
    return m.etapas[String(etapa)] || m.etapas[m.etapaPadrao];
  }

  /** O registro-alvo de uma foto, na colecao do modulo dele. */
  _itemDeFoto(modulo, id) {
    const colecao = Store._moduloFoto(modulo).colecao;
    return (this.data[colecao] || []).find(x => x.id == id && !x.is_deleted) || null;
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
  registrarFotoEnviada(id, etapa, caminho, modulo) {
    const updates_ = (c, paths, restantes) => {
      const u = {}; u[c.paths] = paths; u[c.pendentes] = restantes; return u;
    };
    const item = this._itemDeFoto(modulo, id);
    if (!item) return { success: false, message: `Registro ID ${id} nao encontrado.` };
    if (!caminho) return { success: false, message: 'Caminho vazio.' };

    const c = Store._camposFoto(etapa, modulo);
    const paths = Array.isArray(item[c.paths]) ? item[c.paths].slice() : [];
    // Idempotente: subir a mesma foto duas vezes (app fechado no meio do
    // caminho) nao pode gerar dois caminhos iguais no registro.
    if (!paths.includes(caminho)) paths.push(caminho);
    const restantes = Math.max(0, (parseInt(item[c.pendentes]) || 0) - 1);

    // A REENTREGA CONTINUA PASSANDO POR updateReentrega; A DEVOLUCAO, NAO.
    //
    // Nao e inconsistencia. updateInvestigacao() carimba
    // status_gestao = 'PENDENTE_GESTOR' em TODA edicao, de proposito (ver o
    // bloco "PRIORIDADE 1" la em cima). Se o caminho da foto entrasse por
    // qualquer rota de edicao da devolucao, uma foto terminando o upload 30
    // segundos depois REABRIRIA a tratativa do gestor sozinha - e ainda
    // deixaria na trilha uma linha de EDICAO_INVESTIGACAO que ninguem fez.
    //
    // Guardar um caminho de arquivo nao e editar a devolucao: e concluir uma
    // gravacao que ja aconteceu. Por isso escreve direto, exatamente como
    // ajustarFotosPendentes() ja faz, e pelo mesmo motivo.
    if (Store._moduloFoto(modulo).colecao === 'reentregas') {
      const r = this.updateReentrega(id, updates_(c, paths, restantes));
      return this._confirmarGravacaoDaFoto(r, restantes);
    }

    item[c.paths] = paths;
    item[c.pendentes] = restantes;
    item.atualizado_em = agoraIsoBrasilia();
    this.save();
    return this._confirmarGravacaoDaFoto({ success: true }, restantes);
  }

  /**
   * O CONTRATO DA FILA DE FOTOS (ver js/fotoStore.js, processarFila).
   *
   *   success: false -> a foto CONTINUA no aparelho e a fila tenta de novo.
   *                     O pior que acontece e um arquivo orfao no bucket.
   *   success: true  -> a copia local e APAGADA. Nao ha volta.
   *
   * Por isso o retorno tem de refletir a gravacao EM DISCO, e nao so a
   * memoria. Ate 04/09/2026 refletia so a memoria - tanto aqui quanto no
   * caminho da reentrega, que devolve success:true sem olhar o save().
   *
   * ONDE ISSO MORDE: num aparelho com a cota estourada, que e exatamente
   * onde a migracao do legado (jrMigrarFotosDevolucaoLegado) precisa rodar. A
   * sequencia seria: a foto sobe para o Storage, o caminho e gravado so na
   * memoria porque o save() nao coube, a fila recebe success:true e APAGA a
   * copia local, e o primeiro F5 leva a memoria embora. O arquivo fica no
   * bucket - que nega DELETE, entao ninguem limpa - e a devolucao fica sem
   * prova, apontando para nada.
   *
   * save() ja anota a falha em ultimaFalhaDeGravacao e a limpa quando
   * consegue gravar (ver _gravarFatiaOperacional), entao e ele que responde
   * "isto chegou ao disco?" sem precisar de encanamento novo.
   */
  _confirmarGravacaoDaFoto(resultado, restantes) {
    if (resultado && resultado.success === false) return resultado;
    if (this.ultimaFalhaDeGravacao) {
      return {
        success: false,
        message: 'O caminho da foto nao coube no armazenamento deste aparelho '
               + '(' + (this.ultimaFalhaDeGravacao.percentual != null
                        ? this.ultimaFalhaDeGravacao.percentual + '% de uso' : 'cota cheia')
               + '). A foto continua guardada aqui e sobe de novo no proximo ciclo.'
      };
    }
    return { success: true, pendentes: restantes };
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
   * Versao por modulo da pergunta acima. A fila de fotos entra por aqui desde
   * que a devolucao passou a usa-la (04/09/2026); sem isto, uma foto de
   * devolucao seria descartada por "a reentrega nao existe".
   */
  existeAlvoDeFoto(modulo, id) {
    return !!this._itemDeFoto(modulo, id);
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
  ajustarFotosPendentes(id, etapa, quantidade, modulo) {
    const item = this._itemDeFoto(modulo, id);
    if (!item) return { success: false, message: `Registro ID ${id} nao encontrado.` };

    const c = Store._camposFoto(etapa, modulo);
    const alvo = Math.max(0, parseInt(quantidade) || 0);
    const atual = parseInt(item[c.pendentes]) || 0;
    if (atual === alvo) return { success: true, pendentes: alvo, mudou: false };

    item[c.pendentes] = alvo;
    item.atualizado_em = agoraIsoBrasilia();
    item.atualizado_por = this.currentUser ? this.currentUser.nome : 'SISTEMA';
    this.save();
    // Mesmo motivo do _confirmarGravacaoDaFoto: _reconciliar() larga a POSSE
    // quando a fila zera E o registro concorda. Se o zero ficou so na memoria,
    // largar a posse deixaria o pull de 30s ressuscitar o contador antigo, e a
    // pendencia voltaria a piscar apontando foto que ja subiu.
    if (this.ultimaFalhaDeGravacao) {
      return { success: false, pendentes: alvo, mudou: true,
               message: 'Contador ajustado so na memoria: a cota deste aparelho esta cheia.' };
    }
    return { success: true, pendentes: alvo, mudou: true };
  }

  /**
   * Estado das fotos de uma etapa, do jeito que a tela precisa perguntar.
   * Reune as tres formas que uma prova pode ter neste momento da migracao:
   * caminho no Storage, base64 legado (registros ate a v5.0.0) e pendente.
   */
  estadoFotosReentrega(item, etapa) {
    return this.estadoFotos(item, etapa, 'reentregas');
  }

  /** Idem, para qualquer modulo. A tela da devolucao entra por aqui. */
  estadoFotos(item, etapa, modulo) {
    const c = Store._camposFoto(etapa, modulo);
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
