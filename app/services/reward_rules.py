"""Pure reward rules (no database): post rewards by duration, Klique milestone payouts."""


def _tier(seconds, m):
    """Tiers up to the top one, then the same tiers again for each extra stretch (62 min = 700 + 75)."""
    cfg = m["post_rewards"]["video"]
    tiers = cfg["tiers"]
    top = tiers[-1]["max_minutes"]
    seconds = min(float(seconds), float(cfg.get("max_counted_minutes", 1440)) * 60)
    total = 0
    while seconds / 60.0 > top + 1e-9:
        total += int(tiers[-1]["byflint"])
        seconds -= top * 60
    minutes = seconds / 60.0
    for tier in tiers:
        if minutes <= tier["max_minutes"] + 1e-9:
            return total + int(tier["byflint"])
    return total + int(tiers[-1]["byflint"])


def video_reward(seconds, m):
    cfg = m["post_rewards"]["video"]
    if seconds is None or seconds < cfg["min_seconds"]:
        return 0
    return _tier(seconds, m)


def voice_reward(seconds, m):
    cfg = m["post_rewards"]["voice"]
    if seconds is None or seconds < cfg["min_seconds"]:
        return 0
    return int(_tier(seconds, m) // cfg["divisor"])


def text_reward(m):
    return int(m["post_rewards"]["text"]["byflint"])


def klique_due(count, claimed_at, m):
    """Milestones reached but not yet paid. Totals are running totals, so each payout is the difference."""
    out = []
    prev_total = 0
    for ms in sorted(m.get("klique_milestones", []), key=lambda x: x["at"]):
        payout = int(ms["total"]) - prev_total
        prev_total = int(ms["total"])
        if count >= ms["at"] and ms["at"] not in claimed_at and payout > 0:
            out.append({"at": ms["at"], "payout": payout})
    return out
