// ==========================================
// HI-MATE MESSENGER
// auth.js — REAL backend authentication (sandbox OTP simulation removed)
// ==========================================

import { api, setToken, setCachedUser } from "./api.js";
import { showPage } from "./router.js";

let pendingSignupToken = null;

function showAuthError(message) {
    const errEl = document.getElementById("auth-error");
    if (errEl) errEl.textContent = message;
    else alert(message);
}

export function initAuth() {
    const createBtn = document.getElementById("create-account-btn");
    const loginBtn = document.getElementById("login-existing-btn");
    const verifyBtn = document.getElementById("verify-otp-btn");
    const otpBackBtn = document.getElementById("otp-back-btn");

    if (createBtn) {
        createBtn.addEventListener("click", async () => {
            showAuthError("");

            const username = document.getElementById("username").value.trim();
            const phoneDigits = document.getElementById("phone").value.trim();
            const countryIso = document.getElementById("country").value.trim();
            const region = document.getElementById("region") ? document.getElementById("region").value.trim() : "";
            const locality = document.getElementById("locality") ? document.getElementById("locality").value.trim() : "";
            const language = document.getElementById("language").value;
            const businessCategory = document.getElementById("business-category") ? document.getElementById("business-category").value : "";
            const talentCategory = document.getElementById("talent-category") ? document.getElementById("talent-category").value : "";
            const password = document.getElementById("password").value.trim();

            if (!username) return showAuthError("Please enter username.");
            if (!phoneDigits) return showAuthError("Please enter phone number.");
            if (!countryIso) return showAuthError("Please select country.");
            if (!language) return showAuthError("Please select language.");
            if (!password) return showAuthError("Please create password.");

            const country = getCountryByISO(countryIso);
            if (!country) return showAuthError("Invalid country selection.");

            if (!validatePhoneNumber(countryIso, phoneDigits)) {
                return showAuthError(`Phone number should be ${country.min_digits}-${country.max_digits} digits for ${country.name}.`);
            }

            const fullPhone = country.dial_code + phoneDigits;

            try {
                const payload = {
                    phone: fullPhone,
                    username: username,
                    password: password,
                    country: country.name,
                    language: language,
                    business_role: businessCategory || null,
                    interest: talentCategory || null,
                    marital_status: null,
                    religion: null,
                    feed_preferences: [],
                };
                const res = await api.signup(payload);
                pendingSignupToken = res.signup_token;
                showPage("auth-otp");
            } catch (e) {
                showAuthError(e.message);
            }
        });
    }

    if (verifyBtn) {
        verifyBtn.addEventListener("click", async () => {
            const errEl = document.getElementById("otp-error");
            if (errEl) errEl.textContent = "";

            const enteredOTP = document.getElementById("otp-code").value.trim();

            if (!enteredOTP) return (errEl ? errEl.textContent = "Please enter OTP." : alert("Please enter OTP."));
            if (enteredOTP.length !== 6) return (errEl ? errEl.textContent = "OTP must be 6 digits." : alert("OTP must be 6 digits."));
            if (!pendingSignupToken) return (errEl ? errEl.textContent = "Session expired — please sign up again." : alert("Session expired."));

            try {
                const res = await api.verifyOtp({ signup_token: pendingSignupToken, otp: enteredOTP });
                setToken(res.access_token);
                const me = await api.getMe();
                setCachedUser(me);
                window.dispatchEvent(new CustomEvent("himate:authed"));
            } catch (e) {
                if (errEl) errEl.textContent = e.message;
                else alert(e.message);
            }
        });
    }

    if (otpBackBtn) {
        otpBackBtn.addEventListener("click", () => showPage("auth-phone"));
    }

    const backToSignupBtn = document.getElementById("btn-back-to-signup");
    if (backToSignupBtn) {
        backToSignupBtn.addEventListener("click", () => showPage("auth-phone"));
    }

    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            showPage("auth-login");
        });
    }

    initLoginForm();
}

// Separate login form (its own page — see index.html #login section)
function initLoginForm() {
    const loginSubmitBtn = document.getElementById("login-submit-btn");
    if (!loginSubmitBtn) return;

    loginSubmitBtn.addEventListener("click", async () => {
        const errEl = document.getElementById("login-error");
        if (errEl) errEl.textContent = "";

        const dialIso = document.getElementById("login-country-code").value;
        const phoneDigits = document.getElementById("login-phone").value.trim();
        const password = document.getElementById("login-password").value;

        const country = getCountryByISO(dialIso);
        if (!country) {
            if (errEl) errEl.textContent = "Please select your country code.";
            return;
        }
        const fullPhone = country.dial_code + phoneDigits;

        try {
            const res = await api.login({ phone: fullPhone, password: password });
            setToken(res.access_token);
            const me = await api.getMe();
            setCachedUser(me);
            window.dispatchEvent(new CustomEvent("himate:authed"));
        } catch (e) {
            if (errEl) errEl.textContent = e.message;
        }
    });
}
