import { POST as turnoClaude } from './chat.js'
import { peticionDeTwilio } from './_lib/firma.js'
import { procesar } from './_lib/procesar.js'
import { kv } from './_lib/servidor.js'
import { aTexto, interpretar, twiml } from './_lib/twilio.js'
import { enlaceCalendario } from './whatsapp.js'

/**
 * POST /api/twilio → mensajes de WhatsApp a través de Twilio (sirve con el
 * sandbox, sin esperar la aprobación de Meta). Responde con TwiML.
 * Variables: TWILIO_AUTH_TOKEN (obligatoria).
 */
export async function POST(request: Request): Promise<Response> {
  const token = process.env.TWILIO_AUTH_TOKEN ?? ''
  if (!token) return new Response('Falta TWILIO_AUTH_TOKEN', { status: 503 })
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? url.host
  const params = Object.fromEntries(new URLSearchParams(await request.text())) as Record<string, string>
  if (!peticionDeTwilio(token, `https://${host}${url.pathname}${url.search}`, params, request.headers.get('x-twilio-signature'))) return new Response('Firma no válida', { status: 403 })

  const base = `https://${host}`
  const telefono = (params.From ?? '').replace(/^whatsapp:/, '')
  const almacen = kv()
  const opcionesPrevias = (await almacen.get<string[]>(`opc:${telefono}`)) ?? []
  const valor = params.NumMedia && params.NumMedia !== '0' && !params.Body ? '#no_texto' : interpretar(params.Body ?? '', opcionesPrevias)
  const fetchIA = ((_u: unknown, init?: RequestInit) => turnoClaude(new Request(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: init?.body as string }))) as typeof fetch

  const { respuestas, otros, entorno } = await procesar(almacen, telefono, valor, fetchIA)
  const enlace = (codigo: string) => enlaceCalendario(base, entorno.estado.reservas.find((r) => r.codigo === codigo))
  const textos: string[] = []
  let opciones: string[] = []
  for (const r of respuestas) {
    const t = aTexto(r, enlace)
    textos.push(t.texto)
    if (t.opciones.length) opciones = t.opciones
  }
  await almacen.set(`opc:${telefono}`, opciones, 86_400)
  // Avisos de lista de espera para otros teléfonos: por la API REST de Twilio (si está configurada).
  for (const o of otros) {
    const t = aTexto({ ...o.mensaje, id: '', de: 'negocio', hora: '' }, enlace)
    await almacen.set(`opc:${o.telefono}`, t.opciones, 86_400)
    await enviarTwilio(o.telefono, t.texto).catch(() => {})
  }
  return new Response(twiml(textos), { headers: { 'content-type': 'text/xml; charset=utf-8' } })
}

/** Mensaje saliente por la API REST de Twilio (necesita TWILIO_ACCOUNT_SID y TWILIO_WHATSAPP_FROM). */
async function enviarTwilio(para: string, texto: string) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_WHATSAPP_FROM: de } = process.env
  if (!sid || !token || !de) return
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: `whatsapp:${de.replace(/^whatsapp:/, '')}`, To: `whatsapp:${para}`, Body: texto }),
  })
}
