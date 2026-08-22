-- =============================================================================
-- MIGRACAO 25b - RLS DA TABELA dispositivos, DE FORMA DURAVEL (22/08/2026)
--
-- SINTOMA (segunda ocorrencia): a tela Governanca -> Aparelhos abre com
-- "Nenhum aparelho registrado ainda", e NAO com a tarja ambar de tabela
-- inexistente. Conferido no banco:
--     rls_ligado = true   linhas_reais = 3
-- Os aparelhos estao la. Sob RLS sem politica, o SELECT do anon nao da
-- erro: devolve zero linha em silencio. So o INSERT reclama, com 401.
--
-- CAUSA RAIZ, e e por isso que voltou: a migration_25a resolveu com
-- "ALTER TABLE dispositivos DISABLE ROW LEVEL SECURITY". Isso conserta o
-- dia e quebra de novo, porque o Supabase reativa RLS em tabelas do schema
-- public - e uma tabela com RLS ligado e SEM POLITICA fica invisivel.
--
-- Todas as outras ~30 tabelas do schema.sql nunca tiveram esse problema
-- porque usam o par ENABLE + POLICY. A dispositivos foi a unica criada com
-- DISABLE. Esta migracao a alinha com o resto do schema.
--
-- Sobre seguranca: a politica aberta para anon nao piora nada aqui - e
-- exatamente o que ja vale para todas as outras tabelas, e esta registrada
-- em GO_LIVE.md como "Decisoes em aberto - 1. Seguranca do banco". Trocar
-- o acesso anonimo por Supabase Auth com policies por usuario e uma rodada
-- propria, e continua pendente. Nao introduzimos divida nova; so paramos de
-- deixar UMA tabela fora do padrao das outras.
--
-- Rode este arquivo inteiro, de uma vez. E idempotente.
-- =============================================================================

ALTER TABLE public.dispositivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acesso_total_anon" ON public.dispositivos;
CREATE POLICY "acesso_total_anon" ON public.dispositivos
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- O app roda com a anon key, mas Supabase pode entregar o papel
-- authenticated dependendo de como a sessao e criada. Mesma politica para
-- os dois evita a tela voltar a ficar vazia por esse detalhe.
DROP POLICY IF EXISTS "acesso_total_authenticated" ON public.dispositivos;
CREATE POLICY "acesso_total_authenticated" ON public.dispositivos
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- CONFERENCIA - rode DEPOIS, separado.
-- Esperado: rls_ligado = true, politicas = 2, linhas_reais = 3 (ou mais).
--
-- Diferente das vezes anteriores, aqui rls_ligado = true e o resultado
-- CERTO. O que faz a tela funcionar e a politica, nao o RLS desligado.
-- =============================================================================
-- SELECT c.relrowsecurity                                   AS rls_ligado,
--        (SELECT count(*) FROM pg_policies
--          WHERE schemaname='public' AND tablename='dispositivos') AS politicas,
--        (SELECT count(*) FROM dispositivos)                AS linhas_reais
--   FROM pg_class c WHERE c.relname = 'dispositivos';
