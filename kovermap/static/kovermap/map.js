const map = new L.Map("map").setView([60, 100], 4);
let currentTileLayer = null;

function applyTheme(themeName) {
  const nextTheme = themeName === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", nextTheme);
  localStorage.setItem("kovermap-theme", nextTheme);

  if (currentTileLayer) {
    map.removeLayer(currentTileLayer);
  }

  currentTileLayer = new L.TileLayer(
    nextTheme === "dark"
      ? "https://tiles.latlng.work/v1/tiles/{z}/{x}/{y}.png?key=pk_latlng_x0lzxypv4d25een4bnd6aw2sbzd571gk&style=dark"
      : "https://tiles.latlng.work/v1/tiles/{z}/{x}/{y}.png?key=pk_latlng_x0lzxypv4d25een4bnd6aw2sbzd571gk&style=light",
    {}
  );

  currentTileLayer.addTo(map);

  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    const icon = toggle.querySelector(".theme-toggle__icon");
    if (icon) {
      icon.textContent = nextTheme === "dark" ? "🌙" : "☀️";
    }
  }
}

function initializeThemeToggle() {
  const savedTheme = localStorage.getItem("kovermap-theme");
  const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme || (preferredDark ? "dark" : "light"));

  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

initializeThemeToggle();

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

function getAirportStatusMeta(airport) {
  const statusValue = airport && airport.status ? airport.status : "OPEN";
  const sourceLabel = airport && airport.source_label
    ? airport.source_label
    : (airport && airport.status_source === "ivp" ? "ИВП" : "Росавиация");

  const displayStatus = statusNames[statusValue] || statusValue;
  const isIvPWarning = airport && airport.possible_ivp_restriction === true && statusValue === "OPEN";

  return {
    sourceLabel,
    displayStatus,
    ivpWarning: isIvPWarning
      ? "Есть сигнал ИВП о возможных ограничениях в зоне аэропорта."
      : "",
  };
}

let selectedAirportIcao = null;
let selectedKoId = null;

function closeMobileDetailSheet() {
  const sheet = document.getElementById("mobile-detail-sheet");
  const backdrop = document.getElementById("mobile-detail-backdrop");

  if (sheet) sheet.remove();
  if (backdrop) backdrop.remove();
}

function openMobileDetailSheet(htmlContent) {
  closeMobileDetailSheet();

  const backdrop = document.createElement("div");
  backdrop.id = "mobile-detail-backdrop";
  backdrop.className = "mobile-detail-backdrop";

  const sheet = document.createElement("div");
  sheet.id = "mobile-detail-sheet";
  sheet.className = "mobile-detail-sheet";
  sheet.innerHTML = htmlContent;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  const closeButton = sheet.querySelector(".mobile-detail-close");
  if (closeButton) {
    closeButton.addEventListener("click", closeMobileDetailSheet);
  }

  backdrop.addEventListener("click", closeMobileDetailSheet);
}

function switchToTab(tabName) {
  const tabMap = {
    airports: document.getElementById("tab-airports"),
    ko: document.getElementById("tab-ko"),
    rte: document.getElementById("tab-rte"),
  };

  const contentMap = {
    airports: document.getElementById("content-airports"),
    ko: document.getElementById("content-ko"),
    rte: document.getElementById("content-rte"),
  };

  const tab = tabMap[tabName];
  const content = contentMap[tabName];

  if (!tab || !content) return;

  Object.entries(tabMap).forEach(([key, item]) => {
    if (!item) return;
    item.classList.toggle("active", key === tabName);
  });

  Object.entries(contentMap).forEach(([key, item]) => {
    if (!item) return;
    item.classList.toggle("active", key === tabName);
  });
}

