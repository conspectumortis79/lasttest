#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

URL="http://localhost:8286/"
TIMEOUT=300

echo "Starte lasttest via docker compose ..."
docker compose up -d --build

echo "Warte auf Container-Healthcheck ..."

elapsed=0
while true; do
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' lasttest 2>/dev/null || echo starting)"
  case "$status" in
    healthy)
      break
      ;;
    unhealthy)
      echo "FEHLER: Container meldet 'unhealthy'." >&2
      docker compose logs --tail=80
      exit 1
      ;;
  esac
  sleep 2
  elapsed=$((elapsed+2))
  if (( elapsed >= TIMEOUT )); then
    echo "FEHLER: Container wurde nicht innerhalb von ${TIMEOUT}s healthy." >&2
    docker compose logs --tail=80
    exit 1
  fi
done

echo
echo "============================================================"
echo "lasttest wurde erfolgreich gestartet."
echo "Jetzt im Browser öffnen: ${URL}"
echo "Zum Beenden: docker compose down"
echo "============================================================"
