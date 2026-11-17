package ru.spasibo.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** Виджет: баланс спасибок и лимит отправок. */
class BalanceWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        WidgetUpdater.paintCached(context)
        WidgetRefreshWorker.enqueueNow(context)
    }

    override fun onEnabled(context: Context) {
        WidgetRefreshWorker.ensurePeriodic(context)
        WidgetRefreshWorker.enqueueNow(context)
    }

    override fun onDisabled(context: Context) {
        WidgetRefreshWorker.ensurePeriodic(context)
    }
}
