package ru.spasibo.app.web

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONObject
import ru.spasibo.app.BuildConfig
import ru.spasibo.app.MainActivity
import ru.spasibo.app.push.PushRegistrar
import ru.spasibo.app.push.PushSession
import ru.spasibo.app.push.PushSessionStore

/** JS-мост window.SpasiboAndroid для WebView. */
class SpasiboWebAppBridge(
    private val activity: MainActivity,
) {
    @JavascriptInterface
    fun syncSession(userId: Int, apiBaseUrl: String) {
        val resolvedBase = apiBaseUrl.trim().trimEnd('/').ifBlank {
            BuildConfig.PWA_URL.trim().trimEnd('/')
        }
        if (userId <= 0 || resolvedBase.isBlank()) {
            return
        }
        PushSessionStore(activity.applicationContext).save(
            PushSession(userId, resolvedBase),
        )
        activity.runOnUiThread {
            PushRegistrar.registerIfPossible(activity.applicationContext)
        }
    }

    @JavascriptInterface
    fun clearSession() {
        PushSessionStore(activity.applicationContext).clear()
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
        activity.runOnUiThread {
            activity.requestPostNotificationsPermissionIfNeeded()
        }
    }

    @JavascriptInterface
    fun isNotificationPermissionGranted(): Boolean {
        return activity.areNotificationsEnabledForApp()
    }

    @JavascriptInterface
    fun openAppNotificationSettings() {
        activity.runOnUiThread {
            activity.openAppNotificationSettings()
        }
    }

    @JavascriptInterface
    fun getPushRegistrationStatus(): String {
        val status = PushSessionStore(activity.applicationContext).readRegistrationStatus()
            ?: return "{\"ok\":false,\"httpCode\":0,\"detail\":\"not_attempted\"}"
        return JSONObject()
            .put("ok", status.ok)
            .put("httpCode", status.httpCode)
            .put("detail", status.detail)
            .toString()
    }

    @JavascriptInterface
    fun registerPushToken() {
        activity.runOnUiThread {
            PushRegistrar.registerIfPossible(activity.applicationContext)
        }
    }

    @JavascriptInterface
    fun getFcmToken(): String {
        return PushSessionStore(activity.applicationContext).readFcmToken().orEmpty()
    }

    @JavascriptInterface
    fun unregisterPushToken() {
        activity.runOnUiThread {
            PushRegistrar.unregisterIfPossible(activity.applicationContext)
        }
    }

    @JavascriptInterface
    fun showNativeToast(message: String) {
        if (message.isBlank()) {
            return
        }
        activity.runOnUiThread {
            Toast.makeText(activity.applicationContext, message, Toast.LENGTH_LONG).show()
        }
    }

    @JavascriptInterface
    fun clearWebViewHistory() {
        activity.runOnUiThread {
            activity.clearWebViewHistory()
        }
    }

    @JavascriptInterface
    fun hideBootSplash() {
        activity.runOnUiThread {
            activity.hideBootSplash()
        }
    }

    @JavascriptInterface
    fun openExternalUrl(url: String) {
        val trimmed = url.trim()
        if (trimmed.isBlank()) {
            return
        }
        activity.runOnUiThread {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(trimmed)))
        }
    }

    /**
     * Копирует текст в системный буфер (для WebView, где clipboard API часто недоступен).
     */
    @JavascriptInterface
    fun copyText(text: String): Boolean {
        val value = text.trim()
        if (value.isBlank()) {
            return false
        }
        return try {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("spasibo", value))
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Открывает системный шаринг текста/ссылки.
     */
    @JavascriptInterface
    fun shareText(text: String, title: String?): Boolean {
        val value = text.trim()
        if (value.isBlank()) {
            return false
        }
        val shareTitle = title?.trim().orEmpty().ifBlank { "Спасибо" }
        return try {
            activity.runOnUiThread {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, value)
                    putExtra(Intent.EXTRA_SUBJECT, shareTitle)
                }
                activity.startActivity(Intent.createChooser(intent, shareTitle))
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun getAppVersionCode(): Int {
        return BuildConfig.VERSION_CODE
    }

    @JavascriptInterface
    fun getAppVersionName(): String {
        return BuildConfig.VERSION_NAME
    }
}
