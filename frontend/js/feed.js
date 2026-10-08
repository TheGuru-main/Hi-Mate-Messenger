import { api, getCachedUser } from "./api.js";
import { openProfile } from "./profile.js";
import { buildConnectRow } from "./connect-utils.js";
import { talentLabel, businessLabel } from "./categories.js";

const REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "✅", "🙏", "🙋", "👏", "🚀", "🎓", "📍", "💪", "💎"];
const LONG_PRESS_MS = 450;

let pendingMediaRefs = [];
let mediaRecorder = null;
let recordedChunks = [];

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}


function isVideoRef(ref) {
    return /\.(mp4|mov|m4v)(\?|$)/i.test(ref || "");
}

function isAudioRef(ref) {
    return /\.(webm|mp3|m4a|wav|ogg|aac)(\?|$)/i.test(ref || "");
}

function isVoiceRef(ref) {
    return /(?:^|[/_-])voice[-_]/i.test(ref || "");
}

function renderCarousel(mediaRefs) {
    if (!mediaRefs || !mediaRefs.length) return "";

    const slides = mediaRefs.map((ref, index) => {
        const safeRef = escapeHtml(ref || "");

        /*
         * 1. VIDEO
         * MP4 / MOV / M4V are rendered through the Hi-Mate
         * custom video player.
         */
        if (isVideoRef(ref)) {
            return `
              <div class="carousel-slide">
                <div class="himate-video">
                  <video
                    src="${safeRef}"
                    class="carousel-media"
                    playsinline
                    preload="metadata"
                    data-media-index="${index}"
                  ></video>

                  <div class="himate-video-overlay">
                    <button
                      type="button"
                      class="himate-media-play"
                      data-media-action="play"
                      aria-label="Play video"
                    >
                      <i class="fa-solid fa-play"></i>
                    </button>
                  </div>

                  <div class="himate-video-controls">
                    <button
                      type="button"
                      class="himate-control-btn"
                      data-media-action="play"
                      aria-label="Play or pause"
                    >
                      <i class="fa-solid fa-play"></i>
                    </button>

                    <input
                      type="range"
                      class="himate-progress"
                      min="0"
                      max="100"
                      value="0"
                      step="0.1"
                      aria-label="Video progress"
                    >

                    <button
                      type="button"
                      class="himate-control-btn"
                      data-media-action="mute"
                      aria-label="Mute"
                    >
                      <i class="fa-solid fa-volume-high"></i>
                    </button>

                    <input
                      type="range"
                      class="himate-volume"
                      min="0"
                      max="1"
                      value="1"
                      step="0.05"
                      aria-label="Volume"
                    >

                    <button
                      type="button"
                      class="himate-control-btn"
                      data-media-action="download"
                      aria-label="Download video"
                    >
                      <i class="fa-solid fa-download"></i>
                    </button>
                  </div>
                </div>
              </div>
            `;
        }

        /*
         * 2. VOICE / AUDIO
         * Voice recordings are identified explicitly by voice-*
         * and are rendered separately from video.
         */
        if (isVoiceRef(ref) || isAudioRef(ref)) {
            return `
              <div class="carousel-slide himate-audio-slide">
                <div class="himate-audio">
                  <audio
                    src="${safeRef}"
                    class="himate-audio-element"
                    preload="metadata"
                  ></audio>

                  <div class="himate-audio-main">
                    <button
                      type="button"
                      class="himate-audio-play"
                      data-audio-action="play"
                      aria-label="Play voice message"
                    >
                      <i class="fa-solid fa-play"></i>
                    </button>

                    <div class="himate-audio-content">
                      <div class="himate-audio-top">
                        <div class="himate-audio-label">
                          <i class="fa-solid fa-microphone"></i>
                          ${isVoiceRef(ref) ? "Voice message" : "Audio"}
                        </div>

                        <div class="himate-audio-time">
                          <span class="himate-audio-current">0:00</span>
                          <span class="himate-audio-separator">/</span>
                          <span class="himate-audio-duration">0:00</span>
                        </div>
                      </div>

                      <input
                        type="range"
                        class="himate-audio-progress"
                        min="0"
                        max="100"
                        value="0"
                        step="0.1"
                        aria-label="Audio progress"
                      >

                      <div class="himate-audio-wave">
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>

                    <button
                      type="button"
                      class="himate-audio-control"
                      data-audio-action="mute"
                      aria-label="Mute audio"
                    >
                      <i class="fa-solid fa-volume-high"></i>
                    </button>

                    <input
                      type="range"
                      class="himate-audio-volume"
                      min="0"
                      max="1"
                      value="1"
                      step="0.05"
                      aria-label="Audio volume"
                    >

                    <button
                      type="button"
                      class="himate-audio-control"
                      data-audio-action="download"
                      aria-label="Download audio"
                    >
                      <i class="fa-solid fa-download"></i>
                    </button>
                  </div>
                </div>
              </div>
            `;
        }

        /*
         * 3. IMAGE
         * Images stay inside the carousel container and open
         * in the internal Hi-Mate image viewer when tapped.
         */
        return `
          <div class="carousel-slide">
            <button
              type="button"
              class="himate-image-trigger"
              data-image-src="${safeRef}"
              aria-label="View image"
            >
              <img
                src="${safeRef}"
                class="carousel-media"
                loading="lazy"
                alt=""
              >
            </button>
          </div>
        `;
    }).join("");

    const dots = mediaRefs.length > 1
        ? `<div class="carousel-dots">${mediaRefs.map((_, i) =>
            `<span class="carousel-dot${i === 0 ? " active" : ""}"></span>`
        ).join("")}</div>`
        : "";

    return `
      <div class="media-carousel">
        <div class="carousel-track">${slides}</div>
        ${dots}
      </div>
    `;
}

