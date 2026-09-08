# Plano de Ação — O segundo ajudante

Escrito em **07/09/2026**, com a v6.5.1 no ar. Sai como **v6.6.0**.

---

## Ponto de partida (para retomar em outra sessão)

**Já está pronto:**

- Este plano, com as quatro decisões tomadas em 07/09/2026 (seções 2, 3 e Bloco B).
- `database/migration_40_segundo_ajudante.sql` — **rodada em 07/09/2026** no
  projeto JR-OPER. Aditiva: nenhum dado foi alterado.
- **Blocos A, B e C — código escrito e ritual de versão feito** (07/09/2026).
  Falta **publicar** e o **PASSO 4** do `GO_LIVE.md`.
- **Marcadores de versão, os cinco:** `appVersion` (`js/config.js`) e
  `CACHE_NAME` (`sw.js`) em `6.6.0`; `CloudStore.BUILD` (`js/cloudStore.js`) e
  `version.json.build` em `segundo-ajudante-6.6.0`. O quinto — `currentVersion`
  em `js/store.js`, que ninguém lembrava — passou a **ler o `config.js`** em vez
  de repetir o número à mão.
- **Nuvem em dia:** migration 40 aplicada e `vw_bi_reentregas_custodia` recriada
  (07/09/2026), agora com 34 colunas — `ajudante` e `ajudante_2` no fim. Rodou
  **só essa view**, não o `schema_views.sql` inteiro: as outras seis usam
  `DROP ... CASCADE` e recriá-las à toa tiraria o Power BI do ar por um
  instante. As sete views seguem intactas.

**A ordem, e ela importa:**

1. ~~Rodar a migration 40 no Supabase e conferir.~~ **Feita em 07/09/2026**: as
   três colunas existem, o PostgREST já as enxerga, e os 198 registros seguem
   intactos com `ajudante_2` vazio.
2. ~~**Bloco A** — o botão na edição da viagem, o fio solto da devolução, os
   recibos.~~ **Escrito em 07/09/2026**, não publicado.
3. ~~**Bloco B** — a reentrega: gravar o ajudante que hoje se perde, e o
   segundo.~~ **Escrito em 07/09/2026**, não publicado.
4. ~~**Bloco C** — o aviso de gente fora do cadastro.~~ **Escrito em
   07/09/2026**, junto com A e B — não foi preciso adiar para a 6.6.1.
5. ~~Ritual de versão~~ **feito em 07/09/2026**. Falta **publicar** e limpar o
   cache em cada aparelho (**PASSO 4** do `GO_LIVE.md`) — o `buildSync` do
   `jrDiagnosticoSync()` tem de dizer `segundo-ajudante-6.6.0`.
6. Teste de aceite — a lista está em *Como saber que ficou certo*.

**Nenhum dado gravado foi alterado.** A migration só acrescentou colunas vazias,
a view só ganhou duas colunas no fim, e o código ainda não foi publicado.

---

## 1. A necessidade

Algumas rotas saem com **dois ajudantes**. O Controle de Viagens só tem lugar
para um. Como é dele que o resto do sistema puxa a informação, o segundo ajudante
não existe para o sistema: ele foi na rota e não está escrito em lugar nenhum.

O que dói é o dinheiro. Quando há adiantamento, o valor é dividido entre o
motorista e um ajudante — metade para cada. Se havia dois ajudantes, a divisão
deveria ser **por três**. Do jeito que está, duas pessoas pagam a parte de três.

Não é uma rota fixa nem uma dupla fixa: **muda por dia**, conforme a demanda e
quem está disponível. Então isso é informação **de cada viagem**, não uma
configuração de rota.

---

## 2. A decisão que orienta o resto: o dinheiro segue o nome

Hoje o recibo do adiantamento não pergunta quem estava na viagem. Ele pergunta
pelo **número do ajudante no cadastro**, guardado na devolução. Se esse número
não foi guardado — e em 12 cargas de 29 não foi — a pessoa some da conta e o
motorista paga sozinho.

