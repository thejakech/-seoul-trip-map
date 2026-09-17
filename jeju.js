"use strict";

/* ================================================================================
   Jeju — a real MapLibre map, same engine as Seoul's/Busan's, but deliberately the
   simplest of the three:

   - No district system. v1's own design note for this region was "one island, not
     a set of districts," and Jeju was never worth splitting up the way Seoul's 25
     gu or Busan's 16 gu/gun are — it's a single flat list of 20 places.
   - No 3D toggle, no "Streets On" declutter, no floating-island crop. Those all
     exist to manage a district-fill layer or a complex multi-piece coastline —
     Jeju has neither, so there's nothing for them to do. Just real tiles + pins.
   - No custom color theme. The purple-for-Busan / pink-for-Seoul palette overrides
     exist to recolor a district-fill layer that this page doesn't have; without one,
     there's no fill to recolor, so this page just uses style.css's own defaults.

   This replaces an earlier build that showed a single static illustrated image
   (assets/jeju/jeju-bg.png) with pins placed at %-positions computed from the
   image's own object-fit:contain rect. That math broke down at phone aspect
   ratios the art didn't anticipate — the image would end up tiny and letterboxed,
   making the whole map nearly unusable on mobile. A real map has no such problem:
   MapLibre's canvas simply fills its container at any viewport size.

   Still duplicates the same small proven pieces as app.js/busan.js (CAT taxonomy,
   photoHTML, naverUrl/kakaoUrl, panel/sheet drag mechanics, list-row rendering) —
   see busan.js's own comment for why this hasn't been pulled into a shared module.
   ================================================================================ */

/* ---------- category taxonomy (identical set to Seoul's/Busan's) ---------- */
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

/* ---------- persisted state — own localStorage keys, never shared with Seoul's/Busan's ---- */
var LS = {visited:"jeju-map:visited", cats:"jeju-map:cats"};
var visited = {}, state = {catSel:{}, allOff:false};
try { visited = JSON.parse(localStorage.getItem(LS.visited) || "{}") || {}; } catch(e) {}
try { state.catSel = JSON.parse(localStorage.getItem(LS.cats) || "{}") || {}; } catch(e) {}
function saveVisited(){ try{ localStorage.setItem(LS.visited, JSON.stringify(visited)); }catch(e){} }
function saveCats(){ try{ localStorage.setItem(LS.cats, JSON.stringify(state.catSel)); }catch(e){} }
function catFilterActive(){ for (var k in state.catSel) if (state.catSel[k]) return true; return false; }
function catOn(t){ return !catFilterActive() || !!state.catSel[foldCat(t)]; }

/* ---------- data (populated after fetch) ---------- */
var DATA = null, placesById = {}, listOpen = false;

/* Naver/Kakao search links prefer the place's own curated query (q) over its name — v1's
   JEJU_LOCATIONS entries each carry a search string tuned to actually find the right result
   (e.g. "Hallasan National Park" rather than the bare word "Hallasan"). */
function naverUrl(p){ return p.naver_url || ("https://map.naver.com/p/search/" + encodeURIComponent(p.q || p.name_kr || p.name)); }
function kakaoUrl(p){ return "https://map.kakao.com/?q=" + encodeURIComponent(p.q || p.name_kr || p.name); }

function photoHTML(p){
  return p.img
    ? "<img src='"+p.img+"' alt='' loading='lazy'>"
    : "<span class='ph' style='background:"+catColor(p.category)+"22'></span>";
}

/* ---------- map ---------- */
/* Rough centroid/zoom for the whole island — used only as the initial camera before the
   real fitBounds (computed from the 20 places' own lat/lng, below) takes over on load. */
var PLACEHOLDER_VIEW = {center:[126.53, 33.38], zoom:9.6, pitch:0, bearing:0};
var map = new maplibregl.Map(Object.assign({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  attributionControl: {compact:true}
}, PLACEHOLDER_VIEW));
map.addControl(new maplibregl.NavigationControl({visualizePitch:false}), "bottom-right");
map.on("error", function(e){ console.error("MapLibre error:", e && e.error && e.error.message); });

