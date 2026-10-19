import { GraphQLClient } from 'graphql-request'
import { describe, expect, it, vi } from 'vitest'
import { cancellableGraphQLClient } from './graphql-client'

function waitingClient() {
  let activeSignal: AbortSignal | undefined
  const client = new GraphQLClient('https://fixture.invalid/graphql', {
    fetch: async (_url, init) => {
      activeSignal = init?.signal as AbortSignal
      const signal = activeSignal
      return await new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
  })
  return { client, signal: () => activeSignal }
}

describe('graphQL polling request lifetime', () => {
  it('cancels the real transport when a query is abandoned', async () => {
    const fixture = waitingClient()
    const controller = new AbortController()
    const promise = cancellableGraphQLClient(fixture.client).request('query { status }', undefined, controller.signal)
    const check = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await check
    expect(fixture.signal()?.aborted).toBe(true)
  })

  it('times out a hung query and removes its timer', async () => {
    vi.useFakeTimers()
    try {
      const fixture = waitingClient()
      const promise = cancellableGraphQLClient(fixture.client, 100).request(
        'query { status }',
        undefined,
        new AbortController().signal,
      )
      const check = expect(promise).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(100)
      await check
      expect(fixture.signal()?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains unsignalled mutations and cleans up successful query timers', async () => {
    vi.useFakeTimers()
    try {
      let mutationSignal: RequestInit['signal']
      const transport: typeof fetch = async (_url, init) => {
        mutationSignal = init?.signal
        return new Response(JSON.stringify({ data: { status: 'ok' } }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      const client = cancellableGraphQLClient(
        new GraphQLClient('https://fixture.invalid/graphql', { fetch: transport }),
      )
      expect(await client.request('mutation { status }')).toEqual({ status: 'ok' })
      expect(mutationSignal).toBeUndefined()
      expect(await client.request('query { status }', undefined, new AbortController().signal)).toEqual({
        status: 'ok',
      })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
