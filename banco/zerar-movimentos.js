/**
 * Prepara o sistema para alimentação manual do estoque.
 *
 * Zera o estoque de todos os produtos e apaga o histórico de movimentação de
 * mercadoria — SEM tocar no histórico de vendas (cupons, itens e pagamentos).
 *
 *   node banco/zerar-movimentos.js              → mostra o que seria feito
 *   node banco/zerar-movimentos.js --confirmar  → aplica
 *
 * Opções:
 *   --com-ajustes         apaga também o histórico de ajustes de inventário
 *   --com-saidas-de-venda apaga também as saídas geradas pelas vendas
 *                         (o cupom continua, mas o produto perde o histórico
 *                          de movimentação — use apenas se for isso mesmo)
 */

const { carregarAmbiente } = require('../servidor/ambiente');

carregarAmbiente();
if (process.env.DATABASE_URL_MIGRACAO) process.env.DATABASE_URL = process.env.DATABASE_URL_MIGRACAO;

const { obterPool } = require('../servidor/armazenamento/postgres');

const confirmar = process.argv.includes('--confirmar');
const comAjustes = process.argv.includes('--com-ajustes');
const comSaidasDeVenda = process.argv.includes('--com-saidas-de-venda');

async function retrato(pool) {
  const { rows } = await pool.query(`
    select
      (select count(*)::int from entradas) as entradas,
      (select count(*)::int from saidas where tipo <> 'VENDA') as saidas_sem_venda,
      (select count(*)::int from saidas where tipo = 'VENDA') as saidas_de_venda,
      (select count(*)::int from ajustes) as ajustes,
      (select count(*)::int from vendas) as vendas,
      (select count(*)::int from produtos where estoque <> 0) as produtos_com_estoque,
      (select coalesce(round(sum(estoque * custo_medio), 2), 0) from produtos) as valor_em_estoque
  `);
  return rows[0];
}

function mostrar(titulo, dados) {
  console.log(`\n  ${titulo}`);
  Object.entries(dados).forEach(([chave, valor]) => {
    console.log(`    ${chave.replace(/_/g, ' ').padEnd(22, '.')} ${valor}`);
  });
}

async function principal() {
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL no .env.local.');

  const pool = obterPool();
  const antes = await retrato(pool);
  mostrar('Situação atual:', antes);

  if (!confirmar) {
    console.log(`
  Nada foi alterado. O que aconteceria com --confirmar:
    • estoque de todos os produtos → 0
    • entradas apagadas ................ ${antes.entradas}
    • saídas sem venda apagadas ........ ${antes.saidas_sem_venda}
    • saídas de venda apagadas ......... ${comSaidasDeVenda ? antes.saidas_de_venda : '0 (preservadas)'}
    • ajustes apagados ................. ${comAjustes ? antes.ajustes : '0 (preservados)'}
    • vendas, itens e pagamentos ....... preservados (${antes.vendas} cupons)
`);
    return;
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('begin');

    await cliente.query('delete from entradas');
    await cliente.query(
      comSaidasDeVenda ? 'delete from saidas' : "delete from saidas where tipo <> 'VENDA'"
    );
    if (comAjustes) await cliente.query('delete from ajustes');

    await cliente.query(`
      update produtos
         set estoque = 0,
             ultima_entrada = null,
             atualizado_em = now()
    `);

    // As sequências recomeçam do 1 para os lançamentos manuais.
    await cliente.query("select setval(pg_get_serial_sequence('entradas', 'id'), 1, false)");
    if (comSaidasDeVenda) await cliente.query("select setval(pg_get_serial_sequence('saidas', 'id'), 1, false)");

    await cliente.query('commit');
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }

  mostrar('Situação depois:', await retrato(pool));
  console.log('\n  Pronto. O estoque agora é alimentado pelas entradas lançadas na tela de Estoque.\n');
}

principal()
  .then(async () => { await obterPool().end(); process.exit(0); })
  .catch(async (erro) => {
    console.error('\nFalha:', erro.message, '\n');
    try { await obterPool().end(); } catch { /* já fechado */ }
    process.exit(1);
  });
