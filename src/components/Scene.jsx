import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { DepthOfField, EffectComposer } from '@react-three/postprocessing'
import Lenis from 'lenis'
import * as THREE from 'three'

// Three.js uses its own 3D coordinate system. The camera sits at z = 12 and
// looks toward the gallery. Each lane gives photos a height and 3D position.
const CAMERA_Z = 12
const LANE_STYLES = {
  1: { height: 3.05, y: 0.55, z: -3.1 },
  2: { height: 3.75, y: 0.05, z: -1.05 },
  3: { height: 6.55, y: -0.35, z: 1.1 },
}
// Shift the repeating strip left so its first foreground photo is already
// visible on the left side when the camera begins at x = 0.
const GALLERY_START_X = -5.75

// Wrap a number back into the range from 0 up to `cycle`.
// This is what lets the gallery repeat forever instead of reaching an end.
function loopOffset(value, cycle) {
  if (!cycle) return 0
  return ((value % cycle) + cycle) % cycle
}

// Return a repeatable "random-looking" number between 0 and 1.
// Using the image index means the layout stays the same after every refresh.
function seededUnit(index, salt) {
  const raw = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return raw - Math.floor(raw)
}

// Create a shuffled copy without changing the curated array saved by the CMS.
// This is the Fisher-Yates shuffle: each image swaps with a random earlier one.
function shuffleImages(images) {
  const shuffled = [...images]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
  }

  return shuffled
}

// Follow the visitor's operating-system accessibility preference and update
// immediately if they change it while the site is open.
function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ))

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = (event) => setReducedMotion(event.matches)

    mediaQuery.addEventListener('change', updatePreference)
    return () => mediaQuery.removeEventListener('change', updatePreference)
  }, [])

  return reducedMotion
}

// Calculate the lane, size, and 3D position of every gallery image.
function createGalleryLayout(images) {
  const lanes = []

  // Avoid putting two neighboring images in the same depth lane.
  images.forEach((_, index) => {
    // Always begin with a large foreground image on the left edge.
    if (index === 0) {
      lanes.push(3)
      return
    }

    const seededLane = Math.floor(seededUnit(index, 4.1) * 3) + 1
    const previousLane = lanes[index - 1] ?? 0
    const options = [1, 2, 3].filter((lane) => lane !== previousLane)
    lanes.push(seededLane === previousLane ? options[Math.floor(seededUnit(index, 5.6) * options.length)] : seededLane)
  })

  if (lanes.length > 1 && lanes[0] === lanes[lanes.length - 1]) {
    const previousLane = lanes[lanes.length - 2]
    lanes[lanes.length - 1] = [1, 2, 3].find((lane) => lane !== lanes[0] && lane !== previousLane)
  }

  let cursor = 0
  const items = images.map((entry, index) => {
    const lane = lanes[index]
    const laneStyle = LANE_STYLES[lane]
    const width = laneStyle.height * 0.8
    const gap = 0.42 + seededUnit(index, 9.4) * 0.65
    const overlap = 0.08 + seededUnit(index, 7.7) * 0.16
    const item = {
      src: entry.image,
      textureIndex: index,
      lane,
      width,
      height: laneStyle.height,
      x: GALLERY_START_X + cursor + width / 2,
      y: laneStyle.y + (seededUnit(index, 11.2) - 0.5) * 0.18,
      z: laneStyle.z,
    }

    cursor += width + gap - overlap
    return item
  })

  return { items, cycleWidth: cursor }
}

