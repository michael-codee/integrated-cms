"""Membership business rules. Views and the sync layer both call these."""
from django.db import transaction
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.events import publish
from apps.core.exceptions import BusinessRuleError

from .models import BaptismRecord, DiscipleshipClass, DiscipleshipCompletion, Member, MembershipHistory, MemberTransfer

TRACKED = ["first_name", "middle_name", "last_name", "gender", "date_of_birth", "phone", "email", "address",
           "category_id", "marital_status", "occupation", "status", "baptism_status"]


def history(member, event, user, changes=None, note="", effective_date=None, org_unit=None):
    return MembershipHistory.objects.create(
        member=member, event=event, changes=changes or {}, note=note,
        effective_date=effective_date or timezone.localdate(), org_unit=org_unit or member.org_unit,
        created_by=user,
    )


def find_possible_duplicates(*, first_name, last_name, date_of_birth=None, phone="", exclude=None):
    qs = Member.objects.filter(first_name__iexact=first_name.strip(), last_name__iexact=last_name.strip())
    if date_of_birth:
        qs = qs.filter(date_of_birth=date_of_birth)
    elif phone:
        qs = qs.filter(phone=phone)
    if exclude:
        qs = qs.exclude(pk=exclude)
    return qs


def on_registered(member, user):
    history(member, MembershipHistory.Event.REGISTERED, user,
            changes={"branch": member.org_unit.name, "category": getattr(member.category, "name", None)},
            effective_date=member.joined_on)
    if member.baptism_status == Member.Baptism.BAPTIZED and member.baptism_date:
        BaptismRecord.objects.create(member=member, org_unit=member.org_unit, date=member.baptism_date,
                                     location=member.baptism_location, created_by=user,
                                     notes="Recorded at registration")


def on_updated(member, before, user):
    changes = {k: [before.get(k), getattr(member, k)] for k in TRACKED if str(before.get(k)) != str(getattr(member, k))}
    changes = {k: [None if v[0] is None else str(v[0]), None if v[1] is None else str(v[1])] for k, v in changes.items()}
    if not changes:
        return
    event = MembershipHistory.Event.UPDATED
    if set(changes) == {"category_id"}:
        event = MembershipHistory.Event.CATEGORY_CHANGED
    elif "status" in changes:
        event = MembershipHistory.Event.STATUS_CHANGED
    history(member, event, user, changes=changes)


@transaction.atomic
def change_status(member, status, user, reason="", effective_date=None):
    if status not in Member.Status.values:
        raise BusinessRuleError("Unknown membership status.")
    old = member.status
    if old == status:
        return member
    member.status = status
    if status in (Member.Status.WITHDRAWN, Member.Status.DECEASED):
        member.exit_date = effective_date or timezone.localdate()
        member.exit_reason = reason
    elif status == Member.Status.ACTIVE:
        member.exit_date = None
        member.exit_reason = ""
    member.updated_by = user
    member.save()
    event = (MembershipHistory.Event.EXITED if status in (Member.Status.WITHDRAWN, Member.Status.DECEASED)
             else MembershipHistory.Event.STATUS_CHANGED)
    history(member, event, user, changes={"status": [old, status]}, note=reason, effective_date=effective_date)
    audit.record(AuditLog.Action.STATUS_CHANGE, instance=member, changes={"status": [old, status]}, message=reason)
    return member


@transaction.atomic
def record_baptism(member, user, *, date, location="", officiated_by="", certificate_no="", notes="", record_id=None):
    if date > timezone.localdate():
        raise BusinessRuleError("Baptism date cannot be in the future.")
    kwargs = {"id": record_id} if record_id else {}
    rec = BaptismRecord.objects.create(member=member, org_unit=member.org_unit, date=date, location=location,
                                       officiated_by=officiated_by, certificate_no=certificate_no, notes=notes,
                                       created_by=user, **kwargs)
    member.baptism_status = Member.Baptism.BAPTIZED
    member.baptism_date = date
    member.baptism_location = location
    member.updated_by = user
    member.save()
    history(member, MembershipHistory.Event.BAPTIZED, user, changes={"date": str(date), "location": location},
            effective_date=date)
    audit.record(AuditLog.Action.CREATE, instance=rec, org_unit=member.org_unit)
    return rec


