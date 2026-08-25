# Como conferir um aparelho

Roteiro de bolso para responder três perguntas, aparelho por aparelho:

1. **Este aparelho está na versão nova?**
2. **Ele está guardando lixo de uma versão antiga** (os 247 fantasmas da
   ETAPA 0)?
3. **O que ele salvou está mesmo chegando na nuvem?**

Use na **ETAPA 3** do [GO_LIVE.md](GO_LIVE.md) — a limpeza de cache — e sempre
que a sincronização parecer errada de novo.

> **Nada aqui altera dado.** Tudo neste arquivo é leitura. A única ação que
> muda alguma coisa é a limpeza de cache, e ela está marcada como tal.

---

## Antes de começar: qual é a versão nova

A cada entrega, a versão muda. **Anote aqui a versão do deploy atual** e
compare com o que os aparelhos mostrarem:

| Campo | Valor |
|---|---|
| Versão esperada (`buildSync`) | `sync-4.8.0` |
| Data do deploy | ____/____/______ |

Qualquer aparelho com versão **diferente** dessa está rodando código antigo.

---

# PARTE 1 — PC

## 1.1 O jeito fácil (depois do deploy): pela tela

**Governança & Lixeira → aba Aparelhos.**

Essa tela lista todos os aparelhos que abriram o app, com a versão de cada um,
quando foi visto pela última vez e quantos registros dele a nuvem recusou.
**Se ela existir e estiver preenchida, você não precisa de mais nada — pule
para a Parte 3.**

Ela depende de duas coisas terem sido feitas: a entrega das Ondas 1+2 (versão
`sync-4.8.0`) e a criação da tabela `dispositivos` no banco — a **ETAPA 2b**,
um arquivo SQL só, colado no Supabase logo depois do deploy.

Se a aba abrir dizendo que a tabela não existe, é porque a ETAPA 2b ainda não
foi rodada — a própria tela diz isso e aponta o arquivo. Se a aba não existir,
o aparelho ainda está na versão antiga; use o jeito manual abaixo.

## 1.2 O jeito manual: pelo console

Funciona em qualquer PC, com ou sem as Ondas 1+2.

1. Abra o app no navegador, **no aparelho que você quer conferir**
2. Aperte **`F12`** (se não abrir nada, tente `Ctrl + Shift + I`)
3. Vai abrir um painel na lateral ou embaixo. Clique na aba **`Console`**
4. Clique na linha vazia ao lado do `>` e digite exatamente:

   ```
   jrDiagnosticoSync()
   ```

5. Aperte **`Enter`**

### O que vai aparecer, e o que fazer

O resultado é um blocão de texto. Você só precisa olhar **quatro linhas**:

| Linha | Aparelho saudável | Se estiver diferente |
|---|---|---|
| `buildSync` | a versão da tabela lá em cima | **Está na versão antiga.** Faça a limpeza de cache (1.3) |
| `bloqueadosNaEscrita` | `null` | **Achou.** É um aparelho com cache contaminado — ver abaixo |
| `tabelasComPendencia` | `[]` (lista vazia) | Há coisa salva aqui que **não chegou na nuvem**. Olhe o `ultimoErro` e me mande |
| `ultimoErro` | `null` | Copie a mensagem inteira e me mande |

**Se `bloqueadosNaEscrita` não for `null`**, ele vem mais ou menos assim:

```
bloqueadosNaEscrita: {
  tabela:   "controle_viagens",
  total:    247,          <-- quantos registros contaminados este aparelho ainda guarda
  exemplos: [...],        <-- amostra das cargas, para você reconhecer
  quando:   "2026-08-22T..."
}
```

Junto vem uma linha ⚠️ em amarelo dizendo a mesma coisa em português.

**Isso é o achado que a ETAPA 3 procura.** Significa: este PC guarda registros
de uma versão antiga do app, e antes do deploy vinha empurrando esse lixo para
a nuvem a cada 30 segundos. A guarda na escrita **já está barrando** — nada
dali chega ao banco — mas o cache continua sujo até você limpar.

O número é medido a cada ciclo varrendo o que está guardado no aparelho, e não
apenas o que ele tentou enviar. Ou seja: ele continua aparecendo mesmo depois
de a guarda já ter barrado tudo uma vez.

**Anote o número (`total`) e qual máquina é.** É a resposta da pergunta "qual
aparelho carregava os 247 fantasmas", e ela só existe enquanto o cache não for
limpo. Depois da limpeza, some.

## 1.3 A limpeza (isto altera o aparelho)

Só depois de anotar o resultado acima.

1. Com o app aberto, aperte **`Ctrl + Shift + R`** (recarrega ignorando o
   cache)
2. Espere a tela carregar por inteiro e o indicador da nuvem ficar verde
3. Rode o `jrDiagnosticoSync()` de novo

**Tem que ficar assim:** `buildSync` na versão nova e `bloqueadosNaEscrita` em
`null`. Se o `bloqueadosNaEscrita` continuar preenchido depois disso, **pare e
me chame** — o `Ctrl + Shift + R` troca os arquivos do app, mas não apaga os
dados guardados no aparelho; nesse caso a limpeza precisa ser mais funda e tem
risco de perder o que ainda não subiu.

