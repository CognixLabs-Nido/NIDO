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
])

export default eslintConfig
