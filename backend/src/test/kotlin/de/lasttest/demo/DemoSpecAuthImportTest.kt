package de.lasttest.demo

import de.lasttest.api.AuthRequirement
import de.lasttest.domain.SwaggerSpecificationImporter
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DemoSpecAuthImportTest {
    @Test
    fun `bundled demo spec declares all four security schemes and the importer classifies each correctly`() {
        val spec =
            SwaggerSpecificationImporter().import(
                java.io.File("../demo/openapi-demo.yaml").readText(),
            )

        val schemes = spec.operations
        val bearer = schemes.first { it.operationId == "searchProducts" }
        val basic = schemes.first { it.operationId == "getAdminStats" }
        val apiKey = schemes.first { it.operationId == "lookupProduct" }
        val oauth2 = schemes.first { it.operationId == "getMe" }

        assertEquals(
            listOf(AuthRequirement.Bearer("bearerAuth")),
            bearer.authRequirements,
        )
        assertTrue(bearer.bearerAuth)

        assertEquals(
            listOf(AuthRequirement.Basic("basicAuth")),
            basic.authRequirements,
        )
        assertTrue(basic.authRequirements.any { it is AuthRequirement.Basic })

        assertEquals(1, apiKey.authRequirements.size)
        val apiKeyReq = apiKey.authRequirements.single()
        assertTrue(apiKeyReq is AuthRequirement.ApiKey)
        assertEquals("X-API-Key", apiKeyReq.headerName)

        assertEquals(1, oauth2.authRequirements.size)
        val oauth2Req = oauth2.authRequirements.single()
        assertTrue(oauth2Req is AuthRequirement.OAuth2)
        assertEquals(listOf("clientCredentials", "authorizationCode"), oauth2Req.flows.map { it.type })
        val clientCredsFlow = oauth2Req.flows.first { it.type == "clientCredentials" }
        assertEquals(listOf("read:products", "write:products"), clientCredsFlow.scopes)

        assertTrue(oauth2.bearerAuth)

        assertEquals(10, spec.operations.size)

        val oidc = schemes.first { it.operationId == "getMyProfile" }
        assertEquals(1, oidc.authRequirements.size)
        val oidcReq = oidc.authRequirements.single()
        assertTrue(oidcReq is AuthRequirement.OpenIdConnect)
        assertEquals("oidcAuth", oidcReq.schemeName)
        assertEquals(
            "http://localhost:8286/demo-api/.well-known/openid-configuration",
            oidcReq.openIdConnectUrl,
        )
        assertTrue(oidc.bearerAuth)
    }
}
