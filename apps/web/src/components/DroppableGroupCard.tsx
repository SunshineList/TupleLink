import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import { Check, ChevronDown, GripVertical, Trash2, Type, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { SimpleTooltip } from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'

export function DroppableGroupCard({
  name,
  summary,
  collapsed,
  dragHandleProps,
  onToggleCollapsed,
  onRemove,
  onRename,
  actions,
  quickActions,
  children,
}: {
  id: string
  name: string
  summary?: React.ReactNode
  collapsed?: boolean
  dragHandleProps?: DraggableProvidedDragHandleProps | null
  onToggleCollapsed?: () => void
  onRemove?: () => void
  onRename?: (newName: string) => void
  actions?: React.ReactNode
  quickActions?: React.ReactNode
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)
  const membersId = useId()

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    setEditValue(name)
  }, [name])

  const handleStartEdit = () => {
    setEditValue(name)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setEditValue(name)
    setIsEditing(false)
  }

  const handleSaveEdit = () => {
    const trimmedValue = editValue.trim()
    if (trimmedValue && trimmedValue !== name) {
      onRename?.(trimmedValue)
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  return (
    <>
      <Card
        withBorder
        shadow="none"
        padding="sm"
        className={cn(
          'gap-2 rounded-xl transition-colors',
          onToggleCollapsed && !isEditing && 'cursor-pointer hover:border-primary/40',
        )}
        onClick={(event) => {
          if (!onToggleCollapsed || isEditing || event.defaultPrevented) return
          const target = event.target as Element
          if (
            target.closest(
              'button,a,input,select,textarea,[role="button"],[role="checkbox"],[data-rfd-drag-handle-draggable-id],[data-group-members]',
            )
          )
            return
          if (window.getSelection()?.toString()) return
          onToggleCollapsed()
        }}
      >
        <div className={cn(!collapsed && 'border-b pb-2')}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            {isEditing ? (
              <div className="flex w-full min-w-0 items-center gap-2">
                <Input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleSaveEdit}
                  className="h-7 text-sm font-semibold"
                />
                <SimpleTooltip label={t('actions.confirm')}>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleSaveEdit}
                    className="shrink-0"
                    aria-label={t('actions.confirm')}
                  >
                    <Check className="h-4 w-4 text-primary" />
                  </Button>
                </SimpleTooltip>
                <SimpleTooltip label={t('actions.cancel')}>
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label={t('actions.cancel')}
                    onClick={handleCancelEdit}
                    onMouseDown={(e) => e.preventDefault()}
                    className="shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </SimpleTooltip>
              </div>
            ) : (
              <h3 className="min-w-0 basis-[140px] flex-1 text-sm font-semibold" title={name}>
                <button
                  type="button"
                  className="block w-full py-1 text-left [overflow-wrap:anywhere]"
                  aria-expanded={!collapsed}
                  aria-controls={membersId}
                  aria-label={`${t(collapsed ? 'actions.expand' : 'collapse')} ${t('group')} ${name}`}
                  onClick={onToggleCollapsed}
                >
                  {name}
                </button>
              </h3>
            )}

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              {!isEditing && dragHandleProps && (
                <SimpleTooltip label={t('a11y.dragToReorder')}>
                  <div
                    className={cn(
                      'flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors',
                      'hover:bg-accent hover:text-foreground active:cursor-grabbing',
                    )}
                    {...dragHandleProps}
                  >
                    <GripVertical className="h-4 w-4" />
                  </div>
                </SimpleTooltip>
              )}
              {!isEditing && onRename && (
                <SimpleTooltip label={t('actions.rename')}>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleStartEdit}
                    aria-label={`${t('actions.rename')} ${name}`}
                  >
                    <Type className="h-4 w-4" />
                  </Button>
                </SimpleTooltip>
              )}
              {actions}
              {!isEditing && onToggleCollapsed && (
                <SimpleTooltip label={collapsed ? t('actions.expand') : t('collapse')}>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={onToggleCollapsed}
                    aria-expanded={!collapsed}
                    aria-controls={membersId}
                    aria-label={`${t('panel.manageMembers')} ${name}`}
                  >
                    <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed && '-rotate-90')} />
                  </Button>
                </SimpleTooltip>
              )}

              {onRemove && (
                <SimpleTooltip label={t('actions.remove')}>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmOpen(true)}
                    aria-label={`${t('actions.remove')} ${name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </SimpleTooltip>
              )}
            </div>
          </div>
          {summary && (
            <div
              data-group-summary
              className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
            >
              {summary}
            </div>
          )}
        </div>

        {/* Keep drop targets registered before their member draggables mount. */}
        {children && (
          <div id={membersId} data-group-members hidden={collapsed} className="cursor-default">
            {children}
          </div>
        )}
        {quickActions && (
          <div className="flex flex-wrap items-center gap-2" data-group-quick-actions>
            {quickActions}
          </div>
        )}
      </Card>

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
                onRemove?.()
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
