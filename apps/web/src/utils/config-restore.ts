import type { GQLClientInterface } from '~/contexts'
import type { ConfigBackup } from '~/utils/config-backup'
import { i18n } from '~/i18n'
import { graphql } from '~/schemas/gql'
import { parseBackup } from '~/utils/config-backup'

/**
 * graphql() 只认识 codegen 生成过的文档；没收录的查询它会返回 unknown，
 * 传给 client.request 就是运行时 "[object Object]" 报错。
 * 这里对未知结果退回原始字符串，graphql-request 会自己解析。
 */
function gqlString(source: string): string {
  const document = graphql(source) as unknown
  return typeof document === 'string' ? document : source
}


// 导入不是「恢复数据库」，而是按快照重建：节点和订阅先按链接找回或新建，
// 再重建群组，最后把配置、分流、DNS 逐个建出来。
// 这样即使目标设备已经有同名条目，也不会把现有数据覆盖成半截状态。

export interface RestoreProgress {
  step: string
  done: number
  total: number
}

export interface RestoreResult {
  created: number
  reused: number
  warnings: string[]
}

const EXISTING_NODES = gqlString(`
  query RestoreExistingNodes {
    nodes(first: 10000, after: null) {
      edges {
        id
        link
      }
    }
  }
`)

const EXISTING_SUBSCRIPTIONS = gqlString(`
  query RestoreExistingSubscriptions {
    subscriptions {
      id
      link
    }
  }
`)

const EXISTING_GROUPS = gqlString(`
  query RestoreExistingGroups {
    groups {
      id
      name
    }
  }
`)

const IMPORT_NODES = gqlString(`
  mutation RestoreImportNodes($rollbackError: Boolean!, $args: [ImportArgument!]!) {
    importNodes(rollbackError: $rollbackError, args: $args) {
      link
      error
      node {
        id
      }
    }
  }
`)

const IMPORT_SUBSCRIPTION = gqlString(`
  mutation RestoreImportSubscription($rollbackError: Boolean!, $arg: ImportArgument!) {
    importSubscription(rollbackError: $rollbackError, arg: $arg) {
      link
      sub {
        id
        link
      }
      nodeImportResult {
        error
      }
    }
  }
`)

const CREATE_CONFIG = gqlString(`
  mutation RestoreCreateConfig($name: String, $global: globalInput) {
    createConfig(name: $name, global: $global) {
      id
    }
  }
`)

const CREATE_ROUTING = gqlString(`
  mutation RestoreCreateRouting($name: String, $routing: String) {
    createRouting(name: $name, routing: $routing) {
      id
    }
  }
`)

const CREATE_DNS = gqlString(`
  mutation RestoreCreateDns($name: String, $dns: String) {
    createDns(name: $name, dns: $dns) {
      id
    }
  }
`)

const CREATE_GROUP = gqlString(`
  mutation RestoreCreateGroup($name: String!, $policy: Policy!, $policyParams: [PolicyParam!]) {
    createGroup(name: $name, policy: $policy, policyParams: $policyParams) {
      id
    }
  }
`)

const GROUP_ADD_NODES = gqlString(`
  mutation RestoreGroupAddNodes($id: ID!, $nodeIDs: [ID!]!) {
    groupAddNodes(id: $id, nodeIDs: $nodeIDs)
  }
`)

const GROUP_ADD_SUBSCRIPTIONS = gqlString(`
  mutation RestoreGroupAddSubscriptions($id: ID!, $subscriptionIDs: [ID!]!, $nameFilterRegex: String) {
    groupAddSubscriptions(id: $id, subscriptionIDs: $subscriptionIDs, nameFilterRegex: $nameFilterRegex)
  }
`)

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ExistingNodes {
  nodes: { edges: { id: string, link: string }[] }
}

interface ExistingSubscriptions {
  subscriptions: { id: string, link: string, nodes: { id: string }[] }[]
}

interface ExistingGroups {
  groups: { id: string, name: string }[]
}

async function loadExisting(client: GQLClientInterface) {
  const nodes = (await client.request(EXISTING_NODES)) as ExistingNodes
  const subscriptions = (await client.request(EXISTING_SUBSCRIPTIONS)) as ExistingSubscriptions
  const groups = (await client.request(EXISTING_GROUPS)) as ExistingGroups

  const byLink = new Map<string, string>()
  for (const edge of nodes.nodes.edges) byLink.set(edge.link, edge.id)
  const subscriptionByLink = new Map<string, { id: string, nodeIDs: string[] }>()
  for (const subscription of subscriptions.subscriptions) {
    subscriptionByLink.set(subscription.link, {
      id: subscription.id,
      nodeIDs: subscription.nodes.map((node) => node.id),
    })
  }
  const groupByName = new Map<string, string>()
  for (const group of groups.groups) groupByName.set(group.name, group.id)
  return { byLink, subscriptionByLink, groupByName }
}

/**
 * 按快照重建配置。
 *
 * 任何一步失败的条目只记 warning 并继续：一份备份里通常只有一两个链接失效，
 * 中途抛错会让用户连能恢复的部分都拿不到。已存在的同名群组直接复用，
 * 不删除、不改策略，避免把用户当前的手工调整抹掉。
 */
