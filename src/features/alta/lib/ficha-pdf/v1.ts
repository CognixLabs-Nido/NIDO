import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

import type { CopiaFichaFirmada } from './tipos'

/**
 * La PLANTILLA 1 del PDF de la ficha firmada (fase 10c; spec `docs/specs/altas-serie.md`, «10c: el
 * encargo, lo medido abierto y la condición de la (C)»). La firma guarda con qué versión se firmó
 * (`firmas_ficha.plantilla_pdf_version`), y con esa versión se tiene que componer SIEMPRE el mismo
 * documento: «Si no, dentro de un año alguien toca el generador y el PDF que se descargue una familia
 * ya no será el que firmó» (el responsable, 2026-11-17).
 *
 * Por eso este fichero NO SE TOCA. Si el documento tiene que cambiar, se escribe una `v2.ts`, se
 * registra en `index.ts` y la base firma con la 2 (`privado.ficha_plantilla_pdf_version`); las firmas
 * de la 1 se siguen componiendo con esto. El test dorado (`__tests__/v1.test.ts`) compara el sha256
 * de lo que compone con el escrito: un byte distinto lo pone rojo.
 *
 * Y no lee NADA vivo, porque lo vivo cambia sin que nadie toque este fichero: ni las traducciones,
 * ni `Intl` ni `toLocale*` (dependen de la ICU de Node), ni el nombre o el logo del centro, ni los
 * helpers de `src/shared/lib/pdf` (los cambian otros documentos). Solo `pdf-lib`, con la fecha de los
 * metadatos apagada (`updateMetadata: false`: con ella, dos composiciones dan bytes distintos; medido
 * el 2026-11-19). Los textos, en castellano y aquí. Las fechas, a mano y en UTC.
 */

const A4: [number, number] = [595.28, 841.89]
const MARGEN = 56
const ANCHO = A4[0] - MARGEN * 2
const NEGRO = rgb(0.12, 0.12, 0.14)
const GRIS = rgb(0.4, 0.4, 0.44)
const RAYA = rgb(0.82, 0.82, 0.85)

const ROTULOS: Record<string, string> = {
  nombre: 'Nombre',
  primer_apellido: 'Primer apellido',
  segundo_apellido: 'Segundo apellido',
  fecha_nacimiento: 'Fecha de nacimiento',
  sexo: 'Sexo',
  lugar_nacimiento: 'Lugar de nacimiento',
  nacionalidad: 'Nacionalidad',
  idioma_principal: 'Idioma principal',
  dni: 'DNI',
  sip: 'Tarjeta sanitaria (SIP)',
  direccion_calle: 'Calle',
  direccion_numero: 'Número',
  direccion_cp: 'Código postal',
  direccion_ciudad: 'Ciudad',
  direccion_provincia: 'Provincia',
  estado_civil_familia: 'Estado civil de la familia',
  hermanos_total: 'Hermanos (total)',
  hermanos_lugar: 'Lugar entre los hermanos',
  observaciones_familia: 'Observaciones de la familia',
  como_nos_conocio: 'Cómo nos conoció',
  como_nos_conocio_otro: 'Cómo nos conoció (otro)',
  rol_familia: 'En la familia',
  nombre_completo: 'Nombre completo',
  email: 'Correo electrónico',
  telefono: 'Teléfono',
  dni_numero: 'DNI',
  estudios: 'Estudios',
  empresa: 'Empresa',
  lactancia_estado: 'Lactancia',
  lactancia_observaciones: 'Lactancia: observaciones',
  control_esfinteres: 'Control de esfínteres',
  control_esfinteres_observaciones: 'Control de esfínteres: observaciones',
  siesta_horario_habitual: 'Siesta: horario habitual',
  siesta_numero_diario: 'Siestas al día',
  siesta_observaciones: 'Siesta: observaciones',
  tipo_alimentacion: 'Alimentación',
  alimentacion_observaciones: 'Alimentación: observaciones',
  idiomas_casa: 'Idiomas en casa',
  tiene_hermanos_en_centro: 'Hermanos en el centro',
  servicio: 'Servicio',
  respuesta: 'Respuesta',
  concepto_id: 'Concepto',
  curso_academico_id: 'Curso (identificador)',
  forma: 'Forma',
  con_justificante: 'Con justificante',
  aceptado_en: 'Dada el',
  alergias_graves: 'Alergias graves',
  notas_emergencia: 'Notas de emergencia',
  medicacion_habitual: 'Medicación habitual',
  alergias_leves: 'Alergias leves',
  medico_familia: 'Médico de familia',
  telefono_emergencia: 'Teléfono de emergencia',
}

