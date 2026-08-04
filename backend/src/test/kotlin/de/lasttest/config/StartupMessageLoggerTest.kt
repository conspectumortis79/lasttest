package de.lasttest.config

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import kotlin.test.assertContains

@ExtendWith(OutputCaptureExtension::class)
class StartupMessageLoggerTest {
    @Test
    fun `logs the local application URL after startup`(output: CapturedOutput) {
        val startupLogger = StartupMessageLogger(serverPort = 8286, configuredPublicUrl = "")

        startupLogger.logApplicationReady()

        assertContains(output.out, "lasttest wurde erfolgreich gestartet.")
        assertContains(output.out, "Jetzt im Browser öffnen: http://localhost:8286/")
    }

    @Test
    fun `logs the configured public Docker URL`(output: CapturedOutput) {
        val startupLogger = StartupMessageLogger(serverPort = 8286, configuredPublicUrl = " http://docker-host:9286/ ")

        startupLogger.logApplicationReady()

        assertContains(output.out, "Jetzt im Browser öffnen: http://docker-host:9286/")
    }
}
