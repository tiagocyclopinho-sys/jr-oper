# Acerto de motoristas e ajudantes — resumo para continuar (27/11/2026)

## Objetivo
Substituir as rotinas WinThor 8003 (motorista) e 8009 (ajudante), que o Victor Hugo roda
uma por pessoa, imprime e não salva (~2 dias por mês). Criar um painel em LINK SEPARADO do
JR-Oper (como /banco-horas), com login e senha, para Tiago, Victor Hugo e Paulo Silva
(conferência final). Calcula o acerto, mostra os requisitos e guarda o PDF e a foto do mês.

## Já existe (pronto)
- `tools/gerar_planilha_requisitos.js` (.bat): gera a planilha mensal de Requisitos
  (`S:\Logistica\01 - LOGISTICA INFORMATIVO\20 - VICTOR HUGO\REQUISITOS\AAAA\REQUISITOS
  MOTORISTAS E AJUDANTES - MM.AAAA.xlsx`) a partir do JR-Oper: ocorrências, motor ocioso
  (CCO + total do rastreador), checklist, Fusion, devoluções ERRO MOTORISTA, condutas,
  pneus, faltas (dias pela viagem perdida) e folgas da Escala.
- `tools/atualizar_cadastro_requisitos.js` (+ .ps1): aplica a "Relação de Folha" do DP
  (ajudantes e motoristas) nas abas Motorista/Ajudante/BD. Código do DP = id do cadastro.
- Edge Function `sync-cco` + migration 54: motor ocioso do Power BI (modelo CCO) em
  `cco_motor_ocioso`, 06h10 e 13h10.
- 7.9.3: motivos FALTA DE CUIDADO COM PNEUS e PNEU DANIFICADO na Oc. Operacional.

## Feito em 27/11 (7.10.0, migration 85 aplicada, falta publicar)
- Página /acerto com o mesmo login e senha do JR-Oper (7.10.1, migration 86). Liberados: Tiago,
  Paulo Silva e Victor Hugo.
- Matriz de regras editável e versionada: Perfis, Pessoas, Rotas, Faixas, Compras, Parâmetros, Histórico.
- Falta preencher na tela: 41 rotas sem faixa e os nomes de rota das viagens que não casaram.

## Ainda NÃO construído (próxima etapa)
1. Link separado com login/senha (3 usuários). Valores em R$ liberados SÓ neste link.
2. Matriz de regras editável, com vigência (mês fechado não muda):
   - perfis: motorista padrão, carreteiro (Fagno, Célio; 120 t), carne (Silvestre;
     TONELADA CARNE), ajudante padrão, lombador/tombador (Gabriel; R$ 23/t, faixa 3);
   - cada perfil: t garantida, % comissão, bônus por entrega, R$/t fixo, valor de cada KPI;
   - pessoa → perfil; por pessoa/mês: Faixa de Transbordo (marcável, desligada),
     Tonelada Carne, tipo, Ajuda Extra, Observação;
   - rotas do JR-Oper → faixa, R$/t motorista, R$/t ajudante, % (semente = PCROTAEXP,
     editável; nomes casados sem acento + apelidos);
   - compras: fornecedor do frete → pessoa (carreteiros + aproveitamentos), faixa editável.
3. Cálculo do acerto (conferido com ADEMAR e ADRIANO, ago/26):
   - motorista = Σ peso líq (t) × R$/t da rota × % comissão + entregas × 0,25
     + KPIs OK + diferença até o garantido;
   - ajudante = Σ peso líq (t) × R$/t ajudante + KPIs OK + (garantido − peso) × R$/t médio;
   - peso líq = peso da carga − devolução (DEVOLITEM 12).
   KPIs motorista: manut. 200, pneus 100, sinistro 200, consumo 100, prazo rota 400,
   caixa 100, devolução 100, Fusion 400. Ajudante: devolução, pontualidade, prazo rota 100.
4. Abas do painel iguais às da planilha de Requisitos, incluindo Folgas e Faltas, onde o
   Victor valida descontado/abonado.
5. PDF por pessoa no formato atual, salvo automaticamente na pasta do mês, e foto
   congelada do mês na nuvem.
6. Prazo Rota automático: viagem que fecha depois da previsão da matriz + 15 h sem
   justificativa.
7. Acerto de Caixa: flag marcada pelo Victor (o Financeiro avisa).

## Fontes de dados
- Power BI "Motorista e Ajudantes": f_MOTORISTA, f_AJUDANTE, f_MOTORISTA transb,
  f_MOTORISTA ent (compras), PCFORNEC (FAIXA). Tem NUMENT (entregas).
- Power BI "Devolução": f_DEVOLUCAO (DEVOLITEM, TOTPESO) = mesma view da rotina.
- Faixas: CSV da PCROTAEXP (`C:\Users\thiago.ferreira\PCROTAEXP_202611271335.csv`).
- Valores de referência: `20 - VICTOR HUGO\MOTORISTAS E AJUDANTES REMUNERAÇÃO.xlsx`
  (desatualizada, assim como a rotina: por isso a matriz editável).
- Ligação compra → motorista pelo nome do fornecedor do frete (sem CPF; não ler dim_PCEMPR).

## Regras de negócio decididas
- Desligado no meio do mês não entra no fechamento.
- Devoluções: todas as ERRO MOTORISTA (o certo seria só "Descontar Produtividade",
  mas as tratativas do gestor estão atrasadas).
- Média de Consumo = motor ocioso até 2027 (depois, meta × realizado).
- Isenções de motor ocioso já são lançadas no JR-Oper.
- ARMANDO fica "ARMANO LIMA DA CUNHA" (código 18; no DP aparece "ATOS FELIPE": o filho
  emite a nota, combinado com a empresa).

## Teste
Refazer novembro/26 pelo sistema depois do fechamento manual do Victor e comparar
pessoa a pessoa com os PDFs.

## Atenção
- A pasta local está 186 envios atrás do GitHub (publicação pelo site). Enviar só os
  arquivos alterados; não fazer Commit de tudo pelo GitHub Desktop.
- No GitHub, os geradores estão também na raiz e em `supabase/functions/` (cópias velhas);
  o lugar certo é `tools/`.
- Detalhes completos no CLAUDE.md, seções "Requisitos de motoristas e ajudantes" e
  "Acerto de motoristas e ajudantes".
