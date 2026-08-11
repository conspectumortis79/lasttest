package de.lasttest.domain

import de.lasttest.api.AuthRequirement
import io.swagger.v3.oas.models.security.SecurityScheme
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AuthSchemeClassifierTest {
    @Test
    fun `http basic scheme is classified as Basic`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.HTTP
                this.scheme = "basic"
            }
        val requirement = AuthSchemeClassifier.classify("basicAuth", scheme)
        assertEquals(AuthRequirement.Basic("basicAuth"), requirement)
    }

    @Test
    fun `http basic scheme name match is case-insensitive`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.HTTP
                this.scheme = "BASIC"
            }
        val requirement = AuthSchemeClassifier.classify("basicAuth", scheme)
        assertTrue(requirement is AuthRequirement.Basic)
    }

    @Test
    fun `http bearer scheme is classified as Bearer`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.HTTP
                this.scheme = "bearer"
            }
        val requirement = AuthSchemeClassifier.classify("bearerAuth", scheme)
        assertEquals(AuthRequirement.Bearer("bearerAuth"), requirement)
    }

    @Test
    fun `Authorization header apiKey is classified as Bearer`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.APIKEY
                `in` = SecurityScheme.In.HEADER
                name = "Authorization"
            }
        val requirement = AuthSchemeClassifier.classify("apiKeyAuth", scheme)
        assertEquals(AuthRequirement.Bearer("apiKeyAuth"), requirement)
    }

    @Test
    fun `oauth2 scheme is classified as OAuth2 with the declared flows`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.OAUTH2
                flows =
                    io.swagger.v3.oas.models.security.OAuthFlows().apply {
                        implicit =
                            io.swagger.v3.oas.models.security.OAuthFlow().apply {
                                authorizationUrl = "https://example.test/oauth/authorize"
                            }
                    }
            }
        val requirement = AuthSchemeClassifier.classify("oauth2", scheme)
        assertTrue(requirement is AuthRequirement.OAuth2)
        val oauth2: AuthRequirement.OAuth2 = requirement
        assertEquals("oauth2", oauth2.schemeName)
        assertEquals(1, oauth2.flows.size)
        val flow = oauth2.flows.single()
        assertEquals("implicit", flow.type)
        assertEquals("https://example.test/oauth/authorize", flow.authorizationUrl)
    }

    @Test
    fun `non-Authorization header apiKey is classified as ApiKey with the custom header name`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.APIKEY
                `in` = SecurityScheme.In.HEADER
                name = "X-Api-Key"
            }
        val requirement = AuthSchemeClassifier.classify("apiKeyAuth", scheme)
        assertTrue(requirement is AuthRequirement.ApiKey)
        assertEquals("X-Api-Key", requirement.headerName)
    }

    @Test
    fun `query apiKey is classified as Unsupported until we add first-class support`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.APIKEY
                `in` = SecurityScheme.In.QUERY
                name = "api_key"
            }
        val requirement = AuthSchemeClassifier.classify("apiKeyAuth", scheme)
        assertTrue(requirement is AuthRequirement.Unsupported)
    }

    @Test
    fun `oauth2 scheme is classified as OAuth2 with its flows`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.OAUTH2
                flows =
                    io.swagger.v3.oas.models.security.OAuthFlows().apply {
                        clientCredentials =
                            io.swagger.v3.oas.models.security.OAuthFlow().apply {
                                tokenUrl = "https://example.test/oauth/token"
                                scopes =
                                    io.swagger.v3.oas.models.security
                                        .Scopes()
                            }
                    }
            }
        scheme.flows.clientCredentials.scopes["read:products"] = "Read products"
        scheme.flows.clientCredentials.scopes["write:products"] = "Write products"
        val requirement = AuthSchemeClassifier.classify("oauth2", scheme)
        assertTrue(requirement is AuthRequirement.OAuth2)
        val oauth2: AuthRequirement.OAuth2 = requirement
        assertEquals("oauth2", oauth2.schemeName)
        assertEquals(1, oauth2.flows.size)
        val flow = oauth2.flows.single()
        assertEquals("clientCredentials", flow.type)
        assertEquals("https://example.test/oauth/token", flow.tokenUrl)
        assertEquals(listOf("read:products", "write:products"), flow.scopes)
    }

    @Test
    fun `oauth2 with no flows still classifies as OAuth2`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.OAUTH2
            }
        val requirement = AuthSchemeClassifier.classify("oauth2", scheme)
        assertTrue(requirement is AuthRequirement.OAuth2)
        assertEquals(emptyList(), requirement.flows)
    }

    @Test
    fun `openIdConnect scheme is classified as OpenIdConnect with its discovery URL`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.OPENIDCONNECT
                openIdConnectUrl = "https://example.test/.well-known/openid-configuration"
            }
        val requirement = AuthSchemeClassifier.classify("oidcAuth", scheme)
        assertTrue(requirement is AuthRequirement.OpenIdConnect)
        val oidc: AuthRequirement.OpenIdConnect = requirement
        assertEquals("oidcAuth", oidc.schemeName)
        assertEquals("https://example.test/.well-known/openid-configuration", oidc.openIdConnectUrl)
        assertEquals(emptyList(), oidc.scopes)
    }

    @Test
    fun `openIdConnect scheme surfaces scopes declared on the authorizationCode flow`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.OPENIDCONNECT
                openIdConnectUrl = "https://example.test/.well-known/openid-configuration"
                flows =
                    io.swagger.v3.oas.models.security.OAuthFlows().apply {
                        authorizationCode =
                            io.swagger.v3.oas.models.security.OAuthFlow().apply {
                                authorizationUrl = "https://example.test/oauth/authorize"
                                tokenUrl = "https://example.test/oauth/token"
                                scopes =
                                    io.swagger.v3.oas.models.security
                                        .Scopes()
                            }
                    }
            }
        val oidcScopes = scheme.flows.authorizationCode.scopes
        oidcScopes["openid"] = "Sign in"
        oidcScopes["profile"] = "Read profile"
        oidcScopes["email"] = "Read email"

        val requirement = AuthSchemeClassifier.classify("oidcAuth", scheme)
        assertTrue(requirement is AuthRequirement.OpenIdConnect)
        val oidc: AuthRequirement.OpenIdConnect = requirement
        assertEquals(
            listOf("openid", "profile", "email"),
            oidc.scopes,
        )
    }

    @Test
    fun `openIdConnect scheme with a blank discovery URL still classifies as OpenIdConnect`() {
        val scheme =
            SecurityScheme().apply {
                type = SecurityScheme.Type.OPENIDCONNECT
            }
        val requirement = AuthSchemeClassifier.classify("oidcAuth", scheme)
        assertTrue(requirement is AuthRequirement.OpenIdConnect)
        val oidc: AuthRequirement.OpenIdConnect = requirement
        assertEquals("", oidc.openIdConnectUrl)
        assertEquals(emptyList(), oidc.scopes)
    }
}
