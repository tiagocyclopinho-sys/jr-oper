-- =============================================================================
-- MIGRATION 38 - FOTOS DA DEVOLUCAO: IndexedDB (fila) + Supabase Storage
--
-- E a migration 34 aplicada a segunda tabela que ficou de fora dela. Mesmo
-- desenho, mesmo bucket publico com DELETE negado, mesma fila no IndexedDB.
--
-- POR QUE ELA EXISTE
-- Medido na nuvem em 04/09/2026, antes desta migration:
--
--   30 devolucoes  = 4.029 KB de JSON
--   dessas, FOTO   = 3.975 KB   (fotos_abertura 2.375 + foto_url 1.253
--                                + fotos_investigacao 348)
--   todo o resto   =    54 KB
--
-- Ou seja: 98,7% do peso da tabela e imagem em base64 dentro de coluna. E como
-- o pull monta select=* (js/cloudStore.js), cada uma dessas fotos volta da
-- nuvem a cada 30 segundos, para TODO aparelho. Uma unica devolucao (a
-- DEV-030, de 04/09) pesa 926 KB sozinha.
--
-- O EFEITO PRATICO DISSO, em 04/09/2026: um aparelho abriu com o localStorage
-- em 91% e a tarja "o ultimo registro NAO foi salvo". A tratativa do gestor na
-- DEV-024 foi digitada e nunca existiu - nao esta no aparelho, nao esta na
-- nuvem, nao esta na trilha de auditoria. So 11 devolucoes com foto bastaram
-- para encher os ~5 MB de cota.
--
-- O QUE NAO MUDA: a garantia offline. A foto continua sendo gravada localmente
-- primeiro (agora como Blob no IndexedDB, que nao infla 33% em base64 nem
-- ocupa 2 bytes por caractere) e o upload continua diferido.
--
-- -----------------------------------------------------------------------------
-- DIFERENCA DELIBERADA EM RELACAO A MIGRATION 34: NAO HA CHECK AQUI.
--
-- A 34 criou reentregas_foto_recebimento_check porque a reentrega ja exigia
-- foto desde a migration 31 - recebimento sem prova nao podia existir. Na
-- devolucao a foto SEMPRE foi opcional: em 04/09/2026, 19 das 30 devolucoes
-- nao tem nenhuma, e as unicas restricoes da tabela sao forma_acerto e
-- status_fechamento. Criar aqui a exigencia que a 34 tem seria inventar uma
-- regra de negocio que ninguem pediu e rejeitar 19 registros que ja existem.
-- Se um dia foto virar obrigatoria na devolucao, isso e uma decisao da
-- operacao, com migration propria.
-- -----------------------------------------------------------------------------
--
-- ORDEM DE APLICACAO - IMPORTA:
--   1. Esta migration (cria colunas e bucket; nao quebra o app em producao,
--      porque so acrescenta).
--   2. SO DEPOIS o deploy do app (js/fotoStore.js, js/store.js, js/app.js).
--      Ao contrario, o app mandaria quatro campos que a API diz nao existir e
--      o PostgREST devolveria 400 - derrubando o LOTE inteiro, nao so a coluna.
--   3. Por ultimo, e com gente olhando, a migracao das 11 devolucoes que ja
--      tem base64: jrMigrarFotosDevolucaoLegado() no console. Ver
--      database/limpeza_fotos_base64_devolucao.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) BUCKET
-- -----------------------------------------------------------------------------
-- PUBLICO, pelo mesmo raciocinio da 34: bucket privado exigiria URL assinada a
-- cada exibicao, que expira e faz a foto sumir do <img>, e nao protegeria mais
-- - quem tem a chave anon (legivel no F12) assina sozinho. O que protege e o
-- caminho nao ser deduzivel; ver _caminhoDe() em js/fotoStore.js.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'devolucoes-fotos',
  'devolucoes-fotos',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 2) POLICIES
-- -----------------------------------------------------------------------------
-- SELECT e INSERT liberados; UPDATE e DELETE ausentes de proposito.
-- Ausencia de policy = negado. Foto de devolucao e prova de avaria e de valor
-- reclamado: apagar nao pode ser um clique.
drop policy if exists "devolucoes_fotos_select_anon" on storage.objects;
create policy "devolucoes_fotos_select_anon"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'devolucoes-fotos');

drop policy if exists "devolucoes_fotos_insert_anon" on storage.objects;
create policy "devolucoes_fotos_insert_anon"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'devolucoes-fotos');

-- -----------------------------------------------------------------------------
-- 3) COLUNAS
-- -----------------------------------------------------------------------------
-- NULLABLE com default, pelo motivo da 34: cloudStore.upsert() normaliza o
-- lote preenchendo com NULL as chaves ausentes em algum objeto. Uma coluna
-- NOT NULL faria um registro antigo em cache derrubar o LOTE TODO com 400.
alter table ocorrencias_devolucao
  add column if not exists fotos_abertura_paths         jsonb   default '[]'::jsonb,
  add column if not exists fotos_investigacao_paths     jsonb   default '[]'::jsonb,
  add column if not exists fotos_abertura_pendentes     integer default 0,
  add column if not exists fotos_investigacao_pendentes integer default 0;

comment on column ocorrencias_devolucao.fotos_abertura_paths is
  'Caminhos no bucket devolucoes-fotos. A imagem NAO mora no Postgres.';
comment on column ocorrencias_devolucao.fotos_investigacao_paths is
  'Caminhos no bucket devolucoes-fotos. A imagem NAO mora no Postgres.';
comment on column ocorrencias_devolucao.fotos_abertura_pendentes is
  'Quantas fotos da abertura ainda estao so no IndexedDB do aparelho que fotografou, aguardando rede. > 0 = a prova existe mas ainda nao subiu.';
comment on column ocorrencias_devolucao.fotos_investigacao_pendentes is
  'Idem, para a analise/investigacao.';

-- As colunas fotos_abertura / fotos_investigacao / foto_url (base64)
-- CONTINUAM EXISTINDO e nao sao derrubadas aqui: derrubar coluna com dado
-- dentro apaga prova operacional. O app para de GRAVAR nelas a partir do
-- deploy; o que ja esta la sai pelo passo 3, com gente olhando.
--
-- foto_url merece nota: ela nunca foi so um alias barato. Guarda uma copia
-- INTEIRA em base64 da primeira foto (1.253 KB dos 3.975 medidos), duplicando
-- o que ja esta em fotos_abertura[0]. Depois do passo 3 ela passa a guardar a
-- URL publica do primeiro caminho, que e o que o nome sempre prometeu.

-- -----------------------------------------------------------------------------
-- 4) CACHE DE ESQUEMA DO POSTGREST
-- -----------------------------------------------------------------------------
-- Sem isto o PostgREST continua servindo o esquema em cache e RECUSA as
-- colunas novas - o app deployado mandaria quatro campos que a API diz nao
-- existir, e o lote inteiro voltaria com HTTP 400.
notify pgrst, 'reload schema';
