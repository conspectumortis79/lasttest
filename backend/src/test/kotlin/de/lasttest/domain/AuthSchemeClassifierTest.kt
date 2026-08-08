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
        // The flow's authorizationUrl is preserved so the banner
        // can render it; the implicit flow is the only one that
        // carries an authorizationUrl in the spec.
        assertEquals(1, oauth2.flows.size)
        val flow = oauth2.flows.single()
        assertEquals("implicit", flow.type)
        assertEquals("https://example.test/oauth/authorize", flow.authorizationUrl)
    }

    @Test
    fun `non-Authorization header apiKey is classified as ApiKey with the custom header name`() {
        // Real-world pattern: GitHub, Stripe, Twilio, … all use a
        // custom header name. The classifier picks it up so the k6
        // generator can emit `X-API-Key: …` (or whatever name the
        // spec declared) verbatim.
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
        // The current MVP only handles header-based apiKey. Anything
        // else (query, cookie) is documented as Unsupported so the
        // user is not silently misled by a "no header sent" run.
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
        // The spec model exposes scopes as a `Map<String, String>` on
        // the wire; populate it via reflection-free setters to keep
        // the test focused on the classifier behaviour.
        scheme.flows.clientCredentials.scopes["read:products"] = "Read products"
        scheme.flows.clientCredentials.scopes["write:products"] = "Write products"
        val requirement = AuthSchemeClassifier.classify("oauth2", scheme)
        assertTrue(requirement is AuthRequirement.OAuth2)
        val oauth2: AuthRequirement.OAuth2 = requirement
        assertEquals("oauth2", oauth2.schemeName)
        // The flows list surfaces the spec data so the banner can
        // render the flow name and the available scopes. The order
        // matches the order the spec declares them.
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
        // OpenID Connect is declared as
        // `type: openIdConnect, openIdConnectUrl: <discovery URL>`.
        // The classifier must surface the URL on the resulting
        // requirement so the banner can show "this is an OIDC
        // endpoint" alongside the discovery URL.
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
        // OIDC scopes are declared on the `authorizationCode` flow
        // (the only one Swagger v3 models for an `openIdConnect`
        // security scheme). The classifier pulls them out so the
        // banner can render them next to the discovery URL.
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
        // A spec might leave `openIdConnectUrl` empty (or omit it
        // entirely) — the classifier must still produce an
        // OpenIdConnect requirement so the UI can render the ID
        // token input, just with an empty discovery URL. The user
        // can then type whatever URL they used to obtain the
        // token.
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
