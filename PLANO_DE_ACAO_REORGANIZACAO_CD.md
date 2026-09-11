# Plano de Ação — A reorganização do CD

Escrito em **09/09/2026**, com a v6.6.2 no ar. Sai como **v6.7.0**.
Os Blocos 0 e 0.1 (consertos em produção) saem antes, como **v6.6.3** —
ver "Ritual de versão".

O `PLANO_DE_ACAO.md` (v6.6.0, "O segundo ajudante") continua válido e não é
tocado por este. Este arquivo é o plano seguinte.

---

## O que este plano resolve

Uma frase dita em 09/09/2026 resume o diagnóstico: *"está atribuindo os erros
através do Resumo Diário; a única coisa que precisa buscar desse resumo é o
status de falta."*

O Resumo Diário do CD virou o depósito de cinco coisas diferentes. Três delas
— ocorrências operacionais, apontamentos por colaborador e cortes — não têm
vida própria: são arrays aninhados dentro de um envelope de data+turno. Como
o registro não tem data, nem identidade, nem forma de ser salvo sozinho,
nasceram daí dois defeitos que ninguém consegue corrigir um a um:

1. **A data que se edita não muda nada.** O modal grava `item.data`
   (`app.js:18327`); o painel imprime a data do envelope (`app.js:18153`).
   Para a ocorrência mudar de dia seria preciso tirá-la de um array e
   inseri-la em outro, e nenhum código faz isso.
2. **O endereço do registro é uma posição, não uma identidade.** Todo botão
   carrega `(data, turno, tipo, index)`. O registro tem `id` — `gerarIdUnico()`
   já produz ids seguros entre aparelhos — mas nada o endereça por ele.
   Localmente o índice é estável (o `_sortAll` não reordena arrays filhos), o
   que torna este o menos urgente dos dois; some junto com o outro.

E um terceiro, visível na tela: o painel consolidado força duas coleções de
formatos diferentes na mesma tabela (`getTodasOcorrenciasCD`, `app.js:18143`).
Por isso toda ocorrência operacional imprime `OPERAÇÃO CD` na coluna
Funcionário, e por isso "FÉRIAS" aparece sob um cabeçalho chamado
"Requisito / Falha".

**Separar as abas é a correção.** Não é cosmética: dar aba própria a cada
coisa é dar identidade a cada registro. Os dois primeiros morrem por
construção; o da coluna some porque aquela coluna deixa de existir no painel.

O layout de hoje já está certo — o Item 3 do Resumo Diário tem os cabeçalhos
corretos (`Ocorrência | Causa / Detalhamento | Ação Tomada`). O que não está
certo é a gravação por trás dele. Este plano faz a gravação corresponder ao
que a tela já promete.

### Dois pontos levantados e descartados em 09/09/2026

Ficam escritos para não serem redescobertos com peso errado.

**Remontar o item ao salvar não é problema.**
`confirmarSalvarOcorrenciaResumo` remonta a ocorrência com quatro campos
(`app.js:21490`), o que apagaria `status` ao editar. Com a decisão de que a
Ocorrência CD não tem status, o registro passa a ter exatamente os campos que
o formulário redigita — não há o que perder. Fica só a guarda de forma: o
`updateOcorrenciaCD` novo usa `Object.assign(item, updates)`, o mesmo padrão
de `updateOcorrenciaViagem` (`store.js:2646`), para que um campo futuro não
reintroduza o problema.

**A mesclagem por envelope é estreita demais para preocupar.**
`_mesclarPorRegistro` (`cloudStore.js:1001`) desempata por `atualizado_em`, e
para o `resumo_diario_cd` "um registro" é o envelope do dia+turno inteiro,
recarimbado a cada save (`store.js:2753`). Em tese, um aparelho com cópia
defasada sobrescreveria os lançamentos do outro. **Na prática a janela é de
~30 segundos**, por duas razões medidas: o auto-sync puxa da nuvem a cada 30s
(`cloudStore.js:2808`), e `salvarResumoDiarioCdCurrent` (`app.js:21215`) lê o
envelope fresco e sobrescreve só `gestor` e `movimentacao`, deixando
ocorrências, faltas e cortes como vieram do pull — os formulários de
ocorrência fazem o mesmo, lendo e dando `push`. Exigiria dois lançamentos no
mesmo dia+turno dentro do mesmo intervalo de 30s. **Não muda a forma de
operar e não justifica sozinho este plano** — mas some de graça quando cada
registro virar linha própria. Decisão de 09/09/2026: quando dois aparelhos se
sobrepõem, o segundo é correção e deve sobrepor mesmo.

