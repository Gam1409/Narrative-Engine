# Optional anime face detector for local sprite expressions

Install on the **ComfyUI server**, not the SillyTavern workstation. Copy `narrative_engine_face/` into ComfyUI's `custom_nodes/`. It exposes `NEAnimeFaceMask` and uses the existing PyTorch runtime plus OpenCV 4.x with CascadeClassifier. OpenCV 5.0 on the live server did not expose that class. Install the requirements in the intended ComfyUI environment; avoid changing dependencies of an unrelated running instance.

Download [nagadomi's anime face cascade](https://github.com/nagadomi/lbpcascade_animeface) to `ComfyUI/models/detection/lbpcascade_animeface.xml`. The third-party model is not bundled here. The code and model must be installed before restarting the selected ComfyUI instance. Set Narrative Engine's face detector model to `lbpcascade_animeface.xml` and enable local expressions with `sprite_integrated`.

The node produces a rectangular mask inside one detected face. No face or multiple faces produces an empty mask; the extension declines automatic anchor selection and reports a warning. This detector is not a visual quality evaluator. It can miss profiles or unusual stylization; the anchor editor allows correction. It cannot guarantee perfect facial segmentation.

Alternatively, installed built-in MediaPipe nodes accept `mediapipe_face_fp32.safetensors` from [Comfy-Org](https://huggingface.co/Comfy-Org/mediapipe). That model failed to detect the face in our tested full-body anime sprite; the anime cascade succeeded.

The live test used an isolated ComfyUI instance on loopback port 8189 with OpenCV 4.12 loaded from a separate dependency directory. The existing port 8188 process was not restarted or upgraded. Reloading the existing process alone with its OpenCV 5 environment will not make the anime node work.
