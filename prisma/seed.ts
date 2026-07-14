import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

// Seed do usuário único — specs/03-auth.md.
// Cria o usuário a partir de SEED_EMAIL/SEED_PASSWORD/SEED_NAME do .env
// SOMENTE se ele ainda não existir (nunca sobrescreve senha trocada na UI).
// Também garante a linha única de Settings (id = 1) com os defaults do
// schema, sem sobrescrever configurações já existentes.

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;
  const name = process.env.SEED_NAME;

  if (!email || !password || !name) {
    throw new Error(
      "SEED_EMAIL, SEED_PASSWORD e SEED_NAME precisam estar definidos no .env",
    );
  }

  if (password.length < 8) {
    throw new Error("SEED_PASSWORD deve ter ao menos 8 caracteres");
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(
      `[seed] Usuário "${email}" já existe — mantendo senha atual (não sobrescrita).`,
    );
  } else {
    const passwordHash = await hashPassword(password);
    await prisma.user.create({
      data: { email, passwordHash, name },
    });
    console.log(`[seed] Usuário "${email}" criado.`);
  }

  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  console.log("[seed] Settings (id=1) garantido com defaults.");
}

main()
  .catch((err) => {
    console.error("[seed] Falhou:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
