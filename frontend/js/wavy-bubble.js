function buildBlobSVG() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 200 200");
    svg.setAttribute("class", "wavy-bubble-svg");

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const gradId = "wavyGrad" + Math.floor(Math.random() * 100000);
    defs.innerHTML = `
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#00E5FF" stop-opacity="0.35" />
        <stop offset="100%" stop-color="#A855F7" stop-opacity="0.35" />
      </linearGradient>
    `;
    svg.appendChild(defs);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", `url(#${gradId})`);
    svg.appendChild(path);
    return { svg, path };
}

function pointsToSmoothPath(points) {
    if (!points.length) return "";
    let d = `M ${points[0].x} ${points[0].y} `;
    for (let i = 0; i < points.length; i++) {
        const p0 = points[i];
        const p1 = points[(i + 1) % points.length];
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        d += `Q ${p0.x} ${p0.y} ${mx} ${my} `;
    }
    d += "Z";
    return d;
}

export function attachWavyBubble(containerEl, options = {}) {
    if (!containerEl) return;
    const numPoints = options.numPoints || 10;
    const baseRadius = options.baseRadius || 80;
    const waveAmplitude = options.waveAmplitude || 12;
    const speed = options.speed || 0.0015;

    const wrapper = document.createElement("div");
    wrapper.className = "wavy-bubble-wrapper";
    const built = buildBlobSVG();
    wrapper.appendChild(built.svg);
    containerEl.insertBefore(wrapper, containerEl.firstChild);

    const angleStep = (Math.PI * 2) / numPoints;
    const phaseOffsets = [];
    for (let i = 0; i < numPoints; i++) phaseOffsets.push(Math.random() * 1000);

    function render(time) {
        const points = [];
        for (let i = 0; i < numPoints; i++) {
            const angle = i * angleStep;
            const wobble = Math.sin(time * speed + phaseOffsets[i]) * waveAmplitude;
            const r = baseRadius + wobble;
            points.push({
                x: 100 + Math.cos(angle) * r,
                y: 100 + Math.sin(angle) * r,
            });
        }
        built.path.setAttribute("d", pointsToSmoothPath(points));
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}
