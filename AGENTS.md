# AGENTS.md — 宽带台账管理系统（Android APK）

> 本文件供其他 AI 智能体阅读，帮助快速理解项目全貌、技术决策和构建流程。

---

## 项目概述

**名称**：宽带账号台账管理系统 — Android 移动版
**版本**：v1.4.1
**来源**：基于 GitHub 项目 [zozlio/kuandai-manager](https://github.com/zozlio/kuandai-manager) 的功能需求，将其从 FastAPI+SQLite Web 应用改造为 Android 原生 WebView 包装的离线 APK。
**核心定位**：给宽带代办点/运维人员使用的自托管离线台账工具，数据全部存储在手机本地，不依赖任何后端服务器。

---

## 技术架构

### 架构方案：WebView + 本地 Web 应用

```
Android 原生外壳 (Java)
  └── WebView 组件
       └── 加载 assets/web/ 下的 HTML/CSS/JS 单页应用
            └── 数据用 localStorage 持久化（WebView 开启了 DomStorage）
```

**为什么选这个方案**：
- 兼容 Android 4.0+ (API 14)，老旧设备也能跑
- 复用原项目的 Web UI 和业务逻辑，避免重写
- 离线运行，不需要服务器
- APK 体积小（~5MB）

### 技术栈版本（全部 2026 年最新稳定版）

| 组件 | 版本 | 说明 |
|------|------|------|
| Android Gradle Plugin | 9.5.0 | 2026年10月发布 |
| Gradle | 9.6.0 | |
| compileSdk / targetSdk | 36 | Android 16 (Baklava) |
| minSdk | 23 | AppCompat 1.8.0 等最新 AndroidX 库要求 ≥ 23（Android 6.0+） |
| JDK | 17 | |
| Build Tools | 36.0.0 | |
| AndroidX AppCompat | 1.8.0 | |
| Material Components | 1.12.0 | Material3 主题 |
| AndroidX WebKit | 1.12.1 | |
| AndroidX Activity | 1.10.1 | registerForActivityResult |
| AndroidX Core | 1.16.0 | WindowCompat, edge-to-edge |

---

## 目录结构

```
宽带台账手机版/
├── AGENTS.md                 ← 本文件（供智能体阅读）
├── BUILD.md                  ← 人类阅读的构建指南
├── .github/
│   └── workflows/
│       └── build-apk.yml      ← CI：push 自动构建，workflow_dispatch 可发 Release
├── build.gradle              ← 根 Gradle 配置（声明 AGP 9.5.0）
├── settings.gradle           ← 项目设置 + 仓库声明（google + mavenCentral）
├── gradle.properties         ← Gradle 配置（AndroidX、缓存、并行）
├── build_config.json         ← 构建配置摘要（JSON 格式）
├── gradle/
│   └── wrapper/
│       ├── gradle-wrapper.jar         ← CI 必需（./gradlew 靠它启动）
│       └── gradle-wrapper.properties  ← Gradle 9.6.0 下载地址
├── app/
│   ├── build.gradle          ← 应用模块配置（compileSdk 36, minSdk 23, 依赖声明）
│   ├── proguard-rules.pro    ← ProGuard 混淆规则（保留 JS 桥接接口）
│   └── src/main/
│       ├── AndroidManifest.xml     ← 清单（INTERNET 权限、SplashActivity/MainActivity）
│       ├── java/com/kuandai/manager/
│       │   ├── SplashActivity.java ← 启动页（1.2秒后跳转 MainActivity）
│       │   └── MainActivity.java   ← WebView 容器 + JS 桥接 + 文件选择器
│       ├── res/
│       │   ├── layout/
│       │   │   ├── activity_main.xml    ← WebView + 进度条 + 启动遮罩
│       │   │   └── activity_splash.xml  ← 启动页布局
│       │   ├── values/
│       │   │   ├── strings.xml   ← 应用名称
│       │   │   └── styles.xml    ← Material3 浅色主题（纸白基底）
│       │   └── drawable/
│       │       ├── ic_logo.xml         ← 矢量图标
│       │       └── progress_bar.xml    ← 渐变进度条
│       └── assets/web/
│           ├── index.html    ← 单页应用入口（9 大功能页面 + 模态框）
│           ├── style.css     ← 「液面」视觉系统（纸白 + 磨砂玻璃 + 光纤青）
│           └── app.js        ← 全部业务逻辑（~2500 行，含容器版备份适配层）
├── tools/
│   └── import-regression.js  ← 导入回归测试（82 项断言，跑法见文件头注释）
└── .workbuddy-ai/
    └── memory/
        └── 2026-11-14.md     ← 开发工作日志
```

---

## Java 层说明

### SplashActivity.java
- 启动页，显示 Logo 和应用名 1.2 秒后跳转到 MainActivity
- 使用 Handler.postDelayed 实现延迟

### MainActivity.java
- **WebView 容器**：加载 `file:///android_asset/web/index.html`
- **WebSettings**：开启 JavaScript、DomStorage、Database、文件访问、文件域跨域（AllowFileAccessFromFileURLs）
- **JS 桥接**：通过 `webView.addJavascriptInterface(new AppBridge(), "AndroidApp")` 暴露给 JS
  - `getAppVersion()` → 返回版本号
  - `getAndroidVersion()` → 返回 Android 系统版本
  - `getSdkInt()` → 返回 SDK 版本号
  - `showToast(msg)` → 显示原生 Toast
  - `vibrate(ms)` → 调用原生震动（API 26+ 用 VibrationEffect，旧版用 vibrate(long)）
  - `exitApp()` → 关闭 Activity
- **WebViewClient**：页面加载进度条、Splash 淡出动画
- **WebChromeClient**：JS alert/confirm 转原生对话框、文件选择器（onShowFileChooser）
- **返回键**：先 goBack()，不能后退则双击退出（2秒内再按才退出）
- **生命周期**：onPause/onResume 通知 JS、onDestroy 销毁 WebView
- **Edge-to-edge**：WindowCompat + WindowInsetsControllerCompat 适配 Android 15+

### AndroidManifest.xml
- 权限：INTERNET、ACCESS_NETWORK_STATE、VIBRATE
- `usesCleartextTraffic=true`：允许 HTTP（AI 接口可能不走 HTTPS）
- `windowSoftInputMode=adjustResize`：键盘弹出时调整布局
- `configChanges`：旋转屏幕时不重建 Activity

---

## 前端 Web 应用说明 (app.js)

### 视觉系统「液面 / Liquid Ledger」

v1.2.0 视觉重做后的设计规范。改 CSS 前先读这一节，避免把配色改回旧主题。

**设计思路**：这个业务本质是「光纤线路」的账，所以信号色用光纤青而不是苹果蓝；基底是冷调纸白 + 机房窗光，材质是磨砂玻璃。

| 角色 | 变量 | 色值 | 含义 |
|------|------|------|------|
| 基底 | `--paper` | `#EDEFEE` | 冷调纸白 |
| 主文字 | `--ink` | `#121517` | 墨黑 |
| 次级文字 | `--ink-2` | `#575D61` | —— |
| 弱文字 | `--ink-3` | `#8B9195` | —— |
| 信号色 | `--fiber` | `#0D6A6D` | 收入 / 正常 |
| 暖告警 | `--amber` | `#97650F` | 扣费 / 余额偏少 |
| 危险 | `--rust` | `#A6482F` | 欠费 / 异常 |

**材质**：基底由 3 层 `radial-gradient` 径向光场 + 2 团 `blur(56px)` 游移色雾构成（`body::before/::after`），卡片用半透明 `backdrop-filter` 磨砂玻璃 + `inset 0 1px 0 rgba(255,255,255,.85)` 高光边。

**排版**：金额与编码统一 `font-variant-numeric: tabular-nums`，小数点钉在同一列。主 KPI 字号 29px（页面头条），其余 24px。

**签名元素**：`.section-title .dot` 是「机房指示灯」——光纤青实心点 + 外圈柔光（`box-shadow: 0 0 0 3px rgba(13,106,109,.14)`），标题后拖一条渐隐发丝线。

**结构件**：
- 分段控件 `.tab-bar` — 灰底槽 + 白色滑块（`.tab-item.active`）
- 状态标签 `.account-status` — 999px 胶囊 + 内描边
- 按钮 `.btn-primary/.btn-secondary/.btn-danger` — 999px 全圆角，主按钮为墨黑实心
- 顶栏右侧 `+` 是唯一的「新增账号」入口（**已删除原来的右下角浮动按钮**，它会压住卡片里的「充值」按钮）

**canvas 图表**：JS 里的 `CHART` 对象复制了 CSS 色值（canvas 拿不到 CSS 变量），改配色时**两边都要改**。画布用 `setupCanvas()` 按 CSS 像素绘制再乘 DPR，**不要**用旧写法 `canvas.width = offsetWidth * 2`（会让文字被拉伸发虚）。

**原生层同步**：`styles.xml` 用 `Theme.Material3.Light.NoActionBar`，状态栏/导航栏透明 + 深色图标（`setAppearanceLightStatusBars(true)`），启动页与 logo 也换成纸白/墨黑。

### 数据存储

```
存储适配层：
  启动时检测 localStorage 是否可用 →
    可用（Android WebView）→ 用 localStorage（持久化）
    不可用（浏览器 file:// 预览）→ 降级到内存对象 _memStore（不持久化但不会崩溃）
```

存储的数据键：
- `kd_accounts` — 账号数组
- `kd_transactions` — 收支流水数组
- `kd_dailyIncome` — 每日收入数组
- `kd_reminders` — 催缴提醒数组（**v1.2.1 起催缴功能已移除，不再写入新提醒**，键保留以便旧备份导入不报错）
- `kd_settings` — AI 配置等设置
- `kd_lastDeductionDate` — 上次扣费日期（防止重复扣费）

### 账号数据结构

```javascript
{
  id: "a_时间戳_随机数",
  phone: "13800138000",        // 手机号（唯一）
  account: "KD20240001",       // 宽带账号（唯一，v1.2.0 可编辑）
  regcode: "RC001",            // 注册码
  owner: "张三",                // 注册人
  cardUser: "张三",             // 手机卡使用人
  room: "城南机房",             // 机房
  platform: "平台A",            // 节点平台
  node: "N001",                // 节点号（唯一，AI 识图主键）
  packagePrice: 399,           // 套餐原价
  monthlyFee: 399,             // 月费（七折后 = 279.30）
  dailyFee: 13.30,             // 每日扣费（月费 / 当月天数）
  discount: false,             // 是否七折
  discountLocked: false,       // 七折是否已锁定（锁定后不可关闭）
  balance: 500,                // 当前余额
  totalRecharge: 500,          // 累计充值（只增不减，开号送的 500 也算）
  carrier: "电信",              // 运营商
  remark: "",                  // 备注
  abnormal: null,              // 异常信息 { reason: "限速", note: "备注" }
  createdAt: 1234567890,       // 创建时间戳
  registeredAt: 1234567890     // 注册时间戳
}
```

### 8 大功能页面

| 页面 | 路由 | 功能 |
|------|------|------|
| 收入看板 | `dashboard` | 6 个 KPI（今日平台收入/今日每日扣费/今日净利润/累计收入/剩余余额/需催缴）+ 收入趋势图(7/14/30天) + 状态饼图 + 平面条形图；全部/正常/异常标签页切换，数字口径跟着走 |
| 台账列表 | `accounts` | 搜索 + 全部/正常/异常筛选；每行显示手机号(可复制)、宽带账号(可复制)、节点号(可复制)、余额状态标签、充值按钮 |
| 机房与收入 | `rooms` | 机房 → 节点平台 → 账号三级分组树；顶部日期切换（默认今天）；KPI：收入合计/当日扣费/净利润/机房数；每行显示当日收入 + 最近 7 天迷你折线，可直接「记收入」 |
| 异常账号 | `abnormal` | 列出所有异常账号；可一键恢复正常；异常原因 6 选 1（机房/电费/管理线/限速/注销/欠费）+ 备注 |
| AI 识图 | `vision` | 上传收益截图 → AI 以节点号识别 → 可编辑确认表（每行可手动选账号/改日期）→ 确认后写入台账；429/503 最多重试 2 次（退避 2s→8s） |
| 收支流水 | `transactions` | 全部充值/扣费/调整记录；总收入/总扣费汇总 |
| 数据导入导出 | `export` | **导出**：台账 CSV / 每日收入 CSV / 收支流水 CSV（均带 BOM）/ 全量 JSON 备份（含退役的 account_groups 表）。**导入**：全量 JSON 合并、全量 JSON 覆盖（二次确认）、台账 CSV 导入，**自动识别 Docker 容器版（FastAPI）备份**；详见下节 |
| 设置 | `settings` | AI 接口配置（密钥只显示尾 4 字符）/ 视觉模型配置 / 定时扣费时间 / 测试连接 / 恢复环境变量 / 服务商示例 |

账号详情（`showAccountDetail`）的操作：充值 / 编辑 / 记收入 / 手动记一笔（充值、扣费、调整三态）/ 开七折 / 标异常 / 恢复正常 / 删除账号，并列出该账号的每日收入（可删）与收支流水。


### 核心业务逻辑

#### 按天扣费算法
```
每日扣款额 = 月费 / 当月天数
示例：11月30天 → 399 / 30 ≈ ¥13.30/天
七折后：279.30 / 30 = ¥9.31/天
```
- 每天凌晨自动执行（检查 `kd_lastDeductionDate` 防重复）
- 余额不足时不扣款，等充值后继续扣（v1.2.1 起不再生成催缴提醒）
- 月末补齐余数（整月加起来正好等于一个月费）
- 首页可手动触发「立即巡检」

#### 七折开关
- 月费 = 套餐原价 × 0.7
- 打开后**永久锁定**，前端灰色不可点，后端忽略关闭请求
- 原因：套餐价反复改会让历史流水对不上账

#### 开号送 500
- 新建账号自动带 ¥500 初始余额
- 记一笔「开号初始金额」流水
- 500 也计入累计充值

#### 充值流程
- 列表点「充值」→ 弹窗输入金额（+100/+200/+500 快捷按钮）→ 实时显示充值后余额 → 确认 → 余额和累计充值同时更新

#### 数据导入（v1.2.1 新增）
入口：侧边栏「数据导入导出」（`export` 页），底层是 `index.html` 里隐藏的 `#importFile`（`accept="*/*"`，走 WebView 的 `onShowFileChooser`）。

| 方式 | 函数 | 语义 |
|------|------|------|
| 全量 JSON · 合并 | `importBackupJSON(text,'merge')` | 按手机号（其次宽带账号）匹配：已有账号只更新资料字段（机房/平台/节点号/注册人/运营商/备注/套餐价），**余额、累计充值、异常状态保持本机不变**；新账号连余额一起插入；流水与每日收入按 `txKey`/`incomeKey` 去重后补充 |
| 全量 JSON · 覆盖 | `importBackupJSON(text,'replace')` | `showConfirm` 二次确认后，用备份里的 accounts/transactions/dailyIncome 整体替换本机数据 |
| 台账 CSV | `importAccountsCSV(text)` | 解析表头（`csvHeaderMap` 支持别名，但必须含「手机号」或「宽带账号」）；已存在则更新资料与余额，否则新建并记一笔「导入初始余额」流水 |

CSV 解析器 `parseCSV` 自实现，支持引号包裹、字段内逗号、`""` 转义、CRLF，并会剥掉 UTF-8 BOM。
导入结果写入 `lastImportResult`，回到导出页顶部显示「上次导入结果」卡片。文件大小上限 8MB。

#### 容器版（Docker/FastAPI）备份适配（v1.4.0 新增）
原项目 [zozlio/kuandai-manager](https://github.com/zozlio/kuandai-manager) 的 **Docker 容器版**（FastAPI + SQLite）导出的备份与 APK 格式不兼容，v1.4.0 起**自动嗅探格式**，同一套导入入口即可吃下两种备份，不用改界面。

容器版备份长这样：
```json
{ "format":"kuandai-manager-backup", "version":1, "exported_at":"2026-11-15 09:39",
  "tables": { "accounts":[...], "transactions":[...], "daily_incomes":[...],
              "reminders":[...], "users":[...], "account_groups":[...], "app_settings":[...] } }
```
字段全是 snake_case、用整数外键关联账号；APK 是扁平结构。适配层在 `app.js`：

| 函数 | 作用 |
|------|------|
| `detectBackupFormat(data)` | 有 `data.tables` 或 `format==='kuandai-manager-backup'` → `'server'`，否则 `'apk'` |
| `adaptServerBackup(data)` | 翻译成 `{accounts, transactions, dailyIncome, settings, meta}`，再交给既有导入流程 |

**字段映射**（容器版 → APK）：

| 容器版 | APK | 说明 |
|--------|-----|------|
| `broadband_account` | `account` | 宽带账号 |
| `registration_code` | `regcode` | |
| `registrant` / `sim_user` | `owner` / `cardUser` | 注册人 / 卡使用人 |
| `node_account` | `node` | 节点号 |
| `notes` | `remark` | 备注 |
| `install_address` | 备注追加「安装地址：xxx」 | APK 已退役该字段，塞进唯一的自由文本字段别丢数据 |
| `provider` | `carrier` | `CARRIER_MAP`：中国电信→电信 … |
| `abnormal_reason` + `abnormal_note` | `abnormal{reason,note}` | `ABNORMAL_REASON_MAP`：machine_room→机房、power→当前电费、manage_line→管理线、throttle→限速、cancel→注销、arrears→欠费 |
| `monthly_fee` | `packagePrice` | 容器版的 monthly_fee 是**套餐原价** |
| `discount_enabled` | `discount` + `discountLocked` | 0/1 → 布尔；容器版七折同样不可关闭 |
| `daily_cost` | `dailyFee` | 为 0 表示按月费 ÷ 当月天数分摊 |
| `total_recharged` / `balance` | `totalRecharge` / `balance` | |
| `transaction.account_id` | `tx.accountId` | 整数外键 → APK 账号 id（`idMap` 重映射） |
| `daily_incomes.day` | `income.date` | 容器版用 `day` 不是 `date` |
| `app_settings` | `DB.settings` | 只接 `ai_base_url`/`ai_api_key`/`ai_model`/`vision_model`，**不接 `session_secret`**；且只补本机空缺，不覆盖已有配置 |

**关键语义坑（已对照容器版 `app/models.py`、`app/services.py` 核实）**：
- 容器版 `kind=adjust` 的 `amount` 是**调整后的余额**（`balance = amount`），APK 的「调整」流水记的是**差额**。适配层按容器版规则（充值 +、扣费 −、调整设为目标值）按时间回放每个账号的流水，把目标余额换算成差额。
- 容器版 `kind=charge` 是**每日套餐扣费**（不是平台收入），APK 约定扣费为负、充值为正，适配层按此换符号。
- 容器版**不记平台收入**（`daily_incomes` 通常为空），所以导入后「今日平台收入/净利润」是 0 是**如实反映**，不能用 `charge` 伪造收入；收入需手工记或 AI 识图补录。
- `users` 表（含 `password_hash`）、`reminders` 表**不导入**（APK 无登录、催缴功能已下线）。

**id 规则**：账号 `srv_acc_<容器版id>`、流水 `srv_tx_<id>`、收入 `srv_inc_<id>`。既不和 APK 自己 `genId()` 生成的 id 撞车，又能让重复导入靠 `txKey`/`incomeKey`（优先用 `t.id`）幂等去重。

**合并时的账号 id 重映射**：合并模式下若本机已存在同手机号账号，保留**本机**账号 id，导入的流水/收入要改指向它（`idRemap`），否则会变成孤儿记录。本机余额、累计充值、异常状态保持不变。

#### AI 识图流程
1. 上传截图 → 调用视觉模型（OpenAI 兼容接口）
2. AI 以**节点号**为主键识别 → 返回 JSON 数组 [{node, amount, date}]
3. 识别结果进入**可编辑确认表**：每行可手动选账号（多候选时标记）、可改日期
4. 人工确认后才写入台账（余额 + 累计充值 + 流水 + 每日收入）
5. 无日期默认「昨天」

### v1.2.0 退役功能（已从界面移除，数据结构保留）

| 功能 | 处理 |
|------|------|
| 分组 (account_groups) | UI/路由/表单移除，表和字段保留，全量备份仍导出 |
| 安装地址 (install_address) | 界面/搜索/导出移除，字段保留 |
| 手动发起催缴 | 详情页按钮/路由/函数移除，自动扣费和自动催缴保留 |

---

## 构建方式

### 环境要求
- JDK 17
- Android SDK (API 36 + Build Tools 36.0.0)
- Gradle 9.6.0（通过 wrapper 自动下载）

### 构建命令
```bash
# 1. 生成 Gradle Wrapper（如果没有 gradlew 文件）
gradle wrapper --gradle-version 9.6.0

# 2. 构建 Debug APK
chmod +x gradlew          # 若报 Permission denied 就补这一行
./gradlew assembleDebug

# 3. APK 输出位置
app/build/outputs/apk/debug/宽带台账管理_v{versionName}_{日期}_b{versionCode}.apk
```

### CI（GitHub Actions）
`.github/workflows/build-apk.yml`：push 到 `main` 自动构建；`workflow_dispatch` 带 `release_tag` 输入时额外打 tag 并发 GitHub Release。

三个已知坑（都已绕过，勿改回）：
1. **不要用 `android-actions/setup-android@v3`**：它默认安装已被下架的 `tools` 包，sdkmanager 非零退出 → 整步失败。改成直接用 runner 预装的 cmdline-tools（`$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager`）。
2. **不要对预装的 sdkmanager 执行 `chmod`**：它是 root 属主，`chmod` 会报 `Operation not permitted`；在 `set -e` 下直接中断脚本。
3. **`gradlew` 没有可执行位**：通过 Contents API 写入的文件 mode 固定为 `100644`，`./gradlew` 会 `Permission denied`。CI 里先 `chmod +x gradlew`；工作流还有一步会把可执行位写回仓库，别人 clone 后即可直接 `./gradlew`。

### 签名构建 Release APK
```bash
keytool -genkey -v -keystore kuandai.keystore -alias kuandai -keyalg RSA -keysize 2048 -validity 10000
./gradlew assembleRelease
# APK: app/build/outputs/apk/release/宽带台账管理_v{versionName}_{日期}_b{versionCode}.apk
```

### macOS 环境安装
```bash
# JDK 17
brew install openjdk@17
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"

# Android SDK
brew install --cask android-commandlinetools
export ANDROID_HOME=$HOME/Library/Android/sdk
sdkmanager --licenses
sdkmanager "platforms;android-36" "build-tools;36.0.0"
```

---

## 注意事项

1. **localStorage 兼容**：WebView 必须开启 `settings.setDomStorageEnabled(true)`，否则数据无法持久化
2. **文件域跨域**：`setAllowFileAccessFromFileURLs(true)` + `setAllowUniversalAccessFromFileURLs(true)` 让 WebView 可以从 `file://` 加载本地资源
3. **JS 桥接安全**：`@JavascriptInterface` 注解的方法会被暴露给网页，仅暴露必要方法
4. **AI 接口**：使用 OpenAI 兼容格式（`/chat/completions`），支持 DeepSeek/通义千问/MiniMax/OpenAI/Ollama
5. **视觉模型必须单独配置**：识图需要支持图像输入的模型（如 gpt-4o、qwen-vl-plus），纯文本模型不行
6. **AGP 9.x 特殊要求**：
   - `settings.gradle` 必须声明 `dependencyResolutionManagement`
   - `AndroidManifest.xml` 不能有 `package` 属性（用 `namespace` 替代）
   - 内置 Kotlin 支持，纯 Java 项目也兼容
   - 主题需用 Material3（`Theme.Material3.*`）
7. **edge-to-edge 与安全区域**：Android 15+ (API 35+) 默认全屏，`WindowCompat.setDecorFitsSystemWindows(false)` 让 WebView 铺到状态栏下。**Android WebView 不提供 `env(safe-area-inset-*)`，取值恒为 0**，所以 `MainActivity` 用 `ViewCompat.setOnApplyWindowInsetsListener` 取真实 inset，按 density 换算成 CSS px 后通过 `evaluateJavascript` 写进三个变量：
   - `--inset-top` = `systemBars().top`（状态栏，给 `.topbar`/`.sidebar`/`.toast` 用）
   - `--inset-nav` = `systemBars().bottom`（手势条，给 `.bottom-nav` 用，键盘弹出时不变）
   - `--inset-bottom` = `max(bars.bottom, ime.bottom)`（给 `.app-container` 底部留白和 `.modal-content` 抬起用，键盘弹出时等于键盘高度）
   
   `style.css` 末尾的「安全区域」区块统一消费这三个变量，不要改回 `env()`。
8. **每日收入口径**：`kd_dailyIncome` 只由「手工记收入」和「AI 识图」写入；**充值、扣费、手动调整只写 `kd_transactions`**，不要再往 dailyIncome 里塞，否则「今日平台收入」和净利润会算错。
9. **版本号单一真源**：只在 `app/build.gradle` 里写 `versionName` / `versionCode`，其余地方一律不许硬编码：
   - 原生层用 `BuildConfig.VERSION_NAME` / `BuildConfig.VERSION_CODE`（需 `buildFeatures { buildConfig true }`）
   - 构建日期由 `generateBuildInfo` 任务生成 `BuildInfo.java`（`BUILD_DATE` / `BUILD_DATE_COMPACT`）
   - 网页层通过 `AndroidApp.getAppVersion()` / `getBuildCode()` / `getBuildDate()` / `getFullVersion()` 读取，浏览器预览时降级到 `app.js` 的 `FALLBACK_VERSION`
   - 界面统一显示 `v1.4.1 · 2026.11.15 · Build 10` 格式：语义版本 + 构建日期 + 构建号
   - 覆盖安装必须递增 `versionCode`（当前 10）
10. **构建日期必须用 `providers.exec`**：`providers.provider { new Date() }` 会被 configuration cache 固化——命中缓存时配置阶段不重跑，日期会停在旧值。`providers.exec { commandLine 'sh','-c','date +%Y.%m.%d' }` 是执行期命令，每次构建都重新执行。
11. **生成源目录别用 `sourceSets.java.srcDir`**：指向任务输出目录会触发 Gradle 隐式依赖检查。正确做法是 `variant.sources.java.addGeneratedSourceDirectory(task) { it.outputDirectory }`，且任务类型必须自带 `outputDirectory` 属性（`DefaultTask` 没有，要自定义任务类）。
12. **视觉一致性**：网页层的配色、canvas 图表色值、原生主题/启动页/图标必须三处同步。改主色时 `style.css` 的 `:root`、`app.js` 的 `CHART` 对象、`styles.xml` 一起改。
13. **图标不要用特殊字符**：像 `⎘` 这类字符在部分安卓设备缺字形会渲染成豆腐块，图标一律用内联 SVG。
14. **顶栏 `+` 是唯一新增入口**：不要再加右下角浮动按钮，会遮挡卡片里的「充值」按钮。
15. **容器版备份导入的语义**（v1.4.0）：容器版 `charge` 是**每日套餐扣费**不是平台收入，导入时按负数记进 `kd_transactions`，**绝对不要**塞进 `kd_dailyIncome`，否则「今日平台收入 / 净利润」会虚高并与流水重复计算；容器版 `adjust` 的 `amount` 是调整后的**目标余额**，适配层已按容器版规则回放换算成**差额**再写入。容器版不记平台收入，导入后收入指标为 0 属**如实反映**，需手工记或 AI 识图补录。
16. **启动图标（v1.4.1 重做）**：沿用「液面」视觉系统的 **D1 · 数据仪表** —— 纸白底 + 淡网格 + 液面渐变 + 收入曲线 + 峰值发光节点，色值仍是纸白 `#EDEFEE` / 墨黑 `#121517` / 光纤青 `#0D6A6D`。改图标要同时动五处：`drawable/ic_launcher_background.xml`（纸白渐变）、`drawable/ic_launcher_foreground.xml`（前景）、`drawable/ic_launcher_monochrome.xml`（Android 13 主题图标单色剪影）、`drawable/ic_logo.xml`（启动页/加载遮罩标记，无背景）、`mipmap-*dpi` 的 `ic_launcher.png` + `ic_launcher_round.png`（旧系统兜底位图）。自适应图标规范：108dp 画布、中心 72dp 安全区（系统遮罩会裁掉外圈 18dp）。

---

## 与原项目的功能对照

| 原项目功能 | 本 APK 状态 | 说明 |
|-----------|------------|------|
| 登录注册 | ✗ 未实现 | APK 是单用户离线工具，不需要登录 |
| 台账 CRUD | ✓ | 完整实现 |
| 开号送 500 | ✓ | |
| 充值 + 快捷按钮 | ✓ | +100/+200/+500 |
| 七折开关（锁定） | ✓ | |
| 按天扣费 + 月末补齐 | ✓ | |
| 催缴提醒 + 话术 | ✗ 已移除 | v1.2.1 按用户要求下线，`kd_reminders` 键保留兼容导入 |
| 正常/异常分类 | ✓ | 6 种原因 |
| 机房/平台/节点号 | ✓ | |
| 机房与收入页（/rooms） | ✓ | 三级分组 + 当日收入 + 7 天折线 |
| 记收入（upsert，同日覆盖） | ✓ | 不改余额 |
| 手动记一笔流水 | ✓ | 充值/扣费/调整三态 |
| 删除账号 | ✓ | 连带流水，每日收入保留并断开关联 |
| 标记催缴已处理 | ✗ 已移除 | 随催缴提醒一起下线 |
| 收入看板 | ✓ | 标签页切换 + 7/14/30天图表 |
| AI 问答 | ✗ 已移除 | v1.2.1 按用户要求下线；AI 接口配置保留给识图用 |
| AI 识图记账 | ✓ | 节点号识别 + 人工确认 |
| 数据导出 | ✓ | CSV + JSON |
| 数据导入（新增） | ✓ | 全量 JSON 合并/覆盖 + 台账 CSV + **Docker 容器版备份（v1.4.0 自动嗅探）** |
| 一键复制 | ✓ | 手机号/宽带账号/节点号 |
| 运营商下拉 | ✓ | 电信/联通/移动/广电 |
| 分组（退役） | ✗ 已移除 | |
| 安装地址（退役） | ✗ 已移除 | |
| 手动催缴（退役） | ✗ 已移除 | 自动催缴也随提醒功能一并移除 |
| 用户管理 | ✗ 未实现 | 单用户离线 |
| Docker 部署 | ✗ 不适用 | APK 独立运行 |
