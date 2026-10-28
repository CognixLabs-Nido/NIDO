// Comprueba la salida de plan-borrado-sin-copia.sql (ver su cabecera): cada DELETE de audit_log
// que auto_explain registra dentro del trigger tiene que buscar por (tabla, registro_id), las dos
// columnas en el Index Cond. Uso: node scripts/ci/plan-borrado-sin-copia.mjs <salida de psql>
import { readFileSync } from 'node:fs'

const ESPERADOS = 3 // la agenda, su comida y la asistencia
const salida = readFileSync(process.argv[2], 'utf8')

// Cada plan de auto_explain empieza en una línea «LOG:  duration: … plan:».
const planes = salida.split(/^.*LOG: {2}duration: .* plan:$/m).slice(1)
const borrados = planes.filter((p) => /Query Text: DELETE FROM public\.audit_log\b/.test(p))
const porIndice = borrados.filter((p) =>
  /Index Cond: \(\(tabla = .*\) AND \(registro_id = .*\)\)/.test(p)
)

process.stdout.write(
  `planes registrados: ${planes.length}; DELETE de audit_log dentro del trigger: ` +
    `${borrados.length} (esperados ${ESPERADOS}); con tabla y registro_id en el Index Cond: ${porIndice.length}\n`
)
for (const p of borrados) process.stdout.write(p.trim().split('\n').slice(0, 6).join('\n') + '\n\n')

if (borrados.length !== ESPERADOS) {
  console.error(
    `FALLO: se esperaban ${ESPERADOS} DELETE de audit_log en el plan; ¿auto_explain no está activo o cambió el trigger?`
  )
  process.exit(1)
}
if (porIndice.length !== borrados.length) {
  console.error(
    'FALLO: el borrado sin copia no va por el índice (tabla, registro_id) con las dos columnas'
  )
  process.exit(1)
}
