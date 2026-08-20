/** Caixa: abertura, sangria, suprimento, fechamento e histórico de turnos. */

import { api } from '../api.js';
import {
  html, limpar, avisar, dinheiro, numero, escapar, dataHora, abrirModal, confirmar,
} from '../util.js';

const decimal = (texto) => Number(String(texto ?? '').replace(/\./g, '').replace(',', '.')) || 0;

export async function montar(raiz, contexto) {
  const admin = contexto.ehAdmin();

  async function desenhar() {
    const { caixa } = await api('/api/caixa');
    contexto.caixa = caixa;

    limpar(raiz);
    raiz.appendChild(caixa ? telaAberto(caixa) : telaFechado());

    if (admin) {
      const historico = await api('/api/caixas');
      raiz.appendChild(html(`
        <div class="cartao" style="margin-top:16px">
          <div class="cartao-titulo"><h3>Turnos anteriores</h3><span class="rotulo">conferência de caixa</span></div>
          <div class="tabela-caixa">
            ${historico.caixas.length ? `
              <table class="tabela">
                <thead><tr><th>#</th><th>Operador</th><th>Abertura</th><th>Fechamento</th><th class="direita">Fundo</th><th class="direita">Vendas</th><th class="direita">Esperado</th><th class="direita">Contado</th><th class="direita">Diferença</th><th class="centro">Status</th></tr></thead>
                <tbody>
                  ${historico.caixas.map((c) => `
                    <tr>
                      <td class="mono">${c.id}</td>
                      <td>${escapar(c.operador)}</td>
                      <td class="fraco">${dataHora(c.aberto_em)}</td>
                      <td class="fraco">${c.fechado_em ? dataHora(c.fechado_em) : '—'}</td>
                      <td class="direita num">${dinheiro(c.valor_abertura)}</td>
                      <td class="direita num">${dinheiro(c.vendas_total)}</td>
                      <td class="direita num">${dinheiro(c.saldo_esperado)}</td>
                      <td class="direita num">${c.status === 'FECHADO' ? dinheiro(c.saldo_informado) : '—'}</td>
                      <td class="direita num ${c.diferenca < 0 ? 'negativo' : c.diferenca > 0 ? 'dourado' : ''}">${c.status === 'FECHADO' ? dinheiro(c.diferenca) : '—'}</td>
                      <td class="centro"><span class="etiqueta ${c.status === 'ABERTO' ? 'ok' : 'neutra'}">${escapar(c.status)}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : '<div class="vazio">Nenhum turno registrado.</div>'}
          </div>
        </div>
      `));
    }

    if (typeof contexto.atualizarCaixa === 'function') contexto.atualizarCaixa();
  }

  function telaFechado() {
    const bloco = html(`
      <div class="cartao" style="text-align:center;padding:60px 30px">
        <div style="font-size:44px;margin-bottom:14px">🔒</div>
        <h2 class="display" style="font-size:26px;margin:0 0 8px">Caixa fechado</h2>
        <p class="fraco" style="max-width:44ch;margin:0 auto 26px;line-height:1.6">
          Abra o caixa informando o fundo de troco para começar a registrar vendas.
          Todo dinheiro que entra e sai do gaveteiro fica registrado no turno.
        </p>
        <div style="max-width:280px;margin:0 auto">
          <div class="campo">
            <label>Fundo de troco (R$)</label>
            <input id="fundo" inputmode="decimal" value="100,00">
          </div>
          <button class="botao botao-brasa botao-largo" id="abrir">Abrir caixa</button>
        </div>
      </div>
    `);

    bloco.querySelector('#abrir').addEventListener('click', async () => {
      try {
        await api('/api/caixa/abrir', {
          metodo: 'POST',
          corpo: { valor_abertura: decimal(bloco.querySelector('#fundo').value) },
        });
        avisar('Caixa aberto.', 'sucesso');
        desenhar();
      } catch (erro) {
        avisar(erro.message, 'erro');
      }
    });
    return bloco;
  }

  function telaAberto(caixa) {
    const formas = Object.entries(caixa.por_forma || {});
    const bloco = html(`
      <div class="pilha">
        <div class="grade grade-4">
          <div class="indicador">
            <div class="rotulo">Turno aberto desde</div>
            <div class="valor" style="font-size:23px">${dataHora(caixa.aberto_em)}</div>
            <div class="nota">operador ${escapar(caixa.operador)}</div>
          </div>
          <div class="indicador">
            <div class="rotulo">Vendas no turno</div>
            <div class="valor">${dinheiro(caixa.total_vendas)}</div>
            <div class="nota">${caixa.quantidade_vendas} cupom(ns) · ticket ${dinheiro(caixa.ticket_medio)}</div>
          </div>
          <div class="indicador">
            <div class="rotulo">Dinheiro esperado na gaveta</div>
            <div class="valor dourado">${dinheiro(caixa.saldo_esperado)}</div>
            <div class="nota">fundo ${dinheiro(caixa.valor_abertura)} + vendas − sangrias</div>
          </div>
          <div class="indicador">
            <div class="rotulo">Lucro do turno</div>
            <div class="valor positivo">${dinheiro(caixa.lucro)}</div>
          </div>
        </div>

        <div class="grade grade-2-1">
          <div class="cartao">
            <div class="cartao-titulo"><h3>Movimentos do turno</h3></div>
            <div class="tabela-caixa" style="max-height:340px;overflow-y:auto">
              ${caixa.movimentos.length ? `
                <table class="tabela">
                  <thead><tr><th>Hora</th><th>Tipo</th><th class="direita">Valor</th><th>Motivo</th></tr></thead>
                  <tbody>
                    ${caixa.movimentos.map((m) => `
                      <tr>
                        <td class="fraco">${dataHora(m.data)}</td>
                        <td><span class="etiqueta ${m.tipo === 'SANGRIA' ? 'critico' : m.tipo === 'VENDA' ? 'ok' : 'neutra'}">${escapar(m.tipo)}</span></td>
                        <td class="direita num ${m.tipo === 'SANGRIA' ? 'negativo' : ''}">${dinheiro(m.valor)}</td>
                        <td class="fraco">${escapar(m.motivo || '—')}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : '<div class="vazio">Nenhum movimento ainda.</div>'}
            </div>
          </div>

          <div class="pilha">
            <div class="cartao">
              <div class="cartao-titulo"><h3>Recebimentos</h3></div>
              ${formas.length ? formas.map(([forma, valor]) => `
                <div class="linha" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--borda)">
                  <span style="font-size:13px">${escapar(forma)}</span>
                  <span class="num">${dinheiro(valor)}</span>
                </div>
              `).join('') : '<div class="vazio" style="padding:20px">Sem recebimentos.</div>'}
            </div>

            <div class="cartao">
              <div class="cartao-titulo"><h3>Ações do caixa</h3></div>
              <div class="pilha" style="gap:9px">
                <button class="botao" id="suprimento">💰 Suprimento (entrada de troco)</button>
                <button class="botao" id="sangria">🏦 Sangria (retirada de dinheiro)</button>
                <button class="botao botao-brasa" id="fechar">🔒 Fechar caixa</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    bloco.querySelector('#suprimento').addEventListener('click', () => movimentar('SUPRIMENTO'));
    bloco.querySelector('#sangria').addEventListener('click', () => movimentar('SANGRIA'));
    bloco.querySelector('#fechar').addEventListener('click', () => fechar(caixa));
    return bloco;
  }

  function movimentar(tipo) {
    const ehSangria = tipo === 'SANGRIA';
    const modal = abrirModal({
      titulo: ehSangria ? 'Sangria de caixa' : 'Suprimento de caixa',
      subtitulo: ehSangria ? 'Retirada de dinheiro do gaveteiro' : 'Entrada de dinheiro para troco',
      largura: 'estreito',
      corpo: `
        <div class="campo"><label>Valor (R$)</label><input id="valor" inputmode="decimal" placeholder="0,00" autofocus></div>
        <div class="campo"><label>Motivo</label><input id="motivo" placeholder="${ehSangria ? 'ex.: depósito no banco' : 'ex.: troco do cofre'}"></div>
      `,
      rodape: '<button class="botao botao-brasa" data-acao="ok">Confirmar</button>',
    });

    modal.elemento.querySelector('[data-acao="ok"]').addEventListener('click', async () => {
      try {
        await api('/api/caixa/movimento', {
          metodo: 'POST',
          corpo: {
            tipo,
            valor: decimal(modal.elemento.querySelector('#valor').value),
            motivo: modal.elemento.querySelector('#motivo').value,
          },
        });
        modal.fechar();
        avisar(`${ehSangria ? 'Sangria' : 'Suprimento'} registrado.`, 'sucesso');
        desenhar();
      } catch (erro) {
        avisar(erro.message, 'erro');
      }
    });
  }

  function fechar(caixa) {
    const modal = abrirModal({
      titulo: 'Fechamento de caixa',
      subtitulo: `Turno #${caixa.id} · ${caixa.quantidade_vendas} venda(s)`,
      corpo: `
        <div class="grade grade-2" style="margin-bottom:18px">
          <div class="indicador"><div class="rotulo">Esperado em dinheiro</div><div class="valor">${dinheiro(caixa.saldo_esperado)}</div>
            <div class="nota">fundo ${dinheiro(caixa.valor_abertura)} · vendas em dinheiro ${dinheiro(caixa.por_forma?.DINHEIRO || 0)}</div>
          </div>
          <div class="indicador"><div class="rotulo">Total vendido no turno</div><div class="valor">${dinheiro(caixa.total_vendas)}</div>
            <div class="nota">sangrias ${dinheiro(caixa.sangrias)} · suprimentos ${dinheiro(caixa.suprimentos)}</div>
          </div>
        </div>
        <div class="linha-form">
          <div class="campo">
            <label>Dinheiro contado na gaveta (R$) *</label>
            <input id="contado" inputmode="decimal" placeholder="0,00" autofocus>
          </div>
          <div class="campo">
            <label>Diferença apurada</label>
            <input id="diferenca" readonly value="—">
          </div>
          <div class="campo inteiro">
            <label>Observação do fechamento</label>
            <input id="obs" placeholder="opcional">
          </div>
        </div>
      `,
      rodape: `
        <button class="botao" data-acao="cancelar">Voltar</button>
        <button class="botao botao-brasa" data-acao="fechar">Fechar caixa</button>
      `,
    });

    const campoContado = modal.elemento.querySelector('#contado');
    const campoDiferenca = modal.elemento.querySelector('#diferenca');
    campoContado.addEventListener('input', () => {
      const diferenca = decimal(campoContado.value) - caixa.saldo_esperado;
      campoDiferenca.value = `${diferenca > 0 ? '+' : ''}${dinheiro(diferenca)}`;
      campoDiferenca.style.color = diferenca < 0 ? 'var(--paprica)' : diferenca > 0 ? 'var(--dourado)' : 'var(--oliva)';
    });

    modal.elemento.querySelector('[data-acao="cancelar"]').addEventListener('click', modal.fechar);
    modal.elemento.querySelector('[data-acao="fechar"]').addEventListener('click', async () => {
      const contado = decimal(campoContado.value);
      const diferenca = contado - caixa.saldo_esperado;
      if (Math.abs(diferenca) > 0.009) {
        const certeza = await confirmar({
          titulo: 'Fechar com diferença?',
          mensagem: `A conferência aponta ${diferenca < 0 ? 'falta' : 'sobra'} de ${dinheiro(Math.abs(diferenca))}. A diferença fica registrada no turno.`,
          textoConfirmar: 'Fechar assim mesmo',
          perigo: diferenca < 0,
        });
        if (!certeza) return;
      }
      try {
        await api('/api/caixa/fechar', {
          metodo: 'POST',
          corpo: { saldo_informado: contado, observacao: modal.elemento.querySelector('#obs').value },
        });
        modal.fechar();
        avisar('Caixa fechado. Bom descanso!', 'sucesso');
        desenhar();
      } catch (erro) {
        avisar(erro.message, 'erro');
      }
    });
  }

  await desenhar();
}
