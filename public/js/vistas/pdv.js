/** Frente de caixa: busca de produtos, comanda, pagamento e cupom. */

import { api } from '../api.js';
import {
  html, limpar, avisar, dinheiro, numero, escapar, abrirModal, confirmar,
  fotoMini, iniciaisProduto, miniatura,
} from '../util.js';
import { mostrarCupom } from '../cupom.js';

const FORMAS = [
  { nome: 'DINHEIRO', simbolo: '💵', tecla: '1' },
  { nome: 'PIX', simbolo: '⚡', tecla: '2' },
  { nome: 'CARTÃO DE DÉBITO', simbolo: '💳', tecla: '3' },
  { nome: 'CARTÃO DE CRÉDITO', simbolo: '🏦', tecla: '4' },
  { nome: 'VALE ALIMENTAÇÃO', simbolo: '🍽', tecla: '5' },
  { nome: 'FIADO / CADERNETA', simbolo: '📒', tecla: '6' },
];

const valorNumerico = (texto) => {
  const limpo = String(texto ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
};

export async function montar(raiz, contexto) {
  const dados = await api('/api/produtos');
  let produtos = dados.produtos.filter((p) => p.ativo);
  const categorias = dados.categorias.map((c) => c.nome);

  const carrinho = [];
  let descontoGeral = 0;
  let categoriaAtiva = '';
  let cliente = '';

  limpar(raiz);
  const tela = html(`
    <div class="pdv">
      <section class="pdv-esquerda">
        <div class="pdv-busca">
          <span class="icone-busca">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
          </span>
          <input id="busca" type="text" placeholder="Bipe o código de barras ou digite o nome do produto..." autocomplete="off">
          <span class="dica-tecla">F2</span>
        </div>

        <div class="chips" id="chips" style="margin-bottom:14px"></div>
        <div class="pdv-produtos" id="grade"></div>
      </section>

      <aside class="comanda">
        <div class="comanda-topo">
          <h2>Comanda</h2>
          <button class="botao botao-mini botao-fantasma" id="btn-cliente">+ Cliente</button>
        </div>

        <div class="comanda-itens" id="itens"></div>

        <div class="comanda-totais">
          <div class="linha-total"><span>Itens</span><span class="num" id="qtd-itens">0</span></div>
          <div class="linha-total"><span>Subtotal</span><span class="num" id="subtotal">R$ 0,00</span></div>
          <div class="linha-total"><span>Desconto <small class="fraco">(F6)</small></span><span class="num negativo" id="desconto">R$ 0,00</span></div>
          <div class="linha-total grande">
            <span>Total</span>
            <span class="valor-total" id="total">R$ 0,00</span>
          </div>
        </div>

        <div class="comanda-acoes">
          <button class="botao botao-brasa principal" id="btn-finalizar">Finalizar venda · F4</button>
          <button class="botao" id="btn-desconto">Desconto</button>
          <button class="botao botao-perigo" id="btn-cancelar">Cancelar venda</button>
        </div>
      </aside>
    </div>
  `);
  raiz.appendChild(tela);

  const busca = tela.querySelector('#busca');
  const grade = tela.querySelector('#grade');
  const chips = tela.querySelector('#chips');
  const listaItens = tela.querySelector('#itens');

  /* ------------------------------- catálogo ------------------------------- */

  function desenharChips() {
    limpar(chips);
    const todos = html(`<button class="chip ${categoriaAtiva ? '' : 'ativo'}">Todos</button>`);
    todos.addEventListener('click', () => { categoriaAtiva = ''; desenharChips(); desenharGrade(); });
    chips.appendChild(todos);
    categorias.forEach((categoria) => {
      const chip = html(`<button class="chip ${categoriaAtiva === categoria ? 'ativo' : ''}">${escapar(categoria)}</button>`);
      chip.addEventListener('click', () => {
        categoriaAtiva = categoriaAtiva === categoria ? '' : categoria;
        desenharChips();
        desenharGrade();
      });
      chips.appendChild(chip);
    });
  }

  function filtrados() {
    const termo = busca.value.trim().toUpperCase();
    return produtos.filter((p) => {
      if (categoriaAtiva && p.categoria !== categoriaAtiva) return false;
      if (!termo) return true;
      return p.codigo.toUpperCase().includes(termo)
        || p.descricao.toUpperCase().includes(termo)
        || String(p.codigo_barras).includes(termo);
    });
  }

  function desenharGrade() {
    const lista = filtrados();
    limpar(grade);
    if (!lista.length) {
      grade.appendChild(html('<div class="vazio" style="grid-column:1/-1"><span class="icone">🔍</span>Nenhum produto encontrado.</div>'));
      return;
    }
    lista.slice(0, 60).forEach((produto, i) => {
      const semEstoque = produto.estoque <= 0;
      const mini = fotoMini(produto);
      const critico = !semEstoque && produto.estoque <= produto.estoque_minimo;
      const botao = html(`
        <button class="produto-tile ${semEstoque ? 'sem-estoque' : ''}" style="--i:${i}" ${semEstoque ? 'disabled' : ''}>
          <span class="tile-vitrine">
            ${mini
              ? `<img src="${escapar(mini)}" alt="${escapar(produto.descricao)}" loading="lazy"
                     data-cheia="${escapar(produto.foto)}"
                     onerror="if (!this.dataset.tentou) { this.dataset.tentou = 1; this.src = this.dataset.cheia; } else { this.remove(); }">`
              : `<span class="sem-foto">${escapar(iniciaisProduto(produto.descricao))}</span>`}
            <span class="tile-selo-estoque ${semEstoque ? 'zerado' : critico ? 'baixo' : ''}">
              ${semEstoque ? 'sem estoque' : `${numero(produto.estoque)} ${escapar(produto.unidade.toLowerCase())}`}
            </span>
            <span class="tile-preco-flutuante">${dinheiro(produto.preco_venda)}</span>
          </span>
          <span class="tile-corpo">
            <span class="cod">${escapar(produto.codigo)}</span>
            <span class="nome">${escapar(produto.descricao)}</span>
          </span>
        </button>
      `);
      botao.addEventListener('click', () => adicionar(produto));
      grade.appendChild(botao);
    });
  }

  /* ------------------------------- comanda ------------------------------- */

  function adicionar(produto, quantidade = 1) {
    const existente = carrinho.find((i) => i.codigo === produto.codigo);
    const noCarrinho = existente ? existente.quantidade : 0;
    if (noCarrinho + quantidade > produto.estoque) {
      avisar(`Estoque insuficiente de ${produto.descricao} (disponível: ${numero(produto.estoque)}).`, 'erro');
      return;
    }
    if (existente) existente.quantidade += quantidade;
    else {
      carrinho.push({
        codigo: produto.codigo,
        descricao: produto.descricao,
        unidade: produto.unidade,
        foto: produto.foto,
        preco_unitario: produto.preco_venda,
        estoque: produto.estoque,
        quantidade,
      });
    }
    desenharComanda(produto.codigo);
  }

  function totalizar() {
    const subtotal = carrinho.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
    const total = Math.max(0, subtotal - descontoGeral);
    const itens = carrinho.reduce((s, i) => s + i.quantidade, 0);
    return { subtotal, total, itens };
  }

  function desenharComanda(destaque) {
    limpar(listaItens);

    if (!carrinho.length) {
      listaItens.appendChild(html(`
        <div class="vazio">
          <span class="icone">🔥</span>
          Comanda vazia.<br>
          <small class="fraco">Bipe um código ou clique nos produtos ao lado.</small>
        </div>
      `));
    }

    [...carrinho].reverse().forEach((item) => {
      const linha = html(`
        <div class="item-comanda ${destaque === item.codigo ? 'destaque' : ''}">
          <div class="celula-produto">
            ${miniatura(item, 'pequena')}
            <div style="min-width:0">
              <div class="titulo">${escapar(item.descricao)}</div>
              <div class="info">${escapar(item.codigo)} · ${dinheiro(item.preco_unitario)} / ${escapar(item.unidade.toLowerCase())}</div>
            </div>
          </div>
          <div class="total-item">${dinheiro(item.preco_unitario * item.quantidade)}</div>
          <div class="acoes">
            <button class="passo" data-acao="menos" title="Diminuir">−</button>
            <input class="qtd-item" value="${numero(item.quantidade)}" inputmode="decimal">
            <button class="passo" data-acao="mais" title="Aumentar">+</button>
            <span class="espaco"></span>
            <button class="passo" data-acao="remover" title="Remover item">🗑</button>
          </div>
        </div>
      `);

      linha.querySelector('[data-acao="menos"]').addEventListener('click', () => {
        item.quantidade = Math.max(0, item.quantidade - 1);
        if (item.quantidade === 0) carrinho.splice(carrinho.indexOf(item), 1);
        desenharComanda();
      });
      linha.querySelector('[data-acao="mais"]').addEventListener('click', () => {
        if (item.quantidade + 1 > item.estoque) {
          avisar(`Estoque insuficiente (disponível: ${numero(item.estoque)}).`, 'erro');
          return;
        }
        item.quantidade += 1;
        desenharComanda(item.codigo);
      });
      linha.querySelector('[data-acao="remover"]').addEventListener('click', () => {
        carrinho.splice(carrinho.indexOf(item), 1);
        desenharComanda();
      });
      const campo = linha.querySelector('.qtd-item');
      campo.addEventListener('change', () => {
        const nova = valorNumerico(campo.value);
        if (nova <= 0) carrinho.splice(carrinho.indexOf(item), 1);
        else if (nova > item.estoque) {
          avisar(`Estoque insuficiente (disponível: ${numero(item.estoque)}).`, 'erro');
        } else item.quantidade = nova;
        desenharComanda();
      });

      listaItens.appendChild(linha);
    });

    const { subtotal, total, itens } = totalizar();
    tela.querySelector('#qtd-itens').textContent = numero(itens);
    tela.querySelector('#subtotal').textContent = dinheiro(subtotal);
    tela.querySelector('#desconto').textContent = `- ${dinheiro(descontoGeral)}`;
    tela.querySelector('#total').textContent = dinheiro(total);
    tela.querySelector('#btn-finalizar').disabled = carrinho.length === 0;
  }

  function limparComanda() {
    carrinho.length = 0;
    descontoGeral = 0;
    cliente = '';
    tela.querySelector('#btn-cliente').textContent = '+ Cliente';
    desenharComanda();
    busca.focus();
  }

  /* ------------------------------- diálogos ------------------------------- */

  function pedirCliente() {
    const modal = abrirModal({
      titulo: 'Identificar cliente',
      subtitulo: 'Opcional — sai impresso no cupom',
      largura: 'estreito',
      corpo: `
        <div class="campo">
          <label>Nome do cliente</label>
          <input id="nome-cliente" value="${escapar(cliente)}" placeholder="ex.: Dona Alexandra" autofocus>
        </div>
      `,
      rodape: '<button class="botao botao-brasa" data-acao="ok">Aplicar</button>',
    });
    const aplicar = () => {
      cliente = modal.elemento.querySelector('#nome-cliente').value.trim();
      tela.querySelector('#btn-cliente').textContent = cliente ? `👤 ${cliente.split(' ')[0]}` : '+ Cliente';
      modal.fechar();
    };
    modal.elemento.querySelector('[data-acao="ok"]').addEventListener('click', aplicar);
    modal.elemento.querySelector('#nome-cliente').addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicar(); });
    setTimeout(() => modal.elemento.querySelector('#nome-cliente').focus(), 40);
  }

  function pedirDesconto() {
    if (!carrinho.length) return;
    const { subtotal } = totalizar();
    const modal = abrirModal({
      titulo: 'Desconto na venda',
      subtitulo: `Subtotal de ${dinheiro(subtotal)}`,
      largura: 'estreito',
      corpo: `
        <div class="linha-form">
          <div class="campo">
            <label>Desconto em R$</label>
            <input id="desc-valor" inputmode="decimal" value="${descontoGeral ? descontoGeral.toFixed(2).replace('.', ',') : ''}" placeholder="0,00" autofocus>
          </div>
          <div class="campo">
            <label>Ou em %</label>
            <input id="desc-percent" inputmode="decimal" placeholder="0">
          </div>
        </div>
        <p class="fraco" style="margin:4px 0 0;font-size:12.5px">O desconto é rateado entre os itens para o cálculo do lucro.</p>
      `,
      rodape: `
        <button class="botao" data-acao="zerar">Remover desconto</button>
        <button class="botao botao-brasa" data-acao="ok">Aplicar</button>
      `,
    });

    const campoValor = modal.elemento.querySelector('#desc-valor');
    const campoPercent = modal.elemento.querySelector('#desc-percent');
    campoPercent.addEventListener('input', () => {
      const percentual = valorNumerico(campoPercent.value);
      campoValor.value = ((subtotal * percentual) / 100).toFixed(2).replace('.', ',');
    });

    const aplicar = () => {
      const valor = valorNumerico(campoValor.value);
      if (valor > subtotal) { avisar('Desconto maior que o subtotal.', 'erro'); return; }
      descontoGeral = Math.max(0, valor);
      desenharComanda();
      modal.fechar();
    };
    modal.elemento.querySelector('[data-acao="ok"]').addEventListener('click', aplicar);
    modal.elemento.querySelector('[data-acao="zerar"]').addEventListener('click', () => {
      descontoGeral = 0; desenharComanda(); modal.fechar();
    });
    campoValor.addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicar(); });
    setTimeout(() => campoValor.focus(), 40);
  }

  async function pedirAberturaDeCaixa() {
    return new Promise((resolver) => {
      let abriu = false;
      const modal = abrirModal({
        titulo: 'Abrir o caixa',
        subtitulo: 'É necessário abrir o caixa antes de vender',
        largura: 'estreito',
        corpo: `
          <div class="campo">
            <label>Fundo de troco inicial (R$)</label>
            <input id="fundo" inputmode="decimal" value="100,00" autofocus>
          </div>
          <p class="fraco" style="margin:0;font-size:12.5px">O valor informado entra como saldo inicial em dinheiro para a conferência do fechamento.</p>
        `,
        rodape: '<button class="botao botao-brasa" data-acao="abrir">Abrir caixa</button>',
        aoFechar: () => { if (!abriu) resolver(false); },
      });
      modal.elemento.querySelector('[data-acao="abrir"]').addEventListener('click', async () => {
        try {
          const resposta = await api('/api/caixa/abrir', {
            metodo: 'POST',
            corpo: { valor_abertura: valorNumerico(modal.elemento.querySelector('#fundo').value) },
          });
          contexto.caixa = resposta.caixa;
          await contexto.atualizarCaixa();
          avisar('Caixa aberto. Boas vendas!', 'sucesso');
          abriu = true;
          modal.fechar();
          resolver(true);
        } catch (erro) {
          avisar(erro.message, 'erro');
        }
      });
      setTimeout(() => modal.elemento.querySelector('#fundo')?.select(), 40);
    });
  }

  /* ------------------------------ pagamento ------------------------------ */

  function abrirPagamento() {
    if (!carrinho.length) return;
    const { total } = totalizar();
    const pagamentos = [];
    let formaAtual = 'DINHEIRO';

    const modal = abrirModal({
      titulo: 'Receber pagamento',
      subtitulo: `${carrinho.length} produto(s) na comanda`,
      corpo: `
        <div class="linha" style="justify-content:space-between;align-items:flex-end;margin-bottom:18px">
          <div>
            <div class="rotulo">Total a receber</div>
            <div class="valor-total" style="font-size:34px">${dinheiro(total)}</div>
          </div>
          <div style="text-align:right">
            <div class="rotulo">Cliente</div>
            <div>${cliente ? escapar(cliente) : '<span class="fraco">Não identificado</span>'}</div>
          </div>
        </div>

        <div class="rotulo" style="margin-bottom:9px">Forma de pagamento</div>
        <div class="formas-grade" id="formas">
          ${FORMAS.map((f) => `
            <button class="forma-btn ${f.nome === 'DINHEIRO' ? 'ativo' : ''}" data-forma="${f.nome}">
              <span class="simbolo">${f.simbolo}</span>${escapar(f.nome)}
              <div class="fraco" style="font-size:10px;margin-top:3px">tecla ${f.tecla}</div>
            </button>
          `).join('')}
        </div>

        <div class="linha-form">
          <div class="campo">
            <label>Valor recebido</label>
            <input id="valor-pago" inputmode="decimal" class="mono" value="${total.toFixed(2).replace('.', ',')}">
          </div>
          <div class="campo">
            <label>Parcelas (crédito)</label>
            <select id="parcelas">
              ${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}x</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="teclado" id="teclado">
          ${[10, 20, 50, 100, 150, 200].map((v) => `<button data-valor="${v}" class="especial">R$ ${v}</button>`).join('')}
          <button data-acao="restante" class="especial" style="grid-column:span 2">Valor restante</button>
          <button data-acao="limpar" class="especial">Limpar</button>
        </div>

        <div id="lista-pagamentos"></div>

        <div class="painel-troco">
          <div class="bloco">
            <div class="rotulo">Falta receber</div>
            <div class="valor num" id="falta">${dinheiro(total)}</div>
          </div>
          <div class="bloco" style="text-align:right">
            <div class="rotulo">Troco</div>
            <div class="valor num dourado" id="troco">R$ 0,00</div>
          </div>
        </div>
      `,
      rodape: `
        <button class="botao" data-acao="somar">+ Somar pagamento</button>
        <button class="botao botao-brasa" data-acao="confirmar">Confirmar e imprimir · Enter</button>
      `,
    });

    const elemento = modal.elemento;
    const campoValor = elemento.querySelector('#valor-pago');
    const campoParcelas = elemento.querySelector('#parcelas');
    const lista = elemento.querySelector('#lista-pagamentos');

    const jaPago = () => pagamentos.reduce((s, p) => s + p.valor, 0);
    const restante = () => Math.max(0, Math.round((total - jaPago()) * 100) / 100);

    function atualizarPainel() {
      const digitado = valorNumerico(campoValor.value);
      const totalPrevisto = jaPago() + digitado;
      const falta = Math.max(0, Math.round((total - totalPrevisto) * 100) / 100);
      const troco = Math.max(0, Math.round((totalPrevisto - total) * 100) / 100);
      elemento.querySelector('#falta').textContent = dinheiro(falta);
      elemento.querySelector('#troco').textContent = dinheiro(troco);

      limpar(lista);
      if (pagamentos.length) {
        lista.appendChild(html(`
          <div style="margin:16px 0 0">
            <div class="rotulo" style="margin-bottom:8px">Pagamentos lançados</div>
            ${pagamentos.map((p, i) => `
              <div class="linha" style="padding:8px 12px;border:1px solid var(--borda);border-radius:9px;margin-bottom:6px">
                <span>${escapar(p.forma)}${p.parcelas > 1 ? ` · ${p.parcelas}x` : ''}</span>
                <span class="espaco"></span>
                <span class="num">${dinheiro(p.valor)}</span>
                <button class="passo" data-remover="${i}">✕</button>
              </div>
            `).join('')}
          </div>
        `));
        lista.querySelectorAll('[data-remover]').forEach((botao) => {
          botao.addEventListener('click', () => {
            pagamentos.splice(Number(botao.dataset.remover), 1);
            campoValor.value = restante().toFixed(2).replace('.', ',');
            atualizarPainel();
          });
        });
      }
    }

    elemento.querySelectorAll('[data-forma]').forEach((botao) => {
      botao.addEventListener('click', () => {
        formaAtual = botao.dataset.forma;
        elemento.querySelectorAll('[data-forma]').forEach((b) => b.classList.toggle('ativo', b === botao));
        campoValor.focus();
        campoValor.select();
      });
    });

    elemento.querySelectorAll('#teclado button').forEach((botao) => {
      botao.addEventListener('click', () => {
        if (botao.dataset.valor) campoValor.value = Number(botao.dataset.valor).toFixed(2).replace('.', ',');
        else if (botao.dataset.acao === 'restante') campoValor.value = restante().toFixed(2).replace('.', ',');
        else campoValor.value = '';
        atualizarPainel();
        campoValor.focus();
      });
    });

    campoValor.addEventListener('input', atualizarPainel);

    function somarPagamento() {
      const valor = valorNumerico(campoValor.value);
      if (valor <= 0) { avisar('Informe o valor recebido.', 'erro'); return false; }
      pagamentos.push({
        forma: formaAtual,
        valor: Math.min(valor, formaAtual === 'DINHEIRO' ? valor : restante() || valor),
        recebido: valor,
        parcelas: formaAtual === 'CARTÃO DE CRÉDITO' ? Number(campoParcelas.value) : 0,
      });
      campoValor.value = restante().toFixed(2).replace('.', ',');
      atualizarPainel();
      return true;
    }

    async function confirmar_() {
      if (restante() > 0 && !somarPagamento()) return;
      if (restante() > 0) { avisar(`Ainda faltam ${dinheiro(restante())}.`, 'erro'); return; }

      const botao = elemento.querySelector('[data-acao="confirmar"]');
      botao.disabled = true;
      botao.textContent = 'Registrando...';

      try {
        const resposta = await api('/api/vendas', {
          metodo: 'POST',
          corpo: {
            itens: carrinho.map((i) => ({
              codigo: i.codigo,
              quantidade: i.quantidade,
              preco_unitario: i.preco_unitario,
            })),
            pagamentos,
            desconto: descontoGeral,
            cliente,
          },
        });

        modal.fechar();
        limparComanda();
        await recarregarProdutos();
        await contexto.atualizarCaixa();
        avisar(`Venda ${resposta.venda.numero} registrada.`, 'sucesso');
        mostrarCupom(resposta, { aoFechar: () => busca.focus() });
      } catch (erro) {
        botao.disabled = false;
        botao.textContent = 'Confirmar e imprimir · Enter';
        if (/caixa/i.test(erro.message)) {
          const abriu = await pedirAberturaDeCaixa();
          if (abriu) confirmar_();
          return;
        }
        avisar(erro.message, 'erro');
      }
    }

    elemento.querySelector('[data-acao="somar"]').addEventListener('click', somarPagamento);
    elemento.querySelector('[data-acao="confirmar"]').addEventListener('click', confirmar_);

    elemento.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') { evento.preventDefault(); confirmar_(); }
      if (evento.key === '+') { evento.preventDefault(); somarPagamento(); }
      if (evento.target !== campoValor && /^[1-6]$/.test(evento.key)) {
        const forma = FORMAS.find((f) => f.tecla === evento.key);
        if (forma) elemento.querySelector(`[data-forma="${forma.nome}"]`).click();
      }
    });

    atualizarPainel();
    setTimeout(() => { campoValor.focus(); campoValor.select(); }, 60);
  }

  async function recarregarProdutos() {
    const novos = await api('/api/produtos');
    produtos = novos.produtos.filter((p) => p.ativo);
    desenharGrade();
  }

  /* -------------------------------- eventos -------------------------------- */

  busca.addEventListener('input', desenharGrade);
  busca.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    const termo = busca.value.trim();
    if (!termo) return;

    // "3*CODIGO" ou "3x CODIGO" lança quantidade direta
    const multiplicador = termo.match(/^(\d+(?:[.,]\d+)?)\s*[*x]\s*(.+)$/i);
    const alvo = multiplicador ? multiplicador[2].trim().toUpperCase() : termo.toUpperCase();
    const quantidade = multiplicador ? valorNumerico(multiplicador[1]) : 1;

    const exato = produtos.find((p) => p.codigo.toUpperCase() === alvo || String(p.codigo_barras) === alvo);
    const candidatos = exato ? [exato] : filtrados();
    if (!candidatos.length) { avisar('Produto não encontrado.', 'erro'); return; }
    adicionar(candidatos[0], quantidade);
    busca.value = '';
    desenharGrade();
  });

  tela.querySelector('#btn-finalizar').addEventListener('click', abrirPagamento);
  tela.querySelector('#btn-desconto').addEventListener('click', pedirDesconto);
  tela.querySelector('#btn-cliente').addEventListener('click', pedirCliente);
  tela.querySelector('#btn-cancelar').addEventListener('click', async () => {
    if (!carrinho.length) return;
    const certeza = await confirmar({
      titulo: 'Cancelar a venda?',
      mensagem: 'Todos os itens da comanda serão descartados. Nada é gravado na base.',
      textoConfirmar: 'Cancelar venda',
      perigo: true,
    });
    if (certeza) { limparComanda(); avisar('Comanda limpa.', 'info'); }
  });

  function atalhos(evento) {
    if (document.querySelector('.cortina')) return;
    if (evento.key === 'F2') { evento.preventDefault(); busca.focus(); busca.select(); }
    if (evento.key === 'F4') { evento.preventDefault(); abrirPagamento(); }
    if (evento.key === 'F6') { evento.preventDefault(); pedirDesconto(); }
    if (evento.key === 'F7') { evento.preventDefault(); pedirCliente(); }
  }
  document.addEventListener('keydown', atalhos);

  desenharChips();
  desenharGrade();
  desenharComanda();
  setTimeout(() => busca.focus(), 80);

  if (!contexto.caixa || contexto.caixa.status !== 'ABERTO') {
    setTimeout(() => {
      avisar('Caixa fechado — abra o caixa para registrar vendas.', 'info', 5200);
    }, 400);
  }

  return () => document.removeEventListener('keydown', atalhos);
}
