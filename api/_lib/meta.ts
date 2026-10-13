import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Boton, Mensaje } from '../../src/lib/chat.js'
import type { Negocio } from '../../src/lib/negocio.js'
import type { Reserva } from '../../src/lib/reservas/motor.js'

/**
 * WhatsApp Cloud API (Meta): firma de los webhooks, lectura de los
 * mensajes entrantes y conversión de nuestros mensajes a los formatos de
 * WhatsApp (botones de respuesta, listas, enlace y ubicación).
 * Referencia: developers.facebook.com/docs/whatsapp/cloud-api
 */

export const VERSION_GRAPH = 'v21.0'

/** X-Hub-Signature-256: «sha256=» + HMAC-SHA256 del cuerpo con el App Secret. */
export function firmaValida(secreto: string, cuerpo: string, cabecera: string | null): boolean {
  if (!secreto || !cabecera?.startsWith('sha256=')) return false
  const esperada = Buffer.from('sha256=' + createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex'))
  const recibida = Buffer.from(cabecera)
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida)
}

export interface Entrante {
  telefono: string
  nombre: string
  /** Lo que se pasa a la conversación: el texto o el id del botón pulsado. */
  valor: string
  id: string
}

export interface CuerpoWebhook {
  entry?: { changes?: { value?: { contacts?: { profile?: { name?: string }; wa_id?: string }[]; messages?: MensajeMeta[] } }[] }[]
}
export interface MensajeMeta {
  from: string
  id: string
  type: string
  text?: { body: string }
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } }
  button?: { payload?: string; text?: string }
}

/** Saca los mensajes de un webhook (pueden venir varios, o solo avisos de estado). */
export function leerEntrantes(cuerpo: CuerpoWebhook): Entrante[] {
  const out: Entrante[] = []
  for (const e of cuerpo.entry ?? [])
    for (const c of e.changes ?? []) {
      const v = c.value
      const nombre = v?.contacts?.[0]?.profile?.name ?? ''
      for (const m of v?.messages ?? []) {
        const valor =
          m.type === 'text'
            ? m.text?.body
            : m.type === 'interactive'
              ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id)
              : m.type === 'button'
                ? (m.button?.payload ?? m.button?.text)
                : undefined
        // Audios, fotos y stickers: se responde con una ayuda en vez de ignorarlos.
        out.push({ telefono: m.from, nombre, valor: valor ?? '#no_texto', id: m.id })
      }
    }
  return out
}

const corta = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…')

export function resumenReserva(r: Reserva): string {
  return `✅ *Reserva confirmada*\n📅 ${r.fecha.split('-').reverse().join('/')} a las *${r.hora}*\n👥 ${r.personas} personas\n👤 ${r.nombre}${r.notas ? `\n📝 ${r.notas}` : ''}\n🔖 Código: *${r.codigo}*`
}

export interface Opciones {
  negocio: Negocio
  /** URL pública, para los enlaces de calendario. */
  base: string
  enlaceCalendario: (codigo: string) => string
}

/** Uno de nuestros mensajes → uno o varios mensajes de la API de WhatsApp. */
export function aMeta(m: Mensaje, o: Opciones): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  let texto = m.texto
  if (m.tarjeta?.tipo === 'reserva') texto = [resumenReserva(m.tarjeta.reserva), texto].filter(Boolean).join('\n\n')
  if (m.tarjeta?.tipo === 'ubicacion' && o.negocio.lat !== undefined && o.negocio.lng !== undefined) {
    out.push({ type: 'location', location: { latitude: o.negocio.lat, longitude: o.negocio.lng, name: o.negocio.nombre, address: o.negocio.direccion } })
  }
  const respuestas = (m.botones ?? []).filter((b): b is Boton & { valor: string } => Boolean(b.valor))
  const enlaces = (m.botones ?? []).filter((b) => b.enlace).map((b) => ({ titulo: b.titulo, url: b.enlace!.startsWith('calendario:') ? o.enlaceCalendario(b.enlace!.slice(11)) : b.enlace! }))
  // Los botones de respuesta no pueden llevar enlaces: si hay ambos, los enlaces van en el texto.
  if (respuestas.length && enlaces.length) texto += '\n\n' + enlaces.map((e) => `${e.titulo}: ${e.url}`).join('\n')
  const cuerpo = corta(texto || '…', 1024)

  if (m.lista) {
    out.push({
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: cuerpo },
        action: {
          button: corta(m.lista.boton, 20),
          sections: [{ title: corta(m.lista.boton, 24), rows: m.lista.opciones.filter((x) => x.valor).slice(0, 10).map((x) => ({ id: corta(x.valor!, 200), title: corta(x.titulo, 24), ...(x.descripcion ? { description: corta(x.descripcion, 72) } : {}) })) }],
        },
      },
    })
  } else if (respuestas.length) {
    out.push({ type: 'interactive', interactive: { type: 'button', body: { text: cuerpo }, action: { buttons: respuestas.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: corta(b.valor, 256), title: corta(b.titulo, 20) } })) } } })
  } else if (enlaces.length === 1) {
    out.push({ type: 'interactive', interactive: { type: 'cta_url', body: { text: cuerpo }, action: { name: 'cta_url', parameters: { display_text: corta(enlaces[0]!.titulo.replace(/^\W+/u, ''), 20), url: enlaces[0]!.url } } } })
  } else if (texto || !out.length) {
    out.push({ type: 'text', text: { body: corta(texto + (enlaces.length ? '\n\n' + enlaces.map((e) => `${e.titulo}: ${e.url}`).join('\n') : ''), 4096), preview_url: false } })
  }
  return out
}

/** Envía un mensaje por la Graph API. */
export async function enviar(para: string, cuerpo: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): Promise<boolean> {
  const r = await f(`https://graph.facebook.com/${VERSION_GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, ...cuerpo }),
  })
  return r.ok
}

/**
 * Plantilla aprobada (para escribir primero: recordatorios y reseñas fuera
 * de la ventana de 24 h). Los botones de respuesta rápida de la plantilla
 * llevan como «payload» nuestra acción, por ejemplo #confirmar:CODIGO.
 */
export function plantilla(nombre: string, parametros: string[], payloads: string[], idioma = 'es'): Record<string, unknown> {
  return {
    type: 'template',
    template: {
      name: nombre,
      language: { code: idioma },
      components: [
        { type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: t })) },
        ...payloads.map((p, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: p }] })),
      ],
    },
  }
}
