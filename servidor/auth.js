/**
 * Autenticação.
 *
 * Senhas ficam guardadas como hash scrypt + salt individual. A sessão é um token
 * assinado (HMAC-SHA256) que carrega o próprio conteúdo — sem estado no servidor,
 * o que é necessário para funcionar em ambiente serverless, onde cada requisição
 * pode cair em uma instância diferente.
 */

const crypto = require('crypto');

const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000; // 12 horas

function segredo() {
  if (process.env.SESSAO_SEGREDO) return process.env.SESSAO_SEGREDO;
  // Sem segredo configurado, deriva um valor estável do ambiente para que o
  // token continue válido entre invocações da mesma implantação.
  return crypto
    .createHash('sha256')
    .update(`quintal-gourmet::${process.env.DATABASE_URL || 'modo-local'}`)
    .digest('hex');
}

const paraBase64Url = (texto) => Buffer.from(texto, 'utf8').toString('base64url');
const deBase64Url = (texto) => Buffer.from(texto, 'base64url').toString('utf8');

function assinar(conteudo) {
  return crypto.createHmac('sha256', segredo()).update(conteudo).digest('base64url');
}

function criarSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 32).toString('hex');
  return { salt, hash };
}

function conferirSenha(senha, salt, hash) {
  if (!salt || !hash) return false;
  try {
    const calculado = crypto.scryptSync(String(senha), salt, 32);
    const guardado = Buffer.from(hash, 'hex');
    return calculado.length === guardado.length && crypto.timingSafeEqual(calculado, guardado);
  } catch {
    return false;
  }
}

function abrirSessao(usuario) {
  const conteudo = paraBase64Url(JSON.stringify({
    usuario: usuario.usuario,
    nome: usuario.nome,
    perfil: usuario.perfil,
    expira_em: Date.now() + DURACAO_SESSAO_MS,
  }));
  return `${conteudo}.${assinar(conteudo)}`;
}

function lerSessao(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [conteudo, assinatura] = token.split('.');
  if (!conteudo || !assinatura) return null;

  const esperada = Buffer.from(assinar(conteudo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;

  try {
    const sessao = JSON.parse(deBase64Url(conteudo));
    if (!sessao.expira_em || sessao.expira_em < Date.now()) return null;
    return sessao;
  } catch {
    return null;
  }
}

function tokenDaRequisicao(req) {
  const cabecalho = req.headers.authorization || '';
  if (cabecalho.startsWith('Bearer ')) return cabecalho.slice(7).trim();
  return req.headers['x-sessao'] || '';
}

/** Middleware: exige sessão válida. */
function exigirLogin(req, res, proximo) {
  const sessao = lerSessao(tokenDaRequisicao(req));
  if (!sessao) return res.status(401).json({ erro: 'Sessão expirada ou inexistente. Faça login novamente.' });
  req.sessao = sessao;
  return proximo();
}

/** Middleware: exige perfil de administrador. */
function exigirAdmin(req, res, proximo) {
  if (!req.sessao) return res.status(401).json({ erro: 'Sessão inválida.' });
  if (req.sessao.perfil !== 'admin') return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
  return proximo();
}

module.exports = {
  criarSenha,
  conferirSenha,
  abrirSessao,
  lerSessao,
  exigirLogin,
  exigirAdmin,
  tokenDaRequisicao,
};
