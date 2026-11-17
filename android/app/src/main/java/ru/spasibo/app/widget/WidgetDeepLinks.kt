package ru.spasibo.app.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import ru.spasibo.app.MainActivity
import ru.spasibo.app.web.SPASIBO_HOME_URL

/** Deep link'и виджетов в PWA (?panel=...). */
object WidgetDeepLinks {
    const val PANEL_HOME = "home"
    const val PANEL_TRANSFER = "transfer"
    const val PANEL_PROFILE = "profile"
    const val PANEL_ROULETTE = "roulette"
    const val PANEL_NOTIFICATIONS = "notifications"

    fun homeUrl(panel: String): String {
        val base = SPASIBO_HOME_URL.trimEnd('/')
        return "$base/?panel=$panel"
    }

    fun openAppPendingIntent(context: Context, panel: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(homeUrl(panel))
            putExtra(MainActivity.EXTRA_OPEN_URL, homeUrl(panel))
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
