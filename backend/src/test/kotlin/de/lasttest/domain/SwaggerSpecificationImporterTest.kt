package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.AuthRequirement
import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.media.ArraySchema
import io.swagger.v3.oas.models.media.ObjectSchema
import io.swagger.v3.oas.models.media.Schema
import io.swagger.v3.oas.models.media.StringSchema
import io.swagger.v3.oas.models.parameters.Parameter
import java.math.BigDecimal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class SwaggerSpecificationImporterTest {
    private val importer = SwaggerSpecificationImporter()

    @Test
    fun `imports operations and examples`() {
        val imported = importer.import(SPECIFICATION)

        assertEquals("Pet API", imported.title)
        assertEquals("https://example.test", imported.baseUrl)
        assertEquals(2, imported.operations.size)
        val getPet = imported.operations.first { it.operationId == "getPet" }
        assertEquals(7, (getPet.parameters.single().example as Number).toInt())
        assertEquals(false, getPet.destructive)
        assertTrue(getPet.bearerAuth)
        val createPet = imported.operations.first { it.operationId == "createPet" }
        assertTrue(createPet.destructive)
        assertTrue(createPet.hasRequestBody)
        assertTrue(createPet.requestBodyRequired)
        assertEquals(false, createPet.bearerAuth)
        assertEquals(mapOf("name" to "Fido"), createPet.requestBodyExample)
    }

    @Test
    fun `extracts request body schema with required properties and nested property types`() {
        val imported = importer.import(SPECIFICATION_WITH_REQUEST_BODY_SCHEMA)

        val operation = imported.operations.single { it.operationId == "createItem" }
        val schema = operation.requestBodySchema
        assertEquals("object", schema?.type)
        assertEquals(listOf("name", "price"), schema?.required)
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string", minLength = 1, maxLength = 200),
            schema?.properties?.get("name"),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "number", format = "double", minimum = 0.01),
            schema?.properties?.get("price"),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "boolean"),
            schema?.properties?.get("available"),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string", enum = listOf("books", "hardware")),
            schema?.properties?.get("category"),
        )
        assertTrue(operation.hasRequestBody)
        assertTrue(operation.requestBodyRequired)
    }

    @Test
    fun `dereferences $ref in request body schema and example so validation works against components`() {
        val imported = importer.import(SPECIFICATION_WITH_REQUEST_BODY_REF)

        val operation = imported.operations.single { it.operationId == "createProduct" }
        assertTrue(operation.hasRequestBody)
        assertTrue(operation.requestBodyRequired)
        val schema = operation.requestBodySchema
        assertEquals("object", schema?.type)
        assertEquals(listOf("price"), schema?.required)
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string"),
            schema?.properties?.get("name"),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "number", format = "double", minimum = 0.01),
            schema?.properties?.get("price"),
        )
        assertEquals(
            mapOf("name" to "Clean Code", "price" to 34.95),
            operation.requestBodyExample,
        )
    }

    @Test
    fun `dereferences $ref in parameter schemas so validation works against components`() {
        val imported = importer.import(SPECIFICATION_WITH_REQUEST_BODY_REF)

        val operation = imported.operations.single { it.operationId == "createProduct" }
        val schema = operation.requestBodySchema
        assertEquals("object", schema?.type)
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "number", format = "double", minimum = 0.01),
            schema?.properties?.get("price"),
        )
    }

    @Test
    fun `falls back gracefully when a $ref points to a missing component`() {
        val imported = importer.import(SPECIFICATION_WITH_BROKEN_REQUEST_BODY_REF)

        val operation = imported.operations.single { it.operationId == "createProduct" }
        assertTrue(operation.hasRequestBody)
        assertTrue(operation.requestBodyRequired)
        assertEquals(null, operation.requestBodySchema)
        assertEquals(null, operation.requestBodyExample)
    }

    @Test
    fun `falls back gracefully for body schemas that are not $ref-based and have no usable type`() {
        val imported = importer.import(SPECIFICATION_WITH_EXAMPLE_ONLY_BODY)

        val operation = imported.operations.single { it.operationId == "ping" }
        assertTrue(operation.hasRequestBody)
        assertEquals(null, operation.requestBodySchema)
    }

    @Test
    fun `prefers media example over media schema when both are set on the request body`() {
        val imported = importer.import(SPECIFICATION_WITH_EXAMPLE_AND_SCHEMA)

        val operation = imported.operations.single { it.operationId == "createProduct" }
        assertTrue(operation.hasRequestBody)
        assertEquals(mapOf("source" to "inline"), operation.requestBodyExample)
        assertEquals("object", operation.requestBodySchema?.type)
    }

    @Test
    fun `request body example falls back to schema example when media example is null`() {
        val imported = importer.import(SPECIFICATION_WITH_SCHEMA_EXAMPLE)

        val operation = imported.operations.single { it.operationId == "createProduct" }
        assertTrue(operation.hasRequestBody)
        assertEquals(mapOf("name" to "Widget", "category" to "books"), operation.requestBodyExample)
    }

    @Test
    fun `request body example falls through when dereference returns the unresolved ref`() {
        val imported = importer.import(SPECIFICATION_WITH_BROKEN_REQUEST_BODY_REF)

        val operation = imported.operations.single { it.operationId == "createProduct" }
        assertTrue(operation.hasRequestBody)
        assertEquals(null, operation.requestBodyExample)
    }

    @Test
    fun `cycles in $ref do not loop forever`() {
        val imported = importer.import(SPECIFICATION_WITH_CIRCULAR_REQUEST_BODY_REF)

        val operation = imported.operations.single { it.operationId == "createProduct" }
        assertTrue(operation.hasRequestBody)
        assertEquals(null, operation.requestBodySchema)
    }

    @Test
    fun `$ref is left untouched when there are no components at all`() {
        val imported = importer.import(SPECIFICATION_WITH_REF_BUT_NO_COMPONENTS)

        val operation = imported.operations.single { it.operationId == "ping" }
        assertTrue(operation.hasRequestBody)
        assertEquals(null, operation.requestBodySchema)
    }

    @Test
    fun `omits request body schema when the schema is missing or has no object properties`() {
        val noSchema = importer.import(REQUEST_BODY_WITHOUT_SCHEMA)
        assertEquals(null, noSchema.operations.single().requestBodySchema)

        val nonObject = importer.import(REQUEST_BODY_NON_OBJECT_SCHEMA)
        assertEquals(null, nonObject.operations.single().requestBodySchema)
    }

    @Test
    fun `dereference handles every edge case directly`() {
        val api = OpenAPI()
        assertEquals(null, importer.dereference(null, api))
        val inlineSchema = ObjectSchema()
        inlineSchema.type = "object"
        inlineSchema.addProperty("x", StringSchema())
        assertEquals("object", importer.dereference(inlineSchema, api)?.type)
        val refNoComponents = Schema<Any>()
        refNoComponents.`$ref` = "#/components/schemas/Foo"
        assertEquals(null, importer.dereference(refNoComponents, api))
        val refMissing = Schema<Any>()
        refMissing.`$ref` = "#/components/schemas/Missing"
        assertEquals(null, importer.dereference(refMissing, api))
        val a = Schema<Any>()
        a.`$ref` = "#/components/schemas/B"
        val b = Schema<Any>()
        b.`$ref` = "#/components/schemas/A"
        val components = Components()
        components.addSchemas("A", a)
        components.addSchemas("B", b)
        api.components = components
        val refA = Schema<Any>()
        refA.`$ref` = "#/components/schemas/A"
        assertEquals(null, importer.dereference(refA, api))
    }

    @Test
    fun `extracts parameter schema for type format enum and bounds`() {
        val imported = importer.import(SPECIFICATION_WITH_SCHEMA)

        val parameters =
            imported.operations
                .single { it.operationId == "mixed" }
                .parameters
                .associateBy { it.name }

        assertEquals(
            de.lasttest.api.ApiParameterSchema(
                type = "integer",
                format = "int64",
                minimum = 1.0,
                maximum = 100.0,
            ),
            parameters["count"]?.schema,
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "number", format = "double", minimum = 0.01, maximum = 9999.99),
            parameters["price"]?.schema,
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string", format = "email", minLength = 3, maxLength = 254, pattern = "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$"),
            parameters["email"]?.schema,
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string", enum = listOf("red", "green", "blue")),
            parameters["color"]?.schema,
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "boolean"),
            parameters["flag"]?.schema,
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "custom"),
            parameters["raw"]?.schema,
        )
        assertEquals(null, parameters["missing"]?.schema)
    }

    @Test
    fun `imports and converts Swagger 2 documentation`() {
        val imported = importer.import(SWAGGER_2_SPECIFICATION)

        assertEquals("Swagger Pet API", imported.title)
        assertEquals("https://api.example.test/v1", imported.baseUrl)
        val getPet = imported.operations.single()
        assertEquals("getPet", getPet.operationId)
        assertEquals(9, (getPet.parameters.single().example as Number).toInt())
        assertTrue(getPet.bearerAuth)
    }

    @Test
    fun `imports Swagger 2 JSON documentation`() {
        val imported = importer.import(SWAGGER_2_JSON)

        assertEquals("Swagger JSON API", imported.title)
        assertEquals("listPets", imported.operations.single().operationId)
    }

    @Test
    fun `imports OpenAPI 3 JSON documentation`() {
        val imported = importer.import(OPENAPI_3_JSON)

        assertEquals("Pet API", imported.title)
        assertEquals("https://example.test", imported.baseUrl)
        assertEquals(2, imported.operations.size)
        val getPet = imported.operations.first { it.operationId == "getPet" }
        assertEquals(7, (getPet.parameters.single().example as Number).toInt())
        assertEquals(false, getPet.destructive)
        assertTrue(getPet.bearerAuth)
        val createPet = imported.operations.first { it.operationId == "createPet" }
        assertTrue(createPet.destructive)
        assertTrue(createPet.hasRequestBody)
        assertTrue(createPet.requestBodyRequired)
        assertEquals(false, createPet.bearerAuth)
        assertEquals(mapOf("name" to "Fido"), createPet.requestBodyExample)
    }

    @Test
    fun `imports OpenAPI 3 JSON documentation with leading whitespace`() {
        val imported = importer.import("   $OPENAPI_3_JSON")

        assertEquals("Pet API", imported.title)
        assertEquals(2, imported.operations.size)
        assertTrue(imported.operations.any { it.operationId == "getPet" })
        assertTrue(imported.operations.any { it.operationId == "createPet" })
    }

    @Test
    fun `imports multiple OpenAPI servers and uses the first as baseUrl`() {
        val spec =
            """
            openapi: 3.0.3
            info: {title: Multi, version: "1"}
            servers:
              - url: https://api.example.com
                description: Production
              - url: https://staging.example.com
                description: Staging
              - url: http://localhost:8080
            paths:
              /ping:
                get:
                  operationId: ping
                  responses:
                    '200': {description: OK}
            """.trimIndent()
        val imported = importer.import(spec)

        assertEquals("https://api.example.com", imported.baseUrl)
        assertEquals(
            listOf(
                de.lasttest.api.ApiServer("https://api.example.com", "Production"),
                de.lasttest.api.ApiServer("https://staging.example.com", "Staging"),
                de.lasttest.api.ApiServer("http://localhost:8080", null),
            ),
            imported.servers,
        )
    }

    @Test
    fun `substitutes server variables with their defaults`() {
        val spec =
            """
            openapi: 3.0.3
            info: {title: Templated, version: "1"}
            servers:
              - url: https://{environment}.example.com/api
                description: Multi-region
                variables:
                  environment:
                    default: api
                    enum: [api, api-eu, api-us]
              - url: https://{port}.backing.example.com
                variables:
                  port:
                    enum: [8443, 9443]
            paths:
              /ping:
                get:
                  operationId: ping
                  responses:
                    '200': {description: OK}
            """.trimIndent()
        val imported = importer.import(spec)

        assertEquals("https://api.example.com/api", imported.servers[0].url)
        assertEquals("Multi-region", imported.servers[0].description)
        assertEquals("https://8443.backing.example.com", imported.servers[1].url)
    }

    @Test
    fun `ignores servers with blank URL or blank description`() {
        val spec =
            """
            openapi: 3.0.3
            info: {title: Edge, version: "1"}
            servers:
              - url: https://ok.example.com
                description: ""
              - url: ""
                description: missing-url
              - url: https://also.example.com
                description: ~
            paths:
              /ping:
                get:
                  operationId: ping
                  responses:
                    '200': {description: OK}
            """.trimIndent()
        val imported = importer.import(spec)

        assertEquals(listOf(de.lasttest.api.ApiServer("https://ok.example.com", null), de.lasttest.api.ApiServer("https://also.example.com", null)), imported.servers)
    }

    @Test
    fun `falls back to the OpenAPI default server when the document declares none`() {
        val spec =
            """
            openapi: 3.0.3
            info: {title: Default server, version: "1"}
            paths:
              /ping:
                get:
                  operationId: ping
                  responses:
                    '200': {description: OK}
            """.trimIndent()
        val imported = importer.import(spec)

        assertEquals(1, imported.servers.size)
        assertEquals("/", imported.servers.single().url)
    }

    @Test
    fun `keeps the placeholder when a server variable has no default and no enum`() {
        val spec =
            """
            openapi: 3.0.3
            info: {title: Placeholder, version: "1"}
            servers:
              - url: https://{tenant}.example.com
                variables:
                  tenant:
                    description: tenant id
            paths:
              /ping:
                get:
                  operationId: ping
                  responses:
                    '200': {description: OK}
            """.trimIndent()
        val imported = importer.import(spec)

        assertEquals("https://{tenant}.example.com", imported.servers.single().url)
    }

    @Test
    fun `maps parser values and directly constructed schema edge cases`() {
        val mapper = ObjectMapper()
        assertEquals(mapOf("value" to 1), importer.normalizeExample(mapper.readTree("{\"value\":1}")))
        assertEquals("plain", importer.normalizeExample("plain"))

        assertEquals("example", importer.exampleFor(Schema<Any>().example("example")))
        assertEquals("default", importer.exampleFor(Schema<Any>()._default("default")))
        assertEquals("enum", importer.exampleFor(Schema<Any>()._enum(listOf("enum"))))
        assertEquals(null, importer.exampleFor(Schema<Any>()._enum(emptyList())))
        assertEquals(emptyList<Any>(), importer.exampleFor(ArraySchema()))
        assertEquals(emptyList<Any>(), importer.exampleFor(ArraySchema().items(Schema<Any>())))
        assertEquals(emptyMap<String, Any?>(), importer.exampleFor(Schema<Any>().type("object")))
        assertEquals(1L, importer.exampleFor(Schema<Any>().type("integer")))
        assertEquals(5L, importer.exampleFor(Schema<Any>().type("integer").minimum(BigDecimal.valueOf(5))))
        assertEquals(1.0, importer.exampleFor(Schema<Any>().type("number")))
        assertEquals(0.5, importer.exampleFor(Schema<Any>().type("number").minimum(BigDecimal.valueOf(0.5))))
        assertEquals(true, importer.exampleFor(Schema<Any>().type("boolean")))
        assertEquals("test", importer.exampleFor(Schema<Any>().type("string")))
        assertEquals(null, importer.exampleFor(Schema<Any>().type("custom")))
        assertEquals(null, importer.exampleFor(Schema<Any>()))
    }

    @Test
    fun `creates operation ids for normal and empty parser inputs`() {
        assertEquals("getpets_id", importer.operationId("GET", "/pets/{id}"))
        assertEquals("", importer.operationId("", ""))
    }

    @Test
    fun `toParameterSchema handles blank type blank format blank pattern and empty enum`() {
        assertEquals(null, importer.toParameterSchema(Schema<Any>().type("")))
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string"),
            importer.toParameterSchema(Schema<Any>().type("string").format("")),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string"),
            importer.toParameterSchema(Schema<Any>().type("string").pattern("")),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string", enum = listOf("a", "b")),
            importer.toParameterSchema(Schema<Any>().type("string")._enum(listOf<Any>("a", "b"))),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string"),
            importer.toParameterSchema(Schema<Any>().type("string")._enum(listOf(""))),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "integer", minimum = 1.0),
            importer.toParameterSchema(Schema<Any>().type("integer").minimum(BigDecimal.ONE)),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "integer", minimum = 1.0, maximum = 9.0),
            importer.toParameterSchema(Schema<Any>().type("integer").minimum(BigDecimal.ONE).maximum(BigDecimal.valueOf(9))),
        )
        assertEquals(
            de.lasttest.api.ApiParameterSchema(type = "string", minLength = 2, maxLength = 8),
            importer.toParameterSchema(Schema<Any>().type("string").minLength(2).maxLength(8)),
        )
    }

    @Test
    fun `combines optional path and operation parameters without duplicates`() {
        val pathId =
            Parameter().apply {
                name = "id"
                `in` = "path"
            }
        val duplicateId =
            Parameter().apply {
                name = "id"
                `in` = "path"
            }
        val query =
            Parameter().apply {
                name = "query"
                `in` = "query"
            }

        assertEquals(emptyList<Parameter>(), importer.combineParameters(null, null))
        assertEquals(listOf(pathId), importer.combineParameters(listOf(pathId), null))
        assertEquals(listOf(query), importer.combineParameters(null, listOf(query)))
        assertEquals(listOf(pathId, query), importer.combineParameters(listOf(pathId), listOf(duplicateId, query)))
    }

    @Test
    fun `normalizes parser problems and supplies a fallback`() {
        assertEquals(listOf("Ungültige Swagger-/OpenAPI-Dokumentation."), importer.parserProblems(null, null))
        assertEquals(listOf("open", "shared", "swagger"), importer.parserProblems(listOf("open", "shared"), listOf("shared", "swagger")))
        assertEquals(listOf("swagger"), importer.parserProblems(null, listOf("swagger")))
        assertEquals(listOf("open"), importer.parserProblems(listOf("open"), null))
    }

    @Test
    fun `imports schema defaults enums arrays formats and media examples`() {
        val imported = importer.import(EXAMPLE_VARIANTS)

        val operation = imported.operations.first { it.operationId == "exampleVariants" }
        val examples = operation.parameters.associate { it.name to it.example }
        assertEquals("default-value", examples["withDefault"])
        assertEquals("first", examples["withEnum"])
        assertEquals(listOf("test"), examples["array"])
        assertEquals(null, examples["emptyArray"])
        assertEquals(5L, examples["integer"])
        assertEquals(1L, examples["defaultInteger"])
        assertEquals(0.5, examples["number"])
        assertEquals(1.0, examples["defaultNumber"])
        assertEquals(true, examples["boolean"])
        assertEquals("00000000-0000-4000-8000-000000000001", examples["uuid"])
        assertEquals("2026-01-01", examples["date"])
        assertEquals("2026-01-01T00:00:00Z", examples["dateTime"])
        assertEquals("test@example.com", examples["email"])
        assertEquals("test", examples["text"])
        assertEquals(null, examples["unknown"])
        assertEquals(null, examples["noSchema"])
        assertEquals(true, operation.parameters.first { it.name == "pathId" }.required)
        assertEquals(true, operation.parameters.first { it.name == "requiredQuery" }.required)
        assertEquals(mapOf("source" to "named-example"), imported.operations.first { it.operationId == "namedBody" }.requestBodyExample)
        assertEquals(mapOf("source" to "direct-example"), imported.operations.first { it.operationId == "directBody" }.requestBodyExample)
        assertEquals(mapOf("enabled" to true), imported.operations.first { it.operationId == "objectBody" }.requestBodyExample)
        assertEquals(emptyMap<String, Any?>(), imported.operations.first { it.operationId == "emptyObjectBody" }.requestBodyExample)
        assertEquals(null, imported.operations.first { it.operationId == "emptyMedia" }.requestBodyExample)
    }

    @Test
    fun `uses generated operation metadata and safe fallbacks`() {
        val imported =
            importer.import(
                """
                openapi: 3.0.3
                paths:
                  /things/{id}:
                    parameters:
                      - {name: id, in: path, required: true, schema: {type: string}}
                    get:
                      parameters:
                        - {name: id, in: path, required: true, schema: {type: string, example: duplicate}}
                      requestBody: {}
                      responses:
                        '200': {description: OK}
                """.trimIndent(),
            )

        val operation = imported.operations.single()
        assertEquals("Unbenannte API", imported.title)
        assertEquals("", imported.version)
        assertEquals("/", imported.baseUrl)
        assertEquals("getthings_id", operation.operationId)
        assertEquals("", operation.summary)
        assertEquals(1, operation.parameters.size)
        assertTrue(operation.hasRequestBody)
        assertEquals(null, operation.requestBodyExample)
        assertEquals(false, operation.bearerAuth)
    }

    @Test
    fun `handles empty and incomplete server lists`() {
        val emptyServers = importer.import("openapi: 3.0.3\ninfo: {title: Empty servers, version: '1'}\nservers: []\npaths: {'/': {get: {responses: {'200': {description: OK}}}}}")
        val serverWithoutUrl = importer.import("openapi: 3.0.3\ninfo: {title: Empty server, version: '1'}\nservers: [{}]\npaths: {'/': {get: {responses: {'200': {description: OK}}}}}")

        assertEquals("/", emptyServers.baseUrl)
        assertEquals("", serverWithoutUrl.baseUrl)
    }

    @Test
    fun `rejects documentation with missing paths`() {
        assertFailsWith<InvalidSpecificationException> {
            importer.import("openapi: 3.0.3\ninfo: {title: Missing paths, version: '1'}")
        }
    }

    @Test
    fun `does not treat basic or unrelated api key security as bearer auth`() {
        val imported = importer.import(NON_BEARER_SECURITY)

        assertTrue(imported.operations.none { it.bearerAuth })
    }

    @Test
    fun `classifies http basic security scheme as AuthRequirement Basic`() {
        val spec =
            """
            openapi: 3.0.3
            info: {title: Basic API, version: "1"}
            components:
              securitySchemes:
                basicAuth: {type: http, scheme: basic}
            paths:
              /admin/stats:
                get:
                  operationId: getAdminStats
                  security: [{basicAuth: []}]
                  responses: {'200': {description: OK}}
            """.trimIndent()
        val imported = importer.import(spec)

        val operation = imported.operations.single { it.operationId == "getAdminStats" }
        assertEquals(listOf(AuthRequirement.Basic("basicAuth")), operation.authRequirements)
        assertEquals(false, operation.bearerAuth)
    }

    @Test
    fun `classifies oauth2 security scheme as AuthRequirement OAuth2 and exposes the declared flows`() {
        val spec =
            """
            openapi: 3.0.3
            info: {title: OAuth API, version: "1"}
            components:
              securitySchemes:
                oauth2:
                  type: oauth2
                  flows:
                    clientCredentials:
                      tokenUrl: https://example.test/oauth/token
                      scopes:
                        read:products: Read products
                        write:products: Write products
            paths:
              /me:
                get:
                  operationId: getMe
                  security: [{oauth2: []}]
                  responses: {'200': {description: OK}}
            """.trimIndent()
        val imported = importer.import(spec)

        val operation = imported.operations.single { it.operationId == "getMe" }
        assertEquals(1, operation.authRequirements.size)
        val requirement = operation.authRequirements.single()
        assertTrue(requirement is AuthRequirement.OAuth2)
        val oauth2: AuthRequirement.OAuth2 = requirement
        assertEquals("oauth2", oauth2.schemeName)
        assertEquals(1, oauth2.flows.size)
        val flow = oauth2.flows.single()
        assertEquals("clientCredentials", flow.type)
        assertEquals("https://example.test/oauth/token", flow.tokenUrl)
        assertEquals(listOf("read:products", "write:products"), flow.scopes)
        assertEquals(true, operation.bearerAuth)
    }

    @Test
    fun `preserves order of multiple security requirements on one operation`() {
        val spec =
            """
            openapi: 3.0.3
            info: {title: Dual API, version: "1"}
            components:
              securitySchemes:
                basicAuth: {type: http, scheme: basic}
                bearerAuth: {type: http, scheme: bearer}
            paths:
              /whoami:
                get:
                  operationId: whoAmI
                  security:
                    - basicAuth: []
                    - bearerAuth: []
                  responses: {'200': {description: OK}}
            """.trimIndent()
        val imported = importer.import(spec)

        val operation = imported.operations.single { it.operationId == "whoAmI" }
        assertEquals(
            listOf(
                AuthRequirement.Basic("basicAuth"),
                AuthRequirement.Bearer("bearerAuth"),
            ),
            operation.authRequirements,
        )
        assertTrue(operation.bearerAuth)
    }

    @Test
    fun `rejects malformed documentation with parser problems`() {
        val exception = assertFailsWith<InvalidSpecificationException> { importer.import("openapi: [") }

        assertTrue(exception.problems.isNotEmpty())
    }

    @Test
    fun `rejects empty specification`() {
        val exception = assertFailsWith<InvalidSpecificationException> { importer.import(" ") }

        assertTrue(exception.message!!.contains("leer"))
    }

    @Test
    fun `rejects specification without operations`() {
        assertFailsWith<InvalidSpecificationException> {
            importer.import("openapi: 3.0.3\ninfo: {title: Empty, version: '1'}\npaths: {}")
        }
    }

    @Test
    fun `toParameter covers required explicit and the example-priority and schema-derived example paths`() {
        val withExample =
            Parameter().apply {
                name = "id"
                `in` = "query"
                required = true
                example = "from-example"
                schema = null
            }
        val withSchema =
            Parameter().apply {
                name = "id"
                `in` = "query"
                required = false
                example = null
                schema =
                    Schema<Any>().apply {
                        type = "string"
                        example = "from-schema"
                    }
            }
        val first = importer.toParameter(withExample)
        val second = importer.toParameter(withSchema)
        assertEquals("from-example", first?.example)
        assertEquals(true, first?.required)
        assertEquals("from-schema", second?.example)
        assertEquals(false, second?.required)
    }

    @Test
    fun `toParameterSchema preserves a non-blank format and null enum`() {
        val schema =
            Schema<Any>().apply {
                type = "string"
                format = "uuid"
                enum = null
            }
        val result = importer.toParameterSchema(schema)
        assertEquals("uuid", result?.format)
        assertEquals(null, result?.enum)
    }

    @Test
    fun `toParameterSchema returns null when type is missing or blank`() {
        val missingType =
            Schema<Any>().apply {
                type = null
            }
        val blankType =
            Schema<Any>().apply {
                type = "   "
            }
        assertEquals(null, importer.toParameterSchema(missingType))
        assertEquals(null, importer.toParameterSchema(blankType))
    }

    @Test
    fun `toRequestBodySchema returns null for non-object schemas without properties`() {
        val arraySchema =
            Schema<Any>().apply {
                type = "array"
                properties = null
            }
        assertEquals(null, importer.toRequestBodySchema(arraySchema))
    }

    @Test
    fun `toRequestBodySchema defaults to object when type is blank but a property is present`() {
        val schema =
            Schema<Any>().apply {
                type = "   "
                properties =
                    mapOf(
                        "name" to
                            Schema<Any>().apply {
                                type = "string"
                            },
                    )
            }
        val result = importer.toRequestBodySchema(schema)
        assertEquals("object", result?.type)
        assertEquals(setOf("name"), result?.properties?.keys)
    }

    @Test
    fun `toRequestBodySchema tolerates null required even when properties and a real type are present`() {
        val schema =
            Schema<Any>().apply {
                type = "object"
                properties =
                    mapOf(
                        "name" to
                            Schema<Any>().apply {
                                type = "string"
                            },
                    )
                required = null
            }
        val result = importer.toRequestBodySchema(schema)
        assertEquals(emptyList(), result?.required)
    }

    @Test
    fun `toParameterSchema tolerates null enum entries by filtering them out`() {
        val schema =
            Schema<Any>().apply {
                type = "string"
                enum =
                    listOf(
                        null,
                        "real",
                    )
            }
        val result = importer.toParameterSchema(schema)
        assertEquals(listOf("real"), result?.enum)
    }

    @Test
    fun `toRequestBodySchema skips properties whose child schema has no usable type`() {
        val schema =
            Schema<Any>().apply {
                type = "object"
                properties =
                    mapOf(
                        "good" to
                            Schema<Any>().apply {
                                type = "string"
                            },
                        "bad" to
                            Schema<Any>().apply {
                                type = null
                            },
                    )
            }
        val result = importer.toRequestBodySchema(schema)
        assertEquals(setOf("good"), result?.properties?.keys)
    }

    @Test
    fun `toParameterSchema returns null when type is set but enum is null and the rest is uninteresting`() {
        val schema =
            Schema<Any>().apply {
                type = "integer"
                minimum = BigDecimal.ZERO
                maximum = BigDecimal.TEN
                pattern = null
                minLength = null
                maxLength = null
            }
        val result = importer.toParameterSchema(schema)
        assertEquals("integer", result?.type)
        assertEquals(null, result?.enum)
    }

    @Test
    fun `toParameter covers an explicit path-in required parameter with both example sources`() {
        val parameter =
            Parameter().apply {
                name = "id"
                `in` = "path"
                required = false
                example = "explicit"
                schema =
                    Schema<Any>().apply {
                        type = "string"
                        example = "schema"
                    }
            }
        val result = importer.toParameter(parameter)
        assertEquals(true, result?.required)
        assertEquals("explicit", result?.example)
    }

    @Test
    fun `toParameter returns null when the parameter name is null`() {
        val parameter =
            Parameter().apply {
                name = null
                `in` = "query"
            }
        assertEquals(null, importer.toParameter(parameter))
    }

    @Test
    fun `toParameter returns null when the parameter name is blank`() {
        val parameter =
            Parameter().apply {
                name = "   "
                `in` = "query"
            }
        assertEquals(null, importer.toParameter(parameter))
    }

    @Test
    fun `toParameter derives example from the schema when no explicit example is set`() {
        val parameter =
            Parameter().apply {
                name = "id"
                `in` = "query"
                example = null
                schema =
                    Schema<Any>().apply {
                        type = "string"
                        example = "from-schema"
                    }
            }
        assertEquals("from-schema", importer.toParameter(parameter)?.example)
    }

    private companion object {
        val NON_BEARER_SECURITY =
            """
            openapi: 3.0.3
            info: {title: Security, version: "1"}
            components:
              securitySchemes:
                basicAuth: {type: http, scheme: basic}
                queryKey: {type: apiKey, in: query, name: key}
                otherHeader: {type: apiKey, in: header, name: X-Api-Key}
            security:
              - basicAuth: []
              - queryKey: []
              - otherHeader: []
            paths:
              /secured:
                get:
                  responses: {'200': {description: OK}}
            """.trimIndent()

        val EXAMPLE_VARIANTS =
            """
            openapi: 3.0.3
            info: {title: Examples, version: "1"}
            paths:
              /examples/{pathId}:
                get:
                  operationId: exampleVariants
                  summary: Example variants
                  parameters:
                    - {name: pathId, in: path, required: false, schema: {type: string}}
                    - {name: requiredQuery, in: query, required: true, example: direct, schema: {type: string}}
                    - {name: withDefault, in: query, schema: {type: string, default: default-value}}
                    - {name: withEnum, in: query, schema: {type: string, enum: [first, second]}}
                    - name: array
                      in: query
                      schema: {type: array, items: {type: string}}
                    - {name: emptyArray, in: query, schema: {type: array}}
                    - {name: integer, in: query, schema: {type: integer, minimum: 5}}
                    - {name: defaultInteger, in: query, schema: {type: integer}}
                    - {name: number, in: query, schema: {type: number, minimum: 0.5}}
                    - {name: defaultNumber, in: query, schema: {type: number}}
                    - {name: boolean, in: query, schema: {type: boolean}}
                    - {name: uuid, in: query, schema: {type: string, format: uuid}}
                    - {name: date, in: query, schema: {type: string, format: date}}
                    - {name: dateTime, in: query, schema: {type: string, format: date-time}}
                    - {name: email, in: query, schema: {type: string, format: email}}
                    - {name: text, in: query, schema: {type: string}}
                    - {name: unknown, in: query, schema: {}}
                    - {name: noSchema, in: query}
                  responses: {'200': {description: OK}}
              /path-only/{shared}:
                parameters:
                  - {name: shared, in: path, required: true, schema: {type: string}}
                get:
                  operationId: pathOnly
                  responses: {'200': {description: OK}}
              /named-body:
                post:
                  operationId: namedBody
                  requestBody:
                    content:
                      application/json:
                        examples:
                          first:
                            value: {source: named-example}
                  responses: {'200': {description: OK}}
              /direct-body:
                post:
                  operationId: directBody
                  requestBody:
                    content:
                      application/json:
                        example: {source: direct-example}
                  responses: {'200': {description: OK}}
              /empty-media:
                post:
                  operationId: emptyMedia
                  requestBody:
                    content:
                      application/json: {}
                  responses: {'200': {description: OK}}
              /object-body:
                put:
                  operationId: objectBody
                  requestBody:
                    content:
                      application/json:
                        schema:
                          type: object
                          properties:
                            enabled: {type: boolean}
                  responses: {'200': {description: OK}}
              /empty-object-body:
                post:
                  operationId: emptyObjectBody
                  requestBody:
                    content:
                      application/json:
                        schema: {type: object}
                  responses: {'200': {description: OK}}
            """.trimIndent()

        val SWAGGER_2_SPECIFICATION =
            """
            swagger: "2.0"
            info:
              title: Swagger Pet API
              version: "1.0"
            host: api.example.test
            basePath: /v1
            schemes: [https]
            securityDefinitions:
              bearerAuth:
                type: apiKey
                name: Authorization
                in: header
            security:
              - bearerAuth: []
            paths:
              /pets/{id}:
                get:
                  operationId: getPet
                  parameters:
                    - in: path
                      name: id
                      required: true
                      type: integer
                      default: 9
                  responses:
                    200:
                      description: OK
            """.trimIndent()

        val SWAGGER_2_JSON =
            """
            {
              "swagger": "2.0",
              "info": {"title": "Swagger JSON API", "version": "1.0"},
              "paths": {
                "/pets": {
                  "get": {
                    "operationId": "listPets",
                    "responses": {"200": {"description": "OK"}}
                  }
                }
              }
            }
            """.trimIndent()

        val OPENAPI_3_JSON =
            """
            {
              "openapi": "3.0.3",
              "info": {
                "title": "Pet API",
                "version": "1.0.0"
              },
              "servers": [
                {"url": "https://example.test"}
              ],
              "security": [{"bearerAuth": []}],
              "paths": {
                "/pets/{id}": {
                  "get": {
                    "operationId": "getPet",
                    "parameters": [
                      {
                        "in": "path",
                        "name": "id",
                        "required": true,
                        "schema": {"type": "integer", "example": 7}
                      }
                    ],
                    "responses": {"200": {"description": "OK"}}
                  }
                },
                "/pets": {
                  "post": {
                    "operationId": "createPet",
                    "security": [],
                    "requestBody": {
                      "required": true,
                      "content": {
                        "application/json": {
                          "schema": {
                            "type": "object",
                            "properties": {
                              "name": {"type": "string", "example": "Fido"}
                            }
                          }
                        }
                      }
                    },
                    "responses": {"201": {"description": "Created"}}
                  }
                }
              },
              "components": {
                "securitySchemes": {
                  "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT"
                  }
                }
              }
            }
            """.trimIndent()

        val SPECIFICATION =
            """
            openapi: 3.0.3
            info:
              title: Pet API
              version: 1.0.0
            servers:
              - url: https://example.test
            security:
              - bearerAuth: []
            paths:
              /pets/{id}:
                get:
                  operationId: getPet
                  parameters:
                    - in: path
                      name: id
                      required: true
                      schema:
                        type: integer
                        example: 7
                  responses:
                    '200': {description: OK}
              /pets:
                post:
                  operationId: createPet
                  security: []
                  requestBody:
                    required: true
                    content:
                      application/json:
                        schema:
                          type: object
                          properties:
                            name: {type: string, example: Fido}
                  responses:
                    '201': {description: Created}
            components:
              securitySchemes:
                bearerAuth:
                  type: http
                  scheme: bearer
                  bearerFormat: JWT
            """.trimIndent()

        val SPECIFICATION_WITH_SCHEMA =
            """
            openapi: 3.0.3
            info:
              title: Schema API
              version: "1.0"
            servers:
              - url: https://schema.example.test
            paths:
              /items:
                get:
                  operationId: mixed
                  parameters:
                    - name: count
                      in: query
                      required: false
                      schema:
                        type: integer
                        format: int64
                        minimum: 1
                        maximum: 100
                    - name: price
                      in: query
                      required: false
                      schema:
                        type: number
                        format: double
                        minimum: 0.01
                        maximum: 9999.99
                    - name: email
                      in: query
                      required: false
                      schema:
                        type: string
                        format: email
                        minLength: 3
                        maxLength: 254
                        pattern: '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
                    - name: color
                      in: query
                      required: false
                      schema:
                        type: string
                        enum: [red, green, blue]
                    - name: flag
                      in: query
                      required: false
                      schema:
                        type: boolean
                    - name: raw
                      in: query
                      required: false
                      schema:
                        type: custom
                    - name: missing
                      in: query
                      required: false
                  responses:
                    '200': {description: OK}
            """.trimIndent()

        val SPECIFICATION_WITH_REQUEST_BODY_SCHEMA =
            """
            openapi: 3.0.3
            info:
              title: Body Schema API
              version: "1.0"
            servers:
              - url: https://body.example.test
            paths:
              /items:
                post:
                  operationId: createItem
                  requestBody:
                    required: true
                    content:
                      application/json:
                        schema:
                          type: object
                          required: [name, price]
                          properties:
                            name:
                              type: string
                              minLength: 1
                              maxLength: 200
                            price:
                              type: number
                              format: double
                              minimum: 0.01
                            available:
                              type: boolean
                            category:
                              type: string
                              enum: [books, hardware]
                  responses:
                    '201': {description: Created}
            """.trimIndent()

        val REQUEST_BODY_WITHOUT_SCHEMA =
            """
            openapi: 3.0.3
            info:
              title: Plain Body API
              version: "1.0"
            paths:
              /notes:
                post:
                  operationId: createNote
                  requestBody:
                    required: true
                    content:
                      application/json: {}
                  responses:
                    '201': {description: Created}
            """.trimIndent()

        val REQUEST_BODY_NON_OBJECT_SCHEMA =
            """
            openapi: 3.0.3
            info:
              title: Array Body API
              version: "1.0"
            paths:
              /bulk:
                post:
                  operationId: createBulk
                  requestBody:
                    content:
                      application/json:
                        schema:
                          type: array
                          items: {type: string}
                  responses:
                    '201': {description: Created}
            """.trimIndent()

        val SPECIFICATION_WITH_REQUEST_BODY_REF =
            """
            openapi: 3.0.3
            info:
              title: Ref-Body API
              version: "1.0"
            servers:
              - url: https://ref.example.test
            paths:
              /products:
                post:
                  operationId: createProduct
                  requestBody:
                    required: true
                    content:
                      application/json:
                        schema:
                          ${'$'}ref: '#/components/schemas/CreateProduct'
                        example:
                          name: Clean Code
                          price: 34.95
                  responses:
                    '201': {description: Created}
            components:
              schemas:
                CreateProduct:
                  type: object
                  required: [price]
                  properties:
                    name:
                      type: string
                    price:
                      type: number
                      format: double
                      minimum: 0.01
            """.trimIndent()

        val SPECIFICATION_WITH_BROKEN_REQUEST_BODY_REF =
            """
            openapi: 3.0.3
            info:
              title: Broken-Ref API
              version: "1.0"
            paths:
              /products:
                post:
                  operationId: createProduct
                  requestBody:
                    required: true
                    content:
                      application/json:
                        schema:
                          ${'$'}ref: '#/components/schemas/MissingSchema'
                  responses:
                    '201': {description: Created}
            components:
              schemas:
                OtherSchema:
                  type: object
            """.trimIndent()

        val SPECIFICATION_WITH_EXAMPLE_ONLY_BODY =
            """
            openapi: 3.0.3
            info:
              title: Example-Only API
              version: "1.0"
            paths:
              /ping:
                post:
                  operationId: ping
                  requestBody:
                    required: true
                    content:
                      application/json:
                        example: {anything: goes}
                  responses:
                    '201': {description: Created}
            """.trimIndent()

        val SPECIFICATION_WITH_EXAMPLE_AND_SCHEMA =
            """
            openapi: 3.0.3
            info:
              title: Example-And-Schema API
              version: "1.0"
            paths:
              /products:
                post:
                  operationId: createProduct
                  requestBody:
                    required: true
                    content:
                      application/json:
                        example: {source: inline}
                        schema:
                          ${'$'}ref: '#/components/schemas/CreateProduct'
                  responses:
                    '201': {description: Created}
            components:
              schemas:
                CreateProduct:
                  type: object
                  required: [name]
                  properties:
                    name:
                      type: string
            """.trimIndent()

        val SPECIFICATION_WITH_SCHEMA_EXAMPLE =
            """
            openapi: 3.0.3
            info:
              title: Schema-Example API
              version: "1.0"
            paths:
              /products:
                post:
                  operationId: createProduct
                  requestBody:
                    required: true
                    content:
                      application/json:
                        schema:
                          type: object
                          properties:
                            name:
                              type: string
                              example: Widget
                            category:
                              type: string
                              example: books
                  responses:
                    '201': {description: Created}
            """.trimIndent()

        val SPECIFICATION_WITH_CIRCULAR_REQUEST_BODY_REF =
            """
            openapi: 3.0.3
            info:
              title: Circular-Ref API
              version: "1.0"
            paths:
              /products:
                post:
                  operationId: createProduct
                  requestBody:
                    required: true
                    content:
                      application/json:
                        schema:
                          ${'$'}ref: '#/components/schemas/A'
                  responses:
                    '201': {description: Created}
            components:
              schemas:
                A:
                  ${'$'}ref: '#/components/schemas/B'
                B:
                  ${'$'}ref: '#/components/schemas/A'
            """.trimIndent()

        val SPECIFICATION_WITH_REF_BUT_NO_COMPONENTS =
            """
            openapi: 3.0.3
            info:
              title: Dangling-Ref API
              version: "1.0"
            paths:
              /ping:
                post:
                  operationId: ping
                  requestBody:
                    required: true
                    content:
                      application/json:
                        schema:
                          ${'$'}ref: '#/components/schemas/MissingSchema'
                  responses:
                    '201': {description: Created}
            """.trimIndent()

        val SPECIFICATION_WITH_DANGLING_REF_AND_NO_EXAMPLE =
            """
            openapi: 3.0.3
            info:
              title: Dangling-Ref No-Example API
              version: "1.0"
            paths:
              /ping:
                post:
                  operationId: ping
                  requestBody:
                    required: true
                    content:
                      application/json:
                        schema:
                          ${'$'}ref: '#/components/schemas/MissingSchema'
                  responses:
                    '201': {description: Created}
            """.trimIndent()
    }
}
