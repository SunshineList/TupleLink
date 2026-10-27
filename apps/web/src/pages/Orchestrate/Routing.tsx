import type { RoutingFormModalRef } from '~/components/RoutingFormModal'
import type { RoutingsQuery } from '~/schemas/gql/graphql'
import { useStore } from '@nanostores/react'
import { ListTree, Map, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  useCreateRoutingMutation,
  useGeneralQuery,
  useGroupsQuery,
  useRemoveRoutingMutation,
  useRenameRoutingMutation,
  useRoutingsQuery,
  useSelectRoutingMutation,
  useUpdateRoutingMutation,
} from '~/apis'
import { RoutingFormModal } from '~/components/RoutingFormModal'
import { RoutingTester } from '~/components/RoutingTester'
import { RoutingWizard } from '~/components/RoutingWizard'
import { Section } from '~/components/Section'
import { SimpleCard } from '~/components/SimpleCard'
import { AlertBanner } from '~/components/ui/alert-banner'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { SimpleTooltip } from '~/components/ui/tooltip'
import { DEFAULT_GROUP_NAME } from '~/constants/default'
import { useDisclosure } from '~/hooks'
import { defaultResourcesAtom } from '~/store'
import { createGroupCompletionItems, setDynamicCompletionItems } from '~/utils/editor-completions'
import { describeInvalidCode, invalidCodes } from '~/utils/routing-validate'
import { findPrivateRule, isWireGuard } from '~/utils/wireguard-check'

/** 卡片摘要只显示前几条规则，避免长规则表把卡片撑爆。 */
function previewRules(source: string): string {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length <= 4) return lines.join('\n')
  return [...lines.slice(0, 4), `… +${lines.length - 4}`].join('\n')
}

