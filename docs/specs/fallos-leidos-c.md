---
feature: fallos-leidos-c
wave: 1
status: in_progress
priority: high
last_updated: 2026-11-23
related_specs: [mandato-sepa-cierre]
---

# Spec — C: un fallo no se lee como «no hay», ni como regla, ni como «ok»

## Resumen

Tres formas del mismo defecto, y las tres se miden abiertas antes de cerrarse:

1. una lectura que falla y se lee como AUSENCIA («no hay comidas apuntadas», «el mes está vacío»);
2. una lectura que falla y se lee como REGLA («el centro no domicilia», «sin plantilla», «come
   sólidos»): no deja hueco visible, deja una explicación creíble;
3. una ESCRITURA que falla y se contesta como éxito, a veces con un comentario que lo justifica
   («el recibo se corregirá al regenerar. No es fatal.»).

El criterio de cierre, el de siempre: si no se pudo leer, la pantalla lo dice y no da el dato por
bueno; si no se pudo escribir, la acción no dice que sí.

## Decisiones del responsable (literales)

### 2026-11-23 · el orden y las dos condiciones del censo

«Y EL CENSO DEL RESTO, para darme el troceo. Con dos condiciones que ya aprendimos y que cambian el
resultado: CUENTA POR HELPER, no por sitio, porque un defecto en un helper se reparte entre todos sus
llamadores sin aparecer como sitio; y BUSCA LAS DOS FORMAS, el fallo leído como ausencia y el fallo
leído como REGLA. La segunda es la peligrosa: un hueco visible levanta sospechas, una explicación
plausible como «lo gestiona el otro tutor» no. Dame el número por grupos y el troceo propuesto antes
de tocar nada de ese tercer punto.»

### 2026-11-23 · la tercera forma

«AÑADE ESA TERCERA FORMA AL CENSO DEL PUNTO 3: escrituras que fallan y devuelven ok, incluidas las
que lo justifican con un comentario. Y esos comentarios son la mejor pista que tienes para
encontrarlas: busca las frases que explican por qué no pasa nada si algo falla —«se corregirá», «ya
quedó guardado», «no es crítico»—, porque cada una marca un sitio donde alguien decidió que un fallo
era aceptable sin medir si lo era. Dime cuántas salen de las tres formas, por separado, cuando tengas
el número.»

### 2026-11-23 · el esquema de hora: se cierra la clase

«El esquema de hora: alinéalo con el del pase de lista, que acepte los dos formatos y recorte, con su
test. «Protegido por coincidencia» es exactamente lo que no dejamos en pie: hoy ninguna ruta le manda
una hora leída de la base, y el día que alguien añada una pantalla que sí, se encontrará el mismo
fallo que ya arreglamos una vez. Cierra la clase, no el caso.»

### 2026-11-23 · los sólidos del pase de comidas van primero

«Y DE LOS DOS HALLAZGOS NUEVOS, EL DEL PASE DE COMIDAS VA CON PRIORIDAD, delante de los duplicados y
del menú: que un niño cuyo «come sólidos» no se puede leer cuente como que SÍ come sólidos no es un
dato mal pintado, es que a un bebé que no puede masticar se le ofrezca comida que no debe. Es la
misma clase de cosa que las alergias borradas, y por eso va primero.
Mídelo abierto como los demás y ciérralo con el criterio de siempre: si no se pudo leer, la pantalla
lo dice y no da el dato por bueno. Y que el valor por defecto, cuando no se sabe, sea el que no hace
daño: «no come sólidos» antes que «sí».»

### 2026-11-23 · «sin plantilla» de la imagen

«El de «sin plantilla» de la imagen es de la forma regla también: anótalo para el censo y ciérralo
con el resto.»

### 2026-11-23 · duplicados: producción antes del índice

«Bien comprobar los duplicados de producción antes de poner el índice único: si ya los hay, el
índice no se crea y te enteras a mitad de la migración.»

## Orden de trabajo (de las decisiones de arriba)

1. Sólidos del pase de comidas (forma regla; valor por defecto «no come sólidos»).
2. Dinero: recibo con línea manual; cambio de método (lectura y escritura, la tercera forma).
3. SEPA silencioso del alta (forma regla).
4. Pase de comidas (lo apuntado) y menú del mes (forma ausencia), por helper.
5. Duplicados: lista de espera e imagen; lectura de producción antes de la migración del índice.
6. Esquema de hora de agenda, citas y eventos: el del pase de lista (los dos formatos, recorta).
7. «Sin plantilla» de la imagen: con el resto, y contado en el censo como forma regla.
8. Censo del resto por helper, las tres formas por separado; número y troceo antes de tocar nada.
