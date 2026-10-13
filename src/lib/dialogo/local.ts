import type { DateTime } from 'luxon'
import { analizar, type Analisis, type Esperando } from '../es/entender.js'
import { aLaHora, fechaHablada, lista, personasHabladas } from '../es/hablar.js'
import { normalizar } from '../es/numeros.js'
import type { Negocio, Turno } from '../negocio.js'
import type { Conector } from '../reservas/conector.js'
import { estadoDia, type Hueco, type MotivoNo, type Reserva } from '../reservas/motor.js'
import { horarioHablado, platosMencionados, rangoTurno, resumenCarta, sobreDieta, sobrePlatos } from './info.js'
import type { Evento, Motor, Respuesta } from './tipos.js'

/**
 * Motor de diálogo sin IA: una máquina de estados que rellena los datos de
 * la reserva (día, comensales, hora, nombre, observaciones), consulta la
 * disponibilidad real, ofrece alternativas y confirma. Responde al momento
 * y no cuesta nada, así que la demo funciona aunque no haya clave de API.
 */

interface Datos {
  fecha?: string
  hora?: string
  turno?: Turno
  personas?: number
  nombre?: string
  notas: string[]
  notasPreguntadas: boolean
}

interface Estado {
  modo: 'inicio' | 'reserva' | 'cancelar'
  datos: Datos
  esperando?: Esperando
  alternativas: Hueco[]
  candidata?: Reserva
  /** Tras cancelar, hacer una reserva nueva (el cliente quería cambiarla). */
  rehacer: boolean
  fallos: number
  intentosCodigo: number
}

const nuevo = (): Estado => ({ modo: 'inicio', datos: { notas: [], notasPreguntadas: false }, alternativas: [], rehacer: false, fallos: 0, intentosCodigo: 0 })

export class MotorLocal implements Motor {
  readonly nombre = 'local' as const
  private e: Estado = nuevo()
  private eventos: Evento[] = []

  constructor(
    private negocio: Negocio,
    private conector: Conector,
    private ahora: () => DateTime,
    private llamada?: string,
    /** Número de quien llama (en el teléfono real); se guarda con la reserva. */
    private telefono?: string,
  ) {}

  /** Qué está esperando y qué opciones ha ofrecido: la capa de chat lo convierte en botones. */
  get pendiente(): { esperando?: Esperando; alternativas: Hueco[]; modo: 'inicio' | 'reserva' | 'cancelar'; datos: { fecha?: string; personas?: number; turno?: Turno } } {
    return { esperando: this.e.esperando, alternativas: this.e.alternativas, modo: this.e.modo, datos: { fecha: this.e.datos.fecha, personas: this.e.datos.personas, turno: this.e.datos.turno } }
  }

  /** Estado serializable, para seguir la conversación en otra petición. */
  exportar(): unknown {
    return { e: this.e, fechaVaga: this.fechaVaga }
  }

  importar(datos: unknown) {
    const d = datos as { e?: Estado; fechaVaga?: string } | null
    if (d?.e) this.e = d.e
    this.fechaVaga = d?.fechaVaga
  }

  saludo(): string {
    return `¡Hola! 👋 Soy ${this.negocio.asistente}, el asistente de ${this.negocio.nombre}. Puedo reservarte mesa, cambiar o cancelar una reserva y resolver tus dudas. ¿Qué necesitas?`
  }

  async responder(texto: string): Promise<Respuesta> {
    this.eventos = []
    const decir = await this.turno(texto)
    return { decir: decir.texto, eventos: this.eventos, colgar: decir.colgar }
  }

