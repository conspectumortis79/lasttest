package de.lasttest.domain

import org.springframework.data.repository.ListCrudRepository
import org.springframework.data.repository.ListPagingAndSortingRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Repository

/**
 * Spring Data repository for [TestRunEntity].
 *
 * Extends [ListCrudRepository] + [ListPagingAndSortingRepository]
 * rather than `JpaRepository` directly so the test doubles do not
 * have to mock the entire `QueryByExampleExecutor` surface. The
 * service uses only the simple CRUD + sort-by-createdAt
 * operations; the dashboard can still sort and paginate runs.
 */
@Repository
interface TestRunRepository :
    ListCrudRepository<TestRunEntity, String>,
    ListPagingAndSortingRepository<TestRunEntity, String> {
    fun findAllByOrderByCreatedAtDesc(): List<TestRunEntity>

    fun findByOperationMethodAndOperationPathOrderByCreatedAtDesc(
        operationMethod: String,
        operationPath: String,
    ): List<TestRunEntity>

    @Query(
        "SELECT COUNT(t) FROM TestRunEntity t " +
            "WHERE t.operationMethod = :method AND t.operationPath = :path",
    )
    fun countByEndpoint(
        @Param("method") method: String,
        @Param("path") path: String,
    ): Long
}
