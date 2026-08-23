# Implantação — JR Oper

Roteiro da rodada de correção decidida em **22/08/2026**, focada na
sincronização do módulo de **Transporte**.

Substitui o procedimento de go-live de 21/08 (migrações 22–24), que já foi
executado — está resumido no fim deste arquivo, em *Histórico*.

> **ESTADO EM 22/08/2026, 21h — ETAPAS 0 a 5 EXECUTADAS.**
> Falta **só a ETAPA 6** (teste de aceite). O Reset Global de Treinamento
> rodou às 20:41 e a base está zerada para o início de produção em 26/08.
>
> O texto abaixo preserva o roteiro e as decisões como foram escritos, com
> os resultados reais registrados em cada etapa. É documento de histórico
> tanto quanto de procedimento: **o valor dele é registrar o que foi tentado
> e por quê**, inclusive as premissas que se provaram erradas no caminho.

---

## Onde estamos hoje — 22/08/2026, 21h

| Assunto | Situação |
|---|---|
| Sincronização de SAC, CD e Financeiro | Funcionando desde 21/08 |
| Sincronização de **Transporte** | ✅ **Corrigida.** Os 7 mecanismos de 22/08 foram fechados nas Ondas 1+2 |
| Quatro tabelas que nunca sincronizaram | ✅ **Corrigidas na `migration_26` + 4.8.1** — ver *Rodada da noite de 22/08* |
| Migrações 22, 23, 24, 25, 25a, 25b, 26 | Aplicadas |
| Build em produção | `sync-4.8.2` |
| Frota | **Fechada em 3 aparelhos** (decisão 11). Notebook e Celular em `4.8.2`; PC Analista Logística em `4.8.0`, sem acesso no momento — não bloqueia (ver decisão 13) |
| Os 247 fantasmas | ✅ Expurgados na `migration_25`, e depois **apagados fisicamente** no Reset Global |
| Duplicatas de importação | ✅ Zeradas, e barradas no banco pelo índice único sobre `carga` |
| Cadastros mestre | ✅ 41 motoristas, 38 ajudantes, 89 veículos — preservados no Reset, conferidos no banco |
| Reset Global de Treinamento | ✅ **Executado 22/08 às 20:41**, carimbo em `sync_control` confirmado |
| Base operacional | **Zerada.** `controle_viagens`, `ocorrencias_devolucao` e `ocorrencias_rota` em 0 |
| Volume de viagens | ~400/mês → Teto 1 fechado pela paginação; Teto 2 continua aberto (ver abaixo) |
| RLS do banco | Aberto para `anon` — dívida conhecida, continua fora de escopo |
| **O que falta** | **ETAPA 6 — teste de aceite.** Prazo folgado: produção começa 26/08 |

> **Correção de 22/08 — a exclusão já propaga.** Este documento afirmava que
> exclusão nunca chegava à nuvem. Está desatualizado: `deleteViagem()`
> ([store.js:1402](js/store.js:1402)) e `softDelete()`
> ([store.js:1723](js/store.js:1723)) foram consertados em 20/08 e hoje
> sincronizam a flag normalmente. A ETAPA 0 confirmou no dado: há 3 linhas com
> `is_deleted = true` na nuvem, excluídas pelo app.
>
> O problema real é outro, e é mais sutil: como o envio usa
> `resolution=merge-duplicates` e reenvia a tabela inteira, **qualquer
> aparelho com cache anterior à exclusão a desfaz no ciclo seguinte** — ele
> manda a mesma linha com `is_deleted` falso e sobrescreve. A exclusão
> propaga, mas não se sustenta enquanto houver aparelho desatualizado. É o
> mesmo mecanismo que ressuscitaria os 247 fantasmas, e é por isso que a
> ETAPA 3 passou a vir antes da ETAPA 1.

---

## Decisões tomadas em 22/08/2026

1. **Uma carga não sai em duas datas, nem se divide em dois veículos.** A
   chave de duplicidade da importação de escala continua sem a data, e o
   número da carga vira **chave natural única** no banco: uma carga, uma
   viagem, ponto. Toda carga repetida é duplicidade, sem exceção.
2. **Volume real: ~400 viagens/mês.** Paginação e janela operacional deixam de
   ser otimização e viram obrigação (ver *Os dois tetos*, logo abaixo).
3. **Ondas 1 e 2 saem num único deploy.** Cada rodada de atualização é o
   momento mais frágil da operação; fazer uma em vez de duas.
4. **Quanto menos ação manual, melhor.** Esta deve ser a **última** vez que
   alguém precisa limpar cache aparelho por aparelho — a auto-atualização
   entra junto no mesmo deploy.
5. **A planilha é a base inicial; o app é a fonte de verdade depois.**
   Motoristas, ajudantes e veículos podem ser incluídos e excluídos pelo app,
   e a exclusão precisa valer. O `restaurarCadastrosDaPlanilha()` deixa de
   existir como rotina.
6. **Levantamento antes de correção.** Sem a foto do estado atual não há como
   provar que a correção funcionou.
7. **Guarda na escrita.** O envio para a nuvem passa a recusar registro cujo
   `data_saida` não seja uma data. Fecha a porta do fantasma na entrada, e não
   depende da ordem das etapas nem de todo mundo ter limpado o cache.
8. **Cache antes da migração.** A limpeza dos aparelhos (ETAPA 3) passa a vir
   **antes** da ETAPA 1 — ver *Ordem de execução*, abaixo.
9. **Ocorrência amarrada à viagem.** `ocorrencias_viagens` ganha `viagem_id`
   apontando para `controle_viagens(id)`. Hoje o vínculo é só cópia de texto.
10. **A tabela `dispositivos` sai da `migration_25`** e passa a rodar sozinha,
    logo depois do deploy. Motivo: é ela que sustenta a tela de Aparelhos, e é
    na ETAPA 3 — que roda **antes** da `migration_25` — que você precisa saber
    qual máquina está em qual versão. Sem isso, a ETAPA 3 volta a ser uma
    caminhada pela empresa, e no celular fica cega (não há console em celular).
    Pode sair da frente sem risco: é `CREATE TABLE IF NOT EXISTS` puro, não
    encosta em `controle_viagens` e não faz faxina nenhuma — nada do motivo
    que empurrou a migração para o fim se aplica a ela.

### Decisões acrescentadas na noite de 22/08

11. **A frota é fechada em 3 aparelhos.** Notebook Tiago, Celular Tiago e PC
    Analista Logística. Isso encerrou a ETAPA 3 na hora — o PASSO E deixou de
    ser um inventário a descobrir e passou a ser uma lista conhecida. O preço
    é que o risco vira **regra + detector** em vez de tarefa: nenhum aparelho
    fora dos 3 abre o app, e a coluna RECUSADOS denuncia se algum abrir.
    Reversível: um aparelho novo entra com um `Ctrl + Shift + R`.
12. **Nenhuma FK nova.** A `migration_25` deveria criar
    `ocorrencias_viagens.viagem_id REFERENCES controle_viagens(id)`
    (decisão 9). **A coluna entrou, a FK não.** Motivo medido no mesmo dia:
    `sinistros` era a única tabela do schema com integridade referencial
    ainda de pé e era a única cuspindo `23503`. A `migration_22` já havia
    derrubado quase todas as FKs porque a sincronização não tem como
    honrá-las — envio por tabela, cache parcial por aparelho, POST
    transacional. Um índice dá o ganho de consulta sem o risco.
13. **A precondição do Reset mudou.** O roteiro exigia "ETAPA 3 100%
    concluída em todos os aparelhos" antes do Reset Global. Essa regra foi
    escrita **antes** da TRAVA DE RESET ([cloudStore.js](js/cloudStore.js),
    em `syncLocalToCloud`), criada em 22/08 às 01:05 depois de a DEV-2026-001
    voltar do túmulo. Com a trava, um aparelho que não aplicou o reset mais
    recente **não tem autoridade para enviar nada** — puxa primeiro, envia
    depois. A precondição real passou a ser "todos numa build ≥ 4.8.0", e não
    "todos na build mais nova". Foi o que permitiu resetar sem o PC Analista.

---

## Ordem de execução — revisada em 22/08/2026

A ordem mudou por causa de um achado da ETAPA 0: os 247 registros fantasmas
têm `id` estável, gerado no aparelho, e o envio usa
`Prefer: resolution=merge-duplicates`. Traduzindo: **se a migração limpar o
banco enquanto algum aparelho ainda tiver esses registros no cache, o primeiro
sync devolve tudo** — inclusive desfazendo o `is_deleted`.

| Ordem | Etapa | Por quê nesta posição | Situação |
|---|---|---|---|
| 1º | **ETAPA 2** — deploy (Ondas 1+2, com a guarda na escrita) | A guarda precisa estar de pé antes de qualquer limpeza | ✅ 22/08 |
| 2º | **ETAPA 2b** — SQL avulso da tabela `dispositivos` | Decisão 10: sem ela a tela de Aparelhos fica vazia justamente na ETAPA 3 | ✅ 22/08 (+ `25b`) |
| 3º | **ETAPA 3** — limpeza de cache dos aparelhos | Esvazia a fonte do fantasma antes de limpar o destino | ✅ 22/08 (decisão 11) |
| — | **`migration_26`** — colunas faltantes | Não estava no plano. Quatro tabelas nunca sincronizaram; descobertas só quando o erro deixou de ser silencioso | ✅ 22/08 |
| 4º | **ETAPA 1** — `migration_25` | Só agora a limpeza do banco é definitiva | ✅ 22/08 |
| 5º | **ETAPA 4** — cadastros mestre | Vira conferência: a 4.8.0 semeia uma vez só | ✅ 22/08 |
| 6º | **ETAPA 5** — Reset Global | Deixou de ser opcional: a operação **não** tinha começado, e não se implanta com base suja | ✅ 22/08, 20:41 |
| 7º | **ETAPA 6** — teste de aceite | — | ⬜ **pendente** |

A numeração das etapas foi mantida para não invalidar as referências já
combinadas. **O que mudou é a ordem de execução, não o nome delas.**

> **A ETAPA 5 quase foi pulada por engano.** O roteiro dizia "se a operação
> já está valendo, pule esta etapa", e o plano de execução chegou a
> recomendar isso. Estava errado: a operação **não** havia começado
> (`dataInicioProducao: "2026-08-26"` em [js/config.js](js/config.js)), e a
> base era inteiramente de treinamento. Resetar era o certo — e resolveu de
> quebra o que a `migration_25` só conseguia marcar como `is_deleted`.

---

## Rodada da noite de 22/08 — as quatro tabelas que nunca sincronizaram

Não estava no plano. Apareceu porque a correção de 21/08 tornou a falha de
escrita **visível**: o `jrDiagnosticoSync()` do primeiro PC na 4.8.0 devolveu
quatro tabelas em `tabelasComPendencia`, com dado gravado só no aparelho.

| Tabela | Código | Causa real |
|---|---|---|
| `ocorrencias_rota` | `23514` | O app gravava em `tipo_ocorrencia` o vocabulário do dropdown **Motivo Resumido** |
| `ocorrencias_viagens` | `PGRST204` | Coluna `status` não existia no banco |
| `itens_devolucao` | `PGRST204` | Coluna `data_validade` não existia (e mais quatro atrás dela) |
| `sinistros` | `23503` | **Consequência da primeira** — apontava para uma ocorrência que a nuvem não tinha |

### O achado que mais dói

O `CHECK` de `ocorrencias_rota` aceita `''`, `MECANICA`, `OPERACIONAL`,
`CONDUTA_INADEQUADA`, `ACIDENTE`. A tela gravava ali `AVARIA MECÂNICA`,
`ATRASO DE LARGADA`, `CHECKLIST`, `FALTA`, `SUBSTITUIÇÃO DE EQUIPE`,
`CONDUTA OPERACIONAL` ou `OUTRO`. **Interseção: zero.**

Ou seja: **nenhuma ocorrência de rota criada pela tela jamais chegou ao
banco**, desde sempre. Bate com o cabeçalho da `migration_22`, que já
registrava `ocorrencias_rota=0` em 21/08 e atribuiu o zero a FK e NOT NULL.
Aquelas duas causas eram reais, mas havia uma terceira embaixo.

É a **mesma doença dos 247 fantasmas**: dois vocabulários na mesma coluna, um
deles gravado por engano. Por isso o conserto não foi alargar o `CHECK` — foi
normalizar na escrita, em `_tipoOcorrenciaDoMotivo()`
([store.js](js/store.js)), na store e não na tela, para cobrir também
qualquer tela futura. `motivo_resumido` guarda o texto original, que é o que
a interface toda já lia.

### O método importou mais que os consertos

Consertar coluna a coluna era um ciclo infinito: `PGRST204` só reporta **uma
por vez**, e um registro ruim derruba o lote inteiro (o POST do PostgREST é
transacional). Duas tentativas de levantamento falharam antes de acertar, e as
duas falharam do mesmo jeito — **transformando falha de leitura em afirmação
confiante**, que é o defeito-assinatura deste projeto:

- A primeira leu o OpenAPI do PostgREST e fazia `spec.definitions || {}`.
  Formato inesperado → concluiu que **as 25 tabelas não existiam**.
- A segunda leu as chaves `jr_*` do localStorage. Mas o envio lê `jr_sac_db`
  **primeiro**, e só cai nessas chaves como último recurso — leu a cópia
  desatualizada e reportou tabelas vazias que estavam falhando ao enviar.

O que funcionou: `information_schema` no SQL Editor (que não tem como mentir
assim — ou devolve linhas, ou dá erro na tela) cruzado com as chaves de
`jr_sac_db`, na mesma ordem de precedência do envio. **Resultado: só 4 colunas
faltavam no sistema inteiro**, não uma cauda infinita.

### A armadilha que teria sido a próxima

`itens_devolucao.valor_total` é `GENERATED ALWAYS AS (quantidade *
valor_unitario) STORED`, e o app manda esse campo no POST. Postgres recusa
escrita em coluna gerada (`428C9`). Isso **ainda não tinha aparecido** porque
o `PGRST204` de `data_validade` barra antes, no cache de schema do PostgREST —
o erro nem chegava ao banco. Sem o item 26.3, a tabela destravaria e voltaria
a travar no ciclo seguinte, com um erro novo.

### Duas cópias locais que divergem

Achado colateral, e vale registrar porque explica horas de confusão: cada
coleção existe **duas vezes** no navegador — dentro de `jr_sac_db` e numa
chave `jr_*` própria. O envio prefere `jr_sac_db`
([cloudStore.js](js/cloudStore.js), em `syncLocalToCloud`); o pull escreve nas
duas; mas nem todo caminho de gravação do app faz o mesmo. Enquanto isso for
verdade, **qualquer diagnóstico precisa ler as duas na ordem certa**.

### Outros consertos que entraram junto

- **Dois `Date.now()` crus.** `addDevolucao()` e `addOcorrenciaRota()`
  geravam `id` sem passar pelo `gerarIdUnico()` — a centralização de 20/08
  cobriu 15 pontos e deixou estes dois. Com `merge-duplicates`, dois
  aparelhos criando um registro no mesmo milissegundo faziam um sobrescrever
  o outro **sem erro nenhum**. É o item 9 da Onda 2, que passou perto sem
  cobrir.
- **`data_validade` grava `null` em vez de `''`.** É por isso que a coluna
  nasceu `VARCHAR` e não `DATE`: para `AVARIA_DESCARTE` e `RENEGOCIADO_ROTA`
  a tela dispensa a data. Dívida registrada: quando não houver mais `''` em
  cache de nenhum aparelho, dá para apertar para `DATE`.
- **Dois furos no Reset Global.** `jr_ocorrencias_viagens` e
  `jr_itens_devolucao` não estavam em `chavesLimpeza`.

---

## O detector de recontaminação — e por que ele estava cego

A coluna RECUSADOS da tela de Aparelhos passou por duas correções no mesmo
dia, e as duas valem registro porque o padrão se repete.

**Primeira leitura, errada:** "o aparelho que marca 247 é a origem dos
fantasmas". Não é. A contagem varre o cache local, e o pull grava as linhas da
**nuvem** nesse mesmo cache — então todo aparelho sincronizado mostra o mesmo
número. O número bater com a ETAPA 0 não era impressão digital; era a mesma
linha contada de dois lugares.

**Segunda, também errada:** o roteiro afirmava que, depois da `migration_25`,
o contador zeraria sozinho. Não zerou. `getAll()` faz `select=*` sem filtrar
`is_deleted`, então as 247 linhas expurgadas continuavam descendo no pull, e
`_auditarCacheLocal()` as contava porque olhava só `data_saida`. Corrigido na
4.8.2: a auditoria ignora `is_deleted`.

**O que a coluna significa agora, e é o que sempre se quis:** fantasma
**vivo** chegou ao cache deste aparelho. Zero é o esperado. Qualquer número
acima de zero é recontaminação, e só um aparelho fora da 4.8.0 consegue
causar isso.

A tarja da tela também mentia, e foi reescrita para distinguir dois casos que
pedem ações **opostas**:

- **Todos os aparelhos com o mesmo número** → os registros estão no **banco**.
  Limpar cache não resolve (o pull baixa de volta em 30s). É a ETAPA 1.
- **Números que não batem entre si** → o que destoa está reenviando cache
  antigo. É a ETAPA 3, naquele aparelho.

---

## Os dois tetos técnicos

O motivo de a ETAPA 0 vir antes de tudo. Nenhum dos dois dá aviso quando é
atingido — os dois falham em silêncio.

### Teto 1 — 1.000 linhas por leitura

A leitura da nuvem (`cloudStore.getAll`) monta `select=*` **sem `limit` e sem
header `Range`**. O padrão do PostgREST/Supabase corta a resposta em 1.000
linhas.

Quando `controle_viagens` passar disso, o aparelho baixa só as primeiras 1.000,
o cache local é truncado — e o envio seguinte devolve a lista truncada para a
nuvem. **A 400 viagens/mês, isso acontece em cerca de 2 meses e meio de
operação.**

### Teto 2 — cota do navegador

Medido no repositório: o catálogo estático (`jr_sac_static`, com 15.139
clientes e 4.010 produtos) ocupa **2,9 MB**. A cota conservadora de um
navegador mobile é de ~5 MB. Sobram **~2 MB** para todo o resto.

Uma viagem ocupa ~505 bytes em JSON. A 400 por mês: **~197 KB/mês, ~2,3 MB por
ano** — só de viagens, sem contar as fotos das devoluções, que são gravadas em
base64.

Quando a cota estoura, `store.save()` retorna `false` e escreve no console.
**Ninguém abre o console.** O operador continua trabalhando achando que salvou.

---

## ETAPA 0 — Levantamento — **EXECUTADA EM 22/08/2026**

> Os PASSOS A a D foram executados e os resultados estão logo abaixo.
> O **PASSO E** (inventário de aparelhos) só terá como ser feito no dia do
> go-live, com as pessoas presentes — decidido em 22/08.
> As instruções originais dos passos ficam preservadas mais adiante, como
> referência de como refazer a medição.

### Resultado — o que o banco tinha em 22/08/2026

**Contagem (PASSO B):** 331 linhas em `controle_viagens`, 3 excluídas. Os
cadastros mestre vieram 89 veículos e 38 ajudantes (batendo com a planilha) e
**41 motoristas** — 2 a mais que os 39 esperados, anotados para a ETAPA 4.
`cargas` e `ocorrencias_viagens` têm **1 linha cada**.

**A base real é muito menor do que parece.** Das 331 linhas:

| Categoria | Linhas | Como identificar |
|---|---|---|
| **Fantasmas** | **247** | `data_saida IN ('INICIADO','NÃO INICIADO')` |
| Duplicatas de importação | 44 excedentes | 15 cargas repetidas ~4× |
| **Viagens reais e únicas** | **~39** | o que sobra |

#### A impressão digital do fantasma

O achado que mais serve para o resto do trabalho. Os 247 registros fantasmas
guardam **um estado de checklist no campo de data de saída**:

