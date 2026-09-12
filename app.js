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

/* ---------- persisted state ---------- */
var LS = {visited:"seoul-map:visited", cats:"seoul-map:cats"};
var visited = {}, state = {catSel:{}};
try { visited = JSON.parse(localStorage.getItem(LS.visited) || "{}") || {}; } catch(e) {}
try { state.catSel = JSON.parse(localStorage.getItem(LS.cats) || "{}") || {}; } catch(e) {}
function saveVisited(){ try{ localStorage.setItem(LS.visited, JSON.stringify(visited)); }catch(e){} }
function saveCats(){ try{ localStorage.setItem(LS.cats, JSON.stringify(state.catSel)); }catch(e){} }
function catFilterActive(){ for (var k in state.catSel) if (state.catSel[k]) return true; return false; }
function catOn(t){ return !catFilterActive() || !!state.catSel[foldCat(t)]; }

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
var DEFAULT_VIEW = {center:[126.9880, 37.5540], zoom:10.4, pitch:0, bearing:0};
var map = new maplibregl.Map(Object.assign({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  attributionControl: {compact:true}
}, DEFAULT_VIEW));
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), "bottom-right");
map.on("error", function(e){ console.error("MapLibre error:", e && e.error && e.error.message); });

document.getElementById("btnFit").addEventListener("click", function(){
  map.easeTo(Object.assign({duration:600}, DEFAULT_VIEW));
});

var is3D = false, isDeclutter = false;

/* the liberty style ships its own fill-extrusion building layer ("building-3d") — it is
   VISIBLE BY DEFAULT (no layout.visibility set), so it must be explicitly hidden on load,
   otherwise buildings appear at zoom>=14 before the 3D button is ever pressed */
function apply3D(){
  if (map.getLayer("building-3d")) {
    map.setLayoutProperty("building-3d", "visibility", (is3D && !isDeclutter) ? "visible" : "none");
  }
}
document.getElementById("btn3d").addEventListener("click", function(){
  is3D = !is3D;
  this.setAttribute("aria-pressed", is3D);
  map.easeTo({pitch: is3D ? 58 : 0, bearing: is3D ? -12 : 0, duration: 600});
  apply3D();
});

/* ---------- "no streets" declutter toggle ----------
   Hides every base-style road/rail/POI/label/building/admin-boundary layer, leaving only
   background/water/landcover/landuse (still "land") plus this app's own district-fill,
   district-line, district-label and place-points layers. The Han River itself (its fill +
   line geometry) stays visible as a geographic anchor — only its text label is hidden. */
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

