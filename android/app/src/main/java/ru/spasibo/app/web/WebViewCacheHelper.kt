package ru.spasibo.app.web

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebView
import org.json.JSONObject
import ru.spasibo.app.BuildConfig

/** Сброс HTTP-кеша WebView при обновлении APK. */
object WebViewCacheHelper {
    fun ensureFreshForAppVersion(context: Context, webView: WebView?) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lastCode = prefs.getInt(KEY_LAST_CACHE_VERSION, 0)
        val currentCode = BuildConfig.VERSION_CODE
        if (lastCode == currentCode) {
            return
        }
        webView?.clearCache(true)
        CookieManager.getInstance().removeAllCookies(null)
        prefs.edit().putInt(KEY_LAST_CACHE_VERSION, currentCode).apply()
    }

    private const val PREFS_NAME = "spasibo_app"
    private const val KEY_LAST_CACHE_VERSION = "last_web_cache_version"
}

/** Отправляет deep link в уже загруженное PWA без полной перезагрузки. */
fun dispatchDeepLinkToWebView(webView: WebView, url: String) {
    val quoted = JSONObject.quote(url)
    webView.post {
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('spasibo:open-url'," +
                "{detail:{url:$quoted}}));",
            null,
        )
    }
}

/** WebView уже показывает приложение (не about:blank). */
fun isWebAppReady(webView: WebView?): Boolean {
    val current = webView?.url?.trim().orEmpty()
    return current.isNotEmpty() && current != "about:blank"
}
