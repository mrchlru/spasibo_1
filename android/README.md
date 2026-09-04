# Спасибо — Android (WebView + FCM)

Нативная оболочка на базе **hearth sdk** (`D:\hearth sdk`): Jetpack Compose + WebView + Splash + FCM.

## Быстрый старт

1. Скопируйте `google-services.json` в `android/app/google-services.json`
2. Откройте папку `android/` в Android Studio
3. **Sync Gradle** → **Build → Rebuild Project** → **Run ▶**

## URL PWA

`https://marchelxyz-muglehrbottopmanagment-8f80.twc1.net/`

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

## Release APK (распространение вне Google Play)

Для раздачи через Яндекс.Диск нужен **подписанный release APK** (не debug).

### 1. Keystore (один раз)

В терминале из папки `android/`:

```bash
keytool -genkeypair -v \
  -keystore spasibo-release.keystore \
  -alias spasibo \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype JKS
```

Сохраните пароли и файл `spasibo-release.keystore` — **без них нельзя выпускать обновления** с тем же package id.

### 2. keystore.properties

```bash
cp keystore.properties.example keystore.properties
```

Заполните пароли. Файлы `*.keystore` и `keystore.properties` уже в `.gitignore`.

### 3. Сборка

JDK 17, из папки `android/`:

```bash
export JAVA_HOME="$USERPROFILE/.gradle/jdks/eclipse_adoptium-17-amd64-windows.2"
./gradlew assembleRelease
```

Готовый файл (если настроен `keystore.properties`):

```
D:/gradle-home/spasibo-android-build/outputs/apk/release/app-release.apk
```

Без keystore Gradle соберёт **`app-release-unsigned.apk`** — для раздачи сотрудникам он **не подходит**, нужна подпись (шаги 1–2 выше).

Переименуйте, например: `spasibo-1.0.0.apk`.

### 4. Обновления

Перед каждым новым релизом в `app/build.gradle.kts`:

- `versionCode` — +1 (обязательно для установки поверх старой версии)
- `versionName` — для людей, например `1.0.1`

Подписывайте **тем же keystore**.

### 5. Яндекс.Диск и установка у сотрудников

1. Загрузите APK на Диск, дайте ссылку на скачивание.
2. На телефоне: скачать → открыть файл → «Установить».
3. Если Android блокирует: **Настройки → Безопасность → Установка неизвестных приложений** — разрешить для «Файлы» / браузера, через который открывают APK.

Google Play не нужен. FCM (push) работает и с sideload APK, если `google-services.json` настроен.

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
