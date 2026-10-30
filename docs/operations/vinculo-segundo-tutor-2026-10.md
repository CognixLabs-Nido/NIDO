# El vínculo que el alta del hermano no le dio al segundo tutor (octubre de 2026)

**Estado:** aplicada en producción el 30-10-2026 por SQL Editor («success»; el SQL Editor no enseña los `NOTICE`). Verificada después en solo lectura: el vínculo existe, vivo, `tutor_legal_secundario`, con el parentesco, la descripción y los permisos de su referencia; 6 vínculos, los 6 vivos; 0 casos del predicado; una sola fila nueva en `audit_log` (INSERT del vínculo, `usuario_id` NULL, `system:reparar_vinculo_segundo_tutor`); las otras 5 sin tocar (`updated_at` del 13-08-2026 y ningún UPDATE en `audit_log`). Operación: `supabase/operaciones/20261210100000_vinculo_segundo_tutor.sql`.

## Qué pasa

Un segundo tutor con cuenta tiene dos hijos en el centro y solo tiene vínculo con uno. Entra en la app y no ve al otro.

## De dónde viene

El hermano menor se dio de alta antes del #291 (2026-10-02). El flujo de entonces, para la familia que ya existía, invitaba también a los tutores de la familia, y a este, que ya tenía cuenta, le mandó una invitación nueva. GoTrue no invita a un email que ya tiene cuenta (`email_exists`): la invitación quedó creada y sin correo, caducó el 2026-08-20 sin aceptar, y el vínculo con el hermano no se creó nunca.

Desde el #291, `crear_o_anadir_a_familia` da ese vínculo en el alta (bloque ALTA-HERMANO C3, `20261102120000`): a los demás tutores legales de la familia que ya tienen cuenta y rol `tutor_legal` vivo en el centro, con su papel en la familia (`titular` → principal, `segundo_tutor` → secundario) y copiando parentesco, descripción y permisos de su vínculo vivo con otro hijo. La aceptación de una invitación vincula a todos los niños de la familia, y la app inserta los tutores de `familia_tutores` sin cuenta (`usuario_id` NULL). El camino que dejó este caso está cerrado.

## Diagnóstico (2026-10-30, solo lectura)

- **Un solo caso.** El predicado del C3 (tutor con cuenta y rol vivo en la familia, con vínculo de tutor vivo con otro hijo y sin vínculo vivo con un hijo vivo de la familia) da una fila en todo producción, de los cuatro tutores con cuenta.
- El tutor es `segundo_tutor` de la familia y su vínculo con el otro hijo es `tutor_legal_secundario`: el vínculo que falta es `tutor_legal_secundario`.
- El par tutor–niño no tiene ninguna fila en `vinculos_familiares`, ni viva ni retirada: `privado.dar_vinculo` la crea, no reactiva nada.
- El niño tiene la matrícula activa.
- `vinculos_familiares`: 5 filas, las 5 vivas.

## Qué hace la operación

Un bloque `DO` que llama a `privado.dar_vinculo` con el papel y los datos que habría puesto el C3, firmado en `audit_log` como `system:reparar_vinculo_segundo_tutor`. Las guardas, todas con rollback total:

- **Entrada:** exactamente 1 caso; es el diagnosticado (md5 de `usuario:niño`, sin los ids en el repo); 1 vínculo de referencia; el par sin filas; `vinculos_familiares` con 5 filas vivas.
- **Salida:** `dar_vinculo` devolvió `creada`; 6 filas, todas vivas; ninguna de las otras 5 ha cambiado (huella de las filas); el vínculo nuevo copia el de referencia; ya no queda ningún caso; en `audit_log`, solo el INSERT del vínculo, con su etiqueta.
- Imprime el recuento antes y después (`RAISE NOTICE`).

No toca la invitación caducada (no da acceso), la familia, los roles ni ningún otro vínculo.

## Ensayo (2026-10-30, contra producción)

Cada variante en una sola petición, con `SET nido.ensayo = 'on'` delante y un `RAISE` final garantizado detrás. Antes y después: 5 vínculos, 308 filas en `audit_log`, 97 MB.

| Variante                                   | Resultado                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| El fichero tal cual (LF)                   | ENSAYO OK: casos 1 → 0, vínculos 5/5 → 6/6, resto sin cambios, 1 fila de auditoría |
| Vía del SQL Editor (CRLF, sin comentarios) | ENSAYO OK, lo mismo                                                                |
| Control: el predicado no coge nada         | guarda de entrada: 0 casos                                                         |
| Control: el predicado coge de más          | guarda de entrada: 6 casos                                                         |
| Control: otro par (md5)                    | guarda de entrada: no es el diagnosticado                                          |
| Control: vínculos de referencia            | guarda de entrada                                                                  |
| Control: el par ya tiene fila              | guarda de entrada                                                                  |
| Control: recuento de entrada               | guarda de entrada: 5 filas, esperaba 4                                             |
| Control: la operación toca otra fila       | rollback: ha cambiado otra fila, y 2 filas de auditoría                            |
| Control: `dar_vinculo` no crea             | rollback                                                                           |
| Control: no copia la referencia            | rollback: el vínculo nuevo no copia el de referencia                               |
| Control: recuento de salida                | rollback: 6 filas, esperaba 7                                                      |
| Control: otro actor en la auditoría        | rollback: la fila de auditoría no lleva la etiqueta                                |
