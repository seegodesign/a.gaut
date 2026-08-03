const optimizableUploadPattern = /\.(?:avif|jpe?g|png|tiff?|webp)$/i

// CMS content keeps its original `/uploads/...` path. The gallery alone calls
// this helper to use the AVIF mirror generated before Astro starts building.
export function getOptimizedUploadPath(sourcePath) {
  if (
    typeof sourcePath !== 'string'
    || !sourcePath.startsWith('/uploads/')
    || !optimizableUploadPattern.test(sourcePath)
  ) {
    return sourcePath
  }

  return `/optimized${sourcePath}.avif`
}
