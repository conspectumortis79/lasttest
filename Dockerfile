# syntax=docker/dockerfile:1.6

# ---------------------------------------------------------------------------
# Stage 1: Backend (Kotlin / Spring Boot)
# ---------------------------------------------------------------------------
# Switched to Alpine so the JDK pull is ~380 MB smaller and the final
# image ~150 MB smaller. `--mount=type=cache` persists the Gradle caches
# across builds (BuildKit).
FROM eclipse-temurin:25-jdk-alpine AS backend-build
WORKDIR /workspace

# 1. Build scripts + wrapper first, so the dependency download becomes
#    its own stable layer. Changes to src/ do not invalidate it.
COPY backend/gradle ./gradle
COPY backend/gradlew backend/gradlew.bat ./
COPY backend/build.gradle.kts backend/settings.gradle.kts backend/gradle.properties ./

# 2. Only resolve and download dependencies. || true because the
#    `dependencies` task can return a non-zero exit even after a
#    successful download, e.g. when configurations are resolved
#    without an available build.
RUN --mount=type=cache,target=/root/.gradle/caches \
    --mount=type=cache,target=/root/.gradle/wrapper \
    ./gradlew dependencies --no-daemon > /dev/null 2>&1 || true

# 3. Only after that, copy the frequently changing source code + demo YAML.
COPY backend/src ./src
COPY demo /demo

# 4. Build with persisted dependency and build cache.
RUN --mount=type=cache,target=/root/.gradle/caches \
    --mount=type=cache,target=/root/.gradle/wrapper \
    ./gradlew bootJar --no-daemon --build-cache

# ---------------------------------------------------------------------------
# Stage 2: Frontend (React / Vite / TypeScript)
# ---------------------------------------------------------------------------
# `node:22-alpine` is already minimal. `npm ci` instead of `npm install`
# enforces strict determinism against package-lock.json.
FROM node:22-alpine AS frontend-build
WORKDIR /workspace
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend .
RUN --mount=type=cache,target=/root/.npm \
    npm run build

# ---------------------------------------------------------------------------
# Stage 3: Pull the k6 binary from the official image
# ---------------------------------------------------------------------------
FROM grafana/k6:latest AS k6

# ---------------------------------------------------------------------------
# Stage 4: Final runtime image
# ---------------------------------------------------------------------------
# Alpine JRE instead of Ubuntu JRE (~140 MB smaller). `apk` instead of
# `apt-get`. `gcompat` is required because k6 ships as a glibc binary,
# while Alpine uses musl. Without gcompat, the k6 invocation fails with
# "Not a valid dynamic program".
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
