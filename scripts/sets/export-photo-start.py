"""Write <scan>.start-view.json from the matching COLMAP reconstruction.

Requires numpy and pycolmap in the training environment. Pass the reconstruction
used for training and the run's scene_transform.json, not an unrelated camera
export. The scan must be in that run's training coordinates.
"""
import argparse
import json
import math
import re
from pathlib import Path

import numpy as np
import pycolmap


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan', type=Path, required=True)
    parser.add_argument('--reconstruction', type=Path, required=True)
    parser.add_argument('--scene-transform', type=Path, required=True)
    parser.add_argument('--image', help='Exact registered image name; defaults to first in filename order.')
    args = parser.parse_args()
    if not args.scan.is_file():
        parser.error('The exported scan does not exist.')
    reconstruction = pycolmap.Reconstruction(args.reconstruction)
    images = sorted(reconstruction.images.values(), key=lambda im: [int(s) if s.isdigit() else s for s in re.split(r'(\d+)', im.name)])
    if not images:
        parser.error('No aligned camera images found.')
    image = next((im for im in images if im.name == args.image), None) if args.image else images[0]
    if image is None:
        parser.error('The selected image has no aligned camera.')
    transform = json.loads(args.scene_transform.read_text())
    if transform.get('format') != 'spirula-scene-transform':
        parser.error('Expected a Spirula scene_transform.json.')
    matrix = np.array(transform['train_from_world']['matrix_4x4'], dtype=float)
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all() or abs(np.linalg.det(matrix)) < 1e-12:
        parser.error('Invalid scene transform.')
    # COLMAP cameras look down +Z with +Y down. Invert world-to-camera,
    # then use its +Z for forward and -Y for the viewer's up direction.
    pose = np.eye(4)
    pose[:3] = image.cam_from_world().inverse().matrix()
    pose = matrix @ pose
    position = pose[:3, 3]
    forward = pose[:3, 2] / np.linalg.norm(pose[:3, 2])
    up = -pose[:3, 1] / np.linalg.norm(pose[:3, 1])
    camera = reconstruction.cameras[image.camera_id]
    calibration = camera.calibration_matrix()
    data = {
        'format': 'cinegen-start-view', 'version': 1, 'coordinates': 'splat-local',
        'sourceImage': image.name,
        'position': position.tolist(), 'target': (position + forward).tolist(), 'up': up.tolist(),
        'verticalFov': math.degrees(2 * math.atan(camera.height / (2 * calibration[1, 1]))),
        'imageWidth': camera.width, 'imageHeight': camera.height,
    }
    output = args.scan.with_suffix('.start-view.json')
    output.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')
    print(f'{output}: {image.name}')


if __name__ == '__main__':
    main()
