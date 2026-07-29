// Initialize map
const map = new L.Map("map").setView([60, 100], 4);

// Add CartoDB tiles
var CartoDB_Positron = new L.TileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  },
);
CartoDB_Positron.addTo(map);

// Airport Status colors
const statusColors = {
  OPEN: "#22c55e", // Green
  CLOSED: "#ef4444", // Red
  RESTRICTED: "#eab308", // Yellow
};

// Airport Status Russian names
const statusNames = {
  OPEN: "Открыт",
  CLOSED: "Закрыт",
  RESTRICTED: "Ограничения",
};

// Store markers, layer and airport data
let markers = {};
let airportsData = [];
let filteredAirports = [];
let currentSearchTerm = "";
let currentStatusFilter = "";
let lastUpdateTime = null;

// Store KO Restrictions data
let koData = [];
let filteredKo = [];
let currentKoSearch = "";
let currentKoCategory = "";
let currentKoStatus = "";
let currentKoFir = "";
let koLayers = [];
let routeLayer = null;
let routeElements = []; 
// Fetch airports data
async function loadAirports() {
  try {
    const response = await fetch("/api/airports/");
    const data = await response.json();
    airportsData = data.airports;
    filteredAirports = [...airportsData];
    lastUpdateTime = data.last_update;

    // Update airport statistics
    updateAirportStats(data.stats);
    updateLastUpdateTime(lastUpdateTime);

    // Render airports on map and in list
    renderAirports(filteredAirports);
  } catch (error) {
    console.error("Error loading airports:", error);
  }
}

// Fetch KO restrictions data
async function loadRestrictions() {
  try {
    const response = await fetch("/api/ko/");
    const data = await response.json();
    koData = data.restrictions;
    filteredKo = [...koData];

    // Update KO stats cards
    updateKoStats(data.stats);
    
    // Populate FIR list dynamically
    populateFirFilter(koData);

    // Render restrictions on map and in list
    renderRestrictions(filteredKo);
  } catch (error) {
    console.error("Error loading KO restrictions:", error);
  }
}

// Update top bar airport statistics
function updateAirportStats(stats) {
  document.getElementById("total-airports").textContent = stats.total;
  document.getElementById("closed-airports").textContent = stats.closed;
  document.getElementById("open-airports").textContent = stats.open;
  document.getElementById("restricted-airports").textContent = stats.restricted;
}

// Update top bar KO statistics
function updateKoStats(stats) {
  document.getElementById("total-ko").textContent = stats.total;
  document.getElementById("active-ko").textContent = stats.active;
  document.getElementById("upcoming-ko").textContent = stats.upcoming;
}

// Update last update time display
function updateLastUpdateTime(timestamp) {
  const element = document.getElementById("last-update");
  if (!timestamp) {
    element.textContent = "—";
    return;
  }

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);

  let displayText;
  if (diffMins < 1) {
    displayText = "Только что";
  } else if (diffMins < 60) {
    displayText = `${diffMins} мин назад`;
  } else {
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      displayText = `${diffHours} ч назад`;
    } else {
      displayText = date.toLocaleString("ru-RU");
    }
  }

  element.textContent = displayText;
}

// Dynamically populate FIR filter options
function populateFirFilter(restrictions) {
  const firFilter = document.getElementById("ko-fir-filter");
  if (!firFilter) return;

  const currentSelection = firFilter.value;
  const firs = new Set();
  
  restrictions.forEach(r => {
    if (r.firlist) {
      r.firlist.forEach(fir => firs.add(fir));
    }
  });

  const sortedFirs = Array.from(firs).sort();
  firFilter.innerHTML = '<option value="">Все FIR (районы УВД)</option>';
  
  sortedFirs.forEach(fir => {
    const option = document.createElement("option");
    option.value = fir;
    option.textContent = fir;
    if (fir === currentSelection) {
      option.selected = true;
    }
    firFilter.appendChild(option);
  });
}

