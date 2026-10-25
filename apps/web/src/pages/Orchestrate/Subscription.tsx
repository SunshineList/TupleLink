import type { NodeLatencyProbeResult } from '~/apis'
import type { LatencyTests } from '~/components/LatencyStatus'
import type { QRCodeModalRef } from '~/components/QRCodeModal'
import type { SubscriptionsQuery } from '~/schemas/gql/graphql'
import { Droppable } from '@hello-pangea/dnd'
import dayjs from 'dayjs'
import { ChevronDown, ChevronRight, CloudCog, CloudUpload, Download, Eye, Gauge, Pencil } from 'lucide-react'
import { Fragment, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useImportSubscriptionsMutation,
  useRemoveSubscriptionsMutation,
  useSubscriptionsQuery,
  useTagSubscriptionMutation,
  useUpdateSubscriptionCronMutation,
  useUpdateSubscriptionLinkMutation,
  useUpdateSubscriptionsMutation,
} from '~/apis'
import { EditSubscriptionFormModal } from '~/components/EditSubscriptionFormModal'
import { ImportResourceFormModal } from '~/components/ImportResourceFormModal'
import { LatencyStatus } from '~/components/LatencyStatus'
import { QRCodeModal } from '~/components/QRCodeModal'
import { ResourceEmpty } from '~/components/ResourceEmpty'
import { ResourceGroupPicker } from '~/components/ResourceGroupPicker'
import { Section } from '~/components/Section'
import { SortableSubscriptionCard } from '~/components/SortableSubscriptionCard'
import { Button } from '~/components/ui/button'
import { DropdownMenuItem } from '~/components/ui/dropdown-menu'
import { SimpleTooltip } from '~/components/ui/tooltip'
import { UpdateSubscriptionAction } from '~/components/UpdateSubscriptionAction'
import { useDisclosure } from '~/hooks'
import { cn } from '~/lib/utils'
import { SubscriptionNodes } from './SubscriptionNodes'