// Render the photographs as flat Three.js meshes (3D rectangles).
// This component also handles hover movement, selection, and focus animation.
function GalleryPlanes({
  images,
  layout,
  selectedKey,
  setSelectedKey,
  onFocusPlane,
  focusPointRef,
  reducedMotion,
}) {
  const gl = useThree((state) => state.gl)
  // Astro reads this list from the CMS-managed gallery.json file.
  const textureUrls = useMemo(
    () => images.map((entry) => encodeURI(entry.image)),
    [images],
  )
  const textures = useLoader(THREE.TextureLoader, textureUrls)
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const meshRefs = useRef(new Map())
  const hoveredKeyRef = useRef(null)
  const focusAnimationActiveRef = useRef(false)
  // Make three copies of the gallery: one before, one at, and one after the
  // original. Together with infinite scrolling, this hides the loop seam.
  const instances = useMemo(
    () => [-1, 0, 1].flatMap((copy) => layout.items.map((item) => ({
      ...item,
      key: `${copy}-${item.textureIndex}`,
      baseX: item.x + copy * layout.cycleWidth,
    }))),
    [layout],
  )
  // Each image texture gets its own simple, unlit material. An unlit material
  // displays the photograph's original colors without requiring scene lights.
  const materials = useMemo(
    () => textures.map((texture) => new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
      toneMapped: false,
    })),
    [textures],
  )

  useEffect(() => {
    // Improve texture sharpness when a photo is viewed at an angle.
    const anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), 4)
    textures.forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = anisotropy
      texture.needsUpdate = true
    })

    // React runs this cleanup when the gallery is removed. Disposing GPU
    // resources prevents memory leaks during development and navigation.
    return () => {
      geometry.dispose()
      materials.forEach((material) => material.dispose())
    }
  }, [geometry, gl, materials, textures])

  useEffect(() => () => {
    document.body.style.cursor = ''
  }, [])

  useEffect(() => {
    focusAnimationActiveRef.current = true
  }, [selectedKey])

  // useFrame runs once for every rendered animation frame.
  useFrame(({ camera }, delta) => {
    if (selectedKey === null && !focusAnimationActiveRef.current) return

    const selected = selectedKey !== null ? layout.items[selectedKey] : null
    const pushRadius = 10
    const pushDistance = 4.25
    let largestError = 0
    let closestFocusedMesh = null
    let closestFocusedDistance = Infinity

    instances.forEach((instance) => {
      const mesh = meshRefs.current.get(instance.key)
      if (!mesh) return

      let targetX = instance.baseX
      let targetY = instance.y
      let targetZ = instance.z

      if (selected && instance.textureIndex === selectedKey) {
        // Bring every copy of the chosen photograph toward the camera.
        const cameraFov = THREE.MathUtils.degToRad(camera.fov)
        const focusDistance = instance.height / (2 * Math.tan(cameraFov / 2) * 0.88)
        targetY = 0
        targetZ = camera.position.z - focusDistance
      } else if (!reducedMotion && !selected && instance.key === hoveredKeyRef.current) {
        // Nudge a hovered photo forward so it feels interactive.
        targetZ += 0.45
      } else if (selected) {
        // Push nearby photographs aside to create space around the selection.
        const distance = loopOffset(instance.x - selected.x + layout.cycleWidth / 2, layout.cycleWidth)
          - layout.cycleWidth / 2
        const absoluteDistance = Math.abs(distance)

        if (absoluteDistance < pushRadius) {
          const direction = distance < 0 ? -1 : 1
          const falloff = 1 - absoluteDistance / pushRadius
          targetX += direction * falloff * falloff * pushDistance
        }
      }

      largestError = Math.max(
        largestError,
        Math.abs(mesh.position.x - targetX),
        Math.abs(mesh.position.y - targetY),
        Math.abs(mesh.position.z - targetZ),
      )

      if (reducedMotion) {
        // Accessibility mode moves directly to the destination without tweening.
        mesh.position.set(targetX, targetY, targetZ)
      } else {
        // `damp` moves toward the target gradually, producing a smooth animation.
        mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 7, delta)
        mesh.position.y = THREE.MathUtils.damp(mesh.position.y, targetY, 7, delta)
        mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 7, delta)
      }

      if (selected && instance.textureIndex === selectedKey) {
        const cameraDistance = Math.abs(mesh.position.x - camera.position.x)
        if (cameraDistance < closestFocusedDistance) {
          closestFocusedDistance = cameraDistance
          closestFocusedMesh = mesh
        }
      }
    })

    if (closestFocusedMesh) {
      focusPointRef.current.copy(closestFocusedMesh.position)
    }

    if (!selected && largestError < 0.001) {
      focusAnimationActiveRef.current = false
    }
  })

  return (
    <group dispose={null}>
      {/* Turn each calculated gallery item into a clickable 3D mesh. */}
      {instances.map((item) => (
        <mesh
          key={item.key}
          ref={(mesh) => {
            if (mesh) meshRefs.current.set(item.key, mesh)
            else meshRefs.current.delete(item.key)
          }}
          geometry={geometry}
          material={materials[item.textureIndex]}
          position={[item.baseX, item.y, item.z]}
          scale={[item.width, item.height, 1]}
          onClick={(event) => {
            event.stopPropagation()
            // Clicking the selected image again closes it.
            if (selectedKey === item.textureIndex) {
              setSelectedKey(null)
              return
            }

            setSelectedKey(item.textureIndex)
            onFocusPlane(item.baseX, layout.cycleWidth)
          }}
          onPointerEnter={(event) => {
            event.stopPropagation()
            hoveredKeyRef.current = item.key
            focusAnimationActiveRef.current = true
            document.body.style.cursor = 'pointer'
          }}
          onPointerLeave={() => {
            if (hoveredKeyRef.current === item.key) {
              hoveredKeyRef.current = null
              focusAnimationActiveRef.current = true
            }
            document.body.style.cursor = ''
          }}
        />
      ))}
    </group>
  )
}

