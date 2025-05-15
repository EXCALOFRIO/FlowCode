import os
import io
import tarfile
import tempfile
import time
import pytest
import uuid
import re
from fastapi.testclient import TestClient
# Ensure app is imported after potential environment variable settings for CONTAINER_NAME
from docker_manager_app import app, CONTAINER_WORKSPACE as APP_CONTAINER_WORKSPACE, CONTAINER_NAME 

ansi_escape = re.compile(r'\x1b\[[0-9;]*m')
def strip_ansi(text):
    """Removes ANSI escape codes from a string."""
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)

# --- Fixtures ---

@pytest.fixture(scope="session")
def client():
    """
    Test client fixture for making requests to the FastAPI app.
    It ensures the app's lifespan context manager is used.
    """
    # The TestClient context manager handles lifespan startup/shutdown.
    with TestClient(app) as c:
        yield c

@pytest.fixture(scope="session")
def CONTAINER_WORKSPACE():
    """
    Provides the CONTAINER_WORKSPACE path used by the application.
    """
    return APP_CONTAINER_WORKSPACE


# --- Utilidades de Prueba ---

def create_temp_file(content=b"default test content", filename="testfile.txt", dirname=None):
    if dirname:
        os.makedirs(dirname, exist_ok=True)
        tmp_path = os.path.join(dirname, filename)
        with open(tmp_path, "wb") as f:
            f.write(content)
        return tmp_path, filename
    else:
        tmp = tempfile.NamedTemporaryFile(delete=False, prefix="pytest_", suffix=f"_{filename}")
        tmp.write(content)
        tmp.close()
        return tmp.name, filename

def unique_filename(prefix="test_"):
    return f"{prefix}{uuid.uuid4().hex[:8]}.txt"

def unique_dirname(prefix="test_dir_"):
    return f"{prefix}{uuid.uuid4().hex[:8]}"


@pytest.fixture(autouse=True, scope="session")
def initial_container_setup_and_teardown(client): # client fixture is now available here
    # This runs once per session before any tests
    print("\n--- Pytest Session Start: Ensuring initial container state ---")
    # Attempt to get status to trigger initial creation if not exists
    try:
        response = client.get("/status")
        if response.status_code == 200:
            print(f"Initial container status: {response.json().get('status')}")
        else:
            print(f"Initial status check failed: {response.status_code} - {response.text}")
            # This might indicate a bigger problem with Docker or app startup
            pytest.fail(f"Initial status check failed: {response.status_code} - {response.text}")

    except Exception as e:
        print(f"Exception during initial status check: {e}")
        pytest.fail(f"Critical error during initial container check: {e}")

    # Wait for container to be fully ready
    max_retries = 15 # Increased retries
    for i in range(max_retries):
        try:
            response = client.get("/status")
            if response.status_code == 200 and response.json().get("status") == "running":
                print(f"Container '{CONTAINER_NAME}' is running after {i+1} checks.")
                break
            status_val = response.json().get('status') if response.status_code == 200 else response.status_code
            print(f"Container not ready yet (attempt {i+1}/{max_retries}), status: {status_val}. Waiting...")
        except Exception as e:
            print(f"Error checking status (attempt {i+1}): {e}")
        time.sleep(2) # Increased wait time
    else:
        final_status_resp = client.get("/status")
        final_status_text = final_status_resp.text if hasattr(final_status_resp, 'text') else 'No response text'
        pytest.fail(f"Container '{CONTAINER_NAME}' did not become ready in time after {max_retries} checks. Last status: {final_status_text}")
    
    yield # This is where the tests run

    # Teardown: Optional, could clean up the specific container if desired
    # print(f"\n--- Pytest Session End: Optional cleanup for {CONTAINER_NAME} ---")
    # client.post("/reset") # Example: reset to clean up the test container
    # For true isolation, CONTAINER_NAME could be made unique per session.

# --- Tests ---

def test_status_endpoint(client, CONTAINER_WORKSPACE): # Fixtures injected
    response = client.get("/status")
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["name"] == CONTAINER_NAME
    assert data["status"] == "running" # Should be running due to fixture
    assert "image" in data
    assert data["workspace"] == CONTAINER_WORKSPACE 
    assert data["working_dir"] == CONTAINER_WORKSPACE 

def test_reset_container(client): # Fixture injected
    response_status_before = client.get("/status")
    id_before = response_status_before.json().get("id")

    response_reset = client.post("/reset")
    assert response_reset.status_code == 200
    assert "reset successfully" in response_reset.json().get("detail", "")

    time.sleep(5) # Give time for new container to start

    response_status_after = client.get("/status")
    assert response_status_after.status_code == 200
    data_after = response_status_after.json()
    assert data_after["status"] == "running"
    assert data_after.get("id") != id_before 
    assert data_after["name"] == CONTAINER_NAME

def test_run_command_echo(client): # Fixture injected
    test_string = f"hello_docker_{uuid.uuid4().hex}"
    response = client.post("/run", data={"command": f"echo {test_string}"})
    assert response.status_code == 200
    output = response.text
    assert test_string in output.strip() 

def test_run_command_create_file_in_workspace(client, CONTAINER_WORKSPACE): # Fixtures injected
    filename = unique_filename("test_run_")
    filepath_in_container = f"{CONTAINER_WORKSPACE}/{filename}" 
    
    response_create = client.post("/run", data={"command": f"touch {filepath_in_container}"})
    assert response_create.status_code == 200

    response_check = client.post("/run", data={"command": f"ls {filepath_in_container}"})
    assert response_check.status_code == 200
    assert filepath_in_container.strip() in response_check.text.strip()

    client.post("/run", data={"command": f"rm {filepath_in_container}"})

def test_run_command_error_exit_code(client): # Fixture injected
    response = client.post("/run", data={"command": "ls /non_existent_path_for_sure_v2; exit 1"})
    assert response.status_code == 200 
    assert "No such file or directory" in response.text or "cannot access" in response.text

