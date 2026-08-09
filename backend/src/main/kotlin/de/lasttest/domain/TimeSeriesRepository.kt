package de.lasttest.domain

import org.springframework.data.repository.ListCrudRepository
import org.springframework.data.repository.ListPagingAndSortingRepository
import org.springframework.stereotype.Repository

/**
 * Spring Data repository for [TimeSeriesEntity].
 *
 * The ramp chart fetches all samples for a single run, so the only
 * custom query we need is "all samples for run X, oldest first".
 * The compound index on `(run_id, timestamp)` declared on the entity
 * makes the resulting query an index range scan.
 */
@Repository
interface TimeSeriesRepository :
    ListCrudRepository<TimeSeriesEntity, Long>,
    ListPagingAndSortingRepository<TimeSeriesEntity, Long> {
    fun findByRunIdOrderByTimestampAsc(runId: String): List<TimeSeriesEntity>
}
