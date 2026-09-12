# Seoul Trip Map

An interactive, real-geography map of Seoul for planning a September–October 2026 trip.
Static site, no framework, no build step, no API keys — MapLibre GL JS + free OpenStreetMap
vector tiles (via [OpenFreeMap](https://openfreemap.org)).

## Run it locally

Any static file server works (browsers block `fetch()` from a bare `file://` page):

```
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy

Push to GitHub and turn on **GitHub Pages** (Settings → Pages → Deploy from branch → `main` / root).
No build step, no secrets, nothing else to configure.

## Files

```
index.html            page shell, loads MapLibre + app.js
style.css
app.js                 map init, filters, district panel, list view, visited-tracking
data/
  districts.geojson    real Seoul gu (district) boundaries, from southkorea/seoul-maps
  places.json           every picked place: schema below
```

## `places.json` schema

```json
{
  "meta": { "generated": "...", "source": "...", "geocoder": "OSM Nominatim" },
  "districts": { "<district-id>": { "blurb": "...", "also": ["place name", "..."] } },
  "neighborhoods": { "<hood-id>": { "district": "<district-id>", "name": "...", "kr": "..." } },
  "places": [
    {
      "id": "arario",
      "name": "Arario Museum in Space",
      "name_kr": "아라리오뮤지엄 인 스페이스",
      "district": "jongno",
      "neighborhood": null,
      "category": "museum",
      "lat": 37.579, "lng": 126.985,
      "hours": "10:00–19:00, closed Mon",
      "note": "free text, sourcing/rationale",
      "unverified": false,
      "geocode_query": "아라리오뮤지엄 인 스페이스"
    }
  ]
}
```

- `district` must match a `properties.id` in `districts.geojson` (lowercase, no `-gu`, e.g. `jongno`, `yongsan`).
- `neighborhood` is optional — only set for places inside one of the walkable focus-areas in `neighborhoods`
  (Ikseon-dong, Bukchon, Itaewon, Hannam-dong, etc.). Leave `null` for anything else.
- `category` is one of: `food, cafe, market, museum, park, view, shop, temple, landmark, night`
  (see `CAT` at the top of `app.js` for colors/labels — add a new key there if you add a category).
- `unverified: true` means the name/hours/address hasn't been confirmed on the ground yet — shows a
  **VERIFY** flag in the panel.
- `lat`/`lng` are `null` when geocoding failed — see below.

## The migration, and its one real gap: **coordinates**

Every place here was migrated out of the old hand-illustrated v1 artifact and
`Korea-Trip/seoul-itinerary-master.md`, then geocoded against **OSM Nominatim** (free, keyless,
Seoul-bounded search).

**34 of 67 resolved cleanly. 33 did not** — and the miss pattern is informative, not random:
almost everything that missed is a small, specific cafe/bar/restaurant (Achrolism, Barou, Atta, 232,
Cafe Nagwonjang, Haus Nowhere, …), while every landmark, palace, temple, market and park resolved on
the first try. **OpenStreetMap's coverage of small Korean businesses is thin** — this is the same
underlying reason your own research flagged Google Maps as "functionally crippled in Korea": neither
Google nor OSM has what Naver Map / Kakao Map have for hyper-local venues. Free/keyless geocoding
was never going to close that gap; it's a real, expected limitation of this approach, not a bug.

**These 33 show up in the app already** — open a district panel and anything with a **`NO PIN YET`**
tag has no coordinates, so it's listed but not plotted on the map. To fix one:

1. Look the place up on **Naver Map** or **Kakao Map** (both linked from `note` when a query hints at it).
2. Right-click the pin → copy coordinates, or read them out of the share URL.
3. Add `"lat"` / `"lng"` to that place's entry in `data/places.json` — no code changes needed, it
   picks it up on next page load.

That's the actual remaining work on the data side. Everything else (schema, boundaries, app) is done.

## Adding a new place

Add an object to `places.places` in `data/places.json` with a unique `id`. If it needs coordinates,
either look it up on Naver/Kakao Map by hand, or re-run a Nominatim query:

```
https://nominatim.openstreetmap.org/search?q=<query>&format=jsonv2&limit=1&viewbox=126.734,37.413,127.269,37.715&bounded=1
```

(Respect Nominatim's usage policy: no more than 1 request/second, and set a real `User-Agent`.)

## 3D

The building-extrusion layer (`3d-buildings` in `app.js`) is free and keyless — real OSM building
footprints and heights, extruded via MapLibre's `fill-extrusion`. Toggle with the **3D** button
(visible from zoom 14+, so zoom into a district first). No Google Maps Platform account, API key,
or billing is used anywhere in this project. If a handful of hero landmarks (Lotte World Tower,
N Seoul Tower, Gyeongbokgung) ever get a **Google Photorealistic 3D Tiles** treatment on top of this,
that's a separate, opt-in layer — see the trip vault's planning notes for the tradeoffs before adding it.

## Scope

Seoul only for now. Jeju and Busan are out of scope for this build — v1's illustrated versions of
those still exist as a separate Claude Artifact if needed for reference.
