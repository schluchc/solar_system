from panda3d.core import loadPrcFileData
from pathlib import Path
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
        orbit_period_days=None,
        rotation_period_days=None,
        orbit_parent=None,
        body_color=color.white,
        texture_name=None,
        tidally_locked=False,
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
        if self.orbit_parent:
            min_orbit = self.orbit_parent.scale_x * 1.2
            self.orbit_radius = max(self.orbit_radius, min_orbit)
        self.orbit_period_days = orbit_period_days
        self.rotation_period_days = rotation_period_days
        self.tidally_locked = tidally_locked
        self.orbit_angle = 0.0
        self.spin_angle = 0.0

        if tidally_locked:
            self.marker = Entity(
                parent=self,
                model="sphere",
                color=color.gray,
                scale=radius * visual_scale * 0.25,
                position=Vec3(0, 0, radius),
            )

    def step(self, dt_days):
        if self.orbit_parent and self.orbit_period_days:
            self.orbit_angle += TAU * (dt_days / self.orbit_period_days)
            offset = Vec3(math.cos(self.orbit_angle), 0, math.sin(self.orbit_angle))
            self.position = self.orbit_parent.position + offset * self.orbit_radius

        if self.tidally_locked and self.orbit_parent:
            self.look_at(self.orbit_parent)
        elif self.rotation_period_days:
            self.spin_angle += DEG_PER_TURN * (dt_days / self.rotation_period_days)
            self.rotation_y = self.spin_angle


app = Ursina()
application.asset_folder = Path("assets")
window.title = "Solar System (Approximate)"
window.borderless = False
window.exit_button.visible = False
window.fps_counter.enabled = False
window.fullscreen = True
camera.clear_color = color.rgb(5, 8, 15)

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
)

planets = [
    Body(
        name="Mercury",
        radius=0.18,
        orbit_radius_au=0.39,
        orbit_period_days=88,
        rotation_period_days=58.6,
        orbit_parent=sun,
        body_color=color.rgb(180, 170, 160),
        texture_name="textures/2k_mercury.jpg",
    ),
    Body(
        name="Venus",
        radius=0.28,
        orbit_radius_au=0.72,
        orbit_period_days=225,
        rotation_period_days=-243,
        orbit_parent=sun,
        body_color=color.rgb(230, 200, 150),
        texture_name="textures/2k_venus_surface.jpg",
    ),
    Body(
        name="Earth",
        radius=0.3,
        orbit_radius_au=1.0,
        orbit_period_days=365,
        rotation_period_days=1.0,
        orbit_parent=sun,
        body_color=color.rgb(90, 140, 240),
        texture_name="textures/2k_earth_daymap.jpg",
    ),
    Body(
        name="Mars",
        radius=0.22,
        orbit_radius_au=1.52,
        orbit_period_days=687,
        rotation_period_days=1.03,
        orbit_parent=sun,
        body_color=color.rgb(210, 120, 90),
        texture_name="textures/2k_mars.jpg",
    ),
    Body(
        name="Jupiter",
        radius=0.7,
        orbit_radius_au=5.2,
        orbit_period_days=4332,
        rotation_period_days=0.41,
        orbit_parent=sun,
        body_color=color.rgb(210, 160, 110),
        texture_name="textures/2k_jupiter.jpg",
    ),
    Body(
        name="Saturn",
        radius=0.6,
        orbit_radius_au=9.58,
        orbit_period_days=10759,
        rotation_period_days=0.44,
        orbit_parent=sun,
        body_color=color.rgb(220, 200, 140),
        texture_name="textures/2k_saturn.jpg",
    ),
    Body(
        name="Uranus",
        radius=0.5,
        orbit_radius_au=19.2,
        orbit_period_days=30688,
        rotation_period_days=-0.72,
        orbit_parent=sun,
        body_color=color.rgb(170, 220, 220),
        texture_name="textures/2k_uranus.jpg",
    ),
    Body(
        name="Neptune",
        radius=0.5,
        orbit_radius_au=30.05,
        orbit_period_days=60182,
        rotation_period_days=0.67,
        orbit_parent=sun,
        body_color=color.rgb(90, 120, 220),
        texture_name="textures/2k_neptune.jpg",
    ),
]

moon = Body(
    name="Moon",
    radius=0.1,
    visual_scale=1.0,
    orbit_radius_au=0.08,
    orbit_period_days=27.3,
    rotation_period_days=None,
    orbit_parent=planets[2],
    body_color=color.rgb(200, 200, 210),
    texture_name="textures/2k_moon.jpg",
    tidally_locked=True,
)

bodies = [sun] + planets + [moon]

