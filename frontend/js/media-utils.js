const MAX_DIMENSION = 1600; // long-edge cap — sharp full-screen, meaningfully smaller than raw phone photos
const JPEG_QUALITY = 0.9;

export function compressImage(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith("image/") || file.type === "image/gif") {
            resolve(file);
            return;
        }
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => { img.src = e.target.result; };
        img.onload = () => {
            let { width, height } = img;
            if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
                resolve(file);
                return;
            }
            const scale = MAX_DIMENSION / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            canvas.getContext("2d").drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (!blob) { resolve(file); return; }
                resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
            }, "image/jpeg", JPEG_QUALITY);
        };
        img.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

export function timeAgo(dateStr) {
    if (!dateStr) return "";
    const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diffSec < 60) return "just now";
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    if (hr < 24) return remMin ? `${hr}h ${remMin}m ago` : `${hr}h ago`;
    const day = Math.floor(hr / 24);
    const remHr = hr % 24;
    return remHr ? `${day}d ${remHr}h ago` : `${day}d ago`;
}


export function startLiveTimestamps(root = document) {
    function tick() {
        root.querySelectorAll("[data-ts]").forEach(el => {
            el.textContent = timeAgo(el.dataset.ts);
        });
    }
    tick();
    return setInterval(tick, 30000);
}
