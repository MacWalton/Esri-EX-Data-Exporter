import type { Coord, ExportLayer, EsriGeometryJSON, GeometryKind } from './types'
import { groupRings } from './rings'
import { textValue } from './format'

/** OGC WKT for an ArcGIS JSON geometry (adds " Z" when the layer has Z values). */
export function toWkt (kind: GeometryKind, g: EsriGeometryJSON | null, hasZ: boolean, round: (n: number) => number): string {
  if (!g) return ''
  const z = hasZ ? ' Z' : ''
  const pt = (p: Coord) => `${round(p[0])} ${round(p[1])}${hasZ ? ' ' + round(p[2] ?? 0) : ''}`
  const seq = (pts: Coord[]) => `(${pts.map(pt).join(', ')})`
  if (kind === 'point') return `POINT${z} (${pt([g.x as number, g.y as number, g.z ?? 0])})`
  if (kind === 'multipoint') return `MULTIPOINT${z} (${(g.points ?? []).map(p => `(${pt(p)})`).join(', ')})`
  if (kind === 'polyline') {
    const paths = g.paths ?? []
    return paths.length === 1 ? `LINESTRING${z} ${seq(paths[0])}` : `MULTILINESTRING${z} (${paths.map(seq).join(', ')})`
  }
  const polys = groupRings(g.rings ?? []).map(rings => `(${rings.map(seq).join(', ')})`)
  return polys.length === 1 ? `POLYGON${z} ${polys[0]}` : `MULTIPOLYGON${z} (${polys.join(', ')})`
}

const cell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** CSV with attributes, X/Y (points) and a WKT geometry column. UTF-8 with BOM for Excel. */
export function writeCsv (layer: ExportLayer, decimals: number): string {
  const f = Math.pow(10, decimals)
  const round = (n: number) => Math.round(n * f) / f
  const isPoint = layer.geometryKind === 'point'
  const header = [...layer.fields.map(fd => fd.name), ...(isPoint ? ['X', 'Y', ...(layer.hasZ ? ['Z'] : [])] : []), 'WKT']
  const rows = [header.map(cell).join(',')]
  for (const ft of layer.features) {
    const g = ft.geometry
    const values = layer.fields.map(fd => textValue(fd, ft.attributes[fd.name]))
    if (isPoint) {
      values.push(g ? String(round(g.x as number)) : '', g ? String(round(g.y as number)) : '')
      if (layer.hasZ) values.push(g && Number.isFinite(g.z) ? String(round(g.z as number)) : '')
    }
    values.push(toWkt(layer.geometryKind, g, layer.hasZ, round))
    rows.push(values.map(cell).join(','))
  }
  return '﻿' + rows.join('\r\n') + '\r\n'
}
