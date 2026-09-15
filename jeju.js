"use strict";

/* ================================================================================
   Jeju — a static illustrated island, not a real map. No MapLibre, no tiles, no
   pan/zoom camera: the art (assets/jeju/jeju-bg.png, recovered from the v1 artifact's
   embedded JEJU_BG) is shown at a fixed "fit the viewport" size, and every place is a
   plain absolutely-positioned pin at a percentage position on that image — v1's own
   design note for this region was "one island, not a set of districts," and that's
   exactly what this keeps: no hand-traced polygons, no district system, nothing Seoul
   or Busan-scale here on purpose.

   This file intentionally duplicates a handful of small, already-proven pieces from
   Seoul's app.js (CAT taxonomy, photoHTML, naverUrl/kakaoUrl, the panel/sheet drag
   mechanics, list-row rendering) rather than importing a shared module — Jeju is the
   first non-Seoul region built, and until Busan exists too (the next one, and a real
   MapLibre region like Seoul), it isn't clear yet which parts are truly generic vs.
   Seoul-specific. Refactor into a real shared.js once there are three regions to
   compare, not two guesses. See the repo README for this rationale in more detail.
   ================================================================================ */

/* ---------- category taxonomy (identical set to Seoul's, same colors) ---------- */
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

/* ---------- persisted state — own localStorage keys, never shared with Seoul's ---------- */
var LS = {visited:"jeju-map:visited", cats:"jeju-map:cats"};
var visited = {}, state = {catSel:{}, allOff:false};
try { visited = JSON.parse(localStorage.getItem(LS.visited) || "{}") || {}; } catch(e) {}
try { state.catSel = JSON.parse(localStorage.getItem(LS.cats) || "{}") || {}; } catch(e) {}
function saveVisited(){ try{ localStorage.setItem(LS.visited, JSON.stringify(visited)); }catch(e){} }
function saveCats(){ try{ localStorage.setItem(LS.cats, JSON.stringify(state.catSel)); }catch(e){} }
function catFilterActive(){ for (var k in state.catSel) if (state.catSel[k]) return true; return false; }
function catOn(t){ return !catFilterActive() || !!state.catSel[foldCat(t)]; }

/* ---------- data ---------- */
var DATA = null, placesById = {}, listOpen = false;

/* Naver/Kakao search links prefer the place's own curated query (q) over its name — v1's
   JEJU_LOCATIONS entries each carry a search string tuned to actually find the right result
   (e.g. "Hallasan National Park" rather than the bare word "Hallasan"). */
function naverUrl(p){ return "https://map.naver.com/p/search/" + encodeURIComponent(p.q || p.name_kr || p.name); }
function kakaoUrl(p){ return "https://map.kakao.com/?q=" + encodeURIComponent(p.q || p.name_kr || p.name); }

function photoHTML(p){
  return p.img
    ? "<img src='"+p.img+"' alt='' loading='lazy'>"
    : "<span class='ph' style='background:"+catColor(p.category)+"22'></span>";
}

/* ---------- category filter chips (identical pattern to Seoul's) ---------- */
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
  document.querySelectorAll(".jpin").forEach(function(el){
    var id = el.getAttribute("data-id"), p = placesById[id];
    if (!p) return;
    var show = !state.allOff && catOn(p.category);
    el.hidden = !show;
  });
}

/* ---------- the island art + pins ---------- */
var stage = document.getElementById("jejuStage");
var pinLayer = document.getElementById("jejuPins");

/* computes the rendered rect of #jejuImg within its container under object-fit:contain —
   pins are positioned against THIS rect (in stage-relative px), not the wider container,
   so a letterboxed edge (a wide/tall viewport that doesn't match the art's own aspect
   ratio) never ends up hosting a pin. */
function imageRect(){
  var cw = stage.clientWidth, ch = stage.clientHeight;
  var iw = DATA.meta.bg.w, ih = DATA.meta.bg.h;
  var scale = Math.min(cw / iw, ch / ih);
  var rw = iw * scale, rh = ih * scale;
  return {ox: (cw - rw) / 2, oy: (ch - rh) / 2, rw: rw, rh: rh, scale: scale};
}

