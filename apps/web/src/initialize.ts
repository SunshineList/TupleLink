import { useCallback } from 'react'

import {
  getDefaultsRequest,
  getInterfacesRequest,
  getModeRequest,
  useCreateConfigMutation,
  useCreateDNSMutation,
  useCreateGroupMutation,
  useCreateRoutingMutation,
  useSelectConfigMutation,
  useSelectDNSMutation,
  useSelectRoutingMutation,
  useSetJsonStorageMutation,
} from '~/apis'
import {
  DEFAULT_CONFIG_NAME,
  DEFAULT_CONFIG_WITH_LAN_INTERFACEs,
  DEFAULT_DNS,
  DEFAULT_DNS_NAME,
  DEFAULT_GROUP_NAME,
  DEFAULT_GROUP_POLICY,
  DEFAULT_ROUTING,
  DEFAULT_ROUTING_NAME,
  MODE,
} from '~/constants'
import { useGQLQueryClient } from '~/contexts'
import { isMockMode, MOCK_DEFAULT_IDS } from '~/mocks'
import { defaultResourcesAtom, modeAtom } from '~/store'
import { isWireGuard } from '~/utils/wireguard-check'

export function useInitialize() {
  const createConfigMutation = useCreateConfigMutation()
  const selectConfigMutation = useSelectConfigMutation()
  const createRoutingMutation = useCreateRoutingMutation()
  const selectRoutingMutation = useSelectRoutingMutation()
  const createDNSMutation = useCreateDNSMutation()
  const selectDNSMutation = useSelectDNSMutation()
  const createGroupMutation = useCreateGroupMutation()
  const setJsonStorageMutation = useSetJsonStorageMutation()
  const gqlClient = useGQLQueryClient()
  const getInterfaces = getInterfacesRequest(gqlClient)
  const getMode = getModeRequest(gqlClient)
  const getDefaults = getDefaultsRequest(gqlClient)

  return useCallback(async () => {
    // In mock mode, use mock default IDs directly
    if (isMockMode()) {
      modeAtom.set(MODE.rule)
      defaultResourcesAtom.set(MOCK_DEFAULT_IDS)
      return
    }

    const [defaults, mode] = await Promise.all([getDefaults(), getMode()])
    const { defaultConfigID, defaultRoutingID, defaultDNSID, defaultGroupID } = defaults

    if (!defaultConfigID) {
      // 只取「持有默认路由」的接口是不够的：dae 只接管 LAN 接口列表里的
      // 网卡，而 WireGuard 隧道（wg0 等）永远不带默认路由，于是从外面连
      // 回来的流量会完全绕过代理——面板看起来一切正常，人却在外面连不上网。
      // 这里把 wg* 接口一并纳入默认值；真正的开关仍在配置页，用户可改。
      const lanInterfaces = (await getInterfaces()).general.interfaces
        .filter(({ flag, name }) => !!flag.default || isWireGuard(name))
        .map(({ name }) => name)
      const {
        createConfig: { id },
      } = await createConfigMutation.mutateAsync({
        name: DEFAULT_CONFIG_NAME,
        global: DEFAULT_CONFIG_WITH_LAN_INTERFACEs(lanInterfaces),
      })

      await selectConfigMutation.mutateAsync({ id })
      await setJsonStorageMutation.mutateAsync({ defaultConfigID: id })
      defaults.defaultConfigID = id
    }

    if (!defaultRoutingID) {
      const {
        createRouting: { id },
      } = await createRoutingMutation.mutateAsync({ name: DEFAULT_ROUTING_NAME, routing: DEFAULT_ROUTING })

      await selectRoutingMutation.mutateAsync({ id })
      await setJsonStorageMutation.mutateAsync({ defaultRoutingID: id })
      defaults.defaultRoutingID = id
    }

    if (!defaultDNSID) {
      const {
        createDns: { id },
      } = await createDNSMutation.mutateAsync({ name: DEFAULT_DNS_NAME, dns: DEFAULT_DNS })

      await selectDNSMutation.mutateAsync({ id })
      await setJsonStorageMutation.mutateAsync({ defaultDNSID: id })
      defaults.defaultDNSID = id
    }

    if (!defaultGroupID) {
      const {
        createGroup: { id },
      } = await createGroupMutation.mutateAsync({
        name: DEFAULT_GROUP_NAME,
        policy: DEFAULT_GROUP_POLICY,
        policyParams: [],
      })
      await setJsonStorageMutation.mutateAsync({ defaultGroupID: id })
      defaults.defaultGroupID = id
    }

    if (!mode) {
      await setJsonStorageMutation.mutateAsync({ mode: MODE.simple })

      modeAtom.set(MODE.simple)
    } else {
      modeAtom.set(mode as MODE)
    }

    defaultResourcesAtom.set(defaults)
  }, [
    createConfigMutation,
    createDNSMutation,
    createGroupMutation,
    createRoutingMutation,
    getDefaults,
    getInterfaces,
    getMode,
    selectConfigMutation,
    selectDNSMutation,
    selectRoutingMutation,
    setJsonStorageMutation,
  ])
}
