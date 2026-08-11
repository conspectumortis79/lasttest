package de.lasttest.domain

import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Service

@Service
@Primary
class H2TimeSeriesReader(
    private val repository: TimeSeriesRepository,
) : TimeSeriesReader {
    override fun readVusOverTime(
        runId: String,
        startedAt: String,
        finishedAt: String,
    ): List<TimeSeriesPoint> =
        repository.findByRunIdOrderByTimestampAsc(runId).map { sample ->
            TimeSeriesPoint(
                time =
                    java.time.Instant
                        .ofEpochSecond(sample.timestamp)
                        .toString(),
                value = sample.actualVus,
            )
        }

    override fun readRequestsPerSecond(
        runId: String,
        startedAt: String,
        finishedAt: String,
    ): List<TimeSeriesPoint> =
        repository.findByRunIdOrderByTimestampAsc(runId).map { sample ->
            TimeSeriesPoint(
                time =
                    java.time.Instant
                        .ofEpochSecond(sample.timestamp)
                        .toString(),
                value = sample.actualRps,
            )
        }
}

@Service
class TimeSeriesWriter(
    private val repository: TimeSeriesRepository,
) {
    fun record(
        runId: String,
        timestampSeconds: Long,
        plannedVus: Double,
        actualVus: Double,
        actualRps: Double,
    ) {
        val existing =
            repository
                .findByRunIdOrderByTimestampAsc(runId)
                .firstOrNull { it.timestamp == timestampSeconds }
        val sample =
            existing ?: TimeSeriesEntity().apply {
                this.runId = runId
                this.timestamp = timestampSeconds
            }
        sample.plannedVus = plannedVus
        sample.actualVus = actualVus
        sample.actualRps = actualRps
        repository.save(sample)
    }
}
