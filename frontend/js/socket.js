import { getToken, WS_BASE } from "./api.js";

let messageSocket = null;
let messageHandlers = [];

export function connectMessageSocket() {
  const token = getToken();
  if (!token) return;
  if (messageSocket && messageSocket.readyState === WebSocket.OPEN) return;

  messageSocket = new WebSocket(`${WS_BASE}/ws/messages?token=${token}`);

  messageSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      messageHandlers.forEach((fn) => fn(data));
    } catch (e) {
      console.error("Bad WS payload", e);
    }
  };

  messageSocket.onclose = () => {
    setTimeout(connectMessageSocket, 3000);
  };
}

export function onMessage(handler) {
  messageHandlers.push(handler);
}

export function sendTyping(toUid) {
  if (messageSocket && messageSocket.readyState === WebSocket.OPEN) {
    messageSocket.send(JSON.stringify({ type: "typing", to: toUid }));
  }
}