---

## As decisões tomadas (09/09/2026)

Estão escritas porque cada uma dispensou trabalho que já estava desenhado.

**1. A nota de férias/treinamento continua entrando como Ocorrência do CD,
como se lança hoje.** Ela existe para isentar a supervisão de cobrança
posterior da gerência ou da diretoria — é documento de defesa do turno, não
registro sobre uma pessoa.

*O que isso dispensou:* o campo `natureza`, o par "colaborador relacionado +
motivo", a extensão da lista de Conduta/Ausência com Férias/Treinamento/
Atestado, e a triagem manual dos registros históricos. **A Ocorrência CD não
tem campo de funcionário. Nenhum.** É a ausência da coluna que resolve o
`OPERAÇÃO CD`, não o preenchimento dela.

**2. A Ocorrência CD não tem status.** Sem Pendente/Fechado, sem os dois
painéis, sem botão disciplinar. Lista corrida com filtro e exportação.

**3. Não há visão consolidada de pendências do CD.** Depois do split,
pendência só existe em Ocorrência Colaborador e em Retorno Físico — e o
Retorno Físico já tem alerta próprio.

**4. "Controle de Viagens" é o nome correto. "Largada" deixa de existir**
como subaba: o conteúdo da Largada passa a ser a própria tela de Controle de
Viagens, sem barra de subabas.

**5. O Resumo Diário não muda de aparência.** Continua exibindo os Itens 3 e 4
exatamente como hoje. O que muda é onde eles gravam.

**6. As três subabas do Boletim Gerencial sobem para o menu lateral.**

---

## A árvore final do menu

```
Visão Geral
   └ Dashboard Executivo

Boletim Gerencial                       <- grupo novo
   ├ Visão Executiva
   ├ Exportação CSV
   └ Central de PDFs

Devoluções (SAC)                        (sem mudança)

Centro de Distribuição
   ├ Retorno Físico
   ├ Resumo Diário
   ├ Ocorrência Colaborador             <- era a subaba "Ocorrências CD"
   ├ Ocorrência CD                      <- nova
   └ Corte                              <- nova

Operação & Frota
   ├ Controle de Viagens                <- sem subabas; é a Largada
   ├ Oc. Operacional                    <- promovida
   ├ Oc. em Rota                        <- promovida
   ├ Reentregas                         <- promovida
   ├ Troca de Veículos                  <- promovida
   ├ Disponibilidade da Frota
   └ Investigação de Sinistro

Pessoas
   ├ Dossiê Prestador                   <- era "Dossiê do Motorista"
   └ Acompanhamento do Funcionário

Administração                           (sem mudança)
```

---

## A ordem, e ela importa

### Bloco 0 — A sincronização da Disponibilidade da Frota (10/09/2026)

Primeira ação, e ela não espera pelo resto do plano: é conserto de defeito em
produção, não reorganização. Entrou aqui porque toca o mesmo Supabase e o
mesmo `cloudStore`, e fazer os dois em ordem trocada dá conflito.

**O defeito.** A liberação de veículo grava `descricao_acao_liberacao` (a Ação
de Manutenção Realizada, obrigatória desde 17/08/2026 —
`app.js:confirmarLiberacaoFrota` valida antes de chamar). A coluna nunca foi
criada no banco: existia só no JavaScript. Cadeia completa:

1. Todo POST de `retencoes_frota` que carregasse uma liberação voltava
   **PGRST204** e era recusado inteiro.
2. O igualador de chaves de `upsert()` copia toda chave nova para **todos** os
   objetos do lote (o PostgREST exige chaves iguais no array). Uma liberação
   derrubava o lote inteiro da tabela.
3. `_confirmarEnvio()` só roda com o POST aceito — os registros ficavam
   "sujos" para sempre, retentando a cada 30s e falhando toda vez, em silêncio.