  private async turno(texto: string): Promise<{ texto: string; colgar?: boolean }> {
    const e = this.e
    const a = analizar(texto, { hoy: this.ahora(), esperando: e.esperando, negocio: this.negocio, turno: e.datos.turno })

    if (a.intenciones.has('persona')) return this.transferir('El cliente pidió hablar con una persona.')
    if (this.seDespide(a)) return { texto: `¡Gracias por escribirnos! Aquí estamos para lo que necesites 🌙`, colgar: true }

    if (a.intenciones.has('cancelar') && e.modo !== 'cancelar') return this.empezarCancelacion(false)
    if (a.intenciones.has('modificar') && e.modo !== 'cancelar') return this.empezarCancelacion(true)
    if (e.modo === 'cancelar') return this.cancelacion(a, texto)

    if (e.esperando === 'confirmar') {
      const r = await this.confirmacion(a)
      if (r) return r
    }
    if (e.esperando === 'alternativa' || (e.esperando === 'hora' && e.alternativas.length)) this.elegirAlternativa(a)
    if (e.esperando === 'notas') this.recogerNotas(a, texto)

    const info = this.informacion(a)
    const datosNuevos = Boolean(a.fecha || a.hora || a.personas || a.fechaVaga || (a.nombre && e.esperando === 'nombre'))
    if (a.intenciones.has('reservar') || a.intenciones.has('disponibilidad') || (datosNuevos && !info) || (e.modo === 'reserva' && datosNuevos)) {
      if (e.modo !== 'reserva') e.modo = 'reserva'
    }

    if (e.modo === 'reserva') {
      const nuevas = a.notas.filter((n) => !e.datos.notas.includes(n))
      this.mezclar(a)
      if (nuevas.length && !info && e.esperando !== 'notas') {
        const paso = await this.siguientePaso()
        return { texto: `Lo anoto: ${lista(nuevas.map((x) => x.toLowerCase()))}. ${paso}` }
      }
      const paso = await this.siguientePaso()
      e.fallos = 0
      return { texto: info ? `${info} ${paso}` : paso }
    }

    if (info) {
      e.fallos = 0
      e.esperando = 'algo_mas'
      return { texto: `${info}\n\n¿Te ayudo con algo más?` }
    }
    if (e.esperando === 'algo_mas' && a.afirma === true) {
      e.esperando = undefined
      return { texto: 'Claro, dígame.' }
    }
    if (a.intenciones.has('saludo')) return { texto: '¡Hola! ¿En qué te ayudo? Puedo hacerte una reserva, cancelarla o resolver cualquier duda.' }
    if (a.intenciones.has('gracias')) {
      e.esperando = 'algo_mas'
      return { texto: '¡A ti! ¿Necesitas algo más?' }
    }
    return this.noEntendido()
  }

  private seDespide(a: Analisis): boolean {
    if (a.intenciones.has('despedida')) return true
    const enPausa = this.e.esperando === 'algo_mas' || (this.e.modo === 'inicio' && !this.e.esperando)
    return enPausa && this.e.esperando === 'algo_mas' && (a.afirma === false || (a.intenciones.has('gracias') && a.intenciones.size === 1))
  }

  private transferir(motivo: string) {
    this.eventos.push({ tipo: 'transferir', motivo })
    return { texto: 'Vale, aviso al equipo del restaurante y te escriben por aquí en cuanto puedan 🙌', colgar: true }
  }

  private noEntendido(): { texto: string; colgar?: boolean } {
    const e = this.e
    e.fallos++
    if (e.fallos >= 3) return this.transferir('La recepcionista no entendió al cliente tres veces seguidas.')
    const preguntas: Partial<Record<Esperando, string>> = {
      fecha: 'Perdona, ¿para qué día sería la reserva?',
      personas: 'Perdona, ¿cuántas personas seríais?',
      hora: 'Perdona, ¿a qué hora te vendría bien?',
      nombre: '¿A nombre de quién pongo la reserva?',
      codigo: '¿Me pasas el código de la reserva? Viene en el mensaje de confirmación.',
    }
    const p = e.esperando && preguntas[e.esperando]
    if (p) return { texto: p }
    return { texto: 'Perdona, no te he entendido 😅 ¿Quieres hacer una reserva, cancelar una o tienes alguna pregunta?' }
  }

  /* -------------------------------------------------------- información */

