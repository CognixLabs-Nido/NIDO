# ADR-0057: Centro activo y punto único de contexto en la app

## Estado

`accepted`

**Fecha:** 2026-10-18
**Autores:** responsable + claude-code
**Fase del proyecto:** Multicentro · Fase 1

## Contexto

NIDO va a tener varios centros (multicentro, plan en fases). La base de datos ya autoriza por centro: los helpers de RLS reciben el centro por parámetro (`es_admin(centro)`, `pertenece_a_centro`…) y `roles_usuario` admite el mismo usuario en varios centros. Lo que asumía un solo centro era la app:

- `getCentroActualId()` sacaba «el» centro del usuario con `roles_usuario … limit(1)` **sin orden**: con dos centros, uno al azar. Lo importaban 81 ficheros, y había tres copias más con el mismo patrón.
- Unos 30 ficheros leían `roles_usuario` por su cuenta.
- No había selector de centro, ni cookie, ni «centro activo».

Es el fallo #755 de MisterFC, pero peor: allí el club por defecto era el primero alfabético y aun así el superadmin vio y escribió en el club equivocado. Hoy, con un solo centro en producción, nadie lo nota: todos los usuarios tienen uno.

## Decisión

**Un único módulo saca el centro del usuario actual: `src/features/centros/contexto/`.**

- **`resolver.ts`** (puro) fija las reglas:
  - sin roles → `sin_centro`;
  - **un centro → ese, siempre**. La cookie no se mira, y quien tiene un centro no ve nunca el selector;
  - **varios → el de la cookie si es uno de los suyos; si no, `elegir`**. Nunca se coge uno por defecto.
- **`get-contexto-centro.ts`** expone dos entradas:
  - `requireContextoCentro(locale)` para páginas y layouts. Devuelve `{ centroId, rol, roles, esSuperusuario, centros }` o redirige (login, forbidden o el selector);
  - `contextoEnCentro(centroId)` para acciones con el centro **explícito**. No lee la cookie, así que una pestaña antigua actúa sobre el centro que enseña, no sobre el último elegido en otra pestaña.
