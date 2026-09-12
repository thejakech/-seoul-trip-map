"use strict";

/* ---------- category taxonomy ---------- */
var CAT = {
  food:{label:"Food", color:"#e0707f"}, cafe:{label:"Cafe", color:"#d9a24f"},
  market:{label:"Market", color:"#c9ae3a"}, museum:{label:"Museum", color:"#7c8fd0"},
  park:{label:"Park", color:"#5fae82"}, view:{label:"Viewpoint", color:"#4fa0c9"},
  shop:{label:"Shop", color:"#c072a8"}, temple:{label:"Temple", color:"#3fae9b"},
  landmark:{label:"Landmark", color:"#d68a55"}, night:{label:"Nightlife", color:"#9a6bc4"}
};
var CAT_ORDER = ["food","cafe","market","museum","park","view","shop","temple","landmark","night"];

/* ---------- persisted state ---------- */
var LS = {visited:"seoul-map:visited", cats:"seoul-map:cats"};
var visited = {}, catOff = {};
try { visited = JSON.parse(localStorage.getItem(LS.visited) || "{}") || {}; } catch(e) {}
try { catOff = JSON.parse(localStorage.getItem(LS.cats) || "{}") || {}; } catch(e) {}
function saveVisited(){ try{ localStorage.setItem(LS.visited, JSON.stringify(visited)); }catch(e){} }
function saveCats(){ try{ localStorage.setItem(LS.cats, JSON.stringify(catOff)); }catch(e){} }

/* ---------- data (populated after fetch) ---------- */
var DATA = null; // {meta, districts, neighborhoods, places}
var placesById = {};
var placesByDistrict = {};

/* ---------- map ---------- */
var map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [126.9880, 37.5540],
  zoom: 10.4,
  pitch: 0,
  attributionControl: {compact:true}
});
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), "bottom-right");

var is3D = false;
document.getElementById("btn3d").addEventListener("click", function(){
  is3D = !is3D;
  this.setAttribute("aria-pressed", is3D);
  map.easeTo({pitch: is3D ? 58 : 0, bearing: is3D ? -12 : 0, duration: 600});
  if (map.getLayer("3d-buildings")) map.setLayoutProperty("3d-buildings","visibility", is3D ? "visible":"none");
});

map.on("load", function(){
  Promise.all([
    fetch("data/districts.geojson").then(r=>r.json()),
    fetch("data/places.json").then(r=>r.json())
  ]).then(function(results){
    var districts = results[0];
    DATA = results[1];
    init(districts, DATA);
  }).catch(function(err){
    console.error("Failed to load data:", err);
    document.getElementById("panelBody").innerHTML = "<p>Failed to load map data — check that data/districts.geojson and data/places.json exist and the site is served over http(s), not file://.</p>";
    document.getElementById("panel").classList.add("open");
  });

  // free, keyless 3D: extrude real OSM building footprints from the openmaptiles source
  map.addLayer({
    id:"3d-buildings", type:"fill-extrusion", source:"openmaptiles", "source-layer":"building",
    minzoom: 14, layout:{visibility:"none"},
    paint:{
      "fill-extrusion-color":"#c9ccd6",
      "fill-extrusion-height":["coalesce",["get","render_height"],["*",["coalesce",["get","levels"],3],3]],
      "fill-extrusion-base":["coalesce",["get","render_min_height"],0],
      "fill-extrusion-opacity":0.85
    }
  });
});

