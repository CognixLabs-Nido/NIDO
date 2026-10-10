# ADR-0055: Suite RLS en una BD efímera en la CI, y la remota como red nocturna

## Estado

`accepted`. La decisión se tomó y se aplicó el 2026-10-02; este ADR la documenta después, el
2026-10-10.

**Fecha:** 2026-10-02 (#287, #288, #294)
**Autores:** responsable + claude-code
**Fase del proyecto:** CI, después de F12-B (pasos F0 a F3).

## Contexto

La suite RLS y de auditoría (`npm run test:rls`: `src/test/rls/**` y `src/test/audit/**`) corría en
cada PR contra la **base de datos remota compartida**, la de producción (`rls-suite.yml`).

- **Era lenta y en serie.** Vitest va fichero a fichero (`fileParallelism: false`) y el bloque
  `concurrency` de `rls-suite.yml` encola los runs para que nunca haya dos tocando la BD a la vez.
  Un run tardaba unos 37 minutos (36 min 44 s en #287) y los PRs esperaban unos a otros.
- **Los tests de una migración nueva no corrían en su PR.** Las migraciones las aplica el
  responsable a mano por el SQL Editor (el CLI da SIGILL en el equipo ARM). Hasta que se aplicaban,
  sus tests iban apagados con un flag `*_APPLIED`, y después hacía falta otro PR para encenderlos.
- **Antes había sido peor.** `docs/follow-ups.md` recoge que en junio la suite RLS estaba en rojo
  estable en `main` porque la BD de la CI no recibía las migraciones aplicadas a mano, y los PRs se
  mergeaban con la CI roja.

La BD de NIDO no se había reconstruido desde cero desde mayo. Nadie sabía si las migraciones del
repo, aplicadas en limpio, daban el mismo esquema que producción.

## Opciones consideradas

### Opción A: seguir contra el remoto compartido en cada PR

**Pros:** valida lo que de verdad está aplicado.

**Contras:** unos 37 minutos por run, en serie entre PRs; los tests de la migración del PR no corren
hasta aplicarla; la CI crea fixtures en la BD de producción.

### Opción B: un proyecto Supabase de test dedicado

Es el plan «A′» de `docs/follow-ups.md`: otro proyecto, migraciones por `db push` desde la CI,
secrets propios y un control de deriva.

**Pros:** saca los fixtures de producción.

**Contras:** sigue siendo una BD compartida entre PRs, con la misma serialización y latencia de red.
Es otro proyecto que mantener, con secrets y estado entre runs.

### Opción C: una BD efímera por run con `supabase start`

La BD se levanta en el propio runner y se construye con las migraciones del repo, las del PR
incluidas.

**Pros:** cada run tiene su BD; no hay serialización entre PRs ni latencia de red; los tests de la
migración del PR corren en ese PR; no hace falta ningún secret.

**Contras:**

- Valida el **repo**, no producción: una migración aplicada a mano distinta de su fichero no se ve.
- Exige que todas las migraciones se puedan aplicar desde cero.

## Decisión

**Se elige la Opción C, con la remota como red de seguridad nocturna.**

- `rls-local.yml` es el check de RLS de los PRs y valida el repo.
- `rls-suite.yml` deja de correr en los PRs: queda nightly (`cron: '0 2 * * *'`) y manual, por
  ejemplo justo después de aplicar una migración. Valida producción y caza la deriva entre una
  migración aplicada a mano y su fichero.

En F1 (#287) las dos corrieron sobre el mismo commit con el mismo resultado: 105/105 ficheros y
706/706 tests, con la lista fichero a fichero idéntica.

Antes de decidir, F0 (rama desechable `spike/f0-rls-efimera`) aplicó las 137 migraciones de
entonces en limpio y comparó el catálogo de la BD local con el remoto: 2.175 objetos (funciones con
su cuerpo normalizado y permisos, tablas, columnas, constraints, índices, policies de `public` y
`storage`, triggers, enums, buckets, Vault y privilegios por defecto). Salió idéntico salvo el
bucket `cartilla-vacunas`.

Decisiones internas:

| Disyuntiva                                   | Opciones                                               | Decisión y motivo                                                                                                                                                                                                                                                                                                                                                 | Dónde |
| -------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| La única migración que no aplicaba en limpio | parchearla solo en la CI / **editar el fichero**       | `20260516120013` tenía dos `DROP TRIGGER IF EXISTS … ON <tabla>`: el `IF EXISTS` cubre el trigger, no la tabla, y en una BD vacía da 42P01. Se quitaron: el `DROP TABLE … CASCADE` siguiente ya se lleva esos triggers y el remoto no la vuelve a ejecutar. **Excepción explícita** a la regla de no tocar migraciones aplicadas, explicada en el propio fichero. | #287  |
| Flags `*_APPLIED` en la BD efímera           | lista a mano / **todos a `'1'`, sacados de los tests** | La BD tiene todas las migraciones del repo, así que ningún test se salta. Se obtienen con un `grep` de `process.env.*_APPLIED` en `src/test`: un flag nuevo entra solo.                                                                                                                                                                                           | #287  |
| Comprobar que la BD es el repo               | confiar en `supabase start` / **comparar**             | Un paso compara `schema_migrations` con los ficheros de `supabase/migrations` con `diff` y falla si no coinciden.                                                                                                                                                                                                                                                 | #287  |
| Secretos de Vault                            | secrets del repo / **aleatorios por run**              | `[db.vault]` en `config.toml` con `env()`. La CLI los crea antes de migrar, y la migración que los usa aborta sin ellos. A la suite le vale cualquier clave porque cifra y descifra en la misma BD.                                                                                                                                                               | #287  |
| Límites de Auth                              | los de serie / **subirlos**                            | `sign_in_sign_ups`, `token_refresh` y `token_verifications` a 100000. Con 30 cada 5 minutos la suite daba 429. Solo afecta a la BD local.                                                                                                                                                                                                                         | #287  |
| Paralelismo                                  | todo en un job / **3 shards con una BD cada uno**      | `vitest --shard=i/3`, cada shard en su runner con su `supabase start`: no comparten BD, Auth ni Storage. Dentro de cada shard la suite sigue en serie, porque hay tests que miran estado global (el `listUsers` del wipe, la retención, `audit_log` sin filtro). Un 4.º shard ahorraba unos 20 s y añadía otro coste fijo de unos 95 s.                           | #288  |
| Qué check marcar como obligatorio            | los shards / **un job resumen**                        | `RLS + audit (BD efímera)` suma los informes JSON y falla si falta o sobra algún fichero del proyecto `rls`, si alguno se repite entre shards, si llegan menos de 3 informes o si algún test no pasa. Su nombre no cambia aunque cambie N.                                                                                                                        | #288  |
| Versión de la CLI                            | `latest` / **fija**                                    | Con `latest`, los 3 shards preguntaban a la vez a la API de GitHub y agotaban el rate limit (un shard murió en #292). Se fija la 2.119.0, que se descarga directamente.                                                                                                                                                                                           | #294  |
| Servicios que se levantan                    | todos / **los que usa la suite**                       | `supabase start -x studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta`: BD, Auth, PostgREST, Storage y el buzón de correo local.                                                                                                                                                                                                       | #287  |
| Bucket `cartilla-vacunas`                    | reconciliarlo / **documentarlo**                       | `20260620120000` borra sus policies por SQL y deja el bucket para borrarlo a mano por la Storage API (SQL no puede borrar buckets). En el remoto se borró; en la BD efímera existe, vacío y sin policies. Ningún test lo usa.                                                                                                                                     | #287  |

## Consecuencias

### Positivas

- El check de RLS de un PR pasa de 36 min 44 s a 3 min 36 s de reloj (#288), sin esperar a otros
  PRs.
- Los tests de la migración de un PR corren en ese PR, antes de aplicarla.
- Se sabe que el repo reconstruye la BD entera: cada PR aplica todas las migraciones desde cero.
- La CI de los PRs ya no crea fixtures en la BD de producción. La nocturna sí, una vez al día.
- A 2026-10-10 corren 117 ficheros y 942 tests, todos en verde y sin saltados, con 75 flags.

### Negativas

- **La deriva entre producción y el repo solo se ve de noche.** Si se aplica a mano una migración
  distinta de su fichero, el PR sale verde y la nocturna es la que avisa.
- **Se editó una migración aplicada.** Es una excepción única y queda explicada en el fichero; la
  regla general sigue en pie.
- **El check no bloquea el merge.** `main` no tiene branch protection ni rulesets (comprobado por la
  API el 2026-10-10). Marcar `RLS + audit (BD efímera)` y `Typecheck, Lint, Test` como obligatorios
  es configuración del repo y le corresponde al responsable.
- Quien haga `supabase start` o `db reset` en local tiene que exportar `MEDICAL_ENCRYPTION_KEY` y
  `SEPA_ENCRYPTION_KEY` (vale cualquier valor). Hoy nadie lo hace en local, por el SIGILL del CLI
  en ARM.

### Neutras

- Nueva costumbre: cada migración aplicada lleva un PR de una línea que activa su flag en la
  nocturna. La BD efímera no lo necesita.
- Los E2E (Playwright) siguen fuera de la CI. Es otro trabajo.

## Plan de implementación

- [x] F0: rama desechable `spike/f0-rls-efimera`, BD construida entera y diff de catálogo con el
      remoto.
- [x] F1 (#287): `rls-local.yml`, edición de `20260516120013`, `[db.vault]` y límites de Auth en
      `config.toml`. Las dos suites en paralelo para comparar.
- [x] F2 y F3 (#288): la remota sale de los PRs y la local se reparte en 3 shards con su job resumen.
- [x] #294: CLI fijada a la 2.119.0.
- [ ] Branch protection en `main` con los dos checks obligatorios (responsable).

## Verificación

- En cada PR, el job `RLS + audit (BD efímera)` imprime el total: por ejemplo, el 2026-10-10,
  `TOTAL: 3 shards, 117 ficheros (esperados 117), 942 tests: 942 ok, 0 fallidos, 0 saltados`.
- La nocturna `RLS suite (remote DB)` corre cada día desde `main`; las cuatro últimas (6 al 9 de
  octubre) salieron en verde.
- El paso «Comprobar migraciones aplicadas» falla si alguna migración no entra en limpio.

## Notas

- No hubo documento de diseño previo. Los datos de F0 y F1 (tiempos, catálogo y comparación) están
  en el cuerpo de #287, y los de F3 en #288.
- Editar `20260516120013` (frente a parchearla solo en la CI) y documentar el bucket
  `cartilla-vacunas` sin reconciliarlo fueron elección del responsable: la opción A en las dos. Lo
  confirmó por escrito el 2026-10-10; hasta entonces solo constaba lo que se hizo en #287.

## Referencias

- Workflows: `.github/workflows/rls-local.yml`, `.github/workflows/rls-suite.yml`.
- Configuración: `supabase/config.toml` (`[db.vault]` y límites de Auth).
- Migración editada: `20260516120013_revert_phase4_5_menus_drift.sql`.
- PRs: #287, #288, #292, #294.
- Follow-ups que cierra: «Salud de CI — la suite RLS está roja en `main`» y «CI — activar los tests
  RLS gateados por `F11_ALTA_P3A_MIGRATION_APPLIED`» (`docs/follow-ups.md`).
