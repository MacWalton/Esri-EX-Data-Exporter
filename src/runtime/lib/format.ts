import type { ExportField } from './types'

export const isNil = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))

export function isoDate (v: unknown): string | null {
  if (isNil(v)) return null
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString()
}

/** Attribute value as plain JSON (dates -> ISO strings). */
export function jsonValue (field: ExportField, v: unknown): unknown {
  if (isNil(v)) return null
  if (field.kind === 'date') return isoDate(v)
  return v
}

/** Attribute value as display text. */
export function textValue (field: ExportField, v: unknown): string {
  if (isNil(v)) return ''
  if (field.kind === 'date') return isoDate(v) ?? ''
  return String(v)
}

/** Safe file / layer name: letters, digits, underscore and hyphen only. */
export function safeName (name: string, maxLen = 60, fallback = 'layer'): string {
  const s = name.normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  return (s || fallback).slice(0, maxLen)
}

/** Makes names unique (case-insensitive) within a list, respecting a max length. */
export function uniqueNames (names: string[], maxLen: number): string[] {
  const used = new Set<string>()
  return names.map(n => {
    let candidate = n.slice(0, maxLen)
    let i = 1
    while (used.has(candidate.toLowerCase())) {
      const suffix = `_${i++}`
      candidate = n.slice(0, maxLen - suffix.length) + suffix
    }
    used.add(candidate.toLowerCase())
    return candidate
  })
}

export const roundTo = (decimals: number) => {
  const f = Math.pow(10, decimals)
  return (n: number) => Math.round(n * f) / f
}
