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
index.html            Seoul page shell, loads MapLibre + app.js
jeju.html              Jeju page shell, loads jeju.js — no MapLibre, see "Jeju" below
busan.html             Busan page shell, loads MapLibre + busan.js; its own <style> block
                       overrides the shared purple-vs-pink palette tokens — see "Busan" below
style.css              shared by every region
app.js                 Seoul: map init, filters, district panel, list view, visited-tracking
jeju.js                Jeju: static-image pins, filters, list view, visited-tracking
busan.js               Busan: map init (real districts, no hoods), filters, list view
data/
  districts.geojson    real Seoul gu (district) boundaries, from southkorea/seoul-maps
  places.json           every picked Seoul place: schema below
  seoul-outline.json     Seoul's exact outer boundary — see "floating island" below
  neighborhoods.geojson  real walkable focus-area boundaries — see "Neighborhood zones" below
  jeju-places.json       every picked Jeju place — see "Jeju" below for its (simpler) schema
  busan-districts.geojson  real Busan gu/gun boundaries — see "Busan" below for how these
                           were built (unioned from real administrative-dong data, not traced)
  busan-places.json       every picked Busan place + all 16 district blurbs — see "Busan" below
assets/
  photos/               Seoul place thumbnails recovered from the v1 artifact — see "Photos" below
  jeju/                 Jeju's island art + water-tile texture + place thumbnails, also
                        recovered from v1 — see "Jeju" below
  busan/photos/          Busan place thumbnails, from Korea-Trip/busan-pics/ — see "Busan" below
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

## The migration, now closed out: **coordinates**

Every place here was migrated out of the old hand-illustrated v1 artifact and
`Korea-Trip/seoul-itinerary-master.md`, then geocoded against **OSM Nominatim** (free, keyless,
Seoul-bounded search) — 38 of 67 resolved cleanly that way, 29 did not.

A follow-up pass used the **Google Maps Scraper (Apify)** to fill in most of the OSM gap (64 of
67), and fill in hours where Google had them. The last 3 — **Kkokkio Jangjak-gui, Jura Optique,
Franc** — weren't a coverage gap so much as a name-collision problem: every automated search kept
matching a *different, wrong* branch or business (a Gangnam/Myeongdong chicken-chain branch
instead of the Ikseon-dong one it was assumed to be, a Seongsu optics branch instead of the
Bukchon one it was assumed to be, an unrelated restaurant entirely) rather than turning up nothing.
**All 67 now have coordinates** — those last 3 came from looking each one up directly on Naver
Map, which also corrected two of the original assumptions: Kkokkio really is in Yeoksam-dong,
Gangnam-gu (not paired with Jongsamyook in the Ikseon-dong "quadrant"), and Jura Optique really is
in Seongsu-dong (not the Bukchon commerce street) — Naver's result for Jura Optique matched what
Google had already found independently, which is what made that correction trustworthy rather than
just another guess.

If a *new* place ever needs coordinates:

1. Look the place up on **Naver Map** or **Kakao Map** (both linked from `note` when a query hints at it).
2. Right-click the pin → copy coordinates, or read them out of the share URL.
3. Add `"lat"` / `"lng"` to that place's entry in `data/places.json` — no code changes needed, it
   picks it up on next page load. Anything still missing them shows a **`NO PIN YET`** tag in its
   district panel.

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

## The "floating island" crop (v2 — DOM-level, not a map layer)

The first version of this masked Seoul geographically (a giant world-spanning polygon with a hole
per district, rendered as a real MapLibre fill layer). It worked, but caused two problems once
actually used: at very high zoom the huge exterior ring could mis-tessellate against its own
city-scale holes and paint a solid block over part of the view, and its wave-texture pattern was
geographic — meaning it visibly grew and shrank as you zoomed, instead of reading as a fixed
background the way v1's own illustration did.

