/** Comunicação com a API local e guarda da sessão no navegador. */

const CHAVE = 'quintal-gourmet-sessao';

export function lerSessao() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) || 'null');
  } catch {
    return null;
  }
}

export function guardarSessao(dados) {
  localStorage.setItem(CHAVE, JSON.stringify(dados));
}

export function limparSessao() {
  localStorage.removeItem(CHAVE);
}

export function usuarioAtual() {
  const sessao = lerSessao();
  return sessao ? sessao.usuario : null;
}

export function ehAdmin() {
  const usuario = usuarioAtual();
  return Boolean(usuario && usuario.perfil === 'admin');
}

export async function api(caminho, opcoes = {}) {
  const { metodo = 'GET', corpo, semSessao = false, parametros } = opcoes;
  const sessao = lerSessao();

  let url = caminho;
  if (parametros) {
    const busca = new URLSearchParams(
      Object.entries(parametros).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    const texto = busca.toString();
    if (texto) url += (url.includes('?') ? '&' : '?') + texto;
  }

  const cabecalhos = {};
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (!semSessao && sessao?.token) cabecalhos.Authorization = `Bearer ${sessao.token}`;

  const resposta = await fetch(url, {
    method: metodo,
    headers: cabecalhos,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  if (resposta.status === 401 && !semSessao) {
    limparSessao();
    if (!location.pathname.endsWith('index.html') && location.pathname !== '/') {
      location.href = 'index.html';
    }
    throw new Error('Sessão expirada. Entre novamente.');
  }

  const tipo = resposta.headers.get('content-type') || '';
  if (!tipo.includes('application/json')) {
    if (!resposta.ok) throw new Error(`Falha na requisição (${resposta.status}).`);
    return resposta;
  }

  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.erro || `Falha na requisição (${resposta.status}).`);
  return dados;
}
