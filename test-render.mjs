// 用最小 DOM 桩跑真实渲染，检查四个页面与弹窗是否报错 / 出现 undefined、NaN
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let html = '';
const appEl = {
  set innerHTML(v) { html = v; },
  get innerHTML() { return html; },
  addEventListener() {}
};

globalThis.document = {
  querySelector(sel) { return sel === '#app' ? appEl : null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return { style: {}, click() {}, appendChild() {}, remove() {}, setAttribute() {} }; },
  body: { appendChild() {} }
};
globalThis.window = globalThis;
globalThis.location = { hash: '' };
globalThis.addEventListener = function () {};
globalThis.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }
};
globalThis.confirm = () => true;

const Core = require('./core.js');
globalThis.Core = Core;
globalThis.window.Core = Core;

require('./app.js');

const MB = globalThis.MB;
const errors = [];
function check(cond, msg) { if (!cond) errors.push(msg); }

// ---- 四个页面 ----
const pages = [
  ['overview', ['本月预算', '花销占比', '近 6 个月', '最近记录', 'class="pie"', '<path d="M', 'kpi-row', '本月结余']],
  ['records', ['quickInput', '一句话记账', '记下', 'class="chip']],
  ['calendar', ['cal-grid', 'cal-cell', '本月合计', '有记录的天']],
  ['accounts', ['总资产', 'acc-row', 'open-add-transfer']],
  ['categories', ['分类与预算', 'data-act="cat-budget"', '新增分类']],
  ['settings', ['默认月预算', '导出 Excel', '备份 JSON', '清空全部数据', 'AI 智能记账', '存款目标']]
];

for (const [tab, needles] of pages) {
  MB.view.tab = tab;
  MB.view.modal = '';
  let err = null;
  try { MB.render(); } catch (e) { err = e; }
  check(!err, `页面 ${tab} 渲染抛错：${err && err.stack}`);
  if (err) continue;
  check(html.length > 2000, `页面 ${tab} 输出过短（${html.length}）`);
  for (const n of needles) check(html.includes(n), `页面 ${tab} 缺少「${n}」`);
  check(!/undefined/.test(html.replace(/undefined\s*;?\s*$/g, '')), `页面 ${tab} 出现了 undefined`);
  check(!/NaN/.test(html), `页面 ${tab} 出现了 NaN`);
}

// ---- 弹窗 ----
const modals = [
  ['add', ['id="fAmount"', 'id="fCat"', 'id="fDate"', 'id="fAcc"', '记一笔', 'data-act="form-type"']],
  ['edit', []],
  ['budget', ['id="fBudget"', '调整本月预算']],
  ['addcat', ['id="fCatName"', 'id="fCatColor"', '新增分类']],
  ['acc', ['id="fAccName"', 'id="fAccInit"']],
  ['snapshots', ['本地快照']]
];
MB.view.tab = 'overview';
for (const [m, needles] of modals) {
  MB.view.modal = m;
  MB.view.editingId = m === 'edit' ? 'demo_0' : null;
  let err = null;
  try { MB.render(); } catch (e) { err = e; }
  check(!err, `弹窗 ${m} 渲染抛错：${err && err.stack}`);
  if (!err) for (const n of needles) check(html.includes(n), `弹窗 ${m} 缺少「${n}」`);
}
MB.view.modal = '';

// ---- 空数据状态（清空后各种空视图） ----
const st = MB.state();
const backup = JSON.parse(JSON.stringify(st.records));
st.records = [];
for (const tab of ['overview', 'records']) {
  MB.view.tab = tab;
  let err = null;
  try { MB.render(); } catch (e) { err = e; }
  check(!err, `空数据 ${tab} 渲染抛错：${err && err.stack}`);
  if (!err) check(!/NaN/.test(html), `空数据 ${tab} 出现 NaN`);
}
check(html.includes('还没有记录') || html.includes('记第一笔'), '空数据没有给出引导');

// ---- 预算为 0、占比为 0 的边界 ----
st.settings.defaultMonthlyBudget = 0;
st.records = backup;
for (const m of ['2020-01', '2026-10']) {
  MB.view.month = m;
  MB.view.tab = 'overview';
  let err = null;
  try { MB.render(); } catch (e) { err = e; }
  check(!err, `月份 ${m} 渲染抛错：${err && err.stack}`);
  if (!err) check(!/NaN/.test(html), `月份 ${m} 出现 NaN`);
}

// ---- 恢复到演示数据，检查饼图扇区数与图例数一致 ----
st.settings.defaultMonthlyBudget = 3000;
MB.view.month = Core.ym(new Date());
MB.view.tab = 'overview';
MB.render();
const sliceCount = (html.match(/class="slice"/g) || []).length;
const legendCount = (html.match(/class="legend-item"/g) || []).length;
check(sliceCount > 0, '饼图没有扇区');
check(sliceCount === legendCount, `扇区数(${sliceCount}) 与图例数(${legendCount}) 不一致`);

const sum = Core.monthStats(st, MB.view.month).spent;
check(html.includes('¥' + Core.moneyShort(sum)), '总支出没显示在饼图中心');

if (errors.length === 0) {
  console.log('✅ 渲染自测全部通过');
  console.log(`   扇区 ${sliceCount} 个，本月合计 ¥${Core.money(sum)}`);
  process.exit(0);
} else {
  console.log('❌ 渲染自测失败 ' + errors.length + ' 项：');
  errors.forEach(e => console.log('   - ' + e));
  process.exit(1);
}
