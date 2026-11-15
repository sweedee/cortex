// Regenerates build/icon.png (1024) and build/icon.ico from build/icon.svg using Electron itself:
//   npx electron scripts/make-icons.cjs
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const build = join(__dirname, '..', 'build');
const svg = readFileSync(join(build, 'icon.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = 6 + 16 * i;
    head[o] = size >= 256 ? 0 : size;
    head[o + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(buf.length, o + 8);
    head.writeUInt32LE(off, o + 12);
    off += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
}

async function render(size) {
  const win = new BrowserWindow({ show: false, width: size, height: size, useContentSize: true, transparent: true, frame: false });
  const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  return img.getSize().width === size ? img.toPNG() : img.resize({ width: size, height: size, quality: 'best' }).toPNG();
}


(async () => {
await app.whenReady();
const master = await render(1024); // one render; smaller sizes are scaled from it
writeFileSync(join(build, 'icon.png'), master);
const pngs = [];
const big = nativeImage.createFromBuffer(master);
for (const size of SIZES) pngs.push({ size, buf: big.resize({ width: size, height: size, quality: 'best' }).toPNG() });
writeFileSync(join(build, 'icon.ico'), ico(pngs));
console.log('wrote icon.png, icon.ico');
app.quit();
})();
