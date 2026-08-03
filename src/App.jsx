import Scene from './components/Scene.jsx'

// App is the top-level React component. More pages or shared UI could be
// added here later; for now, the whole application is the gallery scene.
export default function App({
  images,
  introDuration,
  randomizePhotoOrder,
  enableAutoScroll,
  autoScrollSpeed,
  enablePhotoFloating,
  enableDepthOfField,
  enableScrollMotionBlur,
}) {
  return (
    <Scene
      images={images}
      introDuration={introDuration}
      randomizePhotoOrder={randomizePhotoOrder}
      enableAutoScroll={enableAutoScroll}
      autoScrollSpeed={autoScrollSpeed}
      enablePhotoFloating={enablePhotoFloating}
      enableDepthOfField={enableDepthOfField}
      enableScrollMotionBlur={enableScrollMotionBlur}
    />
  )
}
