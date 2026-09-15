// Bake Quaternius' CC0 base character into compact, dependency-free static poses.
// Usage: node scripts/sets/bake-mannequin.mjs /path/to/Superhero_Male_FullBody.gltf
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const source = process.argv[2];
if (!source) throw new Error('Pass the source glTF path. See src/assets/mannequin/README.md.');
const data = JSON.parse(fs.readFileSync(source, 'utf8'));
for (const buffer of data.buffers) buffer.uri = `data:application/octet-stream;base64,${fs.readFileSync(path.resolve(path.dirname(source), buffer.uri)).toString('base64')}`;
delete data.images; delete data.textures; delete data.samplers;
data.materials = [{}];
for (const mesh of data.meshes) for (const primitive of mesh.primitives) primitive.material = 0;
globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
const scene = gltf.scene;
scene.updateMatrixWorld(true);
if (process.env.INSPECT_MODEL) {
 scene.traverse(n=>{if(n.isBone&&/upperarm|lowerarm|hand_|thigh|calf|foot_|Head|pelvis/.test(n.name)) console.log(n.name,n.getWorldPosition(new THREE.Vector3()).toArray());});
 process.exit(0);
}
const rest = new Map(); scene.traverse(n=>{ if(n.isBone) rest.set(n,n.quaternion.clone()); });
function turn(name, axis, degrees) {
 const bone=scene.getObjectByName(name); if(!bone) throw new Error(`Missing bone ${name}`);
 scene.updateMatrixWorld(true);
 const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion());
 const rotation=new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees));
 bone.quaternion.premultiply(parent.clone().invert().multiply(rotation).multiply(parent));
}
const X=new THREE.Vector3(1,0,0), Z=new THREE.Vector3(0,0,1);
const poses={}; let indices;
for(const pose of ['standing','walking','sitting','kneeling']) {
 for(const [bone,q] of rest) bone.quaternion.copy(q);
 // Relax the source T-pose into a neutral standing pose.
 turn('upperarm_l', Z, -75); turn('upperarm_r', Z, 75);
 if(pose==='walking') { turn('thigh_l',X,-22);turn('thigh_r',X,18);turn('calf_r',X,20);turn('upperarm_l',X,18);turn('upperarm_r',X,-18); }
 if(pose==='sitting') { for(const side of ['l','r']) { turn(`thigh_${side}`,X,-85);turn(`calf_${side}`,X,85);turn(`upperarm_${side}`,X,-20);turn(`lowerarm_${side}`,X,-65); } }
 if(pose==='kneeling') { turn('thigh_l',X,-80);turn('calf_l',X,85);turn('thigh_r',X,10);turn('calf_r',X,120); }
 scene.updateMatrixWorld(true);
 scene.traverse(n=>{ if(n.isSkinnedMesh) n.skeleton.update(); });
 const positions=[], index=[];
 scene.traverse(mesh=>{
  if(!mesh.isMesh) return;
  const offset=positions.length/3,p=mesh.geometry.getAttribute('position');
  for(let i=0;i<p.count;i++) { const v=new THREE.Vector3().fromBufferAttribute(p,i);if(mesh.isSkinnedMesh) mesh.applyBoneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);positions.push(v.x,v.y,v.z); }
  for(const i of mesh.geometry.index.array) index.push(i+offset);
 });
 indices ??= index;
 poses[pose]=positions;
}
const standing=poses.standing;let min=Infinity,max=-Infinity;
for(let i=1;i<standing.length;i+=3){ min=Math.min(min,standing[i]);max=Math.max(max,standing[i]); }
const height=max-min;
for(const positions of Object.values(poses)){
 let floor=Infinity; for(let i=1;i<positions.length;i+=3) floor=Math.min(floor,positions[i]);
 for(let i=0;i<positions.length;i++) positions[i]=Math.round((positions[i]-(i%3===1?floor:0))/height*100000)/100000;
}
fs.writeFileSync('src/assets/mannequin/poses.json',JSON.stringify({indices,poses}));
console.log('Baked',indices.length/3,'triangles, four poses');