def test_copy_to_and_from(client, CONTAINER_WORKSPACE): # Fixtures injected
    file_content = f"Contenido para copy_to_from {uuid.uuid4().hex}".encode('utf-8')
    local_filename = unique_filename("copy_test_")
    local_tmp_path, _ = create_temp_file(content=file_content, filename=local_filename)
    
    container_target_path = f"{CONTAINER_WORKSPACE}/{local_filename}"

    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (local_filename, f, "text/plain")}
            data = {"container_path": container_target_path} 
            response_to = client.post("/copy_to", files=files, data=data)

        if response_to.status_code != 200:
            print(f"Copy To failed! Status: {response_to.status_code}, Response: {response_to.text}")
        assert response_to.status_code == 200
        assert "copied into container" in response_to.json()["detail"]

        response_ls = client.post("/run", data={"command": f"ls {container_target_path}"})
        assert response_ls.status_code == 200
        assert container_target_path in response_ls.text.strip()

        archive_dl_name = "downloaded_archive.tar"
        response_from = client.get(f"/copy_from?container_path={container_target_path}&archive_name={archive_dl_name}")

        if response_from.status_code != 200:
            print(f"Copy From failed! Status: {response_from.status_code}, Response: {response_from.text}")
        assert response_from.status_code == 200
        assert response_from.headers["content-type"] == "application/x-tar"
        assert f"filename=\"{archive_dl_name}\"" in response_from.headers["content-disposition"]

        tar_bytes = io.BytesIO(response_from.content)
        with tarfile.open(fileobj=tar_bytes, mode="r") as tar:
            names = tar.getnames()
            assert local_filename in names 
            extracted_file_info = tar.getmember(local_filename)
            extracted_file = tar.extractfile(extracted_file_info)
            assert extracted_file is not None
            content_from_tar = extracted_file.read()
            assert content_from_tar == file_content
    finally:
        os.remove(local_tmp_path)
        client.post("/run", data={"command": f"rm -f {container_target_path}"})

def test_copy_from_not_found(client, CONTAINER_WORKSPACE): # Fixtures injected
    non_existent_path = f"{CONTAINER_WORKSPACE}/non_existent_file_{uuid.uuid4().hex}.txt"
    response = client.get(f"/copy_from?container_path={non_existent_path}")
    assert response.status_code == 404
    assert "Path not found" in response.json().get("detail", "")

def test_copy_to_non_existent_parent_dir(client, CONTAINER_WORKSPACE): # Fixtures injected
    local_filename = unique_filename("deep_copy_")
    local_tmp_path, _ = create_temp_file(filename=local_filename)
    
    container_target_path = f"{CONTAINER_WORKSPACE}/new_dir1/new_dir2/new_dir3/{local_filename}"
    
    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (local_filename, f, "text/plain")}
            data = {"container_path": container_target_path} 
            response_to = client.post("/copy_to", files=files, data=data)

        assert response_to.status_code == 200 
        assert "copied into container" in response_to.json()["detail"]

        response_ls = client.post("/run", data={"command": f"ls {container_target_path}"})
        assert response_ls.status_code == 200
        assert container_target_path in response_ls.text.strip()
    finally:
        os.remove(local_tmp_path)
        client.post("/run", data={"command": f"rm -rf {CONTAINER_WORKSPACE}/new_dir1"})

def test_copy_binary_file_to_and_from(client, CONTAINER_WORKSPACE): # Fixtures injected
    import base64
    binary_content = base64.b64decode(
        b'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=')
    local_filename = unique_filename("test_img_") + ".png"
    local_tmp_path, _ = create_temp_file(content=binary_content, filename=local_filename)
    container_target_path = f"{CONTAINER_WORKSPACE}/{local_filename}" 
    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (local_filename, f, "application/octet-stream")}
            data = {"container_path": container_target_path} 
            response_to = client.post("/copy_to", files=files, data=data)
        assert response_to.status_code == 200
        
        response_from = client.get(f"/copy_from?container_path={container_target_path}&archive_name=img.tar")
        assert response_from.status_code == 200
        tar_bytes = io.BytesIO(response_from.content)
        with tarfile.open(fileobj=tar_bytes, mode="r") as tar:
            extracted_file_info = tar.getmember(local_filename)
            extracted_file = tar.extractfile(extracted_file_info)
            assert extracted_file.read() == binary_content
    finally:
        os.remove(local_tmp_path)
        client.post("/run", data={"command": f"rm -f {container_target_path}"})

def test_copy_folder_with_multiple_files(client, CONTAINER_WORKSPACE): # Fixtures injected
    folder_name = unique_dirname()
    container_folder_path = f"{CONTAINER_WORKSPACE}/{folder_name}"
    filenames = [f"file_{i}.txt" for i in range(3)]
    
    client.post("/run", data={"command": f"mkdir -p {container_folder_path}"})
    for fname in filenames:
        content = f"content for {fname} in {folder_name}"
        client.post("/run", data={"command": f"echo \"{content}\" > {container_folder_path}/{fname}"})
        
    response_from = client.get(f"/copy_from?container_path={container_folder_path}&archive_name=folder_dl.tar")
    assert response_from.status_code == 200
    tar_bytes = io.BytesIO(response_from.content)
    
    with tarfile.open(fileobj=tar_bytes, mode="r") as tar:
        names_in_tar = [name.replace('\\', '/') for name in tar.getnames()]
        expected_tar_paths = [f"{folder_name}/{fname}" for fname in filenames]
        for expected_path in expected_tar_paths:
            assert expected_path in names_in_tar
            member_info = tar.getmember(expected_path)
            file_content_bytes = tar.extractfile(member_info).read()
            original_fname = os.path.basename(expected_path)
            expected_content = f"content for {original_fname} in {folder_name}"
            assert file_content_bytes.decode().strip() == expected_content.strip()
            
    client.post("/run", data={"command": f"rm -rf {container_folder_path}"})

