# Map, walking directions and crowd sensing

This note covers the visitor map, the precision "guide me" screen, crowd sensing from
visitors' devices, and how the assistant answers "how do I get to X?".

## 1. Calibrated venue coordinates

Boulevard World zone coordinates (`x` east, `y` south, 1 unit = 0.62 m, origin at the venue's
calibration anchor, `Venue.geoAnchorLat/geoAnchorLng`) were re-traced from Esri World Imagery and checked
against the official park map. The old values placed several zones on the wrong side of the
lagoon (for example Saudi Arabia in the east, Warzone in the north). The same values are in
`data/boulevard_world.json`, `app/data/boulevard_world.json`, `app/data/venues/boulevard_world.json`
and `app/data/catalog.ts`.

The lagoon outline and centre live in `packages/engine/src/venue-geometry.ts`. Both the
illustrated map and the seed's walkway graph use it.

### Landmarks from the official park map

Some landmarks are placed from the official park map. The map is converted to venue units
with an affine fit on 15 calibrated zones (mean error about 40 m).

- **Gates** (`BOULEVARD_GATES`): KSA 1, the main gate facing Boulevard City (key `main-entrance`),
  and KSA 2, the north gate on Imam Saud Rd. The seed publishes both as `ENTRANCE` route nodes.
- **Cable car** (`BOULEVARD_CABLE_CAR`): runs from Boulevard City (outside the park, south-west)
  over Levant and Morocco to the Greece side. It is drawn with cabins; tapping a station opens
  the sheet.
- `data/sources/boulevard_world_2026_zone_positions.json` gives coordinates for every zone name
  in the 2026 catalog CSV, with source and confidence. Seven new pavilions are `null` until the
  26-27 map is available: Yemen, Portugal, Uzbekistan, Netherlands, Kuwait, Korea and Indonesia.

## 2. Walkway graph (seed)

`packages/engine/src/walkway-graph.ts` builds the published `RouteEdge`s deterministically:

- Zones connect to their natural neighbours (Gabriel graph).
- No walkway may cross the lagoon. Zones standing in the water (the Italy island, the pier
  head) get bridges to their two nearest shore zones.
- Ring links by bearing are added only if the graph would otherwise be disconnected.
- Gates and services attach to their two nearest zones.
- Distance in metres = straight line × 0.62 × 1.2 detour factor. Walking speed comes from the catalog.

`npm run db:seed` replaces the old sequential chain (`node i → i+1`), which produced walks
such as Italy → Planet = 36 min. That walk is now 11 min.

## 3. Visitor map (`app/components/VenueGeoMap.tsx`)

- **مخطط (default):** original vector art (`park-map-art.ts`): lagoon, promenade, themed zone
  districts with icons and labels, services. No copyrighted map image is shipped.
- **قمر صناعي:** Esri imagery with the same labels and routes. They line up because the
  coordinates are calibrated.
- **الزحام layer:** walkways turn orange or red when the average of their two zones is busy
  or packed, like road traffic. Packed zones get a pulsing halo and a «زحمة» badge.
- Tap a zone or service to see its crowd level and a **دلّني عليها** button.
- **Locate:** shows the visitor's live blue dot (accuracy circle, heading cone). The first use
  asks whether to also share the visitor's zone anonymously for crowd sensing.

Crowd levels come from `GET /api/v1/events/{slug}/crowd`, polled every 15 s. Each zone's
source is, in priority order: an active operator override → device/sensor measurement →
operator → simulated snapshot → model estimate (`site.crowd`).

## 4. Crowd sensing from devices (`app/lib/presence.ts`)

Same idea as road-traffic sensing in Google Maps: count active devices per area.

1. With consent, the map posts `POST /api/v1/events/{slug}/presence {latitude, longitude, accuracy}`
   at most every 20 s.
2. The server snaps the fix to the nearest open walkway node (within 120 m, accuracy ≤ 75 m)
   and keeps **only the zone**. The coordinates are never stored.
3. It upserts one `PresencePing` per device, keyed by a salted SHA-256 of event + session + current
   hour. The key cannot be linked to the session and rotates hourly. Pings expire after 5 min.
