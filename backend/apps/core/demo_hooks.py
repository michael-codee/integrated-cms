"""Orchestrates demo data generation/purging across modules."""
from django.db import connection


def generate(rng):
    from apps.core.demo import generate_members

    summary = {}
    members = generate_members(rng)
    summary["members"] = len(members)
    for name, fn in EXTRA_GENERATORS:
        summary[name] = fn(rng, members)
    return summary


def purge():
    # Order matters (children first). Raw SQL bypasses soft-delete guards for demo rows only.
    with connection.cursor() as c:
        for sql in PURGE_SQL + [
            "DELETE FROM members_membershiphistory WHERE member_id IN (SELECT id FROM members_member WHERE is_demo)",
            "DELETE FROM members_baptismrecord WHERE member_id IN (SELECT id FROM members_member WHERE is_demo)",
            "DELETE FROM members_membertransfer WHERE member_id IN (SELECT id FROM members_member WHERE is_demo)",
            "DELETE FROM members_member WHERE is_demo",
        ]:
            c.execute(sql)


EXTRA_GENERATORS = []  # (name, fn(rng, members)) added by later phases
PURGE_SQL = []  # statements run before member deletion
