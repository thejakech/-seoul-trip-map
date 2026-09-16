"use strict";

/* ---------- category taxonomy (matches v1 exactly: 8 shown categories, temple/landmark/area
   fold into "view" for color/filter purposes — the raw place.category value is left untouched
   in the data, folding happens only at render/filter time via foldCat()) ---------- */
var CAT = {
  food:{label:"Restaurant", color:"#F1A0AC"}, cafe:{label:"Cafe", color:"#F0C58C"},
  market:{label:"Market", color:"#ECD37E"}, museum:{label:"Museum", color:"#ABB8E4"},
  park:{label:"Park", color:"#A6D8BE"}, view:{label:"Viewpoint", color:"#9FCBDF"},
  shop:{label:"Shop", color:"#E0AAC8"}, night:{label:"Nightlife", color:"#BE9AD1"}
};
var CAT_ORDER = ["food","cafe","market","museum","park","view","shop","night"];
function foldCat(t){ return (t==="temple"||t==="landmark"||t==="area") ? "view" : t; }
function catColor(t){ return CAT[foldCat(t)].color; }
function catLabel(t){ return CAT[foldCat(t)].label; }

/* ---------- fixed district order (v1's LAYOUT insertion order — do NOT derive this from
   Object.keys(data.districts), the JSON's own key order does not match) ---------- */
var ALL_IDS = ["eunpyeong","jongno","jung","yongsan","seongdong","gwangjin","seongbuk",
  "dongdaemun","jungnang","seodaemun","mapo","gangbuk","dobong","nowon","yeongdeungpo",
  "dongjak","gwanak","seocho","gangnam","songpa","gangdong","gangseo","yangcheon",
  "guro","geumcheon"];

/* ---------- precomputed label anchor points (pole of inaccessibility, i.e. the point deepest
   inside each polygon) for every district and neighborhood, computed once offline on each
   feature's FULL geometry. MapLibre can place a symbol automatically from a polygon source
   ("symbol-placement":"point"), but it does that placement PER TILE on the geometry as clipped
   to that tile — a district/neighborhood polygon spanning more than one tile at a given zoom
   then gets one label placed independently in each tile fragment, i.e. duplicate labels for the
   same feature (visible e.g. on Dongdaemun-gu once zoomed in far enough to cross a tile
   boundary). Using a single precomputed Point per feature, on its own point source, sidesteps
   tile-splitting entirely: a point is never split into fragments, so it can only ever place
   one label. See scratch2/polylabel.py in this session's history for how these were computed. */
var DISTRICT_LABEL_POINT = {
  gangdong:[127.142321,37.546496], songpa:[127.122148,37.502845], gangnam:[127.048727,37.506575],
  seocho:[127.007961,37.487328], gwanak:[126.945164,37.465969], dongjak:[126.950157,37.503575],
  yeongdeungpo:[126.909471,37.518793], geumcheon:[126.902506,37.459740], guro:[126.838491,37.486784],
  gangseo:[126.817328,37.563950], yangcheon:[126.868498,37.515501], mapo:[126.888952,37.566478],
  seodaemun:[126.940050,37.573118], eunpyeong:[126.932191,37.623586], nowon:[127.073346,37.667114],
  dobong:[127.035557,37.659089], gangbuk:[127.024302,37.626165], seongbuk:[127.023459,37.593357],
  jungnang:[127.093106,37.596422], dongdaemun:[127.058601,37.580637], gwangjin:[127.090198,37.543404],
  seongdong:[127.043227,37.550618], yongsan:[126.977573,37.529947], jung:[127.010169,37.556853],
  jongno:[126.969264,37.610516]
};
var HOOD_LABEL_POINT = {
  myeongdong:[126.985392,37.561934], euljiro:[126.992914,37.566089], itaewon:[126.991039,37.537206],
  haebangchon:[126.982660,37.541386], hannam:[127.003162,37.537698], hongdae:[126.919529,37.553053],
  mangwon:[126.896009,37.553812], seongsu:[127.046092,37.543067], mullae:[126.893899,37.515268],
  sinsa:[127.029057,37.529339], bukchon:[126.979241,37.586335], ikseondong:[126.989673,37.573175]
};
/* 24-12 Wiryeseong-daero 6-gil, Songpa-gu — grandma's place. OSM Nominatim has no exact
   house-number match for Korean addresses this specific (a known gap for this app — see the
   README's geocoding section); this is the middle of three street-segment matches it did return
   for 위례성대로6길 in 방이동, Songpa-gu, so it's within a block or so of the real building, not
   an exact rooftop pin. Nudge it once you can drop the precise pin from Naver/Kakao Map. */
var GRANDMA_HOME = [127.116450, 37.513407];

/* ---------- persisted state ---------- */
var LS = {visited:"seoul-map:visited", cats:"seoul-map:cats", favorites:"seoul-map:favorites"};
var visited = {}, favorites = {}, state = {catSel:{}, allOff:false, favOnly:false}; // allOff/favOnly: not persisted, always start showing everything
try { visited = JSON.parse(localStorage.getItem(LS.visited) || "{}") || {}; } catch(e) {}
try { state.catSel = JSON.parse(localStorage.getItem(LS.cats) || "{}") || {}; } catch(e) {}
try { favorites = JSON.parse(localStorage.getItem(LS.favorites) || "{}") || {}; } catch(e) {}
function saveVisited(){ try{ localStorage.setItem(LS.visited, JSON.stringify(visited)); }catch(e){} }
function saveCats(){ try{ localStorage.setItem(LS.cats, JSON.stringify(state.catSel)); }catch(e){} }
function saveFavorites(){ try{ localStorage.setItem(LS.favorites, JSON.stringify(favorites)); }catch(e){} }
function catFilterActive(){ for (var k in state.catSel) if (state.catSel[k]) return true; return false; }
function anyFilterActive(){ return catFilterActive() || !!state.favOnly; }
function catOn(t){ return !catFilterActive() || !!state.catSel[foldCat(t)]; }
/* combines the category filter with the favorites-only toggle — the one thing that should
   gate whether a place shows up anywhere: the map, a district panel, or the list view */
function placeVisible(p){ return catOn(p.category) && (!state.favOnly || !!favorites[p.id]); }
/* small red star/outline color used both for the map-pin highlight (paint expression below)
   and the favorite-button glyph (style.css --fav) — kept as one JS constant since MapLibre
   paint expressions can't read a CSS custom property directly. */
var FAV_COLOR = "#d6293c";
/* Builds the "places" GeoJSON source data from scratch, reading current favorite state.
   Shared by init() (first load) and refreshFavData() (after a star toggle) so the two never
   drift out of sync with each other. */
function buildPointsGeo(data){
  return {
    type:"FeatureCollection",
    features: data.places.filter(function(p){ return p.lat && p.lng; }).map(function(p){
      return {type:"Feature",
              properties:{id:p.id, category:p.category, categoryFold:foldCat(p.category), favorite: !!favorites[p.id]},
              geometry:{type:"Point", coordinates:[p.lng, p.lat]}};
    })
  };
}
/* Re-derives the places source's data from the current `favorites` object and pushes it to
   the map — this is what actually moves a red ring on/off a pin, since `favorite` is a plain
   GeoJSON property (not feature-state) so the same value can also drive applyCatFilter()'s
   favorites-only filter without a second code path. */
function refreshFavData(){
  if (!DATA) return;
  var src = map.getSource("places");
  if (src) src.setData(buildPointsGeo(DATA));
}

/* ---------- data (populated after fetch) ---------- */
var DATA = null;              // raw places.json contents
var placesById = {};
var placesByDistrict = {};
var DISTRICT = {};            // adapter: id -> {n, kr, side, also, places}
var HOODS = {};               // district id -> [{id, n, color}]
var HOOD_BY_ID = {};          // hood id -> {district, name, kr, color}
var DISTRICT_FEATURE_ID = {}; // district slug -> numeric geojson feature id (for feature-state)
var listOpen = false;

