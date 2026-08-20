/** Análise de resultado: faturamento, CMV, lucro, curva ABC, perdas e mix de vendas. */

import { api } from '../api.js';
import {
  html, limpar, avisar, dinheiro, numero, percentual, escapar, dataHora,
  isoLocal, somarDias, graficoLinha, graficoBarras,
} from '../util.js';

const ATALHOS_PERIODO = [
  { id: 'hoje', rotulo: 'Hoje', calcular: () => ({ de: isoLocal(), ate: isoLocal() }) },
  { id: '7', rotulo: '7 dias', calcular: () => ({ de: isoLocal(somarDias(-6)), ate: isoLocal() }) },
  { id: '30', rotulo: '30 dias', calcular: () => ({ de: isoLocal(somarDias(-29)), ate: isoLocal() }) },
  { id: 'mes', rotulo: 'Mês atual', calcular: () => {
    const agora = new Date();
    return { de: isoLocal(new Date(agora.getFullYear(), agora.getMonth(), 1)), ate: isoLocal() };
  } },
  { id: '90', rotulo: '90 dias', calcular: () => ({ de: isoLocal(somarDias(-89)), ate: isoLocal() }) },
];

export async function montar(raiz) {
  let periodo = ATALHOS_PERIODO[2].calcular();
  let atalhoAtivo = '30';

  limpar(raiz);
  const tela = html(`
    <div class="pilha">
      <div class="cabecalho-secao">
        <div>
          <h2>Lucro no período</h2>
          <p>Do faturamento ao lucro líquido, descontando o custo da mercadoria e as perdas.</p>
        </div>
        <div class="linha" style="flex-wrap:wrap">
          <div class="chips" id="atalhos">
            ${ATALHOS_PERIODO.map((a) => `<button class="chip ${a.id === atalhoAtivo ? 'ativo' : ''}" data-atalho="${a.id}">${a.rotulo}</button>`).join('')}
          </div>
          <div class="campo"><label>De</label><input type="date" id="de" value="${periodo.de}"></div>
          <div class="campo"><label>Até</label><input type="date" id="ate" value="${periodo.ate}"></div>
          <button class="botao botao-mini" id="csv">⤓ CSV</button>
        </div>
      </div>
      <div id="corpo"></div>
    </div>
  `);
  raiz.appendChild(tela);

  const corpo = tela.querySelector('#corpo');
  let relatorio = null;

  async function carregar() {
    corpo.innerHTML = '<div class="carregando"><div class="girando"></div>Calculando resultado...</div>';
    relatorio = await api('/api/relatorios/lucro', { parametros: periodo });
    const r = relatorio.resumo;

    corpo.innerHTML = `
      <div class="grade grade-4 revelar" style="--i:0">
        <div class="indicador">
          <div class="rotulo">Faturamento</div>
          <div class="valor">${dinheiro(r.faturamento)}</div>
          <div class="nota">${numero(r.quantidade_vendas)} cupons · ticket ${dinheiro(r.ticket_medio)}</div>
        </div>
        <div class="indicador">
          <div class="rotulo">Custo da mercadoria (CMV)</div>
          <div class="valor">${dinheiro(r.cmv)}</div>
          <div class="nota">${r.faturamento > 0 ? percentual((r.cmv / r.faturamento) * 100) : '—'} do faturamento</div>
        </div>
        <div class="indicador">
          <div class="rotulo">Lucro bruto</div>
          <div class="valor positivo">${dinheiro(r.lucro_bruto)}</div>
          <div class="nota">margem de ${percentual(r.margem_bruta)}</div>
        </div>
        <div class="indicador">
          <div class="rotulo">Lucro líquido estimado</div>
          <div class="valor ${r.lucro_liquido >= 0 ? 'positivo' : 'negativo'}">${dinheiro(r.lucro_liquido)}</div>
          <div class="nota">após perdas de ${dinheiro(r.custo_perdas)}</div>
        </div>
      </div>

      <div class="grade grade-4 revelar" style="--i:1;margin-top:16px">
        <div class="cartao"><div class="rotulo">Itens vendidos</div><div class="display" style="font-size:24px">${numero(r.itens_vendidos)}</div></div>
        <div class="cartao"><div class="rotulo">Média por dia com venda</div><div class="display" style="font-size:24px">${dinheiro(r.media_diaria)}</div><div class="fraco" style="font-size:11.5px">${r.dias_com_venda} de ${relatorio.periodo.dias} dias</div></div>
        <div class="cartao"><div class="rotulo">Descontos concedidos</div><div class="display" style="font-size:24px">${dinheiro(r.descontos)}</div></div>
        <div class="cartao"><div class="rotulo">Compras (entradas)</div><div class="display" style="font-size:24px">${dinheiro(r.compras)}</div></div>
      </div>

      <div class="cartao revelar" style="--i:2;margin-top:16px">
        <div class="cartao-titulo">
          <h3>Faturamento e lucro por dia</h3>
          <span class="rotulo"><span style="color:var(--brasa-viva)">━</span> faturamento <span style="color:var(--oliva);margin-left:8px">╍</span> lucro</span>
        </div>
        <div id="grafico"></div>
      </div>

      <div class="grade grade-3 revelar" style="--i:3;margin-top:16px">
        <div class="cartao">
          <div class="cartao-titulo"><h3>Por categoria</h3><span class="rotulo">faturamento</span></div>
          <div id="categorias"></div>
        </div>
        <div class="cartao">
          <div class="cartao-titulo"><h3>Formas de pagamento</h3></div>
          <div id="pagamentos"></div>
        </div>
        <div class="cartao">
          <div class="cartao-titulo"><h3>Por operador</h3></div>
          <div id="operadores"></div>
        </div>
      </div>

      <div class="cartao revelar" style="--i:4;margin-top:16px">
        <div class="cartao-titulo">
          <h3>Curva ABC de produtos</h3>
          <span class="rotulo">A = 80% do faturamento · B = até 95% · C = cauda</span>
        </div>
        <div class="tabela-caixa" style="max-height:460px;overflow-y:auto" id="abc"></div>
      </div>

      <div class="cartao revelar" style="--i:5;margin-top:16px">
        <div class="cartao-titulo"><h3>Perdas e desperdício no período</h3><span class="rotulo">custo total ${dinheiro(relatorio.perdas.total_custo)}</span></div>
        <div class="grade grade-2-1">
          <div class="tabela-caixa" style="max-height:320px;overflow-y:auto" id="perdas"></div>
          <div id="perdas-tipo"></div>
        </div>
      </div>
    `;

    corpo.querySelector('#grafico').innerHTML = graficoLinha(relatorio.serie, { altura: 250 });

    corpo.querySelector('#categorias').innerHTML = graficoBarras(relatorio.por_categoria, {
      rotulo: (i) => i.categoria,
      valor: (i) => i.faturamento,
    });

    corpo.querySelector('#pagamentos').innerHTML = graficoBarras(relatorio.por_pagamento, {
      rotulo: (i) => `${i.forma} (${i.quantidade})`,
      valor: (i) => i.valor,
      cor: 'dourada',
    });

    corpo.querySelector('#operadores').innerHTML = graficoBarras(relatorio.por_operador, {
      rotulo: (i) => `${i.operador} · ${i.vendas} venda(s)`,
      valor: (i) => i.faturamento,
      cor: 'oliva',
    });

    corpo.querySelector('#abc').innerHTML = relatorio.abc.length ? `
      <table class="tabela">
        <thead>
          <tr>
            <th class="centro">Classe</th><th>Produto</th>
            <th class="direita">Qtd</th><th class="direita">Faturamento</th>
            <th class="direita">Custo</th><th class="direita">Lucro</th>
            <th class="direita">Margem</th><th class="direita">Participação</th><th class="direita">Acumulado</th>
          </tr>
        </thead>
        <tbody>
          ${relatorio.abc.map((p) => `
            <tr>
              <td class="centro"><span class="etiqueta ${p.classe === 'A' ? 'ok' : p.classe === 'B' ? 'atencao' : 'neutra'}">${p.classe}</span></td>
              <td><b>${escapar(p.codigo)}</b> <span class="fraco">${escapar(p.descricao)}</span></td>
              <td class="direita num">${numero(p.quantidade)}</td>
              <td class="direita num">${dinheiro(p.faturamento)}</td>
              <td class="direita num fraco">${dinheiro(p.custo)}</td>
              <td class="direita num positivo">${dinheiro(p.lucro)}</td>
              <td class="direita num ${p.margem < 15 ? 'negativo' : ''}">${percentual(p.margem)}</td>
              <td class="direita num">${percentual(p.participacao)}</td>
              <td class="direita num fraco">${percentual(p.acumulado)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="vazio">Nenhuma venda no período.</div>';

    corpo.querySelector('#perdas').innerHTML = relatorio.perdas.lancamentos.length ? `
      <table class="tabela">
        <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th class="direita">Qtd</th><th class="direita">Custo</th><th>Motivo</th></tr></thead>
        <tbody>
          ${relatorio.perdas.lancamentos.map((p) => `
            <tr>
              <td class="fraco">${dataHora(p.data)}</td>
              <td><b>${escapar(p.codigo)}</b> <span class="fraco">${escapar(p.descricao)}</span></td>
              <td><span class="etiqueta critico">${escapar(p.tipo)}</span></td>
              <td class="direita num">${numero(p.quantidade)}</td>
              <td class="direita num negativo">${dinheiro(p.custo_total)}</td>
              <td class="fraco">${escapar(p.motivo || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="vazio"><span class="icone">✨</span>Nenhuma perda registrada no período.</div>';

    corpo.querySelector('#perdas-tipo').innerHTML = relatorio.perdas.por_tipo.length
      ? graficoBarras(relatorio.perdas.por_tipo, {
        rotulo: (i) => i.tipo,
        valor: (i) => i.custo,
      })
      : '<div class="vazio">Sem perdas.</div>';
  }

  function baixarCsv() {
    if (!relatorio) return;
    const linhas = [
      ['Relatório de lucro — Quintal Gourmet'],
      ['Período', relatorio.periodo.de, 'a', relatorio.periodo.ate],
      [],
      ['Faturamento', relatorio.resumo.faturamento],
      ['CMV', relatorio.resumo.cmv],
      ['Lucro bruto', relatorio.resumo.lucro_bruto],
      ['Margem bruta (%)', relatorio.resumo.margem_bruta],
      ['Perdas (custo)', relatorio.resumo.custo_perdas],
      ['Lucro líquido estimado', relatorio.resumo.lucro_liquido],
      [],
      ['Classe', 'Código', 'Produto', 'Quantidade', 'Faturamento', 'Custo', 'Lucro', 'Margem %', 'Participação %'],
      ...relatorio.abc.map((p) => [p.classe, p.codigo, p.descricao, p.quantidade, p.faturamento, p.custo, p.lucro, p.margem, p.participacao]),
    ];
    const csv = linhas
      .map((linha) => linha.map((celula) => {
        const texto = String(celula ?? '').replace(/"/g, '""');
        return typeof celula === 'number' ? String(celula).replace('.', ',') : `"${texto}"`;
      }).join(';'))
      .join('\r\n');

    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Lucro ${relatorio.periodo.de} a ${relatorio.periodo.ate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    avisar('CSV gerado na pasta de downloads.', 'sucesso');
  }

  tela.querySelectorAll('[data-atalho]').forEach((chip) => {
    chip.addEventListener('click', () => {
      atalhoAtivo = chip.dataset.atalho;
      periodo = ATALHOS_PERIODO.find((a) => a.id === atalhoAtivo).calcular();
      tela.querySelector('#de').value = periodo.de;
      tela.querySelector('#ate').value = periodo.ate;
      tela.querySelectorAll('[data-atalho]').forEach((c) => c.classList.toggle('ativo', c === chip));
      carregar();
    });
  });

  ['de', 'ate'].forEach((campo) => {
    tela.querySelector(`#${campo}`).addEventListener('change', (evento) => {
      periodo[campo] = evento.target.value;
      atalhoAtivo = '';
      tela.querySelectorAll('[data-atalho]').forEach((c) => c.classList.remove('ativo'));
      carregar();
    });
  });

  tela.querySelector('#csv').addEventListener('click', baixarCsv);

  await carregar();
}
