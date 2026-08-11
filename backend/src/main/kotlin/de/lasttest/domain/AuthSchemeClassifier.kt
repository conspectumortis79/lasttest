package de.lasttest.domain

import de.lasttest.api.AuthRequirement
import io.swagger.v3.oas.models.security.SecurityScheme

internal object AuthSchemeClassifier {
    fun classify(
        schemeName: String,
        scheme: SecurityScheme,
    ): AuthRequirement =
        when {
            isHttpBasic(scheme) -> AuthRequirement.Basic(schemeName)
            isHttpBearer(scheme) -> AuthRequirement.Bearer(schemeName)
            isAuthorizationHeaderApiKey(scheme) -> AuthRequirement.Bearer(schemeName)
            isHeaderApiKey(scheme) -> AuthRequirement.ApiKey(schemeName, scheme.name)
            isOAuth2(scheme) -> AuthRequirement.OAuth2(schemeName, parseFlows(scheme))
            isOpenIdConnect(scheme) -> parseOpenIdConnect(scheme).copy(schemeName = schemeName)
            else -> AuthRequirement.Unsupported(schemeName, describe(scheme))
        }

    private fun isOAuth2(scheme: SecurityScheme): Boolean = scheme.type == SecurityScheme.Type.OAUTH2

    private fun isOpenIdConnect(scheme: SecurityScheme): Boolean = scheme.type == SecurityScheme.Type.OPENIDCONNECT

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
            schemeName = "",
            openIdConnectUrl = discoveryUrl,
            scopes = scopes,
        )
    }

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
