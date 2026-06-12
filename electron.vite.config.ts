import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const srcAliases = ['backend', 'frontend', 'common'].map((name) => ({
  find: name,
  replacement: path.join(__dirname, 'src', name)
}))

export default defineConfig(({ mode }) => ({
  main: {
    build: {
      rollupOptions: {
        input: 'src/backend/main.ts',
        output: {
          // Evita chunks con hash (p. ej. agent-*.js) que rompen IPC si Electron no reinicia el main.
          inlineDynamicImports: true
        }
      },
      outDir: 'build/main',
      minify: mode === 'production',
      sourcemap: mode === 'development' ? 'inline' : false
    },
    resolve: { alias: srcAliases },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: { input: 'src/preload/index.ts' },
      outDir: 'build/preload',
      minify: mode === 'production',
      sourcemap: mode === 'development' ? 'inline' : false
    },
    resolve: { alias: srcAliases },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: '.',
    base: './',
    publicDir: 'public',
    define: {
      'import.meta.env.VITE_UI_PREVIEW': JSON.stringify(process.env.KALIMOTXO_UI_PREVIEW ?? '')
    },
    build: {
      rollupOptions: { input: path.resolve('index.html') },
      outDir: 'build',
      emptyOutDir: false,
      minify: mode === 'production',
      sourcemap: mode === 'development' ? 'inline' : false
    },
    resolve: { alias: srcAliases },
    plugins: [react(), tailwindcss()]
  }
}))
