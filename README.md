# Схема жизнеспособности — Telegram Mini App

**Развёрнуто:** https://144-124-240-20.sslip.io — открывается кнопкой у бота
в Telegram. Обновляется автоматически при push в `main`.

Модель бизнес-системы в парадигме System Dynamics (запасы, потоки, контуры
обратной связи, сценарное моделирование), упакованная как Telegram Mini App
с сохранением сценариев на диск сервера.

Ядро — модель `web/src/components/SystemModel.jsx`, выросшая из исходника
`systemmodelv8.jsx`. Расчёты (`simulate`, `adviseFor`, `condK`) остались теми
же по смыслу; сверх них появилось редактирование структуры, OKR с задачами,
условия-выражения и отмена правок — каждое с разбором в
[`docs/CHANGELOG.md`](docs/CHANGELOG.md). Вокруг модели — обвязка: Telegram
SDK, бэкенд для дискового хранения сценариев и напоминаний, CI/CD.

## Структура репозитория

```
web/                    React + Vite фронтенд (сама модель + Telegram-обвязка)
  src/components/SystemModel.jsx  Модель: расчёты, схема, цели, симуляция
  src/components/TasksBoard.jsx   OKR и канбан-доска задач
  src/lib/expr.js        Разбор числовых выражений в условиях (без eval)
  src/lib/history.js     История правок модели: отмена и возврат
  src/storage.js         Хранилище сценариев: сервер → облако Telegram → браузер
server/                 Express-бэкенд: отдаёт фронтенд + API /api/scenarios
deploy/
  bootstrap.sh           Приводит чистый VPS в рабочее состояние (идемпотентно)
  release.sh             Установка зависимостей, перезапуск, health-check
  rehearse.sh            Репетиция bootstrap.sh в песочнице (гоняется в CI)
docs/
  ARCHITECTURE.md        Карта «понятия System Dynamics → код», инварианты
  ROADMAP.md              Куда двигаемся дальше
  CHANGELOG.md            Шаблон описания изменений + журнал
  DEPLOYMENT.md            Секреты и как всё разворачивается
.github/workflows/ci-cd.yml   Тесты на каждый push, деплой на push в main
```

## Где сохраняются сценарии

Слой `web/src/storage.js` выбирает хранилище сам:

1. **диск сервера** — если развёрнут `server/` и задан токен бота;
2. **облако Telegram** (CloudStorage) — если сервера нет или токен не задан;
3. **localStorage** — если приложение открыли вне Telegram.

Вызывающий код одинаковый во всех трёх случаях, в интерфейсе подписано,
куда именно идёт сохранение.

## Быстрый старт (локально)

```bash
npm run install:all
npm run dev:server    # http://localhost:3000
npm run dev:web        # http://localhost:5173 (проксирует /api на :3000)
```

Открыть `http://localhost:5173` в браузере — вне Telegram приложение
работает как обычная веб-страница (Telegram SDK просто не активируется).

## Тесты и сборка

```bash
npm test               # web (vitest + RTL) и server (vitest + supertest)
npm run build           # production-сборка фронтенда → web/dist
```

## Деплой на прод

От человека нужны **два секрета** в GitHub: `SSH_HOST` и `SSH_PASSWORD`
(либо `SSH_PRIVATE_KEY`, если вход по ключу).
Всё остальное деплой делает сам — ставит Node/pm2/nginx, выпускает
HTTPS-сертификат (домен не нужен, используется `sslip.io`), раскладывает
файлы, перезапускает и проверяет, что приложение отвечает.

Подробности — в [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Прежде чем менять модель или добавлять фичу

1. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — что есть что в терминах
   System Dynamics, и какие инварианты нельзя молча нарушать.
2. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — куда движется проект.
3. [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — шаблон, по которому
   описывается каждое изменение (для чего / почему / почему так / кому
   подойдёт / что ещё затрагивает / по каким метрикам оценивать).
