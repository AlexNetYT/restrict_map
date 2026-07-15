from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.db.models import Count, Q
from django.contrib.auth.decorators import login_required, user_passes_test
from kovermap.models import Airport, UpdateLog
from kovermap.services import AirportUpdateService, parse_flight_plan


# Create your views here.
def detail(request):
    return render(request, "index.html")


def get_route_data(request):
    # Получаем маршрут из GET-параметра ?route=...
    route = request.GET.get('route', '').strip()
    if not route:
        return JsonResponse({'error': 'Маршрут не передан'}, status=400)

    # Basic anti-DoS limits
    if len(route) > 500:
        return JsonResponse({'error': 'Маршрут слишком длинный'}, status=400)

    tokens = route.split()
    if len(tokens) > 50:
        return JsonResponse({'error': 'Слишком много элементов маршрута'}, status=400)

    db_path = 'nd.db3'  # Путь к вашей базе данных
    data = parse_flight_plan(route, db_path)
    return JsonResponse(data)


def airports_api(request):
    """API endpoint that returns all airports with their status and coordinates"""
    airports_qs = Airport.objects.all()

    # Stats (single query)
    stats = airports_qs.aggregate(
        total=Count('id'),
        closed=Count('id', filter=Q(status='CLOSED')),
        open_count=Count('id', filter=Q(status='OPEN')),
        restricted=Count('id', filter=Q(status='RESTRICTED')),
    )

    # Data (single query)
    data = list(
        airports_qs.values(
            'icao',
            'name',
            'city',
            'status',
            'latitude',
            'longitude',
        )
    )

    # Get last update timestamp
    last_update = UpdateLog.objects.filter(success=True).first()
    last_update_time = last_update.timestamp.isoformat() if last_update else None

    return JsonResponse({
        'airports': data,
        'stats': {
            'total': stats['total'],
            'closed': stats['closed'],
            'open': stats['open_count'],
            'restricted': stats['restricted'],
        },
        'last_update': last_update_time,
    })



@require_http_methods(["POST"])
@login_required
@user_passes_test(lambda u: u.is_staff)
def update_airports(request):
    """Manual update of airport statuses (staff only)."""
    log = AirportUpdateService.update_from_telegram()

    return JsonResponse({
        'success': log.success,
        'message': 'Update completed' if log.success else log.error_message,
        'airports_updated': log.airports_updated,
        'timestamp': log.timestamp.isoformat(),
    })



from kovermap.services import KORestrictionService

def ko_api(request):
    """API endpoint that returns active and upcoming KO restrictions"""
    restrictions = KORestrictionService.get_restrictions()
    
    total = len(restrictions)
    active = sum(1 for r in restrictions if r['status'] == 'active')
    upcoming = sum(1 for r in restrictions if r['status'] == 'upcoming')
    
    return JsonResponse({
        'restrictions': restrictions,
        'stats': {
            'total': total,
            'active': active,
            'upcoming': upcoming,
        }
    })


