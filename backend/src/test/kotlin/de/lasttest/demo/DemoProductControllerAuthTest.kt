package de.lasttest.demo

import de.lasttest.demo.DefaultDemoControllerToggle
import java.lang.reflect.Method
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Direct, in-process tests for the private credential helpers in
 * [DemoProductController]. The HTTP-level tests in
 * [DemoProductControllerTest] exercise the same paths indirectly
 * through the Spring controllers, but JaCoCo's branch tracking is
 * precise enough that a few bytecode-level edges on the
 * `?.isNullOrBlank()` checks (e.g. the second jump inside a single
 * `if (x.isEmpty())` expression, or the elvis short-circuit on a
 * blank token) remain uncovered.
 *
 * These tests call the helpers via reflection and exercise every
 * branch with a precisely-shaped input so the coverage gap closes
 * without spinning up the full Spring context for each case.
 */
class DemoProductControllerAuthTest {
    // The bundled toggle defaults to "off"; the auth tests call
    // the controller's credential helpers directly, so the toggle
    // has to be on for the auth branches to be reachable. The
    // `apply { enable() }` mirrors the same shape used by the
    // other controller tests in this package.
    private val controller = DemoProductController(DefaultDemoControllerToggle().apply { enable() })

    private fun hasBasicCredentials(authorization: String?): Boolean = invoke("hasBasicCredentials", authorization) as Boolean

    private fun hasOAuth2Token(authorization: String?): Boolean = invoke("hasOAuth2Token", authorization) as Boolean

    private fun hasApiKey(apiKey: String?): Boolean = invoke("hasApiKey", apiKey) as Boolean

    private fun hasBearerToken(authorization: String?): Boolean = invoke("hasBearerToken", authorization) as Boolean

    private fun invoke(
        name: String,
        arg: String?,
    ): Any? {
        val method: Method =
            DemoProductController::class.java.getDeclaredMethod(name, String::class.java)
        method.isAccessible = true
        return method.invoke(controller, arg)
    }

    // ----- hasBasicCredentials -----

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
        // The `if (encoded.isEmpty()) return false` branch —
        // exercises both the inner length check and the outer
        // `!isEmpty` check on the empty path.
        assertFalse(hasBasicCredentials("Basic "))
        assertFalse(hasBasicCredentials("Basic\t"))
    }

    @Test
    fun `hasBasicCredentials rejects a non-base64 encoded payload`() {
        // runCatching { Base64.decode(encoded) } throws; the
        // exception path returns false via the `?:` elvis.
        assertFalse(hasBasicCredentials("Basic !!!not-base64!!!"))
    }

    @Test
    fun `hasBasicCredentials rejects an encoded payload without a colon separator`() {
        // base64("no-colon-here") = "bm8tY29sb24taGVyZQ=="
        assertFalse(hasBasicCredentials("Basic bm8tY29sb24taGVyZQ=="))
    }

    @Test
    fun `hasBasicCredentials rejects an encoded payload with an empty username or password`() {
        // base64("") covers the "both empty" `||` short-circuit;
        // base64("alice:") covers the "right operand true" path.
        assertFalse(hasBasicCredentials("Basic Og==")) // base64(":")
        assertFalse(hasBasicCredentials("Basic YWxpY2U6")) // base64("alice:")
    }

    @Test
    fun `hasBasicCredentials accepts the exact demo credentials`() {
        // base64("alice:s3cret") = "YWxpY2U6czNjcmV0"
        assertTrue(hasBasicCredentials("Basic YWxpY2U6czNjcmV0"))
    }

    @Test
    fun `hasBasicCredentials is case-sensitive on the username`() {
        // base64("ALICE:s3cret") = "QUxJQ0U6czNjcmV0"
        assertFalse(hasBasicCredentials("Basic QUxJQ0U6czNjcmV0"))
    }

    // ----- hasOAuth2Token -----

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
        // The `if (token.isEmpty()) return false` branch —
        // exercises both the inner length check and the outer
        // `!isEmpty` check on the empty path.
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

    // ----- hasApiKey -----

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

    // ----- hasBearerToken (kept for symmetry so the helper's
    // branches are also covered) -----

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
}
