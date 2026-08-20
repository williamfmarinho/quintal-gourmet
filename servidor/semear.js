/**
 * Geração da base do PDV a partir da planilha original do Quintal Gourmet.
 *
 * A planilha original ("Controle de Estoque - Quintal Gourmet.xlsx") é apenas LIDA —
 * nunca é alterada. Todo o histórico dela (produtos, custo médio, entradas, saídas e
 * ajustes) é convertido para o formato operacional do sistema.
 *
 *   node servidor/semear.js            → cria a base se ela ainda não existir
 *   node servidor/semear.js --forcar   → recria do zero (apaga a base atual)
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const planilha = require('./armazenamento/planilha');
const { criarSenha } = require('./auth');

// A planilha original acompanha o repositório; se o sistema estiver rodando
// dentro da pasta de trabalho do Quintal Gourmet, usa a que está um nível acima.
const CANDIDATOS_ORIGEM = [
  path.join(__dirname, '..', 'banco', 'origem', 'Controle de Estoque - Quintal Gourmet.xlsx'),
  path.join(__dirname, '..', '..', 'Controle de Estoque - Quintal Gourmet.xlsx'),
];

const ORIGEM = CANDIDATOS_ORIGEM.find((caminho) => fs.existsSync(caminho)) || CANDIDATOS_ORIGEM[0];

/* ----------------------------- utilidades ----------------------------- */

// Gerador pseudoaleatório determinístico: a base semeada é sempre idêntica.
function sorteador(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const numero = (v) => (typeof v === 'number' ? v : Number(String(v || '').replace(',', '.')) || 0);
const centavos = (v) => Math.round((Number(v) || 0) * 100) / 100;

function dataDe(valor, horas = 12, minutos = 0) {
  if (!valor) return null;
  const d = valor instanceof Date ? new Date(valor) : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), horas, minutos, 0);
}

function digitoEan13(base12) {
  let soma = 0;
  for (let i = 0; i < 12; i += 1) soma += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10;
}

function gerarEan13(sequencia) {
  const base12 = `789${String(sequencia).padStart(9, '0')}`;
  return base12 + digitoEan13(base12);
}

function categoriaDe(descricao) {
  const d = descricao.toUpperCase();
  if (d.includes('LINGUI')) return 'LINGUIÇAS';
  if (d.includes('KAFTA')) return 'KAFTAS';
  if (d.includes('TULIPA')) return 'TULIPAS';
  if (d.includes('HAMBURG')) return 'HAMBÚRGUERES';
  if (d.includes('DESFIAD')) return 'DESFIADOS';
  if (d.includes('FEIJOADA')) return 'PRATOS PRONTOS';
  return 'ACOMPANHAMENTOS';
}

/* ------------------------ leitura da planilha origem ------------------------ */

function acharCabecalho(ws, marcador) {
  for (let l = 1; l <= Math.min(ws.rowCount, 30); l += 1) {
    const linha = ws.getRow(l);
    for (let c = 1; c <= Math.min(ws.columnCount, 30); c += 1) {
      const v = texto(linha.getCell(c).value).toUpperCase().replace(/\s+/g, '');
      if (v === marcador) return { linha: l, coluna: c };
    }
  }
  return null;
}

function lerBloco(ws, marcador, campos) {
  const inicio = acharCabecalho(ws, marcador);
  if (!inicio) return [];
  const registros = [];
  for (let l = inicio.linha + 1; l <= ws.rowCount; l += 1) {
    const linha = ws.getRow(l);
    const codigo = texto(linha.getCell(inicio.coluna).value);
    if (!codigo) continue;
    const registro = {};
    campos.forEach((campo, i) => {
      let valor = linha.getCell(inicio.coluna + i).value;
      if (valor && typeof valor === 'object' && valor.result !== undefined) valor = valor.result;
      registro[campo] = valor;
    });
    registros.push(registro);
  }
  return registros;
}

async function lerOrigem() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ORIGEM);

  const abaProdutos = wb.worksheets.find((w) => w.name.toUpperCase().startsWith('PRODUTO'));
  const abaEntradas = wb.worksheets.find((w) => w.name.toUpperCase().startsWith('ENTRADA'));
  const abaSaidas = wb.worksheets.find((w) => w.name.toUpperCase().startsWith('SA'));
  const abaAjustes = wb.worksheets.find((w) => w.name.toUpperCase().startsWith('AJUSTE'));

  const produtos = lerBloco(abaProdutos, 'COD_ITEM', [
    'codigo', 'descricao', 'cad1', 'cad2', 'cad3',
    'estoque_inicial', 'ctm_inicial', 'entradas', 'saidas', 'ajustes',
    'estoque_final', 'ctm_atual', 'ultima_entrada', 'ultima_saida', 'ultimo_ajuste',
  ]);

  const entradas = lerBloco(abaEntradas, 'COD_ITEM', [
    'codigo', 'nf', 'data', 'quantidade', 'valor_total', 'valor_unitario',
  ]);

  const saidas = lerBloco(abaSaidas, 'COD_ITEM', [
    'codigo', 'nf', 'data', 'quantidade', 'valor_total', 'valor_unitario',
  ]);

  const ajustes = lerBloco(abaAjustes, 'COD_ITEM', [
    'codigo', 'data', 'quantidade', 'comentario1', 'comentario2',
  ]);

  return { produtos, entradas, saidas, ajustes };
}