function openHiMateMediaViewer(mediaRefs, startIndex = 0) {
    const refs = Array.isArray(mediaRefs)
        ? mediaRefs.filter(Boolean)
        : [];

    if (!refs.length) return;

    const existing = document.querySelector(".himate-media-viewer");
    if (existing) existing.remove();

    let currentIndex = Math.max(
        0,
        Math.min(startIndex, refs.length - 1)
    );

    const overlay = document.createElement("div");
    overlay.className = "himate-media-viewer";

    overlay.innerHTML = `
      <div class="himate-media-viewer-header">
        <button
          type="button"
          class="himate-viewer-btn himate-media-close"
          aria-label="Close media viewer"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>

        <div class="himate-media-viewer-brand">
          Powered by GuruInnovations @
        </div>

        <button
          type="button"
          class="himate-viewer-btn himate-media-download"
          aria-label="Download media"
        >
          <i class="fa-solid fa-download"></i>
        </button>
      </div>

      <div class="himate-media-viewer-body">
        <button
          type="button"
          class="himate-media-nav himate-media-prev"
          aria-label="Previous media"
        >
          <i class="fa-solid fa-chevron-left"></i>
        </button>

        <div class="himate-media-viewer-track"></div>

        <button
          type="button"
          class="himate-media-nav himate-media-next"
          aria-label="Next media"
        >
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>

      <div class="himate-media-viewer-footer">
        <span class="himate-media-counter"></span>
      </div>
    `;

    document.body.appendChild(overlay);

    const track =
        overlay.querySelector(".himate-media-viewer-track");

    const counter =
        overlay.querySelector(".himate-media-counter");

    const renderViewerMedia = () => {
        track.innerHTML = "";

        const ref = refs[currentIndex];
        const safeRef = escapeHtml(ref);

        if (isVideoRef(ref)) {
            track.innerHTML = `
              <div class="himate-viewer-media-item">
                <video
                  class="himate-viewer-video"
                  src="${safeRef}"
                  playsinline
                  controls
                  autoplay
                ></video>
              </div>
            `;
        } else {
            track.innerHTML = `
              <div class="himate-viewer-media-item">
                <img
                  class="himate-viewer-image"
                  src="${safeRef}"
                  alt=""
                >
              </div>
            `;
        }

        counter.textContent =
            `${currentIndex + 1} / ${refs.length}`;

        const previous =
            overlay.querySelector(".himate-media-prev");

        const next =
            overlay.querySelector(".himate-media-next");

        previous.hidden = refs.length <= 1;
        next.hidden = refs.length <= 1;
    };

    const goTo = (index) => {
        if (!refs.length) return;

        currentIndex =
            (index + refs.length) % refs.length;

        renderViewerMedia();
    };

    overlay
        .querySelector(".himate-media-close")
        .addEventListener("click", () => overlay.remove());

    overlay
        .querySelector(".himate-media-prev")
        .addEventListener("click", (e) => {
            e.stopPropagation();
            goTo(currentIndex - 1);
        });

    overlay
        .querySelector(".himate-media-next")
        .addEventListener("click", (e) => {
            e.stopPropagation();
            goTo(currentIndex + 1);
        });

    overlay
        .querySelector(".himate-media-download")
        .addEventListener("click", () => {
            const src = refs[currentIndex];

            const a = document.createElement("a");
            a.href = src;
            a.download = "";
            a.target = "_blank";
            a.rel = "noopener";
            a.click();
        });

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    let startX = 0;

    track.addEventListener(
        "touchstart",
        (e) => {
            startX = e.touches[0].clientX;
        },
        { passive: true }
    );

    track.addEventListener(
        "touchend",
        (e) => {
            const delta =
                startX - e.changedTouches[0].clientX;

            if (Math.abs(delta) < 45) return;

            if (delta > 0) {
                goTo(currentIndex + 1);
            } else {
                goTo(currentIndex - 1);
            }
        },
        { passive: true }
    );

    document.addEventListener(
        "keydown",
        function mediaViewerKeys(e) {
            if (!document.body.contains(overlay)) {
                document.removeEventListener(
                    "keydown",
                    mediaViewerKeys
                );
                return;
            }

            if (e.key === "Escape") {
                overlay.remove();
            }

            if (e.key === "ArrowLeft") {
                goTo(currentIndex - 1);
            }

            if (e.key === "ArrowRight") {
                goTo(currentIndex + 1);
            }
        }
    );

    renderViewerMedia();
}


function updateVideoButton(video) {
    const player = video.closest(".himate-video");
    if (!player) return;

    const buttons = player.querySelectorAll(
        '[data-media-action="play"]'
    );

    buttons.forEach((button) => {
        button.innerHTML = video.paused
            ? '<i class="fa-solid fa-play"></i>'
            : '<i class="fa-solid fa-pause"></i>';
    });
}


function updateVideoProgress(video) {
    const player = video.closest(".himate-video");
    if (!player) return;

    const progress =
        player.querySelector(".himate-progress");

    if (!progress || !video.duration) return;

    progress.value =
        (video.currentTime / video.duration) * 100;
}


