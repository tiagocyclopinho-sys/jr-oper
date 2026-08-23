# Plano de Execução Técnico — Melhoria de UI/UX e Modelagem de Dados
### Sistema JR SAC & Gestão Logística Corporativa

Documento elaborado a partir da leitura direta do código do projeto (`index.html`, `js/app.js`, `js/store.js`, `js/cloudStore.js`, `js/config.js`, `database/schema.sql` e migrações 22–24, `GO_LIVE.md`) e da planilha `Dados SAC.xlsx`. Todas as recomendações abaixo respeitam a regra de **zero breaking changes**: nenhuma tabela é removida, nenhuma coluna existente muda de tipo ou é apagada, e nenhum contrato de sincronização (`cloudStore.js`) é alterado sem uma transição de compatibilidade.

---

## 0. Diagnóstico de base (o que o código mostra hoje)

- **Stack real**: SPA em JavaScript puro, sem build/framework — `index.html` carrega `js/app.js` (1,3 MB), `js/store.js` (130 KB) e `js/cloudStore.js` (46 KB) diretamente. Tailwind é carregado via CDN (`js/tailwind.cdn.js`), sem arquivo de configuração — ou seja, não existe hoje uma escala de breakpoints própria do projeto, só o padrão do Tailwind.
- **Sincronização**: `cloudStore.js` faz *pull* e *push* de mais de 20 tabelas inteiras a cada 30 segundos (`syncIntervalMs`), sempre a tabela completa (`getAll` sem filtro incremental), regra "quem grava por último vence". O `GO_LIVE.md` já documenta que essa reescrita completa foi a causa de pelo menos dois bugs sérios corrigidos nesta semana (perda de `db.data.produtos`/`clientes` da memória a cada pull; devoluções "ressuscitadas" após Reset Global).
- **Cadastros Mestres hoje**: `produtos` (4.010 linhas) e `clientes` (15.139 linhas) da planilha `Dados SAC.xlsx` **não vêm do Supabase** — estão embarcados em `js/mockData.js` (3,1 MB) e guardados em `localStorage` na chave `jr_sac_static`, separada da chave operacional `jr_sac_db`. Existem tabelas `produtos`/`clientes` no `schema.sql`, mas hoje ficam quase vazias — cada aparelho usa sua cópia estática local, nunca a nuvem.
- **Campos de texto livre**: há 183 ocorrências de `<input list=...>`/`<datalist>`/`<select>` no `app.js` — ou seja, grande parte já tenta usar sugestão de lista, mas o próprio `GO_LIVE.md` (seção "Decisões que ficaram em aberto", item 3) confirma que Carga e Produto "viram texto livre quando a lista por trás está vazia" — não é um defeito pontual, é o comportamento padrão do HTML nativo quando a lista de apoio não carregou.
- **Busca hoje**: 56 ocorrências de busca via `.toLowerCase().includes(...)` no cliente — nenhuma chamada a `ilike` no Supabase, nenhuma função de debounce no projeto (0 ocorrências). A busca nos 19 mil registros estáticos já acontece em memória (rápida), mas sem índice pré-normalizado nem debounce, então cada tecla digitada refaz o trabalho inteiro.
- **Segurança (fora do escopo deste plano, mas documentada)**: RLS liberado para `anon` em todas as tabelas (`FOR ALL TO anon USING (true)`), com a *anon key* pública no JavaScript. O próprio `GO_LIVE.md` já sinaliza isso como dívida técnica da primeira semana pós-go-live — mantenho essa recomendação, mas trato como projeto separado, pois mexer em RLS pode quebrar o fluxo atual e o pedido explícito é zero breaking changes.

---

## Fase 1 — Auditoria e Correção de UI/UX (Responsividade)

**Hipótese confirmada pelo código**: a perda de responsividade não veio da estilização em si (o Tailwind e as 292 classes responsivas continuam no `app.js`), veio do **ciclo de sincronização re-renderizando telas inteiras**. Cada `pull` que encontra mudança dispara `window.dispatchEvent(new CustomEvent('jr-cloud-sync', ...))`, e hoje várias telas provavelmente reagem a esse evento chamando a função de render completa da tela (`innerHTML =`, 69 ocorrências), não apenas da lista de dados. Isso explica sintomas típicos de "responsividade quebrada": perda de posição de rolagem, colapso de grid/flex a cada 30s, campo perdendo foco durante digitação, modal fechando sozinho.

