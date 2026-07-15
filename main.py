from airport_parser import AirportStatusManager

def sync_airport_data():
    manager = AirportStatusManager()
    updated_data = manager.update_statuses_from_url("https://t.me/s/favt_info")
    
    # Здесь можно обновлять базу данных:
    # for icao, data in updated_data.items():
    #     Airport.objects.update_or_create(icao=icao, defaults={'status': data['status']})
    
    return updated_data
print(sync_airport_data())