"""
Initial (production-safe) organisational configuration.

Contains only structure and reference lists — no people, members, money or
assets. Every entry is editable afterwards in Settings. Running the seed is
idempotent: existing rows are left untouched (never overwritten).
"""
from django.db import transaction

from apps.accounts.models import Permission, Role
from apps.accounts.registry import DEFAULT_ROLES, MODULES, expand
from apps.organization.models import OrgUnit, UnitType, seed_levels

from .models import (AssetCategory, Currency, DocumentCategory, FinanceCategory, MembershipCategory,
                     ProgramCategory, ServiceType, SystemSetting)

CURRENCIES = [
    ("SLE", "Sierra Leonean Leone", "Le"),
    ("USD", "United States Dollar", "$"),
    ("GBP", "Pound Sterling", "£"),
    ("EUR", "Euro", "€"),
]

MEMBERSHIP_CATEGORIES = [
    ("new-convert", "New convert"), ("new-member", "New member"), ("baptized-member", "Baptized member"),
    ("full-member", "Full member"), ("youth-member", "Youth member"), ("child", "Child"),
    ("visiting-member", "Visiting member"), ("transferred-member", "Transferred member"),
    ("inactive-member", "Inactive member"), ("deceased-member", "Deceased member"),
]

INCOME_CATEGORIES = [
    ("tithes", "Tithes", False), ("sunday-offering", "Sunday offerings", False),
    ("thanksgiving-offering", "Thanksgiving offerings", False), ("special-offering", "Special offerings", False),
    ("donations", "Donations", False), ("fundraising", "Fundraising contributions", False),
    ("conference-contributions", "Conference contributions", False),
    ("project-contributions", "Project contributions", True),
    ("missionary-support-income", "Missionary support received", True), ("other-income", "Other income", False),
]

EXPENSE_CATEGORIES = [
    ("administrative", "Administrative expenses"), ("utilities", "Utility bills"), ("transport", "Transportation"),
    ("salaries-allowances", "Salaries and allowances"), ("building-maintenance", "Building maintenance"),
    ("construction", "Construction expenses"), ("evangelism", "Evangelism expenses"),
    ("conference-expenses", "Conference expenses"), ("missionary-support", "Missionary support"),
    ("welfare-benevolence", "Welfare and benevolence"), ("equipment", "Equipment purchases"),
    ("remittance-to-hq", "Remittance to higher office"), ("other-expense", "Other approved expenditure"),
]

ASSET_CATEGORIES = [
    ("church-buildings", "Church buildings", 2, 50), ("land-property", "Land and properties", 0, None),
    ("residential-pastorage", "Residential houses and pastorages", 2, 50),
    ("vehicles", "Vehicles and motorcycles", 20, 5), ("it-equipment", "Computers and IT equipment", 25, 4),
    ("furniture", "Furniture", 10, 10), ("musical-instruments", "Musical instruments", 10, 10),
    ("sound-systems", "Sound systems", 20, 5), ("generators", "Generators", 20, 5),
    ("solar-equipment", "Solar equipment", 10, 10), ("office-equipment", "Office equipment", 20, 5),
    ("construction-equipment", "Construction equipment", 20, 5), ("other-assets", "Other church-owned assets", 10, 10),
]

PROGRAM_CATEGORIES = [
    "Sunday service", "Midweek service", "Prayer meeting", "Bible study", "Revival", "Crusade", "Evangelism",
    "Conference", "Convention", "Annual celebration", "Leadership meeting", "Ministerial training",
    "Baptism program", "Youth program", "Women's program", "Men's program", "Children's ministry program",
    "Community outreach", "Missionary activity", "Project",
]

SERVICE_TYPES = [
    "Sunday service", "Midweek service", "Special program", "Conference", "Bible study", "Departmental meeting",
    "Prayer meeting",
]

DOCUMENT_CATEGORIES = [
    "Church constitution", "Administrative policy", "Financial policy", "Meeting minutes", "Appointment letter",
    "Ordination record", "Property document", "Asset ownership document", "Conference report",
    "Official correspondence", "Branch registration document", "Other institutional record",
]

