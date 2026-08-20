/**
 * Armazenamento em Postgres (Supabase) — modo usado na versão publicada.
 *
 * Implementa o mesmo contrato do adaptador Excel. A conexão é feita pelo
 * *transaction pooler* do Supabase, que é o caminho recomendado para funções
 * serverless (o host direto `db.<ref>.supabase.co` só responde em IPv6).
 */

const { Pool, types } = require('pg');

// Sem estes conversores o driver devolve numeric como texto e data como objeto.
types.setTypeParser(20, (valor) => parseInt(valor, 10));        // int8
types.setTypeParser(1700, (valor) => parseFloat(valor));        // numeric
types.setTypeParser(1114, (valor) => new Date(`${valor}Z`).toISOString()); // timestamp
types.setTypeParser(1184, (valor) => new Date(valor).toISOString());       // timestamptz

const TABELAS = new Set([
  'produtos', 'entradas', 'saidas', 'ajustes', 'vendas', 'venda_itens',
  'pagamentos', 'caixas', 'mov_caixa', 'usuarios', 'config',
]);

const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;

/** Colunas de data: string vazia precisa virar NULL antes de chegar ao Postgres. */
const COLUNAS_DATA = new Set([
  'data', 'criado_em', 'atualizado_em', 'ultima_entrada', 'ultima_saida',
  'ultimo_acesso', 'aberto_em', 'fechado_em',
]);

const valorParaBanco = (campo, valor) => (COLUNAS_DATA.has(campo) && (valor === '' || valor === undefined) ? null : valor);

function validarTabela(tabela) {
  if (!TABELAS.has(tabela)) throw new Error(`Tabela desconhecida: ${tabela}`);
  return tabela;
}

function validarCampo(campo) {
  if (!IDENTIFICADOR.test(campo)) throw new Error(`Campo inválido: ${campo}`);
  return campo;
}

/** Pool reaproveitado entre invocações da mesma instância serverless. */
let pool = null;

function obterPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Defina DATABASE_URL com a string de conexão do Supabase (transaction pooler).');
  }
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.DB_MAX_CONEXOES || 3),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000,
    // O pooler em modo transação não suporta prepared statements nomeados.
    statement_timeout: 20000,
  });
  pool.on('error', (erro) => console.error('[postgres] erro no pool:', erro.message));
  return pool;
}

/* ------------------------------------------------------------------ *
 * Montagem das consultas
 * ------------------------------------------------------------------ */

function montarOnde(filtro, parametros) {
  const condicoes = [];

  Object.entries(filtro.onde || {}).forEach(([campo, condicao]) => {
    const coluna = validarCampo(campo);
    if (condicao === null || condicao === undefined) return;

    if (typeof condicao === 'object' && !Array.isArray(condicao)) {
      if ('ne' in condicao) {
        parametros.push(condicao.ne);
        condicoes.push(`${coluna} <> $${parametros.length}`);
      }
      if ('in' in condicao) {
        if (!condicao.in.length) { condicoes.push('false'); return; }
        parametros.push(condicao.in);
        condicoes.push(`${coluna} = any($${parametros.length})`);
      }
      if ('gte' in condicao) {
        parametros.push(condicao.gte);
        condicoes.push(`${coluna} >= $${parametros.length}`);
      }
      if ('lte' in condicao) {
        parametros.push(condicao.lte);
        condicoes.push(`${coluna} <= $${parametros.length}`);
      }
      if ('ilike' in condicao) {
        parametros.push(`%${condicao.ilike}%`);
        condicoes.push(`${coluna}::text ilike $${parametros.length}`);
      }
      return;
    }

    parametros.push(condicao);
    condicoes.push(`${coluna} = $${parametros.length}`);
  });

  if (filtro.periodo) {
    const campo = validarCampo(filtro.periodo.campo || 'data');
    if (filtro.periodo.de) {
      parametros.push(new Date(filtro.periodo.de).toISOString());
      condicoes.push(`${campo} >= $${parametros.length}`);
    }
    if (filtro.periodo.ate) {
      parametros.push(new Date(filtro.periodo.ate).toISOString());
      condicoes.push(`${campo} <= $${parametros.length}`);
    }
  }

  return condicoes.length ? ` where ${condicoes.join(' and ')}` : '';
}

