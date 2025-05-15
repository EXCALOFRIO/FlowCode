import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy para las peticiones al API del agente
 * Evita problemas de CORS al usar Next.js como proxy
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const targetUrl = url.pathname.replace(/^\/api\/agent/, '');
  const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:8001';
  
  try {
    const response = await fetch(`${backendUrl}${targetUrl}${url.search}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying to backend:', error);
    return NextResponse.json(
      { error: 'Error connecting to backend service' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const targetUrl = url.pathname.replace(/^\/api\/agent/, '');
  const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:8001';
  
  try {
    const body = await request.json();
    
    const response = await fetch(`${backendUrl}${targetUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying to backend:', error);
    return NextResponse.json(
      { error: 'Error connecting to backend service' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const targetUrl = url.pathname.replace(/^\/api\/agent/, '');
  const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:8001';
  
  try {
    const response = await fetch(`${backendUrl}${targetUrl}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying to backend:', error);
    return NextResponse.json(
      { error: 'Error connecting to backend service' },
      { status: 500 }
    );
  }
} 