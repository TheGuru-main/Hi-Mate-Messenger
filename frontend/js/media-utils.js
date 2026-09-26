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
