package de.lasttest.api

import com.fasterxml.jackson.annotation.JsonProperty

/**
 * One concrete authentication requirement the importer discovered on
 * a Swagger / OpenAPI operation. Multiple requirements may apply to a
 * single operation when the spec lists them in a logical-OR
 * (`security: [{a:[]}, {b:[]}]`); the k6 generator then picks the
 * first one for which the user has actually configured credentials.
 *
 * Modelled as a sealed interface so adding a new scheme (oauth2,
 * openIdConnect, query apiKey, …) is an additive change: a new
 * subtype here, a new branch in [de.lasttest.domain.AuthSchemeClassifier],
 * and a new optional UI cell. The k6 generator, the report and the
 * payload pool only see the abstract surface, so existing call sites
 * keep compiling.
 *
 * The wire format carries an explicit `kind` discriminator on every
 * subclass so the React frontend can `switch (req.kind)` without
 * having to know the JVM class names. We tried `@JsonTypeInfo` first
 * but Jackson + Kotlin sealed interfaces do not honour it without
 * extra reflection config — pinning the discriminator explicitly
 * is simpler and survives across Jackson versions.
 */
sealed interface AuthRequirement {
    /** Discriminator string used on the wire. Stable contract. */
    val kind: String

    /**
     * HTTP Basic (RFC 7617). The user supplies username + password;
     * the generator base64-encodes them and emits
     * `Authorization: Basic <base64>`.
     */
    data class Basic(
        val schemeName: String,
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "basic"
    }

    /**
     * HTTP Bearer. The user supplies the opaque token; the generator
     * emits `Authorization: Bearer <token>`. The `Authorization`
     * apiKey-in-header pattern is also classified as Bearer because
     * the wire format is identical.
     */
    data class Bearer(
        val schemeName: String,
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "bearer"
    }

    /**
     * API Key in an HTTP header (the most common real-world pattern:
     * `X-API-Key: <key>`, `Api-Key: <key>`, etc.). The user supplies
     * the opaque key; the generator emits it as a regular request
     * header named [headerName]. Note that the spec pattern where
     * the apiKey is carried in an `Authorization` header is
     * classified as [Bearer] instead (the wire format `Authorization:
     * Bearer …` is identical to JWT-based auth).
     */
    data class ApiKey(
        val schemeName: String,
        val headerName: String,
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "apiKey"
    }

    /**
     * OAuth 2.0 (RFC 6749) with the access token carried as a
     * `Authorization: Bearer <token>` (RFC 6750). The wire format
     * is identical to [Bearer]; the subtype is split out because
     * the spec semantics (and therefore the user-facing copy in
     * the banner) are different — OAuth 2.0 carries a richer set
     * of metadata (flow name, authorization URL, token URL, scopes)
     * that the banner surfaces so the user knows what they are
     * testing. The k6 generator picks the first satisfied
     * requirement, so an OAuth 2.0 requirement emits the same
     * `Authorization: Bearer <token>` header as a plain Bearer
     * requirement.
     */
    data class OAuth2(
        val schemeName: String,
        val flows: List<OAuth2Flow> = emptyList(),
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "oauth2"
    }

    /**
     * One OAuth 2.0 flow as declared in `components.securitySchemes.<name>.flows`.
     * Carried for the banner only; the k6 generator does not branch on
     * the flow type. We keep the full set of fields the spec
     * declares so a future feature (e.g. a "what scope does this
     * token have?" debug surface) can read them off the wire shape.
     */
    data class OAuth2Flow(
        val type: String,
        val authorizationUrl: String? = null,
        val tokenUrl: String? = null,
        val refreshUrl: String? = null,
        val scopes: List<String> = emptyList(),
    )

    /**
     * Anything the importer does not yet know how to handle (openIdConnect,
     * query apiKey, cookie apiKey, …). The UI hides the credential
     * input for these, and the generator skips them. Surfaced as a
     * first-class value so the report can show *which* schemes were
     * detected even when no credentials can be configured.
     */
    data class Unsupported(
        val schemeName: String,
        val reason: String,
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "unsupported"
    }
}
