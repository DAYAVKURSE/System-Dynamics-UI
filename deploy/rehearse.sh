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
  stub claude    # Claude Code «уже стоит»: ставить его в песочнице незачем
  stub chown     # в песочнице менять владельца не нужно и нельзя
  # coturn: ss «видит» 3478; getent резолвит домен в публичный адрес, а
  # hostname -I отдаёт приватный — сервер «за NAT», и ветка external-ip
  # обязана сработать. journalctl нужен только сбойным веткам.
  stub journalctl
  stub ss 'echo "UNCONN 0 0 0.0.0.0:3478 0.0.0.0:*"'
  stub getent 'echo "203.0.113.42 STREAM $2"'
  stub hostname 'echo "10.0.0.5 "'

  # curl тянет установщик nodesource и результат уходит в bash — отдаём no-op.
  printf '#!/usr/bin/env bash\necho "curl $*" >> "$CALLS_FILE"\necho ":"\n' > "$bin/curl"
  chmod +x "$bin/curl"

  # Старый Node на «сервере»: заставляет пройти ветку установки Node.js 20.
  # Без этого ветка не выполнялась бы вовсе (на машине с репетицией Node свежий),
  # и ошибки внутри неё оставались бы незамеченными.
  printf '#!/usr/bin/env bash\n[ "${1:-}" = "-v" ] && echo "v16.20.0"\nexit 0\n' > "$bin/node"
  chmod +x "$bin/node"

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
          coturn) # пакет coturn даёт команду turnserver — по ней bootstrap
                  # понимает на повторном проходе, что ставить уже не надо.
                  printf '#!/usr/bin/env bash\necho "turnserver $*" >> "$CALLS_FILE"\n' > "$STUB_BIN/turnserver"
                  chmod +x "$STUB_BIN/turnserver" ;;
          nodejs) # «установленный» Node уже свежий — на повторном проходе
                  # ветка установки не должна срабатывать снова.
                  printf '#!/usr/bin/env bash\necho "node $*" >> "$CALLS_FILE"\n[ "${1:-}" = "-v" ] && echo "v20.11.0"\nexit 0\n' > "$STUB_BIN/node"
                  printf '#!/usr/bin/env bash\necho "npm $*" >> "$CALLS_FILE"\n' > "$STUB_BIN/npm"
                  chmod +x "$STUB_BIN/node" "$STUB_BIN/npm" ;;
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
  export NGINX_CONFD="$sandbox/etc/nginx/conf.d"
  export DEPLOY_PATH="$sandbox/opt/system-dynamics-ui"
  export APP_DOMAIN="203-0-113-42.sslip.io"
  export APP_PORT=3000
  # Ветка coturn выполняется только с секретом; пути уводим в песочницу,
  # чтобы не трогать настоящий /etc. Файл включения — как в Debian: закомментирован.
  export TURN_SECRET="rehearsal-turn-secret"
  export TURN_CONF="$sandbox/etc/turnserver.conf"
  export TURN_DEFAULT="$sandbox/etc/default/coturn"
  mkdir -p "$sandbox/etc/default"
  echo "#TURNSERVER_ENABLED=1" > "$TURN_DEFAULT"

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
  # Лимиты загрузки: без них запись созвона упирается в 1 МБ nginx (413).
  grep -q "^client_max_body_size 128m;" "$NGINX_CONFD/system-dynamics-ui.conf" 2>/dev/null \
    || fail "[$label] не записан лимит client_max_body_size для nginx"
  grep -q "^proxy_read_timeout 300s;" "$NGINX_CONFD/system-dynamics-ui.conf" \
    || fail "[$label] не записан proxy_read_timeout для nginx"
  grep -q "занято\|не удалось узнать" "$sandbox/pass1.log" || fail "[$label] нет строки о диске"
  grep -q "certbot --nginx -d $APP_DOMAIN" "$calls" || fail "[$label] не вызван выпуск сертификата"
  grep -q "^nginx -t" "$calls" || fail "[$label] конфиг nginx не проверен через nginx -t"
  # Ветка обновления Node должна была отработать целиком: и скачивание
  # установщика nodesource, и установка пакета.
  grep -q "curl .*deb.nodesource.com" "$calls" || fail "[$label] не скачан установщик Node"
  grep -q "apt-get install.*nodejs" "$calls" || fail "[$label] Node.js не установлен"
  grep -q "Node.js 20" "$sandbox/pass1.log" || fail "[$label] ветка установки Node не выполнялась"
  if [ "$fake_uid" != "0" ]; then
    grep -q "^sudo " "$calls" || fail "[$label] привилегированные команды шли без sudo"
  fi
  # coturn: конфиг по секрету, за NAT — с external-ip, служба включена и
  # перезапущена, а «настроен» подтверждён тем, что порт слушается.
  grep -q "apt-get install.*coturn" "$calls" || fail "[$label] coturn не установлен"
  [ -f "$TURN_CONF" ] || fail "[$label] не записан конфиг coturn"
  grep -q "^static-auth-secret=$TURN_SECRET$" "$TURN_CONF" || fail "[$label] в конфиге coturn нет секрета"
  grep -q "^realm=$APP_DOMAIN$" "$TURN_CONF" || fail "[$label] в конфиге coturn нет realm"
  grep -q "^external-ip=203.0.113.42/10.0.0.5$" "$TURN_CONF" || fail "[$label] сервер за NAT, а external-ip не прописан"
  grep -q "^TURNSERVER_ENABLED=1$" "$TURN_DEFAULT" || fail "[$label] coturn не включён в /etc/default/coturn"
  grep -q "systemctl restart coturn" "$calls" || fail "[$label] coturn не перезапущен"
  grep -q "coturn слушает 3478" "$sandbox/pass1.log" || fail "[$label] не подтверждено, что coturn слушает 3478"

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

  echo "═══ $label · проход 2б: coturn не слушает / не запущен / сервер не за NAT ═══"
  # Каждая ветка должна быть видна в логе словами и не ронять деплой.
  local out
  stub ss   # порт никто не слушает
  out="$(bash "$ROOT/deploy/bootstrap.sh" 2>&1)" || fail "[$label] сбой coturn уронил деплой"
  echo "$out" | grep -q "порт 3478 не слушает" \
    || fail "[$label] coturn не слушает порт, а лог молчит"
  stub systemctl '[ "${1:-}" = "is-active" ] && exit 3; exit 0'   # служба лежит
  out="$(bash "$ROOT/deploy/bootstrap.sh" 2>&1)" || fail "[$label] лежащий coturn уронил деплой"
  echo "$out" | grep -q "coturn НЕ ЗАПУЩЕН" \
    || fail "[$label] coturn не запущен, а лог молчит"
  stub systemctl
  stub ss 'echo "UNCONN 0 0 0.0.0.0:3478 0.0.0.0:*"'
  stub hostname 'echo "203.0.113.42 "'   # публичный адрес прямо на интерфейсе
  bash "$ROOT/deploy/bootstrap.sh" >/dev/null 2>&1 || fail "[$label] bootstrap упал без NAT"
  grep -q "^external-ip=" "$TURN_CONF" && fail "[$label] external-ip прописан, хотя сервер не за NAT"
  echo "  сбойные ветки coturn видны в логе и не роняют деплой"

  echo "═══ $label · проход 3: не root и sudo не даёт прав ═══"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$bin/sudo"; chmod +x "$bin/sudo"
  printf '#!/usr/bin/env bash\necho 1000\n' > "$bin/id"; chmod +x "$bin/id"
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

