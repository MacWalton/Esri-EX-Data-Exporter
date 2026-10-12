/**
 * Shared, framework-free types for the export writers.
 * Geometries use the ArcGIS JSON shape (x/y/z, points, paths, rings) already
 * projected into the target coordinate system.
 */

export type GeometryKind = 'point' | 'multipoint' | 'polyline' | 'polygon'

export type FieldKind = 'string' | 'integer' | 'double' | 'date'

export interface ExportField {
  name: string
  alias?: string
  kind: FieldKind
  /** Maximum string length declared by the source (used as a hint only). */
  length?: number
}

export type Coord = number[] // [x, y] or [x, y, z]

export interface EsriGeometryJSON {
  x?: number
  y?: number
  z?: number
  points?: Coord[]
  paths?: Coord[][]
  rings?: Coord[][]
}

export interface ExportFeature {
  /** Attribute values keyed by ExportField.name. Dates are epoch milliseconds. */
  attributes: Record<string, unknown>
  geometry: EsriGeometryJSON | null
  /** Optional label anchor (in target CRS) used for CAD text labels. */
  labelPoint?: Coord
}

export interface ExportLayer {
  name: string
  geometryKind: GeometryKind
  hasZ: boolean
  fields: ExportField[]
  features: ExportFeature[]
  /** Field whose value is used for labels / placemark names. */
  labelField?: string
}

export interface ExportCrs {
  wkid?: number
  /** ESRI-flavoured WKT, written to .prj files when available. */
  wkt?: string
  name: string
  isGeographic: boolean
}

export interface OutputFile {
  name: string
  data: Uint8Array | string
}

export const isEmptyGeometry = (g: EsriGeometryJSON | null | undefined): boolean => {
  if (!g) return true
  if (g.rings) return g.rings.length === 0
  if (g.paths) return g.paths.length === 0
  if (g.points) return g.points.length === 0
  return !(Number.isFinite(g.x) && Number.isFinite(g.y))
}