  private informacion(a: Analisis): string | null {
    const n = this.negocio
    const partes: string[] = []
    const platos = platosMencionados(n, a.texto)
    if (platos.length && (a.pregunta || /cuanto|precio|lleva|cuesta/.test(a.texto))) partes.push(sobrePlatos(platos))
    else if (a.intenciones.has('dieta') && a.dieta && (a.pregunta || !a.notas.length)) partes.push(sobreDieta(n, a.dieta))
    // «Venimos con un bebé» es un dato para la reserva, no una pregunta sobre tronas.
    else if (a.intenciones.has('faq') && a.faq && (a.pregunta || !a.notas.length)) partes.push(a.faq.respuesta)
    else if (a.intenciones.has('carta')) partes.push(resumenCarta(n))
    if (a.intenciones.has('horario')) {
      if (a.fecha) {
        const d = estadoDia(n, a.fecha, this.ahora())
        const cuando = fechaHablada(a.fecha, this.ahora())
        partes.push(d.abierto ? `Sí, ${cuando} abrimos: comidas ${rangoTurno(n.horas.comida)} y cenas ${rangoTurno(n.horas.cena)}.` : `${capital(cuando)} está cerrado.`)
      } else partes.push(horarioHablado(n))
    }
    if (a.intenciones.has('direccion')) partes.push(`Estamos en ${n.direccion.replace(/, \d{5}/, ',')}.`)
    return partes.length ? partes.join(' ') : null
  }

  /* ------------------------------------------------------------ reserva */

  private mezclar(a: Analisis) {
    const d = this.e.datos
    if (a.fecha && a.fecha !== d.fecha) {
      d.fecha = a.fecha
      this.e.alternativas = []
    }
    if (a.turno && !a.hora) d.turno = a.turno
    if (a.hora) {
      d.hora = a.hora
      d.turno = a.turno
    }
    if (a.personas) d.personas = a.personas
    if (a.nombre && (this.e.esperando === 'nombre' || !d.nombre)) d.nombre = a.nombre
    for (const nota of a.notas) if (!d.notas.includes(nota)) d.notas.push(nota)
    this.fechaVaga = a.fechaVaga
  }
  private fechaVaga?: string

