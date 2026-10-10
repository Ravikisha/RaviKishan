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

// This canvas is decoration, so a browser without WebGL must get NO canvas,
// never a broken page. Without these guards three.js throws while creating
// its renderer, nothing catches it, and Next replaces the WHOLE site with
// "Application error: a client-side exception has occurred" — measured on
// Chromium 151 under a GPU-less display (llvmpipe), where the context probe
// can even succeed and the renderer still fail. Both are needed: the probe
// avoids mounting at all where WebGL is plainly absent, the boundary catches
// the case where it looked present and was not.
function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

class CanvasBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const HeroCanvas = ({ reduced = false }) => {
  // Decided once, on the client only (this module is loaded with ssr: false).
  const ok = useMemo(() => typeof document !== "undefined" && webglAvailable(), []);
  if (!ok) return null;
  return (
    <CanvasBoundary>
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
    </CanvasBoundary>
  );
};

export default HeroCanvas;
