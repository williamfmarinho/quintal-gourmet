/**
 * Camada de persistência do sistema.
 *
 * Toda a base do PDV vive em um único arquivo Excel (dados/Base PDV - Quintal Gourmet.xlsx).
 * Na inicialização o arquivo é lido inteiro para a memória; as operações trabalham em memória
 * e gravam o arquivo de volta em disco de forma serializada (uma escrita por vez) e atômica
 * (grava em arquivo temporário e renomeia), para não corromper a planilha.
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const PASTA_DADOS = path.join(__dirname, '..', '..', 'dados');
const ARQUIVO_BASE = path.join(PASTA_DADOS, 'Base PDV - Quintal Gourmet.xlsx');

/* ------------------------------------------------------------------ *
 * Estrutura das abas
 * ------------------------------------------------------------------ */

const T = {
  texto: 'texto',
  inteiro: 'inteiro',
  numero: 'numero',
  moeda: 'moeda',
  data: 'data',
  datahora: 'datahora',
  booleano: 'booleano',
};

const ESQUEMA = {
  PRODUTOS: [
    { chave: 'codigo', titulo: 'CÓDIGO', tipo: T.texto, largura: 12 },
    { chave: 'descricao', titulo: 'DESCRIÇÃO', tipo: T.texto, largura: 42 },
    { chave: 'codigo_barras', titulo: 'CÓD. BARRAS', tipo: T.texto, largura: 16 },
    { chave: 'categoria', titulo: 'CATEGORIA', tipo: T.texto, largura: 18 },
    { chave: 'unidade', titulo: 'UN', tipo: T.texto, largura: 6 },
    { chave: 'preco_venda', titulo: 'PREÇO VENDA', tipo: T.moeda, largura: 14 },
    { chave: 'custo_medio', titulo: 'CUSTO MÉDIO', tipo: T.moeda, largura: 14 },
    { chave: 'estoque', titulo: 'ESTOQUE', tipo: T.numero, largura: 10 },
    { chave: 'estoque_minimo', titulo: 'EST. MÍNIMO', tipo: T.numero, largura: 12 },
    { chave: 'ativo', titulo: 'ATIVO', tipo: T.booleano, largura: 8 },
    { chave: 'ultima_entrada', titulo: 'ÚLT. ENTRADA', tipo: T.data, largura: 14 },
    { chave: 'ultima_saida', titulo: 'ÚLT. SAÍDA', tipo: T.data, largura: 14 },
    { chave: 'criado_em', titulo: 'CRIADO EM', tipo: T.datahora, largura: 18 },
    { chave: 'atualizado_em', titulo: 'ATUALIZADO EM', tipo: T.datahora, largura: 18 },
    { chave: 'foto', titulo: 'FOTO', tipo: T.texto, largura: 26 },
  ],

  ENTRADAS: [
    { chave: 'id', titulo: 'ID', tipo: T.inteiro, largura: 8 },
    { chave: 'data', titulo: 'DATA/HORA', tipo: T.datahora, largura: 18 },
    { chave: 'codigo', titulo: 'CÓDIGO', tipo: T.texto, largura: 12 },
    { chave: 'descricao', titulo: 'DESCRIÇÃO', tipo: T.texto, largura: 42 },
    { chave: 'quantidade', titulo: 'QTD', tipo: T.numero, largura: 9 },
    { chave: 'custo_unitario', titulo: 'CUSTO UNIT.', tipo: T.moeda, largura: 14 },
    { chave: 'valor_total', titulo: 'VALOR TOTAL', tipo: T.moeda, largura: 14 },
    { chave: 'fornecedor', titulo: 'FORNECEDOR', tipo: T.texto, largura: 26 },
    { chave: 'documento', titulo: 'DOCUMENTO/NF', tipo: T.texto, largura: 16 },
    { chave: 'custo_medio_anterior', titulo: 'CMÉD. ANTERIOR', tipo: T.moeda, largura: 15 },
    { chave: 'custo_medio_novo', titulo: 'CMÉD. NOVO', tipo: T.moeda, largura: 14 },
    { chave: 'usuario', titulo: 'USUÁRIO', tipo: T.texto, largura: 14 },
    { chave: 'observacao', titulo: 'OBSERVAÇÃO', tipo: T.texto, largura: 30 },
  ],

  SAIDAS: [
    { chave: 'id', titulo: 'ID', tipo: T.inteiro, largura: 8 },
    { chave: 'data', titulo: 'DATA/HORA', tipo: T.datahora, largura: 18 },
    { chave: 'codigo', titulo: 'CÓDIGO', tipo: T.texto, largura: 12 },
    { chave: 'descricao', titulo: 'DESCRIÇÃO', tipo: T.texto, largura: 42 },
    { chave: 'tipo', titulo: 'TIPO', tipo: T.texto, largura: 14 },
    { chave: 'quantidade', titulo: 'QTD', tipo: T.numero, largura: 9 },
    { chave: 'valor_unitario', titulo: 'VLR. UNIT.', tipo: T.moeda, largura: 13 },
    { chave: 'valor_total', titulo: 'VLR. TOTAL', tipo: T.moeda, largura: 13 },
    { chave: 'custo_unitario', titulo: 'CUSTO UNIT.', tipo: T.moeda, largura: 13 },
    { chave: 'custo_total', titulo: 'CUSTO TOTAL', tipo: T.moeda, largura: 13 },
    { chave: 'motivo', titulo: 'MOTIVO', tipo: T.texto, largura: 24 },
    { chave: 'documento', titulo: 'DOCUMENTO', tipo: T.texto, largura: 16 },
    { chave: 'usuario', titulo: 'USUÁRIO', tipo: T.texto, largura: 14 },
    { chave: 'observacao', titulo: 'OBSERVAÇÃO', tipo: T.texto, largura: 30 },
  ],

  AJUSTES: [
    { chave: 'id', titulo: 'ID', tipo: T.inteiro, largura: 8 },
    { chave: 'data', titulo: 'DATA/HORA', tipo: T.datahora, largura: 18 },
    { chave: 'codigo', titulo: 'CÓDIGO', tipo: T.texto, largura: 12 },
    { chave: 'descricao', titulo: 'DESCRIÇÃO', tipo: T.texto, largura: 42 },
    { chave: 'quantidade', titulo: 'QTD AJUSTE', tipo: T.numero, largura: 12 },
    { chave: 'estoque_anterior', titulo: 'EST. ANTERIOR', tipo: T.numero, largura: 14 },
    { chave: 'estoque_novo', titulo: 'EST. NOVO', tipo: T.numero, largura: 12 },
    { chave: 'motivo', titulo: 'MOTIVO', tipo: T.texto, largura: 24 },
    { chave: 'impacto_custo', titulo: 'IMPACTO R$', tipo: T.moeda, largura: 13 },
    { chave: 'usuario', titulo: 'USUÁRIO', tipo: T.texto, largura: 14 },
    { chave: 'observacao', titulo: 'OBSERVAÇÃO', tipo: T.texto, largura: 34 },
  ],

  VENDAS: [
    { chave: 'id', titulo: 'ID', tipo: T.inteiro, largura: 8 },
    { chave: 'numero', titulo: 'CUPOM', tipo: T.texto, largura: 14 },
    { chave: 'data', titulo: 'DATA/HORA', tipo: T.datahora, largura: 18 },
    { chave: 'operador', titulo: 'OPERADOR', tipo: T.texto, largura: 16 },
    { chave: 'cliente', titulo: 'CLIENTE', tipo: T.texto, largura: 24 },
    { chave: 'itens', titulo: 'ITENS', tipo: T.numero, largura: 8 },
    { chave: 'subtotal', titulo: 'SUBTOTAL', tipo: T.moeda, largura: 13 },
    { chave: 'desconto', titulo: 'DESCONTO', tipo: T.moeda, largura: 13 },
    { chave: 'total', titulo: 'TOTAL', tipo: T.moeda, largura: 13 },
    { chave: 'custo_total', titulo: 'CUSTO', tipo: T.moeda, largura: 13 },
    { chave: 'lucro', titulo: 'LUCRO', tipo: T.moeda, largura: 13 },
    { chave: 'pagamento', titulo: 'PAGAMENTO', tipo: T.texto, largura: 26 },
    { chave: 'status', titulo: 'STATUS', tipo: T.texto, largura: 14 },
    { chave: 'caixa_id', titulo: 'CAIXA', tipo: T.inteiro, largura: 8 },
    { chave: 'observacao', titulo: 'OBSERVAÇÃO', tipo: T.texto, largura: 30 },
  ],

  VENDA_ITENS: [
    { chave: 'venda_id', titulo: 'VENDA', tipo: T.inteiro, largura: 8 },
    { chave: 'seq', titulo: 'SEQ', tipo: T.inteiro, largura: 6 },
    { chave: 'data', titulo: 'DATA/HORA', tipo: T.datahora, largura: 18 },
    { chave: 'codigo', titulo: 'CÓDIGO', tipo: T.texto, largura: 12 },
    { chave: 'descricao', titulo: 'DESCRIÇÃO', tipo: T.texto, largura: 42 },
    { chave: 'quantidade', titulo: 'QTD', tipo: T.numero, largura: 9 },
    { chave: 'preco_unitario', titulo: 'PREÇO UNIT.', tipo: T.moeda, largura: 13 },
    { chave: 'desconto', titulo: 'DESCONTO', tipo: T.moeda, largura: 12 },
    { chave: 'total', titulo: 'TOTAL', tipo: T.moeda, largura: 13 },
    { chave: 'custo_unitario', titulo: 'CUSTO UNIT.', tipo: T.moeda, largura: 13 },
    { chave: 'custo_total', titulo: 'CUSTO TOTAL', tipo: T.moeda, largura: 13 },
    { chave: 'lucro', titulo: 'LUCRO', tipo: T.moeda, largura: 13 },
  ],

  PAGAMENTOS: [
    { chave: 'venda_id', titulo: 'VENDA', tipo: T.inteiro, largura: 8 },
    { chave: 'data', titulo: 'DATA/HORA', tipo: T.datahora, largura: 18 },
    { chave: 'forma', titulo: 'FORMA', tipo: T.texto, largura: 18 },
    { chave: 'valor', titulo: 'VALOR', tipo: T.moeda, largura: 13 },
    { chave: 'recebido', titulo: 'RECEBIDO', tipo: T.moeda, largura: 13 },
    { chave: 'troco', titulo: 'TROCO', tipo: T.moeda, largura: 12 },
    { chave: 'parcelas', titulo: 'PARCELAS', tipo: T.inteiro, largura: 10 },
  ],

  CAIXAS: [
    { chave: 'id', titulo: 'ID', tipo: T.inteiro, largura: 8 },
    { chave: 'operador', titulo: 'OPERADOR', tipo: T.texto, largura: 18 },
    { chave: 'aberto_em', titulo: 'ABERTO EM', tipo: T.datahora, largura: 18 },
    { chave: 'fechado_em', titulo: 'FECHADO EM', tipo: T.datahora, largura: 18 },
    { chave: 'valor_abertura', titulo: 'ABERTURA R$', tipo: T.moeda, largura: 13 },
    { chave: 'vendas_total', titulo: 'VENDAS R$', tipo: T.moeda, largura: 13 },
    { chave: 'vendas_dinheiro', titulo: 'DINHEIRO R$', tipo: T.moeda, largura: 13 },
    { chave: 'suprimentos', titulo: 'SUPRIMENTOS', tipo: T.moeda, largura: 13 },
    { chave: 'sangrias', titulo: 'SANGRIAS', tipo: T.moeda, largura: 13 },
    { chave: 'saldo_esperado', titulo: 'ESPERADO R$', tipo: T.moeda, largura: 13 },
    { chave: 'saldo_informado', titulo: 'CONTADO R$', tipo: T.moeda, largura: 13 },
    { chave: 'diferenca', titulo: 'DIFERENÇA', tipo: T.moeda, largura: 13 },
    { chave: 'status', titulo: 'STATUS', tipo: T.texto, largura: 12 },
    { chave: 'observacao', titulo: 'OBSERVAÇÃO', tipo: T.texto, largura: 30 },
  ],

  MOV_CAIXA: [
    { chave: 'id', titulo: 'ID', tipo: T.inteiro, largura: 8 },
    { chave: 'caixa_id', titulo: 'CAIXA', tipo: T.inteiro, largura: 8 },
    { chave: 'data', titulo: 'DATA/HORA', tipo: T.datahora, largura: 18 },
    { chave: 'tipo', titulo: 'TIPO', tipo: T.texto, largura: 14 },
    { chave: 'valor', titulo: 'VALOR', tipo: T.moeda, largura: 13 },
    { chave: 'motivo', titulo: 'MOTIVO', tipo: T.texto, largura: 30 },
    { chave: 'usuario', titulo: 'USUÁRIO', tipo: T.texto, largura: 14 },
  ],

  USUARIOS: [
    { chave: 'usuario', titulo: 'USUÁRIO', tipo: T.texto, largura: 16 },
    { chave: 'nome', titulo: 'NOME', tipo: T.texto, largura: 28 },
    { chave: 'perfil', titulo: 'PERFIL', tipo: T.texto, largura: 14 },
    { chave: 'salt', titulo: 'SALT', tipo: T.texto, largura: 34 },
    { chave: 'hash', titulo: 'HASH', tipo: T.texto, largura: 70 },
    { chave: 'ativo', titulo: 'ATIVO', tipo: T.booleano, largura: 8 },
    { chave: 'criado_em', titulo: 'CRIADO EM', tipo: T.datahora, largura: 18 },
    { chave: 'ultimo_acesso', titulo: 'ÚLTIMO ACESSO', tipo: T.datahora, largura: 18 },
  ],

  CONFIG: [
    { chave: 'chave', titulo: 'CHAVE', tipo: T.texto, largura: 24 },
    { chave: 'valor', titulo: 'VALOR', tipo: T.texto, largura: 60 },
  ],
};

