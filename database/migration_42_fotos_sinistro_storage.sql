-- =============================================================================
-- MIGRATION 42 - FOTOS DO SINISTRO PARA O STORAGE
--
-- O ULTIMO PONTO DE UPLOAD QUE AINDA GRAVA IMAGEM DENTRO DO BANCO. Depois
-- desta e da 41, nenhuma tela do app escreve base64 em coluna nenhuma.
-- Levantado em 07/09/2026 varrendo as 25 tabelas sincronizadas e cruzando com
-- os seis pontos de upload do codigo: devolucao (fotos, videos e NF em PDF),
-- reentrega e videos de rota ja estavam no Storage; sobravam as FOTOS da rota
-- (migration 41) e as do SINISTRO, aqui.
--
-- E A HORA BARATA DE FAZER: sinistros tem ZERO linhas. Nao ha foto para
-- migrar, nao existe jrMigrarFotosSinistroLegado() e nao precisa existir. O
-- que esta migration faz e impedir que a PRIMEIRA foto de acidente lancada ja
-- nasca dentro do Postgres - e foto de acidente vem em serie, de varios
-- angulos, do celular do motorista.
--
-- UMA LISTA, E NAO DOZE COLUNAS - a decisao, tomada em 07/09/2026
--
-- O sinistro tem SEIS grupos de foto: danos do veiculo JR e do terceiro pelos
-- olhos do MOTORISTA, os mesmos dois pelos olhos da MANUTENCAO, os orcamentos
-- e as fotos do acidente com o B.O. Repetir o formato da devolucao (uma coluna
-- _paths e uma _pendentes por grupo) daria DOZE colunas novas, e um setimo
-- grupo amanha daria mais duas.
--
-- O proprio PLANO_DE_ACAO.md ja tinha escrito a regra, a proposito do segundo
-- ajudante: "se um dia aparecer um TERCEIRO ajudante, a resposta certa nao e
-- criar uma terceira coluna - e criar uma lista de ajudantes por viagem".
-- Seis grupos passou dessa linha faz tempo. Entao aqui e uma lista: um jsonb
-- com o grupo como chave.
--
-- Custa uma funcao de gravacao nova no app, que a devolucao e a reentrega nao
-- precisam. Vale porque a tabela esta VAZIA: escolher a forma certa hoje nao
-- custa migracao de dado nenhuma, e depois da primeira foto lancada custaria.
--
-- ORDEM - IMPORTA: esta migration PRIMEIRO, o deploy da v6.6.1 DEPOIS. Mesmo
-- motivo das 38 a 41: cloudStore.upsert() manda o registro inteiro e
-- `sinistros` nao tem lista branca de colunas em CloudStore.COLUNAS_POR_TABELA
-- - com a coluna faltando na nuvem, o PostgREST recusa o LOTE TODO com
-- PGRST204, em silencio.
--
-- ADITIVA: as seis colunas jsonb de hoje continuam existindo e continuam
-- sendo lidas. A tela le o caminho primeiro e cai no base64 legado quando nao
-- houver caminho - o mesmo que a devolucao faz desde a 38. Como nao ha linha,
-- na pratica nao ha legado; a leitura em cascata fica de rede de seguranca.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) BUCKET
-- -----------------------------------------------------------------------------
-- Bucket PROPRIO, e nao o rota-fotos nem o devolucoes-fotos: as policies sao
-- por bucket_id, e sinistro tem prazo de guarda proprio - processo, seguradora
-- e terceiro envolvido. Misturar as tres provas num balde so tiraria a chance
-- de tratar uma sem mexer nas outras.
--
-- PUBLICO, pelo raciocinio das 34, 38 e 41: bucket privado exigiria URL
-- assinada a cada exibicao, que expira e faz a foto sumir do <img>, e nao
-- protegeria mais - quem tem a chave anon (legivel no F12) assina sozinho. O
-- que protege e o caminho nao ser deduzivel; ver _caminhoDe() em fotoStore.js.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sinistros-fotos',
  'sinistros-fotos',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- application/pdf entra aqui, e so aqui entre os buckets de foto: o grupo
-- "orcamentos_anexos" recebe orcamento de oficina, que chega em PDF tanto
-- quanto em foto. Mesmo precedente da migration 39, que fez o bucket da
-- devolucao aceitar a NF em PDF.