export function Routing() {
  const { t } = useTranslation()
  const { defaultRoutingID, defaultGroupID } = useStore(defaultResourcesAtom)
  const { data: routingsQuery } = useRoutingsQuery()
  const { data: groupsQuery } = useGroupsQuery()
  const { data: generalQuery } = useGeneralQuery()
  const selectRoutingMutation = useSelectRoutingMutation()
  const removeRoutingMutation = useRemoveRoutingMutation()
  const renameRoutingMutation = useRenameRoutingMutation()
  const createRoutingMutation = useCreateRoutingMutation()
  const updateRoutingFormModalRef = useRef<RoutingFormModalRef>(null)
  const updateRoutingMutation = useUpdateRoutingMutation()

  // Set dynamic completion items for routingA when groups change
  useEffect(() => {
    if (groupsQuery?.groups) {
      const groupNames = groupsQuery.groups.map((group) => group.name)
      const completionItems = createGroupCompletionItems(groupNames)
      setDynamicCompletionItems(completionItems)
    }
  }, [groupsQuery?.groups])

  const selectedRouting = useMemo(
    () => routingsQuery?.routings.find((item) => item.selected) ?? routingsQuery?.routings[0],
    [routingsQuery?.routings],
  )

  const proxyGroupName = useMemo(() => {
    const defaultGroup = groupsQuery?.groups?.find((g) => g.id === defaultGroupID)
    return defaultGroup?.name || DEFAULT_GROUP_NAME
  }, [groupsQuery?.groups, defaultGroupID])

  // 写回前先自己核对分类：dae 只要遇到一个查不到的分类就整张表放弃，
  // 与其等它在日志里报 code xxx not found，不如在点保存时就指出是哪个名字。
  const guardRouting = (text: string): boolean => {
    const unknown = invalidCodes(text)
    if (!unknown.length) return true
    toast.error(t('routingWizard.invalidCode', { codes: unknown.map(describeInvalidCode).join('、') }))
    return false
  }

  // 私网直连规则会把 WireGuard 网段一起判成直连：那些地址从外面连回来时
  // 内网能访问，但上不了外网，而家里设备完全正常，很容易被误判成节点坏了。
  // 这里只在「确实存在 wg 接口」时提示，没装 WireGuard 的人不该看到这条。
  const wireGuardHint = useMemo(() => {
    const hasWireGuard = (generalQuery?.general.interfaces ?? []).some((item) => isWireGuard(item.name))
    if (!hasWireGuard) return null
    const selected = routingsQuery?.routings.find((item) => item.selected) ?? routingsQuery?.routings[0]
    const source = selected?.routing.string
    if (!source) return null
    const issue = findPrivateRule(source)
    if (!issue || !issue.isDirect || issue.hasEarlierWireGuardRule) return null
    return issue
  }, [generalQuery?.general.interfaces, routingsQuery?.routings])

  const [openedWizard, { open: openWizard, close: closeWizard }] = useDisclosure(false)
  const [openedCreateRoutingFormModal, { open: openCreateRoutingFormModal, close: closeCreateRoutingFormModal }] =
    useDisclosure(false)
  const [openedUpdateRoutingFormModal, { open: openUpdateRoutingFormModal, close: closeUpdateRoutingFormModal }] =
    useDisclosure(false)

  return (
    <Section
      title={t('routing')}
      icon={<Map className="h-5 w-5" />}
      onCreate={openCreateRoutingFormModal}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            className="min-h-9"
            disabled={!selectedRouting}
            onClick={openWizard}
            aria-label={t('routingWizard.title')}
          >
            <ListTree className="h-4 w-4" />
            <span className="hidden sm:inline">{t('routingWizard.title')}</span>
          </Button>
        </>
      }
      bordered
    >
      {wireGuardHint && (
        <AlertBanner tone="warning" title={t('wireGuard.privateOrderTitle')} className="mb-3">
          {t('wireGuard.privateOrder', { line: wireGuardHint.privateRuleLine + 1 })}
        </AlertBanner>
      )}
      {/* 测试器放在规则列表上方：配完规则最常问的就是「这样写对不对」。 */}
      {selectedRouting && (
        <div className="mb-3">
          <RoutingTester
            source={selectedRouting.routing.string}
            groups={(groupsQuery?.groups ?? []).map((group) => group.name)}
          />
        </div>
      )}
      {routingsQuery?.routings.map((routing: RoutingsQuery['routings'][number]) => (
        <SimpleCard
          key={routing.id}
          name={routing.name}
          actions={
            <SimpleTooltip label={t('actions.settings')}>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  updateRoutingFormModalRef.current?.setEditingID(routing.id)

                  updateRoutingFormModalRef.current?.initOrigins({
                    name: routing.name,
                    text: routing.routing.string,
                  })

                  openUpdateRoutingFormModal()
                }}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </SimpleTooltip>
          }
          selected={routing.selected}
          onSelect={() => selectRoutingMutation.mutate({ id: routing.id })}
          onRemove={routing.id !== defaultRoutingID ? () => removeRoutingMutation.mutate(routing.id) : undefined}
          onRename={(newName) => renameRoutingMutation.mutate({ id: routing.id, name: newName })}
          onDuplicate={async () => {
            await createRoutingMutation.mutateAsync({
              name: `${routing.name} (Copy)`,
              routing: routing.routing.string,
            })
          }}
          preview={
            <pre className="max-h-24 overflow-hidden rounded-lg bg-muted/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
              {previewRules(routing.routing.string) || t('panel.noRulesYet')}
            </pre>
          }
        >
          <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {routing.routing.string.trim() || t('panel.noRulesYet')}
          </pre>
        </SimpleCard>
      ))}

      <Dialog open={openedWizard} onOpenChange={(next) => (next ? openWizard() : closeWizard())}>
        <RoutingWizard
          text={selectedRouting?.routing.string ?? ''}
          groups={(groupsQuery?.groups ?? []).map((group) => group.name)}
          pending={updateRoutingMutation.isPending}
          onSave={async (text) => {
            if (!selectedRouting || !guardRouting(text)) return
            try {
              await updateRoutingMutation.mutateAsync({ id: selectedRouting.id, routing: text })
              toast.success(t('routingWizard.saved'))
              closeWizard()
            } catch (error) {
              toast.error(error instanceof Error ? error.message : String(error))
            }
          }}
        />
      </Dialog>

      <RoutingFormModal
        title={t('routing')}
        opened={openedCreateRoutingFormModal}
        onClose={closeCreateRoutingFormModal}
        configType="routing"
        proxyGroupName={proxyGroupName}
        proxyGroupReady={!!groupsQuery?.groups && !!defaultGroupID}
        handleSubmit={async (values) => {
          if (!guardRouting(values.text)) return
          await createRoutingMutation.mutateAsync({
            name: values.name,
            routing: values.text,
          })
        }}
      />

      <RoutingFormModal
        ref={updateRoutingFormModalRef}
        title={t('routing')}
        opened={openedUpdateRoutingFormModal}
        onClose={closeUpdateRoutingFormModal}
        configType="routing"
        proxyGroupName={proxyGroupName}
        handleSubmit={async (values) => {
          if (updateRoutingFormModalRef.current && guardRouting(values.text)) {
            await updateRoutingMutation.mutateAsync({
              id: updateRoutingFormModalRef.current.editingID,
              routing: values.text,
            })
          }
        }}
      />
    </Section>
  )
}
