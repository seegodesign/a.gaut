import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Sveltia continues to read and write these original files. Optimized images
// are generated separately so the CMS never has to know about build output.
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const uploadsDirectory = path.join(projectRoot, 'public', 'uploads')
const outputDirectory = path.join(projectRoot, 'public', 'optimized', 'uploads')
const cacheFile = path.join(projectRoot, 'public', 'optimized', '.image-cache-version')
// Change this value whenever the encoder settings below change. That forces a
// one-time refresh instead of accidentally reusing files made with old rules.
const cacheVersion = 'avif-2400-q60-e4-444-v1'
const supportedExtensions = new Set([
  '.avif',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
])

// Include nested folders in case the CMS library is organized later.
async function findImages(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) return findImages(entryPath)
    if (!supportedExtensions.has(path.extname(entry.name).toLowerCase())) return []
    return [entryPath]
  }))

  return files.flat()
}

async function optimizeImage(inputPath) {
  const relativePath = path.relative(uploadsDirectory, inputPath)
  // Retaining the original extension before `.avif` prevents two source files
  // such as `photo.jpg` and `photo.png` from producing the same output name.
  const outputPath = path.join(outputDirectory, `${relativePath}.avif`)

  const inputStats = await stat(inputPath)
  try {
    const outputStats = await stat(outputPath)
    if (outputStats.mtimeMs >= inputStats.mtimeMs) {
      return {
        cached: true,
        inputBytes: inputStats.size,
        outputBytes: outputStats.size,
        outputPath,
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await sharp(inputPath)
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .avif({
      quality: 60,
      effort: 4,
      chromaSubsampling: '4:4:4',
    })
    .toFile(outputPath)

  const outputStats = await stat(outputPath)

  return {
    cached: false,
    inputBytes: inputStats.size,
    outputBytes: outputStats.size,
    outputPath,
  }
}

// Rebuild the cache if optimization settings change. A missing marker is safe:
// timestamps still prove whether an existing generated image is current.
try {
  const previousCacheVersion = await readFile(cacheFile, 'utf8')
  if (previousCacheVersion !== cacheVersion) {
    await rm(outputDirectory, { recursive: true, force: true })
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

await mkdir(outputDirectory, { recursive: true })
await writeFile(cacheFile, cacheVersion)
const images = await findImages(uploadsDirectory)

// Limit parallel encodes so builds remain dependable on small CI machines.
let nextImageIndex = 0
const results = []
const workerCount = Math.min(4, images.length)
const workers = Array.from({ length: workerCount }, async () => {
  while (nextImageIndex < images.length) {
    const imageIndex = nextImageIndex
    nextImageIndex += 1
    results[imageIndex] = await optimizeImage(images[imageIndex])
  }
})

await Promise.all(workers)

// Remove generated images whose CMS originals have since been deleted.
const expectedOutputs = new Set(results.map((result) => result.outputPath))
const existingOutputs = await findImages(outputDirectory)
await Promise.all(existingOutputs.map((outputPath) => (
  expectedOutputs.has(outputPath) ? undefined : rm(outputPath)
)))

const inputBytes = results.reduce((total, image) => total + image.inputBytes, 0)
const outputBytes = results.reduce((total, image) => total + image.outputBytes, 0)
const cachedImages = results.filter((image) => image.cached).length
const savedPercent = inputBytes > 0
  ? Math.round((1 - outputBytes / inputBytes) * 100)
  : 0

console.log(
  `Optimized ${images.length} CMS image${images.length === 1 ? '' : 's'} as AVIF `
  + `(${savedPercent}% smaller, ${cachedImages} unchanged).`,
)
