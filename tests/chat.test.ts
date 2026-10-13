import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { Conversacion, avisosDeEspera, extraerBotones, ics, type Espera, type Restaurante } from '../src/lib/chat'
import { TABERNA_LUNA as N } from '../src/lib/negocio'
import { ConectorLocal, almacenEnMemoria } from '../src/lib/reservas/conector'
import type { Reserva } from '../src/lib/reservas/motor'

const AHORA = DateTime.fromISO('2026-10-13T18:00', { zone: 'Europe/Madrid' })

function montar(iniciales: Reserva[] = []) {
  const almacen = almacenEnMemoria(iniciales)
  let espera: Espera[] = []
  const avisos: string[] = []
  const restaurante: Restaurante = {
    espera: () => espera,
    guardarEspera: (e) => void (espera = e),
    avisar: (t) => void avisos.push(t),
    actualizarReserva: (codigo, cambios) => almacen.guardar(almacen.leer().map((r) => (r.codigo === codigo ? { ...r, ...cambios } : r))),
  }
  const conector = new ConectorLocal(N, almacen, () => AHORA)
  const conv = new Conversacion({ negocio: N, conector, restaurante, ahora: () => AHORA, telefono: '+34600111222', motor: 'local' })
  const decir = (t: string) => conv.recibir(t)
  return { conv, almacen, decir, avisos, espera: () => espera, restaurante }
}


