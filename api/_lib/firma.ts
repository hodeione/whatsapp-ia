import { createHmac, timingSafeEqual } from 'node:crypto'

/** Firmas para enlaces sin estado (calendario) y para validar a Twilio. */

const secreto = (env: NodeJS.ProcessEnv) => env.ENLACES_SECRETO || env.WHATSAPP_APP_SECRET || env.TWILIO_AUTH_TOKEN || ''

export function firmar(datos: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac('sha256', secreto(env)).update(datos).digest('base64url').slice(0, 24)
}

export function firmaOk(datos: string, firma: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!secreto(env)) return false
  const a = Buffer.from(firmar(datos, env))
  const b = Buffer.from(firma)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** X-Twilio-Signature: HMAC-SHA1 con el Auth Token de la URL más los parámetros POST ordenados. */
export function firmaTwilio(token: string, url: string, params: Record<string, string>): string {
  return createHmac('sha1', token).update(url + Object.keys(params).sort().map((k) => k + params[k]).join(''), 'utf8').digest('base64')
}

export function peticionDeTwilio(token: string, url: string, params: Record<string, string>, firma: string | null): boolean {
  if (!token || !firma) return false
  const a = Buffer.from(firmaTwilio(token, url, params))
  const b = Buffer.from(firma)
  return a.length === b.length && timingSafeEqual(a, b)
}
