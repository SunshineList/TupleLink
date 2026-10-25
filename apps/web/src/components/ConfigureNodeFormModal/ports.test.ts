import { describe, expect, it } from 'vitest'
import { portsIssue } from './ports'

describe('port hopping strings', () => {
  it.each(['', '  ', '443', '10000-20000', '10000-20000,443', '1', '65535', '443,8443,9443'])(
    'accepts %j',
    (value) => {
      expect(portsIssue(value)).toBe('')
    },
  )

  it.each(['10000~20000', '10000-20000，443', '70000', '0', '10000-', '-443', '443,', ',443'])(
    'flags %j',
    (value) => {
      expect(portsIssue(value)).not.toBe('')
    },
  )

  it('终点小于起点时也要报出来', () => {
    expect(portsIssue('20000-10000')).toBe('20000-10000')
  })
})
