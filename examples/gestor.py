#!/usr/bin/env python3
"""Gestor autónomo de ejemplo para SmartCity: lee la ciudad, decide y actúa en bucle.

Solo usa la biblioteca estándar. Ejecútalo con:

    SMARTCITY_URL=http://localhost:8080 SMARTCITY_TOKEN=... python3 examples/gestor.py

Es un punto de partida: las reglas son deliberadamente simples (umbrales fijos) para que las sustituyas por
tu propia IA. La referencia de la API está en docs/API.md.
"""
import json
import os
import time
import urllib.error
import urllib.request

URL = os.environ.get("SMARTCITY_URL", "http://localhost:8080").rstrip("/")
TOKEN = os.environ.get("SMARTCITY_TOKEN", "")
PERIOD = float(os.environ.get("PERIOD_SECONDS", "5"))  # segundos reales entre decisiones (≈ 4 min simulados)

# Punto vigilado: la zona de la Plaza Gipuzkoa. Cámbialo por el que quieras (también vale x/z en metros).
WATCH = {"lat": 43.3166, "lon": -1.9800, "radius": 200}
MIN_FLEET = 4


def call(method, path, body=None):
    """Llama a la API y devuelve el JSON; lanza RuntimeError con el mensaje del servidor si falla."""
    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"{method} {path} -> {err.code}: {err.read().decode()}") from None


def manage_buses(log):
    """Más autobuses donde van llenos; menos donde van casi vacíos (ocupación = pasajeros / plazas en servicio)."""
    for line in call("GET", "/api/buses")["lines"]:
        if line["suspended"] or not line["active"]:
            continue  # recorrido cortado o sin servicio: cambiar la flota no ayuda
        fleet = line["fleet"]
        occupancy = line["passengers"] / (line["active"] * line["capacity"])
        if occupancy > 0.75 and fleet < line["maxFleet"]:
            call("PATCH", f"/api/buses/{line['id']}", {"fleet": fleet + 1})
            log.append(f"{line['id']}: {fleet} -> {fleet + 1} autobuses (ocupación {occupancy:.0%})")
        elif occupancy < 0.3 and fleet > MIN_FLEET:
            call("PATCH", f"/api/buses/{line['id']}", {"fleet": fleet - 1})
            log.append(f"{line['id']}: {fleet} -> {fleet - 1} autobuses (ocupación {occupancy:.0%})")


def manage_zone(log, zone):
    """Si el punto vigilado se atasca, cierra el acceso a coches nuevos; si se despeja, lo reabre."""
    query = "&".join(f"{k}={v}" for k, v in WATCH.items())
    point = call("GET", f"/api/point?{query}")
    cars = point["cars"]
    jammed = cars["count"] >= 25 and cars["stopped"] / cars["count"] > 0.4
    if jammed and zone is None:
        created = call("POST", "/api/restrictions", {**WATCH, "mode": "entry_limit", "limit": 10, "name": "Gestor"})
        zone = created["id"]
        log.append(f"{zone}: zona con límite de 10 coches ({cars['count']} coches, {cars['stopped']} parados)")
    elif zone is not None and cars["count"] < 10:
        call("DELETE", f"/api/restrictions/{zone}")
        log.append(f"{zone}: zona reabierta ({cars['count']} coches)")
        zone = None
    return zone


def main():
    zone = None
    while True:
        state = call("GET", "/api/state")
        log = []
        manage_buses(log)
        zone = manage_zone(log, zone)
        print(f"[{state['simTime']}] {state['cars']} coches, {state['traffic']['avgKmh']} km/h de media")
        for line in log:
            print("   ", line)
        time.sleep(PERIOD)


if __name__ == "__main__":
    main()
