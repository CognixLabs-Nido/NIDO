# ADR-0056: Seguimiento de errores con Sentry, región UE y sin datos personales

## Estado

`accepted`

**Fecha:** 2026-10-16
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 11 — Pulido final + producción

## Contexto

Hasta ahora NIDO no tenía seguimiento de errores. `logger.error` escribía en la consola, es decir, en los logs de Vercel: un error del navegador de una familia no llegaba a ninguna parte y uno del servidor había que buscarlo a mano. No había página de error: un fallo sin recoger dejaba la pantalla por defecto de Next.

NIDO trata datos de menores (salud, fotos, recogidas, DNIs de terceros). Cualquier herramienta de errores es un **sub-encargado** del tratamiento y recibe lo que la app le mande. La regla de partida es la del responsable: **con menores de por medio, ningún dato personal sale de nuestra infraestructura.**

## Opciones consideradas

### Opción A: Sentry, plan gratuito, región UE (Frankfurt)

**Pros:**

- Agrupa errores de navegador y servidor, con source maps.
- La región UE guarda los datos en Frankfurt.
- SDK oficial para Next.js, con soporte de Turbopack desde Next 16.
- El SDK permite apagar la recogida de datos campo a campo y filtrar cada evento antes de enviarlo.

**Contras:**

- Empresa con sede en EE. UU.: el DPA y el mecanismo de transferencia los tiene que validar el abogado (⚖️).
- Plan gratuito con cuota mensual de eventos.

### Opción B: GlitchTip

**Contras:** no confirma dónde aloja los datos, y sin eso no se puede poner en el DPA. Descartada.

### Opción C: highlight.io

**Contras:** cerró en febrero de 2026. Descartada.

### Opción D: la observabilidad de Vercel

**Contras:** no es seguimiento de errores. No recoge los errores del navegador ni los agrupa. Descartada.

### Opción E: no hacer nada

**Contras:** los errores de las familias seguirían sin verse.

## Decisión

**Se elige la Opción A: Sentry, plan gratuito, región UE.** Las demás se descartaron solas.

`@sentry/nextjs` se fija en **11.1.0**, la versión exacta. En la v11, `sendDefaultPii` **ya no existe**: lo sustituye `dataCollection`, cuyos valores por defecto lo recogen todo (IP y datos del usuario, cookies, cabeceras, cuerpos HTTP, query de las URLs, datos de las consultas a la BD y variables locales de los stack frames). Poner `sendDefaultPii: false` no haría nada.

## Qué se envía y qué no

Solo **eventos de error**. Ni trazas de rendimiento, ni logs, ni métricas, ni sesiones, ni grabación de sesiones, ni formulario de feedback.

| Se envía                                                                 | No se envía                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Tipo y mensaje del error, con los datos personales reconocibles tachados | `user` (id, email, IP), ni la IP deducida por Sentry                  |
| Stack trace: fichero, función, línea                                     | Variables locales de los frames; líneas de código alrededor           |
| Método y ruta de la petición, con los identificadores tachados           | Cabeceras, cookies, cuerpo y query de la petición                     |
| Navegador, sistema, idioma y huso                                        | Migas de consola y de interfaz (clics, teclado)                       |
| Migas de navegación y de peticiones, sin query y con ids tachados        | Campos cuyo nombre suena a dato personal (email, DNI, salud, nombre…) |
| Entorno (`production`/`preview`) y versión (commit)                      | Grabación de sesiones, trazas, logs, métricas, sesiones, feedback     |

## Cómo se garantiza

Cada capa es independiente y no confía en las demás. Todo vive en `src/shared/lib/sentry/`.

