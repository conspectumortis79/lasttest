package de.lasttest.demo

import de.lasttest.demo.DefaultDemoControllerToggle
import java.lang.reflect.Method
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DemoProductControllerAuthTest {
    private val controller = DemoProductController(DefaultDemoControllerToggle().apply { enable() })

    private fun hasBasicCredentials(authorization: String?): Boolean = invoke("hasBasicCredentials", authorization) as Boolean

    private fun hasOAuth2Token(authorization: String?): Boolean = invoke("hasOAuth2Token", authorization) as Boolean

    private fun hasApiKey(apiKey: String?): Boolean = invoke("hasApiKey", apiKey) as Boolean

    private fun hasBearerToken(authorization: String?): Boolean = invoke("hasBearerToken", authorization) as Boolean

    private fun hasOidcIdToken(authorization: String?): Boolean = invoke("hasOidcIdToken", authorization) as Boolean

    private fun invoke(
        name: String,
        arg: String?,
    ): Any? {
        val method: Method =
            DemoProductController::class.java.getDeclaredMethod(name, String::class.java)
        method.isAccessible = true
        return method.invoke(controller, arg)
    }

    @Test
    fun `hasBasicCredentials rejects a null header`() {
        assertFalse(hasBasicCredentials(null))
    }

    @Test
    fun `hasBasicCredentials rejects a header with the wrong scheme`() {
        assertFalse(hasBasicCredentials("Bearer token"))
    }

    @Test
    fun `hasBasicCredentials rejects an empty encoded payload`() {
        assertFalse(hasBasicCredentials("Basic "))
        assertFalse(hasBasicCredentials("Basic\t"))
    }

    @Test
    fun `hasBasicCredentials rejects a non-base64 encoded payload`() {
        assertFalse(hasBasicCredentials("Basic !!!not-base64!!!"))
    }

    @Test
    fun `hasBasicCredentials rejects an encoded payload without a colon separator`() {
        assertFalse(hasBasicCredentials("Basic bm8tY29sb24taGVyZQ=="))
    }

    @Test
    fun `hasBasicCredentials rejects an encoded payload with an empty username or password`() {
        assertFalse(hasBasicCredentials("Basic Og==")) // base64(":")
        assertFalse(hasBasicCredentials("Basic YWxpY2U6")) // base64("alice:")
    }

    @Test
    fun `hasBasicCredentials accepts the exact demo credentials`() {
        assertTrue(hasBasicCredentials("Basic YWxpY2U6czNjcmV0"))
    }

    @Test
    fun `hasBasicCredentials is case-sensitive on the username`() {
        assertFalse(hasBasicCredentials("Basic QUxJQ0U6czNjcmV0"))
    }

    @Test
    fun `hasOAuth2Token rejects a null header`() {
        assertFalse(hasOAuth2Token(null))
    }

    @Test
    fun `hasOAuth2Token rejects a header with the wrong scheme`() {
        assertFalse(hasOAuth2Token("Basic token"))
    }

    @Test
    fun `hasOAuth2Token rejects an empty token`() {
        assertFalse(hasOAuth2Token("Bearer "))
    }

    @Test
    fun `hasOAuth2Token rejects a non-empty but wrong token`() {
        assertFalse(hasOAuth2Token("Bearer some-other-token"))
    }

    @Test
    fun `hasOAuth2Token accepts the exact demo token`() {
        assertTrue(hasOAuth2Token("Bearer demo-oauth2-token-12345"))
    }

    @Test
    fun `hasApiKey rejects a null or empty or blank key`() {
        assertFalse(hasApiKey(null))
        assertFalse(hasApiKey(""))
        assertFalse(hasApiKey("   "))
    }

    @Test
    fun `hasApiKey rejects a non-empty but wrong key`() {
        assertFalse(hasApiKey("wrong"))
    }

    @Test
    fun `hasApiKey accepts the exact demo key`() {
        assertTrue(hasApiKey("demo-api-key-12345"))
    }

    @Test
    fun `hasBearerToken rejects every non-exact token shape`() {
        assertFalse(hasBearerToken(null))
        assertFalse(hasBearerToken(""))
        assertFalse(hasBearerToken("Bearer "))
        assertFalse(hasBearerToken("Bearer wrong"))
        assertFalse(hasBearerToken("Basic token"))
    }

    @Test
    fun `hasBearerToken accepts the exact demo token`() {
        assertTrue(hasBearerToken("Bearer demo-bearer-token"))
    }

    @Test
    fun `hasOidcIdToken rejects a null header`() {
        assertFalse(hasOidcIdToken(null))
    }

    @Test
    fun `hasOidcIdToken rejects a header with the wrong scheme`() {
        assertFalse(hasOidcIdToken("Basic token"))
    }

    @Test
    fun `hasOidcIdToken rejects an empty token`() {
        assertFalse(hasOidcIdToken("Bearer "))
        assertFalse(hasOidcIdToken("Bearer  "))
    }

    @Test
    fun `hasOidcIdToken rejects a non-empty but wrong token`() {
        assertFalse(hasOidcIdToken("Bearer some-other-token"))
    }

    @Test
    fun `hasOidcIdToken accepts the exact demo token`() {
        assertTrue(hasOidcIdToken("Bearer demo-oidc-id-token-12345"))
    }
}
