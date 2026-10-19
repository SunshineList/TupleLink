import { createGraphiQLFetcher } from '@graphiql/toolkit'
import { useStore } from '@nanostores/react'
import { GraphiQL } from 'graphiql'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import { MainLayout, OrchestratePage, SetupPage } from '~/pages'
import { endpointURLAtom, tokenAtom } from '~/store'
import { routerMode } from '~/utils/router-mode'

export function Router() {
  const endpointURL = useStore(endpointURLAtom)
  const token = useStore(tokenAtom)
  const RouterType = import.meta.env.DEV ? BrowserRouter : HashRouter

  return (
    <RouterType>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<OrchestratePage area={routerMode ? 'dashboard' : 'all'} />} />
          {routerMode && <Route path="resources" element={<OrchestratePage area="resources" />} />}
          {routerMode && <Route path="advanced" element={<OrchestratePage area="advanced" />} />}
        </Route>

        <Route path="/setup" element={routerMode ? <Navigate to="/" replace /> : <SetupPage />} />

        {!routerMode && endpointURL && (
          <Route
            path="/graphiql"
            element={
              <GraphiQL
                fetcher={createGraphiQLFetcher({
                  url: endpointURL,
                  headers: { authorization: `Bearer ${token}` },
                })}
              />
            }
          />
        )}
      </Routes>
    </RouterType>
  )
}
