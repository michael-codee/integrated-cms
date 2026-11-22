"""Capture attendance by ministry category and by gender.

Before: men, women, boys, girls (gender x age). After: men, women, children,
youth, young_adults (ministry category) plus male, female (gender). Existing
records keep their totals: boys and girls become children, and the gender
split comes from men + boys and women + girls.

Also adds the three weekly services the church holds: Tuesday Bible Studies,
Friday Prayer and Deliverance Service and Sunday Divine Service (the existing
"Sunday service" type, renamed, so past Sunday records stay linked).
"""
from django.db import migrations, models
from django.db.models import F
from django.db.models.expressions import RawSQL

from apps.core.models import SYNC_SEQUENCE

WEEKLY_SERVICES = [
    ("sunday-service", "Sunday Divine Service", 1),
    ("tuesday-bible-study", "Tuesday Bible Studies", 2),
    ("friday-prayer-deliverance", "Friday Prayer and Deliverance Service", 3),
]


def _bump():
    return {"sync_seq": RawSQL(f"nextval('{SYNC_SEQUENCE}')", []), "version": F("version") + 1}


def split_counts(apps, schema_editor):
    Record = apps.get_model("attendance", "AttendanceRecord")
    Record.objects.update(children=F("boys") + F("girls"), male=F("men") + F("boys"),
                          female=F("women") + F("girls"), **_bump())


def merge_counts(apps, schema_editor):
    # Lossy reverse, only to allow rolling back: children are split evenly into boys and girls, and youth and
    # young adults (whose gender split is not stored per category) are added to men.
    Record = apps.get_model("attendance", "AttendanceRecord")
    Record.objects.update(boys=F("children") / 2, girls=F("children") - F("children") / 2,
                          men=F("men") + F("youth") + F("young_adults"))


def add_services(apps, schema_editor):
    ServiceType = apps.get_model("configuration", "ServiceType")
    for code, name, order in WEEKLY_SERVICES:
        st, created = ServiceType.objects.get_or_create(code=code, defaults={"name": name, "sort_order": order})
        if not created:
            ServiceType.objects.filter(pk=st.pk).update(name=name, sort_order=order, is_active=True, **_bump())


def remove_services(apps, schema_editor):
    ServiceType = apps.get_model("configuration", "ServiceType")
    ServiceType.objects.filter(code="sunday-service").update(name="Sunday service", sort_order=10)


class Migration(migrations.Migration):

    dependencies = [
        ("attendance", "0004_alter_attendancerecord_sync_seq"),
        ("configuration", "0003_alter_assetcategory_sync_seq_and_more"),
    ]

    operations = [
        migrations.AddField("attendancerecord", "children", models.PositiveIntegerField(default=0)),
        migrations.AddField("attendancerecord", "youth", models.PositiveIntegerField(default=0)),
        migrations.AddField("attendancerecord", "young_adults", models.PositiveIntegerField(default=0)),
        migrations.AddField("attendancerecord", "male", models.PositiveIntegerField(default=0)),
        migrations.AddField("attendancerecord", "female", models.PositiveIntegerField(default=0)),
        migrations.RunPython(split_counts, merge_counts),
        migrations.RemoveField("attendancerecord", "boys"),
        migrations.RemoveField("attendancerecord", "girls"),
        migrations.AlterField("attendancerecord", "men",
                              models.PositiveIntegerField(default=0, help_text="Men's ministry")),
        migrations.AlterField("attendancerecord", "women",
                              models.PositiveIntegerField(default=0, help_text="Women's ministry")),
        migrations.RunPython(add_services, remove_services),
    ]
