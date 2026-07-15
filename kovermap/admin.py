from django.contrib import admin
from django.utils.html import format_html
from kovermap.models import Airport, UpdateLog
from kovermap.services import AirportUpdateService


@admin.register(Airport)
class AirportAdmin(admin.ModelAdmin):
    list_display = ('icao', 'name', 'city', 'status_display', 'last_updated')
    list_filter = ('status', 'last_updated')
    search_fields = ('icao', 'name', 'city')
    readonly_fields = ('last_updated',)
    actions = ['update_airports_action']
    
    def status_display(self, obj):
        """Display status with color"""
        colors = {
            'OPEN': '#22c55e',
            'CLOSED': '#ef4444',
            'RESTRICTED': '#eab308',
        }
        color = colors.get(obj.status, '#6b7280')
        return format_html(
            '<span style="color: white; background-color: {}; padding: 5px 10px; border-radius: 4px; font-weight: bold;">{}</span>',
            color,
            obj.get_status_display(),
        )
    status_display.short_description = 'Status'
    
    def update_airports_action(self, request, queryset):
        """Action to manually update all airports"""
        log = AirportUpdateService.update_from_telegram()
        if log.success:
            self.message_user(
                request,
                f'✓ Airport update completed! {log.airports_updated} airports were updated.',
                level='success'
            )
        else:
            self.message_user(
                request,
                f'✗ Update failed: {log.error_message}',
                level='error'
            )
    update_airports_action.short_description = '🔄 Update airport statuses from Telegram'


@admin.register(UpdateLog)
class UpdateLogAdmin(admin.ModelAdmin):
    list_display = ('timestamp', 'status_display', 'airports_updated', 'error_message_short')
    list_filter = ('success', 'timestamp')
    readonly_fields = ('timestamp', 'success', 'error_message', 'airports_updated')
    
    def has_add_permission(self, request):
        return False
    
    def has_delete_permission(self, request, obj=None):
        return False
    
    def status_display(self, obj):
        """Display status with icon"""
        if obj.success:
            return format_html(
                '<span style="color: white; background-color: #22c55e; padding: 5px 10px; border-radius: 4px; font-weight: bold;">✓ Success</span>'
            )
        else:
            return format_html(
                '<span style="color: white; background-color: #ef4444; padding: 5px 10px; border-radius: 4px; font-weight: bold;">✗ Failed</span>'
            )
    status_display.short_description = 'Status'
    
    def error_message_short(self, obj):
        """Show shortened error message"""
        if obj.error_message:
            msg = obj.error_message[:100]
            if len(obj.error_message) > 100:
                msg += '...'
            return msg
        return '—'
    error_message_short.short_description = 'Error'
