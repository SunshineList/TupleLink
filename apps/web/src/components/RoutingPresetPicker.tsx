import type { RoutingRulePreset } from '~/utils/routing-presets'
import { Check, Loader2, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/utils'
import { renderPreset, ROUTING_RULE_PRESETS } from '~/utils/routing-presets'

export interface RoutingPresetPickerProps {
  proxyGroup: string
  /** 已经写进配置里的行，用来把已添加的预设标出来。 */
  existing: string
  pending?: boolean
  onPick: (id: RoutingRulePreset['id'], lines: string[]) => void
}

// 每条预设占一行，按钮本身就是复选框：点击立即写入，不需要再点保存。
// 已存在的规则显示成勾选态并禁用，避免用户以为点了没反应。
export function RoutingPresetPicker({ proxyGroup, existing, pending, onPick }: RoutingPresetPickerProps) {
  const { t } = useTranslation()
  const written = new Set(
    existing
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean),
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-9" aria-label={t('routingPresets.open')}>
          <Wand2 className="h-4 w-4" />
          <span className="hidden sm:inline">{t('routingPresets.open')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="px-2 pb-2 text-xs text-muted-foreground">{t('routingPresets.hint')}</p>
        <div className="flex flex-col gap-1">
          {ROUTING_RULE_PRESETS.map((preset) => {
            const lines = renderPreset(preset, proxyGroup)
            const usable = lines.length > 0
            const added = usable && lines.every((line) => written.has(line))
            return (
              <button
                key={preset.id}
                type="button"
                disabled={!usable || added || pending}
                onClick={() => usable && onPick(preset.id, lines)}
                className={cn(
                  'flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  'hover:bg-muted disabled:opacity-60 disabled:hover:bg-transparent',
                )}
              >
                <span className="mt-0.5 h-4 w-4 shrink-0">
                  {added
                    ? <Check className="h-4 w-4" />
                    : pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                </span>
                <span className="flex flex-col">
                  <span className="font-medium">{t(`routingPresets.items.${preset.id}.label`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {usable ? t(`routingPresets.items.${preset.id}.hint`) : t('routingPresets.needsGroup')}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