# ─────────────────────────────────────────────────────────────
# Уборка диска (deploy/cleanup.sh). Главное, что здесь проверяется, —
# что данные владельца она не трогает: «почистить диск» не должно однажды
# означать «стереть отчёты и записи созвонов».
# ─────────────────────────────────────────────────────────────
rehearse_cleanup() {
  local fake_uid="$1" label="$2"
  local sandbox bin calls
  sandbox="$(mktemp -d)"
  bin="$sandbox/bin"
  calls="$sandbox/calls.log"
  mkdir -p "$bin"
  : > "$calls"

  stub() {
    local name="$1" body="${2:-}"
    { echo '#!/usr/bin/env bash'
      echo "echo \"$name \$*\" >> \"\$CALLS_FILE\""
      echo "$body"
    } > "$bin/$name"
    chmod +x "$bin/$name"
  }
  stub apt-get
  stub journalctl
  stub pm2

  # id и sudo — как в репетиции bootstrap. Без подставного sudo он сбрасывает
  # PATH (secure_path) и зовёт НАСТОЯЩИЙ apt-get мимо заглушек: локально под
  # root это незаметно, а на раннере GitHub (обычный пользователь с sudo)
  # проверка «кэш apt чистился» разваливалась. Ровно так CI и упал.
  printf '#!/usr/bin/env bash\necho %s\n' "$fake_uid" > "$bin/id"
  chmod +x "$bin/id"
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

  export CALLS_FILE="$calls"
  export PATH="$bin:$PATH"
  export DEPLOY_PATH="$sandbox/opt/system-dynamics-ui"
  export LOGROTATE_DIR="$sandbox/etc/logrotate.d"
  export JOURNALD_DIR="$sandbox/etc/systemd/journald.conf.d"
  export PM2_LOG_DIR="$sandbox/pm2/logs"
  export TMP_DIR="$sandbox/tmp"
  export CACHE_DIRS="$sandbox/cache/npm $sandbox/cache/other"
  export SCAN_ROOT="$sandbox"

  # Данные владельца: их обязано пережить всё.
  mkdir -p "$DEPLOY_PATH/data/reports" "$DEPLOY_PATH/data/scenarios" "$DEPLOY_PATH/data/org"
  echo "запись созвона" > "$DEPLOY_PATH/data/reports/созвон.webm"
  echo "отчёт" > "$DEPLOY_PATH/data/reports/отчёт.pdf"
  echo "модель" > "$DEPLOY_PATH/data/scenarios/модель.json"
  echo "роли" > "$DEPLOY_PATH/data/org/org.json"
  local data_before; data_before="$(find "$DEPLOY_PATH/data" -type f | sort | md5sum)"

  # Мусор: его обязано не стать.
  mkdir -p "$PM2_LOG_DIR" "$TMP_DIR" $CACHE_DIRS
  head -c 200000 /dev/zero > "$PM2_LOG_DIR/app-out.log"
  head -c 100000 /dev/zero > "$sandbox/cache/npm/pkg.tgz"
  head -c 100000 /dev/zero > "$sandbox/cache/other/blob"
  echo "старое" > "$TMP_DIR/старое"; touch -d "30 days ago" "$TMP_DIR/старое"
  echo "свежее" > "$TMP_DIR/свежее"

  echo "═══ уборка ($label) · проход 1 ═══"
  bash "$ROOT/deploy/cleanup.sh" > "$sandbox/clean1.log" 2>&1 || {
    sed 's/^/  /' "$sandbox/clean1.log"; fail "cleanup.sh упал"
  }
  sed 's/^/  /' "$sandbox/clean1.log"

  # 1. Данные целы — это главное.
  [ "$(find "$DEPLOY_PATH/data" -type f | sort | md5sum)" = "$data_before" ] \
    || fail "[$label] уборка тронула данные владельца"
  grep -q "запись созвона" "$DEPLOY_PATH/data/reports/созвон.webm" \
    || fail "запись созвона повреждена"

  # 2. Мусор убран.
  [ -s "$PM2_LOG_DIR/app-out.log" ] && fail "лог pm2 не очищен"
  [ -f "$sandbox/cache/npm/pkg.tgz" ] && fail "кэш npm не очищен"
  [ -f "$sandbox/cache/other/blob" ] && fail "кэш не очищен"
  [ -f "$TMP_DIR/старое" ] && fail "старый временный файл не удалён"
  [ -f "$TMP_DIR/свежее" ] || fail "свежий временный файл удалён, а его мог держать процесс"

  # 3. Заполняться снова не даёт.
  grep -q "SystemMaxUse=" "$JOURNALD_DIR/99-size.conf" || fail "нет потолка системного журнала"
  grep -q "copytruncate" "$LOGROTATE_DIR/pm2-system-dynamics" || fail "нет ротации логов pm2"
  grep -q "apt-get clean" "$calls" || fail "[$label] кэш apt не чистился"
  grep -q "apt-get autoremove" "$calls" || fail "ненужные пакеты не удалялись"

  # 4. Отчёт дочитан до конца: под set -e он обрывался на первой же ложной
  #    проверке — эта строка ловит именно это.
  grep -q "^освобождено:" "$sandbox/clean1.log" || fail "нет строки «освобождено»"
  grep -q "данные модели (НЕ тронуты" "$sandbox/clean1.log" || fail "не показан размер данных"
  grep -q "из них записей созвонов: 1" "$sandbox/clean1.log" || fail "записи созвонов не посчитаны"

  echo "═══ уборка ($label) · проход 2 (на уже убранном) ═══"
  bash "$ROOT/deploy/cleanup.sh" > "$sandbox/clean2.log" 2>&1 || {
    sed 's/^/  /' "$sandbox/clean2.log"; fail "cleanup.sh упал на повторном запуске"
  }
  [ "$(find "$DEPLOY_PATH/data" -type f | sort | md5sum)" = "$data_before" ] \
    || fail "повторная уборка тронула данные владельца"
  echo "  повторный запуск безопасен, данные на месте"

  echo "═══ уборка ($label) · без прав ═══"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$bin/sudo"; chmod +x "$bin/sudo"
  printf '#!/usr/bin/env bash\necho 1000\n' > "$bin/id"; chmod +x "$bin/id"
  local out
  out="$(bash "$ROOT/deploy/cleanup.sh" 2>&1)" || fail "без прав уборка обязана тихо пропускаться"
  echo "$out" | grep -q "уборка пропущена" || fail "без прав нет понятного сообщения"
  echo "  без прав пропускается, а не роняет деплой"

  unset CALLS_FILE DEPLOY_PATH LOGROTATE_DIR JOURNALD_DIR PM2_LOG_DIR TMP_DIR CACHE_DIRS SCAN_ROOT
  rm -rf "$sandbox"
  echo
}