def _complete_transfer(transfer, user, note=""):
    member = transfer.member
    old_unit = member.org_unit
    member.org_unit = transfer.to_unit
    member.updated_by = user
    member.save()
    transfer.status = MemberTransfer.Status.COMPLETED
    transfer.decided_by = user
    transfer.decided_at = timezone.now()
    transfer.decision_note = note
    transfer.save()
    history(member, MembershipHistory.Event.TRANSFERRED, user,
            changes={"from": old_unit.name, "to": transfer.to_unit.name}, note=transfer.reason,
            effective_date=transfer.effective_date, org_unit=transfer.to_unit)
    audit.record(AuditLog.Action.TRANSFER, instance=member, org_unit=transfer.to_unit,
                 changes={"org_unit": [str(old_unit.pk), str(transfer.to_unit.pk)]})
    publish("member.transferred", org_unit=transfer.to_unit, actor=user,
            title=f"{member.full_name} transferred to {transfer.to_unit.name}",
            body=f"From {old_unit.name}.", link=f"/members/{member.pk}", notify_perm="members.view")


@transaction.atomic
def request_transfer(member, to_unit, user, reason="", effective_date=None, transfer_id=None):
    if to_unit.unit_type not in ("branch", "congregation"):
        raise BusinessRuleError("Members can only be transferred to a branch or congregation.")
    if to_unit.pk == member.org_unit_id:
        raise BusinessRuleError("The member already belongs to that branch.")
    if to_unit.status != "active":
        raise BusinessRuleError("The receiving branch is not active.")
    if member.status != Member.Status.ACTIVE:
        raise BusinessRuleError("Only active members can be transferred.")
    if MemberTransfer.objects.filter(member=member, status=MemberTransfer.Status.PENDING).exists():
        raise BusinessRuleError("This member already has a pending transfer.")
    kwargs = {"id": transfer_id} if transfer_id else {}
    transfer = MemberTransfer.objects.create(
        member=member, org_unit=member.org_unit, to_unit=to_unit, reason=reason,
        effective_date=effective_date or timezone.localdate(), created_by=user, **kwargs,
    )
    audit.record(AuditLog.Action.CREATE, instance=transfer, org_unit=member.org_unit,
                 changes={"to_unit": [None, to_unit.name]})
    history(member, MembershipHistory.Event.TRANSFER_REQUESTED, user, changes={"to": to_unit.name}, note=reason)
    if scoping.can(user, "members.approve", to_unit):
        _complete_transfer(transfer, user, "Approved by requesting officer (authorised for both branches).")
    else:
        publish("member.transfer_requested", org_unit=to_unit, actor=user,
                title=f"Transfer request: {member.full_name}",
                body=f"{member.org_unit.name} → {to_unit.name}", link="/members/transfers",
                notify_perm="members.approve")
    return transfer


@transaction.atomic
def decide_transfer(transfer, user, approve: bool, note=""):
    transfer = MemberTransfer.objects.select_for_update().get(pk=transfer.pk)
    if transfer.status != MemberTransfer.Status.PENDING:
        raise BusinessRuleError("This transfer has already been decided.")
    if not scoping.can(user, "members.approve", transfer.to_unit):
        raise BusinessRuleError("Only an officer of the receiving branch (or above) can decide this transfer.",
                                status_code=403)
    if approve:
        _complete_transfer(transfer, user, note)
    else:
        transfer.status = MemberTransfer.Status.REJECTED
        transfer.decided_by = user
        transfer.decided_at = timezone.now()
        transfer.decision_note = note
        transfer.save()
        audit.record(AuditLog.Action.REJECT, instance=transfer, org_unit=transfer.org_unit, message=note)
    return transfer


