/**
 * ============================================================
 * 测试文件: 图片预览组件 (Lightbox) 功能测试
 * ============================================================
 *
 * 目标项目: maimai-community-pc (脉脉社区 PC)
 * 需求分支: feat/image_preview
 * 核心变更: viewerjs → yet-another-react-lightbox 迁移
 *
 * 架构集成:
 *   基于项目统一架构 (ZeroStep AI + Playwright 混合策略):
 *   - 使用 utils/fixture.js 提供的 { page, ai } 上下文
 *   - 核心交互操作通过 adapter.js 执行（Playwright 优先 + AI 兜底）
 *   - 精确 DOM/样式断言保留 Playwright 原生 API（AI 无法检查计算样式）
 *
 * 覆盖场景:
 *   TC-1: 点击图片打开 Lightbox
 *   TC-2: 多图切换 (上一张/下一张)
 *   TC-3: 关闭 Lightbox (关闭按钮)
 *   TC-4: 重置缩放按钮
 *   TC-5: 单图模式 — 无导航按钮
 *   TC-6: Mac 手势防护样式验证
 *   TC-7: 点击背景区域关闭 Lightbox
 *   TC-8: Lightbox 关闭后页面滚动位置恢复
 *
 * 注意:
 *   CDN 图片 (i9.taou.com) 在 Playwright Chromium 中会被 ORB 策略阻止
 *   需要通过 route 拦截修复响应头才能正常加载
 *
 * 运行方式:
 *   pnpm test:image-preview
 * ============================================================
 */

import { test as baseTest } from '../../utils/fixture.js'
import { expect } from '@playwright/test'
import { executeInstruction } from '../../api/adapter.js'

// ─── 常量 ───────────────────────────────────────────
const BASE_URL = 'http://localhost:3000'
const HOME_URL = `${BASE_URL}/home/recommended`

// 选择器
const SEL = {
  /** 图片缩略图（ImageGallery 中的可点击 div） */
  thumbnail: 'div.size-32.cursor-pointer[role="button"]',
  /** Lightbox Portal 根节点 */
  portal: '.yarl__portal',
  /** Lightbox 容器 */
  container: '.yarl__container',
  /** 当前活动幻灯片 */
  currentSlide: '.yarl__slide_current',
  /** 上一张按钮 */
  prevBtn: '.yarl__navigation_prev',
  /** 下一张按钮 */
  nextBtn: '.yarl__navigation_next',
  /** 工具栏按钮（通用） */
  toolbarBtn: '.yarl__toolbar .yarl__button',
  /** 关闭按钮 — toolbar 中 title 为 Close 的按钮 */
  closeBtn: '.yarl__toolbar button[title="Close"]',
  /** 重置按钮 — toolbar 中 title 为 "重置" 的按钮 */
  resetBtn: '.yarl__toolbar button[title="重置"]',
  /** 计数器插件 */
  counter: '.yarl__counter',
  /** 图片元素（包含加载中的） */
  slideImage: '.yarl__slide_image',
  /** 图片加载完成（不含 loading 状态） */
  slideImageLoaded: '.yarl__slide_image:not(.yarl__slide_image_loading)',
  /** 轮播容器 */
  carousel: '.yarl__carousel',
  /** Lightbox 外层固定定位容器（Portal 渲染） */
  fixedOverlay: 'body > div[style*="position: fixed"][style*="z-index: 9999"]',
}

// 超时配置
const LIGHTBOX_TIMEOUT = 5_000
const IMAGE_LOAD_TIMEOUT = 15_000
const NAVIGATION_TIMEOUT = 120_000

// ─── 扩展 fixture: 在 AI fixture 基础上添加 CDN ORB 修复 ──────
const test = baseTest.extend({
  // 覆盖 page fixture，在原有 stealth 浏览器基础上追加 CDN 路由拦截
  page: async ({ page }, use) => {
    // 修复 CDN 图片 ORB 阻止问题：拦截 i9.taou.com 的图片请求，确保响应头正确
    await page.route('**/i9.taou.com/**', async route => {
      try {
        const response = await route.fetch()
        const headers = { ...response.headers() }
        // 确保 Content-Type 正确，防止 ORB 拦截
        if (!headers['content-type'] || !headers['content-type'].startsWith('image/')) {
          headers['content-type'] = 'image/jpeg'
        }
        // 确保 CORS 头存在
        headers['access-control-allow-origin'] = '*'
        await route.fulfill({
          status: response.status(),
          headers,
          body: await response.body(),
        })
      } catch {
        // fetch 失败时直接继续
        await route.continue()
      }
    })

    await use(page)
  },
})

