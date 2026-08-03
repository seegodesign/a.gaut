import { useLayoutEffect, useRef } from 'react'
import { Center, useGLTF } from '@react-three/drei'
import gsap from 'gsap'

export default function Model() {
  const group = useRef()
  const { scene } = useGLTF('/models/object.glb')

  useLayoutEffect(() => {
    const model = group.current
    const entrance = gsap.fromTo(
      model.scale,
      { x: 0.9, y: 0.9, z: 0.9 },
      { x: 1, y: 1, z: 1, duration: 1, ease: 'power2.out' },
    )

    return () => entrance.kill()
  }, [])

  return (
    <group ref={group}>
      <Center>
        <primitive object={scene} />
      </Center>
    </group>
  )
}

useGLTF.preload('/models/object.glb')
