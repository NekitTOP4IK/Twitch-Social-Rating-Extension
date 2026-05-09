# Twitch Social Rating Extension

Расширение для браузера, которое интегрирует сервис Twitch Social Rating в
интерфейс Twitch.

Twitch Social Rating добавляет контекстный рейтинг пользователей Twitch в рамках
конкретного канала. Расширение показывает рейтинг в карточках пользователей,
позволяет голосовать, управлять локальными алиасами и получать обновления
рейтинга в реальном времени.

## Возможности

- отображение рейтинга пользователя в Twitch user card;
- голосование за пользователей канала;
- live-обновления рейтинга через WebSocket;
- локальные алиасы пользователей;
- синхронизация алиасов с аккаунтом Twitch Social Rating;
- инструменты модерации для владельцев каналов и назначенных модераторов;
- отдельные сборки для Chrome/Chromium и Firefox.

## Поддерживаемые браузеры

- Chrome и Chromium-based браузеры: Manifest V3
- Firefox: Manifest V2

## Требования

- Node.js 20+
- npm

## Установка

```bash
npm install
```

## Локальная разработка

Сборки для разработки используют локальные URL, заданные в `webpack.config.js`:

- API: `http://localhost:8000/api/v1`
- WebSocket: `ws://localhost:8000/api/v1`
- Frontend: `http://localhost:5173`

Сборка для Chrome/Chromium:

```bash
npm run build
```

Сборка для Firefox:

```bash
npm run build:firefox
```

Режим отслеживания изменений:

```bash
npm run watch
npm run watch:firefox
```

После сборки создаются директории:

- `dist-chrome`
- `dist-firefox`

## Загрузка расширения в браузер

Chrome / Chromium:

1. Откройте `chrome://extensions`.
2. Включите Developer mode.
3. Нажмите "Load unpacked".
4. Выберите директорию `dist-chrome`.

Firefox:

1. Откройте `about:debugging#/runtime/this-firefox`.
2. Нажмите "Load Temporary Add-on".
3. Выберите `dist-firefox/manifest.json`.

## Production-Сборки

Production-сборки используют публичные URL Twitch Social Rating из
`webpack.config.js`.

```bash
npm run build:prod
npm run build:prod:firefox
```

Собрать оба варианта:

```bash
npm run build:all:prod
```

## Сборка пакетов для публикации

Создать zip-пакет для Chrome Web Store:

```bash
npm run package:chrome
```

Создать zip-пакет для Firefox:

```bash
npm run package:firefox
```

Собрать оба пакета:

```bash
npm run package:all
```

Артефакты создаются в `web-ext-artifacts/`:

- `twitch-social-rating-chrome-$npm_package_version.zip`
- `twitch-social-rating-firefox-$npm_package_version.zip`

Сборки для публикации используют production backend URL, отключают source maps и
оставляют JavaScript читаемым для проверки в сторах.

## Тесты

Запуск тестов:

```bash
npm test
```

Запуск тестов последовательно:

```bash
npm test -- --runInBand
```

## Структура проекта

- `src/content` - интеграция со страницей Twitch, инъекция UI, алиасы и WebSocket-клиент.
- `src/background` - авторизация, API-запросы, refresh token, валидация сообщений и background scripts.
- `src/popup` - UI popup-окна расширения.
- `tests` - Jest-тесты.
- `scripts` - вспомогательные скрипты для упаковки и подписи.
- `manifest.json` - шаблон Chrome MV3 manifest.
- `manifest.firefox.json` - шаблон Firefox MV2 manifest.

## Участие в разработке

Pull requests, сообщения об ошибках, предложения новых функций и улучшения
документации приветствуются.

Перед отправкой pull request:

1. Сфокусируйте изменения на одной задаче.
2. Запустите `npm test`.
3. Запустите релевантную сборку, обычно `npm run build:prod`.
4. Опишите, что изменилось, зачем это нужно и как это было проверено.

Если изменение связано с безопасностью, не публикуйте технические детали
уязвимости в открытом issue. Создайте минимальный issue или свяжитесь с
мейнтейнерами напрямую.

## Лицензия

Проект распространяется по лицензии MIT. См. [LICENSE](LICENSE).