// ─── 适配器辅助: 通过统一指令执行浏览器操作 ──────────────────

/**
 * 通过适配器执行点击操作（Playwright 优先 + AI 兜底）
 *
 * @param {object} context - { page, ai } 上下文
 * @param {string} semanticLocator - 元素语义描述（供 AI 定位）
 * @param {string} [fallbackSelector] - CSS 选择器（供 Playwright 定位）
 * @param {string} description - 步骤描述
 */
async function adapterClick(context, semanticLocator, fallbackSelector, description = '') {
  return executeInstruction(
    {
      step_id: 0,
      action_type: 'click',
      params: { semantic_locator: semanticLocator, fallback_selector: fallbackSelector },
      description: description || `点击 ${semanticLocator}`,
    },
    context,
  )
}

/**
 * 通过适配器执行导航操作
 */
async function adapterNavigate(context, url, description = '') {
  return executeInstruction(
    {
      step_id: 0,
      action_type: 'navigate',
      params: { url },
      description: description || `导航到 ${url}`,
    },
    context,
  )
}

/**
 * 通过适配器执行等待操作
 */
async function adapterWait(context, selector, timeout, description = '') {
  return executeInstruction(
    {
      step_id: 0,
      action_type: 'wait',
      params: { selector, timeout },
      description: description || `等待元素 ${selector}`,
    },
    context,
  )
}

/**
 * 通过适配器执行验证操作（Playwright 关键词检测 + AI 兜底）
 */
async function adapterVerify(context, assertion, description = '') {
  return executeInstruction(
    {
      step_id: 0,
      action_type: 'verify',
      params: { assertion },
      description: description || `验证 ${assertion}`,
    },
    context,
  )
}

// ─── 辅助函数 ─────────────────────────────────────────

/**
 * 导航到首页并等待图片缩略图加载（通过适配器执行）
 */
async function goHomeAndWaitForImages(context) {
  const { page } = context
  await adapterNavigate(context, HOME_URL, '导航到首页推荐页')
  // 等待 networkidle 确保动态内容加载完成
  await page.waitForLoadState('networkidle')
  await adapterWait(context, SEL.thumbnail, NAVIGATION_TIMEOUT, '等待图片缩略图加载')
}

/**
 * 打开 Lightbox：点击指定索引的缩略图
 *
 * 注意: 当需要点击"第 N 个"缩略图时，AI 语义定位不够精确，
 * 因此对于 index > 0 的情况直接使用 Playwright nth 定位。
 * 对于 index === 0 的情况，走适配器混合策略。
 */
async function openLightbox(context, index = 0) {
  const { page } = context
  if (index === 0) {
    // 第一张缩略图：通过适配器执行（Playwright 优先 + AI 兜底）
    await adapterClick(context, 'first image thumbnail', SEL.thumbnail, '点击第一张缩略图打开 Lightbox')
  } else {
    // 指定索引：使用 Playwright 精确定位（AI 难以表达"第 N 个"语义）
    await page.locator(SEL.thumbnail).nth(index).click()
  }
  await page.waitForSelector(SEL.container, { timeout: LIGHTBOX_TIMEOUT })
}

/**
 * 获取某个缩略图所在的 ImageGallery 有多少张图
 * (DOM 查询，无需 AI 参与)
 */
async function getGalleryImageCount(page, thumbnailIndex) {
  return page
    .locator(SEL.thumbnail)
    .nth(thumbnailIndex)
    .evaluate(el => {
      const grid = el.closest('.inline-grid')
      if (!grid) return 1
      return grid.querySelectorAll('[role="button"]').length
    })
}

/**
 * 找到包含多张图片的 gallery 中的第一张缩略图索引
 * (DOM 查询，无需 AI 参与)
 */
async function findMultiImageGalleryIndex(page) {
  const count = await page.locator(SEL.thumbnail).count()
  for (let i = 0; i < count; i++) {
    const galleryCount = await getGalleryImageCount(page, i)
    if (galleryCount >= 2) return i
  }
  return -1
}

/**
 * 找到只有单张图片的 gallery 中的缩略图索引
 * (DOM 查询，无需 AI 参与)
 */
async function findSingleImageGalleryIndex(page) {
  const count = await page.locator(SEL.thumbnail).count()
  for (let i = 0; i < count; i++) {
    const galleryCount = await getGalleryImageCount(page, i)
    if (galleryCount === 1) return i
  }
  return -1
}

