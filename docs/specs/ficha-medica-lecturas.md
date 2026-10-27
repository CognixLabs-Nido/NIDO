---
feature: ficha-medica-lecturas
wave: 1
status: approved
priority: high
last_updated: 2026-10-27
related_adrs: [ADR-0004, ADR-0053, ADR-0061]
related_specs: [proteccion-datos, olvido-peticiones]
---

# Spec — Quién ha leído la ficha médica

## Resumen ejecutivo

Cada vez que alguien abre el contenido de la ficha médica de un niño, queda registrado quién, cuándo,
desde dónde y qué campos vio. La familia (los tutores legales) y la titular del centro pueden ver ese
registro, y sale en el export del art. 15. La tabla de la ficha deja de leerse directamente: las
listas del aula reciben solo los avisos (alergia sí o no, medicación sí o no), sin contenido.

## Contexto

F11-B, punto 4. Hasta ahora las lecturas de la ficha médica no se registraban para nadie, tampoco las
del superusuario. El contenido descifrado sale de una sola función (`get_info_medica_emergencia`),
pero la tabla se podía leer directamente con sesión (tres políticas de SELECT), así que un registro
puesto solo en la función se podía saltar. Desde `20261124120000` no se puede escribir directamente;
leer, sí.

Decisiones del responsable (2026-10-27). Según su lectura de la normativa (criterio de la AEPD de
junio de 2026, que entiende que el derecho de acceso del art. 15 RGPD incluye quién ha accedido a los
datos de salud, apoyado en el art. 9 del Reglamento (UE) 2025/327; la escuela no es prestador
sanitario, pero trata datos del art. 9 de menores):

1. **Quién ve el registro:** la familia (los tutores legales del niño) y la titular del centro.
2. **Qué se registra:** quién accedió, fecha y hora, y qué datos se consultaron.
3. **Las lecturas de la propia familia también se registran.**
4. Se construye lo propuesto: la tabla escrita dentro de la función de lectura; cerrar la lectura
   directa con una función de avisos para las listas; la purga del niño borra sus lecturas, y nada
   entra en `audit_log`; la familia lo ve y sale en `export_datos_sujeto`.
5. **El plazo de conservación es del abogado.** Hasta entonces, uno provisional y marcado como tal.

## User stories

- US-01: Como tutor legal, quiero ver quién ha consultado la ficha médica de mi hijo, cuándo y qué
  datos, para ejercer mi derecho de acceso sin tener que pedirlo al centro.
- US-02: Como titular, quiero ver el mismo registro para poder contestar a una familia y justificar
  los accesos.
- US-03: Como tutor legal, quiero que ese registro salga en el export de los datos de mi hijo.
- US-04: Como profe, quiero seguir viendo en las listas del aula quién tiene alergia o medicación,
  sin abrir la ficha.

## Alcance

**Dentro:**

- La tabla de lecturas, escrita por `get_info_medica_emergencia` en la misma transacción que descifra.
- Cerrar el SELECT directo de `info_medica_emergencia` para las sesiones y la función de avisos
  `alertas_medicas` para las cuatro listas (pase de lista, agenda del aula y los dos pases del
  comedor).
- Leer el registro: `lecturas_ficha_medica(niño)` para los tutores legales y la titular, con la
  pantalla en la ficha del niño de la familia y en la de Dirección (solo la titular).
- El registro en el export del niño (`export_datos_sujeto`).
- La purga del niño borra sus lecturas; el plazo provisional las borra al vencer.

**Fuera:**

- Registrar las listas: no ven contenido, solo si hay alergia o medicación.
- El registro en el export de la persona que lee (lo que un profe ha consultado): no es dato del
  niño, y el registro existe para la familia.
- El plazo definitivo y si hay excepciones a identificar a quien lee (abogado).

## Comportamiento

### Qué se registra

Cada llamada autorizada a `get_info_medica_emergencia` escribe una fila, haya ficha o no:

| Columna      | Qué guarda                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `nino_id`    | El niño                                                                                        |
| `centro_id`  | Su centro                                                                                      |
| `lector_id`  | Quien leyó (`auth.uid()`)                                                                      |
| `rol_lector` | Por qué pudo leer: `admin`, `directora`, `superusuario`, `profe`, `tutor_legal` o `autorizado` |
| `origen`     | Desde dónde: `ficha` (la ficha del niño), `alta` (el formulario de alta) o `export`            |
| `campos`     | Los campos que tenían contenido y se entregaron (de los seis); vacío si la ficha no tenía nada |
| `leida_en`   | Cuándo                                                                                         |

