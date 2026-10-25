import type { RoutingFormModalRef } from '~/components/RoutingFormModal'
import type { RoutingsQuery } from '~/schemas/gql/graphql'
import { useStore } from '@nanostores/react'
import { Map, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  useCreateRoutingMutation,
  useGroupsQuery,
  useRemoveRoutingMutation,
  useRenameRoutingMutation,
  useRoutingsQuery,
  useSelectRoutingMutation,
  useUpdateRoutingMutation,
} from '~/apis'
import { RoutingFormModal } from '~/components/RoutingFormModal'
import { RoutingPresetPicker } from '~/components/RoutingPresetPicker'
import { Section } from '~/components/Section'
import { SimpleCard } from '~/components/SimpleCard'
import { Button } from '~/components/ui/button'
import { SimpleTooltip } from '~/components/ui/tooltip'
import { DEFAULT_GROUP_NAME } from '~/constants/default'
import { useDisclosure } from '~/hooks'
import { defaultResourcesAtom } from '~/store'
import { createGroupCompletionItems, setDynamicCompletionItems } from '~/utils/editor-completions'
import { insertRoutingRules } from '~/utils/routing-presets'

export function Routing() {
  const { t } = useTranslation()
  const { defaultRoutingID, defaultGroupID } = useStore(defaultResourcesAtom)
  const { data: routingsQuery } = useRoutingsQuery()
  const { data: groupsQuery } = useGroupsQuery()
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

  // 快捷添加把规则并进当前选中的配置：读取最新的字符串，插入后再整体写回，
  // 这样连点多个预设不会互相覆盖（每次都基于上一次的返回值）。
  const addPresetRules = async (lines: string[]) => {
    if (!selectedRouting) return
    const result = insertRoutingRules(selectedRouting.routing.string, lines)
    if (!result.inserted.length) {
      toast.info(t('routingPresets.alreadyAdded'))
      return
    }
    try {
      await updateRoutingMutation.mutateAsync({ id: selectedRouting.id, routing: result.text })
      toast.success(t('routingPresets.added', { count: result.inserted.length }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

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
        <RoutingPresetPicker
          proxyGroup={proxyGroupName}
          existing={selectedRouting?.routing.string ?? ''}
          pending={updateRoutingMutation.isPending}
          onPick={(_id, lines) => {
            void addPresetRules(lines)
          }}
        />
      }
      bordered
    >
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
        />
      ))}

      <RoutingFormModal
        title={t('routing')}
        opened={openedCreateRoutingFormModal}
        onClose={closeCreateRoutingFormModal}
        configType="routing"
        proxyGroupName={proxyGroupName}
        proxyGroupReady={!!groupsQuery?.groups && !!defaultGroupID}
        handleSubmit={async (values) => {
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
          if (updateRoutingFormModalRef.current) {
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
