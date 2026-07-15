from django.core.management.base import BaseCommand
from kovermap.services import AirportUpdateService


class Command(BaseCommand):
    help = 'Update airport statuses from Telegram channel'

    def add_arguments(self, parser):
        parser.add_argument(
            '--schedule',
            type=int,
            default=1,
            help='Update interval in minutes (default: 1)',
        )

    def handle(self, *args, **options):
        interval = options['schedule']
        
        self.stdout.write(
            self.style.SUCCESS(f'Starting airport status updates (interval: {interval} min)...')
        )
        
        # Initial update
        log = AirportUpdateService.update_from_telegram()
        if log.success:
            self.stdout.write(
                self.style.SUCCESS(f'✓ Updated {log.airports_updated} airports')
            )
        else:
            self.stdout.write(
                self.style.ERROR(f'✗ Error: {log.error_message}')
            )
        
        # Schedule periodic updates
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.interval import IntervalTrigger
            
            scheduler = BackgroundScheduler()
            scheduler.add_job(
                func=AirportUpdateService.update_from_telegram,
                trigger=IntervalTrigger(minutes=interval),
                id='airport_updater',
                name='Airport status updater',
                replace_existing=True,
            )
            scheduler.start()
            
            self.stdout.write(
                self.style.SUCCESS(f'✓ Scheduler started (updates every {interval} minute(s))')
            )
            
            # Keep running
            try:
                import time
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                scheduler.shutdown()
                self.stdout.write(self.style.SUCCESS('\n✓ Scheduler stopped'))
        except ImportError:
            self.stdout.write(
                self.style.WARNING('APScheduler not installed. Install with: pip install apscheduler')
            )
