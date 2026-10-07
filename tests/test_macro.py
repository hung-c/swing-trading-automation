from datetime import date

from swing.data.macro import BLS_KEEP, apply_rules, fomc_events, heuristic_nfp, parse_ics, static_events

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
BEGIN:VEVENT
SUMMARY:Gross Domestic Product\\, 3rd Quarter 2026 (Advance Estimate)
DTSTART;VALUE=DATE-TIME:20261029T123000Z
END:VEVENT
END:VCALENDAR
"""


def test_parse_ics_keeps_only_market_movers_and_converts_utc():
    ev = parse_ics(ICS, {**BLS_KEEP, "gross domestic product": "GDP"}, "test")
    names = {e.name for e in ev}
    assert names == {"CPI", "NFP (Employment Situation)", "GDP"}
    cpi = next(e for e in ev if e.name == "CPI")
    assert cpi.date == date(2026, 10, 14) and cpi.time_et == "08:30"
    gdp = next(e for e in ev if e.name == "GDP")
    assert gdp.date == date(2026, 10, 29) and gdp.time_et == "08:30"  # 12:30Z in EDT


def test_rules_830_release_blocks_until_1000():
    ev = apply_rules(parse_ics(ICS, BLS_KEEP, "test"))
    assert all(e.no_new_entries_before == "10:00" for e in ev)


def test_fomc_yaml_and_rule():
    ev = apply_rules(fomc_events())
    assert any(e.date == date(2026, 10, 28) for e in ev)
    assert all(e.no_new_entries_after == "13:30" for e in ev)


def test_static_has_q4_2026():
    ev = static_events()
    assert any(e.name == "CPI" and e.date == date(2026, 10, 14) for e in ev)
    assert any(e.name == "PPI" and e.date == date(2026, 12, 15) for e in ev)


def test_heuristic_nfp_fills_missing_month_only():
    known = {("NFP (Employment Situation)", date(2027, 1, 8))}
    ev = heuristic_nfp(date(2027, 1, 1), date(2027, 2, 28), known)
    assert [e.date for e in ev] == [date(2027, 2, 5)]
    assert "estimated" in ev[0].name
