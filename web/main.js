import * as THREE from "three";
const AU = 5.0;
const TAU = Math.PI * 2;
const DEG2RAD = Math.PI / 180;

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b1220, 0.0016);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 10, 40);
camera.rotation.order = "YXZ";

const lookState = {
  yaw: 0,
  pitch: 0,
  sensitivity: 0.0025,
  locked: false,
};

const REAL_SIZE_FACTOR = 0.05;
let sizeScale = 1.0;

const textureLoader = new THREE.TextureLoader();
const loadTexture = (path) => {
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
};

const makeRingGeometry = (innerRadius, outerRadius, segments = 128) => {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * TAU;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const innerX = cosT * innerRadius;
    const innerZ = sinT * innerRadius;
    const outerX = cosT * outerRadius;
    const outerZ = sinT * outerRadius;

    positions.push(innerX, 0, innerZ);
    positions.push(outerX, 0, outerZ);

    const v = i / segments;
    // Map texture radially (u) and wrap once around the ring (v).
    uvs.push(0, v);
    uvs.push(1, v);
  }

  for (let i = 0; i < segments; i += 1) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

// Background star sphere (far skybox)
const starfield = (() => {
  const geometry = new THREE.SphereGeometry(1400, 64, 64);
  const material = new THREE.MeshBasicMaterial({
    map: loadTexture("./assets/textures/8k_stars_milky_way.jpg"),
    side: THREE.BackSide,
    color: 0x8899bb,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  return mesh;
})();

// 3-D Milky Way particle system
const milkyWay = (() => {
  const rng = (() => {
    let s = 0x9e3779b9;
    return () => {
      s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
      s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
      return (s >>> 0) / 0xffffffff;
    };
  })();

  const gaussRng = () => {
    const u = 1 - rng();
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };

  // Particle counts per component
  const N_DISK = 28000;
  const N_ARMS = 22000;
  const N_BULGE = 8000;
  const N_HALO = 4000;
  const TOTAL = N_DISK + N_ARMS + N_BULGE + N_HALO;

  const positions = new Float32Array(TOTAL * 3);
  const colors = new Float32Array(TOTAL * 3);
  const sizes = new Float32Array(TOTAL);

  // Galaxy geometry constants (scene units — starfield is r=1400, solar system ~r=200)
  const DISK_R = 620;   // outer disk radius
  const DISK_H = 28;    // disk scale height
  const BULGE_R = 80;   // bulge radius
  const HALO_R = 700;   // stellar halo

  // Tilt the galaxy plane relative to the ecliptic (63° — roughly correct)
  const GALAXY_TILT = 63 * DEG2RAD;

  // Place solar system inside the disk, offset from center
  const SOLAR_OFFSET_R = 260; // ~26 kly from galactic center in scene units

  let idx = 0;

  const setParticle = (x, y, z, r, g, b, size) => {
    // Apply solar offset so the solar system is not at galactic center
    const px = x + SOLAR_OFFSET_R;
    // Apply galaxy tilt (rotate around X axis)
    const cosT = Math.cos(GALAXY_TILT);
    const sinT = Math.sin(GALAXY_TILT);
    positions[idx * 3]     = px;
    positions[idx * 3 + 1] = y * cosT - z * sinT;
    positions[idx * 3 + 2] = y * sinT + z * cosT;
    colors[idx * 3]     = r;
    colors[idx * 3 + 1] = g;
    colors[idx * 3 + 2] = b;
    sizes[idx] = size;
    idx++;
  };

  // --- Thin disk stars: blueish-white, exponential radial profile ---
  for (let i = 0; i < N_DISK; i++) {
    const r = DISK_R * Math.pow(rng(), 0.55);
    const theta = rng() * TAU;
    const h = gaussRng() * DISK_H;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    // Mix cool and hot disk stars
    const t = rng();
    const [cr, cg, cb] = t < 0.5
      ? [0.80 + rng() * 0.20, 0.85 + rng() * 0.15, 1.0]          // blue-white
      : [1.0, 0.90 + rng() * 0.10, 0.70 + rng() * 0.20];           // warm yellow
    const brightness = 0.4 + rng() * 0.6;
    setParticle(x, h, z, cr * brightness, cg * brightness, cb * brightness, 0.8 + rng() * 1.2);
  }

  // --- Spiral arms: 4 arms with logarithmic spiral + dust lane color ---
  const NUM_ARMS = 4;
  const ARM_PITCH = 0.22; // radians of pitch angle
  for (let i = 0; i < N_ARMS; i++) {
    const armIndex = Math.floor(rng() * NUM_ARMS);
    const armOffset = (armIndex / NUM_ARMS) * TAU;

    // Logarithmic spiral: r = r0 * e^(b*theta)
    const theta0 = rng() * TAU * 1.8; // how far around the spiral
    const r = 60 + (DISK_R - 60) * (theta0 / (TAU * 1.8));
    const spiralTheta = armOffset + theta0 + ARM_PITCH * Math.log(r / 60 + 1);

    // Add scatter perpendicular to arm
    const scatter = gaussRng() * (r * 0.10 + 12);
    const scatterTheta = spiralTheta + (scatter / r);
    const finalR = r + Math.abs(gaussRng()) * 15;

    const x = Math.cos(scatterTheta) * finalR;
    const z = Math.sin(scatterTheta) * finalR;
    const h = gaussRng() * (DISK_H * 0.6);

    // Arms are bluer/brighter (young hot stars and nebulae)
    const nebula = rng() < 0.12; // occasional reddish nebula patch
    const [cr, cg, cb] = nebula
      ? [0.9 + rng() * 0.1, 0.4 + rng() * 0.3, 0.5 + rng() * 0.3]
      : [0.6 + rng() * 0.4, 0.75 + rng() * 0.25, 1.0];
    const brightness = 0.5 + rng() * 0.5;
    setParticle(x, h, z, cr * brightness, cg * brightness, cb * brightness, 1.0 + rng() * 1.6);
  }

  // --- Central bulge: dense yellowish-orange spheroid ---
  for (let i = 0; i < N_BULGE; i++) {
    const r = BULGE_R * Math.pow(rng(), 0.4);
    const theta = rng() * TAU;
    const phi = Math.acos(2 * rng() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi) * 0.55; // oblate
    const z = r * Math.sin(phi) * Math.sin(theta);
    const brightness = 0.6 + rng() * 0.4;
    setParticle(x, y, z, 1.0 * brightness, 0.80 * brightness, 0.55 * brightness, 1.2 + rng() * 2.0);
  }

  // --- Stellar halo: sparse, metal-poor blue-white stars ---
  for (let i = 0; i < N_HALO; i++) {
    const r = BULGE_R + (HALO_R - BULGE_R) * Math.pow(rng(), 0.7);
    const theta = rng() * TAU;
    const phi = Math.acos(2 * rng() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi) * 0.45;
    const z = r * Math.sin(phi) * Math.sin(theta);
    const brightness = 0.2 + rng() * 0.35;
    setParticle(x, y, z, 0.75 * brightness, 0.85 * brightness, 1.0 * brightness, 0.5 + rng() * 0.8);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexColors: true,
    vertexShader: /* glsl */`
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (300.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = 1.0 - smoothstep(0.0, 1.0, d);
        alpha = pow(alpha, 1.6);
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(vColor, alpha * 0.85);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.renderOrder = -10;
  scene.add(points);
  return points;
})();

const sunLight = new THREE.PointLight(0xfff1da, 28.0, 0, 2);
scene.add(sunLight);

const ambient = new THREE.AmbientLight(0x2a3144, 1.4);
scene.add(ambient);

const fillLight = new THREE.DirectionalLight(0xa7b6cc, 0.85);
fillLight.position.set(-40, 20, -20);
scene.add(fillLight);

class Body {
  constructor(options) {
    this.name = options.name;
    this.radius = options.radius;
    this.visualScale = options.visualScale ?? 1.0;
    this.baseSize = this.radius * this.visualScale;
    this.size = this.baseSize * sizeScale;
    this.orbitRadiusAu = options.orbitRadiusAu ?? 0.0;
    this.orbitEccentricity = options.orbitEccentricity ?? 0.0;
    this.orbitInclinationDeg = options.orbitInclinationDeg ?? 0.0;
    this.orbitPeriodDays = options.orbitPeriodDays ?? null;
    this.rotationPeriodDays = options.rotationPeriodDays ?? null;
    this.orbitParent = options.orbitParent ?? null;
    this.elements = options.elements ?? null;
    this.tidallyLocked = options.tidallyLocked ?? false;
    this.showLockMarker = options.showLockMarker ?? false;

    const geometry = new THREE.SphereGeometry(this.baseSize, 32, 20);
    const materialOptions = {};
    if (options.texture) {
      materialOptions.map = loadTexture(options.texture);
      materialOptions.color = 0xffffff;
    } else {
      materialOptions.color = options.color ?? 0xffffff;
    }
    let material;
    if (this.name === "Sun") {
      materialOptions.color = 0xffffff;
      materialOptions.map = loadTexture(options.texture);
      material = new THREE.MeshBasicMaterial(materialOptions);
    } else {
      materialOptions.roughness = 1.0;
      materialOptions.metalness = 0.0;
      material = new THREE.MeshStandardMaterial(materialOptions);
    }
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.scale.setScalar(sizeScale);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    this.orbitRadius = this.orbitRadiusAu * AU;
    if (this.orbitParent) {
      const minOrbit = this.orbitParent.size + this.size * 1.6;
      this.orbitRadius = Math.max(this.orbitRadius, minOrbit);
    }

    this.orbitAngle = 0.0;
    this.spinAngle = 0.0;

    if (this.tidallyLocked && this.showLockMarker) {
      const markerGeometry = new THREE.SphereGeometry(this.radius * this.visualScale * 0.25, 16, 12);
      const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x808080 });
      this.marker = new THREE.Mesh(markerGeometry, markerMaterial);
      this.marker.position.set(0, 0, this.radius * this.visualScale);
      this.mesh.add(this.marker);
    }
  }

  step(dtDays, jd) {
    if (this.elements && this.orbitParent && jd !== null) {
      updateOrbitFromElements(this, jd);
    } else if (this.orbitParent && this.orbitPeriodDays) {
      this.orbitAngle += TAU * (dtDays / this.orbitPeriodDays);
      const meanAnomaly = this.orbitAngle % TAU;
      const e = this.orbitEccentricity;
      let E = meanAnomaly;
      for (let i = 0; i < 5; i += 1) {
        E -= (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
      }
      const x = this.orbitRadius * (Math.cos(E) - e);
      const z = this.orbitRadius * Math.sqrt(1 - e * e) * Math.sin(E);
      const pos = new THREE.Vector3(x, 0, z);
      if (this.orbitInclinationDeg) {
        const inc = this.orbitInclinationDeg * DEG2RAD;
        pos.set(pos.x, pos.z * Math.sin(inc), pos.z * Math.cos(inc));
      }
      this.mesh.position.copy(this.orbitParent.mesh.position).add(pos);
    }

    if (this.tidallyLocked && this.orbitParent) {
      this.mesh.lookAt(this.orbitParent.mesh.position);
    } else if (this.rotationPeriodDays) {
      this.spinAngle += TAU * (dtDays / this.rotationPeriodDays);
      this.mesh.rotation.y = this.spinAngle;
    }
  }
}

const julianDate = (date) => {
  const dt = new Date(date);
  const year = dt.getUTCFullYear();
  let month = dt.getUTCMonth() + 1;
  const day = dt.getUTCDate();
  const hour =
    dt.getUTCHours() +
    dt.getUTCMinutes() / 60 +
    dt.getUTCSeconds() / 3600 +
    dt.getUTCMilliseconds() / 3_600_000;

  let y = year;
  if (month <= 2) {
    y -= 1;
    month += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  const jd =
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    B -
    1524.5 +
    hour / 24;
  return jd;
};

let timeScale = 12.0;
const timeScaleDefault = 12.0;
let paused = false;
let simJd = julianDate(Date.UTC(2026, 0, 16));
const clock = new THREE.Clock();

const updateOrbitFromElements = (body, jd) => {
  const elements = body.elements;
  const T = (jd - 2451545.0) / 36525.0;
  const a = (elements.a + elements.a_dot * T) * AU;
  const e = elements.e + elements.e_dot * T;
  const i = (elements.i + elements.i_dot * T) * DEG2RAD;
  const Omega = (elements.Omega + elements.Omega_dot * T) * DEG2RAD;
  const w = (elements.w + elements.w_dot * T) * DEG2RAD;
  const M = ((elements.M + elements.M_dot * T) * DEG2RAD) % TAU;

  let E = M;
  for (let iStep = 0; iStep < 6; iStep += 1) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  const xPrime = a * (Math.cos(E) - e);
  const yPrime = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cosO = Math.cos(Omega);
  const sinO = Math.sin(Omega);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);

  const x = (cosO * cosW - sinO * sinW * cosI) * xPrime + (-cosO * sinW - sinO * cosW * cosI) * yPrime;
  const y = (sinO * cosW + cosO * sinW * cosI) * xPrime + (-sinO * sinW + cosO * cosW * cosI) * yPrime;
  const z = sinW * sinI * xPrime + cosW * sinI * yPrime;

  const pos = new THREE.Vector3(x, z, y);
  const minOrbit = body.orbitParent.size + body.size * 1.2;
  if (pos.length() < minOrbit) {
    pos.normalize().multiplyScalar(minOrbit);
  }
  body.mesh.position.copy(body.orbitParent.mesh.position).add(pos);
};

const makeOrbitPath = (elements, minOrbit = 0, segments = 128) => {
  const vertices = [];
  const T = (simJd - 2451545.0) / 36525.0;
  const a = (elements.a + elements.a_dot * T) * AU;
  const e = elements.e + elements.e_dot * T;
  const i = (elements.i + elements.i_dot * T) * DEG2RAD;
  const Omega = (elements.Omega + elements.Omega_dot * T) * DEG2RAD;
  const w = (elements.w + elements.w_dot * T) * DEG2RAD;

  const cosO = Math.cos(Omega);
  const sinO = Math.sin(Omega);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);

  for (let s = 0; s <= segments; s += 1) {
    const M = (TAU * s) / segments;
    let E = M;
    for (let iStep = 0; iStep < 6; iStep += 1) {
      E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    }
    const xPrime = a * (Math.cos(E) - e);
    const yPrime = a * Math.sqrt(1 - e * e) * Math.sin(E);

    const x = (cosO * cosW - sinO * sinW * cosI) * xPrime + (-cosO * sinW - sinO * cosW * cosI) * yPrime;
    const y = (sinO * cosW + cosO * sinW * cosI) * xPrime + (-sinO * sinW + cosO * cosW * cosI) * yPrime;
    const z = sinW * sinI * xPrime + cosW * sinI * yPrime;
    const pos = new THREE.Vector3(x, z, y);
    if (minOrbit > 0 && pos.length() < minOrbit) {
      pos.normalize().multiplyScalar(minOrbit);
    }
    vertices.push(pos);
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
  return geometry;
};

const sun = new Body({
  name: "Sun",
  radius: 1.8,
  color: 0xffc857,
  texture: "./assets/textures/2k_sun.jpg",
  rotationPeriodDays: 25.0,
});

sunLight.position.copy(sun.mesh.position);

const planets = [
  new Body({
    name: "Mercury",
    radius: 0.18,
    orbitRadiusAu: 0.387,
    orbitEccentricity: 0.206,
    orbitPeriodDays: 88.0,
    rotationPeriodDays: 58.65,
    orbitParent: sun,
    color: 0xb4aaa0,
    texture: "./assets/textures/2k_mercury.jpg",
    elements: {
      a: 0.38709927,
      a_dot: 0.00000037,
      e: 0.20563593,
      e_dot: 0.00001906,
      i: 7.00497902,
      i_dot: -0.00594749,
      Omega: 48.33076593,
      Omega_dot: -0.12534081,
      w: 29.124279,
      w_dot: 0.01,
      M: 168.6562,
      M_dot: 149472.6741,
    },
  }),
  new Body({
    name: "Venus",
    radius: 0.28,
    orbitRadiusAu: 0.723,
    orbitEccentricity: 0.007,
    orbitPeriodDays: 224.7,
    rotationPeriodDays: -243.02,
    orbitParent: sun,
    color: 0xe6c896,
    texture: "./assets/textures/2k_venus_surface.jpg",
    elements: {
      a: 0.72333566,
      a_dot: 0.0000039,
      e: 0.00677672,
      e_dot: -0.00004107,
      i: 3.39467605,
      i_dot: -0.0007889,
      Omega: 76.67984255,
      Omega_dot: -0.27769418,
      w: 54.922624,
      w_dot: 0.013,
      M: 48.0052,
      M_dot: 58517.8156,
    },
  }),
  new Body({
    name: "Earth",
    radius: 0.3,
    orbitRadiusAu: 1.0,
    orbitEccentricity: 0.017,
    orbitPeriodDays: 365.2,
    rotationPeriodDays: 0.996,
    orbitParent: sun,
    color: 0x5a8cf0,
    texture: "./assets/textures/2k_earth_daymap.jpg",
    elements: {
      a: 1.00000261,
      a_dot: 0.00000562,
      e: 0.01671123,
      e_dot: -0.00004392,
      i: -0.00001531,
      i_dot: -0.01294668,
      Omega: 0.0,
      Omega_dot: 0.0,
      w: 102.93768193,
      w_dot: 0.32327364,
      M: 357.51716,
      M_dot: 35999.37328,
    },
  }),
  new Body({
    name: "Mars",
    radius: 0.22,
    orbitRadiusAu: 1.524,
    orbitEccentricity: 0.094,
    orbitPeriodDays: 687.0,
    rotationPeriodDays: 1.025,
    orbitParent: sun,
    color: 0xd2785a,
    texture: "./assets/textures/2k_mars.jpg",
    elements: {
      a: 1.52371034,
      a_dot: 0.00001847,
      e: 0.0933941,
      e_dot: 0.00007882,
      i: 1.84969142,
      i_dot: -0.00813131,
      Omega: 49.55953891,
      Omega_dot: -0.29257343,
      w: 286.537,
      w_dot: 0.007,
      M: 19.41248,
      M_dot: 19140.30268,
    },
  }),
  new Body({
    name: "Jupiter",
    radius: 0.7,
    orbitRadiusAu: 5.204,
    orbitEccentricity: 0.049,
    orbitPeriodDays: 4331,
    rotationPeriodDays: 0.4125,
    orbitParent: sun,
    color: 0xd2a06e,
    texture: "./assets/textures/2k_jupiter.jpg",
    elements: {
      a: 5.202887,
      a_dot: -0.00011607,
      e: 0.04838624,
      e_dot: -0.00013253,
      i: 1.30439695,
      i_dot: -0.00183714,
      Omega: 100.47390909,
      Omega_dot: 0.20469106,
      w: 273.867,
      w_dot: 0.017,
      M: 20.0202,
      M_dot: 3034.903717,
    },
  }),
  new Body({
    name: "Saturn",
    radius: 0.6,
    orbitRadiusAu: 9.58,
    orbitEccentricity: 0.052,
    orbitPeriodDays: 10747,
    rotationPeriodDays: 0.4458,
    orbitParent: sun,
    color: 0xdcc88c,
    texture: "./assets/textures/2k_saturn.jpg",
    elements: {
      a: 9.53667594,
      a_dot: -0.0012506,
      e: 0.05386179,
      e_dot: -0.00050991,
      i: 2.48599187,
      i_dot: 0.00193609,
      Omega: 113.66242448,
      Omega_dot: -0.28867794,
      w: 339.392,
      w_dot: 0.002,
      M: 317.0207,
      M_dot: 1222.114947,
    },
  }),
  new Body({
    name: "Uranus",
    radius: 0.5,
    orbitRadiusAu: 19.16,
    orbitEccentricity: 0.047,
    orbitPeriodDays: 30589,
    rotationPeriodDays: -0.7167,
    orbitParent: sun,
    color: 0xaadcdc,
    texture: "./assets/textures/2k_uranus.jpg",
    elements: {
      a: 19.18916464,
      a_dot: -0.00196176,
      e: 0.04725744,
      e_dot: -0.00004397,
      i: 0.77263783,
      i_dot: -0.00242939,
      Omega: 74.01692503,
      Omega_dot: 0.04240589,
      w: 96.998857,
      w_dot: 0.002,
      M: 142.2386,
      M_dot: 428.495125,
    },
  }),
  new Body({
    name: "Neptune",
    radius: 0.5,
    orbitRadiusAu: 30.17,
    orbitEccentricity: 0.01,
    orbitPeriodDays: 59800,
    rotationPeriodDays: 0.6708,
    orbitParent: sun,
    color: 0x5a78dc,
    texture: "./assets/textures/2k_neptune.jpg",
    elements: {
      a: 30.06992276,
      a_dot: 0.00026291,
      e: 0.00859048,
      e_dot: 0.00005105,
      i: 1.77004347,
      i_dot: 0.00035372,
      Omega: 131.78422574,
      Omega_dot: -0.00508664,
      w: 273.187,
      w_dot: 0.0,
      M: 256.228,
      M_dot: 218.465153,
    },
  }),
];

const earth = planets[2];

const moon = new Body({
  name: "Moon",
  radius: 0.1,
  visualScale: 0.6,
  orbitRadiusAu: 0.08,
  orbitEccentricity: 0.0549,
  orbitInclinationDeg: 5.145,
  orbitPeriodDays: 27.3217,
  orbitParent: earth,
  color: 0xc8c8d2,
  texture: "./assets/textures/2k_moon.jpg",
  tidallyLocked: true,
});

const bodies = [sun, ...planets, moon];

const moonDefs = [
  ["Phobos", planets[3], 0.00006, 0.32, 0.06, 0.0, 1.093, 0xa0968c],
  ["Deimos", planets[3], 0.00016, 1.26, 0.05, 0.0, 0.93, 0xaaa096],
  ["Io", planets[4], 0.0028, 1.76914, 0.09, 0.0, 0.04, 0xdcc878],
  ["Europa", planets[4], 0.0045, 3.55118, 0.08, 0.0, 0.47, 0xc8d2e6],
  ["Ganymede", planets[4], 0.0071, 7.15455, 0.11, 0.0, 0.18, 0xbeb4aa],
  ["Callisto", planets[4], 0.0126, 16.68902, 0.1, 0.0, 0.19, 0x969088],
  ["Titan", planets[5], 0.0082, 15.94542, 0.11, 0.0, 0.3, 0xd2aa78],
  ["Enceladus", planets[5], 0.0016, 1.37022, 0.05, 0.0, 0.03, 0xe6e6eb],
  ["Rhea", planets[5], 0.0035, 4.5175, 0.08, 0.0, 0.35, 0xc8c8cd],
  ["Iapetus", planets[5], 0.0238, 79.33018, 0.09, 0.0, 18.5, 0xaaa096],
  ["Dione", planets[5], 0.0025, 2.74, 0.07, 0.0, 0.01, 0xd2d2d7],
  ["Tethys", planets[5], 0.002, 1.89, 0.06, 0.0, 1.1, 0xd2d2dc],
  ["Titania", planets[6], 0.0029, 8.71, 0.09, 0.0, 0.08, 0xb4aaa0],
  ["Oberon", planets[6], 0.0039, 13.46, 0.09, 0.0, 0.07, 0xaaa096],
  ["Ariel", planets[6], 0.0013, 2.52, 0.07, 0.0, 0.04, 0xc8beb4],
  ["Umbriel", planets[6], 0.0018, 4.14, 0.07, 0.0, 0.13, 0x968c82],
  ["Miranda", planets[6], 0.0009, 1.41, 0.05, 0.0, 4.34, 0xbeb4aa],
  ["Triton", planets[7], 0.0024, -5.87685, 0.1, 0.0, 157.345, 0xc8d2dc],
  ["Proteus", planets[7], 0.0012, 1.12, 0.06, 0.0, 0.04, 0x968c82],
];

moonDefs.forEach(([name, parent, orbitRadiusAu, orbitPeriodDays, radius, orbitEccentricity, orbitInclinationDeg, color]) => {
  const m = new Body({
    name,
    radius,
    visualScale: 0.6,
    orbitRadiusAu,
    orbitPeriodDays,
    orbitEccentricity,
    orbitInclinationDeg,
    orbitParent: parent,
    color,
    tidallyLocked: true,
  });
  bodies.push(m);
});

const planetRings = [];
const ringDefs = [
  [planets[5], 1.3, 2.6, 26.73, 0xffffff, "./assets/textures/2k_saturn_ring_alpha.png"],
  [planets[6], 1.2, 1.7, 97.77, 0xbecdd2, null],
  [planets[7], 1.3, 1.8, 28.32, 0xaab4c8, null],
];

ringDefs.forEach(([planet, innerMult, outerMult, tiltDeg, ringColor, ringTexture]) => {
  const innerRadius = planet.size * innerMult;
  const outerRadius = planet.size * outerMult;
  const geometry = makeRingGeometry(innerRadius, outerRadius, 128);
  const materialOptions = { color: ringColor, side: THREE.DoubleSide, transparent: true, opacity: 0.7 };
  if (ringTexture) {
    const ringMap = loadTexture(ringTexture);
    ringMap.wrapS = THREE.ClampToEdgeWrapping;
    ringMap.wrapT = THREE.RepeatWrapping;
    ringMap.repeat.set(1, 1);
    materialOptions.map = ringMap;
    materialOptions.transparent = true;
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial(materialOptions));
  mesh.rotation.x = -tiltDeg * DEG2RAD;
  scene.add(mesh);
  planetRings.push({ mesh, planet, tiltDeg, innerMult, outerMult, lastInner: innerRadius, lastOuter: outerRadius });
});

const orbitLines = [];
const orbitMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });

const createOrbitLine = (body) => {
  if (!body.orbitParent || body === sun) return null;
  let geometry;
  if (body.elements) {
    const minOrbit = body.orbitParent.size + body.size * 1.2;
    geometry = makeOrbitPath(body.elements, minOrbit);
  } else {
    const points = [];
    const a = body.orbitRadius;
    const e = body.orbitEccentricity;
    const b = a * Math.sqrt(1 - e * e);
    for (let i = 0; i <= 128; i += 1) {
      const t = (TAU * i) / 128;
      const x = a * Math.cos(t) - a * e;
      const z = b * Math.sin(t);
      points.push(new THREE.Vector3(x, 0, z));
    }
    geometry = new THREE.BufferGeometry().setFromPoints(points);
  }
  const line = new THREE.Line(geometry, orbitMaterial);
  if (!body.elements && body.orbitInclinationDeg) {
    line.rotation.x = -body.orbitInclinationDeg * DEG2RAD;
  }
  scene.add(line);
  return { line, body };
};

bodies.forEach((body) => {
  const line = createOrbitLine(body);
  if (line) {
    line.line.visible = false;
    orbitLines.push(line);
  }
});

const asteroids = [];
const baseAsteroidGeometry = new THREE.IcosahedronGeometry(0.025, 1);
const asteroidMaterial = new THREE.MeshStandardMaterial({
  color: 0xb7aa98,
  roughness: 0.85,
  metalness: 0.05,
});
const makeAsteroidGeometry = () => {
  const geometry = baseAsteroidGeometry.clone();
  const pos = geometry.getAttribute("position");
  const jitter = 0.35 + Math.random() * 0.35;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const scale = 1 + (Math.random() - 0.5) * jitter;
    pos.setXYZ(i, x * scale, y * scale, z * scale);
  }
  geometry.computeVertexNormals();
  return geometry;
};
for (let i = 0; i < 260; i += 1) {
  const radiusAu = THREE.MathUtils.lerp(2.2, 3.2, Math.random());
  const angle = Math.random() * TAU;
  const height = THREE.MathUtils.lerp(-0.05, 0.05, Math.random());
  const scale = THREE.MathUtils.lerp(0.6, 1.4, Math.random());
  const asteroid = new THREE.Mesh(makeAsteroidGeometry(), asteroidMaterial);
  asteroid.baseScale = scale;
  asteroid.scale.setScalar(scale * sizeScale);
  asteroid.position.set(
    Math.cos(angle) * radiusAu * AU,
    height * AU,
    Math.sin(angle) * radiusAu * AU
  );
  scene.add(asteroid);
  asteroids.push(asteroid);
}

// ---- Spacecraft -------------------------------------------------------

const buildSpacecraftMesh = (type) => {
  const group = new THREE.Group();
  const S = 0.015; // base size unit
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xd0d4dc, roughness: 0.3, metalness: 0.8 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a3a8a, roughness: 0.5, metalness: 0.3 });
  const goldMat  = new THREE.MeshStandardMaterial({ color: 0xc8941c, roughness: 0.3, metalness: 0.7 });
  const foilMat  = new THREE.MeshStandardMaterial({ color: 0xd4a030, roughness: 0.2, metalness: 0.9 });
  const dishMat  = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.15, metalness: 0.95, side: THREE.DoubleSide });

  const addDish = (parent, r, yPos) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8, 0, TAU, 0, Math.PI / 2.2), dishMat);
    d.rotation.x = Math.PI;
    d.position.y = yPos;
    parent.add(d);
  };

  if (type === 'iss') {
    // Main truss
    group.add(new THREE.Mesh(new THREE.BoxGeometry(S * 22, S * 0.5, S * 0.5), metalMat));
    // Habitation modules
    for (let i = -1; i <= 1; i++) {
      const mod = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.85, S * 0.85, S * 3, 10), metalMat);
      mod.rotation.z = Math.PI / 2;
      mod.position.x = i * S * 2.8;
      group.add(mod);
    }
    // Eight solar array wings
    for (const sx of [-4, -2, 2, 4]) {
      for (const sy of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(S * 1.5, S * 0.04, S * 8), panelMat);
        panel.position.set(sx * S, sy * S * 5, 0);
        group.add(panel);
      }
    }
  } else if (type === 'probe_dish') {
    // Gold-foil bus
    group.add(new THREE.Mesh(new THREE.BoxGeometry(S * 2.5, S * 2.5, S * 2.5), foilMat));
    // High-gain dish
    addDish(group, S * 4, S * 2);
    // RTG boom + canister
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.18, S * 0.18, S * 9, 6), goldMat);
    boom.rotation.z = Math.PI / 2;
    boom.position.x = -S * 5;
    group.add(boom);
    const rtg = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.5, S * 0.5, S * 1.5, 6), goldMat);
    rtg.rotation.z = Math.PI / 2;
    rtg.position.x = -S * 10;
    group.add(rtg);
  } else if (type === 'probe_solar') {
    // Juno: three large solar panel wings
    group.add(new THREE.Mesh(new THREE.BoxGeometry(S * 2, S * 2, S * 2), foilMat));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(S * 11, S * 0.05, S * 2), panelMat);
      panel.position.set(Math.cos(a) * S * 6, 0, Math.sin(a) * S * 6);
      panel.rotation.y = a;
      group.add(panel);
    }
    addDish(group, S * 2.5, S * 2);
  } else if (type === 'telescope') {
    // Hubble: cylinder body + two solar arrays
    const body = new THREE.Mesh(new THREE.CylinderGeometry(S * 1.4, S * 1.4, S * 6, 12), metalMat);
    body.rotation.z = Math.PI / 2;
    group.add(body);
    for (const sy of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(S * 0.05, S * 4.5, S * 2), panelMat);
      panel.position.y = sy * S * 5;
      group.add(panel);
    }
  } else if (type === 'jwst') {
    // Sunshield (tennis-court-sized kite)
    group.add(new THREE.Mesh(new THREE.BoxGeometry(S * 14, S * 0.08, S * 9),
      new THREE.MeshStandardMaterial({ color: 0xf0e6a0, roughness: 0.4, metalness: 0.5 })));
    // Hexagonal primary mirror (gold)
    const mirror = new THREE.Mesh(new THREE.CylinderGeometry(S * 3.2, S * 3.2, S * 0.4, 6),
      new THREE.MeshStandardMaterial({ color: 0xd4a82a, roughness: 0.05, metalness: 1.0 }));
    mirror.position.y = S * 2;
    group.add(mirror);
  }

  return group;
};

class Spacecraft {
  constructor(options) {
    this.name = options.name;
    this.size = 0.25; // used by focusOn() — drives camera stand-off distance
    this.mesh = buildSpacecraftMesh(options.type);
    this.orbitParent = options.orbitParent ?? null;
    this.orbitRadiusFn = options.orbitRadiusFn ?? null;
    this.orbitPeriodDays = options.orbitPeriodDays ?? null;
    this.orbitInclinationRad = (options.orbitInclinationDeg ?? 0) * DEG2RAD;
    this.orbitAngle = Math.random() * TAU;
    this.isL2 = options.isL2 ?? false;
    this.refJd = options.refJd ?? null;
    this.refPos = options.refPos ? new THREE.Vector3(...options.refPos) : null;
    this.velocity = options.velocity ? new THREE.Vector3(...options.velocity) : null;

    // Navigation beacon — fixed screen size so the craft is findable from any distance
    const bc = document.createElement('canvas');
    bc.width = 64; bc.height = 64;
    const bctx = bc.getContext('2d');
    const grd = bctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0,   'rgba(160, 220, 255, 1.0)');
    grd.addColorStop(0.4, 'rgba(80, 160, 255, 0.8)');
    grd.addColorStop(1,   'rgba(0,  60, 200, 0.0)');
    bctx.fillStyle = grd;
    bctx.fillRect(0, 0, 64, 64);
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(bc),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false, // constant screen size regardless of distance
    }));
    beacon.scale.setScalar(0.022); // ~20 px at 1080p
    beacon.renderOrder = 5;
    this.mesh.add(beacon);

    scene.add(this.mesh);
  }

  step(dtDays, jd) {
    if (this.velocity && this.refPos) {
      // Linear heliocentric propagation (good for multi-year window)
      const elapsed = jd - this.refJd;
      this.mesh.position.copy(this.refPos).addScaledVector(this.velocity, elapsed);
    } else if (this.isL2) {
      // JWST: trail Earth at Sun-Earth L2 (~1% beyond Earth)
      const dir = new THREE.Vector3().subVectors(earth.mesh.position, sun.mesh.position).normalize();
      // L2 is 1 500 000 km from Earth; clamp to outside Earth's enlarged mesh
      const l2 = scOrbit(1_500_000, earth, 6.0);
      this.mesh.position.copy(earth.mesh.position).addScaledVector(dir, l2);
    } else if (this.orbitParent && this.orbitPeriodDays) {
      this.orbitAngle += TAU * (dtDays / this.orbitPeriodDays);
      const r = this.orbitRadiusFn ? this.orbitRadiusFn() : 1.0;
      const cosA = Math.cos(this.orbitAngle);
      const sinA = Math.sin(this.orbitAngle);
      const cosI = Math.cos(this.orbitInclinationRad);
      const sinI = Math.sin(this.orbitInclinationRad);
      this.mesh.position.copy(this.orbitParent.mesh.position).add(
        new THREE.Vector3(cosA * r, sinA * sinI * r, sinA * cosI * r)
      );
    }
    this.mesh.rotation.y += 0.4 * dtDays;
  }
}

// Heliocentric positions at JD 2458849.5 (2026-01-16), scene units (1 AU = 5).
// Derived from JPL Horizons ecliptic J2000 data; velocity = scene units/day.
const SC_REF_JD = simJd;

// Convert km from a body's centre to scene units, clamped to stay outside the
// body's enlarged mesh so the spacecraft is always visible in both view modes.
const scOrbit = (km, parent, minMult = 1.5) =>
  Math.max((km / 149_600_000) * AU, parent.size * minMult);

const spacecrafts = [
  new Spacecraft({
    name: "ISS",
    type: "iss",
    orbitParent: earth,
    orbitRadiusFn: () => scOrbit(6_779, earth, 1.05),  // 408 km alt
    orbitPeriodDays: 0.0625,
    orbitInclinationDeg: 51.6,
  }),
  new Spacecraft({
    name: "Hubble",
    type: "telescope",
    orbitParent: earth,
    orbitRadiusFn: () => scOrbit(6_918, earth, 1.08), // 547 km alt
    orbitPeriodDays: 0.066,
    orbitInclinationDeg: 28.5,
  }),
  new Spacecraft({
    name: "JWST",
    type: "jwst",
    isL2: true,
  }),
  new Spacecraft({
    name: "Juno",
    type: "probe_solar",
    orbitParent: planets[4],
    orbitRadiusFn: () => scOrbit(4_200, planets[4], 1.05), // perijove 4 200 km — inside Io's orbit
    orbitPeriodDays: 53.5,
    orbitInclinationDeg: 1.3,
  }),
  // --- Mars orbiters ---
  new Spacecraft({
    name: "MRO",
    type: "probe_solar",
    orbitParent: planets[3],
    orbitRadiusFn: () => scOrbit(3_675, planets[3], 1.05), // 285 km alt, r=3 675 km
    orbitPeriodDays: 0.083,
    orbitInclinationDeg: 93.0,
  }),
  new Spacecraft({
    name: "MAVEN",
    type: "probe_solar",
    orbitParent: planets[3],
    orbitRadiusFn: () => scOrbit(6_690, planets[3], 1.3), // highly elliptical avg
    orbitPeriodDays: 0.267,
    orbitInclinationDeg: 75.0,
  }),
  // --- Mercury orbiter ---
  new Spacecraft({
    name: "BepiColombo",
    type: "probe_dish",
    orbitParent: planets[0],
    orbitRadiusFn: () => scOrbit(3_430, planets[0], 1.05), // ~990 km alt
    orbitPeriodDays: 0.127,
    orbitInclinationDeg: 90.0,
  }),
  // --- Sun-grazing probe ---
  new Spacecraft({
    name: "Parker Solar Probe",
    type: "probe_dish",
    orbitParent: sun,
    orbitRadiusFn: () => scOrbit(6_100_000, sun),   // perihelion 0.041 AU
    orbitPeriodDays: 88.0,
    orbitInclinationDeg: 3.4,
  }),
  // Deep-space probes: refPos in scene units, velocity in scene units/day
  new Spacecraft({
    name: "New Horizons",
    type: "probe_dish",
    refJd: SC_REF_JD,
    refPos:    [ 115.6, -19.4, -260.0],  // ~57 AU
    velocity:  [0.0143, -0.00246, -0.0322],
  }),
  new Spacecraft({
    name: "Voyager 1",
    type: "probe_dish",
    refJd: SC_REF_JD,
    refPos:   [-201.5,  467.5, -637.5],  // ~163 AU
    velocity: [-0.0109, 0.0249, -0.0337],
  }),
  new Spacecraft({
    name: "Voyager 2",
    type: "probe_dish",
    refJd: SC_REF_JD,
    refPos:   [ 168.5, -358.0, -552.0],  // ~136 AU
    velocity: [ 0.0112, -0.0208, -0.0361],
  }),
];

const moveState = { forward: 0, right: 0, up: 0 };
const moveVelocity = new THREE.Vector3();
const baseMoveSpeed = 10.0;
let moveSpeed = baseMoveSpeed;
const moveDamping = 5.0;
let boostActive = false;
let useRealSize = false;
let focusTarget = null;
let focusOffset = null;
let labelsMode = 0; // 0 = off · 1 = names only · 2 = names + info
const labels = new Map();
const labelsGroup = new THREE.Group();
scene.add(labelsGroup);
let orbitLinesEnabled = false;


const focusOn = (body) => {
  const size = body.size;
  const offset = new THREE.Vector3(0, size * 6, size * 12);
  const target = body.mesh.position.clone();
  focusTarget = body;
  focusOffset = offset;
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
  lookState.yaw = camera.rotation.y;
  lookState.pitch = camera.rotation.x;
};

const formatSimTime = (jd) => {
  const epoch = new Date(Date.UTC(1970, 0, 1));
  const daysFromUnix = jd - 2440587.5;
  const ms = daysFromUnix * 86400000;
  const date = new Date(epoch.getTime() + ms);
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
};

const updateStatus = () => {
  const status = document.getElementById("status");
  status.textContent = `Sim time: ${formatSimTime(simJd)}\nSpeed: ${timeScale.toFixed(2)} days/sec (${paused ? "paused" : "running"})\nSize scale: ${useRealSize ? "real" : "enlarged"}`;
  const pb = document.getElementById("btn-pause");
  if (pb) pb.textContent = paused ? "▶" : "⏸";
};

// Real-world data shown in the info panel (hover a label when N is active).
const bodyData = {
  Sun:          { type: "Star",            diamKm: 1_392_700 },
  Mercury:      { type: "Rocky planet",    diamKm: 4_879 },
  Venus:        { type: "Rocky planet",    diamKm: 12_104 },
  Earth:        { type: "Rocky planet",    diamKm: 12_742 },
  Mars:         { type: "Rocky planet",    diamKm: 6_779 },
  Jupiter:      { type: "Gas giant",       diamKm: 139_820 },
  Saturn:       { type: "Gas giant",       diamKm: 116_460 },
  Uranus:       { type: "Ice giant",       diamKm: 50_724 },
  Neptune:      { type: "Ice giant",       diamKm: 49_244 },
  Moon:         { type: "Moon",            diamKm: 3_474 },
  Phobos:       { type: "Moon",            diamKm: 22 },
  Deimos:       { type: "Moon",            diamKm: 12 },
  Io:           { type: "Moon",            diamKm: 3_642 },
  Europa:       { type: "Moon",            diamKm: 3_122 },
  Ganymede:     { type: "Moon",            diamKm: 5_268 },
  Callisto:     { type: "Moon",            diamKm: 4_821 },
  Titan:        { type: "Moon",            diamKm: 5_150 },
  Enceladus:    { type: "Moon",            diamKm: 504 },
  Rhea:         { type: "Moon",            diamKm: 1_527 },
  Iapetus:      { type: "Moon",            diamKm: 1_469 },
  Dione:        { type: "Moon",            diamKm: 1_122 },
  Tethys:       { type: "Moon",            diamKm: 1_062 },
  Titania:      { type: "Moon",            diamKm: 1_578 },
  Oberon:       { type: "Moon",            diamKm: 1_523 },
  Ariel:        { type: "Moon",            diamKm: 1_158 },
  Umbriel:      { type: "Moon",            diamKm: 1_169 },
  Miranda:      { type: "Moon",            diamKm: 472 },
  Triton:       { type: "Moon",            diamKm: 2_707 },
  Proteus:      { type: "Moon",            diamKm: 420 },
  ISS:          { type: "Spacecraft",      desc: "Low Earth orbit · ~408 km altitude" },
  Hubble:       { type: "Space telescope", desc: "Low Earth orbit · ~540 km altitude" },
  JWST:         { type: "Space telescope", desc: "Sun–Earth L2 · 1.5 M km from Earth" },
  Juno:         { type: "Spacecraft",      desc: "Jupiter orbiter · arrived 2016" },
  MRO:          { type: "Spacecraft",      desc: "Mars Reconnaissance Orbiter · since 2006" },
  MAVEN:        { type: "Spacecraft",      desc: "Mars atmosphere mission · since 2014" },
  BepiColombo:  { type: "Spacecraft",      desc: "Mercury orbiter · arrives 2025" },
  "Parker Solar Probe": { type: "Spacecraft", desc: "Sun-grazing probe · closest ~6.9 M km" },
  "New Horizons": { type: "Spacecraft",    desc: "Pluto flyby 2015 · now in Kuiper Belt" },
  "Voyager 1":  { type: "Spacecraft",      desc: "Interstellar space · launched 1977" },
  "Voyager 2":  { type: "Spacecraft",      desc: "Interstellar space · launched 1977" },
};

const nameMap = {
  Sun: "Sonne",
  Mercury: "Merkur",
  Venus: "Venus",
  Earth: "Erde",
  Mars: "Mars",
  Jupiter: "Jupiter",
  Saturn: "Saturn",
  Uranus: "Uranus",
  Neptune: "Neptun",
  Moon: "Mond",
  Phobos: "Phobos",
  Deimos: "Deimos",
  Io: "Io",
  Europa: "Europa",
  Ganymede: "Ganymed",
  Callisto: "Kallisto",
  Titan: "Titan",
  Enceladus: "Enceladus",
  Rhea: "Rhea",
  Iapetus: "Japetus",
  Dione: "Dione",
  Tethys: "Tethys",
  Titania: "Titania",
  Oberon: "Oberon",
  Ariel: "Ariel",
  Umbriel: "Umbriel",
  Miranda: "Miranda",
  Triton: "Triton",
  Proteus: "Proteus",
  ISS: "ISS",
  Hubble: "Hubble",
  JWST: "JWST",
  Juno: "Juno",
  MRO: "MRO",
  MAVEN: "MAVEN",
  BepiColombo: "BepiColombo",
  "Parker Solar Probe": "Parker Solar Probe",
  "New Horizons": "New Horizons",
  "Voyager 1": "Voyager 1",
  "Voyager 2": "Voyager 2",
};

const fmtPeriod = (days) => {
  if (days == null) return "—";
  const abs = Math.abs(days);
  const retro = days < 0 ? " ↺" : "";
  if (abs < 1) return `${(abs * 24).toFixed(1)} h${retro}`;
  if (abs < 365.25) return `${abs.toFixed(1)} d${retro}`;
  return `${(abs / 365.25).toFixed(2)} yr${retro}`;
};

const fmtOrbit = (au) => {
  if (!au) return "—";
  if (au < 0.01) return `${Math.round(au * 149_597_870).toLocaleString()} km`;
  return `${au.toFixed(3)} AU`;
};

const getInfoRows = (body) => {
  const data = bodyData[body.name] ?? {};
  const rows = [];
  if (data.type) rows.push(["Type", data.type]);
  if (data.diamKm) rows.push(["Diameter", `${data.diamKm.toLocaleString()} km`]);
  if (body instanceof Spacecraft) {
    if (body.orbitParent) rows.push(["Orbits", body.orbitParent.name]);
    if (data.desc) rows.push(["Info", data.desc]);
  } else {
    if (body.orbitRadiusAu) rows.push(["Orbit", fmtOrbit(body.orbitRadiusAu)]);
    if (body.orbitPeriodDays != null) rows.push(["Year", fmtPeriod(body.orbitPeriodDays)]);
    if (body.rotationPeriodDays != null)
      rows.push(["Day", body.tidallyLocked ? "Tidally locked" : fmtPeriod(body.rotationPeriodDays)]);
  }
  return rows;
};

// Break `txt` into lines that fit within `maxW` pixels (ctx font must be set).
const wrapText = (ctx, txt, maxW) => {
  const words = txt.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const probe = cur ? cur + " " + w : w;
    if (ctx.measureText(probe).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = probe;
  }
  if (cur) lines.push(cur);
  return lines;
};

const createLabelSprite = (text, isMoon, body, withInfo) => {
  const W = 320;
  const PAD = 12;
  const NAME_H = 44;
  const SEP_H = 10;
  const LINE_H = 18; // height of one wrapped value line
  const ROW_PAD = 8; // vertical padding inside each row

  const rawRows = withInfo && body ? getInfoRows(body) : [];

  // ── First pass: measure wrapped value lines so we can compute canvas height ──
  const measCanvas = document.createElement("canvas");
  const measCtx = measCanvas.getContext("2d");
  measCtx.font = "17px 'Space Grotesk', sans-serif";

  const processedRows = rawRows.map(([key, val]) => {
    const keyW = measCtx.measureText(key).width;
    const maxValW = W - 2 * PAD - 12 - keyW - 10;
    const lines = wrapText(measCtx, val, maxValW);
    const rowH = lines.length * LINE_H + ROW_PAD;
    return { key, lines, rowH };
  });

  const totalInfoH = processedRows.reduce((s, r) => s + r.rowH, 0);
  const H = PAD + NAME_H + (processedRows.length ? SEP_H + totalInfoH : 0) + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background card
  ctx.fillStyle = "rgba(5, 8, 16, 0.72)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(4, 4, W - 8, H - 8, 10);
  else ctx.rect(4, 4, W - 8, H - 8);
  ctx.fill();
  ctx.stroke();

  // Name
  ctx.fillStyle = isMoon ? "rgba(200, 200, 215, 0.92)" : "rgba(255, 255, 255, 0.97)";
  ctx.font = "bold 26px 'Space Grotesk', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, PAD + NAME_H / 2);

  if (processedRows.length) {
    // Separator
    const sepY = PAD + NAME_H + SEP_H / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD + 4, sepY);
    ctx.lineTo(W - PAD - 4, sepY);
    ctx.stroke();

    // ── Second pass: draw rows with wrapped values ──
    ctx.font = "17px 'Space Grotesk', sans-serif";
    ctx.textBaseline = "middle";
    let curY = PAD + NAME_H + SEP_H;
    processedRows.forEach(({ key, lines, rowH }) => {
      // Key label — vertically centred on first value line
      const firstLineY = curY + ROW_PAD / 2 + LINE_H / 2;
      ctx.fillStyle = "rgba(160, 185, 220, 0.85)";
      ctx.textAlign = "left";
      ctx.fillText(key, PAD + 6, firstLineY);
      // Value lines — right-aligned, stacked
      ctx.fillStyle = "rgba(230, 238, 255, 0.95)";
      ctx.textAlign = "right";
      lines.forEach((line, li) => {
        ctx.fillText(line, W - PAD - 6, curY + ROW_PAD / 2 + LINE_H / 2 + li * LINE_H);
      });
      curY += rowH;
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;
  sprite.userData.aspect = W / H;
  return sprite;
};

const buildLabels = () => {
  labels.forEach((sprite) => labelsGroup.remove(sprite));
  labels.clear();
  if (labelsMode === 0) return;
  const withInfo = labelsMode === 2;
  const planets9 = new Set(["Sun","Mercury","Venus","Earth","Mars","Jupiter","Saturn","Uranus","Neptune"]);
  bodies.forEach((body) => {
    const sprite = createLabelSprite(nameMap[body.name] ?? body.name, !planets9.has(body.name), body, withInfo);
    labels.set(body, sprite);
    labelsGroup.add(sprite);
  });
  spacecrafts.forEach((sc) => {
    const sprite = createLabelSprite(sc.name, false, sc, withInfo);
    labels.set(sc, sprite);
    labelsGroup.add(sprite);
  });
};

const toggleLabels = () => {
  labelsMode = (labelsMode + 1) % 3;
  orbitLinesEnabled = labelsMode > 0;
  buildLabels();
  orbitLines.forEach(({ line }) => { line.visible = labelsMode > 0; });
};

const applySizeScale = (scale) => {
  sizeScale = scale;
  moveSpeed = baseMoveSpeed * (useRealSize ? 0.005 : 1.0);
  bodies.forEach((body) => {
    body.size = body.baseSize * sizeScale;
    body.mesh.scale.setScalar(sizeScale);
  });
  asteroids.forEach((asteroid) => {
    asteroid.scale.setScalar(asteroid.baseScale * sizeScale);
  });
  planetRings.forEach((ring) => {
    ring.lastInner = 0;
    ring.lastOuter = 0;
  });
  // Spacecraft shrink less than planets when switching to real size,
  // so they stay proportionally more visible (they are far smaller in reality).
  const scScale = useRealSize ? REAL_SIZE_FACTOR : 1.0;
  spacecrafts.forEach((sc) => sc.mesh.scale.setScalar(scScale));
};

const applyLook = () => {
  lookState.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, lookState.pitch));
  camera.rotation.x = lookState.pitch;
  camera.rotation.y = lookState.yaw;
};

const handleMove = (key, value) => {
  switch (key) {
    case "KeyW":
      moveState.forward = value;
      break;
    case "KeyS":
      moveState.forward = -value;
      break;
    case "KeyD":
      moveState.right = value;
      break;
    case "KeyA":
      moveState.right = -value;
      break;
    case "KeyT":
      moveState.up = value;
      break;
    case "KeyG":
      moveState.up = -value;
      break;
    default:
      break;
  }
};

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.code === "Space") {
    paused = !paused;
  } else if (event.code === "KeyQ") {
    timeScale /= 1.25;
  } else if (event.code === "KeyE") {
    timeScale *= 1.25;
  } else if (event.code === "KeyR" && !event.shiftKey) {
    timeScale = timeScaleDefault;
  } else if (event.code === "KeyV") {
    useRealSize = !useRealSize;
    applySizeScale(useRealSize ? REAL_SIZE_FACTOR : 1.0);
  } else if (event.code === "KeyN") {
    toggleLabels();
  } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    boostActive = true;
  } else {
    handleMove(event.code, 1);
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    boostActive = false;
  }
  handleMove(event.code, 0);
});

renderer.domElement.addEventListener("click", () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  lookState.locked = document.pointerLockElement === renderer.domElement;
});

document.addEventListener("mousemove", (event) => {
  if (!lookState.locked) return;
  lookState.yaw -= event.movementX * lookState.sensitivity;
  lookState.pitch -= event.movementY * lookState.sensitivity;
  applyLook();
});

renderer.domElement.addEventListener("wheel", (event) => {
  event.preventDefault();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const zoomAmount = Math.sign(event.deltaY) * 1.5;
  camera.position.addScaledVector(direction, zoomAmount);
}, { passive: false });

const updateMovement = (dt) => {
  const direction = new THREE.Vector3(moveState.right, moveState.up, moveState.forward);
  if (direction.lengthSq() === 0) {
    moveVelocity.lerp(new THREE.Vector3(), Math.min(1, moveDamping * dt));
  } else {
    if (focusTarget) {
      focusTarget = null;
      focusOffset = null;
    }
    direction.normalize();
    const speed = moveSpeed * (boostActive ? 2.0 : 1.0);
    const worldDir = new THREE.Vector3();
    camera.getWorldDirection(worldDir);
    const right = new THREE.Vector3().crossVectors(worldDir, camera.up).normalize();
    const up = camera.up.clone().normalize();
    const forward = worldDir.clone().normalize();
    const move = right.multiplyScalar(direction.x)
      .add(up.multiplyScalar(direction.y))
      .add(forward.multiplyScalar(direction.z));
    moveVelocity.lerp(move.multiplyScalar(speed), Math.min(1, 4 * dt));
  }
  const deltaMove = moveVelocity.clone().multiplyScalar(dt);
  camera.position.add(deltaMove);
};

const resize = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};

window.addEventListener("resize", resize);

updateStatus();

const animate = () => {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (!paused) {
    const dtDays = dt * timeScale;
    simJd += dtDays;
    bodies.forEach((body) => body.step(dtDays, simJd));
    spacecrafts.forEach((sc) => sc.step(dtDays, simJd));
  }

  if (focusTarget) {
    camera.position.copy(focusTarget.mesh.position).add(focusOffset);
    camera.lookAt(focusTarget.mesh.position);
    lookState.yaw = camera.rotation.y;
    lookState.pitch = camera.rotation.x;
  }

  orbitLines.forEach(({ line, body }) => {
    if (!paused && body.elements) {
      line.geometry.dispose();
      const minOrbit = body.orbitParent.size + body.size * 1.2;
      line.geometry = makeOrbitPath(body.elements, minOrbit);
    }
    line.position.copy(body.orbitParent.mesh.position);
    if (!body.elements && body.orbitInclinationDeg) {
      line.rotation.x = -body.orbitInclinationDeg * DEG2RAD;
    }
  });

  planetRings.forEach(({ mesh, planet, tiltDeg, innerMult, outerMult }) => {
    const innerRadius = planet.size * innerMult;
    const outerRadius = planet.size * outerMult;
    const ringData = planetRings.find((entry) => entry.mesh === mesh);
    const needsUpdate = ringData && (ringData.lastInner !== innerRadius || ringData.lastOuter !== outerRadius);
    if (needsUpdate) {
      mesh.geometry.dispose();
      mesh.geometry = makeRingGeometry(innerRadius, outerRadius, 128);
      ringData.lastInner = innerRadius;
      ringData.lastOuter = outerRadius;
    }
    mesh.position.copy(planet.mesh.position);
    mesh.rotation.x = -tiltDeg * DEG2RAD;
  });

  sunLight.position.copy(sun.mesh.position);

  if (labelsMode > 0) {
    const realMult = useRealSize ? REAL_SIZE_FACTOR : 1.0;
    labels.forEach((sprite, body) => {
      const yOff = body instanceof Spacecraft
        ? 0.35 * realMult
        : body.size * 1.6 + 0.4 * realMult;
      sprite.position.copy(body.mesh.position).add(new THREE.Vector3(0, yOff, 0));
      const distance = camera.position.distanceTo(sprite.position);
      const scaleMax = useRealSize ? 0.3 : 6.0;
      const scaleMin = useRealSize ? 0.03 : 0.6;
      const scale = Math.max(scaleMin, Math.min(scaleMax, distance * 0.02 * realMult));
      const aspect = sprite.userData.aspect ?? (1.4 / 0.55);
      sprite.scale.set(scale * 1.4, scale * 1.4 / aspect, 1);
    });
  }

  // Keep Milky Way centred on camera so stars are always far in the background
  milkyWay.position.copy(camera.position);
  starfield.position.copy(camera.position);

  updateMovement(dt);
  applyLook();
  renderer.render(scene, camera);
  updateStatus();
};

animate();

// ── Mobile / touch controls ────────────────────────────────────────────

// Helper: find a touch by identifier in a TouchList
const findTouch = (list, id) => { for (const t of list) if (t.identifier === id) return t; return null; };

// Touch-look state (single finger on canvas → rotate camera)
const touchLook = { id: null, prevX: 0, prevY: 0 };
// Pinch-zoom state (two fingers on canvas → move forward/back)
const touchPinch = { id0: null, id1: null, prevDist: 0 };

renderer.domElement.addEventListener("touchstart", (e) => {
  e.preventDefault();
  // Use targetTouches so joystick touches (on a separate element) are excluded
  if (e.targetTouches.length === 2) {
    touchLook.id = null;
    touchPinch.id0 = e.targetTouches[0].identifier;
    touchPinch.id1 = e.targetTouches[1].identifier;
    touchPinch.prevDist = Math.hypot(
      e.targetTouches[1].clientX - e.targetTouches[0].clientX,
      e.targetTouches[1].clientY - e.targetTouches[0].clientY,
    );
    return;
  }
  for (const t of e.changedTouches) {
    if (touchLook.id === null) {
      touchLook.id = t.identifier;
      touchLook.prevX = t.clientX;
      touchLook.prevY = t.clientY;
    }
  }
}, { passive: false });

renderer.domElement.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (e.targetTouches.length >= 2 && touchPinch.id0 !== null) {
    const a = findTouch(e.touches, touchPinch.id0);
    const b = findTouch(e.touches, touchPinch.id1);
    if (a && b) {
      const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      camera.position.addScaledVector(dir, (d - touchPinch.prevDist) * 0.08);
      touchPinch.prevDist = d;
    }
    return;
  }
  for (const t of e.changedTouches) {
    if (t.identifier === touchLook.id) {
      lookState.yaw   += (t.clientX - touchLook.prevX) * lookState.sensitivity * 2.5;
      lookState.pitch += (t.clientY - touchLook.prevY) * lookState.sensitivity * 2.5;
      applyLook();
      touchLook.prevX = t.clientX;
      touchLook.prevY = t.clientY;
    }
  }
}, { passive: false });

const clearTouches = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === touchLook.id) touchLook.id = null;
    if (t.identifier === touchPinch.id0 || t.identifier === touchPinch.id1) {
      touchPinch.id0 = null;
      touchPinch.id1 = null;
    }
  }
};
renderer.domElement.addEventListener("touchend",    clearTouches, { passive: false });
renderer.domElement.addEventListener("touchcancel", clearTouches, { passive: false });

// ── Virtual joystick ──────────────────────────────────────────────────

const joyBase = document.getElementById("joystick-base");
const joyKnob = document.getElementById("joystick-knob");

if (joyBase && joyKnob) {
  const JOY_R = 52; // half-size of base in px
  let joyId = null;

  joyBase.addEventListener("touchstart", (e) => {
    e.preventDefault();
    joyId = e.changedTouches[0].identifier;
  }, { passive: false });

  joyBase.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = findTouch(e.changedTouches, joyId);
    if (!t) return;
    const r = joyBase.getBoundingClientRect();
    let dx = t.clientX - (r.left + r.width  / 2);
    let dy = t.clientY - (r.top  + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    moveState.right =  dx / JOY_R;
    moveState.up    = -dy / JOY_R; // screen-up = up
  }, { passive: false });

  const joyEnd = (e) => {
    e.preventDefault();
    joyId = null;
    joyKnob.style.transform = "translate(-50%, -50%)";
    moveState.right = 0;
    moveState.up    = 0;
  };
  joyBase.addEventListener("touchend",    joyEnd, { passive: false });
  joyBase.addEventListener("touchcancel", joyEnd, { passive: false });
}

// ── Up / Down hold-buttons ────────────────────────────────────────────



// ── Toolbar tap buttons ───────────────────────────────────────────────

const tapBtn = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };

tapBtn("btn-pause",  () => { paused = !paused; });
tapBtn("btn-slower", () => { timeScale /= 1.25; });
tapBtn("btn-faster", () => { timeScale *= 1.25; });
tapBtn("btn-names",  () => { toggleLabels(); });

// ── Shared focus data ─────────────────────────────────────────────────

const planetItems = [
  ["Sun", sun], ["Mercury", planets[0]], ["Venus", planets[1]],
  ["Earth", planets[2]], ["Mars", planets[3]], ["Jupiter", planets[4]],
  ["Saturn", planets[5]], ["Uranus", planets[6]], ["Neptune", planets[7]],
];

const scShort = { "Parker Solar Probe": "Parker", "BepiColombo": "Bepi.", "New Horizons": "N.Horiz." };
const scItems = spacecrafts.map((sc) => [scShort[sc.name] ?? sc.name, sc]);

const fillPanel = (panel, items, onPick) => {
  panel.innerHTML = "";
  items.forEach(([label, body]) => {
    const btn = document.createElement("button");
    btn.className = "focus-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => { focusOn(body); onPick(); });
    panel.appendChild(btn);
  });
};

// ── Mobile planet focus panel (⊙ button) ──────────────────────────────

const focusPanel  = document.getElementById("focus-panel");
const focusToggle = document.getElementById("btn-planets");

if (focusPanel && focusToggle) {
  let focusState = 0; // 0 = hidden · 1 = planets · 2 = spacecraft

  const buildFocusPanel = () => {
    const items = focusState === 1 ? planetItems : scItems;
    fillPanel(focusPanel, items, () => { focusState = 0; focusPanel.hidden = true; });
    focusPanel.hidden = false;
  };

  focusToggle.addEventListener("click", () => {
    focusState = (focusState + 1) % 3;
    if (focusState === 0) { focusPanel.hidden = true; } else { buildFocusPanel(); }
  });

  document.addEventListener("touchstart", (e) => {
    if (!focusPanel.hidden && !focusPanel.contains(e.target) && e.target !== focusToggle) {
      focusState = 0;
      focusPanel.hidden = true;
    }
  }, { passive: true });
}

// ── Desktop focus panel ───────────────────────────────────────────────

const deskPlanetsBtn   = document.getElementById("desk-btn-planets");
const deskCraftBtn     = document.getElementById("desk-btn-craft");
const deskPlanetsPanel = document.getElementById("desk-planets-panel");
const deskCraftPanel   = document.getElementById("desk-craft-panel");

if (deskPlanetsBtn && deskCraftBtn) {
  const closeDesktop = () => {
    deskPlanetsPanel.hidden = true;
    deskCraftPanel.hidden = true;
  };

  deskPlanetsBtn.addEventListener("click", () => {
    const opening = deskPlanetsPanel.hidden;
    closeDesktop();
    if (opening) {
      fillPanel(deskPlanetsPanel, planetItems, closeDesktop);
      deskPlanetsPanel.hidden = false;
    }
  });

  deskCraftBtn.addEventListener("click", () => {
    const opening = deskCraftPanel.hidden;
    closeDesktop();
    if (opening) {
      fillPanel(deskCraftPanel, scItems, closeDesktop);
      deskCraftPanel.hidden = false;
    }
  });

  document.addEventListener("click", (e) => {
    const inDesktop = e.target.closest("#desktop-focus");
    if (!inDesktop) closeDesktop();
  });
}
