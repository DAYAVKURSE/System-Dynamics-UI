#!/usr/bin/env bash
# Репетиция bootstrap.sh в песочнице: подменяет apt-get/nginx/certbot/pm2/sudo
# и уводит пути nginx во временный каталог, чтобы проверить логику скрипта, не
# имея настоящего сервера. Запускается в CI и локально:
#
#   bash deploy/rehearse.sh
#
# Проверяются обе ветки прав (root и обычный пользователь с sudo), а в каждой:
#   1) чистый сервер, 2) повторный деплой (идемпотентность), 3) нехватка прав.
# Результат не зависит от того, под кем запущена сама репетиция.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() { echo "ПРОВАЛ: $1" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────
# Одна полная репетиция для заданного «пользователя» ($1: 0 = root,
# иначе обычный пользователь, которому доступен sudo).
# ─────────────────────────────────────────────────────────────
rehearse_as() {
  local fake_uid="$1" label="$2"
  local sandbox bin calls
  sandbox="$(mktemp -d)"
  bin="$sandbox/bin"
  calls="$sandbox/calls.log"
  mkdir -p "$bin" "$sandbox/etc/nginx/sites-available" "$sandbox/etc/nginx/sites-enabled"
  : > "$calls"

  stub() {
    local name="$1" body="${2:-}"
    { echo '#!/usr/bin/env bash'
      echo "echo \"$name \$*\" >> \"\$CALLS_FILE\""
      echo "$body"
    } > "$bin/$name"
    chmod +x "$bin/$name"
  }

  stub systemctl
  stub nginx     # в том числе "nginx -t"
  stub pm2
  stub chown     # в песочнице менять владельца не нужно и нельзя

  # id: изображает нужного пользователя. bootstrap.sh зовёт id -u и id -g.
  printf '#!/usr/bin/env bash\necho %s\n' "$fake_uid" > "$bin/id"
  chmod +x "$bin/id"

  # sudo: пропускает свои флаги и выполняет остальное. Важно обработать -n и
  # -E, иначе проверка `sudo -n true` внутри bootstrap.sh получит "exec -n true".
  cat > "$bin/sudo" <<'STUB'
#!/usr/bin/env bash
echo "sudo $*" >> "$CALLS_FILE"
while [ $# -gt 0 ]; do
  case "$1" in
    -n|-E) shift ;;
    -u) shift 2 ;;
    *) break ;;
  esac
done
[ $# -eq 0 ] && exit 0
exec "$@"
STUB
  chmod +x "$bin/sudo"

  # apt-get должен реально «устанавливать»: иначе второй проход снова увидит
  # недостающий пакет, и проверка идемпотентности будет ложной.
  cat > "$bin/apt-get" <<'STUB'
#!/usr/bin/env bash
echo "apt-get $*" >> "$CALLS_FILE"
mode=""
for arg in "$@"; do
  case "$arg" in
    install) mode=install ;;
    -*) ;;
    *)
      if [ "$mode" = install ]; then
        case "$arg" in
          python3-*) ;;  # не даёт одноимённой команды
          nodejs) for c in node npm; do
                    printf '#!/usr/bin/env bash\necho "%s $*" >> "$CALLS_FILE"\n' "$c" > "$STUB_BIN/$c"
                    chmod +x "$STUB_BIN/$c"
                  done ;;
          *) printf '#!/usr/bin/env bash\necho "%s $*" >> "$CALLS_FILE"\n' "$arg" > "$STUB_BIN/$arg"
             chmod +x "$STUB_BIN/$arg" ;;
        esac
      fi
      ;;
  esac
done
exit 0
STUB
  chmod +x "$bin/apt-get"

  # certbot: сначала сертификата нет, после выпуска — есть.
  cat > "$bin/certbot" <<'STUB'
#!/usr/bin/env bash
echo "certbot $*" >> "$CALLS_FILE"
if [ "${1:-}" = "certificates" ]; then
  [ -f "$CERT_MARKER" ] && echo "  Domains: $APP_DOMAIN"
  exit 0
