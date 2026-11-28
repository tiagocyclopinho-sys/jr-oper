# JR-Oper — contexto para o Claude

App web (PWA) interno da JR Distribuidora: SAC/devoluções, Centro de Distribuição,
Operação & Frota, Pessoas. HTML + JS puro (sem build), Tailwind local
(`js/tailwind.cdn.js`), banco Supabase (projeto JR-OPER), publicado na Vercel a
partir do branch `main` do GitHub.

## Como trabalhar aqui
- Esta pasta é um clone do GitHub. Antes de mexer: puxar a versão mais nova
  (GitHub Desktop → Fetch/Pull). Depois: o usuário revisa e faz Commit + Push.
- Arquivos usam quebra de linha CRLF; manter.
- Toda entrega sobe a versão em 4 lugares: `js/config.js` (appVersion),
  `js/cloudStore.js` (CloudStore.BUILD), `sw.js` (CACHE_NAME) e `version.json`
  (build, publicado_em e um `resumo_...` novo no topo).
- Migrations ficam em `database/migration_NN_*.sql` (próxima: 90).
- Conferir sintaxe com `node --check js/app.js` antes de entregar.

## Regras do usuário
- **Produtividade: NUNCA usar valores em R$** (a pagar, tetos, produtividade $,
  ocorrência $) — nem importar, calcular, validar ou exibir. Foco só em pontos,
  ocorrências SAC e ocorrências RH.

## Módulo Produtividade (v6.9.0, 20/10/2026)
- Pontos vêm do Power BI (workspace LOGÍSTICA, modelo "Produtividade"; regras
  DAX ficam lá). App Entra "JR-Oper Sync" (service principal) lê via
  executeQueries. Segredos `PBI_CLIENT_ID`/`PBI_CLIENT_SECRET` nos Secrets das
  Edge Functions.
- Edge Function `supabase/functions/sync-produtividade` grava em
  `prod_periodos` / `prod_pontuacao` / `prod_sync_log` (migration 53).
  pg_cron `prod-sync-powerbi` às 06h e 13h (Brasília).
- Mês de fechamento: 26 do mês anterior a 25 do mês. Mês `aberto` = prévia;
  `fechado`/`publicado` = congelado. O Power BI recalcula meses passados com o
  cadastro atual, então mês fechado nunca é re-sincronizado.
- Tela `produtividade_cd` (Centro de Distribuição → Produtividade) no fim de
  `js/app.js`: linha a linha por colaborador, pontos + ocorrências do período.
- Ocorrências SAC contam só `tipo_erro = 'ERRO CARREGAMENTO'` (separador/
  conferente_apurado vem preenchido em TODA devolução). Bate com a aba
  "Ocorrência" das planilhas de produtividade.
- Ligação pontos × ocorrências é pelo NOME (`normalizeStr`): a `chapa` do
  `colaboradores_cd` não é a matrícula do WMS (só 2 de 44 batem).

## Requisitos de motoristas e ajudantes (26/10/2026)
- Planilha mensal do Victor Hugo em `S:\Logistica\01 - LOGISTICA INFORMATIVO\
  20 - VICTOR HUGO\REQUISITOS\AAAA\REQUISITOS MOTORISTAS E AJUDANTES - MM.AAAA.xlsx`
  (mês de fechamento 26→25; arquivo usa o sistema de datas de 1904).
- `tools/gerar_planilha_requisitos.js` (.bat) copia a do mês anterior e
  preenche Ocorrências + abas de apoio a partir do app. Abas Motorista,
  Ajudante e BD são do usuário: não mexer. Regras conferidas contra setembro:
  checklist/Fusion "NÃO INICIADO" com observação de sem aparelho/inconsistência
  não contam; devolução = `ERRO MOTORISTA` com Desconto Aplicado = SIM
  (`desconto_produtividade_gestor`; decisão de 28/11, substitui a de 26/10 "todas"; a aba
  Devolução segue com todas e o gerador avisa quando a ação do gestor diz DESCONTADO sem a
  caixa marcada, como DEV-236/241); faltas entram pelo NOME,
  mesmo com função trocada no app; motor ocioso = Oc. Operacional (motivo
  MOTOR OCIOSO), sem os de isenção. Nomes vão como estão no app (#N/D na
  planilha se não baterem com a BD). Toda ocorrência sai com Requisito (o
  Victor abona na planilha).
- Motor ocioso do Power BI: modelo "CCO" (workspace LOGÍSTICA, o único que o
  service principal enxerga), tabela `fMoov` (alertas do rastreador; motorista
  vem do vínculo com a viagem). Edge Function `supabase/functions/sync-cco`
  grava em `cco_motor_ocioso` / `cco_sync_log` (migration 54), pg_cron
  `cco-sync-powerbi` 06h10 e 13h10. O Power BI tem ~7% de linhas idênticas
  que o relatório da CCO CONTA: a tabela guarda uma linha com `qtd`.
  Caminhão 3/4 é ISENTO de motor ocioso (Tiago, 27/11): o gerador tira as placas
  com `veiculos.tipo = '3/4'` do cadastro (`TIPO_ISENTO_MOTOR_OCIOSO`) e remove os
  filtros manuais da tabela dinâmica (Veículo e Motorista). Sem motorista =
  "(SEM VÍNCULO)". Isenções: manuais (a isenção registrada pela CCO vai no
  Complemento).
- MOTORISTA DO ALERTA (27/11): o Power BI da CCO lê `controle_viagens` SEM tirar
  as apagadas; viagem apagada fica sem retorno e "aberta para sempre" (carga
  45132, RICARDO/TVA8I21, apagada na correção da escala de 04/11: 101 alertas
  dele em nov, eram 32; o resto era do NANDERSON). A sync-cco refaz o vínculo
  pela `vw_bi_controle_viagens`: mesma placa, entre saída e retorno = Em Viagem,
  até 15 min antes/depois = Pré/Pós, senão sem motorista; viagem sem retorno vai
  até a próxima saída da placa (máx. 7 dias). O do Power BI fica em
  `motorista_pbi`. Antes da 1ª viagem do JR-Oper (ago/26) vale o do Power BI.
  Recarregado desde 01/08 em 27/11. Corrigir também o Power Query do modelo CCO
  (trocar a fonte para `vw_bi_controle_viagens`): o relatório Gestão MOOV segue
  errado até lá.
- Regras de 26/11/2026 (Tiago, a partir do que o Victor fez à mão em out/26):
  Ocorrências leva, além dos eventos confirmados pela CCO, UMA linha por
  motorista "MOTORISTA TEVE N OCORRÊNCIAS DE MOTOR OCIOSO" (Média Consumo).
  Falta: função vem da planilha (abas Motorista/Ajudante/BD), não do motivo;
  ajudante = Pontualidade + Prazo Rota, motorista = Prazo Rota (prestador, sem
  pontualidade). Dias de falta = dias da viagem perdida (saída → retorno, achada
  pela carga: o app não liga a falta à viagem) até a véspera da próxima viagem
  da pessoa; dia já contado por outra falta não repete. Folgas-Falta: INÍCIO/FIM
  com esses dias, todas DESCONTADO. O arquivo é só o respaldo: o Victor avalia,
  abona e decide o pagamento. A coluna Dias das abas Motorista/Ajudante é
  fórmula do Victor (30 − dias DESCONTADO da Folgas-Falta): não mexer.
