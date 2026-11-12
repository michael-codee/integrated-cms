# RLWM CMIS API (Django + gunicorn)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_SETTINGS_MODULE=config.settings.prod

RUN groupadd --system --gid 10001 cmis && useradd --system --uid 10001 --gid cmis --home /app cmis

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
# collectstatic needs a key at build time only; the real key comes from the environment at runtime.
RUN DJANGO_SECRET_KEY=build-only-$(python -c "import secrets;print(secrets.token_hex(32))") \
    python manage.py collectstatic --noinput \
 && mkdir -p /data/media /data/private-media /backups \
 && chown -R cmis:cmis /data /backups

ENV MEDIA_ROOT=/data/media PRIVATE_MEDIA_ROOT=/data/private-media
USER cmis
EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120", "--access-logfile", "-", "--no-control-socket"]