1. **Solo la UE.** `dsnDeLaUE` acepta únicamente DSN de `*.ingest.de.sentry.io`. Con un DSN de otra región, Sentry queda **apagado**: la región la fija el DSN, no una casilla que se pueda olvidar.
2. **Recogida apagada.** `dataCollection` con todas sus categorías a `false` (`RECOGIDA_DE_DATOS_APAGADA`). Un test obliga a decidir sobre cualquier categoría nueva que añada el SDK.
3. **Integraciones del navegador por lista de permitidas.** Solo las que capturan el error (`INTEGRACIONES_CLIENTE_PERMITIDAS`). Replay, Feedback, BrowserTracing, BrowserSession o Console quedan fuera aunque una versión futura las active por defecto. Además, `replaysSessionSampleRate` y `replaysOnErrorSampleRate` van a 0. En el servidor se quitan las sesiones (`ProcessSession`), las variables locales y la consola; el resto sostiene el aislamiento por petición. **Las sesiones no pasan por `beforeSend`** y llevan el id y la IP del usuario: lo destapó la CI de #359, donde el test de punta a punta se puso rojo (en local pasaba porque sin `release` el SDK no manda sesiones; el test fija ahora una `release`).
4. **Sin trazas.** No hay `tracesSampleRate` ni `tracesSampler`: con `tracesSampleRate: 0` las trazas quedarían encendidas con muestreo 0. `beforeSendLog` y `beforeSendMetric` devuelven `null`.
5. **`beforeSend` = `limpiarEvento`**, la última barrera:
   - quita `user`, `server_name`, la petición (salvo método y ruta) y las variables de los frames;
   - sustituye entero cualquier campo cuyo nombre delate un dato personal o un secreto;
   - en todo texto tacha email, DNI/NIE, IBAN, teléfono, UUID, JWT/Bearer y la query de las URLs;
   - descarta las migas de consola y de interfaz.
6. **Túnel.** Los eventos del navegador salen por `/monitoring`, en nuestro dominio (`tunnelRoute`), así Sentry no ve la IP de la familia. Además, con `userInfo: false` el SDK le pide a Sentry que no deduzca la IP (`infer_ip: never`). El proxy excluye esa ruta.
7. **Source maps** se suben solo con `SENTRY_AUTH_TOKEN` y se borran del build después de subirlos: no quedan públicos.

`logger.error` envía el error a Sentry con `captureException`; el detalle completo se queda en la consola (los logs de Vercel). `src/app/global-error.tsx` recoge lo que nadie más recogió, lo envía y no enseña el mensaje del error.

## Consecuencias

### Positivas

- Se ven los errores de navegador y servidor, agrupados y con su stack legible.
- Lo que sale está acotado por código con test, no por un convenio.

### Negativas

- **Límite conocido:** un nombre propio suelto en un texto libre no tiene patrón y pasaría. Lo cubre el convenio de no meter datos personales en errores ni logs (`docs/conventions.md`).
- Los UUID se tachan: para cruzar un evento con un registro concreto hay que ir a los logs de Vercel por hora y ruta.
- Sin trazas de rendimiento.
- ⚖️ Sentry queda como sub-encargado. Su DPA y la transferencia internacional (matriz en EE. UU.) los valida el abogado (F11-B).

### Neutras

- Variables nuevas: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. Sin DSN (local, CI, tests) Sentry no se inicializa y la app funciona igual.

## Plan de implementación

- [x] `@sentry/nextjs` 11.1.0, `withSentryConfig` en `next.config.ts`, `src/instrumentation.ts` y `src/instrumentation-client.ts`.
- [x] `src/shared/lib/sentry/` (opciones y limpieza), `logger.error` → `captureException`, `src/app/global-error.tsx`.
- [x] Proxy: `/monitoring` fuera del matcher.
- [ ] Cuenta de Sentry en la región UE y variables en Vercel (lo hace el responsable).
- [ ] En la configuración del proyecto de Sentry: «Prevent Storing of IP Addresses» y los «Data Scrubbers» activados, como capa extra.

## Verificación

- `src/shared/lib/sentry/__tests__/limpiar-evento.test.ts`: un evento con datos personales en todos los campos sale sin ninguno (mira el evento serializado entero) y conserva lo técnico. Control negativo medido: desactivando cada capa por separado (identidad, claves, patrones, migas, variables, petición), el test se pone rojo.
- `src/shared/lib/sentry/__tests__/opciones.test.ts`: solo la UE, recogida apagada, sin trazas, lista de permitidas y, **con el SDK real** y un transporte falso, que lo que se enviaría no lleva ni el usuario, ni la IP, ni los datos. Comprueba además que no sale ningún envío de sesión. Control negativo medido: sin `beforeSend`, con cualquier región, sin lista, con `userInfo`, con `tracesSampleRate: 0` o con `ProcessSession` en el servidor, rojo.
- `logger.test.ts`, `global-error.test.tsx`, `textos.test.ts` (los textos de la página de error coinciden con `messages/`).

## Referencias

- Specs relacionadas: `docs/specs/proteccion-datos.md` (sub-encargados, Comportamiento 6)
- ADRs relacionados: ADR-0053 (postura de seguridad)
- `docs/architecture/auth-proxy.md` (matcher)
