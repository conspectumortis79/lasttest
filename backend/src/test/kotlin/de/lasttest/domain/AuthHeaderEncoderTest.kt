package de.lasttest.domain

import de.lasttest.api.AuthRequirement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AuthHeaderEncoderTest {
    @Test
    fun `emits Bearer prefix for non-prefixed bearer token`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Bearer("bearerAuth")),
                AuthHeaderEncoder.AuthCredentials(bearerToken = "abc"),
            )
        assertEquals("Bearer abc", header)
    }

    @Test
    fun `does not double-prefix a bearer token that already carries the prefix`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Bearer("bearerAuth")),
                AuthHeaderEncoder.AuthCredentials(bearerToken = "Bearer abc"),
            )
        assertEquals("Bearer abc", header)
    }

    @Test
    fun `treats bearer prefix as case-insensitive on the incoming token`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Bearer("bearerAuth")),
                AuthHeaderEncoder.AuthCredentials(bearerToken = "bearer abc"),
            )
        assertEquals("Bearer abc", header)
    }

    @Test
    fun `blank bearer token produces no header`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Bearer("bearerAuth")),
                AuthHeaderEncoder.AuthCredentials(bearerToken = "   "),
            )
        assertNull(header)
    }

    @Test
    fun `emits base64 encoded Basic header for username and password`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Basic("basicAuth")),
                AuthHeaderEncoder.AuthCredentials(basicUsername = "alice", basicPassword = "s3cret"),
            )
        assertEquals("Basic YWxpY2U6czNjcmV0", header)
    }

    @Test
    fun `emits Basic header with empty password when only username is given`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Basic("basicAuth")),
                AuthHeaderEncoder.AuthCredentials(basicUsername = "alice", basicPassword = ""),
            )
        assertEquals("Basic YWxpY2U6", header)
    }

    @Test
    fun `emits Basic header with empty username when only password is given`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Basic("basicAuth")),
                AuthHeaderEncoder.AuthCredentials(basicUsername = "", basicPassword = "s3cret"),
            )
        assertEquals("Basic OnMzY3JldA==", header)
    }

    @Test
    fun `blank basic credentials produce no header`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Basic("basicAuth")),
                AuthHeaderEncoder.AuthCredentials(basicUsername = "  ", basicPassword = " "),
            )
        assertNull(header)
    }

    @Test
    fun `unsupported requirements are skipped even when credentials are present`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Unsupported("oauth2", "type=oauth2")),
                AuthHeaderEncoder.AuthCredentials(basicUsername = "alice", basicPassword = "s3cret"),
            )
        assertNull(header)
    }

    @Test
    fun `first satisfied requirement wins when Basic and Bearer are both declared`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(
                    AuthRequirement.Basic("basicAuth"),
                    AuthRequirement.Bearer("bearerAuth"),
                ),
                AuthHeaderEncoder.AuthCredentials(
                    bearerToken = "abc",
                    basicUsername = "alice",
                    basicPassword = "s3cret",
                ),
            )
        assertEquals("Basic YWxpY2U6czNjcmV0", header)
    }

    @Test
    fun `falls through to Bearer when Basic is declared but credentials are blank`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(
                    AuthRequirement.Basic("basicAuth"),
                    AuthRequirement.Bearer("bearerAuth"),
                ),
                AuthHeaderEncoder.AuthCredentials(
                    bearerToken = "abc",
                    basicUsername = "",
                    basicPassword = "",
                ),
            )
        assertEquals("Bearer abc", header)
    }

    @Test
    fun `utf-8 username and password are base64 encoded correctly`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Basic("basicAuth")),
                AuthHeaderEncoder.AuthCredentials(basicUsername = "alfred", basicPassword = "passwörd"),
            )
        assertEquals("Basic YWxmcmVkOnBhc3N3w7ZyZA==", header)
    }

    @Test
    fun `apiKey requirement does not contribute to the Authorization header`() {
        val authValue =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.ApiKey("apiKeyAuth", "X-API-Key")),
                AuthHeaderEncoder.AuthCredentials(apiKey = "sk-test-abc123"),
            )
        assertNull(authValue)

        assertEquals("X-API-Key", AuthHeaderEncoder.encodeApiKeyHeaderName(listOf(AuthRequirement.ApiKey("apiKeyAuth", "X-API-Key"))))
        assertEquals("sk-test-abc123", AuthHeaderEncoder.encodeApiKey("sk-test-abc123"))
    }

    @Test
    fun `blank apiKey value produces no contribution`() {
        assertNull(AuthHeaderEncoder.encodeApiKey("   "))
        assertNull(AuthHeaderEncoder.encodeApiKey(""))
        assertNull(AuthHeaderEncoder.encodeApiKey(null))
    }

    @Test
    fun `apiKey and Bearer are independent, the configured one wins per channel`() {
        val reqs =
            listOf(
                AuthRequirement.ApiKey("apiKeyAuth", "X-API-Key"),
                AuthRequirement.Bearer("bearerAuth"),
            )

        val authValue =
            AuthHeaderEncoder.encode(
                reqs,
                AuthHeaderEncoder.AuthCredentials(
                    bearerToken = "abc",
                    apiKey = "sk-test-abc123",
                ),
            )
        assertEquals("Bearer abc", authValue)
        assertEquals("sk-test-abc123", AuthHeaderEncoder.encodeApiKey("sk-test-abc123"))
    }

    @Test
    fun `encodeApiKeyHeaderName returns null when no apiKey requirement is present`() {
        assertNull(AuthHeaderEncoder.encodeApiKeyHeaderName(emptyList()))
        assertNull(AuthHeaderEncoder.encodeApiKeyHeaderName(listOf(AuthRequirement.Bearer("bearer"))))
    }

    @Test
    fun `oauth2 token uses the same Bearer wire format as plain Bearer`() {
        val oauth2Value =
            AuthHeaderEncoder.encode(
                listOf(
                    AuthRequirement.OAuth2(
                        schemeName = "oauth2",
                        flows =
                            listOf(
                                AuthRequirement.OAuth2Flow(type = "clientCredentials", tokenUrl = "https://x"),
                            ),
                    ),
                ),
                AuthHeaderEncoder.AuthCredentials(oauth2Token = "demo-oauth2-token-12345"),
            )
        assertEquals("Bearer demo-oauth2-token-12345", oauth2Value)

        val plainBearer =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Bearer("bearer")),
                AuthHeaderEncoder.AuthCredentials(bearerToken = "demo-oauth2-token-12345"),
            )
        assertEquals(oauth2Value, plainBearer)
    }

    @Test
    fun `blank oauth2 token produces no contribution`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.OAuth2("oauth2")),
                AuthHeaderEncoder.AuthCredentials(oauth2Token = "   "),
            )
        assertNull(header)
    }

    @Test
    fun `oauth2 token does not bleed into the Bearer field`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.OAuth2("oauth2")),
                AuthHeaderEncoder.AuthCredentials(
                    bearerToken = "should-be-ignored",
                    oauth2Token = "real-token",
                ),
            )
        assertEquals("Bearer real-token", header)
    }

    @Test
    fun `openIdConnect id token uses the same Bearer wire format as plain Bearer and OAuth2`() {
        val oidcValue =
            AuthHeaderEncoder.encode(
                listOf(
                    AuthRequirement.OpenIdConnect(
                        schemeName = "oidcAuth",
                        openIdConnectUrl = "https://example.test/.well-known/openid-configuration",
                    ),
                ),
                AuthHeaderEncoder.AuthCredentials(oidcIdToken = "demo-oidc-id-token-12345"),
            )
        assertEquals("Bearer demo-oidc-id-token-12345", oidcValue)

        val plainBearer =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.Bearer("bearer")),
                AuthHeaderEncoder.AuthCredentials(bearerToken = "demo-oidc-id-token-12345"),
            )
        assertEquals(oidcValue, plainBearer)

        val oauth2 =
            AuthHeaderEncoder.encode(
                listOf(AuthRequirement.OAuth2("oauth2")),
                AuthHeaderEncoder.AuthCredentials(oauth2Token = "demo-oidc-id-token-12345"),
            )
        assertEquals(oidcValue, oauth2)
    }

    @Test
    fun `blank openIdConnect id token produces no contribution`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(
                    AuthRequirement.OpenIdConnect(
                        schemeName = "oidcAuth",
                        openIdConnectUrl = "https://example.test/.well-known/openid-configuration",
                    ),
                ),
                AuthHeaderEncoder.AuthCredentials(oidcIdToken = "   "),
            )
        assertNull(header)
    }

    @Test
    fun `openIdConnect id token does not bleed into the Bearer or OAuth2 fields`() {
        val header =
            AuthHeaderEncoder.encode(
                listOf(
                    AuthRequirement.OpenIdConnect(
                        schemeName = "oidcAuth",
                        openIdConnectUrl = "https://example.test/.well-known/openid-configuration",
                    ),
                ),
                AuthHeaderEncoder.AuthCredentials(
                    bearerToken = "should-be-ignored",
                    oauth2Token = "should-also-be-ignored",
                    oidcIdToken = "real-id-token",
                ),
            )
        assertEquals("Bearer real-id-token", header)
    }
}
