package de.lasttest.domain

import org.springframework.data.repository.ListCrudRepository
import org.springframework.data.repository.ListPagingAndSortingRepository
import org.springframework.stereotype.Repository

/**
 * Spring Data repository for [OperationStatisticsEntity].
 *
 * The dashboard calls [findAllByOrderByTestCountDesc] to render the
 * "× N" badge strip on the left list. The composite primary key
 * `(method, path)` lets [existsById] be used as a cheap check whether
 * a counter row already exists, so the service can decide between
 * "insert" and "update" without an extra `SELECT`.
 *
 * Extends the list-based Spring Data interfaces rather than
 * `JpaRepository` to keep the test doubles small.
 */
@Repository
interface OperationStatisticsRepository :
    ListCrudRepository<OperationStatisticsEntity, OperationStatisticsEntity.Key>,
    ListPagingAndSortingRepository<OperationStatisticsEntity, OperationStatisticsEntity.Key> {
    fun findAllByOrderByTestCountDesc(): List<OperationStatisticsEntity>
}
