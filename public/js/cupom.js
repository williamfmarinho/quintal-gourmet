/** Montagem e impressão da "notinha" do cliente (cupom não fiscal). */

import { abrirModal, dinheiro, numero, escapar } from './util.js';

export function montarCupom({ venda, itens, pagamentos, troco = 0, loja = {}, operador_nome }) {
  const data = new Date(venda.data);
  const linhas = itens.map((item) => `
    <tr>
      <td colspan="3" class="item-nome">${escapar(item.descricao)}</td>
    </tr>
    <tr>
      <td style="width:52%">${escapar(item.codigo)}</td>
      <td style="width:26%">${numero(item.quantidade)} x ${dinheiro(item.preco_unitario).replace('R$', '').trim()}</td>
      <td style="width:22%;text-align:right">${dinheiro(item.total).replace('R$', '').trim()}</td>
    </tr>
    ${item.desconto > 0 ? `<tr><td colspan="3" style="text-align:right;font-size:10px">desconto -${dinheiro(item.desconto)}</td></tr>` : ''}
  `).join('');

  // No dinheiro imprime-se o valor entregue pelo cliente; o troco aparece logo abaixo.
  const formas = pagamentos.map((p) => `
    <tr>
      <td>${escapar(p.forma)}${p.parcelas > 1 ? ` ${p.parcelas}x` : ''}</td>
      <td style="text-align:right">${dinheiro(p.forma === 'DINHEIRO' ? (p.recebido || p.valor) : p.valor).replace('R$', '').trim()}</td>
    </tr>
  `).join('');

  return `
    <div class="cupom">
      <h3>${escapar(loja.nome || 'QUINTAL GOURMET')}</h3>
      <div class="centro-cupom">
        ${escapar(loja.slogan || '')}<br>
        ${escapar(loja.endereco || '')}<br>
        ${escapar(loja.documento || '')} · ${escapar(loja.telefone || '')}
      </div>

      <div class="separador"></div>
      <div class="centro-cupom"><b>CUPOM NÃO FISCAL — SIMULAÇÃO</b></div>
      <div class="separador"></div>

      <table>
        <tr><td>Cupom</td><td style="text-align:right"><b>${escapar(venda.numero)}</b></td></tr>
        <tr><td>Data</td><td style="text-align:right">${data.toLocaleDateString('pt-BR')} ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td></tr>
        <tr><td>Operador</td><td style="text-align:right">${escapar((operador_nome || venda.operador).split('—')[0].trim())}</td></tr>
        ${venda.cliente ? `<tr><td>Cliente</td><td style="text-align:right">${escapar(venda.cliente)}</td></tr>` : ''}
      </table>

      <div class="separador"></div>
      <table>${linhas}</table>
      <div class="separador"></div>

      <table>
        <tr><td>Itens</td><td style="text-align:right">${numero(venda.itens)}</td></tr>
        <tr><td>Subtotal</td><td style="text-align:right">${dinheiro(venda.subtotal)}</td></tr>
        ${venda.desconto > 0 ? `<tr><td>Desconto</td><td style="text-align:right">- ${dinheiro(venda.desconto)}</td></tr>` : ''}
      </table>

      <div class="destaque-total"><span>TOTAL</span><span>${dinheiro(venda.total)}</span></div>

      <table>${formas}</table>
      ${troco > 0 ? `<div class="destaque-total" style="font-size:13px"><span>TROCO</span><span>${dinheiro(troco)}</span></div>` : ''}

      ${venda.status === 'CANCELADA' ? '<div class="separador"></div><div class="centro-cupom"><b>*** CUPOM CANCELADO ***</b></div>' : ''}

      <div class="separador"></div>
      <div class="rodape-cupom">
        ${escapar(loja.rodape || 'Obrigado pela preferência!')}<br>
        Documento sem valor fiscal · gerado pelo sistema local
      </div>
      <div class="codigo-barras"></div>
      <div class="centro-cupom" style="margin-top:6px;letter-spacing:.18em">${escapar(venda.numero)}</div>
    </div>
  `;
}

export function mostrarCupom(dados, { aoFechar } = {}) {
  const modal = abrirModal({
    titulo: 'Cupom do cliente',
    subtitulo: `${dados.venda.numero} · ${dinheiro(dados.venda.total)}`,
    largura: 'estreito',
    corpo: montarCupom(dados),
    rodape: `
      <button class="botao" data-acao="fechar">Fechar (Esc)</button>
      <button class="botao botao-brasa" data-acao="imprimir">🖨 Imprimir cupom</button>
    `,
    aoFechar,
  });

  modal.elemento.querySelector('[data-acao="fechar"]').addEventListener('click', modal.fechar);
  modal.elemento.querySelector('[data-acao="imprimir"]').addEventListener('click', () => window.print());
  return modal;
}
