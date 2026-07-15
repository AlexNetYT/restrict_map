import json
from django.core.management.base import BaseCommand
from kovermap.models import Airport
from kovermap.services import update_airports_DB
class Command(BaseCommand):
    help = 'Load airports from JSON file with coordinates'

    def handle(self, *args, **options):
        # Load coordinates
        update_airports_DB()

        self.stdout.write(self.style.SUCCESS('Successfully loaded airports'))
