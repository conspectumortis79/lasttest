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

    @Suppress("UNCHECKED_CAST")
    private fun notFoundIfDisabled(): ResponseEntity<*>? =
        if (toggle.isEnabled()) {
            null
        } else {
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
        if (!hasOAuth2Token(authorization)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }
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
        return token == DEMO_BEARER_TOKEN
    }

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
        return username == DEMO_BASIC_USERNAME && password == DEMO_BASIC_PASSWORD
    }

    private fun hasApiKey(apiKey: String?): Boolean {
        val key = apiKey?.trim().orEmpty()
        if (key.isEmpty()) return false
        return key == DEMO_API_KEY
    }

    private fun hasOAuth2Token(authorization: String?): Boolean {
        if (authorization == null) return false
        if (!authorization.startsWith(BEARER_PREFIX, ignoreCase = true)) return false
        val token = authorization.substring(BEARER_PREFIX.length).trim()
        if (token.isEmpty()) return false
        return token == DEMO_OAUTH2_TOKEN
    }

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
