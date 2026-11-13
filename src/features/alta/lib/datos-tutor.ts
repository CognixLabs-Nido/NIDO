/**
 * Fase 6 (`20270118120000`): el teléfono y la fecha de nacimiento del tutor. Funciones PURAS, espejo de
 * la base (`privado.normalizar_telefono`, CHECK `familia_tutores_telefono_formato` y el rango de
 * `guardar_tutor`): las usan el formulario y la acción, y la base lo vuelve a comprobar.
 */

/** Sin espacios, puntos, guiones ni paréntesis, y el 00 de delante como +. Vacío → null. */
export function normalizarTelefono(raw: string): string | null {
  const n = raw.replace(/[\s.()-]/g, '').replace(/^00/, '+')
  return n === '' ? null : n
}

/** De 6 a 15 cifras con o sin +: un número de cualquier país, también uno español sin prefijo. */
export function telefonoValido(raw: string): boolean {
  const n = normalizarTelefono(raw)
  return n !== null && /^\+?[0-9]{6,15}$/.test(n)
}

/**
 * En el pasado y de hace menos de 120 años (un 1850 tecleado mal). Sin mayoría de edad: un padre o una
 * madre menor existe, y bloquear ese alta sería el mismo error por el otro lado. `hoy` en AAAA-MM-DD.
 */
export function fechaNacimientoTutorValida(fecha: string, hoy: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) return false
  const tope = `${Number(hoy.slice(0, 4)) - 120}${hoy.slice(4)}`
  return fecha < hoy && fecha >= tope
}

/** Lo que el cierre del alta mira de un tutor. */
export interface TutorParaCierre {
  nombre_completo: string | null
  email: string | null
  telefono: string | null
  fecha_nacimiento: string | null
  dni_numero: string | null
  dni_documento_path: string | null
  direccion_calle: string | null
  direccion_cp: string | null
  direccion_ciudad: string | null
}

const lleno = (v: string | null) => Boolean(v?.trim())

/**
 * Espejo de `privado.tutor_completo` (`20270118120000`), que es lo que frena `marcar_matricula_lista`
 * (HINT `datos_tutor_por_completar`): D12, D14, D15 y el número del DNI. El número de la calle no
 * («s/n»), ni los estudios ni la empresa. `conPdf: false` deja fuera el PDF del DNI, que el gate de la
 * app cuenta en su bloque de documentos.
 */
export function tutorCompleto(t: TutorParaCierre, { conPdf = true } = {}): boolean {
  return (
    lleno(t.nombre_completo) &&
    lleno(t.email) &&
    t.telefono !== null &&
    t.fecha_nacimiento !== null &&
    lleno(t.dni_numero) &&
    (!conPdf || t.dni_documento_path !== null) &&
    lleno(t.direccion_calle) &&
    lleno(t.direccion_cp) &&
    lleno(t.direccion_ciudad)
  )
}
