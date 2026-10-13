import type { Mensaje } from '../../src/lib/chat.js'
import { resumenReserva } from './meta.js'

/**
 * Twilio (sandbox de WhatsApp): no admite botones sin plantillas aprobadas,
 * así que las opciones se numeran («1️⃣ 21:00») y el cliente responde con
 * el número. Se guarda qué valor corresponde a cada número.
 */

const NUMEROS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

export function aTexto(m: Mensaje, enlaceCalendario: (codigo: string) => string): { texto: string; opciones: string[] } {
  const partes: string[] = []
  if (m.tarjeta?.tipo === 'reserva') partes.push(resumenReserva(m.tarjeta.reserva))
  if (m.tarjeta?.tipo === 'ubicacion') partes.push(`📍 ${m.tarjeta.direccion}\n${m.tarjeta.url}`)
  if (m.texto) partes.push(m.texto)
  const opciones: string[] = []
  const lineas: string[] = []
  const elementos = m.lista ? m.lista.opciones : (m.botones ?? [])
  for (const b of elementos) {
    if (b.enlace) lineas.push(`${b.titulo}: ${b.enlace.startsWith('calendario:') ? enlaceCalendario(b.enlace.slice(11)) : b.enlace}`)
    else if (b.valor && opciones.length < 10) {
      lineas.push(`${NUMEROS[opciones.length]} ${b.titulo}`)
      opciones.push(b.valor)
    }
  }
  if (lineas.length) partes.push(lineas.join('\n') + (opciones.length ? '\n\n_Responde con el número._' : ''))
  return { texto: partes.join('\n\n'), opciones }
}

/** «2» → el valor de la opción 2 de la última respuesta, si la hay. */
export function interpretar(texto: string, opciones: string[]): string {
  const n = texto.trim().match(/^(\d{1,2})\W*$/)
  if (n) {
    const v = opciones[Number(n[1]) - 1]
    if (v) return v
  }
  return texto
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function twiml(textos: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${textos.map((t) => `<Message>${xml(t)}</Message>`).join('')}</Response>`
}