/* ---------- map/popup helpers with no API key: plain search links, not Google Maps
   (Google Maps directions/search are weak for small Korean venues — Naver/Kakao are the
   real on-the-ground tools, per the trip research this app is built from) ---------- */
function naverUrl(p){ return "https://map.naver.com/p/search/" + encodeURIComponent(p.name_kr || p.name); }
function kakaoUrl(p){ return "https://map.kakao.com/?q=" + encodeURIComponent(p.name_kr || p.name); }

/* ---------- map ---------- */
/* placeholder view for the constructor only — replaced the instant seoul-outline.json
   loads (see fitSeoul(0) below) by a real fitBounds computed from Seoul's actual outline,
   so "fitted" always means the same thing (outline + fixed padding) regardless of the
   viewport's own size/aspect, instead of a single zoom number tuned for one screen that
   reads as too zoomed-in on any narrower one (e.g. a phone in portrait). */
var PLACEHOLDER_VIEW = {center:[126.9880, 37.5540], zoom:10.4, pitch:0, bearing:0};
var map = new maplibregl.Map(Object.assign({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  attributionControl: {compact:true}
}, PLACEHOLDER_VIEW));
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), "bottom-right");
map.on("error", function(e){ console.error("MapLibre error:", e && e.error && e.error.message); });

/* extra top padding accounts for the HUD card + catbar sitting over the top-left corner —
   without it, fitBounds treats that space as available map area and crops the outline's
   own top edge under the HUD instead of leaving clear room below it. */
var FIT_PADDING = {top:190, bottom:50, left:40, right:40};
var seoulBounds = null;
/* Always resets pitch/bearing to flat top-down, not just the bounds: fitBounds() under a
   tilted camera needs FAR more zoom-out to keep the same geographic extent on screen
   (perspective foreshortening pushes the far edge back), so leaving 3D's pitch active from
   a previous tap made "Fit map" land absurdly zoomed-out — and updateMapClip()'s screen-space
   clip-path (below) only produces a valid shape when flat, so a lingering tilt also produced
   the diagonal pink bleed-through. Resetting both here means "Fit map" always gets you back to
   the same clean, flat, correctly-clipped view regardless of what the camera was doing before. */
function fitSeoul(duration){
  if (!seoulBounds) return;
  is3D = false;
  var btn3d = document.getElementById("btn3d");
  if (btn3d) btn3d.setAttribute("aria-pressed", "false");
  map.fitBounds(seoulBounds, {padding: FIT_PADDING, pitch:0, bearing:0, duration: duration===undefined?600:duration});
  apply3D();
}
document.getElementById("btnFit").addEventListener("click", function(){ fitSeoul(600); });

var is3D = false, isDeclutter = true; // declutter (streets/POIs/labels hidden) is the default now

/* the liberty style ships its own fill-extrusion building layer ("building-3d") — it is
   VISIBLE BY DEFAULT (no layout.visibility set), so it must be explicitly hidden on load,
   otherwise buildings appear at zoom>=14 before the 3D button is ever pressed. Tied ONLY to
   is3D, not also to !isDeclutter — that extra condition dates from when "streets shown" was
   the default (isDeclutter started false), so it never actually hid anything in practice.
   Once declutter flipped to on-by-default, that same condition meant 3D buildings could only
   ever appear after ALSO turning "Streets On" — the 3D button looked broken (still a flat
   view) unless you happened to enable streets too. 3D should just work on its own. */
function apply3D(){
  if (map.getLayer("building-3d")) {
    map.setLayoutProperty("building-3d", "visibility", is3D ? "visible" : "none");
  }
}
document.getElementById("btn3d").addEventListener("click", function(){
  is3D = !is3D;
  this.setAttribute("aria-pressed", is3D);
  map.easeTo({pitch: is3D ? 58 : 0, bearing: is3D ? -12 : 0, duration: 600});
  apply3D();
});

/* ---------- "Streets On" declutter toggle ----------
   Hides every base-style road/rail/POI/label/building/admin-boundary layer BY DEFAULT, leaving
   only background/water/landcover/landuse (still "land") plus this app's own district-fill,
   district-line, district-label and place-points layers. The Han River itself (its fill +
   line geometry) stays visible as a geographic anchor — only its text label is hidden.
   The button is framed as turning streets ON (default off) rather than off (default on), since
   the decluttered look is what most people want most of the time here. */
var DECLUTTER_HIDE_IDS = [
  "bridge_link","bridge_link_casing","bridge_major_rail","bridge_major_rail_hatching",
  "bridge_motorway","bridge_motorway_casing","bridge_motorway_link","bridge_motorway_link_casing",
  "bridge_path_pedestrian","bridge_path_pedestrian_casing","bridge_secondary_tertiary",
  "bridge_secondary_tertiary_casing","bridge_service_track","bridge_service_track_casing",
  "bridge_street","bridge_street_casing","bridge_transit_rail","bridge_transit_rail_hatching",
  "bridge_trunk_primary","bridge_trunk_primary_casing","highway-name-major","highway-name-minor",
  "highway-name-path","highway-shield-non-us","highway-shield-us-interstate","road_area_pattern",
  "road_link","road_link_casing","road_major_rail","road_major_rail_hatching","road_minor",
  "road_minor_casing","road_motorway","road_motorway_casing","road_motorway_link",
  "road_motorway_link_casing","road_one_way_arrow","road_one_way_arrow_opposite",
  "road_path_pedestrian","road_secondary_tertiary","road_secondary_tertiary_casing",
  "road_service_track","road_service_track_casing","road_shield_us","road_transit_rail",
  "road_transit_rail_hatching","road_trunk_primary","road_trunk_primary_casing","tunnel_link",
  "tunnel_link_casing","tunnel_major_rail","tunnel_major_rail_hatching","tunnel_minor",
  "tunnel_motorway","tunnel_motorway_casing","tunnel_motorway_link","tunnel_motorway_link_casing",
  "tunnel_path_pedestrian","tunnel_secondary_tertiary","tunnel_secondary_tertiary_casing",
  "tunnel_service_track","tunnel_service_track_casing","tunnel_street_casing","tunnel_transit_rail",
  "tunnel_transit_rail_hatching","tunnel_trunk_primary","tunnel_trunk_primary_casing",
  "poi_r20","poi_r7","poi_r1","poi_transit",
  "label_other","label_village","label_town",
  "label_country_3","label_country_2","label_country_1",
  "aeroway_fill","aeroway_runway","aeroway_taxiway","airport",
  "boundary_2","boundary_3","boundary_disputed",
  "building",
  "waterway_line_label","water_name_point_label","water_name_line_label"
];
/* always hidden, regardless of declutter state — the base style's generic "Seoul 서울특별시"
   city label sits right on top of the map at street-level zoom and duplicates what our own
   district-label layer already shows */
var PERMANENT_HIDE_IDS = ["label_city","label_city_capital","label_state"];

/* the literal road/highway layers within DECLUTTER_HIDE_IDS — the subset that gets revealed,
   scoped to just the selected district, even while "Streets On" itself is off (see below). */
var ROAD_LAYER_IDS = DECLUTTER_HIDE_IDS.filter(function(id){
  return /^(road_|bridge_|tunnel_|highway-)/.test(id);
});
/* each hideable layer's own filter, as shipped in the base style, captured once before we
   ever touch it — needed so that scoping a layer to one district (below) can AND a "within
   this district" clause onto its existing filter instead of replacing it outright (replacing
   it would also undo whatever class-based filter kept e.g. "road_minor" from also drawing
   motorways, which have their own separate layer/styling). */
var ORIGINAL_FILTERS = {}, originalFiltersCaptured = false;
function captureOriginalFilters(){
  if (originalFiltersCaptured) return;
  DECLUTTER_HIDE_IDS.forEach(function(id){
    if (map.getLayer(id)) ORIGINAL_FILTERS[id] = map.getFilter(id) || null;
  });
  originalFiltersCaptured = true;
}
/* the district GeoJSON Feature currently open in the panel, or null when back at the full
   Seoul view — set by selectDistrict()/closePanelFully() further down. Roads are revealed
   within this district's own polygon regardless of the global "Streets On" state, via a
   MapLibre `within` filter (true only for features fully inside the given polygon). */
