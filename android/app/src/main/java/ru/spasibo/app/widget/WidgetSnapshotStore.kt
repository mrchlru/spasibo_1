package ru.spasibo.app.widget

import android.content.Context

/** Persists last successful widget snapshot for offline paint. */
class WidgetSnapshotStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(snapshot: WidgetSnapshot) {
        prefs.edit()
            .putBoolean(KEY_LOGGED_IN, snapshot.loggedIn)
            .putInt(KEY_BALANCE, snapshot.balance)
            .putInt(KEY_TRANSFERS_LEFT, snapshot.transfersLeft)
            .putInt(KEY_DAILY_LIMIT, snapshot.dailyLimit)
            .putInt(KEY_TICKETS, snapshot.tickets)
            .putInt(KEY_UNREAD, snapshot.unreadNotifications)
            .putBoolean(KEY_TEAMS_LINKED, snapshot.teamsLinked)
            .putString(KEY_TEAMS_BALANCE, snapshot.teamsBalanceRub)
            .putInt(KEY_TEAMS_DISCOUNT, snapshot.teamsDiscountPercent)
            .putLong(KEY_UPDATED_AT, snapshot.updatedAtMs)
            .putString(KEY_ERROR, snapshot.error)
            .apply()
    }

    fun read(): WidgetSnapshot {
        return WidgetSnapshot(
            loggedIn = prefs.getBoolean(KEY_LOGGED_IN, false),
            balance = prefs.getInt(KEY_BALANCE, 0),
            transfersLeft = prefs.getInt(KEY_TRANSFERS_LEFT, 0),
            dailyLimit = prefs.getInt(KEY_DAILY_LIMIT, 3),
            tickets = prefs.getInt(KEY_TICKETS, 0),
            unreadNotifications = prefs.getInt(KEY_UNREAD, 0),
            teamsLinked = prefs.getBoolean(KEY_TEAMS_LINKED, false),
            teamsBalanceRub = prefs.getString(KEY_TEAMS_BALANCE, "").orEmpty(),
            teamsDiscountPercent = prefs.getInt(KEY_TEAMS_DISCOUNT, 0),
            updatedAtMs = prefs.getLong(KEY_UPDATED_AT, 0L),
            error = prefs.getString(KEY_ERROR, "").orEmpty(),
        )
    }

    companion object {
        private const val PREFS = "spasibo_widgets"
        private const val KEY_LOGGED_IN = "logged_in"
        private const val KEY_BALANCE = "balance"
        private const val KEY_TRANSFERS_LEFT = "transfers_left"
        private const val KEY_DAILY_LIMIT = "daily_limit"
        private const val KEY_TICKETS = "tickets"
        private const val KEY_UNREAD = "unread"
        private const val KEY_TEAMS_LINKED = "teams_linked"
        private const val KEY_TEAMS_BALANCE = "teams_balance"
        private const val KEY_TEAMS_DISCOUNT = "teams_discount"
        private const val KEY_UPDATED_AT = "updated_at"
        private const val KEY_ERROR = "error"
    }
}