function wireVideoPlayer(player) {
    const video = player.querySelector("video");
    if (!video) return;

    const playButtons =
        player.querySelectorAll(
            '[data-media-action="play"]'
        );

    const muteButton =
        player.querySelector(
            '[data-media-action="mute"]'
        );

    const downloadButton =
        player.querySelector(
            '[data-media-action="download"]'
        );

    const progress =
        player.querySelector(".himate-progress");

    const volume =
        player.querySelector(".himate-volume");

    const togglePlay = () => {
        if (video.paused) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }
    };

    playButtons.forEach((button) => {
        button.addEventListener("click", (e) => {
            e.stopPropagation();
            togglePlay();
        });
    });

    muteButton?.addEventListener("click", (e) => {
        e.stopPropagation();

        video.muted = !video.muted;

        muteButton.innerHTML = video.muted
            ? '<i class="fa-solid fa-volume-xmark"></i>'
            : '<i class="fa-solid fa-volume-high"></i>';
    });

    volume?.addEventListener("input", (e) => {
        e.stopPropagation();

        video.volume = Number(e.target.value);
        video.muted = video.volume === 0;

        if (muteButton) {
            muteButton.innerHTML = video.muted
                ? '<i class="fa-solid fa-volume-xmark"></i>'
                : '<i class="fa-solid fa-volume-high"></i>';
        }
    });

    progress?.addEventListener("input", (e) => {
        e.stopPropagation();

        if (!video.duration) return;

        video.currentTime =
            (Number(e.target.value) / 100) *
            video.duration;
    });

    downloadButton?.addEventListener("click", (e) => {
        e.stopPropagation();

        const src = video.currentSrc || video.src;
        if (!src) return;

        const a = document.createElement("a");
        a.href = src;
        a.download = "";
        a.target = "_blank";
        a.rel = "noopener";
        a.click();
    });

    video.addEventListener("play", () => {
        updateVideoButton(video);
    });

    video.addEventListener("pause", () => {
        updateVideoButton(video);
    });

    video.addEventListener("timeupdate", () => {
        updateVideoProgress(video);
    });

    video.addEventListener("loadedmetadata", () => {
        updateVideoProgress(video);
    });

    video.addEventListener("ended", () => {
        updateVideoButton(video);
        const progress = player.querySelector(".himate-progress");
        if (progress) progress.value = 0;
    });
}


function updateAudioPlayer(audio) {
    const player = audio.closest(".himate-audio");
    if (!player) return;

    const playButton =
        player.querySelector(
            '[data-audio-action="play"]'
        );

    const progress =
        player.querySelector(".himate-audio-progress");

    const current =
        player.querySelector(".himate-audio-current");

    const duration =
        player.querySelector(".himate-audio-duration");

    const bars =
        player.querySelectorAll(
            ".himate-audio-wave span"
        );

    if (playButton) {
        playButton.innerHTML = audio.paused
            ? '<i class="fa-solid fa-play"></i>'
            : '<i class="fa-solid fa-pause"></i>';
    }

    if (current) {
        current.textContent =
            formatDuration(audio.currentTime * 1000);
    }

    if (duration && Number.isFinite(audio.duration)) {
        duration.textContent =
            formatDuration(audio.duration * 1000);
    }

    if (progress && Number.isFinite(audio.duration) && audio.duration > 0) {
        const percent =
            (audio.currentTime / audio.duration) * 100;

        progress.value = percent;

        const activeBars =
            Math.round(
                (percent / 100) * bars.length
            );

        bars.forEach((bar, index) => {
            bar.classList.toggle(
                "active",
                index < activeBars
            );
        });
    }
}


function wireAudioPlayer(player) {
    const audio =
        player.querySelector(".himate-audio-element");

    if (!audio) return;

    const playButton =
        player.querySelector(
            '[data-audio-action="play"]'
        );

    const muteButton =
        player.querySelector(
            '[data-audio-action="mute"]'
        );

    const downloadButton =
        player.querySelector(
            '[data-audio-action="download"]'
        );

    const progress =
        player.querySelector(".himate-audio-progress");

    const volume =
        player.querySelector(".himate-audio-volume");

    const togglePlay = () => {
        if (audio.paused) {
            audio.play().catch(() => {});
        } else {
            audio.pause();
        }
    };

    playButton?.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePlay();
    });

    muteButton?.addEventListener("click", (e) => {
        e.stopPropagation();

        audio.muted = !audio.muted;

        muteButton.innerHTML = audio.muted
            ? '<i class="fa-solid fa-volume-xmark"></i>'
            : '<i class="fa-solid fa-volume-high"></i>';
    });

    volume?.addEventListener("input", (e) => {
        e.stopPropagation();

        audio.volume =
            Number(e.target.value);

        audio.muted =
            audio.volume === 0;

        if (muteButton) {
            muteButton.innerHTML =
                audio.muted
                    ? '<i class="fa-solid fa-volume-xmark"></i>'
                    : '<i class="fa-solid fa-volume-high"></i>';
        }
    });

    progress?.addEventListener("input", (e) => {
        e.stopPropagation();

        if (
            !Number.isFinite(audio.duration) ||
            audio.duration <= 0
        ) {
            return;
        }

        audio.currentTime =
            (Number(e.target.value) / 100) *
            audio.duration;
    });

    downloadButton?.addEventListener("click", (e) => {
        e.stopPropagation();

        const src =
            audio.currentSrc ||
            audio.src;

        if (!src) return;

        const a =
            document.createElement("a");

        a.href = src;
        a.download = "";
        a.target = "_blank";
        a.rel = "noopener";
        a.click();
    });

    audio.addEventListener(
        "loadedmetadata",
        () => updateAudioPlayer(audio)
    );

    audio.addEventListener(
        "timeupdate",
        () => updateAudioPlayer(audio)
    );

    audio.addEventListener(
        "play",
        () => updateAudioPlayer(audio)
    );

    audio.addEventListener(
        "pause",
        () => updateAudioPlayer(audio)
    );

    audio.addEventListener(
        "ended",
        () => {
            audio.currentTime = 0;
            updateAudioPlayer(audio);
        }
    );

    updateAudioPlayer(audio);
}


