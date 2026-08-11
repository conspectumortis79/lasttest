package de.lasttest.domain

interface TestRunPayloadEncryptor {
    fun encrypt(plain: String?): String?

    fun decrypt(blob: String?): String?
}

object NoOpTestRunPayloadEncryptor : TestRunPayloadEncryptor {
    override fun encrypt(plain: String?): String? = plain

    override fun decrypt(blob: String?): String? = blob
}
