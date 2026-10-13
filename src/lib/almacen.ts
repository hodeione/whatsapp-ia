import { DateTime } from 'luxon'
import type { Espera, EstadoConversacion, Mensaje, Restaurante } from './chat.js'
import type { Negocio } from './negocio.js'
import { reservasDemo, type Almacen } from './reservas/conector.js'
import type { Reserva } from './reservas/motor.js'

/**
 * Datos de la demo en el navegador: reservas (con la ocupación de ejemplo
 * del día), lista de espera, avisos para el equipo, el chat y las métricas.
 */

export interface Aviso {
  texto: string
  hora: string
}

export interface Metricas {
  recordatorios: number
  confirmadas: number
  recuperadas: number
  resenas: number
}

interface Datos {
  version: 1
  dia: string
  reservas: Reserva[]
  espera: Espera[]
  avisos: Aviso[]
  mensajes: Mensaje[]
  conversacion: EstadoConversacion | null
  metricas: Metricas
}

const CLAVE = 'whatsapp-ia:v1'
const EVENTO = 'whatsapp-ia:cambio'
const vacias = (): Metricas => ({ recordatorios: 0, confirmadas: 0, recuperadas: 0, resenas: 0 })

export class AlmacenDemo implements Almacen, Restaurante {
  private d: Datos

  constructor(
    private negocio: Negocio,
    private ahora: () => DateTime,
  ) {
    this.d = this.cargar()
  }

  private cargar(): Datos {
    const hoy = this.ahora().toISODate()!
    let previo: Datos | null = null
    try {
      previo = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Datos | null
    } catch {
      /* sin almacenamiento o datos corruptos */
    }
    if (previo?.version === 1 && previo.dia === hoy) return previo
    const propias = (previo?.reservas ?? []).filter((r) => r.origen === 'ia' && r.fecha >= hoy)
    const d: Datos = { version: 1, dia: hoy, reservas: [...reservasDemo(this.negocio, this.ahora()), ...propias], espera: (previo?.espera ?? []).filter((e) => e.fecha >= hoy), avisos: [], mensajes: previo?.mensajes ?? [], conversacion: previo?.conversacion ?? null, metricas: previo?.metricas ?? vacias() }
    this.escribir(d)
    return d
  }

  private escribir(d: Datos) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(d))
    } catch {
      /* la demo sigue en memoria */
    }
    window.dispatchEvent(new Event(EVENTO))
  }

  private cambiar(c: Partial<Datos>) {
    this.d = { ...this.d, ...c }
    this.escribir(this.d)
  }

  /* Almacen (reservas) */
  leer() {
    return this.d.reservas
  }
  guardar(reservas: Reserva[]) {
    this.cambiar({ reservas })
  }

  /* Restaurante */
  espera() {
    return this.d.espera
  }
  guardarEspera(espera: Espera[]) {
    const antes = this.d.espera.filter((e) => e.estado === 'aceptado').length
    const despues = espera.filter((e) => e.estado === 'aceptado').length
    this.cambiar({ espera, metricas: { ...this.d.metricas, recuperadas: this.d.metricas.recuperadas + Math.max(0, despues - antes) } })
  }
  avisar(texto: string) {
    this.cambiar({ avisos: [{ texto, hora: this.ahora().toISO()! }, ...this.d.avisos].slice(0, 30) })
  }
  actualizarReserva(codigo: string, cambios: Partial<Reserva>) {
    const m = { ...this.d.metricas }
    if (cambios.recordatorio) m.recordatorios++
    if (cambios.asistencia === 'confirmada') m.confirmadas++
    if (cambios.resena === 'pedida') m.resenas++
    this.cambiar({ reservas: this.d.reservas.map((r) => (r.codigo === codigo ? { ...r, ...cambios } : r)), metricas: m })
  }

  /* Chat */
  get mensajes() {
    return this.d.mensajes
  }
  get conversacion() {
    return this.d.conversacion
  }
  get avisos() {
    return this.d.avisos
  }
  get metricas() {
    return this.d.metricas
  }
  guardarChat(mensajes: Mensaje[], conversacion: EstadoConversacion) {
    this.cambiar({ mensajes: mensajes.slice(-200), conversacion })
  }

  reiniciar() {
    try {
      localStorage.removeItem(CLAVE)
    } catch {
      /* nada */
    }
    this.d = { version: 1, dia: this.ahora().toISODate()!, reservas: reservasDemo(this.negocio, this.ahora()), espera: [], avisos: [], mensajes: [], conversacion: null, metricas: vacias() }
    this.escribir(this.d)
  }

  static alCambiar(f: () => void) {
    window.addEventListener(EVENTO, f)
    return () => window.removeEventListener(EVENTO, f)
  }
}