def test_copy_and_overwrite_file(client, CONTAINER_WORKSPACE): # Fixtures injected
    content1 = b"primera version"
    content2 = b"segunda version"
    local_filename = unique_filename("overwrite_")
    local_tmp_path, _ = create_temp_file(content=content1, filename=local_filename)
    container_target_path = f"{CONTAINER_WORKSPACE}/{local_filename}" 
    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (local_filename, f, "text/plain")}
            data = {"container_path": container_target_path} 
            response_to = client.post("/copy_to", files=files, data=data)
        assert response_to.status_code == 200
        
        with open(local_tmp_path, "wb") as f_write: f_write.write(content2)
        with open(local_tmp_path, "rb") as f_read:
            files = {"file": (local_filename, f_read, "text/plain")}
            data = {"container_path": container_target_path} 
            response_to2 = client.post("/copy_to", files=files, data=data)
        assert response_to2.status_code == 200
        
        response_from = client.get(f"/copy_from?container_path={container_target_path}&archive_name=ow.tar")
        assert response_from.status_code == 200
        tar_bytes = io.BytesIO(response_from.content)
        with tarfile.open(fileobj=tar_bytes, mode="r") as tar:
            extracted_file = tar.extractfile(local_filename)
            assert extracted_file.read() == content2
    finally:
        os.remove(local_tmp_path)
        client.post("/run", data={"command": f"rm -f {container_target_path}"})

def test_copy_file_with_special_characters_in_name(client, CONTAINER_WORKSPACE): # Fixtures injected
    filename = f"archivo con espacios y ñá {uuid.uuid4().hex[:4]}.txt"
    content = "contenido especial con acentos y ñ".encode("utf-8")
    local_tmp_path, _ = create_temp_file(content=content, filename=filename)
    container_target_path = f"{CONTAINER_WORKSPACE}/{filename}" 
    
    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (filename, f, "text/plain; charset=utf-8")}
            data = {"container_path": container_target_path} 
            response_to = client.post("/copy_to", files=files, data=data)
        assert response_to.status_code == 200
        
        response_from = client.get(f"/copy_from?container_path={container_target_path}&archive_name=spc.tar")
        assert response_from.status_code == 200
        tar_bytes = io.BytesIO(response_from.content)
        with tarfile.open(fileobj=tar_bytes, mode="r") as tar:
            extracted_file_info = tar.getmember(filename) 
            extracted_file = tar.extractfile(extracted_file_info)
            assert extracted_file.read() == content
    finally:
        os.remove(local_tmp_path)
        client.post("/run", data={"command": f"rm -f \"{container_target_path}\""}) 

def test_install_python_and_pip_package(client): # Fixture injected
    client.post("/reset"); time.sleep(5)
    install_cmd = "apt-get update && apt-get install -y python3 python3-pip"
    response = client.post("/run", data={"command": install_cmd})
    assert response.status_code == 200
    response2 = client.post("/run", data={"command": "python3 -m pip install --break-system-packages requests"})
    assert response2.status_code == 200
    test_script = "import requests; print(requests.__version__)"
    response3 = client.post("/run", data={"command": f"python3 -c '{test_script}'"})
    assert response3.status_code == 200
    assert any(c.isdigit() for c in response3.text) and "." in response3.text

def test_install_system_package_and_use(client): # Fixture injected
    client.post("/reset"); time.sleep(5)

    install_cmd = "apt-get update && apt-get install -y curl"
    response = client.post("/run", data={"command": install_cmd})
    assert response.status_code == 200
    
    response2 = client.post("/run", data={"command": "curl --version"})
    assert response2.status_code == 200
    assert "curl" in response2.text.lower() and "libcurl" in response2.text.lower()

def test_install_dependencies_apt(client): # Fixture 'client' inyectado
    # 1. Resetear el contenedor para un estado limpio
    reset_response = client.post("/reset")
    assert reset_response.status_code == 200 # Asumiendo que /reset devuelve 200 OK
    
    # Esperar a que el contenedor se reinicie y esté listo.
    # La duración exacta puede variar. 5 segundos es una suposición.
    # Una mejor aproximación sería un bucle de sondeo al endpoint /status.
    # Por ahora, mantendremos el time.sleep como en el original,
    # pero considera reemplazarlo con un sondeo más robusto si los tests son inestables.
    log_message_printed = False
    for _ in range(10): # Intentar hasta 10 segundos
        status_resp = client.get("/status")
        if status_resp.status_code == 200 and status_resp.json().get("status") == "running":
            if not log_message_printed:
                print("Container is running after reset.")
            break
        if not log_message_printed:
            print("Waiting for container to be ready after reset...")
            log_message_printed = True
        time.sleep(1)
    else:
        pytest.fail("Container did not become ready after reset.")

    # 2. Definir el contenido del archivo de paquetes
    packages_content = "cowsay\n#figlet\n  htop # another tool\n  # another comment\n   \n" # Probar comentarios, espacios y líneas vacías
    
    # 3. Llamar al endpoint /install_dependencies
    # Asumiendo que el endpoint /install_dependencies ahora es BLOQUEANTE y devuelve JSON
    # con el estado de la instalación y la salida.
    response_install = client.post(
        "/install_dependencies",
        files={"dep_file": ("pkgs.list", io.BytesIO(packages_content.encode("utf-8")), "text/plain")},
        data={"dep_type": "apt"}
    )
    
    # 4. Verificar la respuesta del endpoint de instalación
    # Si la instalación falló DENTRO del contenedor, el endpoint ahora debería devolver un error HTTP (ej. 500 o 422)
    # Si la instalación fue exitosa, debería devolver 200.
    assert response_install.status_code == 200, \
        f"Falló la instalación de dependencias. Status: {response_install.status_code}. Response: {response_install.text[:500]}"
    
    response_data = response_install.json()
    install_output = response_data.get("output", "")
    assert "Dependencies installed successfully." in response_data.get("detail", ""), \
        "El detalle de la respuesta no indicó éxito."
    
    # print(f"APT Install output (recortado):\n{install_output[:1000]}\n...") # Descomentar para depuración si es necesario

    # Verificar que los paquetes esperados se configuraron y los comentados no
    # "Setting up <package_name>" es un buen indicador de que apt procesó el paquete.
    assert "Setting up cowsay" in install_output, "No se encontró 'Setting up cowsay' en la salida."
    assert "Setting up htop" in install_output, "No se encontró 'Setting up htop' en la salida."
    # Asegurarse de que figlet (comentado) no fue procesado (no debería aparecer "Setting up figlet")
    # También, el comando de instalación `apt-get install -y $(cat ...)` no debería incluirlo.
    assert "figlet" not in install_output.split("apt-get install -y")[1].split("\n")[0] if "apt-get install -y" in install_output else True, \
        "figlet apareció en la lista de paquetes a instalar."
    assert "Setting up figlet" not in install_output, "Figlet (comentado) parece haber sido configurado."


    # 5. Verificar la instalación de 'cowsay' usando dpkg y ejecutándolo
    resp_dpkg_cowsay = client.post("/run", data={"command": "dpkg -s cowsay"})
    assert resp_dpkg_cowsay.status_code == 200
    dpkg_cowsay_output = resp_dpkg_cowsay.text
    assert "Status: install ok installed" in dpkg_cowsay_output, \
        "dpkg -s cowsay no reportó 'install ok installed'."

    resp_cowsay_run = client.post("/run", data={"command": "/usr/games/cowsay 'APT Test OK for cowsay'"})
    assert resp_cowsay_run.status_code == 200
    assert "APT Test OK for cowsay" in resp_cowsay_run.text, \
        "La ejecución de cowsay no produjo la salida esperada."

    # 6. Verificar la instalación de 'htop' usando dpkg
    resp_dpkg_htop = client.post("/run", data={"command": "dpkg -s htop"})
    assert resp_dpkg_htop.status_code == 200
    dpkg_htop_output = resp_dpkg_htop.text
    assert "Status: install ok installed" in dpkg_htop_output, \
        "dpkg -s htop no reportó 'install ok installed'."
    
    # Extraer y verificar la versión de htop de la salida de dpkg
    version_match = re.search(r"Version:\s*([0-9]+\.[0-9]+\.[0-9]+[^ \n]*)", dpkg_htop_output) # Patrón más específico
    assert version_match is not None, \
        f"No se pudo encontrar la línea de versión de htop en la salida de dpkg:\n{dpkg_htop_output}"
    htop_version = version_match.group(1)
    # print(f"HTOP Version from dpkg: {htop_version}")
    assert "." in htop_version and any(c.isdigit() for c in htop_version), \
        f"La versión de htop '{htop_version}' extraída de dpkg no parece válida."

