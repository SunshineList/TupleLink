import type { RoutingACompletionItem } from '@daeuniverse/dae-editor'

let currentItems: RoutingACompletionItem[] = []
let consumer: ((items: RoutingACompletionItem[]) => void) | undefined

// Cache group names without importing Monaco. The editor subscribes only when
// its lazy chunk is loaded, including names changed before its first opening.
export function setDynamicCompletionItems(items: RoutingACompletionItem[]) {
  currentItems = items
  consumer?.(items)
}

export function subscribeEditorCompletions(listener: (items: RoutingACompletionItem[]) => void) {
  consumer = listener
  listener(currentItems)
}

export function createGroupCompletionItems(groupNames: string[]): RoutingACompletionItem[] {
  return groupNames.map((name) => ({
    label: name,
    kind: 'variable',
    detail: 'User group outbound',
    documentation: `Route traffic to group: ${name}`,
    insertText: name,
  }))
}
