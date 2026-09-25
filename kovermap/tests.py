from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase

from kovermap.models import Airport


class MobileMapLayoutTest(TestCase):
    def test_mobile_map_toggle_is_rendered(self):
        response = self.client.get('/')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'mobile-map-toggle')
        self.assertContains(response, 'mobile-map-open')


class AirportStatusPriorityTest(TestCase):
    def setUp(self):
        cache.clear()

        Airport.objects.create(
            icao='UUEE',
            name='Moscow Sheremetyevo',
            city='Moscow',
            status='CLOSED',
            latitude=55.9726,
            longitude=37.4146,
        )
        Airport.objects.create(
            icao='KJFK',
            name='John F. Kennedy',
            city='New York',
            status='OPEN',
            latitude=40.6413,
            longitude=-73.7781,
        )

    @patch('kovermap.views.KORestrictionService.get_restrictions', return_value=[])
    @patch('kovermap.views.get_ivp_airports_by_restrictions', return_value={'UUEE'})
    def test_official_status_has_priority_over_ivp(self, mock_ivp, mock_restrictions):
        response = self.client.get('/api/airports/')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        airport = next(item for item in payload['airports'] if item['icao'] == 'UUEE')

        self.assertEqual(airport['status'], 'CLOSED')
        self.assertEqual(airport['status_source'], 'official')
        self.assertEqual(airport['source_label'], 'Росавиация')
        self.assertTrue(airport['possible_ivp_restriction'])

    @patch('kovermap.views.KORestrictionService.get_restrictions', return_value=[])
    @patch('kovermap.views.get_ivp_airports_by_restrictions', return_value={'KJFK'})
    def test_ivp_sets_restricted_status_with_mode_source(self, mock_ivp, mock_restrictions):
        response = self.client.get('/api/airports/')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        airport = next(item for item in payload['airports'] if item['icao'] == 'KJFK')

        self.assertEqual(airport['status'], 'RESTRICTED')
        self.assertEqual(airport['status_source'], 'ivp')
        self.assertEqual(airport['source_label'], 'Режим КО')
        self.assertTrue(airport['possible_ivp_restriction'])
        self.assertIn('ИВП', airport['status_reason'])