# Под обоими пользователями: под root sudo не участвует вовсе, под обычным —
# через него идут все привилегированные команды.
rehearse_cleanup 0 "как root"
rehearse_cleanup 1000 "как обычный пользователь с sudo"

# ─────────────────────────────────────────────────────────────
# Проверка TURN снаружи (deploy/turn-probe.py): поддельный STUN-сервер
# отвечает — проба видит его; молчит или отвечает чужим id — не видит.
# ─────────────────────────────────────────────────────────────
echo "═══ turn-probe.py: поддельный STUN отвечает / молчит / отвечает чужим id ═══"
probe_dir="$(mktemp -d)"
cat > "$probe_dir/stun.py" <<'FAKESTUN'
import os, socket, struct, sys, threading
out = sys.argv[1]; bad = os.environ.get("BAD_TID") == "1"
u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.bind(("127.0.0.1", 0))
port = u.getsockname()[1]
t = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
t.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); t.bind(("127.0.0.1", port)); t.listen(5)
def reply(req):
    tid = os.urandom(12) if bad else req[8:20]
    return struct.pack("!HHI", 0x0101, 0, 0x2112A442) + tid
def udp():
    while True:
        d, a = u.recvfrom(1500); u.sendto(reply(d), a)
def tcp():
    while True:
        c, _ = t.accept(); d = c.recv(1500); c.sendall(reply(d)); c.close()
