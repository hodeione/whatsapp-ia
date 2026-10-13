import type Anthropic from '@anthropic-ai/sdk'
import type { DateTime } from 'luxon'
import { DIAS, MESES } from '../es/hablar.js'
import type { Negocio } from '../negocio.js'
import type { Conector } from '../reservas/conector.js'
import { estadoDia } from '../reservas/motor.js'
import type { Evento, Motor, Respuesta } from './tipos.js'

/**
 * La recepcionista con Claude. La conversación vive aquí (en el navegador) y
 * se manda entera en cada turno a /api/chat, que la reenvía a la API de
 * Claude. Cuando Claude pide una herramienta, se ejecuta aquí contra las
 * reservas y se le devuelve el resultado, hasta que contesta con texto.
 */

export class ErrorIA extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
  ) {
    super(mensaje)
  }
}

type Linea =
  | { tipo: 'texto'; t: string }
  | { tipo: 'fin'; contenido: Anthropic.ContentBlock[]; stop: Anthropic.StopReason | null; uso?: Anthropic.Usage }
  | { tipo: 'error'; codigo: string; error: string }

export interface Uso {
  entrada: number
  salida: number
  cache: number
  peticiones: number
}

const MAX_VUELTAS = 6

export class MotorClaude implements Motor {
  readonly nombre = 'claude' as const
  private mensajes: Anthropic.MessageParam[] = []
  readonly uso: Uso = { entrada: 0, salida: 0, cache: 0, peticiones: 0 }
  /** Resumen de una frase que Claude deja al colgar, para el panel. */
  resumen = ''

  constructor(
    private negocio: Negocio,
    private conector: Conector,
    private ahora: () => DateTime,
    private llamada?: string,
    private f: typeof fetch = (...a) => fetch(...a),
    private telefono?: string,
  ) {}

