import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { request } from '@playwright/test'
import { storageStatePath } from './storageState.ts'

export { storageStatePath }

const STORAGE_KEY = 'lasttest.language'

const DEMO_STATUS_KEY = 'lasttest.demo.enabled'

export default async function globalSetup(): Promise<void> {
  mkdirSync(dirname(storageStatePath), { recursive: true })

  const storageState = {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:5173',
        localStorage: [
          { name: STORAGE_KEY, value: 'en' },
          { name: DEMO_STATUS_KEY, value: 'true' },
        ],
      },
    ],
  }
  writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2))

  const api = await request.newContext({ baseURL: 'http://localhost:8286' })
  try {
    await api.delete('/api/test-runs')
    await api.post('/api/demo-traffic/enabled', { data: { enabled: true } })
  } catch {
  } finally {
    await api.dispose()
  }
}