function wireCarousel(cardEl) {
    const track = cardEl.querySelector(".carousel-track");
    if (!track) return;

    const dots = cardEl.querySelectorAll(".carousel-dot");

    const mediaRefs = Array.isArray(cardEl.__mediaRefs)
        ? cardEl.__mediaRefs
        : [];

    const slides =
        Array.from(
            track.querySelectorAll(".carousel-slide")
        );

    /*
     * Images:
     * Tap any image to open the complete media viewer.
     */
    cardEl
        .querySelectorAll(".himate-image-trigger")
        .forEach((trigger) => {
            trigger.addEventListener("click", (e) => {
                e.stopPropagation();

                const slide =
                    trigger.closest(".carousel-slide");

                const index =
                    slide
                        ? slides.indexOf(slide)
                        : 0;

                if (!mediaRefs.length) {
                    const src =
                        trigger.dataset.imageSrc;

                    if (src) {
                        openHiMateMediaViewer(
                            [src],
                            0
                        );
                    }

                    return;
                }

                openHiMateMediaViewer(
                    mediaRefs,
                    index >= 0 ? index : 0
                );
            });
        });

    /*
     * Videos:
     * The video itself opens the internal Hi-Mate
     * watch viewer. Controls remain inside the feed.
     */
    cardEl
        .querySelectorAll(".himate-video")
        .forEach((player) => {
            wireVideoPlayer(player);

            const video =
                player.querySelector("video");

            if (!video) return;

            const slide =
                player.closest(".carousel-slide");

            const index =
                slide
                    ? slides.indexOf(slide)
                    : 0;

            video.addEventListener("click", (e) => {
                e.stopPropagation();

                const src =
                    video.currentSrc ||
                    video.src;

                if (!src) return;

                openHiMateMediaViewer(
                    mediaRefs.length
                        ? mediaRefs
                        : [src],
                    index >= 0 ? index : 0
                );
            });
        });

    /*
     * Voice / audio:
     * Keep the custom Hi-Mate player.
     */
    cardEl
        .querySelectorAll(".himate-audio")
        .forEach((player) => {
            wireAudioPlayer(player);
        });

    /*
     * Horizontal media navigation.
     */
    let startX = 0;
    let scrolling = false;

    track.addEventListener(
        "touchstart",
        (e) => {
            startX =
                e.touches[0].clientX;

            scrolling = true;
        },
        { passive: true }
    );

    track.addEventListener(
        "touchmove",
        () => {},
        { passive: true }
    );

    track.addEventListener(
        "touchend",
        (e) => {
            if (!scrolling) return;

            scrolling = false;

            const delta =
                startX -
                e.changedTouches[0].clientX;

            if (Math.abs(delta) < 40) return;

            const slideWidth =
                track.clientWidth;

            if (!slideWidth) return;

            track.scrollTo({
                left:
                    track.scrollLeft +
                    (
                        delta > 0
                            ? slideWidth
                            : -slideWidth
                    ),
                behavior: "smooth"
            });
        }
    );

    track.addEventListener(
        "scroll",
        () => {
            const width =
                track.clientWidth;

            if (!width) return;

            const idx =
                Math.round(
                    track.scrollLeft / width
                );

            dots.forEach((dot, i) => {
                dot.classList.toggle(
                    "active",
                    i === idx
                );
            });
        }
    );
}

function closeReactionPopover() {
    const existing = document.querySelector(".reaction-popover");
    if (existing) existing.remove();
}

function openReactionPopover(anchorBtn, postId, onPicked) {
    closeReactionPopover();
    const popover = document.createElement("div");
    popover.className = "reaction-popover";
    popover.innerHTML = REACTIONS.map(e => `<button class="reaction-pick" data-emoji="${e}">${e}</button>`).join("");
    document.body.appendChild(popover);

    const rect = anchorBtn.getBoundingClientRect();
    const maxLeft = window.innerWidth - popover.offsetWidth - 8;
    popover.style.left = Math.min(Math.max(8, rect.left - 20), Math.max(8, maxLeft)) + "px";

    let top = rect.top - popover.offsetHeight - 10 + window.scrollY;
    if (top < window.scrollY + 8) top = rect.bottom + 10 + window.scrollY;
    popover.style.top = top + "px";

    popover.querySelectorAll(".reaction-pick").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            const emoji = btn.dataset.emoji;
            closeReactionPopover();
            try { await api.react(postId, emoji); if (onPicked) onPicked(emoji); } catch (e) { console.error(e); }
        });
    });
    setTimeout(() => document.addEventListener("click", closeReactionPopover, { once: true }), 0);
}