function applyDeclutter(){
  DECLUTTER_HIDE_IDS.forEach(function(id){
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", isDeclutter ? "none" : "visible");
  });
  apply3D(); // declutter also forces buildings off regardless of the 3D toggle
}
document.getElementById("btnDeclutter").addEventListener("click", function(){
  isDeclutter = !isDeclutter;
  this.setAttribute("aria-pressed", isDeclutter);
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
  if (!seoulOutline) return;
  /* clip the inner canvas layer, NOT #map itself — #map also contains the zoom +/- control
     (a fixed screen corner), which would otherwise get clipped away along with everything
     else whenever Seoul's silhouette doesn't happen to reach that corner */
  var canvasLayer = document.querySelector("#map .maplibregl-canvas-container") || document.getElementById("map");
  var pts = seoulOutline.map(function(ll){
    var p = map.project(ll);
    return p.x.toFixed(1) + "px " + p.y.toFixed(1) + "px";
  });
  canvasLayer.style.clipPath = "polygon(" + pts.join(",") + ")";
}

map.on("load", function(){
  Promise.all([
    fetch("data/districts.geojson").then(r=>r.json()),
    fetch("data/places.json").then(r=>r.json()),
    fetch("data/seoul-outline.json").then(r=>r.json())
  ]).then(function(results){
    seoulOutline = results[2].outline;
    updateMapClip();
    map.on("move", updateMapClip);
    map.on("resize", updateMapClip);
    init(results[0], results[1]);
  }).catch(function(err){
    console.error("Failed to load data:", err);
    document.getElementById("panelBody").innerHTML = "<p>Failed to load map data — check that data/districts.geojson, data/places.json and data/seoul-outline.json exist and the site is served over http(s), not file://.</p>";
    document.getElementById("panel").classList.add("open");
  });
  apply3D(); // hide the style's own building-3d layer immediately, before data even loads
});

function init(districtsGeo, data){
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
  /* district name labels — MapLibre places one label per polygon feature automatically
     (an interior "pole of inaccessibility" point), no manual centroid math needed */
  map.addLayer({
    id:"district-label", type:"symbol", source:"districts",
    layout:{
      "text-field": ["get","label"], "text-size": 13, "text-font": ["Noto Sans Bold"],
      "symbol-placement": "point", "text-allow-overlap": false
    },
    paint:{
      "text-color": LABEL_COLOR, "text-halo-color": LABEL_HALO, "text-halo-width": 1.4
    }
  });

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
      "circle-radius": 6,
      "circle-color": ["match", ["get","categoryFold"],
        "food", CAT.food.color, "cafe", CAT.cafe.color, "market", CAT.market.color,
        "museum", CAT.museum.color, "park", CAT.park.color, "view", CAT.view.color,
        "shop", CAT.shop.color, "night", CAT.night.color, "#999"],
      "circle-stroke-width":1.5, "circle-stroke-color":"#fff"
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
    f.geometry.coordinates.forEach(function(ring){ ring.forEach(function(c){ b.extend(c); }); });
    map.fitBounds(b, {padding:80, duration:700});
  }
  function selectDistrict(id){
    listOpen = false;
    document.getElementById("panel").classList.remove("list-mode");
    setSelected(id);
    openDistrict(id);
    flyToDistrict(id);
  }

  map.on("click", "district-fill", function(e){ selectDistrict(e.features[0].properties.id); });

  map.on("click", "place-points", function(e){
    var id = e.features[0].properties.id;
    var p = placesById[id];
    if (!p) return;
    map.flyTo({center:[p.lng, p.lat], zoom: Math.max(map.getZoom(), 15), duration:700});
    new maplibregl.Popup({closeButton:false, offset:12})
      .setLngLat([p.lng, p.lat])
      .setHTML("<b>"+p.name+"</b><br><span style='color:#888'>"+catLabel(p.category)+"</span>")
      .addTo(map);
  });

  ["district-fill","place-points"].forEach(function(l){
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
   the active filter set; an empty set means "show everything"; "All types" clears it. ---------- */
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
      ch.classList.toggle("off", active && !sel);
      ch.style.borderColor = sel ? CAT[k].color : "";
      ch.style.color = sel ? CAT[k].color : "";
    } else {
      ch.classList.toggle("on", active);
    }
  });
}
function wireCatbar(container){
  if (!container) return;
  container.querySelectorAll(".catchip").forEach(function(ch){
    ch.addEventListener("click", function(e){
      e.stopPropagation();
      var k = ch.getAttribute("data-cat");
      if (!k) { state.catSel = {}; }
      else { state.catSel[k] = !state.catSel[k]; if (!state.catSel[k]) delete state.catSel[k]; }
      saveCats();
      document.querySelectorAll(".catbar").forEach(syncCatbar);
      applyCatFilter();
      if (listOpen) { document.getElementById("panelBody").innerHTML = renderList(); wireList(); }
    });
  });
}
function applyCatFilter(){
  var active = CAT_ORDER.filter(function(k){ return !!state.catSel[k]; });
  map.setFilter("place-points", active.length ? ["in", ["get","categoryFold"], ["literal", active]] : null);
}
function visPlaces(id){ return (DISTRICT[id].places || []).filter(function(p){ return catOn(p.category); }); }
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
    html += "<div class='hood-block' style='--hood-color:"+hm.color+"'><h3 style='color:"+hm.color+"'>&#9733; "+hm.name+" <span class='kr'>"+hm.kr+"</span></h3>";
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
  document.getElementById("panel").classList.add("open");
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

/* ---------- panel close ---------- */
document.getElementById("panelClose").addEventListener("click", function(){
  document.getElementById("panel").classList.remove("open");
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
  var panel = document.getElementById("panel");
  panel.classList.add("open", "list-mode");
  document.getElementById("panelBody").innerHTML = renderList();
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
      +   (p.sourced_from_video ? "<span class='fromvid'>video</span>" : "")
      + "</div>"
    + "</div></div>";
}

function listGroup(label, ids){
  var filt = catFilterActive();
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
           + (c.picks===0 ? "<span class='pill vid'>video</span>" : "")
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
  var filt = catFilterActive(), np=0, nd=0, vnp=0;
  ALL_IDS.forEach(function(id){ var n=(DISTRICT[id].places||[]).length; if (n){ np+=n; nd++; vnp+=visPlaces(id).length; } });
  var buk = ALL_IDS.filter(function(id){ return DISTRICT[id].side==="buk"; });
  var nam = ALL_IDS.filter(function(id){ return DISTRICT[id].side==="nam"; });
  return "<div class='p-bar'><button data-back>&lsaquo; Map</button><span class='spacer'></span><button data-close aria-label='Close'>&times;</button></div>"
    + "<h2 class='list-h'>Every place by district</h2>"
    + "<p class='list-sub'>"+(filt ? "<strong>"+vnp+"</strong> of "+np+" places match — tap a chip again or \"All types\" to clear." : np+" places across "+nd+" districts. Tap a district to open it; tick places off as you go.")+"</p>"
    + "<div class='list-tools'><button class='txtbtn' data-expand='1'>Expand all</button><button class='txtbtn' data-expand='0'>Collapse all</button></div>"
    + "<div class='catbar list-catbar' role='group' aria-label='Filter places by type'>"+catbarHTML()+"</div>"
    + listGroup("North of the Han", buk) + listGroup("South of the Han", nam);
}

function wireList(){
  var panel = document.getElementById("panel"), panelBody = document.getElementById("panelBody");
  var closeBtn = panelBody.querySelector("[data-close]");
  if (closeBtn) closeBtn.addEventListener("click", function(){ panel.classList.remove("open","list-mode"); listOpen=false; });
  var backBtn = panelBody.querySelector("[data-back]");
  if (backBtn) backBtn.addEventListener("click", function(){ panel.classList.remove("open","list-mode"); listOpen=false; });
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