/** Cria o adaptador amarrado a um executor (pool ou cliente de transação). */
function adaptadorSobre(executor, dentroDeTransacao) {
  const adaptador = {
    tipo: 'postgres',
    descricao: 'Postgres no Supabase',

    async iniciar() {
      await executor.query('select 1');
      return adaptador;
    },

    async encerrar() {
      if (pool) { await pool.end(); pool = null; }
    },

    async transacao(operacoes) {
      if (dentroDeTransacao) return operacoes(adaptador);
      const cliente = await obterPool().connect();
      try {
        await cliente.query('begin');
        const resultado = await operacoes(adaptadorSobre(cliente, true));
        await cliente.query('commit');
        return resultado;
      } catch (erro) {
        try { await cliente.query('rollback'); } catch { /* conexão já perdida */ }
        throw erro;
      } finally {
        cliente.release();
      }
    },

    /** Consulta livre — usada pela migração e por diagnósticos. */
    async executar(sql, parametros = []) {
      const { rows } = await executor.query(sql, parametros);
      return rows;
    },

    async listar(tabela, filtro = {}) {
      validarTabela(tabela);
      const parametros = [];
      let sql = `select * from ${tabela}${montarOnde(filtro, parametros)}`;

      if (filtro.ordem) {
        const campo = validarCampo(filtro.ordem.campo);
        sql += ` order by ${campo} ${filtro.ordem.desc ? 'desc' : 'asc'}`;
      }
      if (filtro.limite) {
        parametros.push(Number(filtro.limite));
        sql += ` limit $${parametros.length}`;
      }

      const { rows } = await executor.query(sql, parametros);
      return rows;
    },

    async inserir(tabela, registro) {
      validarTabela(tabela);
      const campos = Object.keys(registro)
        .filter((campo) => registro[campo] !== undefined)
        .filter((campo) => !(campo === 'id' && (registro[campo] === '' || registro[campo] === null)));

      const colunas = campos.map(validarCampo);
      const marcadores = campos.map((_, i) => `$${i + 1}`);
      const valores = campos.map((campo) => valorParaBanco(campo, registro[campo]));

      const sql = `insert into ${tabela} (${colunas.join(', ')}) values (${marcadores.join(', ')}) returning *`;
      const { rows } = await executor.query(sql, valores);
      return rows[0];
    },

    async atualizar(tabela, chave, campos) {
      validarTabela(tabela);
      const parametros = [];
      const atribuicoes = Object.entries(campos).map(([campo, valor]) => {
        parametros.push(valorParaBanco(campo, valor));
        return `${validarCampo(campo)} = $${parametros.length}`;
      });
      const condicoes = Object.entries(chave).map(([campo, valor]) => {
        parametros.push(valor);
        return `${validarCampo(campo)} = $${parametros.length}`;
      });

      const sql = `update ${tabela} set ${atribuicoes.join(', ')} where ${condicoes.join(' and ')} returning *`;
      const { rows } = await executor.query(sql, parametros);
      return rows[0] || null;
    },

    /**
     * Soma (ou subtrai) do estoque no próprio banco (`estoque = estoque + delta`),
     * evitando que duas vendas simultâneas sobrescrevam o saldo uma da outra.
     */
    async ajustarEstoque(codigo, delta, extras = {}) {
      const parametros = [Number(delta)];
      const atribuicoes = ['estoque = estoque + $1'];

      Object.entries(extras).forEach(([campo, valor]) => {
        parametros.push(valorParaBanco(campo, valor));
        atribuicoes.push(`${validarCampo(campo)} = $${parametros.length}`);
      });

      parametros.push(String(codigo).toUpperCase());
      const sql = `update produtos set ${atribuicoes.join(', ')}
                   where upper(codigo) = $${parametros.length} returning *`;

      const { rows } = await executor.query(sql, parametros);
      if (!rows[0]) throw new Error(`Produto não encontrado: ${codigo}`);
      return rows[0];
    },

    async produto(codigoOuBarras) {
      const alvo = String(codigoOuBarras || '').trim().toUpperCase();
      if (!alvo) return null;
      const { rows } = await executor.query(
        'select * from produtos where upper(codigo) = $1 or codigo_barras = $1 limit 1',
        [alvo]
      );
      return rows[0] || null;
    },

    async proximoNumeroCupom() {
      const { rows } = await executor.query("select lpad(nextval('cupom_seq')::text, 6, '0') as sequencia");
      return `QG-${rows[0].sequencia}`;
    },

    async config() {
      const { rows } = await executor.query('select chave, valor from config');
      const mapa = {};
      rows.forEach((linha) => { mapa[linha.chave] = linha.valor; });
      return mapa;
    },

    async definirConfig(valores) {
      const entradas = Object.entries(valores);
      if (!entradas.length) return;
      const parametros = [];
      const linhas = entradas.map(([chave, valor]) => {
        parametros.push(chave, String(valor ?? ''));
        return `($${parametros.length - 1}, $${parametros.length})`;
      });
      await executor.query(
        `insert into config (chave, valor) values ${linhas.join(', ')}
         on conflict (chave) do update set valor = excluded.valor`,
        parametros
      );
    },
  };

  return adaptador;
}

function criarAdaptador() {
  return adaptadorSobre(obterPool(), false);
}

module.exports = { criarAdaptador, obterPool };
