import type { Coord, ExportLayer } from './types'
import { groupRings, reversed } from './rings'
import { textValue } from './format'

/** KML 2.2 writer. Coordinates must already be WGS 84 longitude/latitude. */

const COLORS = ['ff3c14dc', 'ff32cd32', 'ffff901e', 'ff00a5ff', 'ffd355ba', 'ff00d7ff', 'ff8b8b00', 'ff7a96e9']

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] as string))

export function writeKml (layers: ExportLayer[], docName: string): string {
  const r = (n: number) => Number(n.toFixed(8))
  const coords = (pts: Coord[]) => pts.map(p => `${r(p[0])},${r(p[1])}${p.length > 2 && Number.isFinite(p[2]) ? ',' + r(p[2]) : ''}`).join(' ')
  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push('<kml xmlns="http://www.opengis.net/kml/2.2"><Document>')
  out.push(`<name>${esc(docName)}</name>`)

  layers.forEach((l, i) => {
    const color = COLORS[i % COLORS.length]
    const fill = '40' + color.slice(2)
    out.push(`<Style id="s${i}"><LineStyle><color>${color}</color><width>2</width></LineStyle><PolyStyle><color>${fill}</color></PolyStyle><IconStyle><color>${color}</color></IconStyle></Style>`)
  })

  layers.forEach((l, i) => {
    out.push(`<Folder><name>${esc(l.name)}</name>`)
    const labelField = l.fields.find(f => f.name === l.labelField)
    l.features.forEach((ft, n) => {
      const g = ft.geometry
      if (!g) return
      const geoms: string[] = []
      if (l.geometryKind === 'polygon') {
        for (const rings of groupRings(g.rings ?? [])) {
          // KML: outer ring counter-clockwise is the convention used by Google Earth.
          const [outer, ...holes] = rings.map(reversed)
          geoms.push(`<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(outer)}</coordinates></LinearRing></outerBoundaryIs>` +
            holes.map(h => `<innerBoundaryIs><LinearRing><coordinates>${coords(h)}</coordinates></LinearRing></innerBoundaryIs>`).join('') + '</Polygon>')
        }
      } else if (l.geometryKind === 'polyline') {
        for (const p of g.paths ?? []) geoms.push(`<LineString><coordinates>${coords(p)}</coordinates></LineString>`)
      } else if (l.geometryKind === 'multipoint') {
        for (const p of g.points ?? []) geoms.push(`<Point><coordinates>${coords([p])}</coordinates></Point>`)
      } else {
        geoms.push(`<Point><coordinates>${coords([[g.x as number, g.y as number, ...(Number.isFinite(g.z) ? [g.z as number] : [])]])}</coordinates></Point>`)
      }
      if (!geoms.length) return
      const name = labelField ? textValue(labelField, ft.attributes[labelField.name]) : ''
      const data = l.fields.map(f => `<Data name="${esc(f.name)}"><value>${esc(textValue(f, ft.attributes[f.name]))}</value></Data>`).join('')
      const geom = geoms.length === 1 ? geoms[0] : `<MultiGeometry>${geoms.join('')}</MultiGeometry>`
      out.push(`<Placemark><name>${esc(name || `${l.name} ${n + 1}`)}</name><styleUrl>#s${i}</styleUrl><ExtendedData>${data}</ExtendedData>${geom}</Placemark>`)
    })
    out.push('</Folder>')
  })
  out.push('</Document></kml>')
  return out.join('\n')
}
