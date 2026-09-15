"use strict";

/* ================================================================================
   Busan — a real MapLibre map, same engine as Seoul's app.js, pointed at Busan's own
   data and a purple palette. Two deliberate simplifications versus Seoul:

   1. No neighborhoods/hoods layer. v1's own Busan build was explicitly "base map
      only for now" and never had a hood system either — nothing here has walkable
      focus-areas researched yet the way Seoul's Ikseon-dong/Itaewon/etc. do.
   2. No "floating island" clip-path crop. Seoul's #seaBackground + clip-path trick
      needs a single clean outer ring (seoul-outline.json); Busan's real coastline
      includes Yeongdo (a true island) and Gangseo's river delta, so the union of
      all 16 districts is a MultiPolygon with genuine gaps of open water between
      pieces — a single CSS clip-path polygon can't represent that faithfully, and
      building a proper multi-shape SVG clipPath for a purely decorative crop wasn't
      worth it for this pass. The map just shows the real base tiles beyond the
      district fills instead of being masked to a silhouette.

   Everything else — district-fill/line, place-points + the invisible larger hit
   layer, district labels, 3D buildings toggle, "Streets On" declutter, the preview
   card, list view, panel/sheet drag mechanics — mirrors app.js closely enough that
   bugs fixed there (the tap-target sizing, the sticky-bar/transform touch issue,
   the Jongno-style label collision fix) are already applied here too, not
   rediscovered later. See app.js's own comments for the full rationale on each.
   ================================================================================ */

/* ---------- category taxonomy (identical to Seoul's/Jeju's) ---------- */
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

/* ---------- fixed district order — v1's own BUSAN_LAYOUT insertion order, not
   derived from Object.keys(data.districts) (JSON key order isn't guaranteed) ---- */
var ALL_IDS = ["saha","gijang","gangseo","geumjeong","haeundae","buk","sasang","busanjin",
  "dongnae","yeonje","nam","yeongdo","suyeong","seo","jung","dong"];

/* precomputed label anchor points (pole of inaccessibility, computed offline with Shapely
   over each district's real unioned polygon) — same reasoning as Seoul's own
   DISTRICT_LABEL_POINT: a single point on its own point source sidesteps MapLibre
   placing one label per TILE FRAGMENT of a polygon that spans a tile boundary. */
var DISTRICT_LABEL_POINT = {
  buk:[129.022413,35.220592], busanjin:[129.03972,35.167316], dong:[129.038349,35.126325],
  dongnae:[129.068185,35.210582], gangseo:[128.921543,35.171759], geumjeong:[129.085623,35.258715],
  gijang:[129.18849,35.297101], haeundae:[129.149758,35.182634], jung:[129.030715,35.103921],
  nam:[129.091681,35.127293], saha:[128.970581,35.092006], sasang:[128.986372,35.156314],
  seo:[129.012967,35.121419], suyeong:[129.109067,35.163079], yeongdo:[129.061178,35.083628],
  yeonje:[129.086265,35.182659]
};

/* ---------- persisted state — own localStorage keys, never shared with Seoul/Jeju ---- */
var LS = {visited:"busan-map:visited", cats:"busan-map:cats"};
var visited = {}, state = {catSel:{}, allOff:false};
try { visited = JSON.parse(localStorage.getItem(LS.visited) || "{}") || {}; } catch(e) {}
try { state.catSel = JSON.parse(localStorage.getItem(LS.cats) || "{}") || {}; } catch(e) {}
function saveVisited(){ try{ localStorage.setItem(LS.visited, JSON.stringify(visited)); }catch(e){} }
function saveCats(){ try{ localStorage.setItem(LS.cats, JSON.stringify(state.catSel)); }catch(e){} }
function catFilterActive(){ for (var k in state.catSel) if (state.catSel[k]) return true; return false; }
function catOn(t){ return !catFilterActive() || !!state.catSel[foldCat(t)]; }

/* ---------- data (populated after fetch) ---------- */
var DATA = null, placesById = {}, placesByDistrict = {}, DISTRICT = {}, DISTRICT_FEATURE_ID = {};
var listOpen = false;

function naverUrl(p){ return "https://map.naver.com/p/search/" + encodeURIComponent(p.name_kr || p.name); }
function kakaoUrl(p){ return "https://map.kakao.com/?q=" + encodeURIComponent(p.name_kr || p.name); }