// Setup tabs navigation in left panel
function setupTabs() {
  const tabAirports = document.getElementById("tab-airports");
  const tabKo = document.getElementById("tab-ko");
  const tabRte = document.getElementById("tab-rte");
  const contentAirports = document.getElementById("content-airports");
  const contentKo = document.getElementById("content-ko");
  const contentRte = document.getElementById("content-rte");

  tabAirports.addEventListener("click", () => {
    tabAirports.classList.add("active");
    tabKo.classList.remove("active");
    contentAirports.classList.add("active");
    contentKo.classList.remove("active");
    tabRte.classList.remove("active");
    contentRte.classList.remove('active');
  });

  tabKo.addEventListener("click", () => {
    tabKo.classList.add("active");
    tabAirports.classList.remove("active");
    contentKo.classList.add("active");
    contentAirports.classList.remove("active");
    tabRte.classList.remove("active");
    contentRte.classList.remove('active');
  });
   tabRte.addEventListener("click", () => {
    tabKo.classList.remove("active");
    tabAirports.classList.remove("active");
    contentKo.classList.remove("active");
    contentAirports.classList.remove("active");
    tabRte.classList.add("active");
    contentRte.classList.add('active');
  });
}

// Setup event listeners for search and filters
function setupEventListeners() {
  const searchInput = document.getElementById("search-input");
  const statusFilter = document.getElementById("status-filter");
  const refreshBtn = document.getElementById("refresh-btn");
  const routeInput = document.getElementById("rte-input");
  const buildRouteBtn = document.getElementById("rte-btn");

  searchInput.addEventListener("input", (e) => {
    currentSearchTerm = e.target.value.toUpperCase();
    applyFilters();
  });

  statusFilter.addEventListener("change", (e) => {
    currentStatusFilter = e.target.value;
    applyFilters();
  });

  refreshBtn.addEventListener("click", refreshData);
  if (buildRouteBtn && routeInput) {
    buildRouteBtn.addEventListener("click", () => {
      loadRoute(routeInput.value.trim());
    });

    // Позволяет запускать построение по нажатию на клавишу Enter в инпуте
    routeInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        loadRoute(routeInput.value.trim());
      }
    });
  }
  // KO Filters
  const koSearchInput = document.getElementById("ko-search-input");
  const koCategoryFilter = document.getElementById("ko-category-filter");
  const koStatusFilter = document.getElementById("ko-status-filter");
  const koFirFilter = document.getElementById("ko-fir-filter");

  koSearchInput.addEventListener("input", (e) => {
    currentKoSearch = e.target.value.toUpperCase();
    applyKoFilters();
  });

  koCategoryFilter.addEventListener("change", (e) => {
    currentKoCategory = e.target.value;
    applyKoFilters();
  });

  koStatusFilter.addEventListener("change", (e) => {
    currentKoStatus = e.target.value;
    applyKoFilters();
  });

  koFirFilter.addEventListener("change", (e) => {
    currentKoFir = e.target.value;
    applyKoFilters();
  });
}

// Get CSRF token from meta tag
function getCsrfToken() {
  const token = document.querySelector('meta[name="csrf-token"]');
  return token ? token.getAttribute('content') : '';
}

