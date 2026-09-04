package ru.spasibo.app.push

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject
import ru.spasibo.app.MainActivity
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object PushApiClient {
    fun registerToken(context: Context, session: PushSession, token: String): Boolean {
        val store = PushSessionStore(context.applicationContext)
        val body = JSONObject()
            .put("token", token)
            .put("device_name", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
        return post(context, session, store, "/push/android/register", body.toString(), markRegistered = true)
    }

    fun unregisterToken(context: Context, session: PushSession, token: String): Boolean {
        val store = PushSessionStore(context.applicationContext)
        val body = JSONObject().put("token", token)
        return post(
            context,
            session,
            store,
            "/push/android/unregister",
            body.toString(),
            markRegistered = false,
        )
    }

    private fun post(
        context: Context,
        session: PushSession,
        store: PushSessionStore,
        path: String,
        jsonBody: String,
        markRegistered: Boolean = true,
    ): Boolean {
        val url = "${session.apiBaseUrl.trimEnd('/')}$path"
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("X-User-Id", session.userId.toString())
        }

        return try {
            connection.outputStream.use { it.write(jsonBody.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val ok = code in 200..299 || code == 204
            if (ok) {
                if (markRegistered) {
                    store.saveRegistrationStatus(true, code, "registered")
                    Log.i(MainActivity.LOG_TAG, "FCM token зарегистрирован ($code) userId=${session.userId}")
                } else {
                    store.clearRegistrationStatus()
                    Log.i(MainActivity.LOG_TAG, "FCM token отключён ($code) userId=${session.userId}")
                }
            } else {
                val errorBody = readStream(
                    if (code >= 400) connection.errorStream else connection.inputStream,
                )
                store.saveRegistrationStatus(false, code, errorBody)
                Log.e(MainActivity.LOG_TAG, "Ошибка регистрации FCM ($code) url=$url body=$errorBody")
            }
            ok
        } catch (error: Exception) {
            store.saveRegistrationStatus(false, 0, error.message ?: "network error")
            Log.e(MainActivity.LOG_TAG, "Сбой регистрации FCM: ${error.message} url=$url", error)
            false
        } finally {
            connection.disconnect()
        }
    }

    private fun readStream(stream: java.io.InputStream?): String {
        if (stream == null) {
            return ""
        }
        return BufferedReader(InputStreamReader(stream)).use { it.readText().take(500) }
    }
}

