package de.lasttest.api

import com.fasterxml.jackson.annotation.JsonInclude

// ---- Load profile ----------------------------------------------------------
//
// A test run is driven by exactly one LoadProfile. The discriminator `type`
// matches the k6 executor name so the generated script is self-documenting
// and the frontend can switch its editor on the same field.
//
// All four shapes live behind a single data class so Jackson can serialise
// the request/response without a custom TypeInfo configuration. Fields that
// are irrelevant for a given `type` are simply null.
//
//   ConstantVUs          → vus + durationSeconds
//   SharedIterations     → vus + iterations
//   RampingVUs           → startVUs + stages
//   ConstantArrivalRate  → rate + timeUnit + durationSeconds + preAllocatedVUs + maxVUs
//
// Stages for RampingVUs encode the k6 stages shape directly:
//   stages[0]: { target: 0,    duration: '30s' }   // 30 s warm-up / pause
//   stages[1]: { target: 200,  duration: '2m'  }   // ramp to 200 VUs in 2 min
//   stages[2]: { target: 200,  duration: '5m'  }   // plateau
//   stages[3]: { target: 0,    duration: '30s' }   // graceful ramp-down
// The frontend presets (smoke, load, stress, spike, soak) translate into
// exactly such a list of stages so the user can edit any of them.

data class LoadStage(
    val target: Int,
    val durationSeconds: Int,
)

data class LoadProfile(
    val type: LoadProfileType,
    // ConstantVUs / SharedIterations / ConstantArrivalRate
    val virtualUsers: Int? = null,
    val durationSeconds: Int? = null,
    val iterations: Int? = null,
    val useIterations: Boolean? = null,
    // RampingVUs
    val startVUs: Int? = null,
    val stages: List<LoadStage>? = null,
    // ConstantArrivalRate
    val rate: Int? = null,
    val timeUnit: Int? = null,
    val preAllocatedVUs: Int? = null,
    val maxVUs: Int? = null,
    /**
     * How the generator picks the next payload from each
     * [OperationConfiguration.payloads] pool on every k6 iteration.
     * `null` (the default) is treated as [PayloadStrategy.SEQUENTIAL] for
     * backward compatibility with clients that pre-date the pool feature.
     */
    val payloadStrategy: PayloadStrategy? = null,
)

enum class LoadProfileType {
    CONSTANT_VUS,
    SHARED_ITERATIONS,
    RAMPING_VUS,
    CONSTANT_ARRIVAL_RATE,
    ;

    /** Lower-case executor name as used inside the generated k6 script. */
    fun executorName(): String =
        when (this) {
            CONSTANT_VUS -> "constant-vus"
            SHARED_ITERATIONS -> "shared-iterations"
            RAMPING_VUS -> "ramping-vus"
            CONSTANT_ARRIVAL_RATE -> "constant-arrival-rate"
        }

    companion object {
        /**
         * Accepts both `RAMPING_VUS` (enum constant) and `ramping-vus`
         * (kebab-case, executor name from k6) when deserializing. The
         * frontend sends kebab-case; older clients may send the enum
         * name — both work.
         */
        @JvmStatic
        @com.fasterxml.jackson.annotation.JsonCreator
        fun fromJson(value: String): LoadProfileType =
            entries.firstOrNull {
                it.executorName().equals(value, ignoreCase = true) || it.name.equals(value, ignoreCase = true)
            } ?: throw IllegalArgumentException(
                "Unbekannter LoadProfileType: $value (erwartet: constant-vus, shared-iterations, ramping-vus, constant-arrival-rate)",
            )
    }
}

/**
 * How the generator picks the next payload from a per-endpoint pool
 * each time k6 runs an iteration. Mirrors the frontend `PayloadStrategy`
 * union so the wire format (`"sequential" | "random"`) is identical on
 * both sides. `null` is treated as `SEQUENTIAL` for backward compatibility
 * — a single-payload pool is identical under both strategies.
 */
enum class PayloadStrategy {
    SEQUENTIAL,
    RANDOM,
    ;

    fun jsonName(): String = name.lowercase()

    companion object {
        @JvmStatic
        @com.fasterxml.jackson.annotation.JsonCreator
        fun fromJson(value: String): PayloadStrategy =
            entries.firstOrNull { it.jsonName() == value.lowercase() }
                ?: throw IllegalArgumentException(
                    "Unbekannte PayloadStrategy: $value (erwartet: sequential, random)",
                )
    }
}

// ---- Existing models -------------------------------------------------------

data class ImportSpecificationRequest(
    val specification: String,
)

data class FetchSpecificationRequest(
    val url: String,
)

data class ImportedSpecification(
    val title: String,
    val version: String,
    val baseUrl: String,
    val operations: List<ApiOperation>,
    val servers: List<ApiServer> = emptyList(),
)

data class FetchedSpecification(
    val content: String,
    val resolvedUrl: String,
    val source: String,
)

data class ApiServer(
    val url: String,
    val description: String? = null,
)