**A partir da 6.6.0, o recibo pergunta direto ao Controle de Viagens: "quem
estava nessa viagem?"** e usa os nomes que estão lá.

O que isso resolve de uma vez:

- O segundo ajudante entra na conta pelo mesmo caminho do primeiro. Um caminho
  só, não dois.
- Some a dependência de o ajudante estar amarrado por número. Como os campos são
  preenchidos escolhendo da lista de ajudantes cadastrados, o nome já sai escrito
  do jeito certo.
- As 12 cargas que hoje aparecem com ajudante "N/A" voltam a mostrar o nome e a
  dividir o valor, **sem precisar mexer em dado antigo**. O cálculo roda na hora
  de gerar o PDF, então recibo de devolução antiga já sai certo.

Onde não houver viagem lançada para aquela carga, o sistema continua consultando
o caminho antigo, pelo número. Ninguém fica sem resposta.

---

## 3. Como a informação entra

**Na tela de editar a viagem, um botão "+ Adicionar 2º ajudante".**

- O segundo ajudante **não é obrigatório**. Enquanto ninguém clicar no botão, a
  tela fica exatamente como está hoje — quem faz viagem de um ajudante só não vê
  diferença nenhuma.
- Clicou, aparece um segundo campo, igual ao primeiro: a lista dos ajudantes
  cadastrados. Escolhe-se o nome, não se digita.
- Ao lado dele, um "remover", para o caso de ter sido clicado por engano.
- **Não vem da planilha da escala**, e não precisa vir: a viagem já entra no
  sistema pela importação, e a edição é trabalho obrigatório de qualquer jeito. O
  segundo ajudante é acrescentado nesse momento, junto com o resto.

Por isso o botão fica **só na edição**. A tela de cadastro de viagem não muda.

---

## 4. Onde a informação fica guardada

**Uma coluna nova ao lado da que já existe**, no Controle de Viagens e também na
Reentrega (o porquê está no Bloco B). É alteração aditiva: nada do que está
gravado hoje muda, e viagem sem segundo ajudante fica com a coluna vazia.

Escolhi assim, e não uma estrutura mais elaborada, porque é o menor passo que
termina o serviço: relatórios, exportações e Power BI continuam lendo o primeiro
ajudante exatamente como leem hoje.

**Fica registrado para o futuro:** se um dia aparecer um **terceiro** ajudante, a
resposta certa não é criar uma terceira coluna — é criar uma lista de ajudantes
por viagem. Aí é outro plano, maior. Enquanto forem dois, dois campos resolvem.

---

## 5. Por onde a informação anda depois de gravada

1. **Controle de Viagens** — o segundo nome é gravado na viagem.
2. **Qualquer tela que mencione a carga** — quando o sistema pergunta "quem
   estava nessa carga?", ele já consulta o Controle de Viagens **em primeiro
   lugar**. Isso já funciona assim hoje para o primeiro ajudante; o segundo pega
   carona no mesmo caminho.
3. **Devolução** — passa a carregar a equipe como uma **lista de nomes**, com
   uma, duas ou três pessoas.
4. **Recibo do adiantamento** — recebe a lista e divide o valor entre quantos
   forem.

**A parte mais difícil já está pronta.** O cálculo instalado na versão de hoje já
divide para qualquer número de pessoas e acerta os centavos: R$ 100 entre três dá
33,34 + 33,33 + 33,33, e a soma fecha com o valor cobrado. Dividir por três não
exige refazer conta nenhuma — exige apenas alguém entregar os dois nomes a ele,
que é justamente o que falta hoje.

---

# Os três blocos da v6.6.0

## Bloco A — O segundo ajudante

