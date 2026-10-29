import type { RouterMenuHost } from '~/utils/router-menu'
import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useNavigate } from 'react-router-dom'
import { HeaderWithActions } from '~/components/Header'
import { PanelErrorBoundary } from '~/components/PanelErrorBoundary'
import { RouterHeader } from '~/components/RouterHeader'
import { QUERY_KEY_GENERAL } from '~/constants'
import { useUnsavedSettingsGuard } from '~/hooks/useUnsavedSettings'
import { useInitialize } from '~/initialize'
import { isMockMode } from '~/mocks'
import { endpointURLAtom, tokenAtom } from '~/store'
import { refreshStaleRouterMenu } from '~/utils/router-menu'
import { routerMode } from '~/utils/router-mode'
import { bindRouterNavigation } from '~/utils/router-navigation'

export function MainLayout() {
  useUnsavedSettingsGuard()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const token = useStore(tokenAtom)
  const endpointURL = useStore(endpointURLAtom)
  const initialize = useInitialize()
  const queries = useQueryClient()
  const [ready, setReady] = useState(!routerMode)
  const [error, setError] = useState('')

  useEffect(() => {
    async function prepare() {
      if (
        routerMode &&
        window.parent !== window &&
        (await refreshStaleRouterMenu(window.parent as unknown as RouterMenuHost))
      )
        return
      await initialize()
      setReady(true)
    }
    prepare().catch(() => setError(t('shell.initFailed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Skip authentication check in mock mode
    if (isMockMode() || routerMode) return

    if (!endpointURL || !token) {
      navigate('/setup')
    }
  }, [endpointURL, navigate, token])

  useEffect(() => {
    if (!routerMode || !ready || window.parent === window) return
    try {
      return bindRouterNavigation(window.parent, (route) => {
        // The outer LuCI URL owns history; do not add a second iframe entry.
        navigate(route, { replace: true })
        void queries.invalidateQueries({ queryKey: QUERY_KEY_GENERAL })
        window.scrollTo(0, 0)
      })
    } catch {
      // Alternate/cross-origin hosts retain ordinary LuCI navigation.
    }
  }, [navigate, queries, ready])

  if (routerMode && !ready) return <div className="p-6">{error || t('shell.initializing')}</div>

  return (
    <div className={`flex min-h-dvh flex-col ${routerMode ? 'router-panel bg-background' : 'bg-pattern'}`}>
      {routerMode ? <RouterHeader /> : <HeaderWithActions />}
      <main className="flex-1">
        <div
          className={`container mx-auto max-w-[1400px] px-4 lg:px-8 ${routerMode ? 'py-4 lg:py-5' : 'py-6 lg:py-7'}`}
        >
          <PanelErrorBoundary>
            <Outlet />
          </PanelErrorBoundary>
        </div>
      </main>
      {!routerMode && (
        <footer className="h-14 border-t bg-card/50 backdrop-blur-sm flex items-center justify-center">
          <p className="text-xs text-muted-foreground font-light tracking-wide">
            Made with <span className="inline-block animate-pulse text-primary">●</span> by{' '}
            <a
              href="https://github.com/daeuniverse"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline underline-offset-4 transition-colors hover:text-primary/80"
            >
              @daeuniverse
            </a>
          </p>
        </footer>
      )}
    </div>
  )
}
