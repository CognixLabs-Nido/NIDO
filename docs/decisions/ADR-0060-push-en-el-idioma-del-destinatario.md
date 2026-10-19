# ADR-0060: Las notificaciones push van en el idioma de quien las recibe

## Estado

`accepted`

**Fecha:** 2026-10-19
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 11 — pulido (fallo de i18n anterior al multicentro)

## Contexto

Cada envío de push se construía una sola vez con el idioma del **autor** (`getAutorPushInfo` devolvía su `idioma_preferido`) y se mandaba igual a todos los destinatarios:

- el enlace (`/{idioma}/…`) abría la página en el idioma del autor: si la profe tiene la app en valenciano, la familia que la tiene en castellano la abría en valenciano;
- los textos traducidos también: el título del anuncio («Nuevo anuncio del centro») y el texto del evento editado;
- y el texto de un evento cancelado ni se traducía: era un «Cancelado: …» fijo en castellano para todos.

Afectaba a seis envíos: el mensaje con la profe, el hilo dirección↔familia, el anuncio y los tres del calendario (crear, editar y cancelar, desde dos sitios), y el recordatorio. El séptimo, el alta de un hermano, ya leía el idioma de su único destinatario.

El enlace y el texto son la misma notificación: arreglar solo el enlace dejaría el aviso en un idioma y la página en otro.

## Opciones consideradas

### Opción A: un envío por idioma

Agrupar a los destinatarios por `usuarios.idioma_preferido`, construir la notificación una vez por idioma (título, texto y enlace) y hacer un envío por grupo.

**Pros:** cada uno la recibe entera en su idioma. Como mucho tres construcciones por envío (es, en, va). El motor de envío no cambia.

**Contras:** una consulta más (los idiomas de los destinatarios) y hasta tres envíos en lugar de uno.

### Opción B: un envío por destinatario

**Pros:** lo más simple de razonar.

**Contras:** construye y traduce la notificación una vez por persona (un anuncio de centro va a decenas de familias) para obtener, como mucho, tres resultados distintos.

### Opción C: mantener el idioma del autor (statu quo)

**Contras:** es el fallo.

## Decisión

**Se elige la Opción A.** `enviarPushPorIdioma(destinatarios, construir)` (en `src/features/push/lib/enviar-por-idioma.ts`) agrupa por idioma con `idiomasDeUsuarios` y llama al motor `enviarPushANotificarUsuarios` una vez por grupo. `construir(idioma)` devuelve la notificación de ese idioma.

- Quien no tiene un idioma de la app (sin perfil legible) recibe el de por defecto (`routing.defaultLocale`).
- Cada grupo va por su cuenta: si uno falla al construirse, los demás se envían igual. No lanza nunca, como el motor.
- `getAutorPushInfo` ya **no devuelve el idioma** del autor, solo su nombre: el tipo impide volver a construir una notificación con él.
- El texto de cancelar un evento pasa a ser la clave `eventos.push.cancelado`, en los tres idiomas.

## Consecuencias

### Positivas

- La notificación, su texto y la página que abre van en el idioma de quien la recibe.
- Un censo (`src/test/guards/push-por-idioma.test.ts`) fija quién llama al motor directamente: el motor, el envío por idioma y el alta de un hermano. Un envío nuevo que lo llame se pone rojo y tiene que pasar por `enviarPushPorIdioma`.
- Un test de i18n (`push-notificaciones-keys.test.ts`) exige cada texto de notificación en los tres idiomas y con los mismos huecos.

### Negativas

- Una consulta a `usuarios` por envío, con service role (el autor no lee el perfil de los demás).
- Hasta tres envíos al motor por notificación en vez de uno.

### Neutras

- El alta de un hermano sigue con su propio envío: tiene un solo destinatario y ya leía su idioma. Lo fija `vincular-hijo-push-idioma.test.ts`.
- Los correos de invitación no cambian: su idioma lo elige la Dirección al invitar (ver `rls-policies.md`, «Idioma de la cuenta en los correos de Auth»).

## Plan de implementación

- [x] `idiomasDeUsuarios` y `getAutorPushInfo` sin idioma (`push/lib/audiencia.ts`).
- [x] `enviarPushPorIdioma` (`push/lib/enviar-por-idioma.ts`).
- [x] Los seis envíos: `enviar-mensaje.ts` (dos), `publicar-anuncio.ts`, `eventos/lib/notificar.ts` (dos sitios, tres notificaciones) y `crear-recordatorio.ts`.
- [x] `eventos.push.cancelado` en es, en y va.
- [x] Tests de cada envío, del agrupado, del séptimo, del censo y de las claves.