# --- Tests for New Endpoints ---

def test_list_files_endpoint(client, CONTAINER_WORKSPACE): # Fixtures injected
    test_dir_name = unique_dirname("list_test_")
    test_file_name1 = unique_filename("file1_")
    container_dir_path = f"{CONTAINER_WORKSPACE}/{test_dir_name}"
    container_file1_path = f"{CONTAINER_WORKSPACE}/{test_file_name1}"
    
    client.post("/run", data={"command": f"mkdir -p {container_dir_path} && touch {container_file1_path}"})
    time.sleep(0.5)

    response_root = client.get(f"/list_files?path={CONTAINER_WORKSPACE}")
    assert response_root.status_code == 200
    data_root = response_root.json()
    filenames_in_root = [f["name"] for f in data_root["files"]]
    assert test_dir_name in filenames_in_root
    assert test_file_name1 in filenames_in_root
    
    dir_entry = next(f for f in data_root["files"] if f["name"] == test_dir_name)
    assert dir_entry["type"] == "directory"
    
    client.post("/run", data={"command": f"rm -rf {container_dir_path} {container_file1_path}"})

def test_delete_path_endpoint(client, CONTAINER_WORKSPACE): # Fixtures injected
    file_to_delete = unique_filename("delete_me_")
    container_file_rel_path = file_to_delete 
    container_file_abs_path = f"{CONTAINER_WORKSPACE}/{file_to_delete}"

    client.post("/run", data={"command": f"touch {container_file_abs_path}"})

    response_del_file = client.delete(f"/delete_path?container_path={container_file_rel_path}")
    assert response_del_file.status_code == 200
    
    ls_resp = client.post("/run", data={"command": f"ls {container_file_abs_path}"})
    assert "No such file or directory" in ls_resp.text

def test_read_file_endpoint(client, CONTAINER_WORKSPACE): # Fixtures injected
    txt_filename = unique_filename("readable_")
    txt_content = f"Hello from read_file test {uuid.uuid4().hex} with ñ!"
    container_txt_path = f"{CONTAINER_WORKSPACE}/{txt_filename}"

    client.post("/run", data={"command": f"echo \"{txt_content}\" > {container_txt_path}"})

    response_txt = client.get(f"/read_file?container_path={container_txt_path}")
    assert response_txt.status_code == 200
    assert response_txt.headers["content-type"].startswith("text/plain")
    assert response_txt.text.strip() == txt_content.strip()
    
    client.post("/run", data={"command": f"rm -f {container_txt_path}"})

def test_execute_script_endpoint(client): # Fixture injected
    bash_script_content = "echo \"Hello from Bash! Args: $@\""
    bash_args = "arg1 bash_arg2"
    response_bash = client.post(
        "/execute_script",
        files={"script_file": ("test.sh", io.BytesIO(bash_script_content.encode('utf-8')), "text/x-shellscript")},
        data={"interpreter": "bash", "args": bash_args}
    )
    assert response_bash.status_code == 200
    assert f"Hello from Bash! Args: {bash_args}" in response_bash.text.strip()

def test_container_stats_endpoint(client): # Fixture injected
    response = client.get("/container_stats")
    assert response.status_code == 200
    stats = response.json()
    assert "read" in stats 
    assert "cpu_stats" in stats
    assert "memory_stats" in stats

