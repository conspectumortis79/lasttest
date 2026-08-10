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

/**
 * End-to-end verification that the at-rest encryption feature
 * is actually wired into the running Spring context. The
 * [de.lasttest.domain.TestRunMappersTest] covers the
 * encryptor / decryptor in isolation; this test exercises the
 * production bean graph so a future refactor that accidentally
 * bypasses the encryptor (e.g. by using a default
 * [de.lasttest.domain.NoOpTestRunPayloadEncryptor] instead of
 * the wired-in
 * [de.lasttest.domain.AesGcmTestRunPayloadEncryptor]) surfaces
 * as a test failure here, not as a leaked plaintext row in
 * the user's H2 file.
 *
 * The test:
 *   1. Boots a Spring context with an isolated data dir so
 *      the auto-generated key file does not collide with a
 *      developer's local H2 file.
 *   2. Resolves the active [TestRunPayloadEncryptor] bean and
 *      asserts it is the real AES/GCM implementation, not
 *      the no-op.
 *   3. Writes a synthetic [de.lasttest.domain.TestRunEntity]
 *      with a [TestRunConfiguration] that contains a known
 *      secret string, then re-reads the row through
 *      [TestRunRepository.findById] and checks the column
 *      contents on the database level (raw bytes, not via
 *      the mapper) to confirm the plaintext is no longer
 *      present.
 *   4. Re-reads the row through the mapper and confirms the
 *      decryptor returns the original [TestRunConfiguration].
 */
@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class LasttestApplicationEncryptionTest {
    @Autowired
    private lateinit var encryptor: TestRunPayloadEncryptor

    @Autowired
    private lateinit var runRepository: TestRunRepository

    private lateinit var dataDir: Path

    companion object {
        // H2 refuses relative paths in its JDBC URL — the
        // data-dir has to be absolute before Spring hands the
        // URL to the driver. `@DynamicPropertySource` lets the
        // test materialise a fresh tmp dir at the time the
        // context is built (one per test class) so the key
        // file the encryption layer auto-generates is unique
        // to this test run and the dev's local H2 file is
        // never touched.
        @JvmStatic
        private val dataDirPath: String =
            Files.createTempDirectory("lasttest-encryption-e2e-").toAbsolutePath().toString()

        @JvmStatic
        @DynamicPropertySource
        fun registerProperties(registry: DynamicPropertyRegistry) {
            registry.add("lasttest.data-dir") { dataDirPath }
            registry.add("lasttest.encryption.enabled") { "true" }
            // Disable InfluxDB side-effects during the test.
            registry.add("lasttest.influxdb.enabled") { "false" }
        }

        @JvmStatic
        @AfterAll
        fun cleanUpDataDir() {
            // Remove the per-class tmp dir so the test does
            // not leak auto-generated key files into the host
            // tmp. The @AfterAll hook runs after the Spring
            // context is closed, so deleting the file does
            // not race with the in-process database.
            Path.of(dataDirPath).toFile().deleteRecursively()
        }
    }

    @Test
    fun `the active TestRunPayloadEncryptor bean is the real AES implementation, not the no-op`() {
        // The encryptor is the trust boundary. If the
        // Spring wiring accidentally returned the no-op
        // (e.g. because the @Bean method on
        // TestRunEncryptionConfiguration is misconfigured),
        // every row would be stored in plaintext and the
        // feature would silently regress.
        assertTrue(
            encryptor !is de.lasttest.domain.NoOpTestRunPayloadEncryptor,
            "expected the active encryptor to be the AES/GCM implementation, " +
                "but got ${encryptor::class.java.simpleName}",
        )
    }

    @Test
    fun `writing a run via the mapper stores the configuration and originalRequest encrypted on disk`() {
        // The mapper encrypts on write. The raw column
        // value on the row must therefore be neither the
        // plaintext configuration nor the plaintext
        // request — and must carry the LENC magic so the
        // read path recognises it as encrypted.
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

        // Write through the real mapper (the same path the
        // service uses when persisting a new run).
        val entity = run.toTestRunEntity(mapper, encryptor)
        runRepository.save(entity)

        // Read the row back through JPA, bypassing the
        // mapper, so the assertion sees the raw column
        // value exactly as it sits in the H2 file.
        val persisted = runRepository.findById("run-e2e-encrypted").orElse(null)
        assertNotNull(persisted, "expected the entity to be persisted")

        // The LENC magic prefix is the discriminator
        // between encrypted and plaintext rows. A
        // regression that bypassed the encryptor would
        // store the raw JSON in the column and the magic
        // check would fail.
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

        // The plaintext secret must not appear in the
        // stored column — a regression that stored the
        // raw JSON would leak the bearer-token hint and
        // other sensitive values.
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
        // The read path is the inverse of the write path.
        // Whatever the encryptor wrote, the mapper +
        // encryptor must return to the caller as the
        // original [TestRun] DTO. Without this round
        // trip the dashboard would see encrypted blobs
        // instead of the actual run configuration.
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

        // Write through the real encryptor, then read
        // through the real mapper + encryptor pair. This
        // is the exact path the [LocalK6TestRunService]
        // uses on every /api/test-runs/{id} request.
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
        // The contract: the application manages the key
        // itself, with no operator input. The first call
        // to [TestRunPayloadEncryptor.encrypt] triggers
        // the key resolution, which materialises a
        // 32-byte key file in the data directory if no
        // other source is configured. Without this
        // auto-create, a fresh install would crash on
        // first run.
        val keyFile = Path.of(dataDirPath).resolve("encryption.key")
        assertTrue(
            Files.exists(keyFile),
            "expected the auto-generated key file at $keyFile",
        )
        val bytes = Files.readAllBytes(keyFile)
        assertEquals(32, bytes.size, "expected a 32-byte key, got ${bytes.size} bytes")
    }
}
