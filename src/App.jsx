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
  enableDepthDarkening,
  enableDepthOfField,
  bokehStrength,
  backgroundOverlayOpacity,
  enableScrollMotionBlur,
  enableCarouselEdgeFade,
}) {
  return (
    <Scene
      images={images}
      introDuration={introDuration}
      randomizePhotoOrder={randomizePhotoOrder}
      enableAutoScroll={enableAutoScroll}
      autoScrollSpeed={autoScrollSpeed}
      enablePhotoFloating={enablePhotoFloating}
      enableDepthDarkening={enableDepthDarkening}
      enableDepthOfField={enableDepthOfField}
      bokehStrength={bokehStrength}
      backgroundOverlayOpacity={backgroundOverlayOpacity}
      enableScrollMotionBlur={enableScrollMotionBlur}
      enableCarouselEdgeFade={enableCarouselEdgeFade}
    />
  )
}