  private async siguientePaso(): Promise<string> {
    const e = this.e
    const d = e.datos
    const n = this.negocio
    const ahora = this.ahora()

    if (!d.fecha) {
      e.esperando = 'fecha'
      if (this.fechaVaga === 'el fin de semana') return '¿Qué día del fin de semana prefieres, el sábado o el domingo?'
      if (this.fechaVaga) return `¿Qué día de ${this.fechaVaga} te vendría bien?`
      return '¡Genial! ¿Para qué día sería?'
    }
    const dia = estadoDia(n, d.fecha, ahora)
    if (!dia.abierto) {
      const cuando = fechaHablada(d.fecha, ahora)
      d.fecha = undefined
      d.hora = undefined
      e.esperando = 'fecha'
      return `${frasesCierre(dia.motivo, cuando, n)} ¿Te viene bien otro día?`
    }
    if (!d.personas) {
      e.esperando = 'personas'
      return '¿Para cuántas personas?'
    }
    const maximo = Math.min(n.maxPersonas, Math.max(...n.mesas.map((m) => m.plazas)))
    if (d.personas > maximo) {
      this.eventos.push({ tipo: 'transferir', motivo: `Grupo de ${d.personas} personas para ${d.fecha}.` })
      e.esperando = undefined
      return `Para grupos de más de ${maximo} personas lo organiza el equipo directamente: les aviso y te escriben por aquí 🙌`
    }
    const cuando = fechaHablada(d.fecha, ahora)

    if (!d.hora) {
      const disp = await this.conector.disponibilidad(d.fecha, d.personas)
      let horas = disp.horas
      if (d.turno) horas = horas.filter((h) => (Number(h.slice(0, 2)) < 18 ? 'comida' : 'cena') === d.turno)
      if (!horas.length) {
        const otra = await this.conector.comprobar(d.fecha, d.turno === 'comida' ? n.horas.comida[1] ?? '14:00' : n.horas.cena[2] ?? '21:00', d.personas)
        const alt = otra.ok ? [] : otra.alternativas.filter((h) => h.fecha !== d.fecha)
        if (alt.length) return this.ofrecer(alt, `Para ${cuando} ya no me queda sitio para ${personasHabladas(d.personas)}${d.turno ? (d.turno === 'cena' ? ' para cenar' : ' para comer') : ''}.`)
        e.esperando = 'fecha'
        d.fecha = undefined
        return `Para ${cuando} está todo completo 😕 ¿Te busco otro día?`
      }
      e.alternativas = horas.map((h) => ({ fecha: d.fecha!, hora: h }))
      if (horas.length === 1) {
        e.esperando = 'alternativa'
        return `Para ${cuando} solo me queda mesa ${aLaHora(horas[0]!)}. ¿Te viene bien?`
      }
      e.esperando = 'hora'
      const muestra = horas.length <= 4 ? horas : [horas[0]!, horas[Math.floor(horas.length / 2)]!, horas.at(-1)!]
      const intro = horas.length <= 4 ? 'tengo mesa' : 'tengo varias horas libres, por ejemplo'
      return `Para ${cuando} ${intro} ${lista(muestra.map(aLaHora), 'o')}. ¿Qué hora prefieres?`
    }

    const c = await this.conector.comprobar(d.fecha, d.hora, d.personas)
    if (!c.ok) {
      const pedida = d.hora
      d.hora = undefined
      if (c.motivo === 'grupo') return this.siguientePaso()
      const porque: Record<string, string> = {
        completo: `${capital(aLaHora(pedida))} ya lo tengo completo.`,
        hora_no_valida: `${capital(aLaHora(pedida))} no damos mesas: para comer es ${rangoTurno(n.horas.comida)} y para cenar ${rangoTurno(n.horas.cena)}.`,
        pasada: `Esa hora ya no la puedo reservar, necesitamos al menos ${n.antelacionMin >= 60 ? `${n.antelacionMin / 60 === 1 ? 'una hora' : `${n.antelacionMin / 60} horas`}` : `${n.antelacionMin} minutos`} de antelación.`,
      }
      if (c.alternativas.length) return this.ofrecer(c.alternativas, porque[c.motivo] ?? 'A esa hora no tengo sitio.')
      d.fecha = undefined
      e.esperando = 'fecha'
      return `${porque[c.motivo] ?? 'A esa hora no tengo sitio.'} Y ese día no me queda nada más. ¿Te busco otro día?`
    }

    if (!d.nombre) {
      e.esperando = 'nombre'
      return `¡Perfecto! Tengo mesa para *${personasHabladas(d.personas)}* ${cuando} ${aLaHora(d.hora)}. ¿A nombre de quién la pongo?`
    }
    if (!d.notasPreguntadas && !d.notas.length) {
      d.notasPreguntadas = true
      e.esperando = 'notas'
      return `Gracias, ${d.nombre.split(' ')[0]}. ¿Alguna alergia o algo que quieras que anotemos?`
    }
    e.esperando = 'confirmar'
    const notas = d.notas.length ? ` Y anoto: ${lista(d.notas.map((x) => x.toLowerCase()))}.` : ''
    return `Te confirmo:\n📅 ${capital(cuando)} ${aLaHora(d.hora)}\n👥 ${personasHabladas(d.personas)}\n👤 ${d.nombre}${notas ? `\n📝 ${notas.replace(' Y anoto: ', '').replace(/\.$/, '')}` : ''}\n\n¿Está bien?`
  }

  private ofrecer(alt: Hueco[], motivo: string): string {
    const e = this.e
    const ahora = this.ahora()
    e.alternativas = alt
    e.esperando = 'alternativa'
    const mismoDia = alt.every((h) => h.fecha === alt[0]!.fecha)
    // Pidió cenar y solo queda para comer (o al revés): se dice, que «a las dos» solo no basta.
    const turnoAlt = alt.every((h) => Number(h.hora.slice(0, 2)) < 18) ? 'comida' : alt.every((h) => Number(h.hora.slice(0, 2)) >= 18) ? 'cena' : null
    const pedido = e.datos.turno
    const aviso = turnoAlt && pedido && turnoAlt !== pedido ? (turnoAlt === 'comida' ? 'para comer ' : 'para cenar ') : ''
    const opciones = mismoDia
      ? `${alt[0]!.fecha === e.datos.fecha ? '' : `${fechaHablada(alt[0]!.fecha, ahora)} `}${lista(alt.map((h) => aLaHora(h.hora)), 'o')}`
      : lista(alt.map((h) => `${fechaHablada(h.fecha, ahora)} ${aLaHora(h.hora)}`), 'o')
    return `${motivo} Te puedo ofrecer ${aviso}${opciones.trim()}. ¿Te viene bien ${alt.length === 1 ? '' : 'alguna'}?`.replace(' ?', '?')
  }