function wireLongPress(btn, postId, onPicked) {
    let pressTimer = null;
    let longPressed = false;
    const start = () => {
        longPressed = false;
        pressTimer = setTimeout(() => { longPressed = true; openReactionPopover(btn, postId, onPicked); }, LONG_PRESS_MS);
    };
    const cancel = () => clearTimeout(pressTimer);
    btn.addEventListener("touchstart", start, { passive: true });
    btn.addEventListener("touchend", cancel);
    btn.addEventListener("touchmove", cancel);
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", cancel);
    btn.addEventListener("mouseleave", cancel);
    btn.addEventListener("click", async () => {
        if (longPressed) return;
        try { await api.react(postId, "💎"); if (onPicked) onPicked("💎"); } catch (e) { console.error(e); }
    });
}

function closeOverlay() {
    const existing = document.querySelector(".feed-modal-overlay");
    if (existing) existing.remove();
}

function renderCommentItem(c) {
    const initials = (c.author_username || "?").slice(0, 2).toUpperCase();
    return `
      <div class="comment-item" data-comment-id="${c.id}">
        <div class="avatar small">${initials}</div>
        <div class="comment-body">
          <div class="comment-author">${escapeHtml(c.author_username)}</div>
          <div class="comment-text">${escapeHtml(c.content || "")}</div>
          <div class="comment-actions">
            <button class="comment-action-btn" data-action="reply">Reply</button>
            <button class="comment-action-btn comment-react-btn" data-action="react">React</button>
          </div>
        </div>
      </div>
    `;
}

async function openCommentBox(postId) {
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "feed-modal-overlay";
    overlay.innerHTML = `
      <div class="comment-box">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Comments</div>
          <button class="icon-btn comment-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="comment-list" id="comment-list"><div class="section-title">Loading…</div></div>
        <div class="comment-reply-context hidden" id="comment-reply-context"></div>
        <div class="comment-input-row">
          <input class="input-box" id="comment-input" placeholder="Add a comment…">
          <button class="send-btn" id="comment-send-btn"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".comment-close").addEventListener("click", closeOverlay);

    const listEl = overlay.querySelector("#comment-list");
    let replyTo = null;

    async function refresh() {
        try {
            const comments = await api.getComments(postId);
            listEl.innerHTML = comments.length ? comments.map(renderCommentItem).join("") : '<div class="section-title">No comments yet — be the first.</div>';
            listEl.scrollTop = listEl.scrollHeight;
            wireCommentButtons();
        } catch (e) {
            listEl.innerHTML = `<div class="error-text">${e.message}</div>`;
        }
    }

    function wireCommentButtons() {
        listEl.querySelectorAll('[data-action="reply"]').forEach(btn => {
            btn.addEventListener("click", () => {
                const item = btn.closest(".comment-item");
                replyTo = item.dataset.commentId;
                const ctx = overlay.querySelector("#comment-reply-context");
                ctx.classList.remove("hidden");
                ctx.innerHTML = `Replying to ${item.querySelector(".comment-author").textContent} <button id="cancel-reply">&times;</button>`;
                ctx.querySelector("#cancel-reply").addEventListener("click", () => { replyTo = null; ctx.classList.add("hidden"); });
                overlay.querySelector("#comment-input").focus();
            });
        });
        listEl.querySelectorAll(".comment-react-btn").forEach(btn => {
            const item = btn.closest(".comment-item");
            const commentId = item.dataset.commentId;
            btn.onclick = async () => {
                try { await api.reactToComment(commentId, "👍"); btn.textContent = "👍"; } catch (e) { console.error(e); }
            };
        });
    }

    overlay.querySelector("#comment-send-btn").addEventListener("click", async () => {
        const input = overlay.querySelector("#comment-input");
        const content = input.value.trim();
        if (!content) return;
        input.value = "";
        try {
            await api.addComment(postId, { content, parent_comment_id: replyTo });
            replyTo = null;
            overlay.querySelector("#comment-reply-context").classList.add("hidden");
            await refresh();
        } catch (e) {
            alert(e.message);
        }
    });

    refresh();
}

async function openSharePicker(post) {
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "feed-modal-overlay";

    let kliques = [];
    try { kliques = await api.kliqueList(); } catch (e) {}
    const me = getCachedUser();
    const kliqueOptions = kliques.map(k => {
        const otherUid = k.from_uid === (me ? me.uid : null) ? k.to_uid : k.from_uid;
        return `<label class="status-recipient-option"><input type="checkbox" value="${otherUid}"> ${escapeHtml(otherUid)}</label>`;
    }).join("");

    overlay.innerHTML = `
      <div class="share-picker">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Share</div>
          <button class="icon-btn share-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <button class="secondary-btn" id="share-to-feed"><i class="fa-solid fa-arrow-rotate-right"></i> Share to Feed</button>
        <button class="secondary-btn" id="share-external"><i class="fa-solid fa-up-right-from-square"></i> Share Externally</button>
        <div class="section-title">Or send to Kliques</div>
        <div class="status-recipients">${kliqueOptions || '<div class="section-title">No Kliques yet</div>'}</div>
        <button class="primary-btn" id="share-to-kliques">Send</button>
        <div class="error-text" id="share-error"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".share-close").addEventListener("click", closeOverlay);

    overlay.querySelector("#share-to-feed").addEventListener("click", async () => {
        try {
            await api.createPost({
                category: post.category,
                content: `🔁 Shared: ${post.content || ""}`,
                media_refs: post.media_refs || [],
            });
            closeOverlay();
            loadFeed();
        } catch (e) {
            alert(e.message);
        }
    });

    overlay.querySelector("#share-external").addEventListener("click", async () => {
        const shareText = post.content || "Check out this post on Hi-Mate";
        if (navigator.share) {
            try { await navigator.share({ text: shareText }); } catch (e) {}
        } else {
            try { await navigator.clipboard.writeText(shareText); alert("Copied to clipboard"); } catch (e) {}
        }
        closeOverlay();
    });

    overlay.querySelector("#share-to-kliques").addEventListener("click", async () => {
        const errEl = overlay.querySelector("#share-error");
        const targets = Array.from(overlay.querySelectorAll(".status-recipient-option input:checked")).map(el => el.value);
        if (!targets.length) { errEl.textContent = "Pick at least one Klique."; return; }
        try {
            await Promise.all(targets.map(uid => api.sendMessage({ receiver_uid: uid, type: "text", content: `Shared a post: ${post.content || "(media)"}` })));
            closeOverlay();
        } catch (e) {
            errEl.textContent = e.message;
        }
    });
}

