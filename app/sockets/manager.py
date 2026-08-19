"""
WebSocket connection manager for real-time message delivery.
Requires a host with persistent-connection support (Render — NOT Vercel).
"""
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # uid -> list of active connections (a user could have multiple devices)
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, uid: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(uid, []).append(websocket)

    def disconnect(self, uid: str, websocket: WebSocket):
        if uid in self.active_connections:
            self.active_connections[uid].remove(websocket)
            if not self.active_connections[uid]:
                del self.active_connections[uid]

    async def send_to_user(self, uid: str, message: dict):
        for connection in self.active_connections.get(uid, []):
            await connection.send_json(message)

    async def send_to_group(self, member_uids: list[str], message: dict):
        for uid in member_uids:
            await self.send_to_user(uid, message)


manager = ConnectionManager()
