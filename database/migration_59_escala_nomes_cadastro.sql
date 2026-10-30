-- =============================================================================
-- MIGRATION 59 — Nomes das matrizes iguais ao cadastro (30/10/2026)
-- =============================================================================
-- APLICADA EM PRODUCAO em 30/10/2026 (antes do deploy da 6.11.0). So dados.
--
-- Pedido do Tiago: os nomes das matrizes (que vieram das planilhas) passam a
-- ser exatamente os de Cadastros Mestres (tabelas motoristas e ajudantes).
-- Casamento feito fora do banco: igual sem acento; nome abreviado ou com
-- sobrenome a menos/a mais (KAUAN -> KAUAN CLARINDO DE SOUSA SILVA,
-- ALISON CARMO LEITE -> ALISON DO CARMO LEITE); erro de digitacao
-- (EDUARDO MEDANHA DO SANTOS -> EDUARDO MENDANHA DOS SANTOS). Dois nomes no
-- mesmo campo continuam juntos ("A / B"): a 6.10.0 ainda no ar mostra os dois,
-- e a 6.11.0 separa o 2o ajudante na tela.
--
-- NAO alterados (decisao pendente do Tiago):
--   ARMANDO LIMA DA CUNHA  — o cadastro esta "ARMANO LIMA DA CUNHA" (erro no cadastro?)
--   EDSON (motorista, Palmas Norte de seg/ter) — EDSON ARRUDA ou EDSON VELOSO MENDES?
--   GUSTAVO (ajudante, Araguaina III de sexta) — nao ha GUSTAVO COSTA no cadastro
--   Sem cadastro: KAUA CAIRO DOS SANTOS DE SOUZA, OZIEL GOMES DE JESUS,
--                 GUSTAVO COSTA DA SILVA / GUSTAVO COSTA
--
-- Tambem corrige o carimbo das linhas 6, 9, 11 e 80: a migration 57 gravou
-- atualizado_em em UTC, 3 h a frente do horario de Brasilia que o app grava,
-- e a guarda jr_recusar_carimbo_regressivo ignoraria as edicoes do app nessas
-- linhas ate o relogio alcancar. A guarda fica desligada so durante o acerto.
-- =============================================================================

ALTER TABLE escala_matrizes DISABLE TRIGGER trg_escala_matrizes_guarda_carimbo;

UPDATE escala_matrizes SET atualizado_em = atualizado_em - interval '3 hours'
 WHERE id IN (6, 9, 11, 80) AND atualizado_por = 'MIGRATION 57';

UPDATE escala_matrizes SET motorista = 'NILMAR PEREIRA DOS SANTOS', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 1;
UPDATE escala_matrizes SET motorista = 'EDSON / ALESSANCO BARROS DE MOURA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 6;
UPDATE escala_matrizes SET motorista = 'RAIMUNDO CAVALCANTE SILVA FILHO / OZIEL GOMES', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 11;
UPDATE escala_matrizes SET ajudante = 'WESLY DA CONCEICAO LIMA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 15;
UPDATE escala_matrizes SET ajudante = 'RUBENS SILVA GONCALVES VIANA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 16;
UPDATE escala_matrizes SET ajudante = 'ANOEL FILHO TEIXEIRA DOS SANTOS', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 21;
UPDATE escala_matrizes SET ajudante = 'EDUARDO MENDANHA DOS SANTOS', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 25;
UPDATE escala_matrizes SET ajudante = 'KAUAN CLARINDO DE SOUSA SILVA / EDSON DOS SANTOS SILVA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 26;
UPDATE escala_matrizes SET ajudante = 'RENIO BARBOSA ARAUJO / MARCOS ROBERTO TIMOTEO DE LIMA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 28;
UPDATE escala_matrizes SET motorista = 'EDSON / ALESSANCO BARROS DE MOURA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 30;
UPDATE escala_matrizes SET ajudante = 'LUCAS CARLOS DA ROCHA / GUSTAVO COSTA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 37;
UPDATE escala_matrizes SET ajudante = 'ALISON DO CARMO LEITE', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 40;
UPDATE escala_matrizes SET ajudante = 'KAUAN CLARINDO DE SOUSA SILVA / MARCOS ROBERTO TIMOTEO DE LIMA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 43;
UPDATE escala_matrizes SET ajudante = 'RENIO BARBOSA ARAUJO / GUSTAVO COSTA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 44;
UPDATE escala_matrizes SET ajudante = 'MARCOS VINICIUS FARIAS DE SOUSA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 45;
UPDATE escala_matrizes SET ajudante = 'ALMIR ALVES DA SILVA FREITAS', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 47;
UPDATE escala_matrizes SET ajudante = 'WESLY DA CONCEICAO LIMA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 49;
UPDATE escala_matrizes SET ajudante = 'RUBENS SILVA GONCALVES VIANA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 50;
UPDATE escala_matrizes SET ajudante = 'EDUARDO MENDANHA DOS SANTOS', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 53;
UPDATE escala_matrizes SET ajudante = 'ANOEL FILHO TEIXEIRA DOS SANTOS', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 59;
UPDATE escala_matrizes SET motorista = 'RAIMUNDO CAVALCANTE SILVA FILHO / ALESSANCO BARROS DE MOURA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 62;
UPDATE escala_matrizes SET ajudante = 'KAUAN CLARINDO DE SOUSA SILVA / DOUGLAS ALEXANDRE SANTOS FERREIRA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 68;
UPDATE escala_matrizes SET ajudante = 'RENIO BARBOSA ARAUJO / LUCAS GOMES DA SILVA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 69;
UPDATE escala_matrizes SET ajudante = 'RAIMUNDO NONATO DE JESUS PEREIRA / ALMIR ALVES DA SILVA FREITAS', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 70;
UPDATE escala_matrizes SET ajudante = 'EDUARDO MENDANHA DOS SANTOS', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 77;
UPDATE escala_matrizes SET ajudante = 'LUIZ MIGUEL DE REZENDE SANTOS / ALISON DO CARMO LEITE', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 81;
UPDATE escala_matrizes SET ajudante = 'MARCOS VINICIUS FARIAS DE SOUSA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 86;
UPDATE escala_matrizes SET ajudante = 'KAUAN CLARINDO DE SOUSA SILVA / ALMIR ALVES DA SILVA FREITAS', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 88;
UPDATE escala_matrizes SET ajudante = 'JOAO MARCOS SANTOS OLIVEIRA / RENIO BARBOSA ARAUJO', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 89;
UPDATE escala_matrizes SET ajudante = 'GUSTAVO / RAIMUNDO NONATO DE JESUS PEREIRA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 90;
UPDATE escala_matrizes SET ajudante = 'EDUARDO MENDANHA DOS SANTOS / DOUGLAS ALEXANDRE SANTOS FERREIRA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 91;
UPDATE escala_matrizes SET motorista = 'ADEMAR FILHO SILVA DE OLIVEIRA', atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo') WHERE id = 97;

ALTER TABLE escala_matrizes ENABLE TRIGGER trg_escala_matrizes_guarda_carimbo;
