/**
 * 导入回归测试（容器版备份 ↔ APK 格式）
 *
 * 跑法：
 *   1. 把 app/src/main/assets/web/{app.js,index.html,style.css} 和本文件拷到一个临时目录
 *   2. 把容器版导出的全量备份命名为 backup.json 放进同目录
 *   3. 在 index.html 的 <script src="app.js"></script> 后面加一行 <script src="import-regression.js"></script>
 *   4. python3 -m http.server <port> --bind 127.0.0.1 后用 Chrome 无头打开，grep 'CHK|' 取结果
 *
 * 断言 82 项：账号/流水条数、余额与累计充值合计、字段映射、扣费负号与充值正号、
 * 调整差额换算、合并时本机余额不被覆盖、流水 id 重映射无孤儿、重复导入幂等、
 * AI 配置只补空缺、每日收入字段补齐、异常原因映射等。
 */
(function () {
  var out = [], pass = 0, fail = 0;
  function L(s) { out.push(s); }
  function chk(name, cond, detail) {
    if (cond) { pass++; L('PASS|' + name + '|' + (detail || '')); }
    else { fail++; L('FAIL|' + name + '|' + (detail || '')); }
  }
  function eq(name, actual, expected) {
    chk(name, JSON.stringify(actual) === JSON.stringify(expected),
      'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
  }
  function sum(arr, f) { return round2(arr.reduce(function (s, x) { return s + f(x); }, 0)); }
  function accIds(list) { var m = {}; list.forEach(function (a) { m[a.id] = 1; }); return m; }

  var xhr = new XMLHttpRequest();
  xhr.open('GET', 'backup.json', false);
  xhr.send(null);
  var text = xhr.responseText;
  var srv = JSON.parse(text);

  function reset() {
    DB.accounts = []; DB.transactions = []; DB.dailyIncome = []; DB.reminders = [];
    DB.settings = { aiBaseUrl: '', aiApiKey: '', aiModel: '', visionModel: '', aiTimeout: 300 };
    saveDB();
  }
  function byPhone(p) { return DB.accounts.find(function (a) { return a.phone === p; }); }

  // ===== S1 空库合并导入 =====
  reset();
  importBackupJSON(text, 'merge');
  eq('S1 账号数', DB.accounts.length, 11);
  eq('S1 流水数', DB.transactions.length, 52);
  eq('S1 每日收入数', DB.dailyIncome.length, 0);
  eq('S1 余额合计', sum(DB.accounts, function (a) { return a.balance; }), 1374.55);
  eq('S1 累计充值合计', sum(DB.accounts, function (a) { return a.totalRecharge; }), 1280);
  chk('S1 账号 id 前缀 srv_acc_', DB.accounts.every(function (a) { return a.id.indexOf('srv_acc_') === 0; }));

  var a1 = byPhone('15037654306');
  eq('S1 账号1 宽带账号', a1.account, '93764319259');
  eq('S1 账号1 注册码', a1.regcode, '6053087414');
  eq('S1 账号1 注册人', a1.owner, '火车站');
  eq('S1 账号1 使用人', a1.cardUser, '无卡');
  eq('S1 账号1 机房', a1.room, '羊山车库机房');
  eq('S1 账号1 平台', a1.platform, '浮点云');
  eq('S1 账号1 运营商', a1.carrier, '移动');
  eq('S1 账号1 套餐原价', a1.packagePrice, 99);
  eq('S1 账号1 月费', a1.monthlyFee, 99);
  eq('S1 账号1 每日扣费', a1.dailyFee, 3.3);
  eq('S1 账号1 七折', a1.discount, false);
  eq('S1 账号1 备注含安装地址', a1.remark, '安装地址：fb-羊山');

  var a2 = byPhone('13419984294');
  eq('S1 账号2 七折', a2.discount, true);
  eq('S1 账号2 七折锁定', a2.discountLocked, true);
  eq('S1 账号2 月费', a2.monthlyFee, 279.3);
  eq('S1 账号2 每日扣费', a2.dailyFee, 9.31);
  eq('S1 账号2 余额', a2.balance, 25.03);
  eq('S1 账号2 累计充值', a2.totalRecharge, 0);
  eq('S1 账号2 开通时间戳存在', typeof a2.registeredAt === 'number' && a2.registeredAt > 0, true);

  var charge = DB.transactions.filter(function (t) { return t.type === '扣费'; });
  var recharge = DB.transactions.filter(function (t) { return t.type === '充值'; });
  var adjust = DB.transactions.filter(function (t) { return t.type === '调整'; });
  eq('S1 扣费条数', charge.length, 38);
  eq('S1 充值条数', recharge.length, 7);
  eq('S1 调整条数', adjust.length, 7);
  chk('S1 扣费全为负', charge.every(function (t) { return t.amount < 0; }));
  chk('S1 充值全为正', recharge.every(function (t) { return t.amount > 0; }));
  eq('S1 扣费金额合计', sum(charge, function (t) { return t.amount; }), round2(-9.31 * 38));
  eq('S1 充值金额合计', sum(recharge, function (t) { return t.amount; }), 50 + 50 + 60 + 70 + 500 + 500 + 50);
  eq('S1 调整差额合计', sum(adjust, function (t) { return t.amount; }),
    round2(19.68 + 62.27 + 18.74 + 3.68 + 62.89 + 279.99 + 1.08));
  chk('S1 流水 id 前缀 srv_tx_', DB.transactions.every(function (t) { return t.id.indexOf('srv_tx_') === 0; }));
  var ids = accIds(DB.accounts);
  chk('S1 流水无孤儿', DB.transactions.every(function (t) { return !t.accountId || ids[t.accountId]; }));

  // ===== S1d 幂等：再导一次不产生重复 =====
  importBackupJSON(text, 'merge');
  eq('S1d 二次导入 账号数不变', DB.accounts.length, 11);
  eq('S1d 二次导入 流水数不变', DB.transactions.length, 52);

  // ===== S1e AI 配置带入 =====
  var setMap = {};
  srv.tables.app_settings.forEach(function (s) { setMap[s.key] = s.value; });
  eq('S1e AI 地址', DB.settings.aiBaseUrl, setMap.ai_base_url);
  eq('S1e AI 模型', DB.settings.aiModel, setMap.ai_model);
  chk('S1e AI 密钥已带入', !!DB.settings.aiApiKey && DB.settings.aiApiKey === setMap.ai_api_key, 'len=' + (DB.settings.aiApiKey || '').length);
  chk('S1e 不导入 session_secret', DB.settings.session_secret === undefined);

  // ===== S2 覆盖导入 =====
  reset();
  importBackupJSON(text, 'replace');
  closeConfirm(true);
  eq('S2 账号数', DB.accounts.length, 11);
  eq('S2 流水数', DB.transactions.length, 52);
  eq('S2 余额合计', sum(DB.accounts, function (a) { return a.balance; }), 1374.55);
  eq('S2 累计充值合计', sum(DB.accounts, function (a) { return a.totalRecharge; }), 1280);
  chk('S2 账号 id 前缀 srv_acc_', DB.accounts.every(function (a) { return a.id.indexOf('srv_acc_') === 0; }));
  chk('S2 流水 id 前缀 srv_tx_', DB.transactions.every(function (t) { return t.id.indexOf('srv_tx_') === 0; }));
  var ids2 = accIds(DB.accounts);
  chk('S2 流水无孤儿', DB.transactions.every(function (t) { return !t.accountId || ids2[t.accountId]; }));
  eq('S2 扣费合计', sum(DB.transactions.filter(function (t) { return t.type === '扣费'; }), function (t) { return t.amount; }), round2(-9.31 * 38));

  // ===== S3 本机已有同手机号账号（合并不得改余额，流水要改指向本机账号）=====
  reset();
  var local = createAccountObj({ phone: '13462016924', account: '93765306933', room: '本机机房', packagePrice: 399, carrier: '电信' });
  local.id = 'local_acc_1';
  local.balance = 999; local.totalRecharge = 999;
  DB.accounts.push(local);
  importBackupJSON(text, 'merge');
  eq('S3 账号数', DB.accounts.length, 11);
  var lo = DB.accounts.find(function (a) { return a.id === 'local_acc_1'; });
  eq('S3 本机余额保留', lo.balance, 999);
  eq('S3 本机累计充值保留', lo.totalRecharge, 999);
  eq('S3 资料被合并', lo.room, '羊山车库机房');
  var localTxs = DB.transactions.filter(function (t) { return t.accountId === 'local_acc_1'; });
  chk('S3 流水重映射到本机账号', localTxs.length > 0, 'count=' + localTxs.length);
  var ids3 = accIds(DB.accounts);
  chk('S3 无孤儿流水', DB.transactions.every(function (t) { return !t.accountId || ids3[t.accountId]; }));
  eq('S3 流水总数', DB.transactions.length, 52);

  // ===== S4 不覆盖本机已有 AI 配置 =====
  reset();
  DB.settings.aiBaseUrl = 'https://local.example/v1';
  DB.settings.aiModel = 'my-local-model';
  importBackupJSON(text, 'merge');
  eq('S4 本机 AI 地址不被覆盖', DB.settings.aiBaseUrl, 'https://local.example/v1');
  eq('S4 本机模型不被覆盖', DB.settings.aiModel, 'my-local-model');
  chk('S4 空缺密钥被补上', !!DB.settings.aiApiKey);

  // ===== S5 APK 自身备份格式仍可用（回归）=====
  reset();
  DB.accounts.push(createAccountObj({ phone: '13800138001', account: 'KD20240001', room: '城南机房', packagePrice: 399, carrier: '电信' }));
  DB.dailyIncome.push({ id: 'x1', accountId: DB.accounts[0].id, date: '2026-11-01', amount: 12.5, room: '城南机房', platform: '平台A', node: 'N001', source: '手工', note: '', time: Date.now() });
  var apkBackup = JSON.stringify({ accounts: DB.accounts, transactions: DB.transactions, dailyIncome: DB.dailyIncome, reminders: [] });
  importBackupJSON(apkBackup, 'merge');
  eq('S5 APK 格式账号数', DB.accounts.length, 1);
  eq('S5 APK 格式收入数', DB.dailyIncome.length, 1);
  importBackupJSON(text, 'merge');
  eq('S5 混合后账号数', DB.accounts.length, 12);
  eq('S5 混合后收入数', DB.dailyIncome.length, 1);

  // ===== S6 格式嗅探 =====
  eq('S6 嗅探容器版', detectBackupFormat(srv), 'server');
  eq('S6 嗅探 APK 版', detectBackupFormat({ accounts: [] }), 'apk');

  // ===== S7 每日收入（容器版 daily_incomes）=====
  var synth = {
    format: 'kuandai-manager-backup', version: 1, exported_at: '2026-11-15 09:39',
    tables: {
      accounts: [{ id: 1, phone: '13000000001', broadband_account: 'BA001', registrant: '测试', sim_user: '测试卡',
        room: '测试机房', platform: '平台X', node_account: 'N001', monthly_fee: 399, balance: 100,
        provider: '中国电信', discount_enabled: 1, total_recharged: 500, daily_cost: 0,
        category: 'normal', abnormal_reason: '', notes: '', install_address: '测试地址',
        created_at: '2026-11-01 10:00', registered_at: '2026-11-01 10:00' }],
      transactions: [{ id: 1, account_id: 1, kind: 'adjust', amount: 100, period: '2026-11', note: '手动调整余额 0.00 → 100', created_at: '2026-11-02 09:00' }],
      daily_incomes: [
        { id: 1, account_id: 1, day: '2026-11-03', amount: 88.5, source: 'manual', note: '手工记', created_at: '2026-11-03 20:00' },
        { id: 2, account_id: 1, day: '2026-11-04', amount: 66.6, source: 'ai', note: '', created_at: '2026-11-04 20:00' }
      ]
    }
  };
  reset();
  importBackupJSON(JSON.stringify(synth), 'merge');
  eq('S7 每日收入条数', DB.dailyIncome.length, 2);
  var d1 = DB.dailyIncome.find(function (d) { return d.date === '2026-11-03'; });
  eq('S7 收入金额', d1.amount, 88.5);
  eq('S7 收入机房从账号补', d1.room, '测试机房');
  eq('S7 收入平台从账号补', d1.platform, '平台X');
  eq('S7 收入节点从账号补', d1.node, 'N001');
  eq('S7 收入来源 手工', d1.source, '手工');
  eq('S7 收入来源 AI', DB.dailyIncome.find(function (d) { return d.date === '2026-11-04'; }).source, 'AI识图');
  chk('S7 收入 id 前缀 srv_inc_', DB.dailyIncome.every(function (d) { return d.id.indexOf('srv_inc_') === 0; }));
  var adj = DB.transactions.find(function (t) { return t.type === '调整'; });
  eq('S7 调整差额换算', adj.amount, 100);
  eq('S7 运营商映射', DB.accounts[0].carrier, '电信');
  eq('S7 安装地址进备注', DB.accounts[0].remark, '安装地址：测试地址');
  eq('S7 七折月费', DB.accounts[0].monthlyFee, 279.3);
  eq('S7 每日扣费', DB.accounts[0].dailyFee, 9.31);
  var ids7 = accIds(DB.accounts);
  chk('S7 收入无孤儿', DB.dailyIncome.every(function (d) { return !d.accountId || ids7[d.accountId]; }));

  // ===== S8 异常原因映射 =====
  var synth2 = JSON.parse(JSON.stringify(synth));
  synth2.tables.accounts[0].abnormal_reason = 'throttle';
  synth2.tables.accounts[0].abnormal_note = '客户要求';
  reset();
  importBackupJSON(JSON.stringify(synth2), 'merge');
  eq('S8 异常原因', DB.accounts[0].abnormal.reason, '限速');
  eq('S8 异常备注', DB.accounts[0].abnormal.note, '客户要求');

  // ===== S9 容器版备份无账号时报错 =====
  var emptySrv = { format: 'kuandai-manager-backup', version: 1, tables: { accounts: [], transactions: [], daily_incomes: [] } };
  var errMsg = '';
  try { importBackupJSON(JSON.stringify(emptySrv), 'merge'); } catch (e) { errMsg = e.message; }
  eq('S9 空容器版备份报错', errMsg, '容器版备份里没有账号数据');

  var pre = document.createElement('pre');
  pre.id = 'CHECK';
  pre.textContent = 'CHK|' + out.join('\nCHK|') + '\nSUMMARY|pass=' + pass + ' fail=' + fail;
  document.body.appendChild(pre);
})();
