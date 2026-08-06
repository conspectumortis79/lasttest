package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.LoadStage
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Tests that exclusively cover the branches of the `validateLoadProfile`
 * and `renderScenario` methods. These methods have many validation
 * paths (4 executor flavours × several mandatory fields × range checks),
 * and the normal smoke tests in `DefaultK6ScriptGeneratorTest` do not
 * cover all branches. We test them in isolation here so that coverage
 * gaps in `validateLoadProfile` and `renderScenario` are closed.
 */
class DefaultK6ScriptGeneratorCoverageTest {
    private val generator = DefaultK6ScriptGenerator()
    private val specification =
        ImportedSpecification(
            title = "API",
            version = "1",
            baseUrl = "",
            operations = listOf(ApiOperation("getPet", "GET", "/pets", "", false, listOf(ApiParameter("id", "path", true, 1)), null)),
        )

    // --- validateLoadProfile: CONSTANT_VUS branches ---

    @Test
    fun `rejects constant-vus with null virtualUsers`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = null, durationSeconds = 10)
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("virtualUsers"))
    }

    @Test
    fun `rejects constant-vus with null durationSeconds`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 10, durationSeconds = null)
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("durationSeconds"))
    }

    @Test
    fun `rejects constant-vus with virtualUsers below minimum`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 0, durationSeconds = 10)
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Virtual Users"))
    }

    @Test
    fun `rejects constant-vus with virtualUsers above maximum`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 30_001, durationSeconds = 10)
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Virtual Users"))
    }

    @Test
    fun `rejects constant-vus with durationSeconds above maximum`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 10, durationSeconds = 3601)
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Dauer"))
    }

    // --- validateLoadProfile: SHARED_ITERATIONS branches ---

    @Test
    fun `rejects shared-iterations with null virtualUsers`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = null, iterations = 100)
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("virtualUsers"))
    }

    @Test
    fun `rejects shared-iterations with null iterations`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 10, iterations = null)
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("iterations"))
    }

    @Test
    fun `rejects shared-iterations with iterations above maximum`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 10, iterations = 1_000_001)
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Iterationen"))
    }

    // --- validateLoadProfile: RAMPING_VUS branches ---

    @Test
    fun `rejects ramping-vus with null stages`() {
        val profile = LoadProfile(type = LoadProfileType.RAMPING_VUS, startVUs = 0, stages = null)
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("stages"))
    }

    @Test
    fun `rejects ramping-vus with empty stages`() {
        val profile = LoadProfile(type = LoadProfileType.RAMPING_VUS, startVUs = 0, stages = emptyList())
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("mindestens eine Stage"))
    }

    @Test
    fun `rejects ramping-vus with startVUs above maximum`() {
        val profile = LoadProfile(type = LoadProfileType.RAMPING_VUS, startVUs = 30_001, stages = listOf(LoadStage(10, 30)))
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Start-VUs"))
    }

    @Test
    fun `rejects ramping-vus with stage target above maximum`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = 0,
                stages = listOf(LoadStage(target = 30_001, durationSeconds = 30)),
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Ziel-VUs"))
    }

    @Test
    fun `rejects ramping-vus with stage target below zero`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = 0,
                stages = listOf(LoadStage(target = -1, durationSeconds = 30)),
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Ziel-VUs"))
    }

    @Test
    fun `rejects ramping-vus with stage duration above maximum`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = 0,
                stages = listOf(LoadStage(target = 10, durationSeconds = 3601)),
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Dauer"))
    }

    @Test
    fun `rejects ramping-vus with stage duration below one`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = 0,
                stages = listOf(LoadStage(target = 10, durationSeconds = 0)),
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Dauer"))
    }

    // --- validateLoadProfile: CONSTANT_ARRIVAL_RATE branches ---

    @Test
    fun `rejects constant-arrival-rate with null rate`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = null,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("rate"))
    }

    @Test
    fun `rejects constant-arrival-rate with null timeUnit`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = null,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("timeUnit"))
    }

    @Test
    fun `rejects constant-arrival-rate with null durationSeconds`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = null,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("durationSeconds"))
    }

    @Test
    fun `rejects constant-arrival-rate with null preAllocatedVUs`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = null,
                maxVUs = 100,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("preAllocatedVUs"))
    }

    @Test
    fun `rejects constant-arrival-rate with null maxVUs`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = null,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("maxVUs"))
    }

    @Test
    fun `rejects constant-arrival-rate with rate below minimum`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 0,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Rate"))
    }

    @Test
    fun `rejects constant-arrival-rate with rate above maximum`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 100_001,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Rate"))
    }

    @Test
    fun `rejects constant-arrival-rate with timeUnit above 60`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 61,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Zeiteinheit"))
    }

    @Test
    fun `rejects constant-arrival-rate with timeUnit below 1`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 0,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("Zeiteinheit"))
    }

    @Test
    fun `rejects constant-arrival-rate with preAllocatedVUs above maximum`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 30_001,
                maxVUs = 30_002,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("preAllocatedVUs"))
    }

    @Test
    fun `rejects constant-arrival-rate with preAllocatedVUs below minimum`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 0,
                maxVUs = 100,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("preAllocatedVUs"))
    }

    @Test
    fun `rejects constant-arrival-rate with maxVUs below preAllocatedVUs`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 100,
                maxVUs = 50,
            )
        val ex =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(ex.message!!.contains("maxVUs"))
    }

    // --- renderScenario: cover all 4 branches explicitly ---

    @Test
    fun `renderScenario constant-vus with all fields set produces valid output`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 50, durationSeconds = 120)
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
        assertTrue(script.contains("executor: 'constant-vus'"))
        assertTrue(script.contains("vus: 50"))
        assertTrue(script.contains("duration: '120s'"))
    }

    @Test
    fun `renderScenario shared-iterations with all fields set produces valid output`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 10, iterations = 200)
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
        assertTrue(script.contains("executor: 'shared-iterations'"))
        assertTrue(script.contains("vus: 10"))
        assertTrue(script.contains("iterations: 200"))
    }

    @Test
    fun `renderScenario ramping-vus with multiple stages produces valid output`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = 5,
                stages =
                    listOf(
                        LoadStage(target = 10, durationSeconds = 30),
                        LoadStage(target = 50, durationSeconds = 60),
                        LoadStage(target = 0, durationSeconds = 30),
                    ),
            )
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
        assertTrue(script.contains("executor: 'ramping-vus'"))
        assertTrue(script.contains("startVUs: 5"))
        assertTrue(script.contains("{ target: 10, duration: '30s' }"))
        assertTrue(script.contains("{ target: 50, duration: '60s' }"))
        assertTrue(script.contains("{ target: 0, duration: '30s' }"))
    }

    @Test
    fun `renderScenario ramping-vus with null startVUs defaults to zero`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = null,
                stages = listOf(LoadStage(target = 10, durationSeconds = 30)),
            )
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
        assertTrue(script.contains("startVUs: 0"))
    }

    @Test
    fun `renderScenario constant-arrival-rate with all fields set produces valid output`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 100,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 5,
                maxVUs = 50,
            )
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), profile)
        assertTrue(script.contains("executor: 'constant-arrival-rate'"))
        assertTrue(script.contains("rate: 100"))
        assertTrue(script.contains("timeUnit: '1s'"))
        assertTrue(script.contains("preAllocatedVUs: 5"))
        assertTrue(script.contains("maxVUs: 50"))
    }
}
