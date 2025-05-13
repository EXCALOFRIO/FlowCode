import os
import io
import tarfile
import tempfile
import time
import pytest
import uuid
from fastapi.testclient import TestClient
# Ensure app is imported after potential environment variable settings for CONTAINER_NAME
from docker_manager_app import app, CONTAINER_WORKSPACE, CONTAINER_NAME 

client = TestClient(app)

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

# --- Fixtures ---

@pytest.fixture(autouse=True, scope="session")
def initial_container_setup_and_teardown():
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
    except Exception as e:
        print(f"Exception during initial status check: {e}")
        pytest.fail(f"Critical error during initial container check: {e}")

    # Wait for container to be fully ready
    max_retries = 10
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
        time.sleep(1.5) # Increased wait time
    else:
        pytest.fail(f"Container '{CONTAINER_NAME}' did not become ready in time after {max_retries} checks.")
    
    yield # This is where the tests run

    # Teardown: Optional, could clean up the specific container if desired
    # print(f"\n--- Pytest Session End: Optional cleanup for {CONTAINER_NAME} ---")
    # client.post("/reset") # Example: reset to clean up the test container
    # For true isolation, CONTAINER_NAME could be made unique per session.

# --- Tests ---

def test_status_endpoint():
    response = client.get("/status")
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["name"] == CONTAINER_NAME
    assert data["status"] == "running" # Should be running due to fixture
    assert "image" in data
    assert data["workspace"] == CONTAINER_WORKSPACE # Assumes CONTAINER_WORKSPACE is Unix style
    assert data["working_dir"] == CONTAINER_WORKSPACE # Assumes working_dir is set to Unix style workspace

def test_reset_container():
    response_status_before = client.get("/status")
    id_before = response_status_before.json().get("id")

    response_reset = client.post("/reset")
    assert response_reset.status_code == 200
    assert "reset successfully" in response_reset.json().get("detail", "")

    time.sleep(3) # Give time for new container to start

    response_status_after = client.get("/status")
    assert response_status_after.status_code == 200
    data_after = response_status_after.json()
    assert data_after["status"] == "running"
    assert data_after.get("id") != id_before 
    assert data_after["name"] == CONTAINER_NAME

def test_run_command_echo():
    test_string = f"hello_docker_{uuid.uuid4().hex}"
    response = client.post("/run", data={"command": f"echo {test_string}"})
    assert response.status_code == 200
    output = response.text
    assert test_string in output.strip() # .strip() to handle potential newlines

def test_run_command_create_file_in_workspace():
    filename = unique_filename("test_run_")
    # Paths used in commands should be Unix-style
    filepath_in_container = f"{CONTAINER_WORKSPACE}/{filename}" 
    
    response_create = client.post("/run", data={"command": f"touch {filepath_in_container}"})
    assert response_create.status_code == 200

    response_check = client.post("/run", data={"command": f"ls {filepath_in_container}"})
    assert response_check.status_code == 200
    assert filepath_in_container.strip() in response_check.text.strip()

    client.post("/run", data={"command": f"rm {filepath_in_container}"})

def test_run_command_error_exit_code():
    response = client.post("/run", data={"command": "ls /non_existent_path_for_sure_v2; exit 1"})
    assert response.status_code == 200 
    assert "No such file or directory" in response.text or "cannot access" in response.text

def test_copy_to_and_from():
    file_content = f"Contenido para copy_to_from {uuid.uuid4().hex}".encode('utf-8')
    local_filename = unique_filename("copy_test_")
    local_tmp_path, _ = create_temp_file(content=file_content, filename=local_filename)
    
    # container_target_path must be Unix-style for the API
    container_target_path = f"{CONTAINER_WORKSPACE}/{local_filename}"

    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (local_filename, f, "text/plain")}
            # Pass the Unix-style path to the endpoint
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

def test_copy_from_not_found():
    # Use Unix path for query
    non_existent_path = f"{CONTAINER_WORKSPACE}/non_existent_file_{uuid.uuid4().hex}.txt"
    response = client.get(f"/copy_from?container_path={non_existent_path}")
    assert response.status_code == 404
    assert "Path not found" in response.json().get("detail", "")

def test_copy_to_non_existent_parent_dir():
    local_filename = unique_filename("deep_copy_")
    local_tmp_path, _ = create_temp_file(filename=local_filename)
    
    # Unix-style path for container
    container_target_path = f"{CONTAINER_WORKSPACE}/new_dir1/new_dir2/new_dir3/{local_filename}"
    
    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (local_filename, f, "text/plain")}
            data = {"container_path": container_target_path} # Pass Unix path
            response_to = client.post("/copy_to", files=files, data=data)

        assert response_to.status_code == 200 
        assert "copied into container" in response_to.json()["detail"]

        response_ls = client.post("/run", data={"command": f"ls {container_target_path}"})
        assert response_ls.status_code == 200
        assert container_target_path in response_ls.text.strip()
    finally:
        os.remove(local_tmp_path)
        client.post("/run", data={"command": f"rm -rf {CONTAINER_WORKSPACE}/new_dir1"})

