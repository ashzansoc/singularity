"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sphere, MeshDistortMaterial } from "@react-three/drei";
import { Suspense, useState, useEffect } from "react";

function FloatingSpheres() {
  const [mousePosition, setMousePosition] = useState([0, 0]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition([
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      ]);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#3b82f6" />
      
      <group position={[mousePosition[0] * 0.5, mousePosition[1] * 0.5, 0]}>
        <Sphere args={[1, 32, 32]} position={[0, 0, 0]}>
          <MeshDistortMaterial
            color="#3b82f6"
            attach="material"
            distort={0.4}
            speed={2}
            roughness={0.2}
            metalness={0.8}
          />
        </Sphere>
        
        <Sphere args={[0.5, 32, 32]} position={[2.5, 1, -1]}>
          <MeshDistortMaterial
            color="#8b5cf6"
            attach="material"
            distort={0.3}
            speed={1.5}
            roughness={0.3}
            metalness={0.7}
          />
        </Sphere>
        
        <Sphere args={[0.3, 32, 32]} position={[-2, -1.5, 1]}>
          <MeshDistortMaterial
            color="#06b6d4"
            attach="material"
            distort={0.5}
            speed={2.5}
            roughness={0.1}
            metalness={0.9}
          />
        </Sphere>
      </group>
      
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.5} />
    </>
  );
}

export function HeroCanvas() {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-full h-[400px] bg-zinc-900/50 rounded-2xl border border-zinc-800" />
    );
  }

  return (
    <div className="w-full h-[400px] rounded-2xl border border-zinc-800 overflow-hidden">
      <Canvas camera={{ position: [0, 0, 6], fov: 45 }}>
        <Suspense fallback={null}>
          <FloatingSpheres />
        </Suspense>
      </Canvas>
    </div>
  );
}
