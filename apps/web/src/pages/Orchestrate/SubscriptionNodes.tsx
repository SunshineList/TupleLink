import type { NodeLatencyProbeResult } from '~/apis'
import type { LatencyTests } from '~/components/LatencyStatus'
import type { QRCodeModalRef } from '~/components/QRCodeModal'
import type { SubscriptionsQuery } from '~/schemas/gql/graphql'
import { Eye, Gauge, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LatencyStatus } from '~/components/LatencyStatus'
import { NodePagination } from '~/components/NodePagination'
import { QRCodeModal } from '~/components/QRCodeModal'
import { ResourceGroupPicker } from '~/components/ResourceGroupPicker'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet'
import { useMediaQuery } from '~/hooks'
import { formatLatencyLabel } from '~/utils/latency'
import { buildNodeLibrary, defaultNodeFilters, filterNodeLibrary } from '~/utils/node-library'

export function SubscriptionNodes({
  subscription,
  onClose,
  tests,
  latencies,
}: {
  subscription: SubscriptionsQuery['subscriptions'][number]
  onClose: () => void
  tests: LatencyTests
  latencies: Record<string, NodeLatencyProbeResult>
}) {
  const { t } = useTranslation()
  const mobile = useMediaQuery('(max-width: 559px)')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'custom' | 'latency'>('custom')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState<number | null>(null)
  const pageSize = size ?? (mobile ? 4 : 12)
  const [adding, setAdding] = useState<{ id: string; name: string; type: 'node' } | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [showLink, setShowLink] = useState(false)
  const qrRef = useRef<QRCodeModalRef>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const library = useMemo(() => buildNodeLibrary([], [subscription]), [subscription])
  const detail = library.find(({ node }) => node.id === detailId)?.node
  const filtered = useMemo(
    () => filterNodeLibrary(library, { ...defaultNodeFilters, search, sort }, latencies),
    [library, search, sort, latencies],
  )
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages - 1)
  const changePage = (value: number) => {
    setPage(value)
    gridRef.current?.scrollTo({ top: 0 })
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <DialogContent className="subscription-browser" data-subscription-browser={subscription.id}>
          <DialogHeader className="shrink-0 pr-8 text-left">
            <DialogTitle className="break-words leading-snug">
              {subscription.tag || t('subscription')} · {t('panel.subscriptionNodes')}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">{t('panel.subscriptionNodesHint')}</p>
          </DialogHeader>
          <div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="flex min-w-0 items-center gap-2 rounded-lg border px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{t('panel.searchNodes')}</span>
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  changePage(0)
                }}
                placeholder={t('panel.searchPlaceholder')}
                className="h-11 w-full min-w-0 bg-transparent text-base outline-none"
              />
            </label>
            <Button
              variant="outline"
              disabled={tests.busy || !filtered.length}
              onClick={() => tests.test(filtered.map(({ node }) => node.id))}
            >
              <Gauge />
              {t('latency.testFiltered')}
            </Button>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t('panel.sort')}</span>
              <select
                className="panel-select"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as typeof sort)
                  changePage(0)
                }}
              >
                <option value="custom">{t('panel.defaultSort')}</option>
                <option value="latency">{t('panel.latencySort')}</option>
              </select>
            </label>
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t('panel.pageSize')}</span>
              <select
                className="panel-select"
                value={pageSize}
                onChange={(event) => {
                  setSize(Number(event.target.value))
                  changePage(0)
                }}
              >
                {[4, 12, 24, 48].map((count) => (
                  <option key={count} value={count}>
                    {t('panel.nodesPerPage', { count })}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-muted-foreground" role="status">
              {t('panel.filteredNodes', { count: filtered.length, total: library.length })}
            </span>
          </div>
          <LatencyStatus tests={tests} />
          <div className="subscription-node-grid" ref={gridRef} role="list" aria-label={t('panel.subscriptionNodes')}>
            {filtered.slice(current * pageSize, (current + 1) * pageSize).map(({ node }) => {
              const name = node.tag || node.name || node.id
              const latency = latencies[node.id]
              return (
                <article
                  key={node.id}
                  role="listitem"
                  data-subscription-node={node.id}
                  className="subscription-node-tile"
                >
                  <button
                    type="button"
                    className="break-words text-left text-sm font-medium leading-snug hover:text-primary"
                    title={name}
                    aria-label={`${t('panel.nodeDetails')} ${name}`}
                    onClick={() => {
                      setDetailId(node.id)
                      setShowLink(false)
                    }}
                  >
                    {name}
                  </button>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{node.protocol}</span>
                    <span
                      className="tabular-nums"
                      title={latency?.testedAt ? new Date(latency.testedAt).toLocaleString() : undefined}
                    >
                      {formatLatencyLabel(latency, t) || t('panel.notTested')}
                    </span>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={tests.pending.has(node.id)}
                      disabled={tests.busy}
                      aria-label={`${t('latency.testNode')} ${name}`}
                      onClick={() => tests.test([node.id])}
                    >
                      <Gauge />
                      {t('latency.test')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdding({ id: node.id, name, type: 'node' })}>
                      {t('panel.addToGroup')}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`${t('actions.viewQRCode')} ${name}`}
                      onClick={() => {
                        qrRef.current?.setProps({ name, link: node.link })
                        setQrOpen(true)
                      }}
                    >
                      <Eye />
                    </Button>
                  </div>
                </article>
              )
            })}
            {!filtered.length && (
              <p className="col-span-full p-6 text-center text-sm text-muted-foreground">
                {library.length ? t('panel.noMatches') : t('panel.noNodes')}
              </p>
            )}
          </div>
          <NodePagination page={current} pages={pages} onChange={changePage} />
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader className="pr-10">
            <SheetTitle>{t('panel.nodeDetails')}</SheetTitle>
            <SheetDescription className="break-words">{detail?.name}</SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="space-y-4 px-4 pb-6">
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">{t('panel.source')}</dt>
                  <dd>{subscription.tag}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('panel.protocol')}</dt>
                  <dd>{detail.protocol}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('panel.nodeLatency')}</dt>
                  <dd>{formatLatencyLabel(latencies[detail.id], t) || t('panel.notTested')}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={tests.busy}
                  loading={tests.pending.has(detail.id)}
                  onClick={() => tests.test([detail.id])}
                >
                  {t('latency.testNode')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAdding({ id: detail.id, name: detail.name || '', type: 'node' })}
                >
                  {t('panel.addToGroup')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    qrRef.current?.setProps({ name: detail.name || '', link: detail.link })
                    setQrOpen(true)
                  }}
                >
                  {t('actions.viewQRCode')}
                </Button>
              </div>
              <Button variant="ghost" aria-expanded={showLink} onClick={() => setShowLink((value) => !value)}>
                {showLink ? t('actions.hide') : t('actions.show sensitive')}
              </Button>
              {showLink && <p className="break-all rounded-lg bg-muted p-3 font-mono text-xs">{detail.link}</p>}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <ResourceGroupPicker resource={adding} onClose={() => setAdding(null)} />
      <QRCodeModal ref={qrRef} opened={qrOpen} onClose={() => setQrOpen(false)} />
    </>
  )
}
