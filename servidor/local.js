/**
 * Execução local do sistema (dois cliques no "INICIAR SISTEMA.bat").
 *
 * Sem DATABASE_URL configurada, roda no modo planilha Excel — sem internet.
 * Com DATABASE_URL (ou ARMAZENAMENTO=postgres), conversa com o Supabase.
 */

const os = require('os');
const { exec } = require('child_process');

const { carregarAmbiente } = require('./ambiente');

carregarAmbiente();

const app = require('./app');
const planilha = require('./armazenamento/planilha');
const { modoConfigurado } = require('./armazenamento/indice');
const { semear } = require('./semear');

const PORTA = Number(process.env.PORTA || process.env.PORT || 4321);

function enderecosDaRede() {
  const lista = [];
  Object.values(os.networkInterfaces()).forEach((redes) => {
    (redes || []).forEach((rede) => {
      if (rede.family === 'IPv4' && !rede.internal) lista.push(`http://${rede.address}:${PORTA}`);
    });
  });
  return lista;
}

async function iniciar() {
  const modo = modoConfigurado();

  if (modo === 'excel' && !planilha.existeBase()) {
    console.log('Base não encontrada — gerando a partir da planilha original...');
    await semear({ forcar: false });
  }

  app.listen(PORTA, () => {
    console.log([
      '',
      '  ┌──────────────────────────────────────────────┐',
      '  │   QUINTAL GOURMET · SISTEMA DE PDV (LOCAL)   │',
      '  └──────────────────────────────────────────────┘',
      '',
      `  Interface ......... http://localhost:${PORTA}`,
      `  Armazenamento ..... ${modo === 'postgres' ? 'Postgres (Supabase)' : `Planilha Excel — ${planilha.ARQUIVO_BASE}`}`,
      '',
      '  Acessos de demonstração:',
      '    admin / admin123   → administrador (tudo)',
      '    caixa / caixa123   → operador de caixa (PDV)',
      '',
      '  Encerre com Ctrl + C.',
      '',
    ].join('\n'));

    const rede = enderecosDaRede();
    if (rede.length) console.log(`  Na rede local: ${rede.join(', ')}\n`);

    if (process.platform === 'win32' && !process.env.SEM_NAVEGADOR) {
      exec(`start "" "http://localhost:${PORTA}"`);
    }
  });
}

iniciar().catch((erro) => {
  console.error('\nNão foi possível iniciar o sistema:\n ', erro.message, '\n');
  process.exit(1);
});
