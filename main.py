from panda3d.core import loadPrcFileData
from pathlib import Path
from PIL import Image
from datetime import datetime, timezone
from ursina import (
    Ursina,
    Entity,
    Text,
    Vec3,
    color,
    time,
    window,
    camera,
    held_keys,
    mouse,
    clamp,
    application,
    Circle,
    Audio,
    destroy,
    invoke,
    curve,
    Mesh,
)

loadPrcFileData("", "gl-version 2 1")
loadPrcFileData("", "glsl-version 120")
import math
import itertools
import random

AU = 5.0  # world units per astronomical unit
DEG_PER_TURN = 360.0
TAU = math.tau


class Body(Entity):
    def __init__(
        self,
        name,
        radius,
        visual_scale=1.0,
        orbit_radius_au=0.0,
        orbit_eccentricity=0.0,
        orbit_inclination_deg=0.0,
        orbit_period_days=None,
        rotation_period_days=None,
        orbit_parent=None,
        body_color=color.white,
        texture_name=None,
        tidally_locked=False,
        elements=None,
    ):
        super().__init__(
            name=name,
            model="sphere",
            color=body_color,
            scale=radius * visual_scale,
            texture=texture_name,
        )
        self.orbit_parent = orbit_parent
        self.orbit_radius = orbit_radius_au * AU
        self.orbit_eccentricity = orbit_eccentricity
        self.orbit_inclination_deg = orbit_inclination_deg
        if self.orbit_parent:
            min_orbit = self.orbit_parent.scale_x + (self.scale_x * 1.6)
            self.orbit_radius = max(self.orbit_radius, min_orbit)
        self.orbit_period_days = orbit_period_days
        self.rotation_period_days = rotation_period_days
        self.tidally_locked = tidally_locked
        self.orbit_angle = 0.0
        self.spin_angle = 0.0
        self.elements = elements

        if tidally_locked:
            self.marker = Entity(
                parent=self,
                model="sphere",
                color=color.gray,
                scale=radius * visual_scale * 0.25,
                position=Vec3(0, 0, radius),
            )

    def step(self, dt_days, jd=None):
        if self.elements and self.orbit_parent and jd is not None:
            update_orbit_from_elements(self, jd)
        elif self.orbit_parent and self.orbit_period_days:
            self.orbit_angle += TAU * (dt_days / self.orbit_period_days)
            mean_anomaly = self.orbit_angle % TAU
            e = self.orbit_eccentricity
            E = mean_anomaly
            for _ in range(5):
                E -= (E - e * math.sin(E) - mean_anomaly) / (1 - e * math.cos(E))
            x = self.orbit_radius * (math.cos(E) - e)
            z = self.orbit_radius * math.sqrt(1 - e * e) * math.sin(E)
            pos = Vec3(x, 0, z)
            if self.orbit_inclination_deg:
                inc = math.radians(self.orbit_inclination_deg)
                pos = Vec3(pos.x, pos.z * math.sin(inc), pos.z * math.cos(inc))
            self.position = self.orbit_parent.position + pos

        if self.tidally_locked and self.orbit_parent:
            self.look_at(self.orbit_parent)
        elif self.rotation_period_days:
            self.spin_angle += DEG_PER_TURN * (dt_days / self.rotation_period_days)
            self.rotation_y = self.spin_angle


def build_earth_mesh(heightmap_path, radius, height_scale, lon_steps=128, lat_steps=64):
    heightmap_file = Path("assets") / heightmap_path
    if not heightmap_file.exists():
        print(f"missing heightmap: {heightmap_file}")
        return None

    image = Image.open(heightmap_file).convert("L")
    width, height = image.size
    pixels = image.load()

    vertices = []
    uvs = []
    triangles = []

    for y in range(lat_steps + 1):
        v = y / lat_steps
        lat = math.pi * (v - 0.5)
        cos_lat = math.cos(lat)
        sin_lat = math.sin(lat)
        py = int((1 - v) * (height - 1))
        for x in range(lon_steps + 1):
            u = x / lon_steps
            lon = TAU * (u - 0.5)
            px = int(u * (width - 1))
            height_value = pixels[px, py] / 255.0
            displacement = (height_value - 0.5) * 2 * height_scale
            r = radius + displacement
            vx = r * cos_lat * math.cos(lon)
            vy = r * sin_lat
            vz = r * cos_lat * math.sin(lon)
            vertices.append(Vec3(vx, vy, vz))
            uvs.append((u, v))

    for y in range(lat_steps):
        for x in range(lon_steps):
            i = y * (lon_steps + 1) + x
            i2 = i + lon_steps + 1
            triangles.extend([i, i2, i + 1, i + 1, i2, i2 + 1])

    return Mesh(vertices=vertices, triangles=triangles, uvs=uvs, mode="triangle")


