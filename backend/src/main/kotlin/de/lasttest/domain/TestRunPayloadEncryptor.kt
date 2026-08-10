package de.lasttest.domain

/**
 * Encrypts and decrypts the JSON payloads the timeline persists
 * for every test run — namely [TestRunEntity.configurationJson]
 * and [TestRunEntity.originalRequestJson]. The two columns carry
 * the test configuration (operations, payloads, auth credentials)
 * and the original create request (full OpenAPI document, base
 * URL, request body shapes), so at-rest encryption keeps those
 * sensitive values out of the H2 file on disk.
 *
 * The contract is deliberately minimal — strings in, strings out
 * — so the call site (the [TestRunEntity] mappers in
 * [TestRunMappers]) does not have to know which algorithm is in
 * use. The decrypt path also accepts plaintext (no magic prefix)
 * so a row written by an older build, before the encryption
 * feature shipped, keeps working without a manual migration.
 *
 * Implementations must be safe to call from concurrent mappers
 * (multiple HTTP requests can read the same column at the same
 * time) and must treat `null` as "no payload" rather than as an
 * error to surface. The same goes for empty strings.
 */
interface TestRunPayloadEncryptor {
    /**
     * Returns the encrypted form of [plain] or `null` when
     * [plain] is `null`. Empty input is encrypted as an empty
     * string (so a round trip through encrypt→decrypt returns
     * an empty string), which keeps the field nullability
     * identical to the input.
     */
    fun encrypt(plain: String?): String?

    /**
     * Returns the decrypted form of [blob] or `null` when
     * [blob] is `null`. When [blob] does not carry the
     * encryption magic prefix (i.e. it is a plaintext row
     * written by an older build), the method returns the
     * input unchanged so legacy rows stay readable.
     */
    fun decrypt(blob: String?): String?
}

/**
 * Identity [TestRunPayloadEncryptor]. Used as the default for
 * the mapper functions and as the production wiring when
 * `lasttest.encryption.enabled=false`. Tests that do not care
 * about the encryption layer rely on this implementation so
 * they can continue to assert the JSON shape of the
 * configuration column without setting up a key.
 */
object NoOpTestRunPayloadEncryptor : TestRunPayloadEncryptor {
    override fun encrypt(plain: String?): String? = plain

    override fun decrypt(blob: String?): String? = blob
}
