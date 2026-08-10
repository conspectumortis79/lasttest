package de.lasttest.api

import com.fasterxml.jackson.annotation.JsonInclude

// ---- Load profile ----------------------------------------------------------
//
// A test run is driven by exactly one LoadProfile. The discriminator `type`
// matches the k6 executor name so the generated script is self-documenting
// and the frontend can switch its editor on the same field.
//
// All four shapes live behind a single data class so Jackson can serialise
// the request/response without a custom TypeInfo configuration. Fields that
// are irrelevant for a given `type` are simply null.
//
//   ConstantVUs          → vus + durationSeconds
//   SharedIterations     → vus + iterations
//   RampingVUs           → startVUs + stages
//   ConstantArrivalRate  → rate + timeUnit + durationSeconds + preAllocatedVUs + maxVUs
//
// Stages for RampingVUs encode the k6 stages shape directly:
//   stages[0]: { target: 0,    duration: '30s' }   // 30 s warm-up / pause
//   stages[1]: { target: 200,  duration: '2m'  }   // ramp to 200 VUs in 2 min
//   stages[2]: { target: 200,  duration: '5m'  }   // plateau
//   stages[3]: { target: 0,    duration: '30s' }   // graceful ramp-down
// The frontend presets (smoke, load, stress, spike, soak) translate into
// exactly such a list of stages so the user can edit any of them.

data class LoadStage(
    val target: Int,
    val durationSeconds: Int,
)

data class LoadProfile(
    val type: LoadProfileType,
    // ConstantVUs / SharedIterations / ConstantArrivalRate
    val virtualUsers: Int? = null,
    val durationSeconds: Int? = null,
    val iterations: Int? = null,
    val useIterations: Boolean? = null,
    // RampingVUs
    val startVUs: Int? = null,
    val stages: List<LoadStage>? = null,
    // ConstantArrivalRate
    val rate: Int? = null,
    val timeUnit: Int? = null,
    val preAllocatedVUs: Int? = null,
    val maxVUs: Int? = null,
    /**
     * How the generator picks the next payload from each
     * [OperationConfiguration.payloads] pool on every k6 iteration.
     * `null` (the default) is treated as [PayloadStrategy.SEQUENTIAL] for
     * backward compatibility with clients that pre-date the pool feature.
     */
    val payloadStrategy: PayloadStrategy? = null,
)

enum class LoadProfileType {
    CONSTANT_VUS,
    SHARED_ITERATIONS,
    RAMPING_VUS,
    CONSTANT_ARRIVAL_RATE,
    ;

    /** Lower-case executor name as used inside the generated k6 script. */
    fun executorName(): String =
        when (this) {
            CONSTANT_VUS -> "constant-vus"
            SHARED_ITERATIONS -> "shared-iterations"
            RAMPING_VUS -> "ramping-vus"
            CONSTANT_ARRIVAL_RATE -> "constant-arrival-rate"
        }

    companion object {
        /**
         * Accepts both `RAMPING_VUS` (enum constant) and `ramping-vus`
         * (kebab-case, executor name from k6) when deserializing. The
         * frontend sends kebab-case; older clients may send the enum
         * name — both work.
         */
        @JvmStatic
        @com.fasterxml.jackson.annotation.JsonCreator
        fun fromJson(value: String): LoadProfileType =
            entries.firstOrNull {
                it.executorName().equals(value, ignoreCase = true) || it.name.equals(value, ignoreCase = true)
            } ?: throw IllegalArgumentException(
                "Unbekannter LoadProfileType: $value (erwartet: constant-vus, shared-iterations, ramping-vus, constant-arrival-rate)",
            )
    }
}

/**
 * How the generator picks the next payload from a per-endpoint pool
 * each time k6 runs an iteration. Mirrors the frontend `PayloadStrategy`
 * union so the wire format (`"sequential" | "random"`) is identical on
 * both sides. `null` is treated as `SEQUENTIAL` for backward compatibility
 * — a single-payload pool is identical under both strategies.
 */
enum class PayloadStrategy {
    SEQUENTIAL,
    RANDOM,
    ;

    fun jsonName(): String = name.lowercase()

    companion object {
        @JvmStatic
        @com.fasterxml.jackson.annotation.JsonCreator
        fun fromJson(value: String): PayloadStrategy =
            entries.firstOrNull { it.jsonName() == value.lowercase() }
                ?: throw IllegalArgumentException(
                    "Unbekannte PayloadStrategy: $value (erwartet: sequential, random)",
                )
    }
}

// ---- Existing models -------------------------------------------------------

data class ImportSpecificationRequest(
    val specification: String,
)

