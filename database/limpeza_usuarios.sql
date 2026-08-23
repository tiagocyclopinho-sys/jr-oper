-- =============================================================================
-- LIMPEZA DE USUARIOS - BASE ZERADA PARA O GO-LIVE (23/08/2026)
--
-- NAO e uma migracao: nao muda estrutura nenhuma. E uma operacao unica,
-- destrutiva e proposital - apagar TODOS os usuarios da producao para que
-- cada pessoa, inclusive o administrador, se cadastre no primeiro acesso.
--
-- Os 8 usuarios que estao la hoje sao residuo de teste (5 deles nem
-- departamento tem). Nenhum e cadastro real.
--
-- POR QUE NAO E SO "DELETE FROM usuarios":
-- 17 colunas de outras tabelas apontam para usuarios(id) por chave
-- estrangeira - separador_id, conferente_id, gestor_id,
-- criado_por_usuario_id, mecanico_responsavel_id, e o deleted_by_usuario_id
-- de praticamente todo cadastro. Se qualquer linha ainda apontar para um
-- usuario, o DELETE falha inteiro com violacao de FK.
--
-- O bloco 2 abaixo encontra essas colunas sozinho, lendo o catalogo do
-- proprio Postgres, e as zera antes do DELETE. Assim funciona mesmo que
-- alguem tenha adicionado uma FK nova depois deste arquivo ter sido escrito
-- - e nao depende de o Reset Global ter sido feito antes.
--
-- O QUE ESTE SCRIPT **NAO** APAGA: motoristas, ajudantes, veiculos,
-- produtos, clientes, rotas, motivos, departamentos e todo o dado
-- operacional (devolucoes, viagens, ocorrencias). Se a intencao for zerar
-- tambem o operacional, isso e o "Reset Global de Treinamento" pela tela do
-- app - operacao separada, decisao separada.
--
-- Rode no SQL Editor do Supabase. Leia o bloco 1 ANTES de rodar o resto.
-- =============================================================================

-- -----------------------------------------------------------------------
-- BLOCO 1 - OLHE ANTES DE APAGAR  (rode sozinho primeiro)
--
-- Confira que sao mesmo os registros de teste. Se aparecer alguem que voce
-- reconhece como cadastro real, PARE e decida caso a caso.
-- -----------------------------------------------------------------------
SELECT id, nome, email, departamento, role, ativo, criado_em
  FROM usuarios
 ORDER BY criado_em NULLS FIRST;

-- Quantas linhas de outras tabelas apontam para algum usuario (essas
-- referencias serao zeradas pelo bloco 2 - o registro em si NAO e apagado):
SELECT 'ocorrencias_devolucao' AS tabela, count(*) AS refs FROM ocorrencias_devolucao
 WHERE criado_por_usuario_id IS NOT NULL OR separador_id IS NOT NULL
    OR conferente_id IS NOT NULL OR gestor_id IS NOT NULL
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs WHERE usuario_id IS NOT NULL
UNION ALL SELECT 'ocorrencias_rota', count(*) FROM ocorrencias_rota WHERE mecanico_responsavel_id IS NOT NULL;


-- -----------------------------------------------------------------------
-- BLOCO 2 - A LIMPEZA  (rode depois de conferir o bloco 1)
-- -----------------------------------------------------------------------
BEGIN;

-- 2.1 Zera toda referencia a usuarios, encontrando as colunas pelo catalogo
--     do Postgres em vez de uma lista escrita a mao (que envelheceria).
DO $$
DECLARE
  r RECORD;
  total INT := 0;
BEGIN
  FOR r IN
    SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = 'public'
       AND ccu.table_name = 'usuarios'
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I IS NOT NULL',
                   r.table_name, r.column_name, r.column_name);
    GET DIAGNOSTICS total = ROW_COUNT;
    RAISE NOTICE 'zerado %.% (% linha(s))', r.table_name, r.column_name, total;
  END LOOP;
END $$;

-- 2.2 Agora sim, apaga todos os usuarios.
DELETE FROM usuarios;

COMMIT;


-- -----------------------------------------------------------------------
-- BLOCO 3 - CONFERENCIA  (rode depois)
--
-- Esperado: 0. Se vier diferente de 0, o COMMIT nao passou - leia a
-- mensagem de erro do bloco 2 antes de seguir.
-- -----------------------------------------------------------------------
SELECT count(*) AS usuarios_restantes FROM usuarios;

-- Os cadastros mestres tem que continuar intactos. Compare com o que voce
-- espera (a referencia do GO_LIVE.md era: motoristas 41, veiculos 89,
-- ajudantes 38):
SELECT 'motoristas' AS cadastro, count(*) FROM motoristas
UNION ALL SELECT 'ajudantes',     count(*) FROM ajudantes
UNION ALL SELECT 'veiculos',      count(*) FROM veiculos
UNION ALL SELECT 'departamentos', count(*) FROM departamentos;

-- =============================================================================
-- DEPOIS DESTE SCRIPT, NA MESMA SESSAO DE TRABALHO:
--
-- Apagar na nuvem NAO basta. Todo aparelho que ainda tiver os usuarios
-- antigos no cache pode reenvia-los no proximo ciclo de 30s - foi
-- exatamente assim que a DEV-2026-001 e as 15 viagens voltaram em
-- 22/08/2026, depois de um Reset Global. Limpe o cache de CADA aparelho
-- antes de qualquer pessoa se cadastrar. O passo a passo esta na conversa.
-- =============================================================================
