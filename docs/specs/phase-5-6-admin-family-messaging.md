# Spec — Fase 5.6: Conversación admin ↔ familia + pulido de mensajería

**Estado**: Aprobada — Checkpoint A
**Estimación**: ~6-8h
**Depende de**: F5 (mensajería core, cerrada). NO depende de F5.5 push (aparcada).
**Rama**: `feat/phase-5-6-admin-family-messaging`

---

## 1. Objetivo

Añadir un canal de comunicación directo y temporal entre la dirección del centro (admin) y un tutor concreto, con caducidad automática. Además, aprovechar la fase para resolver dos mejoras del módulo de mensajería que afectan a la experiencia diaria: caducidad del "marcar como erróneo" y scroll contenido en la conversación.

La fase agrupa tres entregables:

- **F5.6-A** — Conversación admin ↔ familia con caducidad de 3 días reseteable.
- **F5.6-B** — "Marcar como erróneo" limitado a 5 minutos desde el envío.
- **F5.6-C** — Scroll interno tipo WhatsApp en la vista de conversación.

---

## 2. F5.6-A — Conversación admin ↔ familia

### 2.1 Decisiones de producto (cerradas en Checkpoint A)

| Decisión                | Valor                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Quién inicia            | Solo admin. La familia no tiene botón "iniciar"; ve la conversación cuando ya existe. |
| Ámbito                  | 1 conversación por par `(admin_concreto, tutor)`. Independiente del niño.             |
| Identificación del niño | En el contenido libre del mensaje. Sin metadato ni etiquetado de niño.                |
| Timer                   | 3 días desde el último mensaje. Se resetea con cada mensaje de cualquier lado.        |
| Aviso de caducidad      | No hay cron de aviso. La familia lo descubre al intentar responder.                   |
| Tras caducar            | Read-only visible para ambos.                                                         |
| Reapertura              | El admin puede reabrir la misma conversación (resucita el hilo, no crea uno nuevo).   |
| Multi-admin             | 1 hilo por admin concreto. Dos admins distintos = dos hilos con el mismo tutor.       |

### 2.2 Modelo de datos

Migración sobre la tabla `conversaciones` existente:

- `tipo_conversacion` — enum/text NOT NULL DEFAULT `'profe_familia'`. Valores: `profe_familia`, `admin_familia`.
- `nino_id` — pasa a **nullable** (solo aplica a `profe_familia`).
- `tutor_id` — uuid nullable, FK a `usuarios(id)`. Solo para `admin_familia`.
- `admin_id` — uuid nullable, FK a `usuarios(id)`. Solo para `admin_familia`.
- `expires_at` — timestamptz nullable. NULL en `profe_familia`; valor concreto en `admin_familia`.

**CHECK de coherencia**:

```
(tipo_conversacion = 'profe_familia'
  AND nino_id IS NOT NULL AND tutor_id IS NULL AND admin_id IS NULL AND expires_at IS NULL)
OR
(tipo_conversacion = 'admin_familia'
  AND nino_id IS NULL AND tutor_id IS NOT NULL AND admin_id IS NOT NULL AND expires_at IS NOT NULL)
```

**Unicidad** (índice parcial, no constraint, para no afectar a `profe_familia`):

```sql
CREATE UNIQUE INDEX idx_conv_admin_familia_unique
  ON conversaciones (admin_id, tutor_id)
  WHERE tipo_conversacion = 'admin_familia';
```

Esto garantiza una única conversación por par `(admin, tutor)` y soporta el patrón de reapertura vía UPSERT.

### 2.3 Trigger de reseteo del timer

`AFTER INSERT ON mensajes` que, si la conversación destino es `admin_familia`, refresca `expires_at`:

