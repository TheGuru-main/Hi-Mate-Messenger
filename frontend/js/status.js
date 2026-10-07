import { api, getCachedUser } from "./api.js";
import { compressImage } from "./media-utils.js";

let statusGroups = [];

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}

function closeModal() {
    const existing = document.querySelector(".status-modal-overlay");
    if (existing) existing.remove();
}

function renderStatusStrip() {
    const strip = document.getElementById("status-strip");
    if (!strip) return;
    strip.innerHTML = "";

    const addBtn = document.createElement("div");
    addBtn.className = "status-avatar-wrap";
    addBtn.innerHTML = `
      <div class="status-avatar add-status"><i class="fa-solid fa-plus"></i></div>
      <div class="status-avatar-label">Your Status</div>
    `;
    addBtn.addEventListener("click", openStatusComposer);
    strip.appendChild(addBtn);

    statusGroups.forEach(group => {
        const wrap = document.createElement("div");
        wrap.className = "status-avatar-wrap";
        const initials = (group.author_username || "?").slice(0, 2).toUpperCase();
        wrap.innerHTML = `
          <div class="status-avatar has-status">${initials}</div>
          <div class="status-avatar-label">${escapeHtml(group.is_me ? "You" : group.author_username)}</div>
        `;
        wrap.addEventListener("click", () => openStatusViewer(group));
        strip.appendChild(wrap);
    });
}

export async function loadStatusFeed() {
    try {
        statusGroups = await api.getStatusFeed();
        renderStatusStrip();
    } catch (e) {
        console.error(e);
    }
}

function openStatusViewer(group) {
    closeModal();
    let index = 0;
    const overlay = document.createElement("div");
    overlay.className = "status-modal-overlay";

    function render() {
        const s = group.statuses[index];
        overlay.innerHTML = `
          <div class="status-viewer">
            <div class="status-viewer-header">
              <div class="status-viewer-name">${escapeHtml(group.author_username)}</div>
              <button class="icon-btn status-viewer-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="status-viewer-progress">
              ${group.statuses.map((_, i) => `<span class="status-progress-bar ${i < index ? "seen" : ""} ${i === index ? "active" : ""}"></span>`).join("")}
            </div>
            <div class="status-viewer-body">
              ${s.media_ref ? `<img src="${s.media_ref}" class="status-media">` : ""}
              ${s.content ? `<div class="status-text">${escapeHtml(s.content)}</div>` : ""}
            </div>
            <div class="status-viewer-nav">
              <div class="status-nav-zone prev"></div>
              <div class="status-nav-zone next"></div>
            </div>
          </div>
        `;
        overlay.querySelector(".status-viewer-close").addEventListener("click", closeModal);
        overlay.querySelector(".prev").addEventListener("click", () => {
            if (index > 0) { index--; render(); } else { closeModal(); }
        });
        overlay.querySelector(".next").addEventListener("click", () => {
            if (index < group.statuses.length - 1) { index++; render(); } else { closeModal(); }
        });
    }

    render();
    document.body.appendChild(overlay);
}

async function openStatusComposer() {
    closeModal();

    const overlay = document.createElement("div");
    overlay.className = "status-modal-overlay";

    let kliques = [];

    try {
        kliques = await api.kliqueList();
    } catch (e) {
        /* Klique list is optional for global status. */
    }

    const me = getCachedUser();

    const kliqueOptions = kliques.map(k => {
        const otherUid =
            k.from_uid === (me ? me.uid : null)
                ? k.to_uid
                : k.from_uid;

        return `
          <label class="status-recipient-option">
            <input
              type="checkbox"
              value="${escapeHtml(otherUid)}"
            >
            ${escapeHtml(otherUid)}
          </label>
        `;
    }).join("");

    overlay.innerHTML = `
      <div class="status-composer himate-status-composer">

        <div class="status-viewer-header">
          <div class="status-viewer-name">
            Post a Status
          </div>

          <button
            class="icon-btn status-viewer-close"
            type="button"
            aria-label="Close"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="himate-status-brand">
          <i class="fa-solid fa-bolt"></i>
          <span>Powered by GuruInnovations @</span>
        </div>

        <textarea
          class="input-box"
          id="status-content"
          placeholder="What's happening?"
        ></textarea>

        <div
          id="status-media-preview"
          class="himate-status-media-picker"
        >
          <div class="himate-status-media-empty">
            <i class="fa-regular fa-images"></i>
            <span>No media selected</span>
          </div>
        </div>

        <div class="himate-status-media-toolbar">

          <button
            class="icon-btn"
            id="status-attach-media"
            type="button"
            aria-label="Select images or videos"
          >
            <i class="fa-solid fa-photo-film"></i>
          </button>

          <div class="himate-status-media-hint">
            Select multiple images or videos
          </div>

          <input
            type="file"
            id="status-media-input"
            accept="image/*,video/*"
            multiple
            hidden
          >

        </div>

        <label class="form-section label">
          Duration
        </label>

        <select
          class="input-box"
          id="status-duration"
        >
          <option value="">Select duration…</option>
          <option value="1h">1 hour</option>
          <option value="24h">24 hours</option>
          <option value="3d">3 days</option>
          <option value="1w">1 week</option>
        </select>

        <label class="form-section label">
          Share to
        </label>

        <select
          class="input-box"
          id="status-visibility"
        >
          <option value="global">
            All Kliques
          </option>

          <option value="targeted">
            Choose specific Kliques
          </option>
        </select>

        <div
          id="status-recipients"
          class="status-recipients hidden"
        >
          ${
              kliqueOptions ||
              '<div class="section-title">No Kliques yet</div>'
          }
        </div>

        <button
          class="primary-btn"
          id="status-post-btn"
          type="button"
        >
          Post Status
        </button>

        <div
          class="error-text"
          id="status-error"
        ></div>

      </div>
    `;

    document.body.appendChild(overlay);

    overlay
        .querySelector(".status-viewer-close")
        .addEventListener(
            "click",
            closeModal
        );

    const mediaInput =
        overlay.querySelector(
            "#status-media-input"
        );

    const mediaPreview =
        overlay.querySelector(
            "#status-media-preview"
        );

    const attachButton =
        overlay.querySelector(
            "#status-attach-media"
        );

    /*
     * Keep the actual media refs separately from
     * the visual preview.
     */
    let statusMediaRefs = [];

    /*
     * Custom Hi-Mate media selection renderer.
     *
     * The Android picker itself cannot be restyled by
     * browser JavaScript. Everything after selection,
     * however, is rendered entirely by Hi-Mate.
     */
    const renderSelectedMedia = () => {
        if (!statusMediaRefs.length) {
            mediaPreview.innerHTML = `
              <div class="himate-status-media-empty">
                <i class="fa-regular fa-images"></i>
                <span>No media selected</span>
              </div>
            `;
            return;
        }

        mediaPreview.innerHTML = `
          <div class="himate-status-media-header">
            <span>
              ${statusMediaRefs.length}
              ${statusMediaRefs.length === 1 ? "item" : "items"}
            </span>

            <button
              type="button"
              class="himate-status-clear"
            >
              Clear all
            </button>
          </div>

          <div class="himate-status-media-grid">
            ${statusMediaRefs.map((item, index) => `
              <div
                class="himate-status-media-item"
                data-index="${index}"
              >
                ${
                    item.previewUrl
                        ? (
                            item.kind === "video"
                                ? `
                                  <video
                                    src="${item.previewUrl}"
                                    muted
                                    playsinline
                                  ></video>
                                `
                                : `
                                  <img
                                    src="${item.previewUrl}"
                                    alt=""
                                  >
                                `
                          )
                        : `
                          <div class="himate-status-uploading">
                            <i class="fa-solid fa-spinner fa-spin"></i>
                          </div>
                        `
                }

                <div class="himate-status-media-number">
                  ${index + 1}
                </div>

                ${
                    item.uploading
                        ? `
                          <div class="himate-status-upload-state">
                            Uploading…
                          </div>
                        `
                        : ""
                }

                <button
                  type="button"
                  class="himate-status-remove"
                  data-remove-index="${index}"
                  aria-label="Remove media"
                >
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            `).join("")}
          </div>

          <div class="himate-status-media-footer">
            <i class="fa-solid fa-layer-group"></i>
            <span>
              All selected media will be posted in this Status.
            </span>
          </div>
        `;

        mediaPreview
            .querySelector(
                ".himate-status-clear"
            )
            ?.addEventListener(
                "click",
                () => {
                    statusMediaRefs.forEach(item => {
                        if (item.previewUrl) {
                            URL.revokeObjectURL(
                                item.previewUrl
                            );
                        }
                    });

                    statusMediaRefs = [];
                    mediaInput.value = "";
                    renderSelectedMedia();
                }
            );

        mediaPreview
            .querySelectorAll(
                "[data-remove-index]"
            )
            .forEach(button => {
                button.addEventListener(
                    "click",
                    () => {
                        const index =
                            Number(
                                button.dataset
                                    .removeIndex
                            );

                        const item =
                            statusMediaRefs[index];

                        if (
                            item?.previewUrl
                        ) {
                            URL.revokeObjectURL(
                                item.previewUrl
                            );
                        }

                        statusMediaRefs.splice(
                            index,
                            1
                        );

                        renderSelectedMedia();
                    }
                );
            });
    };

    attachButton.addEventListener(
        "click",
        () => mediaInput.click()
    );

    mediaInput.addEventListener(
        "change",
        async () => {
            const files =
                Array.from(
                    mediaInput.files || []
                );

            if (!files.length) {
                return;
            }

            /*
             * Append rather than replace.
             *
             * This allows the user to open the picker
             * more than once and continue building the
             * same Status media set.
             */
            const newItems = files.map(
                file => ({
                    file,
                    previewUrl:
                        URL.createObjectURL(
                            file
                        ),
                    mediaRef: null,
                    uploading: true,
                    kind:
                        file.type.startsWith(
                            "video/"
                        )
                            ? "video"
                            : "image",
                })
            );

            statusMediaRefs.push(
                ...newItems
            );

            renderSelectedMedia();

            /*
             * Upload each selected asset independently.
             *
             * Promise.all keeps the selected order.
             */
            await Promise.all(
                newItems.map(
                    async item => {
                        try {
                            const toUpload =
                                item.kind === "image"
                                    ? await compressImage(
                                          item.file
                                      )
                                    : item.file;

                            const res =
                                await api.uploadMedia(
                                    toUpload
                                );

                            item.mediaRef =
                                res.media_ref;

                            item.uploading =
                                false;
                        } catch (e) {
                            item.uploading =
                                false;
                            item.error =
                                e.message ||
                                "Upload failed";
                        }

                        renderSelectedMedia();
                    }
                )
            );

            /*
             * Allow another selection round.
             */
            mediaInput.value = "";
        }
    );

    const visSelect =
        overlay.querySelector(
            "#status-visibility"
        );

    const recipientsBox =
        overlay.querySelector(
            "#status-recipients"
        );

    visSelect.addEventListener(
        "change",
        () => {
            recipientsBox.classList.toggle(
                "hidden",
                visSelect.value !== "targeted"
            );
        }
    );

    overlay
        .querySelector("#status-post-btn")
        .addEventListener(
            "click",
            async () => {
                const errEl =
                    overlay.querySelector(
                        "#status-error"
                    );

                errEl.textContent = "";

                const content =
                    overlay
                        .querySelector(
                            "#status-content"
                        )
                        .value
                        .trim();

                const duration =
                    overlay.querySelector(
                        "#status-duration"
                    ).value;

                const visibility =
                    visSelect.value;

                const failed =
                    statusMediaRefs.find(
                        item =>
                            item.error
                    );

                const uploading =
                    statusMediaRefs.some(
                        item =>
                            item.uploading
                    );

                const mediaRefs =
                    statusMediaRefs
                        .filter(
                            item =>
                                item.mediaRef
                        )
                        .map(
                            item =>
                                item.mediaRef
                        );

                if (
                    !content &&
                    !mediaRefs.length
                ) {
                    errEl.textContent =
                        "Write something or attach media first.";
                    return;
                }

                if (uploading) {
                    errEl.textContent =
                        "Please wait for all media to finish uploading.";
                    return;
                }

                if (failed) {
                    errEl.textContent =
                        "One or more media files failed to upload. Remove them and try again.";
                    return;
                }

                if (!duration) {
                    errEl.textContent =
                        "Please choose a duration.";
                    return;
                }

                let recipient_uids = [];

                if (
                    visibility ===
                    "targeted"
                ) {
                    recipient_uids =
                        Array.from(
                            overlay.querySelectorAll(
                                ".status-recipient-option input:checked"
                            )
                        ).map(
                            el => el.value
                        );

                    if (
                        !recipient_uids.length
                    ) {
                        errEl.textContent =
                            "Pick at least one Klique to share with.";
                        return;
                    }
                }

                try {
                    await api.createStatus({
                        content,
                        media_refs:
                            mediaRefs,
                        duration,
                        visibility,
                        recipient_uids,
                    });

                    statusMediaRefs.forEach(
                        item => {
                            if (
                                item.previewUrl
                            ) {
                                URL.revokeObjectURL(
                                    item.previewUrl
                                );
                            }
                        }
                    );

                    closeModal();

                    await loadStatusFeed();

                } catch (e) {
                    errEl.textContent =
                        e.message;
                }
            }
        );

    overlay.addEventListener(
        "click",
        e => {
            if (
                e.target === overlay
            ) {
                closeModal();
            }
        }
    );
}

export function initStatus() {
    // nothing to wire on boot beyond loadStatusFeed — kept for symmetry with other init* functions
}

/* ============================================================
 * Hi-Mate Feed Status Surface
 *
 * Mirrors the existing status feed into #feed-status-strip.
 * The existing Klique/Messages #status-strip is untouched.
 * ============================================================ */

function renderFeedStatusSurface() {
    const strip = document.getElementById("feed-status-strip");
    if (!strip) return;

    strip.innerHTML = "";

    const addBtn = document.createElement("div");
    addBtn.className = "status-avatar-wrap";

    addBtn.innerHTML = `
      <div class="status-avatar add-status">
        <i class="fa-solid fa-plus"></i>
      </div>

      <div class="status-avatar-label">
        Your Status
      </div>
    `;

    addBtn.addEventListener(
        "click",
        openStatusComposer
    );

    strip.appendChild(addBtn);

    statusGroups.forEach(group => {
        const wrap = document.createElement("div");
        wrap.className = "status-avatar-wrap";

        const initials =
            (group.author_username || "?")
                .slice(0, 2)
                .toUpperCase();

        wrap.innerHTML = `
          <div class="status-avatar has-status">
            ${escapeHtml(initials)}
          </div>

          <div class="status-avatar-label">
            ${escapeHtml(
                group.is_me
                    ? "You"
                    : group.author_username
            )}
          </div>
        `;

        wrap.addEventListener(
            "click",
            () => openStatusViewer(group)
        );

        strip.appendChild(wrap);
    });
}

/*
 * The existing loadStatusFeed() already owns fetching and
 * rendering the canonical statusGroups data. We observe the
 * canonical strip and mirror its refresh into Feed.
 */
(function initFeedStatusMirror() {
    const sync = () => {
        renderFeedStatusSurface();
    };

    const canonicalStrip =
        document.getElementById("status-strip");

    if (canonicalStrip) {
        const observer = new MutationObserver(sync);

        observer.observe(canonicalStrip, {
            childList: true,
            subtree: true
        });

        sync();
    }

    sync();
})();

