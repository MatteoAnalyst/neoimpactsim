import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Shield, Zap, Target, DollarSign, Clock, Globe, Play, RotateCcw, MapPin } from 'lucide-react';
import * as THREE from 'three';

// Types kept intentionally loose to integrate easily with existing app data
export type ImpactLocation = { lat: number; lng: number; name?: string };
export type AsteroidData = {
  diameter?: number; // meters
  velocity?: number; // km/s
  composition?: 'rock' | 'iron' | 'carbon' | string;
  location?: ImpactLocation;
};

export type ImpactData = {
  location?: ImpactLocation;
};

export type AdvancedDeflectionResult = {
  deflectionRadius: number; // km
  crossTrackDisplacement: number; // m
  angularDeflection: number; // deg
  newImpactLat: number; // deg
  newImpactLng: number; // deg
  successProbability: number; // 0..1
  energyRequired: number; // J
  missionCost: number; // million USD
  impactAverted: boolean;
  bPlaneDeflection: number; // m
  missDistanceEarthRadii: number;
  positionUncertainty: number; // km
  velocityUncertainty: number; // percent
  timingFactor: number;
  sizeFactor: number;
  trlFactor: number;
  deltaVFactor: number;
  developmentTime: number; // years
  confidenceLevel: 'High' | 'Medium' | 'Low';
};

export type AdvancedDeflectionStrategyProps = {
  asteroidData?: AsteroidData;
  impactData?: ImpactData;
};

const deflectionMethods = {
  kinetic: {
    name: 'Kinetic Impactor',
    description: 'High-velocity spacecraft collision (DART-style mission)',
    maxVelocityChange: 0.01, // km/s
    minTiming: 30, // days
    icon: '🚀',
    color: 'blue',
    efficiency: 0.85,
    trl: 9,
    baseCost: 324,
    developmentTime: 4,
  },
  gravity: {
    name: 'Gravity Tractor',
    description: 'Long-duration gravitational towing by spacecraft',
    maxVelocityChange: 0.001, // km/s
    minTiming: 1095, // days
    icon: '🛰️',
    color: 'purple',
    efficiency: 0.95,
    trl: 4,
    baseCost: 2400,
    developmentTime: 8,
  },
  nuclear: {
    name: 'Nuclear Pulse Deflection',
    description: 'Standoff nuclear detonation for impulse delivery',
    maxVelocityChange: 0.1, // km/s
    minTiming: 180, // days
    icon: '💥',
    color: 'orange',
    efficiency: 0.7,
    trl: 3,
    baseCost: 5500,
    developmentTime: 12,
  },
} as const;

