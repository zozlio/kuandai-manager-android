/* ========================================
 * 宽带台账管理系统 - 移动版
 * 版本号不在这里硬编码：
 *   单一真源 = app/build.gradle 的 versionName / versionCode
 *   原生层通过 AndroidApp.getAppVersion() / getBuildCode() 暴露给网页
 *   浏览器预览（无桥接）时降级到下面的 FALLBACK_VERSION
 * ======================================== */

// ===== 版本信息 =====
var FALLBACK_VERSION = { name: '1.3.0', code: 8, date: '2026.11.15' };

function appVersion() {
  try {
    if (window.AndroidApp && typeof AndroidApp.getAppVersion === 'function') {
      var name = AndroidApp.getAppVersion();
      var code = (typeof AndroidApp.getBuildCode === 'function') ? AndroidApp.getBuildCode() : FALLBACK_VERSION.code;
      var date = (typeof AndroidApp.getBuildDate === 'function') ? AndroidApp.getBuildDate() : FALLBACK_VERSION.date;
      return {
        name: name || FALLBACK_VERSION.name,
        code: code,
        date: date || FALLBACK_VERSION.date
      };
    }
  } catch (e) { /* 桥接不可用时走降级 */ }
  return { name: FALLBACK_VERSION.name, code: FALLBACK_VERSION.code, date: FALLBACK_VERSION.date };
}

/** 完整版本串，如 "v1.3.0 · 2026.11.15 · Build 8" */
function appFullVersion() {
  var v = appVersion();
  return 'v' + v.name + ' · ' + v.date + ' · Build ' + v.code;
}

/** 把版本号写进所有展示位（侧边栏、设置页等） */
function applyVersionToUI() {
  var full = appFullVersion();
  var sv = document.querySelector('.sidebar-version');
  if (sv) sv.textContent = full;
}

// ===== 全局状态 =====
var DB = {
  accounts: [],
  transactions: [],
  dailyIncome: [],
  reminders: [],
  settings: {},
  user: null
};
var currentPage = 'dashboard';
var currentFilter = 'all'; // all / normal / abnormal
var currentDashboardTab = 'all'; // all / normal / abnormal — 看板标签页，口径跟着走
var chartDays = 7; // 图表天数 7/14/30
var searchKeyword = '';
var editingAccountId = null;
var rechargeAccountId = null;
var confirmCallback = null;
var visionRetryCount = 0; // AI 识图重试计数
var roomsDay = '';        // 机房页当前查看的日期
var incomeAccountId = null; // 记收入/手动记账的目标账号

// ===== 数据持久化 =====
// 存储适配层：localStorage 不可用时（如 file:// 预览）降级到内存
var _memStore = {};
var _storageOK = (function() {
  try {
    var t = '__kd_test__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return true;
  } catch(e) {
    return false;
  }
})();

function _getItem(key) {
  if (_storageOK) return localStorage.getItem(key);
  return _memStore[key] !== undefined ? _memStore[key] : null;
}
function _setItem(key, val) {
  if (_storageOK) { localStorage.setItem(key, val); return; }
  _memStore[key] = val;
}

function loadDB() {
  try {
    DB.accounts = JSON.parse(_getItem('kd_accounts') || '[]');
    DB.transactions = JSON.parse(_getItem('kd_transactions') || '[]');
    DB.dailyIncome = JSON.parse(_getItem('kd_dailyIncome') || '[]');
    DB.reminders = JSON.parse(_getItem('kd_reminders') || '[]');
    DB.settings = JSON.parse(_getItem('kd_settings') || '{}');
    DB.user = JSON.parse(_getItem('kd_user') || 'null');
  } catch(e) { console.error('Load DB error:', e); }
}

function saveDB() {
  try {
    _setItem('kd_accounts', JSON.stringify(DB.accounts));
    _setItem('kd_transactions', JSON.stringify(DB.transactions));
    _setItem('kd_dailyIncome', JSON.stringify(DB.dailyIncome));
    _setItem('kd_reminders', JSON.stringify(DB.reminders));
    _setItem('kd_settings', JSON.stringify(DB.settings));
    _setItem('kd_user', JSON.stringify(DB.user));
  } catch(e) { console.error('Save DB error:', e); }
}

// ===== 初始化 =====
(function init() {
  loadDB();
  if (!DB.settings.aiBaseUrl) {
    DB.settings = {
      aiBaseUrl: '',
      aiApiKey: '',
      aiModel: '',
      visionModel: '',
      visionTimeout: 300,
      aiMaxTokens: 8192,
      dailyCheckHour: 0,
      dailyCheckMinute: 5
    };
    saveDB();
  }
  // 如果没有账号，灌入演示数据
  if (DB.accounts.length === 0) {
    seedDemoData();
  }
  // 执行每日扣费检查
  checkDailyDeduction();
  // 版本号刷进侧边栏
  applyVersionToUI();
  // 渲染首页
  navTo('dashboard');
})();

// ===== 演示数据 =====
function seedDemoData() {
  var demoAccounts = [
    { phone:'13800138001', account:'KD20240001', regcode:'RC001', owner:'张三', cardUser:'张三', room:'城南机房', platform:'平台A', node:'N001', packagePrice:399, carrier:'电信', remark:'', discount:false },
    { phone:'13800138002', account:'KD20240002', regcode:'RC002', owner:'李四', cardUser:'李四', room:'城南机房', platform:'平台B', node:'N002', packagePrice:399, carrier:'联通', remark:'', discount:true },
    { phone:'13800138003', account:'KD20240003', regcode:'RC003', owner:'王五', cardUser:'赵六', room:'城北机房', platform:'平台A', node:'N003', packagePrice:399, carrier:'移动', remark:'', discount:false },
    { phone:'13800138004', account:'KD20240004', regcode:'RC004', owner:'钱七', cardUser:'钱七', room:'城北机房', platform:'平台C', node:'N004', packagePrice:399, carrier:'电信', remark:'客户要求降速', discount:false, abnormal:{ reason:'限速', note:'客户主动要求降速' } },
    { phone:'13800138005', account:'KD20240005', regcode:'RC005', owner:'孙八', cardUser:'孙八', room:'城东机房', platform:'平台A', node:'N005', packagePrice:399, carrier:'电信', remark:'', discount:true },
    { phone:'13800138006', account:'KD20240006', regcode:'RC006', owner:'周九', cardUser:'周九', room:'城东机房', platform:'平台B', node:'N006', packagePrice:399, carrier:'联通', remark:'', discount:false },
  ];
  demoAccounts.forEach(function(d) {
    var acc = createAccountObj(d);
    DB.accounts.push(acc);
    addTransaction(acc.id, '开号初始金额', 500, '充值');
  });
  saveDB();
}

function createAccountObj(data) {
  var monthlyFee = data.discount ? data.packagePrice * 0.7 : data.packagePrice;
  var now = new Date();
  var dailyFee = monthlyFee / getDaysInMonth(now.getFullYear(), now.getMonth());
  return {
    id: genId(),
    phone: data.phone,
    account: data.account,
    regcode: data.regcode || '',
    owner: data.owner || '',
    cardUser: data.cardUser || '',
    room: data.room || '',
    platform: data.platform || '',
    node: data.node || '',
    packagePrice: data.packagePrice || 399,
    monthlyFee: round2(monthlyFee),
    dailyFee: round2(dailyFee),
    discount: data.discount || false,
    discountLocked: data.discount || false,
    balance: 500,
    totalRecharge: 500,
    carrier: data.carrier || '电信',
    remark: data.remark || '',
    abnormal: data.abnormal || null,
    createdAt: now.getTime(),
    registeredAt: now.getTime()
  };
}

// ===== 工具函数 =====
function genId() { return 'a_' + Date.now() + '_' + Math.floor(Math.random()*10000); }
function round2(n) { return Math.round(n * 100) / 100; }
function getDaysInMonth(y, m) { return new Date(y, m+1, 0).getDate(); }
function formatMoney(n) { return '¥' + round2(n).toFixed(2); }
function formatDate(ts) {
  var d = new Date(ts);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function formatDateTime(ts) {
  var d = new Date(ts);
  return formatDate(ts) + ' ' + pad(d.getHours())+':'+pad(d.getMinutes());
}
function pad(n) { return n < 10 ? '0'+n : ''+n; }
function todayStr() { return formatDate(Date.now()); }

function vibrate(ms) {
  if (window.AndroidApp && window.AndroidApp.vibrate) {
    AndroidApp.vibrate(ms || 30);
  } else if (navigator.vibrate) {
    navigator.vibrate(ms || 30);
  }
}

function showToast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + (type || '');
  setTimeout(function() { el.className = 'toast ' + (type || ''); }, 2500);
}

function showConfirm(msg, callback) {
  document.getElementById('confirmMessage').textContent = msg;
  document.getElementById('confirmDialog').classList.add('show');
  confirmCallback = callback;
}
function closeConfirm(result) {
  document.getElementById('confirmDialog').classList.remove('show');
  if (confirmCallback) {
    var cb = confirmCallback;
    confirmCallback = null;
    if (result) cb();
  }
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
  } else {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
  showToast('已复制: ' + text, 'success');
  vibrate(20);
}

