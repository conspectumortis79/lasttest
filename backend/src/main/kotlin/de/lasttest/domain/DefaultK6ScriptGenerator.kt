package de.lasttest.domain

import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.OperationPayload
import de.lasttest.api.ParameterValue
import de.lasttest.api.PayloadStrategy
import de.lasttest.demo.DemoRequestLogInterceptor
import org.springframework.stereotype.Service
import java.net.URLEncoder

interface K6ScriptGenerator {
    fun generateForRun(
        specification: ImportedSpecification,
        baseUrl: String,
        runId: String,
        operationIds: Set<String>,
        operationConfigurations: List<OperationConfiguration>,
        loadProfile: LoadProfile,
    ): String
}

@Service
class DefaultK6ScriptGenerator : K6ScriptGenerator {
    private val objectMapper = ObjectMapper()

    override fun generateForRun(
        specification: ImportedSpecification,
        baseUrl: String,
        runId: String,
        operationIds: Set<String>,
        operationConfigurations: List<OperationConfiguration>,
        loadProfile: LoadProfile,
    ): String {
        require(baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) { "Die Base-URL muss mit http:// oder https:// beginnen." }
        validateLoadProfile(loadProfile)
        val selected = specification.operations.filter { operationIds.isEmpty() || it.operationId in operationIds }
        require(selected.isNotEmpty()) { "Es wurde kein gültiger Endpunkt ausgewählt." }
        val configurations = configurationsByOperationId(operationConfigurations)
        val selectedOperationIds = selected.map(ApiOperation::operationId).toSet()
        require(configurations.keys.all(selectedOperationIds::contains)) { "Die Konfiguration enthält einen nicht ausgewählten oder unbekannten Endpunkt." }

        val strategy = loadProfile.payloadStrategy ?: PayloadStrategy.SEQUENTIAL
        val configurationPoolSizes: Map<String, Int> =
            configurations.mapValues { (_, configuration) -> effectivePayloads(configuration).size }
        val calls =
            selected.joinToString("\n") { operation ->
                requestCode(operation, configurations[operation.operationId], strategy, runId)
            }
        val poolSelectors = collectPoolSelectors(selected, configurations, strategy)
        val counterDeclarations =
            selected
                .joinToString("\n") { operation ->
                    val safe = safeIdentifier(operation.operationId)
                    val tracked =
                        TRACKED_STATUS_CODES.joinToString("\n") { code ->
                            "const lt_status_${code}_$safe = new Counter('lt_status_${code}_$safe');"
                        }
                    val fallback =
                        "const lt_status_err_$safe = new Counter('lt_status_err_$safe');\n" +
                            "const lt_status_other_$safe = new Counter('lt_status_other_$safe');"
                    val payloadCounters =
                        configurationPoolSizes[operation.operationId]?.let { size ->
                            if (size <= 1) {
                                ""
                            } else {
                                (0 until size).joinToString("\n") { index ->
                                    "const lt_payload_${index}_$safe = new Counter('lt_payload_${index}_$safe');"
                                }
                            }
                        } ?: ""
                    listOf(tracked, fallback, payloadCounters).filter { it.isNotEmpty() }.joinToString("\n")
                }
        val scenarioConfig = renderScenario(loadProfile)
        return """
            import http from 'k6/http';
            import { check, sleep } from 'k6';
            import { Counter } from 'k6/metrics';

            $counterDeclarations

            export const options = {
              scenarios: {
                default: {
                  $scenarioConfig
                  gracefulStop: '0s',
                },
              },
              thresholds: {
                http_req_failed: ['rate<0.05'],
                http_req_duration: ['p(95)<1000'],
              },
            };

            const BASE_URL = __ENV.BASE_URL;

            $poolSelectors

            export default function () {
            $calls
              sleep(1);
            }
            """.trimIndent()
    }

