#!/usr/bin/env python3
"""Snapshot, prepare and explicitly publish a reviewed ChatGPT edition.

No scraping, summarization, scheduling, image downloads or Facebook access.
The default prepare command writes a local plan, never a GitHub ref.
"""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from validate_chatgpt import (INDEX, TAIPEI, Invalid, Validator, edition_path,
                              encode, loads, preserve_stories, read_json,
                              require, scan_secrets)

REPO = "cashbooktw/cashbooktw.github.io"
CONTRACTS = ("automation/UPDATE_RULES.md", "config/sources.json",
             "schema/edition.schema.json", "schema/manifest.schema.json")


class APIError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"GitHub request failed (HTTP {status or 'unknown'}); response body withheld")


class Unverified(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Invalid("GitHub redirected the request; refusing to forward credentials")


class GitHubAPI:
    def __init__(self, token=""):
        self.token = token

    def request(self, method, path, value=None):
        require(path.startswith("/") and not path.startswith("//"), "Invalid API path")
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "cashbook-chatgpt-updater",
                   "X-GitHub-Api-Version": "2026-03-10"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        body = encode(value).encode("utf-8") if value is not None else None
        if body:
            headers["Content-Type"] = "application/json"
        request = Request(f"https://api.github.com/repos/{REPO}{path}", data=body, headers=headers, method=method)
        try:
            # A new opener per request avoids sharing mutable handlers across workers.
            with build_opener(NoRedirect()).open(request, timeout=30) as response:
                data = response.read(16 * 1024 * 1024 + 1)
                require(len(data) <= 16 * 1024 * 1024, "GitHub response exceeds safety limit")
                return loads(data.decode("utf-8"))
        except HTTPError as error:
            raise APIError(error.code) from None
        except (URLError, TimeoutError, OSError):
            raise APIError(None) from None

    def head(self):
        return self.request("GET", "/git/ref/heads/master")["object"]["sha"]

    def commit(self, sha):
        return self.request("GET", f"/git/commits/{sha}")

    def file(self, path, ref, optional=False):
        try:
            result = self.request("GET", f"/contents/{quote(path, safe='/')}?ref={quote(ref, safe='')}")
        except APIError as error:
            if optional and error.status == 404:
                return None
            raise
        require(result.get("type") == "file" and result.get("encoding") == "base64", "Expected a regular UTF-8 repository file")
        return base64.b64decode(result["content"].replace("\n", ""), validate=True).decode("utf-8")


def parallel(function, items):
    """Bounded parallel reads; results retain input order, not completion order."""
    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(function, items))


def snapshot(api, day, head=None):
    target = edition_path(day)
    head = head or api.head()
    paths = [*CONTRACTS, INDEX, target]
    with ThreadPoolExecutor(max_workers=6) as pool:
        commit = pool.submit(api.commit, head)
        reads = {p: pool.submit(api.file, p, head, p == target) for p in paths}
        files = {p: future.result() for p, future in reads.items()}
        tree = commit.result()["tree"]["sha"]
    return {"head": head, "tree": tree, "date": day, "files": files}


def unpack(snap):
    require(bool(re.fullmatch(r"[0-9a-f]{40}", snap["head"])), "Invalid snapshot HEAD")
    require(bool(re.fullmatch(r"[0-9a-f]{40}", snap["tree"])), "Invalid snapshot tree")
    files = snap["files"]
    path = edition_path(snap["date"])
    validator = Validator(loads(files[CONTRACTS[2]]), loads(files[CONTRACTS[3]]))
    manifest = loads(files[INDEX])
    validator.schema(manifest, 1)
    old = loads(files[path]) if files[path] is not None else None
    if old:
        validator.pair(old, manifest, snap["date"])
    else:
        require(not any(e["date"] == snap["date"] for e in manifest["editions"]), "Indexed edition is missing")
    return validator, old, manifest


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def merge_report(old, new):
    """Keep latest run counters, all notes and a compact record of older counters."""
    if not old:
        return deepcopy(new)
    earlier, latest = (old, new) if instant(old["completed_at"]) <= instant(new["completed_at"]) else (new, old)
    result = deepcopy(latest)
    notes = list(old["notes"])
    before = {k: v for k, v in earlier.items() if k != "notes"}
    after = {k: v for k, v in latest.items() if k != "notes"}
    if before != after:
        notes.append("Previous run (historical, not current status): " + json.dumps(before, ensure_ascii=False, sort_keys=True))
    notes.extend(new["notes"])
    result["notes"] = list(dict.fromkeys(notes))
    return result