**Current approach:** `#seaBackground` (`index.html`/`style.css`) is a plain, fixed, full-viewport
`div` sitting *behind* the map — a flat pink background-color plus a repeating wave-pattern
`background-image` (an inline SVG data URI, no external asset — a 34×14px tile with a low-amplitude
curve, tuned tighter/subtler than the first pass to match v1's dense, quiet ripple rather than a
bold loose wave). It never moves, scales, or repaints — it's just CSS. `#map`'s inner canvas layer (specifically `.maplibregl-canvas-container`,
**not** `#map` itself — see note below) gets a CSS `clip-path: polygon(...)` that traces Seoul's
outline in current screen-pixel coordinates, recomputed on every `move`/`resize` event
(`updateMapClip()` in `app.js`). So the interactive map is only ever visible inside Seoul's
silhouette; `#seaBackground` shows through everywhere else, completely unaffected by pan/zoom.

Seoul's outline itself is a **one-time, offline computation**: `data/seoul-outline.json` is the
union of all 25 district polygons (via Shapely's `unary_union`) at **essentially full fidelity —
428 of the raw 430 boundary points**, not a heavily simplified version. No turf.js, no in-browser
geometry library; regenerate it only if `districts.geojson` itself ever changes, by re-running the
union against the new file.

⚠️ **Don't simplify this outline more aggressively than that.** An earlier version used a ~64-point
simplification (fine per-frame cost either way — even 428 points is trivial to re-project every
frame) and it caused visibly ragged, "bleeding" borders: the simplified clip-path edge didn't
exactly coincide with the full-fidelity `district-line` boundary rendered just inside it, so at the
outer edge you'd see slivers of base-map road/label content peeking through the gap between the two
mismatched outlines. Keeping the clip essentially exact (rather than simplified) is what fixed it —
this is a case where "cheap enough to not simplify" was also the correct fix, not just a shortcut.

**Why clip `.maplibregl-canvas-container` and not `#map`:** MapLibre's zoom +/− control is also a
child of `#map`, anchored to a fixed screen corner. Clipping `#map` itself would clip the control
away too, whenever Seoul's silhouette doesn't happen to reach that corner (i.e., most of the time).
Clipping only the inner canvas layer keeps the control always visible and usable.

**A CSS trap worth knowing about if you touch this:** `#seaBackground` must use `z-index: 0` (or
higher), never a *negative* z-index. A negative z-index on a fixed element renders it behind the
page's own `html`/`body` background paint (since `body` doesn't establish its own stacking
context) rather than merely behind `#map` — so with `z-index:-1` the whole background silently
disappeared behind the plain page background instead of showing through the map's clipped-away
areas. `#seaBackground:0` / `#map:1` avoids that pitfall entirely.

## The map doesn't drag — on purpose

`dragPan`/`dragRotate`/`pitchWithRotate`/`touchPitch` are all disabled at construction, and
`map.touchZoomRotate.disableRotation()` drops two-finger rotate while keeping pinch-to-zoom. The
camera only ever moves programmatically now — the scroll wheel, pinch, the zoom +/− control,
clicking a district (`fitBounds`), and **Fit map** (`DEFAULT_VIEW` in `app.js`, resets center/zoom/
pitch/bearing to the initial load values). This matches v1, which read as a fixed illustration you
tap into rather than a freely-draggable map, and sidesteps a real interaction bug that free dragging
would otherwise reintroduce: the fixed `#seaBackground` behind the map has no relationship to
Seoul's real-world coordinates, so letting the island drift arbitrarily far from center via drag
would eventually make the "floating island" framing (built around a specific default view) look
wrong.

## The HUD card

Collapses via the **×** in its corner (`#hudClose`) to a small "Seoul ▾" pill (`#hudReopen`) that
reopens it, matching v1's own collapse/reopen affordance. **3D** / **No streets** stay pill buttons
(they're binary on/off toggles); **Fit map** / **List view** are plain text links (`.txtbtn`, blue,
underline on hover/tap) — matching v1's own visual distinction between a toggle and a navigation
action, and freeing up room for all four controls to share one row. The category filter bar
(`.catbar`) is a fixed 5-column CSS grid rather than an organic `flex-wrap` — with exactly 9 chips
("All types" + 8 categories) that lands as an even 5-over-4 split every time, instead of possibly
stranding a lone chip on its own row depending on viewport width.

