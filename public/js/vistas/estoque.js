/** Movimentação de estoque: entradas de mercadoria, ajustes de inventário e perdas. */

import { api } from '../api.js';
import {
  html, limpar, avisar, dinheiro, numero, escapar, dataHora, isoLocal, somarDias,
} from '../util.js';

const ABAS = [
  { id: 'entradas', titulo: 'Entradas de mercadoria' },
  { id: 'ajustes', titulo: 'Ajustes de inventário' },
  { id: 'perdas', titulo: 'Perdas e desperdício' },
];

const decimal = (texto) => Number(String(texto ?? '').replace(/\./g, '').replace(',', '.')) || 0;

export async function montar(raiz, contexto) {
  const catalogo = await api('/api/produtos');
  const produtos = catalogo.produtos;
  const opcoesProdutos = produtos
    .map((p) => `<option value="${escapar(p.codigo)}">${escapar(p.codigo)} — ${escapar(p.descricao)}</option>`)
    .join('');

  let abaAtiva = 'entradas';
  const periodo = { de: isoLocal(somarDias(-30)), ate: isoLocal() };

  limpar(raiz);
  const tela = html(`
    <div class="pilha">
      <div class="cabecalho-secao">
        <div>
          <h2>Movimentação de estoque</h2>
          <p>Tudo que entra, tudo que sai fora da venda e as correções de inventário.</p>
        </div>
        <div class="linha">
          <div class="campo"><label>De</label><input type="date" id="de" value="${periodo.de}"></div>
          <div class="campo"><label>Até</label><input type="date" id="ate" value="${periodo.ate}"></div>
        </div>
      </div>

      <div class="aba-linha" id="abas">
        ${ABAS.map((a) => `<button class="aba ${a.id === abaAtiva ? 'ativa' : ''}" data-aba="${a.id}">${a.titulo}</button>`).join('')}
      </div>

      <div id="painel-aba"></div>
    </div>
  `);
  raiz.appendChild(tela);

  const painel = tela.querySelector('#painel-aba');

  /* ------------------------------- entradas ------------------------------- */

  async function abaEntradas() {
    const { entradas } = await api('/api/entradas', { parametros: periodo });
    const total = entradas.reduce((s, e) => s + e.valor_total, 0);

    painel.innerHTML = `
      <div class="grade grade-2-1">
        <div class="cartao">
          <div class="cartao-titulo"><h3>Lançar entrada</h3><span class="rotulo">recalcula o custo médio</span></div>
          <div class="linha-form">
            <div class="campo inteiro">
              <label>Produto *</label>
              <select id="e-produto">${opcoesProdutos}</select>
            </div>
            <div class="campo">
              <label>Quantidade *</label>
              <input id="e-qtd" inputmode="decimal" placeholder="0">
            </div>
            <div class="campo">
              <label>Custo unitário (R$) *</label>
              <input id="e-custo" inputmode="decimal" placeholder="0,00">
            </div>
            <div class="campo">
              <label>Fornecedor</label>
              <input id="e-fornecedor" placeholder="ex.: FRIGORÍFICO SÃO JOÃO">
            </div>
            <div class="campo">
              <label>Documento / NF</label>
              <input id="e-doc" placeholder="ex.: NF 12345">
            </div>
            <div class="campo inteiro">
              <label>Observação</label>
              <input id="e-obs" placeholder="opcional">
            </div>
          </div>

          <div class="painel-troco" style="margin-top:6px">
            <div class="bloco">
              <div class="rotulo">Custo médio atual</div>
              <div class="valor num" id="e-cmed">—</div>
            </div>
            <div class="bloco" style="text-align:right">
              <div class="rotulo">Novo custo médio</div>
              <div class="valor num dourado" id="e-novo">—</div>
            </div>
          </div>

          <div class="linha" style="margin-top:16px;justify-content:flex-end">
            <button class="botao botao-brasa" id="e-salvar">Registrar entrada</button>
          </div>
        </div>

        <div class="cartao">
          <div class="cartao-titulo"><h3>No período</h3></div>
          <div class="rotulo">Total comprado</div>
          <div class="display" style="font-size:30px;margin-bottom:16px">${dinheiro(total)}</div>
          <div class="rotulo">Lançamentos</div>
          <div class="display" style="font-size:30px">${numero(entradas.length)}</div>
          <p class="fraco" style="font-size:12.5px;margin-top:18px;line-height:1.6">
            O custo médio é recalculado pela média ponderada entre o que já estava em estoque e a nova compra.
          </p>
        </div>
      </div>

      <div class="cartao" style="margin-top:16px">
        <div class="cartao-titulo"><h3>Entradas registradas</h3></div>
        <div class="tabela-caixa">
          ${entradas.length ? `
            <table class="tabela">
              <thead><tr><th>Data</th><th>Produto</th><th>Fornecedor</th><th>Doc.</th><th class="direita">Qtd</th><th class="direita">Custo un.</th><th class="direita">Total</th><th class="direita">Custo médio</th><th>Usuário</th></tr></thead>
              <tbody>
                ${entradas.map((e) => `
                  <tr>
                    <td class="fraco">${dataHora(e.data)}</td>
                    <td><b>${escapar(e.codigo)}</b> <span class="fraco">${escapar(e.descricao)}</span></td>
                    <td class="fraco">${escapar(e.fornecedor || '—')}</td>
                    <td class="mono fraco">${escapar(e.documento || '—')}</td>
                    <td class="direita num">${numero(e.quantidade)}</td>
                    <td class="direita num">${dinheiro(e.custo_unitario)}</td>
                    <td class="direita num">${dinheiro(e.valor_total)}</td>
                    <td class="direita num fraco">${dinheiro(e.custo_medio_anterior)} → ${dinheiro(e.custo_medio_novo)}</td>
                    <td class="fraco">${escapar(e.usuario)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="vazio"><span class="icone">📦</span>Nenhuma entrada no período.</div>'}
        </div>
      </div>
    `;

    const seletor = painel.querySelector('#e-produto');
    const campoQtd = painel.querySelector('#e-qtd');
    const campoCusto = painel.querySelector('#e-custo');

    function previsao() {
      const produto = produtos.find((p) => p.codigo === seletor.value);
      if (!produto) return;
      painel.querySelector('#e-cmed').textContent = dinheiro(produto.custo_medio);
      const qtd = decimal(campoQtd.value);
      const custo = decimal(campoCusto.value);
      const estoque = Math.max(0, produto.estoque);
      const novo = estoque + qtd > 0
        ? (estoque * produto.custo_medio + qtd * custo) / (estoque + qtd)
        : custo;
      painel.querySelector('#e-novo').textContent = qtd > 0 ? dinheiro(novo) : '—';
    }

    [seletor, campoQtd, campoCusto].forEach((campo) => campo.addEventListener('input', previsao));
    seletor.addEventListener('change', () => {
      const produto = produtos.find((p) => p.codigo === seletor.value);
      if (produto && !campoCusto.value) campoCusto.value = String(produto.custo_medio).replace('.', ',');
      previsao();
    });
    previsao();

    painel.querySelector('#e-salvar').addEventListener('click', async (evento) => {
      const botao = evento.currentTarget;
      botao.disabled = true;
      try {
        await api('/api/entradas', {
          metodo: 'POST',
          corpo: {
            codigo: seletor.value,
            quantidade: decimal(campoQtd.value),
            custo_unitario: decimal(campoCusto.value),
            fornecedor: painel.querySelector('#e-fornecedor').value,
            documento: painel.querySelector('#e-doc').value,
            observacao: painel.querySelector('#e-obs').value,
          },
        });
        avisar('Entrada registrada e custo médio atualizado.', 'sucesso');
        await recarregarCatalogo();
        desenharAba();
      } catch (erro) {
        avisar(erro.message, 'erro');
        botao.disabled = false;
      }
    });
  }

  /* -------------------------------- ajustes -------------------------------- */

  async function abaAjustes() {
    const { ajustes, motivos } = await api('/api/ajustes', { parametros: periodo });
    const impacto = ajustes.reduce((s, a) => s + a.impacto_custo, 0);

    painel.innerHTML = `
      <div class="grade grade-2-1">
        <div class="cartao">
          <div class="cartao-titulo"><h3>Ajustar estoque</h3><span class="rotulo">contagem física</span></div>
          <div class="linha-form">
            <div class="campo inteiro">
              <label>Produto *</label>
              <select id="a-produto">${opcoesProdutos}</select>
            </div>
            <div class="campo">
              <label>Estoque no sistema</label>
              <input id="a-sistema" readonly>
            </div>
            <div class="campo">
              <label>Quantidade contada *</label>
              <input id="a-contado" inputmode="decimal" placeholder="0">
            </div>
            <div class="campo">
              <label>Motivo *</label>
              <select id="a-motivo">${motivos.map((m) => `<option>${escapar(m)}</option>`).join('')}</select>
            </div>
            <div class="campo">
              <label>Observação</label>
              <input id="a-obs" placeholder="quem contou, o que aconteceu...">
            </div>
          </div>

          <div class="painel-troco" style="margin-top:6px">
            <div class="bloco">
              <div class="rotulo">Diferença apurada</div>
              <div class="valor num" id="a-diferenca">—</div>
            </div>
            <div class="bloco" style="text-align:right">
              <div class="rotulo">Impacto em custo</div>
              <div class="valor num" id="a-impacto">—</div>
            </div>
          </div>

          <div class="linha" style="margin-top:16px;justify-content:flex-end">
            <button class="botao botao-brasa" id="a-salvar">Confirmar ajuste</button>
          </div>
        </div>

        <div class="cartao">
          <div class="cartao-titulo"><h3>No período</h3></div>
          <div class="rotulo">Impacto acumulado</div>
          <div class="display ${impacto < 0 ? 'negativo' : 'positivo'}" style="font-size:30px;margin-bottom:16px">${dinheiro(impacto)}</div>
          <div class="rotulo">Ajustes lançados</div>
          <div class="display" style="font-size:30px">${numero(ajustes.length)}</div>
          <p class="fraco" style="font-size:12.5px;margin-top:18px;line-height:1.6">
            Ajuste é para corrigir divergência de contagem. Produto estragado ou consumido deve ser lançado na aba de perdas.
          </p>
        </div>
      </div>

      <div class="cartao" style="margin-top:16px">
        <div class="cartao-titulo"><h3>Ajustes registrados</h3></div>
        <div class="tabela-caixa">
          ${ajustes.length ? `
            <table class="tabela">
              <thead><tr><th>Data</th><th>Produto</th><th class="direita">Ajuste</th><th class="direita">De → Para</th><th>Motivo</th><th class="direita">Impacto</th><th>Usuário</th><th>Observação</th></tr></thead>
              <tbody>
                ${ajustes.map((a) => `
                  <tr>
                    <td class="fraco">${dataHora(a.data)}</td>
                    <td><b>${escapar(a.codigo)}</b> <span class="fraco">${escapar(a.descricao)}</span></td>
                    <td class="direita num ${a.quantidade < 0 ? 'negativo' : 'positivo'}">${a.quantidade > 0 ? '+' : ''}${numero(a.quantidade)}</td>
                    <td class="direita num fraco">${numero(a.estoque_anterior)} → ${numero(a.estoque_novo)}</td>
                    <td>${escapar(a.motivo)}</td>
                    <td class="direita num ${a.impacto_custo < 0 ? 'negativo' : ''}">${dinheiro(a.impacto_custo)}</td>
                    <td class="fraco">${escapar(a.usuario)}</td>
                    <td class="fraco">${escapar(a.observacao || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="vazio"><span class="icone">📋</span>Nenhum ajuste no período.</div>'}
        </div>
      </div>
    `;

    const seletor = painel.querySelector('#a-produto');
    const campoContado = painel.querySelector('#a-contado');

    function atualizar() {
      const produto = produtos.find((p) => p.codigo === seletor.value);
      if (!produto) return;
      painel.querySelector('#a-sistema').value = numero(produto.estoque);
      if (campoContado.value === '') {
        painel.querySelector('#a-diferenca').textContent = '—';
        painel.querySelector('#a-impacto').textContent = '—';
        return;
      }
      const diferenca = decimal(campoContado.value) - produto.estoque;
      const elementoDiferenca = painel.querySelector('#a-diferenca');
      elementoDiferenca.textContent = `${diferenca > 0 ? '+' : ''}${numero(diferenca)}`;
      elementoDiferenca.className = `valor num ${diferenca < 0 ? 'negativo' : 'positivo'}`;
      const impactoValor = diferenca * produto.custo_medio;
      const elementoImpacto = painel.querySelector('#a-impacto');
      elementoImpacto.textContent = dinheiro(impactoValor);
      elementoImpacto.className = `valor num ${impactoValor < 0 ? 'negativo' : 'positivo'}`;
    }

    seletor.addEventListener('change', atualizar);
    campoContado.addEventListener('input', atualizar);
    atualizar();

    painel.querySelector('#a-salvar').addEventListener('click', async (evento) => {
      const botao = evento.currentTarget;
      botao.disabled = true;
      try {
        await api('/api/ajustes', {
          metodo: 'POST',
          corpo: {
            codigo: seletor.value,
            modo: 'CONTAGEM',
            estoque_contado: decimal(campoContado.value),
            motivo: painel.querySelector('#a-motivo').value,
            observacao: painel.querySelector('#a-obs').value,
          },
        });
        avisar('Ajuste aplicado ao estoque.', 'sucesso');
        await recarregarCatalogo();
        desenharAba();
      } catch (erro) {
        avisar(erro.message, 'erro');
        botao.disabled = false;
      }
    });
  }

  /* --------------------------------- perdas --------------------------------- */

  async function abaPerdas() {
    const { saidas, tipos } = await api('/api/saidas', { parametros: { ...periodo, tipo: 'NAO_VENDA' } });
    const custo = saidas.reduce((s, p) => s + p.custo_total, 0);

    const porTipo = {};
    saidas.forEach((s) => { porTipo[s.tipo] = (porTipo[s.tipo] || 0) + s.custo_total; });

    painel.innerHTML = `
      <div class="grade grade-2-1">
        <div class="cartao">
          <div class="cartao-titulo"><h3>Lançar saída sem venda</h3><span class="rotulo">perda, quebra, consumo</span></div>
          <div class="linha-form">
            <div class="campo inteiro">
              <label>Produto *</label>
              <select id="p-produto">${opcoesProdutos}</select>
            </div>
            <div class="campo">
              <label>Tipo de saída *</label>
              <select id="p-tipo">
                ${Object.entries(tipos).filter(([chave]) => chave !== 'VENDA')
                  .map(([chave, rotulo]) => `<option value="${chave}">${escapar(rotulo)}</option>`).join('')}
              </select>
            </div>
            <div class="campo">
              <label>Quantidade *</label>
              <input id="p-qtd" inputmode="decimal" placeholder="0">
            </div>
            <div class="campo inteiro">
              <label>Motivo / detalhe</label>
              <input id="p-motivo" placeholder="ex.: produto vencido na geladeira 2">
            </div>
          </div>

          <div class="painel-troco" style="margin-top:6px">
            <div class="bloco">
              <div class="rotulo">Estoque disponível</div>
              <div class="valor num" id="p-estoque">—</div>
            </div>
            <div class="bloco" style="text-align:right">
              <div class="rotulo">Prejuízo estimado</div>
              <div class="valor num negativo" id="p-prejuizo">—</div>
            </div>
          </div>

          <div class="linha" style="margin-top:16px;justify-content:flex-end">
            <button class="botao botao-perigo" id="p-salvar">Registrar baixa</button>
          </div>
        </div>

        <div class="cartao">
          <div class="cartao-titulo"><h3>Perdas no período</h3></div>
          <div class="rotulo">Custo perdido</div>
          <div class="display negativo" style="font-size:30px;margin-bottom:18px">${dinheiro(custo)}</div>
          ${Object.keys(porTipo).length ? Object.entries(porTipo).map(([tipo, valor]) => `
            <div class="linha" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--borda)">
              <span style="font-size:13px">${escapar(tipos[tipo] || tipo)}</span>
              <span class="num negativo">${dinheiro(valor)}</span>
            </div>
          `).join('') : '<p class="fraco" style="font-size:13px">Nenhuma perda registrada — ótimo sinal.</p>'}
        </div>
      </div>

      <div class="cartao" style="margin-top:16px">
        <div class="cartao-titulo"><h3>Saídas sem venda</h3></div>
        <div class="tabela-caixa">
          ${saidas.length ? `
            <table class="tabela">
              <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th class="direita">Qtd</th><th class="direita">Custo perdido</th><th>Motivo</th><th>Usuário</th></tr></thead>
              <tbody>
                ${saidas.map((s) => `
                  <tr>
                    <td class="fraco">${dataHora(s.data)}</td>
                    <td><b>${escapar(s.codigo)}</b> <span class="fraco">${escapar(s.descricao)}</span></td>
                    <td><span class="etiqueta critico">${escapar(tipos[s.tipo] || s.tipo)}</span></td>
                    <td class="direita num">${numero(s.quantidade)}</td>
                    <td class="direita num negativo">${dinheiro(s.custo_total)}</td>
                    <td class="fraco">${escapar(s.motivo || '—')}</td>
                    <td class="fraco">${escapar(s.usuario)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="vazio"><span class="icone">✨</span>Nenhuma perda lançada no período.</div>'}
        </div>
      </div>
    `;

    const seletor = painel.querySelector('#p-produto');
    const campoQtd = painel.querySelector('#p-qtd');

    function atualizar() {
      const produto = produtos.find((p) => p.codigo === seletor.value);
      if (!produto) return;
      painel.querySelector('#p-estoque').textContent = numero(produto.estoque);
      const qtd = decimal(campoQtd.value);
      painel.querySelector('#p-prejuizo').textContent = qtd > 0 ? dinheiro(qtd * produto.custo_medio) : '—';
    }
    seletor.addEventListener('change', atualizar);
    campoQtd.addEventListener('input', atualizar);
    atualizar();

    painel.querySelector('#p-salvar').addEventListener('click', async (evento) => {
      const botao = evento.currentTarget;
      botao.disabled = true;
      try {
        await api('/api/saidas', {
          metodo: 'POST',
          corpo: {
            codigo: seletor.value,
            tipo: painel.querySelector('#p-tipo').value,
            quantidade: decimal(campoQtd.value),
            motivo: painel.querySelector('#p-motivo').value,
          },
        });
        avisar('Baixa registrada no estoque.', 'sucesso');
        await recarregarCatalogo();
        desenharAba();
      } catch (erro) {
        avisar(erro.message, 'erro');
        botao.disabled = false;
      }
    });
  }

  /* -------------------------------- controle -------------------------------- */

  async function recarregarCatalogo() {
    const novo = await api('/api/produtos');
    produtos.length = 0;
    novo.produtos.forEach((p) => produtos.push(p));
  }

  async function desenharAba() {
    painel.innerHTML = '<div class="carregando"><div class="girando"></div>Carregando...</div>';
    if (abaAtiva === 'entradas') await abaEntradas();
    else if (abaAtiva === 'ajustes') await abaAjustes();
    else await abaPerdas();
  }

  tela.querySelectorAll('[data-aba]').forEach((botao) => {
    botao.addEventListener('click', () => {
      abaAtiva = botao.dataset.aba;
      tela.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('ativa', b === botao));
      desenharAba();
    });
  });

  tela.querySelector('#de').addEventListener('change', (e) => { periodo.de = e.target.value; desenharAba(); });
  tela.querySelector('#ate').addEventListener('change', (e) => { periodo.ate = e.target.value; desenharAba(); });

  await desenharAba();
}
