import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import smart_ziw_config


class _FakeConfigCollection:
    def __init__(self):
        self._docs = {}

    def find_one(self, query):
        return self._docs.get(query.get("_type"))

    def update_one(self, query, update, upsert=False):
        doc = update.get("$set", {})
        doc["_type"] = query.get("_type")
        self._docs[query.get("_type")] = doc


class _FakeDB:
    def __init__(self):
        self.config = _FakeConfigCollection()


def test_load_default_config(monkeypatch):
    monkeypatch.setattr("database.get_db", lambda: _FakeDB())
    cfg = smart_ziw_config.load_smart_ziw_config()
    assert cfg["llm_provider"]["model"] == "claude-sonnet-4"
    assert cfg["max_iterations"] == 15


def test_load_merges_saved_config(monkeypatch):
    fake_db = _FakeDB()
    fake_db.config._docs["smart_ziw_config"] = {
        "_type": "smart_ziw_config",
        "config": {"max_iterations": 42, "brave_api_key": "secret"},
    }
    monkeypatch.setattr("database.get_db", lambda: fake_db)
    cfg = smart_ziw_config.load_smart_ziw_config()
    assert cfg["max_iterations"] == 42
    assert cfg["brave_api_key"] == "secret"
    assert cfg["llm_provider"]["model"] == "claude-sonnet-4"


def test_save_and_reload_config(monkeypatch):
    fake_db = _FakeDB()
    monkeypatch.setattr("database.get_db", lambda: fake_db)
    smart_ziw_config.save_smart_ziw_config(fake_db, {"max_iterations": 7})
    cfg = smart_ziw_config.load_smart_ziw_config()
    assert cfg["max_iterations"] == 7
    assert cfg["llm_provider"]["model"] == "claude-sonnet-4"


def test_redact_config_hides_secret_keys():
    cfg = {
        "llm_provider": {"base_url": "http://x", "api_key": "secret", "model": "m"},
        "brave_api_key": "brave-secret",
        "max_iterations": 5,
    }
    redacted = smart_ziw_config.redact_config(cfg)
    assert redacted["llm_provider"]["api_key"] == "***"
    assert redacted["llm_provider"]["base_url"] == "http://x"
    assert redacted["brave_api_key"] == "***"
    assert redacted["max_iterations"] == 5
    assert cfg["llm_provider"]["api_key"] == "secret"
