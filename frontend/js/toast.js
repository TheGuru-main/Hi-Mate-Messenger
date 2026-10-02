export function showToast(text, opts = {}) {
    let box = document.getElementById("hm-toast-box");
    if (!box) {
        box = document.createElement("div");
        box.id = "hm-toast-box";
        document.body.appendChild(box);
    }
    const toast = document.createElement("div");
    toast.className = "hm-toast" + (opts.error ? " hm-toast-error" : "");
    toast.textContent = text;
    box.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));

    if (opts.sticky) return toast; // caller controls removal via updateToast/dismissToast

    const ms = opts.duration || 2200;
    setTimeout(() => dismissToast(toast), ms);
    return toast;
}

export function updateToast(toast, text) {
    if (toast) toast.textContent = text;
}

export function dismissToast(toast) {
    if (!toast) return;
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
}