def julian_date(dt):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    year = dt.year
    month = dt.month
    day = dt.day
    hour = dt.hour + dt.minute / 60 + dt.second / 3600 + dt.microsecond / 3_600_000_000
    if month <= 2:
        year -= 1
        month += 12
    A = year // 100
    B = 2 - A + A // 4
    jd = int(365.25 * (year + 4716)) + int(30.6001 * (month + 1)) + day + B - 1524.5
    jd += hour / 24
    return jd


def jd_to_datetime(jd):
    # Inverse of julian_date, for display only.
    jd += 0.5
    Z = int(jd)
    F = jd - Z
    A = Z
    if Z >= 2299161:
        alpha = int((Z - 1867216.25) / 36524.25)
        A = Z + 1 + alpha - int(alpha / 4)
    B = A + 1524
    C = int((B - 122.1) / 365.25)
    D = int(365.25 * C)
    E = int((B - D) / 30.6001)
    day = B - D - int(30.6001 * E) + F
    month = E - 1 if E < 14 else E - 13
    year = C - 4716 if month > 2 else C - 4715
    day_int = int(day)
    frac = day - day_int
    hour = int(frac * 24)
    minute = int((frac * 24 - hour) * 60)
    second = int((((frac * 24 - hour) * 60) - minute) * 60)
    return datetime(year, month, day_int, hour, minute, second, tzinfo=timezone.utc)


