package de.lasttest.demo

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.http.HttpEntity
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.web.client.RestTemplate
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DemoProductControllerTest(
    @Autowired private val client: RestTemplate,
    @LocalServerPort private val port: Int,
) {
    @Test
    fun `supports product lifecycle`() {
        val created = client.postForEntity(url("/products"), ProductRequest("Test Product", "software", 12.5), Product::class.java)

        assertEquals(HttpStatus.CREATED, created.statusCode)
        val product = assertNotNull(created.body)
        assertEquals("Test Product", product.name)

        val found = client.getForEntity(url("/products/${product.id}"), Product::class.java)
        assertEquals(HttpStatus.OK, found.statusCode)

        val updated =
            client.exchange(
                url("/products/${product.id}"),
                HttpMethod.PUT,
                HttpEntity(ProductRequest("Updated", "software", 15.0, false)),
                Product::class.java,
            )
        assertEquals(HttpStatus.OK, updated.statusCode)
        assertEquals("Updated", updated.body?.name)

        val deleted = client.exchange(url("/products/${product.id}"), HttpMethod.DELETE, HttpEntity.EMPTY, Void::class.java)
        assertEquals(HttpStatus.NO_CONTENT, deleted.statusCode)
        assertEquals(HttpStatus.NOT_FOUND, statusOfGet("/products/${product.id}"))
    }

    @Test
    fun `filters products by category`() {
        val products = client.getForEntity(url("/products?category=books"), Array<Product>::class.java)

        assertEquals(HttpStatus.OK, products.statusCode)
        assertEquals(listOf("books"), products.body?.map(Product::category)?.distinct())
    }

    @Test
    fun `filters products by availability and maximum price`() {
        val products = client.getForEntity(url("/products?available=true&maxPrice=35"), Array<Product>::class.java)

        assertEquals(HttpStatus.OK, products.statusCode)
        assertEquals(listOf("Clean Code"), products.body?.map(Product::name))
    }

    @Test
    fun `searches products with JSON body and bearer token`() {
        val headers = HttpHeaders()
        headers.setBearerAuth("demo-token")
        val response =
            client.exchange(
                url("/products/search"),
                HttpMethod.POST,
                HttpEntity(ProductSearchRequest(category = "hardware", maxPrice = 100.0), headers),
                Array<Product>::class.java,
            )

        assertEquals(HttpStatus.OK, response.statusCode)
        assertEquals(listOf("Mechanical Keyboard"), response.body?.map(Product::name))
    }

    @Test
    fun `search rejects a missing bearer token`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfSearch(ProductSearchRequest()))
    }

    @Test
    fun `returns all products without filters and none for unmatched filters`() {
        val allProducts = client.getForEntity(url("/products"), Array<Product>::class.java)
        val unavailableProducts = client.getForEntity(url("/products?available=false&maxPrice=1"), Array<Product>::class.java)

        assertEquals(HttpStatus.OK, allProducts.statusCode)
        assertEquals(2, allProducts.body?.size)
        assertEquals(emptyList(), unavailableProducts.body?.toList())
    }

    @Test
    fun `search rejects missing malformed and empty bearer tokens`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfSearch(ProductSearchRequest(), null))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfSearch(ProductSearchRequest(), "Basic token"))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfSearch(ProductSearchRequest(), "Bearer "))
    }

    @Test
    fun `search rejects an empty bearer token without HTTP header normalization`() {
        val response = DemoProductController().search("Bearer ", ProductSearchRequest())

        assertEquals(HttpStatus.UNAUTHORIZED, response.statusCode)
    }

    @Test
    fun `seeded products are reset to their default state after deletion so subsequent reads succeed`() {
        val original = client.getForEntity(url("/products/1"), Product::class.java).body
        assertEquals("Clean Code", original?.name)

        val updated =
            client.exchange(
                url("/products/1"),
                HttpMethod.PUT,
                HttpEntity(ProductRequest("Dirty", "software", 1.0, false)),
                Product::class.java,
            )
        assertEquals(HttpStatus.OK, updated.statusCode)
        assertEquals("Dirty", updated.body?.name)

        val deleted = client.exchange(url("/products/1"), HttpMethod.DELETE, HttpEntity.EMPTY, Void::class.java)
        assertEquals(HttpStatus.NO_CONTENT, deleted.statusCode)

        val afterDelete = client.getForEntity(url("/products/1"), Product::class.java)
        assertEquals(HttpStatus.OK, afterDelete.statusCode)
        assertEquals("Clean Code", afterDelete.body?.name)
        assertEquals("books", afterDelete.body?.category)
        assertEquals(34.95, afterDelete.body?.price)
        assertEquals(true, afterDelete.body?.available)
    }

    @Test
    fun `non-seeded products are actually removed by delete`() {
        val created = client.postForEntity(url("/products"), ProductRequest("Ephemeral", "software", 9.99), Product::class.java)
        val product = checkNotNull(created.body)
        val createdId = product.id

        val deleted = client.exchange(url("/products/$createdId"), HttpMethod.DELETE, HttpEntity.EMPTY, Void::class.java)
        assertEquals(HttpStatus.NO_CONTENT, deleted.statusCode)

        assertEquals(HttpStatus.NOT_FOUND, statusOfGet("/products/$createdId"))
    }

    @Test
    fun `unknown products cannot be updated or deleted`() {
        val updateStatus =
            statusOfExchange(
                "/products/999999",
                HttpMethod.PUT,
                HttpEntity(ProductRequest("Missing", "software", 1.0)),
                Product::class.java,
            )
        val deleteStatus = statusOfExchange("/products/999999", HttpMethod.DELETE, HttpEntity.EMPTY, Void::class.java)

        assertEquals(HttpStatus.NOT_FOUND, updateStatus)
        assertEquals(HttpStatus.NOT_FOUND, deleteStatus)
    }

    @Test
    fun `returns not found for unknown product`() {
        assertEquals(HttpStatus.NOT_FOUND, statusOfGet("/products/999999"))
    }

    private fun statusOfSearch(
        request: ProductSearchRequest,
        authorization: String? = null,
    ): HttpStatus {
        val headers = HttpHeaders()
        authorization?.let { headers["Authorization"] = it }
        return statusOfExchange("/products/search", HttpMethod.POST, HttpEntity(request, headers), Array<Product>::class.java)
    }

    private fun <T : Any> statusOfExchange(
        path: String,
        method: HttpMethod,
        entity: HttpEntity<*>,
        responseType: Class<T>,
    ): HttpStatus =
        try {
            client.exchange(url(path), method, entity, responseType).statusCode as HttpStatus
        } catch (exception: org.springframework.web.client.HttpClientErrorException) {
            exception.statusCode as HttpStatus
        }

    private fun statusOfSearch(request: ProductSearchRequest): HttpStatus =
        try {
            client.postForEntity(url("/products/search"), request, Array<Product>::class.java).statusCode as HttpStatus
        } catch (exception: org.springframework.web.client.HttpClientErrorException) {
            exception.statusCode as HttpStatus
        }

    private fun statusOfGet(path: String): HttpStatus =
        try {
            client.getForEntity(url(path), Product::class.java).statusCode as HttpStatus
        } catch (exception: org.springframework.web.client.HttpClientErrorException) {
            exception.statusCode as HttpStatus
        }

    private fun url(path: String): String = "http://localhost:$port/demo-api$path"
}
