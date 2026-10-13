import { DateTime } from 'luxon'
import type { Mesa, Negocio, Turno } from '../negocio.js'

/**
 * Disponibilidad con las mismas reglas que Taberna Luna (src/lib.js de
 * reservas-n8n): una reserva ocupa su mesa desde la hora de llegada durante
 * todo el turno, no se da una mesa grande a pocos comensales, hay un máximo
 * de llegadas por franja y una antelación mínima. Funciones puras: reciben
 * las reservas y el momento actual, así que se prueban sin trucos.
 */

export type EstadoReserva = 'confirmada' | 'cancelada'
export type Origen = 'ia' | 'web' | 'telefono' | 'local'

export interface Reserva {
  codigo: string
  nombre: string
  telefono?: string
  fecha: string
  hora: string
  turno: Turno
  personas: number
  mesa: string
  notas: string
  estado: EstadoReserva
  origen: Origen
  creada: string
  /** Conversación que la creó (para enlazarla desde el panel). */
  llamada?: string
  /** El cliente confirmó que viene al recibir el recordatorio. */
  asistencia?: 'confirmada'
  recordatorio?: boolean
  resena?: 'pedida' | 'problema'
}

export interface Hueco {
  fecha: string
  hora: string
}

export type MotivoNo = 'cerrado' | 'vacaciones' | 'pasada' | 'lejos' | 'grupo' | 'hora_no_valida' | 'completo'

export type Comprobacion =
  | { ok: true; mesa: Mesa; turno: Turno }
  | { ok: false; motivo: MotivoNo; alternativas: Hueco[] }

export const ocupa = (r: Reserva) => r.estado === 'confirmada'

export function turnoDe(negocio: Negocio, hora: string): Turno | null {
  if (negocio.horas.comida.includes(hora)) return 'comida'
  if (negocio.horas.cena.includes(hora)) return 'cena'
  return null
}

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

export function estadoDia(negocio: Negocio, fecha: string, ahora: DateTime): { abierto: true } | { abierto: false; motivo: MotivoNo } {
  const d = DateTime.fromISO(fecha, { zone: ahora.zone })
  if (!d.isValid) return { abierto: false, motivo: 'pasada' }
  const hoy = ahora.startOf('day')
  if (d < hoy) return { abierto: false, motivo: 'pasada' }
  if (d.diff(hoy, 'days').days > negocio.diasMax) return { abierto: false, motivo: 'lejos' }
  if (negocio.vacaciones.includes(fecha)) return { abierto: false, motivo: 'vacaciones' }
  if (negocio.cerrado.includes(d.weekday)) return { abierto: false, motivo: 'cerrado' }
  return { abierto: true }
}

/** Mesas en las que caben los comensales y que están libres todo el turno, la más ajustada primero. */
export function mesasLibres(negocio: Negocio, reservas: Reserva[], fecha: string, hora: string, personas: number): Mesa[] {
  const turno = turnoDe(negocio, hora)
  if (!turno) return []
  const ini = minutos(hora)
  const fin = ini + negocio.duracion[turno]
  const delDia = reservas.filter((r) => r.fecha === fecha && ocupa(r))
  return negocio.mesas
    .filter((m) => personas >= m.min && personas <= m.plazas)
    .filter((m) =>
      delDia.every((r) => {
        if (r.mesa !== m.id) return true
        const a = minutos(r.hora)
        const b = a + negocio.duracion[r.turno]
        return b <= ini || a >= fin
      }),
    )
    .sort((x, y) => x.plazas - y.plazas || (x.zona === y.zona ? 0 : x.zona === 'Salón' ? -1 : 1))
}

/** ¿Llegan ya demasiados comensales a esa hora? (para que la cocina no se colapse) */
function ritmoOk(negocio: Negocio, reservas: Reserva[], fecha: string, hora: string, personas: number): boolean {
  const llegan = reservas.filter((r) => r.fecha === fecha && r.hora === hora && ocupa(r)).reduce((s, r) => s + r.personas, 0)
  return llegan + personas <= negocio.franja
}

