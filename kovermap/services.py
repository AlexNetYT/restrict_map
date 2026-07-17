import re
import json
from bs4 import BeautifulSoup
import requests
from kovermap.models import Airport
import django

# Network/service defaults (production safety)
DEFAULT_REQUEST_TIMEOUT_SECONDS = 10

class AirportStatusManager:

    def __init__(self):
        self.airports = {}
        self.city_index = {}
        self.airport_name_index = {}
        self._load_data()

    def _load_data(self):
        airports = Airport.objects.all()
        for airport in airports:
            item = {
                "icao": airport.icao,
                "airport": airport.name,
                "city": airport.city,
                "lat": airport.latitude,
                "long": airport.longitude,
                "city": airport.city,
                "status": airport.status
            }
            self.airports[item["icao"]] = item
            self.city_index[item['city']] = item
            self.airport_name_index[item['airport']] = item

    def parse_text(self, text):
        text = re.sub(r'\s+', ' ', text).strip()
        status = "UNKNOWN"
        
        if "СНЯТЫ" in text.upper():
            status = "OPEN"
        elif "ВВЕДЕНЫ" in text.upper():
            status = "RESTRICTED"
        elif "принимают и отправляют" in text.lower() or "принимает и отправляет" in text.lower():
            status = "WORKING_LIMITED"
        
        if status == "UNKNOWN":
            return None

        airports_found = []
        match = re.search(r'Аэропорт(?:ы)?\s*(.*?)\s*(?:✈️|принимают|СНЯТЫ|ВВЕДЕНЫ|❗|🗓)', text, re.IGNORECASE)
        
        if match:
            raw_items = re.split(r'[—–-]', match.group(1))
            for item in raw_items:
                clean = item.strip().strip(' :')
                if clean and len(clean) > 2 and "согласованию" not in clean.lower():
                    if ' и ' in clean.lower():
                        airports_found.extend([s.strip() for s in clean.split(' и ')])
                    else:
                        airports_found.append(clean)
        
        return {"status": status, "airports": airports_found}

    def update_statuses_from_url(self, url):
        response = requests.get(
            url,
            timeout=DEFAULT_REQUEST_TIMEOUT_SECONDS,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'lxml')

        messages = soup.find_all('div', class_='tgme_widget_message_text')
        
        for message in messages:
            info = self.parse_text(message.get_text())
            if not info:
                continue
                
            for name in info['airports']:
                icao = self._find_icao(name)
                if icao:
                    self.airports[icao]['status'] = info['status']
        return self.airports

    def _find_icao(self, name):
        name_clean = name.title()
        if name_clean in self.airport_name_index:
            return self.airport_name_index[name_clean]['icao']
        if name_clean in self.city_index:
            return self.city_index[name_clean]['icao']
        return None


# Import here to avoid circular imports
import logging
from django.utils import timezone
from kovermap.models import Airport, UpdateLog

logger = logging.getLogger(__name__)


class AirportUpdateService:
    """Service to update airport statuses from Telegram"""
    
    TELEGRAM_URL = "https://t.me/s/favt_info"
    
    @staticmethod
    def update_from_telegram():
        """Update airport statuses from Telegram"""
        try:
            logger.info("Starting airport status update from Telegram...")
            
            # Parse data from Telegram
            manager = AirportStatusManager()
            updated_data = manager.update_statuses_from_url(AirportUpdateService.TELEGRAM_URL)
            
            # Update database (avoid N+1)
            updated_count = 0
            target_icaos = list(updated_data.keys())
            airports_qs = Airport.objects.filter(icao__in=target_icaos).only('icao', 'status')
            airports_by_icao = {a.icao: a for a in airports_qs}

            now_ts = timezone.now()
            for icao, data in updated_data.items():
                airport = airports_by_icao.get(icao)
                if not airport:
                    continue
                new_status = data.get('status', 'OPEN')
                old_status = airport.status

                if old_status != new_status:
                    Airport.objects.filter(icao=icao).update(
                        status=new_status,
                        last_updated=now_ts,
                    )
                    updated_count += 1
                    logger.info(f"Updated {icao}: {old_status} → {new_status}")

            
            # Log success
            log = UpdateLog.objects.create(
                success=True,
                airports_updated=updated_count
            )
            logger.info(f"Airport update completed. Updated {updated_count} airports.")
            return log
            
        except Exception as e:
            error_msg = f"Error updating airports: {str(e)}"
            logger.error(error_msg, exc_info=True)
            
            # Log failure
            log = UpdateLog.objects.create(
                success=False,
                error_message=error_msg,
                airports_updated=0
            )
            return log
    
    @staticmethod
    def get_last_update():
        """Get timestamp of last successful update"""
        log = UpdateLog.objects.filter(success=True).first()
        if log:
            return log.timestamp
        return None


