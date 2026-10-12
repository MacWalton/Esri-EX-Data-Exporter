import type { Coord } from './types'

export type Ring = Coord[]

/** Shoelace area. Positive = counter-clockwise, negative = clockwise (y up). */
export function signedArea (ring: Ring): number {
  let sum = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

export const isClockwise = (ring: Ring): boolean => signedArea(ring) < 0

export function closeRing (ring: Ring): Ring {
  if (ring.length === 0) return ring
  const a = ring[0]
  const b = ring[ring.length - 1]
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a]
}

export function pointInRing (pt: Coord, ring: Ring): boolean {
  const [x, y] = pt
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Groups ArcGIS-style rings into polygons: [[outer, ...holes], ...].
 * ArcGIS convention: outer rings clockwise, holes counter-clockwise.
 * Output is normalised to that convention (outer CW, holes CCW) and every ring is closed.
 */
export function groupRings (rings: Ring[]): Ring[][] {
  const valid = rings.map(closeRing).filter(r => r.length >= 4 && signedArea(r) !== 0)
  let outers = valid.filter(isClockwise)
  let holes = valid.filter(r => !isClockwise(r))
  if (outers.length === 0) {
    // Malformed / reversed input: treat every ring as an outer ring.
    outers = holes.map(r => [...r].reverse())
    holes = []
  }
  const polys: Ring[][] = outers.map(o => [o])
  for (const hole of holes) {
    let best = -1
    let bestArea = Infinity
    outers.forEach((outer, i) => {
      const a = Math.abs(signedArea(outer))
      if (a < bestArea && pointInRing(hole[0], outer)) { best = i; bestArea = a }
    })
    if (best >= 0) polys[best].push(hole)
    else polys.push([[...hole].reverse()]) // orphan hole -> its own polygon
  }
  return polys
}

export const reversed = (ring: Ring): Ring => [...ring].reverse()
