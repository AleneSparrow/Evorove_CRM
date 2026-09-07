import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Variant = "hero" | "ambient";

function SparkOrbit({ count, radius }: { count: number; radius: number }) {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      const r = radius + 0.1 * Math.sin(i * 2.1);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.sin(a * 2.4) * 0.22;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [count, radius]);

  useFrame((_, delta) => {
    if (points.current) points.current.rotation.y += delta * 0.28;
  });

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial color="#C6FF00" size={0.042} sizeAttenuation transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}

function TorusEngine({ intensity }: { intensity: number }) {
  const group = useRef<THREE.Group>(null);
  const torus = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const pointer = useRef(new THREE.Vector2());

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1,
      );
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame((state, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * 0.55 * intensity;
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, pointer.current.y * 0.5, 0.06);
    group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, pointer.current.x * 0.32, 0.06);
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.9) * 0.08;
    if (torus.current) torus.current.rotation.x += delta * 0.42 * intensity;
    if (ring.current) ring.current.rotation.y -= delta * 0.95 * intensity;
  });

  return (
    <group ref={group}>
      <mesh ref={torus}>
        <torusGeometry args={[1.12, 0.38, 64, 180]} />
        <meshPhysicalMaterial
          color="#FF5A36"
          metalness={0.18}
          roughness={0.12}
          clearcoat={1}
          clearcoatRoughness={0.08}
          sheen={0.4}
          sheenColor="#FFB199"
          emissive="#7A180C"
          emissiveIntensity={0.18}
        />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2.2, 0.35, 0.2]}>
        <torusGeometry args={[1.58, 0.028, 12, 140]} />
        <meshBasicMaterial color="#C6FF00" transparent opacity={0.9} />
      </mesh>
      <SparkOrbit count={intensity > 0.6 ? 160 : 70} radius={1.85} />
    </group>
  );
}

export function OrbitScene({ variant = "hero" }: { variant?: Variant }) {
  const hero = variant === "hero";
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <Canvas
      camera={{ position: hero ? [0.35, 0.15, 4.1] : [1.4, 0.2, 5.4], fov: 38 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
    >
      <ambientLight intensity={0.7} />
      <hemisphereLight args={["#FFF8EC", "#C6B8A4", 0.65]} />
      <spotLight position={[4, 6, 5]} intensity={70} angle={0.5} penumbra={0.8} color="#fff4e8" />
      <pointLight position={[-3, -1, 3]} intensity={18} color="#FF5A36" />
      <pointLight position={[3, 2, -2]} intensity={12} color="#C6FF00" />
      <TorusEngine intensity={reduced ? 0.12 : hero ? 1 : 0.4} />
      <ContactShadows position={[0, -1.55, 0]} opacity={0.28} scale={8} blur={2.4} far={3.5} color="#0B0B0D" />
    </Canvas>
  );
}