/**
 * 等待 Lightbox 图片加载完成
 */
async function waitForImageLoaded(page) {
  await page.locator(SEL.slideImageLoaded).first().waitFor({
    state: 'visible',
    timeout: IMAGE_LOAD_TIMEOUT,
  })
}

// ─── 测试用例 ─────────────────────────────────────────

test.describe('图片预览组件 (Lightbox)', () => {
  test.beforeEach(async ({ page, ai }) => {
    await goHomeAndWaitForImages({ page, ai })
  })

  test('TC-1: 点击图片缩略图打开 Lightbox', async ({ page, ai }) => {
    const ctx = { page, ai }

    // 通过适配器打开 Lightbox（Playwright 优先 + AI 兜底）
    await openLightbox(ctx)

    // 验证 Lightbox 容器可见
    await expect(page.locator(SEL.container)).toBeVisible()

    // 验证 slide 区域存在当前幻灯片
    await expect(page.locator(SEL.currentSlide)).toBeVisible()

    // 验证 Lightbox 轮播区域存在
    await expect(page.locator(SEL.carousel)).toBeVisible()

    // 验证外层固定定位容器（Portal 渲染到 body）
    await expect(page.locator(SEL.fixedOverlay)).toBeVisible()

    // 通过适配器验证工具栏存在
    await adapterVerify(ctx, '页面包含 "Close" 按钮', '验证关闭按钮存在')
    await expect(page.locator(SEL.closeBtn)).toBeVisible()
  })

  test('TC-2: 多图切换 — 上一张/下一张', async ({ page, ai }) => {
    const ctx = { page, ai }

    const multiIdx = await findMultiImageGalleryIndex(page)
    test.skip(multiIdx === -1, '页面上没有多图 Feed，跳过')

    // 打开多图 Lightbox（通过适配器，Playwright 优先 + AI 兜底）
    await openLightbox(ctx, multiIdx)

    // 验证导航按钮存在
    await expect(page.locator(SEL.nextBtn)).toBeVisible()

    // 获取当前 slide 中图片的 src
    const getCurrentSlideSrc = () => page.locator('.yarl__slide_current .yarl__slide_image').first().getAttribute('src')
    const getCounterText = async () => {
      const counter = page.locator(SEL.counter)
      if (await counter.isVisible()) return counter.textContent()
      return null
    }

    const firstSrc = await getCurrentSlideSrc()
    const firstCounter = await getCounterText()

    // 通过适配器点击"下一张"按钮（Playwright 优先 + AI 兜底）
    await adapterClick(ctx, 'next slide navigation button', SEL.nextBtn, '点击下一张按钮')
    await page.waitForTimeout(800) // 等待切换动画完成

    const secondSrc = await getCurrentSlideSrc()
    const secondCounter = await getCounterText()

    // 验证切换成功：图片 src 变化 或 计数器变化
    const switched = firstSrc !== secondSrc || firstCounter !== secondCounter
    expect(switched).toBeTruthy()

    // 通过适配器点击"上一张"按钮
    await expect(page.locator(SEL.prevBtn)).toBeVisible()
    await adapterClick(ctx, 'previous slide navigation button', SEL.prevBtn, '点击上一张按钮')
    await page.waitForTimeout(800)

    const backSrc = await getCurrentSlideSrc()
    // 验证切回原位
    expect(backSrc).toEqual(firstSrc)
  })

  test('TC-3: 点击关闭按钮关闭 Lightbox', async ({ page, ai }) => {
    const ctx = { page, ai }

    // 通过适配器打开 Lightbox
    await openLightbox(ctx)
    await expect(page.locator(SEL.container)).toBeVisible()

    // 通过适配器点击关闭按钮
    await adapterClick(ctx, 'close button in the lightbox toolbar', SEL.closeBtn, '点击关闭按钮')

    // 等待 Lightbox 消失
    await expect(page.locator(SEL.container)).toBeHidden({ timeout: LIGHTBOX_TIMEOUT })
  })

  test('TC-4: 重置按钮功能验证', async ({ page, ai }) => {
    const ctx = { page, ai }

    // 通过适配器打开 Lightbox
    await openLightbox(ctx)

    // 验证重置按钮存在且有正确的 title
    const resetBtn = page.locator(SEL.resetBtn)
    await expect(resetBtn).toBeVisible()
    const resetTitle = await resetBtn.getAttribute('title')
    expect(resetTitle).toBe('重置')

    // 验证重置按钮包含旋转箭头 SVG 图标
    const hasSvg = await resetBtn.locator('svg').count()
    expect(hasSvg).toBeGreaterThan(0)

    // 通过适配器点击重置按钮
    await adapterClick(ctx, 'reset zoom button with title 重置', SEL.resetBtn, '点击重置按钮')
    await page.waitForTimeout(300)

    // 点击后 Lightbox 应该仍然打开（重置不等于关闭）
    await expect(page.locator(SEL.container)).toBeVisible()
    await expect(resetBtn).toBeEnabled()
  })

  test('TC-5: 单图模式 — 无导航按钮、无计数器', async ({ page, ai }) => {
    const ctx = { page, ai }

    const singleIdx = await findSingleImageGalleryIndex(page)
    test.skip(singleIdx === -1, '页面上没有单图 Feed，跳过')

    // 打开单图 Lightbox（通过适配器）
    await openLightbox(ctx, singleIdx)
    await expect(page.locator(SEL.container)).toBeVisible()

    // 单图模式：无上一张/下一张按钮
    await expect(page.locator(SEL.prevBtn)).toBeHidden()
    await expect(page.locator(SEL.nextBtn)).toBeHidden()

    // 单图模式：无计数器
    await expect(page.locator(SEL.counter)).toBeHidden()
  })

  test('TC-6: Mac 手势防护 — overscrollBehavior & touchAction 样式', async ({ page, ai }) => {
    const ctx = { page, ai }

    // 通过适配器打开 Lightbox
    await openLightbox(ctx)

    // 以下为精确 CSS 计算样式断言 — AI 无法检查 computedStyle，必须用 Playwright 原生 API
    const containerStyles = await page.locator(SEL.container).evaluate(el => {
      const styles = window.getComputedStyle(el)
      return {
        overscrollBehavior: styles.overscrollBehavior,
        touchAction: styles.touchAction,
      }
    })
    expect(containerStyles.overscrollBehavior).toBe('none')
    expect(containerStyles.touchAction).toBe('none')

    // 检查 body 滚动锁定
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow)
    expect(bodyOverflow).toBe('hidden')

    // 检查 html 元素的 overscroll-behavior-x
    const htmlOverscrollX = await page.evaluate(() => document.documentElement.style.overscrollBehaviorX)
    expect(htmlOverscrollX).toBe('none')
  })

  test('TC-7: 点击背景区域关闭 Lightbox', async ({ page, ai }) => {
    const ctx = { page, ai }

    // 通过适配器打开 Lightbox
    await openLightbox(ctx)
    await expect(page.locator(SEL.container)).toBeVisible()
    await page.waitForTimeout(500)

    // 点击容器边缘（远离图片的背景区域）— 坐标操作需要 Playwright 原生 API
    const container = page.locator(SEL.container)
    const box = await container.boundingBox()
    if (box) {
      await page.mouse.click(box.x + 30, box.y + 30)
    }

    await expect(page.locator(SEL.container)).toBeHidden({ timeout: LIGHTBOX_TIMEOUT })
  })

  test('TC-8: Lightbox 打开时锁定滚动，关闭后恢复', async ({ page, ai }) => {
    const ctx = { page, ai }

    // 先等待页面完全稳定
    await page.waitForTimeout(1000)

    // 以下为精确 DOM 样式断言 — 必须用 Playwright 原生 API
    const positionBefore = await page.evaluate(() => document.body.style.position)
    expect(positionBefore).not.toBe('fixed') // 正常状态不是 fixed

    // 通过适配器打开 Lightbox
    await openLightbox(ctx)
    await expect(page.locator(SEL.container)).toBeVisible()

    // 验证打开后 body 被锁定：position: fixed
    const positionDuring = await page.evaluate(() => document.body.style.position)
    expect(positionDuring).toBe('fixed')

    // 验证 body.style.width = 100%（防止宽度跳变）
    const widthDuring = await page.evaluate(() => document.body.style.width)
    expect(widthDuring).toBe('100%')

    // 通过适配器关闭 Lightbox
    await adapterClick(ctx, 'close button in the lightbox toolbar', SEL.closeBtn, '点击关闭按钮')
    await expect(page.locator(SEL.container)).toBeHidden({ timeout: LIGHTBOX_TIMEOUT })
    await page.waitForTimeout(500)

    // 验证关闭后 body.style.position 已恢复
    const positionAfter = await page.evaluate(() => document.body.style.position)
    expect(positionAfter).toBe('')

    // 验证 body.style.top 已清除
    const topAfter = await page.evaluate(() => document.body.style.top)
    expect(topAfter).toBe('')
  })
})
