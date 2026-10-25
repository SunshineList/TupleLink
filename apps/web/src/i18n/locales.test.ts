import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zhHans from './locales/zh-Hans.json'

// The panel ships two locales and no runtime fallback check: a key that exists
// in en.json but not in zh-Hans.json silently renders as the raw key. Compare
// the flat key sets so a missing or misspelled entry fails here instead.
const CATALOGUES = { en, 'zh-Hans': zhHans } as const

function flatten(node: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') Object.assign(out, flatten(value as Record<string, unknown>, path))
    else out[path] = String(value)
  }
  return out
}

const flat = Object.fromEntries(
  Object.entries(CATALOGUES).map(([locale, catalogue]) => [locale, flatten(catalogue as Record<string, unknown>)]),
)

function placeholders(text: string) {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort()
}

describe('locale catalogues', () => {
  it('defines the same keys in every language', () => {
    const reference = Object.keys(flat.en).sort()
    const keys = Object.keys(flat['zh-Hans']).sort()
    expect(reference.filter((key) => !keys.includes(key))).toEqual([])
    expect(keys.filter((key) => !reference.includes(key))).toEqual([])
  })

  it('leaves no entry empty', () => {
    for (const locale of ['en', 'zh-Hans'] as const) {
      expect(flat[locale] && Object.entries(flat[locale]).filter(([, value]) => !value.trim())).toEqual([])
    }
  })

  it('keeps placeholders aligned with the reference language', () => {
    // A translation that drops {{count}} renders an incomplete sentence, and one
    // that misspells it renders the literal braces to the user.
    const mismatched = Object.entries(flat.en)
      .filter(([key, text]) => {
        const translated = flat['zh-Hans'][key]
        return translated !== undefined && placeholders(translated).join() !== placeholders(text).join()
      })
      .map(([key]) => key)
    expect(mismatched).toEqual([])
  })
})
