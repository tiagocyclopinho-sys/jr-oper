-- =============================================================================
-- PASSO 3 - AS 11 DEVOLUCOES QUE JA TEM BASE64 NA NUVEM
--
-- NAO E MIGRATION. Nao roda no deploy. Roda UMA VEZ, com gente olhando, e so
-- DEPOIS de as fotos legadas terem subido para o Storage.
--
-- E o gemeo de database/limpeza_fotos_base64_legado.sql, que fez o mesmo pela
-- reentrega. Leia aquele antes deste se for a primeira vez.
--
-- -----------------------------------------------------------------------------
-- POR QUE PRECISA ACONTECER
--
-- A migration 38 e o deploy do app fazem a foto NOVA parar de virar base64.
-- Isso nao mexe em nada do que ja esta gravado. Enquanto fotos_abertura,
-- fotos_investigacao e foto_url tiverem conteudo, elas voltam da nuvem A CADA
-- PULL, porque o pull monta select=* - de 30 em 30 segundos, em todo aparelho,
-- para sempre.
--
-- Medido em 04/09/2026, antes de qualquer passo:
--
--     30 devolucoes ............. 4.029 KB
--     fotos_abertura ............ 2.375 KB   (11 registros)
--     foto_url .................. 1.253 KB   (11 registros, DUPLICATA da 1a)
--     fotos_investigacao ...........348 KB   (5 registros)
--     todo o resto .................. 54 KB
--
-- Ou seja: parar de gravar resolve o amanha; este arquivo resolve o ontem. Sem
-- ele, o ganho da migration 38 nao acontece para nenhum registro existente.
--
-- -----------------------------------------------------------------------------
-- COMO FAZER, NA ORDEM. NAO PULE ETAPA.
--
--   1. Confirme que a migration 38 esta aplicada e que o app 6.4.0 ja esta
--      publicado. Rode a CONFERENCIA A abaixo: as quatro colunas novas tem de
--      existir.
--
--   2. Abra o app num aparelho com REDE BOA e espere a sincronia trazer a
--      nuvem inteira (o contador de registros para de subir). Este aparelho
--      vai carregar as 11 fotos para o Storage; num 4G de doca isso demora.
--
--   3. No console do navegador (F12), rode:
--
--          jrMigrarFotosDevolucaoLegado()
--
--      Isso, para cada devolucao e cada etapa: poe cada foto base64 na fila do
--      IndexedDB, esvazia a coluna legada e assume a pendencia na MESMA
--      gravacao, e em seguida sobe tudo para o bucket devolucoes-fotos.
--
--      A ordem e deliberada e e a mesma da reentrega: esvaziar antes deixaria
--      a devolucao um instante sem prova nenhuma; esvaziar depois do upload
--      deixaria a foto duplicada nos dois lugares se o app fechasse no meio.
--
--   4. Confira que a fila zerou:
--
--          jrFotosPendentes()
--
--      Enquanto NAO estiver zerada, NAO feche o navegador e NAO limpe os dados
--      do site: a foto so existe ali. Se precisar parar, pare aqui - o passo 5
--      pode esperar o tempo que for.
--
--   5. Rode a CONFERENCIA B. So se ela voltar TUDO ZERO rode a LIMPEZA.
--
--   6. Rode a LIMPEZA (o UPDATE la embaixo).
--
-- -----------------------------------------------------------------------------
-- SE ALGO DER ERRADO NO MEIO
--
-- Ate o passo 6 nada foi perdido: a foto esta no Storage, ou na fila do
-- aparelho, ou ainda na coluna base64. A CONFERENCIA B e justamente a pergunta
-- "existe alguma foto que so existe em base64 e nao subiu?". Se ela voltar
-- diferente de zero, NAO rode a limpeza - rode jrMigrarFotosDevolucaoLegado()
-- de novo, que e idempotente para o que ja migrou.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CONFERENCIA A - rode ANTES DE TUDO. As quatro colunas tem de existir.
-- -----------------------------------------------------------------------------
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'ocorrencias_devolucao'
   and column_name in ('fotos_abertura_paths', 'fotos_investigacao_paths',
                       'fotos_abertura_pendentes', 'fotos_investigacao_pendentes')
 order by column_name;
-- Esperado: 4 linhas.


