import os, re, hashlib, requests
from safetensors.torch import safe_open
import folder_paths


def _calculate_sha256(path):
    sha = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)
    return sha.hexdigest()


def _fetch_civitai_info(path):
    try:
        h = _calculate_sha256(path)
        resp = requests.get(f"https://civitai.com/api/v1/model-versions/by-hash/{h}", timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"[LoRAStack] Failed civitai fetch: {e}")
    return {}


def _read_safetensors_fallback(path):
    """Return a single fallback tag from safetensors metadata."""
    try:
        with safe_open(path, framework="pt", device="cpu") as f:
            meta = f.metadata() or {}
        for k in ["ss_training_tags", "tags", "trigger_words"]:
            if k in meta:
                val = meta[k]
                if isinstance(val, list) and val:
                    return [val[0]]
                elif isinstance(val, str):
                    return [val.split(",")[0].strip()]
        return []
    except:
        return []


class LoraStackTagSelector:
    @classmethod
    def INPUT_TYPES(cls):
        lora_files = folder_paths.get_filename_list("loras") or ["--no-loras--"]
        req = {
            "model": ("MODEL",),
            "clip": ("CLIP",),
            "num_loras": (["1","2","3","4","5","6"],),
        }
        for i in range(1,7):
            req[f"lora{i}_enabled"] = ("BOOLEAN", {"default": False})
            req[f"lora{i}_file"] = (lora_files,)
            req[f"lora{i}_weight"] = ("FLOAT", {"default":1.0,"min":-3.0,"max":3.0,"step":0.01})
        return {"required": req}

    RETURN_TYPES = ("MODEL","CLIP","LORA_STACK","LIST","STRING","LIST")
    RETURN_NAMES = ("Model","Clip","Lora_Stack","Selected_Tags_List","Selected_Tags_String","Lora_Names_List")
    FUNCTION = "build"
    CATEGORY = "Custom/LoRA"
    OUTPUT_NODE = True

    def build(self, model, clip, num_loras,
              lora1_enabled,lora1_file,lora1_weight,
              lora2_enabled,lora2_file,lora2_weight,
              lora3_enabled,lora3_file,lora3_weight,
              lora4_enabled,lora4_file,lora4_weight,
              lora5_enabled,lora5_file,lora5_weight,
              lora6_enabled,lora6_file,lora6_weight,
              **kwargs):

        try: 
            n=int(num_loras)
        except: 
            n=1
        n=max(1,min(6,n))

        picks=[(lora1_enabled,lora1_file,lora1_weight,1),
               (lora2_enabled,lora2_file,lora2_weight,2),
               (lora3_enabled,lora3_file,lora3_weight,3),
               (lora4_enabled,lora4_file,lora4_weight,4),
               (lora5_enabled,lora5_file,lora5_weight,5),
               (lora6_enabled,lora6_file,lora6_weight,6)]

        stack=[]; names=[]; selected_tags=[]; ui={}

        for enabled,fname,w,i in picks:
            if i>n or not enabled or fname.startswith("--"): 
                continue

            rel=fname.replace("\\\\","\\")
            full=folder_paths.get_full_path("loras",fname)
            stack.append((rel,float(w),0.0))
            names.append(rel)

            # Prefer civitai-trainedWords
            civ=_fetch_civitai_info(full)
            tags=civ.get("trainedWords") or _read_safetensors_fallback(full)

            # What did user select last time?
            sel_str = kwargs.get(f"lora{i}_selected","").strip()
            chosen = [s.strip() for s in sel_str.split(",") if s.strip()]
            if not chosen:  # default to civitai tags if nothing selected
                chosen = tags

            selected_tags.extend(chosen)

            # Send choices to frontend for rendering
            ui[f"lora{i}_triggers"] = {
                "anchor": f"lora{i}_weight",
                "choices": tags,
                "selected": chosen
            }

        return {
            "ui": ui,
            "result": (model, clip, stack, selected_tags, ", ".join(selected_tags), names)
        }


NODE_CLASS_MAPPINGS={"LoraStackTagSelector":LoraStackTagSelector}
NODE_DISPLAY_NAME_MAPPINGS={"LoraStackTagSelector":"LoRA Stack + Tag Selector (Selectable Triggers)"}

# Add this if you want to co-locate JS in ./web/
WEB_DIRECTORY = os.path.join(os.path.dirname(__file__), "web")