data class FetchSpecificationRequest(
    val url: String,
)

data class ImportedSpecification(
    val title: String,
    val version: String,
    val baseUrl: String,
    val operations: List<ApiOperation>,
    val servers: List<ApiServer> = emptyList(),
)

data class FetchedSpecification(
    val content: String,
    val resolvedUrl: String,
    val source: String,
)

data class ApiServer(
    val url: String,
    val description: String? = null,
)

data class ApiOperation(
    val operationId: String,
    val method: String,
    val path: String,
    val summary: String,
    val destructive: Boolean,
    val parameters: List<ApiParameter>,
    val requestBodyExample: Any?,
    val requestBodySchema: RequestBodySchema? = null,
    val hasRequestBody: Boolean = requestBodyExample != null || requestBodySchema != null,
    val requestBodyRequired: Boolean = false,
    /**
     * Discovered authentication requirements for this operation. Empty
     * means "no auth declared by the spec". Replaces the previous
     * boolean `bearerAuth` field; the derived [bearerAuth] property
     * below keeps existing call sites compiling without changes.
     */
    val authRequirements: List<AuthRequirement> = emptyList(),
) {
    /**
     * Derived from [authRequirements] for callers that only care about
     * the Bearer case (UI placeholder, importer regression test, …).
     * True iff at least one requirement is a [AuthRequirement.Bearer],
     * a [AuthRequirement.OAuth2], or a [AuthRequirement.OpenIdConnect]
     * — all three ride the same `Authorization: Bearer <token>` wire
     * format (RFC 6750) so the UI must render the credential input
     * for each of them.
     */
    val bearerAuth: Boolean
        get() =
            authRequirements.any {
                it is AuthRequirement.Bearer ||
                    it is AuthRequirement.OAuth2 ||
                    it is AuthRequirement.OpenIdConnect
            }
}

@JsonInclude(JsonInclude.Include.NON_NULL)
data class RequestBodySchema(
    val type: String,
    val properties: Map<String, ApiParameterSchema> = emptyMap(),
    val required: List<String> = emptyList(),
)

data class ApiParameter(
    val name: String,
    val location: String,
    val required: Boolean,
    val example: Any?,
    val schema: ApiParameterSchema? = null,
)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class ApiParameterSchema(
    val type: String,
    val format: String? = null,
    val enum: List<String>? = null,
    val minimum: Double? = null,
    val maximum: Double? = null,
    val exclusiveMinimum: Double? = null,
    val exclusiveMaximum: Double? = null,
    val minLength: Int? = null,
    val maxLength: Int? = null,
    val pattern: String? = null,
)

data class ParameterValue(
    val name: String,
    val location: String,
    val value: String,
)

data class OperationConfiguration(
    val operationId: String,
    /**
     * Pool of complete request datasets for this endpoint. The generator
     * picks the next payload from this list on every k6 iteration
     * according to the `payloadStrategy` configured on the [LoadProfile].
     * Empty by default for backward compatibility with clients that still
     * send the legacy flat-field layout below.
     */
    val payloads: List<OperationPayload> = emptyList(),
    /** @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty. */
    val parameterValues: List<ParameterValue> = emptyList(),
    /** @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty. */
    val requestBodyJson: String? = null,
    /** @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty. */
    val bearerToken: String? = null,
    /**
     * @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty.
     * Username for HTTP Basic. Used only when the corresponding
     * [ApiOperation] declares [de.lasttest.api.AuthRequirement.Basic].
     */
    val basicAuthUsername: String? = null,
    /**
     * @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty.
     * Password for HTTP Basic.
     */
    val basicAuthPassword: String? = null,
    /**
     * @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty.
     * API key value for header-based apiKey auth.
     */
    val apiKey: String? = null,
    /**
     * OAuth 2.0 access token. Used only when the corresponding
     * [ApiOperation] declares [de.lasttest.api.AuthRequirement.OAuth2].
     */
    val oauth2Token: String? = null,
    /**
     * @deprecated Derived from `payloads[0]` via [primaryPayload] when `payloads` is empty.
     * OpenID Connect ID token. Used only when the corresponding
     * [ApiOperation] declares [de.lasttest.api.AuthRequirement.OpenIdConnect].
     * The wire format is identical to [bearerToken] / [oauth2Token]
     * (`Authorization: Bearer <id_token>` per RFC 6750); the field
     * is split out so the UI can render a dedicated OIDC input and
     * the banner can show the discovery URL and scopes.
     */
    val oidcIdToken: String? = null,
) {
    /**
     * Returns the first payload from [payloads], or synthesises one from
     * the legacy flat fields when the pool is empty. This is the single
     * point where pre-pool requests get migrated to the new shape; the
     * generator and the report builder both go through this helper so
     * the two views stay in lockstep.
     */
    fun primaryPayload(): OperationPayload =
        payloads.firstOrNull()
            ?: OperationPayload(
                parameterValues = parameterValues,
                requestBodyJson = requestBodyJson,
                bearerToken = bearerToken,
                basicAuthUsername = basicAuthUsername,
                basicAuthPassword = basicAuthPassword,
                apiKey = apiKey,
                oauth2Token = oauth2Token,
                oidcIdToken = oidcIdToken,
            )
}