---

# PARTE 2 — CELULAR

**No celular não existe `F12`.** Não há console e não há como rodar
`jrDiagnosticoSync()`. É por isso que o celular é o ponto cego do
levantamento — e é por isso que a tela de Aparelhos existe.

## 2.1 Depois do deploy: pela tela, e é só isso

O celular **se identifica sozinho**: assim que abre o app na versão nova, ele
se publica na tabela `dispositivos`. Você confere **de qualquer PC**, sem
tocar no aparelho:

**Governança & Lixeira → aba Aparelhos.**

- Celular **na lista, com a versão nova** → está em dia
- Celular **na lista, com versão antiga** → ainda não atualizou: peça para a
  pessoa fazer o 2.2
- Celular **que não aparece na lista** → não abriu o app desde o deploy. **É o
  perfil de risco da ETAPA 3**: ainda tem o cache original e vai despejar tudo
  na primeira vez que for aberto. A guarda na escrita barra os fantasmas, mas
  ele não deve operar antes de aparecer ali

> Confira contra a **lista de aparelhos do PASSO E**, feita no dia. O que não
> aparecer na tela é exatamente o que falta.

## 2.2 A limpeza no celular (isto altera o aparelho)

1. Feche a aba do app **e o navegador inteiro** — não deixe em segundo plano
   (Android: botão de apps recentes e arrastar para fora; iPhone: arrastar
   para cima e para fora)
2. Abra o navegador de novo e entre no app
3. Espere carregar inteiro
4. **Puxe a tela para baixo** para forçar o recarregamento
5. Se o app estiver instalado como ícone na tela inicial, feche e reabra pelo
   ícone também

**Como confirmar que pegou:** volte no PC, em Governança → Aparelhos, e veja
se aquele celular agora aparece com a versão nova. O "visto por último" tem
que ser de agora.

## 2.3 Se a tela de Aparelhos ainda não existir

Enquanto as Ondas 1+2 não forem publicadas, **não existe jeito de ler o
diagnóstico de um celular** sem cabo USB e um PC preparado para depuração — o
que não vale o esforço aqui.

O procedimento nesse caso é o mais simples: **limpe todos os celulares da
lista, sem tentar descobrir quais estão sujos** (passo 2.2), e confirme o
resultado pela nuvem, na Parte 3. É trabalho a mais, mas é seguro — e é a
última vez, porque depois do deploy o aparelho passa a se identificar sozinho.

---

# PARTE 3 — Pela nuvem, sem tocar em aparelho nenhum

Confere o **resultado** do conjunto: não diz qual aparelho, diz se o problema
voltou. Rode no SQL Editor do Supabase (mesmo caminho do PASSO A do
GO_LIVE.md).

## 3.1 O detector de fantasma

```sql
SELECT count(*) AS fantasmas
  FROM controle_viagens
 WHERE is_deleted IS NOT TRUE
   AND data_saida IN ('INICIADO','NÃO INICIADO');
```

| Resultado | O que significa |
|---|---|
| `0` | Limpo. É como tem que ficar depois da `migration_25` |
| Maior que zero, **antes** da `migration_25` | Normal — são os 247 que ainda não foram expurgados |
| Maior que zero, **depois** da `migration_25`, e **subindo** | Algum aparelho está reenviando cache contaminado **e está na versão antiga** (se estivesse atualizado, a guarda na escrita barraria). Volte para a Parte 1 ou 2 e ache quem é |

**Anote o número e a data cada vez que rodar.** O que interessa não é o valor
de uma medição, é ele **subir** de uma para a outra.

## 3.2 A duplicação de importação

```sql
SELECT carga, count(*) AS vezes
  FROM controle_viagens
 WHERE is_deleted IS NOT TRUE
   AND coalesce(carga,'') <> ''
 GROUP BY carga
HAVING count(*) > 1
 ORDER BY vezes DESC;
```

Depois da `migration_25` isso tem que voltar **vazio** (`no rows returned`) —
a chave natural passa a impedir no próprio banco. Se voltar linha, **pare e me
avise**: significa que a chave única não foi criada.

---

# Resumo de bolso

| Quero saber | PC | Celular |
|---|---|---|
| Em que versão está | `jrDiagnosticoSync()` → `buildSync`, ou a aba Aparelhos | Aba Aparelhos, de qualquer PC |
| Se tem cache contaminado | `jrDiagnosticoSync()` → `bloqueadosNaEscrita` | Aba Aparelhos → coluna de recusas |
| Se o que salvei subiu | `jrDiagnosticoSync()` → `tabelasComPendencia` | Indicador da nuvem, no alto da tela |
| Se o fantasma voltou | consulta 3.1, no Supabase | a mesma |
| Limpar | `Ctrl + Shift + R` | fechar tudo, reabrir, puxar para baixo |

Qualquer resultado que não estiver nesta tabela: **copie a tela inteira e me
mande, sem tentar adivinhar.**
