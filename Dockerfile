# syntax=docker/dockerfile:1.6

# ---------------------------------------------------------------------------
# Stage 1: Backend (Kotlin / Spring Boot)
# ---------------------------------------------------------------------------
# Auf Alpine gewechselt, damit der JDK-Pull ~380 MB kleiner ist und das
# Endimage ~150 MB kleiner wird. `--mount=type=cache` persistiert die
# Gradle-Caches zwischen Builds (BuildKit).
FROM eclipse-temurin:25-jdk-alpine AS backend-build
WORKDIR /workspace

# 1. Build-Skripte + Wrapper zuerst, damit der Dependency-Download ein
#    eigener, stabiler Layer wird. Änderungen an src/ invalidieren ihn nicht.
COPY backend/gradle ./gradle
COPY backend/gradlew backend/gradlew.bat ./
COPY backend/build.gradle.kts backend/settings.gradle.kts backend/gradle.properties ./

# 2. Nur Dependencies auflösen und herunterladen. || true, weil der
#    `dependencies`-Task selbst bei erfolgreichem Download einen
#    Non-Zero-Exit liefern kann, wenn z. B. Konfigurationen ohne
#    verfügbaren Build aufgelöst werden.
RUN --mount=type=cache,target=/root/.gradle/caches \
    --mount=type=cache,target=/root/.gradle/wrapper \
    ./gradlew dependencies --no-daemon > /dev/null 2>&1 || true

# 3. Erst danach den häufig wechselnden Sourcecode + Demo-YAML.
COPY backend/src ./src
COPY demo /demo

# 4. Build mit persistiertem Dependency- und Build-Cache.
RUN --mount=type=cache,target=/root/.gradle/caches \
    --mount=type=cache,target=/root/.gradle/wrapper \
    ./gradlew bootJar --no-daemon --build-cache

# ---------------------------------------------------------------------------
# Stage 2: Frontend (React / Vite / TypeScript)
# ---------------------------------------------------------------------------
# `node:22-alpine` ist bereits minimal. `npm ci` statt `npm install`
# erzwingt strikte Determinismus gegen package-lock.json.
FROM node:22-alpine AS frontend-build
WORKDIR /workspace
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend .
RUN --mount=type=cache,target=/root/.npm \
    npm run build

# ---------------------------------------------------------------------------
# Stage 3: k6-Binary aus offiziellem Image holen
# ---------------------------------------------------------------------------
FROM grafana/k6:latest AS k6

# ---------------------------------------------------------------------------
# Stage 4: Finales Runtime-Image
# ---------------------------------------------------------------------------
# Alpine-JRE statt Ubuntu-JRE (~140 MB kleiner). `apk` statt `apt-get`.
# `gcompat` ist nötig, weil k6 als glibc-Binary ausgeliefert wird,
# Alpine aber musl verwendet. Ohne gcompat bricht der k6-Aufruf mit
# „Not a valid dynamic program“ ab.
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
RUN apk add --no-cache curl gcompat
COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6
COPY --from=backend-build /workspace/build/libs/*.jar /app/app.jar
COPY --from=frontend-build /workspace/dist /app/static
ENV LASTTEST_FRONTEND_PATH=/app/static
EXPOSE 8286
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
    CMD ["curl", "--fail", "--silent", "http://127.0.0.1:8286/"]
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