| Onde | O que muda |
|---|---|
| **Banco** | Uma coluna nova no Controle de Viagens. |
| **Tela de editar viagem** | Botão "+ Adicionar 2º ajudante", campo opcional, com remover. |
| **Ligação viagem → devolução** | A devolução passa a montar a **lista de nomes** a partir da viagem. É o fio que hoje está solto: a lista já existe no sistema e nunca é preenchida por ninguém. |
| **Recibo do adiantamento** | Hoje imprime duas folhas fixas — motorista e ajudante. Passa a imprimir **uma folha por pessoa**: com dois ajudantes, três folhas. |
| **Texto do recibo** | Na folha do ajudante, "50%" está escrito com todas as letras. Com três pessoas ela sairia dizendo 50% enquanto a do motorista diz 33%, no mesmo PDF. Passa a ser calculado. |
| **Valor impresso** | Cada folha passa a mostrar **a cota daquela pessoa**. Hoje as duas folhas repetem o valor do motorista — com centavos quebrados, as duas somam um centavo a mais que o cobrado. É erro que **já acontece hoje**, com dois. |
| **Exportações e Power BI** | Incluir o segundo ajudante onde o primeiro aparece. |

## Bloco B — A reentrega

Você tem razão: reentrega sai avulsa ou dentro de outra carga, e de um jeito ou
de outro a correlação com a equipe acaba acontecendo. Deixar de fora seria criar
uma segunda regra para o mesmo assunto.

**E ao conferir essas telas, apareceu um defeito que ninguém tinha visto.**

A tela de reentrega **tem** um campo Ajudante. A pessoa escolhe o nome, salva, e
o sistema **joga o nome fora em silêncio** — na criação e na edição. Não dá erro,
não avisa nada: simplesmente não grava. O campo existe na tela, mas não existe
nem na memória do sistema nem no banco. Quem preencheu aquele campo alguma vez
preencheu para nada.

É o mesmo tipo de falha calada que fez os 12 casos de ajudante "N/A" — só que
neste caso nem chega a gravar errado, não grava de forma alguma.

Então o Bloco B é:

| Onde | O que muda |
|---|---|
| **Banco** | A tabela de reentrega não tem coluna de ajudante nenhuma. Entram as duas: o primeiro e o segundo. |
| **Gravação** | O nome escolhido na tela passa a ser efetivamente salvo — hoje é descartado. |
| **Tela de reentrega** | O mesmo botão "+ Adicionar 2º ajudante", na criação e na edição. |

Vale conferir depois de publicar se alguma reentrega antiga ficou com ajudante em
branco por causa disso. Provavelmente sim, e não há como recuperar: o nome nunca
chegou a ser gravado em lugar nenhum.

## Bloco C — O aviso de gente fora do cadastro

Sua pergunta: *"mesmo que tenha o prestador cadastrado, a grafia diferente não o
encontra, né? Teria como sinalizar?"*

**Exatamente isso.** O sistema compara o nome que veio da planilha com os nomes
do cadastro, letra por letra. `JOSE` e `JOSÉ` são pessoas diferentes para ele.
Sobrenome a mais, abreviação, um espaço a mais — tudo vira "não achei". E existe
o segundo caso, mais simples: a pessoa nunca foi cadastrada.

Nos dois casos o sistema não reclamava. Só aparecia "N/A" no fim da linha, sem
dizer por quê.

**Com o dinheiro seguindo o nome, isso deixa de tirar ninguém do recibo** — a
pessoa recebe sua folha e sua cota mesmo sem estar cadastrada. Mas continua
custando: quem não está no cadastro **não aparece na lista para ser escolhido**, e
não entra direito nos relatórios por pessoa. Vira higiene, não emergência.

**Sim, dá para sinalizar. É assim que eu faria:**

- **Na lista do Controle de Viagens**, uma marca visível na viagem cujo motorista
  ou ajudante não bate com o cadastro.
- **Na tela de edição**, ao abrir a viagem, uma linha de aviso dizendo qual dos
  dois não foi encontrado — em vez do campo aparecer estranhamente vazio.
- **Um contador** — "N viagens com gente fora do cadastro" — que abre a lista
  delas. Sem isso o aviso vira enfeite: some no meio das viagens e ninguém age.
