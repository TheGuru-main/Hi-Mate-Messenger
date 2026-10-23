"""Economy manifest defaults: pure data, no imports. The first database row is seeded from this."""

DEFAULT_MANIFEST = {
    "version": 1,
    "currency": {
        "byflint_per_tfc": 1_000_000,
        "naira_per_tfc": 2000,
        "naira_per_byflint": 0.002,
    },
    "day_offset_minutes": 60,
    "pending_hours": 24,
    "checkin": {"byflint": 170, "fill_pct": 0.005},
    "rewards": {"like": 10, "comment": 25, "share": 50, "spot_gem": 300, "klique": 150},
    "caps": {
        "social_byflint_per_day": 15000,
        "social_fill_pct_per_day": 5.0,
        "live_sessions_per_day": 3,
        "gig_active_per_day": 1,
    },
    "fill": {
        "like": 0.05,
        "comment": 0.20,
        "live_session": 1.0,
        "gig_active_day": 2.0,
        "gig_completed": 3.0,
        "gig_won": 5.0,
    },
    "sandclock": {
        "boost_per_color": 1.08,
        "colors": [
            {"name": "Clay / Mud", "hex": "#92400E"},
            {"name": "Sand", "hex": "#D9B77E"},
            {"name": "Coal", "hex": "#374151"},
            {"name": "Iron", "hex": "#94A3B8"},
            {"name": "Copper", "hex": "#EA7A2F"},
            {"name": "Silver", "hex": "#CBD5E1"},
            {"name": "Gold", "hex": "#FACC15"},
            {"name": "Emerald", "hex": "#10B981"},
            {"name": "Sapphire", "hex": "#2563EB"},
            {"name": "Diamond", "hex": "#67E8F9"},
        ],
        "decay": {"start_after_days": 3, "base_pct": 2.0, "step_days": 2, "step_add_pct": 0.23},
    },
    "stream": {
        "base_per_min": 2,
        "per_10_viewers_per_min": 1,
        "max_hours_per_day": 4,
        "qualified_session_minutes": 10,
    },
    "gifts": [
        {"id": "clap", "name": "Clap", "cost": 500, "weight": 1},
        {"id": "rose", "name": "Rose", "cost": 2000, "weight": 4},
        {"id": "mic", "name": "Mic", "cost": 5000, "weight": 10},
        {"id": "drum", "name": "Drum", "cost": 10000, "weight": 20},
        {"id": "crown", "name": "Crown", "cost": 25000, "weight": 50},
        {"id": "trophy", "name": "Trophy", "cost": 60000, "weight": 120},
        {"id": "spotlight", "name": "Spotlight", "cost": 150000, "weight": 300},
    ],
    "gifts_v1": ["clap", "rose", "mic", "drum"],
    "gift_host_share_pct": 85,
    "gates": {
        "host_livestream": {"mutual_kliques": 50, "followers": 50},
        "withdraw": {"tfc": 1, "mutual_kliques": 1500, "followers": 4000},
        "gift_min_account_age_seconds": 2056860,
        "gift_daily_cap_per_host": 10000,
    },
    "gig": {
        "split": {"winner": 70, "second": 27, "fee": 3},
        "min_entrants": 3,
        "min_votes": 5,
        "voter_min_account_age_days": 7,
        "klique_vote_weight": 0.5,
        "score": {"completed": 100, "won": 250},
        "rewards": {"completed": 500, "won": 1250},
    },
}


# Rule changes ship as revisions: each becomes a NEW manifest row at startup (see manifest.py).
REVISIONS = [
    {
        "version": 2,
        "note": "Lower social rewards; comment rewards capped per target account",
        "patch": {
            "rewards": {"like": 7, "comment": 10, "spot_gem": 20},
            "caps": {"comments_per_target_per_day": 3},
        },
    },
]


