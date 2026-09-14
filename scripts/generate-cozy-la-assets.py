#!/usr/bin/env python3
"""Generate a small reusable low-poly Los Angeles Site Twin asset pack.

Run with:
  blender --background --python scripts/generate-cozy-la-assets.py

Outputs GLBs plus a preview render and manifest under:
  apps/site-twin-demo/public/assets/site-twin/
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "site-twin-demo" / "public" / "assets" / "site-twin"
OUT.mkdir(parents=True, exist_ok=True)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        # Materials are rebuilt per asset on purpose so each GLB is self-contained.
        if datablocks is bpy.data.materials:
            continue
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def mat(name: str, color: str, roughness=0.82, metallic=0.0):
    key = f"asset_{name}_{color}"
    existing = bpy.data.materials.get(key)
    if existing:
        return existing
    value = color.lstrip("#")
    rgb = tuple(int(value[i:i+2], 16) / 255 for i in (0, 2, 4))
    material = bpy.data.materials.new(key)
    material.diffuse_color = (*rgb, 1.0)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return material


M = {
    "trunk": ("trunk", "#78553c", 0.95, 0.0),
    "oak": ("oak", "#64865d", 0.94, 0.0),
    "oak2": ("oak2", "#78976a", 0.94, 0.0),
    "palm": ("palm", "#638457", 0.94, 0.0),
    "palm2": ("palm2", "#78955e", 0.94, 0.0),
    "purple": ("purple", "#8e76a8", 0.9, 0.0),
    "purple2": ("purple2", "#a489b9", 0.9, 0.0),
    "flower": ("flower", "#bd5e76", 0.9, 0.0),
    "flower2": ("flower2", "#d2768d", 0.9, 0.0),
    "concrete": ("concrete", "#b9b4a8", 0.95, 0.0),
    "concrete2": ("concrete2", "#d0cbbf", 0.94, 0.0),
    "asphalt": ("asphalt", "#4a5458", 0.96, 0.0),
    "wood": ("wood", "#8c6544", 0.92, 0.0),
    "metal": ("metal", "#6f7777", 0.62, 0.22),
    "dark": ("dark", "#263239", 0.55, 0.06),
    "glass": ("glass", "#658493", 0.25, 0.05),
    "white": ("white", "#e8e4d9", 0.82, 0.0),
    "sage": ("sage", "#91a48b", 0.84, 0.0),
    "blue": ("blue", "#718896", 0.84, 0.0),
    "red": ("red", "#a95745", 0.82, 0.0),
    "tire": ("tire", "#23282a", 0.9, 0.0),
    "hydrant": ("hydrant", "#d4a548", 0.72, 0.04),
}


def material(name):
    return mat(*M[name])


def set_material(obj, name):
    obj.data.materials.append(material(name))
    return obj


def cube(name, location, scale, material_name, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_material(obj, material_name)
    if bevel > 0:
        modifier = obj.modifiers.new("soft_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def cylinder(name, location, radius, depth, material_name, vertices=8, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    set_material(obj, material_name)
    return obj


def sphere(name, location, radius, material_name, scale=(1, 1, 1), subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_material(obj, material_name)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def export_asset(name: str, builder):
    reset_scene()
    builder()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(OUT / f"{name}.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )


def build_live_oak():
    cylinder("trunk", (0, 0, 1.25), 0.2, 2.5, "trunk", 9)
    for i, (loc, radius, scale) in enumerate([
        ((0, 0, 3.2), 1.25, (1.25, 1.0, 0.78)),
        ((0.9, 0.05, 3.25), 0.95, (1.15, 0.95, 0.78)),
        ((-0.85, -0.12, 3.1), 0.98, (1.2, 0.95, 0.8)),
        ((0.18, 0.72, 3.55), 0.82, (1.0, 0.85, 0.72)),
    ]):
        sphere(f"canopy_{i}", loc, radius, "oak2" if i % 2 else "oak", scale)


def build_palm():
    bpy.ops.mesh.primitive_cone_add(vertices=9, radius1=0.26, radius2=0.14, depth=5.3, location=(0, 0, 2.65))
    set_material(bpy.context.object, "trunk")
    sphere("crown", (0, 0, 5.35), 0.42, "palm", (1, 1, 0.7))
    for i in range(10):
        a = (math.pi * 2 * i / 10) + (0.18 if i % 2 else 0)
        length = 1.75 + (i % 3) * 0.12
        x = math.cos(a) * length * 0.48
        y = math.sin(a) * length * 0.48
        z = 5.45 - (i % 2) * 0.16
        leaf = sphere(f"frond_{i}", (x, y, z), 0.55, "palm2" if i % 2 else "palm", (2.25, 0.32, 0.12), 1)
        leaf.rotation_euler[2] = a
        leaf.rotation_euler[1] = -0.18 if i % 2 else 0.08


def build_jacaranda():
    cylinder("trunk", (0, 0, 1.15), 0.17, 2.3, "trunk", 8)
    for i, (x, y, z, r) in enumerate([
        (-0.65, -0.25, 3.0, 0.95), (0.42, -0.15, 3.2, 1.05),
        (0.0, 0.62, 3.35, 0.9), (0.85, 0.45, 3.0, 0.78),
    ]):
        sphere(f"purple_canopy_{i}", (x, y, z), r, "purple" if i % 2 else "purple2", (1.08, 0.95, 0.82))


def build_bougainvillea():
    for i, (x, y, z, s) in enumerate([
        (-0.5, 0.0, 0.55, 0.62), (0.15, -0.18, 0.68, 0.72),
        (0.62, 0.14, 0.52, 0.58), (-0.02, 0.34, 0.5, 0.58),
    ]):
        sphere(f"shrub_{i}", (x, y, z), s, "flower" if i % 2 else "flower2", (1.18, 0.85, 0.78))


def build_retaining_wall():
    cube("wall", (0, 0, 0.6), (1.5, 0.24, 0.6), "concrete", 0.06)
    cube("cap", (0, 0, 1.23), (1.56, 0.3, 0.08), "concrete2", 0.035)
    for x in (-1.0, 0.0, 1.0):
        cube(f"joint_{x}", (x, -0.247, 0.61), (0.018, 0.012, 0.52), "concrete2")


def build_steps():
    width = 1.8
    for i in range(6):
        run = 0.34
        rise = 0.16
        cube(f"step_{i}", (0, i * run, (i + 1) * rise / 2), (width / 2, run / 2, (i + 1) * rise / 2), "concrete", 0.025)


def build_utility_pole():
    cylinder("pole", (0, 0, 3.5), 0.15, 7.0, "wood", 10)
    cube("crossarm", (0, 0, 6.25), (1.35, 0.11, 0.09), "wood", 0.025)
    for x in (-0.9, 0, 0.9):
        cylinder(f"insulator_{x}", (x, 0, 6.46), 0.075, 0.28, "concrete2", 8)
    cylinder("transformer", (0.23, 0.26, 5.15), 0.33, 0.78, "metal", 16)
    cube("transformer_bracket", (0.03, 0.13, 5.12), (0.22, 0.08, 0.13), "metal")


def wheels(y_positions):
    for side in (-1, 1):
        for i, y in enumerate(y_positions):
            x = side * 0.84
            cylinder(f"wheel_{side}_{i}", (x, y, 0.42), 0.34, 0.22, "tire", 14, rotation=(0, math.pi / 2, 0))
            cylinder(f"hub_{side}_{i}", (side * 0.955, y, 0.42), 0.14, 0.035, "metal", 12, rotation=(0, math.pi / 2, 0))


def build_sedan():
    cube("lower_body", (0, 0, 0.68), (0.88, 1.95, 0.35), "sage", 0.16)
    cube("cabin", (0, -0.08, 1.18), (0.74, 1.0, 0.42), "sage", 0.16)
    cube("front_glass", (0, -1.03, 1.23), (0.67, 0.025, 0.27), "glass", 0.03)
    cube("rear_glass", (0, 0.92, 1.23), (0.67, 0.025, 0.27), "glass", 0.03)
    wheels((-1.18, 1.18))


def build_pickup():
    cube("lower_body", (0, 0, 0.72), (0.92, 2.25, 0.36), "white", 0.13)
    cube("cab", (0, -0.7, 1.25), (0.78, 0.92, 0.5), "white", 0.12)
    cube("windshield", (0, -1.63, 1.3), (0.69, 0.025, 0.3), "glass", 0.03)
    cube("bed_floor", (0, 1.15, 0.95), (0.82, 0.9, 0.12), "dark", 0.03)
    cube("bed_left", (-0.79, 1.15, 1.17), (0.08, 0.9, 0.26), "white", 0.03)
    cube("bed_right", (0.79, 1.15, 1.17), (0.08, 0.9, 0.26), "white", 0.03)
    wheels((-1.35, 1.35))


def build_hydrant():
    cylinder("body", (0, 0, 0.48), 0.2, 0.72, "hydrant", 12)
    cylinder("base", (0, 0, 0.1), 0.29, 0.16, "hydrant", 12)
    cylinder("cap", (0, 0, 0.88), 0.27, 0.16, "hydrant", 12)
    for x in (-0.27, 0.27):
        cylinder(f"side_{x}", (x, 0, 0.55), 0.13, 0.25, "hydrant", 12, rotation=(0, math.pi / 2, 0))


ASSETS = {
    "la-live-oak": build_live_oak,
    "washingtonia-palm": build_palm,
    "jacaranda": build_jacaranda,
    "bougainvillea-shrub": build_bougainvillea,
    "hillside-retaining-wall": build_retaining_wall,
    "hillside-steps": build_steps,
    "utility-pole": build_utility_pole,
    "parked-sedan": build_sedan,
    "contractor-pickup": build_pickup,
    "fire-hydrant": build_hydrant,
}

MANIFEST = {
    "version": 1,
    "style": "clean low-poly Los Angeles architectural game",
    "coordinateSystem": "GLTF Y-up export from Blender Z-up",
    "units": "meters",
    "assets": [
        {"id": "la-live-oak", "file": "la-live-oak.glb", "category": "vegetation", "approxHeightM": 4.6},
        {"id": "washingtonia-palm", "file": "washingtonia-palm.glb", "category": "vegetation", "approxHeightM": 6.0},
        {"id": "jacaranda", "file": "jacaranda.glb", "category": "vegetation", "approxHeightM": 4.4},
        {"id": "bougainvillea-shrub", "file": "bougainvillea-shrub.glb", "category": "vegetation", "approxHeightM": 1.3},
        {"id": "hillside-retaining-wall", "file": "hillside-retaining-wall.glb", "category": "site", "approxWidthM": 3.1},
        {"id": "hillside-steps", "file": "hillside-steps.glb", "category": "site", "approxWidthM": 1.8},
        {"id": "utility-pole", "file": "utility-pole.glb", "category": "street", "approxHeightM": 7.0},
        {"id": "parked-sedan", "file": "parked-sedan.glb", "category": "vehicle", "approxLengthM": 4.2},
        {"id": "contractor-pickup", "file": "contractor-pickup.glb", "category": "vehicle", "approxLengthM": 4.8},
        {"id": "fire-hydrant", "file": "fire-hydrant.glb", "category": "street", "approxHeightM": 1.0},
    ],
}


def append_preview_asset(asset_name, builder, location):
    before = set(bpy.data.objects)
    builder()
    created = [obj for obj in bpy.data.objects if obj not in before]
    parent = bpy.data.objects.new(f"preview_{asset_name}", None)
    bpy.context.scene.collection.objects.link(parent)
    parent.location = location
    for obj in created:
        obj.parent = parent
    return parent


def render_preview():
    reset_scene()
    # Arrange two rows, big assets in back, small site/vehicle pieces in front.
    placements = [
        ("la-live-oak", build_live_oak, (-7.0, 2.8, 0)),
        ("washingtonia-palm", build_palm, (-3.4, 2.8, 0)),
        ("jacaranda", build_jacaranda, (0.4, 2.8, 0)),
        ("bougainvillea-shrub", build_bougainvillea, (4.2, 2.8, 0)),
        ("utility-pole", build_utility_pole, (7.2, 2.8, 0)),
        ("hillside-retaining-wall", build_retaining_wall, (-6.4, -2.8, 0)),
        ("hillside-steps", build_steps, (-2.8, -3.1, 0)),
        ("parked-sedan", build_sedan, (1.0, -3.0, 0)),
        ("contractor-pickup", build_pickup, (5.2, -3.0, 0)),
        ("fire-hydrant", build_hydrant, (8.0, -3.0, 0)),
    ]
    for name, builder, loc in placements:
        append_preview_asset(name, builder, loc)

    cube("ground", (0, 0, -0.12), (11.5, 7.0, 0.12), "concrete2", 0.12)

    bpy.ops.object.light_add(type="AREA", location=(4, -6, 12))
    key = bpy.context.object
    key.data.energy = 1300
    key.data.shape = "DISK"
    key.data.size = 8.0
    key.rotation_euler = (math.radians(24), 0, math.radians(28))

    bpy.ops.object.light_add(type="AREA", location=(-8, -1, 7))
    fill = bpy.context.object
    fill.data.energy = 650
    fill.data.size = 7

    bpy.ops.object.camera_add(location=(16.8, -23.5, 14.0))
    camera = bpy.context.object
    bpy.context.scene.camera = camera
    target = Vector((0.8, 0.0, 2.4))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 52

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(OUT / "asset-pack-preview.png")
    scene.render.film_transparent = False
    scene.world.color = (0.78, 0.84, 0.85)
    scene.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)


for asset_name, builder in ASSETS.items():
    export_asset(asset_name, builder)

(OUT / "manifest.json").write_text(json.dumps(MANIFEST, indent=2) + "\n")
render_preview()
print(f"Generated {len(ASSETS)} GLB assets + preview in {OUT}")
