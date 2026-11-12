"""
Fictional demonstration data for development, training and testing.

Every generated record is marked ``is_demo`` (or tagged ``[DEMO]``) and the
command refuses to run unless ALLOW_DEMO_DATA is enabled (it is always
disabled in production settings). Names are randomly combined from common
given names and surnames; they do not describe real people.
"""
import datetime
import random

from django.utils import timezone

FIRST_MALE = ["Mohamed", "Abu", "Ibrahim", "Joseph", "Samuel", "Emmanuel", "Daniel", "Peter", "John", "Augustine",
              "Francis", "Alhaji", "Sahr", "Tamba", "Komba", "Foday", "David", "Michael", "Paul", "Thomas", "James",
              "Christian", "Gibrilla", "Musa", "Alusine"]
FIRST_FEMALE = ["Fatmata", "Mariama", "Aminata", "Isatu", "Hawa", "Kadiatu", "Mary", "Grace", "Esther", "Ruth",
                "Elizabeth", "Christiana", "Finda", "Sia", "Kumba", "Jeneba", "Musu", "Hannah", "Victoria", "Comfort",
                "Josephine", "Rebecca", "Martha", "Sarah", "Adama"]
SURNAMES = ["Kamara", "Sesay", "Koroma", "Bangura", "Conteh", "Turay", "Kargbo", "Mansaray", "Jalloh", "Fofanah",
            "Sandi", "Lebbie", "Gbondo", "Tucker", "Kpaka", "Sam", "Komba", "Ngaujah", "Bockarie", "Momoh", "Kanu",
            "Johnson", "Williams", "Cole", "Davies", "Saffa", "Fillie", "Yambasu", "Kallon", "Nyuma"]
OCCUPATIONS = ["Trader", "Farmer", "Teacher", "Student", "Nurse", "Driver", "Miner", "Tailor", "Carpenter",
               "Civil servant", "Mechanic", "Business owner", "Okada rider", "Housewife", ""]

BRANCH_COORDS = {
    "BR-KONO-001": (8.6439, -10.9711), "BR-KONO-002": (8.5500, -10.7333), "BR-KONO-003": (8.7000, -10.9500),
    "BR-KEN-001": (7.8767, -11.1875), "BR-BO-001": (7.9647, -11.7383), "BR-MOY-001": (8.1600, -12.4333),
    "BR-FTN-001": (8.4844, -13.2344),
}


def rand_date(rng, start, end):
    days = (end - start).days
    return start + datetime.timedelta(days=rng.randint(0, max(days, 0)))


def generate_members(rng: random.Random, user=None, per_branch=(40, 110)):
    from apps.configuration.models import MembershipCategory
    from apps.members import services
    from apps.members.models import Member
    from apps.organization.models import OrgUnit

    today = timezone.localdate()
    cats = {c.code: c for c in MembershipCategory.objects.all()}
    branches = list(OrgUnit.objects.filter(unit_type="branch", status="active"))
    created = []
    for b in branches:
        if b.code in BRANCH_COORDS and b.latitude is None:
            b.latitude, b.longitude = BRANCH_COORDS[b.code]
            b.established_on = b.established_on or rand_date(rng, datetime.date(2008, 1, 1), datetime.date(2020, 12, 31))
            b.save()
        for _ in range(rng.randint(*per_branch)):
            gender = rng.choice(["male", "female", "female"])
            first = rng.choice(FIRST_MALE if gender == "male" else FIRST_FEMALE)
            age = rng.choice([rng.randint(4, 12), rng.randint(13, 17), rng.randint(18, 35), rng.randint(18, 35),
                              rng.randint(36, 59), rng.randint(36, 59), rng.randint(60, 82)])
            dob = today - datetime.timedelta(days=age * 365 + rng.randint(0, 364))
            joined = rand_date(rng, today - datetime.timedelta(days=3 * 365), today)
            baptized = age >= 12 and rng.random() < 0.55
            category = ("child" if age < 13 else "youth-member" if age < 18 else
                        "baptized-member" if baptized else rng.choice(["new-member", "new-convert", "full-member"]))
            m = Member(
                first_name=first, last_name=rng.choice(SURNAMES), gender=gender, date_of_birth=dob,
                phone=f"+232 {rng.choice(['76', '77', '78', '79', '88', '30', '33'])} {rng.randint(100000, 999999)}",
                address=f"{rng.randint(1, 80)} {rng.choice(['Main', 'Hospital', 'Station', 'Church', 'Market'])} "
                        f"Road, {b.town or b.name}",
                org_unit=b, joined_on=joined, category=cats.get(category), occupation=rng.choice(OCCUPATIONS),
                marital_status=rng.choice(["single", "married", "married", "widowed"]) if age >= 18 else "single",
                baptism_status="baptized" if baptized else "not_baptized",
                baptism_date=rand_date(rng, joined, today) if baptized else None,
                baptism_location=f"{b.name} baptismal service" if baptized else "",
                is_demo=True, created_by=user,
            )
            m.save()
            services.on_registered(m, user)
            if rng.random() < 0.06:
                services.change_status(m, "inactive", user, "[DEMO] Has not attended for several months")
            created.append(m)
    return created
