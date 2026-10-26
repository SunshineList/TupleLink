import type { CustomRule, MatcherKind, RoutingAction, ServiceId } from '~/utils/routing-services'
import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
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
  GEOIP_HINTS,
  GEOSITE_HINTS,
  matcherOf,
  parseCustomRules,
  parseServiceRules,
  ROUTING_SERVICES,
  serviceLabel,
  writeRules,
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

const KINDS: MatcherKind[] = [
  'domain-suffix',
  'domain-keyword',
  'domain-full',
  'geosite',
  'geoip',
  'ip',
  'port',
]

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
 * 分流向导：服务与自定义规则都能指定出口。
 *
 * 相比原来的「快捷添加」弹层，这里能同时看到所有规则当前的去向，
 * 也能直接改成直连/阻断，不用再去读 routingA 文本。
 */
export function RoutingWizard({ text, groups, pending, onSave }: RoutingWizardProps) {
  const { t, i18n } = useTranslation()
  const [draft, setDraft] = useState<Map<ServiceId, RoutingAction>>(() => parseServiceRules(text))
  const [custom, setCustom] = useState<CustomRule[]>(() => parseCustomRules(text))

  // 外部配置变了（换了分流集、别处保存过）就重新同步，避免拿着旧草稿覆盖。
  useEffect(() => {
    setDraft(parseServiceRules(text))
    setCustom(parseCustomRules(text))
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
    const before = parseCustomRules(text)
    if (before.length !== custom.length) return true
    return custom.some((rule, index) => {
      const other = before[index]
      return (
        rule.kind !== other.kind
        || rule.value !== other.value
        || !actionEquals(rule.action, other.action)
      )
    })
  }, [custom, draft, text])

  const updateRule = (index: number, patch: Partial<CustomRule>) => {
    setCustom((previous) => previous.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)))
  }

  const targetSelect = (value: string, onChange: (next: string) => void, label: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-36 shrink-0" aria-label={label}>
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
  )

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
              {targetSelect(
                valueOf(action),
                (next) => {
                  setDraft((previous) => {
                    const updated = new Map(previous)
                    const parsed = actionOf(next)
                    if (parsed) updated.set(service.id, parsed)
                    else updated.delete(service.id)
                    return updated
                  })
                },
                serviceLabel(service.id, i18n.language),
              )}
            </div>
          )
        })}

        <div className="mt-4 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{t('routingWizard.customTitle')}</h3>
              <p className="text-xs text-muted-foreground">{t('routingWizard.customHint')}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCustom((previous) => [
                  ...previous,
                  { kind: 'domain-suffix', value: '', action: { kind: 'direct' } },
                ])
              }}
            >
              <Plus className="h-4 w-4" />
              {t('routingWizard.addRule')}
            </Button>
          </div>

          {custom.length === 0
            ? <p className="mt-3 text-xs text-muted-foreground">{t('routingWizard.customEmpty')}</p>
            : null}

          <div className="mt-3 flex flex-col gap-2">
            {custom.map((rule, index) => (
              <div key={`${rule.kind}:${rule.value}:${index}`} className="flex flex-wrap items-center gap-2">
                <Select
                  value={rule.kind}
                  onValueChange={(next: string) => updateRule(index, { kind: next as MatcherKind })}
                >
                  <SelectTrigger size="sm" className="w-40 shrink-0" aria-label={t('routingWizard.ruleKind')}>
                    {/* 直接渲染标签：行是按 value 重建的，SelectValue 在这里会错配到别的项。 */}
                    <span className="truncate">{t(`routingWizard.kind.${rule.kind}`)}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`routingWizard.kind.${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="min-w-0 flex-1"
                  value={rule.value}
                  placeholder={t('routingWizard.valuePlaceholder') as string}
                  list={rule.kind === 'geosite' ? 'geosite-hints' : rule.kind === 'geoip' ? 'geoip-hints' : undefined}
                  onChange={(event) => updateRule(index, { value: event.target.value })}
                />
                {targetSelect(
                  valueOf(rule.action),
                  (next) => updateRule(index, { action: actionOf(next) ?? { kind: 'direct' } }),
                  t('routingWizard.ruleTarget') as string,
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('routingWizard.removeRule') as string}
                  onClick={() => {
                    setCustom((previous) => previous.filter((_, at) => at !== index))
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {matcherOf(rule.kind, rule.value) || '—'}
                </span>
              </div>
            ))}
          </div>

          <datalist id="geosite-hints">
            {GEOSITE_HINTS.map((hint) => (
              <option key={hint} value={hint} />
            ))}
          </datalist>
          <datalist id="geoip-hints">
            {GEOIP_HINTS.map((hint) => (
              <option key={hint} value={hint} />
            ))}
          </datalist>
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{t('routingWizard.geositeWarn')}</p>
        </div>
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
          {t('routingWizard.sendAllToProxy', { group: defaultTarget || 'proxy' })}
        </Button>
        <Button
          size="sm"
          disabled={!changed || pending}
          onClick={() => {
            const services = [...draft.entries()].map(([service, action]) => ({ service, action }))
            void onSave(writeRules(text, services, custom))
          }}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {t('routingWizard.save')}
        </Button>
      </ScrollableDialogFooter>
    </ScrollableDialogContent>
  )
}