// ===== 导航 =====
function navTo(page) {
  currentPage = page;
  closeSidebar();
  var titles = {
    dashboard:'收入看板', accounts:'台账列表', abnormal:'异常账号',
    rooms:'机房与收入', vision:'AI 识图记账',
    transactions:'收支流水', export:'数据导入导出', settings:'设置'
  };
  document.getElementById('pageTitle').textContent = titles[page] || '宽带台账';
  document.title = titles[page] || '宽带台账';

  // 更新菜单高亮
  document.querySelectorAll('.sidebar-menu li').forEach(function(li) {
    li.classList.remove('active');
    if (li.getAttribute('onclick') === "navTo('" + page + "')") li.classList.add('active');
  });
  // 底部导航高亮
  document.querySelectorAll('.bottom-nav-item').forEach(function(item) {
    item.classList.remove('active');
    if (item.getAttribute('onclick') === "navTo('" + page + "')") item.classList.add('active');
  });

  // 渲染页面
  var content = document.getElementById('content');
  switch(page) {
    case 'dashboard': content.innerHTML = renderDashboard(); break;
    case 'accounts': content.innerHTML = renderAccounts(); break;
    case 'abnormal': content.innerHTML = renderAbnormal(); break;
    case 'rooms': content.innerHTML = renderRooms(); break;
    case 'vision': content.innerHTML = renderVision(); break;
    case 'transactions': content.innerHTML = renderTransactions(); break;
    case 'export': content.innerHTML = renderExport(); break;
    case 'settings': content.innerHTML = renderSettings(); break;
  }
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

// ===== 看板页面 =====
function renderDashboard() {
  // 口径跟着标签页走
  var scopedAccounts = DB.accounts.filter(function(a) {
    if (currentDashboardTab === 'normal') return !a.abnormal;
    if (currentDashboardTab === 'abnormal') return a.abnormal;
    return true;
  });

  var totalBalance = 0, totalMonthly = 0;
  var normalCount = 0, lowCount = 0, dangerCount = 0, abnormalCount = 0;
  var todayIncome = 0, todayDeduction = 0, totalIncome = 0;

  var today = todayStr();
  scopedAccounts.forEach(function(a) {
    totalBalance += a.balance;
    totalMonthly += a.monthlyFee;
    if (a.abnormal) { abnormalCount++; }
    else if (a.balance < 10) { dangerCount++; }
    else if (a.balance < 50) { lowCount++; }
    else normalCount++;
  });

  // 今日收入/累计收入/扣费都跟着标签走
  var scopedIds = scopedAccounts.map(function(a) { return a.id; });
  DB.dailyIncome.forEach(function(d) {
    var acc = accountOfIncome(d);
    if (!acc || scopedIds.indexOf(acc.id) < 0) return;
    totalIncome += Number(d.amount || 0);
    if (d.date === today) todayIncome += Number(d.amount || 0);
  });
  DB.transactions.forEach(function(t) {
    if (t.type === '扣费' && formatDate(t.time) === today && scopedIds.indexOf(t.accountId) >= 0) {
      todayDeduction += Math.abs(t.amount);
    }
  });

  var netProfit = todayIncome - todayDeduction;
  var totalAccounts = DB.accounts.length;

  var html = '';

  // 正常/异常标签页切换
  html += '<div class="tab-bar">';
  html += '<div class="tab-item' + (currentDashboardTab==='all'?' active':'') + '" onclick="setDashboardTab(\'all\')">全部 (' + totalAccounts + ')</div>';
  html += '<div class="tab-item' + (currentDashboardTab==='normal'?' active':'') + '" onclick="setDashboardTab(\'normal\')">正常 (' + (normalCount + lowCount + dangerCount) + ')</div>';
  html += '<div class="tab-item' + (currentDashboardTab==='abnormal'?' active':'') + '" onclick="setDashboardTab(\'abnormal\')">异常 (' + abnormalCount + ')</div>';
  html += '</div>';

  html += '<div class="kpi-grid">';
  html += kpiCard('今日平台收入', formatMoney(todayIncome), 'success');
  html += kpiCard('今日每日扣费', formatMoney(todayDeduction), 'warning');
  html += kpiCard('今日净利润', formatMoney(netProfit), netProfit >= 0 ? 'accent' : 'danger');
  html += kpiCard('累计收入', formatMoney(totalIncome), 'success');
  html += kpiCard('剩余余额', formatMoney(totalBalance), 'accent');
  html += kpiCard('余额不足', dangerCount + ' 个', dangerCount > 0 ? 'danger' : '');
  html += '</div>';

  // 收入趋势图 + 天数切换
  html += '<div class="section-title"><span class="dot"></span>收入趋势</div>';
  html += '<div class="tab-bar" style="margin-bottom:8px;">';
  [7,14,30].forEach(function(d) {
    html += '<div class="tab-item' + (chartDays===d?' active':'') + '" onclick="setChartDays(' + d + ')">近' + d + '天</div>';
  });
  html += '</div>';
  html += '<div class="chart-container"><canvas id="chartTrend" height="160"></canvas></div>';

  // 账号状态分布
  html += '<div class="section-title"><span class="dot"></span>账号状态分布</div>';
  html += '<div class="chart-container"><canvas id="chartStatus" height="160"></canvas></div>';

  // 平台收入占比
  html += '<div class="section-title"><span class="dot"></span>平台收入占比</div>';
  html += '<div class="chart-container"><canvas id="chartPlatform" height="160"></canvas></div>';

  // 快捷操作
  html += '<div class="section-title"><span class="dot"></span>快捷操作</div>';
  html += '<div class="kpi-grid">';
  html += '<div class="kpi-card" onclick="runDailyCheck()" style="cursor:pointer;text-align:center;">';
  html += '<div class="kpi-label">立即巡检</div>';
  html += '<div style="font-size:14px;color:var(--accent);margin-top:4px;">点击执行扣费</div>';
  html += '</div>';
  html += '<div class="kpi-card" onclick="navTo(\'export\')" style="cursor:pointer;text-align:center;">';
  html += '<div class="kpi-label">导入导出</div>';
  html += '<div style="font-size:14px;color:var(--success);margin-top:4px;">备份与恢复数据</div>';
  html += '</div>';
  html += '</div>';

  // 延迟渲染图表
  setTimeout(renderCharts, 100);

  return html;
}

function setDashboardTab(tab) {
  currentDashboardTab = tab;
  document.getElementById('content').innerHTML = renderDashboard();
}

function setChartDays(days) {
  chartDays = days;
  document.getElementById('content').innerHTML = renderDashboard();
}

function kpiCard(label, value, type) {
  var cls = type ? ' ' + type : '';
  var valCls = type ? ' ' + type : '';
  return '<div class="kpi-card' + cls + '"><div class="kpi-label">' + label +
    '</div><div class="kpi-value' + valCls + '">' + value + '</div></div>';
}

// ===== 图表 =====
// 设计令牌：与 style.css 保持同步（canvas 拿不到 CSS 变量，只能复制色值）
var CHART = {
  ink: '#121517',
  ink2: '#575D61',
  ink3: '#8B9195',
  fiber: '#0D6A6D',
  fiberLight: '#17868A',
  amber: '#97650F',
  rust: '#A6482F',
  rustDeep: '#6E2E1E',
  track: 'rgba(18,21,23,0.055)',
  rule: 'rgba(18,21,23,0.07)'
};
var CHART_FONT = '-apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif';

function renderCharts() {
  renderTrendChart();
  renderStatusChart();
  renderPlatformChart();
}

// 按 CSS 像素绘制、再乘 devicePixelRatio：
// 旧版直接 width = offsetWidth*2 却没同步 CSS 高度，图上文字被拉伸且发虚
function setupCanvas(canvas, cssHeight) {
  var dpr = Math.min(window.devicePixelRatio || 1, 3);
  var cssW = canvas.clientWidth ||
    (canvas.parentNode && canvas.parentNode.clientWidth) || 320;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = cssHeight + 'px';
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssHeight);
  return { ctx: ctx, w: cssW, h: cssHeight };
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// 柱顶圆角、柱底贴基线的形状
function barPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function clipText(ctx, text, maxW) {
  text = String(text);
  if (ctx.measureText(text).width <= maxW) return text;
  var t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function renderTrendChart() {
  var canvas = document.getElementById('chartTrend');
  if (!canvas) return;
  var s = setupCanvas(canvas, 156);
  var ctx = s.ctx, w = s.w, h = s.h;

  var data = [];
  for (var i = chartDays - 1; i >= 0; i--) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    var dateStr = formatDate(d.getTime());
    var income = 0;
    // 收入趋势只统计平台收入（dailyIncome），扣费另算，混进来会让趋势失真
    DB.dailyIncome.forEach(function(di) {
      if (di.date === dateStr) income += Number(di.amount || 0);
    });
    data.push({ date: (d.getMonth() + 1) + '/' + d.getDate(), value: round2(income) });
  }

  var maxVal = Math.max.apply(null, data.map(function(d) { return d.value; })) || 1;
  var slot = w / data.length;
  var barW = Math.min(slot * 0.56, 24);
  var baseY = h - 20;
  var chartH = baseY - 24;

  // 基线
  ctx.strokeStyle = CHART.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, baseY + 0.5);
  ctx.lineTo(w, baseY + 0.5);
  ctx.stroke();

  var labelStep = Math.ceil(data.length / 7); // 30 天时只标 1/3，避免挤成一团
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  data.forEach(function(d, i) {
    var cx = slot * i + slot / 2;
    var barH = maxVal > 0 ? (d.value / maxVal) * chartH : 0;
    var y = baseY - barH;

    if (barH > 0.6) {
      var grad = ctx.createLinearGradient(0, y, 0, baseY);
      grad.addColorStop(0, CHART.fiberLight);
      grad.addColorStop(1, CHART.fiber);
      ctx.fillStyle = grad;
      barPath(ctx, cx - barW / 2, y, barW, barH, Math.min(barW / 2, 5));
      ctx.fill();
    }

    if (d.value > 0 && data.length <= 7) {
      ctx.fillStyle = CHART.ink2;
      ctx.font = '600 10px ' + CHART_FONT;
      ctx.fillText('¥' + d.value.toFixed(0), cx, y - 6);
    }

    if (i % labelStep === 0 || i === data.length - 1) {
      ctx.fillStyle = CHART.ink3;
      ctx.font = '10px ' + CHART_FONT;
      ctx.fillText(d.date, cx, h - 5);
    }
  });
}

function renderStatusChart() {
  var canvas = document.getElementById('chartStatus');
  if (!canvas) return;
  var s = setupCanvas(canvas, 172);
  var ctx = s.ctx, w = s.w, h = s.h;

  var normal = 0, low = 0, danger = 0, abnormal = 0;
  DB.accounts.forEach(function(a) {
    if (a.abnormal) abnormal++;
    else if (a.balance >= 50) normal++;
    else if (a.balance >= 10) low++;
    else danger++;
  });
  var total = normal + low + danger + abnormal || 1;

  var data = [
    { label: '正常', value: normal, color: CHART.fiber },
    { label: '偏少', value: low, color: CHART.amber },
    { label: '不足', value: danger, color: CHART.rust },
    { label: '异常', value: abnormal, color: CHART.rustDeep }
  ];

  var ringW = 12;
  var cx = w / 2, cy = 62, r = 44;

  // 底环
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = ringW;
  ctx.strokeStyle = CHART.track;
  ctx.stroke();

  var filled = data.filter(function(d) { return d.value > 0; }).length;
  var gap = filled > 1 ? 0.055 : 0;
  var start = -Math.PI / 2;
  ctx.lineCap = 'round';
  data.forEach(function(d) {
    if (!d.value) return;
    var angle = (d.value / total) * Math.PI * 2;
    if (angle <= gap) return;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start + gap / 2, start + angle - gap / 2);
    ctx.lineWidth = ringW;
    ctx.strokeStyle = d.color;
    ctx.stroke();
    start += angle;
  });

  // 圆心：总数
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CHART.ink;
  ctx.font = '700 24px ' + CHART_FONT;
  ctx.fillText(total, cx, cy + 3);
  ctx.fillStyle = CHART.ink3;
  ctx.font = '10px ' + CHART_FONT;
  ctx.fillText('总账号', cx, cy + 18);

  // 图例：两列两行
  var colW = w / 2;
  ctx.textAlign = 'left';
  data.forEach(function(d, i) {
    var lx = 10 + (i % 2) * colW;
    var ly = 132 + Math.floor(i / 2) * 20;
    ctx.beginPath();
    ctx.arc(lx + 3.5, ly, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.fillStyle = CHART.ink3;
    ctx.font = '11px ' + CHART_FONT;
    ctx.fillText(d.label + ' ' + d.value, lx + 13, ly + 4);
  });
}

function renderPlatformChart() {
  var canvas = document.getElementById('chartPlatform');
  if (!canvas) return;

  var platformData = {};
  DB.accounts.forEach(function(a) {
    var p = a.platform || '未分类';
    if (!platformData[p]) platformData[p] = { count: 0, balance: 0 };
    platformData[p].count++;
    platformData[p].balance += a.balance;
  });

  var platforms = Object.keys(platformData).sort(function(a, b) {
    return platformData[b].balance - platformData[a].balance;
  }).slice(0, 6);

  var maxBalance = 0;
  platforms.forEach(function(p) {
    if (platformData[p].balance > maxBalance) maxBalance = platformData[p].balance;
  });
  maxBalance = maxBalance || 1;

  var rowH = 34;
  var s = setupCanvas(canvas, Math.max(100, platforms.length * rowH + 6));
  var ctx = s.ctx, w = s.w;

  if (!platforms.length) {
    ctx.fillStyle = CHART.ink3;
    ctx.font = '11.5px ' + CHART_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('还没有平台数据', w / 2, 40);
    return;
  }

  var labelW = Math.min(72, w * 0.24);
  var valueW = 56;
  var trackX = labelW + 8;
  var trackW = Math.max(40, w - trackX - valueW);
  var barH = 10;

  platforms.forEach(function(p, i) {
    var val = platformData[p].balance;
    var by = 8 + i * rowH;
    var mid = by + barH / 2;

    ctx.fillStyle = CHART.track;
    roundRectPath(ctx, trackX, by, trackW, barH, barH / 2);
    ctx.fill();

    var bw = Math.max(4, (val / maxBalance) * trackW);
    ctx.fillStyle = CHART.fiber;
    roundRectPath(ctx, trackX, by, bw, barH, barH / 2);
    ctx.fill();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = CHART.ink2;
    ctx.font = '11.5px ' + CHART_FONT;
    ctx.textAlign = 'right';
    ctx.fillText(clipText(ctx, p, labelW - 10), labelW, mid);

    ctx.fillStyle = CHART.ink;
    ctx.font = '600 11.5px ' + CHART_FONT;
    ctx.textAlign = 'left';
    ctx.fillText('¥' + val.toFixed(0), trackX + trackW + 6, mid);
  });
}

// ===== 台账列表 =====
function renderAccounts() {
  var html = '';
  html += '<div class="search-bar">';
  html += '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15.5,14h-0.79l-0.28,-0.27C15.41,12.59 16,11.11 16,9.5C16,5.91 13.09,3 9.5,3S3,5.91 3,9.5S5.91,16 9.5,16c1.61,0 3.09,-0.59 4.23,-1.57l0.27,0.28v0.79l5,4.99L20.49,19l-4.99,-5zm-6,0C7.01,14 5,11.99 5,9.5S7.01,5 9.5,5S14,7.01 14,9.5S11.99,14 9.5,14z"/></svg>';
  html += '<input type="text" placeholder="搜索手机号、账号、节点号..." value="' + searchKeyword + '" oninput="onSearch(this.value)">';
  html += '</div>';

  html += '<div class="tab-bar">';
  html += '<div class="tab-item' + (currentFilter==='all'?' active':'') + '" onclick="setFilter(\'all\')">全部</div>';
  html += '<div class="tab-item' + (currentFilter==='normal'?' active':'') + '" onclick="setFilter(\'normal\')">正常</div>';
  html += '<div class="tab-item' + (currentFilter==='abnormal'?' active':'') + '" onclick="setFilter(\'abnormal\')">异常</div>';
  html += '</div>';

  var filtered = filterAccounts();
  if (filtered.length === 0) {
    html += emptyState('暂无账号数据', '点击右下角 + 按钮新增');
  } else {
    filtered.forEach(function(a) {
      html += renderAccountCard(a);
    });
  }
  return html;
}

function filterAccounts() {
  return DB.accounts.filter(function(a) {
    if (currentFilter === 'normal' && a.abnormal) return false;
    if (currentFilter === 'abnormal' && !a.abnormal) return false;
    if (searchKeyword) {
      var kw = searchKeyword.toLowerCase();
      return (a.phone && a.phone.indexOf(kw) >= 0) ||
             (a.account && a.account.toLowerCase().indexOf(kw) >= 0) ||
             (a.node && a.node.indexOf(kw) >= 0) ||
             (a.owner && a.owner.indexOf(kw) >= 0);
    }
    return true;
  });
}

function renderAccountCard(a) {
  var status, statusCls, balanceCls;
  if (a.abnormal) {
    status = '异常'; statusCls = 'status-abnormal';
  } else if (a.balance < 10) {
    status = '不足'; statusCls = 'status-danger';
  } else if (a.balance < 50) {
    status = '偏少'; statusCls = 'status-warning';
  } else {
    status = '正常'; statusCls = 'status-normal';
  }

  if (a.balance >= 50) balanceCls = 'good';
  else if (a.balance >= 10) balanceCls = 'low';
  else balanceCls = 'bad';

  var html = '<div class="account-card" onclick="showAccountDetail(\'' + a.id + '\')">';
  html += '<div class="account-card-top">';
  html += '<div class="account-phone">' + a.phone;
  html += ' <button class="copy-btn" onclick="event.stopPropagation();copyText(\'' + a.phone + '\')" title="复制"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8,3h9a2,2 0 0 1 2,2v9h-2V5H8V3z"/><path fill="currentColor" d="M5,7h9a2,2 0 0 1 2,2v9a2,2 0 0 1 -2,2H5a2,2 0 0 1 -2,-2V9a2,2 0 0 1 2,-2zM5,9v9h9V9H5z"/></svg></button></div>';
  html += '<span class="account-status ' + statusCls + '">' + status + '</span>';
  html += '</div>';
  html += '<div class="account-info-row"><span>宽带账号</span><span>' + (a.account||'-') + ' <button class="copy-btn" onclick="event.stopPropagation();copyText(\'' + (a.account||'') + '\')"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8,3h9a2,2 0 0 1 2,2v9h-2V5H8V3z"/><path fill="currentColor" d="M5,7h9a2,2 0 0 1 2,2v9a2,2 0 0 1 -2,2H5a2,2 0 0 1 -2,-2V9a2,2 0 0 1 2,-2zM5,9v9h9V9H5z"/></svg></button></span></div>';
  html += '<div class="account-info-row"><span>节点号</span><span>' + (a.node||'-') + ' <button class="copy-btn" onclick="event.stopPropagation();copyText(\'' + (a.node||'') + '\')"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8,3h9a2,2 0 0 1 2,2v9h-2V5H8V3z"/><path fill="currentColor" d="M5,7h9a2,2 0 0 1 2,2v9a2,2 0 0 1 -2,2H5a2,2 0 0 1 -2,-2V9a2,2 0 0 1 2,-2zM5,9v9h9V9H5z"/></svg></button></span></div>';
  html += '<div class="account-info-row"><span>月费</span><span>' + formatMoney(a.monthlyFee) + (a.discount?' (七折)':'') + '</span></div>';
  if (a.abnormal) {
    html += '<div class="account-info-row"><span>异常原因</span><span style="color:var(--danger)">' + a.abnormal.reason + (a.abnormal.note?' - '+a.abnormal.note:'') + '</span></div>';
  }
  html += '<div class="account-balance-row">';
  html += '<div>余额: <span class="balance-amount ' + balanceCls + '">' + formatMoney(a.balance) + '</span></div>';
  html += '<button class="recharge-btn" onclick="event.stopPropagation();showRechargeModal(\'' + a.id + '\')">充值</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function onSearch(val) { searchKeyword = val; document.getElementById('content').innerHTML = renderAccounts(); }
function setFilter(f) { currentFilter = f; document.getElementById('content').innerHTML = renderAccounts(); }

// ===== 异常账号 =====
function renderAbnormal() {
  var abnormal = DB.accounts.filter(function(a) { return a.abnormal; });
  var html = '';
  if (abnormal.length === 0) {
    html += emptyState('没有异常账号', '所有账号运行正常');
  } else {
    abnormal.forEach(function(a) {
      html += '<div class="account-card" style="border-left:3px solid var(--danger)">';
      html += '<div class="account-card-top">';
      html += '<div class="account-phone">' + a.phone + '</div>';
      html += '<span class="account-status status-abnormal">' + a.abnormal.reason + '</span>';
      html += '</div>';
      html += '<div class="account-info-row"><span>账号</span><span>' + (a.account||'-') + '</span></div>';
      html += '<div class="account-info-row"><span>节点号</span><span>' + (a.node||'-') + '</span></div>';
      html += '<div class="account-info-row"><span>异常原因</span><span style="color:var(--danger)">' + a.abnormal.reason + '</span></div>';
      if (a.abnormal.note) html += '<div class="account-info-row"><span>备注</span><span>' + a.abnormal.note + '</span></div>';
      html += '<div class="account-info-row"><span>余额</span><span>' + formatMoney(a.balance) + '</span></div>';
      html += '<div style="display:flex;gap:8px;margin-top:8px;">';
      html += '<button class="btn-primary" style="flex:1;padding:8px 12px;font-size:13px;" onclick="recoverAccount(\'' + a.id + '\')">恢复正常</button>';
      html += '<button class="btn-secondary" style="flex:1;padding:8px 12px;font-size:13px;" onclick="showAccountDetail(\'' + a.id + '\')">详情</button>';
      html += '</div>';
      html += '</div>';
    });
  }
  return html;
}

function recoverAccount(id) {
  showConfirm('确定将该账号恢复正常吗？', function() {
    var a = findAccount(id);
    if (a) {
      a.abnormal = null;
      saveDB();
      showToast('已恢复正常', 'success');
      vibrate(30);
      refreshAfterDataChange(id);
    }
  });
}

// ===== 机房与收入 =====
// groupBy: 机房 → 节点平台 → 账号；表头 KPI 口径与仓库 /rooms 一致
function setRoomsDay(day) {
  roomsDay = day || todayStr();
  if (currentPage === 'rooms') document.getElementById('content').innerHTML = renderRooms();
}

function renderRooms() {
  var day = roomsDay || todayStr();

  var tree = {}, roomsOrder = [];
  DB.accounts.forEach(function(a) {
    var room = a.room || '未分配机房';
    var plat = a.platform || '未分类平台';
    if (!tree[room]) { tree[room] = {}; roomsOrder.push(room); }
    if (!tree[room][plat]) tree[room][plat] = [];
    tree[room][plat].push(a);
  });
  roomsOrder.sort();

  var dayIncome = 0, dayCost = 0;
  DB.dailyIncome.forEach(function(d) { if (d.date === day) dayIncome += Number(d.amount || 0); });
  DB.transactions.forEach(function(t) {
    if (t.type === '扣费' && formatDate(t.time) === day) dayCost += Math.abs(t.amount);
  });
  var profit = round2(dayIncome - dayCost);

  var html = '';
  // 日期切换
  html += '<div class="settings-card" style="padding:12px;">';
  html += '<div style="display:flex;gap:8px;align-items:center;">';
  html += '<input type="date" class="inline-date" value="' + day + '" onchange="setRoomsDay(this.value)">';
  html += '<button class="btn-secondary" style="padding:10px 14px;font-size:13px;" onclick="setRoomsDay(\'' + todayStr() + '\')">今天</button>';
  html += '</div></div>';

  html += '<div class="kpi-grid">';
  html += kpiCard('收入合计', formatMoney(dayIncome), 'success');
  html += kpiCard('当日扣费', formatMoney(dayCost), 'warning');
  html += kpiCard('净利润', formatMoney(profit), profit >= 0 ? 'accent' : 'danger');
  html += kpiCard('机房数', roomsOrder.length + ' 个', '');
  html += '</div>';

  if (roomsOrder.length === 0) {
    html += emptyState('还没有宽带账号', '先新增账号，填上机房、节点平台和节点号');
    return html;
  }

  roomsOrder.forEach(function(room) {
    var platforms = tree[room];
    var platNames = Object.keys(platforms).sort();
    var total = 0;
    platNames.forEach(function(p) { total += platforms[p].length; });

    html += '<div class="section-title"><span class="dot"></span>' + room +
      '<span style="font-size:12px;color:var(--text-muted);font-weight:normal;margin-left:6px;">' +
      total + ' 条宽带 · ' + platNames.length + ' 个平台</span></div>';

    platNames.forEach(function(plat) {
      html += '<div class="settings-card">';
      html += '<div class="settings-card-title">' + plat +
        '<span style="font-size:12px;color:var(--text-muted);font-weight:normal;margin-left:6px;">' +
        platforms[plat].length + ' 条</span></div>';
      platforms[plat].forEach(function(a) { html += renderRoomRow(a, day); });
      html += '</div>';
    });
  });

  return html;
}

function renderRoomRow(a, day) {
  var inc = incomeSumOf(a, day);
  var week = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    week.push(incomeSumOf(a, formatDate(d.getTime())));
  }

  var html = '<div class="account-card" style="margin-bottom:8px;' +
    (a.abnormal ? 'border-left:3px solid var(--danger);' : '') + '">';
  html += '<div class="account-card-top">';
  html += '<div class="account-phone">' + a.phone +
    ' <button class="copy-btn" onclick="event.stopPropagation();copyText(\'' + a.phone + '\')" title="复制"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8,3h9a2,2 0 0 1 2,2v9h-2V5H8V3z"/><path fill="currentColor" d="M5,7h9a2,2 0 0 1 2,2v9a2,2 0 0 1 -2,2H5a2,2 0 0 1 -2,-2V9a2,2 0 0 1 2,-2zM5,9v9h9V9H5z"/></svg></button></div>';
  html += '<span class="account-status ' + (a.abnormal ? 'status-abnormal' : (a.balance < 10 ? 'status-danger' : (a.balance < 50 ? 'status-warning' : 'status-normal'))) + '">' +
    (a.abnormal ? a.abnormal.reason : (a.balance < 10 ? '不足' : (a.balance < 50 ? '偏少' : '正常'))) + '</span>';
  html += '</div>';
  html += '<div class="account-info-row"><span>宽带账号</span><span>' + (a.account || '-') +
    (a.account ? ' <button class="copy-btn" onclick="copyText(\'' + a.account + '\')"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8,3h9a2,2 0 0 1 2,2v9h-2V5H8V3z"/><path fill="currentColor" d="M5,7h9a2,2 0 0 1 2,2v9a2,2 0 0 1 -2,2H5a2,2 0 0 1 -2,-2V9a2,2 0 0 1 2,-2zM5,9v9h9V9H5z"/></svg></button>' : '') + '</span></div>';
  html += '<div class="account-info-row"><span>节点号</span><span>' + (a.node || '-') +
    (a.node ? ' <button class="copy-btn" onclick="copyText(\'' + a.node + '\')"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8,3h9a2,2 0 0 1 2,2v9h-2V5H8V3z"/><path fill="currentColor" d="M5,7h9a2,2 0 0 1 2,2v9a2,2 0 0 1 -2,2H5a2,2 0 0 1 -2,-2V9a2,2 0 0 1 2,-2zM5,9v9h9V9H5z"/></svg></button>' : '') + '</span></div>';
  html += '<div class="account-info-row"><span>当日收入</span><span style="color:var(--success);font-weight:600;">' + formatMoney(inc) + '</span></div>';
  html += '<div class="account-info-row"><span>最近 7 天</span><span>' + sparkline(week) + '</span></div>';
  if (a.remark) html += '<div class="account-info-row"><span>备注</span><span>' + a.remark + '</span></div>';
  html += '<div style="display:flex;gap:8px;margin-top:8px;">';
  html += '<button class="btn-primary" style="flex:1;padding:8px 12px;font-size:13px;" onclick="showIncomeModal(\'' + a.id + '\',\'' + day + '\')">记收入</button>';
  html += '<button class="btn-secondary" style="flex:1;padding:8px 12px;font-size:13px;" onclick="showAccountDetail(\'' + a.id + '\')">详情</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

// 最近 7 天迷你折线
function sparkline(values) {
  var hasData = values.some(function(v) { return v > 0; });
  if (!hasData) return '<span style="font-size:11px;color:var(--text-muted);">还没有收入记录</span>';
  var max = Math.max.apply(null, values) || 1;
  var pts = [];
  for (var i = 0; i < values.length; i++) {
    var x = 4 + (88 / Math.max(values.length - 1, 1)) * i;
    var y = 24 - (20 * values[i] / max);
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  return '<svg viewBox="0 0 96 28" width="96" height="28" role="img" aria-label="最近7天收入">' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

// ===== 每日收入 =====
// 反查一条每日收入属于哪个账号：优先 accountId，历史数据退回 节点号+平台
function accountOfIncome(d) {
  if (d.accountId) {
    var byId = findAccount(d.accountId);
    if (byId) return byId;
  }
  if (!d.node) return null;
  return DB.accounts.find(function(a) {
    return a.node === d.node && (a.platform || '') === (d.platform || '');
  }) || null;
}

// 兼容历史数据：老记录没有 accountId，退回按 节点号+平台 匹配
function incomesOfAccount(a, day) {
  return DB.dailyIncome.filter(function(d) {
    if (day && d.date !== day) return false;
    if (d.accountId) return d.accountId === a.id;
    if (!a.node) return false;
    return d.node === a.node && d.platform === a.platform;
  });
}

function incomeSumOf(a, day) {
  return round2(incomesOfAccount(a, day).reduce(function(s, d) {
    return s + Number(d.amount || 0);
  }, 0));
}

function showIncomeModal(accountId, presetDay) {
  var a = findAccount(accountId);
  if (!a) return;
  incomeAccountId = accountId;
  document.getElementById('incomeAccountInfo').innerHTML =
    a.phone + ' · ' + (a.account || '-') + '<br>' +
    (a.room || '未分配机房') + ' / ' + (a.platform || '未分类平台') + ' / ' + (a.node || '-');
  document.getElementById('income_date').value = presetDay || roomsDay || todayStr();
  document.getElementById('income_amount').value = '';
  document.getElementById('income_note').value = '';
  document.getElementById('incomeModal').classList.add('show');
}

function saveIncome() {
  var a = findAccount(incomeAccountId);
  if (!a) return;
  var amount = parseFloat(document.getElementById('income_amount').value);
  var day = document.getElementById('income_date').value || todayStr();
  var note = document.getElementById('income_note').value.trim();
  if (isNaN(amount) || amount <= 0) { showToast('请输入大于 0 的金额', 'error'); return; }

  // 同一天重复记会覆盖（与仓库 upsert_income 一致），且不改动账号余额
  DB.dailyIncome = DB.dailyIncome.filter(function(d) {
    if (d.date !== day) return true;
    if (d.accountId) return d.accountId !== a.id;
    return !(a.node && d.node === a.node && d.platform === a.platform);
  });
  DB.dailyIncome.push({
    id: genId(), accountId: a.id, date: day, amount: round2(amount),
    room: a.room, platform: a.platform, node: a.node,
    source: '手工', note: note, time: Date.now()
  });
  saveDB();
  closeModal('incomeModal');
  showToast('已记收入 ' + formatMoney(amount) + '（' + day + '）', 'success');
  vibrate(30);
  refreshAfterDataChange(a.id);
}

function deleteIncome(incomeId, accountId) {
  showConfirm('确认删除这条收入记录？', function() {
    DB.dailyIncome = DB.dailyIncome.filter(function(d) { return d.id !== incomeId; });
    saveDB();
    showToast('收入记录已删除', 'warning');
    refreshAfterDataChange(accountId);
  });
}

// ===== 手动记一笔流水 =====
function showManualTxnModal(accountId) {
  var a = findAccount(accountId);
  if (!a) return;
  incomeAccountId = accountId;
  document.getElementById('manualTxnInfo').innerHTML =
    a.phone + ' 当前余额 ' + formatMoney(a.balance);
  document.getElementById('txn_kind').value = '充值';
  document.getElementById('txn_amount').value = '';
  document.getElementById('txn_note').value = '';
  document.getElementById('manualTxnModal').classList.add('show');
}

function saveManualTxn() {
  var a = findAccount(incomeAccountId);
  if (!a) return;
  var kind = document.getElementById('txn_kind').value;
  var amount = parseFloat(document.getElementById('txn_amount').value);
  var note = document.getElementById('txn_note').value.trim();
  if (isNaN(amount) || amount < 0 || (kind !== '调整' && amount <= 0)) {
    showToast('请输入有效金额', 'error'); return;
  }

  if (kind === '充值') {
    a.balance = round2(a.balance + amount);
    a.totalRecharge = round2(a.totalRecharge + amount);
    addTransaction(a.id, (note || '手动充值') + ' - ' + a.phone, amount, '充值');
  } else if (kind === '扣费') {
    a.balance = round2(a.balance - amount);
    addTransaction(a.id, (note || '手动扣费') + ' - ' + a.phone, -amount, '扣费');
  } else {
    // 调整：把余额直接设为该值，流水记差额
    var delta = round2(amount - a.balance);
    a.balance = round2(amount);
    addTransaction(a.id, (note || '手动调整余额') + ' - ' + a.phone, delta, '调整');
  }

  saveDB();
  closeModal('manualTxnModal');
  showToast('已记账，当前余额 ' + formatMoney(a.balance), 'success');
  vibrate(30);
  refreshAfterDataChange(a.id);
}

// 数据变动后刷新当前界面（弹窗开着就刷新弹窗）
function refreshAfterDataChange(accountId) {
  var detail = document.getElementById('accountDetailModal');
  if (detail && detail.classList.contains('show') && accountId) {
    showAccountDetail(accountId);
    return;
  }
  if (currentPage === 'rooms') {
    document.getElementById('content').innerHTML = renderRooms();
    return;
  }
  navTo(currentPage);
}

// ===== 新增账号 =====
function showAddAccountModal() {
  document.getElementById('addAccountModal').classList.add('show');
}

function addAccount() {
  var phone = document.getElementById('new_phone').value.trim();
  var account = document.getElementById('new_account').value.trim();
  if (!phone) { showToast('请填写手机号', 'error'); return; }
  if (!account) { showToast('请填写宽带账号', 'error'); return; }

  // 唯一性校验
  var exists = DB.accounts.find(function(a) { return a.phone === phone || a.account === account; });
  if (exists) { showToast('手机号或宽带账号已存在', 'error'); return; }

  var data = {
    phone: phone,
    account: account,
    regcode: document.getElementById('new_regcode').value.trim(),
    owner: document.getElementById('new_owner').value.trim(),
    cardUser: document.getElementById('new_carduser').value.trim(),
    room: document.getElementById('new_room').value.trim(),
    platform: document.getElementById('new_platform').value.trim(),
    node: document.getElementById('new_node').value.trim(),
    packagePrice: parseFloat(document.getElementById('new_package').value) || 399,
    carrier: document.getElementById('new_carrier').value,
    remark: document.getElementById('new_remark').value.trim(),
    discount: false
  };

  var acc = createAccountObj(data);
  DB.accounts.push(acc);
  addTransaction(acc.id, '开号初始金额', 500, '充值');
  saveDB();

  // 清空表单
  document.querySelectorAll('#addAccountBody input').forEach(function(i) { i.value = ''; });
  document.getElementById('new_package').value = '399';

  closeModal('addAccountModal');
  showToast('账号创建成功，初始余额 ¥500', 'success');
  vibrate(40);
  navTo('accounts');
}

// ===== 充值 =====
function showRechargeModal(id) {
  rechargeAccountId = id;
  var a = findAccount(id);
  if (!a) return;
  document.getElementById('rechargeAccountInfo').innerHTML =
    a.phone + ' (' + (a.account||'-') + ')<br>当前余额: ' + formatMoney(a.balance);
  document.getElementById('recharge_amount').value = '';
  document.getElementById('rechargePreview').className = 'recharge-preview';
  document.getElementById('rechargeModal').classList.add('show');
}

function quickRecharge(amount) {
  var input = document.getElementById('recharge_amount');
  var current = parseFloat(input.value) || 0;
  input.value = round2(current + amount);
  previewRecharge();
}

function previewRecharge() {
  var amount = parseFloat(document.getElementById('recharge_amount').value);
  var a = findAccount(rechargeAccountId);
  if (!a || isNaN(amount) || amount <= 0) {
    document.getElementById('rechargePreview').className = 'recharge-preview';
    return;
  }
  var after = a.balance + amount;
  var el = document.getElementById('rechargePreview');
  el.className = 'recharge-preview show';
  el.innerHTML = '<span class="label">充值后余额: </span><span class="value">' + formatMoney(after) + '</span>' +
    '<div style="margin-top:4px;font-size:12px;color:var(--text-muted)">累计充值: ' + formatMoney(a.totalRecharge + amount) + '</div>';
}

function confirmRecharge() {
  var amount = parseFloat(document.getElementById('recharge_amount').value);
  if (isNaN(amount) || amount <= 0) { showToast('请输入有效金额', 'error'); return; }
  var a = findAccount(rechargeAccountId);
  if (!a) return;

  showConfirm('确认充值 ' + formatMoney(amount) + ' 到 ' + a.phone + ' ?', function() {
    a.balance = round2(a.balance + amount);
    a.totalRecharge = round2(a.totalRecharge + amount);
    addTransaction(a.id, '充值 - ' + a.phone, amount, '充值');
    saveDB();
    closeModal('rechargeModal');
    showToast('充值成功！余额: ' + formatMoney(a.balance), 'success');
    vibrate(40);
    navTo(currentPage);
  });
}

// ===== 账号详情 =====
function showAccountDetail(id) {
  var a = findAccount(id);
  if (!a) return;
  editingAccountId = id;
  var txs = DB.transactions.filter(function(t) { return t.accountId === id; }).sort(function(a,b){ return b.time - a.time; });

  var html = '';
  html += '<div class="kpi-grid">';
  html += kpiCard('当前余额', formatMoney(a.balance), a.balance >= 50 ? 'success' : (a.balance >= 10 ? 'warning' : 'danger'));
  html += kpiCard('累计充值', formatMoney(a.totalRecharge), 'accent');
  html += kpiCard('月费', formatMoney(a.monthlyFee) + (a.discount?'(七折)':''), '');
  html += kpiCard('每日扣费', formatMoney(a.dailyFee), 'warning');
  html += '</div>';

  html += '<div class="settings-card">';
  html += '<div class="settings-card-title">基本信息</div>';
  html += detailRow('手机号', a.phone + ' <button class="copy-btn" onclick="copyText(\'' + a.phone + '\')"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8,3h9a2,2 0 0 1 2,2v9h-2V5H8V3z"/><path fill="currentColor" d="M5,7h9a2,2 0 0 1 2,2v9a2,2 0 0 1 -2,2H5a2,2 0 0 1 -2,-2V9a2,2 0 0 1 2,-2zM5,9v9h9V9H5z"/></svg></button>');
  html += detailRow('宽带账号', (a.account || '-') + ' <button class="copy-btn" onclick="copyText(\'' + (a.account||'') + '\')"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8,3h9a2,2 0 0 1 2,2v9h-2V5H8V3z"/><path fill="currentColor" d="M5,7h9a2,2 0 0 1 2,2v9a2,2 0 0 1 -2,2H5a2,2 0 0 1 -2,-2V9a2,2 0 0 1 2,-2zM5,9v9h9V9H5z"/></svg></button>');
  html += detailRow('注册码', a.regcode || '-');
  html += detailRow('注册人', a.owner || '-');
  html += detailRow('手机卡使用人', a.cardUser || '-');
  html += detailRow('机房', a.room || '-');
  html += detailRow('节点平台', a.platform || '-');
  html += detailRow('节点号', (a.node || '-') + ' <button class="copy-btn" onclick="copyText(\'' + (a.node||'') + '\')"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8,3h9a2,2 0 0 1 2,2v9h-2V5H8V3z"/><path fill="currentColor" d="M5,7h9a2,2 0 0 1 2,2v9a2,2 0 0 1 -2,2H5a2,2 0 0 1 -2,-2V9a2,2 0 0 1 2,-2zM5,9v9h9V9H5z"/></svg></button>');
  html += detailRow('运营商', a.carrier || '-');
  html += detailRow('套餐原价', formatMoney(a.packagePrice));
  html += detailRow('七折优惠', a.discount ? '已开启 (锁定)' : '未开启');
  if (a.abnormal) html += detailRow('异常', '<span style="color:var(--danger)">' + a.abnormal.reason + (a.abnormal.note ? ' - ' + a.abnormal.note : '') + '</span>');
  html += detailRow('注册时间', formatDateTime(a.registeredAt));
  if (a.remark) html += detailRow('备注', a.remark);
  html += '</div>';

  // 操作按钮
  html += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
  html += '<button class="btn-primary" style="flex:1;" onclick="showRechargeModal(\'' + a.id + '\')">充值</button>';
  html += '<button class="btn-secondary" style="flex:1;" onclick="showEditModal(\'' + a.id + '\')">编辑</button>';
  html += '<button class="btn-secondary" style="flex:1;" onclick="showIncomeModal(\'' + a.id + '\')">记收入</button>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
  html += '<button class="btn-secondary" style="flex:1;" onclick="showManualTxnModal(\'' + a.id + '\')">手动记一笔</button>';
  if (!a.discountLocked) {
    html += '<button class="btn-secondary" style="flex:1;" onclick="toggleDiscount(\'' + a.id + '\')">开七折</button>';
  }
  if (!a.abnormal) {
    html += '<button class="btn-danger" style="flex:1;" onclick="markAbnormal(\'' + a.id + '\')">标异常</button>';
  } else {
    html += '<button class="btn-secondary" style="flex:1;" onclick="recoverAccount(\'' + a.id + '\')">恢复正常</button>';
  }
  html += '</div>';

  // 每日收入记录
  var myIncomes = incomesOfAccount(a).sort(function(x, y) { return y.date < x.date ? -1 : (y.date > x.date ? 1 : 0); }).slice(0, 10);
  html += '<div class="section-title"><span class="dot"></span>每日收入</div>';
  if (myIncomes.length === 0) {
    html += '<div class="empty-state"><p>还没有收入记录</p><p style="font-size:12px;margin-top:4px;">点上面「记收入」补录平台结算</p></div>';
  } else {
    myIncomes.forEach(function(d) {
      html += '<div class="transaction-item">';
      html += '<div><div class="tx-type">' + d.date + (d.note ? ' · ' + d.note : '') + '</div>' +
        '<div class="tx-time">' + (d.source || '手工') + '</div></div>';
      html += '<div style="display:flex;align-items:center;gap:10px;">';
      html += '<div class="tx-amount income">+' + formatMoney(d.amount) + '</div>';
      html += '<button class="copy-btn" style="width:auto;padding:4px 8px;" onclick="deleteIncome(\'' + d.id + '\',\'' + a.id + '\')">删除</button>';
      html += '</div></div>';
    });
  }

  // 流水
  html += '<div class="section-title"><span class="dot"></span>收支流水</div>';
  if (txs.length === 0) {
    html += '<div class="empty-state"><p>暂无流水记录</p></div>';
  } else {
    txs.forEach(function(t) {
      html += '<div class="transaction-item">';
      html += '<div><div class="tx-type">' + t.desc + '</div><div class="tx-time">' + formatDateTime(t.time) + '</div></div>';
      html += '<div class="tx-amount ' + (t.amount > 0 ? 'income' : 'expense') + '">' + (t.amount > 0 ? '+' : '') + formatMoney(t.amount) + '</div>';
      html += '</div>';
    });
  }

  // 删除账号放在最底部，避免误触
  html += '<button class="btn-danger" style="width:100%;margin:16px 0;" onclick="deleteAccount(\'' + a.id + '\')">删除该账号</button>';

  document.getElementById('accountDetailBody').innerHTML = html;
  document.getElementById('accountDetailModal').classList.add('show');
}

function deleteAccount(id) {
  var a = findAccount(id);
  if (!a) return;
  showConfirm('⚠️ 确认删除账号 ' + a.phone + ' ？\n该账号的流水会一并删除，不可恢复。', function() {
    DB.accounts = DB.accounts.filter(function(x) { return x.id !== id; });
    DB.transactions = DB.transactions.filter(function(t) { return t.accountId !== id; });
    DB.reminders = DB.reminders.filter(function(r) { return r.accountId !== id; });
    // 每日收入保留（平台结算属于历史事实），只断开关联
    DB.dailyIncome.forEach(function(d) { if (d.accountId === id) d.accountId = ''; });
    saveDB();
    closeModal('accountDetailModal');
    showToast('账号已删除', 'warning');
    vibrate(40);
    navTo(currentPage);
  });
}

function detailRow(label, value) {
  return '<div class="account-info-row"><span>' + label + '</span><span>' + value + '</span></div>';
}

// ===== 编辑账号 =====
function showEditModal(id) {
  var a = findAccount(id);
  if (!a) return;
  editingAccountId = id;
  closeModal('accountDetailModal');

  var html = '';
  html += '<div class="form-group"><label>手机号 *</label><input type="tel" id="edit_phone" value="' + a.phone + '" maxlength="11"></div>';
  html += '<div class="form-group"><label>宽带账号 *</label><input type="text" id="edit_account" value="' + (a.account||'') + '"></div>';
  html += '<div class="form-group"><label>宽带注册码</label><input type="text" id="edit_regcode" value="' + (a.regcode||'') + '"></div>';
  html += '<div class="form-row"><div class="form-group" style="flex:1"><label>注册人</label><input type="text" id="edit_owner" value="' + (a.owner||'') + '"></div>';
  html += '<div class="form-group" style="flex:1"><label>手机卡使用人</label><input type="text" id="edit_carduser" value="' + (a.cardUser||'') + '"></div></div>';
  html += '<div class="form-row"><div class="form-group" style="flex:1"><label>机房</label><input type="text" id="edit_room" value="' + (a.room||'') + '"></div>';
  html += '<div class="form-group" style="flex:1"><label>节点平台</label><input type="text" id="edit_platform" value="' + (a.platform||'') + '"></div></div>';
  html += '<div class="form-group"><label>节点号</label><input type="text" id="edit_node" value="' + (a.node||'') + '"></div>';
  html += '<div class="form-row"><div class="form-group" style="flex:1"><label>套餐原价</label><input type="number" id="edit_package" value="' + a.packagePrice + '" step="0.01"></div>';
  html += '<div class="form-group" style="flex:1"><label>运营商</label><select id="edit_carrier">';
  ['电信','联通','移动','广电'].forEach(function(c) {
    html += '<option value="' + c + '"' + (a.carrier===c?' selected':'') + '>' + c + '</option>';
  });
  html += '</select></div></div>';
  html += '<div class="form-group"><label>备注</label><input type="text" id="edit_remark" value="' + (a.remark||'') + '"></div>';
  html += '<button class="btn-primary" style="width:100%;margin-top:10px;" onclick="saveEdit()">保存修改</button>';

  document.getElementById('editAccountBody').innerHTML = html;
  document.getElementById('editAccountModal').classList.add('show');
}

function saveEdit() {
  var a = findAccount(editingAccountId);
  if (!a) return;
  var phone = document.getElementById('edit_phone').value.trim();
  var account = document.getElementById('edit_account').value.trim();
  if (!phone || !account) { showToast('手机号和宽带账号必填', 'error'); return; }

  // 唯一性校验（排除自身）
  var exists = DB.accounts.find(function(x) { return x.id !== a.id && (x.phone === phone || x.account === account); });
  if (exists) { showToast('手机号或宽带账号已被占用', 'error'); return; }

  a.phone = phone;
  a.account = account;
  a.regcode = document.getElementById('edit_regcode').value.trim();
  a.owner = document.getElementById('edit_owner').value.trim();
  a.cardUser = document.getElementById('edit_carduser').value.trim();
  a.room = document.getElementById('edit_room').value.trim();
  a.platform = document.getElementById('edit_platform').value.trim();
  a.node = document.getElementById('edit_node').value.trim();
  var newPrice = parseFloat(document.getElementById('edit_package').value) || a.packagePrice;
  a.packagePrice = newPrice;
  a.monthlyFee = a.discount ? round2(newPrice * 0.7) : round2(newPrice);
  var now = new Date();
  a.dailyFee = round2(a.monthlyFee / getDaysInMonth(now.getFullYear(), now.getMonth()));
  a.carrier = document.getElementById('edit_carrier').value;
  a.remark = document.getElementById('edit_remark').value.trim();
  saveDB();
  closeModal('editAccountModal');
  showToast('保存成功', 'success');
  vibrate(30);
  navTo(currentPage);
}

// ===== 七折开关 =====
function toggleDiscount(id) {
  var a = findAccount(id);
  if (!a) return;
  showConfirm('确认开启七折优惠？\n月费将变为 ' + formatMoney(a.packagePrice * 0.7) + '\n此操作不可逆！', function() {
    a.discount = true;
    a.discountLocked = true;
    a.monthlyFee = round2(a.packagePrice * 0.7);
    var now = new Date();
    a.dailyFee = round2(a.monthlyFee / getDaysInMonth(now.getFullYear(), now.getMonth()));
    saveDB();
    showToast('七折已开启，月费: ' + formatMoney(a.monthlyFee), 'success');
    vibrate(40);
    closeModal('accountDetailModal');
    showAccountDetail(id);
  });
}

// ===== 标记异常 =====
function markAbnormal(id) {
  var a = findAccount(id);
  if (!a) return;
  var reasons = ['机房', '当前电费', '管理线', '限速', '注销', '欠费'];
  var html = '<div class="settings-card"><div class="settings-card-title">选择异常原因</div>';
  reasons.forEach(function(r) {
    html += '<div class="toggle-row" onclick="setAbnormal(\'' + id + '\',\'' + r + '\')" style="cursor:pointer;">';
    html += '<span class="toggle-label">' + r + '</span><span style="color:var(--text-muted)">›</span></div>';
  });
  html += '</div>';
  html += '<div class="form-group" style="margin-top:10px;"><label>异常备注</label><input type="text" id="abnormal_note" placeholder="选填"></div>';
  html += '<button class="btn-secondary" style="width:100%;" onclick="closeModal(\'accountDetailModal\');showAccountDetail(\'' + id + '\')">取消</button>';
  document.getElementById('accountDetailBody').innerHTML = html;
}

function setAbnormal(id, reason) {
  var note = (document.getElementById('abnormal_note') || {}).value || '';
  var a = findAccount(id);
  if (!a) return;
  a.abnormal = { reason: reason, note: note.trim() };
  saveDB();
  showToast('已标记异常: ' + reason, 'warning');
  vibrate(40);
  closeModal('accountDetailModal');
  showAccountDetail(id);
}

// ===== 收支流水 =====
function renderTransactions() {
  var txs = DB.transactions.slice().sort(function(a,b) { return b.time - a.time; });
  var html = '';
  if (txs.length === 0) {
    html += emptyState('暂无流水记录', '充值和扣费记录会在这里显示');
  } else {
    // 汇总
    var totalIn = 0, totalOut = 0;
    txs.forEach(function(t) { if (t.amount > 0) totalIn += t.amount; else totalOut += Math.abs(t.amount); });
    html += '<div class="kpi-grid">';
    html += kpiCard('总收入', formatMoney(totalIn), 'success');
    html += kpiCard('总扣费', formatMoney(totalOut), 'danger');
    html += '</div>';
    html += '<div class="section-title"><span class="dot"></span>流水明细</div>';
    txs.forEach(function(t) {
      html += '<div class="transaction-item">';
      html += '<div><div class="tx-type">' + t.desc + '</div><div class="tx-time">' + formatDateTime(t.time) + '</div></div>';
      html += '<div class="tx-amount ' + (t.amount > 0 ? 'income' : 'expense') + '">' + (t.amount > 0 ? '+' : '') + formatMoney(t.amount) + '</div>';
      html += '</div>';
    });
  }
  return html;
}

// ===== AI 识图 =====
function renderVision() {
  var html = '';
  html += '<div class="section-title"><span class="dot"></span>上传收益截图</div>';
  html += '<div class="upload-zone" id="uploadZone" onclick="document.getElementById(\'imageInput\').click()">';
  html += '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M19,7v2.99s-1.99.01-2,0V7h-3v2h-2V7H8v2.99L6,10V7H4v12h16V7h-3zM20,5c1.1,0 2,0.9 2,2v12c0,1.1 -0.9,2 -2,2H4c-1.1,0 -2,-0.9 -2,-2V7c0,-1.1 0.9,-2 2,-2h3L5,5.99V6h2.01L9,5h2.5l1.99,1H16l1.99,-1H18v-.01L16,5h2zM16,12v2h-3v3h-2v-3H8v-2h3V9h2v3h3z"/></svg>';
  html += '<p>点击上传收益截图<br>AI 将以节点号为主键识别</p>';
  html += '</div>';
  html += '<input type="file" id="imageInput" accept="image/*" style="display:none;" onchange="handleImageUpload(event)">';
  html += '<div id="uploadPreview"></div>';
  html += '<div id="recognitionResult"></div>';

  html += '<div class="settings-card" style="margin-top:16px;">';
  html += '<div class="settings-card-title">识图说明</div>';
  html += '<div style="font-size:13px;color:var(--text-secondary);line-height:1.6;">';
  html += '1. 上传收益平台截图<br>2. AI 以节点号识别匹配账号<br>3. 识别结果可人工确认<br>4. 确认后自动写入台账';
  if (!DB.settings.visionModel) {
    html += '<br><br><span style="color:var(--warning);">⚠ 需在设置页配置支持图像的视觉模型（如 gpt-4o、qwen-vl-plus）</span>';
  }
  html += '</div></div>';
  return html;
}

function handleImageUpload(event) {
  var file = event.target.files[0];
  if (!file) return;
  visionRetryCount = 0; // 重置重试计数
  var reader = new FileReader();
  reader.onload = function(e) {
    var preview = document.getElementById('uploadPreview');
    preview.innerHTML = '<div class="upload-preview"><img src="' + e.target.result + '"></div>';

    var resultEl = document.getElementById('recognitionResult');
    if (!DB.settings.visionModel || !DB.settings.aiApiKey) {
      resultEl.innerHTML = '<div class="recognition-result"><p style="color:var(--warning);">未配置视觉模型，请先到设置页配置。</p></div>';
      return;
    }

    resultEl.innerHTML = '<div class="recognition-result"><div class="typing-dots"><span></span><span></span><span></span></div> AI 正在识别中...</div>';

    // 调用视觉 AI
    try {
      var base64 = e.target.result.split(',')[1];
      var xhr = new XMLHttpRequest();
      xhr.open('POST', DB.settings.aiBaseUrl.replace(/\/$/, '') + '/chat/completions', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', 'Bearer ' + DB.settings.aiApiKey);
      xhr.timeout = (DB.settings.visionTimeout || 300) * 1000;

      var body = JSON.stringify({
        model: DB.settings.visionModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请识别这张收益截图中的信息。以 JSON 数组格式返回，每条包含：node（节点号）、amount（金额）、date（日期，格式 YYYY-MM-DD）。只返回 JSON，不要其他文字。如果无日期，默认为昨天的日期。' },
            { type: 'image_url', image_url: { url: 'data:' + file.type + ';base64,' + base64 } }
          ]
        }],
        max_tokens: DB.settings.aiMaxTokens || 8192
      });

      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          if (xhr.status === 200) {
            try {
              var resp = JSON.parse(xhr.responseText);
              var text = resp.choices[0].message.content;
              var jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
              var items = JSON.parse(jsonText);
              showRecognitionResult(items);
            } catch(e) {
              resultEl.innerHTML = '<div class="recognition-result"><p style="color:var(--danger);">解析失败: ' + e.message + '</p><p style="font-size:12px;color:var(--text-muted);margin-top:4px;">原始返回: ' + text.substring(0,200) + '</p></div>';
            }
          } else if (xhr.status === 429 || xhr.status === 503) {
            // 最多重试2次，退避 2s → 8s
            if (visionRetryCount < 2) {
              visionRetryCount++;
              var backoff = visionRetryCount === 1 ? 2000 : 8000;
              resultEl.innerHTML = '<div class="recognition-result"><p style="color:var(--warning);">服务繁忙(' + xhr.status + ')，' + (backoff/1000) + '秒后自动重试 (' + visionRetryCount + '/2)...</p></div>';
              setTimeout(function() { handleImageUpload(event); }, backoff);
            } else {
              visionRetryCount = 0;
              resultEl.innerHTML = '<div class="recognition-result"><p style="color:var(--danger);">服务繁忙，已重试2次仍失败，请稍后再试。</p></div>';
            }
          } else {
            resultEl.innerHTML = '<div class="recognition-result"><p style="color:var(--danger);">识别失败(' + xhr.status + '): ' + xhr.statusText + '</p></div>';
          }
        }
      };
      xhr.send(body);
    } catch(e) {
      resultEl.innerHTML = '<div class="recognition-result"><p style="color:var(--danger);">请求异常: ' + e.message + '</p></div>';
    }
  };
  reader.readAsDataURL(file);
}

