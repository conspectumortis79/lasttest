export const MAX_VIRTUAL_USERS = 1000
export const MAX_DURATION_SECONDS = 3600

export function validateLoadProfile(virtualUsers: number, durationSeconds: number): string | undefined {
  if (!Number.isInteger(virtualUsers) || virtualUsers < 1 || virtualUsers > MAX_VIRTUAL_USERS) {
    return `Virtual Users müssen zwischen 1 und ${MAX_VIRTUAL_USERS} liegen.`
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > MAX_DURATION_SECONDS) {
    return `Die Dauer muss zwischen 1 und ${MAX_DURATION_SECONDS} Sekunden liegen.`
  }
  return undefined
}