```sql
CREATE OR REPLACE FUNCTION reset_admin_familia_timer()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE conversaciones
  SET expires_at = now() + interval '3 days'
  WHERE id = NEW.conversacion_id
    AND tipo_conversacion = 'admin_familia';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

Notas:

- `AFTER INSERT` por semántica (el mensaje ya está; ahora actualizamos la fila padre).
- `SECURITY DEFINER` + `SET search_path` fija el contexto: el tutor puede insertar mensajes aunque no tenga UPDATE directo sobre `conversaciones`.
- El `UPDATE` solo afecta filas `admin_familia`, así que es no-op para `profe_familia`. Verificar que el trigger no entra en conflicto con triggers de audit log existentes (orden de ejecución).

### 2.4 RLS

- **SELECT en `conversaciones` / `mensajes`** (admin_familia): permitido a `admin_id` y a `tutor_id`. Visible **siempre**, incluso tras caducar (read-only).
- **INSERT en `conversaciones`** (admin_familia): solo si `auth.uid()` es admin del centro al que pertenece el tutor. La familia NO puede crear.
- **INSERT en `mensajes`** de una conversación admin_familia: bloqueado si `expires_at < now()`. Tanto admin como tutor. El admin debe reabrir primero.
- **UPDATE de `expires_at`** (reapertura): solo admin. Se hace vía server action, no exposición directa.

**Nota MVCC (lección F5)**: ningún helper invocado por las policies SELECT de `mensajes` o `conversaciones` debe leer su propia tabla. Si la lectura es necesaria, hacerlo row-aware (recibir campos por parámetro). Los helpers actuales (F5) leen tablas distintas — verificar que no introducimos regresión.

Tests RLS obligatorios — ver sección 6.

### 2.5 Server actions

- `abrirConversacionAdminFamilia(tutorId)` — UPSERT. Si existe el par `(admin, tutor)`: `UPDATE expires_at = now() + interval '3 days'` (reapertura). Si no: INSERT nueva conversación `admin_familia`. Solo ejecutable por admin. Devuelve `conversacionId`.
- `enviarMensaje` — se reutiliza la de F5. El trigger se encarga del reseteo del timer. Validar que el bloqueo por `expires_at` se respeta (RLS lo cubre, pero la action debe devolver error legible).
- Push: la llamada a `enviarPush` se mantiene (best-effort). Como el motor está aparcado, no es bloqueante; cuando se retome push, esto ya funcionará.

### 2.6 UI

**Lado admin**:

- Nueva sección/lista de tutores del centro con acción "Conversación con dirección" (icono chat o botón).
- Al pulsar: llama `abrirConversacionAdminFamilia(tutorId)` y navega a la conversación.
- Si el hilo está caducado: el admin ve botón "Reabrir conversación" + histórico read-only.

**Lado tutor**:

- La conversación admin↔familia aparece en `/messages` como un item más de la lista, identificado con badge "Dirección" (en lugar de aula/profe).
- Composer deshabilitado si `expires_at < now()`, con texto "Esta conversación con dirección se ha cerrado".
- Sin botón de reapertura (solo el admin reabre).

**Indicador de caducidad** (ambos lados):

- Texto sutil "Se cierra el [fecha]" o "Cerrada el [fecha]" según estado.
- Sin countdown en tiempo real (innecesario, evita complejidad).

**Reapertura por el admin**:

- La conversación reaparece para el tutor en su lista de `/messages` con badge de no leído **solo si el admin envía un mensaje** tras reabrir. La reapertura "vacía" (sin mensaje nuevo) no genera badge — evita ruido. Cuando F5.5 push esté activa, el primer mensaje post-reapertura disparará la notificación normal.

### 2.7 i18n

Nuevas claves en es/en/va: badge "Dirección", mensajes de caducidad, botón reabrir, texto composer deshabilitado.

---

## 3. F5.6-B — "Marcar como erróneo" con caducidad de 5 minutos

### 3.1 Comportamiento

El botón "marcar como erróneo" sobre un mensaje propio solo está disponible si:

```
now() - mensaje.created_at < interval '5 minutes'
```

Mensajes más antiguos no son anulables. Esto evita el caso reportado: anular un mensaje de hace 2 días.

### 3.2 Implementación (defensa en dos capas)

- **Cliente**: ocultar/deshabilitar el botón "marcar como erróneo" si el mensaje tiene más de 5 minutos. Recalcular en render (no es crítico que sea exacto al segundo).
- **Server/RLS**: la action o policy de UPDATE que aplica el flag de erróneo debe **rechazar** si `created_at < now() - interval '5 minutes'`. Esta es la capa autoritativa; el cliente es solo UX.

### 3.3 Alcance

Aplica a mensajes de conversación (profe↔familia, admin↔familia) **y a anuncios**. Mismo límite de 5 min por coherencia. Confirmado en Checkpoint A.

---

## 4. F5.6-C — Scroll interno tipo WhatsApp

### 4.1 Problema actual

El hilo de conversación crece indefinidamente hacia abajo, empujando el layout. No hay contenedor con scroll propio.

### 4.2 Comportamiento deseado

- Contenedor de mensajes con **altura fija**: `height: calc(100dvh - header - composer)` (usar `dvh` para móvil, no `vh`, por las barras dinámicas del navegador).
- `overflow-y: auto` en el contenedor de mensajes.
- Header de la conversación y composer **fijos** (no scrollean).
- **Auto-scroll al fondo** cuando llega un mensaje nuevo, PERO solo si el usuario ya estaba cerca del fondo (umbral ~100px). Si está leyendo mensajes antiguos arriba, no saltar.
- **Botón flotante "ir al último"** visible solo cuando el usuario está scrolleado hacia arriba; al pulsar, scroll suave al fondo.
- Al abrir una conversación, scroll inicial al fondo (último mensaje visible).

### 4.3 Notas técnicas

- El umbral de "cerca del fondo" se mide con `scrollHeight - scrollTop - clientHeight < 100`.
- Cuidado con el realtime: cuando entra un mensaje, evaluar la posición ANTES de insertarlo en el DOM para decidir si auto-scrollear.
- Considerar `scroll-behavior: smooth` solo para el botón "ir al último", no para el auto-scroll de mensajes nuevos (puede marear).

---

## 5. ADRs necesarios

- **ADR-00XX**: Modelo admin↔familia 1-por-(admin,tutor) con reapertura vía UPSERT. Justificar por qué no 1-por-niño ni 1-por-centro.
- **ADR-00XX**: Timer reseteable vía trigger AFTER INSERT en vez de cálculo en server action. Justificar (consistencia, evita lógica duplicada).
- **ADR-00XX**: "Marcar erróneo" con ventana de 5 min aplicada en RLS además de cliente.

(Numeración a asignar según el último ADR del repo.)

---

## 6. Plan de tests

### RLS (Vitest + cliente Supabase de test)

- Admin del centro PUEDE crear conversación admin_familia con un tutor de su centro.
- Admin de OTRO centro NO puede crear conversación con ese tutor.
- Tutor NO puede crear conversación admin_familia (solo el admin).
- Admin y tutor PUEDEN leer la conversación (también tras caducar).
- Un tercero (otro tutor, otra profe) NO puede leer la conversación.
- INSERT de mensaje BLOQUEADO cuando `expires_at < now()`.
- INSERT de mensaje PERMITIDO cuando `expires_at >= now()`.
- Reapertura por admin restaura capacidad de INSERT.

### Regresión F5 (post-migración)

- Todas las queries y RLS de F5 sobre `conversaciones`/`mensajes` siguen funcionando con `nino_id` nullable.
- Test explícito: crear conversación `profe_familia` con `nino_id` válido y NULL en los campos admin → OK; CHECK no rechaza.

### Trigger

- INSERT de mensaje en admin_familia resetea `expires_at` a now()+3d.
- INSERT en profe_familia NO toca `expires_at` (queda NULL).
- Tutor (sin UPDATE directo sobre `conversaciones`) inserta mensaje y el trigger renueva `expires_at` correctamente — valida `SECURITY DEFINER`.

### Marcar erróneo

- Mensaje de <5 min: action permite marcar erróneo.
- Mensaje de >5 min: action rechaza con error legible.
- Cliente oculta botón para mensajes >5 min.

### Scroll (Playwright)

- Al abrir conversación, el último mensaje es visible.
- Mensaje nuevo con usuario al fondo: auto-scroll.
- Mensaje nuevo con usuario scrolleado arriba: NO auto-scroll, aparece botón "ir al último".
- Botón "ir al último" lleva al fondo.

### E2E (Playwright)

- Admin abre conversación con tutor → envía mensaje → tutor lo ve.
- Tutor responde → admin lo ve → timer reseteado.
- Simular caducidad (manipular `expires_at` en seed) → composer deshabilitado en tutor → admin reabre → composer reactivado.

---

## 7. Checkpoints

- **Checkpoint A** (este documento): spec aprobada. Producto y modelo de datos cerrados.
- **Checkpoint B**: migración + RLS + trigger + tests de BD en verde. Revisión antes de UI.
- **Checkpoint C**: server actions + UI + i18n + Playwright + ADRs + docs. CI verde. PR listo para review.

Merge a `main` solo tras revisión manual del PR (squash).

---

## 8. Fuera de alcance (explícito)

- Push notifications (aparcado; la llamada a `enviarPush` se mantiene pero no se valida su entrega).
- Cron de aviso de caducidad.
- Etiquetado de niño en mensajes admin↔familia.
- Adjuntos/imágenes en mensajes (fase futura, F10).
- Conversación admin↔familia iniciada por la familia.

---

## 9. Riesgos y notas

- El trigger de reseteo se ejecuta en cada INSERT de mensaje globalmente; verificar que no degrada performance ni colisiona con el audit log. Filtrar por `tipo_conversacion` dentro del trigger evita updates innecesarios pero el trigger igualmente se dispara: medir.
- El cambio de `nino_id` a nullable afecta a queries existentes de F5 que asumían NOT NULL. Auditar usos de `conversaciones.nino_id` en el código actual antes de la migración (Tarea 0 del Checkpoint B).
- F5.6-C (scroll) interactúa con el realtime de F5; probar bien el caso de mensajes entrantes durante lectura de histórico.