-- -----------------------------------------------------------------------------
-- 2) POLICIES
-- -----------------------------------------------------------------------------
-- SELECT e INSERT liberados; UPDATE e DELETE AUSENTES DE PROPOSITO.
-- Ausencia de policy = negado. Foto de sinistro e prova de acidente com
-- terceiro, e pode ser pedida por seguradora ou por juizo anos depois:
-- apagar nao pode ser um clique.
drop policy if exists "sinistros_fotos_select_anon" on storage.objects;
create policy "sinistros_fotos_select_anon"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'sinistros-fotos');

drop policy if exists "sinistros_fotos_insert_anon" on storage.objects;
create policy "sinistros_fotos_insert_anon"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'sinistros-fotos');

-- -----------------------------------------------------------------------------
-- 3) COLUNAS
-- -----------------------------------------------------------------------------
-- DUAS, nao doze. midias_paths e um OBJETO com o grupo na chave:
--
--   {
--     "danos_jr_motorista":       ["sinistros/123/danos_jr_motorista/ab12.jpg"],
--     "danos_terceiro_motorista": [],
--     "danos_jr_manutencao":      [],
--     "danos_terceiro_manutencao":[],
--     "orcamentos":               ["sinistros/123/orcamentos/cd34.pdf"],
--     "fotos_acidente_bo":        ["sinistros/123/fotos_acidente_bo/ef56.jpg"]
--   }
--
-- Grupo novo amanha nao pede migration nenhuma: vira mais uma chave.
--
-- NULLABLE com default, pelo motivo das 34, 38 e 41: cloudStore.upsert()
-- normaliza o lote preenchendo com NULL as chaves ausentes em algum objeto.
-- Uma coluna NOT NULL faria um registro antigo em cache derrubar o LOTE TODO
-- com 400.
alter table sinistros
  add column if not exists midias_paths     jsonb   default '{}'::jsonb,
  add column if not exists midias_pendentes integer default 0;

comment on column sinistros.midias_paths is
  'Caminhos no bucket sinistros-fotos, agrupados: a chave e o grupo (danos_jr_motorista, danos_terceiro_motorista, danos_jr_manutencao, danos_terceiro_manutencao, orcamentos, fotos_acidente_bo) e o valor e a lista de caminhos. A imagem NAO mora no Postgres. Uma lista em vez de doze colunas, pela regra escrita no PLANO_DE_ACAO.md da v6.6.0.';

-- UM contador para o registro inteiro, e nao um por grupo: a pergunta
-- operacional e "falta prova subir deste sinistro?", e um numero responde.
-- Saber QUAL grupo esta pendente nao muda o que alguem faz - o que se faz e
-- pegar o aparelho que fotografou e deixar na rede.
comment on column sinistros.midias_pendentes is
  'Quantos arquivos deste sinistro ainda estao so no IndexedDB do aparelho que fotografou, aguardando rede. > 0 = a prova existe mas ainda nao subiu.';

-- As seis colunas jsonb de base64 (fotos_danos_jr_motorista,
-- fotos_danos_terceiro_motorista, fotos_danos_jr_manutencao,
-- fotos_danos_terceiro_manutencao, orcamentos_anexos, fotos_acidente_bo)
-- CONTINUAM EXISTINDO e nao sao derrubadas aqui. Hoje estao todas vazias
-- (a tabela tem zero linhas); ficam como rede de seguranca para o caso de
-- algum aparelho ter um sinistro em cache local que ainda nao subiu.

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
-- select 'coluna midias_paths' as item,
--        exists (select 1 from information_schema.columns
--                 where table_name = 'sinistros' and column_name = 'midias_paths') as ok
-- union all
-- select 'coluna midias_pendentes',
--        exists (select 1 from information_schema.columns
--                 where table_name = 'sinistros' and column_name = 'midias_pendentes')
-- union all
-- select 'bucket sinistros-fotos',
--        exists (select 1 from storage.buckets where id = 'sinistros-fotos')
-- union all
-- select 'as 2 policies do bucket',
--        (select count(*) from pg_policies
--          where schemaname = 'storage' and tablename = 'objects'
--            and policyname in ('sinistros_fotos_select_anon','sinistros_fotos_insert_anon')) = 2;
-- =============================================================================