def merge_edition(current, candidate):
    if current is None:
        return deepcopy(candidate)
    require(current["date"] == candidate["date"], "Cannot merge different dates")
    result = deepcopy(candidate)
    result["stories"] = deepcopy(current["stories"])
    for incoming in candidate["stories"]:
        urls = {s["url"] for s in incoming["sources"]}
        matches = [s for s in result["stories"] if s["id"] == incoming["id"] or urls.intersection(x["url"] for x in s["sources"])]
        require(len(matches) <= 1, "Ambiguous deduplication; editorial review required")
        if not matches:
            result["stories"].append(deepcopy(incoming))
            continue
        existing = matches[0]
        if existing["id"] == incoming["id"]:
            require({k: v for k, v in existing.items() if k != "sources"} ==
                    {k: v for k, v in incoming.items() if k != "sources"},
                    "Story id collision or concurrent content edit; refusing overwrite")
        known = {s["url"] for s in existing["sources"]}
        for source in incoming["sources"]:
            if source["url"] not in known:
                existing["sources"].append(deepcopy(source))
                known.add(source["url"])
    result["source_reports"] = {"configured_sources": merge_report(
        current["source_reports"]["configured_sources"], candidate["source_reports"]["configured_sources"])}
    return result


def prepare(snap, candidate, now=None):
    now = now or datetime.now(TAIPEI)
    require(now.tzinfo is not None, "Execution time must include a timezone")
    day = now.astimezone(TAIPEI).date().isoformat()
    require(snap["date"] == day, "Snapshot expired across Taipei midnight; recollect sources")
    validator, old, manifest = unpack(snap)
    validator.schema(candidate, 0)
    scan_secrets(candidate)
    ids = [s["id"] for s in candidate["stories"]]
    require(len(ids) == len(set(ids)), "Candidate story ids must be unique")
    require(candidate["date"] == day and candidate["is_demo"] is False, "Candidate must be today's formal edition")
    require(set(candidate.get("source_reports", {})) == {"configured_sources"}, "Candidate needs a configured_sources report only")
    report = candidate["source_reports"]["configured_sources"]
    require(report["status"] != "limited" or any(n.strip() for n in report["notes"]), "Candidate limited report needs a reason")
    require(instant(report["completed_at"]) <= now, "Source report completion cannot be in the future")
    preserve_stories(old, candidate)
    edition = merge_edition(old, candidate)
    unchanged = old is not None and {k: v for k, v in old.items() if k != "generated_at"} == {k: v for k, v in edition.items() if k != "generated_at"}
    edition["generated_at"] = old["generated_at"] if unchanged else now.isoformat(timespec="seconds")
    require(manifest["current"] <= day, "Cannot rewrite historical editions")
    updated = deepcopy(manifest)
    entry = {"date": day, "path": edition_path(day), "story_count": len(edition["stories"]), "is_demo": False}
    updated["editions"] = [e for e in updated["editions"] if e["date"] != day] + [entry]
    updated["editions"].sort(key=lambda e: e["date"], reverse=True)
    updated["current"] = updated["editions"][0]["date"]
    if not unchanged:
        updated["updated_at"] = edition["generated_at"]
    validator.pair(edition, updated, day, old, manifest, enforce_new_images=True)
    return {"head": snap["head"], "base_tree": snap["tree"], "date": day,
            "unchanged": unchanged, "files": {edition_path(day): encode(edition), INDEX: encode(updated)}}


def rebase(original, latest, candidate):
    for path in CONTRACTS:
        require(original["files"][path] == latest["files"][path], "Rules, sources or schemas changed; recollect against the new contract")
    _, old, old_index = unpack(original)
    _, current, current_index = unpack(latest)
    preserve_stories(old, candidate)
    if old:
        require(current is not None, "Concurrent deletion of today's edition")
        preserve_stories(old, current)
    for entry in old_index["editions"]:
        require(any(e["date"] == entry["date"] and (e["date"] == original["date"] or e == entry) for e in current_index["editions"]), "Concurrent historical index changes need review")
    return merge_edition(current, candidate)


