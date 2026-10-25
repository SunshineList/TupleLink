import { useStore } from '@nanostores/react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'

import { MainLayout, OrchestratePage, SetupPage } from '~/pages'
import { endpointURLAtom, tokenAtom } from '~/store'
import { routerMode } from '~/utils/router-mode'

const GraphQLPage = import.meta.env.VITE_OPENWRT === '1' ? null : lazy(() => import('~/pages/GraphQLPage'))

function RouterWorkspace() {
  const { area = 'dashboard' } = useParams()
  if (!['dashboard', 'resources', 'advanced', 'logs'].includes(area)) return <Navigate to="/" replace />
  return <OrchestratePage area={area as 'dashboard' | 'resources' | 'advanced' | 'logs'} />
}

export function Router() {
  const { t } = useTranslation()
  const endpointURL = useStore(endpointURLAtom)
  const token = useStore(tokenAtom)
  const RouterType = import.meta.env.DEV ? BrowserRouter : HashRouter

  return (
    <RouterType>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          {routerMode ? (
            <Route path=":area?" element={<RouterWorkspace />} />
          ) : (
            <Route index element={<OrchestratePage />} />
          )}
        </Route>

        <Route path="/setup" element={routerMode ? <Navigate to="/" replace /> : <SetupPage />} />

        {!routerMode && endpointURL && GraphQLPage && (
          <Route
            path="/graphiql"
            element={
              <Suspense fallback={<div className="p-6">{t('shell.loadingDebug')}</div>}>
                <GraphQLPage endpointURL={endpointURL} token={token} />
              </Suspense>
            }
          />
        )}
      </Routes>
    </RouterType>
  )
}
