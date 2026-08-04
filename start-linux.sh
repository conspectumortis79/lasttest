#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

BACKEND_PORT=8286
FRONTEND_PORT=5173
BACKEND_URL="http://localhost:${BACKEND_PORT}/"
FRONTEND_URL="http://localhost:${FRONTEND_PORT}/"
READY_TIMEOUT=300   # Sekunden

is_port_in_use() {
  # IPv4-Form: 0.0.0.0:8286  /  IPv6-Form: [::]:8286
  # → wir matchen alles, was mit :PORT gefolgt von Whitespace/EOL endet.
  ss -tln 2>/dev/null | grep -qE ":${1}([[:space:]]|$)"
}

# Sammelt alle PIDs der eigenen Prozess-Hierarchie
# (also Skript-PID + alle Vorfahren und Geschwister unter $PPID),
# damit wir uns nicht selbst killen, wenn z.B. das aufrufende Terminal
# den Projektpfad in der cmdline hat.
collect_own_pids() {
  local pid="$PPID"
  local seen=""
  while [[ -n "$pid" && "$pid" != "0" && "$pid" != "1" ]]; do
    if [[ ",$seen," == *",$pid,"* ]]; then break; fi
    seen="${seen:+$seen,}$pid"
    pid=$(awk '/^PPid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null || echo "")
  done
  echo "$seen"
}

# Filter: liefert ein awk-Skript, das Zeilen mit $1 in der PID-Liste überspringt.
exclude_filter() {
  local pids="$1"
  # Baue Regex: ^(PID1|...|PIDn)([[:space:]]|$)
  # pgrep-Output: "PID cmdline..." → PID steht am Zeilenanfang, danach Whitespace.
  local regex
  regex=$(echo "$pids" | tr ',' '\n' | awk '{print "^"$1"([[:space:]]|$)"}' | paste -sd'|' -)
  echo "$regex"
}

# Prüft, ob eine lasttest-Instanz läuft.
# Sucht nach Prozessen, deren cmdline den Projektpfad enthält
# ODER nach bekannten lasttest-Mustern (Spring, Vite aus diesem Projekt).
# Eigener Prozess ($$) und Parent-Hierarchie werden ausgeschlossen.
lasttest_running() {
  local project_dir
  project_dir="$(pwd)"
  local filter
  filter="$(exclude_filter "$(collect_own_pids),$$")"

  # 1) Prozesse, die aus dem lasttest-Projektverzeichnis gestartet wurden
  if pgrep -af -- "$project_dir" 2>/dev/null \
       | grep -vE "$filter" \
       | grep -qE "gradle|java|npm|node|vite"; then
    return 0
  fi

  # 2) Bekannte lasttest-Prozessmuster
  local patterns=(
    "LasttestApplicationKt"
    "lasttest.*bootRun"
    "gradlew.*lasttest"
    "vite.*lasttest"
    "npm.*run dev"
  )
  local p
  for p in "${patterns[@]}"; do
    if pgrep -af "$p" 2>/dev/null \
         | grep -vE "$filter" >/dev/null; then
      return 0
    fi
  done

  return 1
}

list_lasttest_processes() {
  local project_dir
  project_dir="$(pwd)"
  local filter
  filter="$(exclude_filter "$(collect_own_pids),$$")"

  {
    pgrep -af -- "$project_dir" 2>/dev/null \
      | grep -vE "$filter" \
      | grep -E "gradle|java|npm|node|vite" || true
    pgrep -af "LasttestApplicationKt" 2>/dev/null | grep -vE "$filter" || true
    pgrep -af "lasttest.*bootRun"     2>/dev/null | grep -vE "$filter" || true
    pgrep -af "npm.*run dev"          2>/dev/null | grep -vE "$filter" || true
  } | sort -u
}

kill_existing() {
  local ports=("$FRONTEND_PORT" "$BACKEND_PORT")

  # 0) Wenn eine lasttest-Instanz läuft → sichtbar beenden
  if lasttest_running; then
    echo "==> Laufende lasttest-Instanz erkannt:"
    list_lasttest_processes | sed 's/^/    /'
    echo "==> Beende bestehende lasttest-Instanz ..."
  else
    echo "Keine laufende lasttest-Instanz gefunden."
  fi

  # 0a) Docker-Container mit Bezug zu lasttest oder den Ports stoppen
  if command -v docker >/dev/null 2>&1; then
    # Container finden, die "lasttest" im Namen/Image haben
    # oder einen der lasttest-Ports mappen.
    local containers=""
    containers="$(docker ps --format '{{.ID}} {{.Names}} {{.Image}} {{.Ports}}' 2>/dev/null \
      | awk -v p1=":${FRONTEND_PORT}-" -v p2=":${BACKEND_PORT}-" \
            'tolower($0) ~ /lasttest/ \
             || index($0, p1) > 0 \
             || index($0, p2) > 0' \
      | awk '{print $1}' || true)"
    if [[ -n "$containers" ]]; then
      echo "==> Docker-Container mit lasttest-Bezug gefunden:"
      docker ps --format '    {{.ID}}  {{.Names}}  ({{.Image}})  {{.Ports}}' 2>/dev/null \
        | awk -v p1=":${FRONTEND_PORT}-" -v p2=":${BACKEND_PORT}-" \
              'tolower($0) ~ /lasttest/ \
               || index($0, p1) > 0 \
               || index($0, p2) > 0'
      echo "$containers" | xargs -r docker stop 2>&1 | sed 's/^/    /'
      sleep 2
    fi
  fi

  # 1) Ports freigeben (falls belegt)
  for port in "${ports[@]}"; do
    if is_port_in_use "$port"; then
      echo "Port ${port} ist belegt. Versuche freizugeben ..."
      if command -v fuser >/dev/null 2>&1; then
        fuser -k "${port}/tcp" 2>/dev/null || true
        sleep 1
      fi
      if is_port_in_use "$port"; then
        if command -v sudo >/dev/null 2>&1; then
          echo "Brauche Root-Rechte für Port ${port}."
          sudo fuser -k "${port}/tcp" 2>/dev/null || true
          sleep 1
        fi
      fi
    fi
  done

  # 2) Bekannte lasttest-Prozesse gezielt beenden
  pkill -f "LasttestApplicationKt"            2>/dev/null || true
  pkill -f "gradlew.*bootRun"                 2>/dev/null || true
  pkill -f "org.springframework.boot.loader"  2>/dev/null || true
  pkill -f "vite"                             2>/dev/null || true
  pkill -f "npm.*run dev"                     2>/dev/null || true
  pkill -f "lasttest"                         2>/dev/null || true

  # 3) Alles, was noch im Projektverzeichnis werkelt, hart beenden
  local project_dir
  project_dir="$(pwd)"
  local filter
  filter="$(exclude_filter "$(collect_own_pids),$$")"
  local leftovers
  leftovers="$(pgrep -af -- "$project_dir" 2>/dev/null \
               | grep -vE "$filter" \
               | grep -E "gradle|java|npm|node|vite" || true)"
  if [[ -n "$leftovers" ]]; then
    echo "Beende verbleibende Prozesse aus ${project_dir}:"
    echo "$leftovers" | sed 's/^/    /'
    echo "$leftovers" | awk '{print $1}' \
      | xargs -r kill -TERM 2>/dev/null || true
    sleep 2
    leftovers="$(pgrep -af -- "$project_dir" 2>/dev/null \
                 | grep -vE "$filter" \
                 | grep -E "gradle|java|npm|node|vite" || true)"
    if [[ -n "$leftovers" ]]; then
      echo "Erzwinge Beendigung (SIGKILL):"
      echo "$leftovers" | sed 's/^/    /'
      echo "$leftovers" | awk '{print $1}' \
        | xargs -r kill -KILL 2>/dev/null || true
    fi
  fi

  sleep 1

  # 4) Endkontrolle
  for port in "${ports[@]}"; do
    if is_port_in_use "$port"; then
      echo "FEHLER: Port ${port} ist immer noch belegt. Abbruch." >&2
      exit 1
    fi
  done
  if lasttest_running; then
    echo "FEHLER: lasttest-Prozesse laufen noch. Abbruch." >&2
    list_lasttest_processes | sed 's/^/    /' >&2
    exit 1
  fi
  echo "Bestehende lasttest-Instanz(en) beendet."
}

kill_existing

# Beide Services im Hintergrund starten
(cd backend && ./gradlew bootRun) &
backend_pid=$!

(cd frontend && npm install && npm run dev) &
frontend_pid=$!

cleanup() {
  kill "$backend_pid"  2>/dev/null || true
  kill "$frontend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Polling: warten bis beide URLs antworten
echo "Warte auf Backend  (${BACKEND_URL})"
echo "Warte auf Frontend (${FRONTEND_URL})"
echo

backend_ok=0
frontend_ok=0
elapsed=0
while true; do
  if (( backend_ok == 0 )); then
    if curl -sf -o /dev/null --max-time 2 "${BACKEND_URL}"; then
      echo "Backend  ist erreichbar (nach ${elapsed}s)."
      backend_ok=1
    fi
  fi
  if (( frontend_ok == 0 )); then
    if curl -sf -o /dev/null --max-time 2 "${FRONTEND_URL}"; then
      echo "Frontend ist erreichbar (nach ${elapsed}s)."
      frontend_ok=1
    fi
  fi
  if (( backend_ok == 1 && frontend_ok == 1 )); then
    break
  fi
  sleep 1
  elapsed=$((elapsed+1))
  if (( elapsed >= READY_TIMEOUT )); then
    echo "FEHLER: Services wurden nicht innerhalb von ${READY_TIMEOUT}s bereit." >&2
    exit 1
  fi
done

echo
echo "============================================================"
echo "lasttest wurde erfolgreich gestartet."
echo "  Frontend (Vite Dev-Server):  ${FRONTEND_URL}"
echo "  Backend  (Spring-Boot API):  ${BACKEND_URL}"
echo "  Demo-API  zum Testen:        http://localhost:${BACKEND_PORT}/demo-api/products"
echo "Im Browser das Frontend öffnen: ${FRONTEND_URL}"
echo "Zum Beenden: Strg+C drücken."
echo "============================================================"

wait
