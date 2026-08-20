/**
 * Armazenamento em planilha Excel (modo local, sem internet).
 *
 * Implementa o mesmo contrato do adaptador Postgres, para que as regras de
 * negócio em `dominio.js` sejam exatamente as mesmas nos dois modos.
 */

const planilha = require('./planilha');

const ABA = {
  produtos: 'PRODUTOS',
  entradas: 'ENTRADAS',
  saidas: 'SAIDAS',
  ajustes: 'AJUSTES',
  vendas: 'VENDAS',
  venda_itens: 'VENDA_ITENS',
  pagamentos: 'PAGAMENTOS',
  caixas: 'CAIXAS',
  mov_caixa: 'MOV_CAIXA',
  usuarios: 'USUARIOS',
  config: 'CONFIG',
};

const SEM_ID = new Set(['produtos', 'venda_itens', 'pagamentos', 'usuarios', 'config']);

function aba(tabela) {
  const nome = ABA[tabela];
  if (!nome) throw new Error(`Tabela desconhecida: ${tabela}`);
  return nome;
}

/** Aplica um filtro de campo no formato { ne, in, gte, lte, ilike } ou valor direto. */
function combina(valorLinha, condicao) {
  if (condicao === null || condicao === undefined) return true;
  if (typeof condicao === 'object' && !Array.isArray(condicao)) {
    if ('ne' in condicao && String(valorLinha) === String(condicao.ne)) return false;
    if ('in' in condicao && !condicao.in.map(String).includes(String(valorLinha))) return false;
    if ('gte' in condicao && Number(valorLinha) < Number(condicao.gte)) return false;
    if ('lte' in condicao && Number(valorLinha) > Number(condicao.lte)) return false;
    if ('ilike' in condicao) {
      const alvo = String(condicao.ilike).toUpperCase();
      if (!String(valorLinha ?? '').toUpperCase().includes(alvo)) return false;
    }
    return true;
  }
  return String(valorLinha ?? '') === String(condicao);
}

function criarAdaptador() {
  const adaptador = {
    tipo: 'excel',
    descricao: `Planilha Excel local (${planilha.ARQUIVO_BASE})`,

    async iniciar() {
      if (!planilha.estaCarregada()) await planilha.carregar();
      return adaptador;
    },

    async encerrar() { /* nada a fechar */ },

    /**
     * Executa as operações e grava a planilha ao final. Se algo falhar no meio,
     * o estado em memória volta ao ponto anterior.
     */
    async transacao(operacoes) {
      const retrato = {};
      planilha.ABAS.forEach((nome) => {
        retrato[nome] = planilha.tabela(nome).map((linha) => ({ ...linha }));
      });
      try {
        const resultado = await operacoes(adaptador);
        await planilha.salvar();
        return resultado;
      } catch (erro) {
        planilha.ABAS.forEach((nome) => {
          const alvo = planilha.tabela(nome);
          alvo.length = 0;
          retrato[nome].forEach((linha) => alvo.push(linha));
        });
        throw erro;
      }
    },

    async listar(tabela, filtro = {}) {
      let linhas = planilha.tabela(aba(tabela)).map((linha) => ({ ...linha }));

      Object.entries(filtro.onde || {}).forEach(([campo, condicao]) => {
        linhas = linhas.filter((linha) => combina(linha[campo], condicao));
      });

      if (filtro.periodo) {
        const { campo = 'data', de, ate } = filtro.periodo;
        linhas = linhas.filter((linha) => {
          const data = new Date(linha[campo]);
          if (Number.isNaN(data.getTime())) return false;
          if (de && data < de) return false;
          if (ate && data > ate) return false;
          return true;
        });
      }

      if (filtro.ordem) {
        const { campo, desc = false } = filtro.ordem;
        linhas.sort((a, b) => {
          const x = a[campo];
          const y = b[campo];
          const comparacao = typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y), 'pt-BR');
          return desc ? -comparacao : comparacao;
        });
      }

      if (filtro.limite) linhas = linhas.slice(0, filtro.limite);
      return linhas;
    },

    async inserir(tabela, registro) {
      const nome = aba(tabela);
      const dados = { ...registro };
      if (!SEM_ID.has(tabela) && (dados.id === undefined || dados.id === null || dados.id === '')) {
        dados.id = planilha.proximoId(nome);
      }
      return { ...planilha.inserir(nome, dados) };
    },

    async atualizar(tabela, chave, campos) {
      const nome = aba(tabela);
      const linha = planilha.tabela(nome).find((registro) => (
        Object.entries(chave).every(([campo, valor]) => String(registro[campo]) === String(valor))
      ));
      if (!linha) return null;
      Object.entries(campos).forEach(([campo, valor]) => {
        linha[campo] = planilha.normalizarCampo(nome, campo, valor);
      });
      return { ...linha };
    },

    /** Soma (ou subtrai) do estoque do produto e aplica campos extras. */
    async ajustarEstoque(codigo, delta, extras = {}) {
      const alvo = String(codigo).toUpperCase();
      const linha = planilha.tabela('PRODUTOS').find((p) => String(p.codigo).toUpperCase() === alvo);
      if (!linha) throw new Error(`Produto não encontrado: ${codigo}`);
      linha.estoque = Math.round((Number(linha.estoque) + Number(delta)) * 1000) / 1000;
      Object.entries(extras).forEach(([campo, valor]) => {
        linha[campo] = planilha.normalizarCampo('PRODUTOS', campo, valor);
      });
      return { ...linha };
    },

    async produto(codigoOuBarras) {
      const alvo = String(codigoOuBarras || '').trim().toUpperCase();
      if (!alvo) return null;
      const linha = planilha.tabela('PRODUTOS').find((p) => (
        String(p.codigo).toUpperCase() === alvo || String(p.codigo_barras) === alvo
      ));
      return linha ? { ...linha } : null;
    },

    async proximoNumeroCupom() {
      const atual = Number(planilha.lerConfig('proximo_cupom', '1')) || 1;
      planilha.definirConfig('proximo_cupom', atual + 1);
      return `QG-${String(atual).padStart(6, '0')}`;
    },

    async config() {
      const mapa = {};
      planilha.tabela('CONFIG').forEach((linha) => { mapa[linha.chave] = linha.valor; });
      return mapa;
    },

    async definirConfig(valores) {
      Object.entries(valores).forEach(([chave, valor]) => planilha.definirConfig(chave, valor));
    },
  };

  return adaptador;
}

module.exports = { criarAdaptador };