/* ---------- map ---------- */
var PLACEHOLDER_VIEW = {center:[129.075, 35.18], zoom:10.6, pitch:0, bearing:0};
var map = new maplibregl.Map(Object.assign({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  attributionControl: {compact:true}
}, PLACEHOLDER_VIEW));
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), "bottom-right");
map.on("error", function(e){ console.error("MapLibre error:", e && e.error && e.error.message); });

var FIT_PADDING = {top:190, bottom:50, left:40, right:40};
var busanBounds = null;
function fitBusan(duration){
  if (!busanBounds) return;
  is3D = false;
  var btn3d = document.getElementById("btn3d");
  if (btn3d) btn3d.setAttribute("aria-pressed", "false");
  map.fitBounds(busanBounds, {padding: FIT_PADDING, pitch:0, bearing:0, duration: duration===undefined?600:duration});
  apply3D();
}
document.getElementById("btnFit").addEventListener("click", function(){ fitBusan(600); });

var is3D = false, isDeclutter = true;
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

/* ---------- "Streets On" declutter toggle — identical layer list to app.js ---------- */
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
var PERMANENT_HIDE_IDS = ["label_city","label_city_capital","label_state"];
var ROAD_LAYER_IDS = DECLUTTER_HIDE_IDS.filter(function(id){
  return /^(road_|bridge_|tunnel_|highway-)/.test(id);
});
var ORIGINAL_FILTERS = {}, originalFiltersCaptured = false;
function captureOriginalFilters(){
  if (originalFiltersCaptured) return;
  DECLUTTER_HIDE_IDS.forEach(function(id){
    if (map.getLayer(id)) ORIGINAL_FILTERS[id] = map.getFilter(id) || null;
  });
  originalFiltersCaptured = true;
}
var selectedDistrictFeature = null;
function applyDeclutter(){
  captureOriginalFilters();
  DECLUTTER_HIDE_IDS.forEach(function(id){
    if (!map.getLayer(id)) return;
    var isRoad = ROAD_LAYER_IDS.indexOf(id) >= 0;
    if (!isDeclutter){
      map.setLayoutProperty(id, "visibility", "visible");
      map.setFilter(id, ORIGINAL_FILTERS[id]);
    } else if (isRoad && selectedDistrictFeature){
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
  this.setAttribute("aria-pressed", String(!isDeclutter));
  applyDeclutter();
});

function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/* ---------- "floating island" crop — same idea as Seoul's, generalized to N rings ----------
   Seoul's own version clips a single CSS clip-path polygon() to one outer ring, which is all
   a single Polygon needs. Busan's real coastline doesn't fit that: Yeongdo is a genuine island,
   separated from the mainland by real open water, so the union of all 16 districts is a
   MultiPolygon — busan-outline.json keeps the two rings big enough to matter (the mainland and
   Yeongdo; three sub-pixel simplification slivers were dropped when that file was built). CSS
   clip-path: polygon() only takes one ring, so this uses an SVG <clipPath> instead (defined,
   empty, in busan.html) — one <polygon> child per ring, referenced via clip-path:url(#id) on
   the same canvas-container element Seoul's version targets. Each polygon's own screen-space
   points get recomputed on every map move/resize, exactly like Seoul's single polygon() does. */
var busanOutlines = null; // [[[lng,lat], ...], ...] — one array of points per kept ring
var clipPolygonEls = [];
function setupBusanClip(outlines){
  busanOutlines = outlines;
  var svgNS = "http://www.w3.org/2000/svg";
  var clipPathEl = document.getElementById("busanClipPath");
  /* idempotent on purpose: if this ever runs more than once for any reason (a mobile browser
     re-firing map's own "load" event has been observed — see the guard on the load handler
     below), stale <polygon> children from a previous call must not linger. A leftover polygon
     with no `points` set (because clipPolygonEls got reset but the old DOM node didn't) is
     exactly the failure mode that was once reproduced in testing: some rings render, some
     don't, and the mismatch reads as the whole map glitching. */
  clipPathEl.innerHTML = "";
  clipPolygonEls = [];
  outlines.forEach(function(){
    var poly = document.createElementNS(svgNS, "polygon");
    clipPathEl.appendChild(poly);
    clipPolygonEls.push(poly);
  });
}
function updateMapClip(){
  var canvasLayer = document.querySelector("#map .maplibregl-canvas-container") || document.getElementById("map");
  if (!busanOutlines) return;
  /* same reasoning as Seoul's version: under any camera tilt, map.project() on points near/
     behind the horizon returns wild coordinates, so don't attempt to clip while pitched —
     show the full rectangular canvas instead (3D already breaks the flat "floating island"
     look on its own). */
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
     won't correspond to anything visible once it *does* reach its real size — every ring
     would clip to a sliver or nothing, reading as "the whole map turned into a blank color."
     The next real move/resize event (there will be one once the viewport settles) retries
     this fresh. */
  var canvasRect = map.getCanvas().getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) {
    canvasLayer.style.clipPath = "none";
    return;
  }
  var allFinite = true;
  var ringPts = busanOutlines.map(function(ring){
    return ring.map(function(ll){
      var p = map.project(ll);
      if (!isFinite(p.x) || !isFinite(p.y)) allFinite = false;
      return p.x.toFixed(1) + "," + p.y.toFixed(1);
    });
  });
  if (!allFinite) {
    canvasLayer.style.clipPath = "none";
    return;
  }
  ringPts.forEach(function(pts, i){
    clipPolygonEls[i].setAttribute("points", pts.join(" "));
  });
  canvasLayer.style.clipPath = "url(#busanClipPath)";
}

var busanLoaded = false;
map.on("load", function(){
  /* guards against this handler's body running twice — reproduced once in testing (a second
     call re-adds the "places"/"districts" sources MapLibre already has, throws, and the
     .catch below replaces the whole panel with an error) and treated here as a real
     possibility on mobile browsers too (map "load" re-firing after a tab is suspended and
     resumed, a style re-fetch retry on a flaky connection, etc.), not just a testing artifact. */
  if (busanLoaded) return;
  busanLoaded = true;
  Promise.all([
    fetch("data/busan-districts.geojson").then(r=>r.json()),
    fetch("data/busan-places.json").then(r=>r.json()),
    fetch("data/busan-outline.json").then(r=>r.json())
  ]).then(function(results){
    var districtsGeo = results[0], data = results[1], outlineData = results[2];
    busanBounds = new maplibregl.LngLatBounds();
    outlineData.outlines.forEach(function(ring){ ring.forEach(function(c){ busanBounds.extend(c); }); });
    fitBusan(0);
    setupBusanClip(outlineData.outlines);
    updateMapClip();
    map.on("move", updateMapClip);
    map.on("resize", updateMapClip);
    /* belt-and-suspenders for the mobile address-bar-collapse timing described above: the
       container's settled size might not arrive as a MapLibre "resize" event at all on every
       browser, so also recheck shortly after load (rAF once the current frame's layout has
       committed, then again after Safari's toolbar-collapse animation would have finished). */
    requestAnimationFrame(updateMapClip);
    setTimeout(updateMapClip, 600);
    window.addEventListener("resize", updateMapClip);
    window.addEventListener("orientationchange", function(){ setTimeout(updateMapClip, 300); });
    init(districtsGeo, data);
  }).catch(function(err){
    console.error("Failed to load data:", err);
    document.getElementById("panelBody").innerHTML = "<p>Failed to load map data — check that data/busan-districts.geojson, data/busan-places.json and data/busan-outline.json exist and the site is served over http(s), not file://.</p>";
    openPanelSheet();
  });
  apply3D();
});

function init(districtsGeo, data){
  DATA = data;

  data.places.forEach(function(p){
    placesById[p.id] = p;
    (placesByDistrict[p.district] = placesByDistrict[p.district] || []).push(p);
  });

  districtsGeo.features.forEach(function(f){
    var id = f.properties.id;
    f.properties.label = f.properties.name.replace("-gu","").replace("-gun","");
    DISTRICT_FEATURE_ID[id] = f.id;
    var meta = data.districts[id] || {};
    DISTRICT[id] = {
      n: f.properties.name, kr: f.properties.name_kr,
      places: placesByDistrict[id] || []
    };
  });

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
  /* same river-boost trick as Seoul's app.js — the Nakdong River should read as water,
     not get muted to pale lavender under the district tint. */
  map.addLayer({
    id:"river-boost", type:"fill", source:"openmaptiles", "source-layer":"water",
    filter:["!=", ["get","brunnel"], "tunnel"],
    paint:{"fill-color":"#7FB2DD", "fill-opacity":0.9}
  }, "district-line");

  var pointsGeo = {
    type:"FeatureCollection",
    features: data.places.filter(p=>p.lat && p.lng).map(function(p){
      return {type:"Feature", properties:{id:p.id, category:p.category, categoryFold:foldCat(p.category)},
              geometry:{type:"Point", coordinates:[p.lng, p.lat]}};
    })
  };
  map.addSource("places", {type:"geojson", data: pointsGeo});
  map.addLayer({
    id:"place-points", type:"circle", source:"places",
    paint:{
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 11, 4, 14, 6, 17, 8],
      "circle-color": ["match", ["get","categoryFold"],
        "food", CAT.food.color, "cafe", CAT.cafe.color, "market", CAT.market.color,
        "museum", CAT.museum.color, "park", CAT.park.color, "view", CAT.view.color,
        "shop", CAT.shop.color, "night", CAT.night.color, "#999"],
      "circle-stroke-width":1.5, "circle-stroke-color":"#fff"
    }
  });
  /* invisible, larger tap target — see app.js's own comment on this for the full
     rationale (the visible dot stays tiny at low zoom on purpose). */
  map.addLayer({
    id:"place-points-hit", type:"circle", source:"places",
    paint:{
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 11, 11, 13, 14, 15, 17, 17],
      "circle-opacity": 0, "circle-stroke-width": 0
    }
  });

  var districtLabelPts = {
    type:"FeatureCollection",
    features: districtsGeo.features.map(function(f){
      var pt = DISTRICT_LABEL_POINT[f.properties.id] || (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates[0][0][0] : f.geometry.coordinates[0][0]);
      return {type:"Feature", properties:{label:f.properties.label}, geometry:{type:"Point", coordinates:pt}};
    })
  };
  map.addSource("district-label-pts", {type:"geojson", data: districtLabelPts});
  map.addLayer({
    id:"district-label", type:"symbol", source:"district-label-pts",
    layout:{
      "text-field": ["get","label"], "text-font": ["Noto Sans Bold"],
      /* same zoom-dependent shrink Seoul's district-label uses (fixed a Jongno-gu
         collision there) — applied here from the start rather than waiting to hit
         the same bug: several of these 16 districts are genuinely small/adjacent
         (Jung/Dong/Yeongdo cluster tightly around the old harbor). */
      "text-size": ["interpolate", ["linear"], ["zoom"], 9, 10.5, 11, 12, 13, 13],
      "text-allow-overlap": false
    },
    paint:{
      "text-color": LABEL_COLOR, "text-halo-color": LABEL_HALO, "text-halo-width": 1.4
    }
  });

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
    var rings = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.flat(1) : f.geometry.coordinates;
    rings.forEach(function(ring){ ring.forEach(function(c){ b.extend(c); }); });
    map.fitBounds(b, {padding:80, duration:700});
  }
  function selectDistrict(id){
    listOpen = false;
    document.getElementById("panel").classList.remove("list-mode");
    document.getElementById("panel").classList.remove("preview-mode");
    setSelected(id);
    selectedDistrictFeature = districtsGeo.features.find(function(x){ return x.properties.id === id; }) || null;
    applyDeclutter();
    openDistrict(id);
    flyToDistrict(id);
  }

  map.on("click", "district-fill", function(e){ selectDistrict(e.features[0].properties.id); });

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

  window.__selectDistrict = selectDistrict;

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