4. Na leitura, `_mesclarPorRegistro` faz registro sujo vencer a nuvem, o que
   prendia cada aparelho à sua própria versão.

**O sintoma.** 10/09/2026: o PC da manutenção mostrava 2 veículos LIBERADOS e o
do analista mostrava os mesmos 2 RETIDOS, indefinidamente — RET-2026-001
(RSE9H43) e RET-2026-002 (RMC7H05). No banco, as duas linhas RETIDO com
`data_liberacao` e `atualizado_em` nulos. O indicador de nuvem ficou verde o
tempo todo.

**Estado em 10/09/2026, fim do dia:**

- ✅ **`database/migration_43_retencao_descricao_acao.sql` — APLICADA em
  produção.** Aditiva, não tocou dado existente. É ela que destrava a
  recuperação, e independe do build.
- ⏸️ **`js/store.js`** — `liberarVeiculo()` passa a gravar `atualizado_em`.
  Era a única operação de retenção que não gravava (`updateRetencaoFrota` já
  gravava), o que fazia a liberação cair sempre no desempate cego "o local
  vence". **No disco, não publicado.**
- ⏸️ **`js/cloudStore.js`** — `retencoes_frota` declarada em
  `COLUNAS_POR_TABELA`. A migration conserta ESTE campo; a lista branca
  conserta a CLASSE: campo que o JS invente e não seja coluna passa a ser
  podado antes do POST em vez de derrubar o lote. Conferida contra o banco por
  `full outer join`: 21 colunas dos dois lados, zero divergência.
  **No disco, não publicado.**

**A ordem de publicação é obrigatória, e o motivo é medido.** A lista branca
muda o cálculo do hash de sync da tabela (`_hashParaSync` usa a mesma
projeção). No primeiro carregamento do build novo, **toda retenção de todo
aparelho vira "suja" de uma vez** — e um aparelho com a versão velha pode
empurrar `RETIDO` por cima do `LIBERADO` recém-chegado. Então:

1. O PC "Leonardo Oficina" abre o app. As duas liberações estão presas no
   localStorage dele, ainda marcadas como sujas — o primeiro ciclo de sync as
   sobe sozinho, com as datas e os textos originais. Ninguém redigita nada.
2. Conferir no Supabase (projeto `qxipgnkdbzxtfvuyupow`) que as duas linhas
   estão `LIBERADO` com `descricao_acao_liberacao` preenchida.
3. **Só então** publicar o build com os dois arquivos acima.

Enquanto o passo 2 não fechar, o texto da ação de manutenção das duas
liberações existe **só** no navegador do Leonardo. Limpar dados do site
naquele PC apaga a única cópia.

**O que este bloco ensina para o resto do plano.** O Bloco A cria três tabelas
e o Bloco B três coleções novas. Toda coluna que o store gravar tem que existir
na migration — foi exatamente esse descasamento que custou os dias acima, e ele
não acende luz nenhuma na tela. Vale declarar as três coleções novas em
`COLUNAS_POR_TABELA` já no Bloco A, quando a lista de colunas ainda está
fresca, em vez de descobrir o buraco em produção.

> **Atualização de 11/09/2026.** O passo 2 fechou: RET-2026-001 (RSE9H43,
> liberada 09/09) e RET-2026-002 (RMC7H05, liberada 11/09) estão `LIBERADO`
> no banco com `descricao_acao_liberacao` preenchida. A trava de publicação
> deste bloco está destravada. Os dois arquivos saem no build 6.6.3 junto
> com o Bloco 0.1 abaixo — ver "Ritual de versão".

### Bloco 0.1 — A ação do gestor que sumia (11/09/2026)

Segundo conserto de defeito em produção, e pelo mesmo motivo do Bloco 0 ele
não espera pela reorganização: toca `store.js` e a mesclagem do
`cloudStore`, e sai **antes** dos Blocos A–F. Código pronto e testado no
disco; falta só a publicação — e a publicação é a parte que este bloco
detalha, porque é ela que pode atrapalhar a operação.

**O defeito.** 11/09/2026, DEV-004: o supervisor digitou e salvou a Ação do
Gestor; na tela de outro aparelho a mesma devolução foi editada pela
Devoluções SAC às 09:25; no ciclo seguinte de sincronização a ação sumiu, e
sem rastro. A cadeia:

