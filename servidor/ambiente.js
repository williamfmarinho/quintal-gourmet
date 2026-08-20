/**
 * Carrega variáveis de ambiente de um arquivo `.env.local` (nunca versionado).
 * Evita depender de biblioteca externa só para isso.
 */

const fs = require('fs');
const path = require('path');

function carregarAmbiente(arquivo = path.join(__dirname, '..', '.env.local')) {
  if (!fs.existsSync(arquivo)) return false;

  fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).forEach((linha) => {
    const conteudo = linha.trim();
    if (!conteudo || conteudo.startsWith('#')) return;

    const separador = conteudo.indexOf('=');
    if (separador < 1) return;

    const chave = conteudo.slice(0, separador).trim();
    let valor = conteudo.slice(separador + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[chave] === undefined) process.env[chave] = valor;
  });

  return true;
}

module.exports = { carregarAmbiente };
