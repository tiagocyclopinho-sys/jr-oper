# Pendências — JR Oper

Levantado em **07/09/2026**, durante a execução do plano *Janela do Feriado*
(v6.4.3 → v6.5.0). São coisas que o deploy de hoje **encostou mas não resolveu**,
e o motivo de cada uma ter ficado de fora está escrito junto.

Nenhuma delas bloqueia a operação. Todas somem da memória se não estiverem
escritas — é para isso que este arquivo existe.

---

## 1. O elo quebrado entre a escala e o cadastro de ajudantes

**Natureza:** dado, não código. **Não precisa de deploy.**

### O que está acontecendo

A escala traz o ajudante como **nome** (`controle_viagens.ajudante`, texto livre
vindo da planilha). O formulário da devolução tenta casar esse nome com uma
opção do `<select>`, cujos `value` são **ids** do cadastro. Quando não casa, ele
fabrica uma opção cujo `value` é o próprio nome. Do outro lado,
`parseInt('JOSE DA SILVA')` vira `NaN`, o `|| null` transforma em `null`
(`js/store.js:1571`) e a carga fica sem ajudante. Por fim `getDevolucoes()` lê só
`carga.ajudante_id` — sem o fallback que o motorista tem uma linha acima — e
devolve `'N/A'`.

A cadeia falha em silêncio nos cinco passos. Ninguém vê erro em lugar nenhum.

### Medido em 07/09/2026, na nuvem

| Medida | Valor |
|---|---|
| Ajudantes no cadastro | 38 |
| Cargas no total | 29 |
| Cargas **sem** `ajudante_id` | **12** |
| Viagens com nome de ajudante preenchido | 198 de 198 |

O cadastro existe e está populado. O problema não é ausência de ajudante — é
que o **nome não casa com o id**.

### Por que não foi feito hoje

Não é código e não passa por deploy. Altera dado antigo, então quer gente
olhando. Dá para fazer numa terça de manhã, com a operação em pé.

### Por que vem ANTES do item 2

Enquanto o elo estiver rompido, um segundo campo de ajudante nasce quebrado do
mesmo jeito que o primeiro — seriam dois campos apontando para o vazio em vez de
um. A conciliação também dá a **medida real** do problema: pode ser que a maioria
das viagens tenha um ajudante só, e o segundo campo seja menos urgente do que
parece hoje.

### O que já está estancado

O dinheiro parou de vazar na Etapa 10 de hoje (Bloco G). `equipeDaDevolucao()`
descarta `N/A`, `SEM AJUDANTE`, `A CADASTRAR` e companhia, e o recibo voltou a
cobrar **100% do motorista** quando não há ajudante de verdade — inclusive em
devolução antiga, porque o cálculo roda na hora de gerar o PDF. O que resta é
reconstruir o elo, e isso não sangra.

---

## 2. Segundo ajudante no Controle de Viagens

**Natureza:** funcionalidade. **Precisa de migration 40 + deploy (v6.6.0).**

Estava explicitamente fora do plano de hoje: *"o segundo ajudante (migration 40)
fica para outra janela e não está neste plano."*

### Faltam três coisas, não uma

1. **Banco** — `controle_viagens.ajudante` é `VARCHAR(120)`
   (`database/schema.sql:184`), uma vaga só. Segundo ajudante precisa de coluna
   nova. É a `migration_40`.
2. **Tela** — o formulário de viagem tem um `<select>` único, em
   `js/app.js:11700` (cadastro) e `js/app.js:11967` (edição).
3. **Recibo** — as duas vias do adiantamento são fixas no HTML. N pessoas
   exigem um laço no lugar das duas vias escritas à mão.

### O que JÁ está pronto para isso

O motor do rateio, instalado hoje na Etapa 10:

- `equipeDaDevolucao(dev)` percorre `dev.ajudantes` **como lista** antes de olhar
  o `ajudante_nome` isolado. Hoje essa lista nunca é preenchida — nenhum ponto do
  `store.js` escreve nela.
- `ratearValor(total, n)` divide **em centavos**, para qualquer N, e a soma fecha
  com o valor cobrado (R$ 100 / 3 = 33,34 + 33,33 + 33,33).

Quando a migration 40 vier, o cálculo do rateio **não precisa ser tocado**.

---

## 3. As 30 viagens FINALIZADO sem data de retorno

**Natureza:** dado histórico. **Não precisa de deploy.**

A partir da 6.5.0 (Bloco B, edição B.3), finalizar uma viagem carimba a data e a
hora de retorno automaticamente. Data digitada à mão nunca é sobrescrita.

Isso vale **de hoje em diante**. Medido em 07/09/2026, existem **30 viagens** já
em `FINALIZADO` com `data_retorno` vazio. Elas continuam assim — e é por isso que
a caixa *"Incluir as N viagens sem data de retorno"* foi criada no painel de
filtros: elas ficam visíveis e alcançáveis em vez de sumirem caladas.

Se um dia quiser preencher o histórico de uma vez, o plano deixou o SQL pronto —
confira a contagem primeiro, e só depois rode o `UPDATE`:

```sql
-- CONFIRA PRIMEIRO quantas linhas seriam tocadas:
SELECT count(*) FROM controle_viagens
 WHERE status_viagem = 'FINALIZADO'
   AND (data_retorno IS NULL OR data_retorno = '');

-- Só depois, se o número fizer sentido:
-- update controle_viagens
--    set data_retorno = coalesce(nullif(data_entrega,''), data_saida)
--  where status_viagem = 'FINALIZADO'
--    and (data_retorno is null or data_retorno = '')
--    and coalesce(nullif(data_entrega,''), data_saida) is not null;
```

Não é urgente e altera dado antigo. Outra janela.
