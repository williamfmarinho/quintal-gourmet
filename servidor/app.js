/**
 * Aplicação Express do PDV: API + arquivos da interface.
 *
 * O mesmo app roda de duas formas:
 *   • local, com `servidor/local.js` (planilha Excel);
 *   • na Vercel, com `api/index.js` (Postgres do Supabase).
 */

const path = require('path');
const express = require('express');

const auth = require('./auth');
const dominio = require('./dominio');
const planilha = require('./armazenamento/planilha');
const { abrirArmazenamento, modoConfigurado } = require('./armazenamento/indice');

const ABAS_EXPORTACAO = {
  PRODUTOS: 'produtos',
  ENTRADAS: 'entradas',
  SAIDAS: 'saidas',
  AJUSTES: 'ajustes',
  VENDAS: 'vendas',
  VENDA_ITENS: 'venda_itens',
  PAGAMENTOS: 'pagamentos',
  CAIXAS: 'caixas',
  MOV_CAIXA: 'mov_caixa',
  USUARIOS: 'usuarios',
  CONFIG: 'config',
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

/** Abre (ou reaproveita) o armazenamento antes de qualquer rota da API. */
app.use('/api', async (req, res, proximo) => {
  try {
    req.repo = await abrirArmazenamento();
    proximo();
  } catch (erro) {
    console.error('[armazenamento]', erro);
    res.status(503).json({ erro: 'Banco de dados indisponível no momento.' });
  }
});

function responder(manipulador) {
  return async (req, res) => {
    try {
      const resultado = await manipulador(req, res);
      if (!res.headersSent) res.json(resultado === undefined ? { ok: true } : resultado);
    } catch (erro) {
      const status = erro.status || 500;
      if (status >= 500) console.error('[erro]', erro);
      if (!res.headersSent) res.status(status).json({ erro: erro.message || 'Erro inesperado.' });
    }
  };
}

/* ------------------------------------------------------------------ *
 * Sessão
 * ------------------------------------------------------------------ */

app.post('/api/login', responder(async (req) => {
  const login = String(req.body.usuario || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');

  const encontrados = await req.repo.listar('usuarios', { onde: { usuario: login } });
  const usuario = encontrados[0];

  if (!usuario || !usuario.ativo || !auth.conferirSenha(senha, usuario.salt, usuario.hash)) {
    const erro = new Error('Usuário ou senha inválidos.');
    erro.status = 401;
    throw erro;
  }

  await req.repo.atualizar('usuarios', { usuario: usuario.usuario }, { ultimo_acesso: new Date().toISOString() });

  const caixa = await dominio.caixaAbertoDe(req.repo, usuario.usuario);
  return {
    token: auth.abrirSessao(usuario),
    usuario: { usuario: usuario.usuario, nome: usuario.nome, perfil: usuario.perfil },
    caixa: caixa ? await dominio.resumoCaixa(req.repo, caixa) : null,
    loja: await dominio.dadosDaLoja(req.repo),
  };
}));

// Com token assinado não há estado no servidor: sair é descartar o token no cliente.
app.post('/api/logout', responder(async () => ({ ok: true })));

app.get('/api/sessao', auth.exigirLogin, responder(async (req) => {
  const caixa = await dominio.caixaAbertoDe(req.repo, req.sessao.usuario);
  return {
    usuario: { usuario: req.sessao.usuario, nome: req.sessao.nome, perfil: req.sessao.perfil },
    caixa: caixa ? await dominio.resumoCaixa(req.repo, caixa) : null,
    loja: await dominio.dadosDaLoja(req.repo),
  };
}));

/* ------------------------------------------------------------------ *
 * Produtos
 * ------------------------------------------------------------------ */

app.get('/api/produtos', auth.exigirLogin, responder(async (req) => ({
  produtos: await dominio.listarProdutos(req.repo, req.query),
  categorias: await dominio.categorias(req.repo),
})));

app.get('/api/produtos/:codigo', auth.exigirLogin, responder(async (req) =>
  dominio.fichaProduto(req.repo, req.params.codigo)));

app.post('/api/produtos', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  produto: await dominio.salvarProduto(req.repo, req.body, req.sessao),
})));

/* ------------------------------------------------------------------ *
 * Vendas
 * ------------------------------------------------------------------ */

app.post('/api/vendas', auth.exigirLogin, responder(async (req) =>
  dominio.registrarVenda(req.repo, req.body, req.sessao)));

app.get('/api/vendas', auth.exigirLogin, responder(async (req) => {
  const consulta = { ...req.query };
  if (req.sessao.perfil !== 'admin') consulta.operador = req.sessao.usuario;
  return { vendas: await dominio.listarVendas(req.repo, consulta) };
}));

app.get('/api/vendas/:id', auth.exigirLogin, responder(async (req) =>
  dominio.detalharVenda(req.repo, req.params.id)));

app.post('/api/vendas/:id/cancelar', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  venda: await dominio.cancelarVenda(req.repo, req.params.id, req.body.motivo, req.sessao),
})));

/* ------------------------------------------------------------------ *
 * Estoque
 * ------------------------------------------------------------------ */

app.get('/api/entradas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  entradas: await dominio.listarEntradas(req.repo, req.query),
})));

app.post('/api/entradas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) =>
  dominio.registrarEntrada(req.repo, req.body, req.sessao)));

