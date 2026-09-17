package ru.spasibo.app.web

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONObject
import ru.spasibo.app.BuildConfig
import ru.spasibo.app.MainActivity
import ru.spasibo.app.R
import ru.spasibo.app.push.PushRegistrar
import ru.spasibo.app.push.PushSession
import ru.spasibo.app.push.PushSessionStore
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** JS-мост window.SpasiboAndroid для WebView. */
class SpasiboWebAppBridge(
    private val activity: MainActivity,
) {
    private data class PendingDownload(
        val filename: String,
        val mimeType: String,
        val buffer: ByteArrayOutputStream = ByteArrayOutputStream(),
    )

    private val pendingDownloads = ConcurrentHashMap<String, PendingDownload>()

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

    /**
     * Начинает сохранение файла в Downloads (чанки поверх Binder limit).
     *
     * @return id передачи или пустая строка при ошибке
     */
    @JavascriptInterface
    fun beginBinaryDownload(filename: String, mimeType: String?): String {
        val safeName = sanitizeFilename(filename)
        if (safeName.isBlank()) {
            return ""
        }
        val id = UUID.randomUUID().toString()
        pendingDownloads[id] = PendingDownload(
            filename = safeName,
            mimeType = mimeType?.trim().orEmpty().ifBlank {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            },
        )
        return id
    }

    /**
     * Добавляет base64-чанк к незавершённой загрузке.
     */
    @JavascriptInterface
    fun appendBinaryDownloadChunk(transferId: String, base64Chunk: String): Boolean {
        val pending = pendingDownloads[transferId] ?: return false
        if (base64Chunk.isBlank()) {
            return true
        }
        return try {
            val decoded = Base64.decode(base64Chunk, Base64.DEFAULT)
            synchronized(pending.buffer) {
                pending.buffer.write(decoded)
            }
            true
        } catch (_: Exception) {
            pendingDownloads.remove(transferId)
            false
        }
    }

    /**
     * Завершает передачу и сохраняет файл в Downloads.
     */
    @JavascriptInterface
    fun finishBinaryDownload(transferId: String): Boolean {
        val pending = pendingDownloads.remove(transferId) ?: return false
        val bytes = synchronized(pending.buffer) {
            pending.buffer.toByteArray()
        }
        return saveBytesToDownloads(bytes, pending.filename, pending.mimeType)
    }

    /**
     * Короткий путь: сохранить целиком (для небольших файлов).
     */
    @JavascriptInterface
    fun saveBase64File(base64: String, filename: String, mimeType: String?): Boolean {
        if (base64.isBlank()) {
            return false
        }
        return try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            saveBytesToDownloads(
                bytes,
                sanitizeFilename(filename),
                mimeType?.trim().orEmpty().ifBlank {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                },
            )
        } catch (_: Exception) {
            showDownloadToast(false)
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

    private fun sanitizeFilename(filename: String): String {
        val cleaned = filename.trim()
            .replace(Regex("[\\\\/:*?\"<>|]"), "_")
            .replace(Regex("\\s+"), " ")
        return cleaned.ifBlank { "report.xlsx" }
    }

    private fun saveBytesToDownloads(bytes: ByteArray, filename: String, mimeType: String): Boolean {
        return try {
            val context = activity.applicationContext
            val resolver = context.contentResolver
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, filename)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("insert failed")
                resolver.openOutputStream(uri)?.use { stream ->
                    stream.write(bytes)
                    stream.flush()
                } ?: throw IllegalStateException("openOutputStream failed")
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!dir.exists()) {
                    dir.mkdirs()
                }
                val target = File(dir, filename)
                target.outputStream().use { stream ->
                    stream.write(bytes)
                    stream.flush()
                }
                MediaScannerConnection.scanFile(
                    context,
                    arrayOf(target.absolutePath),
                    arrayOf(mimeType),
                    null,
                )
            }
            showDownloadToast(true)
            true
        } catch (_: Exception) {
            showDownloadToast(false)
            false
        }
    }

    private fun showDownloadToast(success: Boolean) {
        activity.runOnUiThread {
            Toast.makeText(
                activity.applicationContext,
                if (success) R.string.download_started else R.string.download_failed,
                Toast.LENGTH_SHORT,
            ).show()
        }
    }
}
