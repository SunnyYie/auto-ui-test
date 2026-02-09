/**
 * ============================================================
 * 模块名称: 工作流引擎 (Workflow Engine)
 * ============================================================
 *
 * 功能描述:
 *   工作流引擎是整个系统的入口和编排器。
 *   它串联了三个核心层：
 *   1. 解析与规划层 (LLM Planner) - 将自然语言转化为指令流
 *   2. 适配层 (Adapter) - 将指令转化为浏览器操作
 *   3. 执行层 (Runtime) - 实际操作浏览器（Playwright + Zerostep）
 *
 * 核心函数:
 *   - runWorkflow(prompt, context, options): 端到端执行工作流
 *
 * 使用示例:
 *   在 Playwright 测试中:
 *   test('自动化测试', async ({ page, ai }) => {
 *     const result = await runWorkflow('在百度搜索 Playwright', { page, ai })
 *   })
 * ============================================================
 */

import { parseIntent } from './llm-client.js'
import { executeInstructionStream } from './adapter.js'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * 指令缓存目录
 * 将 LLM 解析的指令流缓存到本地文件，避免重复调用 LLM（节省 ~5s）
 */
const CACHE_DIR = resolve(process.cwd(), '.cache')

/**
 * 根据 prompt 生成缓存文件路径
 *
 * @param {string} prompt - 用户输入的自然语言
 * @returns {string} 缓存文件的完整路径
 */
function getCachePath(prompt) {
  const hash = createHash('md5').update(prompt).digest('hex').slice(0, 12)
  return resolve(CACHE_DIR, `instructions_${hash}.json`)
}

/**
 * 从 prompt 中提取第一个 navigate URL
 * 用于在 LLM 解析的同时并行启动页面导航，节省等待时间
 *
 * @param {string} prompt - 用户输入
 * @returns {string|null} 提取到的 URL
 */
function extractUrlFromPrompt(prompt) {
  const match = prompt.match(/https?:\/\/[^\s),，)]+/)
  return match ? match[0] : null
}

/**
 * 执行端到端工作流
 *
 * 完整流程:
 * 1. 调用 LLM 解析用户意图 -> 得到统一指令流 JSON
 * 2. 将指令流交给适配器 -> 逐步执行浏览器操作
 * 3. 汇总执行结果并返回
 *
 * @param {string} prompt - 用户的自然语言指令
 * @param {object} context - 执行上下文
 * @param {import('@playwright/test').Page} context.page - Playwright Page 实例
 * @param {Function} context.ai - Zerostep ai() 函数
 * @param {object} [options] - 工作流选项
 * @param {boolean} [options.stopOnError=true] - 步骤失败时是否停止
 * @param {number} [options.stepDelay=500] - 步骤间延迟（毫秒）
 * @returns {Promise<{
 *   instructions: object[],
 *   results: object[],
 *   summary: { total: number, success: number, fail: number, allPassed: boolean }
 * }>}
 *
 * 使用示例:
 *   const result = await runWorkflow(
 *     '打开百度, 搜索 Playwright, 验证搜索结果中包含 Playwright',
 *     { page, ai },
 *     { stopOnError: false, stepDelay: 1000 }
 *   )
 */
export async function runWorkflow(prompt, context, options = {}) {
  const { useCache = true } = options
  const startTime = Date.now()

  console.log('\n' + '═'.repeat(60))
  console.log('🤖 [Workflow] AI 自动化工作流启动')
  console.log('═'.repeat(60))
  console.log(`📝 任务: ${prompt}`)
  console.log('═'.repeat(60))

  try {
    let instructions
    const cachePath = getCachePath(prompt)

    // =============================================
    // 第一步：获取指令流（缓存优先 / LLM 解析）
    // =============================================

    // 尝试从缓存读取指令流（节省 ~5s LLM 调用时间）
    if (useCache && existsSync(cachePath)) {
      instructions = JSON.parse(readFileSync(cachePath, 'utf-8'))
      console.log(`\n⚡ [Workflow] 从缓存加载指令流 (${instructions.length} 步)`)

      // 缓存模式下也要做预导航：直接导航到第一个 navigate 步骤的 URL
      if (instructions[0]?.action_type === 'navigate' && context.page) {
        const url = instructions[0].params?.url
        if (url) {
          console.log(`\n🚀 [Workflow] 预导航: ${url}`)
          await context.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
          instructions[0]._preNavigated = true
        }
      }
    } else {
      // 优化: LLM 解析与页面导航并行执行
      // 如果 prompt 中包含 URL，在等待 LLM 解析的同时先导航到目标页面
      const url = extractUrlFromPrompt(prompt)
      if (url && context.page) {
        console.log(`\n🚀 [Workflow] 并行模式: LLM 解析 + 页面预导航 (${url})`)
        const [parsedInstructions] = await Promise.all([
          parseIntent(prompt),
          context.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
        ])
        instructions = parsedInstructions

        // 标记第一个 navigate 步骤为已完成（跳过执行）
        if (instructions[0]?.action_type === 'navigate') {
          instructions[0]._preNavigated = true
        }
      } else {
        instructions = await parseIntent(prompt)
      }

      // 缓存指令流到本地文件
      if (useCache) {
        mkdirSync(CACHE_DIR, { recursive: true })
        writeFileSync(cachePath, JSON.stringify(instructions, null, 2))
        console.log(`\n💾 [Workflow] 指令流已缓存到 ${cachePath}`)
      }
    }

    // 打印解析出的指令流，方便调试
    console.log('\n📋 [Workflow] 解析出的指令流:')
    for (const inst of instructions) {
      console.log(`  ${inst.step_id}. [${inst.action_type}] ${inst.description}`)
    }

    // =============================================
    // 第二步：适配器执行指令流
    // =============================================
    const { results, summary } = await executeInstructionStream(instructions, context, options)

    const totalElapsed = Date.now() - startTime

    // =============================================
    // 第三步：汇总结果
    // =============================================
    console.log('\n' + '═'.repeat(60))
    if (summary.allPassed) {
      console.log(`🎉 [Workflow] 工作流执行成功！共 ${summary.total} 步，耗时 ${totalElapsed}ms`)
    } else {
      console.log(`⚠️ [Workflow] 工作流部分失败: 成功 ${summary.success}/${summary.total}，耗时 ${totalElapsed}ms`)
    }
    console.log('═'.repeat(60) + '\n')

    return {
      instructions,
      results,
      summary: {
        ...summary,
        totalElapsed,
      },
    }
  } catch (error) {
    const totalElapsed = Date.now() - startTime
    console.error('\n' + '═'.repeat(60))
    console.error(`💥 [Workflow] 工作流执行异常: ${error.message}`)
    console.error(`⏱️ 耗时: ${totalElapsed}ms`)
    console.error('═'.repeat(60) + '\n')

    throw error
  }
}
