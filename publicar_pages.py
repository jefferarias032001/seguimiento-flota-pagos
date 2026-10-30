# -*- coding: utf-8 -*-
"""
Publica el dashboard en GitHub Pages CIFRADO con contrasena.

Uso:  python -I publicar_pages.py        (pide la contrasena en la terminal; no se guarda en ningun archivo)
Genera docs\\index.html: una pagina que pide correo y contrasena y descifra el dashboard en el navegador.
El DASHBOARD.html original nunca se sube; solo se sube docs\\index.html (cifrado AES-256-GCM, clave derivada con PBKDF2-SHA256 600.000 vueltas).
"""
import base64
import getpass
import gzip
import os
import sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

AQUI = os.path.dirname(os.path.abspath(__file__))
ORIGEN = os.path.join(AQUI, "DASHBOARD.html")
DESTINO = os.path.join(AQUI, "docs", "index.html")
VUELTAS = 600_000
MIN_CLAVE = 10

PAGINA = r"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Tractocar · Acceso</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#060a14;color:#e8edf7;font:15px/1.5 system-ui,Segoe UI,sans-serif}
.card{width:min(92vw,380px);padding:28px;border:1px solid #1d2a44;border-radius:16px;background:#0d1424}
h1{margin:0 0 4px;font-size:20px}p{margin:0 0 18px;color:#8fa0c0;font-size:13px}
label{display:block;margin:12px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8fa0c0}
input{width:100%;padding:11px 12px;border:1px solid #2a3b5e;border-radius:10px;background:#0a1020;color:#e8edf7;font-size:15px}
button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;background:#2f6fe4;color:#fff;font-weight:600;font-size:15px;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}#m{min-height:20px;margin-top:12px;font-size:13px;color:#ff8a8a}
</style></head><body>
<form class="card" id="f"><h1>Seguimiento de flota y pagos</h1><p>Acceso restringido. Escribe tu correo y la contraseña.</p>
<label for="c">Correo</label><input id="c" type="email" autocomplete="username" required placeholder="nombre@tractocar.com">
<label for="p">Contraseña</label><input id="p" type="password" autocomplete="current-password" required>
<button id="b" type="submit">Entrar</button><div id="m"></div></form>
<script>
const DATA="__DATOS__", VUELTAS=__VUELTAS__;
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
document.getElementById('f').addEventListener('submit',async e=>{
  e.preventDefault(); const m=document.getElementById('m'), btn=document.getElementById('b'); m.textContent='';
  const correo=document.getElementById('c').value.trim().toLowerCase();
  if(!/@tractocar\.com$/.test(correo)){ m.textContent='Usa tu correo de Tractocar.'; return; }
  btn.disabled=true; btn.textContent='Abriendo…';
  try{
    const raw=b64(DATA), salt=raw.slice(0,16), iv=raw.slice(16,28), ct=raw.slice(28);
    const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(document.getElementById('p').value),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:VUELTAS,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
    const gz=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);
    const html=await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    document.open(); document.write(html); document.close();
  }catch(err){ m.textContent='Contraseña incorrecta.'; btn.disabled=false; btn.textContent='Entrar'; }
});
</script></body></html>
"""


def main():
    if not os.path.exists(ORIGEN):
        sys.exit("No existe DASHBOARD.html: ejecuta primero ACTUALIZAR.bat")
    clave = getpass.getpass("Contrasena para el dashboard publico (minimo %d caracteres): " % MIN_CLAVE)
    if len(clave) < MIN_CLAVE:
        sys.exit("Muy corta: el archivo cifrado queda publico y una clave corta se puede adivinar. Usa una frase larga.")
    if clave != getpass.getpass("Repitela: "):
        sys.exit("No coinciden.")
    with open(ORIGEN, "rb") as f:
        datos = gzip.compress(f.read(), 9)
    salt, iv = os.urandom(16), os.urandom(12)
    k = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=VUELTAS).derive(clave.encode("utf-8"))
    blob = salt + iv + AESGCM(k).encrypt(iv, datos, None)
    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    with open(DESTINO, "w", encoding="utf-8") as f:
        f.write(PAGINA.replace("__DATOS__", base64.b64encode(blob).decode()).replace("__VUELTAS__", str(VUELTAS)))
    print("Listo: %s (%.1f MB). Sube solo la carpeta docs." % (DESTINO, os.path.getsize(DESTINO) / 1e6))


if __name__ == "__main__":
    main()
