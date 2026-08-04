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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

@RestController
@RequestMapping("/demo-api/products")
class DemoProductController {
    private val sequence = AtomicLong(2)
    private val products = ConcurrentHashMap<Long, Product>()

    init {
        products[1] = Product(1, "Clean Code", "books", 34.95, true)
        products[2] = Product(2, "Mechanical Keyboard", "hardware", 89.90, true)
    }

    @GetMapping
    fun list(
        @RequestParam(required = false) category: String?,
        @RequestParam(required = false) available: Boolean?,
        @RequestParam(required = false) maxPrice: Double?,
    ): List<Product> = findProducts(category, available, maxPrice)

    @PostMapping("/search")
    fun search(
        @RequestHeader(name = "Authorization", required = false) authorization: String?,
        @RequestBody request: ProductSearchRequest,
    ): ResponseEntity<List<Product>> {
        if (!hasBearerToken(authorization)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }
        return ResponseEntity.ok(findProducts(request.category, request.available, request.maxPrice))
    }

    @GetMapping("/{id}")
    fun get(
        @PathVariable id: Long,
    ): ResponseEntity<Product> = products[id]?.let(ResponseEntity<Product>::ok) ?: ResponseEntity.notFound().build()

    @PostMapping
    fun create(
        @RequestBody request: ProductRequest,
    ): ResponseEntity<Product> {
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
        if (!products.containsKey(id)) {
            return ResponseEntity.notFound().build()
        }
        val product = request.toProduct(id)
        products[id] = product
        return ResponseEntity.ok(product)
    }

    @DeleteMapping("/{id}")
    fun delete(
        @PathVariable id: Long,
    ): ResponseEntity<Void> = if (products.remove(id) != null) ResponseEntity.noContent().build() else ResponseEntity.notFound().build()

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
        return authorization.length > BEARER_PREFIX.length
    }

    private companion object {
        const val BEARER_PREFIX = "Bearer "
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