import os
import xml.etree.ElementTree as ET
from django.conf import settings
from django.utils.dateparse import parse_datetime

class KORestrictionParser:
    @staticmethod
    def parse_coordinate(c_str):
        if not c_str:
            return None
        match = re.match(r'(\d{2})(\d{2})(\d{2})([СЮ])(\d{3})(\d{2})(\d{2})([ВЗ])', c_str.strip())
        if not match:
            return None
        lat_deg, lat_min, lat_sec, lat_hemi, lon_deg, lon_min, lon_sec, lon_hemi = match.groups()
        
        lat = float(lat_deg) + float(lat_min)/60.0 + float(lat_sec)/3600.0
        if lat_hemi == 'Ю':
            lat = -lat
            
        lon = float(lon_deg) + float(lon_min)/60.0 + float(lon_sec)/3600.0
        if lon_hemi == 'З':
            lon = -lon
            
        return round(lat, 6), round(lon, 6)

    @classmethod
    def parse_description(cls, description):
        if not description:
            return []
            
        desc_clean = re.sub(r'\s+', ' ', description).strip()
        zones = []
        zone_texts = re.split(r'(?=ЗОНА\s+\d+|ZONE\s+\d+)', desc_clean, flags=re.IGNORECASE)
        
        for zone_text in zone_texts:
            zone_text = zone_text.strip()
            if not zone_text:
                continue
                
            coords_raw = re.findall(r'\d{6}[СЮ]\d{7}[ВЗ]', zone_text)
            if not coords_raw:
                continue
                
            parsed_coords = []
            for c in coords_raw:
                parsed = cls.parse_coordinate(c)
                if parsed:
                    parsed_coords.append(parsed)
                    
            if not parsed_coords:
                continue
                
            # Classify geometry type
            if "ЦЕНТРОМ" in zone_text.upper() and "РАДИУСОМ" in zone_text.upper():
                radius_match = re.search(r'РАДИУСОМ\s+([\d.]+)\s*(?:КМ|KM)', zone_text, re.IGNORECASE)
                radius = float(radius_match.group(1)) if radius_match else 5.0
                zones.append({
                    "type": "circle",
                    "center": parsed_coords[0],
                    "radius_km": radius
                })
            elif "ПОЛОСЕ" in zone_text.upper() or "ОСЬ МАРШРУТА" in zone_text.upper() or "ШИРИНОЙ" in zone_text.upper():
                width_match = re.search(r'ШИРИНОЙ\s+([\d.]+)\s*(?:КМ|KM)', zone_text, re.IGNORECASE)
                width = float(width_match.group(1)) if width_match else 10.0
                unique_coords = []
                for c in parsed_coords:
                    if not unique_coords or c != unique_coords[-1]:
                        unique_coords.append(c)
                zones.append({
                    "type": "route",
                    "coords": unique_coords,
                    "width_km": width
                })
            else:
                unique_coords = []
                for c in parsed_coords:
                    if not unique_coords or c != unique_coords[-1]:
                        unique_coords.append(c)
                zones.append({
                    "type": "polygon",
                    "coords": unique_coords
                })
                
        return zones


