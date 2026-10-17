"""Sandclock engine: pure functions, no database, no wallet.

A state is any object with: color (1..N), fill (0..100), level, last_active_day (date | None), decay_steps."""


def _colors(m):
    return m["sandclock"]["colors"]


def boost(color, m):
    return round(m["sandclock"]["boost_per_color"] ** (max(1, color) - 1), 4)


def steps_for(idle_days, dcfg):
    if idle_days < dcfg["start_after_days"]:
        return 0
    return 1 + (idle_days - dcfg["start_after_days"]) // dcfg["step_days"]


def total_drain(n, dcfg):
    return n * dcfg["base_pct"] + dcfg["step_add_pct"] * n * (n - 1) / 2


def idle_days(state, today):
    if state.last_active_day is None:
        return 0
    return max(0, (today - state.last_active_day).days)


def apply_decay(state, m, today):
    """Drain fill for the idle time not yet charged. Colour and level never drop. Returns points drained."""
    dcfg = m["sandclock"]["decay"]
    if state.last_active_day is None:
        state.last_active_day = today
        return 0.0
    n = steps_for(idle_days(state, today), dcfg)
    if n <= state.decay_steps:
        return 0.0
    drain = total_drain(n, dcfg) - total_drain(state.decay_steps, dcfg)
    before = state.fill
    state.fill = max(0.0, state.fill - drain)
    state.decay_steps = n
    return round(before - state.fill, 3)


def mark_active(state, today):
    state.last_active_day = today
    state.decay_steps = 0


def add_fill(state, pct, m):
    """Add fill points. Returns how many colours were completed."""
    count = len(_colors(m))
    state.fill = float(state.fill) + float(pct)
    done = 0
    while state.fill >= 100.0:
        state.fill -= 100.0
        state.color += 1
        done += 1
        if state.color > count:
            state.color = 1
            state.level += 1
    state.fill = round(state.fill, 4)
    return done


def view(state, m, today):
    colors = _colors(m)
    idx = min(max(int(state.color), 1), len(colors))
    cur = colors[idx - 1]
    dcfg = m["sandclock"]["decay"]
    idle = idle_days(state, today)
    n = steps_for(idle, dcfg)
    if idle < dcfg["start_after_days"]:
        nxt_in = dcfg["start_after_days"] - idle
        nxt_drain = dcfg["base_pct"]
    else:
        nxt_in = dcfg["start_after_days"] + n * dcfg["step_days"] - idle
        nxt_drain = round(dcfg["base_pct"] + dcfg["step_add_pct"] * n, 2)
    b = boost(idx, m)
    return {
        "color": {"index": idx, "name": cur["name"], "hex": cur["hex"]},
        "fill": round(float(state.fill), 3),
        "level": int(state.level),
        "boost": b,
        "boost_pct": round((b - 1) * 100, 1),
        "colors": colors,
        "idle_days": idle,
        "decay": {"next_in_days": nxt_in, "next_drain_pct": nxt_drain},
    }
