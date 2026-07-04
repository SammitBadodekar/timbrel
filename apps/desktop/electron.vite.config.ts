import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Workspace source packages must be bundled (not externalized) since they ship
// TypeScript, not built JS. Native/heavy deps stay external and are resolved
// from node_modules at runtime.
const bundledWorkspacePkgs = ['@timbrel/core', '@timbrel/ui']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePkgs })]
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePkgs })]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
