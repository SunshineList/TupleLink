import type { ReactElement } from 'react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { AlertBanner } from './alert-banner'

// 这个仓库没有 jsdom / testing-library，组件测试一律按元素树断言
// （见 PanelErrorBoundary.test.tsx 的说明）。这里同样只走 render 结果，
// 不引入新的渲染依赖。

function render(props: Parameters<typeof AlertBanner>[0]) {
  return AlertBanner(props) as ReactElement<Record<string, unknown>>
}

/** 深度优先遍历元素树。 */
function walk(node: unknown, visit: (element: ReactElement<Record<string, unknown>>) => void): void {
  if (!node) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') return
  const element = node as ReactElement<Record<string, unknown>>
  visit(element)
  const children = (element.props as { children?: unknown } | undefined)?.children
  walk(children, visit)
}

function collectText(node: unknown): string {
  let text = ''
  walk(node, (element) => {
    if (typeof element.props?.children === 'string') text += element.props.children
  })
  return text
}

describe('提示条', () => {
  it('普通提示不打断读屏器', () => {
    // info 只是陈述事实，用 status；用 alert 会让读屏器在每次刷新时抢话。
    expect(render({ tone: 'info', children: '有更新' }).props.role).toBe('status')
  })

  it('需要用户处理时才用 alert', () => {
    expect(render({ tone: 'warning', children: '接口没绑定' }).props.role).toBe('alert')
  })

  it('危险级别同样抢话', () => {
    expect(render({ tone: 'danger', children: '服务已停止' }).props.role).toBe('alert')
  })

  it('成功提示不打断', () => {
    expect(render({ tone: 'success', children: '已保存' }).props.role).toBe('status')
  })

  it('渲染标题和正文', () => {
    const tree = render({ tone: 'warning', title: '接口没有绑定', children: '从外面连回来会绕过代理' })
    const text = collectText(tree)
    expect(text).toContain('接口没有绑定')
    expect(text).toContain('从外面连回来会绕过代理')
  })

  it('动作按钮带标签且可点击', () => {
    let clicked = 0
    const tree = render({ tone: 'warning', action: { label: '立即绑定', onClick: () => clicked++ } })
    let button: ReactElement<Record<string, unknown>> | undefined
    walk(tree, (element) => {
      if (element.type === 'button') button = element
    })
    expect(button).toBeTruthy()
    expect(collectText(button)).toBe('立即绑定')
    ;(button!.props.onClick as () => void)()
    expect(clicked).toBe(1)
  })

  it('没有动作时不渲染按钮', () => {
    const tree = render({ tone: 'info', children: '纯说明' })
    let buttons = 0
    walk(tree, (element) => {
      if (element.type === 'button') buttons++
    })
    expect(buttons).toBe(0)
  })

  it('图标不进入无障碍树', () => {
    // 图标是纯装饰，读屏器念出来只会变成噪音。
    const tree = render({ tone: 'success', children: '已保存' })
    let icons = 0
    walk(tree, (element) => {
      if (element.props && element.props['aria-hidden'] === 'true') icons++
    })
    expect(icons).toBe(1)
  })

  it('未指定 tone 时按普通提示处理', () => {
    expect(render({ children: '默认' }).props.role).toBe('status')
  })

  it('可以叠加外部 className', () => {
    const tree = render({ tone: 'info', children: 'x', className: 'mb-3' })
    expect(String(tree.props.className)).toContain('mb-3')
  })

  it('createElement 形式也能渲染', () => {
    // 真实调用点是 JSX，这里顺便确认 props 签名对得上。
    expect(createElement(AlertBanner, { tone: 'info', children: 'x' })).toBeTruthy()
  })
})
