/**
 * ============================================================
 * 模块名称: Git Diff 分析器 v2 (Git Diff Inspector)
 * ============================================================
 *
 * 功能描述:
 *   深度分析 Git 代码变更，提供三层洞察：
 *   1. 文件智能分类 — CSS/样式 → UI 兼容性标签；逻辑/状态 → 状态流转标签；组件 → 功能标签
 *   2. Props/接口变更提取 — 识别新增/修改/删除的 Props、emit 事件、函数参数
 *   3. 依赖引用关系分析 — import/require 追踪，计算回归影响范围
 *
 * 核心函数:
 *   - analyzeGitDiff(options): 分析 git diff，返回结构化变更信息
 *   - parseDiffOutput(diffText): 解析 diff 文本为结构化数据
 *   - analyzeDependencyImpact(files, options): 分析依赖引用关系和回归范围
 *   - formatDiffContext(analysis): 格式化为 LLM 可读上下文
 *
 * 输出格式:
 *   {
 *     files: [{ path, category, impactTags, status, additions, deletions,
 *               hunks, functions, components, propsChanges, emitChanges }],
 *     summary: { totalFiles, totalAdditions, totalDeletions, byCategory },
 *     components: [], functions: [],
 *     propsChanges: [{ component, added, removed, modified }],
 *     dependencyImpact: { changedModules, affectedFiles, regressionScope }
 *   }
 * ============================================================
 */

import { execSync } from 'child_process'
import { resolve } from 'path'

// ============================================================
// 文件分类规则
// ============================================================

/**
 * 文件分类映射表
 * category: 文件类别标签
 * impactTags: 影响分析标签（指导测试策略）
 */
const FILE_CATEGORY_RULES = [
  {
    test: /\.(css|scss|sass|less|styl|stylus)$/,
    category: 'style',
    impactTags: ['UI兼容性', '样式回归', '响应式布局'],
  },
  {
    test: /\.(vue|jsx|tsx)$/,
    category: 'component',
    impactTags: ['组件功能', '交互行为', 'Props接口'],
  },
  {
    test: /\.(ts|js)$/,
    // 需要根据路径细分
    subRules: [
      { test: /store|vuex|pinia|redux|mobx|state/i, category: 'state', impactTags: ['状态流转', '数据一致性', '副作用'] },
      { test: /router|route/i, category: 'router', impactTags: ['页面跳转', '路由守卫', '权限控制'] },
      { test: /api|service|request|http/i, category: 'api', impactTags: ['接口调用', '数据格式', '错误处理'] },
      { test: /util|helper|lib|tool|common/i, category: 'util', impactTags: ['工具函数', '下游回归', '公共逻辑'] },
      { test: /hook|composable|use[A-Z]/i, category: 'hook', impactTags: ['组合逻辑', '状态共享', '副作用'] },
      { test: /config|constant|enum/i, category: 'config', impactTags: ['配置变更', '全局影响'] },
      { test: /type|interface|\.d\.ts$/i, category: 'type', impactTags: ['类型约束', '接口契约'] },
      { test: /test|spec|__test__/i, category: 'test', impactTags: ['测试变更'] },
    ],
    // 默认分类
    defaultCategory: 'logic',
    defaultImpactTags: ['业务逻辑', '数据处理'],
  },
  {
    test: /\.(html|ejs|pug|hbs)$/,
    category: 'template',
    impactTags: ['页面结构', 'SEO', '可访问性'],
  },
]

/**
 * 对文件路径进行智能分类
 */
function classifyFile(filePath) {
  for (const rule of FILE_CATEGORY_RULES) {
    if (rule.test.test(filePath)) {
      // 有子规则的情况（如 .js/.ts 文件按路径细分）
      if (rule.subRules) {
        for (const sub of rule.subRules) {
          if (sub.test.test(filePath)) {
            return { category: sub.category, impactTags: [...sub.impactTags] }
          }
        }
        return { category: rule.defaultCategory, impactTags: [...rule.defaultImpactTags] }
      }
      return { category: rule.category, impactTags: [...rule.impactTags] }
    }
  }
  return { category: 'other', impactTags: ['其他变更'] }
}

