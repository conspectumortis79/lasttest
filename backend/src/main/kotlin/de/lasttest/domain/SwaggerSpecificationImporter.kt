package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.ApiParameterSchema
import de.lasttest.api.ApiServer
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.RequestBodySchema
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.media.ArraySchema
import io.swagger.v3.oas.models.media.Schema
import io.swagger.v3.oas.models.parameters.Parameter
import io.swagger.v3.oas.models.security.SecurityRequirement
import io.swagger.v3.oas.models.security.SecurityScheme
import io.swagger.v3.oas.models.servers.Server
import io.swagger.v3.oas.models.servers.ServerVariable
import io.swagger.v3.parser.OpenAPIV3Parser
import io.swagger.v3.parser.converter.SwaggerConverter
import io.swagger.v3.parser.core.models.ParseOptions
import org.springframework.stereotype.Service

class InvalidSpecificationException(
    val problems: List<String>,
) : IllegalArgumentException(problems.joinToString("; "))

interface SpecificationImporter {
    fun import(content: String): ImportedSpecification
}

@Service
class SwaggerSpecificationImporter : SpecificationImporter {
    private val objectMapper = ObjectMapper()

    @Suppress("ktlint:standard:blank-line-before-declaration")
    override fun import(content: String): ImportedSpecification {
        if (content.isBlank()) {
            throw InvalidSpecificationException(listOf("Die Swagger-/OpenAPI-Dokumentation ist leer."))
        }
        val api = parseDocument(content)
        val bearerSecuritySchemes =
            api.components
                ?.securitySchemes
                .orEmpty()
                .filterValues(::isBearerSecurityScheme)
                .keys
        val operations =
            api.paths.orEmpty().flatMap { (path, pathItem) ->
                pathItem.readOperationsMap().map { (method, operation) ->
                    val parameters = combineParameters(pathItem.parameters, operation.parameters)
                    val primaryMedia =
                        operation.requestBody
                            ?.content
                            ?.values
                            ?.firstOrNull()
                    ApiOperation(
                        operationId = operation.operationId ?: operationId(method.name, path),
                        method = method.name,
                        path = path,
                        summary = operation.summary.orEmpty(),
                        destructive = method.name in DESTRUCTIVE_METHODS,
                        parameters = parameters.mapNotNull(::toParameter),
                        requestBodyExample =
                            primaryMedia?.let { media ->
                                media.example?.let(::normalizeExample)
                                    ?: media.examples
                                        ?.values
                                        ?.firstOrNull()
                                        ?.value
                                        ?.let(::normalizeExample)
                                    ?: media.schema?.let(::exampleFor)
                            },
                        requestBodySchema = primaryMedia?.schema?.let(::toRequestBodySchema),
                        hasRequestBody = operation.requestBody != null,
                        requestBodyRequired = operation.requestBody?.required == true,
                        bearerAuth = usesBearerAuthentication(operation.security, api.security, bearerSecuritySchemes),
                    )
                }
            }
        if (operations.isEmpty()) {
            throw InvalidSpecificationException(listOf("Die Spezifikation enthält keine REST-Operationen."))
        }
        val servers = extractServers(api)
        return ImportedSpecification(
            title = api.info?.title ?: "Unbenannte API",
            version = api.info?.version.orEmpty(),
            baseUrl = servers.firstOrNull()?.url ?: "",
            servers = servers,
            operations = operations.sortedWith(compareBy(ApiOperation::path, ApiOperation::method)),
        )
    }

    internal fun extractServers(api: OpenAPI): List<ApiServer> = api.servers!!.mapNotNull(::toApiServer)

    internal fun toApiServer(server: Server): ApiServer? {
        val template = server.url?.takeIf { it.isNotBlank() } ?: return null
        val variables = server.variables.orEmpty()
        val resolved =
            variables.entries.fold(template) { url, (name, variable) ->
                val value = variable.defaultValue() ?: return@fold url
                url.replace("{$name}", value)
            }
        return ApiServer(url = resolved, description = server.description?.takeIf { it.isNotBlank() })
    }

    private fun ServerVariable.defaultValue(): String? = default ?: enum?.firstOrNull()

    private fun parseDocument(content: String): OpenAPI {
        val openApiResult = OpenAPIV3Parser().readContents(content)
        openApiResult.openAPI?.let { return it }

        val swaggerResult = SwaggerConverter().readContents(content, emptyList(), ParseOptions())
        swaggerResult.openAPI?.let { return it }

        val problems = parserProblems(openApiResult.messages, swaggerResult.messages)
        throw InvalidSpecificationException(problems)
    }

    internal fun combineParameters(
        pathParameters: List<Parameter>?,
        operationParameters: List<Parameter>?,
    ): List<Parameter> = (pathParameters.orEmpty() + operationParameters.orEmpty()).distinctBy { "${it.`in`}:${it.name}" }