var FIT_PADDING = {top:190, bottom:50, left:40, right:40};
var jejuBounds = null;
function fitJeju(duration){
  if (!jejuBounds) return;
  map.fitBounds(jejuBounds, {padding: FIT_PADDING, pitch:0, bearing:0, duration: duration===undefined?600:duration});
}
document.getElementById("btnFit").addEventListener("click", function(){ fitJeju(600); });

var jejuLoaded = false;
map.on("load", function(){
  /* guards against this handler's body running twice — reproduced once in testing on the
     Busan build (a second call re-adds a source MapLibre already has, throws, and the .catch
     below replaces the whole panel with an error), and treated here as a real possibility on
     mobile browsers too (map "load" re-firing after a tab is suspended/resumed, a style
     re-fetch retry on a flaky connection, etc.), not just a testing artifact. */
  if (jejuLoaded) return;
  jejuLoaded = true;
  fetch("data/jeju-places.json").then(function(r){ return r.json(); }).then(function(data){
    init(data);
  }).catch(function(err){
    console.error("Failed to load Jeju data:", err);
    document.getElementById("panelBody").innerHTML = "<p>Failed to load map data — check that data/jeju-places.json exists and the site is served over http(s), not file://.</p>";
    openPanelSheet();
  });
});

function init(data){
  DATA = data;
  data.places.forEach(function(p){ placesById[p.id] = p; });

  jejuBounds = new maplibregl.LngLatBounds();
  data.places.forEach(function(p){ if (p.lat && p.lng) jejuBounds.extend([p.lng, p.lat]); });
  fitJeju(0);

  var pointsGeo = {
    type:"FeatureCollection",
    features: data.places.filter(function(p){ return p.lat && p.lng; }).map(function(p){
      return {type:"Feature", properties:{id:p.id, category:p.category, categoryFold:foldCat(p.category)},
              geometry:{type:"Point", coordinates:[p.lng, p.lat]}};
    })
  };
  map.addSource("places", {type:"geojson", data: pointsGeo});
  map.addLayer({
    id:"place-points", type:"circle", source:"places",
    paint:{
      /* Jeju has only 20 places spread across a whole island, not a dense cluster like
         Seoul's Ikseon-dong or Itaewon — none of Seoul's small-at-low-zoom-to-avoid-overlap
         reasoning applies here, so these are deliberately much bigger and more visible at
         every zoom instead of matching app.js's tiny 2.5px starting radius. */
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 10, 8, 12, 10, 14, 13, 17, 16],
      "circle-color": ["match", ["get","categoryFold"],
        "food", CAT.food.color, "cafe", CAT.cafe.color, "market", CAT.market.color,
        "museum", CAT.museum.color, "park", CAT.park.color, "view", CAT.view.color,
        "shop", CAT.shop.color, "night", CAT.night.color, "#999"],
      "circle-stroke-width":2.5, "circle-stroke-color":"#fff"
    }
  });
  /* invisible, larger tap target — same rationale as app.js/busan.js: the visible dot
     stays tiny at low zoom on purpose, so taps need a bigger target underneath it. */
  map.addLayer({
    id:"place-points-hit", type:"circle", source:"places",
    paint:{
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 13, 10, 15, 12, 17, 14, 19, 17, 22],
      "circle-opacity": 0, "circle-stroke-width": 0
    }
  });

  map.on("click", "place-points-hit", function(e){
    var id = e.features[0].properties.id;
    var p = placesById[id];
    if (!p) return;
    map.flyTo({center:[p.lng, p.lat], zoom: Math.max(map.getZoom(), 12.5), duration:700});
    new maplibregl.Popup({closeButton:false, offset:12})
      .setLngLat([p.lng, p.lat])
      .setHTML("<b>"+p.name+"</b><br><span style='color:#888'>"+catLabel(p.category)+"</span>")
      .addTo(map);
    previewPlace(id);
  });
  map.on("mouseenter", "place-points-hit", function(){ map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "place-points-hit", function(){ map.getCanvas().style.cursor = ""; });

  /* Where they're actually sleeping in Jeju -- same fixed-marker treatment as grandma's place
     on the Seoul map (see app.js), kept OUTSIDE the places/category system so it always shows
     regardless of category filters and never appears in list view or a district's place cards.
     Two markers: the trip moves between them partway through the Jeju stretch. */
  [
    {lngLat:[126.4486336, 33.4590759], label:"Jeju Navy Hotel", sub:"해안마을서2길 19, Jeju-si"},
    {lngLat:[126.3945474, 33.2732873], label:"Seogwipo Hotel", sub:"319 Sangye-ro, Yerae-dong, Seogwipo-si"}
  ].forEach(function(h){
    var hotelEl = document.createElement("div");
    hotelEl.textContent = "🏠";
    hotelEl.style.fontSize = "28px";
    hotelEl.style.lineHeight = "1";
    hotelEl.style.cursor = "pointer";
    hotelEl.setAttribute("role", "img");
    hotelEl.setAttribute("aria-label", h.label);
    new maplibregl.Marker({element: hotelEl, anchor:"bottom"})
      .setLngLat(h.lngLat)
      .setPopup(new maplibregl.Popup({closeButton:false, offset:20})
        .setHTML("<b>🏠 "+h.label+"</b><br><span style='color:#888'>"+h.sub+"</span>"))
      .addTo(map);
  });

  applyCatFilter();
  document.querySelectorAll(".catbar").forEach(function(bar){
    bar.innerHTML = catbarHTML();
    wireCatbar(bar);
    syncCatbar(bar);
  });
  updateProgress();
}

