"""Vision endpoint for reading a physical Hebrew Codenames board."""

import base64
import binascii
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import Blueprint, jsonify, request


spy = Blueprint("spy", __name__)

_OPENAI_URL = "https://api.openai.com/v1/chat/completions"
_MAX_IMAGE_BYTES = 8 * 1024 * 1024
_TIMEOUT_SECONDS = 60
_COLORS = {"red", "blue", "neutral", "assassin", "unknown"}


class OpenAIError(RuntimeError):
    """An OpenAI request failed or returned an unusable response."""


def _env_key(name):
    """Read one KEY=VALUE setting from the repository's .env file."""
    path = Path(__file__).resolve().with_name(".env")
    try:
        with path.open(encoding="utf-8") as env_file:
            for line in env_file:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key.strip() != name:
                    continue
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                return value
    except OSError:
        pass
    return None


def _openai_api_key():
    return os.environ.get("OPENAI_API_KEY") or _env_key("OPENAI_API_KEY")


def _openai_error_message(body):
    """Return a short server-provided error without ever exposing request headers."""
    try:
        parsed = json.loads(body.decode("utf-8", "replace"))
        message = parsed.get("error", {}).get("message")
        if isinstance(message, str) and message:
            return message[:500]
    except (ValueError, AttributeError):
        pass
    return "OpenAI request failed"


def call_openai_chat(image_data_url, instruction):
    """Send an image and instruction to Chat Completions and decode its JSON reply."""
    api_key = _openai_api_key()
    if not api_key:
        raise OpenAIError("OPENAI_API_KEY is not configured")

    payload = {
        "model": os.environ.get("SPY_OPENAI_MODEL", "gpt-4o"),
        "response_format": {"type": "json_object"},
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": instruction},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }],
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        _OPENAI_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise OpenAIError(_openai_error_message(exc.read())) from exc
    except (URLError, OSError, ValueError) as exc:
        raise OpenAIError("OpenAI request failed") from exc

    try:
        content = result["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise OpenAIError("OpenAI returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise OpenAIError("OpenAI returned invalid JSON")
    return parsed


def _image_data_url(value):
    """Validate a JPEG/PNG base64 image and normalise it to a data URL."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("image is required")
    value = value.strip()
    mime_type = None
    encoded = value
    if value.startswith("data:"):
        header, separator, encoded = value.partition(",")
        if not separator or not header.endswith(";base64"):
            raise ValueError("image must be base64 encoded")
        mime_type = header[5:-7].lower()
        if mime_type not in {"image/jpeg", "image/png"}:
            raise ValueError("image must be a JPEG or PNG")

    # Bound encoded input before decoding so a huge malformed request cannot allocate freely.
    if len(encoded) > ((_MAX_IMAGE_BYTES * 4 + 2) // 3) + 4:
        raise ValueError("image is too large")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("image must be valid base64") from exc
    if not raw:
        raise ValueError("image is required")
    if len(raw) > _MAX_IMAGE_BYTES:
        raise ValueError("image is too large")

    detected_type = "image/jpeg" if raw.startswith(b"\xff\xd8\xff") else None
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        detected_type = "image/png"
    if not detected_type:
        raise ValueError("image must be a JPEG or PNG")
    if mime_type and mime_type != detected_type:
        raise ValueError("image data does not match its declared type")
    return f"data:{detected_type};base64,{encoded}"


def _initial_instruction():
    return (
        "Read this photo of a physical Hebrew Codenames board. Return JSON only, exactly "
        '{"words":[...]}. The words array must contain exactly 25 Hebrew word strings, in '
        "board row order from top to bottom and right-to-left within each row. Read the word "
        "cards only; do not include colours, card states, explanations, or markdown."
    )


def _update_instruction(words):
    known_words = json.dumps(words, ensure_ascii=False)
    return (
        "This is a new photo of a physical Hebrew Codenames board. The previously confirmed "
        f"25 board words are: {known_words}. Compare the photo with that known board and return "
        'JSON only, exactly {"covered":[...]}. Each covered item must be '
        '{"word": one of the known words, "color": "red"|"blue"|"neutral"|"assassin"|"unknown"}. '
        "Include only words now covered by a colored agent card; use unknown only when a covered "
        "card's color cannot be determined. Do not include uncovered words, explanations, or markdown."
    )


def _validate_words(words):
    if not isinstance(words, list):
        raise ValueError("words must be a list")
    if len(words) != 25 or any(not isinstance(word, str) or not word.strip() for word in words):
        raise ValueError("words must contain exactly 25 non-empty strings")


def _initial_words(result):
    words = result.get("words")
    if not isinstance(words, list) or len(words) != 25:
        raise OpenAIError("OpenAI did not return 25 board words")
    if any(not isinstance(word, str) or not word.strip() for word in words):
        raise OpenAIError("OpenAI returned invalid board words")
    return words


def _covered_words(result, known_words):
    covered = result.get("covered")
    if not isinstance(covered, list):
        raise OpenAIError("OpenAI returned invalid covered words")
    seen = set()
    for item in covered:
        if not isinstance(item, dict):
            raise OpenAIError("OpenAI returned invalid covered words")
        word, color = item.get("word"), item.get("color")
        if word not in known_words or color not in _COLORS or word in seen:
            raise OpenAIError("OpenAI returned invalid covered words")
        seen.add(word)
    return covered


@spy.post("/api/spy/scan")
def scan():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="request body must be a JSON object"), 400
    try:
        image = _image_data_url(payload.get("image"))
        if "words" in payload:
            words = payload["words"]
            _validate_words(words)
            result = call_openai_chat(image, _update_instruction(words))
            return jsonify(words=words, covered=_covered_words(result, words))
        result = call_openai_chat(image, _initial_instruction())
        return jsonify(words=_initial_words(result))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except OpenAIError as exc:
        return jsonify(error=str(exc)), 502
