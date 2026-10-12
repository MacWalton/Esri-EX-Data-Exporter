/**
 * Built-in coordinate system catalogue: friendly names plus ESRI WKT for .prj files.
 * Covers WGS 84, Web Mercator, GDA94/GDA2020 (geographic, MGA zones, Albers),
 * WGS 84 UTM, NAD83 UTM, ETRS89 UTM, British National Grid and NZTM2000.
 * Anything else can still be exported; its .prj is looked up online (see widget config).
 */

export interface CrsInfo {
  wkid: number
  name: string
  wkt?: string
  isGeographic: boolean
}

const GRS80 = 'SPHEROID["GRS_1980",6378137.0,298.257222101]'
const WGS84_SPHEROID = 'SPHEROID["WGS_1984",6378137.0,298.257223563]'
const PRIMEM = 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]'

const geogcs = (name: string, datum: string, spheroid: string) => `GEOGCS["${name}",DATUM["${datum}",${spheroid}],${PRIMEM}]`

const GCS = {
  wgs84: geogcs('GCS_WGS_1984', 'D_WGS_1984', WGS84_SPHEROID),
  gda94: geogcs('GCS_GDA_1994', 'D_GDA_1994', GRS80),
  gda2020: geogcs('GCS_GDA2020', 'D_GDA2020', GRS80),
  nad83: geogcs('GCS_North_American_1983', 'D_North_American_1983', GRS80),
  etrs89: geogcs('GCS_ETRS_1989', 'D_ETRS_1989', GRS80),
  nzgd2000: geogcs('GCS_NZGD_2000', 'D_NZGD_2000', GRS80),
  osgb36: geogcs('GCS_OSGB_1936', 'D_OSGB_1936', 'SPHEROID["Airy_1830",6377563.396,299.3249646]')
}

function tm (name: string, gcs: string, fe: number, fn: number, cm: number, k: number, lat0: number): string {
  const p = (n: string, v: number) => `PARAMETER["${n}",${Number.isInteger(v) ? v.toFixed(1) : v}]`
  return `PROJCS["${name}",${gcs},PROJECTION["Transverse_Mercator"],${p('False_Easting', fe)},${p('False_Northing', fn)},` +
    `${p('Central_Meridian', cm)},${p('Scale_Factor', k)},${p('Latitude_Of_Origin', lat0)},UNIT["Meter",1.0]]`
}

const albersAus = (name: string, gcs: string) =>
  `PROJCS["${name}",${gcs},PROJECTION["Albers"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],` +
  'PARAMETER["Central_Meridian",132.0],PARAMETER["Standard_Parallel_1",-18.0],PARAMETER["Standard_Parallel_2",-36.0],' +
  'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'

const WEB_MERCATOR = `PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",${GCS.wgs84},PROJECTION["Mercator_Auxiliary_Sphere"],` +
  'PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],' +
  'PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]'

const utmCm = (zone: number) => zone * 6 - 183

