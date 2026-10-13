import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { analizar, type Esperando } from '../src/lib/es/entender'
import { aLaHora, deletrear, fechaHablada, horaHablada } from '../src/lib/es/hablar'
import { numeroEnLetra, primerNumero, normalizar } from '../src/lib/es/numeros'
import { TABERNA_LUNA } from '../src/lib/negocio'

// Martes 13 de octubre de 2026, 18:00 en Bilbao
const HOY = DateTime.fromISO('2026-10-13T18:00', { zone: 'Europe/Madrid' })
const leer = (t: string, esperando?: Esperando) => analizar(t, { hoy: HOY, esperando, negocio: TABERNA_LUNA })

describe('números', () => {
  it('lee cifras y palabras', () => {
    expect(primerNumero(normalizar('somos veintidós'))).toBe(22)
    expect(primerNumero(normalizar('treinta y cinco'))).toBe(35)
    expect(primerNumero(normalizar('para 4'))).toBe(4)
    expect(numeroEnLetra(31)).toBe('treinta y uno')
  })
})

describe('fechas', () => {
  it.each([
    ['para hoy', '2026-10-13'],
    ['para esta noche', '2026-10-13'],
    ['mañana a las nueve', '2026-10-14'],
    ['pasado mañana', '2026-10-15'],
    ['el viernes', '2026-10-16'],
    ['este sábado por la noche', '2026-10-17'],
    ['el martes', '2026-10-20'],
    ['el jueves de la semana que viene', '2026-10-22'],
    ['el 17', '2026-10-17'],
    ['el día 3', '2026-11-03'],
    ['el diecisiete de octubre', '2026-10-17'],
    ['el 2 de enero', '2027-01-02'],
    ['para el viernes 23', '2026-10-23'],
    ['el 20/10', '2026-10-20'],
    ['dentro de tres días', '2026-10-16'],
  ])('«%s» → %s', (frase, fecha) => {
    expect(leer(frase).fecha).toBe(fecha)
  })

  it('«por la mañana» no es «mañana»', () => {
    expect(leer('el sábado por la mañana').fecha).toBe('2026-10-17')
  })

  it('detecta fechas vagas', () => {
    expect(leer('para el fin de semana').fechaVaga).toBe('el fin de semana')
  })

  it('no confunde horas ni personas con días', () => {
    expect(leer('a las 2 de la tarde').fecha).toBeUndefined()
    expect(leer('mesa para 4 personas').fecha).toBeUndefined()
  })
})

describe('horas', () => {
  it.each([
    ['a las nueve', '21:00'],
    ['a las nueve y media', '21:30'],
    ['a las diez menos cuarto', '21:45'],
    ['a la una', '13:00'],
    ['a las dos y cuarto', '14:15'],
    ['sobre las 21:30', '21:30'],
    ['a las 21h', '21:00'],
    ['a las 9 de la noche', '21:00'],
    ['a las 2 de la tarde', '14:00'],
    ['para comer a las dos', '14:00'],
  ])('«%s» → %s', (frase, hora) => {
    expect(leer(frase).hora).toBe(hora)
  })

  it('respuesta corta cuando se ha preguntado la hora', () => {
    expect(leer('nueve y media', 'hora').hora).toBe('21:30')
    expect(leer('a las dos', 'hora').hora).toBe('14:00')
  })

  it('detecta el turno', () => {
    expect(leer('queremos cenar').turno).toBe('cena')
    expect(leer('para comer el domingo').turno).toBe('comida')
  })

  it('escribe horas para leer y para chat', () => {
    expect(horaHablada('21:30')).toBe('las nueve y media')
    expect(horaHablada('13:00')).toBe('la una')
    expect(horaHablada('21:45')).toBe('las diez menos cuarto')
    expect(aLaHora('14:15')).toBe('a las *14:15*') // en chat, en cifras y en negrita
  })
})

describe('personas', () => {
  it.each([
    ['somos cuatro', 4],
    ['mesa para dos', 2],
    ['para 6 personas', 6],
    ['seremos tres', 3],
    ['cuatro adultos y dos niños', 6],
    ['mi mujer y yo', 2],
    ['solo yo', 1],
    ['quería reservar para cinco el viernes a las nueve', 5],
  ])('«%s» → %i', (frase, n) => {
    expect(leer(frase).personas).toBe(n)
  })

  it('no confunde la hora con los comensales', () => {
    expect(leer('a las dos').personas).toBeUndefined()
    expect(leer('para el viernes a las nueve').personas).toBeUndefined()
  })

  it('número suelto si se ha preguntado cuántos son', () => {
    expect(leer('cuatro', 'personas').personas).toBe(4)
    expect(leer('pues seremos 7', 'personas').personas).toBe(7)
  })
})