1. **Instrumentação e confirmação** — adicionar log temporário no listener de `jr-cloud-sync` em cada uma das 4 telas departamentais (SAC, CD, Financeiro, Frota) para confirmar qual função de render é disparada a cada ciclo. Usar o navegador (Claude in Chrome) para comparar o DOM antes/depois de um ciclo de sync e registrar o que muda além dos dados.
2. **Escopo de re-render** — separar, para cada tela, a função `renderTela()` (estrutura, grid, cabeçalho) da função `renderLista()`/`renderCards()` (dados). O listener de `jr-cloud-sync` passa a chamar só a segunda. Isso preserva scroll, modais abertos e foco de campo — sem alterar nenhuma estrutura de dado ou nome de evento existente.
3. **Padronização de breakpoints** — como o Tailwind vem só via CDN, adicionar um bloco `tailwind.config = { theme: { screens: {...} } }` inline no `index.html` antes do script do CDN, fixando uma única escala (`sm/md/lg/xl`) usada em todo o app. Hoje a ausência dessa config faz o CDN usar o padrão genérico, o que é inconsistente entre telas escritas em momentos diferentes do projeto.
4. **Estados de carregamento sem colapso de layout** — reservar altura mínima (skeleton/spinner com `min-height`) nos containers que dependem de `jr_sac_static`/`jr_sac_db` ainda carregando, evitando o "pulo" de layout characteristico de telas que nascem vazias e só populam depois.
5. **Campos de lista em mobile** — o `<input list>`/`<datalist>` nativo tem comportamento inconsistente em Safari iOS e teclados Android. Ele será substituído por um componente de combobox próprio nas Fases 4 e 5 — o que resolve responsividade e a exigência de "não digitação livre" ao mesmo tempo.
6. **Disciplina de zero breaking change**: cada ajuste desta fase é puramente visual/estrutural — nenhuma mudança em `cloudStore.js`, nos nomes de chave de `localStorage` ou no formato dos dados enviados ao Supabase.

---

## Fase 2 — Reaproveitamento de Componentes e Cache de Dados

1. **Extrair templates repetidos** — o `app.js` de 1,3 MB é sintoma de duplicação: cada uma das 4 telas departamentais provavelmente reimplementa cartão de KPI, tabela paginada e modal de detalhe de forma independente. Levantamento e consolidação em funções utilitárias únicas (`renderCard(config)`, `renderTabela(config)`, `renderModal(config)`), mantendo o HTML final idêntico ao atual para não quebrar nenhum seletor usado por outra parte do código.
2. **Sincronização incremental em vez de tabela inteira** — hoje `getAll(tableName)` sempre busca `select=*` sem filtro, e isso se repete a cada 30s para mais de 20 tabelas. A maioria das tabelas transacionais já tem `atualizado_em`/`criado_em`. Proposta: guardar por tabela o timestamp do último pull bem-sucedido (`localStorage`, ex. `jr_last_pull_<tabela>`) e, quando existir, buscar com `&atualizado_em=gt.<timestamp>` — reduzindo o payload de rede a cada ciclo para só o que mudou. É uma otimização aditiva: se a coluna de timestamp não existir numa tabela específica, cai automaticamente no comportamento atual (`select=*` completo), sem quebra.
3. **Cache dos catálogos estáticos** — `produtos`/`clientes` (Fase 3) devem ser carregados uma única vez por sessão de app (não a cada abertura de tela), com as opções de `<datalist>`/combobox pré-computadas e reaproveitadas entre todas as telas que os usam (Devolução SAC, Cadastros, Relatórios), evitando recomputar 19 mil linhas repetidamente.
4. **Memoização de listas derivadas** — funções que hoje filtram arrays inteiros a cada render (ex. veículos ativos, motoristas ativos) passam a cachear o resultado e invalidar só quando o `jr-cloud-sync` sinalizar mudança naquela tabela específica.

---

## Fase 3 — Cadastros Mestres a partir da planilha "Dados SAC"

Abas confirmadas na planilha e o mapeamento proposto para o banco:

| Aba da planilha | Linhas | Tabela mestre proposta | Situação atual no schema |
|---|---|---|---|
| Motorista (Cód. ERP, Nome) | 39 | `motoristas` (existente) | falta coluna `codigo_erp`; hoje usa `cnh` como chave única, mas a planilha não tem CNH — causa raiz do bug da migração 24 |
| Ajudante (Cód. ERP, Nome) | 38 | `ajudantes` (existente) | mesmo problema: `cpf` é `UNIQUE`, mas a planilha não traz CPF |
| Veículo (Placa, Grupo, Situação) | 89 | `veiculos` (existente) | já tem `situacao` (adicionada na seção 10.7 do schema); falta só alinhar "Grupo de veículo" → `tipo` |
| Produto (CODPROD, DESCRICAO) | 4.010 | `produtos` (existente, subutilizada) | tabela existe mas hoje o app usa `mockData.js` embarcado em vez dela |
| Clientes (CODCLI, CLIENTE) | 15.139 | `clientes` (existente, subutilizada) | mesmo caso de `produtos` |
| Rota | 77 | `rotas` (**nova**) | hoje é `VARCHAR` livre em `cargas.rota`, `ocorrencias_devolucao.rota_nome`, `controle_viagens.rota` etc. |
| Motivo devolução | 63 | `motivos_devolucao` (**nova**) | hoje é `VARCHAR(120)` livre em `ocorrencias_devolucao.motivo_reclamado` |
| Motivo Ocorrência | 60 | `motivos_ocorrencia_rota` (**nova**) | hoje é texto livre nos campos de motivo/causa de `ocorrencias_viagens` |
| Separador-Conferente | 91 | mapear para `usuarios` (papel SAC) onde já existir cadastro; manter fallback de texto para quem ainda não é usuário do sistema | hoje `separador_apurado`/`conferente_apurado` são `VARCHAR` livres |

**Estratégia de migração (aditiva, sem quebra):**

1. **Script de carga** (`database/seed_dados_sac.py` ou `.js`) que lê cada aba da planilha (já está no repositório) e gera `INSERT ... ON CONFLICT (codigo_erp) DO UPDATE` idempotente, no mesmo padrão das migrações 22–24 já existentes — roda uma vez no SQL Editor do Supabase, pode ser repetido sem risco.
2. **Nova migração `database/migration_25_cadastros_mestres.sql`**: cria as 3 tabelas novas (`rotas`, `motivos_devolucao`, `motivos_ocorrencia_rota`) e adiciona colunas `*_id` (FK) **ao lado** das colunas de texto livre já existentes nas tabelas que hoje só têm o nome (ex. `ocorrencias_devolucao.rota_id INT REFERENCES rotas(id)`, mantendo `rota_nome` como está). RLS segue exatamente o padrão `acesso_total_anon` já usado em todas as outras tabelas, para não introduzir uma regra de acesso diferente do resto do sistema.
3. **Consolidação de produtos/clientes**: `js/mockData.js` deixa de ser a fonte única — passa a ser apenas o *fallback* offline inicial (primeira carga sem internet), e a fonte de verdade passa a ser a tabela Supabase, carregada uma vez por sessão e cacheada (Fase 2, item 3). Isso resolve de forma definitiva a limitação hoje documentada no `GO_LIVE.md`: "um produto ou cliente cadastrado pela tela do app fica só naquele aparelho" — com a tabela como fonte real, um cadastro feito num aparelho passa a existir para todos após o próximo pull.
4. **Transição em duas etapas por formulário**: cada tela que hoje grava só o campo de texto livre passa a gravar também o `*_id` correspondente (dual-write), resolvido a partir da seleção feita no combobox da Fase 4. Só depois de validado em produção — e não neste projeto — cogita-se tornar o texto livre somente leitura/derivado.

---

## Fase 4 — Uso de Dados Compartilhados via Validação (sem digitação livre)

1. **Troca de campo por campo**, priorizando os de maior impacto interdepartamental: Cliente, Produto, Motorista, Ajudante, Veículo, Rota, Motivo de Devolução, Motivo de Ocorrência. Cada `<input list="...">` correspondente é substituído por um combobox pesquisável (mesmo componente, ver Fase 5) que só aceita um item existente na lista mestre — sem opção de "texto livre" nesses campos específicos. Campos genuinamente livres (`detalhamento_texto`, `observacoes`, `acao_tomada`) **permanecem como estão**.
2. **A validação real é a Foreign Key, não um `CHECK` novo**: as tabelas já têm `produto_id`, `cliente_id`, `veiculo_id`, `motorista_id` como FK — o problema hoje é que o app preenche o campo de nome (`cliente_nome`) mas frequentemente deixa o `*_id` correspondente nulo, porque a tela grava a partir de texto digitado, não de uma seleção. Ajustar as funções de salvar no `app.js` para resolver o `id` do item selecionado no combobox e gravar tanto o `*_id` (novo, obrigatório após a transição) quanto o nome (mantido para exibição rápida e para os relatórios de BI que já dependem dele). A FK do Postgres passa a recusar automaticamente qualquer gravação fora da lista mestre — é exatamente a "regra de negação" pedida, sem precisar duplicar a validação em `CHECK` constraints.
3. **RLS**: as tabelas mestre continuam de leitura liberada para `anon` (necessário para os comboboxes carregarem em qualquer aparelho); nenhuma mudança de política é necessária para esta fase — a validação é garantida pela FK no momento da escrita.

---

## Fase 5 — Busca Parcial Inteligente

A situação é diferente para os dois tipos de dado, e a solução técnica reflete essa diferença:

1. **Catálogos estáticos (Produtos e Clientes, ~19 mil linhas)**: já vivem inteiros na memória do navegador (Fase 3), então a busca **não precisa ir ao Supabase** — isso evitaria latência de rede sem necessidade. Otimização: construir, uma única vez por sessão, um índice normalizado (`toLowerCase()` + remoção de acentos via `normalize('NFD')`) de cada linha, em vez de recalcular a cada tecla digitada. A busca por correspondência parcial ("silva" encontra "João da Silva", "ilv" também encontra) já é possível com `.includes()` sobre esse índice pré-computado — o ganho é de performance, não de funcionalidade nova.
2. **Dados transacionais no Supabase** (busca de devoluções por protocolo, cliente, motorista etc., quando a lista completa não está toda carregada no cliente): implementar busca server-side via PostgREST, usando `ilike` com curinga (`?numero_protocolo=ilike.*termo*` ou `or=(campo1.ilike.*termo*,campo2.ilike.*termo*)`). Para manter isso rápido em escala, adicionar ao `migration_25`:
   - `CREATE EXTENSION IF NOT EXISTS pg_trgm;` e `CREATE EXTENSION IF NOT EXISTS unaccent;`
   - Índices GIN trigram nas colunas mais buscadas (`numero_protocolo`, `cliente_nome`, `motorista_nome`, `descricao` de produtos) para que o `ilike '%termo%'` não vire *full scan* conforme o volume crescer.
3. **Debounce único e reutilizável**: criar uma função utilitária `debounce(fn, 300)` (hoje inexistente no projeto) e aplicá-la a todos os campos de busca — tanto os que buscam em memória quanto os que consultam o Supabase — evitando disparo de trabalho a cada tecla e reduzindo carga na Vercel/Supabase durante digitação.

---

## Sequenciamento e disciplina de "zero breaking changes"

| Ordem | Fase | Risco de regressão | Por quê |
|---|---|---|---|
| 1 | UI/UX (Fase 1) | Baixo | Mudança só de renderização, sem tocar em dado ou contrato de sync |
| 2 | Cache/Reuso (Fase 2) | Baixo–Médio | Sync incremental precisa de teste cuidadoso para não quebrar o fallback já existente (`select=*` continua como rede de segurança) |
| 3 | Cadastros Mestres (Fase 3) | Médio | Só cria tabelas/colunas novas; nada existente é alterado ou removido |
| 4 | Validação (Fase 4) | Médio–Alto | Muda o comportamento de gravação em formulários usados todo dia — recomenda-se rollout campo a campo, um formulário por vez, validado com o time antes do próximo |
| 5 | Busca (Fase 5) | Baixo | Aditivo (índices e função de debounce), não altera dado gravado |

Cada entrega deve passar pela mesma disciplina já usada no projeto: migração idempotente (`IF NOT EXISTS`/`ON CONFLICT`), teste de aceite em dois aparelhos como descrito no `GO_LIVE.md` (Passo 6), e confirmação do `buildSync` antes de generalizar para a equipe.

**Fora do escopo deste plano, mas registrado como dívida já identificada pelo próprio time**: a política de RLS totalmente aberta (`anon` com acesso total) e a chave pública exposta no JavaScript. Resolver isso exige Supabase Auth com policies por usuário — uma mudança que, por natureza, não é "zero breaking change" e merece projeto e planejamento próprios.
