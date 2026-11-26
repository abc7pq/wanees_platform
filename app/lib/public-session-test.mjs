import assert from "node:assert/strict";
import { readVisitorToken } from "./public-session.ts";

const malformed = new Request("http://localhost/api", {
  headers: { cookie: "wanees_visitor_session=%E0%A4%A" },
});
assert.equal(readVisitorToken(malformed), null);

const valid = new Request("http://localhost/api", {
  headers: { cookie: "wanees_visitor_session=visitor-token" },
});
assert.equal(readVisitorToken(valid), "visitor-token");

console.log("malformed visitor cookie handling passed");
