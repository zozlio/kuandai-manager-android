# 宽带台账管理系统 - Android APK

> v1.4.1 | 兼容 Android 6.0+ (API 23+)

## 技术栈版本（全部最新稳定版）

| 组件 | 版本 |
|------|------|
| Android Gradle Plugin | **9.5.0** |
| Gradle | **9.6.0** |
| compileSdk / targetSdk | **36** (Android 16 Baklava) |
| Build Tools | **36.0.0** |
| JDK | **17** |
| AndroidX AppCompat | **1.8.0** |
| Material Components | **1.12.0** |
| AndroidX WebKit | **1.12.1** |
| AndroidX Activity | **1.10.1** |
| AndroidX Core | **1.16.0** |
| minSdk | **23** (Android 6.0) |

> minSdk 之所以从 14 提到 23：AppCompat 1.8.0 / appcompat-resources 的清单声明要求 minSdk ≥ 23，Material 1.12.0 要求 ≥ 19。降到 23 是同时满足全部依赖的最小值，避免 `tools:overrideLibrary` 带来的运行时风险。

## 项目结构

```
宽带台账手机版/
├── build.gradle              # 根 Gradle 配置 (AGP 9.5.0)
├── settings.gradle           # 项目设置 + 仓库声明
├── gradle.properties         # Gradle 配置
├── gradle/wrapper/
│   └── gradle-wrapper.properties  # Gradle 9.6.0
├── build_config.json         # 构建配置说明
├── app/
│   ├── build.gradle          # compileSdk 36, targetSdk 36, minSdk 23
│   ├── proguard-rules.pro    # 代码混淆规则
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/kuandai/manager/
│       │   ├── SplashActivity.java   # 启动页
│       │   └── MainActivity.java     # WebView 主容器 (edge-to-edge)
│       ├── res/
│       │   ├── layout/               # 布局文件
│       │   ├── values/               # 字符串、Material3 主题
│       │   ├── drawable/             # 图标、进度条、自适应图标前景/背景
│       │   └── mipmap-*dpi/          # 启动图标 PNG (48~192) + round 版
│       │       └── mipmap-anydpi-v26/ # Android 8+ 自适应图标 XML
│       └── assets/web/
│           ├── index.html            # Web 应用入口
│           ├── style.css             # 深色霓虹 UI
│           └── app.js                # 业务逻辑
```

## 本地构建步骤

### 1. 安装 JDK 17

```bash
# macOS (Homebrew)
brew install openjdk@17
sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk
echo 'export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"' >> ~/.zshrc
source ~/.zshrc
```

### 2. 安装 Android SDK (API 36)

```bash
brew install --cask android-commandlinetools
export ANDROID_HOME=$HOME/Library/Android/sdk
sdkmanager --licenses
sdkmanager "platforms;android-36" "build-tools;36.0.0"
```

### 3. 生成 Gradle Wrapper

```bash
cd "宽带台账手机版"
# 方式一：如果有全局 gradle
gradle wrapper --gradle-version 9.6.0

# 方式二：手动下载 gradle 9.6.0
curl -L https://services.gradle.org/distributions/gradle-9.6.0-bin.zip -o /tmp/gradle.zip
unzip /tmp/gradle.zip -d /tmp/
/tmp/gradle-9.6.0/bin/gradle wrapper --gradle-version 9.6.0
```

### 4. 构建 Debug APK

```bash
chmod +x gradlew          # 若报 Permission denied 就补这一行
./gradlew assembleDebug
```

### 5. 构建 Release APK（签名）

```bash
# 生成签名密钥
keytool -genkey -v -keystore kuandai-release.keystore -alias kuandai -keyalg RSA -keysize 2048 -validity 10000

# 构建
./gradlew assembleRelease
```

### 6. APK 输出位置

文件名带版本与日期，由 `app/build.gradle` 的 `outputFileName` 控制：

```
宽带台账管理_v1.4.1_20261115_b10.apk
```

- Debug: `app/build/outputs/apk/debug/宽带台账管理_v{versionName}_{日期}_b{versionCode}.apk`
- Release: `app/build/outputs/apk/release/宽带台账管理_v{versionName}_{日期}_b{versionCode}.apk`

版本名/构建号/日期的单一真源是 `app/build.gradle` 顶部的 `APP_VERSION_NAME` / `APP_VERSION_CODE`，
构建日期由 `generateBuildInfo` 任务在执行期调 `date` 命令生成，写入 `BuildInfo.java`。
界面统一显示 `v1.4.1 · 2026.11.15 · Build 10`。

