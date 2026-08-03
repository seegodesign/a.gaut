import { defineConfig } from 'astro/config'
import react from '@astrojs/react'

// Enable Astro to render React components such as the Three.js gallery.
export default defineConfig({
  site: 'https://www.agaut.com',
  integrations: [react()],
})
