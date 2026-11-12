import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.views import set_rollback

logger = logging.getLogger("cmis")


class BusinessRuleError(Exception):
    """Raised by service functions when a business rule forbids an operation."""

    status_code = 400

    def __init__(self, message, code="business_rule", status_code=None):
        super().__init__(message)
        self.message = message
        self.code = code
        if status_code:
            self.status_code = status_code


def exception_handler(exc, context):
    response = _handle(exc, context)
    if response is not None and response.status_code >= 400:
        set_rollback()
    return response


def _handle(exc, context):
    if isinstance(exc, DjangoValidationError):
        detail = exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages}
        return Response(detail, status=status.HTTP_400_BAD_REQUEST)
    if isinstance(exc, BusinessRuleError):
        return Response({"detail": exc.message, "code": exc.code}, status=exc.status_code)
    if isinstance(exc, ProtectedError):
        return Response(
            {"detail": "This record is referenced by other records and cannot be removed."},
            status=status.HTTP_409_CONFLICT,
        )
    if isinstance(exc, IntegrityError):
        # Last line of defence: serializers validate uniqueness first, but two devices can race.
        logger.warning("Integrity error turned into 409: %s", exc)
        return Response({"detail": "This conflicts with an existing record (it may already have been entered)."},
                        status=status.HTTP_409_CONFLICT)
    if isinstance(exc, (DjangoPermissionDenied, PermissionError)):
        return Response({"detail": str(exc) or "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
    response = drf_exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled API error", exc_info=exc)
    return response