function openReactionPicker(anchorBtn, onPicked) {
    closeReactionPopover();
    const popover = document.createElement("div");
    popover.className = "reaction-popover";
    popover.innerHTML = REACTIONS.map(e => `<button class="reaction-pick" data-emoji="${e}">${e}</button>`).join("");
    document.body.appendChild(popover);

    const rect = anchorBtn.getBoundingClientRect();
    const maxLeft = window.innerWidth - popover.offsetWidth - 8;
    popover.style.left = Math.min(Math.max(8, rect.left - 20), Math.max(8, maxLeft)) + "px";
    let top = rect.top - popover.offsetHeight - 10 + window.scrollY;
    if (top < window.scrollY + 8) top = rect.bottom + 10 + window.scrollY;
    popover.style.top = top + "px";

    popover.querySelectorAll(".reaction-pick").forEach(btn => {
        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            closeReactionPopover();
            onPicked(btn.dataset.emoji);
        });
    });
    setTimeout(() => document.addEventListener("click", closeReactionPopover, { once: true }), 0);
}

export function renderPost(post, opts) {
    const div = document.createElement("div");
    div.className = "card feed-card";

    /*
     * Keep the complete media set attached to the post card.
     * The internal viewer uses this to open 1..100 media items
     * without rebuilding the feed.
     */
    div.__mediaRefs = Array.isArray(post.media_refs)
        ? post.media_refs.filter(Boolean)
        : [];
    const initials = (post.author_username || "?").slice(0, 2).toUpperCase();
    const profileImage = post.author_profile_image_ref
        ? `<img class="feed-profile-image" src="${escapeHtml(post.author_profile_image_ref)}" alt="${escapeHtml(post.author_username || "Profile")}" loading="lazy">`
        : initials;
    const locationParts = [post.author_locality, post.author_region].filter(Boolean).join(", ");
    const talentBadge = post.author_talent_category ? `<span class="talent-badge">${escapeHtml(talentLabel(post.author_talent_category))}</span>` : "";

    div.innerHTML = `
      <div class="post-header">
        <div class="avatar profile-tap feed-profile-avatar" data-uid="${post.author_uid}">${profileImage}</div>
        <div class="post-header-text">
          <div class="post-author-name profile-tap" data-uid="${post.author_uid}">${escapeHtml(post.author_username || post.author_uid)} ${talentBadge}</div>
          <div class="post-meta" data-ts="${post.created_at}">${locationParts ? escapeHtml(locationParts) + " · " : ""}${post.category} · ${timeAgo(post.created_at)}</div>
        </div>
      </div>
      ${post.content ? `<div class="content">${escapeHtml(post.content)}</div>` : ""}
      ${post.media_refs && post.media_refs.length
        ? `
          <div class="feed-media-frame">
            <div class="feed-media-brand">
              <i class="fa-solid fa-bolt"></i>
              <span>Powered by GuruInnovations @</span>
            </div>
            ${renderCarousel(post.media_refs)}
          </div>
        `
        : ""
      }
      <div class="reaction-frame">
        <div class="action-row">
        <button class="action-btn react-btn" data-action="react"><i class="fa-regular fa-heart"></i></button>
        <button class="action-btn" data-action="comment"><i class="fa-regular fa-comment"></i> ${post.comment_count || ""}</button>
        <button class="action-btn" data-action="share"><i class="fa-solid fa-share"></i></button>
        <button class="action-btn gem-btn" data-action="gem"><i class="fa-solid fa-gem"></i></button>
      </div>
      </div>
    `;

    const me0 = getCachedUser();
    if (me0 && post.author_uid === me0.uid) {
        const delBtn = document.createElement("button");
        delBtn.className = "action-btn delete-post-btn";
        delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        delBtn.addEventListener("click", async () => {
            if (!confirm("Delete this post?")) return;
            try {
                await api.deletePost(post.id);
                div.remove();
            } catch (e) { alert(e.message); }
        });
        div.querySelector(".action-row").appendChild(delBtn);
    }

    div.querySelectorAll(".profile-tap").forEach(el => {
        el.addEventListener("click", () => openProfile(el.dataset.uid));
    });

    const me = getCachedUser();
    if (!(opts && opts.hideConnect) && me && post.author_uid !== me.uid) {
        const connectRow = buildConnectRow({
            uid: post.author_uid,
            kliqueStatus: post.author_klique_status,
            isFollowing: post.author_is_following,
        });
        const reactionFrame = div.querySelector(".reaction-frame");
        const actionRow = div.querySelector(".action-row");

        if (reactionFrame && actionRow) {
            reactionFrame.insertBefore(connectRow, actionRow);
        }
    }

    wireCarousel(div);
    const reactBtn = div.querySelector(".react-btn");
    const gemBtn = div.querySelector(".gem-btn");
    const reactState = {
        counts: Object.assign({}, post.reaction_counts || {}),
        myReaction: post.my_reaction || null,
        gemCount: post.gem_count || 0,
        myGem: !!post.my_gem,
    };

    function renderReactionButtons() {
        const total = Object.values(reactState.counts).reduce((a, b) => a + b, 0);
        const top = Object.entries(reactState.counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]).join("");
        reactBtn.innerHTML = `<span class="react-main">${reactState.myReaction || '<i class="fa-regular fa-heart"></i>'}</span>` +
            (total ? `<span class="react-top">${top}</span><span class="react-count">${total}</span>` : "");
        reactBtn.classList.toggle("active", !!reactState.myReaction);
        gemBtn.innerHTML = '<i class="fa-solid fa-gem"></i>' + (reactState.gemCount ? `<span class="react-count">${reactState.gemCount}</span>` : "");
        gemBtn.classList.toggle("active", reactState.myGem);
    }

    function bump(emoji, delta) {
        const next = (reactState.counts[emoji] || 0) + delta;
        if (next > 0) reactState.counts[emoji] = next; else delete reactState.counts[emoji];
    }

    async function applyReaction(emoji) {
        const prevCounts = Object.assign({}, reactState.counts);
        const prevMine = reactState.myReaction;
        if (prevMine === emoji) {
            bump(emoji, -1);
            reactState.myReaction = null;
        } else {
            if (prevMine) bump(prevMine, -1);
            bump(emoji, 1);
            reactState.myReaction = emoji;
        }
        renderReactionButtons();
        try {
            await api.react(post.id, emoji);
        } catch (e) {
            reactState.counts = prevCounts;
            reactState.myReaction = prevMine;
            renderReactionButtons();
            alert(e.message);
        }
    }

    async function toggleGem() {
        const prevCount = reactState.gemCount;
        const prevMine = reactState.myGem;
        reactState.myGem = !prevMine;
        reactState.gemCount = Math.max(0, prevCount + (prevMine ? -1 : 1));
        renderReactionButtons();
        try {
            await api.react(post.id, "💎");
        } catch (e) {
            reactState.gemCount = prevCount;
            reactState.myGem = prevMine;
            renderReactionButtons();
            alert(e.message);
        }
    }

    let lastTap = 0;
    let pressTimer = null;
    let longPressed = false;
    const startPress = () => {
        longPressed = false;
        pressTimer = setTimeout(() => {
            longPressed = true;
            openReactionPicker(reactBtn, (emoji) => { if (emoji === "💎") toggleGem(); else applyReaction(emoji); });
        }, LONG_PRESS_MS);
    };
    const cancelPress = () => clearTimeout(pressTimer);
    reactBtn.addEventListener("touchstart", startPress, { passive: true });
    reactBtn.addEventListener("touchend", cancelPress);
    reactBtn.addEventListener("touchmove", cancelPress);
    reactBtn.addEventListener("mousedown", startPress);
    reactBtn.addEventListener("mouseup", cancelPress);
    reactBtn.addEventListener("mouseleave", cancelPress);
    reactBtn.addEventListener("contextmenu", (e) => e.preventDefault());
    reactBtn.addEventListener("click", () => {
        if (longPressed) { longPressed = false; return; }
        const now = Date.now();
        const isDoubleTap = now - lastTap < 300;
        lastTap = now;
        if (isDoubleTap && reactState.myReaction) { applyReaction(reactState.myReaction); return; }
        if (!reactState.myReaction) applyReaction("❤️");
    });
    gemBtn.addEventListener("click", toggleGem);
    renderReactionButtons();

    div.querySelector('[data-action="comment"]').addEventListener("click", () => openCommentBox(post.id));
    div.querySelector('[data-action="share"]').addEventListener("click", () => openSharePicker(post));

    return div;
}

