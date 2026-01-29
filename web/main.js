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

const starfield = (() => {
  const geometry = new THREE.SphereGeometry(800, 64, 64);
  const material = new THREE.MeshBasicMaterial({
    map: loadTexture("../assets/textures/8k_stars_milky_way.jpg"),
    side: THREE.BackSide,
    color: 0xd7dfef,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  return mesh;
})();

const sunLight = new THREE.PointLight(0xfff1da, 8.0, 0, 2);
scene.add(sunLight);

const ambient = new THREE.AmbientLight(0x2a3144, 0.85);
scene.add(ambient);

const fillLight = new THREE.DirectionalLight(0xa7b6cc, 0.5);
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
  texture: "../assets/textures/2k_sun.jpg",
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
    texture: "../assets/textures/2k_mercury.jpg",
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
    texture: "../assets/textures/2k_venus_surface.jpg",
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
    texture: "../assets/textures/2k_earth_daymap.jpg",
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
    texture: "../assets/textures/2k_mars.jpg",
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
    texture: "../assets/textures/2k_jupiter.jpg",
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
    texture: "../assets/textures/2k_saturn.jpg",
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
    texture: "../assets/textures/2k_uranus.jpg",
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
    texture: "../assets/textures/2k_neptune.jpg",
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
  texture: "../assets/textures/2k_moon.jpg",
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
  [planets[5], 1.3, 2.6, 26.73, 0xffffff, "../assets/textures/2k_saturn_ring_alpha.png"],
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

const moveState = { forward: 0, right: 0, up: 0 };
const moveVelocity = new THREE.Vector3();
const baseMoveSpeed = 10.0;
let moveSpeed = baseMoveSpeed;
const moveDamping = 5.0;
let boostActive = false;
let useRealSize = false;
let focusTarget = null;
let focusOffset = null;
let labelsEnabled = false;
const labels = new Map();
const labelsGroup = new THREE.Group();
scene.add(labelsGroup);
let orbitLinesEnabled = false;

const focusTargets = {
  Digit1: sun,
  Digit2: planets[0],
  Digit3: planets[1],
  Digit4: planets[2],
  Digit5: planets[3],
  Digit6: planets[4],
  Digit7: planets[5],
  Digit8: planets[6],
  Digit9: planets[7],
};

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
};

const createLabelSprite = (text, isMoon) => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(5, 8, 16, 0.65)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(10, 18, 236, 60, 12);
  } else {
    ctx.rect(10, 18, 236, 60);
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = isMoon ? "rgba(200, 200, 210, 0.9)" : "rgba(255, 255, 255, 0.95)";
  ctx.font = "28px 'Space Grotesk', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;
  return sprite;
};

const toggleLabels = () => {
  labelsEnabled = !labelsEnabled;
  orbitLinesEnabled = labelsEnabled;
  if (!labelsEnabled) {
    labels.forEach((sprite) => labelsGroup.remove(sprite));
    labels.clear();
    orbitLines.forEach(({ line }) => {
      line.visible = false;
    });
    return;
  }
  bodies.forEach((body) => {
    const labelText = nameMap[body.name] ?? body.name;
    const sprite = createLabelSprite(labelText, body.name !== "Sun" && body.name !== "Mercury" && body.name !== "Venus" && body.name !== "Earth" && body.name !== "Mars" && body.name !== "Jupiter" && body.name !== "Saturn" && body.name !== "Uranus" && body.name !== "Neptune");
    labels.set(body, sprite);
    labelsGroup.add(sprite);
  });
  orbitLines.forEach(({ line }) => {
    line.visible = true;
  });
};

const applySizeScale = (scale) => {
  sizeScale = scale;
  moveSpeed = baseMoveSpeed * (useRealSize ? 0.45 : 1.0);
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
  } else if (focusTargets[event.code]) {
    focusOn(focusTargets[event.code]);
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

  if (labelsEnabled) {
    labels.forEach((sprite, body) => {
      const offset = new THREE.Vector3(0, body.size * 1.6 + 0.4, 0);
      sprite.position.copy(body.mesh.position).add(offset);
      const distance = camera.position.distanceTo(sprite.position);
      const scale = Math.max(0.6, Math.min(6.0, distance * 0.02));
      sprite.scale.set(scale * 1.4, scale * 0.55, 1);
    });
  }

  updateMovement(dt);
  applyLook();
  renderer.render(scene, camera);
  updateStatus();
};

animate();