export async function restoreBackup(
  client: GQLClientInterface,
  backup: ConfigBackup,
  onProgress?: (progress: RestoreProgress) => void,
): Promise<RestoreResult> {
  const result: RestoreResult = { created: 0, reused: 0, warnings: [] }
  const existing = await loadExisting(client)

  const nodeLinks = new Set<string>()
  for (const group of backup.groups) for (const link of group.nodeLinks) nodeLinks.add(link)
  const subscriptionEntries = new Map<string, string | null>()
  for (const group of backup.groups) {
    group.subscriptionLinks.forEach((link, index) => {
      if (!subscriptionEntries.has(link)) subscriptionEntries.set(link, group.subscriptionFilters[index] ?? null)
    })
  }

  const total = nodeLinks.size + subscriptionEntries.size + backup.groups.length
    + backup.configs.length + backup.routings.length + backup.dnss.length
  let done = 0
  const tick = (step: string) => {
    done += 1
    onProgress?.({ step, done, total })
  }

  // 1. 节点：已有的直接复用，缺的一次性导入。
  const missingNodes = [...nodeLinks].filter((link) => !existing.byLink.has(link))
  if (missingNodes.length) {
    try {
      const imported = (await client.request(IMPORT_NODES, {
        rollbackError: true,
        args: missingNodes.map((link) => ({ link })),
      })) as { importNodes: { link: string, error: string, node: { id: string } | null }[] }
      for (const item of imported.importNodes) {
        if (item.node) {
          existing.byLink.set(item.link, item.node.id)
          result.created += 1
        } else if (item.error) {
          result.warnings.push(item.error)
        }
      }
    } catch (error) {
      result.warnings.push(error instanceof Error ? error.message : String(error))
    }
  }
  for (const _link of nodeLinks) tick('nodes')

  // 2. 订阅：先导入，才能拿到它下面的节点 ID 去喂群组。
  for (const [link, filter] of subscriptionEntries) {
    if (existing.subscriptionByLink.has(link)) {
      result.reused += 1
    } else {
      try {
        const imported = (await client.request(IMPORT_SUBSCRIPTION, {
          rollbackError: true,
          arg: { link },
        })) as {
          importSubscription: {
            link: string[]
            sub: { id: string, link: string } | null
            nodeImportResult: { error: string | null }[]
          }
        }
        const entry = imported.importSubscription
        if (entry.sub) {
          existing.subscriptionByLink.set(link, { id: entry.sub.id, nodeIDs: [] })
          result.created += 1
        } else {
          const failures = entry.nodeImportResult.map((item) => item.error).filter((value): value is string => !!value)
          result.warnings.push(...(failures.length ? failures : [i18n.t('backup.subscriptionFailed', { link })]))
        }
      } catch (error) {
        result.warnings.push(error instanceof Error ? error.message : String(error))
      }
    }
    tick(filter ? 'subscriptions-filtered' : 'subscriptions')
  }

  // 3. 群组：同名直接复用，缺的新建后补节点与订阅。
  for (const group of backup.groups) {
    let id = existing.groupByName.get(group.name)
    if (id) {
      result.reused += 1
    } else {
      try {
        const created = (await client.request(CREATE_GROUP, {
          name: group.name,
          policy: group.policy,
          policyParams: group.policyParams,
        })) as { createGroup: { id: string } }
        id = created.createGroup.id
        existing.groupByName.set(group.name, id)
        result.created += 1
      } catch (error) {
        result.warnings.push(i18n.t('backup.groupFailed', { name: group.name, message: message(error) }))
      }
    }
    if (!id) {
      tick(group.name)
      continue
    }

    const nodeIDs = group.nodeLinks
      .map((link) => existing.byLink.get(link))
      .filter((value): value is string => !!value)
    if (nodeIDs.length) {
      try {
        await client.request(GROUP_ADD_NODES, { id, nodeIDs })
      } catch (error) {
        result.warnings.push(i18n.t('backup.groupNodesFailed', { name: group.name, message: message(error) }))
      }
    }

    const subscriptionIDs = group.subscriptionLinks
      .map((link) => existing.subscriptionByLink.get(link)?.id)
      .filter((value): value is string => !!value)
    if (subscriptionIDs.length) {
      try {
        const regex = group.subscriptionFilters.find((filter): filter is string => !!filter) ?? null
        await client.request(GROUP_ADD_SUBSCRIPTIONS, { id, subscriptionIDs, nameFilterRegex: regex })
      } catch (error) {
        result.warnings.push(i18n.t('backup.groupSubscriptionsFailed', { name: group.name, message: message(error) }))
      }
    }
    tick(group.name)
  }

  // 4. 配置、分流、DNS：一律新建，不改动设备上已存在的同名条目。
  for (const config of backup.configs) {
    try {
      await client.request(CREATE_CONFIG, { name: config.name, global: config.global as never })
      result.created += 1
    } catch (error) {
      result.warnings.push(i18n.t('backup.configFailed', { name: config.name, message: message(error) }))
    }
    tick(config.name)
  }
  for (const routing of backup.routings) {
    try {
      await client.request(CREATE_ROUTING, { name: routing.name, routing: routing.routing })
      result.created += 1
    } catch (error) {
      result.warnings.push(i18n.t('backup.routingFailed', { name: routing.name, message: message(error) }))
    }
    tick(routing.name)
  }
  for (const entry of backup.dnss) {
    try {
      await client.request(CREATE_DNS, { name: entry.name, dns: entry.dns })
      result.created += 1
    } catch (error) {
      result.warnings.push(i18n.t('backup.dnsFailed', { name: entry.name, message: message(error) }))
    }
    tick(entry.name)
  }

  return result
}

export function readBackupFile(text: string): ConfigBackup {
  return parseBackup(text)
}