- Folgas (26/11): vêm de `escala_folgas` (sem NEGADO/CANCELADO), cortadas no
  26→25, na mesma aba Folgas-Falta; contam os dias fora da escala mas NÃO geram
  Prazo Rota nem Pontualidade. Status = ABONADO se o tratamento da Escala for
  ABONADO, senão DESCONTADO. Falta lançada em dia de folga aprovada vale como a
  folga (sem conduta, sem contar o dia duas vezes); os dias da folga são
  contados antes dos da falta.
- Relação do DP (27/11): `tools/atualizar_cadastro_requisitos.js AJUDANTE|MOTORISTA
  "Relação de Folha ... .xlsx" [AAAAMM] [--simular]` compara a relação do DP com a
  aba Ajudante/Motorista e a BD: tira quem saiu, inclui novato em ordem alfabética
  (copia a linha de cima) com os Dias DIGITADOS do 1º dia (admissão no cadastro do
  app ou 1ª viagem) até o dia 25, como o Victor fazia. Aplica pelo Excel (.ps1 ao
  lado), na BD só colunas B–F, guarda "(antes do DP).xlsx". Usa do DP só código,
  nome e cidade (o arquivo tem CNPJ, valores e conta bancária: não ler/copiar).
  Código do DP = id do cadastro do app; casa por código, então ARMANO (código 18,
  "ATOS FELIPE" no DP: o filho emite a nota para ele receber, combinado com a
  empresa) fica como ARMANO na planilha, sempre. Aplicado no 11.2026 em 27/11. Condutas
  (`REGRAS_CONDUTA`): limpeza/conservação, dano, atolamento → Sinistro &
  Conservação; desvio de rota → Fusion / FURO DE CERCA (nome antigo; hoje é o
  monitoramento com telemetria); checklist → Manut. Veículo / Aparelho.
  `NOMES_PLANILHA`: ARMANDO LIMA DA CUNHA → ARMANO (cadastro errado no
  sistema de pagamento; a aba Motorista usa ARMANO e a BD não tem o nome).
- O Power BI da CCO deixou de ter linhas duplicadas (visto em 26/11): out/26
  foi fechado com números inflados (NANDERSON 69, hoje 51).
- No mesmo workspace também há os modelos "Motorista e Ajudantes",
  "Abastecimento", "Despesa" e "PIX Pendente" (candidatos para Média de
  Consumo / Acerto de Caixa). "Motorista e Ajudantes" estoura o limite de
  memória com COLUMNSTATISTICS — consultar tabela a tabela.
- Relatórios do LOGÍSTICA (print do Tiago em 27/10): CCO, Corte, Descarga,
  Despesa, Devolução, Insumos, Motorista e Ajudantes, Notas Denegadas,
  Pagamento Realizados, PIX Pendente, Produtividade, Resumo Diário, SAC - GLPI,
  Shelf Life, Torre de Controle WMS (e outros acima na lista, ex.: Abastecimento).
  "Corte" traz Gestão de Cortes e Gestão de Inventários (perda/rendimento).
  Hora Extra fica no workspace GERÊNCIA (modelo "Hora Extra - PBI"); o JR-Oper
  Sync é Colaborador lá desde 28/10 (Visualizador não basta: falta o Build).
- Locatário: "Entidades de serviço podem chamar as APIs públicas do Fabric"
  liberado só para o grupo de segurança `PowerBI-API-Apps` (onde está o
  JR-Oper Sync). As APIs de administrador ficam desligadas. Para outro
  workspace, basta dar ao JR-Oper Sync a permissão Build no modelo
  (⋯ → Gerenciar permissões); preferir isso a pôr o app no workspace inteiro.
- `.claude/settings.local.json` libera `deploy_edge_function` do Supabase.