## 本机实际构建环境（已验证）

本机不需要装 Homebrew 版 JDK/SDK，已有现成环境，直接指定路径即可：

| 依赖 | 实际路径 |
|------|----------|
| JDK 17 | `/Users/langyan/jdk/zulu17.54.21-ca-jdk17.0.13-macosx_aarch64/zulu-17.jdk/Contents/Home` (Zulu 17.0.13) |
| Android SDK | `/Users/langyan/android-sdk` (platforms/android-36, build-tools/36.0.0, 许可已接受) |
| Gradle | 通过 wrapper 自动下载到 `~/.gradle/wrapper/dists/gradle-9.6.0-bin` |

`local.properties` 已配置（不要提交到版本库）：

```properties
sdk.dir=/Users/langyan/android-sdk
```

一行命令构建：

```bash
cd "宽带台账手机版"
JAVA_HOME="/Users/langyan/jdk/zulu17.54.21-ca-jdk17.0.13-macosx_aarch64/zulu-17.jdk/Contents/Home" \
  ./gradlew assembleDebug
```

验证 APK：

```bash
export JAVA_HOME="/Users/langyan/jdk/zulu17.54.21-ca-jdk17.0.13-macosx_aarch64/zulu-17.jdk/Contents/Home"
SDK="$HOME/android-sdk"
$SDK/build-tools/36.0.0/aapt2 dump badging app/build/outputs/apk/debug/app-debug.apk | head
$SDK/build-tools/36.0.0/apksigner verify --verbose app/build/outputs/apk/debug/app-debug.apk
```

安装到手机（需开启 USB 调试）：

```bash
$SDK/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 构建踩坑记录

| 报错 | 原因 | 解决 |
|------|------|------|
| `minSdkVersion 14 cannot be smaller than 19 declared in material:1.12.0` | Material 要求 ≥ 19 | minSdk → 19 |
| `minSdkVersion 19 cannot be smaller than 23 declared in appcompat-resources:1.8.0` | AppCompat 要求 ≥ 23 | minSdk → 23（最终值） |
| `resource mipmap/ic_launcher not found` | 清单引用了不存在的图标 | 生成 5 密度 PNG + `mipmap-anydpi-v26` 自适应图标，清单加 `roundIcon` |
| `Could not find method buildConfigField()` | AGP 9 把 `buildConfigField`/`resValue` 从 `defaultConfig` 挪到了 `VariantDimension` | 改用 `variant.sources` / `androidComponents` 新 API |
| `Property has implicit dependency` | `sourceSets.java.srcDir` 指向任务生成目录 | 改用 `variant.sources.java.addGeneratedSourceDirectory(task) { it.outputDirectory }`，任务需自带 `outputDirectory` 属性 |
| 构建日期停在旧值 | `providers.provider { new Date() }` 被 configuration cache 固化 | 改用 `providers.exec { commandLine 'sh','-c','date +%Y.%m.%d' }`，执行期求值 |

注意：`org.gradle.configuration-cache=true` 已开启，改动 `build.gradle` 后 Gradle 会自动失效缓存；如遇异常可加 `--no-configuration-cache` 排查。

## 功能清单

| 功能 | 状态 |
|------|------|
| 收入看板（KPI + 图表） | ✅ |
| 台账列表（搜索 + 筛选） | ✅ |
| 新增/编辑账号 | ✅ |
| 充值（确认弹窗 + 预览） | ✅ |
| 七折开关（锁定不可逆） | ✅ |
| 按天自动扣费 | ✅ |
| 催缴提醒 | ❌ 已下线（键保留兼容旧备份） |
| 异常账号管理 | ✅ |
| 收支流水 | ✅ |
| AI 助手 | ❌ 已下线 |
| AI 识图记账 | ✅ |
| 数据导出 CSV / JSON 备份 | ✅ |
| 数据导入（JSON 合并/覆盖 + 台账 CSV） | ✅ |
| 设置页（AI 配置） | ✅ |
| 一键复制（内联 SVG 图标） | ✅ |
| 双击退出 | ✅ |
| 启动页动画 | ✅ |
| 「液面」玻璃视觉系统（纸白 + 磨砂 + 光纤青） | ✅ |
| 底部导航 + 侧边栏 | ✅ |
| Edge-to-edge 适配 | ✅ |
| Material 3 浅色主题 | ✅ |
| 兼容 Android 6.0+ | ✅ |
