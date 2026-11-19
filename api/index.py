"""Vercel entry point: the Django API as one Python serverless function.

vercel.json rewrites /api/*, /django-admin/* and /static/* here, adding the matched part as
``?__prefix=<api|django-admin|static>&path=<rest>``. Vercel normally passes the original request
path to the function; if it passes the function's own path instead, the original is rebuilt from
those two parameters. Either way they are removed before Django sees the request.
"""
import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

from config.wsgi import application  # noqa: E402

ROUTING_PARAMS = {"__prefix", "path"}


def app(environ, start_response):
    query = parse_qsl(environ.get("QUERY_STRING", ""), keep_blank_values=True)
    routing = {k: v for k, v in query if k in ROUTING_PARAMS}
    if "__prefix" in routing:
        if environ.get("PATH_INFO", "").startswith("/api/index"):
            rest = routing.get("path", "")
            environ["PATH_INFO"] = f"/{routing['__prefix']}/{rest}"
        environ["QUERY_STRING"] = urlencode([(k, v) for k, v in query if k not in ROUTING_PARAMS])
    return application(environ, start_response)
