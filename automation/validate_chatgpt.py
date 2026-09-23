#!/usr/bin/env python3
"""Validate the ChatGPT channel without reading Facebook or changing files."""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit
from zoneinfo import ZoneInfo

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
TAIPEI = ZoneInfo("Asia/Taipei")
INDEX = "data/chatgpt/index.json"
SECRET_KEY = re.compile(r"^(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|cookie)$", re.I)
SECRET_VALUE = re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)")


class Invalid(ValueError):
    """A contract failure. Messages must not include private input values."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Invalid(message)


def loads(text: str):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "JSON contains a duplicate object key")
            result[key] = value
        return result

    def constant(_):
        raise Invalid("JSON contains a non-finite number")

    try:
        return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    except json.JSONDecodeError as error:
        raise Invalid(f"Invalid JSON at line {error.lineno}, column {error.colno}") from None


def read_json(path: Path):
    return loads(path.read_text(encoding="utf-8"))


def encode(value) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def edition_path(day: str) -> str:
    require(bool(re.fullmatch(r"[1-9]\d{3}-\d{2}-\d{2}", day)), "Invalid edition date/path")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise Invalid("Invalid calendar date") from None
    return f"data/chatgpt/editions/{day}.json"


def scan_secrets(value, location="$") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            require(not (SECRET_KEY.fullmatch(key) and item), f"Possible credential field at {location}")
            scan_secrets(item, location + ".field")
    elif isinstance(value, list):
        for i, item in enumerate(value):
            scan_secrets(item, f"{location}[{i}]")
    elif isinstance(value, str):
        require(not SECRET_VALUE.search(value), f"Possible credential at {location}")
        for match in re.finditer(r"https?://[^\s\"<>]+", value):
            try:
                url = urlsplit(match.group())
                require(not url.username and not url.password, f"URL credentials at {location}")
                require(not any(SECRET_KEY.fullmatch(k) or k.lower() in {"token", "key", "signature", "x-amz-signature"} for k, _ in parse_qsl(url.query)), f"Possible private URL at {location}")
            except ValueError:
                raise Invalid(f"Invalid URL at {location}") from None


def preserve_stories(previous: dict | None, edition: dict) -> None:
    if previous is None:
        return
    require(previous["date"] == edition["date"], "Cannot merge different edition dates")
    old, new = previous["stories"], edition["stories"]
    require(len(new) >= len(old), "Existing stories cannot be deleted")
    for before, after in zip(old, new):
        require({k: v for k, v in before.items() if k != "sources"} ==
                {k: v for k, v in after.items() if k != "sources"},
                "Existing story content, id, order and image must be preserved")
        require(after["sources"][:len(before["sources"])] == before["sources"],
                "Existing sources must remain an unchanged prefix")


class Validator:
    def __init__(self, edition_schema: dict, manifest_schema: dict):
        self.validators = []
        for schema in (edition_schema, manifest_schema):
            Draft202012Validator.check_schema(schema)
            self.validators.append(Draft202012Validator(schema, format_checker=FormatChecker()))

    @classmethod
    def from_root(cls, root: Path):
        return cls(read_json(root / "schema/edition.schema.json"), read_json(root / "schema/manifest.schema.json"))

    def schema(self, value, which: int) -> None:
        # Validator messages can contain the invalid value (and hence secrets).
        error = next(self.validators[which].iter_errors(value), None)
        require(error is None, f"{'Edition' if which == 0 else 'Manifest'} schema/format validation failed")

    def pair(self, edition: dict, manifest: dict, day: str,
             previous: dict | None = None, previous_index: dict | None = None,
             enforce_new_images: bool = False) -> None:
        scan_secrets(edition)
        scan_secrets(manifest)
        self.schema(edition, 0)
        self.schema(manifest, 1)
        path = edition_path(day)
        require(edition["date"] == day, "Edition date does not match target")
        require(edition["is_demo"] is False, "Formal edition must have is_demo:false")
        require(datetime.fromisoformat(edition["generated_at"].replace("Z", "+00:00")).astimezone(TAIPEI).date().isoformat() == day,
                "generated_at must fall on the edition date in Asia/Taipei")
        ids = [s["id"] for s in edition["stories"]]
        require(len(ids) == len(set(ids)), "Story ids must be unique")
        reports = edition.get("source_reports", {})
        require(set(reports) == {"configured_sources"}, "Require only the configured_sources channel report")
        report = reports["configured_sources"]
        require(report["status"] != "limited" or any(n.strip() for n in report["notes"]), "Limited report needs a reason")
        known = {s["id"] for s in previous["stories"]} if previous else set()
        for story in edition["stories"]:
            require(story["source_kind"] != "facebook", "Facebook belongs to its own channel")
            require(bool(story["summary"].strip()), "Every story needs a concise summary")
            if story["id"] not in known:
                require(not story.get("original_text") or story["summary"] != story["original_text"], "Summary cannot be the full original text")
                image = story.get("image")
                if enforce_new_images:
                    require(isinstance(image, dict), "Every new non-Facebook story needs one source HTTPS image")
                if image:
                    require(image["url"].startswith("https://") and bool(image.get("credit", "").strip()), "New images need original HTTPS URL and attribution")
        dates = [e["date"] for e in manifest["editions"]]
        require(len(dates) == len(set(dates)), "Manifest dates must be unique")
        require(dates == sorted(dates, reverse=True), "Manifest dates must be newest first")
        require(manifest["current"] == dates[0], "Manifest current must be newest date")
        for entry in manifest["editions"]:
            require(entry["path"] == edition_path(entry["date"]), "Manifest path/date/channel mismatch")
        entry = next((e for e in manifest["editions"] if e["date"] == day), None)
        require(entry == {"date": day, "path": path, "story_count": len(ids), "is_demo": False}, "Manifest and edition disagree")
        preserve_stories(previous, edition)
        if previous_index:
            for old in previous_index["editions"]:
                require(any(new["date"] == old["date"] and (old["date"] == day or new == old) for new in manifest["editions"]), "Historical index entries must be preserved")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--date")
    parser.add_argument("--edition", type=Path)
    parser.add_argument("--index", type=Path)
    parser.add_argument("--previous-edition", type=Path)
    parser.add_argument("--previous-index", type=Path)
    parser.add_argument("--all", action="store_true", help="Validate every ChatGPT index entry")
    args = parser.parse_args()
    try:
        manifest = read_json(args.index or args.root / INDEX)
        validator = Validator.from_root(args.root)
        days = [e["date"] for e in manifest["editions"]] if args.all else [args.date or manifest["current"]]
        require(not args.all or not (args.edition or args.previous_edition or args.previous_index), "--all cannot use candidate/baseline overrides")
        for day in days:
            edition = read_json(args.edition or args.root / edition_path(day))
            validator.pair(edition, manifest, day,
                           read_json(args.previous_edition) if args.previous_edition else None,
                           read_json(args.previous_index) if args.previous_index else None,
                           enforce_new_images=bool(args.previous_edition))
        print(f"Validated {len(days)} ChatGPT edition(s), schemas/formats and manifest agreement")
        return 0
    except (Invalid, OSError, KeyError, TypeError) as error:
        print(f"Validation failed: {error.__class__.__name__}: {error if isinstance(error, Invalid) else 'unreadable or malformed input'}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