/* ---------- category filter chips (identical pattern to Seoul's/Busan's) ---------- */
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
  if (!map.getLayer("place-points")) return;
  if (state.allOff){ map.setFilter("place-points", false); map.setFilter("place-points-hit", false); return; }
  var active = CAT_ORDER.filter(function(k){ return !!state.catSel[k]; });
  var f = active.length ? ["in", ["get","categoryFold"], ["literal", active]] : null;
  map.setFilter("place-points", f);
  map.setFilter("place-points-hit", f);
}

/* ---------- a single place row (mirrors Seoul's/Busan's listRow) ---------- */
function listRow(p){
  var done = !!visited[p.id];
  return "<div class='lr"+(done?" done":"")+"' id='card-"+p.id+"'>"
    + "<label class='lr-chk'><input type='checkbox' data-pid='"+p.id+"'"+(done?" checked":"")+"></label>"
    + "<a class='lr-photo' href='"+naverUrl(p)+"' target='_blank' rel='noopener' aria-label='"+p.name+" on Naver Map'>"+photoHTML(p)+"</a>"
    + "<div class='lr-main'>"
      + "<div class='lr-top'><span class='lr-name'>"+p.name+" "+(p.name_kr?"<span class='lr-kr'>"+p.name_kr+"</span>":"")+"</span></div>"
      + "<span class='chiptype lr-cat'><i class='cdot' style=\"background:"+catColor(p.category)+"\"></i>"+catLabel(p.category)+"</span>"
      + (p.note ? "<div class='lr-meta'>"+p.note+"</div>" : "")
      + "<div class='lr-links'>"
      +   "<a class='maplink' href='"+naverUrl(p)+"' target='_blank' rel='noopener'>Naver</a>"
      +   "<a class='maplink' href='"+kakaoUrl(p)+"' target='_blank' rel='noopener'>Kakao</a>"
      +   (p.unverified ? "<span class='verify'>check name</span>" : "")
      + "</div>"
    + "</div></div>";
}

function onToggle(e){
  var cb = e.target;
  var id = cb.dataset.pid || cb.getAttribute("data-pid");
  visited[id] = cb.checked;
  saveVisited();
  var card = cb.closest(".lr");
  if (card) card.classList.toggle("done", cb.checked);
  updateProgress();
}
function updateProgress(){
  if (!DATA) return;
  var total = DATA.places.length;
  var done = DATA.places.filter(function(p){ return visited[p.id]; }).length;
  document.getElementById("progressCount").textContent = done + " / " + total;
  document.getElementById("progressFill").style.width = (total ? (done/total*100) : 0) + "%";
}

/* ---------- flat list view — no districts to group by, so this splits only on the
   category the source data already carries (park/view landmarks vs. cafes), rather
   than reinventing a grouping scheme for 20 places that don't need one. ---------- */
