from datetime import date

from swing.data.macro import apply_rules, fomc_events, parse_bls_ics

ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Consumer Price Index for September 2026
DTSTART;TZID=America/New_York:20261014T083000
END:VEVENT
BEGIN:VEVENT
SUMMARY:Employment Situation for October 2026
DTSTART;TZID=America/New_York:20261106T083000
END:VEVENT
BEGIN:VEVENT
SUMMARY:Job Openings and Labor Turnover Survey
DTSTART;TZID=America/New_York:20261105T100000
END:VEVENT
END:VCALENDAR
"""


def test_parse_bls_keeps_only_market_movers():
    ev = parse_bls_ics(ICS)
    names = {e.name for e in ev}
    assert names == {"CPI", "NFP (Employment Situation)"}
    cpi = next(e for e in ev if e.name == "CPI")
    assert cpi.date == date(2026, 10, 14) and cpi.time_et == "08:30"


def test_rules_830_release_blocks_until_1000():
    ev = apply_rules(parse_bls_ics(ICS))
    assert all(e.no_new_entries_before == "10:00" for e in ev)


def test_fomc_yaml_and_rule():
    ev = apply_rules(fomc_events())
    assert any(e.date == date(2026, 10, 28) for e in ev)
    assert all(e.no_new_entries_after == "13:30" for e in ev)
