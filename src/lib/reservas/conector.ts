import { DateTime } from 'luxon'
import type { Negocio } from '../negocio.js'
import { comprobar, estadoDia, horasLibres, nuevoCodigo, ocupa, turnoDe, type Comprobacion, type MotivoNo, type Origen, type Reserva } from './motor.js'

/**
 * Lo que la recepcionista puede hacer con las reservas. Hay dos
 * implementaciones: la local (la demo, todo en el navegador) y la de n8n,
 * que llama a la API de agentes de Taberna Luna (docs/openapi-agente.yaml).
 */
export interface Conector {
  disponibilidad(fecha: string, personas: number): Promise<Disponibilidad>
  comprobar(fecha: string, hora: string, personas: number): Promise<Comprobacion>
  crear(datos: NuevaReserva): Promise<{ ok: true; reserva: Reserva } | { ok: false; error: string }>
  buscar(filtro: { codigo?: string; nombre?: string; telefono?: string }): Promise<Reserva[]>
  /** El teléfono solo lo exige el sistema de n8n, como comprobación de identidad. */
  cancelar(codigo: string, telefono?: string): Promise<{ ok: true; reserva: Reserva } | { ok: false; error: string }>
}

export type Disponibilidad = { cerrado: false; horas: string[] } | { cerrado: true; motivo: MotivoNo; horas: [] }

export interface NuevaReserva {
  nombre: string
  telefono?: string
  fecha: string
  hora: string
  personas: number
  notas?: string
  origen?: Origen
  llamada?: string
}

/** Dónde guarda las reservas el conector local. */
export interface Almacen {
  leer(): Reserva[]
  guardar(reservas: Reserva[]): void
}

export function almacenEnMemoria(iniciales: Reserva[] = []): Almacen {
  let datos = [...iniciales]
  return { leer: () => datos, guardar: (r) => void (datos = r) }
}

export class ConectorLocal implements Conector {
  constructor(
    private negocio: Negocio,
    private almacen: Almacen,
    private ahora: () => DateTime,
  ) {}

  async disponibilidad(fecha: string, personas: number): Promise<Disponibilidad> {
    const dia = estadoDia(this.negocio, fecha, this.ahora())
    if (!dia.abierto) return { cerrado: true, motivo: dia.motivo, horas: [] }
    return { cerrado: false, horas: horasLibres(this.negocio, this.almacen.leer(), fecha, personas, this.ahora()) }
  }

  async comprobar(fecha: string, hora: string, personas: number) {
    return comprobar(this.negocio, this.almacen.leer(), fecha, hora, personas, this.ahora())
  }

  async crear(d: NuevaReserva) {
    const nombre = d.nombre.trim().slice(0, 60)
    if (!nombre) return { ok: false as const, error: 'Falta el nombre.' }
    const reservas = this.almacen.leer()
    // Misma persona, mismo día y hora: no se duplica (pasa si se repite la confirmación).
    const repetida = reservas.find((r) => ocupa(r) && r.fecha === d.fecha && r.hora === d.hora && r.nombre.toLowerCase() === nombre.toLowerCase())
    if (repetida) return { ok: true as const, reserva: repetida }
    const c = comprobar(this.negocio, reservas, d.fecha, d.hora, d.personas, this.ahora())
    if (!c.ok) return { ok: false as const, error: c.motivo }
    const reserva: Reserva = {
      codigo: nuevoCodigo(new Set(reservas.map((r) => r.codigo))),
      nombre,
      telefono: d.telefono,
      fecha: d.fecha,
      hora: d.hora,
      turno: c.turno,
      personas: d.personas,
      mesa: c.mesa.id,
      notas: (d.notas ?? '').slice(0, 300),
      estado: 'confirmada',
      origen: d.origen ?? 'ia',
      creada: this.ahora().toISO()!,
      llamada: d.llamada,
    }
    this.almacen.guardar([...reservas, reserva])
    return { ok: true as const, reserva }
  }

