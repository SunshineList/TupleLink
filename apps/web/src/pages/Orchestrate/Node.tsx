import type { NodeLatencyProbeResult } from '~/apis'
import type { QRCodeModalRef } from '~/components/QRCodeModal'
import type { LibraryNode, NodeFilters } from '~/utils/node-library'
import { Droppable } from '@hello-pangea/dnd'
import { Cloud, CloudUpload, Eye, FileInput, Pencil, Search } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useImportNodesMutation, useRemoveNodesMutation } from '~/apis'
import { ConfigureNodeFormModal, SortableNodeCard } from '~/components'
import { EditNodeFormModal } from '~/components/EditNodeFormModal'
import { ImportResourceFormModal } from '~/components/ImportResourceFormModal'
import { QRCodeModal } from '~/components/QRCodeModal'
import { ResourceEmpty } from '~/components/ResourceEmpty'
import { ResourceGroupPicker } from '~/components/ResourceGroupPicker'
import { Section } from '~/components/Section'
import { Button } from '~/components/ui/button'
import { SimpleTooltip } from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'
import { formatLatencyLabel } from '~/utils/latency'
import { defaultNodeFilters } from '~/utils/node-library'

export const NODE_DROPPABLE_ID = 'node-list'

export function NodeResource({
  nodes,
  totalCount,
  filters,
  onFiltersChange,
  sources,
  highlight,
  nodeLatencies,
  loading,
  error,
  onRetry,
  dragging,
}: {
  nodes: LibraryNode[]
  totalCount: number
  filters: NodeFilters
  onFiltersChange: (value: NodeFilters) => void
  sources: Array<{ id: string; name: string }>
  highlight?: boolean
  nodeLatencies?: Record<string, NodeLatencyProbeResult>
  loading?: boolean
  error?: boolean
  onRetry: () => void
  dragging: boolean
}) {
  const { t } = useTranslation()
  const [limit, setLimit] = useState(6)
  useEffect(() => {
    setLimit(6)
  }, [filters])
  const [openedQRCodeModal, setOpenedQRCodeModal] = useState(false)
  const [openedImportNodeFormModal, setOpenedImportNodeFormModal] = useState(false)
  const [openedConfigureNodeFormModal, setOpenedConfigureNodeFormModal] = useState(false)
  const [openedEditNodeFormModal, setOpenedEditNodeFormModal] = useState(false)
  const [editingNode, setEditingNode] = useState<{ id: string; link: string; tag: string; name: string }>()
  const [addingNode, setAddingNode] = useState<{ id: string; name: string; type: 'node' } | null>(null)
  const qrCodeModalRef = useRef<QRCodeModalRef>(null)
  const removeNodesMutation = useRemoveNodesMutation()
  const importNodesMutation = useImportNodesMutation()
  return (
    <Section
      title={t('node')}
      count={totalCount}
      createLabel={t('panel.importNode')}
      icon={<Cloud className="h-5 w-5" />}
      iconPlus={<CloudUpload className="h-4 w-4" />}
      onCreate={() => setOpenedImportNodeFormModal(true)}
      loading={loading}
      error={error}
      onRetry={onRetry}
      bordered
      highlight={highlight}
      actions={
        <SimpleTooltip label={t('actions.configureNode')}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('actions.configureNode')}
            onClick={() => setOpenedConfigureNodeFormModal(true)}
          >
            <FileInput aria-hidden="true" className="h-4 w-4" />
          </Button>
        </SimpleTooltip>
      }
    >
      {totalCount > 0 && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 rounded-lg border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="sr-only">{t('panel.searchNodes')}</span>
            <input
              type="search"
              autoComplete="off"
              spellCheck={false}
              name="node-search"
              value={filters.search}
              disabled={dragging}
              onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
              placeholder={t('panel.searchPlaceholder')}
              className="h-10 w-full min-w-0 bg-transparent text-sm outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0">
              <span className="sr-only">{t('panel.source')}</span>
              <select
                className="panel-select"
                value={filters.source}
                disabled={dragging}
                onChange={(event) => onFiltersChange({ ...filters, source: event.target.value })}
              >
                <option value="all">{t('panel.allSources')}</option>
                <option value="manual">{t('panel.manual')}</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">{t('panel.sort')}</span>
              <select
                className="panel-select"
                value={filters.sort}
                disabled={dragging}
                onChange={(event) => onFiltersChange({ ...filters, sort: event.target.value as NodeFilters['sort'] })}
              >
                <option value="custom">{t('panel.defaultSort')}</option>
                <option value="latency">{t('panel.latencySort')}</option>
              </select>
            </label>
          </div>
          {filters.sort === 'latency' && <p className="text-xs text-muted-foreground">{t('panel.filtersReorder')}</p>}
        </div>
      )}
      <Droppable droppableId={NODE_DROPPABLE_ID} type="NODE">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn('flex min-h-24 flex-col gap-3', snapshot.isDraggingOver && 'rounded-lg bg-primary/5')}
          >
            {nodes
              .slice(0, limit)
              .map(({ node: { id, name, tag, protocol, link }, sources: nodeSources, editable }, index) => (
                <SortableNodeCard
                  key={id}
                  id={`node-${id}`}
                  index={index}
                  name={tag || name}
                  leftSection={protocol}
                  actions={
                    <Fragment>
                      {editable && (
                        <SimpleTooltip label={t('actions.edit')}>
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label={`${t('actions.edit')} ${tag || name}`}
                            className="h-7 w-7 p-0 text-muted-foreground"
                            onClick={() => {
                              setEditingNode({ id, link, tag: tag || '', name: name || '' })
                              setOpenedEditNodeFormModal(true)
                            }}
                          >
                            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                          </Button>
                        </SimpleTooltip>
                      )}
                      <SimpleTooltip label={t('actions.viewQRCode')}>
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`${t('actions.viewQRCode')} ${tag || name}`}
                          className="h-7 w-7 p-0 text-muted-foreground"
                          onClick={() => {
                            qrCodeModalRef.current?.setProps({ name: tag || name || '', link })
                            setOpenedQRCodeModal(true)
                          }}
                        >
                          <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                        </Button>
                      </SimpleTooltip>
                    </Fragment>
                  }
                  onRemove={editable ? () => removeNodesMutation.mutate([id]) : undefined}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span
                      className="min-w-0 truncate text-muted-foreground"
                      title={nodeSources.map((source) => source.name).join(' · ')}
                    >
                      {nodeSources.length ? nodeSources.map((source) => source.name).join(' · ') : t('panel.manual')}
                    </span>
                    <span
                      className="font-medium tabular-nums"
                      title={
                        nodeLatencies?.[id]?.testedAt
                          ? t('panel.sampleTime', { time: new Date(nodeLatencies[id].testedAt).toLocaleString() })
                          : undefined
                      }
                    >
                      {formatLatencyLabel(nodeLatencies?.[id], t) || t('panel.notTested')}
                    </span>
                  </div>
                  {tag && name && name !== tag && (
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={name}>
                      {name}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <Spoiler label={link} showLabel={t('actions.show sensitive')} hideLabel={t('actions.hide')} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAddingNode({ id, name: tag || name || '', type: 'node' })}
                    >
                      {t('panel.addToGroup')}
                    </Button>
                  </div>
                </SortableNodeCard>
              ))}
            {!loading && !error && !totalCount && (
              <ResourceEmpty
                title={t('panel.noNodes')}
                description={t('panel.noNodesDescription')}
                action={t('panel.importNode')}
                onAction={() => setOpenedImportNodeFormModal(true)}
              />
            )}
            {!loading && totalCount > 0 && !nodes.length && (
              <ResourceEmpty
                title={t('panel.noMatches')}
                description={t('panel.noMatchesDescription')}
                action={t('panel.clearFilters')}
                onAction={() => onFiltersChange(defaultNodeFilters)}
              />
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
      {nodes.length > limit && (
        <Button variant="outline" disabled={dragging} onClick={() => setLimit((value) => value + 6)}>
          {t('panel.showMore', { count: nodes.length - limit })}
        </Button>
      )}
      <ResourceGroupPicker resource={addingNode} onClose={() => setAddingNode(null)} />
      <QRCodeModal ref={qrCodeModalRef} opened={openedQRCodeModal} onClose={() => setOpenedQRCodeModal(false)} />
      <ImportResourceFormModal
        title={t('node')}
        opened={openedImportNodeFormModal}
        onClose={() => setOpenedImportNodeFormModal(false)}
        handleSubmit={async (values) => {
          await importNodesMutation.mutateAsync(values.resources.map(({ link, tag }) => ({ link, tag })))
        }}
      />
      <ConfigureNodeFormModal
        opened={openedConfigureNodeFormModal}
        onClose={() => setOpenedConfigureNodeFormModal(false)}
      />
      <EditNodeFormModal
        opened={openedEditNodeFormModal}
        onClose={() => setOpenedEditNodeFormModal(false)}
        node={editingNode}
      />
    </Section>
  )
}

function Spoiler({ label, showLabel, hideLabel }: { label: string; showLabel: string; hideLabel: string }) {
  const [show, setShow] = useState(false)

  return (
    <div>
      {show && <p className="text-sm break-all">{label}</p>}
      <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShow(!show)}>
        {show ? hideLabel : showLabel}
      </button>
    </div>
  )
}
