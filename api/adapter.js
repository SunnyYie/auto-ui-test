/**
 * ============================================================
 * 模块名称: 混合策略适配器 (Hybrid Adapter)
 * ============================================================
 *
 * 功能描述:
 *   核心逻辑层，接收 Unified Schema 定义的 JSON 指令，
 *   并将其转换为实际的浏览器操作。
 *
 * 混合策略 (Hybrid Strategy):
 *   1. AI 优先 (Zerostep): 默认使用 ai() 方法，通过自然语言描述定位元素
 *   2. Playwright 兜底 (Fallback): 如果 Zerostep 失败或指令中包含 fallback_selector，
 *      则降级使用 Playwright 原生定位器
 *
 * 核心函数:
 *   - executeInstruction(instruction, context): 执行单条指令
 *   - executeInstructionStream(instructions, context): 执行完整指令流
 *
 * 设计理念:
 *   对于显而易见的操作（如导航、等待、按键），直接使用 Playwright，
 *   只有在需要智能定位复杂元素时才调用 Zerostep AI，以控制成本和提高稳定性。
 * ============================================================
 */

/**
 * 执行单条指令
 *
 * 根据 action_type 分发到对应的处理函数，
 * 每个处理函数内部实现 "AI 优先 + Playwright 兜底" 的策略。
 *
 * @param {object} instruction - 符合 Unified Schema 的指令对象
 * @param {object} context - 执行上下文
 * @param {import('@playwright/test').Page} context.page - Playwright Page 实例
 * @param {Function} context.ai - Zerostep ai() 函数
 * @returns {Promise<{ success: boolean, result?: any, error?: string }>}
 */
export async function executeInstruction(instruction, context) {
  const { action_type: action, params, description, step_id } = instruction
  const { page, ai } = context

  console.log(`\n  ▶ [步骤 ${step_id}] ${description}`)
  console.log(`    📌 类型: ${action} | 参数: ${JSON.stringify(params)}`)

  const startTime = Date.now()

  try {
    let result

    // 如果该步骤已在工作流中预先执行（如并行导航），直接跳过
    if (instruction._preNavigated) {
      console.log(`    ⏩ 已预执行，跳过`)
      const elapsed = Date.now() - startTime
      return { success: true, result: 'pre-navigated', elapsed }
    }

    switch (action) {
      case 'navigate':
        result = await handleNavigate(page, params)
        break
      case 'click':
        result = await handleClick(page, ai, params)
        break
      case 'input':
        result = await handleInput(page, ai, params)
        break
      case 'verify':
        result = await handleVerify(page, ai, params)
        break
      case 'wait':
        result = await handleWait(page, params)
        break
      case 'select':
        result = await handleSelect(page, ai, params)
        break
      case 'hover':
        result = await handleHover(page, ai, params)
        break
      case 'press':
        result = await handlePress(page, params)
        break
      case 'scroll':
        result = await handleScroll(page, ai, params)
        break
      default:
        throw new Error(`不支持的指令类型: ${action}`)
    }

    const elapsed = Date.now() - startTime
    console.log(`    ✅ 执行成功 (${elapsed}ms)`)

    return { success: true, result, elapsed }
  } catch (error) {
    const elapsed = Date.now() - startTime
    console.error(`    ❌ 执行失败 (${elapsed}ms): ${error.message}`)

    return { success: false, error: error.message, elapsed }
  }
}

/**
 * 顺序执行完整指令流
 *
 * 遍历指令数组，逐条执行。如果某步失败，记录错误但继续执行后续步骤
 * （可通过 stopOnError 参数控制是否立即停止）。
 *
 * @param {object[]} instructions - 指令流数组
 * @param {object} context - 执行上下文 { page, ai }
 * @param {object} options - 执行选项
 * @param {boolean} options.stopOnError - 是否在遇到错误时停止，默认 true
 * @param {number} options.stepDelay - 每步之间的延迟（毫秒），默认 0（不延迟）
 * @returns {Promise<{ results: object[], summary: object }>}
 */