/* ------------------------------- semeadura ------------------------------- */

const FORMAS = [
  { forma: 'PIX', peso: 38 },
  { forma: 'DINHEIRO', peso: 22 },
  { forma: 'CARTÃO DE CRÉDITO', peso: 24 },
  { forma: 'CARTÃO DE DÉBITO', peso: 16 },
];

function sortearForma(rnd) {
  const total = FORMAS.reduce((s, f) => s + f.peso, 0);
  let alvo = rnd() * total;
  for (const f of FORMAS) {
    alvo -= f.peso;
    if (alvo <= 0) return f.forma;
  }
  return 'PIX';
}

async function semear({ forcar = false, gravar = true, silencioso = false } = {}) {
  if (gravar && planilha.existeBase() && !forcar) {
    console.log('Base já existe em:', planilha.ARQUIVO_BASE);
    console.log('Use "npm run resetar" para recriar do zero.');
    return false;
  }

  if (!fs.existsSync(ORIGEM)) {
    throw new Error(`Planilha original não encontrada em: ${ORIGEM}`);
  }

  const origem = await lerOrigem();
  const rnd = sorteador(20260818);

  planilha.ABAS.forEach((aba) => { planilha.base[aba].length = 0; });

  /* ---- preço praticado: última saída registrada de cada item ---- */
  const precoPraticado = {};
  origem.saidas.forEach((s) => {
    const cod = texto(s.codigo).toUpperCase();
    const unit = centavos(numero(s.valor_unitario) || numero(s.valor_total) / (numero(s.quantidade) || 1));
    if (unit > 0) precoPraticado[cod] = unit;
  });

  /* ---- giro histórico (para sugerir estoque mínimo) ---- */
  const giro = {};
  origem.saidas.forEach((s) => {
    const cod = texto(s.codigo).toUpperCase();
    giro[cod] = (giro[cod] || 0) + numero(s.quantidade);
  });

  /* ------------------------------ PRODUTOS ------------------------------ */
  const agora = new Date().toISOString();
  const porCodigo = {};

  origem.produtos.forEach((p, i) => {
    const codigo = texto(p.codigo).toUpperCase();
    if (!codigo) return;
    const descricao = texto(p.descricao).replace(/\s+/g, ' ');
    const custo = centavos(numero(p.ctm_atual) || numero(p.ctm_inicial));
    const preco = precoPraticado[codigo] || centavos(Math.round(custo * 1.45) - 0.01);
    const estoque = numero(p.estoque_final);
    const vendidos = giro[codigo] || 0;
    const minimo = Math.max(3, Math.round((vendidos / 4) * 2)); // ~2 dias de giro

    const registro = planilha.inserir('PRODUTOS', {
      codigo,
      descricao,
      codigo_barras: gerarEan13(i + 1),
      categoria: categoriaDe(descricao),
      unidade: 'UN',
      preco_venda: preco,
      custo_medio: custo,
      estoque,
      estoque_minimo: minimo,
      ativo: true,
      ultima_entrada: dataDe(p.ultima_entrada) ? dataDe(p.ultima_entrada).toISOString() : '',
      ultima_saida: dataDe(p.ultima_saida) ? dataDe(p.ultima_saida).toISOString() : '',
      criado_em: agora,
      atualizado_em: agora,
    });
    porCodigo[codigo] = registro;
  });

  // Itens que aparecem nas movimentações mas não estão no cadastro original.
  const faltantes = new Set();
  [...origem.saidas, ...origem.entradas, ...origem.ajustes].forEach((m) => {
    const cod = texto(m.codigo).toUpperCase();
    if (cod && !porCodigo[cod]) faltantes.add(cod);
  });
  [...faltantes].forEach((codigo, i) => {
    const registro = planilha.inserir('PRODUTOS', {
      codigo,
      descricao: `ITEM ${codigo} (SEM CADASTRO NA PLANILHA ORIGINAL)`,
      codigo_barras: gerarEan13(900 + i),
      categoria: 'A CLASSIFICAR',
      unidade: 'UN',
      preco_venda: precoPraticado[codigo] || 0,
      custo_medio: 0,
      estoque: 0,
      estoque_minimo: 3,
      ativo: true,
      criado_em: agora,
      atualizado_em: agora,
    });
    porCodigo[codigo] = registro;
  });

  /* ------------------------------ ENTRADAS ------------------------------ */
  origem.entradas.forEach((e, i) => {
    const codigo = texto(e.codigo).toUpperCase();
    const produto = porCodigo[codigo];
    const qtd = numero(e.quantidade);
    const unit = centavos(numero(e.valor_unitario) || numero(e.valor_total) / (qtd || 1));
    const data = dataDe(e.data, 8, 30 + (i % 6) * 7) || new Date();
    planilha.inserir('ENTRADAS', {
      id: i + 1,
      data: data.toISOString(),
      codigo,
      descricao: produto ? produto.descricao : codigo,
      quantidade: qtd,
      custo_unitario: unit,
      valor_total: centavos(numero(e.valor_total) || qtd * unit),
      fornecedor: 'FORNECEDOR NÃO INFORMADO',
      documento: texto(e.nf),
      custo_medio_anterior: produto ? produto.custo_medio : 0,
      custo_medio_novo: produto ? produto.custo_medio : 0,
      usuario: 'importacao',
      observacao: 'Histórico importado da planilha original',
    });
  });

  /* -------------------- SAÍDAS + VENDAS (histórico) -------------------- */
  // As saídas da planilha original são agrupadas por dia em cupons de 1 a 3 itens,
  // reconstruindo um histórico de vendas realista para os relatórios.
  const porDia = new Map();
  origem.saidas.forEach((s) => {
    const data = dataDe(s.data);
    if (!data) return;
    const chave = data.toISOString().slice(0, 10);
    if (!porDia.has(chave)) porDia.set(chave, []);
    porDia.get(chave).push(s);
  });

  let idVenda = 0;
  let idSaida = 0;
  const diasOrdenados = [...porDia.keys()].sort();

  diasOrdenados.forEach((dia) => {
    const linhas = porDia.get(dia);
    let indice = 0;
    let minutoBase = 9 * 60 + Math.floor(rnd() * 40);

    while (indice < linhas.length) {
      const tamanho = Math.min(linhas.length - indice, 1 + Math.floor(rnd() * 2.4));
      const grupo = linhas.slice(indice, indice + tamanho);
      indice += tamanho;

      minutoBase += 12 + Math.floor(rnd() * 42);
      const hora = Math.min(21, Math.floor(minutoBase / 60));
      const minuto = minutoBase % 60;
      const quando = new Date(`${dia}T00:00:00`);
      quando.setHours(hora, minuto, Math.floor(rnd() * 60), 0);

      idVenda += 1;
      let subtotal = 0;
      let custoTotal = 0;
      let qtdItens = 0;

      grupo.forEach((s, seq) => {
        const codigo = texto(s.codigo).toUpperCase();
        const produto = porCodigo[codigo];
        const qtd = numero(s.quantidade) || 1;
        const unit = centavos(numero(s.valor_unitario) || numero(s.valor_total) / qtd);
        const total = centavos(numero(s.valor_total) || qtd * unit);
        const custoUnit = produto ? produto.custo_medio : 0;
        const custo = centavos(custoUnit * qtd);

        subtotal += total;
        custoTotal += custo;
        qtdItens += qtd;

        planilha.inserir('VENDA_ITENS', {
          venda_id: idVenda,
          seq: seq + 1,
          data: quando.toISOString(),
          codigo,
          descricao: produto ? produto.descricao : codigo,
          quantidade: qtd,
          preco_unitario: unit,
          desconto: 0,
          total,
          custo_unitario: custoUnit,
          custo_total: custo,
          lucro: centavos(total - custo),
        });

        idSaida += 1;
        planilha.inserir('SAIDAS', {
          id: idSaida,
          data: quando.toISOString(),
          codigo,
          descricao: produto ? produto.descricao : codigo,
          tipo: 'VENDA',
          quantidade: qtd,
          valor_unitario: unit,
          valor_total: total,
          custo_unitario: custoUnit,
          custo_total: custo,
          motivo: '',
          documento: `QG-${String(idVenda).padStart(6, '0')}`,
          usuario: 'importacao',
          observacao: 'Histórico importado da planilha original',
        });
      });

      subtotal = centavos(subtotal);
      custoTotal = centavos(custoTotal);
      const forma = sortearForma(rnd);

      planilha.inserir('VENDAS', {
        id: idVenda,
        numero: `QG-${String(idVenda).padStart(6, '0')}`,
        data: quando.toISOString(),
        operador: 'importacao',
        cliente: '',
        itens: qtdItens,
        subtotal,
        desconto: 0,
        total: subtotal,
        custo_total: custoTotal,
        lucro: centavos(subtotal - custoTotal),
        pagamento: forma,
        status: 'CONCLUÍDA',
        caixa_id: 0,
        observacao: 'Histórico importado',
      });

      const recebido = forma === 'DINHEIRO' ? Math.ceil(subtotal / 10) * 10 : subtotal;
      planilha.inserir('PAGAMENTOS', {
        venda_id: idVenda,
        data: quando.toISOString(),
        forma,
        valor: subtotal,
        recebido,
        troco: centavos(recebido - subtotal),
        parcelas: forma === 'CARTÃO DE CRÉDITO' ? 1 : 0,
      });
    }
  });

  /* ------------------------------- AJUSTES ------------------------------- */
  origem.ajustes.forEach((a, i) => {
    const codigo = texto(a.codigo).toUpperCase();
    const produto = porCodigo[codigo];
    const qtd = numero(a.quantidade);
    const comentario = [texto(a.comentario1), texto(a.comentario2)].filter(Boolean).join(' / ');
    const data = dataDe(a.data, 18, 10 + i) || new Date();
    const ehKit = comentario.toUpperCase().includes('KIT');
    planilha.inserir('AJUSTES', {
      id: i + 1,
      data: data.toISOString(),
      codigo,
      descricao: produto ? produto.descricao : codigo,
      quantidade: qtd,
      estoque_anterior: 0,
      estoque_novo: 0,
      motivo: ehKit ? 'COMPOSIÇÃO DE KIT' : 'BAIXA MANUAL',
      impacto_custo: centavos(qtd * (produto ? produto.custo_medio : 0)),
      usuario: 'importacao',
      observacao: comentario ? `Histórico importado — ${comentario}` : 'Histórico importado',
    });
  });

  /* ------------------------------ USUÁRIOS ------------------------------ */
  const usuarios = [
    { usuario: 'admin', nome: 'William — Administrador', perfil: 'admin', senha: 'admin123' },
    { usuario: 'caixa', nome: 'Ana Beatriz — Caixa', perfil: 'operador', senha: 'caixa123' },
    { usuario: 'joao', nome: 'João Pedro — Caixa', perfil: 'operador', senha: 'joao123' },
  ];
  usuarios.forEach((u) => {
    const { salt, hash } = criarSenha(u.senha);
    planilha.inserir('USUARIOS', {
      usuario: u.usuario,
      nome: u.nome,
      perfil: u.perfil,
      salt,
      hash,
      ativo: true,
      criado_em: agora,
      ultimo_acesso: '',
    });
  });

  /* -------------------------------- CONFIG -------------------------------- */
  const config = {
    loja_nome: 'QUINTAL GOURMET',
    loja_slogan: 'Defumados & Artesanais',
    loja_documento: 'CNPJ 00.000.000/0001-00 (simulado)',
    loja_endereco: 'Rua do Quintal, 123 — Bairro Bom Jardim',
    loja_telefone: '(00) 00000-0000',
    cupom_rodape: 'Obrigado pela preferência! Volte sempre ao Quintal Gourmet.',
    proximo_cupom: String(idVenda + 1),
    meta_diaria: '900',
    alerta_dias_sem_movimento: '7',
    margem_alvo: '35',
    semeado_em: agora,
  };
  Object.entries(config).forEach(([chave, valor]) => planilha.definirConfig(chave, valor));

  if (gravar) await planilha.gravarAgora();
  if (silencioso) return planilha.base;

  if (gravar) console.log('Base criada em:', planilha.ARQUIVO_BASE);
  console.log(`  produtos ......... ${planilha.base.PRODUTOS.length}`);
  console.log(`  vendas ........... ${planilha.base.VENDAS.length}`);
  console.log(`  itens vendidos ... ${planilha.base.VENDA_ITENS.length}`);
  console.log(`  entradas ......... ${planilha.base.ENTRADAS.length}`);
  console.log(`  saídas ........... ${planilha.base.SAIDAS.length}`);
  console.log(`  ajustes .......... ${planilha.base.AJUSTES.length}`);
  console.log(`  usuários ......... ${planilha.base.USUARIOS.length}`);
  return planilha.base;
}

/** Gera a base em memória (sem gravar arquivo) — usado pela migração para o Postgres. */
async function gerarBase() {
  return semear({ forcar: true, gravar: false, silencioso: true });
}

if (require.main === module) {
  const forcar = process.argv.includes('--forcar') || process.argv.includes('-f');
  semear({ forcar })
    .then(() => process.exit(0))
    .catch((erro) => {
      console.error('Falha ao semear a base:', erro.message);
      process.exit(1);
    });
}

module.exports = { semear, gerarBase, ORIGEM };
