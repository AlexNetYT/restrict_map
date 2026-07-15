from django.apps import AppConfig
import logging

logger = logging.getLogger(__name__)


class KovermapConfig(AppConfig):
    name = 'kovermap'
    
    def ready(self):
        """Initialize APScheduler on app startup"""
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.interval import IntervalTrigger
            from kovermap.services import AirportUpdateService
            import os
            
            # Only start scheduler in main process (not in reload)
            if os.environ.get('RUN_MAIN') != 'true':
                return
            
            scheduler = BackgroundScheduler()
            
            # Check if job already exists
            if not scheduler.get_job('airport_auto_updater'):
                # Get update interval from environment or default to 1 minute
                update_interval = int(os.environ.get('AIRPORT_UPDATE_INTERVAL', 1))
                
                scheduler.add_job(
                    func=AirportUpdateService.update_from_telegram,
                    trigger=IntervalTrigger(minutes=update_interval),
                    id='airport_auto_updater',
                    name='Automatic airport status updater',
                    replace_existing=False,
                )
                
                if not scheduler.running:
                    scheduler.start()
                    logger.info(f'✓ APScheduler started (airport updates every {update_interval} minute(s))')
        except ImportError:
            logger.warning('APScheduler not installed. Install with: pip install apscheduler')
        except Exception as e:
            logger.error(f'Error initializing scheduler: {e}', exc_info=True)

