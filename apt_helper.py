import logging
import time
from typing import Optional, Dict, Any, List, Tuple

# Configuración del logging
log = logging.getLogger(__name__)

# Comandos para limpiar bloqueos de APT
APT_CLEAN_COMMANDS = [
    # Matar cualquier proceso apt o dpkg que esté en ejecución
    "pkill -f apt || true",
    "pkill -f dpkg || true",
    # Eliminar archivos de bloqueo
    "rm -f /var/lib/apt/lists/lock || true", 
    "rm -f /var/lib/dpkg/lock* || true",
    "rm -f /var/cache/apt/archives/lock || true"
]

def get_unlock_apt_command() -> str:
    """
    Genera un comando para desbloquear APT.
    
    Returns:
        str: Comando que elimina los bloqueos de APT
    """
    return " && ".join(APT_CLEAN_COMMANDS)

def get_safe_install_command(package_name: str) -> str:
    """
    Genera un comando para instalar paquetes de manera segura, intentando
    desbloquear APT primero y manejando posibles errores.
    
    Args:
        package_name: Nombre del paquete o lista de paquetes a instalar
        
    Returns:
        str: Comando completo para instalar el paquete de manera segura
    """
    unlock_cmd = get_unlock_apt_command()
    
    # Comando para actualizar e instalar con reintentos
    cmd = f"""
    {unlock_cmd} &&
    echo "🔄 Actualizando repositorios..." &&
    (apt-get update -y || (sleep 2 && {unlock_cmd} && apt-get update -y)) &&
    echo "📦 Instalando {package_name}..." &&
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends {package_name} ||
    (
        echo "⚠️ Primer intento fallido, reintentando..." &&
        sleep 2 &&
        {unlock_cmd} &&
        apt-get update -y &&
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends {package_name}
    )
    """
    
    return cmd
