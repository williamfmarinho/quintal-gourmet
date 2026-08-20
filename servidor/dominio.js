/**
 * Regras de negócio do PDV.
 *
 * Todas as funções recebem o adaptador de armazenamento (`repo`) — planilha Excel
 * ou Postgres — e usam apenas o contrato comum entre eles. Os cálculos ficam em
 * `calculos.js`, de forma que o resultado é idêntico nos dois modos.
 */

const calc = require('./calculos');

const {
  c, ErroDeNegocio, TIPOS_SAIDA, MOTIVOS_AJUSTE, FORMAS_PAGAMENTO,
  periodo, dataLocalISO, inicioDoDia, fimDoDia,
} = calc;

const agora = () => new Date().toISOString();

/* ------------------------------------------------------------------ *
 * Configuração
 * ------------------------------------------------------------------ */

async function dadosDaLoja(repo) {
  const config = await repo.config();
  return {
    nome: config.loja_nome || 'QUINTAL GOURMET',
    slogan: config.loja_slogan || '',
    documento: config.loja_documento || '',
    endereco: config.loja_endereco || '',
    telefone: config.loja_telefone || '',
    rodape: config.cupom_rodape || '',
  };
}

/* ------------------------------------------------------------------ *
 * Produtos
 * ------------------------------------------------------------------ */

async function porCodigoExato(repo, codigo) {
  const linhas = await repo.listar('produtos', { onde: { codigo: String(codigo || '').trim().toUpperCase() } });
  return linhas[0] || null;
}

async function exigirProduto(repo, codigo) {
  const produto = await repo.produto(codigo);
  if (!produto) throw new ErroDeNegocio(`Produto não encontrado: ${codigo}`, 404);
  return produto;
}

