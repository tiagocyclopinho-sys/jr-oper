# Como conferir um aparelho

Roteiro de bolso para responder três perguntas, aparelho por aparelho:

1. **Este aparelho está na versão nova?**
2. **Ele está guardando lixo de uma versão antiga** (os 247 fantasmas da
   ETAPA 0)?
3. **O que ele salvou está mesmo chegando na nuvem?**

Use na **ETAPA 3** do [GO_LIVE.md](GO_LIVE.md) — a limpeza de cache — e sempre
que a sincronização parecer errada de novo.

> **Nada aqui altera dado.** Tudo neste arquivo é leitura. A única ação que
> muda alguma coisa é a limpeza de cache, e ela está marcada como tal.

---

## Antes de começar: qual é a versão nova

A cada entrega, a versão muda. **Anote aqui a versão do deploy atual** e
compare com o que os aparelhos mostrarem:

| Campo | Valor |
|---|---|
| Versão esperada (`buildSync`) | `sync-4.8.3` |
| Data do deploy | ____/____/______ |

Qualquer aparelho com versão **diferente** dessa está rodando código antigo.

---

# PARTE 1 — PC

## 1.1 O jeito fácil (depois do deploy): pela tela

**Governança & Lixeira → aba Aparelhos.**

Essa tela lista todos os aparelhos que abriram o app, com a versão de cada um,
quando foi visto pela última vez e quantos registros dele a nuvem recusou.
**Se ela existir e estiver preenchida, você não precisa de mais nada — pule
para a Parte 3.**

Ela depende de duas coisas terem sido feitas: a entrega das Ondas 1+2 (versão
`sync-4.8.0`) e a criação da tabela `dispositivos` no banco — a **ETAPA 2b**,
um arquivo SQL só, colado no Supabase logo depois do deploy.

Se a aba abrir dizendo que a tabela não existe, é porque a ETAPA 2b ainda não
foi rodada — a própria tela diz isso e aponta o arquivo. Se a aba não existir,
o aparelho ainda está na versão antiga; use o jeito manual abaixo.

## 1.2 O jeito manual: pelo console

Funciona em qualquer PC, com ou sem as Ondas 1+2.

1. Abra o app no navegador, **no aparelho que você quer conferir**
2. Aperte **`F12`** (se não abrir nada, tente `Ctrl + Shift + I`)
3. Vai abrir um painel na lateral ou embaixo. Clique na aba **`Console`**
4. Clique na linha vazia ao lado do `>` e digite exatamente:

   ```
   jrDiagnosticoSync()
   ```

5. Aperte **`Enter`**

### O que vai aparecer, e o que fazer

O resultado é um blocão de texto. Você só precisa olhar **quatro linhas**:

| Linha | Aparelho saudável | Se estiver diferente |
|---|---|---|
| `buildSync` | a versão da tabela lá em cima | **Está na versão antiga.** Faça a limpeza de cache (1.3) |
| `bloqueadosNaEscrita` | `null` | **Achou.** É um aparelho com cache contaminado — ver abaixo |
| `tabelasComPendencia` | `[]` (lista vazia) | Há coisa salva aqui que **não chegou na nuvem**. Olhe o `ultimoErro` e me mande |
| `ultimoErro` | `null` | Copie a mensagem inteira e me mande |

**Se `bloqueadosNaEscrita` não for `null`**, ele vem mais ou menos assim:

```
bloqueadosNaEscrita: {
  tabela:   "controle_viagens",
  total:    247,          <-- quantos registros contaminados este aparelho ainda guarda
  exemplos: [...],        <-- amostra das cargas, para você reconhecer
  quando:   "2026-08-22T..."
}
```

Junto vem uma linha ⚠️ em amarelo dizendo a mesma coisa em português.

**Isso é o achado que a ETAPA 3 procura.** Significa: este PC guarda registros
de uma versão antiga do app, e antes do deploy vinha empurrando esse lixo para
a nuvem a cada 30 segundos. A guarda na escrita **já está barrando** — nada
dali chega ao banco — mas o cache continua sujo até você limpar.

O número é medido a cada ciclo varrendo o que está guardado no aparelho, e não
apenas o que ele tentou enviar. Ou seja: ele continua aparecendo mesmo depois
de a guarda já ter barrado tudo uma vez.

**Anote o número (`total`) e qual máquina é.** É a resposta da pergunta "qual
aparelho carregava os 247 fantasmas", e ela só existe enquanto o cache não for
limpo. Depois da limpeza, some.

## 1.3 A limpeza (isto altera o aparelho)

Só depois de anotar o resultado acima.

1. Com o app aberto, aperte **`Ctrl + Shift + R`** (recarrega ignorando o
   cache)
