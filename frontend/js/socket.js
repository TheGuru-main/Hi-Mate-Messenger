// ==========================================
// HI-MATE MESSENGER
// socket.js — WebSocket connection manager (messages + call signaling)
// ==========================================

let messageSocket = null;
let callSocket = null;
let messageHandlers = [];
let callHandlers = [];

export function connectMessageSocket() {
    const token = getToken();
    if (!token) return;
    if (messageSocket && messageSocket.readyState === WebSocket.OPEN) return;

    messageSocket = new WebSocket(WS_BASE + "/ws/messages?token=" + token);

    messageSocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            messageHandlers.forEach(fn => fn(data));
        } catch (e) {
            console.error("Bad WS payload", e);
        }
    };

    messageSocket.onclose = () => {
        setTimeout(connectMessageSocket, 3000);
    };
}

function connectCallSocket() {
    const token = getToken();
    if (!token) return;
    if (callSocket && callSocket.readyState === WebSocket.OPEN) return;

    callSocket = new WebSocket(WS_BASE + "/ws/calls?token=" + token);

    callSocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            callHandlers.forEach(fn => fn(data));
        } catch (e) {
            console.error("Bad call WS payload", e);
        }
    };

    callSocket.onclose = () => {
        setTimeout(connectCallSocket, 3000);
    };
}

export function onMessage(handler) {
    messageHandlers.push(handler);
}

function onCallSignal(handler) {
    callHandlers.push(handler);
}

function sendCallSignal(payload) {
    if (callSocket && callSocket.readyState === WebSocket.OPEN) {
        callSocket.send(JSON.stringify(payload));
    }
}

function sendTyping(toUid) {
    if (messageSocket && messageSocket.readyState === WebSocket.OPEN) {
        messageSocket.send(JSON.stringify({ type: "typing", to: toUid }));
    }
}