  private elegirAlternativa(a: Analisis) {
    const e = this.e
    const alt = e.alternativas
    let elegida: Hueco | undefined
    if (a.ordinal !== undefined) elegida = a.ordinal === -1 ? alt.at(-1) : alt[a.ordinal]
    else if (a.hora) elegida = alt.find((h) => h.hora === a.hora && (!a.fecha || h.fecha === a.fecha))
    else if (a.fecha) elegida = alt.find((h) => h.fecha === a.fecha)
    else if (a.afirma === true && alt.length === 1) elegida = alt[0]
    if (elegida) {
      e.datos.fecha = elegida.fecha
      e.datos.hora = elegida.hora
      e.alternativas = []
      // Que mezclar() no la pise con una lectura parcial de la misma frase.
      a.hora = undefined
      a.fecha = undefined
    } else if (a.afirma === false || /otro dia/.test(a.texto)) {
      e.datos.hora = undefined
      if (/otro dia/.test(a.texto) || !alt.some((h) => h.fecha === e.datos.fecha)) e.datos.fecha = undefined
      e.alternativas = []
    }
  }

  private recogerNotas(a: Analisis, texto: string) {
    const d = this.e.datos
    if (a.afirma === false || /^(nada|ninguna|no hay|todo bien|esta bien asi)/.test(a.texto)) return
    if (a.notas.length) {
      for (const n of a.notas) if (!d.notas.includes(n)) d.notas.push(n)
      return
    }
    const limpio = texto.trim().replace(/^(sí|si|pues|vale)[, ]+/i, '')
    if (limpio.length > 2 && !a.fecha && !a.hora && !a.personas) d.notas.push(capital(limpio.slice(0, 120)))
  }

  private async confirmacion(a: Analisis): Promise<{ texto: string; colgar?: boolean } | null> {
    const e = this.e
    const d = e.datos
    if (a.afirma === true && !a.fecha && !a.hora && !a.personas) {
      const r = await this.conector.crear({
        nombre: d.nombre!,
        fecha: d.fecha!,
        hora: d.hora!,
        personas: d.personas!,
        notas: d.notas.join('. '),
        origen: 'ia',
        llamada: this.llamada,
        telefono: this.telefono,
      })
      if (!r.ok) {
        d.hora = undefined
        return { texto: `Vaya, se acaba de ocupar esa hora. ${await this.siguientePaso()}` }
      }
      this.eventos.push({ tipo: 'reserva', reserva: r.reserva })
      const nombre = d.nombre!
      const cuando = fechaHablada(r.reserva.fecha, this.ahora())
      this.e = nuevo()
      this.e.datos.nombre = nombre
      this.e.esperando = 'algo_mas'
      return {
        texto: `¡Hecho! ✅ Tu reserva está confirmada. Código: *${r.reserva.codigo}*. Te esperamos ${cuando} ${aLaHora(r.reserva.hora)}. Te mandaré un recordatorio el día antes.`,
      }
    }
    if (a.afirma === false || a.fecha || a.hora || a.personas || a.nombre) {
      const t = a.texto
      if (/\b(dia|fecha)\b/.test(t) && !a.fecha) d.fecha = undefined
      if (/\bhora\b/.test(t) && !a.hora) d.hora = undefined
      if (/\b(personas|gente|somos|comensales)\b/.test(t) && !a.personas) d.personas = undefined
      if (/\bnombre\b/.test(t) && !a.nombre) d.nombre = undefined
      if (a.nombre) d.nombre = a.nombre
      if (!a.fecha && !a.hora && !a.personas && !a.nombre && d.fecha && d.hora && d.personas && d.nombre) {
        e.esperando = undefined
        return { texto: '¿Qué quieres cambiar: el día, la hora, las personas o el nombre?' }
      }
      e.esperando = undefined
      return null
    }
    return null
  }

  /* --------------------------------------------------------- cancelación */