Una lectura no autorizada no llega a descifrar y no se registra (da error, como hasta ahora).

El rol se decide por la misma vía que autoriza: Dirección (`admin` o `directora` según su fila viva,
`superusuario` si no tiene ninguna), la profe del aula, o el vínculo (`tutor_legal` o `autorizado`).

### Quién ve el registro

- Los tutores legales del niño (`es_tutor_legal_de`), en su ficha (`/family/nino/[id]`).
- La titular del centro (`privado.es_responsable`), en la ficha del niño de Dirección.
- Nadie más: la directora, la profe y el autorizado reciben 42501.

Cada fila muestra la fecha y hora, el nombre de quien leyó, su papel, desde dónde y qué campos vio.
El nombre sale de `usuarios`: si esa cuenta se purga, sale como la purga la dejó.

### Las listas del aula

`info_medica_emergencia` deja de tener SELECT para `authenticated` y pierde sus tres políticas de
lectura. Las cuatro listas llaman a `alertas_medicas(niños)`, que devuelve por cada niño visible
`alergia_grave` y `medicacion` (sí o no) con las mismas tres condiciones que tenían las políticas:
Dirección del centro, profe del niño, o vínculo con `puede_ver_info_medica`. Un niño que no cumple
ninguna no sale, igual que con la RLS. Un fallo de la función sigue tumbando la lista: nunca se
pinta «sin alergia».

### Purga y plazo

- La purga del niño (`purgar_sujeto_db`, que lo deja con `deleted_reason = 'purga_rgpd'`) borra sus
  lecturas por un trigger en `ninos`; si la fila del niño se borra (esqueleto huérfano), caen en
  cascada.
- **Plazo provisional: 24 meses** (`RETENCION_LECTURAS_FICHA_MEDICA_MESES`, PENDIENTE política
  F11-B). Es el mínimo que pedía el antiguo reglamento de la LOPD (RD 1720/2007, art. 103) para el
  registro de accesos a datos de nivel alto; lo decide el abogado. El cron de retención borra las
  lecturas más antiguas con `purgar_lecturas_ficha_medica`, y respeta la simulación
  (`RETENCION_DRY_RUN`): en simulación solo las cuenta.
- La tabla no se audita: nada de esto entra en `audit_log`.

## Modelo de datos

Migración `20261128120000_feat_ficha_medica_lecturas`, después de `20261127120000` (recrea
`export_datos_sujeto` desde el texto de esa).

- Tabla `lecturas_ficha_medica` (columnas de arriba). RLS activada y sin políticas; sin privilegios
  para `anon` ni `authenticated`: se escribe y se lee solo por funciones. FK `nino_id` →
  `ninos` `ON DELETE CASCADE`, `lector_id` → `usuarios` `ON DELETE SET NULL`. Índice
  `(nino_id, leida_en)`.
- `get_info_medica_emergencia(p_nino_id, p_origen DEFAULT 'ficha')`: misma autorización y mismo
  descifrado; además escribe la fila. Cambia la firma (se borra la de un argumento).
- `alertas_medicas(p_nino_ids uuid[])`, `lecturas_ficha_medica(p_nino_id)`: `SECURITY DEFINER`,
  solo `authenticated`.
- `purgar_lecturas_ficha_medica(p_meses, p_simular)`: solo `service_role`.
- Trigger `ninos_purga_borra_lecturas` (AFTER UPDATE OF `deleted_reason`).
- `export_datos_sujeto`: el niño lleva `lecturas_ficha_medica`.

## Tests

- RLS: cada vía de lectura deja su fila con su rol, origen y campos; una lectura no autorizada no
  deja nada; la lectura directa de la tabla da 42501 para todos los roles con sesión; las alertas
  devuelven lo mismo que las políticas de antes y nada de otro centro; el registro lo ven los dos
  tutores legales y la titular, y no la directora, la profe ni el autorizado; el export lo lleva; la
  purga del niño lo borra y el plazo borra solo lo vencido (y en simulación nada).
- Unit: las listas usan la función y un fallo tumba la lista; las etiquetas del registro en es/en/va.
