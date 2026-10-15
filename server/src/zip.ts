import { createReadStream, statSync } from 'node:fs'
import type { Writable } from 'node:stream'

/**
 * Minimal streaming ZIP writer (store method, no compression: photos and videos are already
 * compressed). Writes local headers + data + central directory with ZIP64 avoided by keeping
 * archives under 4 GB per album; data descriptors are not used because sizes are known up front.
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

function crc32Update(crc: number, buf: Buffer): number {
  let c = crc ^ 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { date: number; time: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { date, time }
}

export interface ZipEntry {
  name: string
  path: string
}

/** Stream a ZIP of the given files into `out`. Resolves when the central directory has been written. */
export async function writeZip(out: Writable, entries: ZipEntry[]): Promise<void> {
  const write = (b: Buffer) =>
    new Promise<void>((resolve, reject) => {
      if (out.write(b)) resolve()
      else {
        out.once('drain', resolve)
        out.once('error', reject)
      }
    })
  let offset = 0
  const central: Buffer[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    let name = e.name.replace(/[\\/]+/g, '/').replace(/^\/+/, '')
    let n = 2
    const base = name
    while (seen.has(name)) name = base.replace(/(\.[^.]*)?$/, ` (${n++})$1`)
    seen.add(name)
    const st = statSync(e.path)
    const size = st.size
    const nameBuf = Buffer.from(name, 'utf8')
    const { date, time } = dosDateTime(st.mtime)
    // Compute CRC first (one pass), then stream the data (second pass). Files are local, so this is cheap.
    let crc = 0
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(e.path)
      rs.on('data', (chunk: Buffer | string) => {
        crc = crc32Update(crc, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      rs.on('end', resolve)
      rs.on('error', reject)
    })
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // store
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    await write(local)
    await write(nameBuf)
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(e.path)
      rs.on('error', reject)
      rs.on('end', resolve)
      rs.pipe(out, { end: false })
    })
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(time, 12)
    cd.writeUInt16LE(date, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(size, 20)
    cd.writeUInt32LE(size, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))
    offset += 30 + nameBuf.length + size
  }
  const cdStart = offset
  let cdSize = 0
  for (const c of central) {
    await write(c)
    cdSize += c.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(cdSize, 12)
  end.writeUInt32LE(cdStart, 16)
  end.writeUInt16LE(0, 20)
  await write(end)
}
