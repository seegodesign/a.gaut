# Repository guidelines

## Project overview

This is an Astro photography portfolio with a client-only React Three Fiber
gallery. Astro owns the document shell, metadata, and static HTML. React owns
the interactive WebGL gallery in `src/components/Scene.jsx`.

Content is managed through Sveltia CMS. Its schema lives in
`public/admin/config.yml`, and its committed data lives in
`src/content/settings.json` and `src/content/gallery.json`.

## Development

- Use Node.js 20.19 or newer and npm.
- Run `npm run dev` for local development.
- Run `npm run build` before handing off code changes.
- There is no separate test or lint script. At minimum, run
  `git diff --check` and `npm run build`.
- The build emits a known large-chunk warning; do not treat that warning alone
  as a build failure.

## Editing conventions

- Keep the Astro/React boundary small. Static, semantic page content belongs in
  Astro; browser-only interaction and WebGL work belong in React.
- Preserve accessibility behavior, including keyboard gallery controls and
  `prefers-reduced-motion` support.
- Avoid creating React state for values updated every animation frame. Use refs
  or Three.js uniforms for frame-loop state.
- Dispose Three.js textures, geometries, and materials during cleanup.
- Preserve lazy texture loading; do not eagerly download the full gallery.
- Treat existing uncommitted changes as user work. Do not overwrite or revert
  unrelated modifications.

## CMS settings

When adding or changing a site setting, update every relevant layer:

1. Define the field in `public/admin/config.yml`.
2. Add a representative value to `src/content/settings.json`.
3. Read it in the relevant Astro page.
4. Pass it through `src/App.jsx` and React components as needed.
5. Update `README.md` when the documented content model changes materially.

Optional boolean effects should normally default to enabled for older CMS
documents by reading them with `setting !== false`. Keep independent visual
effects in independent settings; in particular, depth of field and scroll
motion blur must remain separately controllable.

## Images

- `public/uploads` contains CMS-managed source images. Do not delete, rename, or
  rewrite them unless explicitly requested.
- `public/optimized/uploads` contains generated AVIF files and should not be
  edited manually or committed.
- `npm run optimize:images` regenerates changed optimized assets and is already
  run by the development and production build hooks.
- Use `src/lib/imagePaths.js` when mapping CMS upload paths to optimized paths.

## Scope of important files

- `src/pages/index.astro`: homepage shell, metadata, and gallery props.
- `src/pages/contact.astro`: contact page and metadata.
- `src/App.jsx`: thin React entry point; keep it free of application logic.
- `src/components/Scene.jsx`: gallery layout, loading, animation, interaction,
  and post-processing.
- `src/styles.css`: shared page and overlay styles.
- `public/admin/config.yml`: Sveltia CMS content model.
