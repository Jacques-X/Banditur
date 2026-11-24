"""Serve mode: one long-lived process, one request per stdin line (transcribe.serve)."""
import contextlib
import io
import json
import os
import tempfile
import unittest

import transcribe


def run(lines, pipeline):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        transcribe.serve("model", io.StringIO("".join(l + "\n" for l in lines)), pipeline=pipeline, loader=lambda p: p)
    return [json.loads(l) for l in out.getvalue().splitlines() if l.strip()]


class ServeTests(unittest.TestCase):
    def setUp(self):
        fd, self.media = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)

    def tearDown(self):
        os.unlink(self.media)

    def ok(self, path, model, start, end):
        transcribe.status("working")
        transcribe._emit({"type": "done", "all_words": [], "srt_path": path})

    def test_ready_then_two_requests_in_a_row(self):
        req = lambda i: json.dumps({"id": i, "op": "transcribe", "path": self.media})
        ev = run([req("a"), req("b")], self.ok)
        self.assertEqual(ev[0], {"type": "ready"})
        self.assertEqual([(e["type"], e["id"]) for e in ev[1:]], [("status", "a"), ("done", "a"), ("status", "b"), ("done", "b")])

    def test_a_failing_request_does_not_stop_the_next(self):
        calls = []

        def first_fails(path, *a):
            calls.append(path)
            if len(calls) == 1:
                raise RuntimeError("boom")
            self.ok(path, *a)

        req = lambda i: json.dumps({"id": i, "path": self.media})
        ev = run([req("x"), req("y")], first_fails)
        self.assertEqual([(e["type"], e["id"]) for e in ev[1:]], [("error", "x"), ("status", "y"), ("done", "y")])

    def test_a_missing_file_is_an_error_for_that_request(self):
        ev = run([json.dumps({"id": "x", "path": self.media + ".gone"})], self.ok)
        self.assertEqual((ev[1]["type"], ev[1]["id"]), ("error", "x"))

    def test_shutdown_and_closed_stdin_end_the_loop(self):
        ev = run([json.dumps({"op": "shutdown"}), json.dumps({"id": "late", "path": self.media})], self.ok)
        self.assertEqual(ev, [{"type": "ready"}])
        self.assertEqual(run([], self.ok), [{"type": "ready"}])

    def test_events_outside_a_request_carry_no_id(self):
        run([json.dumps({"id": "a", "path": self.media})], self.ok)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            transcribe.status("idle")
        self.assertNotIn("id", json.loads(out.getvalue()))

    def test_bad_json_is_reported(self):
        ev = run(["{not json", json.dumps({"id": "a", "path": self.media})], self.ok)
        self.assertEqual(ev[1]["type"], "error")
        self.assertEqual(ev[-1], {"type": "done", "all_words": [], "srt_path": self.media, "id": "a"})


if __name__ == "__main__":
    unittest.main()
