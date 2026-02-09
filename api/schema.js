/**
 * ============================================================
 * 模块名称: 统一指令流 Schema 定义与校验 (Unified Instruction Schema)
 * ============================================================
 *
 * 功能描述:
 *   定义 LLM 输出的标准化 JSON 指令格式，并提供校验工具。
 *   这是"解析与规划层"和"适配层"之间的契约。
 *
 * 指令类型说明:
 *   - navigate: 页面导航，跳转到指定 URL
 *   - click:    点击操作，通过语义描述或 CSS 选择器定位元素
 *   - input:    输入操作，在指定元素中填入文本
 *   - verify:   验证操作，检查页面状态是否符合预期
 *   - wait:     等待操作，等待指定条件或固定时间
 *   - select:   下拉选择操作，选择下拉菜单中的选项
 *   - hover:    悬停操作，将鼠标悬停在指定元素上
 *   - press:    按键操作，模拟键盘按键
 *   - scroll:   滚动操作，滚动页面或指定元素
 * ============================================================
 */

/**
 * 支持的所有指令类型
 * @type {string[]}
 */
export const SUPPORTED_ACTIONS = [
  'navigate', // 页面导航
  'click', // 点击元素
  'input', // 输入文本
  'verify', // 验证断言
  'wait', // 等待条件
  'select', // 下拉选择
  'hover', // 鼠标悬停
  'press', // 键盘按键
  'scroll', // 页面滚动
]

/**
 * 校验单条指令是否符合 Unified Schema 格式
 *
 * @param {object} instruction - 待校验的指令对象
 * @returns {{ valid: boolean, errors: string[] }} 校验结果
 *
 * 指令格式要求:
 * {
 *   "step_id": number,          // 步骤编号 (必填)
 *   "action_type": string,      // 动作类型 (必填, 需在 SUPPORTED_ACTIONS 中)
 *   "params": object,           // 动作参数 (必填)
 *   "description": string       // 步骤描述 (必填)
 * }
 */
export function validateInstruction(instruction) {
  const errors = []

  // 校验必填字段
  if (typeof instruction.step_id !== 'number') {
    errors.push(`step_id 必须是数字, 当前值: ${instruction.step_id}`)
  }

  if (!instruction.action_type) {
    errors.push('action_type 不能为空')
  } else if (!SUPPORTED_ACTIONS.includes(instruction.action_type)) {
    errors.push(`不支持的 action_type: ${instruction.action_type}, 支持的类型: ${SUPPORTED_ACTIONS.join(', ')}`)
  }

  if (!instruction.params || typeof instruction.params !== 'object') {
    errors.push('params 必须是一个对象')
  }

  if (!instruction.description || typeof instruction.description !== 'string') {
    errors.push('description 必须是非空字符串')
  }

  // 校验各指令类型的特定参数
  if (instruction.params && instruction.action_type) {
    const paramErrors = validateActionParams(instruction.action_type, instruction.params)
    errors.push(...paramErrors)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * 校验特定指令类型的参数是否合法
 *
 * @param {string} actionType - 指令类型
 * @param {object} params - 指令参数
 * @returns {string[]} 错误信息列表
 */
function validateActionParams(actionType, params) {
  const errors = []

  switch (actionType) {
    case 'navigate':
      if (!params.url || typeof params.url !== 'string') {
        errors.push('navigate 指令必须包含有效的 url 参数')
      }
      break

    case 'click':
    case 'hover':
      if (!params.semantic_locator && !params.fallback_selector) {
        errors.push(`${actionType} 指令必须包含 semantic_locator 或 fallback_selector`)
      }
      break

    case 'input':
      if (!params.semantic_locator && !params.fallback_selector) {
        errors.push('input 指令必须包含 semantic_locator 或 fallback_selector')
      }
      if (params.value === undefined || params.value === null) {
        errors.push('input 指令必须包含 value 参数')
      }
      break

    case 'verify':
      if (!params.assertion || typeof params.assertion !== 'string') {
        errors.push('verify 指令必须包含有效的 assertion 参数')
      }
      break

    case 'wait':
      // wait 可以有 selector、timeout 或 condition
      if (!params.timeout && !params.selector && !params.condition) {
        errors.push('wait 指令必须包含 timeout、selector 或 condition 参数之一')
      }
      break

    case 'select':
      if (!params.semantic_locator && !params.fallback_selector) {
        errors.push('select 指令必须包含 semantic_locator 或 fallback_selector')
      }
      if (!params.value) {
        errors.push('select 指令必须包含 value 参数')
      }
      break

    case 'press':
      if (!params.key || typeof params.key !== 'string') {
        errors.push('press 指令必须包含有效的 key 参数')
      }
      break

    case 'scroll':
      if (!params.direction) {
        errors.push('scroll 指令必须包含 direction 参数 (up/down/top/bottom)')
      }
      break
  }

  return errors
}

/**
 * 校验完整指令流（JSON 数组）
 *
 * @param {object[]} instructions - 指令流数组
 * @returns {{ valid: boolean, errors: Array<{ step_id: number, errors: string[] }> }}
 */
export function validateInstructionStream(instructions) {
  if (!Array.isArray(instructions)) {
    return {
      valid: false,
      errors: [{ step_id: -1, errors: ['指令流必须是一个数组'] }],
    }
  }

  if (instructions.length === 0) {
    return {
      valid: false,
      errors: [{ step_id: -1, errors: ['指令流不能为空'] }],
    }
  }

  const allErrors = []

  for (const instruction of instructions) {
    const result = validateInstruction(instruction)
    if (!result.valid) {
      allErrors.push({
        step_id: instruction.step_id || 'unknown',
        errors: result.errors,
      })
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  }
}