export async function loadFeed() {
    const list = document.getElementById("feed-list");
    if (!list) return;
    list.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        const posts = await api.getFeed();
        list.innerHTML = "";
        if (!posts.length) {
            list.innerHTML = '<div class="section-title">No posts yet — be the first to share something.</div>';
            return;
        }
        posts.forEach(p => list.appendChild(renderPost(p)));
    } catch (e) {
        list.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

function renderMediaPreview() {
    const box = document.getElementById("post-media-preview");
    if (!box) return;
    box.innerHTML = pendingMediaRefs.map((ref, i) => `
      <div class="media-chip">
        <span>${isVideoRef(ref) ? "🎬" : "🖼️"} attached</span>
        <button type="button" class="media-chip-remove" data-idx="${i}">&times;</button>
      </div>
    `).join("");
    box.querySelectorAll(".media-chip-remove").forEach(btn => {
        btn.addEventListener("click", () => {
            pendingMediaRefs.splice(Number(btn.dataset.idx), 1);
            renderMediaPreview();
        });
    });
}

import { compressImage, timeAgo } from "./media-utils.js";
import { reviewFiles } from "./media-editor.js";
import { showToast, updateToast, dismissToast } from "./toast.js";

async function handleMediaFiles(files) {
    const reviewed = await reviewFiles(files);
    if (!reviewed.length) return;

    const toast = showToast(`Uploading ${reviewed.length > 1 ? reviewed.length + " files" : "file"}…`, { sticky: true });
    let failed = 0;
    for (const file of reviewed) {
        try {
            const toUpload = await compressImage(file);
            const res = await api.uploadMedia(toUpload);
            pendingMediaRefs.push(res.media_ref);
        } catch (e) {
            failed++;
        }
    }
    renderMediaPreview();
    if (failed) {
        updateToast(toast, `${failed} upload${failed > 1 ? "s" : ""} failed`);
        setTimeout(() => dismissToast(toast), 2500);
    } else {
        updateToast(toast, "Uploaded ✓");
        setTimeout(() => dismissToast(toast), 1200);
    }
}

let recordingTimerInterval = null;
let recordingStartedAt = null;

function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

async function toggleVoiceRecording(btn) {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };

        const timerLabel = document.getElementById("voice-timer");
        recordingStartedAt = Date.now();
        if (timerLabel) {
            timerLabel.classList.remove("hidden");
            timerLabel.textContent = "00:00";
            recordingTimerInterval = setInterval(() => {
                timerLabel.textContent = formatDuration(Date.now() - recordingStartedAt);
            }, 250);
        }

        mediaRecorder.onstop = async () => {
            btn.classList.remove("recording");
            clearInterval(recordingTimerInterval);
            const finalDuration = formatDuration(Date.now() - recordingStartedAt);
            if (timerLabel) { timerLabel.textContent = ""; timerLabel.classList.add("hidden"); }
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(recordedChunks, { type: "audio/webm" });
            const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
            file.durationLabel = finalDuration;
            await handleMediaFiles([file]);
        };
        mediaRecorder.start();
        btn.classList.add("recording");
    } catch (e) {
        alert("Microphone access denied or unavailable.");
    }
}

