import { DateTime } from 'luxon'
import type { Negocio } from '../negocio.js'
import type { Conector, Disponibilidad, NuevaReserva } from './conector.js'
import { turnoDe, type Comprobacion, type Hueco, type Reserva } from './motor.js'

/**
 * Conector para el sistema de reservas real de Taberna Luna (n8n), usando su
 * API de agentes: docs/openapi-agente.yaml en hodeione/reservas-n8n.
 *
 * Lleva la clave del agente (REST_CLAVE_AGENTE), así que se usa en el
 * servidor (por ejemplo, en el puente de Twilio), nunca en el navegador.
 */
export class ConectorN8n implements Conector {
  constructor(
    private base: string,
    private clave: string,
    private negocio: Negocio,
    private ahora: () => DateTime = () => DateTime.now().setZone(negocio.zonaHoraria),
    private f: typeof fetch = fetch,
  ) {
    this.base = base.replace(/\/$/, '')
  }

  private async pedir(ruta: string, init?: RequestInit) {
    const res = await this.f(this.base + ruta, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-api-key': this.clave, ...init?.headers },
    })
    let cuerpo: Record<string, unknown> = {}
    try {
      cuerpo = (await res.json()) as Record<string, unknown>
    } catch {
      /* sin cuerpo */
    }
    return { status: res.status, cuerpo }
  }

  async disponibilidad(fecha: string, personas: number): Promise<Disponibilidad> {
    const { status, cuerpo } = await this.pedir(`/api/disponibilidad?fecha=${encodeURIComponent(fecha)}&personas=${personas}`)
    if (status === 400) return { cerrado: true, motivo: 'lejos', horas: [] }
    if (cuerpo.cerrado) return { cerrado: true, motivo: 'cerrado', horas: [] }
    const horas = Array.isArray(cuerpo.horas) ? (cuerpo.horas as { hora: string; disponible: boolean }[]) : []
    return { cerrado: false, horas: horas.filter((h) => h.disponible).map((h) => h.hora) }
  }

  async comprobar(fecha: string, hora: string, personas: number): Promise<Comprobacion> {
    if (personas > this.negocio.maxPersonas) return { ok: false, motivo: 'grupo', alternativas: [] }
    const d = await this.disponibilidad(fecha, personas)
    if (d.cerrado) return { ok: false, motivo: d.motivo, alternativas: [] }
    const turno = turnoDe(this.negocio, hora)
    if (turno && d.horas.includes(hora)) {
      // El sistema elige la mesa al crear la reserva.
      return { ok: true, turno, mesa: { id: 'auto', nombre: 'automática', zona: '', plazas: personas, min: 1 } }
    }
    const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3))
    const alternativas: Hueco[] = [...d.horas]
      .sort((a, b) => Math.abs(min(a) - min(hora)) - Math.abs(min(b) - min(hora)))
      .slice(0, 3)
      .sort()
      .map((h) => ({ fecha, hora: h }))
    return { ok: false, motivo: turno ? 'completo' : 'hora_no_valida', alternativas }
  }

  async crear(d: NuevaReserva) {
    const { status, cuerpo } = await this.pedir('/api/reservas', {
      method: 'POST',
      body: JSON.stringify({ nombre: d.nombre, telefono: d.telefono ?? '', fecha: d.fecha, hora: d.hora, personas: d.personas, notas: d.notas ?? '', origen: 'ia' }),
    })
    if (status !== 201 || typeof cuerpo.codigo !== 'string') {
      const errores = Array.isArray(cuerpo.errores) ? (cuerpo.errores as string[]).join(' ') : `Error ${status}`
      return { ok: false as const, error: errores }
    }
    const reserva: Reserva = {
      codigo: cuerpo.codigo,
      nombre: d.nombre,
      telefono: d.telefono,
      fecha: d.fecha,
      hora: d.hora,
      turno: turnoDe(this.negocio, d.hora) ?? 'cena',
      personas: d.personas,
      mesa: 'auto',
      notas: d.notas ?? '',
      estado: 'confirmada',
      origen: 'ia',
      creada: this.ahora().toISO()!,
      llamada: d.llamada,
    }
    return { ok: true as const, reserva }
  }

  /** La API de agentes no permite buscar reservas: se cancela con código y teléfono. */
  async buscar(): Promise<Reserva[]> {
    return []
  }

  async cancelar(codigo: string, telefono = '') {
    const { status } = await this.pedir('/api/cancelar', { method: 'POST', body: JSON.stringify({ codigo, telefono }) })
    if (status === 200) {
      const r: Reserva = { codigo, nombre: '', fecha: '', hora: '', turno: 'cena', personas: 0, mesa: '', notas: '', estado: 'cancelada', origen: 'ia', creada: '' }
      return { ok: true as const, reserva: r }
    }
    return { ok: false as const, error: status === 404 ? 'El código no coincide con el teléfono de la reserva.' : 'Esa reserva ya estaba cancelada o es de un día pasado.' }
  }
}
