// Gera:
//  - caixas.html: arquivo único com tudo embutido (abre direto no computador ou Android, sem internet);
//  - docs/: versão instalável (GitHub Pages) que funciona offline no iPhone depois de aberta uma vez.
// Uso: node build.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const dir = path.join(__dirname, 'public');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const version = new Date().toISOString().replace(/\D/g, '').slice(0, 12);

let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="app.css">', () => `<style>\n${read('app.css')}\n</style>`);
html = html.replace(/<script src="([\w.-]+\.js)"><\/script>/g, (_, f) => `<script>\n${read(f).replace(/<\/script/gi, '<\\/script')}\n</script>`);
if (/(src|href)="(?!data:|https?:)[^"]+\.(js|css)"/.test(html)) throw new Error('Algum arquivo não foi embutido.');
fs.writeFileSync(path.join(__dirname, 'caixas.html'), html);

// ── Versão instalável (PWA) ──
const out = path.join(__dirname, 'docs');
fs.mkdirSync(out, { recursive: true });
const head = `  <link rel="manifest" href="manifest.webmanifest">\n  <link rel="apple-touch-icon" href="icon-180.png">\n</head>`;
const sw = `<script>if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');</script>\n</body>`;
fs.writeFileSync(path.join(out, 'index.html'), html.replace('</head>', head).replace('</body>', sw));
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  name: 'Caixas', short_name: 'Caixas', lang: 'pt-BR', start_url: './', scope: './', display: 'standalone',
  background_color: '#f7f7f5', theme_color: '#f7f7f5',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
}, null, 2));
fs.writeFileSync(path.join(out, 'sw.js'), `// Guarda o app no aparelho para abrir sem internet.
const CACHE = 'caixas-${version}';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Rede primeiro (pega atualizações quando houver internet); sem internet, usa a cópia guardada.
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});
`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
for (const s of [180, 192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), iconPng(s));
console.log(`caixas.html gerado (${Math.round(html.length / 1024)} KB) e docs/ (versão instalável) atualizada`);

// Ícone desenhado em código: fundo escuro com três "caixas".
function iconPng(size) {
  const px = Buffer.alloc(size * size * 4);
  const fill = (x0, y0, x1, y1, r, rgb, a = 1) => {
    for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
      const cx = Math.max(x0 + r - x - 0.5, 0, x + 0.5 - (x1 - r)), cy = Math.max(y0 + r - y - 0.5, 0, y + 0.5 - (y1 - r));
      if (cx * cx + cy * cy > r * r) continue;
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + rgb[k] * a);
      px[i + 3] = 255;
    }
  };
  const u = size / 32;
  fill(0, 0, size, size, 0, [25, 25, 23]);
  fill(7 * u, 9 * u, 15 * u, 15 * u, 1.5 * u, [255, 255, 255]);
  fill(17 * u, 9 * u, 25 * u, 15 * u, 1.5 * u, [103, 192, 143]);
  fill(7 * u, 17 * u, 25 * u, 23 * u, 1.5 * u, [255, 255, 255], 0.55);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