export async function executeInstructionStream(instructions, context, options = {}) {
  const { stopOnError = true, stepDelay = 0 } = options
  const results = []
  let successCount = 0
  let failCount = 0

  console.log(`\n🚀 [Adapter] 开始执行指令流，共 ${instructions.length} 个步骤`)
  console.log('─'.repeat(60))

  for (const instruction of instructions) {
    const result = await executeInstruction(instruction, context)
    results.push({
      step_id: instruction.step_id,
      description: instruction.description,
      ...result,
    })

    if (result.success) {
      successCount++
    } else {
      failCount++
      if (stopOnError) {
        console.error(`\n⛔ [Adapter] 步骤 ${instruction.step_id} 失败，停止执行`)
        break
      }
    }

    // 步骤间延迟，模拟人类操作节奏
    if (stepDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, stepDelay))
    }
  }

  console.log('─'.repeat(60))
  console.log(`📊 [Adapter] 执行完成: 成功 ${successCount}/${instructions.length}, 失败 ${failCount}`)

  return {
    results,
    summary: {
      total: instructions.length,
      success: successCount,
      fail: failCount,
      allPassed: failCount === 0 && successCount === instructions.length,
    },
  }
}

// ============================================================
// 以下为各指令类型的处理函数
// 每个函数内部实现 "AI 优先 + Playwright 兜底" 策略
// ============================================================

/**
 * 处理页面导航指令
 *
 * 导航操作无需 AI 参与，直接使用 Playwright 的 page.goto()。
 * 使用 domcontentloaded 而非 networkidle 以加快速度。
 *
 * @param {import('@playwright/test').Page} page - Playwright Page 实例
 * @param {object} params - { url: string }
 */
async function handleNavigate(page, params) {
  const { url } = params
  console.log(`    🌐 导航到: ${url}`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
}

/**
 * 处理点击指令 - 混合策略 (Playwright 优先模式)
 *
 * 优化后的策略优先级（速度优先）:
 * 1. 如果有 fallback_selector，优先使用 Playwright 原生定位（毫秒级）
 *    - 使用 :visible 伪选择器过滤隐藏元素，避免在隐藏元素上浪费时间
 * 2. 如果 Playwright 失败或没有 fallback_selector，使用 Zerostep AI（秒级）
 * 3. 如果都失败，抛出异常
 *
 * @param {import('@playwright/test').Page} page - Playwright Page
 * @param {Function} ai - Zerostep ai() 函数
 * @param {object} params - { semantic_locator, fallback_selector }
 */
async function handleClick(page, ai, params) {
  const { semantic_locator, fallback_selector } = params

  // 策略: 有 fallback_selector 时优先用 Playwright（速度快）
  if (fallback_selector) {
    try {
      // 等待元素出现（SPA 页面可能需要 JS 渲染）
      await page.locator(fallback_selector).first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})

      // 第一优先：可见元素直接点击（毫秒级）
      const visible = page.locator(fallback_selector).and(page.locator(':visible'))
      const visibleCount = await visible.count()
      if (visibleCount > 0) {
        console.log(`    ⚡ Playwright 点击: ${fallback_selector}`)
        await visible.first().click({ timeout: 3000 })
        return
      }

      // 第二优先：元素存在但不可见时，用 JS 强制点击（毫秒级，适用于百度等隐藏元素场景）
      const exists = await page.locator(fallback_selector).count()
      if (exists > 0) {
        console.log(`    ⚡ Playwright 强制点击 (JS): ${fallback_selector}`)
        await page.locator(fallback_selector).first().dispatchEvent('click')
        return
      }

      console.log(`    ⚠️ 选择器 ${fallback_selector} 未找到元素，升级使用 AI`)
    } catch (error) {
      console.log(`    ⚠️ Playwright 点击失败，升级使用 AI: ${error.message}`)
    }
  }

  // AI 兜底
  if (semantic_locator) {
    console.log(`    🤖 AI 点击: "${semantic_locator}"`)
    await ai(`Click on the ${semantic_locator}`)
  } else {
    throw new Error(`点击操作失败: Playwright 和 AI 均不可用`)
  }
}

/**
 * 处理输入指令 - 混合策略 (Playwright 优先模式)
 *
 * 优化后的策略优先级（速度优先）:
 * 1. 如果有 fallback_selector，优先使用 Playwright 原生定位（毫秒级）
 *    - 使用 :visible 伪选择器过滤隐藏元素
 * 2. 如果 Playwright 失败或没有 fallback_selector，使用 Zerostep AI（秒级）
 *
 * @param {import('@playwright/test').Page} page
 * @param {Function} ai - Zerostep ai()
 * @param {object} params - { semantic_locator, fallback_selector, value }
 */
