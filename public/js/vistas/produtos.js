/** Consulta de produtos: preços, estoque, margem e ficha completa do item. */

import { api } from '../api.js';
import {
  html, limpar, avisar, dinheiro, numero, percentual, escapar, dataHora,
  abrirModal, etiquetaSituacao, miniatura, fotoMini, iniciaisProduto,
} from '../util.js';

const SITUACOES = ['OK', 'ATENÇÃO', 'CRÍTICO', 'ZERADO'];

export async function montar(raiz, contexto) {
  const admin = contexto.ehAdmin();
  let dados = await api('/api/produtos', { parametros: { incluirInativos: admin ? 'true' : '' } });

  const filtros = { termo: '', categoria: '', situacao: '' };

  limpar(raiz);
  const tela = html(`
    <div class="pilha">
      <div class="cabecalho-secao">
        <div>
          <h2>Catálogo do quintal</h2>
          <p>${admin ? 'Preço, custo médio, margem e giro de cada item.' : 'Consulta de preço e disponibilidade.'}</p>
        </div>
        <div class="linha">
          ${admin ? '<button class="botao botao-brasa" id="novo">+ Novo produto</button>' : ''}
        </div>
      </div>

      <div class="grade grade-4" id="resumo"></div>

      <div class="cartao">
        <div class="filtros">
          <div class="campo busca-linha">
            <label>Buscar</label>
            <span class="lupa" style="top:auto;bottom:11px">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
            </span>
            <input id="termo" placeholder="código, descrição ou código de barras">
          </div>
          <div class="campo">
            <label>Categoria</label>
            <select id="categoria">
              <option value="">Todas</option>
              ${dados.categorias.map((c) => `<option value="${escapar(c.nome)}">${escapar(c.nome)} (${c.itens})</option>`).join('')}
            </select>
          </div>
          <div class="campo">
            <label>Situação do estoque</label>
            <select id="situacao">
              <option value="">Todas</option>
              ${SITUACOES.map((s) => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="tabela-caixa" id="tabela"></div>
      </div>
    </div>
  `);
  raiz.appendChild(tela);

  function aplicarFiltros() {
    const termo = filtros.termo.toUpperCase();
    return dados.produtos.filter((p) => {
      if (filtros.categoria && p.categoria !== filtros.categoria) return false;
      if (filtros.situacao && p.situacao !== filtros.situacao) return false;
      if (!termo) return true;
      return p.codigo.toUpperCase().includes(termo)
        || p.descricao.toUpperCase().includes(termo)
        || String(p.codigo_barras).includes(termo);
    });
  }

  function desenharResumo() {
    const lista = dados.produtos;
    const valorCusto = lista.reduce((s, p) => s + p.valor_estoque_custo, 0);
    const valorVenda = lista.reduce((s, p) => s + p.valor_estoque_venda, 0);
    const margemMedia = valorVenda > 0 ? ((valorVenda - valorCusto) / valorVenda) * 100 : 0;
    const criticos = lista.filter((p) => p.situacao === 'CRÍTICO' || p.situacao === 'ZERADO').length;

    tela.querySelector('#resumo').innerHTML = `
      <div class="indicador"><div class="rotulo">Itens cadastrados</div><div class="valor">${numero(lista.length)}</div><div class="nota">${dados.categorias.length} categorias</div></div>
      <div class="indicador"><div class="rotulo">Estoque a preço de custo</div><div class="valor">${dinheiro(valorCusto)}</div><div class="nota">capital parado</div></div>
      ${admin ? `<div class="indicador"><div class="rotulo">Potencial de venda</div><div class="valor dourado">${dinheiro(valorVenda)}</div><div class="nota">margem média de ${percentual(margemMedia)}</div></div>` : '<div class="indicador"><div class="rotulo">Itens disponíveis</div><div class="valor">' + numero(lista.filter((p) => p.estoque > 0).length) + '</div><div class="nota">com estoque</div></div>'}
      <div class="indicador"><div class="rotulo">Precisam de reposição</div><div class="valor ${criticos ? 'negativo' : 'positivo'}">${numero(criticos)}</div><div class="nota">no mínimo ou zerados</div></div>
    `;
  }

  function desenharTabela() {
    const lista = aplicarFiltros();
    const alvo = tela.querySelector('#tabela');
    if (!lista.length) {
      alvo.innerHTML = '<div class="vazio"><span class="icone">🫙</span>Nenhum produto encontrado com esses filtros.</div>';
      return;
    }

    alvo.innerHTML = `
      <table class="tabela">
        <thead>
          <tr>
            <th>Código</th>
            <th>Produto</th>
            <th>Categoria</th>
            <th class="direita">Preço</th>
            ${admin ? '<th class="direita">Custo médio</th><th class="direita">Margem</th>' : ''}
            <th class="direita">Estoque</th>
            <th class="centro">Situação</th>
            <th class="direita">Sem saída</th>
          </tr>
        </thead>
        <tbody>
          ${lista.map((p) => `
            <tr class="clicavel" data-codigo="${escapar(p.codigo)}">
              <td class="mono dourado">${escapar(p.codigo)}</td>
              <td>
                <div class="celula-produto">
                  ${miniatura(p)}
                  <div style="min-width:0">
                    <div style="font-weight:600">${escapar(p.descricao)}${p.ativo ? '' : ' <span class="etiqueta neutra">inativo</span>'}</div>
                    <div class="fraco mono" style="font-size:11px">${escapar(p.codigo_barras || '—')}</div>
                  </div>
                </div>
              </td>
              <td class="fraco">${escapar(p.categoria)}</td>
              <td class="direita num">${dinheiro(p.preco_venda)}</td>
              ${admin ? `
                <td class="direita num fraco">${dinheiro(p.custo_medio)}</td>
                <td class="direita num ${p.margem_percentual < 15 ? 'negativo' : 'positivo'}">${percentual(p.margem_percentual)}</td>
              ` : ''}
              <td class="direita num">${numero(p.estoque)} <small class="fraco">${escapar(p.unidade.toLowerCase())}</small></td>
              <td class="centro">${etiquetaSituacao(p.situacao)}</td>
              <td class="direita fraco">${p.dias_sem_saida === null ? '—' : `${p.dias_sem_saida}d`}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    alvo.querySelectorAll('[data-codigo]').forEach((linha) => {
      linha.addEventListener('click', () => abrirFicha(linha.dataset.codigo));
    });
  }

  async function recarregar() {
    dados = await api('/api/produtos', { parametros: { incluirInativos: admin ? 'true' : '' } });
    desenharResumo();
    desenharTabela();
  }

  /* --------------------------------- ficha --------------------------------- */

  async function abrirFicha(codigo) {
    const ficha = await api(`/api/produtos/${encodeURIComponent(codigo)}`);
    const p = ficha.produto;
    const h = ficha.historico;

    const modal = abrirModal({
      titulo: p.descricao,
      subtitulo: `${p.codigo} · ${p.categoria} · código de barras ${p.codigo_barras || '—'}`,
      largura: 'largo',
      corpo: `
        <div class="ficha-topo">
          <div class="ficha-foto">
            ${p.foto
              ? `<img src="${escapar(p.foto)}" alt="${escapar(p.descricao)}">`
              : `<div class="sem-foto">${escapar(iniciaisProduto(p.descricao))}</div>`}
          </div>
          <div class="ficha-indicadores">
          <div class="indicador"><div class="rotulo">Preço de venda</div><div class="valor">${dinheiro(p.preco_venda)}</div></div>
          <div class="indicador"><div class="rotulo">Estoque atual</div><div class="valor">${numero(p.estoque)}</div><div class="nota">mínimo ${numero(p.estoque_minimo)}</div></div>
          ${admin ? `
            <div class="indicador"><div class="rotulo">Custo médio</div><div class="valor">${dinheiro(p.custo_medio)}</div><div class="nota">marcação ${percentual(p.marcacao_percentual)}</div></div>
            <div class="indicador"><div class="rotulo">Margem unitária</div><div class="valor ${p.margem_valor > 0 ? 'positivo' : 'negativo'}">${dinheiro(p.margem_valor)}</div><div class="nota">${percentual(p.margem_percentual)} do preço</div></div>
          ` : `
            <div class="indicador"><div class="rotulo">Situação</div><div class="valor">${p.situacao}</div></div>
            <div class="indicador"><div class="rotulo">Última saída</div><div class="valor" style="font-size:19px">${dataHora(p.ultima_saida)}</div></div>
          `}
          </div>
        </div>

        ${admin ? `
          <div class="grade grade-4" style="margin-bottom:20px">
            <div class="cartao"><div class="rotulo">Vendido (histórico)</div><div class="display" style="font-size:21px">${numero(h.total_vendido)} un</div></div>
            <div class="cartao"><div class="rotulo">Faturamento</div><div class="display" style="font-size:21px">${dinheiro(h.faturamento)}</div></div>
            <div class="cartao"><div class="rotulo">Lucro acumulado</div><div class="display positivo" style="font-size:21px">${dinheiro(h.lucro)}</div></div>
            <div class="cartao"><div class="rotulo">Perdas</div><div class="display ${h.total_perdas ? 'negativo' : ''}" style="font-size:21px">${numero(h.total_perdas)} un</div></div>
          </div>
        ` : ''}

        <div class="rotulo" style="margin-bottom:10px">Movimentações do item</div>
        <div class="tabela-caixa" style="max-height:320px;overflow-y:auto">
          ${ficha.movimentos.length ? `
            <table class="tabela">
              <thead><tr><th>Data</th><th>Tipo</th><th class="direita">Qtd</th><th class="direita">Valor</th><th>Detalhe</th><th>Usuário</th></tr></thead>
              <tbody>
                ${ficha.movimentos.map((m) => `
                  <tr>
                    <td class="fraco">${dataHora(m.data)}</td>
                    <td><span class="etiqueta ${m.tipo === 'VENDA' ? 'ok' : m.tipo === 'ENTRADA' ? 'neutra' : m.tipo === 'AJUSTE' ? 'atencao' : 'critico'}">${escapar(m.tipo)}</span></td>
                    <td class="direita num ${m.quantidade < 0 ? 'negativo' : 'positivo'}">${m.quantidade > 0 ? '+' : ''}${numero(m.quantidade)}</td>
                    <td class="direita num">${dinheiro(m.valor)}</td>
                    <td class="fraco">${escapar(m.detalhe || '—')}</td>
                    <td class="fraco">${escapar(m.usuario || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="vazio">Sem movimentações registradas.</div>'}
        </div>
      `,
      rodape: admin ? '<button class="botao botao-brasa" data-acao="editar">Editar cadastro</button>' : '',
    });

    modal.elemento.querySelector('[data-acao="editar"]')?.addEventListener('click', () => {
      modal.fechar();
      abrirFormulario(p);
    });
  }

  /* ------------------------------- cadastro ------------------------------- */

  function abrirFormulario(produto) {
    const novo = !produto;
    const p = produto || {
      codigo: '', descricao: '', codigo_barras: '', categoria: '', unidade: 'UN',
      preco_venda: 0, custo_medio: 0, estoque: 0, estoque_minimo: 3, ativo: true,
    };

    const modal = abrirModal({
      titulo: novo ? 'Novo produto' : `Editar ${p.codigo}`,
      subtitulo: novo ? 'Cadastro rápido de item' : 'Alterações valem para as próximas vendas',
      corpo: `
        <div class="linha-form">
          <div class="campo">
            <label>Código interno *</label>
            <input id="f-codigo" value="${escapar(p.codigo)}" ${novo ? '' : 'readonly'} placeholder="ex.: LINCU">
          </div>
          <div class="campo">
            <label>Código de barras</label>
            <input id="f-barras" value="${escapar(p.codigo_barras)}" placeholder="789...">
          </div>
          <div class="campo inteiro">
            <label>Descrição *</label>
            <input id="f-descricao" value="${escapar(p.descricao)}" placeholder="ex.: LINGUIÇA CUIABANA">
          </div>
          <div class="campo">
            <label>Categoria</label>
            <input id="f-categoria" list="lista-categorias" value="${escapar(p.categoria)}" placeholder="LINGUIÇAS">
            <datalist id="lista-categorias">${dados.categorias.map((c) => `<option value="${escapar(c.nome)}">`).join('')}</datalist>
          </div>
          <div class="campo">
            <label>Unidade</label>
            <input id="f-unidade" value="${escapar(p.unidade)}" placeholder="UN / KG / PC">
          </div>
          <div class="campo">
            <label>Preço de venda (R$) *</label>
            <input id="f-preco" inputmode="decimal" value="${String(p.preco_venda).replace('.', ',')}">
          </div>
          <div class="campo">
            <label>Custo médio (R$)</label>
            <input id="f-custo" inputmode="decimal" value="${String(p.custo_medio).replace('.', ',')}">
          </div>
          <div class="campo">
            <label>Estoque mínimo</label>
            <input id="f-minimo" inputmode="decimal" value="${String(p.estoque_minimo).replace('.', ',')}">
          </div>
          <div class="campo">
            <label>Situação</label>
            <select id="f-ativo">
              <option value="1" ${p.ativo ? 'selected' : ''}>Ativo</option>
              <option value="0" ${p.ativo ? '' : 'selected'}>Inativo</option>
            </select>
          </div>
          <div class="campo inteiro">
            <label>Foto do produto</label>
            <div class="previa-foto">
              <div id="f-previa">${miniatura(p)}</div>
              <div style="flex:1">
                <input id="f-foto" value="${escapar(p.foto || '')}" placeholder="/fotos/CODIGO.jpg">
                <div class="fraco" style="font-size:11.5px;margin-top:6px">
                  Caminho da imagem já preparada. Deixe em branco para usar o monograma do produto.
                </div>
              </div>
            </div>
          </div>
        </div>
        ${novo ? '<p class="fraco" style="font-size:12.5px;margin:14px 0 0">O estoque inicial deve ser lançado pela tela de <b>Estoque → Entradas</b>, para que o custo médio seja calculado corretamente.</p>' : ''}
      `,
      rodape: `
        <button class="botao" data-acao="cancelar">Cancelar</button>
        <button class="botao botao-brasa" data-acao="salvar">Salvar produto</button>
      `,
    });

    const pegar = (id) => modal.elemento.querySelector(id).value.trim();
    const decimal = (id) => Number(pegar(id).replace(/\./g, '').replace(',', '.')) || 0;

    const campoFoto = modal.elemento.querySelector('#f-foto');
    campoFoto.addEventListener('input', () => {
      modal.elemento.querySelector('#f-previa').innerHTML = miniatura({
        descricao: modal.elemento.querySelector('#f-descricao').value,
        foto: campoFoto.value.trim(),
      });
    });

    modal.elemento.querySelector('[data-acao="cancelar"]').addEventListener('click', modal.fechar);
    modal.elemento.querySelector('[data-acao="salvar"]').addEventListener('click', async () => {
      try {
        await api('/api/produtos', {
          metodo: 'POST',
          corpo: {
            codigo: pegar('#f-codigo'),
            descricao: pegar('#f-descricao'),
            codigo_barras: pegar('#f-barras'),
            categoria: pegar('#f-categoria') || 'A CLASSIFICAR',
            unidade: pegar('#f-unidade') || 'UN',
            preco_venda: decimal('#f-preco'),
            custo_medio: decimal('#f-custo'),
            estoque_minimo: decimal('#f-minimo'),
            foto: pegar('#f-foto'),
            ativo: modal.elemento.querySelector('#f-ativo').value === '1',
          },
        });
        modal.fechar();
        await recarregar();
        avisar('Produto salvo.', 'sucesso');
      } catch (erro) {
        avisar(erro.message, 'erro');
      }
    });
  }

  /* -------------------------------- eventos -------------------------------- */

  tela.querySelector('#termo').addEventListener('input', (e) => { filtros.termo = e.target.value; desenharTabela(); });
  tela.querySelector('#categoria').addEventListener('change', (e) => { filtros.categoria = e.target.value; desenharTabela(); });
  tela.querySelector('#situacao').addEventListener('change', (e) => { filtros.situacao = e.target.value; desenharTabela(); });
  tela.querySelector('#novo')?.addEventListener('click', () => abrirFormulario(null));

  desenharResumo();
  desenharTabela();
  setTimeout(() => tela.querySelector('#termo').focus(), 60);
}
