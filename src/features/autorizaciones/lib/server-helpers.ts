import 'server-only'

import { revalidatePath } from 'next/cache'

/** Fecha de hoy en huso Europe/Madrid como 'YYYY-MM-DD' (mismo criterio que el
 *  helper SQL `hoy_madrid()` y el resto de páginas). Para la vigencia por defecto. */
export function hoyMadridYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Revalida las vistas de autorizaciones (admin + familia) tras una mutación. */
export function revalidarAutorizaciones(): void {
  revalidatePath('/[locale]/admin/autorizaciones', 'page')
  revalidatePath('/[locale]/admin/autorizaciones/[id]', 'page')
  revalidatePath('/[locale]/family/autorizaciones', 'page')
  revalidatePath('/[locale]/family/autorizaciones/[id]', 'page')
}