moon_defs = [
    ("Phobos", planets[3], 0.00006, 0.32, 0.06, color.rgb(160, 150, 140)),
    ("Deimos", planets[3], 0.00016, 1.26, 0.05, color.rgb(170, 160, 150)),
    ("Io", planets[4], 0.0028, 1.77, 0.09, color.rgb(220, 200, 120)),
    ("Europa", planets[4], 0.0045, 3.55, 0.08, color.rgb(200, 210, 230)),
    ("Ganymede", planets[4], 0.0071, 7.15, 0.11, color.rgb(190, 180, 170)),
    ("Callisto", planets[4], 0.0126, 16.69, 0.1, color.rgb(150, 140, 130)),
    ("Titan", planets[5], 0.0082, 15.95, 0.11, color.rgb(210, 170, 120)),
    ("Enceladus", planets[5], 0.0016, 1.37, 0.05, color.rgb(230, 230, 235)),
    ("Rhea", planets[5], 0.0035, 4.52, 0.08, color.rgb(200, 200, 205)),
    ("Iapetus", planets[5], 0.0238, 79.3, 0.09, color.rgb(170, 160, 150)),
    ("Dione", planets[5], 0.0025, 2.74, 0.07, color.rgb(210, 210, 215)),
    ("Tethys", planets[5], 0.0020, 1.89, 0.06, color.rgb(210, 210, 220)),
    ("Titania", planets[6], 0.0029, 8.71, 0.09, color.rgb(180, 170, 160)),
    ("Oberon", planets[6], 0.0039, 13.46, 0.09, color.rgb(170, 160, 150)),
    ("Ariel", planets[6], 0.0013, 2.52, 0.07, color.rgb(200, 190, 180)),
    ("Umbriel", planets[6], 0.0018, 4.14, 0.07, color.rgb(150, 140, 130)),
    ("Miranda", planets[6], 0.0009, 1.41, 0.05, color.rgb(190, 180, 170)),
    ("Triton", planets[7], 0.0024, -5.88, 0.1, color.rgb(200, 210, 220)),
    ("Proteus", planets[7], 0.0012, 1.12, 0.06, color.rgb(150, 140, 130)),
]

for name, parent, orbit_radius_au, orbit_period_days, radius, body_color in moon_defs:
    bodies.append(
        Body(
            name=name,
            radius=radius,
            visual_scale=1.0,
            orbit_radius_au=orbit_radius_au,
            orbit_period_days=orbit_period_days,
            rotation_period_days=None,
            orbit_parent=parent,
            body_color=body_color,
            tidally_locked=True,
        )
    )

orbit_rings = []
for body in bodies:
    if body is sun or not body.orbit_parent or body.orbit_radius <= 0:
        continue
    ring = Entity(
        model=Circle(resolution=128, mode="line", thickness=2),
        scale=body.orbit_radius * 2,
        rotation_x=90,
        color=color.rgba(255, 255, 255, 40),
        position=body.orbit_parent.position,
    )
    orbit_rings.append((ring, body.orbit_parent))

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
    position=(-0.85, 0.45),
    scale=1.2,
    origin=(0, 0),
    background=True,
)

TIME_SCALE_DEFAULT = 12.0
ZOOM_STEP = 1.5
MOVE_SPEED = 12.0
LOOK_SPEED = 80.0
LOOK_BOOST = 2.5
LOOK_DEADZONE = 0.0015

time_scale = TIME_SCALE_DEFAULT
paused = False
look_y = 0.0
look_x = 0.0
use_absolute_mouse = True
last_mouse_pos = Vec3(0, 0, 0)
focus_target = None
focus_offset = Vec3(0, 0, 0)


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


def input(key):
    global time_scale, paused, use_absolute_mouse, last_mouse_pos, use_milky_way, focus_target

    if key == "space":
        paused = not paused
    elif key == "z":
        camera.position += camera.forward * ZOOM_STEP
    elif key == "x":
        camera.position -= camera.forward * ZOOM_STEP
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
    elif key == "c":
        focus_target = None
    elif key == "e":
        time_scale *= 1.25
    elif key == "q":
        time_scale /= 1.25
    elif key == "r":
        time_scale = TIME_SCALE_DEFAULT
    elif key in focus_targets:
        focus_on(focus_targets[key])



def closest_pair(bodies_to_compare):
    closest = None
    for a, b in itertools.combinations(bodies_to_compare, 2):
        dist = (a.position - b.position).length()
        if closest is None or dist < closest[2]:
            closest = (a, b, dist)
    return closest


def update():
    global look_x, look_y, last_mouse_pos, focus_target

    if paused:
        dt_days = 0.0
    else:
        dt_days = time.dt * time_scale

    if use_absolute_mouse:
        delta = mouse.position - last_mouse_pos
        last_mouse_pos = mouse.position
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
    else:
        look_y = camera_pivot.rotation_y
        look_x = camera.rotation_x

    if focus_target is not None:
        camera_pivot.position = focus_target.position + focus_offset
        camera_pivot.look_at(focus_target)

    move_dir = Vec3(
        held_keys["d"] - held_keys["a"],
        0,
        held_keys["w"] - held_keys["s"],
    )
    if move_dir.length() > 0:
        if focus_target is not None:
            focus_target = None
        forward = Vec3(camera_pivot.forward.x, 0, camera_pivot.forward.z).normalized()
        right = Vec3(camera_pivot.right.x, 0, camera_pivot.right.z).normalized()
        camera_pivot.position += (
            (forward * move_dir.z + right * move_dir.x) * MOVE_SPEED * time.dt
        )

    for body in bodies:
        body.step(dt_days)

    for ring, parent in orbit_rings:
        ring.position = parent.position

    closest = closest_pair(planets)
    if closest:
        a, b, dist = closest
        closest_text = f"{a.name} - {b.name}: {dist / AU:.2f} AU"
    else:
        closest_text = "n/a"

    status = "paused" if paused else "running"
    if use_absolute_mouse:
        mouse_status = "absolute"
    else:
        mouse_status = "locked" if mouse.locked else "unlocked (click to lock)"
    hud.text = (
        f"Time scale: {time_scale:.2f} days/sec ({status})\n"
        f"Closest planets: {closest_text}\n"
        f"Controls: WASD move, mouse look ({mouse_status}), shift=fast look, z/x zoom, q/e speed, space pause, r reset, 1-9 focus, c clear focus, esc mouse, f fullscreen, b background"
    )


app.run()
