import { DateTime } from 'luxon'
import { Conversacion, type Espera, type EstadoConversacion, type Restaurante } from '../../src/lib/chat.js'
import { TABERNA_LUNA, type Negocio } from '../../src/lib/negocio.js'
import { ConectorLocal, reservasDemo, type Conector } from '../../src/lib/reservas/conector.js'
import type { Reserva } from '../../src/lib/reservas/motor.js'
import { ConectorN8n } from '../../src/lib/reservas/n8n.js'

/**
 * Lo que comparten los webhooks de WhatsApp (Meta y Twilio): dónde se
 * guarda el estado y cómo se monta una conversación para un teléfono.
 *
 * Estado: Upstash Redis si hay UPSTASH_REDIS_REST_URL/TOKEN (recomendado en
 * producción); si no, en memoria de la instancia (sirve para probar).
 * Reservas: el sistema real de reservas-n8n si hay RESERVAS_N8N_URL/CLAVE;
 * si no, la misma ocupación de ejemplo que la demo web.
 */

export interface KV {
  get<T>(clave: string): Promise<T | null>
  set(clave: string, valor: unknown, segundos?: number): Promise<void>
}

const memoria = new Map<string, { v: string; hasta: number }>()
export const kvMemoria: KV = {
  async get<T>(k: string) {
    const x = memoria.get(k)
    if (!x || x.hasta < Date.now()) return null
    return JSON.parse(x.v) as T
  },
  async set(k, v, s = 86_400 * 30) {
    memoria.set(k, { v: JSON.stringify(v), hasta: Date.now() + s * 1000 })
  },
}

/** Upstash Redis por su API REST (sin dependencias). */
export function kvUpstash(url: string, token: string, f: typeof fetch = fetch): KV {
  const base = url.replace(/\/$/, '')
  const auth = { authorization: `Bearer ${token}` }
  return {
    async get<T>(k: string) {
      const r = await f(`${base}/get/${encodeURIComponent(k)}`, { headers: auth })
      const d = (await r.json()) as { result: string | null }
      return d.result ? (JSON.parse(d.result) as T) : null
    },
    async set(k, v, s = 86_400 * 30) {
      await f(`${base}/set/${encodeURIComponent(k)}?EX=${s}`, { method: 'POST', headers: auth, body: JSON.stringify(v) })
    },
  }
}

export function kv(env: NodeJS.ProcessEnv = process.env): KV {
  return env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? kvUpstash(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN) : kvMemoria
}

export interface Aviso {
  texto: string
  hora: string
}

/** Estado del restaurante para una petición: se carga al empezar y se guarda al acabar. */
export class Estado implements Restaurante {
  reservas: Reserva[] = []
  private esperaLista: Espera[] = []
  avisos: Aviso[] = []

  constructor(
    private almacen: KV,
    private negocio: Negocio,
    private ahora: () => DateTime,
  ) {}

  async cargar() {
    const hoy = this.ahora().toISODate()!
    const [r, e, a] = await Promise.all([this.almacen.get<{ dia: string; reservas: Reserva[] }>('reservas'), this.almacen.get<Espera[]>('espera'), this.almacen.get<Aviso[]>('avisos')])
    if (r && r.dia === hoy) this.reservas = r.reservas
    else {
      // Cada día se regenera la ocupación de ejemplo; las reservas hechas por WhatsApp se conservan.
      this.reservas = [...reservasDemo(this.negocio, this.ahora()), ...(r?.reservas ?? []).filter((x) => x.origen === 'ia' && x.fecha >= hoy)]
    }
    this.esperaLista = (e ?? []).filter((x) => x.fecha >= hoy)
    this.avisos = a ?? []
    return this
  }

  async guardar() {
    await Promise.all([this.almacen.set('reservas', { dia: this.ahora().toISODate(), reservas: this.reservas }), this.almacen.set('espera', this.esperaLista), this.almacen.set('avisos', this.avisos.slice(0, 50))])
  }

  espera() {
    return this.esperaLista
  }
  guardarEspera(e: Espera[]) {
    this.esperaLista = e
  }
  avisar(texto: string) {
    this.avisos = [{ texto, hora: this.ahora().toISO()! }, ...this.avisos]
  }
  actualizarReserva(codigo: string, cambios: Partial<Reserva>) {
    this.reservas = this.reservas.map((r) => (r.codigo === codigo ? { ...r, ...cambios } : r))
  }
}

export interface Entorno {
  negocio: Negocio
  ahora: () => DateTime
  estado: Estado
  conector: Conector
}

export async function entorno(almacen: KV, env: NodeJS.ProcessEnv = process.env, ahoraFijo?: DateTime): Promise<Entorno> {
  const negocio = TABERNA_LUNA
  const ahora = () => ahoraFijo ?? DateTime.now().setZone(negocio.zonaHoraria)
  const estado = await new Estado(almacen, negocio, ahora).cargar()
  const conector: Conector =
    env.RESERVAS_N8N_URL && env.RESERVAS_N8N_CLAVE
      ? new ConectorN8n(env.RESERVAS_N8N_URL, env.RESERVAS_N8N_CLAVE, negocio, ahora)
      : new ConectorLocal(negocio, { leer: () => estado.reservas, guardar: (r) => void (estado.reservas = r) }, ahora)
  return { negocio, ahora, estado, conector }
}

/** La conversación de un teléfono, con su estado guardado. */
export async function conversacion(e: Entorno, almacen: KV, telefono: string, fetchIA?: typeof fetch, env: NodeJS.ProcessEnv = process.env) {
  const guardado = await almacen.get<EstadoConversacion>(`conv:${telefono}`)
  const c = new Conversacion({ negocio: e.negocio, conector: e.conector, restaurante: e.estado, ahora: e.ahora, telefono, motor: env.ANTHROPIC_API_KEY && fetchIA ? 'claude' : 'local', fetchIA })
  const nueva = !guardado
  if (guardado) c.importar(guardado)
  return {
    c,
    nueva,
    guardar: async () => {
      await almacen.set(`conv:${telefono}`, c.exportar(), 86_400 * 2)
      await e.estado.guardar()
    },
  }
}
