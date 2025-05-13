import os
import sys
import argparse
import subprocess
import time
import signal
import socket # Necesario para comprobar puertos
import re     # Necesario para modificar archivo frontend

# --- Configuración --- 
PREFERRED_PORTS = [9000, 8000, 8081, 5001, 5002, 5003] # Puertos a intentar para el backend
FRONTEND_SOCKET_FILE = os.path.join("frontend", "src", "lib", "socket.ts")
DOCKER_MANAGER_PORT = 9001  # Puerto fijo para el Docker Manager

# --- Variables Globales --- 
backend_proc = None
frontend_proc = None
docker_manager_proc = None

# --- Funciones Auxiliares --- 
def is_port_in_use(port: int) -> bool:
    """Verifica si un puerto TCP está ocupado en localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            # Intenta enlazar al puerto en la interfaz local
            s.bind(("127.0.0.1", port))
        except socket.error as e:
            # Si falla (ej. puerto ya en uso), el puerto está ocupado
            # print(f"Debug: Puerto {port} en uso ({e.strerror})")
            return True
    # Si el enlace tiene éxito, el puerto está libre (el socket se cierra automáticamente)
    return False

def find_available_port(ports_to_try: list[int]) -> int | None:
    """Encuentra el primer puerto libre en la lista proporcionada."""
    print("\nBuscando puerto disponible para el backend...")
    for port in ports_to_try:
        if not is_port_in_use(port):
            print(f"Puerto {port} parece estar libre.")
            return port
        else:
            print(f"Puerto {port} parece estar en uso.")
    print("\n[Error Crítico] No se encontró ningún puerto libre en la lista:")
    print(f"  {ports_to_try}")
    print("Asegúrate de que alguno de estos puertos esté disponible.")
    return None

def update_frontend_socket_port(filepath: str, new_port: int):
    """Modifica el archivo socket.ts del frontend para usar el puerto especificado."""
    print(f"\nActualizando {filepath} para usar el puerto {new_port}...")
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        original_content = content

        # Verificar si el puerto ya está configurado correctamente
        # Esto busca patrones como: io('http://localhost:9000' o io("http://localhost:9000"
        # y también con espacios variables alrededor de los dos puntos y la coma.
        current_port_pattern_check = rf"io\s*\(\s*['\"]http://localhost:{new_port}['\"]\s*," 
        if re.search(current_port_pattern_check, content):
            print(f"{filepath} ya está configurado para usar el puerto {new_port}. No se necesitan cambios.")
            return True

        # Patrón de reemplazo más robusto para diferentes puertos existentes
        # Cubre: io('http://localhost:PUERTO' o io("http://localhost:PUERTO" con o sin espacios y comillas
        # y diferentes números de puerto (e.g., 3000, 5000, 8000, 9000 u otros)
        replacement_pattern = r"(socket\s*=\s*io\s*\(\s*['\"]http://localhost:)\d+(?=['\"]\s*,)" 
        new_content = re.sub(
            replacement_pattern,
            rf"\g<1>{new_port}",
            content,
            count=1
        )

        if new_content != original_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"{filepath} actualizado correctamente para usar el puerto {new_port}.")
            return True
        else:
            print(f"[ADVERTENCIA] No se pudo actualizar automáticamente el puerto en {filepath}.")
            print(f"El contenido actual no coincide con el patrón esperado o ya está actualizado.")
            print(f"Por favor, verifica manualmente que {filepath} apunte al puerto {new_port}.")
            print(f"Línea esperada (aproximadamente): socket = io('http://localhost:{new_port}', ...);")
            # Devolver True aquí porque el usuario debe verificar manualmente, no es un error crítico del script.
            # El script principal ya advierte si esto devuelve False.
            # Sin embargo, si el puerto ya estaba bien (verificado arriba), esto no se alcanza.
            return False # Indica que la actualización automática no hizo cambios o falló.

    except FileNotFoundError:
        print(f"[Error Crítico] No se encontró el archivo {filepath}.")
        return False
    except Exception as e:
        print(f"[Error Crítico] Error inesperado al actualizar {filepath}: {e}")
        return False

# --- Funciones Principales de Proceso --- 
def start_docker_manager(port_to_use: int):
    """Inicia el Docker Manager (docker_manager_app.py) en el puerto especificado."""
    print(f"\n[Docker Manager] Iniciando docker_manager_app.py como subproceso en http://localhost:{port_to_use} ...")
    try:
        # Usamos uvicorn para iniciar la aplicación FastAPI
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "docker_manager_app:app", "--host", "0.0.0.0", "--port", str(port_to_use)])
        print(f"[Docker Manager] Comando para iniciar docker_manager_app.py en puerto {port_to_use} emitido.")
        return proc
    except Exception as e:
        print(f"\n[Docker Manager Error] Excepción al intentar lanzar docker_manager_app.py: {e}")
        return None

def start_backend(port_to_use: int):
    """Inicia el backend (app.py) pasándole el puerto a usar."""
    print(f"\n[Backend] Iniciando app.py como subproceso en http://localhost:{port_to_use} ...")
    try:
        # Lanzar app.py pasándole el puerto elegido como argumento
        proc = subprocess.Popen([sys.executable, "app.py", "--port", str(port_to_use)])
        print(f"[Backend] Comando para iniciar app.py en puerto {port_to_use} emitido.")
        return proc
    except Exception as e:
        print(f"\n[Backend Error] Excepción MUY TEMPRANA al intentar lanzar app.py: {e}")
        return None

def start_frontend():
    """Inicia el frontend Next.js en un subproceso."""
    env = os.environ.copy()
    print("\n[Frontend] Iniciando Next.js (puede tardar)... Revisar puerto real en salida.")
    # Dejar que Next.js elija el puerto si 3000 está ocupado
    return subprocess.Popen(["npm", "run", "dev"], cwd="frontend", env=env, shell=True)

# --- Función Principal de Orquestación --- 
def main():
    global backend_proc, frontend_proc, docker_manager_proc
    print("\n=== Iniciando Gemini Docker Agent (Nueva Versión) ===")

    # 1. Verificar si el puerto del Docker Manager está disponible
    if is_port_in_use(DOCKER_MANAGER_PORT):
        print(f"\n[ADVERTENCIA] El puerto {DOCKER_MANAGER_PORT} para Docker Manager está ocupado.")
        print("Asegúrate de que no haya otra instancia del Docker Manager ejecutándose.")
        print(f"Intenta liberar el puerto {DOCKER_MANAGER_PORT} antes de continuar.")
        sys.exit(1)

    # 2. Encontrar puerto libre para el backend
    chosen_backend_port = find_available_port(PREFERRED_PORTS)
    if chosen_backend_port is None:
        print("\nNo se pudo encontrar un puerto libre para el backend. Saliendo.")
        sys.exit(1)

    # 3. Actualizar el archivo de conexión del frontend ANTES de iniciar nada
    success = update_frontend_socket_port(FRONTEND_SOCKET_FILE, chosen_backend_port)
    if not success:
        print("\n[ERROR] No se pudo actualizar el archivo del frontend. La aplicación no funcionará correctamente.")
        print(f"Por favor, edita manualmente {FRONTEND_SOCKET_FILE} para usar el puerto {chosen_backend_port}.")
        # Continuar de todos modos, pero advertir al usuario que debe editar manualmente

    try:
        # 4. Iniciar Docker Manager en el puerto 9001
        print(f"\nIniciando Docker Manager en puerto {DOCKER_MANAGER_PORT}...")
        docker_manager_proc = start_docker_manager(DOCKER_MANAGER_PORT)
        
        # Dar tiempo a que el Docker Manager arranque
        print("Esperando brevemente a que el Docker Manager inicie...")
        time.sleep(3)
        
        # Comprobar si Docker Manager arrancó correctamente
        if docker_manager_proc is None or docker_manager_proc.poll() is not None:
            print(f"\n[ERROR CRÍTICO] El Docker Manager no pudo iniciarse en el puerto {DOCKER_MANAGER_PORT}.")
            print("La aplicación no funcionará correctamente sin el Docker Manager.")
            # Podríamos salir aquí, pero continuamos para permitir depuración

        # 5. Iniciar Backend en el puerto elegido
        backend_proc = start_backend(chosen_backend_port)

        # Dar tiempo a que el backend intente arrancar
        print("Esperando brevemente para que el backend intente iniciarse...")
        time.sleep(5)

        # 4. Verificar si el backend arrancó
        if backend_proc is None or backend_proc.poll() is not None:
            print("\n[Alerta Crítica] El subproceso del backend (app.py) terminó inesperadamente o no pudo iniciarse.")
            print(f"Intentó usar el puerto: {chosen_backend_port}")
            print("Revisa los mensajes de error de app.py directamente si los hay (puede que no aparezcan aquí).")
            print(f"Verifica manualmente si el puerto {chosen_backend_port} está libre con:")
            print(f"  netstat -ano | findstr :{chosen_backend_port}")
            # No continuar si el backend falló
        else:
            print(f"\n[Backend] Subproceso app.py parece estar corriendo en puerto {chosen_backend_port}.")
            # 5. Iniciar Frontend (ahora configurado para el puerto correcto)
            frontend_proc = start_frontend()

            print("\n=== Gemini Docker Agent ejecutándose ===\n")
            print(f"API Backend (detectado): http://localhost:{chosen_backend_port}")
            print("Frontend UI: Revisa la salida de Next.js para el puerto real (normalmente http://localhost:3000)")
            print("\nPuedes acceder a la aplicación en tu navegador usando la URL del frontend.")
            print("\nPresiona Ctrl+C para detener la aplicación\n")

            # Esperar a que los procesos terminen (o Ctrl+C)
            if frontend_proc:
                frontend_proc.wait()
            elif backend_proc: # Si el frontend no inició pero el backend sí
                backend_proc.wait()

    except KeyboardInterrupt:
        print("\nCerrando aplicación (Ctrl+C recibido)...")
    finally:
        print("\nLimpiando procesos...")
        if frontend_proc and frontend_proc.poll() is None:
            print("[Frontend] Terminando proceso Next.js...")
            frontend_proc.terminate()
            try: frontend_proc.wait(timeout=5)
            except subprocess.TimeoutExpired: frontend_proc.kill()
        else:
            print("[Frontend] Proceso ya terminado o no iniciado.")

        if backend_proc and backend_proc.poll() is None:
            print(f"[Backend] Terminando subproceso app.py (puerto {chosen_backend_port})...")
            backend_proc.terminate()
            try: backend_proc.wait(timeout=5)
            except subprocess.TimeoutExpired: backend_proc.kill()
        else:
            print("[Backend] Subproceso app.py ya terminado o no iniciado.")
            
        if docker_manager_proc and docker_manager_proc.poll() is None:
            print(f"[Docker Manager] Terminando subproceso docker_manager_app.py (puerto {DOCKER_MANAGER_PORT})...")
            docker_manager_proc.terminate()
            try: docker_manager_proc.wait(timeout=5)
            except subprocess.TimeoutExpired: docker_manager_proc.kill()
        else:
            print("[Docker Manager] Subproceso docker_manager_app.py ya terminado o no iniciado.")

        print("\nProcesos limpiados. ¡Hasta luego!")

if __name__ == "__main__":
    main()