function renderAirportDetail(airport) {
  const airportsList = document.querySelector(".airports_list");
  if (!airportsList || !airport) return;

  const meta = getAirportStatusMeta(airport);
  const lastUpdated = formatRelativeTime(airport.last_updated, "—");
  const warningHtml = meta.ivpWarning
    ? `<div class="airport-detail-warning">⚠ ${meta.ivpWarning}</div>`
    : "";

  const detailHtml = `
    <div class="airport-detail-panel">
      <div class="detail-sheet-header">
        <button type="button" class="airport-detail-back mobile-detail-close" aria-label="Вернуться к списку">← Назад</button>
        <span class="airport-detail-source">${meta.sourceLabel}</span>
      </div>
      <div class="airport-detail-head">
        <span class="status-badge status-${airport.status.toLowerCase()}">${meta.displayStatus}</span>
      </div>
      <h3 class="airport-detail-name">${airport.name}</h3>
      <div class="airport-detail-grid">
        <div><span>ICAO</span><strong>${airport.icao}</strong></div>
        <div><span>FIR</span><strong>${airport.city}</strong></div>
        <div><span>Статус</span><strong>${meta.displayStatus}</strong></div>
        <div><span>Источник</span><strong>${meta.sourceLabel}</strong></div>
      </div>
      <div class="airport-detail-meta">
        <span>Обновлено: ${lastUpdated}</span>
      </div>
      ${warningHtml}
      <div class="airport-detail-note">
        ${airport.status_reason || "Данные обновлены по текущей сводке."}
      </div>
    </div>
  `;

  if (isMobileViewport()) {
    if (document.body.classList.contains("mobile-map-open") || window.innerWidth <= 768) {
      toggleMobileMap(true);
    }
    openMobileDetailSheet(detailHtml);
    return;
  }

  airportsList.innerHTML = detailHtml;

  const backButton = airportsList.querySelector(".airport-detail-back");
  if (backButton) {
    backButton.addEventListener("click", () => {
      selectedAirportIcao = null;
      renderAirports(filteredAirports);
    });
  }
}

// Store markers, layer and airport data
let markers = {};
let airportsData = [];
let filteredAirports = [];
let currentSearchTerm = "";
let currentStatusFilter = "";
let lastUpdateTime = null;
const tickerMessageDurationMs = 5 * 60 * 1000;
const lastAirportStatuses = new Map();
const lastKoStatuses = new Map();

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
    const previousAirports = airportsData;
    airportsData = data.airports;
    filteredAirports = [...airportsData];
    lastUpdateTime = data.last_update;

    // Update airport statistics
    updateAirportStats(data.stats);
    updateLastUpdateTime(lastUpdateTime);

    if (previousAirports.length > 0) {
      notifyAirportStatusChanges(airportsData);
    } else {
      airportsData.forEach((airport) => lastAirportStatuses.set(airport.icao, airport.status));
    }

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
    const previousKoData = koData;
    koData = data.restrictions;
    filteredKo = [...koData];

    // Update KO stats cards
    updateKoStats(data.stats);

    if (previousKoData.length > 0) {
      notifyKoStatusChanges(koData);
    } else {
      koData.forEach((restriction) => lastKoStatuses.set(restriction.id, restriction.status));
    }
    
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
  const legacyTotal = document.getElementById("total-airports");
  const legacyClosed = document.getElementById("closed-airports");
  const legacyOpen = document.getElementById("open-airports");
  const legacyRestricted = document.getElementById("restricted-airports");

  if (legacyTotal) legacyTotal.textContent = stats.total;
  if (legacyClosed) legacyClosed.textContent = stats.closed;
  if (legacyOpen) legacyOpen.textContent = stats.open;
  if (legacyRestricted) legacyRestricted.textContent = stats.restricted;

  const tickerOpen = document.getElementById("ticker-open");
  const tickerClosed = document.getElementById("ticker-closed");
  const tickerRestricted = document.getElementById("ticker-restricted");

  if (tickerOpen) tickerOpen.textContent = stats.open;
  if (tickerClosed) tickerClosed.textContent = stats.closed;
  if (tickerRestricted) tickerRestricted.textContent = stats.restricted;
}

// Update top bar KO statistics
function updateKoStats(stats) {
  const legacyTotal = document.getElementById("total-ko");
  const legacyActive = document.getElementById("active-ko");
  const legacyUpcoming = document.getElementById("upcoming-ko");

  if (legacyTotal) legacyTotal.textContent = stats.total;
  if (legacyActive) legacyActive.textContent = stats.active;
  if (legacyUpcoming) legacyUpcoming.textContent = stats.upcoming;

  const tickerKoActive = document.getElementById("ticker-ko-active");
  const tickerKoUpcoming = document.getElementById("ticker-ko-upcoming");

  if (tickerKoActive) tickerKoActive.textContent = stats.active;
  if (tickerKoUpcoming) tickerKoUpcoming.textContent = stats.upcoming;
}