function horaPasada(negocio: Negocio, fecha: string, hora: string, ahora: DateTime): boolean {
  const momento = DateTime.fromISO(`${fecha}T${hora}`, { zone: ahora.zone })
  return momento.diff(ahora, 'minutes').minutes < negocio.antelacionMin
}

/** Horas con sitio para ese día y esos comensales. */
export function horasLibres(negocio: Negocio, reservas: Reserva[], fecha: string, personas: number, ahora: DateTime): string[] {
  if (!estadoDia(negocio, fecha, ahora).abierto) return []
  return [...negocio.horas.comida, ...negocio.horas.cena].filter(
    (h) => !horaPasada(negocio, fecha, h, ahora) && ritmoOk(negocio, reservas, fecha, h, personas) && mesasLibres(negocio, reservas, fecha, h, personas).length > 0,
  )
}

/**
 * Comprueba una petición concreta. Si no se puede, propone hasta tres huecos:
 * primero el mismo día cerca de la hora pedida (y del mismo turno), si no, los
 * días siguientes a una hora parecida.
 */
export function comprobar(negocio: Negocio, reservas: Reserva[], fecha: string, hora: string, personas: number, ahora: DateTime): Comprobacion {
  const maxMesa = Math.max(...negocio.mesas.map((m) => m.plazas))
  if (personas > Math.min(negocio.maxPersonas, maxMesa)) return { ok: false, motivo: 'grupo', alternativas: [] }
  const dia = estadoDia(negocio, fecha, ahora)
  if (!dia.abierto) return { ok: false, motivo: dia.motivo, alternativas: dia.motivo === 'cerrado' || dia.motivo === 'vacaciones' ? otrosDias(negocio, reservas, fecha, hora, personas, ahora) : [] }
  const turno = turnoDe(negocio, hora)
  if (turno && !horaPasada(negocio, fecha, hora, ahora) && ritmoOk(negocio, reservas, fecha, hora, personas)) {
    const mesa = mesasLibres(negocio, reservas, fecha, hora, personas)[0]
    if (mesa) return { ok: true, mesa, turno }
  }
  const motivo: MotivoNo = !turno ? 'hora_no_valida' : horaPasada(negocio, fecha, hora, ahora) ? 'pasada' : 'completo'
  const libres = horasLibres(negocio, reservas, fecha, personas, ahora)
  const pedido = minutos(hora)
  const turnoPedido = turno ?? (pedido < 18 * 60 ? 'comida' : 'cena')
  // Si piden cena y hay hueco para cenar, no se ofrece la comida (y al revés).
  const delTurno = libres.filter((h) => turnoDe(negocio, h) === turnoPedido)
  const mismoDia = (delTurno.length ? delTurno : libres)
    .map((h) => ({ h, d: Math.abs(minutos(h) - pedido) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 3)
    .map(({ h }) => ({ fecha, hora: h }))
    .sort((x, y) => minutos(x.hora) - minutos(y.hora))
  if (mismoDia.length) return { ok: false, motivo, alternativas: mismoDia }
  return { ok: false, motivo, alternativas: otrosDias(negocio, reservas, fecha, hora, personas, ahora) }
}

function otrosDias(negocio: Negocio, reservas: Reserva[], fecha: string, hora: string, personas: number, ahora: DateTime): Hueco[] {
  const out: Hueco[] = []
  const pedido = minutos(hora)
  let d = DateTime.fromISO(fecha, { zone: ahora.zone })
  for (let i = 0; i < 14 && out.length < 2; i++) {
    d = d.plus({ days: 1 })
    const f = d.toISODate()!
    const libres = horasLibres(negocio, reservas, f, personas, ahora)
    if (!libres.length) continue
    const mejor = [...libres].sort((x, y) => Math.abs(minutos(x) - pedido) - Math.abs(minutos(y) - pedido))[0]!
    out.push({ fecha: f, hora: mejor })
  }
  return out
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Código corto y fácil de dictar (sin 0/O ni 1/I). */
export function nuevoCodigo(existentes: Set<string>, azar: () => number = Math.random): string {
  for (;;) {
    let c = ''
    for (let i = 0; i < 5; i++) c += ALFABETO[Math.floor(azar() * ALFABETO.length)]
    if (!existentes.has(c)) return c
  }
}
