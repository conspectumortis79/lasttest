#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

URL="http://localhost:8286/"
TIMEOUT=300

echo "Starte lasttest via docker compose ..."

# Pre-Pull der Images, die docker compose beim ersten Start ohnehin
# ziehen würde. Parallel zum Build gestartet, damit der Netzwerk-Pull
# mit dem Backend-/Frontend-Build überlappt. Pull-Fehler werden
# ignoriert — docker compose versucht es dann selbst nochmal.
(
  for image in \
    "influxdb:1.11" \
    "grafana/grafana:11.2.0" \
    "eclipse-temurin:25-jdk-alpine" \
    "eclipse-temurin:25-jre-alpine" \
    "node:22-alpine" \
    "grafana/k6:latest"; do
    docker pull "$image" >/dev/null 2>&1 &
  done
  wait || true
) &

docker compose up -d --build

# Hintergrund-Pulls abschließen lassen, bevor das Skript endet.
# Exit-Code egal — falls ein Pull fehlgeschlagen ist, hat docker
# compose das bereits selbst nachgeholt.
wait || true

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