2. Espere a tela carregar por inteiro e o indicador da nuvem ficar verde
3. Rode o `jrDiagnosticoSync()` de novo

**Tem que ficar assim:** `buildSync` na versão nova e `bloqueadosNaEscrita` em
`null`. Se o `bloqueadosNaEscrita` continuar preenchido depois disso, **pare e
me chame** — o `Ctrl + Shift + R` troca os arquivos do app, mas não apaga os
dados guardados no aparelho; nesse caso a limpeza precisa ser mais funda e tem
risco de perder o que ainda não subiu.

---

# PARTE 2 — CELULAR

**No celular não existe `F12`.** Não há console e não há como rodar
`jrDiagnosticoSync()`. É por isso que o celular é o ponto cego do
levantamento — e é por isso que a tela de Aparelhos existe.

## 2.1 Depois do deploy: pela tela, e é só isso

O celular **se identifica sozinho**: assim que abre o app na versão nova, ele
se publica na tabela `dispositivos`. Você confere **de qualquer PC**, sem
tocar no aparelho:

**Governança & Lixeira → aba Aparelhos.**

- Celular **na lista, com a versão nova** → está em dia
- Celular **na lista, com versão antiga** → ainda não atualizou: peça para a
  pessoa fazer o 2.2
- Celular **que não aparece na lista** → não abriu o app desde o deploy. **É o
  perfil de risco da ETAPA 3**: ainda tem o cache original e vai despejar tudo
  na primeira vez que for aberto. A guarda na escrita barra os fantasmas, mas
  ele não deve operar antes de aparecer ali

> Confira contra a **lista de aparelhos do PASSO E**, feita no dia. O que não
> aparecer na tela é exatamente o que falta.

## 2.2 A limpeza no celular (isto altera o aparelho)

1. Feche a aba do app **e o navegador inteiro** — não deixe em segundo plano
   (Android: botão de apps recentes e arrastar para fora; iPhone: arrastar
   para cima e para fora)
2. Abra o navegador de novo e entre no app
3. Espere carregar inteiro
4. **Puxe a tela para baixo** para forçar o recarregamento
5. Se o app estiver instalado como ícone na tela inicial, feche e reabra pelo
   ícone também

**Como confirmar que pegou:** volte no PC, em Governança → Aparelhos, e veja
se aquele celular agora aparece com a versão nova. O "visto por último" tem
que ser de agora.

## 2.3 Se a tela de Aparelhos ainda não existir

Enquanto as Ondas 1+2 não forem publicadas, **não existe jeito de ler o
diagnóstico de um celular** sem cabo USB e um PC preparado para depuração — o
que não vale o esforço aqui.

O procedimento nesse caso é o mais simples: **limpe todos os celulares da
lista, sem tentar descobrir quais estão sujos** (passo 2.2), e confirme o
resultado pela nuvem, na Parte 3. É trabalho a mais, mas é seguro — e é a
última vez, porque depois do deploy o aparelho passa a se identificar sozinho.

---

# PARTE 3 — Pela nuvem, sem tocar em aparelho nenhum

Confere o **resultado** do conjunto: não diz qual aparelho, diz se o problema
voltou. Rode no SQL Editor do Supabase (mesmo caminho do PASSO A do
GO_LIVE.md).

## 3.1 O detector de fantasma

```sql
SELECT count(*) AS fantasmas
  FROM controle_viagens
 WHERE is_deleted IS NOT TRUE
   AND data_saida IN ('INICIADO','NÃO INICIADO');
```

| Resultado | O que significa |
|---|---|
| `0` | Limpo. É como tem que ficar depois da `migration_25` |
| Maior que zero, **antes** da `migration_25` | Normal — são os 247 que ainda não foram expurgados |
| Maior que zero, **depois** da `migration_25`, e **subindo** | Algum aparelho está reenviando cache contaminado **e está na versão antiga** (se estivesse atualizado, a guarda na escrita barraria). Volte para a Parte 1 ou 2 e ache quem é |

**Anote o número e a data cada vez que rodar.** O que interessa não é o valor
de uma medição, é ele **subir** de uma para a outra.

## 3.2 A duplicação de importação

```sql
SELECT carga, count(*) AS vezes
  FROM controle_viagens
 WHERE is_deleted IS NOT TRUE
   AND coalesce(carga,'') <> ''
 GROUP BY carga
HAVING count(*) > 1
 ORDER BY vezes DESC;
```

Depois da `migration_25` isso tem que voltar **vazio** (`no rows returned`) —
a chave natural passa a impedir no próprio banco. Se voltar linha, **pare e me
avise**: significa que a chave única não foi criada.

---

# PARTE 4 — Quando um lançamento some ou volta velho

