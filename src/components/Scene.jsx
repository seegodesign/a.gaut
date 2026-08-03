import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { DepthOfField, EffectComposer } from '@react-three/postprocessing'
import Lenis from 'lenis'
import * as THREE from 'three'

// Three.js uses its own 3D coordinate system. The camera sits at z = 12 and
// looks toward the gallery. Each lane gives photos a height and 3D position.
const CAMERA_Z = 12
const LANE_STYLES = {
  1: { height: 3.05, y: 0.55, z: -3.1 },
  2: { height: 3.75, y: 0.05, z: -0.5 },
  3: { height: 6.55, y: -0.35, z: 0.75 },
}
const DEEPEST_LANE_Z = Math.min(...Object.values(LANE_STYLES).map(({ z }) => z))
// Shift the repeating strip left so its first foreground photo is already
// visible on the left side when the camera begins at x = 0.
const GALLERY_START_X = -5.75
const INACTIVE_DEPTH_OFFSET = 1
const INACTIVE_SCALE = 1
const DEFAULT_FOCUS_RANGE = 8
const SELECTED_FOCUS_RANGE = 1.35
const BACKDROP_OPACITY = 0.9
const BACKDROP_GAP = 0.08
const DEFAULT_AUTO_SCROLL_SPEED = 48
const MIN_AUTO_SCROLL_SPEED = 5
const MAX_AUTO_SCROLL_SPEED = 200
const AUTO_SCROLL_MANUAL_PAUSE_MS = 1200
const PRELOAD_INDICATOR_FAILSAFE_MS = 2500
const SMOOTH_SCROLL_LERP = 0.045
const AUTO_SCROLL_POINTER_DEAD_ZONE = 0.08
// Begin downloading photographs just outside the camera view. This gives the
// browser time to decode the next few images without requesting the whole CMS
// library when the page first opens.
const TEXTURE_PRELOAD_MARGIN = 7

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

// Use the same breakpoint as the CSS mobile layout. Besides positioning text,
// this lets the WebGL scene avoid desktop-only rendering costs on small screens.
function useCompactViewport() {
  const [compactViewport, setCompactViewport] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 900px)').matches
      : false
  ))

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 900px)')
    const updateViewport = (event) => setCompactViewport(event.matches)

    mediaQuery.addEventListener('change', updateViewport)
    return () => mediaQuery.removeEventListener('change', updateViewport)
  }, [])

  return compactViewport
}

