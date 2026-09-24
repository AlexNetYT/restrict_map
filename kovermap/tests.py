from django.test import TestCase


class MobileMapLayoutTest(TestCase):
    def test_mobile_map_toggle_is_rendered(self):
        response = self.client.get('/')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'mobile-map-toggle')
        self.assertContains(response, 'mobile-map-open')