var recognizedItems = [];
function showRecognitionResult(items) {
  recognizedItems = items;
  var yesterday = formatDate(Date.now() - 86400000);
  var html = '<div class="recognition-result">';
  html += '<div style="font-size:14px;color:var(--success);margin-bottom:10px;">✓ 识别到 ' + items.length + ' 条记录（请确认后写入）</div>';
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">每行可手动选择账号和修改日期</div>';
  items.forEach(function(item, idx) {
    // 以节点号匹配，命中多条标"多候选"
    var matched = DB.accounts.filter(function(a) { return a.node === item.node; });
    var defaultDate = item.date || yesterday;
    html += '<div class="result-row" style="flex-direction:column;align-items:stretch;padding:10px 0;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<div style="font-size:14px;">节点: <strong>' + item.node + '</strong></div>';
    html += '<div style="font-size:15px;color:var(--success);font-weight:600;">¥' + item.amount + '</div>';
    html += '</div>';
    // 手动选账号
    html += '<div style="display:flex;gap:6px;align-items:center;">';
    html += '<span style="font-size:12px;color:var(--text-muted);flex-shrink:0;">选择账号:</span>';
    html += '<select id="recog_select_' + idx + '" class="inline-date" style="flex:1;">';
    if (matched.length === 0) {
      html += '<option value="">未匹配到账号</option>';
    } else if (matched.length > 1) {
      html += '<option value="">多候选 - 请选择</option>';
      matched.forEach(function(m) {
        html += '<option value="' + m.id + '">' + m.phone + ' (' + (m.account||'') + ')</option>';
      });
    } else {
      html += '<option value="' + matched[0].id + '">' + matched[0].phone + ' (' + (matched[0].account||'') + ')</option>';
    }
    // 也允许手动选其他账号
    DB.accounts.forEach(function(m) {
      if (matched.indexOf(m) < 0) {
        html += '<option value="' + m.id + '">' + m.phone + ' (' + (m.account||'') + ')</option>';
      }
    });
    html += '</select>';
    html += '</div>';
    // 可改日期
    html += '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;">';
    html += '<span style="font-size:12px;color:var(--text-muted);flex-shrink:0;">日期:</span>';
    html += '<input type="date" id="recog_date_' + idx + '" value="' + defaultDate + '" class="inline-date" style="flex:1;">';
    html += '</div>';
    if (matched.length > 1) {
      html += '<div style="font-size:11px;color:var(--warning);margin-top:4px;">⚠ 命中多个账号，请手动选择</div>';
    }
    html += '</div>';
  });
  html += '<button class="btn-primary" style="width:100%;margin-top:10px;" onclick="confirmRecognition()">确认写入台账</button>';
  html += '</div>';
  document.getElementById('recognitionResult').innerHTML = html;
}