function initPromoCarousel() {
    const track = document.getElementById("promo-track");
    const dotsBox = document.getElementById("promo-dots");
    if (!track || !dotsBox) return;

    const slides = track.querySelectorAll(".promo-slide");
    dotsBox.innerHTML = Array.from(slides).map((_, i) => `<span class="dot${i === 0 ? " active" : ""}"></span>`).join("");
    const dots = dotsBox.querySelectorAll(".dot");

    function goTo(idx) {
        track.scrollTo({ left: track.clientWidth * idx, behavior: "smooth" });
    }

    let current = 0;
    const autoAdvance = setInterval(() => {
        current = (current + 1) % slides.length;
        goTo(current);
    }, 4000);

    track.addEventListener("scroll", () => {
        current = Math.round(track.scrollLeft / track.clientWidth);
        dots.forEach((d, i) => d.classList.toggle("active", i === current));
    });

    track.addEventListener("touchstart", () => clearInterval(autoAdvance), { passive: true, once: true });
}

export async function loadVideoFeed() {
    const list = document.getElementById("video-feed-list");
    if (!list) return;
    list.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        const posts = await api.getFeed("video");
        list.innerHTML = "";
        if (!posts.length) {
            list.innerHTML = '<div class="section-title">No videos yet. Post a reel or short from the composer.</div>';
            return;
        }
        posts.forEach(p => list.appendChild(renderPost(p)));
    } catch (e) {
        list.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

export function initFeed() {
    initPromoCarousel();
    const btn = document.getElementById("btn-create-post");
    if (!btn) return;

    const voiceBtn = document.getElementById("btn-record-voice");

    function wireFileButton(btnId, inputId) {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (!btn || !input) return;
        btn.addEventListener("click", () => input.click());
        input.addEventListener("change", () => {
            if (input.files.length) handleMediaFiles(Array.from(input.files));
            input.value = "";
        });
    }
    wireFileButton("btn-take-photo", "post-photo-input");
    wireFileButton("btn-attach-image", "post-image-input");
    wireFileButton("btn-attach-video", "post-video-input");

    if (voiceBtn) voiceBtn.addEventListener("click", () => toggleVoiceRecording(voiceBtn));

    btn.addEventListener("click", async () => {
        const category = document.getElementById("post-category").value;
        const postContent = document.getElementById("post-content").value.trim();
        if (!category) return alert("Pick a category first.");
        if (!postContent && !pendingMediaRefs.length) return alert("Write something or attach media first.");

        const toast = showToast("Posting…", { sticky: true });
        try {
            const newPost = await api.createPost({ category, content: postContent, media_refs: pendingMediaRefs });
            document.getElementById("post-content").value = "";
            document.getElementById("post-category").value = "";
            pendingMediaRefs = [];
            renderMediaPreview();
            updateToast(toast, "Posted ✓");
            setTimeout(() => dismissToast(toast), 1200);

            const list = document.getElementById("feed-list");
            if (list) {
                const emptyState = list.querySelector(".section-title");
                if (emptyState && list.children.length === 1) list.innerHTML = "";
                list.insertBefore(renderPost(newPost), list.firstChild);
            }
        } catch (e) {
            updateToast(toast, `Failed: ${e.message}`);
            setTimeout(() => dismissToast(toast), 2500);
        }
    });
}
