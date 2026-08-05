package de.lasttest.config

import java.io.File
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.UUID
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HttpClientConfigurationTest {
    private val config = HttpClientConfiguration()
    private val workDir = File(System.getProperty("java.io.tmpdir"), "lasttest-truststore-${UUID.randomUUID()}")

    init {
        workDir.mkdirs()
    }

    @Test
    fun `buildSslContext returns null when no truststore environment variable is set`() {
        assertNull(config.buildSslContext(MapEnvironmentVariables(emptyMap())))
    }

    @Test
    fun `buildSslContext logs a warning and returns null when the file does not exist`() {
        val missing = "/tmp/lasttest-missing-${UUID.randomUUID()}.p12"
        val environment =
            MapEnvironmentVariables(
                mapOf(
                    HttpClientConfiguration.TRUSTSTORE_PATH_ENV to missing,
                    HttpClientConfiguration.TRUSTSTORE_PASSWORD_ENV to "",
                ),
            )
        assertNull(config.buildSslContext(environment))
    }

    @Test
    fun `loadTrustStore imports a PEM encoded certificate`() {
        val pemFile = createSelfSignedCertificatePem()

        val trustStore = config.loadTrustStore(pemFile.absolutePath, "")

        assertEquals(1, countAliases(trustStore))
    }

    @Test
    fun `loadTrustStore imports a PKCS12 truststore`() {
        val p12File = createPkcs12Truststore()

        val trustStore = config.loadTrustStore(p12File.absolutePath, "changeit")

        assertTrue(countAliases(trustStore) >= 1)
    }

    @Test
    fun `loadTrustStore imports a JKS truststore`() {
        val jksFile = createJksTruststore()

        val trustStore = config.loadTrustStore(jksFile.absolutePath, "changeit")

        assertTrue(countAliases(trustStore) >= 1)
    }

    @Test
    fun `loadTrustStore throws when the file does not exist`() {
        val missing = File(workDir, "missing-${UUID.randomUUID()}.p12")
        val exception =
            assertFailsWith<IllegalStateException> {
                config.loadTrustStore(missing.absolutePath, "")
            }
        assertTrue(exception.message!!.contains("nicht gefunden"))
    }

    @Test
    fun `buildSslContext produces a context that trusts the configured certificate`() {
        val pemFile = createSelfSignedCertificatePem()
        val environment =
            MapEnvironmentVariables(
                mapOf(
                    HttpClientConfiguration.TRUSTSTORE_PATH_ENV to pemFile.absolutePath,
                    HttpClientConfiguration.TRUSTSTORE_PASSWORD_ENV to "",
                ),
            )
        val context = config.buildSslContext(environment)
        assertNotNull(context)
        val trustManager = firstX509TrustManager(config.loadTrustStore(pemFile.absolutePath, ""))
        val cert = readCertificate(pemFile)
        trustManager.checkServerTrusted(arrayOf<X509Certificate>(cert), "RSA")
    }

    private fun readCertificate(pemFile: File): X509Certificate {
        val factory =
            java.security.cert.CertificateFactory
                .getInstance("X.509")
        return factory.generateCertificate(pemFile.inputStream()) as X509Certificate
    }

    private fun firstX509TrustManager(trustStore: java.security.KeyStore): X509TrustManager {
        val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        factory.init(trustStore)
        return factory.trustManagers.filterIsInstance<X509TrustManager>().first()
    }

    private fun createSelfSignedCertificatePem(): File {
        val certFile = File(workDir, "cert-${UUID.randomUUID()}.pem")
        val p12 = certFile.absolutePath + ".p12"
        runProcess(
            listOf(
                keytool(),
                "-genkeypair",
                "-alias",
                "lasttest-test",
                "-keyalg",
                "RSA",
                "-keysize",
                "2048",
                "-validity",
                "1",
                "-dname",
                "CN=lasttest-test",
                "-storetype",
                "PKCS12",
                "-keystore",
                p12,
                "-storepass",
                "changeit",
            ),
        )
        runProcess(
            listOf(
                keytool(),
                "-exportcert",
                "-rfc",
                "-alias",
                "lasttest-test",
                "-keystore",
                p12,
                "-storepass",
                "changeit",
                "-file",
                certFile.absolutePath,
            ),
        )
        File(p12).delete()
        return certFile
    }

    private fun createPkcs12Truststore(): File {
        val source = File(workDir, "source-${UUID.randomUUID()}.p12")
        runProcess(
            listOf(
                keytool(),
                "-genkeypair",
                "-alias",
                "lasttest-test",
                "-keyalg",
                "RSA",
                "-keysize",
                "2048",
                "-validity",
                "1",
                "-dname",
                "CN=lasttest-test",
                "-storetype",
                "PKCS12",
                "-keystore",
                source.absolutePath,
                "-storepass",
                "changeit",
            ),
        )
        val cert = File(workDir, "export-${UUID.randomUUID()}.cer")
        runProcess(
            listOf(
                keytool(),
                "-exportcert",
                "-alias",
                "lasttest-test",
                "-keystore",
                source.absolutePath,
                "-storepass",
                "changeit",
                "-file",
                cert.absolutePath,
            ),
        )
        val truststore = File(workDir, "ts-${UUID.randomUUID()}.p12")
        runProcess(
            listOf(
                keytool(),
                "-importcert",
                "-noprompt",
                "-alias",
                "lasttest-test",
                "-file",
                cert.absolutePath,
                "-keystore",
                truststore.absolutePath,
                "-storepass",
                "changeit",
            ),
        )
        cert.delete()
        source.delete()
        return truststore
    }

    private fun createJksTruststore(): File {
        val p12 = createPkcs12Truststore()
        val jks = File(workDir, "ts-${UUID.randomUUID()}.jks")
        runProcess(
            listOf(
                keytool(),
                "-importkeystore",
                "-srckeystore",
                p12.absolutePath,
                "-srcstorepass",
                "changeit",
                "-destkeystore",
                jks.absolutePath,
                "-deststorepass",
                "changeit",
                "-deststoretype",
                "JKS",
            ),
        )
        p12.delete()
        return jks
    }

    private fun keytool(): String {
        val javaHome = System.getProperty("java.home")
        val candidates =
            listOf(
                "$javaHome/bin/keytool",
                "/usr/bin/keytool",
                "/usr/lib/jvm/default/bin/keytool",
            )
        return candidates.first { File(it).exists() }
    }

    private fun runProcess(command: List<String>) {
        val process = ProcessBuilder(command).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        val exit = process.waitFor()
        if (exit != 0) {
            throw IllegalStateException("Command failed (exit=$exit): ${command.joinToString(" ")}\n$output")
        }
    }

    private fun countAliases(store: KeyStore): Int = store.aliases().toList().size
}
