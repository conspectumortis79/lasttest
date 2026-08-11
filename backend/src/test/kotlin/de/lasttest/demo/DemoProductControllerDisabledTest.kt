package de.lasttest.demo

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.http.HttpEntity
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.client.ClientHttpResponse
import org.springframework.web.client.DefaultResponseErrorHandler
import org.springframework.web.client.RestTemplate
import kotlin.test.assertEquals

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DemoProductControllerDisabledTest(
    @Autowired private val demoControllerToggle: DefaultDemoControllerToggle,
    @LocalServerPort private val serverPort: Int,
) {
    private val client: RestTemplate =
        RestTemplate().apply {
            errorHandler =
                object : DefaultResponseErrorHandler() {
                    override fun hasError(response: ClientHttpResponse): Boolean = false
                }
        }

    @BeforeEach
    fun disableDemo() {
        demoControllerToggle.disable()
    }

    @Test
    fun `every endpoint returns 404 when the demo toggle is off`() {
        for (path in listOf(
            "/products",
            "/products/1",
            "/products/admin/stats",
            "/products/lookup-by-id?id=1",
            "/products/me",
            "/products/my-profile",
        )) {
            val response =
                client.exchange(
                    url(path),
                    HttpMethod.GET,
                    HttpEntity.EMPTY,
                    String::class.java,
                )
            assertEquals(
                HttpStatus.NOT_FOUND,
                response.statusCode,
                "expected 404 for $path when toggle is off, got ${response.statusCode}",
            )
        }
    }

    @Test
    fun `search POST and the other write paths also return 404 when the toggle is off`() {
        val search =
            client.exchange(
                url("/products/search"),
                HttpMethod.POST,
                HttpEntity(ProductSearchRequest(category = "books")),
                String::class.java,
            )
        assertEquals(HttpStatus.NOT_FOUND, search.statusCode)

        val create =
            client.exchange(
                url("/products"),
                HttpMethod.POST,
                HttpEntity(ProductRequest("Test Product", "books", 9.99)),
                String::class.java,
            )
        assertEquals(HttpStatus.NOT_FOUND, create.statusCode)

        val put =
            client.exchange(
                url("/products/1"),
                HttpMethod.PUT,
                HttpEntity(ProductRequest("Updated", "books", 9.99)),
                String::class.java,
            )
        assertEquals(HttpStatus.NOT_FOUND, put.statusCode)

        val delete =
            client.exchange(
                url("/products/1"),
                HttpMethod.DELETE,
                HttpEntity.EMPTY,
                String::class.java,
            )
        assertEquals(HttpStatus.NOT_FOUND, delete.statusCode)
    }

    @Test
    fun `toggling the demo on at runtime makes the endpoints respond again`() {
        val before =
            client.exchange(
                url("/products"),
                HttpMethod.GET,
                HttpEntity.EMPTY,
                String::class.java,
            )
        assertEquals(HttpStatus.NOT_FOUND, before.statusCode)

        demoControllerToggle.enable()

        val after =
            client.exchange(
                url("/products"),
                HttpMethod.GET,
                HttpEntity.EMPTY,
                Array<Product>::class.java,
            )
        assertEquals(
            HttpStatus.OK,
            after.statusCode,
            "toggling the demo on must re-enable the endpoint without a restart",
        )
    }

    private fun url(path: String): String = "http://localhost:$serverPort/demo-api$path"
}
