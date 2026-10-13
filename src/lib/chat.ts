import type { DateTime } from 'luxon'
import { MotorClaude } from './dialogo/claude.js'
import { MotorLocal } from './dialogo/local.js'
import type { Evento, Motor } from './dialogo/tipos.js'
import { DIAS, MESES, fechaHablada } from './es/hablar.js'
import type { Negocio } from './negocio.js'
import type { Conector } from './reservas/conector.js'
import { estadoDia, turnoDe, type Reserva } from './reservas/motor.js'

/**
 * La conversación de WhatsApp: pasa lo que escribe el cliente al motor
 * (reglas o Claude) y convierte la respuesta en mensajes de WhatsApp con
 * botones, listas y tarjetas. Además lleva las automatizaciones que
 * quitan trabajo al restaurante: tarjeta de confirmación, recordatorio
 * con «Allí estaré / Cancelar», lista de espera y petición de reseña.
 *
 * Es la misma lógica para la demo (en el navegador) y para WhatsApp de
 * verdad (en la función de Vercel).
 */

export interface Boton {
  titulo: string
  /** Lo que se «escribe» al pulsarlo (o una acción interna que empieza por #). */
  valor?: string
  /** Botón de enlace (abre una web en vez de responder). */
  enlace?: string
}

export interface Lista {
  boton: string
  opciones: (Boton & { descripcion?: string })[]
}

export type Tarjeta = { tipo: 'reserva'; reserva: Reserva } | { tipo: 'ubicacion'; nombre: string; direccion: string; url: string }

export type Automatico = 'confirmacion' | 'recordatorio' | 'espera' | 'resena'

export interface Mensaje {
  id: string
  de: 'cliente' | 'negocio'
  texto: string
  hora: string
  botones?: Boton[]
  lista?: Lista
  tarjeta?: Tarjeta
  automatico?: Automatico
}

export interface Espera {
  id: string
  fecha: string
  turno: 'comida' | 'cena'
  personas: number
  nombre: string
  telefono: string
  estado: 'esperando' | 'avisado' | 'aceptado' | 'rechazado'
  creada: string
}

/** Lo que la conversación necesita del restaurante (las reservas las lleva el conector). */
export interface Restaurante {
  espera(): Espera[]
  guardarEspera(e: Espera[]): void
  /** Avisos para el equipo: quejas, transferencias… */
  avisar(texto: string): void
  actualizarReserva(codigo: string, cambios: Partial<Reserva>): void
}

export interface EstadoConversacion {
  motor: 'local' | 'claude'
  datos: unknown
  nombre: string
  esperandoQueja: boolean
}

let sec = 0
const nuevoId = () => `m${Date.now().toString(36)}${(sec++).toString(36)}`

const recortar = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…')

export interface OpcionesConversacion {
  negocio: Negocio
  conector: Conector
  restaurante: Restaurante
  ahora: () => DateTime
  telefono: string
  motor: 'local' | 'claude'
  /** Para hablar con Claude (en la demo, fetch a /api/chat). */
  fetchIA?: typeof fetch
}

export class Conversacion {
  private motor: Motor
  private estado: EstadoConversacion

  constructor(private o: OpcionesConversacion) {
    this.estado = { motor: o.motor, datos: null, nombre: '', esperandoQueja: false }
    this.motor = this.crearMotor(o.motor)
  }

  private crearMotor(tipo: 'local' | 'claude'): Motor {
    const { negocio, conector, ahora, telefono, fetchIA } = this.o
    return tipo === 'claude' ? new MotorClaude(negocio, conector, ahora, telefono, fetchIA, telefono) : new MotorLocal(negocio, conector, ahora, telefono, telefono)
  }

  get tipoMotor() {
    return this.motor.nombre
  }

  exportar(): EstadoConversacion {
    return { ...this.estado, motor: this.motor.nombre, datos: (this.motor as MotorLocal | MotorClaude).exportar() }
  }

  importar(e: EstadoConversacion) {
    this.estado = { ...e }
    this.motor = this.crearMotor(e.motor)
    ;(this.motor as MotorLocal | MotorClaude).importar(e.datos)
  }

  private msg(m: Omit<Mensaje, 'id' | 'hora' | 'de'>): Mensaje {
    return { id: nuevoId(), de: 'negocio', hora: this.o.ahora().toISO()!, ...m }
  }

