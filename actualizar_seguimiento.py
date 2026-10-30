# -*- coding: utf-8 -*-
"""
Seguimiento de flota y pagos NACIONAL
-------------------------------------
Cruza viajes (NACIONAL), pagos (Analisis de pago - MV) y cartera por pagar (INFORME DE CXP-AFILIADOS)
y genera un Excel con prioridad de pago por afiliado / placa, pagado sin rotacion, proveedores y alertas.

Uso:   python actualizar_seguimiento.py            (mes y fecha de corte = hoy)
       python actualizar_seguimiento.py 2026-09    (otro mes)
"""
import glob
import importlib.util
import json
import os
import re
import shutil
import sys
import unicodedata
import warnings
from datetime import datetime

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

warnings.filterwarnings("ignore")

# ----------------------------------------------------------------------------- CONFIG
DIR_BI = r"C:\Users\jarias\OneDrive - TRACTOCAR LOGISTICS SAS\POWER BI JEFFER"
# Viajes: ARCHIVOS\{NACIONAL,CEDIS,EXPO,IMPU} = meses cerrados; ACHIVOS 2\{cedis2,expo2,impu2} = mes en curso (el de NACIONAL esta en su carpeta)
DIR_NACIONAL = os.path.join(DIR_BI, "ARCHIVOS", "NACIONAL")
ARCHIVO_ACTUAL = "data-report-financials-nacional.xlsx"      # mes en curso
DIR_FA = (r"C:\Users\jarias\OneDrive - TRACTOCAR LOGISTICS SAS (1)\Sincronía\Sincronía_Indicadores"
          r"\Sincronia Operaciones\14. Afiliados\FA")
ARCHIVO_PAGOS = os.path.join(DIR_FA, "Análisis de pago - MV.xlsx")
# Fuentes ORIGEN (a las que se conectan los queries de los informes CXP y Resumen de pago):
ARCHIVO_CXP = os.path.join(os.path.dirname(DIR_FA), "1.Retenciones y liberaciones de facturas.xlsx")   # facturas impagadas (hoja Sheet1)
DIR_OPERACION = (r"C:\Users\jarias\OneDrive - TRACTOCAR LOGISTICS SAS\Archivos de Data Quality Analyst Tractocar - "
                 r"Analisis Operacion y Venta\Automatizaciones\Operacion general")   # un Excel por mes: cumplido por envio

AQUI = os.path.dirname(os.path.abspath(__file__))
DIR_SALIDAS = os.path.join(AQUI, "salidas")
DIR_CACHE = os.path.join(AQUI, "cache")


def leer_rutas():
    """rutas.txt (opcional): una linea 'CLAVE = ruta'. PRIORIDADES = Excel compartido de los analistas;
    PUBLICAR_DASHBOARD_EN = carpeta compartida donde se copia DASHBOARD.html al terminar (para que otros lo abran)."""
    p = os.path.join(AQUI, "rutas.txt")
    if not os.path.exists(p):
        with open(p, "w", encoding="utf-8") as f:
            f.write("# Rutas opcionales: una por linea, CLAVE = ruta. Si se deja vacio se usa lo predeterminado.\n"
                    "# PRIORIDADES: Excel donde los analistas digitan la prioridad de pago (si no existe, se crea con los afiliados por cliente).\n"
                    "#   Recomendado: moverlo a una carpeta compartida de OneDrive y poner aqui su ruta completa.\n"
                    "# PUBLICAR_DASHBOARD_EN: carpeta compartida donde se copia DASHBOARD.html despues de cada actualizacion (para Carlos y los analistas).\n"
                    "PRIORIDADES =\n"
                    "PUBLICAR_DASHBOARD_EN =\n")
    r = {}
    with open(p, encoding="utf-8") as f:
        for ln in f.read().splitlines():
            ln = ln.strip()
            if ln and not ln.startswith("#") and "=" in ln:
                k, v = ln.split("=", 1)
                r[k.strip().upper()] = v.strip().strip('"')
    return r


RUTAS = leer_rutas()
ARCHIVO_PRIORIDADES = RUTAS.get("PRIORIDADES") or os.path.join(AQUI, "Prioridades de pago.xlsx")
PUBLICAR_EN = RUTAS.get("PUBLICAR_DASHBOARD_EN", "")


