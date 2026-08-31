#!/usr/bin/env bash
# Репетиция bootstrap.sh в песочнице: подменяет apt-get/nginx/certbot/pm2 и
# уводит пути nginx во временный каталог, чтобы проверить логику скрипта,
# не имея настоящего сервера. Запускается в CI и локально:
#
#   bash deploy/rehearse.sh
#
# Проверяет два прохода: «чистый сервер» и «повторный деплой» (идемпотентность).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

BIN="$SANDBOX/bin"
mkdir -p "$BIN" "$SANDBOX/etc/nginx/sites-available" "$SANDBOX/etc/nginx/sites-enabled"

# Журнал вызовов — по нему проверяем, что скрипт сделал то, что нужно.
CALLS="$SANDBOX/calls.log"
: > "$CALLS"

stub() {
  local name="$1" body="${2:-}"
  cat > "$BIN/$name" <<STUB
#!/usr/bin/env bash
echo "$name \$*" >> "$CALLS"
$body
STUB
  chmod +x "$BIN/$name"
}

# apt-get должен реально «устанавливать»: иначе второй проход снова увидит
# недостающий пакет, и проверка идемпотентности будет ложной.
cat > "$BIN/apt-get" <<'STUB'
#!/usr/bin/env bash
echo "apt-get $*" >> "$CALLS_FILE"
mode=""
for arg in "$@"; do
  case "$arg" in
    install) mode=install ;;
    -*) ;;
    *)
      if [ "$mode" = install ]; then
        # пакет nodejs даёт команды node и npm, python3-* команд не даёт
        case "$arg" in
          python3-*) ;;
          nodejs) for c in node npm; do printf '#!/usr/bin/env bash\necho "%s $*" >> "$CALLS_FILE"\n' "$c" > "$STUB_BIN/$c"; chmod +x "$STUB_BIN/$c"; done ;;
          *) printf '#!/usr/bin/env bash\necho "%s $*" >> "$CALLS_FILE"\n' "$arg" > "$STUB_BIN/$arg"; chmod +x "$STUB_BIN/$arg" ;;
        esac
      fi
      ;;
  esac
done
exit 0
STUB
chmod +x "$BIN/apt-get"

stub systemctl
stub nginx            # в т.ч. "nginx -t"
stub pm2
stub sudo 'exec "$@"' # запускаем без реальной эскалации привилегий

# certbot: в первом проходе сертификата нет, потом появляется.
cat > "$BIN/certbot" <<'STUB'
#!/usr/bin/env bash
echo "certbot $*" >> "$CALLS_FILE"
if [ "${1:-}" = "certificates" ]; then
  [ -f "$CERT_MARKER" ] && echo "  Domains: $APP_DOMAIN"
  exit 0
fi
touch "$CERT_MARKER"   # имитируем успешный выпуск
exit 0
STUB
chmod +x "$BIN/certbot"

export CALLS_FILE="$CALLS"
export STUB_BIN="$BIN"
export CERT_MARKER="$SANDBOX/cert-issued"
export PATH="$BIN:$PATH"
export NGINX_CONF="$SANDBOX/etc/nginx/sites-available/system-dynamics-ui"
export NGINX_ENABLED_DIR="$SANDBOX/etc/nginx/sites-enabled"
export DEPLOY_PATH="$SANDBOX/opt/system-dynamics-ui"
export APP_DOMAIN="203-0-113-42.sslip.io"
export APP_PORT=3000

fail() { echo "ПРОВАЛ: $1" >&2; exit 1; }

echo "═══ проход 1: чистый сервер ═══"
bash "$ROOT/deploy/bootstrap.sh" > "$SANDBOX/pass1.log" 2>&1 || {
  cat "$SANDBOX/pass1.log"; fail "bootstrap.sh упал на чистом сервере"
}
sed 's/^/  /' "$SANDBOX/pass1.log"

[ -d "$DEPLOY_PATH/app" ] || fail "не создан каталог app/"
[ -d "$DEPLOY_PATH/data/scenarios" ] || fail "не создан каталог data/scenarios"
[ -f "$NGINX_CONF" ] || fail "не записан конфиг nginx"
grep -q "server_name $APP_DOMAIN;" "$NGINX_CONF" || fail "в конфиге нет нужного server_name"
grep -q "proxy_pass http://127.0.0.1:$APP_PORT;" "$NGINX_CONF" || fail "в конфиге нет proxy_pass"
# Переменные nginx ($host и т.п.) не должны раскрыться при генерации.
grep -q 'proxy_set_header Host \$host;' "$NGINX_CONF" || fail "переменные nginx раскрылись при записи конфига"
[ -L "$NGINX_ENABLED_DIR/system-dynamics-ui" ] || fail "сайт не включён симлинком"
grep -q "certbot --nginx -d $APP_DOMAIN" "$CALLS" || fail "не вызван выпуск сертификата"
grep -q "^nginx -t" "$CALLS" || fail "конфиг nginx не проверен через nginx -t"

echo
echo "═══ проход 2: повторный деплой (идемпотентность) ═══"
conf_before="$(sha256sum "$NGINX_CONF")"
: > "$CALLS"
bash "$ROOT/deploy/bootstrap.sh" > "$SANDBOX/pass2.log" 2>&1 || {
  cat "$SANDBOX/pass2.log"; fail "bootstrap.sh упал на повторном запуске"
}
sed 's/^/  /' "$SANDBOX/pass2.log"

[ "$conf_before" = "$(sha256sum "$NGINX_CONF")" ] || fail "конфиг nginx перезаписан повторно (стёр бы правки certbot)"
grep -q "certbot --nginx -d" "$CALLS" && fail "сертификат перевыпускается на каждый деплой"
grep -q "apt-get install" "$CALLS" && fail "пакеты переустанавливаются на каждый деплой"

echo
echo "═══ проход 3: не root и sudo без пароля не даёт ═══"
# Репетиция идёт от root, поэтому непривилегированного пользователя изображаем
# заглушками: id говорит, что мы не root, sudo отказывает (как при отсутствии
# NOPASSWD). Это самый вероятный реальный сбой прав на чужом сервере.
printf '#!/usr/bin/env bash\nexit 1\n' > "$BIN/sudo"; chmod +x "$BIN/sudo"
printf '#!/usr/bin/env bash\necho 1000\n' > "$BIN/id"; chmod +x "$BIN/id"
out="$(bash "$ROOT/deploy/bootstrap.sh" 2>&1 || true)"
echo "$out" | grep -q "нужен root или passwordless sudo" \
  || fail "нет понятной ошибки при отсутствии прав (получено: $out)"
echo "  корректно останавливается с понятным сообщением"
rm -f "$BIN/id"

echo
echo "✓ РЕПЕТИЦИЯ ПРОЙДЕНА: bootstrap.sh корректен на чистом сервере,"
echo "  идемпотентен при повторных деплоях и внятно падает без прав."