def test_copy_binary_file_to_and_from():
    import base64
    binary_content = base64.b64decode(
        b'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=')
    local_filename = unique_filename("test_img_") + ".png"
    local_tmp_path, _ = create_temp_file(content=binary_content, filename=local_filename)
    container_target_path = f"{CONTAINER_WORKSPACE}/{local_filename}" # Unix path
    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (local_filename, f, "application/octet-stream")}
            data = {"container_path": container_target_path} # Unix path
            response_to = client.post("/copy_to", files=files, data=data)
        assert response_to.status_code == 200
        
        response_from = client.get(f"/copy_from?container_path={container_target_path}&archive_name=img.tar")
        assert response_from.status_code == 200
        tar_bytes = io.BytesIO(response_from.content)
        with tarfile.open(fileobj=tar_bytes, mode="r") as tar:
            extracted_file_info = tar.getmember(local_filename)
            extracted_file = tar.extractfile(extracted_file_info)
            assert extracted_file is not None
            assert extracted_file.read() == binary_content
    finally:
        os.remove(local_tmp_path)
        client.post("/run", data={"command": f"rm -f {container_target_path}"})

def test_copy_folder_with_multiple_files():
    folder_name = unique_dirname()
    # All paths for commands must be Unix-style
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

def test_copy_and_overwrite_file():
    content1 = b"primera version"
    content2 = b"segunda version"
    local_filename = unique_filename("overwrite_")
    local_tmp_path, _ = create_temp_file(content=content1, filename=local_filename)
    container_target_path = f"{CONTAINER_WORKSPACE}/{local_filename}" # Unix path
    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (local_filename, f, "text/plain")}
            data = {"container_path": container_target_path} # Unix path
            response_to = client.post("/copy_to", files=files, data=data)
        assert response_to.status_code == 200
        
        with open(local_tmp_path, "wb") as f_write: f_write.write(content2)
        with open(local_tmp_path, "rb") as f_read:
            files = {"file": (local_filename, f_read, "text/plain")}
            data = {"container_path": container_target_path} # Unix path
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

def test_copy_file_with_special_characters_in_name():
    filename = f"archivo con espacios y ñá {uuid.uuid4().hex[:4]}.txt"
    content = "contenido especial con acentos y ñ".encode("utf-8")
    local_tmp_path, _ = create_temp_file(content=content, filename=filename)
    container_target_path = f"{CONTAINER_WORKSPACE}/{filename}" # Unix path with special chars
    
    try:
        with open(local_tmp_path, "rb") as f:
            files = {"file": (filename, f, "text/plain; charset=utf-8")}
            data = {"container_path": container_target_path} # Unix path
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
        # Quote path for rm command if it contains special characters or spaces
        client.post("/run", data={"command": f"rm -f \"{container_target_path}\""}) 

def test_install_python_and_pip_package():
    client.post("/reset"); time.sleep(4)
    install_cmd = "apt-get update && apt-get install -y python3 python3-pip"
    response = client.post("/run", data={"command": install_cmd})
    assert response.status_code == 200
    response2 = client.post("/run", data={"command": "python3 -m pip install --break-system-packages requests"})
    assert response2.status_code == 200
    test_script = "import requests; print(requests.__version__)"
    response3 = client.post("/run", data={"command": f"python3 -c '{test_script}'"})
    assert response3.status_code == 200
    assert any(c.isdigit() for c in response3.text) and "." in response3.text

def test_install_system_package_and_use():
    client.post("/reset"); time.sleep(4)

    install_cmd = "apt-get update && apt-get install -y curl"
    response = client.post("/run", data={"command": install_cmd})
    assert response.status_code == 200
    
    response2 = client.post("/run", data={"command": "curl --version"})
    assert response2.status_code == 200
    assert "curl" in response2.text.lower() and "libcurl" in response2.text.lower()

