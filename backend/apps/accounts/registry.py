"""
Catalogue of CMIS permissions and the default (editable) role definitions.

Permissions are ``<module>.<action>`` codes. Role → permission mappings are
seeded from ``DEFAULT_ROLES`` but live in the database afterwards, so
leadership can adjust them in Settings without code changes.
"""

ACTIONS = ["view", "create", "edit", "delete", "approve", "reject", "export", "print", "submit"]

MODULES = {
    "dashboard": "Executive dashboard & analytics",
    "org": "Church structure & branches",
    "leadership": "Leadership appointments",
    "users": "User accounts",
    "roles": "Roles & permissions",
    "settings": "System settings & configuration",
    "members": "Membership",
    "finance": "Finance & accounting",
    "budgets": "Budgets",
    "assets": "Assets & property",
    "programs": "Programs & events",
    "attendance": "Attendance",
    "departments": "Ministries & departments",
    "reports": "Reports & accountability",
    "documents": "Documents & records",
    "media": "Media & presentation (songs, scripture, screens)",
    "notifications": "Notifications & announcements",
    "audit": "Audit trail",
    "sync": "Offline synchronisation",
}


def all_permission_codes():
    return [f"{m}.{a}" for m in MODULES for a in ACTIONS]


def expand(patterns):
    """Expand patterns like ``members.*`` / ``*.view`` / ``*`` into permission codes."""
    codes = set()
    every = all_permission_codes()
    for pattern in patterns:
        if pattern == "*":
            codes.update(every)
            continue
        module, action = pattern.split(".")
        for code in every:
            m, a = code.split(".")
            if (module in ("*", m)) and (action in ("*", a)):
                codes.add(code)
    return sorted(codes)


READ = ["view", "export", "print"]
OPERATE = ["view", "create", "edit", "export", "print", "submit"]
OVERSIGHT = ["view", "approve", "reject", "export", "print", "submit"]


def _m(module, actions):
    return [f"{module}.{a}" for a in actions]


_LEADERSHIP_READ = (
    _m("dashboard", ["view", "export", "print"])
    + _m("org", READ)
    + _m("leadership", READ)
    + _m("members", READ)
    + _m("assets", READ)
    + _m("programs", READ)
    + _m("attendance", READ)
    + _m("departments", READ)
    + _m("documents", READ)
    + _m("notifications", ["view", "create"])
    + _m("sync", ["view", "create"])
)