    internal fun parserProblems(
        openApiProblems: List<String>?,
        swaggerProblems: List<String>?,
    ): List<String> = (openApiProblems.orEmpty() + swaggerProblems.orEmpty()).distinct().ifEmpty { listOf("Ungültige Swagger-/OpenAPI-Dokumentation.") }

    private fun isBearerSecurityScheme(scheme: SecurityScheme): Boolean = isHttpBearer(scheme) || isAuthorizationApiKey(scheme)

    private fun isHttpBearer(scheme: SecurityScheme): Boolean = scheme.type == SecurityScheme.Type.HTTP && scheme.scheme.equals("bearer", ignoreCase = true)

    private fun isAuthorizationApiKey(scheme: SecurityScheme): Boolean =
        scheme.type == SecurityScheme.Type.APIKEY && scheme.`in` == SecurityScheme.In.HEADER && scheme.name.equals("Authorization", ignoreCase = true)

    private fun usesBearerAuthentication(
        operationSecurity: List<SecurityRequirement>?,
        globalSecurity: List<SecurityRequirement>?,
        bearerSecuritySchemes: Set<String>,
    ): Boolean {
        val requirements = operationSecurity ?: globalSecurity.orEmpty()
        return requirements.any { requirement -> requirement.keys.any(bearerSecuritySchemes::contains) }
    }

    private fun toParameter(parameter: Parameter): ApiParameter? {
        val name = parameter.name?.takeIf { it.isNotBlank() } ?: return null
        return ApiParameter(
            name = name,
            location = parameter.`in`,
            required = parameter.required == true || parameter.`in` == "path",
            example = parameter.example ?: parameter.schema?.let(::exampleFor),
            schema = parameter.schema?.let(::toParameterSchema),
        )
    }

    internal fun toParameterSchema(schema: Schema<*>): ApiParameterSchema? {
        val type = schema.type?.takeIf { it.isNotBlank() } ?: return null
        val format = schema.format?.takeIf { it.isNotBlank() }
        val enum =
            schema.enum
                ?.map { it?.toString() ?: "" }
                ?.filter { it.isNotEmpty() }
                ?.takeIf { it.isNotEmpty() }
        return ApiParameterSchema(
            type = type,
            format = format,
            enum = enum,
            minimum = schema.minimum?.toString()?.toDoubleOrNull(),
            maximum = schema.maximum?.toString()?.toDoubleOrNull(),
            exclusiveMinimum = null,
            exclusiveMaximum = null,
            minLength = schema.minLength,
            maxLength = schema.maxLength,
            pattern = schema.pattern?.takeIf { it.isNotBlank() },
        )
    }

    internal fun toRequestBodySchema(schema: Schema<*>): RequestBodySchema? {
        val properties =
            schema.properties
                .orEmpty()
                .mapNotNull { (name, child) ->
                    toParameterSchema(child)?.let { name to it }
                }.toMap()
        if (properties.isEmpty() && schema.type != "object") return null
        return RequestBodySchema(
            type = schema.type?.takeIf { it.isNotBlank() } ?: "object",
            properties = properties,
            required = schema.required.orEmpty(),
        )
    }

    internal fun normalizeExample(value: Any): Any? = objectMapper.convertValue(value, Any::class.java)

    internal fun exampleFor(schema: Schema<*>): Any? {
        schema.example?.let { return it }
        schema.default?.let { return it }
        schema.enum?.firstOrNull()?.let { return it }
        if (schema is ArraySchema) {
            return listOfNotNull(schema.items?.let(::exampleFor))
        }
        if (schema.type == "object") {
            return schema.properties.orEmpty().mapValues { (_, child) -> exampleFor(child) }
        }
        if (schema.type == "integer") {
            return schema.minimum?.toLong() ?: 1L
        }
        if (schema.type == "number") {
            return schema.minimum?.toDouble() ?: 1.0
        }
        if (schema.type == "boolean") {
            return true
        }
        if (schema.type == "string") {
            return stringExample(schema)
        }
        return null
    }

    internal fun stringExample(schema: Schema<*>): String =
        when (schema.format) {
            "uuid" -> "00000000-0000-4000-8000-000000000001"
            "date" -> "2026-01-01"
            "date-time" -> "2026-01-01T00:00:00Z"
            "email" -> "test@example.com"
            else -> "test"
        }

    internal fun operationId(
        method: String,
        path: String,
    ): String = (method.lowercase() + path.replace(Regex("[^A-Za-z0-9]+"), "_").trim('_')).ifBlank { method.lowercase() }

    private companion object {
        val DESTRUCTIVE_METHODS = setOf("POST", "PUT", "PATCH", "DELETE")
    }
}
