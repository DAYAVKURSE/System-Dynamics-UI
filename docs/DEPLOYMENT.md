# Деплой: ключи, сервер, HTTPS без домена, бот

Всё, что нужно один раз настроить руками на сервере и в GitHub, чтобы после
этого `git push` в `main` сам тестировал и выкладывал обновления.

## 1. Секреты в GitHub (Settings → Secrets and variables → Actions → New repository secret)

Добавляются в репозитории `DAYAVKURSE/System-Dynamics-UI`. Значения нигде не
коммитятся — сервер получает `TELEGRAM_BOT_TOKEN` через файл `.env`, который
CI генерирует на лету при каждом деплое (см. `.github/workflows/ci-cd.yml`).

| Имя секрета | Что это | Где взять |
|---|---|---|
| `SSH_HOST` | IP или домен сервера | `curl ifconfig.me` на самом сервере, либо панель хостера |
| `SSH_USER` | Пользователь для деплоя | см. шаг 2 ниже — рекомендуется отдельный пользователь `deploy`, не `root` |
| `SSH_PORT` | Порт SSH (если не 22) | необязателен, по умолчанию 22 |
| `SSH_PRIVATE_KEY` | Приватный ключ для деплоя (весь файл, включая `-----BEGIN...-----`/`-----END...-----`) | см. шаг 2 — генерируется отдельно, не личный ключ пользователя |
| `DEPLOY_PATH` | Абсолютный путь на сервере, например `/opt/system-dynamics-ui` (без пробелов в пути) | выбираете сами при выполнении шага 3 |
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather | у вас уже есть (см. п. 3 в переписке) |

**Не вставляйте эти значения в чат с ассистентом надолго** — добавляйте их
прямо в GitHub UI по ссылке выше. Если уже присылали токен в переписке —
после того как всё заработает, стоит сделать `/revoke` токена у @BotFather и
выпустить новый (это бесплатно и мгновенно), чтобы старый нигде не остался
действующим.

## 2. Одноразовая генерация SSH-ключа для деплоя

На своей машине (не на сервере):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./deploy_key -N ""
```

Получится `deploy_key` (приватный — идёт в секрет `SSH_PRIVATE_KEY`) и
`deploy_key.pub` (публичный — идёт на сервер). Публичный ключ добавить на
сервере в `~/.ssh/authorized_keys` пользователя из `SSH_USER` (см. шаг 3).
После того как ключ добавлен в GitHub Secrets, `deploy_key` локально можно
удалить — он больше не нужен на вашей машине.

## 3. Один раз настроить сервер (Ubuntu/Debian; для другого дистрибутива — те же шаги другими командами)

Подключитесь на сервер как обычно (`ssh root@ваш-сервер` или как обычно
логинитесь), дальше — от имени root или через sudo:

```bash
# 3.1 Node.js 20 + утилиты, которые нужны деплою (rsync и curl — обязательны:
#     rsync копирует файлы, curl используется для health-check после перезапуска)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs rsync curl

# 3.2 Отдельный пользователь для деплоя (не root — меньше риска)
sudo adduser --disabled-password --gecos "" deploy
sudo mkdir -p /home/deploy/.ssh
sudo sh -c 'echo "СОДЕРЖИМОЕ deploy_key.pub СЮДА" >> /home/deploy/.ssh/authorized_keys'
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys

# 3.3 Каталоги деплоя — DEPLOY_PATH должен совпадать с секретом DEPLOY_PATH в GitHub
sudo mkdir -p /opt/system-dynamics-ui/app /opt/system-dynamics-ui/data/scenarios
sudo chown -R deploy:deploy /opt/system-dynamics-ui

# 3.4 PM2 глобально (процесс-менеджер для Node без Docker)
sudo npm install -g pm2
# автозапуск pm2-процессов после перезагрузки сервера — выполнить от deploy:
sudo -u deploy pm2 startup systemd -u deploy --hp /home/deploy
# команда выше напечатает ещё одну команду с sudo — выполнить её тоже
```

`SSH_USER=deploy`, `DEPLOY_PATH=/opt/system-dynamics-ui` — эти значения (или
свои, если путь/имя пользователя другие) и идут в GitHub Secrets.

## 4. HTTPS без покупки домена — `sslip.io` + nginx + Let's Encrypt

Telegram Mini Apps требуют HTTPS с доверенным сертификатом (самоподписанный
не подойдёт). Без своего домена самый простой рабочий вариант — публичный
DNS-сервис [sslip.io](https://sslip.io) (аналог nip.io): адрес вида
`1-2-3-4.sslip.io` сам резолвится в IP `1.2.3.4` — никакой покупки домена не
требуется, а Let's Encrypt прекрасно выпускает сертификат на такое имя, потому
что оно реально резолвится в ваш сервер.

```bash
# 4.1 узнать публичный IP сервера
curl ifconfig.me
# допустим, это 203.0.113.42 → домен будет 203-0-113-42.sslip.io

# 4.2 nginx + certbot
sudo apt-get install -y nginx certbot python3-certbot-nginx

