from django.db import models
from django.utils import timezone

# Create your models here.

class Airport(models.Model):
    STATUS_CHOICES = [
        ('OPEN', 'Открыт'),
        ('CLOSED', 'Закрыт'),
        ('RESTRICTED', 'Ограничения'),
    ]
    
    icao = models.CharField(max_length=4, unique=True)
    city = models.CharField(max_length=100)
    name = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='OPEN')
    latitude = models.FloatField(default=0.0)
    longitude = models.FloatField(default=0.0)
    last_updated = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.name} ({self.icao})"
    
    class Meta:
        ordering = ['name']


class UpdateLog(models.Model):
    """Log of status updates"""
    timestamp = models.DateTimeField(auto_now_add=True)
    success = models.BooleanField(default=True)
    error_message = models.TextField(blank=True)
    airports_updated = models.IntegerField(default=0)
    
    def __str__(self):
        status = "✓ Success" if self.success else "✗ Failed"
        return f"{status} - {self.timestamp}"
    
    class Meta:
        ordering = ['-timestamp']
