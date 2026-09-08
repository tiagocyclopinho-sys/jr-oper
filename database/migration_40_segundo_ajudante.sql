-- =============================================================================
-- MIGRATION 40 - SEGUNDO AJUDANTE (VIAGEM E REENTREGA)
--
-- Algumas rotas saem com DOIS ajudantes. controle_viagens.ajudante e uma vaga
-- so, entao o segundo nunca existiu para o sistema - e o rateio do
-- adiantamento dividia por 2 quando devia dividir por 3. Duas pessoas pagavam
-- a parte de tres.
--
-- A dupla MUDA POR DIA, conforme demanda e disponibilidade: isto e informacao
-- de cada viagem, nao configuracao de rota. Por isso coluna na viagem, e nao
-- tabela de rota.
--
-- REENTREGA ENTRA JUNTO, e por um motivo que so apareceu ao conferir a tela:
-- o formulario de reentrega TEM um campo Ajudante, a pessoa escolhe o nome,
-- salva - e o nome e descartado em silencio. Nao havia coluna no banco, e
-- addReentrega()/updateReentrega() nunca copiaram o campo (a whitelist de
-- updateReentrega descarta calado o que nao esta listada nela, como o proprio
-- comentario dela avisa). O campo existia na tela e em lugar nenhum alem dela.
-- Por isso aqui entram DUAS colunas na reentrega, nao uma: a que faltava desde
-- sempre, e a nova.
--
-- GUARDA NOME, NAO ID - de proposito. Decidido em 07/09/2026: o recibo do
-- adiantamento passa a perguntar ao Controle de Viagens "quem estava nessa
-- viagem?" em vez de procurar o numero do ajudante no cadastro. O nome e o que
-- a escala tem, o que o recibo imprime e o que a pessoa assina; o id era
-- justamente o elo que vivia quebrado (12 cargas de 29 sem ele em 07/09/2026).
-- E o mesmo formato que controle_viagens.ajudante ja usa hoje.
--
-- ADITIVA E REVERSIVEL: nada do que esta gravado muda. Viagem sem segundo
-- ajudante fica com a coluna vazia e se comporta exatamente como hoje. Voltar
-- para a versao anterior do app nao exige desfazer nada aqui.
--
-- ORDEM - IMPORTA: esta migration PRIMEIRO, o deploy da v6.6.0 DEPOIS.
-- =============================================================================

-- 1) CONTROLE DE VIAGENS ------------------------------------------------------
-- NULLABLE e sem default, pelo motivo das migrations 38 e 39:
-- cloudStore.upsert() normaliza o lote preenchendo com NULL as chaves
-- ausentes. Uma coluna NOT NULL faria um registro antigo em cache derrubar o
-- LOTE TODO com 400.
alter table controle_viagens
  add column if not exists ajudante_2 varchar(120);

comment on column controle_viagens.ajudante_2 is
  'Segundo ajudante da viagem, quando houver. NOME (nao id), escolhido da lista '
  'do cadastro na tela de editar viagem. Vazio e o caso normal.';

-- 2) REENTREGA ----------------------------------------------------------------
-- ajudante (a que faltava) e ajudante_2 (a nova). A tabela e reentregas_rota.
alter table reentregas_rota
  add column if not exists ajudante   varchar(120),
  add column if not exists ajudante_2 varchar(120);

comment on column reentregas_rota.ajudante is
  'Ajudante da reentrega. A tela ja coletava este campo desde sempre e o '
  'sistema o descartava em silencio por nao existir coluna nem gravacao.';
comment on column reentregas_rota.ajudante_2 is
  'Segundo ajudante da reentrega, quando houver. NOME, mesmo criterio da viagem.';

-- 3) CACHE DE ESQUEMA DO POSTGREST --------------------------------------------
-- Sem isto o PostgREST continua servindo o esquema em cache e RECUSA as
-- colunas novas, mesmo elas ja existindo.
notify pgrst, 'reload schema';

-- =============================================================================
-- CONFERENCIA - rode DEPOIS, e espere 3 linhas com existe = true:
--
-- select 'controle_viagens.ajudante_2' as coluna,
--        exists (select 1 from information_schema.columns
--                 where table_name = 'controle_viagens' and column_name = 'ajudante_2') as existe
-- union all
-- select 'reentregas_rota.ajudante',
--        exists (select 1 from information_schema.columns
--                 where table_name = 'reentregas_rota' and column_name = 'ajudante')
-- union all
-- select 'reentregas_rota.ajudante_2',
--        exists (select 1 from information_schema.columns
--                 where table_name = 'reentregas_rota' and column_name = 'ajudante_2');
-- =============================================================================
