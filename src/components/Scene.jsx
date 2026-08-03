import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { DepthOfField, EffectComposer } from '@react-three/postprocessing'
import Lenis from 'lenis'
import * as THREE from 'three'

const IMAGES = [
  '/images/a_gaut_1780077945_3907899508835593186_26951807.jpg',
  '/images/a_gaut_1781549496_3920243768016469670_26951807.jpg',
  '/images/a_gaut_1781695152_3921465621796176075_26951807.jpg',
  '/images/artofinteriors_1771942500_3839436776553667630_1150551359.jpg',
  '/images/a_gaut_1781549496_3920243768469434518_26951807.jpg',
  '/images/artofinteriors_1771942500_3839436776545268050_1150551359.jpg',
  '/images/a_gaut_1777037140_3882390767105130799_26951807.jpg',
  '/images/a_gaut_1780696704_3913090035012860252_26951807.jpg',
  '/images/a_gaut_1777037140_3882390772406712841_26951807.jpg',
  '/images/artofinteriors_1771942500_3839436776629202894_1150551359.jpg',
  '/images/a_gaut_1781190764_3917234510026958899_26951807.jpg',
  '/images/a_gaut_1781259716_3917812920738724540_26951807.jpg',
  '/images/a_gaut_1777037140_3882390757995115737_26951807.jpg',
  '/images/artofinteriors_1771942500_3839436776553652069_1150551359.jpg',
  '/images/fredericmagazine_1776193261_3875251897205151116_38402447939.jpg',
  '/images/a_gaut_1780839727_3914289799339354428_26951807 (1).jpg',
  '/images/a_gaut_1781609517_3920747132776368764_26951807.jpg',
  '/images/a_gaut_1780915399_3914924581824052461_26951807.jpg',
  '/images/a_gaut_1780839727_3914289799456809303_26951807 (1).jpg',
  '/images/a_gaut_1781259716_3917812920831015269_26951807.jpg',
  '/images/a_gaut_1780839727_3914289799339354428_26951807.jpg',
  '/images/fredericmagazine_1776193261_3875251898371201067_38402447939.jpg',
  '/images/a_gaut_1780077945_3907899508776880172_26951807.jpg',
  '/images/a_gaut_1780760857_3913628186521272954_26951807.jpg',
  '/images/a_gaut_1777037140_3882390750713786725_26951807.jpg',
  '/images/a_gaut_1777037140_3882390764479496888_26951807.jpg',
  '/images/a_gaut_1781609517_3920747050702407619_26951807.jpg',
  '/images/a_gaut_1781259716_3917812920738773998_26951807.jpg',
  '/images/a_gaut_1780915399_3914924581840839282_26951807.jpg',
  '/images/a_gaut_1781695152_3921465621066363513_26951807.jpg',
  '/images/a_gaut_1781549496_3920243768209412511_26951807.jpg',
  '/images/a_gaut_1780696704_3913090034400437028_26951807.jpg',
  '/images/a_gaut_1777037140_3882390755344295393_26951807.jpg',
  '/images/a_gaut_1780839727_3914289799456809303_26951807.jpg',
  '/images/a_gaut_1781088567_3916377039724479385_26951807.jpg',
  '/images/a_gaut_1777037140_3882390762055141918_26951807.jpg',
  '/images/a_gaut_1781088567_3916377035848811998_26951807.jpg',
  '/images/a_gaut_1781259716_3917812920755496128_26951807.jpg',
  '/images/a_gaut_1780696704_3913090034551432225_26951807.jpg',
  '/images/a_gaut_1780915399_3914924581790506941_26951807.jpg',
  '/images/a_gaut_1781549496_3920243768209391766_26951807.jpg',
  '/images/fredericmagazine_1776193261_3875251897632979906_38402447939.jpg',
  '/images/a_gaut_1780760857_3913628186521272954_26951807 (1).jpg',
  '/images/a_gaut_1777037140_3882390769495870604_26951807.jpg',
  '/images/a_gaut_1781549496_3920243768268133075_26951807.jpg',
  '/images/a_gaut_1781190764_3917234509884294531_26951807.jpg',
  '/images/a_gaut_1777037140_3882390759521834099_26951807.jpg',
  '/images/a_gaut_1781695152_3921465621066399174_26951807.jpg',
  '/images/a_gaut_1777037140_3882390775468559435_26951807.jpg',
  '/images/a_gaut_1780077945_3907899508802050894_26951807.jpg',
  '/images/artofinteriors_1771942500_3839436776553708653_1150551359.jpg',
]

