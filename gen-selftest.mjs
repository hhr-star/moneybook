// 生成端到端测试页：把自动化脚本注入到构建好的单文件 HTML 里
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'MoneyBook.html');
const html = readFileSync(src, 'utf8');

const script = `
<script>
(function () {
  window.confirm = function () { return true; };
  var out = { pass: [], fail: [] };
  function ok(cond, msg) { (cond ? out.pass : out.fail).push(msg); }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function quick(text) {
    q('#quickInput').value = text;
    q('[data-act="quick-add"]').click();
  }
  function run() {
    try {
      var st = MB.state();
      st.records = [];
      st.settings.monthBudgets = {};
      st.settings.defaultMonthlyBudget = 1000;
      MB.setTab('records');

      // 1. 快速记账：中文口语
      quick('午饭 25 微信');
      ok(st.records.length === 1, '记一笔后记录数=1，实际 ' + st.records.length);
      ok(st.records[0].amount === 25, '金额识别 25，实际 ' + st.records[0].amount);
      ok(st.records[0].pay === '微信', '支付方式识别微信，实际 ' + st.records[0].pay);
      var foodId = st.categories[0].id, funId = st.categories[1].id, studyId = st.categories[2].id;
      ok(st.records[0].categoryId === foodId, '「午饭」归到伙食');

      // 2. 再记几笔，覆盖不同分类
      quick('电影票 45');
      quick('买书 59元');
      quick('打车 18');
      ok(st.records.length === 4, '共 4 笔，实际 ' + st.records.length);
      ok(st.records[1].categoryId === funId, '「电影票」归到娱乐');
      ok(st.records[2].categoryId === studyId, '「买书」归到学习');
      ok(st.records[2].amount === 59, '「59元」金额 59，实际 ' + st.records[2].amount);

      // 3. 明细页渲染
      var rows = qa('.rec-row').length;
      ok(rows === 4, '明细页显示 4 行，实际 ' + rows);
      var totalText = q('.list-sum') ? q('.list-sum').textContent : '';
      ok(totalText.indexOf('147.00') >= 0, '合计 147.00 显示在明细页');

      // 4. 分类筛选
      MB.view.filterCat = funId;
      MB.render();
      var filtered = qa('.rec-row').length;
      ok(filtered === 1, '筛娱乐后显示 1 行，实际 ' + filtered);

      // 5. 总览：饼图与圆环
      MB.view.filterCat = '';
      MB.setTab('overview');
      var slices = qa('.slice').length, legends = qa('.legend-item').length;
      ok(slices === legends, '扇区数(' + slices + ') = 图例数(' + legends + ')');
      ok(slices === 4, '4 个分类各一个扇区，实际 ' + slices);
      ok(q('.pie-t1').textContent.indexOf('147') >= 0, '饼图中心显示 147');
      ok(q('.ring-num').textContent.indexOf('147') >= 0, '圆环中心显示 147');
      ok(q('.ring-pct').textContent === '15%', '预算 1000 花了 147 → 15%，实际 ' + q('.ring-pct').textContent);
      var pace = q('.pace');
      ok(pace && pace.className.indexOf('good') >= 0, '花费低于时间进度 → 绿色提示');

      // 6. 点击扇区跳转到该类明细（SVG 元素没有 click()，要派发事件）
      var sliceEl = q('.slice');
      sliceEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      ok(MB.view.tab === 'records', '点扇区后跳到明细页');
      ok(MB.view.filterCat !== '', '点扇区后带了分类筛选');

      // 7. 删除一条
      MB.view.filterCat = '';
      MB.render();
      var before = st.records.length;
      q('[data-act="del-rec"]').click();
      ok(st.records.length === before - 1, '删除后少一笔，' + before + ' → ' + st.records.length);

      // 8. 改预算
      MB.setTab('overview');
      q('[data-act="edit-budget"]').click();
      var fb = q('#fBudget');
      ok(!!fb, '预算弹窗打开');
      fb.value = '50';
      q('[data-act="save-month-budget"]').click();
      var ms = MB.state();
      var monthKey = Object.keys(ms.settings.monthBudgets)[0];
      ok(ms.settings.monthBudgets[monthKey] === 50, '本月预算改成 50');
      ok(q('.ring-pct').textContent === '244%', '剩 122 / 预算 50 = 244%，实际 ' + q('.ring-pct').textContent);
      ok(q('.ring-num').className.indexOf('over') >= 0, '超支时圆环变红');
      var warnPace = q('.pace');
      ok(warnPace && warnPace.className.indexOf('warn') >= 0, '超支显示橙色警示');

      // 9. 本地存储
      var saved = JSON.parse(localStorage.getItem('moneybook.v1'));
      ok(saved.records.length === 3, '已写入 localStorage，实际 ' + saved.records.length);
      var norm = Core.normalize(saved);
      ok(norm.records.length === 3, '重新载入后记录数保持');
      ok(norm.settings.monthBudgets[monthKey] === 50, '预算设置持久化');

      // 10. 日历视图
      MB.setTab('calendar');
      MB.render();
      ok(q('.cal-grid') !== null, '日历网格已渲染');
      var dayEl = q('.cal-cell.has-data');
      ok(dayEl !== null, '日历里能看到有花销的日子');
      dayEl.click();
      ok(MB.view.dayDetail !== '', '点某天弹出当天明细');
      MB.view.modal = '';
      MB.render();

      // 11. 导入日历日程（.ics），日期用当前月份的 20 号，避免和系统时间脱钩
      var nowYm = Core.ym(new Date());
      var evDay = nowYm + '-20';
      var icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:v1',
        'SUMMARY:视频会员 25元',
        'DTSTART;VALUE=DATE:' + evDay.replace(/-/g, ''),
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:r1',
        'SUMMARY:交房租 3000',
        'DTSTART;VALUE=DATE:20271205',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\\r\\n');
      var parsed = Core.parseICS(icsText, { limitDate: '2028-12-31' });
      ok(parsed.length === 2, '解析出 2 条日程，实际 ' + parsed.length);
      MB.mergeEvents(parsed);
      ok((MB.state().events || []).length === 2, '日程已保存，实际 ' + (MB.state().events || []).length);

      // 12. 日历上的日程圆点
      MB.setTab('calendar');
      MB.view.month = nowYm;
      MB.render();
      var dots = qa('.cal-dot').length;
      ok(dots === 1, '本月应有 1 个日程圆点，实际 ' + dots);

      // 13. 当天弹窗显示日程 + 一键记账
      MB.view.dayDetail = evDay;
      MB.view.modal = 'day';
      MB.render();
      ok(q('.ev-row') !== null, '当天弹窗里显示了日程');
      ok(q('.ev-row .ev-title').textContent.indexOf('视频会员') >= 0, '日程标题正确');
      var spendBtn = q('[data-act="spend-from-event"]');
      ok(spendBtn !== null, '带金额的日程有「记为支出」按钮');
      spendBtn.click();
      ok(q('#fAmount') !== null && q('#fAmount').value === '25', '预填金额 25，实际 ' + (q('#fAmount') && q('#fAmount').value));
      ok(q('#fItem').value.indexOf('视频会员') >= 0, '预填项目名');
      ok(q('#fDate').value === evDay, '预填日期，实际 ' + (q('#fDate') && q('#fDate').value));
      MB.view.modal = '';
      MB.render();

      // 14. 自动备份：删除前自动存快照，能恢复到删除前
      localStorage.removeItem('moneybook.snapshots');
      var st3 = MB.state();
      var cat0 = st3.categories[0].id;
      st3.records = [
        { id: 'bk1', date: '2026-10-01', categoryId: cat0, item: '备份测试A', amount: 11, pay: '' },
        { id: 'bk2', date: '2026-10-02', categoryId: cat0, item: '备份测试B', amount: 22, pay: '' }
      ];
      MB.setTab('records');
      MB.render();
      ok(MB.readSnaps().length === 0, '清空后快照数应为 0，实际 ' + MB.readSnaps().length);

      q('[data-act="del-rec"]').click();
      ok(MB.readSnaps().length === 1, '删除后应生成 1 份快照，实际 ' + MB.readSnaps().length);
      ok(MB.readSnaps()[0].n === 2, '快照里应是 2 笔，实际 ' + MB.readSnaps()[0].n);
      ok(MB.readSnaps()[0].reason === '删除一笔前', '快照原因应为「删除一笔前」，实际 ' + MB.readSnaps()[0].reason);
      ok(MB.state().records.length === 1, '删完应剩 1 笔，实际 ' + MB.state().records.length);

      // 打开快照列表并恢复到删除前那一份
      MB.setTab('settings');
      MB.render();
      var snapBtn = q('[data-act="open-snapshots"]');
      ok(snapBtn !== null, '设置页有「查看」快照按钮');
      snapBtn.click();
      ok(q('.snap-row') !== null, '快照弹窗里有记录');

      var targetTs = MB.readSnaps().filter(function (s) { return s.reason === '删除一笔前'; })[0].t;
      var targetBtn = qa('[data-act="restore-snapshot"]').filter(function (b) {
        return +b.getAttribute('data-ts') === targetTs;
      })[0];
      ok(targetBtn !== undefined, '找到删除前那份快照的恢复按钮');
      targetBtn.click();
      ok(MB.state().records.length === 2, '恢复后应回到 2 笔，实际 ' + MB.state().records.length);
      ok(MB.readSnaps().length >= 2, '恢复前应自动再存一份快照');

      // 15. 日程提醒
      localStorage.removeItem('moneybook.alertDismissed');
      var tstr = Core.todayStr();
      var s5 = MB.state();
      s5.records = [];
      var evToday = Core.parseICS([
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT', 'SUMMARY:交房租 3000', 'DTSTART;VALUE=DATE:' + tstr.replace(/-/g, ''), 'END:VEVENT',
        'END:VCALENDAR'
      ].join('\\r\\n'), { limitDate: '2028-12-31' });
      MB.mergeEvents(evToday);
      MB.setTab('overview');
      MB.render();
      ok(q('.banner.alert') !== null, '有今天的日程时出现提醒条');
      ok(q('.banner.alert').textContent.indexOf('今天有 1 个日程') >= 0, '提醒条显示今天日程数');
      ok(q('.alert-item') !== null && q('.alert-item').textContent.indexOf('交房租') >= 0, '提醒条列出日程标题');
      var alertBtn = q('.alert-item [data-act="spend-from-event"]');
      ok(alertBtn !== null, '带金额的日程有「记 ¥3000」按钮');
      alertBtn.click();
      ok(q('#fAmount') !== null && q('#fAmount').value === '3000', '提醒条点记账会预填金额，实际 ' + (q('#fAmount') && q('#fAmount').value));
      q('[data-act="save-rec"]').click();
      ok(MB.state().records.length === 1, '从提醒条记账成功');
      MB.setTab('overview');
      MB.render();
      ok(q('.alert-done') !== null, '记完之后提醒条显示「已记」');

      // 关闭提醒
      q('[data-act="dismiss-alert"]').click();
      ok(q('.banner.alert') === null, '点 × 后提醒条消失');
      localStorage.removeItem('moneybook.alertDismissed');

      // 逾期未记提醒
      var d3s = Core.ymd(new Date(Date.now() - 3 * 86400000));
      var evOver = Core.parseICS([
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT', 'SUMMARY:话费 99元', 'DTSTART;VALUE=DATE:' + d3s.replace(/-/g, ''), 'END:VEVENT',
        'END:VCALENDAR'
      ].join('\\r\\n'), { limitDate: '2028-12-31' });
      MB.mergeEvents(evOver);
      MB.setTab('overview');
      MB.render();
      ok(q('.banner.alert') !== null && q('.banner.alert').textContent.indexOf('还没记') >= 0,
        '过了日期还没记的日程会提醒');

      // 16. 收入 / 账户 / 转账
      var s6 = MB.state();
      s6.records = [];
      MB.setTab('records');
      MB.render();

      q('#quickInput').value = '发工资 8000';
      q('[data-act="quick-add"]').click();
      var incRec = MB.state().records[0];
      ok(incRec && incRec.type === 'income', '「发工资」应记成收入，实际 ' + (incRec && incRec.type));
      ok(incRec && incRec.amount === 8000, '收入金额 8000');
      ok(incRec && incRec.categoryId === 'inc_salary', '归到工资分类');

      q('#quickInput').value = '午饭 30 微信';
      q('[data-act="quick-add"]').click();
      ok(MB.state().records.length === 2, '共 2 笔，实际 ' + MB.state().records.length);

      // 总览 KPI
      MB.setTab('overview');
      MB.render();
      ok(q('.kpi-row') !== null, '总览有收支 KPI 行');
      var kpiText = qa('.kpi-value').map(function (e) { return e.textContent; }).join('|');
      ok(kpiText.indexOf('8,000') >= 0, 'KPI 里显示收入 8000，实际 ' + kpiText);
      ok(kpiText.indexOf('7,970') >= 0, 'KPI 里显示结余 7970，实际 ' + kpiText);

      // 账户页
      MB.setTab('accounts');
      MB.render();
      ok(q('.acc-row') !== null, '账户页渲染出账户');
      var accTotal = q('.acc-total b').textContent;
      ok(accTotal.indexOf('7,970') >= 0, '总资产应为 7970，实际 ' + accTotal);

      // 转账
      q('[data-act="open-add-transfer"]').click();
      ok(q('#fFrom') !== null && q('#fTo') !== null, '转账弹窗有转出/转入');
      q('#fAmount').value = '500';
      q('#fFrom').value = 'acc_wechat';
      q('#fTo').value = 'acc_bank';
      q('[data-act="save-rec"]').click();
      var tr = MB.state().records.filter(function (r) { return r.type === 'transfer'; })[0];
      ok(!!tr, '转账记录已保存');
      ok(tr && tr.amount === 500, '转账金额 500');
      ok(tr && tr.accountId === 'acc_wechat' && tr.toAccountId === 'acc_bank', '转账方向正确');
      var accTotal2 = (function () { MB.setTab('accounts'); MB.render(); return q('.acc-total b').textContent; })();
      ok(accTotal2.indexOf('7,970') >= 0, '转账后总资产不变，实际 ' + accTotal2);

      // 收入筛选
      MB.setTab('records');
      MB.view.filterCat = '__income';
      MB.render();
      ok(qa('.rec-row').length === 1, '筛「收入」只剩 1 条，实际 ' + qa('.rec-row').length);
      MB.view.filterCat = '';

      // 17. 记账弹窗类型切换
      MB.setTab('records');
      MB.render();
      q('[data-act="open-add"]').click();
      ok(q('.seg') !== null, '记账弹窗有支出/收入/转账切换');
      ok(q('.seg').getAttribute('data-ftype') === 'expense', '默认是支出');
      var incomeSeg = qa('[data-act="form-type"]').filter(function (b) { return b.getAttribute('data-type') === 'income'; })[0];
      incomeSeg.click();
      ok(q('.seg').getAttribute('data-ftype') === 'income', '切换后变成收入');
      ok(q('#fIncCat') !== null, '出现收入分类下拉');
      ok(q('#fIncCat').closest('.field').style.display !== 'none', '收入分类可见');
      ok(q('#fCat').closest('.field').style.display === 'none', '支出分类已隐藏');
      MB.view.modal = '';
      MB.render();

      // 18. 账户归属：没说支付方式时跟随上次用的账户
      var s7 = MB.state();
      s7.records = [];
      s7.settings.lastAccountId = '';
      s7.settings.defaultAccountId = '';
      MB.setTab('records');
      MB.render();

      q('#quickInput').value = '打车 18 微信';
      q('[data-act="quick-add"]').click();
      var r1 = MB.state().records[0];
      ok(r1 && r1.accountId === 'acc_wechat', '说了微信应记到微信，实际 ' + (r1 && r1.accountId));
      ok(MB.state().settings.lastAccountId === 'acc_wechat', '应记住上次用的账户');

      q('#quickInput').value = '地铁 6';
      q('[data-act="quick-add"]').click();
      var r2 = MB.state().records[1];
      ok(r2 && r2.accountId === 'acc_wechat', '没说支付方式应跟随上次的微信，实际 ' + (r2 && r2.accountId));

      q('#quickInput').value = '午饭 30 支付宝';
      q('[data-act="quick-add"]').click();
      var r3 = MB.state().records[2];
      ok(r3 && r3.accountId === 'acc_alipay', '说了支付宝应记到支付宝，实际 ' + (r3 && r3.accountId));

      q('#quickInput').value = '买水 3';
      q('[data-act="quick-add"]').click();
      var r4 = MB.state().records[3];
      ok(r4 && r4.accountId === 'acc_alipay', '应跟随上一次的支付宝，实际 ' + (r4 && r4.accountId));

      // 设了默认账户后优先用默认账户
      s7.settings.defaultAccountId = 'acc_bank';
      q('#quickInput').value = '话费 50';
      q('[data-act="quick-add"]').click();
      var r5 = MB.state().records[4];
      ok(r5 && r5.accountId === 'acc_bank', '设了默认账户应优先用它，实际 ' + (r5 && r5.accountId));
      s7.settings.defaultAccountId = '';

      // 19. 批量转移账户
      MB.setTab('accounts');
      MB.render();
      var fixBtn = q('[data-act="fix-acc"]');
      ok(fixBtn !== null, '账户页有批量转移按钮');
      MB.view.fixAccId = 'acc_alipay';
      MB.view.modal = 'fixacc';
      MB.render();
      ok(q('#fFixTo') !== null, '批量转移弹窗打开');
      q('#fFixTo').value = 'acc_wechat';
      q('[data-act="do-fix-acc"]').click();
      var moved = MB.state().records.filter(function (r) { return r.accountId === 'acc_alipay'; }).length;
      ok(moved === 0, '支付宝下的记录应全部转走，剩余 ' + moved);
      var wechatCount = MB.state().records.filter(function (r) { return r.accountId === 'acc_wechat'; }).length;
      ok(wechatCount === 4, '微信应有 4 笔，实际 ' + wechatCount);

      // 20. 快速记账区手动选账户
      var s8 = MB.state();
      s8.records = [];
      s8.settings.lastAccountId = '';
      s8.settings.defaultAccountId = '';
      MB.setTab('records');
      MB.view.quickAccountId = '';
      MB.render();

      var accChips = qa('.quick-acc-chip');
      ok(accChips.length >= 4, '快速记账区有账户选项，实际 ' + accChips.length);
      var bankChip = accChips.filter(function (b) { return b.getAttribute('data-id') === 'acc_bank'; })[0];
      ok(bankChip !== undefined, '有银行卡选项');
      bankChip.click();
      ok(MB.view.quickAccountId === 'acc_bank', '点了银行卡应选中它');
      ok(q('.quick-acc-chip.on').getAttribute('data-id') === 'acc_bank', '高亮切换正确');

      q('#quickInput').value = '午饭 25';
      q('[data-act="quick-add"]').click();
      var q1 = MB.state().records[0];
      ok(q1 && q1.accountId === 'acc_bank', '没说支付方式时应记到手动选的银行卡，实际 ' + (q1 && q1.accountId));

      // 句子里说了支付方式，以说的为准
      q('#quickInput').value = '打车 18 支付宝';
      q('[data-act="quick-add"]').click();
      var q2 = MB.state().records[1];
      ok(q2 && q2.accountId === 'acc_alipay', '句子里说了支付宝应记到支付宝，实际 ' + (q2 && q2.accountId));

      // 21. 单笔记录点账户名换账户
      MB.setTab('records');
      MB.render();
      var accLink = q('[data-act="change-acc"]');
      ok(accLink !== null, '记录行里账户名可点击');
      accLink.click();
      ok(q('.acc-pick') !== null, '换账户弹窗打开');
      var pickBtns = qa('.acc-pick-btn');
      var wechatPick = pickBtns.filter(function (b) { return b.getAttribute('data-id') === 'acc_wechat'; })[0];
      ok(wechatPick !== undefined, '弹窗列出所有账户');
      wechatPick.click();
      var changed = MB.state().records[0];
      ok(changed.accountId === 'acc_wechat', '点微信后该笔记录应改到微信，实际 ' + changed.accountId);

      // 22. 空数据渲染
      st.records = [];
      MB.setTab('overview');
      ok(q('.empty') !== null, '空数据时显示引导');
      var appHtml = q('#app').innerHTML;
      var nanAt = appHtml.indexOf('NaN');
      ok(nanAt < 0, '空数据页面无 NaN' + (nanAt >= 0 ? '：' + appHtml.slice(Math.max(0, nanAt - 120), nanAt + 40) : ''));
      var undefAt = appHtml.indexOf('undefined');
      ok(undefAt < 0, '空数据页面无 undefined' + (undefAt >= 0 ? '：' + appHtml.slice(Math.max(0, undefAt - 120), undefAt + 40) : ''));

    } catch (e) {
      out.fail.push('运行异常：' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]);
    }

    // ---------- 异步：AI 记账整条链路（打本地 mock 服务）----------
    var aiDone = function () {
      var pre = document.createElement('pre');
      pre.id = '__out__';
      pre.textContent = 'RESULT:' + JSON.stringify(out);
      document.body.appendChild(pre);
    };

    var aiBase = (window.__AI_MOCK__ || '');
    if (!aiBase) { aiDone(); return; }

    var s9 = MB.state();
    s9.ai = { baseUrl: aiBase, model: 'mock', key: 'test-key' };

    MB.aiParse('和小李 AA 我先垫的 180')
      .then(function (r) {
        ok(r.type === 'expense', 'AI 解析：类型应为支出，实际 ' + r.type);
        ok(r.amount === 180, 'AI 解析：金额 180，实际 ' + r.amount);
        ok(r.categoryId === 'cat_food', 'AI 解析：「伙食」应映射到 cat_food，实际 ' + r.categoryId);
        ok(r.accountId === 'acc_wechat', 'AI 解析：账户「微信」应映射到 acc_wechat，实际 ' + r.accountId);
        ok(r.item.indexOf('AA') >= 0, 'AI 解析：项目名保留了 ' + r.item);
        ok(/^\\d{4}-\\d{2}-\\d{2}$/.test(r.date), 'AI 解析：日期格式正确 ' + r.date);
        return MB.aiParse('发工资 8000');
      })
      .then(function (r2) {
        ok(r2.type === 'income', 'AI 解析工资：应为收入，实际 ' + r2.type);
        ok(r2.categoryId === 'inc_salary', 'AI 解析工资：应映射到 inc_salary，实际 ' + r2.categoryId);
        // 返回不是 JSON 时应报错，而不是静默成功
        return MB.aiParse('乱说一句').then(function () {
          ok(false, 'AI 返回非 JSON 时应报错');
        }, function (e) {
          ok(true, 'AI 返回非 JSON 时正确报错：' + e.message);
        });
      })
      .then(function () {
        // key 错误时的提示
        s9.ai.key = 'bad-key';
        return MB.aiParse('午饭 25').then(function () {
          ok(false, 'key 错误时应该失败');
        }, function (e) {
          ok(/Key 不对|401/.test(e.message), 'key 错误提示清晰：' + e.message);
        });
      })
      .then(function () { aiDone(); })
      .catch(function (e) {
        out.fail.push('AI 链路异常：' + e.message);
        aiDone();
      });
  }
  if (document.readyState === 'complete') setTimeout(run, 60);
  else window.addEventListener('load', function () { setTimeout(run, 60); });
})();
</script>
`;

// 注意：页面自身代码里含有 "</body>" 字符串，必须从末尾定位真正的 body 结束标签
const closeIdx = html.lastIndexOf('</body>');
if (closeIdx < 0) throw new Error('找不到 </body>');

// 需要测 AI 链路时，用环境变量 AI_MOCK 指定本地 mock 服务地址
const mockUrl = process.env.AI_MOCK || '';
const mockScript = '<script>window.__AI_MOCK__ = ' + JSON.stringify(mockUrl) + ';</script>\n';

const out = html.slice(0, closeIdx) + mockScript + script + html.slice(closeIdx);

writeFileSync(join(root, '_selftest.html'), out, 'utf8');
console.log('已生成 _selftest.html' + (mockUrl ? '（AI mock: ' + mockUrl + '）' : ''));
