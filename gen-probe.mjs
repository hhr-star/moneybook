// 探测浏览器能力（file:// 协议下）
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>probe</title></head><body>
<pre id="out">running</pre>
<script>
(function(){
  var r = {};
  r.origin = location.origin;
  r.protocol = location.protocol;
  r.isSecureContext = window.isSecureContext;
  r.showSaveFilePicker = typeof window.showSaveFilePicker;
  r.showDirectoryPicker = typeof window.showDirectoryPicker;
  r.showOpenFilePicker = typeof window.showOpenFilePicker;
  r.indexedDB = typeof window.indexedDB;
  r.storageEstimate = typeof (navigator.storage && navigator.storage.estimate);
  r.storagePersist = typeof (navigator.storage && navigator.storage.persist);
  r.localStorage = (function(){
    try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return 'ok'; }
    catch(e){ return 'blocked: ' + e.name; }
  })();
  var dbs = 'unknown';
  try { dbs = indexedDB ? 'available' : 'missing'; } catch(e){ dbs = 'error'; }
  r.idbCheck = dbs;
  document.getElementById('out').textContent = 'PROBE:' + JSON.stringify(r);
})();
</script></body></html>`;

writeFileSync(join(root, '..', '_probe.html'), html, 'utf8');
console.log('已生成 _probe.html');
