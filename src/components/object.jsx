import { useLayoutEffect, useRef } from 'react'
import { Center, useGLTF } from '@react-three/drei'
import gsap from 'gsap'

// This optional component loads a 3D model and gives it a short entrance
// animation. It is not currently rendered by Scene.jsx, but is ready to reuse.
export default function Model() {
  // `group` gives us direct access to the Three.js group after it is created.
  const group = useRef()
  // useGLTF loads the model file and returns its Three.js scene.
  const { scene } = useGLTF('/models/object.glb')

  useLayoutEffect(() => {
    const model = group.current
    const entrance = gsap.fromTo(
      model.scale,
      { x: 0.9, y: 0.9, z: 0.9 },
      { x: 1, y: 1, z: 1, duration: 1, ease: 'power2.out' },
    )

    // Cancel the GSAP animation if React removes this component early.
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

// Start downloading the model early so it is ready before the component opens.
useGLTF.preload('/models/object.glb')
