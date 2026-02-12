/**
 * ============================================================
 * 模块名称: 多视角测试用例生成器 (Multi-Perspective Case Generator)
 * ============================================================
 *
 * 功能描述:
 *   采用"发散-收敛"模型，从多个测试视角并行生成测试用例，
 *   然后合并去重、分类排序，输出结构化的测试用例集。
 *
 * 四大视角:
 *   A. 功能测试员 (Happy Path) — 正常流程覆盖
 *   B. 破坏性测试员 (Chaos Engineer) — 边缘/异常场景
 *   C. 交互体验测试员 (UX/Interaction) — 用户体验与交互
 *   D. 安全性能测试员 (Security/Performance) — 安全与性能
 *
 * 核心函数:
 *   - generateCases(features, context): 多视角生成 + 合并收敛
 *   - generatePerspective(perspective, features, context): 单视角生成
 *   - mergeCases(perspectiveResults): 合并去重
 *
 * 输出格式:
 *   {
 *     cases: [{
 *       id, title, perspective, priority, preconditions,
 *       steps: [{ action, target, value?, expected }],
 *       expectedResult, tags: []
 *     }],
 *     summary: { total, byPerspective, byPriority }
 *   }
 * ============================================================
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

/**
 * 四大测试视角定义
 */
const PERSPECTIVES = [
  {
    id: 'happy_path',
    name: '功能测试员',
    emoji: '✅',
    systemPrompt: `你是一个常规功能测试员 (Happy Path Tester)。
你的职责是验证所有正常功能路径，确保功能按预期工作。

关注点:
- 正常数据输入和操作流程
- 各功能点的基本可用性
- 正确的页面跳转和数据展示
- 成功状态的反馈信息`,
  },
  {
    id: 'chaos',
    name: '破坏性测试员',
    emoji: '💥',
    systemPrompt: `你是一个破坏性测试员 (Chaos Engineer / Edge Case Tester)。
你的职责是找出系统的弱点和边界情况。

关注点:
- 空值、超长输入、特殊字符（SQL注入、XSS）
- 网络断开/超时场景
- 连续快速操作（重复点击、频繁切换）
- 边界值（最大/最小/临界值）
- 异常数据格式
- 并发操作`,
  },
  {
    id: 'ux',
    name: '交互体验测试员',
    emoji: '🎨',
    systemPrompt: `你是一个交互与体验测试员 (UX/Interaction Tester)。
你的职责是从真实用户的角度测试交互体验。

关注点:
- 键盘操作（Tab切换、Enter提交、Esc关闭）
- 页面加载状态（loading、骨架屏）
- 错误提示的友好性和准确性
- 表单验证反馈（实时 vs 提交时）
- 浏览器前进/后退行为
- 响应式布局（如果适用）`,
  },
  {
    id: 'security',
    name: '安全性能测试员',
    emoji: '🔒',
    systemPrompt: `你是一个安全与性能测试员 (Security & Performance Tester)。
你的职责是发现安全漏洞和性能问题。

关注点:
- XSS 注入（输入框中输入脚本）
- CSRF 防护
- 敏感信息泄露（密码明文、token 暴露）
- 接口响应时间
- 大量数据时的页面性能
- 会话管理（过期、并发登录）`,
  },
]

/**
 * 生成测试用例的通用 Prompt 模板
 */
const CASE_GEN_PROMPT_TEMPLATE = `{perspectivePrompt}

## 输出格式
严格输出纯 JSON 数组，不要包含任何 markdown 标记或额外文字。

## 测试用例 JSON 结构
[
  {
    "title": "用例标题",
    "priority": "P0/P1/P2/P3",
    "preconditions": "前置条件描述",
    "steps": [
      {
        "action": "navigate/click/input/verify/wait/press/hover/scroll",
        "target": "操作目标的自然语言描述",
        "value": "输入值（如果是 input 操作）",
        "expected": "该步骤的预期结果"
      }
    ],
    "expectedResult": "最终预期结果",
    "tags": ["标签1", "标签2"]
  }
]

## 规则
1. P0=阻塞性功能, P1=核心功能, P2=一般功能, P3=边缘场景
2. steps 中的 action 必须是支持的操作类型
3. target 使用自然语言描述 UI 元素（如"用户名输入框"、"登录按钮"）
4. 每个用例聚焦一个测试点，不要混合多个测试目标
5. 生成 3-6 个高质量用例，不要生成重复或低价值的用例`

/**
 * 多视角生成测试用例（发散阶段）+ 合并去重（收敛阶段）
 *
 * @param {object} decomposedReq - decomposeRequirement 的返回值
 * @param {object} [context] - 附加上下文
 * @param {string} [context.diffContext] - Git Diff 上下文
 * @param {string} [context.pageUrl] - 目标页面 URL
 * @param {string[]} [context.perspectives] - 指定使用的视角 ID，默认全部
 * @returns {Promise<object>} 合并后的测试用例集
 */
