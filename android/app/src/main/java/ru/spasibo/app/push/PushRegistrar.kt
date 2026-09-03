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
            Log.w(MainActivity.LOG_TAG, "FCM: сессия не сохранена — войдите в аккаунт")
            return
        }

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
            PushSessionStore(appContext).saveFcmToken(token)
            Thread {
                PushApiClient.registerToken(appContext, session, token)
            }.start()
        }
    }
}
