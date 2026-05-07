import prisma from './prismaClient.js';

async function fixSequence() {
  const result = await prisma.$queryRaw`
    SELECT setval(
      pg_get_serial_sequence('"EMPLEADO"', 'id_empleado'),
      COALESCE((SELECT MAX(id_empleado) FROM "EMPLEADO"), 0) + 1,
      false
    ) AS next_val;
  `;

  console.log('Sequence reset. Next id_empleado will be:', result[0].next_val.toString());
  await prisma.$disconnect();
}

fixSequence().catch((err) => {
  console.error('Error resetting sequence:', err.message);
  process.exit(1);
});
