import "dotenv/config";
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const { Pool } = pg;

const getDatabaseUrl = () => {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return rawUrl;

  try {
    const url = new URL(rawUrl);
    if (url.searchParams.get("sslmode") === "no-verify" && !url.searchParams.has("sslaccept")) {
      url.searchParams.set("sslaccept", "accept_invalid_certs");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
};

const pool = new Pool({
  connectionString: getDatabaseUrl(),
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: false,
  },
});
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
})

export default prisma