-- -----------------------------------------------------------------------------
-- CONFERENCIA B - rode DEPOIS do passo 4. Precisa voltar TUDO ZERO.
--
-- A pergunta e "sobrou base64 que ainda nao tem caminho no Storage nem
-- pendencia declarada?". Uma linha diferente de zero aqui significa que apagar
-- perderia a foto.
-- -----------------------------------------------------------------------------
select
  count(*) filter (
    where jsonb_array_length(coalesce(fotos_abertura, '[]'::jsonb)) > 0
      and jsonb_array_length(coalesce(fotos_abertura_paths, '[]'::jsonb)) = 0
      and coalesce(fotos_abertura_pendentes, 0) = 0
  ) as abertura_em_risco,
  count(*) filter (
    where jsonb_array_length(coalesce(fotos_investigacao, '[]'::jsonb)) > 0
      and jsonb_array_length(coalesce(fotos_investigacao_paths, '[]'::jsonb)) = 0
      and coalesce(fotos_investigacao_pendentes, 0) = 0
  ) as investigacao_em_risco,
  count(*) filter (
    where coalesce(foto_url, '') like 'data:%'
      and jsonb_array_length(coalesce(fotos_abertura_paths, '[]'::jsonb)) = 0
      and coalesce(fotos_abertura_pendentes, 0) = 0
  ) as foto_url_em_risco,
  count(*) filter (where coalesce(fotos_abertura_pendentes, 0) > 0
                      or coalesce(fotos_investigacao_pendentes, 0) > 0) as ainda_na_fila_de_alguem
  from ocorrencias_devolucao
 where coalesce(is_deleted, false) = false;
-- Esperado: 0, 0, 0, 0.
--
-- ainda_na_fila_de_alguem > 0 nao e erro - e um aparelho que ainda nao
-- terminou de subir. Espere ele terminar (jrFotosPendentes() naquele aparelho)
-- antes de seguir.


-- -----------------------------------------------------------------------------
-- ONDE O PESO ESTA AGORA - util antes e depois, para ver o ganho.
-- -----------------------------------------------------------------------------
select
  round(sum(length(coalesce(fotos_abertura::text,     '')))/1024.0, 1) as abertura_kb,
  round(sum(length(coalesce(fotos_investigacao::text, '')))/1024.0, 1) as investigacao_kb,
  round(sum(length(coalesce(foto_url,                 '')))/1024.0, 1) as foto_url_kb,
  round(sum(length(to_jsonb(o)::text))/1024.0, 1)                      as tabela_inteira_kb
  from ocorrencias_devolucao o;
-- Em 04/09/2026, antes de tudo: 2374.8 | 347.5 | 1253.2 | 4028.7
-- Depois da limpeza, o esperado e algo como:  0 | 0 | (poucos KB de URL) | ~60


-- -----------------------------------------------------------------------------
-- LIMPEZA - so depois de a CONFERENCIA B voltar 0, 0, 0, 0.
--
-- NAO derruba as colunas. Esvazia. Derrubar coluna e irreversivel e nao devolve
-- nada em troca: o espaco que importa e o do JSON que trafega no pull, e ele ja
-- vai embora com o UPDATE.
--
-- foto_url NAO fica vazio: passa a guardar a URL publica do primeiro caminho,
-- que e o que o nome sempre prometeu. Assim qualquer tela ou relatorio antigo
-- que leia foto_url continua mostrando a foto - so que agora sao ~100 bytes de
-- endereco no lugar de ~114 KB de imagem.
--
-- Troque <PROJETO> pelo ref do Supabase antes de rodar (o mesmo que aparece na
-- url do painel). Em 04/09/2026: qxipgnkdbzxtfvuyupow
-- -----------------------------------------------------------------------------

-- begin;   -- descomente para conferir o resultado antes de confirmar

update ocorrencias_devolucao
   set foto_url = case
                    when jsonb_array_length(coalesce(fotos_abertura_paths, '[]'::jsonb)) > 0
                    then 'https://<PROJETO>.supabase.co/storage/v1/object/public/devolucoes-fotos/'
                         || (fotos_abertura_paths ->> 0)
                    else ''
                  end,
       fotos_abertura     = '[]'::jsonb,
       fotos_investigacao = '[]'::jsonb
 where coalesce(is_deleted, false) = false
   and (
        jsonb_array_length(coalesce(fotos_abertura,     '[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(fotos_investigacao, '[]'::jsonb)) > 0
     or coalesce(foto_url, '') like 'data:%'
   );

-- rollback;  -- se o numero de linhas nao for o esperado
-- commit;    -- se estiver certo


-- -----------------------------------------------------------------------------
-- DEPOIS DA LIMPEZA
--
-- 1. Rode a consulta "ONDE O PESO ESTA AGORA" de novo e compare.
-- 2. Num aparelho, force um pull (F5) e abra uma das 11 devolucoes: a foto tem
--    de aparecer, agora vinda do Storage.
-- 3. Confira a cota de um aparelho da doca no painel Governanca & Lixeira. O
--    jr_sac_db deve cair de ~3.666 KB para poucas dezenas.
--
-- OS ARQUIVOS NO BUCKET NAO SAO APAGADOS POR NADA DISTO, e nao devem ser: o
-- bucket devolucoes-fotos nega DELETE de proposito (migration 38, secao 2).
-- =============================================================================
