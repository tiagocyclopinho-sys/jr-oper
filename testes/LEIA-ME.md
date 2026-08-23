# Testes das Ondas 1+2

Conferem, sem navegador e **sem encostar na nuvem de verdade**, o que foi
entregue na rodada de 22/08/2026 (versão `sync-4.8.0`). Cada arquivo simula um
navegador (localStorage, document, fetch) e roda o código real de
`js/cloudStore.js`, `js/store.js` e do bloco da tela de Aparelhos em
`js/app.js`.

**Nenhum deles acessa o Supabase.** O `fetch` é falso em todos.

## Como rodar

Precisa do Node.js instalado (já está nesta máquina). Na pasta do app:

```bash
node testes/01_paginacao_e_guarda.js
```

Um por vez, ou todos:

```bash
for t in testes/*.js; do node "$t" | tail -1; done
```

O esperado, em cada um, é a última linha dizer **TODOS OS TESTES PASSARAM**.

## O que cada um cobre

| Arquivo | Itens | O que prova |
|---|---|---|
| `01_paginacao_e_guarda.js` | 4, 7 | Lê 1.200 linhas inteiras em blocos de 500; falha no meio devolve nada em vez de lista truncada; tabela sem `id` recua para a leitura antiga; a guarda aceita data ISO/`dd/mm/aaaa`/vazio e recusa `INICIADO`/`NÃO INICIADO` |
| `02_envio_mesclagem_exclusao.js` | 1, 2, 3 | Sobe só o registro alterado; edição local não enviada sobrevive ao pull; exclusão feita em outro aparelho entra e não volta; registro apagado na nuvem não ressuscita; registro que nunca subiu não some; envio recusado continua pendente |
| `03_janela_e_alarme.js` | 5, 6 | Poda o que passou de 90 dias e **só** o que a nuvem já confirmou; entende os dois formatos de `id`; gravação que falha vira tarja na tela e alerta, e limpa quando volta a funcionar |
| `04_aparelhos_e_atualizacao.js` | 9, 11, 12 | 500 ids seguidos sem repetir e sem bater com os de outro aparelho no mesmo milissegundo; a tela de Aparelhos em cada estado; a auto-atualização recarrega uma vez e não entra em laço; o painel de resquício desenha em cada estado e escapa o conteúdo do registro |
| `05_resquicio_de_cache.js` | detector (23/08) | Acusa o lançamento salvo que ficou fora do espelho e prevê que o pull o apaga; não acusa aparelho em dia nem espelho inexistente; rastreia um registro pelas cinco camadas por placa ou id, e o veredito bate com o estado |
| `06_pull_nao_apaga_lancamento.js` | correção (23/08) | O pull deixa de apagar lançamento recém-salvo quando outro aparelho manda algo na mesma tabela; funciona com e sem `window.db`; e NÃO desfaz nada do que veio antes — exclusão de outro aparelho entra, Reset Global remoto é aceito, nuvem vazia sem reset não apaga, edição local não enviada vence; o contador de fantasmas conta a fatia operacional |
| `07_sla_dos_alertas.js` | SLA (23/08) | A idade da mais antiga e o semaforo em cada faixa; frota (4h/8h) e administrativo (24h/48h) nao se confundem; acha a data em campo alternativo e, em ultimo caso, no relogio do `id`; id semeado ou pequeno NAO vira SLA inventado; sem data, a linha diz "sem data" em vez de sumir |

## Duas armadilhas do ambiente, para quem for mexer aqui

- **`navigator` do Node é somente leitura.** Um `global.navigator = {...}`
  falha calado e o teste passa a ler o user agent do próprio Node. Use
  `Object.defineProperty(globalThis, 'navigator', {...})`.
- **`class` declarada dentro de um `eval` não existe fora dele.** Por isso os
  testes chegam na classe por `window.cloudStore.constructor`, e não pelo nome
  `CloudStore`.

## O que estes testes **não** provam

São testes de bancada. Eles não substituem abrir o app de verdade contra a
nuvem de verdade — em especial o comportamento com dois aparelhos ao mesmo
tempo, que é onde os defeitos desta rodada nasceram. Antes de qualquer teste
local apontando para o Supabase de produção, leia o procedimento de segurança:
`js/config.js` tem credencial de produção, e abrir o app numa sessão limpa
dispara envio automático.
