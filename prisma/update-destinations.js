import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const updates = [
  {
    id: 1n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Atenas (El Pireo)',
    highlights: ['Crucero al atardecer en Santorini', 'Visita a la Acrópolis', 'Exploración de Mykonos'],
    incluye: ['Alojamiento a bordo', 'Todas las comidas', 'Excursiones guiadas'],
  },
  {
    id: 2n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Malé',
    highlights: ['Bungalow sobre el agua', 'Snorkel en laguna privada', 'Puesta de sol desde terraza', 'Spa de lujo'],
    incluye: ['Bungalow de lujo', 'Pensión completa', 'Equipo de snorkel'],
  },
  {
    id: 3n,
    duracion_tipica: '8 noches',
    puerto_principal: 'Bergen',
    highlights: ['Aurora boreal desde cubierta panorámica', 'Crucero por el Fiordo Geiranger', 'Excursión a Tromsø'],
    incluye: ['Alojamiento a bordo', 'Guía ártico especializado', 'Cenas temáticas nórdicas'],
  },
  {
    id: 4n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Castries',
    highlights: ['Senderismo a los Pitons volcánicos', 'Playa de arena negra', 'Buceo en arrecifes de coral'],
    incluye: ['Alojamiento a bordo', 'Desayuno y cena', 'Excursión a los Pitons'],
  },
  {
    id: 5n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Bridgetown',
    highlights: ['Degustación en destilería de ron Mount Gay', 'Playa de Crane Beach', 'Snorkel en arrecife de coral'],
    incluye: ['Alojamiento a bordo', 'Pensión completa', 'Tour de destilería'],
  },
  {
    id: 6n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Cozumel',
    highlights: ['Ruinas mayas de Tulum', 'Buceo en el arrecife de Cozumel', 'Cenote El Eden', 'Parque Xcaret'],
    incluye: ['Alojamiento a bordo', 'Todas las comidas', 'Entrada a Xcaret'],
  },
  {
    id: 7n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Seward',
    highlights: ['Avistamiento de glaciares desde el mar', 'Safari de vida silvestre', 'Kayak en Glacier Bay'],
    incluye: ['Alojamiento a bordo', 'Guía de naturaleza', 'Kayak guiado'],
  },
  {
    id: 8n,
    duracion_tipica: '8 noches',
    puerto_principal: 'Papeete',
    highlights: ['Bungalow sobre la laguna de Bora Bora', 'Buceo con tiburones de arrecife', 'Excursión en catamaran'],
    incluye: ['Bungalow sobre el agua', 'Pensión completa', 'Buceo y snorkel'],
  },
  {
    id: 9n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Cairns',
    highlights: ['Buceo en la Gran Barrera de Coral', 'Vuelo en helicóptero sobre el arrecife', 'Visita a Kuranda'],
    incluye: ['Alojamiento a bordo', 'Equipo de buceo', 'Vuelo en helicóptero'],
  },
  {
    id: 10n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Abu Dhabi',
    highlights: ['Visita a la Mezquita Sheikh Zayed', 'Safari en dunas del desierto', 'Tour gastronómico árabe'],
    incluye: ['Alojamiento a bordo', 'Pensión completa', 'Safari en desierto'],
  },
  {
    id: 11n,
    duracion_tipica: '8 noches',
    puerto_principal: 'Yokohama',
    highlights: ['Temporada de cerezos en flor', 'Visita al Monte Fuji', 'Barrio histórico de Asakusa', 'Cocina kaiseki'],
    incluye: ['Alojamiento a bordo', 'Desayuno japonés', 'Tren bala Shinkansen'],
  },
  {
    id: 12n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Auckland',
    highlights: ['Visita a un Marae tradicional maorí', 'Haka y danzas culturales', 'Geotermia en Rotorua', 'Bahía de las Islas'],
    incluye: ['Alojamiento a bordo', 'Guía cultural maorí', 'Desayuno incluido'],
  },
  {
    id: 13n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Singapur',
    highlights: ['Gardens by the Bay', 'Satay Street y hawker centers', 'Espectáculo nocturno Marina Bay Sands'],
    incluye: ['Alojamiento a bordo', 'Tour gastronómico', 'Entrada Gardens by the Bay'],
  },
  {
    id: 16n,
    duracion_tipica: '7 noches',
    puerto_principal: 'Sitka',
    highlights: ['Avistamiento de osos pardos en Katmai', 'Ballenas jorobadas en Frederick Sound', 'Ornitología: águilas calvas'],
    incluye: ['Alojamiento a bordo', 'Guía de fauna', 'Binoculares profesionales'],
  },
  {
    id: 17n,
    duracion_tipica: '5 noches',
    puerto_principal: 'Skagway',
    highlights: ['Tren White Pass & Yukon Route', 'Sendero Chilkoot', 'Historia de la Fiebre del Oro'],
    incluye: ['Paseo en tren panorámico', 'Visita a museos', 'Almuerzo tradicional'],
  },
];

async function main() {
  for (const u of updates) {
    const { id, ...data } = u;

    // Build partial update — only set fields if they're missing or empty
    const existing = await prisma.destinos.findUnique({
      where: { id },
      select: { duracion_tipica: true, puerto_principal: true, highlights: true, incluye: true },
    });

    if (!existing) {
      console.log(`⚠ ID ${id} not found, skipping`);
      continue;
    }

    const patch = {};
    if (!existing.duracion_tipica) patch.duracion_tipica = data.duracion_tipica;
    if (!existing.puerto_principal) patch.puerto_principal = data.puerto_principal;
    if (!existing.highlights?.length) patch.highlights = data.highlights;
    if (!existing.incluye?.length) patch.incluye = data.incluye;

    if (Object.keys(patch).length === 0) {
      console.log(`✓ ID ${id} already complete`);
      continue;
    }

    await prisma.destinos.update({ where: { id }, data: patch });
    console.log(`✅ Updated ID ${id}:`, Object.keys(patch).join(', '));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
