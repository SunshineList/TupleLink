import { expect, it } from 'vitest'
import { createGroupCompletionItems, setDynamicCompletionItems, subscribeEditorCompletions } from './editor-completions'

it('retains the latest groups before lazy editor loading and forwards updates and removals', () => {
  setDynamicCompletionItems(createGroupCompletionItems(['obsolete']))
  setDynamicCompletionItems(createGroupCompletionItems(['proxy', 'AI']))
  const received: string[][] = []
  subscribeEditorCompletions((items) => received.push(items.map((item) => item.label)))
  setDynamicCompletionItems(createGroupCompletionItems(['renamed']))
  setDynamicCompletionItems([])
  expect(received).toEqual([['proxy', 'AI'], ['renamed'], []])
})
