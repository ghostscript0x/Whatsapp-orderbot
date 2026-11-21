import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * Demo data: one owner, one business ("Mama's Kitchen"), 2 categories, 5 products.
 * Idempotent: re-running updates the owner's password and leaves existing menu rows alone.
 */
const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@example.com";
const DEMO_SLUG = "mamas-kitchen";

const MENU: { category: string; sortOrder: number; products: { name: string; description: string; priceKobo: number }[] }[] = [
  {
    category: "Mains",
    sortOrder: 0,
    products: [
      { name: "Jollof Rice & Chicken", description: "Smoky party jollof with a grilled chicken thigh and fried plantain.", priceKobo: 350000 },
      { name: "Egusi Soup & Pounded Yam", description: "Melon seed soup with assorted meat, served with pounded yam.", priceKobo: 420000 },
      { name: "Fried Rice & Turkey", description: "Vegetable fried rice with peppered turkey.", priceKobo: 400000 },
    ],
  },
  {
    category: "Drinks",
    sortOrder: 1,
    products: [
      { name: "Chapman", description: "Classic fruity Chapman, 50cl.", priceKobo: 150000 },
      { name: "Zobo", description: "Chilled hibiscus drink with ginger and pineapple, 50cl.", priceKobo: 80000 },
    ],
  },
];

async function main() {
  const fromEnv = process.env.SEED_PASSWORD;
  const password = fromEnv || "demo12345";
  const passwordHash = await hash(password);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: { email: DEMO_EMAIL, name: "Demo Owner", passwordHash },
    update: { passwordHash },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_SLUG },
    create: { name: "Mama's Kitchen", slug: DEMO_SLUG },
    update: {},
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    create: { userId: user.id, tenantId: tenant.id, role: "OWNER" },
    update: {},
  });

  await prisma.botSettings.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      botName: "Ada",
      tone: "warm, friendly and concise",
      greeting: "Hi! Welcome to Mama's Kitchen. What would you like to eat today?",
      businessHours: {
        mon: [{ open: "09:00", close: "21:00" }],
        tue: [{ open: "09:00", close: "21:00" }],
        wed: [{ open: "09:00", close: "21:00" }],
        thu: [{ open: "09:00", close: "21:00" }],
        fri: [{ open: "09:00", close: "22:00" }],
        sat: [{ open: "10:00", close: "22:00" }],
        sun: [{ open: "12:00", close: "20:00" }],
      },
      deliveryFeeKobo: 100000,
      deliveryAreas: "Lekki, Victoria Island, Ikoyi, Ajah",
      paymentInstructions: "Pay on delivery by cash or bank transfer to the rider.",
      faq: "Portions serve one adult. We can make food less spicy on request.",
      // Left empty on purpose: set your own number in Settings so alerts don't go to a stranger.
      ownerAlertPhone: null,
    },
    update: {},
  });

  for (const section of MENU) {
    const category = await prisma.category.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: section.category } },
      create: { tenantId: tenant.id, name: section.category, sortOrder: section.sortOrder },
      update: {},
    });
    for (const [i, p] of section.products.entries()) {
      const exists = await prisma.product.findFirst({ where: { tenantId: tenant.id, name: p.name }, select: { id: true } });
      if (exists) continue;
      await prisma.product.create({ data: { ...p, tenantId: tenant.id, categoryId: category.id, sortOrder: i } });
    }
  }

  console.log(`Seeded "${tenant.name}". Log in as ${DEMO_EMAIL} / ${fromEnv ? "(SEED_PASSWORD)" : password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
