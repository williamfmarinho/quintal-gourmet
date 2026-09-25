/** Kits: conjuntos de produtos vendidos com preço fechado ou desconto. */

import { api } from '../api.js';
import {
  html, limpar, avisar, dinheiro, numero, percentual, escapar,
  abrirModal, confirmar, miniatura,
} from '../util.js';

const decimal = (texto) => Number(String(texto ?? '').replace(/\./g, '').replace(',', '.')) || 0;
const paraCampo = (valor) => (valor ? String(valor).replace('.', ',') : '');

export async function montar(raiz) {
  let [dadosKits, dadosProdutos] = await Promise.all([api('/api/kits'), api('/api/produtos')]);
  const produtos = dadosProdutos.produtos.filter((p) => p.ativo);

  limpar(raiz);
  const tela = html(`
    <div class="pilha">
      <div class="cabecalho-secao">
        <div>
          <h2>Kits de produtos</h2>
          <p>Combine itens do catálogo e venda tudo junto, com preço fechado ou desconto.</p>
        </div>
        <button class="botao botao-brasa" id="novo">+ Novo kit</button>
      </div>

      <div class="grade grade-4" id="resumo"></div>
      <div id="lista"></div>
    </div>
  `);
  raiz.appendChild(tela);

  /* ------------------------------ listagem ------------------------------ */

  function desenhar() {
    const kits = dadosKits.kits;
    const economiaMedia = kits.length
      ? kits.reduce((s, k) => s + k.desconto_percentual_efetivo, 0) / kits.length
      : 0;

    tela.querySelector('#resumo').innerHTML = `
      <div class="indicador"><div class="rotulo">Kits cadastrados</div><div class="valor">${numero(kits.length)}</div><div class="nota">${kits.filter((k) => k.ativo).length} ativo(s)</div></div>
      <div class="indicador"><div class="rotulo">Desconto médio</div><div class="valor dourado">${percentual(economiaMedia)}</div><div class="nota">sobre a soma dos itens</div></div>
      <div class="indicador"><div class="rotulo">Prontos para vender</div><div class="valor">${numero(kits.filter((k) => k.kits_possiveis > 0).length)}</div><div class="nota">com estoque para pelo menos 1</div></div>
      <div class="indicador"><div class="rotulo">Sem estoque</div><div class="valor ${kits.some((k) => k.ativo && k.kits_possiveis === 0) ? 'negativo' : ''}">${numero(kits.filter((k) => k.ativo && k.kits_possiveis === 0).length)}</div><div class="nota">falta algum componente</div></div>
    `;

    const alvo = tela.querySelector('#lista');
    if (!kits.length) {
      alvo.innerHTML = `
        <div class="cartao">
          <div class="vazio">
            <span class="icone">🎁</span>
            Nenhum kit criado ainda.<br>
            <small class="fraco">Um kit junta dois ou mais produtos por um preço melhor que o da soma.</small>
          </div>
        </div>`;
      return;
    }

    alvo.innerHTML = `<div class="grade grade-2">${kits.map((kit) => `
      <div class="cartao kit-cartao ${kit.ativo ? '' : 'inativo'}">
        <div class="kit-topo">
          <div style="min-width:0">
            <div class="kit-nome">${escapar(kit.nome)}</div>
            <div class="fraco mono" style="font-size:11px">${escapar(kit.codigo)} · ${kit.itens.length} produtos${kit.ativo ? '' : ' · INATIVO'}</div>
          </div>
          <span class="etiqueta ${kit.modo_preco === 'VALOR' ? 'neutra' : 'atencao'}">
            ${kit.modo_preco === 'VALOR' ? 'preço fixo' : `${percentual(kit.desconto_percentual)} off`}
          </span>
        </div>

        <div class="kit-itens">
          ${kit.itens.map((item) => `
            <div class="kit-item">
              ${miniatura(item, 'pequena')}
              <div style="flex:1;min-width:0">
                <div class="kit-item-nome">${escapar(item.descricao)}</div>
                <div class="fraco mono" style="font-size:11px">${numero(item.quantidade)} × ${dinheiro(item.preco_unitario)}</div>
              </div>
              <div class="num fraco">${dinheiro(item.total_lista)}</div>
            </div>
          `).join('')}
        </div>

        <div class="kit-precos">
          <div>
            <div class="rotulo">Separado</div>
            <div class="num riscado">${dinheiro(kit.preco_lista)}</div>
          </div>
          <div>
            <div class="rotulo">No kit</div>
            <div class="kit-preco-final">${dinheiro(kit.preco_efetivo)}</div>
          </div>
          <div style="text-align:right">
            <div class="rotulo">Economia</div>
            <div class="num positivo">${dinheiro(kit.desconto_valor)}</div>
          </div>
        </div>

        <div class="linha" style="margin-top:14px;gap:8px">
          <span class="etiqueta ${kit.kits_possiveis > 0 ? 'ok' : 'zerado'}">
            ${kit.kits_possiveis > 0 ? `dá para montar ${kit.kits_possiveis}` : 'sem estoque'}
          </span>
          <span class="espaco"></span>
          <button class="botao botao-mini" data-editar="${kit.id}">Editar</button>
          <button class="botao botao-mini botao-perigo" data-excluir="${kit.id}">Excluir</button>
        </div>
      </div>
    `).join('')}</div>`;

    alvo.querySelectorAll('[data-editar]').forEach((botao) => {
      botao.addEventListener('click', () => abrirAssistente(kits.find((k) => String(k.id) === botao.dataset.editar)));
    });
    alvo.querySelectorAll('[data-excluir]').forEach((botao) => {
      botao.addEventListener('click', () => excluir(kits.find((k) => String(k.id) === botao.dataset.excluir)));
    });
  }

  async function recarregar() {
    [dadosKits, dadosProdutos] = await Promise.all([api('/api/kits'), api('/api/produtos')]);
    desenhar();
  }

  async function excluir(kit) {
    const certeza = await confirmar({
      titulo: `Excluir o kit ${kit.nome}?`,
      mensagem: 'Os produtos continuam no catálogo — só a combinação deixa de existir. Vendas já feitas com este kit não mudam.',
      textoConfirmar: 'Excluir kit',
      perigo: true,
    });
    if (!certeza) return;
    try {
      await api(`/api/kits/${kit.id}`, { metodo: 'DELETE' });
      avisar('Kit excluído.', 'sucesso');
      recarregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  /* --------------------------- assistente em 2 passos --------------------------- */

  function abrirAssistente(kitExistente) {
    // Estado do assistente: itens escolhidos e como o preço foi definido.
    const selecao = new Map();
    if (kitExistente) {
      kitExistente.itens.forEach((item) => selecao.set(item.codigo, Number(item.quantidade)));
    }
    let passo = 1;
    let modo = kitExistente ? kitExistente.modo_preco : 'PERCENTUAL';
    let nome = kitExistente ? kitExistente.nome : '';
    let ativo = kitExistente ? kitExistente.ativo : true;
    let precoDigitado = kitExistente && kitExistente.modo_preco === 'VALOR' ? kitExistente.preco_venda : 0;
    let descontoDigitado = kitExistente && kitExistente.modo_preco !== 'VALOR' ? kitExistente.desconto_percentual : 10;

    const modal = abrirModal({
      titulo: kitExistente ? `Editar ${kitExistente.nome}` : 'Novo kit',
      subtitulo: 'Passo 1 de 2 — escolha os produtos',
      largura: 'largo',
      corpo: '<div id="assistente"></div>',
      rodape: `
        <button class="botao" data-acao="voltar" hidden>← Voltar</button>
        <span class="espaco"></span>
        <span class="fraco" id="dica-passo" style="font-size:12.5px"></span>
        <button class="botao botao-brasa" data-acao="avancar">Avançar →</button>
      `,
    });

    const corpo = modal.elemento.querySelector('#assistente');
    const botaoAvancar = modal.elemento.querySelector('[data-acao="avancar"]');
    const botaoVoltar = modal.elemento.querySelector('[data-acao="voltar"]');
    const dica = modal.elemento.querySelector('#dica-passo');

    const somaLista = () => Math.round([...selecao.entries()].reduce((soma, [codigo, qtd]) => {
      const produto = produtos.find((p) => p.codigo === codigo);
      return soma + (produto ? produto.preco_venda * qtd : 0);
    }, 0) * 100) / 100;

    const precoAtual = () => (modo === 'VALOR'
      ? precoDigitado
      : Math.round(somaLista() * (1 - descontoDigitado / 100) * 100) / 100);

    /* ------------------------------ passo 1 ------------------------------ */

    function desenharPasso1() {
      const lista = somaLista();
      corpo.innerHTML = `
        <div class="grade grade-2-1" style="gap:20px">
          <div>
            <div class="campo">
              <label>Buscar produto</label>
              <input id="busca-produto" placeholder="nome ou código" autocomplete="off">
            </div>
            <div class="escolha-produtos" id="catalogo"></div>
          </div>

          <div>
            <div class="rotulo" style="margin-bottom:10px">No kit (${selecao.size})</div>
            <div id="escolhidos" class="pilha" style="gap:8px"></div>
            <div class="painel-troco" style="margin-top:16px;grid-template-columns:1fr">
              <div class="bloco">
                <div class="rotulo">Soma dos preços</div>
                <div class="valor num">${dinheiro(lista)}</div>
              </div>
            </div>
          </div>
        </div>
      `;

      const catalogo = corpo.querySelector('#catalogo');
      const busca = corpo.querySelector('#busca-produto');

      function desenharCatalogo() {
        const termo = busca.value.trim().toUpperCase();
        const filtrados = produtos.filter((p) => (
          !termo || p.codigo.toUpperCase().includes(termo) || p.descricao.toUpperCase().includes(termo)
        ));
        catalogo.innerHTML = filtrados.length
          ? filtrados.map((p) => `
            <button class="escolha-item ${selecao.has(p.codigo) ? 'escolhido' : ''}" data-codigo="${escapar(p.codigo)}">
              ${miniatura(p, 'pequena')}
              <div style="flex:1;min-width:0;text-align:left">
                <div class="kit-item-nome">${escapar(p.descricao)}</div>
                <div class="fraco mono" style="font-size:11px">${escapar(p.codigo)} · ${dinheiro(p.preco_venda)} · ${numero(p.estoque)} em estoque</div>
              </div>
              <span class="passo">${selecao.has(p.codigo) ? '✓' : '+'}</span>
            </button>
          `).join('')
          : '<div class="vazio">Nenhum produto encontrado.</div>';

        catalogo.querySelectorAll('[data-codigo]').forEach((botao) => {
          botao.addEventListener('click', () => {
            const codigo = botao.dataset.codigo;
            if (selecao.has(codigo)) selecao.delete(codigo);
            else selecao.set(codigo, 1);
            desenharPasso1();
            corpo.querySelector('#busca-produto').value = termo;
          });
        });
      }

      function desenharEscolhidos() {
        const alvo = corpo.querySelector('#escolhidos');
        if (!selecao.size) {
          alvo.innerHTML = '<div class="vazio" style="padding:24px 12px"><small>Escolha pelo menos 2 produtos.</small></div>';
          return;
        }
        alvo.innerHTML = [...selecao.entries()].map(([codigo, qtd]) => {
          const produto = produtos.find((p) => p.codigo === codigo);
          return `
            <div class="kit-item">
              ${miniatura(produto, 'pequena')}
              <div style="flex:1;min-width:0">
                <div class="kit-item-nome">${escapar(produto.descricao)}</div>
                <div class="fraco mono" style="font-size:11px">${dinheiro(produto.preco_venda)} cada</div>
              </div>
              <div class="linha" style="gap:5px">
                <button class="passo" data-menos="${escapar(codigo)}">−</button>
                <span class="num" style="min-width:22px;text-align:center">${numero(qtd)}</span>
                <button class="passo" data-mais="${escapar(codigo)}">+</button>
                <button class="passo" data-tirar="${escapar(codigo)}">✕</button>
              </div>
            </div>`;
        }).join('');

        alvo.querySelectorAll('[data-mais]').forEach((b) => b.addEventListener('click', () => {
          selecao.set(b.dataset.mais, selecao.get(b.dataset.mais) + 1); desenharPasso1();
        }));
        alvo.querySelectorAll('[data-menos]').forEach((b) => b.addEventListener('click', () => {
          const atual = selecao.get(b.dataset.menos);
          if (atual <= 1) selecao.delete(b.dataset.menos); else selecao.set(b.dataset.menos, atual - 1);
          desenharPasso1();
        }));
        alvo.querySelectorAll('[data-tirar]').forEach((b) => b.addEventListener('click', () => {
          selecao.delete(b.dataset.tirar); desenharPasso1();
        }));
      }

      busca.addEventListener('input', desenharCatalogo);
      desenharCatalogo();
      desenharEscolhidos();
      atualizarRodape();
    }

    /* ------------------------------ passo 2 ------------------------------ */

    function desenharPasso2() {
      const lista = somaLista();
      corpo.innerHTML = `
        <div class="campo">
          <label>Nome do kit *</label>
          <input id="kit-nome" value="${escapar(nome)}" placeholder="ex.: Kit Feijoada Completa" autofocus>
        </div>

        <div class="kit-resumo">
          ${[...selecao.entries()].map(([codigo, qtd]) => {
            const produto = produtos.find((p) => p.codigo === codigo);
            return `<div class="linha" style="justify-content:space-between;font-size:13px">
              <span>${numero(qtd)}× ${escapar(produto.descricao)}</span>
              <span class="num fraco">${dinheiro(produto.preco_venda * qtd)}</span>
            </div>`;
          }).join('')}
          <div class="linha" style="justify-content:space-between;border-top:1px dashed var(--borda-forte);margin-top:8px;padding-top:8px">
            <b>Soma separada</b><b class="num">${dinheiro(lista)}</b>
          </div>
        </div>

        <div class="linha-form" style="margin-top:18px">
          <div class="campo">
            <label>Preço do kit (R$)</label>
            <input id="kit-preco" inputmode="decimal" class="mono">
          </div>
          <div class="campo">
            <label>Ou desconto (%)</label>
            <input id="kit-desconto" inputmode="decimal" class="mono">
          </div>
        </div>

        <div class="painel-troco" style="margin-top:4px">
          <div class="bloco">
            <div class="rotulo">Cliente paga</div>
            <div class="valor num" id="previa-preco">—</div>
          </div>
          <div class="bloco" style="text-align:right">
            <div class="rotulo">Economia</div>
            <div class="valor num positivo" id="previa-economia">—</div>
          </div>
        </div>

        <p class="fraco" id="explicacao-modo" style="font-size:12.5px;margin:14px 0 0;line-height:1.6"></p>

        <div class="campo" style="margin-top:14px">
          <label>Situação</label>
          <select id="kit-ativo">
            <option value="1" ${ativo ? 'selected' : ''}>Ativo — aparece no caixa</option>
            <option value="0" ${ativo ? '' : 'selected'}>Inativo — fica guardado, mas não vende</option>
          </select>
        </div>
      `;

      const campoPreco = corpo.querySelector('#kit-preco');
      const campoDesconto = corpo.querySelector('#kit-desconto');
      const campoNome = corpo.querySelector('#kit-nome');

      function sincronizar(origem) {
        const soma = somaLista();
        if (origem === 'preco') {
          modo = 'VALOR';
          precoDigitado = decimal(campoPreco.value);
          descontoDigitado = soma > 0 ? Math.round((1 - precoDigitado / soma) * 10000) / 100 : 0;
          campoDesconto.value = paraCampo(descontoDigitado.toFixed(2));
        } else if (origem === 'desconto') {
          modo = 'PERCENTUAL';
          descontoDigitado = decimal(campoDesconto.value);
          precoDigitado = Math.round(soma * (1 - descontoDigitado / 100) * 100) / 100;
          campoPreco.value = paraCampo(precoDigitado.toFixed(2));
        } else {
          // primeira pintura: preenche os dois a partir do que já estava salvo
          campoPreco.value = paraCampo(precoAtual().toFixed(2));
          const percentualAtual = soma > 0 ? Math.round((1 - precoAtual() / soma) * 10000) / 100 : 0;
          campoDesconto.value = paraCampo(percentualAtual.toFixed(2));
        }

        const preco = modo === 'VALOR' ? precoDigitado : Math.round(soma * (1 - descontoDigitado / 100) * 100) / 100;
        corpo.querySelector('#previa-preco').textContent = dinheiro(Math.max(0, preco));
        corpo.querySelector('#previa-economia').textContent = dinheiro(Math.max(0, soma - preco));
        corpo.querySelector('#explicacao-modo').innerHTML = modo === 'VALOR'
          ? 'Preço <b>fixo</b>: o kit continua custando esse valor mesmo que o preço dos produtos mude depois.'
          : 'Desconto <b>percentual</b>: o preço do kit acompanha sozinho qualquer mudança de preço dos produtos.';

        botaoAvancar.disabled = preco < 0 || !campoNome.value.trim();
      }

      campoPreco.addEventListener('input', () => sincronizar('preco'));
      campoDesconto.addEventListener('input', () => sincronizar('desconto'));
      campoNome.addEventListener('input', () => sincronizar());
      corpo.querySelector('#kit-ativo').addEventListener('change', (e) => { ativo = e.target.value === '1'; });

      sincronizar();
      atualizarRodape();
      setTimeout(() => campoNome.focus(), 40);
    }

    /* ------------------------------ navegação ------------------------------ */

    function atualizarRodape() {
      const distintos = selecao.size;
      botaoVoltar.hidden = passo === 1;
      modal.elemento.querySelector('.modal-topo small').textContent = passo === 1
        ? 'Passo 1 de 2 — escolha os produtos'
        : 'Passo 2 de 2 — nome e preço';

      if (passo === 1) {
        botaoAvancar.textContent = 'Avançar →';
        botaoAvancar.disabled = distintos < 2;
        dica.textContent = distintos < 2
          ? `Faltam ${2 - distintos} produto(s) para formar um kit`
          : `${distintos} produtos escolhidos`;
      } else {
        botaoAvancar.textContent = kitExistente ? 'Salvar alterações' : 'Criar kit';
        dica.textContent = '';
      }
    }

    botaoVoltar.addEventListener('click', () => { passo = 1; desenharPasso1(); });

    botaoAvancar.addEventListener('click', async () => {
      if (passo === 1) { passo = 2; desenharPasso2(); return; }

      const corpoEnvio = {
        id: kitExistente ? kitExistente.id : undefined,
        nome: corpo.querySelector('#kit-nome').value.trim(),
        modo_preco: modo,
        preco_venda: modo === 'VALOR' ? precoDigitado : 0,
        desconto_percentual: modo === 'VALOR' ? 0 : descontoDigitado,
        ativo,
        itens: [...selecao.entries()].map(([codigo, quantidade]) => ({ codigo, quantidade })),
      };

      botaoAvancar.disabled = true;
      try {
        await api('/api/kits', { metodo: 'POST', corpo: corpoEnvio });
        modal.fechar();
        await recarregar();
        avisar(kitExistente ? 'Kit atualizado.' : 'Kit criado.', 'sucesso');
      } catch (erro) {
        avisar(erro.message, 'erro');
        botaoAvancar.disabled = false;
      }
    });

    desenharPasso1();
  }

  tela.querySelector('#novo').addEventListener('click', () => abrirAssistente(null));
  desenhar();
}
