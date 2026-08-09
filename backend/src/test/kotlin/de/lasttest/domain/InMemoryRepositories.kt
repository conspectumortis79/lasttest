package de.lasttest.domain

import org.springframework.data.domain.Pageable
import java.util.Optional
import java.util.concurrent.ConcurrentHashMap

/**
 * Test-only in-memory implementations of the Spring Data
 * repositories the service now depends on. They live next to the
 * service tests (rather than in `main`) because the production
 * code path is the H2-backed one — these exist purely so the unit
 * tests can run without spinning up an embedded database.
 *
 * Only the methods the service or the controller actually calls
 * are implemented with real behaviour; everything else throws
 * [UnsupportedOperationException] so a future test that hits an
 * unmocked path fails loudly instead of silently returning an
 * empty list.
 */
class InMemoryTestRunRepository : TestRunRepository {
    private val store = ConcurrentHashMap<String, TestRunEntity>()

    override fun <S : TestRunEntity> save(entity: S): S {
        store[entity.id] = entity
        return entity
    }

    override fun <S : TestRunEntity> saveAll(entities: Iterable<S>): List<S> = entities.onEach { store[it.id] = it }.toList()

    override fun findById(id: String): Optional<TestRunEntity> = Optional.ofNullable(store[id])

    override fun existsById(id: String): Boolean = store.containsKey(id)

    override fun findAll(): List<TestRunEntity> = store.values.toList()

    override fun findAllById(ids: Iterable<String>): List<TestRunEntity> = ids.mapNotNull { store[it] }

    override fun count(): Long = store.size.toLong()

    override fun deleteById(id: String) {
        store.remove(id)
    }

    override fun delete(entity: TestRunEntity) {
        store.remove(entity.id)
    }

    override fun deleteAllById(ids: Iterable<String>) {
        ids.forEach { store.remove(it) }
    }

    override fun deleteAll(entities: Iterable<TestRunEntity>) {
        entities.forEach { store.remove(it.id) }
    }

    override fun deleteAll() {
        store.clear()
    }

    override fun findAll(pageable: org.springframework.data.domain.Pageable): org.springframework.data.domain.Page<TestRunEntity> =
        org.springframework.data.domain.Page
            .empty(pageable)

    override fun findAll(sort: org.springframework.data.domain.Sort): List<TestRunEntity> = store.values.toList()

    override fun findAllByOrderByCreatedAtDesc(): List<TestRunEntity> = store.values.sortedByDescending { it.createdAt }

    override fun findByOperationMethodAndOperationPathOrderByCreatedAtDesc(
        method: String,
        path: String,
    ): List<TestRunEntity> =
        store.values
            .filter { it.operationMethod == method && it.operationPath == path }
            .sortedByDescending { it.createdAt }

    override fun countByEndpoint(
        method: String,
        path: String,
    ): Long = store.values.count { it.operationMethod == method && it.operationPath == path }.toLong()
}

class InMemoryOperationStatisticsRepository : OperationStatisticsRepository {
    private val store = ConcurrentHashMap<OperationStatisticsEntity.Key, OperationStatisticsEntity>()

    override fun <S : OperationStatisticsEntity> save(entity: S): S {
        store[OperationStatisticsEntity.Key(entity.method, entity.path)] = entity
        return entity
    }

    override fun <S : OperationStatisticsEntity> saveAll(entities: Iterable<S>): List<S> = entities.onEach { save(it) }.toList()

    override fun findById(id: OperationStatisticsEntity.Key): Optional<OperationStatisticsEntity> = Optional.ofNullable(store[id])

    override fun existsById(id: OperationStatisticsEntity.Key): Boolean = store.containsKey(id)

    override fun findAll(): List<OperationStatisticsEntity> = store.values.toList()

    override fun findAllById(ids: Iterable<OperationStatisticsEntity.Key>): List<OperationStatisticsEntity> = ids.mapNotNull { store[it] }

    override fun count(): Long = store.size.toLong()

    override fun deleteById(id: OperationStatisticsEntity.Key) {
        store.remove(id)
    }

    override fun delete(entity: OperationStatisticsEntity) {
        store.remove(OperationStatisticsEntity.Key(entity.method, entity.path))
    }

    override fun deleteAllById(ids: Iterable<OperationStatisticsEntity.Key>) {
        ids.forEach { store.remove(it) }
    }

    override fun deleteAll(entities: Iterable<OperationStatisticsEntity>) {
        entities.forEach { delete(it) }
    }

    override fun deleteAll() {
        store.clear()
    }

