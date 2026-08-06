package de.lasttest.domain

import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.ParameterValue
import org.springframework.stereotype.Service
import java.net.URLEncoder

interface K6ScriptGenerator {
    fun generate(
        specification: ImportedSpecification,
        baseUrl: String,
        operationIds: Set<String>,
        operationConfigurations: List<OperationConfiguration>,
        loadProfile: LoadProfile,
    ): String
}

@Service
class DefaultK6ScriptGenerator : K6ScriptGenerator {
    private val objectMapper = ObjectMapper()

    override fun generate(
        specification: ImportedSpecification,
        baseUrl: String,
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

        val calls = selected.joinToString("\n") { operation -> requestCode(operation, configurations[operation.operationId]) }
        // Per-operation status-code Counters. k6's --summary-export does
        // NOT expose tagged sub-metrics, so we declare one Counter per
        // (operation, status-code) tuple. The report then reads the
        // aggregate `count` for each metric from summary.metrics.
        //
        // We pre-declare the most common HTTP status codes. Anything we
        // did not anticipate lands in `lt_status_other_<opId>` so the
        // user still sees the unexpected bucket instead of silently
        // dropping responses. `err` is separate so network errors
        // (status === 0) cannot be confused with a real HTTP 0.
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
                    "$tracked\n$fallback"
                }
        // k6 v1+ removed the top-level `gracefulStop` option; graceful stop
        // is now a scenario-level setting. The `vus` and `duration`/`iterations`
        // top-level shortcuts still work for backward compatibility, but
        // putting everything in a scenario is the canonical k6 v2 layout.
        //
        // We render one of four executor shapes here, all behind the same
        // scenario name `default` so the per-operation Counter declarations
        // above and the default function below stay untouched.
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

            export default function () {
            $calls
              sleep(1);
            }
            """.trimIndent()
    }

    /**
     * Renders the scenario-level block of the `default` scenario. The
     * returned string is the comma-separated body of the scenario object
     * (executor first, then its settings), with a trailing comma so the
     * surrounding template literal can append `gracefulStop: '0s',`
     * without having to special-case the last field.
     *
     * Validation lives in [validateLoadProfile] so we never emit a
     * syntactically valid script for a semantically broken profile.
     */
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
                // k6's arrival-rate executor decouples RPS from response time
                // — the test holds a steady request rate even as latency
                // grows, which is the only way to find the real throughput
                // ceiling. preAllocatedVUs must be > 0; maxVUs bounds the
                // pool k6 may grow when latency spikes.
                "executor: 'constant-arrival-rate', rate: $rate, timeUnit: '${timeUnit}s', duration: '${duration}s', preAllocatedVUs: $preAllocated, maxVUs: $maxVUs,"
            }
        }

    /**
     * Validates a load profile before it reaches the script template.
     * The frontend already validates, but we re-validate here because the
     * backend is the last line of defence — a misconfigured profile would
     * otherwise produce a k6 run that fails mid-flight with a cryptic
     * error.
     */
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
                    // Consecutive stages with the same target are allowed:
                    // they model a plateau (e.g. hold 50 VUs for 5 min),
                    // which is a classic load-test pattern. Only stages
                    // with target == 0 AND duration == 0 would be
                    // redundant — but duration is already validated against
                    // [1, MAX_DURATION_SECONDS] above.
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
    ): String {
        val parameterValues = resolveParameters(operation, configuration)
        var path = operation.path
        parameterValues.filter { it.parameter.location == "path" }.forEach {
            path = path.replace("{${it.parameter.name}}", encode(it.value))
        }
        val query =
            parameterValues
                .filter { it.parameter.location == "query" }
                .joinToString("&") { "${encode(it.parameter.name)}=${encode(it.value)}" }
        val url = path + if (query.isEmpty()) "" else "?$query"
        val requestBody = resolveRequestBody(operation, configuration)
        require(requestBody != null || !operation.requestBodyRequired) { "Der Pflicht-Request-Body für '${operation.operationId}' darf nicht leer sein." }
        val headers = requestHeaders(parameterValues, configuration, requestBody != null)
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
        val safe = safeIdentifier(operation.operationId)
        // switch keeps the generated code linear in the number of codes
        // (instead of a 20-step if/else-if ladder) and the k6 engine
        // can fast-path consecutive identical status values better.
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
        return "  { const response = $request; $statusIncrement check(response, { ${toJson("${operation.operationId} succeeds")}: (r) => r.status >= 200 && r.status < 400 }); }"
    }

    private fun safeIdentifier(name: String): String {
        // Make sure the operationId is a valid JavaScript identifier
        // before we splice it into counter / variable names. k6 metric
        // names share the same restriction, so the sanitisation also
        // keeps the report-side parser happy.
        val sanitized = name.replace(Regex("[^A-Za-z0-9_$]"), "_")
        return if (sanitized.isEmpty() || sanitized[0].isDigit()) "_$sanitized" else sanitized
    }

    private fun resolveParameters(
        operation: ApiOperation,
        configuration: OperationConfiguration?,
    ): List<ResolvedParameter> {
        val configured = configuredParameters(configuration?.parameterValues.orEmpty())
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

    private fun resolveRequestBody(
        operation: ApiOperation,
        configuration: OperationConfiguration?,
    ): Any? {
        val requestBodyJson = configuration?.requestBodyJson ?: return operation.requestBodyExample
        if (requestBodyJson.isBlank()) {
            return null
        }
        return try {
            objectMapper.readValue(requestBodyJson, Any::class.java)
        } catch (exception: JsonProcessingException) {
            throw IllegalArgumentException("Der Request-Body für '${operation.operationId}' ist kein gültiges JSON.", exception)
        }
    }

    private fun requestHeaders(
        parameterValues: List<ResolvedParameter>,
        configuration: OperationConfiguration?,
        hasRequestBody: Boolean,
    ): Map<String, String> {
        val headers = linkedMapOf<String, String>()
        parameterValues.filter { it.parameter.location == "header" }.forEach { headers[it.parameter.name] = it.value }
        val cookies = parameterValues.filter { it.parameter.location == "cookie" }.joinToString("; ") { "${it.parameter.name}=${encode(it.value)}" }
        if (cookies.isNotEmpty()) {
            headers["Cookie"] = cookies
        }
        configuration?.bearerToken?.trim()?.takeIf(String::isNotEmpty)?.let { token ->
            headers["Authorization"] = if (token.startsWith(BEARER_PREFIX, ignoreCase = true)) token else "$BEARER_PREFIX$token"
        }
        if (hasRequestBody) {
            headers.putIfAbsent("Content-Type", "application/json")
        }
        return headers
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
        const val BEARER_PREFIX = "Bearer "

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
