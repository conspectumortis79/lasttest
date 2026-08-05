package de.lasttest.api

/**
 * Time-Series-Antwort für die Ramp-Grafik im Report. Wird vom
 * `GET /api/test-runs/{id}/time-series`-Endpoint geliefert und
 * enthält die echten Ist-Werte aus InfluxDB, die der SVG-Renderer
 * zusätzlich zur Soll-Linie aus den Stages zeichnet.
 *
 * `vus` und `requestsPerSecond` sind getrennte Arrays, damit der
 * Renderer sie unabhängig voneinander ein- und ausblenden kann.
 * `empty arrays` sind erlaubt und bedeuten „InfluxDB nicht
 * erreichbar oder noch keine Daten" — die UI behandelt das
 * transparent, indem sie nur die Soll-Linie zeigt.
 */
data class TimeSeriesResponse(
    val runId: String,
    val resolutionSeconds: Int,
    val vus: List<TimeSeriesPoint>,
    val requestsPerSecond: List<TimeSeriesPoint>,
)

data class TimeSeriesPoint(
    /** ISO-8601-Zeitstempel (z. B. "2026-08-04T16:51:22Z"). */
    val time: String,
    /** Messwert zum Zeitpunkt (VUs als Ganzzahl, RPS als Fließkomma). */
    val value: Number,
)