4. It counts devices per zone, then:
   - estimated people = devices ÷ `WANEES_PRESENCE_SAMPLE_RATE`
   - level = people ÷ zone capacity (default `WANEES_PRESENCE_DEFAULT_CAPACITY`)
   - zones with fewer than `WANEES_PRESENCE_MIN_DEVICES` devices are never published.
5. Each reading is written as a `CrowdSnapshot` with source `SENSOR` and a 3-minute expiry.

To opt out, `DELETE /presence` removes the device's ping immediately.
`npm run db:cleanup` also deletes expired pings.

Local demo: `npm run presence:sim -- boulevard-world-demo africa=30 egypt=14`.
Clear it with `npm run presence:sim -- boulevard-world-demo --clear`.

## 5. Directions and the precision guide

- `GET /directions` now prefers calmer walkways. An edge into a busy zone costs ×1.4 and an
  edge into a packed zone ×2.5, except the destination itself. The reported minutes are
  still the real walking minutes.
- Each step carries `crowdLevel` / `crowded`. The response has `crowdAware`. Pass
  `avoidCrowds=false` to disable it.
- **دلّني** asks for location, routes from the visitor's real position, and opens
  `PrecisionGuide`, an AirTag-style screen:
  - a large arrow turns with the device compass (`deviceorientation`; iOS asks permission);
  - the remaining distance counts down in metres;
  - the screen turns green when the visitor faces the right way;
  - warnings show for crowded zones on the route.
- Live guidance is a **venue setting** (`Venue.liveGuidance`), not a code constant. It needs a
  calibration (anchor, metres per unit, rotation) and is switched on or off from the organizer
  catalog page, section «التوجيه وGPS». `/map` and `/directions` return `navigation` and
  `demoRoute = !liveGuidance`.
- A fix is used when its accuracy is ≤ 150 m; between 75 and 150 m the route is marked
  approximate. A fix more than 120 m from every walkway node counts as outside the venue.
  Only the snapped node id leaves the phone; exact GPS stays on the device.
- When the venue's accuracy is `APPROXIMATE` (Boulevard World is traced from imagery), the guide
  and the directions sheet say «المسار تقريبي، اتبع لوحات الموقع أيضًا».
- Outside the venue (or without GPS, or with live guidance off), the route is computed from the
  visitor's start point and a **simulated walk** is offered so the guide can be demoed anywhere.

### Popular times and the place sheet

Tapping a zone or service opens a bottom sheet inside the map card. Unlike a map popup, it
is never clipped and survives the 15 s crowd refresh. The sheet shows:

- the current crowd level and its source: device sensing, operations team, or estimate;
- a **أوقات الذروة** bar chart with one bar per opening hour, from `GET /crowd` → `zones[].hourly`
  (`app/lib/crowd-forecast.ts`). The current hour uses the live reading;
- the quietest upcoming hour;
- a **دلّني عليها** button.

### Turn-by-turn and re-routing

- `app/lib/maneuvers.ts` derives manoeuvres from the path geometry: the turn angle at each node
  is classified as straight, slight, normal or sharp, or a U-turn, and the last node is the
  arrival. Labels are the step names. It also gives distance along the path and distance from
  the path.
- The guide screen shows the next instruction («بعد ٦٠ م لف يمين عند منطقة مصر»). The 🔈 button
  speaks each new instruction once (Web Speech API, `ar-SA`), plus a final "arrived" announcement.
- **Live GPS:** after two consecutive fixes more than max(35 m, GPS accuracy) away from the path,
  the guide recalculates from the nearest node, at most once every 20 s.
- **Simulated walk:** the phone is assumed to face the walking direction, so the arrow turns
  before each manoeuvre and the screen goes green when aligned.

## 6. Assistant directions

For location intents («كيف أروح لـ…», «وديني…», «وين الإسعاف»), the assistant:

1. resolves the target (route node, zone, or activity);
2. estimates the visitor's position (last started stop → start point → zone nearest the gate);
3. computes a crowd-aware walk with `walkingBrief` (`app/lib/walking-brief.ts`).

The reply includes `directions` (minutes, via zones, crowded zones avoided). The chat shows a
**🧭 دلّني الآن** button. The model only phrases the answer; minutes and zones come from
the graph.
