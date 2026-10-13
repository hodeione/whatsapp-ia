import { DateTime } from 'luxon'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Chat from './components/Chat'
import { AlmacenDemo } from './lib/almacen'
import { Conversacion, avisosDeEspera, ics, type Boton, type Mensaje } from './lib/chat'
import { DIAS } from './lib/es/hablar'
import { TABERNA_LUNA } from './lib/negocio'
import { ConectorLocal } from './lib/reservas/conector'
import { ocupa, turnoDe } from './lib/reservas/motor'

const negocio = TABERNA_LUNA
const ahora = () => DateTime.now().setZone(negocio.zonaHoraria)
const TELEFONO = '+34 600 000 000'
const DHT = 'https://h-com-bay.vercel.app'
const REPO = 'https://github.com/hodeione/whatsapp-ia'

const EJEMPLOS = ['Hola, ¿tenéis mesa para 4 el sábado a las 21:00?', '¿Tenéis algo sin gluten?', 'Quiero cancelar mi reserva', '¿Se puede ir con perro?']

const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

export default function App() {
  const almacen = useMemo(() => new AlmacenDemo(negocio, ahora), [])
  const conector = useMemo(() => new ConectorLocal(negocio, almacen, ahora), [almacen])
  const [ia, setIa] = useState<boolean | null>(null)
  const conv = useRef<Conversacion | null>(null)
  const [mensajes, setMensajes] = useState<Mensaje[]>(() => almacen.mensajes)
  const [escribiendo, setEscribiendo] = useState(false)
  const [, setV] = useState(0)
  const [aviso, setAviso] = useState('')

  useEffect(() => AlmacenDemo.alCambiar(() => setV((x) => x + 1)), [])
  useEffect(() => {
    fetch('/api/chat')
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((d: { configured: boolean }) => setIa(d.configured))
      .catch(() => setIa(false))
  }, [])

  // Crea la conversación (o la recupera) cuando se sabe si hay IA.
  useEffect(() => {
    if (ia === null || conv.current) return
    const c = new Conversacion({ negocio, conector, restaurante: almacen, ahora, telefono: TELEFONO, motor: ia ? 'claude' : 'local' })
    if (almacen.conversacion && almacen.mensajes.length) c.importar({ ...almacen.conversacion, motor: ia ? almacen.conversacion.motor : 'local' })
    else {
      const saludo = c.saludo()
      setMensajes(saludo)
      almacen.guardarChat(saludo, c.exportar())
    }
    conv.current = c
  }, [ia, almacen, conector])

  const anadir = useCallback(
    (nuevos: Mensaje[]) => {
      setMensajes((prev) => {
        const todos = [...prev, ...nuevos]
        if (conv.current) almacen.guardarChat(todos, conv.current.exportar())
        return todos
      })
    },
    [almacen],
  )

  const enviar = async (valor: string, titulo: string) => {
    const c = conv.current
    if (!c || escribiendo) return
    anadir([{ id: `c${Date.now()}`, de: 'cliente', texto: titulo, hora: ahora().toISO()! }])
    setEscribiendo(true)
    const inicio = Date.now()
    try {
      const resp = await c.recibir(valor)
      // Un pequeño retardo para que se vea el «escribiendo…», como en un chat real.
      await pausa(Math.max(0, 650 - (Date.now() - inicio)))
      for (const [i, m] of resp.entries()) {
        if (i > 0) await pausa(450)
        anadir([m])
      }
    } catch (e) {
      anadir([{ id: `e${Date.now()}`, de: 'negocio', texto: `Ups, algo ha fallado: ${e instanceof Error ? e.message : e}`, hora: ahora().toISO()! }])
    } finally {
      setEscribiendo(false)
    }
  }

  const enlace = (b: Boton) => {
    if (b.enlace?.startsWith('calendario:')) {
      const r = almacen.leer().find((x) => x.codigo === b.enlace!.slice(11))
      if (!r) return
      const url = URL.createObjectURL(new Blob([ics(r, negocio)], { type: 'text/calendar' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `reserva-${r.codigo}.ics`
      a.click()
      URL.revokeObjectURL(url)
    } else if (b.enlace) window.open(b.enlace, '_blank', 'noopener')
  }

  const reiniciar = () => {
    almacen.reiniciar()
    conv.current = null
    setMensajes([])
    setIa((x) => (x === null ? x : x)) // vuelve a crear la conversación en el efecto
    const c = new Conversacion({ negocio, conector, restaurante: almacen, ahora, telefono: TELEFONO, motor: ia ? 'claude' : 'local' })
    const saludo = c.saludo()
    conv.current = c
    setMensajes(saludo)
    almacen.guardarChat(saludo, c.exportar())
  }

  /* ---------------------------------------------------- simulador */
  const mias = almacen.leer().filter((r) => r.telefono === TELEFONO && ocupa(r))
  const avisar = (t: string) => {
    setAviso(t)
    setTimeout(() => setAviso(''), 4500)
  }
  const simularRecordatorio = async () => {
    const c = conv.current
    const pendientes = mias.filter((r) => !r.recordatorio)
    if (!c || !pendientes.length) return avisar(mias.length ? 'Ya se ha enviado el recordatorio de tus reservas.' : 'Primero haz una reserva desde el chat.')
    for (const r of pendientes) {
      await pausa(300)
      anadir([c.recordatorio(r)])
    }
  }
  const simularResena = async () => {
    const c = conv.current
    const pendientes = mias.filter((r) => !r.resena)
    if (!c || !pendientes.length) return avisar(mias.length ? 'Ya se ha pedido la reseña de tus reservas.' : 'Primero haz una reserva desde el chat.')
    await pausa(300)
    anadir([c.resena(pendientes[0]!)])
  }
  const simularCancelacion = async () => {
    const c = conv.current
    if (!c) return
    const esperando = almacen.espera().filter((e) => e.estado === 'esperando' && e.telefono === TELEFONO)
    const objetivo = esperando[0]
    const candidatas = almacen
      .leer()
      .filter((r) => ocupa(r) && r.telefono !== TELEFONO && (objetivo ? r.fecha === objetivo.fecha && turnoDe(negocio, r.hora) === objetivo.turno && r.personas + 2 >= objetivo.personas : r.fecha > ahora().toISODate()!))
    const r = candidatas[0]
    if (!r) return avisar(objetivo ? 'No hay ninguna reserva que se pueda cancelar ese turno.' : 'No hay reservas de otros clientes para cancelar.')
    const res = await conector.cancelar(r.codigo)
    if (!res.ok) return
    almacen.avisar(`${r.nombre} canceló su reserva del ${r.fecha} a las ${r.hora} (${r.personas} pers.).`)
    const avisos = avisosDeEspera(res.reserva, { negocio, restaurante: almacen, ahora })
    const paraMi = avisos.filter((a) => a.espera.telefono === TELEFONO)
    if (!paraMi.length) return avisar(`${r.nombre} ha cancelado, pero no estabas en la lista de espera de ese turno. Pide una hora completa y pulsa «Avísame si se libera».`)
    await pausa(400)
    for (const a of paraMi) anadir([{ ...a.mensaje, id: `w${Date.now()}`, de: 'negocio', hora: ahora().toISO()! }])
  }

  const hoy = ahora().toISODate()!
  const proximas = almacen
    .leer()
    .filter((r) => r.fecha > hoy || (r.fecha === hoy && r.hora >= ahora().toFormat('HH:mm')))
    .sort((a, b) => Number(b.telefono === TELEFONO) - Number(a.telefono === TELEFONO) || (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
  const m = almacen.metricas

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line/60 bg-ink/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <a href={DHT} className="flex items-center gap-2.5" aria-label="DH Technology">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-acid font-display text-lg text-ink">DH</span>
            <span className="font-display text-xl tracking-wider">
              WhatsApp <span className="text-acid">IA</span>
            </span>
          </a>
          <nav className="flex items-center gap-1 text-sm">
            <a href="#panel" className="hidden rounded-full px-3 py-1.5 text-mute hover:text-soft sm:block">
              Panel
            </a>
            <a href="#conectar" className="hidden rounded-full px-3 py-1.5 text-mute hover:text-soft sm:block">
              Conectarlo
            </a>
            <a href={REPO} className="rounded-full border border-line px-3 py-1.5 text-soft hover:border-mute">
              Código
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-12">
          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-acid uppercase">DH Technology · WhatsApp con IA</p>
            <h1 className="mt-4 font-display text-[clamp(3rem,6.2vw,5.4rem)] leading-[0.88] tracking-wide">
              Tu restaurante, <span className="text-acid">también por WhatsApp.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-soft/90">
              Un asistente que contesta al momento, reserva con botones, manda los recordatorios y llena las mesas que se cancelan con la lista de espera. Escríbele a <strong className="text-white">Taberna Luna</strong> y mira el panel.
            </p>
            <ul className="mt-6 grid gap-2 text-sm text-soft sm:grid-cols-2">
              {[
                ['✅', 'Confirmación con tarjeta y calendario'],
                ['⏰', 'Recordatorio con «Allí estaré / Cancelar»'],
                ['🔔', 'Lista de espera que avisa sola'],
                ['⭐', 'Petición de reseña al día siguiente'],
              ].map(([i, t]) => (
                <li key={t} className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
                  <span>{i}</span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-7">
              <p className="font-mono text-[11px] tracking-wider text-mute uppercase">Prueba a escribir</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {EJEMPLOS.map((e) => (
                  <button key={e} onClick={() => void enviar(e, e)} disabled={escribiendo || !conv.current} className="rounded-full border border-line bg-card px-3.5 py-1.5 text-left text-sm text-soft transition hover:border-acid/60 hover:text-white disabled:opacity-50">
                    «{e}»
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-6 font-mono text-[11px] text-mute">Cerebro: {ia === null ? 'comprobando…' : ia ? 'Claude Haiku 5.5' : 'motor propio de reglas (sin IA)'}</p>
          </div>
          <Chat negocio={negocio} mensajes={mensajes} escribiendo={escribiendo} motor={ia ? 'IA' : 'asistente'} onEnviar={(v, t) => void enviar(v, t)} onEnlace={enlace} onReiniciar={reiniciar} />
        </section>

        <section id="panel" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
          <div className="mb-8 max-w-2xl">
            <p className="font-mono text-xs tracking-[0.2em] text-acid uppercase">Lo que ve el dueño</p>
            <h2 className="mt-3 font-display text-5xl leading-none tracking-wide">Panel y automatizaciones</h2>
            <p className="mt-3 text-soft/85">Adelanta el tiempo para ver los mensajes automáticos llegar a tu chat.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Accion icono="⏰" titulo="Recordatorio del día antes" texto="Le llega a cada cliente con botones para confirmar o cancelar." onClick={() => void simularRecordatorio()} />
            <Accion icono="❌" titulo="Otro cliente cancela" texto="La mesa se ofrece sola al primero de la lista de espera." onClick={() => void simularCancelacion()} />
            <Accion icono="⭐" titulo="Al día siguiente" texto="Pide la reseña en Google; las quejas van por privado." onClick={() => void simularResena()} />
          </div>
          {aviso && <p className="entra mt-3 rounded-xl border border-acid/40 bg-acid/5 px-4 py-2.5 text-sm text-acid">{aviso}</p>}

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {[
              [m.recordatorios, 'recordatorios enviados'],
              [m.confirmadas, 'asistencias confirmadas'],
              [m.recuperadas, 'mesas recuperadas de la lista de espera'],
              [m.resenas, 'reseñas pedidas'],
            ].map(([n, t]) => (
              <div key={t as string} className="rounded-2xl border border-line bg-card p-4">
                <p className="font-display text-4xl text-acid">{n}</p>
                <p className="text-sm text-soft/80">{t}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="min-w-0 rounded-3xl border border-line bg-card p-5 sm:p-6">
              <h3 className="font-display text-3xl tracking-wide">Próximas reservas</h3>
              <ul className="scroll-fino mt-4 max-h-[420px] divide-y divide-line overflow-y-auto rounded-2xl border border-line">
                {proximas.slice(0, 60).map((r) => {
                  const d = DateTime.fromISO(r.fecha)
                  const mia = r.telefono === TELEFONO
                  return (
                    <li key={r.codigo} className={`flex items-center gap-3 px-3.5 py-2.5 text-sm ${mia ? 'bg-[#00a884]/10' : ''} ${r.estado === 'cancelada' ? 'opacity-40' : ''}`}>
                      <span className="w-28 shrink-0 font-mono text-xs whitespace-nowrap text-soft">
                        {DIAS[d.weekday - 1]!.slice(0, 3)} {d.day} · {r.hora}
                      </span>
                      <span className={`min-w-0 flex-1 truncate ${r.estado === 'cancelada' ? 'line-through' : 'text-soft'}`}>
                        {r.nombre} <span className="text-mute">· {r.personas} pers.</span>
                        {r.notas && <span className="block truncate text-xs text-mute">{r.notas}</span>}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 font-mono text-[10px]">
                        {mia && <span className="rounded-full bg-[#00a884] px-1.5 py-px text-[#0b141a]">WhatsApp · tú</span>}
                        {r.asistencia === 'confirmada' && <span className="text-acid">✓ confirmada</span>}
                        {r.recordatorio && !r.asistencia && <span className="text-mute">recordatorio enviado</span>}
                        {r.estado === 'cancelada' && <span className="text-mute">cancelada</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <div className="rounded-3xl border border-line bg-card p-5 sm:p-6">
                <h3 className="font-display text-3xl tracking-wide">Lista de espera</h3>
                {almacen.espera().length === 0 ? (
                  <p className="mt-3 text-sm text-mute">Vacía. Pide en el chat una hora que esté completa y pulsa «🔔 Avísame si se libera».</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {almacen.espera().map((e) => (
                      <li key={e.id} className="flex justify-between gap-2 rounded-xl border border-line px-3 py-2">
                        <span className="text-soft">
                          {e.nombre} · {e.personas} pers. · {e.fecha.slice(8)}/{e.fecha.slice(5, 7)} {e.turno}
                        </span>
                        <span className="font-mono text-[11px] text-mute">{{ esperando: 'esperando', avisado: 'avisado', aceptado: '✓ reservó', rechazado: 'no quiso' }[e.estado]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-3xl border border-line bg-card p-5 sm:p-6">
                <h3 className="font-display text-3xl tracking-wide">Avisos para el equipo</h3>
                {almacen.avisos.length === 0 ? (
                  <p className="mt-3 text-sm text-mute">Aquí llegan las quejas privadas, los grupos grandes y lo que el asistente no puede resolver.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {almacen.avisos.map((a) => (
                      <li key={a.hora + a.texto} className="rounded-xl border border-line px-3 py-2 text-soft">
                        <span className="mr-2 font-mono text-[11px] text-mute">{a.hora.slice(11, 16)}</span>
                        {a.texto}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </section>

        <section id="conectar" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
          <div className="mb-8 max-w-2xl">
            <p className="font-mono text-xs tracking-[0.2em] text-acid uppercase">Por dentro</p>
            <h2 className="mt-3 font-display text-5xl leading-none tracking-wide">Del chat a tu WhatsApp real</h2>
            <p className="mt-3 text-soft/85">La demo usa exactamente la misma lógica que la versión conectada a WhatsApp: solo cambia de dónde llegan los mensajes.</p>
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              ['01', 'Entiende', 'Claude Haiku 5.5 con herramientas para consultar mesas, reservar y cancelar. Sin IA, un motor propio que entiende fechas, horas y comensales en castellano.'],
              ['02', 'Responde con botones', 'Botones de respuesta rápida y listas de WhatsApp para elegir día, personas y hora con un toque, y tarjetas con la reserva.'],
              ['03', 'Trabaja solo', 'Recordatorios del día antes, lista de espera automática y petición de reseña. Conectado a la API oficial de WhatsApp Cloud (Meta) o a Twilio.'],
            ].map(([n, t, d]) => (
              <li key={n} className="rounded-3xl border border-line bg-card p-6">
                <span className="font-mono text-xs text-acid">{n}</span>
                <h3 className="mt-2 font-display text-3xl tracking-wide">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-soft/85">{d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10 grid gap-6 rounded-3xl border border-acid/40 bg-gradient-to-br from-acid/[0.08] to-transparent p-7 sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <h2 className="font-display text-5xl leading-none tracking-wide">¿Lo quieres en tu negocio?</h2>
              <p className="mt-3 max-w-xl text-soft/90">Lo conectamos a tu número de WhatsApp Business, a tu sistema de reservas y a tu carta. Menos llamadas, menos mesas vacías y más reseñas.</p>
            </div>
            <div className="flex flex-col gap-3">
              <a href="https://wa.me/34668524968?text=Hola%2C%20he%20probado%20el%20asistente%20de%20WhatsApp%20con%20IA%20y%20me%20interesa%20para%20mi%20negocio." target="_blank" rel="noopener" className="rounded-full bg-acid py-3.5 text-center font-medium text-ink transition hover:brightness-110">
                Hablar con DH Technology
              </a>
              <a href={REPO} className="rounded-full border border-line py-3.5 text-center text-soft hover:border-mute">
                Ver el código en GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 font-mono text-xs text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Hecho por <a href={DHT} className="text-soft hover:text-acid">DH Technology</a> · Taberna Luna es un restaurante de demostración.
          </p>
          <p>WhatsApp es una marca de Meta. Esta demo no está afiliada a Meta.</p>
        </div>
      </footer>
    </>
  )
}

function Accion({ icono, titulo, texto, onClick }: { icono: string; titulo: string; texto: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group rounded-3xl border border-line bg-card p-5 text-left transition hover:border-acid/60">
      <span className="text-2xl">{icono}</span>
      <p className="mt-2 font-semibold text-white">{titulo}</p>
      <p className="mt-1 text-sm text-soft/80">{texto}</p>
      <p className="mt-3 font-mono text-xs text-acid group-hover:underline">Simular →</p>
    </button>
  )
}
