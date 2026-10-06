// ==========================================
// HI-MATE MESSENGER
// particles.js — canvas particle network background
// ==========================================

(function () {
    const canvas = document.getElementById("network-bg");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let particles = [];
    const PARTICLE_COUNT = 45;

    const CLASSIC_COLORS = ["#00E5FF", "#A855F7"];
    const NETWORK_COLORS = ["#FFFFFF", "#34C759"];

    function isNetworkMode() {
        return document.body.classList.contains("background-network");
    }

    function getParticleColors() {
        return isNetworkMode()
            ? NETWORK_COLORS
            : CLASSIC_COLORS;
    }

    function setBackgroundMode(mode) {
        const body = document.body;

        body.classList.remove(
            "background-classic",
            "background-network"
        );

        if (mode === "network") {
            body.classList.add("background-network");
        } else {
            mode = "classic";
            body.classList.add("background-classic");
        }

        localStorage.setItem(
            "himate_background_mode",
            mode
        );

        createParticles();
    }

    function applyStoredBackgroundMode() {
        const saved =
            localStorage.getItem("himate_background_mode") || "classic";

        setBackgroundMode(saved);
    }

    window.setHiMateBackgroundMode = setBackgroundMode;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function createParticles() {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                radius: Math.random() * 1.8 + 0.6,
                color: (() => {
                    const colors = getParticleColors();
                    return colors[Math.floor(Math.random() * colors.length)];
                })(),
            });
        }
    }

    function step() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.7;
            ctx.fill();
        });

        // connective lines between nearby particles
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 110) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = isNetworkMode()
                        ? "rgba(255,255,255,0.16)"
                        : "rgba(0,229,255,0.08)";
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        ctx.globalAlpha = 1;
        requestAnimationFrame(step);
    }

    window.addEventListener("resize", () => {
        resize();
        createParticles();
    });

    resize();

    const savedMode =
        localStorage.getItem("himate_background_mode") || "classic";

    document.body.classList.remove(
        "background-classic",
        "background-network"
    );

    document.body.classList.add(
        savedMode === "network"
            ? "background-network"
            : "background-classic"
    );

    createParticles();
    step();
})();
