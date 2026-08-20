/** Casca do aplicativo: menu, sessão, relógio e roteamento entre as telas. */

import { api, lerSessao, limparSessao, guardarSessao } from './api.js';
import { html, limpar, avisar, dataExtenso, dinheiro } from './util.js';

import * as painel from './vistas/painel.js';
import * as pdv from './vistas/pdv.js';
import * as produtos from './vistas/produtos.js';
import * as estoque from './vistas/estoque.js';
import * as vendas from './vistas/vendas.js';
import * as relatorios from './vistas/relatorios.js';
import * as caixa from './vistas/caixa.js';
import * as sistema from './vistas/sistema.js';

const ICONE = {
  painel: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM13 7h8V3h-8zM3 21h8v-4H3z"/>',
  pdv: '<path d="M3 5h18M6 5v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5M9 10h6M9 14h6"/>',
  produtos: '<path d="M20 7 12 3 4 7v10l8 4 8-4z"/><path d="m4 7 8 4 8-4M12 21V11"/>',
  estoque: '<path d="M3 9h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M2 5h20v4H2zM10 13h4"/>',
  vendas: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5"/>',
  relatorios: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  caixa: '<path d="M2 8h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path d="M2 8 5 3h14l3 5M12 12v4M9 14h6"/>',
  sistema: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.6H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9.4A1.6 1.6 0 0 0 10.4 3V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
};

const TELAS = [
  { id: 'pdv', titulo: 'Frente de caixa', subtitulo: 'Lançamento de vendas e emissão do cupom', grupo: 'Operação', modulo: pdv, icone: 'pdv', atalho: 'Alt+1' },
  { id: 'produtos', titulo: 'Produtos', subtitulo: 'Consulta de preços, estoque e ficha do item', grupo: 'Operação', modulo: produtos, icone: 'produtos', atalho: 'Alt+2' },
  { id: 'caixa', titulo: 'Caixa', subtitulo: 'Abertura, sangria, suprimento e fechamento', grupo: 'Operação', modulo: caixa, icone: 'caixa', atalho: 'Alt+3' },
  { id: 'vendas', titulo: 'Vendas', subtitulo: 'Cupons emitidos, reimpressão e cancelamento', grupo: 'Operação', modulo: vendas, icone: 'vendas', atalho: 'Alt+4' },

  { id: 'painel', titulo: 'Painel', subtitulo: 'Visão geral do dia e alertas do negócio', grupo: 'Gestão', modulo: painel, icone: 'painel', admin: true, atalho: 'Alt+5' },
  { id: 'estoque', titulo: 'Estoque', subtitulo: 'Entradas, ajustes de inventário e perdas', grupo: 'Gestão', modulo: estoque, icone: 'estoque', admin: true, atalho: 'Alt+6' },
  { id: 'relatorios', titulo: 'Lucros e relatórios', subtitulo: 'Resultado por período, curva ABC e perdas', grupo: 'Gestão', modulo: relatorios, icone: 'relatorios', admin: true, atalho: 'Alt+7' },
  { id: 'sistema', titulo: 'Sistema', subtitulo: 'Usuários, dados da loja e backup da base', grupo: 'Gestão', modulo: sistema, icone: 'sistema', admin: true, atalho: 'Alt+8' },
];

/** Contexto compartilhado entre as telas. */
export const contexto = {
  sessao: lerSessao(),
  caixa: null,
  irPara,
  atualizarCaixa,
  ehAdmin: () => contexto.sessao?.usuario?.perfil === 'admin',
};

const conteudo = document.getElementById('conteudo');
let telaAtual = null;
let limpezaDaTela = null;

/* ----------------------------- inicialização ----------------------------- */

if (!contexto.sessao?.token) location.href = 'index.html';

async function iniciar() {
  try {
    const dados = await api('/api/sessao');
    contexto.sessao = { ...contexto.sessao, usuario: dados.usuario, loja: dados.loja };
    contexto.caixa = dados.caixa;
    guardarSessao(contexto.sessao);
  } catch {
    limparSessao();
    location.href = 'index.html';
    return;
  }

  montarMenu();
  montarUsuario();
  iniciarRelogio();
  atualizarSeloCaixa();

  window.addEventListener('hashchange', roteirizar);
  document.addEventListener('keydown', atalhosGlobais);
  document.getElementById('sair').addEventListener('click', sair);
  document.getElementById('selo-caixa').addEventListener('click', () => irPara('caixa'));

  roteirizar();
}

function telasPermitidas() {
  return TELAS.filter((tela) => !tela.admin || contexto.ehAdmin());
}

