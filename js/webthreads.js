const WebThreads = (() => {
  let canvas, ctx, animationId;
  let threads = [];
  let mouse = { x: -9999, y: -9999 };
  let config = {
    color1: '#5227FF',
    color2: '#FF9FFC',
    color3: '#FFFFFF',
    speed: 0.2,
    mouseInteraction: true,
    threadCount: 12,
    lineWidth: 1.4,
    amplitude: 60
  };

  function isMobileViewport() {
    return window.innerWidth <= 390;
  }

  function resolveThreadCount() {
    // Mobile-first: reduce a 4 hebras en viewports iPhone (375-390px)
    return isMobileViewport() ? 4 : config.threadCount;
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function lerpColor(c1, c2, t) {
    const p1 = c1.replace('#', ''), p2 = c2.replace('#', '');
    const r1 = parseInt(p1.substring(0, 2), 16), g1 = parseInt(p1.substring(2, 4), 16), b1 = parseInt(p1.substring(4, 6), 16);
    const r2 = parseInt(p2.substring(0, 2), 16), g2 = parseInt(p2.substring(2, 4), 16), b2 = parseInt(p2.substring(4, 6), 16);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  }

  function createThreads() {
    const count = resolveThreadCount();
    threads = [];
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      threads.push({
        offsetY: (canvas.height / (count + 1)) * (i + 1),
        phase: Math.random() * Math.PI * 2,
        freq: 0.002 + Math.random() * 0.0015,
        amp: config.amplitude * (0.6 + Math.random() * 0.8),
        colorMix: t,
        speedMod: 0.7 + Math.random() * 0.6
      });
    }
  }

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    createThreads();
  }

  function drawThread(thread, time) {
    const points = [];
    const step = 8;
    for (let x = 0; x <= canvas.width; x += step) {
      const distToMouse = config.mouseInteraction
        ? Math.max(0, 1 - Math.abs(x - mouse.x) / 220)
        : 0;
      const mouseInfluence = distToMouse * 30;

      const y = thread.offsetY +
        Math.sin(x * thread.freq + thread.phase + time * config.speed * thread.speedMod) * thread.amp +
        (config.mouseInteraction ? Math.sin((x - mouse.x) * 0.01) * mouseInfluence : 0);

      points.push({ x, y });
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }

    const colorA = thread.colorMix < 0.5
      ? lerpColor(config.color1, config.color3, thread.colorMix * 2)
      : lerpColor(config.color3, config.color2, (thread.colorMix - 0.5) * 2);

    ctx.strokeStyle = hexToRgba(
      '#' + [colorA.match(/\d+/g)].flat().map(n => Number(n).toString(16).padStart(2, '0')).join(''),
      0.55
    );
    ctx.lineWidth = config.lineWidth;
    ctx.shadowBlur = 8;
    ctx.shadowColor = colorA;
    ctx.stroke();
  }

  function animate(timestamp) {
    ctx.fillStyle = '#0a0118';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const time = timestamp * 0.001;
    threads.forEach(thread => drawThread(thread, time));

    animationId = requestAnimationFrame(animate);
  }

  function handleMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }

  function handleResize() {
    resizeCanvas();
  }

  function init(userConfig = {}) {
    canvas = document.getElementById('webthreads-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    config = { ...config, ...userConfig };
    resizeCanvas();

    if (config.mouseInteraction) {
      window.addEventListener('mousemove', handleMouseMove);
    }
    window.addEventListener('resize', handleResize);

    if (animationId) cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(animate);
  }

  function destroy() {
    if (animationId) cancelAnimationFrame(animationId);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('resize', handleResize);
  }

  return { init, destroy };
})();

window.WebThreads = WebThreads;

// ── Inicialización con los props solicitados ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window.WebThreads.init({
    color1: '#5227FF',
    color2: '#FF9FFC',
    color3: '#FFFFFF',
    speed: 0.2,
    mouseInteraction: true,
    threadCount: 12,   // se reduce a 4 automáticamente en viewports ≤390px
    lineWidth: 1.4,
    amplitude: 60
  });
});