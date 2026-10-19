import type { DraggableProvided, DraggableStateSnapshot } from '@hello-pangea/dnd'
import { Draggable } from '@hello-pangea/dnd'
import { GripVertical, MoreHorizontal, Trash2 } from 'lucide-react'
import React, { useState } from 'react'

import { useTranslation } from 'react-i18next'
import { NodeName } from '~/components/NodeName'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/utils'
import { getInstantDropStyle } from '~/utils'

export function SortableSubscriptionCard({
  id,
  index,
  name,
  leftSection,
  onRemove,
  actions,
  children,
}: {
  id: string
  index: number
  name: string
  leftSection?: React.ReactNode
  onRemove: () => void
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <Draggable draggableId={id} index={index}>
        {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            style={getInstantDropStyle(provided, snapshot)}
            data-name-card
            data-subscription-card={id}
            className={cn('subscription-card', snapshot.isDragging && 'opacity-90 shadow-lg z-50')}
          >
            <div className="subscription-card-header">
              <div
                className="subscription-card-handle"
                {...provided.dragHandleProps}
                aria-label={`${t('a11y.dragToReorder')} ${name}`}
              >
                <GripVertical className="h-4 w-4" />
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="min-w-0 text-sm font-semibold">
                  <NodeName name={name} />
                </h3>
                {leftSection && (
                  <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
                    {leftSection}
                  </Badge>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="subscription-card-more"
                    title={t('panel.moreActions')}
                    aria-label={`${t('panel.moreActions')} ${name}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="subscription-actions-menu">
                  {actions}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                    <Trash2 />
                    {t('actions.remove')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="subscription-card-content">{children}</div>
          </div>
        )}
      </Draggable>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('actions.remove')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('confirmModal.removeConfirmDescription')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('confirmModal.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onRemove()
                setConfirmOpen(false)
              }}
            >
              {t('confirmModal.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
