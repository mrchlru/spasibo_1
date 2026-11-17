package ru.spasibo.app.widget

/**
 * Кэш данных для виджетов домашнего экрана.
 *
 * @property loggedIn есть ли сохранённая сессия push/login
 * @property balance баланс спасибок
 * @property transfersLeft сколько отправок осталось сегодня
 * @property dailyLimit дневной лимит отправок
 * @property tickets билеты рулетки
 * @property unreadNotifications непрочитанные уведомления
 * @property teamsLinked привязана ли карта Teams Bonus
 * @property teamsBalanceRub баланс карты (строка «123.45»)
 * @property teamsDiscountPercent скидка карты
 * @property updatedAtMs время последнего обновления
 * @property error краткая ошибка загрузки, если есть
 */
data class WidgetSnapshot(
    val loggedIn: Boolean = false,
    val balance: Int = 0,
    val transfersLeft: Int = 0,
    val dailyLimit: Int = 3,
    val tickets: Int = 0,
    val unreadNotifications: Int = 0,
    val teamsLinked: Boolean = false,
    val teamsBalanceRub: String = "",
    val teamsDiscountPercent: Int = 0,
    val updatedAtMs: Long = 0L,
    val error: String = "",
)