function renderList(){
  var filt = catFilterActive();
  var vis = DATA.places.filter(function(p){ return catOn(p.category); });
  var landmarks = vis.filter(function(p){ return p.category !== "cafe"; });
  var cafes = vis.filter(function(p){ return p.category === "cafe"; });
  var html = "<div class='p-bar'><button data-back>&lsaquo; Map</button><span class='spacer'></span><button data-close aria-label='Close'>&times;</button></div>"
    + "<h2 class='list-h'>Every Jeju pick</h2>"
    + "<p class='list-sub'>"+(filt ? "<strong>"+vis.length+"</strong> of "+DATA.places.length+" places match — tap a chip again or \"All types\" to clear." : DATA.places.length+" places. Tick places off as you go.")+"</p>"
    + "<div class='catbar list-catbar' role='group' aria-label='Filter places by type'>"+catbarHTML()+"</div>";
  if (landmarks.length){
    html += "<div class='list-band'><span class='eyebrow'>Landmarks</span></div>" + landmarks.map(listRow).join("");
  }
  if (cafes.length){
    html += "<div class='list-band'><span class='eyebrow'>Cafes &amp; small spots</span></div>" + cafes.map(listRow).join("");
  }
  if (!vis.length){
    html += "<p class='list-none'>Nothing matches this filter.</p>";
  }
  return html;
}
function wireList(){
  var panelBody = document.getElementById("panelBody");
  var closeBtn = panelBody.querySelector("[data-close]");
  if (closeBtn) closeBtn.addEventListener("click", closePanelFully);
  var backBtn = panelBody.querySelector("[data-back]");
  if (backBtn) backBtn.addEventListener("click", closePanelFully);
  var lcb = panelBody.querySelector(".list-catbar");
  if (lcb){ wireCatbar(lcb); syncCatbar(lcb); }
  panelBody.querySelectorAll("input[type=checkbox]").forEach(function(cb){ cb.addEventListener("change", onToggle); });
}
document.getElementById("btnList").addEventListener("click", function(){
  listOpen = true;
  document.getElementById("panel").classList.remove("preview-mode");
  document.getElementById("panel").classList.add("list-mode");
  document.getElementById("panelBody").innerHTML = renderList();
  openPanelSheet();
  wireList();
});

/* ---------- single-place preview card (mirrors Seoul's/Busan's previewPlace) ---------- */
function renderPlacePreview(p){
  return "<div class='p-bar'><button data-back>&lsaquo; Map</button><span class='spacer'></span><button data-close aria-label='Close'>&times;</button></div>"
    + listRow(p)
    + "<button class='txtbtn preview-more'>See all Jeju picks &rsaquo;</button>";
}
function wirePlacePreview(){
  var panelBody = document.getElementById("panelBody");
  var closeBtn = panelBody.querySelector("[data-close]");
  if (closeBtn) closeBtn.addEventListener("click", closePanelFully);
  var backBtn = panelBody.querySelector("[data-back]");
  if (backBtn) backBtn.addEventListener("click", closePanelFully);
  panelBody.querySelectorAll("input[type=checkbox]").forEach(function(cb){ cb.addEventListener("change", onToggle); });
  var more = panelBody.querySelector(".preview-more");
  if (more) more.addEventListener("click", function(){ openFullList(); });
}
function openFullList(){
  listOpen = true;
  var panel = document.getElementById("panel");
  panel.classList.remove("preview-mode");
  panel.classList.add("list-mode");
  document.getElementById("panelBody").innerHTML = renderList();
  openPanelSheet();
  wireList();
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
  wirePlacePreview();
}

/* ---------- draggable bottom sheet (mobile) — identical mechanics to app.js/busan.js;
   see app.js's own comments for the full rationale (3 snap points, why .p-bar isn't
   sticky in .preview-mode, etc.) ---------- */
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
document.getElementById("panelClose").addEventListener("click", closePanelFully);

/* ---------- collapse/reopen the whole HUD card ---------- */
document.getElementById("hudClose").addEventListener("click", function(){
  document.getElementById("hud").hidden = true;
  document.getElementById("hudReopen").hidden = false;
});
document.getElementById("hudReopen").addEventListener("click", function(){
  document.getElementById("hud").hidden = false;
  document.getElementById("hudReopen").hidden = true;
});
