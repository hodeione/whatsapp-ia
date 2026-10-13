import { enviar, plantilla } from './_lib/meta.js'
import { entorno, kv } from './_lib/servidor.js'

/**
 * GET /api/recordatorios — tarea diaria (Vercel Cron, ver vercel.json).
 * - Recordatorio a las reservas de mañana hechas por WhatsApp, con botones
 *   «Allí estaré / Cancelar» (plantilla WHATSAPP_PLANTILLA_RECORDATORIO).
 * - Petición de reseña a las de ayer (plantilla WHATSAPP_PLANTILLA_RESENA).
 * Meta exige plantillas aprobadas para escribir primero al cliente.
 */
export async function GET(request: Request): Promise<Response> {
  if (process.env.CRON_SECRET && request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('No autorizado', { status: 401 })
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return Response.json({ ok: false, motivo: 'WhatsApp no está configurado' })
  const almacen = kv()
  const e = await entorno(almacen)
  const hoy = e.ahora()
  const manana = hoy.plus({ days: 1 }).toISODate()
  const ayer = hoy.minus({ days: 1 }).toISODate()
  const nombreRec = process.env.WHATSAPP_PLANTILLA_RECORDATORIO ?? 'recordatorio_reserva'
  const nombreRes = process.env.WHATSAPP_PLANTILLA_RESENA ?? 'peticion_resena'
  let recordatorios = 0
  let resenas = 0
  for (const r of e.estado.reservas) {
    if (r.estado !== 'confirmada' || r.origen !== 'ia' || !r.telefono) continue
    if (r.fecha === manana && !r.recordatorio) {
      // Plantilla: «Hola {{1}}, te recordamos tu reserva de mañana a las {{2}} para {{3}} personas en {{4}}.» + botones Allí estaré / Cancelar
      if (await enviar(r.telefono, plantilla(nombreRec, [r.nombre.split(' ')[0]!, r.hora, String(r.personas), e.negocio.nombre], [`#confirmar:${r.codigo}`, `#cancelar:${r.codigo}`]))) {
        e.estado.actualizarReserva(r.codigo, { recordatorio: true })
        recordatorios++
      }
    }
    if (r.fecha === ayer && !r.resena) {
      // Plantilla: «¡Gracias por venir, {{1}}! ¿Nos dejas una reseña? {{2}}» + botón Tuve un problema
      if (await enviar(r.telefono, plantilla(nombreRes, [r.nombre.split(' ')[0]!, e.negocio.resena ?? ''], [`#problema:${r.codigo}`]))) {
        e.estado.actualizarReserva(r.codigo, { resena: 'pedida' })
        resenas++
      }
    }
  }
  await e.estado.guardar()
  return Response.json({ ok: true, recordatorios, resenas })
}
