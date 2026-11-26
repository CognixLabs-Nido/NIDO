import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

import lecturaMiraElError from './eslint-rules/lectura-mira-el-error.mjs'
import paradaTrasEscritura from './eslint-rules/parada-tras-escritura.mjs'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'src/types/database.ts',
    // Los casos del codemod de lecturas: su texto exacto ES el caso (entrada y salida esperada).
    'scripts/codemods/casos-lectura/**',
  ]),
  {
    rules: {
      // TypeScript strict — sin any
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Sin console.log en producción
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Un fichero CommonJS (`.cjs`: el escáner de cadena de la CI y los codemods del censo C) carga con
  // `require`: es la única forma que tiene. La regla de los imports es para los módulos ES.
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Lint-guard F11-D fase 2: el cliente service-role (que bypassa TODA la RLS) vive
  // en UN solo módulo, `src/lib/supabase/admin.ts`. Nadie más puede tocar la
  // SERVICE_ROLE key ni, por tanto, recrear el footgun cookie-bound (pasarla a
  // `createServerClient`/`createClient`). Excepción: el setup de los tests RLS, que
  // necesita la key para arrancar clientes service-role de fixtures.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/supabase/admin.ts', 'src/test/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            'SUPABASE_SERVICE_ROLE_KEY solo puede usarse en src/lib/supabase/admin.ts (createServiceRoleClient). Importa createServiceRoleClient en su lugar — bypassa toda la RLS, jamás authz por-usuario.',
        },
        {
          selector: "MemberExpression[computed=true] > Literal[value='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            'SUPABASE_SERVICE_ROLE_KEY solo puede usarse en src/lib/supabase/admin.ts (createServiceRoleClient). Importa createServiceRoleClient en su lugar — bypassa toda la RLS, jamás authz por-usuario.',
        },
      ],
    },
  },
  // Censo C (decisión de Jose del 2026-11-25): una llamada a Supabase mira su `error`. Un sitio nuevo con el
  // patrón viejo pone la CI roja; los que quedan hoy, en la lista blanca temporal, que solo baja.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/test/**', '**/__tests__/**', '**/*.test.{ts,tsx}'],
    // Y (2026-11-25) una lectura fallida después de una escritura hecha no para: diría «no se guardó» sobre
    // algo guardado. Esta regla ve la misma función; la cadena entre funciones, el escáner de la CI.
    plugins: {
      nido: {
        rules: {
          'lectura-mira-el-error': lecturaMiraElError,
          'parada-tras-escritura': paradaTrasEscritura,
        },
      },
    },
    rules: { 'nido/lectura-mira-el-error': 'error', 'nido/parada-tras-escritura': 'error' },
  },
  // `src/types/database.ts` es la salida del generador, sin tocar. Lo que el generador no sabe (la
  // nulabilidad de las funciones RETURNS TABLE, los argumentos que aceptan NULL, las columnas
  // generadas) está en `src/types/db.ts`, encima. Importar el generado directamente se salta esa capa.
  {
    files: ['**/*.{ts,tsx,mts}'],
    ignores: ['src/types/db.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^@/types/database$)|(/types/database$)|(^\\./database$)',
              message:
                'Importa los tipos de la base de @/types/db: database.ts es el generado puro y db.ts le añade lo que el generador no sabe.',
            },
          ],
        },
      ],
    },
  },
])

export default eslintConfig
