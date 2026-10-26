// 把 core.js / app.js / styles.css 内联进单文件 HTML
// 用法：node build.mjs
//
// 产出：
//   MoneyBook.html  纯净单文件（给下载 / 本地双击用）
//   index.html      同一份内容 + PWA 引用（给 GitHub Pages 用）
//   sw.js           Service Worker，缓存版本号跟着内容变
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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

function assemble(pwaBlock) {
  return tpl
    .replace('<!--__PWA__-->', () => pwaBlock)
    .replace('/*__STYLES__*/', () => styles)
    .replace('/*__CORE__*/', () => coreForBrowser)
    .replace('/*__APP__*/', () => app);
}

// ---------- 纯净版 ----------
const plain = assemble('');
writeFileSync(join(root, 'MoneyBook.html'), plain, 'utf8');

// ---------- PWA 版 ----------
const pwaBlock = `<link rel="manifest" href="./manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="./icon-192.png">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="记账本">
<script>
/* 离线缓存：只在 http(s) 下注册，file:// 打开时会自动跳过 */
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* 离线缓存不可用不影响使用 */ });
  });
}
</script>`;

const withPwa = assemble(pwaBlock);
writeFileSync(join(root, 'index.html'), withPwa, 'utf8');

// ---------- Service Worker ----------
const hash = createHash('sha256').update(withPwa).digest('hex').slice(0, 12);
const sw = `/* 记账本 Service Worker —— 由 build.mjs 生成，请勿手改 */
const CACHE = 'moneybook-${hash}';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
`;
writeFileSync(join(root, 'sw.js'), sw, 'utf8');

console.log('✅ MoneyBook.html（纯净单文件）');
console.log('✅ index.html（PWA 版，GitHub Pages 用）');
console.log('✅ sw.js（缓存版本 moneybook-' + hash + '）');
console.log('   大小：' + (Buffer.byteLength(withPwa) / 1024).toFixed(1) + ' KB');