// Keep the Three.js camera synchronized with the horizontal page scroll.
function CameraRig({ layout, motionRef, reducedMotion }) {
  const dollyRef = useRef(0)

  useFrame(({ camera }, delta) => {
    const { scroll, limit, velocity } = motionRef.current
    const progress = limit > 0 ? loopOffset(scroll, limit) / limit : 0

    if (reducedMotion) {
      camera.position.x = progress * layout.cycleWidth
      camera.position.z = CAMERA_Z
      return
    }

    const targetDolly = Math.min(Math.abs(velocity) * 0.55, 1)
    const damping = targetDolly > dollyRef.current ? 9 : 3.25

    dollyRef.current = THREE.MathUtils.damp(dollyRef.current, targetDolly, damping, delta)
    // Move sideways through the gallery and slightly backward during fast scrolls.
    camera.position.x = progress * layout.cycleWidth
    camera.position.z = CAMERA_Z - dollyRef.current * 0.2
  })

  return null
}

// Blur photographs that are outside the current focus distance.
function GalleryDepthOfField({ selectedKey, focusPointRef, reducedMotion }) {
  const effectRef = useRef(null)
  const focusDistanceRef = useRef(CAMERA_Z - LANE_STYLES[3].z)
  const nearBlurConfiguredRef = useRef(false)

  useFrame(({ camera }, delta) => {
    const effect = effectRef.current
    if (!effect) return

    if (!nearBlurConfiguredRef.current) {
      // Keep close images crisp; only the deeper background should blur.
      effect.bokehNearBasePass.fullscreenMaterial.scale = 0
      effect.bokehNearFillPass.fullscreenMaterial.scale = 0
      nearBlurConfiguredRef.current = true
    }

    if (selectedKey !== null) {
      // When an image is open, tell the effect to focus on that exact position.
      effect.target = focusPointRef.current
      focusDistanceRef.current = camera.position.distanceTo(focusPointRef.current)
      return
    }

    effect.target = null
    const targetDistance = camera.position.z - LANE_STYLES[3].z
    focusDistanceRef.current = reducedMotion
      ? targetDistance
      : THREE.MathUtils.damp(focusDistanceRef.current, targetDistance, 6, delta)

    effect.cocMaterial.focusDistance = focusDistanceRef.current
  })

  return (
    <EffectComposer multisampling={0}>
      <DepthOfField
        ref={effectRef}
        focusDistance={focusDistanceRef.current}
        focusRange={8}
        bokehScale={2.2}
        resolutionScale={0.5}
      />
    </EffectComposer>
  )
}