function confirmRecognition() {
  var success = 0, fail = 0;
  recognizedItems.forEach(function(item, idx) {
    var accountId = document.getElementById('recog_select_' + idx) ? document.getElementById('recog_select_' + idx).value : '';
    var date = document.getElementById('recog_date_' + idx) ? document.getElementById('recog_date_' + idx).value : '';
    if (!accountId) { fail++; return; }
    var a = findAccount(accountId);
    if (!a) { fail++; return; }
    var amount = parseFloat(item.amount);
    if (isNaN(amount) || amount <= 0) { fail++; return; }
    a.balance = round2(a.balance + amount);
    a.totalRecharge = round2(a.totalRecharge + amount);
    var finalDate = date || formatDate(Date.now() - 86400000);
    addTransaction(a.id, 'AI识图充值 - ' + a.phone + ' (' + finalDate + ')', amount, '充值');
    addDailyIncomeWithDate(a, amount, 'AI识图', finalDate);
    success++;
  });
  saveDB();
  showToast('写入完成: 成功 ' + success + ' 条, 失败 ' + fail + ' 条', success > 0 ? 'success' : 'error');
  vibrate(50);
  document.getElementById('recognitionResult').innerHTML = '';
  document.getElementById('uploadPreview').innerHTML = '';
}

// ===== 数据导出 =====
function renderExport() {
  var UP = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#0D6A6D" d="M9,16h6v-6h4l-7,-7 -7,7h4zM5,18h14v2H5z"/></svg>';
  var html = '';
  if (lastImportResult) {
    html += '<div class="settings-card" style="border-left:3px solid var(--success);">';
    html += '<div class="settings-card-title" style="color:var(--success);">上次导入结果</div>';
    html += '<div class="account-info-row"><span>' + lastImportResult + '</span></div>';
    html += '</div>';
  }
  html += '<div class="section-title"><span class="dot"></span>导出数据</div>';
  html += '<div class="export-item" onclick="exportCSV(\'accounts\')"><div><div class="export-name">台账导出 CSV</div><div class="export-desc">余额、累计充值、每日扣费、机房、平台、节点号、异常原因</div></div><svg viewBox="0 0 24 24" width="20" height="20"><path fill="#0D6A6D" d="M19,9h-4V3H9v6H5l7,7L19,9z"/></svg></div>';
  html += '<div class="export-item" onclick="exportCSV(\'daily\')"><div><div class="export-name">每日收入 CSV</div><div class="export-desc">按天的收益金额</div></div><svg viewBox="0 0 24 24" width="20" height="20"><path fill="#0D6A6D" d="M19,9h-4V3H9v6H5l7,7L19,9z"/></svg></div>';
  html += '<div class="export-item" onclick="exportCSV(\'transactions\')"><div><div class="export-name">收支流水 CSV</div><div class="export-desc">所有充值、扣费记录</div></div><svg viewBox="0 0 24 24" width="20" height="20"><path fill="#0D6A6D" d="M19,9h-4V3H9v6H5l7,7L19,9z"/></svg></div>';
  html += '<div class="export-item" onclick="exportBackup()"><div><div class="export-name">全量备份 JSON</div><div class="export-desc">完整数据库快照</div></div><svg viewBox="0 0 24 24" width="20" height="20"><path fill="#0D6A6D" d="M19,9h-4V3H9v6H5l7,7L19,9z"/></svg></div>';

  html += '<div class="section-title"><span class="dot"></span>导入数据</div>';
  html += '<div class="export-item" onclick="triggerImport(\'merge\')"><div><div class="export-name">全量备份 JSON · 合并</div><div class="export-desc">按手机号/宽带账号匹配：已有账号只更新资料（机房、平台、节点号、注册人等），余额和异常状态保持本机不变；新账号连余额一起导入</div></div>' + UP + '</div>';
  html += '<div class="export-item" onclick="triggerImport(\'replace\')"><div><div class="export-name" style="color:var(--warning);">全量备份 JSON · 覆盖</div><div class="export-desc">用备份文件替换本机全部数据（账号、流水、每日收入），执行前会二次确认</div></div>' + UP + '</div>';
  html += '<div class="export-item" onclick="triggerImport(\'csv\')"><div><div class="export-name">台账 CSV 导入</div><div class="export-desc">表头需含「手机号」或「宽带账号」；已存在的账号更新资料与余额，其余新增。Excel 另存为 CSV 即可</div></div>' + UP + '</div>';
  html += '<div style="font-size:12px;color:var(--text-muted);padding:8px 4px;line-height:1.6;">' +
    '· 支持本机导出的「全量备份 JSON」「台账 CSV」，以及 Docker 容器版（FastAPI）导出的全量备份，UTF-8 编码<br>' +
    '· 容器版备份自动识别并换算字段：套餐原价与七折、每日扣费、余额调整、每日收入；容器版不记平台收入，收入需手工或 AI 识图补录<br>' +
    '· 文件只在手机本地解析，不会上传到任何服务器<br>' +
    '· 导入前建议先导出一份备份，出错可回滚</div>';

  html += '<div class="section-title"><span class="dot"></span>数据管理</div>';
  html += '<div class="export-item" onclick="clearAllData()"><div><div class="export-name" style="color:var(--danger);">清空所有数据</div><div class="export-desc">谨慎操作，不可恢复</div></div></div>';
  return html;
}