/**
 * One complete request dataset: the parameter overrides, the optional
 * JSON body and the optional auth credentials. Multiple
 * [OperationPayload] entries inside a single
 * [OperationConfiguration.payloads] list represent the different
 * datasets a user wants to cycle or pick at random.
 *
 * Auth fields are kept as raw strings — the actual wire encoding
 * (Bearer prefix, Base64, …) is the [de.lasttest.domain.AuthHeaderEncoder]'s
 * job, which is called once per request by the k6 generator.
 */
data class OperationPayload(
    val parameterValues: List<ParameterValue> = emptyList(),
    val requestBodyJson: String? = null,
    val bearerToken: String? = null,
    /**
     * Username for HTTP Basic auth. Only used when the operation
     * declares a Basic [de.lasttest.api.AuthRequirement].
     */
    val basicAuthUsername: String? = null,
    /**
     * Password for HTTP Basic auth. Only used when the operation
     * declares a Basic [de.lasttest.api.AuthRequirement].
     */
    val basicAuthPassword: String? = null,
    /**
     * API key value for an `apiKey in: header` [de.lasttest.api.AuthRequirement].
     * The k6 generator emits it as a regular request header named
     * per the `AuthRequirement.ApiKey.headerName`.
     */
    val apiKey: String? = null,
    /**
     * OAuth 2.0 access token. Used only when the corresponding
     * [ApiOperation] declares [de.lasttest.api.AuthRequirement.OAuth2].
     */
    val oauth2Token: String? = null,
    /**
     * OpenID Connect ID token. Used only when the corresponding
     * [ApiOperation] declares
     * [de.lasttest.api.AuthRequirement.OpenIdConnect]. The wire
     * format is identical to [bearerToken] / [oauth2Token]
     * (`Authorization: Bearer <id_token>` per RFC 6750); the field
     * is split out so the UI can render a dedicated OIDC input and
     * the banner can show the discovery URL and scopes.
     */
    val oidcIdToken: String? = null,
)

data class CreateTestRunRequest(
    val specification: String,
    val baseUrl: String,
    val operationIds: Set<String> = emptySet(),
    val operationConfigurations: List<OperationConfiguration> = emptyList(),
    /**
     * Drives the k6 executor. When `loadProfile` is null we fall back to
     * the legacy (virtualUsers, durationSeconds, useIterations) triple so
     * older clients keep working until they migrate.
     */
    val loadProfile: LoadProfile? = null,
    @Deprecated("Use loadProfile instead.") val virtualUsers: Int? = null,
    @Deprecated("Use loadProfile instead.") val durationSeconds: Int? = null,
    @Deprecated("Use loadProfile instead.") val useIterations: Boolean? = null,
    /**
     * Opt-in flag that decides whether the run is persisted to
     * the timeline. Defaults to `true` for backward compatibility
     * with clients that pre-date the toggle, and is rendered
     * as a checkbox in the Settings drawer
     * (`detail.timeline.list.saveExecutions` / "Ausgeführte
     * Lasttestkonfigurationen speichern"). When `false` the run
     * is still executed and exposed via the single-run
     * endpoints (`/api/test-runs/{id}` and the time-series
     * polling), so the dashboard's live view works for the
     * duration of the session — it just does not show up in
     * the per-endpoint timeline and is dropped on the next
     * container restart.
     */
    val persist: Boolean = true,
)

data class TestRunConfiguration(
    val apiTitle: String,
    val apiVersion: String,
    val baseUrl: String,
    val loadProfile: LoadProfile,
    /**
     * Echo of `LoadProfile.payloadStrategy` at the time the run was
     * started, so the report can explain whether the generator cycled
     * through the payload pool or picked at random. `null` means the
     * run was started before the pool feature shipped and the
     * strategy is implicitly `sequential`.
     */
    val payloadStrategy: PayloadStrategy? = null,
    val operations: List<TestRunOperationConfiguration>,
)

