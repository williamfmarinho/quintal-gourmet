/**
 * Prepara as fotos dos produtos para o sistema.
 *
 * Lê as fotos originais (1200x1600, ~180 KB cada), gera duas versões quadradas
 * otimizadas e grava em `public/fotos`, que é servido tanto no modo local
 * quanto pela CDN da Vercel:
 *
 *   public/fotos/<CODIGO>.jpg        640x640 — ficha do produto
 *   public/fotos/<CODIGO>-mini.jpg   320x320 — grade do PDV, tabelas e comanda
 *
 *   node banco/preparar-fotos.js ["caminho/da/pasta/de/fotos"]
 *
 * As fotos originais NÃO entram no repositório: só as versões otimizadas.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'public', 'fotos');

const ORIGEM_PADRAO = [
  path.join(RAIZ, '..', 'Fotos'),
  path.join(RAIZ, 'banco', 'fotos-origem'),
];

/**
 * De qual arquivo vem a foto de cada produto.
 * Os nomes seguem a pasta de fotos do Quintal Gourmet — inclusive os apelidos
 * ("kafka" no lugar de "kafta", "lnguica" sem o i).
 */
const MAPA = {
  LINFMQ: 'frango com manjeiricao e queijo',
  LINFB: 'linguica frango com bacon',
  LINT: 'linguica toscana pura',
  LINTQ: 'linguica toscana com queijo',
  LINTPQ: 'linguica toscana picante com queijo',
  LINCU: 'linguica cuiabana',
  LINCA: 'lnguica carneiro puro',
  LINCAQP: 'linguica carneiro com queijo picante',
  LINCAQ: 'linguica carneiro com queijo',
  LINCSQ: 'linguica carne de sol com queijo',
  DESCS: 'carne de sol 500g',
  DESFR: 'file de frango 500g',
  KAFB: 'kafka bovina',
  KAFS: 'kafka suina',
  KAFF: 'kafta de frango',
  TULC: 'tulipa com cheddar',
  TULR: 'tulipa com requeijao',
  FAR: 'farofa 500g',
  TOR: 'torresmo 100g',
  FEI: 'feijoada 1kg',
  HMB: 'hamburger',
};

const EXTENSOES = ['.jpeg', '.jpg', '.png', '.webp', '.JPEG', '.JPG', '.PNG'];

function acharOrigem(informada) {
  const candidatas = informada ? [path.resolve(informada), ...ORIGEM_PADRAO] : ORIGEM_PADRAO;
  const encontrada = candidatas.find((caminho) => fs.existsSync(caminho));
  if (!encontrada) {
    throw new Error(`Pasta de fotos não encontrada. Procurei em:\n  ${candidatas.join('\n  ')}`);
  }
  return encontrada;
}

function acharArquivo(pasta, base) {
  for (const extensao of EXTENSOES) {
    const caminho = path.join(pasta, base + extensao);
    if (fs.existsSync(caminho)) return caminho;
  }
  return null;
}

async function principal() {
  const origem = acharOrigem(process.argv[2]);
  fs.mkdirSync(DESTINO, { recursive: true });

  console.log(`\nFotos originais: ${origem}`);
  console.log(`Destino:         ${DESTINO}\n`);

  const usados = new Set();
  let gerados = 0;
  let faltando = [];

  for (const [codigo, base] of Object.entries(MAPA)) {
    const arquivo = acharArquivo(origem, base);
    if (!arquivo) {
      faltando.push(`${codigo} (esperava "${base}")`);
      continue;
    }
    usados.add(path.basename(arquivo));

    const imagem = sharp(arquivo).rotate(); // respeita a orientação da câmera

    await imagem
      .clone()
      .resize(640, 640, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(DESTINO, `${codigo}.jpg`));

    await imagem
      .clone()
      .resize(320, 320, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(path.join(DESTINO, `${codigo}-mini.jpg`));

    gerados += 1;
    console.log(`  ${codigo.padEnd(8)} ← ${path.basename(arquivo)}`);
  }

  const sobrando = fs.readdirSync(origem)
    .filter((nome) => EXTENSOES.includes(path.extname(nome)))
    .filter((nome) => !usados.has(nome));

  const tamanho = fs.readdirSync(DESTINO)
    .reduce((total, nome) => total + fs.statSync(path.join(DESTINO, nome)).size, 0);

  console.log(`\n  ${gerados} produto(s) com foto · ${(tamanho / 1024 / 1024).toFixed(2)} MB gerados`);
  if (faltando.length) console.log(`  sem foto: ${faltando.join(', ')}`);
  if (sobrando.length) console.log(`  fotos não usadas: ${sobrando.join(', ')}`);
  console.log('');
}

principal().catch((erro) => {
  console.error('\nFalha ao preparar as fotos:', erro.message, '\n');
  process.exit(1);
});
