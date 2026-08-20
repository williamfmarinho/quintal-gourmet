/**
 * Cálculos e regras puras do negócio — sem acesso a banco nem a arquivo.
 *
 * Este módulo é compartilhado pelos dois modos de armazenamento (planilha Excel
 * local e Postgres no Supabase), garantindo que a conta do lucro seja exatamente
 * a mesma nos dois.
 */

/** Arredonda para centavos. */
const c = (valor) => Math.round((Number(valor) || 0) * 100) / 100;

class ErroDeNegocio extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

const TIPOS_SAIDA = {
  VENDA: 'Venda',
  PERDA: 'Perda / Vencimento',
  QUEBRA: 'Quebra / Avaria',
  DESPERDICIO: 'Desperdício',
  CONSUMO: 'Consumo interno',
  CORTESIA: 'Cortesia / Degustação',
  DEVOLUCAO: 'Devolução a fornecedor',
  TRANSFERENCIA: 'Transferência',
};

const MOTIVOS_AJUSTE = [
  'CONTAGEM DE INVENTÁRIO',
  'ERRO DE LANÇAMENTO',
  'COMPOSIÇÃO DE KIT',
  'PRODUÇÃO PRÓPRIA',
  'SOBRA DE PRODUÇÃO',
  'BAIXA MANUAL',
  'OUTRO',
];

const FORMAS_PAGAMENTO = [
  'DINHEIRO',
  'PIX',
  'CARTÃO DE DÉBITO',
  'CARTÃO DE CRÉDITO',
  'VALE ALIMENTAÇÃO',
  'FIADO / CADERNETA',
];

/* ------------------------------------------------------------------ *
 * Datas
 * ------------------------------------------------------------------ */

