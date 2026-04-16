import * as THREE from 'three';

function createD20Dice(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0xd4a73f,
    metalness: 0.95,
    roughness: 0.2,
    emissive: 0x2a1b05,
    emissiveIntensity: 0.18,
  });
  const d20 = new THREE.Mesh(geometry, material);
  d20.rotation.x = 0.35;
  scene.add(d20);

  const keyLight = new THREE.DirectionalLight(0xfff3c6, 1.2);
  keyLight.position.set(2.2, 3.5, 2.5);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xffc75a, 0.7);
  rimLight.position.set(-2.5, 1.2, -1.8);
  scene.add(rimLight);

  const ambient = new THREE.AmbientLight(0x6b5840, 0.35);
  scene.add(ambient);

  camera.position.z = 3.6;

  const onResize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  window.addEventListener('resize', onResize);

  function animate() {
    requestAnimationFrame(animate);
    d20.rotation.y += 0.02;
    renderer.render(scene, camera);
  }

  animate();
}

export default createD20Dice;