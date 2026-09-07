#!/usr/bin/env bash
# Ставит прод-зависимости, перезапускает приложение и убеждается,
# что оно действительно отвечает. Запускается после rsync.
#
# Ожидает переменные окружения: DEPLOY_PATH, APP_PORT
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:?DEPLOY_PATH не задан}"
APP_PORT="${APP_PORT:-3000}"

cd "$DEPLOY_PATH/app"
chmod 600 .env 2>/dev/null || true

echo "── зависимости ──"
npm ci --omit=dev --no-audit --no-fund

echo "── перезапуск ──"
# Мост к Claude Code удалён из ecosystem.config.cjs, но startOrReload
# убранное из конфига приложение не останавливает: на серверах, где он был
# запущен прежним деплоем, процесс жил бы вечно, падая на 404 и засоряя
# логи. Снимаем явно; там, где его не было, команда молча ничего не делает.
pm2 delete claude-bridge >/dev/null 2>&1 || true
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null 2>&1 || true

echo "── health-check ──"
for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
    echo "приложение отвечает"
    exit 0
  fi
  sleep 2
done

echo "ОШИБКА: /api/health не ответил за 30 секунд после перезапуска." >&2
pm2 logs system-dynamics-ui --lines 50 --nostream || true
exit 1
