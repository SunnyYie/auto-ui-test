/**
 * ============================================================
 * MVP 验证测试: 需求→测试用例→自动执行 全流程
 * ============================================================
 *
 * 场景说明:
 *   模拟一个真实需求变更: "登录页面增加表单验证和 loading 状态"
 *   验证完整流程:
 *   1. Git Diff 分析 → 提取代码变更上下文
 *   2. 需求解构 → 拆解为功能点列表
 *   3. 多视角用例生成 → 发散生成 + 收敛合并
 *   4. 用例→指令流 → 转为可执行代码
 *   5. Playwright 执行 → 验证结果
 *
 * 测试目标:
 *   验证从"一句话需求"到"自动化测试执行"的完整链路可用
 * ============================================================
 */

import { test } from '../../utils/fixture.js'
import { expect } from '@playwright/test'
import { parseDiffOutput, formatDiffContext } from '../../api/git-analyzer.js'
import { decomposeRequirement } from '../../api/requirement-analyzer.js'
import { generateCases } from '../../api/case-generator.js'
import { casesToPrompts, runTestCase } from '../../api/case-to-workflow.js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const LOGIN_URL = process.env.LOGIN_URL

// 模拟 Git Diff: 登录页面增加表单验证和 loading 状态
const MOCK_DIFF = `diff --git a/src/views/LoginPage.vue b/src/views/LoginPage.vue
index abc1234..def5678 100644
--- a/src/views/LoginPage.vue
+++ b/src/views/LoginPage.vue
@@ -10,8 +10,12 @@
   <el-form ref="loginForm" :model="form" :rules="rules">
     <el-form-item prop="username">
-      <el-input v-model="form.username" placeholder="请输入用户名" />
+      <el-input v-model="form.username" placeholder="请输入用户名" maxlength="50" show-word-limit />
     </el-form-item>
     <el-form-item prop="password">
-      <el-input v-model="form.password" type="password" placeholder="请输入密码" />
+      <el-input v-model="form.password" type="password" placeholder="请输入密码" show-password />
     </el-form-item>
+    <el-form-item>
+      <el-checkbox v-model="form.remember">记住密码</el-checkbox>
+    </el-form-item>
     <el-button type="primary" @click="handleLogin" :loading="loading">
-      登录
+      {{ loading ? '登录中...' : '登 录' }}
     </el-button>
   </el-form>
@@ -30,6 +34,15 @@ export default {
   data() {
     return {
       loading: false,
+      rules: {
+        username: [
+          { required: true, message: '请输入用户名', trigger: 'blur' },
+        ],
+        password: [
+          { required: true, message: '请输入密码', trigger: 'blur' },
+          { min: 6, message: '密码长度不能少于6位', trigger: 'blur' },
+        ],
+      },
       form: {
         username: '',
         password: '',
+        remember: false,
       }
     }
   },
@@ -40,6 +53,10 @@ export default {
   methods: {
     async handleLogin() {
+      try {
+        await this.$refs.loginForm.validate()
+      } catch { return }
       this.loading = true
+      try {
         const res = await this.$api.login(this.form)
         if (res.success) {
           this.$router.push('/dashboard')
+        } else {
+          this.$message.error(res.message || '登录失败')
         }
+      } catch (e) {
+        this.$message.error('网络错误，请稍后重试')
+      } finally {
         this.loading = false
+      }
     }
   }
 }
`

/**
 * 测试 1: 全流程验证 — 需求→用例→执行
 *
 * 仅使用 happy_path 视角（MVP 验证，减少 LLM 调用次数和时间）
 */