# 4.3 конфиг nginx — reverse proxy на Node-процесс (порт 3000, см. ecosystem.config.cjs)
sudo tee /etc/nginx/sites-available/system-dynamics-ui > /dev/null <<'EOF'
server {
    listen 80;
    server_name 203-0-113-42.sslip.io;   # подставить свой IP через дефисы

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/system-dynamics-ui /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 4.4 получить сертификат (certbot сам допишет блок listen 443 в конфиг выше)
sudo certbot --nginx -d 203-0-113-42.sslip.io
```

Certbot сам ставит systemd-таймер на автопродление — руками обновлять не
нужно. Итоговый адрес приложения: `https://203-0-113-42.sslip.io`.

Если позже появится нормальный домен — достаточно поменять `server_name` в
конфиге nginx и перевыпустить сертификат `certbot --nginx -d ваш-домен`,
код приложения трогать не нужно.

## 5. Подключить WebApp к боту (@BotFather)

Токен уже есть, осталось указать боту, куда открывать Mini App:

1. Откройте чат с `@BotFather`, `/mybots` → выберите вашего бота.
2. **Bot Settings → Menu Button → Edit menu button URL** → вставьте
   `https://203-0-113-42.sslip.io` (свой адрес из шага 4). Это даёт кнопку
   рядом с полем ввода сообщения, которая открывает приложение.
3. (Опционально) `/newapp`, если хотите отдельный Direct Link вида
   `t.me/ваш_бот/app` — тоже указывает на тот же HTTPS-адрес.

Первый деплой должен пройти успешно (см. ниже), чтобы по этому адресу
что-то отвечало, прежде чем проверять кнопку в Telegram.

## 6. Как проходит сам деплой (автоматически, после настройки выше)

При каждом push в `main` (а также вручную: Actions → CI/CD → **Run workflow**):

1. Job `test` — ставит зависимости, гоняет тесты (`web` и `server`),
   собирает фронтенд (`vite build`), кладёт результат как build-артефакт.
2. Job `deploy` (только если `test` прошёл и ветка — `main`):
   - **проверяет, заданы ли секреты.** Если нет — job не падает с ошибкой, а
     аккуратно пропускается и пишет в summary прогона, каких секретов не
     хватает. То есть до настройки секретов пуши в `main` будут зелёными;
   - pre-flight по SSH: есть ли на сервере `rsync`, `node`, `npm`, `pm2`,
     `curl` и права на запись в `DEPLOY_PATH` (чтобы упасть с понятным
     сообщением **до** того, как что-то изменится на сервере);
   - собирает деплой-пакет (`server/src` + `server/package.json` +
     `ecosystem.config.cjs` + собранный фронтенд в `public/`);
   - пишет `.env` из секрета `TELEGRAM_BOT_TOKEN` (на сервере кладётся с
     правами `600`);
   - копирует всё на сервер по `rsync --delete` в `${DEPLOY_PATH}/app`
     (каталог с данными `${DEPLOY_PATH}/data` не трогается — он вне `app/`,
     сохранённые сценарии переживают любой редеплой);
   - по SSH ставит прод-зависимости (`npm ci --omit=dev`), перезапускает
     процесс через `pm2 startOrReload` и **проверяет `/api/health`** — если
     приложение не поднялось за 30 секунд, job падает и печатает последние
     50 строк логов pm2.

**Первый деплой:** добавьте секреты (шаг 1), затем либо сделайте любой push в
`main`, либо запустите вручную — Actions → CI/CD → Run workflow → ветка `main`.
Пустой коммит для этого не нужен.

Проверить вручную после первого деплоя:

```bash
curl https://203-0-113-42.sslip.io/api/health   # должно вернуть {"ok":true}
ssh deploy@ваш-сервер "pm2 status"                # процесс system-dynamics-ui online
ssh deploy@ваш-сервер "pm2 logs system-dynamics-ui --lines 50"
```

## 7. Локальная разработка (без сервера/Telegram)

```bash
npm run install:all       # ставит зависимости web/ и server/
npm run dev:server         # backend на :3000 (без TELEGRAM_BOT_TOKEN работает как dev-режим)
npm run dev:web             # frontend на :5173, /api проксируется на :3000
```

Вне Telegram `Telegram.WebApp` просто не появляется — `initTelegram()` тихо
ничего не делает (см. `web/src/telegram.js`), а бэкенд без `X-Telegram-Init-Data`
в dev-режиме (`NODE_ENV!==production`) работает под единым `dev-user`.

## 8. Формат хранения сценариев на диске

```
${DEPLOY_PATH}/data/scenarios/<telegram_user_id>/manifest.json   — список сценариев пользователя
${DEPLOY_PATH}/data/scenarios/<telegram_user_id>/<uuid>.json     — содержимое каждого сценария
```

`id` файлов — всегда сгенерированный сервером UUID (см.
`server/src/lib/scenarioStore.js`), поэтому даже произвольный ввод в URL не
даёт доступа за пределы каталога пользователя.