| Forma | `data_saida` | `status_viagem` | Linhas |
|---|---|---|---|
| A — real | data de verdade | vazio | 83 |
| B — fantasma | `INICIADO` / `NÃO INICIADO` | `FIN. NORMAL` | 247 |
| — | `2026-08-19` (ISO) | `EM ANDAMENTO` | 1 |

Os dois vocabulários **nunca se misturaram** em 331 registros. Isso é
assinatura de **duas versões do app** gravando com mapeamentos de coluna
diferentes na mesma tabela — e dá um teste determinístico, sem chute, tanto
para a faxina quanto para a guarda na escrita da decisão 7.

Serve também de **detector permanente**: depois do deploy, se essa contagem
subir, o fantasma voltou.

#### O fantasma entrou de uma vez só

Os 247 têm `criado_em` **idêntico**: `2026-08-20 13:37:38.322192`. Uma
transação, um envio — **um aparelho despejando o cache local inteiro**. As
linhas PALMAS têm `id` de 17/08, ou seja, aquele aparelho vinha acumulando
registro havia pelo menos três dias antes de descarregar tudo junto.

> ⚠️ **Isso não prova que parou.** `criado_em` só é gravado no INSERT, e o
> envio reenvia a tabela inteira a cada ciclo com `merge-duplicates`. Se
> aquele aparelho ainda tiver os 247 no cache, ele os reenvia agora mesmo, a
> cada 30 segundos, sobrescrevendo as linhas sem mexer no `criado_em`.
> **Verificação pendente** (ver no fim desta seção).

#### A duplicação continua ativa

Os `criado_em` datam quatro rodadas da importação da escala:

| # | Quando | O que entrou |
|---|---|---|
| 1 | 20/08 13:24:08 | 15 cargas reais |
| — | **20/08 13:37:38** | **despejo dos 247 fantasmas** |
| 2 | 20/08 13:59:21 | as mesmas 15, de novo |
| 3 | 20/08 16:10:56 | de novo |
| 4 | **22/08 01:18:15** | de novo — **depois do go-live de 21/08** |

A checagem de duplicidade da importação não está pegando, e o go-live de 21/08
não tocou nesse mecanismo.

#### As PALMAS eram fantasma, não transbordo legítimo

Os 5 pares `PALMAS xx/07` são Forma B e saem junto com os 247. **A decisão 1
fica como está** — carga é chave natural única, sem exceção — e a revisão
manual de placa que se cogitou para esses 5 casos **não é mais necessária**.

#### Estrutura

- **`id` é PRIMARY KEY** e é o `Date.now()` do aparelho. Serve de cursor de
  paginação — nunca nulo, sem empate. Muda o plano do Teto 1 (era `criado_em`).
- **`criado_em` tem 24 linhas nulas**, todas reais. Por isso ele **não** pode
  sustentar a paginação; precisa ser consertado para a janela operacional.
- **Nenhum índice único** além da PK. O que a `migration_25` vai criar sobre
  `carga` entra sem conflito.
- **Nenhuma FK.** `ocorrencias_viagens` não referencia a viagem — só copia
  `carga`, `rota` e `placa`. Daí a decisão 9.
- **O caminho de edição grava data em ISO**, o de importação em `dd/mm/aaaa`.
  Uma única linha editada provou isso. `data_saida` é `VARCHAR(20)`, então o
  banco aceita qualquer coisa calado.

#### Verificação executada — 22/08/2026

**O aparelho da contaminação ainda está enviando?** Teste feito: a linha
fantasma `PALMAS 02/07 / RSE9G63` foi marcada como `is_deleted = true`
direto no banco. Dez minutos depois, **continuava `true`** — nenhum aparelho
a desfez. (A linha ficou marcada de propósito; é fantasma e sai na
`migration_25` de qualquer forma.)

**O que isso prova:** nenhum aparelho *que estava online naquela janela*
reenviou a linha com cache antigo. Com o ciclo de 30s, foram ~20 oportunidades
de sobrescrever, e nenhuma aconteceu.

**Quem estava ligado durante os dez minutos (perguntado e respondido em
22/08):** os **PCs, provavelmente sim**, com o app aberto. Os **celulares,
não**. Ou seja: o teste mediu os PCs. É só sobre eles que o resultado fala.

**O que isso não prova:** nada sobre os celulares, e nada sobre qualquer
aparelho desligado ou com o app fechado. E como a presença dos PCs é
"provavelmente", nem para eles isso vira certeza — ninguém foi conferido um a
um. Essa conferência é o PASSO E, e acontece na ETAPA 3.

**Explicação provável de ter segurado:** a correção de 21/08 fez o sync
**puxar antes de empurrar**. O aparelho baixa `is_deleted = true` para o cache
e depois envia o estado já corrigido, em vez de sobrescrever com o velho.
Todo aparelho que sincronizou desde 21/08 está protegido por isso.

**Risco residual, e é ele que a ETAPA 3 endereça:** um aparelho que não abre o
app desde 20/08 ainda tem o cache original, nunca puxou correção nenhuma, e
vai despejar tudo na primeira vez que for aberto. **Os celulares entram inteiros
nessa conta** — nenhum deles estava aberto durante o teste, então nenhum deles
foi medido. É o perfil do que causou a
4ª rodada de duplicação às 01:18 de 22/08 — algum aparelho acordou.

**Efeito no plano:** a ETAPA 3 deixa de ser emergência, mas continua
obrigatória. A guarda na escrita (Onda 1, item 7) segue sendo o que torna a
limpeza definitiva, e a ordem invertida continua correta.

---

### Instruções originais dos passos (referência)

**O que é:** tirar uma foto do estado de hoje, antes de mexer em qualquer
coisa. É o "antes" que vai provar se a correção funcionou — e é o que decide o
tamanho do estrago que já existe no banco.

**Você vai precisar de:** o login do Supabase e um PC. Não precisa saber SQL:
é copiar, colar e apertar um botão.

> ⚠️ **Nada aqui altera dado.** Todas as consultas começam com `SELECT`, que
> em banco de dados significa "só me mostre". Não tem como quebrar nada
> seguindo estes passos.

---

### PASSO A — Abrir a tela onde as consultas rodam (faz uma vez só)

1. Abra <https://supabase.com> e faça login.
2. Na lista de projetos, clique no projeto **`qxipgnkdbzxtfvuyupow`**.
3. No menu da **esquerda**, procure o ícone do **SQL Editor** (parece uma
   folha de papel com `SQL` escrito). Clique nele.
4. Clique no botão **`+ New query`**, no alto.
5. Vai abrir uma **caixa de texto grande e vazia**. É aí que você cola as
   consultas.

**Como rodar uma consulta, sempre igual:**

- Cole o texto na caixa
- Aperte o botão verde **`Run`** (ou `Ctrl + Enter`)
- O resultado aparece **embaixo**, em forma de tabela
- Para a próxima: **apague tudo** da caixa e cole a próxima consulta

> Se aparecer uma tarja **vermelha** com erro, **não tente adivinhar o que
> fazer**. Copie a mensagem inteira e me mande.

---

### PASSO B — Consulta 1: quanto tem de cada coisa

Cole isto na caixa e aperte **Run**:

```sql
SELECT 'controle_viagens'    AS tabela, count(*) AS linhas, count(*) FILTER (WHERE is_deleted) AS excluidas FROM controle_viagens
UNION ALL SELECT 'ocorrencias_viagens', count(*), count(*) FILTER (WHERE is_deleted) FROM ocorrencias_viagens
UNION ALL SELECT 'cargas',              count(*), count(*) FILTER (WHERE is_deleted) FROM cargas
UNION ALL SELECT 'retencoes_frota',     count(*), count(*) FILTER (WHERE is_deleted) FROM retencoes_frota
UNION ALL SELECT 'trocas_veiculos',     count(*), count(*) FILTER (WHERE is_deleted) FROM trocas_veiculos
UNION ALL SELECT 'veiculos',            count(*), count(*) FILTER (WHERE is_deleted) FROM veiculos
UNION ALL SELECT 'motoristas',          count(*), count(*) FILTER (WHERE is_deleted) FROM motoristas
UNION ALL SELECT 'ajudantes',           count(*), count(*) FILTER (WHERE is_deleted) FROM ajudantes
ORDER BY linhas DESC;
```

Vai aparecer uma tabela com 8 linhas, três colunas: `tabela`, `linhas`,
`excluidas`. **Tire um print ou copie tudo.**

**Duas coisas para olhar agora:**

**1. A linha `controle_viagens`, coluna `linhas`:**

| Se aparecer | O que significa | O que fazer |
|---|---|---|
| Menos de **900** | Ainda há folga até o Teto 1 | Siga para o PASSO C |
| **900 ou mais** | O teto de 1.000 linhas está chegando ou já chegou | **Pare e me avise.** A ordem das correções muda |

**2. As linhas `motoristas`, `ajudantes` e `veiculos`:**

O esperado, se ninguém mexeu, é **39, 38 e 89** — os números da planilha
*Dados SAC*.

- Número **maior** → alguém cadastrou pelo app (vamos preservar na ETAPA 4),
  ou há registro duplicado com id diferente.
- Número **menor** → alguém excluiu e a exclusão ainda não foi desfeita pelo
  ciclo de reposição. Anote quais.

De qualquer forma, **só anote**. Não precisa fazer nada com esses números
agora.

---

### PASSO C — Consulta 2: cargas lançadas mais de uma vez

Apague tudo da caixa, cole isto e aperte **Run**.

Como uma carga não sai em duas datas nem em dois veículos, **toda carga que
aparecer aqui é duplicidade** — seja de importação feita em dois aparelhos,
seja de colisão de id entre máquinas.

```sql
SELECT carga,
       count(*)                   AS vezes,
       count(DISTINCT data_saida) AS datas_distintas,
       count(DISTINCT placa)      AS placas_distintas,
       string_agg(DISTINCT data_saida, ' | ') AS datas,
       string_agg(DISTINCT placa, ' | ')      AS placas
  FROM controle_viagens
 WHERE is_deleted IS NOT TRUE
   AND coalesce(carga,'') <> ''
 GROUP BY carga
HAVING count(*) > 1
 ORDER BY vezes DESC, carga;
```

**Como ler o resultado:**