## Acerto de motoristas e ajudantes (planejado, 27/11/2026)
- Hoje: rotinas WinThor 8003 (motorista) e 8009 (ajudante), uma por pessoa, com
  os requisitos OK/NÃO digitados à mão; impressas e não salvas (~2 dias/mês).
  Exemplos em `REQUISITOS\08.2026 MOTORISTAS\` e `AJUDANTE MOTORISTA 08.2026\`.
  Tabela de valores: `20 - VICTOR HUGO\MOTORISTAS E AJUDANTES REMUNERAÇÃO.xlsx`.
- EXCEÇÃO à regra de R$ (decisão do Tiago, 27/11): este acerto mostra valores,
  mas em OUTRO link (como /banco-horas), com login e senha. Usuários: Tiago,
  Victor Hugo e Paulo Silva (confere no fim).
- Conta (conferida com ADEMAR e ADRIANO, ago/26): motorista = Σ peso líq (t) ×
  VLTONFAIXA da rota × PERCFAIXA% + entregas × 0,25 + KPIs OK + diferença até o
  garantido; KPIs 200 manut., 100 pneus, 200 sinistro, 100 consumo, 400 prazo
  rota (COMUNIC), 100 caixa, 100 devolução, 400 Fusion. Ajudante = Σ peso líq (t)
  × VLTONAJUDFAIXA + KPIs 100 devolução/pontualidade/prazo rota + (garantido −
  peso) × valor médio por t. Peso líq = TOTPESO − devolução (DEVOLITEM 12).
  "Peso Diário/Garantido" da planilha de Requisitos é TONELADA (70 t), não R$.
- Fontes: Power BI "Motorista e Ajudantes" (f_MOTORISTA, f_AJUDANTE, transb, ent
  = compras, PCFORNEC com FAIXA) e "Devolução" (f_DEVOLUCAO: DEVOLITEM, TOTPESO).
  Faixas: CSV da PCROTAEXP (`C:\Users\thiago.ferreira\PCROTAEXP_202611271335.csv`).
  Exceções: só carreteiros (Fagno, Célio: 120 t) e carne (Silvestre: 140 t);
  ajuda de custo/extra é manual.
- Requisitos: Acerto de Caixa = flag marcada pelo setor de Fechamento de Caixa;
  Cuidado com Pneus = registro específico da manutenção (orientar); Média de
  Consumo = motor ocioso até 2027 (depois meta × realizado); Prazo Rota =
  viagem que fecha depois da previsão da matriz + 15 h sem justificativa.
- Teste: novembro/26 em paralelo com o manual do Victor (nov já fechado à mão;
  o sistema refaz só para comparar).
- Decisões de 27/11: desligado no meio do mês (DP) não entra no fechamento;
  o painel terá a aba Folgas e Faltas, onde o Victor valida descontado/abonado;
  devolução: no ACERTO só desconta com "Desconto Aplicado? = SIM" na tratativa (decisão
  de 28/11, substitui "todas as ERRO MOTORISTA"); Acerto de Caixa: o Financeiro avisa
  e o Victor marca; isenção de motor ocioso já é lançada no JR-Oper; Prazo Rota
  passa a ser automático. Cuidado com Pneus: Oc. Operacional, motivos FALTA DE
  CUIDADO COM PNEUS e PNEU DANIFICADO (7.9.3). A lista `motivos_ocorrencia` vem
  do mockData e fica salva em cada aparelho (sem tela de cadastro nem tabela na
  nuvem; Cadastros Mestres só edita motivos de devolução): motivo novo precisa
  entrar no mockData E no acréscimo do Store.init (store.js), como o CROSS. O
  gerador casa pneu pelo MOTIVO (`doMotivo` em REGRAS_CONDUTA), não pelo texto.
- Matriz de regras EDITÁVEL no link (decisão do Tiago, 27/11: a planilha de
  remuneração e a rotina estão desatualizadas; ex.: KPIs do carreteiro 250/250/
  200/200/100 na planilha × 200/100/200/100/400 na rotina). Valores com vigência,
  para mês fechado não mudar. Partes: perfis (motorista padrão, carreteiro,
  carne; ajudante padrão, lombador) com t garantida, % comissão, bônus/entrega e
  KPIs; pessoa → perfil; rotas; compras (ligadas pelo CPF do f_MOTORISTA
  ent, ver Decisões de 28/11).
- Faixa pela ROTA DO JR-OPER (carga → viagem do Controle de Viagens), não pela
  CODROTAPRINC do WinThor: a rota "Palmas" do WinThor junta saída de Araguaína e
  do cross de Palmas, que têm faixa diferente. PCROTAEXP é só a semente (editável).
  Os nomes de rota das viagens variam do cadastro (acento, "MARABA 02"/"MARABA
  II", "SECO - ARAGUAINA"): a matriz precisa casar sem acento e aceitar apelidos.
  Campos da tela da 8003 (print de 27/11) → parâmetros da consulta: BONUS POR
  ENTREGA = AJUD_EXT; VLR TON EXTERNA/INTERNA DERIVADOS = vlr_ton_externa/
  interna (só a coluna informativa "Vlr Fat", não entram no pagamento); VLR TON
  CARNE = vlr_ton_carne (tela: 300); PERCENTUAL COMISSÃO = percom; AJUDA EXTRA =
  dif_soma; TON. GARANTIDA = PESO_MINIMO; TIPO MOTORISTA Carreteiro/Caminhoneiro
  = TIPOMOTORA (carreteiro: sem caixa, devolução e Fusion); TONELADA CARNE Sim =
  ton_carne (todas as cargas pagam o VLR TON CARNE); FAIXA DE TRANSBORDO =
  vfaixa (Sim: todas as cargas a R$ 250/t; Não: faixa da rota, e as cargas em que
  ele é o motorista do transbordo a R$ 350/t). Na 8009 o campo Faixa do ajudante
  (1 = menor faixa, 3 = R$ 23/t) é o do lombador (Gabriel). Silvestre (carne)
  usa TONELADA CARNE, não a faixa de transbordo. No app: FAIXA DE TRANSBORDO
  fica como opção marcável por pessoa e por mês, desligada por padrão (Tiago, 27/11).
- Etapa 1 PRONTA (7.10.0, 27/11, migration 85 APLICADA; falta deploy): página `/acerto`
  (`acerto/index.html`, rewrite no vercel.json, fora do service worker) + `js/acertoRegras.js`
  (UMD). SEGURANÇA DIFERENTE do resto: tabelas `acerto_*` com RLS e SEM política, sem grant
  para anon; tudo pelas funções `acerto_*` (security definer) com token de sessão (só o
  SHA-256 fica no banco, 12 h). LOGIN = O MESMO DO JR-OPER (7.10.1, migration 86, decisão do
  Tiago: nada de senha nova): `acerto_entrar` acha o usuário como o app (e-mail, nome ou
  começo do nome; começo ambíguo pede o e-mail) e confere a senha no servidor com
  `acerto__hash_app`, cópia em SQL da sha256Sync (não é SHA-256 padrão: primos até 300).
  Mudou a sha256Sync? Mude a função junto. O próprio hash NÃO vale como senha aqui. Só entra
  quem está em `acerto_usuarios.usuario_id`: Tiago (ids 5 e 1787514068461840, ADMIN) e Paulo
  Silva e Victor Hugo (EDITOR; o cadastro do Victor, id 1786993272306, só existia no PC dele e
  foi reenviado pelo console em 27/11). Liberar outro: `select acerto_admin_liberar(<usuarios.id>,
  'EDITOR', 'Nome');` (só pelo SQL).
  5 erros = 15 min. A senha se troca no JR-Oper.
- Matriz em `acerto_regras` (tipo, chave, vigencia AAAA-MM, dados jsonb): vale a versão de
  maior vigência <= mês; editar cria a versão do mês escolhido na tela; mês FECHADO
  (`acerto_meses`) recusa versão nova. Tipos: parametro, faixa (1–5), perfil (MOTORISTA_PADRAO,
  _CARRETEIRO, _CARNE, AJUDANTE_PADRAO, _LOMBADOR), pessoa (`FUNCAO:id`; sem regra = padrão),
  rota (chave = `acerto_chave(nome)`: sem acento/pontuação, 01→I, palavras em ordem; apelidos
  para os nomes das viagens), compra (sobra da 1ª ideia: a compra liga pelo CPF, ver abaixo) e pcrotaexp (referência). Carga
  inicial vigência 2026-01; 33 de 77 rotas do cadastro casaram com a PCROTAEXP, as outras e
  os nomes de viagem soltos o Victor liga na aba Rotas. Rota tem valor PRÓPRIO (a faixa só
  preenche). `acerto_log` guarda antes/depois.

- Como a 8003/8009 pagou nov/26 (conferido nos 73 PDFs em 27/11; planilha
  `REQUISITOS\2026\DIVERGÊNCIAS ACERTO 11.2026.xlsx`): valor da carga = peso líq (t) ×
  R$/t × %. Taxas: rota = faixa × 10%; carreteiro (Célio, Fagno) 11% (compra R$ 500 → 55/t,
  transbordo R$ 350 → 38,50/t); Armando = Faixa de Transbordo Sim (tudo R$ 250 → 25/t, sem
  Caixa/Devolução/Fusion); quem leva o transbordo (Palmas ou Marabá) recebe R$ 350 → 35/t
  das cargas que levou, ALÉM do motorista da rota; compras (destino "Entrada de Compra",
  carga = nº da NF) pagas ao fornecedor-motorista. Ajudante = R$/t da faixa; Gabriel 23/t,
  garantido 140 t. Ajudante: total = cargas + KPIs + (garantido − peso) × R$/t médio + ajuda
  extra. Motorista: igual + bônus 0,25/entrega, MAS quando não chega ao garantido a 8003 soma
  o bônus de novo dentro do "Dif Peso Garantido" (R$ 3.496 a mais em nov). Garantido
  proporcional aos dias (2,333 t/dia) é digitado à mão (Almir e Lusimar ficaram diferentes
  da planilha). Requisito "N/C" sai NÃO (não paga), exceto Prazo Rota dos carreteiros (pago).
  Devolução segue "Desconto aplicado?" da tratativa (Kauan, DEV-245). Período pela data da
  carga no WinThor (43 viagens de 26/10 com carga de 25/10 entraram em outubro). Ajuda extra
  manual: feriado R$ 60; faixa 5/saída no domingo R$ 100 por carga (ajudante 50); transbordo
  Marabá 100 ou 50 (sem padrão); reembolsos. JR-Oper só registra transbordo de Palmas desde
  05/11 e sem as cargas; carne (Silvestre/Gabriel) não tem carga nas viagens fixas.

- Decisões de 28/11 (Tiago, depois da conferência de nov/26):
  * Período = DATA DA CARGA NO WINTHOR (montagem no Fusion → WinThor → Power BI), não a
    saída real do JR-Oper. Mudar isso mexeria na operação inteira.
  * Cargas, equipe (com as trocas) e transbordo do cálculo vêm do Power BI "Motorista e
    Ajudantes" (a escala lá já sai certa). O JR-Oper serve para APONTAR divergência
    (carga com outra equipe, transbordo não registrado) durante o mês, não só no fechamento.
  * Devolução desconta só com "Desconto Aplicado? = SIM". O fechamento de nov/26 (manual, 27/11) usou todas;
    a regra vale a partir da automação (dez/26). DEV-236 e 241 tinham "DESCONTADO" no texto
    sem a caixa: marcadas pelo SQL em 28/11.
  * Quem viajou e ficou sem acerto em nov (Douglas Ferreira, Oziel Gomes, Anderson Junior,
    Charles, Douglas da Costa, Alessanco, João Marcos) foi desligado no mês: conferir pela
    Relação de Folha do DP (DownloadsRelação de Folha ... AAAA.MM.xlsx). Gean Marcos e
    Rodrigo Ferreira são novatos: o acerto de nov sai quando o cadastro deles no WinThor
    ficar pronto (o sistema precisa aceitar pessoa sem código WinThor ainda).
  * Compras (frete de compra, "Entrada de Compra Ref. NF") ligam ao motorista pelo CPF do
    f_MOTORISTA ent: o motorista leva a carga como PJ e traz a compra vinculada ao CPF, e o
    pagamento é junto. CPF é só código (decisão do Tiago, 28/11); nome do fornecedor e nº da
    NF não servem (NF repete). Não exibir CPF na tela nem gravar em tabela legível pela chave
    pública: só nas acerto_* (trancadas). Nov/26: compra TO = faixa 2 (R$ 350/t), GO = faixa
    3 (R$ 500/t).
  * Bônus em dobro no garantido (8003): provável erro; o Tiago confirma com o Victor.
  * Matriz ajustada em 28/11 (vigência 2026-01): carreteiro 11%; perfil MOTORISTA_TRANSBORDO
    (R$ 250/t × 10%, sem Caixa/Devolução/Fusion) para o Armando (id 18); lombador 140 t.
  * Os 8 PDFs com nome trocado: dois emitiram metade cada e nomearam errado; vão ajustar.

- Dados do Power BI (28/11, migration 87 APLICADA, Edge Function `sync-acerto` no ar, pg_cron
  `acerto-sync-powerbi` 06h30/13h30): modelo "Motorista e Ajudantes" (dataset
  32ddc070-…), tabelas `acerto_pbi_cargas` (f_MOTORISTA = PCCARREG: CODMOTORISTA, CODMOTTRANSBORDO,
  CODFUNCAJUD/2/3, CODAJUDTRANSBORDO, TOTPESO, NUMENT, CODROTAPRINC, DTSAIDA, DTFAT, DT_CANCEL),
  `acerto_pbi_compras` (f_MOTORISTA ent = PCNFENT, mês por DTENT; motorista pelo CPF via
  MAXX(dim_PCEMPR CPF→MATRICULA) DENTRO do DAX, só a matrícula é gravada), `acerto_pbi_rotas`
  (aux_ROTA) e `acerto_sync_log`; todas trancadas como as acerto_*. Janela: dia 26 de dois
  meses atrás até hoje, apaga e regrava. Código WinThor = id do cadastro do JR-Oper (89/73 e
  outros sem cadastro são códigos genéricos do WinThor). Conferido nov/26: 1.160/1.160 cargas
  dos PDFs (rota 509, ajudante 1 539, ajudante 2 29, transbordo 83). SÓ CARGA FATURADA
  (DTFAT) e não cancelada (45343/45348 sem faturamento ficaram fora, como na rotina). Compras:
  60/62; NF 117518/117551 (Nilmar) não estão no f_MOTORISTA ent e a NF 179193 saiu 2× no PDF
  do Armando. PCFORNEC[FAIXA] vem vazio: faixa da compra por UF (TO R$ 350/t, GO R$ 500/t).
  Explorar o modelo: `pbi-explorar` com "modelo":"Motorista e Ajudantes".

- Cálculo (28/11): `js/acertoCalculo.js` (UMD, `AcertoCalculo.calcular`). Valor da carga pela ROTA
  PRINCIPAL DO WINTHOR (tipo pcrotaexp da matriz, chave CODROTAPRINC), como a 8003/8009, e NÃO
  pela rota do JR-Oper (a decisão de 27/11 fica para depois, se quiserem separar o cross).
  Perfil com R$/t fixo/tonelada carne troca o R$/t; % do perfil vale sobre o da rota;
  transbordo = parâmetro TON_MOTORISTA_TRANSBORDO; compra = COMPRA_TON (350) ou COMPRA_TON_GO
  (500). Perfil AJUDANTE_FAIXA1 (R$ 38/t fixo) = campo Faixa 1 da 8009 (Guilherme, Gustavo
  Carvalho, Rubens, Wesly). Requisitos pagos se o perfil tem e a planilha não tem ocorrência
  (N/C não paga). Garantido = falta × R$/t médio, SEM o bônus em dobro. Teste nov/26: 60 de 71
  iguais aos PDFs (fora o bônus em dobro); os 11 restantes são garantido digitado ≠ planilha
  (Almir, Lusimar; Fabrício/Fagno com planilha errada), NF faltando (Nilmar) ou repetida
  (Armando), Kauan (Desconto NÃO), Edimar (Devolução NÃO sem ocorrência), devolução de
  67,71 kg descontada no peso (Gilcimar, carga 45193: falta ligar o peso devolvido do Power
  BI "Devolução") e rodapés de PDF que o leitor não leu.

- Tela Acerto do mês (7.11.0, 28/11, migration 88 APLICADA): aba padrão do /acerto.
  `acerto_dados_mes(token, mes)` devolve cargas faturadas e não canceladas, compras,
  requisitos, extras e cadastros; o cálculo roda no navegador (`AcertoCalculo`). Requisitos
  vêm da planilha do mês importada na tela (`acerto_importar_requisitos`, abas Motorista e
  Ajudante, "Cód. ERP", Dias, Peso Garantido; substitui a anterior); nov/26 já importado.
  Ajuda extra + motivo por pessoa/mês (`acerto_salvar_extra`, tabela acerto_pessoa_mes).
  Desligado no cadastro e código sem cadastro vão para "Fora do fechamento". Mês fechado
  recusa importação e ajuda extra.
- Impressão e fechamento (7.12.0, 28/11, migration 89 APLICADA): Imprimir (pessoa, função ou
  todos) monta um documento A4 por pessoa num iframe e abre a caixa de impressão (Salvar como
  PDF); salvar sozinho na pasta S: não dá pelo navegador. Fechar o mês (ADMIN/EDITOR) grava o
  resultado de cada pessoa ATIVA em `acerto_fechamentos` (dados jsonb = objeto do cálculo) e
  marca acerto_meses FECHADO; a tela passa a mostrar a foto. Reabrir: só ADMIN, só o último
  mês fechado, com motivo (a foto vai para o acerto_log). Falta: peso devolvido, abas Requisitos
  e Folgas e Faltas no app.

## Custo de gestão (7.1.13, 06/11/2026)
- Edge Function `sync-custo-gestao` (migration 73) grava a seção `custo_gestao` em
  vo_indicadores/vo_quadros, separada da sync-visao-operacao para não travar o
  congelamento. pg_cron `vo-custo-gestao` 06h40. Mês cheio. Carga: corpo
  `{"meses":[...]}`, começando pelos meses recentes (eles ensinam CODVEICULO → placa).
- Gerente e supervisor: combustível do carro, pela placa e pelo período de
  `vo_veiculo_responsavel`; sem certeza fica fora. Colaborador do Abastecimento não é
  usado (decisão do Tiago: só placa, para não mexer no Power Query).
- Motorista: abastecimento da placa dividido pelo peso das cargas, sobre
  `[Total Peso Mot]`. Equipe Gladiador entra só na carteira do Carlos Alexandre.
- Todos os perfis veem os valores por pessoa (gestão à vista). Sem meta até ter histórico.

## Visão Operação (apresentação mensal, 28/10/2026)
- Apresentação para Gerência/Diretoria em `S:\Logistica\01 - LOGISTICA
  INFORMATIVO\06 - VISÃO OPERAÇÃO\AAAA - VISÃO OPERAÇÃO\AAAA.MM - Visão Operação.pptx`.
- Coleta: Edge Function `sync-visao-operacao` (migration 55) grava a "foto" do
  mês em `vo_periodos` / `vo_indicadores` (valor congelado + `valor_atual`) /
  `vo_quadros`; pg_cron `vo-sync-powerbi` 06h20. Mês M congela no dia 3 de M+1
  e só se todas as seções derem ok. Cortes 26→25; devolução, despesa,
  abastecimento, motoristas e MOOV mês cheio; inventário acumulado no ano.
  Jan–set/2026 carregados em 28/10 com os valores daquele dia.
- Power BI devolve 429 com muitas consultas em paralelo: a função roda as
  seções em sequência e repete após 20s (~20s por mês; carga manual ≤ 4 meses
  por chamada: corpo `{"meses":[...],"congelar":true}`).
- Calendários: Corte `dim_Calendario[DATA]`, Devolução/Motoristas
  `dim_CALENDARIO[Data]`, Despesa/CCO `'dCalendário'[Data]` (com aspas),
  Abastecimento `d_Calendario[Data]`. Motivo/responsável da devolução vêm de
  `f_DEVOLUCAO[MOTIVO]` / `f_DEVOLUCAO["RESP DEV"]` (CODDEV não filtra).
- `pbi-explorar` (Edge Function só de leitura) lista modelos/relatórios e roda
  DAX: chamar por `net.http_post` com o token do Vault e ler `net._http_response`.
- `shelf-life` (Edge Function só de leitura, fora do app, desde 09/11/2026) devolve a
  tabela do relatório "Shelf Life" e os vencidos para o script local
  `..\shelf-life\shelf.ps1` (impressão semanal da conferência de datas do CD).
  Cabeçalho `x-shelf-token`; a chave fica só no PC do Tiago
  (`%LOCALAPPDATA%\ShelfLife\token.txt`) e a função guarda só o SHA-256 dela.
- Gerador: `tools/gerar_visao_operacao.bat [AAAAMM]` (pptxgenjs em
  `tools/node_modules`, fora do Git; o .bat instala). Visual (fundo, divisores,
  capa, logo) em `tools/visao_operacao/`, exportado da apresentação de set/26.
  Movimentação CD vem de `prod_pontuacao`; S.A.C. de `ocorrencias_devolucao`
  (criado_em 26→25); troca de veículo de `trocas_veiculos`. Hora Extra (seção
  `horas_extras`): só HE 55%, como a manual; a 100% sai à parte. Modelo mensal
  (`'fHora Extra'[MÊS]` = dia 1); `[Qtd HE]` vem como HHHMMSS (3990036 =
  399:00:36) e é gravado em horas decimais. Lista por funcionário fica em
  `vo_quadros` (rótulo "SETOR | NOME"), legível pela chave pública: decisão
  do Tiago em 28/10.
- Resumo de análise (`analisar()` no gerador): regras fixas, sem IA. Pontos
  positivos/melhoria comparam mês × mês anterior × média do ano (melhoria só se
  ≥ 10% pior que a média), pico diário de cortes (≥ 3× a mediana), produto
  ≥ 15% dos cortes, devolução controlável (motorista + carregamento), MOOV sem
  vínculo > 15%, motoristas < 70% do garantido, preço de combustível < R$ 3.
  Custos: metade da devolução controlável; 30% do litro externo no posto
  interno; postos externos > R$ 0,30/L acima da média dos externos; cortes acima
  da mediana do ano; despesa acima do mesmo mês do ano anterior. Metas: mediana
  do ano com 5% de melhora, limitada ao melhor mês. Gera também
  `... - resumo.txt` para o e-mail.
- Versão corporativa em HTML e tela do app (6.9.4, 28/10): a parte comum fica em
  `js/visaoOperacao.js` (UMD: `window.VisaoOperacao` no app, `require` no
  gerador) — formatos, `carregarDados(rest, am)`, `analisar(d)` e
  `gerarHtml(d, analise, { logo })`. O gerador grava `AAAA.MM - Visão
  Operação.html` junto do .pptx; o app mostra a MESMA página em Visão Geral →
  Visão Operação (iframe srcdoc, lê a nuvem só ao abrir, todos os perfis veem,
  botões Atualizar / Imprimir / Baixar HTML). Gráficos em SVG com rótulo de
  dados em TODOS (pedido do Tiago); cada gráfico recebe `W` = largura do cartão
  (g1 1180, g2 580, g3 340). Mudou a página? Muda nos dois.
- Os modelos Corte e Devolução expõem colunas sensíveis do WinThor
  (dim_PCEMPR/dim_PCUSUARI: salário, CPF, hash de senha); nunca consultar.

- 6.9.5 (29/10): menu de seções travado (no app o quadro rola por dentro);
  Painel com 3º comparativo = mesmo mês do ano anterior (2025 inteiro carregado
  em vo_*; carregarDados lê só ano corrente + mês anterior + mesmo mês do ano
  anterior, porque o REST devolve no máx. 1.000 linhas). Metas OFICIAIS em
  `metasOficiais()` (decisão do Tiago em 29/10): HE carregamento 1º turno 40 h,
  2º turno 200 h, portaria 60 h, pátio e manutenção 6 h, demais setores 1 h; devolução ≤ 0,20% do faturamento geral e
  por seco/frio (SETOR I do supervisor no Power BI; frio = TO+PA+MA); corte ≤
  0,1% (valor cortado ÷ faturado no período 26→25, `faturamento_fech`) e corte
  ≤ R$ 30 mil; faturamento do mês ≥ R$ 30 mi;
  despesa de cartão ≤ R$ 75.000 por mês (fixa desde a 7.1.6); MOOV motor ocioso ≤ 500
  e ≥ 80% identificadas/em viagem; inventário saldo acumulado no ano ≥ 0. Seção
  Transbordos (Palmas dia a dia, Marabá mês a mês × ano anterior). Filtro por
  clique (variantes pré-montadas + script na página) só onde os dados já
  permitem: HE por setor, movimentação frio/seco, motoristas por faixa, S.A.C.
  por tipo de erro.
- SLA de atendimento (6.9.5, decisão do Tiago em 29/10): a partir de set/2026,
  em HORAS ÚTEIS (seg–sex, sem feriados nacionais; lista FERIADOS em
  visaoOperacao.js até 2027, Palmas ainda não). Monitoramento = criado_em →
  1º EDICAO_INVESTIGACAO em audit_logs (24 h); gestor = análise →
  data_acao_gestor (48 h); ponta a ponta = abertura → CONCLUIDO (72 h). Aberta
  com prazo vencido conta como fora; aberta no prazo fica fora do %.
- 6.9.6 (29/10): MOOV ganhou o bloco Motor ocioso (quadros ocioso_* em vo_quadros,
  filtro TREATAS({"MOTOR OCIOSO"}, fMoov[Violação])). S.A.C. ganhou o comparativo
  Oper × WinThor no período 26→25 (`comparativoDevolucao()`): indicadores
  valor_fech/qtd_fech/cargas_fech e quadros resp_fech, carga_fech e carga_amplo
  (−10/+20 dias). Cruzamento por número de carga (o Oper grava "44079/44080":
  separar os números). Tipo de erro → RESP DEV: comercial, indústria =
  fornecedor, motorista, carregamento, cliente; "avaria" só no WinThor.
- 6.9.7 (29/10): S.A.C. ganhou "Abertura por dia" (criado_em de d.sac) e
  "Monitoradas por dia" (`d.analisesPeriodo`: 1º EDICAO_INVESTIGACAO de cada
  ocorrência caindo em 26→25, de qualquer data de abertura). A leitura do
  audit_logs começa um mês antes do período para a 1ª análise não ser
  confundida com reedição.
- 6.9.9 (30/10): tabelas de prazo vencido (monitoramento e gestor) após os
  gráficos do SLA. Comparativo Oper × WinThor: causa raiz
  (motivo_real_causa_raiz) no lugar do tipo de erro; sobra ("SOBRA" na causa
  raiz) sai da contagem e da lista "só no Oper", mas conta na busca reversa
  (sobra às vezes tem nota no WinThor, ex.: DEV-074). A nota do WinThor entra
  depois da tratativa, às vezes meses depois, então o cruzamento não prende ao
  26→25: carga_amplo vai de 16/(M-1) até hoje (máx. M+4) e a rodada diária
  regrava esse quadro dos 4 últimos meses, mesmo fechados
  (`atualizarCargaWin`); o lado Oper procura ocorrência até 5 meses antes.
- 6.11.3 (03/11): Despesas interativas. Quadros novos usuario_dep ("DEP | NOME"),
  dep_dia ("DEP | data") e usuario_dia ("NOME | data") na seção despesa; sem eles
  (meses antes de out/26) a seção sai sem filtro. Clique usa o grupo 'desp' e o
  atributo data-pai (o usuário acende o departamento; o departamento acende os
  usuários dele). vo_quadros de um mês passa de 1.000 linhas: `lerTudo()`
  pagina a leitura (limit/offset, precisa de order). Abastecimento interativo
  no mesmo padrão: quadro cruzado_dia ("POSTO | COMB | INT/EXT | data", valor
  R$, valor2 litros) e tudo é somado na página; o gráfico da dimensão clicada
  fica inteiro e os outros dois mostram o filtrado (itens com data-pai = filtro).
  Barra com filtro: false não é clicável (posto sem variante).
- 7.1.3 (04/11): Hora extra por tipo. Seção he_tipos em vo_indicadores/vo_quadros,
  separada de horas_extras para regravar sem tocar nos totais congelados da 55%:
  setor_100/_dsr, funcionario_100/_dsr, mes_100/_dsr e indicadores valor_100,
  horas_100, funcionarios_100, valor_dsr, *_ly, funcionarios_junto. Página: abas
  (.aba, grupo 'hetipo') com filtros he (55%), he100 e heju; metas só na 55%; DSR
  fora da soma. Sem he_tipos (2025) a seção sai sem abas. Gerador: horasExtras100().
- 7.1.4 (04/11): metas do CD por setor (seção metas_setor: fat_, dev_, corte_ frio/seco,
  corte_sem_setor e quadro dev_motivo; `metasSetorCD()`, `faixaMeta()`). Devolução de
  carregamento ≤ 0,050% (ideal ≤ 0,010%) e corte da mesa ≤ 0,100% (ideal ≤ 0,025%), de 26
  a 25, sobre o faturamento do setor. "Chegou vencida" = DATA PROXIMA DA VALIDADE. O modelo
  Corte não tem setor: vai pelo f_PCCORTEI[NOMEFUNC] (7.1.11): Seco = Itajaci ou Marcos Adriano,
  Frio = os demais. Bate com a planilha do Tiago. Margarinas (26739-26742) e maioneses
  (26743, 26744, 27387, 27436) são do Comercial (7.2.2): saem do frio/seco, indicador corte_comercial. Só meta: nada de valor de bônus na tela.
- 7.1.7 (04/11): he_inventario em vo_quadros, gravado à mão só para 202610 (valor = HE 100%,
  valor2 = horas, valor3 = DSR). Fica fora de SECOES: a coleta não apaga. Já está dentro da
  HE 100% do Power BI; a aba "sem inventário" subtrai por funcionário e setor.
- 7.1.9 (04/11): Taxa de Completude e % Responsabilidade no S.A.C. A completude mede só a abertura (campos + foto, vídeo ou anexo de NF). A regra fica
  na view vo_sac_indicadores (migration 72), com a lista do que falta; mudou a regra no
  Dashboard (js/app.js), mude a view junto. % Responsabilidade: `temResponsavel()`. Metas: completude ≥ 90%, responsabilidade ≥ 95%.

## Banco de horas do RH (7.3.0, 13/11/2026)
- Página de envio SEM login em `/banco-horas` (`banco-horas/index.html`, mesmo repositório,
  rewrite no vercel.json, fora do service worker). O RH sobe o "Saldo de Horas"; grava pela
  função `bh_receber_envio` (security definer, migration 77). Tabelas `bh_envios` /
  `bh_saldos` / `bh_he_dia`, só leitura para o anon, fora da sincronização (egress).
- Conta única em `js/bancoHoras.js` (UMD: página do RH, app, Visão Operação, gerador). Lê só
  as abas BANCO DE HORAS (negativas/positivas até a 10ª hora, decimal, período MM/AAAA) e
  HORAS EXTRAS (Nome, Dia em série 1904, HE 100%, HE 55% depois da 10ª hora). A aba SALDO
  DE HORAS do RH tem 55% e 100% trocados nas fórmulas: não usar.
- Regras do Tiago: colaborador = saldo + 55% + 100% (colunas separadas); setor = só saldos
  POSITIVOS + 55% + 100% (devendo nunca abate); banco positivo é pago como 55%, então a meta
  em horas (`metaHoraExtra`) compara Banco + com 55%; 100% fica fora da meta. Só operação;
  "3 TURNO" = 2º turno. Só horas, sem R$. Vale o último envio do dia (os outros ficam
  `substituido`). Entre fotos: negativas que crescem = compensação; que diminuem = abono.
- Tela: Boletim Gerencial → Banco de Horas (`boletim_banco_horas`, todos os perfis), no fim
  de `js/app.js`. Visão Operação: quadro "Acompanhamento do RH" na seção Hora extra (`d.bh`).
- Próximo passo combinado: cruzar compensação com saída antecipada/falta do Oper ("Vai compensar?").

## Escala de embarques (6.10.0, 30/10/2026)
- Menu Escala (Matrizes, Convocação Escala, Fechamento) em `js/escala.js`;
  substitui as planilhas `S:\Logistica\01 - LOGISTICA INFORMATIVO\11 - CARGAS E
  ROTAS\Escalas e Gestão de Embarque\` (matriz por dia + FECHAMENTO DIA).
- Migration 56 (APLICADA em 30/10): `escala_matrizes` (dia_semana 1–6, retorno
  = saída + N dias na hora indicada) e `escala_linhas` (uma por viagem do dia).
  Fora da sincronização automática (egress): lidas ao abrir e gravadas direto.
- Decisões do Tiago: avisos não travam e cruzam motorista × ajudante; placa
  diferente da matriz abre Troca de Veículos; peso/valor/entregas manuais (quem
  fecha a carga digita); a linha vira viagem no Controle de Viagens quando ganha
  a carga ("45025 / 45026" fica junto; separar só ao cruzar com o WinThor).
  Retornos semeados de "Horário Fechamento Rotas (2025.11)", desatualizado:
  ajustar na tela.
- Importar Fusion: `roteirizacoes (N).xlsx` (CARGA ERP, ENTREGAS, PESO, VALOR,
  DESTINO, MOTORISTA, VEICULO, AJUDANTE 1-4, FILIAL EXPEDICAO). Rota sem carga
  no dia (COLINAS 02, ARAGUAINA III) fica na convocação e sai do fechamento.
- Transbordo (6.11.0, migration 57 APLICADA em 30/10): setor `TRANSBORDO` +
  `transbordo_id` nas rotas (matriz e escala). Só veículo PRÓPRIO; terceiro
  fica na observação. Imagem: rota com transbordo mostra "NOME - PLACA" dele.
  Vira viagem quando uma rota que leva ganha carga, com carga
  `TRANSB dd.mm.aaaa PLACA` (setor TRANSBORDO). Fusion "CROSS DOCKING PALMAS"
  liga ao transbordo de Palmas se houver um só no dia. Peso do transbordo =
  soma das rotas, fora do total da montagem.
- Cross Palmas (7.6.0, migration 81): tabela `cross_movimentos` (RECEBIDO_CROSS
  e EMBARQUE, item a item, `manifesto` agrupa o transbordo), gravada direto na
  nuvem por `js/crossPalmas.js` (fora do localStorage e do pull). Perfil novo
  CROSS (departamento CROSS PALMAS), vê todas as telas. Local atual da
  devolução é DERIVADO (na rota → no cross → em transbordo → no CD), nunca
  gravado. Confronto = registrado × cross × embarcado × conferido no CD.
  Terceiro nunca traz de Palmas (só deixa e segue): não há transbordo avulso.
  Reentrega de Palmas sai do cross: `local_armazenagem` "CROSS PALMAS...".
  7.7.0 (migration 82): tipos SEM_PRODUTO (falta/inversão/renegociado, não
  vira estoque) e DESCARTE (avaria descartada em Palmas, foto obrigatória em
  devolucoes-fotos/cross/, `autorizado_por`). Local derivado ganha
  SEM_RETORNO ("nada a voltar"); o modal do CD sugere o destino.
- 2º ajudante (6.11.0, migration 58 APLICADA): coluna `ajudante_2` em matrizes
  e linhas. "A / B" vindo das planilhas é separado ao carregar
  (`escSepararAjudantes`) e gravado separado na próxima edição. Fusion:
  AJUDANTE 1 -> ajudante, AJUDANTE 2+ -> ajudante_2. Imagens juntam "A / B".
- Migrations 59, 60 e 61 (APLICADAS 30/10): nomes das matrizes e da escala de
  02/11 = Cadastros Mestres; ARMANO -> ARMANDO LIMA DA CUNHA e tabulação do
  GLEDSON (cadastro, viagens, infrações). EDSON ARRUDA é RCA (veio do
  WinThor): não considerar.
- Cadastros Mestres ganhou busca e edição em Motoristas, Ajudantes e Veículos
  (6.11.2). Renomear pessoa ou trocar placa pode corrigir o histórico direto
  na nuvem por valor exato (`cadCorrigirHistorico` / `CAD_HISTORICO` em
  app.js; escala "A / B" trocada por pedaço).
- Prévia das imagens (convocação e fechamento): Copiar, Compartilhar, Baixar PNG
  e Imprimir (6.11.4, `escImagemImprimir`: iframe escondido, A4 deitada ou em
  pé conforme a proporção da imagem).
- 6.11.6 (04/11): `viagem_id` na linha não prova que a viagem subiu. addViagem
  não gravava `criado_em` (NOT NULL); no lote com viagem editada o igualador de
  chaves do upsert mandava null e tudo voltava 400 em silêncio. Hoje a viagem
  nasce com o campo, o upsert completa as presas, 23505 sobe uma a uma
  (`_enviarViagensUmaAUma`) e o Fechamento mostra "⚠️ não chegou" (`escSeloViagem`).
- Disponibilidade e Folgas (7.0.0, migrations 64 e 65 APLICADAS em 04/11):
  `escOcupacao` é a regra única de quem está fora por viagem, usada pelos avisos e
  por `escDisponibilidade`. Referência geral 06:00 do dia: NÃO é corte por rota
  (prestador não tem horário; a saída é o máximo aceitável) e não há descanso
  mínimo (decisões do Tiago). Viagem sem status conta como aberta. Previsão vencida
  com viagem aberta = Verificar. Retido (retenção) e Parado em rota (ocorrência
  aberta) são situações diferentes. Inativo não aparece.
- `escala_folgas` fora do sync: Dossiê lê por `escFolgasDoPrestador`. Atestado de
  prestador é categoria de folga; Abonado = não gera desconto (só registro).
- Rota de véspera: sai à tarde, em geral domingo e quarta, e pertence à matriz do
  dia seguinte. A viagem nasce com a data da escala; quem registra acerta o dia
  real, e editar a linha depois não sobrescreve se já houver hora de saída.
- Equipe da viagem (7.0.0, migration 67 APLICADA): antes da viagem manda a escala; troca feita
  no Controle de Viagens sobe para a linha (`escAtualizarLinhaDaViagem`), guardando quem estava
  escalado em `*_escalado`/`placa_escalada`. Com hora de saída, linha e Fusion não mudam mais a
  equipe da viagem. Divergência vira selo com botão, nunca cópia automática.
- `motoristas.uso_escala` (7.1.0, migration 69 APLICADA): ROTA, TRANSBORDO (carreta: Fagno, Célio),
  FIXA (Silvestre, carne) e NAO. Só muda sugestões da escala e Disponibilidade; as outras abas
  continuam vendo todos. Motorista com infração não se exclui: marcar NAO.
- `veiculos.uso_escala` (7.1.1, migration 70 APLICADA): ROTA ou FIXA. FIXA (RIN7G15, carne) sai da
  Disponibilidade e do arquivo, mas segue nas sugestões de placa.
- `veiculos.setor` (migration 66 APLICADA): FRIO é refrigerado e não muda de setor.
  Preenchido pelas viagens desde 01/06, editável em Cadastros Mestres. Disponibilidade
  separa por setor e deixa fora PASSEIO, UTILITARIO, CARRETA e CAVALO.
- Migration 65 gravou os retornos pelo histórico; quem organiza as matrizes é o
  Luizinho. Não rodar de novo: pisa nos ajustes dele.
- Previsão de largada (7.4.0, migration 78 APLICADA em 16/11): `largada_dias` (0 no dia,
  -1 véspera) e `largada_hora` na matriz; `previsao_largada` na linha. Decisões do Tiago:
  linha da matriz usa SEMPRE a da matriz (`escLargadaDaLinha`); viagem avulsa (à mão ou
  nova pelo Fusion) informa a sua. A largada NUNCA vai para as imagens dos grupos (prestador);
  sai só na Via da portaria do Fechamento (`escViaPortaria`): rotas com carga + transbordos
  na mesma lista, da largada mais cedo para a mais tarde, formato "16/11/2026 - 15:00",
  sem peso/valor/entregas, coluna "Saída real / visto". Aviso automático de quem não saiu
  fica para quando houver API do WhatsApp.
- SOBREAVISO (7.8.7): a imagem da convocação traz, no fim, Motorista disponível | Ajudante
  disponível (`escBlocosDisponiveis`, só DISPONIVEL). Fechamento não muda.
- Fixos da carne (7.8.8, migration 83 APLICADA em 26/11): `ajudantes.uso_escala` (ROTA/FIXA,
  Gabriel = FIXA) tira da Disponibilidade e do sobreaviso. `escala_viagens_fixas` +
  `jr_criar_viagens_fixas(data)` + pg_cron `escala-viagens-fixas` (5h UTC = 2h Brasília, o próprio dia)
  lançam ARAGUAINA CARNE e CARNE TARDE (Silvestre/Gabriel, RIN7G15) no Controle de Viagens,
  seg–sáb, sem carga: não passam pela Escala/Fechamento (decisão do Tiago: não dá para saber
  qual carga é de qual). Mudar placa/pessoa/dias: UPDATE em escala_viagens_fixas.
- Nome do Fusion x cadastro (7.8.8): `escResolverPessoa` casa também mesmo 1º nome + partes de
  um contidas no outro (sem DE/DA/DOS), único candidato (Ademar e Nilmar em 26/11).
- SQL que mexe em escala_* (ou qualquer tabela com a guarda de carimbo):
  `atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo')`, NUNCA `now()`
  puro. O app grava hora de Brasília; um carimbo em UTC fica 3 h no futuro e
  a guarda passa a ignorar as edições do app nessa linha.

