import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTestNodeLatenciesMutation } from '~/apis'
import { testLatencyBatches } from '~/utils/latency-batch'

export function useLatencyTests() {
  const { t } = useTranslation()
  const { mutateAsync } = useTestNodeLatenciesMutation()
  const busyRef = useRef(false)
  const stopped = useRef(false)
  const mounted = useRef(true)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [error, setError] = useState('')
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopped.current = true
    }
  }, [])
  const test = useCallback(
    async (ids: string[]) => {
      if (busyRef.current || !ids.length) return
      busyRef.current = true
      stopped.current = false
      setError('')
      setBusy(true)
      setProgress({ completed: 0, total: new Set(ids).size })
      try {
        await testLatencyBatches(
          ids,
          async (batch) => {
            if (mounted.current) setPending((previous) => new Set([...previous, ...batch]))
            try {
              return await mutateAsync(batch)
            } finally {
              if (mounted.current) setPending((previous) => new Set([...previous].filter((id) => !batch.includes(id))))
            }
          },
          (_results, completed, total) => {
            if (mounted.current) setProgress({ completed, total })
          },
          () => stopped.current,
        )
      } catch {
        if (mounted.current) setError(t('latency.requestFailed'))
      } finally {
        busyRef.current = false
        if (mounted.current) {
          setPending(new Set())
          setBusy(false)
        }
      }
    },
    [mutateAsync, t],
  )
  const stop = useCallback(() => {
    stopped.current = true
  }, [])
  return {
    test,
    pending,
    busy,
    progress,
    error,
    stop,
  }
}