describe('conversación de WhatsApp', () => {
  it('saluda con botones de inicio', () => {
    const [m] = montar().conv.saludo()
    expect(m!.texto).toMatch(/Soy Luna, el asistente de Taberna Luna/)
    expect(m!.botones!.map((b) => b.titulo)).toEqual(['📅 Reservar mesa', '📄 Ver la carta', '📍 Cómo llegar'])
  })

  it('reserva entera pulsando botones', async () => {
    const { decir, almacen } = montar()
    const r1 = await decir('quiero reservar una mesa')
    expect(r1[0]!.lista?.boton).toBe('Elegir día')
    const viernes = r1[0]!.lista!.opciones.find((o) => o.titulo === 'Viernes 16')!
    const r2 = await decir(viernes.valor!)
    expect(r2[0]!.texto).toMatch(/cuántas personas/)
    expect(r2[0]!.lista!.opciones[3]).toMatchObject({ titulo: '4 personas', valor: 'somos 4' })
    const r3 = await decir('somos 4')
    const horas = r3[0]!.botones ?? r3[0]!.lista!.opciones
    expect(horas.length).toBeGreaterThan(0)
    const r4 = await decir(horas.find((h) => h.valor === 'a las 21:30')?.valor ?? horas[0]!.valor!)
    expect(r4[0]!.texto).toMatch(/A nombre de quién/i)
    expect(r4[0]!.botones).toBeUndefined()
    const r5 = await decir('Ane Etxeberria')
    expect(r5[0]!.botones!.map((b) => b.valor)).toEqual(['no', 'necesitamos trona', 'es un cumpleaños'])
    const r6 = await decir('es un cumpleaños')
    expect(r6[0]!.texto).toMatch(/Te confirmo:\n📅 El viernes 16/)
    expect(r6[0]!.texto).toMatch(/📝 celebración \/ cumpleaños/)
    expect(r6[0]!.botones!.map((b) => b.titulo)).toEqual(['✅ Confirmar', '✏️ Cambiar algo'])
    const r7 = await decir('sí')
    expect(r7[0]!.texto).toMatch(/Tu reserva está confirmada\. Código: \*[A-Z0-9]{5}\*/)
    const tarjeta = r7[1]!
    expect(tarjeta.tarjeta).toMatchObject({ tipo: 'reserva', reserva: { nombre: 'Ane Etxeberria', personas: 4, telefono: '+34600111222' } })
    expect(tarjeta.botones!.map((b) => b.titulo)).toEqual(['📅 Añadir al calendario', '📍 Cómo llegar', '❌ Cancelar'])
    expect(almacen.leer()).toHaveLength(1)
  })

  it('carta, ubicación y preguntas', async () => {
    const { decir } = montar()
    const carta = await decir('#carta')
    expect(carta[0]!.texto).toMatch(/📄 \*Nuestra carta\*/)
    expect(carta[0]!.texto).toMatch(/\*Del mar\*\n• Pulpo a la brasa · 22 €/)
    const ubi = await decir('#ubicacion')
    expect(ubi[0]!.tarjeta).toMatchObject({ tipo: 'ubicacion', direccion: 'Calle Somera 12, 48005 Bilbao' })
    const h = await decir('¿a qué hora abrís?')
    expect(h[0]!.texto).toMatch(/🌙 Cenas: de 20:00 a 22:00/)
    expect(h[0]!.botones?.length).toBe(3)
  })

  it('recordatorio con respuesta de un toque', async () => {
    const r: Reserva = { codigo: 'ABCDE', nombre: 'Jon Agirre', telefono: '+34600111222', fecha: '2026-10-14', hora: '21:00', turno: 'cena', personas: 2, mesa: 's1', notas: '', estado: 'confirmada', origen: 'ia', creada: '' }
    const { conv, almacen, decir } = montar([r])
    const m = conv.recordatorio(r)
    expect(m.texto).toMatch(/Hola Jon 👋 Te recordamos tu reserva en \*Taberna Luna\*:\n📅 Mañana a las \*21:00\*/)
    expect(m.botones!.map((b) => b.valor)).toEqual(['#confirmar:ABCDE', '#cancelar:ABCDE'])
    expect(almacen.leer()[0]!.recordatorio).toBe(true)
    await decir('#confirmar:ABCDE')
    expect(almacen.leer()[0]!.asistencia).toBe('confirmada')
    const c = await decir('#cancelar:ABCDE')
    expect(c[0]!.botones![0]!.valor).toBe('#cancelar!:ABCDE')
    await decir('#cancelar!:ABCDE')
    expect(almacen.leer()[0]!.estado).toBe('cancelada')
  })

  it('lista de espera: se apunta, alguien cancela y se le avisa', async () => {
    // Cena del viernes llena: todas las mesas ocupadas a las 21:00
    const llenas: Reserva[] = N.mesas.map((m, i) => ({ codigo: `C${i}CCC`, nombre: 'Otro', telefono: '+34699' + i, fecha: '2026-10-16', hora: '21:00', turno: 'cena', personas: 1, mesa: m.id, notas: '', estado: 'confirmada', origen: 'web', creada: '' }))
    const { decir, espera, conv, almacen, restaurante } = montar(llenas)
    const r = await decir('mesa para dos el viernes a las nueve')
    expect(r[0]!.botones).toHaveLength(3)
    const avisame = r[0]!.botones!.find((b) => b.titulo.includes('Avísame'))
    expect(avisame?.valor).toBe('#espera:2026-10-16|2|cena')
    await decir(avisame!.valor!)
    expect(espera()).toMatchObject([{ fecha: '2026-10-16', personas: 2, turno: 'cena', estado: 'esperando' }])

    // Otro cliente cancela su mesa de 2
    const cancelada = { ...llenas[0]!, estado: 'cancelada' as const }
    almacen.guardar(almacen.leer().map((x) => (x.codigo === cancelada.codigo ? cancelada : x)))
    const avisos = avisosDeEspera(cancelada, { negocio: N, restaurante, ahora: () => AHORA })
    expect(avisos).toHaveLength(1)
    expect(avisos[0]!.mensaje.texto).toMatch(/Se ha liberado una mesa para \*2 personas\* el viernes 16 a las \*21:00\*/)
    const aceptar = avisos[0]!.mensaje.botones![0]!.valor!
    const ok = await conv.recibir(aceptar)
    expect(ok[0]!.texto).toMatch(/¡Mesa reservada!/)
    expect(espera()[0]!.estado).toBe('aceptado')
  })

  it('reseña al día siguiente y queja por privado', async () => {
    const r: Reserva = { codigo: 'QWERT', nombre: 'Lucía Martín', telefono: '+34600111222', fecha: '2026-10-12', hora: '14:00', turno: 'comida', personas: 3, mesa: 's3', notas: '', estado: 'confirmada', origen: 'ia', creada: '' }
    const { conv, decir, avisos } = montar([r])
    const m = conv.resena(r)
    expect(m.botones![0]).toMatchObject({ titulo: '⭐ Dejar reseña', enlace: N.resena })
    await decir('#problema:QWERT')
    const g = await decir('El arroz llegó frío')
    expect(g[0]!.texto).toMatch(/Se lo paso ahora mismo al encargado/)
    expect(avisos[0]).toMatch(/Queja privada .*El arroz llegó frío/)
  })
})

describe('utilidades', () => {
  it('extrae los botones que escribe Claude', () => {
    expect(extraerBotones('¿Te viene bien a las *21:30*?\n[[Sí, perfecto]] [[Otra hora]]')).toEqual({ texto: '¿Te viene bien a las *21:30*?', botones: [{ titulo: 'Sí, perfecto', valor: 'Sí, perfecto' }, { titulo: 'Otra hora', valor: 'Otra hora' }] })
    expect(extraerBotones('Hola').botones).toEqual([])
  })
  it('genera el evento de calendario', () => {
    const r = { codigo: 'ABCDE', nombre: 'Jon', fecha: '2026-10-16', hora: '21:30', turno: 'cena', personas: 2, mesa: 's1', notas: '', estado: 'confirmada', origen: 'ia', creada: '' } as Reserva
    const t = ics(r, N)
    expect(t).toContain('DTSTART;TZID=Europe/Madrid:20261016T213000')
    expect(t).toContain('DTEND;TZID=Europe/Madrid:20261016T233000')
    expect(t).toContain('LOCATION:Calle Somera 12\\, 48005 Bilbao')
  })
})
