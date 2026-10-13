import { waitUntil } from '@vercel/functions'
import { POST as turnoClaude } from './chat.js'
import { firmar } from './_lib/firma.js'
import { aMeta, enviar, firmaValida, leerEntrantes } from './_lib/meta.js'
import { procesar } from './_lib/procesar.js'
import { kv } from './_lib/servidor.js'

/**
 * Webhook de la API oficial de WhatsApp Cloud (Meta).
 *
 * GET  /api/whatsapp → verificación del webhook (hub.challenge)
 * POST /api/whatsapp → mensajes entrantes. Se contesta 200 al momento y se
 *                      procesa en segundo plano (Meta reintenta si tardamos).
 *
 * Variables: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID. Opcionales: UPSTASH_REDIS_REST_URL/TOKEN,
 * ANTHROPIC_API_KEY, RESERVAS_N8N_URL/CLAVE.
 */

/** Ids de mensajes ya atendidos: Meta puede repetir un webhook. */
const vistos = new Set<string>()

export function GET(request: Request): Response {
  const q = new URL(request.url).searchParams
  if (q.get('hub.mode') === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && q.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN) return new Response(q.get('hub.challenge') ?? '', { status: 200 })
  return new Response('No autorizado', { status: 403 })
}

export async function POST(request: Request): Promise<Response> {
  const cuerpo = await request.text()
  if (!firmaValida(process.env.WHATSAPP_APP_SECRET ?? '', cuerpo, request.headers.get('x-hub-signature-256'))) return new Response('Firma no válida', { status: 401 })
  let datos: unknown
  try {
    datos = JSON.parse(cuerpo)
  } catch {
    return new Response('JSON no válido', { status: 400 })
  }
  const base = `https://${request.headers.get('x-forwarded-host') ?? new URL(request.url).host}`
  const entrantes = leerEntrantes(datos as Parameters<typeof leerEntrantes>[0]).filter((m) => !vistos.has(m.id))
  for (const m of entrantes) vistos.add(m.id)
  if (vistos.size > 5000) vistos.clear()
  if (entrantes.length) waitUntil(atender(entrantes, base))
  return new Response('ok')
}

async function atender(entrantes: ReturnType<typeof leerEntrantes>, base: string) {
  const almacen = kv()
  // Claude, a través de la misma función que usa la web (mismas instrucciones y límites).
  const fetchIA = ((_u: unknown, init?: RequestInit) =>
    turnoClaude(new Request(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: init?.body as string }))) as typeof fetch
  for (const m of entrantes) {
    try {
      const { respuestas, otros, entorno } = await procesar(almacen, m.telefono, m.valor, fetchIA)
      const opciones = { negocio: entorno.negocio, base, enlaceCalendario: (codigo: string) => enlaceCalendario(base, entorno.estado.reservas.find((r) => r.codigo === codigo)) }
      for (const r of respuestas) for (const cuerpo of aMeta(r, opciones)) await enviar(m.telefono, cuerpo)
      for (const o of otros) for (const cuerpo of aMeta({ ...o.mensaje, id: '', de: 'negocio', hora: '' }, opciones)) await enviar(o.telefono, cuerpo)
    } catch (err) {
      console.error('Error atendiendo un mensaje de WhatsApp', err)
      await enviar(m.telefono, { type: 'text', text: { body: 'Perdona, ahora mismo no puedo responder. Inténtalo en unos minutos 🙏' } }).catch(() => {})
    }
  }
}

/** Enlace firmado al .ics de una reserva (sin guardar nada: los datos van en el enlace). */
export function enlaceCalendario(base: string, r?: { codigo: string; fecha: string; hora: string; personas: number }): string {
  if (!r) return base
  const d = Buffer.from(JSON.stringify({ c: r.codigo, f: r.fecha, h: r.hora, p: r.personas })).toString('base64url')
  return `${base}/api/calendario?d=${d}&f=${firmar(d)}`
}
