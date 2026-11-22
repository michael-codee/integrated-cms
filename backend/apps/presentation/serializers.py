import re
import uuid

from rest_framework import serializers

from apps.core.files import SignedFilesMixin

from .models import MediaImage, ServicePlan, Song

ITEM_KINDS = {"song", "scripture", "text", "image", "blank", "video", "camera"}
MAX_ITEMS = 200
REF_RE = re.compile(r"^\s*([1-3]?\s*[A-Za-z][A-Za-z .]*?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?\s*$")
THEME_KEYS = {"preset", "background_image", "background_video", "background_video_name", "font_scale", "align",
              "show_reference", "uppercase", "bible"}
# A Bible translation: one shipped with the app (kjv, asv, web, bsb) or one imported on a media
# computer under a licence the ministry holds (local-<code>).
VERSION_RE = re.compile(r"^(?:local-)?[a-z0-9]{2,12}$")
# Videos stay on the media computer (they are too large to upload over the church's connections), so a
# plan only names them: a short id given by that computer plus the file name to find it on another one.
LOCAL_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
MAX_NOTES = 2000


def _uuid(value, i, what):
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError):
        raise serializers.ValidationError(f"Item {i}: choose a {what} from the library.") from None


class SongSerializer(serializers.ModelSerializer):
    class Meta:
        model = Song
        fields = ["id", "title", "alternate_title", "author", "copyright", "language", "song_key", "tags", "lyrics",
                  "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give the song a title.")
        return value

    def validate_lyrics(self, value):
        value = value.replace("\r\n", "\n").strip()
        if not value:
            raise serializers.ValidationError("Type or paste the words of the song.")
        if len(value) > 20000:
            raise serializers.ValidationError("The lyrics are too long (20,000 characters at most).")
        return value


class SongListSerializer(serializers.ModelSerializer):
    first_line = serializers.SerializerMethodField()

    class Meta:
        model = Song
        fields = ["id", "title", "alternate_title", "author", "language", "song_key", "tags", "first_line"]

    def get_first_line(self, obj):
        for line in obj.lyrics.splitlines():
            line = line.strip()
            if line and not (line.startswith("[") and line.endswith("]")):
                return line[:120]
        return ""


class MediaImageSerializer(SignedFilesMixin, serializers.ModelSerializer):
    class Meta:
        model = MediaImage
        fields = ["id", "title", "kind", "image", "created_at"]
        read_only_fields = ["created_at"]

    def validate(self, attrs):
        if self.instance and "image" in attrs:
            raise serializers.ValidationError({"image": "Upload a new picture instead of replacing this one."})
        return attrs


class ServicePlanSerializer(serializers.ModelSerializer):
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    service_type_name = serializers.CharField(source="service_type.name", read_only=True, default="")
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = ServicePlan
        fields = ["id", "org_unit", "org_unit_name", "title", "service_date", "service_type", "service_type_name",
                  "items", "item_count", "theme", "notes", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def get_item_count(self, obj):
        return len(obj.items or [])

    def validate_items(self, items):
        if not isinstance(items, list):
            raise serializers.ValidationError("Items must be a list.")
        if len(items) > MAX_ITEMS:
            raise serializers.ValidationError(f"A service plan can hold at most {MAX_ITEMS} items.")
        song_ids, image_ids, clean = set(), set(), []
        for i, item in enumerate(items, start=1):
            if not isinstance(item, dict) or item.get("kind") not in ITEM_KINDS:
                raise serializers.ValidationError(
                    f"Item {i} is not a song, scripture, text, picture, video, live camera or blank screen.")
            kind = item["kind"]
            out = {"kind": kind, "key": str(item.get("key") or i)[:40]}
            if kind == "song":
                out["song"] = _uuid(item.get("song"), i, "song")
                song_ids.add(out["song"])
            elif kind == "scripture":
                ref = str(item.get("ref") or "").strip()
                if not REF_RE.match(ref):
                    raise serializers.ValidationError(f"Item {i}: '{ref}' is not a Bible reference like John 3:16-18.")
                out["ref"] = ref[:60]
                version = item.get("version")
                if version:
                    if not (isinstance(version, str) and VERSION_RE.match(version)):
                        raise serializers.ValidationError(f"Item {i}: unknown Bible translation.")
                    out["version"] = version
            elif kind == "text":
                out["title"] = str(item.get("title") or "")[:160]
                out["body"] = str(item.get("body") or "")[:4000]
                if not (out["title"].strip() or out["body"].strip()):
                    raise serializers.ValidationError(f"Item {i}: a text slide needs a title or some words.")
            elif kind == "image":
                out["image"] = _uuid(item.get("image"), i, "picture")
                image_ids.add(out["image"])
            elif kind == "video":
                video = str(item.get("video") or "")
                if not LOCAL_ID_RE.match(video):
                    raise serializers.ValidationError(f"Item {i}: choose a video from this computer.")
                out["video"] = video
                out["name"] = str(item.get("name") or "")[:200]
                if item.get("loop"):
                    out["loop"] = True
            if item.get("label"):
                out["label"] = str(item["label"])[:160]
            notes = str(item.get("notes") or "").strip()
            if len(notes) > MAX_NOTES:
                raise serializers.ValidationError(f"Item {i}: the notes are too long ({MAX_NOTES:,} characters at most).")
            if notes:
                out["notes"] = notes
            clean.append(out)
        if song_ids and Song.objects.filter(pk__in=song_ids).count() != len(song_ids):
            raise serializers.ValidationError("One of the songs is no longer in the library.")
        if image_ids and MediaImage.objects.filter(pk__in=image_ids).count() != len(image_ids):
            raise serializers.ValidationError("One of the pictures is no longer in the library.")
        return clean

    def validate_theme(self, theme):
        if not isinstance(theme, dict):
            raise serializers.ValidationError("Theme must be an object.")
        unknown = set(theme) - THEME_KEYS
        if unknown:
            raise serializers.ValidationError(f"Unknown theme settings: {', '.join(sorted(unknown))}.")
        video = theme.get("background_video")
        if video and not (isinstance(video, str) and LOCAL_ID_RE.match(video)):
            raise serializers.ValidationError("The background video is not a video from this computer.")
        bible = theme.get("bible")
        if bible and not (isinstance(bible, str) and VERSION_RE.match(bible)):
            raise serializers.ValidationError("Unknown Bible translation.")
        if "background_video_name" in theme:
            theme = {**theme, "background_video_name": str(theme["background_video_name"] or "")[:200]}
        return theme

    def validate(self, attrs):
        if self.instance and "org_unit" in attrs and attrs["org_unit"] != self.instance.org_unit:
            raise serializers.ValidationError({"org_unit": "A service plan cannot move to another unit."})
        return attrs
