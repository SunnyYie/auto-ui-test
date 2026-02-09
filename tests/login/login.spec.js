/**
 * ============================================================
 * 测试文件: 登录功能全流程测试
 * ============================================================
 *
 * 功能描述:
 *   通过 MVP 工作流引擎，端到端验证登录场景：
 *   1. LLM 将自然语言登录描述解析为指令流
 *   2. 适配器使用 Playwright 优先 + AI 兜底混合策略执行
 *   3. 验证登录成功后的页面内容
 *
 * 覆盖场景:
 *   - navigate: 打开登录页面
 *   - input: 输入用户名和密码
 *   - click: 点击登录按钮
 *   - wait: 等待登录后主页面加载
 *   - verify: 验证登录成功
 *
 * 凭据来源:
 *   .env.local 文件中的 LOGIN_URL / LOGIN_USERNAME / LOGIN_PASSWORD
 * ============================================================
 */

import { test } from '../../utils/fixture.js'
import { expect } from '@playwright/test'
import { runWorkflow } from '../../api/workflow.js'
import dotenv from 'dotenv'

// 加载环境变量
dotenv.config({ path: '.env.local' })

const LOGIN_URL = process.env.LOGIN_URL
const LOGIN_USERNAME = process.env.LOGIN_USERNAME
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD

/**
 * 测试用例: 登录全流程 - AI 驱动
 *
 * 完整工作流:
 * 用户自然语言 -> LLM 解析指令流 -> 适配器执行 -> 验证登录成功
 */
test('登录测试: AI 工作流驱动', async ({ page, ai }) => {
  // 登录涉及网络请求和页面跳转，设置较长超时
  test.setTimeout(180_000)

  // 构造自然语言 prompt，包含具体的 URL、凭据和验证条件
  const prompt = `打开 ${LOGIN_URL}，在 type="text" 的输入框输入 ${LOGIN_USERNAME}，在 type="password" 的输入框输入 ${LOGIN_PASSWORD}，点击登录按钮，等待 main 标签元素出现，验证页面包含 "SigmaAI 智能编辑控制台"`

  const result = await runWorkflow(prompt, { page, ai }, { stopOnError: true, stepDelay: 0 })

  // 打印执行结果
  console.log('\n📊 工作流执行结果:', JSON.stringify(result.summary, null, 2))

  if (!result.summary.allPassed) {
    console.log('\n❌ 失败的步骤:')
    result.results
      .filter(r => !r.success)
      .forEach(r => console.log(`  - 步骤 ${r.step_id}: ${r.description} -> ${r.error}`))
  }

  // 断言: 所有步骤必须通过
  expect(result.summary.allPassed).toBe(true)
})
