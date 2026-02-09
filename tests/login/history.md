# 登录测试验证记录

## 测试概述

使用 MVP 工作流引擎（LLM 解析 + 混合适配器 + 指令缓存）实现登录功能的全流程自动化测试。

- **目标页面**: http://bianji.ai-editor.chat/login
- **测试场景**: 输入用户名/密码 → 点击登录 → 等待主页加载 → 验证页面内容
- **凭据存储**: `.env.local` 文件（`LOGIN_URL` / `LOGIN_USERNAME` / `LOGIN_PASSWORD`）

---

## 改造说明

### 原有实现（手动 Playwright）

原 `login.spec.js` 采用硬编码的 Playwright 操作：

- 手动 `page.goto()` + `waitForLoadState('networkidle')`
- 手动 `page.locator('input[type="text"]').fill()` / `input[type="password"]`
- 手动 `ai('点击登录按钮')` 调用 Zerostep
- 手动 `page.locator('main').waitFor()` + `page.content().includes()`
- URL 硬编码在代码中，凭据也硬编码

### 新实现（MVP 工作流引擎驱动）

改用 `runWorkflow()` 一行调用完成全流程：

- 自然语言 prompt 描述完整登录流程
- LLM 自动解析为 6 步指令流（navigate → input × 2 → click → wait → verify）
- 混合适配器自动选择 Playwright 优先 / AI 兜底策略
- 指令缓存机制：首次 LLM 解析后缓存，后续直接复用
- 凭据从 `.env.local` 读取，不在代码中暴露

---

## 验证记录

### 第 1 轮：首次运行（错误 URL）

- **时间**: 2026-02-09
- **状态**: ❌ 失败
- **问题**: `.env.local` 中 `LOGIN_URL` 配置为 `https://client.hexinedu.com/`，该地址会重定向到 `signin.html#/`，但页面是 SPA，input 元素在 networkidle 后仍未渲染
- **表现**: `input[type='text']` 等待超时 → AI 兜底也报 `No valid target found`
- **根因**: URL 错误，应为 `http://bianji.ai-editor.chat/login`
- **解决**: 用户修正了 `.env.local` 中的 `LOGIN_URL`

### 第 2 轮：修正 URL 后首次运行

- **时间**: 2026-02-09
- **状态**: ✅ 通过（6/6 步骤成功）
- **耗时**: 19953ms（19.9s）
- **执行详情**:
  1. ✅ [navigate] 打开登录页面 - 预执行跳过 (0ms)
  2. ✅ [input] 输入用户名 - Playwright `input[type='text']` 成功 (102ms)
  3. ✅ [input] 输入密码 - Playwright `input[type='password']` 成功 (13ms)
  4. ✅ [click] 点击登录按钮 - Playwright `button[type='submit']` 失败 → **AI 兜底成功** (10171ms)
  5. ✅ [wait] 等待 main 元素出现 - Playwright 成功 (1803ms)
  6. ✅ [verify] 验证包含 "SigmaAI 智能编辑控制台" - Playwright 关键词检测成功 (5ms)
- **发现的问题**: LLM 生成的按钮选择器 `button[type='submit']` 不正确（该网站的登录按钮是 `button[type='button']`，使用 Element UI 组件），导致 click 降级到 AI（耗时 10s）

### 第 3 轮：优化 click 选择器

- **时间**: 2026-02-09
- **状态**: ✅ 通过（6/6 步骤成功）
- **优化措施**: 通过 DOM 探查发现登录按钮的真实结构为 `<button class="el-button ...">`，手动修正缓存中的 `fallback_selector` 为 `button.el-button`
- **耗时**: **4349ms → 1753ms**（缓存模式，2 次运行）
- **执行详情**:
  1. ✅ [navigate] 预执行跳过 (0ms)
  2. ✅ [input] 用户名 - Playwright 成功 (163ms)
  3. ✅ [input] 密码 - Playwright 成功 (47ms)
  4. ✅ [click] 登录按钮 - **Playwright `button.el-button` 成功** (42ms) ← 原先 AI 10s
  5. ✅ [wait] main 元素 - Playwright 成功 (845ms)
  6. ✅ [verify] 页面验证 - Playwright 关键词检测成功 (12ms)

---

## 适配器改进

在登录测试的调试过程中，对 `api/adapter.js` 做了以下通用改进：

### 1. handleInput 增加 SPA 渲染等待

**问题**: 原实现使用 `locator.count()` 检查元素是否存在，但 SPA 页面在 `domcontentloaded` 时元素可能尚未渲染，`count()` 返回 0 就直接跳到 AI 兜底。

**修复**: 改用 `locator.waitFor({ state: 'attached', timeout: 10000 })` 等待元素挂载到 DOM。

```javascript
// 修复前
const exists = await locator.count().catch(() => 0)
if (exists > 0) { ... }

// 修复后
await locator.waitFor({ state: 'attached', timeout: 10000 })
// 元素已挂载，再判断可见性
```

### 2. handleClick 增加 SPA 渲染等待

同样在 click 操作前增加 `waitFor({ state: 'attached', timeout: 5000 })` 等待。

---

## 性能对比

| 指标        | 原手动测试   | MVP 首次运行   | MVP 缓存模式   |
| ----------- | ------------ | -------------- | -------------- |
| 总耗时      | ~15s         | 19.9s          | **1.7-4.3s**   |
| AI 调用次数 | 1 次 (click) | 1 次 (click)   | **0 次**       |
| 代码行数    | ~40 行       | ~15 行         | ~15 行         |
| 可维护性    | 需改代码     | 改 prompt 即可 | 改 prompt 即可 |

---

## 关键经验

1. **SPA 页面需要等待渲染** — `domcontentloaded` 事件不代表 SPA 组件已渲染，交互前需要 `waitFor` 等待元素挂载
2. **LLM 生成的按钮选择器不可靠** — LLM 猜测 `button[type='submit']` 但实际是 `button[type='button']`（Element UI 组件），需要 DOM 探查后手动修正缓存
3. **指令缓存可手动微调** — 缓存的 JSON 文件可以手动编辑修正选择器，相当于"半自动"模式
4. **凭据应从环境变量读取** — 将 URL、用户名、密码存储在 `.env.local` 中，避免在代码和 prompt 中硬编码