def update_orbit_from_elements(body, jd):
    elements = body.elements
    T = (jd - 2451545.0) / 36525.0
    a = (elements["a"] + elements["a_dot"] * T) * AU
    e = elements["e"] + elements["e_dot"] * T
    i = math.radians(elements["i"] + elements["i_dot"] * T)
    Omega = math.radians(elements["Omega"] + elements["Omega_dot"] * T)
    w = math.radians(elements["w"] + elements["w_dot"] * T)
    M = math.radians(elements["M"] + elements["M_dot"] * T) % TAU

    E = M
    for _ in range(6):
        E -= (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
    x_prime = a * (math.cos(E) - e)
    y_prime = a * math.sqrt(1 - e * e) * math.sin(E)

    cos_O = math.cos(Omega)
    sin_O = math.sin(Omega)
    cos_w = math.cos(w)
    sin_w = math.sin(w)
    cos_i = math.cos(i)
    sin_i = math.sin(i)

    x = (cos_O * cos_w - sin_O * sin_w * cos_i) * x_prime + (-cos_O * sin_w - sin_O * cos_w * cos_i) * y_prime
    y = (sin_O * cos_w + cos_O * sin_w * cos_i) * x_prime + (-sin_O * sin_w + cos_O * cos_w * cos_i) * y_prime
    z = (sin_w * sin_i) * x_prime + (cos_w * sin_i) * y_prime

    body.position = body.orbit_parent.position + Vec3(x, z, y)

app = Ursina()
application.asset_folder = Path("assets")
window.title = "Solar System (Approximate)"
window.borderless = False
window.exit_button.visible = False
window.fps_counter.enabled = False
window.fullscreen = True
camera.clear_color = color.rgb(5, 8, 15)

explosion_sound = Audio("sounds/explosion.wav", autoplay=False)
explosion_cooldown = 0.0

milky_way = Entity(
    model="sphere",
    scale=800,
    texture="textures/8k_stars_milky_way.jpg",
    double_sided=True,
)

starfield = Entity()
random.seed(7)
for _ in range(1400):
    radius = 350
    theta = random.uniform(0, TAU)
    band_bias = random.gauss(0.0, 0.35)
    phi = clamp(math.pi / 2 + band_bias, 0.2, math.pi - 0.2)
    x = radius * math.sin(phi) * math.cos(theta)
    y = radius * math.cos(phi)
    z = radius * math.sin(phi) * math.sin(theta)
    size = random.uniform(0.3, 0.8)
    brightness = random.uniform(200, 255)
    star = Entity(
        parent=starfield,
        model="sphere",
        color=color.rgb(brightness, brightness, brightness),
        scale=size,
        position=Vec3(x, y, z),
    )

use_milky_way = True

sun = Body(
    name="Sun",
    radius=1.8,
    body_color=color.rgb(255, 200, 80),
    texture_name="textures/2k_sun.jpg",
    rotation_period_days=25.0,
)
sun.is_moon = False

planets = [
    Body(
        name="Mercury",
        radius=0.18,
        orbit_radius_au=0.387,
        orbit_eccentricity=0.206,
        orbit_period_days=88.0,
        rotation_period_days=58.65,
        orbit_parent=sun,
        body_color=color.rgb(180, 170, 160),
        texture_name="textures/2k_mercury.jpg",
        elements={
            "a": 0.38709927, "a_dot": 0.00000037,
            "e": 0.20563593, "e_dot": 0.00001906,
            "i": 7.00497902, "i_dot": -0.00594749,
            "Omega": 48.33076593, "Omega_dot": -0.12534081,
            "w": 29.124279, "w_dot": 0.010000,
            "M": 168.6562, "M_dot": 149472.6741,
        },
    ),
    Body(
        name="Venus",
        radius=0.28,
        orbit_radius_au=0.723,
        orbit_eccentricity=0.007,
        orbit_period_days=224.7,
        rotation_period_days=-243.02,
        orbit_parent=sun,
        body_color=color.rgb(230, 200, 150),
        texture_name="textures/2k_venus_surface.jpg",
        elements={
            "a": 0.72333566, "a_dot": 0.00000390,
            "e": 0.00677672, "e_dot": -0.00004107,
            "i": 3.39467605, "i_dot": -0.00078890,
            "Omega": 76.67984255, "Omega_dot": -0.27769418,
            "w": 54.922624, "w_dot": 0.013000,
            "M": 48.0052, "M_dot": 58517.8156,
        },
    ),
    Body(
        name="Earth",
        radius=0.3,
        orbit_radius_au=1.000,
        orbit_eccentricity=0.017,
        orbit_period_days=365.2,
        rotation_period_days=0.996,
        orbit_parent=sun,
        body_color=color.rgb(90, 140, 240),
        texture_name="textures/2k_earth_daymap.jpg",
        elements={
            "a": 1.00000261, "a_dot": 0.00000562,
            "e": 0.01671123, "e_dot": -0.00004392,
            "i": -0.00001531, "i_dot": -0.01294668,
            "Omega": 0.0, "Omega_dot": 0.0,
            "w": 102.93768193, "w_dot": 0.32327364,
            "M": 357.51716, "M_dot": 35999.37328,
        },
    ),
    Body(
        name="Mars",
        radius=0.22,
        orbit_radius_au=1.524,
        orbit_eccentricity=0.094,
        orbit_period_days=687.0,
        rotation_period_days=1.025,
        orbit_parent=sun,
        body_color=color.rgb(210, 120, 90),
        texture_name="textures/2k_mars.jpg",
        elements={
            "a": 1.52371034, "a_dot": 0.00001847,
            "e": 0.09339410, "e_dot": 0.00007882,
            "i": 1.84969142, "i_dot": -0.00813131,
            "Omega": 49.55953891, "Omega_dot": -0.29257343,
            "w": 286.537, "w_dot": 0.007000,
            "M": 19.41248, "M_dot": 19140.30268,
        },
    ),
    Body(
        name="Jupiter",
        radius=0.7,
        orbit_radius_au=5.204,
        orbit_eccentricity=0.049,
        orbit_period_days=4331,
        rotation_period_days=0.4125,
        orbit_parent=sun,
        body_color=color.rgb(210, 160, 110),
        texture_name="textures/2k_jupiter.jpg",
        elements={
            "a": 5.20288700, "a_dot": -0.00011607,
            "e": 0.04838624, "e_dot": -0.00013253,
            "i": 1.30439695, "i_dot": -0.00183714,
            "Omega": 100.47390909, "Omega_dot": 0.20469106,
            "w": 273.867, "w_dot": 0.017000,
            "M": 20.0202, "M_dot": 3034.903717,
        },
    ),
    Body(
        name="Saturn",
        radius=0.6,
        orbit_radius_au=9.58,
        orbit_eccentricity=0.052,
        orbit_period_days=10747,
        rotation_period_days=0.4458,
        orbit_parent=sun,
        body_color=color.rgb(220, 200, 140),
        texture_name="textures/2k_saturn.jpg",
        elements={
            "a": 9.53667594, "a_dot": -0.00125060,
            "e": 0.05386179, "e_dot": -0.00050991,
            "i": 2.48599187, "i_dot": 0.00193609,
            "Omega": 113.66242448, "Omega_dot": -0.28867794,
            "w": 339.392, "w_dot": 0.002000,
            "M": 317.0207, "M_dot": 1222.114947,
        },
    ),
    Body(
        name="Uranus",
        radius=0.5,
        orbit_radius_au=19.16,
        orbit_eccentricity=0.047,
        orbit_period_days=30589,
        rotation_period_days=-0.7167,
        orbit_parent=sun,
        body_color=color.rgb(170, 220, 220),
        texture_name="textures/2k_uranus.jpg",
        elements={
            "a": 19.18916464, "a_dot": -0.00196176,
            "e": 0.04725744, "e_dot": -0.00004397,
            "i": 0.77263783, "i_dot": -0.00242939,
            "Omega": 74.01692503, "Omega_dot": 0.04240589,
            "w": 96.998857, "w_dot": 0.002000,
            "M": 142.2386, "M_dot": 428.495125,
        },
    ),
    Body(
        name="Neptune",
        radius=0.5,
        orbit_radius_au=30.17,
        orbit_eccentricity=0.010,
        orbit_period_days=59800,
        rotation_period_days=0.6708,
        orbit_parent=sun,
        body_color=color.rgb(90, 120, 220),
        texture_name="textures/2k_neptune.jpg",
        elements={
            "a": 30.06992276, "a_dot": 0.00026291,
            "e": 0.00859048, "e_dot": 0.00005105,
            "i": 1.77004347, "i_dot": 0.00035372,
            "Omega": 131.78422574, "Omega_dot": -0.00508664,
            "w": 273.187, "w_dot": 0.000000,
            "M": 256.228, "M_dot": 218.465153,
        },
    ),
]
for planet in planets:
    planet.is_moon = False

earth = planets[2]
earth_mesh = build_earth_mesh(
    "textures/earthbump1k.jpg",
    radius=1.0,
    height_scale=0.012,
    lon_steps=96,
    lat_steps=48,
)
if earth_mesh:
    earth.model = earth_mesh
    earth.texture = "textures/2k_earth_daymap.jpg"

moon = Body(
    name="Moon",
    radius=0.1,
    visual_scale=0.6,
    orbit_radius_au=0.08,
    orbit_eccentricity=0.0549,
    orbit_inclination_deg=5.145,
    orbit_period_days=27.3217,
    rotation_period_days=None,
    orbit_parent=planets[2],
    body_color=color.rgb(200, 200, 210),
    texture_name="textures/2k_moon.jpg",
    tidally_locked=True,
)
moon.is_moon = True

bodies = [sun] + planets + [moon]

moon_defs = [
    ("Phobos", planets[3], 0.00006, 0.32, 0.06, 0.0, 1.093, color.rgb(160, 150, 140)),
    ("Deimos", planets[3], 0.00016, 1.26, 0.05, 0.0, 0.93, color.rgb(170, 160, 150)),
    ("Io", planets[4], 0.0028, 1.76914, 0.09, 0.0, 0.04, color.rgb(220, 200, 120)),
    ("Europa", planets[4], 0.0045, 3.55118, 0.08, 0.0, 0.47, color.rgb(200, 210, 230)),
    ("Ganymede", planets[4], 0.0071, 7.15455, 0.11, 0.0, 0.18, color.rgb(190, 180, 170)),
    ("Callisto", planets[4], 0.0126, 16.68902, 0.1, 0.0, 0.19, color.rgb(150, 140, 130)),
    ("Titan", planets[5], 0.0082, 15.94542, 0.11, 0.0, 0.30, color.rgb(210, 170, 120)),
    ("Enceladus", planets[5], 0.0016, 1.37022, 0.05, 0.0, 0.03, color.rgb(230, 230, 235)),
    ("Rhea", planets[5], 0.0035, 4.51750, 0.08, 0.0, 0.35, color.rgb(200, 200, 205)),
    ("Iapetus", planets[5], 0.0238, 79.33018, 0.09, 0.0, 18.5, color.rgb(170, 160, 150)),
    ("Dione", planets[5], 0.0025, 2.74, 0.07, 0.0, 0.01, color.rgb(210, 210, 215)),
    ("Tethys", planets[5], 0.0020, 1.89, 0.06, 0.0, 1.10, color.rgb(210, 210, 220)),
    ("Titania", planets[6], 0.0029, 8.71, 0.09, 0.0, 0.08, color.rgb(180, 170, 160)),
    ("Oberon", planets[6], 0.0039, 13.46, 0.09, 0.0, 0.07, color.rgb(170, 160, 150)),
    ("Ariel", planets[6], 0.0013, 2.52, 0.07, 0.0, 0.04, color.rgb(200, 190, 180)),
    ("Umbriel", planets[6], 0.0018, 4.14, 0.07, 0.0, 0.13, color.rgb(150, 140, 130)),
    ("Miranda", planets[6], 0.0009, 1.41, 0.05, 0.0, 4.34, color.rgb(190, 180, 170)),
    ("Triton", planets[7], 0.0024, -5.87685, 0.1, 0.0, 157.345, color.rgb(200, 210, 220)),
    ("Proteus", planets[7], 0.0012, 1.12, 0.06, 0.0, 0.04, color.rgb(150, 140, 130)),
]

for name, parent, orbit_radius_au, orbit_period_days, radius, orbit_eccentricity, orbit_inclination_deg, body_color in moon_defs:
    m = Body(
            name=name,
            radius=radius,
            visual_scale=0.6,
            orbit_radius_au=orbit_radius_au,
            orbit_period_days=orbit_period_days,
            orbit_eccentricity=orbit_eccentricity,
            rotation_period_days=None,
            orbit_inclination_deg=orbit_inclination_deg,
            orbit_parent=parent,
            body_color=body_color,
            tidally_locked=True,
        )
    m.is_moon = True
    bodies.append(m)

def make_ring_mesh(inner_radius, outer_radius, segments=128):
    vertices = []
    triangles = []
    uvs = []
    for i in range(segments):
        a0 = TAU * i / segments
        a1 = TAU * (i + 1) / segments
        inner0 = Vec3(math.cos(a0) * inner_radius, 0, math.sin(a0) * inner_radius)
        outer0 = Vec3(math.cos(a0) * outer_radius, 0, math.sin(a0) * outer_radius)
        inner1 = Vec3(math.cos(a1) * inner_radius, 0, math.sin(a1) * inner_radius)
        outer1 = Vec3(math.cos(a1) * outer_radius, 0, math.sin(a1) * outer_radius)
        base = len(vertices)
        vertices.extend([inner0, outer0, outer1, inner1])
        triangles.extend([base, base + 1, base + 2, base, base + 2, base + 3])
        v0 = i / segments
        v1 = (i + 1) / segments
        uvs.extend([(0, v0), (1, v0), (1, v1), (0, v1)])
    return Mesh(vertices=vertices, triangles=triangles, uvs=uvs, mode="triangle")


def make_orbit_ellipse_mesh(semi_major, eccentricity, segments=128):
    vertices = []
    a = semi_major
    e = eccentricity
    b = a * math.sqrt(1 - e * e)
    for i in range(segments + 1):
        t = TAU * i / segments
        x = a * math.cos(t) - a * e
        z = b * math.sin(t)
        vertices.append(Vec3(x, 0, z))
    return Mesh(vertices=vertices, mode="line")

def make_orbit_path_from_elements(elements, jd, segments=128):
    T = (jd - 2451545.0) / 36525.0
    a = (elements["a"] + elements["a_dot"] * T) * AU
    e = elements["e"] + elements["e_dot"] * T
    i = math.radians(elements["i"] + elements["i_dot"] * T)
    Omega = math.radians(elements["Omega"] + elements["Omega_dot"] * T)
    w = math.radians(elements["w"] + elements["w_dot"] * T)

    cos_O = math.cos(Omega)
    sin_O = math.sin(Omega)
    cos_w = math.cos(w)
    sin_w = math.sin(w)
    cos_i = math.cos(i)
    sin_i = math.sin(i)

    vertices = []
    for s in range(segments + 1):
        M = TAU * s / segments
        E = M
        for _ in range(6):
            E -= (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
        x_prime = a * (math.cos(E) - e)
        y_prime = a * math.sqrt(1 - e * e) * math.sin(E)

        x = (cos_O * cos_w - sin_O * sin_w * cos_i) * x_prime + (-cos_O * sin_w - sin_O * cos_w * cos_i) * y_prime
        y = (sin_O * cos_w + cos_O * sin_w * cos_i) * x_prime + (-sin_O * sin_w + cos_O * cos_w * cos_i) * y_prime
        z = (sin_w * sin_i) * x_prime + (cos_w * sin_i) * y_prime
        vertices.append(Vec3(x, z, y))
    return Mesh(vertices=vertices, mode="line")


orbit_rings = []
for body in bodies:
    if body is sun or not body.orbit_parent or body.orbit_radius <= 0:
        continue
    if body.elements:
        ring_model = make_orbit_path_from_elements(body.elements, julian_date(datetime(2026, 1, 16, tzinfo=timezone.utc)))
    else:
        ring_model = make_orbit_ellipse_mesh(body.orbit_radius, body.orbit_eccentricity)
    ring = Entity(
        model=ring_model,
        color=color.rgba(255, 255, 255, 40),
        position=body.orbit_parent.position,
    )
    orbit_rings.append((ring, body.orbit_parent, body))

planet_rings = []
ring_defs = [
    (planets[4], 1.2, 1.5, 3.13, color.rgba(200, 190, 170, 40), None),  # Jupiter faint ring
    (planets[5], 1.3, 2.6, 26.73, color.white, "textures/2k_saturn_ring_alpha.png"),  # Saturn
    (planets[6], 1.2, 1.7, 97.77, color.rgba(190, 210, 210, 50), None),  # Uranus
    (planets[7], 1.3, 1.8, 28.32, color.rgba(170, 180, 200, 40), None),  # Neptune
]
for planet, inner_mult, outer_mult, tilt_deg, ring_color, ring_texture in ring_defs:
    inner_radius = planet.scale_x * inner_mult
    outer_radius = planet.scale_x * outer_mult
    ring = Entity(
        model=make_ring_mesh(inner_radius, outer_radius),
        color=ring_color,
        texture=ring_texture,
        double_sided=True,
        position=planet.position,
    )
    ring.rotation_x = -tilt_deg
    planet_rings.append((ring, planet, tilt_deg))

random.seed(7)
asteroids = []
for _ in range(260):
    radius_au = random.uniform(2.2, 3.2)
    angle = random.uniform(0, TAU)
    height = random.uniform(-0.05, 0.05)
    size = random.uniform(0.015, 0.04)
    asteroid = Entity(
        model="sphere",
        color=color.rgb(140, 130, 120),
        scale=size,
        position=Vec3(math.cos(angle) * radius_au * AU, height * AU, math.sin(angle) * radius_au * AU),
    )
    asteroids.append(asteroid)

camera.fov = 70
camera.position = Vec3(0, 0, 0)
mouse.locked = False
mouse.visible = False
camera_pivot = Entity(position=Vec3(0, 15, -35))
camera.parent = camera_pivot

hud = Text(
    text="",
    position=(-0.72, 0.44),
    scale=0.88,
    origin=(-0.5, 0.5),
    background=True,
)

TIME_SCALE_DEFAULT = 12.0
ZOOM_STEP = 1.5
MOVE_SPEED = 12.0
LOOK_SPEED = 80.0
LOOK_BOOST = 2.5
LOOK_DEADZONE = 0.0015
ACCELERATION = 10.0
DAMPING = 2.8
MAX_SPEED = 80.0
ROLL_SPEED = 70.0
CAMERA_RADIUS = 0.05
COLLISION_SPEED_MIN = 2.5

time_scale = TIME_SCALE_DEFAULT
sim_jd = julian_date(datetime(2026, 1, 16, tzinfo=timezone.utc))
paused = False
look_y = 0.0
look_x = 0.0
use_absolute_mouse = True
last_mouse_pos = Vec3(0, 0, 0)
focus_target = None
focus_offset = Vec3(0, 0, 0)
velocity = Vec3(0, 0, 0)
AROSA_LAT = 46.7797248
AROSA_LON = 9.6781356
home_follow = False
home_lat = AROSA_LAT
home_lon = AROSA_LON
labels_enabled = False
labels = []

for ring, _, __ in orbit_rings:
    ring.enabled = labels_enabled
for ring, _, __ in planet_rings:
    ring.enabled = labels_enabled


focus_targets = {
    "1": sun,
    "2": planets[0],
    "3": planets[1],
    "4": planets[2],
    "5": planets[3],
    "6": planets[4],
    "7": planets[5],
    "8": planets[6],
    "9": planets[7],
}


def focus_on(body):
    global look_x, look_y
    size = body.scale_x
    offset = Vec3(0, size * 6, -size * 12)
    global focus_target, focus_offset
    focus_target = body
    focus_offset = offset
    camera_pivot.position = body.position + offset
    camera_pivot.look_at(body)
    camera.rotation = Vec3(0, 0, 0)
    look_y = camera_pivot.rotation_y
    look_x = camera.rotation_x


def set_view_from_earth(lat_deg, lon_deg, altitude=0.02):
    global look_x, look_y, focus_target, home_follow, home_lat, home_lon
    focus_target = None
    home_follow = True
    home_lat = lat_deg
    home_lon = lon_deg
    earth = planets[2]
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    radius = earth.scale_x + altitude
    normal = Vec3(
        math.cos(lat) * math.cos(lon),
        math.sin(lat),
        math.cos(lat) * math.sin(lon),
    )
    camera_pivot.position = earth.position + normal * radius
    camera_pivot.look_at(earth.position + normal * 2)
    camera.rotation = Vec3(0, 0, 0)
    look_y = camera_pivot.rotation_y
    look_x = camera.rotation_x


def input(key):
    global time_scale, paused, use_absolute_mouse, last_mouse_pos, use_milky_way, focus_target, home_follow, labels_enabled, labels

    if key == "space":
        paused = not paused
    elif key == "escape":
        if not use_absolute_mouse:
            mouse.locked = not mouse.locked
            mouse.visible = not mouse.locked
    elif key == "left mouse down" and not mouse.locked:
        if not use_absolute_mouse:
            mouse.locked = True
            mouse.visible = False
    elif key == "f":
        window.fullscreen = not window.fullscreen
        mouse.locked = False
        mouse.visible = False
        last_mouse_pos = mouse.position
    elif key == "b":
        use_milky_way = not use_milky_way
        milky_way.enabled = use_milky_way
        starfield.enabled = not use_milky_way
    elif key == "e":
        time_scale *= 1.25
    elif key == "q":
        time_scale /= 1.25
    elif key == "r":
        time_scale = TIME_SCALE_DEFAULT
    elif key == "h":
        set_view_from_earth(AROSA_LAT, AROSA_LON)
    elif key == "n":
        labels_enabled = not labels_enabled
        for ring, _, __ in orbit_rings:
            ring.enabled = labels_enabled
        for ring, _, __ in planet_rings:
            ring.enabled = labels_enabled
        if labels_enabled:
            name_map = {
                "Sun": "Sonne",
                "Mercury": "Merkur",
                "Venus": "Venus",
                "Earth": "Erde",
                "Mars": "Mars",
                "Jupiter": "Jupiter",
                "Saturn": "Saturn",
                "Uranus": "Uranus",
                "Neptune": "Neptun",
                "Moon": "Mond",
                "Phobos": "Phobos",
                "Deimos": "Deimos",
                "Io": "Io",
                "Europa": "Europa",
                "Ganymede": "Ganymed",
                "Callisto": "Kallisto",
                "Titan": "Titan",
                "Enceladus": "Enceladus",
                "Rhea": "Rhea",
                "Iapetus": "Japetus",
                "Dione": "Dione",
                "Tethys": "Tethys",
                "Titania": "Titania",
                "Oberon": "Oberon",
                "Ariel": "Ariel",
                "Umbriel": "Umbriel",
                "Miranda": "Miranda",
                "Triton": "Triton",
                "Proteus": "Proteus",
            }
            labels = [
                (
                    body,
                    Text(
                        text=name_map.get(body.name, body.name),
                        parent=camera.ui,
                        position=Vec3(0, 0, 0),
                        scale=1.8,
                        origin=(0, 0),
                        color=color.rgba(140, 140, 140, 220) if getattr(body, "is_moon", False) else color.white,
                    ),
                )
                for body in bodies
            ]
        else:
            for _, label in labels:
                destroy(label)
            labels = []
    elif key in focus_targets:
        focus_on(focus_targets[key])



def closest_pair(bodies_to_compare):
    closest = None
    for a, b in itertools.combinations(bodies_to_compare, 2):
        dist = (a.position - b.position).length()
        if closest is None or dist < closest[2]:
            closest = (a, b, dist)
    return closest


def spawn_explosion(position, size=1.0):
    flash = Entity(
        model="sphere",
        color=color.rgba(255, 200, 80, 180),
        scale=0.2,
        position=position,
        double_sided=True,
    )
    flash.animate_scale(size, duration=0.25, curve=curve.out_expo)
    flash.animate_color(color.rgba(255, 80, 20, 0), duration=0.35)
    invoke(destroy, flash, delay=0.4)


def update():
    global look_x, look_y, last_mouse_pos, focus_target, velocity, home_follow, sim_jd

    if paused:
        dt_days = 0.0
    else:
        dt_days = time.dt * time_scale
        sim_jd += dt_days

    if use_absolute_mouse:
        delta = mouse.position - last_mouse_pos
        mouse.position = Vec3(0, 0, 0)
        last_mouse_pos = Vec3(0, 0, 0)
        if abs(delta.x) < LOOK_DEADZONE:
            delta_x = 0.0
        else:
            delta_x = delta.x
        if abs(delta.y) < LOOK_DEADZONE:
            delta_y = 0.0
        else:
            delta_y = delta.y
    elif mouse.locked:
        delta_x = mouse.velocity[0]
        delta_y = mouse.velocity[1]
    else:
        delta_x = 0.0
        delta_y = 0.0

    if mouse.locked or use_absolute_mouse:
        speed = LOOK_SPEED * (LOOK_BOOST if held_keys["shift"] else 1.0)
        look_y += delta_x * speed
        look_x -= delta_y * speed
        look_x = clamp(look_x, -80, 80)

        camera_pivot.rotation_y = look_y
        camera.rotation_x = look_x
        camera.position = Vec3(0, 0, 0)
    else:
        look_y = camera_pivot.rotation_y
        look_x = camera.rotation_x

    if focus_target is not None:
        camera_pivot.position = focus_target.position + focus_offset
        camera_pivot.look_at(focus_target)

    if home_follow:
        earth = planets[2]
        lat = math.radians(home_lat)
        lon = math.radians(home_lon)
        normal_local = Vec3(
            math.cos(lat) * math.cos(lon),
            math.sin(lat),
            math.cos(lat) * math.sin(lon),
        )
        rot = math.radians(earth.rotation_y)
        normal = Vec3(
            normal_local.x * math.cos(rot) - normal_local.z * math.sin(rot),
            normal_local.y,
            normal_local.x * math.sin(rot) + normal_local.z * math.cos(rot),
        )
        camera_pivot.position = earth.position + normal * (earth.scale_x + 0.02)

    move_dir = Vec3(
        held_keys["d"] - held_keys["a"],
        held_keys["r"] - held_keys["f"],
        held_keys["w"] - held_keys["s"],
    )
    if move_dir.length() > 0:
        if focus_target is not None:
            focus_target = None
        home_follow = False
        forward = camera.forward.normalized()
        right = camera.right.normalized()
        up = camera.up.normalized()
        thrust_dir = (right * move_dir.x + up * move_dir.y + forward * move_dir.z).normalized()
        boost = 2.0 if held_keys["shift"] else 1.0
        velocity += thrust_dir * ACCELERATION * boost * time.dt

    if held_keys["z"]:
        camera_pivot.rotation_z += ROLL_SPEED * time.dt
    if held_keys["x"]:
        camera_pivot.rotation_z -= ROLL_SPEED * time.dt

    global explosion_cooldown
    explosion_cooldown = max(0.0, explosion_cooldown - time.dt)

    speed = velocity.length()
    if speed > 0:
        velocity -= velocity * min(1.0, DAMPING * time.dt)
        if speed > MAX_SPEED:
            velocity = velocity.normalized() * MAX_SPEED
        next_pos = camera_pivot.position + velocity * time.dt
        if focus_target is None and speed >= COLLISION_SPEED_MIN:
            for body in bodies + asteroids:
                to_cam = next_pos - body.position
                dist = to_cam.length()
                min_dist = body.scale_x * 0.97 + CAMERA_RADIUS
                if dist < min_dist and dist > 0:
                    next_pos = body.position + to_cam.normalized() * min_dist
                    velocity = Vec3(0, 0, 0)
                    if explosion_cooldown == 0.0:
                        spawn_explosion(next_pos, size=body.scale_x * 1.6)
                        explosion_sound.play()
                        explosion_cooldown = 0.6
        camera_pivot.position = next_pos

    for body in bodies:
        body.step(dt_days, jd=sim_jd)

    for ring, parent, body in orbit_rings:
        ring.position = parent.position
        if body.elements:
            ring.model = make_orbit_path_from_elements(body.elements, sim_jd)
            ring.rotation = Vec3(0, 0, 0)
        else:
            ring.rotation_x = -body.orbit_inclination_deg

    for ring, planet, tilt_deg in planet_rings:
        ring.position = planet.position
        ring.rotation_x = -tilt_deg

    if labels_enabled:
        for body, label in labels:
            screen_pos = body.screen_position
            label.position = Vec3(screen_pos.x, screen_pos.y, 0)
            label.scale = 1.8
            if getattr(body, "is_moon", False) and body.orbit_parent and body.orbit_parent is not sun:
                parent_pos = body.orbit_parent.screen_position
                if (screen_pos - parent_pos).length() < 0.08:
                    label.enabled = False
                else:
                    label.enabled = True
            else:
                label.enabled = True

    status = "paused" if paused else "running"
    if use_absolute_mouse:
        mouse_status = "absolute"
    else:
        mouse_status = "locked" if mouse.locked else "unlocked (click to lock)"
    sim_dt = jd_to_datetime(sim_jd)
    hud.text = (
        f"Sim time (UTC): {sim_dt.strftime('%Y-%m-%d %H:%M')}\n"
        f"Time scale: {time_scale:.2f} days/sec ({status})\n"
        f"Controls: WASD move, r/f up/down, z/x roll, mouse look ({mouse_status}), shift boost, q/e speed, space pause, r reset, h home, 1-9 focus, n names, esc mouse, f fullscreen, b background"
    )


app.run()
