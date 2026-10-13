import { createHmac } from 'node:crypto'
import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { GET as calendario } from '../api/calendario'
import { firmaTwilio, peticionDeTwilio } from '../api/_lib/firma'
import { aMeta, firmaValida, leerEntrantes, plantilla, type MensajeMeta } from '../api/_lib/meta'
import { procesar } from '../api/_lib/procesar'
import { kvUpstash, type KV } from '../api/_lib/servidor'
import { aTexto, interpretar, twiml } from '../api/_lib/twilio'
import { GET as verificar, POST as webhook, enlaceCalendario } from '../api/whatsapp'
import type { Mensaje } from '../src/lib/chat'
import { TABERNA_LUNA as N } from '../src/lib/negocio'

const ENV = {} as NodeJS.ProcessEnv
const msg = (m: Partial<Mensaje>): Mensaje => ({ id: 'x', de: 'negocio', texto: '', hora: '', ...m })
const opciones = { negocio: N, base: 'https://x.app', enlaceCalendario: (c: string) => `https://x.app/cal/${c}` }

function kvPrueba(): KV {
  const m = new Map<string, string>()
  return { get: async <T,>(k: string) => (m.has(k) ? (JSON.parse(m.get(k)!) as T) : null), set: async (k, v) => void m.set(k, JSON.stringify(v)) }
}

describe('Meta: webhook', () => {
  it('valida la firma X-Hub-Signature-256', () => {
    const cuerpo = '{"entry":[]}'
    const firma = 'sha256=' + createHmac('sha256', 'secreto').update(cuerpo).digest('hex')
    expect(firmaValida('secreto', cuerpo, firma)).toBe(true)
    expect(firmaValida('secreto', cuerpo + ' ', firma)).toBe(false)
    expect(firmaValida('', cuerpo, firma)).toBe(false)
    expect(firmaValida('secreto', cuerpo, null)).toBe(false)
  })

  it('lee texto, botones, listas, plantillas y adjuntos', () => {
    const v = (messages: MensajeMeta[]) => ({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Ane' } }], messages } }] }] })
    expect(leerEntrantes(v([{ from: '346', id: '1', type: 'text', text: { body: 'hola' } }]))[0]).toEqual({ telefono: '346', nombre: 'Ane', valor: 'hola', id: '1' })
    expect(leerEntrantes(v([{ from: '346', id: '2', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'sí', title: '✅ Confirmar' } } }]))[0]!.valor).toBe('sí')
    expect(leerEntrantes(v([{ from: '346', id: '3', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'somos 4', title: '4 personas' } } }]))[0]!.valor).toBe('somos 4')
    expect(leerEntrantes(v([{ from: '346', id: '4', type: 'button', button: { payload: '#confirmar:ABCDE', text: 'Allí estaré' } }]))[0]!.valor).toBe('#confirmar:ABCDE')
    expect(leerEntrantes(v([{ from: '346', id: '5', type: 'image' }]))[0]!.valor).toBe('#no_texto')
    expect(leerEntrantes({ entry: [{ changes: [{ value: {} }] }] })).toEqual([])
  })

  it('verificación del webhook y rechazo sin firma', async () => {
    const antes = process.env.WHATSAPP_VERIFY_TOKEN
    process.env.WHATSAPP_VERIFY_TOKEN = 'mi-token'
    const ok = verificar(new Request('https://x.app/api/whatsapp?hub.mode=subscribe&hub.verify_token=mi-token&hub.challenge=123'))
    expect(await ok.text()).toBe('123')
    expect(verificar(new Request('https://x.app/api/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1')).status).toBe(403)
    process.env.WHATSAPP_VERIFY_TOKEN = antes
    expect((await webhook(new Request('https://x.app/api/whatsapp', { method: 'POST', body: '{}' }))).status).toBe(401)
  })
})

describe('Meta: formatos de WhatsApp', () => {
  it('botones de respuesta (máximo 3, títulos de 20)', () => {
    const [m] = aMeta(msg({ texto: '¿Está bien?', botones: [{ titulo: '✅ Confirmar', valor: 'sí' }, { titulo: 'Un texto larguísimo para un botón', valor: 'no' }] }), opciones)
    expect(m).toMatchObject({ type: 'interactive', interactive: { type: 'button', body: { text: '¿Está bien?' } } })
    const botones = (m as { interactive: { action: { buttons: { reply: { id: string; title: string } }[] } } }).interactive.action.buttons
    expect(botones.map((b) => b.reply.id)).toEqual(['sí', 'no'])
    expect(botones[1]!.reply.title.length).toBeLessThanOrEqual(20)
  })
  it('listas (máximo 10 filas, títulos de 24)', () => {
    const [m] = aMeta(msg({ texto: '¿Para cuántas?', lista: { boton: 'Elegir personas', opciones: Array.from({ length: 12 }, (_, i) => ({ titulo: `${i + 1} personas`, valor: `somos ${i + 1}` })) } }), opciones)
    const filas = (m as { interactive: { action: { sections: { rows: unknown[] }[] } } }).interactive.action.sections[0]!.rows
    expect(filas).toHaveLength(10)
    expect(filas[3]).toEqual({ id: 'somos 4', title: '4 personas' })
  })
  it('tarjeta de reserva con enlace de calendario y botones', () => {
    const r = { codigo: 'ABCDE', nombre: 'Ane', fecha: '2026-10-16', hora: '21:30', turno: 'cena', personas: 4, mesa: 's3', notas: '', estado: 'confirmada', origen: 'ia', creada: '' } as const
    const [m] = aMeta(msg({ tarjeta: { tipo: 'reserva', reserva: r }, botones: [{ titulo: '📅 Calendario', enlace: 'calendario:ABCDE' }, { titulo: '❌ Cancelar', valor: '#cancelar:ABCDE' }] }), opciones)
    const t = (m as { interactive: { body: { text: string } } }).interactive.body.text
    expect(t).toContain('📅 16/10/2026 a las *21:30*')
    expect(t).toContain('Código: *ABCDE*')
    expect(t).toContain('📅 Calendario: https://x.app/cal/ABCDE')
  })
  it('ubicación nativa', () => {
    const out = aMeta(msg({ texto: 'Estamos aquí', tarjeta: { tipo: 'ubicacion', nombre: 'Taberna Luna', direccion: N.direccion, url: 'u' } }), opciones)
    expect(out[0]).toMatchObject({ type: 'location', location: { latitude: 43.2566, longitude: -2.9229 } })
    expect(out[1]).toMatchObject({ type: 'text' })
  })
  it('un solo enlace: botón de URL', () => {
    const [m] = aMeta(msg({ texto: '¿Nos dejas una reseña?', botones: [{ titulo: '⭐ Dejar reseña', enlace: 'https://g.page/r' }] }), opciones)
    expect(m).toMatchObject({ interactive: { type: 'cta_url', action: { parameters: { display_text: 'Dejar reseña', url: 'https://g.page/r' } } } })
  })
  it('plantillas con acciones en los botones', () => {
    const p = plantilla('recordatorio_reserva', ['Ane', '21:30'], ['#confirmar:X', '#cancelar:X']) as { template: { components: { parameters: { payload?: string }[] }[] } }
    expect(p.template.components[1]!.parameters[0]!.payload).toBe('#confirmar:X')
  })
})

