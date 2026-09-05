import { api, setToken, setCachedUser } from "./api.js";
import { showPage } from "./router.js";

let pendingSignupToken = null;

function digitsOnly(str) {
  return (str || "").replace(/\D/g, "");
}

export function initAuth() {
  document.getElementById("btn-goto-login").onclick = () => showPage("auth-login");
  document.getElementById("btn-goto-signup").onclick = () => showPage("auth-phone");

  document.getElementById("btn-signup").onclick = async () => {
    const errEl = document.getElementById("signup-error");
    errEl.textContent = "";
    try {
      const code = document.getElementById("signup-country-code").value;
      const phone = code + digitsOnly(document.getElementById("signup-phone").value);
      const payload = {
        phone,
        username: document.getElementById("signup-username").value.trim(),
        password: document.getElementById("signup-password").value,
        country: document.getElementById("signup-country").value.trim() || "Nigeria",
        language: document.getElementById("signup-language").value.trim() || "English",
        feed_preferences: [],
      };
      if (!payload.username || !payload.password) {
        throw new Error("Fill in your username and password.");
      }
      const res = await api.signup(payload);
      pendingSignupToken = res.signup_token;
      showPage("auth-otp");
    } catch (e) {
      errEl.textContent = e.message;
    }
  };

  document.getElementById("btn-verify-otp").onclick = async () => {
    const errEl = document.getElementById("otp-error");
    errEl.textContent = "";
    try {
      if (!pendingSignupToken) throw new Error("Session expired — please sign up again.");
      const otp = document.getElementById("otp-code").value.trim();
      const res = await api.verifyOtp({ signup_token: pendingSignupToken, otp });
      setToken(res.access_token);
      const me = await api.getMe();
      setCachedUser(me);
      window.dispatchEvent(new CustomEvent("himate:authed"));
    } catch (e) {
      errEl.textContent = e.message;
    }
  };

  document.getElementById("btn-login").onclick = async () => {
    const errEl = document.getElementById("login-error");
    errEl.textContent = "";
    try {
      const code = document.getElementById("login-country-code").value;
      const phone = code + digitsOnly(document.getElementById("login-phone").value);
      const password = document.getElementById("login-password").value;
      const res = await api.login({ phone, password });
      setToken(res.access_token);
      const me = await api.getMe();
      setCachedUser(me);
      window.dispatchEvent(new CustomEvent("himate:authed"));
    } catch (e) {
      errEl.textContent = e.message;
    }
  };
}