function inicioDoDia(texto) {
  const [a, m, d] = String(texto).split('-').map(Number);
  return new Date(a, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function fimDoDia(texto) {
  const [a, m, d] = String(texto).split('-').map(Number);
  return new Date(a, (m || 1) - 1, d || 1, 23, 59, 59, 999);
}

function dataLocalISO(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dentroDoPeriodo(valorISO, de, ate) {
  if (!valorISO) return false;
  const d = new Date(valorISO);
  if (Number.isNaN(d.getTime())) return false;
  if (de && d < de) return false;
  if (ate && d > ate) return false;
  return true;
}

/** Normaliza os parâmetros de período de uma consulta (padrão: últimos 30 dias). */
function periodo(consulta = {}) {
  const fim = consulta.ate ? fimDoDia(consulta.ate) : fimDoDia(dataLocalISO());
  const inicioTexto = consulta.de || dataLocalISO(new Date(fim.getTime() - 29 * 86400000));
  return { de: inicioDoDia(inicioTexto), ate: fim, deTexto: inicioTexto, ateTexto: dataLocalISO(fim) };
}

function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((new Date() - d) / 86400000);
}

/* ------------------------------------------------------------------ *
 * Produto
 * ------------------------------------------------------------------ */

function situacaoEstoque(produto) {
  if (produto.estoque <= 0) return 'ZERADO';
  if (produto.estoque <= produto.estoque_minimo) return 'CRÍTICO';
  if (produto.estoque <= produto.estoque_minimo * 1.5) return 'ATENÇÃO';
  return 'OK';
}

function enriquecerProduto(produto) {
  const margemValor = c(produto.preco_venda - produto.custo_medio);
  const margemPercent = produto.preco_venda > 0 ? (margemValor / produto.preco_venda) * 100 : 0;
  const marcacao = produto.custo_medio > 0 ? (margemValor / produto.custo_medio) * 100 : 0;
  return {
    ...produto,
    margem_valor: margemValor,
    margem_percentual: c(margemPercent),
    marcacao_percentual: c(marcacao),
    valor_estoque_custo: c(produto.estoque * produto.custo_medio),
    valor_estoque_venda: c(produto.estoque * produto.preco_venda),
    situacao: situacaoEstoque(produto),
    dias_sem_saida: diasDesde(produto.ultima_saida),
    dias_sem_entrada: diasDesde(produto.ultima_entrada),
  };
}

/** Média ponderada entre o estoque atual e a mercadoria que está entrando. */
function custoMedioPonderado(estoqueAtual, custoAtual, quantidade, custoNovo) {
  const estoque = Math.max(0, Number(estoqueAtual) || 0);
  const qtd = Number(quantidade) || 0;
  if (estoque + qtd <= 0) return c(custoNovo);
  return c((estoque * (Number(custoAtual) || 0) + qtd * (Number(custoNovo) || 0)) / (estoque + qtd));
}

/* ------------------------------------------------------------------ *
 * Venda
 * ------------------------------------------------------------------ */

/**
 * Valida os itens, aplica o desconto rateado e devolve tudo o que a venda precisa
 * gravar. Recebe os produtos já carregados para não depender do armazenamento.
 */
function prepararVenda({ itens, desconto = 0, pagamentos = [], produtosPorCodigo, permitirEstoqueNegativo = false }) {
  if (!Array.isArray(itens) || !itens.length) throw new ErroDeNegocio('Nenhum item na venda.');

  const preparados = itens.map((item) => {
    const chave = String(item.codigo || '').trim().toUpperCase();
    const produto = produtosPorCodigo[chave];
    if (!produto) throw new ErroDeNegocio(`Produto não encontrado: ${item.codigo}`);
    if (!produto.ativo) throw new ErroDeNegocio(`Produto inativo: ${produto.descricao}`);

    const quantidade = Number(item.quantidade);
    if (!(quantidade > 0)) throw new ErroDeNegocio(`Quantidade inválida para ${produto.descricao}.`);

    const preco = item.preco_unitario === undefined ? produto.preco_venda : c(item.preco_unitario);
    if (preco < 0) throw new ErroDeNegocio(`Preço inválido para ${produto.descricao}.`);

    const descontoItem = c(item.desconto || 0);
    const total = c(preco * quantidade - descontoItem);
    if (total < 0) throw new ErroDeNegocio(`Desconto maior que o valor do item ${produto.descricao}.`);

    return { produto, quantidade, preco, descontoItem, total };
  });

  if (!permitirEstoqueNegativo) {
    const necessario = {};
    preparados.forEach((p) => {
      necessario[p.produto.codigo] = c((necessario[p.produto.codigo] || 0) + p.quantidade);
    });
    Object.entries(necessario).forEach(([codigo, qtd]) => {
      const produto = produtosPorCodigo[codigo];
      if (produto.estoque < qtd) {
        throw new ErroDeNegocio(
          `Estoque insuficiente de ${produto.descricao}: disponível ${produto.estoque}, solicitado ${qtd}.`
        );
      }
    });
  }

  const subtotal = c(preparados.reduce((s, p) => s + p.total, 0));
  const descontoGeral = c(desconto);
  if (descontoGeral < 0) throw new ErroDeNegocio('Desconto inválido.');
  if (descontoGeral > subtotal) throw new ErroDeNegocio('Desconto maior que o total da venda.');
  const total = c(subtotal - descontoGeral);

  const formas = pagamentos.map((p) => ({
    forma: String(p.forma || '').toUpperCase().trim(),
    valor: c(p.valor),
    recebido: c(p.recebido || p.valor),
    parcelas: Number(p.parcelas) || 0,
  }));
  if (!formas.length) throw new ErroDeNegocio('Informe a forma de pagamento.');
  formas.forEach((p) => {
    if (!FORMAS_PAGAMENTO.includes(p.forma)) throw new ErroDeNegocio(`Forma de pagamento inválida: ${p.forma}`);
    if (p.valor <= 0) throw new ErroDeNegocio('Valor de pagamento inválido.');
  });

  const pago = c(formas.reduce((s, p) => s + p.valor, 0));
  if (pago + 0.005 < total) {
    throw new ErroDeNegocio(`Pagamento insuficiente: faltam ${(total - pago).toFixed(2)}.`);
  }

  const troco = c(pago - total);
  const emDinheiro = [...formas].reverse().find((p) => p.forma === 'DINHEIRO');
  if (troco > 0 && !emDinheiro) {
    throw new ErroDeNegocio('Só é possível dar troco em pagamentos com dinheiro.');
  }
  // O que sobra em dinheiro volta como troco: o valor lançado é o que ficou na
  // venda e o recebido guarda a nota que o cliente entregou.
  if (troco > 0) {
    emDinheiro.recebido = Math.max(emDinheiro.recebido, emDinheiro.valor);
    emDinheiro.valor = c(emDinheiro.valor - troco);
  }

  // Rateio do desconto geral proporcional ao valor de cada item.
  const fator = subtotal > 0 ? total / subtotal : 1;
  let custoTotal = 0;
  let quantidadeItens = 0;

  const itensFinais = preparados.map((p, indice) => {
    const totalLiquido = c(p.total * fator);
    const custoUnitario = c(p.produto.custo_medio);
    const custo = c(custoUnitario * p.quantidade);
    custoTotal += custo;
    quantidadeItens = c(quantidadeItens + p.quantidade);
    return {
      seq: indice + 1,
      codigo: p.produto.codigo,
      descricao: p.produto.descricao,
      quantidade: p.quantidade,
      preco_unitario: p.preco,
      desconto: c(p.descontoItem + (p.total - totalLiquido)),
      total: totalLiquido,
      custo_unitario: custoUnitario,
      custo_total: custo,
      lucro: c(totalLiquido - custo),
    };
  });

  custoTotal = c(custoTotal);

  return {
    itens: itensFinais,
    pagamentos: formas.map((p) => ({ ...p, troco: p === emDinheiro ? troco : 0 })),
    troco,
    quantidadeItens,
    subtotal,
    desconto: descontoGeral,
    total,
    custoTotal,
    lucro: c(total - custoTotal),
    dinheiroNoCaixa: c(formas.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + p.valor, 0)),
  };
}

/* ------------------------------------------------------------------ *
 * Relatórios (recebem as linhas já carregadas)
 * ------------------------------------------------------------------ */

function resumoDoCaixa(caixa, { vendas, pagamentos, movimentos }) {
  if (!caixa) return null;
  const porForma = {};
  pagamentos.forEach((p) => { porForma[p.forma] = c((porForma[p.forma] || 0) + p.valor); });

  const suprimentos = c(movimentos.filter((m) => m.tipo === 'SUPRIMENTO').reduce((s, m) => s + m.valor, 0));
  const sangrias = c(movimentos.filter((m) => m.tipo === 'SANGRIA').reduce((s, m) => s + m.valor, 0));
  const totalVendas = c(vendas.reduce((s, v) => s + v.total, 0));
  const dinheiro = c(porForma.DINHEIRO || 0);

  return {
    ...caixa,
    quantidade_vendas: vendas.length,
    total_vendas: totalVendas,
    lucro: c(vendas.reduce((s, v) => s + v.lucro, 0)),
    ticket_medio: vendas.length ? c(totalVendas / vendas.length) : 0,
    por_forma: porForma,
    suprimentos,
    sangrias,
    saldo_esperado: c(caixa.valor_abertura + dinheiro + suprimentos - sangrias),
    movimentos: movimentos.slice(-30).reverse(),
  };
}

function relatorioLucro({ vendas, itens, pagamentos, perdas, ajustes, compras, categoriaPorCodigo }, consulta = {}) {
  const { de, ate, deTexto, ateTexto } = periodo(consulta);

  const faturamento = c(vendas.reduce((s, v) => s + v.total, 0));
  const descontos = c(vendas.reduce((s, v) => s + v.desconto, 0));
  const cmv = c(vendas.reduce((s, v) => s + v.custo_total, 0));
  const lucroBruto = c(faturamento - cmv);
  const custoPerdas = c(perdas.reduce((s, p) => s + p.custo_total, 0));
  const impactoAjustes = c(ajustes.reduce((s, a) => s + a.impacto_custo, 0));
  const totalCompras = c(compras.reduce((s, e) => s + e.valor_total, 0));

  const dias = new Map();
  for (let d = new Date(de); d <= ate; d = new Date(d.getTime() + 86400000)) {
    dias.set(dataLocalISO(d), { dia: dataLocalISO(d), faturamento: 0, custo: 0, lucro: 0, vendas: 0 });
  }
  vendas.forEach((v) => {
    const chave = dataLocalISO(v.data);
    if (!dias.has(chave)) dias.set(chave, { dia: chave, faturamento: 0, custo: 0, lucro: 0, vendas: 0 });
    const linha = dias.get(chave);
    linha.faturamento = c(linha.faturamento + v.total);
    linha.custo = c(linha.custo + v.custo_total);
    linha.lucro = c(linha.lucro + v.lucro);
    linha.vendas += 1;
  });
  const serie = [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia));

  const porProduto = new Map();
  itens.forEach((i) => {
    if (!porProduto.has(i.codigo)) {
      porProduto.set(i.codigo, { codigo: i.codigo, descricao: i.descricao, quantidade: 0, faturamento: 0, custo: 0, lucro: 0 });
    }
    const linha = porProduto.get(i.codigo);
    linha.quantidade = c(linha.quantidade + i.quantidade);
    linha.faturamento = c(linha.faturamento + i.total);
    linha.custo = c(linha.custo + i.custo_total);
    linha.lucro = c(linha.lucro + i.lucro);
  });

  const produtos = [...porProduto.values()]
    .map((p) => ({ ...p, margem: p.faturamento > 0 ? c((p.lucro / p.faturamento) * 100) : 0 }))
    .sort((a, b) => b.faturamento - a.faturamento);

  let acumulado = 0;
  const abc = produtos.map((p) => {
    acumulado += p.faturamento;
    const participacao = faturamento > 0 ? (acumulado / faturamento) * 100 : 0;
    return {
      ...p,
      participacao: faturamento > 0 ? c((p.faturamento / faturamento) * 100) : 0,
      acumulado: c(participacao),
      classe: participacao <= 80 ? 'A' : participacao <= 95 ? 'B' : 'C',
    };
  });

  const catMapa = new Map();
  itens.forEach((i) => {
    const cat = categoriaPorCodigo[i.codigo] || 'SEM CATEGORIA';
    if (!catMapa.has(cat)) catMapa.set(cat, { categoria: cat, faturamento: 0, lucro: 0, quantidade: 0 });
    const linha = catMapa.get(cat);
    linha.faturamento = c(linha.faturamento + i.total);
    linha.lucro = c(linha.lucro + i.lucro);
    linha.quantidade = c(linha.quantidade + i.quantidade);
  });

  const formas = new Map();
  pagamentos.forEach((p) => {
    if (!formas.has(p.forma)) formas.set(p.forma, { forma: p.forma, valor: 0, quantidade: 0 });
    const linha = formas.get(p.forma);
    linha.valor = c(linha.valor + p.valor);
    linha.quantidade += 1;
  });

  const ops = new Map();
  vendas.forEach((v) => {
    if (!ops.has(v.operador)) ops.set(v.operador, { operador: v.operador, vendas: 0, faturamento: 0, lucro: 0 });
    const linha = ops.get(v.operador);
    linha.vendas += 1;
    linha.faturamento = c(linha.faturamento + v.total);
    linha.lucro = c(linha.lucro + v.lucro);
  });

  const tiposPerda = new Map();
  perdas.forEach((p) => {
    if (!tiposPerda.has(p.tipo)) tiposPerda.set(p.tipo, { tipo: p.tipo, quantidade: 0, custo: 0 });
    const linha = tiposPerda.get(p.tipo);
    linha.quantidade = c(linha.quantidade + p.quantidade);
    linha.custo = c(linha.custo + p.custo_total);
  });

  const diasComVenda = serie.filter((d) => d.vendas > 0).length || 1;

  return {
    periodo: { de: deTexto, ate: ateTexto, dias: serie.length },
    resumo: {
      faturamento,
      descontos,
      cmv,
      lucro_bruto: lucroBruto,
      margem_bruta: faturamento > 0 ? c((lucroBruto / faturamento) * 100) : 0,
      custo_perdas: custoPerdas,
      impacto_ajustes: impactoAjustes,
      lucro_liquido: c(lucroBruto - custoPerdas + Math.min(0, impactoAjustes)),
      compras: totalCompras,
      quantidade_vendas: vendas.length,
      itens_vendidos: c(itens.reduce((s, i) => s + i.quantidade, 0)),
      ticket_medio: vendas.length ? c(faturamento / vendas.length) : 0,
      media_diaria: c(faturamento / diasComVenda),
      dias_com_venda: diasComVenda,
    },
    serie,
    produtos,
    abc,
    por_categoria: [...catMapa.values()].sort((a, b) => b.faturamento - a.faturamento),
    por_pagamento: [...formas.values()].sort((a, b) => b.valor - a.valor),
    por_operador: [...ops.values()].sort((a, b) => b.faturamento - a.faturamento),
    perdas: {
      total_custo: custoPerdas,
      por_tipo: [...tiposPerda.values()].sort((a, b) => b.custo - a.custo),
      lancamentos: [...perdas].sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 50),
    },
  };
}

