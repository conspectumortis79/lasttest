FROM eclipse-temurin:25-jdk AS backend-build
WORKDIR /workspace
COPY backend .
RUN ./gradlew bootJar --no-daemon

FROM node:22-alpine AS frontend-build
WORKDIR /workspace
COPY frontend/package*.json ./
RUN npm install
COPY frontend .
RUN npm run build

FROM grafana/k6:latest AS k6
FROM eclipse-temurin:25-jre
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6
COPY --from=backend-build /workspace/build/libs/*.jar /app/app.jar
COPY --from=frontend-build /workspace/dist /app/static
ENV LASTTEST_FRONTEND_PATH=/app/static
EXPOSE 8286
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 CMD ["curl", "--fail", "--silent", "http://127.0.0.1:8286/"]
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
