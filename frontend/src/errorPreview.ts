const ERROR_PREVIEW_MAX_LENGTH = 140

export function firstErrorLine(error: string): string {
  const trimmed = error.trim()
  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (firstLine.length <= ERROR_PREVIEW_MAX_LENGTH) return firstLine
  return `${firstLine.slice(0, ERROR_PREVIEW_MAX_LENGTH - 1)}…`
}
