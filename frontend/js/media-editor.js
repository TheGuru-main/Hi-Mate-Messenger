// Lightweight preview + crop step, inserted between "file picked" and "upload".
// Returns a Promise<File[]> of confirmed files (cropped where applicable), or
// Promise<[]> if the user cancels everything.

function closeEditor(overlay) {
    overlay.remove();
}

function previewImage(file) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "media-editor-overlay";
        overlay.innerHTML = `
          <div class="media-editor-box">
            <div class="status-viewer-header">
              <div class="status-viewer-name">Adjust Photo</div>
              <button class="icon-btn media-editor-cancel"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="crop-stage">
              <img class="crop-image" />
              <div class="crop-box">
                <div class="crop-handle tl"></div><div class="crop-handle tr"></div>
                <div class="crop-handle bl"></div><div class="crop-handle br"></div>
              </div>
            </div>
            <div class="chip-row crop-aspect-row">
              <button class="chip active" data-ratio="0">Free</button>
              <button class="chip" data-ratio="1">1:1</button>
              <button class="chip" data-ratio="0.8">4:5</button>
              <button class="chip" data-ratio="1.777">16:9</button>
            </div>
            <button class="primary-btn media-editor-confirm">Use Photo</button>
          </div>
        `;
        document.body.appendChild(overlay);

        const img = overlay.querySelector(".crop-image");
        const stage = overlay.querySelector(".crop-stage");
        const box = overlay.querySelector(".crop-box");
        const url = URL.createObjectURL(file);
        img.src = url;

        let box_x, box_y, box_w, box_h, stageW, stageH;

        function resetBox() {
            stageW = stage.clientWidth;
            stageH = stage.clientHeight;
            box_w = stageW * 0.8;
            box_h = stageH * 0.8;
            box_x = (stageW - box_w) / 2;
            box_y = (stageH - box_h) / 2;
            paint();
        }

        function paint() {
            box.style.left = box_x + "px";
            box.style.top = box_y + "px";
            box.style.width = box_w + "px";
            box.style.height = box_h + "px";
        }

        img.onload = resetBox;

        overlay.querySelectorAll(".crop-aspect-row .chip").forEach(chip => {
            chip.addEventListener("click", () => {
                overlay.querySelectorAll(".crop-aspect-row .chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                const ratio = parseFloat(chip.dataset.ratio);
                if (ratio > 0) {
                    const cx = box_x + box_w / 2, cy = box_y + box_h / 2;
                    box_h = box_w / ratio;
                    box_x = cx - box_w / 2;
                    box_y = cy - box_h / 2;
                    paint();
                }
            });
        });

        function clampBox() {
            box_w = Math.max(40, Math.min(box_w, stageW));
            box_h = Math.max(40, Math.min(box_h, stageH));
            box_x = Math.max(0, Math.min(box_x, stageW - box_w));
            box_y = Math.max(0, Math.min(box_y, stageH - box_h));
        }

        let drag = null; // { mode: 'move'|'tl'|'tr'|'bl'|'br', startX, startY, ox, oy, ow, oh }
        function pointerDown(e, mode) {
            e.preventDefault();
            const p = e.touches ? e.touches[0] : e;
            drag = { mode, startX: p.clientX, startY: p.clientY, ox: box_x, oy: box_y, ow: box_w, oh: box_h };
        }
        function pointerMove(e) {
            if (!drag) return;
            const p = e.touches ? e.touches[0] : e;
            const dx = p.clientX - drag.startX, dy = p.clientY - drag.startY;
            if (drag.mode === "move") {
                box_x = drag.ox + dx; box_y = drag.oy + dy;
            } else {
                if (drag.mode.includes("l")) { box_x = drag.ox + dx; box_w = drag.ow - dx; }
                if (drag.mode.includes("r")) { box_w = drag.ow + dx; }
                if (drag.mode.includes("t")) { box_y = drag.oy + dy; box_h = drag.oh - dy; }
                if (drag.mode.includes("b")) { box_h = drag.oh + dy; }
            }
            clampBox();
            paint();
        }
        function pointerUp() { drag = null; }

        box.addEventListener("mousedown", (e) => { if (e.target === box) pointerDown(e, "move"); });
        box.addEventListener("touchstart", (e) => { if (e.target === box) pointerDown(e, "move"); }, { passive: false });
        overlay.querySelectorAll(".crop-handle").forEach(h => {
            const mode = h.className.split(" ")[1];
            h.addEventListener("mousedown", (e) => pointerDown(e, mode));
            h.addEventListener("touchstart", (e) => pointerDown(e, mode), { passive: false });
        });
        window.addEventListener("mousemove", pointerMove);
        window.addEventListener("touchmove", pointerMove, { passive: false });
        window.addEventListener("mouseup", pointerUp);
        window.addEventListener("touchend", pointerUp);

        function cleanup() {
            window.removeEventListener("mousemove", pointerMove);
            window.removeEventListener("touchmove", pointerMove);
            window.removeEventListener("mouseup", pointerUp);
            window.removeEventListener("touchend", pointerUp);
            URL.revokeObjectURL(url);
        }

        overlay.querySelector(".media-editor-cancel").addEventListener("click", () => {
            cleanup(); closeEditor(overlay); resolve(null);
        });

        overlay.querySelector(".media-editor-confirm").addEventListener("click", () => {
            const scaleX = img.naturalWidth / img.clientWidth;
            const scaleY = img.naturalHeight / img.clientHeight;
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(box_w * scaleX);
            canvas.height = Math.round(box_h * scaleY);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(
                img,
                box_x * scaleX, box_y * scaleY, box_w * scaleX, box_h * scaleY,
                0, 0, canvas.width, canvas.height
            );
            canvas.toBlob((blob) => {
                cleanup(); closeEditor(overlay);
                if (!blob) { resolve(file); return; }
                resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
            }, "image/jpeg", 0.92);
        });
    });
}

function previewVideoOrAudio(file, kind) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "media-editor-overlay";
        const url = URL.createObjectURL(file);
        overlay.innerHTML = `
          <div class="media-editor-box">
            <div class="status-viewer-header">
              <div class="status-viewer-name">${kind === "video" ? "Preview Video" : "Preview Voice Note"}</div>
              <button class="icon-btn media-editor-cancel"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="media-preview-player">
              ${kind === "video"
                  ? `<video src="${url}" controls playsinline style="width:100%; border-radius:12px;"></video>`
                  : `<audio src="${url}" controls style="width:100%;"></audio>`}
            </div>
            <button class="primary-btn media-editor-confirm">Use ${kind === "video" ? "Video" : "Voice Note"}</button>
          </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector(".media-editor-cancel").addEventListener("click", () => {
            URL.revokeObjectURL(url); closeEditor(overlay); resolve(null);
        });
        overlay.querySelector(".media-editor-confirm").addEventListener("click", () => {
            URL.revokeObjectURL(url); closeEditor(overlay); resolve(file);
        });
    });
}

export async function reviewFiles(files) {
    const results = [];
    for (const file of files) {
        let outcome;
        if (file.type.startsWith("image/") && file.type !== "image/gif") {
            outcome = await previewImage(file);
        } else if (file.type.startsWith("video/")) {
            outcome = await previewVideoOrAudio(file, "video");
        } else if (file.type.startsWith("audio/")) {
            outcome = await previewVideoOrAudio(file, "audio");
        } else {
            outcome = file; // gif or unknown type — pass through unchanged
        }
        if (outcome) results.push(outcome);
    }
    return results;
}
