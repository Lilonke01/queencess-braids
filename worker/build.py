from base64 import b64encode
from io import BytesIO
from pathlib import Path
import json
import mimetypes
import re
import sys

netlify = sys.argv[1:] == ["--netlify"]
if not netlify:
    from PIL import Image

root = Path(__file__).resolve().parent.parent
dist = root / "dist"
# Package the customer website and protected owner workspace.
assets = {}
for path in sorted(dist.rglob("*")):
    if not path.is_file() or path.suffix.lower() not in {".html", ".css", ".js", ".svg", ".png", ".jpg"}:
        continue
    key = path.relative_to(dist).as_posix()
    if key.startswith(("server/", ".openai/")):
        continue
    data = path.read_bytes()
    content_type = mimetypes.guess_type(path.name)[0]
    if not netlify and path.suffix in {".png", ".jpg"}:
        with Image.open(path) as image:
            image.thumbnail((1100, 1100))
            output = BytesIO()
            image.save(output, "WEBP", quality=85)
            data = output.getvalue()
        content_type = "image/webp"
    # Bank account details are not needed to request a real appointment.
    if key == "index.html":
        page = path.read_text(encoding="utf-8")
        page = re.sub(r'<a href="#payments">[^<]*</a>', '', page)
        page = re.sub(r'<section class="shell payments".*?</section>', '', page, flags=re.S)
        data = page.encode("utf-8")
    if netlify:
        target = root / "netlify-dist" / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        continue
    assets["/" + key] = {"data": b64encode(data).decode("ascii"), "type": content_type}

if netlify:
    print("Built Netlify site in netlify-dist.")
    sys.exit(0)

# Sites loads the generated Worker entry point. The asset manifest is bundled before the handler.
server = dist / "server"
server.mkdir(exist_ok=True)
entry = server / "index.js"
entry.write_text("const ASSETS = " + json.dumps(assets, separators=(",", ":")) + ";\n" +
                 (root / "worker" / "index.js").read_text(encoding="utf-8"), encoding="utf-8")
print(f"Built Sites Worker with {len(assets)} assets ({entry.stat().st_size:,} bytes).")
