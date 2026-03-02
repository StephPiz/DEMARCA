const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const holding = await prisma.holdingCompany.upsert({
    where: { name: "TAWA Co" },
    update: {},
    create: { name: "TAWA Co" },
  });

  const store = await prisma.store.upsert({
    where: { holdingId_code: { holdingId: holding.id, code: "DEMARCA" } },
    update: { name: "DEMARCA", status: "active" },
    create: {
      holdingId: holding.id,
      code: "DEMARCA",
      name: "DEMARCA",
      status: "active",
    },
  });

  console.log("✅ Seed OK");
  console.log("Holding:", holding.name);
  console.log("Store:", store.name);
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });