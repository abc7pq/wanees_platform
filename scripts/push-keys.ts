// Prints a fresh VAPID key pair for lock-screen nudges. Put the values in the deployment's secret store
// (or app/.env.local for local development); never commit them. Rotating the keys means every device
// has to opt in again.
import { generateVapidKeys } from "../app/lib/web-push.ts";

const keys = generateVapidKeys();
console.log(`WANEES_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`WANEES_VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("WANEES_VAPID_SUBJECT=mailto:ops@your-domain.example");
