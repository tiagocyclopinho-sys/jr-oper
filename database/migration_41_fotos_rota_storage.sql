-- =============================================================================
-- MIGRATION 41 - FOTOS DA OCORRENCIA EM ROTA PARA O STORAGE
--
-- UMA DAS DUAS ULTIMAS TELAS QUE AINDA GRAVAM IMAGEM DENTRO DO BANCO (a outra
-- e o sinistro, migration 42). As fotos da devolucao
-- sairam na migration 38, as da reentrega na 34, e os VIDEOS da rota ja sobem
-- para o Storage desde a v5.1.0 (handleRotaVideosUpload guarda a URL). So as
-- FOTOS da rota ficaram para tras: handleRotaFotosUpload() empurra o dataUrl
-- base64 para uploadedRotaFotos, que vira ocorrencias_rota.midia_fotos.
--
-- O QUE ISSO CUSTOU, MEDIDO NA NUVEM EM 07/09/2026
-- UMA unica ocorrencia em rota, com foto, ocupava:
--
--     o proprio registro ......................  334 KB
--     3 copias em registro_versoes ........... 1.009 KB
--     3 copias em audit_logs ................. 1.680 KB
--                                              ---------
--                                                3.023 KB
--
-- ...dentro da cota de ~5 MB do localStorage de TODO aparelho, e voltando da
-- nuvem a cada pull de 30 segundos. Para comparar: as 198 viagens da operacao
-- inteira ocupavam 111 KB. As copias do historico ja foram limpas em
-- 07/09/2026 e a torneira foi fechada no app (logAudit passou a podar a midia,
-- e _podarMidiaDaVersao passou a reconhecer array serializado como string).
-- Falta a foto do registro vivo, que e o que esta migration prepara.
--
-- APLICADA EM 07/09/2026 no projeto qxipgnkdbzxtfvuyupow, ANTES do codigo do
-- app que a usa - e de proposito: a regra desta base e "migration primeiro,
-- deploy depois", e coluna ociosa nao atrapalha ninguem. Conferido depois: as
-- 2 colunas, o bucket e as 2 policies existem, e a foto viva segue intacta.
-- O codigo que grava nelas vai na v6.6.1.
--
-- ORDEM - IMPORTA: esta migration PRIMEIRO, o deploy do app DEPOIS. Mesmo
-- motivo das 38, 39 e 40: cloudStore.upsert() manda o registro inteiro e
-- ocorrencias_rota nao tem lista branca de colunas em
-- CloudStore.COLUNAS_POR_TABELA - com a coluna faltando na nuvem, o PostgREST
-- recusa o LOTE TODO com PGRST204, em silencio.
--
-- ADITIVA: nada do que esta gravado muda. midia_fotos continua existindo e
-- continua sendo lida - a tela le o caminho primeiro e cai no base64 legado
-- quando nao houver caminho, exatamente como a devolucao faz desde a 38.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) BUCKET
-- -----------------------------------------------------------------------------
-- PUBLICO, pelo mesmo raciocinio das 34 e 38: bucket privado exigiria URL
-- assinada a cada exibicao, que expira e faz a foto sumir do <img>, e nao
-- protegeria mais - quem tem a chave anon (legivel no F12) assina sozinho. O
-- que protege e o caminho nao ser deduzivel; ver _caminhoDe() em fotoStore.js.
--
-- Bucket PROPRIO, e nao o devolucoes-fotos: as policies sao por bucket_id, e
-- misturar as duas provas num balde so tiraria a chance de tratar uma sem
-- mexer na outra - retencao, expurgo e limite de tamanho sao decisoes que
-- podem divergir entre uma avaria de mercadoria e um acidente em estrada.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rota-fotos',
  'rota-fotos',
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
-- SELECT e INSERT liberados; UPDATE e DELETE AUSENTES DE PROPOSITO.
-- Ausencia de policy = negado. Foto de ocorrencia em rota e prova de acidente,
-- de retencao e de avaria de veiculo: apagar nao pode ser um clique.
drop policy if exists "rota_fotos_select_anon" on storage.objects;
create policy "rota_fotos_select_anon"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'rota-fotos');

drop policy if exists "rota_fotos_insert_anon" on storage.objects;
create policy "rota_fotos_insert_anon"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'rota-fotos');

-- -----------------------------------------------------------------------------
-- 3) COLUNAS
-- -----------------------------------------------------------------------------
-- NULLABLE com default, pelo motivo das 34 e 38: cloudStore.upsert() normaliza
-- o lote preenchendo com NULL as chaves ausentes em algum objeto. Uma coluna
-- NOT NULL faria um registro antigo em cache derrubar o LOTE TODO com 400.
alter table ocorrencias_rota
  add column if not exists midia_fotos_paths     jsonb   default '[]'::jsonb,
  add column if not exists midia_fotos_pendentes integer default 0;

comment on column ocorrencias_rota.midia_fotos_paths is
  'Caminhos no bucket rota-fotos. A imagem NAO mora no Postgres. Substitui midia_fotos (base64), que fica para os registros anteriores a esta migration.';
comment on column ocorrencias_rota.midia_fotos_pendentes is
  'Quantas fotos ainda estao so no IndexedDB do aparelho que fotografou, aguardando rede. > 0 = a prova existe mas ainda nao subiu.';

-- midia_fotos (base64) CONTINUA EXISTINDO e nao e derrubada aqui: derrubar
-- coluna com dado dentro apaga prova operacional. O app para de GRAVAR nela a
-- partir do deploy; o que ja esta la sai depois, com gente olhando, pelo
-- jrMigrarFotosRotaLegado() (a versao rota do que a 34 e a 38 ja tem).
--
-- midia_videos NAO entra aqui: os videos da rota ja vao para o Storage desde a
-- v5.1.0 e a coluna ja guarda URL, nao base64. Conferido em 07/09/2026 - a
-- varredura de base64 em todas as 25 tabelas sincronizadas nao acusou nada em
-- midia_videos.

-- -----------------------------------------------------------------------------
-- 4) CACHE DE ESQUEMA DO POSTGREST
-- -----------------------------------------------------------------------------
-- Sem isto o PostgREST continua servindo o esquema em cache e RECUSA as
-- colunas novas - o app deployado mandaria dois campos que a API diz nao
-- existir, e o lote inteiro voltaria com HTTP 400.
notify pgrst, 'reload schema';

-- =============================================================================
-- CONFERENCIA - rode DEPOIS, e espere 4 linhas com ok = true:
--
-- select 'coluna midia_fotos_paths' as item,
--        exists (select 1 from information_schema.columns
--                 where table_name = 'ocorrencias_rota' and column_name = 'midia_fotos_paths') as ok
-- union all
-- select 'coluna midia_fotos_pendentes',
--        exists (select 1 from information_schema.columns
--                 where table_name = 'ocorrencias_rota' and column_name = 'midia_fotos_pendentes')
-- union all
-- select 'bucket rota-fotos',
--        exists (select 1 from storage.buckets where id = 'rota-fotos')
-- union all
-- select 'as 2 policies do bucket',
--        (select count(*) from pg_policies
--          where schemaname = 'storage' and tablename = 'objects'
--            and policyname in ('rota_fotos_select_anon','rota_fotos_insert_anon')) = 2;
-- =============================================================================