const CAMERA_Z = 12
const LANE_STYLES = {
  1: { height: 3.05, y: 0.55, z: -3.1 },
  2: { height: 3.75, y: 0.05, z: -1.05 },
  3: { height: 6.55, y: -0.35, z: 1.1 },
}

function loopOffset(value, cycle) {
  if (!cycle) return 0
  return ((value % cycle) + cycle) % cycle
}

function seededUnit(index, salt) {
  const raw = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return raw - Math.floor(raw)
}

function createGalleryLayout() {
  const lanes = []

  IMAGES.forEach((_, index) => {
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
  const items = IMAGES.map((src, index) => {
    const lane = lanes[index]
    const laneStyle = LANE_STYLES[lane]
    const width = laneStyle.height * 0.8
    const gap = 0.42 + seededUnit(index, 9.4) * 0.65
    const overlap = 0.08 + seededUnit(index, 7.7) * 0.16
    const item = {
      src,
      textureIndex: index,
      lane,
      width,
      height: laneStyle.height,
      x: cursor + width / 2,
      y: laneStyle.y + (seededUnit(index, 11.2) - 0.5) * 0.18,
      z: laneStyle.z,
    }

    cursor += width + gap - overlap
    return item
  })

  return { items, cycleWidth: cursor }
}

function GalleryPlanes({ layout, selectedKey, setSelectedKey, onFocusPlane, focusPointRef }) {
  const gl = useThree((state) => state.gl)
  const textureUrls = useMemo(
    () => IMAGES.map((src) => encodeURI(src.replace('/images/', '/images-webgl/'))),
    [],
  )
  const textures = useLoader(THREE.TextureLoader, textureUrls)
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const meshRefs = useRef(new Map())
  const hoveredKeyRef = useRef(null)
  const focusAnimationActiveRef = useRef(false)
  const instances = useMemo(
    () => [-1, 0, 1].flatMap((copy) => layout.items.map((item) => ({
      ...item,
      key: `${copy}-${item.textureIndex}`,
      baseX: item.x + copy * layout.cycleWidth,
    }))),
    [layout],
  )
  const materials = useMemo(
    () => textures.map((texture) => new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
      toneMapped: false,
    })),
    [textures],
  )

  useEffect(() => {
    const anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), 4)
    textures.forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = anisotropy
      texture.needsUpdate = true
    })

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
        const cameraFov = THREE.MathUtils.degToRad(camera.fov)
        const focusDistance = instance.height / (2 * Math.tan(cameraFov / 2) * 0.88)
        targetY = 0
        targetZ = camera.position.z - focusDistance
      } else if (!selected && instance.key === hoveredKeyRef.current) {
        targetZ += 0.45
      } else if (selected) {
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

      mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 7, delta)
      mesh.position.y = THREE.MathUtils.damp(mesh.position.y, targetY, 7, delta)
      mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 7, delta)

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

function CameraRig({ layout, motionRef }) {
  const dollyRef = useRef(0)

  useFrame(({ camera }, delta) => {
    const { scroll, limit, velocity } = motionRef.current
    const progress = limit > 0 ? loopOffset(scroll, limit) / limit : 0
    const targetDolly = Math.min(Math.abs(velocity) * 0.55, 1)
    const damping = targetDolly > dollyRef.current ? 9 : 3.25

    dollyRef.current = THREE.MathUtils.damp(dollyRef.current, targetDolly, damping, delta)
    camera.position.x = progress * layout.cycleWidth
    camera.position.z = CAMERA_Z - dollyRef.current * 0.2
  })

  return null
}

