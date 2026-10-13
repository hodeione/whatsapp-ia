import { DateTime } from 'luxon'
import { describe, expect, it, vi } from 'vitest'
import { TABERNA_LUNA as N } from '../src/lib/negocio'
import { ConectorLocal, almacenEnMemoria, reservasDemo } from '../src/lib/reservas/conector'
import { comprobar, horasLibres, mesasLibres, nuevoCodigo, type Reserva } from '../src/lib/reservas/motor'
import { ConectorN8n } from '../src/lib/reservas/n8n'
import { diasAbiertos, horarioHablado } from '../src/lib/dialogo/info'

const AHORA = DateTime.fromISO('2026-10-13T18:00', { zone: 'Europe/Madrid' })

function reserva(p: Partial<Reserva>): Reserva {
  return { codigo: 'AAAAA', nombre: 'X', fecha: '2026-10-16', hora: '21:00', turno: 'cena', personas: 2, mesa: 's1', notas: '', estado: 'confirmada', origen: 'web', creada: '', ...p }
}

describe('motor de disponibilidad', () => {
  it('elige la mesa más ajustada', () => {
    expect(mesasLibres(N, [], '2026-10-16', '21:00', 2)[0]!.plazas).toBe(2)
    expect(mesasLibres(N, [], '2026-10-16', '21:00', 5)[0]!.plazas).toBe(6)
    // A una pareja no se le da la mesa de 6 (mínimo 4)
    expect(mesasLibres(N, [], '2026-10-16', '21:00', 2).some((m) => m.plazas === 6)).toBe(false)
  })

  it('una reserva ocupa la mesa todo el turno', () => {
    const r = [reserva({ mesa: 's1', hora: '20:00' })]
    expect(mesasLibres(N, r, '2026-10-16', '21:30', 2).some((m) => m.id === 's1')).toBe(false)
    expect(mesasLibres(N, r, '2026-10-16', '22:00', 2).some((m) => m.id === 's1')).toBe(true)
  })

  it('cierra los lunes y respeta la antelación', () => {
    expect(horasLibres(N, [], '2026-10-19', 2, AHORA)).toEqual([])
    // Hoy a las 18:00: la primera hora reservable es 20:00 (más de 60 min)
    expect(horasLibres(N, [], '2026-10-13', 2, AHORA)[0]).toBe('20:00')
    expect(comprobar(N, [], '2026-10-13', '14:00', 2, AHORA)).toMatchObject({ ok: false, motivo: 'pasada' })
  })

  it('propone alternativas cercanas del mismo turno', () => {
    // Mesas pequeñas ocupadas a las 20:00: a las 21:00 no hay, a las 22:00 vuelven a quedar libres
    const llenas = N.mesas.filter((m) => m.plazas <= 4 && m.min <= 2).map((m, i) => reserva({ mesa: m.id, codigo: 'C' + i, hora: '20:00', personas: 2 }))
    const c = comprobar(N, llenas, '2026-10-16', '21:00', 2, AHORA)
    expect(c.ok).toBe(false)
    if (!c.ok) {
      expect(c.motivo).toBe('completo')
      expect(c.alternativas.length).toBeGreaterThan(0)
      expect(c.alternativas[0]).toEqual({ fecha: '2026-10-16', hora: '22:00' })
    }
  })

  it('las horas fuera de servicio se corrigen', () => {
    const c = comprobar(N, [], '2026-10-16', '21:15', 2, AHORA)
    expect(c).toMatchObject({ ok: false, motivo: 'hora_no_valida' })
    if (!c.ok) expect(c.alternativas.map((h) => h.hora)).toContain('21:00')
  })

  it('grupos demasiado grandes', () => {
    expect(comprobar(N, [], '2026-10-16', '21:00', 12, AHORA)).toMatchObject({ ok: false, motivo: 'grupo' })
  })

  it('códigos únicos y fáciles de dictar', () => {
    const c = nuevoCodigo(new Set())
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}$/)
  })

  it('la ocupación de demo es estable y válida', () => {
    const a = reservasDemo(N, AHORA)
    const b = reservasDemo(N, AHORA)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(20)
    expect(a.some((r) => r.fecha === '2026-10-19')).toBe(false) // lunes cerrado
  })
})

describe('conector local', () => {
  it('crea, busca y cancela', async () => {
    const c = new ConectorLocal(N, almacenEnMemoria(), () => AHORA)
    const r = await c.crear({ nombre: 'Ane', fecha: '2026-10-16', hora: '21:00', personas: 4 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(await c.buscar({ nombre: 'ane' })).toHaveLength(1)
    expect(await c.buscar({ codigo: r.reserva.codigo.toLowerCase() })).toHaveLength(1)
    // La misma reserva repetida no se duplica
    const otra = await c.crear({ nombre: 'Ane', fecha: '2026-10-16', hora: '21:00', personas: 4 })
    expect(otra.ok && otra.reserva.codigo).toBe(r.reserva.codigo)
    expect((await c.cancelar(r.reserva.codigo)).ok).toBe(true)
    expect(await c.buscar({ nombre: 'Ane' })).toHaveLength(0)
  })
})

describe('conector n8n', () => {
  it('usa la API de agentes de reservas-n8n', async () => {
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/disponibilidad')) return Response.json({ cerrado: false, horas: [{ hora: '21:00', disponible: false }, { hora: '21:30', disponible: true }] })
      if (u.endsWith('/api/reservas')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ nombre: 'Jon', origen: 'ia' })
        expect((init!.headers as Record<string, string>)['x-api-key']).toBe('clave')
        return Response.json({ ok: true, codigo: 'DENG7N' }, { status: 201 })
      }
      return Response.json({}, { status: 404 })
    })
    const c = new ConectorN8n('https://r.example/webhook/', 'clave', N, () => AHORA, f as unknown as typeof fetch)
    const no = await c.comprobar('2026-10-16', '21:00', 2)
    expect(no).toMatchObject({ ok: false, motivo: 'completo', alternativas: [{ hora: '21:30' }] })
    const si = await c.crear({ nombre: 'Jon', telefono: '600000000', fecha: '2026-10-16', hora: '21:30', personas: 2 })
    expect(si.ok && si.reserva.codigo).toBe('DENG7N')
    expect((await c.cancelar('XXXX', '600')).ok).toBe(false)
  })
})

describe('información', () => {
  it('describe el horario', () => {
    expect(diasAbiertos(N)).toBe('de martes a domingo')
    expect(horarioHablado(N)).toContain('Los lunes cerramos')
  })
})
