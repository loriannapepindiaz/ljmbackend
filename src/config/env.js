import "dotenv/config";

const requiredEnv = ["DATABASE_URL", "JWT_SECRET"];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT || process.env.APP_PORT || 3000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
};
