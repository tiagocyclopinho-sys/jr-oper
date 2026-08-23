// Testes do filtro de período (Dashboard x Boletim) e da lista de Tipo de Erro.
//
// js/app.js é um arquivo de navegador de ~22 mil linhas que toca no DOM
// durante a carga, então não dá para carregá-lo inteiro no Node. Em vez de
// copiar as funções para cá (o que testaria uma cópia, não o sistema), o
// harness EXTRAI os blocos reais do arquivo pelo nome e avalia esse texto.
// Se alguém renomear ou apagar um deles, a extração falha e o teste acusa.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ORIGEM = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

function extrair(marcadorInicio, marcadorFim) {
  const i = ORIGEM.indexOf(marcadorInicio);
  if (i < 0) throw new Error(`Não encontrei "${marcadorInicio}" em js/app.js — o bloco foi renomeado ou removido?`);
  const j = ORIGEM.indexOf(marcadorFim, i);
  if (j < 0) throw new Error(`Não encontrei o fim "${marcadorFim}" a partir de "${marcadorInicio}".`);
  return ORIGEM.slice(i, j + marcadorFim.length);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([
  extrair('function dataNoPeriodo(', '\n}'),
  extrair('const CAMPOS_DATA_POR_COLECAO = {', '\n};'),
  extrair('function dataRefDoRegistro(', '\n}'),
  extrair('function registroNoPeriodo(', '\n}'),
  extrair('const TIPOS_ERRO = [', '\n];'),
  extrair('function opcoesTipoErro(', '\n}'),
  // `const` no topo de um runInContext não vira propriedade do contexto
  // (só `function` e `var` viram). Expõe os dois explicitamente.
  'this.TIPOS_ERRO = TIPOS_ERRO; this.CAMPOS_DATA_POR_COLECAO = CAMPOS_DATA_POR_COLECAO;'
].join('\n\n'), sandbox);

const { dataRefDoRegistro, registroNoPeriodo, TIPOS_ERRO, opcoesTipoErro, CAMPOS_DATA_POR_COLECAO } = sandbox;

let falhas = 0, passes = 0;
function ok(cond, titulo, detalhe) {
  if (cond) { passes++; console.log('  PASS  ' + titulo); }
  else { falhas++; console.log('  FALHA ' + titulo + (detalhe ? '\n        -> ' + detalhe : '')); }
}
function secao(t) { console.log('\n=== ' + t + ' ==='); }

// ---------------------------------------------------------------
secao('1. O bug relatado: Boletim dizia 0, Dashboard dizia 2');
{
  // Devolução real do sistema: só tem criado_em. Não existe data_abertura —
  // o campo é lido em vários pontos mas nunca é gravado por addDevolucao().
  const devolucao = { id: 1, criado_em: '2026-08-23T17:37:27.000Z', valor_reclamado: 2.0 };
  const DE = '2026-08-01', ATE = '2026-08-22';

  ok(dataRefDoRegistro(devolucao, 'ocorrencias_devolucao') === '2026-08-23',
     'a data de referência da devolução sai do criado_em',
     dataRefDoRegistro(devolucao, 'ocorrencias_devolucao'));

  ok(registroNoPeriodo(devolucao, 'ocorrencias_devolucao', DE, ATE) === false,
     'devolução de 23/08 fica FORA do período 01/08–22/08 (antes o Dashboard a incluía)');

  ok(registroNoPeriodo(devolucao, 'ocorrencias_devolucao', '2026-08-01', '2026-08-31') === true,
     'a mesma devolução entra quando o período a alcança');
}

// ---------------------------------------------------------------
secao('2. Campos que o Dashboard lia e que nunca são gravados');
{
  // Reproduz o filtro antigo do Dashboard para provar que ele era inerte.
  const filtroAntigo = (d, de, ate) => sandbox.dataNoPeriodo(d.data_abertura || d.data, de, ate);
  const devolucao = { criado_em: '2026-08-23T17:37:27.000Z' };

  ok(filtroAntigo(devolucao, '2026-01-01', '2026-01-02') === true,
     'confirmado: o filtro antigo aprovava a devolução até num período de janeiro');
  ok(registroNoPeriodo(devolucao, 'ocorrencias_devolucao', '2026-01-01', '2026-01-02') === false,
     'o filtro novo a rejeita corretamente');

  const chamadoRota = { criado_em: '2026-08-23T10:00:00.000Z' };
  ok(registroNoPeriodo(chamadoRota, 'ocorrencias_rota', '2026-08-01', '2026-08-22') === false,
     'chamado em rota também passou a respeitar o período');

  // controle_viagens grava data_saida, não data_viagem
  const viagem = { data_saida: '2026-08-23', hora_saida: '06:00' };
  ok(dataRefDoRegistro(viagem, 'controle_viagens') === '2026-08-23',
     'controle de viagens usa data_saida (o campo realmente gravado)');
  ok(registroNoPeriodo(viagem, 'controle_viagens', '2026-08-01', '2026-08-22') === false,
     'viagem de 23/08 fica fora do período 01/08–22/08');
}

// ---------------------------------------------------------------
secao('3. Dashboard e Boletim agora concordam');
{
  const devs = [
    { id: 1, criado_em: '2026-08-10T08:00:00.000Z' },
    { id: 2, criado_em: '2026-08-22T23:59:00.000Z' },
    { id: 3, criado_em: '2026-08-23T17:37:00.000Z' }
  ];
  const DE = '2026-08-01', ATE = '2026-08-22';
  const filtrados = devs.filter(d => registroNoPeriodo(d, 'ocorrencias_devolucao', DE, ATE));
  ok(filtrados.length === 2, `período 01–22/08 seleciona 2 das 3 devoluções (deu ${filtrados.length})`);
  ok(filtrados.every(d => d.id !== 3), 'a de 23/08 ficou de fora nas duas telas');
}

// ---------------------------------------------------------------
secao('4. Coleções que já funcionavam continuam iguais');
{
  const ocViagem = { data: '2026-08-15' };
  ok(registroNoPeriodo(ocViagem, 'ocorrencias_viagens', '2026-08-01', '2026-08-22') === true,
     'ocorrência de viagem (campo data) inalterada');
  const troca = { data: '2026-08-15', criado_em: '2026-08-23T10:00:00.000Z' };
  ok(dataRefDoRegistro(troca, 'trocas_veiculos') === '2026-08-15',
     'troca de veículo continua priorizando data sobre criado_em (comportamento anterior preservado)');
  const resumo = { data: '2026-08-20' };
  ok(registroNoPeriodo(resumo, 'resumo_diario_cd', '2026-08-01', '2026-08-22') === true,
     'resumo diário do CD inalterado');
}

// ---------------------------------------------------------------
secao('5. Registro sem data nenhuma não desaparece do sistema');
{
  const orfao = { id: 99 };
  ok(dataRefDoRegistro(orfao, 'ocorrencias_devolucao') === '', 'sem data de referência');
  ok(registroNoPeriodo(orfao, 'ocorrencias_devolucao', '2026-08-01', '2026-08-22') === true,
     'entra no período em vez de sumir de todas as telas');
}

// ---------------------------------------------------------------
secao('6. Tipo de Erro: saiu OUTRO, entrou ERRO CLIENTE');
{
  ok(!TIPOS_ERRO.includes('OUTRO'), 'OUTRO não é mais oferecido');
  ok(TIPOS_ERRO.includes('ERRO CLIENTE'), 'ERRO CLIENTE está na lista');
  ok(TIPOS_ERRO.length === 8, `a lista tem 8 categorias (tem ${TIPOS_ERRO.length})`);

  const ordenada = TIPOS_ERRO.slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));
  ok(JSON.stringify(ordenada) === JSON.stringify(TIPOS_ERRO), 'a lista está em ordem alfabética');

  // a lista é usada em três telas — todas devem apontar para a constante
  const usos = (ORIGEM.match(/= TIPOS_ERRO;/g) || []).length;
  ok(usos === 3, `as 3 telas usam a mesma constante (encontrei ${usos})`);
  ok(!/const (erros|tiposErro) = \["ERRO CARREGAMENTO"/.test(ORIGEM),
     'nenhuma cópia solta da lista sobrou no arquivo');
}

