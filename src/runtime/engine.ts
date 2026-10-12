/**
 * ArcGIS-specific part of the export: finding queryable layers, querying the
 * features inside the drawn area, clipping, projecting and converting them into
 * the framework-free ExportLayer model used by the writers in ./lib.
 */
import SpatialReference from 'esri/geometry/SpatialReference'
import Query from 'esri/rest/support/Query'
import type Polygon from 'esri/geometry/Polygon'
import type Graphic from 'esri/Graphic'
import type EsriMap from 'esri/Map'
import * as projectOperator from 'esri/geometry/operators/projectOperator'
import * as intersectionOperator from 'esri/geometry/operators/intersectionOperator'
import * as labelPointOperator from 'esri/geometry/operators/labelPointOperator'
import * as geodeticAreaOperator from 'esri/geometry/operators/geodeticAreaOperator'
import * as geographicTransformationUtils from 'esri/geometry/operators/support/geographicTransformationUtils'
import type GeographicTransformation from 'esri/geometry/operators/support/GeographicTransformation'

import type { ExportCrs, ExportField, ExportFeature, ExportLayer, EsriGeometryJSON, GeometryKind } from './lib/types'
import { isEmptyGeometry } from './lib/types'
import { getCrsInfo, fetchEsriWkt } from './lib/crs'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyLayer = any

export interface LayerEntry {
  id: string
  title: string
  visible: boolean
  geometryKind: GeometryKind
  source: AnyLayer
}

const KIND: Record<string, GeometryKind> = {
  point: 'point',
  multipoint: 'multipoint',
  polyline: 'polyline',
  polygon: 'polygon'
}

export const isAbortError = (e: unknown): boolean => (e as any)?.name === 'AbortError'

let operatorsLoaded: Promise<void> | null = null
export function loadOperators (): Promise<void> {
  if (!operatorsLoaded) {
    operatorsLoaded = Promise.all([
      projectOperator.isLoaded() ? undefined : projectOperator.load(),
      geographicTransformationUtils.isLoaded() ? undefined : geographicTransformationUtils.load(),
      geodeticAreaOperator.isLoaded() ? undefined : geodeticAreaOperator.load()
    ]).then(() => undefined)
    operatorsLoaded.catch(() => { operatorsLoaded = null })
  }
  return operatorsLoaded
}

function effectiveVisibility (layer: AnyLayer): boolean {
  let l = layer
  while (l) {
    if (l.visible === false) return false
    l = l.parent && 'visible' in l.parent ? l.parent : null
  }
  return true
}

/** All layers on the map that can be queried for features, top-most first. */
export async function collectLayers (map: EsriMap, excludeIds: Set<string>): Promise<LayerEntry[]> {
  const layers: AnyLayer[] = map.allLayers.toArray().filter((l: AnyLayer) => !excludeIds.has(l.id))
  await Promise.allSettled(layers.map(l => (typeof l.load === 'function' ? l.load() : undefined)))
  const out: LayerEntry[] = []
  for (const l of layers) {
    if (l.type === 'map-image') {
      const subs: AnyLayer[] = l.allSublayers?.toArray?.() ?? []
      for (const s of subs) {
        if (s.sublayers?.length || typeof s.queryFeatures !== 'function') continue
        try { await s.load?.() } catch { continue }
        const kind = KIND[s.geometryType]
        if (kind) out.push({ id: `${l.id}/${s.id}`, title: `${l.title} › ${s.title}`, visible: effectiveVisibility(l) && s.visible !== false, geometryKind: kind, source: s })
      }
      continue
    }
    const kind = KIND[l.geometryType]
    if (kind && typeof l.queryFeatures === 'function') {
      out.push({ id: l.id, title: l.title || l.id, visible: effectiveVisibility(l), geometryKind: kind, source: l })
    }
  }
  return out.reverse()
}

export interface QueryResult { graphics: Graphic[], total: number, truncated: boolean }

