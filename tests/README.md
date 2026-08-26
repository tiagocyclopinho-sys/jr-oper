# Testes dos Cadastros Mestres, da Sincronização, do Menu, dos Departamentos e da Mídia

Seis scripts Node sem dependência nenhuma — não precisa `npm install`.
Rode da pasta raiz do projeto:

```bash
node tests/teste_cadastros.js
node tests/teste_sync.js
node tests/teste_boletim_e_tipoerro.js
node tests/teste_menu.js
node tests/teste_departamentos.js
node tests/teste_midia_devolucao.js
```

Todos devem terminar com `0 falharam`. Saem com código 1 se algo quebrar,
então servem direto num pipeline de CI se um dia houver um.

> **Estado em 26/08/2026:** `teste_boletim_e_tipoerro`, `teste_menu` e
> `teste_midia_devolucao` passam. Os outros três falham por terem ficado para
> trás do código, e não por regressão — `teste_cadastros` espera que
> `addMotivoDevolucao()` devolva `{success, message}` (hoje devolve a string
> ou `null`), `teste_departamentos` chama `db.getRoleDoDepartamento()` (não
> existe em `js/store.js`) e `teste_sync` espera envio das tabelas `clientes`
> e `produtos`. Vale alinhar teste e código quando alguém encostar nessas
> áreas.

## O que cada um cobre

**`teste_cadastros.js`** — carrega `js/store.js` num sandbox com um
`localStorage` falso e exercita as telas de cadastro:

- o motivo de devolução devolve `{ success, message }` em vez da string que
  causava o `alert(undefined)` de 23/08/2026;
- exclusão de motivo/rota devolve resultado tratado (antes estourava
  `TypeError`) e deixa a "lápide" que faz a exclusão viajar entre aparelhos;
- cliente e produto realmente persistem em `jr_sac_static` e sobrevivem ao
  F5 — antes ficavam só na memória e sumiam ao recarregar;
- excluir um cliente não faz o catálogo inteiro ser trocado pela planilha na
  próxima abertura (o que apagava todo cadastro manual feito desde então);
- motorista, ajudante e veículo não abrem mais `alert()` de dentro do store.

**`teste_sync.js`** — carrega `js/cloudStore.js` contra um PostgREST
simulado, com o mesmo limite de 1.000 linhas por leitura do Supabase:

- rotas, motivos, clientes e produtos são de fato enviados (as quatro abas
  que nunca chegavam ao banco);
- listas de texto viram linhas `{nome, ativo}` e voltam como array de texto;
- exclusão feita num aparelho chega no outro em vez de "voltar sozinha";
- campos que só existem no app (`codigo`, `nome`) são removidos antes do
  envio, senão o PostgREST recusa o lote inteiro com PGRST204;
- envio em lotes de 500 e leitura paginada;
- o push não gasta requisição quando nada mudou;
- uma nuvem menor que o aparelho (envio incompleto) não apaga o catálogo
  local.

**`teste_boletim_e_tipoerro.js`** — extrai do `js/app.js` real os blocos do
filtro de período e da lista de Tipo de Erro e os avalia isolados (o arquivo
tem ~22 mil linhas e toca no DOM na carga, então não dá para carregá-lo
inteiro no Node; se um bloco for renomeado, a extração falha e o teste
acusa):

- devolução de 23/08 fica fora do período 01/08–22/08 — inclusive prova, com
  o código antigo lado a lado, que o filtro do Dashboard aprovava a mesma
  devolução até num período de janeiro;
- Dashboard, Boletim e o PDF executivo passaram a concordar sobre o mesmo
  intervalo;
- coleções que já filtravam certo (ocorrência de viagem, troca de veículo,
  resumo do CD) não mudaram de comportamento;
- registro sem data nenhuma continua aparecendo, em vez de sumir de todas as
  telas;
- `OUTRO` saiu da lista de Tipo de Erro e `ERRO CLIENTE` entrou, com a lista
  vindo de um único lugar;
- análise antiga classificada como `OUTRO` mantém o valor no campo, marcada
  como categoria antiga, em vez de abrir em branco e forçar reclassificação.

## Importante

