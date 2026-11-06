# Los 60 ficheros de Storage bajo centros que no existen (2026-11)

Operación: `supabase/operaciones/20270106120000_borrar_huerfanos_storage.mjs`. Es la primera que
borra de Storage, y el patrón para cuando haya que borrar un fichero de verdad (un DNI, un libro de
familia).

## Qué son

Medido en producción el 2026-11-06, con SQL de solo lectura:

| Bucket          | Objetos | Sin dueño | Con dueño (CEI Ejemplo) |
| --------------- | ------- | --------- | ----------------------- |
| `dni-tutores`   | 23      | 20        | 3                       |
| `libro-familia` | 23      | 20        | 3                       |
| `mandato-sepa`  | 23      | 20        | 3                       |
| `ninos-fotos`   | 6       | 0         | 6                       |

Los otros seis buckets están vacíos. «Sin dueño» quiere decir que la primera carpeta no es ningún
centro ni ningún usuario.

- **Los 60:** 20 centros que no existen, 3 ficheros cada uno, uno por bucket:
  `{centro}/{niño}/{bucket}.pdf`. Los 60 son de 15 bytes y `application/pdf`. Ningún centro ni
  ningún niño de esas rutas existe.
- **De dónde salen:** `src/test/rls/f11g-validacion-purga.rls.test.ts` sube exactamente esa ruta
  con ese contenido (`%PDF-1.4\n%%EOF\n`, 15 bytes). Su limpieza borraba el centro y no los
  ficheros. Se crearon del 1 al 11 de octubre; el último, el 11 a las 08:50 UTC. La guarda que
  impide correr la suite RLS contra una BD remota (#340) se mergeó ese día a las 12:06 UTC.
- **Nada los nombra:** se buscaron los 40 ids (20 centros y 20 niños) en las 751 columnas de
  texto, json y uuid de todas las tablas de la base, salvo `storage.objects`: 0 filas. En la misma
  pasada, el id de CEI Ejemplo aparece en 35 columnas: el escaneo sí mira.

## Por qué no con SQL

`storage.protect_delete` rechaza el `DELETE` sobre `storage.objects` («Use the Storage API
instead»). Forzarlo con `storage.allow_delete_query` borra la fila y deja el fichero guardado,
inalcanzable. La operación borra por la API de Storage con `service_role`. El SQL que lleva solo
lee: va a la Management API con `read_only: true`, y lo comprueba antes de empezar.

## Guardas

Antes de borrar, todas; si una falla, no se borra nada:

1. los ficheros sin dueño son exactamente los de la lista (60 md5 de `bucket/nombre` fijos en el
   fichero): ni falta uno, ni sobra uno, ni está en la lista uno que tiene dueño;
2. 60 en total, 20 por bucket, cada uno `{uuid}/{uuid}/{bucket}.pdf`, 15 bytes, `application/pdf`,
   y su centro y su niño siguen sin existir;
3. ninguna fila de la base nombra a ninguno de los 40 ids, con el centro de control presente;
4. la API de Storage ve los 60.

Después: ninguno en `storage.objects`, la API no ve ninguno, cada bucket tiene 20 menos y el resto
de ficheros no ha cambiado (huella de todas sus filas). La capa de bytes que hay debajo de Storage
no se ve desde fuera; el borrado por la API la incluye, que es lo que el borrado por SQL no hace.

## Ensayo en producción (2026-11-06)

`--ensayo`: «ENSAYO OK, nada borrado», con los 60 por bucket y por centro. Y cada guarda con una
sola cosa cambiada (un control negativo por guarda), cada una con su mensaje:

| Cambio                                  | Resultado                                              |
| --------------------------------------- | ------------------------------------------------------ |
| ninguno                                 | ENSAYO OK, nada borrado                                |
| la lista sin una de las 60              | sin dueño y NO está en la lista: esa                   |
| esperar 61                              | recuento: esperaba 61 ficheros y hay 60                |
| esperar 21 y 19 en dos buckets          | recuento por bucket                                    |
| esperar 16 bytes                        | tamaño: … tiene 15 bytes, esperaba 16                  |
| esperar otro tipo                       | tipo: … es application/pdf                             |
| un centro de control que no existe      | control positivo: el escaneo no encuentra ni el centro |
| una huella de más                       | faltan 1 de la lista                                   |
| en la lista, una foto de CEI Ejemplo    | está en la lista pero TIENE dueño                      |
| el escaneo buscando también CEI Ejemplo | referencia: N filas de … nombran alguno                |
| una API que no los ve                   | la API no lo ve antes de borrar                        |

Lo que en producción no se puede ensayar sin borrar (que la API diga «borrado» y no borre) está en
el test de la CI: `src/test/rls/operacion-huerfanos-storage.rls.test.ts`, que corre el mismo
`operar` contra la BD efímera.

## Cómo se aplica

Desde la raíz del repo, con `.env.local`, primero el ensayo y luego de verdad:

```bash
node supabase/operaciones/20270106120000_borrar_huerfanos_storage.mjs --ensayo
node supabase/operaciones/20270106120000_borrar_huerfanos_storage.mjs --aplicar
```

El final de `--aplicar` es «HECHO | 60 borrados y comprobados». Un `--ensayo` después tiene que
fallar con «faltan 60 de la lista».
