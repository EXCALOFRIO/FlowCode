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
    const response = await fetch(`${dockerManagerUrl}${targetUrl}${url.search}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying to Docker Manager:', error);
    return NextResponse.json(
      { error: 'Error connecting to Docker Manager service', running: false },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const targetUrl = url.pathname.replace(/^\/api\/docker/, '');
  const dockerManagerUrl = process.env.DOCKER_MANAGER_URL || 'http://localhost:9000';
  
  try {
    const body = await request.json().catch(() => ({})); // Permitir requests sin body
    
    const response = await fetch(`${dockerManagerUrl}${targetUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying to Docker Manager:', error);
    return NextResponse.json(
      { error: 'Error connecting to Docker Manager service', running: false },
      { status: 500 }
    );
  }
} 