export function getCrsInfo (wkid: number): CrsInfo | null {
  const id = wkid === 102100 || wkid === 102113 || wkid === 900913 ? 3857 : wkid
  const geo = (name: string, wkt: string): CrsInfo => ({ wkid: id, name, wkt, isGeographic: true })
  const proj = (name: string, wkt: string): CrsInfo => ({ wkid: id, name, wkt, isGeographic: false })

  switch (id) {
    case 4326: return geo('WGS 84 (lat/long)', GCS.wgs84)
    case 3857: return proj('WGS 84 / Web Mercator', WEB_MERCATOR)
    case 4283: return geo('GDA94 (lat/long)', GCS.gda94)
    case 7844: return geo('GDA2020 (lat/long)', GCS.gda2020)
    case 4269: return geo('NAD83 (lat/long)', GCS.nad83)
    case 4258: return geo('ETRS89 (lat/long)', GCS.etrs89)
    case 3577: return proj('GDA94 / Australian Albers', albersAus('GDA_1994_Australia_Albers', GCS.gda94))
    case 9473: return proj('GDA2020 / Australian Albers', albersAus('GDA2020_Australian_Albers', GCS.gda2020))
    // Western Australia GDA2020 project grids (Landgate). Central meridians are whole arc-minutes.
    case 8031: return proj('GDA2020 / PCG2020 (Perth Coastal Grid)', tm('GDA2020_PCG2020', GCS.gda2020, 50000, 3900000, 115 + 49 / 60, 0.99999906, 0))
    case 8013: return proj('GDA2020 / ALB2020 (Albany Grid)', tm('GDA2020_ALB2020', GCS.gda2020, 50000, 4100000, 117 + 53 / 60, 1.0000044, 0))
    case 8021: return proj('GDA2020 / ESP2020 (Esperance Grid)', tm('GDA2020_ESP2020', GCS.gda2020, 50000, 4050000, 121 + 53 / 60, 1.0000055, 0))
    case 27700: return proj('OSGB 1936 / British National Grid', tm('British_National_Grid', GCS.osgb36, 400000, -100000, -2, 0.9996012717, 49))
    case 2193: return proj('NZGD2000 / NZTM 2000', tm('NZGD_2000_New_Zealand_Transverse_Mercator', GCS.nzgd2000, 1600000, 10000000, 173, 0.9996, 0))
  }
  if (id >= 28348 && id <= 28358) {
    const z = id - 28300
    return proj(`GDA94 / MGA zone ${z}`, tm(`GDA_1994_MGA_Zone_${z}`, GCS.gda94, 500000, 10000000, utmCm(z), 0.9996, 0))
  }
  if (id >= 7846 && id <= 7859) {
    const z = id - 7800
    return proj(`GDA2020 / MGA zone ${z}`, tm(`GDA2020_MGA_Zone_${z}`, GCS.gda2020, 500000, 10000000, utmCm(z), 0.9996, 0))
  }
  if (id >= 32601 && id <= 32660) {
    const z = id - 32600
    return proj(`WGS 84 / UTM zone ${z}N`, tm(`WGS_1984_UTM_Zone_${z}N`, GCS.wgs84, 500000, 0, utmCm(z), 0.9996, 0))
  }
  if (id >= 32701 && id <= 32760) {
    const z = id - 32700
    return proj(`WGS 84 / UTM zone ${z}S`, tm(`WGS_1984_UTM_Zone_${z}S`, GCS.wgs84, 500000, 10000000, utmCm(z), 0.9996, 0))
  }
  if (id >= 26901 && id <= 26923) {
    const z = id - 26900
    return proj(`NAD83 / UTM zone ${z}N`, tm(`NAD_1983_UTM_Zone_${z}N`, GCS.nad83, 500000, 0, utmCm(z), 0.9996, 0))
  }
  if (id >= 25828 && id <= 25838) {
    const z = id - 25800
    return proj(`ETRS89 / UTM zone ${z}N`, tm(`ETRS_1989_UTM_Zone_${z}N`, GCS.etrs89, 500000, 0, utmCm(z), 0.9996, 0))
  }
  return null
}

export const crsLabel = (wkid: number): string => {
  const info = getCrsInfo(wkid)
  return info ? `${info.name} — EPSG:${info.wkid}` : `EPSG:${wkid}`
}

/** Suggests grid coordinate systems (MGA / UTM) for a WGS 84 lon/lat location. */
export function suggestGridWkids (lon: number, lat: number): number[] {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 84) return []
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1))
  const out: number[] = []
  // WA project grids first when the area is inside their EPSG area of use (west, south, east, north).
  const projectGrids: Array<[number, number, number, number, number]> = [
    [8031, 115.44, -33.42, 116.09, -31.33], // PCG2020 – Perth area
    [8013, 117.55, -35.21, 118.22, -34.75], // ALB2020 – Albany area
    [8021, 121.56, -34.5, 122.2, -33.33] // ESP2020 – Esperance area
  ]
  for (const [wkid, w, s, e, n] of projectGrids) if (lon >= w && lon <= e && lat >= s && lat <= n) out.push(wkid)
  const inAustralia = lon >= 93 && lon <= 174 && lat <= -8 && lat >= -60
  if (inAustralia && zone >= 46 && zone <= 59) out.push(7800 + zone)
  if (inAustralia && zone >= 48 && zone <= 58) out.push(28300 + zone)
  out.push(lat < 0 ? 32700 + zone : 32600 + zone)
  return out
}

/** Fetches ESRI WKT for an arbitrary EPSG code using a URL template containing {wkid}. */
export async function fetchEsriWkt (wkid: number, urlTemplate: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!urlTemplate) return undefined
  try {
    const res = await fetch(urlTemplate.replace('{wkid}', String(wkid)), { signal })
    if (!res.ok) return undefined
    const text = (await res.text()).trim()
    return /^(PROJCS|GEOGCS|PROJCRS|GEOGCRS|COMPD_CS)\[/.test(text) ? text : undefined
  } catch {
    return undefined
  }
}