  /**
   * Conversación serializable para seguirla en otra petición (teléfono).
   * Los bloques de razonamiento se quitan: solo hacen falta dentro de un
   * mismo turno con herramientas, y así el estado ocupa mucho menos.
   */
  exportar(): unknown {
    const mensajes = this.mensajes.map((m) =>
      typeof m.content === 'string' ? m : { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') },
    ).map((m) => (Array.isArray(m.content) && m.content.length === 0 ? { ...m, content: [{ type: 'text' as const, text: '…' }] } : m))
    return { mensajes, resumen: this.resumen }
  }

  importar(datos: unknown) {
    const d = datos as { mensajes?: Anthropic.MessageParam[]; resumen?: string } | null
    if (Array.isArray(d?.mensajes)) this.mensajes = d.mensajes
    this.resumen = d?.resumen ?? ''
  }

  saludo(): string {
    const texto = `¡Hola! 👋 Soy ${this.negocio.asistente}, el asistente de ${this.negocio.nombre}. Puedo reservarte mesa, cambiar o cancelar una reserva y resolver tus dudas. ¿Qué necesitas?`
    // El saludo forma parte de la conversación: Claude sabe que ya se ha presentado.
    this.mensajes.push({ role: 'user', content: '(El cliente abre el chat de WhatsApp del restaurante.)' }, { role: 'assistant', content: texto })
    return texto
  }

  async responder(texto: string, alHablar?: (frase: string) => void, senal?: AbortSignal): Promise<Respuesta> {
    this.mensajes.push({ role: 'user', content: texto.slice(0, 1500) })
    const eventos: Evento[] = []
    let dicho = ''
    let colgar = false

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      // En chat se guarda el texto tal cual (negritas, saltos de línea y botones [[…]]).
      const frases = new Frases((f) => alHablar?.(f))
      const fin = await this.turno(frases, senal)
      frases.terminar()
      if (frases.todo.trim()) dicho += (dicho ? '\n\n' : '') + frases.todo.trim()
      const contenido = fin.contenido.length ? (fin.contenido as Anthropic.ContentBlockParam[]) : [{ type: 'text' as const, text: '…' }]
      this.mensajes.push({ role: 'assistant', content: contenido })

      if (fin.stop === 'refusal') {
        eventos.push({ tipo: 'transferir', motivo: 'La IA no pudo atender esta petición.' })
        const aviso = 'Perdona, eso no lo puedo gestionar yo. Aviso al equipo y te escriben por aquí.'
        alHablar?.(aviso)
        return { decir: (dicho + ' ' + aviso).trim(), eventos, colgar: true }
      }

      const usos = fin.contenido.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (!usos.length) return { decir: dicho, eventos, colgar }

      const resultados: Anthropic.ToolResultBlockParam[] = []
      for (const uso of usos) {
        const salida = await this.ejecutar(uso.name, uso.input, eventos)
        if (uso.name === 'colgar') colgar = true
        eventos.push({ tipo: 'herramienta', nombre: uso.name, entrada: uso.input, salida })
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(salida), ...(isError(salida) ? { is_error: true } : {}) })
      }
      this.mensajes.push({ role: 'user', content: resultados })
      // Al colgar no hace falta otra vuelta: la despedida ya se ha dicho.
      if (colgar) return { decir: dicho, eventos, colgar }
    }
    return { decir: dicho, eventos, colgar }
  }

  /** Una petición a /api/chat: va pasando el texto según llega y devuelve el mensaje completo. */
  private async turno(frases: Frases, senal?: AbortSignal) {
    const res = await this.f('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ negocio: this.negocio, mensajes: this.mensajes }),
      signal: senal,
    })
    if (!res.ok || !res.body) {
      const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; error?: string }
      throw new ErrorIA(cuerpo.codigo ?? `http_${res.status}`, cuerpo.error ?? `Error ${res.status}`)
    }
    this.uso.peticiones++
    const lector = res.body.getReader()
    const dec = new TextDecoder()
    let resto = ''
    let fin: Extract<Linea, { tipo: 'fin' }> | null = null
    for (;;) {
      const { done, value } = await lector.read()
      if (value) resto += dec.decode(value, { stream: true })
      let i: number
      while ((i = resto.indexOf('\n')) >= 0) {
        const linea = resto.slice(0, i).trim()
        resto = resto.slice(i + 1)
        if (!linea) continue
        const l = JSON.parse(linea) as Linea
        if (l.tipo === 'texto') frases.añadir(l.t)
        else if (l.tipo === 'error') throw new ErrorIA(l.codigo, l.error)
        else fin = l
      }
      if (done) break
    }
    if (!fin) throw new ErrorIA('corte', 'La respuesta de la IA se cortó.')
    if (fin.uso) {
      this.uso.entrada += fin.uso.input_tokens
      this.uso.salida += fin.uso.output_tokens
      this.uso.cache += fin.uso.cache_read_input_tokens ?? 0
    }
    return fin
  }

  /* ------------------------------------------------------- herramientas */

  private async ejecutar(nombre: string, entrada: unknown, eventos: Evento[]): Promise<unknown> {
    const e = (entrada ?? {}) as Record<string, unknown>
    const fecha = typeof e.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.fecha) ? e.fecha : null
    const hora = typeof e.hora === 'string' && /^\d{2}:\d{2}$/.test(e.hora) ? e.hora : null
    const personas = Number.isInteger(e.personas) && (e.personas as number) > 0 ? (e.personas as number) : null
    try {
      switch (nombre) {
        case 'consultar_disponibilidad': {
          if (!fecha || !personas) return { error: 'Faltan la fecha (AAAA-MM-DD) o las personas.' }
          const dia = this.diaTexto(fecha)
          const d = estadoDia(this.negocio, fecha, this.ahora())
          if (!d.abierto) return { fecha, dia, cerrado: true, motivo: motivoTexto(d.motivo) }
          const disp = await this.conector.disponibilidad(fecha, personas)
          const salida: Record<string, unknown> = { fecha, dia, personas, horasLibres: disp.horas }
          if (!disp.horas.length) salida.aviso = 'No queda sitio ese día para esos comensales.'
          if (hora) {
            const c = await this.conector.comprobar(fecha, hora, personas)
            salida.horaPedida = c.ok
              ? { hora, libre: true }
              : { hora, libre: false, motivo: motivoTexto(c.motivo), alternativas: c.alternativas.map((h) => ({ ...h, dia: this.diaTexto(h.fecha) })) }
          }
          return salida
        }
        case 'crear_reserva': {
          const nombreCliente = typeof e.nombre === 'string' ? e.nombre.trim() : ''
          if (!fecha || !hora || !personas || !nombreCliente) return { error: 'Faltan datos: nombre, fecha, hora o personas.' }
          const r = await this.conector.crear({ nombre: nombreCliente, fecha, hora, personas, notas: typeof e.notas === 'string' ? e.notas : '', origen: 'ia', llamada: this.llamada, telefono: this.telefono })
          if (!r.ok) return { ok: false, error: `No se pudo reservar: ${motivoTexto(r.error)}. Vuelve a consultar la disponibilidad.` }
          eventos.push({ tipo: 'reserva', reserva: r.reserva })
          return { ok: true, codigo: r.reserva.codigo, dia: this.diaTexto(r.reserva.fecha), hora: r.reserva.hora, personas: r.reserva.personas }
        }
        case 'buscar_reserva': {
          const codigo = typeof e.codigo === 'string' ? e.codigo.replace(/[\s,.-]/g, '') : ''
          const nombreCliente = typeof e.nombre === 'string' ? e.nombre.trim() : ''
          const encontradas = codigo ? await this.conector.buscar({ codigo }) : nombreCliente ? await this.conector.buscar({ nombre: nombreCliente }) : []
          return { reservas: encontradas.slice(0, 3).map((r) => ({ codigo: r.codigo, nombre: r.nombre, dia: this.diaTexto(r.fecha), fecha: r.fecha, hora: r.hora, personas: r.personas })) }
        }
        case 'cancelar_reserva': {
          const codigo = typeof e.codigo === 'string' ? e.codigo.replace(/[\s,.-]/g, '') : ''
          const r = await this.conector.cancelar(codigo)
          if (!r.ok) return { ok: false, error: r.error }
          eventos.push({ tipo: 'cancelacion', reserva: r.reserva })
          return { ok: true }
        }
        case 'colgar': {
          this.resumen = typeof e.resumen === 'string' ? e.resumen.slice(0, 200) : ''
          if (e.motivo === 'transferir') eventos.push({ tipo: 'transferir', motivo: this.resumen || 'La IA pasó la llamada al equipo.' })
          return { ok: true }
        }
        default:
          return { error: `Herramienta desconocida: ${nombre}` }
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Error al consultar las reservas.' }
    }
  }

  private diaTexto(fecha: string): string {
    const [y, m, d] = fecha.split('-').map(Number) as [number, number, number]
    const dt = this.ahora().set({ year: y, month: m, day: d })
    return `${DIAS[dt.weekday - 1]} ${d} de ${MESES[m - 1]}`
  }
}

