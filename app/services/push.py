"""Sends real browser push notifications via the Web Push protocol (VAPID)."""
import json

from pywebpush import webpush, WebPushException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.push_subscription import PushSubscription

settings = get_settings()


def send_push_to_user(db: Session, uid: str, title: str, body: str) -> None:
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY and settings.VAPID_SUBJECT):
        return  # not configured yet — silently skip, in-app bell still works

    subs = db.query(PushSubscription).filter(PushSubscription.uid == uid).all()
    if not subs:
        return

    payload = json.dumps({"title": title, "body": body})
    dead_ids = []
    for sub in subs:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
            )
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                dead_ids.append(sub.id)  # subscription expired/revoked — clean it up
    if dead_ids:
        db.query(PushSubscription).filter(PushSubscription.id.in_(dead_ids)).delete(synchronize_session=False)
        db.commit()
