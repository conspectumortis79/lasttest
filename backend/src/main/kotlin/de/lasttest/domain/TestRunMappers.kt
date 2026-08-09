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
 * Lives at file scope (not as a member of [TestRunEntity]) so the
 * REST controller can call it without pulling the service into
 * the request-handling path; a Jackson [ObjectMapper] is injected
 * by the call site.
 */
fun TestRunEntity.toTestRun(mapper: ObjectMapper = ObjectMapper()): TestRun {
    val configuration =
        configurationJson?.let {
            runCatching { mapper.readValue(it, TestRunConfiguration::class.java) }.getOrNull()
        }
    val originalRequest =
        originalRequestJson?.let {
            runCatching { mapper.readValue(it, CreateTestRunRequest::class.java) }.getOrNull()
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
 * Malformed JSON (e.g. an exotic [CreateTestRunRequest] shape
 * Jackson cannot serialise) is swallowed the same way the read
 * path swallows parse errors: the affected column stays null
 * and the rest of the entity is still saved. Losing the
 * originalRequest is recoverable (the run is still listed);
 * losing the whole save is not.
 */
fun TestRun.toTestRunEntity(mapper: ObjectMapper = ObjectMapper()): TestRunEntity {
    val entity = TestRunEntity()
    entity.id = id
    entity.status = status
    entity.createdAt = Instant.parse(createdAt)
    entity.startedAt = startedAt?.let { Instant.parse(it) }
    entity.finishedAt = finishedAt?.let { Instant.parse(it) }
    entity.exitCode = exitCode
    entity.configurationJson =
        configuration?.let {
            runCatching { mapper.writeValueAsString(it) }.getOrNull()
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
        originalRequest?.let {
            runCatching { mapper.writeValueAsString(it) }.getOrNull()
        }
    // Flat columns for the per-endpoint × N badge GROUP BY.
    // The configuration is the source of truth, these are a
    // denormalised cache populated at write time.
    val firstOp = configuration?.operations?.firstOrNull()
    entity.operationMethod = firstOp?.method
    entity.operationPath = firstOp?.path
    entity.operationId = firstOp?.operationId
    return entity
}
