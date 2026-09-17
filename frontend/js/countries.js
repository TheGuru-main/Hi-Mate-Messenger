// ==========================================
// HI-MATE MESSENGER
// countries.js
// COUNTRY REGISTRY + DROPDOWN SYSTEM
// PART 1 - AFRICA (original 21 — user is raising this to 25 separately)
// PART 2 - EUROPE (15)
// PART 3 - AMERICAS (15)
// PART 4 - ASIA (15)
// PART 5 - OCEANIA (15)
// ==========================================

const countries = [

    // ==========================
    // AFRICA
    // ==========================

    { name:"Nigeria", iso:"NG", flag:"🇳🇬", dial_code:"+234", min_digits:10, max_digits:10, continent:"Africa" },
    { name:"Ghana", iso:"GH", flag:"🇬🇭", dial_code:"+233", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Kenya", iso:"KE", flag:"🇰🇪", dial_code:"+254", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"South Africa", iso:"ZA", flag:"🇿🇦", dial_code:"+27", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Egypt", iso:"EG", flag:"🇪🇬", dial_code:"+20", min_digits:10, max_digits:10, continent:"Africa" },
    { name:"Morocco", iso:"MA", flag:"🇲🇦", dial_code:"+212", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Algeria", iso:"DZ", flag:"🇩🇿", dial_code:"+213", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Tunisia", iso:"TN", flag:"🇹🇳", dial_code:"+216", min_digits:8, max_digits:8, continent:"Africa" },
    { name:"Ethiopia", iso:"ET", flag:"🇪🇹", dial_code:"+251", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Uganda", iso:"UG", flag:"🇺🇬", dial_code:"+256", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Tanzania", iso:"TZ", flag:"🇹🇿", dial_code:"+255", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Rwanda", iso:"RW", flag:"🇷🇼", dial_code:"+250", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Senegal", iso:"SN", flag:"🇸🇳", dial_code:"+221", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Ivory Coast", iso:"CI", flag:"🇨🇮", dial_code:"+225", min_digits:10, max_digits:10, continent:"Africa" },
    { name:"Cameroon", iso:"CM", flag:"🇨🇲", dial_code:"+237", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Eswatini", iso:"SZ", flag:"🇸🇿", dial_code:"+268", min_digits:8, max_digits:8, continent:"Africa" },
    { name:"Malawi", iso:"MW", flag:"🇲🇼", dial_code:"+265", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Mozambique", iso:"MZ", flag:"🇲🇿", dial_code:"+258", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Eritrea", iso:"ER", flag:"🇪🇷", dial_code:"+291", min_digits:7, max_digits:7, continent:"Africa" },
    { name:"Guinea", iso:"GN", flag:"🇬🇳", dial_code:"+224", min_digits:9, max_digits:9, continent:"Africa" },
    { name:"Democratic Republic of Congo", iso:"CD", flag:"🇨🇩", dial_code:"+243", min_digits:9, max_digits:9, continent:"Africa" },
    // NOTE: user is raising Africa to 25 separately — add 4 more entries here to match.

    // ==========================
    // EUROPE
    // ==========================

    { name:"United Kingdom", iso:"GB", flag:"🇬🇧", dial_code:"+44", min_digits:10, max_digits:10, continent:"Europe" },
    { name:"Germany", iso:"DE", flag:"🇩🇪", dial_code:"+49", min_digits:10, max_digits:11, continent:"Europe" },
    { name:"France", iso:"FR", flag:"🇫🇷", dial_code:"+33", min_digits:9, max_digits:9, continent:"Europe" },
    { name:"Italy", iso:"IT", flag:"🇮🇹", dial_code:"+39", min_digits:9, max_digits:10, continent:"Europe" },
    { name:"Spain", iso:"ES", flag:"🇪🇸", dial_code:"+34", min_digits:9, max_digits:9, continent:"Europe" },
    { name:"Portugal", iso:"PT", flag:"🇵🇹", dial_code:"+351", min_digits:9, max_digits:9, continent:"Europe" },
    { name:"Netherlands", iso:"NL", flag:"🇳🇱", dial_code:"+31", min_digits:9, max_digits:9, continent:"Europe" },
    { name:"Belgium", iso:"BE", flag:"🇧🇪", dial_code:"+32", min_digits:9, max_digits:9, continent:"Europe" },
    { name:"Switzerland", iso:"CH", flag:"🇨🇭", dial_code:"+41", min_digits:9, max_digits:9, continent:"Europe" },
    { name:"Sweden", iso:"SE", flag:"🇸🇪", dial_code:"+46", min_digits:9, max_digits:9, continent:"Europe" },
    { name:"Norway", iso:"NO", flag:"🇳🇴", dial_code:"+47", min_digits:8, max_digits:8, continent:"Europe" },
    { name:"Poland", iso:"PL", flag:"🇵🇱", dial_code:"+48", min_digits:9, max_digits:9, continent:"Europe" },
    { name:"Ireland", iso:"IE", flag:"🇮🇪", dial_code:"+353", min_digits:9, max_digits:9, continent:"Europe" },
    { name:"Greece", iso:"GR", flag:"🇬🇷", dial_code:"+30", min_digits:10, max_digits:10, continent:"Europe" },
    { name:"Russia", iso:"RU", flag:"🇷🇺", dial_code:"+7", min_digits:10, max_digits:10, continent:"Europe" },

    // ==========================
    // AMERICAS
    // ==========================

    { name:"United States", iso:"US", flag:"🇺🇸", dial_code:"+1", min_digits:10, max_digits:10, continent:"Americas" },
    { name:"Canada", iso:"CA", flag:"🇨🇦", dial_code:"+1", min_digits:10, max_digits:10, continent:"Americas" },
    { name:"Brazil", iso:"BR", flag:"🇧🇷", dial_code:"+55", min_digits:10, max_digits:11, continent:"Americas" },
    { name:"Mexico", iso:"MX", flag:"🇲🇽", dial_code:"+52", min_digits:10, max_digits:10, continent:"Americas" },
    { name:"Argentina", iso:"AR", flag:"🇦🇷", dial_code:"+54", min_digits:10, max_digits:10, continent:"Americas" },
    { name:"Colombia", iso:"CO", flag:"🇨🇴", dial_code:"+57", min_digits:10, max_digits:10, continent:"Americas" },
    { name:"Chile", iso:"CL", flag:"🇨🇱", dial_code:"+56", min_digits:9, max_digits:9, continent:"Americas" },
    { name:"Peru", iso:"PE", flag:"🇵🇪", dial_code:"+51", min_digits:9, max_digits:9, continent:"Americas" },
    { name:"Jamaica", iso:"JM", flag:"🇯🇲", dial_code:"+1876", min_digits:7, max_digits:7, continent:"Americas" },
    { name:"Trinidad and Tobago", iso:"TT", flag:"🇹🇹", dial_code:"+1868", min_digits:7, max_digits:7, continent:"Americas" },
    { name:"Venezuela", iso:"VE", flag:"🇻🇪", dial_code:"+58", min_digits:10, max_digits:10, continent:"Americas" },
    { name:"Ecuador", iso:"EC", flag:"🇪🇨", dial_code:"+593", min_digits:9, max_digits:9, continent:"Americas" },
    { name:"Cuba", iso:"CU", flag:"🇨🇺", dial_code:"+53", min_digits:8, max_digits:8, continent:"Americas" },
    { name:"Dominican Republic", iso:"DO", flag:"🇩🇴", dial_code:"+1809", min_digits:7, max_digits:7, continent:"Americas" },
    { name:"Haiti", iso:"HT", flag:"🇭🇹", dial_code:"+509", min_digits:8, max_digits:8, continent:"Americas" },

    // ==========================
    // ASIA
    // ==========================

    { name:"India", iso:"IN", flag:"🇮🇳", dial_code:"+91", min_digits:10, max_digits:10, continent:"Asia" },
    { name:"China", iso:"CN", flag:"🇨🇳", dial_code:"+86", min_digits:11, max_digits:11, continent:"Asia" },
    { name:"Japan", iso:"JP", flag:"🇯🇵", dial_code:"+81", min_digits:10, max_digits:10, continent:"Asia" },
    { name:"South Korea", iso:"KR", flag:"🇰🇷", dial_code:"+82", min_digits:9, max_digits:10, continent:"Asia" },
    { name:"Indonesia", iso:"ID", flag:"🇮🇩", dial_code:"+62", min_digits:9, max_digits:11, continent:"Asia" },
    { name:"Pakistan", iso:"PK", flag:"🇵🇰", dial_code:"+92", min_digits:10, max_digits:10, continent:"Asia" },
    { name:"Bangladesh", iso:"BD", flag:"🇧🇩", dial_code:"+880", min_digits:10, max_digits:10, continent:"Asia" },
    { name:"Philippines", iso:"PH", flag:"🇵🇭", dial_code:"+63", min_digits:10, max_digits:10, continent:"Asia" },
    { name:"Vietnam", iso:"VN", flag:"🇻🇳", dial_code:"+84", min_digits:9, max_digits:10, continent:"Asia" },
    { name:"Thailand", iso:"TH", flag:"🇹🇭", dial_code:"+66", min_digits:9, max_digits:9, continent:"Asia" },
    { name:"Saudi Arabia", iso:"SA", flag:"🇸🇦", dial_code:"+966", min_digits:9, max_digits:9, continent:"Asia" },
    { name:"United Arab Emirates", iso:"AE", flag:"🇦🇪", dial_code:"+971", min_digits:9, max_digits:9, continent:"Asia" },
    { name:"Turkey", iso:"TR", flag:"🇹🇷", dial_code:"+90", min_digits:10, max_digits:10, continent:"Asia" },
    { name:"Malaysia", iso:"MY", flag:"🇲🇾", dial_code:"+60", min_digits:9, max_digits:10, continent:"Asia" },
    { name:"Israel", iso:"IL", flag:"🇮🇱", dial_code:"+972", min_digits:9, max_digits:9, continent:"Asia" },

    // ==========================
    // OCEANIA
    // ==========================

    { name:"Australia", iso:"AU", flag:"🇦🇺", dial_code:"+61", min_digits:9, max_digits:9, continent:"Oceania" },
    { name:"New Zealand", iso:"NZ", flag:"🇳🇿", dial_code:"+64", min_digits:8, max_digits:9, continent:"Oceania" },
    { name:"Fiji", iso:"FJ", flag:"🇫🇯", dial_code:"+679", min_digits:7, max_digits:7, continent:"Oceania" },
    { name:"Papua New Guinea", iso:"PG", flag:"🇵🇬", dial_code:"+675", min_digits:8, max_digits:8, continent:"Oceania" },
    { name:"Samoa", iso:"WS", flag:"🇼🇸", dial_code:"+685", min_digits:7, max_digits:7, continent:"Oceania" },
    { name:"Tonga", iso:"TO", flag:"🇹🇴", dial_code:"+676", min_digits:7, max_digits:7, continent:"Oceania" },
    { name:"Vanuatu", iso:"VU", flag:"🇻🇺", dial_code:"+678", min_digits:7, max_digits:7, continent:"Oceania" },
    { name:"Solomon Islands", iso:"SB", flag:"🇸🇧", dial_code:"+677", min_digits:7, max_digits:7, continent:"Oceania" },
    { name:"Kiribati", iso:"KI", flag:"🇰🇮", dial_code:"+686", min_digits:8, max_digits:8, continent:"Oceania" },
    { name:"Palau", iso:"PW", flag:"🇵🇼", dial_code:"+680", min_digits:7, max_digits:7, continent:"Oceania" },
    { name:"Micronesia", iso:"FM", flag:"🇫🇲", dial_code:"+691", min_digits:7, max_digits:7, continent:"Oceania" },
    { name:"Marshall Islands", iso:"MH", flag:"🇲🇭", dial_code:"+692", min_digits:7, max_digits:7, continent:"Oceania" },
    { name:"Nauru", iso:"NR", flag:"🇳🇷", dial_code:"+674", min_digits:7, max_digits:7, continent:"Oceania" },
    { name:"Tuvalu", iso:"TV", flag:"🇹🇻", dial_code:"+688", min_digits:6, max_digits:6, continent:"Oceania" },
    { name:"Cook Islands", iso:"CK", flag:"🇨🇰", dial_code:"+682", min_digits:5, max_digits:5, continent:"Oceania" },

];


// ==========================================
// CONTINENT DROPDOWN (feeds into Country dropdown)
// ==========================================

function loadContinentDropdown() {
    const continentSelect = document.getElementById("continent");
    if (!continentSelect) return;

    const continents = [...new Set(countries.map(c => c.continent))];
    continents.forEach(cont => {
        const opt = document.createElement("option");
        opt.value = cont;
        opt.textContent = cont;
        continentSelect.appendChild(opt);
    });

    continentSelect.addEventListener("change", () => {
        loadCountryDropdowns(continentSelect.value);
    });
}


// ==========================================
// LOAD COUNTRY DROPDOWNS (optionally filtered by continent)
// ==========================================

function loadCountryDropdowns(filterContinent) {
    const countryCodeSelect = document.getElementById("country-code");
    const countrySelect = document.getElementById("country");

    if (!countryCodeSelect || !countrySelect) return;

    countryCodeSelect.innerHTML = "";
    countrySelect.innerHTML = '<option value="">Select Country</option>';

    const list = filterContinent ? countries.filter(c => c.continent === filterContinent) : countries;

    list.forEach(country => {
        const codeOption = document.createElement("option");
        codeOption.value = country.iso;
        codeOption.textContent = `${country.flag} ${country.dial_code}`;
        countryCodeSelect.appendChild(codeOption);

        const countryOption = document.createElement("option");
        countryOption.value = country.iso;
        countryOption.textContent = `${country.flag} ${country.name}`;
        countrySelect.appendChild(countryOption);
    });

    // Keep the two selects in sync — picking a country updates the code, and vice versa
    countrySelect.onchange = () => { countryCodeSelect.value = countrySelect.value; };
    countryCodeSelect.onchange = () => { countrySelect.value = countryCodeSelect.value; };
}


// ==========================================
// GET COUNTRY
// ==========================================

function getCountryByISO(iso) {
    return countries.find(country => country.iso === iso);
}


// ==========================================
// PHONE VALIDATION
// ==========================================

function validatePhoneNumber(iso, phone) {
    const country = getCountryByISO(iso);
    if (!country) return false;

    const digits = phone.replace(/\D/g, "");
    return digits.length >= country.min_digits && digits.length <= country.max_digits;
}


// ==========================================
// REMOVE + FOR INTERNAL ID
// ==========================================

function cleanDialCode(dialCode) {
    return dialCode.replace("+", "");
}


// ==========================================
// START COUNTRY SYSTEM
// ==========================================

window.addEventListener("load", () => {
    loadContinentDropdown();
    loadCountryDropdowns();
});