// Set up the React Three Fiber canvas and connect all 3D gallery pieces.
function WebGLGallery({
  images,
  randomizePhotoOrder,
  motionRef,
  onCaptionChange,
  reducedMotion,
}) {
  // Shuffle once when the gallery loads. Turning the CMS setting off uses the
  // exact order stored in gallery.json again.
  const displayImages = useMemo(
    () => (randomizePhotoOrder ? shuffleImages(images) : images),
    [images, randomizePhotoOrder],
  )
  const layout = useMemo(() => createGalleryLayout(displayImages), [displayImages])
  const [selectedKey, setSelectedKey] = useState(null)
  const focusPointRef = useRef(new THREE.Vector3(0, 0, LANE_STYLES[3].z))

  useEffect(() => {
    // Give the surrounding HTML scroll area a way to close the selected mesh.
    motionRef.current.clearSelection = () => setSelectedKey(null)

    return () => {
      motionRef.current.clearSelection = null
    }
  }, [motionRef])

  useEffect(() => {
    const caption = selectedKey === null
      ? ''
      : displayImages[selectedKey]?.caption?.trim() ?? ''

    onCaptionChange(caption)
  }, [displayImages, onCaptionChange, selectedKey])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (selectedKey !== null) {
          event.preventDefault()
          setSelectedKey(null)
        }
        return
      }

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (displayImages.length === 0) return

      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      const startingIndex = selectedKey ?? (direction > 0 ? -1 : 0)
      const nextIndex = (
        startingIndex + direction + displayImages.length
      ) % displayImages.length

      setSelectedKey(nextIndex)
      const nextItem = layout.items[nextIndex]
      motionRef.current.focusPlane?.(nextItem.x, layout.cycleWidth)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [displayImages.length, layout, motionRef, selectedKey])

  return (
    <Canvas
      className="gallery-canvas"
      camera={{ fov: 42, near: 0.1, far: 100, position: [0, 0, CAMERA_Z] }}
      dpr={[1, 1.25]}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      // Clicking empty space closes the currently selected photograph.
      onPointerMissed={() => setSelectedKey(null)}
    >
      <CameraRig layout={layout} motionRef={motionRef} reducedMotion={reducedMotion} />
      <Suspense fallback={null}>
        <GalleryPlanes
          images={displayImages}
          layout={layout}
          selectedKey={selectedKey}
          setSelectedKey={setSelectedKey}
          onFocusPlane={(worldX, cycleWidth) => motionRef.current.focusPlane?.(worldX, cycleWidth)}
          focusPointRef={focusPointRef}
          reducedMotion={reducedMotion}
        />
      </Suspense>
      <GalleryDepthOfField
        selectedKey={selectedKey}
        focusPointRef={focusPointRef}
        reducedMotion={reducedMotion}
      />
    </Canvas>
  )
}

