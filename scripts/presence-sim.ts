// محاكاة استشعار الزحام من الأجهزة (للعرض المحلي فقط):
// تضيف أجهزة وهمية مجهولة في مناطق محددة ثم تشغّل نفس مسار التجميع الذي يستخدمه /presence.
// التشغيل:  node --experimental-strip-types scripts/presence-sim.ts [eventSlug] zone=devices ...
// مثال:     node --experimental-strip-types scripts/presence-sim.ts boulevard-world-demo africa=30 egypt=14 pier=4
// المسح:    node --experimental-strip-types scripts/presence-sim.ts boulevard-world-demo --clear
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadProjectEnv } from "./load-project-env.ts";
import { prismaPgArgs } from "../packages/contracts/src/database.ts";
import { presenceDeviceKey, recordPresence, refreshPresenceCrowd } from "../app/lib/presence.ts";

loadProjectEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (process.env.NODE_ENV === "production") throw new Error("presence-sim is a local demo tool; refusing to run in production.");

const prisma = new PrismaClient({ adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL)) });
const [eventSlug = "boulevard-world-demo", ...rest] = process.argv.slice(2);

try {
  const event = await prisma.event.findFirst({ where: { slug: eventSlug }, select: { id: true, publishedCatalogVersionId: true } });
  if (!event?.publishedCatalogVersionId) throw new Error(`Event ${eventSlug} has no published catalog.`);
  if (rest.includes("--clear")) {
    const [pings, snapshots] = await Promise.all([
      prisma.presencePing.deleteMany({ where: { eventId: event.id } }),
      prisma.crowdSnapshot.deleteMany({ where: { eventId: event.id, source: "SENSOR", eventUpdateId: null } }),
    ]);
    console.log(JSON.stringify({ clearedPings: pings.count, clearedSensorSnapshots: snapshots.count }));
  } else {
    const now = new Date();
    for (const pair of rest) {
      const [zoneKey, countText] = pair.split("=");
      const count = Number(countText);
      if (!zoneKey || !Number.isInteger(count) || count < 0 || count > 500) throw new Error(`Bad argument "${pair}" (expected zone=devices).`);
      const zone = await prisma.zone.findFirst({ where: { catalogVersionId: event.publishedCatalogVersionId, stableKey: zoneKey }, select: { id: true } });
      if (!zone) throw new Error(`Unknown zone "${zoneKey}".`);
      for (let index = 0; index < count; index += 1) {
        await recordPresence(prisma, { eventId: event.id, zoneId: zone.id, deviceKey: presenceDeviceKey("simulated", event.id, randomUUID(), now), now });
      }
    }
    const written = await refreshPresenceCrowd(prisma, { eventId: event.id, catalogVersionId: event.publishedCatalogVersionId, now });
    console.log(JSON.stringify({ sensorReadings: written }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