var selectedDistrictFeature = null;

function applyDeclutter(){
  captureOriginalFilters();
  DECLUTTER_HIDE_IDS.forEach(function(id){
    if (!map.getLayer(id)) return;
    var isRoad = ROAD_LAYER_IDS.indexOf(id) >= 0;
    if (!isDeclutter){
      // "Streets On" — everything visible everywhere, exactly as the base style shipped it
      map.setLayoutProperty(id, "visibility", "visible");
      map.setFilter(id, ORIGINAL_FILTERS[id]);
    } else if (isRoad && selectedDistrictFeature){
      // declutter on, but a district is open — reveal its roads, scoped to that district only
      map.setLayoutProperty(id, "visibility", "visible");
      var base = ORIGINAL_FILTERS[id];
      var within = ["within", selectedDistrictFeature];
      map.setFilter(id, base ? ["all", base, within] : within);
    } else {
      map.setLayoutProperty(id, "visibility", "none");
    }
  });
}
document.getElementById("btnDeclutter").addEventListener("click", function(){
  isDeclutter = !isDeclutter;
  this.setAttribute("aria-pressed", String(!isDeclutter)); // pressed = "Streets On" active
  applyDeclutter();
});

function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/* ---------- "floating island" crop, take 2 ----------
   v1's approach (a giant world-polygon with a hole per district, rendered as a real MapLibre
   fill layer) worked but had two problems the user hit: it mis-tessellated into a solid block
   at very high zoom, and its wave-pattern texture was geographic — meaning it grew/shrank as
   you zoomed, instead of reading as a fixed background the way v1's actual illustration did.
   This replaces it with a DOM-level technique: #seaBackground is a plain, fixed, non-zooming
   CSS background (texture + the SEOUL watermark) sitting behind #map. #map itself gets a CSS
   `clip-path` that traces Seoul's outline in current screen pixels, re-computed on every map
   move/zoom/resize — so the map canvas is only ever visible inside Seoul's silhouette, and
   #seaBackground shows through everywhere else, completely unaffected by the camera. */
var seoulOutline = null; // [[lng,lat], ...] — the dissolved, simplified outer boundary of all 25 districts
function updateMapClip(){
  /* clip the inner canvas layer, NOT #map itself — #map also contains the zoom +/- control
     (a fixed screen corner), which would otherwise get clipped away along with everything
     else whenever Seoul's silhouette doesn't happen to reach that corner */
  var canvasLayer = document.querySelector("#map .maplibregl-canvas-container") || document.getElementById("map");
  if (!seoulOutline) return;
  /* map.project() converts a geo point to a SCREEN-space pixel by projecting it through the
     current camera — under a flat (pitch:0) top-down view that's a smooth, well-behaved
     mapping and the outline always comes back as a simple, valid polygon. Under any tilt,
     though, points near/behind the horizon project to wild or degenerate coordinates, so the
     resulting "polygon(...)" clip-path can self-intersect (diagonal pink bleed-through) or
     collapse to almost nothing (the whole canvas turning pink on further zoom). Rather than
     try to make screen-space clipping correct under perspective, just don't clip while
     tilted — the full rectangular canvas shows instead, which reads fine in 3D (the
     buildings/perspective already break the flat "floating island" look anyway). */
  if (map.getPitch() > 0.5) {
    canvasLayer.style.clipPath = "none";
    return;
  }
  /* defensive: bail out to the unclipped canvas if the map's own <canvas> element (NOT the
     wrapping .maplibregl-canvas-container div — that div's own getBoundingClientRect() was
     tried first and turned out to read 0×0 in testing even while the canvas inside it was
     rendering fine at its real size, apparently because the container relies on absolute
     positioning + inset:0 rather than an explicit box, so its own rect isn't a reliable
     "is the map ready" signal) isn't sized yet. A genuinely-zero canvas (a frame or two right
     after construction, before layout settles) makes map.project() return coordinates that
     won't correspond to anything visible once it *does* reach its real size — the clip-path
     would commit to a sliver or empty shape, reading as "the whole map turned pink." The next
     real move/resize event (there will be one once the viewport settles) retries this fresh. */
  var canvasRect = map.getCanvas().getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) {
    canvasLayer.style.clipPath = "none";
    return;
  }
  var allFinite = true;
  var pts = seoulOutline.map(function(ll){
    var p = map.project(ll);
    if (!isFinite(p.x) || !isFinite(p.y)) allFinite = false;
    return p.x.toFixed(1) + "px " + p.y.toFixed(1) + "px";
  });
  if (!allFinite) {
    canvasLayer.style.clipPath = "none";
    return;
  }
  canvasLayer.style.clipPath = "polygon(" + pts.join(",") + ")";
}

var seoulLoaded = false;
map.on("load", function(){
  /* guards against this handler's body running twice — reproduced once in testing on the
     Busan build (a second call re-adds sources MapLibre already has, throws, and the .catch
     below replaces the whole panel with an error), and treated here as a real possibility on
     mobile browsers too (map "load" re-firing after a tab is suspended/resumed, a style
     re-fetch retry on a flaky connection, etc.), not just a testing artifact. */
  if (seoulLoaded) return;
  seoulLoaded = true;
  Promise.all([
    fetch("data/districts.geojson").then(r=>r.json()),
    fetch("data/places.json").then(r=>r.json()),
    fetch("data/seoul-outline.json").then(r=>r.json()),
    fetch("data/neighborhoods.geojson").then(r=>r.json())
  ]).then(function(results){
    seoulOutline = results[2].outline;
    seoulBounds = new maplibregl.LngLatBounds();
    seoulOutline.forEach(function(ll){ seoulBounds.extend(ll); });
    fitSeoul(0); // snap straight to the fitted view, no animation, before the user sees anything
    updateMapClip();
    map.on("move", updateMapClip);
    map.on("resize", updateMapClip);
    /* belt-and-suspenders for mobile viewport-settling timing (address-bar collapse etc.):
       the container's final size might not always arrive as a MapLibre "resize" event, so
       also recheck shortly after load — see busan.js's own version of this same comment. */
    requestAnimationFrame(updateMapClip);
    setTimeout(updateMapClip, 600);
    window.addEventListener("resize", updateMapClip);
    window.addEventListener("orientationchange", function(){ setTimeout(updateMapClip, 300); });
    init(results[0], results[1], results[3]);
  }).catch(function(err){
    console.error("Failed to load data:", err);
    document.getElementById("panelBody").innerHTML = "<p>Failed to load map data — check that data/districts.geojson, data/places.json, data/seoul-outline.json and data/neighborhoods.geojson exist and the site is served over http(s), not file://.</p>";
    openPanelSheet();
  });
  apply3D(); // hide the style's own building-3d layer immediately, before data even loads
});

