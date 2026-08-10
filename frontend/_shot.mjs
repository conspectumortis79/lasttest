import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
await page.goto('file:///tmp/lasttest-login-mockups.html')
await page.waitForLoadState('networkidle')
await page.screenshot({ path: '/tmp/lasttest-login-mockups.png', fullPage: true })
await browser.close()
console.log('saved')
