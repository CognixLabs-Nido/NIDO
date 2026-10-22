/**
 * La clave de i18n de un error de `platform_crear_centro` o `platform_invitar_admin`. La BD es la
 * puerta (su primera sentencia es `is_superadmin`) y dice por qué con el código y el HINT; aquí
 * solo se traduce. Un error que no es de los previstos se nombra por su síntoma.
 */
export function errorDePlataforma(error: { code?: string; hint?: string | null }): string {
  switch (error.code) {
    case '42501':
      return 'plataforma.errores.no_autorizado'
    case '23505':
      return 'plataforma.errores.nombre_duplicado'
    case '55000':
      return 'plataforma.errores.centro_con_admin'
    case '22023':
      return error.hint === 'email_admin'
        ? 'plataforma.errores.email_admin'
        : 'plataforma.errores.datos_invalidos'
    case '23514':
      return 'plataforma.errores.datos_invalidos'
    case 'P0002':
      return error.hint === 'sin_invitacion'
        ? 'plataforma.errores.sin_invitacion'
        : 'plataforma.errores.centro_no_existe'
    default:
      return 'plataforma.errores.fallo'
  }
}