function exportCSV(type) {
  var csv = '\uFEFF'; // BOM
  if (type === 'accounts') {
    csv += '手机号,宽带账号,注册码,注册人,使用人,机房,平台,节点号,运营商,套餐原价,月费,每日扣费,余额,累计充值,七折,状态,异常原因,备注\n';
    DB.accounts.forEach(function(a) {
      csv += [a.phone, a.account, a.regcode, a.owner, a.cardUser, a.room, a.platform, a.node, a.carrier,
        a.packagePrice, a.monthlyFee, a.dailyFee, a.balance, a.totalRecharge, a.discount?'是':'否',
        a.abnormal?'异常':'正常', a.abnormal?a.abnormal.reason:'', a.remark].join(',') + '\n';
    });
  } else if (type === 'daily') {
    csv += '日期,金额,机房,平台,节点号,来源\n';
    DB.dailyIncome.forEach(function(d) {
      csv += [d.date, d.amount, d.room||'', d.platform||'', d.node||'', d.source||''].join(',') + '\n';
    });
  } else if (type === 'transactions') {
    csv += '时间,描述,类型,金额\n';
    DB.transactions.forEach(function(t) {
      csv += [formatDateTime(t.time), t.desc, t.type, t.amount].join(',') + '\n';
    });
  }
  downloadFile(csv, 'kuandai_' + type + '_' + todayStr() + '.csv', 'text/csv');
  showToast('导出成功', 'success');
}

function exportBackup() {
  var data = {
    accounts: DB.accounts,
    transactions: DB.transactions,
    dailyIncome: DB.dailyIncome,
    reminders: DB.reminders,
    // 退役表保留导出（分组信息不丢）
    account_groups: [],
    exportDate: new Date().toISOString(),
    version: appVersion().name,
    build: appVersion().code,
    buildDate: appVersion().date
  };
  downloadFile(JSON.stringify(data, null, 2), 'kuandai_backup_' + todayStr() + '.json', 'application/json');
  showToast('备份文件已下载（含敏感信息，请妥善保管）', 'success');
}

