import type {
  BackupConfig,
  BackupDNS,
  BackupGroup,
  BackupRouting,
  ConfigBackup,
} from '~/utils/config-backup'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useGQLQueryClient } from '~/contexts'
import { graphql } from '~/schemas/gql'
import { buildBackup, summariseBackup } from '~/utils/config-backup'

/**
 * graphql() 只认识 codegen 生成过的文档；没收录的查询它会返回 unknown，
 * 传给 client.request 就是运行时 "[object Object]" 报错。
 * 这里对未知结果退回原始字符串，graphql-request 会自己解析。
 */
function gqlString(source: string): string {
  const document = graphql(source) as unknown
  return typeof document === 'string' ? document : source
}


// 导出要一次拿全，不能复用面板各页面的 query：
// 那些查询是按页面需要裁剪过的（比如 Configs 只取 global 的部分字段），
// 拿它们拼快照会把没查到的字段写成空值。
const EXPORT_QUERY = gqlString(`
  query ExportConfigBackup {
    configs {
      id
      name
      selected
      global {
        logLevel
        tproxyPort
        allowInsecure
        checkInterval
        checkTolerance
        lanInterface
        wanInterface
        udpCheckDns
        tcpCheckUrl
        bootstrapResolver
        fallbackResolver
        dialMode
        tcpCheckHttpMethod
        disableWaitingNetwork
        autoConfigKernelParameter
        sniffingTimeout
        tlsImplementation
        utlsImitate
        tproxyPortProtect
        soMarkFromDae
        pprofPort
        enableLocalTcpFastRedirect
        mptcp
        bandwidthMaxTx
        bandwidthMaxRx
      }
    }
    routings {
      name
      selected
      routing {
        string
      }
    }
    dnss {
      name
      selected
      dns {
        string
        routing {
          request {
            string
          }
          response {
            string
          }
        }
      }
    }
    groups {
      name
      policy
      policyParams {
        key
        val
      }
      nodes {
        link
      }
      subscriptions {
        nameFilterRegex
        subscription {
          link
        }
      }
    }
  }
`)

interface ExportData {
  configs: { name: string, selected: boolean, global: Record<string, unknown> }[]
  routings: { name: string, selected: boolean, routing: { string: string } }[]
  dnss: {
    name: string
    selected: boolean
    dns: { string: string, routing: { request: { string: string }, response: { string: string } } | null }
  }[]
  groups: {
    name: string
    policy: string
    policyParams: { key: string, val: string }[]
    nodes: { link: string }[]
    subscriptions: { nameFilterRegex: string | null, subscription: { link: string } }[]
  }[]
}

export function toBackup(data: ExportData, exportedAt: string): ConfigBackup {
  const configs: BackupConfig[] = data.configs.map((config) => ({
    name: config.name,
    selected: config.selected,
    global: config.global as BackupConfig['global'],
  }))
  const routings: BackupRouting[] = data.routings.map((routing) => ({
    name: routing.name,
    selected: routing.selected,
    routing: routing.routing.string,
  }))
  const dnss: BackupDNS[] = data.dnss.map((entry) => ({
    name: entry.name,
    selected: entry.selected,
    dns: entry.dns.string,
    routing: entry.dns.routing
      ? { request: entry.dns.routing.request.string, response: entry.dns.routing.response.string }
      : null,
  }))
  const groups: BackupGroup[] = data.groups.map((group) => ({
    name: group.name,
    policy: group.policy,
    policyParams: group.policyParams,
    nodeLinks: group.nodes.map((node) => node.link),
    subscriptionLinks: group.subscriptions.map((entry) => entry.subscription.link),
    subscriptionFilters: group.subscriptions.map((entry) => entry.nameFilterRegex ?? null),
  }))
  return buildBackup({ configs, routings, dnss, groups, exportedAt })
}

/** 拉全量数据并生成快照；不写盘，交给调用方决定怎么下载。 */
export function useExportConfigBackup() {
  const gqlClient = useGQLQueryClient()
  const [pending, setPending] = useState(false)

  const run = useCallback(async () => {
    setPending(true)
    try {
      // 导出查询还没进 codegen 文档集，这里显式断言成文档节点。
      const data = await gqlClient.request(EXPORT_QUERY)
      const backup = toBackup(data as ExportData, new Date().toISOString())
      return { backup, summary: summariseBackup(backup) }
    } finally {
      setPending(false)
    }
  }, [gqlClient])

  return { run, pending }
}

/** 导入后会改到这些查询，全部失效一次，让页面直接反映恢复结果。 */
export function useInvalidateAfterRestore() {
  const queryClient = useQueryClient()
  return useCallback(() => queryClient.invalidateQueries(), [queryClient])
}