def test_install_dependencies_pip(client): # Fixture injected
    client.post("/reset"); time.sleep(5)
    # Ubuntu might need python3-pip explicitly, or python3-requests to create envs that have pip
    client.post("/run", data={"command": "apt-get update && apt-get install -y python3-pip python3-requests"}) # Install requests via apt first to ensure pip has something to check against
    
    requirements_content = "requests==2.25.1\n# Another comment\n  # Indented comment\n\n  somepackage  # Comment after package" # Test comments and blank lines
    response_install = client.post(
        "/install_dependencies",
        files={"dep_file": ("reqs.txt", io.BytesIO(requirements_content.encode("utf-8")), "text/plain")},
        data={"dep_type": "pip"}
    )
    # Esperar un código 500 ya que 'somepackage' no existe y la instalación fallará
    assert response_install.status_code == 500
    # Verificar que el detalle del error contiene información sobre la falla
    error_detail = response_install.json().get("detail", "")
    assert "Dependency installation failed with exit code 1." in error_detail
    
    # Opcional: Verificar que el header X-Install-Output está presente y contiene parte del output
    install_output_header = response_install.headers.get("X-Install-Output", "")
    assert "somepackage" in install_output_header or "No matching distribution" in install_output_header

def test_install_dependencies_apt(client): # Fixture injected
    client.post("/reset")
    # Puede que sea necesario un pequeño retardo para que el reset se complete y el contenedor esté listo.
    # El propio get_container() debería manejar esto, pero un `time.sleep` aquí puede ser
    # una red de seguridad si `get_container` no es lo suficientemente robusto para reintentos rápidos.
    # Sin embargo, el `time.sleep(5)` original podría ser excesivo o innecesario si get_container es bueno.
    # Lo mantendré por ahora ya que estaba.
    time.sleep(5)

    packages_content = "cowsay\n#figlet\n  htop # another tool" # Test comments and blank lines
    response_install = client.post(
        "/install_dependencies",
        files={"dep_file": ("pkgs.list", io.BytesIO(packages_content.encode("utf-8")), "text/plain")},
        data={"dep_type": "apt"}
    )
    assert response_install.status_code == 200
    install_output = response_install.text
    # print(f"APT Install output: {install_output}") # Descomentar para depurar si es necesario

    # Es importante verificar que la instalación *reportó* éxito para los paquetes.
    # La salida de apt-get install es verbosa. Buscamos líneas que indiquen la configuración.
    assert "Setting up cowsay" in install_output
    assert "Setting up htop" in install_output
    assert "figlet" not in install_output # Asegurarse que el paquete comentado no se intentó instalar activamente

    # --- Verificar cowsay ---
    # Usar dpkg para una verificación más robusta de la instalación
    resp_dpkg_cowsay = client.post("/run", data={"command": "dpkg -s cowsay"})
    assert resp_dpkg_cowsay.status_code == 200
    dpkg_cowsay_output = resp_dpkg_cowsay.text
    assert "Status: install ok installed" in dpkg_cowsay_output

    # Adicionalmente, probar la ejecución si se desea
    resp_cowsay_run = client.post("/run", data={"command": "/usr/games/cowsay hello_dpkg"})
    assert resp_cowsay_run.status_code == 200
    assert "hello_dpkg" in resp_cowsay_run.text

    # --- Verificar htop ---
    resp_dpkg_htop = client.post("/run", data={"command": "dpkg -s htop"})
    assert resp_dpkg_htop.status_code == 200
    dpkg_htop_output = resp_dpkg_htop.text
    assert "Status: install ok installed" in dpkg_htop_output
    
    # Extraer la versión de la salida de dpkg -s htop
    version_match = re.search(r"Version: (\d+\.\d+\.\d+.*)", dpkg_htop_output)
    assert version_match is not None, "No se pudo encontrar la línea de versión de htop en la salida de dpkg"
    htop_version = version_match.group(1)
    # print(f"HTOP Version from dpkg: {htop_version}")
    assert "." in htop_version and any(c.isdigit() for c in htop_version), \
        f"La versión de htop '{htop_version}' no parece válida."

def test_chmod_path_endpoint(client, CONTAINER_WORKSPACE): # Fixtures injected
    filename = unique_filename("chmod_test_")
    container_file_rel_path = filename
    container_file_abs_path = f"{CONTAINER_WORKSPACE}/{filename}" 

    client.post("/run", data={"command": f"touch {container_file_abs_path} && chmod 600 {container_file_abs_path}"})

    new_mode = "755"
    response_chmod = client.post("/chmod_path", data={"container_path": container_file_rel_path, "mode": new_mode})
    assert response_chmod.status_code == 200
    assert f"changed to '{new_mode}'" in response_chmod.json()["detail"]

    response_stat = client.post("/run", data={"command": f"stat -c %a {container_file_abs_path}"})
    assert response_stat.status_code == 200
    assert response_stat.text.strip() == new_mode
    
    client.post("/run", data={"command": f"rm -f {container_file_abs_path}"})

def test_search_files_endpoint(client, CONTAINER_WORKSPACE): # Fixtures injected
    test_dir = unique_dirname("search_dir_")
    test_file1 = unique_filename("findme_")
    test_file2 = unique_filename("other_")
    container_dir = f"{CONTAINER_WORKSPACE}/{test_dir}"
    container_file1 = f"{container_dir}/{test_file1}"
    container_file2 = f"{container_dir}/{test_file2}"
    client.post("/run", data={"command": f"mkdir -p {container_dir} && touch {container_file1} && touch {container_file2}"})
    
    resp = client.get(f"/search_files?pattern={test_file1}&base_path={container_dir}")
    assert resp.status_code == 200
    files = resp.json()["files"]
    assert any(test_file1 in f for f in files)
    
    resp2 = client.get(f"/search_files?pattern=*.txt&base_path={container_dir}")
    assert resp2.status_code == 200
    files2 = resp2.json()["files"]
    assert any(test_file1 in f for f in files2)
    assert any(test_file2 in f for f in files2)
    client.post("/run", data={"command": f"rm -rf {container_dir}"})

def test_search_in_files_endpoint(client, CONTAINER_WORKSPACE): # Fixtures injected
    test_file = unique_filename("grepme_")
    test_content = f"palabraunica_{uuid.uuid4().hex}"
    container_file = f"{CONTAINER_WORKSPACE}/{test_file}"
    client.post("/run", data={"command": f"echo '{test_content}' > {container_file}"})
    
    resp = client.get(f"/search_in_files?query={test_content}&base_path={CONTAINER_WORKSPACE}")
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert any(test_file in r["file"] and test_content in r["content"] for r in results)
    client.post("/run", data={"command": f"rm -f {container_file}"})

