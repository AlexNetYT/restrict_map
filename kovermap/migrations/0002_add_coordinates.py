# Generated migration

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('kovermap', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='airport',
            name='latitude',
            field=models.FloatField(default=0.0),
        ),
        migrations.AddField(
            model_name='airport',
            name='longitude',
            field=models.FloatField(default=0.0),
        ),
        migrations.AlterField(
            model_name='airport',
            name='status',
            field=models.CharField(
                choices=[
                    ('OPEN', 'Открыт'),
                    ('CLOSED', 'Закрыт'),
                    ('RESTRICTED', 'Ограничения'),
                ],
                default='OPEN',
                max_length=20,
            ),
        ),
    ]
