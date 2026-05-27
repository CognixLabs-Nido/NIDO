export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

/** Fila de `push_subscriptions`. Definido localmente para no depender de la
 *  regeneración de `src/types/database.ts` antes de que la migración esté
 *  aplicada en el remoto. Tras `npm run db:types` post-migración se puede
 *  reemplazar por `Database['public']['Tables']['push_subscriptions']['Row']`
 *  si se quiere uniformidad — el shape es idéntico. */
export interface PushSubscriptionRow {
  id: string
  usuario_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  updated_at: string
  last_active_at: string
}

/** Payload normalizado que el helper `enviarPushANotificarUsuarios` acepta y
 *  que el service worker en `public/sw.js` consume al recibir el evento `push`.
 *
 *  No incluye PII en `titulo` y `cuerpo` más allá del nombre del autor; los
 *  identificadores de la entidad (conversación, anuncio) van en `datos` para
 *  que el service worker sepa a dónde navegar al hacer click. */
export interface PushPayload {
  titulo: string
  cuerpo: string
  /** URL relativa para abrir al hacer click en la notificación
   *  (incluye `locale`: `/{locale}/messages/...`). */
  url: string
  /** Datos extra opcionales que el service worker puede usar para agrupar
   *  por `tag` o decidir el comportamiento al hacer click. */
  datos?: Record<string, string>
}