- **A comparação tem que ser tolerante** — ignorando acento, maiúscula e espaço
  sobrando. Se for letra por letra como é hoje, o aviso vai gritar em cima de
  `JOSÉ` vs `JOSE`, que é a mesma pessoa, e em uma semana ninguém olha mais.
- **E quando for quase igual, o aviso oferece a correção**: *"parece ser JOSÉ DA
  SILVA — é ele?"*. Um clique amarra. Quem confirma é gente, nunca o sistema
  sozinho.

Vale para **motorista e ajudante**, como você pediu — o motorista está mais
protegido hoje, mas pelo mesmo caminho torto, e merece o mesmo aviso.

> **O Bloco C é separável.** Se a janela apertar, os blocos A e B saem na 6.6.0 e
> o aviso vai na 6.6.1. Ele melhora o cadastro; não é o que resolve o rateio.

### O que o aviso encontrou, medido antes de publicar (07/09/2026)

Rodada a comparação sobre as 197 viagens vivas e o cadastro real (41
motoristas, 38 ajudantes), 591 campos conferidos:

| | |
|---|---|
| Achou no cadastro | 309 |
| Vazio (não é defeito) | 197 |
| Dois nomes numa vaga só | 47 |
| Quase — o sistema pergunta | 25 campos, **8 nomes distintos** |
| Fora do cadastro | 13 campos, **7 nomes distintos** |

**O contador diria: 80 de 197 viagens (41%).** Parece muito, e é: mas **44
dessas 80 são só o contorno da barra** — o trabalho manual já combinado. O que
sobra de cadastro é pequeno e nominal: **15 pessoas**, oito delas resolvidas com
um clique no "é ele?".

Os sete que precisam mesmo ser cadastrados, com a contagem de viagens:

```
4x  Motorista  EDIMAR MONTELO DE FREITAS
3x  Motorista  GLEDSON RODRIGUES DE BORBA
2x  Ajudante   MARCOS ROBERTO TIMOTEO DE LIMA
1x  Ajudante   JOSE LEANDRO DA SILVA CHAVES
1x  Ajudante   FABRICIO GOMES FERREIRA
1x  Motorista  GLEDSON
1x  Ajudante   EDSON DOS SANTOS SILVA
```

**Um caso pede olho humano:** `GUSTAVO COSTA DA SILVA` recebe o palpite
`GUSTAVO CARVALHO DA SILVA`. Primeiro e último nome batem, o do meio não —
pode ser a mesma pessoa mal digitada ou duas pessoas diferentes. É exatamente
por isso que o sistema pergunta em vez de amarrar.

---

## Como saber que ficou certo

O teste de aceite, em linguagem de operação:

- [ ] Editar uma viagem, clicar no botão, escolher o segundo ajudante, salvar.
      Reabrir: os dois nomes continuam lá.
- [ ] Uma viagem **sem** segundo ajudante continua igual ao que era.
- [ ] Abrir uma devolução dessa carga: os dois ajudantes aparecem.
- [ ] Gerar o recibo do adiantamento: saem **três folhas**, uma para cada pessoa
      assinar, cada uma com o nome certo.
- [ ] Somar os três valores impressos: tem que dar **exatamente** o valor da
      ocorrência. Testar com valor que não divide redondo (R$ 100,00 → 33,34 +
      33,33 + 33,33).
- [ ] As três folhas dizem o mesmo percentual.
- [ ] Uma devolução **sem nenhum** ajudante: uma folha só, 100% do motorista.
- [ ] Uma devolução antiga, daquelas que mostravam "N/A": agora mostra o nome e
      sai com duas folhas.
- [ ] **Reentrega:** escolher um ajudante, salvar, sair da tela e voltar. O nome
      tem que continuar lá — hoje ele desaparece.
- [ ] **Aviso:** lançar uma viagem com um nome que não está no cadastro e
      conferir se a marca aparece; conferir que uma viagem com nome certo, mas
      com acento diferente, **não** dispara alarme falso.