    internal fun renderScenario(profile: LoadProfile): String =
        when (profile.type) {
            LoadProfileType.CONSTANT_VUS -> {
                val vus = profile.virtualUsers ?: error("validateLoadProfile garantiert virtualUsers")
                val duration = profile.durationSeconds ?: error("validateLoadProfile garantiert durationSeconds")
                "executor: 'constant-vus', vus: $vus, duration: '${duration}s',"
            }
            LoadProfileType.SHARED_ITERATIONS -> {
                val vus = profile.virtualUsers ?: error("validateLoadProfile garantiert virtualUsers")
                val iterations = profile.iterations ?: error("validateLoadProfile garantiert iterations")
                "executor: 'shared-iterations', vus: $vus, iterations: $iterations,"
            }
            LoadProfileType.RAMPING_VUS -> {
                val startVUs = profile.startVUs ?: 0
                val stages = profile.stages ?: error("validateLoadProfile garantiert stages")
                val stagesLiteral =
                    stages.joinToString(", ") { stage ->
                        "{ target: ${stage.target}, duration: '${stage.durationSeconds}s' }"
                    }
                "executor: 'ramping-vus', startVUs: $startVUs, stages: [$stagesLiteral],"
            }
            LoadProfileType.CONSTANT_ARRIVAL_RATE -> {
                val rate = profile.rate ?: error("validateLoadProfile garantiert rate")
                val timeUnit = profile.timeUnit ?: error("validateLoadProfile garantiert timeUnit")
                val duration = profile.durationSeconds ?: error("validateLoadProfile garantiert durationSeconds")
                val preAllocated = profile.preAllocatedVUs ?: error("validateLoadProfile garantiert preAllocatedVUs")
                val maxVUs = profile.maxVUs ?: error("validateLoadProfile garantiert maxVUs")
                "executor: 'constant-arrival-rate', rate: $rate, timeUnit: '${timeUnit}s', duration: '${duration}s', preAllocatedVUs: $preAllocated, maxVUs: $maxVUs,"
            }
        }

    internal fun validateLoadProfile(profile: LoadProfile) {
        when (profile.type) {
            LoadProfileType.CONSTANT_VUS -> {
                val vus = requireNotNull(profile.virtualUsers) { "ConstantVUs benötigt virtualUsers." }
                val duration = requireNotNull(profile.durationSeconds) { "ConstantVUs benötigt durationSeconds." }
                require(vus in 1..MAX_VIRTUAL_USERS) { "Virtual Users müssen zwischen 1 und $MAX_VIRTUAL_USERS liegen." }
                require(duration in 1..MAX_DURATION_SECONDS) { "Die Dauer muss zwischen 1 und $MAX_DURATION_SECONDS Sekunden liegen." }
            }
            LoadProfileType.SHARED_ITERATIONS -> {
                val vus = requireNotNull(profile.virtualUsers) { "SharedIterations benötigt virtualUsers." }
                val iterations = requireNotNull(profile.iterations) { "SharedIterations benötigt iterations." }
                require(vus in 1..MAX_VIRTUAL_USERS) { "Virtual Users müssen zwischen 1 und $MAX_VIRTUAL_USERS liegen." }
                require(iterations in 1..MAX_ITERATIONS) { "Iterationen müssen zwischen 1 und $MAX_ITERATIONS liegen." }
            }
            LoadProfileType.RAMPING_VUS -> {
                val startVUs = profile.startVUs ?: 0
                val stages = requireNotNull(profile.stages) { "RampingVUs benötigt stages." }
                require(stages.isNotEmpty()) { "RampingVUs benötigt mindestens eine Stage." }
                require(startVUs in 0..MAX_VIRTUAL_USERS) { "Start-VUs müssen zwischen 0 und $MAX_VIRTUAL_USERS liegen." }
                for ((index, stage) in stages.withIndex()) {
                    require(stage.target in 0..MAX_VIRTUAL_USERS) {
                        "Stage ${index + 1}: Ziel-VUs müssen zwischen 0 und $MAX_VIRTUAL_USERS liegen."
                    }
                    require(stage.durationSeconds in 1..MAX_DURATION_SECONDS) {
                        "Stage ${index + 1}: Dauer muss zwischen 1 und $MAX_DURATION_SECONDS Sekunden liegen."
                    }
                }
            }
            LoadProfileType.CONSTANT_ARRIVAL_RATE -> {
                val rate = requireNotNull(profile.rate) { "ConstantArrivalRate benötigt rate." }
                val timeUnit = requireNotNull(profile.timeUnit) { "ConstantArrivalRate benötigt timeUnit." }
                val duration = requireNotNull(profile.durationSeconds) { "ConstantArrivalRate benötigt durationSeconds." }
                val preAllocated = requireNotNull(profile.preAllocatedVUs) { "ConstantArrivalRate benötigt preAllocatedVUs." }
                val maxVUs = requireNotNull(profile.maxVUs) { "ConstantArrivalRate benötigt maxVUs." }
                require(rate in 1..MAX_RATE) { "Rate muss zwischen 1 und $MAX_RATE Iterationen pro Zeiteinheit liegen." }
                require(timeUnit in 1..60) { "Zeiteinheit muss eine Sekundenzahl zwischen 1 und 60 sein." }
                require(duration in 1..MAX_DURATION_SECONDS) { "Die Dauer muss zwischen 1 und $MAX_DURATION_SECONDS Sekunden liegen." }
                require(preAllocated in 1..MAX_VIRTUAL_USERS) { "preAllocatedVUs muss zwischen 1 und $MAX_VIRTUAL_USERS liegen." }
                require(maxVUs in preAllocated..MAX_VIRTUAL_USERS) { "maxVUs muss ≥ preAllocatedVUs und ≤ $MAX_VIRTUAL_USERS sein." }
            }
        }
    }

