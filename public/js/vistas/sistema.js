/** Administração: usuários, dados da loja, parâmetros e backup da base Excel. */

import { api, lerSessao } from '../api.js';
import {
  html, limpar, avisar, escapar, dataHora, abrirModal,
} from '../util.js';

const CAMPOS_LOJA = [
  { chave: 'loja_nome', rotulo: 'Nome da loja' },
  { chave: 'loja_slogan', rotulo: 'Slogan' },
  { chave: 'loja_documento', rotulo: 'CNPJ / documento' },
  { chave: 'loja_endereco', rotulo: 'Endereço' },
  { chave: 'loja_telefone', rotulo: 'Telefone' },
  { chave: 'cupom_rodape', rotulo: 'Mensagem no rodapé do cupom' },
];

const CAMPOS_OPERACAO = [
  { chave: 'meta_diaria', rotulo: 'Meta diária de faturamento (R$)' },
  { chave: 'alerta_dias_sem_movimento', rotulo: 'Dias sem venda para alertar item parado' },
  { chave: 'margem_alvo', rotulo: 'Margem alvo (%)' },
  { chave: 'exigir_caixa_aberto', rotulo: 'Exigir caixa aberto para vender (SIM / NÃO)' },
  { chave: 'permitir_estoque_negativo', rotulo: 'Permitir estoque negativo (SIM / NÃO)' },
];