threading.Thread(target=udp, daemon=True).start()
threading.Thread(target=tcp, daemon=True).start()
open(out, "w").write(str(port))
threading.Event().wait()
FAKESTUN
stun_pid=""
start_stun() {  # $1 — BAD_TID
  rm -f "$probe_dir/port"
  # Вывод — в /dev/null: иначе фоновый процесс держит трубу того, кто
  # запустил репетицию, и при провале проверки всё зависает вместо падения.
  BAD_TID="$1" python3 "$probe_dir/stun.py" "$probe_dir/port" >/dev/null 2>&1 &
  stun_pid=$!
  for _ in $(seq 1 50); do [ -s "$probe_dir/port" ] && break; sleep 0.1; done
  [ -s "$probe_dir/port" ] || fail "поддельный STUN не поднялся"
  stun_port="$(cat "$probe_dir/port")"
}
stop_stun() {
  [ -n "$stun_pid" ] || return 0
  kill "$stun_pid" 2>/dev/null || true; wait "$stun_pid" 2>/dev/null || true; stun_pid=""
}
# Провал любой проверки ниже не должен оставлять поддельный STUN в живых.
trap stop_stun EXIT

start_stun 0
out="$(TURN_PROBE_TIMEOUT=2 python3 "$ROOT/deploy/turn-probe.py" 127.0.0.1 "$stun_port")" \
  || fail "проба не увидела работающий STUN (получено: $out)"
echo "$out" | grep -q "TURN доступен снаружи" || fail "проба не сказала, что TURN доступен"
echo "$out" | grep -q "tcp — отвечает" || fail "проба не проверила tcp"
stop_stun

if out="$(TURN_PROBE_TIMEOUT=1 python3 "$ROOT/deploy/turn-probe.py" 127.0.0.1 "$stun_port" 2>&1)"; then
  fail "проба «увидела» TURN на закрытом порту"
fi
echo "$out" | grep -q "не отвечает" || fail "проба на закрытом порту не сказала «не отвечает»"

start_stun 1
if TURN_PROBE_TIMEOUT=2 python3 "$ROOT/deploy/turn-probe.py" 127.0.0.1 "$stun_port" >/dev/null 2>&1; then
  stop_stun; fail "проба приняла ответ с чужим transaction id"
fi
stop_stun
rm -rf "$probe_dir"
echo "  проба TURN различает живой STUN, тишину и чужой ответ"
echo

echo "✓ РЕПЕТИЦИЯ ПРОЙДЕНА: bootstrap.sh корректен на чистом сервере,"
echo "  идемпотентен при повторных деплоях и внятно падает без прав —"
echo "  и под root, и под обычным пользователем; coturn настраивается,"
echo "  проверяется и не роняет деплой; проба TURN снаружи честна;"
echo "  уборка диска чистит мусор и не трогает данные владельца."
