import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AulaConPersonal } from '../../queries/get-aulas-con-personal'
import { TablaAulas, type TablaAulasLabels } from '../TablaAulas'

/**
 * Tests de presentación del componente `<TablaAulas />` (F5B-#36 B3).
 *
 * Recibimos `labels` por prop (la page padre traduce con
 * `getTranslations`) así que el render es testable sin
 * `NextIntlClientProvider`.
 */

const LABELS: TablaAulasLabels = {
  fields: {
    nombre: 'Nombre',
    anio_nacimiento: 'Año nacimiento',
    capacidad: 'Capacidad máxima',
    num_alumnos: 'Nº alumnos',
    profesoras: 'Profesoras',
    tecnicos: 'Técnicos',
    descripcion: 'Descripción',
  },
  label_coordinadora: 'Coordinadora',
}

const BASE_AULA: AulaConPersonal = {
  id: 'aula-1',
  centro_id: 'centro-1',
  nombre: 'Aula Sea',
  cohorte_anos_nacimiento: [2024],
  capacidad_maxima: 12,
  descripcion: null,
  num_alumnos: 0,
  profesoras: [],
  tecnicos: [],
  apoyos: [],
}

describe('TablaAulas', () => {
  it('renderiza las 7 columnas en orden esperado', () => {
    const { container } = render(<TablaAulas aulas={[BASE_AULA]} labels={LABELS} locale="es" />)
    // Query DOM directa en vez de `getAllByRole('columnheader')` — más
    // rápido y no depende del role ARIA implícito de `<th>` que en
    // suite vitest completa con muchos archivos jsdom es flaky.
    const headers = Array.from(container.querySelectorAll('thead th')).map((h) => h.textContent)
    expect(headers).toEqual([
      'Nombre',
      'Año nacimiento',
      'Capacidad máxima',
      'Nº alumnos',
      'Profesoras',
      'Técnicos',
      'Descripción',
    ])
  })

  it('aula sin personal: dash en Profesoras y Técnicos, 0 en Nº alumnos', () => {
    const { container } = render(<TablaAulas aulas={[BASE_AULA]} labels={LABELS} locale="es" />)
    const filas = container.querySelectorAll('tbody tr')
    expect(filas).toHaveLength(1)
    const celdas = filas[0]!.querySelectorAll('td')
    expect(celdas).toHaveLength(7)
    expect(celdas[3]!.textContent).toBe('0') // Nº alumnos
    expect(celdas[4]!.textContent).toBe('—') // Profesoras
    expect(celdas[5]!.textContent).toBe('—') // Técnicos
  })

  it('coordinadora primero con badge variant warm y tooltip; profesora regular variant secondary', () => {
    const aula: AulaConPersonal = {
      ...BASE_AULA,
      num_alumnos: 3,
      profesoras: [
        { id: 'u-coord', nombre_completo: 'Mónica', tipo_personal_aula: 'coordinadora' },
        { id: 'u-ana', nombre_completo: 'Ana', tipo_personal_aula: 'profesora' },
        { id: 'u-zara', nombre_completo: 'Zara', tipo_personal_aula: 'profesora' },
      ],
      tecnicos: [{ id: 'u-tec', nombre_completo: 'Lucía', tipo_personal_aula: 'tecnico' }],
    }
    const { container } = render(<TablaAulas aulas={[aula]} labels={LABELS} locale="es" />)

    const coord = screen.getByText('Mónica')
    expect(coord).toHaveAttribute('title', 'Coordinadora')
    expect(coord.className).toMatch(/warm/i)

    const profe = screen.getByText('Ana')
    expect(profe).not.toHaveAttribute('title')
    // El variant secondary es solo CSS; verificamos que NO lleva warm.
    expect(profe.className).not.toMatch(/warm/i)

    // El orden visual coincide con el orden del array (coordinadora primero
    // viene garantizado por la query). Comprobamos los 4 nombres en orden
    // dentro del tbody — query DOM directa.
    const textosBadges = Array.from(container.querySelectorAll('tbody [data-slot="badge"]'))
      .map((b) => b.textContent)
      .filter((t) => t && /^(Mónica|Ana|Zara|Lucía)$/.test(t))
    expect(textosBadges).toEqual(['Mónica', 'Ana', 'Zara', 'Lucía'])
  })

  it('num_alumnos=0 muestra 0 (no dash) — semánticamente distinto a "sin dato"', () => {
    const { container } = render(
      <TablaAulas aulas={[{ ...BASE_AULA, num_alumnos: 0 }]} labels={LABELS} locale="es" />
    )
    const celdaNumAlumnos = container.querySelectorAll('tbody tr td')[3]!
    expect(celdaNumAlumnos.textContent).toBe('0')
  })

  it('preserva data-testid admin-aula-link-${id} en la celda Nombre (Nota B)', () => {
    render(<TablaAulas aulas={[BASE_AULA]} labels={LABELS} locale="es" />)
    const link = screen.getByTestId('admin-aula-link-aula-1')
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/es/teacher/aula/aula-1')
    expect(link.textContent).toBe('Aula Sea')
  })

  it('renderiza varias filas (agregación multi-aula)', () => {
    const aulas: AulaConPersonal[] = [
      { ...BASE_AULA, id: 'a1', nombre: 'Aula A', num_alumnos: 5 },
      { ...BASE_AULA, id: 'a2', nombre: 'Aula B', num_alumnos: 8 },
      { ...BASE_AULA, id: 'a3', nombre: 'Aula C', num_alumnos: 3 },
    ]
    render(<TablaAulas aulas={aulas} labels={LABELS} locale="es" />)
    expect(screen.getByTestId('admin-aula-link-a1')).toBeDefined()
    expect(screen.getByTestId('admin-aula-link-a2')).toBeDefined()
    expect(screen.getByTestId('admin-aula-link-a3')).toBeDefined()
  })
})