def _cargar_modulo(nombre):
    """Modulo del proyecto (python -I no agrega la carpeta del script al path)."""
    sys.dont_write_bytecode = True                  # sin carpeta __pycache__
    spec = importlib.util.spec_from_file_location(nombre, os.path.join(AQUI, nombre + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


PRI = _cargar_modulo("prioridades_analistas")

VENTANA_DIAS = 180           # viajes que se revisan para "por liquidar" / en curso
FACTOR_PAGO = 0.96           # lo que realmente se gira vs. "Envio compra (Total)" (retenciones); medido en viajes cerrados
UMBRAL_CERRADO = 0.90        # pagado/compra >= 90% => viaje pagado completo
DIAS_ACTIVO = 12             # un viaje "en ruta / por iniciar" solo cuenta como activo si es de los ultimos N dias
DIAS_SIN_ROTAR = 10          # pagado en el mes que no vuelve a cargar en N dias => "pagado sin rotacion"
NIT_PROPIO = "900503325"     # flota propia (TRACTOCAR LOGISTICS SAS): no genera pago a afiliado

COLS_VIAJES = ["Envio", "Placa", "Ciudad Origen", "Ciudad Destino", "Fecha Creacion", "Estado En Ruta",
               "Doc Afiliado", "Afiliado", "Cliente", "Envio compra (Total)", "Envio venta (Total)", "Utilidad"]


# ----------------------------------------------------------------------------- UTILIDADES
def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", s).strip()


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def leer_viajes(path):
    x = pd.read_excel(path, usecols=lambda c: c in COLS_VIAJES)
    x["eid"] = x["Envio"].astype(str).str.replace("TCL.", "", regex=False)
    return x


def _num(s):
    """Importes que vienen como numero o como texto '400,000.00'."""
    return pd.to_numeric(s.astype(str).str.replace(",", "", regex=False), errors="coerce")


def leer_viaje_archivo(path, oper):
    """Unifica los 3 formatos de archivos de viajes al esquema de NACIONAL (una fila por linea/orden):
    - NACIONAL y CEDIS del mes en curso: 'data-report-financials' (41 columnas, 'Envio compra (Total)').
    - CEDIS mensual: 34 columnas ('Manifiesto', 'Costo Total (Man)').
    - EXPO / IMPO: una fila por envio de compra ('A Pagar($)', 'A Facturar($)'); la venta se repite entre
      los envios que comparten 'Envio(Venta)', por eso se reparte para no duplicarla."""
    raw = pd.read_excel(path, header=None, nrows=4)
    h = 0
    for i in range(4):
        if {norm(v) for v in raw.iloc[i].tolist()} & {"MANIFIESTO", "ENVIO", "ORDEN BASE"}:
            h = i
            break
    x = pd.read_excel(path, header=h)
    c = {norm(k): k for k in x.columns}
    out = pd.DataFrame(index=x.index)
    if "ENVIO COMPRA (TOTAL)" in c:
        for dst, src in [("Envio", "ENVIO"), ("Placa", "PLACA"), ("Ciudad Origen", "CIUDAD ORIGEN"), ("Ciudad Destino", "CIUDAD DESTINO"),
                         ("Fecha Creacion", "FECHA CREACION"), ("Estado En Ruta", "ESTADO EN RUTA"), ("Doc Afiliado", "DOC AFILIADO"),
                         ("Afiliado", "AFILIADO"), ("Cliente", "CLIENTE"), ("Envio compra (Total)", "ENVIO COMPRA (TOTAL)"),
                         ("Envio venta (Total)", "ENVIO VENTA (TOTAL)"), ("Utilidad", "UTILIDAD")]:
            out[dst] = x[c[src]]
        for dst, src in [("Cod Cliente", "COD CLIENTE"), ("Tipologia", "TIPOLOGIA"), ("Cuenta Contable", "CUENTA CONTABLE")]:
            out[dst] = x[c[src]] if src in c else np.nan
    elif "COSTO TOTAL (MAN)" in c:
        for dst, src in [("Envio", "MANIFIESTO"), ("Placa", "PLACA (VEH)"), ("Ciudad Origen", "ORIGEN (MAN)"), ("Ciudad Destino", "DESTINO (MAN)"),
                         ("Fecha Creacion", "CREACION (MAN)"), ("Estado En Ruta", "ESTADO (MAN)"), ("Doc Afiliado", "DOC AFILIADO"),
                         ("Afiliado", "NOM AFILIADO"), ("Cliente", "NOMBRE (CLIENTE)"), ("Envio compra (Total)", "COSTO TOTAL (MAN)"),
                         ("Envio venta (Total)", "COSTO TOTAL (VENTA)"), ("Utilidad", "UTILIDAD")]:
            out[dst] = x[c[src]]
    elif "A PAGAR($)" in c:
        k_compra = next(k for n, k in c.items() if n.startswith("ENVIO(COMPRA"))
        k_venta = next(k for n, k in c.items() if n.startswith("ENVIO(VENTA"))
        pagar, facturar = _num(x[c["A PAGAR($)"]]), _num(x[c["A FACTURAR($)"]])
        comparten = x.groupby(k_venta)[k_compra].transform("nunique").replace(0, 1).fillna(1)   # sin llave de venta = no se reparte
        out["Envio"], out["Placa"] = x[k_compra], x[c["PLACA"]]
        out["Ciudad Origen"], out["Ciudad Destino"] = x[c["CIUDAD ORIGEN"]], x[c["CIUDAD DESTINO"]]
        out["Fecha Creacion"], out["Estado En Ruta"] = x[c["FECHA CREACION"]], np.nan     # el estado se toma de 'Operacion general'
        out["Doc Afiliado"], out["Afiliado"], out["Cliente"] = x[c["PROVEEDOR"]], x[c["PROVEEDOR NOMBRE"]], x[c["CLIENTE NOMBRE"]]
        out["Envio compra (Total)"] = pagar
        out["Envio venta (Total)"] = facturar / comparten
        out["Utilidad"] = out["Envio venta (Total)"] - pagar
    else:
        raise ValueError(f"Formato de archivo de viajes no reconocido: {path}")
    out["Envio"] = out["Envio"].astype(str)
    out = out[out["Envio"].str.contains(r"\d", na=False) & ~out["Envio"].isin(["nan", "None"])]
    out["eid"] = out["Envio"].str.replace("TCL.", "", regex=False)
    out["oper"] = oper
    out["Fecha Creacion"] = pd.to_datetime(out["Fecha Creacion"], errors="coerce")
    return out


TIPO_COD = {"PATINETA": "PT", "TRACTOMULA": "TM", "SENCILLO": "SC", "TURBO": "TB"}


def segmento_cliente(v):
    """Operacion de AJOVER (AJOV) y NOUVELLE (NOCO) segun ruta y tipologia (misma regla del query ESTADO AJOVER).
    Agencia CALI = cuenta contable que empieza por CAL. Cualquier otro cliente => OTROS."""
    o, d = v["Ciudad Origen"].map(norm), v["Ciudad Destino"].map(norm)
    tip = v["Tipologia"].map(norm).map(TIPO_COD).fillna("")
    ruta = o + "-" + d + "-" + tip
    cod = v["Cod Cliente"].astype(str).str.strip()
    cali = v["Cuenta Contable"].astype(str).str.upper().str.startswith("CAL")
    aj = np.select([ruta.isin(["CARTAGENA-MADRID-PT", "MADRID-CARTAGENA-PT", "CARTAGENA-MADRID-SC"]),
                    ruta.isin(["CARTAGENA-MADRID-TM", "CARTAGENA-BOGOTA-TM"]),
                    ruta.isin(["CARTAGENA-YUMBO-PT", "CARTAGENA-YUMBO-SC"]),
                    ruta == "MADRID-CARTAGENA-SC", ruta == "MADRID-SANTIAGO DE CALI-PT", ruta == "MADRID-BOGOTA-PT",
                    ruta == "MADRID-BOGOTA-TB", cali, o == "LA ESTRELLA"],
                   ["TRANSFERENCIAS", "GRANELES", "TRANSFERENCIA CALI", "SENCILLOS MADRID", "ZORROS CALI", "TRANSFERENCIA ALAMO",
                    "ENTREGA A CLIENTES", "FIJOS CALI", "FIJOS MEDELLIN"], "ENTREGA A CLIENTES")
    no = np.select([ruta.isin(["CARTAGENA-MADRID-PT", "MADRID-CARTAGENA-PT"]), ruta == "CARTAGENA-MADRID-TM"], ["TRANSFERENCIAS", "GRANELES"], "OTROS")
    return np.where(cod == "AJOV", aj, np.where(cod == "NOCO", no, "OTROS")), cod


def archivos_viajes():
    """(operacion, archivo): historico 2026 de cada operacion + el archivo del mes en curso."""
    r = []
    for oper, hist, pat, actual in [
        ("NACIONAL", DIR_NACIONAL, "NACIONAL*.xlsx", [os.path.join(DIR_NACIONAL, ARCHIVO_ACTUAL)]),
        ("CEDIS", os.path.join(DIR_BI, "ARCHIVOS", "CEDIS"), "CEDIS*.xlsx", glob.glob(os.path.join(DIR_BI, "ACHIVOS 2", "cedis2", "*.xlsx"))),
        ("EXPO", os.path.join(DIR_BI, "ARCHIVOS", "EXPO"), "EXPO*.xlsx", glob.glob(os.path.join(DIR_BI, "ACHIVOS 2", "expo2", "*.xlsx"))),
        ("IMPO", os.path.join(DIR_BI, "ARCHIVOS", "IMPU"), "IMPO*.xlsx", glob.glob(os.path.join(DIR_BI, "ACHIVOS 2", "impu2", "*.xlsx")))]:
        r += [(oper, f) for f in sorted(glob.glob(os.path.join(hist, pat))) if "2026" in os.path.basename(f)]
        r += [(oper, f) for f in actual if not os.path.basename(f).startswith("~$")]
    return r


# ----------------------------------------------------------------------------- CARGA
def cargar_viajes():
    os.makedirs(DIR_CACHE, exist_ok=True)
    cache = os.path.join(DIR_CACHE, "mapa_envios_historico.pkl")
    if os.path.exists(cache):
        mapa_hist = pd.read_pickle(cache)
    else:
        hist = [f for f in glob.glob(os.path.join(DIR_NACIONAL, "NACIONAL*.xlsx")) if "2025" in os.path.basename(f)]
        log(f"Construyendo cache historico 2025 ({len(hist)} archivos, solo la primera vez)...")
        mapa_hist = pd.concat([leer_viajes(f)[["eid", "Placa", "Afiliado"]] for f in hist]).drop_duplicates("eid")
        mapa_hist.to_pickle(cache)
    # un cache por archivo (se vuelve a leer solo si el archivo cambio)
    cache_v = os.path.join(DIR_CACHE, "viajes_por_archivo.pkl")
    prev = pd.read_pickle(cache_v) if os.path.exists(cache_v) else {}
    nuevo, partes = {}, []
    log("Leyendo viajes de NACIONAL, CEDIS, EXPO e IMPO...")
    for oper, f in archivos_viajes():
        clave, mt = f, os.path.getmtime(f)
        if clave in prev and prev[clave]["mtime"] == mt:
            df = prev[clave]["df"]
        else:
            log(f"  leyendo {oper}: {os.path.basename(f)}")
            df = leer_viaje_archivo(f, oper)
        nuevo[clave] = {"mtime": mt, "df": df}
        partes.append(df)
    pd.to_pickle(nuevo, cache_v)
    v = pd.concat(partes, ignore_index=True)       # NO se eliminan filas: cada linea = remision/entrega
    return v, mapa_hist


def cargar_pagos():
    p = pd.read_excel(ARCHIVO_PAGOS, dtype={"Número de factura": str})
    p = p.rename(columns={"Número de factura": "factura", "Fecha de pago": "fecha_pago", "Importe de pago": "importe",
                          "Estado de pago": "estado_pago", "Proveedor": "proveedor",
                          "Documento de pago": "doc_pago", "Pago creado por usuario": "usuario"})
    p["factura"] = p["factura"].astype(str).str.strip()
    p["fecha_pago"] = pd.to_datetime(p["fecha_pago"], errors="coerce")
    p["prov_n"] = p["proveedor"].map(norm)
    return p


def cargar_cxp():
    """Facturas impagadas (cartera por pagar). Una fila por factura abierta."""
    # Mismo tratamiento que el query del informe CXP: 3 filas de titulo, encabezado en la fila 5, TIPO por reglas, sin facturas repetidas.
    hdr = pd.read_excel(ARCHIVO_CXP, sheet_name="Sheet1", header=None, nrows=3)
    m = re.search(r"(\d{1,2}/\d{1,2}/\d{4})", " ".join(hdr.astype(str).values.ravel()))
    corte = pd.to_datetime(m.group(1), dayfirst=True) if m else pd.Timestamp(os.path.getmtime(ARCHIVO_CXP), unit="s").normalize()
    x = pd.read_excel(ARCHIVO_CXP, sheet_name="Sheet1", header=4, dtype={"Número de factura": str})
    claves = {"NUMERO DE FACTURA": "fac", "PROVEEDOR": "proveedor", "NOMBRE DE ESTADO DE PAGO": "estado",
              "IMPORTE IMPAGADO": "imp", "FECHA DE VENCIMIENTO": "vence", "FECHA DE RETENCION": "f_ret",
              "MOTIVO DE RETENCION": "mot_ret", "FECHA DE LIBERACION DE RETENCION": "f_lib", "FECHA DE FACTURA": "f_fac"}
    x = x.rename(columns={c: claves[norm(c)] for c in x.columns if norm(c) in claves})
    x = x[list(claves.values())].copy()
    x = x[x["fac"].notna()]
    x["fac"] = x["fac"].astype(str).str.strip()
    x = x.drop_duplicates("fac")
    x["imp"] = pd.to_numeric(x["imp"], errors="coerce").fillna(0)
    x["prov_n"] = x["proveedor"].map(norm)
    especiales = {"DRAKMA SAS": "FINANCIERA", "EMPACOR S A": "CLIENTE", "AJOVER DARNEL SAS": "CLIENTE",
                  "TRACTOCAR LOGISTICS SAS": "PROPIO", "TRANSATALITE SERVICIO ESPECIAL SAS": "CLIENTE DRAKMA",
                  "RENDON RAMIREZ HEYNE DE JESUS": "CLIENTE DRAKMA", "LASSO ZAMBRANO ERNESTO RAUL": "CLIENTE DRAKMA",
                  "SALINAS CARPETA OSCAR JULIO": "CLIENTE DRAKMA", "DIRECCION DE IMPUESTO Y ADUANAS NACIONALES - DIAN": "IMPUESTOS"}
    x["tipo"] = np.where(x["fac"].str.match(r"^M[12]"), "AFILIADOS", x["prov_n"].map(especiales).fillna("PROVEEDORES"))
    for c in ["vence", "f_fac"]:
        x[c] = pd.to_datetime(x[c], errors="coerce")
    x["dias_venc"] = (corte - x["vence"]).dt.days.clip(lower=0)
    x["ret_activa"] = x["f_ret"].notna() & x["f_lib"].isna()      # retenida hoy (aun no liberada)
    x["eid"] = x["fac"].str.extract(r"^M(\d{6,7})$")[0]
    return x, corte


def cargar_operacion():
    """Operacion general: un envio por fila con operacion (NACIONAL/EXPO/CEDIS/IMPO), cumplido y fecha de cumplido.
    La hoja pesa ~200 MB de XML: se guarda una copia reducida en cache y solo se relee si el archivo cambio."""
    os.makedirs(DIR_CACHE, exist_ok=True)
    cache = os.path.join(DIR_CACHE, "operacion_general_por_archivo.pkl")
    prev = pd.read_pickle(cache) if os.path.exists(cache) else {}
    nuevo, partes = {}, []
    for f in sorted(glob.glob(os.path.join(DIR_OPERACION, "*.xlsx"))):          # mismo orden que Folder.Files
        nom, mt = os.path.basename(f), os.path.getmtime(f)
        if nom in prev and prev[nom]["mtime"] == mt:
            df = prev[nom]["df"]
        else:
            log(f"  leyendo {nom}")
            raw = pd.read_excel(f, sheet_name="Sheet1", header=None)
            raw = raw[raw[0].notna() & raw[1].notna()].iloc[1:]      # igual que el query: filas con col1 y col2, la primera es el encabezado
            df = raw.iloc[:, [0, 2, 3, 4, 6, 8, 9, 11, 12, 14]].copy()
            df.columns = ["eid", "fcrea", "cli", "oper", "placa", "nombre", "enruta", "cumplido", "fcump", "voucher"]
            df["eid"] = df["eid"].astype(str).str.replace(r"\.0$", "", regex=True).str.replace(" ", "", regex=False)
            df["fcrea"] = pd.to_datetime(df["fcrea"], errors="coerce")
            df["fcump"] = pd.to_datetime(df["fcump"], errors="coerce")
            df["cumplido"] = (df["cumplido"].astype(str).str.replace("MANIFIESTO_CUMPLIDO_", "", regex=False)
                              .str.replace("MANIFIESTO_CUMPL_", "", regex=False))
            df = df[df["fcrea"].notna()]       # historial completo (desde 2023): sirve para ligar facturas viejas a placa y cliente
        nuevo[nom] = {"mtime": mt, "df": df}
        partes.append(df)
    pd.to_pickle(nuevo, cache)
    return pd.concat(partes, ignore_index=True).drop_duplicates("eid", keep="first")


# ----------------------------------------------------------------------------- CLASIFICACION DE PAGOS
CATEGORIAS = [
    (["DIAN", "IMPUESTO", "ALCALDIA", "EPA ", "SECRETARIA", "TRANSITO"], "Impuestos / entes publicos"),
    (["ASOPAGOS", "CAJA DE COMPENSACION", "COLSANITAS", "COOPERATIVA", "FONDO DE PENSION", "ARL"], "Nomina / seguridad social"),
    (["BANCO", "BANCOLOMBIA", "DAVIVIENDA", "BBVA", "FIDUCIARIA", "CREDISEGURO", "SEGUROS", "LEASING"], "Financiero / seguros"),
    (["ESTACION DE SERVICIO", "COMBUSTIBLE", "TERPEL", "PRIMAX", "PETROL"], "Combustible"),
    (["FINTRA", "DRAKMA", "FACTORING"], "Factoring"),
    (["INMOBILIARIO", "ARRIENDO", "FONDO DE CAPITAL"], "Arriendos"),
    (["COMCEL", "CLARO", "ACUACAR", "AGUAS", "ENERGIA", "CELSIA", "VANTI", "INTELLIGENCE", "ITIS", "SOFTWARE"], "Servicios / tecnologia"),
    (["CUANTIAS MENORES"], "Cuantias menores"),
]


def categoria_proveedor(prov_n, doc_pago):
    d = str(doc_pago).upper()
    if "FINTRA" in d or "FACTORING" in d:
        return "Factoring"
    for claves, cat in CATEGORIAS:
        if any(c in prov_n for c in claves):
            return cat
    return "Otros proveedores"


def clasificar_pagos(p, afiliados_n, tipo_cxp):
    f = p["factura"]
    p["envio_id"] = f.str.extract(r"^(?:ANT_|PP_M|M)(\d{6,7})")[0]
    cond = [
        f.str.match(r"^ANT_\d+-\d+"),
        f.str.match(r"^PP_M\d+"),
        f.str.match(r"^M\d{6,7}$"),
        f.str.match(r"^ANT[\s_\d]"),
        (p["doc_pago"] == "CARGUE_PAGO") | (p["importe"] < 0),
        p["prov_n"].isin(afiliados_n),
    ]
    tipos = ["ANTICIPO FLOTA", "DESCUENTO PRONTO PAGO", "SALDO FLOTA", "ANTICIPO PROVEEDOR/OTRO",
             "CRUCE / DESCUENTO", "FACTURA AFILIADO (FE/otro)"]
    p["tipo"] = np.select(cond, tipos, "PROVEEDOR / GASTO")
    p["es_flota"] = p["tipo"].isin(["ANTICIPO FLOTA", "DESCUENTO PRONTO PAGO", "SALDO FLOTA"])
    p["tipo_cxp"] = p["prov_n"].map(tipo_cxp)                      # clasificacion oficial del query de CXP
    p["categoria"] = np.where(p["es_flota"], "Flota (afiliados)",
                              [categoria_proveedor(a, b) for a, b in zip(p["prov_n"], p["doc_pago"])])
    p.loc[p["tipo"] == "FACTURA AFILIADO (FE/otro)", "categoria"] = "Afiliado facturando (FE)"
    return p


# ----------------------------------------------------------------------------- PRIORIDAD
NOMBRES_PRIO = {1: "1-PAGAR YA", 2: "2-ESTA SEMANA", 3: "3-PROGRAMAR", 4: "4-NO PRIORIZAR",
                5: "5-EN CURSO / POR LIQUIDAR", 6: "6-AL DIA", 7: "7-PAGADO SIN ROTAR"}


def prioridad(exigible, futuro, dias_sin_viaje, rota):
    if exigible > 1000:
        if rota or dias_sin_viaje <= 7:
            return 1
        if dias_sin_viaje <= 15:
            return 2
        if dias_sin_viaje <= 30:
            return 3
        return 4
    return 5 if futuro > 1000 else 6


def texto_accion(pr, r):
    d = int(r["dias_sin_viaje"]) if r["dias_sin_viaje"] < 9999 else None
    sin_v = f"{d} d sin viaje" if d is not None else "sin viajes recientes"
    if r["pagado_sin_rotar"] and pr in (3, 4, 5, 6):
        return (f"PAGADO SIN ROTACION: pagaste ${r['pagado_mes']:,.0f} en el mes y {sin_v}. "
                f"No pagar mas hasta que vuelva a cargar. Saldo abierto libre ${r['exigible']:,.0f}.")
    if pr == 1:
        act = f", {int(r['activos'])} viaje(s) activo(s)" if r["activos"] else ""
        return (f"PAGAR YA: {'rota' if r['rota'] else 'cargó hace poco'} ({int(r['v15'])} viaje(s) en 15d, {sin_v}{act}). "
                f"Saldo libre ${r['exigible']:,.0f} (vencido >90d ${r['venc90']:,.0f}).")
    if pr == 2:
        return f"Pagar esta semana: {sin_v}. Saldo libre ${r['exigible']:,.0f}."
    if pr == 3:
        return f"Programar: baja rotacion ({sin_v}). Saldo libre ${r['exigible']:,.0f}."
    if pr == 4:
        return f"No rota ({sin_v}). Saldo libre ${r['exigible']:,.0f}: pagar solo por plazo, sin prioridad."
    if pr == 5:
        return f"Sin saldo exigible. Futuro: en curso / por liquidar ${r['futuro']:,.0f}."
    return "Sin saldo abierto en CXP."


# ----------------------------------------------------------------------------- ANALISIS
def main():
    t0 = datetime.now()
    hoy = pd.Timestamp.today().normalize()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    con_excel = "--excel" in sys.argv
    mes_ini = pd.Timestamp(args[0] + "-01") if args else hoy.replace(day=1)
    mes_fin = mes_ini + pd.offsets.MonthBegin(1)
    log(f"Mes de analisis {mes_ini:%Y-%m} | corte {hoy:%Y-%m-%d}")

    v, mapa_hist = cargar_viajes()
    log("Leyendo pagos, cartera por pagar (Retenciones y liberaciones) y operacion...")
    p = cargar_pagos()
    cxp_all, corte_cxp = cargar_cxp()
    og = cargar_operacion()
    tipo_cxp = cxp_all.groupby("prov_n")["tipo"].agg(lambda s: s.mode().iloc[0])

    afiliados_n = set(v["Afiliado"].map(norm)) | set(mapa_hist["Afiliado"].map(norm))
    p = clasificar_pagos(p, afiliados_n, tipo_cxp)
    pv = p[p["estado_pago"] != "Anulado"].copy()
    # el archivo de pagos puede traer solo los ultimos meses: antes de esa fecha no se puede saber que se pago
    pagos_desde = pv["fecha_pago"].min().replace(day=1)

    # ---- viajes a nivel de manifiesto/envio (suma de lineas)
    v["es_propia"] = v["Doc Afiliado"].astype(str).str.startswith(NIT_PROPIO)
    e = v.groupby("eid").agg(
        placa=("Placa", "first"), afiliado=("Afiliado", "first"), propia=("es_propia", "max"),
        origen=("Ciudad Origen", "first"), destino=("Ciudad Destino", "first"), cliente=("Cliente", "first"),
        fecha=("Fecha Creacion", "min"), estado=("Estado En Ruta", "first"), lineas=("Envio", "size"),
        compra=("Envio compra (Total)", "sum"), venta=("Envio venta (Total)", "sum"), utilidad=("Utilidad", "sum"),
        oper=("oper", "first"),
    ).reset_index()
    e["placa"] = e["placa"].astype(str).str.replace("TCL.", "", regex=False)
    e["afn"] = e["afiliado"].map(norm)
    # cliente por linea: un viaje puede llevar ordenes de varios clientes. La venta es por linea; la compra es del viaje y se
    # reparte entre sus clientes segun la venta de cada uno (partes iguales si el viaje no tiene venta).
    v["cli_n"] = v["Cliente"].astype(str).str.strip().replace({"DITAR": "DITAR SAS", "nan": "(sin cliente)", "": "(sin cliente)"})
    lin = v.groupby(["eid", "cli_n"]).agg(venta_c=("Envio venta (Total)", "sum")).reset_index()
    lin["vpos"] = lin["venta_c"].clip(lower=0)
    tt = lin.groupby("eid").agg(vt=("vpos", "sum"), n=("cli_n", "size"))
    lin = lin.merge(tt, on="eid")
    lin["share"] = np.where(lin["vt"] > 0, lin["vpos"] / lin["vt"].where(lin["vt"] > 0, 1), 1 / lin["n"])
    ppal = lin.sort_values(["eid", "vpos"], ascending=[True, False]).drop_duplicates("eid").set_index("eid")["cli_n"]
    e["cliente"] = e["eid"].map(ppal).fillna(e["cliente"])                  # cliente principal del viaje (el de mayor venta)
    e["multi_cliente"] = e["eid"].map(tt["n"]).fillna(1) > 1
    if "Cod Cliente" in v:
        v["seg_l"], v["cod_l"] = segmento_cliente(v)
        pr = v.assign(vv=v["Envio venta (Total)"].fillna(0)).sort_values(["eid", "vv"], ascending=[True, False], kind="stable").drop_duplicates("eid").set_index("eid")
        e["seg"] = e["eid"].map(pr["seg_l"]).fillna("OTROS")                  # operacion de AJOVER / NOUVELLE (segun el cliente principal del viaje)
        e["cod"] = e["eid"].map(pr["cod_l"]).fillna("")
        e["tip"] = e["eid"].map(pr["Tipologia"].astype(str).str.strip().str.upper()).fillna("")
    e = e.merge(og[["eid", "cumplido", "fcump", "enruta"]], on="eid", how="left")
    e["cumplido"] = e["cumplido"].fillna("(sin dato)")
    # estado del viaje: del archivo de viajes; EXPO/IMPO no lo traen y se toma de 'Operacion general'
    sin_estado = e["estado"].isna() | (e["estado"].astype(str) == "nan")
    e["estado"] = e["estado"].where(~sin_estado, e["enruta"])
    e["estado"] = (e["estado"].astype(str).str.replace("TCL.ENROUTE_", "", regex=False).str.replace("ENROUTE_", "", regex=False)
                   .replace({"COMPLETED": "COMPLETADO", "ENROUTE": "EN RUTA", "NOT STARTED": "POR INICIAR", "nan": "SIN DATO"}))

    # ---- pagos por envio
    flota = pv[pv["es_flota"] & pv["envio_id"].notna()]
    por_envio = flota.pivot_table(index="envio_id", columns="tipo", values="importe", aggfunc="sum", fill_value=0)
    por_envio = por_envio.rename(columns={"ANTICIPO FLOTA": "ant", "SALDO FLOTA": "saldo", "DESCUENTO PRONTO PAGO": "pp"})
    for c in ["ant", "saldo", "pp"]:
        if c not in por_envio:
            por_envio[c] = 0.0
    e = e.merge(por_envio[["ant", "saldo", "pp"]], left_on="eid", right_index=True, how="left")
    e[["ant", "saldo", "pp"]] = e[["ant", "saldo", "pp"]].fillna(0)
    e["pagado"] = e["ant"] + e["saldo"] + e["pp"]
    e = e.merge(flota.groupby("envio_id")["fecha_pago"].max().rename("ult_pago"), left_on="eid", right_index=True, how="left")

    # ---- CXP afiliados: facturas de saldo abiertas ('M<envio>'), menos las pagadas despues del corte del query
    cx = cxp_all[cxp_all["tipo"] == "AFILIADOS"].copy()
    post = flota[(flota["tipo"] == "SALDO FLOTA") & (flota["fecha_pago"] > corte_cxp)].groupby("envio_id")["importe"].sum()
    cx["pagado_post"] = cx["eid"].map(post).fillna(0)
    cx["cerrada_post"] = (cx["pagado_post"] >= 0.9 * cx["imp"]) & (cx["imp"] > 0)
    n_post, imp_post = int(cx["cerrada_post"].sum()), float(cx.loc[cx["cerrada_post"], "imp"].sum())
    cx = cx[~cx["cerrada_post"]].copy()
    mapa = pd.concat([og[["eid", "placa", "nombre"]].rename(columns={"nombre": "afiliado"}),
                      mapa_hist[["eid", "Placa", "Afiliado"]].rename(columns={"Placa": "placa", "Afiliado": "afiliado"}),
                      e[["eid", "placa", "afiliado"]]]).drop_duplicates("eid", keep="last")
    mapa["placa"] = mapa["placa"].astype(str).str.replace("TCL.", "", regex=False)
    cx = cx.merge(mapa[["eid", "placa"]], on="eid", how="left")
    cx["libre"] = np.where(cx["ret_activa"], 0.0, cx["imp"])
    cx["retenido"] = np.where(cx["ret_activa"], cx["imp"], 0.0)
    cx["venc90"] = np.where(~cx["ret_activa"] & (cx["dias_venc"] > 90), cx["imp"], 0.0)
    por_eid = cx[cx["eid"].notna()].groupby("eid").agg(cxp_libre=("libre", "sum"), cxp_ret=("retenido", "sum"),
                                                       dias_venc=("dias_venc", "max"))
    e = e.merge(por_eid, left_on="eid", right_index=True, how="left")
    e[["cxp_libre", "cxp_ret"]] = e[["cxp_libre", "cxp_ret"]].fillna(0)
    e["en_cxp"] = (e["cxp_libre"] + e["cxp_ret"]) != 0

    # afiliado con movimiento = recibio algun pago de flota o tiene saldo en CXP
    con_mov = set(flota["prov_n"]) | set(cx["prov_n"]) | set(e.loc[e["pagado"] != 0, "afn"])
    e["con_mov"] = e["afn"].isin(con_mov)
    e["aplica"] = (~e["propia"]) & e["con_mov"]
    # afiliados a los que SI se les paga ANT/M en el archivo de pagos: solo a ellos se les estima saldo por liquidar.
    # Los que solo aparecen en el CXP (sin pagos en 2026) se miden unicamente por su saldo abierto.
    con_pagos = set(flota["prov_n"]) | set(e.loc[e["pagado"] != 0, "afn"])
    e["con_pagos"] = e["afn"].isin(con_pagos)
    solo_cxp = cx[~cx["prov_n"].isin(con_pagos)]

    def estado_viaje(r):
        if r["propia"]:
            return "FLOTA PROPIA"
        if not r["con_mov"]:
            return "SIN PAGOS NI SALDO (afiliado sin movimiento)"
        if r["fecha"] < pagos_desde and r["pagado"] == 0 and not r["en_cxp"]:
            return "ANTERIOR AL ARCHIVO DE PAGOS"
        if r["compra"] <= 0:
            if r["ant"] > 0:
                return "ANTICIPO - COSTO SIN CARGAR"
            # compra y venta en 0 = viaje sin valor (p.ej. movimiento sin cobro ni pago): no es un costo pendiente de cargar
            return "SIN COSTO CARGADO" if r["venta"] > 0 else "SIN VALOR (compra y venta en 0)"
        if r["en_cxp"]:
            return "SALDO ABIERTO EN CXP" + (" (RETENIDO)" if r["cxp_ret"] and not r["cxp_libre"] else "")
        if r["pagado"] / r["compra"] >= UMBRAL_CERRADO:
            return "PAGADO COMPLETO"
        if r["estado"] != "COMPLETADO":
            return "EN CURSO" + (" (con anticipo)" if r["ant"] > 0 else "")
        return "COMPLETADO, SALDO SIN FACTURAR EN CXP" if r["pagado"] > 0 else "COMPLETADO SIN PAGO NI SALDO"

    e["estado_pago_viaje"] = e.apply(estado_viaje, axis=1)
    est_pend = (e["compra"] * FACTOR_PAGO - e["pagado"]).clip(lower=0)
    sin_cxp = e["aplica"] & e["con_pagos"] & (e["fecha"] >= pagos_desde) & (e["compra"] > 0) & ~e["en_cxp"] & (e["pagado"] / e["compra"].where(e["compra"] > 0, 1) < UMBRAL_CERRADO)
    e["por_liquidar"] = np.where(sin_cxp & (e["estado"] == "COMPLETADO"), est_pend, 0.0)   # terminado, sin factura de saldo en CXP
    e["por_causar"] = np.where(sin_cxp & (e["estado"] != "COMPLETADO"), est_pend, 0.0)     # aun en ruta
    e["edad"] = (hoy - e["fecha"]).dt.days

    ventana = e[e["fecha"] >= hoy - pd.Timedelta(days=VENTANA_DIAS)].copy()
    viajes_mes = e[(e["fecha"] >= mes_ini) & (e["fecha"] < mes_fin)].copy()

    # ---- pagos del mes con placa
    pm = pv[(pv["fecha_pago"] >= mes_ini) & (pv["fecha_pago"] < mes_fin)].copy()
    pm = pm.merge(mapa, left_on="envio_id", right_on="eid", how="left")
    oper_envio = pd.concat([og[["eid", "oper"]], e[["eid", "oper"]]]).drop_duplicates("eid", keep="last").set_index("eid")["oper"]
    pm["operacion"] = pm["envio_id"].map(oper_envio)
    pm["cruzado"] = pm["placa"].notna()
    en_viajes = pm["envio_id"].isin(set(e["eid"]))
    pm["estado_cruce"] = np.where(~pm["es_flota"], "", np.where(en_viajes, "OK", "FUERA DE LOS ARCHIVOS DE VIAJES"))
    pm["benef_distinto"] = pm["es_flota"] & pm["cruzado"] & (pm["prov_n"] != pm["afiliado"].map(norm))

    # ---- rotacion (ultimos 30 dias) por placa y por afiliado
    ee = e[e["aplica"]].copy()
    activo = ee["estado"].isin(["EN RUTA", "POR INICIAR"]) & (ee["edad"] <= DIAS_ACTIVO)

    def rotacion(key):
        g = ee.groupby(key)
        r = pd.DataFrame({"ultimo_viaje": g["fecha"].max()})
        for dias, n in [(7, "v7"), (15, "v15"), (30, "v30")]:
            r[n] = ee[ee["fecha"] >= hoy - pd.Timedelta(days=dias)].groupby(key)["eid"].nunique()
        r["en_ruta"] = ee[activo & (ee["estado"] == "EN RUTA")].groupby(key)["eid"].nunique()
        r["por_iniciar"] = ee[activo & (ee["estado"] == "POR INICIAR")].groupby(key)["eid"].nunique()
        vm = viajes_mes[viajes_mes["aplica"]].groupby(key)
        r["viajes_mes"], r["compra_mes"] = vm["eid"].nunique(), vm["compra"].sum()
        r["venta_mes"], r["utilidad_mes"] = vm["venta"].sum(), vm["utilidad"].sum()
        w = ventana[ventana["aplica"]].groupby(key)
        r["por_liquidar"], r["por_causar"] = w["por_liquidar"].sum(), w["por_causar"].sum()
        return r

    def pagos_mes(key_pm):
        f = pm[pm["es_flota"]].groupby(key_pm)
        r = pd.DataFrame({
            "ant_mes": f.apply(lambda d: d.loc[d["tipo"] == "ANTICIPO FLOTA", "importe"].sum()),
            "saldo_mes": f.apply(lambda d: d.loc[d["tipo"] == "SALDO FLOTA", "importe"].sum()),
            "pp_mes": f.apply(lambda d: d.loc[d["tipo"] == "DESCUENTO PRONTO PAGO", "importe"].sum()),
            "ultimo_pago": f["fecha_pago"].max()})
        r["pagado_mes"] = r["ant_mes"] + r["saldo_mes"] + r["pp_mes"]
        return r

    def completar(df):
        z = ["v7", "v15", "v30", "en_ruta", "por_iniciar", "viajes_mes", "compra_mes", "venta_mes", "utilidad_mes", "por_liquidar",
             "por_causar", "exigible", "retenido", "venc90", "ant_mes", "saldo_mes", "pp_mes", "pagado_mes"]
        for c in z:
            if c not in df:
                df[c] = 0.0
        df[z] = df[z].fillna(0)
        df["dias_sin_viaje"] = (hoy - df["ultimo_viaje"]).dt.days.fillna(9999)
        df["activos"] = df["en_ruta"] + df["por_iniciar"]
        df["futuro"] = df["por_liquidar"] + df["por_causar"]
        df["margen"] = np.where(df["venta_mes"] > 0, df["utilidad_mes"] / df["venta_mes"], np.nan)
        df["rota"] = (df["v15"] >= 3) | (df["v7"] >= 2) | (df["activos"] > 0)
        df["rotacion"] = np.select([df["rota"], df["v15"] >= 1, df["v30"] >= 1], ["ALTA", "MEDIA", "BAJA"], "NULA")
        df["pagado_sin_rotar"] = (df["pagado_mes"] > 0) & (df["activos"] == 0) & (df["dias_sin_viaje"] >= DIAS_SIN_ROTAR)
        pr = [prioridad(a, b, c, d) for a, b, c, d in zip(df["exigible"], df["futuro"], df["dias_sin_viaje"], df["rota"])]
        df["accion"] = [texto_accion(k, r) for k, (_, r) in zip(pr, df.iterrows())]
        df["_pr"] = [7 if (s and k in (5, 6)) else k for k, s in zip(pr, df["pagado_sin_rotar"])]
        df["prioridad"] = df["_pr"].map(NOMBRES_PRIO)
        return df.sort_values(["_pr", "exigible"], ascending=[True, False])

    # placas
    pl = rotacion("placa")
    pl["afiliado"] = ee.groupby("placa")["afiliado"].last()
    ops30 = ee[ee["fecha"] >= hoy - pd.Timedelta(days=30)]
    pl["ops"] = ops30.groupby("placa")["oper"].agg(lambda s: ", ".join(sorted(set(s))))
    pl = pl.join(pagos_mes("placa"))
    g = cx[cx["placa"].notna()].groupby("placa")
    pl["exigible"], pl["retenido"], pl["venc90"] = g["libre"].sum(), g["retenido"].sum(), g["venc90"].sum()
    pl = pl.reset_index()
    pl = pl[(pl["ultimo_viaje"] >= hoy - pd.Timedelta(days=VENTANA_DIAS)) | (pl["pagado_mes"].fillna(0) != 0)]
    placas = completar(pl.copy())

    # afiliados (la transferencia se hace por afiliado: esta es la vista principal)
    af = rotacion("afn")
    af["afiliado"] = ee.groupby("afn")["afiliado"].last()
    af["ops"] = ops30.groupby("afn")["oper"].agg(lambda s: ", ".join(sorted(set(s))))
    af["n_placas"] = ee[ee["fecha"] >= hoy - pd.Timedelta(days=30)].groupby("afn")["placa"].nunique()
    af["placas_rotando"] = pl.assign(afn=pl["afiliado"].map(norm)).query("v15 >= 3 or v7 >= 2").groupby("afn")["placa"].nunique()
    ga = cx.groupby("prov_n")
    af = af.join(pd.DataFrame({"exigible": ga["libre"].sum(), "retenido": ga["retenido"].sum(), "venc90": ga["venc90"].sum(),
                               "n_facturas": ga["fac"].size(), "prov_cxp": ga["proveedor"].first()}), how="outer")
    af = af.join(pagos_mes("prov_n"), how="outer")
    af["afiliado"] = af["afiliado"].fillna(af["prov_cxp"]).fillna(pd.Series(af.index, index=af.index))
    af["n_placas"] = af["n_placas"].fillna(0)
    af["placas_rotando"] = af["placas_rotando"].fillna(0)
    af["n_facturas"] = af["n_facturas"].fillna(0)
    af = af.reset_index().rename(columns={"index": "afn"})
    afil = completar(af[af["afn"].isin(afiliados_n | set(cx["prov_n"]))].copy())

    # ---- alertas
    alertas = []
    for _, r in pm[pm["estado_cruce"] == "FUERA DE LOS ARCHIVOS DE VIAJES"].iterrows():
        op = f" (operacion {r['operacion']})" if pd.notna(r["operacion"]) else ""
        alertas.append(["PAGO SIN VIAJE EN LOS ARCHIVOS", r["envio_id"], r["placa"], r["proveedor"], r["fecha_pago"], r["importe"],
                        f"{r['factura']}: el envio{op} no esta en los archivos de viajes de 2026 (NACIONAL, CEDIS, EXPO, IMPO): viaje aun no cargado o de un mes anterior"])
    for _, r in pm[pm["benef_distinto"]].iterrows():
        alertas.append(["BENEFICIARIO DISTINTO AL AFILIADO", r["envio_id"], r["placa"], r["proveedor"], r["fecha_pago"], r["importe"],
                        f"{r['factura']}: viaje del afiliado '{r['afiliado']}', pagado a '{r['proveedor']}'"])
    cand = ventana[ventana["aplica"] & (ventana["estado"] == "COMPLETADO") & (ventana["edad"] >= 3)]
    for _, r in cand[cand["estado_pago_viaje"].isin(["SIN COSTO CARGADO", "ANTICIPO - COSTO SIN CARGAR"])].iterrows():
        alertas.append(["VIAJE COMPLETADO SIN COSTO DE COMPRA", r["eid"], r["placa"], r["afiliado"], r["fecha"], r["venta"],
                        f"[{r['oper']}] Se factura ${r['venta']:,.0f} pero la compra esta en 0: no se puede calcular el saldo a pagar. Pedir cargue del costo."])
    for _, r in cand[(cand["por_liquidar"] > 0) & (cand["edad"] > 30)].iterrows():
        alertas.append(["COMPLETADO >30d SIN FACTURA DE SALDO EN CXP", r["eid"], r["placa"], r["afiliado"], r["fecha"], r["por_liquidar"],
                        f"Viaje terminado y saldo estimado sin factura en CXP. Cumplido: {r['cumplido']}"
                        f"{' (' + format(r['fcump'], '%d/%m') + ')' if pd.notna(r['fcump']) else ''}."])
    for _, r in ventana[ventana["aplica"] & (ventana["compra"] > 0) & (ventana["ant"] > ventana["compra"] * FACTOR_PAGO)].iterrows():
        alertas.append(["ANTICIPO SOBRE LO PAGADERO (no deja saldo)", r["eid"], r["placa"], r["afiliado"], r["fecha"], r["ant"],
                        f"Anticipo ${r['ant']:,.0f} vs compra ${r['compra']:,.0f}"])
    for _, r in ventana[ventana["aplica"] & (ventana["compra"] > 0) & (ventana["pagado"] > ventana["compra"] * 1.02)].iterrows():
        alertas.append(["SOBREPAGO", r["eid"], r["placa"], r["afiliado"], r["fecha"], r["pagado"] - r["compra"],
                        f"Pagado ${r['pagado']:,.0f} > compra ${r['compra']:,.0f}"])
    for _, r in pm[pm.duplicated(["factura", "proveedor", "importe"], keep=False) & pm["es_flota"]].iterrows():
        alertas.append(["POSIBLE PAGO DUPLICADO", r["envio_id"], r["placa"], r["proveedor"], r["fecha_pago"], r["importe"],
                        f"{r['factura']} aparece mas de una vez con el mismo importe"])
    alertas = pd.DataFrame(alertas, columns=["Alerta", "Envio", "Placa", "Afiliado / Proveedor", "Fecha", "Valor", "Detalle"])

    # ---- sin movimiento + proveedores
    sr = e[(~e["propia"]) & (~e["con_mov"]) & (e["fecha"] >= hoy - pd.Timedelta(days=30))]
    sin_reg = sr.groupby(["afiliado", "placa"]).agg(viajes_30d=("eid", "nunique"), ultimo_viaje=("fecha", "max"),
                                                    compra_30d=("compra", "sum"), venta_30d=("venta", "sum")
                                                    ).reset_index().sort_values("compra_30d", ascending=False)
    otros = pm[~pm["es_flota"]]
    prov = otros.groupby(["categoria", "tipo_cxp", "proveedor", "tipo"], dropna=False).agg(
        pagos=("factura", "size"), importe=("importe", "sum"), ultimo_pago=("fecha_pago", "max")).reset_index().sort_values(
        ["categoria", "importe"], ascending=[True, False])
    prov["tipo_cxp"] = prov["tipo_cxp"].fillna("(no esta en CXP)")
    cxo = cxp_all[(cxp_all["tipo"] != "AFILIADOS")]
    cxp_prov = cxo.groupby(["tipo", "proveedor"]).agg(facturas=("fac", "size"), impagado=("imp", "sum"),
                                                      vencido_90=("imp", lambda s: s[cxo.loc[s.index, "dias_venc"] > 90].sum()),
                                                      max_dias_venc=("dias_venc", "max")).reset_index().sort_values(
        ["tipo", "impagado"], ascending=[True, False])

    ctx = dict(hoy=hoy, mes_ini=mes_ini, placas=placas, afil=afil, e=e, pm=pm, viajes_mes=viajes_mes, alertas=alertas, prov=prov,
               ventana=ventana, pv=pv, v=v, cx=cx, cxp_all=cxp_all, corte_cxp=corte_cxp, n_post=n_post, imp_post=imp_post,
               sin_reg=sin_reg, cxp_prov=cxp_prov, solo_cxp=solo_cxp, og=og, lin=lin, pagos_desde=pagos_desde)
    log("Generando dashboard...")
    salida = escribir_dashboard(ctx)
    if con_excel:                                   # el Excel ya no es la salida principal: solo con --excel
        os.makedirs(DIR_SALIDAS, exist_ok=True)
        escribir_excel(os.path.join(DIR_SALIDAS, f"Seguimiento_Flota_Pagos_{hoy:%Y-%m-%d}.xlsx"), ctx)
    log(f"Listo en {(datetime.now() - t0).seconds}s -> {salida}")


# ----------------------------------------------------------------------------- DASHBOARD
def _recs(df, cols, ren=None):
    d = df[cols].copy()
    if ren:
        d = d.rename(columns=ren)
    return json.loads(d.to_json(orient="records", date_format="iso", force_ascii=False))


def escribir_dashboard(L):
    hoy, pm, alertas, prov = L["hoy"], L["pm"], L["alertas"], L["prov"]
    placas, afil, cx, cxp_all, vm = L["placas"].copy(), L["afil"].copy(), L["cx"], L["cxp_all"], L["viajes_mes"]
    for d in (placas, afil):
        d["dias_sin_viaje"] = d["dias_sin_viaje"].where(d["dias_sin_viaje"] < 9999)
        d["pr"] = d["_pr"]
        d["placas_rotando"] = d.get("placas_rotando", 0)

    # --- kpis
    flota = pm[pm["es_flota"]]
    ant, sal = pm[pm["tipo"] == "ANTICIPO FLOTA"], pm[pm["tipo"] == "SALDO FLOTA"]
    vnp = vm[~vm["propia"]]
    a1, a4, a7 = afil[afil["pr"] == 1], afil[afil["pr"] == 4], afil[afil["pagado_sin_rotar"]]
    sc = L["solo_cxp"]
    kp = dict(
        pagos_total=pm["importe"].sum(), pagos_flota=flota["importe"].sum(), pagos_prov=pm.loc[~pm["es_flota"], "importe"].sum(),
        ant=ant["importe"].sum(), saldo=sal["importe"].sum(), n_ant=len(ant), n_saldo=len(sal),
        cxp_total=cx["imp"].sum(), cxp_libre=cx["libre"].sum(), cxp_ret=cx["retenido"].sum(), venc90=cx["venc90"].sum(),
        pagar_ya=a1["exigible"].sum(), pagar_ya_n=len(a1), sinrot_valor=a7["pagado_mes"].sum(), sinrot_n=len(a7),
        sinrot_placas=int(placas["pagado_sin_rotar"].sum()), viajes=len(vm), compra=vnp["compra"].sum(), venta=vm["venta"].sum(),
        utilidad=vm["utilidad"].sum(), margen=(vm["utilidad"].sum() / vm["venta"].sum()) if vm["venta"].sum() else 0,
        cobertura=(vnp["pagado"].sum() / vnp["compra"].sum()) if vnp["compra"].sum() else 0,
        noprio=a4["exigible"].sum(), noprio_n=len(a4), noprio90=a4["venc90"].sum(),
        solo_cxp_n=int(sc["prov_n"].nunique()), solo_cxp_v=sc["imp"].sum())

    # --- pagos por dia
    bucket = np.select([pm["tipo"] == "ANTICIPO FLOTA", pm["tipo"] == "SALDO FLOTA", pm["tipo"] == "PROVEEDOR / GASTO"],
                       ["Anticipos flota", "Saldos flota", "Proveedores y gastos"], "Descuentos y cruces")
    pdia = pm.assign(b=bucket, dia=pm["fecha_pago"].dt.strftime("%Y-%m-%d")).pivot_table(
        index="dia", columns="b", values="importe", aggfunc="sum", fill_value=0).reset_index()
    for c in ["Anticipos flota", "Saldos flota", "Proveedores y gastos", "Descuentos y cruces"]:
        if c not in pdia:
            pdia[c] = 0.0

    # --- pagos por dia (todos los dias del mes hasta el ultimo pago), para las dos graficas de la portada
    rango_dias = pd.date_range(L["mes_ini"], pm["fecha_pago"].max())
    dd = pd.DataFrame({"dia": rango_dias})
    for nom, filtro in [("ant", pm["tipo"] == "ANTICIPO FLOTA"), ("saldo", pm["tipo"] == "SALDO FLOTA"),
                        ("prov", pm["tipo"] == "PROVEEDOR / GASTO")]:
        g = pm[filtro].groupby("fecha_pago")["importe"].agg(["sum", "size"])
        dd[nom] = dd["dia"].map(g["sum"]).fillna(0.0)
        dd["n_" + nom] = dd["dia"].map(g["size"]).fillna(0).astype(int)
    dd["dia"] = dd["dia"].dt.strftime("%Y-%m-%d")

    # --- pendiente por pagar segun antiguedad de la factura (misma regla del informe CXP: dias desde la fecha de factura)
    cortes = [-np.inf, 15, 30, 45, 60, 75, 90, 120, 180, np.inf]
    nombres_r = ["0-15", "15-30", "30-45", "45-60", "60-75", "75-90", "90-120", "120-180", ">180"]

    def edad(df):
        d = df.copy()
        d["r"] = pd.cut((L["corte_cxp"] - d["f_fac"]).dt.days, cortes, labels=nombres_r)
        g = d.groupby("r", observed=False).agg(n=("fac", "size"), saldo=("imp", "sum"),
                                              ret=("imp", lambda s: s[d.loc[s.index, "ret_activa"]].sum())).reset_index()
        return dict(rangos=json.loads(g.rename(columns={"r": "rango"}).to_json(orient="records")),
                    total=float(d["imp"].sum()), n=len(d),
                    vencido=float(d.loc[d["r"] != "0-15", "imp"].sum()),
                    vencido_real=float(d.loc[d["dias_venc"] > 0, "imp"].sum()), ret=float(d.loc[d["ret_activa"], "imp"].sum()))

    edad_d = dict(afiliados=edad(cx), proveedores=edad(cxp_all[cxp_all["tipo"] == "PROVEEDORES"]),
                  otros=edad(cxp_all[~cxp_all["tipo"].isin(["AFILIADOS", "PROVEEDORES"])]))

    gt = pm.groupby("tipo").agg(n=("factura", "size"), importe=("importe", "sum")).reset_index().sort_values("importe", ascending=False)
    gc = flota.groupby("estado_cruce").agg(n=("factura", "size"), importe=("importe", "sum")).reset_index().rename(columns={"estado_cruce": "cruce"})
    pg = pm.sort_values("fecha_pago", ascending=False).copy()
    pg["estado_cruce"] = pg["estado_cruce"].replace("", None)

    # --- cartera
    lib = cx[~cx["ret_activa"]]
    venc = []
    for lo, hi, nom in [(0, 0, "No vencido"), (1, 30, "1-30 días"), (31, 60, "31-60 días"), (61, 90, "61-90 días"),
                        (91, 180, "91-180 días"), (181, 99999, "Más de 180 días")]:
        d = lib[(lib["dias_venc"] >= lo) & (lib["dias_venc"] <= hi)]
        venc.append(dict(rango=nom, dias=lo, saldo=float(d["imp"].sum()), n=len(d)))
    ret = (cx[cx["ret_activa"]].assign(motivo=lambda d: d["mot_ret"].map(grupo_retencion)).groupby("motivo")
           .agg(saldo=("imp", "sum"), n=("fac", "size")).reset_index().sort_values("saldo", ascending=False))
    co = cxp_all[cxp_all["tipo"] != "AFILIADOS"].groupby("tipo").agg(impagado=("imp", "sum"), n=("fac", "size")).reset_index()
    co = co.assign(a=co["impagado"].abs()).sort_values("a", ascending=False).drop(columns="a")
    car = dict(venc=venc, ret=json.loads(ret.to_json(orient="records", force_ascii=False)),
               otros=json.loads(co.to_json(orient="records", force_ascii=False)),
               n=len(cx), total=float(cx["imp"].sum()), libre=float(cx["libre"].sum()), ret_total=float(cx["retenido"].sum()),
               n_post=L["n_post"], imp_post=L["imp_post"])
    # pendiente por afiliado / proveedor (vencido = mas de 15 dias desde la fecha de factura, regla del informe CXP)
    def pendientes(df, claves):
        d = df.copy()
        d["dfac"] = (L["corte_cxp"] - d["f_fac"]).dt.days
        d["v15"] = np.where(d["dfac"] > 15, d["imp"], 0.0)
        d["v90"] = np.where(d["dfac"] > 90, d["imp"], 0.0)
        d["vreal"] = np.where(d["dias_venc"] > 0, d["imp"], 0.0)
        d["ret"] = np.where(d["ret_activa"], d["imp"], 0.0)
        g = d.groupby(claves).agg(afiliado=("proveedor", "first"), n=("fac", "size"), total=("imp", "sum"), retenido=("ret", "sum"),
                                  vencido=("v15", "sum"), v90=("v90", "sum"), vreal=("vreal", "sum"), max_dias=("dfac", "max")).reset_index()
        return g.sort_values("vencido", ascending=False)

    pa = pendientes(cx, "prov_n").merge(afil[["afn", "prioridad"]], left_on="prov_n", right_on="afn", how="left")
    pa["prioridad"] = pa["prioridad"].fillna("(sin viajes recientes)")
    pp_ = pendientes(cxp_all[cxp_all["tipo"] != "AFILIADOS"], ["tipo", "prov_n"]).rename(columns={"afiliado": "proveedor"})
    pg["grupo"] = np.where(pg["es_flota"], "Flota (afiliados)", "Proveedores y otros")
    pcat = prov.groupby("categoria").agg(importe=("importe", "sum"), n=("pagos", "sum")).reset_index().sort_values("importe", ascending=False)

    al = alertas.rename(columns={"Alerta": "alerta", "Envio": "envio", "Placa": "placa", "Afiliado / Proveedor": "quien",
                                 "Fecha": "fecha", "Valor": "valor", "Detalle": "detalle"})
    al["a"] = al["valor"].abs()
    al = al.sort_values("a", ascending=False).drop(columns="a")
    ares = al["alerta"].value_counts().rename_axis("alerta").reset_index(name="n")

    pres = (afil.groupby(["pr", "prioridad"]).agg(n=("afn", "size"), exigible=("exigible", "sum")).reset_index().sort_values("pr"))
    ve = vnp.groupby("estado_pago_viaje").agg(n=("eid", "size"), compra=("compra", "sum")).reset_index().rename(
        columns={"estado_pago_viaje": "estado"}).sort_values("compra", ascending=False)

    # --- viajes del mes (todas las operaciones): por operacion y por afiliado
    va = vm.assign(compra_a=np.where(vm["propia"], 0.0, vm["compra"]), pagado_a=np.where(vm["propia"], 0.0, vm["pagado"]),
                   pend=vm["cxp_libre"] + vm["cxp_ret"], propia_n=vm["propia"].astype(int))
    vop = va.groupby("oper").agg(viajes=("eid", "size"), propios=("propia_n", "sum"), venta=("venta", "sum"), compra=("compra_a", "sum"),
                                 utilidad=("utilidad", "sum"), pagado=("pagado_a", "sum"), pend=("pend", "sum")).reset_index()
    vop["oper"] = pd.Categorical(vop["oper"], ["NACIONAL", "CEDIS", "EXPO", "IMPO"], ordered=True)
    vop = vop.sort_values("oper")
    vtr = va[~va["propia"]]
    vaf = vtr.groupby("afiliado").agg(ops=("oper", lambda s: ", ".join(sorted(set(s)))), viajes=("eid", "size"), venta=("venta", "sum"),
                                      compra=("compra", "sum"), utilidad=("utilidad", "sum"), pagado=("pagado", "sum"),
                                      pend=("pend", "sum"), por_liquidar=("por_liquidar", "sum")).reset_index().sort_values("compra", ascending=False)
    # --- anticipos vs lo que se debe pagar al afiliado, por mes de creacion del viaje y operacion (solo terceros con compra cargada)
    et = L["e"][(~L["e"]["propia"]) & (L["e"]["compra"] > 0) & (L["e"]["fecha"] >= max(pd.Timestamp(f"{hoy.year}-01-01"), L["pagos_desde"]))].copy()
    et["mes"] = et["fecha"].dt.strftime("%Y-%m")
    et["falta"] = (et["compra"] - et["pagado"]).clip(lower=0)
    et["con_ant"] = (et["ant"] > 0).astype(int)
    antic = et.groupby(["mes", "oper"]).agg(viajes=("eid", "size"), con_ant=("con_ant", "sum"), compra=("compra", "sum"), ant=("ant", "sum"),
                                            saldo=("saldo", "sum"), pagado=("pagado", "sum"), falta=("falta", "sum")).reset_index()
    cols_a = ["pr", "prioridad", "accion", "afiliado", "ops", "rotacion", "placas_rotando", "v7", "v15", "v30", "dias_sin_viaje", "viajes_mes",
              "compra_mes", "pagado_mes", "ultimo_pago", "exigible", "venc90", "retenido", "n_facturas", "por_liquidar", "por_causar", "pagado_sin_rotar"]
    cols_p = ["pr", "prioridad", "accion", "placa", "afiliado", "ops", "rotacion", "v7", "v15", "v30", "dias_sin_viaje", "viajes_mes", "compra_mes",
              "utilidad_mes", "ant_mes", "saldo_mes", "pagado_mes", "ultimo_viaje", "ultimo_pago", "exigible", "venc90", "retenido", "pagado_sin_rotar"]
    # --- informacion por cliente (cliente x mes x operacion), con la compra/anticipos/pagos repartidos segun la venta de cada cliente
    ee_ = L["e"]
    cl = L["lin"].merge(ee_[["eid", "oper", "propia", "fecha", "compra", "ant", "pagado", "cxp_libre", "cxp_ret", "con_pagos"]], on="eid")
    cl = cl[cl["fecha"] >= pd.Timestamp(f"{hoy.year}-01-01")].copy()
    cl["mes"] = cl["fecha"].dt.strftime("%Y-%m")
    tercero = (~cl["propia"]) & (cl["compra"] > 0)
    cl["compra_c"] = np.where(tercero, cl["compra"] * cl["share"], 0.0)
    cl["ant_c"] = np.where(tercero, cl["ant"] * cl["share"], 0.0)
    cl["pagado_c"] = np.where(tercero, cl["pagado"] * cl["share"], 0.0)
    cl["falta_c"] = np.where(tercero & cl["con_pagos"] & (cl["fecha"] >= L["pagos_desde"]), (cl["compra"] - cl["pagado"]).clip(lower=0) * cl["share"], 0.0)
    cl["pend_c"] = (cl["cxp_libre"] + cl["cxp_ret"]) * cl["share"]
    cl["costo_c"] = cl["compra"].where(cl["compra"] > 0, 0.0) * cl["share"]            # costo total (incluye flota propia) para la utilidad
    cl["propio_n"] = cl["propia"].astype(int)
    gcl = cl.groupby(["cli_n", "mes", "oper"]).agg(
        viajes=("eid", "nunique"), propios=("propio_n", "sum"), venta=("venta_c", "sum"), compra=("compra_c", "sum"), costo=("costo_c", "sum"),
        ant=("ant_c", "sum"), pagado=("pagado_c", "sum"), falta=("falta_c", "sum"), pend=("pend_c", "sum")).reset_index().rename(columns={"cli_n": "cliente"})
    n_multi = int(L["lin"].groupby("eid").size().gt(1).sum())
    # --- flota de AJOVER y NOUVELLE por operacion (viajes con cliente principal AJOV / NOCO)
    ea = L["e"][L["e"]["seg"].ne("OTROS") & (L["e"]["fecha"] >= pd.Timestamp(f"{hoy.year}-01-01"))].copy()
    ea["cliente_op"] = np.where(ea["cod"] == "AJOV", "AJOVER", "NOUVELLE")
    ea["mes"] = ea["fecha"].dt.strftime("%Y-%m")
    ea["costo"] = ea["compra"].where(ea["compra"] > 0, 0.0)
    ea["compra_a"] = np.where(ea["propia"], 0.0, ea["costo"])
    ea["ant_a"] = np.where(ea["propia"], 0.0, ea["ant"])
    ea["pagado_a"] = np.where(ea["propia"], 0.0, ea["pagado"])
    # solo se estima lo que falta pagar de afiliados que aparecen con pagos en el archivo; sin pagos registrados la unica cifra confiable es la cartera (CXP)
    ea["falta"] = np.where(ea["propia"] | ~ea["con_pagos"] | (ea["fecha"] < L["pagos_desde"]), 0.0, (ea["compra"] - ea["pagado"]).clip(lower=0))
    ea["cp"] = ea["con_pagos"].astype(int)
    ea["pend"] = ea["cxp_libre"] + ea["cxp_ret"]
    ea["ultimo"] = ea["fecha"].dt.strftime("%Y-%m-%d")
    ea["propia_i"] = ea["propia"].astype(int)
    fa = ea.groupby(["cliente_op", "seg", "mes", "placa", "afiliado", "propia_i"]).agg(
        viajes=("eid", "size"), venta=("venta", "sum"), costo=("costo", "sum"), compra=("compra_a", "sum"), ant=("ant_a", "sum"),
        pagado=("pagado_a", "sum"), falta=("falta", "sum"), pend=("pend", "sum"), ultimo=("ultimo", "max")).reset_index()
    fa[["venta", "costo", "compra", "ant", "pagado", "falta", "pend"]] = fa[["venta", "costo", "compra", "ant", "pagado", "falta", "pend"]].round(0)
    fv = ea[ea["fecha"] >= hoy - pd.Timedelta(days=120)][["cliente_op", "seg", "placa", "afiliado", "propia_i", "cp", "tip", "ultimo", "compra_a", "pagado_a", "falta", "pend"]].rename(
        columns={"ultimo": "fecha", "compra_a": "compra", "pagado_a": "pagado"})
    fv[["compra", "pagado", "falta", "pend"]] = fv[["compra", "pagado", "falta", "pend"]].round(0)
    # detalle a nivel de manifiesto (todo 2026) para ver los viajes de una placa o afiliado
    fm = ea.assign(estado_pago=ea["estado_pago_viaje"], ruta=ea["origen"].astype(str) + " > " + ea["destino"].astype(str), saldo_=ea["saldo"] + ea["pp"])[
        ["eid", "placa", "afiliado", "cliente_op", "seg", "tip", "ultimo", "ruta", "cliente", "estado", "cumplido", "propia_i", "cp", "venta", "compra", "ant", "saldo_",
         "pagado", "falta", "pend", "estado_pago"]].rename(columns={"ultimo": "fecha", "saldo_": "saldo"})
    fm["compra"] = fm["compra"].where(fm["compra"] > 0, 0.0)
    fm["utilidad"] = fm["venta"] - fm["compra"]
    fm[["venta", "utilidad", "compra", "ant", "saldo", "pagado", "falta", "pend"]] = fm[["venta", "utilidad", "compra", "ant", "saldo", "pagado", "falta", "pend"]].round(0)
    fm = fm.sort_values("fecha", ascending=False)

    # --- tabla dinamica de cuentas por pagar (todas las facturas abiertas del informe, como el pivot de Excel)
    cpv = cxp_all[cxp_all["imp"] != 0].copy()
    cpv["rango"] = pd.cut((L["corte_cxp"] - cpv["f_fac"]).dt.days.fillna(9999), cortes, labels=nombres_r)
    # cliente de cada factura de afiliados: envio de la factura -> cliente (nombre del archivo de viajes; si no, codigo de 'Operacion general' llevado a nombre)
    og_ = L["og"]
    cod2nom = (L["e"][["eid", "cliente"]].merge(og_[["eid", "cli"]], on="eid").dropna()
               .groupby("cli")["cliente"].agg(lambda s: s.mode().iloc[0]))
    cli_env = pd.concat([og_.set_index("eid")["cli"].map(lambda c: cod2nom.get(c, c)),
                         L["e"].set_index("eid")["cliente"]]).dropna()
    cli_env = cli_env[~cli_env.index.duplicated(keep="last")]
    cpv["cliente"] = np.where(cpv["tipo"] != "AFILIADOS", "(no aplica: no es de afiliados)",
                              cpv["eid"].map(cli_env).fillna("(sin dato: viaje anterior a jul-2025)"))
    pv_tipos, pv_provs = sorted(cpv["tipo"].unique()), sorted(cpv["proveedor"].astype(str).unique())
    pv_est, pv_cli = sorted(cpv["estado"].astype(str).unique()), sorted(cpv["cliente"].astype(str).unique())
    ix = lambda lst: {v: i for i, v in enumerate(lst)}
    ti, pi, ei, ri, ci = ix(pv_tipos), ix(pv_provs), ix(pv_est), ix(nombres_r), ix(pv_cli)
    piv = dict(tipos=pv_tipos, provs=pv_provs, estados=pv_est, clientes=pv_cli, rangos=nombres_r, corte=f"{L['corte_cxp']:%d/%m/%Y}",
               rows=[[ti[a], pi[str(b)], ri[str(c)], ei[str(d)], int(f), round(float(g)), ci[str(h)]]
                     for a, b, c, d, f, g, h in zip(cpv["tipo"], cpv["proveedor"], cpv["rango"], cpv["estado"], cpv["ret_activa"], cpv["imp"], cpv["cliente"])])
    # --- consulta por afiliado / placa: facturas abiertas (vencido = mas de 15 dias desde la factura) y viajes del mes
    fc = cx.assign(dfac=(L["corte_cxp"] - cx["f_fac"]).dt.days, f_fac_s=cx["f_fac"].dt.strftime("%Y-%m-%d"), ret_i=cx["ret_activa"].astype(int),
                   mot=cx["mot_ret"].map(lambda m: grupo_retencion(m) if isinstance(m, str) else ""))
    fc["placa"] = fc["placa"].fillna("").astype(str)
    fc = fc.sort_values("imp", ascending=False)[["proveedor", "placa", "fac", "f_fac_s", "dfac", "imp", "ret_i", "mot"]].rename(
        columns={"proveedor": "afiliado", "fac": "factura", "f_fac_s": "fecha", "imp": "importe"})
    fc["importe"] = fc["importe"].round(0)
    vq = vm.assign(fecha_s=vm["fecha"].dt.strftime("%Y-%m-%d"), ruta=vm["origen"].astype(str) + " > " + vm["destino"].astype(str),
                   saldo_=vm["saldo"] + vm["pp"], propia_i=vm["propia"].astype(int))
    vq = vq[["eid", "fecha_s", "oper", "placa", "afiliado", "cliente", "ruta", "estado", "propia_i", "venta", "compra", "ant", "saldo_", "pagado", "estado_pago_viaje"]].rename(
        columns={"fecha_s": "fecha", "saldo_": "saldo", "estado_pago_viaje": "estado_pago"})
    vq[["venta", "compra", "ant", "saldo", "pagado"]] = vq[["venta", "compra", "ant", "saldo", "pagado"]].round(0)
    # --- plan de caja: prioridad ESTRICTA de pago a afiliados (no basta con que deba saldo: se mira rotacion, venta que sostiene,
    #     lo ya pagado frente a lo causado y que tan vencido esta de verdad)
    ee_c = L["e"]
    t30 = ee_c[(~ee_c["propia"]) & (ee_c["fecha"] >= hoy - pd.Timedelta(days=30)) & (ee_c["fecha"] <= hoy)]
    g30 = t30.groupby("afn").agg(venta30=("venta", "sum"), compra30=("compra", lambda x: x.clip(lower=0).sum()), viajes30=("eid", "nunique"))
    pf = L["pv"][L["pv"]["es_flota"]].copy()
    pf["afn"] = pf["prov_n"]
    gp = pf.groupby("afn").agg(ult_pago=("fecha_pago", "max"))
    gp["pagado30"] = pf[pf["fecha_pago"] >= hoy - pd.Timedelta(days=30)].groupby("afn")["importe"].sum()
    gp["pagado7"] = pf[pf["fecha_pago"] >= hoy - pd.Timedelta(days=7)].groupby("afn")["importe"].sum()
    gp["ant30"] = pf[(pf["fecha_pago"] >= hoy - pd.Timedelta(days=30)) & (pf["tipo"] == "ANTICIPO FLOTA")].groupby("afn")["importe"].sum()
    cj = cx.copy()
    cj["dfac"] = (L["corte_cxp"] - cj["f_fac"]).dt.days
    cj["lib"] = np.where(cj["ret_activa"], 0.0, cj["imp"])
    cj["lib_venc"] = np.where((cj["dfac"] > 15) & ~cj["ret_activa"], cj["imp"], 0.0)
    cj["lib_v30"] = np.where((cj["dfac"] > 30) & ~cj["ret_activa"], cj["imp"], 0.0)
    gc_ = cj.groupby("prov_n").agg(nombre=("proveedor", "first"), libre=("lib", "sum"), venc_libre=("lib_venc", "sum"), venc30=("lib_v30", "sum"),
                                   retenido=("retenido", "sum"), n_fact=("fac", "size"), max_dfac=("dfac", "max"))
    cja = pd.concat([g30, gp, gc_], axis=1).reset_index().rename(columns={"index": "afn"})
    cja = cja.merge(afil[["afn", "afiliado", "v7", "v15", "activos", "por_liquidar", "por_causar", "dias_sin_viaje"]], on="afn", how="left")
    cja["afiliado"] = cja["afiliado"].fillna(cja["nombre"])
    cja = cja[cja["afiliado"].notna()].copy()
    for c in ["venta30", "compra30", "viajes30", "pagado30", "pagado7", "ant30", "libre", "venc_libre", "venc30", "retenido", "n_fact", "v7", "v15", "activos", "por_liquidar", "por_causar"]:
        cja[c] = cja[c].fillna(0)
    cja["dias_sin_pago"] = (hoy - cja["ult_pago"]).dt.days
    cja["ult_pago"] = cja["ult_pago"].dt.strftime("%Y-%m-%d")
    cja = cja[(cja["libre"] > 0) | (cja["venta30"] > 0) | (cja["pagado30"] > 0)].copy()
    cja = cja[(cja["libre"] > 0) | (cja["viajes30"] > 0)].copy()
    cja["cobertura"] = np.where(cja["compra30"] > 0, cja["pagado30"] / cja["compra30"].where(cja["compra30"] > 0, 1), np.nan)
    # Reglas (estrictas): el saldo solo es urgente si el afiliado ROTA y su saldo vencido pesa frente a lo que gana al mes.
    # peso = saldo libre vencido / compra de los ultimos 30 dias. Un afiliado al dia en la practica (pagado ~ causado, saldo pequeno) NO se prioriza.
    cja["rota"] = (cja["v15"] >= 3) | (cja["v7"] >= 2) | (cja["activos"] > 0)
    cja["activo"] = cja["viajes30"] > 0
    cja["peso"] = np.where(cja["compra30"] > 0, cja["venc_libre"] / cja["compra30"].where(cja["compra30"] > 0, 1), np.where(cja["venc_libre"] > 0, 9.99, 0.0))
    sdp = cja["dias_sin_pago"].fillna(99)
    crit = cja["rota"] & (cja["venc_libre"] >= 3_000_000) & ((cja["peso"] >= 0.5) | ((sdp > 10) & (cja["peso"] >= 0.25)))
    imp_ = cja["rota"] & (cja["venc_libre"] >= 1_000_000) & (cja["peso"] >= 0.2)
    prog = cja["activo"] & (cja["venc_libre"] >= 1_000_000) & (cja["peso"] >= 0.5)
    cja["nivel"] = np.select([cja["libre"] <= 0, crit, imp_, prog, cja["activo"]],
                             ["0-SIN SALDO", "1-CRITICO", "2-IMPORTANTE", "3-PROGRAMAR", "4-NO PRIORIZAR (al ritmo)"], "5-SALDO ANTIGUO (sin viajes en 30 dias)")
    cja["score"] = cja["peso"].clip(upper=9.99).round(2)

    def _mm(v):          # millones con el formato del dashboard (coma decimal, punto de miles)
        return f"${v / 1e6:,.1f} M".replace(",", "_").replace(".", ",").replace("_", ".")

    def _motivo(r):
        meses = f"{r['peso']:.1f}".replace(".", ",")
        lv = f"saldo vencido {_mm(r['venc_libre'])} = {meses} meses de lo que carga" if r["compra30"] > 0 else f"saldo vencido {_mm(r['venc_libre'])}"
        pag = f", último pago hace {int(r['dias_sin_pago'])} d" if pd.notna(r["dias_sin_pago"]) else ", sin pagos en el archivo"
        if r["nivel"].startswith("1"):
            return f"Rota ({int(r['v15'])} viajes en 15 d), sostiene {_mm(r['venta30'])} de venta y {lv}{pag}."
        if r["nivel"].startswith("2"):
            return f"Rota ({int(r['v15'])} viajes en 15 d); {lv}{pag}. Pagar después de los críticos."
        if r["nivel"].startswith("3"):
            return f"Cargó en 30 d pero no rota ({int(r['v15'])} viajes en 15 d); {lv}."
        if r["nivel"].startswith("4"):
            return f"Se le viene pagando al ritmo (pagado 30 d {_mm(r['pagado30'])} vs causado {_mm(r['compra30'])}); su saldo vencido {_mm(r['venc_libre'])} es pequeño frente a lo que mueve."
        if r["nivel"].startswith("5"):
            return f"Sin viajes en 30 días; saldo antiguo {_mm(r['venc_libre'])} ({int(r['max_dfac'])} d de la factura más vieja). Depurar o negociar: no es urgente para la operación."
        return "Sin saldo libre para pagar."
    cja["motivo"] = cja.apply(_motivo, axis=1)
    cja = cja.sort_values(["nivel", "venta30"], ascending=[True, False])
    cja["peso"] = cja["peso"].round(2)
    for c in ["venta30", "compra30", "pagado30", "pagado7", "ant30", "libre", "venc_libre", "venc30", "retenido", "por_liquidar", "por_causar", "cobertura"]:
        cja[c] = cja[c].round(0 if c != "cobertura" else 3)
    caja = _recs(cja, ["afn", "afiliado", "nivel", "score", "peso", "rota", "motivo", "viajes30", "v7", "v15", "activos", "venta30", "compra30", "pagado30", "pagado7", "ant30", "cobertura", "ult_pago",
                       "dias_sin_pago", "libre", "venc_libre", "venc30", "retenido", "n_fact", "por_liquidar", "por_causar", "dias_sin_viaje"])
    # venta por cliente de cada afiliado (ultimos 30 dias): sirve para ver que clientes sostiene cada afiliado y repartir la deuda por cliente
    cc = L["lin"].merge(t30[["eid", "afn", "compra"]], on="eid")
    cc["compra_c"] = cc["compra"].clip(lower=0) * cc["share"]
    ccj = cc.groupby(["afn", "cli_n"]).agg(venta=("venta_c", "sum"), compra=("compra_c", "sum"), viajes=("eid", "nunique")).reset_index()
    ccj = ccj.merge(cja[["afn", "afiliado"]], on="afn")[["afiliado", "cli_n", "venta", "compra", "viajes"]].rename(columns={"cli_n": "cliente"})
    ccj[["venta", "compra"]] = ccj[["venta", "compra"]].round(0)

    # --- prioridades que digitan los analistas (Excel compartido): operacion Ajover principal de cada afiliado + lectura del libro
    sa = ea[ea["fecha"] >= hoy - pd.Timedelta(days=60)].groupby(["afiliado", "seg"])["compra_a"].sum().reset_index()
    sa = sa.sort_values("compra_a", ascending=False).drop_duplicates("afiliado")
    seg_af = {norm(a): s for a, s in zip(sa["afiliado"], sa["seg"])}
    pri_filas, pri_meta = PRI.preparar(ARCHIVO_PRIORIDADES, cja.assign(afiliado=cja["afiliado"].astype(str)), ccj, seg_af, hoy, log=log)
    log(f"Prioridades de analistas: {pri_meta['n']} registradas ({pri_meta['alta']} alta) en {pri_meta['archivo']}")
    # --- viajes terminados o en ruta que aun no tienen factura (para proyectar lo que se va a deber) y rezago viaje -> factura
    ee_p = L["e"]
    pp = ee_p[(~ee_p["propia"]) & ((ee_p["por_liquidar"] > 0) | (ee_p["por_causar"] > 0))].copy()
    pp["monto"] = (pp["por_liquidar"] + pp["por_causar"]).round(0)
    pp["tipo"] = np.where(pp["por_liquidar"] > 0, "liquidar", "causar")
    pp["edad"] = pp["edad"].fillna(0).astype(int)
    pp = pp[pp["afn"].isin(set(cja["afn"]))].copy()
    for c_ in ("fecha", "fcump"):
        pp[c_] = pd.to_datetime(pp[c_], errors="coerce").dt.strftime("%Y-%m-%d")
    pp = pp[["afn", "eid", "placa", "afiliado", "cliente", "origen", "destino", "fecha", "fcump", "edad", "compra", "ant", "pagado", "monto",
             "tipo", "estado", "cumplido", "oper"]]
    mm = cx.merge(ee_p[["eid", "fecha"]], on="eid", how="left")
    lagd = (mm["f_fac"] - mm["fecha"]).dt.days
    lagd = lagd[(lagd >= 0) & (lagd <= 90) & (mm["f_fac"] >= L["corte_cxp"] - pd.Timedelta(days=90))]
    lag_fact = (dict(p50=float(lagd.quantile(.5)), p75=float(lagd.quantile(.75)), p90=float(lagd.quantile(.9)), n=int(len(lagd)))
                if len(lagd) >= 30 else dict(p50=7.0, p75=12.0, p90=20.0, n=int(len(lagd))))
    # --- como vienes pagando: todo lo que sale por semana (anticipos, saldos, proveedores) frente a lo que se te vence cada semana
    pvx = L["pv"].copy()
    pvx["sem"] = pvx["fecha_pago"].dt.to_period("W-SUN").dt.start_time
    lvn = cja["nivel"].astype(str).str[0].astype(int)
    act_n = set(cja.loc[((lvn >= 1) & (lvn <= 4)) | ((lvn == 0) & (cja["viajes30"] > 0)), "afn"])       # mismos afiliados que "los que cargan" en el flujo
    lag_plazo = int(round(lag_fact["p50"])) + 15                                                          # dias normales de facturar + plazo de pago
    tipo_pv = pvx["tipo"]
    es_sal, es_ant, es_prv = tipo_pv == "SALDO FLOTA", tipo_pv == "ANTICIPO FLOTA", tipo_pv.isin(["PROVEEDOR / GASTO", "ANTICIPO PROVEEDOR/OTRO"])
    sem_tab = pd.DataFrame({"ant": pvx[es_ant].groupby("sem")["importe"].sum(), "saldo": pvx[es_sal].groupby("sem")["importe"].sum(),
                            "saldo_act": pvx[es_sal & pvx["prov_n"].isin(act_n)].groupby("sem")["importe"].sum(),
                            "prov": pvx[es_prv].groupby("sem")["importe"].sum(), "otros": pvx[~(es_ant | es_sal | es_prv)].groupby("sem")["importe"].sum(),
                            "n_saldo": pvx[es_sal].groupby("sem").size(), "afil_saldo": pvx[es_sal].groupby("sem")["prov_n"].nunique()}).fillna(0)
    # lo que se vencio cada semana (estimado): saldo de cada viaje (96% de la compra menos el anticipo) a los dias normales de facturar + plazo
    trip_due = ee_p[(~ee_p["propia"]) & (ee_p["fecha"] >= L["pagos_desde"]) & (ee_p["compra"] > 0)].copy()
    trip_due["saldo_due"] = (trip_due["compra"] * FACTOR_PAGO - trip_due["ant"]).clip(lower=0)
    trip_due["sem"] = (trip_due["fecha"] + pd.Timedelta(days=lag_plazo)).dt.to_period("W-SUN").dt.start_time
    sem_tab["vence"] = trip_due.groupby("sem")["saldo_due"].sum()
    ini_p = L["pagos_desde"] + pd.Timedelta(days=(7 - L["pagos_desde"].weekday()) % 7)                    # primera semana completa del archivo de pagos
    ini_v = L["pagos_desde"] + pd.Timedelta(days=lag_plazo)
    ini_v = ini_v + pd.Timedelta(days=(7 - ini_v.weekday()) % 7)                                          # primera semana con todos sus viajes cargados
    sem_tab = sem_tab[sem_tab.index >= ini_p].sort_index()
    pagos_semana = [dict(sem=f"{i:%Y-%m-%d}", ant=float(r["ant"]), saldo=float(r["saldo"]), saldo_act=float(r["saldo_act"]), prov=float(r["prov"]), otros=float(r["otros"]),
                         n_saldo=int(r["n_saldo"]), afil_saldo=int(r["afil_saldo"]), vence=(float(r["vence"]) if (i >= ini_v and pd.notna(r["vence"])) else None))
                    for i, r in sem_tab.iterrows()]
    # plazo real: dias entre el viaje y el pago de su saldo (ponderado por importe), ultimas 8 semanas completas
    sem_act = hoy.to_period("W-SUN").start_time
    sal_pv = pvx[es_sal].copy()
    sal_pv["edad"] = (sal_pv["fecha_pago"] - sal_pv["envio_id"].map(ee_p.drop_duplicates("eid").set_index("eid")["fecha"])).dt.days
    sal_u8 = sal_pv[sal_pv["edad"].notna() & (sal_pv["edad"] >= 0) & (sal_pv["fecha_pago"] >= sem_act - pd.Timedelta(weeks=8)) & (sal_pv["fecha_pago"] < sem_act)]
    imp_u = float(sal_u8["importe"].sum())

    def _qp(q):
        o = np.argsort(sal_u8["edad"].values)
        xs, ws = sal_u8["edad"].values[o], sal_u8["importe"].values[o]
        return float(xs[min(int(np.searchsorted(np.cumsum(ws) / ws.sum(), q)), len(xs) - 1)])
    plazo_pago = (dict(p25=_qp(.25), p50=_qp(.5), p75=_qp(.75), p90=_qp(.9), n=int(len(sal_u8)), importe=imp_u, normal=lag_plazo,
                       pct_normal=float(sal_u8.loc[sal_u8["edad"] <= lag_plazo, "importe"].sum() / imp_u), pct_45=float(sal_u8.loc[sal_u8["edad"] > 45, "importe"].sum() / imp_u))
                  if imp_u > 0 else None)
    # los saldos se pagan en lotes: pocos dias concentran casi todo
    lot_dias = pvx[es_sal].groupby("fecha_pago").agg(importe=("importe", "sum"), pagos=("importe", "size"), afil=("prov_n", "nunique")).sort_values("importe", ascending=False)
    tot_s = float(lot_dias["importe"].sum())
    lotes_saldo = dict(dias=int(len(lot_dias)), total=tot_s, dias_80=(int((lot_dias["importe"].cumsum() / tot_s <= .8).sum() + 1) if tot_s > 0 else 0),
                       top=[dict(fecha=f"{i:%Y-%m-%d}", importe=float(r["importe"]), pagos=int(r["pagos"]), afil=int(r["afil"])) for i, r in lot_dias.head(5).iterrows()])
    # alcance real: de los afiliados que cargan y tienen vencido, a cuantos se les pago algun saldo en las ultimas 4 semanas completas
    pag4 = set(pvx[es_sal & (pvx["fecha_pago"] >= sem_act - pd.Timedelta(weeks=4)) & (pvx["fecha_pago"] < sem_act)]["prov_n"])
    con_v = cja[(cja["venc_libre"] > 0) & cja["afn"].isin(act_n)]
    alcance_pago = dict(con_vencido=int(len(con_v)), pagados=int(con_v["afn"].isin(pag4).sum()), sin_pago=int((~con_v["afn"].isin(pag4)).sum()),
                        venc_sin_pago=float(con_v.loc[~con_v["afn"].isin(pag4), "venc_libre"].sum()))
    # --- afiliados que frenaron: tenian 3+ viajes en (hoy-51d, hoy-21d] y su ritmo semanal de los ultimos 21 dias cayo a 40% o menos (o a cero)
    fg_e = ee_p[(~ee_p["propia"])].copy()
    fg_prev = fg_e[(fg_e["fecha"] > hoy - pd.Timedelta(days=51)) & (fg_e["fecha"] <= hoy - pd.Timedelta(days=21))]
    fg_now = fg_e[fg_e["fecha"] > hoy - pd.Timedelta(days=21)]
    fg_a = fg_prev.groupby("afn").agg(v_antes=("eid", "nunique"), compra_antes=("compra", "sum"), ult_viaje_antes=("fecha", "max"))
    fg_a["v_ahora"] = fg_now.groupby("afn")["eid"].nunique()
    fg_a["compra_ahora"] = fg_now.groupby("afn")["compra"].sum()
    fg_a = fg_a.fillna({"v_ahora": 0, "compra_ahora": 0})
    fg_a = fg_a[(fg_a["v_antes"] >= 3) & ((fg_a["v_ahora"] / 3.0) <= 0.4 * (fg_a["v_antes"] / (30 / 7.0)))].reset_index()
    fg_a["compra_sem_antes"] = fg_a["compra_antes"] / (30 / 7.0)
    fg_a["compra_sem_ahora"] = fg_a["compra_ahora"] / 3.0
    fg_cli = fg_prev.sort_values("compra", ascending=False).drop_duplicates("afn").set_index("afn")["cliente"]
    fg_sal = pvx[es_sal].groupby("prov_n")["fecha_pago"].max()
    fg_a = fg_a.merge(cja[["afn", "afiliado", "nivel", "venc_libre", "dias_sin_viaje"]], on="afn", how="left")
    fg_a["cliente"] = fg_a["afn"].map(fg_cli).fillna("")
    fg_a["dias_sin_saldo"] = (hoy - fg_a["afn"].map(fg_sal)).dt.days
    fg_a["afiliado"] = fg_a["afiliado"].fillna(fg_a["afn"])
    fg_a["nivel"] = fg_a["nivel"].fillna("0-SIN SALDO")
    fg_a["venc_libre"] = fg_a["venc_libre"].fillna(0)
    fg_a["ult_viaje_antes"] = fg_a["ult_viaje_antes"].dt.strftime("%Y-%m-%d")
    fg_a = fg_a.sort_values("compra_antes", ascending=False)
    fg_a = fg_a[["afn", "afiliado", "nivel", "cliente", "v_antes", "v_ahora", "compra_sem_antes", "compra_sem_ahora", "venc_libre", "dias_sin_saldo", "dias_sin_viaje", "ult_viaje_antes"]].round(0)
    fuga = json.loads(fg_a.to_json(orient="records", force_ascii=False))
    # --- dinero atascado por tramites: saldo estimado sin factura (con cumplido SI o pendiente) y facturas retenidas, por afiliado
    tr_e = ee_p[(~ee_p["propia"]) & (ee_p["estado"] == "COMPLETADO") & (ee_p["por_liquidar"] > 0) & (ee_p["edad"] > 7)].copy()
    tr_e["liq_si"] = np.where(tr_e["cumplido"] == "SI", tr_e["por_liquidar"], 0.0)
    tr_e["liq_pend"] = np.where(tr_e["cumplido"] != "SI", tr_e["por_liquidar"], 0.0)
    tr_e["n_si"] = (tr_e["cumplido"] == "SI").astype(int)
    tr_e["n_pend"] = (tr_e["cumplido"] != "SI").astype(int)
    tr_a = tr_e.groupby("afn").agg(liq_si=("liq_si", "sum"), n_si=("n_si", "sum"), liq_pend=("liq_pend", "sum"), n_pend=("n_pend", "sum"))
    tr_r = cx[cx["ret_activa"]].copy()
    tr_r["dias_ret"] = (L["corte_cxp"] - tr_r["f_ret"]).dt.days
    tr_ra = tr_r.groupby("prov_n").agg(retenido=("imp", "sum"), dias_ret=("dias_ret", "max"), n_ret=("fac", "size"))
    tr_ra["mot_ret"] = tr_r.groupby(["prov_n", "mot_ret"])["imp"].sum().reset_index().sort_values("imp", ascending=False).drop_duplicates("prov_n").set_index("prov_n")["mot_ret"]
    tr_a = tr_a.join(tr_ra, how="outer").fillna({"liq_si": 0, "n_si": 0, "liq_pend": 0, "n_pend": 0, "retenido": 0, "n_ret": 0, "dias_ret": 0, "mot_ret": ""}).reset_index().rename(columns={"index": "afn"})
    tr_a = tr_a.merge(cja[["afn", "afiliado", "nivel"]], on="afn", how="inner")
    tr_a["activo"] = tr_a["afn"].isin(act_n).astype(int)
    tr_a["total"] = tr_a["liq_si"] + tr_a["liq_pend"] + tr_a["retenido"]
    tr_a = tr_a[tr_a["total"] > 0].sort_values("total", ascending=False)
    tr_a["mot_ret"] = tr_a["mot_ret"].astype(str)
    tr_a = tr_a[["afn", "afiliado", "nivel", "activo", "liq_si", "n_si", "liq_pend", "n_pend", "retenido", "n_ret", "mot_ret", "dias_ret", "total"]].round(0)
    tramites = json.loads(tr_a.to_json(orient="records", force_ascii=False))
    data = dict(
        fuga=fuga, tramites=tramites,
        prioridades=pri_filas, prio_meta=pri_meta, pipeline=json.loads(pp.to_json(orient="records", force_ascii=False)),
        lag_fact=lag_fact, pagos_semana=pagos_semana, plazo_pago=plazo_pago, lotes_saldo=lotes_saldo, alcance_pago=alcance_pago,
        caja=caja, caja_cli=json.loads(ccj.to_json(orient="records", force_ascii=False)),
        facturas_af=json.loads(fc.to_json(orient="records", force_ascii=False)),
        viajes_mes_det=json.loads(vq.sort_values("fecha", ascending=False).to_json(orient="records", force_ascii=False)),
        piv=piv, clientes=json.loads(gcl.to_json(orient="records", force_ascii=False)), n_multi=n_multi,
        flota_cli=json.loads(fa.to_json(orient="records", force_ascii=False)),
        flota_viajes=json.loads(fv.to_json(orient="records", force_ascii=False)),
        flota_manif=json.loads(fm.to_json(orient="records", force_ascii=False)),
        meta=dict(mes=f"{L['mes_ini']:%Y-%m}", hoy=f"{hoy:%d/%m/%Y}", pagos_hasta=f"{L['pv']['fecha_pago'].max():%d/%m/%Y}",
                  viajes_hasta=f"{L['v']['Fecha Creacion'].max():%d/%m/%Y}", corte_cxp=f"{L['corte_cxp']:%d/%m/%Y}",
                  dias_sin_rotar=DIAS_SIN_ROTAR, pagos_desde=f"{L['pagos_desde']:%Y-%m}"),
        kpis={k: float(v) for k, v in kp.items()},
        pagos_dia=json.loads(pdia.to_json(orient="records")),
        dias=json.loads(dd.to_json(orient="records")), edad=edad_d,
        pagos_tipo=json.loads(gt.to_json(orient="records", force_ascii=False)),
        pagos_cruce=json.loads(gc.to_json(orient="records", force_ascii=False)),
        pagos=_recs(pg, ["fecha_pago", "factura", "grupo", "tipo", "categoria", "proveedor", "placa", "estado_cruce", "importe", "estado_pago"],
                    {"fecha_pago": "fecha", "estado_cruce": "cruce", "estado_pago": "estado"}),
        prov_cat=json.loads(pcat.to_json(orient="records", force_ascii=False)),
        cartera=car,
        pend_afiliados=_recs(pa, ["prioridad", "afiliado", "n", "total", "vencido", "v90", "retenido", "max_dias"]),
        pend_prov=_recs(pp_, ["tipo", "proveedor", "n", "total", "vencido", "vreal", "retenido", "max_dias"]),
        afiliados=_recs(afil, cols_a), placas=_recs(placas, cols_p),
        alertas_res=json.loads(ares.to_json(orient="records", force_ascii=False)),
        alertas=_recs(al, ["alerta", "envio", "placa", "quien", "fecha", "valor", "detalle"]),
        prioridad_resumen=json.loads(pres.to_json(orient="records", force_ascii=False)),
        viajes_estado=json.loads(ve.to_json(orient="records", force_ascii=False)),
        anticipos=json.loads(antic.to_json(orient="records", force_ascii=False)),
        viajes_op=json.loads(vop.to_json(orient="records", force_ascii=False)),
        viajes_afil=json.loads(vaf.to_json(orient="records", force_ascii=False)),
    )
    txt = json.dumps(data, ensure_ascii=False).replace("</", "<\\/").replace(" ", " ").replace(" ", " ")
    with open(os.path.join(AQUI, "dashboard_plantilla.html"), encoding="utf-8") as f:
        html = f.read()
    # la plantilla se arma con las partes de dashboard_partes\ (estilos, nucleo y una por pestana)
    html = re.sub(r"<!--@incluir:(.+?)-->", lambda m: open(os.path.join(AQUI, "dashboard_partes", m.group(1).strip()), encoding="utf-8").read(), html)
    destino = os.path.join(AQUI, "DASHBOARD.html")
    with open(destino, "w", encoding="utf-8") as f:
        f.write(html.replace("/*__DATA__*/null", txt))
    if PUBLICAR_EN:                                  # copia para Carlos y los analistas (carpeta compartida)
        try:
            shutil.copy2(destino, os.path.join(PUBLICAR_EN, "DASHBOARD.html"))
            log(f"Dashboard copiado a {PUBLICAR_EN}")
        except OSError as ex:
            log(f"No se pudo copiar el dashboard a {PUBLICAR_EN}: {ex}")
    return destino


# ----------------------------------------------------------------------------- EXCEL (opcional: --excel)
HDR = PatternFill("solid", fgColor="1F3864")
COLORES = {"1": "F8CBAD", "2": "FFE699", "3": "FFF2CC", "4": "D9D9D9", "5": "DDEBF7", "6": "E2EFDA", "7": "F4B183"}
MONEDA = '#,##0;[Red]-#,##0'


def hoja_df(wb, nombre, df, anchos=None, fmt=None, color_col=None, titulo=None):
    ws = wb.create_sheet(nombre)
    fila0 = 1
    if titulo:
        ws.cell(1, 1, titulo).font = Font(bold=True, size=12)
        fila0 = 3
    for j, c in enumerate(df.columns, 1):
        cell = ws.cell(fila0, j, c)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = HDR
        cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    ws.row_dimensions[fila0].height = 32
    fmt = fmt or {}
    cols = list(df.columns)
    for i, row in enumerate(df.itertuples(index=False), fila0 + 1):
        for j, val in enumerate(row, 1):
            if isinstance(val, pd.Timestamp):
                val = None if pd.isna(val) else val.to_pydatetime()
            elif isinstance(val, (np.integer,)):
                val = int(val)
            elif isinstance(val, (np.floating, float)):
                val = None if np.isnan(val) else float(val)
            elif isinstance(val, (np.bool_,)):
                val = bool(val)
            elif val is pd.NaT or val is None:
                val = None
            cell = ws.cell(i, j, val)
            f = fmt.get(cols[j - 1])
            if f:
                cell.number_format = f
        if color_col is not None:
            col = COLORES.get(str(row[cols.index(color_col)])[:1])
            if col:
                ws.cell(i, cols.index(color_col) + 1).fill = PatternFill("solid", fgColor=col)
    ws.freeze_panes = ws.cell(fila0 + 1, 3 if len(cols) > 3 else 1)
    ws.auto_filter.ref = f"A{fila0}:{get_column_letter(len(cols))}{fila0 + len(df)}"
    for j, c in enumerate(cols, 1):
        ws.column_dimensions[get_column_letter(j)].width = (anchos or {}).get(c, max(12, min(40, len(str(c)) + 4)))
    return ws


def grupo_retencion(m):
    """El motivo de retencion es texto libre: se agrupa por palabras clave."""
    t = norm(m) if isinstance(m, str) else ""
    for claves, g in [(["PNC", "PRONISION", "PROVISI", "PROVSION", "PRPOVISION"], "Provision PNC"),
                      (["EMPACOR"], "Empacor paga directamente"),
                      (["ANTICIPO"], "Error al aplicar anticipo (revisar ANT)"),
                      (["VIRT", "VITUAL", "VIRAUL", "SIN SOPORTE", "SIN DOC", "SOPORTE", "ORIGINAL", "DOCUMENT", "LEGALIZAR", "CUMPLID"], "Cumplido virtual / soportes pendientes"),
                      (["BLOQUEO", "LIQUIDACION", "ERROR"], "Bloqueo / error de liquidacion"),
                      (["AJOVER", "PQR", "NOVEDAD", "DANO", "FIRMA", "DOBLE", "NO SE DEBE"], "Novedades / reclamos / revision")]:
        if any(c in t for c in claves):
            return g
    return "Otros / sin motivo"


def escribir_excel(path, L):
    hoy, mes_ini = L["hoy"], L["mes_ini"]
    placas, afil, e, pm, vm, alertas, prov = (L[k] for k in ["placas", "afil", "e", "pm", "viajes_mes", "alertas", "prov"])
    ventana, cx, cxp_all = L["ventana"], L["cx"], L["cxp_all"]
    wb = Workbook()
    wb.remove(wb.active)

    # ---------- RESUMEN
    ws = wb.create_sheet("RESUMEN")
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 52
    for c in "BCDEFG":
        ws.column_dimensions[c].width = 20
    r = [1]

    def titulo(txt):
        r[0] += 1
        ws.cell(r[0], 1, txt).font = Font(bold=True, size=12, color="FFFFFF")
        for j in range(1, 8):
            ws.cell(r[0], j).fill = HDR
        r[0] += 1

    def linea(*vals, fmts=None, bold=False):
        for j, val in enumerate(vals, 1):
            if isinstance(val, np.integer):
                val = int(val)
            if isinstance(val, np.floating):
                val = float(val)
            c = ws.cell(r[0], j, val)
            c.font = Font(bold=bold)
            if fmts and j - 1 < len(fmts) and fmts[j - 1]:
                c.number_format = fmts[j - 1]
        r[0] += 1

    ws.cell(1, 1, f"SEGUIMIENTO DE FLOTA Y PAGOS NACIONAL - {mes_ini:%B %Y}".upper()).font = Font(bold=True, size=14)
    linea(f"Corte: {hoy:%d/%m/%Y}", f"Pagos hasta: {L['pv']['fecha_pago'].max():%d/%m/%Y}",
          f"Viajes hasta: {L['v']['Fecha Creacion'].max():%d/%m/%Y}", f"CXP al: {L['corte_cxp']:%d/%m/%Y}")
    ws.cell(r[0], 1, "Pagos 'Negociable' = girados sin conciliar (se cuentan como pagados); 'Anulado' se excluye. "
                     "El saldo pendiente sale del CXP (facturas abiertas), no de una estimacion.").font = Font(italic=True)
    r[0] += 1

    titulo("1. PAGOS DEL MES (por tipo)")
    linea("Tipo", "# pagos", "Importe", bold=True)
    gt = pm.groupby("tipo").agg(n=("factura", "size"), imp=("importe", "sum")).sort_values("imp", ascending=False)
    for t, row in gt.iterrows():
        linea(t, row["n"], row["imp"], fmts=[None, "#,##0", MONEDA])
    linea("TOTAL", int(gt["n"].sum()), gt["imp"].sum(), fmts=[None, "#,##0", MONEDA], bold=True)
    fl = pm[pm["es_flota"]]
    linea("  de los cuales FLOTA (afiliados)", len(fl), fl["importe"].sum(), fmts=[None, "#,##0", MONEDA])
    linea("  de los cuales PROVEEDORES / otros", len(pm) - len(fl), pm[~pm["es_flota"]]["importe"].sum(), fmts=[None, "#,##0", MONEDA])

    titulo("2. VIAJES DEL MES (a nivel manifiesto = suma de lineas)")
    vnp = vm[~vm["propia"]]
    linea("Manifiestos / envios", len(vm), bold=True)
    linea("  flota propia (no se paga)", int(vm["propia"].sum()))
    linea("Compra total (a pagar a afiliados)", vnp["compra"].sum(), fmts=[None, MONEDA])
    linea("Venta total (a facturar)", vm["venta"].sum(), fmts=[None, MONEDA])
    linea("Utilidad", vm["utilidad"].sum(), fmts=[None, MONEDA])
    linea("Pagado de esos viajes (ANT + saldo + desc.)", vnp["pagado"].sum(), fmts=[None, MONEDA])
    linea("  cobertura de pago sobre compra", (vnp["pagado"].sum() / vnp["compra"].sum()) if vnp["compra"].sum() else 0, fmts=[None, "0.0%"])
    linea("Viajes completados / en ruta / por iniciar", f"{(vm['estado'] == 'COMPLETADO').sum()} / {(vm['estado'] == 'EN RUTA').sum()} / {(vm['estado'] == 'POR INICIAR').sum()}")
    linea("Estado de pago de los viajes del mes", "# viajes", "Compra", "Pagado", "Saldo abierto CXP", bold=True)
    for est, d in vnp.groupby("estado_pago_viaje"):
        linea(est, len(d), d["compra"].sum(), d["pagado"].sum(), d["cxp_libre"].sum() + d["cxp_ret"].sum(), fmts=[None, "#,##0", MONEDA, MONEDA, MONEDA])

    titulo(f"3. CARTERA POR PAGAR A AFILIADOS (CXP al {L['corte_cxp']:%d/%m})")
    linea("Facturas de saldo abiertas", len(cx), cx["imp"].sum(), fmts=[None, "#,##0", MONEDA], bold=True)
    linea("  libres para pagar", int((~cx["ret_activa"]).sum()), cx["libre"].sum(), fmts=[None, "#,##0", MONEDA])
    linea("  retenidas (bloqueadas)", int(cx["ret_activa"].sum()), cx["retenido"].sum(), fmts=[None, "#,##0", MONEDA])
    linea("  ya pagadas despues del corte del CXP (excluidas)", L["n_post"], L["imp_post"], fmts=[None, "#,##0", MONEDA])
    sc = L["solo_cxp"]
    linea("  de afiliados SIN ningun pago ANT/M en 2026 (solo deuda)", sc["prov_n"].nunique(), sc["imp"].sum(), fmts=[None, "#,##0", MONEDA])
    linea("Vencimiento (saldo libre)", "# facturas", "Saldo", bold=True)
    lib = cx[~cx["ret_activa"]]
    for lo, hi, nom in [(0, 0, "No vencido"), (1, 30, "1-30 dias"), (31, 60, "31-60 dias"), (61, 90, "61-90 dias"), (91, 180, "91-180 dias"), (181, 99999, "mas de 180 dias")]:
        d = lib[(lib["dias_venc"] >= lo) & (lib["dias_venc"] <= hi)]
        linea(nom, len(d), d["imp"].sum(), fmts=[None, "#,##0", MONEDA])
    linea("Motivo de retencion activa", "# facturas", "Saldo", bold=True)
    for mot, d in cx[cx["ret_activa"]].groupby(cx["mot_ret"].map(grupo_retencion)):
        linea(mot, len(d), d["imp"].sum(), fmts=[None, "#,##0", MONEDA])

    titulo("4. PRIORIDAD DE PAGO POR AFILIADO (saldo libre del CXP + rotacion de sus placas)")
    linea("Prioridad", "# afiliados", "Saldo libre", "Vencido >90d", "Retenido", "Pagado en el mes", bold=True)
    for pr, d in afil.groupby("prioridad"):
        linea(pr, len(d), d["exigible"].sum(), d["venc90"].sum(), d["retenido"].sum(), d["pagado_mes"].sum(),
              fmts=[None, "#,##0", MONEDA, MONEDA, MONEDA, MONEDA])
    linea("Por liquidar (viajes terminados sin factura de saldo)", "", afil["por_liquidar"].sum(), fmts=[None, None, MONEDA])
    linea("Por causar (viajes en ruta)", "", afil["por_causar"].sum(), fmts=[None, None, MONEDA])
    linea("Por liquidar segun estado del cumplido (hoja Operacion general)", "# viajes", "Saldo estimado", bold=True)
    pl_ = ventana[ventana["por_liquidar"] > 0]
    for cum, d in pl_.groupby("cumplido"):
        linea(cum, len(d), d["por_liquidar"].sum(), fmts=[None, "#,##0", MONEDA])
    linea("Rezago: dias vencidos (mediana / p75 del saldo libre)", f"{lib['dias_venc'].median():.0f} d", f"{lib['dias_venc'].quantile(.75):.0f} d")

    titulo("5. PAGADO SIN ROTACION (pagaste en el mes y no vuelven a cargar)")
    ps = placas[placas["pagado_sin_rotar"]]
    linea(f"Placas pagadas y sin cargar hace >= {DIAS_SIN_ROTAR} dias", len(ps), ps["pagado_mes"].sum(), fmts=[None, "#,##0", MONEDA], bold=True)
    pa = afil[afil["pagado_sin_rotar"]]
    linea("Afiliados en esa situacion", len(pa), pa["pagado_mes"].sum(), fmts=[None, "#,##0", MONEDA])

    titulo("6. TOP 15 AFILIADOS PARA PAGAR YA")
    linea("Afiliado", "Placas rotando", "Viajes 15d", "Dias sin viaje", "Saldo libre", "Vencido >90d", bold=True)
    for _, x in afil[afil["_pr"] == 1].head(15).iterrows():
        linea(x["afiliado"], x["placas_rotando"], x["v15"], x["dias_sin_viaje"], x["exigible"], x["venc90"],
              fmts=[None, "#,##0", "#,##0", "#,##0", MONEDA, MONEDA])

    titulo("7. CARTERA POR PAGAR - OTROS TIPOS (proveedores, impuestos, etc.)")
    linea("Tipo (segun CXP)", "# facturas", "Impagado", "Vencido >90d", bold=True)
    co = L["cxp_all"][L["cxp_all"]["tipo"] != "AFILIADOS"]
    for t, d in co.groupby("tipo"):
        linea(t, len(d), d["imp"].sum(), d.loc[d["dias_venc"] > 90, "imp"].sum(), fmts=[None, "#,##0", MONEDA, MONEDA])

    titulo("8. ALERTAS")
    for a, n in alertas["Alerta"].value_counts().items():
        linea(a, n)

    # ---------- AFILIADOS (vista principal de pago)
    a2 = afil[["prioridad", "accion", "afiliado", "rotacion", "n_placas", "placas_rotando", "v7", "v15", "v30", "en_ruta", "por_iniciar",
               "ultimo_viaje", "dias_sin_viaje", "viajes_mes", "compra_mes", "pagado_mes", "ultimo_pago", "exigible", "venc90", "retenido",
               "n_facturas", "por_liquidar", "por_causar"]].copy()
    a2["dias_sin_viaje"] = a2["dias_sin_viaje"].where(a2["dias_sin_viaje"] < 9999)
    a2.columns = ["Prioridad", "Accion sugerida", "Afiliado", "Rotacion", "# placas (30d)", "Placas rotando", "Viajes 7d", "Viajes 15d",
                  "Viajes 30d", "En ruta", "Por iniciar", "Ultimo viaje", "Dias sin viaje", "Viajes mes", "Compra mes", "Pagado mes",
                  "Ultimo pago", "Saldo libre CXP", "de ese, vencido >90d", "Retenido (bloqueado)", "# facturas abiertas",
                  "Por liquidar (sin factura)", "Por causar (en ruta)"]
    ma = {c: MONEDA for c in ["Compra mes", "Pagado mes", "Saldo libre CXP", "de ese, vencido >90d", "Retenido (bloqueado)", "Por liquidar (sin factura)", "Por causar (en ruta)"]}
    ma.update({"Ultimo viaje": "dd/mm/yyyy", "Ultimo pago": "dd/mm/yyyy"})
    hoja_df(wb, "AFILIADOS", a2, anchos={"Accion sugerida": 75, "Afiliado": 40, "Prioridad": 26}, fmt=ma, color_col="Prioridad")

    pl = placas[["prioridad", "accion", "placa", "afiliado", "rotacion", "v7", "v15", "v30", "en_ruta", "por_iniciar", "ultimo_viaje",
                 "dias_sin_viaje", "viajes_mes", "compra_mes", "venta_mes", "utilidad_mes", "margen", "ant_mes", "saldo_mes", "pp_mes",
                 "pagado_mes", "ultimo_pago", "exigible", "venc90", "retenido", "por_liquidar", "por_causar"]].copy()
    pl["dias_sin_viaje"] = pl["dias_sin_viaje"].where(pl["dias_sin_viaje"] < 9999)
    pl.columns = ["Prioridad", "Accion sugerida", "Placa", "Afiliado", "Rotacion", "Viajes 7d", "Viajes 15d", "Viajes 30d", "En ruta",
                  "Por iniciar", "Ultimo viaje", "Dias sin viaje", "Viajes mes", "Compra mes", "Venta mes", "Utilidad mes", "Margen %",
                  "Anticipos pagados mes", "Saldos pagados mes", "Desc. pronto pago", "Total pagado mes", "Ultimo pago",
                  "Saldo libre CXP (de esta placa)", "de ese, vencido >90d", "Retenido (bloqueado)", "Por liquidar (sin factura)", "Por causar (en ruta)"]
    m = {c: MONEDA for c in pl.columns if any(k in c for k in ["Compra", "Venta", "Utilidad", "pagados", "pronto", "Total", "Saldo", "vencido", "Retenido", "Anticipos", "Por liquidar", "Por causar"])}
    m.update({"Margen %": "0.0%", "Ultimo viaje": "dd/mm/yyyy", "Ultimo pago": "dd/mm/yyyy"})
    hoja_df(wb, "PRIORIDAD_PLACAS", pl, anchos={"Accion sugerida": 75, "Afiliado": 34, "Prioridad": 26}, fmt=m, color_col="Prioridad",
            titulo="Saldo por placa = facturas M<envio> abiertas en CXP cuyo viaje se pudo ligar a la placa. El saldo sin placa (viajes antiguos) esta en la hoja AFILIADOS.")

    ps2 = placas[placas["pagado_sin_rotar"]][["placa", "afiliado", "ultimo_viaje", "dias_sin_viaje", "ultimo_pago", "ant_mes", "saldo_mes", "pagado_mes", "exigible"]]
    ps2.columns = ["Placa", "Afiliado", "Ultimo viaje", "Dias sin viaje", "Ultimo pago", "Anticipos mes", "Saldos mes", "Total pagado mes", "Saldo libre CXP"]
    hoja_df(wb, "PAGADO_SIN_ROTACION", ps2.sort_values("Total pagado mes", ascending=False), anchos={"Afiliado": 36},
            fmt={"Ultimo viaje": "dd/mm/yyyy", "Ultimo pago": "dd/mm/yyyy", "Anticipos mes": MONEDA, "Saldos mes": MONEDA,
                 "Total pagado mes": MONEDA, "Saldo libre CXP": MONEDA})

    vv = ventana.sort_values("fecha", ascending=False)[["eid", "fecha", "placa", "afiliado", "cliente", "origen", "destino", "estado", "lineas",
                                                       "venta", "compra", "utilidad", "ant", "saldo", "pp", "pagado", "estado_pago_viaje",
                                                       "cxp_libre", "cxp_ret", "por_liquidar", "por_causar", "edad", "ult_pago", "cumplido", "fcump"]]
    vv.columns = ["Envio (manifiesto)", "Fecha", "Placa", "Afiliado", "Cliente", "Origen", "Destino", "Estado viaje", "Lineas", "A facturar (venta)",
                  "A pagar (compra)", "Utilidad", "Anticipo", "Saldo pagado", "Desc. PP", "Pagado", "Estado de pago", "Saldo abierto CXP libre",
                  "Saldo abierto CXP retenido", "Por liquidar", "Por causar", "Edad (d)", "Ultimo pago", "Cumplido", "Fecha cumplido"]
    hoja_df(wb, "VIAJES", vv, anchos={"Afiliado": 32, "Cliente": 30, "Estado de pago": 38},
            fmt={**{c: MONEDA for c in ["A facturar (venta)", "A pagar (compra)", "Utilidad", "Anticipo", "Saldo pagado", "Desc. PP", "Pagado",
                                        "Saldo abierto CXP libre", "Saldo abierto CXP retenido", "Por liquidar", "Por causar"]},
                 "Fecha": "dd/mm/yyyy", "Ultimo pago": "dd/mm/yyyy", "Fecha cumplido": "dd/mm/yyyy"})

    fa =cx.sort_values("imp", ascending=False)[["fac", "proveedor", "placa", "estado", "f_fac", "vence", "dias_venc", "imp", "ret_activa", "mot_ret"]].copy()
    fa["ret_activa"] = fa["ret_activa"].map({True: "RETENIDA", False: "libre"})
    fa.columns = ["Factura", "Afiliado", "Placa", "Estado", "Fecha factura", "Vence", "Dias vencida", "Importe impagado", "Retencion", "Motivo retencion"]
    hoja_df(wb, "CXP_AFILIADOS", fa, anchos={"Afiliado": 40, "Motivo retencion": 50},
            fmt={"Fecha factura": "dd/mm/yyyy", "Vence": "dd/mm/yyyy", "Importe impagado": MONEDA})

    pp = pm.sort_values("fecha_pago", ascending=False)[["fecha_pago", "factura", "tipo", "categoria", "tipo_cxp", "proveedor", "envio_id", "placa",
                                                       "afiliado", "estado_cruce", "importe", "estado_pago", "doc_pago", "usuario"]]
    pp.columns = ["Fecha pago", "Factura / referencia", "Tipo de pago", "Categoria", "Tipo en CXP", "Proveedor / beneficiario", "Envio", "Placa",
                  "Afiliado del viaje", "Cruce con viaje", "Importe", "Estado", "Documento de pago", "Usuario"]
    hoja_df(wb, "PAGOS_MES", pp, anchos={"Proveedor / beneficiario": 38, "Afiliado del viaje": 32, "Tipo de pago": 26, "Categoria": 26, "Factura / referencia": 22},
            fmt={"Fecha pago": "dd/mm/yyyy", "Importe": MONEDA})

    pr2 = prov[["categoria", "tipo_cxp", "proveedor", "tipo", "pagos", "importe", "ultimo_pago"]].copy()
    pr2.columns = ["Categoria (por nombre)", "Tipo en CXP", "Proveedor", "Tipo de pago", "# pagos", "Importe", "Ultimo pago"]
    hoja_df(wb, "PROVEEDORES_MES", pr2, anchos={"Proveedor": 50, "Categoria (por nombre)": 28, "Tipo en CXP": 20, "Tipo de pago": 28},
            fmt={"Importe": MONEDA, "Ultimo pago": "dd/mm/yyyy"})

    cp = L["cxp_prov"].copy()
    cp.columns = ["Tipo (CXP)", "Proveedor", "# facturas", "Impagado", "Vencido >90d", "Max dias vencida"]
    hoja_df(wb, "CXP_PROVEEDORES", cp, anchos={"Proveedor": 55, "Tipo (CXP)": 18},
            fmt={"Impagado": MONEDA, "Vencido >90d": MONEDA})

    sg = L["sin_reg"].copy()
    sg.columns = ["Afiliado", "Placa", "Viajes 30d", "Ultimo viaje", "Compra 30d", "Venta 30d"]
    hoja_df(wb, "SIN_MOVIMIENTO_PAGO", sg, anchos={"Afiliado": 44},
            fmt={"Ultimo viaje": "dd/mm/yyyy", "Compra 30d": MONEDA, "Venta 30d": MONEDA},
            titulo="Afiliados con viajes que NO tienen ningun pago de flota en 2026 ni saldo abierto en CXP (revisar si se pagan por otro lado o hay problema de nombre).")

    hoja_df(wb, "ALERTAS", alertas, anchos={"Alerta": 44, "Detalle": 90, "Afiliado / Proveedor": 36},
            fmt={"Fecha": "dd/mm/yyyy", "Valor": MONEDA})

    # ---------- REGLAS
    wr = wb.create_sheet("REGLAS")
    wr.column_dimensions["A"].width = 150
    reglas = [
        "DE DONDE SALE CADA COSA",
        "- Viajes: archivos NACIONAL. Viaje = envio/manifiesto; se suman todas las lineas (remisiones/entregas). A facturar = 'Envio venta (Total)'; A pagar = 'Envio compra (Total)'.",
        "- Pagos realizados: 'Analisis de pago - MV'. Anticipo = 'ANT_<envio>-00N'; Saldo = 'M<envio>'; Desc. pronto pago = 'PP_M<envio>' (negativo). El numero es el envio (TCL.<numero>).",
        "- Pendiente por pagar: archivo origen '14. Afiliados\\1.Retenciones y liberaciones de facturas.xlsx' (el que alimenta los informes CXP-AFILIADOS). Cada factura 'M<envio>' abierta = saldo adeudado al afiliado ('Importe impagado'). TIPO igual que en el query: M1*/M2* = AFILIADOS; DRAKMA = FINANCIERA; EMPACOR/AJOVER = CLIENTE; DIAN = IMPUESTOS; TRACTOCAR = PROPIO; resto = PROVEEDORES. Dias vencidos = fecha de ejecucion del reporte - vencimiento.",
        "- Cumplido / operacion: carpeta origen 'Automatizaciones\\Operacion general' (un Excel por mes; un envio por fila: NACIONAL/EXPO/CEDIS/IMPO, estado y fecha de cumplido). 'Resumen de pago Afiliados' solo toma los pagos de 'Analisis de pago - MV' y les agrega esa operacion, por eso no se lee ese libro.",
        "- Cumplido: SI = cumplido con soporte; NUEVO = aun sin cumplir; PEND = pendiente; VIRTUAL / SIN_DOC = cumplido sin soporte fisico (suelen quedar retenidos). El saldo solo se factura en CXP despues del cumplido.",
        "- Flota propia (Doc Afiliado 900503325) no genera pago y se excluye.",
        "- 'ANT 12', 'ANT1095', 'ANT2_OC_...' = anticipos a proveedores (no flota). Negativos / CARGUE_PAGO = cruces o descuentos. FE, OC_, LIB-, AR, CY, etc. = proveedores / gastos.",
        "- Tipo de proveedor: se toma la columna TIPO del CXP (AFILIADOS, PROVEEDORES, IMPUESTOS, FINANCIERA, PROPIO, CLIENTE...). Si el proveedor no esta en el CXP, se infiere por el nombre.",
        "- Pagos 'Negociable' = girados sin conciliar (cuentan como pagados); 'Compensado' = conciliados; 'Anulado' se excluye.",
        "",
        "SALDO A PAGAR",
        "- Saldo LIBRE = facturas abiertas sin retencion activa (retencion activa = tiene fecha de retencion y no fecha de liberacion). Saldo RETENIDO = bloqueado (PNC, cumplido virtual, soportes, etc.): no se puede pagar aun.",
        "- Si la factura M<envio> tiene un pago de saldo posterior al corte del CXP (>= 90% del importe), se excluye porque el CXP aun no lo refleja.",
        "- Afiliados que solo aparecen en el CXP (sin ningun ANT/M pagado en 2026) se miden unicamente por su saldo abierto: no se estima 'por liquidar' porque no hay forma de saber si sus viajes se pagan por otro medio.",
        f"- POR LIQUIDAR (solo afiliados con pagos en 2026) = viaje terminado, con compra cargada, sin factura abierta en CXP y pagado < {UMBRAL_CERRADO:.0%} de la compra: saldo estimado = compra x {FACTOR_PAGO:.0%} - pagado (estimacion). POR CAUSAR = igual pero viaje aun en ruta.",
        "",
        "PRIORIDAD (por afiliado y por placa)",
        f"- ROTA = 3+ viajes en 15 dias, o 2+ en 7 dias, o viaje en ruta/por iniciar (de los ultimos {DIAS_ACTIVO} dias). En afiliado se suman sus placas.",
        "- 1-PAGAR YA: saldo libre y rota (o cargo en los ultimos 7 dias).  2-ESTA SEMANA: ultimo viaje <= 15 dias.  3-PROGRAMAR: <= 30 dias.  4-NO PRIORIZAR: > 30 dias sin viaje.",
        "- 5-EN CURSO / POR LIQUIDAR: sin saldo libre pero con saldo futuro.  6-AL DIA: sin saldo abierto.",
        f"- 7-PAGADO SIN ROTAR: se le pago en el mes y lleva >= {DIAS_SIN_ROTAR} dias sin cargar y sin viaje activo (y no tiene saldo libre).",
        "",
        "LIMITES",
        "- Los pagos solo traen el nombre del proveedor (no NIT ni placa): la placa sale del envio. Pagos cuyo envio no esta en NACIONAL quedan 'SIN VIAJE EN REPORTE'.",
        "- El cruce afiliado CXP <-> viajes es por nombre normalizado; nombres distintos quedan como afiliados separados.",
        "- Facturas M antiguas (viajes de 2023-2025 sin archivo) no tienen placa: su saldo cuenta en AFILIADOS pero no en PRIORIDAD_PLACAS.",
    ]
    for i, t in enumerate(reglas, 1):
        c = wr.cell(i, 1, t)
        c.alignment = Alignment(wrap_text=True)
        if t.isupper():
            c.font = Font(bold=True)

    wb.move_sheet("RESUMEN", offset=-wb.index(wb["RESUMEN"]))
    wb.save(path)


if __name__ == "__main__":
    main()

