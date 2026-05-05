import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Fetch all destinos so we can see exact titles and current gallery counts
  const all = await prisma.destinos.findMany({
    select: { id: true, titulo: true, galeria_urls: true },
    orderBy: { id: 'asc' },
  });

  console.log('Current state:');
  for (const d of all) {
    console.log(`  [${d.id}] ${d.titulo} → ${d.galeria_urls.length} photos`);
  }

  const fixes = [];

  for (const d of all) {
    const count = d.galeria_urls.length;
    if (count === 3) continue;

    if (count > 3) {
      // Trim to first 3
      fixes.push({
        id: d.id,
        titulo: d.titulo,
        from: count,
        to: 3,
        urls: d.galeria_urls.slice(0, 3),
      });
    } else if (count < 3) {
      // Need to add photos — pick thematic Unsplash based on title keywords
      const extra = pickExtra(d.titulo, d.galeria_urls);
      fixes.push({
        id: d.id,
        titulo: d.titulo,
        from: count,
        to: count + extra.length,
        urls: [...d.galeria_urls, ...extra].slice(0, 3),
      });
    }
  }

  if (fixes.length === 0) {
    console.log('\nAll destinations already have exactly 3 photos. Nothing to do.');
    return;
  }

  console.log('\nApplying fixes:');
  for (const fix of fixes) {
    console.log(`  [${fix.id}] ${fix.titulo}: ${fix.from} → ${fix.urls.length} photos`);
    await prisma.destinos.update({
      where: { id: fix.id },
      data: { galeria_urls: fix.urls },
    });
  }

  console.log('\nDone. Verifying:');
  const updated = await prisma.destinos.findMany({
    select: { id: true, titulo: true, galeria_urls: true },
    orderBy: { id: 'asc' },
  });
  for (const d of updated) {
    const ok = d.galeria_urls.length === 3 ? '✓' : '✗';
    console.log(`  ${ok} [${d.id}] ${d.titulo} → ${d.galeria_urls.length} photos`);
  }
}

function pickExtra(titulo, existing) {
  const t = titulo.toLowerCase();
  const extras = [];

  if (t.includes('silvestre') || t.includes('vida silvestre') || t.includes('wildlife')) {
    extras.push(
      'https://images.unsplash.com/photo-1474511320723-9a56873867b5?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1564349683136-77e08dba1ef7?w=800&auto=format&fit=crop',
    );
  } else if (t.includes('singapur') || t.includes('singapore')) {
    extras.push(
      'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1508964942454-1a56651d54ac?w=800&auto=format&fit=crop',
    );
  } else {
    // Generic beautiful ocean/travel photo as fallback
    extras.push(
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop',
    );
  }

  // Only return as many as needed (3 - existing.length)
  const needed = 3 - existing.length;
  return extras.slice(0, needed);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
