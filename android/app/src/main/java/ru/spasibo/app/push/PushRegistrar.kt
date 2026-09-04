package ru.spasibo.app.push

import android.content.Context
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import ru.spasibo.app.MainActivity

object PushRegistrar {
    fun registerIfPossible(context: Context) {
        val appContext = context.applicationContext
        val session = PushSessionStore(appContext).read()
        if (session == null) {
            Log.w(
                MainActivity.LOG_TAG,
                "FCM: сессия не сохранена — войдите в аккаунт (userId/apiBaseUrl)",
            )
            return
        }

        Log.i(
            MainActivity.LOG_TAG,
            "FCM: регистрация token userId=${session.userId} api=${session.apiBaseUrl}",
        )

        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.e(MainActivity.LOG_TAG, "FCM: не удалось получить token", task.exception)
                PushSessionStore(appContext).saveRegistrationStatus(
                    ok = false,
                    httpCode = 0,
                    detail = task.exception?.message ?: "FCM token unavailable",
                )
                return@addOnCompleteListener
            }
            val token = task.result
            if (token.isNullOrBlank()) {
                Log.e(MainActivity.LOG_TAG, "FCM: пустой token")
                return@addOnCompleteListener
            }
            Log.i(MainActivity.LOG_TAG, "FCM token получен (${token.take(12)}…)")
            PushSessionStore(appContext).saveFcmToken(token)
            Thread {
                PushApiClient.registerToken(appContext, session, token)
            }.start()
        }
    }

    fun unregisterIfPossible(context: Context) {
        val appContext = context.applicationContext
        val session = PushSessionStore(appContext).read()
        val token = PushSessionStore(appContext).readFcmToken()
        if (session == null || token.isNullOrBlank()) {
            PushSessionStore(appContext).clearRegistrationStatus()
            return
        }

        Thread {
            PushApiClient.unregisterToken(appContext, session, token)
        }.start()
    }
}
