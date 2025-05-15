#!/usr/bin/env python
import os
import sys
import subprocess
import threading
import time
import signal
import argparse
import logging
from dotenv import load_dotenv
import uvicorn

# Colores para consola
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

# Lista de procesos para terminar al salir
processes = []

# Configurar logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

# Cargar variables de entorno
load_dotenv()

def print_banner():
    """Imprime un banner con información del proyecto."""
    print("\n" + "=" * 70)
    print(f"{Colors.BLUE}{Colors.BOLD}            GEMINI DOCKER AGENT - BACKEND{Colors.ENDC}")
    print("=" * 70 + "\n")
    print(f"{Colors.GREEN}Lanzando servicios backend...{Colors.ENDC}\n")

def run_docker_manager():
    """Ejecuta el servidor Docker Manager en un proceso separado."""
    print(f"{Colors.YELLOW}Iniciando Docker Manager en http://localhost:9000...{Colors.ENDC}")
    env = os.environ.copy()
    process = subprocess.Popen(
        [sys.executable, "docker_manager_app.py"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    processes.append(process)
    
    for line in iter(process.stdout.readline, ""):
        print(f"{Colors.BLUE}[Docker Manager]{Colors.ENDC} {line.strip()}")

def run_api_agent():
    """Ejecuta el API Agent en un proceso separado."""
    print(f"{Colors.YELLOW}Iniciando API Agent en http://localhost:8001...{Colors.ENDC}")
    env = os.environ.copy()
    process = subprocess.Popen(
        [sys.executable, "api_agent.py"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    processes.append(process)
    
    for line in iter(process.stdout.readline, ""):
        print(f"{Colors.GREEN}[API Agent]{Colors.ENDC} {line.strip()}")

def signal_handler(sig, frame):
    """Maneja la señal de interrupción para terminar todos los procesos."""
    print(f"\n{Colors.YELLOW}Terminando todos los servicios...{Colors.ENDC}")
    for process in processes:
        try:
            process.terminate()
        except:
            pass
    sys.exit(0)

def main():
    """Función principal para ejecutar el backend API del agente."""
    parser = argparse.ArgumentParser(description="Ejecutar el backend API del agente")
    
    # Argumentos
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host para el servidor")
    parser.add_argument("--port", type=int, default=int(os.getenv("API_PORT", 8001)), help="Puerto para el servidor")
    parser.add_argument("--reload", action="store_true", help="Activar modo de recarga automática")
    
    args = parser.parse_args()
    
    # Verificar API key
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        log.warning("⚠️ No se ha configurado la API key de Google Gemini.")
        log.warning("Configure la variable de entorno GOOGLE_API_KEY o añádala en un archivo .env")
    else:
        log.info("✓ Google API Key configurada correctamente")
    
    # Mostrar modelo configurado
    model = os.getenv("DEFAULT_MODEL", "gemini-2.5-flash-preview-04-17")
    log.info(f"Usando modelo: {model}")
    
    # Verificar URL del Docker Manager
    docker_manager_url = os.getenv("DOCKER_MANAGER_URL", "http://127.0.0.1:9001")
    log.info(f"Docker Manager URL: {docker_manager_url}")
    
    # Ejecutar la API
    log.info(f"Iniciando servidor API en {args.host}:{args.port}")
    uvicorn.run("api_agent:app", host=args.host, port=args.port, reload=args.reload)

if __name__ == "__main__":
    main() 