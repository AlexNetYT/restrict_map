from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('kovermap', '0002_add_coordinates'),
    ]

    operations = [
        migrations.AddField(
            model_name='airport',
            name='last_updated',
            field=models.DateTimeField(default=django.utils.timezone.now),
        ),
        migrations.CreateModel(
            name='UpdateLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('timestamp', models.DateTimeField(auto_now_add=True)),
                ('success', models.BooleanField(default=True)),
                ('error_message', models.TextField(blank=True)),
                ('airports_updated', models.IntegerField(default=0)),
            ],
            options={
                'ordering': ['-timestamp'],
            },
        ),
    ]
