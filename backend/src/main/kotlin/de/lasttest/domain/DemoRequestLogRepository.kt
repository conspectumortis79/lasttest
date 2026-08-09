package de.lasttest.domain

import org.springframework.data.domain.Pageable
import org.springframework.data.repository.ListCrudRepository
import org.springframework.data.repository.ListPagingAndSortingRepository
import org.springframework.stereotype.Repository

/**
 * Spring Data repository for [DemoRequestLogEntity].
 *
 * The Demo-Traffic page requests the latest N entries; [findAllByOrderByTimestampDesc]
 * uses a `Pageable` to bound the result. The optional [findByRunIdOrderByTimestampDesc]
 * filter powers the `?demo-traffic=<runId>` overlay that restricts
 * the feed to a single load test.
 */
@Repository
interface DemoRequestLogRepository :
    ListCrudRepository<DemoRequestLogEntity, Long>,
    ListPagingAndSortingRepository<DemoRequestLogEntity, Long> {
    fun findAllByOrderByTimestampDesc(pageable: Pageable): List<DemoRequestLogEntity>

    fun findByRunIdOrderByTimestampDesc(runId: String, pageable: Pageable): List<DemoRequestLogEntity>
}