function buildPins(){
  pinLayer.innerHTML = "";
  DATA.places.forEach(function(p){
    var btn = document.createElement("button");
    btn.className = "jpin" + (p.dot ? "" : " is-landmark");
    btn.setAttribute("data-id", p.id);
    btn.setAttribute("aria-label", p.name);
    var hit = document.createElement("span");
    hit.className = "jpin-hit";
    var hitPx = (p.hitRadius || 40) * 2;
    hit.style.width = hitPx + "px"; hit.style.height = hitPx + "px";
    var dot = document.createElement("span");
    dot.className = "jpin-dot";
    dot.style.background = catColor(p.category);
    var lbl = document.createElement("span");
    lbl.className = "jpin-lbl";
    lbl.textContent = p.name;
    btn.appendChild(hit); btn.appendChild(dot); btn.appendChild(lbl);
    btn.addEventListener("click", function(){ previewPlace(p.id); });
    pinLayer.appendChild(btn);
  });
  layoutPins();
}
function layoutPins(){
  var r = imageRect();
  DATA.places.forEach(function(p){
    var el = pinLayer.querySelector('[data-id="'+p.id+'"]');
    if (!el) return;
    /* hit-radius (an image-space size, like v1's own m.r) scales with the art itself
       rather than staying a fixed screen size, so "tap anywhere on Hallasan" keeps
       covering roughly the same fraction of the icon at any viewport size. */
    var hit = el.querySelector(".jpin-hit");
    var hitPx = (p.hitRadius || 40) * 2 * r.scale;
    hit.style.width = hitPx + "px"; hit.style.height = hitPx + "px";
    el.style.left = (r.ox + (p.xPct / 100) * r.rw) + "px";
    el.style.top = (r.oy + (p.yPct / 100) * r.rh) + "px";
  });
}
window.addEventListener("resize", layoutPins);

/* ---------- a single place row (mirrors Seoul's listRow — same markup/classes, no
   district field to carry) ---------- */
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

/* ---------- flat list view — no districts to group by, so this splits only on the same
   landmark/dot distinction the source data itself uses (v1's big-icon vs. small-cafe-dot
   pins), rather than reinventing a grouping scheme for 20 places that don't need one. ---- */
function renderList(){
  var filt = catFilterActive();
  var vis = DATA.places.filter(function(p){ return catOn(p.category); });
  var landmarks = vis.filter(function(p){ return !p.dot; });
  var cafes = vis.filter(function(p){ return p.dot; });
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

/* ---------- single-place preview card (mirrors Seoul's previewPlace/renderPlacePreview —
   same "See all" escape hatch, just pointed at the one flat list instead of a district). */
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
  if (more) more.addEventListener("click", function(){
    listOpen = true;
    document.getElementById("panel").classList.remove("preview-mode");
    document.getElementById("panelBody").innerHTML = renderList();
    wireList();
  });
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

/* ---------- draggable bottom sheet (mobile) — identical mechanics to Seoul's app.js;
   see that file's own comments for the full rationale (3 snap points, why .p-bar isn't
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

/* ---------- boot ---------- */
fetch("data/jeju-places.json").then(function(r){ return r.json(); }).then(function(data){
  DATA = data;
  data.places.forEach(function(p){ placesById[p.id] = p; });
  buildPins();
  applyCatFilter();
  document.querySelectorAll(".catbar").forEach(function(bar){
    bar.innerHTML = catbarHTML();
    wireCatbar(bar);
    syncCatbar(bar);
  });
  updateProgress();
}).catch(function(err){
  console.error("Failed to load Jeju data:", err);
  document.getElementById("panelBody").innerHTML = "<p>Failed to load map data — check that data/jeju-places.json exists and the site is served over http(s), not file://.</p>";
  document.getElementById("panel").classList.add("open");
});