/** Features intersecting the area, honouring the layer's definition expression; pages through large results. */
export async function queryFeaturesInArea (
  src: AnyLayer, area: Polygon, outSR: SpatialReference, maxFeatures: number, signal: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<QueryResult> {
  if (typeof src.load === 'function') await src.load()
  const base: Query = typeof src.createQuery === 'function' ? src.createQuery() : new Query({ where: src.definitionExpression || '1=1' })
  base.geometry = area
  base.spatialRelationship = 'intersects'
  base.returnGeometry = true
  base.outFields = ['*']
  base.outSpatialReference = outSR
  if (src.hasZ) base.returnZ = true

  let ids: Array<number | string> | null = null
  if (typeof src.queryObjectIds === 'function') {
    try { ids = await src.queryObjectIds(base, { signal }) } catch (e) { if (isAbortError(e)) throw e; ids = null }
  }
  if (!ids) {
    base.num = maxFeatures
    const fs = await src.queryFeatures(base, { signal })
    return { graphics: fs.features, total: fs.features.length, truncated: !!fs.exceededTransferLimit }
  }

  const total = ids.length
  const take = ids.slice(0, maxFeatures)
  const maxRecords = Number(src.capabilities?.query?.maxRecordCount ?? src.sourceJSON?.maxRecordCount) || 1000
  const pageSize = Math.max(1, Math.min(maxRecords, 2000))
  const graphics: Graphic[] = []
  for (let i = 0; i < take.length; i += pageSize) {
    const q = base.clone()
    q.geometry = null
    q.objectIds = take.slice(i, i + pageSize) as any
    const fs = await src.queryFeatures(q, { signal })
    graphics.push(...fs.features)
    onProgress?.(graphics.length, take.length)
  }
  return { graphics, total, truncated: total > maxFeatures }
}

const STRING_TYPES = new Set(['string', 'guid', 'global-id', 'xml', 'date-only', 'time-only', 'timestamp-offset'])
const INT_TYPES = new Set(['small-integer', 'integer', 'long', 'big-integer', 'oid'])
const DOUBLE_TYPES = new Set(['single', 'double'])

interface FieldPlan { fields: ExportField[], convert: (attrs: Record<string, unknown>) => Record<string, unknown>, labelField?: string }

export function planFields (src: AnyLayer, sample: Graphic[], useDomainDescriptions: boolean): FieldPlan {
  const srcFields: AnyLayer[] = src.fields?.length
    ? src.fields
    : Object.keys(sample[0]?.attributes ?? {}).map(name => ({ name, type: 'string' }))
  const fields: ExportField[] = []
  const converters: Array<[string, (v: unknown) => unknown]> = []
  for (const f of srcFields) {
    const domain = useDomainDescriptions && f.domain?.type === 'coded-value' ? f.domain : null
    let kind: ExportField['kind'] | null = null
    if (domain) kind = 'string'
    else if (STRING_TYPES.has(f.type)) kind = 'string'
    else if (INT_TYPES.has(f.type)) kind = 'integer'
    else if (DOUBLE_TYPES.has(f.type)) kind = 'double'
    else if (f.type === 'date') kind = 'date'
    if (!kind) continue // geometry, blob, raster...
    fields.push({ name: f.name, alias: f.alias, kind, length: f.length })
    converters.push([f.name, domain
      ? (v: unknown) => (v === null || v === undefined ? v : (domain.codedValues?.find((c: AnyLayer) => c.code === v)?.name ?? v))
      : (v: unknown) => v])
  }
  const displayField = src.displayField && fields.some(f => f.name === src.displayField) ? src.displayField : undefined
  const labelField = displayField ?? fields.find(f => f.kind === 'string')?.name ?? fields[0]?.name
  return {
    fields,
    labelField,
    convert: attrs => Object.fromEntries(converters.map(([name, conv]) => [name, conv(attrs?.[name])]))
  }
}

export interface TargetCrs { sr: SpatialReference, crs: ExportCrs }

/** Resolves the chosen coordinate system, including its .prj WKT where possible. */
export async function resolveTarget (choice: 'map' | number, mapSR: SpatialReference, wktLookupUrl: string, signal?: AbortSignal): Promise<TargetCrs> {
  if (choice === 'map') {
    if (mapSR.wkid) return resolveTarget(mapSR.wkid, mapSR, wktLookupUrl, signal)
    return { sr: mapSR, crs: { name: 'Map coordinate system', wkt: mapSR.wkt ?? undefined, isGeographic: !!mapSR.isGeographic } }
  }
  const info = getCrsInfo(choice)
  const wkid = info?.wkid ?? choice
  const sr = new SpatialReference({ wkid })
  const wkt = info?.wkt ?? await fetchEsriWkt(wkid, wktLookupUrl, signal)
  return { sr, crs: { wkid, name: info?.name ?? `EPSG:${wkid}`, wkt, isGeographic: info?.isGeographic ?? !!sr.isGeographic } }
}

export function listTransformations (from: SpatialReference, to: SpatialReference, area: Polygon | null): GeographicTransformation[] {
  if (from.equals(to)) return []
  try { return geographicTransformationUtils.getTransformations(from, to, area?.extent ?? null).slice(0, 12) } catch { return [] }
}

export const describeTransformation = (t: GeographicTransformation): string =>
  t.steps.map(s => `${s.wkid ? `EPSG:${s.wkid}` : 'custom'}${s.isInverse ? ' (inverse)' : ''}`).join(' + ')

export function areaSqKm (area: Polygon): number | null {
  try { return geodeticAreaOperator.execute(area, { unit: 'square-kilometers' }) } catch { return null }
}

export function toLonLat (area: Polygon): [number, number] | null {
  try {
    const c = area.extent?.center
    if (!c) return null
    const p = projectOperator.execute(c, new SpatialReference({ wkid: 4326 })) as any
    return p ? [p.x, p.y] : null
  } catch { return null }
}

const stripJson = (g: AnyLayer): EsriGeometryJSON | null => {
  if (!g) return null
  const j = g.toJSON()
  const out: EsriGeometryJSON = {}
  if (j.rings) out.rings = j.rings
  else if (j.paths) out.paths = j.paths
  else if (j.points) out.points = j.points
  else { out.x = j.x; out.y = j.y; if (Number.isFinite(j.z)) out.z = j.z }
  return isEmptyGeometry(out) ? null : out
}

export interface ConvertOptions {
  area: Polygon
  clip: boolean
  target: SpatialReference
  transformation: GeographicTransformation | null
  labels: boolean
}

/**
 * Clips (optional) and projects geometries. Features whose clipped geometry is empty are dropped.
 * Throws if the projection engine does not support the target coordinate system.
 */
export function convertFeatures (graphics: Graphic[], kind: GeometryKind, opts: ConvertOptions, convert: FieldPlan['convert']): ExportFeature[] {
  let geoms: AnyLayer[] = graphics.map(g => g.geometry ?? null)
  if (opts.clip && kind !== 'point') {
    geoms = geoms.map(g => {
      if (!g) return null
      try { return intersectionOperator.execute(g, opts.area) ?? null } catch { return g }
    })
  }
  const keep = geoms.map((g, i) => (g ? i : -1)).filter(i => i >= 0)
  let projected: AnyLayer[] = keep.map(i => geoms[i])
  const sourceSR = projected[0]?.spatialReference
  if (projected.length && sourceSR && !sourceSR.equals(opts.target)) {
    projected = projectOperator.executeMany(projected, opts.target, { geographicTransformation: opts.transformation ?? undefined })
    if (projected.every(p => !p)) throw new Error('projection-failed')
  }
  const features: ExportFeature[] = []
  keep.forEach((srcIndex, j) => {
    const g = projected[j]
    const json = stripJson(g)
    if (!json) return
    const feature: ExportFeature = { attributes: convert(graphics[srcIndex].attributes ?? {}), geometry: json }
    if (opts.labels && kind !== 'point') {
      try { const lp = labelPointOperator.execute(g); if (lp) feature.labelPoint = [lp.x, lp.y] } catch { /* fall back to writer default */ }
    }
    features.push(feature)
  })
  return features
}

export function buildAreaLayer (area: Polygon, opts: ConvertOptions): ExportLayer {
  const sqKm = areaSqKm(area)
  const fields: ExportField[] = [
    { name: 'NAME', kind: 'string' },
    { name: 'AREA_HA', kind: 'double' },
    { name: 'CREATED', kind: 'date' }
  ]
  const fake = { geometry: area, attributes: {} } as unknown as Graphic
  const features = convertFeatures([fake], 'polygon', { ...opts, clip: false, labels: false }, () => ({
    NAME: 'Export area',
    AREA_HA: sqKm === null ? null : Math.round(sqKm * 100 * 10000) / 10000,
    CREATED: Date.now()
  }))
  return { name: 'Export_Area', geometryKind: 'polygon', hasZ: false, fields, features, labelField: 'NAME' }
}

export function downloadBlob (blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
