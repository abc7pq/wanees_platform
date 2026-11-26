// One pool per process, sized by WANEES_DB_POOL_MAX (CI ran four servers into "too many clients already").
import assert from "node:assert/strict";
const { databasePoolMax, DEFAULT_POOL_MAX, prismaPgArgs, SHARED_PRISMA_KEY } = await import("./database.ts");

assert.equal(DEFAULT_POOL_MAX, 20);
assert.equal(databasePoolMax(undefined), 20);
assert.equal(databasePoolMax(""), 20);
assert.equal(databasePoolMax("8"), 8);
assert.equal(databasePoolMax("100"), 100);
for (const bad of ["0", "-3", "101", "7.5", "ten", "1e9"]) assert.equal(databasePoolMax(bad), 20, bad);
assert.equal(SHARED_PRISMA_KEY, "__waneesPrisma");

const [config, options] = prismaPgArgs("postgresql://u@localhost:5432/w?schema=wanees_final", { max: 8 });
assert.equal(config.max, 8);
assert.equal(config.options, "-c search_path=wanees_final");
assert.deepEqual(options, { schema: "wanees_final" });
assert.equal(prismaPgArgs("postgresql://u@localhost:5432/w?schema=public")[1], undefined);
console.log("database pool: all assertions passed");
