"""Domain signals other modules (e.g. notifications) subscribe to."""
from django.dispatch import Signal

account_created = Signal()  # kwargs: user, created_by
