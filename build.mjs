// 把 core.js / app.js / styles.css 内联进单文件 HTML
// 用法：node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(root, f), 'utf8');

const tpl = read('index.template.html');
const styles = read('styles.css');
const core = read('core.js');
const app = read('app.js');

// core.js 末尾有 module.exports，浏览器里会报错
const coreForBrowser = core.replace(
  /if \(typeof module !== 'undefined' && module\.exports\) module\.exports = Core;\s*$/,
  'window.Core = Core;'
);

const html = tpl
  .replace('/*__STYLES__*/', () => styles)
  .replace('/*__CORE__*/', () => coreForBrowser)
  .replace('/*__APP__*/', () => app);

const out = join(root, 'MoneyBook.html');
writeFileSync(out, html, 'utf8');
console.log('✅ 已生成：' + out);
console.log('   大小：' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
