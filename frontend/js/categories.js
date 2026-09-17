// ==========================================
// HI-MATE MESSENGER
// categories.js — Business/Talent Category (single-letter codes,
// matching the backend crawler's grid bands exactly) + Region/LGA/
// Community cascade (calls the real /location endpoints).
// ==========================================

// Each entry's `code` is the EXACT single letter the backend crawler
// scores against (business_role / interest fields). The label is what
// the user sees; the code is what actually gets sent to the API.
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

// Business Category — same single-letter scheme, separate list since a
// person can be a Talent in one field and run a Business in another.
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


// ==========================================
// REGION / LGA / COMMUNITY CASCADE
// Calls the real backend endpoints — /location/regions, /location/localities.
// Continent -> Country already handled by countries.js; this picks up
// from Country downward.
// ==========================================

async function loadRegionsForCountry(countryIso) {
    const regionSelect = document.getElementById("region");
    const localitySelect = document.getElementById("locality");
    if (!regionSelect) return;

    regionSelect.innerHTML = '<option value="">Loading…</option>';
    if (localitySelect) localitySelect.innerHTML = '<option value="">Select Region first</option>';

    try {
        const res = await HiMateAPI.getLocationRegions(countryIso);
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
        const res = await HiMateAPI.getLocationLocalities(region);
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

window.addEventListener("load", () => {
    loadCategoryDropdowns();
    initLocationCascade();
});
