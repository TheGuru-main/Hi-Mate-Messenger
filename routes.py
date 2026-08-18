from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import JWTError

from app.services.auth import decode_token
from app.sockets.manager import manager

router = APIRouter()


@router.websocket("/ws/messages")
async def websocket_messages(websocket: WebSocket, token: str = Query(...)):
    try:
        payload = decode_token(token)
        uid = payload.get("sub")
    except JWTError:
        await websocket.close(code=4001)
        return

    await manager.connect(uid, websocket)
    try:
        while True:
            # Client can send typing indicators / read receipts here;
            # actual message persistence goes through POST /messages,
            # this socket is for push delivery + presence signals.
            data = await websocket.receive_json()
            event_type = data.get("type")
            if event_type == "typing":
                target = data.get("to")
                if target:
                    await manager.send_to_user(target, {"type": "typing", "from": uid})
    except WebSocketDisconnect:
        manager.disconnect(uid, websocket)