def test_commands_log_persistence(client): # Fixture injected
    test_cmd = f"echo log_test_{uuid.uuid4().hex}"
    
    resp_run = client.post("/run", data={"command": test_cmd})
    assert resp_run.status_code == 200
    output = resp_run.text.strip()
    assert output.startswith("log_test_")
    
    time.sleep(1.5) # Give time for async log write
    
    resp_log = client.get("/commands_log")
    assert resp_log.status_code == 200
    log_content = resp_log.text
    
    assert test_cmd in log_content
    assert output in log_content
    assert "---" in log_content and "CMD:" in log_content
    
def test_edit_file_content_replace(client, CONTAINER_WORKSPACE): 
    filename = unique_filename("edit_replace_")
    container_path = f"{CONTAINER_WORKSPACE}/{filename}"
    original_content = "linea1\n    linea2\n\tlinea3\n" # Ends with \n
    new_content = "primera\n\tsegunda\n    tercera\n" # Ends with \n

    with tempfile.NamedTemporaryFile(delete=False, mode="wb") as tmpf:
        tmpf.write(original_content.encode('utf-8'))
        local_path = tmpf.name
    
    with open(local_path, "rb") as f:
        resp_copy = client.post(
            "/copy_to", 
            data={"container_path": container_path},
            files={"file": (filename, f, "text/plain")}
        )
    os.remove(local_path)
    assert resp_copy.status_code == 200

    # Send content without trailing newline, endpoint should add it if not present
    # and the final comparison new_content already has it.
    resp = client.put("/edit_file_content", json={
        "container_path": container_path,
        "content": new_content.strip(), # Test with stripped content
        "mode": "replace"
    })
    assert resp.status_code == 200
    
    resp_read = client.get(f"/read_file?container_path={container_path}") 
    assert resp_read.status_code == 200
    # Read file should return content as is, which should match new_content (with its trailing \n)
    assert resp_read.text == new_content 
    
    client.post("/run", data={"command": f"rm -f {container_path}"})


def test_edit_file_content_smart(client, CONTAINER_WORKSPACE): 
    filename = unique_filename("edit_smart_")
    container_path = f"{CONTAINER_WORKSPACE}/{filename}"
    original_content = "uno\n    dos\n\t tres\ncuatro\n" # Ends with \n
    with tempfile.NamedTemporaryFile(delete=False, mode="wb") as tmpf:
        tmpf.write(original_content.encode('utf-8'))
        local_path = tmpf.name
    with open(local_path, "rb") as f:
        resp_copy = client.post("/copy_to", data={"container_path": container_path}, files={"file": (filename, f, "text/plain")})
    os.remove(local_path)
    assert resp_copy.status_code == 200

    resp = client.put("/edit_file_content", json={
        "container_path": container_path,
        "content": "DOS", 
        "mode": "smart",
        "search_text": "dos"
    })
    assert resp.status_code == 200
    
    resp_read = client.get(f"/read_file?container_path={container_path}")
    assert resp_read.status_code == 200
    expected_after_dos = "uno\n    DOS\n\t tres\ncuatro\n"
    assert resp_read.text == expected_after_dos

    resp2 = client.put("/edit_file_content", json={
        "container_path": container_path,
        "content": "TRES",
        "mode": "smart",
        "search_text": "tres" # Will match " tres" due to how smart replace pattern works
    })
    assert resp2.status_code == 200
    resp_read2 = client.get(f"/read_file?container_path={container_path}")
    assert resp_read2.status_code == 200
    # La línea original tenía un tabulador antes de ' tres', pero el reemplazo ahora pone un espacio
    expected_after_tres = "uno\n    DOS\n     TRES\ncuatro\n"
    assert resp_read2.text == expected_after_tres
    
    client.post("/run", data={"command": f"rm -f {container_path}"})


def test_edit_file_lines_endpoint(client, CONTAINER_WORKSPACE): 
    filename = unique_filename("editlines_")
    content = "Línea 1 original\nLínea 2 original\n    Línea 3 con tabulación\nLínea 4 original\nLínea 5 original\n"
    container_path = f"{CONTAINER_WORKSPACE}/{filename}"

    with tempfile.NamedTemporaryFile(delete=False, mode="wb") as tmpf: 
        tmpf.write(content.encode("utf-8"))
        local_path = tmpf.name
    
    with open(local_path, "rb") as f:
        resp_copy = client.post(
            "/copy_to",
            data={"container_path": container_path},
            files={"file": (filename, f, "text/plain")}
        )
    os.remove(local_path)
    assert resp_copy.status_code == 200

    new_lines_content = "Línea 2 modificada\nLínea 3 nueva" 
    
    resp_edit = client.post(
        "/edit_file_lines",
        data={
            "container_path": container_path,
            "start_line": 2, 
            "end_line": 3,   
            "new_content": new_lines_content
        }
    )
    assert resp_edit.status_code == 200
    assert "updated successfully" in resp_edit.json()["detail"]

    resp_read = client.get(f"/read_file?container_path={container_path}")
    assert resp_read.status_code == 200
    
    expected_full_content = (
        "Línea 1 original\n"
        "Línea 2 modificada\n"  # No indent, as "Línea 2 original" had no indent
        "Línea 3 nueva\n"         # No indent, inherits from "Línea 2 original"
        "Línea 4 original\n"
        "Línea 5 original\n"
    )
    # Normalize line endings from the response before comparison
    assert resp_read.text.replace('\r\n', '\n') == expected_full_content

    result = resp_read.text.splitlines() 
    
    assert result[0] == "Línea 1 original"
    assert result[1] == "Línea 2 modificada" 
    assert result[2] == "Línea 3 nueva"       
    assert result[3] == "Línea 4 original"
    assert result[4] == "Línea 5 original"

    client.post("/run", data={"command": f"rm -f {container_path}"})

    # Test invalid range on a (now non-existent but logic is pre-read) file path
    # The file does not exist anymore, so this will test the file not found path in edit_file_lines.
    # To test invalid range specifically, we would need to recreate the file first.
    # Let's recreate for a more accurate "Invalid line range" test.
    with tempfile.NamedTemporaryFile(delete=False, mode="wb") as tmpf: 
        tmpf.write(b"line1\nline2\n") # A small file
        local_path_recreate = tmpf.name
    with open(local_path_recreate, "rb") as f_rec:
        client.post("/copy_to", data={"container_path": container_path}, files={"file": (filename, f_rec, "text/plain")})
    os.remove(local_path_recreate)


    resp_err = client.post(
        "/edit_file_lines",
        data={
            "container_path": container_path, 
            "start_line": 10, # Out of bounds for a 2-line file
            "end_line": 12,
            "new_content": "no importa"
        }
    )
    assert resp_err.status_code == 400 
    assert "Invalid start line" in resp_err.json()["detail"] # Updated based on more specific error
    client.post("/run", data={"command": f"rm -f {container_path}"})


    resp_trav = client.post(
        "/edit_file_lines",
        data={
            "container_path": "../etc/passwd", 
            "start_line": 1,
            "end_line": 1,
            "new_content": "hack"
        }
    )
    assert resp_trav.status_code == 400
    assert "Path traversal" in resp_trav.json()["detail"]
    
