package de.lasttest.config

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component

@Component
class StartupMessageLogger(
    @Value("\${server.port}") private val serverPort: Int,
    @Value("\${lasttest.public-url:}") private val configuredPublicUrl: String,
) {
    @EventListener(ApplicationReadyEvent::class)
    fun logApplicationReady() {
        val publicUrl = configuredPublicUrl.trim().ifEmpty { "http://localhost:$serverPort/" }
        logger.info(
            """

            ============================================================
            lasttest wurde erfolgreich gestartet.
            Jetzt im Browser öffnen: $publicUrl
            ============================================================
            """.trimIndent(),
        )
    }

    private companion object {
        val logger = LoggerFactory.getLogger(StartupMessageLogger::class.java)
    }
}