describe('Twilio', () => {
  it('numera las opciones y entiende la respuesta', () => {
    const t = aTexto(msg({ texto: '¿Qué hora?', botones: [{ titulo: '21:00', valor: 'a las 21:00' }, { titulo: '21:30', valor: 'a las 21:30' }] }), () => '')
    expect(t.texto).toBe('¿Qué hora?\n\n1️⃣ 21:00\n2️⃣ 21:30\n\n_Responde con el número._')
    expect(interpretar('2', t.opciones)).toBe('a las 21:30')
    expect(interpretar('2 personas', t.opciones)).toBe('2 personas')
    expect(twiml(['a & b'])).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Message>a &amp; b</Message></Response>')
  })
  it('valida la firma de Twilio', () => {
    const p = { Body: 'hola', From: 'whatsapp:+34600' }
    expect(peticionDeTwilio('tok', 'https://x.app/api/twilio', p, firmaTwilio('tok', 'https://x.app/api/twilio', p))).toBe(true)
    expect(peticionDeTwilio('tok', 'https://x.app/api/twilio', { ...p, Body: 'adiós' }, firmaTwilio('tok', 'https://x.app/api/twilio', p))).toBe(false)
  })
})

describe('conversación en el servidor', () => {
  it('un chat nuevo con «hola» recibe solo el saludo; luego reserva y guarda el estado', async () => {
    const almacen = kvPrueba()
    const a = await procesar(almacen, '34600111222', 'hola', undefined, ENV)
    expect(a.respuestas).toHaveLength(1)
    expect(a.respuestas[0]!.texto).toMatch(/Soy Luna/)
    const b = await procesar(almacen, '34600111222', 'mesa para 2 mañana a las 21:00', undefined, ENV)
    expect(b.respuestas[0]!.texto).toMatch(/A nombre de quién/i)
    await procesar(almacen, '34600111222', 'Jon Agirre', undefined, ENV)
    await procesar(almacen, '34600111222', 'no', undefined, ENV)
    const c = await procesar(almacen, '34600111222', 'sí', undefined, ENV)
    expect(c.respuestas[1]!.tarjeta).toMatchObject({ tipo: 'reserva', reserva: { telefono: '34600111222', nombre: 'Jon Agirre' } })
    const guardadas = await almacen.get<{ reservas: { telefono?: string }[] }>('reservas')
    expect(guardadas!.reservas.some((r) => r.telefono === '34600111222')).toBe(true)
  })

  it('un chat nuevo con una petición la responde directamente tras el saludo', async () => {
    const r = await procesar(kvPrueba(), '34611', '¿dónde estáis?', undefined, ENV)
    expect(r.respuestas).toHaveLength(2)
    expect(r.respuestas[1]!.texto).toMatch(/Calle Somera 12/)
  })

  it('Upstash por su API REST', async () => {
    const llamadas: string[] = []
    const f = (async (u: string, init?: RequestInit) => {
      llamadas.push(`${init?.method ?? 'GET'} ${u}`)
      return Response.json({ result: init?.method === 'POST' ? 'OK' : JSON.stringify({ a: 1 }) })
    }) as unknown as typeof fetch
    const k = kvUpstash('https://r.upstash.io/', 'tok', f)
    await k.set('conv:34', { a: 1 }, 60)
    expect(await k.get('conv:34')).toEqual({ a: 1 })
    expect(llamadas).toEqual(['POST https://r.upstash.io/set/conv%3A34?EX=60', 'GET https://r.upstash.io/get/conv%3A34'])
  })
})

describe('calendario', () => {
  it('enlace firmado al .ics', async () => {
    process.env.ENLACES_SECRETO = 's'
    const url = enlaceCalendario('https://x.app', { codigo: 'ABCDE', fecha: '2026-10-16', hora: '21:30', personas: 4 })
    const r = calendario(new Request(url))
    expect(r.headers.get('content-type')).toContain('text/calendar')
    expect(await r.text()).toContain('DTSTART;TZID=Europe/Madrid:20261016T213000')
    expect(calendario(new Request(url.replace(/f=[^&]+/, 'f=falsa'))).status).toBe(403)
    void DateTime
  })
})
