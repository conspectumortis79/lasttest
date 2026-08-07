package de.lasttest.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

class ModelsTest {
    @Test
    fun `derives request body presence from the example by default`() {
        val withBody = ApiOperation("post", "POST", "/", "", true, emptyList(), mapOf("value" to true))
        val withoutBody = ApiOperation("get", "GET", "/", "", false, emptyList(), null)

        assertTrue(withBody.hasRequestBody)
        assertFalse(withoutBody.hasRequestBody)
    }

    // ---- OperationPayload / OperationConfiguration.primaryPayload ---------

    @Test
    fun `primaryPayload returns the first pool entry when payloads is non-empty`() {
        val first = OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "42")))
        val second = OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "99")))
        val configuration = OperationConfiguration("getPet", payloads = listOf(first, second))

        // The same instance must be returned (no copy / no clone), so any
        // future cached derivations in the generator stay referentially
        // identical to the source.
        assertSame(configuration.primaryPayload(), first)
    }

    @Test
    fun `primaryPayload falls back to the legacy flat fields when payloads is empty`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                parameterValues = listOf(ParameterValue("id", "path", "42")),
                requestBodyJson = """{"name":"Luna"}""",
                bearerToken = "secret",
            )

        val payload = configuration.primaryPayload()
        assertEquals(listOf(ParameterValue("id", "path", "42")), payload.parameterValues)
        assertEquals("""{"name":"Luna"}""", payload.requestBodyJson)
        assertEquals("secret", payload.bearerToken)
    }

    @Test
    fun `primaryPayload returns an all-defaults payload when both payloads and legacy fields are empty`() {
        val payload = OperationConfiguration("empty").primaryPayload()
        assertTrue(payload.parameterValues.isEmpty())
        assertNull(payload.requestBodyJson)
        assertNull(payload.bearerToken)
    }

    @Test
    fun `primaryPayload prefers the pool over the legacy fields when both are present`() {
        // Defensive: if a malformed request carries both the new pool
        // and the old flat fields, the new shape wins. The old fields
        // are kept for the report builder's reference but must not
        // silently override what the user explicitly configured in
        // the pool.
        val poolEntry =
            OperationPayload(
                parameterValues = listOf(ParameterValue("id", "path", "from-pool")),
            )
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                payloads = listOf(poolEntry),
                parameterValues = listOf(ParameterValue("id", "path", "from-legacy")),
            )

        assertEquals(
            "from-pool",
            configuration
                .primaryPayload()
                .parameterValues
                .single()
                .value,
        )
    }

    // ---- PayloadStrategy -------------------------------------------------

    @Test
    fun `PayloadStrategy fromJson accepts both lower-case strategy names`() {
        assertEquals(PayloadStrategy.SEQUENTIAL, PayloadStrategy.fromJson("sequential"))
        assertEquals(PayloadStrategy.RANDOM, PayloadStrategy.fromJson("random"))
        assertEquals(PayloadStrategy.SEQUENTIAL, PayloadStrategy.fromJson("SEQUENTIAL"))
    }

    @Test
    fun `PayloadStrategy fromJson rejects unknown values`() {
        val exception = runCatching { PayloadStrategy.fromJson("nope") }.exceptionOrNull()
        assertTrue(exception is IllegalArgumentException)
        assertTrue(exception!!.message!!.contains("Unbekannte PayloadStrategy"))
    }

    @Test
    fun `PayloadStrategy jsonName matches the wire format`() {
        assertEquals("sequential", PayloadStrategy.SEQUENTIAL.jsonName())
        assertEquals("random", PayloadStrategy.RANDOM.jsonName())
    }

    // ---- LoadProfile.payloadStrategy -------------------------------------

    @Test
    fun `LoadProfile payloadStrategy defaults to null for backward compatibility`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)
        assertNull(profile.payloadStrategy)
    }

    @Test
    fun `LoadProfile payloadStrategy round-trips both values through the data class`() {
        val sequential =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 10,
                payloadStrategy = PayloadStrategy.SEQUENTIAL,
            )
        val random = sequential.copy(payloadStrategy = PayloadStrategy.RANDOM)

        assertEquals(PayloadStrategy.SEQUENTIAL, sequential.payloadStrategy)
        assertEquals(PayloadStrategy.RANDOM, random.payloadStrategy)
    }
}
