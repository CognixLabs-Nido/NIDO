# Plus Jakarta Sans

Fuente de la app (`--font-jakarta`), servida desde el repo con `next/font/local`
(`src/app/[locale]/layout.tsx`). Antes se descargaba de Google en cada build con
`next/font/google`, y el build caía de forma intermitente (`docs/dev-setup.md`).

- **Origen:** <https://github.com/tokotype/PlusJakartaSans>, commit
  `18d1cd2f7ea10481919d2f05c1f7064b7307fc26` (2024-01-18), carpeta `fonts/webfonts/`. Los ficheros
  se copian **sin modificar**.
- **Versión:** 2.071, la misma que servía Google Fonts el 2026-11-05.
- **Licencia:** SIL Open Font License 1.1, en `OFL.txt` (copia exacta de la del repositorio de
  origen). Sin «Reserved Font Name»: el copyright no declara ninguno. La OFL permite usarla,
  incluirla y redistribuirla con software, también comercial, siempre que la licencia viaje con los
  ficheros y la fuente no se venda sola.
- **Pesos:** los cinco que usa la app, estáticos, sin cursiva: 400 (Regular), 500 (Medium), 600
  (SemiBold), 700 (Bold) y 800 (ExtraBold). La fuente variable no se usa.
- **Cobertura:** 721 glifos por peso: latín, latín extendido (Ş, Ł, ő, Č…), los signos de los textos
  (`… ’ € — – “ ”`) y las flechas `→ ← ↔`. El subconjunto `latin` que servía Google tenía 229 y no
  traía las flechas, que salían en la fuente del sistema.

| Fichero                           | sha256                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| `PlusJakartaSans-Regular.woff2`   | `f282de8041ff1231d64336ab69ecea03f2a31c127fe509ec7b99814ff2fb9b41` |
| `PlusJakartaSans-Medium.woff2`    | `82230f155c78b9de1a3773bab92f6a90b23c702410133fe7fd656fb2750c5f03` |
| `PlusJakartaSans-SemiBold.woff2`  | `16387125b045457b8d49123d31bcc143e696cf9e867831f8ae41eb244b11106e` |
| `PlusJakartaSans-Bold.woff2`      | `8d76ee4c4f645bc12ebdeae87f8ec2468bade2d4f04458416848229bcc804342` |
| `PlusJakartaSans-ExtraBold.woff2` | `c4c1c8447c65415eaca5caccd25a9699bfa03f8c0176b63e42ac5631006c88b7` |
