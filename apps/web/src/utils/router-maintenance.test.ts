import { describe, expect, it } from 'vitest'
import { jobActive, newerVersion } from './router-maintenance'

describe('maintenance state', () => {
  it('orders numeric releases without downgrading or comparing package revisions', () => {
    expect(newerVersion('0.6.33', '0.6.32-1')).toBe(true)
    expect(newerVersion('0.6.9', '0.6.32-1')).toBe(false)
    expect(newerVersion('0.6.32', '0.6.32-1')).toBe(false)
    expect(newerVersion('not-a-version', '0.6.32')).toBe(false)
  })
  it('polls queued/running tasks and stops for terminal states', () => {
    expect(jobActive()).toBe(false)
    for (const state of ['queued', 'running', 'success', 'error'] as const)
      expect(jobActive({ id: 'a', action: 'update', state, phase: 'installing', started: 0, updated: 0 })).toBe(
        ['queued', 'running'].includes(state),
      )
  })
})
