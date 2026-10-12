import type { Coord, ExportCrs, ExportLayer, EsriGeometryJSON, GeometryKind } from './types'
import { groupRings, reversed } from './rings'
import { jsonValue } from './format'

export interface GeoJsonGeometry { type: string, coordinates: unknown }

/** ArcGIS JSON geometry -> GeoJSON geometry (RFC 7946 ring orientation). */
export function toGeoJsonGeometry (kind: GeometryKind, g: EsriGeometryJSON | null, round: (n: number) => number): GeoJsonGeometry | null {
  if (!g) return null
  const c = (p: Coord) => (p.length > 2 && Number.isFinite(p[2]) ? [round(p[0]), round(p[1]), round(p[2])] : [round(p[0]), round(p[1])])
  if (kind === 'point') {
    const p: Coord = Number.isFinite(g.z) ? [g.x as number, g.y as number, g.z as number] : [g.x as number, g.y as number]
    return { type: 'Point', coordinates: c(p) }
  }
  if (kind === 'multipoint') return { type: 'MultiPoint', coordinates: (g.points ?? []).map(c) }
  if (kind === 'polyline') {
    const paths = (g.paths ?? []).map(p => p.map(c))
    return paths.length === 1 ? { type: 'LineString', coordinates: paths[0] } : { type: 'MultiLineString', coordinates: paths }
  }
  // RFC 7946: exterior rings counter-clockwise, holes clockwise (opposite of ArcGIS).
  const polys = groupRings(g.rings ?? []).map(rings => rings.map(r => reversed(r).map(c)))
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }
}

export function writeGeoJson (layer: ExportLayer, crs: ExportCrs, decimals: number): string {
  const f = Math.pow(10, decimals)
  const round = (n: number) => Math.round(n * f) / f
  const fc: Record<string, unknown> = { type: 'FeatureCollection', name: layer.name }
  // RFC 7946 assumes WGS 84. For any other CRS add the (legacy, GDAL/QGIS-supported) crs member.
  if (crs.wkid && crs.wkid !== 4326) {
    fc.crs = { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${crs.wkid}` } }
  }
  fc.features = layer.features.map(ft => ({
    type: 'Feature',
    properties: Object.fromEntries(layer.fields.map(fd => [fd.name, jsonValue(fd, ft.attributes[fd.name])])),
    geometry: toGeoJsonGeometry(layer.geometryKind, ft.geometry, round)
  }))
  return JSON.stringify(fc)
}
