#!/usr/bin/env python3
"""Credencial del rol vigia_catalogo (job vigía de producción). Lo ejecuta el responsable.

1. Genera una contraseña aleatoria (nunca se imprime).
2. Imprime la sentencia para el SQL Editor con el VERIFICADOR SCRAM-SHA-256 de esa contraseña,
   no la contraseña: el historial del SQL Editor nunca la ve.
3. Guarda la cadena de conexión en el secret PROD_CATALOGO_DB_URL del repo con `gh secret set`,
   pasándola por stdin (no queda en la línea de comandos ni en pantalla).

Uso:  python3 scripts/vigia-credencial.py
Requisitos: Python 3.9+, `gh` con la cuenta CognixLabs-Nido. Repetirlo rota la contraseña.
"""

import base64
import hashlib
import hmac
import os
import secrets
import subprocess
import sys

ROL = 'vigia_catalogo'
PROYECTO = 'ttroedkdgomfmohgojvg'
# Pooler de Supabase en modo sesión (IPv4: los runners de GitHub no tienen IPv6).
HOST = 'aws-1-eu-north-1.pooler.supabase.com'
PUERTO = 5432
REPO = 'CognixLabs-Nido/NIDO'
SECRET = 'PROD_CATALOGO_DB_URL'
ITERACIONES = 4096


def _hmac(clave: bytes, msg: bytes) -> bytes:
    return hmac.new(clave, msg, hashlib.sha256).digest()


def claves_scram(password: str, sal: bytes, iteraciones: int) -> tuple[bytes, bytes, bytes]:
    salted = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), sal, iteraciones)
    client_key = _hmac(salted, b'Client Key')
    stored_key = hashlib.sha256(client_key).digest()
    server_key = _hmac(salted, b'Server Key')
    return client_key, stored_key, server_key


def verificador(password: str, sal: bytes, iteraciones: int = ITERACIONES) -> str:
    """Formato de Postgres: SCRAM-SHA-256$<iter>:<sal>$<StoredKey>:<ServerKey> (base64)."""
    _, stored_key, server_key = claves_scram(password, sal, iteraciones)
    b64 = lambda b: base64.b64encode(b).decode('ascii')  # noqa: E731
    return f'SCRAM-SHA-256${iteraciones}:{b64(sal)}${b64(stored_key)}:{b64(server_key)}'


def autoprueba_rfc7677() -> None:
    """Vector de prueba de RFC 7677 §3: si el cálculo no lo reproduce, no se genera nada."""
    sal = base64.b64decode('W22ZaJ0SNY7soEsUEjb6gQ==')
    client_key, stored_key, server_key = claves_scram('pencil', sal, 4096)
    auth_message = (
        b'n=user,r=rOprNGfwEbeRWgbNEkqO,'
        b'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,'
        b'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0'
    )
    firma_cliente = _hmac(stored_key, auth_message)
    prueba = bytes(a ^ b for a, b in zip(client_key, firma_cliente))
    firma_servidor = _hmac(server_key, auth_message)
    assert base64.b64encode(prueba) == b'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'RFC 7677: ClientProof'
    assert base64.b64encode(firma_servidor) == b'6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=', 'RFC 7677: ServerSignature'


def main() -> int:
    autoprueba_rfc7677()

    # token_urlsafe: solo [A-Za-z0-9_-], va tal cual en la URL sin escapar.
    password = secrets.token_urlsafe(32)
    sal = os.urandom(16)
    url = f'postgresql://{ROL}.{PROYECTO}:{password}@{HOST}:{PUERTO}/postgres?sslmode=require'

    token = subprocess.run(
        ['gh', 'auth', 'token', '--user', 'CognixLabs-Nido'], capture_output=True, text=True, check=True
    ).stdout.strip()
    subprocess.run(
        ['gh', 'secret', 'set', SECRET, '-R', REPO],
        input=url, text=True, check=True, env={**os.environ, 'GH_TOKEN': token},
    )

    print(f'Secret {SECRET} guardado en {REPO} (la contraseña no se ha mostrado).')
    print('Ahora pega ESTO en el SQL Editor de producción (lleva el verificador, no la contraseña):')
    print()
    print(f"ALTER ROLE {ROL} WITH PASSWORD '{verificador(password, sal)}';")
    return 0


if __name__ == '__main__':
    sys.exit(main())