const ABAS = Object.keys(ESQUEMA);

/* ------------------------------------------------------------------ *
 * Estado em memória
 * ------------------------------------------------------------------ */

const base = {};
ABAS.forEach((aba) => { base[aba] = []; });

let carregada = false;
let filaGravacao = Promise.resolve();
let gravacaoPendente = false;

/* ------------------------------------------------------------------ *
 * Conversões
 * ------------------------------------------------------------------ */

function paraTexto(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'object') {
    if (valor instanceof Date) return valor.toISOString();
    if (valor.text) return String(valor.text);
    if (valor.result !== undefined) return String(valor.result);
    if (Array.isArray(valor.richText)) return valor.richText.map((p) => p.text).join('');
    return String(valor);
  }
  return String(valor);
}

function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'object' && valor.result !== undefined) return Number(valor.result) || 0;
  const n = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function paraDataISO(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return valor.toISOString();
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function normalizar(tipo, valor) {
  switch (tipo) {
    case T.inteiro: return Math.round(paraNumero(valor));
    case T.numero:
    case T.moeda: return paraNumero(valor);
    case T.data:
    case T.datahora: return paraDataISO(valor);
    case T.booleano: {
      if (typeof valor === 'boolean') return valor;
      const t = paraTexto(valor).trim().toUpperCase();
      return t === 'SIM' || t === 'TRUE' || t === '1' || t === 'VERDADEIRO';
    }
    default: return paraTexto(valor).trim();
  }
}

const FORMATOS = {
  [T.moeda]: 'R$ #,##0.00',
  [T.numero]: '#,##0.###',
  [T.inteiro]: '0',
  [T.data]: 'dd/mm/yyyy',
  [T.datahora]: 'dd/mm/yyyy hh:mm',
};

/* ------------------------------------------------------------------ *
 * Leitura / escrita do arquivo
 * ------------------------------------------------------------------ */

function existeBase() {
  return fs.existsSync(ARQUIVO_BASE);
}

async function carregar() {
  if (!existeBase()) {
    throw new Error(
      'Base de dados não encontrada. Rode "npm run semear" para gerar a base a partir da planilha original.'
    );
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ARQUIVO_BASE);

  ABAS.forEach((aba) => {
    base[aba] = [];
    const colunas = ESQUEMA[aba];
    const ws = wb.getWorksheet(aba);
    if (!ws) return;
    ws.eachRow((linha, numero) => {
      if (numero === 1) return; // cabeçalho
      const registro = {};
      let vazio = true;
      colunas.forEach((col, i) => {
        const bruto = linha.getCell(i + 1).value;
        if (bruto !== null && bruto !== undefined && bruto !== '') vazio = false;
        registro[col.chave] = normalizar(col.tipo, bruto);
      });
      if (!vazio) base[aba].push(registro);
    });
  });

  carregada = true;
  return base;
}

/**
 * Monta a pasta de trabalho. Sem argumento usa a base em memória; recebendo
 * `dados` ({ ABA: linhas }) exporta qualquer origem — inclusive o Postgres.
 */
function montarPlanilha(dados) {
  const origem = dados || base;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema PDV — Quintal Gourmet';
  wb.created = new Date();

  ABAS.forEach((aba) => {
    const colunas = ESQUEMA[aba];
    const ws = wb.addWorksheet(aba, {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { defaultRowHeight: 18 },
    });

    ws.columns = colunas.map((c) => ({ key: c.chave, width: c.largura }));

    const cabecalho = ws.addRow(colunas.map((c) => c.titulo));
    cabecalho.height = 24;
    cabecalho.eachCell((celula) => {
      celula.font = { bold: true, color: { argb: 'FFF6EFE4' }, size: 10, name: 'Consolas' };
      celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF221B16' } };
      celula.alignment = { vertical: 'middle', horizontal: 'center' };
      celula.border = { bottom: { style: 'thin', color: { argb: 'FFC4622D' } } };
    });

    (origem[aba] || []).forEach((registro) => {
      const linha = ws.addRow(
        colunas.map((c) => {
          const valor = registro[c.chave];
          if (c.tipo === T.data || c.tipo === T.datahora) return valor ? new Date(valor) : null;
          if (c.tipo === T.booleano) return valor ? 'SIM' : 'NÃO';
          if (c.tipo === T.moeda || c.tipo === T.numero || c.tipo === T.inteiro) {
            return valor === '' || valor === null || valor === undefined ? 0 : Number(valor);
          }
          return valor === undefined || valor === null || valor === '' ? null : valor;
        })
      );
      colunas.forEach((c, i) => {
        const formato = FORMATOS[c.tipo];
        if (formato) linha.getCell(i + 1).numFmt = formato;
      });
    });

    if (origem[aba] && origem[aba].length) {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: colunas.length },
      };
    }
  });

  return wb;
}

