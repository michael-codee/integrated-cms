"""Registers assets with the dashboard, attention list and demo data."""
import datetime
from decimal import Decimal

from django.utils import timezone

from apps.core import demo_hooks, scoping
from apps.dashboard import sections


@sections.section("assets", "assets.view")
def assets_section(user, ctx):
    from .services import asset_summary

    data = asset_summary(user, ctx.unit)
    data["by_unit"] = data["by_unit"][:10]
    data["maintenance_due"] = data["maintenance_due"][:10]
    return data


def assets_attention(user, ctx):
    from .models import AssetDisposal, AssetMovement
    from .services import can_decide_disposal, can_decide_movement

    items = []
    q = scoping.scope_q(user, "assets.approve", "to_unit__path")
    if q is not None:
        mvs = [m for m in AssetMovement.objects.filter(q, status="pending").select_related("to_unit")[:300]
               if can_decide_movement(user, m)]
        if mvs:
            items.append({"key": "asset_transfers", "label": "Asset transfers awaiting your approval",
                          "count": len(mvs), "link": "/assets/approvals", "severity": "info"})
    q = scoping.scope_q(user, "assets.approve", "asset__org_unit__path")
    if q is not None:
        ds = [d for d in AssetDisposal.objects.filter(q, status="pending")
              .select_related("asset__org_unit__parent")[:300] if can_decide_disposal(user, d)]
        if ds:
            items.append({"key": "asset_disposals", "label": "Asset disposals awaiting your approval",
                          "count": len(ds), "link": "/assets/approvals", "severity": "warning"})
    if scoping.has_perm_anywhere(user, "assets.edit"):
        from .services import asset_summary

        overdue = [m for m in asset_summary(user, ctx.unit)["maintenance_due"] if m["overdue"]]
        if overdue:
            items.append({"key": "maintenance_overdue", "label": "Assets with overdue maintenance",
                          "count": len(overdue), "link": "/assets?tab=analytics", "severity": "warning"})
    return items


sections.ATTENTION_PROVIDERS.append(assets_attention)

DEMO_ITEMS = [
    # category code, name, cost range, condition choices
    ("church-buildings", "Main church auditorium", (250000, 900000), ["good", "fair"]),
    ("generators", "Diesel generator 15kVA", (18000, 45000), ["good", "fair", "poor"]),
    ("sound-systems", "Public address system", (8000, 30000), ["good", "fair"]),
    ("musical-instruments", "Electronic keyboard", (3000, 9000), ["good", "new", "fair"]),
    ("musical-instruments", "Drum set", (4000, 12000), ["good", "fair"]),
    ("furniture", "Plastic chairs (set of 100)", (5000, 12000), ["good", "fair"]),
    ("vehicles", "Motorcycle", (15000, 30000), ["good", "fair", "poor"]),
    ("solar-equipment", "Solar panel kit", (6000, 20000), ["new", "good"]),
    ("it-equipment", "Laptop computer", (6000, 15000), ["good", "fair"]),
]


def generate_demo(rng, members):
    from apps.configuration.models import AssetCategory
    from apps.organization.models import OrgUnit

    from .models import Asset, MaintenanceRecord, next_asset_no

    cats = {c.code: c for c in AssetCategory.objects.all()}
    today = timezone.localdate()
    n = 0
    for branch in OrgUnit.objects.filter(unit_type="branch", status="active"):
        for code, name, (lo, hi), conditions in DEMO_ITEMS:
            if rng.random() < 0.25 and code != "church-buildings":
                continue
            acquired = today - datetime.timedelta(days=rng.randint(60, 3650))
            a = Asset.objects.create(
                asset_no=next_asset_no(), name=name, category=cats[code], org_unit=branch,
                acquisition_date=acquired, cost=Decimal(rng.randint(lo, hi)),
                acquisition_method=rng.choice(["purchase", "purchase", "donation"]),
                location="Church premises", custodian="[DEMO] Church caretaker", condition=rng.choice(conditions),
                funding_source=rng.choice(["Church funds", "Special offering", "Donation"]),
                insurance_expiry=today + datetime.timedelta(days=rng.randint(-20, 300)) if code == "vehicles" else None,
                registration_no=f"[DEMO] AKX {rng.randint(100, 999)}" if code == "vehicles" else "",
                notes="[DEMO] fictional asset", is_demo=True,
            )
            if code in ("generators", "vehicles", "sound-systems"):
                last = today - datetime.timedelta(days=rng.randint(20, 200))
                MaintenanceRecord.objects.create(asset=a, kind="routine", date=last,
                                                 description="[DEMO] Routine service", cost=Decimal(rng.randint(200, 1500)),
                                                 next_due_date=last + datetime.timedelta(days=90))
            n += 1
    return n


demo_hooks.EXTRA_GENERATORS.append(("assets", generate_demo))
demo_hooks.PURGE_SQL[:0] = [
    "DELETE FROM assets_maintenancerecord WHERE asset_id IN (SELECT id FROM assets_asset WHERE is_demo)",
    "DELETE FROM assets_assetmovement WHERE asset_id IN (SELECT id FROM assets_asset WHERE is_demo)",
    "DELETE FROM assets_assetdisposal WHERE asset_id IN (SELECT id FROM assets_asset WHERE is_demo)",
    "DELETE FROM assets_asset WHERE is_demo",
]