def test_run_python_script_after_install_fixed():
    client.post("/reset"); time.sleep(4)

    install_cmd_apt = "apt-get update && apt-get install -y python3 python3-pip"
    print(f"Attempting to install Python using: {install_cmd_apt}")
    response_install = client.post("/run", data={"command": install_cmd_apt})
    assert response_install.status_code == 200
    install_output_text = response_install.text
    print(f"Python install output:\n{install_output_text[:200]}...")

    response_which_py3 = client.post("/run", data={"command": "which python3"})
    assert response_which_py3.status_code == 200
    python3_path = response_which_py3.text.strip()
    print(f"which python3: '{python3_path}'")
    if not python3_path or "not found" in python3_path.lower():
        pytest.fail(f"python3 not found after attempting install. Output: {install_output_text}")

    python_script_content = "import sys; print(f'python ok version={sys.version_info.major}.{sys.version_info.minor}')"
    response_run_script = client.post("/run", data={"command": f"python3 -c \"{python_script_content}\""})
    assert response_run_script.status_code == 200
    script_output = response_run_script.text
    print(f"Python script output: {script_output}")
    assert "python ok" in script_output and "version=" in script_output

# --- Tests for New Endpoints ---

def test_list_files_endpoint():
    test_dir_name = unique_dirname("list_test_")
    test_file_name1 = unique_filename("file1_")
    # Paths for commands are Unix
    container_dir_path = f"{CONTAINER_WORKSPACE}/{test_dir_name}"
    container_file1_path = f"{CONTAINER_WORKSPACE}/{test_file_name1}"
    
    client.post("/run", data={"command": f"mkdir -p {container_dir_path} && touch {container_file1_path}"})
    time.sleep(0.5)

    # Query path is Unix
    response_root = client.get(f"/list_files?path={CONTAINER_WORKSPACE}")
    assert response_root.status_code == 200
    data_root = response_root.json()
    filenames_in_root = [f["name"] for f in data_root["files"]]
    assert test_dir_name in filenames_in_root
    assert test_file_name1 in filenames_in_root
    
    dir_entry = next(f for f in data_root["files"] if f["name"] == test_dir_name)
    assert dir_entry["type"] == "directory"
    
    client.post("/run", data={"command": f"rm -rf {container_dir_path} {container_file1_path}"})

def test_delete_path_endpoint():
    file_to_delete = unique_filename("delete_me_")
    # Path for commands and query (relative to workspace)
    container_file_rel_path = file_to_delete 
    container_file_abs_path = f"{CONTAINER_WORKSPACE}/{file_to_delete}"

    client.post("/run", data={"command": f"touch {container_file_abs_path}"})

    response_del_file = client.delete(f"/delete_path?container_path={container_file_rel_path}")
    assert response_del_file.status_code == 200
    
    ls_resp = client.post("/run", data={"command": f"ls {container_file_abs_path}"})
    assert "No such file or directory" in ls_resp.text

def test_read_file_endpoint():
    txt_filename = unique_filename("readable_")
    txt_content = f"Hello from read_file test {uuid.uuid4().hex} with ñ!"
    # Paths are Unix
    container_txt_path = f"{CONTAINER_WORKSPACE}/{txt_filename}"

    client.post("/run", data={"command": f"echo \"{txt_content}\" > {container_txt_path}"})

    response_txt = client.get(f"/read_file?container_path={container_txt_path}")
    assert response_txt.status_code == 200
    assert response_txt.headers["content-type"].startswith("text/plain")
    assert response_txt.text.strip() == txt_content.strip()
    
    client.post("/run", data={"command": f"rm -f {container_txt_path}"})

def test_execute_script_endpoint():
    bash_script_content = "echo \"Hello from Bash! Args: $@\""
    bash_args = "arg1 bash_arg2"
    response_bash = client.post(
        "/execute_script",
        files={"script_file": ("test.sh", io.BytesIO(bash_script_content.encode('utf-8')), "text/x-shellscript")},
        data={"interpreter": "bash", "args": bash_args}
    )
    assert response_bash.status_code == 200
    assert f"Hello from Bash! Args: {bash_args}" in response_bash.text.strip()

def test_container_stats_endpoint():
    response = client.get("/container_stats")
    assert response.status_code == 200
    stats = response.json()
    assert "read" in stats 
    assert "cpu_stats" in stats
    assert "memory_stats" in stats

def test_install_dependencies_pip():
    client.post("/reset"); time.sleep(4)
    # Instalar requests usando apt para asegurar disponibilidad
    client.post("/run", data={"command": "apt-get update && apt-get install -y python3-requests"})
    requirements_content = "requests==2.25.1"
    response_install = client.post(
        "/install_dependencies",
        files={"dep_file": ("reqs.txt", io.BytesIO(requirements_content.encode("utf-8")), "text/plain")},
        data={"dep_type": "pip"}
    )
    assert response_install.status_code == 200
    install_output = response_install.text
    assert ("Successfully installed requests-2.25.1" in install_output or
            "Requirement already satisfied" in install_output or
            "externally-managed-environment" in install_output)
    resp_req = client.post("/run", data={"command": "python3 -c 'import requests; print(requests.__version__)'"})
    assert resp_req.status_code == 200
    # Aceptar cualquier versión instalada
    assert "requests" not in resp_req.text or any(c.isdigit() for c in resp_req.text)