// ============================================================
// Props / Emit / 参数变更检测
// ============================================================

/**
 * 提取变更行中的 Props 定义变化
 * 支持 Vue (defineProps / props 对象) 和 React (interface Props / PropTypes)
 */
function extractPropsChanges(hunks, filePath) {
  const ext = filePath.split('.').pop()
  const added = []
  const removed = []
  const modified = []

  // 收集所有新增行和删除行
  const addedLines = []
  const removedLines = []
  const allLines = [] // 含上下文行，用于判断作用域
  for (const hunk of hunks) {
    // hunk header 中可能有 props 上下文
    if (hunk.context) allLines.push(hunk.context)
    for (const line of hunk.lines) {
      allLines.push(line.substring(1).trim())
      if (line.startsWith('+') && !line.startsWith('+++')) addedLines.push(line.substring(1).trim())
      if (line.startsWith('-') && !line.startsWith('---')) removedLines.push(line.substring(1).trim())
    }
  }

  // ---------- Vue Props 检测 ----------
  if (['vue', 'js', 'ts'].includes(ext)) {
    // defineProps<{ propName: Type }> 或 props: { propName: { type: X } }
    const propPatterns = [
      // Vue 2 props 对象: propName: { type: String, default: ... }
      /(\w+)\s*:\s*\{\s*type:\s*(\w+)/g,
      // Vue 2 简写: propName: String
      /(\w+)\s*:\s*(String|Number|Boolean|Array|Object|Function)/g,
    ]

    // 检查 hunk 全部内容（含上下文行）是否在 props 上下文中
    const isInPropsContext = () => {
      const joined = allLines.join('\n')
      return /defineProps|props\s*[:=]\s*\{|props\s*:\s*\[/i.test(joined)
    }

    // 从新增行中提取 props
    if (isInPropsContext()) {
      for (const line of addedLines) {
        for (const pattern of propPatterns) {
          pattern.lastIndex = 0
          let m
          while ((m = pattern.exec(line)) !== null) {
            const propName = m[1]
            // 过滤掉关键字和常见非 prop 名
            if (!['type', 'default', 'required', 'validator', 'return', 'const', 'let', 'var', 'function', 'if', 'else'].includes(propName)) {
              added.push({ name: propName, type: m[2]?.trim() || 'unknown' })
            }
          }
        }
      }
    }

    // 从删除行中提取 props
    if (isInPropsContext()) {
      for (const line of removedLines) {
        for (const pattern of propPatterns) {
          pattern.lastIndex = 0
          let m
          while ((m = pattern.exec(line)) !== null) {
            const propName = m[1]
            if (!['type', 'default', 'required', 'validator', 'return', 'const', 'let', 'var', 'function', 'if', 'else'].includes(propName)) {
              removed.push({ name: propName, type: m[2]?.trim() || 'unknown' })
            }
          }
        }
      }
    }
  }

  // ---------- React Props 检测 ----------
  if (['tsx', 'jsx'].includes(ext)) {
    const interfacePattern = /(\w+)\s*[?]?\s*:\s*([\w<>\[\]\s|]+)/g

    for (const line of addedLines) {
      interfacePattern.lastIndex = 0
      let m
      while ((m = interfacePattern.exec(line)) !== null) {
        if (!['extends', 'implements', 'export', 'interface', 'type', 'return'].includes(m[1])) {
          added.push({ name: m[1], type: m[2]?.trim() || 'unknown' })
        }
      }
    }
  }

  // ---------- 新增的 HTML 属性（Vue template 中的 prop 绑定）----------
  for (const line of addedLines) {
    // :propName="value" 或 v-bind:propName="value" 或 @eventName="handler"
    const bindPattern = /(?::|v-bind:)([\w-]+)\s*=/g
    let m
    while ((m = bindPattern.exec(line)) !== null) {
      const propName = m[1]
      if (!added.find(p => p.name === propName) && !['class', 'style', 'key', 'ref', 'id'].includes(propName)) {
        added.push({ name: propName, type: 'binding', source: 'template' })
      }
    }
  }

  // ---------- 同名 prop 的增删 → 视为修改 ----------
  const addedNames = new Set(added.map(p => p.name))
  const removedNames = new Set(removed.map(p => p.name))
  for (const name of addedNames) {
    if (removedNames.has(name)) {
      const addedProp = added.find(p => p.name === name)
      const removedProp = removed.find(p => p.name === name)
      modified.push({ name, from: removedProp?.type, to: addedProp?.type })
    }
  }
  // 从 added/removed 中移除已归类为 modified 的
  const modifiedNames = new Set(modified.map(p => p.name))
  const pureAdded = added.filter(p => !modifiedNames.has(p.name))
  const pureRemoved = removed.filter(p => !modifiedNames.has(p.name))

  return {
    added: pureAdded,
    removed: pureRemoved,
    modified,
    hasChanges: pureAdded.length + pureRemoved.length + modified.length > 0,
  }
}

/**
 * 提取 emit 事件变更（Vue 组件）
 */
function extractEmitChanges(hunks) {
  const added = []
  const removed = []

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const content = line.substring(1).trim()

      // defineEmits / $emit / emit()
      const emitPatterns = [
        /defineEmits\s*[<(]\s*\[?\s*['"](\w+)['"]/g,
        /\$emit\s*\(\s*['"](\w+)['"]/g,
        /emit\s*\(\s*['"](\w+)['"]/g,
        /@([\w-]+)\s*=/g, // @eventName="handler" in template
      ]

      for (const pattern of emitPatterns) {
        pattern.lastIndex = 0
        let m
        while ((m = pattern.exec(content)) !== null) {
          if (line.startsWith('+')) added.push(m[1])
          if (line.startsWith('-')) removed.push(m[1])
        }
      }
    }
  }

  return {
    added: [...new Set(added)],
    removed: [...new Set(removed)],
    hasChanges: added.length + removed.length > 0,
  }
}

/**
 * 提取函数签名变更（参数增删）
 */
function extractFunctionSignatureChanges(hunks) {
  const changes = []

  const addedSigs = []
  const removedSigs = []

  const sigPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)/

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const content = line.substring(1).trim()
      const m = content.match(sigPattern)
      if (m) {
        const name = m[1] || m[3]
        const params = m[2] || m[4] || ''
        if (line.startsWith('+')) addedSigs.push({ name, params: params.trim() })
        if (line.startsWith('-')) removedSigs.push({ name, params: params.trim() })
      }
    }
  }

  // 同名函数对比参数变化
  for (const added of addedSigs) {
    const old = removedSigs.find(r => r.name === added.name)
    if (old && old.params !== added.params) {
      changes.push({
        function: added.name,
        from: old.params || '()',
        to: added.params || '()',
      })
    }
  }

  return changes
}

// ============================================================
// 依赖引用关系分析
// ============================================================

/**
 * 分析项目中的依赖引用关系，计算回归影响范围
 *
 * @param {object[]} changedFiles - 变更文件列表 (parseDiffOutput 的 files)
 * @param {object} [options]
 * @param {string} [options.cwd] - 项目根目录
 * @param {string} [options.srcDir] - 源代码目录，默认 'src'
 * @returns {object} 依赖影响分析结果
 */
export function analyzeDependencyImpact(changedFiles, options = {}) {
  const { cwd = process.cwd(), srcDir = 'src' } = options
  const resolvedCwd = resolve(cwd)

  // 变更文件路径集合
  const changedPaths = changedFiles.map(f => f.path)

  console.log('\n🔗 [Dependency] 分析引用关系...')
  console.log('   变更模块: [' + changedPaths.join(', ') + ']')

  // 用 grep 搜索项目中的引用关系
  const affectedFiles = new Map() // path → { importedFrom: [], reasons: Set }

  for (const changedPath of changedPaths) {
    // 从路径中提取可能的引用名称
    const fileName = changedPath.split('/').pop().replace(/\.\w+$/, '')
    const possibleImports = [
      fileName,
      changedPath,
      changedPath.replace(/\.\w+$/, ''),
    ]

    for (const searchTerm of possibleImports) {
      if (searchTerm.length < 3) continue

      try {
        const grepResult = execSync(
          'grep -rn --include="*.vue" --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" "' + searchTerm + '" "' + resolvedCwd + '/' + srcDir + '" 2>/dev/null || true',
          { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
        ).trim()

        if (grepResult) {
          for (const grepLine of grepResult.split('\n')) {
            if (!grepLine.trim()) continue
            const colonIdx = grepLine.indexOf(':')
            if (colonIdx === -1) continue
            const refFile = grepLine.substring(0, colonIdx)
            const lineContent = grepLine.substring(colonIdx + 1)

            // 排除自身引用
            const relativeRef = refFile.replace(resolvedCwd + '/', '')
            if (changedPaths.includes(relativeRef)) continue

            // 确认是 import/require 引用
            if (/import\s|from\s|require\s*\(/.test(lineContent)) {
              if (!affectedFiles.has(relativeRef)) {
                affectedFiles.set(relativeRef, { importedFrom: [], reasons: new Set() })
              }
              const entry = affectedFiles.get(relativeRef)
              if (!entry.importedFrom.includes(changedPath)) {
                entry.importedFrom.push(changedPath)
              }
              entry.reasons.add('引用了 ' + changedPath)
            }
          }
        }
      } catch {
        // grep 失败不影响主流程
      }
    }
  }

  // 转换 Set 为数组
  const impactList = []
  for (const [path, info] of affectedFiles) {
    impactList.push({
      path,
      importedFrom: info.importedFrom,
      reasons: [...info.reasons],
      needRegression: true,
    })
  }

  // 按引用数量排序
  impactList.sort((a, b) => b.importedFrom.length - a.importedFrom.length)

  console.log('   影响范围: ' + impactList.length + ' 个文件需要回归')
  for (const item of impactList.slice(0, 10)) {
    console.log('     📌 ' + item.path + ' ← 因 [' + item.importedFrom.join(', ') + '] 变更')
  }

  return {
    changedModules: changedPaths,
    affectedFiles: impactList,
    regressionScope: impactList.map(f => f.path),
    summary: {
      changedCount: changedPaths.length,
      affectedCount: impactList.length,
      totalRegressionScope: changedPaths.length + impactList.length,
    },
  }
}

// ============================================================
// 核心解析逻辑
// ============================================================

/**
 * 分析 Git Diff，返回结构化的变更信息（v2 增强版）
 *
 * @param {object} [options] - 分析选项
 * @param {string} [options.cwd] - 项目根目录
 * @param {string} [options.base] - 对比基准，默认 'HEAD~1'
 * @param {string} [options.target] - 对比目标，默认 'HEAD'
 * @param {string} [options.diffText] - 直接提供 diff 文本
 * @param {boolean} [options.analyzeDeps] - 是否分析依赖引用关系，默认 false
 * @param {string} [options.srcDir] - 源代码目录，默认 'src'
 * @returns {object} 结构化的变更信息
 */
export function analyzeGitDiff(options = {}) {
  const { cwd = process.cwd(), base = 'HEAD~1', target = 'HEAD', diffText, analyzeDeps = false, srcDir = 'src' } = options

  console.log('\n🔍 [Git Analyzer v2] 正在深度分析代码变更...')

  let diff
  if (diffText) {
    diff = diffText
  } else {
    try {
      diff = execSync('git diff ' + base + ' ' + target, {
        cwd: resolve(cwd),
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      })
    } catch {
      try {
        diff = execSync('git diff --cached', {
          cwd: resolve(cwd),
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        })
      } catch {
        console.warn('⚠️ [Git Analyzer] 无法获取 git diff，返回空结果')
        return emptyResult()
      }
    }
  }

  if (!diff || !diff.trim()) {
    console.log('ℹ️ [Git Analyzer] 没有检测到代码变更')
    return emptyResult()
  }

  const result = parseDiffOutput(diff)

  // 依赖引用关系分析
  if (analyzeDeps && result.files.length > 0) {
    result.dependencyImpact = analyzeDependencyImpact(result.files, { cwd, srcDir })
  }

  // 输出摘要
  console.log('📊 [Git Analyzer v2] 分析完成:')
  console.log('   文件数: ' + result.summary.totalFiles)
  console.log('   新增行: +' + result.summary.totalAdditions)
  console.log('   删除行: -' + result.summary.totalDeletions)
  console.log('   文件分类: ' + Object.entries(result.summary.byCategory).map(function(e) { return e[0] + '(' + e[1] + ')' }).join(', '))
  console.log('   组件: [' + result.components.join(', ') + ']')
  console.log('   函数: [' + result.functions.join(', ') + ']')
  if (result.propsChanges.length > 0) {
    console.log('   Props 变更: ' + result.propsChanges.map(function(p) { return p.component + '(+' + p.added.length + '/-' + p.removed.length + '/~' + p.modified.length + ')' }).join(', '))
  }

  return result
}

function emptyResult() {
  return {
    files: [],
    summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0, byCategory: {} },
    components: [],
    functions: [],
    propsChanges: [],
    dependencyImpact: null,
  }
}

/**
 * 解析 git diff 输出为结构化数据（v2 增强版）
 */
export function parseDiffOutput(diffText) {
  const files = []
  const allFunctions = new Set()
  const allComponents = new Set()
  const allPropsChanges = []
  const categoryCount = {}

  const fileDiffs = diffText.split(/^diff --git /m).filter(Boolean)

  for (const fileDiff of fileDiffs) {
    const fileInfo = parseFileDiff(fileDiff)
    if (fileInfo) {
      files.push(fileInfo)

      fileInfo.functions.forEach(fn => allFunctions.add(fn))
      fileInfo.components.forEach(comp => allComponents.add(comp))

      // 收集分类统计
      categoryCount[fileInfo.category] = (categoryCount[fileInfo.category] || 0) + 1

      // 收集 Props 变更
      if (fileInfo.propsChanges?.hasChanges) {
        allPropsChanges.push({
          component: fileInfo.components[0] || fileInfo.path.split('/').pop().replace(/\.\w+$/, ''),
          file: fileInfo.path,
          ...fileInfo.propsChanges,
        })
      }
    }
  }

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

  return {
    files,
    summary: {
      totalFiles: files.length,
      totalAdditions,
      totalDeletions,
      byCategory: categoryCount,
    },
    components: [...allComponents],
    functions: [...allFunctions],
    propsChanges: allPropsChanges,
    dependencyImpact: null,
  }
}

/**
 * 解析单个文件的 diff（v2 增强版）
 */
function parseFileDiff(fileDiff) {
  const pathMatch = fileDiff.match(/a\/(.+?)\s+b\/(.+?)[\s\n]/)
  if (!pathMatch) return null

  const filePath = pathMatch[2]
  if (isNonCodeFile(filePath)) return null

  let status = 'modified'
  if (fileDiff.includes('new file mode')) status = 'added'
  if (fileDiff.includes('deleted file mode')) status = 'deleted'

  // 文件智能分类
  const { category, impactTags } = classifyFile(filePath)

  const hunks = parseHunks(fileDiff)

  let additions = 0
  let deletions = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
  }

  const functions = extractFunctions(hunks, filePath)
  const components = extractComponents(filePath, hunks)

  // 🆕 Props 变更检测
  const propsChanges = extractPropsChanges(hunks, filePath)
  // 🆕 Emit 事件变更
  const emitChanges = extractEmitChanges(hunks)
  // 🆕 函数签名变更
  const signatureChanges = extractFunctionSignatureChanges(hunks)

  // 🆕 根据内容增强 impactTags
  if (propsChanges.hasChanges) impactTags.push('Props接口变更')
  if (emitChanges.hasChanges) impactTags.push('事件接口变更')
  if (signatureChanges.length > 0) impactTags.push('函数签名变更')

  // 检测状态管理变更
  const diffContent = hunks.map(h => h.lines.join('\n')).join('\n')
  if (/\b(state|setState|useState|ref\s*\(|reactive\s*\(|computed|watch|store|dispatch|commit|mutation|action)\b/.test(diffContent)) {
    if (!impactTags.includes('状态流转')) impactTags.push('状态流转')
  }

  return {
    path: filePath,
    category,
    impactTags: [...new Set(impactTags)],
    status,
    additions,
    deletions,
    hunks: hunks.map(h => ({
      header: h.header,
      startLine: h.startLine,
      lineCount: h.lineCount,
      context: h.context,
    })),
    functions,
    components,
    propsChanges,
    emitChanges,
    signatureChanges,
  }
}

/**
 * 解析 diff 中的 hunks（变更块）
 */
function parseHunks(diffText) {
  const hunks = []
  const lines = diffText.split('\n')
  let currentHunk = null

  for (const line of lines) {
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/)
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk)
      currentHunk = {
        header: line,
        startLine: parseInt(hunkMatch[3]),
        lineCount: parseInt(hunkMatch[4] || '1'),
        context: hunkMatch[5].trim(),
        lines: [],
      }
    } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      currentHunk.lines.push(line)
    }
  }
  if (currentHunk) hunks.push(currentHunk)

  return hunks
}

/**
 * 从 hunks 中提取变更涉及的函数名
 */
function extractFunctions(hunks, filePath) {
  const functions = new Set()
  const ext = filePath.split('.').pop()

  for (const hunk of hunks) {
    if (hunk.context) {
      const fnMatch = hunk.context.match(/(?:function|const|let|var|async\s+function)\s+(\w+)|(\w+)\s*[=(]\s*(?:async\s+)?(?:function|\(|=>)/)
      if (fnMatch) {
        functions.add(fnMatch[1] || fnMatch[2])
      }
    }

    for (const line of hunk.lines) {
      if (!line.startsWith('+') && !line.startsWith('-')) continue
      const content = line.substring(1).trim()

      if (['js', 'ts', 'jsx', 'tsx', 'vue'].includes(ext)) {
        const patterns = [
          /(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
          /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|=>)/,
          /(\w+)\s*\(.*\)\s*\{/,
        ]
        for (const pattern of patterns) {
          const m = content.match(pattern)
          if (m && m[1] && m[1].length > 2) functions.add(m[1])
        }
      }

      if (['py'].includes(ext)) {
        const m = content.match(/def\s+(\w+)/)
        if (m) functions.add(m[1])
      }
    }
  }

  return [...functions]
}

/**
 * 从文件路径和变更内容中提取组件名
 */
function extractComponents(filePath, hunks) {
  const components = new Set()

  const pathParts = filePath.split('/')
  const fileName = pathParts[pathParts.length - 1]
  const ext = fileName.split('.').pop()

  if (['vue', 'jsx', 'tsx'].includes(ext)) {
    const name = fileName.replace(/\.\w+$/, '')
    if (name && name[0] === name[0].toUpperCase()) {
      components.add(name)
    }
  }

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const content = line.substring(1)
      const importMatch = content.match(/import\s+(\w+).*from\s+['"].*\/(\w+)['"]/)
      if (importMatch && importMatch[1][0] === importMatch[1][0].toUpperCase()) {
        components.add(importMatch[1])
      }
      const tagMatch = content.match(/<([A-Z]\w+)/)
      if (tagMatch) {
        components.add(tagMatch[1])
      }
    }
  }

  return [...components]
}

/**
 * 判断是否为非代码文件
 */
function isNonCodeFile(filePath) {
  const nonCodeExtensions = ['.md', '.txt', '.json', '.yaml', '.yml', '.lock', '.png', '.jpg', '.svg', '.ico', '.gif', '.woff', '.ttf', '.eot']
  const nonCodeDirs = ['node_modules/', '.git/', 'dist/', 'build/', '.cache/']

  if (nonCodeDirs.some(dir => filePath.includes(dir))) return true
  if (nonCodeExtensions.some(ext => filePath.endsWith(ext))) return true
  return false
}

// ============================================================
// 格式化输出（LLM 可读）
// ============================================================

/**
 * 将分析结果格式化为 LLM 可读的上下文文本（v2 增强版）
 */
export function formatDiffContext(analysis) {
  if (analysis.files.length === 0) {
    return '没有检测到代码变更。'
  }

  const lines = []

  // ---- 总览 ----
  lines.push('## 代码变更摘要')
  lines.push('- 变更文件数: ' + analysis.summary.totalFiles)
  lines.push('- 新增: +' + analysis.summary.totalAdditions + ' 行, 删除: -' + analysis.summary.totalDeletions + ' 行')

  if (analysis.components.length > 0) {
    lines.push('- 涉及组件: ' + analysis.components.join(', '))
  }
  if (analysis.functions.length > 0) {
    lines.push('- 涉及函数: ' + analysis.functions.join(', '))
  }

  // ---- 文件分类摘要 ----
  if (analysis.summary.byCategory && Object.keys(analysis.summary.byCategory).length > 0) {
    lines.push('')
    lines.push('## 文件分类分析')
    const categoryDescriptions = {
      style: '🎨 样式文件 — 重点关注 UI 兼容性、响应式布局、视觉回归',
      component: '🧩 组件文件 — 重点关注组件功能、交互行为、Props 接口',
      state: '🔄 状态管理 — 重点关注状态流转、数据一致性、副作用',
      router: '🔀 路由配置 — 重点关注页面跳转、路由守卫、权限控制',
      api: '🌐 API 层 — 重点关注接口调用、数据格式、错误处理',
      util: '🔧 工具函数 — 重点关注下游回归，所有调用方需验证',
      hook: '🪝 Hook/Composable — 重点关注组合逻辑、状态共享',
      config: '⚙️ 配置文件 — 重点关注全局影响范围',
      type: '�� 类型定义 — 重点关注接口契约变更',
      logic: '📋 业务逻辑 — 重点关注数据处理、业务规则',
      template: '📄 模板文件 — 重点关注页面结构、可访问性',
      test: '🧪 测试文件 — 测试变更',
    }

    for (const [cat, count] of Object.entries(analysis.summary.byCategory)) {
      const desc = categoryDescriptions[cat] || ('📁 ' + cat)
      lines.push('- ' + desc + ': ' + count + ' 个文件')
    }

    // 按分类给出测试建议
    lines.push('')
    lines.push('### 测试策略建议')
    const categories = Object.keys(analysis.summary.byCategory)
    if (categories.includes('style')) {
      lines.push('- ⚠️ 包含样式变更: 需要进行视觉回归测试，检查不同浏览器/设备下的 UI 一致性')
    }
    if (categories.includes('state') || categories.includes('hook')) {
      lines.push('- ⚠️ 包含状态/逻辑变更: 需要关注状态流转正确性，验证数据在各组件间的一致性')
    }
    if (categories.includes('util')) {
      lines.push('- ⚠️ 包含工具函数变更: 需要回归所有引用该函数的组件')
    }
    if (categories.includes('api')) {
      lines.push('- ⚠️ 包含 API 层变更: 需要验证接口调用、响应处理、错误码处理')
    }
  }

  // ---- Props 变更清单 ----
  if (analysis.propsChanges.length > 0) {
    lines.push('')
    lines.push('## Props/接口变更清单')
    lines.push('> ⚠️ Props 变更必须生成对应的测试用例')
    lines.push('')

    for (const pc of analysis.propsChanges) {
      lines.push('### ' + pc.component + ' (' + pc.file + ')')
      if (pc.added.length > 0) {
        lines.push('**新增 Props:**')
        for (const p of pc.added) {
          lines.push('- `' + p.name + '`: ' + p.type + (p.source === 'template' ? ' (模板绑定)' : '') + ' → 需要测试该 prop 的功能和边界值')
        }
      }
      if (pc.removed.length > 0) {
        lines.push('**删除 Props:**')
        for (const p of pc.removed) {
          lines.push('- `' + p.name + '`: ' + p.type + ' → 需要验证移除后的兼容性')
        }
      }
      if (pc.modified.length > 0) {
        lines.push('**修改 Props:**')
        for (const p of pc.modified) {
          lines.push('- `' + p.name + '`: ' + p.from + ' → ' + p.to + ' → 需要验证类型变更的兼容性')
        }
      }
      lines.push('')
    }
  }

  // ---- 文件详情 ----
  lines.push('## 变更文件详情')
  for (const file of analysis.files) {
    const tags = file.impactTags?.length > 0 ? (' [' + file.impactTags.join(', ') + ']') : ''
    lines.push('### ' + file.path + ' (' + file.category + ', ' + file.status + ', +' + file.additions + '/-' + file.deletions + ')' + tags)

    if (file.functions.length > 0) {
      lines.push('变更函数: ' + file.functions.join(', '))
    }
    if (file.components.length > 0) {
      lines.push('涉及组件: ' + file.components.join(', '))
    }
    if (file.emitChanges?.hasChanges) {
      if (file.emitChanges.added.length > 0) lines.push('新增事件: ' + file.emitChanges.added.join(', '))
      if (file.emitChanges.removed.length > 0) lines.push('删除事件: ' + file.emitChanges.removed.join(', '))
    }
    if (file.signatureChanges?.length > 0) {
      for (const sc of file.signatureChanges) {
        lines.push('函数签名变更: ' + sc.function + '(' + sc.from + ') → ' + sc.function + '(' + sc.to + ')')
      }
    }

    for (const hunk of file.hunks) {
      if (hunk.context) {
        lines.push('变更位置: ' + hunk.context + ' (行 ' + hunk.startLine + ')')
      }
    }
    lines.push('')
  }

  // ---- 依赖影响范围 ----
  if (analysis.dependencyImpact && analysis.dependencyImpact.affectedFiles.length > 0) {
    lines.push('## 依赖影响范围（回归清单）')
    lines.push('> 以下文件引用了变更模块，需要回归测试')
    lines.push('')
    lines.push('| 受影响文件 | 引用的变更模块 | 回归原因 |')
    lines.push('| --- | --- | --- |')
    for (const item of analysis.dependencyImpact.affectedFiles) {
      lines.push('| ' + item.path + ' | ' + item.importedFrom.join(', ') + ' | ' + item.reasons.join('; ') + ' |')
    }
    lines.push('')
    lines.push('**回归范围**: ' + analysis.dependencyImpact.summary.totalRegressionScope + ' 个文件 (直接变更 ' + analysis.dependencyImpact.summary.changedCount + ' + 间接影响 ' + analysis.dependencyImpact.summary.affectedCount + ')')
  }

  return lines.join('\n')
}
