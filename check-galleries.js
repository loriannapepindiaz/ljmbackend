import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const all = await prisma.destinos.findMany({
  select: { id: true, titulo: true, galeria_urls: true },
  orderBy: { id: 'asc' },
});

for (const d of all) {
  console.log(`\n[${d.id}] ${d.titulo} — ${d.galeria_urls.length} fotos`);
  d.galeria_urls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
}

await prisma.$disconnect();
