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
desde dónde y qué campos vio. La familia (los tutores legales) y la Dirección del centro pueden ver
ese registro y descargarlo, y sale en el export del art. 15. La Dirección lo ve siempre y lo descarga
para entregarlo cuando la familia ya no entra en la app. La tabla de la ficha deja de leerse directamente: las
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

1. **Quién ve el registro:** la familia (los tutores legales del niño) y la Dirección del centro, la
   directora incluida (revisado el 2026-10-27): la directora lee fichas médicas, y si no ve el
   registro nadie detecta en el día a día un acceso raro. Detectar y corregir internamente un acceso
   indebido es lo que la AEPD cuenta como diligencia.
2. **Qué se registra:** quién accedió, fecha y hora, y qué datos se consultaron.
3. **Las lecturas de la propia familia también se registran.**
4. Se construye lo propuesto: la tabla escrita dentro de la función de lectura; cerrar la lectura
   directa con una función de avisos para las listas; la purga del niño borra sus lecturas, y nada
   entra en `audit_log`; la familia lo ve y sale en `export_datos_sujeto`.
5. **El plazo de conservación es del abogado.** Hasta entonces, uno provisional y marcado como tal.
6. **El registro no se pierde cuando la familia deja el centro** (2026-10-27). El derecho de acceso
   del art. 15 es de la persona, no depende de que siga siendo cliente: la Dirección siempre tiene
   acceso al registro, también con el niño de baja o el vínculo del tutor cerrado, y lo puede
   descargar en un documento para entregarlo a la familia (quién accedió, fecha y hora, y qué datos
   se consultaron).
7. **La familia también lo descarga** (2026-10-27). El derecho del art. 15 es suyo, no del centro:
   tener que pedírselo a la Dirección es un rodeo. El botón de la Dirección queda para cuando el
   tutor ya no puede entrar.

Fuentes que aporta el responsable: resolución PD-00068-2026 de la AEPD (junio de 2026) y art. 9 del
Reglamento (UE) 2025/327, aplicable desde el 26 de marzo de 2027.

## User stories

- US-01: Como tutor legal, quiero ver quién ha consultado la ficha médica de mi hijo, cuándo y qué
  datos, para ejercer mi derecho de acceso sin tener que pedirlo al centro.
- US-02: Como Dirección, quiero ver el mismo registro para detectar un acceso raro, contestar a una
  familia y justificar los accesos.
- US-01b: Como tutor legal, quiero descargar ese registro para guardarlo, sin pedírselo al centro.
- US-02b: Como Dirección, quiero descargar el registro de un niño para entregárselo a su familia,
  también si ya no está en el centro.
- US-03: Como tutor legal, quiero que ese registro salga en el export de los datos de mi hijo.
- US-04: Como profe, quiero seguir viendo en las listas del aula quién tiene alergia o medicación,
  sin abrir la ficha.

## Alcance

**Dentro:**

- La tabla de lecturas, escrita por `get_info_medica_emergencia` en la misma transacción que descifra.
- Cerrar el SELECT directo de `info_medica_emergencia` para las sesiones y la función de avisos
  `alertas_medicas` para las cuatro listas (pase de lista, agenda del aula y los dos pases del
  comedor).
- Leer el registro: `lecturas_ficha_medica(niño)` para los tutores legales y la Dirección, con la
  pantalla en la ficha del niño de la familia y en la de Dirección.
- Descargarlo: `/{locale}/export/lecturas-ficha-medica/{niño}`, un HTML imprimible, con el botón en
  la ficha del niño de la familia («Descargar el registro») y en la de Dirección («… para
  entregarlo»).
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
- La Dirección del centro (`es_admin`: la titular, la directora y el superusuario), en la ficha
  del niño de Dirección, **siempre**: también con el niño de baja (la ficha de Dirección abre a los
  archivados) o con el vínculo del tutor cerrado. Nada borra filas al cerrarse un vínculo.
- Nadie más: la profe, el autorizado y Dirección de otro centro reciben 42501. El tutor cuyo
  vínculo se ha cerrado, también; entonces se lo entrega la Dirección.

Cada fila muestra la fecha y hora, el nombre de quien leyó, su papel, desde dónde y qué campos vio.
El nombre sale de `usuarios`: si esa cuenta se purga, sale como la purga la dejó.

### Descarga

La ruta `/{locale}/export/lecturas-ficha-medica/{niño}` devuelve un HTML (`text/html`, adjunto,
imprimible a PDF) con el nombre del niño, la fecha de generación y una tabla: fecha y hora, quién
accedió, en calidad de qué, desde dónde y qué datos consultó. La hora va en la de Madrid con su zona
escrita (CET o CEST) y en UTC en el atributo `datetime`. La autoriza la misma
`lecturas_ficha_medica` con la sesión de quien descarga: quien no puede leerlo recibe 404. El botón
está en la ficha del niño de la familia, para guardarlo, y en la de Dirección, para entregarlo al
tutor que ya no entra. La descarga no se apunta en `export_log`, que es del export completo. El documento no dice el plazo de conservación, que aún no es firme.

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
  cascada. **Revisado el 2026-10-27** (`docs/specs/retencion-plazos.md`): con el olvido el registro
  se conserva, bloqueado, porque sin él no se puede demostrar nada si una familia reclama después un
  acceso indebido. Hasta el PR que lo construya, la purga lo sigue borrando.
- **Plazo provisional: 5 años** (`RETENCION_LECTURAS_FICHA_MEDICA_MESES` = 60, PENDIENTE política
  F11-B; lo fija el responsable, como el resto de `docs/specs/retencion-plazos.md`). Hasta el
  2026-10-27 eran 24 meses, el mínimo que pedía el antiguo reglamento de la LOPD (RD 1720/2007,
  art. 103) para el registro de accesos a datos de nivel alto. El cron de retención borra las
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
  tutores legales y la Dirección (titular y directora), y no la profe, el autorizado ni otro centro;
  con el niño de baja y los vínculos cerrados no se borra nada, los tutores reciben 42501 y la
  Dirección lo sigue viendo entero; el export lo lleva; la purga del niño lo borra y el plazo borra
  solo lo vencido (y en simulación nada).
- Unit: las listas usan la función y un fallo tumba la lista; las etiquetas del registro en es/en/va;
  el documento para entregar (columnas, hora con zona, texto escapado, sin lecturas, es/en/va).