    private fun configurationsByOperationId(configurations: List<OperationConfiguration>): Map<String, OperationConfiguration> {
        val grouped = configurations.groupBy(OperationConfiguration::operationId)
        require(grouped.values.none { it.size > 1 }) { "Ein Endpunkt darf nur einmal konfiguriert werden." }
        return grouped.mapValues { (_, values) -> values.single() }
    }

    private fun requestCode(
        operation: ApiOperation,
        configuration: OperationConfiguration?,
        strategy: PayloadStrategy,
        runId: String,
    ): String {
        val payloads = effectivePayloads(configuration)
        val safe = safeIdentifier(operation.operationId)
        if (payloads.size == 1) {
            return singlePayloadRequestBlock(operation, payloads.single(), safe, runId)
        }
        val firstBlock = singlePayloadRequestBlock(operation, payloads[0], safe, runId).trim()
        val firstBranch =
            "  if (__lt_idx_$safe === 0) { lt_payload_0_$safe.add(1); $firstBlock }"
        val subsequentBranches =
            payloads.drop(1).mapIndexed { index, payload ->
                val block = singlePayloadRequestBlock(operation, payload, safe, runId).trim()
                "  else if (__lt_idx_$safe === ${index + 1}) { lt_payload_${index + 1}_$safe.add(1); $block }"
            }
        return "  const __lt_idx_$safe = __lt_next_$safe();\n$firstBranch\n" + subsequentBranches.joinToString("\n")
    }

    private fun collectPoolSelectors(
        selected: List<ApiOperation>,
        configurations: Map<String, OperationConfiguration>,
        strategy: PayloadStrategy,
    ): String =
        selected
            .mapNotNull { operation ->
                val configuration = configurations[operation.operationId] ?: return@mapNotNull null
                val payloads = effectivePayloads(configuration)
                if (payloads.size <= 1) return@mapNotNull null
                renderPoolSelector(safeIdentifier(operation.operationId), payloads.size, strategy)
            }.joinToString("\n\n")

    private fun renderPoolSelector(
        safe: String,
        size: Int,
        strategy: PayloadStrategy,
    ): String =
        when (strategy) {
            PayloadStrategy.SEQUENTIAL ->
                """
                let __lt_idx_$safe = 0;
                function __lt_next_$safe() {
                    const i = __lt_idx_$safe % $size;
                    __lt_idx_$safe++;
                    return i;
                }
                """.trimIndent()
            PayloadStrategy.RANDOM ->
                """
                function __lt_next_$safe() {
                    return Math.floor(Math.random() * $size);
                }
                """.trimIndent()
        }

    private fun effectivePayloads(configuration: OperationConfiguration?): List<OperationPayload> {
        if (configuration == null) return listOf(OperationPayload())
        return configuration.payloads.ifEmpty { listOf(configuration.primaryPayload()) }
    }

