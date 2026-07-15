import re
import json
from bs4 import BeautifulSoup
import requests
from kovermap.models import Airport
class AirportStatusManager:
    def __init__(self):
        self.airports = {}
        self.city_index = {}
        self.airport_name_index = {}
        self._load_data()

    def _load_data(self):
        # with open(self.json_path, "r", encoding="utf-8") as f:
        #     data = json.load(f)
        #     for item in data:
        #         item['status'] = "OPEN"
        #         self.airports[item["icao"]] = item
        #         self.city_index[item['city']] = item
        #         self.airport_name_index[item['airport']] = item
        airports_db = Airport.objects.all()
        
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
        response = requests.get(url)
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