/* ---------- category filter chips (identical pattern to app.js) ---------- */
function catbarHTML(){
  var h = '<button class="catchip all" data-cat="">All types</button>';
  CAT_ORDER.forEach(function(k){
    h += '<button class="catchip" data-cat="'+k+'"><i style="background:'+CAT[k].color+'"></i>'+CAT[k].label+'</button>';
  });
  return h;
}
function syncCatbar(container){
  if (!container) return;
  var active = catFilterActive();
  container.querySelectorAll(".catchip[data-cat]").forEach(function(ch){
    var k = ch.getAttribute("data-cat");
    if (k){
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
      if (!k) { state.allOff = !state.allOff; state.catSel = {}; }
      else { state.allOff = false; state.catSel[k] = !state.catSel[k]; if (!state.catSel[k]) delete state.catSel[k]; }
      saveCats();
      document.querySelectorAll(".catbar").forEach(syncCatbar);
      applyCatFilter();
      if (listOpen) { document.getElementById("panelBody").innerHTML = renderList(); wireList(); }
    });
  });
}
function applyCatFilter(){
  if (state.allOff){ map.setFilter("place-points", false); map.setFilter("place-points-hit", false); return; }
  var active = CAT_ORDER.filter(function(k){ return !!state.catSel[k]; });
  var f = active.length ? ["in", ["get","categoryFold"], ["literal", active]] : null;
  map.setFilter("place-points", f);
  map.setFilter("place-points-hit", f);
}
function visPlaces(id){ return (DISTRICT[id].places || []).filter(function(p){ return catOn(p.category); }); }
function counts(id){
  var pl = DISTRICT[id].places || [];
  var v = 0;
  for (var i=0; i<pl.length; i++){ if (visited[pl[i].id]) v++; }
  return {total: pl.length, vis: v};
}

