#!/usr/bin/env python
import os
import sys
import subprocess
import threading
import time
import signal

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
    print_banner()
    
    # Registrar el manejador de señales
    signal.signal(signal.SIGINT, signal_handler)
    
    # Iniciar threads para los servicios backend
    docker_thread = threading.Thread(target=run_docker_manager, daemon=True)
    api_thread = threading.Thread(target=run_api_agent, daemon=True)
    
    docker_thread.start()
    time.sleep(2)  # Esperar a que Docker Manager esté listo
    api_thread.start()
    
    print(f"\n{Colors.GREEN}Servicios backend listos para usar:{Colors.ENDC}")
    print(f"{Colors.GREEN}- Docker Manager: http://localhost:9000{Colors.ENDC}")
    print(f"{Colors.GREEN}- API Agent: http://localhost:8001{Colors.ENDC}")
    print(f"\n{Colors.YELLOW}Puedes usar la interfaz de línea de comandos:{Colors.ENDC}")
    print(f"{Colors.YELLOW}python cli_agent.py --interactive{Colors.ENDC}")
    print(f"\n{Colors.YELLOW}O acceder a la documentación de la API REST:{Colors.ENDC}")
    print(f"{Colors.YELLOW}http://localhost:8001/docs{Colors.ENDC}")
    print(f"\n{Colors.YELLOW}Presiona Ctrl+C para detener los servicios.{Colors.ENDC}\n")
    
    try:
        # Mantener el proceso principal vivo
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        signal_handler(None, None)

if __name__ == "__main__":
    main() 