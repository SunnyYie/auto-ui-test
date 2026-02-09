import { test } from '../../utils/fixture'

test('自动搜索', async ({ page, ai }) => {
  await page.goto('https://www.baidu.com')

  await page.locator('[id="chat-textarea"]').pressSequentially('ZeroStep', { delay: 150 }) // 模拟人类敲击键盘的延迟
  await page.waitForTimeout(Math.random() * 1000 + 500)
  await page.keyboard.press('Enter')

  await page.waitForLoadState('networkidle')

  await page.waitForSelector('#content_left', { state: 'visible', timeout: 30000 })

  const result = await ai('找到第一个搜索结果，并返回它的标题')

  console.log('搜索结果：', result)
})
