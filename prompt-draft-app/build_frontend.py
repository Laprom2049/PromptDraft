from pathlib import Path
import re
import hashlib
import base64

ROOT = Path(__file__).resolve().parent
source = ROOT / 'src'
template = (source / 'index.template.html').read_text(encoding='utf-8')
parts = {
    '<!--APP_STYLES-->': '\n' + (source / 'styles.css').read_text(encoding='utf-8') + '\n',
    '<!--CORE_SCRIPT-->': '\n' + (source / 'core.js').read_text(encoding='utf-8') + '\n',
    '<!--APP_SCRIPT-->': '\n' + (source / 'app.js').read_text(encoding='utf-8') + '\n',
}
for marker, value in parts.items():
    if template.count(marker) != 1:
        raise ValueError('Missing or repeated build marker: ' + marker)
    template = template.replace(marker, value)
script_hashes = []
for marker in ['<!--CORE_SCRIPT-->', '<!--APP_SCRIPT-->']:
    digest = hashlib.sha256(parts[marker].encode('utf-8')).digest()
    script_hashes.append("'sha256-" + base64.b64encode(digest).decode('ascii') + "'")
template = template.replace("script-src 'unsafe-inline'", 'script-src ' + ' '.join(script_hashes))
if re.search(r'<(?:script|link)[^>]+(?:src|href)=["\']https?://', template):
    raise ValueError('The offline application cannot load remote scripts or styles.')
target = ROOT / 'index.html'
target.write_text(template, encoding='utf-8')
print(str(target))
