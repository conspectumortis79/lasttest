package de.lasttest.domain

import org.springframework.data.domain.Pageable
import org.springframework.data.repository.ListCrudRepository
import org.springframework.data.repository.ListPagingAndSortingRepository
import org.springframework.stereotype.Repository

@Repository
interface DemoRequestLogRepository :
    ListCrudRepository<DemoRequestLogEntity, Long>,
    ListPagingAndSortingRepository<DemoRequestLogEntity, Long> {
    fun findAllByOrderByTimestampDesc(pageable: Pageable): List<DemoRequestLogEntity>

    fun findByRunIdOrderByTimestampDesc(
        runId: String,
        pageable: Pageable,
    ): List<DemoRequestLogEntity>
}
