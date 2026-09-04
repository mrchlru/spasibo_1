package ru.spasibo.app.push

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import ru.spasibo.app.MainActivity
import ru.spasibo.app.web.SPASIBO_HOME_URL

/** Приём FCM-сообщений для «Спасибо». */
class SpasiboFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        PushSessionStore(applicationContext).saveFcmToken(token)
        PushRegistrar.registerIfPossible(applicationContext)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = data["title"] ?: message.notification?.title ?: getString(ru.spasibo.app.R.string.app_name)
        val body = data["body"] ?: message.notification?.body ?: ""
        val url = data["url"]?.takeIf { it.isNotBlank() } ?: SPASIBO_HOME_URL

        Log.i(MainActivity.LOG_TAG, "FCM message: url=$url title=$title")
        NotificationHelper.show(applicationContext, title, body, url)
    }
}
