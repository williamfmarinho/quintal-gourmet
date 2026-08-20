/**
 * Escolhe onde os dados ficam guardados.
 *
 *   ARMAZENAMENTO=excel      → planilha local (padrão quando não há banco configurado)
 *   ARMAZENAMENTO=postgres   → Postgres do Supabase (padrão quando DATABASE_URL existe)
 */

let instancia = null;

function modoConfigurado() {
  const escolhido = String(process.env.ARMAZENAMENTO || '').trim().toLowerCase();
  if (escolhido) return escolhido;
  return process.env.DATABASE_URL ? 'postgres' : 'excel';
}

async function abrirArmazenamento() {
  if (instancia) return instancia;

  const modo = modoConfigurado();
  const fabrica = modo === 'postgres'
    ? require('./postgres')
    : require('./excel');

  const adaptador = fabrica.criarAdaptador();
  await adaptador.iniciar();
  instancia = adaptador;
  return instancia;
}

module.exports = { abrirArmazenamento, modoConfigurado };
