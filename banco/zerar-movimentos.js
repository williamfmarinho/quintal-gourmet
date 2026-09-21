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
 *   --com-vendas          apaga TODO o histórico de vendas: cupons, itens,
 *                         pagamentos, saídas e movimentos de caixa gerados por
 *                         venda, estornos, e recomeça a numeração em QG-000001.
 *                         Os turnos de caixa ficam, com os totais de venda zerados.
 *   --com-caixas          apaga também os turnos de caixa e todos os seus movimentos
 *   --so-vendas           atalho: --com-vendas sem mexer em estoque nem entradas
 */

const { carregarAmbiente } = require('../servidor/ambiente');

carregarAmbiente();
if (process.env.DATABASE_URL_MIGRACAO) process.env.DATABASE_URL = process.env.DATABASE_URL_MIGRACAO;

const { obterPool } = require('../servidor/armazenamento/postgres');

const confirmar = process.argv.includes('--confirmar');
const comAjustes = process.argv.includes('--com-ajustes');
const comSaidasDeVenda = process.argv.includes('--com-saidas-de-venda');
const soVendas = process.argv.includes('--so-vendas');
const comVendas = process.argv.includes('--com-vendas') || soVendas;
const comCaixas = process.argv.includes('--com-caixas');

async function retrato(pool) {
  const { rows } = await pool.query(`
    select
      (select count(*)::int from entradas) as entradas,
      (select count(*)::int from saidas where tipo <> 'VENDA') as saidas_sem_venda,
      (select count(*)::int from saidas where tipo = 'VENDA') as saidas_de_venda,
      (select count(*)::int from ajustes) as ajustes,
      (select count(*)::int from vendas) as vendas,
      (select count(*)::int from mov_caixa where tipo = 'VENDA') as mov_caixa_de_venda,
      (select count(*)::int from ajustes where motivo = 'ESTORNO DE VENDA') as estornos,
      (select count(*)::int from caixas) as caixas,
      (select count(*)::int from caixas where status = 'ABERTO') as caixas_abertos,
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
    • estoque de todos os produtos → 0 ${soVendas ? '(pulado: --so-vendas)' : ''}
    • entradas apagadas ................ ${soVendas ? '0 (pulado)' : antes.entradas}
    • saídas sem venda apagadas ........ ${soVendas ? '0 (pulado)' : antes.saidas_sem_venda}
    • saídas de venda apagadas ......... ${comSaidasDeVenda || comVendas ? antes.saidas_de_venda : '0 (preservadas)'}
    • ajustes apagados ................. ${comAjustes ? antes.ajustes : comVendas ? `${antes.estornos} (só estornos de venda)` : '0 (preservados)'}
    • cupons de venda apagados ......... ${comVendas ? `${antes.vendas} (com itens e pagamentos; numeração volta a QG-000001)` : `0 (${antes.vendas} preservados)`}
    • movimentos de caixa de venda ..... ${comVendas ? antes.mov_caixa_de_venda : '0 (preservados)'}
    • turnos de caixa .................. ${comCaixas ? `${antes.caixas} apagados` : comVendas ? `${antes.caixas} mantidos, totais de venda zerados` : `${antes.caixas} preservados`}
`);
    return;
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('begin');

    if (!soVendas) {
      await cliente.query('delete from entradas');
      await cliente.query(
        comSaidasDeVenda ? 'delete from saidas' : "delete from saidas where tipo <> 'VENDA'"
      );
      await cliente.query(`
        update produtos
           set estoque = 0,
               ultima_entrada = null,
               atualizado_em = now()
      `);
      // As sequências recomeçam do 1 para os lançamentos manuais.
      await cliente.query("select setval(pg_get_serial_sequence('entradas', 'id'), 1, false)");
      if (comSaidasDeVenda) await cliente.query("select setval(pg_get_serial_sequence('saidas', 'id'), 1, false)");
    }

    if (comAjustes) await cliente.query('delete from ajustes');

    if (comVendas) {
      // Itens e pagamentos caem em cascata pela chave estrangeira.
      await cliente.query('delete from vendas');
      await cliente.query("delete from saidas where tipo = 'VENDA'");
      await cliente.query("delete from mov_caixa where tipo = 'VENDA'");
      if (!comAjustes) await cliente.query("delete from ajustes where motivo = 'ESTORNO DE VENDA'");

      await cliente.query("select setval('cupom_seq'::regclass, 1, false)");
      await cliente.query("select setval(pg_get_serial_sequence('vendas', 'id'), 1, false)");
      await cliente.query("select setval(pg_get_serial_sequence('pagamentos', 'id'), 1, false)");
      const restam = await cliente.query('select 1 from saidas limit 1');
      if (!restam.rowCount) {
        await cliente.query("select setval(pg_get_serial_sequence('saidas', 'id'), 1, false)");
      }

      // Turnos que ficam: sem vendas, o esperado na gaveta é fundo + suprimentos − sangrias.
      if (!comCaixas) {
        await cliente.query(`
          update caixas
             set vendas_total = 0,
                 vendas_dinheiro = 0,
                 saldo_esperado = valor_abertura + suprimentos - sangrias,
                 diferenca = case when status = 'FECHADO'
                                  then saldo_informado - (valor_abertura + suprimentos - sangrias)
                                  else 0 end
        `);
      }
    }

    if (comCaixas) {
      await cliente.query('delete from mov_caixa');
      await cliente.query('delete from caixas');
      await cliente.query("select setval(pg_get_serial_sequence('caixas', 'id'), 1, false)");
      await cliente.query("select setval(pg_get_serial_sequence('mov_caixa', 'id'), 1, false)");
    }

    await cliente.query('commit');
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }

  mostrar('Situação depois:', await retrato(pool));
  console.log(comVendas
    ? '\n  Pronto. O histórico de vendas foi zerado; o próximo cupom será QG-000001.\n'
    : '\n  Pronto. O estoque agora é alimentado pelas entradas lançadas na tela de Estoque.\n');
}

principal()
  .then(async () => { await obterPool().end(); process.exit(0); })
  .catch(async (erro) => {
    console.error('\nFalha:', erro.message, '\n');
    try { await obterPool().end(); } catch { /* já fechado */ }
    process.exit(1);
  });
