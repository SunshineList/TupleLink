import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { PanelErrorBoundary } from './PanelErrorBoundary'

// The panel has no browser chrome of its own, so an uncaught render error used
// to leave a blank iframe. These assertions pin the two things that make the
// fallback useful: it keeps a message, and it offers a way back.
//
// There is no DOM environment in this suite (vitest runs on node, and the repo
// has no jsdom/testing-library), so the boundary is exercised as a plain class:
// getDerivedStateFromError is a static, and render is called against a hand-made
// instance. That covers the logic without adding a rendering dependency.

function renderWith(state: { failed: boolean; message: string }, props: Record<string, unknown> = {}) {
  const instance = Object.assign(new PanelErrorBoundary({ children: null, ...props }), { state })
  return instance.render() as ReactElement<Record<string, unknown>>
}

/** Depth-first walk over the element tree a render() call produced. */
function walk(node: unknown, visit: (element: ReactElement<Record<string, unknown>>) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  const element = node as ReactElement<Record<string, unknown>>
  if (typeof element.type === 'string') visit(element)
  walk((element.props as Record<string, unknown> | undefined)?.children, visit)
}

function elementsOf(element: ReactElement<Record<string, unknown>>, type: string) {
  const found: ReactElement<Record<string, unknown>>[] = []
  walk(element, (child) => {
    if (child.type === type) found.push(child)
  })
  return found
}

describe('panel error boundary', () => {
  it('reports a failed state and keeps the error message', () => {
    expect(PanelErrorBoundary.getDerivedStateFromError(new Error('boom'))).toEqual({
      failed: true,
      message: 'boom',
    })
  })

  it('survives a thrown non-Error value', () => {
    // A rejected promise or a library that throws a string must not turn the
    // fallback itself into a second crash.
    expect(PanelErrorBoundary.getDerivedStateFromError('nope').message).toBe('nope')
    expect(PanelErrorBoundary.getDerivedStateFromError(undefined).message).toBe('')
  })

  it('truncates a huge message instead of pasting a stack into the panel', () => {
    const message = PanelErrorBoundary.getDerivedStateFromError(new Error('x'.repeat(5000))).message
    expect(message).toHaveLength(300)
  })

  it('passes children straight through while healthy', () => {
    const children = { type: 'span', props: {}, key: null }
    const element = renderWith({ failed: false, message: '' }, { children })
    expect(element).toBe(children)
  })

  it('renders an alert with the message and both recovery actions when failed', () => {
    const element = renderWith({ failed: true, message: 'Cannot read properties of undefined' })
    expect(element.props.role).toBe('alert')
    const pre = elementsOf(element, 'pre')
    expect(pre).toHaveLength(1)
    expect(pre[0].props.children).toBe('Cannot read properties of undefined')
    // The catalogue is not initialised in this suite, so i18n.t() resolves to
    // empty strings. Assert the structure instead of the copy: one button to
    // retry in place and one to reload the page.
    expect(elementsOf(element, 'button')).toHaveLength(2)
  })

  it('omits the message block when the error carried no text', () => {
    const element = renderWith({ failed: true, message: '' })
    expect(elementsOf(element, 'pre')).toHaveLength(0)
  })

  it('accepts a custom title so one boundary can serve several regions', () => {
    const element = renderWith({ failed: true, message: '' }, { title: 'The editor stopped' })
    expect(elementsOf(element, 'h2')[0].props.children).toBe('The editor stopped')
  })
})