data class TestRunOperationConfiguration(
    val operationId: String,
    val method: String,
    val path: String,
    val summary: String,
    /**
     * All payloads that were configured for this endpoint at the time
     * the run was started. The report lists every entry so the user
     * can see exactly which datasets k6 cycled through or picked
     * from. The list is empty for legacy runs that pre-date the pool
     * feature — the report falls back to the flat fields below in
     * that case.
     */
    val payloads: List<OperationPayload> = emptyList(),
    /**
     * Flat-field view of the *first* payload, kept so the report can
     * render single-payload runs without a nested layout. With
     * multiple payloads this is the entry that was actually baked
     * into the static request block; the other entries only show up
     * under [payloads].
     */
    val parameterValues: List<ParameterValue> = emptyList(),
    val requestBodyJson: String? = null,
    val bearerTokenConfigured: Boolean = false,
    /**
     * True when at least one payload in [payloads] (or the legacy
     * flat fields) has a non-blank Basic Auth username or password.
     * The report uses this to render the
     * "Basic auth: configured / not configured" line.
     */
    val basicAuthConfigured: Boolean = false,
    /**
     * True when at least one payload in [payloads] (or the legacy
     * flat fields) has a non-blank API key. The report uses this to
     * render the "API key: configured / not configured" line.
     */
    val apiKeyConfigured: Boolean = false,
    /**
     * True when at least one payload in [payloads] (or the legacy
     * flat fields) has a non-blank OAuth 2.0 access token. The
     * report uses this to render the "OAuth 2: configured / not
     * configured" line.
     */
    val oauth2TokenConfigured: Boolean = false,
    /**
     * True when at least one payload in [payloads] (or the legacy
     * flat fields) has a non-blank OpenID Connect ID token. The
     * report uses this to render the "OIDC: configured / not
     * configured" line. Same wire format as OAuth 2.0 / Bearer;
     * the field is split out so the report can show the
     * discovery URL alongside the token line.
     */
    val oidcIdTokenConfigured: Boolean = false,
)

enum class TestRunStatus {
    QUEUED,
    RUNNING,

    /**
     * The user requested a graceful stop (SIGINT/SIGTERM). k6 is
     * still running and finishing the current iterations; the run is
     * not yet in a terminal state. The frontend polls until the
     * service promotes the run to [STOPPED] (or [ABORTED] if the
     * graceful-stop grace period elapsed without exit).
     */
    STOPPING,

    COMPLETED,
    FAILED,

    /**
     * The user requested a force abort (SIGKILL). k6 has been killed
     * without a chance to flush its summary. The run is in a
     * terminal state; partial metrics may still be available.
     */
    ABORTED,

    /**
     * The user requested a graceful stop and k6 exited cleanly
     * afterwards. Reached from [STOPPING] once the k6 process
     * actually exits. Distinguished from [COMPLETED] because the
     * run did not run for its full planned duration.
     */
    STOPPED,

    ;

    /**
     * True once the run has settled in any terminal state — the
     * polling on the frontend can stop, no more transitions are
     * expected from the service. STOPPING is intentionally excluded
     * because the service may still flip it to STOPPED or ABORTED
     * on a forced-kill timeout.
     */
    fun isTerminal(): Boolean = this == COMPLETED || this == FAILED || this == ABORTED || this == STOPPED

    fun isCancellable(): Boolean = this == QUEUED || this == RUNNING || this == STOPPING
}

data class TestRun(
    val id: String,
    val status: TestRunStatus,
    val createdAt: String,
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val exitCode: Int? = null,
    val configuration: TestRunConfiguration? = null,
    val summary: Map<String, Any?>? = null,
    /**
     * Raw (truncated) k6 output for the UI. Populated for both
     * successful and failed runs so that the "k6 console" tab can
     * always be shown. `null` if k6 could not be started at all
     * (see `error`).
     */
    val consoleOutput: String? = null,
    val error: String? = null,
    /**
     * Timestamp at which the user requested cancellation. `null`
     * when the run never received a user-initiated stop. Combined
     * with [cancelledByForce] it lets the UI distinguish between
     * graceful stop, force abort and a normal exit.
     */
    val cancelledAt: String? = null,
    /**
     * `true` if cancellation was a force abort (SIGKILL), `false`
     * for a graceful stop (SIGTERM, possibly escalated after the
     * grace period). `null` if the run was never cancelled.
     */
    val cancelledByForce: Boolean? = null,
    /**
     * Snapshot of the [CreateTestRunRequest] that started this run.
     * Preserved so the UI can call `POST /api/test-runs/{id}/rerun`
     * without having to resend the full specification from the
     * browser. `null` for legacy synthetic runs inserted directly
     * into the in-memory map.
     */
    val originalRequest: CreateTestRunRequest? = null,
)
