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
  "districts": { "<district-id>": { "blurb": "...", "also": ["place name", "..."], "side": "buk" } },
  "neighborhoods": { "<hood-id>": { "district": "<district-id>", "name": "...", "kr": "...", "color": "#hex" } },
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
      "sourced_from_video": false,
      "geocode_query": "아라리오뮤지엄 인 스페이스"
    }
  ]
}
```

- `district` must match a `properties.id` in `districts.geojson` (lowercase, no `-gu`, e.g. `jongno`, `yongsan`).
- `districts[id].side` is `"buk"` (north of the Han) or `"nam"` (south) — drives the list view's two
  section headers. Every district must have one.
- `neighborhood` is optional — only set for places inside one of the walkable focus-areas in `neighborhoods`
  (Ikseon-dong, Bukchon, Itaewon, Hannam-dong, etc.). Leave `null` for anything else.
- `neighborhoods[hid].color` is the hex the app borders that neighborhood's places/chips with — pick
  something legible against both `--surface` values in `style.css`.
- `category` is stored as one of 10 raw values: `food, cafe, market, museum, park, view, shop, temple,
  landmark, night` — but **shown/colored/filtered as 8**: `temple` and `landmark` visually fold into
  `view` ("Viewpoint") via `foldCat()` in `app.js`. This is deliberate (matches the original v1 map's
  category set) — don't be surprised a temple's dot isn't teal; the raw value is preserved in the data
  either way, so re-splitting the fold later doesn't require touching `places.json`.
- `unverified: true` means the name/hours/address hasn't been confirmed on the ground yet — shows a
  **"check name/hours"** flag.
- `sourced_from_video: true` means this place came from a raw video-transcript extract and was never
  independently confirmed as real/findable — shows a **video** flag. A district where *every* place has
  this flag set gets its own **video** badge in the list view (see `counts()` in `app.js`).
- `lat`/`lng` are `null` when geocoding failed — see below.

`districts.geojson`'s per-feature `properties` additionally carry a `"tint": 0-4` — which of the five
pastel land colors (`--land-a` … `--land-e` in `style.css`) that district is filled with on the map.
This lives on the boundary geometry, not in `places.json`, because MapLibre paint expressions can only
read properties off the source feature they're painting.

## The migration, and its one real gap: **coordinates**

Every place here was migrated out of the old hand-illustrated v1 artifact and
`Korea-Trip/seoul-itinerary-master.md`, then geocoded against **OSM Nominatim** (free, keyless,
Seoul-bounded search).

**38 of 67 resolved cleanly (after a relaxed retry pass). 29 did not** — and the miss pattern is informative, not random:
almost everything that missed is a small, specific cafe/bar/restaurant (Achrolism, Barou, Atta, 232,
Cafe Nagwonjang, Haus Nowhere, …), while every landmark, palace, temple, market and park resolved on
the first try. **OpenStreetMap's coverage of small Korean businesses is thin** — this is the same
underlying reason your own research flagged Google Maps as "functionally crippled in Korea": neither
Google nor OSM has what Naver Map / Kakao Map have for hyper-local venues. Free/keyless geocoding
was never going to close that gap; it's a real, expected limitation of this approach, not a bug.

**These 29 show up in the app already** — open a district panel and anything with a **`NO PIN YET`**
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

The OpenFreeMap `liberty` style already ships its own building-extrusion layer (`building-3d` —
real OSM building footprints and heights via MapLibre's `fill-extrusion`, free and keyless). It's
visible by default from zoom 14+; `app.js` explicitly hides it on load and the **3D** button just
toggles its visibility (plus tilts the camera). No custom duplicate layer, no Google Maps Platform
account, API key, or billing anywhere in this project. If a handful of hero landmarks (Lotte World
Tower, N Seoul Tower, Gyeongbokgung) ever get a **Google Photorealistic 3D Tiles** treatment on top
of this, that's a separate, opt-in layer — see the trip vault's planning notes for the tradeoffs
before adding it.

## The "floating island" crop

The map masks away everything outside Seoul's 25 districts, so Seoul reads as an island on a flat
sea color at any zoom — ported from v1's hand-illustrated look, but built from real geometry. The
technique (`buildSeaMask()` in `app.js`): one GeoJSON `Polygon` whose first ring is a world-covering
rectangle and whose remaining rings are each district's boundary — GeoJSON/MapLibre convention treats
ring 0 as the exterior and everything after it as a hole, so the district shapes become literal holes
in a solid "sea" fill layer, painted above the base map tiles but below this app's own district/place
layers. No turf.js, no geometry library — it's pure ring concatenation, computed client-side from the
already-loaded `districts.geojson`.

## District borders and colors

Each district is filled with one of five pastel tones (`--land-a`…`--land-e`, keyed by its `tint`
property in `districts.geojson`) and outlined with a crisp, always-visible seam line (`--seam`,
white) that thickens and recolors (`--accent`) when a district is selected — so adjacent districts
read as distinct color blocks even before you click anything, matching v1's cartographic style
rather than a subtle transit-map outline.

## "No streets" declutter mode

The **No streets** button hides every road/rail/highway-label/generic-POI/place-name/building/
admin-boundary layer from the base style (see `DECLUTTER_HIDE_IDS` in `app.js` — built from the
actual OpenFreeMap `liberty` layer list, ~79 ids), leaving only background/water/landcover/landuse
fills plus this app's own district fills/borders and place pins. The Han River's water fill and line
geometry stay visible as a geographic anchor even in this mode — only its text label disappears.

## List view

The **List view** button renders every place grouped by district (itself grouped "North of the Han" /
"South of the Han" by each district's `side`), with the same multi-select category filter as the map
header — click a chip to narrow the list to that type, click it again or "All types" to clear. This
is a direct port of v1's list screen: district order, hood color-coding, the district-level **video**
badge (shown when every place in that district has `sourced_from_video: true`), and the "Nothing
picked — near these if you pass through" footer for districts with zero placed picks, listing their
`also` backlog as jump-links. Expand all / Collapse all reset every district row's open state; it's
not persisted between renders (matches v1 — re-filtering re-renders the whole list fresh).

## Scope

Seoul only for now. Jeju and Busan are out of scope for this build — v1's illustrated versions of
those still exist as a separate Claude Artifact if needed for reference.
