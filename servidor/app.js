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
const rotas = express.Router();

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

/** Abre (ou reaproveita) o armazenamento antes de qualquer rota da API. */
rotas.use(async (req, res, proximo) => {
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

rotas.post('/login', responder(async (req) => {
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
rotas.post('/logout', responder(async () => ({ ok: true })));

rotas.get('/sessao', auth.exigirLogin, responder(async (req) => {
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

rotas.get('/produtos', auth.exigirLogin, responder(async (req) => ({
  produtos: await dominio.listarProdutos(req.repo, req.query),
  categorias: await dominio.categorias(req.repo),
})));

rotas.get('/produtos/:codigo', auth.exigirLogin, responder(async (req) =>
  dominio.fichaProduto(req.repo, req.params.codigo)));

rotas.post('/produtos', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  produto: await dominio.salvarProduto(req.repo, req.body, req.sessao),
})));

/* ------------------------------------------------------------------ *
 * Vendas
 * ------------------------------------------------------------------ */

rotas.post('/vendas', auth.exigirLogin, responder(async (req) =>
  dominio.registrarVenda(req.repo, req.body, req.sessao)));

rotas.get('/vendas', auth.exigirLogin, responder(async (req) => {
  const consulta = { ...req.query };
  if (req.sessao.perfil !== 'admin') consulta.operador = req.sessao.usuario;
  return { vendas: await dominio.listarVendas(req.repo, consulta) };
}));

rotas.get('/vendas/:id', auth.exigirLogin, responder(async (req) =>
  dominio.detalharVenda(req.repo, req.params.id)));

rotas.post('/vendas/:id/cancelar', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  venda: await dominio.cancelarVenda(req.repo, req.params.id, req.body.motivo, req.sessao),
})));

/* ------------------------------------------------------------------ *
 * Estoque
 * ------------------------------------------------------------------ */

rotas.get('/entradas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  entradas: await dominio.listarEntradas(req.repo, req.query),
})));

rotas.post('/entradas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) =>
  dominio.registrarEntrada(req.repo, req.body, req.sessao)));

rotas.get('/saidas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  saidas: await dominio.listarSaidas(req.repo, req.query),
  tipos: dominio.TIPOS_SAIDA,
})));

rotas.post('/saidas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) =>
  dominio.registrarSaidaNaoVenda(req.repo, req.body, req.sessao)));

rotas.get('/ajustes', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  ajustes: await dominio.listarAjustes(req.repo, req.query),
  motivos: dominio.MOTIVOS_AJUSTE,
})));

rotas.post('/ajustes', auth.exigirLogin, auth.exigirAdmin, responder(async (req) =>
  dominio.registrarAjuste(req.repo, req.body, req.sessao)));

/* ------------------------------------------------------------------ *
 * Caixa
 * ------------------------------------------------------------------ */

rotas.get('/caixa', auth.exigirLogin, responder(async (req) => {
  const caixa = await dominio.caixaAbertoDe(req.repo, req.sessao.usuario);
  return { caixa: caixa ? await dominio.resumoCaixa(req.repo, caixa) : null };
}));

rotas.post('/caixa/abrir', auth.exigirLogin, responder(async (req) => ({
  caixa: await dominio.abrirCaixa(req.repo, req.body.valor_abertura, req.sessao),
})));

rotas.post('/caixa/movimento', auth.exigirLogin, responder(async (req) => ({
  caixa: await dominio.movimentarCaixa(req.repo, req.body, req.sessao),
})));

rotas.post('/caixa/fechar', auth.exigirLogin, responder(async (req) => ({
  caixa: await dominio.fecharCaixa(req.repo, req.body, req.sessao),
})));

rotas.get('/caixas', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => ({
  caixas: await req.repo.listar('caixas', { ordem: { campo: 'id', desc: true } }),
})));

/* ------------------------------------------------------------------ *
 * Relatórios
 * ------------------------------------------------------------------ */

rotas.get('/painel', auth.exigirLogin, responder(async (req) => dominio.painel(req.repo)));

rotas.get('/relatorios/lucro', auth.exigirLogin, auth.exigirAdmin, responder(async (req) =>
  dominio.relatorioLucro(req.repo, req.query)));

/* ------------------------------------------------------------------ *
 * Usuários e configurações
 * ------------------------------------------------------------------ */

rotas.get('/usuarios', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => {
  const usuarios = await req.repo.listar('usuarios', { ordem: { campo: 'usuario' } });
  return {
    usuarios: usuarios.map((u) => ({
      usuario: u.usuario, nome: u.nome, perfil: u.perfil, ativo: u.ativo,
      criado_em: u.criado_em, ultimo_acesso: u.ultimo_acesso,
    })),
  };
}));

rotas.post('/usuarios', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => {
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

rotas.get('/config', auth.exigirLogin, responder(async (req) => {
  const config = await req.repo.config();
  return {
    config: Object.entries(config).map(([chave, valor]) => ({ chave, valor })),
    loja: await dominio.dadosDaLoja(req.repo),
    armazenamento: modoConfigurado(),
  };
}));

rotas.post('/config', auth.exigirLogin, auth.exigirAdmin, responder(async (req) => {
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

rotas.get('/exportar', auth.exigirLogin, auth.exigirAdmin, responder(async (req, res) => {
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
rotas.get('/saude', responder(async (req) => {
  const produtos = await req.repo.listar('produtos', { limite: 1 });
  return {
    ok: true,
    armazenamento: modoConfigurado(),
    catalogo_carregado: produtos.length > 0,
    horario: new Date().toISOString(),
  };
}));

rotas.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// As rotas respondem com e sem o prefixo /api: localmente o caminho chega
// completo; na Vercel, a reescrita pode entregá-lo já sem o prefixo.
app.use('/api', rotas);
app.use(rotas);

module.exports = app;
