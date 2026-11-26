# WANEES on Hetzner

- Visitor: `https://wanees.win/` (Boulevard World: `/demo`).
- Organizer: `https://admin.wanees.win/`; normal database-backed login only.
- Both apps run as the unprivileged `wanees` user under systemd. The backends and PostgreSQL only listen on loopback. Caddy handles HTTPS for each exact hostname; wildcard DNS does not imply wildcard TLS.

## Provision the host

Use Node.js 26 and PostgreSQL 16+ with a dedicated, non-superuser database role and a database owned by that role. Install Node and npm at `/opt/wanees-node/bin/` or adapt the service paths. Create a dedicated `wanees` system user and `/srv/wanees-runtime/releases/`. The first deployment was validated on PostgreSQL 18.

Place the unit files from `systemd/` in `/etc/systemd/system/`. Put the two site files from `caddy/` under `/etc/caddy/sites.d/` and import them from `/etc/caddy/Caddyfile` with `import sites.d/*.caddy`. Validate before reloading. Only do this after both localhost services have passed health checks.

Keep `/etc/wanees/` root-only (`0700`) and its files root-owned (`0600`). Configure:

- `runtime.env`: `DATABASE_URL`, a random `WANEES_RATE_LIMIT_SALT`, `WANEES_TRUSTED_PROXY_HOPS=1` (only Caddy is in front of the apps), `NEXT_PUBLIC_APP_URL=https://wanees.win`, `ADMIN_APP_URL=https://admin.wanees.win`, `WANEES_ORGANIZATION_SLUG=wanees-demo`, and `NEXT_TELEMETRY_DISABLED=1`.
- `app.env`: `PORT=3100`.
- `admin.env`: `PORT=3200`. Optionally `WANEES_PUBLIC_DEMO_EMAIL` and `WANEES_PUBLIC_DEMO_PASSWORD` to show a demo login on the public login page; it is shown only for a read-only (`VIEWER`-only) account (see `docs/OPERATIONS_RUNBOOK.md`).
- A separate bootstrap secret for `WANEES_OWNER_PASSWORD`. Supply it only to the initial seed, not the web processes. Leave `WANEES_LOCAL_DEMO`, `ADMIN_TOKEN`, and all clock overrides unset. `OPENAI_API_KEY` is optional; the deterministic assistant works without it, and setting it also enables the live voice call (OpenAI Realtime).
- Optional visitor-side features (all off unless configured): Web Push (`WANEES_VAPID_*`, generate with `npm run push:keys`) and visitor registration with SMS verification (`WANEES_FEATURE_VISITOR_REGISTRATION=true`, `WANEES_SMS_PROVIDER=twilio` and the `TWILIO_*` values). Never set `WANEES_SMS_PROVIDER=test`, `WANEES_TEST_OTP_CODE` or `WANEES_ALLOW_TEST_SMS` on a server. See `.env.example`.

Set up encrypted backups and verify an off-host restore for real event data. See [Operations Runbook](../../docs/OPERATIONS_RUNBOOK.md#backups-and-restore-rehearsal). No backup keys, database credentials, or organizer credentials belong in Git.

## Release and verify

1. Make project changes on a focused branch in a development checkout, submit a pull request to `main`, and deploy only an approved SHA with passing CI from `origin/main`. Never hot-edit a running release or force-push the default branch.
2. Export the approved commit with `git archive` into its own `/srv/wanees-runtime/releases/<sha>` directory. As `wanees`, using a clean environment with a writable `HOME` and `TMPDIR`, run `npm ci` separately at the root, `app/` and `admin/`, then `npm run db:generate`. Build with `npm --prefix app run build` and `npm --prefix admin run build` sequentially, passing the public URLs at build time. Do not pass database, owner, or provider secrets into the frontend build.
3. With a verified backup before changes to an existing database, run `npm run db:deploy` using the protected runtime environment. Run `npm run db:seed` with the separate owner secret **only on a fresh demo database**. Run `npm run db:smoke`.
4. Make the completed release root-owned except `app/.next/cache` and `admin/.next/cache`, which must be writable by `wanees`. Point `/srv/wanees-runtime/current` at the release (replace the symlink atomically on updates). Run `systemctl daemon-reload` and enable `wanees-web@app.service`, `wanees-web@admin.service`, and `wanees-retention.timer` on first install; restart both web units on later releases.
5. Check `/api/health` on ports 3100 and 3200 and on both HTTPS hostnames; confirm PostgreSQL and the published catalog are healthy. Verify the visitor demo and organizer login, an organizer API returns `401` without a session, the local demo login (`WANEES_LOCAL_DEMO`) is disabled, both web listeners remain loopback-only, and each certificate covers the matching hostname. Run destructive integration fixtures only against isolated data, not the public catalog.
6. Record the deployed commit and verification. Keep the last known-good release for rollback; switch the `current` symlink back and restart only if its code is compatible with the applied migrations. If it is not, follow the database recovery plan rather than rolling back only the app.