1. A mesclagem do pull (`cloudStore.js`, "DESEMPATE POR atualizado_em",
   28/08/2026) decide entre a cópia local e a da nuvem pelo carimbo: quando
   divergem, ganha a mais nova. A regra **assume** que toda edição de
   verdade carimba `atualizado_em`.
2. `updateAcaoGestor` não carimbava — gravava só `data_acao_gestor`. A cópia
   do gestor ficou com o carimbo da última análise (01/09) e perdeu para a
   edição das 09:25, descartada em silêncio **antes de subir**.
3. Não havia `logAudit` na ação do gestor, então o sumiço não deixou trilha.
   Prova no banco: várias ações salvas em 11/09 têm `data_acao_gestor` mais
   novo que `atualizado_em`; sobreviveram só porque ninguém mexeu naqueles
   registros no mesmo período.

É o mesmo defeito do Bloco 0 (`liberarVeiculo()` sem carimbo), na terceira
tela em que aparece. A varredura de 11/09 achou **mais dezoito caminhos** da
mesma classe: recepção no CD (`updateDestinoCd`, devolução e itens),
negociação de item (store e tela), divisão de destino, exclusão de item do
retorno físico, jurídico do sinistro, edição e exclusão de viagem, de
ocorrência de viagem e de troca de veículo, `softDelete` e `restoreItem`
genéricos, exclusão de sinistro, de retenção e de reentrega, e o rollback de
versão. Nas exclusões o efeito é pior: sem carimbo, a mesclagem podia
**ressuscitar** o que foi apagado.

**O que está no disco (11/09/2026), não publicado:**

- ✅ `js/store.js` — `Store#carimbarEdicao(coleção, registro)`, único ponto
  que carimba `atualizado_em` (e `atualizado_por` onde a tabela tem), chamado
  nos dezenove caminhos acima. Só carimba nas coleções cuja tabela **tem** a
  coluna (`Store.COLECOES_COM_ATUALIZADO_EM`, conferida no
  `information_schema` em 11/09): `itens_devolucao`, `sinistros` e outras
  não têm lista branca no push, e chave a mais derruba o lote com PGRST204 —
  a lição do Bloco 0. De tabela, isso fechou um buraco latente: a edição de
  item de destino escrevia `atualizado_em` também no item **avulso**, e
  `itens_avulsos_destinacao` não tem a coluna.
- ✅ `js/store.js` — `updateAcaoGestor` registra `ACAO_GESTOR` na auditoria,
  com antes/depois.
- ✅ `js/app.js` — na Tratativas do Gestor, cada card é um `<form>` e salvar
  um deles redesenha a tela inteira; texto digitado em **outro** card e não
  salvo sumia sem aviso. Agora o app procura texto pendente nos demais cards
  e pergunta antes de redesenhar.
- ✅ `js/cloudStore.js` + `js/app.js` — a auto-atualização
  (`jrPodeRecarregarAgora`) passou a respeitar a marca de digitação
  (`_jrTelaComDigitacao`): texto digitado num card **sem foco** também adia
  o reload, inclusive em aba de fundo. O `renderApp()` que apaga a marca
  retoma a atualização adiada 2,5s depois — tempo de o debounce de 1,5s do
  `save()` despachar o envio antes do reload.
- ✅ Os quatro marcadores de versão já estão em `6.6.3` /
  `carimbo-acao-gestor-6.6.3`; `version.json` traz `resumo` e
  `observacao_deploy` desta versão.
- ⛔ **Sem migration.** Toda coluna que a versão passa a escrever já existe —
  conferido por consulta, não suposto.

**Por que a publicação não atrapalha a operação, e o que garante isso.**
Não há migration, não há mudança de hash de sync desta correção (nenhuma
lista branca nova), e o dado gravado pela 6.6.3 é lido pela 6.6.2 sem erro.
Os riscos reais são três, e cada um tem uma resposta:

| Risco | O que acontece | Resposta |
|---|---|---|
| Reload derrubar texto não salvo | A auto-atualização recarrega a página; texto num card sem foco ou em aba de fundo se perdia | A marca de digitação agora adia o reload (item acima). Mesmo assim, avisar as pessoas: **salvar o que estiver digitado** antes da janela. |
| Aparelho velho e aparelho novo convivendo | Um edita com carimbo, outro sem | A direção está certa: a edição do aparelho novo vence a do velho. Nenhum dado é corrompido, e a janela de convivência é de minutos (auto-atualização) |
| O Bloco 0 sai junto: **toda retenção de todo aparelho vira "suja" de uma vez** (a lista branca muda o hash) | No primeiro sync do build novo cada aparelho reenvia todas as retenções | As duas liberações já estão no banco (passo 2 do Bloco 0), então o reenvio empurra o que já é verdade. Publicar com o PC "Leonardo Oficina" **entre os primeiros** a atualizar, e conferir as duas linhas no banco depois. |

**Roteiro de publicação (a fazer, em breve):**

1. **Aviso prévio** aos supervisores e ao SAC, 15 minutos antes: "salve o
   que estiver digitado; o app vai atualizar sozinho". O supervisor que mantém
   a tela aberta o dia inteiro é o primeiro da lista — e é ele quem redigita
   a ação da DEV-004 depois (não existe cópia dela em lugar nenhum).
2. **Publicar** os arquivos: `js/store.js`, `js/app.js`, `js/cloudStore.js`,
   `js/config.js`, `sw.js`, `version.json`.
3. **Primeiros aparelhos:** PC "Leonardo Oficina" (pelo Bloco 0), depois o do
   gestor, depois SAC ADRIANA e Monitoramento. Nos demais a auto-atualização
   faz o trabalho nos eventos de foco/visibilidade; PASSO 4 do `GO_LIVE.md`
   (`Ctrl+Shift+R`) só onde não entrar sozinha.
4. **Conferir**, no console, `jrDiagnosticoSync()` → `buildSync` =
   `carimbo-acao-gestor-6.6.3`. Na tela de Aparelhos, "versão antiga" tem
   de zerar entre os vistos nos últimos 3 dias.
5. **Conferir no banco**, no mesmo dia:
   - `retencoes_frota`: RET-2026-001 e 002 seguem `LIBERADO`;
   - `ocorrencias_devolucao`: a primeira Ação do Gestor salva na versão nova
     tem `atualizado_em` = `data_acao_gestor` e `atualizado_por` = o gestor;
   - `audit_logs`: existe linha `ACAO_GESTOR` para ela.
6. **Teste de mesa com dois aparelhos**, uma vez: gestor salva ação numa
   devolução; SAC edita a mesma devolução no outro aparelho; 1 minuto depois
   a ação continua lá nos dois. Era exatamente o cenário da DEV-004.
7. **Volta atrás**, se precisar: republicar os seis arquivos da 6.6.2. Nenhum
   dado precisa ser desfeito — a 6.6.3 só escreve colunas que a 6.6.2 já
   conhece.

**O que este bloco ensina para o resto do plano.** Todo método novo do Bloco
B que edite ou exclua registro de coleção sincronizada chama
`carimbarEdicao()` — e as três coleções novas entram em
`Store.COLECOES_COM_ATUALIZADO_EM` no mesmo commit em que a migration 44
criar a coluna. A varredura que achou os dezoito caminhos é repetível: método
com `this.save()` que muda campo e não carimba.

### Bloco A — Banco e sincronização

Primeiro porque nada do resto sincroniza sem isso, e porque é o único passo
deste plano que toca o Supabase.

> **Renumerada de 43 para 44 em 10/09/2026.** O número 43 foi consumido pela
> migration do Bloco 0, que já está aplicada em produção. Migration aplicada
> não se renumera — quem cede é a que ainda não rodou.

**`database/migration_44_reorganizacao_cd.sql`** — três tabelas novas, no
mesmo padrão das existentes (PK BIGINT, RLS ligada, policy `acesso_total_anon`,
soft delete):

- `ocorrencias_cd` — `id, data, turno, ocorrencia, causa, acao, gestor,
  criado_por, criado_em, atualizado_em, is_deleted, deleted_at, deleted_by_nome`
