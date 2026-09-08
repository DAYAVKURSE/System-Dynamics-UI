#!/usr/bin/env bash
# Освобождает место на сервере и не даёт ему заполняться снова.
#
# Запускается деплоем на каждом обновлении (см. .github/workflows/ci-cd.yml).
# Идемпотентен и безопасен: удаляет только то, что система создаёт заново —
# кэши пакетов, журналы, временные файлы.
#
# ЧЕГО ЭТОТ СКРИПТ НЕ ДЕЛАЕТ НИКОГДА: не трогает ничего внутри
# $DEPLOY_PATH/data — там сценарии, файлы отчётов, записи созвонов, роли,
# общая модель, память и ключи помощника, сообщения групп. Это данные владельца: их удаление — его решение, а не наше,
# и «почистить диск» не должно однажды означать «стереть отчёты». Размер
# этого каталога скрипт только показывает, чтобы владелец решал по цифрам.
#
# Ожидает переменные окружения: DEPLOY_PATH
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:?DEPLOY_PATH не задан}"
DATA_DIR="$DEPLOY_PATH/data"
# На самом первом деплое каталога ещё нет: тогда меряем корень, иначе df
# ошибётся и под pipefail уронит уборку на ровном месте.
DF_PATH="$DEPLOY_PATH"
if [ ! -d "$DF_PATH" ]; then DF_PATH="/"; fi

# Пути вынесены в переменные, чтобы скрипт целиком прогонялся в песочнице
# (см. deploy/rehearse.sh), не трогая настоящий /etc и настоящие кэши.
LOGROTATE_DIR="${LOGROTATE_DIR:-/etc/logrotate.d}"
JOURNALD_DIR="${JOURNALD_DIR:-/etc/systemd/journald.conf.d}"
PM2_LOG_DIR="${PM2_LOG_DIR:-${HOME:-/root}/.pm2/logs}"
TMP_DIR="${TMP_DIR:-/tmp}"
CACHE_DIRS="${CACHE_DIRS:-${HOME:-/root}/.npm/_cacache ${HOME:-/root}/.cache}"
JOURNAL_KEEP="${JOURNAL_KEEP:-100M}"
# Откуда считать «крупнейшее на диске». Отдельной переменной — чтобы
# репетиция не сканировала настоящий корень.
SCAN_ROOT="${SCAN_ROOT:-/}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif sudo -n true 2>/dev/null; then
  SUDO="sudo -n"
else
  echo "уборка пропущена: нужен root или passwordless sudo"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

# Свободно/занято одним числом в килобайтах — чтобы посчитать разницу.
free_kb() { df -Pk "$DF_PATH" 2>/dev/null | awk 'NR==2{print $4}'; }
human()  { awk -v k="${1:-0}" 'BEGIN{
             split("КБ МБ ГБ ТБ", u, " "); i=1;
             while (k >= 1024 && i < 4) { k /= 1024; i++ }
             printf("%.1f %s", k, u[i]) }'; }
size_of() { du -sh "$1" 2>/dev/null | cut -f1; }

before="$(free_kb)"
echo "── уборка диска ──"
df -Ph "$DF_PATH" | awk 'NR==2{printf "было: занято %s из %s, свободно %s\n", $3, $2, $4}'

# Что вообще занимает место: без этого уборка вслепую. Показываем и то, что
# трогать нельзя, — чтобы владелец видел полную картину.
echo "крупнейшее на диске:"
# Сортировка уже ставит крупнейшее вперёд, поэтому ничего не отсеиваем:
# на диске в 10 ГБ каталог на 800 МБ — это ровно то, что надо увидеть.
$SUDO du -xhd2 "$SCAN_ROOT" 2>/dev/null | sort -rh | head -12 | sed 's/^/  /' || true

# 1. Кэш пакетов: apt хранит скачанные .deb после установки.
$SUDO apt-get clean -y >/dev/null 2>&1 || true
# Пакеты, которые больше никому не нужны (в том числе старые ядра — самый
# частый пожиратель гигабайтов на маленьком VPS). Текущее ядро остаётся.
$SUDO apt-get autoremove -y >/dev/null 2>&1 || true
echo "  ✓ кэш apt и ненужные пакеты"

# 2. Системный журнал. Заодно ставим потолок, иначе он вырастет снова.
if command -v journalctl >/dev/null 2>&1; then
  $SUDO journalctl --vacuum-size="$JOURNAL_KEEP" >/dev/null 2>&1 || true
  $SUDO mkdir -p "$JOURNALD_DIR"
  printf '[Journal]\nSystemMaxUse=%s\n' "$JOURNAL_KEEP" \
    | $SUDO tee "$JOURNALD_DIR/99-size.conf" >/dev/null
  echo "  ✓ системный журнал обрезан до $JOURNAL_KEEP и ограничен на будущее"
fi

# 3. Логи pm2. Приложение перезапускалось десятки раз и пишет в лог каждую
#    ошибку опроса Telegram — за месяцы это сотни мегабайт.
if [ -d "$PM2_LOG_DIR" ]; then
  echo "  · логи pm2 занимали $(size_of "$PM2_LOG_DIR")"
  if command -v pm2 >/dev/null 2>&1; then $SUDO pm2 flush >/dev/null 2>&1 || true; fi
  # На случай, если pm2 недоступен: обнуляем файлы, не удаляя их (открытые
  # дескрипторы удалённого файла место не освобождают).
  find "$PM2_LOG_DIR" -type f -name '*.log' -exec sh -c ': > "$1"' _ {} \; 2>/dev/null || true
  $SUDO mkdir -p "$LOGROTATE_DIR"
  $SUDO tee "$LOGROTATE_DIR/pm2-system-dynamics" >/dev/null <<ROTATE
$PM2_LOG_DIR/*.log {
    weekly
    rotate 2
    size 20M
    missingok
    notifempty
    copytruncate
    compress
}
ROTATE
  echo "  ✓ логи pm2 очищены и поставлены на ротацию (не больше 20 МБ)"
fi

# 4. Кэши сборки. npm складывает сюда каждый пакет, который ставил деплой.
for d in $CACHE_DIRS; do
  [ -d "$d" ] || continue
  echo "  · $d занимал $(size_of "$d")"
  $SUDO rm -rf "${d:?}"/* 2>/dev/null || true
done
echo "  ✓ кэши сборки"

# 5. Временные файлы старше недели. Свежие не трогаем: их может держать
#    работающий процесс.
$SUDO find "$TMP_DIR" -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null || true
echo "  ✓ временные файлы старше недели"

after="$(free_kb)"
freed=$(( ${after:-0} - ${before:-0} ))
if [ "$freed" -lt 0 ]; then freed=0; fi
df -Ph "$DF_PATH" | awk 'NR==2{printf "стало: занято %s из %s, свободно %s\n", $3, $2, $4}'
echo "освобождено: $(human "$freed")"

# Данные владельца — только цифрами, чтобы решение принимал он.
if [ -d "$DATA_DIR" ]; then
  echo "данные модели (НЕ тронуты, удаляются только по вашему слову):"
  echo "  всего: $(size_of "$DATA_DIR")"
  for sub in reports scenarios calls workspace org schedules memory assistant chats shares; do
    if [ -d "$DATA_DIR/$sub" ]; then echo "  $sub: $(size_of "$DATA_DIR/$sub")"; fi
  done
  # Записи созвонов — самое крупное из того, что может накопиться.
  recs="$(find "$DATA_DIR/reports" -type f \( -name '*.webm' -o -name '*.mp4' \) 2>/dev/null | wc -l || true)"
  if [ "${recs:-0}" -gt 0 ]; then echo "  из них записей созвонов: $recs"; fi
fi

usage_pct="$(df -P "$DF_PATH" | awk 'NR==2{gsub("%","",$5); print $5}')"
if [ "${usage_pct:-0}" -ge 90 ]; then
  echo "ВНИМАНИЕ: после уборки занято ${usage_pct}% — свободного места всё равно мало."
  echo "Дальше освобождать можно только за счёт данных выше или расширив диск у хостера."
fi
