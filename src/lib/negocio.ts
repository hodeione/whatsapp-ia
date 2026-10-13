/**
 * Datos del negocio que la recepcionista necesita para atender llamadas.
 * La demo usa Taberna Luna, el restaurante de hodeione/reservas-n8n, con la
 * misma configuración, mesas y carta que su web.
 */

export type Turno = 'comida' | 'cena'

export interface Mesa {
  id: string
  nombre: string
  zona: string
  plazas: number
  /** Mínimo de comensales para darla (no se da una mesa de 6 a una pareja). */
  min: number
}

export interface Plato {
  nombre: string
  precio: number
  categoria: string
  alergenos: string[]
  etiquetas: string[]
}

export interface Faq {
  tema: string
  /** Raíces que delatan la pregunta en una frase sin tildes ni mayúsculas. */
  claves: string[]
  respuesta: string
}

export interface Negocio {
  nombre: string
  /** Nombre con el que se presenta la recepcionista. */
  asistente: string
  descripcion: string
  direccion: string
  telefono: string
  zonaHoraria: string
  /** Horas a las que se puede llegar, por turno. */
  horas: Record<Turno, string[]>
  /** Minutos que ocupa una mesa. */
  duracion: Record<Turno, number>
  /** Días cerrados (1 = lunes … 7 = domingo). */
  cerrado: number[]
  /** Fechas AAAA-MM-DD sin servicio. */
  vacaciones: string[]
  /** Máximo de comensales que pueden llegar en la misma franja. */
  franja: number
  antelacionMin: number
  diasMax: number
  maxPersonas: number
  mesas: Mesa[]
  carta: Plato[]
  faq: Faq[]
  /** Enlace a la ficha de Google Maps (cómo llegar). */
  mapa?: string
  /** Coordenadas, para mandar la ubicación por WhatsApp. */
  lat?: number
  lng?: number
  /** Enlace para dejar una reseña en Google. */
  resena?: string
}

export const ALERGENOS: Record<string, string> = {
  gluten: 'gluten',
  crustaceos: 'crustáceos',
  huevo: 'huevo',
  pescado: 'pescado',
  cacahuetes: 'cacahuetes',
  soja: 'soja',
  lacteos: 'lácteos',
  frutos_cascara: 'frutos de cáscara',
  apio: 'apio',
  mostaza: 'mostaza',
  sesamo: 'sésamo',
  sulfitos: 'sulfitos',
  altramuces: 'altramuces',
  moluscos: 'moluscos',
}

