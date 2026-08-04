#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

BACKEND_PORT=8286
FRONTEND_PORT=5173
BACKEND_URL="http://localhost:${BACKEND_PORT}/"
FRONTEND_URL="http://localhost:${FRONTEND_PORT}/"
READY_TIMEOUT=300   # Sekunden

is_port_in_use() {
  ss -tln 2>/dev/null | grep -qE "[[:space:]]:${1}[[:space:]]"
}

kill_existing() {
  local ports=("$FRONTEND_PORT" "$BACKEND_PORT")
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

  pkill -f "LasttestApplicationKt"            2>/dev/null || true
  pkill -f "gradlew.*bootRun"                 2>/dev/null || true
  pkill -f "org.springframework.boot.loader"  2>/dev/null || true
  pkill -f "vite"                             2>/dev/null || true
  pkill -f "npm.*run dev"                     2>/dev/null || true
  sleep 1

  for port in "${ports[@]}"; do
    if is_port_in_use "$port"; then
      echo "FEHLER: Port ${port} ist immer noch belegt. Abbruch." >&2
      exit 1
    fi
  done
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
