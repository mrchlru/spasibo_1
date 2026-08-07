# Android push (FCM)

REST API для нативного Android-приложения «Сердце» (WebView + FCM).

## Эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/push/android/config` | `{ "enabled": true/false }` |
| POST | `/push/android/register` | Регистрация FCM-токена (заголовок `X-User-Id`) |
| POST | `/push/android/unregister` | Отключение токена |

Тело `register`:

```json
{
  "token": "fcm-device-token",
  "concept_slug": "moscow-istanbul",
  "device_name": "Samsung Galaxy ..."
}
```

При создании in-app уведомления сервер отправляет **Web Push** и **FCM** параллельно.

## Миграция

```bash
psql $DATABASE_URL -f migrations/017_create_android_fcm_tokens.sql
```

## Переменные окружения (backend)

| Переменная | Описание |
|------------|----------|
| `FCM_ENABLED` | `true` по умолчанию |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON service account Firebase (Admin SDK) целиком |
| `PWA_PUBLIC_BASE_URL` | Базовый URL для deep link в push |

## Android-приложение

1. Создайте проект в Firebase Console с package `ru.hearth.app`.
2. Скачайте `google-services.json` в `hearth sdk/app/` (замените placeholder).
3. Задайте `FIREBASE_SERVICE_ACCOUNT_JSON` на backend после деплоя API.

В веб-приложении мост `window.HearthAndroid` синхронизирует сессию и регистрирует токен после входа и в настройках уведомлений.