def unique_filename(prefix="testfile_", suffix=".txt"):
    """Helper to create unique filenames for tests."""
    import uuid
    return f"{prefix}{uuid.uuid4().hex[:8]}{suffix}"

# --- Tests para /edit_file_content_advanced ---

def test_edit_content_advanced_simple_replace_spaces(client, CONTAINER_WORKSPACE):
    filename = unique_filename("edit_adv_spaces_", ".py")
    container_path = f"{CONTAINER_WORKSPACE}/{filename}"
    original_content = (
        "def hello():\n"
        "    print(\"Original Line 1\")\n"
        "    print(\"Original Line 2\")\n"
        "    return True\n"
    )
    # Crear archivo en el contenedor
    resp_copy = client.post("/copy_to_text", json={"container_path": container_path, "content": original_content})
    assert resp_copy.status_code == 200

    search_text = "print(\"Original Line 2\")"
    replacement_content = "print(\"Replaced Line 2\")"

    resp_edit = client.put("/edit_file_content_advanced", json={
        "container_path": container_path,
        "search_text": search_text,
        "content": replacement_content
    })
    assert resp_edit.status_code == 200
    data = resp_edit.json()
    assert data["detail"].endswith("1 reemplazo(s) realizado(s).")
    assert data["indentation_style_used"]["type"] == "space"
    assert data["indentation_style_used"]["width"] == 4 # Asumiendo que detecta 4 espacios

    resp_read = client.get(f"/read_file?container_path={container_path}")
    assert resp_read.status_code == 200
    expected_content = (
        "def hello():\n"
        "    print(\"Original Line 1\")\n"
        "    print(\"Replaced Line 2\")\n" # <- Reemplazado con 4 espacios de indentación
        "    return True\n"
    )
    assert resp_read.text == expected_content
    client.post("/run", data={"command": f"rm -f {container_path}"})


def test_edit_content_advanced_multiline_replacement_indent_adjustment(client, CONTAINER_WORKSPACE):
    filename = unique_filename("edit_adv_multi_", ".py")
    container_path = f"{CONTAINER_WORKSPACE}/{filename}"
    original_content = (
        "class MyClass:\n"
        "    def method_one(self):\n"
        "        pass # Placeholder\n"
        "\n"
        "    def method_two(self):\n"
        "        print(\"Done\")\n"
    )
    client.post("/copy_to_text", json={"container_path": container_path, "content": original_content})

    search_text = "pass # Placeholder"
    # Replacement content tiene su propia indentación relativa interna
    replacement_content = (
        "print(\"Step 1\")\n"
        "if True:\n"
        "    print(\"Step 2 inside if\")\n" # Esta línea tiene indentación relativa al inicio del bloque
        "print(\"Step 3\")"
    )

    resp_edit = client.put("/edit_file_content_advanced", json={
        "container_path": container_path,
        "search_text": search_text,
        "content": replacement_content,
        "language_hint": "python" # Ayuda a la detección de indentación (tab_width=8 si es tabs)
    })
    assert resp_edit.status_code == 200
    data = resp_edit.json()
    assert data["indentation_style_used"]["type"] == "space"
    assert data["indentation_style_used"]["width"] == 4

    resp_read = client.get(f"/read_file?container_path={container_path}")
    assert resp_read.status_code == 200
    expected_content = (
        "class MyClass:\n"
        "    def method_one(self):\n"
        "        print(\"Step 1\")\n"                # Indentado con 8 espacios (o 2x4 espacios)
        "        if True:\n"                         # Indentado con 8 espacios
        "            print(\"Step 2 inside if\")\n"  # Indentado con 12 espacios (8 base + 4 relativo)
        "        print(\"Step 3\")\n"                # Indentado con 8 espacios
        "\n"
        "    def method_two(self):\n"
        "        print(\"Done\")\n"
    )
    # print(f"Expected:\n{expected_content}")
    # print(f"Actual:\n{resp_read.text}")
    assert resp_read.text == expected_content
    client.post("/run", data={"command": f"rm -f {container_path}"})


def test_edit_content_advanced_no_match(client, CONTAINER_WORKSPACE):
    filename = unique_filename("edit_adv_nomatch_", ".txt")
    container_path = f"{CONTAINER_WORKSPACE}/{filename}"
    original_content = "Line one\nLine two\nLine three\n"
    client.post("/copy_to_text", json={"container_path": container_path, "content": original_content})

    resp_edit = client.put("/edit_file_content_advanced", json={
        "container_path": container_path,
        "search_text": "NonExistentText",
        "content": "This should not be written"
    })
    assert resp_edit.status_code == 200 # Endpoint devuelve 200 incluso si no hay reemplazos
    data = resp_edit.json()
    assert data["detail"].endswith("0 reemplazo(s) realizado(s).")

    resp_read = client.get(f"/read_file?container_path={container_path}")
    assert resp_read.status_code == 200
    assert resp_read.text == original_content # Contenido no debe cambiar
    client.post("/run", data={"command": f"rm -f {container_path}"})


