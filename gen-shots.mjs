// 生成视频用的截图页面（在页面渲染完后注入状态）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const outDir = join(root, '_shots');
mkdirSync(outDir, { recursive: true });

function build(name, js) {
  const script = `
<style>
  /* 视频素材里不显示「示例数据」提示条，看起来更像真实在用 */
  #app .banner.info { display: none !important; }
</style>
<script>
window.addEventListener('load', function () {
  var tries = 0;
  (function go() {
    tries++;
    if (!window.MB || !document.querySelector('#app').children.length) {
      if (tries < 80) return setTimeout(go, 50);
      return;
    }
    try { ${js} } catch (e) { console.error(e); }
  })();
});
</script>`;
  const idx = html.lastIndexOf('</body>');
  writeFileSync(join(outDir, name + '.html'), html.slice(0, idx) + script + html.slice(idx), 'utf8');
}

// 1. 总览（正常预算 3000，绿环）
build('overview', `
  MB.view.month = Core.ym(new Date());
  MB.setTab('overview');
  MB.render();
`);

// 2. 总览（超支，红环）
build('over', `
  var st = MB.state();
  st.settings.monthBudgets = {};
  st.settings.monthBudgets[Core.ym(new Date())] = 1200;
  MB.view.month = Core.ym(new Date());
  MB.setTab('overview');
  MB.render();
`);

// 3. 明细（输入框里有内容，提示已解析）
build('records', `
  MB.view.quickText = '午饭 25 微信';
  MB.setTab('records');
  MB.render();
  var i = document.querySelector('#quickInput');
  if (i) { i.value = '午饭 25 微信'; i.dispatchEvent(new Event('input')); }
`);

// 4. 日历
build('calendar', `
  MB.setTab('calendar');
  MB.render();
`);

// 5. 账户
build('accounts', `
  var st = MB.state();
  st.accounts.forEach(function (a) { a.initBalance = a.id === 'acc_bank' ? 5000 : (a.id === 'acc_alipay' ? 1200 : 0); });
  MB.setTab('accounts');
  MB.render();
`);

// 6. 只显示「花销占比」卡片（视频里做饼图特写）
build('pie', `
  MB.setTab('overview');
  MB.render();
  setTimeout(function () {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:#f4f6fb;z-index:60;display:flex;align-items:center;padding:0 0 180px;overflow:hidden';
    var cards = document.querySelectorAll('.content .card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].querySelector('.pie')) {
        var c = cards[i].cloneNode(true);
        c.style.width = '100%';
        c.style.margin = '0';
        wrap.appendChild(c);
        break;
      }
    }
    document.body.appendChild(wrap);
  }, 300);
`);

// 7. 只显示「本月预算」卡片（超支红环）
build('budget', `
  var st = MB.state();
  st.settings.monthBudgets = {};
  st.settings.monthBudgets[Core.ym(new Date())] = 1200;
  MB.setTab('overview');
  MB.render();
  setTimeout(function () {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:#f4f6fb;z-index:60;display:flex;align-items:center;padding:0 0 160px;overflow:hidden';
    var cards = document.querySelectorAll('.content .card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].querySelector('.ring')) {
        var c = cards[i].cloneNode(true);
        c.style.width = '100%';
        c.style.margin = '0';
        wrap.appendChild(c);
        break;
      }
    }
    document.body.appendChild(wrap);
  }, 300);
`);

console.log('已生成 7 个截图页面');
