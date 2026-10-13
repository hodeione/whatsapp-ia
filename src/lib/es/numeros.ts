/**
 * Números dichos en voz alta: «veintidós», «treinta y cinco», «21»…
 * Todo trabaja sobre texto normalizado (minúsculas y sin tildes).
 */

/** Minúsculas, sin tildes ni signos, espacios simples. Conserva «:» y «/» de horas y fechas. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!,;"«»()]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
}
const DECENAS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60 }

/**
 * Lee un número a partir de la palabra `i`. Devuelve el valor y cuántas
 * palabras ocupa, o null si ahí no empieza un número.
 */
export function leerNumero(palabras: string[], i: number): { valor: number; largo: number } | null {
  const p = palabras[i]
  if (p === undefined) return null
  if (/^\d{1,3}$/.test(p)) return { valor: Number(p), largo: 1 }
  if (p in UNIDADES) return { valor: UNIDADES[p]!, largo: 1 }
  if (p in DECENAS) {
    const base = DECENAS[p]!
    if (palabras[i + 1] === 'y') {
      const u = palabras[i + 2]
      if (u !== undefined && u in UNIDADES && UNIDADES[u]! >= 1 && UNIDADES[u]! <= 9) return { valor: base + UNIDADES[u]!, largo: 3 }
    }
    return { valor: base, largo: 1 }
  }
  return null
}

/** El primer número que aparezca en el texto (normalizado). */
export function primerNumero(texto: string): number | null {
  const palabras = texto.split(' ')
  for (let i = 0; i < palabras.length; i++) {
    const n = leerNumero(palabras, i)
    if (n) return n.valor
  }
  return null
}

const DECIR_UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
]

/** 31 → «treinta y uno». Para leer cifras en voz alta sin depender del sintetizador. */
export function numeroEnLetra(n: number): string {
  if (n < 30) return DECIR_UNIDADES[n] ?? String(n)
  if (n < 70) {
    const d = ['treinta', 'cuarenta', 'cincuenta', 'sesenta'][Math.floor(n / 10) - 3]!
    return n % 10 ? `${d} y ${DECIR_UNIDADES[n % 10]}` : d
  }
  return String(n)
}