function downloadFile(content, filename, type) {
  var blob = new Blob([content], { type: type });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== 数据导入 =====
// 支持两类文件：本机导出的「全量备份 JSON」和「台账 CSV」。全部在本地解析，不上传。
var importMode = 'merge';
var lastImportResult = '';

function triggerImport(mode) {
  importMode = (mode === 'replace') ? 'replace' : 'merge';
  var el = document.getElementById('importFile');
  if (!el) { showToast('当前环境不支持选择文件', 'error'); return; }
  el.value = '';
  el.click();
}

function onImportFileChange(e) {
  var input = e.target;
  var file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    showToast('文件超过 8MB，无法导入', 'error');
    input.value = '';
    return;
  }
  var reader = new FileReader();
  reader.onload = function(ev) {
    var text = String(ev.target.result || '');
    var name = (file.name || '').toLowerCase();
    try {
      var isJson = name.slice(-5) === '.json' || /^\s*[\[{]/.test(text);
      if (isJson) importBackupJSON(text, importMode);
      else importAccountsCSV(text);
    } catch (err) {
      showToast('导入失败：' + (err && err.message ? err.message : err), 'error');
    }
    input.value = '';
  };
  reader.onerror = function() {
    showToast('文件读取失败，请确认文件是否损坏', 'error');
    input.value = '';
  };
  reader.readAsText(file, 'utf-8');
}

// ===== 容器版（FastAPI/SQLite）备份格式适配 =====
// 原项目 zozlio/kuandai-manager 的 Docker 版导出的备份是
//   { format:'kuandai-manager-backup', version:1, exported_at:'...',
//     tables:{ accounts:[...], transactions:[...], daily_incomes:[...],
//              reminders:[...], users:[...], account_groups:[...], app_settings:[...] } }
// 字段名全是 snake_case，且用整数外键关联账号，跟 APK 的扁平结构对不上。
// 这里把它翻译成 APK 的结构，再交给既有导入流程，避免两套导入逻辑。

// 容器版 provider → APK carrier
var CARRIER_MAP = {
  '中国电信': '电信', '中国联通': '联通', '中国移动': '移动', '中国广电': '广电',
  '电信': '电信', '联通': '联通', '移动': '移动', '广电': '广电'
};

// 容器版 abnormal_reason（英文 key）→ APK 异常原因（中文）
var ABNORMAL_REASON_MAP = {
  machine_room: '机房',
  power: '当前电费',
  manage_line: '管理线',
  throttle: '限速',
  cancel: '注销',
  arrears: '欠费'
};

// 容器版 transaction.kind → APK type
var TX_KIND_MAP = {
  charge: '扣费',
  recharge: '充值',
  adjust: '调整'
};

// 容器版 app_settings.key → APK settings 字段（只接 AI 接入信息，不碰 session_secret）
var SERVER_SETTING_MAP = {
  ai_base_url: 'aiBaseUrl',
  ai_api_key: 'aiApiKey',
  ai_model: 'aiModel',
  vision_model: 'visionModel'
};

// 容器版日期字符串 "YYYY-MM-DD HH:MM" → 时间戳
function parseServerTime(s) {
  if (!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
}

function mapCarrier(p) {
  if (!p) return '';
  return CARRIER_MAP[p] || CARRIER_MAP[String(p).replace(/^中国/, '')] || String(p);
}

/**
 * 把容器版备份翻译成 APK 结构。
 * 返回 { accounts, transactions, dailyIncome, settings, meta }
 *
 * 语义差异（已对照容器版 app/models.py、app/services.py 核实）：
 *  · transaction.kind：recharge=充值 / charge=每日扣费 / adjust=手动调整余额
 *  · adjust 的 amount 是「调整后的余额」（容器版直接 balance = amount），
 *    APK 的调整流水记的是「差额」，所以要按容器版规则回放流水把目标余额换算成差额
 *  · accounts.monthly_fee 是套餐原价，是否七折看 discount_enabled
 *  · accounts.daily_cost 为 0 表示按月费除以当月天数分摊
 *  · daily_incomes 用 day 存日期，且没有 room/platform/node，要从账号补
 *
 * id 规则：账号 'srv_acc_<容器版id>'、流水 'srv_tx_<id>'、收入 'srv_inc_<id>'。
 * 既不会和 APK 自己生成的 id 撞车，又能让重复导入靠 id 去重。
 */
function adaptServerBackup(data) {
  var tables = (data && data.tables) || {};
  var srcAccs = Array.isArray(tables.accounts) ? tables.accounts : [];
  var srcTxs = Array.isArray(tables.transactions) ? tables.transactions : [];
  var srcIncs = Array.isArray(tables.daily_incomes) ? tables.daily_incomes : [];

  // ---- AI 接口配置（只取接入信息，session_secret 之类一律不碰）----
  var settings = {};
  (Array.isArray(tables.app_settings) ? tables.app_settings : []).forEach(function(r) {
    if (!r || !r.key) return;
    var field = SERVER_SETTING_MAP[String(r.key)];
    if (field) settings[field] = strOr(r.value);
  });

  // ---- 账号 ----
  var idMap = {};    // 容器版账号 id → APK 账号 id
  var srcById = {};  // 容器版账号 id → 原始记录（给每日收入补机房/平台/节点）
  var now = new Date();
  var days = getDaysInMonth(now.getFullYear(), now.getMonth());

  var accounts = srcAccs.map(function(r) {
    srcById[String(r.id)] = r;
    var price = numOr(r.monthly_fee, 399);
    var discount = (r.discount_enabled === 1 || r.discount_enabled === '1' || r.discount_enabled === true);
    var fee = round2(discount ? price * 0.7 : price);
    var dailyCost = numOr(r.daily_cost, 0);
    if (!dailyCost) dailyCost = round2(fee / days);

    var abnormal = null;
    var reason = ABNORMAL_REASON_MAP[r.abnormal_reason] || strOr(r.abnormal_reason);
    if (reason) abnormal = { reason: reason, note: strOr(r.abnormal_note) };
    else if (String(r.category || '').toLowerCase() === 'abnormal') abnormal = { reason: '异常', note: strOr(r.abnormal_note) };

    // APK 没有「安装地址」字段，塞进备注里，别把数据丢了
    var remark = strOr(r.notes);
    var addr = strOr(r.install_address);
    if (addr) remark = remark ? (remark + '；安装地址：' + addr) : ('安装地址：' + addr);

    var acc = {
      id: 'srv_acc_' + strOr(r.id),
      phone: strOr(r.phone),
      account: strOr(r.broadband_account),
      regcode: strOr(r.registration_code),
      owner: strOr(r.registrant),
      cardUser: strOr(r.sim_user),
      room: strOr(r.room),
      platform: strOr(r.platform),
      node: strOr(r.node_account),
      packagePrice: price,
      carrier: mapCarrier(r.provider),
      remark: remark,
      discount: discount,
      discountLocked: discount,   // 容器版七折同样不可关闭
      monthlyFee: fee,
      dailyFee: dailyCost,
      balance: numOr(r.balance, 0),
      totalRecharge: numOr(r.total_recharged, 0),
      abnormal: abnormal
    };

    var out = normalizeImportedAccount(acc);
    var createdAt = parseServerTime(r.created_at);
    var registeredAt = parseServerTime(r.registered_at);
    if (createdAt) out.createdAt = createdAt;
    if (registeredAt) out.registeredAt = registeredAt;
    idMap[String(r.id)] = out.id;
    return out;
  });

  // ---- 调整流水换算 ----
  // 容器版「调整」的 amount 是调整后的余额，APK 记的是差额。
  // 按容器版规则（充值 +、扣费 -、调整设成目标值）按时间回放每个账号的流水，
  // 目标余额 - 回放出来的当前余额 = 这笔调整的差额。
  var balanceState = {};
  var adjustDelta = {};
  srcTxs.slice().sort(function(a, b) {
    var ta = parseServerTime(a.created_at) || 0;
    var tb = parseServerTime(b.created_at) || 0;
    if (ta !== tb) return ta - tb;
    return numOr(a.id, 0) - numOr(b.id, 0);
  }).forEach(function(t) {
    var key = String(t.account_id);
    var amount = numOr(t.amount, 0);
    var cur = balanceState[key] || 0;
    if (t.kind === 'recharge') cur = round2(cur + amount);
    else if (t.kind === 'charge') cur = round2(cur - amount);
    else { adjustDelta[String(t.id)] = round2(amount - cur); cur = amount; }
    balanceState[key] = cur;
  });

  // ---- 流水 ----
  var transactions = srcTxs.map(function(t) {
    var amount = numOr(t.amount, 0);
    var kind = TX_KIND_MAP[t.kind] || '调整';
    var signed, desc = strOr(t.note);
    if (kind === '扣费') {
      signed = -Math.abs(amount);            // APK 约定：扣费为负
    } else if (kind === '充值') {
      signed = Math.abs(amount);             // APK 约定：充值为正
    } else {
      var delta = adjustDelta[String(t.id)];
      signed = (delta === undefined) ? amount : delta;
      desc = (desc || '手动调整余额') + '（差额 ' + (signed >= 0 ? '+' : '') + round2(signed).toFixed(2) + '）';
    }
    if (!desc) desc = kind;
    var time = parseServerTime(t.created_at);
    return {
      id: 'srv_tx_' + strOr(t.id),
      accountId: idMap[String(t.account_id)] || '',
      desc: desc,
      amount: round2(signed),
      type: kind,
      time: time || Date.now()
    };
  }).filter(function(t) { return t.amount; });

  // ---- 每日收入 ----
  var dailyIncome = srcIncs.map(function(d) {
    var day = strOr(d.day || d.date);
    if (!day) return null;
    var amount = numOr(d.amount, 0);
    if (!amount) return null;
    var src = srcById[String(d.account_id)] || {};
    return {
      id: 'srv_inc_' + strOr(d.id),
      accountId: idMap[String(d.account_id)] || '',
      date: day,
      amount: amount,
      room: strOr(src.room),
      platform: strOr(src.platform),
      node: strOr(src.node_account),
      source: d.source === 'ai' ? 'AI识图' : '手工',
      note: strOr(d.note),
      time: parseServerTime(d.created_at) || Date.now()
    };
  }).filter(function(d) { return d; });

  return {
    accounts: accounts,
    transactions: transactions,
    dailyIncome: dailyIncome,
    settings: settings,
    meta: {
      src: '容器版（FastAPI/SQLite）',
      exportedAt: strOr(data.exported_at),
      accountCount: accounts.length,
      txCount: transactions.length,
      incomeCount: dailyIncome.length
    }
  };
}

/** 嗅探备份格式：容器版 / APK 版 */
function detectBackupFormat(data) {
  if (data && data.tables && typeof data.tables === 'object') return 'server';
  if (data && data.format === 'kuandai-manager-backup') return 'server';
  if (Array.isArray(data)) return 'apk';
  if (data && Array.isArray(data.accounts)) return 'apk';
  return 'unknown';
}

function importBackupJSON(text, mode) {
  var data = JSON.parse(text);
  var fmt = detectBackupFormat(data);
  var adapted = null;

  if (fmt === 'server') {
    // 容器版：先翻译成 APK 结构
    adapted = adaptServerBackup(data);
    data = {
      accounts: adapted.accounts,
      transactions: adapted.transactions,
      dailyIncome: adapted.dailyIncome
    };
  }

  var raw = Array.isArray(data) ? data : (data && data.accounts);
  if (!raw || !raw.length) {
    throw new Error(fmt === 'server'
      ? '容器版备份里没有账号数据'
      : '备份文件里没有账号数据');
  }
  var accs = raw.filter(function(r) { return r && (r.phone || r.account); });
  if (!accs.length) throw new Error('备份文件里没有可用账号（缺少手机号或宽带账号）');

  var txIn = (data && Array.isArray(data.transactions)) ? data.transactions : [];
  var incIn = (data && Array.isArray(data.dailyIncome)) ? data.dailyIncome : [];

  var apply = function() {
    var add = 0, upd = 0, addedTx = 0, addedInc = 0, cfgAdded = 0;
    if (mode === 'replace') {
      DB.accounts = accs.map(normalizeImportedAccount);
      DB.transactions = txIn.map(normalizeImportedTransaction).filter(Boolean);
      DB.dailyIncome = incIn.map(normalizeImportedIncome).filter(Boolean);
      DB.reminders = (data && Array.isArray(data.reminders)) ? data.reminders : [];
      add = DB.accounts.length;
      addedTx = DB.transactions.length;
      addedInc = DB.dailyIncome.length;
    } else {
      // 导入侧账号 id → 最终账号 id：本机已存在同手机号账号时，
      // 保留本机账号 id，导入的流水/收入要跟着改指向它，不然会变成孤儿记录。
      var idRemap = {};
      accs.forEach(function(r) {
        var inc = normalizeImportedAccount(r);
        var hit = DB.accounts.find(function(a) { return a.phone && a.phone === inc.phone; }) ||
                  DB.accounts.find(function(a) { return a.account && a.account === inc.account; });
        if (!hit) {
          DB.accounts.push(inc);
          idRemap[inc.id] = inc.id;
          add++;
          return;
        }
        idRemap[inc.id] = hit.id;
        // 合并只补资料字段；余额、累计充值、异常状态以本机为准，避免覆盖已发生的账
        ['account', 'regcode', 'owner', 'cardUser', 'room', 'platform', 'node', 'carrier', 'remark'].forEach(function(k) {
          if (inc[k]) hit[k] = inc[k];
        });
        if (inc.packagePrice) {
          hit.packagePrice = inc.packagePrice;
          if (!hit.discountLocked) {
            var fee = inc.discount ? inc.packagePrice * 0.7 : inc.packagePrice;
            hit.monthlyFee = round2(fee);
            hit.dailyFee = round2(fee / getDaysInMonth(new Date().getFullYear(), new Date().getMonth()));
          }
        }
        upd++;
      });
      var txSeen = {};
      DB.transactions.forEach(function(t) { txSeen[txKey(t)] = 1; });
      txIn.forEach(function(r) {
        var t = normalizeImportedTransaction(r);
        if (!t) return;
        if (t.accountId && idRemap[t.accountId]) t.accountId = idRemap[t.accountId];
        if (!txSeen[txKey(t)]) { DB.transactions.push(t); txSeen[txKey(t)] = 1; addedTx++; }
      });
      var incSeen = {};
      DB.dailyIncome.forEach(function(d) { incSeen[incomeKey(d)] = 1; });
      incIn.forEach(function(r) {
        var d = normalizeImportedIncome(r);
        if (!d) return;
        if (d.accountId && idRemap[d.accountId]) d.accountId = idRemap[d.accountId];
        if (!incSeen[incomeKey(d)]) { DB.dailyIncome.push(d); incSeen[incomeKey(d)] = 1; addedInc++; }
      });
    }

    // 容器版顺带把 AI 接口配置带过来（只补本机空缺的，不覆盖已有配置）
    if (adapted && adapted.settings) {
      Object.keys(adapted.settings).forEach(function(k) {
        var v = adapted.settings[k];
        if (v && !DB.settings[k]) { DB.settings[k] = v; cfgAdded++; }
      });
    }

    saveDB();
    var msg;
    if (mode === 'replace') {
      msg = '覆盖导入完成：账号 ' + DB.accounts.length + ' 个、流水 ' + DB.transactions.length +
            ' 条、每日收入 ' + DB.dailyIncome.length + ' 条';
    } else {
      msg = '合并导入完成：新增账号 ' + add + ' 个、更新资料 ' + upd + ' 个、补充流水 ' +
            addedTx + ' 条、每日收入 ' + addedInc + ' 条（重复的已跳过）';
    }
    if (adapted) {
      msg += '；已识别为容器版备份' + (adapted.meta.exportedAt ? '（导出于 ' + adapted.meta.exportedAt + '）' : '');
      if (!adapted.dailyIncome.length) msg += '；容器版没有每日收入记录，平台收入需手工记或用 AI 识图补录';
      if (cfgAdded) msg += '；已带入 AI 接口配置 ' + cfgAdded + ' 项';
    }
    finishImport(msg, add + upd > 0 || mode === 'replace');
  };

  if (mode === 'replace') {
    showConfirm('⚠️ 覆盖导入会用备份文件替换本机全部数据\n当前：账号 ' + DB.accounts.length +
      ' 个、流水 ' + DB.transactions.length + ' 条、每日收入 ' + DB.dailyIncome.length + ' 条\n替换后不可恢复，确认继续？', apply);
  } else {
    apply();
  }
}

function importAccountsCSV(text) {
  var rows = parseCSV(text);
  if (!rows.length) throw new Error('CSV 内容为空');
  if (rows.length < 2) throw new Error('CSV 只有表头，没有数据行');
  var head = rows[0].map(function(h) { return String(h).replace(/\s/g, ''); });
  var idx = csvHeaderMap(head);
  if (idx.phone === undefined && idx.account === undefined) {
    throw new Error('表头里必须有「手机号」或「宽带账号」列');
  }

  var add = 0, upd = 0, skip = 0;
  rows.slice(1).forEach(function(r) {
    var get = function(k) {
      if (idx[k] === undefined) return '';
      var v = r[idx[k]];
      return v === undefined || v === null ? '' : String(v).trim();
    };
    var phone = get('phone'), account = get('account');
    if (!phone && !account) { skip++; return; }

    var hit = null;
    if (phone) hit = DB.accounts.find(function(a) { return a.phone === phone; });
    if (!hit && account) hit = DB.accounts.find(function(a) { return a.account === account; });
    if (!hit) hit = null;

    var price = get('packagePrice') === '' ? null : numOr(get('packagePrice'), null);
    var discount = get('discount') === '是' || get('discount') === 'true' || get('discount') === '1';

    if (hit) {
      if (account) hit.account = account;
      ['regcode', 'owner', 'cardUser', 'room', 'platform', 'node', 'carrier', 'remark'].forEach(function(k) {
        var v = get(k);
        if (v) hit[k] = v;
      });
      if (price !== null) hit.packagePrice = price;
      if (get('balance') !== '') hit.balance = numOr(get('balance'), hit.balance);
      if (get('totalRecharge') !== '') hit.totalRecharge = numOr(get('totalRecharge'), hit.totalRecharge);
      var reason0 = get('abnormalReason');
      if (reason0) hit.abnormal = { reason: reason0, note: (hit.abnormal && hit.abnormal.note) || '' };
      upd++;
      return;
    }

    var a = createAccountObj({
      phone: phone, account: account, regcode: get('regcode'), owner: get('owner'),
      cardUser: get('cardUser'), room: get('room'), platform: get('platform'), node: get('node'),
      packagePrice: price === null ? 399 : price, carrier: get('carrier') || '电信',
      remark: get('remark'), discount: discount
    });
    var bal = get('balance') === '' ? null : numOr(get('balance'), null);
    if (bal !== null) {
      a.balance = bal;
      a.totalRecharge = get('totalRecharge') === '' ? bal : numOr(get('totalRecharge'), bal);
    }
    var reason = get('abnormalReason');
    if (reason) a.abnormal = { reason: reason, note: '' };
    DB.accounts.push(a);
    if (a.balance > 0) addTransaction(a.id, '导入初始余额 - ' + a.phone, a.balance, '充值');
    add++;
  });

  saveDB();
  var msg = 'CSV 导入完成：新增 ' + add + ' 个，更新 ' + upd + ' 个' + (skip ? '，跳过 ' + skip + ' 行空数据' : '');
  finishImport(msg, add + upd > 0);
}

function finishImport(msg, ok) {
  lastImportResult = msg;
  showToast(msg, ok ? 'success' : 'warning');
  vibrate(40);
  navTo('export');
}

// CSV 解析：支持引号包裹、字段内逗号、双引号转义、CRLF
function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  var rows = [], row = [], cur = '', quoted = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n') {
      row.push(cur); rows.push(row); row = []; cur = '';
    } else if (ch === '\r') {
      // 忽略
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(function(r) {
    return r.some(function(c) { return String(c).trim() !== ''; });
  });
}

function csvHeaderMap(head) {
  var alias = {
    phone: ['手机号', '手机', '电话', '号码'],
    account: ['宽带账号', '账号', '宽带号码'],
    regcode: ['注册码', '宽带注册码'],
    owner: ['注册人', '姓名'],
    cardUser: ['使用人', '手机卡使用人', '卡使用人'],
    room: ['机房'],
    platform: ['平台', '节点平台'],
    node: ['节点号', '节点'],
    carrier: ['运营商'],
    packagePrice: ['套餐原价', '套餐价', '原价'],
    balance: ['余额'],
    totalRecharge: ['累计充值'],
    discount: ['七折', '七折优惠'],
    abnormalReason: ['异常原因', '异常'],
    remark: ['备注']
  };
  var idx = {};
  Object.keys(alias).forEach(function(k) {
    for (var i = 0; i < head.length; i++) {
      if (alias[k].indexOf(head[i]) >= 0) { idx[k] = i; return; }
    }
  });
  return idx;
}

function strOr(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function numOr(v, dflt) {
  var n = parseFloat(v);
  return isNaN(n) ? dflt : round2(n);
}

function normalizeImportedAccount(raw) {
  var price = numOr(raw.packagePrice, 399);
  var a = createAccountObj({
    phone: strOr(raw.phone), account: strOr(raw.account), regcode: strOr(raw.regcode),
    owner: strOr(raw.owner), cardUser: strOr(raw.cardUser), room: strOr(raw.room),
    platform: strOr(raw.platform), node: strOr(raw.node), packagePrice: price,
    carrier: strOr(raw.carrier) || '电信', remark: strOr(raw.remark),
    discount: !!raw.discount
  });
  if (strOr(raw.id)) a.id = strOr(raw.id);
  if (raw.balance !== undefined && raw.balance !== null && raw.balance !== '') a.balance = numOr(raw.balance, a.balance);
  if (raw.totalRecharge !== undefined && raw.totalRecharge !== null && raw.totalRecharge !== '') a.totalRecharge = numOr(raw.totalRecharge, a.totalRecharge);
  if (raw.monthlyFee !== undefined && raw.monthlyFee !== null && raw.monthlyFee !== '') a.monthlyFee = numOr(raw.monthlyFee, a.monthlyFee);
  if (raw.dailyFee !== undefined && raw.dailyFee !== null && raw.dailyFee !== '') a.dailyFee = numOr(raw.dailyFee, a.dailyFee);
  if (raw.discountLocked) a.discountLocked = true;
  if (raw.abnormal && raw.abnormal.reason) a.abnormal = { reason: strOr(raw.abnormal.reason), note: strOr(raw.abnormal.note) };
  if (raw.createdAt) a.createdAt = numOr(raw.createdAt, a.createdAt);
  if (raw.registeredAt) a.registeredAt = numOr(raw.registeredAt, a.registeredAt);
  return a;
}

function normalizeImportedTransaction(t) {
  if (!t || !t.amount) return null;
  var amount = numOr(t.amount, 0);
  if (!amount) return null;
  return {
    id: strOr(t.id) || genId(),
    accountId: strOr(t.accountId),
    desc: strOr(t.desc) || '导入流水',
    amount: amount,
    type: strOr(t.type) || (amount > 0 ? '充值' : '扣费'),
    time: numOr(t.time, Date.now())
  };
}

function normalizeImportedIncome(d) {
  if (!d || !d.date) return null;
  var amount = numOr(d.amount, 0);
  if (!amount) return null;
  return {
    id: strOr(d.id) || genId(),
    accountId: strOr(d.accountId),
    date: strOr(d.date),
    amount: amount,
    room: strOr(d.room),
    platform: strOr(d.platform),
    node: strOr(d.node),
    source: strOr(d.source) || '导入',
    note: strOr(d.note),
    time: numOr(d.time, Date.now())
  };
}

function txKey(t) { return t.id || (t.time + '|' + (t.accountId || '') + '|' + t.amount); }
function incomeKey(d) {
  return d.id || [d.accountId || '', d.node || '', d.platform || '', d.date, d.amount].join('|');
}

function clearAllData() {
  showConfirm('⚠️ 确认清空所有数据？\n这将删除所有账号、流水和记录，不可恢复！', function() {
    DB.accounts = [];
    DB.transactions = [];
    DB.dailyIncome = [];
    DB.reminders = [];
    saveDB();
    showToast('数据已清空', 'warning');
    vibrate(60);
    navTo('dashboard');
  });
}

// ===== 设置 =====
function renderSettings() {
  var s = DB.settings;
  var html = '';
  // AI 接口（AI 识图使用同一套地址与密钥）
  html += '<div class="settings-card">';
  html += '<div class="settings-card-title">AI 接口（AI 识图使用）</div>';
  html += '<div class="form-group"><label>接口地址</label><input type="text" id="set_aiBaseUrl" value="' + (s.aiBaseUrl||'') + '" placeholder="如 https://api.deepseek.com/v1"></div>';
  // 密钥只显示尾4字符
  var keyDisplay = '';
  if (s.aiApiKey && s.aiApiKey.length > 4) {
    keyDisplay = '****' + s.aiApiKey.slice(-4);
  }
  html += '<div class="form-group"><label>密钥' + (keyDisplay ? ' (当前: ' + keyDisplay + ')' : '') + '</label><input type="password" id="set_aiApiKey" placeholder="' + (keyDisplay ? '已配置，留空保持不变' : 'sk-xxxx') + '"></div>';
  html += '<div style="display:flex;gap:8px;">';
  html += '<button class="btn-primary" style="flex:2;" onclick="saveAISettings()">保存配置</button>';
  html += '<button class="btn-secondary" style="flex:1;" onclick="testAIConnection()">测试连接</button>';
  html += '</div>';
  html += '<button class="btn-secondary" style="width:100%;margin-top:8px;" onclick="resetAIConfig()">恢复环境变量</button>';
  html += '</div>';

  // AI 视觉模型
  html += '<div class="settings-card">';
  html += '<div class="settings-card-title">AI 视觉模型（识图）</div>';
  html += '<div class="form-group"><label>视觉模型名</label><input type="text" id="set_visionModel" value="' + (s.visionModel||'') + '" placeholder="如 gpt-4o, qwen-vl-plus"></div>';
  html += '<div class="form-group"><label>识图超时 (秒)</label><input type="number" id="set_visionTimeout" value="' + (s.visionTimeout||300) + '"></div>';
  html += '<div class="form-group"><label>最大 Token</label><input type="number" id="set_aiMaxTokens" value="' + (s.aiMaxTokens||8192) + '"></div>';
  html += '<button class="btn-primary" style="width:100%;" onclick="saveVisionSettings()">保存视觉设置</button>';
  html += '</div>';

  // 定时扣费
  html += '<div class="settings-card">';
  html += '<div class="settings-card-title">定时扣费</div>';
  html += '<div class="form-group"><label>每日扣费时间 (时:分)</label>';
  html += '<div class="form-row"><div class="form-group" style="flex:1"><input type="number" id="set_checkHour" value="' + (s.dailyCheckHour||0) + '" min="0" max="23"></div>';
  html += '<div class="form-group" style="flex:1"><input type="number" id="set_checkMinute" value="' + (s.dailyCheckMinute||5) + '" min="0" max="59"></div></div>';
  html += '<button class="btn-primary" style="width:100%;" onclick="saveScheduleSettings()">保存</button>';
  html += '</div>';

  // 服务商示例
  html += '<div class="settings-card">';
  html += '<div class="settings-card-title">常见服务商示例</div>';
  html += '<div style="font-size:12px;color:var(--text-secondary);line-height:1.8;">';
  html += '<b>DeepSeek</b>: api.deepseek.com/v1 → deepseek-chat<br>';
  html += '<b>通义千问</b>: dashscope.aliyuncs.com/compatible-mode/v1 → qwen-plus / qwen-vl-plus<br>';
  html += '<b>MiniMax 国内</b>: api.minimaxi.com/v1 → MiniMax-M3 / M3-VL-01<br>';
  html += '<b>OpenAI</b>: api.openai.com/v1 → gpt-4o-mini / gpt-4o<br>';
  html += '<b>本地 Ollama</b>: host.docker.internal:11434/v1 → 本地模型名<br>';
  html += '<span style="color:var(--warning);">⚠ 国内密钥配国内域名，国际密钥配国际域名，混用会报 invalid api key</span>';
  html += '</div></div>';

  // 应用信息
  html += '<div class="settings-card">';
  html += '<div class="settings-card-title">应用信息</div>';
  html += detailRow('版本', appFullVersion());
  if (window.AndroidApp) {
    html += detailRow('Android 版本', AndroidApp.getAndroidVersion());
    html += detailRow('SDK', AndroidApp.getSdkInt());
  }
  html += detailRow('账号总数', DB.accounts.length + ' 个');
  html += detailRow('流水总数', DB.transactions.length + ' 条');
  html += '</div>';

  // 演示数据
  html += '<div class="settings-card">';
  html += '<div class="settings-card-title">演示数据</div>';
  html += '<button class="btn-secondary" style="width:100%;" onclick="reseedDemo()">重新生成演示数据</button>';
  html += '</div>';

  return html;
}

function saveAISettings() {
  DB.settings.aiBaseUrl = document.getElementById('set_aiBaseUrl').value.trim();
  var keyInput = document.getElementById('set_aiApiKey').value.trim();
  // 如果留空，保持原值不变
  if (keyInput) {
    DB.settings.aiApiKey = keyInput;
  }
  saveDB();
  showToast('AI 配置已保存，立即生效', 'success');
  vibrate(30);
}

// 用视觉模型发一次最小请求验证地址与密钥（异步，避免卡住界面）
function testAIConnection() {
  var baseUrl = document.getElementById('set_aiBaseUrl').value.trim();
  var keyInput = document.getElementById('set_aiApiKey').value.trim();
  var apiKey = keyInput || DB.settings.aiApiKey;
  var modelEl = document.getElementById('set_visionModel');
  var model = (modelEl ? modelEl.value.trim() : '') || DB.settings.visionModel || 'gpt-4o-mini';
  if (!baseUrl || !apiKey) {
    showToast('请先填写接口地址和密钥', 'error');
    return;
  }
  showToast('正在测试连接...', '');
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', baseUrl.replace(/\/$/, '') + '/chat/completions', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
    xhr.timeout = 15000;
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        showToast('✓ 连接成功，模型 ' + model + ' 可用', 'success');
      } else if (xhr.status === 0) {
        showToast('✗ 连接失败：网络不可达或接口地址错误', 'error');
      } else if (xhr.status === 401 || xhr.status === 403) {
        showToast('✗ 密钥无效（HTTP ' + xhr.status + '）', 'error');
      } else if (xhr.status === 404) {
        showToast('✗ 接口路径不对，检查地址是否以 /v1 结尾', 'error');
      } else {
        showToast('✗ 连接失败: HTTP ' + xhr.status, 'error');
      }
    };
    xhr.ontimeout = function() { showToast('✗ 连接超时', 'error'); };
    xhr.onerror = function() { showToast('✗ 网络错误，检查接口地址', 'error'); };
    xhr.send(JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 8
    }));
  } catch (e) {
    showToast('✗ 连接异常: ' + e.message, 'error');
  }
}