    override fun findAll(pageable: org.springframework.data.domain.Pageable): org.springframework.data.domain.Page<OperationStatisticsEntity> =
        org.springframework.data.domain.Page
            .empty(pageable)

    override fun findAll(sort: org.springframework.data.domain.Sort): List<OperationStatisticsEntity> = store.values.toList()

    override fun findAllByOrderByTestCountDesc(): List<OperationStatisticsEntity> = store.values.sortedByDescending { it.testCount }
}

class InMemoryTimeSeriesRepository : TimeSeriesRepository {
    private val store = ConcurrentHashMap<Long, TimeSeriesEntity>()
    private val nextId =
        java.util.concurrent.atomic
            .AtomicLong(1)

    override fun <S : TimeSeriesEntity> save(entity: S): S {
        if (entity.id == null) entity.id = nextId.getAndIncrement()
        store[entity.id!!] = entity
        return entity
    }

    override fun <S : TimeSeriesEntity> saveAll(entities: Iterable<S>): List<S> = entities.onEach { save(it) }.toList()

    override fun findById(id: Long): Optional<TimeSeriesEntity> = Optional.ofNullable(store[id])

    override fun existsById(id: Long): Boolean = store.containsKey(id)

    override fun findAll(): List<TimeSeriesEntity> = store.values.toList()

    override fun findAllById(ids: Iterable<Long>): List<TimeSeriesEntity> = ids.mapNotNull { store[it] }

    override fun count(): Long = store.size.toLong()

    override fun deleteById(id: Long) {
        store.remove(id)
    }

    override fun delete(entity: TimeSeriesEntity) {
        entity.id?.let { store.remove(it) }
    }

    override fun deleteAllById(ids: Iterable<Long>) {
        ids.forEach { store.remove(it) }
    }

    override fun deleteAll(entities: Iterable<TimeSeriesEntity>) {
        entities.forEach { delete(it) }
    }

    override fun deleteAll() {
        store.clear()
    }

    override fun findAll(pageable: org.springframework.data.domain.Pageable): org.springframework.data.domain.Page<TimeSeriesEntity> =
        org.springframework.data.domain.Page
            .empty(pageable)

    override fun findAll(sort: org.springframework.data.domain.Sort): List<TimeSeriesEntity> = store.values.toList()

    override fun findByRunIdOrderByTimestampAsc(runId: String): List<TimeSeriesEntity> = store.values.filter { it.runId == runId }.sortedBy { it.timestamp }
}

class InMemoryDemoRequestLogRepository : DemoRequestLogRepository {
    private val store = ConcurrentHashMap<Long, DemoRequestLogEntity>()
    private val nextId =
        java.util.concurrent.atomic
            .AtomicLong(1)

    override fun <S : DemoRequestLogEntity> save(entity: S): S {
        if (entity.id == null) entity.id = nextId.getAndIncrement()
        store[entity.id!!] = entity
        return entity
    }

    override fun <S : DemoRequestLogEntity> saveAll(entities: Iterable<S>): List<S> = entities.onEach { save(it) }.toList()

    override fun findById(id: Long): Optional<DemoRequestLogEntity> = Optional.ofNullable(store[id])

    override fun existsById(id: Long): Boolean = store.containsKey(id)

    override fun findAll(): List<DemoRequestLogEntity> = store.values.toList()

    override fun findAllById(ids: Iterable<Long>): List<DemoRequestLogEntity> = ids.mapNotNull { store[it] }

    override fun count(): Long = store.size.toLong()

    override fun deleteById(id: Long) {
        store.remove(id)
    }

    override fun delete(entity: DemoRequestLogEntity) {
        entity.id?.let { store.remove(it) }
    }

    override fun deleteAllById(ids: Iterable<Long>) {
        ids.forEach { store.remove(it) }
    }

    override fun deleteAll(entities: Iterable<DemoRequestLogEntity>) {
        entities.forEach { delete(it) }
    }

    override fun deleteAll() {
        store.clear()
    }

    override fun findAll(pageable: org.springframework.data.domain.Pageable): org.springframework.data.domain.Page<DemoRequestLogEntity> =
        org.springframework.data.domain.Page
            .empty(pageable)

    override fun findAll(sort: org.springframework.data.domain.Sort): List<DemoRequestLogEntity> = store.values.toList()

    override fun findAllByOrderByTimestampDesc(pageable: Pageable): List<DemoRequestLogEntity> =
        store.values.sortedByDescending { it.timestamp }.let { all ->
            val size = pageable.pageSize.coerceAtMost(all.size)
            all.subList(0, size)
        }

