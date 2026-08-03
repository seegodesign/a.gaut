# Adrian Gaut Portfolio

An Astro photography portfolio with an interactive WebGL gallery, React Three
Fiber, smooth infinite scrolling, and a Git-backed Sveltia CMS.

## Requirements

- Node.js 20.19 or newer
- npm

## Run locally

```sh
npm install
npm run dev
```

Astro prints the local site URL in the terminal, usually
`http://localhost:4321`. The CMS is available at `/admin/`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Optimize changed uploads, then start Astro's development server. |
| `npm run build` | Optimize changed uploads, then create the production site in `dist/`. |
| `npm run preview` | Preview the completed production build locally. |
| `npm run optimize:images` | Generate the optimized AVIF gallery images without running Astro. |

## Content management

Sveltia CMS is configured in `public/admin/config.yml` and stores content as
files in the Git repository. Changes made in the CMS are committed to the
`main` branch and should trigger a new site deployment.

CMS content is split by responsibility:

- `src/content/site.json`: site title, gallery subhead, and Instagram URL.
- `src/content/gallery.json`: gallery images, order, and optional captions.
- `src/content/gallery-settings.json`: gallery ordering, auto-scroll, and
  visual effects.
- `src/content/seo-social.json`: search metadata and social sharing image.
- `src/content/contact.json`: representation and contact-page details.

In Sveltia, Site Identity, Search & Sharing, and Contact Page are singleton
pages that open directly from the sidebar. Gallery remains a collection because
its image editor and behavior settings are separate files.

Original uploads must remain in `public/uploads`. Sveltia uses that directory
as its media library and saves paths such as `/uploads/photo.jpg` in the JSON.

### Image preprocessing

Before development and production builds, `scripts/optimize-images.mjs` creates
a quality-focused AVIF version of every CMS upload. Generated images are placed
in `public/optimized/uploads`, excluded from Git, and rebuilt as needed.

The source and generated files have different jobs:

```text
public/uploads/photo.jpg
    CMS-managed original

public/optimized/uploads/photo.jpg.avif
    Generated file delivered to the WebGL gallery
```

The originals are never changed or deleted by the optimizer. Only new or
modified source images are re-encoded during local builds. Generated files for
deleted originals are cleaned up automatically.

Current AVIF settings are defined near the top of
`scripts/optimize-images.mjs`: a 2400 px maximum edge, quality 60, and full
chroma sampling. The gallery uses the optimized URL, while the CMS and social
sharing metadata continue to use the original upload URL.

### Lazy texture loading

The browser does not download the entire gallery at once. `Scene.jsx` requests
textures near the current camera position and preloads a small distance ahead.
Loaded textures stay cached for smooth return visits through the infinite loop,
and an image selected with the keyboard is requested immediately.

## Gallery controls

- Scroll, swipe, or trackpad horizontally to move through the gallery.
- Click and drag to scrub the gallery; a fast release throws it with momentum.
- Click or tap a photograph to open it and reveal its optional caption.
- Click the active photograph or empty space to close it.
- Press `Left Arrow` or `Right Arrow` to move between photographs.
- Press `Escape` to close the active photograph.
- Scrolling automatically closes the active photograph.
- When enabled in Site Settings, auto-scroll advances the gallery until a
  photograph is opened and resumes after it is closed. Mouse position controls
  its direction and speed: left reverses, center stops, and right advances. The
  maximum speed is configurable in Site Settings.

The site respects the operating system's `prefers-reduced-motion` setting,
including disabling automatic scrolling.

## Project structure

```text
public/
  admin/                 Sveltia CMS page and configuration
  uploads/               Original CMS-managed images
scripts/
  optimize-images.mjs    Build-time AVIF generator
src/
  components/Scene.jsx   WebGL gallery, scrolling, loading, and interaction
  content/               CMS-managed JSON content
  lib/imagePaths.js      Maps original upload URLs to generated AVIF URLs
  pages/                 Astro pages and document metadata
  App.jsx                React gallery entry component
  styles.css             Shared visual styles
astro.config.mjs         Astro site URL and React integration
```

Astro renders the page shell and metadata. The interactive gallery is hydrated
in the browser with React, React Three Fiber, Three.js, Lenis, and
postprocessing effects.

## Deployment

The production host should run:

```sh
npm install
npm run build
```

Publish the generated `dist` directory. Build environments must install
development dependencies because Sharp performs the AVIF conversion. The
canonical production URL is configured in `astro.config.mjs`.
