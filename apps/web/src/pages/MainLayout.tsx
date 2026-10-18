import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { HeaderWithActions } from '~/components/Header'
import { RouterHeader } from '~/components/RouterHeader'
import { useInitialize } from '~/initialize'
import { isMockMode } from '~/mocks'
import { endpointURLAtom, tokenAtom } from '~/store'
import { routerMode } from '~/utils/router-mode'

export function MainLayout() {
  const navigate = useNavigate()
  const token = useStore(tokenAtom)
  const endpointURL = useStore(endpointURLAtom)
  const initialize = useInitialize()
  const [ready, setReady] = useState(!routerMode)
  const [error, setError] = useState('')

  useEffect(() => {
    initialize()
      .then(() => setReady(true))
      .catch(() => setError('面板初始化失败，请刷新页面或查看运行日志。'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Skip authentication check in mock mode
    if (isMockMode() || routerMode) return

    if (!endpointURL || !token) {
      navigate('/setup')
    }
  }, [endpointURL, navigate, token])

  if (routerMode && !ready) return <div className="p-6">{error || '正在准备面板…'}</div>

  return (
    <div className={`flex min-h-dvh flex-col ${routerMode ? 'router-panel bg-background' : 'bg-pattern'}`}>
      {routerMode ? <RouterHeader /> : <HeaderWithActions />}
      <main className="flex-1">
        <div className="container mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-7">
          <Outlet />
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
