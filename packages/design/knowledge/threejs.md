# Three.js — 3D interactions

Best used for: product viewers, interactive heroes, spatial demos.

## Patterns
- Keep 3D behind a clear performance budget; lazy-load.
- Prefer `@react-three/fiber` + `@react-three/drei` in React apps.
- Always provide a 2D fallback for reduced motion / low GPU.

## Do
- Use for intentional 3D moments, not as page wallpaper.
- Dispose geometries/materials on unmount.

## Don't
- Don't block first contentful paint on a heavy GLTF.
