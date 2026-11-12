"""
Jurisdiction (organisational data isolation) engine.

A user's *scopes* for a permission are the org-unit paths of their current
role assignments whose role grants that permission. A record is inside a
scope when its org-unit path starts with the scope path. All list/detail
querysets and all write checks go through these helpers, so isolation is
enforced on the server, at query level.
"""
from dataclasses import dataclass

from django.db.models import Q


@dataclass(frozen=True)
class Scope:
    path: str
    department_id: object = None  # UUID or None
    role_level: int = 9


CACHE_ATTR = "_cmis_scope_cache"


def _load(user):
    from apps.accounts.models import RoleAssignment

    cache = {}
    assignments = (
        RoleAssignment.objects.current()
        .filter(user=user, org_unit__is_deleted=False)
        .select_related("org_unit", "role")
        .prefetch_related("role__permissions")
    )
    for a in assignments:
        scope = Scope(a.org_unit.path, a.department_id, a.role.level)
        for perm in a.role.permissions.all():
            cache.setdefault(perm.code, set()).add(scope)
    return cache


def scopes_for(user, perm):
    """Return the set of ``Scope`` objects in which ``user`` holds ``perm``."""
    if user is None or not user.is_authenticated or not user.is_active:
        return set()
    cache = getattr(user, CACHE_ATTR, None)
    if cache is None:
        cache = _load(user)
        setattr(user, CACHE_ATTR, cache)
    return cache.get(perm, set())


def clear_cache(user):
    if hasattr(user, CACHE_ATTR):
        delattr(user, CACHE_ATTR)


def all_permissions(user):
    scopes_for(user, "_warm_")
    return set(getattr(user, CACHE_ATTR, {}).keys())


def has_perm_anywhere(user, perm) -> bool:
    return bool(scopes_for(user, perm))


def _minimal_paths(scopes):
    """Drop paths nested inside other paths (keeps queries small)."""
    paths = sorted({s.path for s in scopes}, key=len)
    result = []
    for p in paths:
        if not any(p.startswith(r) for r in result):
            result.append(p)
    return result


def scope_q(user, perm, path_field="org_unit__path", department_field=None):
    """A ``Q`` filter matching records inside the user's scopes for ``perm``.

    Returns ``None`` when the user has no scope at all (caller should return
    an empty queryset).
    """
    scopes = scopes_for(user, perm)
    if not scopes:
        return None
    unrestricted = [s for s in scopes if s.department_id is None]
    restricted = [s for s in scopes if s.department_id is not None]
    q = Q()
    for path in _minimal_paths(unrestricted):
        q |= Q(**{f"{path_field}__startswith": path})
    if restricted and department_field:
        for s in restricted:
            q |= Q(**{f"{path_field}__startswith": s.path, department_field: s.department_id})
    elif restricted and not unrestricted:
        # Department-restricted users may still see unit-level reference data.
        for path in _minimal_paths(restricted):
            q |= Q(**{f"{path_field}__startswith": path})
    return q


def filter_queryset(qs, user, perm, path_field="org_unit__path", department_field=None):
    q = scope_q(user, perm, path_field, department_field)
    if q is None:
        return qs.none()
    return qs.filter(q)


def can(user, perm, org_unit, department_id=None) -> bool:
    """Does ``user`` hold ``perm`` for ``org_unit`` (via it or an ancestor)?"""
    if org_unit is None:
        return False
    path = org_unit.path if hasattr(org_unit, "path") else str(org_unit)
    for s in scopes_for(user, perm):
        if path.startswith(s.path):
            if s.department_id is None or (department_id is not None and s.department_id == department_id):
                return True
    return False


def senior_level_at(user, org_unit) -> int:
    """Most senior (lowest) role level the user holds over ``org_unit``; 99 if none."""
    from apps.accounts.models import RoleAssignment

    levels = [
        a.role.level
        for a in RoleAssignment.objects.current().filter(user=user).select_related("org_unit", "role")
        if org_unit.path.startswith(a.org_unit.path)
    ]
    return min(levels) if levels else 99


def root_scope_units(user, perm):
    """Org units at the top of the user's scopes for ``perm``."""
    from apps.organization.models import OrgUnit

    paths = _minimal_paths(scopes_for(user, perm))
    return OrgUnit.objects.filter(path__in=paths).order_by("depth", "name")
