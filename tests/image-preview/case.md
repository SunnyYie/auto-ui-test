# 图片预览组件测试用例

## 背景

- **目标项目**: maimai-community-pc（脉脉社区 PC 端）
- **需求分支**: feat/image_preview
- **核心变更**: 图片预览组件从 `viewerjs` 迁移到 `yet-another-react-lightbox`
- **新增 Hook**: `useLightboxViewer` — 返回 `{ show, LightboxComponent }`

## 架构集成

本测试文件已集成项目统一架构：**ZeroStep AI + Playwright 混合策略**。

### 架构模式

```text
utils/fixture.js (aiFixture + stealth)
        ↓ 提供 { page, ai }
adapter.js (executeInstruction)
        ↓ 混合策略执行
Playwright 优先 ←→ ZeroStep AI 兜底
```

### 分层策略

| 操作类型                 | 执行方式                        | 说明                                           |
| ------------------------ | ------------------------------- | ---------------------------------------------- |
| 页面导航                 | adapter → `handleNavigate`      | Playwright `page.goto()`                       |
| 元素点击（缩略图/按钮）  | adapter → `handleClick`         | Playwright 选择器优先，AI 兜底                 |
| 文本验证                 | adapter → `handleVerify`        | 关键词提取 + Playwright 原生检测，AI 兜底      |
| CSS 样式断言             | Playwright 原生 `evaluate()`    | AI 无法检查 `computedStyle`，必须用 Playwright |
| DOM 状态断言             | Playwright 原生 `expect()`      | 精确属性/样式检查                              |
| 坐标操作                 | Playwright 原生 `mouse.click()` | 如 TC-7 点击背景区域                           |
| DOM 查询（gallery 计数） | Playwright 原生 `evaluate()`    | 复杂 DOM 遍历查询                              |

### CDN ORB 修复

CDN 图片 (`i9.taou.com`) 在 Playwright Chromium 中会被 ORB 策略阻止。通过扩展 fixture 的 page，追加 `page.route()` 拦截并修复响应头：

- 设置 `Content-Type: image/jpeg`
- 添加 `Access-Control-Allow-Origin: *`

### Fixture 扩展模式

```javascript
import { test as baseTest } from '../../utils/fixture.js'

// 在 AI fixture 基础上扩展 CDN 路由拦截
const test = baseTest.extend({
  page: async ({ page }, use) => {
    await page.route('**/i9.taou.com/**', async route => { ... })
    await use(page)
  },
})
```

## 测试入口

- 首页推荐页: `http://localhost:3000/home/recommended`
- 页面包含多个 Feed 卡片，部分卡片带有图片缩略图（ImageGallery 组件）
- 图片缩略图选择器: `div.size-32.cursor-pointer[role="button"]`

## 测试场景

### TC-1: 点击图片打开 Lightbox

- **步骤**: 通过适配器点击第一张图片缩略图（Playwright 优先 + AI 兜底）
- **预期**: Lightbox 浮层出现（`.yarl__portal` + `position: fixed`）
- **验证**: `.yarl__container` 存在，通过适配器验证 Close 按钮存在

### TC-2: 多图切换 — 上一张/下一张

- **前提**: 点击含多张图片的 Feed 中某张图
- **步骤**: 通过适配器点击下一张按钮 (`.yarl__navigation_next`)
- **预期**: 图片切换，计数器更新
- **步骤**: 通过适配器点击上一张按钮 (`.yarl__navigation_prev`)
- **预期**: 图片切回

### TC-3: 关闭 Lightbox

- **步骤**: 通过适配器点击关闭按钮（`.yarl__toolbar button[title="Close"]`）
- **预期**: Lightbox 浮层消失，页面恢复正常

### TC-4: 重置按钮

- **步骤**: 打开 Lightbox → 通过适配器点击重置按钮（toolbar 中带旋转箭头 SVG 的按钮）
- **预期**: 图片缩放回原始大小，Lightbox 保持打开

### TC-5: 单图模式 — 无导航按钮

- **前提**: 找到只有 1 张图片的 Feed
- **步骤**: 点击该图片打开 Lightbox
- **预期**: 没有上一张/下一张按钮，没有计数器

### TC-6: Mac 手势防护样式（Playwright 原生断言）

- **步骤**: 打开 Lightbox
- **验证**: 容器 `computedStyle` 包含 `overscroll-behavior: none` 和 `touch-action: none`
- **说明**: CSS 计算样式断言必须使用 Playwright `evaluate()` — AI 无法检查 computedStyle
- **目的**: 防止触控板滑动触发浏览器前进/后退

### TC-7: 点击背景关闭

- **步骤**: 打开 Lightbox → 使用 Playwright `mouse.click()` 点击图片外的暗色背景区域
- **预期**: Lightbox 关闭（`closeOnBackdropClick: true`）
- **说明**: 坐标点击操作必须使用 Playwright 原生 API

### TC-8: Lightbox 打开时锁定滚动，关闭后恢复（Playwright 原生断言）

- **步骤**: 打开 Lightbox → 检查 body 样式 → 通过适配器关闭 → 检查样式恢复
- **验证**: `body.style.position` / `body.style.width` / `body.style.top` 的变化与恢复
- **说明**: DOM 样式断言必须使用 Playwright `evaluate()`

## 关键选择器

| 元素          | 选择器                                                         |
| ------------- | -------------------------------------------------------------- |
| 图片缩略图    | `div.size-32.cursor-pointer[role="button"]`                    |
| Lightbox 根   | `.yarl__portal`                                                |
| Lightbox 容器 | `.yarl__container`                                             |
| 上一张按钮    | `.yarl__navigation_prev`                                       |
| 下一张按钮    | `.yarl__navigation_next`                                       |
| 关闭按钮      | `.yarl__toolbar button[title="Close"]`                         |
| 重置按钮      | `.yarl__toolbar button[title="重置"]`                          |
| 计数器        | `.yarl__counter` (Counter 插件)                                |
| 当前图片      | `.yarl__slide_image`                                           |
| 轮播容器      | `.yarl__carousel`                                              |
| 固定定位容器  | `body > div[style*="position: fixed"][style*="z-index: 9999"]` |