// React Three Fiber normally observes its container, but client-only hydration
// can initially report a zero-size canvas before Astro's layout has settled.
// Synchronize once immediately and once on the next frame so texture visibility
// calculations receive the same valid viewport that a browser resize provides.
function CanvasSizeSync() {
  const gl = useThree((state) => state.gl)
  const setSize = useThree((state) => state.setSize)

  useLayoutEffect(() => {
    const container = gl.domElement.parentElement
    if (!container) return undefined

    const syncSize = () => {
      const bounds = container.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return

      setSize(bounds.width, bounds.height, bounds.top, bounds.left)
    }

    syncSize()
    const frameId = window.requestAnimationFrame(syncSize)
    const resizeObserver = new ResizeObserver(syncSize)
    resizeObserver.observe(container)

    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [gl, setSize])

  return null
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
  enablePhotoFloating,
  enableScrollMotionBlur,
  photosCanReveal,
  motionRef,
  onPreloadProgress,
}) {
  const gl = useThree((state) => state.gl)
  // Astro reads this list from the CMS-managed gallery.json file.
  const textureUrls = useMemo(
    () => images.map((entry) => encodeURI(entry.image)),
    [images],
  )
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const backdropRef = useRef(null)
  const meshRefs = useRef(new Map())
  const hoveredKeyRef = useRef(null)
  const focusAnimationActiveRef = useRef(false)
  const initialPreloadRef = useRef(null)
  const textureLoader = useMemo(() => new THREE.TextureLoader(), [])
  const scrollBlurUniform = useMemo(() => new THREE.Uniform(0), [])
  // These mutable collections track network requests without re-rendering the
  // full gallery whenever an individual photograph finishes loading.
  const textureState = useMemo(() => ({
    disposed: false,
    failed: new Set(),
    loaded: new Set(),
    loading: new Set(),
    textures: new Map(),
  }), [textureUrls])
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
  // Start loaded photographs transparent, but keep depth writing enabled so
  // overlapping 3D planes do not blend through one another like glass.
  const materials = useMemo(
    () => images.map(() => {
      const material = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        depthWrite: true,
        opacity: 0,
        side: THREE.FrontSide,
        toneMapped: false,
        transparent: true,
        visible: false,
      })

      if (enableScrollMotionBlur) {
        // Blur samples remain inside this photo's texture. Clamping the UVs keeps
        // photo edges solid and prevents the white page from entering the blur.
        material.onBeforeCompile = (shader) => {
          shader.uniforms.scrollImageBlur = scrollBlurUniform
          shader.fragmentShader = `uniform float scrollImageBlur;\n${shader.fragmentShader}`.replace(
            '#include <map_fragment>',
            `#ifdef USE_MAP
              vec2 imageBlurStep = vec2(scrollImageBlur, 0.0);
              vec4 sampledDiffuseColor = texture2D(map, vMapUv) * 0.40;
              sampledDiffuseColor += texture2D(map, clamp(vMapUv - imageBlurStep, vec2(0.001), vec2(0.999))) * 0.22;
              sampledDiffuseColor += texture2D(map, clamp(vMapUv + imageBlurStep, vec2(0.001), vec2(0.999))) * 0.22;
              sampledDiffuseColor += texture2D(map, clamp(vMapUv - imageBlurStep * 2.0, vec2(0.001), vec2(0.999))) * 0.08;
              sampledDiffuseColor += texture2D(map, clamp(vMapUv + imageBlurStep * 2.0, vec2(0.001), vec2(0.999))) * 0.08;
              #ifdef DECODE_VIDEO_TEXTURE
                sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
              #endif
              diffuseColor *= sampledDiffuseColor;
            #endif`,
          )
        }
        material.customProgramCacheKey = () => 'gallery-texture-motion-blur-v1'
      }

      return material
    }),
    [enableScrollMotionBlur, images, scrollBlurUniform],
  )
  const backdropMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  }), [])

  const reportPreloadProgress = useCallback(() => {
    const plannedTextures = initialPreloadRef.current
    if (!plannedTextures) return

    const finishedTextures = [...plannedTextures].filter((textureIndex) => (
      textureState.loaded.has(textureIndex) || textureState.failed.has(textureIndex)
    )).length
    const progress = plannedTextures.size > 0
      ? finishedTextures / plannedTextures.size
      : 1

    onPreloadProgress(progress)
  }, [onPreloadProgress, textureState])

  useEffect(() => {
    // React may replay effects during development; mark this resource group as
    // active each time the setup runs so lazy requests continue after replay.
    textureState.disposed = false
    initialPreloadRef.current = null
    onPreloadProgress(0)

    // React runs this cleanup when the gallery is removed. Disposing GPU
    // resources prevents memory leaks during development and navigation.
    return () => {
      textureState.disposed = true
      textureState.textures.forEach((texture) => texture.dispose())
      geometry.dispose()
      materials.forEach((material) => material.dispose())
      backdropMaterial.dispose()
    }
  }, [backdropMaterial, geometry, materials, onPreloadProgress, textureState])

  const requestTexture = useCallback((textureIndex) => {
    if (
      textureState.disposed
      || textureState.loaded.has(textureIndex)
      || textureState.loading.has(textureIndex)
      || textureState.failed.has(textureIndex)
    ) return

    textureState.loading.add(textureIndex)
    textureLoader.load(
      textureUrls[textureIndex],
      (texture) => {
        // A request can finish after a page transition. Dispose it instead of
        // attaching it to materials that React has already removed.
        if (textureState.disposed) {
          texture.dispose()
          return
        }

        // Improve texture sharpness when a photo is viewed at an angle.
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), 4)
        texture.needsUpdate = true
        textureState.loading.delete(textureIndex)
        textureState.loaded.add(textureIndex)
        textureState.textures.set(textureIndex, texture)

        const material = materials[textureIndex]
        material.map = texture
        material.visible = true
        material.needsUpdate = true
        reportPreloadProgress()
      },
      undefined,
      () => {
        // Do not retry a missing or invalid CMS image on every animation frame.
        textureState.loading.delete(textureIndex)
        textureState.failed.add(textureIndex)
        reportPreloadProgress()
      },
    )
  }, [gl, materials, reportPreloadProgress, textureLoader, textureState, textureUrls])

  useEffect(() => () => {
    document.body.style.cursor = ''
  }, [])

  useEffect(() => {
    focusAnimationActiveRef.current = true
    if (selectedKey !== null) requestTexture(selectedKey)
  }, [requestTexture, selectedKey])

  // useFrame runs once for every rendered animation frame.
  useFrame(({ camera, clock }, delta) => {
    // A symmetric horizontal lens blur feels softer than a trailing echo. It is
    // applied inside each photo, so HTML text and transparent canvas edges stay crisp.
    const blurTarget = !enableScrollMotionBlur
      || reducedMotion
      || Math.abs(motionRef.current.velocity) < 0.08
      ? 0
      : THREE.MathUtils.clamp(Math.abs(motionRef.current.velocity) * 0.004, 0, 0.015)
    const blurDamping = blurTarget > scrollBlurUniform.value ? 12 : 6
    scrollBlurUniform.value = THREE.MathUtils.damp(
      scrollBlurUniform.value,
      blurTarget,
      blurDamping,
      delta,
    )

    // Wait for CanvasSizeSync to establish a usable projection. Otherwise an
    // invalid aspect ratio can create an empty preload range that only a later
    // browser resize repairs.
    if (!Number.isFinite(camera.aspect) || camera.aspect <= 0) return

    // Work out how wide the view is at the deepest lane, then preload a small
    // strip on either side. All three loop copies share the same texture.
    const halfViewportWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      * (camera.position.z - DEEPEST_LANE_Z)
      * camera.aspect
    const loadDistance = halfViewportWidth + TEXTURE_PRELOAD_MARGIN

    if (initialPreloadRef.current === null) {
      initialPreloadRef.current = new Set(
        instances
          .filter((instance) => Math.abs(instance.baseX - camera.position.x) <= loadDistance)
          .map((instance) => instance.textureIndex),
      )
      reportPreloadProgress()
    }

    instances.forEach((instance) => {
      if (Math.abs(instance.baseX - camera.position.x) <= loadDistance) {
        requestTexture(instance.textureIndex)
      }
    })

    // Fade decoded photographs in smoothly without causing a React render.
    materials.forEach((material, textureIndex) => {
      if (!textureState.loaded.has(textureIndex) || !photosCanReveal) return

      material.opacity = reducedMotion
        ? 1
        : THREE.MathUtils.damp(material.opacity, 1, 7, delta)

      // Return to the simplest solid material after the short fade finishes.
      if (material.opacity > 0.995 && material.transparent) {
        material.opacity = 1
        material.transparent = false
        material.needsUpdate = true
      }
    })

    // Ambient floating needs continuous frames. When it is disabled, the
    // gallery can stop updating meshes after they return to their resting positions.
    if ((reducedMotion || !enablePhotoFloating)
      && selectedKey === null
      && !focusAnimationActiveRef.current) return

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
      let targetScale = 1
      let targetRotationY = 0
      let targetRotationZ = 0

      if (selected && instance.textureIndex === selectedKey) {
        // Bring every copy of the chosen photograph toward the camera.
        const cameraFov = THREE.MathUtils.degToRad(camera.fov)
        const focusDistance = instance.height / (2 * Math.tan(cameraFov / 2) * 0.88)
        targetY = 0
        targetZ = camera.position.z - focusDistance
      } else if (!reducedMotion && enablePhotoFloating && !selected) {
        // Every photograph drifts gently in place. Hovering adds a little more
        // lift without changing the shared anti-gravity character.
        const floatTime = clock.elapsedTime + instance.textureIndex * 0.37
        const isHovered = instance.key === hoveredKeyRef.current
        const hoverBoost = isHovered ? 1 : 0

        targetY += Math.sin(floatTime * 0.72) * (0.045 + hoverBoost * 0.1)
        targetZ += Math.cos(floatTime * 0.61) * (0.025 + hoverBoost * 0.025) + hoverBoost * 0.34
      } else if (selected) {
        // Recede and shrink every non-selected photograph so the active image
        // reads as the clear foreground subject.
        targetZ -= INACTIVE_DEPTH_OFFSET
        targetScale = INACTIVE_SCALE

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
        Math.abs(mesh.scale.x - instance.width * targetScale),
        Math.abs(mesh.scale.y - instance.height * targetScale),
        Math.abs(mesh.rotation.y - targetRotationY),
        Math.abs(mesh.rotation.z - targetRotationZ),
      )

      if (reducedMotion) {
        // Accessibility mode moves directly to the destination without tweening.
        mesh.position.set(targetX, targetY, targetZ)
        mesh.scale.set(instance.width * targetScale, instance.height * targetScale, 1)
        mesh.rotation.set(0, targetRotationY, targetRotationZ)
      } else {
        // `damp` moves toward the target gradually, producing a smooth animation.
        mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 7, delta)
        mesh.position.y = THREE.MathUtils.damp(mesh.position.y, targetY, 7, delta)
        mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 7, delta)
        mesh.scale.x = THREE.MathUtils.damp(mesh.scale.x, instance.width * targetScale, 7, delta)
        mesh.scale.y = THREE.MathUtils.damp(mesh.scale.y, instance.height * targetScale, 7, delta)
        mesh.rotation.y = THREE.MathUtils.damp(mesh.rotation.y, targetRotationY, 5, delta)
        mesh.rotation.z = THREE.MathUtils.damp(mesh.rotation.z, targetRotationZ, 5, delta)
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

    const backdrop = backdropRef.current
    if (backdrop) {
      const targetOpacity = selected && closestFocusedMesh ? BACKDROP_OPACITY : 0

      if (selected && closestFocusedMesh) {
        const backdropZ = closestFocusedMesh.position.z - BACKDROP_GAP
        const cameraDistance = camera.position.z - backdropZ
        const viewportHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
          * cameraDistance
        const viewportWidth = viewportHeight * camera.aspect

        // Follow the camera and slightly overscan so the plane always fills
        // the full screen, even while the image is moving into position.
        backdrop.position.set(camera.position.x, camera.position.y, backdropZ)
        backdrop.scale.set(viewportWidth * 1.04, viewportHeight * 1.04, 1)
      }

      largestError = Math.max(
        largestError,
        Math.abs(backdropMaterial.opacity - targetOpacity),
      )
      backdropMaterial.opacity = reducedMotion
        ? targetOpacity
        : THREE.MathUtils.damp(backdropMaterial.opacity, targetOpacity, 7, delta)
    }

    if (!selected && largestError < 0.001) {
      focusAnimationActiveRef.current = false
    }
  })

  return (
    <group dispose={null}>
      {/* This screen-sized scrim sits behind the active photo but in front of
          every receded photo, so depth testing leaves only the active one bright. */}
      <mesh
        ref={backdropRef}
        geometry={geometry}
        material={backdropMaterial}
        position={[0, 0, -20]}
        raycast={() => null}
        renderOrder={1}
      />
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

  useFrame(({ camera }, delta) => {
    const effect = effectRef.current
    if (!effect) return

    // A tighter range makes the background, which also moves farther away,
    // noticeably blurrier while a photograph is selected.
    const targetFocusRange = selectedKey !== null
      ? SELECTED_FOCUS_RANGE
      : DEFAULT_FOCUS_RANGE
    effect.cocMaterial.focusRange = reducedMotion
      ? targetFocusRange
      : THREE.MathUtils.damp(effect.cocMaterial.focusRange, targetFocusRange, 7, delta)

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
    <DepthOfField
      ref={effectRef}
      focusDistance={focusDistanceRef.current}
      focusRange={DEFAULT_FOCUS_RANGE}
      bokehScale={2.2}
      resolutionScale={0.5}
    />
  )
}

// Set up the React Three Fiber canvas and connect all 3D gallery pieces.
function WebGLGallery({
  images,
  randomizePhotoOrder,
  motionRef,
  onCaptionChange,
  reducedMotion,
  enablePhotoFloating,
  enableDepthOfField,
  enableScrollMotionBlur,
  compactViewport,
  photosCanReveal,
  onPreloadProgress,
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
    // Keep an opened photograph centered instead of moving it automatically.
    motionRef.current.autoScrollPaused = selectedKey !== null

    return () => {
      motionRef.current.autoScrollPaused = false
    }
  }, [motionRef, selectedKey])

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
      // A 1× mobile canvas is considerably lighter on high-density phones.
      dpr={compactViewport ? 1 : [1, 1.25]}
      gl={{
        alpha: true,
        antialias: !compactViewport,
        powerPreference: 'high-performance',
      }}
      // Clicking empty space closes the currently selected photograph.
      onPointerMissed={() => setSelectedKey(null)}
    >
      <CanvasSizeSync />
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
          enablePhotoFloating={enablePhotoFloating}
          enableScrollMotionBlur={enableScrollMotionBlur}
          photosCanReveal={photosCanReveal}
          motionRef={motionRef}
          onPreloadProgress={onPreloadProgress}
        />
      </Suspense>
      {/* Mobile skips the expensive depth-of-field pass. Scroll motion blur is
          controlled separately and runs inside each photograph's material. */}
      {enableDepthOfField && !compactViewport && (
        <EffectComposer multisampling={0}>
          <GalleryDepthOfField
            selectedKey={selectedKey}
            focusPointRef={focusPointRef}
            reducedMotion={reducedMotion}
          />
        </EffectComposer>
      )}
    </Canvas>
  )
}

