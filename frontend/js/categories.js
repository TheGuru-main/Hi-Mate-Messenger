// ==========================================
// HI-MATE MESSENGER
// categories.js — Business/Talent Category (single-letter codes,
// matching the backend crawler's grid bands exactly) + Region/LGA/
// Community cascade (calls the real /location endpoints).
// ==========================================

import { api } from "./api.js";

const TALENT_FIELDS = [
    { code: "S", label: "⚽ Football / Soccer" },
    { code: "M", label: "🎵 Musician" },
    { code: "T", label: "✂️ Tailor" },
    { code: "F", label: "👗 Fashionista" },
    { code: "H", label: "🏬 Fashion House" },
    { code: "L", label: "💃 Model" },
    { code: "D", label: "💻 Software Developer" },
    { code: "W", label: "✍️ Writer / Media" },
    { code: "C", label: "🪚 Carpenter" },
    { code: "P", label: "📷 Photographer" },
    { code: "N", label: "📰 Newscaster" },
    { code: "K", label: "🎙️ Podcaster" },
];

const BUSINESS_CATEGORIES = [
    { code: "S", label: "⚽ Sports / Football" },
    { code: "R", label: "🍽️ Restaurant / Food" },
    { code: "B", label: "💇 Beauty / Salon" },
    { code: "E", label: "🛠️ Electronics / Repair" },
    { code: "A", label: "👗 Fashion / Apparel" },
    { code: "D", label: "🚗 Driver / Logistics" },
    { code: "G", label: "🛒 General Merchant" },
    { code: "M", label: "📱 Mobile / Tech" },
    { code: "H", label: "🏠 Home Services" },
    { code: "T", label: "✂️ Tailoring" },
];

export function talentLabel(code) {
    const found = TALENT_FIELDS.find(f => f.code === code);
    return found ? found.label : code;
}

export function businessLabel(code) {
    const found = BUSINESS_CATEGORIES.find(f => f.code === code);
    return found ? found.label : code;
}

function populateSelect(selectId, items) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="">Select…</option>';
    items.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item.code;
        opt.textContent = item.label;
        select.appendChild(opt);
    });
}

function loadCategoryDropdowns() {
    populateSelect("talent-category", TALENT_FIELDS);
    populateSelect("business-category", BUSINESS_CATEGORIES);
}

async function loadRegionsForCountry(countryIso) {
    const regionSelect = document.getElementById("region");
    const localitySelect = document.getElementById("locality");
    if (!regionSelect) return;

    regionSelect.innerHTML = '<option value="">Loading…</option>';
    if (localitySelect) localitySelect.innerHTML = '<option value="">Select Region first</option>';

    try {
        const res = await api.getLocationRegions(countryIso);
        const regions = res.regions || [];
        regionSelect.innerHTML = '<option value="">Select Region/State</option>';
        regions.forEach(r => {
            const opt = document.createElement("option");
            opt.value = r;
            opt.textContent = r;
            regionSelect.appendChild(opt);
        });
        if (!regions.length) {
            regionSelect.innerHTML = '<option value="">No data yet — type manually below</option>';
        }
    } catch (e) {
        regionSelect.innerHTML = '<option value="">Could not load — type manually below</option>';
    }
}

async function loadLocalitiesForRegion(region) {
    const localitySelect = document.getElementById("locality");
    if (!localitySelect) return;

    localitySelect.innerHTML = '<option value="">Loading…</option>';
    try {
        const res = await api.getLocationLocalities(region);
        const localities = res.localities || [];
        localitySelect.innerHTML = '<option value="">Select Locality/LGA</option>';
        localities.forEach(l => {
            const opt = document.createElement("option");
            opt.value = l;
            opt.textContent = l;
            localitySelect.appendChild(opt);
        });
        if (!localities.length) {
            localitySelect.innerHTML = '<option value="">No data yet — type manually below</option>';
        }
    } catch (e) {
        localitySelect.innerHTML = '<option value="">Could not load — type manually below</option>';
    }
}

function initLocationCascade() {
    const countrySelect = document.getElementById("country");
    const regionSelect = document.getElementById("region");

    if (countrySelect) {
        countrySelect.addEventListener("change", () => {
            if (countrySelect.value) loadRegionsForCountry(countrySelect.value);
        });
    }
    if (regionSelect) {
        regionSelect.addEventListener("change", () => {
            if (regionSelect.value) loadLocalitiesForRegion(regionSelect.value);
        });
    }
}

export function initCategories() {
    loadCategoryDropdowns();
    initLocationCascade();
}
