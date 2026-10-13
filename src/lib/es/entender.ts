import { DateTime } from 'luxon'
import type { Faq, Negocio, Turno } from '../negocio.js'
import { leerNumero, normalizar } from './numeros.js'

/**
 * Comprensión del lenguaje para el motor sin IA: saca de una frase hablada
 * la fecha, la hora, los comensales, el nombre, si dice que sí o que no y
 * qué quiere. Son reglas, no un modelo: rápidas, gratis y comprobables con
 * pruebas, pensadas para lo que se dice al llamar a un restaurante.
 */

export type Intencion =
  | 'reservar'
  | 'cancelar'
  | 'modificar'
  | 'horario'
  | 'direccion'
  | 'carta'
  | 'dieta'
  | 'persona'
  | 'despedida'
  | 'gracias'
  | 'saludo'
  | 'faq'
  | 'disponibilidad'

/** Qué dato acaba de pedir la recepcionista: cambia cómo se leen las respuestas cortas. */
export type Esperando = 'fecha' | 'hora' | 'personas' | 'nombre' | 'notas' | 'confirmar' | 'alternativa' | 'codigo' | 'confirmar_cancelar' | 'algo_mas'

export interface Analisis {
  texto: string
  intenciones: Set<Intencion>
  fecha?: string
  /** Pidió algo como «el fin de semana»: hay que concretar. */
  fechaVaga?: string
  hora?: string
  turno?: Turno
  personas?: number
  nombre?: string
  afirma?: boolean
  /** «La primera», «la segunda»… (desde 0; -1 = la última). */
  ordinal?: number
  codigo?: string
  /** Observaciones para la reserva: alergias, trona, cumpleaños… */
  notas: string[]
  faq?: Faq
  /** Qué dieta o alérgeno pregunta: 'sin gluten', 'vegano', 'lacteos'… */
  dieta?: string
  /** Frase con forma de pregunta («¿tenéis…?», «¿se puede…?»). */
  pregunta: boolean
}

export interface Contexto {
  hoy: DateTime
  esperando?: Esperando
  negocio: Negocio
  /** Turno ya conocido de la conversación: ayuda a leer «a las nueve». */
  turno?: Turno
}

const DIAS: Record<string, number> = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 }
const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

export function analizar(original: string, ctx: Contexto): Analisis {
  const t = normalizar(original)
  const a: Analisis = { texto: t, intenciones: new Set(), notas: [], pregunta: esPregunta(original, t) }
  const palabras = t.split(' ').filter(Boolean)

  leerFecha(t, palabras, ctx, a)
  leerTurno(t, a)
  leerHora(t, palabras, ctx, a)
  leerPersonas(t, palabras, ctx, a)
  leerNombre(original, a)
  leerAfirmacion(t, a)
  leerOrdinal(t, a)
  if (ctx.esperando === 'codigo' || /\bcodigo\b|\blocalizador\b/.test(t)) leerCodigo(t, a)
  leerIntenciones(t, ctx, a)
  leerNotas(t, a)
  // Respuesta suelta al pedir el nombre, solo si la frase no es otra cosa
  // («venimos con un bebé» no es un nombre).
  const otraCosa = a.notas.length || a.fecha || a.hora || a.personas || [...a.intenciones].some((i) => i !== 'saludo' && i !== 'gracias')
  if (!a.nombre && ctx.esperando === 'nombre' && !otraCosa) leerNombreSuelto(original, t, a)
  return a
}

/* ------------------------------------------------------------------ fecha */

