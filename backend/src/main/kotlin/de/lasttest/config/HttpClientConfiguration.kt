package de.lasttest.config

import de.lasttest.domain.JdkRemoteSpecificationClient
import de.lasttest.domain.RemoteSpecificationClient
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Primary
import org.springframework.web.client.RestTemplate
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.KeyStore
import java.security.cert.Certificate
import java.security.cert.CertificateFactory
import java.util.UUID
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory

@Configuration
class HttpClientConfiguration {
    private val log = LoggerFactory.getLogger(HttpClientConfiguration::class.java)

    @Bean
    fun restTemplate(): RestTemplate = RestTemplate()

    @Bean
    @Primary
    fun remoteSpecificationClient(): RemoteSpecificationClient = remoteSpecificationClient(SystemEnvironmentVariables)

    fun remoteSpecificationClient(environment: EnvironmentVariables): RemoteSpecificationClient {
        val context = buildSslContext(environment) ?: return JdkRemoteSpecificationClient()
        return JdkRemoteSpecificationClient(context)
    }

    internal fun buildSslContext(environment: EnvironmentVariables): SSLContext? {
        val path = environment.get(TRUSTSTORE_PATH_ENV) ?: return null
        val password = environment.get(TRUSTSTORE_PASSWORD_ENV) ?: ""
        val trustStore =
            try {
                log.info(
                    "Lade zusätzlichen TrustStore aus {} (Variable {}) für ausgehende HTTPS-Verbindungen.",
                    path,
                    TRUSTSTORE_PATH_ENV,
                )
                loadTrustStore(path, password)
            } catch (exception: Exception) {
                log.warn(
                    "TrustStore unter {} konnte nicht geladen werden ({}). " +
                        "Ausgehende HTTPS-Verbindungen verwenden den Standard-TrustStore der JVM.",
                    path,
                    exception.message ?: exception::class.java.simpleName,
                )
                return null
            }
        return try {
            val trustManagers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            trustManagers.init(trustStore)
            val context = SSLContext.getInstance("TLS")
            context.init(null, trustManagers.trustManagers, null)
            log.info("TrustStore {} erfolgreich geladen.", path)
            context
        } catch (exception: Exception) {
            log.warn(
                "SSLContext konnte mit dem TrustStore {} nicht initialisiert werden ({}). " +
                    "Ausgehende HTTPS-Verbindungen verwenden den Standard-TrustStore der JVM.",
                path,
                exception.message ?: exception::class.java.simpleName,
            )
            null
        }
    }

    internal fun loadTrustStore(
        path: String,
        password: String,
    ): KeyStore {
        val file = File(path)
        if (!file.exists()) {
            throw IllegalStateException("TrustStore-Datei nicht gefunden: $path")
        }
        val format = detectFormat(path)
        val merged = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
        when (format) {
            TrustStoreFormat.PEM -> importPem(file, merged)
            TrustStoreFormat.PKCS12,
            TrustStoreFormat.JKS,
            -> importKeyStore(file, password, format.name, merged)
        }
        return merged
    }

    private fun importKeyStore(
        file: File,
        password: String,
        type: String,
        merged: KeyStore,
    ) {
        val source = KeyStore.getInstance(type)
        FileInputStream(file).use { input -> source.load(input, password.toCharArray()) }
        for (alias in source.aliases().toList()) {
            val cert: Certificate = source.getCertificate(alias) ?: continue
            val target = if (merged.containsAlias(alias)) "lasttest-${UUID.randomUUID()}" else alias
            merged.setCertificateEntry(target, cert)
        }
    }

    private fun importPem(
        file: File,
        merged: KeyStore,
    ) {
        val factory = CertificateFactory.getInstance("X.509")
        FileInputStream(file).use { input -> importCertificates(input, merged) }
    }

    private fun importCertificates(
        input: InputStream,
        merged: KeyStore,
    ) {
        val certificates: Collection<Certificate> = CertificateFactory.getInstance("X.509").generateCertificates(input)
        for (cert in certificates) {
            merged.setCertificateEntry("lasttest-${UUID.randomUUID()}", cert)
        }
    }

    private fun detectFormat(path: String): TrustStoreFormat {
        val lower = path.lowercase()
        return when {
            lower.endsWith(".p12") || lower.endsWith(".pfx") -> TrustStoreFormat.PKCS12
            lower.endsWith(".jks") -> TrustStoreFormat.JKS
            lower.endsWith(".pem") || lower.endsWith(".crt") || lower.endsWith(".cer") -> TrustStoreFormat.PEM
            else -> TrustStoreFormat.PKCS12
        }
    }

    internal enum class TrustStoreFormat { PKCS12, JKS, PEM }

    internal companion object {
        const val TRUSTSTORE_PATH_ENV: String = "LASTTEST_TRUSTSTORE_PATH"
        const val TRUSTSTORE_PASSWORD_ENV: String = "LASTTEST_TRUSTSTORE_PASSWORD"
    }
}

interface EnvironmentVariables {
    fun get(name: String): String?
}

object SystemEnvironmentVariables : EnvironmentVariables {
    override fun get(name: String): String? = System.getenv(name)
}

class MapEnvironmentVariables(
    private val values: Map<String, String>,
) : EnvironmentVariables {
    override fun get(name: String): String? = values[name]
}
