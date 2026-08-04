package de.lasttest.domain

import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.ImportedSpecification
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
        virtualUsers: Int,
        durationSeconds: Int,
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
        virtualUsers: Int,
        durationSeconds: Int,
    ): String {
        require(baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) { "Die Base-URL muss mit http:// oder https:// beginnen." }
        require(virtualUsers in 1..MAX_VIRTUAL_USERS) { "Virtual Users müssen zwischen 1 und $MAX_VIRTUAL_USERS liegen." }
        require(durationSeconds in 1..MAX_DURATION_SECONDS) { "Die Dauer muss zwischen 1 und $MAX_DURATION_SECONDS Sekunden liegen." }
        val selected = specification.operations.filter { operationIds.isEmpty() || it.operationId in operationIds }
        require(selected.isNotEmpty()) { "Es wurde kein gültiger Endpunkt ausgewählt." }
        val configurations = configurationsByOperationId(operationConfigurations)
        val selectedOperationIds = selected.map(ApiOperation::operationId).toSet()
        require(configurations.keys.all(selectedOperationIds::contains)) { "Die Konfiguration enthält einen nicht ausgewählten oder unbekannten Endpunkt." }

        val calls = selected.joinToString("\n") { operation -> requestCode(operation, configurations[operation.operationId]) }
        return """
            import http from 'k6/http';
            import { check, sleep } from 'k6';

            export const options = {
              vus: $virtualUsers,
              duration: '${durationSeconds}s',
              gracefulStop: '0s',
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
        return "  { const response = $request; check(response, { ${toJson("${operation.operationId} succeeds")}: (r) => r.status >= 200 && r.status < 400 }); }"
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
        const val MAX_VIRTUAL_USERS = 1000
        const val MAX_DURATION_SECONDS = 3600
        const val CONTROL_CHARACTER_LIMIT = 0x20
        const val DEFAULT_PARAMETER_VALUE = "test"
        const val BEARER_PREFIX = "Bearer "
    }
}
