// A dónde sale la pantalla "¡Alta completada!". Decisión pura: la pantalla se pinta en un
// Server Component y el destino depende de QUIÉN completó el alta, que la ruta ya sabe
// (`resolverEntradaAlta` → modo Dirección o entrada de tutor). Aislarlo aquí lo hace
// testeable y evita que el enlace y la clave del texto se elijan en sitios distintos.

/** Destino y etiqueta del enlace de salida, para que no puedan desalinearse. */
export interface SalidaAlta {
  href: string
  /** Clave i18n bajo `alta.completado`. */
  claveEtiqueta: 'volver_admisiones' | 'volver_familia'
}

/**
 * Sin esta salida, la pantalla era un callejón: solo ofrecía "Revisar o editar", que
 * reentra al mismo wizard. La directora se quedaba dentro del alta de una familia sin
 * forma de volver a su lista, y la única puerta era cerrar sesión.
 *
 * · DIRECCIÓN (`modoDireccion`) vuelve a **admisiones**, que es literalmente de donde vino:
 *   el wizard se abre desde `ListaEsperaPanel` en `/admin/admisiones`.
 * · TUTOR vuelve a **su panel de familia**, el mismo destino al que la ruta ya le manda
 *   cuando la matrícula pasa a `activa`. No se le ofrece admisiones: no es suya.
 */
export function resolverSalidaAlta(modoDireccion: boolean, locale: string): SalidaAlta {
  return modoDireccion
    ? { href: `/${locale}/admin/admisiones`, claveEtiqueta: 'volver_admisiones' }
    : { href: `/${locale}/family`, claveEtiqueta: 'volver_familia' }
}
