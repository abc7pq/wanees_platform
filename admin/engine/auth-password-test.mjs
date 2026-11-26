import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../lib/password.ts";

const encoded = hashPassword("correct horse battery staple");
assert.equal(verifyPassword("correct horse battery staple", encoded), true);
assert.equal(verifyPassword("wrong password", encoded), false);
assert.equal(verifyPassword("correct horse battery staple", null), false);

console.log("organizer password hashing tests passed");
