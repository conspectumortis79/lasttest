package de.lasttest.api

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ModelsTest {
    @Test
    fun `derives request body presence from the example by default`() {
        val withBody = ApiOperation("post", "POST", "/", "", true, emptyList(), mapOf("value" to true))
        val withoutBody = ApiOperation("get", "GET", "/", "", false, emptyList(), null)

        assertTrue(withBody.hasRequestBody)
        assertFalse(withoutBody.hasRequestBody)
    }
}
