
from django.urls import path, include
import kovermap.views

urlpatterns = [
    path("", kovermap.views.detail),
    path("api/airports/", kovermap.views.airports_api),
    path("api/airports/update/", kovermap.views.update_airports),
    path("api/ko/", kovermap.views.ko_api),
    path('api/route/', kovermap.views.get_route_data, name='api_route'),
]