    override fun findByRunIdOrderByTimestampDesc(
        runId: String,
        pageable: Pageable,
    ): List<DemoRequestLogEntity> =
        store.values
            .filter { it.runId == runId }
            .sortedByDescending { it.timestamp }
            .let { all ->
                val size = pageable.pageSize.coerceAtMost(all.size)
                all.subList(0, size)
            }
}

/**
 * No-op `TimeSeriesWriter` for tests that do not exercise the
 * ramp-chart data path. Backed by an in-memory repository so a
 * test that wants to inspect the seeded samples can read them back
 * via the same instance.
 */
class InMemoryTimeSeriesWriter(
    private val repository: TimeSeriesRepository = InMemoryTimeSeriesRepository(),
) : TimeSeriesWriter(repository)

/**
 * In-memory `StatusCodeTimeSeriesRepository` for tests that
 * exercise the status-code time-series path. Same shape as
 * [InMemoryTimeSeriesRepository] — a fixed-size backing store
 * keyed by the unique index on `(runId, epochSecond, code)` so
 * the upsert path in [StatusCodeTimeSeriesWriter] collapses
 * duplicate stamps onto the same row.
 */
class InMemoryStatusCodeTimeSeriesRepository : StatusCodeTimeSeriesRepository {
    private val store = ConcurrentHashMap<String, StatusCodeTimeSeriesEntity>()

    private fun keyOf(entity: StatusCodeTimeSeriesEntity): String = "${entity.runId}|${entity.epochSecond}|${entity.code}"

    override fun <S : StatusCodeTimeSeriesEntity> save(entity: S): S {
        store[keyOf(entity)] = entity
        return entity
    }

    override fun <S : StatusCodeTimeSeriesEntity> saveAll(entities: Iterable<S>): List<S> = entities.onEach { store[keyOf(it)] = it }.toList()

    override fun findById(id: Long): Optional<StatusCodeTimeSeriesEntity> = store.values.firstOrNull { it.id == id }.let { Optional.ofNullable(it) }

    override fun existsById(id: Long): Boolean = store.values.any { it.id == id }

    override fun findAll(): List<StatusCodeTimeSeriesEntity> = store.values.toList()

    override fun findAllById(ids: Iterable<Long>): List<StatusCodeTimeSeriesEntity> = store.values.filter { entity -> entity.id?.let { it in ids.toList() } == true }

    override fun count(): Long = store.size.toLong()

    override fun deleteById(id: Long) {
        val it = store.entries.firstOrNull { it.value.id == id } ?: return
        store.remove(it.key)
    }

    override fun delete(entity: StatusCodeTimeSeriesEntity) {
        val id = entity.id ?: return
        deleteById(id)
    }

    override fun deleteAll(entities: Iterable<StatusCodeTimeSeriesEntity>) {
        entities.forEach { delete(it) }
    }

    override fun deleteAll() {
        store.clear()
    }

    override fun deleteAllById(ids: Iterable<Long>) {
        ids.forEach { id -> deleteById(id) }
    }

    override fun findAll(pageable: Pageable): org.springframework.data.domain.Page<StatusCodeTimeSeriesEntity> =
        org.springframework.data.domain.Page
            .empty(pageable)

    override fun findAll(sort: org.springframework.data.domain.Sort): List<StatusCodeTimeSeriesEntity> = store.values.toList()

    override fun findByRunIdOrderByEpochSecondAscCodeAsc(runId: String): List<StatusCodeTimeSeriesEntity> =
        store.values
            .filter { it.runId == runId }
            .sortedWith(compareBy({ it.epochSecond }, { it.code }))
}

/**
 * In-memory `StatusCodeTimeSeriesWriter` — backs onto
 * [InMemoryStatusCodeTimeSeriesRepository] so tests can inspect
 * the deduped samples after a run. The upsert-by-(runId,
 * epochSecond, code) shape matches the H2 prod path so the
 * test wires up the same insert-vs-update trade-offs.
 */
class InMemoryStatusCodeTimeSeriesWriter(
    private val repository: StatusCodeTimeSeriesRepository = InMemoryStatusCodeTimeSeriesRepository(),
) : StatusCodeTimeSeriesWriter(repository) {
    /** Test-only: read every sample back so a test can assert on the writer's output. */
    fun readBack(runId: String): List<StatusCodeTimeSeriesEntity> = repository.findByRunIdOrderByEpochSecondAscCodeAsc(runId)
}
