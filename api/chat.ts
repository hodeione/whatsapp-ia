import Anthropic from '@anthropic-ai/sdk'
import { HERRAMIENTAS, Limitador, MAX_BYTES, MODELO, esFaltaDeSaldo, instrucciones, momentoActual, origenPermitido, validarFicha, validarMensajes } from './_lib/agente.js'

/**
 * POST /api/chat
 * Un turno del asistente de WhatsApp con Claude. Recibe la ficha del negocio y la
 * conversación, y devuelve en streaming (NDJSON) el texto a medida que se
 * genera y, al final, el mensaje completo con las herramientas que quiere
 * usar. La web ejecuta esas herramientas y vuelve a llamar.
 *
 * GET /api/chat: dice a la web si la IA está disponible.
 */

// Una llamada son unos 10-20 turnos: 80 por IP cada 10 minutos y 2.000 por hora en total por instancia.
const limitador = new Limitador(80, 10 * 60_000, 2000, 60 * 60_000)
let cliente: Anthropic | null = null
/** Si la cuenta se queda sin saldo, la web usa el motor local durante un rato sin esperar al error. */
let sinSaldoHasta = 0

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  })
}

/** Última comprobación de saldo: una petición de 1 token (una millonésima de dólar) cada 10 minutos como mucho. */
let comprobadoHasta = 0

async function comprobarSaldo() {
  if (Date.now() < comprobadoHasta || Date.now() < sinSaldoHasta) return
  comprobadoHasta = Date.now() + 10 * 60_000
  try {
    cliente ??= new Anthropic()
    await cliente.messages.create({ model: MODELO, max_tokens: 1, messages: [{ role: 'user', content: '.' }] })
  } catch (err) {
    if (esFaltaDeSaldo(err) || err instanceof Anthropic.AuthenticationError) sinSaldoHasta = Date.now() + 10 * 60_000
    // Otros errores (red, sobrecarga) no desactivan la IA: el turno lo volverá a intentar.
  }
}

export async function GET(): Promise<Response> {
  const clave = Boolean(process.env.ANTHROPIC_API_KEY)
  // Así la web sabe de antemano si hay saldo y no empieza una llamada con la IA para tener que disculparse.
  if (clave) await comprobarSaldo()
  const saldo = Date.now() > sinSaldoHasta
  return json(200, { configured: clave && saldo, motivo: !clave ? 'sin_clave' : !saldo ? 'sin_saldo' : null, modelo: MODELO })
}

export async function POST(request: Request): Promise<Response> {
  if (!origenPermitido(request.headers.get('origin'), request.headers.get('host'))) return json(403, { error: 'Origen no permitido.' })
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'La IA no está activada en esta web.', codigo: 'sin_clave' })
  if (Date.now() < sinSaldoHasta) return json(503, { error: 'La cuenta de IA no tiene saldo.', codigo: 'sin_saldo' })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return json(413, { error: 'Conversación demasiado larga.' })

  let cuerpo: { negocio?: unknown; mensajes?: unknown }
  try {
    const texto = await request.text()
    if (texto.length > MAX_BYTES) return json(413, { error: 'Conversación demasiado larga.' })
    cuerpo = JSON.parse(texto) as typeof cuerpo
  } catch {
    return json(400, { error: 'Petición no válida.' })
  }
  const ficha = validarFicha(cuerpo.negocio)
  const mensajes = validarMensajes(cuerpo.mensajes)
  if (!ficha || !mensajes) return json(400, { error: 'Petición no válida.' })

  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'desconocida'
  const rl = limitador.comprobar(ip)
  if (!rl.ok) return json(429, { error: 'Demasiadas llamadas seguidas. Prueba dentro de unos minutos.', codigo: 'limite' }, { 'retry-after': String(rl.reintentarEn) })

  cliente ??= new Anthropic()
  const ia = cliente
  const codificador = new TextEncoder()
  const cuerpoRespuesta = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enviar = (o: unknown) => controller.enqueue(codificador.encode(JSON.stringify(o) + '\n'))
      try {
        const stream = ia.messages.stream(
          {
            model: MODELO,
            max_tokens: 2048,
            // Conversación por voz: prima la rapidez. El razonamiento adaptativo sigue activo para los pasos con herramientas.
            output_config: { effort: 'low' },
            system: [
              { type: 'text', text: instrucciones(ficha), cache_control: { type: 'ephemeral' } },
              { type: 'text', text: momentoActual(ficha.zonaHoraria) },
            ],
            tools: HERRAMIENTAS,
            messages: mensajes,
          },
          { signal: request.signal },
        )
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') enviar({ tipo: 'texto', t: ev.delta.text })
        }
        const final = await stream.finalMessage()
        enviar({ tipo: 'fin', contenido: final.content, stop: final.stop_reason, uso: final.usage })
      } catch (err) {
        if (esFaltaDeSaldo(err)) {
          sinSaldoHasta = Date.now() + 10 * 60_000
          enviar({ tipo: 'error', codigo: 'sin_saldo', error: 'La cuenta de IA no tiene saldo.' })
        } else if (err instanceof Anthropic.RateLimitError) {
          enviar({ tipo: 'error', codigo: 'ocupado', error: 'Hay mucha demanda ahora mismo.' })
        } else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          enviar({ tipo: 'error', codigo: 'sin_clave', error: 'La clave de la IA no es válida.' })
        } else if (err instanceof Anthropic.APIUserAbortError) {
          // El cliente colgó: no hay nadie a quien contestar.
        } else if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) {
          enviar({ tipo: 'error', codigo: 'ia', error: 'El servicio de IA no responde.' })
        } else {
          enviar({ tipo: 'error', codigo: 'interno', error: 'Error inesperado.' })
        }
      } finally {
        controller.close()
      }
    },
  })
  return new Response(cuerpoRespuesta, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  })
}
