package de.lasttest.api

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AuthRequirementTest {
    @Test
    fun `Basic and Bearer are both AuthRequirement subtypes`() {
        val basic: AuthRequirement = AuthRequirement.Basic(schemeName = "basicAuth")
        val bearer: AuthRequirement = AuthRequirement.Bearer(schemeName = "bearerAuth")
        assertEquals("basicAuth", (basic as AuthRequirement.Basic).schemeName)
        assertEquals("bearerAuth", (bearer as AuthRequirement.Bearer).schemeName)
    }

    @Test
    fun `ApiOperation bearerAuth is true when authRequirements contains a Bearer`() {
        val operation =
            ApiOperation(
                operationId = "getMe",
                method = "GET",
                path = "/me",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements = listOf(AuthRequirement.Bearer("bearerAuth")),
            )
        assertTrue(operation.bearerAuth)
    }

    @Test
    fun `ApiOperation bearerAuth is false when authRequirements only contains a Basic`() {
        val operation =
            ApiOperation(
                operationId = "getStats",
                method = "GET",
                path = "/admin/stats",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements = listOf(AuthRequirement.Basic("basicAuth")),
            )
        assertFalse(operation.bearerAuth)
    }

    @Test
    fun `ApiOperation bearerAuth is false when authRequirements is empty`() {
        val operation =
            ApiOperation(
                operationId = "public",
                method = "GET",
                path = "/public",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements = emptyList(),
            )
        assertFalse(operation.bearerAuth)
    }

    @Test
    fun `ApiOperation bearerAuth is true when authRequirements contains both Basic and Bearer`() {
        val operation =
            ApiOperation(
                operationId = "dual",
                method = "GET",
                path = "/dual",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements =
                    listOf(
                        AuthRequirement.Basic("basicAuth"),
                        AuthRequirement.Bearer("bearerAuth"),
                    ),
            )
        assertTrue(operation.bearerAuth)
    }

    @Test
    fun `ApiOperation bearerAuth is false when authRequirements only contains an ApiKey`() {
        // apiKey is a separate auth method from Bearer; the legacy
        // `bearerAuth` derived flag must NOT flip on for it so the
        // UI does not render the Bearer input for an API key endpoint.
        val operation =
            ApiOperation(
                operationId = "apiKeyOnly",
                method = "GET",
                path = "/x",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements =
                    listOf(
                        AuthRequirement.ApiKey("apiKeyAuth", "X-API-Key"),
                    ),
            )
        assertEquals(false, operation.bearerAuth)
    }

    @Test
    fun `ApiOperation bearerAuth is true when authRequirements contains OAuth2 because the wire format is identical`() {
        // OAuth2 is sent as `Authorization: Bearer <token>` on the
        // wire (RFC 6750). The legacy `bearerAuth` derived flag
        // therefore flips on so the UI still shows the credential
        // input via the existing Bearer UI path; the OAuth2 subtype
        // adds extra metadata (flows, scopes) for the banner only.
        val operation =
            ApiOperation(
                operationId = "oauth2Only",
                method = "GET",
                path = "/x",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements =
                    listOf(
                        AuthRequirement.OAuth2(
                            schemeName = "oauth2",
                            flows =
                                listOf(
                                    AuthRequirement.OAuth2Flow(
                                        type = "clientCredentials",
                                        tokenUrl = "https://example.test/oauth/token",
                                        scopes = listOf("read"),
                                    ),
                                ),
                        ),
                    ),
            )
        assertEquals(true, operation.bearerAuth)
    }

    @Test
    fun `ApiOperation bearerAuth is true when authRequirements contains an OpenIdConnect because the wire format is identical`() {
        val operation =
            ApiOperation(
                operationId = "oidcOnly",
                method = "GET",
                path = "/x",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements =
                    listOf(
                        AuthRequirement.OpenIdConnect(
                            schemeName = "oidcAuth",
                            openIdConnectUrl = "https://example.test/.well-known/openid-configuration",
                            scopes = listOf("openid", "profile"),
                        ),
                    ),
            )
        assertEquals(true, operation.bearerAuth)
    }

    @Test
    fun `authRequirements serialise with a kind discriminator that the frontend can switch on`() {
        val mapper = ObjectMapper()
        val requirements =
            listOf(
                AuthRequirement.Basic("basicAuth"),
                AuthRequirement.Bearer("bearerAuth"),
                AuthRequirement.ApiKey("apiKeyAuth", "X-API-Key"),
                AuthRequirement.OAuth2(
                    schemeName = "oauth2",
                    flows =
                        listOf(
                            AuthRequirement.OAuth2Flow(
                                type = "clientCredentials",
                                tokenUrl = "https://example.test/oauth/token",
                                scopes = listOf("read:products", "write:products"),
                            ),
                        ),
                ),
                AuthRequirement.OpenIdConnect(
                    schemeName = "oidcAuth",
                    openIdConnectUrl = "https://example.test/.well-known/openid-configuration",
                    scopes = listOf("openid", "profile"),
                ),
                AuthRequirement.Unsupported("mutualTls", "type=mutualTls"),
            )

        val json = mapper.writeValueAsString(requirements)
        assertTrue(json.contains("\"kind\":\"basic\""))
        assertTrue(json.contains("\"kind\":\"bearer\""))
        assertTrue(json.contains("\"kind\":\"apiKey\""))
        assertTrue(json.contains("\"kind\":\"oauth2\""))
        assertTrue(json.contains("\"kind\":\"openIdConnect\""))
        assertTrue(json.contains("\"kind\":\"unsupported\""))
        assertFalse(json.contains("AuthRequirement\$Basic"))
    }
}
