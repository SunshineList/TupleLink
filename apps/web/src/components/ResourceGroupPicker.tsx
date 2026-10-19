import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useGroupAddNodesMutation, useGroupAddSubscriptionsMutation, useGroupsQuery } from '~/apis'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

export function ResourceGroupPicker({
  resource,
  onClose,
}: {
  resource: { id: string; name: string; type: 'node' | 'subscription' } | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const groups = useGroupsQuery()
  const addNodes = useGroupAddNodesMutation()
  const addSubscriptions = useGroupAddSubscriptionsMutation()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [resource?.id, resource?.type])
  const busy = addNodes.isPending || addSubscriptions.isPending
  return (
    <Dialog
      open={!!resource}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setFailed(false)
          onClose()
        }
      }}
    >
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('panel.addToGroup')}</DialogTitle>
        </DialogHeader>
        <p className="break-words text-sm text-muted-foreground">{resource?.name}</p>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t('panel.saveFailed')}
          </p>
        )}
        {groups.isPending && <p role="status">{t('panel.loading')}</p>}
        {groups.isError && (
          <Button variant="outline" onClick={() => groups.refetch()}>
            {t('panel.retry')}
          </Button>
        )}
        {groups.data?.groups.length === 0 && <p>{t('panel.createGroupFirst')}</p>}
        <div className="max-h-[55dvh] space-y-2 overflow-y-auto overscroll-contain">
          {groups.data?.groups.map((group) => {
            const joined =
              resource?.type === 'node'
                ? group.nodes.some((node) => node.id === resource.id)
                : group.subscriptions.some((binding) => binding.subscription.id === resource?.id)
            return (
              <div key={group.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <span className="min-w-0 break-words text-sm font-medium">{group.name}</span>
                <Button
                  size="sm"
                  variant={joined ? 'secondary' : 'outline'}
                  disabled={joined || busy}
                  onClick={async () => {
                    if (!resource) return
                    setFailed(false)
                    try {
                      if (resource.type === 'node') await addNodes.mutateAsync({ id: group.id, nodeIDs: [resource.id] })
                      else await addSubscriptions.mutateAsync({ id: group.id, subscriptionIDs: [resource.id] })
                      toast.success(t('panel.addedToGroup', { name: group.name }))
                      onClose()
                    } catch {
                      setFailed(true)
                    }
                  }}
                >
                  {joined ? t('panel.joined') : t('panel.join')}
                </Button>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
