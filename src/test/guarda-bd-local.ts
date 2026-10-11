/**
 * Guarda de la suite RLS: solo corre contra una BD LOCAL.
 *
 * La suite siembra fixtures (`@nido.test`) y su teardown no lo recoge todo: corriendo contra
 * producción dejó en `audit_log` 28.331 filas con `centro_id` NULL y 8 centros de test en 94
 * noches. Desde aquí, la suite aborta ANTES de escribir nada si `NEXT_PUBLIC_SUPABASE_URL` no
 * apunta a la máquina (la BD efímera de `supabase start`: `http://127.0.0.1:54321`).
 *
 * Salida de emergencia, explícita y ruidosa: `RLS_ALLOW_REMOTE=1` puesto a mano.
 *
 * Sin dependencias ni efectos al importar: la usan `global-setup.ts` y `setup.ts` (proyecto
 * `rls`) y su test corre en el proyecto `unit`, sin BD.
 */

const HOSTS_LOCALES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** ¿La URL apunta a esta máquina? Una URL vacía o mal formada NO es local. */
export function esUrlLocal(url: string | undefined): boolean {
  if (!url) return false
  try {
    return HOSTS_LOCALES.has(new URL(url).hostname)
  } catch {
    return false
  }
}

export type ResultadoGuarda = 'local' | 'remoto-permitido'

/**
 * Lanza si la suite iba a correr contra una BD que no es local, salvo `RLS_ALLOW_REMOTE=1`.
 * Con la salida de emergencia puesta avisa a gritos y deja pasar.
 */
export function comprobarBdLocal(
  env: Record<string, string | undefined> = process.env,
  avisar: (mensaje: string) => void = (m) => console.warn(m)
): ResultadoGuarda {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  if (esUrlLocal(url)) return 'local'

  const destino = url ? url : '(NEXT_PUBLIC_SUPABASE_URL vacía)'
  if (env.RLS_ALLOW_REMOTE === '1') {
    avisar(
      [
        '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
        `!!! RLS_ALLOW_REMOTE=1: la suite RLS va a escribir fixtures en ${destino}`,
        '!!! La guarda de BD local está DESACTIVADA a mano. Si no es lo que querías, corta ya.',
        '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      ].join('\n')
    )
    return 'remoto-permitido'
  }

  throw new Error(
    `la suite RLS solo corre contra BD local; apuntabas a ${destino}. ` +
      'Levanta la BD efímera (`supabase start`) y exporta sus claves (`supabase status -o env`), ' +
      'como hace rls-local.yml. Para saltarte esta guarda a propósito: RLS_ALLOW_REMOTE=1.'
  )
}
