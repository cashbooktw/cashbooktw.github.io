"""Offline regression tests; no network, credentials, or repository writes."""
from copy import deepcopy
from datetime import datetime
import hashlib
from pathlib import Path
import threading
import unittest

from validate_chatgpt import (INDEX, TAIPEI, Invalid, Validator, edition_path,
                              encode, loads, preserve_stories, scan_secrets)
from update_chatgpt import (APIError, CONTRACTS, Unverified, merge_edition,
                            merge_report, parallel, prepare, publish, rebase)

ROOT = Path(__file__).resolve().parents[1]
DAY = "2026-09-23"
NOW = datetime(2026, 9, 23, 16, 0, tzinfo=TAIPEI)
PATH = edition_path(DAY)


def story(name):
    return {"id": name, "title": f"Title {name}", "summary": "Reviewed concise summary",
            "section": "AI", "source_kind": "web", "tags": [], "image": None,
            "sources": [{"name": "Test source", "url": f"https://example.org/{name}"}]}


def fixture():
    edition = {"schema_version": 1, "date": DAY, "generated_at": f"{DAY}T12:00:00+08:00",
               "is_demo": False, "stories": [story("first"), story("second")],
               "source_reports": {"configured_sources": {"status": "complete", "completed_at": f"{DAY}T12:00:00+08:00",
                    "captured": 2, "included": 2, "excluded": 0, "notes": ["Original report note"]}}}
    manifest = {"schema_version": 1, "current": DAY, "updated_at": edition["generated_at"], "editions": [
        {"date": DAY, "path": PATH, "story_count": 2, "is_demo": False},
        {"date": "2026-09-22", "path": edition_path("2026-09-22"), "story_count": 3, "is_demo": False}]}
    files = {CONTRACTS[0]: "test rules", CONTRACTS[1]: '{"web_pages": []}',
             CONTRACTS[2]: (ROOT / CONTRACTS[2]).read_text(), CONTRACTS[3]: (ROOT / CONTRACTS[3]).read_text(),
             INDEX: encode(manifest), PATH: encode(edition)}
    return {"head": "a" * 40, "tree": "b" * 40, "date": DAY, "files": files}, edition, manifest


