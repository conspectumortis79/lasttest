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
//   stages[0]: { target: 0,    duration: '30s' }   // 30 s Anlauf / Pause
//   stages[1]: { target: 200,  duration: '2m'  }   // Rampe auf 200 VUs in 2 m
//   stages[2]: { target: 200,  duration: '5m'  }   // Plateau
//   stages[3]: { target: 0,    duration: '30s' }   // sauberer Abbau
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
         * Akzeptiert sowohl `RAMPING_VUS` (Enum-Konstante) als auch
         * `ramping-vus` (kebab-case, executor-Name aus k6) beim
         * Deserialisieren. Das Frontend sendet kebab-case, alte Clients
         * könnten den Enum-Namen senden — beides funktioniert.
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
    val operations: List<TestRunOperationConfiguration>,
)

data class TestRunOperationConfiguration(
    val operationId: String,
    val method: String,
    val path: String,
    val summary: String,
    val parameterValues: List<ParameterValue>,
    val requestBodyJson: String?,
    val bearerTokenConfigured: Boolean,
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
    val error: String? = null,
)
