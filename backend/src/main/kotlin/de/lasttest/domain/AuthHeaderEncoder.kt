package de.lasttest.domain

import de.lasttest.api.AuthRequirement
import java.util.Base64

internal object AuthHeaderEncoder {
    const val BEARER_PREFIX = "Bearer "
    const val BASIC_PREFIX = "Basic "

    fun encode(
        requirements: List<AuthRequirement>,
        credentials: AuthCredentials,
    ): String? {
        for (requirement in requirements) {
            val value = encodeOne(requirement, credentials) ?: continue
            return value
        }
        return null
    }

    private fun encodeOne(
        requirement: AuthRequirement,
        credentials: AuthCredentials,
    ): String? =
        when (requirement) {
            is AuthRequirement.Bearer -> encodeBearer(credentials.bearerToken)
            is AuthRequirement.Basic -> encodeBasic(credentials.basicUsername, credentials.basicPassword)
            is AuthRequirement.ApiKey -> null // apiKey does NOT live in Authorization
            is AuthRequirement.OAuth2 -> encodeBearer(credentials.oauth2Token)
            is AuthRequirement.OpenIdConnect -> encodeBearer(credentials.oidcIdToken)
            is AuthRequirement.Unsupported -> null
        }

    private fun encodeBearer(rawToken: String?): String? {
        val token = rawToken?.trim().orEmpty()
        if (token.isEmpty()) return null

        return if (token.startsWith(BEARER_PREFIX, ignoreCase = true)) {
            BEARER_PREFIX + token.substring(BEARER_PREFIX.length)
        } else {
            "$BEARER_PREFIX$token"
        }
    }

    private fun encodeBasic(
        rawUsername: String?,
        rawPassword: String?,
    ): String? {
        val username = rawUsername?.trim().orEmpty()
        val password = rawPassword?.trim().orEmpty()
        if (username.isEmpty() && password.isEmpty()) return null
        val token = "$username:$password".toByteArray(Charsets.UTF_8)
        return BASIC_PREFIX + Base64.getEncoder().encodeToString(token)
    }

    fun encodeApiKey(rawKey: String?): String? {
        val key = rawKey?.trim().orEmpty()
        return key.takeIf { it.isNotEmpty() }
    }

    fun encodeApiKeyHeaderName(requirements: List<AuthRequirement>): String? =
        requirements
            .firstOrNull { it is AuthRequirement.ApiKey }
            ?.let { (it as AuthRequirement.ApiKey).headerName }

    data class AuthCredentials(
        val bearerToken: String? = null,
        val basicUsername: String? = null,
        val basicPassword: String? = null,
        val apiKey: String? = null,
        val oauth2Token: String? = null,
        val oidcIdToken: String? = null,
    )
}
