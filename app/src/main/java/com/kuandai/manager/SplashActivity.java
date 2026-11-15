package com.kuandai.manager;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class SplashActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);

        // 版本号从 BuildConfig 取，不在布局里硬编码
        TextView version = findViewById(R.id.splashVersion);
        if (version != null) {
            version.setText("v" + BuildConfig.VERSION_NAME
                    + " · " + BuildInfo.BUILD_DATE
                    + " · Build " + BuildConfig.VERSION_CODE);
        }

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            startActivity(new Intent(SplashActivity.this, MainActivity.class));
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
            finish();
        }, 1200);
    }
}
