package ru.spasibo.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Периодически подтягивает данные для виджетов, пока они стоят на экране. */
class WidgetRefreshWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!hasAnyWidget(applicationContext)) {
            return Result.success()
        }
        return try {
            WidgetUpdater.refreshAll(applicationContext, fetchRemote = true)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val UNIQUE_NAME = "spasibo_widget_refresh"

        fun ensurePeriodic(context: Context) {
            if (!hasAnyWidget(context)) {
                WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NAME)
                return
            }
            val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(30, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        fun enqueueNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                "${UNIQUE_NAME}_once",
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }

        private fun hasAnyWidget(context: Context): Boolean {
            val manager = AppWidgetManager.getInstance(context)
            val providers = listOf(
                BalanceWidgetProvider::class.java,
                QuickTransferWidgetProvider::class.java,
                TeamsCardWidgetProvider::class.java,
            )
            return providers.any { clazz ->
                manager.getAppWidgetIds(ComponentName(context, clazz)).isNotEmpty()
            }
        }
    }
}
