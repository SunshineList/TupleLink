import type { RoutingAction, ServiceId } from '~/utils/routing-services'
import { Check, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { DialogTitle } from '~/components/ui/dialog'
import {
  ScrollableDialogBody,
  ScrollableDialogContent,
  ScrollableDialogFooter,
  ScrollableDialogHeader,
} from '~/components/ui/scrollable-dialog'
import {
  SelectRoot as Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { cn } from '~/lib/utils'
import {
  actionEquals,
  parseServiceRules,
  ROUTING_SERVICES,
  serviceLabel,
  writeServiceRules,
} from '~/utils/routing-services'

export interface RoutingWizardProps {
  /** 当前分流配置的正文。 */
  text: string
  /** 可选的代理群组名；第一个作为默认目标。 */
  groups: string[]
  pending?: boolean
  onSave: (text: string) => void | Promise<void>
}

/** 直连/阻断在 Select 里用保留值表示，避免与真实群组名冲突。 */
const DIRECT = '::direct'
const BLOCK = '::block'
const UNSET = '::unset'

function valueOf(action: RoutingAction | undefined): string {
  if (!action) return UNSET
  if (action.kind === 'direct') return DIRECT
  if (action.kind === 'block') return BLOCK
  return action.group
}

function actionOf(value: string): RoutingAction | undefined {
  if (value === UNSET) return undefined
  if (value === DIRECT) return { kind: 'direct' }
  if (value === BLOCK) return { kind: 'block' }
  return { kind: 'group', group: value }
}

/**
 * 分流向导：一个服务一行，右边选它走哪个出口。
 *
 * 相比原来的「快捷添加」弹层，这里能同时看到全部服务当前的去向，
 * 也能直接改成直连/阻断，不用再去读 routingA 文本。
 */
export function RoutingWizard({ text, groups, pending, onSave }: RoutingWizardProps) {
  const { t, i18n } = useTranslation()
  const [draft, setDraft] = useState<Map<ServiceId, RoutingAction>>(() => parseServiceRules(text))

  // 外部配置变了（换了分流集、别处保存过）就重新同步，避免拿着旧草稿覆盖。
  useEffect(() => {
    setDraft(parseServiceRules(text))
  }, [text])

  const defaultTarget = groups[0] ?? ''

  const changed = useMemo(() => {
    const current = parseServiceRules(text)
    for (const service of ROUTING_SERVICES) {
      const next = draft.get(service.id)
      const now = current.get(service.id)
      if (next === undefined && now === undefined) continue
      if (next === undefined || now === undefined) return true
      if (!actionEquals(next, now)) return true
    }
    return false
  }, [draft, text])

  return (
    <ScrollableDialogContent size="xl">
      <ScrollableDialogHeader>
        <DialogTitle>{t('routingWizard.title')}</DialogTitle>
        <p className="text-sm text-muted-foreground">{t('routingWizard.hint')}</p>
      </ScrollableDialogHeader>

      <ScrollableDialogBody className="flex flex-col gap-1">
        {ROUTING_SERVICES.map((service) => {
          const action = draft.get(service.id)
          return (
            <div
              key={service.id}
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2',
                action ? 'border-border' : 'border-dashed',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-8 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tracking-wide',
                  action ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {service.badge}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {serviceLabel(service.id, i18n.language)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{service.matcher}</span>
              </span>
              <Select
                value={valueOf(action)}
                onValueChange={(next: string) => {
                  setDraft((previous) => {
                    const updated = new Map(previous)
                    const parsed = actionOf(next)
                    if (parsed) updated.set(service.id, parsed)
                    else updated.delete(service.id)
                    return updated
                  })
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-36 shrink-0"
                  aria-label={serviceLabel(service.id, i18n.language)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value={UNSET}>{t('routingWizard.followDefault')}</SelectItem>
                  <SelectItem value={DIRECT}>{t('routingWizard.direct')}</SelectItem>
                  <SelectItem value={BLOCK}>{t('routingWizard.block')}</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </ScrollableDialogBody>

      <ScrollableDialogFooter className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!defaultTarget || pending}
          onClick={() => {
            setDraft((previous) => {
              const updated = new Map(previous)
              for (const service of ROUTING_SERVICES) {
                if (!service.proxyByDefault) continue
                updated.set(service.id, { kind: 'group', group: defaultTarget })
              }
              return updated
            })
          }}
        >
          {t('routingWizard.sendAllToProxy', { group: defaultTarget })}
        </Button>
        <Button
          size="sm"
          disabled={!changed || pending}
          onClick={() => {
            const rules = [...draft.entries()].map(([service, action]) => ({ service, action }))
            void onSave(writeServiceRules(text, rules))
          }}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {t('routingWizard.save')}
        </Button>
      </ScrollableDialogFooter>
    </ScrollableDialogContent>
  )
}
