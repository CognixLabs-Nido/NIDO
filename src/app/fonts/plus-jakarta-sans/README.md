# Plus Jakarta Sans

Fuente de la app (`--font-jakarta`), servida desde el repo con `next/font/local`
(`src/app/[locale]/layout.tsx`). Antes se descargaba de Google en cada build con
`next/font/google`, y el build caía de forma intermitente (`docs/dev-setup.md`).

- **Fichero:** `PlusJakartaSans[wght].woff2`, la fuente **variable** (eje `wght`, de 200 a 800), una
  sola para los cinco pesos que usa la app (400, 500, 600, 700 y 800).
- **Origen:** <https://github.com/tokotype/PlusJakartaSans>, commit
  `18d1cd2f7ea10481919d2f05c1f7064b7307fc26` (2024-01-18), `fonts/webfonts/PlusJakartaSans[wght].woff2`.
  Copiado **sin modificar** y con su nombre original.
- **sha256:** `49c62cf1fb70f225ea113361f0134a48858c3a7d0175173aa3e38a0c6c8539d2` (60.612 bytes).
- **Versión:** 2.071, la misma que servía Google Fonts el 2026-11-05.
- **Licencia:** SIL Open Font License 1.1, en `OFL.txt` (copia exacta de la del origen), y también
  dentro del propio fichero (campos de nombre 0, 13 y 14). Sin «Reserved Font Name». Como el fichero no
  se modifica, no hay nada más que cumplir: viaja con su licencia y no se vende sola.

**Es la misma fuente que servía Google** (medido el 2026-11-05 contra el fichero que precargaba
producción): Google servía un recorte de esta misma fuente variable a 229 caracteres, y en esos 229 el
contorno, la variación por peso y el avance son idénticos. Lo que trae de más este fichero son los
caracteres que el recorte no tenía: el latín extendido (Ş, Ł, ő, Č…) y las flechas `→ ← ↔`.

**Si se actualiza la fuente**, se sustituye el fichero por el nuevo del mismo repositorio, sin
recortarlo, y se actualizan aquí el commit, el sha256 y la versión.
