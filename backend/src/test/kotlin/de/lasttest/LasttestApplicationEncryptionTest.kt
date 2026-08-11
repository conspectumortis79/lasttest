package de.lasttest

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.KotlinModule
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunConfiguration
import de.lasttest.api.TestRunOperationConfiguration
import de.lasttest.api.TestRunStatus
import de.lasttest.domain.TestRunPayloadEncryptor
import de.lasttest.domain.TestRunRepository
import de.lasttest.domain.toTestRun
import de.lasttest.domain.toTestRunEntity
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class LasttestApplicationEncryptionTest {
    @Autowired
    private lateinit var encryptor: TestRunPayloadEncryptor

    @Autowired
    private lateinit var runRepository: TestRunRepository

    private lateinit var dataDir: Path

    companion object {
        @JvmStatic
        private val dataDirPath: String =
            Files.createTempDirectory("lasttest-encryption-e2e-").toAbsolutePath().toString()

        @JvmStatic
        @DynamicPropertySource
        fun registerProperties(registry: DynamicPropertyRegistry) {
            registry.add("lasttest.data-dir") { dataDirPath }
            registry.add("lasttest.encryption.enabled") { "true" }
            registry.add("lasttest.influxdb.enabled") { "false" }
        }

        @JvmStatic
        @AfterAll
        fun cleanUpDataDir() {
            Path.of(dataDirPath).toFile().deleteRecursively()
        }
    }

    @Test
    fun `the active TestRunPayloadEncryptor bean is the real AES implementation, not the no-op`() {
        assertTrue(
            encryptor !is de.lasttest.domain.NoOpTestRunPayloadEncryptor,
            "expected the active encryptor to be the AES/GCM implementation, " +
                "but got ${encryptor::class.java.simpleName}",
        )
    }

    @Test
    fun `writing a run via the mapper stores the configuration and originalRequest encrypted on disk`() {
        val mapper = ObjectMapper().registerModule(KotlinModule.Builder().build())
        val secret = "super-secret-bearer-token-12345"
        val configuration =
            TestRunConfiguration(
                apiTitle = "Pet API",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "getPet",
                            method = "GET",
                            path = "/pets/{id}",
                            summary = "Find pet",
                            payloads = emptyList(),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                            bearerTokenConfigured = true,
                        ),
                    ),
            )
        val originalRequest =
            CreateTestRunRequest(
                specification = "openapi: 3.0.3\ninfo:\n  title: Pet API\n",
                baseUrl = "https://target.test",
                operationIds = setOf("getPet"),
                operationConfigurations = emptyList(),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
            )
        val run =
            TestRun(
                id = "run-e2e-encrypted",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
                originalRequest = originalRequest,
            )

        val entity = run.toTestRunEntity(mapper, encryptor)
        runRepository.save(entity)

        val persisted = runRepository.findById("run-e2e-encrypted").orElse(null)
        assertNotNull(persisted, "expected the entity to be persisted")

        val storedConfig = assertNotNull(persisted.configurationJson)
        val storedRequest = assertNotNull(persisted.originalRequestJson)
        assertTrue(
            storedConfig.startsWith("TEVOQ"),
            "expected configuration column to start with the LENC magic, got: $storedConfig",
        )
        assertTrue(
            storedRequest.startsWith("TEVOQ"),
            "expected originalRequest column to start with the LENC magic, got: $storedRequest",
        )

        assertTrue(
            !storedConfig.contains(secret),
            "expected the secret string to be absent from the encrypted configuration column",
        )
        assertTrue(
            !storedRequest.contains("Pet API"),
            "expected the API title to be absent from the encrypted originalRequest column",
        )
    }

    @Test
    fun `reading a run via the mapper decrypts the configuration and originalRequest ad-hoc`() {
        val mapper = ObjectMapper().registerModule(KotlinModule.Builder().build())
        val configuration =
            TestRunConfiguration(
                apiTitle = "Demo",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "getThing",
                            method = "GET",
                            path = "/things/{id}",
                            summary = "Get thing",
                            payloads = emptyList(),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                        ),
                    ),
            )
        val originalRequest =
            CreateTestRunRequest(
                specification = "openapi: 3.0.3",
                baseUrl = "https://target.test",
                operationIds = setOf("getThing"),
                operationConfigurations = emptyList(),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
            )
        val run =
            TestRun(
                id = "run-e2e-roundtrip",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
                originalRequest = originalRequest,
            )

        val entity = run.toTestRunEntity(mapper, encryptor)
        runRepository.save(entity)
        val roundTripped =
            runRepository
                .findById("run-e2e-roundtrip")
                .orElse(null)
                ?.toTestRun(mapper, encryptor)

        val actual = assertNotNull(roundTripped, "expected the round-tripped DTO to be non-null")
        assertEquals(configuration, actual.configuration)
        assertEquals(originalRequest, actual.originalRequest)
    }

    @Test
    fun `the auto-generated key file is created in the data dir on first use`() {
        val keyFile = Path.of(dataDirPath).resolve("encryption.key")
        assertTrue(
            Files.exists(keyFile),
            "expected the auto-generated key file at $keyFile",
        )
        val bytes = Files.readAllBytes(keyFile)
        assertEquals(32, bytes.size, "expected a 32-byte key, got ${bytes.size} bytes")
    }
}
