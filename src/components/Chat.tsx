import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Boton, Lista, Mensaje } from '../lib/chat'
import type { Negocio } from '../lib/negocio'
import type { Reserva } from '../lib/reservas/motor'

/**
 * Un chat con el aspecto de WhatsApp (modo oscuro): burbujas, dobles
 * checks, «escribiendo…», botones de respuesta, listas y tarjetas.
 */

interface Props {
  negocio: Negocio
  mensajes: Mensaje[]
  escribiendo: boolean
  motor: string
  onEnviar: (valor: string, titulo: string) => void
  onEnlace: (b: Boton) => void
  onReiniciar: () => void
}

export default function Chat({ negocio, mensajes, escribiendo, motor, onEnviar, onEnlace, onReiniciar }: Props) {
  const [texto, setTexto] = useState('')
  const [lista, setLista] = useState<Lista | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes.length, escribiendo])

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    const t = texto.trim()
    if (!t) return
    setTexto('')
    onEnviar(t, t)
  }
  const pulsar = (b: Boton) => (b.enlace ? onEnlace(b) : b.valor && onEnviar(b.valor, b.titulo))
  // Las respuestas rápidas solo valen en el último mensaje; las acciones (cancelar, cómo llegar…) siempre.
  const ultimoNegocio = [...mensajes].reverse().find((m) => m.de === 'negocio')?.id

  return (
    <div className="relative mx-auto w-full max-w-[390px]">
      <div className="relative flex h-[min(760px,calc(100svh-7rem))] min-h-[600px] flex-col overflow-hidden rounded-[2.6rem] border border-line bg-[#0b141a] shadow-[0_40px_120px_-30px_rgba(37,211,102,0.18),0_0_0_10px_#15171c,0_0_0_11px_#2a2d34]">
        <div className="flex items-center justify-between bg-[#1f2c34] px-6 pt-3 pb-0.5 font-mono text-[11px] text-[#e9edef]/80">
          <span>{new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="h-5 w-24 rounded-full bg-black" aria-hidden />
          <span>5G ▮</span>
        </div>
        <header className="flex items-center gap-3 bg-[#1f2c34] px-3 py-2.5">
          <span className="text-xl text-[#aebac1]" aria-hidden>
            ‹
          </span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#2a3942] text-lg" aria-hidden>
            🌙
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[15px] font-medium text-[#e9edef]">{negocio.nombre}</p>
            <p className="truncate text-[12px] text-[#8696a0]" aria-live="polite">
              {escribiendo ? <span className="text-[#00a884]">escribiendo…</span> : `Cuenta de empresa · ${motor}`}
            </p>
          </div>
          <button onClick={onReiniciar} className="rounded-full px-2 py-1 font-mono text-[10px] text-[#8696a0] hover:text-[#e9edef]" title="Empezar el chat de cero">
            ↺ reiniciar
          </button>
        </header>

        <div
          ref={scroll}
          className="scroll-fino flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.025) 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.02) 1px, transparent 1.5px)', backgroundSize: '26px 26px, 34px 34px' }}
          aria-label="Conversación"
        >
          <p className="mx-auto mb-2 max-w-[85%] rounded-lg bg-[#182229] px-3 py-1.5 text-center text-[11px] leading-snug text-[#ffd279]">
            🔒 Demo: los mensajes se quedan en tu navegador. Así funcionaría en el WhatsApp de tu restaurante.
          </p>
          {mensajes.map((m, i) => (
            <Fragment key={m.id}>
              {(i === 0 || dia(mensajes[i - 1]!.hora) !== dia(m.hora)) && <p className="mx-auto my-1 rounded-md bg-[#182229] px-2.5 py-1 text-[11px] text-[#8696a0]">{etiquetaDia(m.hora)}</p>}
              <Burbuja m={m} activa={m.id === ultimoNegocio} onBoton={pulsar} onLista={setLista} />
            </Fragment>
          ))}
          {escribiendo && (
            <div className="entra self-start rounded-lg rounded-tl-none bg-[#202c33] px-3 py-2.5" aria-label="Escribiendo">
              <span className="flex gap-1">
                {[0, 1, 2].map((k) => (
                  <span key={k} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8696a0]" style={{ animationDelay: `${k * 0.15}s` }} />
                ))}
              </span>
            </div>
          )}
        </div>

        <form onSubmit={enviar} className="flex items-center gap-2 bg-[#0b141a] px-2 pt-1 pb-5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-[#2a3942] px-4 py-2.5">
            <span aria-hidden className="text-[#8696a0]">
              ☺
            </span>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Mensaje" aria-label="Escribe un mensaje" className="sin-anillo min-w-0 flex-1 bg-transparent text-[15px] text-[#e9edef] outline-none placeholder:text-[#8696a0]" />
          </div>
          <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#00a884] text-[#0b141a] disabled:opacity-60" disabled={!texto.trim()} aria-label="Enviar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" />
            </svg>
          </button>
        </form>

        {lista && (
          <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/50" onClick={() => setLista(null)}>
            <div className="entra rounded-t-2xl bg-[#1f2c34] pb-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={lista.boton}>
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => setLista(null)} className="text-xl text-[#aebac1]" aria-label="Cerrar">
                  ×
                </button>
                <p className="text-[15px] font-medium text-[#e9edef]">{lista.boton}</p>
              </div>
              <ul className="scroll-fino max-h-[50vh] overflow-y-auto">
                {lista.opciones.map((o) => (
                  <li key={o.titulo}>
                    <button
                      onClick={() => {
                        setLista(null)
                        pulsar(o)
                      }}
                      className="flex w-full items-center justify-between border-b border-[#2a3942] px-5 py-3 text-left hover:bg-[#2a3942]"
                    >
                      <span>
                        <span className="block text-[15px] text-[#e9edef]">{o.titulo}</span>
                        {o.descripcion && <span className="block text-[12.5px] text-[#8696a0]">{o.descripcion}</span>}
                      </span>
                      <span className="h-5 w-5 rounded-full border-2 border-[#8696a0]" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Burbuja({ m, activa, onBoton, onLista }: { m: Mensaje; activa: boolean; onBoton: (b: Boton) => void; onLista: (l: Lista) => void }) {
  const mio = m.de === 'cliente'
  const hora = new Date(m.hora).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className={`entra flex max-w-[86%] flex-col ${mio ? 'self-end' : 'self-start'}`}>
      <div className={`rounded-lg px-2.5 pt-1.5 pb-1 text-[14.2px] leading-[1.38] text-[#e9edef] shadow-sm ${mio ? 'rounded-tr-none bg-[#005c4b]' : 'rounded-tl-none bg-[#202c33]'}`}>
        {m.automatico && <p className="mb-1 font-mono text-[10px] tracking-wide text-[#00a884] uppercase">⚡ Automático · {ETIQUETA[m.automatico]}</p>}
        {m.tarjeta?.tipo === 'reserva' && <TarjetaReserva r={m.tarjeta.reserva} />}
        {m.tarjeta?.tipo === 'ubicacion' && (
          <a href={m.tarjeta.url} target="_blank" rel="noopener" className="mb-1 block overflow-hidden rounded-md">
            <span className="relative block h-28 bg-[#2a3942]" style={{ backgroundImage: 'linear-gradient(#33454f 1px, transparent 1px), linear-gradient(90deg, #33454f 1px, transparent 1px), linear-gradient(35deg, transparent 45%, #3c5360 45%, #3c5360 52%, transparent 52%)', backgroundSize: '22px 22px, 22px 22px, 100% 100%' }}>
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full text-3xl drop-shadow">📍</span>
            </span>
            <span className="block bg-[#1a252c] px-2 py-1.5">
              <span className="block text-[13px] font-medium">{m.tarjeta.nombre}</span>
              <span className="block text-[12px] text-[#8696a0]">{m.tarjeta.direccion}</span>
            </span>
          </a>
        )}
        {m.texto && <div className="whitespace-pre-wrap break-words">{formato(m.texto)}</div>}
        <span className="float-right mt-1 ml-3 flex items-center gap-1 text-[11px] text-[#8696a0]">
          {hora}
          {mio && <span className="text-[#53bdeb]">✓✓</span>}
        </span>
        <span className="clear-both block" />
        {m.lista && (
          <button onClick={() => activa && onLista(m.lista!)} disabled={!activa} className="mt-1 flex w-full items-center justify-center gap-2 border-t border-[#2a3942] pt-2 pb-1 text-[14px] text-[#00a884] disabled:opacity-50">
            ☰ {m.lista.boton}
          </button>
        )}
      </div>
      {m.botones && m.botones.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {m.botones.map((b) => (
            <button key={b.titulo} onClick={() => (b.enlace || activa || b.valor?.startsWith('#')) && onBoton(b)} disabled={!b.enlace && !activa && !b.valor?.startsWith('#')} className="rounded-lg bg-[#202c33] py-2 text-center text-[14px] text-[#00a884] shadow-sm transition hover:bg-[#26353d] disabled:opacity-45">
              {b.enlace ? '↗ ' : ''}
              {b.titulo}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TarjetaReserva({ r }: { r: Reserva }) {
  const d = new Date(`${r.fecha}T12:00`)
  return (
    <div className="mb-1 overflow-hidden rounded-md bg-[#1a252c]">
      <div className="bg-[#00a884]/15 px-3 py-2 text-[13px] font-semibold text-[#00d4a4]">Reserva confirmada ✅</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
        <dt className="text-[#8696a0]">Día</dt>
        <dd>{cap(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</dd>
        <dt className="text-[#8696a0]">Hora</dt>
        <dd>{r.hora}</dd>
        <dt className="text-[#8696a0]">Personas</dt>
        <dd>{r.personas}</dd>
        <dt className="text-[#8696a0]">Nombre</dt>
        <dd>{r.nombre}</dd>
        {r.notas && (
          <>
            <dt className="text-[#8696a0]">Notas</dt>
            <dd>{r.notas}</dd>
          </>
        )}
        <dt className="text-[#8696a0]">Código</dt>
        <dd className="font-mono font-semibold tracking-wider">{r.codigo}</dd>
      </dl>
    </div>
  )
}

const ETIQUETA: Record<string, string> = { confirmacion: 'confirmación', recordatorio: 'recordatorio', espera: 'lista de espera', resena: 'reseña' }

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const dia = (iso: string) => iso.slice(0, 10)
function etiquetaDia(iso: string) {
  const d = new Date(iso)
  const hoy = new Date()
  if (d.toDateString() === hoy.toDateString()) return 'HOY'
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }).toUpperCase()
}

/** Formato de WhatsApp: *negrita* y _cursiva_. */
function formato(t: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*([^*\n]+)\*|_([^_\n]+)_/g
  let ultimo = 0
  let k = 0
  for (const m of t.matchAll(re)) {
    if (m.index! > ultimo) out.push(t.slice(ultimo, m.index))
    out.push(m[1] ? <strong key={k++}>{m[1]}</strong> : <em key={k++}>{m[2]}</em>)
    ultimo = m.index! + m[0].length
  }
  out.push(t.slice(ultimo))
  return out
}
