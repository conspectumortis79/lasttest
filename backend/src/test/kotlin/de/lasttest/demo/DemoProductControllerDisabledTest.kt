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

/**
 * Companion to [DemoProductControllerTest] that exercises the
 * controller with the demo toggle in the "off" state. The main
 * test class enables the toggle in `@BeforeEach` so every
 * endpoint returns 200; this one leaves the toggle off so the
 * `notFoundIfDisabled()` early-out fires for every endpoint.
 *
 * Without this coverage the `if (toggle.isEnabled()) null else
 * ResponseEntity.notFound()` branch and the private
 * [DemoProductController.cast] helper would only be covered by
 * the disabled branches of the unit-level `AuthTest` — and that
 * test does not exercise the HTTP layer.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DemoProductControllerDisabledTest(
    @Autowired private val demoControllerToggle: DefaultDemoControllerToggle,
    @LocalServerPort private val serverPort: Int,
) {
    // We use a private `RestTemplate` with a no-op error handler
    // so 4xx / 5xx responses come back as `ResponseEntity` instead
    // of throwing `HttpClientErrorException`. The autowired
    // `RestTemplate` is the Spring-provided one which by default
    // throws on 4xx — fine for the main `DemoProductControllerTest`
    // (which only ever sees 2xx) but counter-productive here where
    // we want to assert on the 404 status code itself.
    //
    // Extending `DefaultResponseErrorHandler` and overriding only
    // `hasError` is the canonical way to disable the throw-on-4xx
    // behaviour without re-implementing the interface. The
    // `handleError` body is inherited and never reached because
    // `hasError` always returns `false`.
    private val client: RestTemplate =
        RestTemplate().apply {
            errorHandler =
                object : DefaultResponseErrorHandler() {
                    override fun hasError(response: ClientHttpResponse): Boolean = false
                }
        }

    @BeforeEach
    fun disableDemo() {
        // The toggle is a process-wide singleton; the
        // enabled-by-default `DemoProductControllerTest` ran
        // before this class and left the toggle on. We must
        // explicitly flip it off so every test here starts
        // from a deterministic "demo is off" baseline. The
        // `toggling the demo on at runtime` test below re-enables
        // the toggle, so leaving the suite off is fine.
        demoControllerToggle.disable()
    }

    @Test
    fun `every endpoint returns 404 when the demo toggle is off`() {
        // No `@BeforeEach` enabling the toggle — the default
        // state of `DefaultDemoControllerToggle` is `false`, so
        // every endpoint on `/demo-api/**` short-circuits
        // to 404 before the business logic runs. We do not have
        // to call `disable()` explicitly; the fresh bean is
        // already in the off state.
        // `RestTemplate.exchange(...)` does not throw on 4xx
        // because of the no-op error handler above; otherwise
        // a 404 would surface as `HttpClientErrorException`
        // and obscure the status code we want to assert on.
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
        // The disabled branch is path-agnostic: every request
        // that hits `/demo-api/**` is intercepted by
        // `notFoundIfDisabled()` before the controller method
        // body runs. We exercise the write paths here so a
        // regression that only protects the GET path is caught.
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
        // The inverse of the off-state tests: a runtime flip
        // must restore the normal behaviour without restarting
        // Spring. The `useStatus` effect in the frontend would
        // hit the same code path after a Settings switch flip.
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
