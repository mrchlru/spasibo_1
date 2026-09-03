package ru.spasibo.app.web

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import java.io.ByteArrayInputStream
import kotlinx.coroutines.delay
import ru.spasibo.app.BuildConfig
import ru.spasibo.app.MainActivity
import ru.spasibo.app.R
import ru.spasibo.app.ui.offline.OfflineScreen
import ru.spasibo.app.ui.splash.HeartbeatSplashScreen
import ru.spasibo.app.ui.theme.SpasiboAccent
import ru.spasibo.app.ui.theme.SpasiboAppBackground
import ru.spasibo.app.ui.theme.SpasiboStatusBarBackground

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebAppScreen(
    activity: MainActivity,
    initialUrl: String? = null,
    pendingOpenUrl: String? = null,
    onPendingOpenUrlHandled: () -> Unit = {},
    showBootSplash: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var webView by remember { mutableStateOf<WebView?>(null) }
    var loadProgress by remember { mutableFloatStateOf(0f) }
    var isLoading by remember { mutableStateOf(true) }
    var hasLoadError by remember { mutableStateOf(false) }
    var isOffline by remember {
        mutableStateOf(!NetworkConnectivity.isNetworkAvailable(context))
    }
    val showOffline = hasLoadError || isOffline
    val initialLoadDone = remember { java.util.concurrent.atomic.AtomicBoolean(false) }

    fun finishInitialLoad() {
        activity.runOnUiThread {
            initialLoadDone.compareAndSet(false, true)
        }
    }

    fun retryLoad() {
        if (!NetworkConnectivity.isNetworkAvailable(context)) {
            isOffline = true
            hasLoadError = true
            isLoading = false
            return
        }
        isOffline = false
        hasLoadError = false
        isLoading = true
        loadProgress = 0f
        webView?.reload()
    }

    fun showOfflineError() {
        hasLoadError = true
        isOffline = true
        isLoading = false
        finishInitialLoad()
    }

    var pendingUploadCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }

    val filePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = pendingUploadCallback
        pendingUploadCallback = null
        if (callback == null) {
            return@rememberLauncherForActivityResult
        }
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        callback.onReceiveValue(uris)
    }

    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher

    DisposableEffect(backDispatcher, webView) {
        val callback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView
                if (view?.canGoBack() == true) {
                    view.goBack()
                    return
                }
                activity.moveTaskToBack(true)
            }
        }
        backDispatcher?.addCallback(callback)
        onDispose { callback.remove() }
    }

    DisposableEffect(context) {
        val unregister = NetworkConnectivity.registerCallback(
            context = context,
            onOnline = {
                isOffline = false
                hasLoadError = false
            },
            onOffline = {
                isOffline = true
                isLoading = false
                finishInitialLoad()
            },
        )
        onDispose { unregister() }
    }

    LaunchedEffect(showOffline) {
        if (showOffline) {
            activity.hideBootSplash()
        }
    }

    LaunchedEffect(Unit) {
        if (!NetworkConnectivity.isNetworkAvailable(context)) {
            isOffline = true
            isLoading = false
            finishInitialLoad()
        }
    }

    LaunchedEffect(isLoading, showOffline) {
        if (!isLoading || showOffline) {
            return@LaunchedEffect
        }
        delay(15_000)
        if (isLoading && !NetworkConnectivity.isNetworkAvailable(context)) {
            isOffline = true
            isLoading = false
            finishInitialLoad()
        }
    }

    LaunchedEffect(initialUrl) {
        val target = initialUrl?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        webView?.loadUrl(target)
    }

    LaunchedEffect(pendingOpenUrl) {
        val target = pendingOpenUrl?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        webView?.loadUrl(target)
        onPendingOpenUrlHandled()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(SpasiboAppBackground),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsTopHeight(WindowInsets.statusBars)
                .background(SpasiboStatusBarBackground),
        )

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .graphicsLayer {
                    alpha = if (showBootSplash && !showOffline) 0f else 1f
                },
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    if (BuildConfig.DEBUG && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                        WebView.setWebContentsDebuggingEnabled(true)
                    }
                    WebView(ctx).apply {
                        layoutParams = FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                        setBackgroundColor(AndroidColor.parseColor("#F7F7F8"))

                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            databaseEnabled = true
                            loadsImagesAutomatically = true
                            useWideViewPort = true
                            loadWithOverviewMode = true
                            builtInZoomControls = false
                            displayZoomControls = false
                            setSupportZoom(false)
                            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                            cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK
                            mediaPlaybackRequiresUserGesture = false
                            allowFileAccess = true
                            allowContentAccess = true
                            javaScriptCanOpenWindowsAutomatically = true
                            @Suppress("DEPRECATION")
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                safeBrowsingEnabled = false
                            }
                            userAgentString = "$userAgentString SpasiboAndroid/1.0"
                        }

                        CookieManager.getInstance().setAcceptCookie(true)
                        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                        addJavascriptInterface(
                            SpasiboWebAppBridge(activity),
                            "SpasiboAndroid",
                        )
                        activity.attachWebView(this)

                        webViewClient = object : WebViewClient() {
                            @SuppressLint("WebViewClientOnReceivedSslError")
                            override fun onReceivedSslError(
                                view: WebView?,
                                handler: android.webkit.SslErrorHandler?,
                                error: android.net.http.SslError?,
                            ) {
                                val host = error?.url?.let { Uri.parse(it).host }.orEmpty()
                                if (isTimewebPlatformHost(host)) {
                                    Log.w(
                                        MainActivity.LOG_TAG,
                                        "SSL Timeweb: доверяем платформенному сертификату " +
                                            "host=$host error=${error?.primaryError}",
                                    )
                                    handler?.proceed()
                                    return
                                }
                                Log.e(
                                    MainActivity.LOG_TAG,
                                    "SSL error: ${error?.primaryError} url=${error?.url}",
                                )
                                showOfflineError()
                                handler?.cancel()
                            }

                            override fun shouldOverrideUrlLoading(
                                view: WebView?,
                                request: WebResourceRequest?,
                            ): Boolean = false

                            override fun onPageStarted(
                                view: WebView?,
                                url: String?,
                                favicon: android.graphics.Bitmap?,
                            ) {
                                Log.i(MainActivity.LOG_TAG, "onPageStarted url=$url")
                            }

                            override fun shouldInterceptRequest(
                                view: WebView?,
                                request: WebResourceRequest?,
                            ): WebResourceResponse? {
                                val path = request?.url?.path ?: return null
                                if (!path.endsWith("/telegram/webapp-sdk")) {
                                    return null
                                }
                                // Сервер иногда отдаёт index.html вместо JS — Huawei WebView
                                // после синтаксической ошибки не запускает React-бандл.
                                Log.w(
                                    MainActivity.LOG_TAG,
                                    "webapp-sdk: подмена битого ответа сервера пустым JS",
                                )
                                return WebResourceResponse(
                                    "application/javascript",
                                    "utf-8",
                                    ByteArrayInputStream("//".toByteArray(Charsets.UTF_8)),
                                )
                            }

                            override fun onPageFinished(view: WebView?, url: String?) {
                                if (url == "about:blank") {
                                    return
                                }
                                logPageState(view, url, attempt = 1)
                                view?.postDelayed({ logPageState(view, url, attempt = 2) }, 1_500L)
                                isLoading = false
                                loadProgress = 1f
                                hasLoadError = false
                                isOffline = false
                                finishInitialLoad()
                            }

                            override fun onPageCommitVisible(view: WebView?, url: String?) {
                                if (url == "about:blank") {
                                    return
                                }
                                Log.i(MainActivity.LOG_TAG, "onPageCommitVisible url=$url")
                                isLoading = false
                                hasLoadError = false
                                isOffline = false
                                finishInitialLoad()
                            }

                            @Deprecated("Deprecated in API 23")
                            override fun onReceivedError(
                                view: WebView?,
                                errorCode: Int,
                                description: String?,
                                failingUrl: String?,
                            ) {
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                    return
                                }
                                Log.e(
                                    MainActivity.LOG_TAG,
                                    "WebView legacy error: $description code=$errorCode url=$failingUrl",
                                )
                                showOfflineError()
                            }

                            override fun onReceivedError(
                                view: WebView?,
                                request: WebResourceRequest?,
                                error: WebResourceError?,
                            ) {
                                if (request?.isForMainFrame != true) {
                                    return
                                }
                                if (!isMainFrameNetworkError(error)) {
                                    return
                                }
                                Log.e(
                                    MainActivity.LOG_TAG,
                                    "WebView error: ${error?.description} code=${error?.errorCode}",
                                )
                                showOfflineError()
                            }

                            override fun onReceivedHttpError(
                                view: WebView?,
                                request: WebResourceRequest?,
                                errorResponse: android.webkit.WebResourceResponse?,
                            ) {
                                if (request?.isForMainFrame != true) {
                                    return
                                }
                                val status = errorResponse?.statusCode ?: return
                                if (!isOfflineHttpStatus(status)) {
                                    return
                                }
                                Log.e(
                                    MainActivity.LOG_TAG,
                                    "WebView HTTP error on main frame: $status",
                                )
                                showOfflineError()
                            }
                        }

                        webChromeClient = object : WebChromeClient() {
                            override fun onConsoleMessage(
                                message: android.webkit.ConsoleMessage?,
                            ): Boolean {
                                Log.w(
                                    MainActivity.LOG_TAG,
                                    "JS ${message?.messageLevel()} ${message?.sourceId()}:${message?.lineNumber()} ${message?.message()}",
                                )
                                return true
                            }

                            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                                loadProgress = newProgress / 100f
                                isLoading = newProgress < 100
                                if (newProgress >= 25) {
                                    finishInitialLoad()
                                }
                            }

                            override fun onShowFileChooser(
                                webView: WebView?,
                                callback: ValueCallback<Array<Uri>>?,
                                fileChooserParams: FileChooserParams?,
                            ): Boolean {
                                pendingUploadCallback?.onReceiveValue(null)
                                pendingUploadCallback = callback
                                val intent = fileChooserParams?.createIntent()
                                if (intent == null) {
                                    callback?.onReceiveValue(null)
                                    pendingUploadCallback = null
                                    return false
                                }
                                return try {
                                    filePickerLauncher.launch(intent)
                                    true
                                } catch (_: Exception) {
                                    callback?.onReceiveValue(null)
                                    pendingUploadCallback = null
                                    false
                                }
                            }
                        }

                        setDownloadListener { url, _, contentDisposition, mimeType, _ ->
                            enqueueDownload(
                                context = activity,
                                url = url,
                                contentDisposition = contentDisposition,
                                mimeType = mimeType,
                            )
                        }

                        val startUrl =
                            initialUrl?.takeIf { it.isNotBlank() } ?: SPASIBO_HOME_URL
                        loadUrl(startUrl)
                        webView = this
                    }
                },
                update = { view ->
                    webView = view
                    view.layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                },
            )

            if (showOffline) {
                OfflineScreen(
                    onRetry = { retryLoad() },
                    modifier = Modifier
                        .fillMaxSize()
                        .background(SpasiboAppBackground),
                )
            }

            if (showBootSplash && !showOffline) {
                HeartbeatSplashScreen(modifier = Modifier.fillMaxSize())
            } else if (isLoading && !showOffline) {
                LinearProgressIndicator(
                    progress = { loadProgress.coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .align(Alignment.TopCenter),
                    color = SpasiboAccent,
                    trackColor = Color(0xFFE0E0E0),
                )
            }
        }
    }
}

private fun isTimewebPlatformHost(host: String): Boolean {
    return host.endsWith(".twc1.net", ignoreCase = true) ||
        host.equals("twc1.net", ignoreCase = true)
}

private fun logPageState(view: WebView?, url: String?, attempt: Int) {
    view?.evaluateJavascript(
        "(function(){var r=document.getElementById('root');" +
            "var b=document.body;" +
            "return JSON.stringify({" +
            "rootChildren:r?r.childElementCount:-1," +
            "readyState:document.readyState," +
            "bodyLen:b?b.innerHTML.length:0," +
            "title:document.title||''" +
            "});})()",
    ) { payload ->
        Log.i(MainActivity.LOG_TAG, "Page state #$attempt $payload url=$url")
    }
}

private fun enqueueDownload(
    context: Context,
    url: String,
    contentDisposition: String?,
    mimeType: String?,
) {
    try {
        val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(Uri.parse(url)).apply {
            setTitle(fileName)
            setDescription(context.getString(R.string.download_description))
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            mimeType?.let { setMimeType(it) }
            setAllowedOverMetered(true)
            setAllowedOverRoaming(true)
            CookieManager.getInstance().getCookie(url)?.takeIf { it.isNotEmpty() }?.let { cookie ->
                addRequestHeader("Cookie", cookie)
            }
        }
        val downloadManager =
            context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        downloadManager.enqueue(request)
        Toast.makeText(context, R.string.download_started, Toast.LENGTH_SHORT).show()
    } catch (_: Exception) {
        Toast.makeText(context, R.string.download_failed, Toast.LENGTH_SHORT).show()
    }
}
