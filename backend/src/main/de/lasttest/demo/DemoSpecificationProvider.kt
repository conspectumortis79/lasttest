package de.lasttest.demo

import org.springframework.stereotype.Service
import java.io.InputStream

@Service
class DemoSpecificationProvider(
    private val resourceName: String = DEFAULT_RESOURCE,
) {
    fun load(): String = read(open())

    private fun open(): InputStream =
        javaClass.getResourceAsStream(resourceName)
            ?: throw IllegalStateException("Demo-Spezifikation '$resourceName' wurde im Classpath nicht gefunden.")

    private fun read(stream: InputStream): String {
        val bytes = stream.readAllBytes()
        stream.close()
        return String(bytes, Charsets.UTF_8)
    }

    private companion object {
        const val DEFAULT_RESOURCE: String = "/demo/openapi-demo.yaml"
    }
}
