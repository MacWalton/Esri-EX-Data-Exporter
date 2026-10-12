import type { Coord, ExportLayer, ExportField, OutputFile, EsriGeometryJSON } from './types'
import { groupRings } from './rings'
import { isNil, uniqueNames } from './format'

/**
 * ESRI Shapefile writer (.shp, .shx, .dbf, .cpg, optional .prj).
 * Supports Point/MultiPoint/PolyLine/Polygon and their Z variants.
 */

const SHAPE_TYPES = {
  point: [1, 11],
  multipoint: [8, 18],
  polyline: [3, 13],
  polygon: [5, 15]
} as const

class ByteWriter {
  private buf = new ArrayBuffer(1024)
  private view = new DataView(this.buf)
  pos = 0
  private ensure (n: number) {
    if (this.pos + n <= this.buf.byteLength) return
    let size = this.buf.byteLength * 2
    while (size < this.pos + n) size *= 2
    const next = new ArrayBuffer(size)
    new Uint8Array(next).set(new Uint8Array(this.buf))
    this.buf = next
    this.view = new DataView(next)
  }
  i32be (v: number) { this.ensure(4); this.view.setInt32(this.pos, v, false); this.pos += 4 }
  i32 (v: number) { this.ensure(4); this.view.setInt32(this.pos, v, true); this.pos += 4 }
  u32 (v: number) { this.ensure(4); this.view.setUint32(this.pos, v, true); this.pos += 4 }
  u16 (v: number) { this.ensure(2); this.view.setUint16(this.pos, v, true); this.pos += 2 }
  u8 (v: number) { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1 }
  f64 (v: number) { this.ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8 }
  bytes (b: Uint8Array) { this.ensure(b.length); new Uint8Array(this.buf, this.pos, b.length).set(b); this.pos += b.length }
  setI32be (at: number, v: number) { this.view.setInt32(at, v, false) }
  result (): Uint8Array { return new Uint8Array(this.buf.slice(0, this.pos)) }
}

interface Box { xmin: number, ymin: number, xmax: number, ymax: number, zmin: number, zmax: number }
const emptyBox = (): Box => ({ xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity, zmin: Infinity, zmax: -Infinity })
function extend (b: Box, c: Coord) {
  if (c[0] < b.xmin) b.xmin = c[0]
  if (c[0] > b.xmax) b.xmax = c[0]
  if (c[1] < b.ymin) b.ymin = c[1]
  if (c[1] > b.ymax) b.ymax = c[1]
  const z = c[2] ?? 0
  if (z < b.zmin) b.zmin = z
  if (z > b.zmax) b.zmax = z
}
const fin = (v: number) => (Number.isFinite(v) ? v : 0)

/** Returns [parts, points] for multi-part shapes. */
function partsFor (kind: ExportLayer['geometryKind'], g: EsriGeometryJSON): Coord[][] {
  if (kind === 'polygon') return groupRings(g.rings ?? []).flat()
  if (kind === 'polyline') return (g.paths ?? []).filter(p => p.length >= 2)
  if (kind === 'multipoint') return [g.points ?? []]
  return [[[g.x as number, g.y as number, g.z ?? 0]]]
}

function writeGeometryRecord (w: ByteWriter, kind: ExportLayer['geometryKind'], hasZ: boolean, g: EsriGeometryJSON | null, total: Box) {
  const type = SHAPE_TYPES[kind][hasZ ? 1 : 0]
  const parts = g ? partsFor(kind, g) : []
  const points = parts.flat()
  if (!g || points.length === 0) { w.i32(0); return } // null shape

  const box = emptyBox()
  points.forEach(p => { extend(box, p); extend(total, p) })
  w.i32(type)

  if (kind === 'point') {
    const p = points[0]
    w.f64(p[0]); w.f64(p[1])
    if (hasZ) { w.f64(p[2] ?? 0); w.f64(0) }
    return
  }
  w.f64(box.xmin); w.f64(box.ymin); w.f64(box.xmax); w.f64(box.ymax)
  if (kind === 'multipoint') {
    w.i32(points.length)
  } else {
    w.i32(parts.length); w.i32(points.length)
    let idx = 0
    for (const part of parts) { w.i32(idx); idx += part.length }
  }
  for (const p of points) { w.f64(p[0]); w.f64(p[1]) }
  if (hasZ) {
    w.f64(fin(box.zmin)); w.f64(fin(box.zmax))
    for (const p of points) w.f64(p[2] ?? 0)
    w.f64(0); w.f64(0)
    for (let i = 0; i < points.length; i++) w.f64(0)
  }
}

function writeHeader (w: ByteWriter, type: number, box: Box, hasZ: boolean) {
  w.i32be(9994)
  for (let i = 0; i < 5; i++) w.i32be(0)
  w.i32be(0) // file length placeholder (16-bit words)
  w.i32(1000)
  w.i32(type)
  w.f64(fin(box.xmin)); w.f64(fin(box.ymin)); w.f64(fin(box.xmax)); w.f64(fin(box.ymax))
  w.f64(hasZ ? fin(box.zmin) : 0); w.f64(hasZ ? fin(box.zmax) : 0)
  w.f64(0); w.f64(0)
}

// ---------------------------------------------------------------- DBF

const enc = new TextEncoder()
function truncateUtf8 (s: string, maxBytes: number): Uint8Array {
  let b = enc.encode(s)
  if (b.length <= maxBytes) return b
  let chars = Array.from(s)
  while (b.length > maxBytes && chars.length) { chars = chars.slice(0, -1); b = enc.encode(chars.join('')) }
  return b
}