    private fun singlePayloadRequestBlock(
        operation: ApiOperation,
        payload: OperationPayload,
        safe: String,
        runId: String,
    ): String {
        val parameterValues = resolveParametersForPayload(operation, payload)
        var path = operation.path
        parameterValues.filter { it.parameter.location == "path" }.forEach {
            path = path.replace("{${it.parameter.name}}", encode(it.value))
        }
        val query =
            parameterValues
                .filter { it.parameter.location == "query" }
                .joinToString("&") { "${encode(it.parameter.name)}=${encode(it.value)}" }
        val url = path + if (query.isEmpty()) "" else "?$query"
        val requestBody = resolveRequestBodyForPayload(operation, payload)
        require(requestBody != null || !operation.requestBodyRequired) { "Der Pflicht-Request-Body für '${operation.operationId}' darf nicht leer sein." }
        val headers = requestHeadersForPayload(operation, parameterValues, payload, requestBody != null, runId)
        val requestOptions =
            linkedMapOf<String, Any>(
                "tags" to
                    linkedMapOf(
                        "operationId" to operation.operationId,
                        "endpoint" to "${operation.method} $url",
                    ),
            ).apply {
                if (headers.isNotEmpty()) {
                    this["headers"] = headers
                }
            }
        val request =
            when (operation.method) {
                "GET" -> "http.get(BASE_URL + ${toJson(url)}, ${toJson(requestOptions)})"
                "DELETE" -> "http.del(BASE_URL + ${toJson(url)}, null, ${toJson(requestOptions)})"
                else -> "http.request(${toJson(operation.method)}, BASE_URL + ${toJson(url)}, ${requestBody?.let { "JSON.stringify(${toJson(it)})" } ?: "null"}, ${toJson(requestOptions)})"
            }
        val statusIncrement =
            buildString {
                appendLine("switch (response.status) {")
                appendLine("  case 0: lt_status_err_$safe.add(1); break;")
                for (code in TRACKED_STATUS_CODES) {
                    appendLine("  case $code: lt_status_${code}_$safe.add(1); break;")
                }
                appendLine("  default: lt_status_other_$safe.add(1);")
                append("}")
            }
        return "{ const response = $request; $statusIncrement check(response, { ${toJson("${operation.operationId} succeeds")}: (r) => r.status >= 200 && r.status < 400 }); }"
    }

    private fun resolveParametersForPayload(
        operation: ApiOperation,
        payload: OperationPayload,
    ): List<ResolvedParameter> {
        val configured = configuredParameters(payload.parameterValues)
        val known = operation.parameters.map(::keyOf).toSet()
        require(configured.keys.all(known::contains)) { "Die Konfiguration für '${operation.operationId}' enthält einen unbekannten Parameter." }
        return operation.parameters.mapNotNull { parameter ->
            val configuredValue = configured[keyOf(parameter)]?.value
            val value = configuredValue ?: parameter.example?.let(::parameterValue) ?: DEFAULT_PARAMETER_VALUE
            if (value.isBlank()) {
                require(!parameter.required) { "Der Pflichtparameter '${parameter.name}' für '${operation.operationId}' darf nicht leer sein." }
                null
            } else {
                ResolvedParameter(parameter, value)
            }
        }
    }

    private fun resolveRequestBodyForPayload(
        operation: ApiOperation,
        payload: OperationPayload,
    ): Any? {
        val requestBodyJson = payload.requestBodyJson ?: return operation.requestBodyExample
        if (requestBodyJson.isBlank()) return null
        return try {
            objectMapper.readValue(requestBodyJson, Any::class.java)
        } catch (exception: JsonProcessingException) {
            throw IllegalArgumentException("Der Request-Body für '${operation.operationId}' ist kein gültiges JSON.", exception)
        }
    }