function resetAIConfig() {
  showConfirm('确认恢复环境变量配置？\n当前页面配置将被清除。', function() {
    DB.settings.aiBaseUrl = '';
    DB.settings.aiApiKey = '';
    DB.settings.aiModel = '';
    saveDB();
    showToast('已恢复环境变量', 'warning');
    navTo('settings');
  });
}

function saveVisionSettings() {
  DB.settings.visionModel = document.getElementById('set_visionModel').value.trim();
  DB.settings.visionTimeout = parseInt(document.getElementById('set_visionTimeout').value) || 300;
  DB.settings.aiMaxTokens = parseInt(document.getElementById('set_aiMaxTokens').value) || 8192;
  saveDB();
  showToast('视觉模型设置已保存', 'success');
  vibrate(30);
}

function saveScheduleSettings() {
  DB.settings.dailyCheckHour = parseInt(document.getElementById('set_checkHour').value) || 0;
  DB.settings.dailyCheckMinute = parseInt(document.getElementById('set_checkMinute').value) || 5;
  saveDB();
  showToast('定时设置已保存', 'success');
}

function reseedDemo() {
  showConfirm('确认清空当前数据并重新生成演示数据？', function() {
    DB.accounts = [];
    DB.transactions = [];
    DB.dailyIncome = [];
    DB.reminders = [];
    saveDB();
    seedDemoData();
    showToast('演示数据已生成', 'success');
    vibrate(40);
    navTo('dashboard');
  });
}

// ===== 扣费逻辑 =====
function checkDailyDeduction() {
  var today = todayStr();
  var lastCheck = _getItem('kd_lastDeductionDate');
  if (lastCheck === today) return; // 今天已经扣过了
  runDeduction(today);
}

function runDailyCheck() {
  var today = todayStr();
  showConfirm('确认立即执行扣费巡检？', function() {
    var count = runDeduction(today);
    showToast('巡检完成：扣费 ' + count + ' 笔', 'success');
    vibrate(40);
    navTo('dashboard');
  });
}

function runDeduction(dateStr) {
  var count = 0;
  var now = new Date();
  var daysInMonth = getDaysInMonth(now.getFullYear(), now.getMonth());

  DB.accounts.forEach(function(a) {
    if (a.abnormal) return; // 异常账号不扣费
    if (a.balance < a.dailyFee) return; // 余额不足不扣款，等充值后再扣
    // 正常扣费
    a.balance = round2(a.balance - a.dailyFee);
    addTransaction(a.id, '每日扣费 - ' + a.phone, -a.dailyFee, '扣费');
    count++;
  });

  // 月末补齐
  if (now.getDate() === daysInMonth) {
    DB.accounts.forEach(function(a) {
      if (a.abnormal) return;
      var totalDeducted = a.dailyFee * daysInMonth;
      var diff = a.monthlyFee - totalDeducted;
      if (Math.abs(diff) > 0.01 && a.balance >= diff) {
        a.balance = round2(a.balance - diff);
        addTransaction(a.id, '月末补齐 - ' + a.phone, -round2(diff), '扣费');
      }
    });
  }

  _setItem('kd_lastDeductionDate', dateStr);
  saveDB();
  return count;
}

// ===== 工具 =====
function findAccount(id) { return DB.accounts.find(function(a) { return a.id === id; }); }

function addTransaction(accountId, desc, amount, type) {
  DB.transactions.push({
    id: genId(), accountId: accountId, desc: desc,
    amount: round2(amount), type: type, time: Date.now()
  });
}

// 每日收入（平台收入）只由「手工记收入」和「AI 识图」产生。
// 充值和扣费只写 Transaction，写进 dailyIncome 会把净利润算错。
function addDailyIncome(a, amount, source) {
  return addDailyIncomeWithDate(a, amount, source, todayStr());
}

function addDailyIncomeWithDate(a, amount, source, dateStr, note) {
  var rec = {
    id: genId(),
    accountId: a.id,
    date: dateStr || todayStr(),
    amount: round2(amount),
    room: a.room || '',
    platform: a.platform || '',
    node: a.node || '',
    source: source || '手工',
    note: note || '',
    time: Date.now()
  };
  DB.dailyIncome.push(rec);
  return rec;
}

function emptyState(text, subtext) {
  return '<div class="empty-state">' +
    '<svg viewBox="0 0 24 24" width="60" height="60"><path fill="currentColor" d="M19,3H5C3.9,3 3,3.9 3,5v14c0,1.1 0.9,2 2,2h14c1.1,0 2-0.9 2-2V5C21,3.9 20.1,3 19,3zM19,19H5V5h14V19z"/><path fill="currentColor" d="M11,7h2v6h-2zM11,15h2v2h-2z"/></svg>' +
    '<p>' + text + '</p>' +
    (subtext ? '<p style="font-size:12px;margin-top:4px;">' + subtext + '</p>' : '') +
    '</div>';
}

// ===== 模态框控制 =====
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function confirmExit() {
  showConfirm('确认退出应用？', function() {
    if (window.AndroidApp && AndroidApp.exitApp) {
      AndroidApp.exitApp();
    } else {
      window.close();
    }
  });
}

// 返回键处理
window.addEventListener('appbackpress', function() {
  showToast('再按一次退出', 'warning');
});

// 充值预览
document.addEventListener('input', function(e) {
  if (e.target.id === 'recharge_amount') previewRecharge();
});
