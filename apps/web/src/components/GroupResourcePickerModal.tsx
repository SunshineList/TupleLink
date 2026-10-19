import type { NodeLatencyProbeResult } from '~/apis'
import type { LatencyTests } from '~/components/LatencyStatus'
import { Gauge, Search } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LatencyBadge } from '~/components/LatencyBadge'
import { LatencyStatus } from '~/components/LatencyStatus'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Dialog, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import {
  ScrollableDialogBody,
  ScrollableDialogContent,
  ScrollableDialogFooter,
  ScrollableDialogHeader,
} from '~/components/ui/scrollable-dialog'
import { cn } from '~/lib/utils'
import { summarizePickerLatencies } from '~/utils/picker-latency'

export interface GroupPickerItem {
  id: string
  title: string
  description?: string
  meta?: string
  badge?: string
  keywords?: string[]
  previewNodes?: GroupPickerPreviewNode[]
}

export interface GroupPickerPreviewNode {
  id: string
  title: string
  protocol?: string
}

interface PickerLatencyProps {
  tests: LatencyTests
  latencies?: Record<string, NodeLatencyProbeResult>
}

// A dialog only stops the queue it started, preserving completed shared results.
function usePickerTests(tests: LatencyTests) {
  const owned = useRef(false)
  const stop = tests.stop
  useEffect(
    () => () => {
      if (owned.current) stop()
    },
    [stop],
  )
  const test = useCallback(
    async (ids: string[]) => {
      if (owned.current || tests.busy || !ids.length) return
      owned.current = true
      try {
        await tests.test(ids)
      } finally {
        owned.current = false
      }
    },
    [tests.busy, tests.test],
  )
  return {
    test,
    stop: () => {
      if (owned.current) stop()
    },
  }
}

const PickerLatencyButton = memo(
  ({
    id,
    name,
    result,
    pending,
    busy,
    onTest,
  }: {
    id: string
    name: string
    result?: NodeLatencyProbeResult
    pending: boolean
    busy: boolean
    onTest: (ids: string[]) => Promise<void>
  }) => {
    const { t } = useTranslation()
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="px-1"
        loading={pending}
        disabled={busy}
        aria-label={`${t('latency.testNode')} ${name}`}
        onClick={() => onTest([id])}
      >
        {!result && !pending && <Gauge aria-hidden="true" />}
        <LatencyBadge result={result} fallback={t('latency.test')} />
      </Button>
    )
  },
)

const PickerNodeCard = memo(
  ({
    item,
    checked,
    result,
    pending,
    busy,
    onToggle,
    onTest,
  }: {
    item: GroupPickerItem
    checked: boolean
    result?: NodeLatencyProbeResult
    pending: boolean
    busy: boolean
    onToggle: (id: string) => void
    onTest: (ids: string[]) => Promise<void>
  }) => {
    const { t } = useTranslation()
    return (
      <article
        data-picker-node={item.id}
        className={cn(
          'min-w-0 rounded-lg border p-3 transition-colors hover:border-primary/30',
          checked && 'border-primary bg-primary/5',
        )}
        onClick={(event) => {
          if (!(event.target as Element).closest('button,[role="checkbox"]')) onToggle(item.id)
        }}
      >
        <div className="flex min-w-0 items-start gap-3">
          <Checkbox
            checked={checked}
            className="mt-1 shrink-0"
            aria-label={`${t('actions.select')} ${item.title}`}
            onCheckedChange={() => onToggle(item.id)}
          />
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            aria-pressed={checked}
            aria-label={`${t('actions.select')} ${item.title}`}
            onClick={() => onToggle(item.id)}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-words text-sm font-medium">{item.title}</span>
              {item.badge && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                  {item.badge}
                </span>
              )}
            </span>
            {item.description && (
              <span className="mt-1 block truncate text-xs text-muted-foreground" title={item.description}>
                {item.description}
              </span>
            )}
            {item.meta && <span className="mt-1 block truncate text-xs text-muted-foreground">{item.meta}</span>}
          </button>
        </div>
        <div className="mt-2 flex justify-end">
          <PickerLatencyButton
            id={item.id}
            name={item.title}
            result={result}
            pending={pending}
            busy={busy}
            onTest={onTest}
          />
        </div>
      </article>
    )
  },
)

export function GroupAddNodesModal({
  opened,
  onClose,
  groupName,
  items,
  loading,
  resetKey,
  onSubmit,
  tests,
  latencies,
}: {
  opened: boolean
  onClose: () => void
  groupName: string
  items: GroupPickerItem[]
  loading?: boolean
  resetKey: string
  onSubmit: (ids: string[]) => Promise<void>
} & PickerLatencyProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submitError, setSubmitError] = useState('')
  const pickerTests = usePickerTests(tests)
  useEffect(() => {
    setQuery('')
    setSelectedIds([])
    setSubmitError('')
  }, [opened, resetKey])
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized
      ? items.filter((item) =>
          [item.title, item.description, item.meta, ...(item.keywords || [])].some((value) =>
            value?.toLowerCase().includes(normalized),
          ),
        )
      : items
  }, [items, query])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const toggleItem = useCallback((id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }, [])
  const handleClose = () => {
    if (loading) return
    pickerTests.stop()
    onClose()
  }
  const handleSubmit = async () => {
    if (!selectedIds.length || loading) return
    setSubmitError('')
    try {
      await onSubmit(selectedIds)
      handleClose()
    } catch {
      setSubmitError(t('panel.saveFailed'))
    }
  }
  return (
    <Dialog
      open={opened}
      onOpenChange={(next) => {
        if (!next) handleClose()
      }}
    >
      <ScrollableDialogContent
        size="xl"
        data-node-picker
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (loading) event.preventDefault()
        }}
      >
        <ScrollableDialogHeader>
          <div className="pr-8">
            <DialogTitle>{t('groupPicker.addNodesTitle', { name: groupName })}</DialogTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('groupPicker.selectedCount', { count: selectedIds.length })}
            </p>
          </div>
        </ScrollableDialogHeader>
        <div className="shrink-0 space-y-3 border-b px-6 py-3">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1 basis-[220px]">
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t('groupPicker.searchNodesPlaceholder')}
                placeholder={t('groupPicker.searchNodesPlaceholder')}
                icon={<Search className="h-4 w-4" />}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={tests.busy || !filteredItems.length}
              onClick={() => pickerTests.test(filteredItems.map((item) => item.id))}
            >
              <Gauge />
              {t('latency.testFiltered')}
            </Button>
          </div>
          <LatencyStatus tests={tests} />
        </div>
        <ScrollableDialogBody>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3">
            {filteredItems.map((item) => (
              <PickerNodeCard
                key={item.id}
                item={item}
                checked={selected.has(item.id)}
                result={latencies?.[item.id]}
                pending={tests.pending.has(item.id)}
                busy={tests.busy}
                onTest={pickerTests.test}
                onToggle={toggleItem}
              />
            ))}
            {!filteredItems.length && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t(query.trim() ? 'groupPicker.noSearchResults' : 'groupPicker.noAvailableNodes')}
              </p>
            )}
          </div>
        </ScrollableDialogBody>
        <ScrollableDialogFooter>
          {submitError && (
            <p role="alert" className="mr-auto text-xs text-destructive">
              {submitError}
            </p>
          )}
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={loading} disabled={!selectedIds.length || loading}>
            {t('groupPicker.addSelectedNodes')}
          </Button>
        </ScrollableDialogFooter>
      </ScrollableDialogContent>
    </Dialog>
  )
}