function leerFecha(t: string, palabras: string[], ctx: Contexto, a: Analisis) {
  const hoy = ctx.hoy.startOf('day')

  // «el viernes 17», «el 17 de octubre», «el día 3», «17/10»
  const barra = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (barra) {
    const f = construir(hoy, Number(barra[1]), Number(barra[2]))
    if (f) return void (a.fecha = f)
  }
  for (let i = 0; i < palabras.length; i++) {
    const w = palabras[i]!
    const antes = palabras[i - 1]
    const tras = palabras[i + 1]
    const esPrevio = w === 'dia' || w === 'el' || w in DIAS
    if (!esPrevio) continue
    const n = leerNumero(palabras, i + 1)
    if (!n || n.valor < 1 || n.valor > 31) continue
    const siguiente = palabras[i + 1 + n.largo]
    // «el 2 de la tarde» o «para el 4 personas» no son fechas.
    if (siguiente === 'personas' || siguiente === 'comensales' || (siguiente === 'de' && /^la|el$/.test(palabras[i + 2 + n.largo] ?? ''))) continue
    if (w === 'el' && (antes === 'a' || tras === 'las')) continue
    let mes: number | undefined
    if (siguiente === 'de' && (palabras[i + 2 + n.largo] ?? '') in MESES) mes = MESES[palabras[i + 2 + n.largo]!]
    const f = mes ? construir(hoy, n.valor, mes) : diaDelMes(hoy, n.valor)
    if (f) return void (a.fecha = f)
  }
  // «17 de octubre» sin artículo
  const conMes = t.match(/\b(\d{1,2}|[a-z]+(?: y [a-z]+)?) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/)
  if (conMes) {
    const n = leerNumero(conMes[1]!.split(' '), 0)
    if (n) {
      const f = construir(hoy, n.valor, MESES[conMes[2]!]!)
      if (f) return void (a.fecha = f)
    }
  }

  if (/\bpasado manana\b/.test(t)) return void (a.fecha = hoy.plus({ days: 2 }).toISODate()!)
  if (/(?<!por la |de la |esta |pasado )\bmanana\b/.test(t)) return void (a.fecha = hoy.plus({ days: 1 }).toISODate()!)
  if (/\bhoy\b|\besta noche\b|\besta tarde\b|\beste mediodia\b|\bahora mismo\b/.test(t)) return void (a.fecha = hoy.toISODate()!)

  const dentro = t.match(/\b(?:dentro de|en) (\S+(?: y \S+)?) dias\b/)
  if (dentro) {
    const n = leerNumero(dentro[1]!.split(' '), 0)
    if (n && n.valor > 0 && n.valor < 100) return void (a.fecha = hoy.plus({ days: n.valor }).toISODate()!)
  }

  const dia = t.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/)
  if (dia) {
    const objetivo = DIAS[dia[1]!]!
    const proximaSemana = /semana que viene|proxima semana|siguiente semana/.test(t)
    if (proximaSemana) {
      const lunes = hoy.plus({ weeks: 1 }).startOf('week')
      return void (a.fecha = lunes.plus({ days: objetivo - 1 }).toISODate()!)
    }
    let dif = (objetivo - hoy.weekday + 7) % 7
    // «este viernes» dicho un viernes es hoy; «el viernes» es el de la semana que viene.
    if (dif === 0 && !/\b(este|esta) (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(t)) dif = 7
    return void (a.fecha = hoy.plus({ days: dif }).toISODate()!)
  }

  if (/fin de semana|finde\b/.test(t)) a.fechaVaga = 'el fin de semana'
  else if (/semana que viene|proxima semana/.test(t)) a.fechaVaga = 'la semana que viene'
}

function construir(hoy: DateTime, dia: number, mes: number): string | null {
  let d = DateTime.fromObject({ year: hoy.year, month: mes, day: dia }, { zone: hoy.zone })
  if (!d.isValid) return null
  if (d < hoy) d = d.plus({ years: 1 })
  return d.toISODate()
}

function diaDelMes(hoy: DateTime, dia: number): string | null {
  let d = DateTime.fromObject({ year: hoy.year, month: hoy.month, day: dia }, { zone: hoy.zone })
  if (!d.isValid || d < hoy) {
    const sig = hoy.plus({ months: 1 })
    d = DateTime.fromObject({ year: sig.year, month: sig.month, day: dia }, { zone: hoy.zone })
  }
  return d.isValid ? d.toISODate() : null
}

/* ------------------------------------------------------------ hora y turno */

function leerTurno(t: string, a: Analisis) {
  if (/\b(cenar|cena|esta noche|por la noche|de noche)\b/.test(t)) a.turno = 'cena'
  else if (/\b(comer|comida|almorzar|almuerzo|mediodia)\b/.test(t)) a.turno = 'comida'
}

