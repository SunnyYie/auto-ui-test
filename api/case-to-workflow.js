/**
 * ============================================================
 * 模块名称: 用例→指令流转换器 (Case to Workflow Converter)
 * ============================================================
 *
 * 功能描述:
 *   将结构化测试用例转换为 Unified Instruction Stream JSON，
 *   然后可以直接交给现有的 adapter.js + workflow.js 执行。
 *
 * 核心函数:
 *   - caseToInstructions(testCase, context): 单个用例→指令流
 *   - casesToWorkflowPrompts(cases, context): 批量转换
 *   - runTestCase(testCase, context, options): 执行单个用例
 *   - runTestSuite(cases, context, options): 执行整个用例集
 *
 * 设计理念:
 *   复用现有的 LLM 解析能力，将用例的 steps 描述转换为自然语言 prompt，
 *   交给 runWorkflow 执行，最大化复用已有基础设施。
 * ============================================================
 */

import dotenv from 'dotenv'
import { runWorkflow } from './workflow.js'

dotenv.config({ path: '.env.local' })

/**
 * 将单个测试用例转换为 runWorkflow 可执行的 prompt
 *
 * @param {object} testCase - 结构化测试用例
 * @param {object} [context] - 上下文
 * @param {string} [context.pageUrl] - 目标页面 URL
 * @returns {string} 自然语言 prompt
 */
export function caseToPrompt(testCase, context = {}) {
  const parts = []

  // 如果有 URL，添加导航步骤
  if (context.pageUrl) {
    parts.push(`打开 ${context.pageUrl}`)
  }

  // 将 steps 转换为自然语言描述
  for (const step of testCase.steps || []) {
    const desc = stepToDescription(step)
    if (desc) parts.push(desc)
  }

  // 添加最终验证
  if (testCase.expectedResult) {
    parts.push(`验证 "${testCase.expectedResult}"`)
  }

  return parts.join('，')
}

/**
 * 将单个步骤转换为自然语言描述
 */
function stepToDescription(step) {
  const { action, target, value, expected } = step

  switch (action) {
    case 'navigate':
      return `打开 ${target || value}`

    case 'click':
      return `点击${target}`

    case 'input':
      return `在${target}中输入 ${value}`

    case 'verify':
      return `验证${expected || target}`

    case 'wait':
      return `等待${target || '页面加载完成'}`

    case 'press':
      return `按下 ${value || target} 键`

    case 'hover':
      return `将鼠标悬停在${target}上`

    case 'scroll':
      return `滚动到${target || '页面底部'}`

    case 'select':
      return `在${target}中选择 ${value}`

    default:
      return target ? `${action}: ${target}` : null
  }
}

/**
 * 批量将测试用例转换为 prompts
 *
 * @param {object[]} cases - 测试用例数组
 * @param {object} [context] - 上下文
 * @returns {object[]} [{ caseId, title, prompt, priority }]
 */
export function casesToPrompts(cases, context = {}) {
  return cases.map(c => ({
    caseId: c.id,
    title: c.title,
    prompt: caseToPrompt(c, context),
    priority: c.priority,
    perspective: c.perspective,
    tags: c.tags,
  }))
}

/**
 * 执行单个测试用例
 *
 * @param {object} testCase - 结构化测试用例
 * @param {object} browserContext - { page, ai }
 * @param {object} [options] - 工作流选项
 * @param {string} [options.pageUrl] - 目标页面 URL
 * @returns {Promise<object>} 执行结果
 */
export async function runTestCase(testCase, browserContext, options = {}) {
  const { pageUrl, ...workflowOptions } = options
  const prompt = caseToPrompt(testCase, { pageUrl })

  console.log('\n' + '─'.repeat(60))
  console.log(`🧪 [${testCase.id}] ${testCase.title}`)
  console.log(`   视角: ${testCase.perspectiveName || testCase.perspective}`)
  console.log(`   优先级: ${testCase.priority}`)
  console.log(`   Prompt: ${prompt}`)
  console.log('─'.repeat(60))

  const startTime = Date.now()

  try {
    const result = await runWorkflow(prompt, browserContext, {
      stopOnError: true,
      stepDelay: 0,
      useCache: true,
      ...workflowOptions,
    })

    const elapsed = Date.now() - startTime

    return {
      caseId: testCase.id,
      title: testCase.title,
      priority: testCase.priority,
      perspective: testCase.perspective,
      passed: result.summary.allPassed,
      elapsed,
      steps: result.results,
      summary: result.summary,
    }
  } catch (error) {
    const elapsed = Date.now() - startTime

    return {
      caseId: testCase.id,
      title: testCase.title,
      priority: testCase.priority,
      perspective: testCase.perspective,
      passed: false,
      elapsed,
      error: error.message,
    }
  }
}

/**
 * 执行整个测试用例集
 *
 * @param {object[]} cases - 测试用例数组
 * @param {object} browserContext - { page, ai }
 * @param {object} [options] - 选项
 * @param {string} [options.pageUrl] - 目标页面 URL
 * @param {boolean} [options.stopOnFirstFail] - 首个用例失败即停止
 * @param {string[]} [options.filterPriorities] - 只运行指定优先级的用例
 * @returns {Promise<object>} 测试套件执行结果
 */
export async function runTestSuite(cases, browserContext, options = {}) {
  const { stopOnFirstFail = false, filterPriorities, pageUrl } = options

  // 按优先级过滤
  let filteredCases = cases
  if (filterPriorities) {
    filteredCases = cases.filter(c => filterPriorities.includes(c.priority))
  }

  console.log('\n' + '═'.repeat(60))
  console.log('🏃 [Test Suite] 开始执行测试用例集')
  console.log(`   用例数: ${filteredCases.length}`)
  console.log('═'.repeat(60))

  const results = []
  let passed = 0
  let failed = 0
  const startTime = Date.now()

  for (const testCase of filteredCases) {
    const result = await runTestCase(testCase, browserContext, { pageUrl })
    results.push(result)

    if (result.passed) {
      passed++
      console.log(`\n   ✅ [${result.caseId}] ${result.title} — ${result.elapsed}ms`)
    } else {
      failed++
      console.log(`\n   ❌ [${result.caseId}] ${result.title} — ${result.error || 'failed'}`)

      if (stopOnFirstFail) {
        console.log('\n   ⛔ 首个用例失败，停止执行')
        break
      }
    }
  }

  const totalElapsed = Date.now() - startTime

  const summary = {
    total: filteredCases.length,
    executed: results.length,
    passed,
    failed,
    allPassed: failed === 0 && passed === filteredCases.length,
    totalElapsed,
  }

  console.log('\n' + '═'.repeat(60))
  console.log(`📊 [Test Suite] 执行完成`)
  console.log(`   通过: ${passed}/${results.length}, 失败: ${failed}, 耗时: ${totalElapsed}ms`)
  console.log('═'.repeat(60))

  return { results, summary }
}
