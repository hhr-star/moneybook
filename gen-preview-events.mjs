// 生成带日程的预览页，用于截图检查
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, '..', 'MoneyBook.html'), 'utf8');

const script = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var ym = Core.ym(new Date());
    var ymd = ym.replace(/-/g, '');
    var ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'SUMMARY:交房租 3000', 'DTSTART;VALUE=DATE:' + ymd + '05', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:和小李吃饭 120', 'DTSTART;VALUE=DATE:' + ymd + '20', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:健身房', 'DTSTART;VALUE=DATE:' + ymd + '12', 'END:VEVENT',
      'END:VCALENDAR'
    ].join('\\r\\n');
    MB.mergeEvents(Core.parseICS(ics, { limitDate: '2028-12-31' }));
    MB.view.month = ym;
    MB.setTab('calendar');
    MB.view.modal = 'day';
    MB.view.dayDetail = ym + '-20';
    MB.render();
  }, 120);
});
</script>`;

const idx = html.lastIndexOf('</body>');
writeFileSync(join(root, '..', '_preview-events.html'), html.slice(0, idx) + script + html.slice(idx), 'utf8');
console.log('已生成 _preview-events.html');
