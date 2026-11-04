# Un CID de prueba para CEI Ejemplo (2026-11)

**CEI Ejemplo es un centro de pruebas. Su CID, `ES81ZZZB00000000`, es ficticio y no vale para cobrar
nada.**

Operación: `supabase/operaciones/20261229100000_cid_prueba_cei_ejemplo.sql`.

## Por qué

Desde `20261229120000` (0c-1 de la serie de altas) sin el identificador de acreedor (CID) del centro
no se firma ningún mandato SEPA: un mandato sin CID no vale para el banco y habría que volver a
firmarlo. CEI Ejemplo no cobra a nadie y no tenía CID, así que no se podía probar la domiciliación.
Jose, el 2026-11-04: «el CID es obligatorio, pero lo que tenemos ahora es un centro falso y no tiene
CID, invéntate algo para que funcione».

## Diagnóstico (2026-11-04, producción en solo lectura)

- 1 centro en la base, vivo: CEI Ejemplo. Sin CID, sin BIC y sin IBAN de acreedor.
- 3 mandatos, todos digitales con hash y PDF: 2 activos y 1 revocado, los tres con un
  identificador de 36 caracteres (el `MndtId` admite 35). No sirven para el banco y se quedan como
  están.

## El CID

`ES81ZZZB00000000`: `ES`, los dígitos de control, el sufijo `ZZZ` y el NIF.

- **Formato válido de verdad.** Los dígitos de control son los de ISO 7064 mod 97-10 sobre el NIF
  seguido de `ES00`; el sufijo no entra en el cálculo. Comprobado de tres maneras: el cálculo propio,
  la lectura del algoritmo de `python-stdnum` (`stdnum.eu.at_02`, que hace lo mismo: salta las
  posiciones 5 a 7 y pasa los cuatro primeros al final), y el bloque de la operación, que lo vuelve a
  calcular en SQL antes de escribir. El mismo cálculo da por bueno un IBAN conocido y rechaza el
  mismo con un dígito cambiado, y rechaza `ES80ZZZB00000000`.
- **Se ve que es de prueba** por el NIF: `B00000000` es un CIF de sociedad con el dígito de control
  correcto y todo ceros. El sufijo es `ZZZ`, como se pidió (cualquier sufijo da los mismos dígitos
  de control).

## Qué toca y qué no

Solo `centros.identificador_acreedor` de CEI Ejemplo, con su fila en `audit_log` (actor
`system:cid_prueba_cei_ejemplo`). El BIC y el IBAN de acreedor siguen vacíos, así que la descarga
de una remesa sigue diciendo que faltan. Un centro real pone su CID en Cuotas → Datos bancarios, que
lo sobrescribe.

## Ensayo

En producción, con `SET nido.ensayo = 'on';` y terminado en RAISE: pasa entero y el CID de
producción sigue vacío. Controles negativos, cada uno aborta con su mensaje: otros dígitos de
control, el cálculo mod 97 roto, otro md5 del centro, otro nombre, otro número de centros y un
UPDATE que toca otra columna.

## Orden

Antes de la migración `20261229120000`. La migración no lo exige (en la BD del CI no hay centros),
pero sin él, en cuanto se aplique, CEI Ejemplo no puede firmar ningún mandato.
