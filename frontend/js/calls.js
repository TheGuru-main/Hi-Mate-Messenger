// ==========================================
// HI-MATE MESSENGER
// calls.js — group video calls (WebRTC mesh, small groups)
// Uses the backend's /ws/calls signaling relay (offer/answer/ICE only —
// audio/video itself travels peer-to-peer once connected).
// Mesh topology: fine for small groups (2-6 people); would need a real
// media server (SFU) to scale beyond that — flagged here, not solved.
// ==========================================

import { getCachedUser } from "./api.js";
import { showPage } from "./router.js";
import { connectCallSocket, onCallSignal, sendCallSignal } from "./socket.js";
import { getActiveConversation } from "./chat.js";

let localStream = null;
let peerConnections = {};
let currentCallGroupMembers = [];
let myCallUid = null;

const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

async function startGroupCall(memberUids) {
    currentCallGroupMembers = memberUids;
    const me = getCachedUser();
    myCallUid = me ? me.uid : null;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
        alert("Could not access camera/microphone: " + e.message);
        return;
    }

    const localVideo = document.getElementById("local-video");
    if (localVideo) localVideo.srcObject = localStream;

    connectCallSocket();
    showPage("call-room");

    memberUids.filter(uid => uid !== myCallUid).forEach(uid => createOfferTo(uid));
}

function createPeerConnection(remoteUid) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections[remoteUid] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendCallSignal({ type: "ice_candidate", target_uid: remoteUid, payload: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        addRemoteVideoTile(remoteUid, event.streams[0]);
    };

    return pc;
}

async function createOfferTo(remoteUid) {
    const pc = createPeerConnection(remoteUid);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendCallSignal({ type: "offer", target_uid: remoteUid, payload: offer });
}

async function handleIncomingOffer(fromUid, offer) {
    const pc = createPeerConnection(fromUid);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendCallSignal({ type: "answer", target_uid: fromUid, payload: answer });
}

async function handleIncomingAnswer(fromUid, answer) {
    const pc = peerConnections[fromUid];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleIncomingIce(fromUid, candidate) {
    const pc = peerConnections[fromUid];
    if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.error(e); }
    }
}

function addRemoteVideoTile(uid, stream) {
    const grid = document.getElementById("call-video-grid");
    if (!grid) return;
    let tile = document.getElementById("call-tile-" + uid);
    if (!tile) {
        tile = document.createElement("video");
        tile.id = "call-tile-" + uid;
        tile.autoplay = true;
        tile.playsInline = true;
        tile.className = "call-video-tile";
        grid.appendChild(tile);
    }
    tile.srcObject = stream;
}

function endCall() {
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    const grid = document.getElementById("call-video-grid");
    if (grid) grid.innerHTML = "";
    showPage("home");
}

export function initCalls() {
    const endBtn = document.getElementById("btn-end-call");
    if (endBtn) endBtn.addEventListener("click", endCall);

    const startCallBtn = document.getElementById("btn-start-group-call");
    if (startCallBtn) {
        startCallBtn.addEventListener("click", () => {
            const me = getCachedUser();
            const active = getActiveConversation();
            if (!active.uid || !me) return;
            const members = active.type === "group" && active.group
                ? active.group.member_uids
                : [me.uid, active.uid];
            startGroupCall(members);
        });
    }

    onCallSignal((data) => {
        if (data.type === "offer") handleIncomingOffer(data.from, data.payload);
        if (data.type === "answer") handleIncomingAnswer(data.from, data.payload);
        if (data.type === "ice_candidate") handleIncomingIce(data.from, data.payload);
        if (data.type === "hangup") {
            const pc = peerConnections[data.from];
            if (pc) { pc.close(); delete peerConnections[data.from]; }
            const tile = document.getElementById("call-tile-" + data.from);
            if (tile) tile.remove();
        }
    });
}
