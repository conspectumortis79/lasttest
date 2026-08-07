package de.lasttest.domain

import de.lasttest.api.AuthRequirement
import java.util.Base64

/**
 * Single source of truth for turning a configured payload's auth
 * credentials into the value of the `Authorization` header. Pulled
 * out of [DefaultK6ScriptGenerator] so the wire-format knowledge
 * (Base64, "Bearer " prefix, etc.) lives in one file and is unit
 * tested in isolation.
 *
 * SOLID notes:
 *  - S — this object has exactly one responsibility: encoding.
 *  - O — new auth types are added by extending [AuthRequirement] and
 *        adding a `when` branch here; the generator does not change.
 *  - D — the generator depends on this object (constructor / method
 *        call), not on a hardcoded if/else chain inline.
 */
internal object AuthHeaderEncoder {
    const val BEARER_PREFIX = "Bearer "
    const val BASIC_PREFIX = "Basic "

    /**
     * Returns the value for the `Authorization` header, or `null` if
     * no requirement has usable credentials. The first satisfied
     * requirement wins — that mirrors how HTTP/1.1 clients resolve
     * a `WWW-Authenticate` challenge list and is the order in which
     * the user declared the requirements on the operation.
     *
     * Note: this method only returns an `Authorization` header
     * value (Basic / Bearer). API keys live in a *custom* header
     * and are emitted by [encodeApiKeyHeaderName] +
     * [encodeApiKey]; the generator applies them in addition to
     * the Authorization value when iterating over the requirements.
     */
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
            // OAuth 2.0 access tokens ride the same Bearer wire
            // format (RFC 6750), but the user types them into a
            // dedicated input in the UI so the banner copy and the
            // payload field stay separate from plain Bearer.
            is AuthRequirement.OAuth2 -> encodeBearer(credentials.oauth2Token)
            is AuthRequirement.Unsupported -> null
        }

    private fun encodeBearer(rawToken: String?): String? {
        val token = rawToken?.trim().orEmpty()
        if (token.isEmpty()) return null
        // If the user pasted a full "Bearer …" string we respect it
        // (case-insensitive on the prefix) so the round-trip
        // import → UI → k6 script stays lossless. Otherwise we
        // prepend the canonical "Bearer " prefix.
        return if (token.startsWith(BEARER_PREFIX, ignoreCase = true)) {
            // normalise to the canonical "Bearer " (capital B, single
            // space) — every compliant HTTP client emits that.
            BEARER_PREFIX + token.substring(BEARER_PREFIX.length)
        } else {
            "$BEARER_PREFIX$token"
        }
    }

    private fun encodeBasic(
        rawUsername: String?,
        rawPassword: String?,
    ): String? {
        // Trim the password as well as the username. A password that
        // is only whitespace is almost certainly the UI showing the
        // empty state after the user hit space+backspace; a real
        // password with intentional surrounding whitespace is rare
        // enough that treating it as "set" would silently leak bad
        // credentials into the k6 script.
        val username = rawUsername?.trim().orEmpty()
        val password = rawPassword?.trim().orEmpty()
        if (username.isEmpty() && password.isEmpty()) return null
        val token = "$username:$password".toByteArray(Charsets.UTF_8)
        return BASIC_PREFIX + Base64.getEncoder().encodeToString(token)
    }

    /**
     * Returns the raw API key value if the user entered one, or
     * `null` otherwise. Unlike Basic / Bearer, the API key is the
     * full value of the configured header — no prefix, no encoding.
     * The k6 generator wraps this with the correct header name
     * later (see [de.lasttest.domain.DefaultK6ScriptGenerator]).
     */
    fun encodeApiKey(rawKey: String?): String? {
        val key = rawKey?.trim().orEmpty()
        return key.takeIf { it.isNotEmpty() }
    }

    /**
     * The header name under which the API key should be sent on the
     * wire. Returns `null` when the requirements do not declare a
     * header-based apiKey, so the generator can skip the iteration.
     * Carries the name explicitly so the generator does not have to
     * re-pattern-match the requirement here.
     */
    fun encodeApiKeyHeaderName(requirements: List<AuthRequirement>): String? =
        requirements
            .firstOrNull { it is AuthRequirement.ApiKey }
            ?.let { (it as AuthRequirement.ApiKey).headerName }

    /**
     * Snapshot of the credential fields a single payload may carry.
     * Kept inside the encoder so callers don't need to know which
     * credential field belongs to which auth type — they just
     * forward whatever the user typed.
     */
    data class AuthCredentials(
        val bearerToken: String? = null,
        val basicUsername: String? = null,
        val basicPassword: String? = null,
        val apiKey: String? = null,
        val oauth2Token: String? = null,
    )
}
