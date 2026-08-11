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
        val controller = DemoSwaggerUiController(AlwaysOffToggle())

        val exception =
            assertFailsWith<ResponseStatusException> {
                controller.swaggerUi()
            }
        assertEquals(404, exception.statusCode.value())
    }

    @Test
    fun `returns 404 with a helpful message when the demo is off`() {
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
        val toggle = RecordingDemoControllerToggle()
        val controller = DemoSwaggerUiController(toggle)

        assertFailsWith<ResponseStatusException> {
            controller.swaggerUi()
        }

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
