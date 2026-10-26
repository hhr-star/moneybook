// 生成带日程提醒的预览页
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, '..', 'MoneyBook.html'), 'utf8');

const script = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    localStorage.removeItem('moneybook.alertDismissed');
    var t = Core.todayStr();
    var d3 = Core.ymd(new Date(Date.now() - 3 * 86400000));
    var d5 = Core.ymd(new Date(Date.now() + 5 * 86400000));
    var flat = function (s) { return s.replace(/-/g, ''); };
    var ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'SUMMARY:交房租 3000', 'DTSTART:' + flat(t) + 'T100000', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:和小李吃饭', 'DTSTART;VALUE=DATE:' + flat(t), 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:话费 99元', 'DTSTART;VALUE=DATE:' + flat(d3), 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:电影票 90', 'DTSTART;VALUE=DATE:' + flat(d5), 'END:VEVENT',
      'END:VCALENDAR'
    ].join('\\r\\n');
    MB.mergeEvents(Core.parseICS(ics, { limitDate: '2028-12-31' }));
    MB.view.month = Core.ym(t = new Date(t + 'T00:00:00'));
    MB.setTab('overview');
    MB.render();
  }, 120);
});
</script>`;

const idx = html.lastIndexOf('</body>');
writeFileSync(join(root, '..', '_preview-alert.html'), html.slice(0, idx) + script + html.slice(idx), 'utf8');
console.log('已生成 _preview-alert.html');
