import type { Monaco } from '@monaco-editor/react'
import type * as monaco from 'monaco-editor'
import type { RoutingACompletionItem } from './constants'
import { shikiToMonaco } from '@shikijs/monaco'
import vitesseDark from '@shikijs/themes/vitesse-dark'
import vitesseLight from '@shikijs/themes/vitesse-light'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCore } from 'shiki/core'

import { EDITOR_LANGUAGE_ROUTINGA, ROUTINGA_COMPLETION_ITEMS } from './constants'
import { formatRoutingA } from './formatter'

// Shiki highlighter instance
let shikiHighlighter: Awaited<ReturnType<typeof createHighlighterCore>> | null = null

// Track if Shiki themes have been applied to Monaco globally
let shikiThemesApplied = false

// Track if routingA language has been registered
let routingARegistered = false

// Store for dynamic completion items (e.g., user-defined groups)
let dynamicCompletionItems: RoutingACompletionItem[] = []

/**
 * Check if Shiki themes are ready
 */
export function isShikiReady(): boolean {
  return shikiThemesApplied
}

/**
 * Initialize Shiki highlighter with default themes
 */
export async function initShikiHighlighter() {
  if (shikiHighlighter) return shikiHighlighter

  // Shiki supplies TextMate themes only: routingA and dnsA are Monarch grammars
  // registered by hand below. Loading the bundled highlighter would also pull
  // every Shiki grammar plus the Oniguruma WASM engine into the router bundle.
  shikiHighlighter = await createHighlighterCore({
    themes: [vitesseDark, vitesseLight, githubDark, githubLight],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  })

  return shikiHighlighter
}

/**
 * Set dynamic completion items for routingA language (e.g., user-defined groups)
 * These items will be merged with the default completion items
 */
export function setDynamicCompletionItems(items: RoutingACompletionItem[]): void {
  dynamicCompletionItems = items
}

/**
 * Get all completion items (default + dynamic)
 */
export function getAllCompletionItems(): RoutingACompletionItem[] {
  return [...ROUTINGA_COMPLETION_ITEMS, ...dynamicCompletionItems]
}

/**
 * Register routingA language definition only (without providers)
 * Use this when LSP will provide completion, formatting, etc.
 */
export function registerRoutingALanguage(monacoInstance: Monaco): void {
  if (routingARegistered) return
  routingARegistered = true

  // Register custom routingA language
  monacoInstance.languages.register({ id: 'routingA', extensions: ['dae'] })
  monacoInstance.languages.setMonarchTokensProvider('routingA', EDITOR_LANGUAGE_ROUTINGA)
}

/**
 * Handler for beforeMount prop in Editor component
 * Registers routingA language and completion provider
 */
export function handleEditorBeforeMount(monacoInstance: Monaco): void {
  // Only register once to prevent duplicate completion items
  if (routingARegistered) return
  routingARegistered = true

  // Register custom routingA language
  monacoInstance.languages.register({ id: 'routingA', extensions: ['dae'] })
  monacoInstance.languages.setMonarchTokensProvider('routingA', EDITOR_LANGUAGE_ROUTINGA)

  // Register completion provider for routingA language
  monacoInstance.languages.registerCompletionItemProvider('routingA', {
    provideCompletionItems: (model: monaco.editor.ITextModel, position: monaco.Position) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      // Map completion item kinds from string to Monaco enum
      const kindMap: Record<string, monaco.languages.CompletionItemKind> = {
        keyword: monacoInstance.languages.CompletionItemKind.Keyword,
        function: monacoInstance.languages.CompletionItemKind.Function,
        constant: monacoInstance.languages.CompletionItemKind.Constant,
        type: monacoInstance.languages.CompletionItemKind.TypeParameter,
        variable: monacoInstance.languages.CompletionItemKind.Variable,
        snippet: monacoInstance.languages.CompletionItemKind.Snippet,
      }

      // Merge default and dynamic completion items
      const allItems = getAllCompletionItems()

      const suggestions = allItems.map((item) => ({
        label: item.label,
        kind: kindMap[item.kind] ?? monacoInstance.languages.CompletionItemKind.Text,
        detail: item.detail,
        documentation: item.documentation,
        insertText: item.insertText,
        insertTextRules: item.insertTextRules
          ? monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        range,
      }))

      return { suggestions }
    },
  })

  // Register document formatting provider for routingA language
  monacoInstance.languages.registerDocumentFormattingEditProvider('routingA', {
    displayName: 'RoutingA Formatter',
    provideDocumentFormattingEdits: (model: monaco.editor.ITextModel, options: monaco.languages.FormattingOptions) => {
      const text = model.getValue()
      const formatted = formatRoutingA(text, {
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces,
      })

      // Return a single edit that replaces the entire document
      return [
        {
          range: model.getFullModelRange(),
          text: formatted,
        },
      ]
    },
  })
}

/**
 * Apply Shiki themes to Monaco (call after editor is mounted)
 */
export async function applyShikiThemes(monacoInstance: Monaco): Promise<void> {
  // Only apply once globally
  if (shikiThemesApplied) return

  const highlighter = await initShikiHighlighter()

  // Register Shiki themes with Monaco
  shikiToMonaco(highlighter, monacoInstance)
  shikiThemesApplied = true
}

/**
 * Theme names for use in components
 */
export const SHIKI_THEMES = {
  dark: 'vitesse-dark',
  light: 'vitesse-light',
} as const

export const GITHUB_THEMES = {
  dark: 'github-dark',
  light: 'github-light',
} as const