export const TABERNA_LUNA: Negocio = {
  nombre: 'Taberna Luna',
  asistente: 'Luna',
  descripcion: 'Cocina de mercado, brasa y pintxos de autor en el Casco Viejo de Bilbao desde 1998.',
  direccion: 'Calle Somera 12, 48005 Bilbao',
  telefono: '944 12 34 56',
  zonaHoraria: 'Europe/Madrid',
  mapa: 'https://www.google.com/maps/search/?api=1&query=Calle+Somera+12+48005+Bilbao',
  lat: 43.2566,
  lng: -2.9229,
  resena: 'https://search.google.com/local/writereview?placeid=TABERNA_LUNA_DEMO',
  horas: {
    comida: ['13:00', '13:30', '14:00', '14:30', '15:00'],
    cena: ['20:00', '20:30', '21:00', '21:30', '22:00'],
  },
  duracion: { comida: 90, cena: 120 },
  cerrado: [1],
  vacaciones: [],
  franja: 16,
  antelacionMin: 60,
  diasMax: 60,
  maxPersonas: 10,
  mesas: [
    { id: 's1', nombre: '1', zona: 'Salón', plazas: 2, min: 1 },
    { id: 's2', nombre: '2', zona: 'Salón', plazas: 2, min: 1 },
    { id: 's3', nombre: '3', zona: 'Salón', plazas: 4, min: 2 },
    { id: 's4', nombre: '4', zona: 'Salón', plazas: 4, min: 2 },
    { id: 's5', nombre: '5', zona: 'Salón', plazas: 6, min: 4 },
    { id: 's6', nombre: '6', zona: 'Salón', plazas: 4, min: 2 },
    { id: 's7', nombre: '7', zona: 'Salón', plazas: 4, min: 2 },
    { id: 's8', nombre: '8', zona: 'Salón', plazas: 10, min: 6 },
    { id: 's9', nombre: '9', zona: 'Salón', plazas: 2, min: 1 },
    { id: 't1', nombre: 'T1', zona: 'Terraza', plazas: 2, min: 1 },
    { id: 't2', nombre: 'T2', zona: 'Terraza', plazas: 2, min: 1 },
    { id: 't3', nombre: 'T3', zona: 'Terraza', plazas: 4, min: 2 },
    { id: 't4', nombre: 'T4', zona: 'Terraza', plazas: 4, min: 2 },
    { id: 't5', nombre: 'T5', zona: 'Terraza', plazas: 6, min: 4 },
  ],
  carta: [
    { nombre: 'Jamón ibérico y queso Idiazabal', precio: 24, categoria: 'Para picar', alergenos: ['lacteos', 'gluten'], etiquetas: [] },
    { nombre: 'Ostras con limón', precio: 18, categoria: 'Para picar', alergenos: ['moluscos', 'sulfitos'], etiquetas: ['sin gluten'] },
    { nombre: 'Tortilla de patata jugosa', precio: 14, categoria: 'Para picar', alergenos: ['huevo'], etiquetas: ['vegetariano', 'sin gluten'] },
    { nombre: 'Tosta de salmón ahumado', precio: 11, categoria: 'Para picar', alergenos: ['gluten', 'pescado', 'lacteos'], etiquetas: [] },
    { nombre: 'Ensalada de la huerta', precio: 10, categoria: 'Para picar', alergenos: ['huevo', 'mostaza'], etiquetas: ['vegetariano', 'sin gluten'] },
    { nombre: 'Melón, aguacate y jamón', precio: 13, categoria: 'Para picar', alergenos: [], etiquetas: ['sin gluten'] },
    { nombre: 'Pulpo a la brasa', precio: 22, categoria: 'Del mar', alergenos: ['moluscos'], etiquetas: ['sin gluten'] },
    { nombre: 'Arroz negro con carabineros', precio: 21, categoria: 'Del mar', alergenos: ['crustaceos', 'moluscos', 'pescado', 'huevo'], etiquetas: ['sin gluten'] },
    { nombre: 'Lubina salvaje a la espalda', precio: 24, categoria: 'Del mar', alergenos: ['pescado'], etiquetas: ['sin gluten'] },
    { nombre: 'Salmón con crema de calabaza', precio: 19, categoria: 'Del mar', alergenos: ['pescado', 'lacteos'], etiquetas: ['sin gluten'] },
    { nombre: 'Chuletón de vaca madurada', precio: 58, categoria: 'De la tierra', alergenos: [], etiquetas: ['sin gluten'] },
    { nombre: 'Cordero lechal asado', precio: 26, categoria: 'De la tierra', alergenos: ['sulfitos'], etiquetas: ['sin gluten'] },
    { nombre: 'Steak tartar', precio: 21, categoria: 'De la tierra', alergenos: ['huevo', 'mostaza', 'gluten', 'sulfitos'], etiquetas: [] },
    { nombre: 'Tarta de queso La Luna', precio: 7, categoria: 'Postres', alergenos: ['lacteos', 'huevo', 'gluten'], etiquetas: ['vegetariano'] },
    { nombre: 'Tarta de chocolate fundente', precio: 7, categoria: 'Postres', alergenos: ['lacteos', 'huevo', 'gluten'], etiquetas: ['vegetariano'] },
    { nombre: 'Tarta de higos y frambuesas', precio: 7.5, categoria: 'Postres', alergenos: ['gluten', 'huevo', 'lacteos', 'frutos_cascara'], etiquetas: ['vegetariano'] },
    { nombre: 'Tartaleta de limón merengada', precio: 6, categoria: 'Postres', alergenos: ['gluten', 'huevo', 'lacteos'], etiquetas: ['vegetariano'] },
    { nombre: 'Txakoli de Getaria (copa)', precio: 4, categoria: 'Bebidas', alergenos: ['sulfitos'], etiquetas: ['vegano', 'sin gluten'] },
    { nombre: 'Rioja crianza (botella)', precio: 24, categoria: 'Bebidas', alergenos: ['sulfitos'], etiquetas: ['vegano', 'sin gluten'] },
  ],
  faq: [
    {
      tema: 'aparcamiento',
      claves: ['aparca', 'parking', 'coche', 'estaciona'],
      respuesta: 'Estamos en el Casco Viejo, que es peatonal. El parking más cercano es el del Mercado de La Ribera, a tres minutos andando.',
    },
    {
      tema: 'terraza',
      claves: ['terraza', 'fuera', 'exterior'],
      respuesta: 'Sí, tenemos terraza con cinco mesas. Se asigna según disponibilidad y, si llueve, les pasamos dentro.',
    },
    {
      tema: 'mascotas',
      claves: ['perro', 'mascota', 'perrit', 'gato'],
      respuesta: 'Las mascotas son bienvenidas en la terraza. Dentro solo admitimos perros de asistencia.',
    },
    {
      tema: 'niños',
      claves: ['trona', 'nino', 'carrito', 'bebe', 'crio'],
      respuesta: 'Sí, tenemos tronas y espacio para carritos. Si me dice que vienen niños, lo dejo anotado en la reserva.',
    },
    {
      tema: 'accesibilidad',
      claves: ['silla de ruedas', 'accesib', 'escalon', 'movilidad'],
      respuesta: 'El local está a pie de calle, sin escalones, y el baño está adaptado.',
    },
    {
      tema: 'pago',
      claves: ['tarjeta', 'pagar', 'bizum', 'efectivo', 'pago'],
      respuesta: 'Se puede pagar con tarjeta, efectivo o Bizum.',
    },
    {
      tema: 'precio',
      claves: ['precio medio', 'cuanto cuesta', 'cuanto sale', 'caro', 'ticket medio', 'por persona'],
      respuesta: 'El precio medio está entre 35 y 45 euros por persona, con bebida.',
    },
    {
      tema: 'menú del día',
      claves: ['menu del dia', 'menu de mediodia', 'menu degustacion'],
      respuesta: 'No tenemos menú del día: trabajamos a la carta con producto de mercado. Al mediodía hay siempre un plato del día fuera de carta.',
    },
  ],
}