// ---------------------------------------------------------------
secao('7. Análises antigas classificadas como OUTRO não perdem o valor');
{
  const html = opcoesTipoErro('OUTRO');
  ok(html.includes('value="OUTRO" selected'), 'o valor antigo continua selecionado no campo');
  ok(html.includes('categoria antiga'), 'e aparece sinalizado como categoria antiga');
  ok(html.includes('value="ERRO CLIENTE"'), 'as categorias atuais seguem disponíveis para reclassificar');

  const novo = opcoesTipoErro('ERRO MOTORISTA');
  ok(novo.includes('value="ERRO MOTORISTA" selected'), 'categoria atual vem marcada');
  ok(!novo.includes('categoria antiga'), 'sem rótulo de legado quando o valor é atual');

  const vazio = opcoesTipoErro('');
  ok(!vazio.includes('selected'), 'devolução ainda não classificada abre sem seleção');
  ok(!vazio.includes('OUTRO'), 'e sem a opção OUTRO');
}

// ---------------------------------------------------------------
secao('8. Toda coleção filtrada tem campo de data declarado');
{
  const esperadas = ['ocorrencias_devolucao','ocorrencias_rota','controle_viagens',
                     'ocorrencias_viagens','trocas_veiculos','reentregas',
                     'resumo_diario_cd','retencoes_frota','sinistros'];
  const faltando = esperadas.filter(c => !CAMPOS_DATA_POR_COLECAO[c]);
  ok(faltando.length === 0, 'todas as coleções filtradas estão na tabela', faltando.join(', '));
  const semCampos = Object.keys(CAMPOS_DATA_POR_COLECAO).filter(c => !CAMPOS_DATA_POR_COLECAO[c].length);
  ok(semCampos.length === 0, 'nenhuma coleção com lista de campos vazia', semCampos.join(', '));
}

console.log('\n=======================================');
console.log(`  ${passes} passaram, ${falhas} falharam`);
console.log('=======================================');
process.exit(falhas ? 1 : 0);
