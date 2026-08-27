/**
 * Cria o esquema no Postgres (Supabase) e carrega os dados iniciais, gerados a
 * partir da planilha original do Quintal Gourmet.
 *
 *   node banco/migrar.js              → cria o que faltar e carrega se estiver vazio
 *   node banco/migrar.js --recarregar → apaga os dados e carrega tudo de novo
 *   node banco/migrar.js --so-esquema → apenas cria/atualiza as tabelas
 *
 * A conexão sai de DATABASE_URL (arquivo .env.local, nunca versionado).
 */

const fs = require('fs');
const path = require('path');

const { carregarAmbiente } = require('../servidor/ambiente');

carregarAmbiente();

// Para DDL, o *session pooler* (porta 5432) é mais adequado que o de transação.
if (process.env.DATABASE_URL_MIGRACAO) process.env.DATABASE_URL = process.env.DATABASE_URL_MIGRACAO;

const { criarAdaptador, obterPool } = require('../servidor/armazenamento/postgres');
const { gerarBase } = require('../servidor/semear');

const ARQUIVO_ESQUEMA = path.join(__dirname, 'esquema.sql');

/** Aba da planilha → tabela do banco, na ordem em que precisam ser inseridas. */
const CARGA = [
  ['USUARIOS', 'usuarios'],
  ['PRODUTOS', 'produtos'],
  ['CONFIG', 'config'],
  ['CAIXAS', 'caixas'],
  ['VENDAS', 'vendas'],
  ['VENDA_ITENS', 'venda_itens'],
  ['PAGAMENTOS', 'pagamentos'],
  ['ENTRADAS', 'entradas'],
  ['SAIDAS', 'saidas'],
  ['AJUSTES', 'ajustes'],
  ['MOV_CAIXA', 'mov_caixa'],
];

const TABELAS = CARGA.map(([, tabela]) => tabela);
const COM_SEQUENCIA = ['caixas', 'vendas', 'pagamentos', 'entradas', 'saidas', 'ajustes', 'mov_caixa'];

async function criarEsquema(pool) {
  const sql = fs.readFileSync(ARQUIVO_ESQUEMA, 'utf8');
  await pool.query(sql);
  console.log('  esquema ............ ok');
}

/**
 * Aponta cada produto para a foto correspondente em `public/fotos`.
 * Roda sempre e não apaga nada: serve tanto para uma base nova quanto para
 * uma base que já está em uso e acabou de ganhar as fotos.
 */
async function sincronizarFotos(pool) {
  const pasta = path.join(__dirname, '..', 'public', 'fotos');
  if (!fs.existsSync(pasta)) return;

  const codigos = fs.readdirSync(pasta)
    .filter((nome) => nome.toLowerCase().endsWith('.jpg') && !nome.toLowerCase().endsWith('-mini.jpg'))
    .map((nome) => nome.replace(/\.jpg$/i, '').toUpperCase());

  if (!codigos.length) return;

  const { rowCount } = await pool.query(
    `update produtos
        set foto = '/fotos/' || codigo || '.jpg'
      where upper(codigo) = any($1)
        and foto is distinct from '/fotos/' || codigo || '.jpg'`,
    [codigos]
  );

  console.log(`  fotos .............. ${codigos.length} disponíveis, ${rowCount} produto(s) atualizados`);
}

async function estaVazio(pool) {
  const { rows } = await pool.query('select count(*)::int as total from produtos');
  return rows[0].total === 0;
}

async function limpar(pool) {
  await pool.query(`truncate ${TABELAS.join(', ')} restart identity cascade`);
  console.log('  dados anteriores ... removidos');
}

async function carregarDados(adaptador) {
  const base = await gerarBase();

  await adaptador.transacao(async (tx) => {
    for (const [aba, tabela] of CARGA) {
      const linhas = base[aba] || [];
      for (const linha of linhas) {
        const registro = { ...linha };
        // PAGAMENTOS e VENDA_ITENS não têm id próprio na planilha.
        if (tabela === 'pagamentos') delete registro.id;
        await tx.inserir(tabela, registro);
      }
      if (linhas.length) console.log(`  ${tabela.padEnd(18, '.')} ${linhas.length} registro(s)`);
    }

    // Sincroniza as sequências com os ids que acabaram de ser inseridos.
    for (const tabela of COM_SEQUENCIA) {
      await tx.executar(
        `select setval(pg_get_serial_sequence($1, 'id'), coalesce((select max(id) from ${tabela}), 1))`,
        [tabela]
      );
    }

    const proximo = Number(base.CONFIG.find((c) => c.chave === 'proximo_cupom')?.valor || 1);
    await tx.executar("select setval('cupom_seq'::regclass, $1)", [Math.max(1, proximo - 1)]);
  });
}

async function principal() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Defina DATABASE_URL no arquivo .env.local antes de migrar.');
  }

  const recarregar = process.argv.includes('--recarregar');
  const soEsquema = process.argv.includes('--so-esquema');

  const adaptador = criarAdaptador();
  const pool = obterPool();

  console.log('\nMigrando o banco do Quintal Gourmet...\n');
  await criarEsquema(pool);
  await sincronizarFotos(pool);

  if (soEsquema) {
    console.log('\nSomente o esquema foi aplicado.\n');
    return;
  }

  if (recarregar) await limpar(pool);
  else if (!(await estaVazio(pool))) {
    console.log('\n  O banco já tem dados. Use --recarregar para apagar e carregar de novo.\n');
    return;
  }

  await carregarDados(adaptador);
  await sincronizarFotos(pool);

  const { rows } = await pool.query(`
    select
      (select count(*) from produtos) as produtos,
      (select count(*) from vendas) as vendas,
      (select count(*) from usuarios) as usuarios
  `);
  console.log(`\nPronto: ${rows[0].produtos} produtos, ${rows[0].vendas} vendas, ${rows[0].usuarios} usuários.\n`);
}

principal()
  .then(async () => {
    await obterPool().end();
    process.exit(0);
  })
  .catch(async (erro) => {
    console.error('\nFalha na migração:', erro.message, '\n');
    try { await obterPool().end(); } catch { /* já fechado */ }
    process.exit(1);
  });
