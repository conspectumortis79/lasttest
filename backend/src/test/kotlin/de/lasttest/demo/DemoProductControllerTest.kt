package de.lasttest.demo

import de.lasttest.demo.DefaultDemoControllerToggle
import org.junit.jupiter.api.BeforeEach
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
    @Autowired private val demoControllerToggle: DefaultDemoControllerToggle,
    @LocalServerPort private val port: Int,
) {
    @BeforeEach
    fun enableDemo() {
        demoControllerToggle.enable()
    }

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
        headers.setBearerAuth("demo-bearer-token")
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
    fun `search rejects any non-empty bearer token that is not the demo token`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfSearch(ProductSearchRequest(), "Bearer some-other-token"))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfSearch(ProductSearchRequest(), "Bearer x"))
    }

    @Test
    fun `search accepts the exact demo bearer token`() {
        val response = statusOfSearch(ProductSearchRequest(), "Bearer demo-bearer-token")
        assertEquals(HttpStatus.OK, response)
    }

    @Test
    fun `search rejects an empty bearer token without HTTP header normalization`() {
        val response = DemoProductController(DefaultDemoControllerToggle().apply { enable() }).search("Bearer ", ProductSearchRequest())

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

    @Test
    fun `admin stats returns 401 without Authorization header`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = null))
    }

    @Test
    fun `admin stats returns 401 with malformed Authorization header`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Bearer not-basic"))
    }

    @Test
    fun `admin stats returns 401 with empty username or password`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic Om5vcGFzcw=="))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic bm91c2VyOg=="))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic Og=="))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic YWxpY2U6"))
    }

    @Test
    fun `admin stats returns 401 when the token is not valid base64`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic !!!not-base64!!!"))
    }

    @Test
    fun `admin stats returns 401 when the decoded value is missing the colon separator`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic bm8tY29sb24taGVyZQ=="))
    }

    @Test
    fun `admin stats returns 200 with a valid Basic credential`() {
        val response = adminStats(authorization = "Basic YWxpY2U6czNjcmV0")
        assertEquals(HttpStatus.OK, response.statusCode)
        assertNotNull(response.body)
        assertNotNull(response.body!!["productCount"])
        assertNotNull(response.body!!["categories"])
        assertNotNull(response.body!!["timestamp"])
    }

    @Test
    fun `admin stats returns 401 with the wrong username`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic Ym9iOnMzY3JldA=="))
    }

    @Test
    fun `admin stats returns 401 with the right username but wrong password`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic YWxpY2U6d3Jvbmc="))
    }

    @Test
    fun `admin stats returns 401 with a non-empty but otherwise arbitrary Basic credential`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic YW55b25lOmFueWhvdw=="))
    }

    @Test
    fun `admin stats returns 401 when the Basic header is the demo credentials with a different case`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic QUxJQ0U6czNjcmV0"))
    }

    @Test
    fun `product lookup returns 401 without an X-API-Key header`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfLookup(id = 1, apiKey = null))
    }

    @Test
    fun `product lookup returns 401 with any X-API-Key value that is not the demo key`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfLookup(id = 1, apiKey = ""))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfLookup(id = 1, apiKey = "   "))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfLookup(id = 1, apiKey = "wrong"))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfLookup(id = 1, apiKey = "DEMO-API-KEY-12345"))
    }

    @Test
    fun `product lookup returns 200 with the exact demo X-API-Key`() {
        val response = lookupProduct(apiKey = "demo-api-key-12345", id = 1)
        assertEquals(HttpStatus.OK, response.statusCode)
        val body = assertNotNull(response.body)
        assertEquals("1", body["id"].toString())
        assertEquals("Clean Code", body["name"])
    }

    @Test
    fun `product lookup returns 404 for an unknown product id even with a valid key`() {
        val status = statusOfLookup(id = 9999, apiKey = "demo-api-key-12345")
        assertEquals(HttpStatus.NOT_FOUND, status)
    }

    @Test
    fun `me returns 401 without an Authorization header`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = null))
    }

    @Test
    fun `me returns 401 with a Bearer header that carries the wrong token`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Bearer some-other-token"))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Bearer "))
    }

    @Test
    fun `me returns 401 with a non-empty bearer token that has a different content`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Bearer some-other-token"))
    }

    @Test
    fun `admin stats returns 401 with a Basic header that has only the scheme and no credentials`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic "))
    }

    @Test
    fun `me returns 401 with a Bearer header that has only the scheme and no token`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Bearer "))
    }

    @Test
    fun `me returns 401 when the scheme is not Bearer`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Basic dXNlcjpwYXNz"))
    }

    @Test
    fun `me returns 200 with the exact demo OAuth2 access token`() {
        val response = me(authorization = "Bearer demo-oauth2-token-12345")
        assertEquals(HttpStatus.OK, response.statusCode)
        val body = assertNotNull(response.body)
        assertEquals("demo-user", body["userId"])
        assertEquals("lasttest-demo-client", body["clientId"])
        assertNotNull(body["scopes"])
        assertNotNull(body["issuedAt"])
    }

    @Test
    fun `my-profile returns 200 with the exact demo OIDC ID token`() {
        val response = myProfile(authorization = "Bearer demo-oidc-id-token-12345")
        assertEquals(HttpStatus.OK, response.statusCode)
        val body = assertNotNull(response.body)
        assertEquals("demo-oidc-user", body["userId"])
        assertEquals("lasttest-demo-oidc-client", body["clientId"])
        assertEquals(
            "http://localhost:8286/demo-api/.well-known/openid-configuration",
            body["discoveryUrl"],
        )
        assertNotNull(body["scopes"])
        assertNotNull(body["issuedAt"])
    }

    @Test
    fun `my-profile returns 401 with no Authorization header`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMyProfile(authorization = null))
    }

    @Test
    fun `my-profile returns 401 with the OAuth2 demo token because the OIDC endpoint requires a different ID token`() {
        assertEquals(
            HttpStatus.UNAUTHORIZED,
            statusOfMyProfile(authorization = "Bearer demo-oauth2-token-12345"),
        )
    }

    @Test
    fun `my-profile returns 401 with a blank OIDC ID token`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMyProfile(authorization = "Bearer  "))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMyProfile(authorization = "Bearer"))
    }

    private fun statusOfAdminStats(authorization: String?): HttpStatus =
        try {
            val headers = HttpHeaders()
            authorization?.let { headers["Authorization"] = it }
            client
                .exchange(
                    url("/products/admin/stats"),
                    HttpMethod.GET,
                    HttpEntity<Any>(headers),
                    Map::class.java,
                ).statusCode as HttpStatus
        } catch (exception: org.springframework.web.client.HttpClientErrorException) {
            exception.statusCode as HttpStatus
        }

    private fun adminStats(authorization: String?): org.springframework.http.ResponseEntity<Map<String, Any>> {
        val headers = HttpHeaders()
        authorization?.let { headers["Authorization"] = it }
        @Suppress("UNCHECKED_CAST")
        return client.exchange(
            url("/products/admin/stats"),
            HttpMethod.GET,
            HttpEntity<Any>(headers),
            Map::class.java,
        ) as org.springframework.http.ResponseEntity<Map<String, Any>>
    }

    private fun statusOfLookup(
        id: Long,
        apiKey: String?,
    ): HttpStatus =
        try {
            val headers = HttpHeaders()
            apiKey?.let { headers["X-API-Key"] = it }
            client
                .exchange(
                    url("/products/lookup-by-id?id=$id"),
                    HttpMethod.GET,
                    HttpEntity<Any>(headers),
                    Map::class.java,
                ).statusCode as HttpStatus
        } catch (exception: org.springframework.web.client.HttpClientErrorException) {
            exception.statusCode as HttpStatus
        }

    private fun lookupProduct(
        apiKey: String,
        id: Long,
    ): org.springframework.http.ResponseEntity<Map<String, Any>> {
        val headers = HttpHeaders()
        headers["X-API-Key"] = apiKey
        @Suppress("UNCHECKED_CAST")
        return client.exchange(
            url("/products/lookup-by-id?id=$id"),
            HttpMethod.GET,
            HttpEntity<Any>(headers),
            Map::class.java,
        ) as org.springframework.http.ResponseEntity<Map<String, Any>>
    }

    private fun statusOfMe(authorization: String?): HttpStatus =
        try {
            val headers = HttpHeaders()
            authorization?.let { headers["Authorization"] = it }
            client
                .exchange(
                    url("/products/me"),
                    HttpMethod.GET,
                    HttpEntity<Any>(headers),
                    Map::class.java,
                ).statusCode as HttpStatus
        } catch (exception: org.springframework.web.client.HttpClientErrorException) {
            exception.statusCode as HttpStatus
        }

    private fun me(authorization: String): org.springframework.http.ResponseEntity<Map<String, Any>> {
        val headers = HttpHeaders()
        headers["Authorization"] = authorization
        @Suppress("UNCHECKED_CAST")
        return client.exchange(
            url("/products/me"),
            HttpMethod.GET,
            HttpEntity<Any>(headers),
            Map::class.java,
        ) as org.springframework.http.ResponseEntity<Map<String, Any>>
    }

    private fun statusOfMyProfile(authorization: String?): HttpStatus =
        try {
            val headers = HttpHeaders()
            authorization?.let { headers["Authorization"] = it }
            client
                .exchange(
                    url("/products/my-profile"),
                    HttpMethod.GET,
                    HttpEntity<Any>(headers),
                    Map::class.java,
                ).statusCode as HttpStatus
        } catch (exception: org.springframework.web.client.HttpClientErrorException) {
            exception.statusCode as HttpStatus
        }

    private fun myProfile(authorization: String): org.springframework.http.ResponseEntity<Map<String, Any>> {
        val headers = HttpHeaders()
        headers["Authorization"] = authorization
        @Suppress("UNCHECKED_CAST")
        return client.exchange(
            url("/products/my-profile"),
            HttpMethod.GET,
            HttpEntity<Any>(headers),
            Map::class.java,
        ) as org.springframework.http.ResponseEntity<Map<String, Any>>
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