// Update last update time display
function formatRelativeTime(timestamp, fallback = "—") {
  if (!timestamp) return fallback;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return fallback;

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "только что";
  if (diffMins < 60) return `${diffMins} мин назад`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;

  return date.toLocaleString("ru-RU");
}

function updateLastUpdateTime(timestamp) {
  const tickerLastUpdate = document.getElementById("ticker-last-update");
  const displayText = formatRelativeTime(timestamp, "—");

  if (tickerLastUpdate) {
    tickerLastUpdate.textContent = displayText;
  }
}

function buildTickerEventLabel(minutesAgo = 1) {
  return `• ${minutesAgo} мин назад`;
}

function notifyAirportStatusChanges(nextAirports) {
  nextAirports.forEach((airport) => {
    const previousStatus = lastAirportStatuses.get(airport.icao);
    const nextStatus = airport.status;

    if (previousStatus && previousStatus !== nextStatus) {
      const minutesAgo = 1;
      let message = `${airport.name} (${airport.icao}) обновлён ${buildTickerEventLabel(minutesAgo)}`;
      let type = "info";

      if (nextStatus === "OPEN") {
        message = `✈ ${airport.name} (${airport.icao}) открыт ${buildTickerEventLabel(minutesAgo)}`;
        type = "success";
      } else if (nextStatus === "CLOSED") {
        message = `✈ ${airport.name} (${airport.icao}) закрыт ${buildTickerEventLabel(minutesAgo)}`;
        type = "error";
      } else if (nextStatus === "RESTRICTED") {
        message = `✈ ${airport.name} (${airport.icao}) ограничения ${buildTickerEventLabel(minutesAgo)}`;
        type = "warning";
      }

      addTickerMessage(type, message, tickerMessageDurationMs);
    }

    lastAirportStatuses.set(airport.icao, nextStatus);
  });
}

