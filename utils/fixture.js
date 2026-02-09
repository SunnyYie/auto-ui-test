import { test as base } from '@playwright/test'
import { chromium } from 'playwright-extra'
import stealthPlugin from 'puppeteer-extra-plugin-stealth'
import { aiFixture } from '@zerostep/playwright'

chromium.use(stealthPlugin())

export const test = base.extend({
  ...aiFixture(base),

  page: async ({ baseURL }, use) => {
    // 启动带指纹掩护的浏览器
    const browser = await chromium.launch({ headless: false })
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    })
    const page = await context.newPage()
    await use(page)
    await browser.close()
  },
})
