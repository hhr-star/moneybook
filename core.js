/* ================= 记账本 · 核心逻辑（纯函数，可在 Node 里自测） ================= */
var Core = (function () {
  'use strict';

  /* ---------- 工具 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ym(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function ymd(d) { return ym(d) + '-' + pad(d.getDate()); }
  function parseYM(s) { var p = String(s).split('-'); return { y: +p[0], m: +p[1] }; }
  function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
  function todayStr() { return ymd(new Date()); }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function moneyShort(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万';
    return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }
  function monthLabel(m) { var p = m.split('-'); return (+p[0]) + '年' + (+p[1]) + '月'; }
  function addMonths(m, k) {
    var p = parseYM(m);
    var d = new Date(p.y, p.m - 1 + k, 1);
    return ym(d);
  }
  function monthRange(m) {
    var p = parseYM(m);
    return { start: m + '-01', end: m + '-' + pad(daysInMonth(p.y, p.m)) };
  }

  /* ---------- 默认数据 ---------- */
  var DEFAULT_CATEGORIES = [
    { id: 'cat_food',   name: '伙食', color: '#FF8A3D', budget: 0 },
    { id: 'cat_fun',    name: '娱乐', color: '#8E7CFF', budget: 0 },
    { id: 'cat_study',  name: '学习', color: '#2F80ED', budget: 0 },
    { id: 'cat_traffic',name: '交通', color: '#16B8A6', budget: 0 },
    { id: 'cat_daily',  name: '日用', color: '#22B573', budget: 0 },
    { id: 'cat_home',   name: '居住', color: '#C4763C', budget: 0 },
    { id: 'cat_health', name: '医疗', color: '#FF6B8B', budget: 0 },
    { id: 'cat_social', name: '人情', color: '#E8B44A', budget: 0 },
    { id: 'cat_other',  name: '其他', color: '#98A2B3', budget: 0 }
  ];

  var DEFAULT_ACCOUNTS = [
    { id: 'acc_cash',   name: '现金',   color: '#8FA3BF', initBalance: 0 },
    { id: 'acc_wechat', name: '微信',   color: '#22C55E', initBalance: 0 },
    { id: 'acc_alipay', name: '支付宝', color: '#2E9BFF', initBalance: 0 },
    { id: 'acc_bank',   name: '银行卡', color: '#F59E0B', initBalance: 0 }
  ];

  var DEFAULT_INCOME_CATS = [
    { id: 'inc_salary', name: '工资',     color: '#16A34A' },
    { id: 'inc_bonus',  name: '奖金',     color: '#22C55E' },
    { id: 'inc_part',   name: '兼职',     color: '#4ADE80' },
    { id: 'inc_gift',   name: '红包',     color: '#F87171' },
    { id: 'inc_refund', name: '退款',     color: '#FBBF24' },
    { id: 'inc_other',  name: '其他收入', color: '#94A3B8' }
  ];

  // 老数据没有 type 字段，一律当支出
  function recType(r) { return (r && r.type) || 'expense'; }

  // 老的「支付方式」推断成账户
  function accountFromPay(pay, accounts) {
    var has = function (id) { return accounts.some(function (a) { return a.id === id; }); };
    var p = String(pay || '');
    if (p.indexOf('微信') >= 0 && has('acc_wechat')) return 'acc_wechat';
    if (p.indexOf('支付宝') >= 0 && has('acc_alipay')) return 'acc_alipay';
    if ((p.indexOf('银行') >= 0 || p.indexOf('花呗') >= 0 || p.indexOf('白条') >= 0) && has('acc_bank')) return 'acc_bank';
    if (p.indexOf('现金') >= 0 && has('acc_cash')) return 'acc_cash';
    return accounts.length ? accounts[0].id : '';
  }

  var EMPTY_STATE = function () {
    return {
      version: 2,
      settings: { userId: '', defaultMonthlyBudget: 3000, savingsGoal: 0 },
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      incomeCategories: JSON.parse(JSON.stringify(DEFAULT_INCOME_CATS)),
      accounts: JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS)),
      records: [],
      events: [],
      ai: { provider: 'deepseek', key: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', enabled: false }
    };
  };

  function normalize(state) {
    var s = EMPTY_STATE();
    if (!state || typeof state !== 'object') return s;

    if (state.settings) s.settings = Object.assign(s.settings, state.settings);
    if (Array.isArray(state.categories) && state.categories.length) s.categories = state.categories;
    if (Array.isArray(state.incomeCategories) && state.incomeCategories.length) {
      s.incomeCategories = state.incomeCategories;
    }
    if (Array.isArray(state.accounts) && state.accounts.length) {
      s.accounts = state.accounts.filter(function (a) { return a && a.id && a.name; })
        .map(function (a) {
          return {
            id: a.id,
            name: String(a.name).slice(0, 12),
            color: a.color || '#8FA3BF',
            initBalance: round2(+a.initBalance || 0)
          };
        });
    }
    if (Array.isArray(state.records)) s.records = state.records;
    if (state.ai) s.ai = Object.assign(s.ai, state.ai);

    // 保证每条记录字段完整
    s.records = s.records
      .filter(function (r) { return r && r.date && !isNaN(+r.amount); })
      .map(function (r) {
        var type = recType(r);
        var acc = r.accountId || accountFromPay(r.pay, s.accounts);
        return {
          id: r.id || uid('rec'),
          type: type,
          date: r.date,
          categoryId: r.categoryId || (type === 'income' ? 'inc_other' : 'cat_other'),
          accountId: type === 'transfer' ? (r.accountId || '') : acc,
          toAccountId: type === 'transfer' ? (r.toAccountId || '') : '',
          item: r.item || '',
          amount: round2(Math.abs(+r.amount)),
          pay: r.pay || '',
          note: r.note || '',
          createdAt: r.createdAt || 0
        };
      });

    if (Array.isArray(state.events)) {
      s.events = state.events.filter(function (e) { return e && e.date; }).map(function (e) {
        return {
          id: e.id || uid('ev'),
          date: String(e.date).slice(0, 10),
          time: e.time || '',
          allDay: !!e.allDay,
          summary: String(e.summary || '未命名日程').slice(0, 80),
          location: String(e.location || '').slice(0, 60),
          description: '',
          amount: typeof e.amount === 'number' ? e.amount : null,
          source: e.source || 'ics'
        };
      });
    }
    return s;
  }

  /* ---------- 查询 ---------- */
  function monthBudget(state, month) {
    var ov = state.settings.monthBudgets || {};
    if (ov[month] !== undefined && ov[month] !== null && ov[month] !== '') return +ov[month];
    var sum = (state.categories || []).reduce(function (a, c) { return a + (+c.budget || 0); }, 0);
    if (sum > 0) return sum;
    return +(state.settings.defaultMonthlyBudget || 0);
  }

  function recordsOf(state, month) {
    return (state.records || []).filter(function (r) { return r.date.slice(0, 7) === month; });
  }

  function catBudgetTotal(state) {
    return (state.categories || []).reduce(function (a, c) { return a + (+c.budget || 0); }, 0);
  }

  /* ---------- 月度统计（核心） ---------- */
  function monthStats(state, month) {
    var p = parseYM(month);
    var total = daysInMonth(p.y, p.m);
    var recs = recordsOf(state, month);

    var budget = monthBudget(state, month);
    var expenseRecs = recs.filter(function (r) { return recType(r) === 'expense'; });
    var incomeRecs = recs.filter(function (r) { return recType(r) === 'income'; });

    var spent = expenseRecs.reduce(function (a, r) { return a + (+r.amount || 0); }, 0);
    var income = incomeRecs.reduce(function (a, r) { return a + (+r.amount || 0); }, 0);
    var savings = income - spent;

    var cats = (state.categories || []).map(function (c) {
      var rows = expenseRecs.filter(function (r) { return r.categoryId === c.id; });
      var amount = rows.reduce(function (a, r) { return a + (+r.amount || 0); }, 0);
      return {
        id: c.id, name: c.name, color: c.color,
        budget: +c.budget || 0,
        amount: round2(amount),
        count: rows.length,
        ratio: spent > 0 ? amount / spent : 0,
        budgetRatio: (+c.budget || 0) > 0 ? amount / (+c.budget) : null
      };
    });
    // 有花费却没有在分类表里找到的，归入“未分类”
    var unknown = expenseRecs.filter(function (r) {
      return !(state.categories || []).some(function (c) { return c.id === r.categoryId; });
    });
    if (unknown.length) {
      var ua = unknown.reduce(function (a, r) { return a + (+r.amount || 0); }, 0);
      cats.push({
        id: '__unknown', name: '未分类', color: '#B0B7C3', budget: 0,
        amount: round2(ua), count: unknown.length,
        ratio: spent > 0 ? ua / spent : 0, budgetRatio: null
      });
    }

    var incomeCats = (state.incomeCategories || []).map(function (c) {
      var rows = incomeRecs.filter(function (r) { return r.categoryId === c.id; });
      var amount = rows.reduce(function (a, r) { return a + (+r.amount || 0); }, 0);
      return {
        id: c.id, name: c.name, color: c.color,
        amount: round2(amount),
        count: rows.length,
        ratio: income > 0 ? amount / income : 0
      };
    }).filter(function (c) { return c.amount > 0; });

    var now = new Date();
    var isThisMonth = ym(now) === month;
    var nowDay = isThisMonth ? now.getDate() : total;
    var elapsed = isThisMonth ? clamp(now.getDate(), 0, total) : total;

    var today = expenseRecs.reduce(function (a, r) { return a + (r.date === todayStr() ? +r.amount : 0); }, 0);
    var byDay = [];
    for (var d = 1; d <= total; d++) {
      var ds = month + '-' + pad(d);
      byDay.push(expenseRecs.reduce(function (a, r) { return a + (r.date === ds ? +r.amount : 0); }, 0));
    }

    var remaining = budget > 0 ? budget - spent : null;
    var ideal = budget > 0 ? budget * elapsed / total : null;
    var avgPerDay = elapsed > 0 ? spent / elapsed : 0;
    var remainDays = Math.max(0, total - elapsed) + (isThisMonth ? 1 : 0);
    var dailyAllow = null, forecast = null;
    if (budget > 0) {
      dailyAllow = remainDays > 0 ? Math.max(0, remaining) / remainDays : 0;
      forecast = isThisMonth ? avgPerDay * total : spent;
    }

    return {
      month: month,
      label: monthLabel(month),
      total, elapsed, isThisMonth,
      budget: round2(budget),
      spent: round2(spent),
      income: round2(income),
      savings: round2(savings),
      savingsRate: income > 0 ? savings / income : null,
      usedRatio: budget > 0 ? spent / budget : null,
      remaining: remaining === null ? null : round2(remaining),
      ideal: ideal === null ? null : round2(ideal),
      avgPerDay: round2(avgPerDay),
      dailyAllow: dailyAllow === null ? null : round2(dailyAllow),
      forecast: forecast === null ? null : round2(forecast),
      overForecast: budget > 0 && forecast !== null ? forecast - budget : null,
      today: round2(today),
      count: expenseRecs.length,
      incomeCount: incomeRecs.length,
      totalCount: recs.length,
      remainingDays: Math.max(0, total - nowDay) + (isThisMonth ? 1 : 0),
      categories: cats,
      incomeCategories: incomeCats,
      byDay: byDay,
      records: recs.slice()
    };
  }

  /* ---------- 账户余额 ---------- */
  function accountBalances(state, month) {
    var bal = {}, flow = {};
    (state.accounts || []).forEach(function (a) {
      bal[a.id] = round2(+a.initBalance || 0);
      flow[a.id] = 0;
    });
    (state.records || []).forEach(function (r) {
      var amt = +r.amount || 0;
      if (month && r.date.slice(0, 7) !== month) return;
      var t = recType(r);
      if (t === 'income') {
        if (bal[r.accountId] !== undefined) { bal[r.accountId] = round2(bal[r.accountId] + amt); flow[r.accountId] = round2(flow[r.accountId] + amt); }
      } else if (t === 'expense') {
        if (bal[r.accountId] !== undefined) { bal[r.accountId] = round2(bal[r.accountId] - amt); flow[r.accountId] = round2(flow[r.accountId] - amt); }
      } else if (t === 'transfer') {
        if (bal[r.accountId] !== undefined) { bal[r.accountId] = round2(bal[r.accountId] - amt); flow[r.accountId] = round2(flow[r.accountId] - amt); }
        if (bal[r.toAccountId] !== undefined) { bal[r.toAccountId] = round2(bal[r.toAccountId] + amt); flow[r.toAccountId] = round2(flow[r.toAccountId] + amt); }
      }
    });
    return { balance: bal, flow: flow };
  }

  /* 最近 n 个月（含当月，按时间升序） */
  function trailingMonths(month, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(addMonths(month, -i));
    return out;
  }

  /* ---------- 日历文件（.ics）解析 ---------- */

  // RFC 5545：长行会用「换行+空格」折行，先拼回去
  function unfoldICS(text) {
    var t = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return t.replace(/\n[ \t]/g, '');
  }

  function unescapeICS(s) {
    return String(s)
      .replace(/\\[nN]/g, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  function parsePropLine(line) {
    var colon = line.indexOf(':');
    if (colon < 0) return null;
    var head = line.slice(0, colon);
    var value = line.slice(colon + 1);
    var parts = head.split(';');
    var params = {};
    for (var i = 1; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq < 0) continue;
      params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1).replace(/^"|"$/g, '');
    }
    return { name: parts[0].toUpperCase(), params: params, value: value };
  }

  // 20261030 / 20261030T090000 / 20261030T090000Z
  function parseICSDate(value, params) {
    var m = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var hasTime = !!m[4];
    var hh = hasTime ? +m[4] : 0, mi = hasTime ? +m[5] : 0;
    var dt;
    if (m[7] === 'Z') {
      dt = new Date(Date.UTC(y, mo - 1, d, hh, mi, 0));
      dt = new Date(dt.getTime()); // 交给本地时区换算
    } else {
      dt = new Date(y, mo - 1, d, hh, mi, 0);
    }
    return {
      date: ymd(dt),
      time: hasTime ? pad(dt.getHours()) + ':' + pad(dt.getMinutes()) : '',
      allDay: !hasTime
    };
  }

  function parseRRule(s) {
    var o = {};
    String(s || '').split(';').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) o[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1);
    });
    return o;
  }

  function addMonthsClamp(dt, n) {
    var y = dt.getFullYear(), m = dt.getMonth() + n, d = dt.getDate();
    var last = daysInMonth(y + Math.floor(m / 12), (m % 12) + 1);
    return new Date(y + Math.floor(m / 12), m % 12, Math.min(d, last));
  }

  var WEEK_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  // 把一条（可能重复的）日程展开成日期列表，最多到 limit（YYYY-MM-DD）
  function expandEvent(startDate, rrule, limit) {
    var out = [startDate];
    if (!rrule) return out;
    var r = parseRRule(rrule);
    var freq = (r.FREQ || '').toUpperCase();
    var interval = Math.max(1, +(r.INTERVAL || 1));
    var count = r.COUNT ? +r.COUNT : 0;
    var until = r.UNTIL ? parseICSDate(r.UNTIL) : null;
    var maxN = count || 400;
    var base = new Date(startDate + 'T00:00:00');
    var limitDate = new Date(limit + 'T00:00:00');
    var guard = 0;

    if (freq === 'WEEKLY' && r.BYDAY) {
      var days = r.BYDAY.split(',').map(function (x) { return WEEK_MAP[x.trim().toUpperCase()]; })
        .filter(function (x) { return x !== undefined; });
      if (days.length) {
        var cursor = new Date(base);
        // 从本周开始，逐周推进
        var weekStart = new Date(cursor);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        while (guard++ < 800) {
          for (var i = 0; i < days.length; i++) {
            var off = (days[i] - 0);
            var day = new Date(weekStart);
            day.setDate(day.getDate() + off);
            var ds = ymd(day);
            if (day >= base && ds <= limit) {
              if (out.indexOf(ds) < 0) out.push(ds);
              if (out.length >= maxN) return out.sort();
            }
          }
          weekStart.setDate(weekStart.getDate() + 7 * interval);
          if (weekStart > limitDate) break;
        }
        return out.sort();
      }
    }

    var cur = new Date(base);
    while (guard++ < 800) {
      if (freq === 'DAILY') cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + interval);
      else if (freq === 'WEEKLY') cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7 * interval);
      else if (freq === 'MONTHLY') {
        if (r.BYMONTHDAY) {
          var dom = +String(r.BYMONTHDAY).split(',')[0];
          cur = addMonthsClamp(cur, interval);
          var last = daysInMonth(cur.getFullYear(), cur.getMonth() + 1);
          cur = new Date(cur.getFullYear(), cur.getMonth(), Math.min(dom, last));
        } else {
          cur = addMonthsClamp(cur, interval);
        }
      } else if (freq === 'YEARLY') {
        cur = new Date(cur.getFullYear() + interval, cur.getMonth(), cur.getDate());
      } else {
        break; // 不认识的频率，只保留第一次
      }
      var ds2 = ymd(cur);
      if (ds2 > limit) break;
      if (until && cur > until) break;
      out.push(ds2);
      if (out.length >= maxN) break;
    }
    return out.sort();
  }

  /* 解析 .ics 文本，返回 [{id,date,time,allDay,summary,location,description,amount}] */
  function parseICS(text, opts) {
    var o = opts || {};
    var horizon = o.months || 18;
    var limit = o.limitDate || ymd(addMonthsClamp(new Date(), horizon));
    var lines = unfoldICS(text).split('\n');
    var raw = [], cur = null, inEvent = false, inAlarm = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, '');
      if (!line) continue;
      var up = line.toUpperCase();
      if (up === 'BEGIN:VEVENT') { cur = {}; inEvent = true; inAlarm = false; continue; }
      if (up === 'END:VEVENT') { if (cur) raw.push(cur); cur = null; inEvent = false; continue; }
      if (!inEvent) continue;
      if (up === 'BEGIN:VALARM') { inAlarm = true; continue; }
      if (up === 'END:VALARM') { inAlarm = false; continue; }
      if (inAlarm) continue;

      var p = parsePropLine(line);
      if (!p) continue;
      if (p.name === 'SUMMARY') cur.summary = unescapeICS(p.value);
      else if (p.name === 'DTSTART') cur.dtstart = p;
      else if (p.name === 'LOCATION') cur.location = unescapeICS(p.value);
      else if (p.name === 'DESCRIPTION') cur.description = unescapeICS(p.value);
      else if (p.name === 'RRULE') cur.rrule = p.value;
      else if (p.name === 'UID') cur.uid = p.value;
      else if (p.name === 'EXDATE') cur.exdate = (cur.exdate || []).concat(p.value.split(','));
    }

    var events = [];
    raw.forEach(function (e, idx) {
      if (!e.dtstart) return;
      var sd = parseICSDate(e.dtstart.value, e.dtstart.params);
      if (!sd) return;
      var dates = expandEvent(sd.date, e.rrule, limit);
      // 排除 EXDATE
      if (e.exdate) {
        var ex = e.exdate.map(function (v) { return parseICSDate(v, {}); })
          .filter(Boolean).map(function (x) { return x.date; });
        dates = dates.filter(function (d) { return ex.indexOf(d) < 0; });
      }
      dates.forEach(function (d, j) {
        events.push({
          id: 'ev_' + (e.uid || idx) + '_' + j,
          date: d,
          time: sd.time,
          allDay: sd.allDay,
          summary: (e.summary || '未命名日程').slice(0, 80),
          location: (e.location || '').slice(0, 60),
          description: (e.description || '').slice(0, 200),
          amount: extractAmount(e.summary || ''),
          source: 'ics'
        });
      });
    });

    // 去重 + 按日期排序
    var seen = {}, uniq = [];
    events.forEach(function (ev) {
      var k = ev.date + '|' + ev.summary + '|' + ev.time;
      if (seen[k]) return;
      seen[k] = 1;
      uniq.push(ev);
    });
    uniq.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    return uniq;
  }

  /* 从日程标题里猜金额：「交房租 3000」「话费 59 元」「¥120」 */
  function extractAmount(text) {
    var s = String(text || '');
    function clean(v) {
      return (v > 0 && v < 1e7) ? Math.round(v * 100) / 100 : null;
    }
    // 1) 带货币符号最可靠
    var m = s.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
    if (m) return clean(+m[1]);
    // 2) 带「元 / 块」
    m = s.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块)/);
    if (m) return clean(+m[1]);
    // 3) 裸数字：从右往左挑，排除「第3次」「2026年」「10月」「20日」这类
    var all = s.match(/\d+(?:\.\d{1,2})?/g);
    if (!all) return null;
    for (var i = all.length - 1; i >= 0; i--) {
      var v = +all[i];
      if (v < 10) continue;
      var pos = s.lastIndexOf(all[i]);
      var prev = pos > 0 ? s.charAt(pos - 1) : '';
      var next = s.charAt(pos + all[i].length);
      if (prev === '第') continue;
      if (next && '年月日号次个点'.indexOf(next) >= 0) continue;
      return clean(v);
    }
    return null;
  }

  /* ---------- 日历：某月每天花多少 ---------- */
  function monthCalendar(state, month) {
    var p = parseYM(month);
    var total = daysInMonth(p.y, p.m);
    var firstDow = new Date(p.y, p.m - 1, 1).getDay(); // 0 = 周日
    var sums = {}, counts = {}, incs = {};
    (state.records || []).forEach(function (r) {
      if (r.date.slice(0, 7) !== month) return;
      var d = +r.date.slice(8, 10);
      if (recType(r) === 'income') {
        incs[d] = (incs[d] || 0) + (+r.amount || 0);
        return;
      }
      if (recType(r) !== 'expense') return;
      sums[d] = (sums[d] || 0) + (+r.amount || 0);
      counts[d] = (counts[d] || 0) + 1;
    });
    var max = 0;
    for (var k in sums) if (sums[k] > max) max = sums[k];
    var cells = [];
    for (var d = 1; d <= total; d++) {
      var amt = round2(sums[d] || 0);
      cells.push({
        day: d,
        date: month + '-' + pad(d),
        amount: amt,
        income: round2(incs[d] || 0),
        count: counts[d] || 0,
        // 热力等级 0~4
        level: amt > 0 ? Math.min(4, Math.ceil(amt / max * 4)) : 0
      });
    }
    return { firstDow: firstDow, days: total, cells: cells, max: round2(max), month: month };
  }

  /* ---------- 扇形图数据：小占比合并为“其他” ---------- */
  function pieSlices(stats, threshold) {
    var th = threshold === undefined ? 0.02 : threshold;
    var arr = stats.categories
      .filter(function (c) { return c.amount > 0; })
      .sort(function (a, b) { return b.amount - a.amount; })
      .map(function (c) {
        return { id: c.id, name: c.name, color: c.color, amount: c.amount, ratio: c.ratio, merged: [] };
      });
    if (arr.length <= 1) return arr;
    var small = arr.filter(function (s) { return s.ratio < th; });
    if (!small.length) return arr;
    var big = arr.filter(function (s) { return s.ratio >= th; });
    var sum = small.reduce(function (a, s) { return a + s.amount; }, 0);
    if (!big.length) return arr;
    big.push({
      id: '__merged',
      name: '其他 ' + small.length + ' 项',
      color: '#C3CAD6',
      amount: round2(sum),
      ratio: stats.spent > 0 ? sum / stats.spent : 0,
      merged: small.map(function (s) { return s.name; })
    });
    return big;
  }

  /* 扇区路径（支持环形） */
  function arcPath(cx, cy, r0, r1, a0, a1) {
    var big = a1 - a0 > Math.PI ? 1 : 0;
    function pt(r, a) { return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }
    var p0 = pt(r0, a0), p1 = pt(r0, a1), q0 = pt(r1, a0), q1 = pt(r1, a1);
    if (a1 - a0 >= Math.PI * 2 - 1e-6) {
      // 整圆
      return 'M ' + (cx - r1) + ' ' + cy + ' A ' + r1 + ' ' + r1 + ' 0 1 1 ' + (cx + r1) + ' ' + cy +
        ' A ' + r1 + ' ' + r1 + ' 0 1 1 ' + (cx - r1) + ' ' + cy + ' Z' +
        ' M ' + (cx - r0) + ' ' + cy + ' A ' + r0 + ' ' + r0 + ' 0 1 0 ' + (cx + r0) + ' ' + cy +
        ' A ' + r0 + ' ' + r0 + ' 0 1 0 ' + (cx - r0) + ' ' + cy + ' Z';
    }
    return ['M', q0[0], q0[1], 'A', r1, r1, 0, big, 1, q1[0], q1[1],
      'L', p1[0], p1[1], 'A', r0, r0, 0, big, 0, p0[0], p0[1], 'Z'].join(' ');
  }

  /* ---------- 自然语言记账解析 ---------- */
  var CAT_ALIASES = [
    ['伙食', ['早饭', '早饭', '早餐', '午饭', '午饭', '午餐', '晚饭', '晚餐', '夜宵', '宵夜', '早餐',
      '吃', '饭', '外卖', '食堂', '奶茶', '咖啡', '零食', '水果', '饮料', '可乐', '面包', '包子',
      '菜', '食材', '超市买菜', '聚餐', '火锅', '烧烤', '炸鸡', '汉堡', '面条', '米粉', '米线', '餐']],
    ['娱乐', ['玩', '游戏', '电影', '电影票', '演出', 'KTV', 'ktv', '唱歌', '门票', '演唱会', '剧本杀',
      '桌游', '密室', '游戏充值', '会员', '视频会员', '旅游', '旅行', '手办', '玩具']],
    ['学习', ['书', '教材', '书本', '课本', '课程', '网课', '考试', '报名费', '报名', '文具', '笔', '本子',
      '打印', '复印', '学费', '培训', '辅导', '题库', '真题', '证书', 'iPad', '平板', '电脑', '键盘',
      '鼠标', '充电宝', '学习', '四六级', '雅思', '托福', '考研', '考公']],
    ['交通', ['公交', '地铁', '打车', '出租车', '滴滴', '高铁', '火车', '机票', '飞机', '共享单车',
      '单车', '加油', '停车', '车票', '交通', '车费']],
    ['日用', ['纸巾', '洗发水', '沐浴露', '牙膏', '牙刷', '洗衣液', '日用品', '超市', '超市购物', '日化',
      '袜子', '内衣', '衣服', '鞋', '服装', '护肤', '化妆', '理容', '剪头发', '理发', '日用']],
    ['居住', ['房租', '水费', '电费', '燃气', '物业', '住宿', '酒店', '宾馆', '宿管', '水电', '宽带',
      '网费', '话费', '电费']],
    ['医疗', ['药', '买药', '门诊', '看病', '医院', '挂号', '体检', '牙', '牙医', '疫苗', '医疗']],
    ['人情', ['红包', '礼金', '随礼', '份子钱', '礼物', '送礼', '请客', '人情']]
  ];
  var PAY_ALIASES = [
    ['微信', ['微信', 'wx']],
    ['支付宝', ['支付宝', 'zfb']],
    ['银行卡', ['银行卡', '银行', '卡', '信用卡']],
    ['现金', ['现金']],
    ['花呗/白条', ['花呗', '白条']]
  ];

  function guessCategory(text, state) {
    for (var i = 0; i < CAT_ALIASES.length; i++) {
      var name = CAT_ALIASES[i][0];
      var hit = CAT_ALIASES[i][1].some(function (w) { return text.indexOf(w) >= 0; });
      if (!hit) continue;
      var cat = state.categories.filter(function (c) { return c.name === name; })[0];
      if (cat) return cat.id;
    }
    var o = state.categories.filter(function (c) { return c.name === '其他'; })[0];
    return o ? o.id : (state.categories[0] && state.categories[0].id);
  }

  var INCOME_WORDS = /(收入|工资|薪水|薪资|奖金|年终奖|分红|报销|退款|退税|兼职|外快|进账|到账|收到|赚了)/;
  var INCOME_CAT_MAP = [
    ['工资', ['工资', '薪水', '薪资', '发薪']],
    ['奖金', ['奖金', '年终奖', '分红', '提成']],
    ['兼职', ['兼职', '外快', '稿费', '私活']],
    ['红包', ['红包', '收礼', '压岁钱']],
    ['退款', ['退款', '报销', '退税', '返现']]
  ];

  function guessIncomeCategory(text, state) {
    var list = state.incomeCategories || [];
    for (var i = 0; i < INCOME_CAT_MAP.length; i++) {
      var hit = INCOME_CAT_MAP[i][1].some(function (w) { return String(text).indexOf(w) >= 0; });
      if (hit) {
        var c = list.filter(function (x) { return x.name === INCOME_CAT_MAP[i][0]; })[0];
        if (c) return c.id;
      }
    }
    var other = list.filter(function (x) { return x.name === '其他收入'; })[0];
    return other ? other.id : (list[0] && list[0].id);
  }

  // 判断一句话是收入还是支出
  function guessRecType(text) {
    var s = String(text || '');
    if (/发红包|发个红包|包红包|随礼/.test(s)) return 'expense';
    if (INCOME_WORDS.test(s)) return 'income';
    return 'expense';
  }

  /* 输入一句话，输出 {date, amount, item, categoryId, pay, type}；date 为 null 表示没识别到 */
  function parseQuick(text, state, today) {
    var raw = String(text || '').trim();
    var t = raw;
    var out = { raw: raw, date: null, amount: null, item: '', categoryId: null, pay: '' };

    // 1) 先认日期：否则「10月3日」里的 10 会被当成金额
    var now = today ? new Date(today + 'T00:00:00') : new Date();
    var dm = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (dm) {
      out.date = ymd(new Date(now.getFullYear(), +dm[1] - 1, +dm[2]));
      t = t.replace(dm[0], ' ');
    } else if (/昨天/.test(t)) {
      out.date = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
      t = t.replace(/昨天/g, ' ');
    } else if (/前天/.test(t)) {
      out.date = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2));
      t = t.replace(/前天/g, ' ');
    } else if (/今天/.test(t)) {
      out.date = ymd(now);
      t = t.replace(/今天/g, ' ');
    }

    // 2) 再认金额：优先「带元/块」的，其次取句子里最后一个数字
    var cand = t.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块|rmb|RMB)/i);
    if (cand) {
      out.amount = +cand[1];
      t = t.slice(0, cand.index) + ' ' + t.slice(cand.index + cand[0].length);
    } else {
      var nums = t.match(/\d+(?:\.\d{1,2})?/g);
      if (nums && nums.length) {
        var last = nums[nums.length - 1];
        var at = t.lastIndexOf(last);
        out.amount = +last;
        t = t.slice(0, at) + ' ' + t.slice(at + last.length);
      }
    }

    // 3) 支付方式
    for (var i = 0; i < PAY_ALIASES.length; i++) {
      for (var j = 0; j < PAY_ALIASES[i][1].length; j++) {
        var w = PAY_ALIASES[i][1][j];
        var re = new RegExp(w, 'g');
        if (re.test(t)) {
          out.pay = PAY_ALIASES[i][0];
          t = t.replace(re, ' ');
          break;
        }
      }
      if (out.pay) break;
    }

    // 4) 分类（先判断是收入还是支出）
    out.type = guessRecType(t);
    if (out.type === 'income') {
      out.categoryId = guessIncomeCategory(t, state);
      out.accountId = accountFromPay(out.pay, state.accounts || []);
    } else {
      out.categoryId = guessCategory(t, state);
      out.accountId = accountFromPay(out.pay, state.accounts || []);
    }

    // 5) 项目名
    out.item = t.replace(/[，,。.、；;:：!！?？\s]+/g, ' ').trim() || (out.amount ? '支出' : '');
    return out;
  }

  /* ---------- 导入导出 ---------- */
  function toCSV(records, state) {
    var catName = function (r) {
      var list = recType(r) === 'income' ? (state.incomeCategories || []) : (state.categories || []);
      var c = list.filter(function (x) { return x.id === r.categoryId; })[0];
      return c ? c.name : '未分类';
    };
    var accName = function (id) {
      var a = (state.accounts || []).filter(function (x) { return x.id === id; })[0];
      return a ? a.name : '';
    };
    var typeName = { expense: '支出', income: '收入', transfer: '转账' };
    var esc = function (v) {
      var s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = ['日期,类型,分类,项目,金额,账户,支付方式,备注'];
    records.slice()
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .forEach(function (r) {
        lines.push([
          r.date,
          typeName[recType(r)] || '支出',
          catName(r),
          r.item,
          r.amount,
          recType(r) === 'transfer' ? (accName(r.accountId) + '→' + accName(r.toAccountId)) : accName(r.accountId),
          r.pay,
          r.note
        ].map(esc).join(','));
      });
    return '\ufeff' + lines.join('\r\n');
  }

  /* ---------- 自测 ---------- */
  function _selfTest() {
    var errors = [];
    var ok = function (cond, msg) { if (!cond) errors.push(msg); };

    var st = normalize(null);
    ok(st.categories.length === 9, '默认分类数量应为 9');

    // 空数据
    var s0 = monthStats(st, '2026-10');
    ok(s0.spent === 0, '空数据支出应为 0');
    ok(s0.usedRatio === null || s0.usedRatio === 0, '空数据占比应可用');
    ok(pieSlices(s0).length === 0, '空数据扇区应为空');

    // 示例数据
    var foods = st.categories[0].id, fun = st.categories[1].id, study = st.categories[2].id;
    st.records = [
      { id: 'a', date: '2026-10-01', categoryId: foods, item: '午饭', amount: 20, pay: '微信' },
      { id: 'b', date: '2026-10-01', categoryId: foods, item: '晚饭', amount: 30, pay: '微信' },
      { id: 'c', date: '2026-10-02', categoryId: fun, item: '电影', amount: 50, pay: '支付宝' },
      { id: 'd', date: '2026-10-03', categoryId: study, item: '教材', amount: 100, pay: '现金' },
      { id: 'e', date: '2026-09-30', categoryId: foods, item: '上月', amount: 999, pay: '' }
    ];
    st.settings.defaultMonthlyBudget = 1000;
    var s1 = monthStats(st, '2026-10');
    ok(s1.spent === 200, '10 月支出应为 200，实际 ' + s1.spent);
    ok(s1.budget === 1000, '10 月预算应取默认值 1000');
    ok(s1.remaining === 800, '剩余应为 800');
    ok(s1.count === 4, '10 月记录数应为 4');
    var fc = s1.categories.filter(function (c) { return c.id === foods; })[0];
    ok(fc.amount === 50, '伙食应为 50');
    ok(Math.abs(fc.ratio - 0.25) < 1e-9, '伙食占比应为 25%');
    var sc = s1.categories.filter(function (c) { return c.id === study; })[0];
    ok(Math.abs(sc.ratio - 0.5) < 1e-9, '学习占比应为 50%');
    ok(s1.byDay.length === 31, '10 月应有 31 天');
    ok(s1.byDay[0] === 50 && s1.byDay[1] === 50 && s1.byDay[2] === 100, '按日统计不对');

    // 分类预算优先于默认
    st.categories[0].budget = 500;
    var s2 = monthStats(st, '2026-10');
    ok(s2.budget === 500, '分类预算合计应覆盖默认值，实际 ' + s2.budget);
    // 月覆盖优先
    st.settings.monthBudgets = { '2026-10': 2000 };
    var s3 = monthStats(st, '2026-10');
    ok(s3.budget === 2000, '月覆盖应为 2000，实际 ' + s3.budget);
    st.settings.monthBudgets = {};

    // 历史月不按“今天”截断
    var s4 = monthStats(st, '2026-09');
    ok(s4.spent === 999, '9 月支出应为 999');
    ok(s4.elapsed === 30, '历史月 elapsed 应为整月');

    // 扇形图合并
    st.categories.forEach(function (c) { c.budget = 0; });
    st.records = [];
    var mk = function (id, amt, date) {
      st.records.push({ id: uid('t'), date: date || '2026-10-05', categoryId: id, item: 'x', amount: amt, pay: '' });
    };
    mk(foods, 970); mk(fun, 10); mk(study, 10); mk('cat_traffic', 10);
    var sv = monthStats(st, '2026-10');
    var slices = pieSlices(sv, 0.02);
    ok(slices.length === 2, '合并后应剩 2 个扇区，实际 ' + slices.length);
    ok(slices[0].name === '伙食', '最大扇区应为伙食');
    ok(Math.abs(slices[1].amount - 30) < 1e-9, '合并金额应为 30');
    var sumRatio = slices.reduce(function (a, s) { return a + s.ratio; }, 0);
    ok(Math.abs(sumRatio - 1) < 1e-9, '扇区占比之和应为 1，实际 ' + sumRatio);
    var sumAmt = slices.reduce(function (a, s) { return a + s.amount; }, 0);
    ok(Math.abs(sumAmt - 1000) < 1e-9, '扇区金额之和应为全部支出');

    // 不合并时按金额降序
    st.records = []; mk(foods, 100, '2026-10-01'); mk(fun, 200, '2026-10-01');
    var s6 = pieSlices(monthStats(st, '2026-10'), 0);
    ok(s6[0].name === '娱乐' && s6[1].name === '伙食', '应按时金额降序');

    // 弧路径
    ok(/^M /.test(arcPath(100, 100, 50, 100, 0, Math.PI / 2)), 'arcPath 输出异常');
    ok(/^M /.test(arcPath(100, 100, 0, 100, 0, Math.PI * 2)), '整圆输出异常');

    // 自然语言解析
    st = normalize(null);
    var t1 = parseQuick('午饭花了20块', st, '2026-10-26');
    ok(t1.amount === 20, '解析金额失败: ' + t1.amount);
    ok(t1.categoryId === st.categories[0].id, '“午饭”应归伙食');
    var t2 = parseQuick('昨天电影票 45 支付宝', st, '2026-10-26');
    ok(t2.amount === 45, '解析金额失败');
    ok(t2.date === '2026-10-25', '“昨天”应为 10-25，实际 ' + t2.date);
    ok(t2.categoryId === st.categories[1].id, '“电影票”应归娱乐');
    ok(t2.pay === '支付宝', '解析支付方式失败');
    var t3 = parseQuick('10月3日 买课本 59元', st, '2026-10-26');
    ok(t3.amount === 59, '解析金额失败');
    ok(t3.date === '2026-10-03', '“10月3日”应为 10-03，实际 ' + t3.date);
    ok(t3.categoryId === st.categories[2].id, '“课本”应归学习');
    var t4 = parseQuick('打车 18', st, '2026-10-26');
    ok(t4.categoryId === st.categories[3].id, '“打车”应归交通');
    var t5 = parseQuick('买4本书 59元', st, '2026-10-26');
    ok(t5.amount === 59, '“买4本书 59元”金额应为 59，实际 ' + t5.amount);
    var t6 = parseQuick('明天早饭', st, '2026-10-26');
    ok(t6.amount === null, '没有金额时应为 null');

    // 月份工具
    ok(addMonths('2026-01', -1) === '2025-12', 'addMonths 跨年错误');
    ok(daysInMonth(2028, 2) === 29, '闰年天数错误');
    ok(monthRange('2026-10').end === '2026-10-31', 'monthRange 错误');

    // 归一化容错
    var nn = normalize({ records: [{ date: '2026-10-01', amount: '12.345', item: 'x' }, { bad: 1 }] });
    ok(nn.records.length === 1 && nn.records[0].amount === 12.35, 'normalize 容错失败');

    // CSV
    var csv = toCSV(st.records.length ? st.records : [
      { date: '2026-10-01', categoryId: foods, item: 'a,b', amount: 1.5, pay: '微信', note: '' }
    ], st);
    ok(csv.indexOf('日期,类型,分类,项目,金额,账户,支付方式,备注') >= 0, 'CSV 表头缺失');
    ok(csv.indexOf('"a,b"') >= 0, 'CSV 引号转义失败');

    // ---------- 收入 / 结余 / 账户 ----------
    var stI = normalize(null);
    var foodId2 = stI.categories[0].id;
    stI.records = [
      { id: 'i1', date: '2026-10-01', type: 'income', categoryId: 'inc_salary', accountId: 'acc_bank', item: '工资', amount: 8000 },
      { id: 'i2', date: '2026-10-05', type: 'expense', categoryId: foodId2, accountId: 'acc_wechat', item: '午饭', amount: 30 },
      { id: 'i3', date: '2026-10-06', type: 'expense', categoryId: foodId2, accountId: 'acc_wechat', item: '晚饭', amount: 20 }
    ];
    var sI = monthStats(stI, '2026-10');
    ok(sI.income === 8000, '收入应为 8000，实际 ' + sI.income);
    ok(sI.spent === 50, '支出应为 50，实际 ' + sI.spent);
    ok(sI.savings === 7950, '结余应为 7950，实际 ' + sI.savings);
    ok(sI.count === 2, '支出笔数应为 2，实际 ' + sI.count);
    ok(sI.incomeCount === 1, '收入笔数应为 1，实际 ' + sI.incomeCount);
    ok(sI.incomeCategories.length === 1 && sI.incomeCategories[0].name === '工资', '收入分类统计不对');

    var ab = accountBalances(stI);
    ok(ab.balance.acc_bank === 8000, '银行卡余额应为 8000，实际 ' + ab.balance.acc_bank);
    ok(ab.balance.acc_wechat === -50, '微信余额应为 -50，实际 ' + ab.balance.acc_wechat);

    stI.records.push({ id: 't1', date: '2026-10-07', type: 'transfer', accountId: 'acc_bank', toAccountId: 'acc_wechat', amount: 500 });
    var ab2 = accountBalances(stI);
    ok(ab2.balance.acc_bank === 7500, '转账后银行卡应为 7500，实际 ' + ab2.balance.acc_bank);
    ok(ab2.balance.acc_wechat === 450, '转账后微信应为 450，实际 ' + ab2.balance.acc_wechat);
    var sI2 = monthStats(stI, '2026-10');
    ok(sI2.spent === 50, '转账不该算进支出');

    // 老数据兼容
    var oldState = normalize({ records: [
      { id: 'o1', date: '2026-10-01', categoryId: 'cat_food', item: 'x', amount: 10, pay: '微信' }
    ] });
    ok(oldState.records[0].type === 'expense', '没有 type 的老记录应默认支出');
    ok(oldState.records[0].accountId === 'acc_wechat', '老记录应按支付方式推断账户，实际 ' + oldState.records[0].accountId);

    // 收入识别
    var t7 = parseQuick('发工资 8000', stI, '2026-10-26');
    ok(t7.type === 'income', '「发工资」应识别为收入，实际 ' + t7.type);
    ok(t7.categoryId === 'inc_salary', '「发工资」应归到工资，实际 ' + t7.categoryId);
    var t8 = parseQuick('发红包 200', stI, '2026-10-26');
    ok(t8.type === 'expense', '「发红包」应仍是支出，实际 ' + t8.type);
    var t9 = parseQuick('收到退款 50', stI, '2026-10-26');
    ok(t9.type === 'income', '「收到退款」应是收入，实际 ' + t9.type);
    var t10 = parseQuick('兼职收入 300', stI, '2026-10-26');
    ok(t10.type === 'income' && t10.categoryId === 'inc_part', '「兼职收入」应归到兼职，实际 ' + t10.categoryId);

    var calState = normalize(null);
    calState.records = [
      { id: 'c1', date: '2026-10-01', categoryId: foods, item: 'a', amount: 10, pay: '' },
      { id: 'c2', date: '2026-10-01', categoryId: foods, item: 'b', amount: 5, pay: '' },
      { id: 'c3', date: '2026-10-15', categoryId: fun, item: 'c', amount: 100, pay: '' }
    ];
    var cal = monthCalendar(calState, '2026-10');
    ok(cal.days === 31, '10月应有31天');
    ok(cal.firstDow === 4, '2026-10-01 是周四，firstDow 应为 4，实际 ' + cal.firstDow);
    ok(cal.cells[0].amount === 15, '1日合计应为15');
    ok(cal.cells[0].count === 2, '1日应有2笔');
    ok(cal.cells[14].amount === 100, '15日应为100');
    ok(cal.cells[14].level === 4, '最高单日热力应为4级');
    ok(cal.cells[1].amount === 0 && cal.cells[1].level === 0, '2日无记录');
    ok(cal.max === 100, '单日最高应为100');

    // ---------- .ics 解析 ----------
    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:e1',
      'SUMMARY:交房租 3000',
      'DTSTART;VALUE=DATE:20261101',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:e2',
      'SUMMARY:视频会员 25元',
      'DTSTART:20261015T120000',
      'RRULE:FREQ=MONTHLY;COUNT=3',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:e3',
      'SUMMARY:健身房',
      'DTSTART;VALUE=DATE:20261005',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:e4',
      'SUMMARY:朋友生日\\,记得买礼物',
      'DTSTART;VALUE=DATE:20261220',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    var evs = parseICS(ics, { limitDate: '2027-12-31' });
    ok(evs.length === 1 + 3 + 4 + 1, '日程总数应为 9，实际 ' + evs.length);
    var rent = evs.filter(function (e) { return e.summary === '交房租 3000'; });
    ok(rent.length === 1 && rent[0].date === '2026-11-01', '房租日期应为 2026-11-01');
    ok(rent[0].allDay === true, '房租应为全天');
    ok(rent[0].amount === 3000, '房租金额应识别为 3000，实际 ' + rent[0].amount);
    var vip = evs.filter(function (e) { return e.summary === '视频会员 25元'; });
    ok(vip.length === 3, '每月重复应展开 3 次，实际 ' + vip.length);
    ok(vip[0].date === '2026-10-15' && vip[2].date === '2026-12-15', '会员日期展开错误：' + vip.map(function (v) { return v.date; }).join(','));
    ok(vip[0].time === '12:00', '会员应为 12:00，实际 ' + vip[0].time);
    ok(vip[0].amount === 25, '会员金额 25');
    var gym = evs.filter(function (e) { return e.summary === '健身房'; });
    ok(gym.length === 4, '每周重复应 4 次，实际 ' + gym.length);
    var bday = evs.filter(function (e) { return e.summary.indexOf('朋友生日') === 0; });
    ok(bday.length === 1 && bday[0].summary === '朋友生日,记得买礼物', '逗号转义未还原：' + (bday[0] && bday[0].summary));
    ok(evs[0].date <= evs[evs.length - 1].date, '日程应按日期升序');

    // 折行还原
    var folded = 'BEGIN:VEVENT\r\nUID:f1\r\nSUMMARY:这是一个很长的\r\n 标题\r\nDTSTART;VALUE=DATE:20270101\r\nEND:VEVENT';
    var f = parseICS(folded, { limitDate: '2027-12-31' });
    ok(f.length === 1 && f[0].summary === '这是一个很长的标题', '折行未正确拼接：' + (f[0] && f[0].summary));

    // 金额提取
    ok(extractAmount('交房租 3000') === 3000, '提取 3000 失败');
    ok(extractAmount('话费 ¥59') === 59, '提取 ¥59 失败');
    ok(extractAmount('聚餐 AA 120.5元') === 120.5, '提取 120.5 失败');
    ok(extractAmount('开会') === null, '无金额应返回 null');
    ok(extractAmount('第3次咨询') === null, '无单位的数字不该当成金额，实际 ' + extractAmount('第3次咨询'));

    return errors;
  }

  return {
    // 工具
    pad: pad, ym: ym, ymd: ymd, parseYM: parseYM, todayStr: todayStr, round2: round2,
    money: money, moneyShort: moneyShort, monthLabel: monthLabel, daysInMonth: daysInMonth,
    addMonths: addMonths, monthRange: monthRange, uid: uid, clamp: clamp,
    // 数据
    EMPTY_STATE: EMPTY_STATE, DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    DEFAULT_ACCOUNTS: DEFAULT_ACCOUNTS, DEFAULT_INCOME_CATS: DEFAULT_INCOME_CATS,
    normalize: normalize, recType: recType, accountFromPay: accountFromPay,
    monthBudget: monthBudget, catBudgetTotal: catBudgetTotal, recordsOf: recordsOf,
    monthStats: monthStats, trailingMonths: trailingMonths, monthCalendar: monthCalendar,
    accountBalances: accountBalances,
    pieSlices: pieSlices, arcPath: arcPath,
    parseQuick: parseQuick, toCSV: toCSV,
    parseICS: parseICS, extractAmount: extractAmount, unfoldICS: unfoldICS,
    _selfTest: _selfTest
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Core;