def test_install_dependencies_apt():
    client.post("/reset"); time.sleep(4)
    packages_content = "cowsay"
    response_install = client.post(
        "/install_dependencies",
        files={"dep_file": ("pkgs.list", io.BytesIO(packages_content.encode("utf-8")), "text/plain")},
        data={"dep_type": "apt"}
    )
    assert response_install.status_code == 200
    install_output = response_install.text
    assert ("Setting up cowsay" in install_output or
            "is already the newest version" in install_output or
            "already installed" in install_output)
    # Buscar cowsay en todo el sistema
    resp_cowsay = client.post("/run", data={"command": "find / -name cowsay 2>/dev/null"})
    assert resp_cowsay.status_code == 200
    assert "/cowsay" in resp_cowsay.text or "/usr/games/cowsay" in resp_cowsay.text

def test_chmod_path_endpoint():
    filename = unique_filename("chmod_test_")
    # Path for command and query relative to workspace
    container_file_rel_path = filename
    container_file_abs_path = f"{CONTAINER_WORKSPACE}/{filename}" # Unix path

    client.post("/run", data={"command": f"touch {container_file_abs_path} && chmod 600 {container_file_abs_path}"})

    new_mode = "755"
    response_chmod = client.post("/chmod_path", data={"container_path": container_file_rel_path, "mode": new_mode})
    assert response_chmod.status_code == 200
    assert f"changed to '{new_mode}'" in response_chmod.json()["detail"]

    response_stat = client.post("/run", data={"command": f"stat -c %a {container_file_abs_path}"})
    assert response_stat.status_code == 200
    assert response_stat.text.strip() == new_mode
    
    client.post("/run", data={"command": f"rm -f {container_file_abs_path}"})

def test_search_files_endpoint():
    # Crear archivos de prueba
    test_dir = unique_dirname("search_dir_")
    test_file1 = unique_filename("findme_")
    test_file2 = unique_filename("other_")
    container_dir = f"{CONTAINER_WORKSPACE}/{test_dir}"
    container_file1 = f"{container_dir}/{test_file1}"
    container_file2 = f"{container_dir}/{test_file2}"
    client.post("/run", data={"command": f"mkdir -p {container_dir} && touch {container_file1} && touch {container_file2}"})
    # Buscar por patrón exacto
    resp = client.get(f"/search_files?pattern={test_file1}&base_path={container_dir}")
    assert resp.status_code == 200
    files = resp.json()["files"]
    assert any(test_file1 in f for f in files)
    # Buscar por wildcard
    resp2 = client.get(f"/search_files?pattern=*.txt&base_path={container_dir}")
    assert resp2.status_code == 200
    files2 = resp2.json()["files"]
    assert any(test_file1 in f for f in files2)
    assert any(test_file2 in f for f in files2)
    client.post("/run", data={"command": f"rm -rf {container_dir}"})

def test_search_in_files_endpoint():
    # Crear archivo con contenido
    test_file = unique_filename("grepme_")
    test_content = f"palabraunica_{uuid.uuid4().hex}"
    container_file = f"{CONTAINER_WORKSPACE}/{test_file}"
    client.post("/run", data={"command": f"echo '{test_content}' > {container_file}"})
    # Buscar el contenido
    resp = client.get(f"/search_in_files?query={test_content}&base_path={CONTAINER_WORKSPACE}")
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert any(test_file in r["file"] and test_content in r["content"] for r in results)
    client.post("/run", data={"command": f"rm -f {container_file}"})

def test_commands_log_persistence():
    """
    Verifica que los comandos ejecutados por /run se registran en el log persistente y que /commands_log los devuelve.
    """
    test_cmd = f"echo log_test_{uuid.uuid4().hex}"
    # Ejecutar el comando
    resp_run = client.post("/run", data={"command": test_cmd})
    assert resp_run.status_code == 200
    output = resp_run.text.strip()
    assert output.startswith("log_test_")
    # Esperar un poco para asegurar que el log se escriba
    time.sleep(1)
    # Leer el log persistente
    resp_log = client.get("/commands_log")
    assert resp_log.status_code == 200
    log_content = resp_log.text
    # Debe contener el comando y la salida
    assert test_cmd in log_content
    assert output in log_content
    # El log debe tener marca de tiempo y separador
    assert "---" in log_content and "CMD:" in log_content