def verify(api, sha, plan):
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            commit_future = pool.submit(api.commit, sha)
            head_future = pool.submit(api.head)
            commit, head = commit_future.result(), head_future.result()
        require(commit["tree"]["sha"] == plan["tree"], "Created commit tree mismatch")
        require([p["sha"] for p in commit["parents"]] == [plan["head"]], "Created commit parent mismatch")
        pairs = [(path, ref) for ref in dict.fromkeys([sha, head]) for path in plan["files"]]
        contents = parallel(lambda item: api.file(*item), pairs)
        for (path, _), content in zip(pairs, contents):
            require(content == plan["files"][path], "Read-back content differs; publication is unverified")
        if head != sha:
            comparison = api.request("GET", f"/compare/{sha}...{head}")
            require(comparison["status"] in {"ahead", "identical"}, "Created commit is not on master")
        require(api.head() == head, "master moved during verification; publication is unverified")
    except Exception as error:
        raise Unverified(f"Commit {sha} was created; read-back did not fully verify publication ({type(error).__name__})") from None
    return {"status": "verified", "commit": sha, "master": head, "date": plan["date"]}


def publish(api, original, candidate, clock=lambda: datetime.now(TAIPEI)):
    # Validate the original proposal before any remote writes.
    prepare(original, candidate, clock())
    for attempt in range(4):  # First attempt plus at most three conflict retries.
        head = api.head()
        latest = original if head == original["head"] else snapshot(api, original["date"], head)
        merged = rebase(original, latest, candidate)
        plan = prepare(latest, merged, clock())
        if plan["unchanged"]:
            if api.head() != latest["head"]:
                continue
            return {"status": "unchanged", "commit": latest["head"], "date": plan["date"]}
        tree = api.request("POST", "/git/trees", {
            "base_tree": plan["base_tree"],
            "tree": [{"path": p, "mode": "100644", "type": "blob", "content": text} for p, text in plan["files"].items()]})["sha"]
        sha = api.request("POST", "/git/commits", {
            "message": f"Update ChatGPT edition {plan['date']}", "tree": tree, "parents": [plan["head"]]})["sha"]
        if api.head() != plan["head"]:
            continue
        try:
            api.request("PATCH", "/git/refs/heads/master", {"sha": sha, "force": False})
        except APIError as error:
            if error.status in {409, 422}:
                if api.head() != plan["head"]:
                    continue
                raise  # Not a HEAD race: do not hide validation/protection errors.
            # A timeout may have happened after GitHub accepted the ref update.
            raise Unverified(f"Commit {sha} exists; ref update outcome is unverified (HTTP {error.status or 'unknown'})") from None
        plan["tree"] = tree
        return verify(api, sha, plan)
    raise Invalid("master changed during all four attempts; stopped after three retries")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    capture = sub.add_parser("snapshot", help="Read one fixed master snapshot; no writes")
    capture.add_argument("--out", type=Path, required=True)
    for command in ("prepare", "publish"):
        p = sub.add_parser(command)
        p.add_argument("--snapshot", type=Path, required=True)
        p.add_argument("--edition", type=Path, required=True)
        if command == "prepare":
            p.add_argument("--out", type=Path, required=True)
        else:
            p.add_argument("--confirm-master", action="store_true", required=True)
    args = parser.parse_args()
    try:
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN", "")
        api = GitHubAPI(token)
        if args.command == "snapshot":
            result = snapshot(api, datetime.now(TAIPEI).date().isoformat())
        else:
            snap, candidate = read_json(args.snapshot), read_json(args.edition)
            if args.command == "prepare":
                result = prepare(snap, candidate)
            else:
                require(bool(token), "Publishing requires an environment token with repository Contents write permission")
                result = publish(api, snap, candidate)
        if args.command != "publish":
            args.out.write_text(encode(result), encoding="utf-8")
            print(f"{args.command}: local output saved; no GitHub ref was changed")
        else:
            print(encode(result), end="")
        return 0
    except (Invalid, Unverified, APIError, OSError, KeyError, TypeError, ValueError) as error:
        safe = str(error) if isinstance(error, (Invalid, Unverified, APIError)) else "Unreadable or malformed input"
        print(f"Failed: {safe}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
