"""
Domain events. Modules publish events here; the notifications module (and
future email/SMS integrations) subscribe without the publisher knowing.

    publish("member.transfer_requested", org_unit=unit, actor=user,
            title="…", body="…", link="/members/…", notify_perm="members.approve")
"""
from django.db import transaction
from django.dispatch import Signal

domain_event = Signal()  # kwargs: event_type, org_unit, actor, title, body, link, notify_perm, recipients, data


def publish(event_type, *, org_unit=None, actor=None, title="", body="", link="", notify_perm=None,
            recipients=None, data=None):
    def _send():
        domain_event.send(
            sender=None, event_type=event_type, org_unit=org_unit, actor=actor, title=title, body=body, link=link,
            notify_perm=notify_perm, recipients=recipients or [], data=data or {},
        )

    transaction.on_commit(_send)