// Fixed mass calculation with explicit SI units
function calculateMass(diameter_m: number, composition: string = 'rock'): number {
  const radius_m = diameter_m / 2;
  const volume_m3 = (4 / 3) * Math.PI * Math.pow(radius_m, 3);

  const densities_kgPerM3: Record<string, number> = {
    rock: 2700,
    iron: 7800,
    carbon: 1900,
  };

  const density = densities_kgPerM3[composition] ?? densities_kgPerM3.rock;
  return volume_m3 * density;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculateAdvancedDeflection(
  asteroid: AsteroidData,
  params: {
    method: keyof typeof deflectionMethods;
    timing: number; // days
    velocityChange: number; // km/s
    impactLocation?: ImpactLocation;
  }
): AdvancedDeflectionResult {
  const { method, timing, velocityChange } = params;

  // === UNIT CONVERSION TO SI ===
  const diameter_m = asteroid.diameter ?? 100;
  const deltaV_ms = (velocityChange ?? 0.001) * 1000; // km/s -> m/s
  const timeToImpact_s = (timing ?? 365) * 24 * 3600; // days -> seconds

  // Mass estimate (asteroid)
  const mass_kg = calculateMass(diameter_m, asteroid.composition);

  // Constants
  const earthRadius_m = 6.371e6;
  const au_m = 1.496e11;
  const sunMass_kg = 1.989e30;
  const G = 6.67430e-11;

  // Keplerian bits (kept for completeness; not heavily used here)
  const semiMajorAxis_m = 1.2 * au_m;
  void semiMajorAxis_m;
  const meanMotion_radPerS = Math.sqrt(G * sunMass_kg / Math.pow(1.2 * au_m, 3));
  void meanMotion_radPerS;

  // B-plane style cross-track displacement
  const crossTrackDisplacement_m = deltaV_ms * timeToImpact_s;
  const missDistance_m = crossTrackDisplacement_m * Math.cos(Math.PI / 6); // 30° geometry

  // Impact origin
  const origin = params.impactLocation ?? asteroid.location ?? { lat: 0, lng: 0 };
  const originalLat_rad = (origin.lat ?? 0) * (Math.PI / 180);
  const originalLng_rad = (origin.lng ?? 0) * (Math.PI / 180);

  // Convert miss distance to surface angular offset
  const angularDeflection_rad = Math.atan2(missDistance_m, earthRadius_m);
  const latDeflection_rad = angularDeflection_rad * Math.cos(originalLat_rad);
  const lngDeflection_rad = angularDeflection_rad / Math.cos(originalLat_rad);

  const newLat_deg = clamp(
    (originalLat_rad + latDeflection_rad) * (180 / Math.PI),
    -90,
    90
  );
  const rawLng = (originalLng_rad + lngDeflection_rad) * (180 / Math.PI);
  const newLng_deg = ((((rawLng + 180) % 360) + 360) % 360) - 180; // wrap -180..180

  // Success probability model
  let successProbability = deflectionMethods[method].efficiency;

  const minTiming_s = deflectionMethods[method].minTiming * 24 * 3600;
  const timingFactor = timeToImpact_s > minTiming_s
    ? 1
    : Math.exp(-2 * (minTiming_s - timeToImpact_s) / minTiming_s);
  successProbability *= timingFactor;

  const referenceDiameter_m = 100;
  const sizeFactor = Math.pow(referenceDiameter_m / diameter_m, 0.3);
  successProbability *= Math.min(1, sizeFactor);

  const referenceDeltaV_ms = 5; // m/s
  const deltaVFactor = Math.tanh(deltaV_ms / referenceDeltaV_ms);
  successProbability *= deltaVFactor;

  const trlFactor = deflectionMethods[method].trl / 9;
  successProbability *= trlFactor;

  successProbability = clamp(successProbability, 0.05, 0.98);

  // Mission cost model
  const currentMethod = deflectionMethods[method];
  let missionCost_millionUSD = currentMethod.baseCost;

  const timeToImpact_years = timeToImpact_s / (365.25 * 24 * 3600);
  if (timeToImpact_years < 1) missionCost_millionUSD *= 3.0;
  else if (timeToImpact_years < 2) missionCost_millionUSD *= 2.0;
  else if (timeToImpact_years < 4) missionCost_millionUSD *= 1.4;

  if (diameter_m > 1000) missionCost_millionUSD *= 3.5;
  else if (diameter_m > 500) missionCost_millionUSD *= 2.2;
  else if (diameter_m > 200) missionCost_millionUSD *= 1.6;

  const trlCostMultiplier = 1 + (9 - currentMethod.trl) * 0.25;
  missionCost_millionUSD *= trlCostMultiplier;

  if (missionCost_millionUSD > 2000) missionCost_millionUSD *= 0.75; // cooperation discount

  // Energy to effect deltaV (very simplified)
  const kineticEnergy_J = 0.5 * mass_kg * Math.pow(deltaV_ms, 2);

  const missDistanceEarthRadii = missDistance_m / earthRadius_m;
  const impactAverted = missDistanceEarthRadii > 1.2;

  const positionUncertainty_m = Math.sqrt(
    Math.pow(timeToImpact_years * 50000, 2) + // ~50 km per year
    Math.pow(diameter_m * 0.15, 2)
  );

  const velocityUncertainty_percent = 12; // already a percent value

  return {
    deflectionRadius: missDistance_m / 1000,
    crossTrackDisplacement: crossTrackDisplacement_m,
    angularDeflection: angularDeflection_rad * (180 / Math.PI),
    newImpactLat: newLat_deg,
    newImpactLng: newLng_deg,
    successProbability,
    energyRequired: kineticEnergy_J,
    missionCost: missionCost_millionUSD,
    impactAverted,
    bPlaneDeflection: crossTrackDisplacement_m,
    missDistanceEarthRadii,
    positionUncertainty: positionUncertainty_m / 1000,
    velocityUncertainty: velocityUncertainty_percent,
    timingFactor,
    sizeFactor,
    trlFactor,
    deltaVFactor,
    developmentTime: currentMethod.developmentTime,
    confidenceLevel: successProbability > 0.8 ? 'High' : successProbability > 0.6 ? 'Medium' : 'Low',
  };
}

const AdvancedDeflectionStrategy: React.FC<AdvancedDeflectionStrategyProps> = ({ asteroidData, impactData }) => {
  // Controls
  const [deflectionEnabled, setDeflectionEnabled] = useState(false);
  const [deflectionMethod, setDeflectionMethod] = useState<keyof typeof deflectionMethods>('kinetic');
  const [deflectionTiming, setDeflectionTiming] = useState(365);
  const [velocityChange, setVelocityChange] = useState(0.001);
  const [deflectionResult, setDeflectionResult] = useState<AdvancedDeflectionResult | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0); // 0..100

  // Refs for containers
  const threeMountRef = useRef<HTMLDivElement | null>(null);
  const trajectoryRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rafRef = useRef<number | null>(null);

  // Animation state refs (to avoid stale closures in RAF)
  const isAnimatingRef = useRef(isAnimating);
  const progressRef = useRef(animationProgress);
  useEffect(() => { isAnimatingRef.current = isAnimating; }, [isAnimating]);
  useEffect(() => { progressRef.current = animationProgress; }, [animationProgress]);

  // Original impact state
  const [originalImpact, setOriginalImpact] = useState<{ lat: number; lng: number }>({ lat: 0, lng: 0 });

  const currentMethod = deflectionMethods[deflectionMethod];

  // Compute deflection results when inputs change
  useEffect(() => {
    if (!deflectionEnabled || !asteroidData) {
      setDeflectionResult(null);
      return;
    }

    const result = calculateAdvancedDeflection(asteroidData, {
      method: deflectionMethod,
      timing: deflectionTiming,
      velocityChange,
      impactLocation: impactData?.location ?? asteroidData.location,
    });

    setDeflectionResult(result);
  }, [deflectionEnabled, asteroidData, impactData, deflectionMethod, deflectionTiming, velocityChange]);

  // Initialize original impact on load or data change
  useEffect(() => {
    const loc = impactData?.location ?? asteroidData?.location;
    if (loc) {
      setOriginalImpact({ lat: loc.lat, lng: loc.lng });
    }
  }, [asteroidData, impactData]);

  // 2D Trajectory SVG visualization
  useEffect(() => {
    if (!deflectionEnabled || !trajectoryRef.current) return;

    const container = trajectoryRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 600;
    const height = 400;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.backgroundColor = '#0F172A';
    svg.style.borderRadius = '12px';
    svg.style.border = '1px solid #475569';

    // Starfield background (subtle)
    const defs = document.createElementNS(svgNS, 'defs');
    const starPattern = document.createElementNS(svgNS, 'pattern');
    starPattern.setAttribute('id', 'starField');
    starPattern.setAttribute('x', '0');
    starPattern.setAttribute('y', '0');
    starPattern.setAttribute('width', '100');
    starPattern.setAttribute('height', '100');
    starPattern.setAttribute('patternUnits', 'userSpaceOnUse');
    for (let i = 0; i < 12; i++) {
      const star = document.createElementNS(svgNS, 'circle');
      star.setAttribute('cx', String(Math.random() * 100));
      star.setAttribute('cy', String(Math.random() * 100));
      star.setAttribute('r', '0.8');
      star.setAttribute('fill', '#64748B');
      star.setAttribute('opacity', '0.4');
      starPattern.appendChild(star);
    }
    defs.appendChild(starPattern);
    svg.appendChild(defs);

    const background = document.createElementNS(svgNS, 'rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', 'url(#starField)');
    svg.appendChild(background);

    // Earth
    const earthX = width / 2;
    const earthY = height / 2;
    const earthRadius = 25;

    const earthShadow = document.createElementNS(svgNS, 'circle');
    earthShadow.setAttribute('cx', String(earthX));
    earthShadow.setAttribute('cy', String(earthY));
    earthShadow.setAttribute('r', String(earthRadius + 3));
    earthShadow.setAttribute('fill', '#3B82F6');
    earthShadow.setAttribute('opacity', '0.3');
    svg.appendChild(earthShadow);

    const earth = document.createElementNS(svgNS, 'circle');
    earth.setAttribute('cx', String(earthX));
    earth.setAttribute('cy', String(earthY));
    earth.setAttribute('r', String(earthRadius));
    earth.setAttribute('fill', '#22C55E');
    earth.setAttribute('stroke', '#16A34A');
    earth.setAttribute('stroke-width', '2');
    svg.appendChild(earth);

    const earthLabel = document.createElementNS(svgNS, 'text');
    earthLabel.setAttribute('x', String(earthX));
    earthLabel.setAttribute('y', String(earthY + earthRadius + 18));
    earthLabel.setAttribute('text-anchor', 'middle');
    earthLabel.setAttribute('fill', '#F1F5F9');
    earthLabel.setAttribute('font-size', '12');
    earthLabel.setAttribute('font-weight', 'bold');
    earthLabel.textContent = 'Earth';
    svg.appendChild(earthLabel);

    // Trajectory points
    const createTrajectoryPoints = (isDeflected = false) => {
      const points: [number, number][] = [];
      const segments = 100;
      const deflectionScale = isDeflected ? clamp(velocityChange * 1000, 0.1, 40) : 0; // scale by m/s roughly

      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const baseX = 50 + t * (width - 200);
        const baseY = earthY - 20 + Math.sin(t * Math.PI * 0.8) * 60;
        const deflectionOffset = isDeflected ? t * t * deflectionScale : 0;
        points.push([baseX, baseY + deflectionOffset]);
      }
      return points;
    };

    const originalPoints = createTrajectoryPoints(false);
    const deflectedPoints = createTrajectoryPoints(true);

    const drawTrajectory = (
      points: [number, number][],
      color: string,
      label: string,
      isDashed = false
    ) => {
      const pathData = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`)
        .join(' ');
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '3');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.85');
      if (isDashed) path.setAttribute('stroke-dasharray', '8,4');
      svg.appendChild(path);

      const labelIndex = Math.floor(points.length * 0.2);
      const labelX = points[labelIndex][0];
      const labelY = points[labelIndex][1] - 15;

      const labelBg = document.createElementNS(svgNS, 'rect');
      labelBg.setAttribute('x', String(labelX - 35));
      labelBg.setAttribute('y', String(labelY - 12));
      labelBg.setAttribute('width', '70');
      labelBg.setAttribute('height', '16');
      labelBg.setAttribute('fill', 'rgba(0,0,0,0.7)');
      labelBg.setAttribute('rx', '3');
      svg.appendChild(labelBg);

      const labelText = document.createElementNS(svgNS, 'text');
      labelText.setAttribute('x', String(labelX));
      labelText.setAttribute('y', String(labelY));
      labelText.setAttribute('text-anchor', 'middle');
      labelText.setAttribute('fill', color);
      labelText.setAttribute('font-size', '10');
      labelText.setAttribute('font-weight', 'bold');
      labelText.textContent = label;
      svg.appendChild(labelText);
    };

    drawTrajectory(originalPoints, '#EF4444', 'Original');
    drawTrajectory(deflectedPoints, '#22C55E', 'Deflected', true);

    const createAsteroid = (color: string, id: string) => {
      const asteroid = document.createElementNS(svgNS, 'circle');
      asteroid.setAttribute('r', '4');
      asteroid.setAttribute('fill', color);
      asteroid.setAttribute('stroke', '#FFFFFF');
      asteroid.setAttribute('stroke-width', '1');
      asteroid.setAttribute('opacity', '0');
      asteroid.setAttribute('id', id);
      svg.appendChild(asteroid);
      return asteroid;
    };

    const originalAsteroid = createAsteroid('#EF4444', 'original-asteroid');
    const deflectedAsteroid = createAsteroid('#22C55E', 'deflected-asteroid');

    const animateAsteroids = () => {
      if (isAnimatingRef.current && progressRef.current <= 100) {
        const progress = progressRef.current / 100;
        const idx = Math.floor(progress * (originalPoints.length - 1));
        if (idx < originalPoints.length) {
          originalAsteroid.setAttribute('cx', String(originalPoints[idx][0]));
          originalAsteroid.setAttribute('cy', String(originalPoints[idx][1]));
          originalAsteroid.setAttribute('opacity', '1');

          deflectedAsteroid.setAttribute('cx', String(deflectedPoints[idx][0]));
          deflectedAsteroid.setAttribute('cy', String(deflectedPoints[idx][1]));
          deflectedAsteroid.setAttribute('opacity', '1');
        }
      } else {
        originalAsteroid.setAttribute('opacity', '0');
        deflectedAsteroid.setAttribute('opacity', '0');
      }
    };

    const interval = window.setInterval(animateAsteroids, 50);

    // Deflection visualization overlays
    if (deflectionResult && deflectionEnabled) {
      const marker = document.createElementNS(svgNS, 'marker');
      marker.setAttribute('id', 'arrowhead');
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('refX', '10');
      marker.setAttribute('refY', '3.5');
      marker.setAttribute('orient', 'auto');

      const arrowPolygon = document.createElementNS(svgNS, 'polygon');
      arrowPolygon.setAttribute('points', '0 0, 10 3.5, 0 7');
      arrowPolygon.setAttribute('fill', '#F59E0B');
      marker.appendChild(arrowPolygon);
      defs.appendChild(marker);

      const deflectionX = 180;
      const deflectionY = 120;

      const deflectionCircle = document.createElementNS(svgNS, 'circle');
      deflectionCircle.setAttribute('cx', String(deflectionX));
      deflectionCircle.setAttribute('cy', String(deflectionY));
      deflectionCircle.setAttribute('r', '8');
      deflectionCircle.setAttribute('fill', '#F59E0B');
      deflectionCircle.setAttribute('stroke', '#FFFFFF');
      deflectionCircle.setAttribute('stroke-width', '2');
      deflectionCircle.setAttribute('opacity', '0.9');
      svg.appendChild(deflectionCircle);

      const arrowLength = 25;
      const arrowAngle = Math.PI / 4;
      const impulseArrow = document.createElementNS(svgNS, 'line');
      impulseArrow.setAttribute('x1', String(deflectionX));
      impulseArrow.setAttribute('y1', String(deflectionY));
      impulseArrow.setAttribute('x2', String(deflectionX + arrowLength * Math.cos(arrowAngle)));
      impulseArrow.setAttribute('y2', String(deflectionY + arrowLength * Math.sin(arrowAngle)));
      impulseArrow.setAttribute('stroke', '#F59E0B');
      impulseArrow.setAttribute('stroke-width', '4');
      impulseArrow.setAttribute('marker-end', 'url(#arrowhead)');
      svg.appendChild(impulseArrow);

      const deflectionLabel = document.createElementNS(svgNS, 'text');
      deflectionLabel.setAttribute('x', String(deflectionX + 15));
      deflectionLabel.setAttribute('y', String(deflectionY - 15));
      deflectionLabel.setAttribute('fill', '#F59E0B');
      deflectionLabel.setAttribute('font-size', '10');
      deflectionLabel.setAttribute('font-weight', 'bold');
      deflectionLabel.textContent = `Deflection: ${(velocityChange * 1000).toFixed(1)} m/s`;
      svg.appendChild(deflectionLabel);

      if (deflectionResult.impactAverted) {
        const missArc = document.createElementNS(svgNS, 'path');
        const arcRadius = 35;
        const arcPath = `M ${earthX - arcRadius} ${earthY} A ${arcRadius} ${arcRadius} 0 0 1 ${earthX + arcRadius} ${earthY}`;
        missArc.setAttribute('d', arcPath);
        missArc.setAttribute('stroke', '#22C55E');
        missArc.setAttribute('stroke-width', '3');
        missArc.setAttribute('fill', 'none');
        missArc.setAttribute('stroke-dasharray', '5,3');
        missArc.setAttribute('opacity', '0.7');
        svg.appendChild(missArc);

        const missLabel = document.createElementNS(svgNS, 'text');
        missLabel.setAttribute('x', String(earthX));
        missLabel.setAttribute('y', String(earthY - arcRadius - 8));
        missLabel.setAttribute('text-anchor', 'middle');
        missLabel.setAttribute('fill', '#22C55E');
        missLabel.setAttribute('font-size', '9');
        missLabel.setAttribute('font-weight', 'bold');
        missLabel.textContent = `Miss: ${deflectionResult.missDistanceEarthRadii.toFixed(1)} R⊕`;
        svg.appendChild(missLabel);
      }
    }

    // Distance markers & title
    const addGridAndScale = () => {
      const distances = [50, 150, 250, 350, 450, width - 50];
      distances.forEach((x) => {
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', String(x));
        line.setAttribute('y1', '385');
        line.setAttribute('x2', String(x));
        line.setAttribute('y2', '395');
        line.setAttribute('stroke', '#64748B');
        line.setAttribute('stroke-width', '1');
        svg.appendChild(line);

        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', String(x));
        label.setAttribute('y', '395');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', '#94A3B8');
        label.setAttribute('font-size', '8');
        const au = ((x - 50) / 100) * 0.5; // arbitrary local scale
        label.textContent = `${Math.round(au * 10) / 10} AU`;
        svg.appendChild(label);
      });

      const scaleLabel = document.createElementNS(svgNS, 'text');
      scaleLabel.setAttribute('x', String(width / 2));
      scaleLabel.setAttribute('y', '15');
      scaleLabel.setAttribute('text-anchor', 'middle');
      scaleLabel.setAttribute('fill', '#CBD5E1');
      scaleLabel.setAttribute('font-size', '11');
      scaleLabel.setAttribute('font-weight', 'bold');
      scaleLabel.textContent = 'Asteroid Approach Trajectory (Side View)';
      svg.appendChild(scaleLabel);
    };

    addGridAndScale();
    container.appendChild(svg);

    return () => {
      window.clearInterval(interval);
      container.innerHTML = '';
    };
  }, [deflectionEnabled, deflectionResult, velocityChange]);

  // Three.js 3D Orbital Visualization
  useEffect(() => {
    if (!deflectionEnabled || !threeMountRef.current) return;

    const container = threeMountRef.current;
    container.innerHTML = '';

    const scene = new THREE.Scene();
    const width = container.clientWidth || 600;
    const height = 400;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 5000);
    camera.position.set(25, 15, 25);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;

    // Earth + atmosphere (3D units not in meters; purely visual)
    const earthRadiusUnits = 2.5;
    const earthGeo = new THREE.SphereGeometry(earthRadiusUnits, 64, 64);
    const earthMat = new THREE.MeshPhongMaterial({ color: 0x22c55e });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earthMesh);

    const atmosphereGeo = new THREE.SphereGeometry(earthRadiusUnits * 1.05, 64, 64);
    const atmosphereMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main(){ vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float c; uniform float p; varying vec3 vNormal;
        void main(){
          float intensity = pow(c - dot(vNormal, vec3(0.0,0.0,1.0)), p);
          gl_FragColor = vec4(0.3,0.6,1.0, intensity * 0.3);
        }`,
      transparent: true,
      uniforms: { c: { value: 0.5 }, p: { value: 4.0 } },
    });
    const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
    scene.add(atmosphere);

    // Stars (modest count for performance)
    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 5000;
    const starsVertices = new Float32Array(starCount * 3);
    const starsColors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = 2 * Math.PI * Math.random();
      const radius = 2000 + Math.random() * 3000;
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      starsVertices[i * 3 + 0] = x;
      starsVertices[i * 3 + 1] = y;
      starsVertices[i * 3 + 2] = z;
      // color bias
      const t = Math.random();
      let r = 1, g = 1, b = 1;
      if (t < 0.1) { r = 0.6; g = 0.8; b = 1.0; }
      else if (t < 0.3) { r = 1.0; g = 1.0; b = 1.0; }
      else if (t < 0.7) { r = 1.0; g = 0.9; b = 0.7; }
      else { r = 1.0; g = 0.6; b = 0.4; }
      starsColors[i * 3 + 0] = r; starsColors[i * 3 + 1] = g; starsColors[i * 3 + 2] = b;
    }
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starsVertices, 3));
    starsGeometry.setAttribute('color', new THREE.BufferAttribute(starsColors, 3));
    const starsMaterial = new THREE.PointsMaterial({ size: 2, vertexColors: true, transparent: true });
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);

    // Simple orbital curves (visual only)
    const createRealisticTrajectory = (color: number, isDeflected = false) => {
      const trajectoryPoints: THREE.Vector3[] = [];
      const positions: THREE.Vector3[] = [];

      const semiMajorAxis = 1.3; // AU units (visual)
      const eccentricity = 0.4 + (isDeflected ? 0.05 : 0);
      const inclination = (5 + (isDeflected ? 2 : 0)) * (Math.PI / 180);
      const longitudeOfAscendingNode = 0;
      const argumentOfPeriapsis = Math.PI / 4;

      const numPoints = 500;
      for (let i = 0; i < numPoints; i++) {
        const meanAnomaly = (i / numPoints) * 2 * Math.PI;
        let E = meanAnomaly;
        for (let j = 0; j < 5; j++) E = meanAnomaly + eccentricity * Math.sin(E);
        const trueAnomaly = 2 * Math.atan2(
          Math.sqrt(1 + eccentricity) * Math.sin(E / 2),
          Math.sqrt(1 - eccentricity) * Math.cos(E / 2)
        );
        const radius = semiMajorAxis * (1 - eccentricity * Math.cos(E));

        const cosArgPeri = Math.cos(argumentOfPeriapsis);
        const sinArgPeri = Math.sin(argumentOfPeriapsis);
        const cosIncl = Math.cos(inclination);
        const sinIncl = Math.sin(inclination);
        const cosLongAsc = Math.cos(longitudeOfAscendingNode);
        const sinLongAsc = Math.sin(longitudeOfAscendingNode);

        const orbitalX = radius * Math.cos(trueAnomaly);
        const orbitalY = radius * Math.sin(trueAnomaly);

        const x = (cosLongAsc * cosArgPeri - sinLongAsc * sinArgPeri * cosIncl) * orbitalX +
                  (-cosLongAsc * sinArgPeri - sinLongAsc * cosArgPeri * cosIncl) * orbitalY;
        const y = (sinLongAsc * cosArgPeri + cosLongAsc * sinArgPeri * cosIncl) * orbitalX +
                  (-sinLongAsc * sinArgPeri + cosLongAsc * cosArgPeri * cosIncl) * orbitalY;
        const z = (sinIncl * sinArgPeri) * orbitalX + (sinIncl * cosArgPeri) * orbitalY;

        const scaleFactor = 30; // purely visual
        const p = new THREE.Vector3(x * scaleFactor, z * scaleFactor, y * scaleFactor);
        trajectoryPoints.push(p);
        positions.push(p.clone());
      }

      const trajectoryGeometry = new THREE.BufferGeometry().setFromPoints(trajectoryPoints);
      const trajectoryMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });
      const trajectory = new THREE.Line(trajectoryGeometry, trajectoryMaterial);
      scene.add(trajectory);

      const asteroidGeometry = new THREE.IcosahedronGeometry(0.3, 2);
      const asteroidMaterial = new THREE.MeshPhongMaterial({ color, shininess: 30 });
      const asteroid = new THREE.Mesh(asteroidGeometry, asteroidMaterial);
      scene.add(asteroid);

      return { trajectory, asteroid, positions };
    };

    const originalTrajectory = createRealisticTrajectory(0xff3366, false);
    const deflectedTrajectory = createRealisticTrajectory(0x33ff66, true);

    // Lights
    scene.add(new THREE.AmbientLight(0x404040, 0.2));
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(100, 0, 50);
    scene.add(sunLight);

    // Simple mouse controls
    let mouseDown = false;
    let mouseX = 0;
    let mouseY = 0;
    let cameraDistance = 40;
    let cameraTheta = Math.PI / 4;
    let cameraPhi = Math.PI / 6;

    const handleMouseDown = (event: MouseEvent) => {
      mouseDown = true;
      mouseX = event.clientX;
      mouseY = event.clientY;
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (!mouseDown) return;
      const deltaX = event.clientX - mouseX;
      const deltaY = event.clientY - mouseY;
      cameraTheta -= deltaX * 0.01;
      cameraPhi = clamp(cameraPhi - deltaY * 0.01, 0.1, Math.PI - 0.1);
      mouseX = event.clientX;
      mouseY = event.clientY;
    };
    const handleMouseUp = () => { mouseDown = false; };
    const handleWheel = (event: WheelEvent) => {
      cameraDistance = clamp(cameraDistance + event.deltaY * 0.05, 15, 200);
    };

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('wheel', handleWheel);

    const animate = () => {
      const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
      const y = cameraDistance * Math.cos(cameraPhi);
      const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);

      earthMesh.rotation.y += 0.002;
      atmosphere.rotation.y += 0.002;

      if (isAnimatingRef.current) {
        const positionsCount = originalTrajectory.positions.length;
        const idx = Math.min(
          Math.floor((progressRef.current / 100) * (positionsCount - 1)),
          positionsCount - 1
        );
        originalTrajectory.asteroid.position.copy(originalTrajectory.positions[idx]);
        deflectedTrajectory.asteroid.position.copy(deflectedTrajectory.positions[idx]);
      }

      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 600;
      const h = 400;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      scene.clear();
    };
  }, [deflectionEnabled]);

  // World map: Canvas-based impact visualization
  useEffect(() => {
    if (!deflectionResult || !mapContainerRef.current) return;

    const container = mapContainerRef.current;
    container.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.width = 800; // internal resolution
    canvas.height = 400;
    canvas.style.width = '100%';
    canvas.style.height = '400px';
    canvas.style.borderRadius = '12px';
    canvas.style.border = '1px solid #475569';
    canvas.style.backgroundColor = '#0F172A';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const toCanvas = (lat: number, lng: number) => ({
      x: ((lng + 180) * canvas.width) / 360,
      y: ((90 - lat) * canvas.height) / 180,
    });

    const drawContinent = (coords: [number, number][]) => {
      if (coords.length < 3) return;
      ctx.beginPath();
      const first = toCanvas(coords[0][0], coords[0][1]);
      ctx.moveTo(first.x, first.y);
      coords.slice(1).forEach(([lat, lng]) => {
        const p = toCanvas(lat, lng);
        ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = '#10B981';
      ctx.fill();
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const continents: [number, number][][] = [
      [[70, -170], [65, -140], [50, -125], [40, -120], [30, -110], [25, -95], [20, -80], [30, -75], [45, -85], [60, -100], [70, -130]],
      [[10, -80], [5, -70], [-10, -65], [-25, -70], [-40, -65], [-50, -70], [-35, -75], [-20, -80], [0, -75]],
      [[70, 10], [60, 40], [50, 30], [45, 40], [55, 20], [65, 5]],
      [[35, 20], [25, 15], [10, 20], [0, 15], [-20, 20], [-35, 25], [-30, 40], [0, 35], [20, 40]],
      [[70, 60], [65, 120], [50, 140], [40, 100], [50, 80], [60, 70]],
      [[-10, 120], [-25, 115], [-35, 130], [-30, 145], [-15, 140]],
    ];

    continents.forEach(drawContinent);

    // Grid lines
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3;
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = ((90 - lat) * canvas.height) / 180;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    for (let lng = -120; lng <= 120; lng += 60) {
      const x = ((lng + 180) * canvas.width) / 360;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const drawImpactPoint = (lat: number, lng: number, color: string, label: string) => {
      const p = toCanvas(lat, lng);
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 20);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.5, `${color}80`);
      gradient.addColorStop(1, `${color}00`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x - 12, p.y);
      ctx.lineTo(p.x + 12, p.y);
      ctx.moveTo(p.x, p.y - 12);
      ctx.lineTo(p.x, p.y + 12);
      ctx.stroke();

      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(p.x + 15, p.y - 20, 160, 35);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px Arial';
      ctx.fillText(label, p.x + 20, p.y - 5);

      ctx.fillStyle = '#94A3B8';
      ctx.font = '12px Arial';
      ctx.fillText(`${lat.toFixed(2)}°, ${lng.toFixed(2)}°`, p.x + 20, p.y + 10);
    };

    // Original impact
    drawImpactPoint(originalImpact.lat, originalImpact.lng, '#EF4444', 'Original Impact');

    if (deflectionResult.impactAverted) {
      ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
      ctx.fillRect(20, 20, 220, 50);
      ctx.strokeStyle = '#22C55E';
      ctx.lineWidth = 2;
      ctx.strokeRect(20, 20, 220, 50);
      ctx.fillStyle = '#22C55E';
      ctx.font = 'bold 18px Arial';
      ctx.fillText('IMPACT AVOIDED', 30, 50);
    } else {
      drawImpactPoint(deflectionResult.newImpactLat, deflectionResult.newImpactLng, '#F59E0B', 'New Impact');
      const p0 = toCanvas(originalImpact.lat, originalImpact.lng);
      const p1 = toCanvas(deflectionResult.newImpactLat, deflectionResult.newImpactLng);
      ctx.strokeStyle = '#FBBF24';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 5]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    container.appendChild(canvas);

    return () => {
      container.innerHTML = '';
    };
  }, [deflectionResult, originalImpact]);

  // Animation controls
  const playAnimation = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setAnimationProgress(0);

    const start = performance.now();
    const durationMs = 5000; // 5s

    const step = (now: number) => {
      const t = clamp((now - start) / durationMs, 0, 1);
      const pct = Math.round(t * 100);
      setAnimationProgress(pct);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setIsAnimating(false);
      }
    };

    rafRef.current = requestAnimationFrame(step);
  };

  const resetAnimation = () => {
    setIsAnimating(false);
    setAnimationProgress(0);
  };

  return (
    <div className="bg-gradient-to-br from-slate-900/95 to-slate-800/95 rounded-2xl p-8 border border-slate-600/30 backdrop-blur-lg shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500/30 to-purple-600/30 rounded-2xl flex items-center justify-center border border-blue-400/30">
          <Shield className="w-8 h-8 text-blue-300" />
        </div>
        <div>
          <h3 className="text-3xl font-bold text-white mb-2">Planetary Defense Mission Control</h3>
          <p className="text-slate-300 text-lg">Advanced orbital mechanics & deflection analysis system</p>
        </div>
      </div>

      {/* Enable Toggle */}
      <div className="mb-8">
        <label className="flex items-center gap-4 cursor-pointer group">
          <div className="relative">
            <input
              type="checkbox"
              checked={deflectionEnabled}
              onChange={(e) => setDeflectionEnabled(e.target.checked)}
              className="sr-only"
            />
            <div className={`w-16 h-8 rounded-full transition-all duration-300 ${
              deflectionEnabled ? 'bg-gradient-to-r from-blue-500 to-purple-600' : 'bg-slate-600'
            }`}>
              <div className={`w-7 h-7 bg-white rounded-full transition-transform duration-300 transform ${
                deflectionEnabled ? 'translate-x-8' : 'translate-x-0.5'
              } translate-y-0.5 shadow-lg`} />
            </div>
          </div>
          <span className="text-white font-semibold text-lg group-hover:text-blue-300 transition-colors">
            Initialize Planetary Defense Systems
          </span>
        </label>
      </div>

      {deflectionEnabled && (
        <div className="space-y-10">
          {/* 3D Trajectory & Impact Analysis */}
          <div className="grid lg:grid-cols-2 gap-8">
            {/* 3D Orbital Visualization */}
            <div className="space-y-4">
              <h4 className="text-xl font-semibold text-white flex items-center gap-3">
                <Globe className="w-6 h-6 text-cyan-400" />
                3D Orbital Trajectory Analysis
              </h4>
              <div className="bg-slate-800/40 rounded-xl p-6 border border-slate-700/50">
                <div
                  ref={threeMountRef}
                  className="w-full h-[400px] rounded-lg overflow-hidden bg-gradient-to-b from-slate-900 to-black border border-slate-600"
                />

                {/* Animation Controls */}
                <div className="flex items-center justify-between mt-6">
                  <div className="flex gap-3">
                    <button
                      onClick={playAnimation}
                      disabled={isAnimating}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 disabled:from-slate-600 disabled:to-slate-700 text-white rounded-lg font-medium transition-all duration-200 shadow-lg"
                    >
                      <Play className="w-4 h-4" />
                      {isAnimating ? 'Playing...' : 'Simulate Approach'}
                    </button>
                    <button
                      onClick={resetAnimation}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 text-white rounded-lg font-medium transition-all duration-200 shadow-lg"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reset
                    </button>
                  </div>
                  <div className="text-slate-300 font-medium">Progress: {animationProgress}%</div>
                </div>

                {/* Legend */}
                <div className="flex items-center justify-between mt-4 px-4 py-3 bg-slate-900/50 rounded-lg border border-slate-600/30">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-red-500 rounded-full shadow-lg" />
                    <span className="text-slate-300 font-medium">Original Trajectory</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-green-500 rounded-full shadow-lg" />
                    <span className="text-slate-300 font-medium">Deflected Trajectory</span>
                  </div>
                </div>

                <div className="mt-4 text-center">
                  <p className="text-xs text-slate-400">
                    Use mouse to rotate view • Scroll to zoom • Real-time orbital mechanics simulation
                  </p>
                </div>
              </div>
            </div>

            {/* Enhanced Impact Map */}
            <div className="space-y-4">
              <h4 className="text-xl font-semibold text-white flex items-center gap-3">
                <MapPin className="w-6 h-6 text-red-400" />
                Global Impact Analysis
              </h4>
              <div className="bg-slate-800/40 rounded-xl p-6 border border-slate-700/50">
                <div
                  ref={mapContainerRef}
                  className="relative w-full h-[400px] rounded-lg overflow-hidden border border-slate-600 bg-slate-900"
                />

                {deflectionResult && (
                  <div className="mt-6 grid grid-cols-2 gap-6">
                    <div className="bg-red-500/10 rounded-lg p-4 border border-red-500/30">
                      <div className="text-red-400 font-semibold mb-2 flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Original Target
                      </div>
                      <div className="text-white font-mono text-lg">
                        {originalImpact.lat.toFixed(3)}°, {originalImpact.lng.toFixed(3)}°
                      </div>
                      <div className="text-slate-400 text-sm mt-1">
                        {asteroidData?.location?.name ?? 'Target Location'}
                      </div>
                    </div>
                    <div className="bg-green-500/10 rounded-lg p-4 border border-green-500/30">
                      <div className="text-green-400 font-semibold mb-2 flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        Post-Deflection
                      </div>
                      <div className="text-white font-mono text-lg">
                        {deflectionResult.impactAverted
                          ? 'IMPACT AVOIDED'
                          : `${deflectionResult.newImpactLat.toFixed(3)}°, ${deflectionResult.newImpactLng.toFixed(3)}°`}
                      </div>
                      <div className="text-slate-400 text-sm mt-1">
                        {deflectionResult.impactAverted
                          ? `Miss distance: ${deflectionResult.missDistanceEarthRadii.toFixed(1)} Earth radii`
                          : 'Impact location shifted'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 2D Trajectory Overview */}
          <div className="space-y-4">
            <h4 className="text-xl font-semibold text-white flex items-center gap-3">
              <Globe className="w-6 h-6 text-cyan-400" />
              Approach Trajectory (2D Overview)
            </h4>
            <div className="bg-slate-800/40 rounded-xl p-6 border border-slate-700/50">
              <div
                ref={trajectoryRef}
                className="w-full h-[400px] rounded-lg overflow-hidden border border-slate-600 bg-slate-900"
              />
            </div>
          </div>

          {/* Mission Parameters */}
          <div className="bg-slate-800/30 rounded-xl p-8 border border-slate-700/50">
            <h4 className="text-xl font-semibold text-white mb-6">Mission Configuration</h4>

            {/* Method Selection */}
            <div className="space-y-4 mb-8">
              <label className="block text-white font-semibold text-lg">Deflection Technology</label>
              <div className="grid gap-4">
                {Object.entries(deflectionMethods).map(([key, method]) => (
                  <label
                    key={key}
                    className={`p-6 rounded-xl border-2 cursor-pointer transition-all duration-300 ${
                      deflectionMethod === (key as keyof typeof deflectionMethods)
                        ? 'border-blue-400 bg-gradient-to-r from-blue-500/10 to-purple-500/10 shadow-lg'
                        : 'border-slate-600 bg-slate-700/20 hover:border-slate-500 hover:bg-slate-700/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="deflectionMethod"
                      value={key}
                      checked={deflectionMethod === (key as keyof typeof deflectionMethods)}
                      onChange={(e) => setDeflectionMethod(e.target.value as keyof typeof deflectionMethods)}
                      className="sr-only"
                    />
                    <div className="flex items-start gap-4">
                      <span className="text-3xl">{(method as any).icon}</span>
                      <div className="flex-1">
                        <div className="text-white font-semibold text-lg">{(method as any).name}</div>
                        <div className="text-slate-300 mt-2">{(method as any).description}</div>
                        <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Technology Readiness:</span>
                            <span className="text-white font-medium">TRL {(method as any).trl}/9</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Efficiency:</span>
                            <span className="text-white font-medium">{(((method as any).efficiency ?? 0) * 100).toFixed(0)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Min Timeline:</span>
                            <span className="text-white font-medium">{(method as any).minTiming} days</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Development:</span>
                            <span className="text-white font-medium">{(method as any).developmentTime} years</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Parameter Controls */}
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-white font-semibold">Mission Timeline</label>
                  <div className="bg-cyan-500/20 px-3 py-1 rounded-lg border border-cyan-500/30">
                    <span className="text-cyan-300 font-bold">{deflectionTiming} days</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={currentMethod.minTiming}
                  max={2920}
                  value={deflectionTiming}
                  onChange={(e) => setDeflectionTiming(parseInt(e.target.value, 10))}
                  className="w-full h-3 bg-slate-700 rounded-lg appearance-none cursor-pointer slider"
                />
                <div className="flex justify-between text-sm text-slate-400 mt-3">
                  <span>{currentMethod.minTiming} days</span>
                  <span className="text-cyan-300 font-medium">{(deflectionTiming / 365).toFixed(1)} years</span>
                  <span>8 years</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-white font-semibold">Velocity Change (ΔV)</label>
                  <div className="bg-green-500/20 px-3 py-1 rounded-lg border border-green-500/30">
                    <span className="text-green-300 font-bold">{velocityChange.toFixed(4)} km/s</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0.0001}
                  max={currentMethod.maxVelocityChange}
                  step={0.0001}
                  value={velocityChange}
                  onChange={(e) => setVelocityChange(parseFloat(e.target.value))}
                  className="w-full h-3 bg-slate-700 rounded-lg appearance-none cursor-pointer slider"
                />
                <div className="flex justify-between text-sm text-slate-400 mt-3">
                  <span>0.0001 km/s</span>
                  <span className="text-green-300 font-medium">{(velocityChange * 1000).toFixed(1)} m/s</span>
                  <span>{currentMethod.maxVelocityChange} km/s</span>
                </div>
              </div>
            </div>
          </div>

          {/* Results Dashboard */}
          {deflectionResult && (
            <div className="space-y-8">
              {/* Mission Status */}
              <div
                className={`p-8 rounded-2xl border-2 shadow-2xl ${
                  deflectionResult.impactAverted
                    ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-400/50'
                    : 'bg-gradient-to-r from-red-500/10 to-orange-500/10 border-red-400/50'
                }`}
              >
                <div className="flex items-center gap-6">
                  <div
                    className={`w-20 h-20 rounded-2xl flex items-center justify-center ${
                      deflectionResult.impactAverted ? 'bg-green-500/20' : 'bg-red-500/20'
                    }`}
                  >
                    <span className="text-4xl">{deflectionResult.impactAverted ? '✅' : '⚠️'}</span>
                  </div>
                  <div>
                    <div className="text-white font-bold text-2xl mb-2">
                      {deflectionResult.impactAverted
                        ? 'MISSION SUCCESS: Earth Impact Prevented'
                        : 'WARNING: Impact Still Predicted'}
                    </div>
                    <div
                      className={`text-xl font-semibold ${
                        deflectionResult.impactAverted ? 'text-green-300' : 'text-red-300'
                      }`}
                    >
                      Mission Success Probability: {(deflectionResult.successProbability * 100).toFixed(1)}%
                    </div>
                    <div className="text-slate-300 mt-2">
                      Confidence Level:{' '}
                      <span
                        className={`font-semibold ${
                          deflectionResult.confidenceLevel === 'High'
                            ? 'text-green-400'
                            : deflectionResult.confidenceLevel === 'Medium'
                            ? 'text-yellow-400'
                            : 'text-red-400'
                        }`}
                      >
                        {deflectionResult.confidenceLevel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Technical Analysis */}
              <div className="grid md:grid-cols-4 gap-6">
                <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 rounded-xl p-6 border border-cyan-500/30">
                  <div className="flex items-center gap-3 mb-4">
                    <Target className="w-6 h-6 text-cyan-400" />
                    <span className="text-cyan-300 font-semibold">DEFLECTION</span>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">B-plane Shift:</span>
                      <span className="text-white font-semibold">{(deflectionResult.bPlaneDeflection / 1000).toFixed(0)} km</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Miss Distance:</span>
                      <span className="text-white font-semibold">{deflectionResult.missDistanceEarthRadii.toFixed(1)} R⊕</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Angular Change:</span>
                      <span className="text-white font-semibold">{deflectionResult.angularDeflection.toFixed(4)}°</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded-xl p-6 border border-green-500/30">
                  <div className="flex items-center gap-3 mb-4">
                    <DollarSign className="w-6 h-6 text-green-400" />
                    <span className="text-green-300 font-semibold">MISSION COST</span>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Budget:</span>
                      <span className="text-white font-semibold">${deflectionResult.missionCost.toFixed(0)}M</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Energy Required:</span>
                      <span className="text-white font-semibold">{(deflectionResult.energyRequired / 1e12).toFixed(1)} TJ</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Development:</span>
                      <span className="text-white font-semibold">{deflectionResult.developmentTime} years</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-500/10 to-violet-500/10 rounded-xl p-6 border border-purple-500/30">
                  <div className="flex items-center gap-3 mb-4">
                    <Zap className="w-6 h-6 text-purple-400" />
                    <span className="text-purple-300 font-semibold">RELIABILITY</span>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Timing Factor:</span>
                      <span className="text-white font-semibold">{(deflectionResult.timingFactor * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Size Factor:</span>
                      <span className="text-white font-semibold">{(deflectionResult.sizeFactor * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Tech Readiness:</span>
                      <span className="text-white font-semibold">{(deflectionResult.trlFactor * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-orange-500/10 to-red-500/10 rounded-xl p-6 border border-orange-500/30">
                  <div className="flex items-center gap-3 mb-4">
                    <Clock className="w-6 h-6 text-orange-400" />
                    <span className="text-orange-300 font-semibold">UNCERTAINTY</span>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Position:</span>
                      <span className="text-white font-semibold">±{deflectionResult.positionUncertainty.toFixed(0)} km</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Velocity:</span>
                      <span className="text-white font-semibold">±{deflectionResult.velocityUncertainty.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Mission Risk:</span>
                      <span className="text-white font-semibold">
                        {deflectionResult.successProbability > 0.8 ? 'Low' : deflectionResult.successProbability > 0.6 ? 'Medium' : 'High'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warnings & Recommendations */}
              {(!deflectionResult.impactAverted || deflectionTiming < currentMethod.minTiming || deflectionResult.successProbability < 0.7) && (
                <div className="space-y-4">
                  {!deflectionResult.impactAverted && (
                    <div className="bg-red-900/30 border-l-4 border-red-500 p-6 rounded-lg">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                          <span className="text-red-400 text-xl">⚠️</span>
                        </div>
                        <span className="text-red-300 font-bold text-lg">Critical: Deflection Insufficient</span>
                      </div>
                      <p className="text-slate-200 leading-relaxed">
                        Current mission parameters provide insufficient deflection to prevent Earth impact.
                        <strong> Recommendations:</strong> Increase velocity change, implement earlier mission timeline,
                        consider alternative deflection technologies, or deploy multiple coordinated missions.
                      </p>
                    </div>
                  )}

                  {deflectionTiming < currentMethod.minTiming && (
                    <div className="bg-yellow-900/30 border-l-4 border-yellow-500 p-6 rounded-lg">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-yellow-500/20 rounded-full flex items-center justify-center">
                          <Clock className="w-5 h-5 text-yellow-400" />
                        </div>
                        <span className="text-yellow-300 font-bold text-lg">Timeline Risk Assessment</span>
                      </div>
                      <p className="text-slate-200 leading-relaxed">
                        Mission timeline ({deflectionTiming} days) is below the recommended minimum for {currentMethod.name}
                        ({currentMethod.minTiming} days). This significantly reduces mission success probability and increases
                        technical risks. Extended timeline recommended for optimal results.
                      </p>
                    </div>
                  )}

                  {deflectionResult.successProbability < 0.7 && deflectionResult.impactAverted && (
                    <div className="bg-orange-900/30 border-l-4 border-orange-500 p-6 rounded-lg">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center">
                          <Zap className="w-5 h-5 text-orange-400" />
                        </div>
                        <span className="text-orange-300 font-bold text-lg">Mission Risk Assessment</span>
                      </div>
                      <p className="text-slate-200 leading-relaxed">
                        While impact avoidance is predicted, mission success probability ({(deflectionResult.successProbability * 100).toFixed(1)}%)
                        indicates significant risk factors. Consider backup missions, technology redundancy,
                        or alternative deflection strategies to improve success likelihood.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdvancedDeflectionStrategy;
