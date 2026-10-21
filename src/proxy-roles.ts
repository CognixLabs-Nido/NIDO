/**
 * Mapa de prefijos protegidos del proxy (middleware Next.js) → roles
 * permitidos. Vive en un módulo separado de `src/proxy.ts` para que pueda
 * importarse desde tests Vitest sin arrastrar dependencias de Next runtime
 * (`next/server`, `next-intl/middleware`, `@supabase/ssr`) que vitest no
 * resuelve fuera del entorno de Next.
 *
 * Reglas de pertenencia:
 *
 *  - `/admin`: Dirección, `admin` o `directora` (el proxy ve la fila de `roles_usuario`; dentro
 *    de la app la directora ya es `admin`, ver `features/centros/contexto/resolver.ts`). Lo
 *    exclusivo de la admin lo cierra cada página y cada acción con `esResponsable`.
 *  - `/teacher`: `profe` y Dirección (Dirección actúa como "super-profe" — puede
 *    entrar a cualquier subruta de aulas desde el listado de
 *    `/admin/aulas`). Los layouts/pages dentro de `/teacher/*` aplican
 *    defensa en profundidad con guards `rol === 'profe' || rol === 'admin'`.
 *  - `/family`: `tutor_legal` y `autorizado`.
 *
 * Si añades una nueva subruta dentro de uno de estos espacios, no necesitas
 * tocar este mapa — el regex captura `prefix/*`. Si añades un nuevo espacio
 * top-level (p. ej. `/director`), añade entrada aquí Y guard de defensa
 * en profundidad en su layout.
 */
export const PROTECTED_PREFIXES: Array<{ prefix: RegExp; roles: ReadonlyArray<string> }> = [
  // `/admin` es solo admin. La profe NO entra aquí: sus autorizaciones (recogidas
  // y medicación de su aula) viven en `/teacher/autorizaciones` bajo el layout de
  // teacher (chrome correcto). El layout admin redirige a cualquier no-admin, así
  // que colgar la ruta de la profe de `/admin` la bloqueaba — ese era el fallo.
  { prefix: /^\/admin(\/.*)?$/, roles: ['admin', 'directora'] },
  { prefix: /^\/teacher(\/.*)?$/, roles: ['profe', 'admin', 'directora'] },
  { prefix: /^\/family(\/.*)?$/, roles: ['tutor_legal', 'autorizado'] },
]

/**
 * Devuelve los roles permitidos para una pathname (sin prefijo de locale).
 * `null` si la ruta no está en `PROTECTED_PREFIXES` (rutas públicas o
 * espacios no enumerados — el proxy las trata como "no protegidas").
 */
export function requiredRolesFor(rest: string): ReadonlyArray<string> | null {
  for (const { prefix, roles } of PROTECTED_PREFIXES) {
    if (prefix.test(rest)) return roles
  }
  return null
}
