package de.lasttest.api

data class ImportSpecificationRequest(
    val specification: String,
)

data class ImportedSpecification(
    val title: String,
    val version: String,
    val baseUrl: String,
    val operations: List<ApiOperation>,
    val servers: List<ApiServer> = emptyList(),
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
    val hasRequestBody: Boolean = requestBodyExample != null,
    val requestBodyRequired: Boolean = false,
    val bearerAuth: Boolean = false,
)

data class ApiParameter(
    val name: String,
    val location: String,
    val required: Boolean,
    val example: Any?,
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
    val virtualUsers: Int = 1,
    val durationSeconds: Int = 10,
)

data class TestRunConfiguration(
    val apiTitle: String,
    val apiVersion: String,
    val baseUrl: String,
    val virtualUsers: Int,
    val durationSeconds: Int,
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
