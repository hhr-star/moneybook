// 生成弹窗预览页，方便截图检查
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, '..', 'MoneyBook.html'), 'utf8');

const names = { add: '记一笔', budget: '调预算', addcat: '新增分类' };
for (const [mode, label] of Object.entries(names)) {
  const script = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    MB.view.modal = '${mode}';
    MB.render();
  }, 80);
});
</script>`;
  const idx = html.lastIndexOf('</body>');
  writeFileSync(join(root, '..', '_preview-' + mode + '.html'),
    html.slice(0, idx) + script + html.slice(idx), 'utf8');
  console.log('已生成 _preview-' + mode + '.html（' + label + '）');
}
