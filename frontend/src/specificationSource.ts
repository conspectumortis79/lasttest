export type FetchedSpecification = {
  content: string
  resolvedUrl: string
  source: 'direct' | 'swagger-ui'
}

export type SpecificationSourceError = { message: string }

export function validateSpecificationUrl(url: string): string | undefined {
  const trimmed = url.trim()
  if (trimmed === '') return undefined
  if (trimmed.length > 2048) return 'Die URL ist zu lang (maximal 2048 Zeichen).'
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'Die URL ist ungültig.'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Die URL muss mit http:// oder https:// beginnen.'
  }
  if (parsed.username || parsed.password) {
    return 'Die URL darf keine Zugangsdaten enthalten.'
  }
  return undefined
}

export function looksLikeUrl(text: string): boolean {
  if (text.trim() === '') return false
  return validateSpecificationUrl(text) === undefined
}
