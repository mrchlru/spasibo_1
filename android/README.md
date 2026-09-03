# Спасибо — Android (WebView + FCM)

Нативная оболочка на базе **hearth sdk** (`D:\hearth sdk`): Jetpack Compose + WebView + Splash + FCM.

## Быстрый старт

1. Скопируйте `google-services.json` в `android/app/google-services.json`
2. Откройте папку `android/` в Android Studio
3. **Sync Gradle** → **Build → Rebuild Project** → **Run ▶**

## URL PWA

`https://mrchlru-spasibo-1-stand-2115.twc1.net/`

Задаётся в `app/build.gradle.kts` → `buildConfigField("PWA_URL", ...)`.

## Иконка и splash

- Зелёный фон `#5CA14A`, белая буква **S**
- Splash Screen (core-splashscreen) с тем же логотипом

## Debug

Logcat фильтр: `SpasiboWebView`

Полезные строки после запуска:
- `Initial load: https://...` — URL загрузки
- `React root children=N url=...` — если **N=0**, проблема во фронтенде/JS

Chrome inspect: `chrome://inspect` → WebView «Спасибо»

## Если сборка падает (GradleWorkerMain / ClassNotFoundException)

Частая причина — **кириллица в путях**. На вашей машине это:

- Gradle user home: `C:\Users\Роман\.gradle`
- Gradle JDK: `D:\андроид студио\jbr`

### Исправление в Settings → Build Tools → Gradle

**1. Gradle user home** — замените на путь без кириллицы, например:

```
D:\gradle-home
```

**2. Gradle JDK** — выберите JDK из ASCII-пути. Варианты:

- Скачайте [Temurin JDK 17](https://adoptium.net/) в `D:\Java\jdk-17`
- В **Gradle JDK** → **Add JDK…** → укажите `D:\Java\jdk-17`
- Либо переустановите Android Studio в `D:\AndroidStudio`

**3. После смены путей:**

1. **File → Invalidate Caches → Invalidate and Restart**
2. Удалите папки `android\.gradle`, `android\app\build`, `android\build`
3. **Sync Project with Gradle Files**
4. **Build → Rebuild Project**

### Если ошибка остаётся

Перенесите проект в ASCII-путь, например `C:\dev\MugleHRbotTopManagment\android`.  
OneDrive на время сборки лучше приостановить.
