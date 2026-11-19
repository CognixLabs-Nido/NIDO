import { comoPostgres } from './documentos-centro-fixture'
import { serviceClient } from './setup'

/**
 * Desde la 10b-3 (`20270130120000`) `marcar_matricula_lista` exige, después de todo lo de antes, el
 * libro de familia, una firma de la ficha que valga y la respuesta de imagen del tutor de esa firma.
 *
 * Los tests que miden OTRA puerta del cierre (el acuse médico, los documentos, los datos del niño o de
 * los tutores, los servicios, los gastos) llaman a esto justo antes de su «el alta se cierra», para
 * que lo nuevo no tape lo que miden. La firma la mete postgres, sin pasar por `firmar_ficha`: aquí no se
 * mide la firma (eso es `ficha-firmada*.rls.test.ts` y `ficha-puertas.rls.test.ts`), y firmar cerraría
 * el alta antes de la llamada que el test quiere hacer. Va lo último: la firma sella los datos de ese
 * momento, y un cambio después la invalidaría (`privado.firma_ficha_vigente`).
 *
 * Solo contra la base efímera: `comoPostgres` no corre contra otra cosa.
 */
export async function dejarListaParaCerrar(ninoId: string, tutorId: string): Promise<void> {
  const { data: nino, error } = await serviceClient
    .from('ninos')
    .select('centro_id, libro_familia_path')
    .eq('id', ninoId)
    .single()
  if (error || !nino) throw new Error(`dejarListaParaCerrar: niño (${error?.message})`)
  if (!nino.libro_familia_path) {
    const libro = await serviceClient
      .from('ninos')
      .update({ libro_familia_path: `${nino.centro_id}/${ninoId}/libro-demo.pdf` })
      .eq('id', ninoId)
    if (libro.error) throw new Error(`dejarListaParaCerrar: libro (${libro.error.message})`)
  }
  const respuesta = comoPostgres(
    `SELECT coalesce(privado.respuesta_imagen('${tutorId}', '${ninoId}'), '-')`
  )
  if (respuesta === '-') {
    const si = await serviceClient.from('consentimientos').insert({
      usuario_id: tutorId,
      tipo: 'imagen',
      version: 'v1.0',
      metodo_firma: 'checkbox',
      nino_id: ninoId,
    })
    if (si.error) throw new Error(`dejarListaParaCerrar: imagen (${si.error.message})`)
  }
  firmarFichaDeFixture(ninoId, tutorId)
}

/**
 * Una firma de la ficha que vale, del tutor legal `tutorId`, metida por postgres (ver arriba por qué).
 * Para los tests de `validar_alta`, que desde la 10b-3 exige una firma que valga y no miden la firma.
 */
export function firmarFichaDeFixture(ninoId: string, tutorId: string): void {
  comoPostgres(
    `INSERT INTO public.firmas_ficha
       (nino_id, firmante_id, rol_firmante, metodo_firma, nombre_tecleado, firma_imagen, ficha_version,
        plantilla_pdf_version, contenido_cifrado, contenido_sha256)
     SELECT '${ninoId}', '${tutorId}', v.tipo_vinculo, 'digital', 'Firma Demo', 'data:image/png;base64,iVBORw0KGgo=',
            1, 1, '\\x00'::bytea, privado.ficha_hash(privado.ficha_canonica('${ninoId}', 1))
       FROM public.vinculos_familiares v
      WHERE v.nino_id = '${ninoId}' AND v.usuario_id = '${tutorId}' AND v.deleted_at IS NULL
        AND v.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
      LIMIT 1`
  )
  const vale = comoPostgres(`SELECT (privado.firma_ficha_vigente('${ninoId}') IS NOT NULL)::text`)
  if (vale !== 'true')
    throw new Error('firmarFichaDeFixture: la firma no vale (¿el tutor no es tutor legal?)')
}
