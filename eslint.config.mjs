import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src/types/database.ts']),
  {
    rules: {
      // TypeScript strict — sin any
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Sin console.log en producción
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
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
