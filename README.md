# Схема жизнеспособности — Telegram Mini App

Модель бизнес-системы в парадигме System Dynamics (запасы, потоки, контуры
обратной связи, сценарное моделирование), упакованная как Telegram Mini App
с сохранением сценариев на диск сервера.

Сама модель (`web/src/components/SystemModel.jsx`) — это загруженный
исходник `systemmodelv8.jsx` без единой смысловой правки. Вокруг неё —
только обвязка: Telegram SDK, бэкенд для дискового хранения сценариев,
CI/CD.

## Структура репозитория

```
web/                    React + Vite фронтенд (сама модель + Telegram-обвязка)
server/                 Express-бэкенд: отдаёт фронтенд + API /api/scenarios
docs/
  ARCHITECTURE.md        Карта «понятия System Dynamics → код», инварианты
  ROADMAP.md              Куда двигаемся дальше
  CHANGELOG.md            Шаблон описания изменений + журнал
  DEPLOYMENT.md            Секреты, настройка сервера, HTTPS без домена, бот
.github/workflows/ci-cd.yml   Тесты на каждый push, деплой на push в main
```

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

Полная инструкция, включая то, какие ключи (GitHub Secrets) добавить и как
получить HTTPS без покупки домена — в [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).
Коротко: push в `main` → GitHub Actions тестирует → собирает → выкладывает
на сервер по SSH и перезапускает через PM2.

## Прежде чем менять модель или добавлять фичу

1. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — что есть что в терминах
   System Dynamics, и какие инварианты нельзя молча нарушать.
2. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — куда движется проект.
3. [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — шаблон, по которому
   описывается каждое изменение (для чего / почему / почему так / кому
   подойдёт / что ещё затрагивает / по каким метрикам оценивать).
