package de.lasttest.demo

import org.springframework.web.server.ResponseStatusException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DemoSwaggerUiControllerTest {
    @Test
    fun `renders a Swagger UI HTML page that points at the local demo specification`() {
        val controller = DemoSwaggerUiController(AlwaysOnToggle())

        val html = controller.swaggerUi()

        assertTrue(html.startsWith("<!DOCTYPE html>"))
        assertTrue(html.contains("swagger-ui-bundle.js"))
        assertTrue(html.contains("url: \"/api/demo-specification\""))
        assertTrue(html.contains("SwaggerUIBundle"))
    }

    @Test
    fun `embeds the Swagger UI stylesheet from the CDN`() {
        val controller = DemoSwaggerUiController(AlwaysOnToggle())

        val html = controller.swaggerUi()

        assertTrue(html.contains("swagger-ui.css"))
        assertTrue(html.contains("unpkg.com"))
    }

    @Test
    fun `returns 404 when the bundled demo API is disabled`() {
        // The Swagger UI is a thin wrapper around the demo
        // spec. When the user has the demo off, the spec
        // endpoint behind it is also off, so serving a
        // Swagger UI shell that points at a 404 would be
        // misleading. A 404 here mirrors the demo controller
        // and gives the user a consistent "demo is off" state.
        val controller = DemoSwaggerUiController(AlwaysOffToggle())

        val exception =
            assertFailsWith<ResponseStatusException> {
                controller.swaggerUi()
            }
        assertEquals(404, exception.statusCode.value())
    }

    @Test
    fun `returns 404 with a helpful message when the demo is off`() {
        // The status code alone is not enough for a user
        // reaching the page from a bookmark: a short
        // "Demo API is disabled" hint in the error body tells
        // them what to do (open Settings, flip the switch)
        // without having to look at the developer console.
        val controller = DemoSwaggerUiController(AlwaysOffToggle())

        val exception =
            assertFailsWith<ResponseStatusException> {
                controller.swaggerUi()
            }
        assertTrue(
            exception.reason?.contains("Demo") == true,
            "the 404 must carry a 'Demo' hint, got: ${exception.reason}",
        )
    }

    @Test
    fun `respects the toggle — re-enabling the demo brings the page back`() {
        // The controller consults the toggle on every request
        // so a user who flips the demo off and on again sees
        // the page return. A controller that cached the
        // initial state would require a restart to recover.
        val toggle = RecordingDemoControllerToggle()
        val controller = DemoSwaggerUiController(toggle)

        // Demo is off → 404
        assertFailsWith<ResponseStatusException> {
            controller.swaggerUi()
        }

        // Demo is on → page
        toggle.enable()
        val html = controller.swaggerUi()
        assertTrue(html.startsWith("<!DOCTYPE html>"))
    }

    private class AlwaysOnToggle : DemoControllerToggle {
        override fun isEnabled(): Boolean = true

        override fun enable() = Unit

        override fun disable() = Unit
    }

    private class AlwaysOffToggle : DemoControllerToggle {
        override fun isEnabled(): Boolean = false

        override fun enable() = Unit

        override fun disable() = Unit
    }

    private class RecordingDemoControllerToggle : DemoControllerToggle {
        private var state: Boolean = false

        override fun isEnabled(): Boolean = state

        override fun enable() {
            state = true
        }

        override fun disable() {
            state = false
        }
    }
}
