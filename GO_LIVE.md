# Go-Live — JR Oper

Procedimento para colocar o sistema em operação real com a sincronização
funcionando. Escrito em 21/08/2026, após o diagnóstico da causa raiz de
"os dados não compartilham".

**Tempo total: ~20 minutos.** Faça na ordem. Não pule o passo 2.

---

## Antes de começar

Tenha aberto:
- O painel do Supabase (projeto `qxipgnkdbzxtfvuyupow`)
- O painel da Vercel ou Netlify (onde o app está publicado)
- Dois aparelhos diferentes para o teste final (ex: PC e celular)

---

## PASSO 1 — Atualizar o banco (Supabase)

São **três** scripts, nesta ordem. Supabase → **SQL Editor** → **New Query**,
colar o conteúdo inteiro, **Run**, repetir com o próximo.

1. `database/migration_22_fix_sync.sql` — colunas ausentes, `NOT NULL` e FKs
2. `database/migration_23_checks_e_reset.sql` — restrições `CHECK` e `sync_control`
3. `database/migration_24_unique_parcial.sql` — `UNIQUE` que não tolera campo em branco

Todos são idempotentes: rodar duas vezes não quebra nada.

> **Por que três:** cada uma destravou uma camada diferente do mesmo problema —
> o banco recusava o registro e o app não mostrava o erro.
>
> - **22** — colunas que o app grava e que não existiam, e chaves estrangeiras
>   que a sincronização não tem como respeitar. Depois dela, `itens_devolucao`
>   e `cargas` passaram a receber dados.
> - **23** — a devolução continuava recusada: o app grava `forma_acerto = ''`
>   na abertura (quem define é o Financeiro, depois) e o `CHECK` exigia já ali
>   um dos valores finais. Cria também o `sync_control`, que faz o Reset Global
>   valer entre aparelhos.
> - **24** — dos 39 motoristas da planilha, só 2 estavam na nuvem, e os 2 eram
>   de teste. A planilha não tem coluna de CNH, então os 39 têm `cnh = ''` — e
>   `cnh` era `UNIQUE`. Em Postgres vários `NULL` convivem numa coluna única,
>   mas várias strings **vazias** não. Da segunda linha em diante o lote todo
>   caía. Passaram só os dois registros com CNH distinta, justamente os falsos.

## PASSO 2 — Confirmar que o banco aceitou (NÃO PULE)

