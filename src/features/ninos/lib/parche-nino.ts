import { normalizarDni, textoONull } from '@/features/cambios-pendientes/lib/diff'
import type { TablesUpdate } from '@/types/database'

import type { ActualizarNinoTutorInput } from '../schemas/nino'

/**
 * Lo que escribe la Dirección en la ficha del niño desde el paso del menor (fase 5b), con su
 * sesión (`ninos_admin_all`). Es la misma regla que aplica `actualizar_identidad_nino_tutor` a la
 * tutora: NULL (o ausente) deja lo que hay, vacío lo borra, el DNI sin espacios, puntos ni guiones
 * y en mayúsculas, los apellidos en pareja y el texto de «otro» solo con «otro». Si las dos vías
 * escribieran distinto, el mismo formulario guardaría cosas distintas según quién lo rellena.
 * Función pura: se prueba sola contra la tabla de la función de la base.
 */
export function parcheNinoDireccion(d: ActualizarNinoTutorInput): TablesUpdate<'ninos'> {
  const p: TablesUpdate<'ninos'> = {
    nombre: d.nombre,
    primer_apellido: d.primer_apellido.trim(),
    segundo_apellido: textoONull(d.segundo_apellido ?? ''),
    fecha_nacimiento: d.fecha_nacimiento,
    nacionalidad: d.nacionalidad.trim(),
    idioma_principal: d.idioma_principal,
    lugar_nacimiento: textoONull(d.lugar_nacimiento),
    hermanos_total: d.hermanos_total,
    hermanos_lugar: d.hermanos_lugar,
  }
  // Como en la función: el sexo NULL es «preservar», no «borrar».
  if (d.sexo != null) p.sexo = d.sexo
  if (d.dni != null) p.dni = normalizarDni(d.dni)
  if (d.observaciones_familia != null) p.observaciones_familia = textoONull(d.observaciones_familia)
  if (d.como_nos_conocio != null) {
    const como = textoONull(d.como_nos_conocio)
    p.como_nos_conocio = como
    p.como_nos_conocio_otro = como === 'otro' ? textoONull(d.como_nos_conocio_otro ?? '') : null
  }
  return p
}
