package de.lasttest.demo

import de.lasttest.api.AuthRequirement
import de.lasttest.domain.SwaggerSpecificationImporter
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * End-to-end verification that the bundled
 * [demo/openapi-demo.yaml] is the import contract we expect:
 *  - four distinct security schemes declared (Bearer, Basic,
 *    API-Key, OAuth 2.0)
 *  - each demo endpoint carries the right `security` reference
 *  - the importer classifies every scheme to the dedicated
 *    `AuthRequirement` subtype
 *
 * This test loads the YAML by reading the file at the gradle
 * working directory (the `backend/` module is the working
 * directory under `./gradlew test`). If the file is renamed or
 * moved, this test fails loudly with a `FileNotFoundException`
 * — which is exactly what we want.
 */
class DemoSpecAuthImportTest {
    @Test
    fun `bundled demo spec declares all four security schemes and the importer classifies each correctly`() {
        val spec =
            SwaggerSpecificationImporter().import(
                java.io.File("../demo/openapi-demo.yaml").readText(),
            )

        // --- Spec-level: every scheme is declared -------------------------
        val schemes = spec.operations
        val bearer = schemes.first { it.operationId == "searchProducts" }
        val basic = schemes.first { it.operationId == "getAdminStats" }
        val apiKey = schemes.first { it.operationId == "lookupProduct" }
        val oauth2 = schemes.first { it.operationId == "getMe" }

        // --- searchProducts / Bearer -----------------------------------
        assertEquals(
            listOf(AuthRequirement.Bearer("bearerAuth")),
            bearer.authRequirements,
        )
        assertTrue(bearer.bearerAuth)

        // --- getAdminStats / Basic --------------------------------------
        assertEquals(
            listOf(AuthRequirement.Basic("basicAuth")),
            basic.authRequirements,
        )
        assertTrue(basic.authRequirements.any { it is AuthRequirement.Basic })

        // --- lookupProduct / API Key (header) --------------------------
        assertEquals(1, apiKey.authRequirements.size)
        val apiKeyReq = apiKey.authRequirements.single()
        assertTrue(apiKeyReq is AuthRequirement.ApiKey)
        assertEquals("X-API-Key", apiKeyReq.headerName)

        // --- getMe / OAuth 2.0 -----------------------------------------
        assertEquals(1, oauth2.authRequirements.size)
        val oauth2Req = oauth2.authRequirements.single()
        assertTrue(oauth2Req is AuthRequirement.OAuth2)
        // The spec declares two flows (clientCredentials +
        // authorizationCode). The importer surfaces them in the
        // order the spec declares them so the banner can render
        // them deterministically.
        assertEquals(listOf("clientCredentials", "authorizationCode"), oauth2Req.flows.map { it.type })
        // Scopes are carried through so the demo banner can show
        // the user what their token grants access to.
        val clientCredsFlow = oauth2Req.flows.first { it.type == "clientCredentials" }
        assertEquals(listOf("read:products", "write:products"), clientCredsFlow.scopes)

        // --- getMe: also flips `bearerAuth` because the wire
        //     format is `Authorization: Bearer <token>` (RFC 6750).
        assertTrue(oauth2.bearerAuth)

        // --- Total operation count for sanity --------------------------
        // 6 product endpoints + 4 auth-demo endpoints = 10.
        //  - searchProducts (Bearer)
        //  - getAdminStats (Basic)
        //  - lookupProduct (API Key)
        //  - getMe (OAuth 2.0)
        //  - getMyProfile (OIDC)
        assertEquals(10, spec.operations.size)

        // --- getMyProfile / OpenID Connect ----------------------------
        val oidc = schemes.first { it.operationId == "getMyProfile" }
        assertEquals(1, oidc.authRequirements.size)
        val oidcReq = oidc.authRequirements.single()
        assertTrue(oidcReq is AuthRequirement.OpenIdConnect)
        assertEquals("oidcAuth", oidcReq.schemeName)
        assertEquals(
            "http://localhost:8286/demo-api/.well-known/openid-configuration",
            oidcReq.openIdConnectUrl,
        )
        // OIDC ID token rides the same wire format as Bearer /
        // OAuth 2.0 (RFC 6750), so the derived `bearerAuth`
        // flag must flip on for the legacy UI path.
        assertTrue(oidc.bearerAuth)
    }
}
