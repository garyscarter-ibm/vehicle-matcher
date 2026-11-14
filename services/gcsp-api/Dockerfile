# JVM artifact for Render (which has no native Java runtime) and any OCI host.
# Build context is the REPOSITORY ROOT: the pom reads the retained policy data from ../../server/gcsp in place.
# Base images are pinned by digest: Eclipse Temurin 21.0.13+9 on Ubuntu Noble.
FROM eclipse-temurin:21.0.13_9-jdk-noble@sha256:06c1f157dacf6b68198bd9a4186dd4c34ef24e65d7bbbe2a0cf8e62571ad38c9 AS build
# mvnw verifies the pinned Maven zip checksum, so it needs unzip rather than its tar.gz fallback.
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /src/services/gcsp-api
COPY services/gcsp-api/.mvn/ .mvn/
COPY services/gcsp-api/mvnw services/gcsp-api/pom.xml ./
COPY services/gcsp-api/src/ src/
COPY server/gcsp/policy/seed-v1.json /src/server/gcsp/policy/seed-v1.json
COPY server/gcsp/policy/reviewed/ /src/server/gcsp/policy/reviewed/
COPY server/gcsp/predict/records/policy-definitions.json /src/server/gcsp/predict/records/policy-definitions.json
RUN ./mvnw -B package -DskipTests

FROM eclipse-temurin:21.0.13_9-jre-noble@sha256:0d57a8e90c2bb844c5a8e1b2b71e11eff06dad7edcfd803cd21ed4ae203b2515
WORKDIR /app
COPY --from=build /src/services/gcsp-api/target/quarkus-app/ ./
USER 1001
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"
# exec keeps java as PID 1 so Render's SIGTERM reaches it and shutdown is graceful.
CMD ["sh", "-c", "exec java $JAVA_OPTS -jar /app/quarkus-run.jar"]
