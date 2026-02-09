/**
 * ============================================================
 * 模块名称: LLM 客户端 - 解析与规划层 (The Brain)
 * ============================================================
 *
 * 功能描述:
 *   负责调用大模型（通过 Anthropic 兼容接口），将用户的自然语言指令
 *   解析为标准化的 "统一指令流 (Unified Instruction Stream)" JSON 格式。
 *   这一层不关心具体的页面元素 ID，只关心"动作"和"描述"。
 *
 * 核心函数:
 *   - parseIntent(prompt): 接收自然语言，返回指令流 JSON
 *
 * 环境变量:
 *   - ANTHROPIC_BASE_URL: 大模型 API 的基础 URL
 *   - ANTHROPIC_AUTH_TOKEN: 大模型 API 的认证 Token
 * ============================================================
 */

import dotenv from 'dotenv'
import { validateInstructionStream, SUPPORTED_ACTIONS } from './schema.js'

// 加载 .env.local 环境变量
dotenv.config({ path: '.env.local' })

/**
 * 系统提示词：指导 LLM 生成标准化的指令流 JSON
 *
 * 关键设计原则:
 * 1. 输出格式严格为 JSON 数组
 * 2. 每步必须包含 semantic_locator（用于 AI 识别）
 * 3. 可选提供 fallback_selector（CSS 选择器兜底）
 * 4. 描述尽量具体，包含元素的功能和外观特征
 */
const SYSTEM_PROMPT = `你是一个 Web UI 自动化测试专家。将用户的自然语言目标转化为执行步骤。

## 输出格式
严格输出纯 JSON 数组，不要包含任何 markdown 标记或额外文字。

## 支持的 action_type
${SUPPORTED_ACTIONS.map(a => `- ${a}`).join('\n')}

## JSON 格式
{"step_id": <数字>, "action_type": "<类型>", "params": {}, "description": "<中文描述>"}

## params 字段说明
- navigate: { "url": "<URL>" }
- click/hover: { "semantic_locator": "<英文描述元素>", "fallback_selector": "<可选CSS>" }
- input: { "semantic_locator": "<英文描述>", "fallback_selector": "<可选CSS>", "value": "<内容>" }
- verify: { "assertion": "<断言描述，关键词用引号包裹>" }
- wait: { "selector": "<CSS选择器>", "timeout": <毫秒> }
- press: { "key": "<按键名>" }
- scroll: { "direction": "<up/down/top/bottom>" }
- select: { "semantic_locator": "<英文描述>", "fallback_selector": "<可选CSS>", "value": "<选项>" }

## 规则
1. navigate 不需要 semantic_locator
2. 交互操作必须提供 semantic_locator，尽量同时提供 fallback_selector
3. **不要在 navigate 后添加多余的 wait 步骤**
4. wait 仅用于等待动态内容出现，必须提供 selector
5. input 会自动聚焦，不需要先 click
6. 生成尽量少的步骤，追求高效`

/**
 * 调用 LLM 接口，将自然语言意图解析为指令流
 *
 * @param {string} userPrompt - 用户的自然语言指令
 * @returns {Promise<object[]>} 解析后的指令流 JSON 数组
 * @throws {Error} 当 API 调用失败或返回格式不合法时抛出异常
 *
 * 使用示例:
 *   const instructions = await parseIntent('在百度搜索 Playwright')
 *   // 返回: [{ step_id: 1, action_type: 'navigate', ... }, ...]
 */
export async function parseIntent(userPrompt) {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN

  if (!baseUrl || !authToken) {
    throw new Error('LLM 配置缺失: 请确保 .env.local 文件中设置了 ANTHROPIC_BASE_URL 和 ANTHROPIC_AUTH_TOKEN')
  }

  console.log('\n🧠 [LLM Planner] 正在解析用户意图...')
  console.log(`📝 用户输入: "${userPrompt}"`)

  try {
    // 调用 Anthropic 兼容的代理 API（使用 Bearer Token 认证）
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
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API 调用失败 (${response.status}): ${errorText}`)
    }

    const data = await response.json()

    // 提取 LLM 返回的文本内容
    const content = data.content?.[0]?.text
    if (!content) {
      throw new Error('LLM 返回内容为空')
    }

    console.log(`\n📋 [LLM Planner] LLM 原始返回:\n${content}\n`)

    // 解析 JSON（兼容 LLM 可能返回的 markdown 代码块）
    const instructions = extractJSON(content)

    // 校验指令流格式
    const validation = validateInstructionStream(instructions)
    if (!validation.valid) {
      console.error('❌ [LLM Planner] 指令流校验失败:', JSON.stringify(validation.errors, null, 2))
      throw new Error(`指令流格式校验失败: ${JSON.stringify(validation.errors)}`)
    }

    console.log(`✅ [LLM Planner] 成功解析出 ${instructions.length} 个执行步骤`)
    return instructions
  } catch (error) {
    console.error(`❌ [LLM Planner] 解析失败: ${error.message}`)
    throw error
  }
}

/**
 * 从 LLM 返回的文本中提取 JSON 内容
 *
 * LLM 有时会在 JSON 外面包裹 markdown 代码块标记，
 * 此函数会自动清理这些标记。
 *
 * @param {string} text - LLM 返回的原始文本
 * @returns {object[]} 解析后的 JSON 数组
 * @throws {Error} 当无法解析 JSON 时抛出异常
 */
function extractJSON(text) {
  // 移除可能的 markdown 代码块标记
  let cleaned = text.trim()

  // 匹配 ```json ... ``` 或 ``` ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim()
  }

  // 尝试找到 JSON 数组的起始和结束位置
  const startIdx = cleaned.indexOf('[')
  const endIdx = cleaned.lastIndexOf(']')
  if (startIdx !== -1 && endIdx !== -1) {
    cleaned = cleaned.substring(startIdx, endIdx + 1)
  }

  try {
    return JSON.parse(cleaned)
  } catch (error) {
    throw new Error(`无法解析 LLM 返回的 JSON: ${error.message}\n原始内容: ${text}`)
  }
}
