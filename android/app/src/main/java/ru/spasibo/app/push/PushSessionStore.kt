package ru.spasibo.app.push

import android.content.Context

/** Локальное хранение userId и apiBaseUrl для FCM register. */
class PushSessionStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun save(session: PushSession) {
        prefs.edit()
            .putInt(KEY_USER_ID, session.userId)
            .putString(KEY_API_BASE, session.apiBaseUrl.trimEnd('/'))
            .apply()
    }

    fun read(): PushSession? {
        val userId = prefs.getInt(KEY_USER_ID, -1)
        val apiBase = prefs.getString(KEY_API_BASE, null)?.trim()?.trimEnd('/').orEmpty()
        if (userId <= 0 || apiBase.isEmpty()) {
            return null
        }
        return PushSession(userId, apiBase)
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun saveFcmToken(token: String) {
        prefs.edit().putString(KEY_FCM_TOKEN, token).apply()
    }

    fun readFcmToken(): String? {
        return prefs.getString(KEY_FCM_TOKEN, null)?.trim()?.takeIf { it.isNotEmpty() }
    }

    fun clearRegistrationStatus() {
        prefs.edit()
            .remove(KEY_REG_OK)
            .remove(KEY_REG_HTTP)
            .remove(KEY_REG_DETAIL)
            .apply()
    }

    fun saveRegistrationStatus(ok: Boolean, httpCode: Int = 0, detail: String = "") {
        prefs.edit()
            .putBoolean(KEY_REG_OK, ok)
            .putInt(KEY_REG_HTTP, httpCode)
            .putString(KEY_REG_DETAIL, detail.take(500))
            .apply()
    }

    fun readRegistrationStatus(): RegistrationStatus? {
        if (!prefs.contains(KEY_REG_OK)) {
            return null
        }
        return RegistrationStatus(
            ok = prefs.getBoolean(KEY_REG_OK, false),
            httpCode = prefs.getInt(KEY_REG_HTTP, 0),
            detail = prefs.getString(KEY_REG_DETAIL, "").orEmpty(),
        )
    }

    data class RegistrationStatus(
        val ok: Boolean,
        val httpCode: Int,
        val detail: String,
    )

    companion object {
        private const val PREFS_NAME = "spasibo_push"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_API_BASE = "api_base"
        private const val KEY_FCM_TOKEN = "fcm_token"
        private const val KEY_REG_OK = "reg_ok"
        private const val KEY_REG_HTTP = "reg_http"
        private const val KEY_REG_DETAIL = "reg_detail"
    }
}
