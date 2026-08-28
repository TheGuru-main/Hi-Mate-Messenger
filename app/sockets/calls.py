from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import JWTError

from app.services.auth import decode_token
from app.sockets.manager import manager

router = APIRouter()


@router.websocket("/ws/calls")
async def websocket_calls(websocket: WebSocket, token: str = Query(...)):
    """
    Call signaling channel — offer/answer/ICE candidate exchange for
    voice/video calls. This socket does NOT carry audio/video itself
    (that's peer-to-peer via WebRTC once signaling completes) — it only
    relays the handshake messages between caller and callee.
    """
    try:
        payload = decode_token(token)
        uid = payload.get("sub")
    except JWTError:
        await websocket.close(code=4001)
        return

    await manager.connect(uid, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")  # "offer" | "answer" | "ice_candidate" | "hangup"
            target_uid = data.get("target_uid")
            group_id = data.get("group_id")

            if event_type not in {"offer", "answer", "ice_candidate", "hangup"}:
                continue

            relay_payload = {
                "type": event_type,
                "from": uid,
                "payload": data.get("payload"),
                "call_session_id": data.get("call_session_id"),
            }

            if target_uid:
                await manager.send_to_user(target_uid, relay_payload)
            elif group_id:
                member_uids = data.get("member_uids", [])
                await manager.send_to_group(member_uids, relay_payload)
    except WebSocketDisconnect:
        manager.disconnect(uid, websocket)