class FakeAPI:
    def __init__(self, snap):
        self.ref = snap["head"]
        self.initial = self.ref
        self.files = {self.ref: deepcopy(snap["files"])}
        self.commits = {self.ref: {"tree": {"sha": snap["tree"]}, "parents": []}}
        self.trees = {snap["tree"]: deepcopy(snap["files"])}
        self.calls = []
        self.head_calls = 0
        self.move_at = {}
        self.patch_race = None
        self.patch_error = None
        self.corrupt = False
        self.race_forever = False

    def sha(self, value):
        return hashlib.sha1(encode(value).encode()).hexdigest()

    def external(self, files):
        sha = self.sha([files, len(self.commits)])
        tree = self.sha(files)
        self.files[sha] = deepcopy(files)
        self.trees[tree] = deepcopy(files)
        self.commits[sha] = {"tree": {"sha": tree}, "parents": [{"sha": self.ref}]}
        return sha

    def head(self):
        self.head_calls += 1
        if self.race_forever and self.head_calls % 2 == 0:
            self.ref = self.external(self.files[self.ref])
        self.ref = self.move_at.get(self.head_calls, self.ref)
        return self.ref

    def commit(self, sha):
        return deepcopy(self.commits[sha])

    def file(self, path, ref, optional=False):
        content = self.files[ref].get(path)
        if content is None and not optional:
            raise APIError(404)
        if self.corrupt and ref != self.initial and path == PATH:
            return content + " "
        return content

    def request(self, method, path, value=None):
        self.calls.append((method, path, deepcopy(value)))
        if path == "/git/trees":
            assert method == "POST"
            files = deepcopy(self.trees[value["base_tree"]])
            assert {e["path"] for e in value["tree"]} == {PATH, INDEX}
            for entry in value["tree"]:
                assert entry["mode"] == "100644" and entry["type"] == "blob"
                assert "sha" not in entry
                files[entry["path"]] = entry["content"]
            sha = self.sha(files)
            self.trees[sha] = files
            return {"sha": sha}
        if path == "/git/commits":
            sha = self.sha(value)
            self.commits[sha] = {"tree": {"sha": value["tree"]}, "parents": [{"sha": p} for p in value["parents"]]}
            self.files[sha] = deepcopy(self.trees[value["tree"]])
            return {"sha": sha}
        if path == "/git/refs/heads/master":
            assert method == "PATCH" and value["force"] is False
            if self.patch_race:
                self.ref, self.patch_race = self.patch_race, None
                raise APIError(422)
            if self.patch_error:
                raise APIError(self.patch_error)
            assert self.commits[value["sha"]]["parents"] == [{"sha": self.ref}]
            self.ref = value["sha"]
            return {"object": {"sha": self.ref}}
        if path.startswith("/compare/"):
            return {"status": "ahead"}
        raise AssertionError("Unexpected API operation")


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.snap, self.old, self.index = fixture()
        self.validator = Validator.from_root(ROOT)
        self.new = deepcopy(self.old)
        self.new["stories"].append(story("new"))
        self.new["source_reports"]["configured_sources"].update(
            completed_at=f"{DAY}T13:00:00+08:00", status="limited", notes=["One listing was incomplete"])

    def plan(self):
        return prepare(self.snap, self.new, NOW)

    def test_valid_pair(self):
        self.validator.pair(self.old, self.index, DAY)

    def test_duplicate_json_keys(self):
        with self.assertRaises(Invalid): loads('{"x":1,"x":2}')

    def test_nonfinite_json(self):
        with self.assertRaises(Invalid): loads('{"x":NaN}')

    def test_bad_calendar_date(self):
        self.old["stories"][0]["published_at"] = "2026-02-30"
        with self.assertRaises(Invalid): self.validator.pair(self.old, self.index, DAY)

    def test_naive_timestamp(self):
        self.old["generated_at"] = f"{DAY}T12:00:00"
        with self.assertRaises(Invalid): self.validator.pair(self.old, self.index, DAY)

    def test_unknown_publication_allowed(self):
        self.old["stories"][0]["published_at"] = ""
        self.validator.pair(self.old, self.index, DAY)

    def test_duplicate_ids(self):
        self.new["stories"].append(deepcopy(self.new["stories"][-1]))
        with self.assertRaises(Invalid): self.plan()

    def test_manifest_count_demo_path_current_order_and_duplicates(self):
        variants = []
        for key, value in [("story_count", 999), ("is_demo", True), ("path", "data/facebook/editions/2026-09-23.json")]:
            x = deepcopy(self.index); x["editions"][0][key] = value; variants.append(x)
        x = deepcopy(self.index); x["current"] = "2026-09-22"; variants.append(x)
        x = deepcopy(self.index); x["editions"].reverse(); variants.append(x)
        x = deepcopy(self.index); x["editions"].append(deepcopy(x["editions"][0])); variants.append(x)
        for variant in variants:
            with self.subTest(variant=variants.index(variant)), self.assertRaises(Invalid):
                self.validator.pair(self.old, variant, DAY)

    def test_formal_source_url_required(self):
        self.new["stories"][-1]["sources"][0]["url"] = ""
        with self.assertRaises(Invalid): self.plan()

    def test_demo_rejected(self):
        self.new["is_demo"] = True
        with self.assertRaises(Invalid): self.plan()

    def test_facebook_rejected(self):
        self.new["stories"][-1]["source_kind"] = "facebook"
        with self.assertRaises(Invalid): self.plan()

    def test_missing_or_unexplained_report(self):
        self.new["source_reports"] = {}
        with self.assertRaises(Invalid): self.plan()
        self.new["source_reports"] = {"configured_sources": {**self.old["source_reports"]["configured_sources"], "status": "limited", "notes": []}}
        with self.assertRaises(Invalid): self.plan()
        # A direct validator also rejects an unexplained limited run.
        with self.assertRaises(Invalid): self.validator.pair(self.new, self.index, DAY)

    def test_new_image_must_have_credit_and_https(self):
        for image in [{"url": "https://example.org/x.png", "alt": "Image"}, {"url": "assets/x.png", "alt": "Image", "credit": "Source"}]:
            self.new["stories"][-1]["image"] = image
            with self.assertRaises(Invalid): self.plan()

    def test_existing_story_delete_rewrite_and_order_rejected(self):
        for mutate in [lambda e: e["stories"].pop(0), lambda e: e["stories"].reverse(), lambda e: e["stories"][0].update(summary="changed")]:
            candidate = deepcopy(self.new); mutate(candidate)
            with self.assertRaises(Invalid): prepare(self.snap, candidate, NOW)

    def test_sources_append_only(self):
        self.new["stories"][0]["sources"].append({"name": "Other verified original", "url": "https://example.org/other"})
        plan = self.plan()
        self.assertEqual(len(loads(plan["files"][PATH])["stories"][0]["sources"]), 2)
        self.new["stories"][0]["sources"][0]["url"] = "https://example.org/changed"
        with self.assertRaises(Invalid): self.plan()

    def test_history_preserved(self):
        result = loads(self.plan()["files"][INDEX])
        self.assertEqual(result["editions"][1], self.index["editions"][1])
        result["editions"].pop()
        with self.assertRaises(Invalid): self.validator.pair(self.old, result, DAY, previous_index=self.index)

    def test_real_time_and_midnight(self):
        self.assertEqual(loads(self.plan()["files"][PATH])["generated_at"], NOW.isoformat())
        with self.assertRaises(Invalid): prepare(self.snap, self.new, datetime(2026, 9, 24, tzinfo=TAIPEI))

    def test_future_report(self):
        self.new["source_reports"]["configured_sources"]["completed_at"] = f"{DAY}T23:00:00+08:00"
        with self.assertRaises(Invalid): self.plan()

    def test_secrets_not_echoed(self):
        secret = "ghp_" + "a" * 36
        for value in [secret, {"password": "private"}, "https://user:password@example.org/", "https://example.org/?token=private"]:
            with self.assertRaises(Invalid) as caught: scan_secrets(value)
            self.assertNotIn(secret, str(caught.exception))
            self.assertNotIn("password@", str(caught.exception))

    def test_old_report_retained_without_nested_growth(self):
        one = loads(self.plan()["files"][PATH])["source_reports"]["configured_sources"]
        self.assertIn("Original report note", one["notes"])
        self.assertTrue(any(n.startswith("Previous run") for n in one["notes"]))
        self.assertEqual(merge_report(one, one), one)

    def test_url_dedup_retains_id_and_text(self):
        duplicate = deepcopy(self.old["stories"][0]); duplicate["id"] = "different-id"; duplicate["title"] = "Another title"
        self.new["stories"] = self.old["stories"] + [duplicate]
        result = loads(self.plan()["files"][PATH])
        self.assertEqual(result["stories"], self.old["stories"])

    def test_collision_fails_closed(self):
        incoming = deepcopy(self.old); incoming["stories"][0]["title"] = "collision"
        with self.assertRaises(Invalid): merge_edition(self.old, incoming)

    def test_newer_concurrent_report_is_not_overwritten(self):
        recent = deepcopy(self.old["source_reports"]["configured_sources"])
        recent["completed_at"] = f"{DAY}T15:00:00+08:00"
        recent["captured"] = 7
        incoming = self.new["source_reports"]["configured_sources"]
        merged = merge_report(recent, incoming)
        self.assertEqual(merged["captured"], 7)
        self.assertIn("One listing was incomplete", merged["notes"])

    def test_cross_story_url_ambiguity_fails(self):
        candidate = deepcopy(self.new)
        candidate["stories"][-1]["sources"] = [*self.old["stories"][0]["sources"], *self.old["stories"][1]["sources"]]
        with self.assertRaises(Invalid): merge_edition(self.old, candidate)

    def test_config_change_blocks_rebase(self):
        latest = deepcopy(self.snap); latest["files"][CONTRACTS[1]] = "changed"
        with self.assertRaises(Invalid): rebase(self.snap, latest, self.new)

    def test_new_day_without_edition(self):
        snap = deepcopy(self.snap); snap["files"][PATH] = None
        index = deepcopy(self.index); index["editions"].pop(0); index["current"] = "2026-09-22"
        snap["files"][INDEX] = encode(index)
        result = prepare(snap, self.new, NOW)
        self.assertEqual(loads(result["files"][INDEX])["current"], DAY)

    def test_parallel_reads_preserve_order(self):
        barrier = threading.Barrier(6)
        def read(i):
            barrier.wait(timeout=5)
            return i
        self.assertEqual(parallel(read, range(6)), list(range(6)))

    def test_atomic_publish_and_readback(self):
        api = FakeAPI(self.snap)
        result = publish(api, self.snap, self.new, lambda: NOW)
        self.assertEqual(result["status"], "verified")
        self.assertEqual([method for method, _, _ in api.calls], ["POST", "POST", "PATCH"])
        self.assertEqual(len(loads(api.files[api.ref][PATH])["stories"]), 3)

    def test_noop_does_not_write(self):
        api = FakeAPI(self.snap)
        self.assertEqual(publish(api, self.snap, self.old, lambda: NOW)["status"], "unchanged")
        self.assertEqual(api.calls, [])

    def concurrent(self, api):
        files = deepcopy(self.snap["files"])
        current = deepcopy(self.old); current["stories"].append(story("concurrent"))
        index = deepcopy(self.index); index["editions"][0]["story_count"] += 1
        files[PATH], files[INDEX] = encode(current), encode(index)
        return api.external(files)

    def test_head_race_reloads_and_preserves_concurrent_story(self):
        api = FakeAPI(self.snap); api.move_at[2] = self.concurrent(api)
        result = publish(api, self.snap, self.new, lambda: NOW)
        self.assertEqual(result["status"], "verified")
        self.assertEqual([s["id"] for s in loads(api.files[api.ref][PATH])["stories"]], ["first", "second", "concurrent", "new"])
        self.assertEqual(sum(method == "PATCH" for method, _, _ in api.calls), 1)

    def test_race_between_head_check_and_patch(self):
        api = FakeAPI(self.snap); api.patch_race = self.concurrent(api)
        self.assertEqual(publish(api, self.snap, self.new, lambda: NOW)["status"], "verified")
        self.assertEqual(len(loads(api.files[api.ref][PATH])["stories"]), 4)

    def test_three_retry_limit(self):
        api = FakeAPI(self.snap); api.race_forever = True
        with self.assertRaises(Invalid): publish(api, self.snap, self.new, lambda: NOW)
        self.assertEqual(sum(path == "/git/trees" for _, path, _ in api.calls), 4)
        self.assertFalse(any(method == "PATCH" for method, _, _ in api.calls))

    def test_nonrace_422_not_retried(self):
        api = FakeAPI(self.snap); api.patch_error = 422
        with self.assertRaises(APIError): publish(api, self.snap, self.new, lambda: NOW)
        self.assertEqual(sum(method == "PATCH" for method, _, _ in api.calls), 1)
        self.assertEqual(api.ref, api.initial)

    def test_ref_failure_is_not_success(self):
        api = FakeAPI(self.snap); api.patch_error = 403
        with self.assertRaises(Unverified): publish(api, self.snap, self.new, lambda: NOW)
        self.assertEqual(api.ref, api.initial)

    def test_corrupt_readback_is_not_success(self):
        api = FakeAPI(self.snap); api.corrupt = True
        with self.assertRaises(Unverified): publish(api, self.snap, self.new, lambda: NOW)


if __name__ == "__main__":
    unittest.main()
