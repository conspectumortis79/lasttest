package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunConfiguration

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
