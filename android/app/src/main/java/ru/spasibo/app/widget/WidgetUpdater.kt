package ru.spasibo.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.view.View
import android.widget.RemoteViews
import ru.spasibo.app.R

/** Paints and refreshes all Spasibo home-screen widgets. */
object WidgetUpdater {
    fun refreshAll(context: Context, fetchRemote: Boolean = true) {
        val appContext = context.applicationContext
        val store = WidgetSnapshotStore(appContext)
        val snapshot = if (fetchRemote) {
            val fresh = WidgetDataFetcher.fetch(appContext)
            store.save(fresh)
            fresh
        } else {
            store.read()
        }
        paintAll(appContext, snapshot)
        WidgetRefreshWorker.ensurePeriodic(appContext)
    }

    fun paintCached(context: Context) {
        paintAll(context.applicationContext, WidgetSnapshotStore(context).read())
    }

    private fun paintAll(context: Context, snapshot: WidgetSnapshot) {
        val manager = AppWidgetManager.getInstance(context)
        updateProvider(context, manager, BalanceWidgetProvider::class.java) { id ->
            buildBalanceViews(context, snapshot, id)
        }
        updateProvider(context, manager, QuickTransferWidgetProvider::class.java) { id ->
            buildQuickTransferViews(context, snapshot, id)
        }
        updateProvider(context, manager, TeamsCardWidgetProvider::class.java) { id ->
            buildTeamsCardViews(context, snapshot, id)
        }
    }

    private fun updateProvider(
        context: Context,
        manager: AppWidgetManager,
        clazz: Class<*>,
        builder: (widgetId: Int) -> RemoteViews,
    ) {
        val ids = manager.getAppWidgetIds(ComponentName(context, clazz))
        if (ids.isEmpty()) {
            return
        }
        ids.forEach { id ->
            manager.updateAppWidget(id, builder(id))
        }
    }

    private fun buildBalanceViews(context: Context, snapshot: WidgetSnapshot, widgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_balance)
        if (!snapshot.loggedIn) {
            views.setTextViewText(R.id.widget_balance_value, "—")
            views.setTextViewText(R.id.widget_balance_subtitle, "Войдите в «Спасибо»")
            views.setTextViewText(R.id.widget_balance_meta, "")
        } else {
            views.setTextViewText(R.id.widget_balance_value, snapshot.balance.toString())
            views.setTextViewText(
                R.id.widget_balance_subtitle,
                "Отправок сегодня: ${snapshot.transfersLeft}/${snapshot.dailyLimit}",
            )
            val metaParts = mutableListOf<String>()
            if (snapshot.tickets > 0) {
                metaParts.add("Билеты: ${snapshot.tickets}")
            }
            if (snapshot.unreadNotifications > 0) {
                metaParts.add("Уведомления: ${snapshot.unreadNotifications}")
            }
            if (snapshot.error.isNotBlank()) {
                metaParts.add(snapshot.error)
            }
            views.setTextViewText(R.id.widget_balance_meta, metaParts.joinToString(" · "))
        }
        views.setOnClickPendingIntent(
            R.id.widget_balance_root,
            WidgetDeepLinks.openAppPendingIntent(
                context,
                WidgetDeepLinks.PANEL_PROFILE,
                requestCode = 1000 + widgetId,
            ),
        )
        return views
    }

    private fun buildQuickTransferViews(
        context: Context,
        snapshot: WidgetSnapshot,
        widgetId: Int,
    ): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_quick_transfer)
        val subtitle = when {
            !snapshot.loggedIn -> "Сначала войдите в приложение"
            snapshot.transfersLeft <= 0 -> "Лимит на сегодня исчерпан"
            else -> "Осталось ${snapshot.transfersLeft} из ${snapshot.dailyLimit}"
        }
        views.setTextViewText(R.id.widget_transfer_subtitle, subtitle)
        views.setOnClickPendingIntent(
            R.id.widget_transfer_root,
            WidgetDeepLinks.openAppPendingIntent(
                context,
                WidgetDeepLinks.PANEL_TRANSFER,
                requestCode = 2000 + widgetId,
            ),
        )
        return views
    }

    private fun buildTeamsCardViews(
        context: Context,
        snapshot: WidgetSnapshot,
        widgetId: Int,
    ): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_teams_card)
        when {
            !snapshot.loggedIn -> {
                views.setTextViewText(R.id.widget_teams_balance, "—")
                views.setTextViewText(R.id.widget_teams_subtitle, "Войдите в «Спасибо»")
                views.setViewVisibility(R.id.widget_teams_discount, View.GONE)
            }
            !snapshot.teamsLinked -> {
                views.setTextViewText(R.id.widget_teams_balance, "—")
                views.setTextViewText(R.id.widget_teams_subtitle, "Карта ещё не привязана")
                views.setViewVisibility(R.id.widget_teams_discount, View.GONE)
            }
            else -> {
                val balance = snapshot.teamsBalanceRub.ifBlank { "0" }
                views.setTextViewText(R.id.widget_teams_balance, "$balance ₽")
                views.setTextViewText(R.id.widget_teams_subtitle, "Teams Bonus")
                if (snapshot.teamsDiscountPercent > 0) {
                    views.setViewVisibility(R.id.widget_teams_discount, View.VISIBLE)
                    views.setTextViewText(
                        R.id.widget_teams_discount,
                        "Скидка ${snapshot.teamsDiscountPercent}%",
                    )
                } else {
                    views.setViewVisibility(R.id.widget_teams_discount, View.GONE)
                }
            }
        }
        if (snapshot.error.isNotBlank() && snapshot.loggedIn) {
            views.setTextViewText(R.id.widget_teams_subtitle, snapshot.error)
        }
        views.setOnClickPendingIntent(
            R.id.widget_teams_root,
            WidgetDeepLinks.openAppPendingIntent(
                context,
                WidgetDeepLinks.PANEL_HOME,
                requestCode = 3000 + widgetId,
            ),
        )
        return views
    }
}