- `ocorrencias_colaborador` — os campos de auditoria acima mais `funcionario,
  requisito, carga, peso NUMERIC, detalhamento, status, medida_disciplinar,
  alinea_clt, dias_suspensao, disciplinar_gerada_em`
- `cortes_cd` — `id, data, turno, cod_item, descricao, quantidade, valor` mais
  os de auditoria

**A migration é aditiva.** As colunas JSONB `ocorrencias`,
`ocorrencias_colaboradores` e `cortes` da tabela `resumo_diario_cd`
**permanecem intactas**. Só depois de a migração de dados rodar e ser
conferida em produção é que se decide, em outro plano, se elas somem. Enquanto
existirem, são a rede de segurança.

**`js/cloudStore.js`** — três entradas em `CloudStore.MAPA_TABELAS`
(linha 3289) e as duas listas de reset: `_clearTransactionalData`
(linha 407) e `clearCloudTrainingData` (linha 2188).

### Bloco B — Store: as três coleções

**`js/store.js`:**

- `ensureArray` para as três coleções novas, junto das demais (~linha 325).
- CRUD por coleção: `addOcorrenciaCD` / `updateOcorrenciaCD` /
  `deleteOcorrenciaCD` (soft delete, mesmo padrão de `deleteOcorrenciaViagem`)
  e os pares equivalentes para colaborador e corte. Todo `add` grava
  `id: this.gerarIdUnico()`, `data`, `turno`, `criado_por`, `criado_em`.
- Getters com filtro: `getOcorrenciasCD({ dataDe, dataAte, turno })`,
  `getOcorrenciasColaborador({...})`, `getCortesCD({...})` — e as versões por
  data+turno exatos, que são as que a tela do Resumo Diário consome.
- **Migração `migrarFilhosDoResumoDiario()`**, idempotente, rodada uma vez no
  boot: percorre `resumo_diario_cd` e, para cada filho que ainda não exista na
  coleção nova, cria o registro herdando `data` e `turno` do envelope,
  preservando o `id` quando houver. Marca o resumo com `filhos_migrados_em`
  para não repetir. **Não apaga nada do envelope.**
- As três coleções entram nas duas listas do Reset Global de Treinamento
  (`this.data.X = []` e `chavesLimpeza`, ~linhas 3397 e 3425).

### Bloco C — As telas do CD

**Resumo Diário — aparência idêntica, gravação nova.** Os Itens 3, 4 e 5
continuam onde estão, com os mesmos cabeçalhos. O que muda por baixo:
`renderSubabaResumoDiario` passa a ler `db.getOcorrenciasCD({data, turno})` em
vez de `resumo.ocorrencias`, e os formulários passam a chamar os `add` novos.
Some a barra de subabas: o Resumo Diário volta a ser uma tela só.

**Turno padrão pelo cadastro do usuário logado.** Decidido em 09/09/2026.

Hoje a tela abre sempre em `2º TURNO - FRIO`, para qualquer pessoa, em toda
abertura do app — a constante está fixa em dois lugares (`app.js:20673` e
`app.js:21202`) e `window._resumoFiltroTurno` só vive em memória. O supervisor
do 1º turno que não trocar o seletor antes de lançar grava no envelope do 2º
turno. Não é perda de dado: é lançamento no turno errado, que é pior, porque
fica lá parecendo correto.

A chave é o campo `secao` do `colaboradores_cd`, que já diz o turno e já está
preenchido — foi escolhido por ser dado que alguém preencheu de propósito, e
que continua certo se um supervisor mudar de turno. **Nome de login foi
descartado como chave:** o mesmo supervisor aparece grafado de três jeitos no
código (`GUSTAVO CAMARA` em `app.js:20679`, `GUSTAVO CARDOSO` em
`app.js:15062`, `GUSTAVO CAMARA CARDOSO` no cadastro), e `MELQUIADES NETO`
não é sequer substring de `MELQUIADES NUNES DE SOUSA NETO` — falharia em
silêncio justamente no supervisor do 1º turno.

`turnoPadraoDoUsuario()`, chamada pelos dois pontos acima:

1. Resolve `db.currentUser.nome` para um registro de `colaboradores_cd`
   reaproveitando `getDadosColaboradorMestre()`, que já faz exato e depois
   substring com `normalizeStr`.
