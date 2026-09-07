-- =============================================================================
-- MIGRATION 39 - NOTA FISCAL EM PDF NA DEVOLUCAO
--
-- A NF ja existia como TEXTO (ocorrencias_devolucao.nota_fiscal, VARCHAR 40).
-- O que faltava era o ARQUIVO. O gestor pediu para nao ter de perguntar: abre
-- a tratativa e olha a propria nota.
--
-- NAO CRIA STORE NOVO NEM BUCKET NOVO. A NF anda na fila que ja existe desde
-- a 38 (IndexedDB -> Storage), como uma etapa a mais do modulo 'devolucoes'.
--
-- BUCKET PUBLICO, decidido em 05/09/2026: todo mundo que opera o app ja tem
-- acesso a essa mesma nota no ERP Winthor.
--
-- ORDEM - IMPORTA: esta migration PRIMEIRO, o deploy do app DEPOIS.
-- =============================================================================

-- 1) COLUNAS -----------------------------------------------------------------
-- NULLABLE com default, pelo motivo da 38: cloudStore.upsert() normaliza o
-- lote preenchendo com NULL as chaves ausentes. Uma coluna NOT NULL faria um
-- registro antigo em cache derrubar o LOTE TODO com 400.
alter table ocorrencias_devolucao
  add column if not exists nf_paths     jsonb   default '[]'::jsonb,
  add column if not exists nf_pendentes integer default 0;

comment on column ocorrencias_devolucao.nf_paths is
  'Caminhos do(s) PDF(s) da NF no bucket devolucoes-fotos. O arquivo NAO mora no Postgres.';
comment on column ocorrencias_devolucao.nf_pendentes is
  'Quantos PDFs ainda estao so no IndexedDB do aparelho que anexou, aguardando rede.';

-- 2) BUCKET: aceitar application/pdf -----------------------------------------
-- O bucket da 38 so aceita imagem. Sem esta linha o Storage recusa o PDF com
-- 400 e a fila fica tentando de novo para sempre, sem nunca conseguir.
-- O teto sobe de 5 para 10 MB: NF escaneada passa de 5 MB com facilidade.
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'],
       file_size_limit    = 10485760
 where id = 'devolucoes-fotos';

-- 3) CACHE DE ESQUEMA DO POSTGREST -------------------------------------------
-- Sem isto o PostgREST continua servindo o esquema em cache e RECUSA as
-- colunas novas, mesmo elas ja existindo.
notify pgrst, 'reload schema';