// Manual refresh
async function refreshData() {
  const btn = document.getElementById("refresh-btn");
  btn.classList.add("loading");
  btn.disabled = true;

  try {
    const response = await fetch("/api/airports/update/", {
      method: "POST",
      headers: {
        "X-CSRFToken": getCsrfToken(),
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (data.success) {
      await loadAirports();
      await loadRestrictions();
      showNotification("✓ Данные успешно обновлены!", "success");
    } else {
      showNotification(`✗ Ошибка: ${data.message}`, "error");
    }
  } catch (error) {
    console.error("Error refreshing data:", error);
    showNotification("✗ Ошибка обновления", "error");
  } finally {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

// Show notification
function showNotification(message, type = "info") {
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Apply search and filter for airports
function applyFilters() {
  filteredAirports = airportsData.filter((airport) => {
    // topbar filter supports active button via currentStatusFilter
    if (currentStatusFilter && airport.status !== currentStatusFilter) {
      return false;
    }


    if (currentSearchTerm) {
      const matchName = airport.name.toUpperCase().includes(currentSearchTerm);
      const matchIcao = airport.icao.toUpperCase().includes(currentSearchTerm);
      const matchCity = airport.city.toUpperCase().includes(currentSearchTerm);

      if (!matchName && !matchIcao && !matchCity) {
        return false;
      }
    }

    return true;
  });

  renderAirports(filteredAirports);
}

// Apply search and filter for KO
function applyKoFilters() {
  filteredKo = koData.filter((ko) => {
    if (currentKoCategory && ko.category !== currentKoCategory) {
      return false;
    }

    if (currentKoStatus && ko.status !== currentKoStatus) {
      return false;
    }

    if (currentKoFir && !ko.firlist.includes(currentKoFir)) {
      return false;
    }

    if (currentKoSearch) {
      const matchRvm = ko.rvmname.toUpperCase().includes(currentKoSearch);
      const matchDesc = ko.description.toUpperCase().includes(currentKoSearch);
      const matchId = ko.id.toUpperCase().includes(currentKoSearch);
      const matchFirs = ko.firlist.some(f => f.toUpperCase().includes(currentKoSearch));

      if (!matchRvm && !matchDesc && !matchId && !matchFirs) {
        return false;
      }
    }

    return true;
  });

  renderRestrictions(filteredKo);
}

// RTE 
async function loadRoute(routeStr) {
  if (!routeStr) {
    showNotification("⚠️ Введите строку маршрута", "error");
    return;
  }

  // Очищаем прошлый маршрут, точки и плашки с названиями
  if (routeLayer) map.removeLayer(routeLayer);
  routeElements.forEach(layer => map.removeLayer(layer));
  routeElements = [];

  try {
    const response = await fetch(`/api/route/?route=${encodeURIComponent(routeStr)}`);
    const data = await response.json();
    const ivpRouteHits = Array.isArray(data.ivp_route_hits) ? data.ivp_route_hits : [];
    const ivpHitBySegmentKey = new Map();
    // Карты сегментов соответствуют порядку features geojson
    // ключ: "from->to"
    ivpRouteHits.forEach(h => {
      if (h && h.from && h.to) ivpHitBySegmentKey.set(`${h.from}->${h.to}`, h);
    });

    if (data.error) {
      showNotification(`✗ Ошибка: ${data.error}`, "error");
      return;
    }

    // 1. Отрисовка линий маршрута
    routeLayer = new L.GeoJSON(data.geojson, {
      style: function (feature) {
        const props = feature.properties || {};
        const segKey = `${props.from}->${props.to}`;
        const hitByKey = ivpHitBySegmentKey.get(segKey)?.hit === true;

        // Fallback для DCT: если не нашлось по ключу — попробуем по индексу сегмента.
        const featureIndex = (data.geojson?.features || []).indexOf(feature);
        const hitByIndex = ivpRouteHits[featureIndex]?.hit === true;

        const hit = hitByKey || hitByIndex;

        if (hit) {
          // Усиленный стиль для IVP hits
          return { color: "#a855f7", weight: 8, opacity: 0.95 };
        }

        if (props.name === "DCT") {
          return { color: "#ef4444", weight: 4, dashArray: "6, 8", opacity: 0.8 };
        }
        return { color: "#3b82f6", weight: 5, opacity: 0.9 };
      },
      onEachFeature: function (feature, layer) {
        const props = feature.properties || {};
        const segKey = `${props.from}->${props.to}`;
        const hitByKey = ivpHitBySegmentKey.get(segKey)?.hit === true;

        const featureIndex = (data.geojson?.features || []).indexOf(feature);
        const hitByIndex = ivpRouteHits[featureIndex]?.hit === true;

        const hit = hitByKey || hitByIndex;

        const ivpText = hit
          ? `<br><span style="color:#a855f7;font-weight:700;">⚠ Возможны ограничения из-за ограничений ИВП</span>`
          : '';

        layer.bindPopup(`
          <div class="airport-popup">
            <strong>Трасса:</strong> ${props.name}<br>
            <strong>Сегмент:</strong> ${props.from} ➔ ${props.to}
            ${ivpText}
          </div>
        `);
      }
    }).addTo(map);

    // Вспомогательный набор для уникальных точек (чтобы не рисовать одну точку дважды)
    const renderedPoints = new Set();

    // 2. Генерация плашек с названиями и отображение физических точек
    data.geojson.features.forEach(feature => {
      const coords = feature.geometry.coordinates;
      if (!coords || coords.length < 2) return;

      const airwayName = feature.properties.name;

      // --- ТОЧКИ НАЧАЛА И КОНЦА СЕГМЕНТА ---
      const startPt = coords[0];
      const endPt = coords[coords.length - 1];
      const startIdent = feature.properties.from;
      const endIdent = feature.properties.to;

      [ {coord: startPt, ident: startIdent}, {coord: endPt, ident: endIdent} ].forEach(pt => {
        if (!renderedPoints.has(pt.ident)) {
          renderedPoints.add(pt.ident);
          
          // Создаем видимую круглую точку на карте
          const pointMarker = new L.CircleMarker([pt.coord[1], pt.coord[0]], {
            radius: 5,
            fillColor: "#ffffff",
            color: airwayName === "DCT" ? "#ef4444" : "#3b82f6",
            weight: 3,
            fillOpacity: 1
          })
          .bindTooltip(pt.ident, { permanent: true, direction: "top", className: "waypoint-tooltip", offset: [0, -5] })
          .addTo(map);

          routeElements.push(pointMarker);
        }
      });

      // --- ВЫЧИСЛЕНИЕ УГЛА И СОЗДАНИЕ ПЛАШКИ НА ЛИНИИ ---
      // Берем средний сегмент геометрии для расчета направления (для точности на изгибах)
      const midIdx = Math.floor(coords.length / 2);
      const p1 = coords[midIdx - 1];
      const p2 = coords[midIdx];

      // Координаты центральной точки
      const midLat = (p1[1] + p2[1]) / 2;
      const midLon = (p1[0] + p2[0]) / 2;

      // Вычисление экранного угла наклона линии
      let dy = p2[1] - p1[1];
      let dx = p2[0] - p1[0];
      let angle = Math.atan2(dy, dx) * 180 / Math.PI;

      // Корректируем угол, чтобы текст не оказывался вверх ногами (всегда читался слева направо)
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;

      // HTML код плашки с inline-стилем трансформации вращения
      const isDct = airwayName === "DCT";
      const labelClass = isDct ? "airway-label dct-label" : "airway-label";
      const iconHtml = `
        <div style="transform: rotate(${-angle}deg);">
          <div class="${labelClass}">${airwayName}</div>
        </div>
      `;

      const labelIcon = new L.DivIcon({
        html: iconHtml,
        className: "airway-label-container"
      });

      const labelMarker = new L.Marker([midLat, midLon], { icon: labelIcon }).addTo(map);
      routeElements.push(labelMarker);
    });

    // 3. Вывод карточек в интерфейс боковой панели
    renderRouteCards(data.geojson);

    // 4. Ошибки парсинга
    const warningsDiv = document.getElementById("route-warnings");
    if (warningsDiv) {
      if (data.unrecognized && data.unrecognized.length > 0) {
        warningsDiv.style.display = "block";
        warningsDiv.innerHTML = `
          <strong>Предупреждения:</strong>
          <ul style="margin: 4px 0 0 16px; padding: 0;">
            ${data.unrecognized.map(item => `<li>${item}</li>`).join("")}
          </ul>
        `;
      } else {
        warningsDiv.style.display = "none";
      }
    }

    if (data.geojson.features && data.geojson.features.length > 0) {
      map.fitBounds(routeLayer.getBounds(), { padding: [80, 80] });
    }

    showNotification("✓ Маршрут успешно построен!", "success");

  } catch (error) {
    console.error("Ошибка при получении маршрута:", error);
    showNotification("✗ Ошибка построения маршрута", "error");
  }
}
function renderRouteCards(geojson) {
  // Берем IVP hits из глобального scope, поднятого в loadRoute()
  // Если не найдено — просто не отображаем бейджи.
  const ivpHits = window.__ivpRouteHits || [];
  const ivpHitBySegmentKey = new Map();
  ivpHits.forEach(h => {
    if (h && h.from && h.to) ivpHitBySegmentKey.set(`${h.from}->${h.to}`, h);
  });
  // Найдите или добавьте в ваш HTML элемент <div class="route-legs-list"></div> в боковую панель
  const routeListContainer = document.querySelector(".route-legs-list");
  if (!routeListContainer) return;
  routeListContainer.innerHTML = "";

  if (!geojson.features || geojson.features.length === 0) {
    routeListContainer.innerHTML = '<div class="empty-message">Маршрут не построен</div>';
    return;
  }

  geojson.features.forEach((feature, index) => {
    const props = feature.properties;
    const isDct = props.name === "DCT";
    const segKey = `${props.from}->${props.to}`;

    const hitByKey = ivpHitBySegmentKey.get(segKey)?.hit === true;
    const hitByIndex = ivpHits[index]?.hit === true;

    const hit = hitByKey || hitByIndex;

    const cardClass = hit
      ? (isDct ? "route-leg-card leg-dct ivp-hit" : "route-leg-card ivp-hit")
      : (isDct ? "route-leg-card leg-dct" : "route-leg-card");

    const badgeClass = isDct ? "leg-badge badge-dct" : "leg-badge badge-airway";
    const ivpBadgeHtml = hit
      ? `<span class="ivp-badge" title="Возможны ограничения из-за ограничений ИВП">ИВП</span>`
      : '';

    const card = document.createElement("div");
    card.className = cardClass;
    card.innerHTML = `
      <div class="leg-header">
        <span class="leg-title">Сегмент ${index + 1}</span>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="${badgeClass}">${props.name}</span>
          ${ivpBadgeHtml}
        </div>
      </div>
      <div class="leg-points">
        <strong>${props.from}</strong> 
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="color: #64748b;"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        <strong>${props.to}</strong>
      </div>
    `;

    // Фокусировка на конкретном сегменте при клике на карточку в списке
    card.addEventListener("click", () => {
      const coords = feature.geometry.coordinates;
      const bounds = new L.LatLngBounds(coords.map(c => [c[1], c[0]]));
      map.fitBounds(bounds, { maxZoom: 8, padding: [100, 100] });
      
      // Находим и открываем попап для этой линии
      routeLayer.eachLayer(layer => {
        if (layer.feature === feature) {
          layer.openPopup();
        }
      });
    });

    routeListContainer.appendChild(card);
  });
}

// Create a custom blinking dot marker for airports
function createBlinkingMarker(lat, lon, status, possibleIvP = false) {
  const color = possibleIvP ? "#f97316" : (statusColors[status] || "#888888");

  const svgMarkup = `
    <svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>
      <circle cx='12' cy='12' r='10' fill='${color}' opacity='0.7'/>
      <circle cx='12' cy='12' r='6' fill='${color}'/>
    </svg>`;

  const iconUrl =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarkup);

  return new L.Icon({
    iconUrl: iconUrl,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

// Clear airport markers from map
function clearMarkers() {
  Object.values(markers).forEach((marker) => {
    map.removeLayer(marker);
  });
  markers = {};
}

// Clear KO layers from map
function clearKoLayers() {
  koLayers.forEach((layer) => {
    map.removeLayer(layer);
  });
  koLayers = [];
}

// Render airports on map and in left panel list
function renderAirports(airports) {
  const airportsList = document.querySelector(".airports_list");
  if (!airportsList) return;
  airportsList.innerHTML = "";

  clearMarkers();

  if (airports.length === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.className = "empty-message";
    emptyMessage.textContent = "Аэропорты не найдены";
    airportsList.appendChild(emptyMessage);
    return;
  }

  airports.forEach((airport) => {
    const possibleIvP = airport.possible_ivp_restriction === true;

    const icon = createBlinkingMarker(
      airport.latitude,
      airport.longitude,
      airport.status,
      possibleIvP,
    );

    const ivpLine = possibleIvP
      ? `<br><span style="color:#f97316;font-weight:700;">Аэродром находится в пределах зон ИВП, возможны ограничения</span>`
      : '';

    const marker = new L.Marker([airport.latitude, airport.longitude], {
      icon: icon,
    })
      .addTo(map)
      .bindPopup(`
				<div class="airport-popup">
					<strong>${airport.name}</strong><br>
					ICAO: ${airport.icao}<br>
					FIR: ${airport.city}<br>
					Статус: <span class="status-badge status-${airport.status.toLowerCase()}">
						${statusNames[airport.status]}
					</span>
					${ivpLine}
				</div>
			`);

    markers[airport.icao] = marker;

    const li = document.createElement("li");
    li.className = `airport-item status-${airport.status.toLowerCase()}`;

    const blinkDot = document.createElement("span");
    blinkDot.className = `blink-dot status-${airport.status.toLowerCase()}`;

    const airportInfo = document.createElement("span");
    airportInfo.className = "airport-info";
    airportInfo.innerHTML = `<strong>${airport.name}</strong><br><small>${airport.icao}</small>`;

    li.appendChild(blinkDot);
    li.appendChild(airportInfo);

    li.addEventListener("click", () => {
      marker.openPopup();
      map.setView([airport.latitude, airport.longitude], 8);
    });

    airportsList.appendChild(li);
  });
}

// Helper to determine restriction color
function getKoColor(restriction) {
  if (restriction.status === 'upcoming') {
    return '#9ca3af'; // Grey for upcoming
  }
  if (restriction.category === 'full_closure') {
    return '#f97316'; // Orange for full closures
  }
  if (restriction.category === 'partial_closure') {
    return '#fb923c'; // Lighter orange for partial closures
  }
  if (restriction.category === 'route') {
    return '#3b82f6'; // Blue for route corridors
  }
  return '#6b7280';
}

// Helper to format ISO date strings for popups
function formatKoDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString('ru-RU', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }) + ' UTC';
}

// Render KO restrictions on map and in list
function renderRestrictions(restrictions) {
  const koList = document.querySelector(".ko_list");
  if (!koList) return;
  koList.innerHTML = "";

  clearKoLayers();

  if (restrictions.length === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.className = "empty-message";
    emptyMessage.textContent = "Ограничения не найдены";
    koList.appendChild(emptyMessage);
    return;
  }

  restrictions.forEach((ko) => {
    ko._layers = [];
    const color = getKoColor(ko);
    
    // Popup content
    const popupContent = `
      <div class="ko-popup">
        <h3>${ko.rvmname || 'Ограничение'}</h3>
        <div class="ko-popup-row"><strong>FIR:</strong> ${ko.firlist.join(', ')}</div>
        <div class="ko-popup-row"><strong>Высоты:</strong> ${ko.levelfrom} — ${ko.levelto}</div>
        <div class="ko-popup-row"><strong>Период (UTC):</strong><br>${formatKoDate(ko.datefrom)} — ${formatKoDate(ko.dateto)}</div>
        <div class="ko-popup-row"><strong>Статус:</strong> 
          <span class="ko-badge ${ko.status === 'active' ? 'badge-active' : 'badge-upcoming'}">
            ${ko.status === 'active' ? 'Активно' : 'Предстоящее'}
          </span>
        </div>
        <div class="ko-popup-desc">${ko.description}</div>
      </div>
    `;

    // Render geometries
    ko.zones.forEach((zone) => {
      let layer;

      if (zone.type === 'circle') {
        layer = new L.Circle(zone.center, {
          radius: zone.radius_km * 1000,
          color: color,
          fillColor: color,
          fillOpacity: 0.25,
          weight: 2
        });
      } else if (zone.type === 'route') {
        // Thick polyline for routes
        const pathLine = new L.Polyline(zone.coords, {
          color: color,
          weight: 8,
          opacity: 0.6
        });
        const centerLine = new L.Polyline(zone.coords, {
          color: '#ffffff',
          weight: 2,
          opacity: 0.8,
        //   dashArray: '5, 5'
        });
        
        pathLine.bindPopup(popupContent).addTo(map);
        centerLine.addTo(map);
        
        koLayers.push(pathLine);
        koLayers.push(centerLine);
        ko._layers.push(pathLine);
        return;
      } else if (zone.type === 'polygon') {
        layer = new L.Polygon(zone.coords, {
          color: color,
          fillColor: color,
          fillOpacity: 0.25,
          weight: 2
        });
      }

      if (layer) {
        layer.bindPopup(popupContent).addTo(map);
        koLayers.push(layer);
        ko._layers.push(layer);
      }
    });

    // Add list item
    const li = document.createElement("li");
    li.className = `ko-item cat-${ko.category} status-${ko.status}`;

    // Category badge display text
    let catText = 'КО';
    if (ko.category === 'full_closure') catText = 'Закрыто';
    else if (ko.category === 'partial_closure') catText = 'Частично';
    else if (ko.category === 'route') catText = 'Маршрут';

    li.innerHTML = `
      <div class="ko-header">
        <span class="ko-title" title="${ko.rvmname}">${ko.rvmname}</span>
        <div class="ko-badges">
          <span class="ko-badge ${ko.category === 'route' ? 'badge-route' : (ko.status === 'active' ? 'badge-active' : 'badge-upcoming')}">${catText}</span>
        </div>
      </div>
      <div class="ko-time-range">${formatKoDate(ko.datefrom)} - ${formatKoDate(ko.dateto)}</div>
      <div class="ko-desc-snippet">${ko.description}</div>
    `;

    li.addEventListener("click", () => {
      focusOnRestriction(ko);
    });

    koList.appendChild(li);
  });
}

// Center/focus map on restriction zones
function focusOnRestriction(ko) {
  if (!ko.zones || ko.zones.length === 0) return;

  const allCoords = [];
  ko.zones.forEach((zone) => {
    if (zone.type === 'circle') {
      allCoords.push(zone.center);
    } else if (zone.coords) {
      allCoords.push(...zone.coords);
    }
  });

  if (allCoords.length > 0) {
    const bounds = new L.LatLngBounds(allCoords);
    map.fitBounds(bounds, { maxZoom: 10, padding: [50, 50] });

    if (ko._layers && ko._layers.length > 0) {
      ko._layers[0].openPopup();
    }
  }
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

function toDeg(rad) {
  return rad * (180 / Math.PI);
}

// Bearing in degrees from true north, 0..360
function computeTrueBearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  let θ = Math.atan2(y, x);
  let brng = (toDeg(θ) + 360) % 360;
  return brng;
}

function computeHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

const bearingState = {
  clickA: null,
  clickB: null,
  lineLayer: null,
  arrowLayer: null,
  markerALayer: null,
  markerBLayer: null,
};

function ensureBearingDistanceOverlay() {
  let el = document.getElementById("bearing-distance-overlay");
  if (el) return;

  // Создаём контейнер ВНУТРИ карты — всегда поверх тайлов
  const mapEl = document.querySelector(".leaflet-control-zoom");
  const container = document.createElement("div");
  container.id = "bearing-distance-overlay";
  container.style.position = "absolute";
  container.style.bottom = "60px";
  container.style.left = "14px";
  container.style.zIndex = "1200"; // выше зума
  container.style.background = "rgba(15, 23, 42, 0.88)";
  container.style.color = "#e2e8f0";
  container.style.padding = "10px 14px";
  container.style.borderRadius = "10px";
  container.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  container.style.fontSize = "13px";
  container.style.lineHeight = "1.5";
  container.style.maxWidth = "280px";
  container.style.backdropFilter = "blur(6px)";
  container.style.border = "1px solid rgba(148, 163, 184, 0.25)";
  container.style.boxShadow = "0 4px 16px rgba(0,0,0,0.25)";
  container.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px;font-size:14px;color:#f8fafc;">📏 Курс / Дистанция</div>
    <div id="bd-click-a" style="margin-bottom:2px;">Клик A: —</div>
    <div id="bd-click-b" style="margin-bottom:6px;">Клик B: —</div>
    <div id="bd-bearing" style="margin-bottom:2px;">Курс (истинный север): —</div>
    <div id="bd-distance">Дистанция: —</div>
    <div style="margin-top:8px;font-size:11px;opacity:0.7;">Перетащите линию по карте</div>
  `;

  container.style.display = "none"; // скрыта до первого клика
  document.body.appendChild(container);
}

function clearBearingOverlays() {
  const s = bearingState;
  if (s.lineLayer)    { map.removeLayer(s.lineLayer);   s.lineLayer = null; }
  if (s.arrowLayer)   { map.removeLayer(s.arrowLayer);    s.arrowLayer = null; }
  if (s.markerALayer) { map.removeLayer(s.markerALayer); s.markerALayer = null; }
  if (s.markerBLayer) { map.removeLayer(s.markerBLayer); s.markerBLayer = null; }
}

function updateBearingDisplay() {
  const s = bearingState;
  const el = document.getElementById("bearing-distance-overlay");
  if (!el) return;

  const fmtCoord = (p) => `(${p.lat.toFixed(3)}, ${p.lon.toFixed(3)})`;

  document.getElementById("bd-click-a").textContent   = `Клик A: ${s.clickA ? fmtCoord(s.clickA) : "—"}`;
  document.getElementById("bd-click-b").textContent   = `Клик B: ${s.clickB ? fmtCoord(s.clickB) : "—"}`;

  if (s.clickA && s.clickB) {
    const brng = Math.round(computeTrueBearingDeg(s.clickA.lat, s.clickA.lon, s.clickB.lat, s.clickB.lon));
    const dist = computeHaversineKm(s.clickA.lat, s.clickA.lon, s.clickB.lat, s.clickB.lon);

    document.getElementById("bd-bearing").textContent   = `Курс (истинный север): ${brng}°`;
    // Показываем и км, и мили
    const distMi = dist * 0.539957;
    const fmtDist = dist >= 10 ? `${dist.toFixed(1)} км` : `${(dist * 1000).toFixed(0)} м`;
    document.getElementById("bd-distance").textContent   = `Дистанция: ${fmtDist} (${distMi.toFixed(1)} mi)`;
  } else {
    document.getElementById("bd-bearing").textContent   = "Курс (истинный север): —";
    document.getElementById("bd-distance").textContent   = "Дистанция: —";
  }
}

function drawBearingLine() {
  const s = bearingState;
  clearBearingOverlays();

  if (!s.clickA) return;

  // Маркер точки A (синий круг) — всегда показывается
  const markerStyle = (color) => ({
    radius: 7, fillColor: color, color: "#fff", weight: 2, fillOpacity: 1,
  });

  s.markerALayer = new L.CircleMarker([s.clickA.lat, s.clickA.lon], markerStyle("#3b82f6")).addTo(map);
  s.markerALayer.bindTooltip("A", { permanent: true, direction: "top", className: "bearing-marker-tooltip", offset: [0, -8] });

  if (!s.clickB) return;

  // Маркер точки B (красный круг)
  s.markerBLayer = new L.CircleMarker([s.clickB.lat, s.clickB.lon], markerStyle("#ef4444")).addTo(map);
  s.markerBLayer.bindTooltip("B", { permanent: true, direction: "top", className: "bearing-marker-tooltip", offset: [0, -8] });

  // Основная линия-релька (пунктирная)
  const latlngs = [
    [s.clickA.lat, s.clickA.lon],
    [s.clickB.lat, s.clickB.lon],
  ];
  s.lineLayer = new L.Polyline(latlngs, {
    color: "#f59e0b",
    weight: 3,
    opacity: 0.9,
    dashArray: "10, 8",
    className: "bearing-line",
  }).addTo(map);

  // Стрелка направления на точке B (указатель курса)
  // const brng = computeTrueBearingDeg(s.clickA.lat, s.clickA.lon, s.clickB.lat, s.clickB.lon);
  // console.log(brng);
  // const arrowSize = 20;
  // const arrowAngle = brng ;

  // // Вершины треугольной стрелки
  // const tipX = Math.sin(arrowAngle) * arrowSize;
  // const tipY = -Math.cos(arrowAngle) * arrowSize;
  // const tailX = Math.sin(arrowAngle + Math.PI - 0.5) * arrowSize * 0.6;
  // const tailY = -Math.cos(arrowAngle + Math.PI - 0.5) * arrowSize * 0.6;
  // const tailX2 = Math.sin(arrowAngle + Math.PI + 0.5) * arrowSize * 0.6;
  // const tailY2 = -Math.cos(arrowAngle + Math.PI + 0.5) * arrowSize * 0.6;

  // const arrowIcon = new L.DivIcon({
  //   className: "bearing-arrow-icon",
  //   html: `<svg width="${arrowSize * 2}" height="${arrowSize * 2}" viewBox="0 0 ${arrowSize * 2} ${arrowSize * 2}" style="pointer-events:none;">
  //     <polygon points="${arrowSize + tipX},${arrowSize - tipY} ${arrowSize + tailX},${arrowSize - tailY} ${arrowSize + tailX2},${arrowSize - tailY2}" fill="#ef4444" stroke="#fff" stroke-width="1.5" />
  //   </svg>`,
  //   iconSize: [arrowSize * 2, arrowSize * 2],
  //   iconAnchor: [arrowSize, arrowSize],
  // });

  // s.arrowLayer = new L.Marker([s.clickB.lat, s.clickB.lon], { icon: arrowIcon }).addTo(map);

  updateBearingDisplay();
}

document.addEventListener("DOMContentLoaded", () => {
  loadAirports();
  loadRestrictions();
  setupTabs();
  setupEventListeners();

  ensureBearingDistanceOverlay();

  // Панель скрыта пока нет точки A
  const overlayEl = document.getElementById("bearing-distance-overlay");

  map.on("click", (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    if (!bearingState.clickA) {
      bearingState.clickA = { lat, lon };
      bearingState.clickB = null;
      clearBearingOverlays();
      // Показываем панель при первом клике
      if (overlayEl) overlayEl.style.display = "block";
    } else {
      bearingState.clickB = { lat, lon };
    }

    drawBearingLine();
  });

  // Перетаскивание точки B по карте
  map.on("mousemove", (e) => {
    if (!bearingState.clickA || bearingState.clickB) return;
    bearingState.clickB = { lat: e.latlng.lat, lon: e.latlng.lng };
    drawBearingLine();
  });

  // Сброс линейки по двойному клику / правой кнопке
  map.on("contextmenu", () => {
    clearBearingOverlays();
    bearingState.clickA = null;
    bearingState.clickB = null;
    if (overlayEl) overlayEl.style.display = "none";
  });

  // Set 5-minute auto refresh for both datasets
  setInterval(async () => {
    console.log("Auto-refreshing data...");
    await loadAirports();
    await loadRestrictions();
  }, 300000);
});


