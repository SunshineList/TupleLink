interface MenuNode {
  children?: Record<string, MenuNode>
}

export interface RouterMenuHost {
  L?: { require: (name: string) => Promise<{ menu: { load: () => Promise<MenuNode>; flushCache: () => void } }> }
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  location: { reload: () => void }
}

const refreshKey = 'daed-router-menu-refresh-0.6.1'
const pages = ['dashboard', 'resources', 'advanced', 'logs']

// LuCI caches the menu separately in browser session storage. Server-side
// postinst cache removal cannot update an already logged-in browser. This runs
// from the bundled app, even when the outer LuCI view script is still cached.
export async function refreshStaleRouterMenu(host: RouterMenuHost): Promise<boolean> {
  try {
    if (!host.L?.require) return false
    const { menu } = await host.L.require('ui')
    const tree = await menu.load()
    const children = tree.children?.admin?.children?.services?.children?.daed?.children
    if (!children || pages.every((page) => Object.hasOwn(children, page))) return false
    menu.flushCache()
    // Do not loop if the installed server menu itself is incomplete.
    if (host.sessionStorage.getItem(refreshKey)) return false
    host.sessionStorage.setItem(refreshKey, '1')
    host.location.reload()
    return true
  } catch {
    // Alternate LuCI versions or unavailable storage must not block the panel.
    return false
  }
}