## A CSS trap worth knowing about: `font: ... inherit` is invalid

Every custom-sized bit of text in this app (chips, pills, list rows, panel text — 16 rules in
total) is set via the `font` shorthand, e.g. `font:600 12px var(--sans)`. An earlier version wrote
the family part as the literal keyword `inherit` instead (`font:600 12px inherit`), reasoning that
it should just reuse whatever font-family the page already had. **That's invalid CSS** — `inherit`
is only valid as the *sole* value of the whole property, not as one component inside a shorthand —
so the browser silently drops the entire declaration rather than applying part of it. The element
doesn't inherit the intended size/weight at all; it falls back to raw normal-inheritance/UA
defaults (a plain `<span>` lands at the browser's default 16px/400, while a `<button>` — which
doesn't inherit font by default in the UA stylesheet — lands at ~13.3px Arial). This is exactly why
v2's list-view neighborhood pills (and everything else using this pattern) rendered noticeably
bigger than v1: v1 used `font:600 12px var(--sans)` throughout, which is valid. The fix is the
`--sans` custom property at `:root` — reference it in every `font:` shorthand instead of writing
`inherit`. Worth double-checking with `getComputedStyle(el).font` (not just eyeballing a preview)
any time you add a new `font:` shorthand rule here.

## District borders, colors, and labels

Each district is filled with one of five tones from a pink/rose family (`--land-a`…`--land-e`,
keyed by its `tint` property in `districts.geojson`), outlined with a crisp, always-visible seam
line (`--seam`, white) that thickens and recolors (`--accent`) when selected, and labeled with its
own name (`district-label` layer — MapLibre places one label per polygon automatically at an
interior "pole of inaccessibility" point, no manual centroid math needed).

**The whole map-art palette (land tints, sea, seam, labels) is pinned to this light-pink recipe
regardless of system light/dark mode** — it's a branded illustration look matching a specific
reference image, not a UI surface that should adapt to viewer preference, so it's deliberately
*not* read from the `prefers-color-scheme: dark` block (only the UI chrome — panel/button surfaces —
still adapts, for readability). An earlier version tried a separate "dark-mode" land palette and it
came out as muddy desaturated brown/gray rather than a genuine dark pink — pinning to one recipe
sidesteps re-deriving a second palette that has to look right on its own.

**Jongno-gu's label went missing at the default zoom — this was a text-collision bug, not a
missing feature.** Jongno's precomputed anchor point sits deep in the historic downtown core,
which is geographically pinched between three mountain districts (Eunpyeong, Gangbuk, Seongbuk);
at the full-Seoul fitted zoom, its anchor lands only ~40 screen-px from Eunpyeong's, and with a
fixed 13px `text-size` + `text-allow-overlap:false`, that's enough for their text boxes to
overlap — MapLibre drops one label outright rather than render two on top of each other, and
Jongno's lost that fight. No point deep enough inside Jongno's actual polygon to count as a real
interior anchor clears much more separation from *all* its neighbors at once (checked with a
grid search over the polygon in Shapely — the achievable minimum-distance-to-nearest-neighbor
tops out around 40–45px no matter where the anchor sits up there), so nudging the anchor
wouldn't have fixed it. Making `text-size` zoom-dependent — `["interpolate",["linear"],["zoom"],
9,10.5, 11,12, 13,13]` instead of a flat `13` — shrinks the actual collision boxes at the
crowded low zoom where this matters, and grows back to the original size by the time you've
zoomed into one district and overlap stops being a concern.

The base style's generic "Seoul 서울특별시" city label is permanently hidden (`PERMANENT_HIDE_IDS`
in `app.js`) — it used to sit on top of the map at street-level zoom and duplicated what the
district labels already show.

## "No streets" declutter mode

The **No streets** button hides every road/rail/highway-label/generic-POI/place-name/building/
admin-boundary layer from the base style (see `DECLUTTER_HIDE_IDS` in `app.js` — built from the
actual OpenFreeMap `liberty` layer list, ~79 ids), leaving only background/water/landcover/landuse
fills plus this app's own district fills/borders, neighborhood zones and place pins. The Han
River's water fill and line geometry stay visible as a geographic anchor even in this mode — only
its text label disappears.

## Neighborhood zones — real geography, not v1's hand-drawn circles

v1 marked each walkable focus-area (Itaewon, Hannam-dong, Bukchon, …) with a hand-illustrated
oval/circle — fast to draw, but wildly inaccurate: v1's own "Itaewon" circle sprawled across
Itaewon core, Haebangchon *and* Hannam-dong all at once, three genuinely distinct areas lumped
into one blob.

`data/neighborhoods.geojson` replaces that with one real polygon per neighborhood, sourced from
actual **administrative-dong (행정동) boundaries** (via
[vuski/admdongkor](https://github.com/vuski/admdongkor), the same public dataset family this kind
of project would reach for — merged/simplified with shapely where a neighborhood spans more than
one dong, e.g. `itaewon` = 이태원1동 ∪ 이태원2동, `seongsu` = all four 성수*동 dongs). Every mapping
was checked against this app's own real pinned coordinates for that neighborhood before being
committed (a handful of places — `purr`, `hillseuropa`, `cactuscurry`, `hongdaetteok`,
`gangnamthrift` — sit just outside their neighborhood's real polygon; that's the pre-existing
neighborhood *assignment* in `places.json` being looser than the real boundary, not a flaw in the
polygon itself).

**`ikseondong` is the one exception**: no single administrative dong matches its small real
extent — it's a pocket inside the much larger "종로1·2·3·4가동", which also covers
Gwanghwamun/Insadong/the whole Jongno arcade. Using that whole dong would wildly overstate this
neighborhood, so it's hand-traced instead, tight around the real hanok-alley block (Donhwamun-ro /
Supyo-ro / Ujeongguk-ro) and checked against all 5 of its real pinned places. See that feature's
own `properties.source` in the geojson.

Each feature only carries an `id` — color comes from `data.neighborhoods[id].color` (`app.js`
builds a MapLibre `match` expression from it at load time) rather than being duplicated into the
geojson, so the list-view chips, the panel's `hood-block` borders, and the map zones all read
color from the same one place. Rendered as `hood-fill`/`hood-line`/`hood-label` — a translucent
fill, a dashed border, and a small colored label — at a constant opacity like `district-fill`,
deliberately **not** gated behind a zoom threshold: `flyToDistrict()`'s `fitBounds()` lands at a
different zoom for every district depending on its own size, so a fixed cutoff would show zones
reliably for a compact district like Jung-gu and never cross the threshold for a sprawling one
like Eunpyeong.

## List view

The **List view** button renders every place grouped by district (itself grouped "North of the Han" /
"South of the Han" by each district's `side`), with the same multi-select category filter as the map
header — click a chip to narrow the list to that type, click it again or "All types" to clear. This
is a direct port of v1's list screen: district order, hood color-coding, the district-level **video**
badge (shown when every place in that district has `sourced_from_video: true`), and the "Nothing
picked — near these if you pass through" footer for districts with zero placed picks, listing their
`also` backlog as jump-links. Expand all / Collapse all reset every district row's open state; it's
not persisted between renders (matches v1 — re-filtering re-renders the whole list fresh).

## Tapping a map pin — bigger hit target + jump-to-list

Two problems, one feature, added together:

**The visible dot is too small to reliably tap.** `place-points`' circle-radius runs 2.5px at
the full-Seoul zoom up to 8px zoomed into a district — deliberately tiny so dense clusters
(Ikseon-dong, Itaewon) stay readable rather than a solid blob of overlapping dots. Growing the
visible circle to fix tappability would un-fix the readability it was tuned for. Instead,
`place-points-hit` is a second circle layer on the exact same `places` source/coordinates —
radius 11–17px depending on zoom, `circle-opacity: 0` — and it's *that* layer, not the visible
one, that `click`/`mouseenter`/`mouseleave` are bound to. The visible dot always sits at the
center of a much bigger invisible target. `applyCatFilter()` sets the identical filter
expression on both layers in the same call — skipping the hit layer would leave a filtered-out
category's (invisible) tap target still live, so tapping empty-looking map space could pop up a
pin that isn't supposed to be showing.

**Tapping a pin now also pops up a small preview card for that place.** Previously a map tap
only flew the camera in and dropped a popup; an earlier version of this feature then jumped
straight into the full "every place by district" List view, scrolled to that place's row — that
technically worked but felt like overkill for a single tap, and buried the one place you
actually care about inside the whole accordion. `previewPlace(id)` (called from the
`place-points-hit` click handler) instead renders just that place's own row (via `listRow()`,
so it looks identical to its row in the real list) under the same "‹ Map / ×" bar the List view
uses, and — on mobile — sizes the sheet to that one row's actual height (`.panel.preview-mode`
in style.css, overriding the usual 90dvh) rather than the standard half-open bottom sheet, so it
reads as a small peek card at the bottom of the screen instead of a near-full-screen takeover. A
"See all in `<district>`" link inside the card calls `openFullListAt(id)` — the previous
behavior, kept as an escape hatch: opens the full List view, expands just that place's district
`<details>`, `scrollIntoView`s its row to the middle of the panel, and gives it a 1.6s fading
highlight (`.lr.flash`). Two animation frames (`requestAnimationFrame`, nested) separate opening
the `<details>` from scrolling — scrolling in the same tick would measure the row's position
before the browser reflows the newly-revealed content, landing short.

⚠️ **On mobile, forcing the sheet open matters more than it sounds.** `openPanelSheet()` alone
only snaps to the "half" position. `scrollIntoView`'s `block:"center"` centers a target within
the *whole* scrollable sheet, not just whatever fraction of it is currently on-screen — so
without an explicit `sheetTo(0)` (or, for the short preview card, a fresh `sheetSetup()` against
its own shrunk height before that same `sheetTo(0)`), a scrolled-to row can land squarely behind
the folded-away rest of the sheet and the jump looks like it silently did nothing. This was an
actual bug in an earlier version of this feature, not a hypothetical.

## Busan — Seoul's exact engine, real geography, no hand-tracing (`busan.html` / `busan.js`)

Where Jeju deliberately threw out Seoul's whole map engine, Busan reuses it almost line-for-line
— district-fill/line, place-points + the invisible hit layer, district labels, the 3D-buildings
and "Streets On" toggles, the preview card, list view, and the panel/sheet drag mechanics are
copied from `app.js` with only two things actually removed (see below) and everything else
just repointed at Busan's own data and a purple palette. Bugs already fixed in Seoul's version
(tap-target sizing, the sticky-bar/animated-transform touch issue, the Jongno-style label
collision) are already fixed here too, not waiting to be rediscovered.

**Real district boundaries, not v1's hand-traced ones.** v1's own Busan build got its 16 gu/gun
polygons by manually tracing an outline Jake drew by hand and vectorizing it — real effort, and
the actual bottleneck that made v1's Busan the most labor-intensive part of that whole artifact.
This build sources real administrative boundaries instead: `raqoon886/Local_HangJeongDong`'s
`hangjeongdong_부산광역시.geojson` (205 real 행정동/administrative-dong polygons, each tagged
with its own `sggnm` — the gu/gun it belongs to), grouped by that tag and unioned per district
with Shapely (`unary_union`, then a light `simplify(0.0003)` for file size) — the same
aggregate-real-boundaries technique this repo already used once for Seoul's own
`neighborhoods.geojson`. **Saha-gu and Seo-gu came out as real `MultiPolygon`s** (small islands/
inlets genuinely disconnected from the rest of the district) — MapLibre's fill/line layers
handle that natively, no special-casing needed.

**Every place was geocoded from scratch**, not carried over from v1's illustrated pixel
coordinates — `busan-places.json`'s 17 places (migrated from v1's `BUSAN_LOCATIONS`, plus its 16
`BUSAN_DESC` district blurbs) were each looked up via the Google Maps Scraper (Apify), the same
tool and workflow already used for every Seoul-map addition this session. **Every place's
assigned district was then cross-checked by real point-in-polygon test against this build's own
`busan-districts.geojson`** (Shapely `.contains()`), not trusted from Google's own address
string — this caught nothing wrong here (all 17 matched their expected district exactly, one
place — Igidae Coastal Trail — landing a hair outside the simplified coastline and resolving to
the nearest district instead, which was still the right one), but it's the same discipline
already applied to Seoul's own additions (Jura Optique, Kkokkio) where the address string and
the real location didn't agree.

**One place, `workingholiday`, is `unverified: true`.** v1 described it as "right on Haeundae
Beach," but the geocoded result lands in Suyeong-gu (Gwangalli Beach) — a different, adjacent
beach neighborhood. Either a second branch exists or v1's own description was approximate;
flagged rather than guessed at.

**All 17 photos came from `Korea-Trip/busan-pics/`** (already-sourced real photos, not
extracted from v1 this time — unlike Jeju, v1's Busan build never got as far as embedding
per-place thumbnails), center-cropped to the same 300×300 convention as every other photo in
this repo.

**What got dropped versus Seoul, deliberately, not by oversight:**
- **No neighborhoods/hoods layer.** v1's own Busan build was explicitly "base map only for
  now" and never had one either — nothing here has walkable focus-areas researched the way
  Seoul's Ikseon-dong/Itaewon/etc. do yet.
- **No "floating island" clip-path crop.** Seoul's `#seaBackground` + clip-path trick needs a
  single clean outer ring (`seoul-outline.json`); the union of Busan's 16 districts is a real
  `MultiPolygon` with genuine open-water gaps between disconnected pieces (Yeongdo is a true
  island; Gangseo is a river delta) — a single CSS `clip-path: polygon(...)` can't represent
  that, and a proper multi-shape SVG `clipPath` felt like too much machinery for a purely
  decorative crop on this pass. The map just shows real base tiles beyond the district fills
  instead of being masked to a silhouette — worth revisiting later with an SVG clipPath if the
  cropped look is wanted, not a limitation of the underlying data.
