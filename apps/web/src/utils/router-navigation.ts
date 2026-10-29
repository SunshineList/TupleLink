import { i18n } from '~/i18n'
import { confirmDiscardSettings } from '~/utils/unsaved-settings'

const pages = {
  dashboard: { route: '/', title: 'panel.dashboard' },
  resources: { route: '/resources', title: 'panel.resources' },
  advanced: { route: '/advanced', title: 'panel.advanced' },
  logs: { route: '/logs', title: 'panel.logs' },
} as const

export function routerMenuPage(value: string, current: string) {
  try {
    if (!value.trim()) return
    const base = new URL(current)
    const root = base.pathname.match(
      /^(.*\/admin\/services\/daed)(?:\/(?:dashboard|resources|advanced|logs))?\/?$/,
    )?.[1]
    const target = new URL(value, base)
    if (!root || target.origin !== base.origin || target.username || target.password || /[?#]/.test(target.href)) return
    const isRoot = target.pathname.replace(/\/$/, '') === root
    const prefix = `${root}/`
    const page = isRoot ? 'dashboard' : target.pathname.slice(prefix.length).replace(/\/$/, '')
    if ((!isRoot && !target.pathname.startsWith(prefix)) || !Object.hasOwn(pages, page)) return
    const entry = pages[page as keyof typeof pages]
    return { route: entry.route, title: i18n.t(entry.title), page, isRoot, url: target.href }
  } catch {
    return undefined
  }
}

// Retain the authenticated iframe and its query cache. Only the four exact
// NaiLink menu URLs are handled; other LuCI pages keep their normal navigation.
export function bindRouterNavigation(host: Window, navigate: (route: string) => void) {
  const update = (target: NonNullable<ReturnType<typeof routerMenuPage>>) => {
    for (const anchor of host.document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const entry = routerMenuPage(anchor.getAttribute('href') || '', host.location.href)
      if (!entry || entry.isRoot) continue
      const active = entry.page === target.page
      if (active) anchor.setAttribute('aria-current', 'page')
      else anchor.removeAttribute('aria-current')
      anchor.classList.toggle('active', active)
      const item = anchor.closest('li')
      if (item) {
        item.classList.toggle('active', active)
        if (item.classList.contains('cbi-tab') || item.classList.contains('cbi-tab-disabled')) {
          item.classList.toggle('cbi-tab', active)
          item.classList.toggle('cbi-tab-disabled', !active)
        }
      }
    }
    host.document.title = `NaiLink · ${target.title}`
    host.document
      .querySelector<HTMLIFrameElement>('iframe[src^="/cgi-bin/daed-router/"]')
      ?.setAttribute('title', `NaiLink ${target.title}`)
  }
  let acceptedURL = host.location.href
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    // Elements originate in the parent realm, so avoid instanceof Element.
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
    const target = routerMenuPage(anchor.getAttribute('href') || '', host.location.href)
    if (!target) return
    event.preventDefault()
    if (target.url !== acceptedURL && !confirmDiscardSettings()) {
      event.stopImmediatePropagation()
      return
    }
    acceptedURL = target.url
    if (host.location.href !== target.url) host.history.pushState(null, '', target.url)
    update(target)
    navigate(target.route)
  }
  const pop = () => {
    if (host.location.href !== acceptedURL && !confirmDiscardSettings()) {
      host.history.pushState(null, '', acceptedURL)
      return
    }
    acceptedURL = host.location.href
    const target = routerMenuPage(host.location.href, host.location.href)
    if (!target) {
      host.location.reload()
      return
    }
    update(target)
    navigate(target.route)
  }
  const initial = routerMenuPage(host.location.href, host.location.href)
  if (!initial) return () => {}
  update(initial)
  host.document.addEventListener('click', click, true)
  host.addEventListener('popstate', pop)
  return () => {
    host.document.removeEventListener('click', click, true)
    host.removeEventListener('popstate', pop)
  }
}
