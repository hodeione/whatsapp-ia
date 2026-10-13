import type { Reserva } from '../reservas/motor.js'

/** Lo que pasa en una llamada además de hablar. */
export type Evento =
  | { tipo: 'reserva'; reserva: Reserva }
  | { tipo: 'cancelacion'; reserva: Reserva }
  | { tipo: 'transferir'; motivo: string }
  | { tipo: 'herramienta'; nombre: string; entrada: unknown; salida: unknown }

export interface Respuesta {
  decir: string
  eventos: Evento[]
  /** Cuelga después de decir la respuesta. */
  colgar?: boolean
}

/**
 * Quien decide qué contestar: el motor local (reglas) o Claude.
 * `alHablar` recibe frases completas en cuanto están listas, para que la
 * voz empiece a sonar antes de que termine la respuesta.
 */
export interface Motor {
  readonly nombre: 'local' | 'claude'
  saludo(): string
  responder(texto: string, alHablar?: (frase: string) => void, senal?: AbortSignal): Promise<Respuesta>
}
