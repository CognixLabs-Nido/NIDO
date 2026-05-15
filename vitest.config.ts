import { config as loadEnv } from 'dotenv'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Carga .env.local explícitamente para tests RLS y de integración
loadEnv({ path: '.env.local' })

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    // Suite RLS hace muchos signInWithPassword contra Supabase Cloud Auth;
    // corriendo archivos en paralelo se dispara el rate-limit (429
    // "over_request_rate_limit") y los reintentos no llegan. Serializar
    // archivos elimina el burst — el CI deja de flakear a coste de ~30s
    // extra en el total de la suite.
    fileParallelism: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['node_modules/', 'src/test/', '.next/'],
    },
  },
})
