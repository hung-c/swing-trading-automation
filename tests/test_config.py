import pytest

from swing.config import env, has_env


def test_env_strips_trailing_newline(monkeypatch):
    monkeypatch.setenv("ALPACA_SECRET", "secret-value\n")
    monkeypatch.setenv("ALPACA_KEY", "  key-value\r\n")
    assert env("ALPACA_SECRET") == "secret-value"
    assert env("ALPACA_KEY") == "key-value"
    assert has_env("ALPACA_KEY", "ALPACA_SECRET")


def test_env_blank_after_strip_is_missing(monkeypatch):
    monkeypatch.setenv("GROQ_KEY", "\n")
    assert env("GROQ_KEY") is None
    assert not has_env("GROQ_KEY")
    with pytest.raises(RuntimeError, match="GROQ_KEY"):
        env("GROQ_KEY", required=True)