- [ ] Depois de publicar, limpar o cache em cada aparelho (**PASSO 4** do
      `GO_LIVE.md`).

**Se der errado:** as colunas novas são opcionais e vazias por padrão — voltar
para a versão anterior devolve tudo ao estado de hoje, e as colunas podem ficar
no banco sem atrapalhar. Não há dado antigo alterado neste plano, então não há o
que desfazer no banco.

---

## O que este plano não faz

- **Não preenche o segundo ajudante em viagem antiga, e isso é decisão, não
  limitação.** Ver *O contorno da barra*, logo abaixo: a informação existe em 32
  viagens, e mesmo assim o preenchimento fica manual, com o operador.
- **Não preenche o ajudante das reentregas antigas.** Esse nunca chegou a ser
  gravado em lugar nenhum, e não há de onde recuperar.
- **Não reconcilia o cadastro por número.** Com o dinheiro seguindo o nome, isso
  deixou de ser urgente. O Bloco C mostra quem está de fora; cadastrar é trabalho
  de rotina, não de deploy.
- **Não toca nas 30 viagens FINALIZADO sem data de retorno.** Continua como está
  no `PENDENCIAS.md`, item 3 — dado histórico, sem pressa, com o SQL pronto lá.

---

## O contorno da barra — achado de 07/09/2026, ao rodar a migration

Este plano afirmava, acima, que o segundo ajudante *"não existe em lugar nenhum
para ser recuperado"*. **Estava errado.** Ele existe, escrito à mão, enfiado no
campo do primeiro com uma barra:

```
43838  07/09  EDUARDO MEDANHA / MARCOS VINICIUS
43791  04/09  ALMIR / DOUGLAS COSTA
43790  03/09  RAIMUNDO NONATO / LUCAS GOMES
```

O pessoal inventou o contorno porque só havia uma vaga. Medido na nuvem em
07/09/2026, sobre 197 viagens vivas:

| | |
|---|---|
| Com dois nomes numa vaga só | **32 (16%)** |
| Dessas, com exatamente dois nomes | 32 — **nenhuma com três** |
| Em setembro | 16 — metade, nos últimos sete dias |
| Período | 24/08 a 07/09 — **prática corrente, não resíduo** |

**O que isso custa enquanto não for arrumado:** nessas 32 o recibo divide **por
dois**. `LUCAS GOMES / JOSE LEANDRO` é um nome só para o sistema — sai uma folha
com os dois nomes juntos, duas pessoas assinando a mesma via, e a cota errada. É
o problema que a 6.6.0 existe para resolver, em 16% das viagens.

**A decisão (07/09/2026): o operador separa à mão, viagem por viagem, agora que
o campo existe.** Nada de UPDATE em massa, nada de quebrar a barra na hora de
ler. O motivo é o mesmo do resto do plano — quem confirma quem estava na viagem
é gente, não o sistema — e aqui há um segundo: os nomes vêm com grafia torta
(`JOSE LEANDO`, `MARCOS ROBBERTO`, `LUKAS CARLOS`, `MARCOS ROB` truncado), e
separar automaticamente só espalharia o erro em duas colunas em vez de uma.

Para puxar a lista do que falta, a qualquer momento:

```sql
select carga, data_saida, ajudante from controle_viagens
where coalesce(is_deleted,false) = false and ajudante like '%/%'
order by data_saida desc;
```

**Fica em aberto, e é o que decide se a lista encolhe ou cresce:** a importação
da escala traz `ajudante` da planilha como está. Se a planilha continuar vindo
com barra, **viagem nova continua chegando amassada** depois do deploy, e o
trabalho manual não termina nunca. Vale conferir na primeira importação depois
da 6.6.0.

---

# Anexo — os pontos no código

Para a hora de executar. Nada aqui muda o que está escrito acima.

**Migration 40** (`database/migration_40_segundo_ajudante.sql` — a última do
repositório é a 39). Três colunas, todas aditivas:

```sql
ALTER TABLE controle_viagens ADD COLUMN IF NOT EXISTS ajudante_2 VARCHAR(120);
ALTER TABLE reentregas_rota  ADD COLUMN IF NOT EXISTS ajudante   VARCHAR(120);
ALTER TABLE reentregas_rota  ADD COLUMN IF NOT EXISTS ajudante_2 VARCHAR(120);
```

`controle_viagens.ajudante` é `VARCHAR(120)`, uma vaga; `reentregas_rota` não tem
coluna de ajudante nenhuma (`database/schema.sql`). Atualizar o `schema.sql`
junto — a migration muda a nuvem, o schema é o documento.

**Bloco A — tela.** Edição da viagem: `js/app.js:11961` (`ed-vg-ajudante`). O
`value` das opções já é o **nome**, não o número — é o formato que a coluna nova
recebe. O cadastro (`js/app.js:11694`) não muda.

**Bloco A — o fio solto.** `equipeDaDevolucao()` (`js/app.js:8120`) já percorre
`dev.ajudantes` **como lista** antes de olhar o nome isolado, e **nenhum ponto do
`store.js` escreve nessa lista**. Em `js/store.js:1531`, montar `ajudantes` a
partir da linha de `controle_viagens` cuja `carga` casa com a da devolução —
viagem primeiro, e o caminho antigo (`carga.ajudante_id`, `js/store.js:1492`)
como reserva para carga sem viagem lançada. É a mesma precedência que
`buscarCargaInfo()` (`js/app.js:7214`) já usa. Havendo mais de uma viagem para a
mesma carga, usar a não excluída mais recente.

**Bloco A — recibos.** São **dois** geradores, cada um com as duas folhas
escritas à mão: `gerarAdiantamentoPdf()` (`js/app.js:8193` e `:8295`) e o de
divergência CD (`js/app.js:10400` e `:10503`). Trocar por um laço sobre a equipe.
Junto:

- `valorPorPessoa = (cotas[0]).toFixed(2)` (`js/app.js:8158` e `:10359`) usa a
  cota do motorista nas duas folhas — `cotas[1]` nunca é lido. **Correção de uma
  linha, e conserta erro que já existe hoje com dois.**
- `50%` escrito à mão em `:8205`, `:8230`, `:8236`, `:10412`, `:10438`, `:10444`;
  `(Rateio 50%)` em `:8316`, `:10422`, `:10524`; e no aviso em `:10271`.

**Bloco B — onde o nome se perde.** Os formulários coletam certo:
`js/app.js:12415` (criação) e `:12592` (edição) mandam `ajudante_nome`. A perda é
no `store.js`:

- `addReentrega()` (`js/store.js:3943`) monta o registro campo a campo e não
  copia `ajudante_nome`.
- `updateReentrega()` (`js/store.js:4032`) filtra por **whitelist**, e
  `ajudante_nome` não está nela. O próprio comentário do código avisa: *"campo
  que não estiver aqui é descartado em silêncio pelo update — não dá erro, só não
  grava"*. Foi exatamente o que aconteceu.

Corrigir os dois, mais os selects `md-re-ajudante` (`:12344`) e `ed-re-ajudante`
(`:12525`), que já guardam **nome** e já acrescentam à lista um nome que não
esteja no cadastro (`:12287` e `:12468`).

**Bloco C — a comparação.** Já existe `normalizeStr()` (`js/app.js:25356`), que
tira acento e caixa; falta colapsar espaço duplicado. Usá-la dos dois lados da
comparação, e reaproveitar em `onSacCargaSelect()` (`js/app.js:7454`), onde hoje
a opção fabricada com o nome no lugar do número é o que produz o "N/A".

**Fechamento da versão.** `js/store.js:3390` (dump SQL),
`database/schema_views.sql` (views do BI), e o ritual: `appVersion` em
`js/config.js`, `CACHE_NAME` em `sw.js` (hoje `jr-oper-v6.5.1`) e uma entrada
nova em `version.json`.