- Se aparecer **`Success. No rows returned`** → ótimo, **nenhuma carga
  duplicada**. Anote isso e siga.
- Se aparecer **linhas** → cada linha é uma carga lançada mais de uma vez.
  **Copie a tabela inteira.** A coluna `vezes` diz quantas vezes, e as colunas
  `datas` e `placas` mostram o que cada cópia registrou.

Não apague nada. A limpeza é feita na ETAPA 1, de forma controlada e
reversível (as duplicatas vão para a Lixeira, não são destruídas).

---

### PASSO D — Só se o PASSO B mostrou 900 viagens ou mais

**Se `controle_viagens` tem menos de 900 linhas, pule este passo.** O teto de
1.000 ainda não é problema hoje.

Se tem 900 ou mais, precisamos saber se a leitura da nuvem já está sendo
cortada. Num PC:

1. Abra o app JR Oper no navegador
2. Aperte **`F12`** — abre um painel lateral ou inferior
3. Clique na aba **`Console`**
4. Clique na linha vazia ao lado do sinal `>`
5. **Se o Chrome pedir**, digite `allow pasting` e aperte Enter (ele bloqueia
   colagem no console na primeira vez, por segurança). Depois disso, cole:

```
cloudStore.getAll('controle_viagens').then(r => console.log('a API devolveu', r.length, 'linhas'))
```

6. Aperte Enter. Vai responder algo como `a API devolveu 1000 linhas`

**Compare com o número da consulta do PASSO B.** Se a API devolver **menos**
que o SQL, o Teto 1 já está ativo e há dado sendo perdido agora — me avise
imediatamente.

---

### PASSO E — Lista de aparelhos

**Primeiro, só escreva a lista.** Todo aparelho que abre o JR Oper: PC da
largada, PC do monitoramento, PC da manutenção, o seu PC, celulares dos
supervisores, tablet da portaria. Sem esquecer nenhum — um aparelho esquecido
é justamente o que contamina o banco dos outros.

| Aparelho | Quem usa | Tipo | Versão (`buildSync`) |
|---|---|---|---|
| | | PC / celular | |

**Nos PCs**, dá para ler a versão:

1. Abra o app, aperte **`F12`**, clique na aba **`Console`**
2. Se o Chrome pedir, digite `allow pasting` e Enter
3. Cole `jrDiagnosticoSync()` e aperte Enter
4. Anote o valor de **`buildSync`** e de **`tabelasComPendencia`**

**Nos celulares, não dá.** Não é falta de jeito: **a versão não aparece em
nenhuma tela do app** — só existe no console, e celular não tem console
acessível. Então, para os celulares:

- **Não tente medir.** Só liste quais são e de quem são.
- Todos eles vão ser atualizados na ETAPA 3 de qualquer forma, e o
  procedimento é o mesmo esteja o aparelho velho ou novo.

> **Respondendo à sua pergunta "como saber qual máquina está em qual
> versão":** hoje, **não dá** — nem remotamente, nem em celular. O `buildSync`
> só existe dentro do console do navegador, e nada é publicado na nuvem.
>
> Isso é falha de instrumentação, não limitação aceitável. É exatamente o que
> as correções 10 e 11 da ETAPA 2 resolvem: o aparelho passa a publicar a
> própria versão na nuvem, e você vê todos numa tela. **Esta é a última vez
> que este levantamento precisa ser feito na mão.**

**O que procurar nos PCs:** qualquer `buildSync` diferente de **`sync-4.7.9`**,
ou a função respondendo `is not defined`. Esse PC está rodando código antigo —
e, por causa do `restaurarCadastrosDaPlanilha()`, ele **reinjeta a lista de
cadastros da versão antiga dele na nuvem a cada 30 segundos**, para todo mundo.
É o candidato número um a ser a "máquina com importação antiga".

---

### O que me mandar no fim da ETAPA 0

Um único bloco de texto (ou prints) com:

1. A tabela inteira do **PASSO B** — as 8 linhas de contagem
2. O resultado do **PASSO C** — as cargas duplicadas, ou "no rows returned"
3. O número do **PASSO D**, se você precisou fazê-lo
4. A tabela de aparelhos do **PASSO E**, com a versão dos PCs

Com isso eu fecho o escopo das Ondas 1+2 em nível de arquivo e linha, e escrevo
a `migration_25` com a limpeza das duplicatas dimensionada pelo número real.

---

## ETAPA 1 — `migration_25` (banco) — **EXECUTADA EM 22/08/2026**

> **Resultado.** O SQL está em
> [database/migration_25_faxina_e_chave_natural.sql](database/migration_25_faxina_e_chave_natural.sql).
> Conferência depois de rodar: `chave_natural 1`, `coluna_viagem_id 1`,
> `coluna_atualizado_em 1`, `criado_em_nulos 0`, `fantasmas_restantes 0`,
> `cargas_duplicadas 0`, **`viagens_vivas 38`**.
>
> As 343 vivas caíram para 38. A ETAPA 0 estimara "~39" por subtração, não
> por contagem — um registro de diferença é a margem daquela estimativa.
>
> **Duas diferenças em relação ao que está escrito abaixo:**
> 1. O banco tinha crescido de 331 para ~346 linhas desde a ETAPA 0: uma
>    **quinta** rodada de importação duplicada. O item 2 agrupa por `carga` e
>    mantém a de menor `id`, então lida com 4 ou 40 rodadas igual — mas as
>    "44 duplicatas" do texto abaixo eram o número de 22/08 de manhã.
> 2. O item 7 (`viagem_id`) entrou **sem a FK** — ver decisão 12.
>
> Os registros marcados aqui foram **apagados fisicamente** algumas horas
> depois, no Reset Global da ETAPA 5.

> **Executar por último**, depois das ETAPAS 2 e 3 — ver *Ordem de execução*.
> A ETAPA 0 já dimensionou a limpeza: 247 fantasmas e 44 duplicatas. Criar a
> chave única (item 3) com duplicatas ainda no banco faz a migração falhar,
> e limpar o banco antes de esvaziar o cache dos aparelhos é trabalho
> desfeito no primeiro sync.

O que a migração vai fazer, na ordem:

1. **Expurgar os 247 fantasmas**, pela impressão digital da ETAPA 0:
   `data_saida IN ('INICIADO','NÃO INICIADO')`. Marcados como `is_deleted`,
   com registro de quem e por quê. Nada é apagado fisicamente.
2. **Limpar as 44 duplicatas de importação** — 15 cargas repetidas até 4× —
   mantendo a linha de menor `id` de cada grupo (a lançada primeiro) e
   marcando as demais como `is_deleted`. Como as cópias são idênticas em data
   e placa, não há escolha a fazer: **nenhuma revisão manual é necessária**.
3. **Criar a chave natural** em `controle_viagens` — **decidido em 22/08**:
   índice único **parcial** sobre `carga`, ignorando as excluídas e as em
   branco:

   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uq_controle_viagens_carga
       ON controle_viagens (carga)
    WHERE is_deleted IS NOT TRUE AND coalesce(carga,'') <> '';
   ```

   **Parcial de propósito**, e pelo mesmo motivo da migração 24: em Postgres,
   várias strings **vazias** não convivem numa coluna única (vários `NULL`
   convivem, string vazia não). Um `UNIQUE` simples derrubaria o lote inteiro
   na primeira viagem sem número de carga. E ignorar as excluídas é o que
   permite excluir uma viagem lançada errada e reimportar a carga certa.

   É essa constraint que passa a barrar a duplicidade **no banco**, em vez de
   depender de uma checagem em JavaScript que só enxerga o cache do próprio
   aparelho.
4. **Coluna `atualizado_em`** (`TIMESTAMPTZ`) nas tabelas transacionais que
   ainda não têm, com índice. É o que permite a mesclagem por registro da
   ETAPA 2 e, mais adiante, a sincronização incremental.
5. ~~**Tabela `dispositivos`**~~ — **saiu daqui em 22/08 (decisão 10).**
   Virou a ETAPA 2b, logo depois do deploy, porque a tela que ela sustenta é
   usada na ETAPA 3 — que roda antes desta migração. O conteúdo é o mesmo: id
   do aparelho, apelido, build, última vez visto, último usuário, e agora
   também a contagem de registros recusados pela guarda na escrita.
6. **Conserto do `criado_em`** — `DEFAULT now()`, `NOT NULL`, e preenchimento
   das 24 linhas nulas a partir do próprio `id`. É o que dá à janela
   operacional da ETAPA 2 um tempo confiável.

   > ⚠️ **Correção de 22/08 — a fórmula que estava aqui estava errada.** Este
   > item dizia `to_timestamp(id / 1000.0)`, "porque o `id` é o `Date.now()`
   > do aparelho". Isso vale só para os ids gerados **até 20/08/2026**. De lá
   > para cá, `gerarIdUnico()` ([store.js](js/store.js)) devolve
   > `Date.now() * 1000 + carimbo` — mil vezes maior. Aplicar `id/1000` num id
   > desses dá um carimbo no **ano 57000**, e a linha nunca mais sairia de
   > nenhuma janela de tempo. Os dois formatos convivem na mesma coluna e se
   > distinguem pela ordem de grandeza (~1,7e12 contra ~1,7e15):
   >
   > ```sql
   > UPDATE controle_viagens
   >    SET criado_em = to_timestamp(
   >          CASE WHEN id > 1e14 THEN id / 1000000.0   -- gerarIdUnico(): ms * 1000
   >               ELSE id / 1000.0                     -- Date.now() puro
   >          END)
   >  WHERE criado_em IS NULL;
   > ```
   >
   > O código da janela operacional (item 5 da Onda 1) já trata os dois
   > formatos — ver `_momentoDoRegistro` em [cloudStore.js](js/cloudStore.js).
7. **`viagem_id` em `ocorrencias_viagens`** (decisão 9) — `BIGINT REFERENCES
   controle_viagens(id)`, preenchido pelo `carga` das linhas existentes (hoje
   é 1 registro só, o backfill é trivial).

   FK sobre `carga` **não é possível**: o Postgres exige índice único
   não-parcial para sustentar chave estrangeira, e o nosso é parcial de
   propósito (item 3). Por isso a referência é à chave primária.
8. **Índices de apoio:** `controle_viagens(criado_em)` e
   `ocorrencias_viagens(criado_em)`, para a janela operacional da ETAPA 2.

   **Não** indexar `data_saida`: a ETAPA 0 mostrou que ela guarda estado de
   checklist em 75% das linhas e, no resto, data em dois formatos. Índice ali
   não serve para janela nenhuma enquanto o campo não for normalizado.

Idempotente (`IF NOT EXISTS` / `ON CONFLICT`), no mesmo padrão das 22–24.

**Conferência obrigatória depois de rodar**, no mesmo SQL Editor:

```sql
SELECT
  (SELECT count(*) FROM pg_indexes
    WHERE tablename='controle_viagens'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%carga%')                                       AS chave_natural,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='controle_viagens' AND column_name='atualizado_em') AS coluna_atualizado_em,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name='dispositivos')                                     AS tabela_dispositivos,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='ocorrencias_viagens'
      AND column_name='viagem_id')                                       AS coluna_viagem_id,
  (SELECT count(*) FROM controle_viagens WHERE criado_em IS NULL)        AS criado_em_nulos,
  (SELECT count(*) FROM controle_viagens
    WHERE is_deleted IS NOT TRUE
      AND data_saida IN ('INICIADO','NÃO INICIADO'))                     AS fantasmas_restantes;