REVISIONS.append({
    "version": 3,
    "note": "No per-Klique reward; Klique milestones; post rewards by duration",
    "patch": {
        "rewards": {"klique": 0},
        "klique_milestones": [
            {"at": 50, "total": 200},
            {"at": 75, "total": 375},
            {"at": 150, "total": 675},
        ],
        "klique_min_account_age_days": 7,
        "post_rewards": {
            "video": {
                "tiers": [
                    {"max_minutes": 2, "byflint": 75},
                    {"max_minutes": 6, "byflint": 150},
                    {"max_minutes": 18, "byflint": 300},
                    {"max_minutes": 30, "byflint": 500},
                    {"max_minutes": 60, "byflint": 700},
                ],
                "over_max_byflint": 700,
                "min_seconds": 5,
                "cap_per_day": 4,
            },
            "voice": {"divisor": 2, "min_seconds": 3, "cap_per_day": 4},
            "text": {"byflint": 10, "cap_per_day": 10},
        },
    },
})


REVISIONS.append({
    "version": 4,
    "note": "Livestream gifting, spending and accumulation rules; expanded gig and jobs rules",
    "patch": {
        "gift_rules": {
            "burn_pct": 15,
            "daily_spend_cap": 30000,
            "min_seconds_between_gifts": 2,
            "no_self_gifts": True,
            "flagged_sender_hold": True,
            "host_credit_hold_hours": 24,
            "credit_pool": "mined",
        },
        "spending": {
            "spend_from": "available",
            "pending_not_spendable": True,
            "refunds": False,
            "applies_to": ["gift_sent", "gig_entry"],
        },
        "stream": {
            "min_session_minutes": 10,
            "viewer_bonus_cap_viewers": 200,
            "settle_after_stream": True,
            "boost_applies": True,
            "viewer_byflint_per_session": 5,
            "viewer_sessions_per_day": 3,
            "qualified_viewer": {
                "min_account_age_days": 7,
                "one_per_device": True,
                "max_per_ip": 2,
                "heartbeat_seconds": 30,
            },
            "max_streams_per_ip": 3,
            "podcast_multiplier": 1.0,
        },
        "gig": {
            "types": ["audition", "challenge"],
            "entry_fee": {"min": 500, "max": 100000},
            "host_seed": {"min": 5000, "max": 500000},
            "max_entrants": 200,
            "max_active_per_host": 3,
            "min_lead_minutes": 60,
            "host_gate": {"mutual_kliques": 50, "followers": 50},
            "vote": {
                "live_votes_during_event": True,
                "poll_window_hours": 24,
                "viewer_min_watch_minutes": 10,
                "one_vote_per_account": True,
                "hide_tally_until_close": True,
                "tie_break": ["distinct_voters", "earlier_entry"],
            },
            "payout": {
                "hold_hours": 24,
                "remainder_to": "winner",
                "refund_on_cancel": True,
                "no_show_refund": False,
                "fee_to": "treasury",
            },
            "credit_once_per_pair_days": 30,
        },
        "jobs": {
            "posts_per_day": 3,
            "bids_per_day": 20,
            "bid_max_attachments": 5,
            "comment_pins_max": 3,
            "poster_min_account_age_days": 3,
            "vacancy_status_durations": ["24h", "3d", "1w"],
            "portfolio": {"max_items": 30, "max_pinned": 3, "max_credentials": 20},
            "post_states": ["open", "shortlisting", "filled", "closed"],
        },
    },
})


REVISIONS.append({
    "version": 5,
    "note": "Fill for Spot a Gem, Klique and Klique milestones; long videos repeat the tiers",
    "patch": {
        "fill": {
            "spot_gem": 0.30,
            "klique": 0.10,
            "klique_milestone": {"50": 1.0, "75": 2.0, "150": 5.0},
        },
        "caps": {"klique_fill_per_day": 1.0},
        "post_rewards": {"video": {"over_max": "repeat_tiers", "max_counted_minutes": 1440}},
    },
})


REVISIONS.append({
    "version": 6,
    "note": "Cap Byflints earned from shares at 117 a day per account; sharing itself is unlimited",
    "patch": {"caps": {"share_byflint_per_day": 117}},
})
