/** Cupons emitidos: consulta, reimpressão e cancelamento com estorno de estoque. */

import { api } from '../api.js';
import {
  html, limpar, avisar, dinheiro, numero, escapar, dataHora, isoLocal, somarDias,
  abrirModal, confirmar,
} from '../util.js';
import { mostrarCupom } from '../cupom.js';

export async function montar(raiz, contexto) {
  const admin = contexto.ehAdmin();
  const filtros = { de: isoLocal(somarDias(-7)), ate: isoLocal(), termo: '', status: '' };

  limpar(raiz);
  const tela = html(`
    <div class="pilha">
      <div class="cabecalho-secao">
        <div>
          <h2>Cupons emitidos</h2>
          <p>${admin ? 'Todas as vendas do período, de todos os operadores.' : 'Suas vendas no período.'}</p>
        </div>
      </div>

      <div class="cartao">
        <div class="filtros">
          <div class="campo"><label>De</label><input type="date" id="de" value="${filtros.de}"></div>
          <div class="campo"><label>Até</label><input type="date" id="ate" value="${filtros.ate}"></div>
          <div class="campo busca-linha"><label>Buscar</label><input id="termo" placeholder="número do cupom ou cliente"></div>
          <div class="campo">
            <label>Situação</label>
            <select id="status">
              <option value="">Todas</option>
              <option value="CONCLUÍDA">Concluídas</option>
              <option value="CANCELADA">Canceladas</option>
            </select>
          </div>
        </div>
        <div class="grade grade-4" id="resumo" style="margin-bottom:18px"></div>
        <div class="tabela-caixa" id="tabela"></div>
      </div>
    </div>
  `);
  raiz.appendChild(tela);

  async function carregar() {
    tela.querySelector('#tabela').innerHTML = '<div class="carregando"><div class="girando"></div>Buscando cupons...</div>';
    const { vendas } = await api('/api/vendas', { parametros: filtros });

    const validas = vendas.filter((v) => v.status === 'CONCLUÍDA');
    const total = validas.reduce((s, v) => s + v.total, 0);
    const lucro = validas.reduce((s, v) => s + v.lucro, 0);

    tela.querySelector('#resumo').innerHTML = `
      <div class="indicador"><div class="rotulo">Cupons</div><div class="valor">${numero(validas.length)}</div><div class="nota">${vendas.length - validas.length} cancelado(s)</div></div>
      <div class="indicador"><div class="rotulo">Faturamento</div><div class="valor">${dinheiro(total)}</div></div>
      <div class="indicador"><div class="rotulo">Ticket médio</div><div class="valor">${dinheiro(validas.length ? total / validas.length : 0)}</div></div>
      <div class="indicador"><div class="rotulo">Lucro bruto</div><div class="valor ${lucro >= 0 ? 'positivo' : 'negativo'}">${dinheiro(lucro)}</div></div>
    `;

    tela.querySelector('#tabela').innerHTML = vendas.length ? `
      <table class="tabela">
        <thead>
          <tr>
            <th>Cupom</th><th>Data</th><th>Operador</th><th>Cliente</th><th>Pagamento</th>
            <th class="direita">Itens</th><th class="direita">Total</th>
            ${admin ? '<th class="direita">Lucro</th>' : ''}
            <th class="centro">Situação</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${vendas.map((v) => `
            <tr class="clicavel" data-id="${v.id}">
              <td class="mono dourado">${escapar(v.numero)}</td>
              <td class="fraco">${dataHora(v.data)}</td>
              <td>${escapar(v.operador)}</td>
              <td>${escapar(v.cliente || '—')}</td>
              <td class="fraco" style="font-size:12px">${escapar(v.pagamento)}</td>
              <td class="direita num">${numero(v.itens)}</td>
              <td class="direita num">${dinheiro(v.total)}</td>
              ${admin ? `<td class="direita num ${v.lucro >= 0 ? 'positivo' : 'negativo'}">${dinheiro(v.lucro)}</td>` : ''}
              <td class="centro"><span class="etiqueta ${v.status === 'CANCELADA' ? 'zerado' : 'ok'}">${escapar(v.status)}</span></td>
              <td class="direita"><button class="botao botao-mini" data-ver="${v.id}">Ver cupom</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="vazio"><span class="icone">🧾</span>Nenhum cupom encontrado no período.</div>';

    tela.querySelectorAll('[data-ver]').forEach((botao) => {
      botao.addEventListener('click', (evento) => {
        evento.stopPropagation();
        verCupom(botao.dataset.ver);
      });
    });
    tela.querySelectorAll('[data-id]').forEach((linha) => {
      linha.addEventListener('click', () => detalhar(linha.dataset.id));
    });
  }

  async function verCupom(id) {
    const dados = await api(`/api/vendas/${id}`);
    mostrarCupom(dados);
  }

  async function detalhar(id) {
    const dados = await api(`/api/vendas/${id}`);
    const { venda, itens, pagamentos } = dados;

    const modal = abrirModal({
      titulo: `Cupom ${venda.numero}`,
      subtitulo: `${dataHora(venda.data)} · operador ${venda.operador} · ${venda.status}`,
      largura: 'largo',
      corpo: `
        <div class="grade grade-4" style="margin-bottom:18px">
          <div class="indicador"><div class="rotulo">Total</div><div class="valor">${dinheiro(venda.total)}</div></div>
          <div class="indicador"><div class="rotulo">Desconto</div><div class="valor">${dinheiro(venda.desconto)}</div></div>
          ${admin ? `
            <div class="indicador"><div class="rotulo">Custo (CMV)</div><div class="valor">${dinheiro(venda.custo_total)}</div></div>
            <div class="indicador"><div class="rotulo">Lucro</div><div class="valor positivo">${dinheiro(venda.lucro)}</div><div class="nota">${venda.total > 0 ? ((venda.lucro / venda.total) * 100).toFixed(1).replace('.', ',') : '0'}% de margem</div></div>
          ` : `
            <div class="indicador"><div class="rotulo">Itens</div><div class="valor">${numero(venda.itens)}</div></div>
            <div class="indicador"><div class="rotulo">Pagamento</div><div class="valor" style="font-size:17px">${escapar(venda.pagamento)}</div></div>
          `}
        </div>

        <div class="tabela-caixa">
          <table class="tabela">
            <thead><tr><th>#</th><th>Produto</th><th class="direita">Qtd</th><th class="direita">Preço</th><th class="direita">Desconto</th><th class="direita">Total</th>${admin ? '<th class="direita">Lucro</th>' : ''}</tr></thead>
            <tbody>
              ${itens.map((i) => `
                <tr>
                  <td class="fraco">${i.seq}</td>
                  <td><b>${escapar(i.codigo)}</b> <span class="fraco">${escapar(i.descricao)}</span></td>
                  <td class="direita num">${numero(i.quantidade)}</td>
                  <td class="direita num">${dinheiro(i.preco_unitario)}</td>
                  <td class="direita num fraco">${dinheiro(i.desconto)}</td>
                  <td class="direita num">${dinheiro(i.total)}</td>
                  ${admin ? `<td class="direita num positivo">${dinheiro(i.lucro)}</td>` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="rotulo" style="margin:18px 0 8px">Pagamentos</div>
        ${pagamentos.map((p) => `
          <div class="linha" style="justify-content:space-between;padding:8px 12px;border:1px solid var(--borda);border-radius:9px;margin-bottom:6px">
            <span>${escapar(p.forma)}${p.parcelas > 1 ? ` · ${p.parcelas}x` : ''}</span>
            <span class="num">${dinheiro(p.valor)}${p.troco > 0 ? ` <span class="fraco">(troco ${dinheiro(p.troco)})</span>` : ''}</span>
          </div>
        `).join('')}
      `,
      rodape: `
        <button class="botao" data-acao="cupom">🖨 Ver cupom</button>
        ${admin && venda.status !== 'CANCELADA' ? '<button class="botao botao-perigo" data-acao="cancelar">Cancelar venda</button>' : ''}
      `,
    });

    modal.elemento.querySelector('[data-acao="cupom"]').addEventListener('click', () => {
      modal.fechar();
      mostrarCupom(dados);
    });

    modal.elemento.querySelector('[data-acao="cancelar"]')?.addEventListener('click', async () => {
      const certeza = await confirmar({
        titulo: `Cancelar o cupom ${venda.numero}?`,
        mensagem: 'Os itens voltam para o estoque como ajuste de estorno e a venda deixa de contar nos relatórios.',
        textoConfirmar: 'Cancelar venda',
        perigo: true,
      });
      if (!certeza) return;
      try {
        await api(`/api/vendas/${venda.id}/cancelar`, { metodo: 'POST', corpo: { motivo: 'Cancelamento pelo administrador' } });
        modal.fechar();
        avisar('Venda cancelada e estoque estornado.', 'sucesso');
        carregar();
      } catch (erro) {
        avisar(erro.message, 'erro');
      }
    });
  }

  ['de', 'ate', 'termo', 'status'].forEach((campo) => {
    const elemento = tela.querySelector(`#${campo}`);
    elemento.addEventListener(campo === 'termo' ? 'input' : 'change', () => {
      filtros[campo] = elemento.value;
      carregar();
    });
  });

  await carregar();
}
