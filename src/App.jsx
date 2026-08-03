import Scene from './components/Scene.jsx'

// App is the top-level React component. More pages or shared UI could be
// added here later; for now, the whole application is the gallery scene.
export default function App({ images, siteTitle, randomizePhotoOrder }) {
  return (
    <Scene
      images={images}
      siteTitle={siteTitle}
      randomizePhotoOrder={randomizePhotoOrder}
    />
  )
}
