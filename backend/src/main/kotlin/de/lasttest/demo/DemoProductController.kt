package de.lasttest.demo

import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

@RestController
@RequestMapping("/demo-api/products")
class DemoProductController(
    private val toggle: DemoControllerToggle,
) {
    private val sequence = AtomicLong(SEED_LAST_ID)
    private val products = ConcurrentHashMap<Long, Product>()

    init {
        SEED_PRODUCTS.forEach { seed -> products[seed.id] = seed }
    }

    /**
     * Returns a 404 `ResponseEntity` when the demo is disabled,
     * `null` when it is enabled. The early-out happens before any
     * business logic so the handler cost is bounded to a single
     * volatile read on the cold path. Spring's own dispatcher
     * still runs — the toggle does not bypass the URL mapping —
     * so the response shape stays consistent with the enabled
     * path.
     *
     * The wildcard body type matches the call-site pattern
     * "return whatever `notFoundIfDisabled()` gave us as a
     * `ResponseEntity<MyBody>`"; the cast helper below makes that
     * safe because the only thing this method ever returns is a
     * 404 with no body, which serialises to the same wire format
     * regardless of the body type the caller declares.
     */
    @Suppress("UNCHECKED_CAST")
    private fun notFoundIfDisabled(): ResponseEntity<*>? =
        if (toggle.isEnabled()) {
            null
        } else {
            // `ResponseEntity.notFound().build()` returns
            // `ResponseEntity<Void>`. We widen it to the call-site
            // `ResponseEntity<*>` because the caller's return type
            // varies per handler — the wire response (a 404 with
            // no body) is identical regardless of the declared
            // body type, so the cast is safe at runtime.
            @Suppress("UNCHECKED_CAST")
            (ResponseEntity.notFound().build<Any>() as ResponseEntity<*>)
        }

    @GetMapping
    fun list(
        @RequestParam(required = false) category: String?,
        @RequestParam(required = false) available: Boolean?,
        @RequestParam(required = false) maxPrice: Double?,
    ): ResponseEntity<List<Product>> {
        notFoundIfDisabled()?.let { return it.cast() }
        return ResponseEntity.ok(findProducts(category, available, maxPrice))
    }

    @PostMapping("/search")
    fun search(
        @RequestHeader(name = "Authorization", required = false) authorization: String?,
        @RequestBody request: ProductSearchRequest,
    ): ResponseEntity<List<Product>> {
        notFoundIfDisabled()?.let { return it.cast() }
        if (!hasBearerToken(authorization)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }
        return ResponseEntity.ok(findProducts(request.category, request.available, request.maxPrice))
    }

    @GetMapping("/admin/stats")
    fun adminStats(
        @RequestHeader(name = "Authorization", required = false) authorization: String?,
    ): ResponseEntity<Map<String, Any>> {
        notFoundIfDisabled()?.let { return it.cast() }
        if (!hasBasicCredentials(authorization)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }
        return ResponseEntity.ok(
            mapOf(
                "productCount" to products.size,
                "categories" to
                    products.values
                        .map { it.category }
                        .distinct()
                        .sorted(),
                "timestamp" to Instant.now().toString(),
            ),
        )
    }

    @GetMapping("/lookup-by-id")
    fun lookupById(
        @RequestHeader(name = "X-API-Key", required = false) apiKey: String?,
        @RequestParam("id") id: Long,
    ): ResponseEntity<Map<String, Any>> {
        notFoundIfDisabled()?.let { return it.cast() }
        // Real-world pattern: API key in a custom header (Stripe,
        // GitHub, Twilio, …). The demo backend is strict — every
        // value other than the pinned demo key is rejected with
        // 401, so a typo or an empty field is immediately visible
        // in the k6 report instead of silently passing.
        if (!hasApiKey(apiKey)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }
        val product =
            products[id]
                ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()
        return ResponseEntity.ok(
            mapOf(
                "id" to product.id,
                "name" to product.name,
                "category" to product.category,
                "price" to product.price,
                "available" to product.available,
            ),
        )
    }

    @GetMapping("/me")
    fun me(
        @RequestHeader(name = "Authorization", required = false) authorization: String?,
    ): ResponseEntity<Map<String, Any>> {
        notFoundIfDisabled()?.let { return it.cast() }
        // OAuth 2.0 demo. The wire format is identical to Bearer
        // (RFC 6750) — the k6 script sends `Authorization: Bearer
        // <token>` and the controller validates the opaque token
        // here. The same hygiene as the Bearer demo: every value
        // other than the pinned demo token is rejected with 401,
        // every credential must carry the `Bearer ` prefix, and
        // the token must be non-empty after the prefix.
        if (!hasOAuth2Token(authorization)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }
        // In a real OAuth 2.0 system the resource server would
        // validate the token against the authorization server
        // (signature, expiry, audience, scope). For the demo we
        // hardcode the response so the user can see what their
        // token "decodes to" — useful for the k6 report and the
        // smoke test in the E2E suite.
        return ResponseEntity.ok(
            mapOf(
                "userId" to "demo-user",
                "scopes" to listOf("read:products", "write:products"),
                "clientId" to "lasttest-demo-client",
                "issuedAt" to Instant.now().toString(),
            ),
        )
    }

    @GetMapping("/my-profile")
    fun myProfile(
        @RequestHeader(name = "Authorization", required = false) authorization: String?,
    ): ResponseEntity<Map<String, Any>> {
        notFoundIfDisabled()?.let { return it.cast() }
        // OpenID Connect demo. Same wire format as OAuth 2.0 and
        // Bearer (RFC 6750) — the k6 script sends
        // `Authorization: Bearer <id_token>` and the controller
        // validates the opaque token here. The pinned token is
        // different from the OAuth 2.0 demo so a smoke test can
        // tell the two endpoints apart on the wire. A real OIDC
        // resource server would verify the ID token's signature
        // against the OP's JWKS endpoint, check the `iss` / `aud`
        // / `exp` claims, and call the userinfo endpoint; the
        // demo keeps the loop closed so a typo is immediately
        // visible in the k6 report.
        if (!hasOidcIdToken(authorization)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }
        return ResponseEntity.ok(
            mapOf(
                "userId" to "demo-oidc-user",
                "scopes" to listOf("openid", "profile", "email"),
                "clientId" to "lasttest-demo-oidc-client",
                "discoveryUrl" to "http://localhost:8286/demo-api/.well-known/openid-configuration",
                "issuedAt" to Instant.now().toString(),
            ),
        )
    }

    @GetMapping("/{id}")
    fun get(
        @PathVariable id: Long,
    ): ResponseEntity<Product> {
        notFoundIfDisabled()?.let { return it.cast() }
        return products[id]?.let(ResponseEntity<Product>::ok) ?: ResponseEntity.notFound().build()
    }

    @PostMapping
    fun create(
        @RequestBody request: ProductRequest,
    ): ResponseEntity<Product> {
        notFoundIfDisabled()?.let { return it.cast() }
        val id = sequence.incrementAndGet()
        val product = request.toProduct(id)
        products[id] = product
        return ResponseEntity.status(HttpStatus.CREATED).body(product)
    }

    @PutMapping("/{id}")
    fun update(
        @PathVariable id: Long,
        @RequestBody request: ProductRequest,
    ): ResponseEntity<Product> {
        notFoundIfDisabled()?.let { return it.cast() }
        if (!products.containsKey(id)) return ResponseEntity.notFound().build()
        val product = request.toProduct(id)
        products[id] = product
        return ResponseEntity.ok(product)
    }

    @DeleteMapping("/{id}")
    fun delete(
        @PathVariable id: Long,
    ): ResponseEntity<Void> {
        notFoundIfDisabled()?.let { return it.cast() }
        val template = SEED_BY_ID[id]
        if (template != null) {
            products[id] = template
            return ResponseEntity.noContent().build()
        }
        return if (products.remove(id) != null) ResponseEntity.noContent().build() else ResponseEntity.notFound().build()
    }

    /**
     * Narrow helper that turns the wildcard `ResponseEntity<*>?`
     * from [notFoundIfDisabled] into a typed
     * [ResponseEntity] for the caller's return type. The cast is
     * safe because the only `ResponseEntity` we ever return from
     * [notFoundIfDisabled] is a 404 with no body — the caller
     * then returns it as `ResponseEntity<Whatever>` and Spring
     * serialises the body as `null`, which is exactly what the
     * caller asked for.
     */
    @Suppress("UNCHECKED_CAST")
    private fun <T : Any> ResponseEntity<*>.cast(): ResponseEntity<T> = this as ResponseEntity<T>

    private fun findProducts(
        category: String?,
        available: Boolean?,
        maxPrice: Double?,
    ): List<Product> =
        products.values
            .filter { category == null || it.category == category }
            .filter { available == null || it.available == available }
            .filter { maxPrice == null || it.price <= maxPrice }
            .sortedBy(Product::id)

    private fun hasBearerToken(authorization: String?): Boolean {
        if (authorization == null) {
            return false
        }
        if (!authorization.startsWith(BEARER_PREFIX, ignoreCase = true)) {
            return false
        }
        val token = authorization.substring(BEARER_PREFIX.length).trim()
        // The demo backend now requires the exact demo token. The
        // earlier "any non-empty value is accepted" behaviour was
        // too permissive to be useful as a smoke test for an auth-
        // protected endpoint — the k6 report would always pass and
        // hide typos in the configuration.
        return token == DEMO_BEARER_TOKEN
    }

    /**
     * Validates the [Authorization] header as an HTTP Basic header
     * (RFC 7617) AND requires it to carry the exact demo
     * credentials. The header must be of the form
     * `Basic <base64(username:password)>`, the base64 must decode
     * cleanly, the decoded value must split on a single `:`, and
     * username + password must both be non-empty and match the
     * pinned demo pair (case-sensitive, see RFC 7617 § 2.2 which
     * leaves case-sensitivity up to the server).
     *
     * Single Responsibility in action: [hasBearerToken] and
     * [hasBasicCredentials] each own one scheme so the two demo
     * endpoints can evolve independently.
     */
    private fun hasBasicCredentials(authorization: String?): Boolean {
        if (authorization == null) return false
        if (!authorization.startsWith(BASIC_PREFIX, ignoreCase = true)) return false
        val encoded = authorization.substring(BASIC_PREFIX.length).trim()
        if (encoded.isEmpty()) return false
        val decoded =
            runCatching {
                String(Base64.getDecoder().decode(encoded), Charsets.UTF_8)
            }.getOrNull() ?: return false
        val separator = decoded.indexOf(':')
        if (separator < 0) return false
        val username = decoded.substring(0, separator)
        val password = decoded.substring(separator + 1)
        if (username.isEmpty() || password.isEmpty()) return false
        // Strict mode: only the pinned demo pair is accepted. The
        // check is on the raw decoded bytes, not the wire form, so
        // the wire base64 must decode to the exact "alice:s3cret"
        // (no padding tricks, no case-folding, no whitespace
        // injection).
        return username == DEMO_BASIC_USERNAME && password == DEMO_BASIC_PASSWORD
    }

    /**
     * Validates the `X-API-Key` header. Same hygiene as
     * [hasBasicCredentials]: trim whitespace, treat empty as
     * "not set", and require an exact match against the pinned
     * demo key (case-sensitive — real-world API keys are
     * case-sensitive tokens, see e.g. Stripe's `sk_test_…` and
     * `sk_live_…`).
     */
    private fun hasApiKey(apiKey: String?): Boolean {
        val key = apiKey?.trim().orEmpty()
        if (key.isEmpty()) return false
        return key == DEMO_API_KEY
    }

    /**
     * Validates the `Authorization` header as an OAuth 2.0 bearer
     * token (RFC 6750). Same shape as [hasBearerToken] but with a
     * pinned demo token. In a real resource server the validation
     * would call out to the authorization server; the demo keeps
     * the loop closed so the user sees a deterministic 401 for any
     * typo.
     */
    private fun hasOAuth2Token(authorization: String?): Boolean {
        if (authorization == null) return false
        if (!authorization.startsWith(BEARER_PREFIX, ignoreCase = true)) return false
        val token = authorization.substring(BEARER_PREFIX.length).trim()
        if (token.isEmpty()) return false
        return token == DEMO_OAUTH2_TOKEN
    }

    /**
     * Validates the `Authorization` header as an OpenID Connect
     * ID token (RFC 6750). Same wire format as Bearer and OAuth 2.0;
     * pinned to a different demo token so the smoke test can tell
     * the OIDC endpoint apart from the OAuth 2.0 one. The pinned
     * value matches the `DemoOpenIdConnect` entry in
     * `frontend/src/demoCredentials.ts` and the
     * `description` field on `/products/my-profile` in the demo
     * spec.
     */
    private fun hasOidcIdToken(authorization: String?): Boolean {
        if (authorization == null) return false
        if (!authorization.startsWith(BEARER_PREFIX, ignoreCase = true)) return false
        val token = authorization.substring(BEARER_PREFIX.length).trim()
        if (token.isEmpty()) return false
        return token == DEMO_OIDC_ID_TOKEN
    }

    private companion object {
        const val BEARER_PREFIX = "Bearer "
        const val BASIC_PREFIX = "Basic "

        // Demo credentials for the bundled `demo/openapi-demo.yaml`.
        // The same values are surfaced in the UI's yellow
        // "Demo-Credentials" banner and in the spec `description`
        // field so the user can see them in three places at once.
        // Changing the value here requires a matching change in
        // `frontend/src/demoCredentials.ts` and in the spec.
        const val DEMO_BEARER_TOKEN = "demo-bearer-token"
        const val DEMO_BASIC_USERNAME = "alice"
        const val DEMO_BASIC_PASSWORD = "s3cret"
        const val DEMO_API_KEY = "demo-api-key-12345"
        const val DEMO_OAUTH2_TOKEN = "demo-oauth2-token-12345"
        const val DEMO_OIDC_ID_TOKEN = "demo-oidc-id-token-12345"

        val SEED_PRODUCTS: List<Product> =
            listOf(
                Product(1, "Clean Code", "books", 34.95, true),
                Product(2, "Mechanical Keyboard", "hardware", 89.90, true),
            )
        val SEED_BY_ID: Map<Long, Product> = SEED_PRODUCTS.associateBy(Product::id)
        const val SEED_LAST_ID: Long = 2
    }
}

data class Product(
    val id: Long,
    val name: String,
    val category: String,
    val price: Double,
    val available: Boolean,
)

data class ProductSearchRequest(
    val category: String? = null,
    val available: Boolean? = null,
    val maxPrice: Double? = null,
)

data class ProductRequest(
    val name: String,
    val category: String,
    val price: Double,
    val available: Boolean = true,
) {
    fun toProduct(id: Long): Product = Product(id, name, category, price, available)
}
