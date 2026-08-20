/** Formatação, criação de elementos, avisos e modais. */

const formatadorMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatadorNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

export const dinheiro = (valor) => formatadorMoeda.format(Number(valor) || 0);
export const numero = (valor) => formatadorNumero.format(Number(valor) || 0);
export const percentual = (valor, casas = 1) => `${(Number(valor) || 0).toFixed(casas).replace('.', ',')}%`;

export function dataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function dataCurta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function dataExtenso(data = new Date()) {
  return data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

/** Data local no formato aceito pelos filtros (AAAA-MM-DD). */
export function isoLocal(data = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`;
}

export function somarDias(dias, base = new Date()) {
  return new Date(base.getTime() + dias * 86400000);
}

export function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Cria elementos a partir de uma string HTML. */
export function html(textoHtml) {
  const molde = document.createElement('template');
  molde.innerHTML = textoHtml.trim();
  return molde.content.firstElementChild;
}

export function limpar(elemento) {
  while (elemento.firstChild) elemento.removeChild(elemento.firstChild);
  return elemento;
}

/* ------------------------------ Avisos ------------------------------ */

function caixaDeAvisos() {
  let caixa = document.querySelector('.avisos');
  if (!caixa) {
    caixa = html('<div class="avisos"></div>');
    document.body.appendChild(caixa);
  }
  return caixa;
}

const ICONES = { sucesso: '✓', erro: '✕', info: '•' };

export function avisar(mensagem, tipo = 'sucesso', duracao = 3800) {
  const aviso = html(`
    <div class="aviso ${tipo}">
      <strong style="opacity:.85">${ICONES[tipo] || '•'}</strong>
      <div>${escapar(mensagem)}</div>
    </div>
  `);
  caixaDeAvisos().appendChild(aviso);
  setTimeout(() => {
    aviso.classList.add('saindo');
    setTimeout(() => aviso.remove(), 300);
  }, duracao);
}

/* ------------------------------ Modais ------------------------------ */

/**
 * Abre um modal. `conteudo` recebe { fechar } e devolve o HTML do corpo.
 * Retorna um objeto { elemento, fechar }.
 */
export function abrirModal({ titulo, subtitulo = '', corpo, rodape = '', largura = '', aoAbrir, aoFechar }) {
  const cortina = html(`
    <div class="cortina">
      <div class="modal ${largura}">
        <div class="modal-topo">
          <div>
            <h2>${escapar(titulo)}</h2>
            ${subtitulo ? `<small>${escapar(subtitulo)}</small>` : ''}
          </div>
          <button class="fechar" title="Fechar (Esc)">✕</button>
        </div>
        <div class="modal-corpo"></div>
        ${rodape ? `<div class="modal-rodape">${rodape}</div>` : ''}
      </div>
    </div>
  `);

  const corpoElemento = cortina.querySelector('.modal-corpo');
  if (typeof corpo === 'string') corpoElemento.innerHTML = corpo;
  else if (corpo instanceof Node) corpoElemento.appendChild(corpo);

  function fechar() {
    cortina.remove();
    document.removeEventListener('keydown', aoTeclar);
    if (aoFechar) aoFechar();
  }

  function aoTeclar(evento) {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      fechar();
    }
  }

  cortina.querySelector('.fechar').addEventListener('click', fechar);
  cortina.addEventListener('mousedown', (evento) => {
    if (evento.target === cortina) fechar();
  });
  document.addEventListener('keydown', aoTeclar);
  document.body.appendChild(cortina);

  if (aoAbrir) aoAbrir({ elemento: cortina, fechar });
  return { elemento: cortina, fechar };
}

export function confirmar({ titulo, mensagem, textoConfirmar = 'Confirmar', perigo = false }) {
  return new Promise((resolver) => {
    let decidido = false;
    const modal = abrirModal({
      titulo,
      largura: 'estreito',
      corpo: `<p style="margin:0;line-height:1.6;color:var(--creme-medio)">${escapar(mensagem)}</p>`,
      rodape: `
        <button class="botao" data-acao="nao">Cancelar</button>
        <button class="botao ${perigo ? 'botao-perigo' : 'botao-brasa'}" data-acao="sim">${escapar(textoConfirmar)}</button>
      `,
      aoFechar: () => { if (!decidido) resolver(false); },
    });
    modal.elemento.querySelector('[data-acao="nao"]').addEventListener('click', () => {
      decidido = true; modal.fechar(); resolver(false);
    });
    modal.elemento.querySelector('[data-acao="sim"]').addEventListener('click', () => {
      decidido = true; modal.fechar(); resolver(true);
    });
  });
}

/* ------------------------------ Gráficos ------------------------------ */

/** Gráfico de área + linha (faturamento e lucro por dia). */
export function graficoLinha(serie, { altura = 210, chaveA = 'faturamento', chaveB = 'lucro' } = {}) {
  if (!serie.length) return '<div class="vazio">Sem dados no período.</div>';

  const largura = 720;
  const margem = { topo: 16, direita: 12, baixo: 26, esquerda: 52 };
  const areaL = largura - margem.esquerda - margem.direita;
  const areaA = altura - margem.topo - margem.baixo;
  const maximo = Math.max(1, ...serie.map((p) => Math.max(p[chaveA], p[chaveB] || 0)));

  const x = (i) => margem.esquerda + (serie.length === 1 ? areaL / 2 : (i * areaL) / (serie.length - 1));
  const y = (v) => margem.topo + areaA - (v / maximo) * areaA;

  const caminho = (chave) => serie.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[chave]).toFixed(1)}`).join(' ');
  const area = `${caminho(chaveA)} L${x(serie.length - 1).toFixed(1)},${(margem.topo + areaA).toFixed(1)} L${x(0).toFixed(1)},${(margem.topo + areaA).toFixed(1)} Z`;

  const grades = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const valorY = margem.topo + areaA - f * areaA;
    return `
      <line class="linha-grade" x1="${margem.esquerda}" y1="${valorY}" x2="${largura - margem.direita}" y2="${valorY}"/>
      <text class="eixo-texto" x="${margem.esquerda - 8}" y="${valorY + 3}" text-anchor="end">${Math.round((maximo * f) / 1) >= 1000 ? `${Math.round((maximo * f) / 100) / 10}k` : Math.round(maximo * f)}</text>
    `;
  }).join('');

  const passo = Math.max(1, Math.ceil(serie.length / 10));
  const rotulos = serie.map((p, i) => (i % passo === 0 || i === serie.length - 1
    ? `<text class="eixo-texto" x="${x(i)}" y="${altura - 6}" text-anchor="middle">${dataCurta(`${p.dia}T12:00:00`)}</text>`
    : '')).join('');

  const pontos = serie.map((p, i) => (p[chaveA] > 0
    ? `<circle class="ponto-dado" cx="${x(i).toFixed(1)}" cy="${y(p[chaveA]).toFixed(1)}" r="2.6"><title>${dataCurta(`${p.dia}T12:00:00`)} — ${dinheiro(p[chaveA])}</title></circle>`
    : '')).join('');

  return `
    <svg class="grafico" viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="none" style="height:${altura}px">
      <defs>
        <linearGradient id="gradienteBrasa" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff7a34" stop-opacity=".38"/>
          <stop offset="100%" stop-color="#ff7a34" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grades}
      <path class="area-fat" d="${area}"/>
      <path class="traco-fat desenho-linha" d="${caminho(chaveA)}"/>
      ${chaveB ? `<path class="traco-lucro desenho-linha" d="${caminho(chaveB)}"/>` : ''}
      ${pontos}
      ${rotulos}
    </svg>
  `;
}

/** Lista de barras horizontais proporcionais. */
export function graficoBarras(itens, { rotulo, valor, formato = dinheiro, cor = '' } = {}) {
  if (!itens.length) return '<div class="vazio">Sem dados no período.</div>';
  const maximo = Math.max(...itens.map((i) => Number(valor(i)) || 0), 1);
  return `
    <div class="barra-lista">
      ${itens.map((item, i) => `
        <div class="barra-item">
          <div class="barra-topo">
            <span>${escapar(rotulo(item))}</span>
            <span class="num">${formato(valor(item))}</span>
          </div>
          <div class="barra-trilha">
            <div class="barra-preenchida ${cor}" style="--largura:${((Number(valor(item)) || 0) / maximo) * 100}%;--i:${i}"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

export function etiquetaSituacao(situacao) {
  const mapa = { OK: 'ok', 'ATENÇÃO': 'atencao', 'CRÍTICO': 'critico', ZERADO: 'zerado' };
  return `<span class="etiqueta ${mapa[situacao] || 'neutra'}">${situacao}</span>`;
}
