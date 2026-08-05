const DEFAULT_RETRY_DELAY_MS = 500
const DEFAULT_MAX_ATTEMPTS = 10

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { maxAttempts?: number; delayMs?: number; shouldRetry?: (response: Response) => boolean } = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const delayMs = options.delayMs ?? DEFAULT_RETRY_DELAY_MS
  const shouldRetry = options.shouldRetry ?? ((response: Response) => !response.ok)
  let lastError: unknown
  let lastResponse: Response | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(input, init)
      if (response.ok || !shouldRetry(response)) return response
      lastResponse = response
    } catch (error) {
      lastError = error
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => globalThis.setTimeout(resolve, delayMs))
    }
  }
  if (lastResponse) return lastResponse
  throw lastError instanceof Error ? lastError : new Error('fetchWithRetry failed without a response')
}
