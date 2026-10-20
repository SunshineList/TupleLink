import { createGraphiQLFetcher } from '@graphiql/toolkit'
import { GraphiQL } from 'graphiql'

export default function GraphQLPage({ endpointURL, token }: { endpointURL: string; token: string }) {
  return (
    <GraphiQL fetcher={createGraphiQLFetcher({ url: endpointURL, headers: { authorization: `Bearer ${token}` } })} />
  )
}