Os testes usam um `INITIAL_DATA` reduzido, não o `js/mockData.js` real (3 MB).
Eles validam a lógica, não o volume. Para conferir volume, use os `SELECT`
listados no fim de `database/migration_25_cadastros_mestres.sql`.

**`teste_menu.js`** — extrai `NAV_GRUPOS`, `navPapelDoUsuario()` e
`navItemVisivel()` do `js/app.js` e cobre o menu agrupado:

- toda tela do menu tem um `case` correspondente no `renderApp()` — sem isso
  o clique cai no `default` e abre o Dashboard sem avisar;
- as 14 telas do menu antigo continuam todas presentes, e o Dossiê do
  Motorista e o Acompanhamento do Funcionário (que existiam prontos e não
  tinham entrada nenhuma) agora têm;
- os valores das 5 sub-abas de Controle de Viagens batem com os que o
  `switchViagensSubTab()` realmente usa;
- o `role` gravado no cadastro vence o departamento, e `role` inválido não
  é aceito;
- os departamentos que a `mapDeptToRoleAndCargo()` não reconhece
  ("GERÊNCIA GERAL", "SUPERVISÃO", "COMERCIAL"...) fazem o menu **falhar
  aberto** em vez de rebaixar a gerência para SAC;
- nenhum papel fica sem menu, telas de Administração não vazam para papel
  operacional, e "Ver todas as telas" devolve o menu inteiro a qualquer um.

**`teste_departamentos.js`** — roda `js/store.js` num sandbox e extrai a
`mapDeptToRoleAndCargo()` do `js/app.js`. Cobre o cadastro de departamentos:

- os nomes que só existiam na lista de "Logins e Senhas" (`GERÊNCIA GERAL`,
  `GERÊNCIA OPERACIONAL`, `SUPERVISÃO`) deixam de ser rebaixados para `SAC`;
- os que já funcionavam continuam iguais — `COMERCIAL` e `COMPRAS` seguem em
  `SAC`, que é o que recebem hoje, para não conceder acesso sem decisão;
- a migração é idempotente: não duplica, não desfaz mudança do admin e não
  ressuscita departamento desativado;
- CRUD completo, com recadastro de desativado reativando em vez de duplicar
  (senão o envio mandaria a mesma chave primária duas vezes);
- desativar departamento que ainda tem usuário ativo é bloqueado, e a
  mensagem diz quem está lá;
- o app consulta o cadastro **antes** da heurística por nome, e departamento
  fora do cadastro ainda cai na heurística (caso do "OUTRO" no autocadastro);
- `departamentos` está nas listas de envio e leitura do `cloudStore`, com
  `role` e `ativo` na whitelist — senão o cadastro viveria num aparelho só;
- nenhuma FK aponta para `departamentos` (`usuarios` sobe antes; FK aqui
  repetiria o erro da migração 22);
- o `INSERT` da migração 26 e a semeadura do JavaScript atribuem **o mesmo
  papel a cada departamento** — se alguém mudar um dos dois lados, quebra.

**`teste_midia_devolucao.js`** — exclusão de mídia da ocorrência e poda do
histórico de versões (leva de 26/08/2026), em 8 blocos:

- `excluirMidiaDevolucao()` remove o item certo e re-sincroniza os aliases
  legados `foto_url` / `video_url` / `video_investigacao_url` — sem isso a
  foto "excluída" reaparecia em toda tela que lesse o alias;
- recusa campo fora da lista branca, ocorrência inexistente e índice inválido,
  e enxerga o registro legado que só tem o alias, sem o array;
- a trilha em `audit_logs` guarda quem/quando/qual item/quantos sobraram e
  **não** guarda o base64 excluído — é ela que autoriza "todos podem excluir";
- apagar anexo não reabre a tratativa do gestor (`status_gestao` intacto);
- `saveVersion()` não copia mais o base64 para `registro_versoes`, e
  `rollbackVersion()` preserva a mídia atual em vez de restaurar a do snapshot;
- a galeria monta o 🗑️ com campo e índice certos e carrega os marcadores
  `data-galeria-*` que permitem redesenhá-la sem `renderApp()`;
- a coleta de mídia do modal "Ver Ocorrência Completa" enxerga os quatro
  campos reais (antes mostrava 1 foto e 1 vídeo de uma ocorrência com 6 e 2).
