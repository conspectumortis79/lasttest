package de.lasttest.demo

interface DemoRequestLog {
    fun record(entry: DemoRequestLogEntry)

    fun snapshot(
        runId: String?,
        limit: Int,
    ): List<DemoRequestLogEntry>

    fun clear()
}
