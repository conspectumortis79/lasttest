package de.lasttest.domain

import de.lasttest.api.FetchedSpecification
import org.springframework.stereotype.Service
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

class RemoteSpecificationFetchException(
    val problems: List<String>,
) : IllegalArgumentException(problems.joinToString("; "))

interface RemoteSpecificationClient {
    fun get(url: String): RemoteSpecificationResponse
}

data class RemoteSpecificationResponse(
    val statusCode: Int,
    val contentType: String?,
    val body: String,
    val finalUrl: String,
)

interface RemoteSpecificationFetcher {
    fun fetch(url: String): FetchedSpecification
}

@Service
class HttpRemoteSpecificationFetcher(
    private val client: RemoteSpecificationClient,
) : RemoteSpecificationFetcher {
    override fun fetch(url: String): FetchedSpecification {
        val normalizedUrl = validateUrl(url)
        val response = client.get(normalizedUrl)
        if (response.statusCode !in 200..299) {
            throw RemoteSpecificationFetchException(
                listOf("Die URL ${response.finalUrl} antwortet mit HTTP ${response.statusCode}."),
            )
        }
        val contentType = response.contentType.orEmpty().lowercase()
        return when {
            isHtmlContentType(contentType) -> resolveSwaggerUiSpecification(response)
            isJsonContentType(contentType) || isYamlContentType(contentType) ->
                FetchedSpecification(
                    content = response.body,
                    resolvedUrl = response.finalUrl,
                    source = FETCH_SOURCE_DIRECT,
                )
            else -> detectByContent(response)
        }
    }

    private fun resolveSwaggerUiSpecification(initialResponse: RemoteSpecificationResponse): FetchedSpecification {
        val specUrl =
            extractSpecUrlFromHtml(initialResponse.body, initialResponse.finalUrl)
                ?: throw RemoteSpecificationFetchException(
                    listOf(
                        "Die Seite ${initialResponse.finalUrl} sieht wie eine Swagger UI aus, " +
                            "enthält aber keine erkennbare OpenAPI-/Swagger-Spezifikations-URL. " +
                            "Bitte gib die URL zur Spezifikations-Datei direkt an " +
                            "(z. B. /v3/api-docs, /swagger.json, /openapi.json).",
                    ),
                )
        val resolvedSpecUrl = resolveAgainst(specUrl, initialResponse.finalUrl)
        if (!isSameOrigin(resolvedSpecUrl, initialResponse.finalUrl)) {
            throw RemoteSpecificationFetchException(
                listOf(
                    "Die Swagger UI verweist auf eine andere Domain ($resolvedSpecUrl). " +
                        "Aus Sicherheitsgründen sind nur URLs auf der gleichen Domain erlaubt.",
                ),
            )
        }
        val specResponse = client.get(resolvedSpecUrl)
        if (specResponse.statusCode !in 200..299) {
            throw RemoteSpecificationFetchException(
                listOf("Die Spezifikations-URL $resolvedSpecUrl antwortet mit HTTP ${specResponse.statusCode}."),
            )
        }
        if (specResponse.body.isBlank()) {
            throw RemoteSpecificationFetchException(
                listOf("Die Spezifikations-URL $resolvedSpecUrl liefert eine leere Antwort."),
            )
        }
        return FetchedSpecification(
            content = specResponse.body,
            resolvedUrl = specResponse.finalUrl,
            source = FETCH_SOURCE_SWAGGER_UI,
        )
    }

    private fun detectByContent(response: RemoteSpecificationResponse): FetchedSpecification {
        val body = response.body
        val trimmed = body.trimStart()
        return when {
            trimmed.startsWith("{") || trimmed.startsWith("[") ->
                FetchedSpecification(
                    content = body,
                    resolvedUrl = response.finalUrl,
                    source = FETCH_SOURCE_DIRECT,
                )
            trimmed.startsWith("openapi:") || trimmed.startsWith("swagger:") ->
                FetchedSpecification(
                    content = body,
                    resolvedUrl = response.finalUrl,
                    source = FETCH_SOURCE_DIRECT,
                )
            trimmed.contains("\nopenapi:") || trimmed.contains("\nswagger:") ->
                FetchedSpecification(
                    content = body,
                    resolvedUrl = response.finalUrl,
                    source = FETCH_SOURCE_DIRECT,
                )
            else -> throw RemoteSpecificationFetchException(
                listOf(
                    "Die URL ${response.finalUrl} liefert einen unerwarteten Inhaltstyp " +
                        "(${response.contentType ?: "unbekannt"}). " +
                        "Erwartet wird JSON, YAML oder eine Swagger-UI-Seite.",
                ),
            )
        }
    }

    internal fun validateUrl(url: String): String {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) {
            throw RemoteSpecificationFetchException(listOf("Es wurde keine URL angegeben."))
        }
        if (trimmed.length > MAX_URL_LENGTH) {
            throw RemoteSpecificationFetchException(listOf("Die URL ist zu lang (maximal $MAX_URL_LENGTH Zeichen)."))
        }
        val parsed =
            runCatching { URI(trimmed) }.getOrNull()
                ?: throw RemoteSpecificationFetchException(listOf("Die URL ist ungültig: $trimmed"))
        val scheme = parsed.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") {
            throw RemoteSpecificationFetchException(
                listOf("Die URL muss mit http:// oder https:// beginnen (gefunden: ${parsed.scheme ?: "ohne Schema"})."),
            )
        }
        val host =
            parsed.host
                ?: throw RemoteSpecificationFetchException(listOf("Die URL enthält keinen Host: $trimmed"))
        if (parsed.userInfo != null) {
            throw RemoteSpecificationFetchException(listOf("Die URL darf keine Zugangsdaten enthalten."))
        }
        return trimmed
    }

    internal fun extractSpecUrlFromHtml(
        html: String,
        pageUrl: String,
    ): String? {
        parseSwaggerUiConfig(html)?.let { return it }
        return guessCommonSpecificationEndpoint(pageUrl)
    }

    private fun parseSwaggerUiConfig(html: String): String? {
        val bundleStart = html.indexOf(SWAGGER_UI_BUNDLE_MARKER)
        if (bundleStart < 0) {
            return null
        }
        val searchWindow = html.substring(bundleStart, minOf(html.length, bundleStart + MAX_CONFIG_WINDOW))
        val urlsBlock = matchUrlsArray(searchWindow)
        if (urlsBlock != null) {
            val firstUrl = matchFirstUrl(urlsBlock)
            if (firstUrl != null) return firstUrl
        }
        return matchSingleUrl(searchWindow)
    }

    private fun matchUrlsArray(text: String): String? = URLS_ARRAY_PATTERN.find(text)?.groupValues?.get(1)

    private fun matchFirstUrl(text: String): String? = firstPlausibleUrlIn(text)

    private fun matchSingleUrl(text: String): String? = firstPlausibleUrlIn(text)

    private fun firstPlausibleUrlIn(text: String): String? {
        val match = URL_PATTERN.find(text) ?: return null
        val url = match.groupValues[1]
        return if (isPlausibleSpecUrl(url)) url else null
    }

    internal fun isPlausibleSpecUrl(value: String): Boolean {
        if (value.isBlank()) return false
        if (value.startsWith("//")) return false
        return value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")
    }

    private fun guessCommonSpecificationEndpoint(pageUrl: String): String? {
        val base = baseUrlOf(pageUrl) ?: return null
        val path = URI.create(pageUrl).path
        val pathWithoutPage = path.substringBeforeLast('/')
        val hashedPage = pathWithoutPage.takeIf { it.isNotEmpty() }.orEmpty()
        for (suffix in CANDIDATE_SUFFIXES) {
            val candidate = base + hashedPage + suffix
            if (candidateExists(candidate)) return candidate
        }
        return null
    }

    private fun candidateExists(url: String): Boolean {
        val response = runCatching { client.get(url) }.getOrNull() ?: return false
        if (response.statusCode !in 200..299) return false
        return !response.body.isBlank()
    }

    internal fun resolveAgainst(
        value: String,
        against: String,
    ): String {
        if (value.startsWith("http://") || value.startsWith("https://")) return value
        val base = baseUrlOf(against) ?: return value
        val cleaned = value.trimStart('/')
        return base + "/" + cleaned
    }

    internal fun baseUrlOf(url: String): String? {
        val parsed = runCatching { URI(url) }.getOrNull() ?: return null
        val scheme = parsed.scheme ?: return null
        val host = parsed.host ?: return null
        val port = parsed.port
        val defaultPort = (scheme == "http" && port == 80) || (scheme == "https" && port == 443)
        return if (port == -1 || defaultPort) "$scheme://$host" else "$scheme://$host:$port"
    }

    internal fun isSameOrigin(
        left: String,
        right: String,
    ): Boolean {
        val leftBase = baseUrlOf(left) ?: return false
        val rightBase = baseUrlOf(right) ?: return false
        return leftBase.equals(rightBase, ignoreCase = true)
    }

    internal fun isHtmlContentType(contentType: String): Boolean = contentType.contains("text/html") || contentType.contains("application/xhtml")

    internal fun isJsonContentType(contentType: String): Boolean = contentType.contains("application/json") || contentType.contains("text/json") || contentType.contains("+json")

    internal fun isYamlContentType(contentType: String): Boolean =
        contentType.contains("application/yaml") ||
            contentType.contains("application/x-yaml") ||
            contentType.contains("text/yaml") ||
            contentType.contains("text/x-yaml") ||
            contentType.contains("+yaml")

    internal companion object {
        const val MAX_URL_LENGTH = 2048
        const val MAX_CONFIG_WINDOW = 32_000
        const val SWAGGER_UI_BUNDLE_MARKER = "SwaggerUIBundle"
        const val FETCH_SOURCE_DIRECT = "direct"
        const val FETCH_SOURCE_SWAGGER_UI = "swagger-ui"
        val URLS_ARRAY_PATTERN = Regex("""urls\s*:\s*\[([^\]]*)\]""", RegexOption.DOT_MATCHES_ALL)
        val URL_PATTERN = Regex("""url\s*:\s*["']([^"']+)["']""")
        val CANDIDATE_SUFFIXES =
            listOf(
                "/v3/api-docs",
                "/v3/api-docs.yaml",
                "/v2/api-docs",
                "/swagger.json",
                "/swagger.yaml",
                "/openapi.json",
                "/openapi.yaml",
            )
    }
}

