package de.lasttest.demo

import kotlin.test.Test
import kotlin.test.assertTrue

class DemoSwaggerUiControllerTest {
    private val controller = DemoSwaggerUiController()

    @Test
    fun `renders a Swagger UI HTML page that points at the local demo specification`() {
        val html = controller.swaggerUi()

        assertTrue(html.startsWith("<!DOCTYPE html>"))
        assertTrue(html.contains("swagger-ui-bundle.js"))
        assertTrue(html.contains("url: \"/api/demo-specification\""))
        assertTrue(html.contains("SwaggerUIBundle"))
    }

    @Test
    fun `embeds the Swagger UI stylesheet from the CDN`() {
        val html = controller.swaggerUi()

        assertTrue(html.contains("swagger-ui.css"))
        assertTrue(html.contains("unpkg.com"))
    }
}
