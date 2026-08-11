package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunConfiguration
import java.time.Instant

fun TestRunEntity.toTestRun(
    mapper: ObjectMapper = ObjectMapper(),
    encryptor: TestRunPayloadEncryptor = NoOpTestRunPayloadEncryptor,
): TestRun {
    val configuration =
        encryptor.decrypt(configurationJson)?.let { decrypted ->
            runCatching { mapper.readValue(decrypted, TestRunConfiguration::class.java) }.getOrNull()
        }
    val originalRequest =
        encryptor.decrypt(originalRequestJson)?.let { decrypted ->
            runCatching { mapper.readValue(decrypted, CreateTestRunRequest::class.java) }.getOrNull()
        }
    val summary =
        summaryJson?.let { raw -> mapOf("raw" to raw) }
    return TestRun(
        id = id,
        status = status,
        createdAt = createdAt.toString(),
        startedAt = startedAt?.toString(),
        finishedAt = finishedAt?.toString(),
        exitCode = exitCode,
        configuration = configuration,
        summary = summary,
        consoleOutput = consoleOutput,
        error = error,
        cancelledAt = cancelledAt?.toString(),
        cancelledByForce = cancelledByForce,
        originalRequest = originalRequest,
    )
}

fun TestRun.toTestRunEntity(
    mapper: ObjectMapper = ObjectMapper(),
    encryptor: TestRunPayloadEncryptor = NoOpTestRunPayloadEncryptor,
): TestRunEntity {
    val entity = TestRunEntity()
    entity.id = id
    entity.status = status
    entity.createdAt = Instant.parse(createdAt)
    entity.startedAt = startedAt?.let { Instant.parse(it) }
    entity.finishedAt = finishedAt?.let { Instant.parse(it) }
    entity.exitCode = exitCode
    entity.configurationJson =
        configuration?.let { source ->
            val sanitised =
                source.copy(
                    operations =
                        source.operations.map { operation ->
                            operation.copy(
                                payloads = emptyList(),
                                parameterValues = emptyList(),
                                requestBodyJson = null,
                            )
                        },
                )
            val serialised = runCatching { mapper.writeValueAsString(sanitised) }.getOrNull()
            serialised?.let { encryptor.encrypt(it) }
        }
    entity.summaryJson = (summary?.get("raw") as? String)
    entity.consoleOutput = consoleOutput
    entity.error = error
    entity.cancelledAt = cancelledAt?.let { Instant.parse(it) }
    entity.cancelledByForce = cancelledByForce
    entity.originalRequestJson =
        originalRequest?.let { source ->
            val sanitised =
                source.copy(
                    operationConfigurations =
                        source.operationConfigurations.map { configuration ->
                            configuration.copy(
                                payloads = emptyList(),
                                parameterValues = emptyList(),
                                requestBodyJson = null,
                                bearerToken = null,
                                basicAuthUsername = null,
                                basicAuthPassword = null,
                                apiKey = null,
                                oauth2Token = null,
                                oidcIdToken = null,
                            )
                        },
                )
            val serialised = runCatching { mapper.writeValueAsString(sanitised) }.getOrNull()
            serialised?.let { encryptor.encrypt(it) }
        }
    val firstOp = configuration?.operations?.firstOrNull()
    entity.operationMethod = firstOp?.method
    entity.operationPath = firstOp?.path
    entity.operationId = firstOp?.operationId
    return entity
}