data class ApiOperation(
    val operationId: String,
    val method: String,
    val path: String,
    val summary: String,
    val destructive: Boolean,
    val parameters: List<ApiParameter>,
    val requestBodyExample: Any?,
    val requestBodySchema: RequestBodySchema? = null,
    val hasRequestBody: Boolean = requestBodyExample != null || requestBodySchema != null,
    val requestBodyRequired: Boolean = false,
    val bearerAuth: Boolean = false,
)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class RequestBodySchema(
    val type: String,
    val properties: Map<String, ApiParameterSchema> = emptyMap(),
    val required: List<String> = emptyList(),
)

data class ApiParameter(
    val name: String,
    val location: String,
    val required: Boolean,
    val example: Any?,
    val schema: ApiParameterSchema? = null,
)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class ApiParameterSchema(
    val type: String,
    val format: String? = null,
    val enum: List<String>? = null,
    val minimum: Double? = null,
    val maximum: Double? = null,
    val exclusiveMinimum: Double? = null,
    val exclusiveMaximum: Double? = null,
    val minLength: Int? = null,
    val maxLength: Int? = null,
    val pattern: String? = null,
)

data class ParameterValue(
    val name: String,
    val location: String,
    val value: String,
)

data class OperationConfiguration(
    val operationId: String,
    /**
     * Pool of complete request datasets for this endpoint. The generator
     * picks the next payload from this list on every k6 iteration
     * according to the `payloadStrategy` configured on the [LoadProfile].
     * Empty by default for backward compatibility with clients that still
     * send the legacy flat-field layout below.
     */
    val payloads: List<OperationPayload> = emptyList(),
    /** @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty. */
    val parameterValues: List<ParameterValue> = emptyList(),
    /** @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty. */
    val requestBodyJson: String? = null,
    /** @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty. */
    val bearerToken: String? = null,
) {
    /**
     * Returns the first payload from [payloads], or synthesises one from
     * the legacy flat fields when the pool is empty. This is the single
     * point where pre-pool requests get migrated to the new shape; the
     * generator and the report builder both go through this helper so
     * the two views stay in lockstep.
     */
    fun primaryPayload(): OperationPayload =
        payloads.firstOrNull()
            ?: OperationPayload(
                parameterValues = parameterValues,
                requestBodyJson = requestBodyJson,
                bearerToken = bearerToken,
            )
}

/**
 * One complete request dataset: the parameter overrides, the optional
 * JSON body and the optional bearer token. Multiple
 * [OperationPayload] entries inside a single
 * [OperationConfiguration.payloads] list represent the different
 * datasets a user wants to cycle or pick at random.
 */
data class OperationPayload(
    val parameterValues: List<ParameterValue> = emptyList(),
    val requestBodyJson: String? = null,
    val bearerToken: String? = null,
)

data class CreateTestRunRequest(
    val specification: String,
    val baseUrl: String,
    val operationIds: Set<String> = emptySet(),
    val operationConfigurations: List<OperationConfiguration> = emptyList(),
    /**
     * Drives the k6 executor. When `loadProfile` is null we fall back to
     * the legacy (virtualUsers, durationSeconds, useIterations) triple so
     * older clients keep working until they migrate.
     */
    val loadProfile: LoadProfile? = null,
    @Deprecated("Use loadProfile instead.") val virtualUsers: Int? = null,
    @Deprecated("Use loadProfile instead.") val durationSeconds: Int? = null,
    @Deprecated("Use loadProfile instead.") val useIterations: Boolean? = null,
)

data class TestRunConfiguration(
    val apiTitle: String,
    val apiVersion: String,
    val baseUrl: String,
    val loadProfile: LoadProfile,
    /**
     * Echo of `LoadProfile.payloadStrategy` at the time the run was
     * started, so the report can explain whether the generator cycled
     * through the payload pool or picked at random. `null` means the
     * run was started before the pool feature shipped and the
     * strategy is implicitly `sequential`.
     */
    val payloadStrategy: PayloadStrategy? = null,
    val operations: List<TestRunOperationConfiguration>,
)

data class TestRunOperationConfiguration(
    val operationId: String,
    val method: String,
    val path: String,
    val summary: String,
    /**
     * All payloads that were configured for this endpoint at the time
     * the run was started. The report lists every entry so the user
     * can see exactly which datasets k6 cycled through or picked
     * from. The list is empty for legacy runs that pre-date the pool
     * feature — the report falls back to the flat fields below in
     * that case.
     */
    val payloads: List<OperationPayload> = emptyList(),
    /**
     * Flat-field view of the *first* payload, kept so the report can
     * render single-payload runs without a nested layout. With
     * multiple payloads this is the entry that was actually baked
     * into the static request block; the other entries only show up
     * under [payloads].
     */
    val parameterValues: List<ParameterValue> = emptyList(),
    val requestBodyJson: String? = null,
    val bearerTokenConfigured: Boolean = false,
)

enum class TestRunStatus {
    QUEUED,
    RUNNING,
    COMPLETED,
    FAILED,
}

data class TestRun(
    val id: String,
    val status: TestRunStatus,
    val createdAt: String,
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val exitCode: Int? = null,
    val configuration: TestRunConfiguration? = null,
    val summary: Map<String, Any?>? = null,
    /**
     * Raw (truncated) k6 output for the UI. Populated for both
     * successful and failed runs so that the "k6 console" tab can
     * always be shown. `null` if k6 could not be started at all
     * (see `error`).
     */
    val consoleOutput: String? = null,
    val error: String? = null,
)
