-- =============================================================================
-- LIMPEZA DAS FOTOS EM BASE64 (colunas legadas da migration 31)
--
-- NAO E MIGRATION. Nao roda no deploy. Roda uma vez, com gente olhando, DEPOIS
-- de as fotos legadas terem subido para o Storage.
--
-- POR QUE PRECISA ACONTECER
-- Enquanto fotos_recebimento / fotos_despacho tiverem conteudo, elas voltam da
-- nuvem A CADA PULL, porque o pull monta select=* (js/cloudStore.js:320).
-- Parar de gravar base64 nao adianta sozinho: o que ja esta la continua
-- trafegando de 30 em 30 segundos, em todo aparelho. Sem esvaziar estas duas
-- colunas, o ganho da migration 34 simplesmente nao acontece para os registros
-- antigos.
--
-- COMO FAZER, NA ORDEM
--
--   1. Publique a v5.1.0 e abra o app num aparelho com rede boa.
--   2. Espere a sincronia trazer a nuvem inteira (o contador de registros para
--      de subir).
--   3. No console do navegador (F12), rode:
--
--          jrMigrarFotosLegado()
--
--      Isso poe cada foto base64 na fila do IndexedDB, esvazia a coluna legada
--      e assume a pendencia na MESMA gravacao (senao o CHECK do banco recusaria
--      o registro por um instante sem prova), e em seguida sobe tudo para o
--      Storage.
--   4. Confira que a fila zerou:  jrFotosPendentes()
--   5. Rode a CONFERENCIA abaixo. So se ela voltar zerada rode a limpeza.
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CONFERENCIA - rode ANTES. Precisa voltar tudo zero.
-- -----------------------------------------------------------------------------
-- Registros que ainda tem base64 no banco:
select
  count(*) filter (where jsonb_array_length(coalesce(fotos_recebimento, '[]'::jsonb)) > 0) as ainda_base64_recebimento,
  count(*) filter (where jsonb_array_length(coalesce(fotos_despacho,    '[]'::jsonb)) > 0) as ainda_base64_despacho,
  count(*) filter (where coalesce(fotos_recebimento_pendentes, 0) > 0)                     as pendentes_recebimento,
  count(*) filter (where coalesce(fotos_despacho_pendentes,    0) > 0)                     as pendentes_despacho,
  pg_size_pretty(sum(pg_column_size(fotos_recebimento) + pg_column_size(fotos_despacho))::bigint) as peso_das_colunas
from reentregas_rota;

-- E o mais importante: nenhum registro pode ficar SEM PROVA NENHUMA depois da
-- limpeza. Esta consulta lista quem perderia a unica foto que tem. Se voltar
-- qualquer linha, NAO rode a limpeza - a foto daquele registro nao subiu.
select id, carga_numero, rota_nome, status
from reentregas_rota
where status in ('RECEBIDO_CD', 'DESPACHADO')
  and jsonb_array_length(coalesce(fotos_recebimento,       '[]'::jsonb)) > 0
  and jsonb_array_length(coalesce(fotos_recebimento_paths, '[]'::jsonb)) = 0
  and coalesce(fotos_recebimento_pendentes, 0) = 0

union all

select id, carga_numero, rota_nome, status
from reentregas_rota
where status = 'DESPACHADO'
  and jsonb_array_length(coalesce(fotos_despacho,       '[]'::jsonb)) > 0
  and jsonb_array_length(coalesce(fotos_despacho_paths, '[]'::jsonb)) = 0
  and coalesce(fotos_despacho_pendentes, 0) = 0;

-- -----------------------------------------------------------------------------
-- LIMPEZA - so depois das duas consultas acima voltarem zeradas.
-- -----------------------------------------------------------------------------
-- Esvazia SOMENTE onde ja existe caminho no Storage. A condicao esta no WHERE
-- de proposito, e nao so na conferencia manual: um comando que se recusa a
-- apagar prova sem substituto e melhor que um comando que depende de alguem
-- ter lido o comentario.

-- update reentregas_rota
--    set fotos_recebimento = '[]'::jsonb
--  where jsonb_array_length(coalesce(fotos_recebimento,       '[]'::jsonb)) > 0
--    and jsonb_array_length(coalesce(fotos_recebimento_paths, '[]'::jsonb)) > 0;

-- update reentregas_rota
--    set fotos_despacho = '[]'::jsonb
--  where jsonb_array_length(coalesce(fotos_despacho,       '[]'::jsonb)) > 0
--    and jsonb_array_length(coalesce(fotos_despacho_paths, '[]'::jsonb)) > 0;

-- Os dois UPDATE estao COMENTADOS de proposito. Descomente na hora de rodar.

-- -----------------------------------------------------------------------------
-- DEPOIS DA LIMPEZA
-- -----------------------------------------------------------------------------
-- Os aparelhos ainda tem o base64 no cache local. Como o pull sobrescreve o
-- registro local com o que vem da nuvem, a coluna vazia desce sozinha no
-- proximo ciclo de 30 segundos e o cache encolhe junto. Nao e preciso limpar
-- aparelho por aparelho.
--
-- Derrubar as colunas de vez (ALTER TABLE ... DROP COLUMN) so depois de a
-- consulta de conferencia voltar zerada por alguns dias E de nao restar
-- aparelho rodando versao anterior a 5.1.0 - a versao antiga GRAVA nessas
-- colunas, e a coluna sumir faria o envio dela voltar HTTP 400 e derrubar a
-- sincronia da tabela inteira, em silencio. Este e o mesmo defeito da
-- migration 33, ao contrario.
