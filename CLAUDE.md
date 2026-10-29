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
- Migrations ficam em `database/migration_NN_*.sql` (próxima: 55).
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
  não contam; devolução = toda `ERRO MOTORISTA`, analisada ou não (o
  usuário decidiu em 26/10: "a devolução ocorreu"); faltas entram pelo NOME,
  mesmo com função trocada no app; motor ocioso = Oc. Operacional (motivo
  MOTOR OCIOSO), sem os de isenção. Nomes vão como estão no app (#N/D na
  planilha se não baterem com a BD). Toda ocorrência sai com Requisito (o
  Victor abona na planilha).
- Motor ocioso do Power BI: modelo "CCO" (workspace LOGÍSTICA, o único que o
  service principal enxerga), tabela `fMoov` (alertas do rastreador; motorista
  vem do vínculo com a viagem). Edge Function `supabase/functions/sync-cco`
  grava em `cco_motor_ocioso` / `cco_sync_log` (migration 54), pg_cron
  `cco-sync-powerbi` 06h10 e 13h10. O Power BI tem ~7% de linhas idênticas
  que o relatório da CCO CONTA: a tabela guarda uma linha com `qtd`. Para a aba
  Motor Ocioso bater com o gráfico "Motorista Resp" do relatório (conferido em
  26/10), o gerador tira as placas `VEICULOS_FORA_MOTOR_OCIOSO` (OLH8E48,
  OLI0E88, OLI2E18, OLI2E91, QWA2318, TVD0F56) e remove os filtros manuais da
  tabela dinâmica (Veículo e Motorista; o do modelo escondia nomes/placas
  novos). Sem motorista = "(SEM VÍNCULO)". Isenções: manuais. Decisão de
  26/10: a aba Motor Ocioso é só apoio; na Ocorrências entram apenas os
  eventos confirmados pela CCO (Oc. Operacional).
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
  despesa de cartão ≤ 75% do mesmo mês do ano anterior; MOOV motor ocioso ≤ 500
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

## Pendências
- Segurança: repositório público; todas as tabelas com política
  `acesso_total_anon`; login próprio (tabela `usuarios`, hash no navegador),
  não Supabase Auth. Precisa corrigir antes da visão individual por colaborador.
- Tabela `bkp_itens_devolucao_limpeza_20260918` sem RLS.
- Próximo passo planejado: visão individual do colaborador (depois de validar a
  visão geral).
