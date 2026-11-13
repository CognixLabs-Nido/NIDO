/**
 * El documento de identidad del titular del mandato SEPA (0c-2). Funciones PURAS: las usan el
 * formulario en cliente y las rutas y la acción en servidor.
 *
 * Decisión del responsable (2026-11-04, opción a): el campo es «NIF o documento de identidad» y
 * admite cualquier documento del titular. Solo se comprueba el dígito de control cuando tiene forma
 * española (DNI, NIE o CIF); un titular con documento extranjero (la app acepta IBAN de 15 países)
 * puede domiciliar. La base no le pone formato: 1 a 40 caracteres (`mandatos_sepa.titular_documento`).
 */

export const MAX_LARGO_DOCUMENTO = 40

export type FormaDocumento = 'dni' | 'nie' | 'cif' | 'otro'

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE'
const RE_DNI = /^\d{8}[A-Z]$/
const RE_NIE = /^[XYZ]\d{7}[A-Z]$/
const RE_CIF = /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/

/** Sin espacios, puntos ni guiones y en mayúsculas: solo para reconocer la forma y comprobarla. */
export function normalizarDocumento(raw: string): string {
  return raw.replace(/[\s.-]/g, '').toUpperCase()
}

export function formaDocumento(raw: string): FormaDocumento {
  const n = normalizarDocumento(raw)
  if (RE_DNI.test(n)) return 'dni'
  if (RE_NIE.test(n)) return 'nie'
  if (RE_CIF.test(n)) return 'cif'
  return 'otro'
}

function letraDni(numero: string): string {
  return LETRAS_DNI[Number(numero) % 23]!
}

function controlCif(n: string): boolean {
  const d = n.slice(1, 8).split('').map(Number)
  const pares = d[1]! + d[3]! + d[5]!
  const impares = [d[0]!, d[2]!, d[4]!, d[6]!]
    .map((x) => {
      const doble = x * 2
      return Math.floor(doble / 10) + (doble % 10)
    })
    .reduce((a, b) => a + b, 0)
  const digito = (10 - ((pares + impares) % 10)) % 10
  const letra = 'JABCDEFGHI'[digito]!
  const control = n[8]!
  const tipo = n[0]!
  // Las entidades sin ánimo de lucro, la administración y las extranjeras llevan letra; las
  // sociedades anónimas y limitadas y las comunidades de bienes y herencias, número.
  if ('PQRSNW'.includes(tipo)) return control === letra
  if ('ABEH'.includes(tipo)) return control === String(digito)
  return control === letra || control === String(digito)
}

/**
 * Válido si tiene de 1 a 40 caracteres y, cuando su forma es española, el dígito de control
 * cuadra. Un documento con otra forma (un pasaporte, un documento extranjero) se acepta tal cual.
 */
export function documentoValido(raw: string): boolean {
  const t = raw.trim()
  if (t.length < 1 || t.length > MAX_LARGO_DOCUMENTO) return false
  const n = normalizarDocumento(t)
  switch (formaDocumento(t)) {
    case 'dni':
      return n[8] === letraDni(n.slice(0, 8))
    case 'nie':
      return n[8] === letraDni(String('XYZ'.indexOf(n[0]!)) + n.slice(1, 8))
    case 'cif':
      return controlCif(n)
    case 'otro':
      return /[A-Z0-9]/.test(n)
  }
}

/**
 * El documento del NIÑO (fase 5): solo DNI o NIE, con su letra. Es la regla de la base
 * (`privado.dni_nie_valido`, CHECK `ninos_dni_valido`): un pasaporte o un CIF no valen aquí.
 */
export function dniNieValido(raw: string): boolean {
  const forma = formaDocumento(raw)
  return (forma === 'dni' || forma === 'nie') && documentoValido(raw)
}

/**
 * El documento del TUTOR (fase 6, `privado.documento_tutor_valido`): cualquier documento de 1 a 40
 * caracteres; la letra solo se comprueba cuando tiene forma de DNI o NIE. Un pasaporte o un documento
 * extranjero se acepta tal cual: un campo obligatorio que no admite el documento de una familia real
 * es un alta que no se puede cerrar.
 */
export function documentoTutorValido(raw: string): boolean {
  const t = raw.trim()
  if (t.length < 1 || t.length > MAX_LARGO_DOCUMENTO) return false
  const forma = formaDocumento(t)
  return forma === 'dni' || forma === 'nie' ? documentoValido(t) : true
}