async function handleInput(page, ai, params) {
  const { semantic_locator, fallback_selector, value } = params

  // 策略: 有 fallback_selector 时优先用 Playwright（速度快）
  if (fallback_selector) {
    try {
      const locator = page.locator(fallback_selector).first()

      // 等待元素挂载到 DOM（SPA 页面需要 JS 渲染，元素不会立即存在）
      await locator.waitFor({ state: 'attached', timeout: 10000 })

      // 第一优先：可见元素直接 fill（毫秒级）
      const isVisible = await locator.isVisible().catch(() => false)
      if (isVisible) {
        console.log(`    ⚡ Playwright 输入: ${fallback_selector} <- "${value}"`)
        await locator.fill(String(value), { timeout: 3000 })
        return
      }

      // 第二优先：元素存在但不可见时，用 JS 直接操作 DOM（毫秒级）
      // 适用于百度 #kw 等初始隐藏的输入框
      console.log(`    ⚡ Playwright 强制输入 (JS): ${fallback_selector} <- "${value}"`)
      await page.evaluate(
        ({ selector, val }) => {
          const el = document.querySelector(selector)
          if (!el) throw new Error(`元素 ${selector} 不存在`)
          // 聚焦 + 设置值 + 触发 input 事件，模拟用户输入
          el.focus()
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        },
        { selector: fallback_selector, val: String(value) },
      )
      return
    } catch (error) {
      console.log(`    ⚠️ Playwright 输入失败，升级使用 AI: ${error.message}`)
    }
  }

  // AI 兜底
  if (semantic_locator) {
    console.log(`    🤖 AI 输入: "${semantic_locator}" <- "${value}"`)
    await ai(`Type "${value}" into the ${semantic_locator}`)
  } else {
    throw new Error(`输入操作失败: Playwright 和 AI 均不可用`)
  }
}

/**
 * 处理验证指令 - 混合策略 (Playwright 优先模式)
 *
 * 优化后的策略:
 * 1. 先尝试用 Playwright 从页面内容中直接检测关键词（毫秒级）
 * 2. 如果页面文本检测无法满足，再使用 Zerostep AI 的断言功能（秒级）
 *
 * @param {import('@playwright/test').Page} page
 * @param {Function} ai - Zerostep ai()
 * @param {object} params - { assertion }
 */
async function handleVerify(page, ai, params) {
  const { assertion } = params

  console.log(`    🔍 验证: "${assertion}"`)

  // 策略: 先尝试从断言文本中提取关键词进行 Playwright 原生检测
  const keywords = extractKeywordsFromAssertion(assertion)

  if (keywords.length > 0) {
    const pageContent = await page.content()
    const pageText = await page.innerText('body').catch(() => pageContent)
    const found = keywords.some(kw => pageText.includes(kw) || pageContent.includes(kw))

    if (found) {
      console.log(`    ⚡ Playwright 验证通过: 页面包含关键词 [${keywords.join(', ')}]`)
      return true
    }
    console.log(`    ⚠️ Playwright 未找到关键词，升级使用 AI 验证`)
  }

  // AI 兜底: 使用 Zerostep 的断言能力
  const result = await ai(`Verify that ${assertion}`)
  console.log(`    🤖 AI 验证结果: ${result}`)

  if (result === false) {
    throw new Error(`断言失败: ${assertion}`)
  }

  return result
}

/**
 * 从断言文本中提取可用于页面搜索的关键词
 *
 * 尝试从中文/英文断言中找到被引号包裹的关键词，
 * 用于 Playwright 原生文本检测，避免调用 AI。
 *
 * @param {string} assertion - 断言描述文本
 * @returns {string[]} 提取到的关键词数组
 */
function extractKeywordsFromAssertion(assertion) {
  const keywords = []
  // 匹配中文引号和英文引号中的内容
  const patterns = [/[''](.*?)['']/g, /["](.*?)["]/g, /'(.*?)'/g, /"(.*?)"/g]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(assertion)) !== null) {
      if (match[1] && match[1].length > 0) {
        keywords.push(match[1])
      }
    }
  }
  return [...new Set(keywords)]
}

/**
 * 处理等待指令
 *
 * 等待操作无需 AI 参与，直接使用 Playwright 原生能力。
 * 支持三种等待方式：
 * - timeout: 固定等待时间
 * - selector: 等待元素出现
 * - condition: 等待特定条件（如 networkidle）
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} params - { timeout?, selector?, condition? }
 */