app.get('/api/saidas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  saidas: await dominio.listarSaidas(req.repo, req.query),
  tipos: dominio.TIPOS_SAIDA,
})));

app.post('/api/saidas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) =>
  dominio.registrarSaidaNaoVenda(req.repo, req.body, req.sessao)));

app.get('/api/ajustes', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  ajustes: await dominio.listarAjustes(req.repo, req.query),
  motivos: dominio.MOTIVOS_AJUSTE,
})));

app.post('/api/ajustes', auth.exigirLogin, auth.exigirAdmin, responder(async (req) =>
  dominio.registrarAjuste(req.repo, req.body, req.sessao)));

/* ------------------------------------------------------------------ *
 * Caixa
 * ------------------------------------------------------------------ */

app.get('/api/caixa', auth.exigirLogin, responder(async (req) => {
  const caixa = await dominio.caixaAbertoDe(req.repo, req.sessao.usuario);
  return { caixa: caixa ? await dominio.resumoCaixa(req.repo, caixa) : null };
}));

app.post('/api/caixa/abrir', auth.exigirLogin, responder(async (req) => ({
  caixa: await dominio.abrirCaixa(req.repo, req.body.valor_abertura, req.sessao),
})));

app.post('/api/caixa/movimento', auth.exigirLogin, responder(async (req) => ({
  caixa: await dominio.movimentarCaixa(req.repo, req.body, req.sessao),
})));

app.post('/api/caixa/fechar', auth.exigirLogin, responder(async (req) => ({
  caixa: await dominio.fecharCaixa(req.repo, req.body, req.sessao),
})));

app.get('/api/caixas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  caixas: await req.repo.listar('caixas', { ordem: { campo: 'id', desc: true } }),
})));

/* ------------------------------------------------------------------ *
 * Relatórios
 * ------------------------------------------------------------------ */

app.get('/api/painel', auth.exigirLogin, responder(async (req) => dominio.painel(req.repo)));

app.get('/api/relatorios/lucro', auth.exigirLogin, auth.exigirAdmin, responder(async (req) =>
  dominio.relatorioLucro(req.repo, req.query)));

/* ------------------------------------------------------------------ *
 * Usuários e configurações
 * ------------------------------------------------------------------ */

app.get('/api/usuarios', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => {
  const usuarios = await req.repo.listar('usuarios', { ordem: { campo: 'usuario' } });
  return {
    usuarios: usuarios.map((u) => ({
      usuario: u.usuario, nome: u.nome, perfil: u.perfil, ativo: u.ativo,
      criado_em: u.criado_em, ultimo_acesso: u.ultimo_acesso,
    })),
  };
}));

app.post('/api/usuarios', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => {
  const login = String(req.body.usuario || '').trim().toLowerCase();
  if (!login) throw new dominio.ErroDeNegocio('Informe o login do usuário.');
  const perfil = req.body.perfil === 'admin' ? 'admin' : 'operador';

  const encontrados = await req.repo.listar('usuarios', { onde: { usuario: login } });
  const existente = encontrados[0];

  if (existente) {
    const campos = { nome: String(req.body.nome || existente.nome).trim(), perfil };
    if (req.body.ativo !== undefined) campos.ativo = Boolean(req.body.ativo);
    if (req.body.senha) Object.assign(campos, auth.criarSenha(req.body.senha));
    await req.repo.atualizar('usuarios', { usuario: login }, campos);
  } else {
    if (!req.body.senha) throw new dominio.ErroDeNegocio('Informe a senha do novo usuário.');
    const { salt, hash } = auth.criarSenha(req.body.senha);
    await req.repo.inserir('usuarios', {
      usuario: login,
      nome: String(req.body.nome || login).trim(),
      perfil,
      salt,
      hash,
      ativo: true,
      criado_em: new Date().toISOString(),
      ultimo_acesso: '',
    });
  }

  return { ok: true };
}));

app.get('/api/config', auth.exigirLogin, responder(async (req) => {
  const config = await req.repo.config();
  return {
    config: Object.entries(config).map(([chave, valor]) => ({ chave, valor })),
    loja: await dominio.dadosDaLoja(req.repo),
    armazenamento: modoConfigurado(),
  };
}));

app.post('/api/config', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => {
  await req.repo.transacao((tx) => tx.definirConfig(req.body || {}));
  const config = await req.repo.config();
  return {
    config: Object.entries(config).map(([chave, valor]) => ({ chave, valor })),
    loja: await dominio.dadosDaLoja(req.repo),
  };
}));

/* ------------------------------------------------------------------ *
 * Exportação da base em Excel
 * ------------------------------------------------------------------ */

app.get('/api/exportar', auth.exigirLogin, auth.exigirAdmin, responder(async (req, res) => {
  const tabelas = {};
  for (const [aba, tabela] of Object.entries(ABAS_EXPORTACAO)) {
    tabelas[aba] = await req.repo.listar(tabela);
  }

  const wb = planilha.montarPlanilha(tabelas);
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Base PDV Quintal Gourmet ${carimbo}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

/** Diagnóstico simples — útil para conferir a implantação. */
app.get('/api/saude', responder(async (req) => {
  const produtos = await req.repo.listar('produtos', { limite: 1 });
  return {
    ok: true,
    armazenamento: modoConfigurado(),
    catalogo_carregado: produtos.length > 0,
    horario: new Date().toISOString(),
  };
}));

app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

module.exports = app;