- **No north/south list-view split.** Seoul's "North of the Han" / "South of the Han" grouping
  is specific to that river actually bisecting the city in a way locals navigate by; Busan has
  no equivalent natural two-way split, so its list view is one flat list in v1's own
  `BUSAN_LAYOUT` district order instead.

**Own `localStorage` keys** (`busan-map:*`), same reasoning as Jeju's — three regions' worth of
visited-checklist and category-filter state, never colliding, even though today nothing could
run more than one region at once (separate pages, separate JS realms).

## Photos

`assets/photos/` holds real place thumbnails recovered from the old v1 artifact — it had every
photo embedded as inline base64 inside its own JS (a `THUMBS` object mapping place id → data URI,
which is a large part of why that single HTML file was 9.2MB). These were decoded back out to real
image files: **all 67 places matched exactly**, ~2.2MB total, individual files 11–93KB — small
enough to commit as plain files, no LFS or external hosting needed.

Each matching place in `places.json` got an `"img": "assets/photos/<id>.<ext>"` field; `app.js`'s
`photoHTML()` (shared by the district panel and list view) renders that as a real `<img>` when
present, falling back to the plain colored swatch (`.ph`) when it's `null`/missing — so a newly
added place with no photo yet degrades gracefully rather than showing a broken image.

**To add a photo for a new place:** drop an image into `assets/photos/` and set `"img"` on that
place's entry in `places.json` — no code changes needed. Three extra photos came out of the
extraction with no matching place (`euljiro`, `hongdaest`, `seongsuarea` — likely intended as
neighborhood-level header images, not per-place ones); they're sitting in the folder unused if you
want to wire them into `neighborhoods[hid]` later.

