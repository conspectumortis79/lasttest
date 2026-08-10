package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunConfiguration
import java.time.Instant

/**
 * Maps a persisted [TestRunEntity] back to the API-facing
 * [TestRun] data class. The dashboard and the report expect the
 * wire format, so this conversion is the single source of truth
 * for "how is a row in the database presented to the user?".
 *
 * The original [originalRequest] and [configuration] blobs are
 * deserialised lazily: if the JSON is missing or malformed the
 * entity fields stay null, which the wire layer represents as
 * absent keys. The dashboard tolerates that state (it falls back
 * to a synthesised display name).
 *
 * When [encryptor] is provided, the read path decrypts the two
 * JSON columns before deserialising so the rest of the pipeline
 * (the controller, the report builder, the k6 generator) sees
 * plaintext JSON. Plaintext rows from older builds (no magic
 * prefix on the column) are passed through unchanged by the
 * encryptor's no-op branch, so a fresh deploy with a new key
 * can still read rows written by an older version.
 *
 * Lives at file scope (not as a member of [TestRunEntity]) so the
 * REST controller can call it without pulling the service into
 * the request-handling path; a Jackson [ObjectMapper] and the
 * [TestRunPayloadEncryptor] are injected by the call site.
 */
fun TestRunEntity.toTestRun(
    mapper: ObjectMapper = ObjectMapper(),
    encryptor: TestRunPayloadEncryptor = NoOpTestRunPayloadEncryptor,
): TestRun {
    val configuration =
        encryptor.decrypt(configurationJson)?.let { decrypted ->
            runCatching { mapper.readValue(decrypted, TestRunConfiguration::class.java) }.getOrNull()
        }
    val originalRequest =
        encryptor.decrypt(originalRequestJson)?.let { decrypted ->
            runCatching { mapper.readValue(decrypted, CreateTestRunRequest::class.java) }.getOrNull()
        }
    val summary =
        summaryJson?.let { raw -> mapOf("raw" to raw) }
    return TestRun(
        id = id,
        status = status,
        createdAt = createdAt.toString(),
        startedAt = startedAt?.toString(),
        finishedAt = finishedAt?.toString(),
        exitCode = exitCode,
        configuration = configuration,
        summary = summary,
        consoleOutput = consoleOutput,
        error = error,
        cancelledAt = cancelledAt?.toString(),
        cancelledByForce = cancelledByForce,
        originalRequest = originalRequest,
    )
}

/**
 * Inverse of [toTestRun]: turns an API-facing [TestRun] into a
 * JPA-persistable [TestRunEntity]. Used by
 * [LocalK6TestRunService] to write new runs to H2 so a container
 * restart does not drop the history. The JSON columns mirror
 * what [toTestRun] reads back; the test run survives a full
 * round trip through the database.
 *
 * When [encryptor] is provided, the write path encrypts the
 * two sensitive columns ([configurationJson] and
 * [originalRequestJson]) before they are handed to JPA. The
 * encryption layer detects plaintext on the read path, so
 * switching the property on in an existing deployment does
 * not require a migration: existing rows stay readable, and
 * every new write / rewrite is encrypted in place.
 *
 * Malformed JSON (e.g. an exotic [CreateTestRunRequest] shape
 * Jackson cannot serialise) is swallowed the same way the read
 * path swallows parse errors: the affected column stays null
 * and the rest of the entity is still saved. Losing the
 * originalRequest is recoverable (the run is still listed);
 * losing the whole save is not.
 *
 * Timeline payload stripping
 * ---------------------------
 * The timeline is intentionally payload-free: the write path
 * drops every request dataset (request body, parameter values,
 * auth tokens, …) from the [configuration] snapshot AND from
 * the preserved [originalRequest] before serialisation. The
 * endpoint metadata (method, path, load profile, …) and the
 * `*Configured` boolean flags survive, so the dashboard can
 * still render "what endpoint ran, with what load profile, with
 * auth configured" — but the actual bytes k6 sent never land
 * in the H2 volume. The `originalRequest` is still preserved
 * structurally (operation ids, base URL, load profile) so a
 * historical rerun from the dashboard's right-click still
 * works, just without the custom payload data.
 *
 * A regression that let payload data leak into the columns
 * would surface as "the encrypted column now contains the
 * literal request body" — the existing encryption tests pin
 * the encrypted-blob shape and the dedicated unit tests pin
 * the payload-free shape.
 */
fun TestRun.toTestRunEntity(
    mapper: ObjectMapper = ObjectMapper(),
    encryptor: TestRunPayloadEncryptor = NoOpTestRunPayloadEncryptor,
): TestRunEntity {
    val entity = TestRunEntity()
    entity.id = id
    entity.status = status
    entity.createdAt = Instant.parse(createdAt)
    entity.startedAt = startedAt?.let { Instant.parse(it) }
    entity.finishedAt = finishedAt?.let { Instant.parse(it) }
    entity.exitCode = exitCode
    entity.configurationJson =
        configuration?.let { source ->
            // Strip every per-operation payload field before
            // serialising so the column never carries the
            // request body, parameter values or auth tokens.
            // The endpoint metadata (method, path, summary),
            // the load profile and the `*Configured` flags
            // survive so the timeline can still render
            // "endpoint X with auth Y ran with profile Z".
            val sanitised =
                source.copy(
                    operations =
                        source.operations.map { operation ->
                            operation.copy(
                                payloads = emptyList(),
                                parameterValues = emptyList(),
                                requestBodyJson = null,
                            )
                        },
                )
            val serialised = runCatching { mapper.writeValueAsString(sanitised) }.getOrNull()
            serialised?.let { encryptor.encrypt(it) }
        }
    // `summary` is a free-form `Map<String, Any?>` with a single
    // `raw` key today; persist the raw k6 output as a CLOB so the
    // read path can re-wrap it into a `mapOf("raw" to it)`. Any
    // other shape (or a missing key) is treated as no summary.
    entity.summaryJson = (summary?.get("raw") as? String)
    entity.consoleOutput = consoleOutput
    entity.error = error
    entity.cancelledAt = cancelledAt?.let { Instant.parse(it) }
    entity.cancelledByForce = cancelledByForce
    entity.originalRequestJson =
        originalRequest?.let { source ->
            // Same strip on the request envelope: payload data
            // (pool + legacy flat fields + auth tokens) must
            // NOT survive a container restart. The structural
            // fields (spec, base URL, operation ids, load
            // profile) are preserved so the dashboard's
            // `Erneut starten` action can still reproduce a
            // run — just without the custom payload data.
            val sanitised =
                source.copy(
                    operationConfigurations =
                        source.operationConfigurations.map { configuration ->
                            configuration.copy(
                                payloads = emptyList(),
                                parameterValues = emptyList(),
                                requestBodyJson = null,
                                bearerToken = null,
                                basicAuthUsername = null,
                                basicAuthPassword = null,
                                apiKey = null,
                                oauth2Token = null,
                                oidcIdToken = null,
                            )
                        },
                )
            val serialised = runCatching { mapper.writeValueAsString(sanitised) }.getOrNull()
            serialised?.let { encryptor.encrypt(it) }
        }
    // Flat columns for the per-endpoint × N badge GROUP BY.
    // The configuration is the source of truth, these are a
    // denormalised cache populated at write time. Uses the
    // original (unstripped) configuration so the badge keeps
    // counting the endpoint the run actually targeted — the
    // payload stripping above does not touch the endpoint.
    val firstOp = configuration?.operations?.firstOrNull()
    entity.operationMethod = firstOp?.method
    entity.operationPath = firstOp?.path
    entity.operationId = firstOp?.operationId
    return entity
}
