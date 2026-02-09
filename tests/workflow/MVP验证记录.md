# MVP 验证记录

## 项目概述

本文档记录 AI 驱动的 Web UI 自动化工作流 MVP 的验证过程、遇到的问题及解决方案。

## 架构说明

MVP 实现了三层架构：

1. **解析与规划层 (LLM Planner)** - `api/llm-client.js`: 调用大模型将自然语言转换为统一指令流
2. **适配层 (Adapter)** - `api/adapter.js`: 混合策略执行指令（Zerostep AI 优先 + Playwright 兜底）
3. **执行层 (Runtime)** - Playwright + Zerostep 实际操作浏览器

辅助模块：

- `api/schema.js`: 统一指令流格式定义与校验
- `api/workflow.js`: 工作流引擎，串联各模块

## 验证场景

百度搜索 "Playwright" 的端到端工作流。

---

## 验证记录

### 第 1 轮验证

- **时间**: 2026-02-09
- **状态**: ❌ 失败
- **问题**: LLM API 调用返回 `{"error":"account is invalid"}`，HTTP 400 错误
- **原因分析**: `api/llm-client.js` 中使用了 `x-api-key` header 进行认证，但代理接口要求使用 `Authorization: Bearer` 方式认证
- **解决方案**: 将请求头从 `'x-api-key': authToken` 改为 `'Authorization': \`Bearer ${authToken}\``
- **修改文件**: `api/llm-client.js`

### 第 2 轮验证

- **时间**: 2026-02-09
- **状态**: ❌ 部分失败 (4/6 步骤通过)
- **问题**: 步骤 5 (等待搜索结果加载) 失败 - `strict mode violation: locator('.result.c-container') resolved to 5 elements`
- **原因分析**: Playwright 的 strict mode 下，`waitFor()` 要求选择器只匹配一个元素，但百度搜索结果中 `.result.c-container` 匹配到了 5 个结果项
- **解决方案**: 在 `handleWait` 函数中对 `page.locator(selector)` 添加 `.first()` 调用，确保只等待第一个匹配元素
- **修改文件**: `api/adapter.js`

### 第 3 轮验证

- **时间**: 2026-02-09
- **状态**: ❌ 部分失败 (4/6 步骤通过)
- **问题**: 步骤 5 (等待搜索结果加载) 失败 - LLM 生成了错误的 CSS 选择器 `.content-left`（实际应为 `#content_left`）
- **原因分析**: LLM 生成的 `fallback_selector` 不可靠，容易猜错网站的 DOM 结构。且 `wait` 指令同时包含 `selector` 和 `condition` 时，`selector` 优先级更高，导致使用了错误的选择器而没有回退
- **解决方案**: 改进 `handleWait` 函数的容错机制 —— 当 selector 等待超时时，不直接抛出异常，而是回退到 `waitForLoadState('networkidle')` + 固定等待时间的组合策略
- **修改文件**: `api/adapter.js`
- **设计启示**: 这体现了混合策略中 "兜底机制" 的重要性，LLM 生成的选择器不应该成为单点故障

### 第 4 轮验证

- **时间**: 2026-02-09
- **状态**: ✅ 全部通过 (6/6 步骤)
- **耗时**: 37.2s（其中 LLM 解析约 5s，AI 操作约 20s，等待和导航约 12s）
- **执行详情**:
  1. ✅ [navigate] 打开百度首页 - 1198ms
  2. ✅ [wait] 等待百度首页加载 - 2008ms
  3. ✅ [input] 在搜索框中输入 'Playwright' - AI 成功定位 - 耗时较长
  4. ✅ [click] 点击'百度一下'搜索按钮 - AI 成功定位 - 4077ms
  5. ✅ [wait] 等待搜索结果加载完成 - 选择器 `.result.c-container` 这次正确匹配 - 790ms
  6. ✅ [verify] 验证搜索结果包含 'Playwright' - AI 返回 true - 5706ms

---

## 关键经验总结

### 1. API 认证方式需实际测试

代理接口的认证方式可能与标准 API 不同，不能想当然使用 `x-api-key`，需要通过 curl 等工具实际测试确认。

### 2. Playwright strict mode 处理

Playwright 默认启用 strict mode，选择器匹配多个元素时会报错。对于 `wait` 类操作，应使用 `.first()` 或 `.nth(0)` 确保只操作一个元素。

### 3. LLM 生成选择器不可靠

LLM 猜测的 CSS 选择器（如 `.content-left` vs `#content_left`）容易出错，这也是架构设计中 "AI 优先 + Playwright 兜底" 策略的核心价值所在。同时 wait 等操作需要额外的容错回退机制。