/* ---------- district detail panel — no hood-block system, just a flat list of
   place cards under the district's own blurb (v1's Busan never had hoods either). */
function openDistrict(id){
  document.getElementById("panel").classList.remove("list-mode");
  document.getElementById("panel").classList.remove("preview-mode");
  var d = DISTRICT[id];
  var placesHere = d.places || [];

  var html = "<h2>"+d.n+" <span class='kr'>"+d.kr+"</span></h2>";
  html += "<p class='blurb'>"+((DATA.districts[id]||{}).blurb || "")+"</p>";
  if (placesHere.length){
    html += "<div class='hood-block' style='margin-top:12px'>" + placesHere.map(placeCardHTML).join("") + "</div>";
  }

  document.getElementById("panelBody").innerHTML = html;
  openPanelSheet();
  bindVisitCheckboxes();
}

function photoHTML(p){
  return p.img
    ? "<img src='"+p.img+"' alt='' loading='lazy'>"
    : "<span class='ph' style='background:"+catColor(p.category)+"22'></span>";
}

function placeCardHTML(p){
  var flags = "";
  if (!p.lat) flags += "<span class='pflag' style='color:#9a6bc4;border-color:#9a6bc4'>NO PIN YET</span> ";
  if (p.unverified) flags += "<span class='verify'>check name/hours</span> ";
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
    + "</div></div></div>";
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
function updateProgress(){
  if (!DATA) return;
  var total = DATA.places.length;
  var done = DATA.places.filter(function(p){ return visited[p.id]; }).length;
  document.getElementById("progressCount").textContent = done + " / " + total;
  document.getElementById("progressFill").style.width = (total? (done/total*100):0) + "%";
}

/* ---------- draggable bottom sheet (mobile) — identical mechanics to app.js ---------- */
var MQ = window.matchMedia("(max-width:859px)");
var panelEl = document.getElementById("panel");
var sheet = {h:0, snaps:[0,0,0], y:0}, sd = null;
function sheetSetup(){
  if (!MQ.matches) return;
  var h = panelEl.getBoundingClientRect().height || window.innerHeight*0.9;
  sheet.h = h;
  sheet.snaps = [0, Math.round(h*0.46), Math.max(0, Math.round(h-118))];
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
  if (selectedDistrictFeature){ selectedDistrictFeature = null; applyDeclutter(); }
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
document.getElementById("panelClose").addEventListener("click", function(){ closePanelFully(); });

document.getElementById("hudClose").addEventListener("click", function(){
  document.getElementById("hud").hidden = true;
  document.getElementById("hudReopen").hidden = false;
});
document.getElementById("hudReopen").addEventListener("click", function(){
  document.getElementById("hud").hidden = false;
  document.getElementById("hudReopen").hidden = true;
});

/* ---------- list view — flat, no north/south split (Seoul's own is Han-river-based;
   Busan has no equivalent natural two-way split, so this is one list in v1's own
   BUSAN_LAYOUT district order) ---------- */
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
    + "<label class='lr-chk'><input type='checkbox' data-pid='"+p.id+"'"+(done?" checked":"")+"></label>"
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
    + "</div></div>";
}

function listGroup(ids){
  var filt = catFilterActive();
  var withP = ids.filter(function(id){
    if (!(DISTRICT[id].places || []).length) return false;
    return filt ? visPlaces(id).length > 0 : true;
  });
  var noP = ids.filter(function(id){ return !(DISTRICT[id].places || []).length; });
  var s = "";
  withP.forEach(function(id){
    var d = DISTRICT[id], c = counts(id), nm = d.n.replace("-gu","").replace("-gun",""), vp = visPlaces(id);
    var body = vp.map(listRow).join("");
    s += "<details class='list-d'"+(filt?" open":"")+" data-gu='"+id+"'>"
       + "<summary class='list-dh'>"
         + "<div class='list-dh-top'>"
           + "<span class='list-dname'>"+nm+" <span class='d-kr'>"+d.kr+"</span> <span class='pill count' id='lc-"+id+"'>"+c.vis+"/"+c.total+"</span></span>"
           + "<span class='list-caret' aria-hidden='true'>&#9656;</span>"
         + "</div>"
       + "</summary>"
       + "<div class='list-dbody'>"
         + (vp.length ? body : "<p class='list-none'>No places here.</p>")
         + "<button class='list-openmap' data-gu='"+id+"'>View "+nm+" on the map &#8599;</button>"
       + "</div>"
       + "</details>";
  });
  if (noP.length && !filt){
    s += "<div class='list-empty'><span class='eyebrow'>Nothing picked here yet</span>";
    noP.forEach(function(id){
      var d = DISTRICT[id];
      s += "<p class='list-erow'><button class='list-jump' data-gu='"+id+"'>"+d.n.replace("-gu","").replace("-gun","")+"</button></p>";
    });
    s += "</div>";
  }
  return s;
}

function renderList(){
  var filt = catFilterActive(), np=0, nd=0, vnp=0;
  ALL_IDS.forEach(function(id){ var n=(DISTRICT[id].places||[]).length; if (n){ np+=n; nd++; vnp+=visPlaces(id).length; } });
  return "<div class='p-bar'><button data-back>&lsaquo; Map</button><span class='spacer'></span><button data-close aria-label='Close'>&times;</button></div>"
    + "<h2 class='list-h'>Every place by district</h2>"
    + "<p class='list-sub'>"+(filt ? "<strong>"+vnp+"</strong> of "+np+" places match — tap a chip again or \"All types\" to clear." : np+" places across "+nd+" districts. Tap a district to open it; tick places off as you go.")+"</p>"
    + "<div class='list-tools'><button class='txtbtn' data-expand='1'>Expand all</button><button class='txtbtn' data-expand='0'>Collapse all</button></div>"
    + "<div class='catbar list-catbar' role='group' aria-label='Filter places by type'>"+catbarHTML()+"</div>"
    + listGroup(ALL_IDS);
}

/* ---------- single-place preview card (mirrors app.js's previewPlace) ---------- */
function renderPlacePreview(p){
  var d = DISTRICT[p.district];
  var dname = d ? d.n.replace("-gu","").replace("-gun","") : "";
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
  var more = panelBody.querySelector(".preview-more");
  if (more) more.addEventListener("click", function(){ openFullListAt(id); });
}
function previewPlace(id){
  var p = placesById[id];
  if (!p) return;
  listOpen = false;
  var panel = document.getElementById("panel");
  panel.classList.add("list-mode");
  panel.classList.add("preview-mode");
  document.getElementById("panelBody").innerHTML = renderPlacePreview(p);
  openPanelSheet();
  if (MQ.matches){ sheetSetup(); sheetTo(0, true); }
  wirePlacePreview(id);
}
function openFullListAt(id){
  listOpen = true;
  var panel = document.getElementById("panel");
  panel.classList.remove("preview-mode");
  panel.classList.add("list-mode");
  document.getElementById("panelBody").innerHTML = renderList();
  openPanelSheet();
  if (MQ.matches) sheetTo(sheet.snaps[0], true);
  wireList();
  var row = document.getElementById("card-" + id);
  if (!row) return;
  var details = row.closest("details.list-d");
  if (details) details.open = true;
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
}
