# ADR-0054: Consentimiento de imagen por niño como única fuente de verdad (serie IU)

## Estado

`accepted`. Las decisiones se tomaron y se aplicaron entre el 2026-07-27 y el 2026-10-02; este ADR
las documenta después, el 2026-10-10.

**Fecha:** 2026-07-27 (#254) → 2026-10-02 (#286)
**Autores:** responsable + claude-code
**Fase del proyecto:** serie IU (IU-0 a IU-5), después de F12-B, más los arreglos #284–#286.

## Contexto

En F10 `ninos.puede_aparecer_en_fotos` era un interruptor que ponía Dirección a mano, y es lo que
lee la RLS del blog: `nino_puede_aparecer` gatea el etiquetado (`media_etiquetas_insert`) y
`publicacion_tiene_nino_sin_permiso` oculta a la familia las publicaciones con un niño sin permiso
(ADR-0045). F11-A3 añadió una segunda vía, la firma del documento de imagen
(`20260614120000_phase11a3_imagen_firmable`), y el alta de #237 una tercera, la casilla de imagen,
que escribía un acuse en `acuses_alta`.

En julio de 2026 se vio un niño con el flag a `true` sin ninguna autorización real (#254). La causa:
el flag, el acuse y la firma eran **tres fuentes que podían divergir**, y el flag solo lo movía el
toggle manual de Dirección (`setPuedeAparecerEnFotos`). Además:

- `consentimientos` era **por usuario**: no tenía `nino_id`. Un tutor con dos hijos no podía
  autorizar a uno y no al otro, y revocar a uno revocaba a los dos (`20260821130000`).
- La foto de perfil (`ninos.foto_url`, bucket `ninos-fotos`) no comprobaba el consentimiento en
  ninguna capa (`20260821170000`).
- `ninos_admin_all` (FOR ALL) dejaba a un admin escribir el flag por API directa
  (`20260821150000`).

## Opciones consideradas

### Opción A: mantener el interruptor manual

Dirección sigue poniendo el flag a mano y el acuse y la firma quedan como constancia.

**Pros:** no hay que tocar nada.

**Contras:** es justo lo que produjo el descuadre. El flag no refleja ningún consentimiento y nada
impide ponerlo a `true` sin él.

### Opción B: derivar el flag de las firmas

Es lo que hacía F11-A3: `imagen_consentida` calcula el flag desde `firmas_autorizacion`.

**Pros:** ya existía y respetaba `requiere_ambos_firmantes`.

**Contras:**

- No cubre la casilla del alta ni una revocación de Dirección sin firma.
- Una firma que sigue `firmado` resucita el flag que Dirección acaba de bajar: la revocación no es
  durable. Es el «escenario C» de `20260821140000`.

### Opción C: `consentimientos` por niño como única fuente, y el flag derivado de él

Se reutiliza el registro de solo-añadir que ya existía (`revocado_en` NULL = vigente; el trigger
`consentimientos_solo_revocar` solo deja sellar la revocación). Se le añade la dimensión por niño
para el tipo `imagen`, todas las vías escriben ahí y el flag se calcula.

**Pros:** una sola verdad, por niño, con historial y revocación. La RLS de F10 no cambia: sigue
leyendo el flag.

**Contras:** obliga a reconducir las tres vías y a blindar el flag contra escrituras directas.

## Decisión

**Se elige la Opción C.** `consentimientos` con `tipo = 'imagen'` es la única fuente de verdad, por
niño, y `ninos.puede_aparecer_en_fotos` se deriva de ella y no se puede escribir a mano.

Decisiones internas:

| Disyuntiva                                        | Opciones                                                           | Decisión y motivo                                                                                                                                                                                                                                   | Dónde                         |
| ------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Grano del consentimiento                          | por usuario / **por niño**                                         | `consentimientos.nino_id` (FK a `ninos`, CASCADE), CHECK `tipo = 'imagen' ⇒ nino_id NOT NULL`, inmutable en `consentimientos_solo_revocar`. El consentimiento de un niño no toca a sus hermanos.                                                    | IU-0, `20260821120000`        |
| Quién escribe el flag                             | cada vía / **un solo escritor**                                    | El trigger `consentimiento_imagen_sync` (AFTER sobre `consentimientos`). La firma sigue otorgando y revocando el **consentimiento**, pero ya no toca el flag; se borra `imagen_consentida`.                                                         | IU-0, `20260821140000`        |
| Doble consentimiento (`requiere_ambos_firmantes`) | perderlo / **mantenerlo sobre consentimientos**                    | Opción B2: `tiene_consentimiento_imagen` exige que todos los tutores principales tengan consentimiento vigente. Lee consentimientos y vínculos, no firmas. VOLATILE, para ver la fila recién insertada desde el trigger AFTER.                      | IU-0, `20260821140000`        |
| Escritura directa del flag                        | confiar en la app / **blindarlo en la BD**                         | Trigger BEFORE `ninos_flag_imagen_derivado_trg`: ignora el valor entrante y fuerza el derivado. No hay ciclo con `consentimiento_imagen_sync`: el BEFORE no emite otro UPDATE y calcula el mismo valor. Se retira además el toggle de la UI (IU-1). | IU-1, IU-1b, `20260821150000` |
| Casilla del alta                                  | acuse en `acuses_alta` / **otorgar el consentimiento**             | La casilla otorga el consentimiento con `metodo_firma = 'checkbox'` (valor nuevo de `firma_metodo`). `normas` sigue en `acuses_alta`.                                                                                                               | IU-2, `20260821160000`        |
| Señal del gate de finalizar el alta               | `tiene_consentimiento_imagen` / **`existe_consentimiento_imagen`** | Basta un consentimiento vigente cualquiera, como antes bastaba «firma o acuse». Con `tiene_`, un niño con doble firma no podría cerrar el alta hasta que firmasen los dos: habría endurecido el gate sin decidirlo.                                 | IU-2, `20260821160000`        |
| Foto de perfil sin consentimiento                 | permitirla / **bloquearla**                                        | La RPC `actualizar_foto_nino_tutor` exige `nino_puede_aparecer` después del gate de autorización (el no autorizado sigue recibiendo 42501), y las dos policies INSERT de `ninos-fotos` también, para que no queden objetos huérfanos.               | IU-3, `20260821170000`        |
| Fotos del blog al revocar                         | borrar o pixelar automáticamente / **ocultar y resolver a mano**   | Decisión B: al bajar el flag, la RLS existente las oculta al instante. No se borra nada.                                                                                                                                                            | IU-4, #259                    |
| Foto de perfil al revocar                         | ocultarla / **borrarla**                                           | La foto de perfil se ve por `es_tutor_de`, que no mira el flag, así que se borra: `foto_url` a NULL y se eliminan el original y la miniatura. Al volver a autorizar no reaparece.                                                                   | IU-4, #259                    |
| Gestión de lo ocultado                            | sin registro / **estado por foto y niño**                          | Decisión C: `media_etiquetas.resuelta_en` y `resuelta_por`, con una pantalla de Dirección (`/admin/fotos-revocadas`). Se resuelve borrando la publicación o marcándola como resuelta. Sin plazo.                                                    | IU-5, `20260821180000`        |
| Cómo se marca como resuelta                       | policy UPDATE en `media_etiquetas` / **RPC**                       | `resolver_etiqueta_imagen`, `SECURITY DEFINER`, solo Dirección e idempotente. Una policy UPDATE habría abierto el resto de columnas.                                                                                                                | IU-5, `20260821180000`        |
| Quién revoca                                      | solo Dirección / **Dirección y el tutor legal**                    | Primero solo Dirección (IU-4). El tutor legal, que es el titular, no podía retirarlo: se abre a `es_admin OR es_tutor_legal_de` y se añade «volver a autorizar» en su portal. Revocar retira los consentimientos vigentes de los dos tutores.       | IU-4, #285                    |
| Quién otorga                                      | cualquier vínculo / **tutor legal, o Dirección en presencial**     | Las RPCs pasan de `es_tutor_de` a `es_tutor_legal_de`. `firma_imagen_sync` solo crea el consentimiento si firma un tutor legal o Dirección en firma presencial. Retirar nunca se bloquea.                                                           | #286, `20261002120000`        |
| Llamadas sin uid y atribución                     | dejar pasar uid NULL / **denegar por defecto**                     | Sin uid solo pasan `service_role` y una sesión directa sin JWT. Quien no es admin otorga siempre en su propio nombre (`p_tutor := auth.uid()`). Sin `EXECUTE` para anon ni PUBLIC.                                                                  | #284, `20261001130000`        |

## Consecuencias

### Positivas

- El flag solo puede reflejar el consentimiento: ni la app ni un admin por API pueden falsearlo.
- Al reconciliar en IU-0 se recalculó el flag de todos los niños, y el que lo tenía a `true` sin
  autorización pasó a `false`.
- El consentimiento es por niño y queda en un registro de solo-añadir con su revocación, así que se
  sabe quién lo dio, cuándo, por qué vía (`metodo_firma`) y cuándo se retiró.
- Revocar oculta al instante sin código nuevo de lectura: todos los caminos que sirven fotos a la
  familia pasan por la RLS (comprobado en IU-4, incluido el export RGPD).
- El tutor legal puede retirar y volver a dar el consentimiento sin pasar por Dirección.

### Negativas

- **Solo se ocultan las fotos en las que el niño está etiquetado.** El etiquetado es opcional; una
  foto del aula donde sale sin etiqueta no se oculta. Dirección tiene que revisarla por su cuenta.
- **Borrar una publicación desde la pantalla de revocaciones la borra para todos los niños
  etiquetados.** La pantalla avisa de cuántos otros niños salen antes de borrar.
- Un vínculo `autorizado` no puede terminar el alta: la imagen es obligatoria para cerrarla y solo
  la da el tutor legal (#286).
- `tiene_consentimiento_imagen`, `existe_consentimiento_imagen` y `nino_puede_aparecer` siguen con
  `EXECUTE` para anon (comprobado en producción el 2026-10-10). Con la anon key y el uuid de un niño
  se puede saber si tiene consentimiento. No entraron en los 20 helpers de #297; queda en
  `docs/follow-ups.md`.
- El blindaje del flag (IU-1b) y la RPC de resolución (IU-5) no tienen test RLS propio. Se
  verificaron con ensayos en transacción revertida contra el remoto. El test de anon de la RPC de
  resolución sí existe (`rpc-grupo-b-anon.rls.test.ts`).

### Neutras

- `acuses_alta` sigue existiendo para `normas`.
- La firma del documento de imagen (F11-A3) sigue viva como vía, pero ahora alimenta el mismo
  consentimiento por niño.

## Plan de implementación

- [x] IU-0 (#254): `nino_id`, helpers, trigger que deriva el flag y una sola fuente
      (`20260821120000`, `20260821130000`, `20260821140000`).
- [x] IU-1 (#255): se retira el toggle manual. IU-1b (#256): el flag solo se deriva
      (`20260821150000`).
- [x] IU-2 (#257): la casilla del alta otorga el consentimiento (`20260821160000`).
- [x] IU-3 (#258): sin consentimiento no hay foto de perfil (`20260821170000`).
- [x] IU-4 (#259): Dirección revoca con efectos inmediatos (sin migración).
- [x] IU-5 (#260): pantalla de revocaciones y estado por etiqueta (`20260821180000`).
- [x] #284: seguridad de las RPCs (`20261001130000`). #285: el tutor revoca y vuelve a autorizar
      (sin migración). #286: solo el tutor legal o Dirección en presencial (`20261002120000`).

## Verificación

Tests RLS, todos con su flag activo en la suite nocturna y en la BD efímera:

| Qué prueba                                                  | Fichero                                    | Flag                                   |
| ----------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| Flag derivado por niño, hermano intacto, CHECK de `nino_id` | `imagen-consent-derivado.rls.test.ts`      | `IMAGEN_CONSENT_DERIVADO_APPLIED`      |
| La firma del documento de imagen alimenta el consentimiento | `imagen-firmable.rls.test.ts`              | `F11A3_IMAGEN_MIGRATION_APPLIED`       |
| Foto de perfil bloqueada sin consentimiento, tutor y admin  | `adjuntos-storage.rls.test.ts`             | `IMAGEN_IU3_APPLIED`                   |
| RPCs: sin anon, sin uid NULL, `p_tutor` forzado             | `consent-imagen-rpc-seguridad.rls.test.ts` | `CONSENT_IMAGEN_RPC_SEGURIDAD_APPLIED` |
| Solo el tutor legal o Dirección en presencial               | `consent-imagen-tutor-legal.rls.test.ts`   | `CONSENT_IMAGEN_TUTOR_LEGAL_APPLIED`   |

## Notas

- No hubo documento de diseño previo. Las decisiones se cerraron PR a PR con el responsable y
  constan en los cuerpos de #254–#260 y #284–#286 y en las cabeceras de sus migraciones.
- Las letras B y C («ocultar sin borrar» y «pantalla de gestión») son las de esas conversaciones,
  tal como las citan los PRs #259 y #260. No tienen relación con las decisiones B y C de ADR-0050.

## Referencias

- Migraciones: `20260821120000`, `20260821130000`, `20260821140000`, `20260821150000`,
  `20260821160000`, `20260821170000`, `20260821180000`, `20261001130000`, `20261002120000`.
  Antecedentes: `20260613190000` (activar `consentimientos`), `20260614120000` (imagen firmable),
  `20260611120000` (F10-0, `nino_puede_aparecer`).
- PRs: #254, #255, #256, #257, #258, #259, #260, #284, #285, #286.
- ADRs relacionados: ADR-0045 (blog del aula y Storage), ADR-0049 (altas con documentos), ADR-0053
  (postura de seguridad: «sin uid» y anon).
- Spec: `docs/specs/proteccion-datos.md` (decisiones #4 y #9).
