/**
 * La ruta que pidió el navegador (ruta y query), para volver a ella tras elegir centro.
 *
 * Un layout o una página no saben qué dirección se abrió, y quien tiene varios centros sin
 * ninguno elegido acaba en el selector. Sin la vuelta, la notificación que abrió `/messages?…`
 * terminaba en su inicio. El proxy la escribe en esta cabecera de petición (siempre: pisa la que
 * mande el navegador) y `requireContextoCentro` la usa como `returnTo` cuando no le pasan otra.
 * No es una autorización: el selector la valida como ruta interna (`rutaDeVuelta`).
 */
export const CABECERA_RUTA_PEDIDA = 'x-nido-ruta-pedida'