DEFAULT_ROLES = [
    {
        "code": "system_admin",
        "name": "System Administrator",
        "level": 1,
        "description": "Technical configuration, user accounts, organisational structure, backups and security.",
        "permissions": ["*"],
    },
    {
        "code": "general_overseer",
        "name": "General Overseer",
        "level": 2,
        "description": "Highest spiritual and administrative authority; organisation-wide oversight and approvals.",
        "permissions": ["*"],
    },
    {
        "code": "regional_overseer",
        "name": "National / Regional Overseer",
        "level": 3,
        "description": "Oversight of an assigned region.",
        "permissions": _LEADERSHIP_READ
        + _m("finance", OVERSIGHT)
        + _m("budgets", OVERSIGHT)
        + _m("reports", OVERSIGHT + ["create", "edit"])
        + _m("programs", ["create", "edit", "approve"])
        + _m("assets", ["approve", "reject"])
        + _m("org", ["create", "edit"])
        + _m("leadership", ["create", "edit"])
        + _m("users", ["view"])
        + _m("audit", ["view"]),
    },
    {
        "code": "district_overseer",
        "name": "District Overseer",
        "level": 4,
        "description": "Manages churches and congregations within an assigned district.",
        "permissions": _LEADERSHIP_READ
        + _m("finance", OVERSIGHT)
        + _m("budgets", OVERSIGHT)
        + _m("reports", OVERSIGHT + ["create", "edit"])
        + _m("programs", ["create", "edit", "approve"])
        + _m("assets", ["approve", "reject"])
        + _m("org", ["create", "edit"])
        + _m("leadership", ["create", "edit"])
        + _m("members", ["approve"])
        + _m("users", ["view"]),
    },
    {
        "code": "branch_pastor",
        "name": "Pastor-in-Charge / Branch Pastor",
        "level": 5,
        "description": "Manages a congregation: members, attendance, programs, finances and assets.",
        "permissions": _LEADERSHIP_READ
        + _m("members", OPERATE + ["approve"])
        + _m("finance", OPERATE + ["approve", "reject"])
        + _m("budgets", OPERATE)
        + _m("assets", OPERATE + ["approve", "reject"])
        + _m("programs", OPERATE)
        + _m("attendance", OPERATE)
        + _m("departments", OPERATE)
        + _m("reports", OPERATE)
        + _m("documents", ["create", "edit"])
        + _m("media", OPERATE + ["delete"]),
    },
    {
        "code": "minister",
        "name": "Minister / Departmental Leader",
        "level": 6,
        "description": "Manages an assigned ministry or department.",
        "permissions": _m("dashboard", ["view"])
        + _m("org", ["view"])
        + _m("members", ["view"])
        + _m("programs", OPERATE)
        + _m("attendance", ["view", "create", "edit"])
        + _m("departments", ["view", "edit", "submit"])
        + _m("reports", ["view", "create", "edit", "submit"])
        + _m("notifications", ["view"])
        + _m("sync", ["view", "create"]),
    },
    # ---------------------------------------------------- configurable functional roles
    {
        "code": "church_secretary",
        "name": "Church Secretary",
        "level": 6,
        "permissions": _m("dashboard", ["view"]) + _m("org", ["view"]) + _m("members", OPERATE)
        + _m("attendance", OPERATE) + _m("programs", OPERATE) + _m("documents", OPERATE)
        + _m("reports", OPERATE) + _m("notifications", ["view", "create"]) + _m("sync", ["view", "create"]),
    },
    {
        "code": "treasurer",
        "name": "Treasurer",
        "level": 6,
        "permissions": _m("dashboard", ["view"]) + _m("org", ["view"]) + _m("finance", OPERATE)
        + _m("budgets", OPERATE) + _m("reports", ["view", "create", "edit", "submit"])
        + _m("members", ["view"]) + _m("notifications", ["view"]) + _m("sync", ["view", "create"]),
    },
    {
        "code": "financial_secretary",
        "name": "Financial Secretary",
        "level": 6,
        "permissions": _m("dashboard", ["view"]) + _m("org", ["view"]) + _m("finance", OPERATE)
        + _m("budgets", READ) + _m("members", ["view"]) + _m("reports", ["view", "create", "edit"])
        + _m("notifications", ["view"]) + _m("sync", ["view", "create"]),
    },
    {
        "code": "accountant",
        "name": "Accountant",
        "level": 6,
        "permissions": _m("dashboard", ["view"]) + _m("org", ["view"]) + _m("finance", OPERATE)
        + _m("budgets", OPERATE) + _m("reports", OPERATE) + _m("audit", ["view"])
        + _m("notifications", ["view"]) + _m("sync", ["view", "create"]),
    },
    {
        "code": "asset_manager",
        "name": "Asset / Property Manager",
        "level": 6,
        "permissions": _m("dashboard", ["view"]) + _m("org", ["view"]) + _m("assets", OPERATE)
        + _m("documents", ["view", "create"]) + _m("reports", ["view", "create", "edit"])
        + _m("notifications", ["view"]) + _m("sync", ["view", "create"]),
    },
    {
        "code": "media_team",
        "name": "Media Team",
        "level": 6,
        "description": "Runs the screens during service: songs, scripture, slides and the order of service.",
        "permissions": _m("dashboard", ["view"]) + _m("org", ["view"]) + _m("media", OPERATE + ["delete"])
        + _m("programs", ["view"]) + _m("notifications", ["view"]) + _m("sync", ["view", "create"]),
    },
    {
        "code": "membership_officer",
        "name": "Membership Officer",
        "level": 6,
        "permissions": _m("dashboard", ["view"]) + _m("org", ["view"]) + _m("members", OPERATE)
        + _m("attendance", OPERATE) + _m("departments", ["view"]) + _m("notifications", ["view"])
        + _m("sync", ["view", "create"]),
    },
]

for _code, _name in [
    ("youth_coordinator", "Youth Coordinator"),
    ("womens_coordinator", "Women's Ministry Coordinator"),
    ("mens_coordinator", "Men's Ministry Coordinator"),
    ("sunday_school_coordinator", "Sunday School Coordinator"),
    ("worship_leader", "Choir / Worship Leader"),
    ("evangelism_coordinator", "Evangelism Coordinator"),
    ("project_coordinator", "Project Coordinator"),
]:
    DEFAULT_ROLES.append(
        {
            "code": _code,
            "name": _name,
            "level": 6,
            "permissions": _m("dashboard", ["view"]) + _m("org", ["view"]) + _m("members", ["view"])
            + _m("programs", OPERATE) + _m("attendance", ["view", "create", "edit"])
            + _m("departments", ["view", "edit", "submit"]) + _m("reports", ["view", "create", "edit", "submit"])
            + _m("notifications", ["view"]) + _m("sync", ["view", "create"])
            + (_m("media", OPERATE) if _code == "worship_leader" else []),
        }
    )

# Roles whose holders are considered organisation-wide when assigned at HQ.
GLOBAL_ROLE_CODES = {"system_admin", "general_overseer"}
