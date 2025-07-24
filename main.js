import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Flow Materials ---
const flowMaterial = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0.0 }, flowSpeed: { value: 1.0 } },
  vertexShader: `
    varying vec3 vPosition;
    void main() {
      vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform float flowSpeed;
    varying vec3 vPosition;
    void main() {
      float flow = sin((vPosition.z * 10.0 + time * 50.0 * flowSpeed)) * 0.5 + 0.5;
      vec3 color = mix(vec3(1.0, 0.1, 0.1), vec3(1.0, 1.0, 1.0), flow);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  side: THREE.DoubleSide,
  transparent: false,
});

const flowMaterial1 = flowMaterial.clone();
flowMaterial1.fragmentShader = flowMaterial1.fragmentShader.replace('+ time * 50.0 * flowSpeed', '- time * 50.0 * flowSpeed');
flowMaterial1.fragmentShader = flowMaterial1.fragmentShader.replace('mix(vec3(1.0, 0.1, 0.1), vec3(1.0, 1.0, 1.0), flow)', 'mix(vec3(0.1, 0.6, 1.0), vec3(0.8, 1.0, 1.0), flow)');

const flowMaterial2 = flowMaterial.clone();
flowMaterial2.fragmentShader = flowMaterial2.fragmentShader.replace('+ time * 50.0 * flowSpeed', '- time * 50.0 * flowSpeed');

const flowMaterial3 = flowMaterial1.clone();
flowMaterial3.fragmentShader = flowMaterial3.fragmentShader.replace('mix(vec3(0.1, 0.6, 1.0), vec3(0.8, 1.0, 1.0), flow)', 'mix(vec3(0.5, 0.1, 0.8), vec3(1.0, 1.0, 1.0), flow)');

const flowMaterial4 = flowMaterial1.clone();
flowMaterial4.fragmentShader = flowMaterial4.fragmentShader.replace('mix(vec3(0.1, 0.6, 1.0), vec3(0.8, 1.0, 1.0), flow)', 'mix(vec3(0.8, 0.6, 0.8), vec3(1.0, 1.0, 1.0), flow)');

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb3e0ff);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(5, 5, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// --- Lights ---
const lightGroup = new THREE.Group();
const numLights = 16;
const radius = 10;
for (let i = 0; i < numLights; i++) {
  const angle = (i / numLights) * Math.PI * 2;
  const light = new THREE.PointLight(0xffffff, 0.6);
  light.position.set(Math.cos(angle) * radius, 5, Math.sin(angle) * radius);
  lightGroup.add(light);
}
scene.add(lightGroup);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 10, 10);
scene.add(dirLight);

// --- Variables ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let meshList = [], selectedMesh = null, originalMaterial = null;

let throttleMesh = null, l2Mesh = null, l1Mesh = null, c_lever = null;
let ballLeverMesh = null, airDiaphragmMesh = null;
let initialBallLeverPosition = new THREE.Vector3();
let initialAirDiaphragmPosition = new THREE.Vector3();
let outletPipeMesh = null, pipe1Mesh = null, pipe3Mesh = null;
let pipe3Mesh_1 = null, pipe1Mesh_1 = null, inletMesh = null, pipe2Mesh = null, pipe4Mesh = null;

let throttleValue = 0, mixtureValue = 0;
let initialL2RotationY = 0, initialCLRotationY = 0, initialL1RotationZ = 0;
let currentTime = 0;

let engineOn = false;
let targetThrottleValue = 0;
let targetMixtureValue = 0;

// Flight variables
let height = 0;
const maxHeight = 5000;
const baseTakeoffVelocity = 50;
let velocity = 0;

let startTime = null;
let elapsedTime = 0;
let totalFuelConsumed = 0;
let lastUpdateTime = 0;
let lastFuelFlowRate = 0;

// --- GLTF Loading ---
const loader = new GLTFLoader();
loader.load('Main_model.glb', (gltf) => {
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      child.material.side = THREE.DoubleSide;
      child.castShadow = true;
      child.receiveShadow = true;
      child.material.needsUpdate = true;
      meshList.push(child);

      // Identify components
      if (child.name === 't_lever') throttleMesh = child;
      if (child.name === 'l2') { l2Mesh = child; initialL2RotationY = child.rotation.y; }
      if (child.name === 'l1') { l1Mesh = child; initialL1RotationZ = child.rotation.z; }
      if (child.name === 'connecting_lever') { c_lever = child; initialCLRotationY = child.rotation.y; }
      if (child.name === 'ball_lever') { ballLeverMesh = child; initialBallLeverPosition.copy(child.position); }
      if (child.name === 'air_diaphragm') { airDiaphragmMesh = child; initialAirDiaphragmPosition.copy(child.position); }
      if (child.name === 'outlet_pipe') outletPipeMesh = child;
      if (child.name === 'pipe1') pipe1Mesh = child;
      if (child.name === 'pipe3') pipe3Mesh = child;
      if (child.name === 'pipe3_1') pipe3Mesh_1 = child;
      if (child.name === 'pipe1_1') pipe1Mesh_1 = child;
      if (child.name === 'inlet') inletMesh = child;
      if (child.name === 'pipe2') pipe2Mesh = child;
      if (child.name === 'pipe4') pipe4Mesh = child;
    }
  });

  // Apply flow materials
  if (outletPipeMesh) outletPipeMesh.material = flowMaterial.clone();
  if (pipe1Mesh) pipe1Mesh.material = flowMaterial1.clone();
  if (pipe3Mesh) pipe3Mesh.material = flowMaterial2.clone();
  if (pipe3Mesh_1) pipe3Mesh_1.material = flowMaterial2.clone();
  if (pipe1Mesh_1) pipe1Mesh_1.material = flowMaterial1.clone();
  if (inletMesh) inletMesh.material = flowMaterial3.clone();
  if (pipe2Mesh) pipe2Mesh.material = flowMaterial4.clone();
  if (pipe4Mesh) pipe4Mesh.material = flowMaterial4.clone();

  scene.add(gltf.scene);

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.near = size / 100;
  camera.far = size * 10;
  camera.updateProjectionMatrix();
  camera.position.copy(center).add(new THREE.Vector3(size, size * 0.5, size));
  controls.update();
}, undefined, (err) => {
  console.error('Error loading model:', err);
});

// --- Container for Both Sliders ---
const controlPanel = document.createElement('div');
controlPanel.style.position = 'fixed';
controlPanel.style.bottom = '250px';
controlPanel.style.right = '50px';
controlPanel.style.display = 'flex';
controlPanel.style.gap = '20px';
document.body.appendChild(controlPanel);

// --- Throttle Container ---
const throttleContainer = document.createElement('div');
throttleContainer.style.width = '60px';
throttleContainer.style.height = '240px';
throttleContainer.style.border = '2px solid #444';
throttleContainer.style.background = '#222';
throttleContainer.style.borderRadius = '10px';
throttleContainer.style.position = 'relative';
throttleContainer.style.display = 'flex';
throttleContainer.style.flexDirection = 'column';
throttleContainer.style.alignItems = 'center';
throttleContainer.style.justifyContent = 'flex-start';
controlPanel.appendChild(throttleContainer);

// --- Throttle Handle ---
const throttleHandle = document.createElement('div');
throttleHandle.style.width = '20px';
throttleHandle.style.height = '30px';
throttleHandle.style.background = '#ff3333';
throttleHandle.style.borderRadius = '4px';
throttleHandle.style.position = 'absolute';
throttleHandle.style.top = '170px';
throttleHandle.style.cursor = 'grab';
throttleContainer.appendChild(throttleHandle);

// --- Throttle % Label ---
const throttleLabel = document.createElement('div');
throttleLabel.textContent = '10%';
throttleLabel.style.color = '#fff';
throttleLabel.style.textAlign = 'center';
throttleLabel.style.position = 'absolute';
throttleLabel.style.top = '210px';
throttleLabel.style.width = '100%';
throttleLabel.style.fontSize = '14px';
throttleContainer.appendChild(throttleLabel);

// --- Throttle Name Label ---
const throttleName = document.createElement('div');
throttleName.textContent = 'Throttle';
throttleName.style.color = '#ccc';
throttleName.style.textAlign = 'center';
throttleName.style.position = 'absolute';
throttleName.style.top = '225px';
throttleName.style.width = '100%';
throttleName.style.fontSize = '13px';
throttleContainer.appendChild(throttleName);

// --- Mixture Container ---
const mixtureContainer = document.createElement('div');
mixtureContainer.style.width = '60px';
mixtureContainer.style.height = '240px';
mixtureContainer.style.border = '2px solid #444';
mixtureContainer.style.background = '#222';
mixtureContainer.style.borderRadius = '10px';
mixtureContainer.style.position = 'relative';
mixtureContainer.style.display = 'flex';
mixtureContainer.style.flexDirection = 'column';
mixtureContainer.style.alignItems = 'center';
mixtureContainer.style.justifyContent = 'flex-start';
controlPanel.appendChild(mixtureContainer);

// --- Mixture Handle ---
const mixtureHandle = document.createElement('div');
mixtureHandle.style.width = '20px';
mixtureHandle.style.height = '30px';
mixtureHandle.style.background = '#33cc33';
mixtureHandle.style.borderRadius = '4px';
mixtureHandle.style.position = 'absolute';
mixtureHandle.style.top = '170px';
mixtureHandle.style.cursor = 'grab';
mixtureContainer.appendChild(mixtureHandle);

// --- Mixture % Label ---
const mixtureLabel = document.createElement('div');
mixtureLabel.textContent = '10%';
mixtureLabel.style.color = '#fff';
mixtureLabel.style.textAlign = 'center';
mixtureLabel.style.position = 'absolute';
mixtureLabel.style.top = '210px';
mixtureLabel.style.width = '100%';
mixtureLabel.style.fontSize = '14px';
mixtureContainer.appendChild(mixtureLabel);

// --- Mixture Name Label ---
const mixtureName = document.createElement('div');
mixtureName.textContent = 'Mixture';
mixtureName.style.color = '#ccc';
mixtureName.style.textAlign = 'center';
mixtureName.style.position = 'absolute';
mixtureName.style.top = '225px';
mixtureName.style.width = '100%';
mixtureName.style.fontSize = '13px';
mixtureContainer.appendChild(mixtureName);

// --- Engine Toggle Button ---
const engineButton = document.createElement('button');
engineButton.textContent = 'Engine OFF';
engineButton.style.marginTop = '20px';
engineButton.style.padding = '8px 16px';
engineButton.style.border = 'none';
engineButton.style.borderRadius = '6px';
engineButton.style.background = '#444';
engineButton.style.color = '#fff';
engineButton.style.cursor = 'pointer';
engineButton.style.fontSize = '14px';
engineButton.style.position = 'absolute';
engineButton.style.bottom = '-60px';
engineButton.style.left = '50%';
engineButton.style.transform = 'translateX(-50%)';
controlPanel.appendChild(engineButton);

const chamberVariables = {
  chamberA: '0',
  chamberB: 0,
  chamberC: '0',
  chamberD: '0',
  massAirFlow: 0,
  fuelFlowRate: 0,
  elapsedTime: 0,
  totalFuelConsumed: 0,
  height: 0,
  velocity: 0,
};

// --- Graph Panel ---
const graphPanel = document.createElement('div');
graphPanel.style.position = 'fixed';
graphPanel.style.left = '20px';
graphPanel.style.top = '20px';
graphPanel.style.width = '400px';
graphPanel.style.height = '300px';
graphPanel.style.background = '#111';
graphPanel.style.border = '2px solid #555';
graphPanel.style.borderRadius = '10px';
graphPanel.style.padding = '10px';
graphPanel.style.color = '#fff';
graphPanel.style.fontFamily = 'monospace';
document.body.appendChild(graphPanel);

// Create canvas for the graph
const canvas = document.createElement('canvas');
canvas.width = 380;
canvas.height = 250;
canvas.style.background = '#222';
canvas.style.border = '1px solid #666';
graphPanel.appendChild(canvas);

const ctx = canvas.getContext('2d');

// Graph title
const graphTitle = document.createElement('div');
graphTitle.textContent = 'Impact Pressure vs Height';
graphTitle.style.textAlign = 'center';
graphTitle.style.fontWeight = 'bold';
graphTitle.style.fontSize = '16px';
graphTitle.style.marginBottom = '10px';
graphPanel.insertBefore(graphTitle, canvas);

// Data storage for the graph
let graphData = [];
const maxDataPoints = 100;

function getFlightPhase(height, velocity) {
  if (height === 0) return 'Ground Idle';
  if (height > 0 && height <= 500) return 'Takeoff Roll';
  if (velocity < 0 && height > 500) return 'Descent';
  if (height > 500 && height < maxHeight) return 'Climb';
  return 'Cruise';
}

// Function to get impact pressure from Chamber B
function calculateImpactPressure(height, velocity) {
  return chamberVariables.chamberB;
}

function updateGraph() {
  const impactPressure = calculateImpactPressure(chamberVariables.height, chamberVariables.velocity);

  graphData.push({
    height: chamberVariables.height,
    pressure: impactPressure
  });

  // Keep only the last maxDataPoints
  if (graphData.length > maxDataPoints) {
    graphData.shift();
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (graphData.length < 2) return;
  const heights = graphData.map(d => d.height);
  const pressures = graphData.map(d => d.pressure);

  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  const minPressure = Math.min(...pressures);
  const maxPressure = Math.max(...pressures);

  const heightRange = maxHeight - minHeight || 1;
  const pressureRange = maxPressure - minPressure || 1;

  // Draw grid lines
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    // Vertical lines (Pressure)
    const x = (canvas.width / 10) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();

    // Horizontal lines (Height)
    const y = (canvas.height / 10) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  ctx.fillText('Time →', canvas.width / 2 - 20, canvas.height - 10);
  ctx.save();
  ctx.translate(15, canvas.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Impact Pressure (Pa)', 0, 0);
  ctx.restore();

  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let i = 0; i < graphData.length; i++) {
    const x = (i / (graphData.length - 1)) * canvas.width;
    const y = canvas.height - ((graphData[i].pressure - minPressure) / pressureRange) * canvas.height;


    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  if (graphData.length > 0) {
    const lastPoint = graphData[graphData.length - 1];
    const x = ((graphData.length - 1) / (graphData.length - 1)) * canvas.width;
    const y = canvas.height - ((lastPoint.pressure - minPressure) / pressureRange) * canvas.height;



    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fill();
  }

  ctx.fillStyle = '#fff';
  ctx.font = '14px monospace';
  ctx.fillText(`H: ${chamberVariables.height.toFixed(1)}m`, canvas.width - 120, 20);
  ctx.fillText(`P: ${chamberVariables.chamberB}Pa`, canvas.width - 120, 40);
}


const chamberPanel = document.createElement('div');
chamberPanel.style.position = 'fixed';
chamberPanel.style.left = '20px';
chamberPanel.style.bottom = '20px';
chamberPanel.style.height = 'auto';
chamberPanel.style.width = '320px';
chamberPanel.style.background = '#111';
chamberPanel.style.border = '2px solid #555';
chamberPanel.style.borderRadius = '10px';
chamberPanel.style.padding = '10px';
chamberPanel.style.color = '#fff';
chamberPanel.style.fontFamily = 'monospace';
chamberPanel.style.fontSize = '18px';
chamberPanel.style.lineHeight = '1.6';
document.body.appendChild(chamberPanel);

function updateChamberPanel() {
  const minutes = Math.floor(chamberVariables.elapsedTime / 60);
  const seconds = Math.floor(chamberVariables.elapsedTime % 60);
  const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  const flightPhase = getFlightPhase(chamberVariables.height, chamberVariables.velocity);

  chamberPanel.innerHTML = `
    <strong style="font-size: 20px; display: block; margin-bottom: 10px;">Simulation Panel</strong>
    <div>Flight Phase: <strong style="color: #00ff00;">${flightPhase}</strong></div>
    <div>Height: <strong>${chamberVariables.height.toFixed(1)} m</strong></div>
    <div>Velocity: <strong>${chamberVariables.velocity.toFixed(1)} m/s</strong></div>
    <div>Chamber A: <strong>${chamberVariables.chamberA} kPa</strong></div>
    <div>Chamber B: <strong>${chamberVariables.chamberB} kPa</strong></div>
    <div>Chamber C: <strong>${chamberVariables.chamberC} kPa</strong></div>
    <div>Chamber D: <strong>${chamberVariables.chamberD} kPa</strong></div>
    <div>Mass Air Flow: <strong>${chamberVariables.massAirFlow.toFixed(3)} kg/s</strong></div>
    <div>Fuel Flow Rate: <strong>${chamberVariables.fuelFlowRate.toFixed(3)} kg/s</strong></div>
    <div>Elapsed Time: <strong>${timeString}</strong></div>
    <div>Total Fuel: <strong>${chamberVariables.totalFuelConsumed.toFixed(4)} kg</strong></div>
  `;
}

updateChamberPanel();

engineButton.addEventListener('click', () => {
  engineOn = !engineOn;
  engineButton.textContent = engineOn ? 'Engine ON' : 'Engine OFF';

  if (engineOn) {
    targetThrottleValue = 10;
    targetMixtureValue = 10;
    if (startTime === null) {
      startTime = Date.now();
      lastUpdateTime = startTime;
    }
  } else {
    targetThrottleValue = 0;
    targetMixtureValue = 0;
    startTime = null;
    elapsedTime = 0;
    totalFuelConsumed = 0;
    height = 0;
    velocity = 0;
    chamberVariables.elapsedTime = 0;
    chamberVariables.totalFuelConsumed = 0;
    chamberVariables.height = 0;
    chamberVariables.velocity = 0;
    graphData = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateChamberPanel();
  }
});

// --- Drag Logic ---
let isDraggingThrottle = false;
let isDraggingMixture = false;
let startY = 0;

function handleDragStart(e, isThrottle) {
  startY = e.clientY;
  if (isThrottle) {
    isDraggingThrottle = true;
    throttleHandle.style.cursor = 'grabbing';
  } else {
    isDraggingMixture = true;
    mixtureHandle.style.cursor = 'grabbing';
  }
}

function handleDragMove(e) {
  const deltaY = e.clientY - startY;
  startY = e.clientY;

  if (isDraggingThrottle) {
    let top = parseFloat(throttleHandle.style.top);
    top = Math.min(170, Math.max(0, top + deltaY));
    throttleHandle.style.top = `${top}px`;
    throttleValue = Math.round(100 - (top / 170) * 100);
    throttleLabel.textContent = `${throttleValue}%`;
    targetThrottleValue = throttleValue;
    updateThrottle(throttleValue);
  }

  if (isDraggingMixture) {
    let top = parseFloat(mixtureHandle.style.top);
    top = Math.min(170, Math.max(0, top + deltaY));
    mixtureHandle.style.top = `${top}px`;
    mixtureValue = Math.round(100 - (top / 170) * 100);
    mixtureLabel.textContent = `${mixtureValue}%`;
    targetMixtureValue = mixtureValue;
    updateMixture(mixtureValue);
  }
}

function handleDragEnd() {
  isDraggingThrottle = false;
  isDraggingMixture = false;
  throttleHandle.style.cursor = 'grab';
  mixtureHandle.style.cursor = 'grab';
}

// --- Events ---
throttleHandle.addEventListener('mousedown', e => handleDragStart(e, true));
mixtureHandle.addEventListener('mousedown', e => handleDragStart(e, false));
window.addEventListener('mousemove', handleDragMove);
window.addEventListener('mouseup', handleDragEnd);

function updateChamberVariables() {
  if (engineOn) {
    if (throttleValue > 20) {
      height += (throttleValue - 20) * 0.1;
      height = Math.min(height, maxHeight);
    } else if (throttleValue < 20 && height > 0) {
      height -= (20 - throttleValue) * 0.05;
      height = Math.max(height, 0);
    }

    if (height === 0) {
      velocity = 60;
    } else if (height > 0 && height <= 500) {
      velocity = 60 + (throttleValue / 100) * (150 - 60);
    } else if (height > 500 && height < maxHeight) {
      velocity = 150 + (throttleValue / 100) * (250 - 150);
    } else {
      velocity = 250;
    }

    const rho = 1.225 * (1 - height * 0.0001);

    const baseImpactPressure = 130000;
    const altitudeFactor = Math.max(0.3, 1 - height * 0.00005);
    const velocityFactor = Math.pow(velocity / 200, 2);
    const P_impact = baseImpactPressure * altitudeFactor * velocityFactor;

    const dynamicPressure = 0.5 * rho * Math.pow(velocity, 2);
    const P_venturi = P_impact - dynamicPressure;

    const area = 0.2;
    const massAirFlow = rho * area * velocity;

    const AFR = 4.5;
    const fuelBase = (massAirFlow / AFR) * (mixtureValue / 100);
    let fuelFlowRate = fuelBase * (throttleValue);
    fuelFlowRate = Math.max(fuelFlowRate, 10);  // clamp


    // Update chamber readings
    chamberVariables.chamberA = Math.round(P_venturi) / 1000;
    chamberVariables.chamberB = Math.round(P_impact) / 1000;
    chamberVariables.chamberD = Math.round(P_impact * 1.75) / 1000;
    chamberVariables.chamberC = Math.round((P_venturi + P_impact) * 2) / 1000;

    chamberVariables.massAirFlow = massAirFlow;
    chamberVariables.fuelFlowRate = fuelFlowRate;
    chamberVariables.height = height;
    chamberVariables.velocity = velocity;

    chamberVariables.airDensity = rho;
    chamberVariables.impactPressure = P_impact;
    chamberVariables.dynamicPressure = dynamicPressure;

    updateChamberPanel();
    updateGraph();
  }
}


function updateMixture(percent) {
  mixtureValue = percent;
  if (l1Mesh) {
    const maxAngle = THREE.MathUtils.degToRad(30);
    l1Mesh.rotation.z = initialL1RotationZ - maxAngle * (percent / 100);
  }
}

let delayedPipesTimeout = null;
function updateThrottle(percent) {
  const throttleSpeed = 0.1 + (percent / 100) * 1.9;

  [pipe1Mesh, pipe1Mesh_1].forEach(mesh => {
    if (mesh) mesh.material.uniforms.flowSpeed.value = throttleSpeed;
  });

  const combinedFlowSpeed = 0.1 + (throttleValue / 100) * 1.5 + (mixtureValue / 100) * 1.5;

  [outletPipeMesh, pipe3Mesh, pipe3Mesh_1].forEach(mesh => {
    if (mesh) mesh.material.uniforms.flowSpeed.value = combinedFlowSpeed;
  });

  if (throttleMesh) {
    const maxAngle = Math.PI / 2;
    throttleMesh.rotation.z = -maxAngle * (percent / 100);
  }
  if (l2Mesh) {
    const maxL2Angle = THREE.MathUtils.degToRad(15);
    l2Mesh.rotation.y = initialL2RotationY - maxL2Angle * (percent / 100);
  }
  if (c_lever) {
    const maxCAngle = THREE.MathUtils.degToRad(8);
    c_lever.rotation.y = initialCLRotationY + maxCAngle * (percent / 100);
  }
  if (ballLeverMesh && airDiaphragmMesh) {
    const offset = 0.2 * (percent / 100);
    ballLeverMesh.position.z = initialBallLeverPosition.z + offset;
    airDiaphragmMesh.position.z = initialAirDiaphragmPosition.z + offset;
  }
}

function animate(time) {
  currentTime = time * 0.001;

  if (engineOn && startTime !== null) {
    const now = Date.now();
    elapsedTime = (now - startTime) / 1000;

    const deltaTime = (now - lastUpdateTime) / 1000;
    if (deltaTime > 0) {
      const avgFuelFlowRate = (chamberVariables.fuelFlowRate + lastFuelFlowRate) / 2;
      totalFuelConsumed += avgFuelFlowRate * deltaTime;
      lastFuelFlowRate = chamberVariables.fuelFlowRate;
      lastUpdateTime = now;
    }

    chamberVariables.elapsedTime = elapsedTime;
    chamberVariables.totalFuelConsumed = totalFuelConsumed;

    updateChamberVariables();
  }

  // Smoothly animate towards target values
  const lerpFactor = 0.05;
  throttleValue += (targetThrottleValue - throttleValue) * lerpFactor;
  mixtureValue += (targetMixtureValue - mixtureValue) * lerpFactor;

  // Round for UI display
  const throttleRounded = Math.round(throttleValue);
  const mixtureRounded = Math.round(mixtureValue);

  // Update visuals
  throttleLabel.textContent = `${throttleRounded}%`;
  throttleHandle.style.top = `${170 - (throttleValue / 100) * 170}px`;

  mixtureLabel.textContent = `${mixtureRounded}%`;
  mixtureHandle.style.top = `${170 - (mixtureValue / 100) * 170}px`;

  updateThrottle(throttleValue);
  updateMixture(mixtureValue);

  const baseSpeed = engineOn ? (0.2 + (throttleValue / 100) * 2.8) : 0;
  const mixtureBoost = engineOn ? ((mixtureValue / 100) * 2.0) : 0;

  if (outletPipeMesh) outletPipeMesh.material.uniforms.time.value = currentTime * baseSpeed;
  if (pipe1Mesh) pipe1Mesh.material.uniforms.time.value = currentTime * baseSpeed;
  if (pipe1Mesh_1) pipe1Mesh_1.material.uniforms.time.value = currentTime * baseSpeed;
  if (pipe3Mesh) pipe3Mesh.material.uniforms.time.value = currentTime * (baseSpeed + mixtureBoost);
  if (pipe3Mesh_1) pipe3Mesh_1.material.uniforms.time.value = currentTime * (baseSpeed + mixtureBoost);
  if (inletMesh) {
    inletMesh.material.uniforms.time.value = engineOn ? currentTime : 0;
  }
  if (pipe2Mesh) pipe2Mesh.material.uniforms.time.value = currentTime * baseSpeed;
  if (pipe4Mesh) pipe4Mesh.material.uniforms.time.value = currentTime * baseSpeed;

  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
