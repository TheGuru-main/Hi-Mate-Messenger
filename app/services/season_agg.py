"""Pure per-player season aggregation from AllSportsAPI Fixtures events.

No app imports on purpose, so it can be tested from Termux with live data.
Reads: lineups.{home,away}_team.starting_lineups[].player_key, substitutes[].{home,away}_scorer{in,out,in_id,out_id},
cards[].{home,away}_fault / {home,away}_player_id / card, goalscorers[].{home,away}_scorer(_id) / _assist(_id) / info."""

import re

MATCH_MINUTES = 90


def _s(v):
    return "" if v is None else str(v).strip()


def _minute(v):
    m = re.match(r"\s*(\d+)", _s(v))
    return int(m.group(1)) if m else None


def _side(ev, team_key):
    if _s(ev.get("home_team_key")) == team_key:
        return "home"
    if _s(ev.get("away_team_key")) == team_key:
        return "away"
    return None


def aggregate(events, team_key, skip_friendlies=True):
    tk = _s(team_key)
    players = {}
    matches = 0
    team_matches = 0
    no_lineup = 0

    def row(pid, name=""):
        r = players.get(pid)
        if r is None:
            r = players[pid] = {"name": "", "apps": 0, "starts": 0, "minutes": 0,
                                "goals": 0, "assists": 0, "yellow": 0, "red": 0}
        if name and not r["name"]:
            r["name"] = name
        return r

    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        status = _s(ev.get("event_status")).lower()
        if not (status.startswith("finished") or status.startswith("after")):
            continue
        if skip_friendlies and "friendl" in _s(ev.get("league_name")).lower():
            continue
        side = _side(ev, tk)
        if not side:
            continue
        team_matches += 1

        lu = ev.get("lineups") if isinstance(ev.get("lineups"), dict) else {}
        tlu = lu.get(side + "_team") if isinstance(lu.get(side + "_team"), dict) else {}
        starters = [p for p in (tlu.get("starting_lineups") or []) if isinstance(p, dict)]
        if not starters:
            no_lineup += 1
            continue
        matches += 1

        names = {}
        bench = [p for p in (tlu.get("substitutes") or []) if isinstance(p, dict)]
        for p in starters + bench:
            pid, nm = _s(p.get("player_key")), _s(p.get("player"))
            if pid and nm:
                names[nm.lower()] = pid

        def pid_of(pid, name):
            pid = _s(pid)
            return pid if pid else names.get(_s(name).lower(), "")

        out_t, in_t = {}, {}
        for s in ev.get("substitutes") or []:
            if not isinstance(s, dict):
                continue
            sc = s.get(side + "_scorer")
            if not isinstance(sc, dict) or not sc:
                continue
            t = _minute(s.get("time"))
            if t is None:
                continue
            pin = pid_of(sc.get("in_id"), sc.get("in"))
            pout = pid_of(sc.get("out_id"), sc.get("out"))
            if pin:
                in_t[pin] = t
                row(pin, _s(sc.get("in")))
            if pout:
                out_t[pout] = t

        for c in ev.get("cards") or []:
            if not isinstance(c, dict):
                continue
            name = c.get(side + "_fault")
            if not _s(name):
                continue
            pid = pid_of(c.get(side + "_player_id"), name)
            if not pid:
                continue
            r = row(pid, _s(name))
            kind = _s(c.get("card")).lower()
            if "red" in kind:
                r["red"] += 1
                t = _minute(c.get("time"))
                if t is not None:
                    out_t[pid] = min(out_t.get(pid, MATCH_MINUTES), t)
            elif "yellow" in kind:
                r["yellow"] += 1

        for g in ev.get("goalscorers") or []:
            if not isinstance(g, dict):
                continue
            info = _s(g.get("info")).lower()
            sname = g.get(side + "_scorer")
            if _s(sname) and "own" not in info:
                pid = pid_of(g.get(side + "_scorer_id"), sname)
                if pid:
                    row(pid, _s(sname))["goals"] += 1
            aname = g.get(side + "_assist")
            if _s(aname):
                pid = pid_of(g.get(side + "_assist_id"), aname)
                if pid:
                    row(pid, _s(aname))["assists"] += 1

        starter_ids = set()
        for p in starters:
            pid = _s(p.get("player_key"))
            if not pid:
                continue
            starter_ids.add(pid)
            r = row(pid, _s(p.get("player")))
            r["apps"] += 1
            r["starts"] += 1
            r["minutes"] += min(MATCH_MINUTES, out_t.get(pid, MATCH_MINUTES))

        for pid, t in in_t.items():
            if pid in starter_ids:
                continue
            r = row(pid)
            r["apps"] += 1
            end = min(MATCH_MINUTES, out_t.get(pid, MATCH_MINUTES))
            r["minutes"] += max(0, end - min(t, MATCH_MINUTES))

    return {"matches": matches, "team_matches": team_matches, "no_lineup": no_lineup, "players": players}