- **Cookie `nido_centro_activo`** (httpOnly, `sameSite=lax`, un año). Solo guarda la elección; no autoriza nada, porque se valida contra los centros del usuario en cada lectura.
  - La escribe **solo** la acción `elegirCentro`, nunca el render (lección #756 de MisterFC: reescribirla mientras se pinta dio un 500).
  - La borra `signOut`.
- **El selector** (`/[locale]/elegir-centro`) y **el conmutador** de la barra lateral se montan solo con más de un centro.
- `select-role` ofrece los roles del **centro activo**.
- `esSuperusuario` existe ya en el tipo; hoy siempre es `false`. Lo rellena la Fase 3.

**Guard de CI `scripts/check-centro-activo.mjs`** (como `check-club-activo` de MisterFC). Corre con los unit tests (`src/test/guards/check-centro-activo.test.ts`) y con `npm run check:centro-activo`. Fuera del módulo de contexto falla si:

- se lee `roles_usuario` más veces de las que admite la lista para ese fichero;
- se nombra `getCentroActualId` o `getRolEnCentro` más veces de las que admite la lista para ese fichero (import y llamadas). Un fichero nuevo, o una llamada nueva en uno que ya estaba, es rojo.

**Bloquea desde este PR, no solo avisa.** Lo que ya existe queda congelado en la lista, y cualquier aumento pone la CI en rojo (en los unit tests y en el paso «Guard centro activo» de `ci-pr.yml`). Ese paso imprime en el log y en el resumen del job cuánto queda: hoy 37 lecturas de `roles_usuario` fuera del módulo (16 por migrar y 21 que se quedan, repartidas en 16 ficheros) y 78 ficheros con 205 usos de las deprecadas.

La lista (`scripts/check-centro-activo.lista.mjs`) tiene tres partes:

- `LECTURAS_PERMITIDAS`, que se quedan, cada una con su motivo: miran a otro usuario, clasifican una cuenta o cuentan el personal de un centro explícito;
- `LECTURAS_PENDIENTES`, del usuario actual, por migrar;
- `PENDIENTES_GET_CENTRO`, los ficheros que aún usan las funciones deprecadas, con su número de usos.

**Una entrada que sobra, o un número más alto que los usos reales, también es rojo**, así que la lista solo puede bajar, y cada PR de la sustitución la baja exactamente en lo que migra. Los comentarios se quitan antes de buscar.

**El PR5 la vacía y la quita.** Se borran `getCentroActualId` y `getRolEnCentro`, `PENDIENTES_GET_CENTRO` y `LECTURAS_PENDIENTES` desaparecen del guard y de la lista, y la regla B pasa a ser «cualquier mención fuera del módulo es rojo», también en un comentario y sin lista. Para las funciones borradas no queda sitio donde volver a meter una excepción: el guard no lee ninguna lista para la regla B, y un test comprueba que la lista solo exporta `LECTURAS_PERMITIDAS`.

`getCentroActualId` y `getRolEnCentro` quedaron **deprecadas** y delegando en el contexto desde el PR1 (ya no había centro al azar en ningún sitio) y se borraron en el PR5.

**El PR6 quita la última lista.** Las 19 lecturas de `LECTURAS_PERMITIDAS` (14 ficheros) pasan al módulo de contexto como funciones con nombre, cada una con su motivo en el comentario, y el guard prohíbe cualquier `.from('roles_usuario')` fuera de `features/centros/contexto/`, lectura o escritura. No hay fichero de lista y `revisar` no lee ninguna: una lectura nueva va al módulo con nombre, o no entra. Decisión del responsable (2026-10-19): una lista donde se añade una línea es por donde se cuela la siguiente excepción, y la Fase 3 (superusuario) toca justo quién lee los roles de otros.

## Sustitución (PRs posteriores)

- **PR2 (páginas):** 37 páginas pasan a `requireContextoCentro(locale)` con un codemod comprobado antes contra 13 casos, 4 de ellos de rechazo. `PENDIENTES_GET_CENTRO` baja de 78 ficheros y 205 usos a 41 y 89. En las páginas que antes mandaban al login cuando faltaba el centro, ahora:
  - un usuario con varios centros y sin elegir va al selector;
  - uno sin centro, a `/forbidden`.
- **Paradas en el PR2, no encajan en el patrón** (siguen en la lista):
  - `admin/cuotas/recibos/csv/route.ts`, porque es un endpoint de descarga (403), no una página;
  - `alta/[ninoId]`, porque pide el rol en el centro **del niño**;
  - `teacher/aula/[id]`, `aula/[id]/fotos` y `aula/[id]/servicio`, porque piden el rol en el centro **del aula**.
- **PR3 (centro explícito):**
  - **Lectura de roles con cliente inyectado.** `contexto/roles-del-usuario.ts` (`leerCentrosDe`, `rolesEnCentro`, `esAdminEn`, `centrosDondeEsAdmin`) es la misma lectura que usa `get-contexto-centro.ts`, pero con el cliente y el usuario de quien llama. Así los núcleos de las acciones, que reciben el cliente para probarse contra la BD, no leen `roles_usuario` por su cuenta. Ninguna función elige un centro: o lo reciben explícito o devuelven la lista. Un fallo de lectura es `null`, no «sin roles».
  - **Centro del registro.** Lista de espera (el prospecto), familias (la familia o la del tutor) y `esAdminDeCentroDeNino` (el niño): el centro es el de la fila que se toca, no el activo.
  - **Centro de la página.** Eventos de ámbito centro, citas de claustro y visitas, y recordatorios sin niño ni aula reciben `centro_id` de la página y comprueban que el usuario tiene rol en él. Antes cogían el centro del usuario con `limit(1)`. Lo mismo el contador de no leídos (layouts y badge), los informes de la profe y los avisos de inicio.
  - **Páginas de un registro de otro centro** (decisión del responsable): `teacher/aula/[id]` y sus subpáginas (`fotos`, `servicio`, `comida`) y `alta/[ninoId]` sacan el rol con `contextoEnCentro(centro del aula o del niño)`. Se muestran aunque no sea el centro activo; el enlace funciona siempre. Para quien tiene más de un centro, `AvisoCentroDistinto` dice en la cabecera qué centro está viendo. `comida` cargaba el aula sin mirar su centro y ahora usa el del aula.
  - **El CSV de recibos** lee el estado sin redirigir (`getEstadoCentro`): sin centro activo, 403.
  - Las listas bajan: lecturas pendientes de 16 a 2, y `PENDIENTES_GET_CENTRO` de 41 ficheros y 89 usos a 27 y 59.
- **Parada en el PR3:** `usuarios/[id]/avatar/route.ts` (sus 2 lecturas siguen pendientes). La foto de perfil es del usuario, no de un centro, y el centro solo es el prefijo de la ruta en Storage. Hace falta decidir qué prefijo usar con varios centros. Resuelta en el PR del avatar (abajo).
- **PR4 (cobros, 19 ficheros):**
  - **Centro de la página** en las acciones de todo el centro: proponer y reproponer asignaciones, generar y recalcular el mes, crear remesa, datos del acreedor y las cargas de beca. Reciben `centroId` del panel de `admin/cuotas`.
  - **Centro del registro** en las que tocan una fila: el recibo (cobrado manual, devuelto, re-giro, gastos de devolución), la remesa, la familia (método de pago, recibo con línea manual), el concepto (tarifas), el niño (elegibilidad, recibo esporádico), el desborde y la transferencia.
  - Todas comprueban con `usuarioAdminEn(supabase, centro)` que quien llama es admin en ese centro. Antes, varias solo comprobaban que hubiera un centro activo. La RLS o la RPC siguen autorizando la escritura.
  - `PENDIENTES_GET_CENTRO` baja de 27 ficheros y 59 usos a 8 y 18.
- **Avatar con prefijo propio** (decisión del responsable, 2026-10-19, migración `20261019120000`):
  - La ruta pasa de `{centroId}/{usuarioId}/…` a `{usuarioId}/…`. Quién ve la foto y quién la cambia sale de los centros donde el dueño tiene rol: `es_staff_de_usuario` (leer: admin o profe de un centro del dueño) y `es_admin_de_usuario` (escribir: admin de un centro del dueño), además del propio dueño. La ruta vieja queda cerrada.
  - La ruta del avatar ya no elige un centro (`limit(1)`) ni lee `roles_usuario`: para el avatar de otro pregunta a `es_admin_de_usuario`, y la RLS de Storage sigue siendo la que autoriza. El manifiesto de la purga lista la carpeta `{usuarioId}/`.
  - En producción no había ningún objeto que mover. Las 2 `foto_url` que apuntaban a un fichero inexistente pasan a NULL.
  - `purgar_sujeto_db` redacta también `foto_url` en las filas de `usuarios` de `audit_log`, como ya hacía con la del niño.
  - Lecturas de `roles_usuario` fuera del contexto: de 23 a 19, con 0 pendientes.
- **PR5 (cierre):**
  - **Centro de la página** (solo admin de ese centro, con `usuarioAdminEn`): crear plantilla de autorizaciones, abrir campaña y crear plantilla de informes. El anuncio recibe el centro de la página y toma el rol del usuario en ese centro (`rolesEnCentro`).
  - **Centro del registro:** el informe, el del niño (y la plantilla tiene que ser de ese centro); el lote, el de la campaña (y el aula indicada tiene que ser de ella); el prospecto y la vista previa de su tutor, el del curso (`centroDelCurso`).
  - Se borran `getCentroActualId` y `getRolEnCentro` (`features/centros/queries/get-centro-actual.ts`) y las listas de pendientes del guard. `PENDIENTES_GET_CENTRO` baja de 8 ficheros y 18 usos a nada.
- **PR6 (sin lista):**
  - `contexto/roles-de-otros.ts`: `tieneRolesVivos` (clasifica una cuenta ajena; sustituye a las 6 lecturas idénticas de la invitación, el tutor directo, la detección por email, completar en dirección, invitar al alta y el tutor del prospecto), `contarRolesDelCentro` (inicio de Dirección), `rolesDelSujetoParaExport` (art. 15), `rolesDeAutores` (etiqueta de los mensajes), `tieneRolProfeEn` (asignar a un aula), `tieneRolFamiliarEn` (crear un vínculo), `profesDelCentroConNombre` (candidatos) y `profesDelCentro` (audiencias).
  - `contexto/escribir-roles.ts`: `asignarRolDeInvitacion` y `retirarRolesDeCuentaNueva`. 5 de las 6 «lecturas» de `accept-invitation.ts` eran escrituras (2 `insert` y 3 `delete` de vuelta atrás); también pasan al módulo.
  - `roles-del-usuario.ts`: `rolesEnCualquierCentro`, la del proxy (roles del usuario actual sin centro, para el prefijo de ruta).
  - Cada función conserva lo que el sitio hacía con un fallo de lectura (las seis de clasificar cuenta lo tomaban como «sin roles», salvo la detección por email, que devuelve `null`).
  - El guard imprime: 786 ficheros revisados, 0 usos de `roles_usuario` fuera del contexto (12 dentro), 0 menciones de las funciones borradas.
- **Contadores y agenda (2026-10-19, después de la Fase 2 · PR A):** quedaba lo que va por usuario y no por centro, que ya afectaba a un profe en A que es tutor en B.
  - Migración `20261021120000_fix_contadores_por_centro`: `contar_recordatorios_pendientes(p_centro_id)` y `contar_invitaciones_pendientes(p_centro_id)`, y fuera sus versiones sin centro.
  - Los badges de recordatorios y de la agenda cuentan los del centro de la página.
  - La lista de `/reminders` y los niños que se ofrecen para recordatorios y citas (`getNinosParaRecordatorios`) también son los del centro de la página. Las citas de `/agenda` ya lo eran desde la Fase 2 (`getCitasRango`, ADR-0058).
- **Mensajería (2026-10-19, después de los contadores):** el badge de mensajes se quedó fuera del PR de los contadores.
  - `countNoLeidos` cuenta las conversaciones del profe o el tutor y los anuncios del centro de la página. Su rama del admin (sus hilos dirección↔familia) va con el hilo por centro, en el PR B de la Fase 2.
  - La lista de anuncios de `/messages` (`getAnunciosDelUsuario`) y la supervisión de la directora (`getConversacionesDelUsuario`) son las del centro de la página. Antes, una directora de dos centros supervisaba en A las conversaciones de B.
  - Sin migración: la RLS deja leer lo de todos los centros del usuario, y el centro lo pone la consulta.
- **Detalle de una conversación por URL (2026-10-19, después del PR B de la Fase 2):** `/messages/conversacion/[id]` enseñaba la conversación de otro centro del usuario bajo el centro activo.
  - `getConversacionDetalle` y `getAdminFamiliaDetalle` reciben el centro de la página y devuelven `null` si la conversación es de otro: la página responde «no encontrado», como los detalles de la Fase 1 y de la Fase 2.
  - Abrir el enlace de una notificación de otro centro también da «no encontrado» hasta cambiar de centro: el centro activo es el de la cookie, y la URL no lo lleva.

## Alternativas descartadas

- **Coger un centro por defecto** (el primero, el más antiguo…). Es justo lo que falló en MisterFC (#755).
- **Guardar el centro activo en `usuarios`.** Lo compartirían todas las pestañas y dispositivos, y cambiarlo sería una escritura auditada por cada cambio de centro.
- **Que las acciones lean la cookie.** Una pestaña antigua escribiría en el centro elegido después en otra. Las acciones reciben el centro explícito: de la página o del registro que tocan.

## Consecuencias

- **Positivas:** hay un solo sitio que decide el centro, con test. Quien tiene un centro no nota nada. El guard impide reintroducir el `limit(1)`.
- **Negativas:**
  - Un usuario con varios centros que llega por un enlace profundo sin cookie pasa por el selector y después al reparto por rol, no al enlace: los layouts no conocen la ruta. Se puede añadir cuando haga falta.
- **Fuera de esta fase:** el proxy sigue igual (deja pasar con un rol de cualquier centro; el superusuario entra en la Fase 3).
- **Entra en este PR, encontrado al hacerlo:**
  - El login hacía `router.push(returnTo)` sin validar. Era una redirección abierta: un enlace de login con `returnTo=https://…` sacaba del sitio al usuario recién autenticado. Ahora pasa por `rutaInterna` (`src/shared/lib/ruta-interna.ts`), la misma validación que usa el selector de centro.
  - La cookie `nido_active_role` que escribía el selector de rol no la leía nadie. Se borra, para no tener una cookie de sesión muerta junto a la del centro. Era de sesión (sin `Max-Age`), así que la que quede en algún navegador desaparece al cerrarlo.

## Verificación

- `src/features/centros/contexto/__tests__/resolver.test.ts`: las reglas, con un usuario en dos centros. Cubre cookie de uno, del otro, ausente, ajena y basura, y que un centro nunca enseña selector.
- `get-contexto-centro.test.ts`: el contexto con los dos centros y las redirecciones. `contextoEnCentro` ignora la cookie.
- `elegir-centro.test.ts`: solo escribe la cookie con un centro suyo, y `returnTo` no saca de la app.
- `ConmutadorCentroServidor.test.tsx`: con un centro no se pinta nada ni se consulta.
- `src/test/rls/multicentro-contexto.rls.test.ts`: contra la BD, el usuario de dos centros lee sus dos roles y los nombres de A y B, nunca de C.
- `src/test/guards/check-centro-activo.test.ts`: el árbol real cumple (0 fuera, con la premisa de que revisa ficheros y caza los usos de dentro del módulo) y no hay fichero de lista. En un árbol de mentira se pone rojo cada caso: lectura del usuario actual, lectura de otro usuario, escritura, una lista de excepciones pasada al guard (no la respeta), mención de las funciones borradas en un import multilínea o en un comentario. Una lectura en un comentario no cuenta.
- `src/test/rls/roles-de-otros.rls.test.ts` (PR6): contra la BD, cada función del módulo filtra lo que dice su nombre (centro, rol, roles borrados), y las de escribir asignan y retiran.
- `src/test/multicentro/cierre-centro-explicito.test.ts` y `publicar-anuncio-centro.test.ts` (PR5): con roles en dos centros, cada acción usa el centro de la página o el del registro, nunca el primero.
- `src/test/rls/contadores-por-centro.rls.test.ts`: un usuario profe en A y tutor en B; los dos badges, la lista de recordatorios y los niños para recordatorios, cada uno con lo de su centro, y las RPCs sin centro ya no existen.
- `src/test/rls/mensajeria-por-centro.rls.test.ts`: el mismo usuario y una directora de dos centros; el badge de mensajes, la lista de anuncios y la supervisión, cada uno con lo de su centro.
- `ruta-interna.test.ts` y `LoginForm.returnTo.test.tsx`: el login solo sigue rutas internas. `RoleSelector.test.tsx`: no escribe cookies.

## Referencias

- MisterFC #755/#757/#758 (club equivocado) y #756 (500 por reescribir la cookie en el render).
- ADR-0053 (postura de seguridad, multicentro en la BD).