  /** Mensaje de bienvenida (el cliente abre el chat). */
  saludo(): Mensaje[] {
    const texto = this.motor.saludo()
    this.estado.datos = (this.motor as MotorLocal | MotorClaude).exportar()
    return [this.msg({ texto, botones: this.botonesInicio() })]
  }

  private botonesInicio(): Boton[] {
    return [
      { titulo: '📅 Reservar mesa', valor: 'quiero reservar una mesa' },
      { titulo: '📄 Ver la carta', valor: '#carta' },
      { titulo: '📍 Cómo llegar', valor: '#ubicacion' },
    ]
  }

  /** El cliente escribe o pulsa un botón. Devuelve las respuestas del negocio. */
  async recibir(valor: string): Promise<Mensaje[]> {
    const v = valor.trim()
    if (!v) return []
    if (v.startsWith('#')) return this.accion(v)

    if (this.estado.esperandoQueja) {
      this.estado.esperandoQueja = false
      this.o.restaurante.avisar(`Queja privada de ${this.estado.nombre || this.o.telefono}: «${v.slice(0, 400)}»`)
      return [this.msg({ texto: 'Gracias por contárnoslo 🙏 Se lo paso ahora mismo al encargado, que te escribirá hoy por aquí para solucionarlo.' })]
    }

    let r
    try {
      r = await this.motor.responder(v)
    } catch (err) {
      if (this.motor.nombre !== 'claude') throw err
      // La IA no está disponible (sin saldo, sin red…): sigue el motor de reglas.
      this.motor = this.crearMotor('local')
      r = await this.motor.responder(v)
    }
    this.estado.datos = (this.motor as MotorLocal | MotorClaude).exportar()
    const salida: Mensaje[] = []
    const { texto, botones } = extraerBotones(r.decir)
    const reserva = r.eventos.find((e): e is Extract<Evento, { tipo: 'reserva' }> => e.tipo === 'reserva')?.reserva
    const transferir = r.eventos.find((e): e is Extract<Evento, { tipo: 'transferir' }> => e.tipo === 'transferir')
    for (const e of r.eventos) if (e.tipo === 'cancelacion') salida.push(...this.liberar(e.reserva))
    if (reserva) this.estado.nombre = reserva.nombre

    const m = this.msg({ texto: texto || '…' })
    if (botones.length) m.botones = botones.slice(0, 3)
    else if (!reserva && !transferir) Object.assign(m, this.opcionesSegunMotor(r.decir))
    salida.unshift(m)
    if (reserva) salida.push(this.tarjetaReserva(reserva))
    if (transferir) this.o.restaurante.avisar(`Atender a ${this.estado.nombre || this.o.telefono}: ${transferir.motivo}`)
    return salida
  }