// This is the main page component. It combines the regular HTML header and
// text with the WebGL gallery, then connects scrolling to the 3D camera.
export default function Scene({
  images,
  introDuration,
  randomizePhotoOrder,
  enableAutoScroll = false,
  autoScrollSpeed = DEFAULT_AUTO_SCROLL_SPEED,
  enablePhotoFloating = true,
  enableDepthOfField = true,
  enableScrollMotionBlur = true,
}) {
  // Refs keep mutable values between renders without causing another render.
  const wrapperRef = useRef(null)
  const contentRef = useRef(null)
  const motionRef = useRef({
    scroll: 0,
    limit: 1,
    velocity: 0,
    focusPlane: null,
    clearSelection: null,
    autoScrollPaused: false,
  })
  const [activeCaption, setActiveCaption] = useState('')
  const reducedMotion = usePrefersReducedMotion()
  const compactViewport = useCompactViewport()
  const parsedAutoScrollSpeed = Number(autoScrollSpeed)
  const resolvedAutoScrollSpeed = Number.isFinite(parsedAutoScrollSpeed)
    ? THREE.MathUtils.clamp(
      parsedAutoScrollSpeed,
      MIN_AUTO_SCROLL_SPEED,
      MAX_AUTO_SCROLL_SPEED,
    )
    : DEFAULT_AUTO_SCROLL_SPEED
  const [introTextComplete, setIntroTextComplete] = useState(reducedMotion)
  const [preloadProgress, setPreloadProgress] = useState(0)
  const [preloadFailsafeReached, setPreloadFailsafeReached] = useState(reducedMotion)
  // Reveal each decoded photograph after the intro instead of allowing one
  // stalled request in the initial batch to keep every material transparent.
  const photosCanReveal = reducedMotion || introTextComplete
  const visiblePreloadProgress = reducedMotion || preloadFailsafeReached
    ? 1
    : THREE.MathUtils.clamp(preloadProgress, 0, 1)

  useEffect(() => {
    if (reducedMotion) {
      setIntroTextComplete(true)
      return undefined
    }

    // Preload nearby textures during the text animation, then release their
    // opacity fades only after the final character has settled.
    setIntroTextComplete(false)
    const revealTimer = window.setTimeout(
      () => setIntroTextComplete(true),
      introDuration,
    )

    return () => window.clearTimeout(revealTimer)
  }, [introDuration, reducedMotion])

  useEffect(() => {
    if (reducedMotion) {
      setPreloadFailsafeReached(true)
      return undefined
    }

    setPreloadFailsafeReached(false)
    const failsafeTimer = window.setTimeout(
      () => setPreloadFailsafeReached(true),
      introDuration + PRELOAD_INDICATOR_FAILSAFE_MS,
    )

    return () => window.clearTimeout(failsafeTimer)
  }, [introDuration, reducedMotion])

  useEffect(() => {
    // Astro owns the semantic H1. React only updates its black preload mask.
    document.querySelector('.brand-signature[data-title]')?.style.setProperty(
      '--preload-remainder',
      `${(1 - visiblePreloadProgress) * 100}%`,
    )
  }, [visiblePreloadProgress])

  useEffect(() => () => {
    document.querySelector('.brand-signature[data-title]')
      ?.style.removeProperty('--preload-remainder')
  }, [])

  useEffect(() => {
    // The client-only Astro island can hydrate before its fixed-position layers
    // have final bounds. A one-time resize after two paints makes R3F and Lenis
    // read those bounds immediately instead of waiting for a real window resize.
    let measurementRafId = 0
    const layoutRafId = window.requestAnimationFrame(() => {
      measurementRafId = window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
      })
    })

    return () => {
      window.cancelAnimationFrame(layoutRafId)
      window.cancelAnimationFrame(measurementRafId)
    }
  }, [])

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
      lerp: reducedMotion ? 1 : SMOOTH_SCROLL_LERP,
      // Phone swipes should move deliberately through the photographs instead
      // of flinging across several images from one short gesture.
      touchMultiplier: compactViewport ? 0.5 : 1,
      touchInertiaExponent: compactViewport ? 1.35 : 1.7,
      wheelMultiplier: 0.25,
    })

    // Give manual input priority, then resume auto-scroll after its momentum
    // has settled. These events do not run for programmatic camera centering.
    let autoScrollResumeAt = 0
    let pointerScrollFactor = 1
    const handleManualScroll = () => {
      motionRef.current.clearSelection?.()
      autoScrollResumeAt = performance.now() + AUTO_SCROLL_MANUAL_PAUSE_MS
    }
    const handlePointerMove = (event) => {
      if (event.pointerType && event.pointerType !== 'mouse') return
      if (window.innerWidth <= 0) return

      const normalizedX = THREE.MathUtils.clamp(
        (event.clientX / window.innerWidth) * 2 - 1,
        -1,
        1,
      )
      const distanceFromCenter = Math.abs(normalizedX)

      if (distanceFromCenter <= AUTO_SCROLL_POINTER_DEAD_ZONE) {
        pointerScrollFactor = 0
        return
      }

      // A square-root curve makes low CMS speeds perceptible soon after the
      // pointer leaves center while still reaching the configured edge speed.
      const scaledDistance = (
        (distanceFromCenter - AUTO_SCROLL_POINTER_DEAD_ZONE)
        / (1 - AUTO_SCROLL_POINTER_DEAD_ZONE)
      )
      pointerScrollFactor = Math.sign(normalizedX) * Math.sqrt(scaledDistance)
    }
    const handlePointerLeave = () => {
      pointerScrollFactor = 0
    }
    wrapper.addEventListener('wheel', handleManualScroll, { passive: true })
    wrapper.addEventListener('touchmove', handleManualScroll, { passive: true })
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    document.documentElement.addEventListener('mouseleave', handlePointerLeave, { passive: true })

    let autoScrollOffset = 0
    let autoScrollVelocity = 0
    const updateMotion = () => {
      // Keep automatic camera travel separate from Lenis's manual momentum.
      // Combining them here avoids resetting Lenis's animation every frame.
      const manualScroll = typeof lenis.scroll === 'number' ? lenis.scroll : 0
      const manualVelocity = Number.isFinite(lenis.velocity) ? lenis.velocity : 0
      motionRef.current.scroll = manualScroll + autoScrollOffset
      motionRef.current.limit = typeof lenis.limit === 'number' ? lenis.limit : 1
      motionRef.current.velocity = manualVelocity + autoScrollVelocity
    }

    motionRef.current.focusPlane = (worldX, cycleWidth) => {
      // Convert a photograph's 3D x position into the matching scroll position.
      motionRef.current.autoScrollPaused = true
      const targetProgress = loopOffset(worldX, cycleWidth) / cycleWidth
      const scrollLimit = lenis.limit > 0 ? lenis.limit : 1
      const targetScroll = loopOffset(
        targetProgress * scrollLimit - autoScrollOffset,
        scrollLimit,
      )
      lenis.scrollTo(targetScroll, {
        duration: reducedMotion ? 0 : 1.1,
        immediate: reducedMotion,
        easing: (progress) => 1 - Math.pow(1 - progress, 4),
      })
    }

    lenis.on('scroll', updateMotion)

    // Refresh viewport-relative scroll dimensions after Astro finishes laying
    // out the hydrated island, matching the recalculation a resize would cause.
    const layoutSyncFrame = requestAnimationFrame(() => {
      lenis.resize()
      updateMotion()
    })

    // requestAnimationFrame asks the browser to update just before each repaint.
    let rafId = 0
    let previousFrameTime = null
    const raf = (time) => {
      const deltaSeconds = previousFrameTime === null
        ? 0
        : Math.min((time - previousFrameTime) / 1000, 0.05)
      previousFrameTime = time

      if (
        enableAutoScroll
        && !reducedMotion
        && !motionRef.current.autoScrollPaused
        && time >= autoScrollResumeAt
        && lenis.limit > 0
      ) {
        // Apply the time-based pointer velocity directly to the camera's scroll
        // coordinate. Lenis remains free to finish manual momentum smoothly.
        const autoScrollDelta = resolvedAutoScrollSpeed
          * pointerScrollFactor
          * deltaSeconds
        autoScrollOffset = loopOffset(autoScrollOffset + autoScrollDelta, lenis.limit)
        autoScrollVelocity = autoScrollDelta
      } else {
        autoScrollVelocity = 0
      }

      lenis.raf(time)
      updateMotion()
      rafId = requestAnimationFrame(raf)
    }

    rafId = requestAnimationFrame(raf)

    // Stop animation work if this page is ever removed from the screen.
    return () => {
      cancelAnimationFrame(rafId)
      cancelAnimationFrame(layoutSyncFrame)
      wrapper.removeEventListener('wheel', handleManualScroll)
      wrapper.removeEventListener('touchmove', handleManualScroll)
      window.removeEventListener('pointermove', handlePointerMove)
      document.documentElement.removeEventListener('mouseleave', handlePointerLeave)
      motionRef.current.focusPlane = null
      lenis.destroy()
    }
  }, [compactViewport, enableAutoScroll, reducedMotion, resolvedAutoScrollSpeed])

  return (
    <div className="gallery-runtime">
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
            <WebGLGallery
              images={images}
              randomizePhotoOrder={randomizePhotoOrder}
              motionRef={motionRef}
              onCaptionChange={setActiveCaption}
              reducedMotion={reducedMotion}
              enablePhotoFloating={enablePhotoFloating}
              enableDepthOfField={enableDepthOfField}
              enableScrollMotionBlur={enableScrollMotionBlur}
              compactViewport={compactViewport}
              photosCanReveal={photosCanReveal}
              onPreloadProgress={setPreloadProgress}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
