package de.lasttest.domain

import org.springframework.data.repository.ListCrudRepository
import org.springframework.data.repository.ListPagingAndSortingRepository
import org.springframework.stereotype.Repository

/**
 * Spring Data repository for [StatusCodeTimeSeriesEntity].
 *
 * The dashboard fetches the status-code timeline for a single run
 * in one query, so the only custom method exposed is the
 * `(run_id, epoch_second, code)`-sorted read. The compound
 * index declared on the entity makes the query an index range
 * scan + secondary sort.
 *
 * The upsert path is handled by the writer, not the repository
 * (see [StatusCodeTimeSeriesWriter]) — same shape as the existing
 * time-series writer where the live reader upserts on
 * `(run_id, timestamp)` so the planned-only seed row and the
 * live-actualised row collapse onto the same PK.
 */
@Repository
interface StatusCodeTimeSeriesRepository :
    ListCrudRepository<StatusCodeTimeSeriesEntity, Long>,
    ListPagingAndSortingRepository<StatusCodeTimeSeriesEntity, Long> {
    fun findByRunIdOrderByEpochSecondAscCodeAsc(runId: String): List<StatusCodeTimeSeriesEntity>
}