@Service
class JdkRemoteSpecificationClient(
    private val delegate: HttpClient = defaultClient(),
) : RemoteSpecificationClient {
    override fun get(url: String): RemoteSpecificationResponse {
        val request =
            HttpRequest
                .newBuilder()
                .uri(URI(url))
                .timeout(REQUEST_TIMEOUT)
                .header("Accept", ACCEPT_HEADER)
                .header("User-Agent", USER_AGENT)
                .GET()
                .build()
        val response = delegate.send(request, HttpResponse.BodyHandlers.ofByteArray())
        val body = response.body().toString(Charsets.UTF_8)
        if (body.length > MAX_RESPONSE_BYTES) {
            throw RemoteSpecificationFetchException(
                listOf("Die URL $url liefert eine zu große Antwort (über $MAX_RESPONSE_BYTES Zeichen)."),
            )
        }
        return RemoteSpecificationResponse(
            statusCode = response.statusCode(),
            contentType = response.headers().firstValue("Content-Type").orElse(null),
            body = body,
            finalUrl = response.uri().toString(),
        )
    }

    private companion object {
        val REQUEST_TIMEOUT = Duration.ofSeconds(10)
        const val MAX_RESPONSE_BYTES = 5L * 1024 * 1024
        const val USER_AGENT = "lasttest-specification-fetcher/1.0"
        const val ACCEPT_HEADER =
            "application/json, application/yaml, application/x-yaml, text/yaml, text/html;q=0.9, */*;q=0.5"
    }
}

private fun defaultClient(): HttpClient =
    HttpClient
        .newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build()