class KORestrictionService:
    API_URL = "https://app.matfmc.ru/AirspaceAvailabilityBulletinXML/ko"
    
    @classmethod
    def get_restrictions(cls):
        """
        Loads KO restrictions from API, with a fallback to local base_dir / ko.xml.
        Returns a list of parsed restrictions.
        """
        xml_content = None
        error_msg = None
        
        # Try API first
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/xml,text/xml,*/*',
            }
            response = requests.get(cls.API_URL, headers=headers, timeout=10)
            if response.status_code == 200:
                xml_content = response.content
            else:
                error_msg = f"API returned status code {response.status_code}"
                logger.warning(f"Failed to fetch KO from API: {error_msg}. Falling back to local file.")
        except Exception as e:
            error_msg = str(e)
            logger.warning(f"Error fetching KO from API: {error_msg}. Falling back to local file.")
            
        # Fallback to local file
        if not xml_content:
            local_path = os.path.join(settings.BASE_DIR, 'ko.xml')
            if os.path.exists(local_path):
                logger.info(f"Loading KO restrictions from local file: {local_path}")
                try:
                    with open(local_path, 'rb') as f:
                        xml_content = f.read()
                except Exception as e:
                    logger.error(f"Failed to read local ko.xml file: {e}")
            else:
                logger.error(f"Local file ko.xml not found at {local_path} and API call failed: {error_msg}")
                
        if not xml_content:
            return []
            
        try:
            root = ET.fromstring(xml_content)
            restrictions = []
            
            now = timezone.now()
            
            for ko_node in root.findall('ko'):
                ko_id = (ko_node.find('id').text or "").strip()
                firlist = (ko_node.find('firlist').text or "").strip()
                rvmname = (ko_node.find('rvmname').text or "").strip()
                levelfrom = (ko_node.find('levelfrom').text or "").strip().upper()
                levelto = (ko_node.find('levelto').text or "").strip().upper()
                
                datefrom_str = (ko_node.find('datefrom').text or "").strip()
                dateto_str = (ko_node.find('dateto').text or "").strip()
                updatedate_str = (ko_node.find('updatedate').text or "").strip()
                
                description = (ko_node.find('description').text or "").strip()
                remark = (ko_node.find('remark').text or "").strip()
                
                datefrom = parse_datetime(datefrom_str)
                dateto = parse_datetime(dateto_str)
                updatedate = parse_datetime(updatedate_str) if updatedate_str else None
                
                # Filter out expired KO
                if dateto and dateto < now:
                    continue
                    
                # Parse zones
                zones = KORestrictionParser.parse_description(description)
                if not zones:
                    continue
                    
                # Classify category
                is_route = any(z["type"] == "route" for z in zones) or "ПОЛОСЕ" in description.upper() or "МАРШРУТ" in description.upper()
                if is_route:
                    category = "route"
                elif levelfrom == 'GND' and levelto == 'UNL':
                    category = "full_closure"
                else:
                    category = "partial_closure"
                    
                # Determine status
                if datefrom and datefrom <= now:
                    status = "active"
                else:
                    status = "upcoming"
                    
                restrictions.append({
                    'id': ko_id,
                    'firlist': firlist.split() if firlist else [],
                    'rvmname': rvmname,
                    'levelfrom': levelfrom,
                    'levelto': levelto,
                    'datefrom': datefrom_str,
                    'dateto': dateto_str,
                    'updatedate': updatedate_str,
                    'description': description,
                    'remark': remark,
                    'category': category,
                    'status': status,
                    'zones': zones
                })
                
            return restrictions
            
        except Exception as e:
            logger.error(f"Error parsing KO XML content: {e}", exc_info=True)
            return []
import sqlite3
import math
from collections import deque

def get_all_point_candidates(cursor, ident):
    """Находит ВЕХ кандидатов с таким именем в Waypoints и Airports."""
    candidates = []
    
    # Ищем во всех контрольных точках
    cursor.execute("SELECT Longtitude, Latitude FROM Waypoints WHERE Ident = ?", (ident,))
    for row in cursor.fetchall():
        candidates.append({"ident": ident, "coords": list(row), "type": "WAYPOINT"})
        
    # Ищем во всех аэропортах
    cursor.execute("SELECT Longtitude, Latitude FROM Airports WHERE ICAO = ?", (ident,))
    for row in cursor.fetchall():
        candidates.append({"ident": ident, "coords": list(row), "type": "AIRPORT"})
        
    return candidates

def check_airway_exists(cursor, ident):
    """Проверяет существование трассы."""
    cursor.execute("SELECT 1 FROM Airways WHERE Ident = ?", (ident,))
    return cursor.fetchone() is not None

def haversine_distance(coord1, coord2):
    """
    Рассчитывает точное расстояние между точками на сфере (в километрах).
    coord = [lon, lat]
    """
    lon1, lat1 = math.radians(coord1[0]), math.radians(coord1[1])
    lon2, lat2 = math.radians(coord2[0]), math.radians(coord2[1])
    
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371 # Радиус Земли в километрах
    return c * r

def get_airway_path(cursor, airway, start_ident, end_ident):
    """Строит путь по трассе через BFS."""
    query = """
    SELECT W1.Ident, W1.Longtitude, W1.Latitude, 
           W2.Ident, W2.Longtitude, W2.Latitude 
    FROM AirwayLegs AL
    JOIN Airways A ON AL.AirwayID = A.ID
    JOIN Waypoints W1 ON AL.Waypoint1ID = W1.ID
    JOIN Waypoints W2 ON AL.Waypoint2ID = W2.ID
    WHERE A.Ident = ?
    """
    edges = cursor.execute(query, (airway,)).fetchall()
    
    graph = {}
    coords = {}
    for w1, lon1, lat1, w2, lon2, lat2 in edges:
        if w1 not in graph: graph[w1] = []
        if w2 not in graph: graph[w2] = []
        graph[w1].append(w2)
        graph[w2].append(w1)
        coords[w1] = [lon1, lat1]
        coords[w2] = [lon2, lat2]
        
    if start_ident not in graph or end_ident not in graph:
        return []

    queue = deque([(start_ident, [start_ident])])
    visited = set([start_ident])
    
    while queue:
        curr, path = queue.popleft()
        if curr == end_ident:
            return [coords[p] for p in path]
            
        for neighbor in graph[curr]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path + [neighbor]))
                
    return []

def parse_flight_plan(route_str: str, db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    route_str = route_str.capitalize()
    tokens = route_str.split()
    features = []
    unrecognized = []
    
    # Шаг 1: Разделяем элементы на предполагаемые точки и трассы
    parsed_elements = [] # Список словарей с инфой о точках маршрута
    
    i = 0
    current_airway = "DCT"
    
    while i < len(tokens):
        token = tokens[i]
        if token == "DCT":
            current_airway = "DCT"
            i += 1
            continue
        if '/' in token:
            token = token.split('/')[0]
        token = token.capitalize()
        candidates = get_all_point_candidates(cursor, token)
        
        if candidates:
            # Сохраняем элемент маршрута: имя, трасса до него, и все возможные гео-координаты
            parsed_elements.append({
                "ident": token,
                "airway_before": current_airway,
                "candidates": candidates,
                "selected_coords": None
            })
            current_airway = "DCT" # сбрасываем по умолчанию
        else:
            if check_airway_exists(cursor, token):
                # Если это трасса, привязываем её к следующей точке (она изменит airway_before для неё)
                current_airway = token
            else:
                unrecognized.append(f"Элемент '{token}' не найден в БД")
        i += 1

    # Шаг 2: Разрешаем неоднозначность координат (Амбиции точек вроде AST)
    for idx, el in enumerate(parsed_elements):
        candidates = el["candidates"]
        
        if len(candidates) == 1:
            # Точка уникальна, берем сразу
            el["selected_coords"] = candidates[0]["coords"]
        else:
            # Точка дублируется (например, 4 штуки AST). Ищем ближайшего валидного соседа для сравнения
            ref_coords = None
            
            # 1. Пытаемся посмотреть НАЗАД на уже разрешенную точку
            for back_idx in range(idx - 1, -1, -1):
                if parsed_elements[back_idx]["selected_coords"]:
                    ref_coords = parsed_elements[back_idx]["selected_coords"]
                    break
            
            # 2. Если сзади ничего нет (это первая точка), смотрим ВПЕРЕД на уникальные точки
            if not ref_coords:
                for fwd_idx in range(idx + 1, len(parsed_elements)):
                    # Если у следующей точки 1 кандидат, берем её за эталон
                    if len(parsed_elements[fwd_idx]["candidates"]) == 1:
                        ref_coords = parsed_elements[fwd_idx]["candidates"][0]["coords"]
                        break

            if ref_coords:
                # Находим кандидата с минимальным расстоянием до эталона
                best_candidate = min(candidates, key=lambda c: haversine_distance(c["coords"], ref_coords))
                el["selected_coords"] = best_candidate["coords"]
                unrecognized.append(f"Точка {el['ident']} дублируется. Выбрана ближайшая на основе соседей.")
            else:
                # Если вообще нет соседей вокруг (сложный случай), берем первого попавшегося
                el["selected_coords"] = candidates[0]["coords"]

    # Шаг 3: Сборка GeoJSON путей между определенными точками
    for idx in range(len(parsed_elements) - 1):
        p1 = parsed_elements[idx]
        p2 = parsed_elements[idx + 1]
        
        route_name = p2["airway_before"]
        start_coords = p1["selected_coords"]
        end_coords = p2["selected_coords"]
        
        segment_coords = []
        actual_route_name = route_name
        
        if route_name != "DCT":
            segment_coords = get_airway_path(cursor, route_name, p1["ident"], p2["ident"])
            if not segment_coords:
                unrecognized.append(f"Разрыв трассы {route_name} между {p1['ident']} и {p2['ident']} (заменено на DCT)")
                actual_route_name = "DCT"
                segment_coords = [start_coords, end_coords]
        else:
            segment_coords = [start_coords, end_coords]
            
        features.append({
            "type": "Feature",
            "properties": {
                "name": actual_route_name,
                "from": p1["ident"],
                "to": p2["ident"]
            },
            "geometry": {
                "type": "LineString",
                "coordinates": segment_coords
            }
        })
        
    conn.close()
    
    return {
        "geojson": {
            "type": "FeatureCollection", 
            "features": features
        },
        "unrecognized": unrecognized
    }

def update_airports_DB():
    import requests
    with open("airport_translate.json", "r", encoding="utf-8") as f:
        translator = json.load(f)
    resp = requests.get("https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/refs/heads/master/VATSpy.dat")
    if resp.status_code != 200:
        exit
    text = resp.text
    airports = text.split("[Airports]")[1].split("[FIRs]")[0].strip().split("TXKF|L F Wade Intl|32.364042|-64.678703|BDA|KZNY|0")[1].split("UZDP|Kakaydy|37.62|67.518||UZSD|0 ; io")[0].splitlines()[1:]
    # airports = airports
    aps = []
    for airport in airports:
        info = airport.split("|")
        airport_data = {"icao": info[0], "name": info[1], "lat": float(info[2]), "long": float(info[3]), "iata": info[4], "FIR": info[5]}
        aps.append(airport_data)
    Airport.objects.all().delete()
    
    for ap in aps:
        if ap["FIR"] in ['UUWV', "ULLL", "URRV", "UWWW","USSV","UHHH","UHMM","UIII","UNNT","UACC","UHPP", "UNKL", "USTV", "UEEE"]:
            if ap["icao"] in translator.keys():
                ap["name"] = translator[ap["icao"]]
                print(ap)
            try:
                Airport.objects.create(
                    icao=ap["icao"],
                    name=ap["name"],
                    city=ap["FIR"],
                    latitude=ap["lat"],
                    longitude=ap["long"],
                    status="OPEN"
                )
            except django.db.utils.IntegrityError:
                print(ap)


# =========================
# IVP circle restriction logic (production-safe; circle only)
# =========================

def _haversine_km_latlon(lat1, lon1, lat2, lon2):
    """Haversine distance between points (lat/lon) in kilometers."""
    r_lat1, r_lon1 = math.radians(lat1), math.radians(lon1)
    r_lat2, r_lon2 = math.radians(lat2), math.radians(lon2)

    dlon = r_lon2 - r_lon1
    dlat = r_lat2 - r_lat1

    a = math.sin(dlat / 2) ** 2 + math.cos(r_lat1) * math.cos(r_lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return c * 6371.0


def _ivp_circle_zones_from_restrictions(restrictions):
    """
    Returns a list of:
    {"ko_id": str, "center": (lat, lon), "radius_km": float}
    for zones of type == "circle".
    """
    zones = []
    for r in (restrictions or []):
        ko_id = str(r.get("id", "") or "")
        for z in r.get("zones", []) or []:
            if z.get("type") == "circle":
                zones.append(
                    {
                        "ko_id": ko_id,
                        "center": z.get("center"),
                        "radius_km": z.get("radius_km", 0) or 0,
                    }
                )
    return zones


def get_ivp_airports_by_restrictions(restrictions):
    """
    Compute which Airport.icao are inside ANY IVP circle zone.
    Returns: set of ICAO.
    """
    circles = _ivp_circle_zones_from_restrictions(restrictions)
    possible = set()
    if not circles:
        return possible

    for c in circles:
        center = c.get("center")
        if not center or len(center) != 2:
            continue
        center_lat, center_lon = float(center[0]), float(center[1])

        radius_km = float(c.get("radius_km") or 0)
        if radius_km <= 0:
            continue

        # Bounding box filter
        lat_delta = radius_km / 111.0
        cos_lat = math.cos(math.radians(center_lat))
        lon_delta = radius_km / (111.0 * cos_lat) if cos_lat != 0 else radius_km / 111.0

        candidates = Airport.objects.filter(
            latitude__range=(center_lat - lat_delta, center_lat + lat_delta),
            longitude__range=(center_lon - lon_delta, center_lon + lon_delta),
        ).only("icao", "latitude", "longitude")

        for airport in candidates:
            dist = _haversine_km_latlon(center_lat, center_lon, airport.latitude, airport.longitude)
            if dist <= radius_km:
                possible.add(airport.icao)

    return possible


def get_ivp_circle_hits_for_route_features(features, restrictions):
    """
    features: list of geojson Feature dicts with geometry.type == "LineString"
    restrictions: KO restrictions list
    Returns:
      [
        {
          "from": "<ICAO>",
          "to": "<ICAO>",
          "hit": true/false,
          "ivp_ko_ids": ["<ko_id>", ...]  # only when hit==true
        },
        ...
      ]
    Hit rule (circle-only):
      - consider a segment hit if at least one point of its LineString is within circle radius.
    """
    circles = _ivp_circle_zones_from_restrictions(restrictions)
    if not features:
        return []

    results = []
    for feat in features:
        props = feat.get("properties", {}) or {}
        from_icao = props.get("from")
        to_icao = props.get("to")

        geometry = feat.get("geometry", {}) or {}
        coords = geometry.get("coordinates") or []
        # coords are [lon, lat]
        hit_ko_ids = set()

        if coords and circles:
            # small perf: for each circle do bounding box around its center
            for c in circles:
                center = c.get("center")
                if not center or len(center) != 2:
                    continue
                center_lat, center_lon = float(center[0]), float(center[1])
                radius_km = float(c.get("radius_km") or 0)
                if radius_km <= 0:
                    continue

                lat_delta = radius_km / 111.0
                cos_lat = math.cos(math.radians(center_lat))
                lon_delta = radius_km / (111.0 * cos_lat) if cos_lat != 0 else radius_km / 111.0

                # any point within circle?
                for point in coords:
                    if not point or len(point) < 2:
                        continue
                    lon, lat = float(point[0]), float(point[1])

                    if not (center_lat - lat_delta <= lat <= center_lat + lat_delta):
                        continue
                    if not (center_lon - lon_delta <= lon <= center_lon + lon_delta):
                        continue

                    dist = _haversine_km_latlon(center_lat, center_lon, lat, lon)
                    if dist <= radius_km:
                        hit_ko_ids.add(str(c.get("ko_id", "") or ""))
                        break

        results.append(
            {
                "from": from_icao,
                "to": to_icao,
                "hit": bool(hit_ko_ids),
                "ivp_ko_ids": sorted([x for x in hit_ko_ids if x]),
            }
        )

    return results