function GalleryDepthOfField({ selectedKey, focusPointRef }) {
  const effectRef = useRef(null)
  const focusDistanceRef = useRef(CAMERA_Z - LANE_STYLES[3].z)
  const nearBlurConfiguredRef = useRef(false)

  useFrame(({ camera }, delta) => {
    const effect = effectRef.current
    if (!effect) return

    if (!nearBlurConfiguredRef.current) {
      effect.bokehNearBasePass.fullscreenMaterial.scale = 0
      effect.bokehNearFillPass.fullscreenMaterial.scale = 0
      nearBlurConfiguredRef.current = true
    }

    if (selectedKey !== null) {
      effect.target = focusPointRef.current
      focusDistanceRef.current = camera.position.distanceTo(focusPointRef.current)
      return
    }

    effect.target = null
    const targetDistance = camera.position.z - LANE_STYLES[3].z
    focusDistanceRef.current = THREE.MathUtils.damp(
      focusDistanceRef.current,
      targetDistance,
      6,
      delta,
    )

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

function WebGLGallery({ motionRef }) {
  const layout = useMemo(() => createGalleryLayout(), [])
  const [selectedKey, setSelectedKey] = useState(null)
  const focusPointRef = useRef(new THREE.Vector3(0, 0, LANE_STYLES[3].z))

  return (
    <Canvas
      className="gallery-canvas"
      camera={{ fov: 42, near: 0.1, far: 100, position: [0, 0, CAMERA_Z] }}
      dpr={[1, 1.25]}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => setSelectedKey(null)}
    >
      <CameraRig layout={layout} motionRef={motionRef} />
      <Suspense fallback={null}>
        <GalleryPlanes
          layout={layout}
          selectedKey={selectedKey}
          setSelectedKey={setSelectedKey}
          onFocusPlane={(worldX, cycleWidth) => motionRef.current.focusPlane?.(worldX, cycleWidth)}
          focusPointRef={focusPointRef}
        />
      </Suspense>
      <GalleryDepthOfField selectedKey={selectedKey} focusPointRef={focusPointRef} />
    </Canvas>
  )
}

export default function Scene() {
  const wrapperRef = useRef(null)
  const contentRef = useRef(null)
  const motionRef = useRef({ scroll: 0, limit: 1, velocity: 0, focusPlane: null })

  useEffect(() => {
    const wrapper = wrapperRef.current
    const content = contentRef.current
    if (!wrapper || !content) return undefined

    const lenis = new Lenis({
      wrapper,
      content,
      orientation: 'horizontal',
      gestureOrientation: 'both',
      smoothWheel: true,
      syncTouch: true,
      infinite: true,
      lerp: 0.045,
      wheelMultiplier: 0.25,
    })

    const updateMotion = () => {
      motionRef.current.scroll = typeof lenis.scroll === 'number' ? lenis.scroll : 0
      motionRef.current.limit = typeof lenis.limit === 'number' ? lenis.limit : 1
      motionRef.current.velocity = Number.isFinite(lenis.velocity) ? lenis.velocity : 0
    }

    motionRef.current.focusPlane = (worldX, cycleWidth) => {
      const targetProgress = loopOffset(worldX, cycleWidth) / cycleWidth
      lenis.scrollTo(targetProgress * lenis.limit, {
        duration: 1.1,
        easing: (progress) => 1 - Math.pow(1 - progress, 4),
      })
    }

    lenis.on('scroll', updateMotion)

    let rafId = 0
    const raf = (time) => {
      lenis.raf(time)
      updateMotion()
      rafId = requestAnimationFrame(raf)
    }

    rafId = requestAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(rafId)
      motionRef.current.focusPlane = null
      lenis.destroy()
    }
  }, [])

  return (
    <main className="studio-shell">
      <div className="studio-noise" aria-hidden="true" />
      <p className="brand-signature">ADRIAN GAUT</p>
      <nav className="header-links" aria-label="Contact and social links">
        <a className="contact-link" href="mailto:adrian@agaut.com">
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
      <div className="scroll-wrapper" ref={wrapperRef}>
        <section className="scroll-content" ref={contentRef}>
          <div className="depth-stage">
            <div className="name-wrap">
              <p className="kicker">places spaces &amp; things</p>
              <h1 className="name">a. gaut</h1>
            </div>

            <WebGLGallery motionRef={motionRef} />
          </div>
        </section>
      </div>
    </main>
  )
}