# Known locations at the time of installation. Region/district groupings and
# names are provisional and fully editable by the administrator.
ORG_STRUCTURE = {
    "code": "HQ-RLWM", "name": "National Headquarters (Koidu City)", "town": "Koidu City",
    "civil_district": "Kono", "province": "Eastern", "unit_type": UnitType.HEADQUARTERS,
    "children": [
        {"code": "RG-EAST", "name": "Eastern Region", "unit_type": UnitType.REGION, "province": "Eastern", "children": [
            {"code": "DT-KONO", "name": "Kono District", "unit_type": UnitType.DISTRICT, "civil_district": "Kono",
             "province": "Eastern", "children": [
                 {"code": "BR-KONO-001", "name": "Kono District Headquarters Church", "town": "Koidu City",
                  "civil_district": "Kono", "province": "Eastern"},
                 {"code": "BR-KONO-002", "name": "Lei Chiefdom Branch", "chiefdom": "Lei",
                  "civil_district": "Kono", "province": "Eastern"},
                 {"code": "BR-KONO-003", "name": "Mafindor Branch", "chiefdom": "Mafindor",
                  "civil_district": "Kono", "province": "Eastern"},
             ]},
            {"code": "DT-KENEMA", "name": "Kenema District", "unit_type": UnitType.DISTRICT,
             "civil_district": "Kenema", "province": "Eastern", "children": [
                 {"code": "BR-KEN-001", "name": "Kenema Branch", "town": "Kenema", "civil_district": "Kenema",
                  "province": "Eastern"},
             ]},
        ]},
        {"code": "RG-SOUTH", "name": "Southern Region", "unit_type": UnitType.REGION, "province": "Southern",
         "children": [
             {"code": "DT-BO", "name": "Bo District", "unit_type": UnitType.DISTRICT, "civil_district": "Bo",
              "province": "Southern", "children": [
                  {"code": "BR-BO-001", "name": "Bo Branch", "town": "Bo", "civil_district": "Bo",
                   "province": "Southern"},
              ]},
             {"code": "DT-MOYAMBA", "name": "Moyamba District", "unit_type": UnitType.DISTRICT,
              "civil_district": "Moyamba", "province": "Southern", "children": [
                  {"code": "BR-MOY-001", "name": "Moyamba Branch", "town": "Moyamba", "civil_district": "Moyamba",
                   "province": "Southern"},
              ]},
         ]},
        {"code": "RG-WEST", "name": "Western Area", "unit_type": UnitType.REGION, "province": "Western Area",
         "children": [
             {"code": "DT-FREETOWN", "name": "Freetown District", "unit_type": UnitType.DISTRICT,
              "civil_district": "Western Area Urban", "province": "Western Area", "children": [
                  {"code": "BR-FTN-001", "name": "Freetown Branch", "town": "Freetown",
                   "civil_district": "Western Area Urban", "province": "Western Area"},
              ]},
         ]},
        {"code": "RG-NORTH", "name": "Northern Region (expansion)", "unit_type": UnitType.REGION,
         "province": "Northern", "status": OrgUnit.Status.PLANNED, "children": [
             {"code": "DT-BOMBALI", "name": "Bombali District (Makeni)", "unit_type": UnitType.DISTRICT,
              "civil_district": "Bombali", "province": "North East", "town": "Makeni",
              "status": OrgUnit.Status.PLANNED, "children": []},
         ]},
    ],
}


def seed_permissions_and_roles(stdout=None):
    for module in MODULES:
        for action in ("view", "create", "edit", "delete", "approve", "reject", "export", "print", "submit"):
            Permission.objects.get_or_create(
                code=f"{module}.{action}",
                defaults={"module": module, "action": action, "description": f"{action.title()} — {MODULES[module]}"},
            )
    perms = {p.code: p for p in Permission.objects.all()}
    for spec in DEFAULT_ROLES:
        role, created = Role.objects.get_or_create(
            code=spec["code"],
            defaults={"name": spec["name"], "level": spec["level"], "description": spec.get("description", ""),
                      "is_system": True},
        )
        if created:
            role.permissions.set([perms[c] for c in expand(spec["permissions"])])
            if stdout:
                stdout.write(f"  role: {role.name}")


def _seed_lookup(model, rows, **extra):
    for i, row in enumerate(rows):
        if isinstance(row, str):
            code, name, fields = row.lower().replace("'", "").replace(" ", "-"), row, {}
        else:
            code, name, fields = row[0], row[1], row[2] if len(row) > 2 and isinstance(row[2], dict) else {}
        model.objects.get_or_create(code=code, defaults={"name": name, "sort_order": (i + 1) * 10, **extra, **fields})


def seed_lookups():
    for code, name, symbol in CURRENCIES:
        Currency.objects.get_or_create(code=code, defaults={"name": name, "symbol": symbol})
    SystemSetting.get()
    _seed_lookup(MembershipCategory, MEMBERSHIP_CATEGORIES)
    for i, (code, name, restricted) in enumerate(INCOME_CATEGORIES):
        FinanceCategory.objects.get_or_create(code=code, defaults={
            "name": name, "kind": "income", "is_restricted": restricted, "sort_order": (i + 1) * 10})
    for i, (code, name) in enumerate(EXPENSE_CATEGORIES):
        FinanceCategory.objects.get_or_create(code=code, defaults={
            "name": name, "kind": "expense", "sort_order": (i + 1) * 10})
    for i, (code, name, rate, life) in enumerate(ASSET_CATEGORIES):
        AssetCategory.objects.get_or_create(code=code, defaults={
            "name": name, "default_depreciation_rate": rate, "useful_life_years": life, "sort_order": (i + 1) * 10})
    _seed_lookup(ProgramCategory, PROGRAM_CATEGORIES)
    _seed_lookup(ServiceType, SERVICE_TYPES)
    _seed_lookup(DocumentCategory, DOCUMENT_CATEGORIES)


def _seed_unit(spec, parent=None):
    spec = dict(spec)
    children = spec.pop("children", [])
    spec.setdefault("unit_type", UnitType.BRANCH)
    code = spec.pop("code")
    unit = OrgUnit.all_objects.filter(code=code).first()
    if unit is None:
        unit = OrgUnit(code=code, parent=parent, **spec)
        unit.full_clean(exclude=["path"])
        unit.save()
    for child in children:
        _seed_unit(child, unit)
    return unit


def seed_structure():
    seed_levels()
    if OrgUnit.all_objects.filter(unit_type=UnitType.HEADQUARTERS).exclude(code=ORG_STRUCTURE["code"]).exists():
        return  # the administrator has already reorganised the structure; never overwrite it
    _seed_unit(ORG_STRUCTURE)


@transaction.atomic
def seed_all(stdout=None):
    seed_permissions_and_roles(stdout)
    seed_lookups()
    seed_structure()
    from apps.core.seed_hooks import run_hooks

    run_hooks()  # module seeds added by later phases (e.g. approval policies)
