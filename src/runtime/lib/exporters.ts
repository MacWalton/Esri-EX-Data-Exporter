import type { ExportCrs, ExportLayer, OutputFile } from './types'
import { writeShapefile } from './shapefile'
import { writeDxf } from './dxf'
import { writeGeoJson } from './geojson'
import { writeKml } from './kml'
import { writeCsv } from './csv'
import { createZip, toBytes } from './zip'
import { safeName, uniqueNames } from './format'

export type FormatId = 'dxf' | 'shp' | 'geojson' | 'kml' | 'csv'

export interface FormatInfo {
  id: FormatId
  label: string
  /** KML is WGS 84 by definition, so the CRS choice is overridden. */
  forcesWgs84?: boolean
  kind: 'CAD' | 'GIS' | 'Table'
}

export const FORMATS: Record<FormatId, FormatInfo> = {
  dxf: { id: 'dxf', label: 'AutoCAD DXF (.dxf)', kind: 'CAD' },
  shp: { id: 'shp', label: 'Esri Shapefile (.zip)', kind: 'GIS' },
  geojson: { id: 'geojson', label: 'GeoJSON (.geojson)', kind: 'GIS' },
  kml: { id: 'kml', label: 'Google Earth KML (.kml)', kind: 'GIS', forcesWgs84: true },
  csv: { id: 'csv', label: 'CSV with WKT geometry (.csv)', kind: 'Table' }
}

export const ALL_FORMATS = Object.keys(FORMATS) as FormatId[]

export interface BuildOptions {
  baseName: string
  dxfLabels: boolean
  compress?: boolean
}

export interface BuiltExport {
  fileName: string
  blob: Blob
  fileCount: number
}

const MIME: Record<string, string> = {
  zip: 'application/zip',
  dxf: 'application/dxf',
  geojson: 'application/geo+json',
  kml: 'application/vnd.google-earth.kml+xml',
  csv: 'text/csv'
}

export async function buildExport (format: FormatId, layers: ExportLayer[], crs: ExportCrs, opts: BuildOptions): Promise<BuiltExport> {
  const decimals = crs.isGeographic ? 9 : 4
  const names = uniqueNames(layers.map(l => safeName(l.name)), 60)
  const base = safeName(opts.baseName, 80, 'export')

  const single = async (ext: string, data: string | Uint8Array): Promise<BuiltExport> => ({
    fileName: `${base}.${ext}`,
    blob: new Blob([toBytes(data) as BlobPart], { type: MIME[ext] }),
    fileCount: 1
  })
  const zipped = async (files: OutputFile[]): Promise<BuiltExport> => {
    const bytes = await createZip(files, opts.compress ?? true)
    return { fileName: `${base}.zip`, blob: new Blob([bytes as BlobPart], { type: MIME.zip }), fileCount: files.length }
  }
  const readme = (): OutputFile => ({
    name: 'README.txt',
    data: [
      'Exported from ArcGIS Experience Builder (Area Data Export widget)',
      `Created: ${new Date().toISOString()}`,
      `Coordinate system: ${crs.name}${crs.wkid ? ` (EPSG:${crs.wkid})` : ''}`,
      `Layers: ${layers.map(l => `${l.name} (${l.features.length})`).join(', ')}`,
      crs.wkt ? '' : 'Note: no .prj definition was available for this coordinate system; assign it manually on import.'
    ].join('\r\n')
  })

  switch (format) {
    case 'dxf':
      return single('dxf', writeDxf(layers, { decimals, labels: opts.dxfLabels }))
    case 'kml':
      return single('kml', writeKml(layers, opts.baseName))
    case 'shp': {
      const files = layers.flatMap((l, i) => writeShapefile(l, names[i], crs.wkt))
      return zipped([...files, readme()])
    }
    case 'geojson': {
      if (layers.length === 1) return single('geojson', writeGeoJson(layers[0], crs, decimals))
      return zipped([...layers.map((l, i) => ({ name: `${names[i]}.geojson`, data: writeGeoJson(l, crs, decimals) })), readme()])
    }
    case 'csv': {
      const files: OutputFile[] = layers.map((l, i) => ({ name: `${names[i]}.csv`, data: writeCsv(l, decimals) }))
      if (crs.wkt) files.push({ name: 'coordinate_system.prj', data: crs.wkt })
      return zipped([...files, readme()])
    }
  }
}