function montarMenu() {
  const trilho = document.getElementById('trilho');
  limpar(trilho);

  trilho.appendChild(html(`
    <div class="trilho-marca">
      <div class="trilho-selo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff7a34" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2c1.5 3.6-.8 5-2.2 6.6-1.6 1.8-2.4 3.4-2.4 5.2A4.6 4.6 0 0 0 12 18.4a4.6 4.6 0 0 0 4.6-4.6c0-2.4-1.4-3.6-2.2-5.4"/>
        </svg>
      </div>
      <div>
        <b>Quintal Gourmet</b>
        <small>PDV local</small>
      </div>
    </div>
  `));

  let grupoAtual = '';
  telasPermitidas().forEach((tela) => {
    if (tela.grupo !== grupoAtual) {
      grupoAtual = tela.grupo;
      trilho.appendChild(html(`<div class="trilho-grupo">${grupoAtual}</div>`));
    }
    const botao = html(`
      <button class="item-menu" data-tela="${tela.id}" title="${tela.titulo}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONE[tela.icone]}</svg>
        <span>${tela.titulo}</span>
        <span class="atalho">${tela.atalho.replace('Alt+', '⎇')}</span>
      </button>
    `);
    botao.addEventListener('click', () => irPara(tela.id));
    trilho.appendChild(botao);
  });

  trilho.appendChild(html(`
    <div class="trilho-rodape">
      Simulação local · v1.0<br>
      Base em Excel · sem internet
    </div>
  `));
}

function montarUsuario() {
  const usuario = contexto.sessao.usuario;
  const iniciais = usuario.nome.replace(/[^A-Za-zÀ-ÿ ]/g, '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  document.getElementById('avatar').textContent = iniciais || '?';
  document.getElementById('nome-usuario').textContent = usuario.nome.split('—')[0].trim();
  document.getElementById('perfil-usuario').textContent = usuario.perfil === 'admin' ? 'Administrador' : 'Operador';
}

function iniciarRelogio() {
  const alvo = document.getElementById('relogio');
  const atualizar = () => {
    const agora = new Date();
    alvo.innerHTML = `
      <small>${dataExtenso(agora)}</small>
      ${agora.toLocaleTimeString('pt-BR')}
    `;
  };
  atualizar();
  setInterval(atualizar, 1000);
}

export function atualizarSeloCaixa() {
  const selo = document.getElementById('selo-caixa');
  const aberto = Boolean(contexto.caixa && contexto.caixa.status === 'ABERTO');
  selo.innerHTML = `
    <span class="ponto ${aberto ? 'aceso' : 'apagado'}"></span>
    <span>${aberto ? `Caixa aberto · ${dinheiro(contexto.caixa.saldo_esperado)}` : 'Caixa fechado'}</span>
  `;
}

export async function atualizarCaixa() {
  try {
    const dados = await api('/api/caixa');
    contexto.caixa = dados.caixa;
  } catch {
    contexto.caixa = null;
  }
  atualizarSeloCaixa();
  return contexto.caixa;
}

/* -------------------------------- rotas -------------------------------- */

export function irPara(id) {
  if (location.hash === `#${id}`) roteirizar();
  else location.hash = id;
}

async function roteirizar() {
  const permitidas = telasPermitidas();
  const alvo = (location.hash || '').replace('#', '');
  const tela = permitidas.find((t) => t.id === alvo) || permitidas[0];

  if (location.hash !== `#${tela.id}`) {
    location.hash = tela.id;
    return;
  }

  document.querySelectorAll('.item-menu').forEach((item) => {
    item.classList.toggle('ativo', item.dataset.tela === tela.id);
  });
  document.getElementById('titulo-pagina').textContent = tela.titulo;
  document.getElementById('subtitulo-pagina').textContent = tela.subtitulo;

  if (limpezaDaTela) {
    try { limpezaDaTela(); } catch { /* ignora */ }
    limpezaDaTela = null;
  }

  conteudo.classList.toggle('sem-rolagem', tela.id === 'pdv');
  limpar(conteudo);
  conteudo.innerHTML = '<div class="carregando"><div class="girando"></div>Carregando...</div>';

  telaAtual = tela.id;
  try {
    const resultado = await tela.modulo.montar(conteudo, contexto);
    if (typeof resultado === 'function') limpezaDaTela = resultado;
  } catch (erro) {
    conteudo.innerHTML = `<div class="cartao"><div class="vazio"><span class="icone">⚠</span>${erro.message}</div></div>`;
  }
}

function atalhosGlobais(evento) {
  if (evento.altKey && !evento.ctrlKey && /^[1-8]$/.test(evento.key)) {
    const lista = telasPermitidas();
    const indice = Number(evento.key) - 1;
    const tela = lista.find((t) => t.atalho === `Alt+${evento.key}`) || lista[indice];
    if (tela) {
      evento.preventDefault();
      irPara(tela.id);
    }
  }
}

async function sair() {
  try { await api('/api/logout', { metodo: 'POST' }); } catch { /* ignora */ }
  limparSessao();
  location.href = 'index.html';
}

window.addEventListener('error', (evento) => {
  if (evento.message) avisar(evento.message, 'erro');
});

iniciar();

export { telaAtual };
