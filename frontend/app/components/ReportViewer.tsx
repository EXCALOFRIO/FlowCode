'use client';

import { useState, useEffect } from 'react';
import SwiftLaTeXViewer from './SwiftLaTeXViewer';

interface ReportViewerProps {
  report: string; // Se espera que sea el contenido LaTeX crudo
  onBack: () => void;
}

export default function ReportViewer({ report, onBack }: ReportViewerProps) {
  const [isClient, setIsClient] = useState(false);
  const [cleanedReport, setCleanedReport] = useState('');

  // Efecto para activar renderizado del cliente
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Efecto para limpiar el reporte de delimitadores
  useEffect(() => {
    // Limpiar el reporte de posibles delimitadores
    let currentReport = report;
    
    // Quitar delimitadores de código
    if (currentReport.startsWith("```latex")) {
      currentReport = currentReport.substring(8);
      if (currentReport.endsWith("```")) {
        currentReport = currentReport.substring(0, currentReport.length - 3);
      }
    }
    
    // Quitar otro tipo de delimitadores
    if (currentReport.startsWith("'''latex")) {
      currentReport = currentReport.substring(7);
      if (currentReport.endsWith("'''")) {
        currentReport = currentReport.substring(0, currentReport.length - 3);
      }
    }
    
    setCleanedReport(currentReport.trim());
  }, [report]);

  return (
    <div className="w-full h-full relative">
      {isClient ? (
        <div className="pdf-container">
          <SwiftLaTeXViewer latexContent={cleanedReport} />
        </div>
      ) : (
        <div className="flex justify-center items-center h-full w-full">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
          <span className="ml-4 text-xl font-medium">Generando documento PDF...</span>
        </div>
      )}

      <style jsx global>{`
        .pdf-container {
          width: 100%;
          height: 100%;
          background: #f8f9fa;
          overflow: auto;
        }
        
        .pdf-container iframe {
          min-height: 100%;
          width: 100%;
        }
      `}</style>
    </div>
  );
}