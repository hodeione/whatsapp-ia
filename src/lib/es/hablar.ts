import { DateTime } from 'luxon'
import { numeroEnLetra } from './numeros.js'

/**
 * Textos pensados para el oído: los sintetizadores leen «21:30» como
 * «veintiuna treinta», así que la recepcionista dice «las nueve y media».
 */

export const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «21:30» → «las nueve y media»; «13:00» → «la una». */
export function horaHablada(hora: string): string {
  const [hh, mm] = hora.split(':').map(Number) as [number, number]
  let h = hh % 12
  if (h === 0) h = 12
  let min = mm
  let siguiente = false
  if (min > 30 && min % 15 === 0) {
    // «las diez menos cuarto»
    siguiente = true
    min = 60 - min
  }
  if (siguiente) h = (h % 12) + 1
  const base = h === 1 ? 'la una' : `las ${numeroEnLetra(h)}`
  if (min === 0) return base
  if (siguiente) return `${base} menos cuarto`
  if (min === 15) return `${base} y cuarto`
  if (min === 30) return `${base} y media`
  return `${base} y ${numeroEnLetra(min)}`
}

/** En chat, las horas en cifras y en negrita: «a las *21:30*». */
export const aLaHora = (hora: string) => `a las *${hora}*`

/** Hoy, mañana, «el viernes 17» o «el viernes 17 de octubre». */
export function fechaHablada(fecha: string, hoy: DateTime): string {
  const d = DateTime.fromISO(fecha, { zone: hoy.zone })
  const dias = Math.round(d.startOf('day').diff(hoy.startOf('day'), 'days').days)
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'mañana'
  if (dias === 2) return 'pasado mañana'
  const nombre = `el ${DIAS[d.weekday - 1]} ${d.day}`
  return dias > 0 && dias < 7 && d.month === hoy.month ? nombre : `${nombre} de ${MESES[d.month - 1]}`
}

/** Fecha corta para pantallas: «vie 17 oct». */
export function fechaCorta(fecha: string): string {
  const d = DateTime.fromISO(fecha)
  return `${DIAS[d.weekday - 1]!.slice(0, 3)} ${d.day} ${MESES[d.month - 1]!.slice(0, 3)}`
}

/** ['a','b','c'] → «a, b y c». */
export function lista(items: string[], y = 'y'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${y} ${items.at(-1)}`
}

/** «RX7K» → «R, X, siete, K»: los códigos se leen carácter a carácter. */
export function deletrear(codigo: string): string {
  return [...codigo.toUpperCase()].map((c) => (/\d/.test(c) ? numeroEnLetra(Number(c)) : c)).join(', ')
}

export const personasHabladas = (n: number) => (n === 1 ? '1 persona' : `${n} personas`)

/** Saludo según la hora del negocio. */
export function saludoHora(ahora: DateTime): string {
  if (ahora.hour >= 6 && ahora.hour < 14) return 'buenos días'
  if (ahora.hour >= 14 && ahora.hour < 21) return 'buenas tardes'
  return 'buenas noches'
}