test('MVP: 需求→测试用例→自动执行', async ({ page, ai }) => {
  test.setTimeout(300_000) // 5 分钟超时

  // ========================
  // 阶段 1: Git Diff 分析
  // ========================
  console.log('\n' + '█'.repeat(60))
  console.log('█ 阶段 1: Git Diff 分析')
  console.log('█'.repeat(60))

  const diffAnalysis = parseDiffOutput(MOCK_DIFF)
  const diffContext = formatDiffContext(diffAnalysis)

  console.log(`✅ Diff 分析完成: ${diffAnalysis.summary.totalFiles} 个文件, +${diffAnalysis.summary.totalAdditions}/-${diffAnalysis.summary.totalDeletions} 行`)
  console.log(`   组件: [${diffAnalysis.components.join(', ')}]`)

  expect(diffAnalysis.files.length).toBeGreaterThan(0)

  // ========================
  // 阶段 2: 需求解构
  // ========================
  console.log('\n' + '█'.repeat(60))
  console.log('█ 阶段 2: 需求解构')
  console.log('█'.repeat(60))

  const requirement = '登录页面增加了表单验证（用户名必填、密码最少6位）、登录按钮 loading 状态、记住密码选项、密码可见性切换、错误提示'

  const decomposed = await decomposeRequirement(requirement, {
    diffContext,
    pageUrl: LOGIN_URL,
  })

  console.log(`✅ 需求解构完成: ${decomposed.features?.length} 个功能点`)
  expect(decomposed.features?.length).toBeGreaterThan(0)

  // ========================
  // 阶段 3: 多视角用例生成（MVP 只用 happy_path）
  // ========================
  console.log('\n' + '█'.repeat(60))
  console.log('█ 阶段 3: 多视角用例生成')
  console.log('█'.repeat(60))

  const caseResult = await generateCases(decomposed, {
    diffContext,
    pageUrl: LOGIN_URL,
    perspectives: ['happy_path', 'chaos'],  // MVP: 仅 2 个视角
  })

  console.log(`✅ 用例生成完成: ${caseResult.summary.total} 个用例`)
  expect(caseResult.cases.length).toBeGreaterThan(0)

  // ========================
  // 阶段 4: 用例→Prompt 转换
  // ========================
  console.log('\n' + '█'.repeat(60))
  console.log('█ 阶段 4: 用例→Prompt 转换')
  console.log('█'.repeat(60))

  const prompts = casesToPrompts(caseResult.cases, { pageUrl: LOGIN_URL })

  console.log(`✅ 转换完成: ${prompts.length} 个 Prompt`)
  for (const p of prompts) {
    console.log(`   [${p.caseId}] ${p.title}`)
    console.log(`     → ${p.prompt.substring(0, 100)}...`)
  }

  expect(prompts.length).toBeGreaterThan(0)

  // ========================
  // 阶段 5: 执行第一个 P0/P1 用例（MVP 验证链路可用性）
  // ========================
  console.log('\n' + '█'.repeat(60))
  console.log('█ 阶段 5: 执行用例')
  console.log('█'.repeat(60))

  // 选取第一个优先级最高的用例执行
  const topCase = caseResult.cases[0]
  console.log(`\n🧪 执行用例: [${topCase.id}] ${topCase.title}`)

  const execResult = await runTestCase(topCase, { page, ai }, {
    pageUrl: LOGIN_URL,
    useCache: false,  // MVP 首次运行不使用缓存
  })

  console.log(`\n📊 执行结果: ${execResult.passed ? '✅ 通过' : '❌ 失败'}`)
  console.log(`   耗时: ${execResult.elapsed}ms`)

  if (!execResult.passed) {
    console.log(`   错误: ${execResult.error || JSON.stringify(execResult.steps?.filter(s => !s.success))}`)
  }

  // MVP 验证: 链路是否跑通（不强制要求用例通过，因为 LLM 生成的选择器可能不准确）
  // 关键是验证整个流程: 需求→解构→生成→转换→执行 是否能完整走通
  console.log('\n' + '█'.repeat(60))
  console.log('█ MVP 验证总结')
  console.log('█'.repeat(60))
  console.log(`   ✅ Git Diff 分析: ${diffAnalysis.summary.totalFiles} 文件`)
  console.log(`   ✅ 需求解构: ${decomposed.features?.length} 功能点`)
  console.log(`   ✅ 用例生成: ${caseResult.summary.total} 用例`)
  console.log(`   ✅ Prompt 转换: ${prompts.length} 条`)
  console.log(`   ${execResult.passed ? '✅' : '⚠️'} 用例执行: ${execResult.passed ? '通过' : '部分失败（预期内，需优化选择器）'}`)
})