2. Lê a `secao`, normalizada: contém `SECO` -> `SECO`; contém `1 TURNO` ->
   `1º TURNO - FRIO`; contém `2 TURNO` -> `2º TURNO - FRIO`.
3. Qualquer outra coisa devolve `null`.

**O `null` não vira chute.** O seletor abre sem pré-seleção, com destaque em
âmbar e o aviso "selecione o turno", e o botão de salvar fica bloqueado até a
escolha. É o caso de quem não é supervisor, de quem tem `secao` genérica
(`CARREGAMENTO`) e de quem está em `CARREGAMENTO FRIOS - 3 TURNO` — seção que
existe no cadastro e **não tem turno correspondente** no Resumo Diário
(pendência anotada abaixo).

Resíduo conhecido, aceito: se um supervisor tiver cadastrado o login com a
forma curta do nome (`MELQUIADES NETO`), nem o casamento exato nem o de
substring o encontram, e ele cai no `null` — que pede a escolha em vez de
errar. Degrada com segurança.

No mesmo passo, **unificar o mapa turno -> gestor**, hoje duplicado em
`app.js:20679` e `store.js:2732` com risco de divergirem.

**Ocorrência Colaborador** — a atual `renderSubabaOcorrenciasCD` vira tela
própria, lendo só `ocorrencias_colaborador`. Mantém Pendentes + Fechadas,
filtros, PDF, Excel e os botões disciplinares — aqui há pessoa, e ela é CLT.
`getTodasOcorrenciasCD()` deixa de existir.

**Ocorrência CD** — tela nova, lista corrida. Colunas:
`Data · Turno · Ocorrência · Causa / Detalhamento · Ação Tomada · Ações`.
Filtro por período e turno, busca em texto, exportação. Sem funcionário, sem
carga, sem peso, sem status, sem botão disciplinar. O formulário é o de hoje
(`app.js:21445`) mais Data e Turno, agora editáveis e efetivos.

**Corte** — tela nova, mesma tabela do Item 4 (`Cód Item · Descrição ·
Qtd Cortada · Valor`), com filtro por período e o total em R$ do período.

**Os três formulários de hoje viram dois.** `abrirModalNovaOcorrenciaCD`
(`app.js:18345`) é o duplicado que some — é ele que grava `'OPERAÇÃO CD'` por
omissão, sem validar a seleção.

### Bloco D — Menu

**`js/app.js`, `NAV_GRUPOS` (linha 2676):** Boletim Gerencial vira grupo com
três itens; o CD ganha as três telas; as quatro subabas de Frota sobem para
irmãs de Controle de Viagens; Dossiê do Motorista vira Dossiê Prestador.
`switchTab` ganha os `case` novos. A chave interna `dossie_motorista` é
mantida — só o rótulo muda, para não quebrar nada.

Controle de Viagens perde a barra de subabas e passa a renderizar a Largada
direto.

### Bloco E — Dossiê Prestador

- Seletor passa a varrer `motoristas` **e** `ajudantes`;
  `getDadosPrestadorMestre(nome)` devolve `{ nome, matricula, tipo }`, onde
  `tipo` vem da tabela de origem. Cabeçalho: **Nome · Matrícula ERP ·
  Motorista|Ajudante**. Sem chapa, sem CNH, sem admissão, sem desligamento.
- **Saem** o bloco Medidas Administrativas e o botão "Emitir Orientação
  Verbal": prestador é PJ e não recebe medida CLT.
- Oc. em Rota e Sinistros só aparecem quando o prestador for motorista.
- **Entra** o bloco Devolução por Erro Motorista: `getDevolucoes()` filtrado
  por `tipo_erro === 'ERRO MOTORISTA'` e por `motorista_nome` **ou** presença
  em `ajudantes[]`. A data precisa ser mapeada de `data_abertura || criado_em`
  antes de `filtrarPorData`, que lê `.data` — campo que a devolução não tem.
- **Entra** o bloco Deduções / Adiantamentos, reaproveitando a lógica que já
  existe no exportador `adiantamento_motorista` (`app.js:23058`).
- Trava de uma linha no `<input list>` do prestador (`app.js:13782`): o
  datalist filtra por função corretamente, mas não rejeita valor digitado fora
  da lista. Validar contra o cadastro na gravação.

