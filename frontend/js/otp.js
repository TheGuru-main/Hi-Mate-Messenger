// ==========================================
// HI-MATE MESSENGER
// otp.js — OTP screen helpers (resend countdown)
// ==========================================

let otpCountdown = 30;
let otpTimer = null;

function startOtpCountdown() {
    const resendEl = document.getElementById("otp-resend-timer");
    if (!resendEl) return;
    otpCountdown = 30;
    clearInterval(otpTimer);
    otpTimer = setInterval(() => {
        otpCountdown--;
        resendEl.textContent = otpCountdown > 0 ? `Resend available in ${otpCountdown}s` : "You can resend now";
        if (otpCountdown <= 0) clearInterval(otpTimer);
    }, 1000);
}

// Restart the countdown whenever the OTP page becomes visible
const otpPageObserver = new MutationObserver(() => {
    const otpPage = document.getElementById("auth-otp");
    if (otpPage && !otpPage.classList.contains("hidden")) {
        startOtpCountdown();
    }
});
window.addEventListener("load", () => {
    const otpPage = document.getElementById("auth-otp");
    if (otpPage) otpPageObserver.observe(otpPage, { attributes: true, attributeFilter: ["class"] });
});