@transaction.atomic
def cancel_transfer(transfer, user):
    if transfer.status != MemberTransfer.Status.PENDING:
        raise BusinessRuleError("Only pending transfers can be cancelled.")
    transfer.status = MemberTransfer.Status.CANCELLED
    transfer.decided_by = user
    transfer.decided_at = timezone.now()
    transfer.save()
    audit.record(AuditLog.Action.CANCEL, instance=transfer, org_unit=transfer.org_unit)
    return transfer


# --- Discipleship register -------------------------------------------------------------------------------------

def badge_date(member):
    """The date the badge was earned (the last of the three classes), or None while any class is outstanding."""
    dates = dict(DiscipleshipCompletion.objects.filter(member=member).values_list("course", "completed_on"))
    if all(c in dates for c in DiscipleshipClass.values):
        return max(dates.values())
    return None


def _refresh_badge(member, user):
    old, new = member.discipleship_badge_on, badge_date(member)
    if old == new:
        return
    member.discipleship_badge_on = new
    member.updated_by = user
    member.save(update_fields=["discipleship_badge_on", "updated_by", "updated_at", "version", "sync_seq"])
    if new and not old:
        history(member, MembershipHistory.Event.BADGE_AWARDED, user, effective_date=new,
                changes={"badge": "Badge of discipleship"},
                note="Completed Foundation, Discipleship and Spiritual Growth classes.")
        publish("member.discipleship_badge", org_unit=member.org_unit, actor=user,
                title=f"Badge of discipleship: {member.full_name}",
                body="Completed all three discipleship classes.", link=f"/members/{member.pk}",
                notify_perm="members.view")
    elif old and not new:
        history(member, MembershipHistory.Event.BADGE_REVOKED, user, changes={"badge": "Badge of discipleship"},
                note="A class completion was removed, so the pathway is no longer complete.")


@transaction.atomic
def record_class_completion(member, user, *, course, completed_on, facilitator="", certificate_no="", notes="",
                            record_id=None):
    member = Member.objects.select_for_update().get(pk=member.pk)
    if course not in DiscipleshipClass.values:
        raise BusinessRuleError("Unknown discipleship class.")
    if completed_on > timezone.localdate():
        raise BusinessRuleError("Completion date cannot be in the future.")
    if member.date_of_birth and completed_on < member.date_of_birth:
        raise BusinessRuleError("Completion date is before the member's date of birth.")
    label = DiscipleshipClass(course).label
    if DiscipleshipCompletion.objects.filter(member=member, course=course).exists():
        raise BusinessRuleError(f"{member.full_name} has already completed the {label}.")
    kwargs = {"id": record_id} if record_id else {}
    rec = DiscipleshipCompletion.objects.create(
        member=member, org_unit=member.org_unit, course=course, completed_on=completed_on, facilitator=facilitator,
        certificate_no=certificate_no, notes=notes, created_by=user, updated_by=user, **kwargs)
    history(member, MembershipHistory.Event.CLASS_COMPLETED, user, changes={"class": label},
            effective_date=completed_on)
    audit.record(AuditLog.Action.CREATE, instance=rec, org_unit=member.org_unit, changes={"class": [None, label]})
    _refresh_badge(member, user)
    return rec


@transaction.atomic
def remove_class_completion(rec, user, reason=""):
    member = Member.objects.select_for_update().get(pk=rec.member_id)
    label = rec.get_course_display()
    rec.soft_delete(user)
    history(member, MembershipHistory.Event.CLASS_REMOVED, user, changes={"class": label}, note=reason)
    audit.record(AuditLog.Action.DELETE, instance=rec, org_unit=rec.org_unit, message=reason)
    _refresh_badge(member, user)