### 4. 混合策略的价值

在 MVP 验证中，Zerostep AI 成功处理了 input 和 click 的语义定位，证明了 AI 在元素定位方面的优势。而 navigate、wait、press 等确定性操作直接使用 Playwright 更高效稳定。

---

## 性能优化记录

### 第 5 轮优化：Playwright 优先策略

- **时间**: 2026-02-09
- **问题**: 第 4 轮验证耗时 37.2s，目标是优化到 10s 以内
- **优化措施**:
  - 将策略从 "AI 优先 + Playwright 兜底" 改为 "Playwright 优先 + AI 兜底"
  - 减少 stepDelay 从 1000ms 到 0
  - navigate 使用 `domcontentloaded` 而非 `networkidle`
  - verify 增加关键词提取，用 Playwright 原生文本检测代替 AI
  - LLM prompt 增加规则：不要在 navigate 后生成多余 wait 步骤
- **结果**: 35s → 20-30s（Zerostep AI 调用仍然是瓶颈，每次 4-8s）
- **结论**: 外部服务延迟无法通过策略调整消除

### 第 6 轮优化：DOM 强制操作 + 指令缓存 + 并行导航

- **时间**: 2026-02-09
- **核心洞察**: 百度的 `#kw` 和 `#su` 元素虽然 Playwright 的 `isVisible()` 检测为 false，但 DOM 中实际存在。可以用 `page.evaluate()` 直接操作 DOM，完全绕过可见性检查，彻底消除 Zerostep AI 调用
- **优化措施**:
  1. **DOM 强制操作** — `handleInput` 中对不可见但存在的元素，使用 JS 直接 `focus()` + 设置 `value` + `dispatchEvent('input')`；`handleClick` 中使用 `dispatchEvent('click')` 替代 Zerostep AI
  2. **指令流缓存** — 首次 LLM 解析结果缓存到 `.cache/` 目录的 JSON 文件（基于 prompt 的 MD5 哈希），后续运行直接读取缓存跳过 LLM 调用
  3. **LLM + 导航并行** — 首次运行时从 prompt 中提取 URL，`Promise.all` 同时执行 LLM 解析和 `page.goto()`
  4. **快速 wait 回退** — 将 wait 超时回退从 `networkidle` 改为 `domcontentloaded` + 500ms 固定等待
- **修改文件**: `api/adapter.js`、`api/workflow.js`、`api/llm-client.js`
- **结果**:
  - 首次运行（含 LLM 调用）: **7.1s** ✅
  - 缓存运行（跳过 LLM）: **4.3-5.8s** ✅
  - 目标 10s 达成

### 性能对比总表

| 阶段                | 耗时         | 关键变化                            |
| ------------------- | ------------ | ----------------------------------- |
| 第 4 轮（基准）     | 37.2s        | Zerostep AI 执行 input/click/verify |
| 第 5 轮（策略切换） | 20-30s       | Playwright 优先，减少延迟和等待     |
| 第 6 轮（缓存模式） | **4.3-5.8s** | DOM 强制操作 + 指令缓存             |
| 第 6 轮（首次运行） | **7.1s**     | LLM + 导航并行                      |

### 各步骤耗时对比（第 4 轮 vs 第 6 轮缓存模式）

| 步骤     | 第 4 轮      | 第 6 轮      | 优化方式                   |
| -------- | ------------ | ------------ | -------------------------- |
| LLM 解析 | ~5000ms      | **0ms**      | 指令缓存                   |
| navigate | 1198ms       | **0ms**      | 预执行跳过                 |
| input    | ~8000ms (AI) | **25-42ms**  | JS DOM 操作                |
| click    | 4077ms (AI)  | **25-162ms** | dispatchEvent / Playwright |
| wait     | 790ms        | 3510ms       | LLM 选择器不对，回退处理   |
| verify   | 5706ms (AI)  | **60-68ms**  | 关键词提取                 |

### 优化经验总结

1. **消除外部 AI 调用是最大收益点** — Zerostep AI 每次调用 4-8s，消除 2 次调用直接节省 ~12s
2. **DOM 强制操作的妙用** — 即使元素不可见，只要 DOM 中存在就可以用 `evaluate()` 直接操作
3. **指令缓存实现"预编译"** — 相当于将 LLM 解析从运行时移到编写时，节省 ~5s
4. **并行化是通用优化手段** — LLM 解析和页面导航没有依赖关系，可以并行执行
5. **快速失败 + 快速回退** — wait 的超时时间应尽可能短，回退策略应轻量