function init(districtsGeo, data, hoodsGeo){
  DATA = data;

  data.places.forEach(function(p){
    placesById[p.id] = p;
    (placesByDistrict[p.district] = placesByDistrict[p.district] || []).push(p);
  });

  districtsGeo.features.forEach(function(f){
    var id = f.properties.id;
    f.properties.label = f.properties.name.replace("-gu","");
    DISTRICT_FEATURE_ID[id] = f.id;
    var meta = data.districts[id] || {};
    DISTRICT[id] = {
      n: f.properties.name, kr: f.properties.name_kr,
      side: meta.side, also: meta.also || [],
      places: placesByDistrict[id] || []
    };
  });

  Object.keys(data.neighborhoods).forEach(function(hid){
    var h = data.neighborhoods[hid];
    HOOD_BY_ID[hid] = h;
    (HOODS[h.district] = HOODS[h.district] || []).push({id:hid, n:h.name, color:h.color});
  });

  /* resolve CSS custom properties to literal hex once — MapLibre paint expressions cannot
     read var(--x) themselves, they'd be treated as an invalid literal color string */
  var LAND = [cssVar("--land-a"), cssVar("--land-b"), cssVar("--land-c"), cssVar("--land-d"), cssVar("--land-e")];
  var SEAM = cssVar("--seam"), SEL_EDGE = cssVar("--accent");
  var LABEL_COLOR = cssVar("--district-label"), LABEL_HALO = cssVar("--district-label-halo");

  map.addSource("districts", {type:"geojson", data: districtsGeo});
  map.addLayer({
    id:"district-fill", type:"fill", source:"districts",
    paint:{
      "fill-color": ["match", ["get","tint"],
        0, LAND[0], 1, LAND[1], 2, LAND[2], 3, LAND[3], 4, LAND[4], LAND[0]],
      "fill-opacity": ["case", ["boolean", ["feature-state","selected"], false], 0.55, 0.85]
    }
  });
  map.addLayer({
    id:"district-line", type:"line", source:"districts",
    paint:{
      "line-color": ["case", ["boolean", ["feature-state","selected"], false], SEL_EDGE, SEAM],
      "line-width": ["case", ["boolean", ["feature-state","selected"], false], 2.6, 1.7],
      "line-opacity": 0.95
    }
  });
  /* the district-fill tint sits at 0.85 opacity over the whole gu polygon, including the
     Han river running through it, which mutes the water to a dull pink-gray. Redraw the
     base style's own water polygons in a vivid blue on top of district-fill (but below the
     seam lines/labels, inserted just before "district-line") so the river reads clearly
     through the tint — this doesn't touch the district polygons, borders, or land colors. */
  map.addLayer({
    id:"river-boost", type:"fill", source:"openmaptiles", "source-layer":"water",
    filter:["!=", ["get","brunnel"], "tunnel"],
    paint:{"fill-color":"#3E8EDE", "fill-opacity":0.9}
  }, "district-line");
  /* ---------- neighborhood zones (v2 — real geography, not v1's hand-drawn circles) ----------
     data/neighborhoods.geojson holds one real polygon per walkable focus-area (administrative-
     dong boundaries, merged/simplified per neighborhood — see that file's own per-feature
     properties.source; ikseondong alone is hand-traced, since no single administrative dong
     matches its small real extent — see build notes in that file). Each feature only carries an
     `id`; color comes from data.neighborhoods[id].color (the same hex the list-view chips and
     hood-block borders already use) via a runtime match expression, so the color lives in one
     place (places.json) instead of being duplicated into the geojson.
     Always-on at a constant opacity, same as district-fill/district-line — not gated behind a
     zoom threshold, because flyToDistrict()'s fitBounds() lands at a different zoom for every
     district depending on its own size (a big district like Eunpyeong ends up far more zoomed
     out than compact Jung-gu), so a fixed zoom cutoff would show zones reliably for some
     districts and never cross the threshold for others. At the full-Seoul default view each
     zone is just a small colored patch — the same way place-points shrink at low zoom too
     (see their own circle-radius below) — and reads clearly once you've clicked into its
     district. */
  var hoodColorMatch = ["match", ["get","id"]];
  Object.keys(data.neighborhoods).forEach(function(hid){
    hoodColorMatch.push(hid, data.neighborhoods[hid].color);
  });
  hoodColorMatch.push("#999999");
  /* text-field can only read a feature's own properties, not a separate JS lookup — stamp the
     real display name onto each feature once, up front, rather than patching it in after
     addSource (which would need an extra setData + setLayoutProperty round trip). */
  hoodsGeo.features.forEach(function(f){
    var h = data.neighborhoods[f.properties.id];
    f.properties.label = h ? h.name : f.properties.id;
  });
  map.addSource("hoods", {type:"geojson", data: hoodsGeo});
  map.addLayer({
    id:"hood-fill", type:"fill", source:"hoods",
    paint:{"fill-color": hoodColorMatch, "fill-opacity": 0.32}
  });
  map.addLayer({
    id:"hood-line", type:"line", source:"hoods",
    paint:{
      "line-color": hoodColorMatch,
      "line-width": 1.8, "line-dasharray": [2, 1.4], "line-opacity": 0.9
    }
  });

  var pointsGeo = buildPointsGeo(data);
  map.addSource("places", {type:"geojson", data: pointsGeo});
  map.addLayer({
    id:"place-points", type:"circle", source:"places",
    paint:{
      /* small and unobtrusive at the full-Seoul default view (where dozens can sit within a
         few pixels of each other), growing back to the old fixed 6px once you've zoomed into
         a district and they've spread out enough that overlap stops being the concern. */
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 11, 4, 14, 6, 17, 8],
      "circle-color": ["match", ["get","categoryFold"],
        "food", CAT.food.color, "cafe", CAT.cafe.color, "market", CAT.market.color,
        "museum", CAT.museum.color, "park", CAT.park.color, "view", CAT.view.color,
        "shop", CAT.shop.color, "night", CAT.night.color, "#999"],
      /* favorited places get a thicker red ring instead of the plain white one — driven by a
         `favorite` property on the feature (kept in sync with the `favorites` object by
         refreshFavData(), called from toggleFavorite() below) rather than feature-state, so
         the exact same property can double as a filter condition in applyCatFilter(). */
      "circle-stroke-width": ["case", ["==", ["get","favorite"], true], 3, 1.5],
      "circle-stroke-color": ["case", ["==", ["get","favorite"], true], FAV_COLOR, "#fff"]
    }
  });
  /* ---------- invisible, larger tap target for place-points ----------
     The visible dot above is deliberately tiny at low zoom (2.5px) so dense clusters stay
     readable, but that's much smaller than a comfortable touch target on a phone. Rather than
     grow the dot itself (and ruin the map art), this is a second circle layer on the SAME
     source/coordinates — fully transparent, but with a radius several px larger at every zoom
     step — and it's this layer, not the visible one, that click/hover are actually bound to
     below. The visible dot always sits at the center of its own invisible, much-easier-to-hit
     circle. Must mirror place-points' own category filter (see applyCatFilter) so a hidden
     dot's tap target doesn't linger as a phantom hit zone. */
  map.addLayer({
    id:"place-points-hit", type:"circle", source:"places",
    paint:{
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 11, 11, 13, 14, 15, 17, 17],
      "circle-opacity": 0, "circle-stroke-width": 0
    }
  });

  /* ---------- district/neighborhood name labels — added LAST, after place-points ----------
     Layers paint in the order they're added, later on top. These used to be added right after
     their own fill/line, which put them BELOW place-points — with dozens of place dots
     clustered in a small hood (Myeongdong, Itaewon...), the cluster could visually bury the
     hood/district name text underneath it. Adding both label layers after place-points fixes
     that: names always render on top of the dots, not the other way around. */
  var districtLabelPts = {
    type:"FeatureCollection",
    features: districtsGeo.features.map(function(f){
      /* MapLibre can place a symbol automatically from a polygon source
         ("symbol-placement":"point"), but it does that placement PER TILE on the geometry as
         clipped to that tile — a district polygon spanning more than one tile at a given zoom
         then gets one label placed independently in each tile fragment, i.e. duplicate labels
         for the same feature (visible e.g. on Dongdaemun-gu once zoomed in far enough to cross
         a tile boundary). Using a single precomputed Point per feature, on its own point
         source, sidesteps tile-splitting entirely: a point is never split into fragments, so
         it can only ever place one label. */
      var pt = DISTRICT_LABEL_POINT[f.properties.id] || f.geometry.coordinates[0][0];
      return {type:"Feature", properties:{label:f.properties.label}, geometry:{type:"Point", coordinates:pt}};
    })
  };
  map.addSource("district-label-pts", {type:"geojson", data: districtLabelPts});
  map.addLayer({
    id:"district-label", type:"symbol", source:"district-label-pts",
    layout:{
      "text-field": ["get","label"], "text-font": ["Noto Sans Bold"],
      /* Jongno-gu's own precomputed anchor sits only ~40px (screen space, at the default
         fitted zoom) from Eunpyeong's — the historic downtown core is geographically pinched
         between three mountain districts up there, and no point deep enough inside Jongno's
         polygon to count as a real interior anchor clears much more than that from ALL of its
         neighbors at once. With a fixed 13px size and text-allow-overlap:false, that collision
         made MapLibre drop one label outright (Jongno's, in practice) rather than render two
         overlapping ones — this is likely why it was missing. Shrinking the text at low zoom
         shrinks the actual collision boxes MapLibre checks, which is the real fix (moving the
         anchor point can't buy much more separation — the geometry is just tight there); it
         grows back to the original 13px by the time you've zoomed into a single district and
         overlap stops being a concern. */
      "text-size": ["interpolate", ["linear"], ["zoom"], 9, 10.5, 11, 12, 13, 13],
      "text-allow-overlap": false
    },
    paint:{
      "text-color": LABEL_COLOR, "text-halo-color": LABEL_HALO, "text-halo-width": 1.4
    }
  });
  /* same tile-split reasoning as district-label above — ikseondong/bukchon are small enough
     to rarely cross a tile boundary in practice, but the fix costs nothing to apply uniformly. */
  var hoodLabelPts = {
    type:"FeatureCollection",
    features: hoodsGeo.features.map(function(f){
      var pt = HOOD_LABEL_POINT[f.properties.id] || f.geometry.coordinates[0][0];
      return {type:"Feature", properties:{id:f.properties.id, label:f.properties.label}, geometry:{type:"Point", coordinates:pt}};
    })
  };
  map.addSource("hood-label-pts", {type:"geojson", data: hoodLabelPts});
  map.addLayer({
    id:"hood-label", type:"symbol", source:"hood-label-pts",
    layout:{
      "text-field": ["get","label"], "text-size": 11.5, "text-font": ["Noto Sans Bold"],
      "text-allow-overlap": false
    },
    paint:{"text-color": hoodColorMatch, "text-halo-color": "#ffffff", "text-halo-width": 1.3}
  });

  /* ---------- grandma's place — a single fixed landmark, kept OUTSIDE the places/category
     system entirely. It isn't a "place to visit and check off" like data.places entries — it's
     a home-icon reference point that should always show regardless of category filters or the
     All types/None toggle, and never appear in the list view or a district's place cards.
     A plain DOM maplibregl.Marker rather than a style symbol layer: MapLibre symbol layers draw
     text from the style's own SDF glyph set (rasterized from specific font files the "glyphs"
     endpoint serves), which does not cover emoji — a 🏠 text-field there silently renders
     nothing. A Marker's element is ordinary HTML, so the browser renders the emoji itself like
     any other text on the page; it also needs no source/layer/z-order juggling to always end up
     on top, and MapLibre repositions it on every camera move automatically. */
  var homeEl = document.createElement("div");
  homeEl.textContent = "🏠";
  homeEl.style.fontSize = "28px";
  homeEl.style.lineHeight = "1";
  homeEl.style.cursor = "pointer";
  homeEl.setAttribute("role", "img");
  homeEl.setAttribute("aria-label", "Grandma's place");
  new maplibregl.Marker({element: homeEl, anchor:"bottom"})
    .setLngLat(GRANDMA_HOME)
    .setPopup(new maplibregl.Popup({closeButton:false, offset:20})
      .setHTML("<b>🏠 Grandma's place</b><br><span style='color:#888'>24-12 Wiryeseong-daero 6-gil, Songpa</span>"))
    .addTo(map);

  var selectedDistrict = null;
  function setSelected(id){
    if (selectedDistrict) map.setFeatureState({source:"districts", id:DISTRICT_FEATURE_ID[selectedDistrict]}, {selected:false});
    selectedDistrict = id;
    if (id) map.setFeatureState({source:"districts", id:DISTRICT_FEATURE_ID[id]}, {selected:true});
  }
  function flyToDistrict(id){
    var f = districtsGeo.features.find(function(x){ return x.properties.id === id; });
    if (!f) return;
    var b = new maplibregl.LngLatBounds();
    f.geometry.coordinates.forEach(function(ring){ ring.forEach(function(c){ b.extend(c); }); });
    map.fitBounds(b, {padding:80, duration:700});
  }
  function selectDistrict(id){
    listOpen = false;
    document.getElementById("panel").classList.remove("list-mode");
    document.getElementById("panel").classList.remove("preview-mode");
    setSelected(id);
    selectedDistrictFeature = districtsGeo.features.find(function(x){ return x.properties.id === id; }) || null;
    applyDeclutter(); // reveal this district's own streets even if "Streets On" is off
    openDistrict(id);
    flyToDistrict(id);
  }

  map.on("click", "district-fill", function(e){ selectDistrict(e.features[0].properties.id); });

  /* bound to place-points-hit (the invisible, larger circle), not the visible place-points
     dot — see that layer's own comment above. Pressing a pin now does three things: flies the
     map to it, drops the usual popup, AND pops up a small preview card for just that place
     (previewPlace, defined near the list-view code below) — not the whole district accordion,
     just a quick peek with a link to go browse further if you want to. */
  map.on("click", "place-points-hit", function(e){
    var id = e.features[0].properties.id;
    var p = placesById[id];
    if (!p) return;
    map.flyTo({center:[p.lng, p.lat], zoom: Math.max(map.getZoom(), 15), duration:700});
    new maplibregl.Popup({closeButton:false, offset:12})
      .setLngLat([p.lng, p.lat])
      .setHTML("<b>"+p.name+"</b><br><span style='color:#888'>"+catLabel(p.category)+"</span>")
      .addTo(map);
    previewPlace(id);
  });

  ["district-fill","place-points-hit"].forEach(function(l){
    map.on("mouseenter", l, function(){ map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", l, function(){ map.getCanvas().style.cursor = ""; });
  });

  window.__selectDistrict = selectDistrict; // used by list-view jump/openmap buttons

  document.querySelectorAll(".catbar").forEach(function(bar){
    bar.innerHTML = catbarHTML();
    wireCatbar(bar);
    syncCatbar(bar);
  });
  PERMANENT_HIDE_IDS.forEach(function(id){
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  });
  applyCatFilter();
  applyDeclutter();
  updateProgress();
}

/* ---------- category filter chips: multi-select ADD model — clicking a chip ADDS it to
   the active filter set; an empty set normally means "show everything". The leading chip is
   a two-state toggle on top of that: tap "All types" to hide every place-point on the map at
   once (it relabels itself "None"); tap again ("None") to go back to showing everything and
   clear any individual category selections too, for a clean binary state. ---------- */
/* Favorites lives in this same chip row now, styled and clicked exactly like a category chip
   (Restaurant, Nightlife, ...) rather than as a separate HUD button — the one difference is
   what it filters on (state.favOnly, not state.catSel), handled below in syncCatbar/wireCatbar
   via the sentinel data-cat="__fav__" rather than a real category key. */
var FAV_CAT_KEY = "__fav__";
function catbarHTML(){
  var h = '<button class="catchip all" data-cat="">All types</button>';
  CAT_ORDER.forEach(function(k){
    h += '<button class="catchip" data-cat="'+k+'"><i style="background:'+CAT[k].color+'"></i>'+CAT[k].label+'</button>';
  });
  h += '<button class="catchip fav" data-cat="'+FAV_CAT_KEY+'"><i style="background:'+FAV_COLOR+'"></i>&#9733; Favorites</button>';
  return h;
}
function syncCatbar(container){
  if (!container) return;
  var active = catFilterActive();
  container.querySelectorAll(".catchip[data-cat]").forEach(function(ch){
    var k = ch.getAttribute("data-cat");
    if (k === FAV_CAT_KEY){
      var favSel = !!state.favOnly;
      ch.classList.toggle("on", favSel);
      ch.classList.toggle("off", (active || state.allOff) && !favSel);
      ch.style.borderColor = favSel ? FAV_COLOR : "";
      ch.style.color = favSel ? FAV_COLOR : "";
    } else if (k){
      var sel = !!state.catSel[k];
      ch.classList.toggle("on", sel);
      ch.classList.toggle("off", (active || state.allOff) && !sel);
      ch.style.borderColor = sel ? CAT[k].color : "";
      ch.style.color = sel ? CAT[k].color : "";
    } else {
      ch.textContent = state.allOff ? "None" : "All types";
      ch.classList.toggle("on", active || state.allOff);
    }
  });
}
function wireCatbar(container){
  if (!container) return;
  container.querySelectorAll(".catchip").forEach(function(ch){
    ch.addEventListener("click", function(e){
      e.stopPropagation();
      var k = ch.getAttribute("data-cat");
      if (k === FAV_CAT_KEY) { state.favOnly = !state.favOnly; }
      else if (!k) { state.allOff = !state.allOff; state.catSel = {}; }
      else { state.allOff = false; state.catSel[k] = !state.catSel[k]; if (!state.catSel[k]) delete state.catSel[k]; }
      saveCats();
      document.querySelectorAll(".catbar").forEach(syncCatbar);
      applyCatFilter();
      if (listOpen) { document.getElementById("panelBody").innerHTML = renderList(); wireList(); }
    });
  });
}
function applyCatFilter(){
  /* place-points-hit must always carry the exact same filter as the visible place-points dot
     it sits behind — otherwise a filtered-out category would still leave its (invisible)
     larger tap target live, and tapping empty-looking map space could reveal a hidden pin. */
  if (state.allOff){ map.setFilter("place-points", false); map.setFilter("place-points-hit", false); return; }
  var active = CAT_ORDER.filter(function(k){ return !!state.catSel[k]; });
  var parts = [];
  if (active.length) parts.push(["in", ["get","categoryFold"], ["literal", active]]);
  if (state.favOnly) parts.push(["==", ["get","favorite"], true]);
  var f = parts.length === 0 ? null : (parts.length === 1 ? parts[0] : ["all"].concat(parts));
  map.setFilter("place-points", f);
  map.setFilter("place-points-hit", f);
}
function visPlaces(id){ return (DISTRICT[id].places || []).filter(placeVisible); }
function counts(id){
  var pl = DISTRICT[id].places || [];
  var v = 0, pk = 0;
  for (var i=0; i<pl.length; i++){
    if (visited[pl[i].id]) v++;
    if (!pl[i].sourced_from_video) pk++;
  }
  return {total: pl.length, vis: v, picks: pk};
}

/* ---------- district detail panel ---------- */
function openDistrict(id){
  document.getElementById("panel").classList.remove("list-mode");
  document.getElementById("panel").classList.remove("preview-mode");
  var d = DISTRICT[id];
  var placesHere = d.places || [];
  var hoods = {}; var loose = [];
  placesHere.forEach(function(p){
    if (p.neighborhood) (hoods[p.neighborhood] = hoods[p.neighborhood] || []).push(p);
    else loose.push(p);
  });

  var html = "<h2>"+d.n+" <span class='kr'>"+d.kr+"</span></h2>";
  html += "<p class='blurb'>"+((DATA.districts[id]||{}).blurb || "")+"</p>";

  Object.keys(hoods).forEach(function(hid){
    var hm = HOOD_BY_ID[hid] || {name:hid, kr:"", color:"#999"};
    html += "<div class='hood-block' style='--hood-color:"+hm.color+"'>";
    html += "<div class='hood-focus'><h3 style='color:"+hm.color+"'>&#9733; "+hm.name+" <span class='kr'>"+hm.kr+"</span></h3>";
    if (hm.blurb) html += "<p class='hood-blurb'>"+hm.blurb+"</p>";
    html += "</div>";
    html += hoods[hid].map(placeCardHTML).join("");
    html += "</div>";
  });
  if (loose.length){
    html += "<div class='hood-block' style='margin-top:12px'>" + loose.map(placeCardHTML).join("") + "</div>";
  }
  if (d.also && d.also.length){
    html += "<div class='also'><b>Also here (not yet placed on the map):</b><br>" + d.also.join(" · ") + "</div>";
  }

  document.getElementById("panelBody").innerHTML = html;
  openPanelSheet();
  bindVisitCheckboxes();
  bindFavButtons();
}

function photoHTML(p){
  return p.img
    ? "<img src='"+p.img+"' alt='' loading='lazy'>"
    : "<span class='ph' style='background:"+catColor(p.category)+"22'></span>";
}

function favBtnHTML(p){
  var on = !!favorites[p.id];
  return "<button class='favbtn"+(on?" on":"")+"' data-id='"+p.id+"' type='button' aria-pressed='"+on+"' aria-label='"+(on?"Remove from":"Add to")+" favorites' title='Favorite'>&#9733;</button>";
}
function placeCardHTML(p){
  var flags = "";
  if (!p.lat) flags += "<span class='pflag' style='color:#9a6bc4;border-color:#9a6bc4'>NO PIN YET</span> ";
  if (p.unverified) flags += "<span class='verify'>check name/hours</span> ";
  if (p.sourced_from_video) flags += "<span class='fromvid'>video</span>";
  return "<div class='pcard"+(visited[p.id]?" done":"")+"' data-id='"+p.id+"'>"
    + "<input type='checkbox' class='vischk' data-id='"+p.id+"'"+(visited[p.id]?" checked":"")+">"
    + "<a class='pc-photo' href='"+naverUrl(p)+"' target='_blank' rel='noopener' aria-label='"+p.name+" on Naver Map'>"+photoHTML(p)+"</a>"
    + "<div>"
    + "<div class='pname'>"+p.name+" <span class='kr'>"+(p.name_kr||"")+"</span></div>"
    + "<span class='chiptype lr-cat'><i class='cdot' style=\"background:"+catColor(p.category)+"\"></i>"+catLabel(p.category)+"</span>"
    + "<div class='pmeta'>"+(p.hours||"")+"</div>"
    + (p.note ? "<div class='pnote'>"+p.note+"</div>" : "")
    + "<div class='pc-foot'>"
    + "<a class='maplink' href='"+naverUrl(p)+"' target='_blank' rel='noopener'>Naver</a> "
    + "<a class='maplink' href='"+kakaoUrl(p)+"' target='_blank' rel='noopener'>Kakao</a> "
    + flags
    + "</div></div>"
    + favBtnHTML(p)
    + "</div>";
}

function onToggle(e){
  var cb = e.target;
  var id = cb.dataset.id || cb.getAttribute("data-pid");
  visited[id] = cb.checked;
  saveVisited();
  var card = cb.closest(".pcard,.lr");
  if (card) card.classList.toggle("done", cb.checked);
  updateProgress();
  var pill = document.getElementById("lc-"+ (DATA && placesById[id] ? placesById[id].district : ""));
  if (pill && placesById[id]) pill.textContent = counts(placesById[id].district).vis + "/" + counts(placesById[id].district).total;
}
function bindVisitCheckboxes(){
  document.querySelectorAll(".vischk").forEach(function(cb){ cb.addEventListener("change", onToggle); });
}

/* ---------- favorites: a star per place, independent of the visited checkbox ----------
   Persisted the same way `visited` is (see LS.favorites above) so it survives a refresh.
   Toggling one updates three things at once: the map pin's red ring (refreshFavData), every
   matching star button currently in the DOM (a place can appear in both a district panel and
   the list at once — not true today, but cheap to handle correctly), and — only when the
   favorites-only filter is actually on — the currently open view, since un-favoriting a place
   while that filter is active should make its row/card disappear immediately rather than wait
   for the next re-render. */
function toggleFavorite(id){
  favorites[id] = !favorites[id];
  saveFavorites();
  refreshFavData();
  document.querySelectorAll('.favbtn[data-id="'+id+'"]').forEach(function(btn){
    var on = !!favorites[id];
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", (on?"Remove from":"Add to")+" favorites");
  });
  if (!state.favOnly) return;
  if (listOpen) { document.getElementById("panelBody").innerHTML = renderList(); wireList(); }
  else if (selectedDistrictFeature) { openDistrict(selectedDistrictFeature.properties.id); }
}
function bindFavButtons(){
  document.querySelectorAll(".favbtn").forEach(function(btn){
    btn.addEventListener("click", function(e){
      e.preventDefault(); e.stopPropagation();
      toggleFavorite(btn.getAttribute("data-id"));
    });
  });
}

function updateProgress(){
  if (!DATA) return;
  var total = DATA.places.length;
  var done = DATA.places.filter(function(p){ return visited[p.id]; }).length;
  document.getElementById("progressCount").textContent = done + " / " + total;
  document.getElementById("progressFill").style.width = (total? (done/total*100):0) + "%";
}

/* ---------- draggable bottom sheet (mobile) — ported from v1's sheet/sheetTo/sheetEnd.
   On mobile the panel is a bottom sheet with 3 snap points (full/half/peek) instead of a
   right-side drawer; .grab is the drag handle. On wider screens this is a no-op and the
   panel behaves exactly as the plain slide-in drawer via the "open" class + CSS transition. */
var MQ = window.matchMedia("(max-width:859px)");
var panelEl = document.getElementById("panel");
var sheet = {h:0, snaps:[0,0,0], y:0}, sd = null;
function sheetSetup(){
  if (!MQ.matches) return;
  var h = panelEl.getBoundingClientRect().height || window.innerHeight*0.9;
  sheet.h = h;
  sheet.snaps = [0, Math.round(h*0.46), Math.max(0, Math.round(h-118))]; // full · half · peek
}
function sheetTo(y, anim){
  sheet.y = y;
  panelEl.style.transition = anim === false ? "none" : "";
  panelEl.style.transform = "translateY(" + y + "px)";
}
function openPanelSheet(){
  panelEl.classList.add("open");
  if (MQ.matches) { sheetSetup(); sheetTo(sheet.snaps[1], true); }
  else { panelEl.style.transition = ""; panelEl.style.transform = ""; }
}
function closePanelSheet(){
  panelEl.classList.remove("open");
  if (MQ.matches) { sheetTo((sheet.h || window.innerHeight) + 60, true); }
  else { panelEl.style.transition = ""; panelEl.style.transform = ""; }
}
function closePanelFully(){
  closePanelSheet();
  panelEl.classList.remove("list-mode");
  panelEl.classList.remove("preview-mode");
  listOpen = false;
  if (selectedDistrictFeature){ selectedDistrictFeature = null; applyDeclutter(); } // drop the district-scoped street reveal
}
panelEl.addEventListener("pointerdown", function(e){
  if (!MQ.matches || !e.target.closest(".grab")) return;
  try { panelEl.setPointerCapture(e.pointerId); } catch(_){}
  sd = {sy:e.clientY, start:sheet.y};
  panelEl.style.transition = "none";
  panelEl.classList.add("dragging");
});
panelEl.addEventListener("pointermove", function(e){
  if (!sd) return;
  if (e.cancelable) e.preventDefault();
  var y = Math.max(0, Math.min(sheet.h, sd.start + (e.clientY - sd.sy)));
  sheet.y = y; panelEl.style.transform = "translateY(" + y + "px)";
});
function sheetEnd(e){
  if (!sd) return;
  try { panelEl.releasePointerCapture(e.pointerId); } catch(_){}
  panelEl.style.transition = "";
  panelEl.classList.remove("dragging");
  var y = sheet.y, sn = sheet.snaps;
  sd = null;
  if (y > sn[2] + 70) { closePanelFully(); return; }
  var best = sn[0], bd = 1e9;
  sn.forEach(function(s){ var d = Math.abs(s - y); if (d < bd) { bd = d; best = s; } });
  sheetTo(best, true);
}
panelEl.addEventListener("pointerup", sheetEnd);
panelEl.addEventListener("pointercancel", sheetEnd);

/* ---------- panel close ---------- */
document.getElementById("panelClose").addEventListener("click", function(){
  closePanelFully();
});

/* ---------- collapse/reopen the whole HUD card ---------- */
document.getElementById("hudClose").addEventListener("click", function(){
  document.getElementById("hud").hidden = true;
  document.getElementById("hudReopen").hidden = false;
});
document.getElementById("hudReopen").addEventListener("click", function(){
  document.getElementById("hud").hidden = false;
  document.getElementById("hudReopen").hidden = true;
});

/* ---------- list view (ported from v1's renderList/listGroup/listRow/wireList) ---------- */
document.getElementById("btnList").addEventListener("click", function(){
  listOpen = true;
  document.getElementById("panel").classList.remove("preview-mode");
  document.getElementById("panel").classList.add("list-mode");
  document.getElementById("panelBody").innerHTML = renderList();
  openPanelSheet();
  wireList();
});

function listRow(p){
  var done = !!visited[p.id];
  return "<div class='lr"+(done?" done":"")+"' id='card-"+p.id+"'>"
    + "<div class='lr-chk'>"
    +   "<input type='checkbox' data-pid='"+p.id+"'"+(done?" checked":"")+">"
    +   favBtnHTML(p)
    + "</div>"
    + "<a class='lr-photo' href='"+naverUrl(p)+"' target='_blank' rel='noopener' aria-label='"+p.name+" on Naver Map'>"+photoHTML(p)+"</a>"
    + "<div class='lr-main'>"
      + "<div class='lr-top'><span class='lr-name'>"+p.name+" <span class='lr-kr'>"+(p.name_kr||"")+"</span></span></div>"
      + "<span class='chiptype lr-cat'><i class='cdot' style=\"background:"+catColor(p.category)+"\"></i>"+catLabel(p.category)+"</span>"
      + "<div class='lr-meta'>"+(p.hours||"")+"</div>"
      + "<div class='lr-links'>"
      +   "<a class='maplink' href='"+naverUrl(p)+"' target='_blank' rel='noopener'>Naver</a>"
      +   "<a class='maplink' href='"+kakaoUrl(p)+"' target='_blank' rel='noopener'>Kakao</a>"
      +   (p.unverified ? "<span class='verify'>check name/hours</span>" : "")
      + "</div>"
    + "</div>"
    + "</div>";
}

function listGroup(label, ids){
  var filt = anyFilterActive();
  var withP = ids.filter(function(id){
    if (!(DISTRICT[id].places || []).length) return false;
    return filt ? visPlaces(id).length > 0 : true;
  });
  var noP = ids.filter(function(id){ return !(DISTRICT[id].places || []).length; });
  var s = "<div class='list-band'><span class='eyebrow'>"+label+"</span></div>";
  withP.forEach(function(id){
    var d = DISTRICT[id], c = counts(id), nm = d.n.replace("-gu",""), vp = visPlaces(id), hoods = HOODS[id] || [];
    var body = "";
    if (hoods.length){
      var byHood = {}, loose = [];
      vp.forEach(function(p){ if (p.neighborhood && HOOD_BY_ID[p.neighborhood]) (byHood[p.neighborhood]=byHood[p.neighborhood]||[]).push(p); else loose.push(p); });
      hoods.forEach(function(hd){
        var members = byHood[hd.id] || [];
        if (!members.length) return;
        body += "<p class='list-band' style='margin:10px 0 2px;color:"+hd.color+"'><span class='eyebrow' style='color:"+hd.color+"'>&#9733; "+hd.n+"</span></p>"+members.map(listRow).join("");
      });
      if (loose.length){ if (body) body += "<p class='list-band' style='margin:10px 0 2px'><span class='eyebrow'>Elsewhere</span></p>"; body += loose.map(listRow).join(""); }
    } else {
      body = vp.map(listRow).join("");
    }
    s += "<details class='list-d'"+(filt?" open":"")+" data-gu='"+id+"'>"
       + "<summary class='list-dh'>"
         + "<div class='list-dh-top'>"
           + "<span class='list-dname'>"+nm+" <span class='d-kr'>"+d.kr+"</span> <span class='pill count' id='lc-"+id+"'>"+c.vis+"/"+c.total+"</span></span>"
           + "<span class='list-caret' aria-hidden='true'>&#9656;</span>"
         + "</div>"
         + (hoods.length ? "<div class='list-dh-hoods'>"+hoods.map(function(hd){ return "<span class='list-key' style='border-color:"+hd.color+";color:"+hd.color+"'>"+hd.n+"</span>"; }).join("")+"</div>" : "")
       + "</summary>"
       + "<div class='list-dbody'>"
         + (vp.length ? body : "<p class='list-none'>No places here.</p>")
         + (!filt && DATA.districts[id] && DATA.districts[id].also && DATA.districts[id].also.length ? "<p class='list-also'>also here: "+DATA.districts[id].also.join("  ·  ")+"</p>" : "")
         + "<button class='list-openmap' data-gu='"+id+"'>View "+nm+" on the map &#8599;</button>"
       + "</div>"
       + "</details>";
  });
  if (noP.length && !filt){
    s += "<div class='list-empty'><span class='eyebrow'>Nothing picked — near these if you pass through</span>";
    noP.forEach(function(id){
      var d = DISTRICT[id], also = (DATA.districts[id] && DATA.districts[id].also) || [];
      s += "<p class='list-erow'><button class='list-jump' data-gu='"+id+"'>"+d.n.replace("-gu","")+"</button> — "+also.slice(0,3).join("  ·  ")+"</p>";
    });
    s += "</div>";
  }
  return s;
}

function renderList(){
  var filt = anyFilterActive(), np=0, nd=0, vnp=0;
  ALL_IDS.forEach(function(id){ var n=(DISTRICT[id].places||[]).length; if (n){ np+=n; nd++; vnp+=visPlaces(id).length; } });
  var buk = ALL_IDS.filter(function(id){ return DISTRICT[id].side==="buk"; });
  var nam = ALL_IDS.filter(function(id){ return DISTRICT[id].side==="nam"; });
  return "<div class='p-bar'><button data-back>&lsaquo; Map</button><span class='spacer'></span><button data-close aria-label='Close'>&times;</button></div>"
    + "<h2 class='list-h'>Every place by district</h2>"
    + "<p class='list-sub'>"+(filt ? "<strong>"+vnp+"</strong> of "+np+" places match — tap a highlighted chip again to clear." : np+" places across "+nd+" districts. Tap a district to open it; tick places off as you go.")+"</p>"
    + "<div class='list-tools'><button class='txtbtn' data-expand='1'>Expand all</button><button class='txtbtn' data-expand='0'>Collapse all</button></div>"
    + "<div class='catbar list-catbar' role='group' aria-label='Filter places by type'>"+catbarHTML()+"</div>"
    + listGroup("North of the Han", buk) + listGroup("South of the Han", nam);
}

/* ---------- a compact single-place preview when a map pin is tapped ----------
   This used to jump straight into the full "every place by district" List view, scrolled to
   and highlighting the tapped place's row. That worked, but landing in the entire
   multi-district accordion over one tap was overkill and buried the one place you actually
   care about inside everything else. This instead renders just that place's own row — reusing
   listRow() so it's pixel-identical to its row in the real list — under the same "‹ Map / ×"
   bar the list view uses, and, on mobile, sizes the sheet to fit that one row instead of the
   usual 90dvh sheet (see .panel.preview-mode in style.css), so it reads as a small peek card
   rather than a full-screen takeover. A "See all in <district>" link inside it still reaches
   the old full-list-scrolled-and-highlighted behavior (now openFullListAt, below) for anyone
   who wants to keep browsing from there. */
function renderPlacePreview(p){
  var d = DISTRICT[p.district];
  var dname = d ? d.n.replace("-gu","") : "";
  return "<div class='p-bar'><button data-back>&lsaquo; Map</button><span class='spacer'></span><button data-close aria-label='Close'>&times;</button></div>"
    + listRow(p)
    + (d ? "<button class='txtbtn preview-more' data-gu='"+p.district+"'>See all in "+dname+" &rsaquo;</button>" : "");
}
function wirePlacePreview(id){
  var panelBody = document.getElementById("panelBody");
  var closeBtn = panelBody.querySelector("[data-close]");
  if (closeBtn) closeBtn.addEventListener("click", closePanelFully);
  var backBtn = panelBody.querySelector("[data-back]");
  if (backBtn) backBtn.addEventListener("click", closePanelFully);
  panelBody.querySelectorAll("input[type=checkbox]").forEach(function(cb){ cb.addEventListener("change", onToggle); });
  bindFavButtons();
  var more = panelBody.querySelector(".preview-more");
  if (more) more.addEventListener("click", function(){ openFullListAt(id); });
}
/* Called by the place-points-hit click handler above — the default response to tapping a pin. */
function previewPlace(id){
  var p = placesById[id];
  if (!p) return;
  listOpen = false; // this is a single-card peek, not the full list — keep that flag accurate
  var panel = document.getElementById("panel");
  panel.classList.add("list-mode");    // reuses list-mode's width + hides the floating
  panel.classList.add("preview-mode"); //  #panelClose, since our own p-bar supplies both
  document.getElementById("panelBody").innerHTML = renderPlacePreview(p);
  openPanelSheet();
  if (MQ.matches){
    /* .preview-mode shrinks the sheet element itself to fit its (short) content instead of
       the usual 90dvh — re-measure against THAT height, then snap fully open rather than the
       default half-sheet, since "half" of an already-short card would hide most of it. */
    sheetSetup();
    sheetTo(0, true);
  }
  wirePlacePreview(id);
}

/* ---------- the previous behavior, kept as an escape hatch ----------
   Opens the full "every place by district" List view with the given place's district
   <details> expanded and its row scrolled into view + briefly highlighted — reached from the
   "See all in <district>" link inside previewPlace()'s card rather than fired on every tap. */
function openFullListAt(id){
  listOpen = true;
  var panel = document.getElementById("panel");
  panel.classList.remove("preview-mode");
  panel.classList.add("list-mode");
  document.getElementById("panelBody").innerHTML = renderList();
  openPanelSheet();
  if (MQ.matches) sheetTo(sheet.snaps[0], true); // fully open, not the default half-sheet
  wireList();
  var row = document.getElementById("card-" + id);
  if (!row) return;
  var details = row.closest("details.list-d");
  if (details) details.open = true;
  /* two frames, not one: the first lets the just-opened <details> finish laying out, the
     second lets the sheet's own re-snap-to-full (above) settle too — scrolling against either
     mid-reflow measures the wrong position. */
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      row.scrollIntoView({behavior:"smooth", block:"center"});
      row.classList.add("flash");
      setTimeout(function(){ row.classList.remove("flash"); }, 1600);
    });
  });
}

function wireList(){
  var panelBody = document.getElementById("panelBody");
  var closeBtn = panelBody.querySelector("[data-close]");
  if (closeBtn) closeBtn.addEventListener("click", closePanelFully);
  var backBtn = panelBody.querySelector("[data-back]");
  if (backBtn) backBtn.addEventListener("click", closePanelFully);
  panelBody.querySelectorAll(".list-jump,.list-openmap").forEach(function(j){
    j.addEventListener("click", function(ev){
      ev.preventDefault(); ev.stopPropagation();
      if (window.__selectDistrict) window.__selectDistrict(j.getAttribute("data-gu"));
    });
  });
  panelBody.querySelectorAll("[data-expand]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var op = btn.getAttribute("data-expand") === "1";
      panelBody.querySelectorAll("details.list-d").forEach(function(dt){ dt.open = op; });
    });
  });
  var lcb = panelBody.querySelector(".list-catbar");
  if (lcb){ wireCatbar(lcb); syncCatbar(lcb); }
  panelBody.querySelectorAll("input[type=checkbox]").forEach(function(cb){ cb.addEventListener("change", onToggle); });
  bindFavButtons();
}
