package com.kuandai.manager;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.RequiresApi;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ProgressBar progressBar;
    private View splashOverlay;
    private View rootView;
    private ValueCallback<Uri[]> filePathCallback;

    /** 当前系统栏 / 手势条 / 键盘 inset（物理像素），用于注入到网页 CSS 变量 */
    private int insetTopPx = -1;
    private int insetNavPx = -1;
    private int insetBottomPx = -1;
    private boolean pageReady = false;

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                Uri uri = result.getData().getData();
                if (uri != null) results = new Uri[]{uri};
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        });

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Edge-to-edge 显示 (Android 15+/API 35+)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // 浅色纸底：状态栏/手势条都要用深色图标
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);

        // 系统栏全透明，让页面的光场一直铺到状态栏和手势条下面
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);
        splashOverlay = findViewById(R.id.splashOverlay);
        rootView = findViewById(R.id.rootView);

        // 启动遮罩的版本号从 BuildConfig 取，不在布局里硬编码
        TextView splashVersion = findViewById(R.id.splashVersion);
        if (splashVersion != null) {
            splashVersion.setText(versionText());
        }

        // 把系统栏/手势条/键盘的实际尺寸注入网页，页面靠 CSS 变量避让。
        // Android WebView 不提供 env(safe-area-inset-*)，必须在原生侧算好再传进去。
        ViewCompat.setOnApplyWindowInsetsListener(rootView, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            int top = bars.top;
            int nav = bars.bottom;
            // 键盘弹出时用键盘高度顶替底部导航栏高度，输入框才不会被挡
            int bottom = Math.max(nav, ime.bottom);
            if (top != insetTopPx || nav != insetNavPx || bottom != insetBottomPx) {
                insetTopPx = top;
                insetNavPx = nav;
                insetBottomPx = bottom;
                applyInsetsToWeb();
            }
            return insets;
        });
        ViewCompat.requestApplyInsets(rootView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportZoom(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 强制暗色模式适配
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ 支持Force Dark
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
        }

        // JS 桥接
        webView.addJavascriptInterface(new AppBridge(), "AndroidApp");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                pageReady = true;
                // 页面就绪后补一次 inset，避免首次加载时变量还没写进去
                applyInsetsToWeb();
                splashOverlay.animate().alpha(0f).setDuration(400).withEndAction(() ->
                    splashOverlay.setVisibility(View.GONE)).start();
            }

            @RequiresApi(Build.VERSION_CODES.LOLLIPOP)
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                if (newProgress >= 100) {
                    progressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("确定", (d, w) -> result.confirm())
                    .show();
                result.cancel();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("确定", (d, w) -> result.confirm())
                    .setNegativeButton("取消", (d, w) -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = params.createIntent();
                try {
                    fileChooserLauncher.launch(intent);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // 加载本地 Web 应用
        webView.loadUrl("file:///android_asset/web/index.html");

        // 返回键处理
        webView.setOnKeyListener((v, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_DOWN) {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    if ((System.currentTimeMillis() - exitTime) > 2000) {
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new Event('appbackpress'))", null);
                        exitTime = System.currentTimeMillis();
                    } else {
                        finish();
                    }
                }
                return true;
            }
            return false;
        });
    }

    /**
     * 把 inset 物理像素换算成 CSS px（WebView 里 1 CSS px = 1 dp），写入页面 CSS 变量。
     * --inset-top    状态栏高度（顶部栏、侧边栏避让）
     * --inset-nav    手势条高度（底部导航、FAB 避让，键盘弹出时不变）
     * --inset-bottom max(手势条, 键盘)（内容区底部留白、弹窗抬起）
     */
    private void applyInsetsToWeb() {
        if (!pageReady || webView == null || insetTopPx < 0) return;
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 1f;
        int topCss = Math.round(insetTopPx / density);
        int navCss = Math.round(insetNavPx / density);
        int bottomCss = Math.round(insetBottomPx / density);
        String js = "document.documentElement.style.setProperty('--inset-top','" + topCss + "px');"
                  + "document.documentElement.style.setProperty('--inset-nav','" + navCss + "px');"
                  + "document.documentElement.style.setProperty('--inset-bottom','" + bottomCss + "px');";
        webView.evaluateJavascript(js, null);
    }

    private long exitTime = 0;

    /** 完整版本串：v1.3.0 · 2026.11.15 · Build 8 */
    private String versionText() {
        return "v" + BuildConfig.VERSION_NAME
                + " · " + BuildInfo.BUILD_DATE
                + " · Build " + BuildConfig.VERSION_CODE;
    }

    // JS 桥接接口
    public class AppBridge {
        @JavascriptInterface
        public String getAppVersion() {
            return BuildConfig.VERSION_NAME;
        }

        /** 构建号（versionCode），界面用来显示「Build N」体现迭代次数 */
        @JavascriptInterface
        public int getBuildCode() {
            return BuildConfig.VERSION_CODE;
        }

        /** 构建日期，如 2026.11.15 */
        @JavascriptInterface
        public String getBuildDate() {
            return BuildInfo.BUILD_DATE;
        }

        /** 完整版本串，如 "v1.3.0 · 2026.11.15 · Build 8" */
        @JavascriptInterface
        public String getFullVersion() {
            return versionText();
        }

        @JavascriptInterface
        public String getAndroidVersion() {
            return Build.VERSION.RELEASE;
        }

        @JavascriptInterface
        public int getSdkInt() {
            return Build.VERSION.SDK_INT;
        }

        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> {
                android.widget.Toast.makeText(MainActivity.this, message,
                    android.widget.Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void vibrate(int milliseconds) {
            runOnUiThread(() -> {
                android.os.Vibrator v = (android.os.Vibrator)
                    getSystemService(android.content.Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(android.os.VibrationEffect.createOneShot(
                            milliseconds, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        v.vibrate(milliseconds);
                    }
                }
            });
        }

        @JavascriptInterface
        public void exitApp() {
            finish();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.evaluateJavascript(
            "window.dispatchEvent(new Event('apppause'))", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.evaluateJavascript(
            "window.dispatchEvent(new Event('appresume'))", null);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
