package ru.spasibo.app

import android.content.Intent
import android.graphics.Color as AndroidGraphicsColor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.app.NotificationManagerCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import ru.spasibo.app.push.NotificationHelper
import ru.spasibo.app.push.PushRegistrar
import ru.spasibo.app.ui.splash.HeartbeatSplashScreen
import ru.spasibo.app.ui.theme.SpasiboTheme
import ru.spasibo.app.web.WebAppScreen

class MainActivity : ComponentActivity() {
    private var showBootSplash by mutableStateOf(true)
    private var webView: WebView? = null
    private var pendingPermissionCallback: ((Boolean) -> Unit)? = null
    private var pendingOpenUrl: String? = null

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        Log.i(LOG_TAG, "POST_NOTIFICATIONS result granted=$granted")
        markNotificationPermissionRequested()
        if (granted) {
            PushRegistrar.registerIfPossible(applicationContext)
        }
        notifyWebPermissionChanged(granted)
        pendingPermissionCallback?.invoke(granted)
        pendingPermissionCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        // Системный splash Android 12+ статичен и перекрывает Compose — убираем сразу.
        splashScreen.setKeepOnScreenCondition { false }
        splashScreen.setOnExitAnimationListener { provider ->
            provider.remove()
        }
        super.onCreate(savedInstanceState)

        Handler(Looper.getMainLooper()).postDelayed({
            hideBootSplash()
        }, SPLASH_MAX_MS)

        Handler(Looper.getMainLooper()).post {
            NotificationHelper.ensureChannel(this)
            PushRegistrar.registerIfPossible(applicationContext)
        }

        pendingOpenUrl = extractOpenUrl(intent)

        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(AndroidGraphicsColor.parseColor("#243B09")),
            navigationBarStyle = SystemBarStyle.dark(AndroidGraphicsColor.parseColor("#243B09")),
        )

        setContent {
            val bootSplashVisible = showBootSplash
            SpasiboTheme {
                Box(modifier = Modifier.fillMaxSize()) {
                    WebAppScreen(
                        activity = this@MainActivity,
                        initialUrl = pendingOpenUrl,
                        pendingOpenUrl = pendingOpenUrl,
                        onPendingOpenUrlHandled = { pendingOpenUrl = null },
                        showBootSplash = bootSplashVisible,
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (bootSplashVisible) {
                        HeartbeatSplashScreen(modifier = Modifier.fillMaxSize())
                    }
                }
            }
        }
    }

    /** Скрывает нативный splash после полной загрузки PWA. */
    fun hideBootSplash() {
        runOnUiThread {
            if (!showBootSplash) {
                return@runOnUiThread
            }
            showBootSplash = false
            enableEdgeToEdge(
                statusBarStyle = SystemBarStyle.light(
                    AndroidGraphicsColor.parseColor("#E5F5E3"),
                    AndroidGraphicsColor.parseColor("#E5F5E3"),
                ),
                navigationBarStyle = SystemBarStyle.light(
                    AndroidGraphicsColor.WHITE,
                    AndroidGraphicsColor.WHITE,
                ),
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = extractOpenUrl(intent)
        if (url.isNullOrBlank()) {
            return
        }
        Log.i(LOG_TAG, "Deep link: $url")
        pendingOpenUrl = url
        openUrlInWebView(url)
    }

    fun attachWebView(view: WebView) {
        webView = view
        pendingOpenUrl?.let { openUrlInWebView(it) }
    }

    fun clearWebViewHistory() {
        webView?.clearHistory()
    }

    fun openUrlInWebView(url: String) {
        val view = webView ?: return
        view.post {
            Log.i(LOG_TAG, "WebView loadUrl: $url")
            view.loadUrl(url)
        }
    }

    fun areNotificationsEnabledForApp(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                return false
            }
        }
        return NotificationManagerCompat.from(this).areNotificationsEnabled()
    }

    fun requestPostNotificationsPermissionIfNeeded(onResult: ((Boolean) -> Unit)? = null) {
        if (areNotificationsEnabledForApp()) {
            onResult?.invoke(true)
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            openAppNotificationSettings()
            onResult?.invoke(false)
            return
        }

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val askedBefore = prefs.getBoolean(KEY_NOTIF_PERMISSION_ASKED, false)
        val showRationale = shouldShowRequestPermissionRationale(
            android.Manifest.permission.POST_NOTIFICATIONS,
        )

        if (askedBefore && !showRationale) {
            openAppNotificationSettings()
            onResult?.invoke(false)
            return
        }

        pendingPermissionCallback = onResult
        notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    fun openAppNotificationSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }

    private fun markNotificationPermissionRequested() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_NOTIF_PERMISSION_ASKED, true)
            .apply()
    }

    private fun notifyWebPermissionChanged(granted: Boolean) {
        val view = webView ?: return
        view.post {
            view.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('spasibo:notification-permission'," +
                    "{detail:{granted:" + granted + "}}));",
                null,
            )
        }
    }

    private fun extractOpenUrl(intent: Intent?): String? {
        if (intent == null) {
            return null
        }
        return intent.getStringExtra(EXTRA_OPEN_URL)?.takeIf { it.isNotBlank() }
            ?: intent.data?.toString()?.takeIf { it.isNotBlank() }
    }

    companion object {
        const val EXTRA_OPEN_URL = "ru.spasibo.app.extra.OPEN_URL"
        private const val SPLASH_MAX_MS = 30_000L
        const val LOG_TAG = "SpasiboWebView"
        private const val PREFS_NAME = "spasibo_app"
        private const val KEY_NOTIF_PERMISSION_ASKED = "post_notifications_asked"
    }
}