### Bloco F — Defeitos avulsos

Independentes de tudo acima; podem ser puxados para antes se conveniente.

- **Cards da Tratativas do Gestor não reagem aos filtros.** Os três leem
  `todosDevs` (linhas 8470, 8471, 8525), universo bruto anterior ao filtro,
  enquanto o rodapé lê `devsExibidos`. Extrair o predicado, aplicá-lo a
  `todosDevs` e só então separar por status. Os badges das abas continuam
  globais.
- **PDF e CSV do Acompanhamento saem sem as faltas.** Leem
  `getAusenciasRegistros()` — coleção morta desde 19/08/2026 — enquanto a tela
  lê `getFaltasCondutasPorColaborador()`. `app.js:1309` e `app.js:1381`.
- **Orientação Verbal duplicada no impresso.** A tela filtra
  `tipo !== 'ORIENTACAO_VERBAL'` (`app.js:1247`); PDF e CSV não.

---

## Ritual de versão

**Os Blocos 0 e 0.1 saem juntos e antes disto, como `6.6.3` /
`carimbo-acao-gestor-6.6.3`** (decidido em 11/09/2026; os marcadores já
estão no disco). São consertos de defeito em produção e não dependem de
nenhum outro bloco. A trava que segurava o Bloco 0 — as liberações do
Leonardo estarem no banco — fechou em 11/09. O roteiro de publicação está no
Bloco 0.1. A reorganização (Blocos A–F) continua como `6.7.0`, e só começa
depois de a 6.6.3 estar confirmada nos aparelhos.

Os cinco marcadores, conforme `GO_LIVE.md`:

| Onde | O quê |
|---|---|
| `js/config.js` | `appVersion` -> `6.7.0` |
| `sw.js` | `CACHE_NAME` -> `6.7.0` |
| `js/cloudStore.js` | `CloudStore.BUILD` -> `reorganizacao-cd-6.7.0` |
| `version.json` | `build` -> `reorganizacao-cd-6.7.0` |
| `js/store.js` | `currentVersion` — já lê o `config.js`, nada a fazer |

Depois: publicar e limpar o cache em cada aparelho (**PASSO 4** do
`GO_LIVE.md`). O `buildSync` do `jrDiagnosticoSync()` tem de dizer
`reorganizacao-cd-6.7.0`.

---

## O que fica de fora, de propósito

- **Apagar as colunas JSONB do `resumo_diario_cd`.** Ficam como rede de
  segurança até a migração ser conferida em produção.
- **A regra do prêmio do prestador.** O Dossiê Prestador sai com os blocos e a
  contagem por requisito, mas sem o veredito de elegibilidade — a lista de
  requisitos e a regra (tolerância zero, faixa, proporcional) ainda não foram
  definidas.
- **Módulo de Escala / Afastamentos.** Descartado em 09/09/2026: a nota de
  férias entra como Ocorrência do CD, e isso basta para o fim a que serve.
- **Identidade por id no histórico do Acompanhamento.** Os getters continuam
  casando por nome. Sem medidas para prestador, o risco caiu; segue anotado.
- **`turno_padrao` no cadastro do usuário.** Seria a chave mais confiável de
  todas — explícita, editável na tela de Logins e Senhas, sem depender de o
  usuário estar em `colaboradores_cd`. Fica para depois: a `secao` já responde
  pelos três supervisores de hoje.

---

## Pendência aberta

**O 3º turno existe no cadastro e não existe no Resumo Diário.** O
`colaboradores_cd` traz cinco seções — `CARREGAMENTO FRIOS - 1 TURNO`,
`- 2 TURNO`, `- 3 TURNO`, `CARREGAMENTO SECOS` e `CARREGAMENTO` — enquanto o
seletor de turno oferece só SECO, 1º TURNO - FRIO e 2º TURNO - FRIO. Ou as
pessoas do 3º turno são legado inativo, ou falta um turno na tela. Enquanto
não se decidir, elas caem no `null` do `turnoPadraoDoUsuario()` e precisam
escolher o turno à mão — o que é o comportamento seguro, mas não é resposta.
Levantado em 09/09/2026.