  /** Botones o lista según lo que esté esperando el motor de reglas. */
  private opcionesSegunMotor(texto: string): Partial<Mensaje> {
    if (!(this.motor instanceof MotorLocal)) return {}
    const p = this.motor.pendiente
    const ahora = this.o.ahora()
    const n = this.o.negocio
    switch (p.esperando) {
      case 'fecha': {
        const dias: Lista['opciones'] = []
        for (let i = 0; dias.length < 8 && i < 21; i++) {
          const d = ahora.plus({ days: i })
          const f = d.toISODate()!
          if (!estadoDia(n, f, ahora).abierto) continue
          dias.push({ titulo: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : `${cap(DIAS[d.weekday - 1]!)} ${d.day}`, descripcion: `${d.day} de ${MESES[d.month - 1]}`, valor: i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${d.day} de ${MESES[d.month - 1]}` })
        }
        return { lista: { boton: 'Elegir día', opciones: dias } }
      }
      case 'personas':
        return { lista: { boton: 'Elegir personas', opciones: [...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ titulo: k === 1 ? '1 persona' : `${k} personas`, valor: `somos ${k}` })), { titulo: 'Más de 8', valor: `somos ${n.maxPersonas + 1}`, descripcion: 'Lo organiza el equipo' }] } }
      case 'hora':
      case 'alternativa': {
        const alt = p.alternativas
        const mismoDia = alt.every((h) => h.fecha === p.datos.fecha)
        const op = alt.map((h) => ({
          titulo: mismoDia ? h.hora : `${cap(DIAS[DateTimeDia(h.fecha)]!.slice(0, 3))} ${Number(h.fecha.slice(8))} · ${h.hora}`,
          valor: mismoDia ? `a las ${h.hora}` : `el ${Number(h.fecha.slice(8))} de ${MESES[Number(h.fecha.slice(5, 7)) - 1]} a las ${h.hora}`,
          descripcion: turnoDe(n, h.hora) === 'comida' ? 'Comida' : 'Cena',
        }))
        // Si lo pedido está completo, además de alternativas se ofrece la lista de espera.
        const espera: Boton[] = p.esperando === 'alternativa' && /complet/i.test(texto) && p.datos.fecha && p.datos.personas ? [{ titulo: '🔔 Avísame si se libera', valor: `#espera:${p.datos.fecha}|${p.datos.personas}|${p.datos.turno ?? 'cena'}` }] : []
        // WhatsApp admite 3 botones: con lista de espera, dos alternativas y el aviso a la vista.
        if (espera.length) return { botones: [...op.slice(0, 2), ...espera].map(({ titulo, valor }) => ({ titulo, valor })) }
        if (op.length <= 3) return { botones: op.map(({ titulo, valor }) => ({ titulo, valor })) }
        return { lista: { boton: 'Ver horas', opciones: [...op.slice(0, 9), ...espera] } }
      }
      case 'notas':
        return { botones: [{ titulo: 'Nada, gracias', valor: 'no' }, { titulo: '👶 Necesito trona', valor: 'necesitamos trona' }, { titulo: '🎂 Es un cumpleaños', valor: 'es un cumpleaños' }] }
      case 'confirmar':
        return { botones: [{ titulo: '✅ Confirmar', valor: 'sí' }, { titulo: '✏️ Cambiar algo', valor: 'no' }] }
      case 'confirmar_cancelar':
        return { botones: [{ titulo: 'Sí, cancelar', valor: 'sí' }, { titulo: 'No, mantenerla', valor: 'no' }] }
      case 'nombre':
      case 'codigo':
        return {}
      default:
        return { botones: this.botonesInicio() }
    }
  }

  /* --------------------------------------------------- acciones (#…) */

  private async accion(v: string): Promise<Mensaje[]> {
    const [cmd, arg = ''] = v.slice(1).split(/:(.*)/s) as [string, string?]
    const n = this.o.negocio
    switch (cmd) {
      case 'carta':
        return [this.msg({ texto: (await import('./dialogo/info.js')).resumenCarta(n), botones: [{ titulo: '📅 Reservar mesa', valor: 'quiero reservar una mesa' }, { titulo: '🌾 Sin gluten', valor: '¿qué tenéis sin gluten?' }] })]
      case 'ubicacion':
        return [this.msg({ texto: `📍 Estamos en *${n.direccion}*. ¡Te esperamos!`, tarjeta: { tipo: 'ubicacion', nombre: n.nombre, direccion: n.direccion, url: n.mapa ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n.direccion)}` } })]
      case 'cancelar': {
        const r = (await this.o.conector.buscar({ codigo: arg }))[0]
        if (!r) return [this.msg({ texto: 'Esa reserva ya no está activa.' })]
        return [this.msg({ texto: `¿Seguro que quieres cancelar tu reserva del *${fechaHablada(r.fecha, this.o.ahora())} a las ${r.hora}*?`, botones: [{ titulo: 'Sí, cancelar', valor: `#cancelar!:${r.codigo}` }, { titulo: 'No, mantenerla', valor: '#mantener' }] })]
      }
      case 'cancelar!': {
        const r = await this.o.conector.cancelar(arg)
        if (!r.ok) return [this.msg({ texto: 'Esa reserva ya no está activa.' })]
        return [this.msg({ texto: 'Listo, reserva cancelada. ¡Gracias por avisar! Así podemos dar la mesa a otra persona 🙏' }), ...this.liberar(r.reserva)]
      }
      case 'mantener':
        return [this.msg({ texto: 'Perfecto, la mantengo 👍' })]
      case 'confirmar': {
        this.o.restaurante.actualizarReserva(arg, { asistencia: 'confirmada' })
        return [this.msg({ texto: `¡Genial${this.estado.nombre ? `, ${this.estado.nombre.split(' ')[0]}` : ''}! Te esperamos 🙌` })]
      }
      case 'espera': {
        const [fecha, personas, turno] = arg.split('|') as [string, string, string?]
        const lista = this.o.restaurante.espera()
        const e: Espera = { id: nuevoId(), fecha, turno: turno === 'comida' ? 'comida' : 'cena', personas: Number(personas), nombre: this.estado.nombre || 'Cliente de WhatsApp', telefono: this.o.telefono, estado: 'esperando', creada: this.o.ahora().toISO()! }
        this.o.restaurante.guardarEspera([...lista, e])
        return [this.msg({ texto: `Hecho 🔔 Te apunto en la lista de espera para *${e.personas} personas* ${fechaHablada(fecha, this.o.ahora())}. Si se libera una mesa, te aviso por aquí al momento.` })]
      }
      case 'aceptar': {
        const [id, hora] = arg.split('|') as [string, string]
        const lista = this.o.restaurante.espera()
        const e = lista.find((x) => x.id === id)
        if (!e || e.estado !== 'avisado') return [this.msg({ texto: 'Vaya, esa mesa ya no está disponible 😕' })]
        const r = await this.o.conector.crear({ nombre: e.nombre, telefono: e.telefono, fecha: e.fecha, hora, personas: e.personas, notas: 'Desde la lista de espera', origen: 'ia' })
        this.o.restaurante.guardarEspera(lista.map((x) => (x.id === id ? { ...x, estado: r.ok ? 'aceptado' : x.estado } : x)))
        if (!r.ok) return [this.msg({ texto: 'Vaya, alguien ha sido más rápido y la mesa ya no está libre 😕 Sigues en la lista de espera.' })]
        return [this.msg({ texto: `¡Mesa reservada! ✅ Código: *${r.reserva.codigo}*.` }), this.tarjetaReserva(r.reserva)]
      }
      case 'rechazar': {
        this.o.restaurante.guardarEspera(this.o.restaurante.espera().map((x) => (x.id === arg ? { ...x, estado: 'rechazado' } : x)))
        return [this.msg({ texto: 'Sin problema. ¡Otra vez será! 👋' })]
      }
      case 'problema':
        this.estado.esperandoQueja = true
        this.o.restaurante.actualizarReserva(arg, { resena: 'problema' })
        return [this.msg({ texto: 'Vaya, lo sentimos mucho 😔 ¿Nos cuentas qué pasó? Lo leerá el encargado personalmente.' })]
      case 'no_texto':
        return [this.msg({ texto: 'Por ahora solo entiendo mensajes de texto 🙏 ¿Me lo escribes?', botones: this.botonesInicio() })]
      default:
        return [this.msg({ texto: 'Perdona, no he entendido esa opción.' })]
    }
  }

  /* ---------------------------------------------------- automatizaciones */

  tarjetaReserva(r: Reserva): Mensaje {
    return this.msg({
      texto: '',
      tarjeta: { tipo: 'reserva', reserva: r },
      automatico: 'confirmacion',
      botones: [
        { titulo: '📅 Añadir al calendario', enlace: `calendario:${r.codigo}` },
        { titulo: '📍 Cómo llegar', valor: '#ubicacion' },
        { titulo: '❌ Cancelar', valor: `#cancelar:${r.codigo}` },
      ],
    })
  }

  /** Recordatorio del día antes, con respuesta de un toque. */
  recordatorio(r: Reserva): Mensaje {
    this.o.restaurante.actualizarReserva(r.codigo, { recordatorio: true })
    return this.msg({
      automatico: 'recordatorio',
      texto: `Hola ${r.nombre.split(' ')[0]} 👋 Te recordamos tu reserva en *${this.o.negocio.nombre}*:\n📅 ${cap(fechaHablada(r.fecha, this.o.ahora()))} a las *${r.hora}*\n👥 ${r.personas} personas\n\n¿Nos vemos?`,
      botones: [
        { titulo: '✅ Allí estaré', valor: `#confirmar:${r.codigo}` },
        { titulo: '❌ Cancelar', valor: `#cancelar:${r.codigo}` },
      ],
    })
  }

  /** Al día siguiente de la visita. Las quejas van por privado; nunca se filtra quién puede dejar reseña. */
  resena(r: Reserva): Mensaje {
    this.o.restaurante.actualizarReserva(r.codigo, { resena: 'pedida' })
    return this.msg({
      automatico: 'resena',
      texto: `¡Gracias por venir ayer a ${this.o.negocio.nombre}, ${r.nombre.split(' ')[0]}! 🌙\n\nSi te gustó, nos ayudas muchísimo con una reseña en Google: son 30 segundos ⭐`,
      botones: [
        { titulo: '⭐ Dejar reseña', enlace: this.o.negocio.resena ?? 'https://google.com/maps' },
        { titulo: 'Tuve un problema', valor: `#problema:${r.codigo}` },
      ],
    })
  }

  /**
   * Se ha cancelado una reserva: si alguien de la lista de espera cabe ahora
   * en ese turno, se le avisa. Solo devuelve mensajes para ESTA conversación
   * (en WhatsApp real, la función los envía a cada teléfono).
   */
  liberar(cancelada: Reserva): Mensaje[] {
    const avisos = avisosDeEspera(cancelada, this.o)
    for (const a of avisos) if (a.espera.telefono !== this.o.telefono) this.paraOtros.push({ telefono: a.espera.telefono, mensaje: a.mensaje })
    return avisos.filter((a) => a.espera.telefono === this.o.telefono).map((a) => this.msg(a.mensaje))
  }

  /** Avisos de lista de espera para otros teléfonos (los envía el webhook). */
  readonly paraOtros: { telefono: string; mensaje: Omit<Mensaje, 'id' | 'hora' | 'de'> }[] = []
}

/** Avisos para la lista de espera tras una cancelación (para cualquier teléfono). */
export function avisosDeEspera(cancelada: Reserva, o: Pick<OpcionesConversacion, 'negocio' | 'restaurante' | 'ahora'>): { espera: Espera; mensaje: Omit<Mensaje, 'id' | 'hora' | 'de'> }[] {
  const lista = o.restaurante.espera()
  const out: { espera: Espera; mensaje: Omit<Mensaje, 'id' | 'hora' | 'de'> }[] = []
  const turno = turnoDe(o.negocio, cancelada.hora)
  for (const e of lista) {
    if (e.estado !== 'esperando' || e.fecha !== cancelada.fecha || e.turno !== turno || e.personas > cancelada.personas + 2) continue
    // La hora liberada es la de la reserva cancelada.
    e.estado = 'avisado'
    out.push({
      espera: e,
      mensaje: {
        automatico: 'espera',
        texto: `🔔 ¡Buenas noticias${e.nombre !== 'Cliente de WhatsApp' ? `, ${e.nombre.split(' ')[0]}` : ''}! Se ha liberado una mesa para *${e.personas} personas* ${fechaHablada(e.fecha, o.ahora())} a las *${cancelada.hora}*.\n\n¿Te la reservo? La guardamos 15 minutos.`,
        botones: [
          { titulo: '✅ Sí, resérvala', valor: `#aceptar:${e.id}|${cancelada.hora}` },
          { titulo: 'No, gracias', valor: `#rechazar:${e.id}` },
        ],
      },
    })
  }
  if (out.length) o.restaurante.guardarEspera(lista)
  return out
}

/** Claude marca los botones como [[Texto]] al final del mensaje. */
export function extraerBotones(texto: string): { texto: string; botones: Boton[] } {
  const botones: Boton[] = []
  const limpio = texto
    .replace(/\[\[([^\]]{1,40})\]\]/g, (_, t: string) => {
      botones.push({ titulo: recortar(t.trim(), 20), valor: t.trim() })
      return ''
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  return { texto: limpio, botones }
}

/** Fichero .ics para «Añadir al calendario». */
export function ics(r: Reserva, negocio: Negocio): string {
  const [y, m, d] = r.fecha.split('-')
  const [hh, mm] = r.hora.split(':')
  const ini = `${y}${m}${d}T${hh}${mm}00`
  const finH = String(Number(hh) + 2).padStart(2, '0')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DH Technology//WhatsApp IA//ES',
    'BEGIN:VEVENT',
    `UID:${r.codigo}@whatsapp-ia`,
    `DTSTART;TZID=${negocio.zonaHoraria}:${ini}`,
    `DTEND;TZID=${negocio.zonaHoraria}:${y}${m}${d}T${finH}${mm}00`,
    `SUMMARY:Reserva en ${negocio.nombre} (${r.personas} personas)`,
    `LOCATION:${negocio.direccion.replace(/,/g, '\\,')}`,
    `DESCRIPTION:Código de reserva: ${r.codigo}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** Día de la semana (0 = lunes) de una fecha AAAA-MM-DD. */
function DateTimeDia(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number]
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}
