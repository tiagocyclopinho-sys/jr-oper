-- =============================================================================
-- MIGRATION 60 — Nomes no cadastro de motoristas (30/10/2026)
-- =============================================================================
-- APLICADA EM PRODUCAO em 30/10/2026. So dados. Decisoes do Tiago:
--
--   * "ARMANO LIMA DA CUNHA" e erro do cadastro: o certo e ARMANDO. Corrigido
--     no cadastro (motoristas id 18) e onde o nome errado ja tinha sido gravado
--     (1 viagem e 7 infracoes), para o Dossie nao separar a mesma pessoa.
--   * "\tGLEDSON RODRIGUES DE BORBA": tabulacao no inicio do nome (motoristas
--     id 534 e 1 viagem).
--   * EDSON na matriz (Palmas Norte de segunda e terca, com Alessanco) e o
--     EDSON VELOSO MENDES. EDSON ARRUDA e RCA: so esta no cadastro porque a
--     base veio inteira do WinThor; nao considerar.
--
-- Cadastros Mestres nao tem busca nem edicao: por isso a correcao por SQL.
-- atualizado_em em hora de Brasilia (ver CLAUDE.md): os aparelhos aceitam a
-- versao nova no proximo pull.
-- =============================================================================

UPDATE motoristas SET nome = 'ARMANDO LIMA DA CUNHA' WHERE id = 18 AND nome = 'ARMANO LIMA DA CUNHA';
UPDATE motoristas SET nome = btrim(nome, E' \t') WHERE id = 534 AND nome ~ '^\s';

UPDATE controle_viagens SET motorista = 'ARMANDO LIMA DA CUNHA', atualizado_em = now()
 WHERE motorista = 'ARMANO LIMA DA CUNHA';
UPDATE controle_viagens SET motorista = btrim(motorista, E' \t'), atualizado_em = now()
 WHERE motorista ~ '^\s+GLEDSON';

UPDATE infracoes SET prestador_nome = 'ARMANDO LIMA DA CUNHA', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo')
 WHERE prestador_nome = 'ARMANO LIMA DA CUNHA';

UPDATE escala_matrizes
   SET motorista = 'EDSON VELOSO MENDES / ALESSANCO BARROS DE MOURA',
       atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo')
 WHERE id IN (6, 30) AND motorista = 'EDSON / ALESSANCO BARROS DE MOURA';
