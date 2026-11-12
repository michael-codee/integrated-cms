"""Turns domain events into in-app notifications for the right people."""
import logging

from django.dispatch import receiver

from apps.core.events import domain_event

from .models import Notification

logger = logging.getLogger("cmis")
MAX_RECIPIENTS = 200


def holders_of(perm, org_unit, include_descendants=False):
    """Active users holding ``perm`` over ``org_unit`` (at it or an ancestor).

    With ``include_descendants`` users assigned anywhere below the unit count too
    (used for announcements, whose audience is the whole subtree)."""
    from apps.accounts.models import RoleAssignment

    if org_unit is None:
        return set()
    ids = set()
    qs = (RoleAssignment.objects.current().filter(role__permissions__code=perm, role__is_active=True,
                                                  user__status="active")
          .select_related("org_unit").only("user_id", "org_unit__path", "department_id"))
    for a in qs:
        if a.department_id is None and org_unit.path.startswith(a.org_unit.path):
            ids.add(a.user_id)
        elif include_descendants and a.org_unit.path.startswith(org_unit.path):
            ids.add(a.user_id)
    return ids


@receiver(domain_event)
def notify(sender, event_type, org_unit, actor, title, body, link, notify_perm, recipients, data, **kwargs):
    try:
        ids = {r for r in recipients if r}
        if notify_perm:
            ids |= holders_of(notify_perm, org_unit, include_descendants=bool((data or {}).get("audience_subtree")))
        if actor is not None:
            ids.discard(actor.pk)
        if not ids:
            return
        actor_name = getattr(actor, "full_name", "") or ""
        Notification.objects.bulk_create([
            Notification(recipient_id=uid, event_type=event_type, title=title[:240], body=body or "", link=link or "",
                         org_unit=org_unit, actor_name=actor_name)
            for uid in list(ids)[:MAX_RECIPIENTS]
        ])
    except Exception:  # notifications must never break the business transaction that raised them
        logger.exception("Could not create notifications for %s", event_type)


def _register_dashboard_section():
    from apps.dashboard import sections

    @sections.section("announcements", "dashboard.view")
    def announcements_section(user, ctx):
        from .views import visible_announcements

        qs = visible_announcements(user).select_related("org_unit").order_by("-is_pinned", "-publish_at")[:5]
        return {"items": [{"id": str(a.id), "title": a.title, "body": a.body[:400], "priority": a.priority,
                           "org_unit_name": a.org_unit.name, "publish_at": a.publish_at, "is_pinned": a.is_pinned}
                          for a in qs]}


_register_dashboard_section()
