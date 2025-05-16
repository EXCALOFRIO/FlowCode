import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy para las peticiones al Docker Manager
 * Evita problemas de CORS al usar Next.js como proxy
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const targetUrl = url.pathname.replace(/^\/api\/docker/, '');
  const dockerManagerUrl = process.env.DOCKER_MANAGER_URL || 'http://localhost:9000';
  
  try {
    // Crear un controlador de aborto con un timeout de 25 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    
    console.log(`Proxy: Enviando solicitud GET a ${dockerManagerUrl}${targetUrl}${url.search}`);
    
    const response = await fetch(`${dockerManagerUrl}${targetUrl}${url.search}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    // Limpiar el timeout
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Error en la respuesta: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Proxy: Respuesta recibida de Docker Manager:`, data);
    return NextResponse.json(data);
  } catch (error) {
    let errorMessage = 'Error desconocido';
    let statusCode = 500;
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Detectar errores específicos
      if (error.name === 'AbortError') {
        errorMessage = 'Timeout al conectar con Docker Manager (25s)';
        statusCode = 504; // Gateway Timeout
      } else if (errorMessage.includes('fetch failed')) {
        errorMessage = 'No se pudo conectar con Docker Manager. Servicio no disponible.';
        statusCode = 503; // Service Unavailable
      }
    }
    
    console.error(`Proxy: Error conectando a Docker Manager: ${errorMessage}`);
    return NextResponse.json(
      { 
        error: errorMessage, 
        running: false,
        timestamp: new Date().toISOString(),
        url: `${dockerManagerUrl}${targetUrl}${url.search}`
      },
      { status: statusCode }
    );
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const targetUrl = url.pathname.replace(/^\/api\/docker/, '');
  const dockerManagerUrl = process.env.DOCKER_MANAGER_URL || 'http://localhost:9000';
  
  try {
    // Crear un controlador de aborto con un timeout de 25 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    
    const body = await request.json().catch(() => ({})); // Permitir requests sin body
    
    console.log(`Proxy: Enviando solicitud POST a ${dockerManagerUrl}${targetUrl}`);
    
    const response = await fetch(`${dockerManagerUrl}${targetUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    
    // Limpiar el timeout
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Error en la respuesta: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Proxy: Respuesta recibida de Docker Manager:`, data);
    return NextResponse.json(data);
  } catch (error) {
    let errorMessage = 'Error desconocido';
    let statusCode = 500;
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Detectar errores específicos
      if (error.name === 'AbortError') {
        errorMessage = 'Timeout al conectar con Docker Manager (25s)';
        statusCode = 504; // Gateway Timeout
      } else if (errorMessage.includes('fetch failed')) {
        errorMessage = 'No se pudo conectar con Docker Manager. Servicio no disponible.';
        statusCode = 503; // Service Unavailable
      }
    }
    
    console.error(`Proxy: Error conectando a Docker Manager: ${errorMessage}`);
    return NextResponse.json(
      { 
        error: errorMessage, 
        running: false,
        timestamp: new Date().toISOString(),
        url: `${dockerManagerUrl}${targetUrl}`
      },
      { status: statusCode }
    );
  }
} 