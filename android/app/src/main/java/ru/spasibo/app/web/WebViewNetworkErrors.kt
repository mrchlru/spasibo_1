package ru.spasibo.app.web

import android.webkit.WebResourceError
import android.webkit.WebViewClient

internal fun isMainFrameNetworkError(error: WebResourceError?): Boolean {
    if (error == null) {
        return true
    }
    return when (error.errorCode) {
        WebViewClient.ERROR_HOST_LOOKUP,
        WebViewClient.ERROR_CONNECT,
        WebViewClient.ERROR_TIMEOUT,
        WebViewClient.ERROR_PROXY_AUTHENTICATION,
        WebViewClient.ERROR_UNSUPPORTED_AUTH_SCHEME,
        WebViewClient.ERROR_AUTHENTICATION,
        WebViewClient.ERROR_IO,
        -> true
        else -> false
    }
}

internal fun isOfflineHttpStatus(statusCode: Int): Boolean {
    return statusCode == 502 || statusCode == 503 || statusCode == 504
}