export function GroupAddSubscriptionsModal({
  opened,
  onClose,
  groupName,
  items,
  loading,
  resetKey,
  onSubmit,
  tests,
  latencies,
}: {
  opened: boolean
  onClose: () => void
  groupName: string
  items: GroupPickerItem[]
  loading?: boolean
  resetKey: string
  onSubmit: (values: { ids: string[]; nameFilterRegex?: string | null }) => Promise<void>
} & PickerLatencyProps) {
  const { t } = useTranslation()
  const pickerTests = usePickerTests(tests)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [nameFilterRegex, setNameFilterRegex] = useState('')
  const [serverRegexError, setServerRegexError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    setQuery('')
    setSelectedIds([])
    setNameFilterRegex('')
    setServerRegexError(null)
    setSubmitError(null)
  }, [opened, resetKey])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return items

    return items.filter((item) =>
      [item.title, item.description, item.meta, ...(item.keywords || [])]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery)),
    )
  }, [items, query])

  const selectedItems = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds])

  const trimmedRegex = nameFilterRegex.trim()

  const clientRegexError = useMemo(() => {
    if (!trimmedRegex) return null
    try {
      // Validate user input before sending it to the backend.
      new RegExp(trimmedRegex).test('')
      return null
    } catch (error) {
      return error instanceof Error ? error.message : t('groupPicker.invalidRegex')
    }
  }, [trimmedRegex, t])

  const regexError = clientRegexError || serverRegexError

  const previewGroups = useMemo(() => {
    const regex = trimmedRegex && !regexError ? new RegExp(trimmedRegex) : null

    return selectedItems.map((item) => {
      const allNodes = item.previewNodes || []
      const matchedNodes = regex ? allNodes.filter((node) => regex.test(node.title)) : allNodes

      return {
        item,
        matchedNodes,
      }
    })
  }, [regexError, selectedItems, trimmedRegex])

  const totalMatchedNodes = previewGroups.reduce((sum, group) => sum + group.matchedNodes.length, 0)

  const toggleItem = (id: string) => {
    setServerRegexError(null)
    setSubmitError(null)
    setSelectedIds((current) => (current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]))
  }

  const handleClose = () => {
    if (loading) return
    pickerTests.stop()
    onClose()
    setQuery('')
    setSelectedIds([])
    setNameFilterRegex('')
    setServerRegexError(null)
    setSubmitError(null)
  }

  const submitDisabled =
    selectedIds.length === 0 || !!regexError || !!loading || (trimmedRegex.length > 0 && totalMatchedNodes === 0)

  const handleSubmit = async () => {
    if (submitDisabled) return

    try {
      await onSubmit({
        ids: selectedIds,
        nameFilterRegex: trimmedRegex || null,
      })
      handleClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('groupPicker.invalidRegex')
      const normalizedMessage = message.toLowerCase()
      if (
        trimmedRegex &&
        (normalizedMessage.includes('regex') ||
          normalizedMessage.includes('regexp') ||
          normalizedMessage.includes('pattern'))
      ) {
        setServerRegexError(message)
        return
      }
      setSubmitError(message)
    }
  }

  return (
    <Dialog open={opened} onOpenChange={(nextOpen) => !nextOpen && !loading && handleClose()}>
      <ScrollableDialogContent
        size="xl"
        data-subscription-picker
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (loading) event.preventDefault()
        }}
      >
        <ScrollableDialogHeader>
          <div className="pr-8">
            <DialogTitle>{t('groupPicker.addSubscriptionsTitle', { name: groupName })}</DialogTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('groupPicker.selectedCount', { count: selectedIds.length })}
            </p>
          </div>
        </ScrollableDialogHeader>

        <ScrollableDialogBody className="flex flex-col gap-4">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSubmitError(null)
            }}
            placeholder={t('groupPicker.searchSubscriptionsPlaceholder')}
            icon={<Search className="h-4 w-4" />}
          />

          <LatencyStatus tests={tests} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3">
            {filteredItems.map((item) => {
              const checked = selectedIds.includes(item.id)
              const match = trimmedRegex && !regexError ? new RegExp(trimmedRegex) : null
              const nodes = (item.previewNodes || []).filter((node) => !match || match.test(node.title))
              const summary = summarizePickerLatencies(
                nodes.map((node) => node.id),
                latencies,
              )
              return (
                <article
                  key={item.id}
                  data-picker-subscription={item.id}
                  className={cn('min-w-0 rounded-lg border p-3', checked && 'border-primary bg-primary/5')}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={checked}
                      aria-label={`${t('actions.select')} ${item.title}`}
                      onCheckedChange={() => toggleItem(item.id)}
                    />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
                      aria-pressed={checked}
                      onClick={() => toggleItem(item.id)}
                    >
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{item.meta}</span>
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`${t('groupPicker.testSubscription')} ${item.title}`}
                      disabled={tests.busy || !!regexError || !nodes.length}
                      onClick={() => pickerTests.test(nodes.map((node) => node.id))}
                    >
                      <Gauge />
                      {t('latency.test')}
                    </Button>
                    {summary.fastest && (
                      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {t('groupPicker.fastest')}
                        <LatencyBadge result={summary.fastest} />
                      </span>
                    )}
                  </div>
                  {summary.measured > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('groupPicker.testSummary', {
                        count: summary.measured,
                        total: summary.total,
                        alive: summary.alive,
                      })}
                    </p>
                  )}
                </article>
              )
            })}
            {!filteredItems.length && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t(query.trim() ? 'groupPicker.noSearchResults' : 'groupPicker.noAvailableSubscriptions')}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border/70 bg-card/60 p-4">
            <Input
              label={t('groupPicker.subscriptionRegexLabel')}
              value={nameFilterRegex}
              onChange={(e) => {
                setNameFilterRegex(e.target.value)
                setServerRegexError(null)
                setSubmitError(null)
              }}
              placeholder={t('groupPicker.subscriptionRegexPlaceholder')}
              error={regexError || undefined}
            />
            <p className="mt-2 text-xs text-muted-foreground">{t('groupPicker.subscriptionRegexHint')}</p>
          </div>

          <div className="rounded-lg border border-border/70 bg-card/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t('groupPicker.subscriptionPreviewTitle')}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {trimmedRegex
                    ? t('groupPicker.subscriptionPreviewSummary', { count: totalMatchedNodes })
                    : t('groupPicker.subscriptionPreviewUnfiltered')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={tests.busy || !!regexError || !totalMatchedNodes}
                onClick={() =>
                  pickerTests.test(previewGroups.flatMap((group) => group.matchedNodes.map((node) => node.id)))
                }
              >
                <Gauge />
                {t('groupPicker.testMatched')}
              </Button>
            </div>

            {selectedItems.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">{t('groupPicker.subscriptionPreviewSelectFirst')}</p>
            ) : previewGroups.every((group) => group.matchedNodes.length === 0) ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {trimmedRegex
                  ? t('groupPicker.subscriptionPreviewEmpty')
                  : t('groupPicker.subscriptionPreviewUnfiltered')}
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {previewGroups.map(({ item, matchedNodes }) => (
                  <div key={item.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{item.title}</p>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t('groupPicker.subscriptionPreviewMatchedCount', { count: matchedNodes.length })}
                      </span>
                    </div>

                    {matchedNodes.length > 0 ? (
                      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2">
                        {matchedNodes.map((node) => (
                          <div
                            key={node.id}
                            data-picker-preview-node={node.id}
                            className="flex min-w-0 flex-wrap items-center justify-between gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                          >
                            <span className="min-w-0 flex-1 basis-[100px] truncate" title={node.title}>
                              {node.title}
                            </span>
                            <PickerLatencyButton
                              id={node.id}
                              name={node.title}
                              result={latencies?.[node.id]}
                              pending={tests.pending.has(node.id)}
                              busy={tests.busy || !!regexError}
                              onTest={pickerTests.test}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {t('groupPicker.subscriptionPreviewNoMatchForItem')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollableDialogBody>

        <ScrollableDialogFooter>
          {submitError && <p className="mr-auto text-xs text-destructive">{submitError}</p>}
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={loading} disabled={submitDisabled}>
            {t('groupPicker.addSelectedSubscriptions')}
          </Button>
        </ScrollableDialogFooter>
      </ScrollableDialogContent>
    </Dialog>
  )
}
