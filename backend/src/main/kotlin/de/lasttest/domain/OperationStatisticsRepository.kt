package de.lasttest.domain

import org.springframework.data.repository.ListCrudRepository
import org.springframework.data.repository.ListPagingAndSortingRepository
import org.springframework.stereotype.Repository

@Repository
interface OperationStatisticsRepository :
    ListCrudRepository<OperationStatisticsEntity, OperationStatisticsEntity.Key>,
    ListPagingAndSortingRepository<OperationStatisticsEntity, OperationStatisticsEntity.Key> {
    fun findAllByOrderByTestCountDesc(): List<OperationStatisticsEntity>
}
