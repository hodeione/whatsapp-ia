import { ALERGENOS, type Negocio, type Plato } from '../negocio.js'
import { normalizar } from '../es/numeros.js'
import { DIAS, lista } from '../es/hablar.js'

/** Respuestas informativas a partir de los datos del negocio (en formato chat): nunca se inventa nada. */

export function diasAbiertos(n: Negocio): string {
  const abiertos = [1, 2, 3, 4, 5, 6, 7].filter((d) => !n.cerrado.includes(d))
  if (abiertos.length === 7) return 'todos los días'
  // Días seguidos, con la semana circular: «de martes a domingo», «de jueves a lunes»
  const sig = (d: number) => (d % 7) + 1
  const ant = (d: number) => ((d + 5) % 7) + 1
  const inicio = abiertos.find((d) => !abiertos.includes(ant(d)))
  if (inicio !== undefined) {
    let fin = inicio
    let largo = 1
    while (abiertos.includes(sig(fin)) && sig(fin) !== inicio) {
      fin = sig(fin)
      largo++
    }
    if (largo === abiertos.length && largo > 2) return `de ${DIAS[inicio - 1]} a ${DIAS[fin - 1]}`
  }
  return `los ${lista(abiertos.map((d) => DIAS[d - 1]!))}`
}

export function horarioHablado(n: Negocio): string {
  const lineas = [`🕒 Abrimos ${diasAbiertos(n)}.`]
  if (n.horas.comida.length) lineas.push(`🍽️ Comidas: ${rangoTurno(n.horas.comida)}`)
  if (n.horas.cena.length) lineas.push(`🌙 Cenas: ${rangoTurno(n.horas.cena)}`)
  const cerrados = n.cerrado.map((x) => `los ${DIAS[x - 1]}${DIAS[x - 1]!.endsWith('s') ? '' : 's'}`)
  if (cerrados.length) lineas.push(`${capital(lista(cerrados))} cerramos por descanso.`)
  return lineas.join('\n')
}

/** «de 13:00 a 15:00» (horas de llegada). */
export const rangoTurno = (horas: string[]) => (horas.length ? `de ${horas[0]} a ${horas.at(-1)}` : '')

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Platos que se mencionan en la frase (por sus palabras significativas). */
export function platosMencionados(n: Negocio, texto: string): Plato[] {
  const t = normalizar(texto)
  return n.carta.filter((p) =>
    normalizar(p.nombre)
      .split(' ')
      .filter((w) => w.length > 4 && !['salvaje', 'jugosa', 'crema', 'fundente', 'botella'].includes(w))
      .some((w) => t.includes(w)),
  )
}

const precio = (p: number) => (Number.isInteger(p) ? `${p} €` : `${String(p).replace('.', ',')} €`)
const minus = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function sobrePlatos(platos: Plato[]): string {
  return platos
    .slice(0, 2)
    .map((p) => {
      const al = p.alergenos.length ? `lleva ${lista(p.alergenos.map((a) => ALERGENOS[a] ?? a))}` : 'no lleva ningún alérgeno de declaración obligatoria'
      return `*${p.nombre}*: ${precio(p.precio)}. ${capital(al)}.`
    })
    .join('\n')
}

export function resumenCarta(n: Negocio): string {
  const por = new Map<string, Plato[]>()
  for (const p of n.carta) por.set(p.categoria, [...(por.get(p.categoria) ?? []), p])
  const marcas = (p: Plato) => `${p.etiquetas.includes('sin gluten') ? ' 🌾' : ''}${p.etiquetas.includes('vegetariano') || p.etiquetas.includes('vegano') ? ' 🌱' : ''}`
  const bloques = [...por.entries()].map(([cat, platos]) => [`*${cat}*`, ...platos.map((p) => `• ${p.nombre} · ${precio(p.precio)}${marcas(p)}`)].join('\n'))
  return ['📄 *Nuestra carta*', ...bloques, '🌾 sin gluten · 🌱 vegetariano'].join('\n\n')
}

export function sobreDieta(n: Negocio, dieta: string): string {
  if (dieta === 'sin gluten' || dieta === 'vegetariano' || dieta === 'vegano') {
    const aptos = n.carta.filter((p) => p.etiquetas.includes(dieta) && p.categoria !== 'Bebidas')
    if (!aptos.length) return `En la carta no tenemos platos marcados como ${dieta === 'vegano' ? 'veganos' : dieta}. Si reservas, lo anoto para que cocina lo tenga en cuenta.`
    const ejemplos = lista(aptos.slice(0, 3).map((p) => minus(p.nombre)))
    const apto = dieta === 'sin gluten' ? 'sin gluten' : `apt${aptos.length >= 6 ? 'a' : 'os'} para ${dieta === 'vegetariano' ? 'vegetarianos' : 'veganos'}`
    const frase = aptos.length >= 6 ? `buena parte de la carta es ${apto}` : `tenemos ${aptos.length} platos ${apto}`
    return `¡Sí! ${capital(frase)}: por ejemplo, ${ejemplos}. Si reservas, lo dejo anotado para cocina.`
  }
  const nombre = ALERGENOS[dieta] ?? dieta
  const sin = n.carta.filter((p) => !p.alergenos.includes(dieta) && p.categoria !== 'Bebidas')
  return `Tenemos ${sin.length} platos sin ${nombre}, como ${lista(sin.slice(0, 3).map((p) => minus(p.nombre)))}. Todos tienen la información de alérgenos, y si reservas lo anoto para que cocina tenga cuidado.`
}