```

**Esperado: `1`, `1`, `1`, `1`, `0`, `0`.**

Os quatro primeiros são estrutura — qualquer zero significa que a migração não
completou; leia a mensagem de erro antes de seguir. Os dois últimos são dado:
`criado_em_nulos` maior que zero significa que o conserto do item 6 não pegou,
e `fantasmas_restantes` maior que zero significa que **algum aparelho está
reenviando o cache contaminado** — pare e volte para a ETAPA 3 antes de
liberar a operação.

---

## ETAPA 2 — Deploy único (Ondas 1 + 2) — **EXECUTADA EM 22/08/2026**

> **Foram três deploys, não um.** A decisão 3 (um deploy só) valeu para as
> Ondas 1+2. Os dois seguintes saíram de defeitos que só apareceram **porque**
> o primeiro tornou a falha visível:
>
> | Build | O que entrou |
> |---|---|
> | `sync-4.8.0` | Ondas 1+2, os 12 itens |
> | `sync-4.8.1` | Normalização de `tipo_ocorrencia`, `data_validade` como `null`, os dois `Date.now()` crus |
> | `sync-4.8.2` | Auditoria ignorando `is_deleted`, tarja de RECUSADOS reescrita, `jrErrosSync()` + painel "Diagnóstico deste aparelho", dois furos no Reset Global |
>
> A auto-atualização (item 11) levou os três aparelhos de uma build à outra
> **sem ninguém limpar cache**, incluindo o Android. Na prática, o **T6 da
> ETAPA 6 passou três vezes** antes de ser formalmente executado.
>
> As três versões precisam bater em [version.json](version.json),
> `CloudStore.BUILD` e [sw.js](sw.js) a cada deploy — hoje em `4.8.2`.

> **Executar primeiro** — ver *Ordem de execução*. Deixou de depender da
> ETAPA 1: a guarda na escrita (item 7) precisa estar de pé **antes** de
> qualquer limpeza, senão a limpeza é desfeita pelo primeiro sync de um
> aparelho com cache velho. Um único deploy, conforme a decisão 3.

### Onda 1 — parar a perda de dado

| # | Correção | Problema que resolve |
|---|---|---|
| 1 | **Envio só do que mudou** — cada registro alterado é marcado, e só ele sobe | Hoje **toda** gravação, em **qualquer** tela, reenvia as 25 tabelas inteiras a partir do cache local. É por isso que a edição de um aparelho apaga a do outro sem aviso |
| 2 | **Mesclagem por registro**, usando `atualizado_em` | A leitura hoje substitui a coleção inteira. Passa a comparar linha a linha: vence a versão mais nova, não o último a gravar |
| 3 | **Exclusão durável** — a flag `is_deleted` deixa de poder ser sobrescrita para trás por um aparelho com cache velho | **Escopo reduzido em 22/08:** a propagação já funciona desde 20/08, e a ETAPA 0 confirmou 3 exclusões vivas na nuvem. O que falta não é propagar, é impedir que o `merge-duplicates` desfaça. Segue valendo que esvaziar a Lixeira não apaga fisicamente — existe **um** `DELETE` no sistema inteiro, e ele só roda no Reset Global |
| 4 | **Paginação na leitura, com cursor em `id`** — `ORDER BY id` + `id > último_lido`, em blocos, até vir um bloco incompleto | Teto 1. `id` é PK, nunca nulo e sem empate; `criado_em` **não** serve, tem 24 linhas nulas (ETAPA 0) |
| 5 | **Janela operacional** — viagens e ocorrências dos últimos N dias ficam no aparelho; o histórico completo fica na nuvem e no Power BI | Teto 2. Usa `criado_em`, depois do conserto do item 6 da ETAPA 1 |
| 6 | **Alarme de cota visível** — gravação que falha precisa aparecer na tela | Hoje falha em silêncio |
| 7 | **Guarda na escrita** (decisão 7) — o envio recusa registro cujo `data_saida` não seja data, usando a impressão digital da ETAPA 0 | Impede o fantasma de voltar mesmo que sobre algum aparelho com cache velho. É o que torna a limpeza do banco definitiva |

**Andamento (22/08/2026): os 12 itens das Ondas 1+2 estão implementados.
Nada foi publicado ainda** — o deploy é o passo seguinte, e continua sendo um
só, conforme a decisão 3. A versão passa a ser `sync-4.8.0`.

| # | Onde ficou | Em uma linha |
|---|---|---|
| 1 | [cloudStore.js](js/cloudStore.js) `_separarOQueMudou` | Sobe só o registro que mudou aqui, não as 25 tabelas |
| 2 | [cloudStore.js](js/cloudStore.js) `_mesclarPorRegistro` | A leitura decide registro a registro, não coleção inteira |
| 3 | mesma mesclagem | Registro não mexido aqui nunca sobrescreve a nuvem — nem para desfazer exclusão |
| 4 | [cloudStore.js](js/cloudStore.js) `getAll` | Leitura em blocos de 500 com cursor em `id` |
| 5 | [cloudStore.js](js/cloudStore.js) `_aplicarJanelaOperacional` | 90 dias de viagens/ocorrências no aparelho; o resto na nuvem |
| 6 | [store.js](js/store.js) `_alertarFalhaDeGravacao` | Gravação que falha vira tarja vermelha e alerta, não silêncio |
| 7 | [cloudStore.js](js/cloudStore.js) `_aplicarGuardaDeEscrita` | Recusa viagem cuja `data_saida` não é data |
| 8 | [store.js](js/store.js) init + pull | `restaurarCadastrosDaPlanilha()` sai do ciclo; semeia uma vez só |
| 9 | [store.js](js/store.js) `gerarIdUnico` | Carimbo fixo do aparelho nos 3 últimos dígitos do id |
| 10 | [store.js](js/store.js) `importViagens` | Duplicidade por **carga**, ignorando as excluídas |
| 11 | [cloudStore.js](js/cloudStore.js) `jrConferirVersaoPublicada` + [version.json](version.json) | O app confere a versão publicada e se atualiza sozinho |
| 12 | [cloudStore.js](js/cloudStore.js) `registrarAparelho` + Governança → Aparelhos | Cada aparelho publica versão, último acesso e recusas |

**Três decisões de implementação que fogem do que estava escrito no plano, e
por quê:**

- **O item 2 não usa `atualizado_em`.** Ele compara uma assinatura curta
  (hash) de cada registro contra o estado que a nuvem confirmou. Dois motivos:
  a coluna só nasce na `migration_25`, que roda **por último** (o item ficaria
  bloqueado por uma etapa posterior), e comparar carimbo de tempo entre
  aparelhos exige que os relógios deles concordem — celular com hora errada é
  comum. Hash não depende de relógio.
- **Quando os dois lados mudaram, o local vence.** O que está na nuvem já está
  salvo em algum lugar; o que está só no aparelho, não. Descartar em silêncio
  trabalho não enviado é o erro que este projeto já cometeu vezes demais.
- **O item 10 passou a usar só a carga como chave**, e não mais
  carga+rota+placa+motorista+ajudante+setor. Tinha de ser: a `migration_25`
  cria índice único sobre `carga`. Se a regra do app fosse mais frouxa que a
  do banco, a importação passaria aqui e seria recusada lá, em bloco.

- **Item 4 — paginação por cursor.** `getAll()` passou a ler em blocos de 500
  (`order=id.asc` + `id=gt.<último>`), abaixo do corte de 1.000 do servidor de
  propósito: assim bloco cheio sempre significa "pode haver mais", nunca "o
  servidor cortou aqui". Se um bloco do meio falhar, a leitura devolve **nada**
  em vez do pedaço lido — devolver o parcial seria recriar o Teto 1 pelo outro
  lado, com o cache local sendo truncado e reenviado. Tabela sem coluna `id`
  recua sozinha para a leitura antiga.
- **Item 7 — guarda na escrita.** `upsert()` recusa registro de
  `controle_viagens` cujo `data_saida` não seja data (aceita ISO, dd/mm/aaaa,
  vazio e nulo — viagem lançada e ainda não saída é caso legítimo). O resto do
  lote sobe normalmente. A contagem de recusas aparece em
  `jrDiagnosticoSync()` e na coluna RECUSADOS da tela de Aparelhos.
  **Correção de 22/08, depois de rodar de verdade:** este texto dizia que a
  contagem identificaria o aparelho de origem dos 247 fantasmas. Não
  identifica — a contagem varre o cache local, e o cache local recebe os
  fantasmas da própria nuvem no pull, então todo aparelho sincronizado
  mostra o mesmo número. Ver o quadro na ETAPA 3. O valor real dela é outro
  e permanece: depois da ETAPA 1 ela tem que ficar em zero, e qualquer
  aparelho que volte a marcar acima de zero denuncia recontaminação.

### Onda 2 — fechar as portas do fantasma

| # | Correção | Problema que resolve |
|---|---|---|
| 8 | **Remover o `restaurarCadastrosDaPlanilha()` da rotina de sincronização** | É o que ressuscita veículo vendido e motorista desligado a cada 30s, e o que faz uma máquina desatualizada contaminar o banco de todos. Decisão 5 |
| 9 | **`id` à prova de colisão** — carimbo do aparelho junto do relógio | Confirmado na ETAPA 0: `id` é PK e é o `Date.now()` do aparelho, e o envio usa `resolution=merge-duplicates`. Dois aparelhos no mesmo milissegundo → um **sobrescreve** o outro em silêncio, sem erro nenhum |
| 10 | **Dedup da importação filtrando as excluídas** | Hoje uma viagem excluída bloqueia a reimportação daquela carga para sempre. A regra da data fica como está (decisão 1) |
| 11 | **Auto-atualização** — o app confere a versão publicada ao abrir e se atualiza sozinho | Decisão 4. Acaba com o `Ctrl + Shift + R` aparelho por aparelho |
| 12 | **Registro de aparelho** — cada aparelho publica build e último acesso na tabela `dispositivos`, com tela em Governança | Responde "qual máquina está em qual versão" sem inventário manual |

### Por que a auto-atualização não era opcional

> **Correção de 22/08, feita ao implementar o item 11.** Este trecho dizia que
> quem servia arquivo velho era o service worker. **Não é.** O `sw.js` existe
> no projeto mas **não é registrado em lugar nenhum** — e o `setupPwa()`
> ([app.js:296](js/app.js:296)) ainda por cima *desregistra* qualquer service
> worker que encontre, resquício de uma correção antiga. Conferido por busca
> no código inteiro: não há uma única chamada de `register`.

Quem guarda o arquivo velho é o **cache HTTP comum do navegador**, e o motivo
é simples: nenhuma tag `<script>` tem versão na URL, então `./js/app.js`
continua sendo o mesmo endereço depois do deploy. A hospedagem manda o
cabeçalho certo (`max-age=0, must-revalidate`, tanto no `vercel.json` quanto no
`netlify.toml`), então o servidor não é o problema.

Por isso o item 11 não mexe em service worker: publica um `version.json`, e o
app pergunta por ele ao abrir e de 15 em 15 minutos. Se a versão de lá for
diferente da que está rodando, ele rebaixa as cópias guardadas (`fetch` com
`cache: 'reload'`, que substitui a entrada daquela mesma URL) e recarrega
sozinho. Se mesmo assim não pegar, ele **não** recarrega em laço: mostra uma
tarja pedindo `Ctrl + Shift + R`.

> **Anotado, fora do escopo desta rodada:** sem service worker registrado, o
> app **não abre sem internet**. Isso já é verdade hoje, não é efeito desta
> mudança — mas contraria o que se espera de um app instalado no celular do
> motorista. Vale uma rodada própria, com teste de verdade em modo avião.

Somando com o item 8: enquanto o `restaurarCadastrosDaPlanilha()` estivesse no
ciclo, **um** aparelho em versão antiga bastaria para devolver os cadastros
velhos ao banco inteiro, a cada 30 segundos.

### Publicação

Arraste a pasta `jr-sac-corrigido` para a Vercel/Netlify, como nos deploys
anteriores, e aguarde o "Deploy concluído".

**Antes de arrastar, confira que os três lugares da versão estão iguais** — é
o que faz a auto-atualização do item 11 funcionar. Nesta entrega, todos em
`4.8.0`:

| Arquivo | Linha |
|---|---|
| [version.json](version.json) | `"build": "sync-4.8.0"` |
| [js/cloudStore.js](js/cloudStore.js) | `CloudStore.BUILD = "sync-4.8.0"` |
| [sw.js](sw.js) | `CACHE_NAME = 'jr-oper-v4.8.0'` |

Se o `version.json` ficar para trás, ninguém atualiza. Se ele ficar à frente,
todo mundo recarrega uma vez à toa e vê a tarja amarela — chato, não grave.

#### Conferência antes do deploy — feita em 22/08/2026

Rodada no código como está hoje na pasta, antes de publicar:

| O que foi conferido | Resultado |
|---|---|
| As três versões (`version.json`, `CloudStore.BUILD`, `sw.js`) | Iguais, `4.8.0` |
| Sintaxe de todos os `.js` (`node --check`) | Sem erro |
| Os 12 itens: função existe **e** é chamada | 12 de 12 |
| `restaurarCadastrosDaPlanilha()` fora do ciclo de sync | Confirmado — só sobrou o comentário em [cloudStore.js:1317](js/cloudStore.js:1317) |
| Os 4 arquivos de teste em [testes/](testes/) | Todos passaram |

Um comentário desatualizado dentro de [store.js](js/store.js) — que ainda
mandava chamar `restaurarCadastrosDaPlanilha()` "depois de cada pull" — foi
corrigido, para ninguém reintroduzir o item 8 sem querer lendo a instrução
velha. É comentário, não comportamento: nada mudou no que o app faz.

**Um risco residual, pequeno e conhecido, para a ETAPA 4 ficar de olho:** na
primeira abertura da 4.8.0, todo aparelho roda a semeadura uma vez (é a chave
`jr_seed_cadastros_v1` nascendo). A semeadura é mescla por `id` — quem já
tem o cadastro não ganha nada, e exclusão normal (a da Lixeira, que é
`is_deleted`) continua de pé, porque o registro segue no array com a flag.
O único caso que volta é o de um motorista/ajudante/veículo **da planilha**
que tenha sido apagado em definitivo pela Lixeira (`hardDelete`, com senha de
administrador): esse volta uma vez, naquele aparelho. Se acontecer, é na
ETAPA 4 que se resolve, excluindo de novo — e agora a exclusão gruda.

---

## ETAPA 2b — Tabela `dispositivos` (decisão 10) — **EXECUTADA EM 22/08/2026**

> **O problema do RLS voltou, e agora está resolvido de forma durável.**
> A tela ficou vazia uma segunda vez à noite. Conferido no banco:
> `rls_ligado = true`, `linhas_reais = 3` — os aparelhos estavam lá, o app é
> que estava cego.
>
> A causa raiz não era a execução: era a **abordagem**. A `migration_25a`
> resolvia com `DISABLE ROW LEVEL SECURITY`, o que conserta o dia e quebra de
> novo, porque o Supabase reativa RLS em tabelas do schema `public` — e
> tabela com RLS ligado **e sem política** fica invisível. Todas as outras
> ~30 tabelas do [schema.sql](database/schema.sql) nunca tiveram esse
> problema porque usam o par `ENABLE` + `POLICY`. A `dispositivos` era a
> única fora do padrão.
>
> Corrigido em
> [database/migration_25b_dispositivos_rls.sql](database/migration_25b_dispositivos_rls.sql):
> RLS **ligado**, com política aberta para `anon` e `authenticated`, igual às
> demais. **Na conferência dessa tabela, `rls_ligado = true` passou a ser o
> resultado certo** — o que faz a tela funcionar é a política, não o RLS
> desligado.

> Uma consulta só, logo depois do deploy e **antes** da ETAPA 3. Sem ela, a
> tela de Aparelhos abre vazia exatamente no dia em que ela é necessária.
> É aditiva: cria tabela nova, não encosta em nada que já existe.

Cole no SQL Editor do Supabase (mesmo caminho do PASSO A) e aperte **Run**. O
SQL está pronto em
[database/migration_25a_dispositivos.sql](database/migration_25a_dispositivos.sql)
— é só abrir o arquivo, copiar tudo e colar.

**Rode em DUAS execuções, não em uma.** O arquivo agora tem um *PASSO 2*
separado no fim. Motivo, descoberto na primeira execução real em 22/08: a
tabela foi criada, mas ficou com **RLS ligado** mesmo com o
`DISABLE ROW LEVEL SECURITY` no mesmo script. Rode o arquivo, confirme que a
tabela existe, e só então rode o PASSO 2 sozinho.

> **Como esse erro se parece, para reconhecer se voltar.** O app **lê** a
> tabela sem reclamar e **falha ao gravar**:
>
> ```
> POST .../rest/v1/dispositivos 401 (Unauthorized)
> [CloudStore] Não foi possível registrar este aparelho (HTTP 401).
> ```
>
> …e a tela de Aparelhos mostra *"Nenhum aparelho registrado ainda"* — e
> **não** a tarja âmbar de "a tabela ainda não existe". Essa combinação é a
> assinatura do RLS ligado sem política: sob RLS, o `SELECT` sem política
> não dá erro, devolve zero linha em silêncio; só o `INSERT` reclama. Se
> fosse tabela inexistente, o erro seria **404** e a tela mostraria a tarja
> âmbar. **401 + lista vazia = permissão. 404 + tarja âmbar = tabela.**

Depois de rodar, abra **Governança & Lixeira → Aparelhos** em um PC e clique
em **↻ Atualizar**. A máquina em que você está tem que aparecer na lista em
até 30 segundos, com `registros_recusados: 247` na ficha — é a confirmação
de que a tela lê o que a guarda mede. Se aparecer, a ETAPA 2b está feita — e
a ETAPA 3 vira conferência de tela em vez de caminhada.

**Como conferir cada aparelho, PC e celular, passo a passo:**
[CONFERIR_APARELHO.md](CONFERIR_APARELHO.md).

---

## ETAPA 3 — A última limpeza manual de cache — **ENCERRADA EM 22/08/2026**

> **Encerrada pela decisão 11, não pela caminhada.** Fechar a frota em 3
> aparelhos transformou o PASSO E de "inventário a descobrir" em "lista
> conhecida", e a etapa terminou na hora. Nenhuma limpeza manual de cache
> chegou a ser necessária: a auto-atualização levou os aparelhos sozinha.
>
> | Aparelho | Situação em 22/08, 21h |
> |---|---|
> | Notebook Tiago | `sync-4.8.2` · RECUSADOS 0 |
> | Celular Tiago (Android) | subiu sozinho de build antiga até `4.8.1`+ |
> | PC Analista Logística | `sync-4.8.0`, sem acesso — não bloqueia (decisão 13) |
>
> **O que continua valendo daqui para frente:** um aparelho que **não
> aparece** na tela de Aparelhos não abriu o app desde a última atualização e
> **não deve operar** antes de aparecer. A regra da frota fechada só funciona
> junto com o detector — ver *O detector de recontaminação*, acima.

> **Ordem revisada em 22/08: esta etapa roda ANTES da ETAPA 1.** Os fantasmas
> têm `id` estável e o envio sobrescreve por `merge-duplicates` — limpar o
> banco antes de esvaziar o cache dos aparelhos é trabalho desfeito no
> primeiro sync. Ver *Ordem de execução*, no início do documento.
>
> O **PASSO E** (inventário de aparelhos) é feito aqui, no dia, junto com a
> limpeza — e não antes, como estava previsto. É também aqui que se descobre
> qual aparelho carregava os 247 fantasmas.

> **Achado de 22/08, logo depois do deploy — e a correção de uma premissa
> errada do plano.** O primeiro `jrDiagnosticoSync()` na 4.8.0 devolveu
> `247 registros de controle_viagens recusados`, o número exato da ETAPA 0.
> A leitura inicial foi "achamos o aparelho culpado". **Está errada, e é
> importante desfazer antes que alguém cace um culpado que não dá para
> achar.**
>
> A contagem vem de `_auditarCacheLocal()`
> ([cloudStore.js:718](js/cloudStore.js:718)), que varre `jr_controle_viagens`
> no navegador. Só que os 247 estão **na nuvem** desde 20/08, e o pull grava
> as linhas da nuvem nessa mesma chave
> ([cloudStore.js:1265](js/cloudStore.js:1265)), sem filtrar fantasma. Logo:
> **todo aparelho na 4.8.0 que sincronizar vai mostrar 247**, não por ser a
> origem, mas por ter baixado o que está no banco. O número bater com a
> ETAPA 0 não é impressão digital — é a mesma linha contada de dois lugares.
>
> Essa premissa já estava furada quando foi escrita: a partir do momento em
> que os fantasmas chegaram à nuvem, deixou de existir sinal que separasse o
> aparelho de origem dos demais. O único vestígio que sobra é indireto — os
> ids são pequenos e sequenciais (42218 a 42222), nada parecido com o
> `Date.now()` da build atual, o que confirma **origem em build antiga**,
> mas não *qual* aparelho.
>
> **E não faz falta.** Achar o culpado nunca foi condição para nada: o que a
> limpeza exige é que **nenhum** aparelho consiga reenviar fantasma, e isso
> se resolve colocando todos na 4.8.0, que é o que esta etapa faz de
> qualquer jeito. Identificar a origem economizaria trabalho; não
> identificar não custa nada.
>
> **O que a coluna RECUSADOS realmente vale, e é bastante:** depois da
> ETAPA 1, ela tem que ir a **zero em todos os aparelhos**. Se voltar a
> subir em algum, é porque fantasma voltou para a nuvem — e só um aparelho
> fora da 4.8.0 consegue fazer isso. Ela não é caça-culpado; é **detector
> permanente de recontaminação**, que é o que o plano precisava desde o
> começo.
>
> **Não espere o aviso sumir depois de limpar o cache — e isso está certo.**
> Os 247 continuam **na nuvem** (é a ETAPA 1 que os apaga). Limpar o cache
> deste PC não os elimina: o pull seguinte baixa os mesmos 247 de volta, e a
> auditoria de cache volta a contar 247. O aviso só se cala depois da
> `migration_25`. Conferido no código: a leitura não filtra fantasma
> (`_mesclarPorRegistro` aceita o que a nuvem manda) e a janela operacional
> não poda, porque o `criado_em` deles é 20/08 — recente.
>
> **E, depois da ETAPA 1, o cache se limpa sozinho.** Os 247 estão no mapa de
> hashes como "confirmados pela nuvem"; quando a nuvem parar de devolvê-los,
> a mesclagem os descarta como exclusão alheia, em vez de ressuscitá-los.
> Ninguém precisa voltar aqui para limpar de novo.
>
> **O que isso muda no propósito desta etapa.** A justificativa original era
> "esvaziar a fonte antes de limpar o destino". Com a guarda de pé, nenhum
> aparelho **na 4.8.0** consegue reenviar fantasma — o cache sujo virou
> inofensivo. O que continua valendo, e é o motivo real desta etapa: um
> aparelho que **ainda não subiu para a 4.8.0** não tem guarda nenhuma, e
> segue reenviando fantasma, reinjetando a planilha a cada 30s e
> sobrescrevendo tabela inteira. A ETAPA 3 é sobre **colocar todo mundo na
> 4.8.0**, não sobre o cache em si.

Este passo existe uma última vez: os aparelhos ainda estão na build antiga, que
**não conhece** a auto-atualização. A partir da próxima entrega, ele deixa de
ser necessário.

- **PC:** abrir o site e pressionar `Ctrl + Shift + R`
- **Celular:** fechar a aba do app, reabrir, puxar a tela para baixo

> O passo a passo detalhado de cada um, com o que olhar e o que fazer em cada
> resultado, está em **[CONFERIR_APARELHO.md](CONFERIR_APARELHO.md)** — PC e
> celular em partes separadas, porque no celular não existe console.

Em **todos** os aparelhos da lista do PASSO E. Confirme um a um com
`jrDiagnosticoSync()`: o `buildSync` precisa mostrar a versão nova.

Depois disso, abra **Governança → Aparelhos** e confira — todos os aparelhos da
sua lista precisam aparecer lá com a build nova. Se faltar algum, ele não abriu
o app desde o deploy, e não deve operar até abrir.

---

## ETAPA 4 — Semeadura dos cadastros mestre — **EXECUTADA EM 22/08/2026**

> Decisão 5: a planilha é a base inicial; a partir daqui o app manda.

> **Virou conferência, e passou.** O `seed_cadastros_mestre.sql` previsto
> abaixo **nunca precisou existir**: o item 8 da Onda 2 já semeia os
> cadastros uma vez por aparelho, na primeira abertura da 4.8.0 (chave
> `jr_seed_cadastros_v1`), com mescla por `id`.
>
> Conferido no banco depois do Reset Global, que é o momento em que os
> cadastros correriam risco: **41 motoristas, 38 ajudantes, 89 veículos** —
> os mesmos números da ETAPA 0, intactos. Os 2 motoristas a mais que os 39 da
> planilha continuam lá, como esperado: foram cadastrados pelo app, e a
> decisão 5 diz que o app manda.

Com a correção 7 no ar, nada mais repõe os cadastros automaticamente. Então é
preciso garantir, **de uma vez**, que a nuvem tem a lista completa:

1. Rodar `database/seed_cadastros_mestre.sql` (a ser gerado a partir do
   `mockData.js`), com `ON CONFLICT (id) DO NOTHING` — **`DO NOTHING`, não
   `DO UPDATE`**: quem já foi editado ou excluído pelo app não pode ser
   sobrescrito pela planilha. *(Não foi necessário — ver nota acima.)*
2. Conferir de novo as contagens do PASSO B. O número precisa ser **igual ou maior**
   que o de antes, nunca menor.
3. A partir daqui, incluir e excluir motorista, ajudante e veículo é feito pela
   tela de Cadastros, e vale para todos os aparelhos.

O `mockData.js` continua no app apenas como **fallback de leitura** para a
primeira abertura sem internet. Ele nunca mais envia nada para a nuvem.

---

## ETAPA 5 — Reset Global de Treinamento — **EXECUTADO EM 22/08/2026, 20:41**

> **Executado em 22/08/2026 às 20:41, pelo Notebook Tiago.**
>
> | Conferência | Resultado |
> |---|---|
> | `sync_control` | 1 linha · `reset_epoch 1787431314866` · `20:41:54` · TIAGO FERREIRA ALVES |
> | `jrDiagnosticoSync().resetAplicado` | `1787431314866` — **bate com a nuvem** |
> | `controle_viagens` / `ocorrencias_devolucao` / `ocorrencias_rota` | 0, 0, 0 |
> | `motoristas` / `ajudantes` / `veiculos` | 41, 38, 89 — preservados |
> | `tabelasComPendencia` | vazio |
>
> O carimbo bater dos dois lados é o que importa: sem ele a TRAVA DE RESET
> não engata, e um aparelho parado traria tudo de volta ao abrir.
>
> **Rodou sem o PC Analista Logística**, que estava inacessível em `4.8.0`.
> Ver decisão 13: a trava tornou a precondição "todos na build mais nova"
> desnecessária — basta `≥ 4.8.0`. Aquele aparelho, parado com cache
> pré-reset, virou de quebra o **teste real** de que o reset se sustenta:
> quando abrir, é obrigado a puxar e adotar o vazio antes de poder enviar
> qualquer coisa.

**O texto original desta etapa dizia para pulá-la** — e quase foi pulada por
isso. A condição estava mal escrita: falava em "se a operação já está
valendo", mas a operação **não** havia começado
(`dataInicioProducao: "2026-08-26"`), e toda a base era de treinamento. Não se
implanta com base suja. O critério certo é **este**, e fica registrado para a
próxima:

> Se a operação **ainda não começou**, resete. Se **já começou**, não resete —
> aí a limpeza cirúrgica da ETAPA 1 é o caminho, porque há dado real em jogo.

Se for fazer: em **um único aparelho**. O reset preserva os cadastros mestre e
grava um carimbo na nuvem (`sync_control`, migração 23) para que os outros
aparelhos reconheçam que o vazio é proposital, em vez de reenviarem o que
tinham em cache. O botão fica em **Governança & Lixeira**, no painel vermelho
ao fim da tela, e exige senha de Admin mais a confirmação `RESETAR`.

---

## ETAPA 6 — Teste de aceite (obrigatório) — ⬜ **É O QUE FALTA**

> **Única etapa pendente em 22/08/2026, 21h.** Produção começa em 26/08
> (`dataInicioProducao` em [js/config.js](js/config.js)), então há folga.
>
> **Condições melhores do que o roteiro previa:** a base está **zerada** pelo
> Reset Global, então qualquer duplicata que aparecer no T4 é da importação de
> agora, não resíduo antigo. E há **três** aparelhos disponíveis, não dois.
>
> **O T6 já passou três vezes** — 4.8.0 → 4.8.1 → 4.8.2, incluindo no Android,
> sem ninguém limpar cache. Falta executá-lo formalmente uma vez, para o
> registro.
>
> Só o **T4** e o **T5** precisam de dado criado na hora. T1, T2 e T3 se fazem
> com os registros que sobrarem do próprio T4.

Com **dois aparelhos**, A e B, os dois já na build nova. Cada teste mira um
defeito específico.

**T1 — Edição concorrente** (mecanismo 1, o principal)
1. A e B abrem a tela de Controle de Viagens, sem recarregar
2. Em A, edite o horário de retorno da **viagem X**
3. Em B, edite a observação da **viagem Y** e salve
4. Aguarde 60s e recarregue os dois
5. **As duas edições precisam estar lá.** Hoje uma some

**T2 — Exclusão** (mecanismo 2)
1. Em A, exclua uma viagem de teste
2. Aguarde 60s, recarregue A e B
3. **Ela não pode voltar** — nem agora, nem em 5 minutos

**T3 — Cadastro excluído** (mecanismo 3)
1. Em A, exclua um veículo de teste pela tela de Cadastros
2. Aguarde 60s, recarregue A e B
3. **Ele não pode voltar.** Hoje volta em 30 segundos

**T4 — Importação simultânea** (mecanismos 5 e 6)
1. A e B importam a **mesma** escala, ao mesmo tempo
2. Aguarde 60s e recarregue os dois
3. **A contagem precisa ser a da escala** — 15 viagens, não 30
4. Rode a consulta do PASSO C: **nenhuma carga duplicada**

**T5 — Volume** (Teto 1)
1. Console: `cloudStore.getAll('controle_viagens').then(r => console.log(r.length))`
2. Compare com `SELECT count(*) FROM controle_viagens;`
3. **Os dois números precisam bater**, mesmo acima de 1.000

**T6 — Auto-atualização** (decisão 4)
1. Publique uma alteração mínima
2. Em B, **sem** limpar cache, feche e reabra o app
3. **A build precisa subir sozinha.** Confirme em Governança → Aparelhos

Passou nos seis: a sincronização do transporte está de pé.

---

## Se algo der errado

O sistema **não perde dado por falta de sincronização**: tudo é gravado no
aparelho primeiro. Se a nuvem recusar, o dado continua lá e o indicador fica
vermelho.

1. **Comece pela tela, não pelo console.** Governança → Aparelhos, painel
   **🩺 Diagnóstico deste aparelho**, botão **🔎 Ver o motivo**. Funciona em
   celular, que é onde o console não existe.
2. Num PC, o equivalente no console é **`jrErrosSync()`** — e não
   `jrDiagnosticoSync()`. A diferença importa: o `getDiagnostico()` guarda
   **um** erro, o último, e foi assim que a investigação de 22/08 passou horas
   perseguindo um `23503` de `sinistros` que era mera consequência de um
   `23514` em `ocorrencias_rota`. O `jrErrosSync()` roda um ciclo de envio e
   devolve **todos**.
3. `PGRST204` → falta uma coluna no banco. **Cuidado: ele reporta uma por
   vez.** Consertar coluna a coluna é ciclo infinito — levante todas de uma
   vez cruzando `information_schema.columns` com as chaves de `jr_sac_db`
   (ver *Rodada da noite de 22/08*, "O método importou mais que os consertos")
4. `23514` → `CHECK` violado. Quase sempre significa que o app está gravando
   naquela coluna o vocabulário de **outro** campo — foi o caso de
   `tipo_ocorrencia` e o dos 247 fantasmas em `data_saida`. **Alargar o
   `CHECK` é o conserto errado**; normalize na escrita
5. `23503` → chave estrangeira. Sobraram poucas no schema (a `migration_22`
   derrubou quase todas): as três de `sinistros` e duas de
   `itens_relatorio_divergencia`. Se o erro for de `sinistros`, verifique
   antes se `ocorrencias_rota` está sincronizando — geralmente é consequência
6. `428C9` → escrita em coluna gerada (`GENERATED ALWAYS`). Confira com
   `SELECT ... FROM information_schema.columns WHERE is_generated <> 'NEVER'`
7. `23505` → violação de unicidade. Depois da ETAPA 1, pode ser a chave natural
   barrando uma duplicidade — que é o comportamento desejado. Confira em
   **Governança → Conflitos** antes de tratar como defeito
8. `401` / `403` → chave ou policy do Supabase. Se for a tela de Aparelhos
   vazia **sem** tarja âmbar, é RLS sem política — ver ETAPA 2b

Enquanto isso, a operação continua normalmente em cada aparelho — só não
compartilha até resolver.

---

## Decisões que continuam em aberto

### 1. Segurança do banco (dívida conhecida)

A policy é `FOR ALL TO anon USING (true)` e a chave está no JavaScript público.
Na prática: **qualquer pessoa com o endereço do site pode ler, alterar e apagar
o banco inteiro**, sem senha. A senha de administrador do app protege as telas,
não o banco.

Não bloqueia esta rodada, mas precisa de projeto próprio — Supabase Auth com
policies por usuário, substituindo o acesso anônimo. Fica registrado aqui
porque interage com o resto: enquanto isso existir, "dado que sumiu" tem uma
causa possível que nenhuma correção de sincronização cobre.

### 2. Produtos e clientes ainda fora da nuvem

São 4.010 produtos e 15.139 clientes embarcados no `mockData.js` e guardados em
`jr_sac_static` — os 2,9 MB do Teto 2. Um produto ou cliente cadastrado pela
tela fica só naquele aparelho.

Migrar as duas listas para o Supabase resolve a limitação **e** libera a maior
parte da cota do navegador. É a onda seguinte a esta; não entra aqui.

### 3. Badge "Modo Treinamento"

`js/config.js` tem `dataInicioProducao: "2026-08-26"`. Antes dessa data o
cabeçalho exibe "🧪 Modo Treinamento". É só informativo, mas confunde — ajuste
para o dia real de início.

**Passou a ter peso além do cosmético:** foi essa data que mostrou que a
operação ainda não valia e, portanto, que a ETAPA 5 devia ser executada em vez
de pulada. Se a data real de início mudar, mude aqui.

### 4. `data_validade` de `itens_devolucao` é `VARCHAR`, não `DATE`

A coluna nasceu na `migration_26` como `VARCHAR(20)` porque o app gravava
string vazia para `AVARIA_DESCARTE` e `RENEGOCIADO_ROTA`, destinos em que a
tela dispensa a data — e `DATE` recusa `''`. A 4.8.1 passou a gravar `null`.

Quando não houver mais `''` em cache de nenhum aparelho, dá para apertar para
`DATE`. Enquanto não apertar, é uma coluna de data que aceita qualquer texto —
exatamente a condição que deixou os 247 fantasmas entrarem em
`controle_viagens.data_saida`.

### 5. `controle_viagens.data_saida` continua `VARCHAR(20)`

O campo que originou os 247 fantasmas **não foi normalizado**. A guarda de
escrita (item 7) impede que valor inválido suba, e a base está zerada — mas o
tipo da coluna continua aceitando qualquer coisa, e o caminho de edição grava
em ISO enquanto o de importação grava em `dd/mm/aaaa`.

Enquanto isso for verdade, `data_saida` não serve para janela de tempo nem
para índice. Normalizar os dois caminhos de gravação e apertar a coluna é uma
rodada própria — e agora é o momento mais barato da história do projeto para
fazê-la, com a tabela vazia.

### 6. O app não abre sem internet

Anotado na ETAPA 2 e ainda de pé: o `sw.js` existe mas **não é registrado em
lugar nenhum**, e o `setupPwa()` ([app.js](js/app.js)) desregistra qualquer
service worker que encontre. Isso já era verdade antes desta rodada, mas
contraria o que se espera de um app instalado no celular do motorista. Vale
uma rodada própria, com teste de verdade em modo avião.

### 7. Redesenho de tela a cada sincronização

Toda vez que chega dado novo da nuvem, o app redesenha a tela inteira. Já
existe uma proteção que adia o redesenho enquanto alguém está digitando num
campo, mas posição de rolagem, modal aberto e filtro aplicado continuam se
perdendo. Depois das Ondas 1+2 isso vai disparar bem menos — vale medir de novo
antes de refatorar.

---

## Histórico — a rodada de 21/08/2026

Contexto do que já foi feito, para não se repetir a investigação.

Três migrações, aplicadas nesta ordem, cada uma destravando uma camada
diferente do mesmo problema ("os dados não compartilham"):

- **`migration_22_fix_sync.sql`** — colunas que o app gravava e que não
  existiam, e chaves estrangeiras que a sincronização não tinha como
  respeitar. Depois dela, `itens_devolucao` e `cargas` passaram a receber
  dados.
- **`migration_23_checks_e_reset.sql`** — o app grava `forma_acerto = ''` na
  abertura da devolução (quem define é o Financeiro, depois) e o `CHECK` exigia
  já ali um dos valores finais. Cria também o `sync_control`, que faz o Reset
  Global valer entre aparelhos.
- **`migration_24_unique_parcial.sql`** — dos 39 motoristas da planilha, só 2
  estavam na nuvem, e os 2 eram de teste. A planilha não tem coluna de CNH,
  então os 39 têm `cnh = ''` — e `cnh` era `UNIQUE`. Em Postgres vários `NULL`
  convivem numa coluna única, mas várias strings **vazias** não. Da segunda
  linha em diante, o lote todo caía.

Também nessa rodada: a ordem de envio passou a mandar os cadastros mestre antes
dos transacionais (evitando recusa por chave estrangeira), o erro de gravação
passou a aparecer na tela em vez de só no console, e a leitura da nuvem deixou
de substituir `db.data` inteiro — o que derrubava produtos e clientes da
memória a cada ciclo.

O `restaurarCadastrosDaPlanilha()` nasceu ali, como remendo para o problema da
CNH da migração 24. Aquele problema está resolvido — e é por isso que a
correção 7 desta rodada pode removê-lo.