function montarPainel({ produtos, vendas, itens30, diasAlerta, metaDiaria }) {
  const hojeTexto = dataLocalISO();
  const inicioHoje = inicioDoDia(hojeTexto);
  const fimHoje = fimDoDia(hojeTexto);
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const ontem = new Date(inicioHoje.getTime() - 86400000);

  const enriquecidos = produtos.map(enriquecerProduto);
  const concluidas = vendas.filter((v) => v.status === 'CONCLUÍDA');
  const vendasHoje = concluidas.filter((v) => dentroDoPeriodo(v.data, inicioHoje, fimHoje));
  const vendasMes = concluidas.filter((v) => dentroDoPeriodo(v.data, inicioMes, fimHoje));
  const vendasOntem = concluidas.filter((v) => dentroDoPeriodo(v.data, ontem, new Date(inicioHoje.getTime() - 1)));

  const soma = (lista, campo) => c(lista.reduce((s, v) => s + v[campo], 0));

  const ultimos7 = [];
  for (let i = 6; i >= 0; i -= 1) {
    const dia = dataLocalISO(new Date(inicioHoje.getTime() - i * 86400000));
    const doDia = concluidas.filter((v) => dataLocalISO(v.data) === dia);
    ultimos7.push({ dia, faturamento: soma(doDia, 'total'), lucro: soma(doDia, 'lucro'), vendas: doDia.length });
  }

  const maisVendidos = new Map();
  itens30.forEach((i) => {
    if (!maisVendidos.has(i.codigo)) {
      maisVendidos.set(i.codigo, { codigo: i.codigo, descricao: i.descricao, quantidade: 0, total: 0 });
    }
    const linha = maisVendidos.get(i.codigo);
    linha.quantidade = c(linha.quantidade + i.quantidade);
    linha.total = c(linha.total + i.total);
  });

  return {
    hoje: {
      faturamento: soma(vendasHoje, 'total'),
      lucro: soma(vendasHoje, 'lucro'),
      vendas: vendasHoje.length,
      ticket_medio: vendasHoje.length ? c(soma(vendasHoje, 'total') / vendasHoje.length) : 0,
      meta: Number(metaDiaria) || 0,
    },
    ontem: { faturamento: soma(vendasOntem, 'total'), vendas: vendasOntem.length },
    mes: { faturamento: soma(vendasMes, 'total'), lucro: soma(vendasMes, 'lucro'), vendas: vendasMes.length },
    estoque: {
      itens: enriquecidos.length,
      valor_custo: c(enriquecidos.reduce((s, p) => s + p.valor_estoque_custo, 0)),
      valor_venda: c(enriquecidos.reduce((s, p) => s + p.valor_estoque_venda, 0)),
      criticos: enriquecidos.filter((p) => p.situacao === 'CRÍTICO').length,
      zerados: enriquecidos.filter((p) => p.situacao === 'ZERADO').length,
    },
    alertas: {
      estoque_baixo: enriquecidos
        .filter((p) => p.ativo && (p.situacao === 'CRÍTICO' || p.situacao === 'ZERADO'))
        .sort((a, b) => a.estoque - b.estoque)
        .slice(0, 12),
      parados: enriquecidos
        .filter((p) => p.ativo && p.dias_sem_saida !== null && p.dias_sem_saida >= diasAlerta)
        .sort((a, b) => b.dias_sem_saida - a.dias_sem_saida)
        .slice(0, 8),
      sem_margem: enriquecidos
        .filter((p) => p.ativo && p.preco_venda > 0 && p.margem_percentual < 15)
        .sort((a, b) => a.margem_percentual - b.margem_percentual)
        .slice(0, 8),
    },
    serie_7dias: ultimos7,
    mais_vendidos: [...maisVendidos.values()].sort((a, b) => b.quantidade - a.quantidade).slice(0, 8),
    ultimas_vendas: concluidas
      .slice()
      .sort((a, b) => new Date(a.data) - new Date(b.data))
      .slice(-8)
      .reverse(),
  };
}

function montarFicha(produto, { entradas, saidas, ajustes }) {
  const movimentos = [
    ...entradas.map((e) => ({
      data: e.data, tipo: 'ENTRADA', quantidade: e.quantidade, valor: e.valor_total,
      detalhe: e.fornecedor || e.documento || '', usuario: e.usuario,
    })),
    ...saidas.map((s) => ({
      data: s.data, tipo: s.tipo, quantidade: -s.quantidade, valor: s.valor_total,
      detalhe: s.tipo === 'VENDA' ? s.documento : s.motivo, usuario: s.usuario,
    })),
    ...ajustes.map((a) => ({
      data: a.data, tipo: 'AJUSTE', quantidade: a.quantidade, valor: a.impacto_custo,
      detalhe: a.motivo, usuario: a.usuario,
    })),
  ].sort((a, b) => new Date(b.data) - new Date(a.data));

  const vendidos = saidas.filter((s) => s.tipo === 'VENDA');
  const totalVendido = c(vendidos.reduce((s, v) => s + v.quantidade, 0));
  const faturado = c(vendidos.reduce((s, v) => s + v.valor_total, 0));
  const custoVendido = c(vendidos.reduce((s, v) => s + v.custo_total, 0));

  return {
    produto: enriquecerProduto(produto),
    movimentos: movimentos.slice(0, 60),
    historico: {
      total_entradas: c(entradas.reduce((s, e) => s + e.quantidade, 0)),
      total_vendido: totalVendido,
      total_perdas: c(saidas.filter((s) => s.tipo !== 'VENDA').reduce((s, p) => s + p.quantidade, 0)),
      total_ajustes: c(ajustes.reduce((s, a) => s + a.quantidade, 0)),
      faturamento: faturado,
      lucro: c(faturado - custoVendido),
      margem: faturado > 0 ? c(((faturado - custoVendido) / faturado) * 100) : 0,
      preco_medio: totalVendido > 0 ? c(faturado / totalVendido) : 0,
    },
  };
}

module.exports = {
  c,
  ErroDeNegocio,
  TIPOS_SAIDA,
  MOTIVOS_AJUSTE,
  FORMAS_PAGAMENTO,
  inicioDoDia,
  fimDoDia,
  dataLocalISO,
  dentroDoPeriodo,
  periodo,
  diasDesde,
  situacaoEstoque,
  enriquecerProduto,
  custoMedioPonderado,
  prepararVenda,
  resumoDoCaixa,
  relatorioLucro,
  montarPainel,
  montarFicha,
};
