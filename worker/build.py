from base64 import b64encode
from io import BytesIO
from pathlib import Path
import json
import mimetypes
import re

from PIL import Image

root = Path(__file__).resolve().parent.parent
dist = root / "dist"
# Build a reviewer-only asset manifest without changing the local website files.
assets = {}
for path in sorted(dist.rglob("*")):
    if not path.is_file() or path.suffix.lower() not in {".html", ".css", ".js", ".svg", ".png", ".jpg"}:
        continue
    key = path.relative_to(dist).as_posix()
    if key.startswith(("server/", ".openai/")):
        continue
    data = path.read_bytes()
    content_type = mimetypes.guess_type(path.name)[0]
    if path.suffix in {".png", ".jpg"}:
        with Image.open(path) as image:
            image.thumbnail((1100, 1100))
            output = BytesIO()
            image.save(output, "WEBP", quality=85)
            data = output.getvalue()
        content_type = "image/webp"
    # The public form uses preset clients and locations, with no bank transfer or messaging links.
    if key == "index.html":
        page = path.read_text(encoding="utf-8")
        page = re.sub(r'<div class="header-social">.*?</div>', '', page, flags=re.S)
        page = re.sub(r'<a href="#(?:contact|payments)">[^<]*</a>', '', page)
        page = re.sub(r'<section class="shell (?:payments|contact)".*?</section>', '', page, flags=re.S)
        page = re.sub(r'<div class="pair">\s*<label>Full name.*?</div>', '', page, count=1, flags=re.S)
        options = "".join(f'<option value="+270000000{i:02}">Demo Client {i:02} (+270000000{i:02})</option>' for i in range(1, 11))
        fields = f'<label>Fictional client <select name="phone" required>{options}</select></label>'
        fields += '<label>Fictional area <select name="area"><option>Demo Area A</option><option>Demo Area B</option><option>Demo Area C</option></select></label>'
        page = re.sub(r'<div class="field">\s*<label for="area">.*?(?=<div class="pair"><label>Preferred date)', fields, page, count=1, flags=re.S)
        page = re.sub(r'<a id="send-booking".*?</a>', '', page)
        page = page.replace("The salon uses your name and phone number to manage your booking. Use fictional details when testing.", "Assignment demo. Choose a fictional client and area below.")
        if any(marker in page for marker in ("wa.me", "mailto:", "51079054590", 'id="map-link"', 'name="name"')):
            raise ValueError("The public demo still contains a private contact, payment or client field.")
        data = page.encode("utf-8")
    if key == "booking.js":
        source = path.read_text(encoding="utf-8")
        start = source.index("// Search the entered area")
        end = source.index("form.elements.date.min", start)
        source = source[:start] + 'form.addEventListener("input", () => { feedback.textContent = ""; });\n' + source[end:]
        start = source.index("    const location =")
        end = source.index("    if (ownerKey)", start)
        source = source[:start] + '    form.reset();\n    feedback.textContent = "Demo booking submitted.";\n' + source[end:]
        source = source.replace('document.createElement("a");\n      contact.href = "tel:" + request.clientPhone;', 'document.createElement("span");')
        data = source.encode("utf-8")
    assets["/" + key] = {"data": b64encode(data).decode("ascii"), "type": content_type}

# Sites loads the generated Worker entry point. The asset manifest is bundled before the handler.
server = dist / "server"
server.mkdir(exist_ok=True)
entry = server / "index.js"
entry.write_text("const ASSETS = " + json.dumps(assets, separators=(",", ":")) + ";\n" +
                 (root / "worker" / "index.js").read_text(encoding="utf-8"), encoding="utf-8")
print(f"Built Sites Worker with {len(assets)} assets ({entry.stat().st_size:,} bytes).")
