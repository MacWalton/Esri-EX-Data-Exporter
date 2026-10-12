import type { OutputFile } from './types'

/**
 * Minimal ZIP writer (no dependencies). Uses the browser's CompressionStream
 * ('deflate-raw') when available, otherwise stores files uncompressed.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32 (data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()
export const toBytes = (d: Uint8Array | string): Uint8Array => typeof d === 'string' ? enc.encode(d) : d

async function deflateRaw (data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as any).CompressionStream
  if (typeof CS !== 'function' || data.length < 64) return null
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CS('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

function dosDateTime (d: Date): { time: number, date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

export async function createZip (files: OutputFile[], compress = true): Promise<Uint8Array> {
  const { time, date } = dosDateTime(new Date())
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const name = enc.encode(f.name)
    const raw = toBytes(f.data)
    const crc = crc32(raw)
    const deflated = compress ? await deflateRaw(raw) : null
    const useDeflate = deflated !== null && deflated.length < raw.length
    const body = useDeflate ? deflated! : raw
    const method = useDeflate ? 8 : 0

    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(4, 20, true)
    lh.setUint16(6, 0x0800, true) // UTF-8 names
    lh.setUint16(8, method, true)
    lh.setUint16(10, time, true)
    lh.setUint16(12, date, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, body.length, true)
    lh.setUint32(22, raw.length, true)
    lh.setUint16(26, name.length, true)
    lh.setUint16(28, 0, true)
    locals.push(new Uint8Array(lh.buffer), name, body)

    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(4, 20, true)
    ch.setUint16(6, 20, true)
    ch.setUint16(8, 0x0800, true)
    ch.setUint16(10, method, true)
    ch.setUint16(12, time, true)
    ch.setUint16(14, date, true)
    ch.setUint32(16, crc, true)
    ch.setUint32(20, body.length, true)
    ch.setUint32(24, raw.length, true)
    ch.setUint16(28, name.length, true)
    ch.setUint32(42, offset, true)
    centrals.push(new Uint8Array(ch.buffer), name)

    offset += 30 + name.length + body.length
  }

  const cdSize = centrals.reduce((s, p) => s + p.length, 0)
  const eocd = new DataView(new ArrayBuffer(22))
  eocd.setUint32(0, 0x06054b50, true)
  eocd.setUint16(8, files.length, true)
  eocd.setUint16(10, files.length, true)
  eocd.setUint32(12, cdSize, true)
  eocd.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, new Uint8Array(eocd.buffer)]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let pos = 0
  for (const p of parts) { out.set(p, pos); pos += p.length }
  return out
}
