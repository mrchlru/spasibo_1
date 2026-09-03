package ru.spasibo.app.web

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
}
