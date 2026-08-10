package de.lasttest.config

import org.springframework.boot.context.properties.ConfigurationProperties
import java.nio.file.Path

/**
 * Configuration for at-rest encryption of the timeline's
 * sensitive JSON columns (`configuration_json`,
 * `original_request_json`).
 *
 * All fields have sensible defaults so a fresh install works
 * out of the box — the application generates a random 256-bit
 * AES key on first start, writes it under
 * [lasttest.data-dir]`/encryption.key` and uses that for
 * every subsequent encrypt/decrypt call. The key never leaves
 * the container; a backup of the H2 file alone (without the
 * key file) makes the timeline rows unreadable.
 *
 * Operators who run multiple containers against the same H2
 * volume (read replicas, blue/green deploys) can pin a key
 * via [key] or [LASTTEST_ENCRYPTION_KEY] so every instance
 * derives the same ciphertext.
 */
@ConfigurationProperties(prefix = "lasttest.encryption")
data class TestRunEncryptionProperties(
    /**
     * Master switch. When `false`, the [TestRunPayloadEncryptor]
     * bean degrades to a no-op and the columns are stored in
     * plaintext. Useful for forensic debugging or for users who
     * have a separate encryption-at-rest policy (e.g. disk
     * encryption on the Docker volume). Defaults to `true` so
     * the timeline is protected by default.
     */
    val enabled: Boolean = true,
    /**
     * Optional 32-byte AES key, Base64-encoded. When set, this
     * value takes precedence over [keyFile]. Use this for
     * production deployments that share the H2 volume between
     * containers — every container must derive the same
     * ciphertext.
     */
    val key: String? = null,
    /**
     * Path to a file that contains the raw 32-byte AES key
     * (no encoding, no newline). When [key] is null and this
     * file does not exist, the application generates a fresh
     * 32-byte key, writes it to this file with mode `0600`,
     * and uses that for subsequent operations.
     */
    val keyFile: Path? = null,
)
