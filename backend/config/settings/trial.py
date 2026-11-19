"""Trial and demonstration deployments only (for example GitHub Codespaces, see .devcontainer/).

Production settings, plus demo data allowed and no HTTP->HTTPS redirect, because the
trial host terminates HTTPS in front of the app. Never use this for real church records.
"""
from .prod import *  # noqa: F401,F403

ALLOW_DEMO_DATA = True
SECURE_SSL_REDIRECT = False
