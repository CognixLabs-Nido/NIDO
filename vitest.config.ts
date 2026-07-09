import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Carga .env.local explícitamente para tests RLS y de integración
loadEnv({ path: '.env.local' })

// Globs del grupo de integración remota: pegan a Supabase Cloud (signIn con
// rate-limit de Auth, service role, triggers de audit). Comparten latencia de
// red y backoff de reintento — necesitan más holgura de timeout que el resto.
const REMOTE_GLOBS = ['src/test/rls/**/*.test.ts', 'src/test/audit/**/*.test.ts']

const sharedEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
}

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      // `import 'server-only'` lanza en cualquier entorno que no sea
      // Server Components (Next.js). En tests no nos importa la guardia
      // — el aislamiento real lo hace cada test con vi.mock() de las
      // acciones. Resolvemos a un módulo vacío para que la cadena de
      // imports (ej. MensajeComposer → enviar-mensaje → audiencia.ts)
      // no rompa en jsdom.
      'server-only': fileURLToPath(new URL('./src/test/mocks/server-only.ts', import.meta.url)),
    },
  },
  test: {
    // --- Opciones globales compartidas por todos los proyectos ---
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    env: sharedEnv,
    // Suite RLS hace muchos signInWithPassword contra Supabase Cloud Auth;
    // corriendo archivos en paralelo se dispara el rate-limit (429
    // "over_request_rate_limit") y los reintentos no llegan. Serializar
    // archivos elimina el burst. NO paralelizar: el runner CI (ubuntu-latest)
    // y el Chromebook de dev son de 2 cores; paralelizar reintroduce
    // contención de CPU que hace flakear incluso tests de render síncronos.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['node_modules/', 'src/test/', '.next/'],
    },
    // -----------------------------------------------------------------------
    // Flake bajo contención — sprint pre-F6 item 3 (a raíz del PR #38).
    //
    // Síntoma: tests verdes en aislamiento, rojos en la suite completa bajo
    // carga (asistencia.rls, marcar-mensaje-erroneo, CalendarioMensual). La
    // concurrencia YA estaba en el suelo (fileParallelism:false) → NO era
    // paralelización agresiva. El elemento frágil era el `testTimeout` default
    // de 5000 ms, insuficiente para dos modos de fallo:
    //   - RLS: `signInWithPassword` con backoff de reintento (2s → 4s → …,
    //     ver withRetry en src/test/rls/setup.ts) ante rate-limit supera 5s
    //     antes de recuperarse → timeout. En aislamiento no hay rate-limit,
    //     no hay reintento, pasa.
    //   - UI síncrona: un render React+jsdom bajo CPU saturada (la corrida que
    //     falló tardó 814s vs 523s habituales en 2 cores) puede rebasar 5s.
    //
    // Fix: separar en proyectos con timeouts holgados por grupo, sin tocar la
    // serialización. El grupo remoto necesita más (red + retry); el unit menos
    // pero por encima de 5s. Correr un grupo aislado: `npm run test:rls`.
    // -----------------------------------------------------------------------
    projects: [
      {
        extends: true,
        test: {
          name: 'rls',
          include: REMOTE_GLOBS,
          // Wipe bruto ACOTADO al arrancar (solo este proyecto; NO en `unit`, que
          // no toca la BD). Limpia el residuo de test (@nido.test) de la corrida
          // anterior antes de empezar → un crash no contamina la siguiente. Ver
          // el INVARIANTE de seguridad en el propio fichero.
          globalSetup: ['./src/test/rls/global-setup.ts'],
          // 90s (antes 20s): además de la red + backoff de Auth, los tests pesados
          // (purgar_sujeto_db, INSERT con triggers de audit) corren contra la BD
          // remota compartida bajo contención de varios runs de CI. Con el
          // statement_timeout de service_role subido a 60s (migración
          // 20260622090000_cistab_service_role_statement_timeout), el cuello de
          // botella pasaba a ser este testTimeout — se alinea con hookTimeout (90s)
          // para que la ventana de vitest no corte el statement ya destrangulado.
          testTimeout: 90_000,
          // 90s (antes 30s): desde #124 la CI corre las ~150 suites RLS en paralelo
          // contra una sola BD remota; los `afterAll` hacen borrados pesados (cascadas)
          // que bajo contención rebasan 30s → "Hook timed out in 30000ms" en un fichero
          // distinto cada run (autorizaciones/retencion/campanas…). Subir el margen del
          // teardown absorbe la contención. NO cubre los statement_timeout de Postgres
          // (p. ej. purgar_sujeto_db) — esa flakiness es otra y queda para ola 2.
          hookTimeout: 90_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['e2e/**', 'node_modules/**', '.next/**', ...REMOTE_GLOBS],
          // Sin red, pero margen sobre los 5s default para absorber el render
          // bajo CPU saturada en runners de 2 cores.
          testTimeout: 15_000,
        },
      },
    ],
  },
})
