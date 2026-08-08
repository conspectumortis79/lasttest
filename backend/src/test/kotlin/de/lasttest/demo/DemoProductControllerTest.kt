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
        // The bundled toggle defaults to "off" so the demo is
        // opt-in. The product-controller tests exercise the
        // happy path of every endpoint, so the toggle has to be
        // flipped on before each test. We could also reach for a
        // @TestConfiguration that pre-enables the toggle, but
        // the explicit `@BeforeEach` is easier to read in the
        // diff and the cost is one line per test.
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
        // The demo backend now requires the exact demo token. See
        // [DemoProductController.DEMO_BEARER_TOKEN] for the source of
        // truth; the same value is surfaced in
        // `frontend/src/demoCredentials.ts` and in
        // `demo/openapi-demo.yaml`.
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
        // The legacy behaviour was "any non-empty bearer token is
        // accepted". For the demo to be a useful smoke test for
        // bearer-protected endpoints the backend now requires the
        // exact demo token; every other value produces 401.
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
        // base64(":nopass") = "Om5vcGFzcw==" — empty username side of the `||` short-circuit
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic Om5vcGFzcw=="))
        // base64("nouser:") = "bm91c2VyOg==" — empty password side of the `||` short-circuit
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic bm91c2VyOg=="))
        // base64(":") = "Og==" — both empty (the `||` resolves to true on either side)
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic Og=="))
        // base64("alice:") = "YWxpY2U6" — non-empty username but empty password;
        // this hits the right side of the `||` short-circuit (the
        // left side is false, so the right must be evaluated).
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic YWxpY2U6"))
    }

    @Test
    fun `admin stats returns 401 when the token is not valid base64`() {
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic !!!not-base64!!!"))
    }

    @Test
    fun `admin stats returns 401 when the decoded value is missing the colon separator`() {
        // base64("no-colon-here") = "bm8tY29sb24taGVyZQ=="
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic bm8tY29sb24taGVyZQ=="))
    }

    @Test
    fun `admin stats returns 200 with a valid Basic credential`() {
        // base64("alice:s3cret") = "YWxpY2U6czNjcmV0"
        val response = adminStats(authorization = "Basic YWxpY2U6czNjcmV0")
        assertEquals(HttpStatus.OK, response.statusCode)
        assertNotNull(response.body)
        // The shape of the body is documented in demo/openapi-demo.yaml;
        // these are the keys the k6 script can rely on.
        assertNotNull(response.body!!["productCount"])
        assertNotNull(response.body!!["categories"])
        assertNotNull(response.body!!["timestamp"])
    }

    @Test
    fun `admin stats returns 401 with the wrong username`() {
        // base64("bob:s3cret") = "Ym9iOnMzY3JldA=="
        // The demo backend only accepts the literal "alice"; every
        // other non-empty username must produce 401, otherwise the
        // user could brute-force the credentials via the test report.
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic Ym9iOnMzY3JldA=="))
    }

    @Test
    fun `admin stats returns 401 with the right username but wrong password`() {
        // base64("alice:wrong") = "YWxpY2U6d3Jvbmc="
        // Same shape as the positive test, swapped password: the
        // demo backend must reject it so a typo is immediately
        // visible in the k6 run.
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic YWxpY2U6d3Jvbmc="))
    }

    @Test
    fun `admin stats returns 401 with a non-empty but otherwise arbitrary Basic credential`() {
        // base64("anyone:anyhow") = "YW55b25lOmFueWhvdw=="
        // The legacy behaviour was "any non-empty credentials are
        // accepted", which made the demo useless as a smoke test for
        // auth-protected endpoints. The strict mode below rejects
        // every credential that is not the literal demo pair.
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic YW55b25lOmFueWhvdw=="))
    }

    @Test
    fun `admin stats returns 401 when the Basic header is the demo credentials with a different case`() {
        // base64("ALICE:s3cret") = "QUxJQ0U6czNjcmV0"
        // Case sensitivity is a real-world Basic-Auth concern (RFC
        // 7617 says usernames MAY be case-sensitive). We pick
        // case-sensitive for the demo to make the auth check
        // observable in the report.
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic QUxJQ0U6czNjcmV0"))
    }

    @Test
    fun `product lookup returns 401 without an X-API-Key header`() {
        // The lookup endpoint requires the X-API-Key header on every
        // call. Without it, the server is intentionally chatty
        // and returns 401, never 200.
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfLookup(id = 1, apiKey = null))
    }

    @Test
    fun `product lookup returns 401 with any X-API-Key value that is not the demo key`() {
        // Strict mode: only the pinned demo key is accepted. The
        // same hygiene as Basic / Bearer so a typo is immediately
        // visible in the k6 report.
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
        // Jackson decodes small JSON numbers as Integer; compare via
        // toString so the test does not depend on the runtime type.
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
        // OAuth 2.0 access tokens ride the same Bearer wire format
        // (RFC 6750) so the same `Bearer <token>` shape is checked
        // here. The backend only accepts the exact demo token.
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Bearer some-other-token"))
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Bearer "))
    }

    @Test
    fun `me returns 401 with a non-empty bearer token that has a different content`() {
        // Coverage for the `||` short-circuit in the bearer
        // helper: a non-empty but wrong token must hit the
        // `startsWith` true branch, the empty check is false, and
        // the equality check returns false. (We do not test the
        // purely-empty token path here because the [Bearer] case
        // in the basic helper already exercises that branch.)
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Bearer some-other-token"))
    }

    @Test
    fun `admin stats returns 401 with a Basic header that has only the scheme and no credentials`() {
        // The empty-encoded branch of [hasBasicCredentials]: the
        // header is `Basic ` (with only whitespace after the
        // prefix), so the base64-decoded portion is empty. The
        // helper must reject the request without trying to
        // decode an empty string.
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfAdminStats(authorization = "Basic "))
    }

    @Test
    fun `me returns 401 with a Bearer header that has only the scheme and no token`() {
        // Same empty-encoded branch in the OAuth2 helper: a
        // `Bearer ` header (no token at all) must be rejected
        // without falling into the equality check.
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Bearer "))
    }

    @Test
    fun `me returns 401 when the scheme is not Bearer`() {
        // Even with a syntactically correct token, a Basic auth
        // header on a Bearer-only endpoint must be rejected.
        assertEquals(HttpStatus.UNAUTHORIZED, statusOfMe(authorization = "Basic dXNlcjpwYXNz"))
    }

    @Test
    fun `me returns 200 with the exact demo OAuth2 access token`() {
        val response = me(authorization = "Bearer demo-oauth2-token-12345")
        assertEquals(HttpStatus.OK, response.statusCode)
        val body = assertNotNull(response.body)
        // The shape of the body mirrors what a real /userinfo
        // endpoint would return: user id, scopes, client id, token
        // issuance time. The values are hardcoded in the demo
        // controller; a real impl would decode them out of the
        // access token.
        assertEquals("demo-user", body["userId"])
        assertEquals("lasttest-demo-client", body["clientId"])
        assertNotNull(body["scopes"])
        assertNotNull(body["issuedAt"])
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
