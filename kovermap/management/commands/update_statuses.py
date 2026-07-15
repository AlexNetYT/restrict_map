from django.core.management.base import BaseCommand
from kovermap.services import AirportStatusManager
from kovermap.models import Airport

class Command(BaseCommand):
    def handle(self, *args, **options):
        manager = AirportStatusManager("airports.json")
        data = manager.update_statuses_from_url("https://t.me/s/favt_info")
        
        for icao, info in data.items():
            Airport.objects.update_or_create(
                icao=icao,
                defaults={'status': info['status']}
            )
        self.stdout.write("Статусы успешно обновлены")