async function handleWait(page, params) {
  const { timeout, selector, condition } = params

  if (selector) {
    console.log(`    ⏳ 等待元素出现: ${selector}`)
    try {
      // 使用 .first() 避免 strict mode violation（选择器匹配多个元素时只取第一个）
      // 使用较短的超时时间，快速失败后进入回退逻辑
      await page
        .locator(selector)
        .first()
        .waitFor({
          state: 'visible',
          timeout: Math.min(timeout || 5000, 3000),
        })
      return
    } catch (error) {
      // 选择器等待失败时，快速回退到等待页面稳定
      console.log(`    ⚠️ 选择器 "${selector}" 等待超时，回退到等待页面稳定`)
      // 只等待 domcontentloaded（快速）而非 networkidle（慢）
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      await page.waitForTimeout(500)
      return
    }
  } else if (condition === 'networkidle') {
    console.log(`    ⏳ 等待网络空闲`)
    await page.waitForLoadState('networkidle')
  } else if (condition) {
    // 对于其他自定义 condition，先尝试等待网络空闲，再等待一段固定时间
    console.log(`    ⏳ 等待条件: ${condition}`)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(timeout || 3000)
  } else if (timeout) {
    console.log(`    ⏳ 等待 ${timeout}ms`)
    await page.waitForTimeout(timeout)
  }
}

/**
 * 处理下拉选择指令 - 混合策略 (Playwright 优先模式)
 *
 * @param {import('@playwright/test').Page} page
 * @param {Function} ai - Zerostep ai()
 * @param {object} params - { semantic_locator, fallback_selector, value }
 */
async function handleSelect(page, ai, params) {
  const { semantic_locator, fallback_selector, value } = params

  if (fallback_selector) {
    try {
      console.log(`    ⚡ Playwright 选择: ${fallback_selector} -> "${value}"`)
      await page.locator(fallback_selector).selectOption(value)
      return
    } catch (error) {
      console.log(`    ⚠️ Playwright 选择失败: ${error.message}`)
    }
  }

  if (semantic_locator) {
    console.log(`    🤖 AI 选择: "${semantic_locator}" -> "${value}"`)
    await ai(`Select "${value}" from the ${semantic_locator}`)
  } else {
    throw new Error(`选择操作失败: Playwright 和 AI 均不可用`)
  }
}

/**
 * 处理悬停指令 - 混合策略 (Playwright 优先模式)
 *
 * @param {import('@playwright/test').Page} page
 * @param {Function} ai - Zerostep ai()
 * @param {object} params - { semantic_locator, fallback_selector }
 */
async function handleHover(page, ai, params) {
  const { semantic_locator, fallback_selector } = params

  if (fallback_selector) {
    try {
      console.log(`    ⚡ Playwright 悬停: ${fallback_selector}`)
      await page.locator(fallback_selector).hover()
      return
    } catch (error) {
      console.log(`    ⚠️ Playwright 悬停失败: ${error.message}`)
    }
  }

  if (semantic_locator) {
    console.log(`    🤖 AI 悬停: "${semantic_locator}"`)
    await ai(`Hover over the ${semantic_locator}`)
  } else {
    throw new Error(`悬停操作失败: Playwright 和 AI 均不可用`)
  }
}

/**
 * 处理键盘按键指令
 *
 * 按键操作无需 AI 参与，直接使用 Playwright 的 keyboard.press()。
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} params - { key }
 */
async function handlePress(page, params) {
  const { key } = params
  console.log(`    ⌨️ 按下键: ${key}`)
  await page.keyboard.press(key)
}

/**
 * 处理滚动指令 - 混合策略
 *
 * 如果有 semantic_locator（如"左侧导航栏"），使用 AI 定位元素后滚动；
 * 否则直接滚动页面。
 *
 * @param {import('@playwright/test').Page} page
 * @param {Function} ai - Zerostep ai()
 * @param {object} params - { direction, semantic_locator? }
 */
async function handleScroll(page, ai, params) {
  const { direction, semantic_locator } = params

  if (semantic_locator) {
    try {
      console.log(`    🤖 AI 滚动: "${semantic_locator}" -> ${direction}`)
      await ai(`Scroll the ${semantic_locator} ${direction}`)
      return
    } catch (error) {
      console.log(`    ⚠️ AI 滚动失败: ${error.message}`)
    }
  }

  // 直接滚动页面
  console.log(`    📜 页面滚动: ${direction}`)
  await page.evaluate(dir => {
    const viewportHeight = window.visualViewport?.height ?? 720
    const scrollDistance = 0.75 * viewportHeight
    switch (dir) {
      case 'up':
        window.scrollBy(0, -scrollDistance)
        break
      case 'down':
        window.scrollBy(0, scrollDistance)
        break
      case 'top':
        window.scrollTo(0, 0)
        break
      case 'bottom':
        window.scrollTo(0, document.body.scrollHeight)
        break
    }
  }, direction)
}