async function gravarAgora() {
  const wb = montarPlanilha();
  if (!fs.existsSync(PASTA_DADOS)) fs.mkdirSync(PASTA_DADOS, { recursive: true });
  const temporario = `${ARQUIVO_BASE}.tmp`;
  await wb.xlsx.writeFile(temporario);
  fs.renameSync(temporario, ARQUIVO_BASE);
}

/**
 * Enfileira a gravação. Chamadas simultâneas viram uma única gravação
 * ao final — as alterações já estão todas em memória.
 */
function salvar() {
  if (gravacaoPendente) return filaGravacao;
  gravacaoPendente = true;
  filaGravacao = filaGravacao
    .catch(() => {})
    .then(() => {
      gravacaoPendente = false;
      return gravarAgora();
    })
    .catch((erro) => {
      // Caso mais comum: a base está aberta no Excel e o Windows bloqueia a troca do arquivo.
      // Os dados seguem corretos em memória e a próxima gravação tenta de novo.
      console.error(
        '\n[atenção] Não foi possível gravar a base em disco:',
        erro.message,
        '\n          Feche o arquivo "Base PDV - Quintal Gourmet.xlsx" no Excel para que o sistema volte a salvar.\n'
      );
    });
  return filaGravacao;
}

/* ------------------------------------------------------------------ *
 * Utilitários de tabela
 * ------------------------------------------------------------------ */

