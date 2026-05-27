/**
 * Convierte una clave VAPID pública en base64url (la que viene de
 * `web-push generate-vapid-keys`) a `Uint8Array`, formato que requiere
 * `pushManager.subscribe({ applicationServerKey })`.
 *
 * Esta utilidad vive aquí, no en el componente, para poder testearla
 * sin montar nada de React.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

  const rawData =
    typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary')

  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/**
 * Convierte un ArrayBuffer (los `key` que devuelve `PushSubscription.getKey()`)
 * a base64url estándar — el formato que esperan los servidores web push
 * (RFC 8291). Se usa al persistir la suscripción en BD.
 */
export function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const b64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
