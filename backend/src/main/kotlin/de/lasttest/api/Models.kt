package de.lasttest.api

import com.fasterxml.jackson.annotation.JsonInclude

data class LoadStage(
    val target: Int,
    val durationSeconds: Int,
)

data class LoadProfile(
    val type: LoadProfileType,
    val virtualUsers: Int? = null,
    val durationSeconds: Int? = null,
    val iterations: Int? = null,
    val useIterations: Boolean? = null,
    val startVUs: Int? = null,
    val stages: List<LoadStage>? = null,
    val rate: Int? = null,
    val timeUnit: Int? = null,
    val preAllocatedVUs: Int? = null,
    val maxVUs: Int? = null,
    val payloadStrategy: PayloadStrategy? = null,
)

enum class LoadProfileType {
    CONSTANT_VUS,
    SHARED_ITERATIONS,
    RAMPING_VUS,
    CONSTANT_ARRIVAL_RATE,
    ;

    fun executorName(): String =
        when (this) {
            CONSTANT_VUS -> "constant-vus"
            SHARED_ITERATIONS -> "shared-iterations"
            RAMPING_VUS -> "ramping-vus"
            CONSTANT_ARRIVAL_RATE -> "constant-arrival-rate"
        }

    companion object {
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
    val authRequirements: List<AuthRequirement> = emptyList(),
) {
    val bearerAuth: Boolean
        get() =
            authRequirements.any {
                it is AuthRequirement.Bearer ||
                    it is AuthRequirement.OAuth2 ||
                    it is AuthRequirement.OpenIdConnect
            }
}

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
    val payloads: List<OperationPayload> = emptyList(),
    val parameterValues: List<ParameterValue> = emptyList(),
    val requestBodyJson: String? = null,
    val bearerToken: String? = null,
    val basicAuthUsername: String? = null,
    val basicAuthPassword: String? = null,
    val apiKey: String? = null,
    val oauth2Token: String? = null,
    val oidcIdToken: String? = null,
) {
    fun primaryPayload(): OperationPayload =
        payloads.firstOrNull()
            ?: OperationPayload(
                parameterValues = parameterValues,
                requestBodyJson = requestBodyJson,
                bearerToken = bearerToken,
                basicAuthUsername = basicAuthUsername,
                basicAuthPassword = basicAuthPassword,
                apiKey = apiKey,
                oauth2Token = oauth2Token,
                oidcIdToken = oidcIdToken,
            )
}

data class OperationPayload(
    val parameterValues: List<ParameterValue> = emptyList(),
    val requestBodyJson: String? = null,
    val bearerToken: String? = null,
    val basicAuthUsername: String? = null,
    val basicAuthPassword: String? = null,
    val apiKey: String? = null,
    val oauth2Token: String? = null,
    val oidcIdToken: String? = null,
)

data class CreateTestRunRequest(
    val specification: String,
    val baseUrl: String,
    val operationIds: Set<String> = emptySet(),
    val operationConfigurations: List<OperationConfiguration> = emptyList(),
    val loadProfile: LoadProfile? = null,
    @Deprecated("Use loadProfile instead.") val virtualUsers: Int? = null,
    @Deprecated("Use loadProfile instead.") val durationSeconds: Int? = null,
    @Deprecated("Use loadProfile instead.") val useIterations: Boolean? = null,
    val persist: Boolean = true,
)

data class TestRunConfiguration(
    val apiTitle: String,
    val apiVersion: String,
    val baseUrl: String,
    val loadProfile: LoadProfile,
    val payloadStrategy: PayloadStrategy? = null,
    val operations: List<TestRunOperationConfiguration>,
)

data class TestRunOperationConfiguration(
    val operationId: String,
    val method: String,
    val path: String,
    val summary: String,
    val payloads: List<OperationPayload> = emptyList(),
    val parameterValues: List<ParameterValue> = emptyList(),
    val requestBodyJson: String? = null,
    val bearerTokenConfigured: Boolean = false,
    val basicAuthConfigured: Boolean = false,
    val apiKeyConfigured: Boolean = false,
    val oauth2TokenConfigured: Boolean = false,
    val oidcIdTokenConfigured: Boolean = false,
)

enum class TestRunStatus {
    QUEUED,
    RUNNING,
    STOPPING,
    COMPLETED,
    FAILED,
    ABORTED,
    STOPPED,
    ;

    fun isTerminal(): Boolean = this == COMPLETED || this == FAILED || this == ABORTED || this == STOPPED

    fun isCancellable(): Boolean = this == QUEUED || this == RUNNING || this == STOPPING
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
    val consoleOutput: String? = null,
    val error: String? = null,
    val cancelledAt: String? = null,
    val cancelledByForce: Boolean? = null,
    val originalRequest: CreateTestRunRequest? = null,
)
