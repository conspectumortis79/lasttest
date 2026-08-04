package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import io.swagger.v3.oas.models.media.ArraySchema
import io.swagger.v3.oas.models.media.Schema
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
    }
}
