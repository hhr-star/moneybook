/* ================= 记账本 · 界面逻辑 ================= */
(function () {
  'use strict';

  var C = window.Core;
  var STORE_KEY = 'moneybook.v1';

  /* ---------------- 存储小工具（IndexedDB 存文件句柄） ---------------- */
  var IDB = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
        var req = indexedDB.open('moneybook', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      return dbp;
    }
    function put(key, val) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(val, key);
          tx.oncomplete = function () { res(true); };
          tx.onerror = function () { rej(tx.error); };
        });
      });
    }
    function get(key) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var tx = db.transaction('kv', 'readonly');
          var r = tx.objectStore('kv').get(key);
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        });
      });
    }
    function del(key) {
      return open().then(function (db) {
        return new Promise(function (res) {
          var tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').delete(key);
          tx.oncomplete = function () { res(true); };
        });
      });
    }
    return { put: put, get: get, del: del };
  })();

  /* ---------------- 自动备份 ---------------- */
  var SNAP_KEY = 'moneybook.snapshots';
  var MAX_SNAPS = 14;
  var backupFile = null;          // FileSystemFileHandle
  var pendingHandle = null;       // 有句柄但还没授权
  var backupTimer = null;
  var snapTimer = null;
  var lastFileBackupAt = 0;
  var backupError = '';

  function snapshotData() {
    return {
      records: state.records,
      categories: state.categories,
      settings: state.settings,
      events: state.events || []
    };
  }

  function readSnaps() {
    try {
      return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function writeSnaps(arr) {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      // 空间不够，砍掉旧的一半再试
      try {
        localStorage.setItem(SNAP_KEY, JSON.stringify(arr.slice(0, Math.max(2, Math.floor(arr.length / 2)))));
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  // 存一份快照；force=false 时会跳过「距上次不足 1 小时」，但内容没变永远跳过
  function makeSnapshot(reason, force) {
    var data = snapshotData();
    var arr = readSnaps();
    var newest = arr[0];
    if (newest) {
      try {
        if (JSON.stringify(newest.data) === JSON.stringify(data)) return false;
      } catch (e) { /* ignore */ }
      if (!force && Date.now() - newest.t < 3600 * 1000) return false;
    }
    arr.unshift({
      t: Date.now(),
      reason: reason || 'auto',
      n: (state.records || []).length,
      data: data
    });
    while (arr.length > MAX_SNAPS) arr.pop();
    return writeSnaps(arr);
  }

  function scheduleSnapshot() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(function () { makeSnapshot('auto', false); }, 3000);
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var diff = Date.now() - ts;
    var hm = C.pad(d.getHours()) + ':' + C.pad(d.getMinutes());
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (C.ymd(d) === C.todayStr()) return '今天 ' + hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }

  function canPickFile() {
    return typeof window.showSaveFilePicker === 'function';
  }

  function chooseBackupFile() {
    if (!canPickFile()) {
      toast('这个浏览器不支持自动写文件，请用 Edge 打开', 'err');
      return;
    }
    window.showSaveFilePicker({
      suggestedName: '记账本备份-' + C.todayStr() + '.json',
      types: [{ description: 'JSON 备份', accept: { 'application/json': ['.json'] } }]
    }).then(function (handle) {
      backupFile = handle;
      backupError = '';
      return IDB.put('backupFile', handle);
    }).then(function () {
      return writeBackupFile();
    }).then(function () {
      render();
      toast('已开启自动备份');
    }).catch(function (e) {
      if (e && e.name !== 'AbortError') toast('没能开启自动备份：' + e.message, 'err');
    });
  }

  function writeBackupFile() {
    if (!backupFile) return Promise.resolve(false);
    var text = JSON.stringify(state, null, 2);
    return backupFile.createWritable()
      .then(function (w) {
        return w.write(text).then(function () { return w.close(); });
      })
      .then(function () {
        lastFileBackupAt = Date.now();
        backupError = '';
        return true;
      })
      .catch(function (e) {
        backupError = e.message || String(e);
        backupFile = null;
        IDB.del('backupFile').catch(function () {});
        render();
        toast('自动备份中断了，请重新选一次位置', 'err');
        return false;
      });
  }

  function scheduleFileBackup() {
    if (!backupFile) return;
    clearTimeout(backupTimer);
    backupTimer = setTimeout(function () {
      writeBackupFile().then(function (ok) { if (ok) render(); });
    }, 1200);
  }

  function restoreBackupHandle() {
    IDB.get('backupFile').then(function (h) {
      if (!h) return;
      if (typeof h.queryPermission !== 'function') { backupFile = h; render(); return; }
      return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
        if (p === 'granted') { backupFile = h; render(); }
        else { pendingHandle = h; render(); }
      });
    }).catch(function () { /* 忽略 */ });
  }

  function reGrantBackup() {
    if (!pendingHandle) return chooseBackupFile();
    pendingHandle.requestPermission({ mode: 'readwrite' }).then(function (p) {
      if (p === 'granted') {
        backupFile = pendingHandle;
        pendingHandle = null;
        return writeBackupFile().then(function () {
          render();
          toast('自动备份已恢复');
        });
      }
      toast('没有授权，自动备份没开启', 'err');
    }).catch(function (e) {
      toast('授权失败：' + e.message, 'err');
    });
  }

  function stopBackup() {
    backupFile = null;
    pendingHandle = null;
    clearTimeout(backupTimer);
    IDB.del('backupFile').catch(function () {});
    render();
    toast('已关闭自动备份');
  }

  function restoreSnapshot(ts) {
    var arr = readSnaps();
    var snap = arr.filter(function (s) { return s.t === ts; })[0];
    if (!snap) { toast('这份快照已经不在了', 'err'); return; }
    var when = fmtTime(snap.t);
    if (!confirm('恢复到 ' + when + ' 的版本？\n\n' +
      '当前的数据会先自动存一份快照，不会丢。\n' +
      '快照内容：' + snap.n + ' 笔记录')) return;
    makeSnapshot('恢复前', true);
    state.records = snap.data.records || [];
    state.categories = snap.data.categories || state.categories;
    state.settings = snap.data.settings || state.settings;
    state.events = snap.data.events || [];
    save();
    view.modal = '';
    render();
    toast('已恢复到 ' + when + ' 版本');
  }

  function openSnapshots() {
    view.modal = 'snapshots';
    render();
  }

  /* ---------------- 状态 ---------------- */
  var state = null;
  var storageOK = true;
  var view = {
    tab: 'overview',
    month: C.ym(new Date()),
    filterCat: '',
    editingId: null,
    modal: '',
    quickText: '',
    dayDetail: '',
    presetDate: '',
    presetAmount: '',
    presetItem: '',
    formType: '',
    fixAccId: '',
    quickAccountId: '',
    chgAccId: ''
  };

  function loadState() {
    try {
      localStorage.setItem('__probe__', '1');
      localStorage.removeItem('__probe__');
    } catch (e) {
      storageOK = false;
    }
    try {
      var raw = localStorage.getItem(STORE_KEY);
      state = C.normalize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      state = C.normalize(null);
    }
    if (!state.records.length) sampleData();
  }

  function save() {
    if (!storageOK) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('保存失败：浏览器存储空间不足，请先导出备份');
    }
    scheduleSnapshot();
    scheduleFileBackup();
  }

  /* 首次打开时给几条示例，方便看懂效果（清空数据后不会再生成） */
  function sampleData() {
    var d = new Date();
    var y = d.getFullYear(), m = d.getMonth();
    function ds(day) {
      return y + '-' + C.pad(m + 1) + '-' + C.pad(Math.min(day, C.daysInMonth(y, m + 1)));
    }
    function id(n) {
      var c = state.categories.filter(function (x) { return x.name === n; })[0];
      return c ? c.id : 'cat_other';
    }
    var demo = [
      ['伙食', '食堂午饭', 15, '微信', 2], ['伙食', '食堂晚饭', 18, '微信', 2],
      ['伙食', '奶茶', 16, '支付宝', 3], ['学习', '专业课教材', 68, '支付宝', 4],
      ['交通', '地铁', 6, '微信', 4], ['娱乐', '电影票', 45, '支付宝', 6],
      ['伙食', '周末聚餐', 88, '微信', 7], ['日用', '洗发水', 39.9, '支付宝', 8],
      ['学习', '网课', 199, '银行卡', 9], ['伙食', '外卖', 32, '微信', 10],
      ['娱乐', '游戏充值', 30, '支付宝', 11], ['交通', '打车', 24, '微信', 12],
      ['伙食', '水果', 25, '现金', 13], ['学习', '打印资料', 12.5, '微信', 14],
      ['伙食', '食堂午饭', 16, '微信', 15], ['日用', '纸巾', 22.8, '支付宝', 16],
      ['娱乐', 'KTV', 120, '微信', 18], ['伙食', '早餐', 8, '微信', 19],
      ['学习', '考试报名费', 60, '支付宝', 20], ['交通', '高铁票', 320, '支付宝', 21],
      ['伙食', '晚饭', 26, '微信', 22], ['娱乐', '视频会员', 25, '支付宝', 23],
      ['伙食', '零食', 12, '现金', 24], ['日用', '衣服', 189, '银行卡', 25]
    ];
    state.records = demo.map(function (r, i) {
      return {
        id: 'demo_' + i, type: 'expense', date: ds(r[4]), categoryId: id(r[0]),
        accountId: C.accountFromPay(r[3], state.accounts || []),
        toAccountId: '', item: r[1], amount: r[2], pay: r[3], note: '', createdAt: i
      };
    });
    // 示例里放一笔收入，别人第一次打开能看懂收支是怎么回事
    state.records.push({
      id: 'demo_income',
      type: 'income',
      date: ds(1),
      categoryId: 'inc_salary',
      accountId: 'acc_bank',
      toAccountId: '',
      item: '本月工资',
      amount: 12000,
      pay: '',
      note: '',
      createdAt: -1
    });
    state.settings.defaultMonthlyBudget = 3000;
    save();
  }

  /* ---------------- 小工具 ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function catOf(id) {
    var found = state.categories.filter(function (c) { return c.id === id; })[0];
    return found || { name: '未分类', color: '#B0B7C3' };
  }
  function incomeCatOf(id) {
    var found = (state.incomeCategories || []).filter(function (c) { return c.id === id; })[0];
    return found || { name: '其他收入', color: '#94A3B8' };
  }
  function accountName(id) {
    var a = (state.accounts || []).filter(function (x) { return x.id === id; })[0];
    return a ? a.name : '';
  }
  function accountOf(id) {
    return (state.accounts || []).filter(function (x) { return x.id === id; })[0] || null;
  }
  function weekName(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return '周' + '日一二三四五六'[d.getDay()];
  }
  function humanDate(dateStr) {
    var t = C.todayStr();
    if (dateStr === t) return '今天 ' + weekName(dateStr);
    var y = new Date(); y.setDate(y.getDate() - 1);
    if (dateStr === C.ymd(y)) return '昨天 ' + weekName(dateStr);
    var p = dateStr.split('-');
    return (+p[1]) + '月' + (+p[2]) + '日 ' + weekName(dateStr);
  }

  var toastTimer = null;
  function toast(msg, type) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (type === 'err' ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2200);
  }

  function progressColor(ratio) {
    if (ratio === null) return '#4667f5';
    if (ratio >= 1) return '#e5484d';
    if (ratio >= 0.9) return '#f76808';
    if (ratio >= 0.7) return '#f5a524';
    return '#1fbf84';
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var st = C.monthStats(state, view.month);
    $('#app').innerHTML =
      sidebarHTML(st) +
      '<main class="main">' + topbarHTML(st) +
        '<div class="content">' + bannersHTML() + tabHTML(st) + '</div>' +
      '</main>' +
      '<div class="toast" id="toast"></div>' +
      modalHTML();
    bindLocal();
    if (view.modal) {
      var seg = $('#app .seg');
      if (seg) applyFormType(seg.getAttribute('data-ftype'));
      var focusEl = $('#fAmount') || $('#fBudget') || $('#fCatName');
      if (focusEl) setTimeout(function () { focusEl.focus(); if (focusEl.select) focusEl.select(); }, 40);
    }
  }

  function isDemoData() {
    return state.records.length > 0 && state.records.every(function (r) {
      return String(r.id).indexOf('demo_') === 0;
    });
  }

  function bannersHTML() {
    var out = '';
    if (!storageOK) {
      out += '<div class="banner warn">⚠ 这个浏览器禁用了本地存储，关掉页面数据就没了。' +
        '请改用 Chrome / Edge 打开，或用「备份 JSON」手动存档。</div>';
    }
    if (isDemoData() && view.tab !== 'settings') {
      out += '<div class="banner info">👋 现在展示的是<strong>示例数据</strong>，方便你先看看效果。' +
        '<button class="link-btn" data-act="clear-demo">清空示例，开始记自己的账</button></div>';
    }
    var alert = alertInfo();
    if (alert) out += alertBannerHTML(alert);
    var mis = misAccHint();
    if (mis) {
      out += '<div class="banner warn">⚠ 你的支出几乎全记在「<b>' + esc(mis.acc.name) + '</b>」上（' + mis.n + ' 笔）。' +
        '如果实际是微信 / 支付宝付的，' +
        '<button class="link-btn" data-act="fix-acc" data-id="' + esc(mis.acc.id) + '">一点批量转过去</button>' +
        '，以后新记录会自动跟着走。' +
        '<button class="icon-btn tiny" data-act="dismiss-misacc" title="不再提示" style="margin-left:8px">✕</button></div>';
    }
    return out;
  }

  // 检测「支出几乎全记在第一个账户」的情况，主动提示纠正
  function misAccHint() {
    try {
      if (localStorage.getItem('moneybook.misAccHint') === 'off') return null;
    } catch (e) { /* ignore */ }
    var accounts = state.accounts || [];
    if (accounts.length < 2) return null;
    var exp = state.records.filter(function (r) { return C.recType(r) === 'expense'; });
    if (exp.length < 5) return null;
    var cnt = {};
    exp.forEach(function (r) { cnt[r.accountId] = (cnt[r.accountId] || 0) + 1; });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
    if (!top || top !== accounts[0].id) return null;
    if (cnt[top] / exp.length < 0.9) return null;
    return { acc: accounts[0], n: cnt[top] };
  }

  /* ---------- 日程提醒 ---------- */
  function eventRecorded(e) {
    return state.records.some(function (r) {
      return r.date === e.date && Math.abs(r.amount - e.amount) < 0.01;
    });
  }

  function alertInfo() {
    var evs = state.events || [];
    if (!evs.length) return null;
    try {
      if (localStorage.getItem('moneybook.alertDismissed') === C.todayStr()) return null;
    } catch (e) { /* ignore */ }

    var today = C.todayStr();
    var todayEvs = evs.filter(function (e) { return e.date === today; });

    var from = C.ymd(new Date(Date.now() - 30 * 86400000));
    var overdue = evs.filter(function (e) {
      return e.date < today && e.date >= from && e.amount && !eventRecorded(e);
    });

    var weekEnd = C.ymd(new Date(Date.now() + 7 * 86400000));
    var soon = evs.filter(function (e) {
      return e.date > today && e.date <= weekEnd && e.amount;
    });

    if (!todayEvs.length && !overdue.length && !soon.length) return null;
    return { todayEvs: todayEvs, overdue: overdue, soon: soon };
  }

  function alertItemHTML(e) {
    var recorded = e.amount ? eventRecorded(e) : false;
    return '<div class="alert-item">' +
      '<span class="alert-time">' + (e.allDay ? '全天' : esc(e.time || '--:--')) + '</span>' +
      '<span class="alert-title">' + esc(e.summary) + '</span>' +
      (e.amount
        ? (recorded
          ? '<span class="alert-done">已记</span>'
          : '<button class="btn primary small" data-act="spend-from-event" data-date="' + e.date +
            '" data-amount="' + e.amount + '" data-item="' + esc(e.summary) + '">记 ¥' + C.money(e.amount) + '</button>')
        : '') +
    '</div>';
  }

  function alertBannerHTML(a) {
    var shown = a.todayEvs.slice(0, 3);
    var moreToday = a.todayEvs.length - shown.length;

    var sub = [];
    if (a.overdue.length) {
      sub.push('有 ' + a.overdue.length + ' 笔带金额的日程还没记：' +
        a.overdue.slice(0, 2).map(function (e) {
          return esc(e.date.slice(5)) + ' ' + esc(e.summary);
        }).join('、') + (a.overdue.length > 2 ? ' 等' : ''));
    }
    if (a.soon.length) {
      var sum = a.soon.reduce(function (s, e) { return s + (e.amount || 0); }, 0);
      sub.push('未来 7 天还有 ' + a.soon.length + ' 笔可能要花钱' +
        (sum > 0 ? '，合计 ¥' + C.money(sum) : ''));
    }

    return '<div class="banner alert">' +
      '<span class="alert-icon">🔔</span>' +
      '<div class="alert-main">' +
        (a.todayEvs.length ? '<div class="alert-head">今天有 ' + a.todayEvs.length + ' 个日程</div>' : '') +
        (shown.length ? '<div class="alert-list">' + shown.map(alertItemHTML).join('') + '</div>' : '') +
        (moreToday > 0 ? '<div class="alert-sub">还有 ' + moreToday + ' 个，去日历页看</div>' : '') +
        sub.map(function (s) { return '<div class="alert-sub">' + s + '</div>'; }).join('') +
      '</div>' +
      '<button class="icon-btn tiny" data-act="dismiss-alert" title="今天不再提示">✕</button>' +
    '</div>';
  }

  function sidebarHTML(st) {
    var tabs = [
      ['overview', '总览', '◔'],
      ['records', '明细', '☰'],
      ['calendar', '日历', '▦'],
      ['accounts', '账户', '◫'],
      ['categories', '分类', '◈'],
      ['settings', '设置', '⚙']
    ];
    return '<aside class="sidebar">' +
      '<div class="brand"><span class="logo">¥</span><div><b>记账本</b><small>花销一目了然</small></div></div>' +
      '<nav class="nav">' + tabs.map(function (t) {
        return '<button class="nav-item' + (view.tab === t[0] ? ' active' : '') +
          '" data-act="switch-tab" data-tab="' + t[0] + '"><i>' + t[2] + '</i>' + t[1] + '</button>';
      }).join('') + '</nav>' +
      '<div class="side-foot">' +
        '<div class="side-stat"><span>本月已花</span><b>¥' + C.money(st.spent) + '</b></div>' +
        '<div class="side-stat"><span>本月预算</span><b>' + (st.budget > 0 ? '¥' + C.money(st.budget) : '未设置') + '</b></div>' +
        '<button class="btn ghost small block" data-act="export-json">备份数据</button>' +
      '</div>' +
    '</aside>';
  }

  function topbarHTML(st) {
    return '<header class="topbar">' +
      '<div class="month-switch">' +
        '<button class="icon-btn" data-act="prev-month" title="上个月">‹</button>' +
        '<div class="month-title"><b>' + st.label + '</b>' +
          (st.isThisMonth ? '<span class="tag">本月</span>' : '') + '</div>' +
        '<button class="icon-btn" data-act="next-month" title="下个月">›</button>' +
        '<button class="btn ghost small" data-act="this-month">回到本月</button>' +
      '</div>' +
      '<div class="topbar-right"><button class="btn primary" data-act="open-add">＋ 记一笔</button></div>' +
    '</header>';
  }

  function tabHTML(st) {
    if (view.tab === 'records') return recordsHTML(st);
    if (view.tab === 'calendar') return calendarHTML(st);
    if (view.tab === 'accounts') return accountsHTML(st);
    if (view.tab === 'categories') return categoriesHTML(st);
    if (view.tab === 'settings') return settingsHTML(st);
    return overviewHTML(st);
  }

  /* ---------------- 总览 ---------------- */
  function overviewHTML(st) {
    return kpiRowHTML(st) +
      '<div class="grid">' +
        '<section class="card budget-card">' + ringHTML(st) + '</section>' +
        '<section class="card pie-card">' + pieHTML(st) + '</section>' +
        '<section class="card trend-card">' + trendHTML(st) + '</section>' +
        '<section class="card recent-card">' + recentHTML(st) + '</section>' +
      '</div>';
  }

  function kpiRowHTML(st) {
    var goal = +state.settings.savingsGoal || 0;
    var items = [
      { label: '本月收入', value: '¥' + C.money(st.income), cls: 'pos', sub: st.incomeCount + ' 笔' },
      { label: '本月支出', value: '¥' + C.money(st.spent), cls: '', sub: st.count + ' 笔' },
      {
        label: '本月结余',
        value: (st.savings < 0 ? '-¥' : '¥') + C.money(Math.abs(st.savings)),
        cls: st.savings >= 0 ? 'pos' : 'neg',
        sub: st.savingsRate !== null ? '结余率 ' + (st.savingsRate * 100).toFixed(0) + '%' : '还没有收入记录'
      }
    ];
    if (goal > 0) {
      var rate = Math.max(0, Math.min(1, st.savings / goal));
      items.push({
        label: '存款目标 ¥' + C.moneyShort(goal),
        value: (rate * 100).toFixed(0) + '%',
        cls: st.savings >= goal ? 'pos' : '',
        bar: rate
      });
    }
    return '<div class="kpi-row">' + items.map(function (it) {
      return '<div class="kpi">' +
        '<span class="kpi-label">' + it.label + '</span>' +
        '<b class="kpi-value ' + it.cls + '">' + it.value + '</b>' +
        (it.bar !== undefined
          ? '<div class="kpi-bar"><i style="width:' + (it.bar * 100) + '%"></i></div>'
          : '<span class="kpi-sub">' + it.sub + '</span>') +
      '</div>';
    }).join('') + '</div>';
  }

  function ringHTML(st) {
    var r = 78, cx = 100, cy = 100, circ = 2 * Math.PI * r;
    var ratio = st.usedRatio === null ? 0 : Math.min(1, st.usedRatio);
    var dash = circ * ratio;
    var color = progressColor(st.usedRatio);
    var over = st.usedRatio !== null && st.usedRatio >= 1 ? ' over' : '';

    var center = st.budget > 0
      ? '<div class="ring-num' + over + '">¥' + C.moneyShort(st.spent) + '</div>' +
        '<div class="ring-sub">预算 ¥' + C.moneyShort(st.budget) + '</div>'
      : '<div class="ring-num">¥' + C.moneyShort(st.spent) + '</div>' +
        '<div class="ring-sub">还没设置预算</div>';

    var tips = [];
    if (st.budget > 0) {
      if (st.remaining >= 0) {
        tips.push('还能花 <b>¥' + C.money(st.remaining) + '</b>');
        if (st.dailyAllow !== null) tips.push('余下每天 <b>¥' + C.money(st.dailyAllow) + '</b>');
      } else {
        tips.push('<span class="danger-text">已超支 <b>¥' + C.money(Math.abs(st.remaining)) + '</b></span>');
      }
    }
    tips.push('日均 <b>¥' + C.money(st.avgPerDay) + '</b>');
    tips.push('共 <b>' + st.count + '</b> 笔');

    var pace = '';
    if (st.budget > 0 && st.ideal !== null && st.isThisMonth) {
      var diff = st.spent - st.ideal;
      pace = diff > 0
        ? '<div class="pace warn">比时间进度多花 ¥' + C.money(diff) + '，慢一点</div>'
        : '<div class="pace good">比时间进度省 ¥' + C.money(Math.abs(diff)) + '</div>';
    }
    var fc = '';
    if (st.forecast !== null && st.budget > 0 && st.isThisMonth && st.spent > 0) {
      fc = st.forecast > st.budget
        ? '<div class="pace warn">按当前速度，月底约 ¥' + C.money(st.forecast) +
          '，会超 ¥' + C.money(st.forecast - st.budget) + '</div>'
        : '<div class="pace good">按当前速度，月底约 ¥' + C.money(st.forecast) + '，不会超</div>';
    }

    return '<div class="card-head"><h3>本月预算</h3>' +
        '<button class="link-btn" data-act="edit-budget">调整</button></div>' +
      '<div class="ring-wrap">' +
        '<svg viewBox="0 0 200 200" class="ring">' +
          '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#EDF0F5" stroke-width="14"/>' +
          (st.budget > 0
            ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color +
              '" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + circ +
              '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>'
            : '') +
        '</svg>' +
        '<div class="ring-center">' + center +
          '<div class="ring-pct">' + (st.budget > 0 ? (st.usedRatio * 100).toFixed(0) + '%' : '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tips">' + tips.join('<span class="dot-sep">·</span>') + '</div>' +
      pace + fc +
      (st.budget > 0 ? '' :
        '<button class="btn primary block" data-act="edit-budget" style="margin-top:12px">设置本月预算</button>');
  }

  function pieHTML(st) {
    var slices = C.pieSlices(st, 0.02);
    if (!slices.length) {
      return '<div class="card-head"><h3>花销占比</h3></div>' +
        '<div class="empty"><div class="empty-icon">◔</div><p>这个月还没有记录</p>' +
        '<button class="btn primary small" data-act="open-add">记第一笔</button></div>';
    }
    var cx = 110, cy = 110, r1 = 100, r0 = 58;
    var angle = -Math.PI / 2;
    var parts = slices.map(function (s, i) {
      var a0 = angle, a1 = angle + s.ratio * Math.PI * 2;
      angle = a1;
      return { s: s, i: i, d: C.arcPath(cx, cy, r0, r1, a0, a1) };
    });

    var svg = '<svg viewBox="0 0 220 220" class="pie">' +
      parts.map(function (p) {
        return '<path d="' + p.d + '" fill="' + p.s.color + '" class="slice" data-idx="' + p.i + '"/>';
      }).join('') +
      '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" class="pie-t1">¥' + C.moneyShort(st.spent) + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" class="pie-t2">总支出</text>' +
    '</svg>';

    var legend = parts.map(function (p) {
      return '<button class="legend-item" data-act="filter-cat" data-cat="' + esc(p.s.id) + '" title="查看该类明细">' +
        '<i style="background:' + p.s.color + '"></i>' +
        '<span class="legend-name">' + esc(p.s.name) + '</span>' +
        '<span class="legend-amt">¥' + C.money(p.s.amount) + '</span>' +
        '<span class="legend-pct">' + (p.s.ratio * 100).toFixed(1) + '%</span>' +
      '</button>';
    }).join('');

    return '<div class="card-head"><h3>花销占比</h3><span class="muted">共 ' + st.count + ' 笔</span></div>' +
      '<div class="pie-wrap"><div class="pie-box">' + svg + '</div>' +
      '<div class="legend">' + legend + '</div></div>';
  }

  function trendHTML(st) {
    var data = C.trailingMonths(view.month, 6).map(function (m) { return C.monthStats(state, m); });
    var maxSpent = Math.max.apply(null, data.map(function (d) { return d.spent; }).concat([1]));
    var scale = maxSpent * 1.15;
    // 预算线只在和支出同一个量级时才画，否则会变成图表顶部一条孤零零的虚线
    var showBudget = data.some(function (d) { return d.budget > 0 && d.budget <= scale; });
    var bars = data.map(function (d) {
      var h = d.spent > 0 ? Math.max(3, d.spent / scale * 100) : 0;
      var bh = showBudget && d.budget > 0 ? Math.min(100, d.budget / scale * 100) : 0;
      var over = d.budget > 0 && d.spent > d.budget;
      return '<div class="bar-col' + (d.month === view.month ? ' current' : '') +
        '" data-act="goto-month" data-month="' + d.month +
        '" title="' + d.label + '：¥' + C.money(d.spent) +
        (d.budget > 0 ? ' / 预算 ¥' + C.money(d.budget) : '') + '">' +
        '<div class="bar-track">' +
          (bh ? '<div class="bar-budget" style="bottom:' + bh + '%"></div>' : '') +
          (h ? '<div class="bar-fill' + (over ? ' over' : '') + '" style="height:' + h + '%"></div>' : '') +
        '</div>' +
        '<div class="bar-label">' + (+d.month.split('-')[1]) + '月</div>' +
      '</div>';
    }).join('');
    return '<div class="card-head"><h3>近 6 个月</h3><span class="muted">' +
      (showBudget ? '虚线是预算线，点柱子跳过去' : '点柱子跳到那个月') + '</span></div>' +
      '<div class="bars">' + bars + '</div>';
  }

  function recentHTML(st) {
    var recs = st.records.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0);
    }).slice(0, 6);
    var body = recs.length
      ? recs.map(function (r) { return recordRowHTML(r, true); }).join('')
      : '<div class="empty small"><p>还没有记录</p></div>';
    return '<div class="card-head"><h3>最近记录</h3>' +
      '<button class="link-btn" data-act="switch-tab" data-tab="records">全部 ›</button></div>' +
      '<div class="rec-list compact">' + body + '</div>';
  }

  /* ---------------- 明细 ---------------- */
  function recordsHTML(st) {
    var recs = st.records.slice();
    if (view.filterCat === '__income') {
      recs = recs.filter(function (r) { return C.recType(r) === 'income'; });
    } else if (view.filterCat) {
      recs = recs.filter(function (r) {
        return r.categoryId === view.filterCat && C.recType(r) === 'expense';
      });
    }
    recs.sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0);
    });

    var groups = {}, order = [];
    recs.forEach(function (r) {
      if (!groups[r.date]) { groups[r.date] = []; order.push(r.date); }
      groups[r.date].push(r);
    });

    var bodyHtml = order.map(function (d) {
      var sum = groups[d].reduce(function (a, r) {
        return a + (C.recType(r) === 'income' ? 0 : r.amount);
      }, 0);
      var inc = groups[d].reduce(function (a, r) {
        return a + (C.recType(r) === 'income' ? r.amount : 0);
      }, 0);
      return '<div class="day-group">' +
        '<div class="day-head"><span>' + esc(humanDate(d)) + '</span><b>' +
          (sum > 0 ? '¥' + C.money(sum) : '') +
          (inc > 0 ? (sum > 0 ? ' · ' : '') + '<span class="pos">+' + C.money(inc) + '</span>' : '') +
        '</b></div>' +
        groups[d].map(function (r) { return recordRowHTML(r, false); }).join('') + '</div>';
    }).join('');

    if (!order.length) bodyHtml = '<div class="empty"><div class="empty-icon">☰</div><p>这个月还没有记录</p></div>';

    var chips = '<button class="chip' + (view.filterCat ? '' : ' on') +
      '" data-act="filter-cat" data-cat="">全部</button>' +
      '<button class="chip' + (view.filterCat === '__income' ? ' on' : '') +
        '" data-act="filter-cat" data-cat="__income"><i style="background:#16A34A"></i>收入</button>' +
      state.categories.map(function (c) {
        return '<button class="chip' + (view.filterCat === c.id ? ' on' : '') +
          '" data-act="filter-cat" data-cat="' + esc(c.id) + '"><i style="background:' + c.color + '"></i>' +
          esc(c.name) + '</button>';
      }).join('');

    var expSum = recs.reduce(function (a, r) { return a + (C.recType(r) === 'income' ? 0 : r.amount); }, 0);
    var incSum = recs.reduce(function (a, r) { return a + (C.recType(r) === 'income' ? r.amount : 0); }, 0);
    var sumHtml;
    if (view.filterCat === '__income') {
      sumHtml = '收入共 <b>' + recs.length + '</b> 笔，合计 <b class="pos">+¥' + C.money(incSum) + '</b>';
    } else if (view.filterCat) {
      sumHtml = esc(catOf(view.filterCat).name) + '：共 <b>' + recs.length + '</b> 笔，合计 <b>¥' + C.money(expSum) + '</b>';
    } else {
      sumHtml = '支出 <b>¥' + C.money(expSum) + '</b> · 收入 <b class="pos">¥' + C.money(incSum) + '</b>';
    }

    return '<section class="card">' +
      '<div class="quick">' +
        '<input id="quickInput" class="quick-input" value="' + esc(view.quickText) + '" ' +
          'placeholder="一句话记账，例如：午饭 25 微信 / 发工资 8000 / 昨天打车 18">' +
        '<button class="btn primary" data-act="quick-add">记下</button>' +
      '</div>' +
      '<div class="quick-hint" id="quickHint">支持中文口语，自动识别金额、分类、账户和日期；说「发工资」「收到退款」会自动记成收入</div>' +
      '<div class="quick-acc">' +
        '<span class="quick-acc-label">记到</span>' +
        (state.accounts || []).map(function (a) {
          return '<button class="chip sm quick-acc-chip' + (a.id === quickAccId() ? ' on' : '') +
            '" data-act="set-quick-acc" data-id="' + esc(a.id) + '">' +
            '<i style="background:' + esc(a.color) + '"></i>' + esc(a.name) + '</button>';
        }).join('') +
      '</div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div class="list-sum">' + sumHtml + '</div>' +
      '<div class="rec-list">' + bodyHtml + '</div>' +
    '</section>';
  }

  function recordRowHTML(r, compact) {
    var t = C.recType(r);
    var isIncome = t === 'income';
    var isTransfer = t === 'transfer';
    var c = isIncome ? incomeCatOf(r.categoryId) : catOf(r.categoryId);
    var meta;
    if (isTransfer) {
      meta = '转账 · ' + (accountName(r.accountId) || '?') + ' → ' + (accountName(r.toAccountId) || '?');
    } else {
      var acc = accountName(r.accountId);
      // 账户名做成可点的，点一下直接换账户
      meta = esc(c.name) + (acc
        ? ' · <button class="acc-link" data-act="change-acc" data-id="' + esc(r.id) + '" title="换个账户">' +
          esc(acc) + '</button>'
        : ' · <button class="acc-link empty" data-act="change-acc" data-id="' + esc(r.id) + '" title="选账户">未指定</button>');
    }
    var sign = isIncome ? '+' : '';
    var amtCls = isIncome ? ' income' : (isTransfer ? ' transfer' : '');
    return '<div class="rec-row" data-id="' + esc(r.id) + '">' +
      '<i class="rec-dot" style="background:' + esc(isTransfer ? '#B0B7C3' : c.color) + '"></i>' +
      '<div class="rec-main">' +
        '<div class="rec-item">' + esc(r.item || (isIncome ? '收入' : isTransfer ? '转账' : '支出')) + '</div>' +
        '<div class="rec-meta">' + meta +
          (compact ? ' · ' + esc(humanDate(r.date)) : '') + '</div>' +
      '</div>' +
      '<div class="rec-amt' + amtCls + '">' + sign + '¥' + C.money(r.amount) + '</div>' +
      '<div class="rec-ops">' +
        '<button class="icon-btn tiny" data-act="edit-rec" data-id="' + esc(r.id) + '" title="编辑">✎</button>' +
        '<button class="icon-btn tiny danger" data-act="del-rec" data-id="' + esc(r.id) + '" title="删除">✕</button>' +
      '</div>' +
    '</div>';
  }

  // 快速记账区当前选中的账户
  function quickAccId() {
    var q = view.quickAccountId;
    if (q && accountOf(q)) return q;
    return pickAccount({ pay: '', accountId: '' });
  }

  function syncQuickAccChips() {
    var cur = quickAccId();
    $$('.quick-acc-chip').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-id') === cur);
    });
  }

  /* ---------------- 日历 ---------------- */
  function eventsByDate() {
    var map = {};
    (state.events || []).forEach(function (e) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.time || '') < (b.time || '') ? -1 : 1;
      });
    });
    return map;
  }

  function calendarHTML(st) {
    var cal = C.monthCalendar(state, view.month);
    var today = C.todayStr();
    var evMap = eventsByDate();

    var blanks = '';
    for (var i = 0; i < cal.firstDow; i++) blanks += '<div class="cal-cell blank"></div>';

    var cellsHtml = cal.cells.map(function (c) {
      var dayEvs = evMap[c.date] || [];
      var tip = c.date + (c.amount > 0 ? '：¥' + C.money(c.amount) + '，' + c.count + ' 笔' : '：没有记录');
      if (dayEvs.length) tip += '\n日程：' + dayEvs.map(function (e) { return (e.time ? e.time + ' ' : '') + e.summary; }).join('、');
      return '<button class="cal-cell' + (c.level ? ' has-data lvl' + c.level : '') +
        (c.date === today ? ' today' : '') +
        '" data-act="open-day" data-date="' + c.date + '" title="' + esc(tip) + '">' +
        '<span class="cal-day">' + c.day + '</span>' +
        (c.amount > 0 ? '<span class="cal-amt">' + C.moneyShort(c.amount) + '</span>' : '') +
        (dayEvs.length ? '<span class="cal-dot" title="' + dayEvs.length + ' 个日程"></span>' : '') +
      '</button>';
    }).join('');

    var tail = (7 - ((cal.firstDow + cal.days) % 7)) % 7;
    var tailStr = '';
    for (var j = 0; j < tail; j++) tailStr += '<div class="cal-cell blank"></div>';

    var activeDays = cal.cells.filter(function (c) { return c.amount > 0; }).length;
    var peak = cal.cells.reduce(function (a, c) { return c.amount > a.amount ? c : a; },
      { amount: 0, day: 0, date: '' });
    var monthEvents = (state.events || []).filter(function (e) { return e.date.slice(0, 7) === view.month; }).length;

    return '<section class="card cal-card">' +
      '<div class="card-head"><h3>' + st.label + ' · 日历</h3>' +
        '<span class="muted">格子里是当天花销，颜色越深花得越多</span></div>' +
      '<div class="cal-sum">' +
        '<div class="cal-kpi"><span>本月合计</span><b>¥' + C.money(st.spent) + '</b></div>' +
        '<div class="cal-kpi"><span>有记录的天</span><b>' + activeDays + ' 天</b></div>' +
        '<div class="cal-kpi"><span>最高单日</span><b>' +
          (peak.amount > 0 ? '¥' + C.money(peak.amount) : '—') + '</b>' +
          (peak.amount > 0 ? '<i>' + peak.day + ' 日</i>' : '') + '</div>' +
        '<div class="cal-kpi"><span>本月日程</span><b>' + monthEvents + ' 个</b>' +
          (monthEvents ? '<i>点日期可看</i>' : '<i>设置页可导入</i>') + '</div>' +
      '</div>' +
      '<div class="cal-week">' +
        ['日', '一', '二', '三', '四', '五', '六'].map(function (w) {
          return '<span>' + w + '</span>';
        }).join('') +
      '</div>' +
      '<div class="cal-grid">' + blanks + cellsHtml + tailStr + '</div>' +
      '<p class="hint" style="margin-top:14px">格子里的小圆点表示那天有日程。点任意一天，可以看当天每一笔和日程，也能直接补记。</p>' +
    '</section>';
  }

  /* ---------------- 分类 ---------------- */
  function categoriesHTML(st) {
    var rows = state.categories.map(function (c) {
      var cs = st.categories.filter(function (x) { return x.id === c.id; })[0] || { amount: 0 };
      var pct = c.budget > 0 ? Math.min(100, cs.amount / c.budget * 100) : 0;
      var over = c.budget > 0 && cs.amount > c.budget;
      var usage = c.budget > 0
        ? '<div class="mini-bar"><i style="width:' + pct + '%;background:' + (over ? '#e5484d' : c.color) + '"></i></div>' +
          '<span class="' + (over ? 'danger-text' : 'muted') + '">本月 ¥' + C.money(cs.amount) +
            ' / ¥' + C.money(c.budget) + (over ? '（超支）' : '') + '</span>'
        : '<span class="muted">本月 ¥' + C.money(cs.amount) + '，还没设预算</span>';
      return '<div class="cat-row">' +
        '<input type="color" class="cat-color" value="' + esc(c.color) + '" data-act="cat-color" data-id="' + esc(c.id) + '" title="改颜色">' +
        '<input class="cat-name" value="' + esc(c.name) + '" data-act="cat-name" data-id="' + esc(c.id) + '">' +
        '<div class="cat-budget"><span>预算</span>' +
          '<input type="number" min="0" step="10" class="num-in" placeholder="0" value="' +
          (c.budget > 0 ? c.budget : '') + '" data-act="cat-budget" data-id="' + esc(c.id) + '">' +
          '<span>元/月</span></div>' +
        '<div class="cat-usage' + (c.budget > 0 ? '' : ' plain') + '">' + usage + '</div>' +
        '<button class="icon-btn tiny danger" data-act="del-cat" data-id="' + esc(c.id) + '" title="删除分类">✕</button>' +
      '</div>';
    }).join('');

    var total = C.catBudgetTotal(state);
    return '<section class="card">' +
      '<div class="card-head"><h3>分类与预算</h3>' +
        '<button class="btn ghost small" data-act="add-cat">＋ 新增分类</button></div>' +
      '<p class="muted" style="margin:-6px 0 14px">给每个分类设月预算，总览页的占比图和预警会跟着变。' +
        (total > 0 ? ' 分类预算合计 <b>¥' + C.money(total) + '</b>，自动作为本月预算。' : '') + '</p>' +
      '<div class="cat-list">' + rows + '</div>' +
    '</section>';
  }

  /* ---------------- 账户 ---------------- */
  function accountsHTML(st) {
    var ab = C.accountBalances(state, view.month);
    var total = (state.accounts || []).reduce(function (a, x) { return a + (ab.balance[x.id] || 0); }, 0);
    var defAcc = pickAccount({ pay: '', accountId: '' });
    var defLabel = (state.accounts || []).filter(function (a) { return a.id === defAcc; })[0];

    var rows = (state.accounts || []).map(function (a) {
      var bal = ab.balance[a.id] || 0;
      var flow = ab.flow[a.id] || 0;
      var used = state.records.filter(function (r) {
        return C.recType(r) !== 'transfer' && r.accountId === a.id;
      }).length;
      return '<div class="acc-row">' +
        '<i class="acc-dot" style="background:' + esc(a.color) + '"></i>' +
        '<div class="acc-main">' +
          '<div class="acc-name">' + esc(a.name) +
            (a.id === defAcc ? '<span class="acc-tag">默认</span>' : '') + '</div>' +
          '<div class="acc-sub">本月变动 ' +
            '<span class="' + (flow >= 0 ? 'pos' : 'neg') + '">' + (flow >= 0 ? '+' : '') + C.money(flow) + '</span>' +
            (used ? ' · 共 ' + used + ' 笔' : '') + '</div>' +
        '</div>' +
        '<div class="acc-bal' + (bal < 0 ? ' neg' : '') + '">¥' + C.money(bal) + '</div>' +
        (used ? '<button class="icon-btn tiny" data-act="fix-acc" data-id="' + esc(a.id) + '" title="把这里的记录批量改到别的账户">⇄</button>' : '') +
        '<button class="icon-btn tiny" data-act="edit-acc" data-id="' + esc(a.id) + '" title="编辑">✎</button>' +
        '<button class="icon-btn tiny danger" data-act="del-acc" data-id="' + esc(a.id) + '" title="删除">✕</button>' +
      '</div>';
    }).join('');

    return '<div class="grid2">' +
      '<section class="card">' +
        '<div class="card-head"><h3>账户</h3>' +
          '<button class="btn ghost small" data-act="add-acc">＋ 新增账户</button></div>' +
        '<div class="acc-total"><span>总资产</span><b class="' + (total < 0 ? 'neg' : '') + '">¥' + C.money(total) + '</b></div>' +
        '<div class="acc-list">' + rows + '</div>' +
        '<p class="hint">余额 = 初始余额 + 收入 − 支出 ± 转账。' +
          '<b>总资产</b>含全部历史记录；总览页的<b>本月结余</b>只算当月收入减当月支出，两个数口径不一样，对不上是正常的。</p>' +
        '<p class="hint">没写支付方式时，新记录默认记到「<b>' + esc(defLabel ? defLabel.name : '—') + '</b>」。' +
          '点账户右边的 ⇄ 可以把记错账户的记录批量转移。</p>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h3>本月各账户进出</h3></div>' +
        accountFlowBars(ab) +
        '<div class="btn-row" style="margin-top:16px">' +
          '<button class="btn primary" data-act="open-add">＋ 记一笔支出</button>' +
          '<button class="btn ghost" data-act="open-add-income">＋ 记一笔收入</button>' +
          '<button class="btn ghost" data-act="open-add-transfer">↔ 转账</button>' +
        '</div>' +
      '</section>' +
    '</div>';
  }

  function accountFlowBars(ab) {
    var max = 1;
    (state.accounts || []).forEach(function (a) {
      max = Math.max(max, Math.abs(ab.flow[a.id] || 0));
    });
    return '<div class="flow-list">' + (state.accounts || []).map(function (a) {
      var f = ab.flow[a.id] || 0;
      var w = Math.abs(f) / max * 100;
      return '<div class="flow-row">' +
        '<span class="flow-name">' + esc(a.name) + '</span>' +
        '<div class="flow-track">' +
          '<i style="width:' + w + '%;background:' + (f >= 0 ? '#1FBF84' : '#E5484D') + '"></i>' +
        '</div>' +
        '<span class="flow-amt ' + (f >= 0 ? 'pos' : 'neg') + '">' +
          (f >= 0 ? '+' : '') + C.money(f) + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ---------------- 设置 ---------------- */
  function settingsHTML(st) {
    var mb = state.settings.monthBudgets || {};
    var ov = mb[view.month];
    var events = state.events || [];
    var upcoming = events
      .filter(function (e) { return e.date >= C.todayStr(); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var nextEv = upcoming[0];

    return '<div class="grid2">' +
      '<section class="card">' +
        '<div class="card-head"><h3>预算</h3></div>' +
        '<label class="field"><span>默认月预算</span>' +
          '<input type="number" min="0" step="100" id="defBudget" class="num-in wide" value="' +
          (state.settings.defaultMonthlyBudget || 0) + '"></label>' +
        '<p class="hint">所有月份通用。如果分类表里给分类设了预算，则优先用「分类预算之和」。</p>' +
        '<label class="field"><span>' + st.label + '</span>' +
          '<input type="number" min="0" step="100" id="monthBudget" class="num-in wide" value="' +
          (ov === undefined || ov === null ? '' : ov) + '" placeholder="留空用默认值"></label>' +
        '<p class="hint">只想给某个月特殊设定（比如春节月多留点）就填这里，留空表示跟随默认值。</p>' +
        '<label class="field"><span>存款目标</span>' +
          '<input type="number" min="0" step="100" id="savingsGoal" class="num-in wide" value="' +
          (state.settings.savingsGoal || 0) + '" placeholder="0 = 不设"></label>' +
        '<p class="hint">每月想存多少。设了之后，总览页会显示本月结余离目标还差多少。</p>' +
        '<button class="btn primary" data-act="save-budget">保存</button>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h3>数据</h3></div>' +
        '<div class="btn-row">' +
          '<button class="btn ghost" data-act="export-xlsx">导出 Excel</button>' +
          '<button class="btn ghost" data-act="export-csv">导出本月 CSV</button>' +
          '<button class="btn ghost" data-act="export-json">备份 JSON</button>' +
          '<button class="btn ghost" data-act="import-json">导入备份</button>' +
        '</div>' +
        '<p class="hint">数据存在这台电脑的浏览器里，换浏览器或清理缓存会丢，建议定期「备份 JSON」。</p>' +
        '<div class="danger-zone"><span>清空全部数据</span>' +
          '<button class="btn danger small" data-act="clear-all">清空</button></div>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h3>日历日程</h3></div>' +
        '<p class="hint" style="margin-top:-6px">把日历导进来：有日程的日子，日历上会打个小圆点；' +
          '标题里带金额的（比如「交房租 3000」）能在当天弹窗里一键记成支出。</p>' +
        '<div class="btn-row">' +
          '<button class="btn ghost" data-act="import-ics">导入 .ics 日历文件</button>' +
          '<button class="btn ghost" data-act="clear-events">清除日程</button>' +
        '</div>' +
        '<div class="kv"><span>已导入日程</span><b>' + events.length + ' 条</b></div>' +
        (events.length
          ? '<div class="kv"><span>下一条日程</span><b>' +
            (nextEv ? esc(nextEv.date.slice(5)) + ' ' + esc(nextEv.summary) : '都在过去了') + '</b></div>'
          : '') +
        '<p class="hint" style="margin-top:12px"><b>日历文件从哪来：</b><br>' +
          '· Windows 日历：设置 → 管理账户 → 导出<br>' +
          '· Outlook：文件 → 另存为 → iCalendar 格式<br>' +
          '· 手机 / Google 日历：设置 → 导出日历<br>' +
          '· 或者双击「读取我的日历.bat」，直接读这台电脑的 Windows 日历</p>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h3>自动备份</h3></div>' +
        '<div class="bk-row">' +
          '<div class="bk-dot' + (backupFile ? ' on' : (pendingHandle ? ' pending' : '')) + '"></div>' +
          '<div class="bk-main">' +
            '<div class="bk-title">' +
              (backupFile ? '已开启 · 自动写入文件'
                : pendingHandle ? '需要重新授权' : '未开启，建议开启') + '</div>' +
            '<div class="bk-sub">' +
              (backupFile
                ? '每改一次数据，1 秒后自动写入 JSON 文件' +
                  (lastFileBackupAt ? ' · 上次 ' + fmtTime(lastFileBackupAt) : '')
                : pendingHandle ? '浏览器重启后需要再点一次授权'
                : '选一个文件位置，以后记账会自动存一份到那里') + '</div>' +
          '</div>' +
          (backupFile
            ? '<button class="btn ghost small" data-act="stop-backup">关闭</button>'
            : pendingHandle
              ? '<button class="btn primary small" data-act="regrant-backup">授权</button>'
              : '<button class="btn primary small" data-act="choose-backup">选择位置</button>') +
        '</div>' +
        '<div class="bk-row">' +
          '<div class="bk-dot' + (readSnaps().length ? ' on' : '') + '"></div>' +
          '<div class="bk-main">' +
            '<div class="bk-title">本地快照 · ' + readSnaps().length + ' 份</div>' +
            '<div class="bk-sub">' +
              (readSnaps().length
                ? '最近一份 ' + fmtTime(readSnaps()[0].t) + '，可随时恢复到过去的版本'
                : '还没有快照，改点数据就会自动生成') + '</div>' +
          '</div>' +
          (readSnaps().length
            ? '<button class="btn ghost small" data-act="open-snapshots">查看</button>'
            : '') +
        '</div>' +
        (backupError ? '<p class="hint" style="color:#e5484d">上次自动备份失败：' + esc(backupError) + '</p>' : '') +
        '<p class="hint">「自动写入文件」需要你选一次保存位置，之后每次改动都会自动更新那个文件。' +
          '本地快照存在浏览器里，用来撤销误操作。真要防丢，两个都开最稳。</p>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h3>统计概况</h3></div>' +
        '<div class="kv"><span>记录总数</span><b>' + state.records.length + ' 笔</b></div>' +
        '<div class="kv"><span>最早记录</span><b>' +
          (state.records.length ? state.records.map(function (r) { return r.date; }).sort()[0] : '—') + '</b></div>' +
        '<div class="kv"><span>累计支出</span><b>¥' +
          C.money(state.records.reduce(function (a, r) { return a + r.amount; }, 0)) + '</b></div>' +
        '<div class="kv"><span>存储位置</span><b>浏览器本地</b></div>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h3>AI 智能记账</h3>' +
          '<span class="muted">可选</span></div>' +
        '<p class="hint" style="margin-top:-6px">规则认不出来的句子（比如「和小李 AA 我先垫的 180」），' +
          '会交给 AI 解析。不填也能正常用，只是遇到复杂句子会认不准。</p>' +
        '<label class="field"><span>接口地址</span>' +
          '<input id="aiBase" class="txt-in" value="' + esc(state.ai.baseUrl || 'https://api.deepseek.com') +
          '" placeholder="https://api.deepseek.com"></label>' +
        '<label class="field"><span>模型</span>' +
          '<input id="aiModel" class="txt-in" value="' + esc(state.ai.model || 'deepseek-chat') +
          '" placeholder="deepseek-chat"></label>' +
        '<label class="field"><span>API Key</span>' +
          '<input id="aiKey" type="password" class="txt-in" value="' + esc(state.ai.key || '') +
          '" placeholder="sk-..."></label>' +
        '<p class="hint">Key 只存在这台电脑的浏览器里，不会上传到别处。' +
          '如果你用的服务不支持浏览器直接调用（跨域被拦），会提示失败，规则记账不受影响。</p>' +
        '<div class="btn-row">' +
          '<button class="btn primary" data-act="save-ai">保存</button>' +
          '<button class="btn ghost" data-act="test-ai">测试连接</button>' +
        '</div>' +
      '</section>' +
    '</div>';
  }

  /* ---------------- 弹窗 ---------------- */
  function modalHTML() {
    if (!view.modal) return '';

    if (view.modal === 'add' || view.modal === 'edit') {
      var r = view.editingId
        ? state.records.filter(function (x) { return x.id === view.editingId; })[0]
        : null;
      var defaultCat = state.categories[0] ? state.categories[0].id : '';
      var accounts = state.accounts || [];
      var defaultAcc = pickAccount({ pay: '', accountId: '' });
      var d = r || {
        type: 'expense',
        date: view.presetDate || C.todayStr(),
        categoryId: defaultCat,
        accountId: defaultAcc,
        toAccountId: accounts[1] ? accounts[1].id : defaultAcc,
        item: view.presetItem || '',
        amount: view.presetAmount || '',
        pay: '',
        note: ''
      };
      var ftype = view.formType || C.recType(d);
      if (r) d.type = C.recType(d);

      var opts = state.categories.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === d.categoryId && ftype === 'expense' ? ' selected' : '') + '>' +
          esc(c.name) + '</option>';
      }).join('');
      var incOpts = (state.incomeCategories || []).map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === d.categoryId && ftype === 'income' ? ' selected' : '') + '>' +
          esc(c.name) + '</option>';
      }).join('');
      var accOpts = accounts.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (a.id === d.accountId ? ' selected' : '') + '>' +
          esc(a.name) + '</option>';
      }).join('');
      var toAccOpts = accounts.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (a.id === d.toAccountId ? ' selected' : '') + '>' +
          esc(a.name) + '</option>';
      }).join('');

      var segs = [['expense', '支出'], ['income', '收入'], ['transfer', '转账']].map(function (s) {
        return '<button type="button" class="seg-btn' + (ftype === s[0] ? ' on' : '') +
          '" data-act="form-type" data-type="' + s[0] + '">' + s[1] + '</button>';
      }).join('');

      return '<div class="modal-mask"><div class="modal">' +
        '<div class="modal-head"><h3>' + (r ? '编辑记录' : '记一笔') + '</h3>' +
          '<button class="icon-btn" data-act="close-modal">✕</button></div>' +
        '<div class="seg" data-ftype="' + ftype + '">' + segs + '</div>' +
        '<div class="form">' +
          '<label class="field"><span>金额</span>' +
            '<input type="number" step="0.01" min="0" id="fAmount" class="num-in wide big" value="' +
            esc(d.amount) + '" placeholder="0.00"></label>' +
          '<label class="field fld-expense"><span>分类</span><select id="fCat" class="sel">' + opts + '</select></label>' +
          '<label class="field fld-income"><span>来源</span><select id="fIncCat" class="sel">' + incOpts + '</select></label>' +
          '<label class="field fld-expense fld-income"><span id="accLabel">账户</span>' +
            '<select id="fAcc" class="sel">' + accOpts + '</select></label>' +
          '<label class="field fld-transfer"><span>转出</span><select id="fFrom" class="sel">' + accOpts + '</select></label>' +
          '<label class="field fld-transfer"><span>转入</span><select id="fTo" class="sel">' + toAccOpts + '</select></label>' +
          '<label class="field"><span>项目</span>' +
            '<input id="fItem" class="txt-in" value="' + esc(d.item) + '" placeholder="比如 食堂午饭"></label>' +
          '<label class="field"><span>日期</span>' +
            '<input type="date" id="fDate" class="txt-in" value="' + esc(d.date) + '"></label>' +
          '<label class="field"><span>备注</span>' +
            '<input id="fNote" class="txt-in" value="' + esc(r ? r.note : '') + '" placeholder="可不填"></label>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn ghost" data-act="close-modal">取消</button>' +
          (r ? '<button class="btn danger" data-act="del-rec" data-id="' + esc(r.id) + '">删除</button>' : '') +
          '<button class="btn primary" data-act="save-rec">' + (r ? '保存' : '记下') + '</button>' +
        '</div>' +
      '</div></div>';
    }

    if (view.modal === 'budget') {
      var mb = state.settings.monthBudgets || {};
      var cur = mb[view.month] !== undefined && mb[view.month] !== null
        ? mb[view.month] : C.monthBudget(state, view.month);
      return '<div class="modal-mask"><div class="modal small">' +
        '<div class="modal-head"><h3>调整本月预算</h3><button class="icon-btn" data-act="close-modal">✕</button></div>' +
        '<div class="form"><label class="field"><span>' + C.monthLabel(view.month) + '</span>' +
          '<input type="number" step="100" min="0" id="fBudget" class="num-in wide big" value="' + cur + '"></label>' +
          '<p class="hint">只影响 ' + C.monthLabel(view.month) + '，其他月份仍用默认预算。</p></div>' +
        '<div class="modal-foot"><button class="btn ghost" data-act="close-modal">取消</button>' +
          '<button class="btn primary" data-act="save-month-budget">保存</button></div>' +
      '</div></div>';
    }

    if (view.modal === 'chgacc') {
      var cr = state.records.filter(function (x) { return x.id === view.chgAccId; })[0];
      if (!cr) return '';
      var isXfer = C.recType(cr) === 'transfer';
      var pickList = (state.accounts || []).map(function (a) {
        var on = a.id === cr.accountId;
        return '<button class="acc-pick-btn' + (on ? ' on' : '') +
          '" data-act="do-change-acc" data-id="' + esc(a.id) + '">' +
          '<i style="background:' + esc(a.color) + '"></i>' +
          '<span>' + esc(a.name) + '</span>' +
          (on ? '<em>当前</em>' : '') +
        '</button>';
      }).join('');
      return '<div class="modal-mask"><div class="modal small">' +
        '<div class="modal-head"><h3>换个账户</h3>' +
          '<button class="icon-btn" data-act="close-modal">✕</button></div>' +
        '<div class="chg-info">' +
          '<span>' + esc(cr.item || '支出') + '</span>' +
          '<b>¥' + C.money(cr.amount) + '</b>' +
        '</div>' +
        (isXfer ? '<p class="hint">这是转账记录，请用编辑功能改转出/转入。</p>' : '') +
        '<div class="acc-pick">' + (isXfer ? '' : pickList) + '</div>' +
        '<div class="modal-foot"><button class="btn ghost" data-act="close-modal">取消</button></div>' +
      '</div></div>';
    }

    if (view.modal === 'fixacc') {
      var src = accountOf(view.fixAccId);
      if (!src) return '';
      var n = state.records.filter(function (r) {
        return C.recType(r) !== 'transfer' && r.accountId === src.id;
      }).length;
      var others = (state.accounts || []).filter(function (a) { return a.id !== src.id; });
      var opts2 = others.map(function (a) {
        return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>';
      }).join('');
      return '<div class="modal-mask"><div class="modal small">' +
        '<div class="modal-head"><h3>转移「' + esc(src.name) + '」的记录</h3>' +
          '<button class="icon-btn" data-act="close-modal">✕</button></div>' +
        '<div class="form">' +
          '<p class="hint" style="margin-top:0">这个账户下有 <b>' + n + '</b> 笔收支记录。' +
            '选一个目标账户，把它们全部转过去（转账记录不受影响）。</p>' +
          '<label class="field"><span>转去</span><select id="fFixTo" class="sel">' + opts2 + '</select></label>' +
          '<p class="hint">常见用途：之前没写支付方式，记录全落在「现金」上，现在一次性纠正。</p>' +
        '</div>' +
        '<div class="modal-foot"><button class="btn ghost" data-act="close-modal">取消</button>' +
          '<button class="btn primary" data-act="do-fix-acc" data-from="' + esc(src.id) + '">转移 ' + n + ' 笔</button></div>' +
      '</div></div>';
    }

    if (view.modal === 'acc') {
      var acc = view.editingId ? accountOf(view.editingId) : null;
      var isDefault = !!acc && state.settings.defaultAccountId === acc.id;
      return '<div class="modal-mask"><div class="modal small">' +
        '<div class="modal-head"><h3>' + (acc ? '编辑账户' : '新增账户') + '</h3>' +
          '<button class="icon-btn" data-act="close-modal">✕</button></div>' +
        '<div class="form">' +
          '<label class="field"><span>名称</span><input id="fAccName" class="txt-in" value="' +
            esc(acc ? acc.name : '') + '" placeholder="比如 招行储蓄卡"></label>' +
          '<label class="field"><span>颜色</span><input type="color" id="fAccColor" class="cat-color big" value="' +
            esc(acc ? acc.color : '#4C8DFF') + '"></label>' +
          '<label class="field"><span>初始余额</span>' +
            '<input type="number" step="0.01" id="fAccInit" class="num-in wide" value="' +
            (acc ? acc.initBalance : 0) + '" placeholder="0"></label>' +
          (acc
            ? '<label class="check-row"><input type="checkbox" id="fAccDefault"' + (isDefault ? ' checked' : '') + '>' +
              '<span>设为默认账户（没说支付方式时记到这里）</span></label>'
            : '') +
          '<p class="hint">初始余额是你开始记账那一刻这个账户里有多少钱。' +
            '余额 = 初始余额 + 收入 − 支出 ± 转账。</p>' +
        '</div>' +
        '<div class="modal-foot"><button class="btn ghost" data-act="close-modal">取消</button>' +
          '<button class="btn primary" data-act="save-acc">' + (acc ? '保存' : '添加') + '</button></div>' +
      '</div></div>';
    }

    if (view.modal === 'addcat') {
      return '<div class="modal-mask"><div class="modal small">' +
        '<div class="modal-head"><h3>新增分类</h3><button class="icon-btn" data-act="close-modal">✕</button></div>' +
        '<div class="form">' +
          '<label class="field"><span>名称</span><input id="fCatName" class="txt-in" placeholder="比如 宠物"></label>' +
          '<label class="field"><span>颜色</span><input type="color" id="fCatColor" class="cat-color big" value="#4C8DFF"></label>' +
          '<label class="field"><span>月预算</span><input type="number" min="0" step="10" id="fCatBudget" class="num-in wide" value="0"></label>' +
        '</div>' +
        '<div class="modal-foot"><button class="btn ghost" data-act="close-modal">取消</button>' +
          '<button class="btn primary" data-act="save-cat">添加</button></div>' +
      '</div></div>';
    }

    if (view.modal === 'day') {
      var dayEvs = (state.events || []).filter(function (e) { return e.date === view.dayDetail; });
      var dayRecs = state.records
        .filter(function (r) { return r.date === view.dayDetail; })
        .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      var daySum = dayRecs.reduce(function (a, r) { return a + r.amount; }, 0);

      var evHtml = dayEvs.length
        ? '<div class="day-section"><div class="day-section-t">当天日程</div>' +
          dayEvs.map(function (e) {
            return '<div class="ev-row">' +
              '<span class="ev-time">' + (e.allDay ? '全天' : esc(e.time || '')) + '</span>' +
              '<div class="ev-main">' +
                '<div class="ev-title">' + esc(e.summary) + '</div>' +
                (e.location ? '<div class="ev-meta">' + esc(e.location) + '</div>' : '') +
              '</div>' +
              (e.amount
                ? '<button class="btn primary small" data-act="spend-from-event" data-date="' + esc(view.dayDetail) +
                  '" data-amount="' + e.amount + '" data-item="' + esc(e.summary) + '">记 ¥' + C.money(e.amount) + '</button>'
                : '') +
            '</div>';
          }).join('') + '</div>'
        : '';

      var recHtml = '<div class="day-section"><div class="day-section-t">当天支出</div>' +
        (dayRecs.length
          ? dayRecs.map(function (r) { return recordRowHTML(r, true); }).join('')
          : '<div class="empty small"><p>这天还没有记账</p></div>') +
        '</div>';

      return '<div class="modal-mask"><div class="modal">' +
        '<div class="modal-head"><h3>' + esc(humanDate(view.dayDetail)) + '</h3>' +
          '<button class="icon-btn" data-act="close-modal">✕</button></div>' +
        '<div class="day-sum-bar">支出 <b>' + dayRecs.length + '</b> 笔，合计 <b>¥' + C.money(daySum) + '</b>' +
          (dayEvs.length ? ' · 日程 <b>' + dayEvs.length + '</b> 个' : '') + '</div>' +
        evHtml + recHtml +
        '<div class="modal-foot">' +
          '<button class="btn ghost" data-act="close-modal">关闭</button>' +
          '<button class="btn primary" data-act="add-on-day" data-date="' + esc(view.dayDetail) + '">在这天记一笔</button>' +
        '</div>' +
      '</div></div>';
    }
    if (view.modal === 'snapshots') {
      var snaps = readSnaps();
      var rows = snaps.length
        ? snaps.map(function (s, i) {
          return '<div class="snap-row">' +
            '<div class="snap-idx">' + (i + 1) + '</div>' +
            '<div class="snap-main">' +
              '<div class="snap-time">' + esc(fmtTime(s.t)) +
                (i === 0 ? '<span class="tag">最新</span>' : '') + '</div>' +
              '<div class="snap-meta">' + s.n + ' 笔记录 · ' +
                esc(s.reason === 'auto' ? '自动保存' : s.reason) + '</div>' +
            '</div>' +
            '<button class="btn ghost small" data-act="restore-snapshot" data-ts="' + s.t + '">恢复</button>' +
          '</div>';
        }).join('')
        : '<div class="empty small"><p>还没有快照</p></div>';
      return '<div class="modal-mask"><div class="modal">' +
        '<div class="modal-head"><h3>本地快照</h3>' +
          '<button class="icon-btn" data-act="close-modal">✕</button></div>' +
        '<p class="hint" style="margin:-8px 0 14px">每次删记录、清数据、导入备份之前都会自动存一份，最多保留 ' +
          MAX_SNAPS + ' 份。恢复前也会先给当前数据存一份，不会丢东西。</p>' +
        '<div class="snap-list">' + rows + '</div>' +
        '<div class="modal-foot"><button class="btn primary" data-act="close-modal">关闭</button></div>' +
      '</div></div>';
    }
    return '';
  }

  /* ---------------- 事件（全局委托，只绑一次） ---------------- */
  function bindGlobal() {
    $('#app').addEventListener('click', function (e) {
      // 点遮罩空白处关闭弹窗
      if (e.target.classList && e.target.classList.contains('modal-mask')) { closeModal(); return; }

      // 扇区
      var slice = e.target.closest && e.target.closest('.slice');
      if (slice) {
        var parts = C.pieSlices(C.monthStats(state, view.month), 0.02);
        var s = parts[+slice.getAttribute('data-idx')];
        if (!s) return;
        if (s.id === '__merged') { toast('这里是几个小分类，点右侧图例看详情'); return; }
        view.filterCat = s.id; setTab('records'); return;
      }

      var el = e.target.closest && e.target.closest('[data-act]');
      if (!el) return;
      var act = el.getAttribute('data-act');
      var id = el.getAttribute('data-id');

      switch (act) {
        case 'close-modal': closeModal(); break;
        case 'switch-tab':
          setTab(el.getAttribute('data-tab')); break;
        case 'prev-month':
          view.month = C.addMonths(view.month, -1); view.filterCat = ''; render(); break;
        case 'next-month':
          view.month = C.addMonths(view.month, 1); view.filterCat = ''; render(); break;
        case 'this-month':
          view.month = C.ym(new Date()); view.filterCat = ''; render(); break;
        case 'goto-month':
          view.month = el.getAttribute('data-month'); view.filterCat = ''; render(); break;
        case 'form-type':
          view.formType = el.getAttribute('data-type');
          var seg = el.closest('.seg');
          if (seg) seg.setAttribute('data-ftype', view.formType);
          $$('.seg-btn', seg).forEach(function (b) {
            b.classList.toggle('on', b.getAttribute('data-type') === view.formType);
          });
          applyFormType(view.formType);
          break;
        case 'open-add': view.modal = 'add'; view.editingId = null; view.presetDate = ''; view.formType = 'expense'; render(); break;
        case 'open-add-income': view.modal = 'add'; view.editingId = null; view.presetDate = ''; view.formType = 'income'; render(); break;
        case 'open-add-transfer': view.modal = 'add'; view.editingId = null; view.presetDate = ''; view.formType = 'transfer'; render(); break;
        case 'open-day': view.dayDetail = el.getAttribute('data-date'); view.modal = 'day'; render(); break;
        case 'add-on-day':
          view.presetDate = el.getAttribute('data-date');
          view.presetAmount = '';
          view.presetItem = '';
          view.editingId = null;
          view.modal = 'add';
          render();
          break;
        case 'spend-from-event':
          view.presetDate = el.getAttribute('data-date');
          view.presetAmount = el.getAttribute('data-amount');
          view.presetItem = el.getAttribute('data-item');
          view.editingId = null;
          view.modal = 'add';
          render();
          break;
        case 'import-ics': importICS(); break;
        case 'clear-events': clearEvents(); break;
        case 'choose-backup': chooseBackupFile(); break;
        case 'regrant-backup': reGrantBackup(); break;
        case 'stop-backup': stopBackup(); break;
        case 'open-snapshots': openSnapshots(); break;
        case 'restore-snapshot': restoreSnapshot(+el.getAttribute('data-ts')); break;
        case 'dismiss-alert':
          try { localStorage.setItem('moneybook.alertDismissed', C.todayStr()); } catch (e) { /* ignore */ }
          render();
          break;
        case 'dismiss-misacc':
          try { localStorage.setItem('moneybook.misAccHint', 'off'); } catch (e) { /* ignore */ }
          render();
          break;
        case 'quick-add': quickAdd(); break;
        case 'filter-cat':
          view.filterCat = el.getAttribute('data-cat') || '';
          setTab('records'); break;
        case 'edit-rec':
          view.editingId = id;
          view.formType = (function () {
            var rr = state.records.filter(function (x) { return x.id === id; })[0];
            return rr ? C.recType(rr) : 'expense';
          })();
          view.modal = 'edit';
          render();
          break;
        case 'del-rec': delRecord(id); break;
        case 'save-rec': saveRecord(); break;
        case 'edit-budget': view.modal = 'budget'; render(); break;
        case 'save-month-budget': saveMonthBudget(); break;
        case 'add-cat': view.modal = 'addcat'; render(); break;
        case 'save-cat': saveCat(); break;
        case 'del-cat': delCat(id); break;
        case 'set-quick-acc':
          view.quickAccountId = el.getAttribute('data-id');
          syncQuickAccChips();
          break;
        case 'change-acc':
          view.chgAccId = id;
          view.modal = 'chgacc';
          render();
          break;
        case 'do-change-acc':
          doChangeAcc(el.getAttribute('data-id'));
          break;
        case 'fix-acc':
          view.fixAccId = id;
          view.modal = 'fixacc';
          render();
          break;
        case 'do-fix-acc':
          doFixAcc(el.getAttribute('data-from'));
          break;
        case 'add-acc': view.modal = 'acc'; view.editingId = null; render(); break;
        case 'edit-acc': view.modal = 'acc'; view.editingId = id; render(); break;
        case 'save-acc': saveAcc(); break;
        case 'del-acc': delAcc(id); break;
        case 'save-budget': saveBudgetSettings(); break;
        case 'save-ai': saveAi(); break;
        case 'test-ai': testAi(); break;
        case 'export-json': exportJSON(); break;
        case 'export-csv': exportCSV(); break;
        case 'export-xlsx': exportXLSX(); break;
        case 'import-json': importJSON(); break;
        case 'clear-demo': clearDemo(); break;
        case 'clear-all': clearAll(); break;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && view.modal) closeModal();
      if (e.key === 'Enter' && view.modal === 'budget') saveMonthBudget();
    });
  }

  /* ---------------- 事件（每次重绘后重绑） ---------------- */
  function applyFormType(t) {
    var map = {
      expense: ['.fld-expense', '.fld-income', '.fld-transfer'],
      income: ['.fld-expense', '.fld-income', '.fld-transfer'],
      transfer: ['.fld-expense', '.fld-income', '.fld-transfer']
    };
    $$('.fld-expense').forEach(function (el) { el.style.display = (t === 'expense') ? '' : 'none'; });
    $$('.fld-income').forEach(function (el) { el.style.display = (t === 'income') ? '' : 'none'; });
    $$('.fld-transfer').forEach(function (el) { el.style.display = (t === 'transfer') ? '' : 'none'; });
    var ib = $('#fItem');
    if (ib) {
      ib.placeholder = t === 'income' ? '比如 十月工资'
        : t === 'transfer' ? '比如 银行卡转微信' : '比如 食堂午饭';
    }
  }

  function bindLocal() {
    var qi = $('#quickInput');
    if (qi) {
      qi.addEventListener('input', function () {
        view.quickText = qi.value;
        updateHint(qi.value);
      });
      qi.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); quickAdd(); }
      });
    }

    $$('[data-act="cat-name"]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var c = state.categories.filter(function (x) { return x.id === inp.getAttribute('data-id'); })[0];
        if (!c) return;
        var v = inp.value.trim();
        if (!v) { render(); return; }
        c.name = v; save(); render();
      });
    });

    $$('[data-act="cat-color"]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var c = state.categories.filter(function (x) { return x.id === inp.getAttribute('data-id'); })[0];
        if (c) c.color = inp.value;
      });
      inp.addEventListener('change', function () { save(); render(); });
    });

    $$('[data-act="cat-budget"]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var c = state.categories.filter(function (x) { return x.id === inp.getAttribute('data-id'); })[0];
        if (c) { c.budget = Math.max(0, +inp.value || 0); save(); render(); }
      });
    });
  }

  function updateHint(text) {
    var hint = $('#quickHint');
    if (!hint) return;
    if (!text.trim()) {
      hint.innerHTML = '支持中文口语，自动识别金额、分类、账户和日期；说「发工资」「收到退款」会自动记成收入';
      hint.className = 'quick-hint';
      return;
    }
    var p = C.parseQuick(text, state);
    var isInc = p.type === 'income';
    var c = isInc ? incomeCatOf(p.categoryId) : catOf(p.categoryId);
    var acc = accountName(p.accountId);
    hint.innerHTML = '识别为：<b style="color:' + esc(c.color) + '">' +
      (isInc ? '收入 · ' : '') + esc(c.name) + '</b>' +
      (p.amount
        ? ' · <b>' + (isInc ? '+' : '') + '¥' + p.amount + '</b>'
        : (aiConfigured()
          ? ' · <span class="muted">金额没认出，会用 AI 解析</span>'
          : ' · <span class="danger-text">没认出金额</span>')) +
      ' · ' + (p.date ? esc(p.date) : '今天') +
      (acc ? ' · ' + esc(acc) : '');
    hint.className = 'quick-hint live';
  }

  /* ---------------- 动作 ---------------- */
  var TABS = ['overview', 'records', 'calendar', 'accounts', 'categories', 'settings'];

  function readHash() {
    var h = String(location.hash || '').replace(/^#/, '');
    return TABS.indexOf(h) >= 0 ? h : 'overview';
  }

  function setTab(t) {
    view.tab = t;
    view.modal = '';
    view.editingId = null;
    render();
    try { if (location.hash !== '#' + t) location.hash = t; } catch (e) { /* ignore */ }
  }

  function closeModal() {
    view.modal = ''; view.editingId = null;
    view.presetDate = ''; view.presetAmount = ''; view.presetItem = '';
    view.formType = '';
    render();
  }

  function saveRecord() {
    var amount = parseFloat($('#fAmount').value);
    if (!amount || amount <= 0) { toast('金额要大于 0', 'err'); return; }

    var ftype = $('#app .seg') ? $('#app .seg').getAttribute('data-ftype') : 'expense';
    var rec = {
      type: ftype,
      date: $('#fDate').value || C.todayStr(),
      item: $('#fItem').value.trim(),
      amount: C.round2(amount),
      note: $('#fNote').value.trim(),
      categoryId: '',
      accountId: '',
      toAccountId: '',
      pay: ''
    };

    if (ftype === 'expense') {
      rec.categoryId = $('#fCat').value;
      rec.accountId = $('#fAcc').value;
    } else if (ftype === 'income') {
      rec.categoryId = $('#fIncCat').value;
      rec.accountId = $('#fAcc').value;
    } else {
      rec.accountId = $('#fFrom').value;
      rec.toAccountId = $('#fTo').value;
      if (!rec.accountId || rec.accountId === rec.toAccountId) {
        toast('转出和转入不能是同一个账户', 'err');
        return;
      }
      if (!rec.item) rec.item = '转账';
    }

    if (view.modal === 'edit' && view.editingId) {
      var old = state.records.filter(function (x) { return x.id === view.editingId; })[0];
      if (old) Object.assign(old, rec);
      view.month = rec.date.slice(0, 7);
      toast('已保存');
    } else {
      rec.id = C.uid('rec');
      rec.createdAt = Date.now();
      state.records.push(rec);
      view.month = rec.date.slice(0, 7);
      toast((ftype === 'income' ? '记了收入 ¥' : ftype === 'transfer' ? '转账 ¥' : '记下了 ¥') + C.money(rec.amount));
    }
    rememberAccount(rec.accountId);
    save();
    closeModalSilent();
    render();
  }

  function closeModalSilent() {
    view.modal = '';
    view.editingId = null;
    view.presetDate = '';
    view.presetAmount = '';
    view.presetItem = '';
    view.formType = '';
  }

  // 决定这笔记到哪个账户：
  // ① 说清了支付方式 → 用那个
  // ② 用户明确设过「默认账户」→ 用它
  // ③ 否则用上次用过的账户（越用越顺手）
  // ④ 都没有 → 第一个账户
  function pickAccount(p, override) {
    var accounts = state.accounts || [];
    var exists = function (id) {
      return !!id && accounts.some(function (a) { return a.id === id; });
    };
    if (p && p.pay && exists(p.accountId)) return p.accountId;
    if (exists(override)) return override;
    if (exists(state.settings.defaultAccountId)) return state.settings.defaultAccountId;
    if (exists(state.settings.lastAccountId)) return state.settings.lastAccountId;
    return accounts.length ? accounts[0].id : '';
  }

  function rememberAccount(id) {
    if (!id) return;
    if (state.settings.lastAccountId === id) return;
    state.settings.lastAccountId = id;
  }

  function commitQuick(p) {
    var type = p.type || 'expense';
    var accId = pickAccount(p, quickAccId());
    var rec = {
      id: C.uid('rec'),
      type: type,
      createdAt: Date.now(),
      date: p.date || C.todayStr(),
      categoryId: p.categoryId,
      accountId: accId,
      item: p.item || (type === 'income' ? '收入' : '支出'),
      amount: C.round2(p.amount),
      pay: p.pay || '',
      toAccountId: '',
      note: ''
    };
    state.records.push(rec);
    rememberAccount(rec.accountId);
    // 记完就交还给「默认账户 / 上次账户」的规则，避免本次手选一直粘住
    view.quickAccountId = '';
    save();
    view.quickText = '';
    view.month = rec.date.slice(0, 7);
    render();
    var catName = type === 'income' ? incomeCatOf(rec.categoryId).name : catOf(rec.categoryId).name;
    var accName = accountName(rec.accountId);
    toast('已记为「' + catName + '」' + (type === 'income' ? '+' : '') + '¥' + C.money(rec.amount) +
      (accName ? ' · ' + accName : ''));
  }

  function quickAdd() {
    var inp = $('#quickInput');
    var text = inp ? inp.value : view.quickText;
    if (!text.trim()) { toast('先写点什么，比如「午饭 25」', 'err'); return; }

    var p = C.parseQuick(text, state);
    if (p.amount && p.amount > 0) { commitQuick(p); return; }

    // 规则没认出金额，交给 AI 试试
    if (aiConfigured()) {
      toast('正在让 AI 解析…');
      aiParse(text).then(function (r) {
        if (!r.amount || r.amount <= 0) { toast('AI 也没认出金额，补充一下数字试试', 'err'); return; }
        commitQuick(r);
      }).catch(function (e) {
        toast('AI 解析失败：' + e.message, 'err');
      });
      return;
    }
    toast('没认出金额，用「项目 25」这样的写法试试', 'err');
  }

  function delRecord(id) {
    var r = state.records.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    if (!confirm('删除这笔「' + (r.item || '支出') + ' ¥' + C.money(r.amount) + '」？')) return;
    makeSnapshot('删除一笔前', true);
    state.records = state.records.filter(function (x) { return x.id !== id; });
    save();
    view.modal = ''; view.editingId = null;
    render();
    toast('已删除');
  }

  function saveMonthBudget() {
    var v = $('#fBudget').value.trim();
    state.settings.monthBudgets = state.settings.monthBudgets || {};
    if (v === '') delete state.settings.monthBudgets[view.month];
    else state.settings.monthBudgets[view.month] = Math.max(0, +v || 0);
    save();
    view.modal = '';
    render();
    toast('预算已更新');
  }

  function doChangeAcc(toId) {
    var r = state.records.filter(function (x) { return x.id === view.chgAccId; })[0];
    if (!r) { toast('记录不见了', 'err'); return; }
    if (C.recType(r) === 'transfer') { toast('转账记录请用编辑改转出/转入', 'err'); return; }
    if (r.accountId === toId) { view.modal = ''; view.chgAccId = ''; render(); return; }
    makeSnapshot('改账户前', true);
    r.accountId = toId;
    rememberAccount(toId);
    if (view.quickAccountId) view.quickAccountId = toId;
    save();
    view.modal = ''; view.chgAccId = '';
    render();
    toast('已改到「' + accountName(toId) + '」');
  }

  function doFixAcc(fromId) {
    var toId = $('#fFixTo') ? $('#fFixTo').value : '';
    var src = accountOf(fromId);
    var dst = accountOf(toId);
    if (!src || !dst) { toast('账户不存在', 'err'); return; }
    var affected = state.records.filter(function (r) {
      return C.recType(r) !== 'transfer' && r.accountId === fromId;
    });
    if (!affected.length) { toast('这个账户下没有记录', 'err'); return; }
    if (!confirm('把「' + src.name + '」的 ' + affected.length + ' 笔记录全部转到「' + dst.name + '」？')) return;
    makeSnapshot('批量转移账户前', true);
    affected.forEach(function (r) { r.accountId = toId; });
    if (state.settings.lastAccountId === fromId) state.settings.lastAccountId = toId;
    save();
    view.modal = '';
    view.fixAccId = '';
    render();
    toast('已把 ' + affected.length + ' 笔转到「' + dst.name + '」');
  }

  function saveAcc() {
    var name = $('#fAccName').value.trim();
    if (!name) { toast('账户名不能为空', 'err'); return; }
    var init = Math.round((parseFloat($('#fAccInit').value) || 0) * 100) / 100;
    var wantDefault = $('#fAccDefault') ? $('#fAccDefault').checked : false;
    if (view.editingId) {
      var a = accountOf(view.editingId);
      if (a) {
        a.name = name;
        a.color = $('#fAccColor').value;
        a.initBalance = init;
        if (wantDefault) state.settings.defaultAccountId = a.id;
        else if (state.settings.defaultAccountId === a.id) delete state.settings.defaultAccountId;
      }
      toast('已保存');
    } else {
      if ((state.accounts || []).some(function (x) { return x.name === name; })) {
        toast('已经有这个账户了', 'err');
        return;
      }
      var newAcc = {
        id: C.uid('acc'),
        name: name,
        color: $('#fAccColor').value,
        initBalance: init
      };
      state.accounts.push(newAcc);
      toast('已添加账户「' + name + '」');
    }
    save();
    view.modal = ''; view.editingId = null;
    render();
  }

  function delAcc(id) {
    var a = accountOf(id);
    if (!a) return;
    if ((state.accounts || []).length <= 1) { toast('至少要保留一个账户', 'err'); return; }
    var used = state.records.filter(function (r) {
      return r.accountId === id || r.toAccountId === id;
    }).length;
    var msg = used
      ? '「' + a.name + '」下还有 ' + used + ' 笔记录，删除后这些记录会没有账户归属。确定删除？'
      : '删除账户「' + a.name + '」？';
    if (!confirm(msg)) return;
    makeSnapshot('删除账户前', true);
    state.accounts = state.accounts.filter(function (x) { return x.id !== id; });
    save();
    render();
    toast('已删除');
  }

  function saveCat() {
    var name = $('#fCatName').value.trim();
    if (!name) { toast('分类名不能为空', 'err'); return; }
    if (state.categories.some(function (c) { return c.name === name; })) { toast('已经有这个分类了', 'err'); return; }
    state.categories.push({
      id: C.uid('cat'),
      name: name,
      color: $('#fCatColor').value,
      budget: Math.max(0, +$('#fCatBudget').value || 0)
    });
    save();
    view.modal = '';
    render();
    toast('已添加分类「' + name + '」');
  }

  function delCat(id) {
    var c = state.categories.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var used = state.records.filter(function (r) { return r.categoryId === id; }).length;
    var msg = used
      ? '「' + c.name + '」下还有 ' + used + ' 笔记录，删除后这些记录会变成「未分类」。确定删除？'
      : '删除分类「' + c.name + '」？';
    if (!confirm(msg)) return;
    state.categories = state.categories.filter(function (x) { return x.id !== id; });
    save();
    render();
    toast('已删除');
  }

  function saveBudgetSettings() {
    var def = Math.max(0, +$('#defBudget').value || 0);
    state.settings.defaultMonthlyBudget = def;
    if ($('#savingsGoal')) state.settings.savingsGoal = Math.max(0, +$('#savingsGoal').value || 0);
    var ov = $('#monthBudget').value.trim();
    state.settings.monthBudgets = state.settings.monthBudgets || {};
    if (ov === '') delete state.settings.monthBudgets[view.month];
    else state.settings.monthBudgets[view.month] = Math.max(0, +ov || 0);
    save();
    render();
    toast('已保存');
  }

  /* ---------------- AI 记账 ---------------- */
  function aiConfigured() {
    return !!(state.ai && state.ai.key && state.ai.key.trim());
  }

  function saveAi() {
    state.ai = state.ai || {};
    state.ai.baseUrl = ($('#aiBase').value || '').trim().replace(/\/+$/, '') || 'https://api.deepseek.com';
    state.ai.model = ($('#aiModel').value || '').trim() || 'deepseek-chat';
    state.ai.key = ($('#aiKey').value || '').trim();
    state.ai.enabled = !!state.ai.key;
    save();
    render();
    toast(state.ai.key ? 'AI 已配置' : '已清空 AI 配置');
  }

  function aiRequest(messages) {
    var cfg = state.ai || {};
    if (!cfg.key) return Promise.reject(new Error('没有填 API Key'));
    var url = (cfg.baseUrl || 'https://api.deepseek.com') + '/chat/completions';
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        messages: messages,
        temperature: 0
      })
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + '：' + t.slice(0, 120));
        });
      }
      return r.json();
    }).then(function (j) {
      var content = j && j.choices && j.choices[0] && j.choices[0].message
        ? j.choices[0].message.content : '';
      return content;
    });
  }

  function testAi() {
    if (!$('#aiKey').value.trim()) { toast('先填 API Key', 'err'); return; }
    saveAiSilent();
    toast('正在测试…');
    aiRequest([
      { role: 'user', content: '只回复两个字：正常' }
    ]).then(function (txt) {
      toast('连接正常：' + String(txt).slice(0, 20));
    }).catch(function (e) {
      toast('连接失败：' + e.message, 'err');
    });
  }

  function saveAiSilent() {
    state.ai = state.ai || {};
    state.ai.baseUrl = ($('#aiBase').value || '').trim().replace(/\/+$/, '') || 'https://api.deepseek.com';
    state.ai.model = ($('#aiModel').value || '').trim() || 'deepseek-chat';
    state.ai.key = ($('#aiKey').value || '').trim();
    state.ai.enabled = !!state.ai.key;
    save();
  }

  // 用 AI 解析一句话，成功则返回和 parseQuick 同构的对象
  function aiParse(text) {
    var cats = state.categories.map(function (c) { return c.name; }).join('、');
    var incs = (state.incomeCategories || []).map(function (c) { return c.name; }).join('、');
    var accounts = (state.accounts || []).map(function (a) { return a.name; }).join('、');
    var today = C.todayStr();
    var sys = '你是一个记账助手。把用户的一句话解析成 JSON，只输出 JSON 本身，不要任何解释。\n' +
      '字段：\n' +
      '- type: 只能是 "expense"（支出）或 "income"（收入）\n' +
      '- amount: 数字，单位元\n' +
      '- category: 从对应列表里选一个中文名\n' +
      '- item: 不超过 12 个字的事项描述\n' +
      '- account: 从账户列表里选一个，没有提到就用第一个\n' +
      '- date: YYYY-MM-DD，没提到就用 ' + today + '\n' +
      '支出分类：' + cats + '\n' +
      '收入分类：' + incs + '\n' +
      '账户：' + accounts;

    return aiRequest([
      { role: 'system', content: sys },
      { role: 'user', content: text }
    ]).then(function (content) {
      var m = String(content).match(/\{[\s\S]*\}/);
      if (!m) throw new Error('AI 返回的不是 JSON');
      var o = JSON.parse(m[0]);
      var type = o.type === 'income' ? 'income' : 'expense';
      var list = type === 'income' ? (state.incomeCategories || []) : state.categories;
      var cat = list.filter(function (c) { return c.name === o.category; })[0] || list[0];
      var acc = (state.accounts || []).filter(function (a) { return a.name === o.account; })[0];
      return {
        raw: text,
        type: type,
        amount: +o.amount || null,
        categoryId: cat ? cat.id : '',
        accountId: acc ? acc.id : ((state.accounts || [])[0] || {}).id,
        item: String(o.item || '').slice(0, 20),
        date: /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : today,
        pay: ''
      };
    });
  }

  /* ---------------- 日历日程 ---------------- */
  function importICS() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.ics,text/calendar';
    inp.onchange = function () {
      var f = inp.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var evs;
        try {
          evs = C.parseICS(fr.result);
        } catch (e) {
          toast('解析失败：' + e.message, 'err');
          return;
        }
        if (!evs.length) { toast('这个文件里没有找到日程', 'err'); return; }
        mergeEvents(evs);
      };
      fr.readAsText(f, 'utf-8');
    };
    inp.click();
  }

  function mergeEvents(evs) {
    state.events = state.events || [];
    var keyOf = function (e) { return e.date + '|' + e.summary + '|' + (e.time || ''); };
    var map = {};
    state.events.forEach(function (e) { map[keyOf(e)] = e; });
    var added = 0;
    evs.forEach(function (e) {
      var k = keyOf(e);
      if (map[k]) Object.assign(map[k], e);
      else { map[k] = e; added++; }
    });
    state.events = Object.keys(map).map(function (k) { return map[k]; });
    state.events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    save();
    var next = evs.filter(function (e) { return e.date >= C.todayStr(); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
    if (next) view.month = next.date.slice(0, 7);
    view.tab = 'calendar';
    render();
    toast('导入 ' + evs.length + ' 条日程，新增 ' + added + ' 条');
  }

  function clearEvents() {
    if (!(state.events || []).length) { toast('还没有导入过日程'); return; }
    if (!confirm('清除全部 ' + state.events.length + ' 条日程？记账数据不受影响。')) return;
    state.events = [];
    save();
    render();
    toast('日程已清除');
  }

  /* ---------------- 导入导出 ---------------- */
  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function exportJSON() {
    download('记账备份-' + C.todayStr() + '.json', JSON.stringify(state, null, 2), 'application/json');
    toast('已导出备份');
  }

  function exportCSV() {
    download('记账明细-' + view.month + '.csv',
      C.toCSV(C.recordsOf(state, view.month), state), 'text/csv;charset=utf-8');
    toast('已导出本月 CSV');
  }

  function exportXLSX() {
    var rows = [['日期', '分类', '项目', '金额', '支付方式', '备注']];
    state.records.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (r) {
      rows.push([r.date, catOf(r.categoryId).name, r.item, r.amount, r.pay, r.note]);
    });
    var st = C.monthStats(state, view.month);
    rows.push([]);
    rows.push([st.label + ' 分类汇总', '', '', '', '', '']);
    rows.push(['分类', '支出', '占比', '月预算', '', '']);
    st.categories.filter(function (c) { return c.amount > 0 || c.budget > 0; }).forEach(function (c) {
      rows.push([c.name, c.amount, (c.ratio * 100).toFixed(2) + '%', c.budget || '', '', '']);
    });
    rows.push(['合计', st.spent, '100.00%', st.budget || '', '', '']);

    var html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">' +
      '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>' +
      '<x:Name>记账明细</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>' +
      '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->' +
      '</head><body><table border="1">' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (v) {
          var s = v === null || v === undefined ? '' : String(v);
          return '<td>' + s.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</table></body></html>';

    download('记账导出-' + view.month + '.xls',
      new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
    toast('已导出 Excel（.xls）');
  }

  function importJSON() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var next = C.normalize(JSON.parse(fr.result));
          if (!next.records.length) { toast('文件里没有记录', 'err'); return; }
          if (!confirm('导入 ' + next.records.length + ' 笔记录？\n当前 ' + state.records.length + ' 笔会被替换。')) return;
          makeSnapshot('导入备份前', true);
          state = next;
          save();
          view.month = C.ym(new Date());
          render();
          toast('导入成功，共 ' + state.records.length + ' 笔');
        } catch (err) {
          toast('文件格式不对', 'err');
        }
      };
      fr.readAsText(f);
    };
    inp.click();
  }

  function clearDemo() {
    makeSnapshot('清空示例前', true);
    state.records = state.records.filter(function (r) { return String(r.id).indexOf('demo_') !== 0; });
    save();
    render();
    toast('示例已清空，开始记账吧');
  }

  function clearAll() {
    if (!confirm('确定清空全部记录和预算设置？此操作不可撤销。')) return;
    if (!confirm('再确认一次：真的要清空吗？建议先「备份 JSON」。')) return;
    makeSnapshot('清空全部数据前', true);
    var keep = JSON.parse(JSON.stringify(state.settings));
    state = C.normalize(null);
    state.settings = keep;
    state.records = [];
    save();
    render();
    toast('已清空（需要的话去「本地快照」恢复）');
  }

  /* ---------------- 启动 ---------------- */
  loadState();
  view.tab = readHash();
  bindGlobal();

  // 每天第一次打开：先存一份快照，再渲染（这样设置页能显示正确的份数）
  try {
    var lastOpen = localStorage.getItem('moneybook.lastOpen');
    if (lastOpen !== C.todayStr()) {
      localStorage.setItem('moneybook.lastOpen', C.todayStr());
      makeSnapshot('每日自动', true);
    }
  } catch (e) { /* ignore */ }

  render();

  // 恢复上次选过的备份文件位置
  restoreBackupHandle();

  // 关页面前，尽量把待写的文件备份刷出去
  window.addEventListener('beforeunload', function () {
    if (backupFile) {
      clearTimeout(backupTimer);
      try {
        backupFile.createWritable().then(function (w) {
          return w.write(JSON.stringify(state, null, 2)).then(function () { return w.close(); });
        }).catch(function () {});
      } catch (e) { /* ignore */ }
    }
  });

  window.addEventListener('hashchange', function () {
    var h = readHash();
    if (h !== view.tab) { view.tab = h; view.modal = ''; view.editingId = null; render(); }
  });

  window.MB = {
    state: function () { return state; },
    view: view,
    render: render,
    setTab: setTab,
    mergeEvents: mergeEvents,
    makeSnapshot: makeSnapshot,
    readSnaps: function () { return readSnaps(); }
  };
})();