function init(districtsGeo, data){
  data.places.forEach(function(p){
    placesById[p.id] = p;
    (placesByDistrict[p.district] = placesByDistrict[p.district] || []).push(p);
  });

  map.addSource("districts", {type:"geojson", data: districtsGeo});
  map.addLayer({
    id:"district-fill", type:"fill", source:"districts",
    paint:{"fill-color":"#7c8fd0", "fill-opacity":["case",["boolean",["feature-state","selected"],false],0.28,0.06]}
  });
  map.addLayer({
    id:"district-line", type:"line", source:"districts",
    paint:{"line-color":"#5d636b", "line-width":["case",["boolean",["feature-state","selected"],false],2,0.6],
           "line-opacity":0.6}
  });

  var pointsGeo = {
    type:"FeatureCollection",
    features: data.places.filter(p=>p.lat && p.lng).map(function(p){
      return {type:"Feature", properties:{id:p.id, category:p.category},
              geometry:{type:"Point", coordinates:[p.lng, p.lat]}};
    })
  };
  map.addSource("places", {type:"geojson", data: pointsGeo});
  map.addLayer({
    id:"place-points", type:"circle", source:"places",
    paint:{
      "circle-radius": 6,
      "circle-color": ["match", ["get","category"],
        "food", CAT.food.color, "cafe", CAT.cafe.color, "market", CAT.market.color,
        "museum", CAT.museum.color, "park", CAT.park.color, "view", CAT.view.color,
        "shop", CAT.shop.color, "temple", CAT.temple.color, "landmark", CAT.landmark.color,
        "night", CAT.night.color, "#999"],
      "circle-stroke-width":1.5, "circle-stroke-color":"#fff"
    }
  });

  var selectedDistrict = null;
  map.on("click", "district-fill", function(e){
    var f = e.features[0];
    var id = f.properties.id;
    if (selectedDistrict) map.setFeatureState({source:"districts", id:selectedDistrict}, {selected:false});
    selectedDistrict = f.id;
    map.setFeatureState({source:"districts", id:selectedDistrict}, {selected:true});
    openDistrict(id, data);
    var b = new maplibregl.LngLatBounds();
    (f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat())
      .forEach(function(ring){ ring.forEach(function(c){ b.extend(c); }); });
    map.fitBounds(b, {padding:80, duration:700});
  });

  map.on("click", "place-points", function(e){
    var id = e.features[0].properties.id;
    var p = placesById[id];
    if (!p) return;
    map.flyTo({center:[p.lng, p.lat], zoom: Math.max(map.getZoom(), 15), duration:700});
    new maplibregl.Popup({closeButton:false, offset:12})
      .setLngLat([p.lng, p.lat])
      .setHTML("<b>"+p.name+"</b><br><span style='color:#888'>"+CAT[p.category].label+"</span>")
      .addTo(map);
  });

  ["district-fill","place-points"].forEach(function(l){
    map.on("mouseenter", l, function(){ map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", l, function(){ map.getCanvas().style.cursor = ""; });
  });

  buildCatbar();
  applyCatFilter();
  updateProgress();
}

/* ---------- category filter chips ---------- */
function buildCatbar(){
  var bar = document.getElementById("catbar");
  CAT_ORDER.forEach(function(k){
    var c = CAT[k];
    var el = document.createElement("button");
    el.className = "catchip" + (catOff[k] ? " off" : "");
    el.innerHTML = "<i style='background:"+c.color+"'></i>"+c.label;
    el.addEventListener("click", function(){
      catOff[k] = !catOff[k];
      el.classList.toggle("off", !!catOff[k]);
      saveCats();
      applyCatFilter();
    });
    bar.appendChild(el);
  });
}
function applyCatFilter(){
  var activeCats = CAT_ORDER.filter(function(k){ return !catOff[k]; });
  map.setFilter("place-points", ["in", ["get","category"], ["literal", activeCats]]);
}

/* ---------- district panel ---------- */
function openDistrict(id, data){
  var meta = data.districts[id] || {blurb:"", also:[]};
  var placesHere = placesByDistrict[id] || [];
  var hoods = {}; var loose = [];
  placesHere.forEach(function(p){
    if (p.neighborhood) (hoods[p.neighborhood] = hoods[p.neighborhood] || []).push(p);
    else loose.push(p);
  });

  var html = "<h2>"+titleCase(id)+"-gu</h2>";
  html += "<p class='blurb'>"+meta.blurb+"</p>";

  Object.keys(hoods).forEach(function(hid){
    var hm = data.neighborhoods[hid] || {name:hid, kr:""};
    html += "<div class='hood-block'><h3>"+hm.name+" <span class='kr'>"+hm.kr+"</span></h3>";
    html += hoods[hid].map(placeCardHTML).join("");
    html += "</div>";
  });
  if (loose.length){
    html += "<div class='hood-block' style='margin-top:12px'>" + loose.map(placeCardHTML).join("") + "</div>";
  }
  if (meta.also && meta.also.length){
    html += "<div class='also'><b>Also here (not yet placed on the map):</b><br>" + meta.also.join(" · ") + "</div>";
  }

  document.getElementById("panelBody").innerHTML = html;
  document.getElementById("panel").classList.add("open");
  bindVisitCheckboxes();
}

function placeCardHTML(p){
  var flags = "";
  if (!p.lat) flags += "<span class='pflag' style='color:#9a6bc4;border-color:#9a6bc4'>NO PIN YET</span> ";
  if (p.unverified) flags += "<span class='pflag'>VERIFY</span>";
  return "<div class='pcard"+(visited[p.id]?" done":"")+"' data-id='"+p.id+"'>"
    + "<input type='checkbox' class='vischk' data-id='"+p.id+"'"+(visited[p.id]?" checked":"")+">"
    + "<div>"
    + "<div class='pname'>"+p.name+" <span class='kr'>"+(p.name_kr||"")+"</span></div>"
    + "<div class='pmeta'>"+CAT[p.category].label+(p.hours?" · "+p.hours:"")+"</div>"
    + (p.note ? "<div class='pnote'>"+p.note+"</div>" : "")
    + flags
    + "</div></div>";
}

function bindVisitCheckboxes(){
  document.querySelectorAll(".vischk").forEach(function(cb){
    cb.addEventListener("change", function(){
      var id = cb.dataset.id;
      visited[id] = cb.checked;
      saveVisited();
      cb.closest(".pcard").classList.toggle("done", cb.checked);
      updateProgress();
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

function titleCase(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

/* ---------- panel close ---------- */
document.getElementById("panelClose").addEventListener("click", function(){
  document.getElementById("panel").classList.remove("open");
});

/* ---------- list view ---------- */
document.getElementById("btnList").addEventListener("click", function(){ openListView(); });
document.getElementById("listClose").addEventListener("click", function(){
  document.getElementById("listView").hidden = true;
});
function openListView(){
  if (!DATA) return;
  var body = document.getElementById("listBody");
  var html = "";
  Object.keys(placesByDistrict).sort().forEach(function(id){
    var meta = DATA.districts[id] || {};
    html += "<details class='d-group'><summary>"+titleCase(id)+"-gu ("+placesByDistrict[id].length+")</summary>";
    html += placesByDistrict[id].map(function(p){
      return "<div class='lr'><input type='checkbox' class='vischk2' data-id='"+p.id+"'"+(visited[p.id]?" checked":"")+">"
        + "<div><b>"+p.name+"</b> <span style='color:var(--ink-soft)'>"+CAT[p.category].label+"</span></div></div>";
    }).join("");
    html += "</details>";
  });
  body.innerHTML = html;
  document.querySelectorAll(".vischk2").forEach(function(cb){
    cb.addEventListener("change", function(){
      visited[cb.dataset.id] = cb.checked;
      saveVisited();
      updateProgress();
    });
  });
  document.getElementById("listView").hidden = false;
}
