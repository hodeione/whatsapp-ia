import type { Mensaje } from '../../src/lib/chat.js'
import { conversacion, entorno, type KV } from './servidor.js'

/**
 * Procesa un mensaje entrante de WhatsApp (venga de Meta o de Twilio) y
 * devuelve las respuestas para ese teléfono y, si alguien canceló, los
 * avisos para otros clientes de la lista de espera.
 */
export async function procesar(almacen: KV, telefono: string, valor: string, fetchIA?: typeof fetch, env: NodeJS.ProcessEnv = process.env) {
  const e = await entorno(almacen, env)
  const { c, nueva, guardar } = await conversacion(e, almacen, telefono, fetchIA, env)
  const respuestas: Mensaje[] = []
  // Un «hola» suelto en un chat nuevo solo recibe el saludo; cualquier otra cosa se responde directamente.
  const soloSaludo = /^(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|hey|hello|ey)\b[\s!.¡,]*$/i.test(valor.trim())
  if (nueva) respuestas.push(...c.saludo())
  if (!(nueva && soloSaludo)) respuestas.push(...(await c.recibir(valor)))
  await guardar()
  return { respuestas, otros: c.paraOtros, entorno: e }
}