function tabela(nome) {
  if (!base[nome]) throw new Error(`Aba desconhecida: ${nome}`);
  return base[nome];
}

function proximoId(nome, campo = 'id') {
  const linhas = tabela(nome);
  let maior = 0;
  linhas.forEach((l) => {
    const v = Number(l[campo]) || 0;
    if (v > maior) maior = v;
  });
  return maior + 1;
}

function inserir(nome, registro) {
  const colunas = ESQUEMA[nome];
  const limpo = {};
  colunas.forEach((c) => { limpo[c.chave] = normalizar(c.tipo, registro[c.chave]); });
  tabela(nome).push(limpo);
  return limpo;
}

/** Normaliza um valor único conforme o tipo declarado da coluna. */
function normalizarCampo(nome, campo, valor) {
  const coluna = (ESQUEMA[nome] || []).find((c) => c.chave === campo);
  return coluna ? normalizar(coluna.tipo, valor) : valor;
}

function definirConfig(chave, valor) {
  const linha = tabela('CONFIG').find((c) => c.chave === chave);
  if (linha) linha.valor = String(valor);
  else inserir('CONFIG', { chave, valor: String(valor) });
}

function lerConfig(chave, padrao = '') {
  const linha = tabela('CONFIG').find((c) => c.chave === chave);
  return linha ? linha.valor : padrao;
}

module.exports = {
  ARQUIVO_BASE,
  PASTA_DADOS,
  ESQUEMA,
  ABAS,
  T,
  base,
  existeBase,
  carregar,
  salvar,
  gravarAgora,
  montarPlanilha,
  tabela,
  proximoId,
  inserir,
  definirConfig,
  lerConfig,
  normalizar,
  normalizarCampo,
  estaCarregada: () => carregada,
};