def test_edit_content_advanced_empty_search_text(client, CONTAINER_WORKSPACE):
    filename = unique_filename("edit_adv_emptysearch_", ".txt")
    container_path = f"{CONTAINER_WORKSPACE}/{filename}"
    original_content = "Some content here.\n"
    client.post("/copy_to_text", json={"container_path": container_path, "content": original_content})

    resp_edit = client.put("/edit_file_content_advanced", json={
        "container_path": container_path,
        "search_text": "", # Empty search text
        "content": "New entire content"
    })
    # Current logic: if search_text is empty, no replacement happens.
    # If we wanted it to replace all content, the endpoint logic would need to change.
    assert resp_edit.status_code == 200
    data = resp_edit.json()
    assert data["detail"].endswith("0 reemplazo(s) realizado(s).") # As per current implementation

    resp_read = client.get(f"/read_file?container_path={container_path}")
    assert resp_read.status_code == 200
    assert resp_read.text == original_content # Should not change
    client.post("/run", data={"command": f"rm -f {container_path}"})


def test_edit_content_advanced_replace_entire_file_with_empty_content(client, CONTAINER_WORKSPACE):
    filename = unique_filename("edit_adv_replace_all_empty_", ".txt")
    container_path = f"{CONTAINER_WORKSPACE}/{filename}"
    original_content = "Line 1 to be gone\nLine 2 to be gone\n"
    client.post("/copy_to_text", json={"container_path": container_path, "content": original_content})

    resp_edit = client.put("/edit_file_content_advanced", json={
        "container_path": container_path,
        "search_text": original_content.strip('\n'), # Search for the whole content (without trailing newline if any)
        "content": "" # Replace with empty string
    })
    assert resp_edit.status_code == 200
    data = resp_edit.json()
    assert data["detail"].endswith("1 reemplazo(s) realizado(s).")

    resp_read = client.get(f"/read_file?container_path={container_path}")
    assert resp_read.status_code == 200
    # El archivo debería estar vacío, pero la lógica de añadir newline podría añadir uno.
    # La lógica actual de trailing newline es:
    # if final_text and not final_text.endswith("\n"): final_text += "\n"
    # elif not final_text and (content_to_write or (num_replacements > 0 and not original_text)):
    #    if not (num_replacements > 0 and not content_to_write): final_text += "\n"
    # Si final_text es "" y content_to_write es "", no se añade \n.
    assert resp_read.text == "" # O "\n" dependiendo de la lógica exacta del trailing newline
                                # Con la lógica actual, si content_to_write es "" y reemplaza algo,
                                # final_text será "" y no se añadirá \n.
    client.post("/run", data={"command": f"rm -f {container_path}"})

def test_edit_content_advanced_replace_with_content_needing_reindent(client, CONTAINER_WORKSPACE):
    filename = unique_filename("edit_adv_reindent_", ".py")
    container_path = f"{CONTAINER_WORKSPACE}/{filename}"
    original_content = (
        "def main():\n"
        "    # Block to replace\n"
        "    old_line_1\n"
        "    old_line_2\n"
        "    # End block to replace\n"
        "    print(\"after\")\n"
    )
    client.post("/copy_to_text", json={"container_path": container_path, "content": original_content})

    search_block = (
        "# Block to replace\n"
        "    old_line_1\n"
        "    old_line_2\n"
        "    # End block to replace"
    )
    # El contenido de reemplazo tiene su propia indentación (e.g., desde un snippet)
    # que re_indent_block debe ajustar.
    replacement_block = (
    "replacement_line_1()\n"
    "  replacement_line_2_indented_further()" # esta indentación es relativa a la primera línea del bloque
    )

    resp_edit = client.put("/edit_file_content_advanced", json={
        "container_path": container_path,
        "search_text": search_block,
        "content": replacement_block,
        "language_hint": "python"
    })
    assert resp_edit.status_code == 200
    data = resp_edit.json()
    assert data["detail"].endswith("1 reemplazo(s) realizado(s).")
    assert data["indentation_style_used"]["type"] == "space"
    assert data["indentation_style_used"]["width"] == 4


    resp_read = client.get(f"/read_file?container_path={container_path}")
    assert resp_read.status_code == 200
    expected_content = (
        "def main():\n"
        "    replacement_line_1()\n"                 # Indentado a 4 espacios
        "      replacement_line_2_indented_further()" # Indentado a 4 (base) + 2 (relativa del bloque) = 6 espacios
                                                      # asumiendo que la indentación relativa del replacement_block es de 2 espacios.
                                                      # La lógica actual de re_indent_block puede hacer esto:
                                                      # base_indent = "    "
                                                      # relative_visual_indent for line2 = get_visual_length("  ") = 2
                                                      # target_style = space, width=4
                                                      # current_line_relative_target_indent_str = "  "
                                                      # new_line_full_indent = "    " + "  " = "      "
        "\n" # re_indent_block une con \n, el endpoint añade un \n final si es necesario.
             # el replacement_block no tiene un \n al final, así que join no añade uno extra.
             # el content_to_write es el replacement_block, que no termina en \n
             # El `final_text` resultante no terminará en \n después de la reindentación del bloque.
             # Luego, el endpoint `edit_file_content_advanced` añade un \n.
             # PERO, el search_block no terminaba en \n, el original_content sí.
             # El re.sub reemplaza la parte que no tiene \n.
             # "    print(\"after\")\n" queda.
        "    print(\"after\")\n"
    )
    # print(f"Expected:\n---\n{expected_content}\n---")
    # print(f"Actual:\n---\n{resp_read.text}\n---")
    assert resp_read.text == expected_content
    client.post("/run", data={"command": f"rm -f {container_path}"})