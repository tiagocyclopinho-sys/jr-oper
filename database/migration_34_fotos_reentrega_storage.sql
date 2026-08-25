-- =============================================================================
-- MIGRATION 34 - FOTOS DA REENTREGA: IndexedDB (fila) + Supabase Storage
--
-- JA APLICADA no projeto qxipgnkdbzxtfvuyupow em 25/08/2026, junto com a
-- criacao do bucket. Este arquivo existe para o repositorio espelhar o banco e
-- para instalacao nova.
--
-- POR QUE ELA EXISTE
-- A migration 31, de 25/08/2026, decidiu guardar a foto como base64 em coluna
-- JSONB e escreveu o porque: a recepcao acontece na doca do CD, upload exige
-- rede NO INSTANTE da captura, e o app precisa registrar o recebimento sem
-- sinal. O raciocinio estava certo; a conclusao nao.
--
-- No mesmo dia, um aparelho do CD estourou a cota do localStorage e um
-- lancamento se perdeu - nunca chegou a existir. A conta que a 31 nao fez:
--   - base64 infla o binario em ~33%;
--   - no localStorage cada caractere ocupa 2 bytes (UTF-16);
--   - logo, uma foto de 150 KB custa ~400 KB de cota, num balde que o Safari
--     do iPhone fecha perto de 5 MB e que TODO o resto do app divide;
--   - e o pull monta select=* (js/cloudStore.js:320), entao cada foto voltava
--     da nuvem a cada 30 segundos, em todo aparelho, para sempre.
--
-- O QUE MUDA - E O QUE NAO MUDA
-- NAO muda a garantia offline: a foto continua sendo gravada localmente
-- PRIMEIRO, e o upload continua diferido. O que muda e o lugar e a forma:
--   - o local passa a ser o IndexedDB, como Blob (balde proprio, na casa das
--     centenas de MB, sem inflar em base64), numa FILA que sobrevive a reload;
--   - o destino final passa a ser o Storage, e o Postgres guarda so o caminho.
--
-- Ou seja: a 31 nao errou ao recusar "subir na hora". Errou ao concluir que a
-- alternativa era o banco. A alternativa era uma fila.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) BUCKET
-- -----------------------------------------------------------------------------
-- PUBLICO. Autorizado pelo usuario em 25/08/2026, depois de comparado com a
-- alternativa: bucket privado exigiria URL assinada a cada exibicao, que expira
-- e faz a foto sumir do <img> - e nao aumentaria a protecao, porque quem tem a
-- chave anon (publica, legivel no F12) gera a assinatura sozinho. O que protege
-- a foto e o caminho nao ser deduzivel: ver _caminhoDe() em js/fotoStore.js.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reentregas-fotos',
  'reentregas-fotos',
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
-- Mesmo padrao "acesso_total_anon" das tabelas, MENOS o DELETE: foto de
-- recepcao e prova operacional, e apagar nao pode ser um clique.
drop policy if exists "reentregas_fotos_select_anon" on storage.objects;
create policy "reentregas_fotos_select_anon"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'reentregas-fotos');

drop policy if exists "reentregas_fotos_insert_anon" on storage.objects;
create policy "reentregas_fotos_insert_anon"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'reentregas-fotos');

-- SEM policy de UPDATE e SEM policy de DELETE. Ausencia de policy = negado.
-- Conferido em 25/08/2026: com a chave anon, INSERT devolve 200, leitura
-- publica devolve 200, DELETE devolve 403 AccessDenied.

-- -----------------------------------------------------------------------------
-- 3) COLUNAS
-- -----------------------------------------------------------------------------
-- NULLABLE de proposito. cloudStore.upsert() normaliza o lote preenchendo com
-- NULL as chaves que faltarem em algum objeto (js/cloudStore.js:370). Uma
-- coluna NOT NULL aqui faria um registro antigo em cache derrubar o LOTE TODO
-- com HTTP 400 - a morte silenciosa de sincronia que ja custou caro neste
-- projeto (ver migration 33). O default cobre o INSERT; o coalesce cobre a
-- leitura.
alter table reentregas_rota
  add column if not exists fotos_recebimento_paths     jsonb default '[]'::jsonb,
  add column if not exists fotos_despacho_paths        jsonb default '[]'::jsonb,
  add column if not exists fotos_recebimento_pendentes integer default 0,
  add column if not exists fotos_despacho_pendentes    integer default 0;

