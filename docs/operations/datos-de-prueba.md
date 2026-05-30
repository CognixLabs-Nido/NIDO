# Datos de prueba persistentes — NIDO

Cuentas y registros de prueba que viven en el entorno **remoto** y **no deben borrarse**: validaciones futuras (manuales y de regresión) los reutilizan. Si una limpieza de tests los elimina, recrearlos con los mismos identificadores.

> ⚠️ **Repo público (regla 6).** Este archivo lista identificadores no-secretos (emails `.example` ficticios, nombres de fixture, UUIDs de fila, `centro_id`). **Las contraseñas NO se versionan aquí** — viven fuera del repo (gestor de secretos del responsable / `.env.local`). No añadas credenciales reales a este documento.

## Profes de prueba en ANAIA (creados validando el PR #40)

**Centro ANAIA** — `centro_id = 33c79b50-13b5-4962-b849-d88dd6a21366`.

| Email                       | Nombre             | `usuario_id` (UUID)                    |
| --------------------------- | ------------------ | -------------------------------------- |
| `profe1.test@anaia.example` | Profe Uno Pruebas  | `a24e44d6-6d49-43bf-a323-23d4644d57bf` |
| `profe2.test@anaia.example` | Profe Dos Pruebas  | `ba26d5c4-a083-4e8f-a5b2-6b96a3d4e5ce` |
| `profe3.test@anaia.example` | Profe Tres Pruebas | `fad13b8b-6371-422c-a07a-deae99951fa7` |

**Contraseña:** compartida para las 3 cuentas; **no versionada** (repo público). Pedir al responsable o consultar el gestor de secretos. _(Pendiente de rotar: es una password de bootstrap, ver follow-ups.)_

### Por qué persisten

Se crearon para validar la UI de asignación de personal a aulas (PR #40, item 4 del sprint pre-F6). Sirven como personal de prueba estable para `/admin/aulas` y para futuras validaciones de mensajería profe↔familia sin tener que dar de alta cuentas nuevas cada vez. Borrarlos obligaría a recrear las asignaciones de aula asociadas.
