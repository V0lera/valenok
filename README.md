# Валенок

Карточная игра «Валенок» для телефона: с ботами (без интернета) или с друзьями по коду комнаты.

## Что где лежит

- `www/` — само приложение: `index.html`, `app.js` (правила, боты, интерфейс, онлайн), `net.js` (Firebase), `style.css`, шрифты, иконки.
- `assets/` — исходные картинки для иконки и заставки Android.
- `database.rules.json` — правила безопасности Firebase Realtime Database (вставляются в консоли Firebase → Realtime Database → Rules).
- `.github/workflows/android.yml` — сборка подписанного `Valenok.apk` в GitHub при каждом изменении; готовый файл появляется в Releases.
- `.github/workflows/pages.yml` — веб-версия на GitHub Pages.
- `signing/` — ключ подписи APK. **Не публикуется** (в `.gitignore`). Сохраните копию: без него новые версии не установятся поверх старых.
- `valenok.html` — первая версия игры одним файлом (без онлайна), для истории.

## Как скачать APK

Последняя версия всегда по ссылке `https://github.com/<ваш-логин>/valenok/releases/latest/download/Valenok.apk`.

## Проверка на компьютере

```
python tools/iconsave.py 8780
```
и открыть http://127.0.0.1:8780/ в браузере.
