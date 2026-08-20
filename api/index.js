/**
 * Ponto de entrada na Vercel.
 *
 * O `vercel.json` manda todas as rotas /api/* para este arquivo, e o app Express
 * cuida do resto. Os arquivos da interface (pasta `public`) são servidos
 * diretamente pela CDN da Vercel.
 */

module.exports = require('../servidor/app');
