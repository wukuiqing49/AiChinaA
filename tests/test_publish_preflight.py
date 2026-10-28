import pytest

from pipeline.jobs import publish_preflight


def test_preflight_targets_the_selected_dataset(monkeypatch):
    monkeypatch.setenv("PUBLISH_URL", "https://example.test/api/internal/publish-screener")
    monkeypatch.setenv("PUBLISH_SECRET", "test-secret")
    monkeypatch.setattr("sys.argv", ["preflight", "--dataset", "fund-flow"])
    calls = []

    def send(body, **kwargs):
        calls.append((body, kwargs))
        return {"status": "ready", "dataset": "fund-flow", "schemaVersion": 2}

    monkeypatch.setattr(publish_preflight, "publish_payload", send)
    assert publish_preflight.main() == 0
    assert calls == [
        (
            {"operation": "preflight", "runId": "preflight-check"},
            {
                "url": "https://example.test/api/internal/publish-fund-flow",
                "secret": "test-secret",
                "timeout": 30,
            },
        )
    ]


def test_preflight_rejects_unexpected_response(monkeypatch):
    monkeypatch.setenv("PUBLISH_URL", "https://example.test/api/internal/publish-screener")
    monkeypatch.setenv("PUBLISH_SECRET", "test-secret")
    monkeypatch.setattr("sys.argv", ["preflight"])
    monkeypatch.setattr(
        publish_preflight,
        "publish_payload",
        lambda *_args, **_kwargs: {
            "status": "ready",
            "dataset": "valuation",
            "schemaVersion": 2,
        },
    )
    with pytest.raises(RuntimeError, match="Invalid publish preflight"):
        publish_preflight.main()