comment on column reentregas_rota.fotos_recebimento_paths is
  'Caminhos no bucket reentregas-fotos. A imagem NAO mora no Postgres.';
comment on column reentregas_rota.fotos_despacho_paths is
  'Caminhos no bucket reentregas-fotos. A imagem NAO mora no Postgres.';
comment on column reentregas_rota.fotos_recebimento_pendentes is
  'Quantas fotos desta etapa ainda estao so no IndexedDB do aparelho que fotografou, aguardando rede. > 0 = a prova existe mas ainda nao subiu.';
comment on column reentregas_rota.fotos_despacho_pendentes is
  'Idem, para o despacho.';

-- As colunas fotos_recebimento / fotos_despacho (base64, criadas pela 31)
-- CONTINUAM EXISTINDO, mas so para os registros anteriores a esta versao. O
-- app nao grava mais nada nelas. Nao sao removidas aqui de proposito: derrubar
-- coluna com dado dentro apaga prova operacional, e o volume atual (1 registro,
-- 227 KB em 25/08/2026) nao justifica a pressa. Ver
-- database/limpeza_fotos_base64_legado.sql para o esvaziamento, que deve rodar
-- SO DEPOIS de as fotos legadas terem subido para o Storage.

-- -----------------------------------------------------------------------------
-- 4) CHECKS
-- -----------------------------------------------------------------------------
-- A exigencia de foto CONTINUA no banco, mas agora aceita tres formas de
-- prova, porque a captura acontece na doca e a rede pode nao existir naquele
-- instante:
--   a) caminho ja no Storage      -> foto subiu
--   b) contador de pendentes > 0  -> foto existe, esta no aparelho, vai subir
--   c) base64 legado nao-vazio    -> registros anteriores a esta migration
--
-- (b) e um enfraquecimento assumido: o banco passa a confiar na declaracao do
-- aparelho enquanto a foto nao chega. A alternativa era travar o recebimento
-- sem sinal, que e exatamente o que a migration 31 recusou fazer. O contador e
-- visivel na tela de todo aparelho justamente para que "pendente" nao vire
-- "esquecido".
alter table reentregas_rota drop constraint if exists reentregas_foto_recebimento_check;
alter table reentregas_rota add constraint reentregas_foto_recebimento_check
  check (
    status not in ('RECEBIDO_CD', 'DESPACHADO')
    or jsonb_array_length(coalesce(fotos_recebimento_paths, '[]'::jsonb)) > 0
    or coalesce(fotos_recebimento_pendentes, 0) > 0
    or jsonb_array_length(coalesce(fotos_recebimento, '[]'::jsonb)) > 0
  );

alter table reentregas_rota drop constraint if exists reentregas_foto_despacho_check;
alter table reentregas_rota add constraint reentregas_foto_despacho_check
  check (
    status <> 'DESPACHADO'
    or jsonb_array_length(coalesce(fotos_despacho_paths, '[]'::jsonb)) > 0
    or coalesce(fotos_despacho_pendentes, 0) > 0
    or jsonb_array_length(coalesce(fotos_despacho, '[]'::jsonb)) > 0
  );

-- -----------------------------------------------------------------------------
-- 5) CACHE DE ESQUEMA DO POSTGREST
-- -----------------------------------------------------------------------------
-- Sem isto o PostgREST continua servindo o esquema em cache e RECUSA as
-- colunas novas - o app deployado passaria a mandar quatro campos que a API
-- diz nao existir, e o lote inteiro voltaria com HTTP 400.
notify pgrst, 'reload schema';
