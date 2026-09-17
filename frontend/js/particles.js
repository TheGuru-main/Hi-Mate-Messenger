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
    const COLORS = ["#00E5FF", "#A855F7"];

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
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
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
                    ctx.strokeStyle = "rgba(0,229,255,0.08)";
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
    createParticles();
    step();
})();
