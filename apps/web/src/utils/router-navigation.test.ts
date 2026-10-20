import { describe, expect, it } from 'vitest'
import { routerMenuPage } from './router-navigation'

const current = 'https://router.test/cgi-bin/luci/admin/services/daed/dashboard'

describe('luCI menu route boundary', () => {
  it('recognizes only the four local plugin menus, including install prefixes', () => {
    const root = current.replace('/dashboard', '')
    expect(routerMenuPage(root, root)?.route).toBe('/')
    expect(routerMenuPage(`${root}/resources`, root)?.route).toBe('/resources')
    for (const [page, route] of [
      ['dashboard', '/'],
      ['resources', '/resources'],
      ['advanced', '/advanced'],
      ['logs', '/logs'],
    ]) {
      expect(routerMenuPage(page, current)?.route).toBe(route)
      expect(routerMenuPage(`${current.replace('/dashboard', '')}/${page}/`, current)?.route).toBe(route)
    }
    expect(
      routerMenuPage(
        'https://router.test/router/admin/services/daed/resources',
        'https://router.test/router/admin/services/daed/dashboard',
      )?.route,
    ).toBe('/resources')
  })

  it('leaves external URLs, login, other plugins, actions and malformed URLs alone', () => {
    for (const value of [
      'https://evil.test/cgi-bin/luci/admin/services/daed/resources',
      '/cgi-bin/luci/admin/logout',
      '/cgi-bin/luci/admin/services/passwall',
      'advanced?apply=1',
      '',
      '#',
      'resources#',
      'advanced?',
      'advanced#other',
      'advanced/child',
      'javascript:alert(1)',
      'http://[invalid',
      '../daed-foreign/resources',
    ]) {
      expect(routerMenuPage(value, current)).toBeUndefined()
    }
  })
})
