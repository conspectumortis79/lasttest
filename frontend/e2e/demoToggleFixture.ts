import { test as base, type APIRequestContext, type BrowserContext } from '@playwright/test'

export async function ensureDemoApiEnabled(request: APIRequestContext): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await request.post('/api/demo-traffic/enabled', { data: { enabled: true } })
    const status = await request.get('/api/demo-traffic/status').then(r => r.json())
    if (status.enabled) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Demo API did not report enabled=true after 5 attempts')
}

export const test = base.extend<{ demoApiEnabled: true }>({
  demoApiEnabled: [
    async ({ request }, use) => {
      await ensureDemoApiEnabled(request)
      await use(true)
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
export type { BrowserContext, APIRequestContext }