export async function montar(raiz) {
  const [dadosConfig, dadosUsuarios] = await Promise.all([
    api('/api/config'),
    api('/api/usuarios'),
  ]);

  const config = {};
  dadosConfig.config.forEach((linha) => { config[linha.chave] = linha.valor; });

  limpar(raiz);
  const tela = html(`
    <div class="pilha">
      <div class="cabecalho-secao">
        <div>
          <h2>Sistema</h2>
          <p>Quem acessa, como o cupom sai impresso e onde ficam os dados.</p>
        </div>
      </div>

      <div class="grade grade-2">
        <div class="cartao">
          <div class="cartao-titulo"><h3>Dados da loja</h3><span class="rotulo">saem no cupom</span></div>
          <div class="pilha" style="gap:12px">
            ${CAMPOS_LOJA.map((c) => `
              <div class="campo" style="margin:0">
                <label>${c.rotulo}</label>
                <input data-config="${c.chave}" value="${escapar(config[c.chave] || '')}">
              </div>
            `).join('')}
          </div>
        </div>

        <div class="cartao">
          <div class="cartao-titulo"><h3>Parâmetros de operação</h3></div>
          <div class="pilha" style="gap:12px">
            ${CAMPOS_OPERACAO.map((c) => `
              <div class="campo" style="margin:0">
                <label>${c.rotulo}</label>
                <input data-config="${c.chave}" value="${escapar(config[c.chave] || '')}">
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="linha" style="justify-content:flex-end">
        <button class="botao botao-brasa" id="salvar-config">Salvar configurações</button>
      </div>

      <div class="cartao">
        <div class="cartao-titulo">
          <h3>Usuários do sistema</h3>
          <button class="botao botao-mini" id="novo-usuario">+ Novo usuário</button>
        </div>
        <div class="tabela-caixa">
          <table class="tabela">
            <thead><tr><th>Login</th><th>Nome</th><th>Perfil</th><th class="centro">Ativo</th><th>Criado em</th><th>Último acesso</th><th></th></tr></thead>
            <tbody id="linhas-usuarios"></tbody>
          </table>
        </div>
      </div>

      <div class="grade grade-2">
        <div class="cartao">
          <div class="cartao-titulo">
            <h3>Base de dados</h3>
            <span class="rotulo">${dadosConfig.armazenamento === 'postgres' ? 'Postgres · Supabase' : 'arquivo Excel'}</span>
          </div>
          <p class="fraco" style="font-size:13px;line-height:1.7;margin-top:0">
            ${dadosConfig.armazenamento === 'postgres'
              ? 'Esta instalação grava no <b>Postgres do Supabase</b>, com uma tabela por assunto (produtos, entradas, saídas, ajustes, vendas, itens, pagamentos, caixas, usuários e configurações). O download abaixo gera uma planilha com tudo o que está no banco.'
              : 'Todo o sistema grava em <b>dados/Base PDV - Quintal Gourmet.xlsx</b>, com uma aba por assunto (produtos, entradas, saídas, ajustes, vendas, itens, pagamentos, caixas, usuários e configurações). A planilha original de controle continua intacta, ela só foi usada como ponto de partida.'}
          </p>
          <button class="botao botao-brasa" id="baixar">⤓ Baixar cópia em Excel</button>
        </div>

        <div class="cartao">
          <div class="cartao-titulo"><h3>Atalhos de teclado</h3></div>
          <div class="pilha" style="gap:8px;font-size:13px">
            ${[
              ['Alt + 1 a 8', 'trocar de tela'],
              ['F2', 'focar a busca de produtos no PDV'],
              ['F4', 'abrir o pagamento da venda'],
              ['F6', 'aplicar desconto'],
              ['F7', 'identificar o cliente'],
              ['3*CÓDIGO + Enter', 'lançar 3 unidades de uma vez'],
              ['Esc', 'fechar a janela aberta'],
            ].map(([tecla, acao]) => `
              <div class="linha" style="justify-content:space-between;border-bottom:1px solid var(--borda);padding-bottom:7px">
                <code class="mono dourado">${tecla}</code><span class="fraco">${acao}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `);
  raiz.appendChild(tela);

  function desenharUsuarios(lista) {
    tela.querySelector('#linhas-usuarios').innerHTML = lista.map((u) => `
      <tr>
        <td class="mono dourado">${escapar(u.usuario)}</td>
        <td>${escapar(u.nome)}</td>
        <td><span class="etiqueta ${u.perfil === 'admin' ? 'critico' : 'neutra'}">${u.perfil === 'admin' ? 'Administrador' : 'Operador'}</span></td>
        <td class="centro">${u.ativo ? '<span class="etiqueta ok">sim</span>' : '<span class="etiqueta zerado">não</span>'}</td>
        <td class="fraco">${dataHora(u.criado_em)}</td>
        <td class="fraco">${dataHora(u.ultimo_acesso)}</td>
        <td class="direita"><button class="botao botao-mini" data-editar="${escapar(u.usuario)}">Editar</button></td>
      </tr>
    `).join('');

    tela.querySelectorAll('[data-editar]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const usuario = lista.find((u) => u.usuario === botao.dataset.editar);
        formularioUsuario(usuario);
      });
    });
  }

  function formularioUsuario(usuario) {
    const novo = !usuario;
    const modal = abrirModal({
      titulo: novo ? 'Novo usuário' : `Editar ${usuario.usuario}`,
      subtitulo: novo ? 'Defina o perfil de acesso' : 'Deixe a senha em branco para mantê-la',
      largura: 'estreito',
      corpo: `
        <div class="campo">
          <label>Login *</label>
          <input id="u-login" value="${escapar(usuario?.usuario || '')}" ${novo ? '' : 'readonly'} placeholder="ex.: maria">
        </div>
        <div class="campo">
          <label>Nome completo</label>
          <input id="u-nome" value="${escapar(usuario?.nome || '')}" placeholder="ex.: Maria Souza — Caixa">
        </div>
        <div class="campo">
          <label>Perfil</label>
          <select id="u-perfil">
            <option value="operador" ${usuario?.perfil === 'admin' ? '' : 'selected'}>Operador de caixa</option>
            <option value="admin" ${usuario?.perfil === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        </div>
        <div class="campo">
          <label>${novo ? 'Senha *' : 'Nova senha'}</label>
          <input id="u-senha" type="password" placeholder="${novo ? 'mínimo 4 caracteres' : 'deixe vazio para não alterar'}">
        </div>
        <div class="campo">
          <label>Situação</label>
          <select id="u-ativo">
            <option value="1" ${usuario && !usuario.ativo ? '' : 'selected'}>Ativo</option>
            <option value="0" ${usuario && !usuario.ativo ? 'selected' : ''}>Bloqueado</option>
          </select>
        </div>
      `,
      rodape: `
        <button class="botao" data-acao="cancelar">Cancelar</button>
        <button class="botao botao-brasa" data-acao="salvar">Salvar</button>
      `,
    });

    modal.elemento.querySelector('[data-acao="cancelar"]').addEventListener('click', modal.fechar);
    modal.elemento.querySelector('[data-acao="salvar"]').addEventListener('click', async () => {
      const login = modal.elemento.querySelector('#u-login').value.trim();
      const senha = modal.elemento.querySelector('#u-senha').value;
      if (!login) { avisar('Informe o login.', 'erro'); return; }
      if (novo && senha.length < 4) { avisar('A senha precisa de ao menos 4 caracteres.', 'erro'); return; }
      try {
        await api('/api/usuarios', {
          metodo: 'POST',
          corpo: {
            usuario: login,
            nome: modal.elemento.querySelector('#u-nome').value,
            perfil: modal.elemento.querySelector('#u-perfil').value,
            senha: senha || undefined,
            ativo: modal.elemento.querySelector('#u-ativo').value === '1',
          },
        });
        modal.fechar();
        const atualizados = await api('/api/usuarios');
        desenharUsuarios(atualizados.usuarios);
        avisar('Usuário salvo.', 'sucesso');
      } catch (erro) {
        avisar(erro.message, 'erro');
      }
    });
  }

  tela.querySelector('#salvar-config').addEventListener('click', async (evento) => {
    const botao = evento.currentTarget;
    botao.disabled = true;
    const corpo = {};
    tela.querySelectorAll('[data-config]').forEach((campo) => {
      corpo[campo.dataset.config] = campo.value.trim();
    });
    try {
      await api('/api/config', { metodo: 'POST', corpo });
      avisar('Configurações salvas.', 'sucesso');
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
    botao.disabled = false;
  });

  tela.querySelector('#novo-usuario').addEventListener('click', () => formularioUsuario(null));

  tela.querySelector('#baixar').addEventListener('click', async () => {
    try {
      const resposta = await fetch('/api/exportar', {
        headers: { Authorization: `Bearer ${lerSessao().token}` },
      });
      if (!resposta.ok) throw new Error('Não foi possível gerar o arquivo.');
      const arquivo = await resposta.blob();
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Base PDV Quintal Gourmet ${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      avisar('Cópia de segurança baixada.', 'sucesso');
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  });

  desenharUsuarios(dadosUsuarios.usuarios);
}
