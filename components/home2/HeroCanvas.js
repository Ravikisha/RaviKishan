import React, { useRef, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// A single restrained 3D moment: a slowly-drifting wireframe polyhedron —
// a nod to graphs, meshes and the low-level structures Ravi builds.
function Mesh({ reduced }) {
  const group = useRef();
  const inner = useRef();
  const target = useRef({ x: 0, y: 0 });

  const geo = useMemo(() => new THREE.IcosahedronGeometry(2.1, 1), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 12), [geo]);
  const nodes = useMemo(() => geo.attributes.position, [geo]);

  useFrame((state, delta) => {
    if (reduced) return;
    const p = state.pointer;
    target.current.x += (p.y * 0.4 - target.current.x) * 0.05;
    target.current.y += (p.x * 0.4 - target.current.y) * 0.05;
    if (group.current) {
      group.current.rotation.x = target.current.x;
      group.current.rotation.y = target.current.y;
    }
    if (inner.current) {
      inner.current.rotation.y += delta * 0.12;
      inner.current.rotation.z += delta * 0.05;
    }
  });

  return (
    <group ref={group}>
      <group ref={inner}>
        <lineSegments geometry={edges}>
          <lineBasicMaterial color="#FFB020" transparent opacity={0.55} />
        </lineSegments>
        <points geometry={geo}>
          <pointsMaterial color="#FFB020" size={0.06} sizeAttenuation transparent opacity={0.9} />
        </points>
      </group>
    </group>
  );
}

const HeroCanvas = ({ reduced = false }) => {
  return (
    <Canvas
      dpr={[1, 1.8]}
      camera={{ position: [0, 0, 6], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ pointerEvents: "none" }}
    >
      <Suspense fallback={null}>
        <Mesh reduced={reduced} />
      </Suspense>
    </Canvas>
  );
};

export default HeroCanvas;