interface DbfField { name: string, type: 'C' | 'N' | 'D', length: number, decimals: number, src: ExportField }

function formatNumber (v: number, len: number, dec: number): string {
  let s = v.toFixed(dec)
  for (let d = dec; s.length > len && d > 0; d--) s = v.toFixed(d - 1)
  if (s.length > len) s = v.toExponential(Math.max(0, len - 7))
  return s.length > len ? '*'.repeat(len) : s.padStart(len, ' ')
}

function dbfDate (v: unknown): string {
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
  if (Number.isNaN(d.getTime())) return '        '
  return `${d.getUTCFullYear()}`.padStart(4, '0') + `${d.getUTCMonth() + 1}`.padStart(2, '0') + `${d.getUTCDate()}`.padStart(2, '0')
}

function planDbfFields (layer: ExportLayer): DbfField[] {
  const names = uniqueNames(layer.fields.map(f => f.name.replace(/[^A-Za-z0-9_]/g, '_') || 'FIELD'), 10)
  return layer.fields.map((f, i) => {
    const values = layer.features.map(ft => ft.attributes[f.name]).filter(v => !isNil(v))
    if (f.kind === 'date') return { name: names[i], type: 'D', length: 8, decimals: 0, src: f }
    if (f.kind === 'integer') {
      const width = values.reduce<number>((m, v) => Math.max(m, String(Math.trunc(Number(v))).length), 1)
      return { name: names[i], type: 'N', length: Math.min(Math.max(width, 9), 19), decimals: 0, src: f }
    }
    if (f.kind === 'double') return { name: names[i], type: 'N', length: 19, decimals: 11, src: f }
    const maxBytes = values.reduce<number>((m, v) => Math.max(m, enc.encode(String(v)).length), 1)
    return { name: names[i], type: 'C', length: Math.min(254, Math.max(1, maxBytes)), decimals: 0, src: f }
  })
}

export function writeDbf (layer: ExportLayer): Uint8Array {
  const fields = planDbfFields(layer)
  const recordLength = 1 + fields.reduce((s, f) => s + f.length, 0)
  const headerLength = 32 + 32 * fields.length + 1
  const w = new ByteWriter()
  const now = new Date()
  w.u8(0x03); w.u8(now.getFullYear() - 1900); w.u8(now.getMonth() + 1); w.u8(now.getDate())
  w.u32(layer.features.length)
  w.u16(headerLength)
  w.u16(recordLength)
  for (let i = 0; i < 20; i++) w.u8(0) // reserved; encoding is declared by the .cpg file (UTF-8)

  for (const f of fields) {
    const nameBytes = new Uint8Array(11)
    nameBytes.set(enc.encode(f.name).slice(0, 10))
    w.bytes(nameBytes)
    w.u8(f.type.charCodeAt(0))
    w.u32(0)
    w.u8(f.length)
    w.u8(f.decimals)
    for (let i = 0; i < 14; i++) w.u8(0)
  }
  w.u8(0x0d)

  const space = 0x20
  for (const ft of layer.features) {
    w.u8(space)
    for (const f of fields) {
      const v = ft.attributes[f.src.name]
      const cell = new Uint8Array(f.length).fill(space)
      if (!isNil(v)) {
        if (f.type === 'C') cell.set(truncateUtf8(String(v), f.length))
        else if (f.type === 'D') cell.set(enc.encode(dbfDate(v)))
        else {
          const n = Number(v)
          if (Number.isFinite(n)) cell.set(enc.encode(formatNumber(f.decimals === 0 ? Math.trunc(n) : n, f.length, f.decimals)))
        }
      }
      w.bytes(cell)
    }
  }
  w.u8(0x1a)
  return w.result()
}

// ---------------------------------------------------------------- public

export function writeShapefile (layer: ExportLayer, baseName: string, prjWkt?: string): OutputFile[] {
  const type = SHAPE_TYPES[layer.geometryKind][layer.hasZ ? 1 : 0]
  const total = emptyBox()

  const shp = new ByteWriter()
  const shx = new ByteWriter()
  // Placeholder headers; rewritten once the bounding box is known.
  writeHeader(shp, type, total, layer.hasZ)
  writeHeader(shx, type, total, layer.hasZ)

  layer.features.forEach((ft, i) => {
    const recordStart = shp.pos
    shp.i32be(i + 1)
    shp.i32be(0)
    const contentStart = shp.pos
    writeGeometryRecord(shp, layer.geometryKind, layer.hasZ, ft.geometry, total)
    const contentWords = (shp.pos - contentStart) / 2
    shp.setI32be(recordStart + 4, contentWords)
    shx.i32be(recordStart / 2)
    shx.i32be(contentWords)
  })

  const shpBytes = shp.result()
  const shxBytes = shx.result()
  for (const [bytes] of [[shpBytes], [shxBytes]] as const) {
    const hw = new ByteWriter()
    writeHeader(hw, type, total, layer.hasZ)
    const header = hw.result()
    new DataView(header.buffer).setInt32(24, bytes.length / 2, false)
    bytes.set(header, 0)
  }

  const files: OutputFile[] = [
    { name: `${baseName}.shp`, data: shpBytes },
    { name: `${baseName}.shx`, data: shxBytes },
    { name: `${baseName}.dbf`, data: writeDbf(layer) },
    { name: `${baseName}.cpg`, data: 'UTF-8' }
  ]
  if (prjWkt) files.push({ name: `${baseName}.prj`, data: prjWkt })
  return files
}
