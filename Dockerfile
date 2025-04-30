FROM node:20-slim

# Instalar Python y dependencias comunes
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-full \
    python3-pip \
    python3-setuptools \
    python3-wheel \
    python3-venv \
    python3-numpy \
    python3-pandas \
    python3-matplotlib \
    python3-sklearn \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Crear y activar entorno virtual
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Crear dirección para archivos cargados
RUN mkdir -p /app/uploads

# Instalar TensorFlow en el entorno virtual
RUN pip3 install --no-cache-dir tensorflow

# Configurar el directorio de trabajo
WORKDIR /app

# Mantener el contenedor en ejecución
CMD ["tail", "-f", "/dev/null"]