function isError(salida: unknown): boolean {
  return Boolean(salida && typeof salida === 'object' && 'error' in salida)
}

function motivoTexto(m: string): string {
  const t: Record<string, string> = {
    cerrado: 'ese día el restaurante cierra',
    vacaciones: 'ese día está cerrado por vacaciones',
    pasada: 'esa fecha u hora ya ha pasado o no llega a la antelación mínima',
    lejos: 'demasiado lejos: aún no se admiten reservas para esa fecha',
    grupo: 'grupo demasiado grande para reservar por teléfono',
    hora_no_valida: 'a esa hora no se sirven mesas',
    completo: 'completo a esa hora',
  }
  return t[m] ?? m
}

/**
 * Agrupa el texto que llega en trozos en frases completas, para que la voz
 * empiece en cuanto hay una frase y no al final de toda la respuesta.
 */
export class Frases {
  private buf = ''
  /** Todo el texto recibido, sin tocar. */
  todo = ''
  constructor(private salida: (frase: string) => void) {}

  añadir(t: string) {
    this.todo += t
    this.buf += t
    for (;;) {
      const m = this.buf.match(/^([\s\S]*?[.!?…])(\s+)(?=\S)/)
      if (!m) break
      // «R, X, 7…»: no cortar códigos ni decimales (sin espacio detrás no hay corte)
      this.emitir(m[1]!)
      this.buf = this.buf.slice(m[0].length)
    }
  }

  terminar() {
    this.emitir(this.buf)
    this.buf = ''
  }

  private emitir(f: string) {
    const limpia = f.replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim()
    if (limpia) this.salida(limpia)
  }
}
