#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
(cd backend && ./gradlew bootRun) &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM
cd frontend
npm install
npm run dev
