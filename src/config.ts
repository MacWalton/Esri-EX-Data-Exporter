import type { ImmutableObject } from 'jimu-core'
import type { FormatId } from './runtime/lib/exporters'

export interface Config {
  /** Output formats offered to the user. */
  formats: FormatId[]
  defaultFormat: FormatId
  /** EPSG/WKID codes offered in the coordinate system list. */
  spatialReferences: number[]
  /** 0 = same as the map. */
  defaultWkid: number
  includeMapSpatialReference: boolean
  /** Let users type any EPSG code. */
  allowCustomWkid: boolean
  /** Suggest the MGA / UTM zone for the drawn area. */
  suggestGridZone: boolean
  /** Let users choose between alternative datum transformations. */
  showTransformationChoice: boolean
  clipToArea: boolean
  includeAreaBoundary: boolean
  /** Pre-select only layers that are visible on the map. */
  preselectVisibleOnly: boolean
  maxFeaturesPerLayer: number
  /** 0 = unlimited. */
  maxAreaSqKm: number
  useDomainDescriptions: boolean
  dxfLabels: boolean
  /** URL template returning ESRI WKT for EPSG codes not in the built-in catalogue. Empty = disabled. */
  wktLookupUrl: string
  fileNamePrefix: string
}

export type IMConfig = ImmutableObject<Config>
