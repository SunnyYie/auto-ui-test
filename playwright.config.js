// @ts-check
import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

// 加载 .env.local 文件中的环境变量（包含 LLM 和 Zerostep 配置）
dotenv.config({ path: '.env.local' })

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* 并行运行测试文件 */
  fullyParallel: true,
  /* 在 CI 上失败，源代码中留下 test.only */
  forbidOnly: !!process.env.CI,
  /* 仅在 CI 上重试 */
  retries: process.env.CI ? 2 : 0,
  /* 在 CI 上禁用并行测试 */
  workers: process.env.CI ? 1 : undefined,
  /* AI 操作需要更长的超时时间 */
  timeout: 120_000,
  /* 使用的报告器。参考 https://playwright.dev/docs/test-reporters */
  reporter: 'list',
  /* 所有项目的共享设置。参考 https://playwright.dev/docs/api/class-testoptions */
  use: {
    /* 在 await page.goto('') 等操作中使用的基本 URL */
    // baseURL: 'http://localhost:3000',

    /* 重试失败的测试时收集跟踪信息。参考 https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* 配置主要浏览器的项目 */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* 针对移动设备的测试 */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* 针对品牌浏览器的测试 */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* 在开始测试之前运行本地开发服务器 */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
})