function notifyKoStatusChanges(nextRestrictions) {
  nextRestrictions.forEach((restriction) => {
    const previousStatus = lastKoStatuses.get(restriction.id);
    const nextStatus = restriction.status;

    if (previousStatus && previousStatus !== nextStatus) {
      const minutesAgo = 2;
      const zoneName = restriction.rvmname || restriction.id || "Зона";
      let message = `${zoneName} обновлена ${buildTickerEventLabel(minutesAgo)}`;
      let type = "info";

      if (nextStatus === "active") {
        message = `🛡️ ${zoneName} начала действовать ${buildTickerEventLabel(minutesAgo)}`;
        type = "warning";
      } else if (nextStatus === "upcoming") {
        message = `🛡️ ${zoneName} завершилась ${buildTickerEventLabel(minutesAgo)}`;
        type = "success";
      }

      addTickerMessage(type, message, tickerMessageDurationMs);
    }

    lastKoStatuses.set(restriction.id, nextStatus);
  });
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

const MOBILE_MAP_CLASS = "mobile-map-open";

function isMobileViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function toggleMobileMap(shouldOpen) {
  const nextState = typeof shouldOpen === "boolean" ? shouldOpen : !document.body.classList.contains(MOBILE_MAP_CLASS);
  document.body.classList.toggle(MOBILE_MAP_CLASS, nextState);

  const toggleButton = document.getElementById("mobile-map-toggle");
  if (toggleButton) {
    toggleButton.setAttribute("aria-expanded", String(nextState));
  }

  if (map && typeof map.invalidateSize === "function") {
    setTimeout(() => map.invalidateSize(), 80);
  }
}

function setupMobileMapControls() {
  const toggleButton = document.getElementById("mobile-map-toggle");
  const closeButton = document.getElementById("mobile-map-close");

  if (toggleButton) {
    toggleButton.addEventListener("click", () => toggleMobileMap(true));
  }

  if (closeButton) {
    closeButton.addEventListener("click", () => toggleMobileMap(false));
  }

  window.addEventListener("resize", () => {
    if (!isMobileViewport()) {
      toggleMobileMap(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains(MOBILE_MAP_CLASS)) {
      toggleMobileMap(false);
    }
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
function syncQuickFilterButtons() {
  const quickButtons = document.querySelectorAll(".quick-filter-btn");
  quickButtons.forEach((button) => {
    const isActive = button.dataset.status === currentStatusFilter;
    button.classList.toggle("active", isActive);
  });
}

function setupEventListeners() {
  setupMobileMapControls();

  const searchInput = document.getElementById("search-input");
  const routeInput = document.getElementById("rte-input");
  const buildRouteBtn = document.getElementById("rte-btn");
  const quickButtons = document.querySelectorAll(".quick-filter-btn");

  searchInput.addEventListener("input", (e) => {
    currentSearchTerm = e.target.value.toUpperCase();
    applyFilters();
  });

  quickButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currentStatusFilter = button.dataset.status || "";
      syncQuickFilterButtons();
      applyFilters();
    });
  });
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

function showNotification(message, type = "info") {
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Apply search and filter for airports
function applyFilters() {
  syncQuickFilterButtons();
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
function createBlinkingMarker(lat, lon, status, possibleIvP = false, isSelected = false) {
  const color = possibleIvP ? "#f97316" : (statusColors[status] || "#888888");
  const ringColor = isSelected ? "#f8fafc" : "transparent";
  const ringRadius = isSelected ? 12 : 10;
  const strokeWidth = isSelected ? 3 : 0;

  const svgMarkup = `
    <svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>
      <circle cx='14' cy='14' r='${ringRadius}' fill='none' stroke='${ringColor}' stroke-width='${strokeWidth}'/>
      <circle cx='14' cy='14' r='10' fill='${color}' opacity='0.7'/>
      <circle cx='14' cy='14' r='6' fill='${color}'/>
    </svg>`;

  const iconUrl =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarkup);

  return new L.Icon({
    iconUrl: iconUrl,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
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
    const statusMeta = getAirportStatusMeta(airport);
    const isSelected = selectedAirportIcao === airport.icao;

    const icon = createBlinkingMarker(
      airport.latitude,
      airport.longitude,
      airport.status,
      possibleIvP,
      isSelected,
    );

    const marker = new L.Marker([airport.latitude, airport.longitude], {
      icon: icon,
      keyboard: false,
    }).addTo(map);

    marker.on("click", () => {
      selectedAirportIcao = airport.icao;
      renderAirportDetail(airport);
    });

    markers[airport.icao] = marker;

    const li = document.createElement("li");
    li.className = `airport-item status-${airport.status.toLowerCase()}${isSelected ? " selected" : ""}`;

    const blinkDot = document.createElement("span");
    blinkDot.className = `blink-dot status-${airport.status.toLowerCase()}`;

    const airportInfo = document.createElement("span");
    airportInfo.className = "airport-info";
    airportInfo.innerHTML = `
      <strong>${airport.name}</strong>
      <small>${airport.icao}</small>
      <div class="airport-meta">
        <span class="airport-updated">${statusMeta.displayStatus}</span>
        <span class="airport-source">${statusMeta.sourceLabel}</span>
      </div>
    `;

    li.appendChild(blinkDot);
    li.appendChild(airportInfo);

    li.addEventListener("click", () => {
      selectedAirportIcao = airport.icao;
      renderAirportDetail(airport);
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
function renderKoDetail(ko) {
  const koList = document.querySelector(".ko_list");
  if (!koList || !ko) return;

  const statusText = ko.status === "active" ? "Активно" : "Предстоящее";
  const categoryText = ko.category === "full_closure" ? "Полное закрытие" :
    ko.category === "partial_closure" ? "Частичное закрытие" :
    ko.category === "route" ? "Маршрут" : "КО";

  const detailHtml = `
    <div class="ko-detail-panel">
      <div class="detail-sheet-header">
        <button type="button" class="ko-detail-back mobile-detail-close" aria-label="Вернуться к списку">← Назад</button>
        <span class="ko-detail-source">Режим КО</span>
      </div>
      <div class="ko-detail-head">
        <span class="ko-badge ${ko.status === 'active' ? 'badge-active' : 'badge-upcoming'}">${statusText}</span>
        <span class="ko-badge badge-route">${categoryText}</span>
      </div>
      <h3 class="ko-detail-name">${ko.rvmname || 'Ограничение'}</h3>
      <div class="ko-detail-grid">
        <div><span>FIR</span><strong>${(ko.firlist || []).join(', ') || '—'}</strong></div>
        <div><span>Высоты</span><strong>${ko.levelfrom || '—'} — ${ko.levelto || '—'}</strong></div>
        <div><span>Период</span><strong>${formatKoDate(ko.datefrom)} — ${formatKoDate(ko.dateto)}</strong></div>
        <div><span>Источник</span><strong>Режим КО</strong></div>
      </div>
      <div class="ko-detail-desc">
        ${ko.description || 'Описание отсутствует.'}
      </div>
    </div>
  `;

  if (isMobileViewport()) {
    if (document.body.classList.contains("mobile-map-open") || window.innerWidth <= 768) {
      toggleMobileMap(true);
    }
    openMobileDetailSheet(detailHtml);
    return;
  }

  koList.innerHTML = detailHtml;

  const backButton = koList.querySelector(".ko-detail-back");
  if (backButton) {
    backButton.addEventListener("click", () => {
      selectedKoId = null;
      renderRestrictions(filteredKo);
    });
  }
}

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
    const isSelected = selectedKoId === ko.id;
    const lineWeightBoost = isSelected ? 1.8 : 1;
    const lineOpacity = isSelected ? 1 : 0.7;
    const fillOpacity = isSelected ? 0.42 : 0.25;
    
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
          fillOpacity: fillOpacity,
          opacity: lineOpacity,
          weight: 2 * lineWeightBoost
        });
      } else if (zone.type === 'route') {
        const pathLine = new L.Polyline(zone.coords, {
          color: color,
          weight: 8 * lineWeightBoost,
          opacity: lineOpacity
        });
        const centerLine = new L.Polyline(zone.coords, {
          color: '#ffffff',
          weight: 2 * lineWeightBoost,
          opacity: 0.9,
        });
        
        pathLine.on("click", () => {
          selectedKoId = ko.id;
          switchToTab("ko");
          renderKoDetail(ko);
        });
        centerLine.on("click", () => {
          selectedKoId = ko.id;
          switchToTab("ko");
          renderKoDetail(ko);
        });

        pathLine.addTo(map);
        centerLine.addTo(map);
        
        koLayers.push(pathLine);
        koLayers.push(centerLine);
        ko._layers.push(pathLine);
        return;
      } else if (zone.type === 'polygon') {
        layer = new L.Polygon(zone.coords, {
          color: color,
          fillColor: color,
          fillOpacity: fillOpacity,
          opacity: lineOpacity,
          weight: 2 * lineWeightBoost
        });
      }

      if (layer) {
        layer.on("click", () => {
          selectedKoId = ko.id;
          switchToTab("ko");
          renderKoDetail(ko);
        });
        layer.addTo(map);
        koLayers.push(layer);
        ko._layers.push(layer);
      }
    });

    // Add list item
    const li = document.createElement("li");
    li.className = `ko-item cat-${ko.category} status-${ko.status}${selectedKoId === ko.id ? " selected" : ""}`;

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
      selectedKoId = ko.id;
      switchToTab("ko");
      renderKoDetail(ko);
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
  previewB: null,
  lineLayer: null,
  markerALayer: null,
  markerBLayer: null,
};

function ensureBearingDistanceOverlay() {
  let el = document.getElementById("bearing-distance-overlay");
  if (el) return;

  const mapContainer = document.querySelector(".map_module");
  if (!mapContainer) return;

  const container = document.createElement("div");
  container.id = "bearing-distance-overlay";
  container.style.position = "absolute";
  container.style.bottom = "18px";
  container.style.left = "14px";
  container.style.zIndex = "1200";
  container.style.background = "rgba(15, 23, 42, 0.88)";
  container.style.color = "#e2e8f0";
  container.style.padding = "10px 14px";
  container.style.borderRadius = "10px";
  container.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  container.style.fontSize = "13px";
  container.style.lineHeight = "1.5";
  container.style.maxWidth = "290px";
  container.style.backdropFilter = "blur(6px)";
  container.style.border = "1px solid rgba(148, 163, 184, 0.25)";
  container.style.boxShadow = "0 6px 18px rgba(15, 23, 42, 0.28)";
  container.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px;font-size:14px;color:#f8fafc;">📏 Курс / Дистанция</div>
    <div id="bd-click-a" style="margin-bottom:2px;">Клик A: —</div>
    <div id="bd-click-b" style="margin-bottom:6px;">Клик B: —</div>
    <div id="bd-bearing" style="margin-bottom:2px;">Курс (истинный север): —</div>
    <div id="bd-distance">Дистанция: —</div>
    <div style="margin-top:8px;font-size:11px;opacity:0.7;">Кликните карту дважды для замера</div>
  `;

  container.style.display = "none";
  mapContainer.style.position = "relative";
  mapContainer.appendChild(container);
}

function clearBearingOverlays({ keepPreview = false } = {}) {
  const s = bearingState;
  if (s.lineLayer) { map.removeLayer(s.lineLayer); s.lineLayer = null; }
  if (s.markerALayer) { map.removeLayer(s.markerALayer); s.markerALayer = null; }
  if (s.markerBLayer) { map.removeLayer(s.markerBLayer); s.markerBLayer = null; }
  if (!keepPreview) {
    s.previewB = null;
  }
}

function getBearingTargetPoint() {
  return bearingState.clickB || bearingState.previewB || null;
}

function updateBearingDisplay() {
  const s = bearingState;
  const el = document.getElementById("bearing-distance-overlay");
  if (!el) return;

  const fmtCoord = (p) => `(${p.lat.toFixed(3)}, ${p.lon.toFixed(3)})`;
  const endPoint = getBearingTargetPoint();

  document.getElementById("bd-click-a").textContent = `Клик A: ${s.clickA ? fmtCoord(s.clickA) : "—"}`;
  document.getElementById("bd-click-b").textContent = `Клик B: ${endPoint ? fmtCoord(endPoint) : "—"}`;

  if (s.clickA && endPoint) {
    const brng = Math.round(computeTrueBearingDeg(s.clickA.lat, s.clickA.lon, endPoint.lat, endPoint.lon));
    const dist = computeHaversineKm(s.clickA.lat, s.clickA.lon, endPoint.lat, endPoint.lon);

    document.getElementById("bd-bearing").textContent = `Курс (истинный север): ${brng}°`;
    const distMi = dist * 0.539957;
    const fmtDist = dist >= 10 ? `${dist.toFixed(1)} км` : `${(dist * 1000).toFixed(0)} м`;
    document.getElementById("bd-distance").textContent = `Дистанция: ${fmtDist} (${distMi.toFixed(1)} mi)`;
  } else {
    document.getElementById("bd-bearing").textContent = "Курс (истинный север): —";
    document.getElementById("bd-distance").textContent = "Дистанция: —";
  }
}

function drawBearingLine() {
  const s = bearingState;
  clearBearingOverlays({ keepPreview: true });

  if (!s.clickA) return;

  const markerStyle = (color) => ({
    radius: 7,
    fillColor: color,
    color: "#fff",
    weight: 2,
    fillOpacity: 1,
  });

  s.markerALayer = new L.CircleMarker([s.clickA.lat, s.clickA.lon], markerStyle("#3b82f6")).addTo(map);
  s.markerALayer.bindTooltip("A", {
    permanent: true,
    direction: "top",
    className: "bearing-marker-tooltip",
    offset: [0, -8],
  });

  const endPoint = getBearingTargetPoint();
  if (!endPoint) return;

  s.markerBLayer = new L.CircleMarker([endPoint.lat, endPoint.lon], markerStyle("#ef4444")).addTo(map);
  s.markerBLayer.bindTooltip("B", {
    permanent: true,
    direction: "top",
    className: "bearing-marker-tooltip",
    offset: [0, -8],
  });

  s.lineLayer = new L.Polyline([
    [s.clickA.lat, s.clickA.lon],
    [endPoint.lat, endPoint.lon],
  ], {
    color: "#f59e0b",
    weight: 3,
    opacity: 0.95,
    dashArray: "10, 8",
    className: "bearing-line",
  }).addTo(map);

  updateBearingDisplay();
}
// 1. Выносим переменную на самый верх, чтобы её видели абсолютно все функции


function loadAnimation() {
  const track = document.getElementById('ticker_track_line');
  const originalContent = document.getElementById('ticker_original_content');
  if (!track || !originalContent) return;

  updateMarqueeAnimation = function() {
    const clones = track.querySelectorAll('.ticker_content:not(#ticker_original_content)');
    clones.forEach((clone) => clone.remove());

    const contentWidth = originalContent.getBoundingClientRect().width;
    if (!contentWidth) return;

    const viewportWidth = track.parentElement ? track.parentElement.getBoundingClientRect().width : window.innerWidth;
    const copiesNeeded = Math.ceil((viewportWidth + contentWidth) / contentWidth) + 1;

    for (let i = 0; i < copiesNeeded; i++) {
      const clone = originalContent.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      track.appendChild(clone);
    }

    track.style.setProperty('--scroll-distance', `${-contentWidth}px`);
    track.style.animation = 'scrollContinuous 24s linear infinite';
  };

  updateMarqueeAnimation();
  if (!track.dataset.animationBound) {
    window.addEventListener('resize', updateMarqueeAnimation);
    track.dataset.animationBound = 'true';
  }
}

function addTickerMessage(type, text, durationMs = 5000) {
  const originalContent = document.getElementById('ticker_original_content');
  if (!originalContent) return;

  // 1. Создаем элемент для оригинальной строки
  const newItem = document.createElement('span');
  newItem.className = `ticker_item msg-${type}`;
  newItem.innerHTML = text;
  
  // Уникальный маркер, чтобы потом найти именно этот элемент во всех копиях
  const uniqueId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  newItem.setAttribute('data-msg-id', uniqueId);

  // 2. Пушим в конец оригинальной строки
  originalContent.appendChild(newItem);

  // 3. Приказываем системе пересобрать ленту с учетом нового элемента
  if (typeof updateMarqueeAnimation === 'function') {
    updateMarqueeAnimation();
  }

  // 4. По истечении времени удаляем элемент
  setTimeout(() => {
    // Находим этот элемент в оригинале и во всех клонах по маркеру
    const targets = document.querySelectorAll(`[data-msg-id="${uniqueId}"]`);
    
    let originalRemoved = false;

    targets.forEach(el => {
      // Плавное исчезновение перед удалением
      el.style.opacity = '0';
      el.style.transform = 'scale(0.8)';
      
      setTimeout(() => {
        el.remove();
        // Пересчитываем анимацию ОДИН раз, когда удалены все элементы, чтобы строка не дергалась
        if (!originalRemoved && typeof updateMarqueeAnimation === 'function') {
          originalRemoved = true;
          updateMarqueeAnimation();
        }
      }, 300);
    });

  }, durationMs);
}

// Инициализация при полной загрузке DOM (исправлен синтаксис)
document.addEventListener("DOMContentLoaded", () => {
  loadAnimation();

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
      bearingState.previewB = null;
      if (overlayEl) overlayEl.style.display = "block";
    } else if (!bearingState.clickB) {
      bearingState.clickB = { lat, lon };
      bearingState.previewB = null;
    } else {
      bearingState.clickA = { lat, lon };
      bearingState.clickB = null;
      bearingState.previewB = null;
    }

    drawBearingLine();
  });

  map.on("mousemove", (e) => {
    if (!bearingState.clickA || bearingState.clickB) {
      if (!bearingState.clickA) {
        bearingState.previewB = null;
      }
      return;
    }

    bearingState.previewB = { lat: e.latlng.lat, lon: e.latlng.lng };
    drawBearingLine();
  });

  map.on("mouseout", () => {
    if (bearingState.clickA && !bearingState.clickB) {
      bearingState.previewB = null;
      drawBearingLine();
    }
  });

  map.on("contextmenu", () => {
    clearBearingOverlays();
    bearingState.clickA = null;
    bearingState.clickB = null;
    bearingState.previewB = null;
    if (overlayEl) overlayEl.style.display = "none";
  });

  // Set 5-minute auto refresh for both datasets
  setInterval(async () => {
    console.log("Auto-refreshing data...");
    await loadAirports();
    await loadRestrictions();
  }, 300000);
});