## Tratativas do Gestor: Condutas (7.5.0, 17/11/2026)
- Conduta / desvio de rota (Oc. em Rota tipo CONDUTA_INADEQUADA; Oc. Operacional com
  motivo contendo CONDUTA ou DESVIO: `Store.motivoEhConduta`) ganha item `{area:'GESTOR'}`
  na lista JSONB `tratativas` (migration 80, APLICADA em 17/11) e cai em Tratativas do
  Gestor → subaba Condutas (`js/tratativas.js`). Só fecha quando o gestor conclui
  (`concluirTratativaGestor`): Rota fecha se a manutenção não estiver pendente;
  Operacional grava a decisão na Ação Tomada e finaliza.
- A manutenção continua em `retorno_manutencao_*` (Power BI, OS e relatórios leem de lá).
  Área nova vira item da lista, não coluna nova.
- SLA do gestor nas condutas = `enviado_em` da tratativa (24 h/48 h), gravado uma vez.
- Conduta com veículo em rota não gera prévia de retenção nem exige "serviço realizado".
- Evidências da Oc. Operacional: módulo de foto `ocoper` (bucket rota-fotos, pasta
  ocoper/), etapas `fotos` e `tratativa`; anexo do gestor na Rota = etapa `tratativa`.

## Pendências
- Segurança: repositório público; todas as tabelas com política
  `acesso_total_anon`; login próprio (tabela `usuarios`, hash no navegador),
  não Supabase Auth. Precisa corrigir antes da visão individual por colaborador.
- Tabela `bkp_itens_devolucao_limpeza_20260918` sem RLS.
- Próximo passo planejado: visão individual do colaborador (depois de validar a
  visão geral).
