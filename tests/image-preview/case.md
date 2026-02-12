# 图片预览组件测试用例

## 背景

- **目标项目**: maimai-community-pc（脉脉社区 PC 端）
- **需求分支**: feat/image_preview
- **核心变更**: 图片预览组件从 `viewerjs` 迁移到 `yet-another-react-lightbox`
- **新增 Hook**: `useLightboxViewer` — 返回 `{ show, LightboxComponent }`

## 测试入口

- 首页推荐页: `http://localhost:3000/home/recommended`
- 页面包含多个 Feed 卡片，部分卡片带有图片缩略图（ImageGallery 组件）
- 图片缩略图选择器: `div.relative.size-32.cursor-pointer[role="button"]`

## 测试场景

### TC-1: 点击图片打开 Lightbox

- **步骤**: 点击任意图片缩略图
- **预期**: Lightbox 浮层出现（`.yarl__portal` + `position: fixed`）
- **验证**: `.yarl__container` 存在，背景色为深色半透明

### TC-2: 多图切换 — 上一张/下一张

- **前提**: 点击含多张图片的 Feed 中某张图
- **步骤**: 点击下一张按钮 (`.yarl__navigation_next`)
- **预期**: 图片切换，计数器更新
- **步骤**: 点击上一张按钮 (`.yarl__navigation_prev`)
- **预期**: 图片切回

### TC-3: 关闭 Lightbox

- **步骤**: 点击关闭按钮（toolbar 中的 close 按钮 `.yarl__button`）
- **预期**: Lightbox 浮层消失，页面恢复正常

### TC-4: 重置按钮

- **步骤**: 打开 Lightbox → 双击图片放大 → 点击重置按钮（toolbar 中带旋转箭头 SVG 的按钮）
- **预期**: 图片缩放回原始大小

### TC-5: 单图模式 — 无导航按钮

- **前提**: 找到只有 1 张图片的 Feed
- **步骤**: 点击该图片打开 Lightbox
- **预期**: 没有上一张/下一张按钮，没有计数器

### TC-6: Mac 手势防护样式

- **步骤**: 打开 Lightbox
- **验证**: 容器样式包含 `overscroll-behavior: none` 和 `touch-action: none`
- **目的**: 防止触控板滑动触发浏览器前进/后退

### TC-7: 点击背景关闭

- **步骤**: 打开 Lightbox → 点击图片外的暗色背景区域
- **预期**: Lightbox 关闭（`closeOnBackdropClick: true`）

## 关键选择器

| 元素 | 选择器 |
|---|---|
| 图片缩略图 | `div.size-32.cursor-pointer[role="button"]` |
| Lightbox 根 | `.yarl__portal` |
| Lightbox 容器 | `.yarl__container` |
| 上一张按钮 | `.yarl__navigation_prev` |
| 下一张按钮 | `.yarl__navigation_next` |
| 工具栏按钮 | `.yarl__button` |
| 计数器 | `.yarl__counter` (Counter 插件) |
| 当前图片 | `.yarl__slide_image` |
