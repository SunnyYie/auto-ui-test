/**
 * ============================================================
 * 模块名称: 需求解构器 (Requirement Analyzer)
 * ============================================================
 *
 * 功能描述:
 *   调用 LLM 将自然语言需求描述解构为结构化的功能点列表。
 *   这是"数据采集层"的核心模块，为后续多视角测试用例生成提供输入。
 *
 * 核心函数:
 *   - decomposeRequirement(requirement, context): 需求解构
 *
 * 输出格式:
 *   {
 *     features: [
 *       { id, name, description, type: 'explicit'|'implicit', uiElements: [], relatedUrl: '' }
 *     ],
 *     targetUrl: '',
 *     componentName: ''
 *   }
 * ============================================================
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

/**
 * 需求解构的 System Prompt
 *
 * 角色: 产品经理 + 业务分析师
 * 任务: 将需求拆解为显性功能 + 隐性功能的功能点列表
 */
const DECOMPOSE_PROMPT = `你是一个资深产品经理和 Web 测试分析师。你的任务是将需求描述解构为具体的功能点列表。

## 输出格式
严格输出纯 JSON 对象，不要包含任何 markdown 标记或额外文字。

## JSON 结构
{
  "targetUrl": "该功能对应的 URL 路径（如果能推断出来）",
  "componentName": "主要涉及的组件名",
  "features": [
    {
      "id": "F1",
      "name": "功能点名称",
      "description": "具体描述",
      "type": "explicit 或 implicit",
      "uiElements": ["涉及的 UI 元素描述"],
      "priority": "high/medium/low"
    }
  ]
}

## 规则
1. explicit = 需求中明确提到的功能，implicit = 该功能通常隐含的功能
2. 每个功能点必须关联到具体的 UI 元素
3. uiElements 用自然语言描述（如"登录按钮"、"用户名输入框"）
4. 如果有代码变更上下文，结合代码分析推断隐性功能
5. priority: high=核心功能, medium=辅助功能, low=边缘场景`

/**
 * 解构需求为功能点列表
 *
 * @param {string} requirement - 自然语言需求描述
 * @param {object} [context] - 附加上下文
 * @param {string} [context.diffContext] - Git Diff 格式化文本
 * @param {string} [context.pageUrl] - 目标页面 URL
 * @returns {Promise<object>} 结构化的功能点列表
 */
export async function decomposeRequirement(requirement, context = {}) {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN

  if (!baseUrl || !authToken) {
    throw new Error('LLM 配置缺失: 请确保 .env.local 中设置了 ANTHROPIC_BASE_URL 和 ANTHROPIC_AUTH_TOKEN')
  }

  console.log('\n🧠 [Requirement Analyzer] 正在解构需求...')
  console.log(`📝 需求: "${requirement}"`)

  // 构造用户消息，包含需求和可选的代码变更上下文
  let userMessage = `## 需求描述\n${requirement}`

  if (context.diffContext) {
    userMessage += `\n\n## 代码变更上下文\n${context.diffContext}`
  }

  if (context.pageUrl) {
    userMessage += `\n\n## 目标页面\n${context.pageUrl}`
  }

  try {
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
        system: DECOMPOSE_PROMPT,
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

    console.log(`\n📋 [Requirement Analyzer] LLM 原始返回:\n${content}\n`)

    const result = extractJSON(content)

    console.log(`✅ [Requirement Analyzer] 解构完成: ${result.features?.length || 0} 个功能点`)
    for (const f of result.features || []) {
      console.log(`   ${f.id}. [${f.type}] ${f.name} (${f.priority})`)
    }

    return result
  } catch (error) {
    console.error(`❌ [Requirement Analyzer] 解构失败: ${error.message}`)
    throw error
  }
}

/**
 * 从 LLM 返回文本中提取 JSON
 */
function extractJSON(text) {
  let cleaned = text.trim()
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim()

  const startIdx = cleaned.indexOf('{')
  const endIdx = cleaned.lastIndexOf('}')
  if (startIdx !== -1 && endIdx !== -1) {
    cleaned = cleaned.substring(startIdx, endIdx + 1)
  }

  return JSON.parse(cleaned)
}