    private fun requestHeadersForPayload(
        operation: ApiOperation,
        parameterValues: List<ResolvedParameter>,
        payload: OperationPayload,
        hasRequestBody: Boolean,
        runId: String,
    ): Map<String, String> {
        val headers = linkedMapOf<String, String>()
        parameterValues.filter { it.parameter.location == "header" }.forEach { headers[it.parameter.name] = it.value }
        val cookies = parameterValues.filter { it.parameter.location == "cookie" }.joinToString("; ") { "${it.parameter.name}=${encode(it.value)}" }
        if (cookies.isNotEmpty()) {
            headers["Cookie"] = cookies
        }

        if (runId.isNotEmpty()) {
            headers[DemoRequestLogInterceptor.RUN_ID_HEADER] = runId
        }
        val authValue =
            AuthHeaderEncoder.encode(
                operation.authRequirements,
                AuthHeaderEncoder.AuthCredentials(
                    bearerToken = payload.bearerToken,
                    basicUsername = payload.basicAuthUsername,
                    basicPassword = payload.basicAuthPassword,
                    oauth2Token = payload.oauth2Token,
                    oidcIdToken = payload.oidcIdToken,
                ),
            )
        if (authValue != null) {
            headers["Authorization"] = authValue
        }

        val apiKeyHeader = AuthHeaderEncoder.encodeApiKeyHeaderName(operation.authRequirements)
        val apiKeyValue = AuthHeaderEncoder.encodeApiKey(payload.apiKey)
        if (apiKeyHeader != null && apiKeyValue != null) {
            headers[apiKeyHeader] = apiKeyValue
        }
        if (hasRequestBody) {
            headers.putIfAbsent("Content-Type", "application/json")
        }
        return headers
    }

    private fun safeIdentifier(name: String): String {
        val sanitized = name.replace(Regex("[^A-Za-z0-9_$]"), "_")
        return if (sanitized.isEmpty() || sanitized[0].isDigit()) "_$sanitized" else sanitized
    }

    private fun configuredParameters(values: List<ParameterValue>): Map<ParameterKey, ParameterValue> {
        val grouped = values.groupBy(::keyOf)
        require(grouped.values.none { it.size > 1 }) { "Ein Parameter darf je Endpunkt nur einmal konfiguriert werden." }
        return grouped.mapValues { (_, parameters) -> parameters.single() }
    }

    private fun parameterValue(value: Any): String =
        when (value) {
            is Map<*, *>, is Iterable<*>, is Array<*> -> objectMapper.writeValueAsString(value)
            else -> value.toString()
        }

    private fun keyOf(parameter: ApiParameter): ParameterKey = ParameterKey(parameter.location.lowercase(), parameter.name)

    private fun keyOf(parameter: ParameterValue): ParameterKey = ParameterKey(parameter.location.lowercase(), parameter.name)

    private fun toJson(value: Any?): String =
        when (value) {
            null -> "null"
            is Number, is Boolean -> value.toString()
            is Map<*, *> -> value.entries.joinToString(",", "{", "}") { "${toJson(it.key.toString())}:${toJson(it.value)}" }
            is Iterable<*> -> value.joinToString(",", "[", "]") { toJson(it) }
            is Array<*> -> value.joinToString(",", "[", "]") { toJson(it) }
            else -> jsonString(value.toString())
        }

    private fun jsonString(value: String): String =
        buildString {
            append('"')
            value.forEach { character ->
                when (character) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\b' -> append("\\b")
                    '\u000c' -> append("\\f")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> if (character.code < CONTROL_CHARACTER_LIMIT) append("\\u%04x".format(character.code)) else append(character)
                }
            }
            append('"')
        }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")

    private data class ParameterKey(
        val location: String,
        val name: String,
    )

    private data class ResolvedParameter(
        val parameter: ApiParameter,
        val value: String,
    )

    private companion object {
        const val MAX_VIRTUAL_USERS = 30000
        const val MAX_DURATION_SECONDS = 3600
        const val MAX_ITERATIONS = 1_000_000
        const val MAX_RATE = 100_000
        val ALLOWED_TIME_UNITS: Set<Int> = (1..60).toSet()
        const val CONTROL_CHARACTER_LIMIT = 0x20
        const val DEFAULT_PARAMETER_VALUE = "test"

        // Exact HTTP status codes that get a dedicated Counter per
        // operation. Anything not in this list falls into the `other`
        // Counter for that operation so unexpected responses are still
        // visible in the report. `err` (status === 0, e.g. connection
        // refused) is handled separately and is not part of this list.
        val TRACKED_STATUS_CODES =
            listOf(
                200,
                201,
                202,
                204, // 2xx success
                301,
                302,
                304, // 3xx redirect
                400,
                401,
                403,
                404,
                409,
                422,
                429, // 4xx client error
                500,
                502,
                503,
                504, // 5xx server error
            )
    }
}
