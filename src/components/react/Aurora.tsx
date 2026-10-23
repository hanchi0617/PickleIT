import { useEffect, useRef, useState } from 'react';
import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';

// Aurora background in the style of React Bits' <Aurora />, extended so it
// reacts to the pointer:
//  - a soft glow follows the cursor everywhere
//  - hovering any element with [data-aurora-boost] makes the aurora swell,
//    ripple near the cursor and shift its colours (value = strength, 0-1)
//  - on touch screens a tap triggers the same swell, then it settles
// Falls back to a static CSS gradient when WebGL2 is unavailable, and renders
// a single still frame when the user prefers reduced motion.

const VERT = /* glsl */ `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;
uniform vec2 uMouse;
uniform float uHover;

out vec4 fragColor;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.5) return mix(uColorStops[0], uColorStops[1], t * 2.0);
  return mix(uColorStops[1], uColorStops[2], (t - 0.5) * 2.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;

  vec2 d = (uv - uMouse) * vec2(aspect, 1.0);
  float near = exp(-dot(d, d) * 5.0);

  vec3 rampColor = ramp(uv.x + (uMouse.x - 0.5) * 0.35 * uHover);

  float amp = uAmplitude * (1.0 + uHover * 0.7);
  float n = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25));
  n += near * uHover * 0.9 * sin(uTime * 2.0 + uv.x * 9.0);

  float height = exp(n * 0.5 * amp);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float alpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);
  vec3 color = intensity * rampColor;

  float glow = near * (0.10 + 0.32 * uHover);
  color += rampColor * glow;
  alpha = clamp(alpha + glow, 0.0, 1.0);

  fragColor = vec4(color * alpha, alpha);
}
`;

interface AuroraProps {
  colorStops?: string[];
  amplitude?: number;
  blend?: number;
  speed?: number;
}

export default function Aurora({
  colorStops = ['#00e5a0', '#7cff67', '#00b8a9'],
  amplitude = 1.0,
  blend = 0.5,
  speed = 1.0,
}: AuroraProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        // Phones get a lower pixel ratio: the aurora is soft, so it looks the
        // same and saves a lot of battery.
        dpr: Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.5),
      });
      if (!renderer.isWebgl2) throw new Error('WebGL2 unavailable');
    } catch {
      setFallback(true);
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';
    gl.canvas.style.display = 'block';

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) delete (geometry.attributes as Record<string, unknown>).uv;

    const toVec3 = (hex: string) => {
      const c = new Color(hex);
      return [c.r, c.g, c.b];
    };

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: colorStops.map(toVec3) },
        uResolution: { value: [container.offsetWidth, container.offsetHeight] },
        uBlend: { value: blend },
        uMouse: { value: [0.5, 0.8] },
        uHover: { value: 0 },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    container.appendChild(gl.canvas);

    const resize = () => {
      const w = container.offsetWidth;
      const h = container.offsetHeight;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    };
    window.addEventListener('resize', resize);
    resize();

    // Pointer + hover state, eased every frame.
    const mouse = { x: 0.5, y: 0.8, tx: 0.5, ty: 0.8 };
    let hover = 0;
    let hoverTarget = 0;
    let tapUntil = 0;

    const onMove = (e: PointerEvent) => {
      mouse.tx = e.clientX / window.innerWidth;
      mouse.ty = 1 - e.clientY / window.innerHeight;
    };
    const onOver = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>('[data-aurora-boost]');
      hoverTarget = el ? Number(el.dataset.auroraBoost || 1) || 1 : 0;
    };
    const onDown = (e: PointerEvent) => {
      onMove(e);
      if (e.pointerType !== 'mouse') {
        mouse.x = mouse.tx;
        mouse.y = mouse.ty;
        tapUntil = performance.now() + 1200;
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerover', onOver, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt * speed;

      const target = Math.max(hoverTarget, now < tapUntil ? 1 : 0);
      const k = 1 - Math.pow(0.001, dt);
      hover += (target - hover) * k * 0.9;
      mouse.x += (mouse.tx - mouse.x) * k;
      mouse.y += (mouse.ty - mouse.y) * k;

      program.uniforms.uTime.value = elapsed;
      program.uniforms.uHover.value = hover;
      program.uniforms.uMouse.value = [mouse.x, mouse.y];
      renderer.render({ scene: mesh });
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduceMotion) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    if (reduceMotion) {
      program.uniforms.uTime.value = 12;
      renderer.render({ scene: mesh });
    } else {
      raf = requestAnimationFrame(frame);
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerdown', onDown);
      document.removeEventListener('visibilitychange', onVisibility);
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [amplitude, blend, speed, colorStops.join(',')]);

  if (fallback) {
    return (
      <div
        className="h-full w-full"
        style={{
          background: `radial-gradient(120% 60% at 30% 0%, ${colorStops[0]}55, transparent 60%),
            radial-gradient(100% 50% at 75% 0%, ${colorStops[1]}44, transparent 60%)`,
        }}
      />
    );
  }

  return <div ref={ref} className="h-full w-full" />;
}