export function SubscriptionResource({
  sortedSubscriptions,
  nodeLatencies,
  latencyTests,
}: {
  sortedSubscriptions: SubscriptionsQuery['subscriptions']
  nodeLatencies?: Record<string, NodeLatencyProbeResult>
  latencyTests: LatencyTests
}) {
  const { t } = useTranslation()
  const [addingSubscription, setAddingSubscription] = useState<{
    id: string
    name: string
    type: 'subscription'
  } | null>(null)
  const [limit, setLimit] = useState(30)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = sortedSubscriptions.find((subscription) => subscription.id === viewingId)

  const [openedQRCodeModal, { open: openQRCodeModal, close: closeQRCodeModal }] = useDisclosure(false)
  const [
    openedImportSubscriptionFormModal,
    { open: openImportSubscriptionFormModal, close: closeImportSubscriptionFormModal },
  ] = useDisclosure(false)
  const [
    openedEditSubscriptionFormModal,
    { open: openEditSubscriptionFormModal, close: closeEditSubscriptionFormModal },
  ] = useDisclosure(false)
  const [editingSubscription, setEditingSubscription] = useState<{
    id: string
    link: string
    tag: string
    cronExp: string
    cronEnable: boolean
  }>()
  const qrCodeModalRef = useRef<QRCodeModalRef>(null)
  const subscriptionsRequest = useSubscriptionsQuery()
  const refetchSubscriptions = subscriptionsRequest.refetch
  const removeSubscriptionsMutation = useRemoveSubscriptionsMutation()
  const importSubscriptionsMutation = useImportSubscriptionsMutation()
  const updateSubscriptionsMutation = useUpdateSubscriptionsMutation()
  const updateSubscriptionLinkMutation = useUpdateSubscriptionLinkMutation()
  const tagSubscriptionMutation = useTagSubscriptionMutation()

  const updateSubscriptionCronMutation = useUpdateSubscriptionCronMutation()

  return (
    <Section
      title={t('subscription')}
      count={sortedSubscriptions.length}
      createLabel={t('panel.addSubscription')}
      hideCreate={!subscriptionsRequest.isPending && !subscriptionsRequest.isError && !sortedSubscriptions.length}
      primary
      loading={subscriptionsRequest.isPending}
      error={subscriptionsRequest.isError}
      onRetry={() => refetchSubscriptions()}
      icon={<CloudCog className="h-5 w-5" />}
      iconPlus={<CloudUpload className="h-4 w-4" />}
      onCreate={openImportSubscriptionFormModal}
      bordered
      className="panel-side-section"
      contentClassName="min-h-0 flex-1 overflow-y-auto overscroll-contain panel-side-scroll"
      actions={
        <Fragment>
          {sortedSubscriptions.length > 0 && (
            <SimpleTooltip label={t('latency.testSubscriptions')}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  latencyTests.test(
                    sortedSubscriptions.flatMap((subscription) => subscription.nodes.edges.map((node) => node.id)),
                    'subscriptions',
                  )
                }
                aria-label={t('latency.testSubscriptions')}
                disabled={latencyTests.busy}
              >
                <Gauge className="h-4 w-4" />
              </Button>
            </SimpleTooltip>
          )}
          {sortedSubscriptions.length > 0 && (
            <SimpleTooltip label={t('actions.updateAll')}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  updateSubscriptionsMutation.mutate(sortedSubscriptions.map(({ id }) => id))
                }}
                aria-label={t('panel.updateAll')}
                loading={updateSubscriptionsMutation.isPending}
              >
                <Download className="h-4 w-4" />
              </Button>
            </SimpleTooltip>
          )}
        </Fragment>
      }
    >
      <LatencyStatus tests={latencyTests} scope="subscriptions" />
      {viewing && (
        <SubscriptionNodes
          key={viewing.id}
          subscription={viewing}
          onClose={() => setViewingId(null)}
          tests={latencyTests}
          latencies={nodeLatencies || {}}
        />
      )}
      <Droppable droppableId="subscription-list" type="SUBSCRIPTION">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn('flex flex-col gap-3 min-h-[100px]', snapshot.isDraggingOver && 'bg-primary/5 rounded-lg')}
          >
            {sortedSubscriptions
              .slice(0, limit)
              .map(({ id: subscriptionID, tag, link, updatedAt, cronExp, cronEnable, nodes, status }, index) => (
                <SortableSubscriptionCard
                  key={subscriptionID}
                  id={`subscription-${subscriptionID}`}
                  index={index}
                  name={tag || t('subscription')}
                  leftSection={`${nodes.edges.length} ${t('node')}`}
                  actions={
                    <Fragment>
                      <DropdownMenuItem
                        onSelect={() => {
                          setEditingSubscription({ id: subscriptionID, link, tag: tag || '', cronExp, cronEnable })
                          openEditSubscriptionFormModal()
                        }}
                      >
                        <Pencil />
                        {t('actions.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          qrCodeModalRef.current?.setProps({ name: tag!, link })
                          openQRCodeModal()
                        }}
                      >
                        <Eye />
                        {t('actions.viewQRCode')}
                      </DropdownMenuItem>
                    </Fragment>
                  }
                  onRemove={() => removeSubscriptionsMutation.mutate([subscriptionID])}
                >
                  <div className="subscription-card-meta">
                    <time
                      dateTime={dayjs(updatedAt).toISOString()}
                      title={dayjs(updatedAt).format('YYYY-MM-DD HH:mm:ss')}
                    >
                      {t('panel.lastUpdated')} {dayjs(updatedAt).format('MM-DD HH:mm')}
                    </time>
                    {status === 'ok' && <span className="subscription-update-ok">{t('panel.updateSuccess')}</span>}
                    {cronEnable && (
                      <span className="subscription-auto" title={cronExp}>
                        {t('panel.autoUpdate')}
                      </span>
                    )}
                  </div>
                  <div className="subscription-card-footer">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="subscription-view"
                      onClick={() => setViewingId(subscriptionID)}
                    >
                      {t('panel.viewSubscriptionNodes')}
                      <ChevronRight />
                    </Button>
                    <UpdateSubscriptionAction
                      id={subscriptionID}
                      loading={updateSubscriptionsMutation.isPending}
                      quiet
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setAddingSubscription({
                          id: subscriptionID,
                          name: tag || t('subscription'),
                          type: 'subscription',
                        })
                      }
                    >
                      {t('panel.addToGroup')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="subscription-details-toggle"
                      aria-label={t('panel.subscriptionDetails')}
                      aria-expanded={expandedId === subscriptionID}
                      aria-controls={`subscription-details-${subscriptionID}`}
                      onClick={() => setExpandedId(expandedId === subscriptionID ? null : subscriptionID)}
                    >
                      {t('panel.details')}
                      <ChevronDown className={cn(expandedId === subscriptionID && 'rotate-180')} />
                    </Button>
                  </div>
                  {expandedId === subscriptionID && (
                    <div id={`subscription-details-${subscriptionID}`} className="subscription-card-details">
                      <p className="break-words font-medium text-foreground">{tag || t('subscription')}</p>
                      <p>
                        {t('panel.lastUpdated')}：{dayjs(updatedAt).format('YYYY-MM-DD HH:mm:ss')}
                      </p>
                      {cronEnable && (
                        <p>
                          {t('panel.autoUpdate')} <code>{cronExp}</code>
                        </p>
                      )}
                      <Spoiler label={link} showLabel={t('actions.show sensitive')} hideLabel={t('actions.hide')} />
                    </div>
                  )}
                </SortableSubscriptionCard>
              ))}
            {!subscriptionsRequest.isPending && !subscriptionsRequest.isError && !sortedSubscriptions.length && (
              <ResourceEmpty
                title={t('panel.noSubscriptions')}
                description={t('panel.noSubscriptionsDescription')}
                action={t('panel.addSubscription')}
                onAction={openImportSubscriptionFormModal}
              />
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {sortedSubscriptions.length > limit && (
        <Button variant="outline" onClick={() => setLimit((value) => value + 30)}>
          {t('panel.showMore', { count: sortedSubscriptions.length - limit })}
        </Button>
      )}
      {updateSubscriptionsMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.updateFailed')}
        </p>
      )}
      <ResourceGroupPicker resource={addingSubscription} onClose={() => setAddingSubscription(null)} />
      <QRCodeModal ref={qrCodeModalRef} opened={openedQRCodeModal} onClose={closeQRCodeModal} />

      <ImportResourceFormModal
        title={t('subscription')}
        opened={openedImportSubscriptionFormModal}
        onClose={closeImportSubscriptionFormModal}
        handleSubmit={async (values) => {
          await importSubscriptionsMutation.mutateAsync(
            values.resources.map(({ link, tag }) => ({ link, tag: tag.trim() || undefined })),
          )
        }}
      />

      <EditSubscriptionFormModal
        opened={openedEditSubscriptionFormModal}
        onClose={closeEditSubscriptionFormModal}
        subscription={editingSubscription}
        onSubmit={async (values) => {
          // Update subscription link if changed
          if (values.link !== editingSubscription?.link) {
            await updateSubscriptionLinkMutation.mutateAsync({
              id: values.id,
              link: values.link,
            })
          }

          // Update subscription tag if changed
          if (values.tag !== editingSubscription?.tag) {
            await tagSubscriptionMutation.mutateAsync({
              id: values.id,
              tag: values.tag,
            })
          }

          // Update subscription cron if changed
          if (
            values.cronExp !== editingSubscription?.cronExp ||
            values.cronEnable !== editingSubscription?.cronEnable
          ) {
            await updateSubscriptionCronMutation.mutateAsync({
              id: values.id,
              cronExp: values.cronExp,
              cronEnable: values.cronEnable,
            })
          }

          await refetchSubscriptions()
          closeEditSubscriptionFormModal()
        }}
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
