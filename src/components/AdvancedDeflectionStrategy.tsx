import React, { useEffect, useRef, useState } from 'react';
import { Shield, Zap, Target, DollarSign, Clock, Globe, Play, RotateCcw, MapPin } from 'lucide-react';

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

  // Animation frame ref (used for progress animation)
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

  // Simplified Canvas-based Orbital Visualization (replaces 3D)
  useEffect(() => {
    if (!deflectionEnabled || !threeMountRef.current) return;

    const container = threeMountRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 600;
    const height = 400;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = '100%';
    canvas.style.height = `${height}px`;
    canvas.style.borderRadius = '8px';
    canvas.style.background = 'linear-gradient(180deg, #0b1020 0%, #000 100%)';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};

    const earthX = width / 2;
    const earthY = height / 2;
    const earthRadius = 22;

    const createTrajectoryPoints = (isDeflected = false) => {
      const points: [number, number][] = [];
      const segments = 160;
      const deflectionScale = isDeflected ? clamp(velocityChange * 1000, 0.5, 60) : 0;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const baseX = 40 + t * (width - 160);
        const baseY = earthY + Math.sin(t * Math.PI * 0.8) * 60 - 30;
        const deflectionOffset = isDeflected ? t * t * deflectionScale : 0;
        points.push([baseX, baseY + deflectionOffset]);
      }
      return points;
    };

    const originalPoints = createTrajectoryPoints(false);
    const deflectedPoints = createTrajectoryPoints(true);

    const drawScene = () => {
      ctx.clearRect(0, 0, width, height);

      // subtle stars
      ctx.save();
      for (let i = 0; i < 150; i++) {
        ctx.fillStyle = 'rgba(148,163,184,0.35)';
        const x = Math.random() * width;
        const y = Math.random() * height;
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.restore();

      // Earth
      ctx.beginPath();
      ctx.arc(earthX, earthY, earthRadius + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59,130,246,0.3)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(earthX, earthY, earthRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#22C55E';
      ctx.strokeStyle = '#16A34A';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#F1F5F9';
      ctx.font = 'bold 12px system-ui, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Earth', earthX, earthY + earthRadius + 18);

      const drawPath = (points: [number, number][], color: string, dashed = false) => {
        ctx.beginPath();
        points.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        if (dashed) ctx.setLineDash([8, 4]); else ctx.setLineDash([]);
        ctx.globalAlpha = 0.9;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      };

      drawPath(originalPoints, '#EF4444');
      drawPath(deflectedPoints, '#22C55E', true);

      // label chips
      const labelAt = Math.floor(originalPoints.length * 0.2);
      const [lx, ly] = originalPoints[labelAt];
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(lx - 35, ly - 24, 70, 16);
      ctx.fillStyle = '#EF4444';
      ctx.font = 'bold 10px system-ui, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Original', lx, ly - 12);

      const [dlx, dly] = deflectedPoints[labelAt];
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(dlx - 38, dly - 24, 76, 16);
      ctx.fillStyle = '#22C55E';
      ctx.fillText('Deflected', dlx, dly - 12);

      // deflection impulse glyph
      ctx.fillStyle = '#F59E0B';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      const gx = 160, gy = earthY - 60;
      ctx.beginPath(); ctx.arc(gx, gy, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + 22 * Math.cos(Math.PI / 4), gy + 22 * Math.sin(Math.PI / 4));
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = '#F59E0B';
      ctx.font = 'bold 10px system-ui, Arial';
      ctx.textAlign = 'left';
      ctx.fillText(`Deflection: ${(velocityChange * 1000).toFixed(1)} m/s`, gx + 14, gy - 12);

      // moving asteroids
      const idx = Math.floor((progressRef.current / 100) * (originalPoints.length - 1));
      const [ox, oy] = originalPoints[Math.max(0, Math.min(idx, originalPoints.length - 1))];
      const [dx, dy] = deflectedPoints[Math.max(0, Math.min(idx, deflectedPoints.length - 1))];

      const drawAsteroid = (x: number, y: number, color: string) => {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
      };
      if (isAnimatingRef.current && progressRef.current <= 100) {
        drawAsteroid(ox, oy, '#EF4444');
        drawAsteroid(dx, dy, '#22C55E');
      }

      // footer legend
      ctx.fillStyle = '#CBD5E1';
      ctx.font = 'bold 11px system-ui, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Simplified Orbital Trajectory (Top-Down View)', width / 2, 18);
    };

    // draw periodically to reflect animation progress
    const interval = window.setInterval(drawScene, 50);
    drawScene();

    const onResize = () => {
      const w = container.clientWidth || 600;
      canvas.width = w; canvas.height = height;
      drawScene();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      window.clearInterval(interval);
      container.innerHTML = '';
    };
  }, [deflectionEnabled, velocityChange]);

  // World map: Canvas-based impact visualization with real equirectangular map
  useEffect(() => {
    if (!deflectionResult || !mapContainerRef.current) return;

    const container = mapContainerRef.current;
    container.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    canvas.style.width = '100%';
    canvas.style.height = '400px';
    canvas.style.borderRadius = '12px';
    canvas.style.border = '1px solid #475569';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const worldMapUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/World_map_-_low_resolution.svg/2000px-World_map_-_low_resolution.svg.png';
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const toCanvas = (lat: number, lng: number) => ({
      x: ((lng + 180) * canvas.width) / 360,
      y: ((90 - lat) * canvas.height) / 180,
    });

    const drawImpactLayers = () => {
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
        ctx.fillRect(p.x + 15, p.y - 20, 170, 35);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px system-ui, Arial';
        ctx.fillText(label, p.x + 20, p.y - 5);
        ctx.fillStyle = '#94A3B8';
        ctx.font = '12px system-ui, Arial';
        ctx.fillText(`${lat.toFixed(2)}°, ${lng.toFixed(2)}°`, p.x + 20, p.y + 10);
      };

      // Original impact
      drawImpactPoint(originalImpact.lat, originalImpact.lng, '#EF4444', 'Original Impact');

      if (deflectionResult.impactAverted) {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
        ctx.fillRect(20, 20, 240, 50);
        ctx.strokeStyle = '#22C55E';
        ctx.lineWidth = 2;
        ctx.strokeRect(20, 20, 240, 50);
        ctx.fillStyle = '#22C55E';
        ctx.font = 'bold 18px system-ui, Arial';
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
    };

    img.onload = () => {
      // draw full-bleed world map (equirectangular is 2:1)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      drawImpactLayers();
    };
    img.onerror = () => {
      // fallback: dark background + message
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '14px system-ui, Arial';
      ctx.fillText('Map failed to load. Check network access.', 20, 30);
      drawImpactLayers();
    };
    img.src = worldMapUrl;

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
