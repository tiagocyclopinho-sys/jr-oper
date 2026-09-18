-- =============================================================================
-- MIGRATION 47 - FOTO NO ITEM AVULSO DA DESTINACAO (6.7.3, 18/09/2026)
--
-- Pedido do CD em 18/09/2026, no mesmo dia da limpeza inicial da Destinacao
-- (database/limpeza_destinacao_itens_cd.sql): os 111 itens vao ser relancados
-- como avulsos, e o item avulso e avaria identificada no CD SEM chamado de
-- devolucao - a foto e a unica prova que existe dele. Ate aqui o item avulso
-- nao tinha onde guardar foto nenhuma.
--
-- O DESENHO E O DA MIGRATION 38 (devolucao), SEM NADA NOVO:
--   - a foto vai para o IndexedDB do aparelho como Blob e sobe para o Storage
--     quando ha rede; o Postgres guarda so o CAMINHO e um contador de
--     pendentes. Nada de base64 em coluna, nada no localStorage.
--   - NAO HA BUCKET NOVO. A foto do avulso mora no bucket devolucoes-fotos,
--     na pasta avulsos/<id>/foto/... . O primeiro segmento do caminho e o
--     que diz de qual bucket a foto e (js/fotoStore.js, _bucketDoCaminho),
--     entao basta a tabela FOTO_BUCKETS conhecer 'avulsos'. As policies da
--     38 (SELECT e INSERT liberados, DELETE ausente = negado) ja cobrem.
--   - Foto OPCIONAL, como na devolucao (decidido em 18/09/2026). Sem CHECK.
--
-- POR QUE atualizado_em ENTRA JUNTO
-- A tabela nasceu sem carimbo (20/08/2026). Ate hoje nao doeu porque o avulso
-- era gravado uma vez e nunca mais editado. Com foto ele passa a ser editado
-- DEPOIS de criado, por outro caminho e outro instante: o caminho da foto e
-- gravado quando o upload termina, 30 segundos ou 3 dias depois. Sem carimbo,
-- o pull decide so por hash, e um aparelho com a copia velha em cache devolve
-- fotos_paths = [] por cima do caminho recem-gravado - a foto fica orfa no
-- bucket (que nega DELETE) e o registro, sem prova. E a mesma historia da
-- senha da Adriana (migration 46), e leva a mesma guarda BEFORE UPDATE.
--
-- ORDEM DE APLICACAO - IMPORTA, pelo motivo da 38:
--   1. Esta migration (so acrescenta; o app 6.7.2 continua funcionando).
--   2. SO DEPOIS o deploy do app 6.7.3. Ao contrario, o app mandaria tres
--      colunas que a API nao conhece e o PostgREST derrubaria o LOTE inteiro
--      de itens_avulsos_destinacao com PGRST204 - e a tabela nao tem lista
--      branca em COLUNAS_POR_TABELA (a projecao nao sabe JSONB, e
--      divisoes_destino e fotos_paths sao JSONB).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) COLUNAS
-- -----------------------------------------------------------------------------
-- NULLABLE com default, pelo motivo da 34/38: cloudStore.upsert() normaliza o
-- lote preenchendo com NULL as chaves ausentes em algum objeto. Uma coluna
-- NOT NULL faria um registro antigo em cache derrubar o LOTE TODO com 400.
-- estadoFotos() no app trata NULL como lista vazia.
alter table itens_avulsos_destinacao
  add column if not exists fotos_paths     jsonb     default '[]'::jsonb,
  add column if not exists fotos_pendentes integer   default 0,
  add column if not exists atualizado_em   timestamp,
  -- data_negociacao NAO e da foto. Achado ao conferir a tabela para esta
  -- migration: atualizarStatusNegociacaoItem() (app.js) grava
  -- data_negociacao tambem no item AVULSO desde a auditoria de 17/08/2026,
  -- e a coluna so existe em itens_devolucao. Ninguem trocou o status de um
  -- avulso ate hoje (havia 0 ativos); o primeiro que trocasse derrubaria o
  -- lote inteiro da tabela com PGRST204, calado. Com 111 itens prestes a
  -- ser relancados como avulsos, isso ia acontecer na primeira semana.
  add column if not exists data_negociacao timestamptz;

comment on column itens_avulsos_destinacao.fotos_paths is
  'Caminhos no bucket devolucoes-fotos, pasta avulsos/<id>/foto/. A imagem NAO mora no Postgres.';
comment on column itens_avulsos_destinacao.fotos_pendentes is
  'Quantas fotos ainda estao so no IndexedDB do aparelho que fotografou, aguardando rede. > 0 = a prova existe mas ainda nao subiu.';
comment on column itens_avulsos_destinacao.atualizado_em is
  'Carimbo do app (Store#carimbarEdicao). Desempate do pull e guarda BEFORE UPDATE (migration 47).';

-- -----------------------------------------------------------------------------
-- 2) GUARDA DO CARIMBO
-- -----------------------------------------------------------------------------
-- Reusa jr_recusar_carimbo_regressivo() da migration 46: UPDATE que traga
-- atualizado_em NULL ou mais velho que o gravado e descartado em silencio.
-- Registro antigo (atualizado_em ainda NULL no banco) passa - a guarda so
-- age quando OLD ja tem carimbo.
drop trigger if exists trg_itens_avulsos_guarda_carimbo on itens_avulsos_destinacao;
create trigger trg_itens_avulsos_guarda_carimbo
  before update on itens_avulsos_destinacao
  for each row
  execute function jr_recusar_carimbo_regressivo();

-- -----------------------------------------------------------------------------
-- 3) CACHE DE ESQUEMA DO POSTGREST
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- Conferencia (esperado: 4 linhas)
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_name = 'itens_avulsos_destinacao'
--    and column_name in ('fotos_paths','fotos_pendentes','atualizado_em','data_negociacao');
