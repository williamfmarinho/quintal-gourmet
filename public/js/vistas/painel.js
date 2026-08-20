/** Painel de controle: indicadores do dia, alertas e ritmo de vendas. */

import { api } from '../api.js';
import {
  html, limpar, dinheiro, numero, percentual, escapar, dataHora,
  graficoLinha, graficoBarras, etiquetaSituacao,
} from '../util.js';

export async function montar(raiz, contexto) {
  const dados = await api('/api/painel');
  const { hoje, ontem, mes, estoque, alertas } = dados;

  const variacao = ontem.faturamento > 0
    ? ((hoje.faturamento - ontem.faturamento) / ontem.faturamento) * 100
    : null;
  const metaAtingida = hoje.meta > 0 ? Math.min(100, (hoje.faturamento / hoje.meta) * 100) : 0;

  limpar(raiz);
  raiz.appendChild(html(`
    <div class="pilha">
      <div class="cabecalho-secao revelar" style="--i:0">
        <div>
          <h2>Bom dia, ${escapar(contexto.sessao.usuario.nome.split('—')[0].trim())}.</h2>
          <p>Resumo do movimento do dia e o que precisa da sua atenção.</p>
        </div>
        <div class="linha">
          <button class="botao botao-brasa" id="ir-pdv">Abrir frente de caixa</button>
        </div>
      </div>

      <div class="grade grade-4 revelar" style="--i:1">
        <div class="indicador">
          <div class="rotulo">Vendas de hoje</div>
          <div class="valor">${dinheiro(hoje.faturamento)}</div>
          <div class="nota">
            ${hoje.vendas} cupom(ns) · ticket ${dinheiro(hoje.ticket_medio)}
          </div>
          ${hoje.meta > 0 ? `
            <div class="medidor"><div style="--largura:${metaAtingida}%"></div></div>
            <div class="nota">${percentual(metaAtingida, 0)} da meta de ${dinheiro(hoje.meta)}</div>
          ` : ''}
        </div>

        <div class="indicador">
          <div class="rotulo">Lucro bruto de hoje</div>
          <div class="valor ${hoje.lucro >= 0 ? 'positivo' : 'negativo'}">${dinheiro(hoje.lucro)}</div>
          <div class="nota">
            margem de ${hoje.faturamento > 0 ? percentual((hoje.lucro / hoje.faturamento) * 100) : '—'}
          </div>
        </div>

        <div class="indicador">
          <div class="rotulo">Comparativo com ontem</div>
          <div class="valor ${variacao === null ? '' : variacao >= 0 ? 'positivo' : 'negativo'}">
            ${variacao === null ? '—' : `${variacao >= 0 ? '▲' : '▼'} ${percentual(Math.abs(variacao), 0)}`}
          </div>
          <div class="nota">ontem: ${dinheiro(ontem.faturamento)} em ${ontem.vendas} venda(s)</div>
        </div>

        <div class="indicador">
          <div class="rotulo">Estoque parado no depósito</div>
          <div class="valor">${dinheiro(estoque.valor_custo)}</div>
          <div class="nota">
            ${estoque.itens} itens · venda potencial ${dinheiro(estoque.valor_venda)}
          </div>
        </div>
      </div>

      <div class="grade grade-2-1 revelar" style="--i:2">
        <div class="cartao">
          <div class="cartao-titulo">
            <h3>Ritmo dos últimos 7 dias</h3>
            <span class="rotulo">
              <span style="color:var(--brasa-viva)">━</span> faturamento
              <span style="color:var(--oliva);margin-left:8px">╍</span> lucro
            </span>
          </div>
          <div id="grafico"></div>
        </div>

        <div class="cartao">
          <div class="cartao-titulo"><h3>Mês corrente</h3></div>
          <div class="pilha" style="gap:14px">
            <div>
              <div class="rotulo">Faturamento</div>
              <div class="display" style="font-size:26px">${dinheiro(mes.faturamento)}</div>
            </div>
            <div>
              <div class="rotulo">Lucro bruto</div>
              <div class="display positivo" style="font-size:26px">${dinheiro(mes.lucro)}</div>
            </div>
            <div>
              <div class="rotulo">Cupons emitidos</div>
              <div class="display" style="font-size:26px">${numero(mes.vendas)}</div>
            </div>
            <div style="border-top:1px dashed var(--borda-forte);padding-top:14px">
              <div class="rotulo" style="margin-bottom:6px">Situação do estoque</div>
              <div class="linha" style="gap:8px;flex-wrap:wrap">
                ${etiquetaSituacao('CRÍTICO')} <span class="num">${estoque.criticos}</span>
                ${etiquetaSituacao('ZERADO')} <span class="num">${estoque.zerados}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grade grade-3 revelar" style="--i:3">
        <div class="cartao">
          <div class="cartao-titulo"><h3>Precisa comprar</h3><span class="rotulo">estoque baixo</span></div>
          <div id="baixo"></div>
        </div>
        <div class="cartao">
          <div class="cartao-titulo"><h3>Campeões de venda</h3><span class="rotulo">30 dias</span></div>
          <div id="campeoes"></div>
        </div>
        <div class="cartao">
          <div class="cartao-titulo"><h3>Parados na prateleira</h3><span class="rotulo">sem saída</span></div>
          <div id="parados"></div>
        </div>
      </div>

      <div class="cartao revelar" style="--i:4">
        <div class="cartao-titulo"><h3>Últimos cupons</h3><span class="rotulo">tempo real</span></div>
        <div class="tabela-caixa" id="ultimas"></div>
      </div>
    </div>
  `));

  raiz.querySelector('#ir-pdv').addEventListener('click', () => contexto.irPara('pdv'));

  raiz.querySelector('#grafico').innerHTML = graficoLinha(dados.serie_7dias, { altura: 232 });

  raiz.querySelector('#baixo').innerHTML = alertas.estoque_baixo.length
    ? `<div class="pilha" style="gap:10px">
        ${alertas.estoque_baixo.map((p) => `
          <div class="linha" style="gap:10px">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapar(p.descricao)}</div>
              <div class="fraco" style="font-size:11.5px">mínimo ${numero(p.estoque_minimo)} · custo ${dinheiro(p.custo_medio)}</div>
            </div>
            <span class="num">${numero(p.estoque)}</span>
            ${etiquetaSituacao(p.situacao)}
          </div>
        `).join('')}
      </div>`
    : '<div class="vazio">Nenhum item abaixo do mínimo. 👏</div>';

  raiz.querySelector('#campeoes').innerHTML = graficoBarras(dados.mais_vendidos, {
    rotulo: (i) => i.descricao,
    valor: (i) => i.quantidade,
    formato: (v) => `${numero(v)} un`,
  });

  raiz.querySelector('#parados').innerHTML = alertas.parados.length
    ? `<div class="pilha" style="gap:10px">
        ${alertas.parados.map((p) => `
          <div class="linha" style="gap:10px">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapar(p.descricao)}</div>
              <div class="fraco" style="font-size:11.5px">${numero(p.estoque)} em estoque · ${dinheiro(p.valor_estoque_custo)} parados</div>
            </div>
            <span class="etiqueta atencao">${p.dias_sem_saida} dias</span>
          </div>
        `).join('')}
      </div>`
    : '<div class="vazio">Tudo girando bem.</div>';

  raiz.querySelector('#ultimas').innerHTML = dados.ultimas_vendas.length
    ? `<table class="tabela">
        <thead><tr><th>Cupom</th><th>Data</th><th>Operador</th><th>Cliente</th><th class="direita">Itens</th><th class="direita">Total</th><th class="direita">Lucro</th></tr></thead>
        <tbody>
          ${dados.ultimas_vendas.map((v) => `
            <tr>
              <td class="mono">${escapar(v.numero)}</td>
              <td class="fraco">${dataHora(v.data)}</td>
              <td>${escapar(v.operador)}</td>
              <td>${escapar(v.cliente || '—')}</td>
              <td class="direita num">${numero(v.itens)}</td>
              <td class="direita num">${dinheiro(v.total)}</td>
              <td class="direita num positivo">${dinheiro(v.lucro)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<div class="vazio">Nenhuma venda registrada ainda.</div>';
}