/**
 * Los códigos de la base, con su rótulo en castellano: COPIADOS el 2026-11-19 de `messages/es.json`
 * (sexo, estado civil, cómo nos conoció, idiomas, papel en la familia, lo pedagógico, servicios y forma de
 * los gastos). Copiados y no leídos: si mañana cambia un texto de la app, esta plantilla no se entera.
 * Un código que no esté aquí sale tal cual.
 */
const CODIGOS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  sexo: {
    F: 'Femenino',
    M: 'Masculino',
    X: 'No binario / otro',
    no_contesta: 'Prefiero no decirlo',
  },
  estado_civil_familia: {
    casados: 'Casados',
    separados: 'Separados',
    divorciados: 'Divorciados',
    pareja_de_hecho: 'Pareja de hecho',
    soltero: 'Soltero/a',
    viudo: 'Viudo/a',
  },
  como_nos_conocio: {
    internet: 'Por internet',
    redes_sociales: 'Por redes sociales',
    recomendacion: 'Por recomendación',
    paso_por_delante: 'Paso por delante',
    otro: 'Otro',
  },
  idioma_principal: {
    es: 'Español',
    en: 'Inglés',
    va: 'Valenciano',
  },
  idiomas_casa: {
    es: 'Español',
    en: 'Inglés',
    va: 'Valenciano',
  },
  rol_familia: {
    titular: 'Titular',
    segundo_tutor: 'Segundo tutor',
  },
  lactancia_estado: {
    materna: 'Lactancia materna',
    biberon: 'Biberón',
    mixta: 'Mixta',
    finalizada: 'Finalizada',
    no_aplica: 'No aplica',
  },
  control_esfinteres: {
    panal_completo: 'Con pañal',
    transicion: 'En transición',
    sin_panal_diurno: 'Sin pañal de día',
    sin_panal_total: 'Sin pañal',
  },
  tipo_alimentacion: {
    omnivora: 'Estándar / sin restricciones',
    vegetariana: 'Vegetariana',
    vegana: 'Vegana',
    sin_lactosa: 'Sin lactosa',
    sin_gluten: 'Sin gluten',
    otra: 'Otra',
  },
  servicio: {
    comedor: 'Comedor',
    matinera: 'Matinera',
    vespertina: 'Tarde',
  },
  forma: {
    transferencia: 'Transferencia',
    efectivo: 'Efectivo',
  },
}

/** Los campos de cada bloque de la ficha de la versión 1, en el orden en que se enseñan. */
const CAMPOS_NINO = [
  'nombre',
  'primer_apellido',
  'segundo_apellido',
  'fecha_nacimiento',
  'sexo',
  'lugar_nacimiento',
  'nacionalidad',
  'idioma_principal',
  'dni',
  'sip',
  'direccion_calle',
  'direccion_numero',
  'direccion_cp',
  'direccion_ciudad',
  'direccion_provincia',
  'estado_civil_familia',
  'hermanos_total',
  'hermanos_lugar',
  'observaciones_familia',
  'como_nos_conocio',
  'como_nos_conocio_otro',
]
const CAMPOS_TUTOR = [
  'rol_familia',
  'nombre_completo',
  'email',
  'telefono',
  'fecha_nacimiento',
  'dni_numero',
  'direccion_calle',
  'direccion_numero',
  'direccion_cp',
  'direccion_ciudad',
  'estudios',
  'empresa',
]
const CAMPOS_PEDAGOGICOS = [
  'lactancia_estado',
  'lactancia_observaciones',
  'control_esfinteres',
  'control_esfinteres_observaciones',
  'siesta_horario_habitual',
  'siesta_numero_diario',
  'siesta_observaciones',
  'tipo_alimentacion',
  'alimentacion_observaciones',
  'idiomas_casa',
  'tiene_hermanos_en_centro',
]
const CAMPOS_SERVICIO = ['servicio', 'respuesta', 'concepto_id']
const CAMPOS_GASTOS = ['curso_academico_id', 'forma', 'con_justificante']
const CAMPOS_MEDICO = [
  'alergias_graves',
  'alergias_leves',
  'medicacion_habitual',
  'notas_emergencia',
  'medico_familia',
  'telefono_emergencia',
]

const dos = (n: number) => String(n).padStart(2, '0')

/** Una fecha (`AAAA-MM-DD`) o un instante ISO, a mano: `DD/MM/AAAA` o `DD/MM/AAAA HH:MM UTC`. */
function fecha(v: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (d) return `${d[3]}/${d[2]}/${d[1]}`
  const t = new Date(v)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(t.getTime())) return v
  return `${dos(t.getUTCDate())}/${dos(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${dos(t.getUTCHours())}:${dos(t.getUTCMinutes())} UTC`
}

function valor(v: unknown, campo = ''): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (Array.isArray(v)) return v.length ? v.map((x) => valor(x, campo)).join(', ') : '—'
  if (typeof v === 'string' && CODIGOS[campo]?.[v]) return CODIGOS[campo][v]
  if (typeof v === 'string') return v === 'si' ? 'Sí' : v === 'no' ? 'No' : fecha(v)
  if (typeof v === 'number') return String(v)
  return JSON.stringify(v)
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : [])

/** Lo que la fuente estándar (WinAnsi) no codifica sale como «?». */
function limpio(texto: string, font: PDFFont): string {
  let out = ''
  for (const ch of texto) {
    try {
      font.widthOfTextAtSize(ch, 10)
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

function partir(texto: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = []
  let linea = ''
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = linea ? `${linea} ${palabra}` : palabra
    if (font.widthOfTextAtSize(prueba, size) <= max) {
      linea = prueba
      continue
    }
    if (linea) out.push(linea)
    linea = ''
    let trozo = ''
    for (const ch of palabra) {
      if (font.widthOfTextAtSize(trozo + ch, size) <= max) trozo += ch
      else {
        out.push(trozo)
        trozo = ch
      }
    }
    linea = trozo
  }
  if (linea || out.length === 0) out.push(linea)
  return out
}

export async function componerFichaFirmadaV1(c: CopiaFichaFirmada): Promise<Uint8Array> {
  if (c.fichaVersion !== 1)
    throw new Error(`la plantilla 1 no sabe componer la ficha ${c.fichaVersion}`)

  const doc = await PDFDocument.create({ updateMetadata: false })
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold)
  let pagina: PDFPage = doc.addPage(A4)
  let y = A4[1] - MARGEN
  let n = 1

  const pie = () =>
    pagina.drawText(
      limpio(`Ficha del alta firmada · sello ${c.contenidoSha256} · página ${n}`, normal),
      {
        x: MARGEN,
        y: MARGEN / 2,
        size: 7,
        font: normal,
        color: GRIS,
      }
    )
  const sitio = (alto: number) => {
    if (y - alto >= MARGEN) return
    pie()
    pagina = doc.addPage(A4)
    n += 1
    y = A4[1] - MARGEN
  }
  const texto = (
    t: string,
    size: number,
    font: PDFFont,
    color = NEGRO,
    x = MARGEN,
    ancho = ANCHO
  ) => {
    for (const l of partir(limpio(t, font), font, size, ancho)) {
      sitio(size + 4)
      pagina.drawText(l, { x, y: y - size, size, font, color })
      y -= size + 4
    }
  }
  const titulo = (t: string) => {
    sitio(40)
    y -= 10
    texto(t, 12, negrita)
    pagina.drawLine({
      start: { x: MARGEN, y: y + 1 },
      end: { x: A4[0] - MARGEN, y: y + 1 },
      thickness: 0.5,
      color: RAYA,
    })
    y -= 4
  }
  const filaLibre = (rotulo: string, v: string) => {
    const lineas = partir(limpio(v, normal), normal, 9, ANCHO - 170)
    sitio(13)
    pagina.drawText(limpio(rotulo, normal), {
      x: MARGEN,
      y: y - 9,
      size: 9,
      font: normal,
      color: GRIS,
    })
    for (const l of lineas) {
      sitio(13)
      pagina.drawText(l, { x: MARGEN + 170, y: y - 9, size: 9, font: normal, color: NEGRO })
      y -= 13
    }
  }
  const fila = (clave: string, v: unknown) => filaLibre(ROTULOS[clave] ?? clave, valor(v, clave))
  const bloque = (o: Record<string, unknown>, campos: string[]) =>
    campos.forEach((k) => fila(k, o[k]))
  const varios = (items: Record<string, unknown>[], campos: string[], vacio: string) => {
    if (items.length === 0) return texto(vacio, 9, normal, GRIS)
    items.forEach((it, i) => {
      if (i > 0) y -= 6
      bloque(it, campos)
    })
  }

  const f = c.ficha
  texto('Ficha del alta firmada', 18, negrita)
  y -= 4
  texto(
    'Copia de lo que se firmó, con los datos tal como estaban en el momento de la firma. Se compone desde la copia guardada en la firma, que da el sello de abajo.',
    9,
    normal,
    GRIS
  )

  titulo('La firma')
  filaLibre('Firmada el', fecha(c.firmadoAt))
  const metodo =
    c.metodoFirma === 'presencial'
      ? 'En papel, registrada por Dirección del centro'
      : 'Con el dedo, en la app'
  filaLibre('Cómo', metodo)
  filaLibre('Nombre escrito', c.nombreTecleado)
  filaLibre('Versión de la ficha', String(c.fichaVersion))
  filaLibre('Versión de esta plantilla', String(c.plantillaPdfVersion))
  filaLibre('Sello (sha256)', c.contenidoSha256)
  if (c.firmaImagen) {
    const png = /^data:image\/png;base64,(.+)$/.exec(c.firmaImagen)
    let dibujada = false
    if (png) {
      try {
        const img = await doc.embedPng(png[1])
        const escala = Math.min(1, 180 / img.width, 60 / img.height)
        sitio(img.height * escala + 8)
        pagina.drawImage(img, {
          x: MARGEN + 170,
          y: y - img.height * escala,
          width: img.width * escala,
          height: img.height * escala,
        })
        pagina.drawText('Trazo', { x: MARGEN, y: y - 9, size: 9, font: normal, color: GRIS })
        y -= img.height * escala + 8
        dibujada = true
      } catch {
        dibujada = false
      }
    }
    if (!dibujada) filaLibre('Trazo', 'guardado, pero no se puede dibujar')
  }

  titulo('El niño o la niña')
  bloque(obj(f.nino), CAMPOS_NINO)
  titulo('Los tutores')
  varios(lista(f.tutores), CAMPOS_TUTOR, 'Ninguno.')
  titulo('Datos pedagógicos')
  bloque(obj(f.pedagogicos), CAMPOS_PEDAGOGICOS)
  titulo('Servicios pedidos')
  varios(lista(f.servicios), CAMPOS_SERVICIO, 'Ninguno.')
  titulo('Gastos de gestión')
  varios(lista(f.gastos_gestion), CAMPOS_GASTOS, 'Ninguno.')
  titulo('Ficha médica')
  bloque(obj(f.medico), CAMPOS_MEDICO)
  titulo('Imagen (no forma parte del sello: se puede retirar en cualquier momento)')
  varios(
    lista(f.imagen),
    ['respuesta', 'aceptado_en'],
    'Ninguna respuesta en el momento de la firma.'
  )

  pie()
  return doc.save({ useObjectStreams: false })
}
