package ru.spasibo.app.widget

import android.content.Context
import android.util.Log
import org.json.JSONObject
import ru.spasibo.app.MainActivity
import ru.spasibo.app.push.PushSession
import ru.spasibo.app.push.PushSessionStore
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.max

/** Loads widget snapshot from Spasibo API using the saved push session. */
object WidgetDataFetcher {
    fun fetch(context: Context): WidgetSnapshot {
        val appContext = context.applicationContext
        val session = PushSessionStore(appContext).read()
        if (session == null) {
            return WidgetSnapshot(
                loggedIn = false,
                updatedAtMs = System.currentTimeMillis(),
                error = "Войдите в приложение",
            )
        }

        return try {
            val me = getJson(session, "/users/me")
            val unreadJson = runCatching { getJson(session, "/notifications/unread-count") }.getOrNull()
            val teamsJson = runCatching { getJson(session, "/users/me/teams-bonus-card") }.getOrNull()

            val balance = me.optInt("balance", 0)
            val dailyCount = me.optInt("daily_transfer_count", 0)
            val fairPlay = me.optJSONObject("fair_play")
            val dailyLimit = fairPlay?.optInt("effective_daily_limit", 3) ?: 3
            val transfersLeft = max(0, dailyLimit - dailyCount)
            val tickets = me.optInt("tickets", 0)
            val unread = unreadJson?.optInt("unread_count", 0) ?: 0

            val teamsLinked = teamsJson?.optBoolean("linked", false) == true
            val teamsBalance = teamsJson?.optString("balance_rub", "").orEmpty()
            val teamsDiscount = teamsJson?.optInt("discount_percent", 0) ?: 0

            WidgetSnapshot(
                loggedIn = true,
                balance = balance,
                transfersLeft = transfersLeft,
                dailyLimit = dailyLimit,
                tickets = tickets,
                unreadNotifications = unread,
                teamsLinked = teamsLinked,
                teamsBalanceRub = teamsBalance,
                teamsDiscountPercent = teamsDiscount,
                updatedAtMs = System.currentTimeMillis(),
                error = "",
            )
        } catch (error: Exception) {
            Log.e(MainActivity.LOG_TAG, "Widget fetch failed: ${error.message}", error)
            val cached = WidgetSnapshotStore(appContext).read()
            cached.copy(
                loggedIn = true,
                updatedAtMs = System.currentTimeMillis(),
                error = "Нет сети",
            )
        }
    }

    private fun getJson(session: PushSession, path: String): JSONObject {
        val url = "${session.apiBaseUrl.trimEnd('/')}$path"
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 12_000
            readTimeout = 12_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-User-Id", session.userId.toString())
        }
        try {
            val code = connection.responseCode
            val stream = if (code >= 400) connection.errorStream else connection.inputStream
            val body = readStream(stream)
            if (code !in 200..299) {
                throw IllegalStateException("HTTP $code $path: $body")
            }
            return JSONObject(body.ifBlank { "{}" })
        } finally {
            connection.disconnect()
        }
    }

    private fun readStream(stream: java.io.InputStream?): String {
        if (stream == null) {
            return ""
        }
        return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
    }
}
