import { ics } from '../src/lib/chat.js'
import { TABERNA_LUNA } from '../src/lib/negocio.js'
import type { Reserva } from '../src/lib/reservas/motor.js'
import { firmaOk } from './_lib/firma.js'

/** GET /api/calendario?d=…&f=… → la reserva como evento de calendario (.ics). El enlace va firmado. */
export function GET(request: Request): Response {
  const q = new URL(request.url).searchParams
  const d = q.get('d') ?? ''
  if (!firmaOk(d, q.get('f') ?? '')) return new Response('Enlace no válido', { status: 403 })
  let x: { c: string; f: string; h: string; p: number }
  try {
    x = JSON.parse(Buffer.from(d, 'base64url').toString()) as typeof x
  } catch {
    return new Response('Enlace no válido', { status: 400 })
  }
  const r = { codigo: x.c, fecha: x.f, hora: x.h, personas: x.p, nombre: '', turno: 'cena', mesa: '', notas: '', estado: 'confirmada', origen: 'ia', creada: '' } as Reserva
  return new Response(ics(r, TABERNA_LUNA), { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="reserva-${x.c}.ics"` } })
}
