export type PreparedWallpaper = { file: File; width: number; height: number }

const SOURCE_LIMIT = 50 * 1024 * 1024
const OUTPUT_LIMIT = 10 * 1024 * 1024
const PIXEL_LIMIT = 50_000_000
const EDGE_LIMIT = 16_384
const INVALID_IMAGE = "Choose a still JPEG, PNG, or WebP image"

function invalid(): never { throw new Error(INVALID_IMAGE) }
function checkDimensions(width: number, height: number) {
  if (!width || !height || width > EDGE_LIMIT || height > EDGE_LIMIT || width * height > PIXEL_LIMIT)
    throw new Error("Image must be at most 50 million pixels and 16,384 pixels on each side")
}
function textAt(bytes: Uint8Array, offset: number, value: string) {
  return offset + value.length <= bytes.length && [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0))
}
function bigEndian(bytes: Uint8Array, offset: number) { return (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3] }
function littleEndian(bytes: Uint8Array, offset: number) { return (bytes[offset]) + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + (bytes[offset + 3] * 0x1000000) }
function uint24(bytes: Uint8Array, offset: number) { return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) }

function pngDimensions(bytes: Uint8Array): [number, number] {
  if (!textAt(bytes, 1, "PNG\r\n\x1a\n") || bytes[0] !== 0x89 || bytes.length < 33 || bigEndian(bytes, 8) !== 13 || !textAt(bytes, 12, "IHDR")) invalid()
  const dimensions: [number, number] = [bigEndian(bytes, 16), bigEndian(bytes, 20)]
  checkDimensions(...dimensions)
  let offset = 8
  let ended = false
  while (offset + 12 <= bytes.length) {
    const length = bigEndian(bytes, offset)
    const end = offset + 12 + length
    if (end > bytes.length) invalid()
    if (offset !== 8 && textAt(bytes, offset + 4, "IHDR")) invalid()
    if (textAt(bytes, offset + 4, "acTL") || textAt(bytes, offset + 4, "fcTL") || textAt(bytes, offset + 4, "fdAT")) invalid()
    if (textAt(bytes, offset + 4, "IEND")) {
      if (length !== 0 || end !== bytes.length) invalid()
      ended = true
      break
    }
    offset = end
  }
  if (!ended) invalid()
  return dimensions
}
function jpegDimensions(bytes: Uint8Array): [number, number] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid()
  let offset = 2
  let dimensions: [number, number] | undefined
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) invalid()
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) invalid()
    const length = (bytes[offset] << 8) + bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) invalid()
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) invalid()
      if (dimensions) invalid()
      dimensions = [(bytes[offset + 5] << 8) + bytes[offset + 6], (bytes[offset + 3] << 8) + bytes[offset + 4]]
      checkDimensions(...dimensions)
    }
    offset += length
  }
  if (!dimensions) invalid()
  return dimensions
}
function webpDimensions(bytes: Uint8Array): [number, number] {
  if (bytes.length < 20 || !textAt(bytes, 0, "RIFF") || !textAt(bytes, 8, "WEBP") || littleEndian(bytes, 4) !== bytes.length - 8) invalid()
  let offset = 12
  let dimensions: [number, number] | undefined
  let hasAnimation = false
  while (offset + 8 <= bytes.length) {
    const length = littleEndian(bytes, offset + 4)
    const start = offset + 8
    const end = start + length
    if (end > bytes.length) invalid()
    if (textAt(bytes, offset, "ANIM") || textAt(bytes, offset, "ANMF")) hasAnimation = true
    if (textAt(bytes, offset, "VP8X")) {
      if (length < 10) invalid()
      if (bytes[start] & 0x02) hasAnimation = true
      dimensions = [uint24(bytes, start + 4) + 1, uint24(bytes, start + 7) + 1]
      checkDimensions(...dimensions)
    } else if (textAt(bytes, offset, "VP8 ")) {
      if (length < 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) invalid()
      const frame: [number, number] = [((bytes[start + 7] << 8) + bytes[start + 6]) & 0x3fff, ((bytes[start + 9] << 8) + bytes[start + 8]) & 0x3fff]
      checkDimensions(...frame)
      if (!dimensions) dimensions = frame
    } else if (textAt(bytes, offset, "VP8L")) {
      if (length < 5 || bytes[start] !== 0x2f) invalid()
      const bits = littleEndian(bytes, start + 1)
      const frame: [number, number] = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
      checkDimensions(...frame)
      if (!dimensions) dimensions = frame
    }
    offset = end + (length & 1)
  }
  if (offset !== bytes.length || hasAnimation || !dimensions) invalid()
  return dimensions
}
function inspect(bytes: Uint8Array): [number, number] {
  const dimensions = bytes[0] === 0x89 ? pngDimensions(bytes)
    : bytes[0] === 0xff ? jpegDimensions(bytes)
    : textAt(bytes, 0, "RIFF") ? webpDimensions(bytes)
    : invalid()
  checkDimensions(...dimensions)
  return dimensions
}
function assertActive(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Image preparation cancelled", "AbortError")
}
function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.type !== "image/webp") reject(new Error("This browser cannot save WebP images"))
    else resolve(blob)
  }, "image/webp", 0.82))
}

// Native image decoding cannot be interrupted. Serialize it to keep replacements bounded.
let decodeQueue: Promise<void> = Promise.resolve()
function queued<T>(task: () => Promise<T>): Promise<T> {
  const result = decodeQueue.then(task)
  decodeQueue = result.then(() => undefined, () => undefined)
  return result
}

export async function prepareWallpaper(source: File, signal: AbortSignal): Promise<PreparedWallpaper> {
  assertActive(signal)
  if (source.size > SOURCE_LIMIT) throw new Error("Image must be at most 50 MiB")
  return queued(async () => {
    assertActive(signal)
    const bytes = new Uint8Array(await source.arrayBuffer())
    assertActive(signal)
    const [headerWidth, headerHeight] = inspect(bytes)
    const imageType = bytes[0] === 0x89 ? "image/png" : bytes[0] === 0xff ? "image/jpeg" : "image/webp"
    if (typeof createImageBitmap !== "function") throw new Error("This browser cannot prepare images")
    let bitmap: ImageBitmap | undefined
    const canvas = document.createElement("canvas")
    try {
      bitmap = await createImageBitmap(new Blob([bytes], { type: imageType }), { imageOrientation: "from-image" })
      assertActive(signal)
      // EXIF orientation may exchange the edges; validate the decoded allocation too.
      checkDimensions(bitmap.width, bitmap.height)
      if (!(bitmap.width === headerWidth && bitmap.height === headerHeight) && !(bitmap.width === headerHeight && bitmap.height === headerWidth)) invalid()
      const ratio = Math.min(1, 4096 / bitmap.width, 4096 / bitmap.height)
      for (const scale of [1, 0.75, 0.5, 0.375, 0.25]) {
        assertActive(signal)
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio * scale))
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Could not prepare image in this browser")
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await encode(canvas)
        assertActive(signal)
        if (blob.size <= OUTPUT_LIMIT) return { file: new File([blob], "wallpaper.webp", { type: "image/webp" }), width: canvas.width, height: canvas.height }
      }
      throw new Error("Image could not be reduced below 10 MiB")
    } finally {
      bitmap?.close()
      canvas.width = 0
      canvas.height = 0
    }
  })
}