export async function generateCases(decomposedReq, context = {}) {
  const { perspectives: selectedPerspectives } = context

  // 筛选要使用的视角
  const activePerspectives = selectedPerspectives
    ? PERSPECTIVES.filter(p => selectedPerspectives.includes(p.id))
    : PERSPECTIVES

  console.log('\n' + '═'.repeat(60))
  console.log('🎯 [Case Generator] 多视角测试用例生成')
  console.log('═'.repeat(60))
  console.log(`📋 功能点: ${decomposedReq.features?.length || 0} 个`)
  console.log(`👁️ 视角: ${activePerspectives.map(p => `${p.emoji} ${p.name}`).join(' | ')}`)

  // ========================
  // 发散阶段: 并行调用 LLM
  // ========================
  console.log('\n🔀 [发散阶段] 并行生成各视角用例...')
  const startTime = Date.now()

  const perspectiveResults = await Promise.all(
    activePerspectives.map(perspective =>
      generatePerspective(perspective, decomposedReq, context).catch(error => {
        console.error(`   ❌ ${perspective.emoji} ${perspective.name} 生成失败: ${error.message}`)
        return { perspective: perspective.id, cases: [], error: error.message }
      }),
    ),
  )

  const genElapsed = Date.now() - startTime
  console.log(`\n⏱️ 发散阶段耗时: ${genElapsed}ms`)

  // ========================
  // 收敛阶段: 合并去重
  // ========================
  console.log('\n🔄 [收敛阶段] 合并去重...')
  const merged = mergeCases(perspectiveResults)

  console.log('\n' + '═'.repeat(60))
  console.log(`✅ [Case Generator] 生成完成: ${merged.summary.total} 个用例`)
  console.log(`   按视角: ${Object.entries(merged.summary.byPerspective).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  console.log(`   按优先级: ${Object.entries(merged.summary.byPriority).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  console.log('═'.repeat(60))

  return merged
}

/**
 * 单视角生成测试用例
 *
 * @param {object} perspective - 视角定义
 * @param {object} decomposedReq - 解构后的需求
 * @param {object} context - 上下文
 * @returns {Promise<object>} { perspective, cases }
 */
export async function generatePerspective(perspective, decomposedReq, context = {}) {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN

  console.log(`   ${perspective.emoji} [${perspective.name}] 开始生成...`)

  // 构造 system prompt
  const systemPrompt = CASE_GEN_PROMPT_TEMPLATE.replace('{perspectivePrompt}', perspective.systemPrompt)

  // 构造用户消息
  let userMessage = `## 需要测试的功能点\n`
  for (const f of decomposedReq.features || []) {
    userMessage += `- ${f.id}. ${f.name}: ${f.description} (${f.type}, ${f.priority})\n`
    if (f.uiElements?.length) {
      userMessage += `  UI 元素: ${f.uiElements.join(', ')}\n`
    }
  }

  if (decomposedReq.targetUrl) {
    userMessage += `\n## 目标页面 URL\n${decomposedReq.targetUrl}`
  }

  if (context.diffContext) {
    userMessage += `\n\n## 代码变更上下文\n${context.diffContext}`
  }

  if (context.pageUrl) {
    userMessage += `\n\n## 页面 URL\n${context.pageUrl}`
  }

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`LLM API 调用失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const content = data.content?.[0]?.text
  if (!content) throw new Error('LLM 返回内容为空')

  const cases = extractJSON(content)

  // 给每个用例打上视角标签
  const taggedCases = cases.map((c, i) => ({
    ...c,
    id: `${perspective.id}_${i + 1}`,
    perspective: perspective.id,
    perspectiveName: perspective.name,
  }))

  console.log(`   ${perspective.emoji} [${perspective.name}] 完成: ${taggedCases.length} 个用例`)

  return { perspective: perspective.id, cases: taggedCases }
}

/**
 * 合并多视角生成的测试用例（收敛阶段）
 *
 * 去重逻辑: 基于 title 相似度，合并重复用例
 *
 * @param {object[]} perspectiveResults - 各视角的生成结果
 * @returns {object} 合并后的用例集
 */
export function mergeCases(perspectiveResults) {
  const allCases = []
  const byPerspective = {}
  const byPriority = {}

  for (const result of perspectiveResults) {
    if (!result.cases || result.error) continue
    byPerspective[result.perspective] = result.cases.length

    for (const c of result.cases) {
      // 简单去重: 检查标题相似度
      const isDuplicate = allCases.some(existing => titleSimilarity(existing.title, c.title) > 0.7)

      if (!isDuplicate) {
        allCases.push(c)
        byPriority[c.priority] = (byPriority[c.priority] || 0) + 1
      }
    }
  }

  // 按优先级排序: P0 > P1 > P2 > P3
  allCases.sort((a, b) => {
    const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 }
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
  })

  // 重新编号
  allCases.forEach((c, i) => {
    c.id = `TC_${String(i + 1).padStart(3, '0')}`
  })

  return {
    cases: allCases,
    summary: {
      total: allCases.length,
      byPerspective,
      byPriority,
    },
  }
}

/**
 * 计算两个标题的相似度（简单的词重叠度）
 */
function titleSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/))
  const wordsB = new Set(b.toLowerCase().split(/\s+/))
  const intersection = [...wordsA].filter(w => wordsB.has(w))
  const union = new Set([...wordsA, ...wordsB])
  return union.size > 0 ? intersection.length / union.size : 0
}

/**
 * 从 LLM 返回文本中提取 JSON
 */
function extractJSON(text) {
  let cleaned = text.trim()
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim()

  const startIdx = cleaned.indexOf('[')
  const endIdx = cleaned.lastIndexOf(']')
  if (startIdx !== -1 && endIdx !== -1) {
    cleaned = cleaned.substring(startIdx, endIdx + 1)
  }

  return JSON.parse(cleaned)
}