  private empezarCancelacion(rehacer: boolean) {
    const e = this.e
    e.modo = 'cancelar'
    e.rehacer = rehacer
    e.esperando = 'codigo'
    e.intentosCodigo = 0
    return {
      texto: rehacer
        ? 'Claro. Para cambiarla, anulo la que tienes y te hago una nueva al momento. ¿Me pasas el código de la reserva? Si no lo tienes, dime el nombre.'
        : 'Claro. ¿Me pasas el código de la reserva? Si no lo tienes, dime el nombre con el que la hiciste.',
    }
  }

  private async cancelacion(a: Analisis, texto: string): Promise<{ texto: string; colgar?: boolean }> {
    const e = this.e
    const ahora = this.ahora()
    if (e.esperando === 'confirmar_cancelar' && e.candidata) {
      if (a.afirma === true) {
        const r = await this.conector.cancelar(e.candidata.codigo, e.candidata.telefono)
        const vieja = e.candidata
        if (!r.ok) {
          this.e = nuevo()
          return { texto: `No he podido cancelarla: ${r.error} ¿Te ayudo con algo más?` }
        }
        this.eventos.push({ tipo: 'cancelacion', reserva: r.reserva })
        const rehacer = e.rehacer
        this.e = nuevo()
        if (rehacer) {
          this.e.modo = 'reserva'
          this.e.datos.nombre = vieja.nombre
          this.e.datos.personas = vieja.personas
          this.e.esperando = 'fecha'
          return { texto: 'Anulada. Vamos con la nueva: ¿para qué día la quieres?' }
        }
        this.e.esperando = 'algo_mas'
        return { texto: 'Listo, reserva cancelada. ¡Gracias por avisar! Así podemos dar la mesa a otra persona. ¿Algo más?' }
      }
      if (a.afirma === false) {
        this.e = nuevo()
        this.e.esperando = 'algo_mas'
        return { texto: 'Perfecto, la mantengo tal cual 👍 ¿Te ayudo con algo más?' }
      }
      return { texto: `¿Cancelo la reserva de ${e.candidata.nombre}, sí o no?` }
    }

    let encontradas: Reserva[] = []
    let porCodigo = false
    if (a.codigo) {
      porCodigo = true
      encontradas = await this.conector.buscar({ codigo: a.codigo })
    }
    if (!encontradas.length) {
      const nombre = a.nombre ?? nombreSuelto(texto)
      if (nombre) encontradas = await this.conector.buscar({ nombre })
    }
    if (!encontradas.length) {
      e.intentosCodigo++
      if (e.intentosCodigo >= 3) return this.transferir('No se encontró la reserva que el cliente quería cancelar.')
      return { texto: porCodigo ? 'No encuentro ninguna reserva con ese código. ¿Lo revisas, o me dices el nombre?' : 'No encuentro ninguna reserva a ese nombre. ¿Me pasas el código, o el nombre completo?' }
    }
    const r = encontradas[0]!
    e.candidata = r
    e.esperando = 'confirmar_cancelar'
    const mas = encontradas.length > 1 ? ` Hay ${encontradas.length} reservas a ese nombre; te digo la más próxima.` : ''
    return { texto: `${mas} Tengo una reserva a nombre de *${r.nombre}* para ${personasHabladas(r.personas)}, ${fechaHablada(r.fecha, ahora)} ${aLaHora(r.hora)}. ¿La ${e.rehacer ? 'cambio' : 'cancelo'}?`.trim() }
  }
}

function nombreSuelto(texto: string): string | undefined {
  const limpio = normalizar(texto).replace(/^(pues|vale|si|esta|la reserva|esta a nombre de|a nombre de|es de|de|el nombre es|me llamo|soy)\s+/g, '').trim()
  const ps = limpio.split(' ').filter(Boolean)
  if (!ps.length || ps.length > 3 || ps.some((p) => /\d/.test(p))) return undefined
  return ps.join(' ')
}

function frasesCierre(motivo: MotivoNo, cuando: string, n: Negocio): string {
  switch (motivo) {
    case 'cerrado':
      return `${capital(cuando)} cerramos por descanso.`
    case 'vacaciones':
      return `${capital(cuando)} estamos cerrados por vacaciones.`
    case 'lejos':
      return `Solo puedo reservar con ${n.diasMax} días de antelación como mucho.`
    default:
      return 'Esa fecha ya ha pasado.'
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