describe('nombre', () => {
  it.each([
    ['me llamo Ane Etxeberria', 'Ane Etxeberria'],
    ['a nombre de María José', 'María José'],
    ['soy Jon y quería reservar', 'Jon'],
    ['mi nombre es lucía martín', 'Lucía Martín'],
  ])('«%s» → %s', (frase, nombre) => {
    expect(leer(frase).nombre).toBe(nombre)
  })

  it('respuesta suelta cuando se ha pedido el nombre', () => {
    expect(leer('Iker', 'nombre').nombre).toBe('Iker')
    expect(leer('pues a nombre de Nerea Ibarra', 'nombre').nombre).toBe('Nerea Ibarra')
  })

  it('no toma frases como nombres', () => {
    expect(leer('soy celíaco').nombre).toBeUndefined()
    expect(leer('soy de Bilbao').nombre).toBeUndefined()
    expect(leer('sí', 'nombre').nombre).toBeUndefined()
  })
})

describe('sí, no y elecciones', () => {
  it('afirma y niega', () => {
    expect(leer('sí, perfecto').afirma).toBe(true)
    expect(leer('vale').afirma).toBe(true)
    expect(leer('me viene bien').afirma).toBe(true)
    expect(leer('no, mejor otro día').afirma).toBe(false)
  })
  it('ordinales', () => {
    expect(leer('la primera').ordinal).toBe(0)
    expect(leer('la segunda opción').ordinal).toBe(1)
  })
})

describe('código de reserva', () => {
  it('lee códigos dictados', () => {
    expect(leer('erre equis siete ka dos', 'codigo').codigo).toBe('RX7K2')
    expect(leer('R X 7 K 2', 'codigo').codigo).toBe('RX7K2')
    expect(leer('el código es rx7k2').codigo).toBe('RX7K2')
  })
  it('deletrea códigos', () => {
    expect(deletrear('RX7K2')).toBe('R, X, siete, K, dos')
  })
})

describe('intenciones', () => {
  const tiene = (frase: string, i: string) => leer(frase).intenciones.has(i as never)
  it('reservar, cancelar y cambiar', () => {
    expect(tiene('quería reservar una mesa', 'reservar')).toBe(true)
    expect(tiene('queremos ir a cenar el sábado', 'reservar')).toBe(true)
    expect(tiene('quiero cancelar mi reserva', 'cancelar')).toBe(true)
    expect(tiene('quiero cancelar mi reserva', 'reservar')).toBe(false)
    expect(tiene('al final no vamos a poder ir', 'cancelar')).toBe(true)
    expect(tiene('quería cambiar la hora de la reserva', 'modificar')).toBe(true)
  })
  it('preguntas', () => {
    expect(tiene('¿a qué hora abrís?', 'horario')).toBe(true)
    expect(tiene('¿dónde estáis?', 'direccion')).toBe(true)
    expect(tiene('¿tenéis parking?', 'faq')).toBe(true)
    expect(leer('¿se puede ir con perro?').faq?.tema).toBe('mascotas')
    expect(tiene('¿qué tenéis en la carta?', 'carta')).toBe(true)
    expect(leer('¿tenéis cosas para celíacos?').dieta).toBe('sin gluten')
    expect(tiene('¿me pasas con el encargado?', 'persona')).toBe(true)
    expect(tiene('nada más, gracias, adiós', 'despedida')).toBe(true)
  })
  it('anota alergias y peticiones', () => {
    expect(leer('uno de nosotros es celíaco').notas).toContain('Celiaquía')
    expect(leer('venimos con un bebé, necesitamos trona').notas).toContain('Necesita trona')
    expect(leer('es su cumpleaños').notas).toContain('Celebración / cumpleaños')
    expect(leer('¿tenéis trona?').notas).toEqual([])
  })
})

describe('fechas habladas', () => {
  it('relativas a hoy', () => {
    expect(fechaHablada('2026-10-13', HOY)).toBe('hoy')
    expect(fechaHablada('2026-10-14', HOY)).toBe('mañana')
    expect(fechaHablada('2026-10-16', HOY)).toBe('el viernes 16')
    expect(fechaHablada('2026-11-03', HOY)).toBe('el martes 3 de noviembre')
  })
})

describe('números sueltos', () => {
  it('«uno es celíaco» no es una hora aunque se espere una', () => {
    expect(analizar('uno es celíaco', { hoy: HOY, esperando: 'alternativa', negocio: TABERNA_LUNA }).hora).toBeUndefined()
    expect(analizar('diez y media', { hoy: HOY, esperando: 'alternativa', negocio: TABERNA_LUNA }).hora).toBe('22:30')
  })
})

describe('nombres con siglas', () => {
  it('respeta las siglas en mayúsculas', () => {
    expect(analizar('Prueba DHT', { hoy: HOY, esperando: 'nombre', negocio: TABERNA_LUNA }).nombre).toBe('Prueba DHT')
    expect(analizar('ane etxeberria', { hoy: HOY, esperando: 'nombre', negocio: TABERNA_LUNA }).nombre).toBe('Ane Etxeberria')
  })
})