// This is the main page component. It combines the regular HTML header and
// text with the WebGL gallery, then connects scrolling to the 3D camera.
export default function Scene({ images, randomizePhotoOrder }) {
  // Refs keep mutable values between renders without causing another render.
  const wrapperRef = useRef(null)
  const contentRef = useRef(null)
  const motionRef = useRef({
    scroll: 0,
    limit: 1,
    velocity: 0,
    focusPlane: null,
    clearSelection: null,
  })
  const [activeCaption, setActiveCaption] = useState('')
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const wrapper = wrapperRef.current
    const content = contentRef.current
    if (!wrapper || !content) return undefined

    // Lenis turns wheel and touch input into smooth, horizontal, infinite scroll.
    const lenis = new Lenis({
      wrapper,
      content,
      orientation: 'horizontal',
      gestureOrientation: 'both',
      smoothWheel: !reducedMotion,
      syncTouch: !reducedMotion,
      infinite: true,
      lerp: reducedMotion ? 1 : 0.045,
      wheelMultiplier: 0.25,
    })

    // Close an open photograph as soon as the visitor starts scrolling. These
    // input events do not run for the automatic scroll used to center a photo.
    const clearSelection = () => motionRef.current.clearSelection?.()
    wrapper.addEventListener('wheel', clearSelection, { passive: true })
    wrapper.addEventListener('touchmove', clearSelection, { passive: true })

    const updateMotion = () => {
      // Share Lenis values with the 3D animation loop through `motionRef`.
      motionRef.current.scroll = typeof lenis.scroll === 'number' ? lenis.scroll : 0
      motionRef.current.limit = typeof lenis.limit === 'number' ? lenis.limit : 1
      motionRef.current.velocity = Number.isFinite(lenis.velocity) ? lenis.velocity : 0
    }

    motionRef.current.focusPlane = (worldX, cycleWidth) => {
      // Convert a photograph's 3D x position into the matching scroll position.
      const targetProgress = loopOffset(worldX, cycleWidth) / cycleWidth
      lenis.scrollTo(targetProgress * lenis.limit, {
        duration: reducedMotion ? 0 : 1.1,
        immediate: reducedMotion,
        easing: (progress) => 1 - Math.pow(1 - progress, 4),
      })
    }

    lenis.on('scroll', updateMotion)

    // requestAnimationFrame asks the browser to update just before each repaint.
    let rafId = 0
    const raf = (time) => {
      lenis.raf(time)
      updateMotion()
      rafId = requestAnimationFrame(raf)
    }

    rafId = requestAnimationFrame(raf)

    // Stop animation work if this page is ever removed from the screen.
    return () => {
      cancelAnimationFrame(rafId)
      wrapper.removeEventListener('wheel', clearSelection)
      wrapper.removeEventListener('touchmove', clearSelection)
      motionRef.current.focusPlane = null
      lenis.destroy()
    }
  }, [reducedMotion])

  return (
    <main className="studio-shell">
      {/* Decorative texture; aria-hidden keeps it out of screen readers. */}
      <div className="studio-noise" aria-hidden="true" />
      <h1 className="brand-signature">ADRIAN GAUT</h1>
      {/* Standard HTML links sit above the 3D canvas and remain easy to use. */}
      <nav className="header-links" aria-label="Contact and social links">
        <a className="contact-link" href="/contact">
          Contact
        </a>
        <a
          className="instagram-link"
          href="https://www.instagram.com/a_gaut"
          target="_blank"
          rel="noreferrer"
          aria-label="Visit a. gaut on Instagram"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4.25" />
            <circle className="instagram-dot" cx="17.4" cy="6.7" r="1" />
          </svg>
        </a>
      </nav>
      {/* Captions only become visible while a captioned photograph is open. */}
      <p
        className={`project-caption${activeCaption ? ' is-visible' : ''}`}
        aria-live="polite"
      >
        {activeCaption}
      </p>
      {/* Lenis watches this wrapper and moves through the extra-wide content. */}
      <div className="scroll-wrapper" ref={wrapperRef}>
        <section className="scroll-content" ref={contentRef}>
          <div className="depth-stage">
            <div className="name-wrap">
              <p className="kicker">places spaces &amp; things</p>
            </div>

            <WebGLGallery
              images={images}
              randomizePhotoOrder={randomizePhotoOrder}
              motionRef={motionRef}
              onCaptionChange={setActiveCaption}
              reducedMotion={reducedMotion}
            />
          </div>
        </section>
      </div>
    </main>
  )
}