function leerHora(t: string, palabras: string[], ctx: Contexto, a: Analisis) {
  const digital = t.match(/\b([01]?\d|2[0-3])(?::|\.|h)([0-5]\d)\b/)
  if (digital) {
    a.hora = ajustar(Number(digital[1]), Number(digital[2]), t, a.turno ?? ctx.turno)
    a.turno ??= turnoDeHora(a.hora)
    return
  }
  const conH = t.match(/\b([01]?\d|2[0-3]) ?(?:h|horas)\b/)
  if (conH && !/\bdentro de\b/.test(t)) {
    a.hora = ajustar(Number(conH[1]), 0, t, a.turno ?? ctx.turno)
    a.turno ??= turnoDeHora(a.hora)
    return
  }

  for (let i = 0; i < palabras.length; i++) {
    const w = palabras[i]!
    const tras = palabras[i + 1]
    const marcador = (w === 'las' || w === 'la') && (palabras[i - 1] === 'a' || palabras[i - 1] === 'sobre' || palabras[i - 1] === 'hacia' || palabras[i - 1] === 'para' || palabras[i - 1] === 'de' || palabras[i - 1] === 'y' || palabras[i - 1] === 'o' || i === 0)
    const desnudo = ctx.esperando === 'hora' || ctx.esperando === 'alternativa'
    let inicio = -1
    if (marcador && tras !== undefined) inicio = i + 1
    else if (desnudo && i === 0) inicio = 0
    else if (desnudo && (w === 'a' || w === 'sobre' || w === 'hacia') && palabras[i + 1] !== 'las' && palabras[i + 1] !== 'la') inicio = i + 1
    if (inicio < 0) continue
    const n = leerNumero(palabras, inicio)
    if (!n || n.valor < 1 || n.valor > 24) continue
    // Un número suelto solo es una hora si va solo o seguido de «y media», «de la noche»…
    // («uno es celíaco» no es «a la una»).
    if (!marcador && !/^(y|menos|de|en|o|horas?|h|vale|por|mejor)?$/.test(palabras[inicio + n.largo] ?? '')) continue
    let h = n.valor
    let m = 0
    const j = inicio + n.largo
    const s1 = palabras[j]
    const s2 = palabras[j + 1]
    if (s1 === 'y' && s2 === 'media') m = 30
    else if (s1 === 'y' && s2 === 'cuarto') m = 15
    else if (s1 === 'menos' && s2 === 'cuarto') {
      h -= 1
      m = 45
    } else if (s1 === 'y') {
      const min = leerNumero(palabras, j + 1)
      if (min && min.valor > 0 && min.valor < 60 && palabras[j + 1 + min.largo] !== 'personas') m = min.valor
    }
    // «somos 4 y …» no es una hora: el número va seguido de «personas»
    if (palabras[inicio + n.largo] === 'personas') continue
    a.hora = ajustar(h, m, t, a.turno ?? ctx.turno)
    a.turno ??= turnoDeHora(a.hora)
    return
  }
}

/** Pasa una hora dicha en formato de 12 h al reloj de 24 h del restaurante. */
function ajustar(h: number, m: number, t: string, turno: Turno | undefined): string {
  let hh = h
  if (h <= 12) {
    if (/de la (tarde|noche)/.test(t) && h < 12) hh = h + 12
    else if (/de la manana/.test(t)) hh = h
    else if (/del mediodia/.test(t)) hh = h === 12 ? 12 : h + 12
    else if (turno === 'comida') hh = h <= 5 ? h + 12 : h
    else if (turno === 'cena') hh = h < 12 ? h + 12 : h
    else if (h >= 1 && h <= 11) hh = h + 12
  }
  if (hh === 24) hh = 0
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function turnoDeHora(hora: string): Turno {
  return Number(hora.slice(0, 2)) < 18 ? 'comida' : 'cena'
}

/* --------------------------------------------------------------- personas */

const ACOMPANANTES = 'mujer|marido|pareja|novia|novio|esposa|esposo|madre|padre|madre|hermano|hermana|hijo|hija|amigo|amiga|socio|socia|jefe|jefa|chica|chico|suegra|suegro|abuela|abuelo|companero|companera'

function leerPersonas(t: string, palabras: string[], ctx: Contexto, a: Analisis) {
  let total: number | undefined
  for (let i = 0; i < palabras.length; i++) {
    const w = palabras[i]!
    const n = leerNumero(palabras, i)
    if (!n) continue
    const siguiente = palabras[i + n.largo] ?? ''
    const anterior = palabras[i - 1] ?? ''
    const anterior2 = palabras[i - 2] ?? ''
    const unidades = /^(personas?|comensales?|adultos?|pax|mayores|cubiertos)$/.test(siguiente)
    const verbo = /^(somos|seremos|vamos|iremos|venimos|vendremos|estaremos)$/.test(anterior)
    const para = anterior === 'para' && !/^(las?|el|dia)$/.test(w) && anterior2 !== 'a'
    const mesaPara = anterior === 'para' && /^(mesa|reserva|reservar|sitio|hueco)$/.test(anterior2)
    if (unidades || verbo || para || mesaPara) {
      if (n.valor >= 1 && n.valor <= 99 && !/^(de|:)/.test(siguiente) && !(siguiente === 'y' && /^(media|cuarto)$/.test(palabras[i + n.largo + 1] ?? ''))) {
        total = n.valor
        // «cuatro adultos y dos niños»
        const resto = palabras.slice(i + n.largo).join(' ')
        const extra = resto.match(/\by (\S+(?: y \S+)?) (ninos|ninas|crios|bebes|peques|chavales|menores)\b/)
        if (extra) {
          const e = leerNumero(extra[1]!.split(' '), 0)
          if (e) total += e.valor
        }
        break
      }
    }
  }
  if (total === undefined) {
    if (new RegExp(`\\bmi (${ACOMPANANTES}) y yo\\b|\\byo y mi (${ACOMPANANTES})\\b|\\bnosotros dos\\b|\\bsomos dos\\b|\\buna pareja\\b`).test(t)) total = 2
    else if (/\b(solo yo|yo solo|yo sola|para mi solo|para mi sola|una sola persona)\b/.test(t)) total = 1
  }
  if (total === undefined && ctx.esperando === 'personas') {
    for (let i = 0; i < palabras.length; i++) {
      const n = leerNumero(palabras, i)
      if (n && n.valor >= 1 && n.valor <= 99) {
        total = n.valor
        break
      }
    }
  }
  if (total !== undefined) a.personas = total
}

/* ----------------------------------------------------------------- nombre */

const PARADAS = new Set(['y', 'para', 'que', 'quiero', 'queria', 'quisiera', 'de', 'a', 'el', 'la', 'por', 'con', 'en', 'llamo', 'te', 'le', 'os', 'reservar', 'una', 'un', 'mesa', 'hoy', 'manana', 'gracias', 'vale', 'somos'])
const NO_NOMBRES = new Set(['yo', 'si', 'no', 'vale', 'pues', 'hola', 'buenas', 'eso', 'nada', 'bien', 'claro', 'perfecto', 'gracias', 'el', 'ella', 'nosotros', 'cliente', 'socio', 'venimos', 'vamos', 'somos', 'necesitamos', 'tenemos', 'queremos', 'quiero', 'queria', 'necesito', 'tengo', 'espera', 'perdona', 'perdone', 'oye', 'mire', 'mira'])

function leerNombre(original: string, a: Analisis) {
  const crudo = original.replace(/[¿?¡!,.;:"«»()]/g, ' ').replace(/\s+/g, ' ').trim()
  const palabrasCrudas = crudo.split(' ')
  const norm = palabrasCrudas.map((p) => normalizar(p))
  const tomar = (desde: number, max: number) => {
    const out: string[] = []
    for (let i = desde; i < palabrasCrudas.length && out.length < max; i++) {
      const n = norm[i]!
      if (!n || PARADAS.has(n) || /\d/.test(n)) break
      out.push(palabrasCrudas[i]!)
    }
    return out
  }
  const marcadores: [string[], number][] = [
    [['me', 'llamo'], 2],
    [['mi', 'nombre', 'es'], 3],
    [['nombre', 'de'], 2],
    [['soy'], 1],
    [['habla'], 1],
    [['de', 'parte', 'de'], 3],
  ]
  for (let i = 0; i < norm.length; i++) {
    for (const [m, largo] of marcadores) {
      if (m.every((x, k) => norm[i + k] === x)) {
        const nombre = tomar(i + largo, 3)
        if (nombre.length && !NO_NOMBRES.has(normalizar(nombre[0]!)) && !/^(celiac|alergic|vegan|vegetarian|intolerante|de)/.test(normalizar(nombre[0]!))) {
          a.nombre = capitalizar(nombre.join(' '))
          return
        }
      }
    }
  }
}

function leerNombreSuelto(original: string, t: string, a: Analisis) {
  const crudo = original.replace(/[¿?¡!,.;:"«»()]/g, ' ').replace(/\s+/g, ' ').trim()
  {
    const limpio = crudo.replace(/^(pues|vale|sí|si|eh|em|bueno|claro|ok)\s+/i, '').replace(/^(ponlo|ponla|póngalo|póngala|pon|ponga)\s+(a\s+nombre\s+de\s+)?/i, '').replace(/^(a nombre de|es)\s+/i, '')
    const ps = limpio.split(' ').filter(Boolean)
    const nombre: string[] = []
    for (const p of ps) {
      const n = normalizar(p)
      if (!n || PARADAS.has(n) || /\d/.test(n) || nombre.length >= 3) break
      nombre.push(p)
    }
    if (nombre.length && nombre.length <= 3 && !NO_NOMBRES.has(normalizar(nombre[0]!)) && t.split(' ').length <= 6) a.nombre = capitalizar(nombre.join(' '))
  }
}

function capitalizar(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((p) => (p.length > 2 || p === p.toUpperCase() ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(' ')
}

/* ------------------------------------------------------- sí / no / ordinal */

function leerAfirmacion(t: string, a: Analisis) {
  if (/^(no|nop|negativo|mejor no|para nada|incorrecto|que va|nada)\b/.test(t) || /\bno es correcto\b|\bno esta bien\b/.test(t)) a.afirma = false
  else if (
    /^(si|sip|vale|ok|okay|perfecto|correcto|exacto|eso es|de acuerdo|claro|genial|estupendo|adelante|confirmo|confirmalo|confirma|venga|muy bien|bien|esa|ese|valdria|me vale|me viene bien|me parece bien|por supuesto|efectivamente|dale|sale)\b/.test(t) ||
    /\b(si por favor|si gracias|esta bien|me vale|me viene bien|perfecto|de acuerdo|me parece bien)\b/.test(t)
  )
    a.afirma = true
}

function leerOrdinal(t: string, a: Analisis) {
  if (/\b(la |el )?primer[ao]?\b/.test(t)) a.ordinal = 0
  else if (/\b(la |el )?segund[ao]\b/.test(t)) a.ordinal = 1
  else if (/\b(la |el )?tercer[ao]?\b/.test(t)) a.ordinal = 2
  else if (/\b(la |el )?ultim[ao]\b/.test(t)) a.ordinal = -1
}

/* ----------------------------------------------------------------- código */

const LETRAS: Record<string, string> = {
  a: 'A', be: 'B', ce: 'C', de: 'D', e: 'E', efe: 'F', ge: 'G', hache: 'H', i: 'I', jota: 'J', ka: 'K', ele: 'L', eme: 'M', ene: 'N',
  o: 'O', pe: 'P', cu: 'Q', erre: 'R', ere: 'R', ese: 'S', te: 'T', u: 'U', uve: 'V', equis: 'X', ye: 'Y', zeta: 'Z', zeda: 'Z',
}

function leerCodigo(t: string, a: Analisis) {
  const tokens = t.replace(/\b(el|mi|codigo|localizador|es|de|la|reserva|pues|vale)\b/g, ' ').split(' ').filter(Boolean)
  // Un bloque ya junto: «rx7k2»
  const junto = tokens.find((w) => /^[a-z0-9]{4,8}$/.test(w) && /\d/.test(w) && /[a-z]/.test(w))
  if (junto) return void (a.codigo = junto.toUpperCase())
  let out = ''
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i]!
    if (w === 'uve' && tokens[i + 1] === 'doble') {
      out += 'W'
      i++
    } else if (w === 'i' && tokens[i + 1] === 'griega') {
      out += 'Y'
      i++
    } else if (/^[a-z0-9]$/.test(w)) out += w.toUpperCase()
    else if (w in LETRAS) out += LETRAS[w]
    else {
      const n = leerNumero(tokens, i)
      if (n && n.valor < 10) out += String(n.valor)
      else if (/^\d+$/.test(w)) out += w
    }
  }
  if (out.length >= 4 && out.length <= 8) a.codigo = out
}

/* ------------------------------------------------------------- intención */

function leerIntenciones(t: string, ctx: Contexto, a: Analisis) {
  const i = a.intenciones
  if (/cancel|anular|anula\b|no (vamos a|podemos|podremos|voy a|vamos) (poder )?ir|no podre ir|borr(ar|e) (la|mi) reserva|quitar (la|mi) reserva/.test(t)) i.add('cancelar')
  if (/\b(cambiar|modificar|mover|retrasar|adelantar|cambio)\b/.test(t) && /reserva|hora|dia|mesa/.test(t)) i.add('modificar')
  if (!i.has('cancelar') && !i.has('modificar') && /reserv|\bmesa\b|hueco|sitio para|quer(ia|emos|ria)? (ir|cenar|comer)|quiero (ir|cenar|comer)|quisiera (ir|cenar|comer)|podemos ir|para cenar|para comer|ir a cenar|ir a comer/.test(t)) i.add('reservar')
  if (/\b(teneis|tienen|tienes|hay) (sitio|hueco|mesa|disponibilidad)|\bqueda (sitio|mesa|hueco)|disponibilidad|esta (lleno|completo)/.test(t)) i.add('disponibilidad')
  if (/horario|a que hora (abr|cerr)|\b(abris|abren|abres|cerrais|cierran|cierras)\b|cuando (abr|cerr)|que dias (abr|teneis|esta)|esta(is)? abierto|abierto (hoy|manana|el)|estais cerrado/.test(t)) i.add('horario')
  if (/direccion|donde (estais|esta|estan|queda|os encuentro)|como (llego|se llega|llegar)|ubicacion|en que calle/.test(t)) i.add('direccion')
  if (/\b(hablar|pasar|pasame|pasarme|paseme|ponme|pongame) con\b|\b(una persona|persona real|encargad|humano|camarero|responsable|el dueno|la duena|operador|alguien del restaurante)/.test(t)) i.add('persona')
  if (/\b(adios|hasta luego|hasta pronto|hasta el|nada mas|eso es todo|eso era todo|chao|agur|nos vemos|ya esta todo)\b/.test(t)) i.add('despedida')
  if (/\bgracias\b/.test(t)) i.add('gracias')
  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|que tal)\b/.test(t)) i.add('saludo')

  const faq = ctx.negocio.faq.find((f) => f.claves.some((c) => t.includes(c)))
  if (faq) {
    i.add('faq')
    a.faq = faq
  }
  if (!faq && /\b(carta|menu|platos|especialidad|recomienda|recomiendas|que (teneis|tienen|hay) (de|para) (comer|cenar|picar|postre)|postres|vinos?)\b/.test(t)) i.add('carta')

  const dietas: [RegExp, string][] = [
    [/celiac|gluten/, 'sin gluten'],
    [/vegan/, 'vegano'],
    [/vegetarian/, 'vegetariano'],
    [/lactosa|lacteo|leche/, 'lacteos'],
    [/frutos secos|nueces|frutos de cascara|almendra/, 'frutos_cascara'],
    [/marisco|crustaceo|gamba/, 'crustaceos'],
    [/molusco/, 'moluscos'],
    [/\bhuevo/, 'huevo'],
    [/pescado/, 'pescado'],
    [/mostaza/, 'mostaza'],
    [/sulfito/, 'sulfitos'],
  ]
  for (const [re, d] of dietas) {
    if (re.test(t) && (/alergi|alergic|intoleran|celiac|vegan|vegetarian|sin /.test(t) || a.pregunta)) {
      i.add('dieta')
      a.dieta = d
      break
    }
  }
}

/* ------------------------------------------------------------------ notas */

function leerNotas(t: string, a: Analisis) {
  const n = a.notas
  const afirmacion = /\b(soy|es|somos|son|esta|estan|hay un|hay una|hay dos|viene|vienen|tengo|tiene|tenemos|uno de nosotros|una de nosotras|mi \w+ es)\b/
  if (/celiac/.test(t) && afirmacion.test(t)) n.push('Celiaquía')
  const alergia = t.match(/alergi(?:a|co|ca|cos|cas) (?:a(?:l)? |a la |a los |a las )?([a-z ]+?)(?: y |$| para| pero| por)/)
  if (alergia && !a.pregunta) n.push(`Alergia: ${alergia[1]!.trim()}`)
  if (/intolerante a la lactosa|intolerancia a la lactosa/.test(t) && !a.pregunta) n.push('Intolerancia a la lactosa')
  if (/\b(vegano|vegana|veganos|veganas)\b/.test(t) && afirmacion.test(t)) n.push('Vegano')
  if (/\b(trona|bebe|carrito)\b/.test(t) && !a.pregunta) n.push(/carrito/.test(t) ? 'Viene con carrito' : 'Necesita trona')
  if (/cumpleanos|aniversario|celebra/.test(t)) n.push(/aniversario/.test(t) ? 'Aniversario' : 'Celebración / cumpleaños')
  if (/silla de ruedas/.test(t) && !a.pregunta) n.push('Silla de ruedas')
  if (/(en la|en) terraza|fuera si (puede|es posible)/.test(t) && !a.pregunta) n.push('Prefiere terraza')
  if (/\b(perro|perrito|mascota)\b/.test(t) && !a.pregunta) n.push('Viene con perro (terraza)')
}

function esPregunta(original: string, t: string): boolean {
  return /\?/.test(original) || /^(teneis|tienen|tienes|hay|se puede|puedo|podeis|pueden|es posible|admitis|aceptais|sabeis|que|cual|como|donde|cuando|cuanto)\b/.test(t)
}
