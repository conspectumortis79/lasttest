package de.lasttest.domain

import de.lasttest.api.AuthRequirement
import io.swagger.v3.oas.models.security.SecurityScheme

/**
 * Maps a single Swagger / OpenAPI security scheme declaration to the
 * internal [AuthRequirement] the rest of the pipeline understands.
 *
 * Pulled out of [SwaggerSpecificationImporter] so this single
 * responsibility (recognise the wire format of an auth scheme) stays
 * in one place. Adding support for a new scheme is a single
 * `when`-branch here plus a new [AuthRequirement] subtype — the
 * importer, generator, payload pool and report don't need to change.
 *
 * The `internal` visibility keeps the classifier from leaking into
 * the public API; only the importer, its tests and the
 * `AuthSchemeClassifierTest` are supposed to use it.
 */
internal object AuthSchemeClassifier {
    /**
     * Classify one scheme. The `schemeName` is the key under which the
     * scheme was declared in `components.securitySchemes` (OAS 3) or
     * `securityDefinitions` (Swagger 2). It is preserved on the
     * resulting [AuthRequirement] for diagnostic / report purposes.
     */
    fun classify(
        schemeName: String,
        scheme: SecurityScheme,
    ): AuthRequirement =
        when {
            isHttpBasic(scheme) -> AuthRequirement.Basic(schemeName)
            isHttpBearer(scheme) -> AuthRequirement.Bearer(schemeName)
            // The historical exception: when an apiKey is declared
            // in the `Authorization` header the spec is, by
            // convention, just a non-JWT bearer token. Keep that
            // mapping so the UI does not render an "API key" column
            // for what the spec really means as a bearer.
            isAuthorizationHeaderApiKey(scheme) -> AuthRequirement.Bearer(schemeName)
            isHeaderApiKey(scheme) -> AuthRequirement.ApiKey(schemeName, scheme.name)
            isOAuth2(scheme) -> AuthRequirement.OAuth2(schemeName, parseFlows(scheme))
            isOpenIdConnect(scheme) -> parseOpenIdConnect(scheme).copy(schemeName = schemeName)
            else -> AuthRequirement.Unsupported(schemeName, describe(scheme))
        }

    private fun isOAuth2(scheme: SecurityScheme): Boolean = scheme.type == SecurityScheme.Type.OAUTH2

    private fun isOpenIdConnect(scheme: SecurityScheme): Boolean = scheme.type == SecurityScheme.Type.OPENIDCONNECT

    /**
     * Returns the OpenID Connect discovery URL together with the
     * scopes the spec declared on the scheme. The Swagger model
     * exposes `openIdConnectUrl` as a single string, so the only
     * metadata we can surface to the UI is that URL plus any
     * scopes that were declared inline. The discovery URL is
     * preserved verbatim — a relative URL is the spec's problem,
     * not the classifier's, and a k6 script does not follow it
     * (the user pastes a pre-acquired ID token into the UI).
     *
     * The `schemeName` is a placeholder; the caller in [classify]
     * overwrites it with the key under which the scheme was
     * declared in the spec. The field exists on the wire shape
     * only so the UI can switch on it alongside Basic / Bearer /
     * OAuth2.
     */
    private fun parseOpenIdConnect(scheme: SecurityScheme): AuthRequirement.OpenIdConnect {
        val discoveryUrl = scheme.openIdConnectUrl?.takeIf { it.isNotBlank() } ?: ""
        val scopes =
            scheme.flows
                ?.authorizationCode
                ?.scopes
                ?.keys
                ?.toList()
                ?: emptyList()
        return AuthRequirement.OpenIdConnect(
            schemeName = "", // overwritten in classify()
            openIdConnectUrl = discoveryUrl,
            scopes = scopes,
        )
    }

    /**
     * Translate the [io.swagger.v3.oas.models.security.OAuthFlows]
     * map on the spec into a flat list of [AuthRequirement.OAuth2Flow]
     * for the wire. The map's keys are the flow type names
     * (`implicit`, `password`, `clientCredentials`,
     * `authorizationCode`); we project them into a list so the
     * frontend can render them in a stable order without iterating
     * a map.
     */
    private fun parseFlows(scheme: SecurityScheme): List<AuthRequirement.OAuth2Flow> {
        val flows = scheme.flows ?: return emptyList()
        val result = mutableListOf<AuthRequirement.OAuth2Flow>()
        flows.implicit?.let { flow ->
            result +=
                AuthRequirement.OAuth2Flow(
                    type = "implicit",
                    authorizationUrl = flow.authorizationUrl,
                    refreshUrl = flow.refreshUrl,
                    scopes =
                        flow.scopes
                            .orEmpty()
                            .keys
                            .toList(),
                )
        }
        flows.password?.let { flow ->
            result +=
                AuthRequirement.OAuth2Flow(
                    type = "password",
                    tokenUrl = flow.tokenUrl,
                    refreshUrl = flow.refreshUrl,
                    scopes =
                        flow.scopes
                            .orEmpty()
                            .keys
                            .toList(),
                )
        }
        flows.clientCredentials?.let { flow ->
            result +=
                AuthRequirement.OAuth2Flow(
                    type = "clientCredentials",
                    tokenUrl = flow.tokenUrl,
                    refreshUrl = flow.refreshUrl,
                    scopes =
                        flow.scopes
                            .orEmpty()
                            .keys
                            .toList(),
                )
        }
        flows.authorizationCode?.let { flow ->
            result +=
                AuthRequirement.OAuth2Flow(
                    type = "authorizationCode",
                    authorizationUrl = flow.authorizationUrl,
                    tokenUrl = flow.tokenUrl,
                    refreshUrl = flow.refreshUrl,
                    scopes =
                        flow.scopes
                            .orEmpty()
                            .keys
                            .toList(),
                )
        }
        return result
    }

    private fun isHttpBasic(scheme: SecurityScheme): Boolean =
        scheme.type == SecurityScheme.Type.HTTP &&
            scheme.scheme.equals("basic", ignoreCase = true)

    private fun isHttpBearer(scheme: SecurityScheme): Boolean =
        scheme.type == SecurityScheme.Type.HTTP &&
            scheme.scheme.equals("bearer", ignoreCase = true)

    private fun isAuthorizationHeaderApiKey(scheme: SecurityScheme): Boolean =
        scheme.type == SecurityScheme.Type.APIKEY &&
            scheme.`in` == SecurityScheme.In.HEADER &&
            scheme.name.equals("Authorization", ignoreCase = true)

    /**
     * Real-world API key pattern: a custom header (Stripe: `Authorization`
     * *but* as a Stripe key, GitHub: `X-API-Key`, Twilio: `X-Twilio-Token`,
     * …). The spec writes these as `apiKey in: header, name: <X>`. We
     * carry the header name forward so the k6 generator can emit it
     * verbatim.
     */
    private fun isHeaderApiKey(scheme: SecurityScheme): Boolean =
        scheme.type == SecurityScheme.Type.APIKEY &&
            scheme.`in` == SecurityScheme.In.HEADER &&
            scheme.name.isNotBlank()

    private fun describe(scheme: SecurityScheme): String =
        buildString {
            append("type=")
            append(scheme.type)
            scheme.scheme?.let { append(", scheme=").append(it) }
            scheme.`in`?.let { append(", in=").append(it) }
            scheme.name?.let { append(", name=").append(it) }
        }
}
