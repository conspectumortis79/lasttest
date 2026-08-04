package de.lasttest.demo

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@SpringBootTest
class DemoSpecificationProviderTest {
    @Autowired
    private lateinit var provider: DemoSpecificationProvider

    @Test
    fun `loads the bundled demo specification from the classpath`() {
        val content = provider.load()

        assertTrue(content.contains("openapi: 3.0.3"), "Demo-Spezifikation sollte ein OpenAPI-3-Dokument sein")
        assertTrue(content.contains("Lasttest Demo API"), "Demo-Spezifikation sollte den Demo-Titel enthalten")
    }

    @Test
    fun `throws when the resource is missing from the classpath`() {
        val missing = DemoSpecificationProvider(resourceName = "/demo/does-not-exist.yaml")

        val exception = assertFailsWith<IllegalStateException> { missing.load() }

        assertTrue(exception.message?.contains("does-not-exist.yaml") == true)
    }
}
