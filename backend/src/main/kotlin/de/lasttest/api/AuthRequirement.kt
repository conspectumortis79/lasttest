package de.lasttest.api

import com.fasterxml.jackson.annotation.JsonProperty

sealed interface AuthRequirement {
    val kind: String

    data class Basic(
        val schemeName: String,
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "basic"
    }

    data class Bearer(
        val schemeName: String,
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "bearer"
    }

    data class ApiKey(
        val schemeName: String,
        val headerName: String,
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "apiKey"
    }

    data class OAuth2(
        val schemeName: String,
        val flows: List<OAuth2Flow> = emptyList(),
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "oauth2"
    }

    data class OAuth2Flow(
        val type: String,
        val authorizationUrl: String? = null,
        val tokenUrl: String? = null,
        val refreshUrl: String? = null,
        val scopes: List<String> = emptyList(),
    )

    data class OpenIdConnect(
        val schemeName: String,
        val openIdConnectUrl: String,
        val scopes: List<String> = emptyList(),
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "openIdConnect"
    }

    data class Unsupported(
        val schemeName: String,
        val reason: String,
    ) : AuthRequirement {
        @get:JsonProperty("kind")
        override val kind: String = "unsupported"
    }
}