Ainda no SQL Editor, rode:

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='ocorrencias_devolucao'
      AND column_name IN ('motorista_id','fotos_investigacao','itens',
                          'atualizado_por','data_entrada_cd','requisito')) AS colunas_devolucao,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='resumo_diario_cd'
      AND column_name IN ('recebimento','expedicao')) AS colunas_resumo,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name='sync_control') AS tabela_sync_control,
  (SELECT count(*) FROM pg_constraint
    WHERE conname='ocorrencias_devolucao_forma_acerto_check'
      AND pg_get_constraintdef(oid) LIKE '%''''%') AS check_aceita_vazio,
  (SELECT count(*) FROM pg_indexes
    WHERE indexname='uq_motoristas_cnh') AS unique_cnh_parcial;
```

**Esperado: `6`, `2`, `1`, `1`, `1`.**

- `check_aceita_vazio = 0` → a migração 23 não rodou; a devolução continua sendo recusada.
- `unique_cnh_parcial = 0` → a migração 24 não rodou; os motoristas continuam sem subir.

Rode de novo e leia a mensagem de erro antes de seguir.

### Conferir os motoristas depois de publicar

Depois do PASSO 3 e do refresh, rode no SQL Editor:

```sql
SELECT count(*) AS total, count(*) FILTER (WHERE cnh <> '') AS com_cnh FROM motoristas;
```

Esperado: **`total = 39` ou mais**. Se ainda vier `2`, o aparelho não subiu a
lista — confirme o `buildSync` no PASSO 4.

Os dois registros artificiais (`A cadastrar` e `TESTE CLAUDE IGNORAR`) podem ser
removidos com o bloco comentado no fim da `migration_24_unique_parcial.sql`.

## PASSO 3 — Publicar o app atualizado

Arraste a pasta `jr-sac-corrigido` para a Vercel/Netlify, como no deploy
original, e aguarde o "Deploy concluído".

Arquivos alterados nesta correção:
- `js/cloudStore.js` — ordem de envio, trava de reset no push, mesclagem não
  destrutiva no pull, erro de gravação visível na tela
- `js/app.js` — telas de Cadastros não quebram mais se uma lista ainda não carregou
- `database/schema.sql` — correções incorporadas (instalação nova nasce certa)
- `sw.js` — versão de cache `v4.7.3` → `v4.7.9`

## PASSO 4 — Limpar o cache em cada aparelho

> ⚠️ **Este passo tem que estar 100% concluído antes do PASSO 5.** Um aparelho
> rodando código antigo não conhece o carimbo de reset: ele reenvia o que o
> reset acabou de apagar. Foi exatamente isso que trouxe a DEV-2026-001 e as
> 15 viagens de volta em 22/08/2026 — a devolução não foi lançada sozinha,
> foi ressuscitada por um aparelho desatualizado.

O app é um PWA: sem isso, o aparelho continua rodando o JavaScript antigo e
nada muda, por mais que você publique.

- **PC:** abrir o site e pressionar `Ctrl + Shift + R`
- **Celular:** fechar a aba do app, reabrir, puxar a tela para baixo para recarregar

Faça em **todos** os aparelhos que vão operar.

**Como confirmar que o aparelho atualizou** — abra o console (F12 no PC) e rode:

```
jrDiagnosticoSync()
```

O campo `buildSync` tem que dizer **`sync-4.7.9`**. Se disser outra coisa, ou se
a função não existir ("is not defined"), aquele aparelho ainda está no código
antigo — repita o refresh até aparecer. Não siga para o passo 5 antes disso.

## PASSO 5 — Zerar os dados de treinamento

Ainda há dados de teste no banco. Decida o que é real antes de abrir a operação:

| Tabela | Linhas hoje | Provavelmente |
|---|---|---|
| `veiculos` | 89 | frota real — **manter** |
| `ajudantes` | 38 | equipe real — **manter** |
| `controle_viagens` | 15 | treinamento — avaliar |
| `usuarios` | 8 | avaliar um a um |
| `motoristas` | 2 → **39** | os 2 atuais são de teste; os 39 reais entram no primeiro sync após a migração 24 |
| `cargas` | 1 | treinamento |

Em **um único aparelho**, use **Reset Global de Treinamento** no app. Ele limpa
local **e** nuvem, preserva os cadastros mestre (motoristas, veículos, ajudantes,
clientes, produtos, usuários) e agora grava um **carimbo de reset** na nuvem.

Depois do reset, recarregue os outros aparelhos (`Ctrl + Shift + R`). Eles leem
o carimbo, reconhecem que o vazio é proposital e limpam o próprio cache.

> **Por que isso importa:** na primeira tentativa, as viagens apagadas no reset
> voltaram nos dois aparelhos. O aparelho que ainda tinha os 15 registros no
> cache não tinha como saber se a tabela vazia na nuvem significava "alguém
> apagou" ou "o envio nunca funcionou" — e reenviava. O carimbo elimina a
> dúvida. Ele só existe depois da migração 23; se o reset avisar que o carimbo
> não foi gravado, a 23 não rodou.

## PASSO 6 — Teste de aceite (obrigatório, 5 minutos)

Com dois aparelhos, na mesma conta ou em contas diferentes:

1. No **aparelho A**: abra uma Devolução SAC completa, com item e foto
2. Confira o indicador no cabeçalho: deve estar **🟢 Nuvem Ativa**
   - Se aparecer **🔴 Dados NÃO salvos na nuvem**, PARE. Passe o mouse em cima
     para ler o erro, ou abra o console (F12) e rode `jrDiagnosticoSync()`
3. Aguarde até 40 segundos
4. No **aparelho B**: recarregue. A devolução deve aparecer
5. No aparelho B, faça o Retorno Físico dessa mesma devolução
6. No aparelho A: recarregue. A alteração deve aparecer

Se os 6 passos passarem, a sincronização está funcionando de verdade.

---

## Decisões que ficaram em aberto

### 1. Badge "Modo Treinamento"

`js/config.js` tem `dataInicioProducao: "2026-08-26"`. Se a operação real começa
antes disso, o cabeçalho vai exibir "🧪 Modo Treinamento" — é só informativo, não
bloqueia nada, mas confunde. Ajuste a data para o dia real de início.

### 2. Segurança do banco (tratar na primeira semana)

A policy atual é `FOR ALL TO anon USING (true)` e a chave está no JavaScript
público. Na prática: **qualquer pessoa com o endereço do site pode ler, alterar
e apagar o banco inteiro**, sem senha. A senha de administrador do app protege
as telas, não o banco.

Isso não impede o go-live, mas precisa entrar no plano — o caminho é Supabase
Auth com policies por usuário, substituindo o acesso anônimo.

### 3. Listas de Carga e Produto aparecendo como texto livre

O campo "Número da Carga" e o campo de Produto na Devolução são `<input list=...>`:
viram texto livre quando a lista por trás está vazia. Não é um defeito do campo.

- **Carga:** a lista vem de Cargas + Controle de Viagens + ocorrências anteriores.
  O Reset Global zera tudo isso de propósito — a lista volta assim que a Largada
  do dia for lançada.
- **Produto e Cliente:** são **dados estáticos da planilha Dados SAC** (4.010
  produtos e 15.139 clientes), embarcados no próprio app via `mockData.js` e
  guardados na chave `jr_sac_static`, separada de `jr_sac_db`. Já vêm iguais em
  todo aparelho — **não passam pela sincronização, e não devem passar.**

  Se a lista aparecer vazia ou a tela de Cadastros der erro vermelho, não é a
  planilha que sumiu: é o cache da tela. Um `Ctrl + Shift + R` recarrega de
  `jr_sac_static` e resolve. Corrigido em 22/08/2026 — o pull estava
  substituindo `db.data` inteiro pela fatia operacional e derrubando as duas
  listas da memória a cada ciclo.

  **Limitação conhecida:** um produto ou cliente cadastrado pela tela do app
  fica só naquele aparelho. Para todos verem, ele precisa entrar na planilha
  Dados SAC. Sincronizar essas duas listas exigiria um envio incremental (só o
  que mudou) — enviar 19 mil linhas a cada 30 segundos não é viável.

### 4. Edição simultânea

A sincronização é por tabela inteira, a cada 30 segundos, e vale o último que
gravou. Se duas pessoas editarem **a mesma devolução** dentro da mesma janela de
30s, uma sobrescreve a outra sem aviso. Para o volume atual isso é aceitável;
vale combinar com a equipe que cada ocorrência tem um dono.

---

## Se algo der errado amanhã

O sistema **não perde dados** por falta de sincronização: tudo é gravado no
aparelho primeiro. Se a nuvem recusar, o dado continua lá e o indicador fica
vermelho.

1. Indicador vermelho → F12 → `jrDiagnosticoSync()` → mostra a tabela e o erro exato
2. Erro com `PGRST204` → falta uma coluna no banco; a mensagem diz qual
3. Erro com `23503` → chave estrangeira; a migração 22 deveria ter removido
4. Erro `401` / `403` → chave ou policy do Supabase

Enquanto isso, a operação continua normalmente em cada aparelho — só não
compartilha até resolver.