  async buscar(f: { codigo?: string; nombre?: string; telefono?: string }) {
    const hoy = this.ahora().toISODate()!
    const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return this.almacen
      .leer()
      .filter((r) => ocupa(r) && r.fecha >= hoy)
      .filter((r) => {
        if (f.codigo) return r.codigo === f.codigo.toUpperCase()
        if (f.telefono) return (r.telefono ?? '').replace(/\D/g, '').endsWith(f.telefono.replace(/\D/g, '').slice(-9))
        if (f.nombre) {
          const buscado = sinTildes(f.nombre).split(' ')[0]!
          return sinTildes(r.nombre).split(' ').includes(buscado)
        }
        return false
      })
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
  }

  async cancelar(codigo: string) {
    const reservas = this.almacen.leer()
    const r = reservas.find((x) => x.codigo === codigo.toUpperCase() && ocupa(x))
    if (!r) return { ok: false as const, error: 'No encuentro ninguna reserva activa con ese código.' }
    const cancelada = { ...r, estado: 'cancelada' as const }
    this.almacen.guardar(reservas.map((x) => (x === r ? cancelada : x)))
    return { ok: true as const, reserva: cancelada }
  }
}

/* ------------------------------------------------------------ datos demo */

const NOMBRES = [
  'Ane Etxeberria', 'Jon Agirre', 'Lucía Martín', 'Mikel Urrutia', 'Carmen Ruiz', 'Iker Zubizarreta', 'Paula Gómez', 'Unai Bilbao',
  'Marta Sánchez', 'Asier Larrea', 'Nerea Ibarra', 'Javier López', 'Leire Aranburu', 'David Gil', 'Sara Fernández', 'Gorka Mendieta',
  'Elena Torres', 'Xabier Olabarri', 'Laura Díaz', 'Aitor Goikoetxea', 'Irene Navarro', 'Pablo Ortiz', 'Maite Uriarte', 'Andrea Castro',
]
const NOTAS = ['', '', '', '', 'Celiaquía', 'Necesita trona', 'Cumpleaños', 'Prefiere terraza', 'Alergia: frutos secos', 'Aniversario']

/** Generador pseudoaleatorio con semilla: la misma fecha da siempre la misma ocupación. */
function azar(semilla: number) {
  let s = semilla >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Ocupación creíble para los próximos días: viernes y sábado por la noche
 * casi llenos, entre semana más tranquilo. Así la demo tiene que buscar
 * alternativas de verdad.
 */
export function reservasDemo(negocio: Negocio, ahora: DateTime, dias = 14): Reserva[] {
  const out: Reserva[] = []
  const usados = new Set<string>()
  const hoy = ahora.startOf('day')
  for (let i = 0; i < dias; i++) {
    const d = hoy.plus({ days: i })
    const fecha = d.toISODate()!
    if (!estadoDia(negocio, fecha, hoy).abierto) continue
    const r = azar(Number(fecha.replaceAll('-', '')))
    const finde = d.weekday === 5 || d.weekday === 6
    // Cada día, nombres sin repetir (barajados con la misma semilla)
    const nombres = [...NOMBRES].sort(() => r() - 0.5)
    let siguienteNombre = 0
    for (const hora of [...negocio.horas.comida, ...negocio.horas.cena]) {
      const turno = turnoDe(negocio, hora)!
      const fuerte = (turno === 'cena' && finde) || (turno === 'comida' && d.weekday === 7)
      const intentos = fuerte ? 3 : turno === 'cena' ? 2 : 1
      for (let k = 0; k < intentos; k++) {
        if (r() > (fuerte ? 0.85 : 0.55)) continue
        const personas = [2, 2, 2, 3, 4, 4, 5, 6][Math.floor(r() * 8)]!
        const c = comprobar(negocio, out, fecha, hora, personas, hoy.minus({ days: 1 }))
        if (!c.ok) continue
        out.push({
          codigo: nuevoCodigo(usados, r),
          nombre: nombres[siguienteNombre++ % nombres.length]!,
          telefono: '+346' + String(Math.floor(r() * 1e8)).padStart(8, '0'),
          fecha,
          hora,
          turno,
          personas,
          mesa: c.mesa.id,
          notas: NOTAS[Math.floor(r() * NOTAS.length)]!,
          estado: 'confirmada',
          origen: (['web', 'web', 'web', 'telefono', 'local'] as const)[Math.floor(r() * 5)]!,
          creada: hoy.minus({ days: 1 + Math.floor(r() * 10) }).toISO()!,
        })
        usados.add(out.at(-1)!.codigo)
      }
    }
  }
  return out
}