## Scope

Seoul (`index.html`), Jeju (`jeju.html`), Busan (`busan.html`) — all three built now. A top-right
region switcher (`.regiontabs` — plain links between pages, not a client-side tab swap) sits on
every page.

## Jeju — a static illustrated island, not a real map (`jeju.html` / `jeju.js`)

Deliberately the simplest thing in this repo. No MapLibre, no tiles, no pan/zoom camera, no
district system — v1's own design note for this region was *"one island, not a set of
districts,"* and that's exactly what got kept. The art (`assets/jeju/jeju-bg.png`, 1342×1172)
is shown at a fixed "fit the viewport" size via plain `object-fit:contain`; every place is an
absolutely-positioned `<button class="jpin">` at a `%`-position on that image
(`data/jeju-places.json`'s `xPct`/`yPct`), computed against the image's own *rendered* rect —
`imageRect()` in `jeju.js` — not the wider container, so a letterboxed edge never hosts a pin.
`layoutJejuPins()`/`imageRect()` re-run on resize; there's no camera state to persist, unlike
Seoul's `fitSeoul()`.

**Everything — art, water-tile texture, and all 20 place thumbnails — was recovered from the v1
artifact**, the same decode-a-`data:`-URI-back-to-a-real-file move already used once for
Seoul's own v1→v2 photo migration (see "Photos" above). `JEJU_BG`, `JEJU_WATER_TILE`, and
`JEJU_THUMBS` were all embedded as base64 inside v1's single giant HTML file; a one-off Python
script (not kept in this repo) located each `data:image/...;base64,...` literal by variable
name and wrote it back out to `assets/jeju/`. All 20 of `JEJU_LOCATIONS`' places had a matching
thumbnail — nothing needed re-sourcing.

**Two kinds of pin, matching v1's own distinction:** 12 "landmark" pins (`dot:false`) are just an
invisible hit-circle sized to roughly cover the icon the art already drew (`hitRadius`, an
image-space size that scales with the art via `imageRect().scale` rather than staying a fixed
screen size) — v1's reasoning holds here too: "tap anywhere on Hallasan," not one exact pixel.
8 "dot" pins (small cafés) get an actual small visible marker, since nothing is pre-drawn for
those in the art.

**One place (`jeongbang`, Jeongbang Falls) is `"unverified": true`** — v1 flagged it `guess:true`,
meaning the artwork has a second waterfall icon near Cheonjiyeon with no confirmed identity;
carried the flag forward rather than resolving a guess I have no better basis for than v1 did.

**Categories were assigned during migration, not carried from v1** — v1's Jeju never had a
category/color system at all (just the landmark/dot split above). Each of the 20 places got
mapped onto the *same 8-category taxonomy* `app.js` already uses (food/cafe/market/museum/park/
view/shop/night), so the category filter chips and colors behave identically to Seoul's.

**`jeju.js` duplicates a handful of small pieces from `app.js`** (the CAT taxonomy, `photoHTML`,
`naverUrl`/`kakaoUrl`, the panel/sheet drag mechanics, list-row rendering) rather than importing
a shared module. This is deliberate for now, not an oversight: Jeju is the first non-Seoul
region built, and it isn't clear yet which pieces are truly generic versus Seoul-specific until
Busan (a *second* real-MapLibre region, unlike Jeju) exists to compare against. Refactor into a
real `shared.js` once there are three regions' worth of evidence, not two guesses — re-doing a
premature abstraction is cheaper than un-doing one that turned out wrong. `visited`/category-filter
state uses its own `localStorage` keys (`jeju-map:*`, vs. Seoul's `seoul-map:*`) so the two
regions' checklists and filters never collide, even though right now nothing could actually run
both at once (separate pages, separate JS realms) — the separate keys are about the *data*
outliving that, not a live collision risk today.
