"""Optional automatic anime face anchors for Narrative Engine. Requires OpenCV 4.x."""
from pathlib import Path
import cv2
import numpy as np
import torch
import folder_paths

class NEAnimeFaceMask:
    @classmethod
    def INPUT_TYPES(cls):
        models = sorted({p.name for root in folder_paths.get_folder_paths("detection") for p in Path(root).glob("*.xml")})
        return {"required": {"image": ("IMAGE",), "model_name": (models,)}}
    RETURN_TYPES = ("MASK",)
    FUNCTION = "detect"
    CATEGORY = "Narrative Engine"

    def detect(self, image, model_name):
        if Path(model_name).name != model_name or not model_name.endswith(".xml"):
            raise ValueError("Select an installed cascade filename")
        candidates = [Path(root) / model_name for root in folder_paths.get_folder_paths("detection")]
        filename = next((p for p in candidates if p.is_file()), None)
        if filename is None:
            raise ValueError("Anime face model not installed")
        if not hasattr(cv2, "CascadeClassifier"):
            raise RuntimeError("NEAnimeFaceMask requires OpenCV 4.x with CascadeClassifier")
        classifier = cv2.CascadeClassifier(str(filename))
        if classifier.empty():
            raise ValueError("Invalid anime face cascade")
        masks = []
        for frame in image:
            rgb = np.clip(frame.detach().cpu().numpy() * 255, 0, 255).astype(np.uint8)
            gray = cv2.equalizeHist(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY))
            faces = classifier.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24))
            mask = np.zeros(gray.shape, dtype=np.float32)
            # Never guess which face belongs to the character in an ambiguous image.
            if len(faces) == 1:
                x, y, w, h = map(int, faces[0])
                # Restrict edits to the interior of the detected head, preserving most hair.
                left, top = x + round(w * .12), y + round(h * .20)
                right, bottom = x + round(w * .88), y + round(h * .94)
                mask[max(0,top):min(gray.shape[0],bottom), max(0,left):min(gray.shape[1],right)] = 1
            masks.append(torch.from_numpy(mask))
        return (torch.stack(masks),)

NODE_CLASS_MAPPINGS = {"NEAnimeFaceMask": NEAnimeFaceMask}
NODE_DISPLAY_NAME_MAPPINGS = {"NEAnimeFaceMask": "Narrative Engine: Anime Face Mask"}