async function listarProdutos(repo, filtros = {}) {
  let lista = (await repo.listar('produtos')).map(calc.enriquecerProduto);

  if (filtros.incluirInativos !== 'true' && filtros.incluirInativos !== true) {
    lista = lista.filter((p) => p.ativo);
  }

  const termo = String(filtros.termo || '').trim().toUpperCase();
  if (termo) {
    lista = lista.filter((p) => (
      p.codigo.toUpperCase().includes(termo)
      || p.descricao.toUpperCase().includes(termo)
      || String(p.codigo_barras || '').includes(termo)
      || p.categoria.toUpperCase().includes(termo)
    ));
  }

  const categoria = String(filtros.categoria || '').trim().toUpperCase();
  if (categoria) lista = lista.filter((p) => p.categoria.toUpperCase() === categoria);

  const situacao = String(filtros.situacao || '').trim().toUpperCase();
  if (situacao) lista = lista.filter((p) => p.situacao === situacao);

  return lista.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

async function categorias(repo) {
  const mapa = new Map();
  (await repo.listar('produtos')).forEach((p) => {
    const nome = p.categoria || 'SEM CATEGORIA';
    mapa.set(nome, (mapa.get(nome) || 0) + 1);
  });
  return [...mapa.entries()]
    .map(([nome, itens]) => ({ nome, itens }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function salvarProduto(repo, dados, sessao) {
  const codigo = String(dados.codigo || '').trim().toUpperCase();
  if (!codigo) throw new ErroDeNegocio('Informe o código do produto.');
  if (!String(dados.descricao || '').trim()) throw new ErroDeNegocio('Informe a descrição do produto.');

  const preco = c(dados.preco_venda);
  if (preco < 0) throw new ErroDeNegocio('Preço de venda inválido.');

  const barras = String(dados.codigo_barras || '').trim();
  if (barras) {
    const conflitos = await repo.listar('produtos', { onde: { codigo_barras: barras } });
    const outro = conflitos.find((p) => String(p.codigo).toUpperCase() !== codigo);
    if (outro) throw new ErroDeNegocio(`Código de barras já usado pelo item ${outro.codigo}.`);
  }

  return repo.transacao(async (tx) => {
    const existente = await porCodigoExato(tx, codigo);
    const momento = agora();

    if (!existente) {
      const criado = await tx.inserir('produtos', {
        codigo,
        descricao: String(dados.descricao).trim(),
        codigo_barras: barras,
        categoria: String(dados.categoria || 'A CLASSIFICAR').trim().toUpperCase(),
        unidade: String(dados.unidade || 'UN').trim().toUpperCase(),
        preco_venda: preco,
        custo_medio: c(dados.custo_medio),
        estoque: Number(dados.estoque) || 0,
        estoque_minimo: Number(dados.estoque_minimo) || 0,
        ativo: dados.ativo === undefined ? true : Boolean(dados.ativo),
        criado_em: momento,
        atualizado_em: momento,
      });
      return calc.enriquecerProduto(criado);
    }

    const atualizado = await tx.atualizar('produtos', { codigo: existente.codigo }, {
      descricao: String(dados.descricao).trim(),
      codigo_barras: barras,
      categoria: String(dados.categoria || existente.categoria).trim().toUpperCase(),
      unidade: String(dados.unidade || existente.unidade).trim().toUpperCase(),
      preco_venda: preco,
      custo_medio: dados.custo_medio === undefined ? existente.custo_medio : c(dados.custo_medio),
      estoque_minimo: dados.estoque_minimo === undefined ? existente.estoque_minimo : Number(dados.estoque_minimo) || 0,
      ativo: dados.ativo === undefined ? existente.ativo : Boolean(dados.ativo),
      atualizado_em: momento,
    });
    return calc.enriquecerProduto(atualizado);
  });
}

async function fichaProduto(repo, codigo) {
  const produto = await exigirProduto(repo, codigo);
  const onde = { onde: { codigo: produto.codigo } };
  const [entradas, saidas, ajustes] = await Promise.all([
    repo.listar('entradas', onde),
    repo.listar('saidas', onde),
    repo.listar('ajustes', onde),
  ]);
  return calc.montarFicha(produto, { entradas, saidas, ajustes });
}

/* ------------------------------------------------------------------ *
 * Caixa
 * ------------------------------------------------------------------ */

async function caixaAbertoDe(repo, usuario) {
  const linhas = await repo.listar('caixas', { onde: { operador: usuario, status: 'ABERTO' } });
  return linhas[0] || null;
}

async function resumoCaixa(repo, caixa) {
  if (!caixa) return null;
  const vendas = (await repo.listar('vendas', { onde: { caixa_id: caixa.id, status: 'CONCLUÍDA' } }));
  const ids = vendas.map((v) => v.id);
  const [pagamentos, movimentos] = await Promise.all([
    ids.length ? repo.listar('pagamentos', { onde: { venda_id: { in: ids } } }) : [],
    repo.listar('mov_caixa', { onde: { caixa_id: caixa.id }, ordem: { campo: 'id' } }),
  ]);
  return calc.resumoDoCaixa(caixa, { vendas, pagamentos, movimentos });
}

async function abrirCaixa(repo, valorAbertura, sessao) {
  if (await caixaAbertoDe(repo, sessao.usuario)) {
    throw new ErroDeNegocio('Já existe um caixa aberto para este operador.');
  }

  const caixa = await repo.transacao(async (tx) => {
    const momento = agora();
    const novo = await tx.inserir('caixas', {
      operador: sessao.usuario,
      aberto_em: momento,
      fechado_em: '',
      valor_abertura: c(valorAbertura),
      status: 'ABERTO',
    });
    await tx.inserir('mov_caixa', {
      caixa_id: novo.id,
      data: momento,
      tipo: 'ABERTURA',
      valor: c(valorAbertura),
      motivo: 'Fundo de troco',
      usuario: sessao.usuario,
    });
    return novo;
  });

  return resumoCaixa(repo, caixa);
}

async function movimentarCaixa(repo, { tipo, valor, motivo }, sessao) {
  const caixa = await caixaAbertoDe(repo, sessao.usuario);
  if (!caixa) throw new ErroDeNegocio('Nenhum caixa aberto para este operador.');

  const t = String(tipo || '').toUpperCase();
  if (!['SANGRIA', 'SUPRIMENTO'].includes(t)) throw new ErroDeNegocio('Tipo de movimento inválido.');
  const v = c(valor);
  if (v <= 0) throw new ErroDeNegocio('Informe um valor maior que zero.');

  await repo.transacao((tx) => tx.inserir('mov_caixa', {
    caixa_id: caixa.id,
    data: agora(),
    tipo: t,
    valor: v,
    motivo: String(motivo || '').trim(),
    usuario: sessao.usuario,
  }));

  return resumoCaixa(repo, caixa);
}

async function fecharCaixa(repo, { saldo_informado: saldoInformado, observacao }, sessao) {
  const caixa = await caixaAbertoDe(repo, sessao.usuario);
  if (!caixa) throw new ErroDeNegocio('Nenhum caixa aberto para este operador.');

  const resumo = await resumoCaixa(repo, caixa);
  const contado = c(saldoInformado);
  const momento = agora();

  const fechado = await repo.transacao(async (tx) => {
    const atualizado = await tx.atualizar('caixas', { id: caixa.id }, {
      fechado_em: momento,
      vendas_total: resumo.total_vendas,
      vendas_dinheiro: c(resumo.por_forma.DINHEIRO || 0),
      suprimentos: resumo.suprimentos,
      sangrias: resumo.sangrias,
      saldo_esperado: resumo.saldo_esperado,
      saldo_informado: contado,
      diferenca: c(contado - resumo.saldo_esperado),
      status: 'FECHADO',
      observacao: String(observacao || '').trim(),
    });
    await tx.inserir('mov_caixa', {
      caixa_id: caixa.id,
      data: momento,
      tipo: 'FECHAMENTO',
      valor: contado,
      motivo: `Diferença de ${c(contado - resumo.saldo_esperado).toFixed(2)}`,
      usuario: sessao.usuario,
    });
    return atualizado;
  });

  return resumoCaixa(repo, fechado);
}

/* ------------------------------------------------------------------ *
 * Venda
 * ------------------------------------------------------------------ */

async function registrarVenda(repo, dados, sessao) {
  const config = await repo.config();
  const exigirCaixa = (config.exigir_caixa_aberto || 'SIM') === 'SIM';
  const caixa = await caixaAbertoDe(repo, sessao.usuario);
  if (exigirCaixa && !caixa) throw new ErroDeNegocio('Abra o caixa antes de lançar vendas.', 409);

  const codigos = [...new Set((dados.itens || []).map((i) => String(i.codigo || '').trim().toUpperCase()))];
  const produtos = await repo.listar('produtos', { onde: { codigo: { in: codigos } } });
  const produtosPorCodigo = {};
  produtos.forEach((p) => { produtosPorCodigo[String(p.codigo).toUpperCase()] = p; });

  const preparada = calc.prepararVenda({
    itens: dados.itens,
    desconto: dados.desconto,
    pagamentos: dados.pagamentos,
    produtosPorCodigo,
    permitirEstoqueNegativo: (config.permitir_estoque_negativo || 'NÃO') === 'SIM',
  });

  const resultado = await repo.transacao(async (tx) => {
    const numero = await tx.proximoNumeroCupom();
    const momento = agora();

    const venda = await tx.inserir('vendas', {
      numero,
      data: momento,
      operador: sessao.usuario,
      cliente: String(dados.cliente || '').trim(),
      itens: preparada.quantidadeItens,
      subtotal: preparada.subtotal,
      desconto: preparada.desconto,
      total: preparada.total,
      custo_total: preparada.custoTotal,
      lucro: preparada.lucro,
      pagamento: preparada.pagamentos.map((p) => p.forma).join(' + '),
      status: 'CONCLUÍDA',
      caixa_id: caixa ? caixa.id : 0,
      observacao: String(dados.observacao || '').trim(),
    });

    const itensSalvos = [];
    for (const item of preparada.itens) {
      itensSalvos.push(await tx.inserir('venda_itens', { ...item, venda_id: venda.id, data: momento }));

      await tx.inserir('saidas', {
        data: momento,
        codigo: item.codigo,
        descricao: item.descricao,
        tipo: 'VENDA',
        quantidade: item.quantidade,
        valor_unitario: item.preco_unitario,
        valor_total: item.total,
        custo_unitario: item.custo_unitario,
        custo_total: item.custo_total,
        motivo: '',
        documento: numero,
        usuario: sessao.usuario,
        observacao: '',
      });

      await tx.ajustarEstoque(item.codigo, -item.quantidade, { ultima_saida: momento });
    }

    for (const pagamento of preparada.pagamentos) {
      await tx.inserir('pagamentos', {
        venda_id: venda.id,
        data: momento,
        forma: pagamento.forma,
        valor: pagamento.valor,
        recebido: pagamento.recebido,
        troco: pagamento.troco,
        parcelas: pagamento.parcelas,
      });
    }

    if (caixa && preparada.dinheiroNoCaixa > 0) {
      await tx.inserir('mov_caixa', {
        caixa_id: caixa.id,
        data: momento,
        tipo: 'VENDA',
        valor: preparada.dinheiroNoCaixa,
        motivo: `Cupom ${numero}`,
        usuario: sessao.usuario,
      });
    }

    return { venda, itens: itensSalvos };
  });

  return {
    venda: resultado.venda,
    itens: resultado.itens,
    pagamentos: preparada.pagamentos,
    troco: preparada.troco,
    operador_nome: sessao.nome,
    loja: await dadosDaLoja(repo),
  };
}

async function detalharVenda(repo, id) {
  const vendas = await repo.listar('vendas', { onde: { id: Number(id) } });
  const venda = vendas[0];
  if (!venda) throw new ErroDeNegocio('Venda não encontrada.', 404);

  const [itens, pagamentos, loja] = await Promise.all([
    repo.listar('venda_itens', { onde: { venda_id: venda.id }, ordem: { campo: 'seq' } }),
    repo.listar('pagamentos', { onde: { venda_id: venda.id } }),
    dadosDaLoja(repo),
  ]);

  return { venda, itens, pagamentos, loja };
}

async function cancelarVenda(repo, id, motivo, sessao) {
  const { venda, itens } = await detalharVenda(repo, id);
  if (venda.status === 'CANCELADA') throw new ErroDeNegocio('Esta venda já está cancelada.');

  return repo.transacao(async (tx) => {
    const momento = agora();

    for (const item of itens) {
      const produto = await tx.ajustarEstoque(item.codigo, item.quantidade, { atualizado_em: momento });
      await tx.inserir('ajustes', {
        data: momento,
        codigo: item.codigo,
        descricao: item.descricao,
        quantidade: item.quantidade,
        estoque_anterior: produto ? c(produto.estoque - item.quantidade) : 0,
        estoque_novo: produto ? produto.estoque : 0,
        motivo: 'ESTORNO DE VENDA',
        impacto_custo: c(item.custo_total),
        usuario: sessao.usuario,
        observacao: `Cancelamento do cupom ${venda.numero}${motivo ? ` — ${motivo}` : ''}`,
      });
    }

    return tx.atualizar('vendas', { id: venda.id }, {
      status: 'CANCELADA',
      observacao: `${venda.observacao ? `${venda.observacao} | ` : ''}Cancelada por ${sessao.usuario}${motivo ? `: ${motivo}` : ''}`,
    });
  });
}

async function listarVendas(repo, consulta = {}) {
  const { de, ate } = periodo(consulta);
  const onde = {};
  if (consulta.operador) onde.operador = consulta.operador;
  if (consulta.status) onde.status = consulta.status;

  let lista = await repo.listar('vendas', {
    onde,
    periodo: { campo: 'data', de, ate },
    ordem: { campo: 'data', desc: true },
  });

  const termo = String(consulta.termo || '').trim().toUpperCase();
  if (termo) {
    lista = lista.filter((v) => (
      String(v.numero).toUpperCase().includes(termo) || String(v.cliente || '').toUpperCase().includes(termo)
    ));
  }
  return lista;
}

/* ------------------------------------------------------------------ *
 * Entradas
 * ------------------------------------------------------------------ */

async function registrarEntrada(repo, dados, sessao) {
  const produto = await exigirProduto(repo, dados.codigo);

  const quantidade = Number(dados.quantidade);
  if (!(quantidade > 0)) throw new ErroDeNegocio('Quantidade da entrada deve ser maior que zero.');

  const custoUnitario = dados.custo_unitario !== undefined && dados.custo_unitario !== ''
    ? c(dados.custo_unitario)
    : c(Number(dados.valor_total || 0) / quantidade);
  if (custoUnitario < 0) throw new ErroDeNegocio('Custo unitário inválido.');

  const custoAnterior = produto.custo_medio;
  const custoNovo = calc.custoMedioPonderado(produto.estoque, custoAnterior, quantidade, custoUnitario);
  const momento = dados.data ? new Date(dados.data).toISOString() : agora();

  return repo.transacao(async (tx) => {
    const entrada = await tx.inserir('entradas', {
      data: momento,
      codigo: produto.codigo,
      descricao: produto.descricao,
      quantidade,
      custo_unitario: custoUnitario,
      valor_total: c(quantidade * custoUnitario),
      fornecedor: String(dados.fornecedor || '').trim().toUpperCase(),
      documento: String(dados.documento || '').trim(),
      custo_medio_anterior: custoAnterior,
      custo_medio_novo: custoNovo,
      usuario: sessao.usuario,
      observacao: String(dados.observacao || '').trim(),
    });

    const extras = { custo_medio: custoNovo, ultima_entrada: momento, atualizado_em: momento };
    if (dados.atualizar_preco && Number(dados.preco_venda) > 0) {
      extras.preco_venda = c(dados.preco_venda);
    }
    const atualizado = await tx.ajustarEstoque(produto.codigo, quantidade, extras);

    return { entrada, produto: calc.enriquecerProduto(atualizado) };
  });
}

/* ------------------------------------------------------------------ *
 * Saídas sem venda (perdas, quebras, consumo)
 * ------------------------------------------------------------------ */

async function registrarSaidaNaoVenda(repo, dados, sessao) {
  const produto = await exigirProduto(repo, dados.codigo);
  const config = await repo.config();

  const tipo = String(dados.tipo || 'PERDA').toUpperCase();
  if (!TIPOS_SAIDA[tipo] || tipo === 'VENDA') throw new ErroDeNegocio('Tipo de saída inválido.');

  const quantidade = Number(dados.quantidade);
  if (!(quantidade > 0)) throw new ErroDeNegocio('Quantidade deve ser maior que zero.');

  if ((config.permitir_estoque_negativo || 'NÃO') !== 'SIM' && produto.estoque < quantidade) {
    throw new ErroDeNegocio(
      `Estoque insuficiente de ${produto.descricao}: disponível ${produto.estoque}, solicitado ${quantidade}.`
    );
  }

  const momento = dados.data ? new Date(dados.data).toISOString() : agora();

  return repo.transacao(async (tx) => {
    const saida = await tx.inserir('saidas', {
      data: momento,
      codigo: produto.codigo,
      descricao: produto.descricao,
      tipo,
      quantidade,
      valor_unitario: 0,
      valor_total: 0,
      custo_unitario: produto.custo_medio,
      custo_total: c(produto.custo_medio * quantidade),
      motivo: String(dados.motivo || TIPOS_SAIDA[tipo]).trim(),
      documento: String(dados.documento || '').trim(),
      usuario: sessao.usuario,
      observacao: String(dados.observacao || '').trim(),
    });

    const atualizado = await tx.ajustarEstoque(produto.codigo, -quantidade, {
      ultima_saida: momento,
      atualizado_em: momento,
    });

    return { saida, produto: calc.enriquecerProduto(atualizado) };
  });
}

/* ------------------------------------------------------------------ *
 * Ajustes de inventário
 * ------------------------------------------------------------------ */

async function registrarAjuste(repo, dados, sessao) {
  const produto = await exigirProduto(repo, dados.codigo);
  const anterior = produto.estoque;

  let diferenca;
  if (dados.modo === 'CONTAGEM' || dados.estoque_contado !== undefined) {
    const contado = Number(dados.estoque_contado);
    if (!Number.isFinite(contado) || contado < 0) throw new ErroDeNegocio('Informe a quantidade contada.');
    diferenca = c(contado - anterior);
  } else {
    diferenca = c(dados.quantidade);
  }

  if (diferenca === 0) throw new ErroDeNegocio('O ajuste não altera o estoque (diferença zero).');
  if (c(anterior + diferenca) < 0) throw new ErroDeNegocio('O ajuste deixaria o estoque negativo.');

  const momento = agora();

  return repo.transacao(async (tx) => {
    const atualizado = await tx.ajustarEstoque(produto.codigo, diferenca, { atualizado_em: momento });

    const ajuste = await tx.inserir('ajustes', {
      data: momento,
      codigo: produto.codigo,
      descricao: produto.descricao,
      quantidade: diferenca,
      estoque_anterior: c(atualizado.estoque - diferenca),
      estoque_novo: atualizado.estoque,
      motivo: String(dados.motivo || 'CONTAGEM DE INVENTÁRIO').toUpperCase().trim(),
      impacto_custo: c(diferenca * produto.custo_medio),
      usuario: sessao.usuario,
      observacao: String(dados.observacao || '').trim(),
    });

    return { ajuste, produto: calc.enriquecerProduto(atualizado) };
  });
}

/* ------------------------------------------------------------------ *
 * Listagens de movimentação
 * ------------------------------------------------------------------ */

function filtroDeMovimento(consulta, extras = {}) {
  const { de, ate } = periodo(consulta);
  const onde = { ...extras };
  if (consulta.codigo) onde.codigo = String(consulta.codigo).toUpperCase();
  return { onde, periodo: { campo: 'data', de, ate }, ordem: { campo: 'data', desc: true } };
}

async function listarEntradas(repo, consulta = {}) {
  return repo.listar('entradas', filtroDeMovimento(consulta));
}

async function listarSaidas(repo, consulta = {}) {
  const extras = {};
  const tipo = String(consulta.tipo || '').toUpperCase();
  if (tipo === 'NAO_VENDA') extras.tipo = { ne: 'VENDA' };
  else if (tipo) extras.tipo = tipo;
  return repo.listar('saidas', filtroDeMovimento(consulta, extras));
}

async function listarAjustes(repo, consulta = {}) {
  return repo.listar('ajustes', filtroDeMovimento(consulta));
}

/* ------------------------------------------------------------------ *
 * Relatórios
 * ------------------------------------------------------------------ */

async function relatorioLucro(repo, consulta = {}) {
  const { de, ate } = periodo(consulta);
  const intervalo = { campo: 'data', de, ate };

  const [vendas, perdas, ajustes, compras, produtos] = await Promise.all([
    repo.listar('vendas', { onde: { status: 'CONCLUÍDA' }, periodo: intervalo }),
    repo.listar('saidas', { onde: { tipo: { ne: 'VENDA' } }, periodo: intervalo }),
    repo.listar('ajustes', { periodo: intervalo }),
    repo.listar('entradas', { periodo: intervalo }),
    repo.listar('produtos'),
  ]);

  const ids = vendas.map((v) => v.id);
  const [itens, pagamentos] = await Promise.all([
    ids.length ? repo.listar('venda_itens', { onde: { venda_id: { in: ids } } }) : [],
    ids.length ? repo.listar('pagamentos', { onde: { venda_id: { in: ids } } }) : [],
  ]);

  const categoriaPorCodigo = {};
  produtos.forEach((p) => { categoriaPorCodigo[p.codigo] = p.categoria; });

  return calc.relatorioLucro(
    { vendas, itens, pagamentos, perdas, ajustes, compras, categoriaPorCodigo },
    consulta
  );
}

async function painel(repo) {
  const config = await repo.config();
  const hojeTexto = dataLocalISO();
  const inicioSerie = new Date(inicioDoDia(hojeTexto).getTime() - 29 * 86400000);

  const [produtos, vendas, itens30] = await Promise.all([
    repo.listar('produtos'),
    repo.listar('vendas', { periodo: { campo: 'data', de: inicioSerie, ate: fimDoDia(hojeTexto) } }),
    repo.listar('venda_itens', { periodo: { campo: 'data', de: inicioSerie, ate: fimDoDia(hojeTexto) } }),
  ]);

  return calc.montarPainel({
    produtos,
    vendas,
    itens30,
    diasAlerta: Number(config.alerta_dias_sem_movimento || 7) || 7,
    metaDiaria: Number(config.meta_diaria || 0) || 0,
  });
}

module.exports = {
  ErroDeNegocio,
  TIPOS_SAIDA,
  MOTIVOS_AJUSTE,
  FORMAS_PAGAMENTO,
  dadosDaLoja,
  listarProdutos,
  categorias,
  salvarProduto,
  fichaProduto,
  caixaAbertoDe,
  resumoCaixa,
  abrirCaixa,
  movimentarCaixa,
  fecharCaixa,
  registrarVenda,
  detalharVenda,
  cancelarVenda,
  listarVendas,
  registrarEntrada,
  registrarSaidaNaoVenda,
  registrarAjuste,
  listarEntradas,
  listarSaidas,
  listarAjustes,
  relatorioLucro,
  painel,
};