fi
touch "$CERT_MARKER"
exit 0
STUB
  chmod +x "$bin/certbot"

  export CALLS_FILE="$calls"
  export STUB_BIN="$bin"
  export CERT_MARKER="$sandbox/cert-issued"
  export PATH="$bin:$PATH"
  export NGINX_CONF="$sandbox/etc/nginx/sites-available/system-dynamics-ui"
  export NGINX_ENABLED_DIR="$sandbox/etc/nginx/sites-enabled"
  export DEPLOY_PATH="$sandbox/opt/system-dynamics-ui"
  export APP_DOMAIN="203-0-113-42.sslip.io"
  export APP_PORT=3000

  echo "═══ $label · проход 1: чистый сервер ═══"
  bash "$ROOT/deploy/bootstrap.sh" > "$sandbox/pass1.log" 2>&1 || {
    sed 's/^/  /' "$sandbox/pass1.log"; fail "[$label] bootstrap.sh упал на чистом сервере"
  }
  sed 's/^/  /' "$sandbox/pass1.log"

  [ -d "$DEPLOY_PATH/app" ] || fail "[$label] не создан каталог app/"
  [ -d "$DEPLOY_PATH/data/scenarios" ] || fail "[$label] не создан каталог data/scenarios"
  [ -f "$NGINX_CONF" ] || fail "[$label] не записан конфиг nginx"
  grep -q "server_name $APP_DOMAIN;" "$NGINX_CONF" || fail "[$label] в конфиге нет нужного server_name"
  grep -q "proxy_pass http://127.0.0.1:$APP_PORT;" "$NGINX_CONF" || fail "[$label] в конфиге нет proxy_pass"
  # Переменные nginx ($host и т.п.) не должны раскрыться при генерации конфига.
  grep -q 'proxy_set_header Host \$host;' "$NGINX_CONF" || fail "[$label] переменные nginx раскрылись"
  [ -L "$NGINX_ENABLED_DIR/system-dynamics-ui" ] || fail "[$label] сайт не включён симлинком"
  grep -q "certbot --nginx -d $APP_DOMAIN" "$calls" || fail "[$label] не вызван выпуск сертификата"
  grep -q "^nginx -t" "$calls" || fail "[$label] конфиг nginx не проверен через nginx -t"
  if [ "$fake_uid" != "0" ]; then
    grep -q "^sudo " "$calls" || fail "[$label] привилегированные команды шли без sudo"
  fi

  echo "═══ $label · проход 2: повторный деплой (идемпотентность) ═══"
  local conf_before; conf_before="$(sha256sum "$NGINX_CONF")"
  : > "$calls"
  bash "$ROOT/deploy/bootstrap.sh" > "$sandbox/pass2.log" 2>&1 || {
    sed 's/^/  /' "$sandbox/pass2.log"; fail "[$label] bootstrap.sh упал на повторном запуске"
  }
  sed 's/^/  /' "$sandbox/pass2.log"

  [ "$conf_before" = "$(sha256sum "$NGINX_CONF")" ] \
    || fail "[$label] конфиг nginx перезаписан повторно (стёр бы правки certbot)"
  grep -q "certbot --nginx -d" "$calls" && fail "[$label] сертификат перевыпускается на каждый деплой"
  grep -q "apt-get install" "$calls" && fail "[$label] пакеты переустанавливаются на каждый деплой"

  echo "═══ $label · проход 3: не root и sudo не даёт прав ═══"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$bin/sudo"; chmod +x "$bin/sudo"
  printf '#!/usr/bin/env bash\necho 1000\n' > "$bin/id"; chmod +x "$bin/id"
  local out
  out="$(bash "$ROOT/deploy/bootstrap.sh" 2>&1 || true)"
  echo "$out" | grep -q "нужен root или passwordless sudo" \
    || fail "[$label] нет понятной ошибки при нехватке прав (получено: $out)"
  echo "  корректно останавливается с понятным сообщением"

  rm -rf "$sandbox"
  echo
}

# Обе ветки прав — чтобы результат не зависел от того, под кем идёт репетиция
# (локально это обычно root, на раннере GitHub — пользователь runner).
rehearse_as 0 "как root"
rehearse_as 1000 "как обычный пользователь с sudo"

echo "✓ РЕПЕТИЦИЯ ПРОЙДЕНА: bootstrap.sh корректен на чистом сервере,"
echo "  идемпотентен при повторных деплоях и внятно падает без прав —"
echo "  и под root, и под обычным пользователем."