> **CORRIGIDO na `sync-4.8.3`.** A causa está descrita em 4.1 e o conserto em
> 4.4. Esta parte continua valendo como **conferência**: é ela que confirma,
> aparelho por aparelho, que a correção pegou — e é o que tem que ser feito
> **antes do Reset Global de verdade**.

**Use esta parte quando a sincronização está funcionando** — os lançamentos
chegam nos dois aparelhos — **e mesmo assim o que está na tela não bate.** Vale
para os dois sentidos, que têm causas diferentes e não devem ser confundidos:

- **registro que SUMIU** depois de salvo → é o defeito descrito em 4.1,
  corrigido na `sync-4.8.3`;
- **registro que APARECEU** sem ninguém ter lançado → **não é o mesmo
  defeito.** É cache antigo de algum aparelho sendo republicado, ou registro
  que já estava na nuvem e só ficou visível pelo filtro de período. O 4.3
  distingue os dois em uma consulta.

As Partes 1 a 3 não acham isso, e não é falha delas: elas perguntam *"a nuvem
recusou alguma tabela?"*. Quando a resposta é "não", `jrDiagnosticoSync()`
responde **✅ tudo chegou ao banco** — e está certo. A pergunta que faltava é
outra: **as cópias que este aparelho guarda do mesmo registro concordam entre
si?**

## 4.1 Por que existem várias cópias

O mesmo registro mora em **quatro lugares** dentro de cada aparelho:

| # | Onde | Quem escreve |
|---|---|---|
| 1 | memória (`window.db.data`) | quem salva na tela |
| 2 | `jr_sac_db` — o que está gravado | `db.save()` |
| 3 | o **espelho** por tabela (`jr_ocorrencias`, `jr_cargas`…) | **só o pull** |
| 4 | `jr_sync_hashes` — a assinatura do que a nuvem confirmou | envio e pull |

E aqui estava o buraco: **`db.save()` grava (1) e (2), e nunca (3).** Quem
escreve o espelho é só a sincronização — que até a `sync-4.8.2` também **lia**
o espelho como se ele fosse "o que este aparelho tem", e mesclava a nuvem
contra ele.

Consequência: entre um ciclo e o seguinte, (2) e (3) discordam **por
construção**, não por falha de rede. Um lançamento salvo depois do último pull
não estava no espelho, não entrava na mesclagem, e o resultado era gravado por
cima — o registro sumia. **Sem erro, sem recusa, sem aparecer em
`tabelasComPendencia`.**

**A condição que dispara:** só some se *outro* aparelho tiver mandado algo na
mesma tabela nesse meio tempo. Sem isso, a mesclagem dá igual ao espelho, nada
é gravado por cima e o registro sobrevive — foi por isso que o defeito passou
tanto tempo sem ser visto. **Ter outros lançamentos chegando É a condição que
apaga o daqui**, e é o que torna o sintoma intermitente: quanto mais gente
lançando ao mesmo tempo, maior a chance.

## 4.2 No celular e no PC: pela tela

**Governança & Lixeira → aba Aparelhos → "🧬 Resquício de cache neste
aparelho".**

Dois botões, os dois **só leem** — não alteram nada:

### "🔬 Conferir as cópias"

Compara as três cópias locais de **todos** os registros. Não usa internet, é
instantâneo.

| Resultado | O que significa | O que fazer |
|---|---|---|
| ✅ Nenhuma divergência | as cópias batem | nada |
| ⚠️ N registros, **nenhum em risco** | o espelho está atrasado | nada — o próximo ciclo resolve |
| ⛔ N registros, **M "SOME"** | esses M ainda não subiram e **o próximo ciclo de 30s os apaga** | **não feche o app**; toque em "🔎 Ver o motivo" logo acima para forçar o envio, e confira de novo |

A coluna **Risco** é a única que pede ação imediata. As colunas Tela / Salvo /
Espelho dizem em qual cópia o registro falta; linha sem nenhum "falta" é
registro que está nas três com **conteúdo diferente**.

### "🔎 Rastrear"

Digite o que tiver na mão — **placa, carga, nota fiscal, protocolo ou id** — e
ele mostra aquele registro nas **cinco** camadas, incluindo o que a nuvem tem
**agora**, lido direto, sem passar por cache nenhum.

É a única leitura do sistema que olha os cinco lugares ao mesmo tempo, e por
isso a única que consegue dizer **qual deles está velho**. O veredito vem
escrito em português, com a ação junto.

### Como usar o rastreio para o caso "apareceu do nada"

Digite a placa do registro que você **não** lançou. O que a resposta significa:

| O que o rastreio mostra | O que aconteceu |
|---|---|
| **Nuvem: presente** e **Mapa de envio: confirmado** | o registro já estava na nuvem antes. Ninguém o criou agora — ele só ficou visível. Confira o filtro de período da tela e a data dentro do "+" da linha |
| **Nuvem: presente** e **Mapa de envio: nunca confirmado** | veio de OUTRO aparelho. Veja em Aparelhos qual deles está em versão antiga |
| **Nuvem: ausente** e **Salvo: presente** | **este** aparelho o tem e está prestes a publicá-lo. É cache antigo daqui — é este o aparelho a limpar |

O terceiro caso é o que republica dado velho para a empresa inteira, e é o
único que pede ação no aparelho em que você está.

## 4.3 No PC: pelo console

Mesma coisa, para quem já está com o `F12` aberto:

```
jrConferirCamadas()
```

```
jrRastrear('OLI2E18')
```

O primeiro devolve a tabela de divergências; o segundo, o registro nas cinco
camadas. Os dois também deixam o resultado em `window.jrUltimaConferenciaCamadas`
e `window.jrUltimoRastreio`.

## 4.4 O conserto que entrou na `sync-4.8.3`

**O pull passou a mesclar contra `window.db.data` / `jr_sac_db`, e não mais
contra o espelho.** Foi o caminho escolhido entre os dois possíveis, porque
não toca no caminho de gravação de nenhuma tela: o **envio** já tratava
`jr_sac_db` como a verdade (`syncLocalToCloud` lê a fatia operacional primeiro
e só cai no espelho como último recurso). As duas metades do mesmo ciclo é que
olhavam para cópias diferentes — a correção foi fazer a **leitura** concordar
com a **escrita**.

O espelho continua existindo e continua sendo escrito a cada pull. Ele deixou
de ser autoridade, não deixou de existir — o detector de 4.2 precisa dele para
conseguir enxergar divergência.

Junto vieram dois ajustes menores, pelo mesmo motivo:

- **o contador de fantasmas** (`bloqueadosNaEscrita`) lia o espelho, e por
  isso podia dizer "limpo" com fantasma na fatia operacional. É esse número
  que libera uma máquina para operar antes do Reset — agora ele conta o que o
  aparelho realmente tem;
- **o zeramento de dados de treinamento** limpava só `jr_sac_db`, deixando a
  memória e os espelhos para trás.

Provado em `testes/06_pull_nao_apaga_lancamento.js`, que roda o
`syncCloudToLocal` de verdade contra uma nuvem simulada — inclusive as
garantias que **não** podiam ser desfeitas: exclusão feita em outro aparelho
continua entrando, Reset Global remoto continua sendo aceito, nuvem vazia sem
reset continua não apagando o que nunca subiu, e edição local não enviada
continua vencendo.

## 4.5 O que fazer antes do Reset Global de verdade

Nesta ordem, sem pular:

1. **Publique a `sync-4.8.3`** e confira `version.json` no ar.
2. **Todo aparelho na versão nova**, sem exceção — Governança → Aparelhos, e
   confira contra a lista do PASSO E. Aparelho que não aparece ali **não pode
   operar**: ele ainda tem o pull antigo e o cache antigo.
3. **Em cada aparelho, "🔬 Conferir as cópias"** (4.2). Se aparecer "SOME",
   force o envio **antes** do reset — o que ainda não subiu se perde no
   reset, e aí sim de forma definitiva.
4. **`jrDiagnosticoSync()` limpo** em cada PC: `bloqueadosNaEscrita: null` e
   `tabelasComPendencia: []`.
5. **A consulta 3.1 no Supabase em zero** — e medida duas vezes, com intervalo,
   para provar que não está subindo.
6. Só então o Reset Global.

---

# Resumo de bolso

| Quero saber | PC | Celular |
|---|---|---|
| Em que versão está | `jrDiagnosticoSync()` → `buildSync`, ou a aba Aparelhos | Aba Aparelhos, de qualquer PC |
| Se tem cache contaminado | `jrDiagnosticoSync()` → `bloqueadosNaEscrita` | Aba Aparelhos → coluna de recusas |
| Se o que salvei subiu | `jrDiagnosticoSync()` → `tabelasComPendencia` | Indicador da nuvem, no alto da tela |
| Se o fantasma voltou | consulta 3.1, no Supabase | a mesma |
| Se um lançamento sumiu ou voltou velho | `jrConferirCamadas()`, ou Aparelhos → Resquício de cache | Aparelhos → Resquício de cache |
| Onde está ESTE lançamento | `jrRastrear('PLACA')`, ou o campo Rastrear | o campo Rastrear |
| Limpar | `Ctrl + Shift + R` | fechar tudo, reabrir, puxar para baixo |

Qualquer resultado que não estiver nesta tabela: **copie a tela inteira e me
mande, sem tentar adivinhar.**
