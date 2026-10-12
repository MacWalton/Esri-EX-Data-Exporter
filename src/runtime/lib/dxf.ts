import type { Coord, ExportLayer, ExportFeature } from './types'
import { groupRings } from './rings'
import { safeName, uniqueNames, textValue } from './format'

/**
 * AutoCAD DXF writer (R12 / AC1009 ASCII). R12 is the most widely readable DXF
 * flavour (AutoCAD, Civil 3D, MicroStation, BricsCAD, QGIS, ArcGIS Pro, FME).
 * Each source layer becomes a CAD layer; polygons and their holes are written as
 * closed polylines, lines as open polylines, points as POINT entities.
 * Optional TEXT labels go on a companion "<layer>_LABELS" layer.
 */

export interface DxfOptions {
  decimals: number
  labels: boolean
  /** Text height in target units. If omitted it is derived from the data extent. */
  textHeight?: number
}

const COLORS = [1, 3, 5, 6, 4, 2, 30, 140, 210, 94, 172, 12]

function escapeText (s: string): string {
  let out = ''
  for (const ch of s.replace(/[\r\n]+/g, ' ')) {
    const cp = ch.codePointAt(0) as number
    if (cp < 128) out += ch
    else if (cp <= 0xffff) out += `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
    else out += '?'
  }
  return out.slice(0, 250)
}

export function writeDxf (layers: ExportLayer[], opts: DxfOptions): string {
  const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(opts.decimals)).toString() : '0')
  const lines: string[] = []
  const g = (code: number, value: string | number) => { lines.push(String(code), typeof value === 'number' ? fmt(value) : value) }
  const gi = (code: number, value: number) => { lines.push(String(code), String(Math.trunc(value))) }

  // Extent
  let xmin = Infinity; let ymin = Infinity; let xmax = -Infinity; let ymax = -Infinity
  const visit = (c: Coord) => {
    if (c[0] < xmin) xmin = c[0]
    if (c[0] > xmax) xmax = c[0]
    if (c[1] < ymin) ymin = c[1]
    if (c[1] > ymax) ymax = c[1]
  }
  for (const l of layers) {
    for (const f of l.features) {
      const geom = f.geometry
      if (!geom) continue
      if (geom.rings) geom.rings.forEach(r => r.forEach(visit))
      else if (geom.paths) geom.paths.forEach(p => p.forEach(visit))
      else if (geom.points) geom.points.forEach(visit)
      else if (Number.isFinite(geom.x)) visit([geom.x as number, geom.y as number])
    }
  }
  if (!Number.isFinite(xmin)) { xmin = ymin = xmax = ymax = 0 }
  const textHeight = opts.textHeight ?? Math.max(Math.hypot(xmax - xmin, ymax - ymin) / 400, 1e-6)

  const cadNames = uniqueNames(layers.map(l => safeName(l.name, 27, 'LAYER').toUpperCase()), 27)
  const labelled = layers.map(l => opts.labels && !!l.labelField)
  const tableLayers: Array<{ name: string, color: number }> = [{ name: '0', color: 7 }]
  cadNames.forEach((n, i) => {
    tableLayers.push({ name: n, color: COLORS[i % COLORS.length] })
    if (labelled[i]) tableLayers.push({ name: `${n}_LABELS`, color: 7 })
  })

  // HEADER
  g(0, 'SECTION'); g(2, 'HEADER')
  g(9, '$ACADVER'); g(1, 'AC1009')
  g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252')
  g(9, '$INSBASE'); g(10, 0); g(20, 0); g(30, 0)
  g(9, '$EXTMIN'); g(10, xmin); g(20, ymin); g(30, 0)
  g(9, '$EXTMAX'); g(10, xmax); g(20, ymax); g(30, 0)
  g(9, '$LIMMIN'); g(10, xmin); g(20, ymin)
  g(9, '$LIMMAX'); g(10, xmax); g(20, ymax)
  g(9, '$TEXTSIZE'); g(40, textHeight)
  g(0, 'ENDSEC')

  // TABLES
  g(0, 'SECTION'); g(2, 'TABLES')
  g(0, 'TABLE'); g(2, 'LTYPE'); gi(70, 1)
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); gi(70, 0); g(3, 'Solid line'); gi(72, 65); gi(73, 0); g(40, 0)
  g(0, 'ENDTAB')
  g(0, 'TABLE'); g(2, 'LAYER'); gi(70, tableLayers.length)
  for (const l of tableLayers) { g(0, 'LAYER'); g(2, l.name); gi(70, 0); gi(62, l.color); g(6, 'CONTINUOUS') }
  g(0, 'ENDTAB')
  g(0, 'TABLE'); g(2, 'STYLE'); gi(70, 1)
  g(0, 'STYLE'); g(2, 'STANDARD'); gi(70, 0); g(40, 0); g(41, 1); g(50, 0); gi(71, 0); g(42, textHeight); g(3, 'txt'); g(4, '')
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')

  // ENTITIES
  g(0, 'SECTION'); g(2, 'ENTITIES')

  const point = (layer: string, c: Coord) => {
    g(0, 'POINT'); g(8, layer); g(10, c[0]); g(20, c[1]); g(30, c[2] ?? 0)
  }
  const polyline = (layer: string, coords: Coord[], closed: boolean, is3d: boolean) => {
    let pts = coords
    if (closed && pts.length > 1) {
      const a = pts[0]; const b = pts[pts.length - 1]
      if (a[0] === b[0] && a[1] === b[1]) pts = pts.slice(0, -1)
    }
    if (pts.length < 2) return
    const elevation = is3d ? 0 : (pts[0][2] ?? 0)
    g(0, 'POLYLINE'); g(8, layer); gi(66, 1); g(10, 0); g(20, 0); g(30, elevation)
    gi(70, (closed ? 1 : 0) | (is3d ? 8 : 0))
    for (const c of pts) {
      g(0, 'VERTEX'); g(8, layer); g(10, c[0]); g(20, c[1]); g(30, is3d ? (c[2] ?? 0) : elevation)
      if (is3d) gi(70, 32)
    }
    g(0, 'SEQEND'); g(8, layer)
  }
  const text = (layer: string, c: Coord, value: string) => {
    if (!value) return
    g(0, 'TEXT'); g(8, layer); g(10, c[0]); g(20, c[1]); g(30, 0); g(40, textHeight); g(1, escapeText(value))
  }
  const fallbackLabelPoint = (f: ExportFeature): Coord | null => {
    const geom = f.geometry
    if (!geom) return null
    if (geom.rings?.[0]?.length) return geom.rings[0][0]
    if (geom.paths?.[0]?.length) { const p = geom.paths[0]; return p[Math.floor(p.length / 2)] }
    if (geom.points?.length) return geom.points[0]
    return Number.isFinite(geom.x) ? [geom.x as number, geom.y as number] : null
  }

  layers.forEach((l, i) => {
    const name = cadNames[i]
    const labelField = l.fields.find(f => f.name === l.labelField)
    for (const f of l.features) {
      const geom = f.geometry
      if (!geom) continue
      if (l.geometryKind === 'polygon' && geom.rings) {
        for (const ring of groupRings(geom.rings).flat()) polyline(name, ring, true, l.hasZ)
      } else if (l.geometryKind === 'polyline' && geom.paths) {
        for (const path of geom.paths) polyline(name, path, false, l.hasZ)
      } else if (l.geometryKind === 'multipoint' && geom.points) {
        for (const p of geom.points) point(name, p)
      } else if (Number.isFinite(geom.x)) {
        point(name, [geom.x as number, geom.y as number, geom.z ?? 0])
      }
      if (labelled[i] && labelField) {
        const at = f.labelPoint ?? fallbackLabelPoint(f)
        if (at) text(`${name}_LABELS`, at, textValue(labelField, f.attributes[labelField.name]))
      }
    }
  })

  g(0, 'ENDSEC')
  g(0, 'EOF')
  return lines.join('\r\n') + '\r\n'
}
