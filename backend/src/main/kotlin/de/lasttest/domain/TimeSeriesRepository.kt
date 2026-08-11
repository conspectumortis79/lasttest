package de.lasttest.domain

import org.springframework.data.repository.ListCrudRepository
import org.springframework.data.repository.ListPagingAndSortingRepository
import org.springframework.stereotype.Repository

@Repository
interface TimeSeriesRepository :
    ListCrudRepository<TimeSeriesEntity, Long>,
    ListPagingAndSortingRepository<TimeSeriesEntity, Long> {
    fun findByRunIdOrderByTimestampAsc(runId: String): List<TimeSeriesEntity>
}
